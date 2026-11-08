//! **쿼리 타일의 DB 평면** — 세션 서버 프로세스에 산다(쿼리 타일 5단계, docs/log/2026-10-12-query-tile.md).
//!
//! GUI 는 같은 이름의 서버 op 프록시(`server::db_proxy`)로만 닿고, 서버 op 몸은 `server::db_ops` 다. 이 모듈은 Tauri 도
//! 파이프도 모른다(연결 표·엔진·가드·값 매핑).
//!
//! | 자식 | 하는 일 |
//! | --- | --- |
//! | `guard` | 문장 하나만 · 읽기 전용 모드의 트랜잭션·세션 조작 거절 — **순수 함수**(SQL 렉서) |
//! | `value` | 결과 칸 → JSON(정수 ±2^53 · NaN · 칸 상한 · 바이트 요약) — 엔진 공통 꼴 |
//! | `sqlite` | rusqlite 엔진(읽기 전용 열기 + `query_only` · prepare 꼬리 · `readonly()` · `InterruptHandle`) — 블로킹 |
//! | `pg` | tokio-postgres 엔진(확장 프로토콜만 · READ ONLY 트랜잭션 + 포털 상한 · 취소 토큰 · SSH 경유 = 공유 SSH 전송로 + 터널) — 비동기 |
//! | `net` | 네트워크 엔진(PG · MySQL) 공용 — 붙을 곳 `NetTarget` · 열기 실패 · SSH 경유 전송로(공유 SSH 자리 + 터널) · 비밀번호를 묻는 동안 세워 두기 · 생사 `Life` |
//! | `pg_value` | PG 바이너리 칸 → `value::Cell`(형별 직접 해석 — 패닉 없음 · 모르는 형은 `‹이름›`) |
//! | `mysql` | mysql_async 엔진(MySQL · MariaDB — prepare 만 · READ ONLY 트랜잭션 · `sql_select_limit` 상한 · 시간 제한 `max_execution_time`/`max_statement_time` + 앱 타이머 · 제어 연결 `KILL QUERY`) — 비동기 |
//! | `mysql_value` | MySQL 칸 → `value::Cell`(정수 부호 · DECIMAL 글자 · 날짜 fsp · BIT · 문자셋 binary = 바이트 · 모르는 형은 `‹이름›`) |
//! | `detail` | 테이블 구조(`db_table_detail`)의 공통 꼴 · 칸마다 상한 · PG 카탈로그 문장 · SQLite `CREATE` 글자 읽기(체크 · 트리거의 때) — 순수 |
//! | `definition` | 정의(DDL) 읽기 전용 보기(`db_definition`)의 공통 꼴 · 상한 1 MiB · PG 카탈로그 문장과 재구성(테이블 · 시퀀스 · 형 · 집계) · MySQL `SHOW CREATE` 조립(존재 확인 뒤 인용) — 순수 |
//! | `table` | 연결 표(열쇠 = 타일의 `stream` · 핸들 · 임대 회차) · 시간 제한·취소 · 블로킹 풀로 엔진 부르기 |
//! | `script` | **스크립트 실행기**(2단계) — 문장 목록을 한 요청으로 받아 전부 검증(`plan`) → 한 연결 · 한 트랜잭션으로 차례로(`execute`) → 첫 오류에서 전부 되돌림 · 모두 성공하면 커밋. 사람 타일(`table::script`)과 3단계 AI 작업안이 같은 함수를 쓴다(연결은 부르는 쪽이 준다) |
//! | `tx` | **트랜잭션 작업**(1단계 — 10-13 결정) 칸 — 상태 · 작업 id · 방치 시계(무활동 10분 · 1분 전 경고) · 화면 꼴 — **순수**(엔진 일은 `table` · 각 엔진의 `tx_begin`·`tx_end`·`in_tx`) |
//! | `ai` | **AI 의 DB 평면**(3단계 3a) — 세션 서버 MCP(`mcp::db`)의 유일한 입구. 권한 증표(`authorize` — `delegation.toml` `[[database]]` 단계 + 신원 스냅샷) · **AI 전용 연결** 풀(연결 id 하나에 하나 · 무활동 5분이면 닫음 · 볼트 비밀번호 · 무인 SSH) · 늘 읽기 전용 조회(가드 읽기 전용 + 엔진 `READ ONLY` · 여러 문장은 읽기 모드 스크립트) · 상한(행 50/500 · 칸 1 KiB · 응답 256 KiB · 15/60초) |
//! | `ai_plan` | **AI 쓰기 작업안의 사전 검증**(3단계 3b) — 순수(연결 없음). MCP `create_db_write_plan` 이 만들기 전에 부른다 — 문장 하나씩 2단계 쓰기 스크립트 규칙(`script::plan(…, Write)`) · 항목 하나 = 문장 하나 · 상한(20문장 · 64 KiB · `maxAffected` 필수) |
//! | `ai_write` | **AI 작업안의 DB 쓰기 실행**(3단계 3b) — 사람이 승인한 뒤 `operations::db_exec` 만 부른다(MCP 에 길 없음). 실행 한 번 동안만 사는 **따로 연 쓰기 연결**(3a 읽기 풀 · 사람 타일과 별개) · 2단계 실행기 한 트랜잭션 + 영향 행 상한(넘으면 커밋 전 되돌림) |
//! | `conns` | DB 연결 목록 `config_root()/db-connections.json` 하나(경유 = 호스트 별칭 `via` 또는 직접 · 비밀 없음) · 엔진·TLS 모드 꼴 — GUI 가 쓰고, 서버는 열 때 **파일에서 직접** 해석 |
//!
//! ## 불변식
//!
//! - **서버는 GUI 가 보낸 경로·주소를 믿지 않는다** — `db_open` 의 몸은 연결 **참조**(`{id}`)뿐이고, 경로·호스트·포트·경유
//!   호스트는 서버가 `db-connections.json` 에서 다시 읽는다(`conns::find`).
//! - **세션 코어(`session_core`)에 오르지 않는다** — DB 연결은 셸 세션이 아니다(MCP 세션 목록·떨어진 세션 목록에 섞이지 않게).
//!   임대 규칙만 같은 꼴로 따로 둔다(`table`).
//! - **MCP 는 `db::ai` 만 부른다**(3단계 3a — 10-14 사용자 승인으로 "MCP 에 DB 도구 없음" 을 고쳐 씀 · 3b 에서 연결 없는 사전 검증
//!   `db::ai_plan` 하나를 더함) — 타일 연결 표(`table`)·쓰기 전환 · 사람의 트랜잭션 작업 · AI 쓰기 실행(`db::ai_write` — 사람 승인 뒤
//!   작업안 실행기만)에 닿는 길이 없다. AI 는 연결마다 사람이 준 권한(`delegation.toml` `[[database]]`) 안에서 **따로 연 읽기
//!   전용 연결**로만 읽는다(시험 `mcp_reaches_db_only_through_ai_facade` · `db_ai_never_touches_tile_entries` ·
//!   `db_ai_connections_are_read_only_forever` · `db_tools_follow_ai_level`).
//! - **로그에 SQL·결과·경로·비밀이 없다** — `server::db_ops` 가 남기는 것은 op·핸들·길이·행 수·ms 뿐이다.
//! - 읽기 전용은 **이중**이다: 가드(문장 하나·첫 낱말 허용 목록) + 엔진(SQLite = 읽기 전용 열기·`query_only`·`readonly()` ·
//!   PG = 확장 프로토콜 + 문장마다 `READ ONLY` 트랜잭션(세션 상태 없음 — 트랜잭션 모드 풀러 뒤에서도 같다) · MySQL = prepare + 문장마다
//!   `START TRANSACTION READ ONLY` + 세션 `READ ONLY`). 진짜 보장은
//!   DB 쪽 권한(읽기 전용 계정)뿐이라는 것을 화면이 밝힌다(6단계).

