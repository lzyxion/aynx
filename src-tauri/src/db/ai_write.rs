//! **AI 작업안의 DB 쓰기 실행**(쿼리 타일 3단계 3b — docs/log/2026-10-13-db-write-mcp-design.md B-6 · D7) — 사람이 앱에서 승인한 DB 작업안을
//! 세션 서버의 작업안 실행기(`operations::db_exec`)가 **여기로만** 돌린다. MCP 에는 이 모듈로 오는 길이 없다(시험
//! `mcp_reaches_db_only_through_ai_facade` · `db_ai_write_is_reached_only_by_the_operations_executor`).
//!
//! ## 쓰기 연결 — 실행 한 번에 새로 하나, 끝나면 닫는다
//!
//! 3a 의 AI 전용 연결(`db::ai` 의 풀)은 **늘 읽기 전용**이고 그것을 시험이 지킨다(`db_ai_connections_are_read_only_forever`). 그 연결을 쓰기
//! 모드로 바꿔 쓰지 않고 **따로 연다**([`open`] → [`WriteConn`]) — 근거:
//! - 읽기 풀은 "쓰기로 바꾸는 함수를 부를 수 없다" 는 형 · 소스 수준의 보장을 그대로 둔다(쓰기 연결이 풀에 섞이면 그 보장이 "보통은" 으로 약해진다).
//! - 쓰기 연결은 **승인된 실행 하나 동안만** 산다 — 비밀번호(볼트) · SSH 핀을 쥔 쓰기 가능 연결이 실행 밖에 남지 않는다(`Drop` 이 닫는다).
//!   AI 작업안은 드물어(사람 승인 한 번에 하나) 매번 여는 값(SSH 경유 · TLS 접속 한 번)이 문제 되지 않는다.
//! - 사람 타일의 연결(`table` 의 표 · 트랜잭션 작업)과는 **절대 나누지 않는다** — 이 모듈은 표에 닿지 않는다(시험이 소스를 훑는다).
//!
//! ## 실행
//!
//! 2단계 스크립트 실행기(`script::plan` → `script::execute(…, ScriptMode::Write)`) 그대로 — 한 트랜잭션 · 문장마다 가드(트랜잭션 · 암묵 커밋
//! 문장 거절) · 첫 오류 · 취소 · 시한이면 전부 되돌림 · 모두 성공하면 커밋 · 커밋 답을 못 받으면 **결과 불명**(다시 보내지 않는다). 여기에
//! **영향 행 상한**(`Ctl::with_affected_cap` — `maxAffected`)이 더해진다: 문장마다 엔진이 알려 준 영향 행을 더해 상한을 넘으면 다음 문장을
//! 시작하지 않고 **커밋 전에 되돌린다**(사유 `maxAffected`).
//!
//! ## 경유 SSH · 비밀번호
//!
//! 3a 와 같다 — 비밀번호는 빌린 값(그 연결의 사람 쿼리 타일이 비밀번호(친 값 · 볼트 값)로 붙어 있는 동안 — 볼트 잠금과 무관 · `db::borrowed`, 2026-11-09) → 볼트
//! (`ai::open_with` — 둘 다 세션 서버 안 · **볼트 차례는 그 연결의 헤드리스 위임 `[[database]] headless` 가 켜졌을 때만** — 실행 직전 재판정의
//! 증표가 지금 파일로 싣는다, 2026-11-09), 경유 SSH 는 무인 관문(`ai::secrets_for` — 사람의 답 없음 · 볼트의 SSH 비밀번호 없음 · 키 암호구는 그
//! 호스트의 `vault_passphrase` 위임일 때만). 빌린 값은 **열 때만** 본다 — 연 뒤 타일이 닫혀도 도는 트랜잭션은 끝까지 가고, 연결은 실행이
//! 끝나면 닫힌다(다음 실행은 다시 빌려야 한다). 실패 문구도 3a 의 것(`ai::open_error_text`)이다. **SQLite 쓰기 연결도 같은 문**
//! (`ai::sqlite_gate` — 그 연결의 사람 타일이 표에 있거나 헤드리스 위임이 있을 때만 · 2026-11-09).

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{json, Value};

