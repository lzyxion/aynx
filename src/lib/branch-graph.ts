/**
 * **브랜치 타일 — 두 줄기 커밋 그래프** 순수 층 (docs/log/2026-10-04-commit-graph.md · 처음 모양은
 * docs/log/2026-09-29-branch-graph.md).
 *
 * 백엔드 답 읽기(throw 없음) · 줄 차례([`buildRows`] — 한 줄 = 커밋 하나) · 브랜치 색 · 연결선 표식 · 남는 작은 도구.
 * 읽는 때 · 여는 길 · 창 사본은 `app/branch-graph.svelte.ts`, 그리는 것은 `BranchGraph.svelte`, 무엇을 읽나(first-parent ·
 * 접힘 · 커밋 안 한 것 …)는 Rust `commit_graph.rs` 머리말.
 *
 * ## 줄 차례 (불변식)
 *
 * 줄기는 **두 개뿐**이다 — 왼쪽 main 줄기(단 0), 오른쪽 브랜치 줄기(단 1, 모든 브랜치가 나눠 쓴다). 브랜치가 몇 개든 폭은
 * 같다. 그래서 브랜치끼리는 시간순이 아니다(로그의 "알려진 한계").
 * 1. main 줄(최신부터). `skippedBefore > 0` 이면 그 앞에 "⋯ 커밋 N개" 줄.
 * 2. 브랜치 덩어리 — 커밋(최신부터)을 한 덩어리로, 그 `base` 의 main 줄 **바로 위**에. 같은 base 에 여럿이면 끝 커밋이
 *    최신인 것이 위. base 가 main 줄에 없으면 맨 아래. 커밋이 빈 브랜치는 덩어리가 없다.
 * 3. ✎ 커밋 안 함 줄 — 커밋 안 한 것이 있는 워크트리마다. 그 브랜치 덩어리가 있으면 덩어리 첫 줄, 없으면 그 워크트리
 *    HEAD 의 줄 바로 위에 혼자 선 덩어리(HEAD 가 덩어리 · 펼친 접힘 안이면 그 덩어리 위, 접힘 안이면 접힘 줄 위, 못
 *    찾으면 맨 위). 주 폴더(main 에 선 것)의 ✎ 줄은 main 줄기 위에 선다.
 * 4. 접힘 — 그 병합 커밋 main 줄 **바로 아래** 한 줄. 펼치면 그 자리에 덩어리. squash · rebase 로 병합된 브랜치(2026-10-05)도
 *    같은 접힘이다 — 백엔드가 맞은 main 커밋(squash 커밋)을 `merge` 로 싣고(`kind`), 그 브랜치의 덩어리는 비운다.
 */

import type { Key } from "$lib/i18n/keys";

/** 브랜치 수 상한 — Rust `branch_graph::MAX_BRANCHES` 의 짝(안내 문구의 수) */
export const MAX_BRANCHES = 200;
/** 바뀐 파일 목록의 상한 — Rust `branch_graph::MAX_FILES` 의 짝 */
export const MAX_FILES = 500;
/** 주 줄 앞부분 — 기본 · 더 보기 한 번에 늘리는 수 · 상한 (Rust `commit_graph::{DEFAULT,MAX}_MAIN_LIMIT` 의 짝) */
export const MAIN_LIMIT = { initial: 12, step: 50, max: 500 } as const;

// ---------------------------------------------------------------------------
// 답의 모양 — Rust `commit_graph.rs` (snake_case 를 여기서 camelCase 로)
// ---------------------------------------------------------------------------

/** 주 줄의 한 칸 */
export interface MainRow {
  hash: string;
  /** 바로 위 줄과 사이에 건너뛴 first-parent 커밋 수 */
  skippedBefore: number;
}

/** 커밋 하나 — 시각은 유닉스 초, 줄 수는 첫 부모 대비(병합 커밋은 `null`) */
export interface GraphCommit {
  hash: string;
  parents: string[];
  subject: string;
  time: number;
  added: number | null;
  deleted: number | null;
}

