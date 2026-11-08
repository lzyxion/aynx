use super::*;
use std::collections::VecDeque;

/// 사람의 취소는 곁 사실로만 남는다 — 집계 상태(`partial`)는 그대로, 실행된 적 없는 작업안엔 안 찍힌다.
#[test]
fn mark_cancelled_by_user_is_a_side_fact_on_executed_plans_only() {
    let mut map = HashMap::new();
    let mut op = propose_for_test("op-run");
    op.state = OperationState::Running;
    map.insert("op-run".to_string(), op);
    let mut pending = propose_for_test("op-wait");
    pending.state = OperationState::AwaitingApproval;
    map.insert("op-wait".to_string(), pending);

    assert!(mark_cancelled_by_user(&mut map, "op-run"));
    finish(
        &mut map,
        "op-run",
        aggregate(&[TargetState::Succeeded, TargetState::Cancelled]),
    );
    assert_eq!(
        map["op-run"].state,
        OperationState::Partial,
        "집계는 그대로 partial"
    );
    assert!(map["op-run"].cancelled_by_user);
    assert!(
        !mark_cancelled_by_user(&mut map, "op-wait"),
        "대기 중은 실행이 아니다"
    );
    assert!(!map["op-wait"].cancelled_by_user);
    assert!(!mark_cancelled_by_user(&mut map, "nope"));

    // camelCase · 옛 JSON(칸 없음)은 false.
    let json = serde_json::to_string(&map["op-run"]).unwrap();
    assert!(json.contains("\"cancelledByUser\":true"), "{json}");
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap();
    v.as_object_mut().unwrap().remove("cancelledByUser");
    let back: Operation = serde_json::from_value(v).unwrap();
    assert!(!back.cancelled_by_user);
}

fn propose_for_test(id: &str) -> Operation {
    let mut map = HashMap::new();
    create_plan(
        &mut map,
        id.to_string(),
        "uptime".into(),
        vec!["a".into(), "b".into()],
        None,
        None,
        "exec".into(),
        "sequential".into(),
        1,
        60,
        None,
        None,
        0,
        None,
    )
}

// ── A4c 빈도 한도(rate_limit_admit) — 순수 함수 ─────────────────────────────

/// 창 안에서 max 건까지 허용하고, max+1 째는 거부한다(넣지 않는다).
#[test]
fn rate_limit_admits_up_to_max_then_blocks() {
    let mut stamps = VecDeque::new();
    let window = 300_000u64; // 5분
                             // 같은 순간(now=1000)에 세 번 — max=3 이면 셋 다 허용.
    assert!(rate_limit_admit(&mut stamps, 1000, 3, window));
    assert!(rate_limit_admit(&mut stamps, 1000, 3, window));
    assert!(rate_limit_admit(&mut stamps, 1000, 3, window));
    // 네 번째는 거부 — 그리고 거부는 슬롯을 소모하지 않는다(len 은 3 그대로).
    assert!(!rate_limit_admit(&mut stamps, 1000, 3, window));
    assert_eq!(stamps.len(), 3, "거부는 타임스탬프를 넣지 않는다");
}

/// 창을 벗어난 옛 타임스탬프는 만료돼, 창이 지난 뒤 다시 허용된다.
#[test]
fn rate_limit_expires_old_entries_after_window() {
    let mut stamps = VecDeque::new();
    let window = 300_000u64;
    // now=0 에서 2건으로 채운다(max=2 → 가득).
    assert!(rate_limit_admit(&mut stamps, 0, 2, window));
    assert!(rate_limit_admit(&mut stamps, 0, 2, window));
    assert!(
        !rate_limit_admit(&mut stamps, 0, 2, window),
        "창 안에서 가득"
    );
    // 창을 막 넘긴 시각(0 + window + 1) — 옛 둘이 만료돼 다시 허용.
    assert!(
        rate_limit_admit(&mut stamps, window + 1, 2, window),
        "창이 지나면 다시 허용"
    );
    assert_eq!(stamps.len(), 1, "옛 둘은 버리고 새 하나만 남는다");
}

/// 경계: 정확히 창 길이만큼 지난(front == cutoff) 항목은 아직 유효하다(엄격한 초과만 버림).
#[test]
fn rate_limit_boundary_keeps_entry_exactly_at_window_edge() {
    let mut stamps = VecDeque::new();
    let window = 100u64;
    assert!(rate_limit_admit(&mut stamps, 50, 1, window)); // t=50 기록
                                                           // now=150 이면 cutoff=50, front(50) < 50 은 거짓 → 유지 → 가득 → 거부.
    assert!(
        !rate_limit_admit(&mut stamps, 150, 1, window),
        "경계는 아직 유효"
    );
    // now=151 이면 cutoff=51, front(50) < 51 참 → 만료 → 허용.
    assert!(
        rate_limit_admit(&mut stamps, 151, 1, window),
        "경계를 넘으면 만료"
    );
}

/// max==0 이면 언제나 거부(설정은 1 로 자르지만 헬퍼 자체가 견고해야 한다).
#[test]
fn rate_limit_max_zero_always_blocks() {
    let mut stamps = VecDeque::new();
    assert!(!rate_limit_admit(&mut stamps, 1000, 0, 300_000));
    assert!(stamps.is_empty(), "거부는 아무것도 넣지 않는다");
}

/// 단계별 별칭 셋 — `h-read`(읽기 전용) · `h-approve`(승인 후 실행) · `h-auto`(자동 승인 실행).
/// 손으로 파싱한 위임이라 실제 delegation.toml 에 기대지 않는다.
fn stage_delegation() -> crate::delegation::Delegation {
    crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"h-read\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true

[[target]]
alias = \"h-approve\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true

[[target]]
alias = \"h-auto\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
auto_execute = true
",
    )
    .unwrap()
}

/// 창 타일 하나(정체성만) — `host_alias` 가 `None` 이면 호스트 목록 밖(빠른 접속) 타일이다.
fn tile(kind: &str, host_alias: Option<&str>) -> crate::context::SessionContext {
    crate::context::SessionContext {
        label: host_alias.unwrap_or("adhoc").to_string(),
        kind: kind.to_string(),
        opted_in: true,
        host_alias: host_alias.map(str::to_string),
        ..Default::default()
    }
}

#[test]
fn run_time_recheck_gates_window_tiles_by_host_permission_too() {
    let d = stage_delegation();
    // 창 원격 타일 — 그 호스트의 누적 read && propose.
    assert!(delegated_propose_still_live("w1", Some(&tile("ssh", Some("h-approve"))), &d));
    assert!(delegated_propose_still_live("w1", Some(&tile("ssh", Some("H-AUTO"))), &d));
    assert!(
        !delegated_propose_still_live("w1", Some(&tile("ssh", Some("h-read"))), &d),
        "읽기 전용으로 내려가면 실행하지 않는다"
    );
    assert!(
        !delegated_propose_still_live("w1", Some(&tile("ssh", Some("gone"))), &d),
        "권한이 지워진 호스트"
    );
    // 별칭 없는 원격·로컬·거울에 없는 창 대상은 실행 불가.
    assert!(!delegated_propose_still_live("w1", Some(&tile("ssh", None)), &d));
    assert!(!delegated_propose_still_live("w1", Some(&tile("local", None)), &d));
    assert!(!delegated_propose_still_live("w1", None, &d));
    // 헤드리스 id — 거울 없이 별칭으로.
    assert!(delegated_propose_still_live("delegated:h-approve", None, &d));
    assert!(!delegated_propose_still_live("delegated:h-read", None, &d));
    assert!(!delegated_propose_still_live("delegated:ghost", None, &d));
}

