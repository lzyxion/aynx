/**
 * **쿼리 타일의 문장별 결과 패널 · 편집기 거터 표시**(10-14 — Beekeeper Studio 식 개편). 순수.
 *
 * 단문 실행 · 여러 문장(`Ctrl+Enter` 가 스크립트 실행기로 간 것) · [스크립트 실행] 이 **같은 틀**이다 — 요약 줄 + 문장 목록(단문은 한
 * 줄짜리) + 맨 아래 개수 줄("✓ n · ↶ n · ✕ n · 건너뜀 n"). 성공 · 되돌림 · 실행 안 함도 모두 줄로 보이고 실패 줄만 강조한다. 문장이
 * 둘 이상이면 결과마다 탭([`resultTabs`] — `[요약] [결과 1 · 3행] …`), 단문은 목록 아래 결과 표 하나(`QueryView` ·
 * `RunResults.svelte` 가 그린다).
 *
 * ## 문장의 상태
 *
 * | 상태 | 그림 | 뜻 |
 * |---|---|---|
 * | `ok` | ✓ | 실행했고 그 결과가 남는다(커밋 · 읽기 전용 조회 · 트랜잭션 작업 안에 쌓임) |
 * | `undone` | ↶ | 실행했지만 되돌려졌다(스크립트의 첫 오류 · 이번 실행만 되돌림 · 끊김 · 작업 전체 되돌림) |
 * | `failed` | ✕ | 이 문장에서 멈췄다(DB 오류 · 거절 · 취소 · 시간 제한) — 오류 원문을 그 줄에 |
 * | `skipped` | · | 실행하지 않았다(멈춘 문장 뒤 · 실행 전 거절) |
 * | `unknown` | ? | 결과 불명(커밋 응답 유실 등 — 반영됐는지 앱이 모른다) |
 *
 * 한 실행의 성공한 문장들이 어떻게 됐는지는 **실행의 끝**(`outcome`)이 정한다 — [`doneStatus`]. 작업이 나중에 커밋 · 되돌림으로
 * 끝나도 이 표시는 바꾸지 않는다(그 사건은 결과 칸 머리 줄에 따로 — `tx-work` 의 `txEndNote`). 편집기 글을 고치거나 다시 실행하면
 * 지운다.
 *
 * ## 편집기 자리 맞추기(안전하게)
 *
 * 서버는 문장마다 **보낸 글 안의 UTF-16 자리**를 준다(성공한 문장 · 멈춘 문장만). 실행하지 않은 뒤 문장은 자리가 없어 프런트 렉서
 * (`statement-at` 의 `splitStatements` — 서버 가드와 같은 규칙)로 나눠 채우는데, **서버가 준 자리가 렉서의 자리와 하나라도 어긋나거나
 * 문장 수가 다르면 그 실행은 편집기에 아무것도 표시하지 않는다**(`aligned: false` — 엉뚱한 줄을 칠하지 않게). 보낸 뒤 편집기 글이
 * 바뀌었으면 부르는 쪽이 표시하지 않는다.
 */
import type { DbDialect, DbQueryResult, DbScriptReason, DbScriptResult } from "./query-backend";
import { splitStatements } from "./statement-at";

export type StmtStatus = "ok" | "undone" | "failed" | "skipped" | "unknown";

/** 목록의 한 줄 */
export interface PanelRow {
  /** 0 기준 차례(스크립트의 문장 번호) */
  index: number;
  status: StmtStatus;
  /** 한 줄로 접은 SQL(보낸 글을 모르면 첫 낱말) */
  sql: string;
  /** 보낸 글 안의 자리(UTF-16) — 모르면 `null` */
  start: number | null;
  end: number | null;
  /** 성공한 문장의 결과(행 · 영향 행 수 · 시간) */
  result: DbQueryResult | null;
  /** 실패 줄의 DB 오류 원문 */
  message?: string;
  /** 멈춘 까닭(취소 · 시간 제한 — 오류 원문이 없을 때 화면이 글로 바꾼다) */
  stop?: DbScriptReason;
}

/** 패널 목록 — `aligned` 가 거짓이면 편집기에 표시하지 않는다 · `hidden` = 줄로 못 세운 실행 안 한 문장 수(보낸 글을 모를 때) */
export interface PanelList {
  rows: PanelRow[];
  aligned: boolean;
  hidden: number;
}

