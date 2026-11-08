//! 작업안 읽기 도구 — 롱폴 `wait_for_operation` · 대상별 결과 `get_operation_results` ·
//! 자동 승인 범위 `get_auto_approval_policy`.
//!
//! 불변식:
//! - 셋 다 **읽기 전용**이다 — 실행·승인·취소하지 않고, 정책을 바꾸는 인자·경로도 없다.
//! - `wait_for_operation` 은 컨텍스트 잠금을 잡지 않고, 자는 동안 어떤 잠금도 쥐지 않는다.
//! - 결과는 **지금** 읽기 가시성을 다시 본다 — 그 사이 공유를 껐으면 출력을 비우고 `redacted:true`.
//! - 위임은 숫자 요약만 내보낸다(별칭·호스트 없음).

use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};

use crate::context::SessionContext;
use crate::operations::{self, OperationStore, ResultStore};

use super::*;

/// `wait_for_operation` 의 기다림 창 — 한 번에 기본 60초, 1..120초로 클램프.
///
/// 상한이 120초인 이유는 HTTP 한 요청이 그만큼 열려 있어도 안전한 선이기 때문이다(클라이언트
/// 쪽 기본 타임아웃과 프록시 없는 루프백). 더 길게 기다리는 것은 **여러 번 부르는 것**으로
/// 하고, 그 횟수도 5분쯤에서 멈추라고 안내가 말한다([`INSTRUCTIONS`]).
const WAIT_DEFAULT_SECONDS: u32 = 60;
const WAIT_MIN_SECONDS: u32 = 1;
const WAIT_MAX_SECONDS: u32 = 120;

/// 얼마나 자주 저장소를 다시 보나. condvar 을 두지 않는 이유는 [`wait_for_operation`] 문서에.
const WAIT_POLL: Duration = Duration::from_millis(250);

/// 이 상태에서 **더 기다릴 뜻이 있는가** — 순수 함수(테스트 대상).
///
/// 기다리는 셋은 `awaitingApproval`(사람을 기다림) · `approved`·`running`(앱이 도는 중)이다.
/// 나머지(초안·거절·만료·성공·부분·실패·취소)는 기다려도 바뀌지 않으므로 **즉시** 돌려준다.
/// 초안이 여기 없는 것이 중요하다 — 검토를 요청하지 않은 작업안을 기다리면 영원히 안 온다.
pub(crate) fn waiting_state(state: operations::OperationState) -> bool {
    use operations::OperationState as S;
    matches!(state, S::AwaitingApproval | S::Approved | S::Running)
}

/// `wait_for_operation` — 상태가 [`waiting_state`] 를 벗어날 때까지 **서버가** 붙잡는다(롱폴).
/// **실행도 승인도 아니다.**
///
/// ## 왜 만들었나 (2026-09-22)
///
/// 앞선 안내는 "터미널 상태가 올 때까지 몇 초마다 `get_operation` 을 폴링하라 · 벽에 부딪혔다고
/// 멈추지 마라" 였다. 승인 창이 30분이면 그 지시는 **도구 호출 수백 번**이고 그 전부가 클라이언트
/// 컨텍스트를 채운다. 게다가 사람이 자리를 비웠으면 그 수백 번은 통째로 헛일이다.
///
/// 핵심은 **실행을 앱이 한다**는 것이다 — 사람이 앱에서 승인하는 순간 브로커가 혼자 돌리고
/// 결과는 `get_operation_results` 에 남는다. AI 가 그 자리를 지킬 이유가 없다. 그래서 기다림을
/// 도구 하나로 접고(한 번에 최대 120초), 몇 번 부른 뒤에는 **사람에게 턴을 넘기라**고
/// [`INSTRUCTIONS`] 가 말한다.
///
/// ## 어떻게
///
/// 250ms 마다 저장소를 다시 본다. **condvar 은 두지 않는다** — 상태를 바꾸는 쪽(Tauri 승인·
/// 거절·executor·게으른 만료)이 여럿이라 전부에 신호를 얹는 것보다 250ms 잠 하나가 싸고
/// 단순하다(재발을 보기 전에 기계를 늘리지 않는다 · CLAUDE.md). 매번 `get_operation` 과
/// **같은 게으른 만료**(`expire_stale`)를 돌리고 거둔 id 마다 `operation-state{expired}` 를
/// 쏘므로, 만료된 것을 기다리면 그 자리에서 `expired` 가 나온다.
///
/// ## 잠금
///
/// 컨텍스트 잠금은 **아예 잡지 않는다**([`tools_call`](super::rpc::tools_call) 이 잠금 앞에서 갈라낸다). 작업안 잠금은
/// 한 번 볼 때만 잡았다 바로 푼다 — **자는 동안에는 아무 잠금도 쥐고 있지 않다.**
pub(super) fn wait_for_operation(
    ops: &OperationStore,
    signal: &McpSignal,
    args: Option<&Value>,
) -> Result<Value, String> {
    wait_for_operation_with(ops, signal, args, operations::approval_ttl_ms())
}

