/**
 * **DB 연결의 모양과 바닥 규칙** — 순수한 속(쿼리 타일, docs/log/2026-10-12-query-tile.md).
 *
 * 연결은 모두 앱 파일 하나 `db-connections.json` 에 산다(Rust `db::conns::DbConn` 와 1:1, snake_case — 10-13 사용자 결정으로
 * 예전 `sessions.toml` 호스트 블록 `dbs` 와 `db-local.json` 을 합쳤다). `via` = 경유 호스트 별칭(SSH 터널) · 없으면 직접.
 * 이 파일은 룬도 i18n 도 들이지 않는다 — 폼의 규칙은 `$lib/query/conn-form`, 문구는 부르는 쪽.
 *
 * 지키는 것:
 * - **`id` 는 볼트 열쇠다**(볼트 `db_password` 의 대상). 새 연결에서 한 번 만들고([`newDbId`]) 이름 · 경유를 바꿔도 그대로 둔다.
 * - **비밀번호 칸은 없다** — 볼트에만 산다. 담는 길은 접속 모달의 "이 앱에 저장" 하나다(SSH·DB 공통).
 */

/** DB 엔진 — SQLite 는 직접만(원격 SQLite 미지원 — Rust 가 경유를 거절한다) */
export type DbEngine = "sqlite" | "postgres" | "mysql" | "mariadb";
/** 네트워크 엔진(호스트 · 포트 · TLS 가 있는 셋) */
export type NetEngine = Exclude<DbEngine, "sqlite">;

/** TLS 모드 — libpq 이름 그대로. 기본은 `prefer` */
export type DbTlsMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

/** 연결 하나 — Rust `db::conns::DbConn`(snake_case, **비밀번호 칸 없음**). 빈 칸은 없다(파일에도 적히지 않는다) */
export interface DbConn {
  id: string;
  name: string;
  engine: DbEngine;
  /** 경유 호스트 별칭(`~/.ssh/config`) — 없으면 직접 */
  via?: string;
  /** SQLite 파일(절대 경로) */
  path?: string;
  /** DB 주소 — 경유면 **그 호스트에서 본** 주소 */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  tls_mode?: DbTlsMode;
  tls_ca?: string;
  /** 독의 폴더(`"운영/웹"` — 호스트의 그룹과 같은 경로 글자) — 없으면 최상위. 접속 · AI 권한 신원과 무관하다(10-15) */
  folder?: string;
}

/** 고르개 순서 — SQLite 가 맨 앞(파일 하나로 서는 가장 가벼운 연결) */
export const DB_ENGINES: readonly DbEngine[] = ["sqlite", "postgres", "mysql", "mariadb"];
export const DB_TLS_MODES: readonly DbTlsMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

/** 네트워크 엔진의 기본 포트 */
export const DB_DEFAULT_PORT: Readonly<Record<NetEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
};

/**
 * **엔진 아이콘** — 호스트 아이콘과 같은 저장 형식(`HostIcon` 이 그린다 · 원본 색 그대로의 컬러 로고, 2026-10-13).
 * 넷 다 본 번들의 큐레이션(`svg:postgres` · `svg:mysql` · `svg:mariadb` · `svg:sqlite` — 늘 있다)이라 logos 전체(7MB)를
 * 받지 않는다(MariaDB · SQLite 는 10-13 큐레이션에 더함 — 호스트 아이콘으로 옛 `svg:logos:…` 를 고른 설정은 logos 전체로 그대로 그려진다).
 */
export const DB_ENGINE_ICON: Readonly<Record<DbEngine, string>> = {
  postgres: "svg:postgres",
  mysql: "svg:mysql",
  mariadb: "svg:mariadb",
  sqlite: "svg:sqlite",
};

/** 목록 상한(경유 · 직접 합쳐서) — Rust `CONNS_MAX` 와 같다 */
export const DB_CONNS_MAX = 64;
/** 이름 글자 수 상한 — Rust `NAME_MAX` 와 같다 */
export const DB_NAME_MAX = 64;

