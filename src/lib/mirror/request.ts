// 원격 창의 배치 바꾸기 요청 — 순수 모듈. 원격 창은 제 탭을 바꾸지 않는다: 요청은 GUI(`remote/mirror.rs` 의 `mirror_request`)를 거쳐
// 메인 PC 주 창에만 가고, 결과는 거울 방송으로 돌아온다(쓰기 주인은 늘 주 창 하나).
// 새로 여는 타일의 명세는 거울과 같은 허용 칸(`sanitizePane`)에 `cwd` · `autorun` · `injectMcpToken` 만 더한다 — 원격 창은 메인 PC 창과
// 같은 권한(B)이다. 세션 열쇠(`historyStreamId`) · 타일 열쇠 · id 는 싣지 않는다(메인 PC 가 새로 매긴다).

import { clampFileZoom, isFileView, type FileUiPatch, type FileView, type PaneNode, type PaneSpec, type SplitDir, type TabSpec } from "$lib/session/spec";
import type { PaneSide } from "$lib/session/tree-edit";
import type { FocusDir } from "$lib/layout";
import { sanitizePane } from "./snapshot";

/** GUI `LayoutRequest`(serde enum · 모르는 칸 거절)와 같은 목록(시험이 짝을 본다) */
export const LAYOUT_OPS = [
  "newTab",
  "openPane",
  "openBeside",
  "replaceTile",
  "split",
  "tmuxTile",
  "closeTile",
  "closeTabs",
  "renameTab",
  "reorderTab",
  "moveTile",
  "promoteTile",
  "mergeTab",
  "swapTile",
  "expandTile",
  "openOrchTab",
  "fileUi",
] as const;

export type LayoutOp = (typeof LAYOUT_OPS)[number];

/** 원격 창 안에서는 대상 칸이 원격 id 이고, 보낼 때([`toWire`]) 메인 PC 열쇠(`k:<tileKey>` · `i:<id>`)가 된다 */
export type LayoutRequest =
  | { op: "newTab"; pane?: PaneSpec; title?: string; projectFolder?: string; projectId?: string; workspace?: string }
  | { op: "openPane"; tab?: string; near?: string; pane: PaneSpec; title?: string; projectId?: string }
  | { op: "openBeside"; tile: string; pane: PaneSpec; dir?: SplitDir; side?: PaneSide }
  | { op: "replaceTile"; tile: string; pane: PaneSpec; title?: string }
  | { op: "split"; tile: string; dir?: SplitDir }
  | { op: "tmuxTile"; tile: string; name: string | null }
  | { op: "closeTile"; tile: string }
  | { op: "closeTabs"; tabs: string[] }
  | { op: "renameTab"; tab: string; name: string }
  | { op: "reorderTab"; tab: string; before: string | null }
  | { op: "moveTile"; tile: string; target: string; dir: SplitDir; side: PaneSide; stay?: true }
  | { op: "promoteTile"; tile: string; before: string | null }
  | { op: "mergeTab"; tab: string; target: string; dir: SplitDir; side: PaneSide }
  | { op: "swapTile"; tile: string; dir: FocusDir }
  | { op: "expandTile"; tile: string; dir: FocusDir }
  | { op: "openOrchTab"; runId?: string; workspace?: string }
  /** 없으면 원격 창의 보기 토글이 다음 거울 갱신에 되돌아간다 */
  | ({ op: "fileUi"; tile: string; view?: FileView } & FileUiPatch);

/** GUI 도 같은 값을 본다(`remote/mirror.rs`) */
export const MAX_KEY = 256;
export const MAX_NAME = 200;
export const MAX_TABS = 64;

/** 주 창 · GUI 가 돌려주는 `[mirror-<사유>]` 머리와 맞춘다 */
export const REFUSALS = ["no-home", "missing", "elsewhere", "cold", "unsaved", "dbtx", "start", "rate", "timeout", "invalid", "busy"] as const;
export type Refusal = (typeof REFUSALS)[number];

export function refusalOf(err: unknown): Refusal | null {
  const s = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  const m = /^\[mirror-([a-z-]+)\]/.exec(s);
  if (!m) return null;
  return (REFUSALS as readonly string[]).includes(m[1]) ? (m[1] as Refusal) : null;
}

/** 나머지 대상 조작은 메인 PC 의 지금 탭 · 타일을 그 대상으로 옮겨 겨누므로 메인 PC 가 지금 보는 워크스페이스에서만 한다(아니면 `elsewhere`) */
export function anyWorkspace(req: LayoutRequest): boolean {
  return req.op === "closeTile" || req.op === "closeTabs" || req.op === "renameTab" || req.op === "fileUi";
}

export function isClosing(req: LayoutRequest): req is Extract<LayoutRequest, { op: "closeTile" | "closeTabs" }> {
  return req.op === "closeTile" || req.op === "closeTabs";
}

// ── 타일 명세 ──

