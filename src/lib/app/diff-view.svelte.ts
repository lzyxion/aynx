import { invoke } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { repoStatusOf } from "$lib/app/git-repo";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { activeTabId, focusTile, openPaneHere, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { openBranchFile } from "$lib/app/branch-graph.svelte.js";
import { askTiles, pasteToAiTile } from "$lib/app/ask-ai.svelte.js";
import { dockAgentPanes, dockProjectFolders } from "$lib/app/dock-dots.svelte.js";
import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
import { showNotice } from "$lib/app/notice";
import { toast } from "$lib/toast.svelte.js";
import { writeClipboard } from "$lib/clipboard";
import { placeOf } from "$lib/dock-dots";
import { folderTail } from "$lib/branch-graph";
import { orderDiffTargets, type DiffTargets } from "$lib/diff-comments";
import type { AskTile } from "$lib/ask-ai";
import { isRemote, type Project } from "$lib/projects";
import { listPanes, newDiffPane, paneName, type DiffSpec, type PaneSpec } from "$lib/session";
import {
  parseDiffFile,
  parseDiffFiles,
  scopeArgs,
  type DiffEntry,
  type DiffFile,
  type DiffFiles,
} from "$lib/diff-view";

/**
 * **diff 타일 — 읽기 · 여는 길** (docs/log/2026-10-05-diff-tile.md).
 *
 * 읽는 때는 정해져 있다 — 타일이 뜰 때 · 범위를 바꿀 때 · ↻ 새로 고침 · 파일을 고를 때(그 파일 하나). **시계는 없다.**
 * 원격은 브랜치 타일과 같은 규칙이다: 그 호스트에 **이미 붙은 세션**이 있을 때만 exec 한 번, 없으면 `offline`. 무언가를
 * 보려고 새 접속을 열지 않는다. 명령 글자는 Rust 가 짓는다(여기서는 범위와 경로만 보낸다).
 *
 * 여는 길은 셋이다 — 독 워크트리 줄 "변경 보기"(브랜치 전체) · 그래프 커밋 상세의 파일(커밋 하나) · 그래프 ✎ 줄의
 * 파일(커밋 안 함). 모두 [`openDiff`] 하나로 오고, 이 창에 같은 프로젝트 · 같은 브랜치(브랜치가 없으면 같은 워크트리)의
 * diff 타일이 이미 있으면 새로 세우지 않고 그 타일의 범위 · 파일을 바꿔 초점을 옮긴다.
 */

/** 목록 읽기의 결말 */
export type DiffFilesRead =
  | { state: "ok"; files: DiffFiles }
  | { state: "offline" }
  | { state: "notRepo" }
  | { state: "noScope" }
  | { state: "error"; message: string };

/** 파일 하나 읽기의 결말 */
export type DiffFileRead = { state: "ok"; file: DiffFile } | { state: "offline" } | { state: "error"; message: string };

const messageOf = (e: unknown) => stripReason(e instanceof Error ? e.message : String(e));

/** 범위의 파일 목록 — 실패는 결말 하나로(throw 없음) */
export async function readDiffFiles(p: Project, spec: DiffSpec): Promise<DiffFilesRead> {
  const scope = scopeArgs(spec);
  if (!scope) return { state: "noScope" };
  try {
    let raw: unknown;
    if (isRemote(p)) {
      const id = liveSessionFor(p.host);
      if (id === null) return { state: "offline" };
      raw = await invoke<unknown>("ssh_git_diff_files", { id, repo: p.path, scope });
    } else {
      raw = await invoke<unknown>("git_diff_files", { repo: p.path, scope });
    }
    const files = parseDiffFiles(raw);
    return files ? { state: "ok", files } : { state: "error", message: t("app.diff.error.shape") };
  } catch (e) {
    // 저장소가 아닌지는 구조적으로 한 번 더 묻는다(git 의 오류 문구는 로케일을 탄다 — 그래프와 같은 길).
    const status = await repoStatusOf(isRemote(p) ? p.host : null, p.path);
    if (status?.kind === "notRepo") return { state: "notRepo" };
    return { state: "error", message: messageOf(e) };
  }
}

/** 파일 하나의 diff — 사람이 그 파일을 골랐을 때만 */
export async function readDiffFile(p: Project, spec: DiffSpec, entry: DiffEntry): Promise<DiffFileRead> {
  const scope = scopeArgs(spec);
  if (!scope) return { state: "error", message: t("app.diff.noScope") };
  const args = { scope, path: entry.path, oldPath: entry.oldPath, group: entry.group };
  try {
    let raw: unknown;
    if (isRemote(p)) {
      const id = liveSessionFor(p.host);
      if (id === null) return { state: "offline" };
      raw = await invoke<unknown>("ssh_git_diff_file", { id, repo: p.path, ...args });
    } else {
      raw = await invoke<unknown>("git_diff_file", { repo: p.path, ...args });
    }
    const file = parseDiffFile(raw);
    return file ? { state: "ok", file } : { state: "error", message: t("app.diff.error.shape") };
  } catch (e) {
    return { state: "error", message: messageOf(e) };
  }
}

/** 같은 diff 타일인가 — 같은 프로젝트이고, 브랜치가 있으면 같은 브랜치 · 없으면 같은 워크트리 */
export function sameDiffTarget(a: Pick<DiffSpec, "projectId" | "branch" | "worktreePath">, b: Pick<DiffSpec, "projectId" | "branch" | "worktreePath">): boolean {
  if (a.projectId !== b.projectId) return false;
  const ab = a.branch?.trim();
  const bb = b.branch?.trim();
  if (ab || bb) return ab === bb;
  return !!a.worktreePath && a.worktreePath === b.worktreePath;
}

/** 이 창에서 같은 대상의 diff 타일 — 없으면 `null` */
function findDiffPane(want: DiffSpec): { tabId: string; pane: PaneSpec } | null {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.kind === "diff" && pane.diff && sameDiffTarget(pane.diff, want)) return { tabId: tab.id, pane };
    }
  }
  return null;
}

