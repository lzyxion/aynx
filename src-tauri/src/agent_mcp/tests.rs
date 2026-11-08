use super::*;

#[test]
fn project_entries_replace_global_entries_including_disabled_ones() {
    let global = stdio("postgres");
    let mut project = global.clone();
    project.project_id = Some("p1".into());
    project.command = Some("uvx".into());
    project.env = vec![McpEnv {
        name: "DATABASE_URL".into(),
        secret_ref: "p1/db:ref".into(),
    }];
    let mut other = project.clone();
    other.project_id = Some("p2".into());
    other.enabled = false;
    let all = vec![
        global.clone(),
        project.clone(),
        other.clone(),
        project.clone(),
    ];
    assert_eq!(servers_for_project(&all, None), vec![global.clone()]);
    assert_eq!(servers_for_project(&all, Some("unknown")), vec![global]);
    assert_eq!(servers_for_project(&all, Some("p1")), vec![project]);
    assert_eq!(servers_for_project(&all, Some("p2")), vec![other]);
    assert!(codex_tokens(&servers_for_project(&all, Some("p2")), None).is_empty());
}

#[test]
fn environment_metadata_and_scopes_are_validated_without_plaintext_fields() {
    let mut server = stdio("postgres");
    server.env = vec![McpEnv {
        name: "DATABASE_URL".into(),
        secret_ref: "global/db:ref".into(),
    }];
    server.project_id = Some("p1".into());
    assert!(validate(&server).is_none());
    for name in ["", "1_VAR", "A-B", "A B", "A=B"] {
        let mut bad = server.clone();
        bad.env[0].name = name.into();
        assert!(validate(&bad).is_some());
    }
    let mut bad = server.clone();
    bad.env.push(McpEnv {
        name: "database_url".into(),
        secret_ref: "other".into(),
    });
    assert!(validate(&bad).is_some());
    bad = server.clone();
    bad.project_id = Some("".into());
    assert!(validate(&bad).is_some());
    let mut remote = http("remote");
    remote.env = server.env.clone();
    assert!(validate(&remote).is_some());
    let mut json = serde_json::to_value(&server).unwrap();
    json["env"][0]["value"] = "plaintext".into();
    assert!(serde_json::from_value::<McpServer>(json).is_err());
    let settings: crate::settings::AppSettings =
        serde_json::from_value(json!({"ai": {"mcp_servers": [server]}})).unwrap();
    let raw = toml::to_string(&settings).unwrap();
    assert_eq!(
        toml::from_str::<crate::settings::AppSettings>(&raw).unwrap(),
        settings
    );
}

#[test]
fn cwd_selects_the_nearest_project_at_a_path_boundary() {
    let roots = vec![
        ("parent".into(), "/work/app".into()),
        ("nested".into(), "/work/app/packages/api".into()),
    ];
    assert_eq!(
        project_from_roots("/work/app/packages/api/src", &roots).as_deref(),
        Some("nested")
    );
    assert_eq!(
        project_from_roots("/work/app/ui", &roots).as_deref(),
        Some("parent")
    );
    assert_eq!(project_from_roots("/work/application", &roots), None);
    #[cfg(windows)]
    assert_eq!(
        project_from_roots(r"C:\WORK\app\src", &[("win".into(), "c:/work/app/".into())]).as_deref(),
        Some("win")
    );
}

#[test]
fn an_external_git_worktree_uses_the_registered_repository_scope() {
    let dir = std::env::temp_dir().join(format!(
        "aynx-mcp-worktree-{}",
        crate::token::generate_token().unwrap()
    ));
    let repo = dir.join("repo");
    let worktree = dir.join("worktree");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        let result = std::process::Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "git fixture failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    git(&["init"]);
    git(&[
        "-c",
        "user.name=MCP test",
        "-c",
        "user.email=mcp@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
    ]);
    git(&[
        "worktree",
        "add",
        "-b",
        "scope-test",
        worktree.to_str().unwrap(),
    ]);
    assert_eq!(
        project_for_roots(
            worktree.to_str().unwrap(),
            &[("project".into(), repo.to_string_lossy().into_owned())]
        )
        .as_deref(),
        Some("project")
    );
    git(&["worktree", "remove", worktree.to_str().unwrap()]);
    std::fs::remove_dir_all(dir).unwrap();
}