/** 브랜치 하나 — `commits` 는 `main..브랜치` 최신부터 */
export interface GraphBranch {
  name: string;
  head: string;
  base: string | null;
  ahead: number;
  behind: number;
  commits: string[];
  commitsTruncated: boolean;
  merged: boolean;
  /** 무엇으로 병합됐나 — `merged` 일 때만 */
  mergedKind: MergedKind | null;
  createdFrom: string | null;
  createdAt: number | null;
}

/** 병합의 종류 — Rust `merge_detect::MergeKind` (독 배지 `$lib/worktree-changes` 의 같은 이름과 같은 값) */
export type MergedKind = "ancestry" | "squash" | "rebase";

const mergedKindOf = (v: unknown): MergedKind | null =>
  v === "ancestry" || v === "squash" || v === "rebase" ? v : null;

/** 접힘이 무엇으로 생겼나 — 병합 커밋 · squash 병합 · rebase 병합 (Rust `commit_graph::FoldKind`) */
export type FoldKind = "merge" | "squash" | "rebase";

/** 주 줄의 커밋 아래로 접는 덩어리 */
export interface MergedFold {
  /** 병합 커밋(squash · rebase 는 맞은 main 커밋) */
  merge: string;
  /** 제목 `Merge branch 'x'` 의 x(squash · rebase 는 브랜치 이름) */
  name: string | null;
  commits: string[];
  commitsTruncated: boolean;
  base: string | null;
  kind: FoldKind;
}

/** 커밋 안 한 것의 수 */
export interface Dirty {
  files: number;
  added: number;
  deleted: number;
}

/** 워크트리 하나 */
export interface GraphWorktree {
  path: string;
  branch: string | null;
  head: string | null;
  primary: boolean;
  dirty: Dirty | null;
}

/** 그래프 명령의 답 — 커밋은 해시로 찾는다 */
export interface CommitGraph {
  main: string | null;
  mainHead: string | null;
  mainLine: MainRow[];
  mainMore: boolean;
  commits: Map<string, GraphCommit>;
  branches: GraphBranch[];
  folds: MergedFold[];
  worktrees: GraphWorktree[];
  truncated: boolean;
}

/** 바뀐 파일 하나 — Rust `ChangedFile` */
export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: "M" | "A" | "D" | "R";
  /** 바이너리 · 모름이면 `null` */
  added: number | null;
  deleted: number | null;
}

/** 커밋 하나의 바뀐 파일 — 병합 커밋은 목록 없이 `merge` */
export interface CommitFiles {
  hash: string;
  merge: boolean;
  files: ChangedFile[];
  truncated: boolean;
}