/** 여는 길이 넘기는 것 — 범위 · 브랜치 · 워크트리 · 커밋 · 파일 */
export type DiffOpen = Omit<DiffSpec, "projectId" | "view" | "name">;

/**
 * **diff 타일을 연다** — 세 입구가 모두 이리로 온다. 같은 대상의 타일이 이 창에 있으면 그 타일의 범위 · 파일을 바꾸고
 * 초점을 옮긴다(고른 보기는 그 타일 것 그대로). 없으면 **지금 탭에 분할로** 연다(검토는 일하던 타일 곁에서 — 브랜치 타일과 같다).
 */
export function openDiff(p: Project, open: DiffOpen): void {
  const want: DiffSpec = { projectId: p.id, ...open };
  const found = findDiffPane(want);
  if (found && found.pane.diff) {
    const cur = found.pane.diff;
    const next: DiffSpec = { projectId: p.id, scope: open.scope };
    const branch = open.branch ?? cur.branch;
    const worktreePath = open.worktreePath ?? cur.worktreePath;
    if (branch) next.branch = branch;
    if (worktreePath) next.worktreePath = worktreePath;
    if (open.commit) next.commit = open.commit;
    else if (open.scope === "commit" && cur.commit) next.commit = cur.commit;
    // 보고 범위(오케스트레이션 — 기준 … 보고 커밋)는 새로 준 것이 이긴다 — 없으면 그 타일의 것을 남긴다(범위 단추로 돌아올 수 있게).
    const base = open.base ?? cur.base;
    const tip = open.tip ?? cur.tip;
    if (base && tip) {
      next.base = base;
      next.tip = tip;
    }
    if (open.file) next.file = open.file;
    if (cur.view) next.view = cur.view;
    if (cur.name) next.name = cur.name;
    found.pane.diff = next;
    focusTile(found.tabId, found.pane.id);
    return;
  }
  const pane = newDiffPane({ ...want, name: p.name });
  // 빈 탭(시작 타일 하나)을 대신하면 그 탭의 자동 제목도 "변경 · <브랜치>"(타일 머리줄과 같은 이름)로 — 탭이 하나뿐인 타일의
  // 제목은 자동 제목이 그대로 서기 때문이다(`tabDisplayTitle`). 분할로 끼우면 `openPaneHere` 가 남의 탭 제목을 건드리지 않고,
  // 사용자 이름(`TabSpec.name`)은 언제나 이것보다 앞선다.
  openPaneHere(pane, paneName(pane, t), p.id);
}

