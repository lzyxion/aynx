use super::*;

fn cmd(line: &str) -> LastCommand {
    LastCommand {
        command_line: line.to_string(),
        output: "out".to_string(),
        exit: Some(0),
        running: false,
    }
}

#[test]
fn report_creates_new_entry_with_empty_live_fields() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web-01".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let e = &m["w:1"];
    assert_eq!(e.label, "web-01");
    assert_eq!(e.kind, "ssh");
    assert!(e.opted_in);
    assert!(e.status.is_none());
    assert!(e.last.is_none());
    assert!(e.scrollback.is_empty());
}

#[test]
fn report_stores_the_tile_code_and_keeps_it_on_rereport() {
    // `code`(현재 타일 위치)는 프런트가 넘겨 주고 저장된다 — 키를 파싱하지 않는다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "stream-1".into(),
        "web".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    assert_eq!(m["stream-1"].code, "p2");
    // 타일이 새 창으로 옮겨 위치가 바뀌면 code 만 갱신된다 (키=streamId 는 그대로).
    report(
        &mut m,
        "stream-1".into(),
        "web".into(),
        "ssh".into(),
        "t7·p2".into(),
        true,
    );
    assert_eq!(m["stream-1"].code, "t7·p2");
    // 옵트아웃해도 정체성(code 포함)은 남는다 — 라이브 필드만 비운다.
    report(
        &mut m,
        "stream-1".into(),
        "web".into(),
        "ssh".into(),
        "t7·p2".into(),
        false,
    );
    assert_eq!(m["stream-1"].code, "t7·p2");
}

#[test]
fn reclaim_streams_picks_this_windows_dead_mirrors_only() {
    // (streamId, owner, captured_at) — 기준선 200.
    let entries = vec![
        ("s-a".to_string(), "main".to_string(), 100u64), // 이 창·오래됨 → 거둔다
        ("s-b".to_string(), "tear-7".to_string(), 100),  // 다른 창 → 안 건드린다
        ("s-c".to_string(), "main".to_string(), 500),    // 기준선 이후 재보고 → 살아남
        ("s-d".to_string(), "main".to_string(), 100),    // 이관 중(held) → 절대 안 거둔다
    ];
    let held: std::collections::HashSet<String> = ["s-d".to_string()].into_iter().collect();
    assert_eq!(
        reclaim_streams(&entries, "main", 200, &held),
        vec!["s-a".to_string()]
    );
    // 라벨을 바꾸면 그 창 것만.
    assert_eq!(
        reclaim_streams(&entries, "tear-7", 200, &held),
        vec!["s-b".to_string()]
    );
}

