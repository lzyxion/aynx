/**
 * 서버는 연결당 작업 하나만 받는다(Busy) — 열 읽기는 부르는 쪽의 `canRead` 가 참일 때만 보내고, 읽는 동안 `onread` 로 알려
 * 트리 · 데이터 탭이 기다리게 한다. 연결이 바뀌면(다시 열기 · 재부착) 모은 것을 버린다.
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

export type CatalogNote = Conn &
  ({ kind: "schemas"; schemas: string[] } | { kind: "objects"; schema: string; objects: DbObjects } | { kind: "detail"; schema: string | null; name: string; detail: DbTableDetail });

export interface CompleteAnswer {
  from: number;
  items: CompleteItem[];
  partial: boolean;
}

export interface SqlCompleter {
  complete(text: string, pos: number, explicit: boolean): Promise<CompleteAnswer | null>;
  note(n: CatalogNote): void;
  /** 실행을 보내기 전에 기다린다(서버 Busy 를 피해) */
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
  let relsBy = new Map<string, Rel[]>();
  let rels: Rel[] = [];
  let cols = new Map<string, DbColumn[] | { failedAt: number }>();
  let inflight: Promise<void> | null = null;

  const keyOf = (c: Conn) => `${c.handle}:${c.lease}`;
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
