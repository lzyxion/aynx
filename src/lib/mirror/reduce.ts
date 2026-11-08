// 집 PC 화면 거울의 **환원기**(원격 웹 R2-B) — 받은 스냅숏 + 지난 기억 + 원격 창의 지금 고름 → 원격 창이 그릴 탭 목록. 순수 모듈.
//
// 규칙:
// - **같은 타일은 같은 id** — 타일의 영속 열쇠(`tileKey`, 없으면 집 PC id)로 알아보고, 처음 보는 타일만 새 id(`h` + 집 PC id)를 받는다.
//   그래서 집 PC 가 분할 · 탭 전환을 해도 원격의 터미널(시청자)이 다시 붙지 않는다(`PaneHost` 는 pane id 로 상자를 쥔다). 저장된 배치에서
//   만든 스냅숏(트레이 — `file`)은 읽을 때마다 id 가 새로 나지만 열쇠가 같아 원격 id 는 그대로다.
// - **집 PC 가 그 타일을 바꾸지 않았으면 원격의 명세 객체를 그대로 둔다** — 원격에서 파일 타일을 돌아다닌 폴더 · 보기 같은 화면 상태는
//   집 PC 가 그 타일을 바꿀 때까지 산다(비교는 받은 명세의 JSON).
// - **워크스페이스 · 탭 · 포커스 · 최대화는 "집 PC 가 바꾸면 따라가고, 아니면 원격의 고름을 둔다"** — 원격에서 다른 워크스페이스 · 탭을
//   골라 보는 것은 원격 창 몫이고(집 PC 를 바꾸지 않는다), 집 PC 에서 바꾸면 원격도 그리로 간다. 활성 탭은 워크스페이스마다 따로 센다
//   (집 PC 가 보지 않는 워크스페이스의 "집 PC 활성 탭" 은 집 PC 가 기억한 마지막 활성 탭 — 그것이 바뀌면 원격의 그 워크스페이스도 따라간다).
// - 탭은 **모든 워크스페이스의 것**을 소속(`workspaceId`)과 함께 낸다 — 워크스페이스를 바꿔 봐도 타일 id 가 그대로라 시청자가 다시 붙지 않는다.
// - **자리 표시**(`tile-policy` 의 `own` — 쿼리 타일)는 원격이 [원격에서 따로 열기] 한 것(`overrides` — 열쇠 → 원격 제 타일)이 있으면 그
//   타일로, 없으면 자리 표시 목록에 올린다. 집 PC 에서 그 타일이 사라지면 따로 연 것도 사라진다(부르는 쪽이 `overrides` 를 거둔다 —
//   [`liveKeys`]).

import type { PaneNode, PaneSpec, TabSpec } from "$lib/session/spec";
import type { MirrorNode, MirrorSnapshot } from "./snapshot";
import { mirrorTileMode } from "./tile-policy";

/** 지난 환원의 기억 — 부르는 쪽이 쥐고 다음 환원에 넘긴다. */
export interface MirrorMemory {
  /** 타일 열쇠 → 원격 pane id */
  paneIds: Map<string, string>;
  /** 타일 열쇠 → 받은 명세(id 를 원격 것으로 바꾼 뒤)의 JSON — 바뀌었나 보는 데 쓴다 */
  paneJson: Map<string, string>;
  /** 타일 열쇠 → 원격 창이 쥔 명세 객체(바뀌지 않았으면 그대로 다시 쓴다) */
  panes: Map<string, PaneSpec>;
  /** 탭 열쇠 → 원격 tab id */
  tabIds: Map<string, string>;
  /** 원격 tab id → 지난번 집 PC 의 포커스 · 최대화(원격 pane id) */
  homeFocus: Map<string, string | null>;
  homeZoom: Map<string, string | null>;
  /** 워크스페이스 id → 지난번 집 PC 의 그 워크스페이스 활성 탭(원격 tab id) */
  homeActive: Map<string, string | null>;
  /** 지난번 집 PC 가 보던 워크스페이스(처음이면 `null`) */
  homeWorkspace: string | null;
}

/** 원격 창의 지금 고름(탭 모듈 · 워크스페이스 모듈 값). */
export interface MirrorLocal {
  /** 원격 창이 지금 보는 워크스페이스(모르면 집 PC 를 따른다) */
  workspaceId?: string | null;
  /** 워크스페이스마다 원격이 마지막으로 고른 탭(없으면 모든 워크스페이스에 `activeId`) */
  activeOf?(workspaceId: string): string | null;
  activeId: string | null;
  focusOf(tabId: string): string | null;
  zoomOf(tabId: string): string | null;
}