#[test]
fn reclaim_window_drops_reclaimed_and_keeps_handed_off_and_live() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "s-a".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    report(
        &mut m,
        "s-d".into(),
        "db".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    report(
        &mut m,
        "s-c".into(),
        "app".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    // owner 는 report_session 의 몫이라 테스트에서 직접 찍는다.
    for (k, cap) in [("s-a", 100u64), ("s-d", 100), ("s-c", 500)] {
        let e = m.get_mut(k).unwrap();
        e.owner = "main".into();
        e.captured_at = cap;
    }
    let held: std::collections::HashSet<String> = ["s-d".to_string()].into_iter().collect();
    let reclaimed = reclaim_window(&mut m, "main", 200, &held);
    assert_eq!(reclaimed, vec!["s-a".to_string()]);
    assert!(!m.contains_key("s-a"), "거둔 거울은 사라진다");
    assert!(m.contains_key("s-d"), "이관 중 거울은 남는다");
    assert!(m.contains_key("s-c"), "기준선 이후 재보고된 거울은 남는다");
}

#[test]
fn delegated_sessions_are_never_reclaimed_by_window_teardown() {
    // 헤드리스 세션은 창이 없다 — 어떤 창 라벨로 정리를 돌려도 거둬지지 않는다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w-a".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    report_delegated(
        &mut m,
        "f-x".into(),
        "Remote-SSH".into(),
        "Remote-SSH".into(),
        true,
    );
    // 창 세션은 소유 창을 찍고, 헤드리스 세션은 owner 가 비어 있다(report_delegated 이 비운다).
    m.get_mut("w-a").unwrap().owner = "main".into();
    m.get_mut("w-a").unwrap().captured_at = 100;
    // 헤드리스 거울에도 사건 이전 시각을 찍어, 시각만으로는 거둬질 조건을 일부러 맞춰 둔다.
    m.get_mut("f-x").unwrap().captured_at = 100;

    let held = std::collections::HashSet::new();
    let reclaimed = reclaim_window(&mut m, "main", 200, &held);
    assert_eq!(reclaimed, vec!["w-a".to_string()], "창 세션만 거둔다");
    assert!(!m.contains_key("w-a"), "창 세션은 거둬진다");
    assert!(m.contains_key("f-x"), "헤드리스 세션은 남는다");

    // owner 를 창 라벨과 같게 만들어도(방어), owner_kind=Delegated 이면 여전히 남는다.
    m.get_mut("f-x").unwrap().owner = "main".into();
    let reclaimed = reclaim_window(&mut m, "main", 200, &held);
    assert!(reclaimed.is_empty());
    assert!(
        m.contains_key("f-x"),
        "owner 가 겹쳐도 헤드리스 세션은 창 정리로 안 거둬진다"
    );
}

/// 단계 넷(off·read·approve·auto)을 한 별칭씩 — 저장 형식(불리언 셋) 그대로. `odd` 는 옛 파일의
/// **비누적 조합**(read 없이 propose·auto) — 누적 규칙으로 읽혀 아무 권한도 없어야 한다.
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

[[target]]
alias = \"odd\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
propose = true
auto_execute = true
",
    )
    .unwrap()
}

/// 창 타일 하나 — `host_alias` 는 명령 층(`report_session`)이 찍는 칸이라 순수 `report` 뒤에 세운다.
fn window_tile(
    m: &mut HashMap<String, SessionContext>,
    key: &str,
    kind: &str,
    opted_in: bool,
    host_alias: Option<&str>,
) {
    report(
        m,
        key.into(),
        host_alias.unwrap_or("tile").into(),
        kind.into(),
        String::new(),
        opted_in,
    );
    m.get_mut(key).unwrap().host_alias = host_alias.map(str::to_string);
}

/// (읽기, 작업안 대상, 자동 실행) 셋을 한 번에.
fn gates(
    c: &SessionContext,
    d: &crate::delegation::Delegation,
) -> (bool, bool, bool) {
    (
        ai_readable(c, d),
        ai_plan_eligible(c, d),
        ai_auto_executable(c, d),
    )
}

#[test]
fn remote_window_tiles_follow_the_host_permission_not_the_tile_optin() {
    let d = stage_delegation();
    let mut m = HashMap::new();
    // 타일의 opted_in 은 판정에 쓰지 않는다 — 켜 둔 채(옛 값)여도 호스트 권한이 정한다.
    window_tile(&mut m, "off", "ssh", true, Some("not-delegated"));
    window_tile(&mut m, "read", "ssh", true, Some("h-read"));
    window_tile(&mut m, "approve", "ssh", false, Some("H-APPROVE")); // 별칭은 대소문자 무시
    window_tile(&mut m, "auto", "ssh", true, Some("h-auto"));
    window_tile(&mut m, "odd", "ssh", true, Some("odd"));
    assert_eq!(gates(&m["off"], &d), (false, false, false));
    assert_eq!(gates(&m["read"], &d), (true, false, false));
    assert_eq!(gates(&m["approve"], &d), (true, true, false));
    assert_eq!(gates(&m["auto"], &d), (true, true, true));
    // 비누적 옛 조합(read 없이 propose·auto) → 누적 규칙으로 아무것도 없다.
    assert_eq!(gates(&m["odd"], &d), (false, false, false));
}

