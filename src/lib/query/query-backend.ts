/**
 * **쿼리 타일의 백엔드 계약** — 5단계 Tauri 명령(`src-tauri/src/server/db_proxy.rs` · `db/conns.rs`)의 타입 래퍼(쿼리 타일
 * 6단계, docs/log/2026-10-12-query-tile.md).
 *
 * 몸은 전부 세션 서버에 산다 — GUI 명령은 같은 이름의 서버 op 프록시다. 여기 있는 것은 Rust 직렬화(`db::table::Opened` ·
 * `db::QueryOut` · `db::value::to_json` · `db::ObjectOut` · `db::detail::TableDetail` · `db::definition::DefinitionOut` · `db::sqlite::{schema, objects, table_detail}` · `db::conns::{DbConn, ConnList}`)와 1:1 인 타입,
 * 얇은 `invoke` 래퍼, 그리고 프런트가 갈래를 가르는 **오류 접두어 분류**(`classifyDbError`) 뿐이다.
 *
 * 지키는 것:
 * - **연결 값(경로·주소·경유)을 보내지 않는다** — `db_open` 의 몸은 참조(`DbConnRef` = `{id}`)뿐이고 서버가 `db-connections.json` 에서 다시 읽는다.
 *   **예외 하나 — `db_test`**(DB 연결 폼의 [연결 테스트], 판 28)는 저장 전 폼 값(초안 한 줄 — 저장과 같은 `conn-form` 의 `connOfRow`)을
 *   싣는다. 서버가 저장과 같은 검사를 다시 하고, 볼트 비밀번호로 물러날지는 저장된 줄과 대상을 견줘 **서버가** 정한다(몸에 그 판단이 없다).
 * - **비밀번호는 `db_open` · `db_test` 한 번의 몸에만** 싣는다(DB 비밀번호 · 경유 SSH 관문의 답 — 접속 모달 `query/open-flow`).
 * - `db_open` 의 실패는 **글자**(DB 쪽 — 이유 접두어) 또는 경유 SSH 관문의 **객체**(`{kind, …}` — 터미널 열기와 같은 꼴,
 *   `runSshGates` 가 읽는다)다.
 * - 화면에 찍기 전 이유 접두어를 뗀다(`stripReason`) — 분류는 떼기 **전** 문자열로 한다.
 */
import { invoke } from "../ipc";
import { hasReason } from "$lib/error-reason";
import type { SshGateCreds } from "$lib/session/ssh-gates";
import type { DbConn } from "$lib/db-conn";

export type { DbConn } from "$lib/db-conn";

/** SQL 방언 — Rust `db::Dialect::as_str` (MariaDB 는 `mysql`) */
export type DbDialect = "sqlite" | "postgres" | "mysql";

/** 연결 참조 — Rust `db::table::ConnRef`. `db-connections.json` 의 id 하나(경유 여부도 서버가 파일에서 읽는다) */
export interface DbConnRef {
  id: string;
}

/** `db_open` 의 답 — Rust `db::table::Opened`(camelCase) */
export interface DbOpened {
  handle: number;
  lease: number;
  dialect: DbDialect;
  serverVersion: string;
  writable: boolean;
  reattached: boolean;
  /** 트랜잭션 작업(판 9 — 판 8 서버면 없다). 다시 붙으면 열린 작업이 그대로 온다 */
  tx?: DbTxView;
  /** 판 10 — 스크립트 실행(`db_script`)을 받는다(판 9 서버면 없다 — [스크립트 실행] 을 숨긴다) */
  scripts?: boolean;
  /** 떼어 둔 동안 끝난 스크립트의 요약(다시 붙을 때 한 번 — 결과 행은 없다) */
  lastScript?: DbScriptResult;
  /**
   * 판 13 — 자동 커밋 토글의 지금 값(쓰기 모드가 아니면 늘 참 · 판 12 서버면 없다 — 토글을 숨긴다). 서버가 쥔다(F5 뒤에도 그대로 ·
   * 새 연결은 켬 · 쓰기를 끄면 켬으로).
   */
  autoCommit?: boolean;
  /**
   * 판 14 표지(GUI 프록시가 얹는다) — 세션 서버가 Codex 검토 반영 1 의 판정을 한다: 자동 커밋 끔 조회를 PG · MySQL 이 실행 중에
   * 읽기 전용으로 거절하면 다시 돌지 않고 `[db-needs-work]` 로 끝낸다 · 증명할 수 없는 끝은 `unknown`. 거짓이면 옛 서버(다시 돌기).
   */
  txVerdicts?: boolean;
  /**
   * 판 15 표지(GUI 프록시가 얹는다) — 세션 서버에 연결별 조정 장치가 있다(Codex 검토 반영 2): 실행 · 작업 시작 · 커밋 · 되돌리기 · 모드
   * 바꾸기 · 메타 조회가 한 번에 하나(실행 중 [커밋]은 바쁨) · 방치 되돌리기 재시도 · `[db-unconfirmed]`. 화면은 어느 판이든 실행 중
   * 단추를 막는다(이 칸은 진단용).
   */
  txSerial?: boolean;
}

