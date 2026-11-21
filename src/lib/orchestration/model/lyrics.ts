/**
 * 작업자 상세의 순수 층 — 가사(실행 타임라인)의 원천은 그 Attempt 의 고정 대화 파일의 끝 한 쪽이다.
 * 도구 줄에 해석 숫자("Edit +32 −4" · "통과 3")는 짓지 않는다 — 이름 + 서버의 대상 요약 글뿐.
 */

import type { TranscriptItem } from "$lib/context";
import type { Key } from "$lib/i18n/keys";
import { clipText, keyText, type Tr } from "./text";
import type { AttemptView, ReportFileView, ReportView, RunDetail, WipFileView } from "./types";
import { GRADE_KEY, KIND_KEY, TURN_OUTCOME_KEY } from "./worker";
import { OUTCOME_KEY, isReviewer } from "./review";
import { judgeOf, turnRunning, writerOf } from "./album";
import { effortLabel, modelLabel } from "$lib/model-order";

export const LYRIC_CAP = 400;

export const LYRIC_PAGE = 120;

/** 도구 결과 · 출력은 열쇠에서 뺀다 — 진행 중이던 도구가 결과를 받아도 같은 줄이어야 한다 */
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

/** 겹침이 없을 때 새 쪽이 옛 끝보다 뒤면 그사이 한 쪽보다 많이 자란 것이고, 아니면 대화 파일이 바뀐 것이다 */
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

export type LyricKind = "turn" | "prompt" | "tool" | "denied" | "say" | "report" | "end" | "interrupted";

export interface LyricLine {
  key: string;
  kind: LyricKind;
  at: number | null;
  text: string;
  pending: boolean;
  error: boolean;
  full: string | null;
}

export type LyricFilter = "all" | "tools" | "says";

function flat(text: string, max: number): { short: string; clipped: boolean } {
  return clipText(text, max);
}

/** 턴 · 보고 · 막힘 줄은 대화 기록에 없어 서버 보기에서 시각으로 끼워 넣는다 */
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

export function filterLyrics(lines: readonly LyricLine[], f: LyricFilter): LyricLine[] {
  if (f === "tools") return lines.filter((l) => l.kind === "tool" || l.kind === "denied");
  if (f === "says") return lines.filter((l) => l.kind === "say" || l.kind === "prompt");
  return [...lines];
}

export interface NowDoing {
  text: string;
  sinceMs: number | null;
}

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

export interface TurnListRow {
  n: number;
  prompt: string;
  outcome: string;
  outcomeText: string;
  running: boolean;
  bad: boolean;
  durationMs: number;
}

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

export interface TurnClock {
  elapsedMs: number;
  limitMs: number;
  ratio: number;
}

export function turnClock(a: AttemptView, d: Pick<RunDetail, "limits">, now: number): TurnClock | null {
  if (!turnRunning(a)) return null;
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const minutes = last?.args?.turnMinutes ?? d.limits.turnMinutes ?? 60;
  const limitMs = Math.max(1, minutes) * 60_000;
  const elapsedMs = Math.max(0, now - (last?.startedAt ?? a.startedAt));
  return { elapsedMs, limitMs, ratio: Math.min(1, elapsedMs / limitMs) };
}

export const FILE_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  unmerged: "U",
};

export interface FileRow {
  path: string;
  letter: string;
  status: string;
  adds: number | null;
  dels: number | null;
  binary: boolean;
  uncommitted: boolean;
  untracked: boolean;
}

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

export function trackNoOf(d: Pick<RunDetail, "tasks">, a: Pick<AttemptView, "taskId">): number {
  return d.tasks.findIndex((x) => x.id === a.taskId) + 1;
}

export interface ArtistNeighbor {
  attempt: AttemptView;
  no: number;
}

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

/** 줄에 없는 Attempt(옛 시도)면 같은 트랙의 자리를 기준으로 */
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

export function artistSubline(a: AttemptView, d: Pick<RunDetail, "roles">, tr: Tr): string[] {
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const role = (d.roles ?? []).find((r) => r.id === a.roleId) ?? null;
  const kind = a.kind === "judge" || a.kind === "write" ? a.kind : isReviewer(a) ? "judge" : "write";
  const parts = [keyText(KIND_KEY, kind, tr)];
  const model = last?.model ?? last?.args?.model ?? (role?.model || null);
  if (model) parts.push(modelLabel(model));
  const effort = last?.args?.effort ?? (role?.effort || null);
  if (effort) parts.push(tr("orch.artist.effort", { effort: effortLabel(effort) }));
  const grade = last?.args?.grade ?? null;
  if (grade) parts.push(tr("orch.artist.grade", { grade: keyText(GRADE_KEY, grade, tr) }));
  else if (role?.permission) parts.push(tr("orch.artist.grade", { grade: role.permission }));
  if (last) parts.push(tr("orch.turn.no", { n: last.n }));
  return parts;
}

/** 0 = 마지막 줄 */
export function lyricStep(index: number, length: number): number {
  return Math.min(4, Math.max(0, length - 1 - index));
}

export const LYRIC_FILTER_KEY: Record<LyricFilter, Key> = {
  all: "orch.lyric.filter.all",
  tools: "orch.lyric.filter.tools",
  says: "orch.lyric.filter.says",
};
