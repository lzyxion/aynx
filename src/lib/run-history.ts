/**
 * 작업안 실행 기록 — Rust(`audit_runs`)가 묶어 준 감사 로그 실행을 사람이 읽는 장부로 (docs/log/2026-09-28-run-history.md).
 * 결과 문구는 결과 알림과 같은 함수(`outcomeOf`)로 만든다. 룬 모듈인 사전을 들여오면 vitest 가 이 파일을 못 읽어 문구는 `tr` 로 받는다.
 */

import type { Tr } from "$lib/finish-notify";
import {
  isFinishedRun,
  outcomeOf,
  targetName,
  type LabelOf,
  type RunOutcome,
  type RunPlan,
} from "$lib/operation-notify";
import type { AuditRun, TargetResult, TargetState } from "$lib/operations";

// ── 감사 줄 → 결과 알림이 읽는 모양 ──

const TARGET_STATES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
  "timedOut",
  "cancelled",
  "unknown",
]);

/** 제목 없는 실행에서 명령을 제목 자리에 또 적지 않는다 — 바로 아래 명령 판과 겹친다 */
export function runName(run: Pick<AuditRun, "title" | "command">): { title: string | null; command: string } {
  const title = run.title?.trim() ?? "";
  return { title: title === "" ? null : title, command: run.command.split("\n")[0] };
}

export function toTargetState(s: string): TargetState {
  return TARGET_STATES.has(s) ? (s as TargetState) : "unknown";
}

/** 출력은 발췌 꼬리뿐이다 */
export function runResults(run: AuditRun): Record<string, TargetResult> {
  const out: Record<string, TargetResult> = {};
  for (const r of run.results) {
    out[r.streamId] = {
      state: toTargetState(r.state),
      exitCode: r.exitCode ?? null,
      stdout: r.stdoutTail ?? "",
      stderr: r.stderrTail ?? "",
      startedAt: r.startedAt ?? null,
      endedAt: r.endedAt ?? null,
      errorClass: null,
    };
  }
  return out;
}

export function runPlan(run: AuditRun): RunPlan {
  return {
    title: run.title,
    command: run.command,
    targets: run.targets,
    validate: run.validate,
    approvalMethod: run.approvalMethod,
    approveAll: run.approveAll === true,
    cancelledByUser: run.cancelledByUser === true,
  };
}

/** 승인 시점의 스냅샷이 먼저다 — 세션이 닫힌 뒤에도 그때의 이름이 맞다 */
export function runLabelOf(run: AuditRun, live: LabelOf): LabelOf {
  const snap = new Map(run.targetLabels.map((l) => [l.id, l.label]));
  return (id) => snap.get(id)?.trim() || live(id) || null;
}

export type RunKind = "ok" | "bad" | "cancelled" | "open";

/** `open` = 끝난 줄이 없다 — 도는 중이거나 앱이 끝나기 전에 닫혔다 */
export function runKind(run: Pick<AuditRun, "state" | "cancelledByUser">): RunKind {
  // 사람이 멈춘 실행은 집계가 `partial` 이어도 취소다(결과 알림과 같은 판정).
  if (run.cancelledByUser && run.state !== null) return "cancelled";
  switch (run.state) {
    case "succeeded":
      return "ok";
    case "partial":
    case "failed":
      return "bad";
    case "cancelled":
      return "cancelled";
    default:
      return "open";
  }
}

/** 대상별 결과가 비었으면 알림의 물러선 문구는 이 화면에서 뜻이 없어 곁 토막을 비운다 */
export function runOutcome(run: AuditRun, live: LabelOf, tr: Tr): RunOutcome | null {
  const state = run.state;
  if (state === null || !isFinishedRun(state)) return null;
  const o = outcomeOf(state, runPlan(run), runResults(run), runLabelOf(run, live), tr);
  return o.resultsKnown ? o : { ...o, details: [] };
}

/** 실행 순서 — 첫째가 canary */
export function runTargetNames(run: AuditRun, live: LabelOf): string[] {
  const labelOf = runLabelOf(run, live);
  return run.targets.map((id) => targetName(id, labelOf));
}

export const HOSTS_INLINE_MAX = 3;

export function hostsLine(names: readonly string[], tr: Tr): string {
  if (names.length <= HOSTS_INLINE_MAX) return names.join(" · ");
  return tr("board.history.hostsMore", { name: names[0], n: names.length - 1 });
}

function targetRan(r: TargetResult): boolean {
  if (r.startedAt != null) return true;
  return r.state === "succeeded" || r.state === "failed" || r.state === "timedOut" || r.state === "unknown";
}

/** 옛 줄 · 빈 값은 수동이다 */
export function isAuto(run: Pick<AuditRun, "approvalMethod">): boolean {
  return run.approvalMethod === "auto";
}

// ── 요약 띠 ──

export interface RunSummary {
  runs: number;
  /** 일부 실패 · 실패(canary 멈춤 포함) */
  withFailure: number;
  /** 실제로 돈 대상 칸의 합 */
  targetRuns: number;
  manual: number;
  auto: number;
}

