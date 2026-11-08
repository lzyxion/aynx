import { showNotice } from "$lib/app/notice";
import { hasSession, writeSessionById, type PaneSpec } from "$lib/session";
import { focusedPane } from "$lib/app/tabs.svelte.js";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { addSnippet, findSnippet } from "$lib/snippets.svelte.js";
import {
  defaultSnippetName,
  defaultValuesOf,
  placeholdersOf,
  renderSnippet,
  type Snippet,
  type SnippetPlaceholder,
  type SnippetScope,
} from "$lib/snippets";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **스니펫을 터미널에 써 넣는 길** (docs/log/2026-09-16-snippets.md).
 *
 * 목록·파일은 `snippets.svelte.ts` 가, 규칙은 순수 층(`snippets.ts`)이 쥔다. 여기 있는
 * 것은 "지금 포커스된 타일" 과 "그 타일의 세션 id" 를 알아야만 할 수 있는 일 둘뿐이다 —
 * **어느 별칭이 포커스인가**([`focusedHostAlias`], 범위 판정과 팔레트가 쓴다)와
 * **실제로 쓰기**([`insertSnippet`]).
 *
 * 2026-09-16 에 반대 방향이 하나 더 붙었다 — **이미 친 명령을 스니펫으로 남기는 길**
 * ([`openSnippetSave`] · 모달은 `SnippetSaveDialog.svelte`). 입구가 둘(터미널 우클릭 메뉴 ·
 * 팔레트의 저장 줄)이고 문은 하나다. 여기 사는 이유는 자리표시자 묻기와 같다: 화면 하나가
 * 창에 하나뿐이고, 그것을 여는 쪽이 여럿이다.
 *
 * ## 쓰는 길은 **여느 입력과 같다**
 *
 * `write_session`(로컬·SSH — 세션 서버) — 사람이 키보드로 친 것이 지나는 바로 그
 * 명령이다 (`tmux.ts` 의 `switchTmuxSession` 과 같은 판단). 앱이 "명령을 실행하는" 새
 * 통로를 여는 것이 아니다: 나가는 문자열은 사용자가 자기 손으로 적어 둔 것이고, 자리표시자
 * 값도 그 자리에서 사람이 친 것이다. 실행 여부(`\r`)까지 스니펫에 적혀 있다.
 *
 * ## 자리표시자를 묻는 화면
 *
 * 앱의 프롬프트 한 벌(`app/prompts.svelte.ts`)은 **접속 중에 백엔드가 되묻는 것**들이라
 * 대기열·우선순위가 그 사정에 맞춰져 있다. 스니펫은 사람이 먼저 누른 조작이고 한 번에
 * 하나뿐이라 그 사슬에 낄 이유가 없다 — 대신 같은 모양의 **약속 한 칸**을 여기 둔다
 * (열려 있는 동안 두 번째 요청은 조용히 취소된다).
 */

// ---------------------------------------------------------------------------
// 지금 포커스된 타일
// ---------------------------------------------------------------------------

/**
 * 포커스된 타일이 SSH 세션이면 그 **별칭**, 아니면 `null`.
 *
 * 범위 판정(`snippetsForScope`)과 팔레트 목록이 이 값 하나를 받는다. 로컬 셸·파일·설정
 * 타일은 전부 `null` 이다 — 그 자리에는 "어느 서버" 라는 물음 자체가 없다.
 */
export function focusedHostAlias(): string | null {
  const pane = focusedPane();
  if (!pane || pane.kind !== "ssh") return null;
  const alias = pane.alias?.trim();
  return alias === "" ? null : (alias ?? null);
}

// ---------------------------------------------------------------------------
// 자리표시자 묻기 — 약속 한 칸 (모달은 `SnippetPrompt.svelte`)
// ---------------------------------------------------------------------------

interface PendingPrompt {
  /** 화면에 띄울 스니펫 이름 (어느 스니펫에 답하는 중인지) */
  title: string;
  /** 물어볼 칸들 — 명령에 나온 순서 그대로 (`placeholdersOf`) */
  fields: SnippetPlaceholder[];
  resolve: (values: Record<string, string> | null) => void;
}

