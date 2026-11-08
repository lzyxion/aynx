/**
 * **쿼리 타일 → AI 타일 "AI 에 묻기"**(쿼리 타일 3단계 3b — docs/log/2026-10-13-db-write-mcp-design.md B-3 · B4) — 넘길 글을 짓는 순수 규칙.
 *
 * 받는 길은 블록 → AI 타일(`app/ask-ai` — 괄호 붙여넣기 · Enter 없음 · 받을 타일 고르기 · 없으면 옆에 열기)과 **같은 몸통**이다. 이 파일은
 * 글만 짓는다:
 *
 * - 첫 줄은 짧은 부탁 한 문장, 그 아래 **연결 이름 · 엔진 · DB 이름 · `connId`**(MCP DB 도구에 그대로 넘기는 id) · 이 연결의 AI 권한 단계.
 * - 편집기의 SQL — 선택 영역이 있으면 그것, 없으면 편집기 글 전체(앞 [`ASK_SQL_MAX`] 바이트 — 넘치면 잘렸다고 적는다).
 * - 마지막 오류(있으면 — 쿼리 · 스크립트의 실패 문구 한 줄).
 *
 * **결과 행의 값은 넣지 않는다.** 근거: ① 이 길은 한 번의 클릭이라, 화면에 떠 있던 행(개인정보 · 고객 데이터일 수 있다)이 사람이 고르지 않은 채
 * 모델 제공자로 간다 ② AI 가 행이 필요하면 그 연결의 권한(읽기 전용 이상) 안에서 `db_query` 로 직접 읽고 그것은 감사(`db_read`)에 남는다 —
 * 붙여 넣은 행은 어디에도 남지 않는다 ③ 구조만 단계의 연결이면 행이 나가지 않는다는 약속을 이 단추가 깨면 안 된다. 사람이 행을 보이고 싶으면
 * 결과 칸에서 골라 복사해 직접 붙여 넣는다(그것은 사람이 고른 것이다).
 *
 * Svelte 를 들여오지 않는다 — vitest 대상.
 */

import type { Tr } from "$lib/session";
import { sanitizeForPaste } from "$lib/ask-ai";
import type { DbAiLevel } from "$lib/db-ai";

/** 넘길 SQL 의 상한(UTF-8 바이트) — 블록 → AI 의 출력 상한(8 KB)과 같은 결 */
export const ASK_SQL_MAX = 8 * 1024;

export interface DbAskInput {
  connId: string;
  connName: string;
  /** 엔진 이름(사람 글자 — "PostgreSQL") */
  engine: string;
  database: string | null;
  /** 이 연결의 지금 AI 권한 단계 */
  level: DbAiLevel;
  /** 편집기 글(선택 영역이 있으면 그 부분) */
  sql: string;
  /** `sql` 이 선택 영역인가 */
  selection: boolean;
  /** 마지막 오류 한 줄(없으면 `null`) */
  error: string | null;
}

const encoder = new TextEncoder();

/** 앞에서 `max` 바이트 안쪽까지(코드 포인트를 자르지 않는다) — `[글, 잘렸나]` */
export function clipHead(s: string, max: number): [string, boolean] {
  if (encoder.encode(s).length <= max) return [s, false];
  let n = 0;
  let out = "";
  for (const ch of s) {
    const b = encoder.encode(ch).length;
    if (n + b > max) break;
    n += b;
    out += ch;
  }
  return [out, true];
}

/** 단계 → 말 키 */
const LEVEL_KEY: Record<DbAiLevel, string> = {
  off: "pane.query.ask.level.off",
  schema: "pane.query.ask.level.schema",
  read: "pane.query.ask.level.read",
  approve: "pane.query.ask.level.approve",
  all: "pane.query.ask.level.all",
};

/**
 * **붙여 넣을 글**(끝은 줄바꿈 하나 — 사람이 한마디 보탠 뒤 Enter):
 *
 * ```text
 * 이 DB 쿼리를 봐 줘. aynx DB 도구(connId)로 구조와 데이터를 확인할 수 있어.
 * 연결 운영 DB · PostgreSQL · DB app · connId Ab3dEf9hJk2L · AI 권한 읽기 전용
 * SQL(선택 영역):
 * ```sql
 * SELECT …
 * ```
 * 마지막 오류: relation "x" does not exist
 * ```
 */
export function buildDbAskText(input: DbAskInput, tr: Tr): string {
  const out: string[] = [];
  out.push(tr(input.error ? "pane.query.ask.lead.error" : "pane.query.ask.lead"));
  const db = input.database?.trim() ? tr("pane.query.ask.database", { name: input.database.trim() }) : "";
  out.push(
    tr("pane.query.ask.conn", {
      name: input.connName,
      engine: input.engine,
      database: db,
      id: input.connId,
      level: tr(LEVEL_KEY[input.level] as "pane.query.ask.level.off"),
    }),
  );
  const sql = input.sql.replace(/\s+$/, "");
  if (sql.trim() === "") {
    out.push(tr("pane.query.ask.sql.none"));
  } else {
    const [text, cut] = clipHead(sql, ASK_SQL_MAX);
    out.push(tr(input.selection ? "pane.query.ask.sql.selection" : "pane.query.ask.sql.editor"));
    out.push("```sql", text, "```");
    if (cut) out.push(tr("pane.query.ask.sql.cut", { kb: ASK_SQL_MAX / 1024 }));
  }
  const err = input.error?.trim();
  if (err) out.push(tr("pane.query.ask.error", { message: clipHead(err.replace(/\s+/g, " "), 1024)[0] }));
  return sanitizeForPaste(out.join("\n")) + "\n";
}

/** 고르기 상자 머리의 짧은 요약 — `운영 DB · SELECT …`(첫 줄 · 길면 말줄임) */
export function dbAskSummary(connName: string, sql: string, max = 32): string {
  const first = sql.trim().split("\n")[0] ?? "";
  const cut = [...first].length > max ? [...first].slice(0, max - 1).join("") + "…" : first;
  return cut ? `${connName} · ${cut}` : connName;
}
