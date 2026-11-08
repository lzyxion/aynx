/**
 * **스키마 트리의 규칙** — 펼침 상태 · 폴더 나누기 · 줄 펴기 · 키보드 · 넣을 이름 · 외래 키 따라가기. **순수 함수**(입출력 없음 —
 * 그림은 `SchemaTree.svelte`, 읽기는 `query-backend` 의 `dbSchema`·`dbObjects`·`dbTableDetail`).
 *
 * 모양(DBeaver 식):
 *
 * ```text
 * ▸ public                 스키마(첫 단계 — 이름만 읽는다)
 *   ▸ 테이블 12             종류별 폴더(스키마를 펼칠 때 그 스키마의 객체를 한 번에 읽는다 · 빈 폴더는 숨김)
 *     ▸ orders              테이블 · 뷰 · 구체화 뷰 · 외부 테이블은 펼치면 구조(`dbTableDetail` — 한 번에)
 *       ▸ 컬럼 8            구조 폴더(빈 폴더 숨김): 컬럼 · 인덱스 · 제약 조건 · 외래 키 · 참조됨 · 트리거 · 파티션
 *           id   integer
 *       ▸ 외래 키 1
 *           (customer_id) → customers(id)     누르면 대상 테이블로 트리 이동
 *   ▸ 함수 3
 *       f1(a integer)       함수 · 프로시저 · 시퀀스 · 형은 잎
 * ```
 *
 * - SQLite 에 붙인 DB 가 `main` 하나뿐이면 스키마 단계를 건너뛴다(폴더가 맨 위).
 * - 인덱스 · 트리거는 엔진과 상관없이 **테이블 아래**에만 선다(스키마 단 폴더 없음 — 엔진끼리 모양을 맞춘다).
 * - 모든 단계는 **기본 접힘**이다. 펼친 열쇠 목록은 타일(`QueryView`)이 쥔다 — 트리를 숨겼다 펴도 · 다시 연결해도 남는다.
 * - 열쇠는 스키마 · 폴더 · 객체 · 구조 폴더를 NUL 로 이은 글자다(이름에 무엇이 와도 겹치지 않는다).
 * - **이름 필터**(`TreeInput.filter` — 10-13): **이미 읽어 온 것**에서 대소문자 무시 부분 일치. 일치한 것의 조상(스키마 · 폴더 ·
 *   테이블 · 구조 폴더)은 펼친 목록과 상관없이 펼쳐 보이고(목록은 건드리지 않는다 — 필터를 지우면 원래 펼침), 일치 없는 가지는
 *   숨기고, 폴더 개수는 `일치/전체`. 이름이 일치한 객체 아래는 평소처럼 펼친 목록을 따른다. 아직 안 읽은 스키마는 거르지 못한다 —
 *   맨 위 안내 줄(`unread` — "읽지 않은 스키마 N개 · [모두 읽기]")이 센다(서버 검색 op 를 두지 않은 까닭은 `SchemaTree` 머리말).
 */
import type {
  DbConstraint,
  DbDialect,
  DbForeignKey,
  DbIndex,
  DbObject,
  DbObjectKind,
  DbObjects,
  DbPartition,
  DbTableColumn,
  DbTableDetail,
  DbTrigger,
} from "./query-backend";
import { qualifiedName, quoteIdent } from "./sql-quote";

/** 방언별 폴더 순서 — DBeaver 의 순서를 따른다. 목록에 없는 종류는 그 방언에서 오지 않는다 */
export const FOLDERS: Record<DbDialect, readonly DbObjectKind[]> = {
  postgres: ["table", "view", "matview", "foreign", "function", "procedure", "sequence", "type"],
  mysql: ["table", "view", "function", "procedure", "sequence"],
  sqlite: ["table", "view"],
};

