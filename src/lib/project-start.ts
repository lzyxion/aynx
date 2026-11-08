/**
 * **프로젝트 시작 화면**의 규칙 — 순수 모듈 (docs/log/2026-09-26-project-start-screen.md).
 *
 * 로컬 프로젝트·워크트리를 열면(설정 `auto` — 2026-09-27 부터는 지난 대화가 없는 폴더도) 새 타일은 셸이 아니라 이
 * 화면이다: 위에 "새로 시작"(기본 셸 · AI CLI — 프로젝트의 에이전트가 기본 선택, 2026-09-28), 아래에 "지난 대화 · 이 워크트리"(재개 · 새 대화로
 * 계속). 무엇을 고르든 **그 타일 자리에서** 결과 타일로 바뀐다. 그림은 `ProjectStart.svelte`, 저장소는
 * `app/agent-sessions.svelte.ts` 이고, 여기는 테스트가 닿는 규칙 — 어느 대화를 몇 줄 세우나 · 어느 글자가
 * 무엇을 여나 · 대시보드의 재개가 **어느 탭**으로 가나 — 만 둔다(vitest 는 `.svelte` 를 못 읽는다).
 *
 * 대화 제목은 사용자 글자일 수 있어(첫 프롬프트) 이 모듈도 화면으로만 넘긴다 — 저장하지 않는다.
 */
import { flatConversations, pathKey, type AgentConversation, type ConversationList } from "$lib/agent-sessions";
import { listPanes, type PaneSpec, type TabSpec } from "$lib/session";

/** 처음 보이는 지난 대화 줄 수 — 나머지는 "N개 더 보기"(그 자리에서 펼친다) */
export const START_ROWS_INITIAL = 5;

/** `[projects] start_screen` — `auto`(기본: 로컬 프로젝트·워크트리를 열면 늘 선다) · `off`(늘 곧장 셸) */
export type StartScreenMode = "auto" | "off";

/**
 * **이 폴더에서 시작한** 대화 — 기록된 시작 폴더가 그 폴더와 **같은** 것만(하위 폴더에서 시작한 것은
 * 아니다), 최신순, 같은 대화는 한 번. 비교는 1단계 목록과 같은 `pathKey`(구분자 · 끝 구분자 · Windows 꼴이면
 * 소문자). 묶음·기타를 가리지 않고 훑는다 — 워크트리를 아직 안 읽어 등록 경로에 없으면 그 대화는 "기타"
 * 에 들어 있다.
 */
export function conversationsInFolder(list: ConversationList | null, folder: string): AgentConversation[] {
  const k = pathKey(folder);
  if (k === "") return [];
  return flatConversations(list).filter((s) => pathKey(s.cwd) === k);
}

/**
 * 로컬 프로젝트·워크트리를 열 때 시작 화면이 서는가 — 설정이 `auto` 이면 **늘**(2026-09-27 — 지난 대화가 아직 없는
 * 폴더도. 새로 만든 워크트리처럼 대화가 없는 폴더에서도 같은 자리에서 셸 · AI · 시작 명령을 고르고, 다른 워크트리의
 * 대화를 "이 프로젝트 전체" 로 불러올 수 있게). 예전 규칙(그 폴더에 대화가 있을 때만)은
 * docs/log/2026-09-26-project-start-screen.md, 바꾼 까닭은 docs/log/2026-09-27-folder-conversations.md.
 * 원격 프로젝트도 같은 판정을 지난다(2026-09-27 — 그 서버의 대화를 붙은 세션으로 읽는다: docs/log/2026-09-27-remote-conversations.md).
 */
export function shouldShowStartScreen(mode: StartScreenMode): boolean {
  return mode === "auto";
}

// ---------------------------------------------------------------------------
// 새로 시작 — 글자 키
// ---------------------------------------------------------------------------

