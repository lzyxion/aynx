use super::*;

fn env(cli: Cli, tool: &str, input: Value, id: Option<&str>, session: Option<&str>) -> Envelope {
    Envelope {
        cli,
        session: session.map(str::to_owned),
        tool: tool.into(),
        tool_use_id: id.map(str::to_owned),
        digest: input_digest(&input),
        input,
        truncated: false,
        suggestions: Vec::new(),
        mcp_server: None,
        cwd: None,
        permission_mode: None,
    }
}

fn w(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn pending_id(a: &Asked) -> String {
    match a {
        Asked::Pending(id) => id.clone(),
        other => panic!("카드가 서야 한다: {other:?}"),
    }
}

/// 시험 `permission_tokens_are_per_stream` — 자기 스트림 · 회차가 선 뒤에만 · 남의 주인 번호로는 못 거둔다 · 갈아 치운 옛 토큰은 모른다.
#[test]
fn permission_tokens_are_per_stream() {
    let mut t = PermTokens::default();
    t.insert("s-a", "tok-a".into(), 7);
    assert_eq!(t.accepts("s-a", "tok-a"), None, "회차가 서기 전");
    assert!(t.bind_epoch("s-a", 7, 3));
    assert!(!t.bind_epoch("s-a", 8, 3));
    assert_eq!(t.accepts("s-a", "tok-a"), Some(3));
    assert_eq!(t.accepts("s-b", "tok-a"), None, "남의 스트림");
    assert_eq!(t.accepts("s-a", "tok-b"), None);
    t.insert("s-a", "tok-a2".into(), 9);
    assert_eq!(t.accepts("s-a", "tok-a"), None, "새 세션이 갈아 치웠다");
    assert!(!t.revoke("s-a", 7), "옛 세션의 늦은 회수");
    assert!(t.revoke("s-a", 9));
}

/// 시험 `no_viewer_releases_at_once` · `decision_applies_once` — 보는 창이 없으면 카드 없이 곧바로 풀고, 결정은 처음 하나만 · 보지 않는 창의
/// 결정은 거절 · 다른 회차의 결정은 먹지 않는다.
#[test]
fn ask_decide_once() {
    let mut t = Table::default();
    let (a, evs) = t.ask("s1", 1, env(Cli::Claude, "Bash", json!({"command": "ls"}), None, Some("c1")), 0, &[]);
    assert_eq!(a, Asked::Now(Outcome::Release));
    assert!(evs.is_empty(), "창이 없으면 카드도 없다(Claude — TUI 물음 표지 없음)");

    let (a, evs) = t.ask("s1", 1, env(Cli::Claude, "Bash", json!({"command": "ls"}), None, Some("c1")), 0, &w(&["main"]));
    let id = pending_id(&a);
    // 앞의 TUI 물음 표지가 걷히는 사건(`tui`)은 빼고 본다
    let evs: Vec<Ev> = evs.into_iter().filter(|e| e.body["t"] != "tui").collect();
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].body["t"], "request");
    assert_eq!(evs[0].body["card"]["input"]["command"], "ls");
    assert_eq!(evs[0].body["card"]["kind"], "command");
    assert_eq!(t.snapshot("s1", 1).len(), 1);
    assert!(t.snapshot("s1", 2).is_empty(), "다른 회차");

    assert!(matches!(t.decide("s1", 1, &id, "aux-9", Decision::Allow, None, &w(&["main"])), Err("not-viewing")));
    assert!(!t.decide("s1", 2, &id, "main", Decision::Allow, None, &w(&["main"])).unwrap().0, "다른 회차");
    let (applied, evs) = t.decide("s1", 1, &id, "main", Decision::Deny, Some(" 그만\u{7}"), &w(&["main", "remote-a-1"])).unwrap();
    assert!(applied);
    assert_eq!(evs[0].body, json!({ "t": "gone", "requestId": id, "reason": "denied" }));
    let (second, evs) = t.decide("s1", 1, &id, "remote-a-1", Decision::Allow, None, &w(&["main", "remote-a-1"])).unwrap();
    assert!(!second && evs.is_empty(), "둘째 결정은 조용히");
    match t.take(&id) {
        Some(Outcome::Decided(v)) => {
            assert_eq!(v["hookSpecificOutput"]["decision"]["behavior"], "deny");
            assert_eq!(v["hookSpecificOutput"]["decision"]["message"], "그만", "제어 문자는 걷는다");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(t.take(&id), Some(Outcome::Release), "꺼낸 뒤엔 없는 카드 = 풀기");
    assert!(t.snapshot("s1", 1).is_empty());
}

/// 시험 `deadlines_viewers_and_hook_gone` — 시한(Codex 2분 · Claude 10분) · 보는 창 없음(유예) · 훅 사라짐(롱폴이 다시 안 옴) · 세션 끝.
#[test]
fn deadlines_viewers_and_hook_gone() {
    let mut t = Table::default();
    let main = |_: &str| Some(w(&["main"]));
    // Codex 시한 — 롱폴이 계속 오는 동안(polling) 2분이 지나면 풀기.
    let x = pending_id(&t.ask("sx", 1, env(Cli::Codex, "Bash", json!({"command": "a"}), None, None), 0, &w(&["main"])).0);
    let c = pending_id(&t.ask("sc", 1, env(Cli::Claude, "Bash", json!({"command": "a"}), None, None), 0, &w(&["main"])).0);
    assert!(t.begin_poll("sx", &x).is_none());
    assert!(t.begin_poll("sc", &c).is_none());
    assert_eq!(t.begin_poll("sc", &x), Some(Outcome::Release), "남의 스트림의 id");
    assert!(t.sweep(CODEX_WAIT_MS - 1, main).is_empty());
    let evs = t.sweep(CODEX_WAIT_MS, main);
    // 시한 → 풀기(+ TUI 물음 표지 사건)
    assert_eq!(evs.len(), 2);
    assert_eq!(evs[1].body["t"], "tui");
    assert_eq!(evs[0].body["reason"], "timeout");
    assert_eq!(t.take(&x), Some(Outcome::Release));
    assert!(t.take(&c).is_none(), "Claude 는 아직");
    assert_eq!(t.sweep(CLAUDE_WAIT_MS, main)[0].body["reason"], "timeout");

    // 보는 창 없음 — 유예 안에 돌아오면(F5) 그대로, 계속 없으면 풀기.
    let mut t = Table::default();
    let id = pending_id(&t.ask("s", 1, env(Cli::Claude, "Read", json!({"file_path": "x"}), None, None), 0, &w(&["main"])).0);
    t.begin_poll("s", &id);
    assert!(t.sweep(1_000, |_| Some(Vec::new())).is_empty());
    assert!(t.sweep(2_000, main).is_empty(), "다시 붙음");
    assert!(t.sweep(3_000, |_| Some(Vec::new())).is_empty());
    assert_eq!(t.sweep(3_000 + NO_VIEWER_GRACE_MS, |_| Some(Vec::new()))[0].body["reason"], "no-viewer");

    // 훅 사라짐 — 롱폴이 끝난 뒤 다음 것이 LIVENESS 안에 안 오면(No · Esc 로 CLI 가 훅을 죽였다) 치운다.
    let mut t = Table::default();
    let id = pending_id(&t.ask("s", 1, env(Cli::Claude, "Bash", json!({"command": "z"}), None, None), 0, &w(&["main"])).0);
    t.begin_poll("s", &id);
    t.end_poll(&id, 3_000);
    assert!(t.sweep(3_000 + LIVENESS_MS, main).is_empty(), "아직 경계");
    let evs = t.sweep(3_001 + LIVENESS_MS, main);
    assert_eq!(evs[0].body["reason"], "hook-gone");
    assert!(t.snapshot("s", 1).is_empty());
    // 응답 쓰기 실패도 곧바로.
    let id = pending_id(&t.ask("s", 1, env(Cli::Claude, "Bash", json!({"command": "y"}), None, None), 0, &w(&["main"])).0);
    assert_eq!(t.hook_lost(&id)[0].body["reason"], "hook-gone");
    // 세션 끝(코어에 없음).
    let id = pending_id(&t.ask("s", 1, env(Cli::Claude, "Bash", json!({"command": "q"}), None, None), 0, &w(&["main"])).0);
    t.begin_poll("s", &id);
    assert_eq!(t.sweep(10, |_| None)[0].body["reason"], "session-ended");
}

/// 시험 `pre_post_pairing` — `pre` 의 `tool_use_id` 가 카드에 붙고, 같은 id 의 `post`(사람이 TUI 에서 [Yes])가 카드를 치운다. Codex 셸은
/// `PermissionRequest` 에만 `description` 이 있어도 같은 요약으로 짝짓는다(실측 2차 원자료).
#[test]
fn pre_post_pairing() {
    let mut t = Table::default();
    t.pre("s", &env(Cli::Codex, "Bash", json!({"command": "curl x"}), Some("exec-1"), Some("c")), 0);
    t.pre("s", &env(Cli::Codex, "Bash", json!({"command": "other"}), Some("exec-2"), Some("c")), 10);
    let (a, evs) = t.ask("s", 1, env(Cli::Codex, "Bash", json!({"command": "curl x", "description": "why"}), None, Some("c")), 20, &w(&["main"]));
    let id = pending_id(&a);
    assert_eq!(evs[0].body["card"]["toolUseId"], "exec-1", "요약이 같은 표지(가장 최근이 아니라)");
    // 다른 호출의 post 는 건드리지 않는다.
    assert!(t.post("s", &env(Cli::Codex, "Bash", json!({"command": "other"}), Some("exec-2"), Some("c"))).is_empty());
    let evs = t.post("s", &env(Cli::Codex, "Bash", json!({"command": "curl x"}), Some("exec-1"), Some("c")));
    assert_eq!(evs[0].body, json!({ "t": "gone", "requestId": id, "reason": "terminal" }));
    assert_eq!(t.take(&id), Some(Outcome::Release));
    // 표지가 없으면 같은 대화 · 도구 · 요약의 post 로.
    let id = pending_id(&t.ask("s", 1, env(Cli::Claude, "Write", json!({"file_path": "a", "content": "hi"}), None, Some("c")), 100, &w(&["main"])).0);
    let evs = t.post("s", &env(Cli::Claude, "Write", json!({"content": "hi", "file_path": "a"}), Some("toolu_9"), Some("c")));
    assert_eq!(evs[0].body["requestId"], id.as_str(), "키 순서가 달라도 같은 요약");
}

/// 시험 `local_settings_become_session` — 사용자 결정 7: `localSettings` · `projectSettings` · `userSettings` 는 `session` 으로 · 모드 넓히기 ·
/// 규칙 지우기는 버린다.
#[test]
fn local_settings_become_session() {
    let sugg = vec![
        json!({"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "node -e x"}], "behavior": "allow", "destination": "localSettings"}),
        json!({"type": "addRules", "rules": [{"toolName": "WebSearch"}], "behavior": "allow", "destination": "projectSettings"}),
        json!({"type": "addDirectories", "directories": ["C:/w"], "destination": "userSettings"}),
        json!({"type": "setMode", "mode": "acceptEdits", "destination": "session"}),
        json!({"type": "setMode", "mode": "bypassPermissions", "destination": "session"}),
        json!({"type": "removeRules", "rules": [], "destination": "session"}),
        json!("junk"),
    ];
    let out = session_suggestions(&sugg);
    assert_eq!(out.len(), 4);
    assert!(out.iter().all(|s| s["destination"] == "session"));
    let v = build_output(Cli::Claude, Decision::AllowSession, None, &sugg).unwrap();
    let d = &v["hookSpecificOutput"]["decision"];
    assert_eq!(d["behavior"], "allow");
    assert_eq!(d["updatedPermissions"].as_array().unwrap().len(), 4);
    assert!(!v.to_string().contains("localSettings") && !v.to_string().contains("projectSettings"));
}

/// 시험 `codex_output_is_behavior_and_message_only` — 0.166 은 그 밖의 칸(`updatedPermissions` …)이 있으면 결정을 버린다.
#[test]
fn codex_output_is_behavior_and_message_only() {
    let sugg = vec![json!({"type": "addRules", "rules": [], "destination": "localSettings"})];
    for d in [Decision::Allow, Decision::AllowSession, Decision::Deny] {
        let v = build_output(Cli::Codex, d, Some("no"), &sugg).unwrap();
        let dec = v["hookSpecificOutput"]["decision"].as_object().unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert!(dec.keys().all(|k| k == "behavior" || k == "message"), "{dec:?}");
    }
    assert_eq!(build_output(Cli::Codex, Decision::Deny, None, &[]).unwrap()["hookSpecificOutput"]["decision"]["message"], DEFAULT_DENY);
    assert_eq!(build_output(Cli::Claude, Decision::Release, None, &[]), None, "풀기 = 빈 출력");
}

/// 시험 `session_allow_is_exact_and_scoped` — [이 세션 동안 허용](사용자 결정 2026-11-01): 정확히 같은 대상만(접두어 없음) · 같은 타일 회차 ·
/// 같은 CLI 대화 안에서만 · 카드 없이 allow + 사건 `auto` · 타일 닫기(`forget_stream`)에 사라진다 · 보는 창이 없어도(이미 사람이 준 허락) allow.
#[test]
fn session_allow_is_exact_and_scoped() {
    let mut t = Table::default();
    let ask = |t: &mut Table, epoch: u64, conv: &str, cmd: &str, watchers: &[String]| {
        t.ask("s", epoch, env(Cli::Codex, "Bash", json!({"command": cmd}), None, Some(conv)), 0, watchers)
    };
    let id = pending_id(&ask(&mut t, 1, "c1", "npm test", &w(&["main"])).0);
    t.decide("s", 1, &id, "main", Decision::AllowSession, None, &w(&["main"])).unwrap();
    match t.take(&id) {
        Some(Outcome::Decided(v)) => assert_eq!(v["hookSpecificOutput"]["decision"], json!({ "behavior": "allow" })),
        other => panic!("{other:?}"),
    }
    let (a, evs) = ask(&mut t, 1, "c1", "npm test", &[]);
    assert!(matches!(a, Asked::Now(Outcome::Decided(_))), "같은 명령 — 곧바로 allow");
    assert_eq!(evs[0].body["t"], "auto");
    assert_eq!(evs[0].body["card"]["auto"], true);
    assert!(matches!(ask(&mut t, 1, "c1", "npm test --watch", &w(&["main"])).0, Asked::Pending(_)), "접두어로 넓히지 않는다");
    assert!(matches!(ask(&mut t, 1, "c2", "npm test", &w(&["main"])).0, Asked::Pending(_)), "다른 대화");
    assert!(matches!(ask(&mut t, 2, "c1", "npm test", &w(&["main"])).0, Asked::Pending(_)), "다른 회차");
    t.forget_stream("s");
    assert!(matches!(ask(&mut t, 1, "c1", "npm test", &[]).0, Asked::Now(Outcome::Release)), "타일 닫기에 사라진다");
}

#[test]
fn allow_targets() {
    let d = "0".repeat(64);
    assert_eq!(allow_target("Bash", &json!({"command": "ls -la"}), &d, false).unwrap(), "Bash\u{1f}ls -la");
    let patch = "*** Begin Patch\n*** Update File: b.txt\n@@\n-x\n+y\n*** Add File: a.txt\n+hi\n*** End Patch";
    assert_eq!(allow_target("apply_patch", &json!({"command": patch}), &d, false).unwrap(), "apply_patch\u{1f}a.txt\nb.txt");
    assert_eq!(allow_target("mcp__probe__echo", &json!({"text": "p1"}), &d, false), allow_target("mcp__probe__echo", &json!({"text": "p2"}), &d, false), "MCP = 서버 · 도구");
    assert_ne!(allow_target("mcp__probe__echo", &json!({}), &d, false), allow_target("mcp__probe__other", &json!({}), &d, false));
    assert_eq!(allow_target("Bash", &json!({"command": "ls"}), &d, true), None, "잘린 입력은 대상을 확정할 수 없다");
    assert_eq!(allow_target("Bash", &json!({}), &d, false), None);
}

/// 시험 `hook_words_shape` — Codex `-c` 값에는 `"` · `%` 가 없다(셸 인용 규칙 · PowerShell 5.1) · 명령은 따옴표 없는 한 줄 · timeout 은
/// 앱 시한보다 길다. Claude 설정은 훅 셋 · `*` 매처.
#[test]
fn hook_words_shape() {
    let words = codex_words("C:/Users/me/AppData/Local/AYNX/aynx.exe").unwrap();
    assert_eq!(words.len(), 8);
    assert_eq!(words.iter().filter(|x| *x == "-c").count(), 4);
    // 2026-11-02 — Esc 로 끊은 턴(`Interrupt`)은 신호 경로로(상태 점만)
    assert_eq!(
        words[7],
        "hooks.Interrupt=[{hooks=[{type='command',command='C:/Users/me/AppData/Local/AYNX/aynx.exe agent-permission interrupt codex',timeout=10}]}]"
    );
    for x in &words {
        assert!(!x.contains('"') && !x.contains('%'), "{x}");
    }
    assert_eq!(
        words[3],
        "hooks.PermissionRequest=[{hooks=[{type='command',command='C:/Users/me/AppData/Local/AYNX/aynx.exe agent-permission ask codex',timeout=150}]}]"
    );
    assert!(codex_words("C:/Program Files/AYNX/aynx.exe").is_none(), "공백이 있으면 싣지 않는다");
    assert!(codex_words("C:/it's/aynx.exe").is_none());
    const { assert!(CODEX_ASK_TIMEOUT_SECS * 1000 > CODEX_WAIT_MS && CLAUDE_ASK_TIMEOUT_SECS * 1000 > CLAUDE_WAIT_MS) };
    let c = claude_settings("C:/Program Files/AYNX/aynx.exe");
    for (ev, phase, timeout) in [("PreToolUse", "pre", MARK_TIMEOUT_SECS), ("PermissionRequest", "ask", CLAUDE_ASK_TIMEOUT_SECS), ("PostToolUse", "post", MARK_TIMEOUT_SECS)] {
        let h = &c["hooks"][ev][0];
        assert_eq!(h["matcher"], "*");
        assert_eq!(h["hooks"][0]["command"], format!("\"C:/Program Files/AYNX/aynx.exe\" agent-permission {phase} claude"));
        assert_eq!(h["hooks"][0]["timeout"], timeout);
    }
}

/// 시험 `hooks_ride_only_tile_decoration` — 훅 낱말은 타일 장식(`agent_mcp::configured_tokens` 의 `inject_mcp_token`)에서만 · 헤드리스 작업자 ·
/// 판정형 · 사이드 채팅 · 프로듀서의 인자에는 없고, 공용 환경 정화가 권한 토큰을 걷는다(사용자 결정 6) · 사용자 전역 훅 설치기는 이 훅을 모른다.
#[test]
fn hooks_ride_only_tile_decoration() {
    let callers: Vec<&str> = [
        ("agent_mcp.rs", include_str!("../agent_mcp.rs")),
        ("side_chat/claude.rs", include_str!("../side_chat/claude.rs")),
        ("side_chat/codex.rs", include_str!("../side_chat/codex.rs")),
        ("server/producer/launch.rs", include_str!("../server/producer/launch.rs")),
        ("orchestration/turn.rs", include_str!("../orchestration/turn.rs")),
        ("agent_hooks.rs", include_str!("../agent_hooks.rs")),
    ]
    .into_iter()
    .filter(|(_, src)| src.contains("hook_words(") || src.contains("agent-permission"))
    .map(|(n, _)| n)
    .collect();
    assert_eq!(callers, ["agent_mcp.rs"]);
    let mcp = include_str!("../agent_mcp.rs");
    assert!(mcp.contains("if inject_mcp_token {\n        tokens.extend(crate::tile_permission::hook_words(agent));")
        || mcp.contains("if inject_mcp_token {\r\n        tokens.extend(crate::tile_permission::hook_words(agent));"));
    assert!(crate::pty::scrub_env_names().any(|n| n == crate::tile_env::PERMISSION_TOKEN_ENV));
    let env = crate::orchestration::turn::headless_env(
        vec![(crate::tile_env::PERMISSION_TOKEN_ENV.to_string(), "x".to_string()), ("PATH".into(), "p".into())],
        &[],
    );
    assert!(!env.iter().any(|(k, _)| k == crate::tile_env::PERMISSION_TOKEN_ENV));
    // 사이드 채팅 · 프로듀서의 Claude 는 사용자 설정 층을 읽지 않고 Codex 는 훅을 끈다(이미 선 시험 — 여기서는 글자만 다시 본다).
    assert!(include_str!("../side_chat/claude.rs").contains("\"--setting-sources\""));
    assert!(include_str!("../side_chat/codex.rs").contains("\"--disable\", \"hooks\""));
}

/// 시험 `permission_token_never_reaches_frontend` · `bodies_stay_out_of_logs` — 토큰 표 · 카드 · 봉투는 `Debug` 가 없고, 서버 · GUI 파일은
/// 본문을 로그에 남기지 않는다 · 토큰은 사건 · 스냅숏에 없다.
#[test]
fn token_and_bodies_stay_inside() {
    let src = include_str!("../tile_permission.rs").replace("\r\n", "\n");
    let body = src.split("#[cfg(test)]\nmod tests;").next().unwrap();
    for s in ["struct TokenEntry", "pub(crate) struct Envelope", "struct Pending", "struct PreMark", "pub(crate) struct PermTokens", "pub(crate) struct Table"] {
        let at = body.find(s).unwrap_or_else(|| panic!("{s}"));
        let before = &body[..at];
        let attrs = &before[before.rfind("\n\n").unwrap_or(0)..];
        assert!(!attrs.lines().any(|l| l.trim_start().starts_with("#[derive") && l.contains("Debug")), "{s} 에 Debug");
    }
    for f in [include_str!("../server/tile_permission.rs"), include_str!("../server/tile_permission_proxy.rs"), body] {
        let f = f.split("#[cfg(test)]").next().unwrap_or_default();
        for line in f.lines().filter(|l| l.contains("log::line") || l.contains("eprintln!") || l.contains("println!")) {
            assert!(!line.contains('{'), "본문이 로그로 갈 수 있다: {line}");
        }
    }
    let srv = include_str!("../server/tile_permission.rs");
    assert!(!srv.contains("token\""), "사건 · 스냅숏에 토큰 칸이 없다");
    let mut t = Table::default();
    let (_, evs) = t.ask("s", 1, env(Cli::Claude, "Bash", json!({"command": "ls"}), None, None), 0, &w(&["main"]));
    let text = serde_json::to_string(&evs[0].body).unwrap();
    assert!(!text.contains("oken"), "{text}");
}

/// 시험 `permission_path_never_writes_pty` — 결정은 훅 응답(stdout)으로만 간다: 권한 경로는 PTY · 세션 입력에 닿지 않는다(AI 문자열→PTY 길
/// 없음과 무관한 별개의 길) · 승인 등급 프레임도 없다.
#[test]
fn permission_path_never_writes_pty() {
    for src in [
        include_str!("../server/tile_permission.rs"),
        include_str!("../server/tile_permission_proxy.rs"),
        include_str!("../tile_permission.rs"),
        include_str!("helper.rs"),
    ] {
        let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let code = code.split("#[cfg(test)]").next().unwrap_or_default();
        for bad in ["pty::", ".input(", "write_input", "ops_approve", "request_approve", "Grade::Approve"] {
            assert!(!code.contains(bad), "{bad}");
        }
    }
    assert_eq!(crate::server::ipc::frame::required_grade("tile_permission_decide"), Some(crate::server::ipc::Grade::Write));
}

#[test]
fn envelope_parse_rejects_bad_shapes() {
    let ok = json!({"cli": "codex", "tool": "Bash", "digest": "a".repeat(64), "toolUseId": "exec-1", "session": "01a1-x"}).to_string();
    let e = parse_envelope(&ok).unwrap();
    assert_eq!(e.cli, Cli::Codex);
    assert_eq!(e.tool_use_id.as_deref(), Some("exec-1"));
    assert_eq!(parse_envelope("[]").err(), Some("bad body"));
    assert_eq!(parse_envelope(&json!({"cli": "x", "tool": "Bash", "digest": "a".repeat(64)}).to_string()).err(), Some("bad cli"));
    assert_eq!(parse_envelope(&json!({"cli": "claude", "tool": "Bash", "digest": "zz"}).to_string()).err(), Some("bad digest"));
    let e = parse_envelope(&json!({"cli": "claude", "tool": "Bash", "digest": "a".repeat(64), "toolUseId": "a\"b"}).to_string()).unwrap();
    assert_eq!(e.tool_use_id, None, "모양이 틀린 id 는 없는 것");
}

fn color_question(multi: bool) -> Value {
    json!({ "questions": [{ "question": "Which color?", "header": "Color", "multiSelect": multi,
        "options": [{ "label": "Red", "description": "r" }, { "label": "Green", "description": "g" }] }] })
}

/// 시험 `question_answer_shape` — Claude `AskUserQuestion` 의 답은 `allow` + `updatedInput`(원래 입력 + `answers`) 하나(실측 7절). 질문마다 정확히
/// 하나 · 빈 글 · 남는 열쇠 · 잘린 입력 · Codex · 다른 도구는 거절.
#[test]
fn question_answer_shape() {
    assert_eq!(tool_kind("AskUserQuestion"), "question");
    let input = color_question(true);
    let out = answer_output(Cli::Claude, "AskUserQuestion", &input, false, &json!({ "Which color?": "Red, Green" })).unwrap();
    let d = &out["hookSpecificOutput"]["decision"];
    assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
    assert_eq!(d["behavior"], "allow");
    assert_eq!(d["updatedInput"]["answers"]["Which color?"], "Red, Green");
    assert_eq!(d["updatedInput"]["questions"], input["questions"], "원래 입력은 그대로");
    // 직접 쓴 글(기타)도 — 제어 문자는 걷고 다듬는다
    let o = answer_output(Cli::Claude, "AskUserQuestion", &input, false, &json!({ "Which color?": "  purple\u{7}  " })).unwrap();
    assert_eq!(o["hookSpecificOutput"]["decision"]["updatedInput"]["answers"]["Which color?"], "purple");
    for bad in [json!({}), json!({ "Which color?": "" }), json!({ "Which color?": "Red", "Other?": "x" }), json!({ "Which color?": 3 }), json!(["Red"])] {
        assert!(answer_output(Cli::Claude, "AskUserQuestion", &input, false, &bad).is_none(), "{bad}");
    }
    assert!(answer_output(Cli::Claude, "AskUserQuestion", &input, true, &json!({ "Which color?": "Red" })).is_none(), "잘린 입력");
    assert!(answer_output(Cli::Codex, "AskUserQuestion", &input, false, &json!({ "Which color?": "Red" })).is_none(), "CLI · 도구가 짝이 맞아야");
    assert!(answer_output(Cli::Claude, "request_user_input", &input, false, &json!({ "Which color?": "Red" })).is_none());
    assert!(answer_output(Cli::Claude, "Bash", &input, false, &json!({ "Which color?": "Red" })).is_none());
    let long = "x".repeat(ANSWER_MAX_CHARS + 1);
    assert!(answer_output(Cli::Claude, "AskUserQuestion", &input, false, &json!({ "Which color?": long })).is_none());
}

/// 시험 `question_card_answers_once` — 질문 카드는 [이 세션 동안 허용]이 없고 답 없는 허용은 거절 · 답은 보는 창에서 처음 하나만 · 모양이
/// 틀리면 카드가 남는다.
#[test]
fn question_card_answers_once() {
    let mut t = Table::default();
    let (a, evs) = t.ask("s1", 1, env(Cli::Claude, "AskUserQuestion", color_question(false), None, Some("c1")), 0, &w(&["main"]));
    let id = pending_id(&a);
    assert_eq!(evs[0].body["card"]["kind"], "question");
    assert_eq!(evs[0].body["card"]["canAllowSession"], false);
    assert!(matches!(t.decide("s1", 1, &id, "main", Decision::Allow, None, &w(&["main"])), Err("bad-decision")));
    assert!(matches!(t.decide("s1", 1, &id, "main", Decision::AllowSession, None, &w(&["main"])), Err("bad-decision")));
    assert!(matches!(t.answer("s1", 1, &id, "aux", &json!({ "Which color?": "Red" }), &w(&["main"])), Err("not-viewing")));
    assert!(matches!(t.answer("s1", 1, &id, "main", &json!({ "Which color?": "" }), &w(&["main"])), Err("bad-answer")));
    let (applied, evs) = t.answer("s1", 1, &id, "main", &json!({ "Which color?": "Green" }), &w(&["main", "remote-a-1"])).unwrap();
    assert!(applied);
    assert_eq!(evs[0].body["reason"], "answered");
    assert!(!t.answer("s1", 1, &id, "remote-a-1", &json!({ "Which color?": "Red" }), &w(&["main", "remote-a-1"])).unwrap().0, "둘째는 조용히");
    match t.take(&id) {
        Some(Outcome::Decided(v)) => assert_eq!(v["hookSpecificOutput"]["decision"]["updatedInput"]["answers"]["Which color?"], "Green"),
        other => panic!("답이 나가야 한다: {other:?}"),
    }
}

/// 시험 `codex_question_answer_reason` — Codex `request_user_input` 의 답은 `PreToolUse` deny 이유 글 하나(A안 · 실측 10절): 고정 머리 + 질문마다
/// `Q<n> "<질문>": <답>` · 재료는 질문 글과 사람의 답뿐 · 줄바꿈 · 따옴표 정리 · 상한 · 그 밖의 칸 없음.
#[test]
fn codex_question_answer_reason() {
    let input = json!({ "questions": [
        { "id": "color", "header": "Color", "question": "Which \"color\"?", "options": [{ "label": "Red" }, { "label": "Green" }] },
        { "id": "size", "header": "Size", "question": "Which size?", "options": [{ "label": "S" }] },
    ] });
    let out = answer_output(Cli::Codex, "request_user_input", &input, false, &json!({ "Which \"color\"?": "Green", "Which size?": "big\nand \"wide\"" })).unwrap();
    let h = out["hookSpecificOutput"].as_object().unwrap();
    assert_eq!(h.len(), 3, "hookEventName · permissionDecision · permissionDecisionReason 셋뿐");
    assert_eq!(h["hookEventName"], "PreToolUse");
    assert_eq!(h["permissionDecision"], "deny");
    let reason = h["permissionDecisionReason"].as_str().unwrap();
    // 여럿이면 `<머리>=<답>; …` — 질문 원문은 싣지 않는다 · 줄바꿈 · 따옴표 정리
    assert_eq!(reason, format!("{CODEX_ANSWER_HEAD} Color=Green; Size=big and 'wide'"));
    assert!(!reason.contains("Which"), "질문 원문 없음");
    assert_eq!(CODEX_ANSWER_HEAD, "Answered in AYNX (the user's answer, not an error):");
    // 하나면 답만 · 머리가 없으면 id · 둘 다 없으면 Q<n>
    let one = json!({ "questions": [{ "id": "color", "header": "Color", "question": "Which color?", "options": [{ "label": "Red" }] }] });
    let o = answer_output(Cli::Codex, "request_user_input", &one, false, &json!({ "Which color?": "Red" })).unwrap();
    assert_eq!(o["hookSpecificOutput"]["permissionDecisionReason"], format!("{CODEX_ANSWER_HEAD} Red"));
    let bare = json!({ "questions": [
        { "id": "a1", "question": "First?", "options": [{ "label": "x" }] },
        { "question": "Second?", "options": [{ "label": "y" }] },
    ] });
    let b = answer_output(Cli::Codex, "request_user_input", &bare, false, &json!({ "First?": "x", "Second?": "y" })).unwrap();
    assert_eq!(b["hookSpecificOutput"]["permissionDecisionReason"], format!("{CODEX_ANSWER_HEAD} a1=x; Q2=y"));
    // 질문마다 정확히 하나 · 빈 답 · 남는 열쇠 거절 · 잘린 입력 거절
    assert!(answer_output(Cli::Codex, "request_user_input", &input, false, &json!({ "Which \"color\"?": "Green" })).is_none());
    assert!(answer_output(Cli::Codex, "request_user_input", &input, false, &json!({ "Which \"color\"?": " ", "Which size?": "S" })).is_none());
    assert!(answer_output(Cli::Codex, "request_user_input", &input, true, &json!({ "Which \"color\"?": "Green", "Which size?": "S" })).is_none());
    // 상한
    let long = codex_answer_reason(&[("q".repeat(5_000), "a".repeat(5_000)), ("r".into(), "b".repeat(5_000))]);
    assert!(long.chars().count() <= 4_000);
    assert!(codex_answer_reason(&[("q".repeat(400), "x".into()), ("r".into(), "y".into())]).contains('…'));
}

/// 시험 `codex_question_card_waits` — Codex 질문은 `ask` 처럼 카드를 세우고 기다린다(10분) · 답 = deny 이유 · 허용 · 세션 허용은 거절 · 풀기 = 빈 출력
/// (TUI 가 묻는다) · 끊음(`drop_questions`)은 그 스트림의 Codex 질문만 걷고 기다리는 훅은 빈 출력.
#[test]
fn codex_question_card_waits() {
    let q = json!({ "questions": [{ "id": "color", "header": "Color", "question": "Which color?", "options": [{ "label": "Red" }] }] });
    let mut t = Table::default();
    let (a, evs) = t.ask("s", 1, env(Cli::Codex, "request_user_input", q.clone(), Some("call-1"), Some("c")), 100, &w(&["main"]));
    let id = pending_id(&a);
    let card = &evs[0].body["card"];
    assert_eq!((card["kind"].as_str(), card["cli"].as_str(), card["canAllowSession"].as_bool()), (Some("question"), Some("codex"), Some(false)));
    assert_eq!(card["deadlineAt"], 100 + QUESTION_WAIT_MS);
    assert!(matches!(t.decide("s", 1, &id, "main", Decision::Allow, None, &w(&["main"])), Err("bad-decision")));
    assert!(t.answer("s", 1, &id, "main", &json!({ "Which color?": "Purple, please" }), &w(&["main"])).unwrap().0);
    match t.take(&id) {
        Some(Outcome::Decided(v)) => {
            assert_eq!(v["hookSpecificOutput"]["permissionDecision"], "deny");
            assert!(v["hookSpecificOutput"]["permissionDecisionReason"].as_str().unwrap().ends_with(": Purple, please"));
        }
        other => panic!("답이 나가야 한다: {other:?}"),
    }
    // 풀기 — 결정 없이(빈 출력 → TUI 의 평소 질문)
    let (a2, _) = t.ask("s", 1, env(Cli::Codex, "request_user_input", q.clone(), Some("call-2"), Some("c")), 0, &w(&["main"]));
    let id2 = pending_id(&a2);
    assert!(t.decide("s", 1, &id2, "main", Decision::Release, None, &w(&["main"])).unwrap().0);
    assert_eq!(t.take(&id2), Some(Outcome::Release));
    // 끊음 — Codex 질문만 걷는다(다른 카드는 그대로) · 기다리던 훅은 카드가 없어 빈 출력
    let (a3, _) = t.ask("s", 1, env(Cli::Codex, "request_user_input", q, Some("call-3"), Some("c")), 0, &w(&["main"]));
    let id3 = pending_id(&a3);
    let (a4, _) = t.ask("s", 1, env(Cli::Codex, "Bash", json!({"command": "ls"}), Some("call-4"), Some("c")), 0, &w(&["main"]));
    let id4 = pending_id(&a4);
    let gone = t.drop_questions("s");
    assert_eq!((gone.len(), gone[0].body["requestId"].as_str()), (1, Some(id3.as_str())));
    assert_eq!(t.take(&id3), Some(Outcome::Release));
    assert_eq!(t.snapshot("s", 1).len(), 1, "명령 카드는 남는다");
    assert!(t.take(&id4).is_none());
}


/// 시험 `face_rule_tui_asks` — 면 규칙(2026-11-02 사용자 승인 · **Codex 만**): 대화 면으로 보는 창이 없으면 카드 없이 곧바로 빈 출력 + TUI 물음 표지 · 다음 훅이
/// 표지를 걷는다 · 카드가 선 동안 모두 터미널 면으로 넘기면(`release_stream`) 풀고 표지 · [터미널에서 답하기] 도 표지 · 시계의 "보는 창 없음"(유예 뒤)도
/// 표지 · 끊음 · 세션 끝은 걷는다.
#[test]
fn face_rule_tui_asks() {
    let mut t = Table::default();
    let bash = || env(Cli::Codex, "Bash", json!({"command": "ls"}), None, Some("c"));
    // 터미널 면뿐 — 카드 없음 · 표지
    let (a, evs) = t.ask("s", 1, bash(), 0, &[]);
    assert_eq!(a, Asked::Now(Outcome::Release));
    assert!(t.tui_asking("s") && t.snapshot("s", 1).is_empty());
    assert_eq!(evs.len(), 1);
    // 두 번째도 터미널 면 — 이미 섰으니 사건은 "끔 → 켬" 둘(지난 물음은 끝, 새 물음)
    let (_, evs) = t.ask("s", 1, bash(), 0, &[]);
    assert_eq!(evs.iter().map(|e| e.body["asking"].as_bool().unwrap()).collect::<Vec<_>>(), vec![false, true]);
    // 대화 면 창이 생긴 뒤의 훅 — 표지를 걷고 카드
    let (a, evs) = t.ask("s", 1, bash(), 0, &w(&["main"]));
    let id = pending_id(&a);
    assert!(!t.tui_asking("s"));
    assert_eq!(evs[0].body["t"], "tui");
    assert_eq!(evs[1].body["t"], "request");
    // 모두 터미널 면으로 — 풀고 표지
    let evs = t.release_stream("s");
    assert_eq!(evs[0].body["reason"], "released");
    assert_eq!(evs[1].body["asking"], true);
    assert_eq!(t.take(&id), Some(Outcome::Release));
    // [터미널에서 답하기]
    t.clear_tui("s", 1);
    let (a, _) = t.ask("s", 1, bash(), 0, &w(&["main"]));
    let id = pending_id(&a);
    let (_, evs) = t.decide("s", 1, &id, "main", Decision::Release, None, &w(&["main"])).unwrap();
    assert_eq!(evs.last().unwrap().body["asking"], true);
    // 시계 — 대화 면 창이 사라지고 유예가 지나면 푼다(표지) · 세션 끝은 표지 없이
    t.clear_tui("s", 1);
    let (a, _) = t.ask("s", 1, bash(), 0, &w(&["main"]));
    let id = pending_id(&a);
    t.begin_poll("s", &id);
    assert!(t.sweep(10, |_| Some(Vec::new())).is_empty(), "유예 안");
    let evs = t.sweep(10 + NO_VIEWER_GRACE_MS, |_| Some(Vec::new()));
    assert_eq!(evs[0].body["reason"], "no-viewer");
    assert_eq!(evs[1].body["asking"], true);
    // 끊음 — 카드 없이 TUI 만 묻던 중에도 걷는다
    assert!(t.tui_asking("s"));
    let evs = t.drop_questions("s");
    assert_eq!(evs[0].body["asking"], false);
    assert!(!t.tui_asking("s"));
    // 세션 끝 — 걷는다
    t.mark_tui("s", 1);
    t.forget_stream("s");
    assert!(!t.tui_asking("s"));
}

/// 질문 대기 보호는 Codex 질문에만 — 카드 · TUI 전환은 유지, 다음 훅 · 답 · 끊음 · 세션 끝은 해제
#[test]
fn codex_question_waiting_tracks_card_and_tui() {
    let mut t = Table::default();
    let q = || env(Cli::Codex, "request_user_input", json!({"questions": [{"id": "c", "question": "Which?"}]}), Some("call-1"), Some("c"));
    let (a, _) = t.ask("s", 1, q(), 0, &[]);
    assert_eq!(a, Asked::Now(Outcome::Release));
    assert!(t.codex_question_waiting("s"));
    t.clear_tui("s", 1);
    assert!(!t.codex_question_waiting("s"));
    let (a, _) = t.ask("s", 1, q(), 0, &w(&["main", "remote"]));
    let id = pending_id(&a);
    assert!(t.codex_question("s", 1, &id) && t.codex_question_waiting("s"));
    assert!(!t.codex_question("s", 2, &id));
    t.release_stream("s");
    t.take(&id);
    assert!(t.codex_question_waiting("s"), "TUI 로 넘겨도 답은 기다린다");
    t.drop_questions("s");
    assert!(!t.codex_question_waiting("s"));
    let (a, _) = t.ask("s", 1, q(), 0, &w(&["main"]));
    let id = pending_id(&a);
    t.answer("s", 1, &id, "main", &json!({"Which?": "A"}), &w(&["main"])).unwrap();
    assert!(!t.codex_question_waiting("s"));
    t.take(&id);
    let (a, _) = t.ask("s", 1, q(), 0, &w(&["main"]));
    let id = pending_id(&a);
    t.decide("s", 1, &id, "main", Decision::Release, None, &w(&["main"])).unwrap();
    t.take(&id);
    assert!(t.codex_question_waiting("s"), "터미널에서 답하기도 대기 유지");
    t.post("s", &q());
    t.clear_tui("s", 1);
    assert!(!t.codex_question_waiting("s"));
    let (a, _) = t.ask("s", 1, q(), 0, &w(&["main"]));
    let id = pending_id(&a);
    t.begin_poll("s", &id);
    t.sweep(QUESTION_WAIT_MS, |_| Some(w(&["main"])));
    t.take(&id);
    assert!(t.codex_question_waiting("s"), "시한 뒤 TUI 질문도 대기 유지");
    t.clear_tui("s", 1);
    t.ask("s", 1, q(), 0, &[]);
    t.forget_stream("s");
    assert!(!t.codex_question_waiting("s"));
    t.ask("s", 1, env(Cli::Codex, "Bash", json!({"command": "ls"}), None, None), 0, &[]);
    assert!(!t.codex_question_waiting("s"), "일반 권한은 기존 훅 신호만");
    t.ask("s", 1, env(Cli::Claude, "AskUserQuestion", color_question(false), None, None), 0, &w(&["main"]));
    assert!(!t.codex_question_waiting("s"), "Claude 는 기존 훅 신호만");
}


/// 시험 `claude_ignores_face_rule` — Claude 는 면 규칙 밖(2026-11-02 사용자 승인): 훅이 도는 동안 TUI 창이 함께 떠 있어 늘 카드를 세운다 —
/// 터미널 면으로 넘겨도(`release_stream`) 카드는 그대로 · 풀기 · 시한 · 창 없음에도 TUI 물음 표지 없음. 보는 창 판정은 서버가 CLI 로 가른다.
#[test]
fn claude_ignores_face_rule() {
    assert!(!face_rule_applies(Cli::Claude) && face_rule_applies(Cli::Codex));
    let mut t = Table::default();
    let q = json!({ "questions": [{ "question": "Which?", "header": "H", "multiSelect": false, "options": [{ "label": "A" }] }] });
    // 서버는 Claude 에 "그 세션을 보는 모든 창" 을 준다 — 터미널 면 창이라도 카드
    let (a, _) = t.ask("s", 1, env(Cli::Claude, "AskUserQuestion", q, None, Some("c")), 0, &w(&["main"]));
    let id = pending_id(&a);
    assert_eq!(t.stream_cli("s"), Some(Cli::Claude));
    // 모두 터미널 면으로 넘겨도 Claude 카드는 그대로
    assert!(t.release_stream("s").is_empty());
    assert_eq!(t.snapshot("s", 1).len(), 1);
    assert!(!t.tui_asking("s"));
    // 풀기 · 창 없음 유예 뒤에도 표지 없음
    t.begin_poll("s", &id);
    let evs = t.sweep(NO_VIEWER_GRACE_MS + 1, |_| Some(Vec::new()));
    let evs2 = t.sweep(2 * NO_VIEWER_GRACE_MS + 2, |_| Some(Vec::new()));
    assert!(evs.iter().chain(evs2.iter()).all(|e| e.body["t"] != "tui"));
    assert!(!t.tui_asking("s"));
    let (a, _) = t.ask("s", 1, env(Cli::Claude, "Bash", json!({"command": "ls"}), None, Some("c")), 0, &w(&["main"]));
    let id = pending_id(&a);
    let (_, evs) = t.decide("s", 1, &id, "main", Decision::Release, None, &w(&["main"])).unwrap();
    assert!(evs.iter().all(|e| e.body["t"] != "tui"));
    assert!(!t.tui_asking("s"));
}
