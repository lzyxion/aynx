/** 대화 제목은 사용자 글자일 수 있어(첫 프롬프트) 화면으로만 넘긴다 — 저장하지 않는다 */
import { flatConversations, pathKey, type AgentConversation, type ConversationList } from "$lib/agent-sessions";
import { listPanes, type PaneSpec, type TabSpec } from "$lib/session";

export const START_ROWS_INITIAL = 5;

/** `[projects] start_screen` */
export type StartScreenMode = "auto" | "off";

/** 시작 폴더가 같은 것만(하위 폴더는 아니다) — 묶음 · 기타를 가리지 않는다: 워크트리를 아직 안 읽었으면 그 대화는 "기타" 에 있다 */
export function conversationsInFolder(list: ConversationList | null, folder: string): AgentConversation[] {
  const k = pathKey(folder);
  if (k === "") return [];
  return flatConversations(list).filter((s) => pathKey(s.cwd) === k);
}

export function shouldShowStartScreen(mode: StartScreenMode): boolean {
  return mode === "auto";
}

// ── 새로 시작 — 글자 키 ──

export type StartAction = { kind: "shell" } | { kind: "ai"; id: string; command: string; name: string };

/** 표에 없는 AI CLI 는 글자가 없다 — 지어낸 글자가 다음 CLI 의 글자와 부딪치지 않게 */
export const START_KEYS = {
  shell: "KeyS",
  claude: "KeyC",
  codex: "KeyX",
} as const;

export function startKeyOf(a: StartAction): string | null {
  if (a.kind === "shell") return START_KEYS.shell;
  return a.id === "claude" ? START_KEYS.claude : a.id === "codex" ? START_KEYS.codex : null;
}

export function defaultStartAction(actions: readonly StartAction[], agent: string | null): StartAction | null {
  if (agent) {
    const hit = actions.find((a) => a.kind === "ai" && a.id === agent);
    if (hit) return hit;
  }
  return actions.find((a) => a.kind === "shell") ?? actions[0] ?? null;
}

export function keyLetter(code: string): string {
  return code.startsWith("Key") ? code.slice(3) : code;
}

export interface StartKeyEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  key?: string;
}

/** 수식 없는 글자 하나일 때만(Shift 도 아니다) — `Ctrl+Shift+X` 같은 전역 조합이 흘러가야 한다 */
export function startActionForKey(ev: StartKeyEvent, actions: readonly StartAction[]): StartAction | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return null;
  if (ev.isComposing || ev.key === "Process") return null;
  return actions.find((a) => startKeyOf(a) === ev.code) ?? null;
}

/** 밖에서 열린 대화는 처음 고르지 않는다 — Enter 한 번에 같은 대화를 두 곳에서 잇게 된다 */
export function defaultStartIndex(elsewhere: readonly boolean[]): number {
  return elsewhere.findIndex((b) => !b);
}

export function moveStartSelection(len: number, at: number, dir: "up" | "down"): number {
  if (len <= 0) return -1;
  if (at < 0) return 0;
  const cur = Math.max(0, Math.min(len - 1, at));
  return dir === "up" ? Math.max(0, cur - 1) : Math.min(len - 1, cur + 1);
}

// ── 재개가 갈 자리 — 대시보드 "지난 대화" · 팔레트 `대화 ` ──

export type ConversationTarget =
  | { kind: "replace"; reason: "startScreen" | "launcher"; tabId: string; paneId: string }
  | { kind: "tab"; tabId: string }
  | { kind: "newTab" };

function activeFirst(tabs: readonly TabSpec[], activeTabId: string | null): TabSpec[] {
  const at = tabs.find((t) => t.id === activeTabId);
  return at ? [at, ...tabs.filter((t) => t !== at)] : [...tabs];
}

export function isStartScreenFor(pane: PaneSpec, folderKey: string): boolean {
  return (
    pane.kind === "start" && !!pane.startProject && !pane.startProject.host && pathKey(pane.startProject.folder) === folderKey
  );
}

/** 탭에 워크트리 표식이 없어 타일로 판정한다 — 다른 타일이 하나라도 섞이면 아니다(남의 작업판에 끼워 넣지 않는다) */
export function isWorktreeTab(tab: TabSpec, folderKey: string): boolean {
  const panes = listPanes(tab.root);
  return (
    panes.length > 0 &&
    panes.every(
      (p) =>
        (p.kind === "local" && typeof p.cwd === "string" && pathKey(p.cwd) === folderKey) ||
        isStartScreenFor(p, folderKey),
    )
  );
}

function isLauncherTab(tab: TabSpec): boolean {
  return tab.root.type === "leaf" && tab.root.pane.kind === "start" && !tab.root.pane.startProject;
}

export function conversationTarget(
  tabs: readonly TabSpec[],
  activeTabId: string | null,
  folder: string,
): ConversationTarget {
  const k = pathKey(folder);
  const order = activeFirst(tabs, activeTabId);
  if (k !== "") {
    for (const tab of order) {
      const start = listPanes(tab.root).find((p) => isStartScreenFor(p, k));
      if (start) return { kind: "replace", reason: "startScreen", tabId: tab.id, paneId: start.id };
    }
    const home = order.find((tab) => isWorktreeTab(tab, k));
    if (home) return { kind: "tab", tabId: home.id };
  }
  const active = tabs.find((t) => t.id === activeTabId);
  if (active && isLauncherTab(active) && active.root.type === "leaf") {
    return { kind: "replace", reason: "launcher", tabId: active.id, paneId: active.root.pane.id };
  }
  return { kind: "newTab" };
}