fn stdio(name: &str) -> McpServer {
    McpServer {
        name: name.to_owned(),
        enabled: true,
        agents: None,
        project_id: None,
        env: vec![],
        headers: vec![],
        transport: "stdio".to_owned(),
        command: Some("npx".to_owned()),
        args: vec!["a b".to_owned()],
        url: None,
        side_chat: false,
        side_chat_no_ask: false,
    }
}

fn http(name: &str) -> McpServer {
    McpServer {
        name: name.to_owned(),
        enabled: true,
        agents: None,
        project_id: None,
        env: vec![],
        headers: vec![],
        transport: "http".to_owned(),
        command: None,
        args: vec![],
        url: Some("https://example.com/mcp".to_owned()),
        side_chat: false,
        side_chat_no_ask: false,
    }
}

#[test]
fn claude_and_codex_shells_and_resume_keep_their_places() {
    let cases = [
        (
            "pwsh",
            "claude --mcp-config '/tmp/aynx config.json'",
            r#"-c 'mcp_servers.play.command=''npx''' -c 'mcp_servers.play.args=[''a b'']'"#,
        ),
        (
            "cmd",
            "claude --mcp-config \"/tmp/aynx config.json\"",
            r#"-c "mcp_servers.play.command='npx'" -c "mcp_servers.play.args=['a b']""#,
        ),
        (
            "gitbash",
            "claude --mcp-config '/tmp/aynx config.json'",
            r#"-c 'mcp_servers.play.command='\''npx'\''' -c 'mcp_servers.play.args=['\''a b'\'']'"#,
        ),
    ];
    for (shell, claude, overrides) in cases {
        let servers = [stdio("play")];
        assert_eq!(
            with_servers(
                "claude",
                Some(shell),
                &servers,
                Some("/tmp/aynx config.json"),
                None,
            ),
            claude
        );
        assert_eq!(
            with_servers("codex", Some(shell), &servers, None, None),
            format!("codex {overrides}")
        );
        assert_eq!(
            with_servers("codex resume id", Some(shell), &servers, None, None),
            format!("codex resume {overrides} id")
        );
        assert_eq!(
            with_servers("codex fork id", Some(shell), &servers, None, None),
            format!("codex fork {overrides} id")
        );
        let line = with_servers(
            "codex resume --no-daemon --model o3 id",
            Some(shell),
            &servers,
            None,
            None,
        );
        assert_eq!(
            line,
            format!("codex resume --no-daemon {overrides} --model o3 id")
        );
        let line = with_servers("codex resume id", Some(shell), &servers, None, None);
        assert_eq!(
            crate::codex_launch::codex_line(&line, true),
            Some(format!("codex resume --no-daemon {overrides} id"))
        );
    }
}

#[test]
fn claude_keeps_user_config_and_does_not_use_strict() {
    let line = with_servers(
        "claude --mcp-config user.json --resume id",
        Some("gitbash"),
        &[http("web")],
        Some("/tmp/agent-mcp.json"),
        None,
    );
    assert_eq!(
        line,
        "claude --mcp-config user.json --resume id --mcp-config /tmp/agent-mcp.json"
    );
    assert!(!line.contains("--strict-mcp-config"));
    let config: Value =
        serde_json::from_str(&claude_config(&[stdio("play"), http("web")], None).unwrap()).unwrap();
    assert_eq!(
        config["mcpServers"]["play"],
        json!({"type":"stdio", "command":"npx", "args":["a b"]})
    );
    assert_eq!(
        config["mcpServers"]["web"],
        json!({"type":"http", "url":"https://example.com/mcp"})
    );
    assert_eq!(
        codex_tokens(&[http("web")], None),
        vec!["-c", "mcp_servers.web.url='https://example.com/mcp'"]
    );
    for (shell, override_arg) in [
        (
            "pwsh",
            r#"-c 'mcp_servers.web.url=''https://example.com/mcp'''"#,
        ),
        (
            "cmd",
            r#"-c "mcp_servers.web.url='https://example.com/mcp'""#,
        ),
        (
            "gitbash",
            r#"-c 'mcp_servers.web.url='\''https://example.com/mcp'\'''"#,
        ),
    ] {
        assert_eq!(
            with_servers("codex", Some(shell), &[http("web")], None, None),
            format!("codex {override_arg}")
        );
        assert_eq!(
            with_servers("codex resume id", Some(shell), &[http("web")], None, None),
            format!("codex resume {override_arg} id")
        );
    }
}

