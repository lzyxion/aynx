/**
 * 쿼리 타일의 백엔드 계약 — Tauri 명령(`src-tauri/src/server/db_proxy.rs` · `db/conns.rs`)의 타입 래퍼. 타입은 Rust 직렬화와 1:1 이다.
 *
 * - **연결 값(경로 · 주소 · 경유)을 보내지 않는다** — `db_open` 의 몸은 참조(`{id}`)뿐이고 서버가 `db-connections.json` 에서 다시 읽는다.
 *   예외 하나 — `db_test` 는 저장 전 폼 값을 싣는다(서버가 저장과 같은 검사를 다시 하고, 볼트 비밀번호로 물러날지도 서버가 정한다).
 * - **비밀번호는 `db_open` · `db_test` 한 번의 몸에만** 싣는다.
 * - 분류는 이유 접두어를 떼기 **전** 문자열로 한다 — 화면에 찍기 전에만 뗀다(`stripReason`).
 */
import { invoke } from "../ipc";
import { hasReason } from "$lib/error-reason";
import type { SshGateCreds } from "$lib/session/ssh-gates";
import type { DbConn } from "$lib/db-conn";

export type { DbConn } from "$lib/db-conn";

/** Rust `db::Dialect::as_str` — MariaDB 는 `mysql` */
export type DbDialect = "sqlite" | "postgres" | "mysql";

/** Rust `db::table::ConnRef` */
export interface DbConnRef {
  id: string;
}

/** Rust `db::table::Opened` */
export interface DbOpened {
  handle: number;
  lease: number;
  dialect: DbDialect;
  serverVersion: string;
  writable: boolean;
  reattached: boolean;
  /** 판 8 서버면 없다 */
  tx?: DbTxView;
  /** 판 9 서버면 없다 — [스크립트 실행] 을 숨긴다 */
  scripts?: boolean;
  /** 떼어 둔 동안 끝난 스크립트의 요약(결과 행은 없다) */
  lastScript?: DbScriptResult;
  /** 서버가 쥔다 — 판 12 서버면 없다(토글을 숨긴다) */
  autoCommit?: boolean;
  /** 판 14 표지(GUI 프록시가 얹는다) — 거짓이면 옛 서버 */
  txVerdicts?: boolean;
  /** 판 15 표지(GUI 프록시가 얹는다) — 진단용 */
  txSerial?: boolean;
}

/** Rust `db::table::Tested` — 비밀 없음 */
export interface DbTested {
  dialect: DbDialect;
  serverVersion: string;
  via?: string;
  elapsedMs: number;
}

/** Rust `db::tx::Outcome` */
export type DbTxOutcome = "committed" | "rolledBack" | "errorRolledBack" | "idleRolledBack" | "unknown" | "disconnected";

/** Rust `db::tx::Ended` */
export interface DbTxEnded {
  id: number;
  outcome: DbTxOutcome;
  statements: number;
  message?: string;
}

/** Rust `db::tx::TxView`. 시각은 받은 순간으로부터의 길이다 */
export interface DbTxView {
  id: number;
  state: "none" | "open" | "ending" | "errorRolledBack" | "unknown" | "disconnected";
  statements: number;
  startedAgoMs?: number;
  idleLeftMs?: number;
  idleLimitMs: number;
  warnMs: number;
  warn: boolean;
  ended?: DbTxEnded;
}

export type DbTxAction = "begin" | "commit" | "rollback" | "extend" | "state";

/** Rust `db::value::to_json`. 정수가 ±2^53 밖이거나 NaN · 무한이면 문자열로 온다. 바이트는 길이와 앞부분의 16진 */
export type Cell = null | boolean | number | string | { $bytes: number; hex: string };

export interface DbColumn {
  name: string;
  /** SQLite 는 첫 NULL 아닌 값의 저장 종류(모르면 빈 글자) */
  type: string;
}

