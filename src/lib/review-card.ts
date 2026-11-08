/**
 * **화면 아래 가운데 검토 대기 카드가 무엇을 말할지** — 순수 계산 하나
 * (docs/log/2026-09-27-review-popup-card.md · 앞선 판 docs/log/2026-09-22-review-card.md).
 *
 * 대기 목록(`app/pending-plans` 가 쥔 `list_operations` 의 `pending`)과 가림막 여부, 그리고
 * "지금" 을 받아 **카드 한 장의 내용**을 돌려준다. 문구는 만들지 않는다 — 돌려주는 것은
 * 숫자와 열쇠뿐이고 글자는 화면이 `t()` 로 만든다 (`status-items.ts`·`expiryLabel` 과 같은
 * 나눔: 이 모듈은 사전을 몰라도 테스트를 받는다).
 *
 * 갈래가 셋인 이유:
 *
 * - `hidden` — 대기가 없다. 카드 자체가 DOM 에 없어야 한다.
 * - `veiled` — 가림막이 걸렸다. **개수만** 말한다. 이 갈래만 가림막(z-index 115) **위**에
 *   선다(`ReviewCard.svelte` 의 층 주석) — 잠긴 화면에서도 "기다리는 것이 있다" 는 보여야
 *   하지만, 자리를 비운 사이 지나가는 사람에게 AI 가 무엇을 하려 했는지 보여 줄 이유는 없다.
 *   명령문·제목·대상·단추는 이 갈래에 **칸 자체가 없다**.
 * - `card` — 평소. 대기 하나를 **전문으로** 보여 주고(기본은 가장 오래된 = 가장 먼저 만료될
 *   것) 그 자리에서 승인·거절을 받는다. 나머지는 ‹ › 로 넘겨 본다.
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

/** 카드가 그릴 것 — 세 갈래 중 하나 (머리말 참고) */
export type ReviewCardModel =
  | { kind: "hidden" }
  | { kind: "veiled"; count: number }
  | {
      kind: "card";
      /**
       * 지금 **보여 주는** 대기 — 단추 둘(거절·승인)이 가리키는 그 하나. 기본은 `pending[0]`
       * 이고 사람이 ‹ › 로 고르면 그것이다(`selectedId` — 아래 [`reviewCardModel`]).
       */
      op: Operation;
      /** `op` 의 자리(0부터) — 머리줄의 `1 / N` 은 `index + 1` 이다 */
      index: number;
      /** 대기 전체 수 (`pending.length`) */
      total: number;
      /**
       * 맨 앞(가장 오래된) 대기의 id — 고른 것과 **따로** 싣는다. 접힘이 다시 펴지는 조건과
       * 위험 확인의 해제 조건이 "머리가 바뀌었다" 이지 "보고 있는 것이 바뀌었다" 가 아니다.
       */
      headId: string;
      /**
       * 위험 신호 — 관제판과 **같은 판정**(`classifyRisk`)이다. `dangerous` 면 [승인]이 두 번
       * 눌려야 나간다(첫 번은 확인 상태로 바뀔 뿐). 자문일 뿐 권위는 백엔드 게이트다.
       */
      risk: "safe" | "dangerous";
      /** 만료까지 남은 분. `null` = 만료 없음, `0` = 이미 지났다(곧 만료) */
      expiryMinutes: number | null;
      /**
       * **자동 승인이 이 작업안을 거부한 사유** — 없으면 `null`.
       *
       * 자동 승인이 켜져 있고 명령이 허용 목록을 지났는데도 백엔드 게이트가 거부하는 판이
       * 있다(대표적으로 **대상 호스트에 '무인 실행' 이 위임되지 않은** 경우). 그 한 줄은
       * 2026-09-22 까지 6초짜리 토스트였는데, 정작 그 작업안은 그 뒤로도 검토 대기에
       * 남으므로 **사람이 왜 직접 승인해야 하는지**가 화면에서 사라져 있었다. 그래서 카드가
       * 대기하는 내내 곁에 둔다 (docs/log/2026-09-22-review-card.md).
       *
       * `veiled` 갈래에는 **없다** — 사유 문장에는 대상 호스트 이름이 그대로 박히므로,
       * 가림막 아래에서 개수만 말하는 규칙(위 머리말)을 이 한 줄이 뚫으면 안 된다.
       */
      autoRefused: string | null;
      /**
       * **DB 쓰기 작업안**(쿼리 타일 3b)이면 카드가 명령 상자 · 대상 칩 대신 그리는 것 — 없으면 셸 작업안이다
       * ([`dbCardFacts`]).
       */
      db: DbCardFacts | null;
      /**
       * **앱 분석 칩 줄**(승인 요약 — [`analysisChips`]) — 첫 칸 `앱 분석` 표지는 화면이 그린다. 분석이 없는 옛 작업안이면 빈 배열
       * (자동 승인 거부 사유만 있으면 그것 하나).
       */
      chips: AnalysisChip[];
      /** 선언이 분석보다 약한가(Rust `mismatch`) — 참이면 `risk` 도 `dangerous` 다 */
      mismatch: boolean;
      /** 카드 맨 위 **판결 띠**의 한 문장([`verdictOf`]) */
      verdict: Verdict;
    };