/**
 * 지금 묻고 있는 것 (`null` = 안 묻는 중).
 *
 * `$state` 객체 한 칸에 모으는 이유는 룬 모듈이 재대입되는 `$state` 를 export 할 수 없기
 * 때문이다 (`app/prompts.svelte.ts` 의 `pw` 와 같은 모양) — 필드 대입은 그대로 반응하므로
 * 모달의 `bind:` 가 아무 손해 없이 붙는다.
 */
/** 포커스 복귀 이름표 둘 (`app/focus-return`) — 둘 다 닫히면 치던 타일로 키보드가 돌아간다 */
const FOCUS_SNIPPET_PROMPT = "snippet-prompt";
const FOCUS_SNIPPET_SAVE = "snippet-save";

const prompt = $state<{ current: PendingPrompt | null; values: Record<string, string> }>({
  current: null,
  values: {},
});

/** 모달이 떠 있는가 — `anyModalOpen()` 이 이 값을 본다 (전역 단축키가 쉰다) */
export function snippetPromptOpen(): boolean {
  return prompt.current !== null;
}

/** 모달이 그리는 것: 제목과 칸들 (`null` = 닫혀 있다) */
export function snippetPrompt(): {
  title: string;
  fields: readonly SnippetPlaceholder[];
} | null {
  const cur = prompt.current;
  return cur ? { title: cur.title, fields: cur.fields } : null;
}

/** 칸 하나의 지금 값 (아직 안 쳤으면 빈 문자열) */
export function snippetPromptValue(name: string): string {
  return prompt.values[name] ?? "";
}

/** 칸 하나를 고친다 (모달의 `oninput`) */
export function setSnippetPromptValue(name: string, value: string): void {
  prompt.values[name] = value;
}

/**
 * 답한다 — `null` 이면 **취소**(삽입 자체가 중단된다).
 *
 * 어느 경로로 닫히든(확인·취소·Escape) 여기를 지나고, 값 표는 곧바로 비운다: 다음 스니펫이
 * 같은 이름의 칸을 물을 때 앞의 답이 미리 채워져 있으면 사용자는 자기가 친 적 없는 값을
 * 서버로 보낸다.
 */
export function resolveSnippetPrompt(ok: boolean): void {
  const cur = prompt.current;
  if (!cur) return;
  const values = ok ? { ...prompt.values } : null;
  prompt.current = null;
  prompt.values = {};
  // 확인이든 취소든 키보드는 치던 타일로 돌아간다 (`app/focus-return`). 확인 쪽은 이어서
  // 글자가 그 터미널로 나가므로 **돌려주지 않으면 그 글자를 볼 곳에 커서가 없다**.
  returnFocus(FOCUS_SNIPPET_PROMPT);
  cur.resolve(values);
}

/**
 * 칸들을 물어 값 표를 얻는다 — 취소면 `null`.
 *
 * 이미 묻는 중이면 **새 요청을 조용히 거절한다**(`null`). 모달 두 장이 겹치면 어느
 * 스니펫에 답하는 중인지 알 수 없고, 스니펫 삽입은 사람이 방금 누른 조작이라 큐에 쌓아
 * 두었다가 나중에 실행하는 것이 오히려 놀랍다.
 */
function askPlaceholders(
  title: string,
  fields: readonly SnippetPlaceholder[],
): Promise<Record<string, string> | null> {
  if (prompt.current !== null) return Promise.resolve(null);
  rememberFocusOrigin(FOCUS_SNIPPET_PROMPT);
  return new Promise((resolve) => {
    // 기본값이 적힌 칸은 **미리 채운 채로** 연다 (`{{경로=/var}}`) — 확인만 누르면 그
    // 값이 나가고, 다른 값이 필요할 때만 고쳐 친다.
    prompt.values = defaultValuesOf(fields);
    prompt.current = { title, fields: [...fields], resolve };
  });
}