/**
 * "새로 시작" 의 단추 하나. `ai` 는 상태바 `>_` 메뉴가 내놓는 AI CLI 줄(`offeredAiClis`)과 같은 것이다.
 * (2026-09-28 — "시작 명령" 단추(R)는 없어졌다: 프로젝트의 시작 명령이 에이전트 선택으로 바뀌었다 ·
 * docs/log/2026-09-28-project-agent-setup-script.md.)
 */
export type StartAction = { kind: "shell" } | { kind: "ai"; id: string; command: string; name: string };

/**
 * 단추마다의 **글자 키**(물리 키 `ev.code`) — S = 셸 · C = Claude Code · X = Codex.
 * 서로 겹치지 않고, 이 화면의 다른 키(↑↓ · Enter · Shift+Enter)와도 겹치지 않는다. 표에 없는 AI CLI 는 글자가
 * 없다(단추로만 연다) — 지어낸 글자가 다음 CLI 의 글자와 부딪치지 않게.
 */
export const START_KEYS = {
  shell: "KeyS",
  claude: "KeyC",
  codex: "KeyX",
} as const;

/** 그 단추의 글자 키(`ev.code`) — 없으면 `null` */
export function startKeyOf(a: StartAction): string | null {
  if (a.kind === "shell") return START_KEYS.shell;
  return a.id === "claude" ? START_KEYS.claude : a.id === "codex" ? START_KEYS.codex : null;
}

/**
 * **기본 단추** — 프로젝트의 에이전트(`agent` — id)가 단추 줄에 있으면 그것, 없거나(`null` = 셸) 그 CLI 가 줄에
 * 없으면(설치되지 않았다) 셸. 지난 대화 줄을 고르지 않았을 때 포커스가 여기 서서 Enter 한 번이면 뜬다. 줄이 아직
 * 없으면 `null`.
 */
export function defaultStartAction(actions: readonly StartAction[], agent: string | null): StartAction | null {
  if (agent) {
    const hit = actions.find((a) => a.kind === "ai" && a.id === agent);
    if (hit) return hit;
  }
  return actions.find((a) => a.kind === "shell") ?? actions[0] ?? null;
}

/** 화면에 찍는 글자 — `KeyS` → `S` */
export function keyLetter(code: string): string {
  return code.startsWith("Key") ? code.slice(3) : code;
}

/** 이 판정이 보는 `KeyboardEvent` 의 칸들 */
export interface StartKeyEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  key?: string;
}

/**
 * 이 키가 여는 "새로 시작" 단추 — **수식 없는 글자 하나**일 때만(Shift 도 아니다 — `Ctrl+Shift+X` 같은 전역
 * 조합이 흘러가야 한다). IME 조합 중(`isComposing` · `Process`)은 아니다. 물리 키(`ev.code`)로 가르므로 한글
 * 자판이 켜져 있어도(ㄴ · ㅊ · ㅌ · ㄱ) 같은 단추가 열린다. 입력칸 안의 타자를 거르는 일은 부르는 쪽이다
 * (이 화면에는 입력칸이 없고, 키는 타일 안에서만 듣는다).
 */
export function startActionForKey(ev: StartKeyEvent, actions: readonly StartAction[]): StartAction | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return null;
  if (ev.isComposing || ev.key === "Process") return null;
  return actions.find((a) => startKeyOf(a) === ev.code) ?? null;
}

/**
 * 처음 골라 둘 줄 — **밖에서 열린 대화가 아닌** 가장 최근 줄(실기 ②: aynx 밖에서 도는 대화가 첫 줄로
 * 골라져 있어 Enter 한 번이면 같은 대화를 두 곳에서 잇게 됐다). 전부 그렇다면 `-1`(아무것도 고르지 않는다 — ↓ 가 첫 줄로).
 */
export function defaultStartIndex(elsewhere: readonly boolean[]): number {
  return elsewhere.findIndex((b) => !b);
}