/** 테이블 아래 구조 폴더 — 순서대로(빈 폴더는 숨김) */
export const PARTS = ["columns", "indexes", "constraints", "foreignKeys", "referencedBy", "triggers", "partitions"] as const;
export type DetailPart = (typeof PARTS)[number];

/** 구조 폴더의 잎 하나(컬럼은 따로 — `column` 줄) */
export type DetailLeaf =
  | { part: "indexes"; item: DbIndex }
  | { part: "constraints"; item: DbConstraint }
  | { part: "foreignKeys" | "referencedBy"; item: DbForeignKey }
  | { part: "triggers"; item: DbTrigger }
  | { part: "partitions"; item: DbPartition };

/** 행을 가진 관계 — 누르면 `SELECT * …` · 펼치면 구조 */
export function isRelation(kind: DbObjectKind): boolean {
  return kind === "table" || kind === "view" || kind === "matview" || kind === "foreign";
}

const SEP = "\u0000";
export const schemaKey = (schema: string) => `s${SEP}${schema}`;
export const folderKey = (schema: string, kind: DbObjectKind) => `f${SEP}${schema}${SEP}${kind}`;
/** 객체 열쇠 — 겹지정 함수(같은 이름 · 다른 인자)가 갈리게 인자까지 */
export const objectKey = (schema: string, o: DbObject) => `o${SEP}${schema}${SEP}${o.kind}${SEP}${o.name}${SEP}${o.args ?? ""}`;
/** 구조 폴더 열쇠 — 그 관계의 열쇠 아래 */
export const partKey = (objKey: string, part: DetailPart) => `p${SEP}${objKey}${SEP}${part}`;

/** 폴더 하나 — 비어 있지 않은 것만 만든다 */
export interface Folder {
  kind: DbObjectKind;
  items: DbObject[];
  /** 상한에서 잘렸다(개수 뒤에 `+`) */
  truncated: boolean;
  /** 이름 필터 중 — 일치한 수(개수는 `일치/전체`) */
  matched?: number;
}

/** 객체를 방언의 폴더 순서로 나눈다 — 빈 폴더는 숨긴다(엔진·판마다 없는 종류가 많아 빈 폴더가 대부분이다). 모르는 종류는 버린다 */
export function groupFolders(dialect: DbDialect, data: DbObjects): Folder[] {
  const out: Folder[] = [];
  for (const kind of FOLDERS[dialect]) {
    const items = data.objects.filter((o) => o.kind === kind);
    if (items.length > 0) out.push({ kind, items, truncated: data.truncated.includes(kind) });
  }
  return out;
}

/** 구조 폴더 하나(비어 있지 않은 것만) */
export interface PartFolder {
  part: DetailPart;
  count: number;
  truncated: boolean;
  /** 이름 필터 중 — 일치한 수 */
  matched?: number;
}

/** 구조를 폴더로 — 순서는 [`PARTS`], 빈 칸은 숨긴다(엔진에 없는 종류 · 뷰의 인덱스 …) */
export function detailParts(d: DbTableDetail): PartFolder[] {
  return PARTS.filter((p) => (d[p]?.length ?? 0) > 0).map((p) => ({ part: p, count: d[p].length, truncated: d.truncated.includes(p) }));
}

/** 폴더 머리의 개수 글자 — 잘렸으면 `5000+`, 이름 필터 중이면 `일치/전체` */
export function countLabel(f: { items?: unknown[]; count?: number; truncated: boolean; matched?: number }): string {
  const n = f.count ?? f.items?.length ?? 0;
  const total = f.truncated ? `${n}+` : String(n);
  return f.matched !== undefined ? `${f.matched}/${total}` : total;
}

// ── 이름 필터 ─────────────────────────────────────────────────────────────

/** 필터 글자를 비교 꼴로 — 앞뒤 공백을 떼고 소문자. 비면 `""`(거르지 않음) */
export function normFilter(filter: string | undefined): string {
  return (filter ?? "").trim().toLowerCase();
}