/// 승인 뒤(예산 대기·자동 접속 중) 호스트 권한을 내리면 **실행 직전 재검사**가 그 대상을 실패로 끝낸다.
/// 위임 표는 재검사마다 새로 읽으므로, 같은 대상을 '승인 때의 표' 와 '내린 뒤의 표' 로 차례로 본다.
#[test]
fn permission_lowered_after_approval_fails_at_pre_exec_recheck() {
    let approve_time = stage_delegation();
    // 승인 때 — 창 타일·헤드리스 둘 다 통과(재검사는 아무것도 막지 않는다).
    let win = tile("ssh", Some("h-approve"));
    assert!(permission_recheck_failure("w1", Some(&win), &approve_time).is_none());
    assert!(permission_recheck_failure("delegated:h-approve", None, &approve_time).is_none());

    // 슬롯을 기다리는 사이 h-approve 를 읽기 전용으로 내리고, h-auto 는 위임 표에서 지운다(끔).
    let lowered = crate::delegation::Delegation::parse(
        "[[target]]
alias = \"h-approve\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
",
    )
    .unwrap();
    for (id, ctx) in [
        ("w1", Some(&win)),
        ("delegated:h-approve", None),
        ("delegated:h-auto", None),
    ] {
        let r = permission_recheck_failure(id, ctx, &lowered)
            .unwrap_or_else(|| panic!("{id}: 권한을 내렸는데 실행 직전 재검사를 통과했다"));
        assert_eq!(r.state, TargetState::Failed, "{id}");
        assert!(r.exit_code.is_none(), "{id}: 실행하지 않았으니 종료 코드가 없다");
        assert!(r.error_class.is_some(), "{id}: 실패 이유가 결과에 남는다");
        assert!(r.started_at.is_some() && r.ended_at.is_some(), "{id}");
    }
}

fn plan(map: &mut HashMap<String, Operation>, id: &str, targets: &[&str], at: u64) -> Operation {
    create_plan(
        map,
        id.to_string(),
        "systemctl restart nginx".to_string(),
        targets.iter().map(|s| s.to_string()).collect(),
        None,
        None,
        "adhoc".to_string(),
        "rolling".to_string(),
        1,
        60,
        Some("nginx 재시작".to_string()),
        None,
        at,
        None,
    )
}

#[test]
fn finished_to_evict_prunes_oldest_finished_keeps_open_and_running() {
    let mut m = HashMap::new();
    // 끝난 것 셋(created_at 100·200·300).
    plan(&mut m, "fin-old", &["a"], 100);
    finish(&mut m, "fin-old", OperationState::Succeeded);
    plan(&mut m, "fin-mid", &["a"], 200);
    finish(&mut m, "fin-mid", OperationState::Failed);
    plan(&mut m, "fin-new", &["a"], 300);
    finish(&mut m, "fin-new", OperationState::Partial);
    // 열린 것(Draft)·실행 중(Running) — **절대 세지도 지우지도 않는다**.
    plan(&mut m, "draft-1", &["a"], 150);
    plan(&mut m, "run-1", &["a"], 250);
    m.get_mut("run-1").unwrap().state = OperationState::Running;

    // keep=2 → 끝난 것 셋 중 가장 오래된 하나만 evict.
    assert_eq!(finished_to_evict(&m, 2), vec!["fin-old".to_string()]);
    // 넉넉하면 아무것도 안 지운다.
    assert!(finished_to_evict(&m, 100).is_empty());
    // keep=0 → 끝난 것 전부(열린·실행 중은 여전히 제외).
    let mut all = finished_to_evict(&m, 0);
    all.sort();
    assert_eq!(
        all,
        vec![
            "fin-mid".to_string(),
            "fin-new".to_string(),
            "fin-old".to_string()
        ]
    );
}

#[test]
fn exec_budget_default_carries_the_global_limit() {
    let b = ExecBudget::default();
    assert_eq!(b.0.available_permits(), GLOBAL_EXEC_LIMIT);
    assert_eq!(GLOBAL_EXEC_LIMIT, 32);
}

#[test]
fn create_plan_starts_in_draft() {
    let mut m = HashMap::new();
    let op = plan(&mut m, "op-1", &["a", "b"], 100);
    assert_eq!(op.state, OperationState::Draft);
    assert_eq!(op.targets, vec!["a".to_string(), "b".to_string()]);
    assert_eq!(op.command, "systemctl restart nginx");
    // 저장소에 그대로 들어간다.
    assert_eq!(m["op-1"].state, OperationState::Draft);
}

#[test]
fn create_plan_stores_cwd_and_serializes_camel_case() {
    let mut m = HashMap::new();
    let op = create_plan(
        &mut m,
        "op-cwd".to_string(),
        "df -h".to_string(),
        vec!["a".to_string()],
        Some("/var/log".to_string()),
        None,
        "adhoc".to_string(),
        "rolling".to_string(),
        1,
        60,
        None,
        None,
        100,
        None,
    );
    assert_eq!(op.cwd.as_deref(), Some("/var/log"));
    assert_eq!(m["op-cwd"].cwd.as_deref(), Some("/var/log"));
    let json = serde_json::to_string(&op).unwrap();
    assert!(json.contains("\"cwd\":\"/var/log\""), "{json}");
    // None cwd 는 null 로 직렬화된다(plan 헬퍼는 cwd=None).
    let none = plan(&mut m, "op-none", &["a"], 100);
    assert_eq!(none.cwd, None);
    assert!(serde_json::to_string(&none)
        .unwrap()
        .contains("\"cwd\":null"));
}

#[test]
fn create_plan_stores_validate_and_serializes_camel_case() {
    let mut m = HashMap::new();
    let op = create_plan(
        &mut m,
        "op-val".to_string(),
        "systemctl restart nginx".to_string(),
        vec!["a".to_string()],
        None,
        Some("systemctl is-active nginx".to_string()),
        "adhoc".to_string(),
        "rolling".to_string(),
        1,
        60,
        None,
        None,
        100,
        None,
    );
    assert_eq!(op.validate.as_deref(), Some("systemctl is-active nginx"));
    assert_eq!(
        m["op-val"].validate.as_deref(),
        Some("systemctl is-active nginx")
    );
    let json = serde_json::to_string(&op).unwrap();
    assert!(
        json.contains("\"validate\":\"systemctl is-active nginx\""),
        "{json}"
    );
    // None validate 는 null 로 직렬화된다(plan 헬퍼는 validate=None).
    let none = plan(&mut m, "op-none", &["a"], 100);
    assert_eq!(none.validate, None);
    assert!(serde_json::to_string(&none)
        .unwrap()
        .contains("\"validate\":null"));
}

