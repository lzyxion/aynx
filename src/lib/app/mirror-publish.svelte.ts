import { invoke } from "../ipc";
import { isMainWindow } from "$lib/app/window.svelte.js";
import { activeTabId, paneOf, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { currentWorkspace, workspaceList, type RuntimeWorkspace } from "$lib/app/workspaces.svelte.js";
import { agentKindOf, agentStatusOf } from "$lib/app/agent-status.svelte.js";
import { localReportedFolder, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { chipFolder } from "$lib/pane-chips";
import { buildSnapshot, type MirrorWorkspace, type PaneView } from "$lib/mirror/snapshot";
import { startBoardSnapshot } from "$lib/start-widgets.svelte.js";
import type { PaneSpec, TabSpec } from "$lib/session";

/**
 * **집 PC 주 창이 화면 배치를 올린다**(원격 웹 R2-B — 원격 창의 거울 출처 · `src-tauri/src/remote/mirror.rs`).
 *
 * `+page` 의 `$effect` 가 [`scheduleMirrorPublish`] 를 부른다 — 몸통이 **이 창의 모든 워크스페이스**(10-20 — 원격의 워크스페이스 칩)의
 * 탭 · 트리 · 포커스 · 워크스페이스 목록(이름 · 마지막 활성 탭 · cold 의 저장된 탭 수)을 읽어 스냅숏을 지으므로
 * (`$lib/mirror/snapshot` — 허용 칸만) 그중 무엇이 바뀌어도 효과가 다시 돈다. 100ms 디바운스(효과의 정리가 앞 타이머를 거둔다) 뒤 지난번과
 * 다를 때만 `mirror_publish` 를 부른다 — 원격이 없어도 올린다(작고 드물다 · 원격이 붙는 순간 바로 받게).
 *
 * **주 창만** — 보조 · 떼어 낸 창 · 원격 창은 아무것도 하지 않는다(GUI 도 `main` 말고는 거절한다). 워크스페이스가 서기 전(부팅 중)에는
 * 올리지 않는다(빈 화면을 원격에 비추지 않게).
 */

/** 디바운스(ms) — 분할선을 끄는 동안 비율이 초당 수십 번 바뀐다 */
export const MIRROR_PUBLISH_DEBOUNCE_MS = 100;

/** 마지막으로 올린 스냅숏(JSON) — 같은 것은 다시 보내지 않는다 */
let lastSent = "";

export function scheduleMirrorPublish(): (() => void) | undefined {
  if (!isMainWindow) return;
  const workspace = currentWorkspace();
  if (!workspace) return;
  const tabs = residentWindowTabs();
  const active = activeTabId();
  const snapshot = buildSnapshot({
    source: "home",
    workspace: { id: workspace.id, name: workspace.name },
    workspaces: workspaceList().map((w) => workspaceRow(w, w.id === workspace.id ? active : null, tabs)),
    tabs: tabs.filter((tab) => workspaceList().some((w) => w.id === tab.workspaceId && w.materialized)),
    activeTabId: activeTabId(),
    focusOf: (tab) => paneOf(tab),
    viewOf,
    // 시작 화면 한 벌 — 원격 창이 따른다. 반응형이라 놓는 순간 · 프로필을 입히는 순간에 스냅숏이 다시 지어진다
    startBoard: startBoardSnapshot(),
  });
  const json = JSON.stringify(snapshot);
  if (json === lastSent) return;
  const timer = setTimeout(() => {
    lastSent = json;
    void invoke("mirror_publish", { snapshot: JSON.parse(json) }).catch((e: unknown) => {
      lastSent = ""; // 다음 바뀜에 다시 보낸다
      console.warn("[aynx] 화면 배치를 원격에 알리지 못했습니다:", e);
    });
  }, MIRROR_PUBLISH_DEBOUNCE_MS);
  return () => clearTimeout(timer);
}

/**
 * 워크스페이스 한 줄 — 이번 실행에서 열린 것은 활성 탭(지금 것은 이 창의 활성 탭, 나머지는 기억한 마지막 활성 탭 · 없으면 첫 탭),
 * 아직 열지 않은 것(cold)은 저장된 주 창 탭 수만(탭 객체가 없다 — `workspaces.svelte.ts` 의 materialize).
 */
function workspaceRow(w: RuntimeWorkspace, currentActive: string | null, tabs: readonly TabSpec[]): MirrorWorkspace {
  const row: MirrorWorkspace = { id: w.id, name: w.name, activeTabId: null };
  if (w.icon) row.icon = w.icon;
  if (w.color) row.color = w.color;
  if (!w.materialized) {
    row.cold = true;
    row.tabCount = w.savedTabs.filter((tab) => tab.placement.kind === "main").length;
    return row;
  }
  const own = tabs.filter((tab) => tab.workspaceId === w.id);
  row.activeTabId =
    currentActive ?? own.find((tab) => tab.tabKey !== undefined && tab.tabKey === w.lastActive.tabKey)?.id ?? own[0]?.id ?? null;
  return row;
}

/**
 * 터미널 타일의 **보이는 모습**(원격 라벨 재료 — `$lib/mirror/snapshot` 의 `PaneView`) — 이 창의 머리줄 · 탭 바가 이미 그리는 것과 같은 출처:
 * 도는 AI(`agentKindOf`) · 에이전트 상태(`agentStatusOf`) · 폴더 칩의 기준 폴더(`chipFolder` — 거르는 쪽이 마지막 이름 한 토막만 남긴다).
 * 반응형이라 상태가 바뀌면 스냅숏이 다시 지어진다(같으면 보내지 않는다).
 */
function viewOf(pane: PaneSpec): PaneView | null {
  if (pane.kind !== "local" && pane.kind !== "ssh") return null;
  const ai = agentKindOf(pane);
  const view: PaneView = {};
  if (ai === "claude" || ai === "codex") view.ai = ai;
  const agent = agentStatusOf(pane);
  if (agent) view.agent = agent;
  const folder = chipFolder({
    reported: pane.kind === "local" ? localReportedFolder(pane) : reportedCwd(pane.id),
    start: pane.cwd,
    tmux: pane.kind === "ssh" && !!pane.tmux,
  });
  if (folder) view.folder = folder;
  return view;
}
