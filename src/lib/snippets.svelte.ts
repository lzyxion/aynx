import { invoke } from "./ipc";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import {
  MAX_SNIPPET_COMMAND,
  MAX_SNIPPET_DESCRIPTION,
  MAX_SNIPPET_NAME,
  parseSnippets,
  serializeSnippets,
  updateSnippet as updateInList,
  withRenamedHostScope,
  withSnippet,
  withoutSnippet,
  type Snippet,
  type SnippetPatch,
  type SnippetScope,
} from "$lib/snippets";
import { aliasKeySet, countAliased, withoutAliased } from "$lib/host-remove";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **스니펫 목록의 상태** — 창에 하나뿐인 목록과 `snippets.json` 왕복
 * (docs/log/2026-09-16-snippets.md).
 *
 * 규칙은 전부 순수 층(`snippets.ts`)에 있고, 여기서 하는 일은 셋뿐이다: 목록 들고 있기 ·
 * 파일과 주고받기 · 지우기 전에 한 번 묻기. **터미널에 써 넣는 일은 여기 없다** —
 * 그쪽은 포커스된 타일·세션 표를 알아야 해서 `app/snippets.svelte.ts` 에 산다
 * (이 모듈이 `app/` 을 부르면 의존 방향이 거꾸로 선다).
 *
 * ## 왜 모듈 상태인가
 *
 * 읽는 화면이 셋이다 — 설정의 "스니펫" 섹션 · 명령 팔레트 · 삽입 경로. 그중 둘은
 * `+page` 를 거치지 않는 자리에 살고, 값은 **창에 하나뿐인 목록**이라 나눠 들 이유가 없다
 * (`theme-profiles.svelte.ts` 와 같은 모양).
 *
 * ## 실패를 삼킨다
 *
 * 못 읽으면 빈 목록으로, 못 쓰면 이번 실행의 변경이 파일에 안 남을 뿐이다 — 저장해 둔
 * 명령이 없어도 앱은 그대로 도는 편의 기능이라, 파일 하나 때문에 부팅이 막히는 쪽이 훨씬
 * 나쁘다 (목록 읽기 실패만으로 부팅을 막지 않는다).
 */

/** 최신순 목록 (맨 앞이 가장 최근에 저장한 것) */
let snippetList = $state<Snippet[]>([]);
/** 파일을 이미 읽었는가 — [`loadSnippets`] 는 창당 한 번만 실제로 읽는다 */
let loaded = false;

/** 지금 목록. 읽기는 반응형이라 추가·삭제가 곧바로 화면에 닿는다 */
export function snippets(): readonly Snippet[] {
  return snippetList;
}

/** id 로 하나 찾기 (없으면 `undefined`) */
export function findSnippet(id: string): Snippet | undefined {
  return snippetList.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// 파일
// ---------------------------------------------------------------------------

/**
 * 저장된 목록을 읽는다 — **창당 한 번**. 실패하면 빈 목록으로 시작한다.
 *
 * 부르는 자리는 부팅 경로 하나다 (`app/boot.svelte.ts` 의 `loadThemeProfiles` 옆). 팔레트가
 * 열리자마자 이 목록을 훑으므로, 읽기가 부팅에 있어야 첫 팔레트에서 스니펫이 비어 보이지
 * 않는다.
 */
export async function loadSnippets(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const file = parseSnippets(await invoke<string | null>("load_snippets"));
    if (!file) return;
    snippetList = file.snippets;
    // 방금 읽은 것이 곧 "파일에 있는 것" 이다 — 복원 직후에 같은 내용을 다시 쓰지 않는다.
    lastJson = JSON.stringify(serializeSnippets(snippetList));
  } catch {
    // 명령이 없거나 못 읽는 환경 — 스니펫 없이 시작한다.
  }
}

/** 자동 저장 디바운스 (ms) — 여기 변경은 전부 사람이 누른 결과다  */
const SAVE_DEBOUNCE_MS = 200;

let lastJson: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function persist(): void {
  const json = JSON.stringify(serializeSnippets(snippetList));
  if (json === lastJson) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    lastJson = json;
    void invoke("save_snippets", { json }).catch(() => {
      // 저장 실패는 조용히 넘긴다 — 다음 변경에서 다시 시도된다 (같은
      // 규칙). 이번 실행의 목록은 메모리에 그대로라 화면은 어긋나지 않는다.
      lastJson = null;
    });
  }, SAVE_DEBOUNCE_MS);
}

/**
 * 새 스니펫 id — 시각(36진)과 짧은 난수를 잇는다.
 *
 * 이 값은 **파일에 남아 다음 실행에서도 같은 스니펫을 가리켜야** 하므로 창 카운터
 * (`pane-N`)를 쓸 수 없다 (`theme-profiles.svelte.ts`의 id 와 같은 이유).
 */
