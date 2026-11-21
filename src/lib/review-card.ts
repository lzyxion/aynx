/**
 * 화면 아래 가운데 검토 대기 카드의 내용 — 숫자와 열쇠만 돌려주고 글자는 화면이 `t()` 로 만든다.
 * `veiled`(가림막)는 개수만 말한다 — 지나가는 사람에게 AI 가 하려던 것을 보이지 않게 명령문 · 제목 · 대상 · 단추 칸 자체가 없다.
 */

import { CMD_PREVIEW_MAX_CHARS, commandPreview } from "$lib/command-preview";
import {
  classifyRisk,
  expiryLabel,
  type CommandLine,
  type ComputedEffect,
  type DbPlan,
  type DeclaredEffect,
  type Operation,
} from "$lib/operations";

export type ReviewCardModel =
  | { kind: "hidden" }
  | { kind: "veiled"; count: number }
  | {
      kind: "card";
      /** 보여 주는 대기 — 단추 둘이 가리키는 그 하나 */
      op: Operation;
      index: number;
      total: number;
      /** 고른 것과 따로 싣는다 — 접힘 다시 펴기 · 위험 확인 해제의 조건은 "머리가 바뀌었다" 다 */
      headId: string;
      /** 자문일 뿐 권위는 백엔드 게이트다 */
      risk: "safe" | "dangerous";
      /** `null` = 만료 없음, `0` = 이미 지났다 */
      expiryMinutes: number | null;
      /** `veiled` 갈래에는 없다 — 사유 문장에 대상 호스트 이름이 박힌다 */
      autoRefused: string | null;
      /** 있으면 DB 쓰기 작업안 — 카드가 명령 상자 · 대상 칩 대신 그린다 */
      db: DbCardFacts | null;
      chips: AnalysisChip[];
      /** Rust `mismatch` — 참이면 `risk` 도 `dangerous` 다 */
      mismatch: boolean;
      verdict: Verdict;
    };

/** 글자는 화면이 `t()` 로 만든다(이 모듈은 사전을 모른다) */
export type AnalysisChip =
  | { kind: "effect"; effect: ComputedEffect; declared: DeclaredEffect | null; tone: "ok" | "warn" | "plain" }
  | { kind: "mismatch"; effect: ComputedEffect; cause: string | null; declared: DeclaredEffect; tone: "err" }
  | { kind: "sudo"; tone: "warn" }
  | {
      kind: "stmt";
      keyword: string;
      keywordTone: TokenTone;
      table: string | null;
      where: boolean | null;
      tone: "plain" | "err";
    }
  | { kind: "limit"; n: number; tone: "plain" }
  /** 서버가 쥔 그 글 — 여기서 다시 판정하지 않는다 */
  | { kind: "refused"; reason: string; tone: "plain" };

export type TokenTone = "err" | "warn" | "plain";

export function effectTone(e: ComputedEffect): TokenTone {
  return e === "delete" ? "err" : e === "read" ? "plain" : "warn";
}

const STMT_CHIPS_MAX = 3;

/** 판정은 하지 않는다 — 어긋남은 Rust 의 `mismatch` 그대로다(같은 판정을 두 벌 두지 않는다) */
export function analysisChips(op: Operation, autoRefused: string | null): AnalysisChip[] {
  const chips: AnalysisChip[] = [];
  const a = op.analysis;
  const declared = op.effect ?? null;
  if (a) {
    if (op.mismatch && declared) {
      chips.push({ kind: "mismatch", effect: a.effect, cause: a.cause ?? null, declared, tone: "err" });
    } else {
      const tone = a.effect === "read" ? "ok" : a.effect === "unknown" ? "warn" : "plain";
      chips.push({ kind: "effect", effect: a.effect, declared, tone });
    }
    if (op.db) {
      for (const s of (a.statements ?? []).slice(0, STMT_CHIPS_MAX)) {
        const where = typeof s.whereClause === "boolean" ? s.whereClause : null;
        chips.push({
          kind: "stmt",
          keyword: s.keyword,
          keywordTone: effectTone(s.effect),
          table: s.table ?? null,
          where,
          tone: where === false ? "err" : "plain",
        });
      }
      chips.push({ kind: "limit", n: op.db.maxAffected, tone: "plain" });
    } else if (a.sudo) {
      chips.push({ kind: "sudo", tone: "warn" });
    }
  }
  if (autoRefused !== null) chips.push({ kind: "refused", reason: autoRefused, tone: "plain" });
  return chips;
}