/**
 * 앱 분석 칩 하나(10-24 부터 카드에 서는 것은 DB 문장 · 상한뿐 — 효과 · 어긋남은 판결 띠([`verdictOf`]),
 * sudo · 자동 승인 거부는 메타 줄이 말한다 · 프로그램 사슬 칩은 명령을 되풀이할 뿐이라 걷었다) — 글자는 화면이 `t()` 로 만든다(이 모듈은 사전을 모른다). `tone` 은 색: `ok`(초록 — 읽기만 · 선언과 일치) ·
 * `err`(실패색 — 선언과 다름 · WHERE 없음) · `warn`(확인 필요 · sudo) · `plain`(그 밖).
 */
export type AnalysisChip =
  /** 효과 — 선언이 있으면 "· 선언과 일치" 를 붙인다 */
  | { kind: "effect"; effect: ComputedEffect; declared: DeclaredEffect | null; tone: "ok" | "warn" | "plain" }
  /** 선언과 다름 — 원문에 무엇이 있는가 */
  | { kind: "mismatch"; effect: ComputedEffect; cause: string | null; declared: DeclaredEffect; tone: "err" }
  | { kind: "sudo"; tone: "warn" }
  /** DB 문장 하나 — `DELETE users · WHERE 있음` · `WHERE 없음 — 테이블 전체` */
  | {
      kind: "stmt";
      keyword: string;
      /** 문장 첫 낱말의 색 — 그 문장의 효과(삭제 = `err` · 쓰기 = `warn`) */
      keywordTone: TokenTone;
      table: string | null;
      where: boolean | null;
      tone: "plain" | "err";
    }
  /** DB 영향 행 상한 */
  | { kind: "limit"; n: number; tone: "plain" }
  /** 자동 승인이 거부된 사유(서버가 쥔 그 글 — 여기서 다시 판정하지 않는다) */
  | { kind: "refused"; reason: string; tone: "plain" };

/** 칩 안 낱말의 색 */
export type TokenTone = "err" | "warn" | "plain";

/** 효과 → 낱말 색 — 삭제는 실패색, 쓰기 · 확인 필요는 경고색 */
export function effectTone(e: ComputedEffect): TokenTone {
  return e === "delete" ? "err" : e === "read" ? "plain" : "warn";
}

/** DB 문장 칩은 이만큼까지 */
const STMT_CHIPS_MAX = 3;

