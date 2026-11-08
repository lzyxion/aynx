/**
 * **독 DB 칸의 순수 규칙** — 줄 짓기 · 정렬 · 검색 · 표시 글자 · 열린 곳 판정 (2026-10-12, docs/log/2026-10-12-query-tile.md).
 *
 * 데이터는 연결 목록 하나다(`db-connections.json` — 10-13 저장 하나로, 사본은 `app/db-conns`). 이 모듈은 연결 줄을 짓고 **이름순**으로
 * 세운다 — 10-13 사용자 요청으로 `SSH 경유`(호스트별) · `내 PC / 직접` 묶음을 걷었고, 10-15 부터 그 위에 사람이 만든 **폴더**가 선다
 * (트리는 `db-folders.ts` 의 `dbDockTree`). 엔진은 줄 앞
 * 아이콘(`DB_ENGINE_ICON`)이, 경유는 SSH 칩이 말한다. 줄의 뒷글자는 주소가 아니라 **마지막 접속**(`2분 전` — 그리는 쪽이 `db-history` 로 짓는다 · 10-20)이고 주소는 말풍선이다. 상태(볼트의 저장됨 · 열린 타일)는
 * 부르는 쪽(`app/db-dock.svelte.ts`)이 넘긴다 — vitest 는 `.svelte.ts` 를 들여올 수 없다.
 */
import { type DbConn, type DbEngine } from "$lib/db-conn";
import { connTargetText } from "$lib/query/conn-form";
import type { OpenLocation } from "$lib/project-locations";
import { compareNames } from "$lib/list-order";

/** 연결 한 줄 — 경유(`via` = 호스트 별칭)든 직접(`via` = `null`)이든 같은 모양 */
export interface DbDockConn {
  kind: "conn";
  key: string;
  via: string | null;
  id: string;
  name: string;
  engine: DbEngine;
  /** 말풍선 — SQLite 는 온전한 경로, 그 밖은 `host:port/db` 전부(줄에는 주소가 없다 — 여기서만 보인다) */
  title: string;
  /** 쿼리 타일 머리줄의 첫 이름(`QuerySpec.name`) — 다른 여는 길과 같은 꼴("이름 · 호스트" · "이름") */
  tabName: string;
}

/** 연결의 열쇠 — 줄 키 · 볼트 표식이 같은 글자를 쓴다(id 가 파일 안에서 하나다) */
export function dbConnKey(id: string): string {
  return `conn:${id}`;
}

/** 연결 하나 → 독의 줄 — 독 DB 칸과 즐겨찾기 칸(`favorites.ts` 의 `resolveFavorites` 에 넘기는 목록)이 같은 꼴을 쓴다 */
export function dbDockConn(d: DbConn): DbDockConn {
  const via = d.via?.trim() || null;
  return {
    kind: "conn",
    key: dbConnKey(d.id),
    via,
    id: d.id,
    name: d.name,
    engine: d.engine,
    title: d.engine === "sqlite" ? (d.path ?? connTargetText(d)) : connTargetText(d),
    tabName: via ? `${d.name} · ${via}` : d.name,
  };
}

/** 이름순(`compareNames` — 호스트 · 프로젝트 칸과 같은 비교) — 같은 이름이면 직접이 먼저, 그다음 경유 별칭순 */
function byName(a: DbDockConn, b: DbDockConn): number {
  return compareNames(a.name, b.name) || compareNames(a.via ?? "", b.via ?? "");
}

/**
 * **그릴 줄들** — 묶음 없이 연결만, 이름순([`byName`]).
 *
 * 검색(`query`)은 연결 이름 · 온전한 주소(DB 이름 포함) · 엔진, 그리고 **경유 별칭**을 훑는다 — 별칭이 맞으면 그 호스트의
 * 연결이 모두 선다(호스트 칸의 "web 을 치면 web-01 이 선다" 와 같은 손).
 */
export function dbDockRows(
  conns: readonly DbConn[],
  query: string,
  match: (query: string, text: string) => boolean,
): DbDockConn[] {
  const q = query.trim();
  const hit = (c: DbDockConn) =>
    q === "" || match(q, `${c.name} ${c.title} ${c.engine}`) || (c.via !== null && match(q, c.via));
  return conns.map(dbDockConn).filter(hit).sort(byName);
}

// ---------------------------------------------------------------------------
// 열린 곳 — 쿼리 타일이 그 연결을 들고 있는 자리
// ---------------------------------------------------------------------------

/** 열린 곳 하나 — 프로젝트 칸과 같은 `OpenLocation` 에 연결 id 를 더한 것 */
export type DbOpenLocation = OpenLocation & { connId: string };

/**
 * 타일 하나의 자리 — 쿼리 타일이면 그 연결(`host` · `folder` 는 없다 — 연결은 id 하나로 가린다), 아니면 `null`. 저장본 잎
 * (`saved:` 타일)도 같다.
 */
export function queryPlace(pane: { kind: string; query?: { connId: string } | null }): { host: null; folder: null; connId: string } | null {
  if (pane.kind !== "query" || !pane.query?.connId) return null;
  return { host: null, folder: null, connId: pane.query.connId };
}

/** 그 연결의 열린 곳들 — 최근에 본 것이 앞이다 */
export function dbConnLocations(locations: readonly DbOpenLocation[], id: string): DbOpenLocation[] {
  return locations.filter((l) => l.connId === id).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0));
}

/**
 * **줄을 열 때 갈 곳** — 지금 워크스페이스에 그 연결의 쿼리 타일이 있으면 가장 최근에 본 그 타일(그리로 간다),
 * 없으면 `null`(지금 탭에 새로 연다). 프로젝트 칸의 Enter(`projectOpenPlan` — 있으면 그리로, 없으면 새로)와 같은 규칙이다.
 * 다른 워크스페이스에만 있으면 새로 연다 — 거기로 가는 길은 우클릭 메뉴의 "‹워크스페이스›에서 보기" 다.
 */
export function dbFocusTarget(locations: readonly DbOpenLocation[], currentWorkspaceId: string | null): DbOpenLocation | null {
  if (currentWorkspaceId === null) return null;
  const here = locations
    .filter((l) => l.workspaceId === currentWorkspaceId)
    .sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0));
  return here[0] ?? null;
}

/** 다른 워크스페이스마다 그 연결이 열린 곳 하나(가장 최근) — 메뉴의 "‹이름›에서 보기" 줄들 */
export function dbElsewhere(
  locations: readonly DbOpenLocation[],
  currentWorkspaceId: string | null,
  workspaces: readonly { id: string; name: string }[],
): { name: string; location: DbOpenLocation }[] {
  return workspaces
    .filter((w) => w.id !== currentWorkspaceId)
    .flatMap((w) => {
      const at = locations
        .filter((l) => l.workspaceId === w.id)
        .sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))[0];
      return at ? [{ name: w.name, location: at }] : [];
    });
}
