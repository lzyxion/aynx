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
 * diff 타일 — 시계는 없다. 원격은 이미 붙은 세션이 있을 때만 읽는다(새 접속을 열지 않는다).
 * 명령 글자는 Rust 가 짓는다 — 여기서는 범위와 경로만 보낸다(docs/log/2026-10-05-diff-tile.md).
 */

export type DiffFilesRead =
  | { state: "ok"; files: DiffFiles }
  | { state: "offline" }
  | { state: "notRepo" }
  | { state: "noScope" }
  | { state: "error"; message: string };

export type DiffFileRead = { state: "ok"; file: DiffFile } | { state: "offline" } | { state: "error"; message: string };

const messageOf = (e: unknown) => stripReason(e instanceof Error ? e.message : String(e));

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
    // 저장소가 아닌지는 구조적으로 한 번 더 묻는다 — git 의 오류 문구는 로케일을 탄다
    const status = await repoStatusOf(isRemote(p) ? p.host : null, p.path);
    if (status?.kind === "notRepo") return { state: "notRepo" };
    return { state: "error", message: messageOf(e) };
  }
}

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

export function sameDiffTarget(a: Pick<DiffSpec, "projectId" | "branch" | "worktreePath">, b: Pick<DiffSpec, "projectId" | "branch" | "worktreePath">): boolean {
  if (a.projectId !== b.projectId) return false;
  const ab = a.branch?.trim();
  const bb = b.branch?.trim();
  if (ab || bb) return ab === bb;
  return !!a.worktreePath && a.worktreePath === b.worktreePath;
}

function findDiffPane(want: DiffSpec): { tabId: string; pane: PaneSpec } | null {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.kind === "diff" && pane.diff && sameDiffTarget(pane.diff, want)) return { tabId: tab.id, pane };
    }
  }
  return null;
}

export type DiffOpen = Omit<DiffSpec, "projectId" | "view" | "name">;

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
    // 보고 범위(기준 … 보고 커밋)는 없으면 그 타일의 것을 남긴다 — 범위 단추로 돌아올 수 있게
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
  openPaneHere(pane, paneName(pane, t), p.id);
}

/** 객체를 통째로 새로 단다(분할 복제가 같은 객체를 나눠 들지 않게) · 값이 그대로면 손대지 않는다(자동 저장이 헛돌지 않게) */
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

export function openDiffDoc(paneId: string, p: Project, worktree: string, rel: string): void {
  openBranchFile(paneId, p, worktree, rel);
}

// ── 줄 코멘트를 AI 타일에 ──

export interface DiffTargetList extends DiffTargets {
  /** 타일 id → 줄의 부연(워크트리 꼬리 · 없으면 탭 이름) */
  sub: Map<string, string>;
}

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

/** Enter 없음 */
export function pasteDiffText(tile: AskTile, text: string): boolean {
  return pasteToAiTile(tile, text);
}

export async function copyDiffText(text: string): Promise<boolean> {
  const ok = await writeClipboard(text);
  if (ok) toast.info(t("app.diff.tray.copied"));
  else showNotice(t("app.diff.tray.copyFailed"));
  return ok;
}

export function diffHostLabel(p: Project): string {
  return isRemote(p) ? p.host : t("pane.askai.host.local");
}