/**
 * **앱 분석 칩 줄** — 작업안의 `analysis` · `effect` · `mismatch`(Rust 가 매김)와 자동 승인 거부 사유 → 칩들. **순수**(시험 대상).
 * 판정은 하지 않는다 — 어긋남은 Rust 의 `mismatch` 그대로다(같은 판정을 두 벌 두지 않는다).
 */
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
 * **승인 문의 위험 신호** — 검토 카드와 작업안 카드가 같은 판정을 쓴다. 선언과 다름(Rust `mismatch`) · WHERE 없는 쓰기 →
 * `dangerous`, 그 밖은 DB 면 [`dbRisk`] · 셸이면 `classifyRisk`. `dangerous` 면 [승인]이 두 번 눌려야 나간다(자문 — 권위는 백엔드 게이트).
 *
 * 셸 명령은 파일을 쓰지 않는 리다이렉트(fd 복제 `2>&1` · `>&-` · `/dev/null` 로 버리기)를 걷고 `classifyRisk` 에 넘긴다(10-24 — 그 `>` 가
 * 리다이렉트 패턴에 걸려 읽기만 하는 진단 명령이 늘 위험으로 떴다). `classifyRisk` 자체는 자동 승인 게이트(`policy.rs` `DANGEROUS`)와
 * 같은 목록이라 손대지 않는다 — 이 걷기는 카드의 자문 판정에만 닿는다.
 *
 * 앱 분석이 명령 전체를 **읽기**로 확정했으면(`analysis.effect === "read"` — 한 줄이라도 쓰기 · 삭제 · 판단 못 함이면 아니다) `sudo`
 * 낱말도 걷는다(10-24 사용자 결정 — `sudo journalctl` 같은 읽기마다 붉은 띠면 경고가 닳는다). `sudo` 표시(낱말 강조 · 메타 칩)는 그대로다.
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

/** [`approvalRisk`] 의 셸 판정 앞 걷기 — 순수(시험 대상) */
export function stripHarmlessRedirects(command: string): string {
  return command.replace(HARMLESS_REDIRECT, " ");
}

/**
 * **AI 가 적은 이유를 보일 것인가**(10-22 사용자 결정) — 작은 카드에서는 보이지 않는다(설명 `summary` 와 겹치고, 표지 없는 문단이면
 * 앱이 쓴 글로 읽힌다). 사람이 카드를 **펼쳤을 때만**("전체 보기") `AI` 표지와 함께 보인다. 기록 상세는 늘 보인다(`console/RunHistory`).
 * 보일 글을 돌려준다(없으면 `null`). **순수**(시험 대상).
 */
export function reasonShown(op: Pick<Operation, "reason">, expanded: boolean): string | null {
  const r = op.reason?.trim() ?? "";
  return expanded && r !== "" ? r : null;
}

/** 펼쳐야 보이는 것이 있는가 — 명령이 잘리지 않아도 이유가 있으면 [전체 보기] 를 세운다 */
export function hasFoldedDetail(op: Pick<Operation, "reason">): boolean {
  return (op.reason?.trim() ?? "") !== "";
}

/** 판결 띠의 색 — 초록(읽기만 · 일치) · 중성 · 경고색 · 실패색 */
export type VerdictTone = "ok" | "neutral" | "warn" | "err";

/**
 * 판결 띠 문장의 열쇠 — 글자는 화면이 `app.review.verdict.<key>` 로 만든다(이 모듈은 사전을 모른다).
 *
 * - `pending` 검토 대기(분석 없는 옛 작업안) · `attention` 주의가 필요한 명령(분석 없음 + 위험)
 * - `mismatchLines` AI 는 '{declared}' 라고 했지만 {n}줄 중 {m}줄은 {found} · `mismatch` … 원문에 {found}
 * - `unbounded` WHERE 없음 — 테이블 전체
 * - `danger` / `dangerMatched` 되돌리기 어려울 수 있는 명령(· AI 설명과 일치)
 * - `effect` / `effectMatched` 그 효과의 명령(· AI 설명과 일치) · `unknownMatched` 앱이 판단 못 함 · AI 는 '{declared}'
 */
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

/**
 * 판결 띠 한 문장. `args` 는 **날것의 값**이다(효과 이름 · 근거 · 줄 수) — 효과 이름을 낱말로 바꾸는 것도 화면의 몫이다
 * (`found` + `cause` → "삭제(find -delete)").
 */
export interface Verdict {
  tone: VerdictTone;
  key: VerdictKey;
  args: {
    declared?: DeclaredEffect;
    /** 앱이 원문에서 찾은 효과(어긋남) · 일치할 때는 그 효과 */
    found?: ComputedEffect;
    cause?: string | null;
    /** 전체 줄 수 · 선언보다 센 줄 수(`mismatchLines`) */
    n?: number;
    m?: number;
  };
}