/**
 * 검토 카드와 작업안 카드가 같은 판정을 쓴다 — 자문이고 권위는 백엔드 게이트다.
 * `classifyRisk` 는 자동 승인 게이트(`policy.rs` `DANGEROUS`)와 같은 목록이라 손대지 않는다 — 리다이렉트 · `sudo` 걷기는 이 자문 판정에만 닿는다.
 */
export function approvalRisk(op: Operation): "safe" | "dangerous" {
  if (op.mismatch === true || hasUnboundedWrite(op)) return "dangerous";
  if (op.db) return dbRisk(op.db);
  let cmd = stripHarmlessRedirects(op.command);
  if (op.analysis?.effect === "read") cmd = cmd.replace(/\bsudo\b/g, " ");
  return classifyRisk(cmd);
}

/** 파일을 쓰지 않는 리다이렉트 — `2>&1` · `>&2` · `>&-` · `>/dev/null` · `2>> /dev/null` · `&>/dev/null` */
const HARMLESS_REDIRECT = /(?:\d|&)?>>?\s*(?:&(?:\d+|-)|\/dev\/null)(?=$|[\s;|&)])/g;

export function stripHarmlessRedirects(command: string): string {
  return command.replace(HARMLESS_REDIRECT, " ");
}

/** 펼쳤을 때만 보인다 — 작은 카드에서 표지 없는 문단이면 앱이 쓴 글로 읽힌다 */
export function reasonShown(op: Pick<Operation, "reason">, expanded: boolean): string | null {
  const r = op.reason?.trim() ?? "";
  return expanded && r !== "" ? r : null;
}

export function hasFoldedDetail(op: Pick<Operation, "reason">): boolean {
  return (op.reason?.trim() ?? "") !== "";
}

export type VerdictTone = "ok" | "neutral" | "warn" | "err";

/** 글자는 화면이 `app.review.verdict.<key>` 로 만든다 */
export type VerdictKey =
  | "pending"
  | "attention"
  | "mismatchLines"
  | "mismatch"
  | "unbounded"
  | "danger"
  | "dangerMatched"
  | "effect"
  | "effectMatched"
  | "unknownMatched";

/** `args` 는 날것의 값이다 — 낱말로 바꾸는 것은 화면의 몫이다 */
export interface Verdict {
  tone: VerdictTone;
  key: VerdictKey;
  args: {
    declared?: DeclaredEffect;
    found?: ComputedEffect;
    cause?: string | null;
    /** 전체 줄 수 · 선언보다 센 줄 수(`mismatchLines`) */
    n?: number;
    m?: number;
  };
}

const EFFECT_RANK: Record<ComputedEffect, number> = { read: 0, write: 1, unknown: 2, delete: 3 };

