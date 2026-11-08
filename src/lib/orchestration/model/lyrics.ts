/**
 * **작업자 상세의 순수 층**(2026-10-30 오케스트레이션 탭 ③ — docs/log/2026-10-29-orchestration-player-tab.md 3-3 · 8절 단계 3 · 확정 목업
 * `WorkerDetail`). 아티스트(작업자 · 판정형) 하나의 "가사"(실행 타임라인) · 지금 하는 일 · 턴 목록 · 턴 시한 · 파일 줄 · 이웃 아티스트.
 *
 * - 가사의 원천은 **그 Attempt 의 고정 대화 파일의 끝 한 쪽**(op `orchestration_worker_transcript` — 기록 보기와 같은 리더)이다. 끝 쪽을 다시 읽을
 *   때마다 [`mergeTail`] 이 앞서 본 줄에 이어 붙인다(겹치는 구간을 찾아 새 쪽으로 갈아 끼움 — 진행 중이던 도구가 결과를 받아도 같은 줄).
 * - 턴 시작 · 끝 · 보고 · 막힘 줄은 대화 기록에 없다 — 서버 보기(`turns[]` · `reports` · `blocked`)에서 시각으로 끼워 넣는다.
 * - 목업의 "Edit +32 −4" · "통과 3" 같은 **해석 숫자는 짓지 않는다**(노트 0-3 Q4) — 도구 줄은 이름 + 서버의 대상 요약 글뿐.
 * - 문구는 키로 짓고(`tr` 인자) 상태 · 조회는 쥐지 않는다(시험 `lyrics.test.ts`).
 */

import type { TranscriptItem } from "$lib/context";
import type { Key } from "$lib/i18n/keys";
import { clipText, keyText, type Tr } from "./text";
import type { AttemptView, ReportFileView, ReportView, RunDetail, WipFileView } from "./types";
import { GRADE_KEY, KIND_KEY, TURN_OUTCOME_KEY } from "./worker";
import { OUTCOME_KEY, isReviewer } from "./review";
import { judgeOf, turnRunning, writerOf } from "./album";

/** 가사로 들고 있는 대화 항목 상한(끝에서) */
export const LYRIC_CAP = 400;

/** 끝 쪽 한 번에 읽는 항목 수 */
export const LYRIC_PAGE = 120;

/** 대화 항목의 같음 열쇠 — 시각 · 역할 · 도구 이름 · 요약 · 글 앞부분(도구 결과 · 출력은 빼서 진행 중 → 끝남이 같은 줄로) */
export function transcriptKey(it: TranscriptItem): string {
  return `${it.at ?? ""}|${it.role}|${it.tool?.name ?? ""}|${it.tool?.summary ?? ""}|${(it.text ?? "").slice(0, 64)}`;
}

function firstAt(items: readonly TranscriptItem[]): number | null {
  for (const it of items) if (typeof it.at === "number") return it.at;
  return null;
}

function lastAt(items: readonly TranscriptItem[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const at = items[i].at;
    if (typeof at === "number") return at;
  }
  return null;
}

/**
 * 끝 쪽을 다시 읽은 것을 앞서 본 줄에 잇는다(**순수**). 새 쪽의 첫 항목이 옛 줄의 어디서 시작하는지 뒤에서부터 찾고, 겹치는 구간이 모두
 * 같을 때만 그 자리부터 새 쪽으로 갈아 끼운다. 겹침이 없으면 — 새 쪽이 옛 끝보다 뒤면(그사이 한 쪽보다 많이 자랐다) 이어 붙이고, 아니면
 * (대화 파일이 바뀌었다) 새 쪽만. 빈 새 쪽은 옛 줄 그대로. 결과는 끝에서 `cap` 개.
 */
export function mergeTail(prev: readonly TranscriptItem[], fresh: readonly TranscriptItem[], cap = LYRIC_CAP): TranscriptItem[] {
  if (fresh.length === 0) return prev.slice(-cap);
  if (prev.length === 0) return fresh.slice(-cap);
  const pk = prev.map(transcriptKey);
  const fk = fresh.map(transcriptKey);
  for (let i = prev.length - 1; i >= 0; i--) {
    if (pk[i] !== fk[0]) continue;
    const n = Math.min(prev.length - i, fresh.length);
    let same = true;
    for (let j = 1; j < n; j++) {
      if (pk[i + j] !== fk[j]) {
        same = false;
        break;
      }
    }
    if (same) return [...prev.slice(0, i), ...fresh].slice(-cap);
  }
  const pl = lastAt(prev);
  const ff = firstAt(fresh);
  if (pl !== null && ff !== null && ff >= pl) return [...prev, ...fresh].slice(-cap);
  return fresh.slice(-cap);
}

