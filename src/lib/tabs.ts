import {
  clampRatio,
  clampScrollback,
  clampFileZoom,
  DEFAULT_FILE_ZOOM,
  closePane,
  isDocMode,
  isDocEditView,
  migrateFileView,
  leafOf,
  listPanes,
  newBranchesPane,
  newDiffPane,
  newRunPane,
  newProducerPane,
  newChatTilePane,
  newQueryPane,
  canonQueryTabs,
  storedRowLimit,
  type QueryScript,
  type QueryRowLimit,
  newDocPane,
  newImagePane,
  isFileLeafKind,
  newLocalFsPane,
  newLocalPane,
  newSftpPane,
  newAdhocSshPane,
  newSshPane,
  newProjectStartPane,
  newStartPane,
  restoredTab,
  type DiffScopeKind,
  type DocMode,
  type DocEditView,
  type FileView,
  type PaneKind,
  type PaneNode,
  type PaneSpec,
  type ProducerSpec,
  type ChatTileSpec,
  type OrchMark,
  type SplitDir,
  type TabSpec,
} from "$lib/session";
import { DOC_SPLIT_DEFAULT, clampDocSplit } from "$lib/doc-edit-preview";
import { DOC_ZOOM_DEFAULT, clampDocZoom } from "$lib/doc-zoom";
import { newProducerChatId, parseOrchMark, parseProducerSpec, saveOrchMark, saveProducerSpec } from "$lib/orchestration/orch-tab";
import { parseChatTileSpec, saveChatTileSpec } from "$lib/chat-tile/spec";

/**
 * 탭 배치 파일(`workspaces.json`)의 저장 · 복원 (docs/log/2026-09-03-workspace-restore.md).
 * 담는 것은 구조뿐이다 — 화면 내용 · 세션 id · 비밀번호는 파일에 남기지 않는다.
 * 복원된 SSH 타일은 연결 대기(`deferred`)로 뜬다 — 앱을 켜는 것만으로 요청하지 않은 접속이 일어나지 않게.
 */

export const TAB_FILE_VERSION = 1;

/** 칸 이름은 배치 파일에 글자 그대로 남는다 — 바꾸거나 지우면 옛 파일이 깨진다 */
export interface SavedLeaf {
  tileKey?: string;
  kind: PaneKind;
  /** 저장해야 AI 의 외부 참조 `(session, blockId)` 가 껐다 켠 뒤에도 같은 스트림을 가리킨다 */
  historyStreamId?: string;
  /** sftp 는 이 칸만 저장한다 — `sourcePaneId` 는 런타임 패널 id 라 담지 않고 복원 뒤 같은 별칭으로 다시 묶는다 */
  alias?: string;
  /** 빠른 접속 타일은 설정에 항목이 없다 — 파일이 그 대상을 아는 유일한 자리다 */
  adhoc?: { host: string; user?: string; port?: number };
  shell?: string;
  tmux?: string;
  noTmux?: boolean;
  forceTmux?: boolean;
  autorun?: string;
  cwd?: string;
  /** 표식일 뿐 토큰 자체는 파일에 없다 */
  injectMcpToken?: boolean;
  agentLink?: { agent: string; id: string };
  lastCwd?: string;
  scrollback?: number;
  path?: string;
  fileView?: FileView;
  fileZoom?: number;
  filePlaces?: false;
  filePreview?: true;
  fileHidden?: true;
  docMode?: DocMode;
  docOutline?: true;
  docFiles?: true;
  docEditView?: Exclude<DocEditView, "split">;
  docSplit?: number;
  docZoom?: number;
  /** 키가 없다 = 붙박이(이 칸을 모르던 옛 배치도) */
  docPreview?: true;
  startProject?: { projectId: string; folder: string; host?: string };
  branchGraph?: { projectId: string; branch?: string };
  diff?: SavedDiff;
  query?: SavedQuery;
  run?: { runId: string };
  producer?: ProducerSpec;
  chat?: ChatTileSpec;
}

/** 키 순서가 늘 같아야 한다(자동 저장의 문자열 비교) */
export interface SavedQuery {
  connId: string;
  sql?: string;
  maxRows?: QueryRowLimit;
  scripts?: QueryScript[];
  active?: number;
}

