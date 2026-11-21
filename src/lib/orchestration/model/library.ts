import type { Tr } from "./text";
import type { ArchivedAlbum, RunState, RunSummary } from "./types";

/** 보일 때 이만큼 상세를 한 번씩 읽는다 */
export const RECENT_MAX = 5;

export type LibraryFilter = "all" | "live" | "ended" | "archived";

/** 저장소 열쇠는 서버 문자열 그대로 쓴다 — 프런트에서 경로를 정규화하지 않는다 */
export function studioName(repo: string): string {
  return repo.split(/[\\/]/).filter(Boolean).pop() || repo;
}

export type AlbumView = "rows" | "cards";

export function parseAlbumView(raw: string | null | undefined): AlbumView {
  return raw === "rows" ? "rows" : "cards";
}

export function studioLabelOf(projectName: string | null | undefined, repo: string): string {
  return projectName?.trim() || studioName(repo);
}

export function libraryRepositories(runs: readonly { repo: string; state: RunState }[]): { repo: string; count: number; live: boolean }[] {
  const groups = new Map<string, { repo: string; count: number; live: boolean }>();
  for (const run of runs) {
    const group = groups.get(run.repo) ?? { repo: run.repo, count: 0, live: false };
    group.count += 1;
    group.live ||= albumLive(run);
    groups.set(run.repo, group);
  }
  return [...groups.values()];
}

/** 필터와 무관한 그 스튜디오 전체 */
export function studioSummary(runs: readonly { repo: string; state: RunState }[], archived: readonly { repo: string }[], repo: string): { albums: number; live: number; archived: number } {
  const mine = runs.filter((run) => run.repo === repo);
  return { albums: mine.length, live: mine.filter(albumLive).length, archived: archived.filter((a) => a.repo === repo).length };
}

export function archivedInStudio<T extends { repo: string }>(archived: readonly T[], studio: string | null): readonly T[] {
  return studio === null ? archived : archived.filter((a) => a.repo === studio);
}

export function albumRowMeta(meta: string, repo: string, inStudio: boolean, tr: Tr, name: string = studioName(repo)): string {
  return inStudio ? meta : tr("orch.library.row.withStudio", { studio: name, meta });
}

