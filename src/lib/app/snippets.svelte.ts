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
 * 스니펫을 터미널에 써 넣는 길 — 사람이 키보드로 친 것과 같은 `write_session` 이다. 나가는 글은 사람이 적어 둔 스니펫과
 * 그 자리에서 사람이 친 자리표시자 값뿐이다 — 새 실행 통로가 아니다.
 */

export function focusedHostAlias(): string | null {
  const pane = focusedPane();
  if (!pane || pane.kind !== "ssh") return null;
  const alias = pane.alias?.trim();
  return alias === "" ? null : (alias ?? null);
}

// ── 자리표시자 묻기 ──

interface PendingPrompt {
  title: string;
  fields: SnippetPlaceholder[];
  resolve: (values: Record<string, string> | null) => void;
}

const FOCUS_SNIPPET_PROMPT = "snippet-prompt";
const FOCUS_SNIPPET_SAVE = "snippet-save";

const prompt = $state<{ current: PendingPrompt | null; values: Record<string, string> }>({
  current: null,
  values: {},
});

/** `anyModalOpen()` 이 본다 — 열려 있는 동안 전역 단축키가 쉰다 */
export function snippetPromptOpen(): boolean {
  return prompt.current !== null;
}

export function snippetPrompt(): {
  title: string;
  fields: readonly SnippetPlaceholder[];
} | null {
  const cur = prompt.current;
  return cur ? { title: cur.title, fields: cur.fields } : null;
}

export function snippetPromptValue(name: string): string {
  return prompt.values[name] ?? "";
}

export function setSnippetPromptValue(name: string, value: string): void {
  prompt.values[name] = value;
}

/**
 * 어느 길로 닫히든 여기를 지나고 값 표를 곧바로 비운다 — 남기면 다음 스니펫의 같은 이름 칸이 미리 채워져, 사람이 친 적 없는 값이 서버로 간다.
 */
export function resolveSnippetPrompt(ok: boolean): void {
  const cur = prompt.current;
  if (!cur) return;
  const values = ok ? { ...prompt.values } : null;
  prompt.current = null;
  prompt.values = {};
  // 돌려주지 않으면 이어서 나가는 글자를 볼 곳에 커서가 없다
  returnFocus(FOCUS_SNIPPET_PROMPT);
  cur.resolve(values);
}

/** 이미 묻는 중이면 새 요청은 조용히 `null` — 쌓아 두었다 나중에 실행하지 않는다 */
function askPlaceholders(
  title: string,
  fields: readonly SnippetPlaceholder[],
): Promise<Record<string, string> | null> {
  if (prompt.current !== null) return Promise.resolve(null);
  rememberFocusOrigin(FOCUS_SNIPPET_PROMPT);
  return new Promise((resolve) => {
    prompt.values = defaultValuesOf(fields);
    prompt.current = { title, fields: [...fields], resolve };
  });
}

// ── 삽입 ──

/**
 * 순서에 뜻이 있다 — 타일 · 범위를 먼저 본다(다 물은 뒤 "쓸 데가 없다" 면 사람이 친 것이 버려진다). 범위는 목록이 걸렀어도 다시 본다:
 * 팔레트를 연 채 다른 타일을 누르면 db-01 용 명령이 web-01 로 나간다.
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
 * 인라인 제안용 — 돌려주는 값에는 `\r` 이 붙지 않는다. 치던 글자를 지우고 놓는 한 덩어리(`DEL × n` + 명령)라 실행은 사람이 Enter 로 정한다.
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

/** `snippetsForScope` 와 같은 규칙 */
function scopeAllows(snippet: Snippet, pane: PaneSpec): boolean {
  if (snippet.scope.kind === "all") return true;
  return pane.kind === "ssh" && pane.alias?.trim() === snippet.scope.alias;
}

// ── 저장 대화상자 ──

export interface SnippetSaveForm {
  /** `null` = SSH 가 아니다 — 그때 호스트 범위를 고르게 두면 아무 데서도 안 보이는 스니펫이 생긴다 */
  alias: string | null;
  name: string;
  command: string;
  description: string;
  /** `alias` 가 `null` 이면 언제나 거짓이다 */
  hostScope: boolean;
  enter: boolean;
}

const save = $state<{ open: boolean } & SnippetSaveForm>({
  open: false,
  alias: null,
  name: "",
  command: "",
  description: "",
  hostScope: false,
  enter: true,
});

/** `anyModalOpen()` 이 본다 */
export function snippetSaveOpen(): boolean {
  return save.open;
}

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

export function setSnippetSaveField(patch: Partial<SnippetSaveForm>): void {
  if (!save.open) return;
  if (patch.name !== undefined) save.name = patch.name;
  if (patch.command !== undefined) save.command = patch.command;
  if (patch.description !== undefined) save.description = patch.description;
  if (patch.hostScope !== undefined) save.hostScope = patch.hostScope && save.alias !== null;
  if (patch.enter !== undefined) save.enter = patch.enter;
}

/** 범위 기본은 언제나 "모든 호스트" — 좁은 기본은 다른 서버에서 왜 안 보이는지를 나중에야 알게 한다 */
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

export function cancelSnippetSave(): void {
  save.open = false;
  returnFocus(FOCUS_SNIPPET_SAVE);
}

/** 못 만들면 상자를 열어 둔 채 안내만 한다 — 조용히 닫으면 사람이 적은 것이 사라진다 */
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
