/** 독 DB 칸의 순수 규칙 — 상태(볼트 · 열린 타일)는 부르는 쪽이 넘긴다(vitest 는 `.svelte.ts` 를 들여올 수 없다). */
import { type DbConn, type DbEngine } from "$lib/db-conn";
import { connTargetText } from "$lib/query/conn-form";
import type { OpenLocation } from "$lib/project-locations";
import { compareNames } from "$lib/list-order";

export interface DbDockConn {
  kind: "conn";
  key: string;
  via: string | null;
  id: string;
  name: string;
  engine: DbEngine;
  /** 말풍선 — 줄에는 주소가 없다 */
  title: string;
  /** 쿼리 타일 머리줄의 첫 이름 — 다른 여는 길과 같은 꼴이어야 한다 */
  tabName: string;
}

/** 줄 키 · 볼트 표식이 같은 글자를 쓴다 */
export function dbConnKey(id: string): string {
  return `conn:${id}`;
}

/** 독 DB 칸과 즐겨찾기 칸이 같은 꼴을 쓴다 */
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

function byName(a: DbDockConn, b: DbDockConn): number {
  return compareNames(a.name, b.name) || compareNames(a.via ?? "", b.via ?? "");
}

/** 검색은 경유 별칭도 훑는다 — 별칭이 맞으면 그 호스트의 연결이 모두 선다 */
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

export type DbOpenLocation = OpenLocation & { connId: string };

/** 연결은 id 하나로 가린다 — `host` · `folder` 는 없다 */
export function queryPlace(pane: { kind: string; query?: { connId: string } | null }): { host: null; folder: null; connId: string } | null {
  if (pane.kind !== "query" || !pane.query?.connId) return null;
  return { host: null, folder: null, connId: pane.query.connId };
}

export function dbConnLocations(locations: readonly DbOpenLocation[], id: string): DbOpenLocation[] {
  return locations.filter((l) => l.connId === id).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0));
}

/** 다른 워크스페이스에만 있으면 `null`(새로 연다) — 거기로 가는 길은 우클릭 메뉴다. 프로젝트 칸의 Enter 와 같은 규칙 */
export function dbFocusTarget(locations: readonly DbOpenLocation[], currentWorkspaceId: string | null): DbOpenLocation | null {
  if (currentWorkspaceId === null) return null;
  const here = locations
    .filter((l) => l.workspaceId === currentWorkspaceId)
    .sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0));
  return here[0] ?? null;
}

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
