// 라이브러리 목록·상태 계산.
import type { Tr } from "./text";
import type { ArchivedAlbum, RunState, RunSummary } from "./types";

/** 최근 앨범 칸의 수 — 보일 때 이만큼 상세를 한 번씩 읽는다(내보낸 브랜치 · 남은 worktree) */
export const RECENT_MAX = 5;

/** 라이브러리 필터 — 전부 · 진행 중 · 끝남(최근 앨범) · 보관함(서버의 다른 목록) */
export type LibraryFilter = "all" | "live" | "ended" | "archived";

/** 저장소 열쇠는 서버 문자열 그대로 쓴다. 프런트에서 경로를 정규화하지 않는다. */
/** 스튜디오(화면 낱말 — 앨범의 저장소) 이름 = 경로의 마지막 칸 */
export function studioName(repo: string): string {
  return repo.split(/[\\/]/).filter(Boolean).pop() || repo;
}

/** 앨범 목록의 보기 — 표지 카드(기본) · 줄 */
export type AlbumView = "rows" | "cards";

/** 저장된 글자 → 보기. 모르는 값은 기본 */
export function parseAlbumView(raw: string | null | undefined): AlbumView {
  return raw === "rows" ? "rows" : "cards";
}

/** 스튜디오에 보일 이름 — 프로젝트 이름이 있으면 그것, 없으면 폴더 이름 */
export function studioLabelOf(projectName: string | null | undefined, repo: string): string {
  return projectName?.trim() || studioName(repo);
}

/** 스튜디오 카드 재료 — 넘긴 줄만 세고 그 안의 산 앨범으로 재생 표시를 정한다. 라이브러리는 고른 필터를 지난 앨범을 넘긴다 */
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

/** 스튜디오 화면 머리의 수 — 필터와 무관한 그 스튜디오 전체. 앨범 · 보관이 모두 0 이면 화면은 빈 문구만 */
export function studioSummary(runs: readonly { repo: string; state: RunState }[], archived: readonly { repo: string }[], repo: string): { albums: number; live: number; archived: number } {
  const mine = runs.filter((run) => run.repo === repo);
  return { albums: mine.length, live: mine.filter(albumLive).length, archived: archived.filter((a) => a.repo === repo).length };
}

/** 보관함 줄 — 스튜디오 화면이면 그 스튜디오의 것만 */
export function archivedInStudio<T extends { repo: string }>(archived: readonly T[], studio: string | null): readonly T[] {
  return studio === null ? archived : archived.filter((a) => a.repo === studio);
}

/** 앨범 줄의 작은 글 — 라이브러리는 앞에 스튜디오 이름을 붙이고, 스튜디오 화면은 그대로 둔다(다 같은 스튜디오가다) */
export function albumRowMeta(meta: string, repo: string, inStudio: boolean, tr: Tr, name: string = studioName(repo)): string {
  return inStudio ? meta : tr("orch.library.row.withStudio", { studio: name, meta });
}

