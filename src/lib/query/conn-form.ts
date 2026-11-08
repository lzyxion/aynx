/**
 * **DB 연결 폼의 순수 규칙** — 독 DB 칸의 [새 DB 연결] · 편집과 팔레트 `>open-db` 고르기 모달이 함께 쓰는 폼 하나(쿼리 타일,
 * 10-13 저장 하나로 — docs/log/2026-10-12-query-tile.md).
 *
 * - id 는 볼트 열쇠라 새 연결에서 한 번 만들고([`newDbId`]) 이름 · 경유를 바꿔도 그대로 둔다 · 손대지 않은 포트는 엔진을 따라간다 ·
 *   검증 모드가 아니면 CA 칸을 버린다 · 비밀번호 칸은 없다.
 * - **경유**(`via`): `null` = 직접(이 PC 에서 바로), 호스트 별칭 = 그 호스트로 SSH 터널. 호스트 칸은 경유면 **그 호스트에서 본**
 *   주소(기본 localhost), 직접이면 이 PC 에서 본 주소. **SQLite 는 경유가 없다**(원격 SQLite 미지원 — 엔진을 SQLite 로 바꾸면 경유가
 *   지워지고 저장 꼴에도 실리지 않는다).
 * - 직접 + 이 PC 밖 + 인증서를 확인하지 않는 TLS 모드면 폼이 경고한다([`directTlsWarning`] — 막지는 않는다). 경유면 경고가 없다
 *   (SSH 가 감싼다). 단일 진실은 백엔드(Rust `db::conns::validate_one` — 제어 문자 등은 거기서 걸린다). 문구는 부르는 쪽이
 *   갈래([`ConnRowProblem`])로 만든다.
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

/** 폼이 들고 있는 한 줄 */
export interface ConnRow {
  id: string;
  name: string;
  engine: DbEngine;
  /** 경유 호스트 별칭 — `null` = 직접. SQLite 는 늘 `null` */
  via: string | null;
  path: string;
  host: string;
  port: number | null;
  portTouched: boolean;
  database: string;
  user: string;
  tlsMode: DbTlsMode;
  tlsCa: string;
  /** 독의 폴더 — 폼에 칸은 없고 그대로 옮긴다(새로 만들 때는 독 폴더 메뉴의 "새 DB 연결" 이 미리 정한다) */
  folder: string;
}

/** 새 연결 — 경유를 미리 고르면(호스트 우클릭 "DB 연결 추가…") PostgreSQL 로, 아니면 SQLite 로 시작한다 */
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

/** 파일의 줄 → 폼의 줄 */
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

/** 엔진을 고른다 — 손대지 않았거나 빈 포트는 그 엔진의 기본 포트로 · SQLite 는 포트도 경유도 없다 */
export function withConnEngine(row: ConnRow, engine: DbEngine): ConnRow {
  if (engine === "sqlite") return { ...row, engine, via: null };
  const follow = !row.portTouched || row.port === null;
  return { ...row, engine, port: follow ? DB_DEFAULT_PORT[engine] : row.port };
}

/** 경유를 고른다(`null` = 직접) — SQLite 는 경유가 없어 그대로 둔다 */
export function withConnVia(row: ConnRow, via: string | null): ConnRow {
  if (row.engine === "sqlite") return { ...row, via: null };
  return { ...row, via: via?.trim() || null };
}

/** 루프백 주소인가 — 경고 판정용(`127.0.0.1` · `localhost` · `::1`) */
export function isLoopback(host: string): boolean {
  const h = host.trim();
  return h === "127.0.0.1" || h.toLowerCase() === "localhost" || h === "::1" || h === "[::1]";
}

/** 절대 경로인가 — Windows(`C:\` · `C:/` · `\\서버`) 와 POSIX(`/`) 둘 다(전 OS 목표) */
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p) || p.startsWith("/");
}

export type ConnRowProblem = "id" | "name" | "name-long" | "path" | "path-relative" | "host" | "port" | "duplicate" | "ca-required";

/**
 * TLS 경고 — **직접** 연결이 이 PC 밖(루프백 아님)인데 서버 인증서를 확인하지 않는 모드면 갈래 하나. `plain` = 끔(암호화 안 함) ·
 * `unverified` = 가능하면 사용 · 필수(암호화만 — 중간자 공격을 막지 못한다). 경유(SSH 가 감싼다) · 검증 모드 · 루프백 · SQLite 는 `null`.
 */
export function directTlsWarning(row: Pick<ConnRow, "engine" | "host" | "tlsMode" | "via">): "plain" | "unverified" | null {
  if (row.engine === "sqlite" || row.via || row.host.trim() === "" || isLoopback(row.host)) return null;
  if (row.tlsMode === "disable") return "plain";
  return tlsNeedsCa(row.tlsMode) ? null : "unverified";
}

/** 폴더 경로 다듬기 — 조각마다 공백을 떼고 빈 조각을 버린다(Rust `clean_folder` · 호스트 `normalizeGroupPath` 와 같은 꼴) */
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

/** 폼의 줄 → 파일의 줄(다듬기 포함 · 키 순서는 Rust 직렬화와 같다). 틀리면 갈래 */
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
 * 목록에 한 줄을 넣거나(같은 id 면) 바꾼다 — 저장 전 목록 전체를 만든다(`db_conn_save` 는 통째로 쓴다).
 * 이름이 **같은 경유 안에서** 다른 줄과 겹치면 `duplicate`(사람이 고를 때 헷갈린다 — Rust 는 이름을 보지 않는다). 다른 호스트를
 * 거치는 같은 이름("prod")은 받는다(독 · 모달이 호스트로 묶어 보인다).
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

/** 목록 줄의 둘째 글자 — SQLite 는 파일 이름(마지막 경로 조각), 그 밖은 `host:port/db` */
export function connTargetText(d: DbConn): string {
  if (d.engine === "sqlite") {
    const p = d.path ?? "";
    return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  }
  const at = `${d.host?.trim() || DB_DEFAULT_HOST}:${d.port ?? ""}`;
  return d.database ? `${at}/${d.database}` : at;
}
