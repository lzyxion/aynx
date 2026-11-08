/**
 * **작업안 실행 기록 — 감사 로그를 사람이 읽는 장부로** · 순수 모듈
 * (docs/log/2026-09-28-run-history.md · 설계 노트 「작업안 실행 기록 화면 설계」).
 *
 * 대시보드 작업안 칸의 **기록** 보기가 그리는 재료다. Rust(`audit_runs`)가 감사 로그의
 * `approved`·`finished` 두 줄을 한 실행으로 묶어 주면, 여기서 그 실행을
 *
 * - 결과 알림과 **같은 글자**로 말하고(`runOutcome` → `operation-notify.ts` 의 `outcomeOf` 를 그대로 부른다 —
 *   `canary 실패로 멈춤` · `canary 검증 실패로 멈춤` 까지 한 함수다),
 * - 거르고(`filterRuns` — 호스트 · 결과 · 승인 방식 · 제목/명령 검색),
 * - 세고(`summarize` — 실행 수 · 실패 포함 · 대상 실행 횟수 · 수동/자동),
 * - 하루 단위로 묶는다(`groupByDay` — 최신이 위).
 *
 * 룬도 DOM 도 `invoke` 도 없다 — 값을 받아 값을 준다. 문구는 `tr` 로 들어온다(`operation-notify.ts`
 * 와 같은 나눔 — 룬 모듈인 사전을 들여오면 vitest 가 이 파일을 못 읽는다). 계약 타입은 `operations.ts`
 * 에서 **타입만** 들여온다.
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

// ---------------------------------------------------------------------------
// 감사 줄 → 결과 알림이 읽는 모양
// ---------------------------------------------------------------------------

const TARGET_STATES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
  "timedOut",
  "cancelled",
  "unknown",
]);

/**
 * 목록 줄·상세 머리가 그리는 **이름** — 제목이 있으면 `{ title, command: 첫 줄 }`, 없으면 `{ title: null }`.
 *
 * 제목 없는 실행(AI 작업안의 대부분)에서 명령을 제목 자리에 **또 적지 않는다** — 목록 줄은 명령
 * 첫 줄을 mono 한 줄로 한 번만, 상세 머리는 같은 한 줄을 말줄임으로 그린다(바로 아래 명령 전문 판과
 * 문단 둘이 겹치지 않게 · 2026-09-28 실기). 알림의 [`headlineOf`] 는 그대로다 — 알림엔 명령 판이 없다.
 */
export function runName(run: Pick<AuditRun, "title" | "command">): { title: string | null; command: string } {
  const title = run.title?.trim() ?? "";
  return { title: title === "" ? null : title, command: run.command.split("\n")[0] };
}

/** 감사 줄의 대상 상태 문자열 → `TargetState`. 모르는 값은 `unknown`(상태 불명)으로 읽는다. */
export function toTargetState(s: string): TargetState {
  return TARGET_STATES.has(s) ? (s as TargetState) : "unknown";
}

/** 실행의 대상별 결과 → `operation_results` 와 같은 모양(streamId → 결과). 출력은 발췌 꼬리뿐이다. */
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

/** 실행 → 결과 알림 함수가 읽는 작업안 칸들 */
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

/**
 * 대상 이름 — **승인 시점의 스냅샷이 먼저**(세션이 닫힌 뒤에도 그때의 이름이 맞다), 그다음 지금 창이
 * 아는 이름(`live`). 둘 다 모르면 `null` 이고, 부르는 쪽의 `targetName` 이 위임 별칭 · id 앞머리로 줄인다.
 */
export function runLabelOf(run: AuditRun, live: LabelOf): LabelOf {
  const snap = new Map(run.targetLabels.map((l) => [l.id, l.label]));
  return (id) => snap.get(id)?.trim() || live(id) || null;
}

