// 새 패널·탭 명세를 만드는 곳.
// 불변식: `tab-N`·`pane-N`·탭 제목 번호 카운터는 이 파일에만 산다(창마다 따로 돈다) — id 를 매기는 함수는
// 전부 여기 두고 카운터를 내보내지 않는다. `paneOrder` 는 그 `pane-N` 모양에 기대므로 함께 둔다.

import { quickConnectLabel, type QuickConnectTarget as AdhocTarget } from "$lib/quick-connect";
import { canonQueryTabs, hasSession, isFileLeafKind, storedRowLimit, type DiffSpec, type PaneLeaf, type QuerySpec, type PaneNode, type PaneSpec, type ProducerSpec, type TabSpec, type Tr } from "./spec";
import { findPane, listPanes } from "./tree";
import { parseOrchMark } from "$lib/orchestration/orch-tab";
import { freshLaunchOf } from "$lib/agent-sessions";

let tabSeq = 0;
let paneSeq = 0;
/** 닫아도 되쓰지 않는다 */
let tabTitleSeq = 0;

function nextTabId(): string {
  tabSeq += 1;
  return `tab-${tabSeq}`;
}

function nextPaneId(): string {
  paneSeq += 1;
  return `pane-${paneSeq}`;
}

export function nextHistoryStreamId(): string {
  const buf = new Uint32Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 0x1_0000_0000);
  }
  return Array.from(buf, (n) => n.toString(16).padStart(8, "0")).join("");
}

/** 패널을 복사하지 않는다 — 살아 있는 패널을 옮겨 심을 때 `pane.id` 가 같아야 터미널이 재마운트되지 않는다 */
export function leafOf(pane: PaneSpec): PaneLeaf {
  return { type: "leaf", pane };
}

export function newLocalPane(shell?: string): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "local",
    historyStreamId: nextHistoryStreamId(),
    ...(shell ? { shell } : {}),
  };
}

export const DEFAULT_SCROLLBACK = 5000;
/**
 * 범위 밖 값은 잘라 맞추지 않고 무시한다(기본값) — 오타를 조용히 다른 숫자로 바꾸지 않게.
 * 상한은 메모리 예산이다 — xterm.js 는 스크롤백 줄을 전부 JS 힙에 든다(docs/verification/xterm.md).
 */
export const MIN_SCROLLBACK = 100;
export const MAX_SCROLLBACK = 200_000;

export function clampScrollback(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  if (n < MIN_SCROLLBACK || n > MAX_SCROLLBACK) return undefined;
  return n;
}

export function newSshPane(alias: string, scrollback?: number | null): PaneSpec {
  const lines = clampScrollback(scrollback);
  return {
    id: nextPaneId(),
    kind: "ssh",
    historyStreamId: nextHistoryStreamId(),
    alias,
    ...(lines === undefined ? {} : { scrollback: lines }),
  };
}

/**
 * `alias`(화면 이름 `user@host:port`)와 `adhoc` 은 함께여야 뜻이 있어 생성자를 따로 둔다 — `adhoc` 없이 그 이름을
 * 별칭으로 넘기면 "설정에 없는 별칭" 으로 접속해 조용히 실패한다.
 */
export function newAdhocSshPane(target: AdhocTarget): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "ssh",
    historyStreamId: nextHistoryStreamId(),
    alias: quickConnectLabel(target),
    adhoc: { ...target },
  };
}

/** `clonePane` 은 `autorun` · `injectMcpToken` 을 물려준다 — 이 패널을 다시 분할하면 CLI 도 새 셸에서 다시 뜬다(의도) */
export function newAiPane(command: string, cwd?: string): PaneSpec {
  const start = cwd?.trim();
  return {
    id: nextPaneId(),
    kind: "local",
    historyStreamId: nextHistoryStreamId(),
    autorun: command,
    injectMcpToken: true,
    ...(start ? { cwd: start } : {}),
  };
}

/** 터미널 하나에 브라우저 여럿을 막지 않는다 — 둘 다 같은 SFTP 채널을 탄다 */
export function newSftpPane(sourcePaneId: string, alias: string, path?: string): PaneSpec {
  const start = path?.trim();
  return {
    id: nextPaneId(),
    kind: "sftp",
    sourcePaneId,
    alias,
    ...(start !== undefined && start !== "" ? { path: start } : {}),
  };
}

export function newStartPane(): PaneSpec {
  return { id: nextPaneId(), kind: "start" };
}

