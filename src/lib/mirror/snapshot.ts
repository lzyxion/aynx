// 메인 PC 화면 배치 거울의 스냅숏 모양 — 순수 모듈. 원격으로 나가는 칸은 아래 명시 목록뿐이다(→ docs/invariants.md 전문 13).
// 타일 명세([`sanitizePane`])는 1회용 실행 재료(`autorun` · `cwd` · `setup` · `worktree` · `openDelay` · `restore` 화면 버퍼) ·
// `injectMcpToken` · `restart` 를 싣지 않는다 — 원격 터미널은 시청자로 붙기만 하고, 남이 시킨 명령을 원격이 다시 돌릴 길이 없어야 한다.
// `agentLink` 의 대화 id 는 원격이 이미 보는 지난 대화 목록의 열쇠라 새로 나가는 것이 없다.
// 보이는 모습([`sanitizeView`])은 AI 종류 · 에이전트 상태 · 폴더 마지막 이름 한 토막뿐 — 경로 원문 · 명령 · 토큰 · OSC 제목 원문은 싣지 않는다.
// 시작 화면(`startBoard`)은 위젯 배치와 시계 표시뿐 — 위젯 안의 호스트 · 프로젝트 줄은 싣지 않는다. 선택 칸이라 판을 올리지 않는다.

import type { AgentStatus } from "$lib/agent-status";
import { folderNameOf } from "$lib/pane-chips";
import type { PaneNode, PaneSpec, QuerySpec, TabSpec } from "$lib/session/spec";
import { parseOrchMark, saveOrchMark } from "$lib/orchestration/orch-tab";
import { parseStartBoard, plainStartBoard, type StartBoardSnapshot } from "$lib/start-widgets";

/** 모양이 바뀌면 올린다 — 원격은 모르는 판을 버린다 */
export const MIRROR_VERSION = 2;

export type MirrorNode =
  | { type: "leaf"; pane: PaneSpec }
  | { type: "split"; dir: "row" | "col"; ratio: number; px?: number; a: MirrorNode; b: MirrorNode };

export interface MirrorTab {
  id: string;
  workspaceId: string;
  tabKey?: string;
  title: string;
  name?: string;
  pinnedTitle?: string;
  projectId?: string;
  projectFolder?: string;
  orch?: TabSpec["orch"];
  root: MirrorNode;
  focus: string | null;
  zoomedPaneId?: string | null;
}

export interface MirrorWorkspace {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  /** 메인 PC 가 아직 열지 않았다 — 탭을 싣지 않고 저장된 탭 수만 */
  cold?: true;
  tabCount?: number;
  activeTabId: string | null;
}

export interface MirrorSnapshot {
  v: number;
  source: "home" | "file";
  workspace: { id: string; name: string } | null;
  workspaces: MirrorWorkspace[];
  activeTabId: string | null;
  tabs: MirrorTab[];
  views?: Record<string, PaneView>;
  startBoard?: StartBoardSnapshot;
}

export interface PaneView {
  ai?: "claude" | "codex";
  agent?: AgentStatus;
  folder?: string;
}

const AI_KINDS: readonly string[] = ["claude", "codex"];
const AGENT_STATES: readonly string[] = ["running", "permission", "finished"];
const FOLDER_MAX = 64;
export const MAX_WORKSPACES = 64;
const WS_NAME_MAX = 200;
const WS_STYLE_MAX = 128;
export const FALLBACK_WS = "mirror";

