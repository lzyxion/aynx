/** 늘 인용한다 — "인용이 필요한가" 를 판정하는 규칙(엔진마다 다른 예약어 표)을 두지 않는다 */
import type { DbDialect } from "./query-backend";

export function quoteIdent(name: string, dialect: DbDialect): string {
  if (dialect === "mysql") return "`" + name.replaceAll("`", "``") + "`";
  return '"' + name.replaceAll('"', '""') + '"';
}

export function qualifiedName(dialect: DbDialect, schema: string | null, table: string): string {
  const t = quoteIdent(table, dialect);
  if (!schema || (dialect === "sqlite" && schema === "main")) return t;
  return `${quoteIdent(schema, dialect)}.${t}`;
}

export const PEEK_LIMIT = 100;

export function selectStarSql(dialect: DbDialect, schema: string | null, table: string): string {
  return `SELECT * FROM ${qualifiedName(dialect, schema, table)} LIMIT ${PEEK_LIMIT};`;
}