/** 파일 타일에서 열 때는 브라우저가 아니라 브라우저가 빌리던 터미널의 id·별칭을 넘긴다 — 브라우저를 닫아도 문서는 살아야 한다 */
export function newDocPane(path: string, source?: { paneId: string; alias: string }): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "doc",
    path,
    ...(source ? { sourcePaneId: source.paneId, alias: source.alias } : {}),
  };
}

/** 배율 · 이동 위치는 싣지 않는다(열 때마다 맞춤) */
export function newImagePane(path: string, source?: { paneId: string; alias: string }): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "image",
    path,
    ...(source ? { sourcePaneId: source.paneId, alias: source.alias } : {}),
  };
}

/** 값이 없는 칸은 키도 두지 않는다 — 자동 저장의 문자열 비교가 달라진다(`newDiffPane` · `newLocalFsPane` 도 같다) */
export function newBranchesPane(projectId: string, branch?: string | null): PaneSpec {
  const b = branch?.trim();
  return { id: nextPaneId(), kind: "branches", branchGraph: b ? { projectId, branch: b } : { projectId } };
}

export function newDiffPane(diff: DiffSpec): PaneSpec {
  const d: DiffSpec = { projectId: diff.projectId, scope: diff.scope };
  if (diff.branch?.trim()) d.branch = diff.branch.trim();
  if (diff.worktreePath?.trim()) d.worktreePath = diff.worktreePath.trim();
  if (diff.commit?.trim()) d.commit = diff.commit.trim();
  if (diff.base?.trim()) d.base = diff.base.trim();
  if (diff.tip?.trim()) d.tip = diff.tip.trim();
  if (diff.file) d.file = diff.file;
  if (diff.view === "split") d.view = "split";
  if (diff.name) d.name = diff.name;
  return { id: nextPaneId(), kind: "diff", diff: d };
}

export function newRunPane(runId?: string): PaneSpec {
  const id = runId?.trim();
  return id ? { id: nextPaneId(), kind: "run", run: { runId: id } } : { id: nextPaneId(), kind: "run" };
}

export function newProducerPane(p: ProducerSpec): PaneSpec {
  return { id: nextPaneId(), kind: "producer", producer: { ...p } };
}

export function newQueryPane(q: QuerySpec): PaneSpec {
  const query: QuerySpec = { connId: q.connId.trim() };
  const tabs = canonQueryTabs(q);
  if (tabs.sql !== undefined) query.sql = tabs.sql;
  const rows = storedRowLimit(q.maxRows);
  if (rows !== undefined) query.maxRows = rows;
  if (tabs.scripts) {
    query.scripts = tabs.scripts;
    query.active = tabs.active;
  }
  if (q.name) query.name = q.name;
  return { id: nextPaneId(), kind: "query", query };
}

/**
 * 남의 세션을 빌리는 타일은 혼자 새 창으로 떼면 원본을 잃는다 — `startPaneTear` · ⋯ 메뉴 "새 창으로 분리" 가 이 하나로 판정한다
 * (갈리면 메뉴에 있는데 눌러도 아무 일 없는 항목이 생긴다).
 */
export function borrowsSession(pane: Pick<PaneSpec, "kind" | "alias">): boolean {
  if (pane.kind === "sftp") return true;
  return isFileLeafKind(pane.kind) && (pane.alias?.trim() ?? "") !== "";
}

export function findDocPane(
  root: PaneNode,
  path: string,
  source?: { paneId: string; alias: string },
): PaneSpec | null {
  return findFilePane(root, "doc", path, source);
}

function isSameFile(
  p: PaneSpec,
  kind: "doc" | "image",
  path: string,
  source?: { paneId: string; alias: string },
): boolean {
  if (p.kind !== kind || p.path !== path) return false;
  const alias = p.alias?.trim() ?? "";
  return source ? alias === source.alias.trim() && p.sourcePaneId === source.paneId : alias === "";
}

export function findFilePane(
  root: PaneNode,
  kind: "doc" | "image",
  path: string,
  source?: { paneId: string; alias: string },
): PaneSpec | null {
  for (const p of listPanes(root)) if (isSameFile(p, kind, path, source)) return p;
  return null;
}

/** 원격 창이 연 문서는 메인 PC 가 새 id 로 세우므로(`app/mirror-requests` 의 `fresh`) 연 명세의 id 로는 찾을 수 없다 */
export function findNewDocPane(
  panes: Iterable<PaneSpec>,
  before: ReadonlySet<string>,
  path: string,
  source?: { paneId: string; alias: string },
): PaneSpec | null {
  for (const p of panes) if (!before.has(p.id) && isSameFile(p, "doc", path, source)) return p;
  return null;
}

