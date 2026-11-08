/**
 * **쿼리 타일의 이름 카드** (10-14 사용자) — 위 띠에 있던 엔진 이름(호버하면 서버 버전 말풍선)을 빼고, 머리줄 **타일 이름**에
 * 얹으면 원격 · 로컬 터미널과 같은 판(`SessionInfoCard.svelte`)의 카드로 뜬다.
 *
 * ```text
 * [로고] 운영 DB  p3
 *        app@db.internal:5432
 * ─────────────────────────────
 * 엔진     PostgreSQL
 * 서버     PostgreSQL 16.2 on x86_64 …
 * 경유     bastion
 * DB       shop
 * TLS      CA 검증
 * 모드     읽기 전용
 * AI 권한  구조만(행은 볼 수 없음)
 * ```
 *
 * - 머리 주소 줄 = 원격 카드처럼 `사용자@주소:포트`(SQLite 는 파일 경로). 경유면 **그 호스트에서 본** 주소다.
 * - 값은 프런트가 이미 쥔 것뿐 — 연결 목록 사본(`db_conn_list`)과 타일의 지금(`app/query-live` — `db_open` 의 답). 새 서버 op 없음.
 * - **비밀번호는 없다** — 연결 모양에 칸이 없다(볼트에만 산다).
 * - 상태 줄은 연결됨이 아닐 때만(연결 중 · 끊김 — 끊김은 경고색). 서버 버전 · 모드는 연결됐을 때만.
 * - 연결 이름 줄은 머리 이름(타일 이름)과 다를 때만 — 같은 말이 겹치지 않게(로컬 카드의 AI 줄과 같은 판단).
 * - AI 권한 줄은 끔이 아닐 때만(3a).
 *
 * 순수하다 — 문구는 `tr` 로 받는다.
 */
import type { Tr } from "$lib/session";
import { DB_DEFAULT_HOST, DB_DEFAULT_PORT, DB_ENGINE_ICON, type DbConn, type DbEngine } from "$lib/db-conn";
import type { DbAiLevel } from "$lib/db-ai";
import { infoRow, type InfoCard, type InfoRow } from "$lib/session-info";
import type { QueryLive } from "$lib/app/query-live.svelte.js";

export interface QueryCardIn {
  /** 머리 이름(타일 이름) */
  name: string;
  /** 연결 목록 사본의 그 연결 — 지워졌거나 아직 못 읽었으면 `null` */
  conn: DbConn | null;
  /** 타일의 지금 — 아직 모르면 `null` */
  live: QueryLive | null;
  ai: DbAiLevel;
}

/** 실제 엔진 — MySQL · MariaDB 는 방언이 하나라 서버 버전 글자로 가른다(위 띠가 하던 그대로) */
export function queryEngine(conn: DbConn | null, live: QueryLive | null): DbEngine | null {
  if (live?.serverVersion?.startsWith("MariaDB")) return "mariadb";
  if (live?.state === "open" && live.dialect) return live.dialect;
  return conn?.engine ?? null;
}

/** 엔진 로고(`HostIcon` 값) — 모르면 `null` */
export function queryCardIcon(conn: DbConn | null, live: QueryLive | null): string | null {
  const e = queryEngine(conn, live);
  return e ? DB_ENGINE_ICON[e] : null;
}

/** 머리 주소 줄 — `사용자@주소:포트` · SQLite 는 파일 경로 · 모르면 빈 글자 */
export function queryAddress(conn: DbConn | null): string {
  if (!conn) return "";
  if (conn.engine === "sqlite") return conn.path ?? "";
  const hostPort = `${conn.host || DB_DEFAULT_HOST}:${conn.port ?? DB_DEFAULT_PORT[conn.engine]}`;
  return conn.user ? `${conn.user}@${hostPort}` : hostPort;
}

/** 카드 몸통 */
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
