/**
 * **쿼리 타일의 데이터 탭**(2026-11-10 — Beekeeper Studio 식: 스키마 트리의 테이블 · 뷰를 두 번 눌러 연다) — 조회 문장 조립 · 쪽 넘기기 ·
 * 정렬 순환 · DDL 대상. **순수 함수**(그림은 `DataTab.svelte` · 탭 줄 규칙은 `script-tabs` · 저장 모양은 `session/spec` 의 `canonDataTab`).
 *
 * - 조회는 늘 `SELECT * FROM <인용한 이름> [WHERE (<사람이 친 조건>)] [ORDER BY <인용한 열> ASC|DESC] LIMIT n [OFFSET m]` 하나다. 이름 ·
 *   정렬 열은 사투리별로 늘 인용한다(`sql-quote`). WHERE 글은 사람이 친 그대로라 **읽기 전용 보장은 서버가 진다** — `db_query` 의
 *   `readOnly`(가드 읽기 전용 허용 목록 + 엔진 READ ONLY · 열린 트랜잭션이면 거절). 여기서는 문장 모양만 짓는다.
 * - 쪽 = `LIMIT 쪽크기+1 OFFSET 쪽×쪽크기` — 한 줄 더 받아 "다음 있음" 만 안다(`COUNT(*)` 는 돌리지 않는다). 받은 줄 가운데 쪽 크기만 보인다.
 * - 정렬은 열 머리글을 누를 때마다 ▲ → ▼ → 없음(받아 둔 줄을 화면에서 정렬하지 않는다 — `ORDER BY` 로 다시 조회).
 * - [SQL 로 열기] 는 같은 조건 · 정렬 · 쪽의 문장(덧줄 없이 `LIMIT 쪽크기`)을 새 쿼리 탭에 넣는다.
 * - 칸 우클릭의 거르기([이 값으로 거르기] · [이 값 빼고 거르기] · [조건에 더하기])와 외래 키 따라가기(↗ — 참조 표의 데이터 탭을 `참조열 = 값`
 *   으로)가 짓는 조건도 여기다(`cellCondition` · `andCondition` · `fkCondition`). 짓는 글은 WHERE 칸에 그대로 들어간다 — 사람이 친 조건과
 *   같은 길(서버의 읽기 전용 판정)을 지난다.
 */
import type { Cell, DbDefinitionTarget, DbDialect, DbQueryResult } from "./query-backend";
import { qualifiedName, quoteIdent } from "./sql-quote";
import { DEFINITION_KINDS } from "./definition";
import { QUERY_DATA_PAGE_SIZES, type QueryDataPageSize, type QueryDataTab } from "$lib/session";

/** 이 탭의 쪽 크기(저장에 없으면 기본 100) */
export function pageSizeOf(d: Pick<QueryDataTab, "pageSize">): QueryDataPageSize {
  return d.pageSize ?? QUERY_DATA_PAGE_SIZES[0];
}

/** 쪽 크기를 저장 모양에 — 기본값이면 칸을 지운다 */
export function withPageSize(d: QueryDataTab, size: number): QueryDataTab {
  const { pageSize: _old, ...rest } = d;
  return size === 500 || size === 1000 ? { ...rest, pageSize: size } : rest;
}

/**
 * WHERE 칸의 글 다듬기 — 앞뒤 빈칸 · 끝의 `;` 를 걷고, 사람이 `WHERE` 를 앞에 쳤으면 그 낱말을 뗀다(앱이 붙인다). 비면 `""`.
 */
export function cleanWhere(text: string): string {
  let w = text.trim().replace(/[;\s]+$/, "");
  const m = /^where\b\s*/i.exec(w);
  if (m) w = w.slice(m[0].length);
  return w.trim();
}

/** 조건을 괄호로 — 줄 주석(`--` · MySQL `#`)이 뒤의 `)` · `ORDER BY` · `LIMIT` 를 먹지 않게 그때만 줄을 바꾼 뒤 닫는다 */
function wrapWhere(w: string): string {
  return /--|#/.test(w) ? `(${w}\n)` : `(${w})`;
}