/** 이름이 필터에 맞나 — 대소문자 무시 부분 일치(`q` 는 [`normFilter`] 를 지난 것 · 빈 `q` 는 늘 거짓) */
export function nameMatches(name: string, q: string): boolean {
  return q !== "" && name.toLowerCase().includes(q);
}

/** 강조할 자리 `[시작, 끝)` — 없으면 `null`. 소문자로 바꿔 길이가 달라지는 글자가 있으면 강조하지 않는다(일치는 그대로) */
export function matchSpan(text: string, filter: string | undefined): [number, number] | null {
  const q = normFilter(filter);
  if (!q) return null;
  const low = text.toLowerCase();
  if (low.length !== text.length) return null;
  const i = low.indexOf(q);
  return i < 0 ? null : [i, i + q.length];
}

/** 구조 잎의 거를 이름 — 이름 없는 외래 키(SQLite)는 다른 쪽 테이블 이름 */
export function leafName(l: DetailLeaf | { part: "columns"; item: DbTableColumn }): string {
  switch (l.part) {
    case "foreignKeys":
    case "referencedBy":
      return l.item.name ?? fkTarget(l.part, l.item).table;
    case "constraints":
      return l.item.name ?? "";
    default:
      return l.item.name;
  }
}

/** 함수 꼴 이름 — `f1(a integer) → integer`(프로시저는 화살표 없음). 함수가 아니면 이름 그대로 */
export function signature(o: DbObject): string {
  if (o.args === undefined) return o.name;
  return `${o.name}(${o.args})${o.returns ? ` → ${o.returns}` : ""}`;
}

/**
 * 잎을 눌렀을 때 편집기 커서 자리에 넣을 글자 — 인용된 정규화 이름(`"스키마"."이름"`). SQLite 의 `main` 은 생략(`qualifiedName`).
 * 함수 · 프로시저는 여는 괄호까지(`"public"."f1"(`) — 인자는 사람이 친다.
 */
export function insertText(dialect: DbDialect, schema: string | null, o: DbObject): string {
  const base = qualifiedName(dialect, schema, o.name);
  return o.kind === "function" || o.kind === "procedure" ? `${base}(` : base;
}

/**
 * 구조 폴더의 잎을 눌렀을 때 넣을 글자 — 그 엔진에서 그 이름을 쓰는 자리의 꼴로. 컬럼 · 제약 = 이름만(테이블에 딸린다) · 인덱스 =
 * PG · SQLite 는 스키마에 딸려 정규화, MySQL 은 테이블에 딸려 이름만 · 트리거 = PG 는 테이블에 딸려 이름만, MySQL · SQLite 는
 * 정규화. 이름이 없으면(SQLite 의 제약) `null`. 외래 키 · 참조됨 · 파티션은 넣지 않는다(트리 이동 · SELECT 채우기).
 */
export function leafInsertText(dialect: DbDialect, schema: string, leaf: DetailLeaf | { part: "columns"; item: DbTableColumn }): string | null {
  switch (leaf.part) {
    case "columns":
      return quoteIdent(leaf.item.name, dialect);
    case "constraints":
      return leaf.item.name ? quoteIdent(leaf.item.name, dialect) : null;
    case "indexes":
      return dialect === "mysql" ? quoteIdent(leaf.item.name, dialect) : qualifiedName(dialect, schema, leaf.item.name);
    case "triggers":
      return dialect === "postgres" ? quoteIdent(leaf.item.name, dialect) : qualifiedName(dialect, schema, leaf.item.name);
    default:
      return null;
  }
}

/** 열 목록 글자 — `(a, b)`(식 열 `null` 은 `expr` 로) */
export function columnList(cols: readonly (string | null)[], expr = "…"): string {
  return `(${cols.map((c) => c ?? expr).join(", ")})`;
}

/** 다른 스키마면 `스키마.이름`, 같으면 이름만(표시용 — 인용하지 않는다) */
function shortName(here: string, schema: string, name: string): string {
  return schema === here ? name : `${schema}.${name}`;
}