pub(crate) mod ai;
pub(crate) mod ai_plan;
pub(crate) mod ai_write;
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
// PG 통합 시험(`#[ignore]` + 환경변수 — 실제 서버 · 임시 sshd 가 있을 때만).
#[cfg(test)]
mod pg_tests;
// MySQL · MariaDB 통합 시험(같은 꼴).
#[cfg(test)]
mod mysql_tests;

#[cfg(test)]
mod tls_tests;
// 트랜잭션 작업 통합 시험(1단계 — `#[ignore]` + 환경변수, 표를 그대로 부른다).
#[cfg(test)]
mod tx_tests;
// Codex 검토 반영 1 — 작업 안 실행 · 끝내기의 판정 통합 시험(`#[ignore]` + 환경변수 — `tx_tests` 의 도우미).
#[cfg(test)]
mod tx_verdict_tests;
// 스크립트 실행기 시험(2단계 — 순수 · SQLite 는 늘, 실제 서버는 `#[ignore]` + 환경변수).
#[cfg(test)]
mod script_tests;
// AI DB 평면 시험(3단계 3a — MCP 경유 · SQLite 는 늘, 실제 서버는 `#[ignore]` + 환경변수).
#[cfg(test)]
mod ai_tests;
// AI 쓰기 작업안 시험(3단계 3b — MCP 로 만들고 · 사람 승인 · 서버 실행 · SQLite 는 늘, 실제 서버는 `#[ignore]` + 환경변수).
#[cfg(test)]
#[path = "db/tests/ai_write.rs"]
mod ai_write_tests;

