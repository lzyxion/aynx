use super::*;

/// 시험용 브로커 — 볼트는 비어 있는 임시 폴더(값을 읽는 시험은 `serve_with` 에 해석 함수를 넣는다).
fn broker() -> Arc<Broker> {
    let dir = std::env::temp_dir().join(format!("aynx-broker-{}", crate::token::generate_token().unwrap()));
    Broker::start(Arc::new(Vault::new(Some(dir)))).unwrap()
}

fn fixture() -> McpServer {
    serde_json::from_value(serde_json::json!({
        "name": "postgres", "enabled": true, "transport": "stdio", "command": "npx",
        "env": [{"name": "DATABASE_URL", "secret_ref": "global/postgres/DATABASE_URL:reference"}]
    }))
    .unwrap()
}

#[test]
fn launch_capability_resolves_only_an_authorized_ticket() {
    for authorized in [true, false] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "a".repeat(64);
        let tickets = Arc::new(Mutex::new(HashMap::from([(
            token.clone(),
            Ticket {
                server: fixture(),
                cwd: None,
            },
        )])));
        let worker = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve_with(stream, &tickets, |ticket| {
                assert_eq!(ticket.server.name, "postgres");
                Ok(Launch {
                    command: "npx".into(),
                    args: vec!["a b".into()],
                    env: BTreeMap::from([(
                        "DATABASE_URL".into(),
                        "postgres://한글:'p@ss'@localhost/db".into(),
                    )]),
                    cwd: None,
                })
            })
        });
        let result = fetch_launch(port, &if authorized { token } else { "b".repeat(64) });
        if authorized {
            let launch = result.unwrap();
            assert_eq!(
                launch.env["DATABASE_URL"],
                "postgres://한글:'p@ss'@localhost/db"
            );
            assert_eq!(launch.args, ["a b"]);
            assert!(worker.join().unwrap().is_ok());
        } else {
            assert!(result.is_err());
            assert!(worker.join().unwrap().is_err());
        }
    }
    assert!(fetch_launch(0, "short").is_err());
}

#[test]
fn saved_servers_retain_only_matching_launch_tickets() {
    let unchanged = fixture();
    let mut changed = fixture();
    changed.name = "changed".into();
    let mut removed = fixture();
    removed.name = "removed".into();
    let tokens = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    let tickets: Tickets = Arc::new(Mutex::new(HashMap::from([
        (
            tokens[0].clone(),
            Ticket {
                server: unchanged.clone(),
                cwd: Some("C:/work/project".into()),
            },
        ),
        (
            tokens[1].clone(),
            Ticket {
                server: changed.clone(),
                cwd: None,
            },
        ),
        (
            tokens[2].clone(),
            Ticket {
                server: removed,
                cwd: None,
            },
        ),
    ])));
    changed.env[0].secret_ref = "global/changed/DATABASE_URL:new-reference".into();
    retain_tickets_in(&tickets, &[unchanged, changed]);
    {
        let pending = tickets.lock().unwrap();
        assert_eq!(pending.len(), 1);
        assert!(pending.contains_key(&tokens[0]));
        assert!(!pending.contains_key(&tokens[1]));
        assert!(!pending.contains_key(&tokens[2]));
    }

    for (index, token) in tokens.iter().enumerate() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let pending = tickets.clone();
        let worker = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve_with(stream, &pending, |ticket| {
                assert_eq!(index, 0, "회수된 티켓은 값을 읽으면 안 된다");
                Ok(Launch {
                    command: ticket.server.command.clone().unwrap(),
                    args: ticket.server.args.clone(),
                    env: BTreeMap::new(),
                    cwd: ticket.cwd.clone(),
                })
            })
        });
        assert_eq!(fetch_launch(port, token).is_ok(), index == 0);
        assert_eq!(worker.join().unwrap().is_ok(), index == 0);
    }
}

#[test]
fn prepared_agent_config_contains_no_environment_metadata() {
    let b = broker();
    let original = fixture();
    let prepared = b.prepare(&original, Some("C:/work/project")).unwrap();
    assert!(prepared.env.is_empty());
    assert!(b.active_secret_refs().unwrap().contains(&original.env[0].secret_ref));
    assert_eq!(prepared.args[0], "mcp-run");
    assert_eq!(prepared.args[1], b.port().to_string(), "도우미는 인자로 브로커 포트를 안다");
    assert_eq!(prepared.args[2].len(), 64);
    assert!(!serde_json::to_string(&prepared)
        .unwrap()
        .contains("DATABASE_URL"));
    let mut no_env = original;
    no_env.env.clear();
    assert_eq!(b.prepare(&no_env, None).unwrap(), no_env);
}

