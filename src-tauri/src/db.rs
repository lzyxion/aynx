//! 쿼리 타일의 DB 평면 — 세션 서버 프로세스에 산다(docs/log/2026-10-12-query-tile.md). GUI 는 같은 이름의 서버 op 프록시
//! (`server::db_proxy`)로만 닿고, 이 모듈은 Tauri 도 파이프도 모른다.
//!
//! ## 불변식
//!
//! - 서버는 GUI 가 보낸 경로 · 주소를 믿지 않는다 — `db_open` 의 몸은 연결 참조(`{id}`)뿐이고 경로 · 호스트 · 포트 · 경유 호스트는
//!   서버가 `db-connections.json` 에서 다시 읽는다(`conns::find`).
//! - 세션 코어(`session_core`)에 오르지 않는다 — DB 연결은 셸 세션이 아니다(MCP 세션 목록 · 떨어진 세션 목록에 섞이지 않게).
//! - MCP 는 `db::ai` 와 연결 없는 사전 검증 `db::ai_plan` 만 부른다 — 타일 연결 표(`table`) · 쓰기 전환 · 사람의 트랜잭션 작업 · AI 쓰기
//!   실행(`db::ai_write` — 사람 승인 뒤 작업안 실행기만)에 닿는 길이 없다. AI 는 연결마다 사람이 준 권한(`delegation.toml` `[[database]]`)
//!   안에서 따로 연 읽기 전용 연결로만 읽는다(→ docs/invariants.md 전문 8 · 시험 `mcp_reaches_db_only_through_ai_facade` ·
//!   `db_ai_never_touches_tile_entries` · `db_ai_connections_are_read_only_forever` · `db_tools_listed_always_judged_per_call`).
//! - 로그에 SQL · 결과 · 경로 · 비밀이 없다 — `server::db_ops` 가 남기는 것은 op · 핸들 · 길이 · 행 수 · ms 뿐이다.
//! - 읽기 전용은 이중이다: 가드(문장 하나 · 첫 낱말 허용 목록) + 엔진(SQLite = 읽기 전용 열기 · `query_only` · `readonly()` · PG = 확장
//!   프로토콜 + 문장마다 `READ ONLY` 트랜잭션 · MySQL = prepare + 문장마다 `START TRANSACTION READ ONLY` + 세션 `READ ONLY`). 진짜 보장은
//!   DB 쪽 권한(읽기 전용 계정)뿐이라는 것을 화면이 밝힌다.

pub(crate) mod ai;
pub(crate) mod ai_plan;
pub(crate) mod ai_write;
pub(crate) mod borrowed;
pub(crate) mod conns;
pub(crate) mod definition;
pub(crate) mod detail;
pub(crate) mod guard;
pub(crate) mod mysql;
pub(crate) mod mysql_tls;
pub(crate) mod mysql_value;
pub(crate) mod net;
pub(crate) mod pg;
pub(crate) mod pg_value;
pub(crate) mod script;
pub(crate) mod sqlite;
pub(crate) mod table;
pub(crate) mod tls;
pub(crate) mod tx;
pub(crate) mod value;

#[cfg(test)]
mod tests;
// 통합 시험은 `#[ignore]` + 환경변수 — 실제 서버 · 임시 sshd 가 있을 때만 돈다.
#[cfg(test)]
mod pg_tests;
#[cfg(test)]
mod mysql_tests;

#[cfg(test)]
mod tls_tests;
#[cfg(test)]
mod tx_tests;
#[cfg(test)]
mod tx_verdict_tests;
#[cfg(test)]
mod script_tests;
#[cfg(test)]
mod ai_tests;
#[cfg(test)]
#[path = "db/tests/ai_write.rs"]
mod ai_write_tests;

use crate::i18n::tr;

pub(crate) const ROWS_DEFAULT: usize = 1000;
pub(crate) const ROWS_MAX: usize = 10_000;
/// 파이프 프레임 상한(16 MiB)의 절반 — 넘으면 그 행에서 끊고 `truncated`.
pub(crate) const RESPONSE_MAX: usize = 8 * 1024 * 1024;
pub(crate) const TIMEOUT_DEFAULT_MS: u64 = 30_000;
/// `ssh_exec` 의 상한과 같다. GUI 쪽 요청 시한은 이것 + 여유(`server::client`).
pub(crate) const TIMEOUT_MAX_MS: u64 = 600_000;
pub(crate) const META_TIMEOUT_MS: u64 = 30_000;

/// 사람의 실행 한 번을 감싸는 세이브포인트 — 세 엔진이 같은 이름을 쓰고, PG 메타 조회의 `aynx_meta` 와 이름이 달라 서로를 지우지 않는다.
/// 사람이 친 `SAVEPOINT` · `ROLLBACK TO` · `RELEASE` 는 가드가 거절해 사람 문장이 이 이름을 건드릴 수 없다.
pub(crate) const RUN_SAVEPOINT: &str = "aynx_run";