#[test]
fn create_plan_stores_idempotency_key_and_serializes_camel_case() {
    let mut m = HashMap::new();
    let op = create_plan(
        &mut m,
        "op-idem".to_string(),
        "uptime".to_string(),
        vec!["a".to_string()],
        None,
        None,
        "adhoc".to_string(),
        "rolling".to_string(),
        1,
        60,
        None,
        None,
        100,
        Some("k1".to_string()),
    );
    assert_eq!(op.idempotency_key.as_deref(), Some("k1"));
    assert_eq!(m["op-idem"].idempotency_key.as_deref(), Some("k1"));
    let json = serde_json::to_string(&op).unwrap();
    assert!(json.contains("\"idempotencyKey\":\"k1\""), "{json}");
    // 키 없는 작업안(plan 헬퍼)은 null 로 직렬화된다.
    let none = plan(&mut m, "op-none", &["a"], 100);
    assert_eq!(none.idempotency_key, None);
    assert!(serde_json::to_string(&none)
        .unwrap()
        .contains("\"idempotencyKey\":null"));
}

#[test]
fn find_by_idempotency_key_finds_replays_and_ignores_keyless_ops() {
    let mut m = HashMap::new();
    // 키 있는 작업안 하나 + 키 없는 작업안들.
    create_plan(
        &mut m,
        "op-k1".to_string(),
        "uptime".to_string(),
        vec!["a".to_string()],
        None,
        None,
        "adhoc".to_string(),
        "rolling".to_string(),
        1,
        60,
        None,
        None,
        100,
        Some("k1".to_string()),
    );
    plan(&mut m, "op-nokey", &["b"], 200); // idempotency_key = None

    // 있으면 그 작업안을 돌려준다(재시도 = 같은 op 재생).
    let found = find_by_idempotency_key(&m, "k1");
    assert!(found.is_some());
    assert_eq!(found.unwrap().operation_id, "op-k1");
    // 없는 키는 None.
    assert!(find_by_idempotency_key(&m, "k2").is_none());
    // 키 없는 작업안은 어떤 키로도 매치되지 않는다(None-key ops 무시).
    // (위에서 "k2" 가 None 인 걸로 이미 확인 — 키 없는 op 가 잡히면 Some 이었을 것.)

    // 상태와 무관하게 매치한다 — 실행 중/종료 상태로 옮겨도 같은 op 를 재생한다.
    m.get_mut("op-k1").unwrap().state = OperationState::Running;
    assert_eq!(
        find_by_idempotency_key(&m, "k1").unwrap().operation_id,
        "op-k1"
    );
    finish(&mut m, "op-k1", OperationState::Succeeded);
    assert_eq!(
        find_by_idempotency_key(&m, "k1").unwrap().operation_id,
        "op-k1"
    );
}

#[test]
fn compose_command_passes_through_when_no_cwd() {
    assert_eq!(compose_command(None, "df -h"), "df -h");
}

#[test]
fn compose_command_wraps_plain_path() {
    assert_eq!(
        compose_command(Some("/var/log"), "df -h"),
        "cd -- '/var/log' && ( df -h )"
    );
}

#[test]
fn compose_command_escapes_single_quote() {
    // 작은따옴표는 '\'' 로 이스케이프된다(POSIX 안전).
    assert_eq!(
        compose_command(Some("/a'b"), "ls"),
        "cd -- '/a'\\''b' && ( ls )"
    );
}

#[test]
fn compose_command_handles_spaces() {
    assert_eq!(
        compose_command(Some("/my dir/app"), "pwd"),
        "cd -- '/my dir/app' && ( pwd )"
    );
}

#[test]
fn request_moves_draft_to_awaiting_and_is_idempotent() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    let op = request(&mut m, "op-1", 0, 0).unwrap();
    assert_eq!(op.state, OperationState::AwaitingApproval);
    // 다시 요청해도 그대로(멱등).
    let op = request(&mut m, "op-1", 0, 0).unwrap();
    assert_eq!(op.state, OperationState::AwaitingApproval);
}

// ── 검토 대기 만료(TTL) — `request` 의 도장 + `expire_stale` ──────────────────

/// `request` 는 요청 시각과 만료 시각을 찍는다. TTL 0 이면 만료 시각은 `None`(만료 없음)이고,
/// 두 번째 요청(멱등)은 시계를 **다시 찍지 않는다** — 재시도로 만료가 연장되면 안 된다.
#[test]
fn request_stamps_requested_and_expires() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    let op = request(&mut m, "op-1", 1_000, 60_000).unwrap();
    assert_eq!(op.requested_at, Some(1_000));
    assert_eq!(op.expires_at, Some(61_000));

    // 멱등 재요청 — 훨씬 뒤에 불러도 시계는 그대로다.
    let again = request(&mut m, "op-1", 50_000, 60_000).unwrap();
    assert_eq!(
        again.requested_at,
        Some(1_000),
        "요청 시각은 다시 찍지 않는다"
    );
    assert_eq!(again.expires_at, Some(61_000), "만료가 연장되지 않는다");

    // TTL 0 = 만료 없음 — 요청 시각만 남고 만료 시각은 비어 있다.
    let mut m2 = HashMap::new();
    plan(&mut m2, "op-2", &["a"], 100);
    let op = request(&mut m2, "op-2", 7_000, 0).unwrap();
    assert_eq!(op.requested_at, Some(7_000));
    assert_eq!(op.expires_at, None);
}

/// 초안은 `created_at` + TTL 로, 대기는 `expires_at` 으로 만료된다.
#[test]
fn expire_stale_expires_old_draft_and_past_due_awaiting() {
    let mut m = HashMap::new();
    plan(&mut m, "op-fresh", &["a"], 9_000); // 갓 만든 초안
    plan(&mut m, "op-old", &["a"], 1_000); // 묵은 초안
    plan(&mut m, "op-wait", &["a"], 1_000);
    request(&mut m, "op-wait", 1_000, 5_000).unwrap(); // expires_at = 6_000

    // now=10_000, ttl=5_000 → 초안은 created_at<=5_000 이면 만료. op-fresh(9_000)는 산다.
    let expired = expire_stale(&mut m, 10_000, 5_000);
    assert_eq!(
        expired,
        vec!["op-old".to_string(), "op-wait".to_string()],
        "id 로 정렬된다"
    );
    assert_eq!(m["op-old"].state, OperationState::Expired);
    assert_eq!(m["op-wait"].state, OperationState::Expired);
    assert_eq!(m["op-fresh"].state, OperationState::Draft, "아직 어리다");

    // 두 번 불러도 **새로 만료된 것은 없다**(이미 Expired 라 다시 세지 않는다).
    assert!(expire_stale(&mut m, 10_000, 5_000).is_empty());
}

/// TTL 0 은 아무것도 만료시키지 않는다 — "만료 없음" 이라는 사용자의 답.
#[test]
fn expire_stale_does_nothing_when_ttl_zero() {
    let mut m = HashMap::new();
    plan(&mut m, "op-ancient", &["a"], 0);
    request(&mut m, "op-ancient", 0, 60_000).unwrap(); // expires_at = 60_000
    assert!(expire_stale(&mut m, 999_999_999, 0).is_empty());
    assert_eq!(m["op-ancient"].state, OperationState::AwaitingApproval);
}

