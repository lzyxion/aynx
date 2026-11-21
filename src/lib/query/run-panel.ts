/**
 * 쿼리 타일의 문장별 결과 패널 · 편집기 거터 표시.
 *
 * - 성공한 문장들의 상태는 실행의 끝(`outcome`)이 정한다. 작업이 나중에 커밋 · 되돌림으로 끝나도 이 표시는 바꾸지 않는다.
 * - 실행하지 않은 뒤 문장은 프런트 렉서(`splitStatements`)로 나눠 채운다 — 서버가 준 자리가 렉서와 하나라도 어긋나거나 문장 수가
 *   다르면 편집기에 아무것도 표시하지 않는다(`aligned: false` — 엉뚱한 줄을 칠하지 않게).
 */
import type { DbDialect, DbQueryResult, DbScriptReason, DbScriptResult } from "./query-backend";
import { splitStatements } from "./statement-at";

export type StmtStatus = "ok" | "undone" | "failed" | "skipped" | "unknown";

export interface PanelRow {
  index: number;
  status: StmtStatus;
  /** 보낸 글을 모르면 첫 낱말 */
  sql: string;
  /** 보낸 글 안의 자리(UTF-16) — 모르면 `null` */
  start: number | null;
  end: number | null;
  result: DbQueryResult | null;
  message?: string;
  /** 오류 원문이 없을 때 화면이 글로 바꾼다 */
  stop?: DbScriptReason;
}

/** `hidden` = 줄로 못 세운 실행 안 한 문장 수(보낸 글을 모를 때) */
export interface PanelList {
  rows: PanelRow[];
  aligned: boolean;
  hidden: number;
}