/** 가사 줄의 종류 */
export type LyricKind = "turn" | "prompt" | "tool" | "denied" | "say" | "report" | "end" | "interrupted";

/** 가사 한 줄 */
export interface LyricLine {
  key: string;
  kind: LyricKind;
  /** 시각(모르면 앞 줄의 것을 이어받는다 — 그래도 없으면 `null`) */
  at: number | null;
  text: string;
  /** 도구가 아직 결과를 받지 못했다(진행 중) */
  pending: boolean;
  /** 도구가 오류로 끝났다 · 턴이 실패했다 */
  error: boolean;
  /** 펼칠 원문(도구 입력 · 긴 말) — 없으면 `null` */
  full: string | null;
}

/** 가사 필터 */
export type LyricFilter = "all" | "tools" | "says";

/** 첫 의미 있는 줄들을 한 줄로 */
function flat(text: string, max: number): { short: string; clipped: boolean } {
  return clipText(text, max);
}

/**
 * 대화 항목 + 서버 보기 → 가사 줄(**순수**, 오래된 것부터). 대화 항목의 차례는 그대로 두고(시각이 없으면 앞 것을 이어받아 단조롭게),
 * 턴 시작 · 끝 · 보고 · 막힘 줄을 시각으로 끼워 넣는다(같은 시각이면 턴 시작 → 대화 → 보고 → 턴 끝).
 */
export function lyricLines(
  items: readonly TranscriptItem[],
  a: Pick<AttemptView, "id" | "turns" | "blocked">,
  reports: readonly Pick<ReportView, "reportId" | "attemptId" | "outcome" | "summary" | "at">[],
  tr: Tr,
): LyricLine[] {
  const rows: { line: LyricLine; t: number; rank: number; seq: number }[] = [];
  let seq = 0;
  const push = (line: LyricLine, t: number, rank: number) => rows.push({ line, t, rank, seq: seq++ });
  let prevT = 0;
  items.forEach((it, i) => {
    const t = Math.max(prevT, typeof it.at === "number" ? it.at : prevT);
    prevT = t;
    const at = typeof it.at === "number" ? it.at : t > 0 ? t : null;
    const key = `i${i}|${transcriptKey(it)}`;
    const base = { key, at, pending: false, error: false, full: null };
    if (it.role === "tool") {
      const tool = it.tool;
      if (!tool || !tool.name) return;
      const target = `${tool.name} ${tool.summary ?? ""}`.trim();
      if (tool.denied) {
        push({ ...base, kind: "denied", text: tr("orch.lyric.denied", { tool: target }), full: tool.input }, t, 1);
        return;
      }
      push({ ...base, kind: "tool", text: target, pending: tool.output === null && !tool.error, error: tool.error, full: tool.input }, t, 1);
      return;
    }
    if (it.role === "interrupted") {
      push({ ...base, kind: "interrupted", text: tr("orch.lyric.interrupted") }, t, 1);
      return;
    }
    const text = it.text?.trim();
    if (!text) return;
    if (it.role === "user") {
      const c = flat(text, 100);
      push({ ...base, kind: "prompt", text: tr("orch.lyric.prompt", { text: c.short }), full: c.clipped ? text : null }, t, 1);
      return;
    }
    const c = flat(text, 220);
    push({ ...base, kind: "say", text: `“${c.short}”`, full: c.clipped ? text : null }, t, 1);
  });
  for (const turn of a.turns ?? []) {
    push({ key: `t${turn.n}`, kind: "turn", at: turn.startedAt, text: tr("orch.lyric.turnStart", { n: turn.n }), pending: false, error: false, full: null }, turn.startedAt, 0);
    if (typeof turn.endedAt === "number" && turn.outcome !== "running") {
      const outcome = keyText(TURN_OUTCOME_KEY, turn.outcome, tr) + (turn.reason ? ` · ${turn.reason}` : "");
      const bad = turn.outcome !== "ok";
      push({ key: `e${turn.n}`, kind: "end", at: turn.endedAt, text: tr("orch.lyric.turnEnd", { n: turn.n, outcome }), pending: false, error: bad, full: null }, turn.endedAt, 3);
    }
  }
  for (const r of reports) {
    if (r.attemptId !== a.id) continue;
    const s = flat(r.summary ?? "", 120);
    const outcome = keyText(OUTCOME_KEY, r.outcome, tr);
    push(
      {
        key: `r${r.reportId}`,
        kind: "report",
        at: r.at,
        text: s.short ? tr("orch.lyric.report", { outcome, summary: s.short }) : tr("orch.lyric.reportBare", { outcome }),
        pending: false,
        error: r.outcome !== "success",
        full: s.clipped ? r.summary : null,
      },
      r.at,
      2,
    );
  }
  if (a.blocked) {
    const s = flat(a.blocked.need, 120);
    push({ key: `b${a.blocked.at}`, kind: "report", at: a.blocked.at, text: tr("orch.lyric.blocked", { need: s.short }), pending: false, error: true, full: s.clipped ? a.blocked.need : null }, a.blocked.at, 2);
  }
  rows.sort((x, y) => x.t - y.t || x.rank - y.rank || x.seq - y.seq);
  return rows.map((r) => r.line);
}