use crate::i18n::tr;

/// 기본 행 상한.
pub(crate) const ROWS_DEFAULT: usize = 1000;
/// 요청 `maxRows` 의 상한 — 더 크게 청해도 여기서 자른다.
pub(crate) const ROWS_MAX: usize = 10_000;
/// 응답 전체(행 JSON)의 대략 상한 — 넘으면 그 행에서 끊고 `truncated`. 파이프 프레임 상한(16 MiB)의 절반.
pub(crate) const RESPONSE_MAX: usize = 8 * 1024 * 1024;
/// 기본 시간 제한.
pub(crate) const TIMEOUT_DEFAULT_MS: u64 = 30_000;
/// 시간 제한의 상한(10분 — `ssh_exec` 의 상한과 같다). GUI 쪽 요청 시한은 이것 + 여유(`server::client`).
pub(crate) const TIMEOUT_MAX_MS: u64 = 600_000;
/// 스키마·객체·컬럼 목록의 시간 제한(고정).
pub(crate) const META_TIMEOUT_MS: u64 = 30_000;

/// 사람의 **실행 한 번**(문장 하나 · 작업 안 스크립트 한 벌)을 감쌀 세이브포인트 이름(앱 고정 — 10-14 결정). 세 엔진(`pg` · `mysql` ·
/// `sqlite`)이 같은 이름을 쓴다. PG 메타 조회의 것(`aynx_meta`)과 이름이 달라 둘이 서로를 지우지 않는다(PG 담당 태스크 · 연결
/// 잠금이 일을 하나씩 하니 겹치지도 않는다). 사람이 친 `SAVEPOINT` · `ROLLBACK TO` · `RELEASE` 는 가드가 거절하므로(`guard` 머리말 2 —
/// 트랜잭션 낱말) 사람 문장이 이 이름을 건드리거나 같은 이름을 다시 걸 수 없다.
pub(crate) const RUN_SAVEPOINT: &str = "aynx_run";

/// 서버 이벤트 — 열린 DB 연결의 상태가 바뀌었다(`{stream, state: "disconnected"}` — 7단계는 끊김 하나). GUI 가 같은 이름의
/// Tauri 이벤트로 그대로 중계한다(`server::client` 의 `RELAYED`).
pub(crate) const EVT_STATE: &str = "db-state";

/// SQL 방언 — 가드의 렉서 규칙과 거절 목록이 갈린다. MariaDB 는 MySQL 과 같은 규칙.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dialect {
    Sqlite,
    Postgres,
    /// MySQL · MariaDB(8단계 — 엔진은 하나, 시간 제한 방식만 서버 버전으로 갈린다).
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

/// 요청 상한을 다듬는다 — 행 수(1..=[`ROWS_MAX`], 없으면 [`ROWS_DEFAULT`]) · 시간(1ms..=[`TIMEOUT_MAX_MS`], 없으면 기본).
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

/// `db_query` 의 답 — 엔진 공통 꼴(칸은 `value::to_json`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryOut {
    pub columns: Vec<ColumnOut>,
    pub rows: Vec<Vec<serde_json::Value>>,
    /// 행 상한·응답 상한에서 끊었다(뒤에 행이 더 있다).
    pub truncated: bool,
    /// 어느 칸의 글자를 칸 상한에서 잘랐다.
    pub cell_truncated: bool,
    /// 바꾼 행 수 — 바꾸는 문장일 때만.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
    /// 트랜잭션 작업의 상태(1단계 — 표가 채운다, 엔진은 늘 `None`). 판 8 GUI 는 모르는 칸이라 무시한다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<tx::TxView>,
}

/// `db_objects` 한 조회문이 돌려주는 줄의 상한 — 넘으면 앞 [`OBJECTS_MAX`] 줄만 싣고 그 조회문이 맡은 종류를 `truncated` 에
/// 적는다(이름순이라 뒤쪽 이름이 빠진다). 스키마 하나를 펼칠 때 한 번 읽으므로 응답이 커지지 않게 한다.
pub(crate) const OBJECTS_MAX: usize = 5000;

