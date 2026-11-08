use super::*;

fn claude() -> &'static HookTarget {
    target("claude").unwrap()
}

fn codex() -> &'static HookTarget {
    target("codex").unwrap()
}

/// 이 테스트 전용 임시 폴더 — **진짜 `~/.claude`·`~/.codex` 는 절대 밟지 않는다**.
fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-hooks-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn read(p: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn script_at(dir: &Path) -> PathBuf {
    dir.join(script_file().0)
}

fn ev<'a>(t: &'a HookTarget, hook: &str) -> &'a HookEvent {
    t.events.iter().find(|e| e.hook == hook).unwrap()
}

// ---- 표 ----

#[test]
fn every_target_maps_to_valid_signal_events_and_details() {
    let mut ids = std::collections::HashSet::new();
    for t in TARGETS {
        assert!(ids.insert(t.id), "id 는 겹치지 않는다: {}", t.id);
        assert!(target(t.id).is_ok());
        let mut hooks = std::collections::HashSet::new();
        for e in t.events {
            assert!(hooks.insert(e.hook), "{} 의 {} 가 두 번", t.id, e.hook);
            // 엔드포인트가 받는 그 판정으로 본다 — 이벤트 이름·범주가 버려지지 않는다.
            let body = match e.detail {
                Some(d) => json!({"stream": "s", "event": e.event, "detail": d}),
                None => json!({"stream": "s", "event": e.event}),
            };
            let sig = crate::agent_signal::parse(&body.to_string())
                .unwrap_or_else(|why| panic!("{} {}: {why}", t.id, e.hook));
            assert_eq!(sig.event.as_str(), e.event);
            if let Some(d) = e.detail {
                assert!(
                    crate::agent_signal::WAITING_DETAILS.contains(&d),
                    "{} {}",
                    t.id,
                    d
                );
                assert_eq!(sig.detail.as_deref(), Some(d), "범주는 waiting 에만 실린다");
            }
        }
    }
    assert!(target("gemini").is_err(), "모르는 id 는 실패");
}

/// 표의 줄은 모두 쓸 수 있다(Codex 도 `--no-daemon` 으로 다시 켰다) — 목록에 서고 명령이 받는다. 숨김 장치
/// (`available`)는 남는다: 새 에이전트가 신호를 믿을 수 없으면 그 한 칸으로 다시 숨긴다.
#[test]
fn codex_is_listed_and_commands_accept_it() {
    assert!(codex().available && claude().available);
    let listed: Vec<&str> = tauri::async_runtime::block_on(agent_hooks_targets())
        .iter()
        .map(|i| i.id)
        .collect();
    assert_eq!(listed, ["claude", "codex"]);
    assert!(usable_target("codex").is_ok());
    assert!(usable_target("claude").is_ok());
    assert!(usable_target("gemini").is_err());
    // 명령 여섯은 모두 첫 줄에서 `usable_target` 을 지난다 — 진짜 `~/.codex` 에 닿을 수 있어 여기서
    // 명령 자체를 부르지 않고, 원본 글자로 본다.
    let src = include_str!("../agent_hooks.rs");
    assert_eq!(
        src.matches(concat!("let t = usable", "_target(&agent)?;"))
            .count(),
        6
    );
}

#[test]
fn codex_registers_permission_request_as_waiting_permission() {
    let e = ev(codex(), "PermissionRequest");
    assert_eq!((e.event, e.detail), ("waiting", Some("permission")));
    assert_eq!(
        hook_command("/x/aynx-agent-signal.sh", "codex", e),
        r#""/x/aynx-agent-signal.sh" waiting codex permission"#
    );
    // 확인하지 않은 이벤트 이름을 싣지 않는다 — 서브 에이전트 둘은 Codex hooks 문서 + 0.160.0 실행 파일의
    // 이벤트 이름 표로 확인했다(실행 확인은 사용자 실기 — docs/log/2026-10-04-subagent-signals.md)
    let hooks: Vec<&str> = codex().events.iter().map(|e| e.hook).collect();
    assert_eq!(
        hooks,
        [
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PermissionRequest",
            "Stop",
            "SubagentStart",
            "SubagentStop",
            "SessionEnd"
        ]
    );
    assert!(codex().events.iter().all(|e| e.matcher.is_none()));
}

#[test]
fn hook_command_is_a_quoted_forward_slash_path_and_the_event() {
    let cmd = hook_command(
        &command_path(Path::new(
            r"C:\Users\me\AppData\Roaming\aynx\hooks\aynx-agent-signal.cmd",
        )),
        "claude",
        ev(claude(), "Notification"),
    );
    assert_eq!(
        cmd,
        r#""C:/Users/me/AppData/Roaming/aynx/hooks/aynx-agent-signal.cmd" waiting claude"#
    );
    assert!(is_ours(&json!({ "command": cmd })));
    assert!(is_ours(&json!({ "command": "x", "commandWindows": cmd })));
    assert!(!is_ours(&json!({ "command": "echo hi" })));
}

/// Codex 는 Windows 명령을 셸로 돌리지 않는다 — 첫 토막이 맨 `cmd.exe`, 경로는 뒤 토막에서 역슬래시로
/// 인용(공백이 있어도 된다). 첫 토막이 따옴표면 실패한다(2026-09-26 실측).
#[test]
fn codex_windows_handler_starts_with_bare_cmd_exe_and_quotes_a_backslash_path() {
    let script = "C:/Users/me/App Data/aynx/hooks/aynx-agent-signal.cmd";
    let h = codex_handler(script, ev(codex(), "PermissionRequest"), true);
    let want =
        r#"cmd.exe /d /c "C:\Users\me\App Data\aynx\hooks\aynx-agent-signal.cmd" waiting codex permission"#;
    assert_eq!(h["commandWindows"], want);
    assert_eq!(h["command"], want);
    let stop = codex_handler(script, ev(codex(), "Stop"), true);
    assert_eq!(
        stop["commandWindows"],
        r#"cmd.exe /d /c "C:\Users\me\App Data\aynx\hooks\aynx-agent-signal.cmd" stop codex"#
    );
    assert!(
        !stop["commandWindows"].as_str().unwrap().starts_with('"'),
        "첫 토막은 따옴표가 아니다"
    );
    assert!(is_ours(&h));
    // Claude 는 그대로 — 셸로 돌므로 인용한 경로가 첫 토막이어도 된다(실기 확인).
    let c = claude_handler(script, ev(claude(), "Stop"), true);
    assert_eq!(c["command"], format!("\"{script}\" stop claude"));
}

/// 옛(따옴표로 시작하는) Codex 항목은 "일부만" 으로 읽혀 다시 설치를 부르고, 다시 설치하면 새 모양 한 벌이다.
#[test]
fn an_old_quoted_codex_entry_reads_partial_and_reinstall_replaces_it() {
    let t = codex();
    let script = "C:/a/aynx-agent-signal.cmd";
    let mut root = json!({});
    install_into(t, &mut root, script);
    for (hook, groups) in root["hooks"].as_object_mut().unwrap() {
        let h = &mut groups[0]["hooks"][0];
        let old = format!(
            "\"{script}\" {}",
            if hook == "PermissionRequest" {
                "waiting permission"
            } else {
                "x"
            }
        );
        h["command"] = json!(old);
        h["commandWindows"] = json!(old);
    }
    assert_eq!(installed_in(t, &root, script), Installed::Partial);
    install_into(t, &mut root, script);
    assert_eq!(installed_in(t, &root, script), Installed::Full);
    assert_eq!(
        root["hooks"]["Stop"].as_array().unwrap().len(),
        1,
        "옛 항목은 남지 않는다"
    );
}

#[test]
fn codex_handler_carries_command_windows_only_for_the_cmd_script() {
    let win = our_groups(codex(), "C:/a/aynx-agent-signal.cmd");
    for (_, g) in &win {
        let h = &g["hooks"][0];
        assert_eq!(h["commandWindows"], h["command"]);
        assert!(h["commandWindows"]
            .as_str()
            .unwrap()
            .starts_with("cmd.exe /d /c \"C:\\a\\"));
        assert_eq!(h["timeout"], HOOK_TIMEOUT_SECS);
        assert_eq!(h["type"], "command");
        assert!(g.get("matcher").is_none());
    }
    for (_, g) in our_groups(codex(), REMOTE_SCRIPT_CMD) {
        assert!(
            g["hooks"][0].get("commandWindows").is_none(),
            "원격(.sh)은 command 만"
        );
    }
    for (_, g) in our_groups(claude(), "C:/a/aynx-agent-signal.cmd") {
        assert!(
            g["hooks"][0].get("commandWindows").is_none(),
            "Claude 는 모양이 그대로"
        );
    }
}