function nextId(): string {
  return `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// 조작
// ---------------------------------------------------------------------------

/** [`addSnippet`] 이 받는 것 — id 는 여기서 붙인다 */
export interface NewSnippet {
  name: string;
  command: string;
  description?: string;
  scope: SnippetScope;
  enter: boolean;
}

/**
 * 스니펫 하나를 만든다 — 이름이나 명령이 비면 `null`(아무 일도 없다).
 *
 * **이름의 유일성을 요구하지 않는다.** 레이아웃·테마 프로필은 이름이 곧 덮어쓰기 판정이라
 * 유일해야 했지만, 스니펫은 사람이 목록에서 골라 누르는 물건이고 "web 재시작" 이 서버마다
 * 하나씩 있는 것이 자연스럽다 (범위가 다르면 같은 이름이 오히려 읽기 좋다).
 */
export function addSnippet(input: NewSnippet): Snippet | null {
  const name = input.name.trim().slice(0, MAX_SNIPPET_NAME);
  const command = input.command.trim().slice(0, MAX_SNIPPET_COMMAND);
  if (name === "" || command === "") return null;
  const description = (input.description ?? "").trim().slice(0, MAX_SNIPPET_DESCRIPTION);
  const made: Snippet = {
    id: nextId(),
    name,
    command,
    ...(description === "" ? {} : { description }),
    scope: input.scope,
    enter: input.enter,
  };
  snippetList = withSnippet(snippetList, made);
  persist();
  return made;
}

/**
 * 한 줄을 **제자리에서** 고친다 (목록 순서는 그대로 — `updateSnippet` 주석).
 * 없는 id 거나 이름·명령이 비면 아무 일도 없다 (`false`).
 */
export function editSnippet(id: string, patch: SnippetPatch): boolean {
  const next = updateInList(snippetList, id, patch);
  if (!next) return false;
  snippetList = next;
  persist();
  return true;
}

/**
 * 호스트 별칭이 바뀌었다 — 그 별칭으로 범위가 묶인 스니펫들을 새 이름으로 옮긴다.
 * 바꿀 줄이 없으면 파일도 건드리지 않는다 ([`withRenamedHostScope`] 가 `null`).
 *
 * 부르는 자리는 이름 변경 팬아웃 하나다 (`app/host-rename.svelte.ts`).
 */
export function renameSnippetHost(from: string, to: string): boolean {
  const next = withRenamedHostScope(snippetList, from, to);
  if (!next) return false;
  snippetList = next;
  persist();
  return true;
}

/** 이 스니펫이 가리키는 호스트 별칭 (전역 범위면 `null`) — 아래 두 함수가 나눠 쓰는 열쇠 */
const scopeAlias = (s: Snippet): string | null => (s.scope.kind === "host" ? s.scope.alias : null);

/**
 * 이 별칭들로 범위가 묶인 스니펫이 **몇 줄인가** — 호스트 제거 확인 문구가 읽는 값이다
 * (목록은 건드리지 않는다).
 */
export function countHostSnippets(aliases: readonly string[]): number {
  return countAliased(snippetList, scopeAlias, aliasKeySet(aliases));
}

/**
 * 호스트를 지웠다 — 그 별칭으로 범위가 묶인 스니펫을 **함께 지운다**
 * (docs/log/2026-09-17-host-remove-fanout.md). 지운 줄이 없으면 파일도 건드리지 않는다.
 *
 * 이름 변경([`renameSnippetHost`])과 반대인 이유는 하나다: 이름이 갈린 스니펫은 **가리키던
 * 것이 그대로 있고** 글자만 어긋난 것이라 따라가면 되지만, 호스트가 사라지면 그 줄은 어느
 * 타일에서도 다시 뜨지 않는다 — 목록에만 남아 자리를 차지한다.
 *
 * 부르는 자리는 제거 팬아웃 하나다 (`app/host-remove.ts`). 여기서 `askConfirm()` 로 되묻지 않는
 * 것은 그 팬아웃이 이미 **한 번의 결정**(제거 확인)에 묶여 있기 때문이다.
 */
export function removeHostSnippets(aliases: readonly string[]): number {
  const before = snippetList.length;
  const next = withoutAliased(snippetList, scopeAlias, aliasKeySet(aliases));
  if (next === snippetList) return 0;
  snippetList = [...next];
  persist();
  return before - snippetList.length;
}

/**
 * 스니펫 하나를 지운다 — 되돌릴 수 없으므로 먼저 묻는다 (레이아웃·테마 프로필과 같은 `ask`).
 * 확인 창을 못 띄우면 **아무것도 지우지 않는다**.
 */
export async function deleteSnippet(id: string): Promise<boolean> {
  const snippet = findSnippet(id);
  if (!snippet) return false;
  let go = false;
  try {
    go = await askConfirm(t("commands.snippet.delete.ask", { name: snippet.name }), {
      title: t("commands.snippet.delete.title"),
      kind: "warning",
      danger: true,
    });
  } catch {
    return false; // 확인 창을 못 열면 아무것도 지우지 않는다
  }
  if (!go) return false;
  snippetList = withoutSnippet(snippetList, id);
  persist();
  return true;
}