/** 워크트리 하나의 커밋 안 한 파일 */
export interface WipFiles {
  path: string;
  head: string | null;
  files: ChangedFile[];
  truncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? Math.floor(n) : null;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hashes = (v: unknown): string[] => arr(v).filter((h): h is string => typeof h === "string" && h !== "");

function parseCommit(raw: unknown): GraphCommit | null {
  const o = obj(raw);
  const hash = str(o?.hash);
  const time = num(o?.time);
  if (!o || !hash || time === null) return null;
  return {
    hash,
    parents: hashes(o.parents),
    subject: typeof o.subject === "string" ? o.subject : "",
    time,
    added: count(o.added),
    deleted: count(o.deleted),
  };
}

function parseDirty(raw: unknown): Dirty | null {
  const o = obj(raw);
  const files = count(o?.files);
  return o && files !== null && files > 0 ? { files, added: count(o.added) ?? 0, deleted: count(o.deleted) ?? 0 } : null;
}

/** 백엔드의 그래프 답 → 모양. **throw 하지 않는다** — 모양이 어긋난 항목은 버리고, 통째로 어긋나면 `null` */
export function parseCommitGraph(raw: unknown): CommitGraph | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.main_line) || !Array.isArray(o.commits)) return null;
  const commits = new Map<string, GraphCommit>();
  for (const item of o.commits) {
    const c = parseCommit(item);
    if (c && !commits.has(c.hash)) commits.set(c.hash, c);
  }
  const mainLine: MainRow[] = [];
  for (const item of o.main_line) {
    const r = obj(item);
    const hash = str(r?.hash);
    if (r && hash) mainLine.push({ hash, skippedBefore: count(r.skipped_before) ?? 0 });
  }
  const branches: GraphBranch[] = [];
  for (const item of arr(o.branches)) {
    const b = obj(item);
    const name = str(b?.name);
    if (!b || !name) continue;
    branches.push({
      name,
      head: str(b.head) ?? "",
      base: str(b.base),
      ahead: count(b.ahead) ?? 0,
      behind: count(b.behind) ?? 0,
      commits: hashes(b.commits),
      commitsTruncated: b.commits_truncated === true,
      merged: b.merged === true,
      mergedKind: b.merged === true ? mergedKindOf(b.merged_kind) : null,
      createdFrom: str(b.created_from),
      createdAt: num(b.created_at),
    });
  }
  const folds: MergedFold[] = [];
  for (const item of arr(o.folds)) {
    const f = obj(item);
    const merge = str(f?.merge);
    if (!f || !merge) continue;
    folds.push({
      merge,
      name: str(f.name),
      commits: hashes(f.commits),
      commitsTruncated: f.commits_truncated === true,
      base: str(f.base),
      kind: f.kind === "squash" || f.kind === "rebase" ? f.kind : "merge",
    });
  }
  const worktrees: GraphWorktree[] = [];
  for (const item of arr(o.worktrees)) {
    const w = obj(item);
    const path = str(w?.path);
    if (!w || !path) continue;
    worktrees.push({ path, branch: str(w.branch), head: str(w.head), primary: w.primary === true, dirty: parseDirty(w.dirty) });
  }
  return {
    main: str(o.main),
    mainHead: str(o.main_head),
    mainLine,
    mainMore: o.main_more === true,
    commits,
    branches,
    folds,
    worktrees,
    truncated: o.truncated === true,
  };
}

function parseFile(raw: unknown): ChangedFile | null {
  const o = obj(raw);
  const path = str(o?.path);
  const st = o?.status;
  if (!o || !path || (st !== "M" && st !== "A" && st !== "D" && st !== "R")) return null;
  return { path, oldPath: str(o.old_path), status: st, added: count(o.added), deleted: count(o.deleted) };
}

const fileList = (v: unknown): ChangedFile[] => arr(v).map(parseFile).filter((f): f is ChangedFile => f !== null);

/** 커밋 하나의 바뀐 파일 답 → 모양 (throw 없음) */
export function parseCommitFiles(raw: unknown): CommitFiles | null {
  const o = obj(raw);
  const hash = str(o?.hash);
  if (!o || !hash) return null;
  return { hash, merge: o.merge === true, files: o.merge === true ? [] : fileList(o.files), truncated: o.truncated === true };
}

/** 워크트리 하나의 커밋 안 한 파일 답 → 모양 (throw 없음) */
export function parseWipFiles(raw: unknown): WipFiles | null {
  const o = obj(raw);
  const path = str(o?.path);
  if (!o || !path) return null;
  return { path, head: str(o.head), files: fileList(o.files), truncated: o.truncated === true };
}

// ---------------------------------------------------------------------------
// 줄 차례 — buildRows
// ---------------------------------------------------------------------------

/** 줄기 그림의 치수 — main 줄기 x · 브랜치 줄기 x · 칸 폭 · 줄 높이 */
export const LANE = { mainX: 12, branchX: 32, width: 46, row: 32 } as const;

/** 톤 수 — 색상환을 고르게 나눈 여덟 색을 돌려 쓴다(0 = main) */
export const TONES = 8;

/** 선 한 토막의 모양 — 없음 · 실선 · 점선(커밋 안 한 것에 닿는 선) */
export type Stroke = "solid" | "dash" | null;