export interface DataQuery {
  schema?: string | null;
  name: string;
  where?: string;
  sort?: QueryDataTab["sort"];
}

/**
 * 조회 문장 — `probe` 면 `LIMIT 쪽크기+1`(다음 쪽이 있나 보려고 한 줄 더 · 끝 `;` 없음 — 서버로 가는 문장), 아니면 `LIMIT 쪽크기;`
 * (사람이 읽을 [SQL 로 열기] 글). `page` 는 0 기준.
 */
export function dataSelectSql(dialect: DbDialect, d: DataQuery, page: number, pageSize: number, probe: boolean): string {
  const parts = [`SELECT * FROM ${qualifiedName(dialect, d.schema ?? null, d.name)}`];
  const where = cleanWhere(d.where ?? "");
  if (where !== "") parts.push(`WHERE ${wrapWhere(where)}`);
  if (d.sort) parts.push(`ORDER BY ${quoteIdent(d.sort.col, dialect)} ${d.sort.dir === "desc" ? "DESC" : "ASC"}`);
  const p = Math.max(0, Math.floor(page));
  parts.push(`LIMIT ${probe ? pageSize + 1 : pageSize}`);
  if (p > 0) parts.push(`OFFSET ${p * pageSize}`);
  return parts.join(" ") + (probe ? "" : ";");
}

/** 열 머리글을 눌렀다 — 다른 열이면 ▲, 같은 열이면 ▲ → ▼ → 없음 */
export function nextSort(cur: QueryDataTab["sort"] | undefined, col: string): QueryDataTab["sort"] | undefined {
  if (!cur || cur.col !== col) return { col, dir: "asc" };
  if (cur.dir === "asc") return { col, dir: "desc" };
  return undefined;
}

/** 정렬을 저장 모양에 — 없으면 칸을 지운다 */
export function withSort(d: QueryDataTab, sort: QueryDataTab["sort"] | undefined): QueryDataTab {
  const { sort: _old, ...rest } = d;
  return sort ? { ...rest, sort } : rest;
}

/** WHERE 를 저장 모양에 — 비면 칸을 지운다 */
export function withWhere(d: QueryDataTab, where: string): QueryDataTab {
  const { where: _old, ...rest } = d;
  const w = cleanWhere(where);
  return w !== "" ? { ...rest, where: w } : rest;
}

// ── 칸으로 거르기 · 외래 키 따라가기(2026-11-10) ─────────────────────────────────

/**
 * 칸 값 → SQL 리터럴. 숫자는 그대로 · 참/거짓은 PostgreSQL `true`/`false`, MySQL · SQLite `1`/`0` · 그 밖(글자 — 큰 정수 · 소수 · 날짜가
 * 글자로 온 것 포함)은 작은따옴표 + 안의 `'` 두 번(MySQL 은 기본 모드에서 `\` 가 이스케이프라 `\` 도 두 번). NULL · 바이트는 `null`
 * (리터럴로 만들지 않는다 — NULL 은 `IS NULL` 로, 바이트는 거르기 항목이 흐리다).
 */
export function sqlLiteral(dialect: DbDialect, c: Cell): string | null {
  if (c === null || typeof c === "object") return null;
  if (typeof c === "boolean") return dialect === "postgres" ? (c ? "true" : "false") : c ? "1" : "0";
  if (typeof c === "number") return String(c);
  const body = (dialect === "mysql" ? c.replaceAll("\\", "\\\\") : c).replaceAll("'", "''");
  return `'${body}'`;
}

/** 칸 하나로 짓는 조건 — `eq` = 같다(NULL 이면 `IS NULL`) · `ne` = 다르다(`IS NOT NULL`). 바이트면 `null` */
export function cellCondition(dialect: DbDialect, col: string, c: Cell, op: "eq" | "ne"): string | null {
  const q = quoteIdent(col, dialect);
  if (c === null) return `${q} ${op === "eq" ? "IS NULL" : "IS NOT NULL"}`;
  const lit = sqlLiteral(dialect, c);
  if (lit === null) return null;
  return `${q} ${op === "eq" ? "=" : "<>"} ${lit}`;
}

