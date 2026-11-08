// 집 PC 화면 배치 거울의 **스냅숏 모양**(원격 웹 R2-B — 설계 5절). 순수 모듈 — 상태 저장소 · invoke 를 모른다.
//
// 집 PC 주 창이 **제 워크스페이스 전부**(10-20 — 판 2)의 탭 줄 · 타일 트리 · 포커스를 이 모양으로 GUI 에 올리고
// (`app/mirror-publish.svelte.ts` → `mirror_publish`), 원격 창이 받아 그린다(`app/mirror.svelte.ts` · `mirror/reduce.ts`). 원격이
// `workspaces.json` 을 읽어 그릴 때도(집 PC 주 창이 없음 — 트레이) 같은 모양으로 만든다(그때는 활성 워크스페이스 하나만).
//
// **워크스페이스 목록**(`workspaces` — 순서 그대로): 이름 · 아이콘 · 색 · 그 워크스페이스의 활성 탭(지금 것은 `activeTabId` 와 같고,
// 나머지는 집 PC 가 기억한 마지막 활성 탭). 집 PC 가 이번 실행에서 아직 열지 않은 워크스페이스(cold — 탭 객체 · 세션이 아직 없다)는
// `cold` + 저장된 탭 수만 싣고 탭은 싣지 않는다(원격이 붙을 세션이 없다 — 고르기 화면이 "집 PC 에서 먼저 열기" 를 안내한다).
// 탭마다 소속(`workspaceId`)이 붙는다. `workspace` · `activeTabId` 는 집 PC 가 **지금 보는** 워크스페이스다.
//
// **허용 칸만 싣는다**([`sanitizePane`] — 명시 목록). 실리지 않는 것: 1회용 실행 재료(`autorun` · `cwd` · `setup` · `worktree` ·
// `openDelay` · `restore` 의 화면 버퍼) · AI 타일 표식(`injectMcpToken`) · 이관 재시작 명세(`restart`).
// 원격의 터미널 타일은 시청자로 **붙기만** 하므로 세션을 여는 재료가 필요 없고, 남이 시킨 명령을 원격이 다시 돌릴 길도 없어야 한다.
// 비밀(볼트 값 · 토큰)은 애초에 탭 명세에 없다.
// **타일 ↔ 대화 연결**(`agentLink` — 종류 · 대화 id)은 싣는다(10-26): 원격 창은 붙은 뒤의 훅 신호로만 연결을 알아, Codex 처럼 첫 질문 전에는
// 신호가 없는 타일의 대화 면이 통째로 비었다. 대화 id 는 원격이 이미 보는 지난 대화 목록의 열쇠라 새로 나가는 것이 없다.
//
// **타일의 보이는 모습**(`views` — 10-16 모바일 라벨): 원격은 `autorun` 을 받지 않으니 AI 타일을 셸 이름("PowerShell 7")으로 부르게 된다.
// 그래서 집 PC 가 화면에 이미 그리는 것 중 셋만 따로 싣는다([`sanitizeView`] — 명시 목록): 도는 AI 의 종류(`claude`·`codex` 만) ·
// 에이전트 상태(실행 중 · 권한 대기 · 완료) · 작업 폴더의 **마지막 이름 한 토막**(경로 원문 · 명령 · 토큰 · OSC 제목 원문은 싣지 않는다).
//
// **시작 화면 한 벌**(`startBoard` — 2026-11-04 · docs/log/2026-11-04-start-board-mirror.md): 위젯 배치(종류 · 자리 · 크기)와 시계 표시뿐이다 — 위젯 안의 호스트 · 프로젝트 줄은 싣지 않는다.
// 칸이 없으면(저장된 배치 · 옛 판) 원격은 마지막으로 받은 값을 둔다. 선택 칸이라 판을 올리지 않는다(옛 쪽은 모르는 칸을 버린다).