/** 키 순서가 늘 같아야 한다(자동 저장의 문자열 비교) */
export interface SavedDiff {
  projectId: string;
  scope: DiffScopeKind;
  branch?: string;
  worktreePath?: string;
  commit?: string;
  base?: string;
  tip?: string;
  file?: string;
  view?: "split";
}

export interface SavedSplit {
  dir: SplitDir;
  ratio: number;
  px?: number;
  a: SavedNode;
  b: SavedNode;
}

export type SavedNode = SavedLeaf | SavedSplit;

export interface SavedTab {
  tabKey?: string;
  projectId?: string;
  name?: string;
  pinnedTitle?: string;
  projectFolder?: string;
  orch?: OrchMark;
  title: string;
  root: SavedNode;
}

export interface TabFile {
  version: number;
  activeIndex: number;
  /** 필드 이름은 옛 이름 그대로다 — 바꾸면 이미 저장된 파일을 못 읽는다 */
  workspaces: SavedTab[];
}

export function isSavedSplit(node: SavedNode): node is SavedSplit {
  return typeof (node as SavedSplit).dir === "string";
}

// ---------------------------------------------------------------------------
// 직렬화 — 살아 있는 탭 → 파일 (순수)
// ---------------------------------------------------------------------------

/**
 * 런타임 전용 필드(`id` · `restore` · `openDelay` · `deferred`)는 떨군다 — 파일에 남으면 다음 실행이 지난 순간의 사정을 되살린다.
 */
function saveLeaf(pane: PaneSpec, workspaceKeys: boolean): SavedLeaf {
  if (workspaceKeys && pane.restart) pane = { ...pane, ...pane.restart };
  const out: SavedLeaf = { kind: pane.kind };
  if (workspaceKeys && pane.tileKey) out.tileKey = pane.tileKey;
  if (pane.alias) out.alias = pane.alias;
  if (pane.adhoc) {
    out.adhoc = {
      host: pane.adhoc.host,
      ...(pane.adhoc.user ? { user: pane.adhoc.user } : {}),
      ...(typeof pane.adhoc.port === "number" ? { port: pane.adhoc.port } : {}),
    };
  }
  if (pane.shell) out.shell = pane.shell;
  if (pane.tmux) out.tmux = pane.tmux;
  if (pane.noTmux) out.noTmux = true;
  if (pane.forceTmux) out.forceTmux = true;
  if (pane.autorun) out.autorun = pane.autorun;
  if (pane.cwd) out.cwd = pane.cwd;
  if (pane.injectMcpToken) out.injectMcpToken = true;
  if (pane.agentLink) out.agentLink = { agent: pane.agentLink.agent, id: pane.agentLink.id };
  if (pane.kind === "local" && pane.lastCwd) out.lastCwd = pane.lastCwd;
  if (typeof pane.scrollback === "number") out.scrollback = pane.scrollback;
  if (pane.path) out.path = pane.path;
  if (pane.fileView) out.fileView = pane.fileView;
  if (typeof pane.fileZoom === "number" && pane.fileZoom !== DEFAULT_FILE_ZOOM) out.fileZoom = pane.fileZoom;
  if (pane.filePlaces === false) out.filePlaces = false;
  if (pane.filePreview === true) out.filePreview = true;
  if (pane.fileHidden === true) out.fileHidden = true;
  if (pane.kind === "doc" && pane.docMode && pane.docMode !== "rendered") out.docMode = pane.docMode;
  if (pane.kind === "doc" && pane.docOutline === true) out.docOutline = true;
  if (pane.kind === "doc" && pane.docFiles === true) out.docFiles = true;
  if (pane.kind === "doc" && pane.docEditView) out.docEditView = pane.docEditView;
  if (pane.kind === "doc" && pane.docSplit !== undefined && pane.docSplit !== DOC_SPLIT_DEFAULT) out.docSplit = clampDocSplit(pane.docSplit);
  if (pane.kind === "doc" && pane.docZoom !== undefined) {
    const z = clampDocZoom(pane.docZoom);
    if (z !== null && z !== DOC_ZOOM_DEFAULT) out.docZoom = z;
  }
  if (pane.kind === "doc" && pane.docPreview === true) out.docPreview = true;
  if (pane.historyStreamId) out.historyStreamId = pane.historyStreamId;
  if (pane.kind === "start" && pane.startProject) {
    out.startProject = { projectId: pane.startProject.projectId, folder: pane.startProject.folder };
    if (pane.startProject.host) out.startProject.host = pane.startProject.host;
  }
  if (pane.kind === "branches" && pane.branchGraph?.projectId) {
    out.branchGraph = { projectId: pane.branchGraph.projectId };
    if (pane.branchGraph.branch) out.branchGraph.branch = pane.branchGraph.branch;
  }
  if (pane.kind === "diff" && pane.diff?.projectId) {
    const d = pane.diff;
    const sd: SavedDiff = { projectId: d.projectId, scope: d.scope };
    if (d.branch) sd.branch = d.branch;
    if (d.worktreePath) sd.worktreePath = d.worktreePath;
    if (d.commit) sd.commit = d.commit;
    if (d.base) sd.base = d.base;
    if (d.tip) sd.tip = d.tip;
    if (d.file) sd.file = d.file;
    if (d.view === "split") sd.view = "split";
    out.diff = sd;
  }
  if (pane.kind === "query" && pane.query?.connId) {
    const q = pane.query;
    const sq: SavedQuery = { connId: q.connId };
    const tabs = canonQueryTabs(q);
    if (tabs.sql !== undefined) sq.sql = tabs.sql;
    const rows = storedRowLimit(q.maxRows);
    if (rows !== undefined) sq.maxRows = rows;
    if (tabs.scripts) {
      sq.scripts = tabs.scripts;
      sq.active = tabs.active;
    }
    out.query = sq;
  }
  if (pane.kind === "run" && pane.run?.runId) out.run = { runId: pane.run.runId };
  if (pane.kind === "producer" && pane.producer) out.producer = saveProducerSpec(pane.producer);
  if (pane.kind === "chat" && pane.chat) out.chat = saveChatTileSpec(pane.chat);
  return out;
}