#[test]
fn remote_window_tile_without_a_host_alias_is_always_off() {
    let d = stage_delegation();
    let mut m = HashMap::new();
    // 빠른 접속 등 호스트 목록 밖 — 라벨이 위임된 별칭과 같아도 별칭 칸이 없으면 off 고정.
    report(
        &mut m,
        "adhoc".into(),
        "h-auto".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    assert_eq!(gates(&m["adhoc"], &d), (false, false, false));
}

#[test]
fn local_window_tiles_read_by_optin_and_never_run() {
    let d = stage_delegation();
    let mut m = HashMap::new();
    window_tile(&mut m, "on", "local", true, None);
    window_tile(&mut m, "off", "local", false, None);
    // 별칭이 실려 와도(있을 수 없지만) 로컬은 호스트 권한을 따르지 않는다.
    window_tile(&mut m, "aliased", "local", false, Some("h-auto"));
    assert_eq!(gates(&m["on"], &d), (true, false, false));
    assert_eq!(gates(&m["off"], &d), (false, false, false));
    assert_eq!(gates(&m["aliased"], &d), (false, false, false));
}

#[test]
fn delegated_sessions_follow_the_alias_permission_and_the_connect_snapshot() {
    let d = stage_delegation();
    let mut m = HashMap::new();
    report_delegated(&mut m, "f-read".into(), "h-read".into(), "h-read".into(), true);
    report_delegated(&mut m, "f-auto".into(), "h-auto".into(), "h-auto".into(), true);
    // 접속 때 read 가 없었다(스냅샷 false) → 숨는다.
    report_delegated(&mut m, "f-snap-off".into(), "h-auto".into(), "h-auto".into(), false);
    // 접속 뒤 권한이 내려갔다(지금 목록에 없다) → 다시 붙지 않아도 바로 숨는다.
    report_delegated(&mut m, "f-gone".into(), "gone".into(), "gone".into(), true);
    assert_eq!(gates(&m["f-read"], &d), (true, false, false));
    assert_eq!(gates(&m["f-auto"], &d), (true, true, true));
    assert!(!ai_readable(&m["f-snap-off"], &d));
    assert_eq!(gates(&m["f-gone"], &d), (false, false, false));
    // 헤드리스 세션의 opted_in 은 언제나 false — 판정은 위임 별칭만 본다.
    assert!(!m["f-read"].opted_in, "read=true 라도 opted_in 은 false 다");
    assert_eq!(m["f-read"].owner_kind, SessionOwnerKind::Delegated);
}

#[test]
fn permission_view_keeps_identity_and_drops_live_fields() {
    let mut m = HashMap::new();
    window_tile(&mut m, "w", "ssh", true, Some("h-auto"));
    update(&mut m, "w", Some("ok".into()), Some(cmd("ls")), vec!["x".into()]);
    let v = permission_view(&m["w"]);
    assert_eq!(v.host_alias.as_deref(), Some("h-auto"));
    assert_eq!(v.kind, "ssh");
    assert!(v.scrollback.is_empty() && v.last.is_none());
    // 판정은 원본과 같다.
    let d = stage_delegation();
    assert_eq!(gates(&v, &d), gates(&m["w"], &d));
}

#[test]
fn mark_delegated_disconnected_flags_only_delegated_and_report_delegated_clears_it() {
    let mut m = HashMap::new();
    report_delegated(&mut m, "delegated:A".into(), "A".into(), "A".into(), true);
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    // 새로 보고된 헤드리스 세션은 살아 있다 — 깃발이 내려가 있다.
    assert!(!m["delegated:A"].disconnected);

    // 드롭 → 위임 항목만 끊김으로 표시된다(제거되지 않는다).
    mark_delegated_disconnected(&mut m, "delegated:A");
    assert!(m["delegated:A"].disconnected);
    assert!(m.contains_key("delegated:A"), "끊김은 항목을 지우지 않는다");

    // 창 세션에는 닿지 않는다 — owner_kind 로 건너뛴다.
    mark_delegated_disconnected(&mut m, "w:1");
    assert!(!m["w:1"].disconnected);

    // 없는 키는 무해하다.
    mark_delegated_disconnected(&mut m, "ghost");
    assert!(!m.contains_key("ghost"));

    // 재연결 = 같은 키로 report_delegated → 깃발이 다시 내려간다.
    report_delegated(&mut m, "delegated:A".into(), "A".into(), "A".into(), true);
    assert!(
        !m["delegated:A"].disconnected,
        "재보고가 끊김 깃발을 지운다"
    );
}

#[test]
fn update_writes_live_fields_to_opted_in_entry() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    update(
        &mut m,
        "w:1",
        Some("ok".into()),
        Some(cmd("ls")),
        vec!["a".into(), "b".into()],
    );
    let e = &m["w:1"];
    assert_eq!(e.status.as_deref(), Some("ok"));
    assert_eq!(e.last.as_ref().unwrap().command_line, "ls");
    assert_eq!(e.scrollback, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn opting_out_clears_live_fields_immediately() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    update(
        &mut m,
        "w:1",
        Some("fail".into()),
        Some(cmd("boom")),
        vec!["x".into()],
    );
    // 옵트아웃 재보고 → 라이브 필드가 그 자리에서 사라진다.
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    let e = &m["w:1"];
    assert!(!e.opted_in);
    assert!(e.status.is_none());
    assert!(e.last.is_none());
    assert!(e.scrollback.is_empty());
    // 정체성은 남는다 (다시 옵트인할 수 있게).
    assert_eq!(e.label, "web");
}

#[test]
fn re_reporting_opted_in_preserves_live_fields() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    update(
        &mut m,
        "w:1",
        Some("ok".into()),
        Some(cmd("ls")),
        vec!["a".into()],
    );
    // 라벨만 바뀐 재보고 — 라이브 필드는 그대로여야 한다.
    report(
        &mut m,
        "w:1".into(),
        "web-renamed".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let e = &m["w:1"];
    assert_eq!(e.label, "web-renamed");
    assert_eq!(e.status.as_deref(), Some("ok"));
    assert_eq!(e.scrollback, vec!["a".to_string()]);
}

#[test]
fn update_is_ignored_for_missing_or_opted_out_entries() {
    let mut m = HashMap::new();
    // 없는 항목 — 조용히 무시.
    update(&mut m, "ghost", Some("ok".into()), None, vec!["x".into()]);
    assert!(!m.contains_key("ghost"));

    // 옵트아웃 항목 — 라이브 필드가 쓰이지 않는다.
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    update(
        &mut m,
        "w:1",
        Some("ok".into()),
        Some(cmd("ls")),
        vec!["x".into()],
    );
    let e = &m["w:1"];
    assert!(e.status.is_none());
    assert!(e.last.is_none());
    assert!(e.scrollback.is_empty());
}

#[test]
fn scrollback_is_capped_to_the_tail() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let lines: Vec<String> = (0..SCROLLBACK_CAP + 500).map(|i| i.to_string()).collect();
    update(&mut m, "w:1", None, None, lines);
    let e = &m["w:1"];
    assert_eq!(e.scrollback.len(), SCROLLBACK_CAP);
    // tail 을 남긴다 = 마지막 줄이 살아 있다, 첫 줄은 잘려 나간다.
    assert_eq!(
        e.scrollback.last().unwrap(),
        &(SCROLLBACK_CAP + 499).to_string()
    );
    assert_eq!(e.scrollback.first().unwrap(), &"500".to_string());
}