/**
 * 줄 하나의 연결선 표식 — 위 반(0 → 점 높이) · 아래 반(점 높이 → 줄 끝).
 * - `trunkUp`/`trunkDown` = main 줄기(x = [`LANE.mainX`]) — 단 1 줄에서는 그 자리를 지나간다
 * - `laneUp`/`laneDown` = 브랜치 줄기(x = [`LANE.branchX`]) — 같은 덩어리 안에서만 잇는다(덩어리끼리는 끊긴다)
 * - `mergeIn` = main 줄기 위 끝에서 이 줄 점으로 휘어 들어옴(병합 — 접힘 줄 · 펼친 접힘 첫 줄)
 * - `forkOut` = 이 줄 점에서 main 줄기 아래 끝으로 휘어 나감(갈라짐 — 덩어리 마지막 줄)
 */
export interface RowLinks {
  trunkUp: Stroke;
  trunkDown: Stroke;
  laneUp: Stroke;
  laneDown: Stroke;
  mergeIn: boolean;
  forkOut: Stroke;
}

/** 이름 칸 — 덩어리 첫 줄(이름 · 워크트리) · 마지막 줄(갈라진 곳) · main 맨 위 줄 · 접힘 줄 */
export type RowLabel =
  | { kind: "main"; name: string }
  | { kind: "head"; name: string; worktree: string | null; primary: boolean; merged: boolean }
  | { kind: "fork"; base: string }
  | { kind: "fold"; name: string };

export type RowKind = "main" | "skip" | "commit" | "wip" | "fold";

/** 그래프 한 줄 */
export interface GraphRow {
  /** 고르기 · DOM 열쇠 — 같은 커밋이 두 덩어리에 설 수 있어 덩어리를 넣는다 */
  key: string;
  kind: RowKind;
  /** 0 = main 줄기 · 1 = 브랜치 줄기 */
  lane: 0 | 1;
  /** main · commit = 그 커밋, fold = 병합 커밋, wip = 그 워크트리 HEAD, skip = `null` */
  hash: string | null;
  /** 0 = main · 1..[`TONES`] = 브랜치 톤 */
  tone: number;
  /** 덩어리 열쇠 — `b:<브랜치>` · `f:<병합 커밋>` · `w:<워크트리>` (main · skip 은 `null`) */
  block: string | null;
  /** 이 줄이 속한 브랜치 이름(접힘은 그 이름, main 줄은 main) — 모르면 `null` */
  branch: string | null;
  /** 덩어리 안의 위치 — 색 막대의 끝 */
  first: boolean;
  last: boolean;
  label: RowLabel | null;
  /** wip = 그 워크트리 경로, 그 밖은 이 줄 브랜치가 체크아웃된 워크트리(없으면 `null`) */
  worktree: string | null;
  /** skip = 건너뛴 수, fold = 접힌 커밋 수 */
  n: number;
  links: RowLinks;
}

/** 짧은 해시(7자) */
export const shortHash = (h: string | null | undefined): string => (h ?? "").slice(0, 7);

/**
 * 브랜치 톤 — 줄 차례(위 → 아래)에서 브랜치가 **처음 나오는 순서**대로 1..[`TONES`] 를 돌린다(10-27 사용자 — 예전엔 이름 순이라
 * 위아래로 붙은 두 덩어리가 같은 색일 수 있었다). 그래서 이웃한 덩어리는 늘 다른 색이고, 같은 브랜치의 줄(✎ 줄 · 덩어리 · 접힘)은
 * 한 색이다. main(톤 0)은 그대로. 펴고 접어도 브랜치가 나오는 차례는 같아 색이 바뀌지 않는다.
 */
export function assignTones(rows: GraphRow[]): void {
  const order = new Map<string, number>();
  for (const r of rows) {
    if (r.tone === 0) continue;
    const name = r.branch ?? r.block ?? r.key;
    let tone = order.get(name);
    if (tone === undefined) {
      tone = (order.size % TONES) + 1;
      order.set(name, tone);
    }
    r.tone = tone;
  }
}

const NO_LINKS: RowLinks = { trunkUp: null, trunkDown: null, laneUp: null, laneDown: null, mergeIn: false, forkOut: null };

