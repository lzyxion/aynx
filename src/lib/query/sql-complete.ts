/**
 * **SQL 자동완성의 규칙**(쿼리 타일 2026-11-10) — 커서 앞 낱말 · 점 앞 이름(`x.`) · 같은 문장의 `FROM` / `JOIN` 별칭을 읽어 후보를
 * 짓는다. **순수 함수**(입출력 없음 — 열 읽기와 캐시는 `sql-completer.ts`, 편집기 붙이기는 `doc-editor-complete.ts`, 데이터 탭 WHERE 칸은
 * `WhereField.svelte`).
 *
 * - 후보: 표 · 뷰(스키마 트리가 이미 읽은 것) · 스키마 이름 · 열(문장에 나온 표의 것) · 키워드(엔진별 대략 — 작은 목록).
 * - `x.` 뒤면 x 를 **별칭 → 표 이름 → 스키마** 순으로 찾는다: 표면 그 표의 열만, 스키마면 그 스키마의 표 · 뷰만. 못 찾으면 후보 없음.
 * - 저절로 뜨는 때는 낱말 두 글자 이상 또는 점 바로 뒤뿐이다(`explicit` — `Ctrl+Space` — 면 빈 낱말도). 문자열 · 주석 안에서는 뜨지 않는다.
 * - 별칭 해석은 정규식 수준이다 — 괄호 안 하위 질의 · CTE 의 열은 모른다(그 이름은 표로 찾다가 못 찾으면 조용히 없다). 쉼표 목록은
 *   `FROM` 바로 뒤의 것만(`JOIN … ON …, t` 의 `t` 는 못 읽는다).
 * - 넣는 글은 인용이 필요할 때만 인용한다(대문자 · 기호 · 키워드와 같은 이름 — PostgreSQL 은 소문자가 아니면 인용).
 */
import type { DbColumn, DbDialect, DbObjectKind, DbObjects } from "./query-backend";
import { quoteIdent } from "./sql-quote";
import { statementAt } from "./statement-at";

export type CompleteKind = "keyword" | "schema" | "table" | "view" | "column";

/** 후보 하나 — `apply` 가 없으면 `label` 을 넣는다 */
export interface CompleteItem {
  label: string;
  kind: CompleteKind;
  /** 오른쪽 작은 글자(열: `형 · 표` · 표: `table` / `view`) */
  detail?: string;
  apply?: string;
  /** 정렬 가중(클수록 앞) */
  boost?: number;
}

/** 아는 관계(표 · 뷰) — 스키마 트리가 읽은 객체 목록에서 */
export interface Rel {
  schema: string | null;
  name: string;
  kind: "table" | "view";
}

/** 문장에 적힌 관계 참조(스키마는 적혔을 때만) */
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

/** 그 엔진의 키워드(대문자) */
export function sqlKeywords(dialect: DbDialect): string[] {
  return [...new Set([...COMMON, ...EXTRA[dialect]])];
}

/** WHERE 칸의 키워드 — 조건에 오는 것만 */
export function whereKeywords(dialect: DbDialect): string[] {
  return [...WHERE_COMMON, ...WHERE_EXTRA[dialect]];
}

/** 별칭 자리에 올 수 없는 낱말(모든 엔진의 키워드) */
const RESERVED = new Set<string>([...COMMON, ...EXTRA.postgres, ...EXTRA.mysql, ...EXTRA.sqlite, "WINDOW", "SELECT", "FOR", "TABLESAMPLE"]);

/** 넣을 이름 — 인용이 필요할 때만 인용한다(머리말) */
export function identText(name: string, dialect: DbDialect): string {
  const simple = dialect === "postgres" ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][A-Za-z0-9_$]*$/;
  return simple.test(name) && !RESERVED.has(name.toUpperCase()) ? name : quoteIdent(name, dialect);
}

/** 트리의 객체 목록 → 아는 관계(표 · 뷰 · 구체화 뷰 · 외부 테이블) */
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

/**
 * 문자열 · 주석을 공백으로 지운 글(길이 그대로 — 자리가 맞는다). `'…'`(겹 `''`) · `--` 줄 주석 · `/* … *\/` 블록 주석. MySQL 의
 * `"…"` 는 식별자로 둔다(기본 모드가 아니면 문자열이지만 — 대략).
 */
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
      // 인용 식별자 — 안의 `--` · `'` 를 주석 · 문자열로 읽지 않게 건너뛴다(지우지는 않는다)
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

/** 그 자리 바로 앞에서 끝나는 식별자(인용이면 안의 글) — 없으면 `null` */
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

