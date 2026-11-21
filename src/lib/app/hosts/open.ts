import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { rememberTarget } from "$lib/app/prompts.svelte.js";
import {
  adoptPane,
  focusPane,
  moveTabBefore,
  openPaneHere,
  openTab,
  placePane,
  currentWorkspaceTabs,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import {
  decodeHostsDrag,
  hostMeta,
  hostsDragEmpty,
  resolveHostsDrag,
  HOSTS_DRAG_TYPE,
  type HostEntry,
  type HostsDrag,
} from "$lib/hosts";
import {
  findFirstPane,
  findPane,
  flipDir,
  leafOf,
  newSshPane,
  newTab,
  tiledSubtree,
  type PaneSide,
  type PaneSpec,
  type SplitDir,
  type TabSpec,
} from "$lib/session";
import { hostCache, lookupHost } from "./list.svelte.js";

// ---------------------------------------------------------------------------
// 끌어온 것을 연다 — 호스트든 폴더든, 하나든 여럿이든 한 길
// (docs/log/2026-09-03-group-open-tiled.md · docs/log/2026-09-04-hosts-multiselect.md)
// ---------------------------------------------------------------------------

/** 넘으면 먼저 확인 — 그룹 머리글을 잘못 떨어뜨려 세션 스무 개가 소리 없이 열리는 것을 막는다 */
const GROUP_OPEN_CONFIRM_ABOVE = 6;

/** 동시 SSH 핸드셰이크는 sshd `MaxStartups` 한도를 때려 몇 개가 끊긴다 */
const OPEN_STAGGER_MS = 120;

/** 자리 잡기보다 먼저 묻는다 — 탭 바 드롭에서 취소하면 빈 탭이 남지 않게 */
async function resolveOpenTargets(payload: HostsDrag): Promise<string[] | null> {
  const names = resolveHostsDrag(hostCache(), payload);
  if (names.length === 0) {
    showNotice(t("files.host.open.none"));
    return null;
  }
  if (names.length <= GROUP_OPEN_CONFIRM_ABOVE) return names;
  // 다이얼로그를 못 띄웠으면 열지 않는다
  try {
    const go = await askConfirm(t("files.host.openall.confirm", { count: names.length }), {
      title: t("files.host.openall.title"),
      kind: "warning",
    });
    return go ? names : null;
  } catch {
    showNotice(t("files.host.openall.askfail"));
    return null;
  }
}

function panesFor(names: string[]): PaneSpec[] {
  return names.map((name, i) => {
    const host = lookupHost(name);
    if (host) rememberTarget(host);
    // 목록에 없는 별칭이어도 접속은 시도한다 (트리가 아직 못 읽었을 수 있다)
    const pane = newSshPane(name, host ? hostMeta(host).scrollback : undefined);
    pane.openDelay = i * OPEN_STAGGER_MS;
    return pane;
  });
}

/** 서브트리의 첫 분할은 바깥 분할의 반대 — 같은 방향이면 폭 좁은 띠가 줄줄이 생긴다 */
function placeHosts(
  tab: TabSpec,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  panes: PaneSpec[],
): void {
  placePane(tab, tiledSubtree(panes, flipDir(dir)), targetPaneId, dir, side);
  focusPane(tab.id, panes[0].id);
  for (const pane of panes) adoptPane(tab.id, pane.id);
}

export async function openHostsTiled(
  tabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  payload: HostsDrag,
): Promise<void> {
  if (hostsDragEmpty(payload)) return;
  const names = await resolveOpenTargets(payload);
  if (!names) return;
  // 확인을 기다리는 동안 탭이나 대상 패널이 사라졌을 수 있다
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, targetPaneId)) return;
  placeHosts(tab, targetPaneId, dir, side, panesFor(names));
}

export function openGroupTiled(
  tabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  groupPath: string,
): void {
  const path = groupPath.trim();
  if (path === "") return;
  void openHostsTiled(tabId, targetPaneId, dir, side, { hosts: [], groups: [path] });
}

export async function dropHostsAsTab(
  payload: HostsDrag,
  beforeId: string | null,
): Promise<void> {
  if (hostsDragEmpty(payload)) return;
  const names = await resolveOpenTargets(payload);
  if (!names) return;
  const tab = openTab(newTab());
  if (beforeId !== null) moveTabBefore(tab.id, beforeId);
  placeHosts(tab, findFirstPane(tab.root).id, "row", "after", panesFor(names));
}

function openAliasInNewTab(alias: string, scrollback?: number | null): void {
  const tab = openTab(newTab());
  const pane = newSshPane(alias, scrollback);
  placePane(tab, leafOf(pane), findFirstPane(tab.root).id, "row", "after");
  focusPane(tab.id, pane.id);
  adoptPane(tab.id, pane.id);
}

export function connect(host: HostEntry): void {
  rememberTarget(host);
  openPaneHere(newSshPane(host.name, host.meta?.scrollback));
}

export function connectInNewTab(host: HostEntry): void {
  rememberTarget(host);
  openAliasInNewTab(host.name, host.meta?.scrollback);
}

/** 탭이 하나라도 있으면 손대지 않는다 — 그때는 `PaneHost` 가 패널 단위로 받는다 */
export function mainDragOver(ev: DragEvent): void {
  const dt = ev.dataTransfer;
  if (currentWorkspaceTabs().length > 0 || !dt?.types.includes(HOSTS_DRAG_TYPE)) return;
  ev.preventDefault();
  dt.dropEffect = "copy";
}

export function mainDrop(ev: DragEvent): void {
  const dt = ev.dataTransfer;
  if (currentWorkspaceTabs().length > 0 || !dt?.types.includes(HOSTS_DRAG_TYPE)) return;
  ev.preventDefault();
  void dropHostsAsTab(decodeHostsDrag(dt.getData(HOSTS_DRAG_TYPE)), null);
}
