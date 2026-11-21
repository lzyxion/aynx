/**
 * 쿼리 타일 "AI 에 묻기"가 AI 타일에 넘길 글을 짓는다(docs/log/2026-10-13-db-write-mcp-design.md).
 *
 * **결과 행의 값은 넣지 않는다** — 한 번의 클릭이라 사람이 고르지 않은 행이 모델 제공자로 가고, 구조만 단계 연결의 약속도 깨진다.
 * 행이 필요하면 AI 가 그 연결의 권한 안에서 `db_query` 로 읽는다(감사에 남는다).
 */

import type { Tr } from "$lib/session";
import { sanitizeForPaste } from "$lib/ask-ai";
import type { DbAiLevel } from "$lib/db-ai";

/** UTF-8 바이트 */
export const ASK_SQL_MAX = 8 * 1024;

export interface DbAskInput {
  connId: string;
  connName: string;
  engine: string;
  database: string | null;
  level: DbAiLevel;
  /** 선택 영역이 있으면 그 부분 */
  sql: string;
  selection: boolean;
  error: string | null;
}

const encoder = new TextEncoder();

/** 코드 포인트를 자르지 않는다 — `[글, 잘렸나]` */
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

const LEVEL_KEY: Record<DbAiLevel, string> = {
  off: "pane.query.ask.level.off",
  schema: "pane.query.ask.level.schema",
  read: "pane.query.ask.level.read",
  approve: "pane.query.ask.level.approve",
  all: "pane.query.ask.level.all",
};

/** 끝은 줄바꿈 하나 — Enter 는 넣지 않는다(사람이 한마디 보탠 뒤 보낸다) */
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

export function dbAskSummary(connName: string, sql: string, max = 32): string {
  const first = sql.trim().split("\n")[0] ?? "";
  const cut = [...first].length > max ? [...first].slice(0, max - 1).join("") + "…" : first;
  return cut ? `${connName} · ${cut}` : connName;
}