export function filterLibraryRuns(runs: readonly RunSummary[], filter: LibraryFilter, repo: string | null): RunSummary[] {
  return runs.filter((run) => (repo === null || run.repo === repo) && (filter === "all" || (filter === "live" ? albumLive(run) : filter === "ended" && !albumLive(run))))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** 최종 판정은 서버다 — 끝난 상태 낱말은 서버 `cleanable_state` 와 같다 */
export function archiveGate(r: { state: RunState; worktreesLeft?: number }): "none" | "blocked" | "ready" {
  if (r.state !== "done" && r.state !== "stopped" && r.state !== "orphaned") return "none";
  return (r.worktreesLeft ?? 0) > 0 ? "blocked" : "ready";
}

export interface AlbumRowChip {
  kind: "worktrees" | "unexported" | "exported";
  tone: "warn" | "ok";
  icon: "warning" | "git-branch";
  label: string;
  title: string;
}

export interface AlbumRowAction {
  kind: "cleanup" | "archive" | "restore" | "delete";
  icon: "cleanup" | "archive" | "album-restore" | "trash";
  aria: string;
  title: string;
  /** 도는 일 때문에 꺼지는 것은 화면이 따로 본다 */
  blocked: boolean;
  danger: boolean;
}

function action(kind: AlbumRowAction["kind"], icon: AlbumRowAction["icon"], label: string, extra?: Partial<Pick<AlbumRowAction, "aria" | "title" | "blocked" | "danger">>): AlbumRowAction {
  return { kind, icon, aria: label, title: label, blocked: false, danger: false, ...extra };
}

export function libraryRowChips(run: Pick<RunSummary, "state" | "worktreesLeft" | "exportedBranch">, tr: Tr): AlbumRowChip[] {
  const chips: AlbumRowChip[] = [];
  if (archiveGate(run) === "blocked") {
    const n = run.worktreesLeft ?? 0;
    chips.push({ kind: "worktrees", tone: "warn", icon: "warning", label: tr("orch.archive.chip.worktrees", { n }), title: worktreesLeftText(n, tr) });
  }
  if (run.exportedBranch) chips.push({ kind: "exported", tone: "ok", icon: "git-branch", label: tr("orch.archive.chip.exported"), title: run.exportedBranch });
  return chips;
}

export function archivedRowChips(a: Pick<ArchivedAlbum, "unexported" | "exportedBranch">, tr: Tr): AlbumRowChip[] {
  if (a.unexported) return [{ kind: "unexported", tone: "warn", icon: "warning", label: tr("orch.archive.chip.unexported"), title: tr("orch.archive.row.unexported") }];
  return a.exportedBranch ? [{ kind: "exported", tone: "ok", icon: "git-branch", label: tr("orch.archive.chip.exported"), title: a.exportedBranch }] : [];
}

/** 병합은 앨범 안에서 내용을 보고 한다 — 줄에는 두지 않는다 */
export function libraryRowActions(run: Pick<RunSummary, "state" | "worktreesLeft">, tr: Tr): AlbumRowAction[] {
  const gate = archiveGate(run);
  const out: AlbumRowAction[] = [];
  if (gate === "blocked") out.push(action("cleanup", "cleanup", tr("orch.cleanup.open")));
  if (gate === "ready") out.push(action("archive", "archive", tr("orch.archive.btn"), { title: tr("orch.archive.menu.title") }));
  if (gate === "blocked") {
    const label = tr("orch.archive.btn");
    const why = tr("orch.archive.blocked.tip");
    out.push(action("archive", "archive", label, { aria: `${label} (${why})`, title: why, blocked: true }));
  }
  return out;
}

export function archivedRowActions(tr: Tr): AlbumRowAction[] {
  return [action("restore", "album-restore", tr("orch.archive.restore")), action("delete", "trash", tr("orch.archive.delete"), { danger: true })];
}

export function trackCountText(n: number, tr: Tr): string {
  return tr(n === 1 ? "orch.count.tracks.one" : "orch.count.tracks.many", { n });
}

/** 돌던 중 멈춘 것만 — 끝난 앨범도 재시작이면 `orphaned` 로 읽히지만 할 일이 없다 */
export function interruptedAlbums<T extends { orphaned: boolean; previousState?: string | null }>(runs: readonly T[]): T[] {
  return runs.filter((r) => r.orphaned && (r.previousState === "running" || r.previousState === "paused"));
}

export function worktreesLeftText(n: number, tr: Tr): string {
  return tr(n === 1 ? "orch.home.recent.worktrees.one" : "orch.home.recent.worktrees.many", { n });
}

export function archiveBlockedText(n: number, tr: Tr): string {
  return tr(n === 1 ? "orch.archive.blocked.one" : "orch.archive.blocked.many", { n });
}

export type ArchiveDeleteAnswer = "cancel" | "export" | "delete";

/** 내보내기 op 는 표에 있는 앨범에만 되므로 [먼저 내보내기] 는 복원 뒤 앨범 화면을 연다(자동 내보내기가 아니다) */
export function archiveDeleteDialog(a: Pick<ArchivedAlbum, "name" | "unexported" | "exportable">, tr: Tr) {
  const choices: { label: string; result: ArchiveDeleteAnswer; tone: "secondary" | "danger"; cancel: boolean }[] = [
    { label: tr("app.actions.cancel"), result: "cancel", tone: "secondary", cancel: true },
  ];
  if (a.unexported && a.exportable) choices.push({ label: tr("orch.archive.delete.export"), result: "export", tone: "secondary", cancel: false });
  choices.push({ label: tr("orch.archive.delete"), result: "delete", tone: "danger", cancel: false });
  return {
    title: tr("orch.archive.delete.title", { name: a.name }),
    body: tr("orch.archive.delete.text"),
    callout: a.unexported ? tr(a.exportable ? "orch.archive.delete.warn" : "orch.archive.delete.warn.readonly") : undefined,
    section: { label: tr("orch.archive.delete.kept"), text: tr("orch.archive.delete.kept.text") },
    choices,
  };
}

export type ContinueKind = "playing" | "orphan" | "reattach" | "paused";

export function albumLive(r: Pick<RunSummary, "state">): boolean {
  return r.state === "running" || r.state === "stopping" || r.state === "paused";
}

/** 도는 앨범은 수와 상관없이 전부 — 멈춘 앨범의 [이어받기] 입구가 이 카드다 */
export function recentAlbums<T extends Pick<RunSummary, "state" | "updatedAt">>(runs: readonly T[], max: number = RECENT_MAX): T[] {
  const sorted = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = sorted.filter(albumLive);
  return [...live, ...sorted.filter((r) => !albumLive(r)).slice(0, Math.max(0, max - live.length))];
}

/** 서버 판정 `adoptable` 그대로 */
export function continueKind(r: Pick<RunSummary, "state" | "adoptable">): ContinueKind {
  if (r.state !== "paused") return "playing";
  if (!r.adoptable.restore) return "paused";
  return r.adoptable.autoResume ? "orphan" : "reattach";
}

export function elapsedSplit(ms: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** 복사용 글자다 — 실행하지 않는다 */
export function mergeCommand(branch: string): string {
  return `git merge --no-ff ${branch}`;
}
