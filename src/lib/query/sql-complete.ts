/**
 * 별칭 해석은 정규식 수준이다 — 괄호 안 하위 질의 · CTE 의 열은 모른다(못 찾으면 조용히 없다). 쉼표 목록은 `FROM` 바로 뒤의 것만
 * 읽는다(`JOIN … ON …, t` 의 `t` 는 못 읽는다).
 */
import type { DbColumn, DbDialect, DbObjectKind, DbObjects } from "./query-backend";
import { quoteIdent } from "./sql-quote";
import { statementAt } from "./statement-at";

export type CompleteKind = "keyword" | "schema" | "table" | "view" | "column";

export interface CompleteItem {
  label: string;
  kind: CompleteKind;
  detail?: string;
  apply?: string;
  boost?: number;
}

export interface Rel {
  schema: string | null;
  name: string;
  kind: "table" | "view";
}

export interface RelRef {
  schema: string | null;
  name: string;
}

const COMMON = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE", "BETWEEN", "EXISTS", "AS", "ON", "JOIN", "LEFT",
  "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "NATURAL", "USING", "GROUP", "BY", "ORDER", "ASC", "DESC", "HAVING", "LIMIT",
  "OFFSET", "DISTINCT", "UNION", "ALL", "INTERSECT", "EXCEPT", "CASE", "WHEN", "THEN", "ELSE", "END", "INSERT", "INTO", "VALUES",
  "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "VIEW", "INDEX", "DROP", "ALTER", "ADD", "COLUMN", "PRIMARY", "KEY", "FOREIGN",
  "REFERENCES", "DEFAULT", "UNIQUE", "CHECK", "CONSTRAINT", "WITH", "RECURSIVE", "TRUE", "FALSE", "COUNT", "SUM", "AVG", "MIN",
  "MAX", "COALESCE", "CAST", "NULLIF", "EXPLAIN", "BEGIN", "COMMIT", "ROLLBACK",
] as const;

const EXTRA: Record<DbDialect, readonly string[]> = {
  postgres: [
    "ILIKE", "SIMILAR", "LATERAL", "FETCH", "FIRST", "ROWS", "ONLY", "RETURNING", "NULLS", "ANALYZE", "SCHEMA", "SEQUENCE",
    "MATERIALIZED", "NOW", "CURRENT_DATE", "CURRENT_TIMESTAMP", "INTERVAL", "ARRAY", "ANY", "SOME",
  ],
  mysql: ["REGEXP", "RLIKE", "SHOW", "DATABASES", "TABLES", "DESCRIBE", "IFNULL", "NOW", "STRAIGHT_JOIN", "DUAL", "REPLACE", "IGNORE"],
  sqlite: ["GLOB", "PRAGMA", "IFNULL", "REPLACE", "ROWID", "RETURNING", "ATTACH", "DETACH", "VACUUM"],
};

const WHERE_COMMON = ["AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE", "BETWEEN", "EXISTS", "SELECT", "TRUE", "FALSE"] as const;
const WHERE_EXTRA: Record<DbDialect, readonly string[]> = { postgres: ["ILIKE"], mysql: ["REGEXP"], sqlite: ["GLOB"] };

export function sqlKeywords(dialect: DbDialect): string[] {
  return [...new Set([...COMMON, ...EXTRA[dialect]])];
}

export function whereKeywords(dialect: DbDialect): string[] {
  return [...WHERE_COMMON, ...WHERE_EXTRA[dialect]];
}

const RESERVED = new Set<string>([...COMMON, ...EXTRA.postgres, ...EXTRA.mysql, ...EXTRA.sqlite, "WINDOW", "SELECT", "FOR", "TABLESAMPLE"]);

export function identText(name: string, dialect: DbDialect): string {
  const simple = dialect === "postgres" ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][A-Za-z0-9_$]*$/;
  return simple.test(name) && !RESERVED.has(name.toUpperCase()) ? name : quoteIdent(name, dialect);
}