export function summarize(runs: readonly AuditRun[]): RunSummary {
  let withFailure = 0;
  let targetRuns = 0;
  let auto = 0;
  for (const run of runs) {
    if (runKind(run) === "bad") withFailure += 1;
    if (isAuto(run)) auto += 1;
    for (const r of Object.values(runResults(run))) if (targetRan(r)) targetRuns += 1;
  }
  return { runs: runs.length, withFailure, targetRuns, manual: runs.length - auto, auto };
}

export function ratioPercents(s: Pick<RunSummary, "manual" | "auto">): { manual: number; auto: number } {
  const total = s.manual + s.auto;
  if (total === 0) return { manual: 0, auto: 0 };
  const manual = Math.round((s.manual / total) * 100);
  return { manual, auto: 100 - manual };
}

// ── 거르기 ──

export type ResultFilter = "all" | "ok" | "bad" | "cancelled";
export type ApprovalFilter = "all" | "manual" | "auto";

/** 가져오는 범위(일)다 — 거르기는 가져온 것 위에서 한다 */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export interface RunFilter {
  host: string | null;
  result: ResultFilter;
  approval: ApprovalFilter;
  query: string;
}

export const DEFAULT_FILTER: RunFilter = { host: null, result: "all", approval: "all", query: "" };

/** 순서는 그대로 둔다(이미 최신순이다) */
export function filterRuns(runs: readonly AuditRun[], f: RunFilter, live: LabelOf): AuditRun[] {
  const q = f.query.trim().toLowerCase();
  return runs.filter((run) => {
    if (f.result !== "all" && runKind(run) !== f.result) return false;
    if (f.approval === "auto" && !isAuto(run)) return false;
    if (f.approval === "manual" && isAuto(run)) return false;
    if (f.host !== null && !runTargetNames(run, live).includes(f.host)) return false;
    if (q !== "") {
      const hay = `${run.title ?? ""}\n${run.command}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function hostOptions(runs: readonly AuditRun[], live: LabelOf): string[] {
  const set = new Set<string>();
  for (const run of runs) for (const n of runTargetNames(run, live)) set.add(n);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** 오늘을 포함한 달력 날짜 `days` 개 — 날짜 묶음 목록이 첫 묶음 중간에서 잘리지 않게 */
export function periodSince(days: number, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

// ── 하루 단위 묶음 ──

export interface DayGroup {
  /** 로컬 날짜 `YYYY-MM-DD` */
  key: string;
  date: Date;
  relative: "today" | "yesterday" | null;
  runs: AuditRun[];
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 승인 시각의 로컬 날짜로 묶는다 */
export function groupByDay(runs: readonly AuditRun[], now: Date): DayGroup[] {
  const today = dayKey(now);
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = dayKey(y);
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const run of [...runs].sort((a, b) => b.approvedAt - a.approvedAt)) {
    const at = new Date(run.approvedAt);
    const key = dayKey(at);
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        date: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
        relative: key === today ? "today" : key === yesterday ? "yesterday" : null,
        runs: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.runs.push(run);
  }
  return groups;
}

export const OPEN_DAYS = 2;

// ── 상세 — 출력 발췌 ──

export interface ExcerptBlock {
  name: string;
  stream: "stdout" | "stderr";
  text: string;
}

export function excerptBlocks(run: AuditRun, live: LabelOf): ExcerptBlock[] {
  const labelOf = runLabelOf(run, live);
  const byId = new Map(run.results.map((r) => [r.streamId, r]));
  const out: ExcerptBlock[] = [];
  for (const id of run.targets) {
    const r = byId.get(id);
    if (!r) continue;
    const name = targetName(id, labelOf);
    if (r.stdoutTail) out.push({ name, stream: "stdout", text: r.stdoutTail });
    if (r.stderrTail) out.push({ name, stream: "stderr", text: r.stderrTail });
  }
  return out;
}

// ── 상세 — [복사] ──

/** 화면 상세가 이미 쥔 값만 — 새로 읽는 데이터 없음 */
export interface RunCopy {
  title: string;
  result: string;
  at: number;
  summary: string | null;
  command: string;
  rows: readonly { name: string; state: string; exit: number | null }[];
  excerpts: readonly ExcerptBlock[];
}

/** 붙여넣는 곳의 언어와 무관하게 한 모양 */
export function copyStamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fence(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** 시각 줄 끝의 공백 두 칸은 Markdown 줄바꿈이다(설명 줄과 한 문단으로 붙지 않게) */
export function runMarkdown(c: RunCopy, tr: Tr): string {
  const out: string[] = [];
  out.push(`**${c.title}** — ${c.result}`, "");
  const time = `${tr("board.history.copy.time")}: ${copyStamp(c.at)}`;
  if (c.summary) out.push(`${time}  `, `${tr("board.history.copy.summary")}: ${c.summary}`);
  else out.push(time);
  const f = fence(c.command);
  out.push("", `${f}sh`, c.command, f);
  if (c.rows.length > 0) {
    out.push(
      "",
      `| ${tr("board.history.copy.col.target")} | ${tr("board.history.copy.col.result")} | ${tr("board.history.copy.col.exit")} |`,
      "|---|---|---|",
      ...c.rows.map((r) => `| ${cell(r.name)} | ${cell(r.state)} | ${r.exit ?? ""} |`),
    );
  }
  for (const b of c.excerpts) {
    const g = fence(b.text);
    out.push("", `${b.name} ${b.stream}:`, g, b.text, g);
  }
  return out.join("\n") + "\n";
}