/// 이 빌드의 로컬 설치 — Windows 빌드에서는 Codex 처리기에 `commandWindows` 가 선다.
#[test]
fn local_codex_install_on_this_os() {
    let dir = temp_dir("codex-os");
    let settings = dir.join("hooks.json");
    install_at(codex(), &settings, &dir.join("hooks")).unwrap();
    let v = read(&settings);
    let h = &v["hooks"]["Stop"][0]["hooks"][0];
    #[cfg(windows)]
    assert_eq!(h["commandWindows"], h["command"]);
    #[cfg(not(windows))]
    assert!(h.get("commandWindows").is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- 표를 도는 공용 시험: 모든 에이전트가 같은 약속을 지킨다 ----

#[test]
fn install_into_an_empty_file_writes_one_group_per_event_with_the_schema_shape() {
    for t in TARGETS {
        let dir = temp_dir(&format!("fresh-{}", t.id));
        let settings = dir.join(".agent").join("hooks.json");
        install_at(t, &settings, &dir.join("hooks")).unwrap();
        let v = read(&settings);
        let script = script_at(&dir.join("hooks"));
        assert!(script.exists(), "스크립트도 쓴다");
        let cmd = command_path(&script);
        for e in t.events {
            let groups = v["hooks"][e.hook].as_array().unwrap();
            assert_eq!(groups.len(), 1, "{} {}", t.id, e.hook);
            match e.matcher {
                Some(m) => assert_eq!(groups[0]["matcher"], m),
                None => assert!(
                    groups[0].get("matcher").is_none(),
                    "{} 에는 매처가 없다",
                    e.hook
                ),
            }
            let h = &groups[0]["hooks"][0];
            assert_eq!(h["type"], "command");
            assert_eq!(h["command"], (t.handler)(&cmd, e, is_cmd(&cmd))["command"]);
            assert_eq!(h["timeout"], HOOK_TIMEOUT_SECS);
        }
        let st = status_at(t, &settings, &dir.join("hooks"));
        assert!(
            st.installed && !st.partial && st.error.is_none(),
            "{}",
            t.id
        );
        assert!(
            std::fs::read_to_string(&settings)
                .unwrap()
                .contains("\n  \"hooks\""),
            "2칸 pretty"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn install_into_codex_default_file_fills_the_empty_hooks_object() {
    let dir = temp_dir("codex-empty-hooks");
    let settings = dir.join("hooks.json");
    std::fs::write(&settings, r#"{"hooks": {}}"#).unwrap(); // 사용자의 지금 파일
    install_at(codex(), &settings, &dir.join("hooks")).unwrap();
    let v = read(&settings);
    let keys: Vec<&String> = v["hooks"].as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PermissionRequest",
            "Stop",
            "SubagentStart",
            "SubagentStop",
            "SessionEnd"
        ]
    );
    remove_at(codex(), &settings, &dir.join("hooks"), &[]).unwrap();
    assert_eq!(
        read(&settings),
        json!({}),
        "우리가 채운 것만 비우고 — hooks 는 우리가 비웠으니 지운다"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn install_is_idempotent_and_keeps_other_keys_and_hooks() {
    for t in TARGETS {
        let dir = temp_dir(&format!("merge-{}", t.id));
        let settings = dir.join("settings.json");
        std::fs::write(
            &settings,
            r#"{
  "model": "opus",
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ],
    "PostToolUse": [ { "matcher": "Edit", "hooks": [ { "type": "command", "command": "fmt" } ] } ]
  },
  "permissions": { "allow": ["Bash(ls:*)"] }
}"#,
        )
        .unwrap();
        let hooks_dir = dir.join("hooks");
        install_at(t, &settings, &hooks_dir).unwrap();
        install_at(t, &settings, &hooks_dir).unwrap(); // 두 번 눌러도 한 벌
        let v = read(&settings);
        assert_eq!(v["model"], "opus");
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls:*)");
        assert_eq!(v["hooks"]["PostToolUse"][0]["hooks"][0]["command"], "fmt");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "사용자 묶음 + 우리 묶음 하나");
        assert_eq!(stop[0]["hooks"][0]["command"], "say done");
        for e in t.events {
            let ours = v["hooks"][e.hook]
                .as_array()
                .unwrap()
                .iter()
                .filter(|g| is_ours(&g["hooks"][0]))
                .count();
            assert_eq!(ours, 1, "{} {} 에 우리 것은 하나", t.id, e.hook);
        }
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys[0], "model", "키 순서 보존");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// 같은 설치를 다시 누르면 파일을 **쓰지 않는다** — 글자가 달라도(모양만 다른 같은 값) 그대로 남는다.
#[test]
fn reinstall_with_nothing_to_change_does_not_write() {
    for t in TARGETS {
        let dir = temp_dir(&format!("nowrite-{}", t.id));
        let settings = dir.join("hooks.json");
        let hooks_dir = dir.join("hooks");
        install_at(t, &settings, &hooks_dir).unwrap();
        // 같은 값을 한 줄(compact)로 다시 적어 둔다 — 다시 쓰면 pretty 로 돌아온다.
        let compact = read(&settings).to_string();
        std::fs::write(&settings, &compact).unwrap();
        install_at(t, &settings, &hooks_dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(&settings).unwrap(),
            compact,
            "{}: 쓰지 않았다",
            t.id
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn remove_takes_only_ours_and_drops_only_what_it_emptied() {
    for t in TARGETS {
        let dir = temp_dir(&format!("remove-{}", t.id));
        let settings = dir.join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"say done"}]}],"PreCompact":[]},"theme":"dark"}"#,
        )
        .unwrap();
        let hooks_dir = dir.join("hooks");
        install_at(t, &settings, &hooks_dir).unwrap();
        remove_at(t, &settings, &hooks_dir, &[]).unwrap();
        let v = read(&settings);
        assert_eq!(v["theme"], "dark");
        assert_eq!(
            v["hooks"]["Stop"].as_array().unwrap().len(),
            1,
            "사용자 Stop 은 남는다"
        );
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        assert!(
            v["hooks"]["PreCompact"].as_array().unwrap().is_empty(),
            "원래 빈 배열은 그대로"
        );
        for e in t.events.iter().filter(|e| e.hook != "Stop") {
            assert!(
                v["hooks"].get(e.hook).is_none(),
                "{}: 우리가 비운 {} 은 지운다",
                t.id,
                e.hook
            );
        }
        assert!(!script_at(&hooks_dir).exists(), "스크립트도 지운다");
        let st = status_at(t, &settings, &hooks_dir);
        assert!(!st.installed && !st.partial);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// 두 에이전트가 스크립트를 함께 쓴다 — 하나를 제거해도 다른 쪽이 남아 있으면 스크립트는 남는다.
