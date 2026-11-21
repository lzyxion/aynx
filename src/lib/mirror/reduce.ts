// 메인 PC 화면 거울의 환원기 — 받은 스냅숏 + 지난 기억 + 원격 창의 고름 → 원격 창이 그릴 탭 목록. 순수 모듈.
// 같은 타일은 같은 원격 id 를 받아야 한다 — 바뀌면 원격의 터미널(시청자)이 다시 붙는다(`PaneHost` 는 pane id 로 상자를 쥔다).
// 메인 PC 가 그 타일을 바꾸지 않았으면 원격의 명세 객체를 그대로 둔다 — 원격에서 바꾼 화면 상태(폴더 · 보기)가 산다.

import type { PaneNode, PaneSpec, TabSpec } from "$lib/session/spec";
import type { MirrorNode, MirrorSnapshot } from "./snapshot";
import { mirrorTileMode } from "./tile-policy";

export interface MirrorMemory {
  paneIds: Map<string, string>;
  /** 받은 명세(id 를 원격 것으로 바꾼 뒤)의 JSON */
  paneJson: Map<string, string>;
  panes: Map<string, PaneSpec>;
  tabIds: Map<string, string>;
  homeFocus: Map<string, string | null>;
  homeZoom: Map<string, string | null>;
  homeActive: Map<string, string | null>;
  homeWorkspace: string | null;
}

export interface MirrorLocal {
  workspaceId?: string | null;
  activeOf?(workspaceId: string): string | null;
  activeId: string | null;
  focusOf(tabId: string): string | null;
  zoomOf(tabId: string): string | null;
}

/** 이 기기가 마지막으로 보던 탭 · 타일의 영속 열쇠(`k:<tabKey>` · `paneKeyOf`) */
export interface MirrorSeed {
  tab: string | null;
  tile: string | null;
}

export interface MirrorResult {
  tabs: TabSpec[];
  workspaceId: string;
  activeId: string | null;
  activeByWs: Record<string, string | null>;
  focus: Record<string, string>;
  placeholders: string[];
  placeholderKeys: Record<string, string>;
  memory: MirrorMemory;
}

export function emptyMemory(): MirrorMemory {
  return {
    paneIds: new Map(),
    paneJson: new Map(),
    panes: new Map(),
    tabIds: new Map(),
    homeFocus: new Map(),
    homeZoom: new Map(),
    homeActive: new Map(),
    homeWorkspace: null,
  };
}

export function pickMirrorWorkspace(
  home: string,
  prevHome: string | null,
  local: string | null | undefined,
  live: ReadonlySet<string>,
): string {
  const follow = prevHome === null || prevHome !== home;
  const picked = follow ? home : (local ?? home);
  return live.has(picked) ? picked : home;
}

/** 열쇠 꼴은 이 기기의 `localStorage` 씨앗에 남는다 */
export function paneKeyOf(p: Pick<PaneSpec, "id" | "tileKey">): string {
  return p.tileKey ? `k:${p.tileKey}` : `i:${p.id}`;
}

export function tabKeyOf(t: { id: string; tabKey?: string }): string {
  return t.tabKey ? `k:${t.tabKey}` : `i:${t.id}`;
}

function leaves(node: MirrorNode, out: PaneSpec[] = []): PaneSpec[] {
  if (node.type === "leaf") out.push(node.pane);
  else {
    leaves(node.a, out);
    leaves(node.b, out);
  }
  return out;
}

export function liveKeys(snap: MirrorSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const tab of snap.tabs) for (const p of leaves(tab.root)) keys.add(paneKeyOf(p));
  return keys;
}

function unique(want: string, used: Set<string>): string {
  let id = want;
  for (let n = 2; used.has(id); n++) id = `${want}~${n}`;
  used.add(id);
  return id;
}