/** 판정은 하지 않는다 — 어긋남 · 줄마다의 `over` 는 Rust 의 것을 세기만 한다 */
export function verdictOf(op: Operation, risk: "safe" | "dangerous"): Verdict {
  const a = op.analysis;
  if (!a) {
    return risk === "dangerous" ? { tone: "err", key: "attention", args: {} } : { tone: "neutral", key: "pending", args: {} };
  }
  const declared = op.effect ?? undefined;
  if (op.mismatch === true && declared) {
    const lines = a.lines ?? [];
    const over = lines.filter((l) => l.over === true);
    if (lines.length >= 2 && over.length > 0) {
      const top = over.reduce((x, y) => (EFFECT_RANK[y.effect] > EFFECT_RANK[x.effect] ? y : x));
      return {
        tone: "err",
        key: "mismatchLines",
        args: { declared, found: top.effect, cause: top.cause ?? null, n: lines.length, m: over.length },
      };
    }
    return { tone: "err", key: "mismatch", args: { declared, found: a.effect, cause: a.cause ?? null } };
  }
  if (hasUnboundedWrite(op)) return { tone: "err", key: "unbounded", args: {} };
  if (risk === "dangerous") return { tone: "err", key: declared ? "dangerMatched" : "danger", args: {} };
  if (a.effect === "unknown" && declared) return { tone: "warn", key: "unknownMatched", args: { declared } };
  const tone: VerdictTone = a.effect === "read" ? "ok" : a.effect === "write" ? "neutral" : "warn";
  return { tone, key: declared ? "effectMatched" : "effect", args: { found: a.effect } };
}

/**
 * `null` 이면 두 줄 접기 `CommandClamp` 그대로. 나눠 보기에는 숨는 것이 없으므로 승인 판정의 `hidden` 은 늘 거짓이다.
 * 줄 없는 옛 작업안의 한 행 폴백은 Rust 가 매긴 작업안 전체의 값을 옮길 뿐 새 판정이 없다.
 */
export function splitLines(op: Pick<Operation, "db" | "analysis" | "command" | "mismatch">): CommandLine[] | null {
  const a = op.analysis;
  const lines = a?.lines ?? [];
  if (lines.length >= 1) return lines;
  // DB 작업안인데 줄이 없다(옛 서버) — SQL 구문 강조 접기 상자 그대로.
  if (op.db || !a || a.effect === "read" || op.command.trim() === "") return null;
  return [{ text: op.command.trim(), effect: a.effect, cause: a.cause, over: op.mismatch === true }];
}

export function lineMark(line: Pick<CommandLine, "effect" | "quiet" | "over" | "danger">): "warn" | "err" | null {
  if (line.over === true || line.danger === true) return "err";
  if (line.quiet === true || line.effect === "read") return null;
  return line.effect === "delete" ? "err" : "warn";
}

export interface MarkSegment {
  text: string;
  effect: ComputedEffect | null;
  kind?: "sudo";
}

/** Rust `marks` 는 코드 포인트 [start, end) — `Array.from(text)` 로 세야 Rust `chars()` 와 자리가 맞는다 */
export function markSegments(text: string, marks: CommandLine["marks"]): MarkSegment[] {
  const cps = Array.from(text);
  const out: MarkSegment[] = [];
  let at = 0;
  for (const m of marks ?? []) {
    if (!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start < at || m.end <= m.start || m.end > cps.length) continue;
    if (m.start > at) out.push({ text: cps.slice(at, m.start).join(""), effect: null });
    const seg: MarkSegment = { text: cps.slice(m.start, m.end).join(""), effect: m.effect };
    if (m.kind === "sudo") seg.kind = "sudo";
    out.push(seg);
    at = m.end;
  }
  if (at < cps.length || out.length === 0) out.push({ text: cps.slice(at).join(""), effect: null });
  return out;
}

export function shownSep(sep: CommandLine["sep"]): string | null {
  return sep === "&&" || sep === "||" || sep === "&" ? sep : null;
}

export type ApproveStep = "reveal" | "arm" | "approve";

/**
 * 원칙 "승인은 명령 전문이 보이는 자리에서만"(`ReviewCard.svelte` 머리말) — 잘린 채면 첫 누름은 펼치기다.
 * 위험이면 확인 상태가 펼치기를 겸해 어느 경우든 두 번을 넘지 않는다.
 */
export function approveStep(s: { hidden: boolean; risky: boolean; armed: boolean }): ApproveStep {
  if (s.risky && !s.armed) return "arm";
  if (s.hidden) return "reveal";
  return "approve";
}