/** 줄 차례의 중간 모양 — 덩어리(`group`)째로 모은 뒤 ✎ 줄을 끼운다 */
interface Draft extends Omit<GraphRow, "links" | "first" | "last"> {
  group: number;
  /** 덩어리가 main 줄 위에 걸렸나(맨 아래 덩어리는 갈라짐 곡선이 갈 곳이 없다) */
  anchored: boolean;
  /** 접힘 덩어리(접힌 줄 · 펼친 덩어리) — 병합 곡선 */
  foldBlock: boolean;
}

/**
 * **줄 차례** (모듈 머리말의 1~4). `open` = 펼친 접힘의 병합 커밋 해시. 연결선 표식까지 붙여 돌려준다 — 그리는 쪽은
 * 표식대로 선을 긋기만 한다.
 */
export function buildRows(g: CommitGraph, open: ReadonlySet<string>): GraphRow[] {
  // 브랜치면 1(자리 표시) — 실제 톤은 줄 차례가 다 선 뒤 [`assignTones`] 가 준다
  const toneOf = (name: string | null) => (name && name !== g.main ? 1 : 0);
  const wtOf = (branch: string | null) => (branch ? (g.worktrees.find((w) => w.branch === branch) ?? null) : null);
  const timeOf = (h: string | undefined) => (h ? (g.commits.get(h)?.time ?? 0) : 0);
  const mainSet = new Set(g.mainLine.map((r) => r.hash));

  // 브랜치 덩어리 — base 의 main 줄 위 · 아니면 맨 아래. 같은 자리는 끝 커밋이 최신인 것부터.
  const live = g.branches.filter((b) => b.name !== g.main && b.commits.length > 0);
  const byHead = (a: GraphBranch, b: GraphBranch) =>
    timeOf(b.commits[0]) - timeOf(a.commits[0]) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const anchored = new Map<string, GraphBranch[]>();
  const bottom: GraphBranch[] = [];
  for (const b of live) {
    if (b.base && mainSet.has(b.base)) anchored.set(b.base, [...(anchored.get(b.base) ?? []), b]);
    else bottom.push(b);
  }
  for (const list of anchored.values()) list.sort(byHead);
  bottom.sort(byHead);
  const foldOf = new Map(g.folds.map((f) => [f.merge, f]));
  const dirtyByBranch = new Map<string, GraphWorktree>();
  for (const w of g.worktrees) if (w.dirty && w.branch && live.some((b) => b.name === w.branch)) dirtyByBranch.set(w.branch, w);

  const drafts: Draft[] = [];
  let group = 0;
  const wipDraft = (w: GraphWorktree, block: string, lane: 0 | 1, label: RowLabel | null, grp: number, anchoredTo: boolean): Draft => ({
    key: `w:${w.path}`,
    kind: "wip",
    lane,
    hash: w.head,
    tone: toneOf(w.branch),
    block,
    branch: w.branch,
    label,
    worktree: w.path,
    n: w.dirty?.files ?? 0,
    group: grp,
    anchored: anchoredTo,
    foldBlock: false,
  });
  const pushBranch = (b: GraphBranch, isAnchored: boolean) => {
    const grp = ++group;
    const block = `b:${b.name}`;
    const wt = wtOf(b.name);
    const head: RowLabel = { kind: "head", name: b.name, worktree: wt?.path ?? null, primary: wt?.primary ?? false, merged: false };
    const dirty = dirtyByBranch.get(b.name);
    if (dirty) drafts.push(wipDraft(dirty, block, 1, head, grp, isAnchored));
    b.commits.forEach((h, i) => {
      const lastRow = i === b.commits.length - 1;
      drafts.push({
        key: `c:${block}:${h}`,
        kind: "commit",
        lane: 1,
        hash: h,
        tone: toneOf(b.name),
        block,
        branch: b.name,
        label: i === 0 && !dirty ? head : lastRow && b.base ? { kind: "fork", base: b.base } : null,
        worktree: wt?.path ?? null,
        n: 0,
        group: grp,
        anchored: isAnchored,
        foldBlock: false,
      });
    });
  };
  const pushFold = (f: MergedFold) => {
    const grp = ++group;
    const block = `f:${f.merge}`;
    const name = f.name ?? shortHash(f.merge);
    const wt = wtOf(f.name);
    if (!open.has(f.merge) || f.commits.length === 0) {
      drafts.push({
        key: `f:${f.merge}`,
        kind: "fold",
        lane: 1,
        hash: f.merge,
        tone: toneOf(name),
        block,
        branch: name,
        label: { kind: "fold", name },
        worktree: wt?.path ?? null,
        n: f.commits.length,
        group: grp,
        anchored: true,
        foldBlock: true,
      });
      return;
    }
    f.commits.forEach((h, i) => {
      const lastRow = i === f.commits.length - 1;
      drafts.push({
        key: `c:${block}:${h}`,
        kind: "commit",
        lane: 1,
        hash: h,
        tone: toneOf(name),
        block,
        branch: name,
        label:
          i === 0
            ? { kind: "head", name, worktree: wt?.path ?? null, primary: wt?.primary ?? false, merged: true }
            : lastRow && f.base
              ? { kind: "fork", base: f.base }
              : null,
        worktree: wt?.path ?? null,
        n: 0,
        group: grp,
        anchored: true,
        foldBlock: true,
      });
    });
  };

  g.mainLine.forEach((m, i) => {
    if (m.skippedBefore > 0) {
      drafts.push({
        key: `s:${i}`,
        kind: "skip",
        lane: 0,
        hash: null,
        tone: 0,
        block: null,
        branch: g.main,
        label: null,
        worktree: null,
        n: m.skippedBefore,
        group: ++group,
        anchored: true,
        foldBlock: false,
      });
    }
    for (const b of anchored.get(m.hash) ?? []) pushBranch(b, true);
    const primary = g.worktrees.find((w) => w.primary) ?? null;
    drafts.push({
      key: `m:${m.hash}`,
      kind: "main",
      lane: 0,
      hash: m.hash,
      tone: 0,
      block: null,
      branch: g.main,
      label: i === 0 && g.main ? { kind: "main", name: g.main } : null,
      worktree: primary && primary.branch === g.main ? primary.path : null,
      n: 0,
      group: ++group,
      anchored: true,
      foldBlock: false,
    });
    const f = foldOf.get(m.hash);
    if (f) pushFold(f);
  });
  for (const b of bottom) pushBranch(b, false);

  // 혼자 선 ✎ 줄 — 그 워크트리 HEAD 의 줄 바로 위(덩어리 안이면 그 덩어리 위). 못 찾으면 맨 위.
  for (const w of g.worktrees) {
    if (!w.dirty || (w.branch && dirtyByBranch.get(w.branch) === w)) continue;
    const onMain = w.primary && w.branch !== null && w.branch === g.main;
    const label: RowLabel = {
      kind: "head",
      name: w.branch ?? shortHash(w.head),
      worktree: w.path,
      primary: w.primary,
      merged: false,
    };
    let at = -1;
    if (w.head) {
      at = drafts.findIndex(
        (d) =>
          (d.kind !== "skip" && d.kind !== "wip" && d.hash === w.head) ||
          (d.kind === "fold" && (foldOf.get(d.hash ?? "")?.commits.includes(w.head ?? "") ?? false)),
      );
      if (at >= 0 && drafts[at].lane === 1) {
        const grp = drafts[at].group;
        at = drafts.findIndex((d) => d.group === grp);
      }
    }
    const pos = at < 0 ? 0 : at;
    drafts.splice(pos, 0, wipDraft(w, `w:${w.path}`, onMain ? 0 : 1, label, ++group, at >= 0));
  }

  // 덩어리 안 위치 · 연결선.
  const rows: GraphRow[] = drafts.map((d, i) => {
    const prev = drafts[i - 1];
    const next = drafts[i + 1];
    const solo = d.kind === "wip" && d.block === `w:${d.worktree}`;
    return {
      key: d.key,
      kind: d.kind,
      lane: d.lane,
      hash: d.hash,
      tone: d.tone,
      block: d.block,
      branch: d.branch,
      label: d.label,
      worktree: d.worktree,
      n: d.n,
      first: d.block === null || solo || prev?.group !== d.group,
      last: d.block === null || solo || next?.group !== d.group,
      links: { ...NO_LINKS },
    };
  });
  const firstMain = rows.findIndex((r) => r.kind === "main");
  let lastMain = -1;
  rows.forEach((r, i) => {
    if (r.kind === "main") lastMain = i;
  });

  rows.forEach((r, i) => {
    const d = drafts[i];
    const next = rows[i + 1];
    const L = r.links;
    if (r.lane === 1) {
      const solo = r.kind === "wip" && r.block === `w:${r.worktree}`;
      if (!r.first) L.laneUp = rows[i - 1].kind === "wip" ? "dash" : "solid";
      if (!r.last) L.laneDown = r.kind === "wip" ? "dash" : "solid";
      if (d.foldBlock && r.first) L.mergeIn = true;
      if (solo) {
        // HEAD 를 못 찾아 맨 위에 선 ✎ 줄은 잇지 않는다(이을 곳을 모른다).
        if (!d.anchored) return;
        if (next?.lane === 1) {
          L.laneDown = "dash";
          next.links.laneUp = "dash";
        } else if (next && lastMain >= 0) L.forkOut = "dash";
      } else if (r.last && d.anchored && lastMain >= 0) L.forkOut = "solid";
    }
  });

  // main 줄기 — 맨 위 main 줄(또는 그 위에서 갈라져 들어오는 줄의 바로 아래)부터 마지막 main 줄까지 이어진다.
  if (lastMain >= 0) {
    const feeds = (i: number): Stroke =>
      rows[i].links.forkOut ?? (rows[i].lane === 0 && rows[i].kind === "wip" ? "dash" : null);
    let top = firstMain;
    for (let i = 0; i < firstMain; i++) {
      if (feeds(i)) {
        top = i + 1;
        break;
      }
    }
    rows.forEach((r, i) => {
      const L = r.links;
      if (i > top && i <= lastMain) L.trunkUp = "solid";
      else if (i === top && i > 0) L.trunkUp = feeds(i - 1);
      if (i >= top && i < lastMain) L.trunkDown = "solid";
      // 주 폴더의 ✎ 줄 — main 줄기 위의 점선
      if (r.lane === 0 && r.kind === "wip") {
        L.trunkDown = "dash";
        const nx = rows[i + 1];
        if (nx) nx.links.trunkUp = "dash";
      }
    });
  }
  assignTones(rows);
  return rows;
}