import type { AgentStatus } from "$lib/agent-status";
import { folderNameOf } from "$lib/pane-chips";
import type { PaneNode, PaneSpec, QuerySpec, TabSpec } from "$lib/session/spec";
import { parseOrchMark, saveOrchMark } from "$lib/orchestration/orch-tab";
import { parseStartBoard, plainStartBoard, type StartBoardSnapshot } from "$lib/start-widgets";

/** 스냅숏 판 — 모양이 바뀌면 올린다(원격은 모르는 판을 버린다). */
export const MIRROR_VERSION = 2;

export type MirrorNode =
  | { type: "leaf"; pane: PaneSpec }
  | { type: "split"; dir: "row" | "col"; ratio: number; px?: number; a: MirrorNode; b: MirrorNode };

export interface MirrorTab {
  /** 집 PC 의 탭 id(그 창 안에서만 뜻이 있다) */
  id: string;
  /** 소속 워크스페이스 id(`MirrorSnapshot.workspaces` 의 하나 — cold 가 아닌 것) */
  workspaceId: string;
  /** 영속 열쇠(있으면 — 원격이 같은 탭을 알아보는 열쇠) */
  tabKey?: string;
  title: string;
  name?: string;
  pinnedTitle?: string;
  projectId?: string;
  projectFolder?: string;
  /** 오케스트레이션 탭의 표지(2026-10-29 — `TabSpec.orch`) */
  orch?: TabSpec["orch"];
  root: MirrorNode;
  /** 그 탭의 포커스 타일(집 PC 의 pane id) */
  focus: string | null;
  /** 최대화한 타일(집 PC 의 pane id) */
  zoomedPaneId?: string | null;
}

/** 워크스페이스 한 줄 — 화면 이름과 그 워크스페이스의 활성 탭만(파일 머리말) */
export interface MirrorWorkspace {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  /** 집 PC 가 아직 열지 않았다 — 탭을 싣지 않고 저장된 탭 수만 */
  cold?: true;
  /** cold 일 때 저장된 탭 수 */
  tabCount?: number;
  /** 그 워크스페이스의 활성 탭(집 PC 의 tab id — cold 면 `null`) */
  activeTabId: string | null;
}

export interface MirrorSnapshot {
  v: number;
  /** 어디서 왔나 — 집 PC 주 창(`home`) · 저장된 배치(`file` — 원격이 스스로 만든다) */
  source: "home" | "file";
  /** 집 PC 가 지금 보는 워크스페이스 */
  workspace: { id: string; name: string } | null;
  /** 워크스페이스 목록(순서 그대로 · 비지 않는다 · 지금 것을 반드시 담는다) */
  workspaces: MirrorWorkspace[];
  /** 지금 워크스페이스의 활성 탭 */
  activeTabId: string | null;
  tabs: MirrorTab[];
  /** 집 PC pane id → 그 타일의 보이는 모습(있는 타일만 — 파일 머리말) */
  views?: Record<string, PaneView>;
  /** 집 PC 주 창의 시작 화면 한 벌(파일 머리말) — 저장된 배치에서 지은 스냅숏에는 없다 */
  startBoard?: StartBoardSnapshot;
}

/** 타일의 **보이는 모습** — 집 PC 가 이미 화면에 그리는 것만(원격 라벨 재료). 전부 선택 칸. */
export interface PaneView {
  /** 도는 AI CLI */
  ai?: "claude" | "codex";
  /** 에이전트 상태 점 */
  agent?: AgentStatus;
  /** 작업 폴더의 마지막 이름 한 토막 */
  folder?: string;
}

const AI_KINDS: readonly string[] = ["claude", "codex"];
const AGENT_STATES: readonly string[] = ["running", "permission", "finished"];
/** 폴더 한 토막의 길이 상한 — 화면 이름이지 경로가 아니다 */
const FOLDER_MAX = 64;
/** 워크스페이스 수 · 이름 · 아이콘 · 색 글자의 상한(받는 쪽이 자른다) */
export const MAX_WORKSPACES = 64;
const WS_NAME_MAX = 200;
const WS_STYLE_MAX = 128;
/** 워크스페이스를 모를 때(저장된 배치에 이름 없음 등) 탭에 다는 소속 */
export const FALLBACK_WS = "mirror";

