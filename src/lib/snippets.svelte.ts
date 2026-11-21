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
 * 스니펫 목록(창에 하나)과 `snippets.json` 왕복. 터미널에 써 넣는 일은 `app/snippets.svelte.ts` 에 산다 — 여기서 `app/` 을 부르면 의존 방향이 거꾸로 선다.
 * 실패는 삼킨다 — 편의 기능의 파일 하나 때문에 부팅을 막지 않는다.
 */

/** 최신순 (맨 앞이 가장 최근에 저장한 것) */
let snippetList = $state<Snippet[]>([]);
let loaded = false;

export function snippets(): readonly Snippet[] {
  return snippetList;
}

export function findSnippet(id: string): Snippet | undefined {
  return snippetList.find((s) => s.id === id);
}

// ── 파일 ──

/** 부팅에서 읽어야 첫 팔레트에서 스니펫이 비어 보이지 않는다 */
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
      // 다음 변경에서 다시 시도된다
      lastJson = null;
    });
  }, SAVE_DEBOUNCE_MS);
}

/** 파일에 남아 다음 실행에서도 같은 스니펫을 가리켜야 해 창 카운터(`pane-N`)를 쓸 수 없다 */
function nextId(): string {
  return `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── 조작 ──

export interface NewSnippet {
  name: string;
  command: string;
  description?: string;
  scope: SnippetScope;
  enter: boolean;
}

/** 이름의 유일성을 요구하지 않는다 — 같은 이름이 범위마다 하나씩 있는 것이 자연스럽다 */
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

export function editSnippet(id: string, patch: SnippetPatch): boolean {
  const next = updateInList(snippetList, id, patch);
  if (!next) return false;
  snippetList = next;
  persist();
  return true;
}

export function renameSnippetHost(from: string, to: string): boolean {
  const next = withRenamedHostScope(snippetList, from, to);
  if (!next) return false;
  snippetList = next;
  persist();
  return true;
}

const scopeAlias = (s: Snippet): string | null => (s.scope.kind === "host" ? s.scope.alias : null);

export function countHostSnippets(aliases: readonly string[]): number {
  return countAliased(snippetList, scopeAlias, aliasKeySet(aliases));
}

/** 여기서 되묻지 않는다 — 제거 팬아웃(`app/host-remove.ts`)이 이미 한 번의 제거 확인에 묶여 있다 */
export function removeHostSnippets(aliases: readonly string[]): number {
  const before = snippetList.length;
  const next = withoutAliased(snippetList, scopeAlias, aliasKeySet(aliases));
  if (next === snippetList) return 0;
  snippetList = [...next];
  persist();
  return before - snippetList.length;
}

/** 확인 창을 못 띄우면 아무것도 지우지 않는다 */
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
    return false;
  }
  if (!go) return false;
  snippetList = withoutSnippet(snippetList, id);
  persist();
  return true;
}
