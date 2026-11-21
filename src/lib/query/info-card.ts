/**
 * 쿼리 타일 머리줄 이름 카드의 줄. 값은 프런트가 이미 쥔 것뿐이고 **비밀번호는 없다**(연결 모양에 칸이 없다 — 볼트에만 산다).
 * 경유면 주소 줄은 그 호스트에서 본 주소다.
 */
import type { Tr } from "$lib/session";
import { DB_DEFAULT_HOST, DB_DEFAULT_PORT, DB_ENGINE_ICON, type DbConn, type DbEngine } from "$lib/db-conn";
import type { DbAiLevel } from "$lib/db-ai";
import { infoRow, type InfoCard, type InfoRow } from "$lib/session-info";
import type { QueryLive } from "$lib/app/query-live.svelte.js";

export interface QueryCardIn {
  /** 타일 이름 */
  name: string;
  /** 지워졌거나 아직 못 읽었으면 `null` */
  conn: DbConn | null;
  live: QueryLive | null;
  ai: DbAiLevel;
}

/** MySQL · MariaDB 는 방언이 하나라 서버 버전 글자로 가른다 */
export function queryEngine(conn: DbConn | null, live: QueryLive | null): DbEngine | null {
  if (live?.serverVersion?.startsWith("MariaDB")) return "mariadb";
  if (live?.state === "open" && live.dialect) return live.dialect;
  return conn?.engine ?? null;
}

export function queryCardIcon(conn: DbConn | null, live: QueryLive | null): string | null {
  const e = queryEngine(conn, live);
  return e ? DB_ENGINE_ICON[e] : null;
}

export function queryAddress(conn: DbConn | null): string {
  if (!conn) return "";
  if (conn.engine === "sqlite") return conn.path ?? "";
  const hostPort = `${conn.host || DB_DEFAULT_HOST}:${conn.port ?? DB_DEFAULT_PORT[conn.engine]}`;
  return conn.user ? `${conn.user}@${hostPort}` : hostPort;
}

export function queryInfoCard(c: QueryCardIn, tr: Tr): InfoCard {
  const { conn, live } = c;
  const rows: InfoRow[] = [];
  const push = (key: InfoRow["key"], value: string, tone: InfoRow["tone"] = "normal"): void => {
    rows.push(infoRow(key, value, tr, tone));
  };
  const state = live?.state ?? "connecting";
  if (state !== "open") {
    push("state", state === "closed" ? tr("pane.query.state.closed") : tr("pane.query.state.connecting"), state === "closed" ? "warn" : "normal");
  }
  const engine = queryEngine(conn, live);
  if (engine) push("engine", tr(`app.query.engine.${engine}` as "app.query.engine.sqlite"));
  if (state === "open" && live?.serverVersion) push("server", live.serverVersion);
  if (conn && conn.name !== c.name) push("conn", conn.name);
  if (conn?.via) push("jump", conn.via);
  if (conn?.database) push("database", conn.database);
  if (conn && conn.engine !== "sqlite") {
    push("tls", tr(`app.query.form.tls.${conn.tls_mode ?? "prefer"}` as "app.query.form.tls.prefer"));
  }
  if (state === "open" && live) {
    push(
      "mode",
      !live.writable
        ? tr("pane.query.readOnly")
        : live.autoCommit === undefined
          ? tr("pane.header.info.card.mode.write")
          : live.autoCommit
            ? tr("pane.header.info.card.mode.write.auto")
            : tr("pane.header.info.card.mode.write.manual"),
    );
  }
  if (c.ai !== "off") push("ai", tr(`pane.query.ask.level.${c.ai}` as "pane.query.ask.level.read"));
  return { rows, warnings: [] };
}