export function hasUnboundedWrite(op: Operation): boolean {
  return (op.analysis?.statements ?? []).some((s) => s.whereClause === false);
}

export interface DbCardFacts {
  connName: string;
  engine: string;
  /** 못 찾으면 `null` · `throughSsh` 인데 못 찾으면 `"?"` */
  via: string | null;
  database: string | null;
  sql: string;
  statementCount: number;
  maxAffected: number;
  /** 영향 행을 세지 않아 `maxAffected` 가 막지 못하는 문장 수 */
  uncounted: number;
}

/** 작업안에는 경유 별칭이 실리지 않는다(AI 에게도 가는 칸이라) — `viaOf` 로 지금 연결 목록에서 찾는다 */
export function dbCardFacts(db: DbPlan, viaOf: (connId: string) => string | undefined): DbCardFacts {
  const via = viaOf(db.connId)?.trim() || (db.throughSsh ? "?" : null);
  return {
    connName: db.connName,
    engine: db.engine,
    via,
    database: db.database?.trim() || null,
    sql: db.statements.map((s) => `${s.sql};`).join("\n"),
    statementCount: db.statements.length,
    maxAffected: db.maxAffected,
    uncounted: db.statements.filter((s) => s.uncounted).length,
  };
}

/** 영향 행을 세지 않는 문장은 `maxAffected` 가 막지 못해 위험이다. `classifyRisk` 는 SQL 에 뜻이 없어 쓰지 않는다 */
export function dbRisk(db: DbPlan): "safe" | "dangerous" {
  return db.statements.some((s) => s.uncounted) ? "dangerous" : "safe";
}

/**
 * OS 알림(`$lib/review-notify`)이 쓰는 한 줄 — 알림과 화면의 제목이 같은 글자여야 해서 판정을 여기 하나에 둔다.
 * 명령문 전문은 절대 나오지 않는다 — OS 알림 센터는 지나간 알림을 이력으로 쌓아 둔다(docs/log/2026-09-22-review-notify.md).
 */
export function headlineOf(op: Pick<Operation, "title" | "command">): string {
  const title = op.title?.trim() ?? "";
  if (title !== "") return title;
  return commandPreview(op.command, { maxLines: 1, maxChars: CMD_PREVIEW_MAX_CHARS }).text;
}

/**
 * 기본은 `pending[0]` — 백엔드가 오래된 것부터 담아 주므로 가장 먼저 만료될 하나다.
 * `selectedId` 를 자리 번호가 아니라 id 로 받는다 — 목록이 밖에서 당겨지면 승인 단추가 사람이 보던 것과 다른 작업안을 가리킨다.
 */
export function reviewCardModel(
  pending: readonly Operation[],
  veiled: boolean,
  now: number,
  refusals?: ReadonlyMap<string, string>,
  selectedId?: string | null,
  viaOf: (connId: string) => string | undefined = () => undefined,
): ReviewCardModel {
  if (pending.length === 0) return { kind: "hidden" };
  if (veiled) return { kind: "veiled", count: pending.length };

  const picked = selectedId == null ? -1 : pending.findIndex((o) => o.operationId === selectedId);
  const index = picked < 0 ? 0 : picked;
  const op = pending[index];
  const left = expiryLabel(op.expiresAt, now);

  return {
    kind: "card",
    op,
    index,
    total: pending.length,
    headId: pending[0].operationId,
    risk: approvalRisk(op),
    expiryMinutes: left === null ? null : left.minutes,
    autoRefused: refusals?.get(op.operationId) ?? null,
    db: op.db ? dbCardFacts(op.db, viaOf) : null,
    chips: analysisChips(op, refusals?.get(op.operationId) ?? null),
    mismatch: op.mismatch === true,
    verdict: verdictOf(op, approvalRisk(op)),
  };
}