#[test]
fn invalid_disabled_and_wsl_servers_never_get_arguments() {
    let mut off = stdio("off");
    off.enabled = false;
    let bad = stdio("bad.name");
    for shell in ["pwsh", "cmd", "gitbash"] {
        assert_eq!(
            with_servers(
                "codex resume id",
                Some(shell),
                &[off.clone(), bad.clone()],
                None,
                None,
            ),
            "codex resume id"
        );
        assert_eq!(
            with_servers(
                "claude",
                Some(shell),
                &[off.clone(), bad.clone()],
                Some("/tmp/a.json"),
                None,
            ),
            "claude"
        );
        assert_eq!(
            with_servers("sh", Some(shell), &[stdio("play")], None, None),
            "sh"
        );
    }
    for agent in ["claude", "codex", "codex resume id"] {
        assert_eq!(
            with_servers(
                agent,
                Some("wsl:Ubuntu"),
                &[stdio("play")],
                Some("/tmp/a.json"),
                None,
            ),
            agent
        );
    }
    assert!(claude_config(&[off, bad], None).is_none());
    assert_eq!(
        with_servers(
            "claude",
            Some("cmd"),
            &[stdio("play")],
            Some("/tmp/bad%file"),
            None,
        ),
        "claude"
    );
}

#[test]
fn invalid_values_and_reserved_names_are_rejected_one_item_at_a_time() {
    for name in ["", "A", "x.y", "x y", &"x".repeat(49)] {
        assert!(validate(&stdio(name)).is_some());
    }
    for dev in [false, true] {
        assert!(validate(&stdio(crate::instance::mcp_name(dev))).is_some());
        for name in crate::instance::legacy_mcp_names(dev) {
            assert!(validate(&stdio(name)).is_some());
        }
    }
    for value in [
        "", "x\n", "x\t", "x\"", "x%", "x'", "x‘", "x’", "x‚", "x‛", "x\\",
    ] {
        let mut server = stdio("play");
        server.args = vec![value.to_owned()];
        assert!(validate(&server).is_some(), "{value:?}");
        server.args.clear();
        server.command = Some(value.to_owned());
        assert!(validate(&server).is_some());
    }
    for url in ["file:///a", "ftp://example.com", "https://", "http://a\n"] {
        let mut server = http("web");
        server.url = Some(url.to_owned());
        assert!(validate(&server).is_some());
    }
    let mut servers = vec![
        stdio("valid"),
        stdio("bad.name"),
        stdio("valid"),
        http("web"),
    ];
    clean_servers(&mut servers);
    assert_eq!(
        servers.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        vec!["valid", "web"]
    );
}

#[test]
fn malformed_toml_items_do_not_reset_other_settings() {
    let raw = r#"
[ai]
start_dir = '/keep'
[[ai.mcp_servers]]
name = 'good'
enabled = true
transport = 'stdio'
command = 'npx'
args = ['a']
[[ai.mcp_servers]]
name = 'bad-type'
enabled = 'true'
transport = 'stdio'
command = 'npx'
[[ai.mcp_servers]]
name = 'secret-field'
enabled = true
transport = 'http'
url = 'https://example.com'
headers = { Authorization = 'value' }
[[ai.mcp_servers]]
name = 'web'
enabled = true
transport = 'http'
url = 'https://example.com/mcp'
"#;
    let settings: crate::settings::AppSettings = toml::from_str(raw).unwrap();
    assert_eq!(settings.ai.start_dir.as_deref(), Some("/keep"));
    assert_eq!(
        settings
            .ai
            .mcp_servers
            .iter()
            .map(|s| s.name.as_str())
            .collect::<Vec<_>>(),
        vec!["good", "web"]
    );
    let serialized = toml::to_string(&settings).unwrap();
    assert!(serialized.contains("[[ai.mcp_servers]]"));
    assert!(!serialized.contains("headers"));
    assert_eq!(
        toml::from_str::<crate::settings::AppSettings>(&serialized).unwrap(),
        settings
    );
}