/// 만료 시각이 없는 대기(TTL 0 일 때 요청됨)는 **영원히 기다린다** — 뒤늦게 뒤집지 않는다.
#[test]
fn expire_stale_keeps_awaiting_without_expiry_stamp() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 0);
    request(&mut m, "op-1", 0, 0).unwrap(); // expires_at = None
    assert!(expire_stale(&mut m, 999_999_999, 60_000).is_empty());
    assert_eq!(m["op-1"].state, OperationState::AwaitingApproval);
}

/// 실행·종료 상태는 시계가 건드리지 않는다 — 봉해진 작업안의 결과가 사라지면 안 된다.
#[test]
fn expire_stale_leaves_running_and_terminal_states_alone() {
    let mut m = HashMap::new();
    for (id, state) in [
        ("op-approved", OperationState::Approved),
        ("op-running", OperationState::Running),
        ("op-ok", OperationState::Succeeded),
        ("op-partial", OperationState::Partial),
        ("op-failed", OperationState::Failed),
        ("op-cancelled", OperationState::Cancelled),
        ("op-rejected", OperationState::Rejected),
        ("op-expired", OperationState::Expired),
    ] {
        plan(&mut m, id, &["a"], 0);
        m.get_mut(id).unwrap().state = state;
    }
    assert!(expire_stale(&mut m, 999_999_999, 1).is_empty());
    assert_eq!(m["op-running"].state, OperationState::Running);
    assert_eq!(m["op-ok"].state, OperationState::Succeeded);
}

#[test]
fn request_rejects_terminal_states_and_unknown() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    reject(&mut m, "op-1").unwrap();
    assert!(
        request(&mut m, "op-1", 0, 0).is_err(),
        "거절된 것은 다시 요청 못 한다"
    );
    assert!(
        request(&mut m, "ghost", 0, 0).is_err(),
        "없는 작업안은 오류다"
    );
}

#[test]
fn reject_moves_to_rejected_and_is_idempotent() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    request(&mut m, "op-1", 0, 0).unwrap();
    let op = reject(&mut m, "op-1").unwrap();
    assert_eq!(op.state, OperationState::Rejected);
    // 멱등.
    assert_eq!(
        reject(&mut m, "op-1").unwrap().state,
        OperationState::Rejected
    );
}

#[test]
fn get_and_lists_partition_by_state() {
    let mut m = HashMap::new();
    plan(&mut m, "op-old", &["a"], 100);
    plan(&mut m, "op-mid", &["b"], 200);
    plan(&mut m, "op-new", &["c"], 300);
    request(&mut m, "op-mid", 0, 0).unwrap();
    request(&mut m, "op-new", 0, 0).unwrap();
    // get.
    assert_eq!(get(&m, "op-mid").unwrap().operation_id, "op-mid");
    assert!(get(&m, "ghost").is_none());
    // pending = AwaitingApproval, 오래된 것부터.
    let pending: Vec<String> = list_pending(&m)
        .into_iter()
        .map(|o| o.operation_id)
        .collect();
    assert_eq!(pending, vec!["op-mid".to_string(), "op-new".to_string()]);
    // recent = 대기 아닌 것(여기선 op-old=Draft), 최신순.
    let recent: Vec<String> = list_recent(&m)
        .into_iter()
        .map(|o| o.operation_id)
        .collect();
    assert_eq!(recent, vec!["op-old".to_string()]);
}

#[test]
fn modify_targets_only_when_open() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a", "b"], 100);
    // Draft 에서 수정 가능.
    let op = modify_targets(&mut m, "op-1", vec!["a".into()]).unwrap();
    assert_eq!(op.targets, vec!["a".to_string()]);
    // AwaitingApproval 에서도 가능.
    request(&mut m, "op-1", 0, 0).unwrap();
    modify_targets(&mut m, "op-1", vec!["b".into()]).unwrap();
    assert_eq!(m["op-1"].targets, vec!["b".to_string()]);
    // 거절 뒤에는 못 고친다.
    reject(&mut m, "op-1").unwrap();
    assert!(modify_targets(&mut m, "op-1", vec!["c".into()]).is_err());
}

#[test]
fn dedup_targets_removes_duplicates_preserving_first_order() {
    assert_eq!(
        dedup_targets(vec![
            "b".into(),
            "a".into(),
            "b".into(),
            "c".into(),
            "a".into()
        ]),
        vec!["b".to_string(), "a".to_string(), "c".to_string()],
    );
    // 중복 없으면 그대로, 빈 입력은 빈 출력.
    assert_eq!(dedup_targets(vec!["x".into()]), vec!["x".to_string()]);
    assert!(dedup_targets(vec![]).is_empty());
}

#[test]
fn modify_targets_dedups_preserving_order() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a", "b"], 100);
    let op = modify_targets(&mut m, "op-1", vec!["b".into(), "a".into(), "b".into()]).unwrap();
    assert_eq!(
        op.targets,
        vec!["b".to_string(), "a".to_string()],
        "중복 제거·순서 보존"
    );
}

#[test]
fn invalidate_for_target_expires_open_plans_referencing_it() {
    let mut m = HashMap::new();
    plan(&mut m, "op-draft", &["web-1", "web-2"], 100); // Draft, web-1 참조
    plan(&mut m, "op-wait", &["web-1"], 200);
    request(&mut m, "op-wait", 0, 0).unwrap(); // AwaitingApproval, web-1 참조
    plan(&mut m, "op-other", &["db-1"], 300); // web-1 무관
    plan(&mut m, "op-rej", &["web-1"], 400);
    reject(&mut m, "op-rej").unwrap(); // 종료 상태 — 안 건드린다

    let n = invalidate_for_target(&mut m, "web-1");
    assert_eq!(n, 2, "열린 작업안 둘(draft·wait)만 만료된다");
    assert_eq!(m["op-draft"].state, OperationState::Expired);
    assert_eq!(m["op-wait"].state, OperationState::Expired);
    assert_eq!(
        m["op-other"].state,
        OperationState::Draft,
        "무관 작업안은 그대로"
    );
    assert_eq!(
        m["op-rej"].state,
        OperationState::Rejected,
        "거절된 것은 그대로"
    );

    // 없는 대상 → 아무것도 안 바뀐다.
    assert_eq!(invalidate_for_target(&mut m, "nobody"), 0);
}

#[test]
fn state_serializes_as_camel_case() {
    assert_eq!(
        serde_json::to_string(&OperationState::AwaitingApproval).unwrap(),
        "\"awaitingApproval\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Draft).unwrap(),
        "\"draft\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Rejected).unwrap(),
        "\"rejected\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Expired).unwrap(),
        "\"expired\""
    );
}

#[test]
fn operation_serializes_as_camel_case() {
    let mut m = HashMap::new();
    let op = plan(&mut m, "op-1", &["a"], 100);
    let json = serde_json::to_string(&op).unwrap();
    assert!(json.contains("\"operationId\":\"op-1\""), "{json}");
    assert!(json.contains("\"timeoutSeconds\":60"), "{json}");
    assert!(json.contains("\"createdAt\":100"), "{json}");
    assert!(json.contains("\"state\":\"draft\""), "{json}");
}