/** `db_test` 의 답 — Rust `db::table::Tested`(camelCase · 비밀 없음). 판 글자는 쿼리 타일 정보 카드와 같은 값 */
export interface DbTested {
  dialect: DbDialect;
  serverVersion: string;
  /** 경유 호스트 별칭(없으면 직접) */
  via?: string;
  elapsedMs: number;
}

/** 트랜잭션 작업의 끝 — Rust `db::tx::Outcome` */
export type DbTxOutcome = "committed" | "rolledBack" | "errorRolledBack" | "idleRolledBack" | "unknown" | "disconnected";

/** 끝난 작업 — Rust `db::tx::Ended` */
export interface DbTxEnded {
  id: number;
  outcome: DbTxOutcome;
  statements: number;
  /** 서버가 실은 사연(엔진 오류 · 결과 불명의 까닭 — 비밀 없음) */
  message?: string;
}

/**
 * 트랜잭션 작업의 상태 — Rust `db::tx::TxView`(camelCase). 시각은 **받은 순간으로부터의 길이**다(`query/tx-work` 가 받은 시각을 함께 적는다).
 * `state`: 없음(대기) · 열림 · 끝내는 중 · 오류로 되돌려짐 · 결과 불명 · 연결 끊김(뒤 셋은 다음 작업을 열 때까지 남는다).
 */
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

/** 작업 op — Rust `server::db_ops` 의 `db_tx` */
export type DbTxAction = "begin" | "commit" | "rollback" | "extend" | "state";

/**
 * 결과 칸 하나 — Rust `db::value::to_json`. 정수가 ±2^53 밖이거나 NaN·무한이면 **문자열**로 온다(그대로 보인다).
 * 바이트는 길이와 앞 64바이트의 16진.
 */
export type Cell = null | boolean | number | string | { $bytes: number; hex: string };

export interface DbColumn {
  name: string;
  /** 엔진의 형 이름 — SQLite 는 첫 NULL 아닌 값의 저장 종류(모르면 빈 글자) */
  type: string;
}

/** `db_query` 의 답 — Rust `db::QueryOut`(camelCase · `affected` 는 바꾸는 문장일 때만) */
export interface DbQueryResult {
  columns: DbColumn[];
  rows: Cell[][];
  truncated: boolean;
  cellTruncated: boolean;
  affected?: number;
  elapsedMs: number;
  /** 트랜잭션 작업의 상태(판 9 — 문장 뒤의 서버 진실) */
  tx?: DbTxView;
}

/** 스크립트의 문장 하나의 결과 — Rust `db::script::StmtOut`(성공한 것만). 자리는 보낸 글 안의 **UTF-16** 위치(편집기 글자 위치와 같은 단위) */
export interface DbScriptStmt extends DbQueryResult {
  /** 0 기준 차례 */
  index: number;
  start: number;
  end: number;
  /** 첫 낱말(대문자) */
  keyword: string;
}

/** 멈춘 문장 — 실행 전 거절 · 실행 중 오류 · 끊김(자리는 UTF-16) */
export interface DbScriptFailed {
  index: number;
  start: number;
  end: number;
  message: string;
}

/**
 * 스크립트의 끝 — Rust `db::script::ScriptOut::outcome`:
 * `committed` · `rolledBack` · `readOnly`(읽기 전용 — 늘 되돌림) · `refused`(실행 전 거절 — 실행 0) · `unknown`(결과 불명) ·
 * `disconnected` · `work`(트랜잭션 작업 안 — 커밋 안 함, 작업은 열림) · `workEnded`(작업 안 — 엔진이 작업을 끝냄)
 */