export function sanitizeView(v: unknown): PaneView | null {
  if (typeof v !== "object" || v === null) return null;
  const src = v as Record<string, unknown>;
  const out: PaneView = {};
  if (typeof src.ai === "string" && AI_KINDS.includes(src.ai)) out.ai = src.ai as PaneView["ai"];
  if (typeof src.agent === "string" && AGENT_STATES.includes(src.agent)) out.agent = src.agent as AgentStatus;
  if (typeof src.folder === "string") {
    const leaf = folderNameOf(src.folder).replace(/[\\/]/g, "").trim();
    if (leaf && leaf !== "~" && !/^[A-Za-z]:$/.test(leaf)) out.folder = leaf.slice(0, FOLDER_MAX);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function viewsOf(entries: Iterable<[string, unknown]>): Record<string, PaneView> | undefined {
  const out: Record<string, PaneView> = {};
  for (const [id, raw] of entries) {
    const v = sanitizeView(raw);
    if (v) out[id] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeQuery(q: QuerySpec | undefined): QuerySpec | undefined {
  if (!q || typeof q.connId !== "string") return undefined;
  const out: QuerySpec = { connId: q.connId };
  if (typeof q.sql === "string") out.sql = q.sql;
  if (typeof q.maxRows === "number") out.maxRows = q.maxRows;
  if (Array.isArray(q.scripts)) out.scripts = q.scripts.map((s) => ({ ...s }));
  if (typeof q.active === "number") out.active = q.active;
  if (typeof q.name === "string") out.name = q.name;
  return out;
}

/** 얕은 복사 — 원본 프록시를 거울에 매달지 않는다 */
function copyIf<T>(v: T | undefined): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object") return Array.isArray(v) ? (v.map((x) => (typeof x === "object" && x ? { ...x } : x)) as T) : { ...v };
  return v;
}

export function sanitizePane(p: PaneSpec): PaneSpec {
  const out: PaneSpec = { id: p.id, kind: p.kind };
  const keep = <K extends keyof PaneSpec>(k: K) => {
    const v = copyIf(p[k]);
    if (v !== undefined) out[k] = v as PaneSpec[K];
  };
  keep("tileKey");
  keep("alias");
  keep("adhoc");
  keep("sourcePaneId");
  keep("path");
  keep("fileView");
  keep("fileZoom");
  keep("filePlaces");
  keep("filePreview");
  keep("fileHidden");
  keep("docMode");
  keep("docOutline");
  keep("docFiles");
  keep("docEditView");
  keep("docSplit");
  keep("docZoom");
  keep("docPreview");
  keep("shell");
  keep("tmux");
  keep("scrollback");
  keep("noTmux");
  keep("forceTmux");
  keep("deferred");
  keep("historyStreamId");
  keep("startProject");
  keep("branchGraph");
  keep("diff");
  keep("run");
  keep("producer");
  keep("agentLink");
  const q = sanitizeQuery(p.query);
  if (q) out.query = q;
  return out;
}

function nodeOf(node: PaneNode): MirrorNode {
  if (node.type === "leaf") return { type: "leaf", pane: sanitizePane(node.pane) };
  return { type: "split", dir: node.dir, ratio: node.ratio, ...(node.px ? { px: node.px } : {}), a: nodeOf(node.a), b: nodeOf(node.b) };
}

export interface SnapshotInput {
  source: "home" | "file";
  workspace: { id: string; name: string } | null;
  workspaces?: readonly MirrorWorkspace[];
  tabs: readonly TabSpec[];
  activeTabId: string | null;
  focusOf: (tab: TabSpec) => string | null;
  viewOf?: (pane: PaneSpec) => PaneView | null;
  startBoard?: StartBoardSnapshot;
}

export function buildSnapshot(input: SnapshotInput): MirrorSnapshot {
  const viewOf = input.viewOf;
  const views = viewOf
    ? viewsOf(input.tabs.flatMap((tab) => leavesOf(tab.root)).map((p): [string, unknown] => [p.id, viewOf(p)]))
    : undefined;
  const current = input.workspace ? { id: input.workspace.id, name: input.workspace.name } : null;
  const fallbackWs = current?.id ?? FALLBACK_WS;
  const workspaces = (input.workspaces ?? [{ id: fallbackWs, name: current?.name ?? "", activeTabId: input.activeTabId }]).map(copyWorkspace);
  const snap: MirrorSnapshot = {
    v: MIRROR_VERSION,
    source: input.source,
    workspace: current,
    workspaces,
    activeTabId: input.activeTabId,
    tabs: input.tabs.map((tab) => {
      const t: MirrorTab = {
        id: tab.id,
        workspaceId: tab.workspaceId ?? fallbackWs,
        title: tab.title,
        root: nodeOf(tab.root),
        focus: input.focusOf(tab),
      };
      if (tab.tabKey) t.tabKey = tab.tabKey;
      if (tab.name !== undefined) t.name = tab.name;
      if (tab.pinnedTitle !== undefined) t.pinnedTitle = tab.pinnedTitle;
      if (tab.projectId !== undefined) t.projectId = tab.projectId;
      if (tab.projectFolder !== undefined) t.projectFolder = tab.projectFolder;
      if (tab.orch) t.orch = saveOrchMark(tab.orch);
      if (tab.zoomedPaneId) t.zoomedPaneId = tab.zoomedPaneId;
      return t;
    }),
  };
  if (views) snap.views = views;
  if (input.startBoard) snap.startBoard = plainStartBoard(input.startBoard);
  return snap;
}

function copyWorkspace(w: MirrorWorkspace): MirrorWorkspace {
  const out: MirrorWorkspace = { id: w.id, name: w.name, activeTabId: w.cold ? null : w.activeTabId };
  if (w.icon) out.icon = w.icon;
  if (w.color) out.color = w.color;
  if (w.cold) {
    out.cold = true;
    out.tabCount = w.tabCount ?? 0;
  }
  return out;
}

function leavesOf(node: PaneNode): PaneSpec[] {
  return node.type === "leaf" ? [node.pane] : [...leavesOf(node.a), ...leavesOf(node.b)];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";

function parseNode(v: unknown, depth: number): MirrorNode | null {
  if (!isObj(v) || depth > 64) return null;
  if (v.type === "leaf") {
    const p = v.pane;
    if (!isObj(p) || !str(p.id) || !str(p.kind)) return null;
    // 받은 것도 다시 거른다 — 보내는 쪽이 낡았거나 다른 판이어도 실행 재료가 들어오지 않게
    return { type: "leaf", pane: sanitizePane(p as unknown as PaneSpec) };
  }
  if (v.type === "split") {
    const a = parseNode(v.a, depth + 1);
    const b = parseNode(v.b, depth + 1);
    if (!a || !b || (v.dir !== "row" && v.dir !== "col")) return null;
    const ratio = typeof v.ratio === "number" && Number.isFinite(v.ratio) ? v.ratio : 0.5;
    const px = typeof v.px === "number" && Number.isFinite(v.px) && v.px !== 0 ? { px: v.px } : {};
    return { type: "split", dir: v.dir, ratio, ...px, a, b };
  }
  return null;
}

export function parseSnapshot(v: unknown): MirrorSnapshot | null {
  if (!isObj(v) || v.v !== MIRROR_VERSION || !Array.isArray(v.tabs)) return null;
  const ws = isObj(v.workspace) && str(v.workspace.id) ? { id: v.workspace.id, name: str(v.workspace.name) ? v.workspace.name : "" } : null;
  const workspaces = parseWorkspaces(v.workspaces, ws);
  const live = new Set(workspaces.filter((w) => !w.cold).map((w) => w.id));
  const fallbackWs = ws?.id ?? workspaces[0].id;
  const tabs: MirrorTab[] = [];
  for (const raw of v.tabs) {
    if (!isObj(raw) || !str(raw.id)) continue;
    const root = parseNode(raw.root, 0);
    if (!root) continue;
    const workspaceId = str(raw.workspaceId) ? raw.workspaceId : fallbackWs;
    if (!live.has(workspaceId)) continue;
    const t: MirrorTab = {
      id: raw.id,
      workspaceId,
      title: str(raw.title) ? raw.title : "",
      root,
      focus: str(raw.focus) ? raw.focus : null,
    };
    if (str(raw.tabKey)) t.tabKey = raw.tabKey;
    if (str(raw.name)) t.name = raw.name;
    if (str(raw.pinnedTitle)) t.pinnedTitle = raw.pinnedTitle;
    if (str(raw.projectId)) t.projectId = raw.projectId;
    if (str(raw.projectFolder)) t.projectFolder = raw.projectFolder;
    const orch = parseOrchMark(raw.orch);
    if (orch) t.orch = orch;
    if (str(raw.zoomedPaneId)) t.zoomedPaneId = raw.zoomedPaneId;
    tabs.push(t);
  }
  const out: MirrorSnapshot = {
    v: MIRROR_VERSION,
    source: v.source === "file" ? "file" : "home",
    workspace: ws,
    workspaces,
    activeTabId: str(v.activeTabId) ? v.activeTabId : null,
    tabs,
  };
  const views = isObj(v.views) ? viewsOf(Object.entries(v.views)) : undefined;
  if (views) out.views = views;
  const board = parseStartBoard(v.startBoard);
  if (board) out.startBoard = plainStartBoard(board);
  return out;
}

function parseWorkspaces(v: unknown, current: { id: string; name: string } | null): MirrorWorkspace[] {
  const out: MirrorWorkspace[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= MAX_WORKSPACES) break;
    if (!isObj(raw) || !str(raw.id) || raw.id === "" || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const w: MirrorWorkspace = {
      id: raw.id,
      name: str(raw.name) ? raw.name.slice(0, WS_NAME_MAX) : "",
      activeTabId: str(raw.activeTabId) ? raw.activeTabId : null,
    };
    if (str(raw.icon) && raw.icon.length <= WS_STYLE_MAX) w.icon = raw.icon;
    if (str(raw.color) && raw.color.length <= WS_STYLE_MAX) w.color = raw.color;
    if (raw.cold === true && raw.id !== current?.id) {
      w.cold = true;
      w.activeTabId = null;
      const n = raw.tabCount;
      w.tabCount = typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.floor(n))) : 0;
    }
    out.push(w);
  }
  if (current && !seen.has(current.id)) out.unshift({ id: current.id, name: current.name, activeTabId: null });
  if (out.length === 0) out.push({ id: FALLBACK_WS, name: "", activeTabId: null });
  return out;
}
