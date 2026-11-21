//! 작업안 읽기 도구 — 롱폴 `wait_for_operation` · 대상별 결과 `get_operation_results` · 자동 승인 범위 `get_auto_approval_policy`.
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

/// 상한 120초는 HTTP 한 요청이 열려 있어도 안전한 선이다 — 더 길게는 여러 번 부르고, 5분쯤에서 멈추라고 [`INSTRUCTIONS`] 가 말한다.
const WAIT_DEFAULT_SECONDS: u32 = 60;
const WAIT_MIN_SECONDS: u32 = 1;
const WAIT_MAX_SECONDS: u32 = 120;

/// condvar 은 두지 않는다 — 상태를 바꾸는 쪽(Tauri 승인·거절·executor·게으른 만료)이 여럿이라 250ms 잠 하나가 싸고 단순하다.
const WAIT_POLL: Duration = Duration::from_millis(250);

/// 초안이 여기 없는 것이 중요하다 — 검토를 요청하지 않은 작업안을 기다리면 영원히 안 온다.
pub(crate) fn waiting_state(state: operations::OperationState) -> bool {
    use operations::OperationState as S;
    matches!(state, S::AwaitingApproval | S::Approved | S::Running)
}

/// `wait_for_operation` — 상태가 [`waiting_state`] 를 벗어날 때까지 **서버가** 붙잡는다(롱폴). **실행도 승인도 아니다.**
/// 확인마다 `get_operation` 과 같은 게으른 만료를 돌리므로, 만료된 것을 기다리면 그 자리에서 `expired` 가 나온다.
pub(super) fn wait_for_operation(
    ops: &OperationStore,
    signal: &McpSignal,
    args: Option<&Value>,
) -> Result<Value, String> {
    wait_for_operation_with(ops, signal, args, operations::approval_ttl_ms())
}

/// TTL 을 인자로 받는다 — 250ms 마다 설정 파일을 읽지 않고, 시험이 사용자의 `settings.toml` 에 흔들리지 않게.
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
        let Some(op) = found else {
            return Err(format!("No such task plan: {operation_id}"));
        };

        let waited = started.elapsed();
        let still_waiting = waiting_state(op.state);
        if !still_waiting || waited >= deadline {
            let mut value = with_ttl(serde_json::to_value(&op).unwrap_or(Value::Null), ttl_ms);
            if let Some(obj) = value.as_object_mut() {
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

/// 작업안이 아니라 앱의 정책이라 저장소에 담지 않고 낼 때 얹는다. `ttl_ms == 0`(만료 없음)이면 `null`.
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

/// 대상별 stdout/stderr 발췌 상한(문자 수) — 여러 대상 × 두 스트림이면 한 응답이 MB 단위로 부풀어 읽을 때 한 번 더 조인다.
pub(super) const RESULT_FIELD_CAP: usize = 8 * 1024;

fn truncate_tail(s: &str, cap: usize) -> (String, bool) {
    let count = s.chars().count();
    if count <= cap {
        (s.to_string(), false)
    } else {
        (s.chars().skip(count - cap).collect(), true)
    }
}

/// `get_operation_results` — 한 작업안의 **대상별 실행 결과**를 읽는다. **읽기 전용** — 결과는 볼 수 있어도 무엇도 시작하지 못한다.
///
/// 대상이 실행 뒤에 AI 읽기 허용을 껐으면 `stdout`/`stderr` 를 비우고 `redacted:true`(상태·종료 코드·시각은 세션 내용이 아니라 남긴다).
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

    let snapshot = operations::results_snapshot(results, operation_id);

    let targets: Vec<Value> = snapshot
        .into_iter()
        .map(|(stream_id, r)| {
            // 실행 시점이 아니라 **지금** 읽기 가시성을 다시 본다. DB 대상은 그 연결의 지금 AI 권한이 읽기 전용 이상일 때만 행을 싣는다.
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
            // exec 원시가 64KB 상한에서 앞을 버렸는가 — 위 발췌 상한과 별개의 앞단 잘림.
                o.insert("stdoutTruncated".into(), Value::Bool(r.stdout_truncated));
                o.insert("stderrTruncated".into(), Value::Bool(r.stderr_truncated));
                o.insert("redacted".into(), Value::Bool(false));
                if let Some(c) = map.get(&stream_id) {
                    o.insert("code".into(), Value::String(c.code.clone()));
                }
            } else {
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

/// 영향 행 수 · 시간 · 결과는 남긴다(값이 아니다).
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
// 자동 승인 범위 읽기 — `get_auto_approval_policy` (docs/log/2026-09-16-auto-approval-chaining.md)
// ---------------------------------------------------------------------------

/// 자동 승인 묶음의 이름·설명을 영어로 — `automation_presets.rs` 의 한국어 글자는 `src/lib/automation-presets.ts` 와
/// 글자까지 잠근 드리프트 테스트에 걸려 있어, 데이터는 두고 MCP 가 내보낼 때만 갈아 끼운다. 모르는 id 는 원래 값 그대로.
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

/// 쓰기 표면은 0 이다 — 자동 승인을 켜고 목록을 넓히는 것은 앱의 설정 화면(사람)뿐이다. 위임은 숫자 요약만 낸다(별칭·호스트·사용자 이름 없음).
pub(super) fn get_auto_approval_policy() -> Value {
    let prefs = crate::settings::automation_prefs();
    // `auto_execute` 위임은 대상별 둘째 문이다 — 개수만 알려 준다(별칭·주소는 절대 나가지 않는다).
    let delegation = crate::delegation::Delegation::load_default();
    let granted = delegation.auto_execute_granted_count();
    // 모두 승인 — 개수만(어느 세션인지는 `list_sessions` 의 `approveAll`).
    let approve_all = delegation.approve_all_granted_count();

    // 규칙은 **펼친 뒤**에 내보낸다 — AI 가 보는 목록이 백엔드가 실제로 판정하는 목록과 같아야 한다.
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
            // 사람이 묶음 안에서 끈 명령은 판정에서 빠지므로 여기서도 뺀다.
            if crate::automation_presets::is_off(&prefs.bundle_off, b.id, &r.command_key()) {
                continue;
            }
            rules.push(rule_json(&r.to_allow_rule(), &source));
        }
    }

    // 묶음 목록은 켠 것만이 아니라 **전부** 내보낸다 — 켜는 것은 여전히 사람뿐이다.
    let bundles: Vec<Value> = crate::automation_presets::BUNDLES
        .iter()
        .map(|b| {
            let (name_en, description_en) = bundle_text_en(b);
            json!({
                "id": b.id,
                "name": name_en,
                "description": description_en,
                "enabled": prefs.bundles.iter().any(|id| id == b.id),
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
        // 모두 승인 — 이 대상만인 작업안은 위 범위와 상관없이 곧바로 자동 승인된다(caps 와 `enabled` 는 그대로 본다).
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