use super::ai::{self, DbAiLevel, Grant, PasswordSource};
use super::ai_plan::RETURNING_ROWS;
use super::mysql::Mysql;
use super::pg::Pg;
use super::script::{self, ScriptMode};
use super::sqlite::Sqlite;
use super::table::{Engine, Resolved};
use crate::i18n::tr;

/// 쓰기 연결의 열쇠 앞머리 — `ai::STREAM_PREFIX` 아래라 엔진의 생사가 화면 이벤트를 내지 않는다(타일이 아니다).
fn stream_of(conn_id: &str) -> String {
    format!("{}write:{conn_id}", ai::STREAM_PREFIX)
}

/// 결과(`db`)에 싣는 행 JSON 전체의 상한 — MCP 결과 한 칸이 커지지 않게(문장마다 행 [`RETURNING_ROWS`] · 칸 1 KiB 와 함께).
const RESULT_ROWS_BUDGET: usize = 64 * 1024;

/// 실행 한 번 동안만 사는 **쓰기 연결** — 버려지면(성공 · 실패 · 패닉 · 취소) 닫는다.
pub(crate) struct WriteConn {
    engine: Engine,
}

impl Drop for WriteConn {
    fn drop(&mut self) {
        self.engine.shutdown();
    }
}

/// 승인된 작업안의 연결을 **쓰기로** 연다 — 증표의 단계가 'Ask' 여야 한다.
pub(crate) async fn open(grant: &Grant, src: &PasswordSource) -> Result<WriteConn, String> {
    if grant.level() < DbAiLevel::Approve {
        return Err(tr!(
            ko: "이 연결의 AI 권한이 'Ask' 가 아닙니다",
            en: "This connection's AI permission is not 'Ask'",
        ));
    }
    let via = grant.conn().via.clone();
    let resolved = ai::resolve_for(grant).await?;
    let stream = stream_of(&grant.conn().id);
    let id = grant.conn().id.clone();
    let engine = match resolved {
        Resolved::Sqlite(path) => {
            // 읽기와 같은 문(2026-11-09) — 사람 타일이 없으면 헤드리스 위임이 있어야 연다(실행 직전 재판정의 증표가 지금 파일로 싣는다).
            ai::sqlite_gate(grant, src)?;
            let s = tokio::task::spawn_blocking(move || Sqlite::open(std::path::Path::new(&path), true))
                .await
                .map_err(|_| "The database task failed (worker thread)".to_string())??;
            Engine::Sqlite(Arc::new(s))
        }
        Resolved::Pg(t) => {
            let (p, _) = ai::open_with(grant, src, ai::lend_for(grant, src), |s| Pg::connect(&stream, t.clone(), s))
                .await
                .map_err(|e| ai::open_error_text(e, via.as_deref(), &id))?;
            let p = Arc::new(p);
            // PG 의 쓰기는 앱 플래그뿐이다(세션 `SET` 없음 — 풀러 뒤에서 남의 세션에 새지 않게). 실행기의 쓰기 트랜잭션이 그것을 따른다.
            p.set_write(true).await.map_err(|e| { p.shutdown(); ai::plain(&super::table::message(e, false, false, 0)) })?;
            Engine::Pg(p)
        }
        Resolved::Mysql(t) => {
            let (m, _) = ai::open_with(grant, src, ai::lend_for(grant, src), |s| Mysql::connect(&stream, t.clone(), s))
                .await
                .map_err(|e| ai::open_error_text(e, via.as_deref(), &id))?;
            let m = Arc::new(m);
            m.set_write(true).await.map_err(|e| { m.shutdown(); ai::plain(&super::table::message(e, false, false, 0)) })?;
            Engine::Mysql(m)
        }
    };
    let conn = WriteConn { engine };
    if !conn.engine.writable() {
        return Err("refused: the write connection did not open writable".into());
    }
    Ok(conn)
}

