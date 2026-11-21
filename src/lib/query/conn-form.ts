/**
 * DB 연결 폼의 순수 규칙(docs/log/2026-10-12-query-tile.md).
 *
 * - id 는 볼트 열쇠라 새 연결에서 한 번 만들고 이름 · 경유를 바꿔도 그대로 둔다 · 비밀번호 칸은 없다.
 * - 호스트 칸은 경유면 그 호스트에서 본 주소, 직접이면 이 PC 에서 본 주소다. SQLite 는 경유가 없다(원격 SQLite 미지원).
 * - 단일 진실은 백엔드(Rust `db::conns::validate_one`)다.
 */
import {
  DB_DEFAULT_HOST,
  DB_DEFAULT_PORT,
  DB_ENGINES,
  DB_NAME_MAX,
  DB_TLS_MODES,
  dbIdOk,
  newDbId,
  sameAlias,
  tlsCaRequired,
  tlsNeedsCa,
  type DbConn,
  type DbEngine,
  type DbTlsMode,
} from "$lib/db-conn";

export interface ConnRow {
  id: string;
  name: string;
  engine: DbEngine;
  /** 경유 호스트 별칭(SSH 터널) — `null` = 직접. SQLite 는 늘 `null` */
  via: string | null;
  path: string;
  host: string;
  port: number | null;
  portTouched: boolean;
  database: string;
  user: string;
  tlsMode: DbTlsMode;
  tlsCa: string;
  /** 독의 폴더 — 폼에 칸은 없고 그대로 옮긴다 */
  folder: string;
}

export function emptyConnRow(id: string = newDbId(), via: string | null = null, folder = ""): ConnRow {
  const v = via?.trim() || null;
  return {
    id,
    name: "",
    engine: v ? "postgres" : "sqlite",
    via: v,
    path: "",
    host: DB_DEFAULT_HOST,
    port: v ? DB_DEFAULT_PORT.postgres : null,
    portTouched: false,
    database: "",
    user: "",
    tlsMode: "prefer",
    tlsCa: "",
    folder,
  };
}

export function connRowOf(d: DbConn): ConnRow {
  const engine: DbEngine = DB_ENGINES.includes(d.engine) ? d.engine : "sqlite";
  return {
    id: d.id,
    name: d.name,
    engine,
    via: engine === "sqlite" ? null : d.via?.trim() || null,
    path: d.path ?? "",
    host: d.host ?? DB_DEFAULT_HOST,
    port: d.port ?? (engine === "sqlite" ? null : DB_DEFAULT_PORT[engine]),
    portTouched: d.port !== undefined,
    database: d.database ?? "",
    user: d.user ?? "",
    tlsMode: d.tls_mode && DB_TLS_MODES.includes(d.tls_mode) ? d.tls_mode : "prefer",
    tlsCa: d.tls_ca ?? "",
    folder: d.folder ?? "",
  };
}

export function withConnEngine(row: ConnRow, engine: DbEngine): ConnRow {
  if (engine === "sqlite") return { ...row, engine, via: null };
  const follow = !row.portTouched || row.port === null;
  return { ...row, engine, port: follow ? DB_DEFAULT_PORT[engine] : row.port };
}

export function withConnVia(row: ConnRow, via: string | null): ConnRow {
  if (row.engine === "sqlite") return { ...row, via: null };
  return { ...row, via: via?.trim() || null };
}

export function isLoopback(host: string): boolean {
  const h = host.trim();
  return h === "127.0.0.1" || h.toLowerCase() === "localhost" || h === "::1" || h === "[::1]";
}

/** Windows · POSIX 둘 다 본다(나중의 다른 OS 지원을 위해) */
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p) || p.startsWith("/");
}

export type ConnRowProblem = "id" | "name" | "name-long" | "path" | "path-relative" | "host" | "port" | "duplicate" | "ca-required";

