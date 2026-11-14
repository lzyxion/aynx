/**
 * **세션 판 칸 말풍선의 둘째 줄 — 세션 없는 타일의 위치**(2026-11-03). 세션 칸은 명령 · 에이전트 줄이 그 자리에 서고,
 * 세션이 없는 타일은 이름(`paneName` — 폴더 · 파일 이름 · 호스트처럼 짧게 줄인 것)이 못 담는 주소를 여기서 말한다.
 *
 * | 타일 | 둘째 줄 |
 * | --- | --- |
 * | `localfs` | 보고 있는 폴더의 전체 경로("내 PC" 합성 루트면 없음) |
 * | `sftp` | 보고 있는 원격 경로 |
 * | `doc` · `image` | 파일 전체 경로 — 원격이면 `별칭:경로` |
 * | `diff` | 비교 범위(브랜치 전체 · 커밋 · 커밋 안 한 변경 · 두 커밋 사이) + 고른 파일 |
 * | `query` | 엔진 · 데이터베이스 · 경유 호스트 |
 * | 그 밖(브랜치 · 시작 · 오케스트레이션 · 세션 타일) | 없음 |
 *
 * 셋째 줄(연결 칩)은 [`cellLink`] — DB · 원격 파일만.
 *
 * 재료는 타일 명세가 이미 든 값과 DB 연결 목록 · 쿼리 상태 · 원본 카드 사본뿐이다(새 조회 없음). 룬도 DOM 도 없다 — node vitest 로 바로 테스트한다.
 */

import type { DbConn } from "$lib/db-conn";
import type { PaneSpec, Tr } from "$lib/session";
import type { SessionCard } from "./session-cards";

/** 말풍선 폭(300px · 작은 글자)에 들어가는 글자 수 — 넘치면 앞을 `…` 로 줄여 끝(파일 · 폴더 이름)을 남긴다 */
export const DETAIL_MAX = 48;

/** 긴 경로는 앞을 줄인다 — 끝이 그 타일의 이름과 이어지는 쪽이라 */
export function clipStart(s: string, max = DETAIL_MAX): string {
  return s.length <= max ? s : `…${s.slice(s.length - (max - 1))}`;
}

const ENGINE_KEY = {
  sqlite: "app.query.engine.sqlite",
  postgres: "app.query.engine.postgres",
  mysql: "app.query.engine.mysql",
  mariadb: "app.query.engine.mariadb",
} as const;

function short(hash: string | undefined): string {
  return (hash ?? "").trim().slice(0, 7);
}

function diffDetail(pane: PaneSpec, tr: Tr): string | null {
  const d = pane.diff;
  if (!d) return null;
  let scope: string | null = null;
  if (d.scope === "branch") scope = tr("app.sheet.detail.diff.branch");
  else if (d.scope === "wip") scope = tr("app.sheet.detail.diff.wip");
  else if (d.scope === "commit" && short(d.commit)) scope = tr("app.sheet.detail.diff.commit", { hash: short(d.commit) });
  else if (d.scope === "range" && short(d.base) && short(d.tip))
    scope = tr("app.sheet.detail.diff.range", { base: short(d.base), tip: short(d.tip) });
  const file = d.file?.trim();
  const parts = [scope, file ? clipStart(file, DETAIL_MAX - (scope?.length ?? 0) - 3) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function queryDetail(conn: DbConn | null, tr: Tr): string | null {
  if (!conn) return null;
  const parts = [tr(ENGINE_KEY[conn.engine])];
  const db = conn.engine === "sqlite" ? conn.path?.trim() : conn.database?.trim();
  if (db) parts.push(conn.engine === "sqlite" ? clipStart(db, 32) : db);
  const via = conn.via?.trim();
  if (via) parts.push(tr("app.sheet.detail.db.via", { host: via }));
  return parts.join(" · ");
}

/**
 * **연결이 있는 세션 없는 타일의 연결 상태**(2026-11-03) — DB(쿼리 타일)와 원격 파일(SFTP · 원격 문서).
 *
 * - 쿼리 타일: 타일이 비추는 사본(`app/query-live` — `QueryView` 가 쓴다)의 `state` · 쓰기 켬. 사본이 없으면(아직 안 그려짐) `null`.
 * - SFTP · 원격 문서: 자기 세션이 없고 **원본 터미널의 세션을 빌려 쓴다**(`sourcePaneId`). 원본 카드가 없거나(원본 타일을 닫음)
 *   끊김이면 끊김, 그 밖이면 연결됨.
 * - 그 밖(로컬 파일 · 로컬 문서 · diff · 브랜치 …)은 연결이 없다 — `null`.
 */
export type CellLink = { state: "open" | "connecting" | "closed"; writable: boolean };

export interface LinkSources {
  /** 쿼리 타일의 지금(`queryLiveOf`) */
  queryLive: (paneId: string) => { state: "connecting" | "open" | "closed"; writable: boolean } | null;
  /** 원본 터미널 타일의 카드 상태 — 판에 카드가 없으면 `null` */
  sourceState: (paneId: string) => SessionCard["state"] | null;
}

export function cellLink(pane: PaneSpec, src: LinkSources): CellLink | null {
  if (pane.kind === "query") {
    const live = src.queryLive(pane.id);
    return live ? { state: live.state, writable: live.state === "open" && live.writable } : null;
  }
  const remote = pane.kind === "sftp" || ((pane.kind === "doc" || pane.kind === "image") && !!pane.sourcePaneId);
  if (!remote) return null;
  const s = pane.sourcePaneId ? src.sourceState(pane.sourcePaneId) : null;
  return { state: s === null || s === "off" ? "closed" : "open", writable: false };
}

/**
 * 칸 둘째 줄 — 없으면 `null`(말풍선은 첫 줄만). `connOf` 는 쿼리 타일의 연결 id → 연결(부르는 쪽이 `findDbConn` 을 넘긴다).
 */
export function cellDetail(pane: PaneSpec, tr: Tr, connOf: (id: string) => DbConn | null): string | null {
  const path = pane.path?.trim() ?? "";
  switch (pane.kind) {
    case "localfs":
    case "sftp":
      return path ? clipStart(path) : null;
    case "doc":
    case "image": {
      if (!path) return null;
      const alias = pane.alias?.trim();
      return clipStart(alias ? `${alias}:${path}` : path);
    }
    case "diff":
      return diffDetail(pane, tr);
    case "query":
      return pane.query?.connId ? queryDetail(connOf(pane.query.connId), tr) : null;
    default:
      return null;
  }
}
