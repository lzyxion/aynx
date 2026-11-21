/**
 * 스키마 트리의 규칙 — 폴더 나누기 · 줄 펴기 · 키보드 · 넣을 이름 · 외래 키 따라가기.
 *
 * - 인덱스 · 트리거는 엔진과 상관없이 테이블 아래에만 선다(엔진끼리 모양을 맞춘다).
 * - 펼친 열쇠 목록은 타일(`QueryView`)이 쥔다. 열쇠는 NUL 로 이은 글자다(이름에 무엇이 와도 겹치지 않는다).
 * - 이름 필터는 이미 읽어 온 것만 거르고, 펼친 목록은 건드리지 않는다(필터를 지우면 원래 펼침). 서버 검색 op 를 두지 않은 까닭은 `SchemaTree` 머리말.
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

/** 목록에 없는 종류는 그 방언에서 오지 않는다 */
export const FOLDERS: Record<DbDialect, readonly DbObjectKind[]> = {
  postgres: ["table", "view", "matview", "foreign", "function", "procedure", "sequence", "type"],
  mysql: ["table", "view", "function", "procedure", "sequence"],
  sqlite: ["table", "view"],
};

export const PARTS = ["columns", "indexes", "constraints", "foreignKeys", "referencedBy", "triggers", "partitions"] as const;
export type DetailPart = (typeof PARTS)[number];

/** 컬럼은 따로 — `column` 줄 */
export type DetailLeaf =
  | { part: "indexes"; item: DbIndex }
  | { part: "constraints"; item: DbConstraint }
  | { part: "foreignKeys" | "referencedBy"; item: DbForeignKey }
  | { part: "triggers"; item: DbTrigger }
  | { part: "partitions"; item: DbPartition };

export function isRelation(kind: DbObjectKind): boolean {
  return kind === "table" || kind === "view" || kind === "matview" || kind === "foreign";
}

const SEP = "\u0000";
export const schemaKey = (schema: string) => `s${SEP}${schema}`;
export const folderKey = (schema: string, kind: DbObjectKind) => `f${SEP}${schema}${SEP}${kind}`;
/** 겹지정 함수(같은 이름 · 다른 인자)가 갈리게 인자까지 */
export const objectKey = (schema: string, o: DbObject) => `o${SEP}${schema}${SEP}${o.kind}${SEP}${o.name}${SEP}${o.args ?? ""}`;
export const partKey = (objKey: string, part: DetailPart) => `p${SEP}${objKey}${SEP}${part}`;

export interface Folder {
  kind: DbObjectKind;
  items: DbObject[];
  truncated: boolean;
  /** 이름 필터 중 — 일치한 수 */
  matched?: number;
}

/** 빈 폴더는 숨긴다 — 엔진 · 판마다 없는 종류가 많아 빈 폴더가 대부분이다 */
export function groupFolders(dialect: DbDialect, data: DbObjects): Folder[] {
  const out: Folder[] = [];
  for (const kind of FOLDERS[dialect]) {
    const items = data.objects.filter((o) => o.kind === kind);
    if (items.length > 0) out.push({ kind, items, truncated: data.truncated.includes(kind) });
  }
  return out;
}

export interface PartFolder {
  part: DetailPart;
  count: number;
  truncated: boolean;
  matched?: number;
}

export function detailParts(d: DbTableDetail): PartFolder[] {
  return PARTS.filter((p) => (d[p]?.length ?? 0) > 0).map((p) => ({ part: p, count: d[p].length, truncated: d.truncated.includes(p) }));
}

export function countLabel(f: { items?: unknown[]; count?: number; truncated: boolean; matched?: number }): string {
  const n = f.count ?? f.items?.length ?? 0;
  const total = f.truncated ? `${n}+` : String(n);
  return f.matched !== undefined ? `${f.matched}/${total}` : total;
}

// ── 이름 필터 ─────────────────────────────────────────────────────────────

export function normFilter(filter: string | undefined): string {
  return (filter ?? "").trim().toLowerCase();
}

/** `q` 는 [`normFilter`] 를 지난 것 */
export function nameMatches(name: string, q: string): boolean {
  return q !== "" && name.toLowerCase().includes(q);
}

/** 소문자로 바꿔 길이가 달라지는 글자가 있으면 강조하지 않는다(일치는 그대로) */
export function matchSpan(text: string, filter: string | undefined): [number, number] | null {
  const q = normFilter(filter);
  if (!q) return null;
  const low = text.toLowerCase();
  if (low.length !== text.length) return null;
  const i = low.indexOf(q);
  return i < 0 ? null : [i, i + q.length];
}

/** 이름 없는 외래 키(SQLite)는 다른 쪽 테이블 이름으로 거른다 */
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

export function signature(o: DbObject): string {
  if (o.args === undefined) return o.name;
  return `${o.name}(${o.args})${o.returns ? ` → ${o.returns}` : ""}`;
}

/** 함수 · 프로시저는 여는 괄호까지 — 인자는 사람이 친다 */
export function insertText(dialect: DbDialect, schema: string | null, o: DbObject): string {
  const base = qualifiedName(dialect, schema, o.name);
  return o.kind === "function" || o.kind === "procedure" ? `${base}(` : base;
}

/** 그 엔진에서 그 이름을 쓰는 자리의 꼴(스키마에 딸리면 정규화 · 테이블에 딸리면 이름만) */
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

/** 식 열 `null` 은 `expr` 로 */
export function columnList(cols: readonly (string | null)[], expr = "…"): string {
  return `(${cols.map((c) => c ?? expr).join(", ")})`;
}

/** 표시용 — 인용하지 않는다 */
function shortName(here: string, schema: string, name: string): string {
  return schema === here ? name : `${schema}.${name}`;
}