/**
 * 외래 키의 화살표 글자(표시용) — 외래 키 칸은 `(customer_id) → customers(id)`(가리키는 쪽이 이 테이블), 참조됨 칸은
 * `orders(customer_id) → (id)`(가리켜지는 쪽이 이 테이블). 다른 스키마의 테이블은 `스키마.테이블`.
 */
export function fkArrow(part: "foreignKeys" | "referencedBy", fk: DbForeignKey, here: string): string {
  if (part === "foreignKeys") return `${columnList(fk.columns)} → ${shortName(here, fk.refSchema, fk.refTable)}${columnList(fk.refColumns)}`;
  return `${shortName(here, fk.schema, fk.table)}${columnList(fk.columns)} → ${columnList(fk.refColumns)}`;
}

/** 외래 키 · 참조됨 잎이 가리키는 **다른 쪽** 테이블 — 누르면 트리가 그리로 간다 */
export function fkTarget(part: "foreignKeys" | "referencedBy", fk: DbForeignKey): { schema: string; table: string } {
  return part === "foreignKeys" ? { schema: fk.refSchema, table: fk.refTable } : { schema: fk.schema, table: fk.table };
}

/** 스키마 단계를 건너뛰나 — SQLite 에 붙인 DB 가 하나(`main`)뿐일 때 */
export function skipSchemaLevel(dialect: DbDialect, schemas: readonly string[]): boolean {
  return dialect === "sqlite" && schemas.length === 1;
}

// ── 외래 키 따라가기 ──────────────────────────────────────────────────────

/** 스키마의 객체 목록에서 관계 하나를 찾는다 — 이름이 꼭 같은 것, 없으면 대소문자만 다른 것(SQLite · MySQL 은 이름이 대소문자를 가리지 않는 때가 있다) */
export function findRelation(data: DbObjects, table: string): DbObject | null {
  const rels = data.objects.filter((o) => isRelation(o.kind));
  return rels.find((o) => o.name === table) ?? rels.find((o) => o.name.toLowerCase() === table.toLowerCase()) ?? null;
}

/** 관계 하나를 보이게 할 때 펼칠 열쇠 — 스키마(건너뛰지 않으면) · 그 종류의 폴더 */
export function revealKeys(dialect: DbDialect, schemas: readonly string[], schema: string, o: DbObject): string[] {
  const keys = skipSchemaLevel(dialect, schemas) ? [] : [schemaKey(schema)];
  return [...keys, folderKey(schema, o.kind)];
}

/** 열쇠 여럿을 펼친 목록에 더한다 — 새 배열(이미 있으면 그대로) */
export function withExpanded(expanded: readonly string[], keys: readonly string[]): string[] {
  return [...expanded, ...keys.filter((k, i) => !expanded.includes(k) && keys.indexOf(k) === i)];
}

// ── 줄 펴기 ─────────────────────────────────────────────────────────────

/** 읽는 중 · 실패 · 받은 값 */
export type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; value: T };

export type TreeRow =
  | { type: "schema"; key: string; level: number; schema: string; expanded: boolean }
  | {
      type: "folder";
      key: string;
      level: number;
      schema: string;
      folder: Folder;
      expanded: boolean;
    }
  | {
      type: "object";
      key: string;
      level: number;
      schema: string;
      object: DbObject;
      /** 구조를 펼칠 수 있다(관계) */
      expandable: boolean;
      expanded: boolean;
    }
  /** 테이블 아래 구조 폴더 */
  | { type: "part"; key: string; level: number; schema: string; folder: PartFolder; expanded: boolean }
  | { type: "column"; key: string; level: number; schema: string; column: DbTableColumn }
  /** 구조 폴더의 잎(컬럼 밖) — `table` = 그 구조를 가진 관계(인덱스 · 트리거 · 제약의 DDL 보기) */
  | { type: "leaf"; key: string; level: number; schema: string; table: string; leaf: DetailLeaf }
  /** 읽는 중 · 실패 · 비어 있음 · 잘림 · (필터 중) 일치 없음 · 읽지 않은 스키마 `count` 개 — 고를 수 없는 줄 */
  | {
      type: "note";
      key: string;
      level: number;
      note: "loading" | "error" | "empty" | "truncated" | "nomatch" | "unread";
      message?: string;
      count?: number;
    };