#[test]
fn new_operation_id_is_prefixed_hex_and_unique() {
    let a = new_operation_id().expect("데스크톱에서 OS 엔트로피는 있다");
    let b = new_operation_id().expect("엔트로피");
    assert!(a.starts_with("op-"), "{a}");
    assert_eq!(a.len(), 3 + 32, "op- + 16바이트 hex");
    assert!(a[3..].chars().all(|c| c.is_ascii_hexdigit()), "{a}");
    assert_ne!(a, b, "두 번 뽑으면 다르다");
}

// ---- 단계 9 — 실행 상태기계·분류·canary·집계 (모두 순수) ----

fn outcome(exit: Option<i64>) -> crate::ssh::ExecOutcome {
    crate::ssh::ExecOutcome {
        exit_code: exit,
        ..Default::default()
    }
}

#[test]
fn approve_only_from_awaiting_approval() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    // Draft 는 아직 검토 요청 전 — 승인 못 한다.
    assert!(approve(&mut m, "op-1", "manual").is_err());
    request(&mut m, "op-1", 0, 0).unwrap();
    // AwaitingApproval → Approved.
    assert_eq!(
        approve(&mut m, "op-1", "manual").unwrap().state,
        OperationState::Approved
    );
    // 두 번 승인 못 한다.
    assert!(approve(&mut m, "op-1", "manual").is_err());
    // 승인된 것은 거절·재요청·대상수정이 막힌다(실행 상태는 열려 있지 않다).
    assert!(reject(&mut m, "op-1").is_err());
    assert!(request(&mut m, "op-1", 0, 0).is_err());
    assert!(modify_targets(&mut m, "op-1", vec!["b".into()]).is_err());
}

#[test]
fn approve_stamps_approval_method_and_serializes_camel_case() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    // 승인 전에는 비어 있다(직렬화하면 null).
    let v = serde_json::to_value(&m["op-1"]).unwrap();
    assert!(v["approvalMethod"].is_null(), "{v}");
    request(&mut m, "op-1", 0, 0).unwrap();
    let op = approve(&mut m, "op-1", "auto").unwrap();
    assert_eq!(op.approval_method.as_deref(), Some("auto"));
    assert_eq!(m["op-1"].approval_method.as_deref(), Some("auto"));
    let v = serde_json::to_value(&m["op-1"]).unwrap();
    assert_eq!(v["approvalMethod"], "auto");
    // 두 번째 승인은 실패하고 값을 덮지 않는다.
    assert!(approve(&mut m, "op-1", "manual").is_err());
    assert_eq!(m["op-1"].approval_method.as_deref(), Some("auto"));
    // 옛 모양(칸 없음)도 읽힌다 — `#[serde(default)]`.
    let mut raw = serde_json::to_value(&m["op-1"]).unwrap();
    raw.as_object_mut().unwrap().remove("approvalMethod");
    let back: Operation = serde_json::from_value(raw).unwrap();
    assert_eq!(back.approval_method, None);
}

#[test]
fn running_plan_is_not_touched_by_invalidate() {
    // 실행 중 작업안은 대상 세션이 닫혀도 만료되지 않는다(is_open=false).
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["web-1"], 100);
    request(&mut m, "op-1", 0, 0).unwrap();
    approve(&mut m, "op-1", "manual").unwrap();
    mark_running(&mut m, "op-1");
    assert_eq!(m["op-1"].state, OperationState::Running);
    assert_eq!(
        invalidate_for_target(&mut m, "web-1"),
        0,
        "실행 중은 안 건드린다"
    );
    assert_eq!(m["op-1"].state, OperationState::Running);
}

#[test]
fn mark_running_and_finish_transitions() {
    let mut m = HashMap::new();
    plan(&mut m, "op-1", &["a"], 100);
    request(&mut m, "op-1", 0, 0).unwrap();
    // Approved 가 아니면 mark_running 은 아무 일도 안 한다.
    mark_running(&mut m, "op-1");
    assert_eq!(m["op-1"].state, OperationState::AwaitingApproval);
    approve(&mut m, "op-1", "manual").unwrap();
    mark_running(&mut m, "op-1");
    assert_eq!(m["op-1"].state, OperationState::Running);
    finish(&mut m, "op-1", OperationState::Partial);
    assert_eq!(m["op-1"].state, OperationState::Partial);
}

#[test]
fn classify_maps_exec_outcome_to_target_state() {
    // exit 0 → 성공.
    assert_eq!(classify(&outcome(Some(0))).0, TargetState::Succeeded);
    // exit ≠ 0 → 실패(+ 코드).
    let (s, code, class) = classify(&outcome(Some(1)));
    assert_eq!(s, TargetState::Failed);
    assert_eq!(code, Some(1));
    assert!(class.unwrap().contains("종료 코드 1"));
    // 종료 코드 없음 → 실패.
    assert_eq!(classify(&outcome(None)).0, TargetState::Failed);
    // 타임아웃 — 시작 후여도 TimedOut 그대로(A5 범위 밖 · 재분류하지 않는다).
    let to = crate::ssh::ExecOutcome {
        timed_out: true,
        launched: true,
        ..Default::default()
    };
    assert_eq!(classify(&to).0, TargetState::TimedOut);
    // 시작 전 취소(launched=false) → Cancelled(아무것도 실행되지 않음).
    let cn = crate::ssh::ExecOutcome {
        cancelled: true,
        launched: false,
        ..Default::default()
    };
    let (s, _, class) = classify(&cn);
    assert_eq!(s, TargetState::Cancelled);
    assert!(class.unwrap().contains("시작 전"));
    // 시작 후 취소(launched=true) → Unknown(상태 불명, 협력적 한계를 정직히 남긴다).
    let cnl = crate::ssh::ExecOutcome {
        cancelled: true,
        launched: true,
        ..Default::default()
    };
    let (s, _, class) = classify(&cnl);
    assert_eq!(s, TargetState::Unknown);
    assert!(class.unwrap().contains("상태 불명"));
    // 전송 오류 → 실패.
    let err = crate::ssh::ExecOutcome {
        error: Some("채널을 열지 못했습니다".into()),
        ..Default::default()
    };
    assert_eq!(classify(&err).0, TargetState::Failed);
}

#[test]
fn canary_proceeds_only_on_first_success() {
    assert!(
        canary_proceed(TargetState::Succeeded),
        "첫 성공이면 나머지로"
    );
    for s in [
        TargetState::Failed,
        TargetState::TimedOut,
        TargetState::Cancelled,
    ] {
        assert!(!canary_proceed(s), "첫 실패면 나머지는 취소");
    }
}

#[test]
fn aggregate_folds_target_states() {
    use TargetState::*;
    assert_eq!(
        aggregate(&[Succeeded, Succeeded]),
        OperationState::Succeeded
    );
    // 일부만 성공 = Partial.
    assert_eq!(aggregate(&[Succeeded, Failed]), OperationState::Partial);
    assert_eq!(
        aggregate(&[Succeeded, TimedOut, Cancelled]),
        OperationState::Partial
    );
    // 성공 없음 = Failed.
    assert_eq!(aggregate(&[Failed, TimedOut]), OperationState::Failed);
    // 성공 없고 전부 취소 = Cancelled(사용자가 멈춘 것).
    assert_eq!(
        aggregate(&[Cancelled, Cancelled]),
        OperationState::Cancelled
    );
    // 빈 목록 = Failed(대상 없음).
    assert_eq!(aggregate(&[]), OperationState::Failed);
    // A5 상태 불명 — 성공·실패 없이 취소·불명만 남고 Unknown 이 하나라도 있으면 깨끗한 취소가
    // 아니라 Partial(정직히 불확실). 전부 Unknown 도 Partial.
    assert_eq!(aggregate(&[Unknown, Unknown]), OperationState::Partial);
    assert_eq!(aggregate(&[Cancelled, Unknown]), OperationState::Partial);
    // 성공이 섞이면 그대로 Partial(Unknown 은 성공 아님).
    assert_eq!(aggregate(&[Succeeded, Unknown]), OperationState::Partial);
    // 실패가 섞이면 Failed(성공 없음) — Unknown 이 있어도 실패가 우선.
    assert_eq!(aggregate(&[Failed, Unknown]), OperationState::Failed);
}