fn block(id: i64, line: &str) -> CommandBlockMirror {
    CommandBlockMirror {
        id,
        command_line: line.to_string(),
        cwd: Some("/home/me".to_string()),
        started_at: 1_000 + id,
        ended_at: Some(2_000 + id),
        exit: Some(0),
        running: false,
        excerpt_head: vec!["head".to_string()],
        excerpt_tail: vec!["tail".to_string()],
        truncated: false,
        capture: "complete".to_string(),
    }
}

#[test]
fn push_block_appends_in_order_to_opted_in_entry() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_block(&mut m, "w:1", block(1, "ls"));
    push_block(&mut m, "w:1", block(2, "cargo test"));
    let e = &m["w:1"];
    assert_eq!(e.history.len(), 2);
    assert_eq!(e.history[0].command_line, "ls");
    assert_eq!(e.history[1].command_line, "cargo test");
    // `last` 는 이 명령이 건드리지 않는다 (등록된 계약은 그대로다).
    assert!(e.last.is_none());
}

#[test]
fn push_block_is_ignored_for_missing_or_opted_out_entries() {
    let mut m = HashMap::new();
    push_block(&mut m, "ghost", block(1, "ls"));
    assert!(!m.contains_key("ghost"));

    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    push_block(&mut m, "w:1", block(1, "ls"));
    assert!(m["w:1"].history.is_empty());
}

