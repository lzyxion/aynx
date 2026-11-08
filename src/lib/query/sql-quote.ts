/**
 * **식별자 인용** — 스키마 트리에서 표를 눌러 편집기에 채우는 `SELECT` 를 짓는다(쿼리 타일 6단계). **순수 함수**.
 *
 * | 방언 | 인용 | 안의 같은 글자 |
 * | --- | --- | --- |
 * | PostgreSQL · SQLite | `"이름"` | `""` 로 겹친다 |
 * | MySQL · MariaDB | `` `이름` `` | ` `` ` 로 겹친다 |
 *
 * 늘 인용한다 — 대소문자 · 예약어 · 공백 · 한글 이름이 그대로 맞고, "인용이 필요한가" 를 판정하는 규칙(엔진마다 다른
 * 예약어 표)을 두지 않아도 된다.
 */
import type { DbDialect } from "./query-backend";

export function quoteIdent(name: string, dialect: DbDialect): string {
  if (dialect === "mysql") return "`" + name.replaceAll("`", "``") + "`";
  return '"' + name.replaceAll('"', '""') + '"';
}

/**
 * 표 하나의 이름 — 스키마가 있으면 `스키마.표`. SQLite 의 `main`(기본 DB)은 생략한다(붙인 DB 만 앞에 선다).
 */
export function qualifiedName(dialect: DbDialect, schema: string | null, table: string): string {
  const t = quoteIdent(table, dialect);
  if (!schema || (dialect === "sqlite" && schema === "main")) return t;
  return `${quoteIdent(schema, dialect)}.${t}`;
}

/** 표를 눌렀을 때 채울 문장 — `SELECT * FROM <이름> LIMIT 100;` */
export const PEEK_LIMIT = 100;

export function selectStarSql(dialect: DbDialect, schema: string | null, table: string): string {
  return `SELECT * FROM ${qualifiedName(dialect, schema, table)} LIMIT ${PEEK_LIMIT};`;
}