export function requestPane(p: PaneSpec, sourceKey: (id: string) => string | null): PaneSpec {
  const out = sanitizePane(p);
  out.id = "";
  delete out.tileKey;
  delete out.historyStreamId;
  delete out.deferred;
  if (out.sourcePaneId !== undefined) {
    const key = sourceKey(out.sourcePaneId);
    if (key) out.sourcePaneId = key;
    else delete out.sourcePaneId;
  }
  if (typeof p.cwd === "string" && p.cwd !== "") out.cwd = p.cwd;
  if (typeof p.autorun === "string" && p.autorun !== "") out.autorun = p.autorun;
  if (p.injectMcpToken === true) out.injectMcpToken = true;
  return out;
}

export function homePane(p: PaneSpec, id: string, sourceId: (key: string) => string | null): PaneSpec {
  const out = requestPane(p, () => null);
  out.id = id;
  if (typeof p.sourcePaneId === "string") {
    const home = sourceId(p.sourcePaneId);
    if (home) out.sourcePaneId = home;
  }
  return out;
}

// ── 원격 id → 메인 PC 열쇠 ──

export interface KeyLookup {
  tile(id: string): string | null;
  tab(id: string): string | null;
}

export function toWire(req: LayoutRequest, keys: KeyLookup): LayoutRequest | null {
  const tile = (id: string) => keys.tile(id);
  const pane = (p: PaneSpec) => requestPane(p, tile);
  switch (req.op) {
    case "newTab": {
      const out: LayoutRequest = { op: "newTab" };
      if (req.pane) out.pane = pane(req.pane);
      if (req.title) out.title = req.title.slice(0, MAX_NAME);
      if (req.projectFolder) out.projectFolder = req.projectFolder;
      if (req.projectId) out.projectId = req.projectId;
      if (req.workspace) out.workspace = req.workspace.slice(0, MAX_KEY);
      return out;
    }
    case "openPane": {
      const out: LayoutRequest = { op: "openPane", pane: pane(req.pane) };
      if (req.tab !== undefined) {
        const k = keys.tab(req.tab);
        if (!k) return null;
        out.tab = k;
      }
      if (req.near !== undefined) {
        const k = tile(req.near);
        if (k) out.near = k;
      }
      if (req.title) out.title = req.title.slice(0, MAX_NAME);
      if (req.projectId) out.projectId = req.projectId;
      return out;
    }
    case "openBeside":
    case "replaceTile": {
      const k = tile(req.tile);
      if (!k) return null;
      return { ...req, tile: k, pane: pane(req.pane) } as LayoutRequest;
    }
    case "split":
    case "tmuxTile":
    case "closeTile":
    case "swapTile":
    case "expandTile":
    case "fileUi": {
      const k = tile(req.tile);
      return k ? ({ ...req, tile: k } as LayoutRequest) : null;
    }
    case "closeTabs": {
      const ks = req.tabs.map((id) => keys.tab(id)).filter((k): k is string => k !== null);
      return ks.length > 0 ? { op: "closeTabs", tabs: ks.slice(0, MAX_TABS) } : null;
    }
    case "renameTab": {
      const k = keys.tab(req.tab);
      return k ? { op: "renameTab", tab: k, name: req.name.slice(0, MAX_NAME) } : null;
    }
    case "reorderTab": {
      const k = keys.tab(req.tab);
      const b = req.before === null ? null : keys.tab(req.before);
      if (!k || (req.before !== null && !b)) return null;
      return { op: "reorderTab", tab: k, before: b };
    }
    case "moveTile": {
      const k = tile(req.tile);
      const t = tile(req.target);
      return k && t ? { ...req, tile: k, target: t } : null;
    }
    case "promoteTile": {
      const k = tile(req.tile);
      const b = req.before === null ? null : keys.tab(req.before);
      if (!k || (req.before !== null && !b)) return null;
      return { op: "promoteTile", tile: k, before: b };
    }
    case "mergeTab": {
      const k = keys.tab(req.tab);
      const t = tile(req.target);
      return k && t ? { ...req, tab: k, target: t } : null;
    }
    case "openOrchTab": {
      const out: LayoutRequest = { op: "openOrchTab" };
      if (req.runId) out.runId = req.runId.slice(0, MAX_KEY);
      if (req.workspace) out.workspace = req.workspace.slice(0, MAX_KEY);
      return out;
    }
  }
}

// ── 받는 쪽(주 창) ──

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const key = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_KEY;
const optStr = (v: unknown, max = MAX_NAME): v is string | undefined =>
  v === undefined || (typeof v === "string" && v.length <= max);
const splitDir = (v: unknown): v is SplitDir => v === "row" || v === "col";
const side = (v: unknown): v is PaneSide => v === "before" || v === "after";
const focusDir = (v: unknown): v is FocusDir => v === "left" || v === "right" || v === "up" || v === "down";
const paneShape = (v: unknown): v is PaneSpec => isObj(v) && typeof v.kind === "string";
const optBool = (v: unknown): boolean => v === undefined || typeof v === "boolean";
const FILE_UI_KEYS = new Set(["op", "tile", "view", "zoom", "places", "preview", "hidden"]);