#[test]
fn exec_states_serialize_as_camel_case() {
    assert_eq!(
        serde_json::to_string(&OperationState::Approved).unwrap(),
        "\"approved\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Running).unwrap(),
        "\"running\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Succeeded).unwrap(),
        "\"succeeded\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Partial).unwrap(),
        "\"partial\""
    );
    assert_eq!(
        serde_json::to_string(&OperationState::Cancelled).unwrap(),
        "\"cancelled\""
    );
    assert_eq!(
        serde_json::to_string(&TargetState::TimedOut).unwrap(),
        "\"timedOut\""
    );
    assert_eq!(
        serde_json::to_string(&TargetState::Pending).unwrap(),
        "\"pending\""
    );
    assert_eq!(
        serde_json::to_string(&TargetState::Unknown).unwrap(),
        "\"unknown\""
    );
}

// ---- 단계 10b — 자동 승인 하드 경계(순수) ----

#[test]
fn exceeds_limits_gates_both_manual_and_auto() {
    // 범위 안 → 통과(None). 수동·자동 어느 쪽이 부르든 같은 판정이다.
    assert!(exceeds_limits(3, 4, 10, 4).is_none());
    assert!(exceeds_limits(10, 4, 10, 4).is_none(), "상한과 같으면 통과");

    // 대상 수 초과 → 거부.
    let r = exceeds_limits(11, 4, 10, 4).expect("대상 초과는 거부");
    assert!(r.contains("대상"), "{r}");

    // 동시 실행 초과 → 거부.
    let r = exceeds_limits(5, 8, 10, 4).expect("동시 실행 초과는 거부");
    assert!(r.contains("동시"), "{r}");

    // 대상이 먼저 걸린다(둘 다 초과여도 사유는 대상).
    let r = exceeds_limits(11, 8, 10, 4).expect("둘 다 초과");
    assert!(r.contains("대상"), "{r}");
}

/// 승인 게이트([`approval_reject_reason`]) — **자동**은 정책까지, **수동**은 caps 만.
///
/// 프런트가 `method:"auto"` 로 불러도 Rust 가 위험·allowlist·메타문자를 독립 재검증한다는
/// 것을 못 박는다. 같은 명령을 수동으로 부르면 caps 만 걸리므로 통과한다(사람이 권위).
#[test]
fn approval_gate_auto_enforces_policy_while_manual_is_caps_only() {
    // 켜진 정책: df·uptime 만 allowlist, 상한 10/4.
    let prefs = crate::settings::AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec!["df".to_string(), "uptime".to_string()],
        max_targets: 10,
        max_concurrency: 4,
        ..Default::default()
    };

    // allowlist·안전·메타문자 없음·상한 이내 → 자동 통과.
    assert!(approval_reject_reason("df -h", 3, 4, None, None, "auto", &prefs).is_none());

    // 자동은 정책 밖을 거부한다 — 위험·비allowlist·메타문자 각각.
    assert!(
        approval_reject_reason("rm -rf /", 1, 4, None, None, "auto", &prefs).is_some(),
        "위험"
    );
    assert!(
        approval_reject_reason("ls -la", 1, 4, None, None, "auto", &prefs).is_some(),
        "비allowlist"
    );
    assert!(
        approval_reject_reason("df; ls", 1, 4, None, None, "auto", &prefs).is_some(),
        "메타문자"
    );

    // 하지만 **수동**은 같은 명령들을 caps 만 보고 통과시킨다(사람이 권위, 위험은 UI 자문).
    assert!(approval_reject_reason("rm -rf /", 1, 4, None, None, "manual", &prefs).is_none());
    assert!(approval_reject_reason("ls -la", 1, 4, None, None, "manual", &prefs).is_none());
    assert!(approval_reject_reason("df; ls", 1, 4, None, None, "manual", &prefs).is_none());

    // caps 는 수동·자동 공통 하드 경계 — 상한 초과는 어느 쪽이든 거부.
    assert!(
        approval_reject_reason("df -h", 11, 4, None, None, "auto", &prefs).is_some(),
        "대상 초과·자동"
    );
    assert!(
        approval_reject_reason("df -h", 11, 4, None, None, "manual", &prefs).is_some(),
        "대상 초과·수동"
    );
    assert!(
        approval_reject_reason("df -h", 3, 8, None, None, "manual", &prefs).is_some(),
        "동시 실행 초과·수동"
    );
}

/// cwd 게이트(백로그 #9) — **자동**은 메타문자 cwd 를 거부하고, **수동**은 같은 cwd 를 통과.
#[test]
fn approval_gate_auto_rejects_metachar_cwd_while_manual_allows_it() {
    let prefs = crate::settings::AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec!["df".to_string()],
        max_targets: 10,
        max_concurrency: 4,
        ..Default::default()
    };

    // 얌전한 cwd 는 자동도 통과(정책·caps 는 이미 만족).
    assert!(
        approval_reject_reason("df -h", 1, 4, Some("/var/log"), None, "auto", &prefs).is_none()
    );

    // 메타문자 cwd 는 자동 승인에서 거부된다(치환·체이닝 등이 무인 실행을 타지 못한다).
    let r = approval_reject_reason("df -h", 1, 4, Some("/tmp/$(id)"), None, "auto", &prefs)
        .expect("메타문자 cwd 는 자동 거부");
    assert!(r.contains("디렉터리"), "{r}");
    assert!(
        approval_reject_reason("df -h", 1, 4, Some("/a; rm -rf /"), None, "auto", &prefs).is_some()
    );

    // 하지만 **수동**은 같은 cwd 를 auto 검사로 막지 않는다(사람이 검토했다 — caps 만 본다).
    assert!(
        approval_reject_reason("df -h", 1, 4, Some("/tmp/$(id)"), None, "manual", &prefs).is_none()
    );
    assert!(
        approval_reject_reason("df -h", 1, 4, Some("/a; rm -rf /"), None, "manual", &prefs)
            .is_none()
    );
}