/** 호스트 칸의 기본값 — 경유면 그 호스트 자신(터널 끝에서 본 localhost) */
export const DB_DEFAULT_HOST = "localhost";

/** 앱이 만드는 id 의 길이와 글자 */
export const DB_ID_LENGTH = 12;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Rust `vault::db_conn_id_ok` 와 같은 모양 규칙 */
export function dbIdOk(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,32}$/.test(id);
}

/**
 * 새 id 하나 — 12자 `[A-Za-z0-9]`, `crypto.getRandomValues` 로 뽑는다.
 *
 * 바이트를 62 로 나눈 나머지를 그대로 쓰면 앞 글자들이 조금 더 자주 나온다(256 = 62×4 + 8) — 248 이상은
 * 버리고 다시 뽑는다. `fill` 은 시험이 주입하는 자리다(기본은 Web Crypto).
 */
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

/** CA 파일 칸이 보이는 모드 — 서버 인증서를 실제로 검증하는 둘뿐이다 */
export function tlsNeedsCa(mode: DbTlsMode): boolean {
  return mode === "verify-ca" || mode === "verify-full";
}

/**
 * CA 파일이 **반드시** 있어야 하는 모드 — `verify-ca` 는 CA 파일만 믿는다(Rust `DbTlsMode::check_ca` 와 같은 규칙 — 공개 CA +
 * 이름 무시는 사실상 검증이 없다). `verify-full` 은 비우면 공개 CA 를 믿는다.
 */
export function tlsCaRequired(mode: DbTlsMode): boolean {
  return mode === "verify-ca";
}

/** 암호화는 하지만 서버 인증서를 확인하지 않는 모드 — 화면이 그 사실을 한 줄로 밝힌다 */
export function tlsUnverified(mode: DbTlsMode): boolean {
  return mode === "prefer" || mode === "require";
}

/** 별칭 비교 — ssh config 별칭 맞추기와 같은 눈(대소문자 무시 · Rust `db::conns::same_alias`) */
export function sameAlias(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** 이 호스트를 경유하는 연결들(파일 순서) — 호스트 우클릭 "DB 열기 ›" · 삭제 확인의 개수 · 볼트 걷기 */
export function connsVia(conns: readonly DbConn[], host: string): DbConn[] {
  if (host.trim() === "") return [];
  return conns.filter((d) => d.via !== undefined && sameAlias(d.via, host));
}

/**
 * 설정 › 보안의 볼트 목록에서 DB 비밀번호 대상(id)을 **"경유 호스트 · 연결 이름"**(직접이면 **"`direct` · 연결 이름"**)으로 —
 * 못 찾은 id 는 표에 없다(부르는 쪽이 id 그대로 보인다). `direct` 는 부르는 쪽의 문구("직접").
 */
export function dbVaultLabels(conns: readonly DbConn[], direct: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of conns) {
    if (!out.has(d.id)) out.set(d.id, `${d.via?.trim() || direct} · ${d.name}`);
  }
  return out;
}

/**
 * **복제본의 이름** — 호스트 복제(`nextCopyAlias`)와 같은 규칙: `<이름>-copy`, 이미 있으면 `-copy-2` · `-copy-3` …(대소문자 무시).
 * 겹침은 **같은 경유 안에서만** 본다 — 폼 저장의 중복 검사(`upsertConn` 의 `duplicate`)와 같은 눈이라 그 검사에 걸리지 않는다.
 * 이름 상한([`DB_NAME_MAX`] 글자)을 넘으면 꼬리(`-copy-N`)는 지키고 원래 이름의 끝을 깎는다.
 */
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

/**
 * **연결 하나를 복제한 목록** — 비밀 아닌 칸(경유 · 엔진 · 경로 · 주소 · 포트 · DB · 사용자 · TLS)을 모두 옮기고 새 `id` · 새 이름을
 * 붙여 **끝에** 덧붙인다(`db_conn_save` 는 통째로 쓴다). 비밀번호는 볼트에 원본 `id` 로만 있어 따라가지 않는다 — 복제본은 처음 열 때
 * 묻는다. 원본이 목록에 없으면 `null`.
 */
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