/** Rust `db::QueryOut` */
export interface DbQueryResult {
  columns: DbColumn[];
  rows: Cell[][];
  truncated: boolean;
  cellTruncated: boolean;
  affected?: number;
  elapsedMs: number;
  tx?: DbTxView;
}

/** Rust `db::script::StmtOut`. 자리는 보낸 글 안의 **UTF-16** 위치(편집기 글자 위치와 같은 단위) */
export interface DbScriptStmt extends DbQueryResult {
  index: number;
  start: number;
  end: number;
  keyword: string;
}

/** 자리는 UTF-16 */
export interface DbScriptFailed {
  index: number;
  start: number;
  end: number;
  message: string;
}

/** Rust `db::script::ScriptOut::outcome` */
export type DbScriptOutcome =
  | "committed"
  | "rolledBack"
  | "readOnly"
  | "refused"
  | "unknown"
  | "disconnected"
  | "work"
  /** 작업 안 — 이번 실행분만 세이브포인트로 되돌림(작업은 열림) */
  | "workUndone"
  | "workEnded";

export type DbScriptReason = "error" | "cancelled" | "timedOut" | "commitFailed";

/** Rust `db::script::ScriptOut` */
export interface DbScriptResult {
  outcome: DbScriptOutcome;
  reason?: DbScriptReason;
  total: number;
  results: DbScriptStmt[];
  failed?: DbScriptFailed;
  message?: string;
  elapsedMs: number;
  tx?: DbTxView;
  detached?: boolean;
  /** 단문의 `[db-needs-work]` 와 같은 뜻 — 다시 돌지 않았다 */
  needsWork?: boolean;
  /** 저절로 연 작업을 되돌리고 닫았다(`outcome: "rolledBack"` 과 함께 — 작업은 남지 않음) */
  workClosed?: boolean;
}

export interface DbSchema {
  schemas: { name: string }[];
}

/** Rust `db::ObjectOut::kind` */
export type DbObjectKind =
  | "table"
  | "view"
  | "matview"
  | "foreign"
  | "function"
  | "procedure"
  | "sequence"
  | "type";

/** Rust `db::ObjectOut` */
export interface DbObject {
  kind: DbObjectKind;
  name: string;
  /** 테이블 `partitioned` · 함수 `aggregate`·`window` · 형 `enum`·`domain`·`range`·`composite` */
  sub?: string;
  /** 엔진의 SQL 글자 — 괄호 없이 */
  args?: string;
  returns?: string;
}

/** `truncated` = 상한에서 잘린 종류 */
export interface DbObjects {
  objects: DbObject[];
  truncated: DbObjectKind[];
}

/** `pk` 는 기본 키 안의 순번(0 = 아님) */
export interface DbTableColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  pk: number;
}

/** Rust `db::detail::IndexOut`. `columns` 의 `null` = 식 */
export interface DbIndex {
  name: string;
  columns: (string | null)[];
  unique: boolean;
  primary: boolean;
  method?: string;
  predicate?: string;
  definition?: string;
}

/** Rust `db::detail::ConstraintOut`. SQLite 의 기본 키 · 유니크는 이름이 없다 */
export interface DbConstraint {
  name?: string;
  type: "primary" | "unique" | "check" | "exclude";
  columns: string[];
  definition?: string;
}

/** Rust `db::detail::ForeignKeyOut` — `schema.table(columns)` 이 `refSchema.refTable(refColumns)` 를 가리킨다. SQLite 는 이름이 없다 */
export interface DbForeignKey {
  name?: string;
  schema: string;
  table: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate?: string;
  onDelete?: string;
}

/** `detail` = 때 · 사건(`BEFORE INSERT OR UPDATE` — 모르면 빈 글자) */
export interface DbTrigger {
  name: string;
  detail: string;
  definition?: string;
}

/** PG 분할 테이블의 자식 */
export interface DbPartition {
  schema: string;
  name: string;
  bound?: string;
  sub?: string;
}