/** [조건에 더하기] — 지금 조건이 있으면 `(지금) AND 새 조건`(줄 주석이 있으면 `)` 앞에서 줄을 바꾼다), 없으면 새 조건만 */
export function andCondition(where: string, cond: string): string {
  const w = cleanWhere(where);
  return w === "" ? cond : `${wrapWhere(w)} AND ${cond}`;
}

/** 외래 키 하나 — 이 표의 열들 → 참조 표의 열들(같은 차례) */
export interface GridForeignKey {
  columns: readonly string[];
  refSchema: string | null;
  refTable: string;
  refColumns: readonly string[];
}

/**
 * 그 행의 외래 키 값들(`fk.columns` 차례) — 열 하나라도 결과에 없거나 NULL · 바이트면 `null`(↗ 단추가 서지 않는다)
 */
export function fkValues(fk: Pick<GridForeignKey, "columns">, columns: readonly { name: string }[], row: readonly Cell[]): Cell[] | null {
  const out: Cell[] = [];
  for (const name of fk.columns) {
    const i = columns.findIndex((c) => c.name === name);
    if (i < 0) return null;
    const v = row[i] ?? null;
    if (v === null || typeof v === "object") return null;
    out.push(v);
  }
  return out.length > 0 ? out : null;
}

/** 참조 표에서 그 행을 고르는 조건 — `참조열 = 값`(여러 열이면 `AND`). 값 · 열 수가 어긋나거나 리터럴로 못 만들면 `null` */
export function fkCondition(dialect: DbDialect, refColumns: readonly string[], values: readonly Cell[]): string | null {
  if (refColumns.length === 0 || refColumns.length !== values.length) return null;
  const parts: string[] = [];
  for (let i = 0; i < refColumns.length; i++) {
    const lit = sqlLiteral(dialect, values[i]);
    if (lit === null) return null;
    parts.push(`${quoteIdent(refColumns[i], dialect)} = ${lit}`);
  }
  return parts.join(" AND ");
}

/** 열 이름 → 그 열을 담은 첫 외래 키의 번호(머리글 ↗ · 칸 ↗ 단추) */
export function fkColumnIndex(fks: readonly Pick<GridForeignKey, "columns">[]): Map<string, number> {
  const m = new Map<string, number>();
  fks.forEach((fk, i) => {
    for (const c of fk.columns) if (!m.has(c)) m.set(c, i);
  });
  return m;
}

/** 받은 결과(쪽 크기 + 1 까지) → 보일 쪽 · 다음 쪽이 있나. 결과는 새 객체(받은 것을 고치지 않는다) */
export function pageOf(r: DbQueryResult, pageSize: number): { result: DbQueryResult; hasNext: boolean } {
  const hasNext = r.rows.length > pageSize || r.truncated;
  return { result: { ...r, rows: r.rows.slice(0, pageSize), truncated: false }, hasNext };
}

/** 이 쪽의 줄 범위(1 기준) — 줄이 없으면 `null` */
export function rowSpan(page: number, pageSize: number, shown: number): { from: number; to: number } | null {
  if (shown <= 0) return null;
  const from = page * pageSize + 1;
  return { from, to: from + shown - 1 };
}

/** DDL 하위 탭의 대상 — 파티션은 테이블로 읽는다. 그 방언이 그 종류의 DDL 을 주지 않으면 `null`(하위 탭을 숨긴다) */
export function dataDefTarget(dialect: DbDialect, d: Pick<QueryDataTab, "kind" | "schema" | "name">): DbDefinitionTarget | null {
  const kind = d.kind === "partition" ? "table" : d.kind;
  if (!DEFINITION_KINDS[dialect].includes(kind)) return null;
  return { schema: d.schema ?? null, kind, name: d.name };
}

/** 탭 줄의 이름 — 객체 이름(스키마는 말풍선) */
export function dataTabTitle(dialect: DbDialect, d: Pick<QueryDataTab, "schema" | "name">): string {
  const schema = d.schema && !(dialect === "sqlite" && d.schema === "main") ? `${d.schema}.` : "";
  return `${schema}${d.name}`;
}