#[test]
fn opting_out_clears_the_history_too() {
    // 프라이버시 게이트는 필드가 늘어도 한 곳이다 — 이력도 그 자리에서 사라진다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_block(&mut m, "w:1", block(1, "secret-tool --token=…"));
    assert_eq!(m["w:1"].history.len(), 1);
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    assert!(m["w:1"].history.is_empty());
}

#[test]
fn push_blocks_appends_a_batch_in_order() {
    // 이관 직후의 거울 재구성 — 프런트가 들고 온 이력을 한 번에 다시 채운다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w2:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_blocks(
        &mut m,
        "w2:1",
        vec![block(1, "ls"), block(2, "pwd"), block(3, "df")],
    );
    let ids: Vec<i64> = m["w2:1"].history.iter().map(|b| b.id).collect();
    assert_eq!(ids, vec![1, 2, 3]);
    // 그 뒤의 증분 경로와 한 줄로 이어진다.
    push_block(&mut m, "w2:1", block(4, "uptime"));
    assert_eq!(m["w2:1"].history.last().unwrap().id, 4);
}

#[test]
fn push_block_upserts_by_id_so_backfill_and_incremental_never_duplicate() {
    // OFF→ON 백필(배치)과 증분 경로(`onblock`)가 같은 블록을 두 번 밀어도 한 번만 남는다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_blocks(&mut m, "w:1", vec![block(1, "ls"), block(2, "pwd")]);
    // 같은 번호가 다시 온다 (배치 ↔ onblock 경합) — 덧붙지 않고 제자리에서 교체된다.
    push_block(&mut m, "w:1", block(2, "pwd"));
    push_blocks(&mut m, "w:1", vec![block(1, "ls"), block(2, "pwd")]);
    let ids: Vec<i64> = m["w:1"].history.iter().map(|b| b.id).collect();
    assert_eq!(ids, vec![1, 2]);
}

#[test]
fn backfill_after_off_starts_empty_then_refills() {
    // 공유 껐다 켜면(재-공유): 끄는 순간 거울이 비고, 다시 켜서 백필하면 다시 채워진다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_blocks(&mut m, "w:1", vec![block(1, "ls"), block(2, "pwd")]);
    assert_eq!(m["w:1"].history.len(), 2);
    // OFF → 이력이 비워진다 (프라이버시 게이트).
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    assert!(m["w:1"].history.is_empty());
    // 다시 ON + 백필 → 다시 채워지고, 배치가 재실행돼도 중복이 없다.
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_blocks(&mut m, "w:1", vec![block(1, "ls"), block(2, "pwd")]);
    push_blocks(&mut m, "w:1", vec![block(1, "ls"), block(2, "pwd")]);
    let ids: Vec<i64> = m["w:1"].history.iter().map(|b| b.id).collect();
    assert_eq!(ids, vec![1, 2]);
}