/// 실행 한 번의 결과 — 결과 칸(`TargetResult.db`)에 실을 값 · 사람이 읽는 요약 줄 · 감사 요약.
#[derive(Debug, Clone)]
pub(crate) struct WriteRun {
    /// `committed` · `rolledBack` · `unknown` · `disconnected` · `notRun`.
    pub outcome: &'static str,
    /// 멈춘 까닭(`error` · `cancelled` · `timedOut` · `commitFailed` · `maxAffected`).
    pub reason: Option<&'static str>,
    /// 결과 칸(값 포함 — 사람 화면 전문 · MCP 는 읽기 권한이 있을 때만).
    pub value: Value,
    /// 줄마다 문장 하나의 요약(값 없음 — 결과의 `stdout`).
    pub summary: String,
    /// 실패 · 되돌림의 한 줄(결과의 `stderr` · `errorClass`).
    pub error: Option<String>,
    /// 감사용 — 문장마다 `(첫 낱말, 영향 행, ms)`(값 없음).
    pub audit: Vec<(String, Option<u64>, u64)>,
    pub total_affected: u64,
}

impl WriteRun {
    /// 엔진에 닿기 전에 멈췄다(재판정 · 열기 실패 · 취소) — 아무것도 실행하지 않았다.
    pub(crate) fn not_run(message: String, max_affected: u64) -> WriteRun {
        WriteRun {
            outcome: "notRun",
            reason: None,
            value: json!({
                "outcome": "notRun",
                "message": message,
                "maxAffected": max_affected,
                "totalAffected": 0,
                "statements": [],
            }),
            summary: String::new(),
            error: Some(message),
            audit: Vec::new(),
            total_affected: 0,
        }
    }
}

/// **승인된 문장들을 한 트랜잭션으로** — 다시 계획(가드)하고, 영향 행 상한을 건 실행기로 돌린다. `cancel` 은 작업안의 취소 스위치(사람의
/// [취소] · 서버 끝) — 세우면 다음 문장 전에 멈추거나 도는 문장을 끊고 되돌린다.
pub(crate) async fn run(
    conn: &WriteConn,
    statements: &[String],
    max_affected: u64,
    stmt_ms: u64,
    cancel: Arc<AtomicBool>,
) -> WriteRun {
    let engine = &conn.engine;
    let dialect = engine.dialect();
    let mut plan = Vec::with_capacity(statements.len());
    for (i, text) in statements.iter().enumerate() {
        match script::plan(text, dialect, ScriptMode::Write) {
            Ok(p) if p.len() == 1 => plan.extend(p),
            Ok(p) => {
                return WriteRun::not_run(
                    tr!(ko: "{n}번째 항목이 문장 {m}개로 나뉩니다", en: "Item {n} splits into {m} statements", n = i + 1, m = p.len()),
                    max_affected,
                )
            }
            Err(e) => return WriteRun::not_run(e.message(), max_affected),
        }
    }
    if !engine.writable() {
        return WriteRun::not_run("refused: the write connection is not writable".into(), max_affected);
    }
    let started = Instant::now();
    let ctl = Arc::new(script::Ctl::new(cancel, stmt_ms, script::SCRIPT_TIMEOUT).with_affected_cap(max_affected));
    let run = match script::execute(engine.clone(), plan.clone(), ScriptMode::Write, RETURNING_ROWS, Arc::clone(&ctl)).await {
        Ok(r) => r,
        // 엔진이 받기 전에 거절했다(바쁨 · 끊김 · 트랜잭션을 열지 못함) — 아무것도 실행하지 않았다.
        Err(e) => return WriteRun::not_run(ai::plain(&super::table::message(e, false, false, stmt_ms)), max_affected),
    };
    let out = script::report(&plan, run, ScriptMode::Write, &ctl, stmt_ms, started.elapsed().as_millis() as u64);
    shape(out, max_affected, ctl.affected_total())
}