/** 효과의 세기 — 띠가 고르는 "가장 센 줄"(삭제 > 판단 못 함(적어도 쓰기) > 쓰기 > 읽기) */
const EFFECT_RANK: Record<ComputedEffect, number> = { read: 0, write: 1, unknown: 2, delete: 3 };

/**
 * **판결 띠**(10-24 "A + 명령 나눠 보기") — 카드 맨 위 한 줄이 **이 명령이 무엇인지 · AI 설명과 맞는지**를 한 문장으로 말한다.
 * 예전의 위험 배지 · 효과 칩 · 어긋남 칩이 따로 말하던 것을 한자리로 모았다. **순수**(시험 대상) — 판정은 하지 않는다: 어긋남은
 * Rust `mismatch`, 줄마다의 `over` 도 Rust 의 것 그대로 세기만 한다(같은 판정을 두 벌 두지 않는다).
 *
 * 차례(위가 이긴다): 분석 없음(옛 작업안) → 어긋남 → WHERE 없는 쓰기 → 위험(그 밖) → 일치. 선언이 없는 옛 작업안이면
 * "· AI 설명과 일치" 를 붙이지 않는다(견줄 것이 없다).
 */
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
 * **명령 나눠 보기**를 쓸 것인가 — Rust 가 줄을 **하나라도** 실어 보냈을 때 그 줄들(셸: 둘 이상이거나, 읽기가 아니거나 `sudo` 표시가 있는
 * 한 줄 — 줄 안 표시 `marks` 까지 · DB: 문장마다 한 줄 — 10-24 부터), 아니면 `null`(두 줄 접기 `CommandClamp` 그대로 — DB 면 SQL 강조). 나눠 보기에는 숨는 것이 없으므로 승인 판정의 `hidden` 은
 * 늘 거짓이다(`approveStep` — 원문 보기도 접지 않는다).
 *
 * `lines` 가 없는 옛 작업안이라도 앱 분석이 **읽기가 아니면** 같은 상자에 한 행으로 싣는다(10-24 실기 — 짧은 `rm` · `systemctl restart` 에
 * 아무 표시가 없었다 · 폴백). 그 행의 효과 · 근거 · `over` 는 Rust 가 매긴 작업안 전체의 `analysis.effect` · `cause` · `mismatch` 를
 * 그대로 옮긴다(새 판정 없음 · 줄 안 표시는 없다).
 */
export function splitLines(op: Pick<Operation, "db" | "analysis" | "command" | "mismatch">): CommandLine[] | null {
  const a = op.analysis;
  const lines = a?.lines ?? [];
  if (lines.length >= 1) return lines;
  // DB 작업안인데 줄이 없다(옛 서버) — SQL 구문 강조 접기 상자 그대로.
  if (op.db || !a || a.effect === "read" || op.command.trim() === "") return null;
  return [{ text: op.command.trim(), effect: a.effect, cause: a.cause, over: op.mismatch === true }];
}

/**
 * 줄 하나의 표시 — 읽기 줄은 표시 없음(`null` — `sudo` 낱말 표시만 있는 읽기 줄도 판 없이 낱말만 색), 아니면 판 색. AI 설명보다 센 줄 ·
 * 위험한 줄(`danger` — DB 의 WHERE 없는 쓰기 · DROP · TRUNCATE) · 삭제는 실패색, 쓰기 · 판단 못 함은 경고색
 */
export function lineMark(line: Pick<CommandLine, "effect" | "quiet" | "over" | "danger">): "warn" | "err" | null {
  if (line.over === true || line.danger === true) return "err";
  if (line.quiet === true || line.effect === "read") return null;
  return line.effect === "delete" ? "err" : "warn";
}

/** 줄 원문의 한 조각 — 표시 낱말이면 그 효과(와 갈래 — `sudo` 낱말), 아니면 `null` */
export interface MarkSegment {
  text: string;
  effect: ComputedEffect | null;
  kind?: "sudo";
}