export function reduceMirror(
  snap: MirrorSnapshot,
  prev: MirrorMemory | null,
  local: MirrorLocal | null,
  overrides: ReadonlyMap<string, PaneSpec>,
  seed: MirrorSeed | null = null,
): MirrorResult {
  const mem = emptyMemory();
  const old = prev ?? emptyMemory();
  const usedPane = new Set<string>();
  const usedTab = new Set<string>();
  const homeToRemote = new Map<string, string>();
  for (const tab of snap.tabs) {
    for (const p of leaves(tab.root)) {
      const key = paneKeyOf(p);
      const id = unique(old.paneIds.get(key) ?? `h${p.id}`, usedPane);
      mem.paneIds.set(key, id);
      homeToRemote.set(p.id, id);
    }
  }
  const placeholders: string[] = [];
  const placeholderKeys: Record<string, string> = {};
  const paneFor = (incoming: PaneSpec): PaneSpec => {
    const key = paneKeyOf(incoming);
    const id = mem.paneIds.get(key)!;
    if (mirrorTileMode(incoming.kind) === "own") {
      const own = overrides.get(key);
      if (own) return own;
      placeholders.push(id);
      placeholderKeys[id] = key;
    }
    const next: PaneSpec = { ...incoming, id };
    if (incoming.sourcePaneId !== undefined) next.sourcePaneId = homeToRemote.get(incoming.sourcePaneId) ?? `h${incoming.sourcePaneId}`;
    const json = JSON.stringify(next);
    mem.paneJson.set(key, json);
    const kept = old.panes.get(key);
    const pane = kept && old.paneJson.get(key) === json ? kept : next;
    mem.panes.set(key, pane);
    return pane;
  };
  const nodeFor = (node: MirrorNode): PaneNode =>
    node.type === "leaf"
      ? { type: "leaf", pane: paneFor(node.pane) }
      : { type: "split", dir: node.dir, ratio: node.ratio, ...(node.px ? { px: node.px } : {}), a: nodeFor(node.a), b: nodeFor(node.b) };

  const tabs: TabSpec[] = [];
  const focus: Record<string, string> = {};
  const tabToRemote = new Map<string, string>();
  for (const mt of snap.tabs) {
    const key = tabKeyOf(mt);
    const id = unique(old.tabIds.get(key) ?? `h${mt.id}`, usedTab);
    mem.tabIds.set(key, id);
    tabToRemote.set(mt.id, id);
    const root = nodeFor(mt.root);
    const ids = new Set<string>();
    const collect = (n: PaneNode): void => {
      if (n.type === "leaf") ids.add(n.pane.id);
      else {
        collect(n.a);
        collect(n.b);
      }
    };
    collect(root);
    const homeFocus = mt.focus !== null ? (homeToRemote.get(mt.focus) ?? null) : null;
    mem.homeFocus.set(id, homeFocus);
    const localFocus = local?.focusOf(id) ?? null;
    const followFocus = !old.homeFocus.has(id) || old.homeFocus.get(id) !== homeFocus;
    const pickedFocus = followFocus ? homeFocus : localFocus;
    const first = [...ids][0];
    focus[id] = pickedFocus !== null && ids.has(pickedFocus) ? pickedFocus : homeFocus !== null && ids.has(homeFocus) ? homeFocus : first;
    const homeZoom = mt.zoomedPaneId ? (homeToRemote.get(mt.zoomedPaneId) ?? null) : null;
    mem.homeZoom.set(id, homeZoom);
    const followZoom = !old.homeZoom.has(id) || old.homeZoom.get(id) !== homeZoom;
    const zoom = followZoom ? homeZoom : (local?.zoomOf(id) ?? null);
    const tab: TabSpec = { id, workspaceId: mt.workspaceId, title: mt.title, root };
    if (mt.tabKey) tab.tabKey = mt.tabKey;
    if (mt.name !== undefined) tab.name = mt.name;
    if (mt.pinnedTitle !== undefined) tab.pinnedTitle = mt.pinnedTitle;
    if (mt.projectId !== undefined) tab.projectId = mt.projectId;
    if (mt.projectFolder !== undefined) tab.projectFolder = mt.projectFolder;
    if (mt.orch) tab.orch = { ...mt.orch };
    if (zoom !== null && ids.has(zoom)) tab.zoomedPaneId = zoom;
    tabs.push(tab);
  }
  const homeWs = snap.workspace?.id ?? snap.workspaces[0].id;
  const live = new Set(snap.workspaces.filter((w) => !w.cold).map((w) => w.id));
  const homeMoved = prev === null || old.homeWorkspace !== homeWs;
  const workspaceId = pickMirrorWorkspace(homeWs, prev === null ? null : old.homeWorkspace, local?.workspaceId, live);
  mem.homeWorkspace = homeWs;

  const activeByWs: Record<string, string | null> = {};
  for (const ws of snap.workspaces) {
    if (ws.cold) continue;
    const own = tabs.filter((t) => t.workspaceId === ws.id);
    const exists = (id: string | null) => id !== null && own.some((t) => t.id === id);
    const homeTab = ws.id === homeWs ? snap.activeTabId : ws.activeTabId;
    const homeActive = homeTab !== null ? (tabToRemote.get(homeTab) ?? null) : null;
    mem.homeActive.set(ws.id, homeActive);
    const follow =
      prev === null || (homeMoved && ws.id === homeWs) || !old.homeActive.has(ws.id) || old.homeActive.get(ws.id) !== homeActive;
    const localPick = local ? (local.activeOf ? local.activeOf(ws.id) : local.activeId) : null;
    const picked = follow ? homeActive : localPick;
    activeByWs[ws.id] = exists(picked) ? picked : exists(homeActive) ? homeActive : (own[0]?.id ?? null);
  }
  let shownWs = workspaceId;
  const hit = prev === null && seed ? findSeed(snap, seed, live) : null;
  if (hit) {
    const tabId = tabToRemote.get(hit.tabId)!;
    shownWs = hit.workspaceId;
    activeByWs[shownWs] = tabId;
    const paneId = hit.tile !== null ? mem.paneIds.get(hit.tile) : undefined;
    if (paneId) focus[tabId] = paneId;
  }
  const activeId = activeByWs[shownWs] ?? null;

  return { tabs, workspaceId: shownWs, activeId, activeByWs, focus, placeholders, placeholderKeys, memory: mem };
}

function findSeed(
  snap: MirrorSnapshot,
  seed: MirrorSeed,
  live: ReadonlySet<string>,
): { tabId: string; workspaceId: string; tile: string | null } | null {
  if (seed.tile !== null)
    for (const mt of snap.tabs)
      if (live.has(mt.workspaceId) && leaves(mt.root).some((p) => paneKeyOf(p) === seed.tile))
        return { tabId: mt.id, workspaceId: mt.workspaceId, tile: seed.tile };
  if (seed.tab !== null)
    for (const mt of snap.tabs)
      if (live.has(mt.workspaceId) && tabKeyOf(mt) === seed.tab) return { tabId: mt.id, workspaceId: mt.workspaceId, tile: null };
  return null;
}