/**
 * 처음 고를 줄 — 전에 고른 열쇠(`prev`, 아직 있으면 — 다시 읽어도 자리를 지킨다) → 바라는 브랜치(`wanted`)의 덩어리 첫
 * 커밋 → 그 브랜치 워크트리의 ✎ 줄 → 그 브랜치의 접힘(병합 커밋 · squash · rebase — 접힌 채면 접힘 줄, 펼쳤으면 첫 커밋.
 * 병합된 브랜치는 덩어리가 없다) → 첫 브랜치 커밋 → 첫 커밋 줄. 줄이 없으면 `null`.
 */
export function pickRow(rows: readonly GraphRow[], wanted: string | null | undefined, prev: string | null): string | null {
  if (prev && rows.some((r) => r.key === prev && r.kind !== "skip" && r.kind !== "fold")) return prev;
  if (wanted) {
    const c = rows.find((r) => r.kind === "commit" && r.block === `b:${wanted}`);
    if (c) return c.key;
    const w = rows.find((r) => r.kind === "wip" && r.branch === wanted);
    if (w) return w.key;
    const f = rows.find(
      (r) => r.branch === wanted && (r.kind === "fold" || (r.kind === "commit" && r.block?.startsWith("f:") === true)),
    );
    if (f) return f.key;
  }
  const first =
    rows.find((r) => r.kind === "commit" && r.block?.startsWith("b:")) ??
    rows.find((r) => r.kind === "main" || r.kind === "commit" || r.kind === "wip");
  return first?.key ?? null;
}