export interface MirrorResult {
  /** 모든 워크스페이스의 탭(소속 `workspaceId` — 탭 모듈이 원격의 지금 워크스페이스로 거른다) */
  tabs: TabSpec[];
  /** 원격 창이 볼 워크스페이스([`pickMirrorWorkspace`]) */
  workspaceId: string;
  /** 그 워크스페이스의 활성 탭 */
  activeId: string | null;
  /** 워크스페이스마다 활성 탭(원격 tab id) */
  activeByWs: Record<string, string | null>;
  /** 원격 tab id → 포커스 타일(원격 pane id) */
  focus: Record<string, string>;
  /** 자리 표시로 그릴 타일(원격 pane id) */
  placeholders: string[];
  /** 자리 표시 타일 id → 그 타일 열쇠([원격에서 따로 열기] 가 `overrides` 에 넣을 열쇠) */
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

/**
 * **원격 창이 볼 워크스페이스** — 순수. 탭 고르기와 같은 규칙: 집 PC 가 워크스페이스를 바꿨으면(또는 처음이면) 따라가고, 아니면 원격의
 * 고름(`local`)을 둔다. 고른 것이 없거나 더는 볼 수 없으면(사라짐 · cold) 집 PC 의 지금 것. `live` 는 탭을 실은(cold 아닌) 워크스페이스.
 */
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

/** 타일 열쇠 — 영속 `tileKey`, 없으면 집 PC id */
export function paneKeyOf(p: Pick<PaneSpec, "id" | "tileKey">): string {
  return p.tileKey ? `k:${p.tileKey}` : `i:${p.id}`;
}

function tabKeyOf(t: { id: string; tabKey?: string }): string {
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

/** 이 스냅숏에 살아 있는 타일 열쇠(따로 연 타일을 거둘 때) */
export function liveKeys(snap: MirrorSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const tab of snap.tabs) for (const p of leaves(tab.root)) keys.add(paneKeyOf(p));
  return keys;
}

/** 받은 id 가 이미 이번 환원에서 쓰였으면 겹치지 않게 꼬리를 단다 */
function unique(want: string, used: Set<string>): string {
  let id = want;
  for (let n = 2; used.has(id); n++) id = `${want}~${n}`;
  used.add(id);
  return id;
}

/**
 * **환원** — 순수. 탭은 받은 소속(`workspaceId`)을 그대로 단다 — 원격 창의 지금 워크스페이스는 결과의 `workspaceId`
 * ([`pickMirrorWorkspace`]), 활성 탭은 워크스페이스마다 같은 "집 PC 가 바꾸면 따라간다" 규칙.
 */
export function reduceMirror(
  snap: MirrorSnapshot,
  prev: MirrorMemory | null,
  local: MirrorLocal | null,
  overrides: ReadonlyMap<string, PaneSpec>,
): MirrorResult {
  const mem = emptyMemory();
  const old = prev ?? emptyMemory();
  const usedPane = new Set<string>();
  const usedTab = new Set<string>();
  // ① 이번 스냅숏의 타일마다 원격 id — 집 PC id → 원격 id 표(원본 터미널 · 포커스 · 최대화를 옮긴다)
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

  // ② 탭 — 열쇠로 같은 원격 tab id
  const tabs: TabSpec[] = [];
  const focus: Record<string, string> = {};
  /** 집 PC tab id → 원격 tab id(워크스페이스마다 활성 탭을 옮긴다) */
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
    // 포커스: 집 PC 가 바꿨으면 따라가고, 아니면 원격의 고름(그 타일이 아직 있으면)
    const homeFocus = mt.focus !== null ? (homeToRemote.get(mt.focus) ?? null) : null;
    mem.homeFocus.set(id, homeFocus);
    const localFocus = local?.focusOf(id) ?? null;
    const followFocus = !old.homeFocus.has(id) || old.homeFocus.get(id) !== homeFocus;
    const pickedFocus = followFocus ? homeFocus : localFocus;
    const first = [...ids][0];
    focus[id] = pickedFocus !== null && ids.has(pickedFocus) ? pickedFocus : homeFocus !== null && ids.has(homeFocus) ? homeFocus : first;
    // 최대화: 같은 규칙
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
  // ③ 원격 창이 볼 워크스페이스 — 집 PC 가 바꿨으면 따라가고, 아니면 원격의 고름
  const homeWs = snap.workspace?.id ?? snap.workspaces[0].id;
  const live = new Set(snap.workspaces.filter((w) => !w.cold).map((w) => w.id));
  const homeMoved = prev === null || old.homeWorkspace !== homeWs;
  const workspaceId = pickMirrorWorkspace(homeWs, prev === null ? null : old.homeWorkspace, local?.workspaceId, live);
  mem.homeWorkspace = homeWs;

  // ④ 활성 탭(워크스페이스마다): 집 PC 가 바꿨으면 따라가고, 아니면 원격의 고름(그 탭이 아직 그 워크스페이스에 있으면)
  const activeByWs: Record<string, string | null> = {};
  for (const ws of snap.workspaces) {
    if (ws.cold) continue;
    const own = tabs.filter((t) => t.workspaceId === ws.id);
    const exists = (id: string | null) => id !== null && own.some((t) => t.id === id);
    const homeTab = ws.id === homeWs ? snap.activeTabId : ws.activeTabId;
    const homeActive = homeTab !== null ? (tabToRemote.get(homeTab) ?? null) : null;
    mem.homeActive.set(ws.id, homeActive);
    // 집 PC 가 이 워크스페이스로 막 옮겨 왔으면 그 활성 탭도 따라간다(집 PC 의 "지금 탭" 이 바뀐 것이다)
    const follow =
      prev === null || (homeMoved && ws.id === homeWs) || !old.homeActive.has(ws.id) || old.homeActive.get(ws.id) !== homeActive;
    const localPick = local ? (local.activeOf ? local.activeOf(ws.id) : local.activeId) : null;
    const picked = follow ? homeActive : localPick;
    activeByWs[ws.id] = exists(picked) ? picked : exists(homeActive) ? homeActive : (own[0]?.id ?? null);
  }
  const activeId = activeByWs[workspaceId] ?? null;

  return { tabs, workspaceId, activeId, activeByWs, focus, placeholders, placeholderKeys, memory: mem };
}