/**
 * **보이는 모습 하나를 거른다** — 순수 · 명시 목록. 모르는 AI · 상태는 버리고, 폴더는 마지막 이름 한 토막만(구분자가 남지 않게
 * 한 번 더 자른다 · 길이 상한). 남는 칸이 없으면 `null`.
 */
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

/** 쿼리 타일 주소에서 싣는 칸 — 연결 · 초안 · 행 상한 · 스크립트 탭(화면용 이름 포함) */
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

/** 값이 있으면 복사(객체는 얕은 복사 — 원본 프록시를 거울에 매달지 않는다) */
function copyIf<T>(v: T | undefined): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object") return Array.isArray(v) ? (v.map((x) => (typeof x === "object" && x ? { ...x } : x)) as T) : { ...v };
  return v;
}

/**
 * **타일 명세 한 장 → 거울에 싣는 명세** — 순수 · 명시 목록. 실리지 않는 칸은 파일 머리말.
 * `deferred` 는 싣는다(집 PC 에서 아직 연결하지 않은 SSH 타일 — 원격은 붙을 세션이 없음을 안내한다).
 */
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

/** 스냅숏을 짓는 재료 — 집 PC 주 창의 탭 모듈 값(또는 원격이 저장된 배치에서 되살린 탭) */
export interface SnapshotInput {
  source: "home" | "file";
  workspace: { id: string; name: string } | null;
  /** 워크스페이스 목록(없으면 `workspace` 하나 — 저장된 배치). 탭의 소속은 `tab.workspaceId`(없으면 `workspace`). */
  workspaces?: readonly MirrorWorkspace[];
  tabs: readonly TabSpec[];
  activeTabId: string | null;
  /** 그 탭의 포커스 타일 id */
  focusOf: (tab: TabSpec) => string | null;
  /** 타일의 보이는 모습(집 PC 주 창만 — 저장된 배치는 모른다). 결과는 [`sanitizeView`] 를 지난다. */
  viewOf?: (pane: PaneSpec) => PaneView | null;
  /** 시작 화면 한 벌(집 PC 주 창만) */
  startBoard?: StartBoardSnapshot;
}

/** **스냅숏을 짓는다** — 순수. 탭 순서 그대로, 잎마다 [`sanitizePane`]. */
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
    // 한 번 더 거른다 — 받은 것도 허용 칸만(보내는 쪽이 낡았거나 다른 판이어도 실행 재료가 들어오지 않게).
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

/**
 * **받은 스냅숏을 읽는다** — 순수. 판이 다르거나 모양이 깨졌으면 `null`(원격은 옛 장을 그대로 둔다). 깨진 탭 하나는 그 탭만 버린다.
 */
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
    // 소속이 없으면 지금 워크스페이스. 목록에 없거나 cold 인 워크스페이스의 탭은 버린다(cold 는 탭을 싣지 않는다).
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
  // 보이는 모습도 받은 것을 한 번 더 거른다(보내는 쪽이 낡았어도 허용 칸만)
  const views = isObj(v.views) ? viewsOf(Object.entries(v.views)) : undefined;
  if (views) out.views = views;
  // 시작 화면 한 벌 — 허용 칸만 · 깨졌으면 없는 것처럼(원격은 마지막으로 받은 값을 둔다)
  const board = parseStartBoard(v.startBoard);
  if (board) out.startBoard = plainStartBoard(board);
  return out;
}

/**
 * 워크스페이스 목록을 읽는다 — 순수 · 허용 칸만. 깨진 줄 · 겹친 id 는 버리고 [`MAX_WORKSPACES`] 에서 자른다. 지금 워크스페이스(`current`)는
 * cold 로 왔어도 cold 가 아니다(지금 보는 것은 탭이 있다) · 목록에 없으면 맨 앞에 세운다 · 목록이 비면 [`FALLBACK_WS`] 하나.
 */
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