#[test]
fn config_write_is_atomic_and_skips_unchanged_contents() {
    let dir = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("mcp-inject-test-{}", std::process::id()));
    let path = dir.join("agent-mcp.json");
    let first = claude_config(&[stdio("play")], None).unwrap();
    assert_eq!(write_config(&path, &first), Some(()));
    assert!(!crate::app_state::save_at(&path, &first).unwrap());
    let second = claude_config(&[http("web")], None).unwrap();
    assert_eq!(write_config(&path, &second), Some(()));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), second);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_dir(&dir).unwrap();
}

#[test]
fn agent_targets_filter_both_launch_lines_and_claude_json() {
    let mut claude = stdio("claude_only");
    claude.agents = Some(vec!["claude".to_owned(), "unknown".to_owned()]);
    let mut codex = http("codex_only");
    codex.agents = Some(vec!["codex".to_owned()]);
    let servers = [claude.clone(), codex.clone()];
    let config: Value = serde_json::from_str(&claude_config(&servers, None).unwrap()).unwrap();
    assert!(config["mcpServers"].get("claude_only").is_some());
    assert!(config["mcpServers"].get("codex_only").is_none());
    for shell in ["pwsh", "cmd", "gitbash"] {
        let line = with_servers("codex resume id", Some(shell), &servers, None, None);
        assert!(line.contains("mcp_servers.codex_only.url"));
        assert!(!line.contains("claude_only"));
        assert_eq!(
            with_servers("codex", Some(shell), std::slice::from_ref(&claude), None, None),
            "codex"
        );
        assert_eq!(
            with_servers(
                "claude",
                Some(shell),
                std::slice::from_ref(&codex),
                Some("/tmp/a.json"),
                None,
            ),
            "claude"
        );
        assert!(
            with_servers("claude", Some(shell), &servers, Some("/tmp/a.json"), None)
                .contains("--mcp-config")
        );
    }
}

#[test]
fn legacy_enabled_empty_and_unknown_agents_keep_their_meaning() {
    let legacy: McpServer = serde_json::from_value(json!({
        "name": "legacy", "enabled": true, "transport": "stdio", "command": "npx"
    }))
    .unwrap();
    assert!(legacy.agents.is_none());
    assert!(claude_config(std::slice::from_ref(&legacy), None).is_some());
    assert!(!codex_tokens(std::slice::from_ref(&legacy), None).is_empty());
    let mut off = legacy.clone();
    off.enabled = false;
    let mut empty = legacy.clone();
    empty.agents = Some(vec![]);
    let mut unknown = legacy.clone();
    unknown.agents = Some(vec!["unknown".to_owned()]);
    for server in [off, empty.clone(), unknown] {
        assert!(claude_config(std::slice::from_ref(&server), None).is_none());
        assert!(codex_tokens(std::slice::from_ref(&server), None).is_empty());
    }
    assert!(serde_json::to_value(&legacy)
        .unwrap()
        .get("agents")
        .is_none());
    assert_eq!(serde_json::to_value(&empty).unwrap()["agents"], json!([]));
    assert!(serde_json::from_value::<McpServer>(json!({
        "name": "bad", "enabled": true, "transport": "stdio", "command": "npx", "agents": "claude"
    }))
    .is_err());
}