/**
 * 붙박이 문서와 저장 안 한 문서(`isDirty`)는 갈아 끼우지 않는다 — 그 약속이 새면 다음 더블클릭이 글을 말없이 버린다
 * (docs/log/2026-09-27-doc-edit.md).
 */
export type DocOpenPlan = { kind: "focus"; paneId: string } | { kind: "replace"; paneId: string } | { kind: "beside" };

export function planDocOpen(
  root: PaneNode,
  path: string,
  source?: { paneId: string; alias: string },
  isDirty: (paneId: string) => boolean = () => false,
): DocOpenPlan {
  return planFileOpen(root, "doc", path, source, isDirty);
}

export function planFileOpen(
  root: PaneNode,
  kind: "doc" | "image",
  path: string,
  source?: { paneId: string; alias: string },
  isDirty: (paneId: string) => boolean = () => false,
): DocOpenPlan {
  const same = findFilePane(root, kind, path, source);
  if (same) return { kind: "focus", paneId: same.id };
  if (kind === "doc") {
    const preview = listPanes(root).find((p) => p.kind === "doc" && p.docPreview === true && !isDirty(p.id));
    if (preview) return { kind: "replace", paneId: preview.id };
  }
  return { kind: "beside" };
}

/** 보기(`docMode`)는 파일의 것이라 물려주지 않는다 */
export function carryDocTileView(
  old: PaneSpec | null | undefined,
  pane: PaneSpec,
  opts: { keepPreview?: boolean } = {},
): PaneSpec {
  if (!old) return pane;
  if (old.docOutline === true) pane.docOutline = true;
  if (old.docFiles === true) pane.docFiles = true;
  if (old.docEditView) pane.docEditView = old.docEditView;
  if (old.docSplit !== undefined) pane.docSplit = old.docSplit;
  if (old.docZoom !== undefined) pane.docZoom = old.docZoom;
  if (opts.keepPreview) {
    if (old.docPreview === true) pane.docPreview = true;
    else delete pane.docPreview;
  }
  return pane;
}

export type DocSwitchPlan = { kind: "same" } | { kind: "focus"; paneId: string } | { kind: "replace" };

export function planDocSwitch(
  root: PaneNode,
  paneId: string,
  path: string,
  source?: { paneId: string; alias: string },
): DocSwitchPlan {
  const here = findPane(root, paneId);
  if (here && isSameFile(here, "doc", path, source)) return { kind: "same" };
  const other = findFilePane(root, "doc", path, source);
  if (other && other.id !== paneId) return { kind: "focus", paneId: other.id };
  return { kind: "replace" };
}

/** 종류를 새로 만들지 않는다 — `kind === "start"` 를 보는 규칙(헤더 없음 · 복제 · 떼기 안 됨 · `isLoneStart`)을 그대로 받는다 */
export function newProjectStartPane(projectId: string, folder: string, host?: string | null): PaneSpec {
  const h = host?.trim();
  return { id: nextPaneId(), kind: "start", startProject: h ? { projectId, folder, host: h } : { projectId, folder } };
}

export function newLocalFsPane(path?: string): PaneSpec {
  const start = path?.trim();
  return {
    id: nextPaneId(),
    kind: "localfs",
    ...(start !== undefined && start !== "" ? { path: start } : {}),
  };
}

/** 헤더에 박히는 글자 한 칸이라 컬러 이모지를 넣지 않는다(테마를 따르지 않는다) — 종류 표시는 `PaneIcon` 이 한다 */
export function localFsName(path: string | undefined, tr: Tr): string {
  const p = path?.trim() ?? "";
  if (p === "") return tr("pane.name.files.local");
  const last = p.split(/[\\/]+/).filter((s) => s !== "").at(-1);
  return last ?? p;
}

/** 레이아웃 파일에 남는 저장 형태라 번역하지 않는다 — 만들 때 번역하면 그날 언어로 굳는다(화면은 `tabTitleLabel`) */
const DEFAULT_TAB_TITLE = (n: number): string => `탭 ${n}`;