/**
 * 경고만 하고 막지 않는다. `unverified` = 암호화만 하고 중간자 공격을 막지 못한다. 경유면 SSH 가 감싸므로 경고가 없다.
 */
export function directTlsWarning(row: Pick<ConnRow, "engine" | "host" | "tlsMode" | "via">): "plain" | "unverified" | null {
  if (row.engine === "sqlite" || row.via || row.host.trim() === "" || isLoopback(row.host)) return null;
  if (row.tlsMode === "disable") return "plain";
  return tlsNeedsCa(row.tlsMode) ? null : "unverified";
}

/** Rust `clean_folder` · 호스트 `normalizeGroupPath` 와 같은 꼴 */
const folderPath = (s: string): string =>
  s
    .split("/")
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .join("/");

const trimOr = (s: string): string | undefined => {
  const v = s.trim();
  return v === "" ? undefined : v;
};

/** 키 순서는 Rust 직렬화와 같다 */
export function connOfRow(row: ConnRow): { ok: true; conn: DbConn } | { ok: false; problem: ConnRowProblem } {
  if (!dbIdOk(row.id)) return { ok: false, problem: "id" };
  const name = row.name.trim();
  if (name === "") return { ok: false, problem: "name" };
  if ([...name].length > DB_NAME_MAX) return { ok: false, problem: "name-long" };
  const folder = folderPath(row.folder);
  if (row.engine === "sqlite") {
    const path = row.path.trim();
    if (path === "") return { ok: false, problem: "path" };
    if (!isAbsolutePath(path)) return { ok: false, problem: "path-relative" };
    const conn: DbConn = { id: row.id, name, engine: "sqlite", path };
    if (folder) conn.folder = folder;
    return { ok: true, conn };
  }
  const host = row.host.trim();
  if (host === "" || /\s/.test(host)) return { ok: false, problem: "host" };
  const port = row.port;
  if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, problem: "port" };
  // verify-ca 는 CA 파일만 믿는다(Rust `DbTlsMode::check_ca` 와 같은 규칙).
  if (tlsCaRequired(row.tlsMode) && row.tlsCa.trim() === "") return { ok: false, problem: "ca-required" };
  const conn: DbConn = { id: row.id, name, engine: row.engine };
  const via = row.via?.trim();
  if (via) conn.via = via;
  conn.host = host;
  conn.port = port;
  const database = trimOr(row.database);
  const user = trimOr(row.user);
  const ca = tlsNeedsCa(row.tlsMode) ? trimOr(row.tlsCa) : undefined;
  if (database) conn.database = database;
  if (user) conn.user = user;
  conn.tls_mode = row.tlsMode;
  if (ca) conn.tls_ca = ca;
  if (folder) conn.folder = folder;
  return { ok: true, conn };
}

/**
 * `db_conn_save` 는 통째로 쓰므로 목록 전체를 만든다. 이름 겹침은 같은 경유 안에서만 거절한다 — Rust 는 이름을 보지 않는다.
 */
export function upsertConn(list: readonly DbConn[], row: ConnRow): { ok: true; list: DbConn[] } | { ok: false; problem: ConnRowProblem } {
  const r = connOfRow(row);
  if (!r.ok) return r;
  const lower = r.conn.name.toLowerCase();
  const clash = list.some((d) => d.id !== r.conn.id && d.name.trim().toLowerCase() === lower && sameAlias(d.via, r.conn.via));
  if (clash) return { ok: false, problem: "duplicate" };
  const at = list.findIndex((d) => d.id === r.conn.id);
  const next = list.slice();
  if (at < 0) next.push(r.conn);
  else next[at] = r.conn;
  return { ok: true, list: next };
}

export function connTargetText(d: DbConn): string {
  if (d.engine === "sqlite") {
    const p = d.path ?? "";
    return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  }
  const at = `${d.host?.trim() || DB_DEFAULT_HOST}:${d.port ?? ""}`;
  return d.database ? `${at}/${d.database}` : at;
}