/// 시작 정리(③-3c) — 파일 이름의 pid 가 살아 있거나 서버의 살아 있는 세션이 쥔 파일은 남기고, 나머지·옛 단일 파일·같은 규칙의
/// 임시 파일은 지운다. 모양이 다른 파일은 건드리지 않는다.
#[test]
fn stale_agent_configs_keep_live_pids_and_claimed_files() {
    let dir = std::env::temp_dir().join(format!(
        "aynx-mcp-cleanup-{}",
        crate::token::generate_token().unwrap()
    ));
    let configs = dir.join("agent-mcp");
    std::fs::create_dir_all(&configs).unwrap();
    let live = configs.join("100-0000000000000001.json");
    let claimed = configs.join("200-0000000000000002.json");
    let stale = configs.join("200-0000000000000003.json");
    let stale_tmp = configs.join("200-0000000000000004.tmp");
    let legacy = dir.join("agent-mcp.json");
    let unrelated = configs.join("notes.json");
    for path in [&live, &claimed, &stale, &stale_tmp, &legacy, &unrelated] {
        std::fs::write(path, "{}").unwrap();
    }
    // pid 100 은 살아 있고, pid 200 의 파일 중 "…0002" 만 살아 있는 세션이 쥐었다.
    let removed = cleanup_configs(&dir, |pid, name| pid == 100 || name == "200-0000000000000002.json");
    assert_eq!(removed, 2);
    assert!(live.is_file(), "살아 있는 GUI 의 파일");
    assert!(claimed.is_file(), "GUI 는 죽었어도 살아 있는 세션의 claude 가 쓰는 파일");
    assert!(unrelated.is_file());
    assert!(!stale.exists());
    assert!(!stale_tmp.exists());
    assert!(!legacy.exists());
    std::fs::remove_dir_all(dir).unwrap();
}

/// 주장 장부(③-3c — 서버) — 모양이 맞는 이름만 받고, 마지막 주인이 놓으면 그 파일이 장부에서 빠진다(파일 지우기는 데이터
/// 폴더라 여기서는 장부만 본다).
#[test]
fn claims_are_released_with_the_last_stream() {
    let file = "4242-00000000000000aa.json";
    assert!(!claim("s-x", "../evil.json"), "경로·다른 모양은 받지 않는다");
    assert!(!claim("", file));
    assert!(claim("claim-test-a", file));
    assert!(claim("claim-test-b", file));
    assert!(claimed_files().iter().any(|f| f == file));
    release_stream("claim-test-a");
    assert!(claimed_files().iter().any(|f| f == file), "다른 타일이 아직 쥐었다");
    release_stream("claim-test-b");
    assert!(!claimed_files().iter().any(|f| f == file));
}

#[test]
fn sessions_json_has_auth_but_launch_arguments_never_have_the_token() {
    for dev in [false, true] {
        let server = SessionsServer::running(true, 53812, "sessions-test-secret", dev).unwrap();
        let prefs = crate::settings::AiPrefs::default();
        let sessions = sessions_for("claude", Some("pwsh"), true, &prefs, Some(&server));
        let config: Value = serde_json::from_str(&claude_config(&[], sessions).unwrap()).unwrap();
        let name = crate::instance::mcp_name(dev);
        assert_eq!(config["mcpServers"][name], json!({
            "type": "http", "url": "http://127.0.0.1:53812/mcp",
            "headers": { "Authorization": "Bearer sessions-test-secret" }
        }));
        let combined: Value = serde_json::from_str(&claude_config(&[stdio("play")], sessions).unwrap()).unwrap();
        assert!(combined["mcpServers"].get("play").is_some());
        assert!(combined["mcpServers"].get(name).is_some());
        assert_eq!(codex_tokens(&[], Some(&server)), vec![
            "-c".to_owned(), format!("mcp_servers.{name}.url='http://127.0.0.1:53812/mcp'"),
            "-c".to_owned(), format!("mcp_servers.{name}.bearer_token_env_var='{}'", crate::instance::mcp_token_env(dev))
        ]);
        for shell in ["pwsh", "cmd", "gitbash"] {
            let line = with_servers("claude", Some(shell), &[], Some("/tmp/a.json"), sessions);
            assert!(line.contains("--mcp-config"));
            assert!(!line.contains("sessions-test-secret") && !line.contains("Bearer"));
            let sessions = sessions_for("codex", Some(shell), true, &prefs, Some(&server));
            for line in ["codex", "codex resume id", "codex fork id"] {
                let line = with_servers(line, Some(shell), &[], None, sessions);
                assert!(line.contains(name) && line.contains(crate::instance::mcp_token_env(dev)));
                assert!(!line.contains("sessions-test-secret") && !line.contains("Bearer"));
            }
        }
    }
}