/** 이 줄의 커밋 — main · commit 줄만 */
export function rowCommit(g: CommitGraph | null, r: GraphRow): GraphCommit | null {
  return g && r.hash && (r.kind === "main" || r.kind === "commit") ? (g.commits.get(r.hash) ?? null) : null;
}

/** 병합 커밋 줄인가(점이 빈 고리 · 글이 흐리다) */
export function rowIsMerge(g: CommitGraph | null, r: GraphRow): boolean {
  return (rowCommit(g, r)?.parents.length ?? 0) >= 2;
}

/** 줄 가운데 글 — 브랜치 타일 · 앨범 그래프가 같이 쓴다 */
export function rowMessage(g: CommitGraph | null, r: GraphRow, tr: (key: Key, params?: Record<string, string | number>) => string): string {
  if (r.kind === "skip") return tr("app.branches.row.skip", { n: r.n });
  if (r.kind === "wip") return tr("app.branches.row.wip", { n: r.n });
  if (r.kind === "fold") {
    const f = g?.folds.find((x) => x.merge === r.hash);
    if (f?.kind === "squash") return tr("app.branches.row.foldSquash", { n: r.n });
    if (f?.kind === "rebase") return tr("app.branches.row.foldRebase", { n: r.n });
    return f?.base ? tr("app.branches.row.fold", { n: r.n, base: shortHash(f.base) }) : tr("app.branches.row.foldBare", { n: r.n });
  }
  return rowCommit(g, r)?.subject ?? shortHash(r.hash);
}