export type DbScriptOutcome =
  | "committed"
  | "rolledBack"
  | "readOnly"
  | "refused"
  | "unknown"
  | "disconnected"
  | "work"
  /** 판 13 — 작업 안에서 첫 오류 · 멈춤 → 이번 실행분만 세이브포인트로 되돌림(작업은 열림) */
  | "workUndone"
  | "workEnded";

/** 멈춘 까닭 — 없으면 끝까지 갔다 */
export type DbScriptReason = "error" | "cancelled" | "timedOut" | "commitFailed";

/** `db_script` 의 답 — Rust `db::script::ScriptOut`(camelCase) */
export interface DbScriptResult {
  outcome: DbScriptOutcome;
  reason?: DbScriptReason;
  /** 계획한 문장 수(나누기부터 거절이면 0) */
  total: number;
  results: DbScriptStmt[];
  failed?: DbScriptFailed;
  /** 사연(커밋 거절 · 결과 불명의 까닭 · 나누기 거절 문구) */
  message?: string;
  elapsedMs: number;
  tx?: DbTxView;
  /** 떼어 둔 동안 끝나 다시 붙은 화면에 건넨 요약(결과 행 없음) */
  detached?: boolean;
  /**
   * 판 15 — 자동 커밋 끔 · 조회만 든 줄 안 스크립트를 PG · MySQL 이 실행 중에 읽기 전용으로 거절했다(다시 돌지 않았다 — 단문의
   * `[db-needs-work]` 와 같은 뜻). 화면이 [트랜잭션 작업 시작] 단추를 함께 보인다
   */
  needsWork?: boolean;
  /**
   * 자동 커밋 끔 · 작업 없음에서 이 실행이 작업을 저절로 열었고, 첫 오류 · 멈춤으로 이번 실행분을 되돌린 뒤 빈 작업도 닫았다
   * (`outcome: "rolledBack"` 과 함께 — 바뀐 것 없음 · 작업은 남지 않음 · 10-14 실기)
   */
  workClosed?: boolean;
}

/** `db_schema` 의 답 — 스키마(MySQL = 데이터베이스 · SQLite = 붙인 DB) **이름만**(트리의 첫 단계) */
export interface DbSchema {
  schemas: { name: string }[];
}

/** 스키마 트리의 객체 종류 — 트리의 폴더 하나씩. Rust `db::ObjectOut::kind` */
export type DbObjectKind =
  | "table"
  | "view"
  | "matview"
  | "foreign"
  | "function"
  | "procedure"
  | "sequence"
  | "type";

/** `db_objects` 의 줄 — Rust `db::ObjectOut`(빈 칸은 오지 않는다) */
export interface DbObject {
  kind: DbObjectKind;
  name: string;
  /** 갈래 코드 — 테이블 `partitioned` · 함수 `aggregate`·`window` · 형 `enum`·`domain`·`range`·`composite` */
  sub?: string;
  /** 함수·프로시저의 인자 목록(엔진의 SQL 글자 — 괄호 없이) */
  args?: string;
  /** 함수의 돌려주는 형 */
  returns?: string;
}

/** `db_objects` 의 답 — 스키마 하나를 펼칠 때. `truncated` = 상한(조회문마다 5000줄)에서 잘린 종류 */
export interface DbObjects {
  objects: DbObject[];
  truncated: DbObjectKind[];
}

/** 테이블 구조의 컬럼 — `pk` 는 기본 키 안의 순번(0 = 아님) */
export interface DbTableColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  pk: number;
}

/** 인덱스 — Rust `db::detail::IndexOut`. `columns` 의 `null` = 식(SQLite 는 식 글자를 주지 않는다) */
export interface DbIndex {
  name: string;
  columns: (string | null)[];
  unique: boolean;
  primary: boolean;
  /** 방식(`btree` · `BTREE` · `gist` …) */
  method?: string;
  /** 부분 인덱스의 조건(PG) */
  predicate?: string;
  /** 정의 글자 */
  definition?: string;
}

/** 제약 조건 — Rust `db::detail::ConstraintOut`(외래 키는 따로). SQLite 의 기본 키 · 유니크는 이름이 없다 */
export interface DbConstraint {
  name?: string;
  type: "primary" | "unique" | "check" | "exclude";
  columns: string[];
  definition?: string;
}

