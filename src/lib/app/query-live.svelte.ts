// 쿼리 타일의 지금 연결 상태 사본 — 화면용이라 저장하지 않는다.
import type { DbDialect } from "$lib/query/query-backend";

export interface QueryLive {
  state: "connecting" | "open" | "closed";
  serverVersion: string | null;
  dialect: DbDialect | null;
  writable: boolean;
  /** 판 13 보다 오래된 서버면 `undefined` */
  autoCommit: boolean | undefined;
}

let live = $state<Record<string, QueryLive>>({});

export function queryLiveOf(paneId: string): QueryLive | null {
  return live[paneId] ?? null;
}

export function noteQueryLive(paneId: string, v: QueryLive | null): void {
  if (v === null) {
    if (!(paneId in live)) return;
    const next = { ...live };
    delete next[paneId];
    live = next;
    return;
  }
  const o = live[paneId];
  if (
    o &&
    o.state === v.state &&
    o.serverVersion === v.serverVersion &&
    o.dialect === v.dialect &&
    o.writable === v.writable &&
    o.autoCommit === v.autoCommit
  )
    return;
  live = { ...live, [paneId]: v };
}