// ---------------------------------------------------------------------------
// 삽입
// ---------------------------------------------------------------------------

/**
 * **스니펫 하나를 포커스된 터미널에 써 넣는다** — 설정의 [삽입] · 단축키 · 팔레트의 공통 몸통.
 *
 * 순서에 뜻이 있다.
 *
 * 1. **타일부터 본다.** 터미널(로컬·SSH)이 아니면 안내 한 줄로 끝난다 — 자리표시자를 다
 *    물어본 뒤에 "쓸 데가 없다" 고 말하면 사람이 친 것이 통째로 버려진다.
 * 2. **범위를 본다.** 호스트 스니펫은 그 별칭의 타일에서만 나간다. 목록이 이미 걸러져
 *    있지만(`snippetsForScope`) 여기서 한 번 더 보는 이유는 **포커스가 그 사이에 옮겨 갈
 *    수 있기** 때문이다 — 팔레트를 열어 둔 채 다른 타일을 클릭하면 db-01 용 명령이 web-01
 *    로 나간다.
 * 3. **자리표시자를 묻는다.** 취소면 아무것도 쓰지 않는다.
 * 4. **세션을 다시 확인하고 쓴다.** 3번에 `await` 가 있어 그 사이 타일이 닫히거나 세션이
 *    끊겼을 수 있다 — 그때는 조용히 안내만 한다.
 *
 * 화면에 **아무것도 메아리치지 않는다**: 터미널에 들어간 글자는 셸이 스스로 그린다.
 */