export interface TreeInput {
  dialect: DbDialect;
  schemas: readonly string[];
  expanded: ReadonlySet<string>;
  objects: ReadonlyMap<string, Load<DbObjects>>;
  /** 관계 열쇠 → 구조 */
  details: ReadonlyMap<string, Load<DbTableDetail>>;
  /** 이름 필터(빈 글자 = 거르지 않음) — 머리말 */
  filter?: string;
}

/** 구조 폴더 하나의 잎 줄 */
function partRows(d: DbTableDetail, part: DetailPart, pk: string, level: number, schema: string, table: string): TreeRow[] {
  if (part === "columns") return d.columns.map((c, i) => ({ type: "column", key: `${pk}${SEP}${i}`, level, schema, column: c }));
  const items = d[part] as DetailLeaf["item"][];
  return items.map((item, i) => ({ type: "leaf", key: `${pk}${SEP}${i}`, level, schema, table, leaf: { part, item } as DetailLeaf }));
}

/** 관계 하나 아래 — 펼친 목록대로(구조 폴더 · 잎). 관계 줄은 부르는 쪽이 넣는다 */
function objectSubtree(t: TreeInput, schema: string, ok: string, o: DbObject, level: number): TreeRow[] {
  const rows: TreeRow[] = [];
  const det = t.details.get(ok);
  if (!det || det.state === "loading") return [{ type: "note", key: `${ok}${SEP}loading`, level, note: "loading" }];
  if (det.state === "error") return [{ type: "note", key: `${ok}${SEP}error`, level, note: "error", message: det.message }];
  for (const pf of detailParts(det.value)) {
    const pk = partKey(ok, pf.part);
    const popen = t.expanded.has(pk);
    rows.push({ type: "part", key: pk, level, schema, folder: pf, expanded: popen });
    if (!popen) continue;
    rows.push(...partRows(det.value, pf.part, pk, level + 1, schema, o.name));
    if (pf.truncated) rows.push({ type: "note", key: `${pk}${SEP}truncated`, level: level + 1, note: "truncated" });
  }
  return rows;
}

/** 이름 필터 중 — 일치하는 잎만 남긴 구조 폴더(펼친 채 · 개수 `일치/전체`). 일치가 없으면 빈 목록 */
function matchedSubtree(d: DbTableDetail, schema: string, ok: string, o: DbObject, level: number, q: string): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const pf of detailParts(d)) {
    const pk = partKey(ok, pf.part);
    const leaves = partRows(d, pf.part, pk, level + 1, schema, o.name).filter(
      (r) => (r.type === "column" && nameMatches(r.column.name, q)) || (r.type === "leaf" && nameMatches(leafName(r.leaf), q)),
    );
    if (leaves.length === 0) continue;
    rows.push({ type: "part", key: pk, level, schema, folder: { ...pf, matched: leaves.length }, expanded: true }, ...leaves);
  }
  return rows;
}

