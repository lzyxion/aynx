import { invoke, isRemote, listen } from "../ipc";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { activeTab, applyMirrorTabs, focusedPane, mirrorLocalChoice } from "$lib/app/tabs.svelte.js";
import { setMirrorRepaint, setMirrorWorkspaces } from "$lib/app/workspaces.svelte.js";
import { setMirroredAgents } from "$lib/app/titles.svelte.js";
import { mirrorAgentLink } from "$lib/app/agent-sessions.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { deserialize } from "$lib/tabs";
import { listPanes, newStartPane, type PaneSpec } from "$lib/session";
import { newTileKey, type WorkspaceLoad } from "$lib/workspaces/schema";
import {
  FALLBACK_WS, buildSnapshot, parseSnapshot, type MirrorNode, type MirrorSnapshot, type MirrorWorkspace, type PaneView,
} from "$lib/mirror/snapshot";
import { liveKeys, paneKeyOf, reduceMirror, type MirrorMemory, type MirrorSeed } from "$lib/mirror/reduce";
import { parseLastView, serializeLastView } from "$lib/mobile/prefs";
import { followHomeStartBoard } from "$lib/start-widgets.svelte.js";

/**
 * 원격 창은 제 탭을 만들거나 저장하지 않는다 — 탭에 쓰는 길은 `applyMirrorTabs` 하나이고, 배치를 바꾸는 조작은 메인 PC 주 창에 요청으로 보낸다.
 * 어느 워크스페이스를 볼지는 원격 창 몫이고 메인 PC 화면은 움직이지 않는다. 저장된 배치는 읽기만 한다(쓰기 범위를 잡지 않는다).
 */

let memory: MirrorMemory | null = null;
let last: MirrorSnapshot | null = null;
const overrides = new Map<string, PaneSpec>();
const placeholders = new SvelteSet<string>();
let placeholderKeys: Record<string, string> = {};
/** 받기 세대 — 늦게 돌아온 `mirror_get` · 파일 읽기가 그사이 온 이벤트를 덮지 않게 */
let generation = 0;
let started = false;
let fileNoticeShown = false;

/** 브라우저 저장소 — 메인 PC 에 가지 않는다 */
const LAST_VIEW_KEY = "aynx.remote.lastView";
let seed: MirrorSeed | null = null;
let lastViewWritten: string | null = null;

function readLastView(): MirrorSeed | null {
  try {
    return parseLastView(localStorage.getItem(LAST_VIEW_KEY));
  } catch {
    return null;
  }
}

function writeLastView(raw: string): void {
  if (raw === lastViewWritten) return;
  lastViewWritten = raw;
  try {
    localStorage.setItem(LAST_VIEW_KEY, raw);
  } catch {
    /* 막힌 저장소 — 이 페이지 동안만 */
  }
}

function trackLastView(): void {
  $effect.root(() => {
    $effect(() => {
      const tab = activeTab();
      if (!tab) return;
      const pane = focusedPane();
      const tabKey = homeTabKey(tab.id);
      const tile = pane ? homeTileKey(pane.id) : null;
      if (tabKey === null && tile === null) return;
      writeLastView(serializeLastView({ tab: tabKey, tile }));
    });
  });
}

let workspaceRows = $state<MirrorWorkspace[]>([]);

let homeWorkspaceId = $state<string | null>(null);

export function mirrorHomeWorkspace(): string | null {
  return homeWorkspaceId;
}

export function mirrorWorkspaces(): MirrorWorkspace[] {
  return workspaceRows;
}

const views = new SvelteMap<string, PaneView>();

export function mirrorViewOf(paneId: string): PaneView | null {
  return views.get(paneId) ?? null;
}

function applyViews(snap: MirrorSnapshot, mem: MirrorMemory): void {
  const next = new Map<string, PaneView>();
  const walk = (n: MirrorNode): void => {
    if (n.type === "split") {
      walk(n.a);
      walk(n.b);
      return;
    }
    const view = snap.views?.[n.pane.id];
    const id = mem.paneIds.get(paneKeyOf(n.pane));
    if (view && id) next.set(id, view);
  };
  for (const tab of snap.tabs) walk(tab.root);
  for (const id of [...views.keys()]) if (!next.has(id)) views.delete(id);
  for (const [id, v] of next) if (JSON.stringify(views.get(id)) !== JSON.stringify(v)) views.set(id, v);
  const ais = new Map<string, string>();
  for (const [id, v] of next) if (v.ai) ais.set(id, v.ai);
  setMirroredAgents(ais);
}

export function mirrorPlaceholder(paneId: string): boolean {
  return placeholders.has(paneId);
}