/**
 * 타일이 고른 것(범위 · 커밋 · 파일 · 보기)을 명세에 적는다 — 배치에 실린다. 객체를 통째로 새로 단다(분할 복제가 같은
 * 객체를 나눠 들지 않게). 값이 그대로면 손대지 않는다(자동 저장이 헛돌지 않게).
 */
export function noteDiff(paneId: string, patch: Partial<Omit<DiffSpec, "projectId">>): void {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.id !== paneId || pane.kind !== "diff" || !pane.diff) continue;
      const cur = pane.diff;
      const next: DiffSpec = { ...cur, ...patch };
      for (const k of Object.keys(next) as (keyof DiffSpec)[]) {
        if (next[k] === undefined || next[k] === "") delete next[k];
      }
      if (next.view !== "split") delete next.view;
      const same =
        Object.keys(next).length === Object.keys(cur).length &&
        (Object.keys(next) as (keyof DiffSpec)[]).every((k) => next[k] === cur[k]);
      if (!same) pane.diff = next;
      return;
    }
  }
}

/** [문서로 열기] — 워크트리의 지금 파일을 기존 문서 보기 타일로(브랜치 타일과 같은 길 · 원격이면 붙은 세션을 빌린다) */
export function openDiffDoc(paneId: string, p: Project, worktree: string, rel: string): void {
  openBranchFile(paneId, p, worktree, rel);
}

// ---------------------------------------------------------------------------
// 2단계 — 줄 코멘트를 AI 타일에 (docs/log/2026-10-05-diff-tile.md "2단계")
// ---------------------------------------------------------------------------

/** 받을 곳 — 차례 · 골라진 줄 + 줄마다 부연(워크트리 꼬리 · 없으면 탭 이름) */
export interface DiffTargetList extends DiffTargets {
  /** 타일 id → 줄의 부연 */
  sub: Map<string, string>;
}

/**
 * 받을 곳 목록 — 이 창의 AI 타일(블록 → AI 타일과 같은 판정)을 독의 에이전트 점과 같은 자리 판정(`placeOf` — 가장 깊은
 * 등록 폴더)으로 갈라, 이 프로젝트의 **같은 워크트리**에 선 것을 맨 앞에 골라 둔다. 반응형(타일 · 셸이 알려 준 폴더를 따라간다).
 */
export function diffTargets(p: Project, worktree: string | null, sourcePaneId: string): DiffTargetList {
  const tiles = askTiles();
  const agents = new Map(dockAgentPanes().map((a) => [a.id, a]));
  const folders = dockProjectFolders();
  const same = new Set<string>();
  const sub = new Map<string, string>();
  for (const tile of tiles) {
    const a = agents.get(tile.paneId);
    const at = a ? placeOf(a, folders, remoteHomeOf) : null;
    if (at && at.projectId === p.id && worktree && at.worktree === worktree) same.add(tile.paneId);
    sub.set(tile.paneId, at?.worktree ? folderTail(at.worktree) : tile.tabTitle);
  }
  const order = orderDiffTargets({ tiles, sameWorktree: same, currentTabId: activeTabId(), sourcePaneId });
  return { ...order, sub };
}

/** 고른 AI 타일에 붙여 넣는다(Enter 없음) — 넣었으면 참 */
export function pasteDiffText(tile: AskTile, text: string): boolean {
  return pasteToAiTile(tile, text);
}

/** AI 타일이 없을 때 — 글을 클립보드에 */
export async function copyDiffText(text: string): Promise<boolean> {
  const ok = await writeClipboard(text);
  if (ok) toast.info(t("app.diff.tray.copied"));
  else showNotice(t("app.diff.tray.copyFailed"));
  return ok;
}

/** 붙여 넣을 글의 호스트 — 로컬은 "이 PC", 원격은 SSH 별칭(블록 → AI 타일과 같은 말) */
export function diffHostLabel(p: Project): string {
  return isRemote(p) ? p.host : t("pane.askai.host.local");
}