/// 스키마 트리의 객체 하나 — `db_objects` 의 줄(엔진 공통 꼴). 종류(`kind`)가 트리의 폴더를 정한다:
/// `table` · `view` · `matview` · `foreign` · `function` · `procedure` · `sequence` · `type`. 인덱스 · 트리거 · 제약은
/// 스키마 단이 아니라 테이블 아래(`db_table_detail` — [`detail`])에 선다(엔진끼리 모양을 맞춘다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ObjectOut {
    pub kind: &'static str,
    pub name: String,
    /// 갈래 코드(화면이 번역한다) — 테이블 `partitioned` · 함수 `aggregate`·`window` · 형 `enum`·`domain`·`range`·`composite`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<&'static str>,
    /// 함수·프로시저의 인자 목록(엔진이 쓴 SQL 글자 그대로 — 괄호 없이).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    /// 함수의 돌려주는 형.
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

/// 조회문 하나의 결과를 상한에서 자른다 — **순수**(시험 대상). 넘었으면 `kinds`(그 조회문이 맡은 종류)를 `truncated` 에 더한다.
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

/// `db_objects` 의 답 — `{objects: [ObjectOut], truncated: [kind]}`.
pub(crate) fn objects_json(objects: Vec<ObjectOut>, truncated: Vec<&'static str>) -> serde_json::Value {
    serde_json::json!({ "objects": objects, "truncated": truncated })
}

/// 엔진 한 번의 실패 — 시간 제한·취소를 가르는 것은 표(`table`)다(엔진은 "끊겼다" 만 안다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EngineError {
    /// `InterruptHandle` 로 끊겼다(시간 초과 또는 취소).
    Interrupted,
    /// 이 연결에서 다른 작업이 돌고 있다(연결 하나 = 한 번에 하나).
    Busy,
    /// 사용자에게 보일 문구(엔진 오류 메시지 포함 — 비밀 없음).
    Message(String),
    /// **쓰기 모드 연결**에서 엔진의 `READ ONLY` 트랜잭션이 문장을 거절했다(PG 25006 · MySQL 1792 · SQLite `Statement::readonly()` 거짓).
    /// 자동 커밋을 끈 타일의 조회 길(`table::query` · `table::script` — 허용 목록 문장을 읽기 전용으로 돌려 본다)이 이것을 본다:
    /// - SQLite 는 **실행 전** 판정(prepare 뒤 `readonly()`)이라 바뀐 것이 없다 — 작업을 열어 다시 돈다.
    /// - PG · MySQL 은 **실행 중** 거절이다 — 그 앞의 함수 · 세션 부작용(`pg_advisory_lock` · `GET_LOCK` · 외부 호출)이 이미 일어났을 수
    ///   있어 **다시 돌지 않는다**(Codex 검토 반영 1 — `[db-needs-work]` 안내로 끝낸다).
    ///
    /// 그 밖에서는 [`EngineError::Message`] 와 같이 문구다.
    ReadOnlyRefused(String),
    /// **실행 결과 미확인** — 시한 뒤에도 엔진이 답하지 않아 기다리기를 멈췄다(`table::run_timed` 의 버림) · 자동 커밋 문장의 `COMMIT` 답을
    /// 받지 못했다(PG). 그 문장이 반영됐는지 앱은 알 수 없다. 표는 그 연결을 다시 쓰지 않는다(엔진의 `abandon` — 끊김으로 표시하고 닫는다,
    /// Codex 검토 반영 1). 문구는 사람 말.
    Unconfirmed(String),
}

/// 작업 안 **실행 한 번**(문장 하나 · 스크립트 한 벌)의 끝 — 세이브포인트를 어떻게 정리했나. 엔진이 적고 표(`table`)가 작업 칸 · 문구를
/// 고른다(Codex 검토 반영 1 — "이번 실행만 되돌림" 은 [`RunEnd::Undone`] 일 때만 말한다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RunEnd {
    /// 유지 — 성공해 세이브포인트를 풀었다(바뀐 것이 작업에 남는다).
    Kept,
    /// 복구 성공 — 실패 · 멈춤에서 `ROLLBACK TO` 가 **성공했다**(이번 실행분만 되돌림 · 작업은 열림). `note` = 덧말(MySQL 의 되돌리지 못한
    /// 비트랜잭션 변경 경고 1196 · 남은 행 잠금).
    Undone { note: Option<String> },
    /// 전체 종료 · 되돌림이 증명된다 — 엔진이 트랜잭션 전체를 되감았다(MySQL 교착 1213 · `innodb_rollback_on_timeout` 의 1205 · SQLite 의
    /// 끊긴 쓰기) · 세이브포인트 복구에 실패해 앱이 전체를 되돌렸는데 그 사이 커밋될 길이 없다(PG · SQLite — 사람 문장은 트랜잭션을 끝낼 수
    /// 없다).
    RolledBack { note: Option<String> },
    /// 결과 불명 — 트랜잭션이 끝났는데 어떻게 끝났는지 증명할 수 없다(MySQL 에서 알 수 없는 까닭으로 사라짐 · 세이브포인트 복구 실패 뒤
    /// 전체 되돌리기 — 그 전에 문장이 커밋했을 수 있다 · 문장이 성공했는데 트랜잭션이 사라짐). 사연.
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