/** 옛 배치 파일의 `Tab N` · `워크스페이스 N` 도 읽는다 */
export function defaultTabNumber(title: string): number | null {
  const m = /^(?:탭|Tab|워크스페이스) (\d+)$/.exec(title.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

export function tabTitleLabel(title: string, tr: Tr): string {
  const n = defaultTabNumber(title);
  return n === null ? title : tr("app.tabs.default", { n });
}

export function newTab(): TabSpec {
  tabTitleSeq += 1;
  return {
    id: nextTabId(),
    title: DEFAULT_TAB_TITLE(tabTitleSeq),
    root: leafOf(newStartPane()),
  };
}

/** 카운터를 복원한 자동 제목 번호까지 끌어올린다 — 안 그러면 복원 직후 새 탭이 같은 번호를 다시 받는다 */
export function restoredTab(
  root: PaneNode,
  title?: string,
  name?: string,
  pinnedTitle?: string,
  projectFolder?: string,
): TabSpec {
  tabTitleSeq += 1;
  const kept = title?.trim();
  const finalTitle = kept && kept !== "" ? kept : DEFAULT_TAB_TITLE(tabTitleSeq);
  const numbered = defaultTabNumber(finalTitle);
  if (numbered !== null) tabTitleSeq = Math.max(tabTitleSeq, numbered);
  const named = name?.trim();
  const pinned = pinnedTitle?.trim();
  const folder = projectFolder?.trim();
  return {
    id: nextTabId(),
    title: finalTitle,
    ...(named ? { name: named } : {}),
    ...(pinned ? { pinnedTitle: pinned } : {}),
    ...(folder ? { projectFolder: folder } : {}),
    root,
  };
}

/** 같은 종류의 새 패널(새 id = 새 세션) */
export function clonePane(src: PaneSpec): PaneSpec {
  // `adhoc` 은 일부러 물려준다 — `alias` 와 짝이라 한쪽만 옮기면 접속이 조용히 실패한다.
  const copy: PaneSpec = { ...src, id: nextPaneId() };
  delete copy.tileKey;
  // 물려주면 두 타일이 같은 거울 키를 나눠 들어 한쪽의 블록이 다른 쪽 AI 참조에 섞인다.
  if (src.historyStreamId !== undefined) copy.historyStreamId = nextHistoryStreamId();
  // 1회용 — 물려주면 복제할 때마다 이유 없이 검은 화면이 몇 초 간다.
  delete copy.openDelay;
  // 1회용 — 남기면 복제본이 또 연결 대기 배너로 뜬다.
  delete copy.deferred;
  // 물려주면 두 타일이 `-A -D` 재접속으로 서로의 화면을 번갈아 빼앗는다(`adoptTab` 은 같은 타일이라 물려준다).
  delete copy.tmux;
  // 1회용 — 복제본은 이미 있는 그 폴더(`cwd`)로 들어가기만 한다.
  delete copy.worktree;
  // 설정 스크립트는 한 워크트리에서 한 번이다.
  delete copy.setup;
  // 물려주면 탭에 미리 보기가 둘이 되고, 다음에 여는 파일이 그중 하나를 사람이 모르는 새 갈아 끼운다.
  delete copy.docPreview;
  // 복제본은 새 셸 · 새 대화다 — 물려주면 두 타일이 한 대화를 잡는다.
  delete copy.agentLink;
  // AI 타일의 autorun 은 마지막 대화의 재개 줄로 바뀌어 산다(`resumeAutorunFor`) — 새 대화 실행 줄로 되돌리지 않으면 두 타일이
  // 한 대화를 이어 쓴다. `restart` 도 새 객체로(나눠 들지 않게).
  if (copy.autorun) copy.autorun = freshLaunchOf(copy.autorun);
  if (copy.restart) copy.restart = { ...copy.restart, ...(copy.restart.autorun ? { autorun: freshLaunchOf(copy.restart.autorun) } : {}) };
  // 복제본은 시작 폴더 규칙(`cwd`)으로 선다.
  delete copy.lastCwd;
  // 새 객체로 — 나눠 들면 한쪽의 초안이 다른 쪽에 적힌다.
  if (copy.query) copy.query = { ...copy.query };
  return copy;
}

/**
 * `pane` 을 복사하지 않는다 — `pane.id` 가 같아야 `PaneHost` keyed each 에서 xterm · 세션이 그대로다.
 * 제목 · 이름 · 고정 제목은 `from` 의 것을 글자 그대로 잇는다(사용자 결정 — 같은 창이면 같은 이름의 탭이 둘 선다).
 */
export function tabFromPane(
  pane: PaneSpec,
  from: Pick<TabSpec, "title" | "name" | "pinnedTitle" | "projectFolder">,
): TabSpec {
  return {
    id: nextTabId(),
    title: from.title,
    ...(from.name?.trim() ? { name: from.name } : {}),
    ...(from.pinnedTitle?.trim() ? { pinnedTitle: from.pinnedTitle } : {}),
    ...(from.projectFolder?.trim() ? { projectFolder: from.projectFolder } : {}),
    root: leafOf(pane),
  };
}

/**
 * 전역 렌더 목록의 고정 정렬 키 — 탭 · 트리 순서로 정렬하면 keyed each 가 살아 있는 DOM 노드를 옮겨 포커스가 날아간다.
 * id 가 단조 증가하므로 이 순번이면 기존 패널의 DOM 순서가 바뀌지 않는다.
 */
export function paneOrder(paneId: string): number {
  const n = Number(paneId.slice(paneId.lastIndexOf("-") + 1));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 이관된 탭을 이 창의 id 체계로 다시 붙인다(순수 — 입력 트리를 건드리지 않는다). 넘어온 id 를 그대로 쓰면 이 창의 번호와 부딪혀
 * keyed each 가 엉킨다.
 * `sourcePaneId` 는 두 번 훑어 옮긴다(잎이 원본보다 먼저 나올 수 있다). 함께 오지 않은 원본은 지운다 — 남기면 이 창에서 같은 번호를
 * 받은 무관한 패널의 세션을 빌린다.
 * 트리 밖 부속 상태(블록 이력 · AI 공유)는 호출부가 `onAdopt` 로 받은 표로 옮긴다.
 */
export function adoptTab(
  tab: TabSpec,
  restoreOf: (originalPaneId: string) => PaneSpec["restore"],
  onAdopt?: (idMap: ReadonlyMap<string, string>) => void,
): TabSpec {
  const idMap = new Map<string, string>();

  const walk = (node: PaneNode): PaneNode => {
    if (node.type === "leaf") {
      const pane: PaneSpec = { ...node.pane, id: nextPaneId() };
      idMap.set(node.pane.id, pane.id);
      const restore = hasSession(node.pane.kind) ? restoreOf(node.pane.id) : undefined;
      if (restore) pane.restore = restore;
      else delete pane.restore;
      if (tab.workspaceId) pane.restart = pane.restart ?? {
        autorun: pane.autorun, cwd: pane.cwd, injectMcpToken: pane.injectMcpToken,
      };
      // 아래는 1회용이다 — 저쪽 창에서 이미 썼다. autorun 이 남으면 다시 마운트될 때 AI CLI 가 두 번째로 뜬다.
      delete pane.autorun;
      delete pane.cwd;
      delete pane.injectMcpToken;
      delete pane.worktree;
      delete pane.setup;
      // 남기면 이관된 타일이 이유 없이 몇 초 늦게 뜬다.
      delete pane.openDelay;
      delete pane.deferred;
      // `adhoc` · `historyStreamId` 는 보존한다 — `adhoc` 이 없으면 재연결이 `user@host:port` 를 별칭으로 두드리고,
      // `historyStreamId` 가 바뀌면 AI 의 외부 참조가 창을 넘지 못한다.
      return { type: "leaf", pane };
    }
    return { ...node, a: walk(node.a), b: walk(node.b) };
  };

  const relink = (node: PaneNode): void => {
    if (node.type === "leaf") {
      const src = node.pane.sourcePaneId;
      if (src === undefined) return;
      const moved = idMap.get(src);
      if (moved) node.pane.sourcePaneId = moved;
      else delete node.pane.sourcePaneId;
      return;
    }
    relink(node.a);
    relink(node.b);
  };

  const root = walk(tab.root);
  // `walk` 이 만든 잎은 전부 새 객체라 제자리 수정해도 입력 트리는 그대로다.
  relink(root);
  onAdopt?.(idMap);

  return {
    id: nextTabId(),
    title: tab.title,
    ...(tab.tabKey ? { tabKey: tab.tabKey } : {}),
    ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
    ...(tab.projectId ? { projectId: tab.projectId } : {}),
    // `title` 의 번호는 저쪽 창 카운터의 값이지만 그대로 둔다 — 새 번호를 매기면 이 창의 번호와 겹친다.
    ...(tab.name ? { name: tab.name } : {}),
    // 짐은 JSON 이라 글자일 때만.
    ...(typeof tab.pinnedTitle === "string" && tab.pinnedTitle.trim()
      ? { pinnedTitle: tab.pinnedTitle.trim() }
      : {}),
    ...(typeof tab.projectFolder === "string" && tab.projectFolder.trim()
      ? { projectFolder: tab.projectFolder.trim() }
      : {}),
    // 짐은 JSON 이라 모양을 다시 본다.
    ...(tab.orch && typeof tab.orch === "object"
      ? { orch: parseOrchMark(tab.orch) ?? { view: "library" as const } }
      : {}),
    root,
  };
}