#[test]
fn push_blocks_respects_the_caps_and_the_privacy_gate() {
    let mut m = HashMap::new();
    // ① 없는 항목·옵트아웃 항목에는 아무것도 남지 않는다 (단건 push 와 같은 규칙).
    push_blocks(&mut m, "ghost", vec![block(1, "ls")]);
    assert!(!m.contains_key("ghost"));
    report(
        &mut m,
        "w2:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    push_blocks(&mut m, "w2:1", vec![block(1, "ls"), block(2, "pwd")]);
    assert!(m["w2:1"].history.is_empty());

    // ② 개수 상한 — 배치 하나가 상한을 넘겨도 최신 200건만 남는다.
    report(
        &mut m,
        "w2:2".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let many: Vec<CommandBlockMirror> = (0..(HISTORY_CAP as i64 + 30))
        .map(|i| block(i, &format!("cmd-{i}")))
        .collect();
    push_blocks(&mut m, "w2:2", many);
    let e = &m["w2:2"];
    assert_eq!(e.history.len(), HISTORY_CAP);
    assert_eq!(e.history.last().unwrap().id, HISTORY_CAP as i64 + 29);

    // ③ 총량 상한 — 배치로 들어와도 1MB 를 넘겨 쥐지 않는다.
    report(
        &mut m,
        "w2:3".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let fat: Vec<CommandBlockMirror> = (0..40)
        .map(|i| CommandBlockMirror {
            excerpt_tail: vec!["x".repeat(64 * 1024)],
            ..block(i, "build")
        })
        .collect();
    push_blocks(&mut m, "w2:3", fat);
    let e = &m["w2:3"];
    let total: usize = e.history.iter().map(CommandBlockMirror::bytes).sum();
    assert!(total <= HISTORY_BYTES_CAP, "총량 {total} 이 상한을 넘었다");
    assert_eq!(e.history.last().unwrap().id, 39);
}

#[test]
fn history_is_capped_by_count_keeping_the_newest() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    for i in 0..(HISTORY_CAP as i64 + 50) {
        push_block(&mut m, "w:1", block(i, &format!("cmd-{i}")));
    }
    let e = &m["w:1"];
    assert_eq!(e.history.len(), HISTORY_CAP);
    // 오래된 것부터 버린다 = 마지막 블록이 살아 있고 첫 50 건이 잘려 나갔다.
    assert_eq!(e.history.last().unwrap().id, HISTORY_CAP as i64 + 49);
    assert_eq!(e.history.first().unwrap().id, 50);
}

#[test]
fn history_is_capped_by_bytes_keeping_the_newest() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    // 블록 하나가 ~64KB (프런트 발췌 상한) — 1MB 상한이면 스무 건 남짓만 산다.
    let fat = |id: i64| CommandBlockMirror {
        excerpt_tail: vec!["x".repeat(64 * 1024)],
        ..block(id, "build")
    };
    for i in 0..40 {
        push_block(&mut m, "w:1", fat(i));
    }
    let e = &m["w:1"];
    let total: usize = e.history.iter().map(CommandBlockMirror::bytes).sum();
    assert!(total <= HISTORY_BYTES_CAP, "총량 {total} 이 상한을 넘었다");
    assert!(e.history.len() < 40, "바이트 상한이 아무것도 깎지 않았다");
    assert_eq!(e.history.last().unwrap().id, 39); // 최신은 언제나 남는다
}

#[test]
fn a_single_oversized_block_is_kept() {
    // 방금 들어온 블록을 그 자리에서 버리면 "밀어 올렸는데 없다" 가 된다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    push_block(
        &mut m,
        "w:1",
        CommandBlockMirror {
            excerpt_tail: vec!["y".repeat(HISTORY_BYTES_CAP * 2)],
            ..block(1, "huge")
        },
    );
    assert_eq!(m["w:1"].history.len(), 1);
}