#[test]
fn environment_values_are_delivered_only_to_the_target_child() {
    let launch = Launch {
        command: std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        args: vec![
            "mcp_launch::tests::environment_probe".into(),
            "--exact".into(),
        ],
        env: BTreeMap::from([
            ("AYNX_TEST_MCP_PROBE".into(), "yes".into()),
            (
                "AYNX_TEST_MCP_VALUE".into(),
                "postgres://한글:'p@ss'@localhost/db?x=$()&y=\"ok\"".into(),
            ),
            ("AYNX_TEST_MCP_EMPTY".into(), "".into()),
        ]),
        cwd: Some(std::env::temp_dir().to_string_lossy().into_owned()),
    };
    let output = child_command(&launch).output().unwrap();
    assert!(output.status.success(), "child environment probe failed");
    assert!(std::env::var_os("AYNX_TEST_MCP_PROBE").is_none());
}

#[test]
fn environment_probe() {
    if std::env::var("AYNX_TEST_MCP_PROBE").as_deref() != Ok("yes") {
        return;
    }
    assert_eq!(
        std::env::var("AYNX_TEST_MCP_VALUE").unwrap(),
        "postgres://한글:'p@ss'@localhost/db?x=$()&y=\"ok\""
    );
    assert_eq!(std::env::var("AYNX_TEST_MCP_EMPTY").unwrap(), "");
    assert_eq!(std::env::current_dir().unwrap(), std::env::temp_dir());
}

#[cfg(windows)]
#[test]
fn relative_executable_uses_the_launch_directory() {
    let dir = std::env::temp_dir().join(format!(
        "aynx-mcp-cwd-{}",
        crate::token::generate_token().unwrap()
    ));
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let path = bin.join("server.cmd");
    std::fs::write(&path, b"@exit /b 0\r\n").unwrap();
    let cwd = dir.to_str().unwrap();
    assert_eq!(executable(r"bin\server.cmd", Some(cwd)), path);
    // 없는 상대 경로도 도우미 폴더로 돌아가지 않는다.
    assert_eq!(
        executable("bin/missing.exe", Some(cwd)),
        bin.join("missing.exe")
    );
    assert_eq!(executable("cmd", Some(cwd)), executable("cmd", None));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn prepared_http_header_server_uses_a_reusable_proxy_ticket_without_metadata() {
    let original: McpServer = serde_json::from_value(serde_json::json!({
        "name": "remote", "enabled": true, "transport": "http", "url": "https://example.com/mcp",
        "headers": [{"name": "Authorization", "secret_ref": "global/remote/header:Authorization:ref"}]
    })).unwrap();
    let b = broker();
    let prepared = b.prepare(&original, None).unwrap();
    assert!(prepared.headers.is_empty());
    assert!(prepared.env.is_empty());
    let url = reqwest::Url::parse(prepared.url.as_ref().unwrap()).unwrap();
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    let token = url.path().strip_prefix("/mcp-proxy/").unwrap();
    assert_eq!(token.len(), 64);
    assert!(token.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_eq!(b.prepare(&original, None).unwrap(), prepared);
    assert_eq!(url.port(), b.proxy_port(), "헤더 프록시는 자기 포트");
    assert!(!format!("{prepared:?}").contains(token));
    assert!(!serde_json::to_string(&prepared).unwrap().contains("Authorization"));
    assert!(b.active_secret_refs().unwrap().contains(&original.headers[0].secret_ref));
    let mut direct = original.clone();
    direct.headers.clear();
    assert_eq!(b.prepare(&direct, None).unwrap(), direct);
    let tickets: Tickets = Arc::new(Mutex::new(HashMap::from([(
        token.into(), Ticket { server: original.clone(), cwd: None },
    )])));
    let mut changed = original;
    changed.headers[0].secret_ref = "replacement".into();
    retain_tickets_in(&tickets, &[changed]);
    assert!(tickets.lock().unwrap().is_empty());
}

#[test]
fn vault_lock_revokes_http_tickets_while_preserving_stdio_tickets() {
    let mut http = fixture();
    http.transport = "http".into();
    http.command = None;
    http.env.clear();
    http.url = Some("https://example.com/mcp".into());
    let tickets: Tickets = Arc::new(Mutex::new(HashMap::from([
        ("a".repeat(64), Ticket { server: fixture(), cwd: None }),
        ("b".repeat(64), Ticket { server: http, cwd: None }),
    ])));
    assert_eq!(revoke_http_tickets_in(&tickets), 1);
    let pending = tickets.lock().unwrap();
    assert_eq!(pending.len(), 1);
    assert!(pending.contains_key(&"a".repeat(64)));
}