#[test]
fn removing_one_agent_keeps_the_shared_script_while_another_uses_it() {
    let dir = temp_dir("shared");
    let hooks_dir = dir.join("hooks");
    let cl = dir.join("claude.json");
    let cx = dir.join("codex.json");
    install_at(claude(), &cl, &hooks_dir).unwrap();
    install_at(codex(), &cx, &hooks_dir).unwrap();
    remove_at(codex(), &cx, &hooks_dir, std::slice::from_ref(&cl)).unwrap();
    assert!(script_at(&hooks_dir).exists(), "Claude 가 아직 쓴다");
    assert!(status_at(claude(), &cl, &hooks_dir).installed);
    remove_at(claude(), &cl, &hooks_dir, std::slice::from_ref(&cx)).unwrap();
    assert!(!script_at(&hooks_dir).exists(), "아무도 안 쓰면 지운다");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn remove_on_our_only_hooks_drops_the_hooks_key() {
    for t in TARGETS {
        let dir = temp_dir(&format!("only-{}", t.id));
        let settings = dir.join("settings.json");
        let hooks_dir = dir.join("hooks");
        install_at(t, &settings, &hooks_dir).unwrap();
        remove_at(t, &settings, &hooks_dir, &[]).unwrap();
        assert_eq!(read(&settings), json!({}));
        let none = dir.join("nope.json");
        remove_at(t, &none, &hooks_dir, &[]).unwrap();
        assert!(
            !none.exists(),
            "없는 파일에서의 제거는 파일을 만들지 않는다"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn broken_settings_are_left_untouched_and_reported() {
    for t in TARGETS {
        let dir = temp_dir(&format!("broken-{}", t.id));
        let settings = dir.join("settings.json");
        std::fs::write(&settings, "{ not json").unwrap();
        let hooks_dir = dir.join("hooks");
        assert!(install_at(t, &settings, &hooks_dir).is_err());
        assert_eq!(
            std::fs::read_to_string(&settings).unwrap(),
            "{ not json",
            "덮어쓰지 않는다"
        );
        assert!(
            !script_at(&hooks_dir).exists(),
            "반쯤 된 설치를 남기지 않는다"
        );
        let err = status_at(t, &settings, &hooks_dir).error.unwrap();
        assert!(err.contains(t.display), "{err}");
        std::fs::write(&settings, "[1]").unwrap();
        assert!(
            install_at(t, &settings, &hooks_dir).is_err(),
            "객체가 아니면 실패"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn a_moved_script_path_reads_as_partial_and_reinstall_replaces_it() {
    for t in TARGETS {
        let dir = temp_dir(&format!("moved-{}", t.id));
        let settings = dir.join("settings.json");
        install_at(t, &settings, &dir.join("old")).unwrap();
        let new_dir = dir.join("new");
        assert!(status_at(t, &settings, &new_dir).partial, "옛 경로 = 일부");
        install_at(t, &settings, &new_dir).unwrap();
        let st = status_at(t, &settings, &new_dir);
        assert!(st.installed && !st.partial);
        assert!(
            !std::fs::read_to_string(&settings)
                .unwrap()
                .contains("/old/"),
            "옛 경로 항목은 남지 않는다"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn preview_lists_exactly_the_target_hooks() {
    for t in TARGETS {
        let p: Value = serde_json::from_str(&preview(t, "/x/aynx-agent-signal.sh")).unwrap();
        let keys: Vec<&String> = p["hooks"].as_object().unwrap().keys().collect();
        let want: Vec<&str> = t.events.iter().map(|e| e.hook).collect();
        assert_eq!(keys, want);
        assert_eq!(
            p["hooks"]["Stop"][0]["hooks"][0]["command"],
            format!(r#""/x/aynx-agent-signal.sh" stop {}"#, t.id)
        );
    }
    let p: Value = serde_json::from_str(&preview(claude(), "/x/aynx-agent-signal.sh")).unwrap();
    let post = &p["hooks"]["PostToolUse"][0];
    assert_eq!(post["matcher"], "*");
    assert_eq!(
        post["hooks"][0]["command"],
        r#""/x/aynx-agent-signal.sh" tool-done claude"#
    );
}

/// 네 벌(다섯째 전)로 설치한 사용자 — "일부만" 으로 읽히고, 다시 설치하면 다섯째가 붙어 한 벌이 되며,
/// 제거는 다섯을 다 뺀다.
#[test]
fn a_four_hook_install_reads_partial_and_reinstall_adds_the_fifth() {
    let t = claude();
    let script = "/x/aynx-agent-signal.sh";
    let mut root = json!({});
    install_into(t, &mut root, script);
    root["hooks"]
        .as_object_mut()
        .unwrap()
        .shift_remove("PostToolUse");
    assert_eq!(installed_in(t, &root, script), Installed::Partial);
    install_into(t, &mut root, script);
    assert_eq!(installed_in(t, &root, script), Installed::Full);
    assert_eq!(root["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
    install_into(t, &mut root, script); // 멱등
    assert_eq!(root["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
    assert!(remove_from(&mut root));
    assert_eq!(
        root,
        json!({}),
        "다섯 다 빠지고 우리가 비운 hooks 째 지운다"
    );
}

// ---- 스크립트 ----

#[test]
fn scripts_exit_quietly_without_env_and_never_put_the_token_in_argv() {
    for s in [CMD_SCRIPT, SH_SCRIPT] {
        assert!(s.is_ascii(), "스크립트는 ASCII 만");
        assert!(
            s.contains("AYNX_MCP_URL") && s.contains("AYNX_STREAM") && s.contains("/agent-signal")
        );
        assert!(s.contains("-K -"), "토큰은 설정 표준 입력으로");
        assert!(
            !s.contains("-H \"Authorization"),
            "토큰을 argv 에 싣지 않는다"
        );
        let sig = s.find("AYNX_SIGNAL_TOKEN").expect("신호 토큰을 본다");
        let mcp = s.find("AYNX_MCP_TOKEN").expect("MCP 토큰으로 물러난다");
        assert!(sig < mcp, "신호 토큰을 먼저 본다");
        assert!(s.contains("tool-done"), "사용법 줄에 다섯째 이벤트");
    }
    assert!(
        SH_SCRIPT.contains("command -v curl"),
        "curl 이 없으면 조용히 0"
    );
    let (name, body) = script_file();
    assert!(name.starts_with(SCRIPT_STEM));
    #[cfg(windows)]
    assert!(body.contains("\r\n") && name.ends_with(".cmd") && is_cmd(&name));
    #[cfg(not(windows))]
    assert!(!body.contains('\r') && name.ends_with(".sh") && !is_cmd(&name));
}

#[test]
fn scripts_carry_the_version_marker_and_send_only_a_waiting_category() {
    assert_eq!(SCRIPT_VERSION, 13);
    let marker = format!("aynx-hook-version: {SCRIPT_VERSION}");
    // 5판 — 보내는 본문이 판 번호를 싣는다(원격의 옛 사본을 알아보는 재료). 표식 줄과 같은 수다.
    let field = format!(r#"\"v\":{SCRIPT_VERSION}"#);
    for s in [CMD_SCRIPT, SH_SCRIPT] {
        assert!(s.contains(&marker), "판 표식 줄: {marker}");
        let send = s
            .lines()
            .find(|l| l.contains("--data") || l.starts_with("body="))
            .unwrap();
        let send = if send.starts_with("body=") {
            send
        } else {
            send.split("--data").nth(1).unwrap()
        };
        assert!(send.contains(&field), "본문에 판 번호 {field}: {send}");
        assert_eq!(s.matches(r#"\"v\":"#).count(), 1, "판 번호 칸은 한 곳");
        for needle in [
            "notification_type",
            "permission_prompt",
            "idle_prompt",
            "needs your permission",
            "waiting for your input",
        ] {
            assert!(s.contains(needle), "범주 판정 재료: {needle}");
        }
        for cat in crate::agent_signal::WAITING_DETAILS {
            assert!(
                s.contains(&format!("DET={cat}")) || s.contains(&format!("det={cat}")),
                "범주 {cat}"
            );
        }
        assert!(s.contains(r#"\"detail\":\""#), "detail 칸");
        for line in s
            .lines()
            .filter(|l| l.contains("--data") || l.contains("body="))
        {
            assert!(
                !line.contains("AYNX_IN") && !line.contains("$in"),
                "입력 글자를 싣지 않는다: {line}"
            );
        }
    }
    assert_eq!(CMD_SCRIPT.matches("aynx-hook-version:").count(), 1);
    assert_eq!(SH_SCRIPT.matches("aynx-hook-version:").count(), 1);
    assert!(CMD_SCRIPT.contains("EnableDelayedExpansion"));
    assert!(!CMD_SCRIPT.contains("%AYNX_IN"), "입력은 !AYNX_IN! 으로만");
}

/// 3판 — 둘째 인자가 범주이고, 표준 입력 판정은 **인자가 없을 때만** 돈다(입력을 읽기 전에 인자를 본다).
#[test]
fn scripts_take_the_second_argument_as_the_detail_before_reading_stdin() {
    let arg = CMD_SCRIPT
        .find(r#"set "AYNX_DET=%~2""#)
        .expect("cmd: 둘째 인자");
    let skip = CMD_SCRIPT
        .find("if defined AYNX_DET goto send\n")
        .expect("cmd: 인자가 있으면 곧장 보낸다");
    let stdin = CMD_SCRIPT.find("findstr").unwrap();
    assert!(arg < skip && skip < stdin);
    let arg = SH_SCRIPT.find("det=$2").expect("sh: 둘째 인자");
    let guard = SH_SCRIPT
        .find(r#"if [ -z "$det" ] && [ "$1" = waiting ]"#)
        .expect("sh: 인자가 없을 때만 입력");
    // 4판부터 `start`·`stop` 갈래도 입력을 읽는다 — 여기서 보는 것은 **범주 판정의** 읽기다.
    let stdin = guard + SH_SCRIPT[guard..].find("in=$(cat").unwrap();
    assert!(arg < guard && guard < stdin);
}

/// 4판 — `start`·`stop` 만 입력에서 **대화 id 하나**를 떼어 싣는다. 프롬프트 글자(`$in`·`AYNX_IN`)는
/// 보내는 줄에 없고, 싣는 값은 16진수·`-` 36자를 지난 것뿐이다.
#[test]
fn scripts_send_only_a_checked_session_id_for_start_and_stop() {
    // cmd: 갈래 진입은 start/stop 뿐, 첫 줄만(set /p), 글자 검사 뒤에만 % 확장으로 나간다.
    assert!(CMD_SCRIPT.contains(r#"if /i "%~1"=="start" goto session"#));
    assert!(CMD_SCRIPT.contains(r#"if /i "%~1"=="stop" goto session"#));
    let sess = CMD_SCRIPT.find("\n:session").unwrap();
    let setp = CMD_SCRIPT.find("set /p AYNX_IN=").unwrap();
    let chk = CMD_SCRIPT
        .find("for %%C in (0 1 2 3 4 5 6 7 8 9 a b c d e f -)")
        .unwrap();
    let out = CMD_SCRIPT
        .find(r#"endlocal & set "AYNX_SID=%AYNX_SID%""#)
        .unwrap();
    assert!(
        sess < setp && setp < chk && chk < out,
        "읽기 → 글자 검사 → 밖으로"
    );
    assert!(CMD_SCRIPT.contains(r#"!AYNX_IN:*"session_id"=!"#));
    assert!(CMD_SCRIPT.contains("!AYNX_T:~2,36!"));
    // sh: 같은 규칙.
    assert!(SH_SCRIPT.contains("start|stop|session-end|session)"));
    assert!(SH_SCRIPT.contains(r#"rest=${in#*\"session_id\"}"#));
    assert!(SH_SCRIPT.contains("*[!0-9a-fA-F-]*|'') sid= ;;"));
    assert!(SH_SCRIPT.contains("[ ${#sid} -eq 36 ] || sid="));
    for s in [CMD_SCRIPT, SH_SCRIPT] {
        assert!(s.contains(r#"\"session\":\""#), "session 칸");
        for line in s
            .lines()
            .filter(|l| l.contains("--data") || l.contains("extra=") || l.contains("AYNX_X="))
        {
            assert!(
                !line.contains("AYNX_IN")
                    && !line.contains("$in")
                    && !line.contains("AYNX_T!")
                    && !line.contains("rest"),
                "입력 글자를 싣지 않는다: {line}"
            );
        }
    }
}

/// 6판 — `subagent-start`·`subagent-stop` 만 입력에서 **서브 에이전트 id 하나**를 떼어 싣는다. 작업 설명
/// (`task`)·마지막 메시지는 보내는 줄에 없고, 싣는 값은 영숫자·`_`·`-` 64자 이하를 지난 것뿐이다.
#[test]
fn scripts_send_only_a_checked_agent_id_for_subagent_events() {
    assert!(CMD_SCRIPT.contains(r#"if /i "%~1"=="subagent-start" goto agent"#));
    assert!(CMD_SCRIPT.contains(r#"if /i "%~1"=="subagent-stop" goto agent"#));
    let agent = CMD_SCRIPT.find("\n:agent").unwrap();
    let setp = agent + CMD_SCRIPT[agent..].find("set /p AYNX_IN=").unwrap();
    let chk = CMD_SCRIPT
        .find("for %%C in (0 1 2 3 4 5 6 7 8 9 a b c d e f g h i j k l m n o p q r s t u v w x y z _ -)")
        .unwrap();
    let out = CMD_SCRIPT
        .find(r#"endlocal & set "AYNX_AID=%AYNX_AID%""#)
        .unwrap();
    assert!(
        agent < setp && setp < chk && chk < out,
        "읽기 → 글자 검사 → 밖으로"
    );
    assert!(CMD_SCRIPT.contains(r#"!AYNX_IN:*"agent_id"=!"#));
    assert!(
        CMD_SCRIPT.contains(r#"if not "!AYNX_AID:~64,1!"=="" goto noaid"#),
        "64자 상한"
    );
    assert!(SH_SCRIPT.contains("subagent-start|subagent-stop)"));
    assert!(SH_SCRIPT.contains(r#"rest=${in#*\"agent_id\"}"#));
    assert!(SH_SCRIPT.contains("*[!0-9A-Za-z_-]*|'') aid= ;;"));
    assert!(SH_SCRIPT.contains("[ ${#aid} -le 64 ] || aid="));
    assert_eq!(
        crate::agent_signal::AGENT_ID_MAX_CHARS,
        64,
        "스크립트의 64 와 엔드포인트의 상한이 같다"
    );
    for s in [CMD_SCRIPT, SH_SCRIPT] {
        assert!(s.contains(r#"\"agent\":\""#), "agent 칸");
        assert!(s.contains("subagent-start / subagent-stop"), "사용법 줄");
        assert!(!s.contains("task"), "작업 설명 칸 이름조차 보지 않는다");
        for line in s
            .lines()
            .filter(|l| l.contains("--data") || l.contains("extra=") || l.contains("AYNX_X="))
        {
            assert!(
                !line.contains("AYNX_IN")
                    && !line.contains("$in")
                    && !line.contains("AYNX_T!")
                    && !line.contains("rest"),
                "입력 글자를 싣지 않는다: {line}"
            );
        }
    }
}

/// 다섯 벌(서브 에이전트 둘 전)로 설치한 사용자 — "일부만" 으로 읽히고, 다시 설치하면 둘이 붙는다(두 에이전트 모두).
#[test]
fn a_five_hook_install_reads_partial_and_reinstall_adds_the_subagent_pair() {
    for t in TARGETS {
        let script = "/x/aynx-agent-signal.sh";
        let mut root = json!({});
        install_into(t, &mut root, script);
        let hooks = root["hooks"].as_object_mut().unwrap();
        hooks.shift_remove("SubagentStart");
        hooks.shift_remove("SubagentStop");
        assert_eq!(
            installed_in(t, &root, script),
            Installed::Partial,
            "{}",
            t.id
        );
        install_into(t, &mut root, script);
        assert_eq!(installed_in(t, &root, script), Installed::Full, "{}", t.id);
        for hook in ["SubagentStart", "SubagentStop"] {
            let g = &root["hooks"][hook];
            assert_eq!(g.as_array().unwrap().len(), 1, "{} {hook}", t.id);
            assert!(
                g[0].get("matcher").is_none(),
                "{} {hook} 매처 없음 = 모든 종류",
                t.id
            );
        }
        assert_eq!(
            root["hooks"]["SubagentStop"][0]["hooks"][0]["command"],
            format!(r#""/x/aynx-agent-signal.sh" subagent-stop {}"#, t.id)
        );
    }
}

#[test]
fn startup_refresh_rewrites_only_an_installed_older_script() {
    let dir = temp_dir("refresh");
    assert_eq!(refresh_at(&dir), Ok(false));
    assert!(
        !script_at(&dir).exists(),
        "없는 스크립트를 새로 만들지 않는다"
    );
    std::fs::write(script_at(&dir), "rem aynx-hook-version: 2\r\n").unwrap();
    assert_eq!(refresh_at(&dir), Ok(true));
    assert_eq!(
        std::fs::read_to_string(script_at(&dir)).unwrap(),
        script_file().1
    );
    assert_eq!(refresh_at(&dir), Ok(false));
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- 원격 (순수 병합 + 명령 조립만 — 서버에 닿지 않는다) ----

#[test]
fn remote_read_command_reports_missing_with_its_own_exit_code() {
    assert_eq!(
        remote_read_command(claude()),
        r#"if [ -e "$HOME"/'.claude'/'settings.json' ]; then cat -- "$HOME"/'.claude'/'settings.json'; else exit 3; fi"#
    );
    assert_eq!(
        remote_read_command(codex()),
        r#"if [ -e "${CODEX_HOME:-$HOME/.codex}"/'hooks.json' ]; then cat -- "${CODEX_HOME:-$HOME/.codex}"/'hooks.json'; else exit 3; fi"#
    );
}

#[test]
fn remote_install_merges_with_the_same_code_and_quotes_everything() {
    for t in TARGETS {
        let existing = r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"say it's done"}]}]}}"#;
        let cmd = remote_install_command(t, Some(existing)).unwrap();
        let dir = cmd.find(r#"mkdir -p "$HOME"/'.config/aynx/hooks'"#).unwrap();
        let chmod = cmd
            .find(r#"chmod 755 "$HOME"/'.config/aynx/hooks/aynx-agent-signal.sh'"#)
            .unwrap();
        let f = remote_file_sh(t, "");
        let mv = cmd
            .find(&format!("mv -f {} {f}", remote_file_sh(t, ".aynx-tmp")))
            .unwrap();
        assert!(dir < chmod && chmod < mv);
        assert!(cmd.contains(r#"say it'\''s done"#), "{cmd}");
        assert!(cmd.contains(&crate::ssh::sh_quote(SH_SCRIPT)));
        let mut want = parse_settings(t, Some(existing), "x").unwrap();
        install_into(t, &mut want, REMOTE_SCRIPT_CMD);
        assert!(cmd.contains(&crate::ssh::sh_quote(
            &serde_json::to_string_pretty(&want).unwrap()
        )));
        assert_eq!(installed_in(t, &want, REMOTE_SCRIPT_CMD), Installed::Full);
        let stop = &want["hooks"]["Stop"][1]["hooks"][0];
        assert_eq!(
            stop["command"],
            format!(r#""$HOME/.config/aynx/hooks/aynx-agent-signal.sh" stop {}"#, t.id)
        );
        assert!(stop.get("commandWindows").is_none(), "원격은 command 만");
        assert_eq!(want["model"], "opus");
    }
}

#[test]
fn remote_install_with_nothing_to_change_writes_only_the_script() {
    for t in TARGETS {
        let mut root = json!({"theme": "dark"});
        install_into(t, &mut root, REMOTE_SCRIPT_CMD);
        let cmd = remote_install_command(t, Some(&root.to_string())).unwrap();
        assert!(
            cmd.ends_with(r#"chmod 755 "$HOME"/'.config/aynx/hooks/aynx-agent-signal.sh'"#),
            "{cmd}"
        );
        assert!(!cmd.contains("aynx-tmp"), "설정은 쓰지 않는다");
    }
}

#[test]
fn remote_install_on_a_missing_file_starts_from_an_empty_object() {
    for t in TARGETS {
        let cmd = remote_install_command(t, None).unwrap();
        let mut want = json!({});
        install_into(t, &mut want, REMOTE_SCRIPT_CMD);
        assert!(cmd.contains(&crate::ssh::sh_quote(
            &serde_json::to_string_pretty(&want).unwrap()
        )));
        assert!(cmd.contains(&format!("mkdir -p {} &&", t.remote_dir_sh)));
    }
}

#[test]
fn remote_install_refuses_invalid_json_without_writing() {
    for t in TARGETS {
        let err = remote_install_command(t, Some("{ not json")).unwrap_err();
        assert!(err.contains(t.remote_shown), "{err}");
        assert!(
            remote_install_command(t, Some("[1]")).is_err(),
            "객체가 아니면 실패"
        );
        assert!(remote_remove_command(t, Some("{ not json"), false).is_err());
    }
}

#[test]
fn remote_remove_writes_only_when_ours_were_there_and_drops_the_script_unless_shared() {
    for t in TARGETS {
        // 그 에이전트의 PATH 심은 늘 지운다(2026-10-26 에이전트 활성화).
        let shim = format!(r#"rm -f "$HOME"/'.config/aynx/bin/{}'"#, t.id);
        let rm = format!(r#"rm -f "$HOME"/'.config/aynx/hooks/aynx-agent-signal.sh' && {shim}"#);
        assert_eq!(
            remote_remove_command(t, None, false).unwrap(),
            rm,
            "파일이 없으면 만들지 않는다"
        );
        assert_eq!(
            remote_remove_command(t, None, true).unwrap(),
            shim,
            "다른 에이전트가 쓰면 스크립트는 남긴다"
        );
        assert_eq!(
            remote_remove_command(t, Some(r#"{"theme":"dark"}"#), false).unwrap(),
            rm,
            "우리 것이 없으면 쓰지 않는다"
        );
        let mut root = json!({"theme":"dark"});
        install_into(t, &mut root, REMOTE_SCRIPT_CMD);
        let cmd = remote_remove_command(t, Some(&root.to_string()), false).unwrap();
        assert!(cmd.ends_with(&format!("&& {rm}")), "{cmd}");
        assert!(cmd.contains(&crate::ssh::sh_quote(
            &serde_json::to_string_pretty(&json!({"theme":"dark"})).unwrap()
        )));
    }
}

#[test]
fn remote_status_reads_like_the_local_one() {
    for t in TARGETS {
        let st = remote_status(t, Ok(None));
        assert!(!st.installed && !st.partial && st.error.is_none());
        assert_eq!(st.settings_path, t.remote_shown);
        assert_eq!(st.script_path, "~/.config/aynx/hooks/aynx-agent-signal.sh");
        assert!(st
            .preview
            .contains("$HOME/.config/aynx/hooks/aynx-agent-signal.sh"));
        let mut root = json!({});
        install_into(t, &mut root, REMOTE_SCRIPT_CMD);
        assert!(remote_status(t, Ok(Some(root.to_string()))).installed);
        assert!(remote_status(t, Ok(Some("{ x".into()))).error.is_some());
        assert!(remote_status(t, Err("gone".into())).error.is_some());
    }
}

#[test]
fn an_oversized_remote_command_is_refused() {
    let big = format!(r#"{{"blob":"{}"}}"#, "a".repeat(REMOTE_COMMAND_MAX));
    for t in TARGETS {
        assert!(remote_install_command(t, Some(&big)).is_err());
    }
}

// ── 원격 자동 설치 (docs/log/2026-09-24-remote-agent-signals.md "자동 설치") ─────

/// 에이전트 활성화(2026-10-26) — 켜져 있으면 모든 에이전트를 심고, 시작 명령의 에이전트가 맨 앞이다. 끄면 아무것도.
#[test]
fn auto_install_covers_every_agent_when_the_option_is_on() {
    let ids = |v: Vec<&'static HookTarget>| v.iter().map(|t| t.id).collect::<Vec<_>>();
    assert_eq!(ids(auto_install_targets(true, Some("claude"))), ["claude", "codex"]);
    assert_eq!(ids(auto_install_targets(true, Some("codex"))), ["codex", "claude"]);
    // 앱이 띄운 AI 타일이 아니어도(평범한 셸 · 재접속 · AI 아닌 명령 · 표에 없는 에이전트) 심는다.
    assert_eq!(ids(auto_install_targets(true, None)), ["claude", "codex"]);
    assert_eq!(ids(auto_install_targets(true, Some("gemini"))), ["claude", "codex"]);
    // Codex 는 신뢰 안내가 붙는 줄이다
    let codex = auto_install_targets(true, Some("codex"))[0];
    assert!(codex.needs_trust_note, "알림에 /hooks 승인 안내가 붙는다");
    assert_eq!(codex.remote_dir_sh, r#""${CODEX_HOME:-$HOME/.codex}""#);
    assert_eq!(codex.remote_file, "hooks.json");
    // 호스트 옵션 꺼짐
    assert!(auto_install_targets(false, Some("claude")).is_empty());
    assert!(auto_install_targets(false, None).is_empty());
}

#[test]
fn auto_notice_carries_the_trust_note_only_for_codex() {
    let mut seen = std::collections::HashSet::new();
    let n = auto_notice(&mut seen, &AutoInstall::Installed, codex(), "dev-01", "s1").expect("알림");
    assert!(n.needs_trust);
    assert_eq!(n.agent, "Codex");
    assert_eq!(n.version, Some(SCRIPT_VERSION));
    let n = auto_notice(&mut seen, &AutoInstall::Installed, claude(), "dev-02", "s2").expect("알림");
    assert!(!n.needs_trust);
}

#[test]
fn auto_install_skips_only_when_settings_and_script_are_both_current() {
    let t = claude();
    let mut root = json!({"theme": "dark"});
    install_into(t, &mut root, REMOTE_SCRIPT_CMD);
    let full = remote_status(t, Ok(Some(root.to_string())));
    assert!(auto_up_to_date(&full, true), "이미 최신 — 조용히");
    assert!(!auto_up_to_date(&full, false), "스크립트가 옛 판 · 없음 — 다시 심는다");
    let missing = remote_status(t, Ok(None));
    assert!(!auto_up_to_date(&missing, true), "설정이 없다 — 심는다");
    let broken = remote_status(t, Ok(Some("{ nope".into())));
    assert!(!auto_up_to_date(&broken, true));
    assert!(broken.error.is_some(), "깨진 설정은 자동 설치가 실패로 돌린다(쓰지 않는다)");
}

#[test]
fn auto_notice_is_quiet_when_current_and_once_per_host() {
    let t = claude();
    let mut seen = std::collections::HashSet::new();
    assert!(auto_notice(&mut seen, &AutoInstall::Current, t, "dev-01", "s1").is_none());
    let n = auto_notice(&mut seen, &AutoInstall::Installed, t, "dev-01", "s1").unwrap();
    assert_eq!((n.version, n.reason.as_deref(), n.agent), (Some(SCRIPT_VERSION), None, "Claude Code"));
    // 같은 호스트(대소문자 무시) · 같은 에이전트는 앱 세션 동안 다시 알리지 않는다 — 실패도.
    assert!(auto_notice(&mut seen, &AutoInstall::Failed("x".into()), t, "DEV-01", "s2").is_none());
    // 다른 에이전트는 따로 한 번(같은 접속이 둘을 함께 심는다 — Codex 의 승인 안내가 가려지지 않게).
    assert!(auto_notice(&mut seen, &AutoInstall::Installed, codex(), "dev-01", "s1").is_some());
    let f = auto_notice(&mut seen, &AutoInstall::Failed("no curl".into()), t, "web", "s3").unwrap();
    assert_eq!((f.version, f.reason.as_deref(), f.stream.as_str()), (None, Some("no curl"), "s3"));
    let v = serde_json::to_value(&f).unwrap();
    assert!(v.get("alias").is_some() && v.get("stream").is_some() && v.get("version").is_some());
}

/// 8판 — 설치기가 명령 둘째 인자로 CLI 를 박고(`claude_handler` · `codex_handler` 가 각자), 스크립트는 그 값이
/// `claude`·`codex` 일 때만 CLI 로 읽어 본문에 `"cli"` 로 싣는다(범주는 셋째로 밀린다). 그 밖이면 예전처럼 둘째가
/// 범주다 — 옛 등록(`waiting permission`)이 새 스크립트를 불러도 그대로 돈다. 엔드포인트의 허용값과 같은 글자다.
#[test]
fn installers_pin_the_cli_and_scripts_send_it() {
    for t in TARGETS {
        assert!(crate::agent_signal::CLI_IDS.contains(&t.id), "{}", t.id);
        for script in ["/x/aynx-agent-signal.sh", "C:/a/aynx-agent-signal.cmd"] {
            for (_, g) in our_groups(t, script) {
                let h = &g["hooks"][0];
                for key in ["command", "commandWindows"] {
                    let Some(c) = h.get(key).and_then(Value::as_str) else {
                        continue;
                    };
                    let args: Vec<&str> = c.rsplit('"').next().unwrap().split_whitespace().collect();
                    assert_eq!(args.get(1).copied(), Some(t.id), "{} {key}: {c}", t.id);
                }
            }
        }
    }
    assert_eq!(
        codex_handler("/x/aynx-agent-signal.sh", ev(codex(), "PermissionRequest"), false)["command"],
        r#""/x/aynx-agent-signal.sh" waiting codex permission"#
    );
    assert_eq!(
        claude_handler("/x/aynx-agent-signal.sh", ev(claude(), "UserPromptSubmit"), false)["command"],
        r#""/x/aynx-agent-signal.sh" start claude"#
    );
    // 스크립트: 둘째 인자가 CLI 면 범주는 셋째, 본문에 cli 칸.
    assert!(SH_SCRIPT.contains("  claude|codex) cli=$2; det=$3 ;;"));
    assert!(SH_SCRIPT.contains(r#"[ -n "$cli" ] && extra="$extra,\"cli\":\"$cli\"""#));
    assert!(CMD_SCRIPT.contains(r#"if "%~2"=="claude" (set "AYNX_CLI=claude" & set "AYNX_DET=%~3")"#));
    assert!(CMD_SCRIPT.contains(r#"if "%~2"=="codex" (set "AYNX_CLI=codex" & set "AYNX_DET=%~3")"#));
    assert!(CMD_SCRIPT.contains(r#"if defined AYNX_CLI set "AYNX_X=%AYNX_X%,\"cli\":\"%AYNX_CLI%\"""#));
    // CLI 를 읽은 뒤에 범주 판정·입력 읽기가 온다.
    let cli = CMD_SCRIPT.find(r#"set "AYNX_CLI=""#).unwrap();
    let skip = CMD_SCRIPT.find("if defined AYNX_DET goto send\n").unwrap();
    assert!(cli < skip);
    let cli = SH_SCRIPT.find("claude|codex)").unwrap();
    let guard = SH_SCRIPT.find(r#"if [ -z "$det" ] && [ "$1" = waiting ]"#).unwrap();
    assert!(cli < guard);
}

/// 7판 이하의 등록(CLI 인자 없음)은 "일부만" 으로 읽혀 다시 설치를 부르고(원격은 자동 설치가 갈아 쓴다), 다시
/// 설치하면 새 모양 한 벌이다.
#[test]
fn an_entry_without_the_cli_argument_reads_partial() {
    for t in TARGETS {
        let script = "/x/aynx-agent-signal.sh";
        let mut root = json!({});
        install_into(t, &mut root, script);
        for (_, groups) in root["hooks"].as_object_mut().unwrap() {
            let h = &mut groups[0]["hooks"][0];
            let old = h["command"].as_str().unwrap().replace(&format!(" {}", t.id), "");
            h["command"] = json!(old);
        }
        assert_eq!(installed_in(t, &root, script), Installed::Partial, "{}", t.id);
        install_into(t, &mut root, script);
        assert_eq!(installed_in(t, &root, script), Installed::Full, "{}", t.id);
    }
}

// ---- 9판: 신호 파일 · session-end · 로컬 자동 갱신 ----

/// 이 PC 의 `sh` 로 `.sh` 스크립트를 실제로 돌린다 — 가짜 `curl`(받은 설정 표준 입력과 인자를 파일에 적는다)을 PATH 앞에
/// 두고, 임시 `HOME`. `sh` 가 없으면 `None`(건너뜀 — Windows 에서는 Git Bash). 돌려주는 값: 가짜 curl 이 적은 글자
/// (불리지 않았으면 빈 글자).
fn run_sh_script(
    tag: &str,
    env: &[(&str, &str)],
    args: &[&str],
    stdin: &str,
    signal_file: Option<&str>,
) -> Option<String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    if Command::new("sh").arg("-c").arg("exit 0").output().is_err() {
        eprintln!("sh 가 없어 건너뜀");
        return None;
    }
    let dir = temp_dir(tag);
    let posix = |p: &Path| {
        let s = p.to_string_lossy().replace('\\', "/");
        match s.as_bytes() {
            [d, b':', b'/', ..] if cfg!(windows) => {
                format!("/{}{}", (*d as char).to_ascii_lowercase(), &s[2..])
            }
            _ => s,
        }
    };
    let bin = dir.join("bin");
    let home = dir.join("home");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::create_dir_all(home.join(".config/aynx/signal")).unwrap();
    let out = dir.join("curl.out");
    std::fs::write(
        bin.join("curl"),
        format!(
            "#!/bin/sh\n{{ cat; printf '\\nARGS:'; for a in \"$@\"; do printf ' [%s]' \"$a\"; done; }} > {}\n",
            crate::ssh::sh_quote(&posix(&out))
        ),
    )
    .unwrap();
    std::fs::write(dir.join("hook.sh"), SH_SCRIPT).unwrap();
    if let Some(body) = signal_file {
        std::fs::write(home.join(".config/aynx/signal/s-1.env"), body).unwrap();
    }
    let mut exports = String::new();
    for (k, v) in env {
        exports.push_str(&format!("{k}={}; export {k}; ", crate::ssh::sh_quote(v)));
    }
    let quoted: Vec<String> = args.iter().map(|a| crate::ssh::sh_quote(a)).collect();
    let cmd = format!(
        "chmod +x {bin}/curl; unset AYNX_MCP_URL AYNX_SIGNAL_TOKEN AYNX_MCP_TOKEN AYNX_STREAM; \
         HOME={home}; export HOME; PATH={bin}:$PATH; export PATH; {exports}sh {script} {args}",
        bin = crate::ssh::sh_quote(&posix(&bin)),
        home = crate::ssh::sh_quote(&posix(&home)),
        script = crate::ssh::sh_quote(&posix(&dir.join("hook.sh"))),
        args = quoted.join(" "),
    );
    // Claude Code · Codex 안에서 `cargo test` 를 돌려도 부모 표지로 13판 중첩 판정을 타지 않게 걷는다.
    // 중첩을 보는 시험은 `env` 인자로 다시 준다(위 `exports`).
    let mut child = Command::new("sh")
        .env_remove("CLAUDECODE")
        .env_remove("CODEX_THREAD_ID")
        .arg("-c")
        .arg(&cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let o = child.wait_with_output().unwrap();
    assert!(o.status.success(), "늘 0: {}", String::from_utf8_lossy(&o.stderr));
    assert!(o.stdout.is_empty(), "출력 없음: {}", String::from_utf8_lossy(&o.stdout));
    let pwned = home.join("pwned").exists();
    let got = std::fs::read_to_string(&out).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(!pwned, "신호 파일의 명령이 돌았다 — 소스하면 안 된다");
    Some(got)
}

const TOK: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SID: &str = "0123abcd-1111-2222-3333-444455556666";

/// 9판 — 환경변수가 있으면 그것(로컬 타일 · 폴백), 없으면 신호 파일에서 두 키만 읽는다(소스하지 않는다). 모양이 틀린 파일 ·
/// 없는 파일 · 스트림 없음은 요청 없이 0.
#[test]
fn real_sh_reads_the_signal_file_only_when_the_env_has_no_url() {
    let file = crate::remote_signal_file::body(Some(("http://127.0.0.1:41234", TOK)), None, 1).unwrap();
    let Some(got) = run_sh_script(
        "file",
        &[("AYNX_STREAM", "s-1")],
        &["stop", "claude"],
        "{}",
        Some(&file),
    ) else {
        return;
    };
    assert!(got.contains(&format!("Authorization: Bearer {TOK}")), "{got}");
    assert!(got.contains("[http://127.0.0.1:41234/agent-signal]"), "{got}");
    assert!(got.contains(r#""stream":"s-1","event":"stop","v":13"#), "{got}");
    assert!(
        !got.split("ARGS:").nth(1).unwrap().contains(TOK),
        "argv 에 토큰 없음: {got}"
    );
    // 환경변수가 먼저 — 파일이 있어도 환경의 주소·토큰.
    let env = [
        ("AYNX_STREAM", "s-1"),
        ("AYNX_MCP_URL", "http://127.0.0.1:5555"),
        ("AYNX_SIGNAL_TOKEN", "feedface"),
    ];
    let got = run_sh_script("env", &env, &["stop", "claude"], "{}", Some(&file)).unwrap();
    assert!(
        got.contains("Bearer feedface") && got.contains("[http://127.0.0.1:5555/agent-signal]"),
        "{got}"
    );
    // 요청 없이 0 — 파일 없음 · 남의 주소 · 따옴표 낀 토큰 · 신호 없이 에이전트 키만(에이전트 활성화 — 2026-10-26).
    let args_only = crate::remote_signal_file::body(
        None,
        Some(&crate::remote_signal_file::AgentKeys {
            args: vec![("claude", vec!["--model".into(), "opus".into()])],
            no_daemon: true,
        }),
        1,
    );
    for (tag, file) in [
        ("none", None),
        ("argsonly", args_only),
        (
            "evil",
            Some(format!(
                "AYNX_MCP_URL=http://example.com:1\nAYNX_SIGNAL_TOKEN={TOK}\n"
            )),
        ),
        (
            "quote",
            Some("AYNX_MCP_URL=http://127.0.0.1:1\nAYNX_SIGNAL_TOKEN=a\"b\n".to_string()),
        ),
    ] {
        let got = run_sh_script(
            tag,
            &[("AYNX_STREAM", "s-1")],
            &["stop", "claude"],
            "{}",
            file.as_deref(),
        )
        .unwrap();
        assert!(got.is_empty(), "{tag}: {got}");
    }
    // 스트림이 없으면 아무것도 하지 않는다.
    let got = run_sh_script("nostream", &[], &["stop", "claude"], "{}", Some(&file)).unwrap();
    assert!(got.is_empty(), "{got}");
    // 파일을 소스하지 않는다 — 명령 줄이 끼어 있어도 돌지 않고(도우미가 `pwned` 를 본다), 두 키는 읽힌다.
    let trap = format!("touch \"$HOME/pwned\"\n{file}$(touch \"$HOME/pwned\")\n");
    let got = run_sh_script(
        "trap",
        &[("AYNX_STREAM", "s-1")],
        &["stop", "claude"],
        "{}",
        Some(&trap),
    )
    .unwrap();
    assert!(got.contains(&format!("Bearer {TOK}")), "{got}");
}

/// 9판 `session-end` — 대화 id 를 싣고, 까닭이 `clear` 면 보내지 않는다(실제 sh).
#[test]
fn real_sh_sends_session_end_except_for_clear() {
    let env = [
        ("AYNX_STREAM", "s-1"),
        ("AYNX_MCP_URL", "http://127.0.0.1:5555"),
        ("AYNX_SIGNAL_TOKEN", "feedface"),
    ];
    let input = format!(
        r#"{{"session_id":"{SID}","hook_event_name":"SessionEnd","reason":"prompt_input_exit"}}"#
    );
    let Some(got) = run_sh_script("end", &env, &["session-end", "codex"], &input, None) else {
        return;
    };
    assert!(
        got.contains(&format!(
            r#""event":"session-end","v":13,"session":"{SID}","cli":"codex""#
        )),
        "{got}"
    );
    let clear = format!(r#"{{"session_id":"{SID}","reason":"clear"}}"#);
    let got = run_sh_script("clear", &env, &["session-end", "claude"], &clear, None).unwrap();
    assert!(got.is_empty(), "/clear 는 보내지 않는다: {got}");
    // `.cmd` 도 같은 갈래(글자 계약).
    assert!(CMD_SCRIPT.contains(r#"if /i "%~1"=="session-end" goto session"#));
    assert!(CMD_SCRIPT.contains(r#"set AYNX_R=!AYNX_IN:"reason":"clear"=!"#));
}

/// 10판 `session`(Claude `SessionStart`) — 대화 id 만 뗀다(source 는 싣지 않는다 · 실제 sh). `.cmd` 도 같은 갈래.
#[test]
fn real_sh_sends_session_start_with_only_the_id() {
    let env = [
        ("AYNX_STREAM", "s-1"),
        ("AYNX_MCP_URL", "http://127.0.0.1:5555"),
        ("AYNX_SIGNAL_TOKEN", "feedface"),
    ];
    let input = format!(
        r#"{{"session_id":"{SID}","transcript_path":"/x/y.jsonl","cwd":"/w","hook_event_name":"SessionStart","source":"resume"}}"#
    );
    let Some(got) = run_sh_script("sess", &env, &["session", "claude"], &input, None) else {
        return;
    };
    assert!(
        got.contains(&format!(r#""event":"session","v":13,"session":"{SID}","cli":"claude""#)),
        "{got}"
    );
    assert!(!got.contains("resume") && !got.contains("transcript"), "source · 경로는 싣지 않는다: {got}");
    assert!(CMD_SCRIPT.contains(r#"if /i "%~1"=="session" goto session"#));
}

// ---- 12·13판: Claude 안의 Codex · Codex 셸 도구로 뜬 Claude/Codex ----

/// 표 한 줄 — 이 환경 · 인자 · 표준 입력으로 스크립트를 돌리면 `want` 본문이 나간다(`None` = 요청 없음).
#[derive(Clone)]
struct NestCase {
    what: &'static str,
    claudecode: Option<&'static str>,
    codex_thread_id: Option<&'static str>,
    args: &'static [&'static str],
    stdin: String,
    want: Option<serde_json::Value>,
}

/// 보내는 본문 전체 — 칸을 더 싣거나 빼면 틀리도록 통째로 견준다.
fn nest_body(event: &str, extra: &[(&str, &str)]) -> Option<serde_json::Value> {
    let mut v = json!({ "stream": "s-1", "event": event, "v": SCRIPT_VERSION });
    for (k, val) in extra {
        v[*k] = json!(val);
    }
    Some(v)
}

/// `.sh` · `.cmd` 가 함께 지나는 표. 입력에는 `.cmd` 의 구문을 깰 글자(`& < > | % " ! ^`)를 일부러 넣는다 — 본문에는 한 글자도 나가지 않는다.
fn nest_table() -> Vec<NestCase> {
    const NASTY: &str = r#"a & b < c > d | e % f \" g ! h %PATH% !PATH! ^ i"#;
    let turn = format!(r#"{{"session_id":"{SID}","hook_event_name":"X","prompt":"{NASTY}"}}"#);
    let end = format!(r#"{{"session_id":"{SID}","hook_event_name":"SessionEnd","reason":"other","note":"{NASTY}"}}"#);
    let clear = format!(r#"{{"session_id":"{SID}","reason":"clear","note":"{NASTY}"}}"#);
    let bad_id = r#"{"session_id":"not-a-uuid & <x> | %y% ! \"z\"","prompt":"p"}"#.to_owned();
    let sub = format!(r#"{{"session_id":"{SID}","agent_id":"agent_x-1","agent_type":"default","note":"{NASTY}"}}"#);
    let wait = format!(r#"{{"notification_type":"permission_prompt","message":"{NASTY}"}}"#);
    let none = String::new();
    let case = |what, claudecode, args, stdin: &String, want| NestCase {
        what,
        claudecode,
        codex_thread_id: None,
        args,
        stdin: stdin.clone(),
        want,
    };
    let n = Some("1");
    vec![
        // CLAUDECODE + codex = 중첩.
        case("중첩 start", n, &["start", "codex"], &turn, nest_body("subagent-start", &[("agent", SID)])),
        case("중첩 session-end", n, &["session-end", "codex"], &end, nest_body("subagent-stop", &[("agent", SID)])),
        case("중첩 session-end clear", n, &["session-end", "codex"], &clear, None),
        case("중첩 stop", n, &["stop", "codex"], &turn, None),
        case("중첩 session", n, &["session", "codex"], &turn, None),
        case("중첩 start 이상한 id", n, &["start", "codex"], &bad_id, nest_body("subagent-start", &[])),
        case("중첩 session-end 이상한 id", n, &["session-end", "codex"], &bad_id, nest_body("subagent-stop", &[])),
        case("중첩 start 빈 입력", n, &["start", "codex"], &none, nest_body("subagent-start", &[])),
        case("중첩 tool", n, &["tool", "codex"], &none, nest_body("tool", &[])),
        case("중첩 tool-done", n, &["tool-done", "codex"], &none, nest_body("tool-done", &[])),
        case("중첩 waiting 범주 인자", n, &["waiting", "codex", "permission"], &none, nest_body("waiting", &[("detail", "permission")])),
        case("중첩 waiting 입력에서 범주", n, &["waiting", "codex"], &wait, nest_body("waiting", &[("detail", "permission")])),
        case("중첩 subagent-start", n, &["subagent-start", "codex"], &sub, nest_body("subagent-start", &[("agent", "agent_x-1")])),
        case("중첩 subagent-stop", n, &["subagent-stop", "codex"], &sub, nest_body("subagent-stop", &[("agent", "agent_x-1")])),
        // CLAUDECODE 없음 + codex = 그대로.
        case("codex start", None, &["start", "codex"], &turn, nest_body("start", &[("session", SID), ("cli", "codex")])),
        case("codex stop", None, &["stop", "codex"], &turn, nest_body("stop", &[("session", SID), ("cli", "codex")])),
        case("codex session", None, &["session", "codex"], &turn, nest_body("session", &[("session", SID), ("cli", "codex")])),
        case("codex session-end", None, &["session-end", "codex"], &end, nest_body("session-end", &[("session", SID), ("cli", "codex")])),
        case("codex session-end clear", None, &["session-end", "codex"], &clear, None),
        case("codex tool", None, &["tool", "codex"], &none, nest_body("tool", &[("cli", "codex")])),
        case("codex waiting", None, &["waiting", "codex", "permission"], &none, nest_body("waiting", &[("detail", "permission"), ("cli", "codex")])),
        case("codex subagent-start", None, &["subagent-start", "codex"], &sub, nest_body("subagent-start", &[("agent", "agent_x-1"), ("cli", "codex")])),
        // 비어 있는 CLAUDECODE 는 없는 것이다.
        case("빈 CLAUDECODE", Some(""), &["start", "codex"], &turn, nest_body("start", &[("session", SID), ("cli", "codex")])),
        // CLAUDECODE + claude = 그대로(Claude 훅에는 늘 있다).
        case("claude start", n, &["start", "claude"], &turn, nest_body("start", &[("session", SID), ("cli", "claude")])),
        case("claude stop", n, &["stop", "claude"], &turn, nest_body("stop", &[("session", SID), ("cli", "claude")])),
        case("claude session", n, &["session", "claude"], &turn, nest_body("session", &[("session", SID), ("cli", "claude")])),
        case("claude session-end", n, &["session-end", "claude"], &end, nest_body("session-end", &[("session", SID), ("cli", "claude")])),
        case("claude tool", n, &["tool", "claude"], &none, nest_body("tool", &[("cli", "claude")])),
        case("claude waiting", n, &["waiting", "claude"], &wait, nest_body("waiting", &[("detail", "permission"), ("cli", "claude")])),
        case("claude subagent-stop", n, &["subagent-stop", "claude"], &sub, nest_body("subagent-stop", &[("agent", "agent_x-1"), ("cli", "claude")])),
        // 옛 등록(CLI 인자 없음 · 둘째가 범주)은 CLAUDECODE 가 있어도 중첩이 아니다.
        case("옛 등록 범주", n, &["waiting", "permission"], &none, nest_body("waiting", &[("detail", "permission")])),
        case("옛 등록 start", n, &["start"], &turn, nest_body("start", &[("session", SID)])),
    ]
}

/// 13판: 12판 표를 그대로 보존하고 빈 표지, Codex 안의 두 CLI, 두 부모 표지가 함께 있는 경우를 더한다.
fn nest_table_v13() -> Vec<NestCase> {
    // 대화형 Claude 의 매 프롬프트와 종료가 같은 변환 경로를 타야 한다.
    assert_eq!(ev(claude(), "UserPromptSubmit").event, "start");
    assert_eq!(ev(claude(), "Stop").event, "stop");
    assert_eq!(ev(claude(), "SessionStart").event, "session");
    assert_eq!(ev(claude(), "SessionEnd").event, "session-end");
    assert_eq!((ev(claude(), "Notification").event, ev(claude(), "Notification").detail), ("waiting", None));
    let original = nest_table();
    let mut cases = original.clone();
    for c in &original {
        let mut empty = c.clone();
        empty.what = "13판 빈 CODEX_THREAD_ID — 12판과 같음";
        empty.codex_thread_id = Some("");
        cases.push(empty);
        // 12판의 중첩 기대 본문을 양쪽 CLI 에 그대로 적용한다(14개 이벤트/입력 조합).
        if c.claudecode == Some("1") && c.args.get(1) == Some(&"codex") {
            for claudecode in [None, Some("1")] {
                let mut codex = c.clone();
                codex.what = "13판 Codex 안의 Codex";
                codex.claudecode = claudecode;
                codex.codex_thread_id = Some("parent-thread");
                cases.push(codex.clone());
                let mut claude = codex;
                claude.what = "13판 Codex 안의 Claude";
                claude.args = match c.args {
                    ["start", _] => &["start", "claude"],
                    ["stop", _] => &["stop", "claude"],
                    ["session", _] => &["session", "claude"],
                    ["session-end", _] => &["session-end", "claude"],
                    ["tool", _] => &["tool", "claude"],
                    ["tool-done", _] => &["tool-done", "claude"],
                    ["waiting", _, "permission"] => &["waiting", "claude", "permission"],
                    ["waiting", _] => &["waiting", "claude"],
                    ["subagent-start", _] => &["subagent-start", "claude"],
                    ["subagent-stop", _] => &["subagent-stop", "claude"],
                    _ => unreachable!("12판 중첩 표의 인자"),
                };
                cases.push(claude);
            }
        }
        if c.args.get(1).is_none_or(|arg| *arg == "permission") {
            let mut legacy = c.clone();
            legacy.what = "13판 옛 등록 — 두 표지가 있어도 그대로";
            legacy.codex_thread_id = Some("parent-thread");
            cases.push(legacy);
        }
    }
    cases
}

/// 실제 스크립트의 본문을 견주고, 매 턴 같은 대화 id 로 온 start 를 상태가 중복 집계하지 않는지도 본다.
fn assert_nest_body(c: &NestCase, body: Option<serde_json::Value>) {
    assert_eq!(body, c.want, "{} {:?}", c.what, c.args);
    if let Some(body) = body.filter(|v| v["event"] == "subagent-start" && v["agent"] == SID) {
        let sig = crate::agent_signal::parse(&body.to_string()).unwrap();
        let first = crate::agent_state::apply(&crate::agent_state::AgentState::default(), &sig, 1).next;
        let again = crate::agent_state::apply(&first, &sig, 2).next;
        assert_eq!(again.subagents, vec![SID.to_string()], "같은 id 는 한 번만 센다");
        let end = crate::agent_signal::AgentSignal { event: crate::agent_signal::SignalEvent::SubagentStop, ..sig };
        assert!(crate::agent_state::apply(&again, &end, 3).next.subagents.is_empty(), "끝나면 한 번에 비워진다");
    }
}

/// 12·13판 — 실제 sh 로 표 전체. 본문은 가짜 curl 이 적은 `--data` 인자다.
#[test]
fn real_sh_turns_codex_inside_claude_into_a_subagent() {
    for c in nest_table_v13() {
        let mut env = vec![
            ("AYNX_STREAM", "s-1"),
            ("AYNX_MCP_URL", "http://127.0.0.1:5555"),
            ("AYNX_SIGNAL_TOKEN", "feedface"),
        ];
        if let Some(v) = c.claudecode {
            env.push(("CLAUDECODE", v));
        }
        if let Some(v) = c.codex_thread_id {
            env.push(("CODEX_THREAD_ID", v));
        }
        let Some(got) = run_sh_script("nest", &env, c.args, &c.stdin, None) else {
            return;
        };
        let body = got.split("[--data] [").nth(1).map(|rest| {
            let end = rest.find("] [http").expect("본문 뒤에 주소");
            serde_json::from_str::<serde_json::Value>(&rest[..end]).expect("본문은 JSON")
        });
        assert_nest_body(&c, body);
    }
}

/// 이 PC 의 `cmd.exe` 로 `.cmd` 스크립트를 실제로 돌린다 — 진짜 `curl.exe` 가 루프백 수신기에 쏘고, 받은 본문을 돌려준다
/// (`curl.exe` 는 이름을 박아 부르므로 가짜를 끼울 수 없다). `curl.exe` 가 없으면 `None`(건너뜀).
#[cfg(windows)]
fn run_cmd_script(tag: &str, claudecode: Option<&str>, codex_thread_id: Option<&str>, args: &[&str], stdin: &str) -> Option<Vec<String>> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    if Command::new("curl.exe").arg("--version").output().is_err() {
        eprintln!("curl.exe 가 없어 건너뜀");
        return None;
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let done = Arc::new(AtomicBool::new(false));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let receiver = {
        let (done, bodies) = (done.clone(), bodies.clone());
        std::thread::spawn(move || loop {
            let mut sock = match listener.accept() {
                Ok((sock, _)) => sock,
                Err(_) if done.load(Ordering::SeqCst) => return,
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                }
            };
            sock.set_nonblocking(false).unwrap();
            sock.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            let body = loop {
                let n = sock.read(&mut chunk).unwrap();
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf).into_owned();
                let Some((head, rest)) = text.split_once("\r\n\r\n") else {
                    assert!(n > 0, "머리 전에 끊겼다: {text}");
                    continue;
                };
                let len: usize = head
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap()))
                    .expect("Content-Length");
                if rest.len() >= len {
                    assert!(head.contains("Authorization: Bearer feedface"), "{head}");
                    break rest.to_owned();
                }
                assert!(n > 0, "본문 전에 끊겼다: {text}");
            };
            sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            bodies.lock().unwrap().push(body);
        })
    };
    let dir = temp_dir(tag);
    let script = dir.join("hook.cmd");
    std::fs::write(&script, CMD_SCRIPT.replace('\n', "\r\n")).unwrap();
    let mut cmd = Command::new("cmd");
    cmd.arg("/d").arg("/c").arg(&script).args(args);
    cmd.env_remove("CLAUDECODE")
        .env_remove("CODEX_THREAD_ID")
        .env_remove("AYNX_MCP_TOKEN")
        .env("AYNX_STREAM", "s-1")
        .env("AYNX_MCP_URL", &url)
        .env("AYNX_SIGNAL_TOKEN", "feedface");
    if let Some(v) = claudecode {
        cmd.env("CLAUDECODE", v);
    }
    if let Some(v) = codex_thread_id {
        cmd.env("CODEX_THREAD_ID", v);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // 입력을 읽지 않는 이벤트면 먼저 끝날 수 있다 — 쓰기 실패는 상관없다.
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    let o = child.wait_with_output().unwrap();
    done.store(true, Ordering::SeqCst);
    receiver.join().expect("수신기");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(o.status.success(), "늘 0: {}", String::from_utf8_lossy(&o.stderr));
    assert!(o.stdout.is_empty(), "출력 없음: {}", String::from_utf8_lossy(&o.stdout));
    let got = std::mem::take(&mut *bodies.lock().unwrap());
    Some(got)
}

/// 12·13판 — 실제 cmd · curl 로 표 전체(같은 표 — `.sh` 와 뜻이 같다).
#[cfg(windows)]
#[test]
fn real_cmd_turns_codex_inside_claude_into_a_subagent() {
    for c in nest_table_v13() {
        let Some(got) = run_cmd_script("nestcmd", c.claudecode, c.codex_thread_id, c.args, &c.stdin) else {
            return;
        };
        assert!(got.len() <= 1, "{}: 한 번만 보낸다: {got:?}", c.what);
        let body = got.first().map(|b| serde_json::from_str::<serde_json::Value>(b).expect("본문은 JSON"));
        assert_nest_body(&c, body);
    }
}

/// Claude 만 `SessionStart` → `session` 을 등록한다(연결 전용 · 매처 없음). Codex 는 걸지 않는다(입력 모양 미확인 ·
/// 기동 때 "Hooks need review" 에서 멈춘 실측). 9판 등록(SessionStart 없음)은 "일부만" 으로 읽혀 자동 갱신이 붙인다.
#[test]
fn claude_registers_session_start_and_v9_reads_partial() {
    let e = ev(claude(), "SessionStart");
    assert_eq!((e.event, e.matcher, e.detail), ("session", None, None));
    assert!(codex().events.iter().all(|e| e.hook != "SessionStart"));
    let script = "/x/aynx-agent-signal.sh";
    let mut root = json!({});
    install_into(claude(), &mut root, script);
    assert_eq!(installed_in(claude(), &root, script), Installed::Full);
    root["hooks"]
        .as_object_mut()
        .unwrap()
        .shift_remove("SessionStart");
    assert_ne!(installed_in(claude(), &root, script), Installed::Full);
    assert_eq!(refresh_entries(claude(), &mut root, script), Refresh::Changed);
    assert_eq!(installed_in(claude(), &root, script), Installed::Full);
}

/// 두 에이전트 모두 `SessionEnd` → `session-end` 를 등록하고, 8판 등록(SessionEnd 없음)은 "일부만" 으로 읽힌다.
#[test]
fn both_agents_register_session_end_and_v8_reads_partial() {
    for t in TARGETS {
        let e = ev(t, "SessionEnd");
        assert_eq!(
            (e.event, e.matcher, e.detail),
            ("session-end", None, None),
            "{}",
            t.id
        );
        let script = "/x/aynx-agent-signal.sh";
        let mut root = json!({});
        install_into(t, &mut root, script);
        root["hooks"]
            .as_object_mut()
            .unwrap()
            .shift_remove("SessionEnd");
        assert_eq!(installed_in(t, &root, script), Installed::Partial, "{}", t.id);
    }
}

/// 로컬 자동 갱신의 판정 — 우리 항목이 있고 지금 모양이 아닐 때만 바꾸고, 사용자 항목은 그대로, 이미 최신이거나 우리 것이
/// 없으면 아무것도 하지 않는다.
#[test]
fn local_refresh_touches_only_our_outdated_entries() {
    let script = "/x/aynx-agent-signal.sh";
    for t in TARGETS {
        let mut root =
            json!({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]}});
        let before = root.clone();
        assert_eq!(refresh_entries(t, &mut root, script), Refresh::Untouched, "우리 것 없음 — {}", t.id);
        assert_eq!(root, before);
        install_into(t, &mut root, script);
        let current = root.clone();
        assert_eq!(refresh_entries(t, &mut root, script), Refresh::Untouched, "최신 — {}", t.id);
        assert_eq!(root, current);
        root["hooks"]
            .as_object_mut()
            .unwrap()
            .shift_remove("SessionEnd");
        assert_eq!(refresh_entries(t, &mut root, script), Refresh::Changed, "옛 모양 — {}", t.id);
        assert_eq!(installed_in(t, &root, script), Installed::Full);
        assert!(root["hooks"]["Stop"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["hooks"][0]["command"] == "mine"));
    }
}

/// 파일에서 — 없는 파일은 만들지 않음 · 깨진 설정은 실패(쓰지 않음) · 옛 등록은 갈아 쓰고 스크립트도 쓴다 · 두 번째는 쓰지 않음.
#[test]
fn local_refresh_at_writes_only_when_needed() {
    let t = codex();
    let dir = temp_dir("localrefresh");
    let settings = dir.join("hooks.json");
    assert_eq!(refresh_local_at(t, &settings, &dir), Ok(Refresh::Untouched));
    assert!(!settings.exists() && !script_at(&dir).exists());
    std::fs::write(&settings, "{ broken").unwrap();
    assert!(refresh_local_at(t, &settings, &dir).is_err());
    assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{ broken");
    let mut root = json!({});
    install_into(t, &mut root, &command_path(&script_at(&dir)));
    root["hooks"]
        .as_object_mut()
        .unwrap()
        .shift_remove("SessionEnd");
    std::fs::write(&settings, serde_json::to_string_pretty(&root).unwrap()).unwrap();
    assert_eq!(refresh_local_at(t, &settings, &dir), Ok(Refresh::Changed));
    assert!(script_at(&dir).exists());
    assert_eq!(
        installed_in(t, &read(&settings), &command_path(&script_at(&dir))),
        Installed::Full
    );
    assert_eq!(refresh_local_at(t, &settings, &dir), Ok(Refresh::Untouched));
    let _ = std::fs::remove_dir_all(&dir);
}

/// 인스턴스 가르기 — 릴리스·개발은 스크립트 폴더가 달라(`instance.rs`), **내가 심은 것만 내가 갱신**한다.
/// (a) 내 경로 옛 모양 → 갱신 (b) 다른 인스턴스 경로뿐 → 무변경 (c) 섞임 → 내 것만 갱신, 남의 것은 그대로.
#[test]
fn local_refresh_touches_only_this_instance_entries() {
    // Windows 모양 경로 — Codex 처리기가 역슬래시로 싣는 경우까지 알아보는지.
    let mine = "C:/Users/u/AppData/Roaming/aynx-dev/hooks/aynx-agent-signal.cmd";
    let release = "C:/Users/u/AppData/Roaming/aynx/hooks/aynx-agent-signal.cmd";
    let outdated = |t: &HookTarget, root: &mut Value, script: &str| {
        install_into(t, root, script);
        root["hooks"].as_object_mut().unwrap().shift_remove("SessionEnd");
    };
    for t in TARGETS {
        // (a) 내 경로 옛 모양 — 갈아 쓴다.
        let mut root = json!({});
        outdated(t, &mut root, mine);
        assert_eq!(refresh_entries(t, &mut root, mine), Refresh::Changed, "(a) {}", t.id);
        assert_eq!(installed_in(t, &root, mine), Installed::Full, "(a) {}", t.id);

        // (b) 다른 인스턴스 경로뿐(옛 모양이어도) — 한 글자도 안 바꾼다.
        {
            let mut root = json!({});
            outdated(t, &mut root, release);
            let before = root.clone();
            assert_eq!(refresh_entries(t, &mut root, mine), Refresh::Foreign, "(b) {}", t.id);
            assert_eq!(root, before, "(b) {}", t.id);
        }

        // (c) 섞임 — 남의 묶음은 그대로 남기고 내 것만 지금 모양으로.
        let mut theirs = json!({});
        install_into(t, &mut theirs, release);
        let mut root = theirs.clone();
        let mut mine_old = json!({});
        outdated(t, &mut mine_old, mine);
        for (hook, groups) in mine_old["hooks"].as_object().unwrap() {
            let arr = root["hooks"][hook].as_array_mut().unwrap();
            arr.extend(groups.as_array().unwrap().iter().cloned());
        }
        assert_eq!(refresh_entries(t, &mut root, mine), Refresh::Changed, "(c) {}", t.id);
        assert_eq!(installed_in(t, &root, mine), Installed::Full, "(c) {}", t.id);
        assert_eq!(installed_in(t, &root, release), Installed::Full, "(c) 남의 것 보존 — {}", t.id);
        // 남의 처리기는 한 벌 그대로(빠지지도 늘지도 않음), 내 것도 이벤트마다 한 벌.
        for e in t.events {
            let handlers: Vec<&Value> = root["hooks"][e.hook]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|g| g["hooks"].as_array().unwrap())
                .collect();
            assert_eq!(handlers.iter().filter(|h| is_mine(h, release)).count(), 1, "(c) {} {}", t.id, e.hook);
            assert_eq!(handlers.iter().filter(|h| is_mine(h, mine)).count(), 1, "(c) {} {}", t.id, e.hook);
        }
        // 이미 지금 모양이면 섞여 있어도 손대지 않는다.
        let current = root.clone();
        assert_eq!(refresh_entries(t, &mut root, mine), Refresh::Untouched, "(c) {}", t.id);
        assert_eq!(root, current);
    }
}

/// 파일에서 — 다른 인스턴스 항목뿐이면 설정도 스크립트도 쓰지 않는다.
#[test]
fn local_refresh_at_leaves_another_instance_file_alone() {
    let t = claude();
    let dir = temp_dir("localrefresh-foreign");
    let settings = dir.join("settings.json");
    let other = dir.join("other-instance").join(script_file().0);
    let mut root = json!({});
    install_into(t, &mut root, &command_path(&other));
    root["hooks"].as_object_mut().unwrap().shift_remove("SessionEnd");
    let text = serde_json::to_string_pretty(&root).unwrap();
    std::fs::write(&settings, &text).unwrap();
    assert_eq!(refresh_local_at(t, &settings, &dir), Ok(Refresh::Foreign));
    assert_eq!(std::fs::read_to_string(&settings).unwrap(), text);
    assert!(!script_at(&dir).exists());
    let _ = std::fs::remove_dir_all(&dir);
}