export function fkArrow(part: "foreignKeys" | "referencedBy", fk: DbForeignKey, here: string): string {
  if (part === "foreignKeys") return `${columnList(fk.columns)} → ${shortName(here, fk.refSchema, fk.refTable)}${columnList(fk.refColumns)}`;
  return `${shortName(here, fk.schema, fk.table)}${columnList(fk.columns)} → ${columnList(fk.refColumns)}`;
}

/** 외래 키 · 참조됨 잎이 가리키는 다른 쪽 테이블 */
export function fkTarget(part: "foreignKeys" | "referencedBy", fk: DbForeignKey): { schema: string; table: string } {
  return part === "foreignKeys" ? { schema: fk.refSchema, table: fk.refTable } : { schema: fk.schema, table: fk.table };
}

export function skipSchemaLevel(dialect: DbDialect, schemas: readonly string[]): boolean {
  return dialect === "sqlite" && schemas.length === 1;
}

// ── 외래 키 따라가기 ──────────────────────────────────────────────────────

/** 없으면 대소문자만 다른 것 — SQLite · MySQL 은 이름이 대소문자를 가리지 않는 때가 있다 */
export function findRelation(data: DbObjects, table: string): DbObject | null {
  const rels = data.objects.filter((o) => isRelation(o.kind));
  return rels.find((o) => o.name === table) ?? rels.find((o) => o.name.toLowerCase() === table.toLowerCase()) ?? null;
}

export function revealKeys(dialect: DbDialect, schemas: readonly string[], schema: string, o: DbObject): string[] {
  const keys = skipSchemaLevel(dialect, schemas) ? [] : [schemaKey(schema)];
  return [...keys, folderKey(schema, o.kind)];
}

export function withExpanded(expanded: readonly string[], keys: readonly string[]): string[] {
  return [...expanded, ...keys.filter((k, i) => !expanded.includes(k) && keys.indexOf(k) === i)];
}

// ── 줄 펴기 ─────────────────────────────────────────────────────────────

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
      expandable: boolean;
      expanded: boolean;
    }
  | { type: "part"; key: string; level: number; schema: string; folder: PartFolder; expanded: boolean }
  | { type: "column"; key: string; level: number; schema: string; column: DbTableColumn }
  /** `table` = 그 구조를 가진 관계 */
  | { type: "leaf"; key: string; level: number; schema: string; table: string; leaf: DetailLeaf }
  /** 고를 수 없는 줄 */
  | {
      type: "note";
      key: string;
      level: number;
      note: "loading" | "error" | "empty" | "truncated" | "nomatch" | "unread";
      message?: string;
      count?: number;
    };

/** 데이터 탭을 여는 줄의 객체 */
export interface TreeRelation {
  kind: "table" | "view" | "matview" | "foreign" | "partition";
  schema: string | null;
  name: string;
}

export function relationOf(r: TreeRow): TreeRelation | null {
  if (r.type === "object") {
    const k = r.object.kind;
    if (!r.expandable || !(k === "table" || k === "view" || k === "matview" || k === "foreign")) return null;
    return { kind: k, schema: r.schema, name: r.object.name };
  }
  if (r.type === "leaf" && r.leaf.part === "partitions") return { kind: "partition", schema: r.leaf.item.schema, name: r.leaf.item.name };
  return null;
}

export interface TreeInput {
  dialect: DbDialect;
  schemas: readonly string[];
  expanded: ReadonlySet<string>;
  objects: ReadonlyMap<string, Load<DbObjects>>;
  /** 관계 열쇠 → 구조 */
  details: ReadonlyMap<string, Load<DbTableDetail>>;
  filter?: string;
}

function partRows(d: DbTableDetail, part: DetailPart, pk: string, level: number, schema: string, table: string): TreeRow[] {
  if (part === "columns") return d.columns.map((c, i) => ({ type: "column", key: `${pk}${SEP}${i}`, level, schema, column: c }));
  const items = d[part] as DetailLeaf["item"][];
  return items.map((item, i) => ({ type: "leaf", key: `${pk}${SEP}${i}`, level, schema, table, leaf: { part, item } as DetailLeaf }));
}

/** 관계 줄은 부르는 쪽이 넣는다 */
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

/** 펼친 목록은 읽기만 한다 */
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

/** 키보드 이동은 이 순서를 그대로 쓴다 */
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

export function isExpandable(r: TreeRow): boolean {
  return r.type === "schema" || r.type === "folder" || r.type === "part" || (r.type === "object" && r.expandable);
}

export function isFocusable(r: TreeRow): boolean {
  return r.type !== "note";
}

export type KeyAction =
  | { kind: "focus"; key: string }
  | { kind: "expand"; key: string }
  | { kind: "collapse"; key: string }
  | { kind: "activate"; key: string };

/** WAI-ARIA 트리 문법 */
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

/** 새 배열 — 펼친 목록은 타일 상태라 바꿔 끼운다 */
export function toggled(expanded: readonly string[], key: string, open: boolean): string[] {
  const has = expanded.includes(key);
  if (open === has) return [...expanded];
  return open ? [...expanded, key] : expanded.filter((k) => k !== key);
}

/** 지금 받은 객체 목록에 있는 관계만 — 사라졌으면 `null` */
export function relationFor(objects: ReadonlyMap<string, Load<DbObjects>>, key: string): { schema: string; name: string } | null {
  if (!key.startsWith(`o${SEP}`)) return null;
  const [, schema] = key.split(SEP);
  const load = objects.get(schema);
  if (load?.state !== "ok") return null;
  const o = load.value.objects.find((x) => objectKey(schema, x) === key);
  return o && isRelation(o.kind) ? { schema, name: o.name } : null;
}