/** 줄의 결 — 표식(✓ · ! · ■ · ·)과 결과 거르개가 같은 값을 쓴다 */
export type RunKind = "ok" | "bad" | "cancelled" | "open";

/** 실행 → 결 (`open` = 끝난 줄이 없다 — 도는 중이거나 앱이 끝나기 전에 닫혔다) */
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

/**
 * 끝난 실행을 말할 토막 — **결과 알림과 같은 함수**(`outcomeOf`). 끝난 줄이 없으면 `null`.
 *
 * 끝난 줄은 있는데 대상별 결과가 비었으면(대상 없음 — 있을 수 없는 판) 알림의 물러선 문구
 * (`대상별 결과는 대시보드에서`)가 이 화면에서는 뜻이 없으므로 곁 토막을 비운다.
 */
export function runOutcome(run: AuditRun, live: LabelOf, tr: Tr): RunOutcome | null {
  const state = run.state;
  if (state === null || !isFinishedRun(state)) return null;
  const o = outcomeOf(state, runPlan(run), runResults(run), runLabelOf(run, live), tr);
  return o.resultsKnown ? o : { ...o, details: [] };
}

/** 대상 이름들(실행 순서 — 첫째가 canary) */
export function runTargetNames(run: AuditRun, live: LabelOf): string[] {
  const labelOf = runLabelOf(run, live);
  return run.targets.map((id) => targetName(id, labelOf));
}

/** 줄의 대상 칸 — 셋까지는 이어 적고, 넘으면 `web-01 외 4` */
export const HOSTS_INLINE_MAX = 3;

export function hostsLine(names: readonly string[], tr: Tr): string {
  if (names.length <= HOSTS_INLINE_MAX) return names.join(" · ");
  return tr("board.history.hostsMore", { name: names[0], n: names.length - 1 });
}

/** 이 대상은 실제로 돌았는가 — 요약 띠의 "대상 실행" 을 센다(시작 전 취소·대기는 아니다) */
function targetRan(r: TargetResult): boolean {
  if (r.startedAt != null) return true;
  return r.state === "succeeded" || r.state === "failed" || r.state === "timedOut" || r.state === "unknown";
}

/** 승인 방식 — 옛 줄·빈 값은 수동이다(자동 승인은 2026-09-10 부터 이 칸을 늘 적었다) */
export function isAuto(run: Pick<AuditRun, "approvalMethod">): boolean {
  return run.approvalMethod === "auto";
}

// ---------------------------------------------------------------------------
// 요약 띠
// ---------------------------------------------------------------------------

export interface RunSummary {
  /** 실행 수 */
  runs: number;
  /** 실패 포함 — 일부 실패 · 실패(canary 멈춤 포함) */
  withFailure: number;
  /** 대상 실행 횟수 — 실제로 돈 대상 칸의 합 */
  targetRuns: number;
  manual: number;
  auto: number;
}

/** 실행들 → 요약 띠의 수. **순수 함수** */
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

/** 수동/자동 막대의 폭(%) — 실행이 없으면 둘 다 0 */
export function ratioPercents(s: Pick<RunSummary, "manual" | "auto">): { manual: number; auto: number } {
  const total = s.manual + s.auto;
  if (total === 0) return { manual: 0, auto: 0 };
  const manual = Math.round((s.manual / total) * 100);
  return { manual, auto: 100 - manual };
}

// ---------------------------------------------------------------------------
// 거르기
// ---------------------------------------------------------------------------

export type ResultFilter = "all" | "ok" | "bad" | "cancelled";
export type ApprovalFilter = "all" | "manual" | "auto";

/** 기간 후보(일) — 가져오는 범위다(거르기는 가져온 것 위에서 한다) */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export interface RunFilter {
  /** 대상 이름 하나(`null` = 전체) — 이 이름의 대상이 하나라도 있으면 남는다 */
  host: string | null;
  result: ResultFilter;
  approval: ApprovalFilter;
  /** 제목 · 명령 검색(대소문자 무시, 앞뒤 공백 무시) */
  query: string;
}

