/**
 * DDL 읽기 전용 보기의 규칙 — 쓰기 · 실행은 없다(보기 · 복사 · 편집기에 넣기뿐).
 */
import type { DbDefinitionKind, DbDefinitionTarget, DbDialect, DbObject } from "./query-backend";
import type { TreeRow } from "./schema-tree";

/** Rust `db::definition` 이 주는 종류와 맞춘다 */
export const DEFINITION_KINDS: Record<DbDialect, readonly DbDefinitionKind[]> = {
  postgres: ["table", "view", "matview", "foreign", "function", "procedure", "sequence", "type", "index", "trigger", "constraint"],
  mysql: ["table", "view", "function", "procedure", "sequence", "trigger"],
  sqlite: ["table", "view", "index", "trigger"],
};

function allowed(dialect: DbDialect, t: DbDefinitionTarget): DbDefinitionTarget | null {
  return DEFINITION_KINDS[dialect].includes(t.kind) && t.name ? t : null;
}

/** 트리의 객체 줄 · 객체 목록 탭의 줄이 함께 쓴다 */
export function objectTarget(dialect: DbDialect, schema: string, o: DbObject): DbDefinitionTarget | null {
  return allowed(dialect, { schema, kind: o.kind, name: o.name, ...(o.args !== undefined ? { args: o.args } : {}) });
}

/** `null` 이면 그 줄에는 "DDL 보기" 가 서지 않는다 */
export function definitionTarget(dialect: DbDialect, r: TreeRow): DbDefinitionTarget | null {
  if (r.type === "object") return objectTarget(dialect, r.schema, r.object);
  if (r.type !== "leaf") return null;
  const l = r.leaf;
  switch (l.part) {
    case "indexes":
      return allowed(dialect, { schema: r.schema, kind: "index", name: l.item.name, table: r.table });
    case "triggers":
      return allowed(dialect, { schema: r.schema, kind: "trigger", name: l.item.name, table: r.table });
    case "constraints":
      return l.item.name ? allowed(dialect, { schema: r.schema, kind: "constraint", name: l.item.name, table: r.table }) : null;
    case "foreignKeys":
    case "referencedBy":
      // 외래 키는 가리키는 쪽 테이블의 제약이다 — 참조됨이면 다른 테이블의 것
      return l.item.name ? allowed(dialect, { schema: l.item.schema, kind: "constraint", name: l.item.name, table: l.item.table }) : null;
    case "partitions":
      return allowed(dialect, { schema: l.item.schema, kind: "table", name: l.item.name });
  }
}

/** 표시용 — 인용하지 않는다 */
export function definitionName(dialect: DbDialect, t: DbDefinitionTarget): string {
  const schema = t.schema && !(dialect === "sqlite" && t.schema === "main") ? `${t.schema}.` : "";
  const owner = t.table && (t.kind === "trigger" || t.kind === "constraint") ? `${t.table}.` : "";
  const args = t.args !== undefined ? `(${t.args})` : "";
  return `${schema}${owner}${t.name}${args}`;
}

export function sameTarget(a: DbDefinitionTarget | null, b: DbDefinitionTarget | null): boolean {
  if (!a || !b) return false;
  return a.schema === b.schema && a.kind === b.kind && a.name === b.name && a.table === b.table && a.args === b.args;
}

/** 문장이 앞뒤 글과 붙지 않게 줄을 띄운 넣을 글 */
export function blockInsert(doc: string, pos: number, text: string): string {
  const at = Math.max(0, Math.min(pos, doc.length));
  const before = doc.slice(0, at);
  const after = doc.slice(at);
  let head = "";
  if (before.length > 0) head = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.length > 0 ? (after.startsWith("\n") ? "\n" : "\n\n") : "\n";
  return head + text.replace(/\s+$/, "") + tail;
}