export function filterLibraryRuns(runs: readonly RunSummary[], filter: LibraryFilter, repo: string | null): RunSummary[] {
  return runs.filter((run) => (repo === null || run.repo === repo) && (filter === "all" || (filter === "live" ? albumLive(run) : filter === "ended" && !albumLive(run))))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/**
 * 끝난 앨범의 [보관] 표시 판정 — `none` = 단추 없음(도는 앨범) · `blocked` = 작업자 worktree 가 남아 끈다 · `ready`. 최종 판정은 서버다
 * (`worktrees-left`). 칸이 없는 옛 서버는 남은 것이 없다고 보고 서버 답에 맡긴다. 끝난 상태 낱말은 서버 `cleanable_state` 와 같다.
 */
export function archiveGate(r: { state: RunState; worktreesLeft?: number }): "none" | "blocked" | "ready" {
  if (r.state !== "done" && r.state !== "stopped" && r.state !== "orphaned") return "none";
  return (r.worktreesLeft ?? 0) > 0 ? "blocked" : "ready";
}

/** 앨범 줄의 상태 칩(정보 표시 — 누르는 것이 아니다) */
export interface AlbumRowChip {
  kind: "worktrees" | "unexported" | "exported";
  tone: "warn" | "ok";
  icon: "warning" | "git-branch";
  label: string;
  title: string;
}

/** 앨범 줄의 아이콘 단추 — `aria` · `title` 은 문구 표에서(글자 없는 단추의 이름) */
export interface AlbumRowAction {
  kind: "cleanup" | "archive" | "restore" | "delete";
  icon: "cleanup" | "archive" | "album-restore" | "trash";
  aria: string;
  title: string;
  /** 판정으로 막혔다(도는 일 때문에 꺼지는 것은 화면이 따로 본다) */
  blocked: boolean;
  danger: boolean;
}

function action(kind: AlbumRowAction["kind"], icon: AlbumRowAction["icon"], label: string, extra?: Partial<Pick<AlbumRowAction, "aria" | "title" | "blocked" | "danger">>): AlbumRowAction {
  return { kind, icon, aria: label, title: label, blocked: false, danger: false, ...extra };
}

/** 라이브러리 줄의 칩 — worktree 남음(노랑) · 내보냄(초록, 툴팁에 브랜치) */
export function libraryRowChips(run: Pick<RunSummary, "state" | "worktreesLeft" | "exportedBranch">, tr: Tr): AlbumRowChip[] {
  const chips: AlbumRowChip[] = [];
  if (archiveGate(run) === "blocked") {
    const n = run.worktreesLeft ?? 0;
    chips.push({ kind: "worktrees", tone: "warn", icon: "warning", label: tr("orch.archive.chip.worktrees", { n }), title: worktreesLeftText(n, tr) });
  }
  if (run.exportedBranch) chips.push({ kind: "exported", tone: "ok", icon: "git-branch", label: tr("orch.archive.chip.exported"), title: run.exportedBranch });
  return chips;
}

/** 보관함 줄의 칩 — 내보내지 않은 결과가 있으면 경고가 먼저(내보낸 뒤 통합이 앞서 나간 경우도) */
export function archivedRowChips(a: Pick<ArchivedAlbum, "unexported" | "exportedBranch">, tr: Tr): AlbumRowChip[] {
  if (a.unexported) return [{ kind: "unexported", tone: "warn", icon: "warning", label: tr("orch.archive.chip.unexported"), title: tr("orch.archive.row.unexported") }];
  return a.exportedBranch ? [{ kind: "exported", tone: "ok", icon: "git-branch", label: tr("orch.archive.chip.exported"), title: a.exportedBranch }] : [];
}

/** 라이브러리 줄의 단추 — 정리(worktree 남음) · 보관(끝난 앨범 · 남았으면 막힘). 병합은 앨범 안에서 내용을 보고 한다(복사는 앨범의 ⋯ 메뉴 · 확인 창) */
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

/** 보관함 줄의 단추 — 복원 · 영구 삭제(위험 색) */
export function archivedRowActions(tr: Tr): AlbumRowAction[] {
  return [action("restore", "album-restore", tr("orch.archive.restore")), action("delete", "trash", tr("orch.archive.delete"), { danger: true })];
}

/** 트랙 수 — 언어마다 단수 · 복수 문구를 고른다 */
export function trackCountText(n: number, tr: Tr): string {
  return tr(n === 1 ? "orch.count.tracks.one" : "orch.count.tracks.many", { n });
}

/**
 * 앱을 켤 때 알릴 앨범 — 돌던 중 서버 재시작으로 멈춘 것만. 끝난 앨범도 재시작이면 `orphaned` 로 읽히지만 할 일이 없다(2026-11-07 사용자 — 매번 "5개" 가 떴다).
 * 재시작 전 상태를 모르면 알리지 않는다.
 */
export function interruptedAlbums<T extends { orphaned: boolean; previousState?: string | null }>(runs: readonly T[]): T[] {
  return runs.filter((r) => r.orphaned && (r.previousState === "running" || r.previousState === "paused"));
}

/** 줄의 "worktree n 남음" */
export function worktreesLeftText(n: number, tr: Tr): string {
  return tr(n === 1 ? "orch.home.recent.worktrees.one" : "orch.home.recent.worktrees.many", { n });
}

/** 앨범 화면의 보관 막힘 안내 */
export function archiveBlockedText(n: number, tr: Tr): string {
  return tr(n === 1 ? "orch.archive.blocked.one" : "orch.archive.blocked.many", { n });
}

/** 영구 삭제 확인 상자의 답 */
export type ArchiveDeleteAnswer = "cancel" | "export" | "delete";

/**
 * 영구 삭제 확인 상자의 재료(목업 ConfirmDelete) — 내보내지 않은 결과가 있으면 경고가 서고, 복원해서 내보낼 수 있을 때만 [먼저 내보내기]가 선다
 * (내보내기 op 는 표에 있는 앨범에만 되므로 그 단추는 복원 뒤 앨범 화면을 연다 · 자동 내보내기가 아니다).
 */
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

/** 최근 카드의 갈래 */
export type ContinueKind = "playing" | "orphan" | "reattach" | "paused";

/** 산 앨범인가(running · stopping · paused) */
export function albumLive(r: Pick<RunSummary, "state">): boolean {
  return r.state === "running" || r.state === "stopping" || r.state === "paused";
}

/**
 * 최근 칸 — 도는 앨범 먼저 전부(멈춘 앨범의 [이어받기] 입구가 이 카드라 수와 상관없이 뺄 수 없다), 남은 자리는 최근에 움직인 끝난 앨범. 각각 최근 순.
 */
export function recentAlbums<T extends Pick<RunSummary, "state" | "updatedAt">>(runs: readonly T[], max: number = RECENT_MAX): T[] {
  const sorted = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = sorted.filter(albumLive);
  return [...live, ...sorted.filter((r) => !albumLive(r)).slice(0, Math.max(0, max - live.length))];
}

/** 최근 카드의 갈래 — 서버 판정 `adoptable` 그대로(머리말) */
export function continueKind(r: Pick<RunSummary, "state" | "adoptable">): ContinueKind {
  if (r.state !== "paused") return "playing";
  if (!r.adoptable.restore) return "paused";
  return r.adoptable.autoResume ? "orphan" : "reattach";
}

/** 카드의 경과(시 · 분 — 초는 버린다 · 음수는 0) */
export function elapsedSplit(ms: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** 내보낸 브랜치의 병합 명령(복사만 — 실행 단추는 없다 · main 병합은 사람) — 앨범 판 [더 보기] 와 같은 글자 */
export function mergeCommand(branch: string): string {
  return `git merge --no-ff ${branch}`;
}