/** ↑↓ 한 칸 — 감싸지 않는다(끝에서 더 가면 제자리). 줄이 없으면 `-1`, 고른 것이 없으면(`-1`) ↓ 는 첫 줄 */
export function moveStartSelection(len: number, at: number, dir: "up" | "down"): number {
  if (len <= 0) return -1;
  if (at < 0) return 0;
  const cur = Math.max(0, Math.min(len - 1, at));
  return dir === "up" ? Math.max(0, cur - 1) : Math.min(len - 1, cur + 1);
}

// ---------------------------------------------------------------------------
// 재개가 갈 자리 — 대시보드 "지난 대화" · 팔레트 `대화 `
// ---------------------------------------------------------------------------

/**
 * 재개 · 새 대화로 계속이 **어디에** 열리나.
 *
 * - `replace` — 그 타일 자리에서 갈아 끼운다. `reason` 이 `startScreen` 이면 같은 폴더의 프로젝트 시작 화면
 *   (그 탭의 제목은 이미 워크트리 이름이다), `launcher` 면 지금 탭이 빈 탭의 launcher 하나뿐인 것(탭 제목을
 *   범위 이름으로 고친다 — 새 탭과 같은 결과).
 * - `tab` — 그 워크트리의 탭에 타일을 하나 더한다(자동 배치).
 * - `newTab` — 새 탭(1단계의 길).
 */
export type ConversationTarget =
  | { kind: "replace"; reason: "startScreen" | "launcher"; tabId: string; paneId: string }
  | { kind: "tab"; tabId: string }
  | { kind: "newTab" };

/** 지금 탭을 먼저, 그다음 탭 바 순서 — 같은 조건의 탭이 여럿이면 보고 있는 탭이 이긴다 */
function activeFirst(tabs: readonly TabSpec[], activeTabId: string | null): TabSpec[] {
  const at = tabs.find((t) => t.id === activeTabId);
  return at ? [at, ...tabs.filter((t) => t !== at)] : [...tabs];
}

/** 그 폴더의 프로젝트 시작 화면인가 */
export function isStartScreenFor(pane: PaneSpec, folderKey: string): boolean {
  return (
    pane.kind === "start" && !!pane.startProject && !pane.startProject.host && pathKey(pane.startProject.folder) === folderKey
  );
}

/**
 * 이 탭이 **그 워크트리의 탭**인가 — 탭에 따로 붙은 표식이 없으므로(워크트리 탭은 제목 칸 하나뿐이다) 타일로
 * 판정한다: 모든 타일이 **그 폴더에서 시작한 로컬 셸**(프로젝트·워크트리·재개가 연 타일 — `cwd` 는 시작
 * 폴더다)이거나 그 폴더의 시작 화면이다. 설정·파일·다른 폴더의 타일이 하나라도 섞이면 아니다 — 남의 작업판에
 * 끼워 넣지 않는다.
 */
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

/** 빈 탭의 launcher 하나뿐인 탭인가 — 프로젝트 시작 화면은 아니다 */
function isLauncherTab(tab: TabSpec): boolean {
  return tab.root.type === "leaf" && tab.root.pane.kind === "start" && !tab.root.pane.startProject;
}

/**
 * **재개가 갈 자리** — 순서대로 처음 맞는 것 (docs/log/2026-09-26-project-start-screen.md "재개가 갈 자리"):
 *
 *  1. 같은 폴더의 **프로젝트 시작 화면**이 열려 있으면 그 자리(그 탭을 고른다).
 *  2. 그 **워크트리의 탭**([`isWorktreeTab`])이 있으면 그 탭에 타일 하나 더(자동 배치).
 *  3. **지금 탭이 빈 탭**(launcher 하나)이면 그 자리.
 *  4. 아니면 새 탭.
 *
 * 1·2 는 지금 탭을 먼저 본다. `folder` 는 대화의 **기록된 시작 폴더**(재개가 셸을 여는 폴더)다.
 */
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