/**
 * 외래 키 — Rust `db::detail::ForeignKeyOut`. `schema.table(columns)` 이 `refSchema.refTable(refColumns)` 를 가리킨다(외래 키 칸 =
 * 이 테이블이 가리키는 쪽 · 참조됨 칸 = 다른 테이블이 이 테이블을 가리키는 쪽). SQLite 는 이름이 없다
 */
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

/** 트리거 — `detail` = 때 · 사건(`BEFORE INSERT OR UPDATE` — 모르면 빈 글자) */
export interface DbTrigger {
  name: string;
  detail: string;
  definition?: string;
}

/** 파티션(PG 분할 테이블의 자식) — `bound` = 범위 식 · `sub` = 하위 분할(`partitioned`) */
export interface DbPartition {
  schema: string;
  name: string;
  bound?: string;
  sub?: string;
}

/** `db_table_detail` 의 답 — 테이블(· 뷰)을 펼칠 때 한 번. `truncated` = 상한(칸마다 5000줄)에서 잘린 칸 이름 */
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

/** [`dbConnList`] 의 답 — Rust `db::conns::ConnList` */
export interface ConnList {
  conns: DbConn[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 래퍼 — 인자 이름은 Rust 의 snake_case 를 Tauri 가 camelCase 로 받는다
// ---------------------------------------------------------------------------

/**
 * 연다 — `password` 는 DB 비밀번호(이번 한 번), `ssh` 는 SSH 경유일 때 관문의 답(`runSshGates` 가 채운다). 몸에서 곧바로
 * 떨어진다 — 여기 남기지 않는다.
 */
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

/**
 * **연결 테스트**(판 28 — DB 연결 폼) — 저장 안 한 초안(`conn`)으로 한 번 붙고 닫는다. `stream` 은 폼이 시도마다 뽑는 `dbtest-…` 열쇠
 * (비밀번호를 묻는 동안 서버가 경유 전송로를 그 열쇠에 세워 둔다). 실패는 [`dbOpen`] 과 같은 꼴(글자 또는 경유 SSH 관문 객체).
 * 판 27 서버면 GUI 가 보내지 않고 `[server-outdated]`(폼은 그 전에 단추를 숨긴다 — `db_ai_list` 의 `connTest`).
 */
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
  /** 화면이 아는 트랜잭션 작업 id(0 = 작업 없음) — 서버의 지금 작업과 다르면 `[db-tx-stale]` */
  txId?: number;
}): Promise<DbQueryResult> {
  return invoke<DbQueryResult>("db_query", {
    handle: o.handle,
    lease: o.lease,
    sql: o.sql,
    queryId: o.queryId,
    maxRows: o.maxRows ?? null,
    timeoutMs: o.timeoutMs ?? null,
    txId: o.txId ?? null,
  });
}

/**
 * 스크립트 실행(판 10) — 글 한 덩어리를 그대로 보낸다. 서버가 나누고 **전부 검증한 뒤** 한 트랜잭션으로 돈다(첫 오류에서 전부 되돌림 ·
 * 모두 성공하면 커밋 · 읽기 전용이면 늘 되돌림 · 작업 안이면 커밋 안 함). 판 9 서버면 `[server-outdated]`.
 */
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

/** 트랜잭션 작업 op — 열기 · 커밋 · 되돌리기 · 연장 · 상태(판 9 — 판 8 서버면 `[server-outdated]`) */
export function dbTx(handle: number, lease: number, action: DbTxAction, txId = 0): Promise<{ tx: DbTxView }> {
  return invoke<{ tx: DbTxView }>("db_tx", { handle, lease, action, txId });
}

export function dbCancel(handle: number, queryId: string): Promise<boolean> {
  return invoke<boolean>("db_cancel", { handle, queryId });
}

export function dbSchema(handle: number, lease: number): Promise<DbSchema> {
  return invoke<DbSchema>("db_schema", { handle, lease });
}

/** 스키마 하나의 객체 — `schema` 가 `null` 이면 엔진 기본(PG `public` · MySQL 연결의 기본 db · SQLite `main`) */
export function dbObjects(handle: number, lease: number, schema: string | null): Promise<DbObjects> {
  return invoke<DbObjects>("db_objects", { handle, lease, schema });
}

/** 테이블(· 뷰) 하나의 구조 — 컬럼 · 인덱스 · 제약 조건 · 외래 키 · 참조됨 · 트리거 · 파티션을 한 번에 */
export function dbTableDetail(handle: number, lease: number, schema: string | null, table: string): Promise<DbTableDetail> {
  return invoke<DbTableDetail>("db_table_detail", { handle, lease, schema, table });
}