/** 필터 — 도구만(도구 · 거절) · 말만(에이전트 말 · 받은 지시) · 전부 */
export function filterLyrics(lines: readonly LyricLine[], f: LyricFilter): LyricLine[] {
  if (f === "tools") return lines.filter((l) => l.kind === "tool" || l.kind === "denied");
  if (f === "says") return lines.filter((l) => l.kind === "say" || l.kind === "prompt");
  return [...lines];
}

/** 지금 하는 일(턴이 돌 때만) — 결과를 기다리는 마지막 도구와 그 경과, 없으면 턴 기록의 마지막 도구 이름 */
export interface NowDoing {
  text: string;
  /** 그 도구를 부른 뒤의 ms(모르면 `null`) */
  sinceMs: number | null;
}

/** 지금 하는 일을 짓는다(**순수**) — 턴이 돌지 않으면 `null` */
export function nowDoing(lines: readonly LyricLine[], a: AttemptView, now: number): NowDoing | null {
  if (!turnRunning(a)) return null;
  const turns = a.turns ?? [];
  const startedAt = turns.length > 0 ? turns[turns.length - 1].startedAt : a.startedAt;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.at !== null && l.at < startedAt) break;
    if (l.kind === "tool" && l.pending) return { text: l.text, sinceMs: l.at === null ? null : Math.max(0, now - l.at) };
  }
  const tool = turns.length > 0 ? turns[turns.length - 1].lastTool : null;
  return tool ? { text: tool, sinceMs: null } : null;
}

/** 턴 목록 한 줄 */
export interface TurnListRow {
  n: number;
  /** 그 턴을 연 지시의 요약(대화 끝 쪽에 없으면 "첫 지시" · "이어지는 지시") */
  prompt: string;
  outcome: string;
  outcomeText: string;
  running: boolean;
  bad: boolean;
  /** 걸린 ms(도는 턴은 지금까지) */
  durationMs: number;
}

/** 턴 목록(오래된 것부터) — 지시 요약은 그 턴 시작 무렵의 첫 사람(조정자) 말에서 */
export function turnList(a: Pick<AttemptView, "turns">, items: readonly TranscriptItem[], now: number, tr: Tr): TurnListRow[] {
  const turns = a.turns ?? [];
  return turns.map((turn, i) => {
    const next = i + 1 < turns.length ? turns[i + 1].startedAt : Infinity;
    const asked = items.find(
      (it) => it.role === "user" && typeof it.at === "number" && it.at >= turn.startedAt - 60_000 && it.at < next && !!it.text?.trim(),
    );
    const running = turn.outcome === "running";
    return {
      n: turn.n,
      prompt: asked?.text ? clipText(asked.text, 60).short : tr(turn.n <= 1 ? "orch.artist.turn.first" : "orch.artist.turn.next"),
      outcome: turn.outcome,
      outcomeText: keyText(TURN_OUTCOME_KEY, turn.outcome, tr) + (turn.reason ? ` · ${turn.reason}` : ""),
      running,
      bad: !running && turn.outcome !== "ok",
      durationMs: Math.max(0, (typeof turn.endedAt === "number" ? turn.endedAt : now) - turn.startedAt),
    };
  });
}

/** 턴 시한 막대 — 도는 턴의 경과 / 그 턴의 실효 시한(서버가 적은 값 → 없으면 Run 한도 → 60분) */
export interface TurnClock {
  elapsedMs: number;
  limitMs: number;
  ratio: number;
}

/** 턴 시한(**순수**) — 턴이 돌지 않으면 `null` */
export function turnClock(a: AttemptView, d: Pick<RunDetail, "limits">, now: number): TurnClock | null {
  if (!turnRunning(a)) return null;
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const minutes = last?.args?.turnMinutes ?? d.limits.turnMinutes ?? 60;
  const limitMs = Math.max(1, minutes) * 60_000;
  const elapsedMs = Math.max(0, now - (last?.startedAt ?? a.startedAt));
  return { elapsedMs, limitMs, ratio: Math.min(1, elapsedMs / limitMs) };
}

/** 파일 상태 낱말 → 한 글자(M · A · D · R · C · T · U · ?) */
export const FILE_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  unmerged: "U",
};

/** 곁 카드의 파일 한 줄 */
export interface FileRow {
  path: string;
  letter: string;
  status: string;
  adds: number | null;
  dels: number | null;
  binary: boolean;
  /** 아직 커밋하지 않았다(작업 중 목록만) */
  uncommitted: boolean;
  untracked: boolean;
}