function apply(snap: MirrorSnapshot): void {
  last = snap;
  if (snap.startBoard) followHomeStartBoard(snap.startBoard);
  const live = liveKeys(snap);
  for (const key of [...overrides.keys()]) if (!live.has(key)) overrides.delete(key);
  const r = reduceMirror(snap, memory, memory ? mirrorLocalChoice() : null, overrides, memory ? null : seed);
  memory = r.memory;
  seed = null;
  // 워크스페이스를 탭보다 먼저 — 탭 모듈이 활성 탭을 고를 때 그 소속으로 거른다
  setMirrorWorkspaces(snap.workspaces, r.workspaceId);
  if (JSON.stringify(workspaceRows) !== JSON.stringify(snap.workspaces)) workspaceRows = snap.workspaces;
  const homeWs = snap.workspace?.id ?? snap.workspaces[0]?.id ?? null;
  if (homeWorkspaceId !== homeWs) homeWorkspaceId = homeWs;
  applyViews(snap, r.memory);
  placeholderKeys = r.placeholderKeys;
  placeholders.clear();
  for (const id of r.placeholders) placeholders.add(id);
  applyMirrorTabs(r.tabs, r.activeId, r.focus);
  // 타일 ↔ 대화 연결은 메인 PC 의 것으로 — 붙기 전 · 떼어 둔 동안의 신호를 원격은 못 받는다
  for (const tab of r.tabs)
    for (const p of listPanes(tab.root)) if (p.kind === "local" || p.kind === "ssh") mirrorAgentLink(p.id, p.agentLink);
}

async function fromFile(): Promise<MirrorSnapshot | null> {
  const loaded = await invoke<WorkspaceLoad>("workspaces_load");
  if (loaded.state !== "v2") return null;
  const file = loaded.file;
  const ws = file.workspaces.find((w) => w.id === file.activeWorkspaceId) ?? file.workspaces[0];
  if (!ws) return null;
  const saved = ws.tabs.filter((tab) => tab.placement.kind === "main");
  const restored = deserialize({ version: 1, activeIndex: 0, workspaces: saved });
  const active = restored.tabs.find((tab) => tab.tabKey !== undefined && tab.tabKey === ws.lastActive.tabKey) ?? restored.tabs[0];
  return buildSnapshot({
    source: "file",
    workspace: { id: ws.id, name: ws.name },
    tabs: restored.tabs,
    activeTabId: active?.id ?? null,
    focusOf: (tab) => listPanes(tab.root).find((p) => p.tileKey !== undefined && p.tileKey === ws.lastActive.tileKey)?.id ?? null,
  });
}

async function load(): Promise<void> {
  const gen = ++generation;
  let snap: MirrorSnapshot | null = null;
  try {
    snap = parseSnapshot(await invoke<unknown>("mirror_get"));
  } catch {
    snap = null;
  }
  let fromSaved = false;
  if (!snap) {
    try {
      snap = await fromFile();
      fromSaved = snap !== null;
    } catch {
      snap = null;
    }
  }
  if (gen !== generation || !snap) return;
  if (fromSaved && !fileNoticeShown) {
    fileNoticeShown = true;
    showNotice(t("app.mirror.fromFile"));
  }
  if (!fromSaved) fileNoticeShown = false;
  apply(snap);
}

/** 이벤트를 먼저 걸고 지금 배치를 받는다 */
export async function bootMirror(): Promise<void> {
  if (!isRemote || started) return;
  started = true;
  seed = readLastView();
  trackLastView();
  setMirrorWorkspaces([{ id: FALLBACK_WS, name: "" }], FALLBACK_WS);
  setMirrorRepaint(() => {
    if (last) apply(last);
  });
  await listen<unknown>("mirror-layout", (ev) => {
    if (ev.payload === null) {
      void load();
      return;
    }
    const snap = parseSnapshot(ev.payload);
    if (!snap) return;
    generation++;
    fileNoticeShown = false;
    apply(snap);
  }).catch(() => {});
  await load();
}

function findLeaf(snap: MirrorSnapshot, key: string): PaneSpec | null {
  const walk = (n: MirrorNode): PaneSpec | null =>
    n.type === "leaf" ? (paneKeyOf(n.pane) === key ? n.pane : null) : (walk(n.a) ?? walk(n.b));
  for (const tab of snap.tabs) {
    const hit = walk(tab.root);
    if (hit) return hit;
  }
  return null;
}

/** 서버의 DB 연결 · 트랜잭션은 `tileKey` 가 열쇠라 새 `tileKey` 를 단다 — 메인 PC 의 것과 섞이지 않게 */
export function openOwnInstance(paneId: string): void {
  const key = placeholderKeys[paneId];
  if (!key || !last) return;
  const src = findLeaf(last, key);
  if (!src) return;
  const fresh = newStartPane();
  const own: PaneSpec = JSON.parse(JSON.stringify(src)) as PaneSpec;
  own.id = `r${fresh.id}`;
  own.tileKey = newTileKey();
  delete own.sourcePaneId;
  overrides.set(key, own);
  apply(last);
}

export function isOwnInstance(paneId: string): boolean {
  for (const own of overrides.values()) if (own.id === paneId) return true;
  return false;
}

export function closeOwnInstance(paneId: string): void {
  for (const [key, own] of overrides) if (own.id === paneId) overrides.delete(key);
  if (last) apply(last);
}

export function homeTileKey(paneId: string): string | null {
  if (!memory) return null;
  for (const [key, id] of memory.paneIds) if (id === paneId) return key;
  return null;
}

export function homeTabKey(tabId: string): string | null {
  if (!memory) return null;
  for (const [key, id] of memory.tabIds) if (id === tabId) return key;
  return null;
}

export function mirrorSource(): "home" | "file" | null {
  return last?.source ?? null;
}
