/**
 * **DDL 읽기 전용 보기의 규칙** — 트리의 어느 줄이 "DDL 보기" 를 갖나 · 서버 op `db_definition` 의 몸 · 머리줄 이름 ·
 * [편집기에 넣기]의 글자. **순수 함수**(그림은 `DefinitionView.svelte` · 메뉴는 `TreeMenu.svelte`, 서버 규칙은 Rust
 * `db::definition` 머리말의 표).
 *
 * | 방언 | 정의가 있는 줄 |
 * | --- | --- |
 * | PostgreSQL | 폴더의 객체 모두(테이블 · 뷰 · 구체화 뷰 · 외부 테이블 · 함수 · 프로시저 · 시퀀스 · 형) · 인덱스 · 트리거 · 이름 있는 제약 조건 · 외래 키 · 참조됨 · 파티션 |
 * | MySQL · MariaDB | 테이블 · 뷰 · 함수 · 프로시저 · 시퀀스 · 트리거(인덱스 · 제약은 테이블 정의 안에 있다) |
 * | SQLite | 테이블 · 뷰 · 인덱스 · 트리거(제약은 이름이 없다 — 테이블 정의 안에 있다) |
 *
 * 컬럼 · 스키마 · 폴더 줄에는 없다. 쓰기 · 실행은 없다 — 보기 · 복사 · 편집기에 넣기(실행하지 않는다)뿐이다.
 */
import type { DbDefinitionKind, DbDefinitionTarget, DbDialect } from "./query-backend";
import type { TreeRow } from "./schema-tree";

/** 방언마다 정의를 볼 수 있는 종류 */
export const DEFINITION_KINDS: Record<DbDialect, readonly DbDefinitionKind[]> = {
  postgres: ["table", "view", "matview", "foreign", "function", "procedure", "sequence", "type", "index", "trigger", "constraint"],
  mysql: ["table", "view", "function", "procedure", "sequence", "trigger"],
  sqlite: ["table", "view", "index", "trigger"],
};

function allowed(dialect: DbDialect, t: DbDefinitionTarget): DbDefinitionTarget | null {
  return DEFINITION_KINDS[dialect].includes(t.kind) && t.name ? t : null;
}

/** 트리 줄 하나 → 정의를 볼 대상(없으면 `null` — 그 줄에는 "DDL 보기" 가 서지 않는다) */
export function definitionTarget(dialect: DbDialect, r: TreeRow): DbDefinitionTarget | null {
  if (r.type === "object") {
    const o = r.object;
    return allowed(dialect, { schema: r.schema, kind: o.kind, name: o.name, ...(o.args !== undefined ? { args: o.args } : {}) });
  }
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
      // 외래 키는 가리키는 쪽(`schema.table`)의 제약이다 — 참조됨이면 다른 테이블의 것.
      return l.item.name ? allowed(dialect, { schema: l.item.schema, kind: "constraint", name: l.item.name, table: l.item.table }) : null;
    case "partitions":
      return allowed(dialect, { schema: l.item.schema, kind: "table", name: l.item.name });
  }
}

/** 머리줄의 이름(표시용 — 인용하지 않는다): `스키마.이름(인자)` · 테이블에 딸린 것은 `스키마.테이블.이름`. SQLite `main` 은 생략 */
export function definitionName(dialect: DbDialect, t: DbDefinitionTarget): string {
  const schema = t.schema && !(dialect === "sqlite" && t.schema === "main") ? `${t.schema}.` : "";
  const owner = t.table && (t.kind === "trigger" || t.kind === "constraint") ? `${t.table}.` : "";
  const args = t.args !== undefined ? `(${t.args})` : "";
  return `${schema}${owner}${t.name}${args}`;
}

/** 같은 대상인가(다시 누르면 다시 읽지 않고 그 칸으로만) */
export function sameTarget(a: DbDefinitionTarget | null, b: DbDefinitionTarget | null): boolean {
  if (!a || !b) return false;
  return a.schema === b.schema && a.kind === b.kind && a.name === b.name && a.table === b.table && a.args === b.args;
}

/**
 * [편집기에 넣기] 의 글자 — 커서 자리에 넣되 **문장이 앞뒤 글과 붙지 않게** 줄을 띄운다: 커서 앞이 줄 머리가 아니면 빈 줄 하나 ·
 * 뒤에 글이 이어지면 줄 바꿈 둘. 편집기가 비었으면 그대로. 실행하지 않는다.
 */
export function blockInsert(doc: string, pos: number, text: string): string {
  const at = Math.max(0, Math.min(pos, doc.length));
  const before = doc.slice(0, at);
  const after = doc.slice(at);
  let head = "";
  if (before.length > 0) head = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.length > 0 ? (after.startsWith("\n") ? "\n" : "\n\n") : "\n";
  return head + text.replace(/\s+$/, "") + tail;
}