/** 정의를 볼 종류 — Rust `db::definition::DefKind`(트리 폴더의 종류 + 테이블 아래 잎의 인덱스 · 트리거 · 제약 조건) */
export type DbDefinitionKind = DbObjectKind | "index" | "trigger" | "constraint";

/** `db_definition` 의 몸 — Rust `db::definition::DefTarget`. `table` = 인덱스 · 트리거 · 제약 조건이 걸린 테이블 · `args` = PG 겹지정 함수 가르기 */
export interface DbDefinitionTarget {
  schema: string | null;
  kind: DbDefinitionKind;
  name: string;
  table?: string;
  args?: string;
}

/** `db_definition` 의 답 — `reconstructed` = 엔진이 원문을 주지 않아 카탈로그로 다시 짰다 · `truncated` = 1 MiB 에서 잘림 */
export interface DbDefinition {
  sql: string;
  reconstructed: boolean;
  truncated: boolean;
}

/** 객체 하나의 정의(DDL) — 읽기 전용 보기(실행하지 않는다) */
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
 * 쓰기 켬/끔 — 위 띠 알약(`query/write-toggle`). 돌려주는 `writable` 이 화면의 진실이다. `autoCommit`(판 13 — 쓰기 모드 띠의 [자동 커밋]
 * 토글)을 주면 함께 바꾼다 — 판 12 서버면 보내지 않고 `[server-outdated]`(그 서버는 칸을 버려 끈 줄 알고 친 문장이 곧바로 커밋된다).
 * 답의 `autoCommit` 은 판 13 서버만 싣는다.
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

/** 목록 **전체**를 쓴다(통째 검증 — 한 줄이라도 틀리면 파일에 안 닿는다). 돌려주는 것은 다듬은 목록 */
export function dbConnSave(conns: DbConn[]): Promise<DbConn[]> {
  return invoke<DbConn[]>("db_conn_save", { conns });
}

/** 독 DB 칸의 폴더 곁 파일(`db-folders.json` — 아이콘 · 색 · 빈 폴더, 10-15)을 읽는다 — 없으면 `null`. 모양은 `db-folders.ts` 가 본다 */
export function dbFoldersLoad(): Promise<string | null> {
  return invoke<string | null>("db_folders_load");
}

/** 폴더 곁 파일을 통째로 쓴다 */
export function dbFoldersSave(json: string): Promise<void> {
  return invoke<void>("db_folders_save", { json });
}

// ---------------------------------------------------------------------------
// 오류 분류 — 문구가 아니라 이유 접두어로 (docs/conventions.md "이유 코드")
// ---------------------------------------------------------------------------

/**
 * 실패의 갈래:
 * - `reopen` — `[stale-lease]`(다른 창이 같은 타일에 다시 붙었다) · `[session-gone]`(연결이 닫혔다) → [다시 열기]
 * - `cancelled` — 사람이 누른 취소(실패가 아니라 "취소됨")
 * - `outdated` — 세션 서버가 판 8 미만(`[server-outdated]`) → 서버 다시 시작 안내
 * - `disconnected` — 열려 있던 연결이 끊겼다(`[db-disconnected]` — 전송로 사망 · 서버가 끊음) → "연결이 끊겼습니다 · [다시 연결]"
 * - `password` — DB 가 비밀번호를 청했다 · 거절했다(`[db-password]` · `[db-auth]`) → 접속 모달(`query/open-flow` 이 가른다)
 * - `txStale` — 트랜잭션 작업 요청이 낡았다(`[db-tx-stale]` — 이미 끝났거나 다른 작업) → 작업 상태를 다시 읽는다(1단계)
 * - `needsWork` — 자동 커밋 끔 조회를 엔진이 실행 중에 읽기 전용으로 거절했다(`[db-needs-work]` — 다시 돌지 않았다) → 안내 +
 *   [트랜잭션 작업 시작] 단추(Codex 검토 반영 2)
 * - `unconfirmed` — 실행 결과 미확인(`[db-unconfirmed]` — 판 15) → '결과 불명' 틀(다시 연결해 데이터 확인)
 * - `error` — 그 밖(엔진 오류 · 가드 거절 · "아직 지원 안 함" — 문구 그대로)
 */
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

/** `invoke` 가 던진 것 → 글자 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