/// A4d validate 게이트(순수) — **자동**은 검증 명령도 본 명령과 같은 안전 술어를 통과해야 하고,
/// **수동**은 어떤 validate 든 caps 만 본다(사람이 카드에서 validate 를 보고 승인한다).
#[test]
fn approval_gate_auto_vets_validate_while_manual_ignores_it() {
    // 켜진 정책: df·uptime allowlist(평탄), 상한 10/4. 본 명령 df -h 는 통과한다.
    let prefs = crate::settings::AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec!["df".to_string(), "uptime".to_string()],
        max_targets: 10,
        max_concurrency: 4,
        ..Default::default()
    };

    // 안전·allowlist·메타문자 없는 validate → 자동 통과(본 명령·validate 둘 다 정책 안).
    assert!(
        approval_reject_reason("df -h", 3, 4, None, Some("uptime"), "auto", &prefs).is_none(),
        "allowlist validate 는 자동 통과"
    );

    // 자동은 정책 밖 validate 를 거부한다 — 위험·비allowlist·메타문자 각각.
    let r = approval_reject_reason("df -h", 1, 4, None, Some("rm -rf /"), "auto", &prefs)
        .expect("위험 validate 는 자동 거부");
    assert!(r.contains("검증 명령"), "{r}");
    assert!(
        approval_reject_reason("df -h", 1, 4, None, Some("ls -la"), "auto", &prefs).is_some(),
        "비allowlist validate 는 거부"
    );
    assert!(
        approval_reject_reason("df -h", 1, 4, None, Some("df; rm -rf /"), "auto", &prefs).is_some(),
        "메타문자 validate 는 거부"
    );

    // 하지만 **수동**은 같은 validate 들을 caps 만 보고 통과시킨다(사람이 카드에서 본다).
    assert!(
        approval_reject_reason("df -h", 1, 4, None, Some("rm -rf /"), "manual", &prefs).is_none()
    );
    assert!(
        approval_reject_reason("df -h", 1, 4, None, Some("df; rm -rf /"), "manual", &prefs)
            .is_none()
    );

    // validate 없음(None) → 예전 게이트 그대로(자동도 본 명령만 본다).
    assert!(approval_reject_reason("df -h", 3, 4, None, None, "auto", &prefs).is_none());
}

#[test]
fn validation_abort_reason_describes_the_probe_outcome() {
    // 핸들 미해석(None) → 그 사실을 담는다.
    let r = validation_abort_reason(None);
    assert!(r.contains("canary 검증 실패로 취소됨"), "{r}");
    assert!(r.contains("풀지 못함"), "{r}");
    // exit ≠ 0 → 종료 코드를 담는다.
    let bad = crate::ssh::ExecOutcome {
        exit_code: Some(3),
        ..Default::default()
    };
    let r = validation_abort_reason(Some(&bad));
    assert!(r.contains("종료 코드 3"), "{r}");
    // 타임아웃 → 타임아웃 사유.
    let to = crate::ssh::ExecOutcome {
        timed_out: true,
        ..Default::default()
    };
    assert!(validation_abort_reason(Some(&to)).contains("타임아웃"));
}

/// A4a 대상별 자동 실행 게이트(순수) — 위임 대상은 별칭 권한, 창 대상도 호스트 권한, 안 되면 거부.
#[test]
fn auto_execute_gate_requires_per_target_delegation() {
    // 손으로 파싱한 위임(실제 delegation.toml 비의존): granted 는 auto 단계, denied 는 승인 후 실행.
    let delegation = crate::delegation::Delegation::parse(
        "\
[[target]]
alias        = \"granted\"
expect_user  = \"u\"
expect_host  = \"h\"
expect_port  = 22
read         = true
propose      = true
auto_execute = true

[[target]]
alias        = \"denied\"
expect_user  = \"u\"
expect_host  = \"h\"
expect_port  = 22
read         = true
propose      = true

[[target]]
alias        = \"odd\"
expect_user  = \"u\"
expect_host  = \"h\"
expect_port  = 22
auto_execute = true
",
    )
    .unwrap();
    let none = HashMap::new();

    // auto 단계 위임 대상 → 통과.
    assert!(
        auto_execute_reject_reason(&["delegated:granted".to_string()], &none, &delegation)
            .is_none()
    );
    // 승인 후 실행까지만 → 거부, 그 별칭을 짚는다.
    let r = auto_execute_reject_reason(&["delegated:denied".to_string()], &none, &delegation)
        .expect("자동 실행 권한 없는 대상은 거부");
    assert!(r.contains("denied"), "{r}");
    // 목록에 없는 별칭·비누적 옛 조합(read·propose 없이 auto)도 거부.
    assert!(
        auto_execute_reject_reason(&["delegated:ghost".to_string()], &none, &delegation)
            .is_some()
    );
    assert!(
        auto_execute_reject_reason(&["delegated:odd".to_string()], &none, &delegation).is_some()
    );
    // 섞임(위임된 위임 + 위임 안 된 위임) → 위임 안 된 별칭을 짚어 거부.
    let mixed = vec![
        "delegated:granted".to_string(),
        "delegated:denied".to_string(),
    ];
    let r = auto_execute_reject_reason(&mixed, &none, &delegation).expect("하나라도 없으면 거부");
    assert!(r.contains("denied") && !r.contains("granted"), "{r}");
    // 대상이 아예 없으면 통과.
    assert!(auto_execute_reject_reason(&[], &none, &delegation).is_none());
}

/// **회귀(2026-10-07)**: 창 대상은 예전에 이 문을 통째로 건너뛰어, 권한을 하나도 안 준 호스트의
/// 타일도 자동 승인으로 무인 실행될 수 있었다. 이제 창 대상도 호스트의 자동 실행 권한을 본다.
#[test]
fn auto_execute_gate_no_longer_waves_window_targets_through() {
    let d = stage_delegation();
    let mut ctx = HashMap::new();
    ctx.insert("w-auto".to_string(), tile("ssh", Some("h-auto")));
    ctx.insert("w-approve".to_string(), tile("ssh", Some("h-approve")));
    ctx.insert("w-none".to_string(), tile("ssh", Some("never-delegated")));
    ctx.insert("w-adhoc".to_string(), tile("ssh", None));
    ctx.insert("w-local".to_string(), tile("local", None));
    let one = |id: &str| auto_execute_reject_reason(&[id.to_string()], &ctx, &d);

    assert!(one("w-auto").is_none(), "auto 단계 호스트의 타일만 통과");
    // 구멍: 위임을 하나도 안 준 호스트의 타일 → 이제 거부(예전엔 통과).
    let r = one("w-none").expect("위임 없는 호스트의 타일은 자동 승인하지 않는다");
    assert!(r.contains("never-delegated"), "{r}");
    assert!(one("w-approve").is_some(), "승인 후 실행 단계는 사람 승인");
    // 별칭 없는 원격·로컬·거울에 없는 창 대상 → 사람 승인으로.
    assert!(one("w-adhoc").is_some());
    assert!(one("w-local").is_some());
    assert!(one("w-unknown").is_some());
    // 섞이면 하나만 걸려도 거부.
    let mixed = vec![
        "w-auto".to_string(),
        "delegated:h-auto".to_string(),
        "w-local".to_string(),
    ];
    assert!(auto_execute_reject_reason(&mixed, &ctx, &d).is_some());
    let all_auto = vec!["w-auto".to_string(), "delegated:h-auto".to_string()];
    assert!(auto_execute_reject_reason(&all_auto, &ctx, &d).is_none());
}

// ---- 단계 10a — 감사 매핑(순수 부가 기록) ----

#[test]
fn audit_state_names_match_camel_case_serialization() {
    assert_eq!(op_state_name(OperationState::Succeeded), "succeeded");
    assert_eq!(op_state_name(OperationState::Partial), "partial");
    assert_eq!(target_state_name(TargetState::TimedOut), "timedOut");
    assert_eq!(target_state_name(TargetState::Pending), "pending");
}