/// 트랜잭션 작업 끝내기(`COMMIT` · `ROLLBACK`)의 실패 — 결과가 갈린다(`table::tx_end`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TxEndError {
    /// 이 연결에서 다른 일이 돈다 — 보내지 않았다(작업은 그대로).
    Busy,
    /// 서버가 거절했다(직렬화 실패 · 미뤄 둔 제약 · SQLite `BUSY` …) — 작업이 남았는지는 엔진의 `in_tx` 가 말한다.
    Failed(String),
    /// 보낸 뒤 답 전에 연결이 끊겼다 — 커밋이면 **결과 불명**, 되돌리기면 서버가 끊김으로 되돌린다.
    Lost(String),
    /// 서버는 받았다고 답했는데 끝난 뒤에도 트랜잭션이 남아 있다(MySQL `IN_TRANS` — 체인 · 숨은 트랜잭션, Codex 검토 반영 1) — 엔진이 그
    /// 연결을 정리하거나 끊었다. 결과 불명으로 알린다.
    Unverified(String),
}

/// 직렬화 실패(PG 40001) · 스냅숏이 낡음(SQLite `SQLITE_BUSY_SNAPSHOT`) — 문장만 다시 해서는 풀리지 않는다(Codex 검토 반영 1). 작업 상태는
/// 엔진의 판정 그대로이고, 이 줄은 안내만 더한다.
pub(crate) fn serialization_note() -> String {
    tr!(
        ko: "다른 트랜잭션과 겹쳐 이 트랜잭션의 스냅숏이 낡았습니다 — 같은 문장만 다시 실행해서는 풀리지 않습니다. 트랜잭션 작업을 되돌리고 처음부터 다시 하세요(앞서 읽은 값도 낡았을 수 있습니다).",
        en: "This transaction's snapshot is stale because another transaction overlapped — re-running the same statement does not help. Roll back the transaction and start over (values read earlier may be stale too)."
    )
}

/// 자동 커밋 단문의 `COMMIT` 을 보냈는데 답을 못 받았다(PG — [`EngineError::Unconfirmed`]).
pub(crate) fn commit_lost_note(detail: &str) -> String {
    tr!(
        ko: "문장은 실행됐지만 커밋 응답을 받기 전에 연결이 끊겼습니다 — 반영됐는지 앱은 알 수 없습니다. 다시 연결해 데이터를 확인하세요({detail})",
        en: "The statement ran but the connection was lost before the commit answer — the app cannot tell whether it was applied. Reconnect and check the data ({detail})"
    )
}

/// 작업 안 실행 중에 트랜잭션이 사라졌는데 까닭을 증명할 수 없다(MySQL — [`RunEnd::Unknown`]).
pub(crate) fn tx_vanished_note() -> String {
    tr!(
        ko: "실행 중에 트랜잭션이 끝났습니다 — 어떻게 끝났는지(커밋 · 되돌림) 앱은 증명할 수 없습니다. 데이터를 확인하세요.",
        en: "The transaction ended during the run — the app cannot prove how it ended (commit or rollback). Check the data."
    )
}

/// 세이브포인트로 이번 실행을 정리하지 못했다 — 작업 전체를 되돌렸다(`rolled`) · 되돌리지도 못해 연결을 끊었다. `may_have_committed` =
/// 그 전에 문장이 커밋했을 수 있는 엔진(MySQL — 프로시저)이다.
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

/// 이 첫 낱말의 문장이 행을 돌려줄 때(`RETURNING`) 돌려준 행 수가 곧 바뀐 행 수인가 — PG `INSERT`·`UPDATE`·`DELETE`·`MERGE` ·
/// MariaDB `INSERT`·`DELETE`·`REPLACE … RETURNING`. `WITH … ` 로 시작하는 쓰기는 본 문장을 알 수 없어 세지 않는다(영향 행 수 없음).
pub(crate) fn counts_returned_rows(keyword: &str) -> bool {
    matches!(keyword, "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE")
}

impl From<guard::GuardError> for EngineError {
    fn from(e: guard::GuardError) -> Self {
        EngineError::Message(e.message())
    }
}