/** 작업 중 파일 · 보고 파일 → 곁 카드 줄(**순수**) */
export function fileRows(files: readonly (WipFileView | ReportFileView)[]): FileRow[] {
  return files.map((f) => ({
    path: f.path,
    letter: FILE_LETTER[f.status] ?? "?",
    status: f.status,
    adds: typeof f.adds === "number" ? f.adds : null,
    dels: typeof f.dels === "number" ? f.dels : null,
    binary: f.binary === true,
    uncommitted: "uncommitted" in f && f.uncommitted === true,
    untracked: "untracked" in f && f.untracked === true,
  }));
}

/** 그 Attempt 의 트랙 순번(Task 순서 · 1부터 — 표에 없으면 0) */
export function trackNoOf(d: Pick<RunDetail, "tasks">, a: Pick<AttemptView, "taskId">): number {
  return d.tasks.findIndex((x) => x.id === a.taskId) + 1;
}

/** 이웃 아티스트 하나 */
export interface ArtistNeighbor {
  attempt: AttemptView;
  /** 트랙 순번(표에 없으면 0) */
  no: number;
}

/**
 * 앨범의 아티스트 줄(**순수**) — 트랙 순서대로 그 트랙의 쓰기형(지금 것) · 그다음 판정형(도는 것, 없으면 마지막). ‹ › 칩이 이 줄을 오간다.
 */
export function artistQueue(d: Pick<RunDetail, "tasks" | "attempts">): ArtistNeighbor[] {
  const out: ArtistNeighbor[] = [];
  d.tasks.forEach((task, i) => {
    const w = writerOf(d, task);
    if (w) out.push({ attempt: w, no: i + 1 });
    const judges = (d.attempts ?? []).filter((a) => a.taskId === task.id && (isReviewer(a) || a.kind === "judge"));
    const j = judgeOf(d, task.id) ?? (judges.length > 0 ? judges[judges.length - 1] : null);
    if (j) out.push({ attempt: j, no: i + 1 });
  });
  return out;
}

/** 지금 아티스트의 이전 · 다음(줄 끝이면 `null`). 줄에 없는 Attempt(옛 시도)면 같은 트랙의 자리를 기준으로 */
export function artistNeighbors(
  d: Pick<RunDetail, "tasks" | "attempts">,
  attemptId: string,
): { prev: ArtistNeighbor | null; next: ArtistNeighbor | null } {
  const q = artistQueue(d);
  let i = q.findIndex((x) => x.attempt.id === attemptId);
  if (i < 0) {
    const a = (d.attempts ?? []).find((x) => x.id === attemptId);
    const k = a ? q.findIndex((x) => x.attempt.taskId === a.taskId) : -1;
    if (k < 0) return { prev: q.length > 0 ? q[q.length - 1] : null, next: null };
    return { prev: k > 0 ? q[k - 1] : null, next: q[k] };
  }
  return { prev: i > 0 ? q[i - 1] : null, next: i + 1 < q.length ? q[i + 1] : null };
}

/** 머리 부제의 조각(쓰기형/판정형 · 모델 · 강도 · 권한 · 턴 n) — 서버 칸만(없으면 빼고) */
export function artistSubline(a: AttemptView, d: Pick<RunDetail, "roles">, tr: Tr): string[] {
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const role = (d.roles ?? []).find((r) => r.id === a.roleId) ?? null;
  const kind = a.kind === "judge" || a.kind === "write" ? a.kind : isReviewer(a) ? "judge" : "write";
  const parts = [keyText(KIND_KEY, kind, tr)];
  const model = last?.model ?? last?.args?.model ?? (role?.model || null);
  if (model) parts.push(model);
  const effort = last?.args?.effort ?? (role?.effort || null);
  if (effort) parts.push(tr("orch.artist.effort", { effort }));
  const grade = last?.args?.grade ?? null;
  if (grade) parts.push(tr("orch.artist.grade", { grade: keyText(GRADE_KEY, grade, tr) }));
  else if (role?.permission) parts.push(tr("orch.artist.grade", { grade: role.permission }));
  if (last) parts.push(tr("orch.turn.no", { n: last.n }));
  return parts;
}

/** 가사 줄의 크기 · 밝기 계단(끝에서 몇 번째인가 — 0 = 마지막). 4 이상은 같은 계단 */
export function lyricStep(index: number, length: number): number {
  return Math.min(4, Math.max(0, length - 1 - index));
}

/** 가사 필터 칩의 문구 키 */
export const LYRIC_FILTER_KEY: Record<LyricFilter, Key> = {
  all: "orch.lyric.filter.all",
  tools: "orch.lyric.filter.tools",
  says: "orch.lyric.filter.says",
};