/** 줄 수 합 — 접힘 줄의 `+A −D`(병합 커밋 · 모르는 것은 0) */
export function commitsTotal(g: CommitGraph, list: readonly string[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const h of list) {
    const c = g.commits.get(h);
    added += c?.added ?? 0;
    deleted += c?.deleted ?? 0;
  }
  return { added, deleted };
}

/** 주 줄 더 보기 — 다음 길이(상한에서 멈춘다), 이미 상한이면 `null` */
export function nextMainLimit(cur: number): number | null {
  return cur >= MAIN_LIMIT.max ? null : Math.min(MAIN_LIMIT.max, cur + MAIN_LIMIT.step);
}

// ---------------------------------------------------------------------------
// 작은 도구
// ---------------------------------------------------------------------------

/** 폴더 꼬리 (`/a/b/` → `b`) */
export function folderTail(path: string): string {
  const t = path.trim().replace(/[\\/]+$/, "");
  return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1) || t;
}

/**
 * 워크트리 폴더 + 저장소 기준 경로 → 문서로 열 절대 경로. 윈도우 드라이브 꼴(`C:/…` · `C:\…`)이면 구분자를 `\` 로
 * 맞춘다(파일 타일 · 문서 타일이 쓰는 글자와 같게 — 같은 파일을 두 번 열지 않는다). 원격 · POSIX 는 `/` 그대로.
 */
export function joinWorktreeFile(worktree: string, rel: string): string {
  const base = worktree.replace(/[\\/]+$/, "");
  const joined = `${base}/${rel.replace(/^[\\/]+/, "")}`;
  return /^[A-Za-z]:[\\/]/.test(joined) ? joined.replace(/\//g, "\\") : joined;
}

/** 파일 묶음의 합계 — `+22 −6` 의 재료(모르는 줄 수는 0 으로) */
export function filesTotal(files: readonly ChangedFile[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const f of files) {
    added += f.added ?? 0;
    deleted += f.deleted ?? 0;
  }
  return { added, deleted };
}

/**
 * 목록 칸의 `scrollTop` — 줄(`top` · `height` 는 목록 내용 기준)이 칸 안에 들게 필요한 만큼만 옮긴다.
 * `scrollIntoView` 가 아니다 — 바깥 창이 흔들리지 않게.
 */
export function revealScrollTop(o: { scrollTop: number; viewH: number; top: number; height: number }): number {
  let s = o.scrollTop;
  if (o.top + o.height > s + o.viewH) s = o.top + o.height - o.viewH;
  if (o.top < s) s = o.top;
  return Math.max(0, Math.round(s));
}