export async function insertSnippet(id: string): Promise<void> {
  const snippet = findSnippet(id);
  if (!snippet) {
    showNotice(t("commands.snippet.notice.notFound"));
    return;
  }

  const pane = focusedPane();
  if (!pane || !hasSession(pane.kind)) {
    showNotice(t("commands.keys.terminalRequired"));
    return;
  }

  if (!scopeAllows(snippet, pane)) {
    const alias = snippet.scope.kind === "host" ? snippet.scope.alias : "";
    showNotice(t("commands.snippet.notice.hostOnly", { name: snippet.name, alias }));
    return;
  }

  const fields = placeholdersOf(snippet.command);
  let values: Record<string, string> = {};
  if (fields.length > 0) {
    const answered = await askPlaceholders(snippet.name, fields);
    if (!answered) return; // 취소 — 아무것도 쓰지 않는다
    values = answered;
  }

  // 여기서 **다시** 읽는다 — 위 `await` 동안 타일이 닫히거나 포커스가 옮겨 갔을 수 있다.
  const target = focusedPane();
  if (!target || target.id !== pane.id || !hasSession(target.kind)) {
    showNotice(t("commands.snippet.notice.tileChanged"));
    return;
  }
  const sessionId = sessionOf(target.id);
  if (sessionId === null) {
    showNotice(t("commands.snippet.notice.notConnected"));
    return;
  }

  const data = renderSnippet(snippet.command, values) + (snippet.enter ? "\r" : "");
  try {
    // 로컬은 이 창 손잡이의 임대를 싣는다(세션 코어 — `writeSessionById`).
    await writeSessionById(target.kind, sessionId, data);
  } catch (e) {
    showNotice(
      t("commands.snippet.notice.sendFailed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}

/**
 * 스니펫 하나를 **글자로만** 푼다 — 자리표시자를 묻고 렌더한 명령을 돌려준다.
 * 없는 id 거나 사람이 취소하면 `null`(아무 일도 없다).
 *
 * [`insertSnippet`] 과 나눠 둔 이유는 **끝이 다르기** 때문이다. 저쪽은 "포커스된 터미널에
 * 지금 보낸다" 까지가 한 몸이라 타일·세션·`enter`(`\r`)를 전부 자기가 정하지만, 인라인
 * 제안(docs/log/2026-09-16-snippets.md 의 "입력 중 제안")은 **치던 글자를 지우고 그 자리에
 * 놓는** 조작이라 나가는 바이트가 한 덩어리여야 하고(`DEL × n` + 명령), 실행 여부는
 * 사람이 Enter 로 정한다. 그래서 여기서 돌려주는 값에는 **`\r` 이 붙지 않는다** — 붙일지
 * 말지를 부르는 쪽이 정하는 것이 아니라, 이 길에는 붙일 자리가 없다는 뜻이다.
 *
 * 묻는 화면은 [`insertSnippet`] 과 **같은 한 칸**을 쓴다 (모달이 창에 하나뿐이다).
 */
export async function snippetInsertText(id: string): Promise<string | null> {
  const snippet = findSnippet(id);
  if (!snippet) return null;
  const fields = placeholdersOf(snippet.command);
  let values: Record<string, string> = {};
  if (fields.length > 0) {
    const answered = await askPlaceholders(snippet.name, fields);
    if (!answered) return null; // 취소 — 아무것도 쓰지 않는다
    values = answered;
  }
  return renderSnippet(snippet.command, values);
}

/** 이 타일에서 그 스니펫이 뜻이 있는가 (`snippetsForScope` 와 **같은 규칙**의 한 줄판) */
function scopeAllows(snippet: Snippet, pane: PaneSpec): boolean {
  if (snippet.scope.kind === "all") return true;
  return pane.kind === "ssh" && pane.alias?.trim() === snippet.scope.alias;
}

// ---------------------------------------------------------------------------
// 저장 대화상자 — 약속이 아니라 **한 칸** (모달은 `SnippetSaveDialog.svelte`)
//
// 자리표시자 묻기([`askPlaceholders`])와 모양은 같지만 **약속(Promise)이 아니다**: 저쪽은
// 삽입이라는 한 줄기 안에서 "답을 받아 계속 가는" 중간 단계라 부르는 쪽이 결과를 기다려야
// 하지만, 이쪽은 저장하면 그것으로 끝이다 (연 사람에게 돌려줄 값이 없다). 그래서 여는
// 함수는 `void` 고, 끝내는 길은 [`commitSnippetSave`]·[`cancelSnippetSave`] 둘이다.
// ---------------------------------------------------------------------------

/** [`snippetSaveForm`] 이 돌려주는 것 — 모달이 그리는 칸 전부 */
export interface SnippetSaveForm {
  /**
   * 이 타일의 SSH 별칭 (`null` = SSH 가 아니다).
   *
   * **"이 호스트" 선택지는 이 값이 있을 때만 선다.** 별칭이 없는 자리(로컬 셸)에서 호스트
   * 범위를 고르게 두면 만들자마자 아무 데서도 안 보이는 스니펫이 생긴다
   * (`snippetsForScope` — 별칭이 `null` 이면 호스트 스니펫은 절대 걸리지 않는다).
   */
  alias: string | null;
  name: string;
  command: string;
  description: string;
  /** 참 = 이 호스트(`alias`), 거짓 = 모든 호스트. [`alias`] 가 `null` 이면 언제나 거짓이다 */
  hostScope: boolean;
  enter: boolean;
}

/**
 * 지금 쓰고 있는 저장 폼 (`open` 이 거짓이면 닫혀 있다).
 *
 * `$state` 객체 한 칸인 이유는 [`prompt`] 와 같다 — 룬 모듈은 재대입되는 `$state` 를
 * export 할 수 없고, 필드 대입은 그대로 반응한다.
 */
const save = $state<{ open: boolean } & SnippetSaveForm>({
  open: false,
  alias: null,
  name: "",
  command: "",
  description: "",
  hostScope: false,
  enter: true,
});

/** 모달이 떠 있는가 — `anyModalOpen()` 이 이 값을 본다 (전역 단축키가 쉰다) */
export function snippetSaveOpen(): boolean {
  return save.open;
}

/** 모달이 그리는 것 (`null` = 닫혀 있다) */
export function snippetSaveForm(): SnippetSaveForm | null {
  if (!save.open) return null;
  return {
    alias: save.alias,
    name: save.name,
    command: save.command,
    description: save.description,
    hostScope: save.hostScope,
    enter: save.enter,
  };
}

/** 칸 하나(또는 여럿)를 고친다 — 모달의 `oninput`·토글이 부른다 */
export function setSnippetSaveField(patch: Partial<SnippetSaveForm>): void {
  if (!save.open) return;
  if (patch.name !== undefined) save.name = patch.name;
  if (patch.command !== undefined) save.command = patch.command;
  if (patch.description !== undefined) save.description = patch.description;
  // 별칭이 없으면 호스트 범위는 고를 수 없다 (위 [`SnippetSaveForm.alias`]).
  if (patch.hostScope !== undefined) save.hostScope = patch.hostScope && save.alias !== null;
  if (patch.enter !== undefined) save.enter = patch.enter;
}

/**
 * **저장 대화상자를 연다** — 터미널 우클릭의 "스니펫으로 저장" 과 팔레트의 저장 줄이
 * 함께 쓰는 문 하나다 (docs/log/2026-09-16-snippets.md).
 *
 * 기본값에 뜻이 있다.
 *
 * - **이름**은 명령에서 지어낸다 (`defaultSnippetName` — 앞 30자를 낱말 경계에서). 빈 칸을
 *   내밀면 사람이 이름부터 고민하게 되는데, 대개 원하는 것은 "방금 그 명령" 을 그대로 남기는
 *   것이다.
 * - **범위**는 언제나 "모든 호스트" 다. 좁은 쪽을 기본으로 두면 다른 서버에서 왜 안 보이는지를
 *   나중에 알게 된다 — 넓은 기본값은 그 자리에서 눈에 띄고 고치기도 쉽다.
 * - **Enter 로 실행**은 켜 둔다 (`Snippet.enter` 의 기본과 같은 이유 — 대개 곧바로 실행하려고
 *   저장한다).
 *
 * 이미 열려 있으면 **내용을 갈아 끼운다**: 사람이 방금 누른 조작이 창 하나에 밀려 아무 일도
 * 안 일어나는 것보다, 가장 최근에 겨눈 명령이 상자에 들어 있는 편이 놀랍지 않다.
 */
export function openSnippetSave(command: string, alias: string | null = null): void {
  const text = typeof command === "string" ? command.trim() : "";
  if (text === "") {
    showNotice(t("commands.snippet.notice.noCommand"));
    return;
  }
  if (!save.open) rememberFocusOrigin(FOCUS_SNIPPET_SAVE);
  const a = alias?.trim();
  save.alias = a === undefined || a === "" ? null : a;
  save.name = defaultSnippetName(text);
  save.command = text;
  save.description = "";
  save.hostScope = false;
  save.enter = true;
  save.open = true;
}

/** 닫는다 — 아무것도 저장하지 않는다 (취소·Escape·백드롭) */
export function cancelSnippetSave(): void {
  save.open = false;
  returnFocus(FOCUS_SNIPPET_SAVE);
}

/**
 * 폼을 저장한다. 이름·명령 중 하나라도 비면 **상자를 열어 둔 채** 안내만 한다 —
 * 조용히 닫으면 사람이 적은 것이 사라지고 왜 안 됐는지도 남지 않는다.
 *
 * 만드는 일 자체는 설정 › 스니펫과 **같은 함수**다 (`addSnippet` — 다듬기·상한·중복 id 가
 * 한 벌뿐이어야 입구마다 규칙이 갈리지 않는다).
 */
export function commitSnippetSave(): void {
  if (!save.open) return;
  const scope: SnippetScope =
    save.hostScope && save.alias !== null ? { kind: "host", alias: save.alias } : { kind: "all" };
  const made = addSnippet({
    name: save.name,
    command: save.command,
    description: save.description,
    scope,
    enter: save.enter,
  });
  if (!made) {
    showNotice(t("commands.snippet.notice.incomplete"));
    return;
  }
  save.open = false;
  returnFocus(FOCUS_SNIPPET_SAVE);
  showNotice(t("commands.snippet.notice.saved", { name: made.name }));
}
