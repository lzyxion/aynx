/**
 * DB 연결의 모양과 바닥 규칙(순수). 연결은 `db-connections.json` 하나에 산다(Rust `db::conns::DbConn` 와 1:1, snake_case).
 * - `id` 는 볼트 열쇠다(볼트 `db_password` 의 대상) — 한 번 만들고 이름 · 경유를 바꿔도 그대로 둔다.
 * - 비밀번호 칸은 없다 — 볼트에만 산다.
 */

/** SQLite 는 직접만 — Rust 가 경유를 거절한다 */
export type DbEngine = "sqlite" | "postgres" | "mysql" | "mariadb";
export type NetEngine = Exclude<DbEngine, "sqlite">;

/** libpq 이름 그대로 */
export type DbTlsMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

/** 빈 칸은 파일에도 적히지 않는다 */
export interface DbConn {
  id: string;
  name: string;
  engine: DbEngine;
  /** 경유 호스트 별칭 — 없으면 직접 */
  via?: string;
  path?: string;
  /** 경유면 그 호스트에서 본 주소 */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  tls_mode?: DbTlsMode;
  tls_ca?: string;
  /** 독의 폴더 — 접속 · AI 권한 신원과 무관하다 */
  folder?: string;
}

export const DB_ENGINES: readonly DbEngine[] = ["sqlite", "postgres", "mysql", "mariadb"];
export const DB_TLS_MODES: readonly DbTlsMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

export const DB_DEFAULT_PORT: Readonly<Record<NetEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
};

/** 본 번들의 큐레이션 아이콘이라 logos 전체(7MB)를 받지 않는다 */
export const DB_ENGINE_ICON: Readonly<Record<DbEngine, string>> = {
  postgres: "svg:postgres",
  mysql: "svg:mysql",
  mariadb: "svg:mariadb",
  sqlite: "svg:sqlite",
};

/** Rust `CONNS_MAX` 와 같다 */
export const DB_CONNS_MAX = 64;
/** Rust `NAME_MAX` 와 같다 */
export const DB_NAME_MAX = 64;

/** 경유면 터널 끝에서 본 localhost */
export const DB_DEFAULT_HOST = "localhost";

export const DB_ID_LENGTH = 12;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Rust `vault::db_conn_id_ok` 와 같은 모양 규칙 */
export function dbIdOk(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,32}$/.test(id);
}

/** 248 이상은 버린다 — 나머지를 그대로 쓰면 앞 글자들이 더 자주 나온다(256 = 62×4 + 8). `fill` 은 시험이 주입한다 */
export function newDbId(fill: (buf: Uint8Array) => void = (buf) => crypto.getRandomValues(buf)): string {
  let out = "";
  const buf = new Uint8Array(DB_ID_LENGTH * 2);
  while (out.length < DB_ID_LENGTH) {
    fill(buf);
    for (const b of buf) {
      if (b >= 248) continue;
      out += ID_ALPHABET[b % 62];
      if (out.length === DB_ID_LENGTH) break;
    }
  }
  return out;
}

/** 서버 인증서를 실제로 검증하는 둘뿐이다 */
export function tlsNeedsCa(mode: DbTlsMode): boolean {
  return mode === "verify-ca" || mode === "verify-full";
}

/** Rust `DbTlsMode::check_ca` 와 같은 규칙 — `verify-ca` 에 공개 CA 를 쓰면 이름 무시라 사실상 검증이 없다 */
export function tlsCaRequired(mode: DbTlsMode): boolean {
  return mode === "verify-ca";
}

export function tlsUnverified(mode: DbTlsMode): boolean {
  return mode === "prefer" || mode === "require";
}

/** Rust `db::conns::same_alias` 와 같은 눈 */
export function sameAlias(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function connsVia(conns: readonly DbConn[], host: string): DbConn[] {
  if (host.trim() === "") return [];
  return conns.filter((d) => d.via !== undefined && sameAlias(d.via, host));
}

/** 못 찾은 id 는 표에 없다 — 부르는 쪽이 id 그대로 보인다 */
export function dbVaultLabels(conns: readonly DbConn[], direct: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of conns) {
    if (!out.has(d.id)) out.set(d.id, `${d.via?.trim() || direct} · ${d.name}`);
  }
  return out;
}

/** 겹침은 같은 경유 안에서만 본다 — 폼 저장의 중복 검사(`upsertConn`)와 같은 눈이라 그 검사에 걸리지 않는다 */
export function nextDbCopyName(conns: readonly DbConn[], name: string, via: string | undefined): string {
  const used = new Set(conns.filter((d) => sameAlias(d.via, via)).map((d) => d.name.trim().toLowerCase()));
  const base = name.trim();
  const fit = (tail: string) => {
    const room = DB_NAME_MAX - [...tail].length;
    return [...base].slice(0, Math.max(0, room)).join("").trimEnd() + tail;
  };
  let out = fit("-copy");
  for (let n = 2; used.has(out.toLowerCase()); n++) out = fit(`-copy-${n}`);
  return out;
}

/** 비밀번호는 볼트에 원본 `id` 로만 있어 따라가지 않는다 — 복제본은 처음 열 때 묻는다 */
export function duplicateConnIn(
  conns: readonly DbConn[],
  id: string,
  newId: string,
): { list: DbConn[]; copy: DbConn } | null {
  const src = conns.find((d) => d.id === id);
  if (!src) return null;
  const copy: DbConn = { ...src, id: newId, name: nextDbCopyName(conns, src.name, src.via) };
  return { list: [...conns, copy], copy };
}