/** GUI 가 이미 걸렀지만 주 창이 한 번 더 거른다 */
export function parseLayoutRequest(v: unknown): LayoutRequest | null {
  if (!isObj(v) || typeof v.op !== "string") return null;
  const r = v as Record<string, unknown>;
  switch (v.op as LayoutOp) {
    case "newTab":
      if ((r.pane !== undefined && !paneShape(r.pane)) || !optStr(r.title) || !optStr(r.projectFolder, 4096) || !optStr(r.projectId, MAX_KEY)) return null;
      if (r.workspace !== undefined && !(typeof r.workspace === "string" && r.workspace.length > 0 && r.workspace.length <= MAX_KEY)) return null;
      return v as LayoutRequest;
    case "openPane":
      if (!paneShape(r.pane) || (r.tab !== undefined && !key(r.tab)) || (r.near !== undefined && !key(r.near))) return null;
      if (!optStr(r.title) || !optStr(r.projectId, MAX_KEY)) return null;
      return v as LayoutRequest;
    case "openBeside":
      if (!key(r.tile) || !paneShape(r.pane) || (r.dir !== undefined && !splitDir(r.dir)) || (r.side !== undefined && !side(r.side))) return null;
      return v as LayoutRequest;
    case "replaceTile":
      if (!key(r.tile) || !paneShape(r.pane) || !optStr(r.title)) return null;
      return v as LayoutRequest;
    case "split":
      if (!key(r.tile) || (r.dir !== undefined && !splitDir(r.dir))) return null;
      return v as LayoutRequest;
    case "tmuxTile":
      if (!key(r.tile) || !(r.name === null || (typeof r.name === "string" && r.name.length <= MAX_NAME))) return null;
      return v as LayoutRequest;
    case "closeTile":
      return key(r.tile) ? (v as LayoutRequest) : null;
    case "closeTabs":
      if (!Array.isArray(r.tabs) || r.tabs.length === 0 || r.tabs.length > MAX_TABS || !r.tabs.every(key)) return null;
      return v as LayoutRequest;
    case "renameTab":
      return key(r.tab) && typeof r.name === "string" && r.name.length <= MAX_NAME ? (v as LayoutRequest) : null;
    case "reorderTab":
      return key(r.tab) && (r.before === null || key(r.before)) ? (v as LayoutRequest) : null;
    case "moveTile":
      if (r.stay !== undefined && r.stay !== true) return null;
      return key(r.tile) && key(r.target) && splitDir(r.dir) && side(r.side) ? (v as LayoutRequest) : null;
    case "promoteTile":
      return key(r.tile) && (r.before === null || key(r.before)) ? (v as LayoutRequest) : null;
    case "mergeTab":
      return key(r.tab) && key(r.target) && splitDir(r.dir) && side(r.side) ? (v as LayoutRequest) : null;
    case "swapTile":
    case "expandTile":
      return key(r.tile) && focusDir(r.dir) ? (v as LayoutRequest) : null;
    case "openOrchTab":
      for (const f of [r.runId, r.workspace]) if (f !== undefined && !(typeof f === "string" && f.length > 0 && f.length <= MAX_KEY)) return null;
      return v as LayoutRequest;
    case "fileUi":
      if (!key(r.tile) || Object.keys(r).some((k) => !FILE_UI_KEYS.has(k))) return null;
      if ((r.view !== undefined && !isFileView(r.view)) || (r.zoom !== undefined && clampFileZoom(r.zoom) === null)) return null;
      if (!optBool(r.places) || !optBool(r.preview) || !optBool(r.hidden)) return null;
      if ([r.view, r.zoom, r.places, r.preview, r.hidden].every((f) => f === undefined)) return null;
      return v as LayoutRequest;
    default:
      return null;
  }
}

function leavesOf(node: PaneNode, out: PaneSpec[] = []): PaneSpec[] {
  if (node.type === "leaf") out.push(node.pane);
  else {
    leavesOf(node.a, out);
    leavesOf(node.b, out);
  }
  return out;
}

export function findTileByKey(tabs: readonly TabSpec[], k: string): { tabId: string; paneId: string } | null {
  const byKey = k.startsWith("k:") ? k.slice(2) : null;
  const byId = k.startsWith("i:") ? k.slice(2) : null;
  if (!byKey && !byId) return null;
  for (const tab of tabs) {
    for (const p of leavesOf(tab.root)) {
      if ((byKey !== null && p.tileKey === byKey) || (byId !== null && p.id === byId)) return { tabId: tab.id, paneId: p.id };
    }
  }
  return null;
}

export function findTabByKey(tabs: readonly TabSpec[], k: string): string | null {
  if (k.startsWith("k:")) return tabs.find((t) => t.tabKey === k.slice(2))?.id ?? null;
  if (k.startsWith("i:")) return tabs.find((t) => t.id === k.slice(2))?.id ?? null;
  return null;
}