export function saveNode(node: PaneNode, workspaceKeys = false): SavedNode {
  if (node.type === "leaf") return saveLeaf(node.pane, workspaceKeys);
  return {
    dir: node.dir,
    ratio: node.ratio,
    ...(node.px ? { px: node.px } : {}),
    a: saveNode(node.a, workspaceKeys),
    b: saveNode(node.b, workspaceKeys),
  };
}

/**
 * 자동 저장이 이 결과의 `JSON.stringify` 를 직전 값과 비교한다 — 같은 배치면 같은 문자열이 나와야 한다
 * (키 순서 고정 · 값이 있을 때만 담는다 · `undefined` 를 넣으면 키 유무가 흔들린다).
 */
export function serialize(tabs: readonly TabSpec[], activeId: string | null): TabFile {
  const at = tabs.findIndex((t) => t.id === activeId);
  return {
    version: TAB_FILE_VERSION,
    activeIndex: at < 0 ? 0 : at,
    workspaces: tabs.map((tab) => {
      const name = tab.name?.trim();
      const pinnedTitle = tab.pinnedTitle?.trim();
      const projectFolder = tab.projectFolder?.trim();
      const orch = saveOrchMark(tab.orch);
      return {
        ...(name ? { name } : {}),
        ...(pinnedTitle ? { pinnedTitle } : {}),
        ...(projectFolder ? { projectFolder } : {}),
        ...(orch ? { orch } : {}),
        ...(tab.tabKey ? { tabKey: tab.tabKey } : {}),
        ...(tab.projectId ? { projectId: tab.projectId } : {}),
        title: tab.title,
        root: saveNode(tab.root, true),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 검증 — 파일 → 믿을 수 있는 모양 (순수, 절대 throw 하지 않는다)
//
// 모르면 null 을 돌려주고 새 탭으로 시작한다 — 부분 복구는 하지 않는다(반쯤 복원된 배치는 무엇을 잃었는지 알 수 없다).
// ---------------------------------------------------------------------------

// 여기 없는 kind 의 잎이 하나라도 있으면 파일 전체가 `null` 로 떨어진다 — 새 타일 종류는 여기에 넣는다.
const KNOWN_KINDS: readonly PaneKind[] = ["local", "ssh", "sftp", "localfs", "start", "doc", "image", "branches", "diff", "query", "run", "producer", "chat"];

// 걷은 종류 — 파일을 버리지 않고 잎만 뺀다. 지우면 옛 파일이 깨진다.
export const RETIRED_KINDS: readonly string[] = ["plans"];

function isRetiredLeaf(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const kind = (raw as Record<string, unknown>).kind;
  return typeof kind === "string" && RETIRED_KINDS.includes(kind);
}

export function pruneRetiredLeaves(node: SavedNode): SavedNode | null {
  return pruneLeaves(node, isRetiredLeaf);
}

function pruneLeaves(node: SavedNode, drop: (leaf: SavedNode) => boolean): SavedNode | null {
  if (isSavedSplit(node)) {
    const a = pruneLeaves(node.a, drop);
    const b = pruneLeaves(node.b, drop);
    if (a === null) return b;
    if (b === null) return a;
    return a === node.a && b === node.b ? node : { ...node, a, b };
  }
  return drop(node) ? null : node;
}

/** 호스트 문법은 보지 않는다 — 규칙은 `quick-connect.ts` 와 백엔드에 있고, 한 벌 더 두면 갈라진다 */
function parseAdhoc(raw: unknown): SavedLeaf["adhoc"] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const host = typeof o.host === "string" ? o.host.trim() : "";
  if (host === "") return null;
  const user = typeof o.user === "string" ? o.user.trim() : "";
  const port =
    typeof o.port === "number" && Number.isInteger(o.port) && o.port >= 1 && o.port <= 65535
      ? o.port
      : undefined;
  return {
    host,
    ...(user !== "" ? { user } : {}),
    ...(port !== undefined ? { port } : {}),
  };
}

function parseAgentLink(raw: unknown): SavedLeaf["agentLink"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { agent, id } = raw as Record<string, unknown>;
  if (agent !== "claude" && agent !== "codex") return null;
  if (typeof id !== "string" || !/^[0-9A-Za-z-]{8,64}$/.test(id)) return null;
  return { agent, id: id.toLowerCase() };
}

function parseLeaf(raw: Record<string, unknown>): SavedLeaf | null {
  const kind = raw.kind;
  if (isRetiredLeaf(raw)) return { kind: "start" };
  if (typeof kind !== "string" || !KNOWN_KINDS.includes(kind as PaneKind)) return null;
  const out: SavedLeaf = { kind: kind as PaneKind };
  if (typeof raw.tileKey === "string") out.tileKey = raw.tileKey;
  if (typeof raw.alias === "string" && raw.alias.trim() !== "") out.alias = raw.alias.trim();
  const adhoc = parseAdhoc(raw.adhoc);
  if (adhoc) out.adhoc = adhoc;
  if (typeof raw.shell === "string" && raw.shell.trim() !== "") out.shell = raw.shell.trim();
  // tmux 이름 · 시작 폴더 · 경로의 모양은 검사하지 않는다 — 판정은 백엔드 하나다(한 벌 더 두면 갈라진다).
  if (typeof raw.tmux === "string" && raw.tmux.trim() !== "") out.tmux = raw.tmux.trim();
  if (raw.noTmux === true) out.noTmux = true;
  if (raw.forceTmux === true) out.forceTmux = true;
  if (typeof raw.autorun === "string" && raw.autorun.trim() !== "") out.autorun = raw.autorun;
  if (typeof raw.cwd === "string" && raw.cwd.trim() !== "") out.cwd = raw.cwd.trim();
  if (raw.injectMcpToken === true) out.injectMcpToken = true;
  const link = parseAgentLink(raw.agentLink);
  if (link) out.agentLink = link;
  if (typeof raw.lastCwd === "string" && raw.lastCwd.trim() !== "") out.lastCwd = raw.lastCwd.trim();
  const lines = clampScrollback(typeof raw.scrollback === "number" ? raw.scrollback : undefined);
  if (lines !== undefined) out.scrollback = lines;
  if (typeof raw.path === "string" && raw.path.trim() !== "") out.path = raw.path.trim();
  const view = migrateFileView(raw.fileView);
  if (view) out.fileView = view;
  const zoom = clampFileZoom(raw.fileZoom);
  if (zoom !== null && zoom !== DEFAULT_FILE_ZOOM) out.fileZoom = zoom;
  if (raw.filePlaces === false) out.filePlaces = false;
  if (raw.filePreview === true) out.filePreview = true;
  if (raw.fileHidden === true) out.fileHidden = true;
  if (out.kind === "doc" && isDocMode(raw.docMode) && raw.docMode !== "rendered") out.docMode = raw.docMode;
  if (out.kind === "doc" && raw.docOutline === true) out.docOutline = true;
  if (out.kind === "doc" && raw.docFiles === true) out.docFiles = true;
  if (out.kind === "doc" && isDocEditView(raw.docEditView) && raw.docEditView !== "split") out.docEditView = raw.docEditView;
  if (out.kind === "doc" && typeof raw.docSplit === "number" && Number.isFinite(raw.docSplit)) {
    const r = clampDocSplit(raw.docSplit);
    if (r !== DOC_SPLIT_DEFAULT) out.docSplit = r;
  }
  if (out.kind === "doc") {
    const z = clampDocZoom(raw.docZoom);
    if (z !== null && z !== DOC_ZOOM_DEFAULT) out.docZoom = z;
  }
  if (out.kind === "doc" && raw.docPreview === true) out.docPreview = true;
  if (typeof raw.historyStreamId === "string" && raw.historyStreamId.trim() !== "")
    out.historyStreamId = raw.historyStreamId.trim();
  // 아래 주소 칸들은 못 쓸 모양이면 칸만 떨어진다 — 주소 없는 잎은 복원 뒤 [`rebindSftp`] 가 뺀다(여기서 null 을 주면 파일 전체가 날아간다).
  if (out.kind === "start" && raw.startProject && typeof raw.startProject === "object") {
    const sp = raw.startProject as Record<string, unknown>;
    const projectId = typeof sp.projectId === "string" ? sp.projectId.trim() : "";
    const folder = typeof sp.folder === "string" ? sp.folder.trim() : "";
    const host = typeof sp.host === "string" ? sp.host.trim() : "";
    if (projectId !== "" && folder !== "") out.startProject = host !== "" ? { projectId, folder, host } : { projectId, folder };
  }
  if (out.kind === "branches" && raw.branchGraph && typeof raw.branchGraph === "object") {
    const bg = raw.branchGraph as Record<string, unknown>;
    const projectId = typeof bg.projectId === "string" ? bg.projectId.trim() : "";
    const branch = typeof bg.branch === "string" ? bg.branch.trim() : "";
    if (projectId !== "") out.branchGraph = branch !== "" ? { projectId, branch } : { projectId };
  }
  if (out.kind === "diff" && raw.diff && typeof raw.diff === "object") {
    const d = raw.diff as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const projectId = text(d.projectId);
    const scope = d.scope;
    if (projectId !== "" && (scope === "branch" || scope === "commit" || scope === "wip" || scope === "range")) {
      const sd: SavedDiff = { projectId, scope };
      if (text(d.branch)) sd.branch = text(d.branch);
      if (text(d.worktreePath)) sd.worktreePath = text(d.worktreePath);
      if (text(d.commit)) sd.commit = text(d.commit);
      if (text(d.base)) sd.base = text(d.base);
      if (text(d.tip)) sd.tip = text(d.tip);
      if (typeof d.file === "string" && d.file !== "") sd.file = d.file;
      if (d.view === "split") sd.view = "split";
      out.diff = sd;
    }
  }
  if (out.kind === "query" && raw.query && typeof raw.query === "object") {
    const q = raw.query as Record<string, unknown>;
    const connId = typeof q.connId === "string" ? q.connId.trim() : "";
    if (connId !== "") {
      const sq: SavedQuery = { connId };
      const tabs = canonQueryTabs(q);
      if (tabs.sql !== undefined) sq.sql = tabs.sql;
      const rows = storedRowLimit(q.maxRows);
      if (rows !== undefined) sq.maxRows = rows;
      if (tabs.scripts) {
        sq.scripts = tabs.scripts;
        sq.active = tabs.active;
      }
      out.query = sq;
    }
  }
  if (out.kind === "run" && raw.run && typeof raw.run === "object") {
    const runId = (raw.run as Record<string, unknown>).runId;
    if (typeof runId === "string" && runId.trim() !== "") out.run = { runId: runId.trim() };
  }
  if (out.kind === "producer") {
    const p = parseProducerSpec(raw.producer);
    if (p) out.producer = p;
  }
  if (out.kind === "chat") {
    const c = parseChatTileSpec(raw.chat);
    if (c) out.chat = c;
  }
  if (out.kind === "ssh" && !out.alias) return null;
  if (out.kind === "sftp" && !out.alias) return null;
  // 경로 없는 문서 잎도 여기서 버리지 않는다 — null 을 돌려주면 파일 전체가 날아간다([`rebindSftp`] 가 뺀다).
  return out;
}

export function parseNode(
  raw: unknown,
  depth = 0,
): SavedNode | null {
  if (depth > 64 || !raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.dir === "string") {
    if (o.dir !== "row" && o.dir !== "col") return null;
    if (isRetiredLeaf(o.a)) return parseNode(o.b, depth + 1);
    if (isRetiredLeaf(o.b)) return parseNode(o.a, depth + 1);
    const a = parseNode(o.a, depth + 1);
    const b = parseNode(o.b, depth + 1);
    if (!a || !b) return null;
    return {
      dir: o.dir,
      ratio: clampRatio(typeof o.ratio === "number" ? o.ratio : NaN),
      ...(typeof o.px === "number" && Number.isFinite(o.px) && o.px !== 0 ? { px: o.px } : {}),
      a,
      b,
    };
  }
  return parseLeaf(o);
}

export function parseTabFile(json: string | null | undefined): TabFile | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== TAB_FILE_VERSION) return null;
  if (!Array.isArray(o.workspaces) || o.workspaces.length === 0) return null;

  const saved: SavedTab[] = [];
  for (const w of o.workspaces) {
    if (!w || typeof w !== "object") return null;
    const t = w as Record<string, unknown>;
    const root = parseNode(t.root);
    if (!root) return null;
    const name = typeof t.name === "string" ? t.name.trim() : "";
    const pinnedTitle = typeof t.pinnedTitle === "string" ? t.pinnedTitle.trim() : "";
    const projectFolder = typeof t.projectFolder === "string" ? t.projectFolder.trim() : "";
    const orch = parseOrchMark(t.orch);
    saved.push({
      ...(name ? { name } : {}),
      ...(pinnedTitle ? { pinnedTitle } : {}),
      ...(projectFolder ? { projectFolder } : {}),
      ...(orch ? { orch } : {}),
      ...(typeof t.tabKey === "string" ? { tabKey: t.tabKey } : {}),
      ...(typeof t.projectId === "string" ? { projectId: t.projectId } : {}),
      title: typeof t.title === "string" ? t.title : "",
      root,
    });
  }

  const at = typeof o.activeIndex === "number" ? Math.floor(o.activeIndex) : 0;
  return {
    version: TAB_FILE_VERSION,
    activeIndex: at >= 0 && at < saved.length ? at : 0,
    workspaces: saved,
  };
}

// ---------------------------------------------------------------------------
// 역직렬화 — 파일 → 살아 있는 탭 (순수, 새 id)
// ---------------------------------------------------------------------------

export interface DeserializeOptions {
  deferSsh?: boolean;
  /**
   * 처음 여는 배치(탭 템플릿)면 SSH 잎의 `cwd` · `autorun` 을 첫 접속의 재료로 되살린다 —
   * 복원은 tmux 로 다시 붙는 것이라 되살리지 않는다(`PaneSpec.cwd`).
   */
  firstRun?: boolean;
}

function paneFrom(leaf: SavedLeaf, deferSsh: boolean, firstRun = false): PaneSpec {
  const pane = basePaneFrom(leaf, deferSsh, firstRun);
  if (leaf.tileKey) pane.tileKey = leaf.tileKey;
  return pane;
}

function basePaneFrom(leaf: SavedLeaf, deferSsh: boolean, firstRun: boolean): PaneSpec {
  switch (leaf.kind) {
    case "ssh": {
      const pane = leaf.adhoc
        ? { ...newAdhocSshPane(leaf.adhoc), alias: leaf.alias ?? "" }
        : newSshPane(leaf.alias ?? "", leaf.scrollback ?? null);
      if (deferSsh) pane.deferred = true;
      if (leaf.tmux) pane.tmux = leaf.tmux;
      if (leaf.noTmux) pane.noTmux = true;
      if (leaf.forceTmux) pane.forceTmux = true;
      if (firstRun) {
        if (leaf.cwd) pane.cwd = leaf.cwd;
        if (leaf.autorun) pane.autorun = leaf.autorun;
      } else if (leaf.cwd) pane.restart = { cwd: leaf.cwd };
      if (leaf.historyStreamId) pane.historyStreamId = leaf.historyStreamId;
      if (leaf.agentLink) pane.agentLink = { ...leaf.agentLink };
      return pane;
    }
    case "local": {
      const pane = newLocalPane(leaf.shell);
      if (leaf.autorun) pane.autorun = leaf.autorun;
      if (leaf.cwd) pane.cwd = leaf.cwd;
      if (leaf.injectMcpToken) pane.injectMcpToken = true;
      if (leaf.lastCwd) pane.lastCwd = leaf.lastCwd;
      const lines = clampScrollback(leaf.scrollback);
      if (lines !== undefined) pane.scrollback = lines;
      if (leaf.historyStreamId) pane.historyStreamId = leaf.historyStreamId;
      if (leaf.agentLink) pane.agentLink = { ...leaf.agentLink };
      return pane;
    }
    case "start":
      return leaf.startProject
        ? newProjectStartPane(leaf.startProject.projectId, leaf.startProject.folder, leaf.startProject.host)
        : newStartPane();
    case "localfs": {
      const pane = newLocalFsPane(leaf.path);
      if (leaf.fileView) pane.fileView = leaf.fileView;
      if (leaf.fileZoom !== undefined) pane.fileZoom = leaf.fileZoom;
      if (leaf.filePlaces === false) pane.filePlaces = false;
      if (leaf.filePreview === true) pane.filePreview = true;
      if (leaf.fileHidden === true) pane.fileHidden = true;
      return pane;
    }
    case "sftp": {
      const pane = newSftpPane("", leaf.alias ?? "", leaf.path);
      if (leaf.fileView) pane.fileView = leaf.fileView;
      if (leaf.fileZoom !== undefined) pane.fileZoom = leaf.fileZoom;
      if (leaf.filePlaces === false) pane.filePlaces = false;
      if (leaf.filePreview === true) pane.filePreview = true;
      if (leaf.fileHidden === true) pane.fileHidden = true;
      return pane;
    }
    case "doc": {
      const alias = leaf.alias?.trim();
      const pane = newDocPane(leaf.path ?? "", alias ? { paneId: "", alias } : undefined);
      if (leaf.docMode) pane.docMode = leaf.docMode;
      if (leaf.docOutline === true) pane.docOutline = true;
      if (leaf.docFiles === true) pane.docFiles = true;
      if (leaf.docEditView) pane.docEditView = leaf.docEditView;
      if (leaf.docSplit !== undefined) pane.docSplit = clampDocSplit(leaf.docSplit);
      if (leaf.docZoom !== undefined) {
        const z = clampDocZoom(leaf.docZoom);
        if (z !== null && z !== DOC_ZOOM_DEFAULT) pane.docZoom = z;
      }
      if (leaf.docPreview === true) pane.docPreview = true;
      return pane;
    }
    case "image": {
      const alias = leaf.alias?.trim();
      return newImagePane(leaf.path ?? "", alias ? { paneId: "", alias } : undefined);
    }
    case "branches":
      return newBranchesPane(leaf.branchGraph?.projectId ?? "", leaf.branchGraph?.branch);
    case "diff":
      return newDiffPane(leaf.diff ?? { projectId: "", scope: "branch" });
    case "run":
      return newRunPane(leaf.run?.runId);
    case "producer":
      return newProducerPane(leaf.producer ?? { chatId: newProducerChatId(), cli: "claude", model: "", effort: "", studio: "" });
    case "chat":
      // 명세를 못 읽은 잎은 새 채팅으로 세우지 않는다 — 어느 대화였는지 모른다
      return leaf.chat ? newChatTilePane(leaf.chat) : newStartPane();
    case "query":
      return newQueryPane(leaf.query ?? { connId: "" });
    default:
      return newStartPane();
  }
}

function nodeFrom(node: SavedNode, deferSsh: boolean, firstRun = false): PaneNode {
  if (isSavedSplit(node)) {
    return {
      type: "split",
      dir: node.dir,
      ratio: clampRatio(node.ratio),
      ...(node.px ? { px: node.px } : {}),
      a: nodeFrom(node.a, deferSsh, firstRun),
      b: nodeFrom(node.b, deferSsh, firstRun),
    };
  }
  return leafOf(paneFrom(node, deferSsh, firstRun));
}

/**
 * SFTP · 원격 문서 · 그림 잎을 같은 탭의 같은 별칭 SSH 타일(트리에서 먼저 나오는 것 — 껐다 켤 때마다 짝이 바뀌지 않게)에
 * 다시 묶고, 짝이 없거나 주소가 없는 잎은 뺀다. 이름은 옛 그대로다.
 */
function rebindSftp(root: PaneNode): PaneNode {
  const panes = listPanes(root);
  const orphans: string[] = [];

  for (const pane of panes) {
    if (pane.kind === "branches") {
      if (!pane.branchGraph?.projectId) orphans.push(pane.id);
      continue;
    }
    if (pane.kind === "diff") {
      if (!pane.diff?.projectId) orphans.push(pane.id);
      continue;
    }
    if (pane.kind === "query") {
      if (!pane.query?.connId) orphans.push(pane.id);
      continue;
    }
    if (isFileLeafKind(pane.kind)) {
      if (!pane.path) {
        orphans.push(pane.id);
        continue;
      }
      if (!pane.alias?.trim()) continue;
    } else if (pane.kind !== "sftp") {
      continue;
    }
    const alias = pane.alias?.trim();
    const source = alias
      ? panes.find((p) => p.kind === "ssh" && p.alias?.trim() === alias)
      : undefined;
    if (source) pane.sourcePaneId = source.id;
    else orphans.push(pane.id);
  }

  let next: PaneNode | null = root;
  for (const id of orphans) {
    next = closePane(next, id);
    if (next === null) return leafOf(newStartPane());
  }
  return next;
}

export function restoreNode(node: SavedNode, opts: DeserializeOptions = {}): PaneNode {
  // 워크스페이스 v2 파일은 Rust 가 읽어 검증 없이 넘긴다 — 걷은 종류의 잎은 여기서 뺀다
  const pruned = pruneRetiredLeaves(node) ?? { kind: "start" };
  return rebindSftp(nodeFrom(pruned, opts.deferSsh ?? true, opts.firstRun ?? false));
}

/** `rebindSftp` 는 탭마다 따로 돈다 — 옆 탭의 같은 별칭에 붙이면 그 탭을 닫는 순간 배너로 바뀐다 */
export function restoreTab(
  node: SavedNode,
  title?: string,
  name?: string,
  opts: DeserializeOptions = {},
  pinnedTitle?: string,
  projectFolder?: string,
): TabSpec {
  return restoredTab(restoreNode(node, opts), title, name, pinnedTitle, projectFolder);
}

export function deserialize(
  file: TabFile,
  opts: DeserializeOptions = {},
): { tabs: TabSpec[]; activeId: string | null } {
  const tabs = file.workspaces.map((w) => {
    const tab = restoreTab(w.root, w.title, w.name, opts, w.pinnedTitle, w.projectFolder);
    if (w.tabKey) tab.tabKey = w.tabKey;
    if (w.projectId) tab.projectId = w.projectId;
    if (w.orch) tab.orch = { ...w.orch };
    return tab;
  });
  return { tabs, activeId: tabs[file.activeIndex]?.id ?? tabs[0]?.id ?? null };
}