/// 실행기의 화면 꼴 → 결과 칸 · 요약 · 감사.
fn shape(out: script::ScriptOut, max_affected: u64, total: u64) -> WriteRun {
    let mut budget = RESULT_ROWS_BUDGET;
    let mut summary = Vec::new();
    let mut audit = Vec::new();
    let statements: Vec<Value> = out
        .results
        .into_iter()
        .map(|r| {
            let affected = r.out.affected;
            let ms = r.out.elapsed_ms;
            summary.push(match affected {
                Some(n) => tr!(ko: "{i}. {kw} — {n}행 · {ms} ms", en: "{i}. {kw} — {n} rows · {ms} ms", i = r.index + 1, kw = r.keyword),
                None => tr!(ko: "{i}. {kw} — {ms} ms", en: "{i}. {kw} — {ms} ms", i = r.index + 1, kw = r.keyword),
            });
            audit.push((r.keyword.clone(), affected, ms));
            let has_rows = !r.out.columns.is_empty();
            let (mut v, _) = ai::shape_query(r.out, &mut budget);
            if !has_rows {
                // 행을 돌려주지 않는 문장 — 빈 칸들을 싣지 않는다.
                if let Some(o) = v.as_object_mut() {
                    for k in ["columns", "rows", "rowCount", "truncated", "cellTruncated"] {
                        o.remove(k);
                    }
                }
            }
            v["index"] = json!(r.index);
            v["keyword"] = json!(r.keyword);
            v
        })
        .collect();
    let message = match (out.outcome, out.reason) {
        // 되돌림은 트랜잭션에 드는 변경에 한한다(Codex 검토 반영 1 — MySQL · MariaDB 의 비트랜잭션 테이블은 되돌려지지 않는다. 서버가 경고
        // 1196 을 냈으면 엔진의 덧말(`out.message`)이 뒤에 붙는다).
        (_, Some("maxAffected")) => Some(
            [
                Some(tr!(
                    ko: "영향 행 {total}개가 상한 {max}개를 넘어 커밋하지 않고 되돌렸습니다(트랜잭션을 지원하지 않는 테이블의 변경은 되돌려지지 않습니다)",
                    en: "{total} affected rows exceeded maxAffected {max} — nothing was committed and the transaction was rolled back (changes to non-transactional tables are not rolled back)",
                    max = max_affected,
                )),
                out.message.clone(),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n"),
        ),
        _ => out.message.clone(),
    };
    let failed = out.failed.as_ref().map(|f| json!({ "index": f.index, "message": f.message }));
    let error = match out.outcome {
        "committed" => None,
        _ => Some(
            [
                message.clone(),
                out.failed.as_ref().map(|f| tr!(ko: "{n}번째 문장: {m}", en: "Statement {n}: {m}", n = f.index + 1, m = f.message)),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n"),
        )
        .filter(|s| !s.is_empty())
        .or_else(|| Some(outcome_text(out.outcome, out.reason))),
    };
    let mut value = json!({
        "outcome": out.outcome,
        "maxAffected": max_affected,
        "totalAffected": total,
        "statementCount": out.total,
        "statements": statements,
        "elapsedMs": out.elapsed_ms,
    });
    if let Some(r) = out.reason {
        value["reason"] = json!(r);
    }
    if let Some(m) = &message {
        value["message"] = json!(m);
    }
    if let Some(f) = failed {
        value["failed"] = f;
    }
    summary.push(outcome_text(out.outcome, out.reason));
    WriteRun {
        outcome: out.outcome,
        reason: out.reason,
        value,
        summary: summary.join("\n"),
        error,
        audit,
        total_affected: total,
    }
}

/// 끝 한 줄(사람 말).
fn outcome_text(outcome: &str, reason: Option<&str>) -> String {
    match (outcome, reason) {
        ("committed", _) => tr!(ko: "커밋했습니다", en: "Committed"),
        ("rolledBack", Some("maxAffected")) => tr!(ko: "영향 행 상한을 넘어 되돌렸습니다", en: "Rolled back — over maxAffected"),
        ("rolledBack", Some("cancelled")) => tr!(ko: "취소해 되돌렸습니다", en: "Cancelled — rolled back"),
        ("rolledBack", Some("timedOut")) => tr!(ko: "시간 제한을 넘어 되돌렸습니다", en: "Timed out — rolled back"),
        ("rolledBack", Some("commitFailed")) => tr!(ko: "서버가 커밋을 거절해 되돌려졌습니다", en: "The server refused the commit — rolled back"),
        ("rolledBack", _) => tr!(ko: "오류로 전부 되돌렸습니다", en: "Rolled back after an error"),
        ("unknown", _) => tr!(
            ko: "결과 불명 — 커밋됐는지 앱이 알 수 없습니다(다시 실행하지 않았습니다)",
            en: "Outcome unknown — the app cannot tell whether it committed (it did not retry)",
        ),
        ("disconnected", _) => tr!(ko: "연결이 끊겨 서버가 되돌렸습니다", en: "Disconnected — the server rolled back"),
        _ => tr!(ko: "실행하지 않았습니다", en: "Not run"),
    }
}