/** 한 줄로 — 줄바꿈 · 연속 빈칸을 하나로, 길면 자른다(…) */
export function oneLine(sql: string, max = 240): string {
  const s = sql.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 자동 커밋 끔 · 작업 없음에서 저절로 연 작업까지 닫힌 실행(`script-run` 의 `scriptSummary` 와 같은 판정) */
function closedWork(r: DbScriptResult): boolean {
  return (r.outcome === "rolledBack" && r.workClosed === true) || (r.outcome === "workUndone" && r.tx !== undefined && r.tx.state !== "open");
}

/** 성공한 문장들의 상태 — 실행의 끝(`outcome`)이 정한다(머리말 표) */
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

/**
 * 스크립트 결과 → 목록. `sent` = 보낸 글(모르면 `null` — 다시 붙은 요약). 보낸 글을 알면 렉서로 나눠 실행 안 한 문장까지 줄로 세우고,
 * 서버의 자리와 맞는지(`aligned`)를 함께 잰다.
 */
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
  // 멈춘 문장(취소 · 시간 제한)인데 서버가 그 문장을 따로 싣지 않았다 — 성공한 문장 바로 뒤가 멈춘 자리다.
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

/** 단문의 성공 → 한 줄짜리 목록(자리는 보낸 문장 전체) */
export function queryPanel(r: DbQueryResult, sent: string): PanelList {
  return {
    rows: [{ index: 0, status: "ok", sql: oneLine(sent), start: 0, end: sent.length, result: r }],
    aligned: true,
    hidden: 0,
  };
}

/**
 * 단문의 실패 → 한 줄짜리 목록. 문장에 붙는 실패만(DB 오류 · 서버 거절 · `[db-needs-work]` = ✕, `[db-unconfirmed]` = ?) — 취소 ·
 * 연결 · 낡은 작업 id 같은 실패는 그 문장의 잘못이 아니라 `null`(목록 없이 요약 줄만).
 */
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

/** 맨 아래 개수 줄 — `skipped` 에는 줄로 못 세운 실행 안 한 문장(`hidden`)도 센다 · `affected` = 남은(✓) 문장의 영향 행 합 */
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

/** 처음 펼칠 줄(탭 줄이 없을 때 — 단문 · 한 문장 스크립트) — 실패 줄이 있으면 그것, 아니면 행을 돌려준 마지막 문장, 없으면 `-1` */
export function initialPick(l: PanelList): number {
  const failed = l.rows.findIndex((r) => r.status === "failed" || (r.status === "unknown" && r.message));
  if (failed >= 0) return failed;
  for (let i = l.rows.length - 1; i >= 0; i--) if ((l.rows[i].result?.columns.length ?? 0) > 0) return i;
  return -1;
}

/**
 * **결과 탭**(10-14 — DBeaver · DataGrip · Beekeeper 식). 여러 문장 실행의 결과 칸은 `[요약] [결과 1 · 3행] [결과 2 · 1행] …` 탭 줄이고,
 * 결과 탭은 **행을 돌려준 문장**(열이 있는 결과 — SELECT · RETURNING …)마다 하나다. `no` = 1 기준 결과 번호(문장 번호와 다르다),
 * `row` = 목록(`PanelList.rows`)의 자리. 다시 붙은 요약(`detached` — 결과 행이 없다)은 탭을 만들지 않는다.
 */
export interface ResultTab {
  no: number;
  row: number;
  /** 돌려받은 행 수 */
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

/**
 * 탭 줄을 세우나 — **문장이 둘 이상**(줄로 못 세운 문장 포함)인 스크립트 실행이고 결과 탭이 하나라도 있을 때. 단문(한 줄짜리 목록)은
 * 탭 없이 예전 그대로(요약 한 줄 + 결과 표), 결과 탭이 없으면 [요약] 하나뿐인 탭 줄은 세우지 않는다.
 */
export function hasTabBar(l: PanelList | null, script: boolean, tabs: readonly ResultTab[]): boolean {
  return script && l !== null && l.rows.length + l.hidden >= 2 && tabs.length > 0;
}

/** 고른 탭 — `"summary"` 또는 결과 탭 번호(`ResultTab.no`) */
export type ResultTabId = "summary" | number;

/**
 * 처음 열 탭 — 실패 · 결과 불명 · 되돌림 · 실행 안 함이 하나라도 있으면(= 모두 성공이 아니면) [요약], 모두 성공이면 **마지막 결과 탭**,
 * 결과 탭이 없으면 [요약]. 마지막인 까닭: Beekeeper Studio 가 "행이 있는 마지막 결과"를 고르고(`TabQueryEditor.vue` 의
 * `findLastIndex`), 스크립트는 대개 준비 문장 뒤 마지막 SELECT 가 보려던 것이다 — 이 칸의 예전 규칙(`initialPick`)과도 같다.
 */
export function initialTab(l: PanelList, tabs: readonly ResultTab[]): ResultTabId {
  if (l.hidden > 0 || l.rows.some((r) => r.status !== "ok")) return "summary";
  return tabs.length > 0 ? tabs[tabs.length - 1].no : "summary";
}

/** 편집기 표시 하나 — 편집기 글 자리(`from` · `to`) · 상태 · 연한 줄 바탕을 칠하나(`tint`) · 실패 말풍선 */
export interface RunMark {
  from: number;
  to: number;
  status: StmtStatus;
  tint: boolean;
  message?: string;
}

/**
 * 목록 → 편집기 표시. `base` = 보낸 글의 편집기 시작 자리. 맞지 않은 목록(`aligned` 거짓)은 아무것도 표시하지 않는다.
 *
 * **단문의 성공은 거터 ✓ 만**(바탕 없음 — 가장 흔한 일에 편집기가 물들지 않게), 결과 불명은 거터 ? 만, 그 밖(여러 문장의 성공 ·
 * 되돌림 · 실패 · 실행 안 함)은 줄 바탕까지(실행 안 함은 바탕 대신 글자를 흐리게 — 편집기 몸통이 상태별로 그린다).
 */
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

/**
 * 줄마다의 표시 — 0 기준 줄 번호 → 상태 · 바탕. `lineOf` = 글자 자리 → 0 기준 줄(편집기 몸통이 준다). 여러 줄짜리 문장은 그 모든 줄에,
 * 한 줄에 여럿이면 [`STATUS_RANK`] 의 앞쪽. 바탕은 그 줄의 이긴 표시 하나라도 칠하면 칠한다(같은 상태끼리).
 */
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