/**
 * 줄 원문을 **표시 낱말**(Rust `marks` — 코드 포인트 [start, end))과 나머지로 자른다. 자리는 `Array.from(text)` 로 센다(한글 · 이모지도
 * Rust `chars()` 와 같은 자리). 판정은 하지 않는다 — 범위 밖 · 거꾸로 · 앞 것과 겹치는 표시는 버린다(방어 — 글자는 잃지 않는다).
 * 표시가 없으면 원문 한 조각.
 */
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

/** 줄 끝에 흐리게 보일 구분자 — `&&` · `||` · `&` 만(`;` · 줄바꿈은 줄이 나뉜 것으로 이미 보인다) */
export function shownSep(sep: CommandLine["sep"]): string | null {
  return sep === "&&" || sep === "||" || sep === "&" ? sep : null;
}

/** [승인] 한 번이 할 일 — 명령을 펼치기 · 확인 상태로 바꾸기 · 승인 */
export type ApproveStep = "reveal" | "arm" | "approve";

/**
 * **[승인] 한 번이 무엇을 하는가**(10-22) — 검토 카드와 작업안 카드(10-27 부터 둘 다 카드의 [실행 승인] 하나)가 같은 판정을 쓴다.
 * **순수**(시험 대상).
 *
 * 원칙 "승인은 명령 전문이 보이는 자리에서만"(`ReviewCard.svelte` 머리말): 명령 상자가 두 줄로 **잘린 채 펼치지 않았으면**(`hidden`)
 * 첫 누름은 승인이 아니라 **펼치기**다(전문을 보인 뒤 "전체 명령을 확인한 뒤 다시 누르세요"). 위험이면 확인 상태(`arm`)가
 * **펼치기를 겸한다**(10-24 — 펼치기 · 확인 · 승인 세 번은 너무 많다는 사용자 피드백): 첫 누름이 전문을 펼치며 확인 상태가 되고 둘째가
 * 승인이다. 그래서 어느 경우든 두 번을 넘지 않는다. 다 보이는 짧은 안전 명령은 한 번.
 */
export function approveStep(s: { hidden: boolean; risky: boolean; armed: boolean }): ApproveStep {
  if (s.risky && !s.armed) return "arm";
  if (s.hidden) return "reveal";
  return "approve";
}

/** DB 문장 중 바깥 `WHERE` 없는 `UPDATE` · `DELETE` 가 있는가 — 테이블 전체를 바꾼다(카드는 두 번 눌러 승인) */
export function hasUnboundedWrite(op: Operation): boolean {
  return (op.analysis?.statements ?? []).some((s) => s.whereClause === false);
}

/** DB 작업안 카드의 사실 — 연결 이름 · 엔진 · 경유 · DB 이름 · 문장 전문 · 상한 · 세지 않는 문장 수 */
export interface DbCardFacts {
  connName: string;
  /** 엔진 글자(`postgres` · `mysql` · `mariadb` · `sqlite` — 화면이 이름으로 바꾼다) */
  engine: string;
  /** 경유 호스트 별칭 — 화면의 연결 목록에서 찾은 것(없으면 `null` · `throughSsh` 인데 못 찾으면 `"?"`) */
  via: string | null;
  database: string | null;
  /** 문장 전문 — 한 줄에 하나, 끝에 `;` (구문 강조 상자에 그대로) */
  sql: string;
  statementCount: number;
  maxAffected: number;
  /** 영향 행을 세지 않아 `maxAffected` 가 막지 못하는 문장 수 */
  uncounted: number;
}

/**
 * DB 작업안 → 카드의 사실. **순수**(시험 대상). `viaOf` 는 연결 id → 지금 연결 목록의 경유 별칭(없으면 `undefined`) —
 * 작업안에는 별칭이 실리지 않는다(AI 에게도 가는 칸이라).
 */
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

/**
 * DB 작업안의 위험 신호 — **영향 행을 세지 않는 문장**(DDL · TRUNCATE · WITH …)이 있으면 위험(두 번 눌러야 승인) — `maxAffected` 가 그 문장을
 * 막지 못한다. 셸 명령의 판정(`classifyRisk`)은 SQL 에 뜻이 없어 쓰지 않는다.
 */