/// `{stream, state: "disconnected"}` — GUI 가 같은 이름의 Tauri 이벤트로 그대로 중계한다(`server::client` 의 `RELAYED`).
pub(crate) const EVT_STATE: &str = "db-state";

/// SQL 방언 — 가드의 렉서 규칙과 거절 목록이 갈린다. MariaDB 는 MySQL 과 같은 규칙.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dialect {
    Sqlite,
    Postgres,
    /// MySQL · MariaDB — 엔진은 하나, 시간 제한 방식만 서버 버전으로 갈린다.
    Mysql,
}

impl Dialect {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Dialect::Sqlite => "sqlite",
            Dialect::Postgres => "postgres",
            Dialect::Mysql => "mysql",
        }
    }
}

pub(crate) fn clamp_limits(max_rows: Option<u64>, timeout_ms: Option<u64>) -> (usize, u64) {
    let rows = max_rows
        .map(|n| (n as usize).clamp(1, ROWS_MAX))
        .unwrap_or(ROWS_DEFAULT);
    let ms = timeout_ms
        .map(|t| t.clamp(1, TIMEOUT_MAX_MS))
        .unwrap_or(TIMEOUT_DEFAULT_MS);
    (rows, ms)
}

/// 결과 컬럼 하나 — `type` 은 엔진의 형 이름(SQLite 는 첫 NULL 아닌 값의 저장 종류 · 모르면 빈 글자).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ColumnOut {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryOut {
    pub columns: Vec<ColumnOut>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub truncated: bool,
    pub cell_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
    /// 표가 채운다(엔진은 늘 `None`). 판 8 GUI 는 모르는 칸이라 무시한다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<tx::TxView>,
}

/// 넘으면 앞 줄만 싣고 그 조회문이 맡은 종류를 `truncated` 에 적는다(이름순이라 뒤쪽 이름이 빠진다).
pub(crate) const OBJECTS_MAX: usize = 5000;

/// `kind` 가 트리의 폴더를 정한다 — `table` · `view` · `matview` · `foreign` · `function` · `procedure` · `sequence` · `type`. 인덱스 · 트리거 ·
/// 제약은 스키마 단이 아니라 테이블 아래(`db_table_detail` — [`detail`])에 선다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ObjectOut {
    pub kind: &'static str,
    pub name: String,
    /// 갈래 코드(화면이 번역한다) — 테이블 `partitioned` · 함수 `aggregate`·`window` · 형 `enum`·`domain`·`range`·`composite`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<&'static str>,
    /// 엔진이 쓴 SQL 글자 그대로 — 괄호 없이.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub returns: Option<String>,
}

impl ObjectOut {
    pub(crate) fn new(kind: &'static str, name: String) -> ObjectOut {
        ObjectOut {
            kind,
            name,
            sub: None,
            args: None,
            returns: None,
        }
    }
}

pub(crate) fn cap_objects(mut rows: Vec<ObjectOut>, kinds: &[&'static str], truncated: &mut Vec<&'static str>) -> Vec<ObjectOut> {
    if rows.len() > OBJECTS_MAX {
        rows.truncate(OBJECTS_MAX);
        for k in kinds {
            if !truncated.contains(k) {
                truncated.push(k);
            }
        }
    }
    rows
}

pub(crate) fn objects_json(objects: Vec<ObjectOut>, truncated: Vec<&'static str>) -> serde_json::Value {
    serde_json::json!({ "objects": objects, "truncated": truncated })
}

/// 시간 제한 · 취소를 가르는 것은 표(`table`)다 — 엔진은 "끊겼다" 만 안다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EngineError {
    /// 시간 초과 또는 취소.
    Interrupted,
    Busy,
    /// 엔진 오류 메시지 포함 — 비밀 없음.
    Message(String),
    /// 쓰기 모드 연결에서 엔진의 `READ ONLY` 트랜잭션이 문장을 거절했다(PG 25006 · MySQL 1792 · SQLite `readonly()` 거짓). SQLite 는 실행 전
    /// 판정이라 작업을 열어 다시 돌고, PG · MySQL 은 실행 중 거절이라 앞의 부작용(`pg_advisory_lock` · `GET_LOCK` …)이 일어났을 수 있어 다시 돌지 않는다.
    ReadOnlyRefused(String),
    /// 실행 결과 미확인 — 시한 뒤에도 답이 없거나 자동 커밋의 `COMMIT` 답을 못 받았다(PG). 표는 그 연결을 다시 쓰지 않는다(엔진의 `abandon`).
    Unconfirmed(String),
}

