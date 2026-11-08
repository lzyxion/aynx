// **쿼리 타일의 지금 연결 상태 사본** — 머리줄 이름 카드(`PaneHeader` → `queryInfoCard`)가 읽는다(10-14 사용자: 엔진 · 서버 버전을
// 위 띠에서 빼고 이름 카드로 옮겼다). 쓰는 쪽은 `QueryView` 하나다 — 이미 쥔 값(`db_open` 의 답 · 쓰기 · 자동 커밋)을 그대로 비춘다.
// 새 서버 op 는 없다. 비밀은 없다(비밀번호는 애초에 프런트에 없다).
//
// 화면용 사본이라 저장하지 않는다(배치 파일 · 설정 어디에도 적지 않는다). 타일이 사라지면(`QueryView` 의 onDestroy) 칸을 걷는다.
import type { DbDialect } from "$lib/query/query-backend";

/** 한 타일의 지금 — `open` 일 때만 서버 버전 · 모드가 있다 */
export interface QueryLive {
  state: "connecting" | "open" | "closed";
  /** 서버가 알려 준 버전 글자(`MariaDB 11.8.9` · `PostgreSQL 16.2 …`) */
  serverVersion: string | null;
  dialect: DbDialect | null;
  writable: boolean;
  /** 자동 커밋(판 13 — 그보다 오래된 서버면 `undefined`) */
  autoCommit: boolean | undefined;
}

let live = $state<Record<string, QueryLive>>({});

/** 이 타일의 지금(모르면 `null`) */
export function queryLiveOf(paneId: string): QueryLive | null {
  return live[paneId] ?? null;
}

/** 지금을 적는다 — `null` 이면 칸을 걷는다 */
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
