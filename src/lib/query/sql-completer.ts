/**
 * **쿼리 탭 편집기의 자동완성 몸**(2026-11-10) — 아는 것(스키마 트리가 읽은 스키마 · 표 · 열)을 연결 하나 동안 모아 두고, 후보 규칙
 * (`sql-complete.ts`)에 넘긴다. 편집기에는 [`SqlCompleter.complete`] 하나만 건너간다(`doc-editor-cm` 의 `complete` 칸).
 *
 * ## 열 읽기 — 표 단위로 처음 필요할 때 한 번
 *
 * - 후보에 열이 필요한데(문장에 나온 표 · `x.` 의 표) 아직 모르면 `db_table_detail`(트리 · 데이터 탭과 같은 재료)로 읽어 캐시한다
 *   (열쇠 = 연결(핸들 · 임대) · 스키마 · 표). 트리가 이미 펼쳐 읽은 표는 그 결과를 받아 둔다(`note`) — 다시 읽지 않는다.
 * - **서버는 연결당 작업 하나만 받는다(Busy)** — 부르는 쪽의 `canRead`(실행 · 작업 단추 · 모드 바꾸기 · 트리 읽기 · 데이터 탭 구조 읽기가
 *   없을 때)가 참일 때만 보내고, 읽는 동안은 `onread` 로 알려 트리 · 데이터 탭이 기다리게 한다(데이터 탭의 `onmeta` 와 같은 셈). 바쁘면 그
 *   순간은 열 없이 넘어가고 다음에 부를 때 다시 본다. 한 번에 한 묶음(많아야 [`READ_MAX`] 표)만 — 겹친 부름은 그 묶음을 기다린다.
 * - 오래 걸리면([`WAIT_MS`]) 열 없이 먼저 답하고 읽기는 이어 간다(다음 부름에 쓰인다). 실패는 조용히 — [`RETRY_MS`] 뒤에 다시 읽어 본다.
 * - 연결이 바뀌면(다시 열기 · 재부착) 모은 것을 버린다.
 */
import { dbTableDetail, type DbColumn, type DbDialect, type DbObjects, type DbTableDetail } from "./query-backend";
import { relKey, relsFromObjects, sqlComplete, type CompleteItem, type Rel } from "./sql-complete";

export const READ_MAX = 3;
export const WAIT_MS = 1500;
export const RETRY_MS = 10_000;

interface Conn {
  handle: number;
  lease: number;
}

/** 트리가 읽은 것 — 그 연결의 것만 받는다 */
export type CatalogNote = Conn &
  ({ kind: "schemas"; schemas: string[] } | { kind: "objects"; schema: string; objects: DbObjects } | { kind: "detail"; schema: string | null; name: string; detail: DbTableDetail });

export interface CompleteAnswer {
  from: number;
  items: CompleteItem[];
  /** 열이 필요한 표를 아직 다 못 읽었다 — 편집기가 다음 타자에 다시 묻는다 */
  partial: boolean;
}

export interface SqlCompleter {
  complete(text: string, pos: number, explicit: boolean): Promise<CompleteAnswer | null>;
  note(n: CatalogNote): void;
  /** 열 읽기가 없을 때 풀린다 — 실행을 보내기 전에 기다린다(서버 Busy 를 피해) */
  idle(): Promise<void>;
}

export function createSqlCompleter(o: {
  dialect: () => DbDialect;
  conn: () => Conn | null;
  canRead: () => boolean;
  onread?: (reading: boolean) => void;
  read?: (handle: number, lease: number, schema: string | null, table: string) => Promise<DbTableDetail>;
  now?: () => number;
}): SqlCompleter {
  const read = o.read ?? dbTableDetail;
  const now = o.now ?? Date.now;
  let connKey = "";
  let schemas: string[] = [];
  /** 스키마 → 그 스키마의 관계 */
  let relsBy = new Map<string, Rel[]>();
  let rels: Rel[] = [];
  /** 열 캐시 — 실패는 그 시각 */
  let cols = new Map<string, DbColumn[] | { failedAt: number }>();
  let inflight: Promise<void> | null = null;

  const keyOf = (c: Conn) => `${c.handle}:${c.lease}`;
  /** 지금 연결로 맞춘다 — 바뀌었으면 버린다. 연결이 없으면 `null` */
  function sync(): Conn | null {
    const c = o.conn();
    const k = c ? keyOf(c) : "";
    if (k !== connKey) {
      connKey = k;
      schemas = [];
      relsBy = new Map();
      rels = [];
      cols = new Map();
    }
    return c;
  }

  const known = (r: Rel): DbColumn[] | null => {
    const v = cols.get(relKey(o.dialect(), r));
    return Array.isArray(v) ? v : null;
  };
  const due = (r: Rel): boolean => {
    const v = cols.get(relKey(o.dialect(), r));
    return v === undefined || (!Array.isArray(v) && now() - v.failedAt >= RETRY_MS);
  };

  async function readAll(c: Conn, list: Rel[]): Promise<void> {
    const key = keyOf(c);
    o.onread?.(true);
    try {
      for (const r of list) {
        try {
          const d = await read(c.handle, c.lease, r.schema, r.name);
          if (connKey === key) cols.set(relKey(o.dialect(), r), d.columns.map((x) => ({ name: x.name, type: x.type })));
        } catch {
          if (connKey === key) cols.set(relKey(o.dialect(), r), { failedAt: now() });
        }
      }
    } finally {
      o.onread?.(false);
    }
  }

  /** 그 읽기를 기다린다 — 많아야 [`WAIT_MS`]. 끝났으면 참 */
  const settle = (job: Promise<void>) =>
    Promise.race([job.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), WAIT_MS))]);

  const plan = (text: string, pos: number, explicit: boolean) =>
    sqlComplete({ dialect: o.dialect(), text, pos, explicit, rels, schemas, columns: known });

  return {
    async complete(text, pos, explicit) {
      const c = sync();
      if (inflight) await settle(inflight);
      let p = plan(text, pos, explicit);
      if (!p || !c) return p && { from: p.from, items: p.items, partial: false };
      const want = p.missing.filter(due).slice(0, READ_MAX);
      if (want.length > 0 && !inflight && o.canRead()) {
        const job = readAll(c, want).finally(() => {
          if (inflight === job) inflight = null;
        });
        inflight = job;
        if (await settle(job)) p = plan(text, pos, explicit) ?? p;
      }
      return { from: p.from, items: p.items, partial: p.missing.some(due) };
    },
    note(n) {
      const c = sync();
      if (!c || keyOf(c) !== keyOf(n)) return;
      if (n.kind === "schemas") schemas = n.schemas;
      else if (n.kind === "objects") {
        relsBy.set(n.schema, relsFromObjects(n.schema, n.objects));
        rels = [...relsBy.values()].flat();
      } else cols.set(relKey(o.dialect(), { schema: n.schema, name: n.name }), n.detail.columns.map((x) => ({ name: x.name, type: x.type })));
    },
    idle: () => (inflight ? inflight.then(() => undefined) : Promise.resolve()),
  };
}