/// 작업 안 실행 한 번의 끝 — "이번 실행만 되돌림" 은 [`RunEnd::Undone`] 일 때만 말한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RunEnd {
    /// 성공해 세이브포인트를 풀었다(바뀐 것이 작업에 남는다).
    Kept,
    /// `ROLLBACK TO` 가 성공했다(이번 실행분만 되돌림 · 작업은 열림). `note` = MySQL 1196 경고 · 남은 행 잠금 같은 덧말.
    Undone { note: Option<String> },
    /// 되돌림이 증명된다 — 엔진이 트랜잭션 전체를 되감았거나, 앱이 전체를 되돌렸는데 그 사이 커밋될 길이 없다(PG · SQLite).
    RolledBack { note: Option<String> },
    /// 트랜잭션이 끝났는데 어떻게 끝났는지 증명할 수 없다(그 전에 문장이 커밋했을 수 있다).
    Unknown(String),
}

impl EngineError {
    pub(crate) fn busy_message() -> String {
        tr!(
            ko: "이 연결에서 다른 일(쿼리 · 커밋 · 구조 읽기 등)이 진행 중입니다 — 끝나거나 취소한 뒤 다시 하세요",
            en: "Something else (a query, a commit, a structure read, etc.) is in progress on this connection — try again after it finishes or is cancelled"
        )
    }
}

/// 결과가 갈린다(`table::tx_end`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TxEndError {
    /// 보내지 않았다(작업은 그대로).
    Busy,
    /// 작업이 남았는지는 엔진의 `in_tx` 가 말한다.
    Failed(String),
    /// 보낸 뒤 답 전에 끊겼다 — 커밋이면 결과 불명, 되돌리기면 서버가 끊김으로 되돌린다.
    Lost(String),
    /// 받았다고 답했는데 트랜잭션이 남아 있다(MySQL `IN_TRANS` — 체인 · 숨은 트랜잭션) — 엔진이 그 연결을 정리하거나 끊었다. 결과 불명.
    Unverified(String),
}

/// 문장만 다시 해서는 풀리지 않는다(PG 40001 · SQLite `SQLITE_BUSY_SNAPSHOT`). 작업 상태는 엔진의 판정 그대로이고 안내만 더한다.
pub(crate) fn serialization_note() -> String {
    tr!(
        ko: "다른 트랜잭션과 겹쳐 이 트랜잭션의 스냅숏이 낡았습니다 — 같은 문장만 다시 실행해서는 풀리지 않습니다. 트랜잭션 작업을 되돌리고 처음부터 다시 하세요(앞서 읽은 값도 낡았을 수 있습니다).",
        en: "This transaction's snapshot is stale because another transaction overlapped — re-running the same statement does not help. Roll back the transaction and start over (values read earlier may be stale too)."
    )
}

pub(crate) fn commit_lost_note(detail: &str) -> String {
    tr!(
        ko: "문장은 실행됐지만 커밋 응답을 받기 전에 연결이 끊겼습니다 — 반영됐는지 앱은 알 수 없습니다. 다시 연결해 데이터를 확인하세요({detail})",
        en: "The statement ran but the connection was lost before the commit answer — the app cannot tell whether it was applied. Reconnect and check the data ({detail})"
    )
}

pub(crate) fn tx_vanished_note() -> String {
    tr!(
        ko: "실행 중에 트랜잭션이 끝났습니다 — 어떻게 끝났는지(커밋 · 되돌림) 앱은 증명할 수 없습니다. 데이터를 확인하세요.",
        en: "The transaction ended during the run — the app cannot prove how it ended (commit or rollback). Check the data."
    )
}

/// `may_have_committed` = 그 전에 문장이 커밋했을 수 있는 엔진(MySQL — 프로시저)이다.
pub(crate) fn recovery_failed_note(why: &str, rolled: bool, may_have_committed: bool) -> String {
    let what = if rolled {
        tr!(
            ko: "세이브포인트로 이번 실행을 되돌리지 못해({why}) 더 실행하지 않고 트랜잭션 작업 전체를 되돌렸습니다.",
            en: "The run could not be rolled back to its savepoint ({why}), so the app stopped and rolled back the whole transaction."
        )
    } else {
        tr!(
            ko: "세이브포인트로 이번 실행을 되돌리지 못했고({why}) 작업 전체를 되돌리지도 못해 연결을 끊었습니다(서버가 되돌립니다).",
            en: "The run could not be rolled back to its savepoint ({why}) and the whole transaction could not be rolled back either, so the connection was closed (the server rolls it back)."
        )
    };
    if may_have_committed {
        format!(
            "{what} {}",
            tr!(
                ko: "그 전에 문장이 커밋했는지 앱은 알 수 없습니다 — 데이터를 확인하세요.",
                en: "The app cannot tell whether a statement committed before that — check the data."
            )
        )
    } else {
        what
    }
}

/// 돌려준 행 수(`RETURNING`)가 곧 바뀐 행 수인가. `WITH … ` 로 시작하는 쓰기는 본 문장을 알 수 없어 세지 않는다.
pub(crate) fn counts_returned_rows(keyword: &str) -> bool {
    matches!(keyword, "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE")
}

impl From<guard::GuardError> for EngineError {
    fn from(e: guard::GuardError) -> Self {
        EngineError::Message(e.message())
    }
}