/// [`wait_for_operation`] 의 몸통 — TTL 을 **인자로** 받는다.
///
/// TTL 은 원래 `settings.toml` 에서 온다(`approval_ttl_ms`, 디스크 읽기). 여기서 한 번만 읽어
/// 루프 내내 쓰는 이유가 둘이다: (a) 250ms 마다 설정 파일을 읽지 않는다, (b) 테스트가 사용자의
/// `settings.toml`(기본 30분일 수도, `0`=만료 없음일 수도)에 흔들리지 않게 값을 끼울 수 있다.
/// 기다리는 동안 사람이 TTL 을 바꿔도 이 한 번의 대기(≤120초)는 옛 값으로 끝난다 — 다음 호출이
/// 새 값을 읽는다.
pub(super) fn wait_for_operation_with(
    ops: &OperationStore,
    signal: &McpSignal,
    args: Option<&Value>,
    ttl_ms: u64,
) -> Result<Value, String> {
    let operation_id = args
        .and_then(|a| a.get("operationId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The operationId argument is required".to_string())?;
    let timeout = clamp_int_arg(
        args.and_then(|a| a.get("timeoutSeconds")),
        WAIT_DEFAULT_SECONDS,
        WAIT_MIN_SECONDS,
        WAIT_MAX_SECONDS,
        "timeoutSeconds",
    )?;
    let deadline = Duration::from_secs(timeout as u64);
    let started = std::time::Instant::now();

    loop {
        let (expired, found) = {
            let mut opmap = ops
                .lock()
                .map_err(|_| "Could not lock the task plan store".to_string())?;
            let expired = operations::expire_stale(&mut opmap, operations::now_ms(), ttl_ms);
            let found = operations::get(&opmap, operation_id).cloned();
            (expired, found)
        }; // 작업안 잠금은 여기서 풀린다 — 내보내기도 잠도 그 뒤다(잠금 위에서 자지 않는다).

        for id in expired {
            signal.emit_state(&id, operations::OperationState::Expired);
        }
        // 없는 id 는 기다려도 생기지 않는다 — `get_operation` 과 같은 오류로 즉시 되돌린다.
        let Some(op) = found else {
            return Err(format!("No such task plan: {operation_id}"));
        };

        let waited = started.elapsed();
        let still_waiting = waiting_state(op.state);
        if !still_waiting || waited >= deadline {
            let mut value = with_ttl(serde_json::to_value(&op).unwrap_or(Value::Null), ttl_ms);
            if let Some(obj) = value.as_object_mut() {
                // `timedOut` 은 "아직 기다리는 상태인데 시간이 다 됐다" 는 뜻이다 —
                // 상태가 바뀌어 돌아왔으면 시간이 얼마가 걸렸든 `false`.
                obj.insert("timedOut".to_string(), Value::Bool(still_waiting));
                obj.insert("waitedSeconds".to_string(), json!(waited.as_secs()));
            }
            return Ok(value);
        }
        // 남은 시간보다 길게 자지 않는다 — `timeoutSeconds:1` 이 1초에 정확히 돌아오게.
        std::thread::sleep(WAIT_POLL.min(deadline - waited));
    }
}

/// 작업안 JSON 에 **`approvalTtlSeconds`** 한 칸을 얹는다 — AI 가 얼마나 기다릴 창이 있는지 알
/// 수 있게. `ttl_ms == 0`(만료 없음)이면 `null` 이다.
///
/// `requestedAt`·`expiresAt` 은 [`operations::Operation`] 자신의 필드라 이미 실려 있다(둘 다
/// camelCase serde). 여기서는 설정에서 온 값 하나만 더한다 — 작업안이 아니라 **앱의 정책**이라
/// 저장소에 담지 않는다.
pub(super) fn with_ttl(mut value: Value, ttl_ms: u64) -> Value {
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "approvalTtlSeconds".to_string(),
            if ttl_ms == 0 {
                Value::Null
            } else {
                json!(ttl_ms / 1000)
            },
        );
    }
    value
}