/** 이름 필터 중의 줄 — 머리말의 규칙. 펼친 목록은 읽기만 한다 */
function filteredRows(t: TreeInput, q: string): TreeRow[] {
  const rows: TreeRow[] = [];
  const skip = skipSchemaLevel(t.dialect, t.schemas);
  const base = skip ? 0 : 1;
  let unread = 0;
  for (const schema of t.schemas) {
    const load = t.objects.get(schema);
    if (load?.state !== "ok") {
      unread++;
      continue;
    }
    const inSchema: TreeRow[] = [];
    for (const folder of groupFolders(t.dialect, load.value)) {
      const inFolder: TreeRow[] = [];
      let matched = 0;
      for (const o of folder.items) {
        const ok = objectKey(schema, o);
        const expandable = isRelation(o.kind);
        if (nameMatches(o.name, q)) {
          const oopen = expandable && t.expanded.has(ok);
          inFolder.push({ type: "object", key: ok, level: base + 1, schema, object: o, expandable, expanded: oopen });
          if (oopen) inFolder.push(...objectSubtree(t, schema, ok, o, base + 2));
          matched++;
          continue;
        }
        const det = expandable ? t.details.get(ok) : undefined;
        if (det?.state !== "ok") continue;
        const sub = matchedSubtree(det.value, schema, ok, o, base + 2, q);
        if (sub.length === 0) continue;
        inFolder.push({ type: "object", key: ok, level: base + 1, schema, object: o, expandable, expanded: true }, ...sub);
        matched++;
      }
      if (matched === 0) continue;
      const fk = folderKey(schema, folder.kind);
      inSchema.push({ type: "folder", key: fk, level: base, schema, folder: { ...folder, matched }, expanded: true }, ...inFolder);
    }
    if (inSchema.length === 0) continue;
    if (!skip) rows.push({ type: "schema", key: schemaKey(schema), level: 0, schema, expanded: true });
    rows.push(...inSchema);
  }
  const head: TreeRow[] = unread > 0 ? [{ type: "note", key: `${SEP}unread`, level: 0, note: "unread", count: unread }] : [];
  if (rows.length === 0) return [...head, { type: "note", key: `${SEP}nomatch`, level: 0, note: "nomatch" }];
  return [...head, ...rows];
}

/** 지금 보이는 줄 — 위에서 아래로. 들여쓰기는 `level`, 키보드 이동은 이 순서를 그대로 쓴다 */
export function visibleRows(t: TreeInput): TreeRow[] {
  const q = normFilter(t.filter);
  if (q) return filteredRows(t, q);
  const rows: TreeRow[] = [];
  const skip = skipSchemaLevel(t.dialect, t.schemas);
  for (const schema of t.schemas) {
    const sk = schemaKey(schema);
    const open = skip || t.expanded.has(sk);
    const base = skip ? 0 : 1;
    if (!skip) rows.push({ type: "schema", key: sk, level: 0, schema, expanded: open });
    if (!open) continue;
    const load = t.objects.get(schema);
    if (!load || load.state === "loading") {
      rows.push({ type: "note", key: `${sk}${SEP}loading`, level: base, note: "loading" });
      continue;
    }
    if (load.state === "error") {
      rows.push({ type: "note", key: `${sk}${SEP}error`, level: base, note: "error", message: load.message });
      continue;
    }
    const folders = groupFolders(t.dialect, load.value);
    if (folders.length === 0) rows.push({ type: "note", key: `${sk}${SEP}empty`, level: base, note: "empty" });
    for (const folder of folders) {
      const fk = folderKey(schema, folder.kind);
      const fopen = t.expanded.has(fk);
      rows.push({ type: "folder", key: fk, level: base, schema, folder, expanded: fopen });
      if (!fopen) continue;
      for (const o of folder.items) {
        const ok = objectKey(schema, o);
        const expandable = isRelation(o.kind);
        const oopen = expandable && t.expanded.has(ok);
        rows.push({ type: "object", key: ok, level: base + 1, schema, object: o, expandable, expanded: oopen });
        if (oopen) rows.push(...objectSubtree(t, schema, ok, o, base + 2));
      }
      if (folder.truncated) rows.push({ type: "note", key: `${fk}${SEP}truncated`, level: base + 1, note: "truncated" });
    }
  }
  return rows;
}