/** `truncated` = 상한에서 잘린 칸 이름 */
export interface DbTableDetail {
  columns: DbTableColumn[];
  indexes: DbIndex[];
  constraints: DbConstraint[];
  foreignKeys: DbForeignKey[];
  referencedBy: DbForeignKey[];
  triggers: DbTrigger[];
  partitions: DbPartition[];
  truncated: string[];
}

/** Rust `db::conns::ConnList` */
export interface ConnList {
  conns: DbConn[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 래퍼 — 인자 이름은 Rust 의 snake_case 를 Tauri 가 camelCase 로 받는다
// ---------------------------------------------------------------------------

/** `password` · `ssh` 는 이번 한 번의 몸에만 — 여기 남기지 않는다 */
export function dbOpen(
  stream: string,
  conn: DbConnRef,
  password?: string,
  ssh?: SshGateCreds,
  reattachOnly = false,
): Promise<DbOpened> {
  return invoke<DbOpened>("db_open", {
    stream,
    conn,
    reattachOnly,
    password: password ?? null,
    ssh: ssh
      ? {
          hostKeyDecision: ssh.hostKeyDecision,
          password: ssh.password,
          passphrase: ssh.passphrase,
          passphraseFor: ssh.passphraseFor,
          declinedKeys: ssh.declinedKeys,
        }
      : null,
  });
}

/** 저장 안 한 초안으로 한 번 붙고 닫는다. 실패는 [`dbOpen`] 과 같은 꼴 */
export function dbTest(stream: string, conn: DbConn, password?: string, ssh?: SshGateCreds): Promise<DbTested> {
  return invoke<DbTested>("db_test", {
    stream,
    conn,
    password: password ?? null,
    ssh: ssh
      ? {
          hostKeyDecision: ssh.hostKeyDecision,
          password: ssh.password,
          passphrase: ssh.passphrase,
          passphraseFor: ssh.passphraseFor,
          declinedKeys: ssh.declinedKeys,
        }
      : null,
  });
}

export function dbQuery(o: {
  handle: number;
  lease: number;
  sql: string;
  queryId: string;
  maxRows?: number;
  timeoutMs?: number;
  /** 0 = 작업 없음 — 서버의 지금 작업과 다르면 `[db-tx-stale]` */
  txId?: number;
  /** 데이터 탭 — 쓰기 모드여도 서버가 읽기 전용으로 돌리고 열린 작업이 있으면 거절한다(`db::table::query_read`). 좁히기만 한다 */
  readOnly?: boolean;
}): Promise<DbQueryResult> {
  return invoke<DbQueryResult>("db_query", {
    handle: o.handle,
    lease: o.lease,
    sql: o.sql,
    queryId: o.queryId,
    maxRows: o.maxRows ?? null,
    timeoutMs: o.timeoutMs ?? null,
    txId: o.txId ?? null,
    readOnly: o.readOnly ?? null,
  });
}

/** 글 한 덩어리를 그대로 보낸다 — 나누기 · 검증은 서버가 한다 */
export function dbScript(o: {
  handle: number;
  lease: number;
  sql: string;
  queryId: string;
  maxRows?: number;
  timeoutMs?: number;
  txId?: number;
}): Promise<DbScriptResult> {
  return invoke<DbScriptResult>("db_script", {
    handle: o.handle,
    lease: o.lease,
    sql: o.sql,
    queryId: o.queryId,
    maxRows: o.maxRows ?? null,
    timeoutMs: o.timeoutMs ?? null,
    txId: o.txId ?? null,
  });
}

export function dbTx(handle: number, lease: number, action: DbTxAction, txId = 0): Promise<{ tx: DbTxView }> {
  return invoke<{ tx: DbTxView }>("db_tx", { handle, lease, action, txId });
}

export function dbCancel(handle: number, queryId: string): Promise<boolean> {
  return invoke<boolean>("db_cancel", { handle, queryId });
}

export function dbSchema(handle: number, lease: number): Promise<DbSchema> {
  return invoke<DbSchema>("db_schema", { handle, lease });
}

/** `schema` 가 `null` 이면 엔진 기본(PG `public` · MySQL 연결의 기본 db · SQLite `main`) */
export function dbObjects(handle: number, lease: number, schema: string | null): Promise<DbObjects> {
  return invoke<DbObjects>("db_objects", { handle, lease, schema });
}

export function dbTableDetail(handle: number, lease: number, schema: string | null, table: string): Promise<DbTableDetail> {
  return invoke<DbTableDetail>("db_table_detail", { handle, lease, schema, table });
}

/** Rust `db::definition::DefKind` */
export type DbDefinitionKind = DbObjectKind | "index" | "trigger" | "constraint";

/** Rust `db::definition::DefTarget`. `table` = 인덱스 · 트리거 · 제약 조건이 걸린 테이블 · `args` = PG 겹지정 함수 가르기 */
export interface DbDefinitionTarget {
  schema: string | null;
  kind: DbDefinitionKind;
  name: string;
  table?: string;
  args?: string;
}

/** `reconstructed` = 엔진이 원문을 주지 않아 카탈로그로 다시 짰다 */
export interface DbDefinition {
  sql: string;
  reconstructed: boolean;
  truncated: boolean;
}

export function dbDefinition(handle: number, lease: number, t: DbDefinitionTarget): Promise<DbDefinition> {
  return invoke<DbDefinition>("db_definition", {
    handle,
    lease,
    schema: t.schema,
    kind: t.kind,
    name: t.name,
    table: t.table ?? null,
    args: t.args ?? null,
  });
}

/**
 * 돌려주는 `writable` 이 화면의 진실이다. `autoCommit` 은 판 12 서버에 보내지 않는다 — 그 서버는 칸을 버려 끈 줄 알고 친 문장이 곧바로 커밋된다.
 */
export function dbSetWrite(handle: number, lease: number, on: boolean, autoCommit?: boolean): Promise<{ writable: boolean; autoCommit?: boolean }> {
  return invoke<{ writable: boolean; autoCommit?: boolean }>("db_set_write", { handle, lease, on, autoCommit: autoCommit ?? null });
}

export function dbClose(handle: number, lease?: number): Promise<boolean> {
  return invoke<boolean>("db_close", { handle, lease: lease ?? null });
}

export function dbConnList(): Promise<ConnList> {
  return invoke<ConnList>("db_conn_list");
}

/** 통째 검증 — 한 줄이라도 틀리면 파일에 안 닿는다 */
export function dbConnSave(conns: DbConn[]): Promise<DbConn[]> {
  return invoke<DbConn[]>("db_conn_save", { conns });
}

/** 없으면 `null` */
export function dbFoldersLoad(): Promise<string | null> {
  return invoke<string | null>("db_folders_load");
}

export function dbFoldersSave(json: string): Promise<void> {
  return invoke<void>("db_folders_save", { json });
}

// ---------------------------------------------------------------------------
// 오류 분류 — 문구가 아니라 이유 접두어로 (docs/conventions.md "이유 코드")
// ---------------------------------------------------------------------------

export type DbErrorKind = "reopen" | "cancelled" | "outdated" | "disconnected" | "password" | "txStale" | "needsWork" | "unconfirmed" | "error";

export function classifyDbError(message: string): DbErrorKind {
  if (hasReason(message, "server-outdated")) return "outdated";
  if (hasReason(message, "db-disconnected")) return "disconnected";
  if (hasReason(message, "db-password") || hasReason(message, "db-auth")) return "password";
  if (hasReason(message, "stale-lease") || hasReason(message, "session-gone")) return "reopen";
  if (hasReason(message, "cancelled")) return "cancelled";
  if (hasReason(message, "db-tx-stale")) return "txStale";
  if (hasReason(message, "db-needs-work")) return "needsWork";
  if (hasReason(message, "db-unconfirmed")) return "unconfirmed";
  return "error";
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