export function relsFromObjects(schema: string | null, data: DbObjects): Rel[] {
  const kindOf = (k: DbObjectKind): Rel["kind"] | null =>
    k === "table" || k === "foreign" ? "table" : k === "view" || k === "matview" ? "view" : null;
  const out: Rel[] = [];
  for (const o of data.objects) {
    const kind = kindOf(o.kind);
    if (kind) out.push({ schema, name: o.name, kind });
  }
  return out;
}

// ── 글 읽기 ─────────────────────────────────────────────────────────────

/** 문자열 · 주석을 공백으로 지운 글 — 길이 그대로라 자리가 맞는다. MySQL 의 `"…"` 는 식별자로 둔다(대략) */
export function blankNonCode(s: string): string {
  const out = s.split("");
  let i = 0;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") j += 2;
        else if (s[j] === "'") break;
        else j++;
      }
      const end = Math.min(s.length, j + 1);
      blank(i, end);
      i = end;
    } else if (c === "-" && s[i + 1] === "-") {
      let j = s.indexOf("\n", i);
      if (j < 0) j = s.length;
      blank(i, j);
      i = j;
    } else if (c === "/" && s[i + 1] === "*") {
      let j = s.indexOf("*/", i + 2);
      j = j < 0 ? s.length : j + 2;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === c && s[j + 1] === c) j += 2;
        else if (s[j] === c) break;
        else j++;
      }
      i = j + 1;
    } else i++;
  }
  return out.join("");
}

const IDENT_CHAR = /[\p{L}\p{N}_$]/u;

function identBefore(s: string, end: number): { start: number; name: string; quoted: boolean } | null {
  const q = s[end - 1];
  if (q === '"' || q === "`") {
    const open = s.lastIndexOf(q, end - 2);
    if (open < 0) return null;
    return { start: open, name: s.slice(open + 1, end - 1).replaceAll(q + q, q), quoted: true };
  }
  let i = end;
  while (i > 0 && IDENT_CHAR.test(s[i - 1])) i--;
  if (i === end || /\p{N}/u.test(s[i])) return null;
  return { start: i, name: s.slice(i, end), quoted: false };
}

export interface WordAt {
  from: number;
  start: number;
  word: string;
  qualifier: string[] | null;
  plainQualifier: boolean[];
}

export function wordAt(text: string, pos: number): WordAt | null {
  let i = pos;
  while (i > 0 && IDENT_CHAR.test(text[i - 1])) i--;
  const word = text.slice(i, pos);
  if (word !== "" && /\p{N}/u.test(word[0])) return null;
  const parts: string[] = [];
  const plain: boolean[] = [];
  let j = i;
  while (parts.length < 2 && text[j - 1] === ".") {
    const id = identBefore(text, j - 1);
    if (!id) break;
    parts.unshift(id.name);
    plain.unshift(!id.quoted);
    j = id.start;
  }
  if (text[i - 1] === "." && parts.length === 0) return null;
  return { from: i, start: j, word, qualifier: parts.length > 0 ? parts : null, plainQualifier: plain };
}

type Tok = { id: string; quoted: boolean } | { p: string };

function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|([\p{L}_][\p{L}\p{N}_$]*)|[\p{N}]+|(\S)/gu;
  for (const m of s.matchAll(re)) {
    if (m[1] !== undefined) out.push({ id: m[1].replaceAll('""', '"'), quoted: true });
    else if (m[2] !== undefined) out.push({ id: m[2].replaceAll("``", "`"), quoted: true });
    else if (m[3] !== undefined) out.push({ id: m[3], quoted: false });
    else if (m[4] !== undefined) out.push({ p: m[4] });
  }
  return out;
}

const isKw = (t: Tok | undefined, kw: string) => !!t && "id" in t && !t.quoted && t.id.toUpperCase() === kw;
const isP = (t: Tok | undefined, p: string) => !!t && "p" in t && t.p === p;

export interface StatementRefs {
  refs: RelRef[];
  aliases: Map<string, RelRef>;
}

