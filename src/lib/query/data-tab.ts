/**
 * 쿼리 타일 데이터 탭의 조회 문장 · 쪽 · 정렬 · 칸 거르기 조건.
 *
 * - WHERE 글(사람이 친 것 · 칸 거르기가 지은 것)은 그대로 실린다 — **읽기 전용 보장은 서버의 `db_query{readOnly}` 가 진다.** 여기서는 문장 모양만 짓는다.
 * - 쪽은 한 줄 더 받아 "다음 있음" 만 안다 — `COUNT(*)` 는 돌리지 않는다. 정렬은 받아 둔 줄을 화면에서 하지 않고 `ORDER BY` 로 다시 조회한다.
 */
import type { Cell, DbDefinitionTarget, DbDialect, DbQueryResult } from "./query-backend";
import { qualifiedName, quoteIdent } from "./sql-quote";
import { DEFINITION_KINDS } from "./definition";
import { QUERY_DATA_PAGE_SIZES, type QueryDataPageSize, type QueryDataTab } from "$lib/session";

export function pageSizeOf(d: Pick<QueryDataTab, "pageSize">): QueryDataPageSize {
  return d.pageSize ?? QUERY_DATA_PAGE_SIZES[0];
}

/** 기본값이면 칸을 지운다 */
export function withPageSize(d: QueryDataTab, size: number): QueryDataTab {
  const { pageSize: _old, ...rest } = d;
  return size === 500 || size === 1000 ? { ...rest, pageSize: size } : rest;
}

/** 앞에 친 `WHERE` 낱말은 뗀다 — 앱이 붙인다 */
export function cleanWhere(text: string): string {
  let w = text.trim().replace(/[;\s]+$/, "");
  const m = /^where\b\s*/i.exec(w);
  if (m) w = w.slice(m[0].length);
  return w.trim();
}

/** 줄 주석(`--` · MySQL `#`)이 뒤의 `)` · `ORDER BY` · `LIMIT` 를 먹지 않게 그때만 줄을 바꾼 뒤 닫는다 */
function wrapWhere(w: string): string {
  return /--|#/.test(w) ? `(${w}\n)` : `(${w})`;
}

export interface DataQuery {
  schema?: string | null;
  name: string;
  where?: string;
  sort?: QueryDataTab["sort"];
}

/** `probe` = 서버로 가는 문장(한 줄 더 · 끝 `;` 없음), 아니면 사람이 읽을 [SQL 로 열기] 글. `page` 는 0 기준 */
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

export function nextSort(cur: QueryDataTab["sort"] | undefined, col: string): QueryDataTab["sort"] | undefined {
  if (!cur || cur.col !== col) return { col, dir: "asc" };
  if (cur.dir === "asc") return { col, dir: "desc" };
  return undefined;
}

export function withSort(d: QueryDataTab, sort: QueryDataTab["sort"] | undefined): QueryDataTab {
  const { sort: _old, ...rest } = d;
  return sort ? { ...rest, sort } : rest;
}

export function withWhere(d: QueryDataTab, where: string): QueryDataTab {
  const { where: _old, ...rest } = d;
  const w = cleanWhere(where);
  return w !== "" ? { ...rest, where: w } : rest;
}

// ── 칸으로 거르기 · 외래 키 따라가기 ─────────────────────────────────

/** MySQL 은 기본 모드에서 `\` 가 이스케이프라 `\` 도 두 번 쓴다. NULL · 바이트는 리터럴로 만들지 않는다(`null`) */
export function sqlLiteral(dialect: DbDialect, c: Cell): string | null {
  if (c === null || typeof c === "object") return null;
  if (typeof c === "boolean") return dialect === "postgres" ? (c ? "true" : "false") : c ? "1" : "0";
  if (typeof c === "number") return String(c);
  const body = (dialect === "mysql" ? c.replaceAll("\\", "\\\\") : c).replaceAll("'", "''");
  return `'${body}'`;
}

export function cellCondition(dialect: DbDialect, col: string, c: Cell, op: "eq" | "ne"): string | null {
  const q = quoteIdent(col, dialect);
  if (c === null) return `${q} ${op === "eq" ? "IS NULL" : "IS NOT NULL"}`;
  const lit = sqlLiteral(dialect, c);
  if (lit === null) return null;
  return `${q} ${op === "eq" ? "=" : "<>"} ${lit}`;
}

export function andCondition(where: string, cond: string): string {
  const w = cleanWhere(where);
  return w === "" ? cond : `${wrapWhere(w)} AND ${cond}`;
}

/** `columns` · `refColumns` 는 같은 차례 */
export interface GridForeignKey {
  columns: readonly string[];
  refSchema: string | null;
  refTable: string;
  refColumns: readonly string[];
}

/** `null` 이면 ↗ 단추가 서지 않는다 */
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

/** 열 이름 → 그 열을 담은 첫 외래 키의 번호 */
export function fkColumnIndex(fks: readonly Pick<GridForeignKey, "columns">[]): Map<string, number> {
  const m = new Map<string, number>();
  fks.forEach((fk, i) => {
    for (const c of fk.columns) if (!m.has(c)) m.set(c, i);
  });
  return m;
}

/** 받은 것을 고치지 않는다 — 새 객체 */
export function pageOf(r: DbQueryResult, pageSize: number): { result: DbQueryResult; hasNext: boolean } {
  const hasNext = r.rows.length > pageSize || r.truncated;
  return { result: { ...r, rows: r.rows.slice(0, pageSize), truncated: false }, hasNext };
}

/** 1 기준 */
export function rowSpan(page: number, pageSize: number, shown: number): { from: number; to: number } | null {
  if (shown <= 0) return null;
  const from = page * pageSize + 1;
  return { from, to: from + shown - 1 };
}

/** `null` 이면 DDL 하위 탭을 숨긴다 */
export function dataDefTarget(dialect: DbDialect, d: Pick<QueryDataTab, "kind" | "schema" | "name">): DbDefinitionTarget | null {
  const kind = d.kind === "partition" ? "table" : d.kind;
  if (!DEFINITION_KINDS[dialect].includes(kind)) return null;
  return { schema: d.schema ?? null, kind, name: d.name };
}

export function dataTabTitle(dialect: DbDialect, d: Pick<QueryDataTab, "schema" | "name">): string {
  const schema = d.schema && !(dialect === "sqlite" && d.schema === "main") ? `${d.schema}.` : "";
  return `${schema}${d.name}`;
}