export function oneLine(sql: string, max = 240): string {
  const s = sql.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** `script-run` 의 `scriptSummary` 와 같은 판정 */
function closedWork(r: DbScriptResult): boolean {
  return (r.outcome === "rolledBack" && r.workClosed === true) || (r.outcome === "workUndone" && r.tx !== undefined && r.tx.state !== "open");
}

export function doneStatus(r: DbScriptResult): StmtStatus {
  if (closedWork(r)) return "undone";
  switch (r.outcome) {
    case "committed":
    case "readOnly":
    case "work":
    case "refused":
      return "ok";
    case "rolledBack":
    case "disconnected":
    case "workUndone":
      return "undone";
    case "workEnded":
      return r.reason ? "undone" : "unknown";
    case "unknown":
      return "unknown";
  }
}

/** `sent` = 보낸 글(모르면 `null` — 다시 붙은 요약) */
export function scriptPanel(r: DbScriptResult, sent: string | null, dialect: DbDialect): PanelList {
  const done = doneStatus(r);
  const byIndex = new Map<number, PanelRow>();
  for (const x of r.results) {
    byIndex.set(x.index, {
      index: x.index,
      status: done,
      sql: sent !== null ? oneLine(sent.slice(x.start, x.end)) : x.keyword,
      start: x.start,
      end: x.end,
      result: x,
    });
  }
  if (r.failed) {
    const f = r.failed;
    byIndex.set(f.index, {
      index: f.index,
      status: "failed",
      sql: sent !== null ? oneLine(sent.slice(f.start, f.end)) : "",
      start: f.start,
      end: f.end,
      result: null,
      message: f.message,
      ...(r.reason && r.reason !== "error" ? { stop: r.reason } : {}),
    });
  }
  // 취소 · 시간 제한은 서버가 멈춘 문장을 따로 싣지 않는다 — 성공한 문장 바로 뒤가 멈춘 자리다
  const stoppedAt = !r.failed && (r.reason === "cancelled" || r.reason === "timedOut") && r.results.length < r.total ? r.results.length : null;

  const split = sent !== null ? splitStatements(sent, dialect) : null;
  const aligned =
    split !== null &&
    split.length === r.total &&
    r.total > 0 &&
    [...byIndex.values()].every((row) => {
      const s = split[row.index];
      return s !== undefined && s.start === row.start && s.end === row.end;
    });

  if (!aligned) {
    const rows = [...byIndex.values()].sort((a, b) => a.index - b.index);
    if (stoppedAt !== null && !byIndex.has(stoppedAt)) {
      rows.push({ index: stoppedAt, status: "failed", sql: "", start: null, end: null, result: null, stop: r.reason });
    }
    const ran = rows.length;
    return { rows, aligned: false, hidden: Math.max(0, r.total - ran) };
  }

  const rows: PanelRow[] = split!.map((s, i) => {
    const known = byIndex.get(i);
    if (known) return known;
    if (i === stoppedAt) {
      return { index: i, status: "failed", sql: oneLine(sent!.slice(s.start, s.end)), start: s.start, end: s.end, result: null, stop: r.reason };
    }
    return { index: i, status: "skipped", sql: oneLine(sent!.slice(s.start, s.end)), start: s.start, end: s.end, result: null };
  });
  return { rows, aligned: true, hidden: 0 };
}

export function queryPanel(r: DbQueryResult, sent: string): PanelList {
  return {
    rows: [{ index: 0, status: "ok", sql: oneLine(sent), start: 0, end: sent.length, result: r }],
    aligned: true,
    hidden: 0,
  };
}

/** 취소 · 연결 · 낡은 작업 id 같은 실패(`other`)는 그 문장의 잘못이 아니라 `null` */
export function queryErrorPanel(kind: "error" | "needsWork" | "unconfirmed" | "other", message: string, sent: string): PanelList | null {
  if (kind === "other") return null;
  return {
    rows: [
      {
        index: 0,
        status: kind === "unconfirmed" ? "unknown" : "failed",
        sql: oneLine(sent),
        start: 0,
        end: sent.length,
        result: null,
        message,
      },
    ],
    aligned: true,
    hidden: 0,
  };
}

/** `skipped` 에는 `hidden` 도 센다 · `affected` = ✓ 문장의 영향 행 합 */
export interface PanelCounts {
  ok: number;
  undone: number;
  failed: number;
  skipped: number;
  unknown: number;
  affected: number;
}

export function panelCounts(l: PanelList): PanelCounts {
  const c: PanelCounts = { ok: 0, undone: 0, failed: 0, skipped: l.hidden, unknown: 0, affected: 0 };
  for (const r of l.rows) {
    c[r.status]++;
    if (r.status === "ok" && r.result?.affected !== undefined) c.affected += r.result.affected;
  }
  return c;
}

/** 탭 줄이 없을 때 처음 펼칠 줄 — 없으면 `-1` */
export function initialPick(l: PanelList): number {
  const failed = l.rows.findIndex((r) => r.status === "failed" || (r.status === "unknown" && r.message));
  if (failed >= 0) return failed;
  for (let i = l.rows.length - 1; i >= 0; i--) if ((l.rows[i].result?.columns.length ?? 0) > 0) return i;
  return -1;
}

/** 행을 돌려준 문장마다 하나. `no` = 1 기준 결과 번호(문장 번호와 다르다) · `row` = `PanelList.rows` 의 자리 */
export interface ResultTab {
  no: number;
  row: number;
  rows: number;
  sql: string;
  result: DbQueryResult;
}

export function resultTabs(l: PanelList, detached = false): ResultTab[] {
  if (detached) return [];
  const out: ResultTab[] = [];
  l.rows.forEach((r, i) => {
    const x = r.result;
    if (!x || x.columns.length === 0 || (r.status !== "ok" && r.status !== "undone")) return;
    out.push({ no: out.length + 1, row: i, rows: x.rows.length, sql: r.sql, result: x });
  });
  return out;
}

export function hasTabBar(l: PanelList | null, script: boolean, tabs: readonly ResultTab[]): boolean {
  return script && l !== null && l.rows.length + l.hidden >= 2 && tabs.length > 0;
}

/** `"summary"` 또는 `ResultTab.no` */
export type ResultTabId = "summary" | number;

/** 모두 성공이면 마지막 결과 탭 — 스크립트는 대개 준비 문장 뒤 마지막 SELECT 가 보려던 것이다(Beekeeper Studio 와 같다) */
export function initialTab(l: PanelList, tabs: readonly ResultTab[]): ResultTabId {
  if (l.hidden > 0 || l.rows.some((r) => r.status !== "ok")) return "summary";
  return tabs.length > 0 ? tabs[tabs.length - 1].no : "summary";
}

/** `tint` = 연한 줄 바탕을 칠하나 */
export interface RunMark {
  from: number;
  to: number;
  status: StmtStatus;
  tint: boolean;
  message?: string;
}

/** `base` = 보낸 글의 편집기 시작 자리. 단문의 성공은 바탕 없이 거터만 — 가장 흔한 일에 편집기가 물들지 않게 */
export function runMarks(l: PanelList, base: number, single: boolean): RunMark[] {
  if (!l.aligned) return [];
  const out: RunMark[] = [];
  for (const r of l.rows) {
    if (r.start === null || r.end === null || r.end <= r.start) continue;
    const tint = r.status === "unknown" ? false : !(single && r.status === "ok");
    out.push({ from: base + r.start, to: base + r.end, status: r.status, tint, ...(r.message ? { message: r.message } : {}) });
  }
  return out;
}

/** 한 줄에 둘 이상의 문장이 걸리면 이 차례로 하나를 고른다(앞이 이긴다) */
export const STATUS_RANK: readonly StmtStatus[] = ["failed", "unknown", "undone", "ok", "skipped"];

export function strongerStatus(a: StmtStatus, b: StmtStatus): StmtStatus {
  return STATUS_RANK.indexOf(a) <= STATUS_RANK.indexOf(b) ? a : b;
}

/** 0 기준 줄 번호 → 상태 · 바탕. `lineOf` = 글자 자리 → 0 기준 줄 */
export function lineMarks(marks: readonly RunMark[], lineOf: (pos: number) => number): Map<number, { status: StmtStatus; tint: boolean; message?: string }> {
  const out = new Map<number, { status: StmtStatus; tint: boolean; message?: string }>();
  for (const m of marks) {
    const a = lineOf(m.from);
    const b = lineOf(Math.max(m.from, m.to - 1));
    for (let line = a; line <= b; line++) {
      const cur = out.get(line);
      if (!cur) {
        out.set(line, { status: m.status, tint: m.tint, ...(m.message ? { message: m.message } : {}) });
        continue;
      }
      const win = strongerStatus(cur.status, m.status);
      if (win === cur.status && win !== m.status) continue;
      if (win === m.status && win !== cur.status) {
        out.set(line, { status: m.status, tint: m.tint, ...(m.message ? { message: m.message } : {}) });
        continue;
      }
      out.set(line, { status: cur.status, tint: cur.tint || m.tint, ...(cur.message ?? m.message ? { message: cur.message ?? m.message } : {}) });
    }
  }
  return out;
}