#[test]
fn audit_target_results_reads_store_in_target_order() {
    // 결과 저장소를 하나 꾸며 대상별 요약이 targets 순서대로, 상태·종료 코드까지 나오는지 본다.
    let results: ResultStore = Arc::new(Mutex::new(HashMap::new()));
    {
        let mut map = results.lock().unwrap();
        let entry = map.entry("op-1".to_string()).or_default();
        entry.insert(
            "web-2".to_string(),
            TargetResult {
                state: TargetState::Failed,
                exit_code: Some(1),
                ..TargetResult::pending()
            },
        );
        entry.insert(
            "web-1".to_string(),
            TargetResult {
                state: TargetState::Succeeded,
                exit_code: Some(0),
                ..TargetResult::pending()
            },
        );
    }
    let targets = vec![
        "web-1".to_string(),
        "web-2".to_string(),
        "web-3".to_string(),
    ];
    let summary = audit_target_results(&results, "op-1", &targets, &HashSet::new());

    assert_eq!(summary.len(), 3);
    // targets 순서 그대로(결정적).
    assert_eq!(summary[0].stream_id, "web-1");
    assert_eq!(summary[0].state, "succeeded");
    assert_eq!(summary[0].exit_code, Some(0));
    assert_eq!(summary[1].stream_id, "web-2");
    assert_eq!(summary[1].state, "failed");
    assert_eq!(summary[1].exit_code, Some(1));
    // 저장소에 없는 대상은 pending 으로 관대하게 읽는다(감사가 실행을 방해하지 않는다).
    assert_eq!(summary[2].stream_id, "web-3");
    assert_eq!(summary[2].state, "pending");
    assert_eq!(summary[2].exit_code, None);
    // 발췌 설정이 꺼진(빈 집합) 결과 줄에는 출력 꼬리가 없다.
    assert!(summary
        .iter()
        .all(|r| r.stdout_tail.is_none() && r.stderr_tail.is_none()));
}

/// 출력 발췌(docs/log/2026-09-28-run-history.md) — 시각은 언제나, 출력 꼬리는 **설정을 켰고 지금 AI
/// 읽기 공유 중인** 대상만. 공유가 꺼진(=MCP 가 `redacted` 로 가리는) 대상의 출력은 파일에 남지 않는다.
#[test]
fn audit_excerpt_only_for_enabled_and_shared_targets() {
    let results: ResultStore = Arc::new(Mutex::new(HashMap::new()));
    {
        let mut map = results.lock().unwrap();
        let entry = map.entry("op-1".to_string()).or_default();
        for id in ["shared", "hidden"] {
            entry.insert(
                id.to_string(),
                TargetResult {
                    state: TargetState::Failed,
                    exit_code: Some(1),
                    stdout: format!("{id} out\n"),
                    stderr: format!("{id} err\n"),
                    started_at: Some(100),
                    ended_at: Some(250),
                    ..TargetResult::pending()
                },
            );
        }
    }
    let ctx: crate::context::Store = Arc::new(Mutex::new(HashMap::new()));
    {
        let mut m = ctx.lock().unwrap();
        // 로컬 타일로 짓는다 — 원격 타일의 판정은 실제 delegation.toml 을 읽으므로 여기서 쓰지 않는다
        // (원격은 아래 `excerpt_targets_follow_the_host_permission_for_remote_tiles` 가 순수 알맹이로 본다).
        crate::context::report(
            &mut m,
            "shared".into(),
            "pwsh".into(),
            "local".into(),
            "p1".into(),
            true,
        );
        crate::context::report(
            &mut m,
            "hidden".into(),
            "pwsh".into(),
            "local".into(),
            "p2".into(),
            false,
        );
    }
    let targets = vec!["shared".to_string(), "hidden".to_string()];

    // 설정 켬 — 공유 중인 대상만 꼬리가 실린다.
    let on = AuditSink {
        tx: None,
        ctx: Some(Arc::clone(&ctx)),
        excerpt: true,
    };
    let summary = audit_target_results(&results, "op-1", &targets, &on.excerpt_targets(&targets));
    assert_eq!(summary[0].stdout_tail.as_deref(), Some("shared out"));
    assert_eq!(summary[0].stderr_tail.as_deref(), Some("shared err"));
    assert_eq!(summary[0].started_at, Some(100));
    assert_eq!(summary[0].ended_at, Some(250));
    assert_eq!(
        summary[1].stdout_tail, None,
        "공유가 꺼진 대상의 출력은 남기지 않는다"
    );
    assert_eq!(summary[1].stderr_tail, None);
    assert_eq!(
        summary[1].started_at,
        Some(100),
        "시각은 세션 내용이 아니라 남는다"
    );

    // 설정 끔(기본) — 아무 꼬리도 없다.
    let off = AuditSink {
        tx: None,
        ctx: Some(ctx),
        excerpt: false,
    };
    let summary = audit_target_results(&results, "op-1", &targets, &off.excerpt_targets(&targets));
    assert!(summary
        .iter()
        .all(|r| r.stdout_tail.is_none() && r.stderr_tail.is_none()));
}

/// 감사 출력 발췌도 MCP 읽기와 **같은 판정** — 원격 타일은 호스트의 AI 권한(`read` 이상)을 따른다.
#[test]
fn excerpt_targets_follow_the_host_permission_for_remote_tiles() {
    let d = stage_delegation();
    let mut ctx = HashMap::new();
    ctx.insert("read".to_string(), tile("ssh", Some("h-read")));
    ctx.insert("off".to_string(), tile("ssh", Some("never-delegated")));
    ctx.insert("adhoc".to_string(), tile("ssh", None));
    let targets: Vec<String> = ["read", "off", "adhoc", "gone"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let picked = excerpt_targets_in(&ctx, &d, &targets);
    assert_eq!(picked.len(), 1);
    assert!(picked.contains("read"));
}

/// 선언을 얹으면 줄마다 `over`(선언보다 센 줄)를 매긴다 — 작업안 전체의 `mismatch` 와 같은 저울.
#[test]
fn declare_marks_lines_stronger_than_declared() {
    let mut map = HashMap::new();
    create_plan(
        &mut map,
        "op-l".into(),
        "echo '-- 보기'; ls -l; rm -f /tmp/x".into(),
        vec!["s-1".into()],
        None,
        None,
        "adhoc".into(),
        "rolling".into(),
        1,
        60,
        None,
        None,
        1,
        None,
    );
    let decl = |effect| Declaration { summary: "s".into(), effect, requested_by: None, target_labels: Default::default() };
    let op = declare(&mut map, "op-l", decl(analysis::Effect::Read)).unwrap();
    assert!(op.mismatch);
    let over: Vec<bool> = op.analysis.as_ref().unwrap().lines.iter().map(|l| l.over).collect();
    assert_eq!(over, [false, false, true]);
    let op = declare(&mut map, "op-l", decl(analysis::Effect::Delete)).unwrap();
    assert!(!op.mismatch);
    assert!(op.analysis.unwrap().lines.iter().all(|l| !l.over), "다시 선언하면 다시 매긴다");
}