export const DEFAULT_FILTER: RunFilter = { host: null, result: "all", approval: "all", query: "" };

/** 거르기 — **순수 함수**. 순서는 그대로 둔다(이미 최신순이다). */
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

/** 호스트 거르개의 후보 — 가져온 실행들의 대상 이름(가나다순, 중복 없음) */
export function hostOptions(runs: readonly AuditRun[], live: LabelOf): string[] {
  const set = new Set<string>();
  for (const run of runs) for (const n of runTargetNames(run, live)) set.add(n);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * 기간 → 가져올 시작 시각(epoch ms). `days` 일 = **오늘을 포함한** 달력 날짜 `days` 개 — 7일이면
 * 엿새 전 자정부터다(날짜 묶음 목록이 첫 묶음 중간에서 잘리지 않게).
 */
export function periodSince(days: number, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

// ---------------------------------------------------------------------------
// 하루 단위 묶음
// ---------------------------------------------------------------------------

export interface DayGroup {
  /** 로컬 날짜 `YYYY-MM-DD` — `#each` 키 */
  key: string;
  /** 그 날 자정(로컬) — 머리 글자를 만드는 쪽이 날짜·요일을 뽑는다 */
  date: Date;
  relative: "today" | "yesterday" | null;
  runs: AuditRun[];
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 실행들(최신순) → 하루 묶음(최신 날이 위). **순수 함수** — 승인 시각의 **로컬** 날짜로 묶는다.
 * 입력 순서를 믿지 않고 승인 시각 내림차순으로 한 번 정렬한다(묶음 안도 최신이 위).
 */
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

/** 처음부터 펼쳐 두는 묶음 수 — 가장 최근 두 날. 나머지는 `N건 더 ▾` 로 접혀 선다(목업 안 A). */
export const OPEN_DAYS = 2;

// ---------------------------------------------------------------------------
// 상세 — 출력 발췌
// ---------------------------------------------------------------------------

export interface ExcerptBlock {
  name: string;
  stream: "stdout" | "stderr";
  text: string;
}

/** 저장된 출력 꼬리 → 상세의 발췌 덩어리(대상 순서 · stdout 먼저). 없으면 빈 목록. */
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

// ---------------------------------------------------------------------------
// 상세 — [복사](2026-10-27 · 목업 9Pa28svsRh21yxiGBsfTPj)
// ---------------------------------------------------------------------------

/** 복사할 실행 한 건 — 화면 상세가 이미 쥔 값만(새로 읽는 데이터 없음). 대상 줄은 화면과 같은 순서(실패 먼저) */
export interface RunCopy {
  /** 제목 — 없으면 명령 첫 줄 */
  title: string;
  /** 결과 한 마디 + `(성공 수/대상 수)` — 화면이 만든 글자 그대로 */
  result: string;
  /** 승인 시각(epoch ms) */
  at: number;
  /** 설명(AI 가 쓴 승인 요약) — 없으면 그 줄이 빠진다 */
  summary: string | null;
  command: string;
  rows: readonly { name: string; state: string; exit: number | null }[];
  excerpts: readonly ExcerptBlock[];
}

/** `2026-10-27 14:20` — 로컬 시각, 붙여넣는 곳의 언어와 무관하게 한 모양 */
export function copyStamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 코드 울타리 — 안에 든 가장 긴 백틱 줄보다 하나 길게(최소 3) */
function fence(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** 표 칸 — `|` 와 줄바꿈이 표를 깨지 않게 */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 실행 한 건 → 붙여넣을 Markdown. 제목(굵게) — 결과 / 시각 · 설명 / 명령 / 대상별 표 / 저장된 출력 발췌.
 * 시각 줄 끝의 공백 두 칸은 Markdown 줄바꿈이다(설명 줄과 한 문단으로 붙지 않게). **순수**(시험 대상).
 */
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