#[test]
fn freshness_guard_stamps_time_and_bumps_version_on_each_update() {
    // 신선도 가드: report·update·push_block 각각이 captured_at 을 찍고 context_version 을 올린다.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let v1 = m["w:1"].context_version;
    assert_eq!(v1, 1, "첫 report 가 버전을 1 로 올린다");
    assert!(m["w:1"].captured_at > 0, "captured_at 이 찍혀야 한다");

    update(
        &mut m,
        "w:1",
        Some("ok".into()),
        Some(cmd("ls")),
        vec!["a".into()],
    );
    assert_eq!(m["w:1"].context_version, v1 + 1, "update 가 버전을 올린다");

    push_block(&mut m, "w:1", block(1, "ls"));
    assert_eq!(
        m["w:1"].context_version,
        v1 + 2,
        "push_block 이 버전을 올린다"
    );

    // 배치는 블록마다 한 번 — 각 블록이 하나의 갱신이다.
    push_blocks(&mut m, "w:1", vec![block(2, "pwd"), block(3, "df")]);
    assert_eq!(m["w:1"].context_version, v1 + 4);
}

#[test]
fn freshness_guard_is_untouched_when_nothing_is_written() {
    // 미등록·옵트아웃 항목에는 아무것도 안 쓰이므로 버전도 오르지 않는다.
    let mut m = HashMap::new();
    // 없는 항목 — update/push 가 조용히 무시되고, 항목 자체가 안 생긴다.
    update(&mut m, "ghost", Some("ok".into()), None, vec!["x".into()]);
    push_block(&mut m, "ghost", block(1, "ls"));
    assert!(!m.contains_key("ghost"));

    // 옵트아웃 항목 — report 는 신원을 갱신하니 버전이 오르지만(1),
    // 뒤이은 update/push 는 게이트에 막혀 버전을 못 올린다.
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    let v = m["w:1"].context_version;
    assert_eq!(v, 1);
    update(
        &mut m,
        "w:1",
        Some("ok".into()),
        Some(cmd("ls")),
        vec!["x".into()],
    );
    push_block(&mut m, "w:1", block(1, "ls"));
    assert_eq!(
        m["w:1"].context_version, v,
        "옵트아웃이면 라이브·이력 갱신이 버전을 못 올린다"
    );
}

#[test]
fn command_block_serializes_as_camel_case() {
    let json = serde_json::to_string(&block(7, "cargo build")).unwrap();
    assert!(json.contains("\"commandLine\":\"cargo build\""), "{json}");
    assert!(json.contains("\"startedAt\":1007"), "{json}");
    assert!(json.contains("\"excerptHead\":[\"head\"]"), "{json}");
    assert!(json.contains("\"excerptTail\":[\"tail\"]"), "{json}");
    assert!(json.contains("\"truncated\":false"), "{json}");
    assert!(json.contains("\"capture\":\"complete\""), "{json}");
    assert!(json.contains("\"running\":false"), "{json}");
}

#[test]
fn last_command_serializes_as_camel_case() {
    let json = serde_json::to_string(&cmd("systemctl restart nginx")).unwrap();
    assert!(
        json.contains("\"commandLine\":\"systemctl restart nginx\""),
        "{json}"
    );
    assert!(json.contains("\"exit\":0"), "{json}");
    assert!(json.contains("\"running\":false"), "{json}");
    // 실행 중 + 코드 없음도 계약대로 나가는지.
    let running = LastCommand {
        command_line: "sleep 5".into(),
        output: String::new(),
        exit: None,
        running: true,
    };
    let json = serde_json::to_string(&running).unwrap();
    assert!(json.contains("\"exit\":null"), "{json}");
    assert!(json.contains("\"running\":true"), "{json}");
}