#[test]
fn sessions_are_omitted_when_off_untargeted_wsl_or_the_tile_has_no_token() {
    let server = SessionsServer::running(true, 53812, "test-secret", false).unwrap();
    let default = crate::settings::AiPrefs::default();
    let off = crate::settings::AiPrefs { mcp_sessions_enabled: Some(false), ..default.clone() };
    let claude = crate::settings::AiPrefs { mcp_sessions_agents: Some(vec!["claude".into()]), ..default.clone() };
    let empty = crate::settings::AiPrefs { mcp_sessions_agents: Some(vec![]), ..default.clone() };
    let unknown = crate::settings::AiPrefs { mcp_sessions_agents: Some(vec!["unknown".into()]), ..default.clone() };
    for (prefs, agent, shell, tile) in [
        (&off, "claude", "pwsh", true), (&off, "codex", "pwsh", true),
        (&claude, "codex", "cmd", true), (&empty, "claude", "pwsh", true),
        (&unknown, "codex", "gitbash", true), (&default, "claude", "wsl:Ubuntu", true),
        (&default, "codex", "wsl:Ubuntu", true), (&default, "claude", "pwsh", false),
        (&default, "codex", "cmd", false), (&default, "sh", "gitbash", true),
    ] {
        let sessions = sessions_for(agent, Some(shell), tile, prefs, Some(&server));
        assert!(sessions.is_none());
        assert!(claude_config(&[], sessions).is_none());
        assert!(codex_tokens(&[], sessions).is_empty());
        assert_eq!(with_servers(agent, Some(shell), &[], Some("/tmp/a.json"), sessions), agent);
    }
    assert!(sessions_for("claude", None, true, &default, None).is_none());
    for (running, port, token) in [(false, 53812, "secret"), (true, 0, "secret"), (true, 53812, "")] {
        assert!(SessionsServer::running(running, port, token, false).is_none());
    }
    // 세션 서버만 생략해도 기존 외부 서버는 그대로 실린다.
    let sessions = sessions_for("codex", Some("cmd"), false, &default, Some(&server));
    assert!(with_servers("codex", Some("cmd"), &[http("web")], None, sessions).contains("mcp_servers.web.url"));
}


#[test]
fn http_headers_validate_tokens_reserved_names_duplicates_and_transport() {
    let mut server = http("remote");
    for name in ["Authorization", "X-Api-Key", "X!#$%&'*+-.^_|~", &"a".repeat(128)] {
        server.headers = vec![McpEnv { name: name.into(), secret_ref: "ref".into() }];
        assert!(validate(&server).is_none());
    }
    for name in ["Host", "Content-Length", "Transfer-Encoding", "Connection", "Upgrade",
        "Mcp-Session-Id", "MCP-Protocol-Version", "Accept", "Content-Type", "Last-Event-ID",
        "hOsT", "", "X Bad", "X:Bad", "한글", &"a".repeat(129)] {
        server.headers = vec![McpEnv { name: name.into(), secret_ref: "ref".into() }];
        assert!(validate(&server).is_some());
    }
    server.headers = vec![McpEnv { name: "Authorization".into(), secret_ref: "ref".into() },
        McpEnv { name: "authorization".into(), secret_ref: "other".into() }];
    assert!(validate(&server).is_some());
    server.headers = (0..33).map(|i| McpEnv { name: format!("X-{i}"), secret_ref: "ref".into() }).collect();
    assert!(validate(&server).is_some());
    server.headers.pop();
    assert!(validate(&server).is_none());
    let mut stdio = stdio("local");
    stdio.headers = server.headers;
    assert!(validate(&stdio).is_some());
}

