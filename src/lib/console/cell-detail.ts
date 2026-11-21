/** 세션 판 칸 말풍선의 둘째 줄(세션 없는 타일의 위치) · 셋째 줄(연결 칩) — 룬 · DOM 없음(node vitest) */

import type { DbConn } from "$lib/db-conn";
import type { PaneSpec, Tr } from "$lib/session";
import type { SessionCard } from "./session-cards";

/** 말풍선 폭(300px · 작은 글자)에 들어가는 글자 수 */
export const DETAIL_MAX = 48;

/** 앞을 줄인다 — 끝(파일 · 폴더 이름)이 그 타일의 이름과 이어진다 */
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

/** SFTP · 원격 문서는 원본 터미널의 세션을 빌려 쓴다 — 원본 카드가 없거나(원본 타일을 닫음) 끊김이면 끊김 */
export type CellLink = { state: "open" | "connecting" | "closed"; writable: boolean };

export interface LinkSources {
  queryLive: (paneId: string) => { state: "connecting" | "open" | "closed"; writable: boolean } | null;
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