/** 문자열 · 주석은 [`blankNonCode`] 가 먼저 지웠다고 본다 */
export function statementRefs(code: string, dialect: DbDialect): StatementRefs {
  const tk = tokens(code);
  const refs: RelRef[] = [];
  const aliases = new Map<string, RelRef>();
  const fold = (t: { id: string; quoted: boolean }) => (dialect === "postgres" && !t.quoted ? t.id.toLowerCase() : t.id);
  const name = (t: Tok | undefined): { id: string; quoted: boolean } | null => (t && "id" in t && (t.quoted || !RESERVED.has(t.id.toUpperCase())) ? t : null);
  for (let i = 0; i < tk.length; i++) {
    const head = ["FROM", "JOIN", "UPDATE", "INTO"].find((k) => isKw(tk[i], k));
    if (!head) continue;
    let j = i + 1;
    for (;;) {
      if (isKw(tk[j], "ONLY") || isKw(tk[j], "LATERAL")) j++;
      if (isP(tk[j], "(")) {
        let depth = 0;
        for (; j < tk.length; j++) {
          if (isP(tk[j], "(")) depth++;
          else if (isP(tk[j], ")") && --depth === 0) break;
        }
        j++;
        if (isKw(tk[j], "AS")) j++;
        if (name(tk[j])) j++;
      } else {
        const a = name(tk[j]);
        if (!a) break;
        if (head !== "INTO" && isP(tk[j + 1], "(")) break;
        let ref: RelRef = { schema: null, name: fold(a) };
        j++;
        if (isP(tk[j], ".")) {
          const b = name(tk[j + 1]);
          if (b) {
            ref = { schema: fold(a), name: fold(b) };
            j += 2;
          }
        }
        refs.push(ref);
        aliases.set(ref.name.toLowerCase(), ref);
        if (isKw(tk[j], "AS")) j++;
        const al = name(tk[j]);
        if (al) {
          aliases.set(al.id.toLowerCase(), ref);
          j++;
        }
      }
      if (head === "FROM" && isP(tk[j], ",")) {
        j++;
        continue;
      }
      break;
    }
    i = j - 1;
  }
  return { refs, aliases };
}

// ── 후보 ────────────────────────────────────────────────────────────────

function isDefaultSchema(dialect: DbDialect, schema: string | null): boolean {
  if (schema === null || dialect === "mysql") return true;
  return dialect === "postgres" ? schema === "public" : schema === "main";
}

export function resolveRel(ref: RelRef, rels: readonly Rel[], dialect: DbDialect): Rel & { known: boolean } {
  const low = ref.name.toLowerCase();
  const same = rels.filter((r) => r.name.toLowerCase() === low && (ref.schema === null || (r.schema ?? "").toLowerCase() === ref.schema.toLowerCase()));
  const pick = same.find((r) => r.name === ref.name && isDefaultSchema(dialect, r.schema)) ?? same.find((r) => isDefaultSchema(dialect, r.schema)) ?? same[0];
  return pick ? { ...pick, known: true } : { schema: ref.schema, name: ref.name, kind: "table", known: false };
}

export function relKey(dialect: DbDialect, r: RelRef): string {
  const s = r.schema === null || (dialect === "sqlite" && r.schema === "main") ? "" : r.schema;
  return `${s}\u0000${r.name.toLowerCase()}`;
}

export interface CompleteInput {
  dialect: DbDialect;
  text: string;
  pos: number;
  explicit: boolean;
  rels: readonly Rel[];
  schemas: readonly string[];
  columns: (r: Rel) => readonly DbColumn[] | null;
  keywords?: readonly string[];
  relations?: boolean;
}

export interface CompletePlan {
  from: number;
  word: string;
  items: CompleteItem[];
  missing: Rel[];
}

const MAX_RELS = 2000;