/** 펼칠 수 있는 줄인가(스키마 · 폴더 · 관계 · 구조 폴더) */
export function isExpandable(r: TreeRow): boolean {
  return r.type === "schema" || r.type === "folder" || r.type === "part" || (r.type === "object" && r.expandable);
}

/** 키보드 초점이 설 수 있는 줄인가 — 안내 줄은 건너뛴다 */
export function isFocusable(r: TreeRow): boolean {
  return r.type !== "note";
}

export type KeyAction =
  | { kind: "focus"; key: string }
  | { kind: "expand"; key: string }
  | { kind: "collapse"; key: string }
  | { kind: "activate"; key: string };

/**
 * 트리 키 하나 → 할 일 — WAI-ARIA 트리 문법. ↑↓ = 이웃 줄 · → = 접혀 있으면 펼치기, 펼쳐 있으면 첫 자식으로 · ← = 펼쳐 있으면
 * 접기, 아니면 부모로 · Home/End · Enter = 고르기(스키마 · 폴더 · 구조 폴더는 펼치기/접기). 할 일이 없으면 `null`.
 */
export function keyAction(rows: readonly TreeRow[], focusKey: string | null, key: string): KeyAction | null {
  const nav = rows.filter(isFocusable);
  if (nav.length === 0) return null;
  const i = focusKey === null ? -1 : nav.findIndex((r) => r.key === focusKey);
  if (i < 0) return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End" ? { kind: "focus", key: nav[0].key } : null;
  const cur = nav[i];
  switch (key) {
    case "ArrowDown":
      return i + 1 < nav.length ? { kind: "focus", key: nav[i + 1].key } : null;
    case "ArrowUp":
      return i > 0 ? { kind: "focus", key: nav[i - 1].key } : null;
    case "Home":
      return { kind: "focus", key: nav[0].key };
    case "End":
      return { kind: "focus", key: nav[nav.length - 1].key };
    case "ArrowRight": {
      if (!isExpandable(cur)) return null;
      if (!expandedRow(cur)) return { kind: "expand", key: cur.key };
      const next = nav[i + 1];
      return next && next.level > cur.level ? { kind: "focus", key: next.key } : null;
    }
    case "ArrowLeft": {
      if (isExpandable(cur) && expandedRow(cur)) return { kind: "collapse", key: cur.key };
      for (let j = i - 1; j >= 0; j--) if (nav[j].level < cur.level) return { kind: "focus", key: nav[j].key };
      return null;
    }
    case "Enter":
      if (cur.type === "schema" || cur.type === "folder" || cur.type === "part") return { kind: cur.expanded ? "collapse" : "expand", key: cur.key };
      return { kind: "activate", key: cur.key };
    default:
      return null;
  }
}

function expandedRow(r: TreeRow): boolean {
  return (r.type === "schema" || r.type === "folder" || r.type === "object" || r.type === "part") && r.expanded;
}

/** 열쇠를 펼친 목록에 넣거나 뺀다 — 새 배열(펼친 목록은 타일 상태라 바꿔 끼운다) */
export function toggled(expanded: readonly string[], key: string, open: boolean): string[] {
  const has = expanded.includes(key);
  if (open === has) return [...expanded];
  return open ? [...expanded, key] : expanded.filter((k) => k !== key);
}

/** 펼친 객체 열쇠 → 그 구조를 읽을 `(스키마, 이름)` — 지금 받은 객체 목록에 있는 관계만(사라졌으면 `null`) */
export function relationFor(objects: ReadonlyMap<string, Load<DbObjects>>, key: string): { schema: string; name: string } | null {
  if (!key.startsWith(`o${SEP}`)) return null;
  const [, schema] = key.split(SEP);
  const load = objects.get(schema);
  if (load?.state !== "ok") return null;
  const o = load.value.objects.find((x) => objectKey(schema, x) === key);
  return o && isRelation(o.kind) ? { schema, name: o.name } : null;
}