/// 시험 `tile_autorun_has_no_coordination_preallow`(오케스트레이션 탭 2단계 6절 · 9절 단계 6) — 로컬 AI 타일(autorun) · 감싸개 셸 타일(장식 파일 —
/// 같은 `server_tokens`)의 낱말에는 **오케스트레이션 도구의 미리 허용이 없다**(Claude `--allowedTools mcp__<서버>__<조율 도구>` · Codex 도구마다
/// `approval_mode='approve'` 둘 다) — 타일은 조정자 자리가 되지 못한다(목록에도 없다 · 미리 허용은 프로듀서 채팅만 — `server::producer::launch`).
/// 세션 서버 좌표(`--mcp-config` · Codex `-c mcp_servers.<서버>.url` · 토큰 변수 이름)는 그대로이고 `--strict-mcp-config` 는 없다(사용자 MCP 유지) ·
/// 토큰 값은 줄에 없다.
#[test]
fn tile_autorun_has_no_coordination_preallow() {
    let all: Vec<&str> = crate::orchestration::preallowed_tools().collect();
    for t in ["adopt_run", "complete_run", "get_run", "spawn_worker", "send_prompt"] {
        assert!(all.contains(&t), "{t}");
    }
    for dev in [false, true] {
        let name = crate::instance::mcp_name(dev);
        let server = SessionsServer::running(true, 53812, "tile-secret", dev).unwrap();
        for shell in ["pwsh", "cmd", "gitbash"] {
            let claude = with_servers("claude", Some(shell), &[stdio("play")], Some("/tmp/orch-a.json"), Some(&server));
            assert!(claude.contains("--mcp-config"), "{claude}");
            assert!(!claude.contains("--allowedTools") && !claude.contains("--strict-mcp-config"), "{claude}");
            for base in ["codex", "codex resume id"] {
                let codex = with_servers(base, Some(shell), &[], None, Some(&server));
                assert!(codex.contains(&format!("mcp_servers.{name}.url")) && codex.contains(crate::instance::mcp_token_env(dev)), "{codex}");
                assert!(!codex.contains("approval_mode"), "{codex}");
            }
            for t in &all {
                assert!(!claude.contains(&format!("mcp__{name}__{t}")), "{t}: {claude}");
            }
            assert!(!claude.contains("tile-secret") && !claude.contains("Bearer"), "{claude}");
        }
        // 세션 서버가 없으면 아무것도 싣지 않는다 · WSL 도.
        assert_eq!(with_servers("claude", Some("pwsh"), &[], Some("/tmp/a.json"), None), "claude");
        assert_eq!(with_servers("claude", Some("wsl:Ubuntu"), &[], Some("/tmp/a.json"), Some(&server)), "claude");
    }
}

/// 옛 조정자 역할 설정 파일 이름(`orch-run-<32 hex>-g<세대>.json`)은 시작 정리 대상이다 — (3차 6단계) 새로 쓰는 판이 없어 주장은 받지 않는다.
#[test]
fn role_config_names_are_strict() {
    let run = format!("run-{}", "a".repeat(32));
    assert!(is_role_config(&format!("orch-{run}-g1.json")));
    assert!(is_role_config(&format!("orch-{run}-g12.json")));
    for bad in [
        format!("orch-{run}.json"),
        format!("orch-{run}-g.json"),
        format!("orch-{run}-gx.json"),
        "orch-run-xyz-g1.json".to_string(),
        format!("orch-../{run}-g1.json"),
        format!("{run}-g1.json"),
        "123-0123456789abcdef.json".to_string(),
    ] {
        assert!(!is_role_config(&bad), "{bad}");
    }
    let file = format!("orch-{run}-g3.json");
    assert!(!claim("role-claim-test", &file), "옛 역할 파일은 주장하지 않는다(시작 정리만)");
    assert!(!claimed_files().contains(&file));
}