export function dbRisk(db: DbPlan): "safe" | "dangerous" {
  return db.statements.some((s) => s.uncounted) ? "dangerous" : "safe";
}

/**
 * 대기 작업안 하나의 **한 줄 요약** — `title` 이 있으면 그것, 없으면 명령문 **첫 줄** 발췌.
 *
 * **OS 알림**(`$lib/review-notify`)이 쓰는 한 줄이다 — 알림에 적힌 것과 돌아와서 화면에서 보는
 * 제목이 다른 글자면 "이게 그건가" 를 눈으로 맞출 수 없어 판정을 여기 하나에 둔다. (대시보드
 * 에이전트 칸의 승인 줄도 이것을 불렀다 — 그 줄은 2026-09-28 에 뺐다.) (화면 아래
 * 검토 카드는 2026-09-27 부터 한 줄이 아니라 **전문**을 그린다 — 제목은 `op.title` 그대로다.)
 *
 * `title` 을 먼저 쓰는 이유: AI 가 적어 준 한 줄이 명령문보다 사람 말에 가깝다. 글자 상한은
 * 관제판의 `.gcmd` 와 같은 [`CMD_PREVIEW_MAX_CHARS`] 하나다.
 *
 * **명령문 전문은 절대 나오지 않는다** — 알림 쪽에서 특히 중요하다(OS 알림 센터는 지나간
 * 알림을 이력으로 쌓아 둔다 · docs/log/2026-09-22-review-notify.md).
 */
export function headlineOf(op: Pick<Operation, "title" | "command">): string {
  const title = op.title?.trim() ?? "";
  if (title !== "") return title;
  return commandPreview(op.command, { maxLines: 1, maxChars: CMD_PREVIEW_MAX_CHARS }).text;
}

/**
 * 대기 목록 → 카드 한 장. **순수 함수** (테스트: `review-card.test.ts`).
 *
 * 기본으로 보여 주는 것은 `pending[0]` 이다 — 백엔드가 `list_operations` 의 `pending` 을
 * **오래된 것부터** 담아 주므로 그것이 곧 **가장 먼저 만료될** 하나다. 카드가 한 장뿐인
 * 자리에서 먼저 보여 줄 것은 시간이 가장 급한 쪽이어야 한다.
 *
 * `selectedId` 는 사람이 ‹ › 로 고른 작업안이다(화면의 지역 상태 — 저장하지 않는다). **id 로**
 * 받는 이유: 목록은 밖에서 바뀐다(앞의 것이 승인·만료되면 자리가 당겨진다). 자리 번호로 쥐면
 * 사람이 보던 것과 다른 작업안이 조용히 그 자리에 들어앉고, 승인 단추는 여전히 그 자리를
 * 가리킨다. id 가 목록에서 사라지면 **맨 앞으로 떨어진다** — 없는 것을 가리키는 카드는 없다.
 *
 * 명령 전문은 싣지 않는다 — `op.command` 그대로다(화면이 `<pre>` 로 그린다). 발췌가 필요한
 * 자리(OS 알림)는 [`headlineOf`] 를 따로 부른다.
 *
 * `refusals` 는 자동 승인이 거부당한 사유 표(`app/pending-plans` 의 `autoRefusals()`)다.
 * **선택 인자**인 이유는 이 함수가 순수해야 하기 때문이다 — 테스트도 하네스도 표 없이 부르고,
 * 그때는 `autoRefused` 가 `null` 이다.
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
    // 선언과 다름 · WHERE 없는 쓰기도 위험 신호다 — [승인]을 두 번 눌러야 나간다(승인 요약).
    risk: approvalRisk(op),
    expiryMinutes: left === null ? null : left.minutes,
    // 보여 주는 하나의 사유만 싣는다 — 카드가 그리는 작업안이 그 하나뿐이다.
    autoRefused: refusals?.get(op.operationId) ?? null,
    db: op.db ? dbCardFacts(op.db, viaOf) : null,
    chips: analysisChips(op, refusals?.get(op.operationId) ?? null),
    mismatch: op.mismatch === true,
    verdict: verdictOf(op, approvalRisk(op)),
  };
}