/** 커서 앞 낱말 — `from` 은 낱말 시작(바꿀 자리), `qualifier` 는 점 앞 이름들(`a.b.` → `["a", "b"]`) */
export interface WordAt {
  from: number;
  /** 점 앞 이름까지 포함한 시작(`a.b.na` 의 `a`) */
  start: number;
  word: string;
  qualifier: string[] | null;
  /** 점 앞 이름 중 인용되지 않은 것 — PostgreSQL 은 소문자로 접어 찾는다 */
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
  if (text[i - 1] === "." && parts.length === 0) return null; // `1.` · `).` — 이름 아닌 것 뒤의 점
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

/** 문장에 나온 관계와 별칭 — `aliases` 의 열쇠는 소문자 별칭(별칭 없는 표는 그 이름) */
export interface StatementRefs {
  refs: RelRef[];
  aliases: Map<string, RelRef>;
}

/**
 * 같은 문장의 `FROM t [AS] a [, u b]` · `JOIN t [AS] a` · `UPDATE t` · `INTO t` 를 읽는다(문자열 · 주석은 [`blankNonCode`] 가 먼저 지운다고
 * 본다). 괄호 하위 질의는 건너뛴다. PostgreSQL 의 인용 안 한 이름은 소문자로 접는다.
 */
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
        // 하위 질의 — 짝 괄호까지 건너뛰고 별칭도 버린다
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
        if (head !== "INTO" && isP(tk[j + 1], "(")) break; // 함수(`generate_series(…)`) — 표가 아니다
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

/** 기본 스키마 — 이 스키마의 관계는 접두 없이 넣는다(MySQL 은 늘 접두 없이 — 연결의 데이터베이스) */
function isDefaultSchema(dialect: DbDialect, schema: string | null): boolean {
  if (schema === null || dialect === "mysql") return true;
  return dialect === "postgres" ? schema === "public" : schema === "main";
}

/** 적힌 참조 → 아는 관계(스키마가 없으면 이름으로 — 기본 스키마 먼저). 모르면 적힌 그대로(`known: false`) */
export function resolveRel(ref: RelRef, rels: readonly Rel[], dialect: DbDialect): Rel & { known: boolean } {
  const low = ref.name.toLowerCase();
  const same = rels.filter((r) => r.name.toLowerCase() === low && (ref.schema === null || (r.schema ?? "").toLowerCase() === ref.schema.toLowerCase()));
  const pick = same.find((r) => r.name === ref.name && isDefaultSchema(dialect, r.schema)) ?? same.find((r) => isDefaultSchema(dialect, r.schema)) ?? same[0];
  return pick ? { ...pick, known: true } : { schema: ref.schema, name: ref.name, kind: "table", known: false };
}

/** 열 캐시의 열쇠 — 스키마(SQLite `main` = 없음) · 이름(소문자) */
export function relKey(dialect: DbDialect, r: RelRef): string {
  const s = r.schema === null || (dialect === "sqlite" && r.schema === "main") ? "" : r.schema;
  return `${s}\u0000${r.name.toLowerCase()}`;
}

export interface CompleteInput {
  dialect: DbDialect;
  text: string;
  pos: number;
  /** 사람이 불렀다(`Ctrl+Space`) — 빈 낱말에도 뜬다 */
  explicit: boolean;
  rels: readonly Rel[];
  schemas: readonly string[];
  /** 그 관계의 열 — 아직 모르면 `null`(→ `missing`) */
  columns: (r: Rel) => readonly DbColumn[] | null;
  /** 키워드(기본 [`sqlKeywords`]) */
  keywords?: readonly string[];
  /** 표 · 스키마 이름을 후보에 넣는가(기본 참 — WHERE 칸은 거짓) */
  relations?: boolean;
}

export interface CompletePlan {
  from: number;
  word: string;
  items: CompleteItem[];
  /** 열이 필요한데 아직 모르는 관계 — 부르는 쪽이 읽고 다시 짓는다 */
  missing: Rel[];
}

const MAX_RELS = 2000;

/** 후보를 짓는다 — 뜰 때가 아니면 `null`(머리말) */
export function sqlComplete(o: CompleteInput): CompletePlan | null {
  const { dialect, text, pos } = o;
  const st = statementAt(text, dialect, pos);
  const start = st && st.start <= pos ? st.start : 0;
  const end = Math.max(st && st.start <= pos ? st.end : pos, pos);
  const blanked = blankNonCode(text.slice(start, end));
  const at = pos - start;
  if (at > 0 && blanked[at - 1] === " " && text[pos - 1] !== " " && text[pos - 1] !== "\n") return null; // 문자열 · 주석 안
  const w = wordAt(text, pos);
  if (!w) return null;
  if (!o.explicit && !w.qualifier && w.word.length < 2) return null;
  // 치는 중인 낱말(점 앞 이름까지)은 표 참조로 읽지 않는다(`FROM ord|` · `FROM sales.|` 를 열 읽기 대상으로 삼지 않게)
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

/**
 * 직접 거르기(데이터 탭의 WHERE 칸 — 편집기는 CodeMirror 가 거른다): 대소문자 무시, 앞부분 일치 먼저 · 그다음 포함, 같은 무리 안에서는
 * 가중(`boost`) 순. 빈 낱말이면 전부(가중 순). 많아야 `max`.
 */
export function filterItems(items: readonly CompleteItem[], word: string, max = 50): CompleteItem[] {
  const q = word.toLowerCase();
  const head: CompleteItem[] = [];
  const mid: CompleteItem[] = [];
  for (const it of items) {
    const l = it.label.toLowerCase();
    if (l === q) continue; // 이미 다 친 것
    if (l.startsWith(q)) head.push(it);
    else if (q !== "" && l.includes(q)) mid.push(it);
  }
  const by = (a: CompleteItem, b: CompleteItem) => (b.boost ?? 0) - (a.boost ?? 0);
  return [...head.sort(by), ...mid.sort(by)].slice(0, max);
}