/// 대상별 stdout/stderr 발췌 상한(문자 수). 넘으면 **뒤(tail)** 를 남기고 `outputTruncated` 를 켠다.
///
/// executor 원시는 이미 64KB tail 로 잘려 저장되지만, 여러 대상 × 두 스트림이면 MCP 한 응답이
/// MB 단위로 부풀 수 있어 읽을 때 한 번 더 조인다. 발췌라 잘렸으면 그 사실을 정직히 표시한다.
pub(super) const RESULT_FIELD_CAP: usize = 8 * 1024;

/// 문자열을 **뒤에서** `cap` 문자까지 남긴다 — `(발췌, 잘렸는가)`. 마지막이 가장 최근 출력이다.
fn truncate_tail(s: &str, cap: usize) -> (String, bool) {
    let count = s.chars().count();
    if count <= cap {
        (s.to_string(), false)
    } else {
        (s.chars().skip(count - cap).collect(), true)
    }
}

/// `get_operation_results` — 한 작업안의 **대상별 실행 결과**를 읽는다(단계 9 결과 읽기). **읽기 전용.**
///
/// 정점 루프의 마지막 조각이다: AI 가 `get_operation` 으로 집계 상태(succeeded/failed/partial/…)를
/// 폴링하다 실행이 끝나면(또는 도는 중에도) 이 도구로 **대상별 출력**을 읽어 다음 판단을 짠다.
/// 집계 상태와 무관하게 **지금 있는 만큼** 돌려준다(실행 중 부분 결과도 진행 상황이다).
///
/// ## 이 도구는 실행하지 않는다
///
/// [`ResultStore`] 를 **읽기만** 한다 — 승인·실행·취소 경로는 이 서버에 없다(그건 Tauri 명령
/// 전용, MCP 아님). AI 는 결과를 볼 수는 있어도 무엇도 시작하지 못한다.
///
/// ## 실행 시점 공유 권한 재검사(프라이버시)
///
/// 대상 세션이 실행 뒤에 **AI 읽기 허용을 껐다면**, 그 대상의 `stdout`/`stderr` 는 비우고
/// `redacted:true` 로 표시한다(상태·종료 코드·시각은 남긴다 — 그건 세션 내용이 아니다). 공유 중인
/// 대상만 `code`(타일 위치)를 붙인다([`shared_entry`] 와 같은 게이트를 결과에도 건다).
pub(super) fn get_operation_results(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    results: &ResultStore,
    args: Option<&Value>,
    db: &super::DbEnv,
) -> Result<Value, String> {
    let operation_id = args
        .and_then(|a| a.get("operationId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The operationId argument is required".to_string())?;

    // 결과 저장소를 짧게 스냅샷(안정 순서). 없으면 빈 배열 — 폴링 AI 에겐 "아직 결과 없음" 이다.
    let snapshot = operations::results_snapshot(results, operation_id);

    let targets: Vec<Value> = snapshot
        .into_iter()
        .map(|(stream_id, r)| {
            // 실행 시점이 아니라 **지금** 읽기 가시성을 다시 본다 — 그 사이 껐으면 검열한다.
            // 원격은 호스트 AI 권한(`read`), 로컬은 타일의 읽기 허용([`crate::context::ai_readable`]).
            // DB 대상(`db:<연결 id>` — 쿼리 타일 3b)은 그 연결의 **지금** AI 권한이 읽기 전용 이상일 때만 행을 싣는다.
            let db_conn = stream_id.strip_prefix(operations::DB_TARGET_PREFIX);
            let shared = match db_conn {
                Some(id) => super::db::level_of(delegation, db, id) >= crate::db::ai::DbAiLevel::Read,
                None => map.get(&stream_id).is_some_and(|c| crate::context::ai_readable(c, delegation)),
            };
            let mut obj = json!({
                "id": stream_id,
                "state": r.state,
                "exitCode": r.exit_code,
                "startedAt": r.started_at,
                "endedAt": r.ended_at,
                "errorClass": r.error_class,
            });
            let o = obj.as_object_mut().expect("json! 객체");
            if let Some(v) = &r.db {
                o.insert("db".into(), if shared { v.clone() } else { db_without_rows(v) });
            }
            if shared {
                let (out, out_t) = truncate_tail(&r.stdout, RESULT_FIELD_CAP);
                let (err, err_t) = truncate_tail(&r.stderr, RESULT_FIELD_CAP);
                o.insert("stdout".into(), Value::String(out));
                o.insert("stderr".into(), Value::String(err));
                o.insert("outputTruncated".into(), Value::Bool(out_t || err_t));
                // exec 원시가 64KB 상한에서 앞을 버렸는가 — 위 발췌 상한과 별개의 더 앞단 잘림.
                o.insert("stdoutTruncated".into(), Value::Bool(r.stdout_truncated));
                o.insert("stderrTruncated".into(), Value::Bool(r.stderr_truncated));
                o.insert("redacted".into(), Value::Bool(false));
                // 공유 중인 대상만 타일 위치 code 를 붙인다(다른 읽기 도구의 id/code 분리와 같다).
                if let Some(c) = map.get(&stream_id) {
                    o.insert("code".into(), Value::String(c.code.clone()));
                }
            } else {
                // 옵트아웃(또는 사라진 세션) — 출력은 감추고 상태/시각만 남긴다.
                o.insert("stdout".into(), Value::String(String::new()));
                o.insert("stderr".into(), Value::String(String::new()));
                o.insert("outputTruncated".into(), Value::Bool(false));
                o.insert("stdoutTruncated".into(), Value::Bool(false));
                o.insert("stderrTruncated".into(), Value::Bool(false));
                o.insert("redacted".into(), Value::Bool(true));
            }
            obj
        })
        .collect();

    Ok(json!({ "operationId": operation_id, "results": targets }))
}

/// DB 결과에서 행(값)을 걷는다 — 영향 행 수 · 시간 · 결과는 남긴다(값이 아니다).
fn db_without_rows(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(list) = v.get_mut("statements").and_then(Value::as_array_mut) {
        for s in list.iter_mut().filter_map(Value::as_object_mut) {
            s.remove("rows");
            s.remove("columns");
        }
    }
    v["redacted"] = Value::Bool(true);
    v
}

// ---------------------------------------------------------------------------
// 자동 승인 범위 읽기 — `get_auto_approval_policy`
// (docs/log/2026-09-16-auto-approval-chaining.md).
// ---------------------------------------------------------------------------

/// `get_auto_approval_policy` — 사용자가 정한 **자동 승인 범위**를 읽어 준다. **읽기 전용**.
///
/// ## 왜 이 도구가 생겼나
///
/// AI 는 지금까지 자기 작업안이 왜 사람을 기다리는지 알 길이 없었다. 범위를 **읽을 수 있으면**
/// 처음부터 그 안에 드는 작업안을 짤 수 있다(명령 하나 · `cd &&` 대신 `cwd` · 파이프 금지).
/// 안내는 도구 설명과 핸드셰이크 `instructions` 에도 같이 실린다.
///
/// ## 이 도구가 늘리지 않는 것 (보안 불변)
///
/// **쓰기 표면은 0 이다.** 설정 파일을 읽어 요약할 뿐, 정책을 바꾸는 인자도 경로도 없다 —
/// 자동 승인을 켜고 목록을 넓히는 것은 여전히 앱의 설정 화면(사람)뿐이고, 승인·실행은 여전히
/// Tauri 전용이다. 비밀은 나가지 않는다: 위임은 **숫자 요약**만 내보내고(별칭·호스트·사용자
/// 이름 없음), allowlist 는 사용자가 직접 적은 명령 패턴이라 자격증명이 아니다.
/// 자동 승인 **묶음의 이름·설명을 영어로** — id 로 찾는 표 하나.
///
/// 왜 여기 있고 `automation_presets.rs` 가 아닌가: 그 표의 한국어 글자는
/// `src/lib/automation-presets.ts` 와 **글자까지 잠근 드리프트 테스트**에 걸려 있다. 한쪽에
/// 칸을 더하거나 문장을 손대면 그 잠금이 깨지므로, 데이터는 건드리지 않고 **MCP 가 내보낼
/// 때만** 영어로 갈아 끼운다(그 글자를 읽는 것은 사람이 아니라 모델이다 — i18n.rs 머리말).
/// 모르는 id 는 원래 값을 그대로 쓴다(그 일이 없다는 것은 아래 테스트가 지킨다).
pub(super) fn bundle_text_en(
    b: &crate::automation_presets::Bundle,
) -> (&'static str, &'static str) {
    match b.id {
        "system" => (
            "System state",
            "Commands that look at disk, memory, CPU, processes, logged-in users and time. Forms that change the time or host name are blocked.",
        ),
        "services" => (
            "Service checks",
            "Service status, timers and unit files, nginx config test, crontab listing. No start, stop or restart.",
        ),
        "pkg" => (
            "Package queries",
            "Commands that show installed packages and versions (apt, dpkg, rpm, pip, npm, snap). No install, remove or update.",
        ),
        "files" => (
            "File reads",
            "Commands that read file listings, contents, sizes and hashes. They do not write, but they read secret files too.",
        ),
        "logs" => (
            "Log reads",
            "Commands that read the system journal and kernel log. Following and log deletion or rotation are blocked.",
        ),
        "network" => (
            "Network queries",
            "Sockets, addresses, routes, name resolution and reachability. Forms that change addresses or routes and socket killing are blocked.",
        ),
        "docker" => (
            "Containers",
            "Read-only docker queries for containers, images, networks, volumes and compose. No run, stop or remove. inspect also shows environment variables.",
        ),
        "k8s" => (
            "Kubernetes",
            "kubectl reads (get, describe, logs, top, events) and helm list/status. No apply, delete or exec.",
        ),
        "git" => (
            "Git inspection",
            "The git subcommands that read a repository's state. fetch, which uses the network, is a separate bundle. No pull, checkout or reset.",
        ),
        "gitfetch" => (
            "Git fetch",
            "git fetch to bring in new remote commits. It does not touch the working tree — one remote name at most, no refspecs.",
        ),
        _ => (b.name, b.description),
    }
}

pub(super) fn get_auto_approval_policy() -> Value {
    let prefs = crate::settings::automation_prefs();
    // 위임(`delegation.toml`)의 `auto_execute` 위임은 **대상별 둘째 문**이다(A4a) — 전역 정책을
    // 통과해도 대상마다 위임이 없으면 무인 실행이 없다. AI 에게는 "열린 대상이 있는가" 라는
    // 불(不)값과 개수만 알려 준다(별칭·주소는 절대 나가지 않는다).
    let delegation = crate::delegation::Delegation::load_default();
    let granted = delegation.auto_execute_granted_count();
    // 모두 승인(10-23) — 개수만(별칭은 내보내지 않는다 · 어느 세션인지는 `list_sessions` 의 `approveAll`).
    let approve_all = delegation.approve_all_granted_count();

    // 규칙은 **펼친 뒤**에 내보낸다 — AI 가 보는 목록이 백엔드가 실제로 판정하는 목록과
    // 같아야 한다(묶음을 켰는데 응답에 안 보이면 AI 는 열려 있는 일까지 사람을 기다린다).
    // 어디서 온 규칙인지 `source` 로 말해 준다: 사용자가 적은 것(`user`) · 묶음(`bundle:<id>`).
    // 인자 제약(`deny_flags`·`allow_flags`·`require_flags`·`first_arg`·`max_args`)은 **있을 때만**
    // 실린다(`AllowRule` 직렬화가 빈 칸을 건너뛴다) — AI 가 `journalctl -f` 처럼 범위 밖인 꼴을
    // 미리 피할 수 있게.
    let rule_json = |r: &crate::settings::AllowRule, source: &str| {
        let mut v = serde_json::to_value(r).unwrap_or_else(|_| json!({ "exec": r.exec }));
        if let Some(o) = v.as_object_mut() {
            o.insert("source".to_string(), json!(source));
        }
        v
    };
    let mut rules: Vec<Value> = prefs.allow.iter().map(|r| rule_json(r, "user")).collect();
    for id in &prefs.bundles {
        let Some(b) = crate::automation_presets::bundle_by_id(id) else {
            continue; // 모르는 id 는 무시(설정 파일에는 그대로 남는다).
        };
        let source = format!("bundle:{}", b.id);
        for r in b.rules {
            // 사람이 묶음 안에서 끈 명령은 판정에서 빠지므로 여기서도 뺀다(백엔드가 보는 목록 그대로).
            if crate::automation_presets::is_off(&prefs.bundle_off, b.id, &r.command_key()) {
                continue;
            }
            rules.push(rule_json(&r.to_allow_rule(), &source));
        }
    }

    // 묶음 목록은 **전부** 내보낸다(켠 것만이 아니라) — AI 가 "무엇을 켜면 되는지" 가 아니라
    // "지금 무엇이 켜져 있는지" 를 이름으로 알 수 있게. 켜는 것은 여전히 사람뿐이다.
    let bundles: Vec<Value> = crate::automation_presets::BUNDLES
        .iter()
        .map(|b| {
            let (name_en, description_en) = bundle_text_en(b);
            json!({
                "id": b.id,
                "name": name_en,
                // 설명도 싣는다 — 앱의 고정 문구라 비밀이 아니고, AI 가 범위를 이름이 아니라
                // 뜻으로 읽을 수 있다(이 필드의 유일한 다른 독자는 설정 화면이다).
                "description": description_en,
                "enabled": prefs.bundles.iter().any(|id| id == b.id),
                // 사람이 이 묶음 안에서 끈 명령 키(없으면 빈 배열) — 위 `rules` 에서는 이미 빠져 있다.
                "commandsOff": b
                    .command_keys()
                    .into_iter()
                    .filter(|k| crate::automation_presets::is_off(&prefs.bundle_off, b.id, k))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();

    json!({
        "enabled": prefs.auto_approve,
        // 파이프 허용(10-22 옵트인) — 켜져 있으면 맨 `|` 단계마다 허용 범위여야 한다(다른 명령을 실행하는 단계는 늘 제외).
        "allowPipes": prefs.allow_pipes,
        "allow": prefs.allow_patterns,
        "bundles": bundles,
        "rules": rules,
        "caps": {
            "maxTargets": prefs.max_targets,
            "maxConcurrency": prefs.max_concurrency,
        },
        "rateLimit": {
            "maxPerWindow": prefs.auto_max_per_window,
            "windowSeconds": prefs.auto_window_secs,
        },
        "delegationAutoExecute": {
            "anyGranted": granted > 0,
            "grantedCount": granted,
        },
        // 모두 승인 — 이 호스트들(세션의 `approveAll`) · DB(`aiLevel: all`)만 대상인 작업안은 위 범위와 상관없이 곧바로 자동 승인된다(caps 와
        // `enabled` 는 그대로 본다).
        "approveAll": {
            "anyGranted": approve_all > 0,
            "grantedCount": approve_all,
            "note": "Hosts the user set to 'YOLO' (approveAll:true in list_sessions) and databases with aiLevel 'all': while enabled is true, a plan whose targets are all of them is approved at once — no allow list, no risk check, no rate limit (caps still apply).",
        },
        "note": "Read-only — this tool cannot change the policy, and this server has no approve or run path. \
    Auto-approval happens only when the **whole** command falls inside this scope: it matches the allow list (a word-boundary prefix in allow, or an exec+subcommand in rules), \
    it does not look dangerous (rm, sudo, chmod, kill, reboot, systemctl restart and the like are excluded even if you put them on the list), the target count is within caps, and rateLimit is not exceeded. \
    A command joined with `&&`, `||` or `;` must pass all of that **in every segment** (cd is no exception — pass the directory as the task plan's cwd argument instead). \
    Pipes (|) only when allowPipes is true, and then **every stage** must pass on its own; a stage that runs another command (xargs, sh/bash, env, sudo, ssh, python, tee, find -exec/-delete …) is always excluded, and pipes cannot be mixed with `;` or `||`.     Any redirect (> <), substitution ($ `), subshell (()) or background (&) — or a pipe while allowPipes is false — and the whole command waits for a person's approval."
    })
}