/// 사이드 채팅 칸(2026-10-25) — 옛 설정(칸 없음)은 둘 다 끔으로 읽고, 끔은 파일에 적지 않는다(옛 판과 같은 글자).
#[test]
fn side_chat_fields_default_off_and_round_trip() {
    let old: McpServer = serde_json::from_value(json!({
        "name": "play", "enabled": true, "transport": "stdio", "command": "npx", "args": ["x"]
    }))
    .unwrap();
    assert!(!old.side_chat && !old.side_chat_no_ask);
    let text = serde_json::to_value(&old).unwrap();
    assert!(text.get("side_chat").is_none() && text.get("side_chat_no_ask").is_none(), "끔은 적지 않는다");
    let mut on = old.clone();
    on.side_chat = true;
    on.side_chat_no_ask = true;
    let back: McpServer = serde_json::from_value(serde_json::to_value(&on).unwrap()).unwrap();
    assert_eq!(back, on);
    assert!(format!("{on:?}").contains("side_chat_no_ask: true"));
}

/// 사이드 채팅에 실을 서버 — 켬 + `side_chat` 만 · 대상 칩은 보지 않는다 · 범위는 AI 타일과 같은 판정(프로젝트 항목이 같은 이름의 전역을
/// 가리고, 꺼진 · 사이드 채팅을 고르지 않은 프로젝트 항목도 가린다) · 다른 프로젝트 항목은 없다.
#[test]
fn side_chat_selection_follows_tile_scope_rules() {
    let pick = |name: &str, project: Option<&str>, side: bool| {
        let mut s = stdio(name);
        s.project_id = project.map(str::to_owned);
        s.side_chat = side;
        s
    };
    let mut no_agents = pick("search", None, true);
    no_agents.agents = Some(vec![]);
    let mut off = pick("off", None, true);
    off.enabled = false;
    let all = vec![
        no_agents,
        off,
        pick("tiles-only", None, false),
        pick("db", None, true),
        pick("db", Some("p1"), false),
        pick("docs", Some("p1"), true),
        pick("other", Some("p2"), true),
    ];
    let names = |v: Vec<McpServer>| v.into_iter().map(|s| (s.name, s.project_id)).collect::<Vec<_>>();
    // 채팅 자기 폴더(프로젝트 없음) — 전역만
    assert_eq!(names(side_chat_selected(&all, None)), [("search".into(), None), ("db".into(), None)]);
    // p1 폴더에서 갈라 온 채팅 — p1 의 db(사이드 채팅 끔)가 전역 db 를 가린다 · p1 의 docs 가 선다 · p2 는 없다
    assert_eq!(
        names(side_chat_selected(&all, Some("p1"))),
        [("search".into(), None), ("docs".into(), Some("p1".into()))]
    );
}

/// 실행 모양 공용 조각 — AI 타일의 Claude 파일 · Codex `-c` 와 같은 글자, 준비된 모양(도우미 · 프록시)도 [`launch_ok`] 로 다시 본다.
#[test]
fn launch_shapes_are_shared_and_rechecked() {
    let s = stdio("play");
    assert_eq!(claude_entry(&s), json!({"type": "stdio", "command": "npx", "args": ["a b"]}));
    assert_eq!(codex_overrides(&s), ["mcp_servers.play.command='npx'", "mcp_servers.play.args=['a b']"]);
    assert_eq!(codex_overrides(&http("web")), ["mcp_servers.web.url='https://example.com/mcp'"]);
    assert!(launch_ok(&s) && launch_ok(&http("web")));
    let mut helper = s.clone();
    helper.command = Some("C:/Program Files/AYNX/aynx's.exe".into());
    assert!(!launch_ok(&helper), "작은따옴표가 든 경로는 TOML 리터럴에 못 싣는다");
    helper.command = Some("C:/AYNX/aynx.exe".into());
    helper.args = vec!["mcp-run".into(), "5555".into(), "a".repeat(64)];
    assert!(launch_ok(&helper));
}