export function sqlComplete(o: CompleteInput): CompletePlan | null {
  const { dialect, text, pos } = o;
  const st = statementAt(text, dialect, pos);
  const start = st && st.start <= pos ? st.start : 0;
  const end = Math.max(st && st.start <= pos ? st.end : pos, pos);
  const blanked = blankNonCode(text.slice(start, end));
  const at = pos - start;
  if (at > 0 && blanked[at - 1] === " " && text[pos - 1] !== " " && text[pos - 1] !== "\n") return null;
  const w = wordAt(text, pos);
  if (!w) return null;
  if (!o.explicit && !w.qualifier && w.word.length < 2) return null;
  // 치는 중인 낱말(점 앞 이름까지)은 표 참조로 읽지 않는다(`FROM ord|` 를 열 읽기 대상으로 삼지 않게)
  const wf = Math.max(0, w.start - start);
  const code = blanked.slice(0, wf) + " ".repeat(Math.max(0, at - wf)) + blanked.slice(at);

  const { refs, aliases } = statementRefs(code, dialect);
  const missing: Rel[] = [];
  const colItems = (r: Rel & { known?: boolean }, boost: number): CompleteItem[] => {
    const cols = o.columns(r);
    if (cols === null) {
      missing.push(r);
      return [];
    }
    return cols.map((c) => ({ label: c.name, kind: "column", detail: c.type ? `${c.type} · ${r.name}` : r.name, apply: identText(c.name, dialect), boost }));
  };
  const relItem = (r: Rel, qualify: boolean): CompleteItem => {
    const q = qualify && !isDefaultSchema(dialect, r.schema);
    return {
      label: r.name,
      kind: r.kind,
      detail: q ? `${r.kind} · ${r.schema}` : r.kind,
      apply: q && r.schema !== null ? `${identText(r.schema, dialect)}.${identText(r.name, dialect)}` : identText(r.name, dialect),
      boost: 1,
    };
  };

  if (w.qualifier) {
    const fold = (s: string, i: number) => (dialect === "postgres" && w.plainQualifier[i] ? s.toLowerCase() : s);
    const parts = w.qualifier.map(fold);
    let items: CompleteItem[] = [];
    if (parts.length === 2) {
      items = colItems(resolveRel({ schema: parts[0], name: parts[1] }, o.rels, dialect), 2);
    } else {
      const q = parts[0];
      const ref = aliases.get(q.toLowerCase());
      const byName = ref ? null : o.rels.find((r) => r.name.toLowerCase() === q.toLowerCase());
      if (ref) items = colItems(resolveRel(ref, o.rels, dialect), 2);
      else if (byName) items = colItems(resolveRel({ schema: null, name: byName.name }, o.rels, dialect), 2);
      else if (o.relations !== false && o.schemas.some((s) => s.toLowerCase() === q.toLowerCase())) {
        items = o.rels.filter((r) => (r.schema ?? "").toLowerCase() === q.toLowerCase()).slice(0, MAX_RELS).map((r) => relItem(r, false));
      } else return null;
    }
    return { from: w.from, word: w.word, items, missing };
  }

  const items: CompleteItem[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const r = resolveRel(ref, o.rels, dialect);
    const k = relKey(dialect, r);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(...colItems(r, 2));
  }
  if (o.relations !== false) {
    for (const r of o.rels.slice(0, MAX_RELS)) items.push(relItem(r, true));
    if (dialect !== "sqlite" || o.schemas.length > 1) for (const s of o.schemas) items.push({ label: s, kind: "schema", detail: "schema", apply: identText(s, dialect) });
  }
  const lower = w.word !== "" && w.word === w.word.toLowerCase();
  for (const k of o.keywords ?? sqlKeywords(dialect)) items.push({ label: k, kind: "keyword", ...(lower ? { apply: k.toLowerCase() } : {}) });
  return { from: w.from, word: w.word, items, missing };
}

export function filterItems(items: readonly CompleteItem[], word: string, max = 50): CompleteItem[] {
  const q = word.toLowerCase();
  const head: CompleteItem[] = [];
  const mid: CompleteItem[] = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    if (l === q) continue;
    if (l.startsWith(q)) head.push(it);
    else if (q !== "" && l.includes(q)) mid.push(it);
  }
  const by = (a: CompleteItem, b: CompleteItem) => (b.boost ?? 0) - (a.boost ?? 0);
  return [...head.sort(by), ...mid.sort(by)].slice(0, max);
}
