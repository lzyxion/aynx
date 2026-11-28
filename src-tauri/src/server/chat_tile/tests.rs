//! 채팅 모양 AI 타일 표 시험 — 소스 훑기(불변식) · op 판정 · 가짜 CLI 통합(Windows).
//!
//! 가짜 CLI 는 사이드 채팅 시험의 것(`server::tests_side_chat::fake_cli` — 이 시험 실행 파일 자신을 다시 띄운다)을 그대로 쓴다.
//! 진짜 `claude` · `codex` 는 부르지 않는다.

use std::path::Path;

use serde_json::{json, Value};

use super::super::ipc::frame::code;
use super::{handle, FakeCli};

fn lf(s: &str) -> String {
    s.replace("\r\n", "\n")
}

/// 시험용 가짜(`FakeCli` 부터)는 뺀다.
fn src() -> String {
    let s = lf(include_str!("mod.rs"));
    let end = s.find("/// 모델을 부르지 않는 가짜 CLI.").unwrap();
    s[..end].to_string()
}

fn launch_src() -> String {
    lf(include_str!("launch.rs"))
}

fn proxy_src() -> String {
    lf(include_str!("../chat_tile_proxy.rs"))
}

/// `fn name(` 의 몸(다음 최상위 `\n}` 까지).
fn body_of<'a>(src: &'a str, sig: &str) -> &'a str {
    let at = src.find(sig).unwrap_or_else(|| panic!("{sig} 없음"));
    let rest = &src[at..];
    &rest[..rest.find("\n}").unwrap()]
}

fn code_of(src: &str) -> String {
    src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
}

/// `src/<dir>` 아래 `.rs` 파일들(경로 `/` · 글).
fn sources_under(dir: &str) -> Vec<(String, String)> {
    fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(Path::new(dir), &mut files);
    files.into_iter().map(|f| (f.to_string_lossy().replace('\\', "/"), std::fs::read_to_string(&f).unwrap())).collect()
}

/// 띄우기는 공용 코어의 `chat_proc::start` 하나이고, 그것을 부르는 곳은 [`super::spawn`] 하나, 그것은 [`super::start_ready`] 에서만 · 그것은 op
/// `chat_tile_send` · 되감기 **미리 보기** 갈래 · 검토 · 목표 **정하기 · 이어 하기** 갈래에서만 부른다(되감기 실행 · 속도 · MCP 상태 · 목표 멈춤 · 지우기는 띄우지 않는다).
#[test]
fn chat_tile_spawns_only_from_the_send_op() {
    let src = src();
    let launch = launch_src();
    assert_eq!(src.matches("chat_proc::start(").count(), 1);
    assert!(body_of(&src, "fn spawn(").contains("chat_proc::start(chat, st, proc, l)"));
    assert_eq!(src.matches("spawn(chat, &mut st)").count(), 1, "띄우기를 부르는 곳은 하나");
    assert!(body_of(&src, "fn start_ready<").contains("spawn(chat, &mut st)?"));
    assert_eq!(src.matches("start_ready(&chat, st)?").count(), 4, "start_ready 를 부르는 곳은 넷");
    assert!(body_of(&src, "fn op_send(").contains("let mut st = start_ready(&chat, st)?;"));
    assert!(body_of(&src, "fn op_review(").contains("let mut st = start_ready(&chat, st)?;"));
    let goal = body_of(&src, "fn op_goal(");
    assert_eq!(goal.matches("start_ready(").count(), 1);
    assert!(goal.contains("let starts = matches!(action, GoalAction::Set { .. } | GoalAction::Resume);"));
    assert!(goal.contains("} else if starts {\n        start_ready(&chat, st)?\n    } else {\n        return Err(fail(\"not-started\""), "정하기 · 이어 하기 갈래 안");
    for f in ["fn op_set_tier(", "fn op_mcp_status(", "fn op_interrupt(", "fn goal_action<"] {
        assert!(!body_of(&src, f).contains("spawn(") && !body_of(&src, f).contains("start_ready("), "{f}");
    }
    let rewind = body_of(&src, "fn op_rewind(");
    assert_eq!(rewind.matches("start_ready(").count(), 1);
    // 미리 보기 갈래 안 — `if !b.dry_run { … } else if !st.core.has_proc() { start_ready }`
    let branch = &rewind[rewind.find("} else if !st.core.has_proc() {").expect("미리 보기 갈래")..];
    assert!(branch[..branch.find("\n    }").unwrap()].contains("st = start_ready(&chat, st)?;"));
    assert!(rewind.find("if !b.dry_run {").unwrap() < rewind.find("start_ready(").unwrap());
    assert!(src.contains("\"chat_tile_send\" => op_send(body(b)?)"));
    for f in ["fn op_open(", "fn op_subscribe(", "fn close(", "fn expire(", "fn op_compact(", "fn on_event(", "fn shape("] {
        assert!(!body_of(&src, f).contains("spawn(") && !body_of(&src, f).contains("start_ready("), "{f}");
    }
    for (name, s) in [("mod.rs", &src), ("launch.rs", &launch)] {
        for bad in ["spawn_in_job", "std::process::Command", "Command::new", "spawn_shell", "spawn_program", "Stdin::Pipe"] {
            assert!(!s.contains(bad), "{name}: {bad}");
        }
    }
    assert!(!launch.contains("chat_proc::start("), "실행 재료는 띄우지 않는다");
    // 어댑터는 fork 를 스스로 막지 않는다 — 인자 검사(`tile_argv`)가 어댑터를 짓기 앞이다.
    let prep = body_of(&launch, "pub(super) fn prepare(");
    for (argv, adapter) in [("claude::tile_argv(&o)", "claude::Claude::tile(&o)"), ("codex::tile_argv(&o)", "codex::Codex::tile(&o)")] {
        let a = prep.find(argv).unwrap_or_else(|| panic!("{argv}"));
        let b = prep.find(adapter).unwrap_or_else(|| panic!("{adapter}"));
        assert!(a < b, "{argv} 가 {adapter} 보다 먼저");
    }
    for bad in ["claude::argv(", "producer_argv(", "codex::argv(", "Claude::new(", "Codex::new("] {
        assert!(!launch.contains(bad), "채팅 타일은 제한 인자 · 사이드 채팅 어댑터를 쓰지 않는다: {bad}");
    }
}

/// stdin 에는 사람 글 · 사람 결정 · 사람 제어만 — 줄을 짓는 곳은 사람 op 일곱이고, 서버가 권한 요청에 대신 답하는 길은 없다.
/// 세션 op `write`(PTY)를 부르지 않고 MCP · 오케스트레이션 · 메신저 다리는 이 표를 모른다.
#[test]
fn chat_tile_stdin_only_human() {
    let src = src();
    let launch = launch_src();
    assert_eq!(src.matches(".encode_user(").count(), 1);
    let send = body_of(&src, "fn op_send(");
    assert!(send.contains(".encode_user(&text, &images, Some(&b.client_id))"));
    // 글은 사람 글 + 서버가 다시 본 첨부 경로 꼬리 하나에서만 선다 · 그림은 서버가 다시 본 것만
    assert_eq!(send.matches("let text = ").count(), 1);
    assert!(send.contains("let text = super::side_chat::with_file_refs(&b.text, &files);"));
    assert!(send.contains("let images = super::side_chat::chat_images(&b.images, cli == Cli::Claude).map_err(as_tile)?;"));
    assert!(send.contains("let files = super::side_chat::files_checked(&b.files).map_err(as_tile)?;"));
    assert_eq!(src.matches(".encode_decision(").count(), 1, "결정은 사람 op 하나");
    assert!(body_of(&src, "fn op_decide(").contains(".encode_decision(&b.request_id, decision, b.message.as_deref())"));
    assert!(body_of(&src, "fn op_decide(").contains(".encode_tile_answer(&b.request_id, answer)"));
    for (enc, f) in [
        (".encode_set_model(", "fn op_set_model("),
        (".encode_set_effort(", "fn op_set_effort("),
        (".encode_interrupt(", "fn op_interrupt("),
        (".encode_set_perm_mode(", "fn op_set_perm_mode("),
        (".encode_tile_answer(", "fn op_decide("),
        (".encode_compact(", "fn op_compact("),
        (".encode_tile_skills(", "fn op_send("),
        (".encode_rewind(", "fn op_rewind("),
        (".encode_review(", "fn op_review("),
        (".encode_set_tier(", "fn op_set_tier("),
        (".encode_mcp_status(", "fn op_mcp_status("),
    ] {
        assert_eq!(src.matches(enc).count(), 1, "{enc}");
        assert!(body_of(&src, f).contains(enc), "{f}");
    }
    // 목표 줄은 사람 op 둘에서만 — 목표 op 와 [중지] 의 멈춤(active 일 때)
    assert_eq!(src.matches(".encode_goal(").count(), 2);
    assert!(body_of(&src, "fn op_goal(").contains("a.encode_goal(&action)"));
    let stop = body_of(&src, "fn op_interrupt(");
    assert!(stop.contains("a.encode_goal(&GoalAction::Pause)"));
    assert!(stop.find(".encode_interrupt(").unwrap() < stop.find(".encode_goal(").unwrap());
    assert!(stop.contains("let goal_active = st.cli == Cli::Codex && st.goal.as_ref().is_some_and(|g| g.status == \"active\");"));
    // `origin:"user"` 을 싣는 글자는 Codex 어댑터의 `encode_goal` 몸 안에만
    let codex = lf(include_str!("../../side_chat/codex.rs"));
    let codex_code = codex.split("\n#[cfg(test)]").next().unwrap();
    let enc_goal = body_of(codex_code, "    fn encode_goal(");
    let enc_goal = &enc_goal[..enc_goal.find("\n    }").unwrap()];
    assert_eq!(codex_code.matches("\"origin\": \"user\"").count(), 4);
    assert_eq!(enc_goal.matches("\"origin\": \"user\"").count(), 4);
    assert!(!codex_code.contains("\"origin\":\"user\"") && !src.contains("origin"));
    // 스킬은 이름만 · 그다음 사람 글 — 스킬 항목은 그 글과 같은 줄에만 든다
    assert!(send.contains("a.encode_tile_skills(&b.skills)"));
    assert!(send.find(".encode_tile_skills(").unwrap() < send.find(".encode_user(").unwrap());
    assert!(body_of(&src, "fn op_compact(").contains(".encode_compact(instructions.as_deref())"));
    assert!(body_of(&src, "fn op_rewind(").contains(".encode_rewind(&b.anchor, scope, b.dry_run, last_seen.as_deref())"));
    assert_eq!(src.matches("chat_proc::apply(").count(), 12, "사람의 op 열하나 + [중지] 의 목표 멈춤");
    for f in [
        "fn op_send(",
        "fn op_interrupt(",
        "fn op_set_model(",
        "fn op_set_effort(",
        "fn op_set_perm_mode(",
        "fn op_decide(",
        "fn op_compact(",
        "fn op_rewind(",
        "fn op_review(",
        "fn op_goal(",
        "fn op_mcp_status(",
    ] {
        assert_eq!(body_of(&src, f).matches("chat_proc::apply(&*chat, &mut st, step)").count(), 1, "{f}");
    }
    assert_eq!(body_of(&src, "fn op_interrupt(").matches("chat_proc::apply(&*chat, &mut st, pause)").count(), 1);
    assert!(!body_of(&src, "fn op_set_tier(").contains("chat_proc::apply("), "속도는 stdin 없음");
    for f in ["fn on_event(", "fn shape("] {
        assert!(!body_of(&src, f).contains(".encode_"), "{f}: 사건을 받고 stdin 에 쓰지 않는다");
    }
    // 다시 띄울 때의 `--permission-mode` 값은 서버 표의 `perm_mode` 하나에서만
    assert_eq!(launch.matches("perm_mode: st.perm_mode.as_deref(),").count(), 2);
    assert_eq!(code_of(&launch).matches("perm_mode").count(), 4, "그 두 줄 밖에는 없다");
    for (name, s) in [("mod.rs", code_of(&src)), ("launch.rs", code_of(&launch))] {
        for bad in ["answer_by", "perm::", "guard::", "PermissionAuto", "policy_answer", "input_target", "\"write\"", "server::sessions", "super::sessions", "session_core", "chat_proc::push("] {
            assert!(!s.contains(bad), "{name}: {bad}");
        }
    }
    assert!(!launch.contains(".encode_"));
    for dir in ["src/mcp", "src/orchestration", "src/server/messenger_bridge"] {
        for (name, s) in sources_under(dir).into_iter().filter(|(n, _)| !n.contains("tests")) {
            let code = code_of(s.split("mod tests {").next().unwrap_or(""));
            assert!(!code.contains("chat_tile::") && !code.contains("\"chat_tile_"), "{name} 가 채팅 타일 표 · op 를 안다");
        }
    }
    for f in ["src/mcp.rs", "src/orchestration.rs", "src/server/messenger_bridge.rs", "src/server/orchestration_proxy.rs"] {
        let code = code_of(&std::fs::read_to_string(f).unwrap());
        assert!(!code.contains("chat_tile::") && !code.contains("\"chat_tile_"), "{f}");
    }
    use super::super::ipc::{frame, Grade};
    assert_eq!(frame::required_grade("chat_tile_decide"), Some(Grade::Write), "승인 등급 프레임이 아니다");
}

/// 환경은 헤드리스 턴 · 사이드 채팅과 같은 공용 정화 한 번 — AYNX 신호 · 권한 결정 토큰 · 스트림 표지 없음. 사용자 추가 인자 · 폴더 신뢰 판정 ·
/// 사용자 CLI 설정 쓰기 없음.
#[test]
fn chat_tile_env_uses_tile_scrub() {
    let src = src();
    let launch = launch_src();
    let prep = body_of(&launch, "pub(super) fn prepare(");
    assert_eq!(launch.matches("turn::headless_env(").count(), 1);
    assert!(prep.contains("let env = turn::headless_env(std::env::vars(), &add);"));
    assert!(!src.contains("headless_env("));
    for (name, s) in [("mod.rs", &src), ("launch.rs", &launch)] {
        for bad in [
            "env_clear",
            "set_var",
            "STREAM_ENV",
            "AYNX_STREAM",
            "PERMISSION_TOKEN_ENV",
            "SIGNAL_TOKEN_ENV",
            "AYNX_PERMISSION",
            "AYNX_SIGNAL",
            "agent_extra_args",
            "agent_args::",
            "hasTrustDialogAccepted",
            "trust_level",
            ".claude.json",
            "config.toml",
            "codex_mcp_names",
            "--setting-sources",
            "--allowedTools",
            "--permission-mode",
            "dangerously",
        ] {
            assert!(!s.contains(bad), "{name}: {bad}");
        }
    }
    // Codex 의 PATH 거르기 · 데몬 인자는 사이드 채팅과 같다.
    assert!(prep.contains("crate::codex_launch::apply_tile_path(&mut add, launch.as_ref());"));
    assert!(prep.contains("a.extend(crate::codex_launch::codex_extra_args(launch.as_ref()));"));
}

/// 토큰 값이 닿는 곳은 실행 재료 둘(Claude 임시 `--mcp-config` 본문 · Codex 환경)뿐 — GUI 껍데기는 토큰 표를 모르고, 스냅숏 · 목록 · 사건 ·
/// 로그에 없고, 토큰을 든 구조는 `Debug` 를 파생하지 않는다. (값이 실제로 새지 않는지는 가짜 CLI 통합이 본다.)
#[test]
fn chat_tile_token_never_reaches_frontend() {
    let src = src();
    let launch = launch_src();
    assert!(!proxy_src().contains("chat_token"), "chat_tile_proxy.rs 가 채팅 토큰 표를 안다");
    assert_eq!(launch.matches("m.token").count(), 2, "토큰 값을 쓰는 곳은 둘");
    assert!(launch.contains("claude::mcp_config(m.name, &m.url, &m.token)"));
    assert!(launch.contains("add.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), m.token.clone()));"));
    assert_eq!(launch.matches("chat_token::issue_tile(").count(), 1);
    assert!(body_of(&launch, "fn chat_mcp(").contains("crate::chat_token::issue_tile(id, proc)"));
    assert!(!src.contains("issue_tile(") && !src.contains(".token"));
    // 맥락 사용량의 토큰 수 칸(`preTokens` · `postTokens`)은 자격 증명이 아니다 — 그 낱말만 빼고 본다
    let counts = |s: &str| s.replace("preTokens", "").replace("postTokens", "").replace("pre_tokens", "").replace("post_tokens", "").to_ascii_lowercase();
    for f in ["fn snapshot(", "fn list(", "fn emit("] {
        assert!(!counts(body_of(&src, f)).contains("token"), "{f} 에 토큰");
    }
    for (name, s) in [("mod.rs", &src), ("launch.rs", &launch)] {
        for line in s.lines().filter(|l| l.contains("log::line(") || l.contains("hub::emit(") || l.contains("json!({")) {
            assert!(!counts(line).contains("token"), "{name}: {line}");
        }
    }
    let at = launch.find("struct ChatMcp").unwrap();
    let before = &launch[..at];
    let head: Vec<&str> = before.lines().rev().take(2).collect();
    assert!(head.iter().all(|l| !l.contains("derive(")), "ChatMcp 에 derive");
    // 끝 정리는 토큰 먼저 — on_ending 은 그 세대의 토큰만(장부는 항목 수명) · 표에서 빼는 닫기의 순서는
    // `chat_tile_links_for_the_entry_lifetime` 이 본다.
    let ending = body_of(&src, "fn on_ending(");
    assert!(ending.contains("crate::chat_token::revoke(&self.id, proc);"));
    assert!(!ending.contains("release_stream"), "프로세스 끝은 장부를 놓지 않는다");
}

/// 외부 MCP 목록은 프런트가 못 끼운다 — op 몸에 서버 · 명령 · URL · 환경 칸이 없고, 띄울 때의 목록은 저장된 설정 하나(`agent_mcp::chat_tile_servers`).
#[test]
fn chat_tile_ops_take_no_server_list() {
    let src = src();
    let launch = launch_src();
    let mut bodies = Vec::new();
    for (at, _) in src.match_indices("\nstruct ").chain(src.match_indices("\nenum ")) {
        let rest = &src[at + 1..];
        let name = rest.split_whitespace().nth(1).unwrap_or("");
        if name.ends_with("Body") {
            bodies.push(&rest[..rest.find("\n}").unwrap()]);
        }
    }
    assert!(bodies.len() >= 9, "op 몸을 다 찾았다: {}", bodies.len());
    for b in &bodies {
        for bad in ["McpServer", "mcp_servers", "servers", "command", "url", "headers", "env", "args"] {
            assert!(!b.contains(bad), "op 몸에 {bad}: {b}");
        }
    }
    assert_eq!(launch.matches("agent_mcp::chat_tile_servers(").count(), 1, "설정을 읽는 곳은 하나");
    assert!(body_of(&launch, "fn picked_servers(").contains("crate::agent_mcp::chat_tile_servers(agent, Some(cwd))"));
    assert!(!src.contains("agent_mcp::"));
    let proxy = proxy_src();
    for bad in ["McpServer", "mcp_servers", "agent_mcp"] {
        assert!(!proxy.contains(bad), "GUI 프록시가 {bad} 를 싣는다");
    }
}

// ---------------------------------------------------------------------------
// op 판정(프로세스 없음)
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("aynx-chattile-{tag}-{}-{}", std::process::id(), crate::token::generate_token().unwrap()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn slash(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn new_id(n: u32) -> String {
    format!("ct-0000{n:04x}-1111-4222-8333-{:012x}", std::process::id())
}

fn reason(r: Result<Value, super::super::ipc::WireError>) -> String {
    match r {
        Ok(v) => panic!("실패가 아님: {v}"),
        Err(e) => {
            assert!(e.code == super::CHAT_TILE || e.code == code::BAD_BODY, "{}", e.code);
            e.message
        }
    }
}

/// 가짜 Claude 대화 파일 하나(`<루트>/<폴더>/<id>.jsonl` — cwd 를 기록) · 10분 전에 쓰인 것으로.
fn claude_conversation(root: &Path, id: &str, cwd: &Path) {
    let dir = root.join("proj-dir");
    std::fs::create_dir_all(&dir).unwrap();
    let cwd = cwd.to_string_lossy();
    let lines = [
        json!({ "type": "user", "cwd": cwd, "sessionId": id, "timestamp": "2026-10-23T01:00:00.000Z",
                "message": { "role": "user", "content": "tile question" }, "origin": { "kind": "human" } }),
        json!({ "type": "assistant", "cwd": cwd, "timestamp": "2026-10-23T01:00:05.000Z",
                "message": { "model": "claude-haiku", "content": [] } }),
    ];
    let body: String = lines.iter().map(|v| v.to_string() + "\n").collect();
    let path = dir.join(format!("{id}.jsonl"));
    std::fs::write(&path, body).unwrap();
    let f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(600)).unwrap();
}

fn fake_no_cli(root: &Path, conv_root: &Path) {
    super::set_fake_for_test(Some(FakeCli {
        exe: "no-such-cli.exe".into(),
        args: Vec::new(),
        env: Vec::new(),
        root: root.to_path_buf(),
        mcp_port: None,
        conv_roots: vec![("claude", conv_root.to_path_buf())],
        servers: Vec::new(),
    }));
}

fn linked(chat: &str) -> bool {
    crate::agent_state::conversation_links().iter().any(|r| r.streams.iter().any(|s| s == chat))
}

fn listed(chat: &str) -> bool {
    handle("chat_tile_list", json!({}), 0).unwrap().as_array().unwrap().iter().any(|r| r["chat"] == chat)
}

fn open(chat: &str, mode: Value, window: Value) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_open", json!({ "chat": chat, "cli": "claude", "model": "", "effort": "", "mode": mode, "window": window }), 0)
}

/// 다른 스트림(터미널 타일 · 다른 채팅 타일)이 장부에 link 한 대화는 `[conversation-busy]` · 자기 `ct-` 만 link 한 대화는 통과 · 표에 이미 있는 같은
/// 대화는 판정하지 않는다 · 틀린 id · 색인에 없는 대화는 거절.
#[test]
fn chat_tile_resume_refuses_open_conversation() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("resume");
    let conv_root = root.join("convs");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    let conv = format!("2b2b2b2b-0000-4000-8000-{:012x}", std::process::id());
    claude_conversation(&conv_root, &conv, &cwd);
    fake_no_cli(&root, &conv_root);
    super::set_enabled_for_test(Some(true));
    let chat = new_id(1);
    let other = format!("s-other-{}", std::process::id());
    let resume = json!({ "kind": "resume", "conv": conv });

    crate::agent_state::link_stream("claude", &conv, &other);
    assert!(reason(open(&chat, resume.clone(), json!("main"))).contains("[conversation-busy]"));
    assert!(!listed(&chat), "거절이면 표에 세우지 않는다");
    crate::agent_state::release_stream("claude", &conv, &other);
    // 서버가 다시 뜬 뒤 같은 잎이 다시 세울 때 — 자기 link 는 판정에서 뺀다
    crate::agent_state::link_stream("claude", &conv, &chat);
    let snap = open(&chat, resume.clone(), json!("main")).unwrap();
    assert!(linked(&chat), "resume 으로 세운 항목은 보내기 전부터 장부에 있다");
    assert_eq!(snap["conversationId"], conv.as_str());
    assert_eq!(snap["cwd"], slash(&cwd).as_str(), "cwd 는 대화 색인의 기록된 폴더");
    assert_eq!((snap["epoch"].as_u64(), snap["status"].as_str()), (Some(0), Some("stopped")));
    // 표에 이미 있는 같은 대화 — 다른 곳이 열었어도 판정 · 색인 읽기를 건너뛰고 그 항목을 돌려준다
    crate::agent_state::link_stream("claude", &conv, &other);
    assert_eq!(open(&chat, resume.clone(), json!(null)).unwrap()["conversationId"], conv.as_str());
    crate::agent_state::release_stream("claude", &conv, &other);
    crate::agent_state::release_stream("claude", &conv, &chat);

    assert!(reason(open(&new_id(2), json!({ "kind": "resume", "conv": "not-a-uuid" }), json!("main"))).contains("[bad-conversation]"));
    let missing = json!({ "kind": "resume", "conv": "3c3c3c3c-0000-4000-8000-000000000003" });
    assert!(reason(open(&new_id(2), missing, json!("main"))).contains("[conversation-not-found]"));
    assert!(handle("chat_tile_close", json!({ "chat": chat }), 0).unwrap() == json!(true));
    super::set_enabled_for_test(None);
    super::set_fake_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// fresh 폴더는 이 PC 의 있는 절대 폴더만(상대 · UNC · 없음 · 파일 → `[bad-cwd]` · `null` = 홈) · 설정을 끄면 새 fresh 만 `[chat-tile-off]`(resume ·
/// 있던 항목은 통과) · id 판정 순서 · 사이드 채팅 표는 `ct-` 를 받지 않는다 · fork 는 몸 오류 · 새 항목은 떼어 둔 채 선다.
#[test]
fn chat_tile_open_checks_cwd_and_setting() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("open");
    let conv_root = root.join("convs");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    let file = root.join("a-file.txt");
    std::fs::write(&file, b"x").unwrap();
    let conv = format!("4d4d4d4d-0000-4000-8000-{:012x}", std::process::id());
    claude_conversation(&conv_root, &conv, &cwd);
    fake_no_cli(&root, &conv_root);
    super::set_enabled_for_test(Some(true));
    let fresh = |p: Value| json!({ "kind": "fresh", "cwd": p });
    let a = new_id(10);

    for bad in [json!("work"), json!(r"\\server\share"), json!("//server/share"), json!(slash(&root.join("none"))), json!(slash(&file)), json!("")] {
        assert!(reason(open(&a, fresh(bad.clone()), json!("main"))).contains("[bad-cwd]"), "{bad}");
    }
    let home = open(&a, fresh(json!(null)), json!("main")).unwrap();
    assert!(!home["cwd"].as_str().unwrap().contains('\\') && Path::new(home["cwd"].as_str().unwrap()).is_dir(), "null = 홈");
    assert!(handle("chat_tile_close", json!({ "chat": a }), 0).unwrap() == json!(true));
    let snap = open(&a, fresh(json!(cwd.to_string_lossy())), json!("main")).unwrap();
    assert_eq!(snap["cwd"], slash(&cwd).as_str(), "서버가 `/` 로 적는다");
    for k in ["window", "home", "subs", "token"] {
        assert!(snap.get(k).is_none(), "스냅숏에 {k}");
    }
    let row = handle("chat_tile_list", json!({}), 0).unwrap();
    let row = row.as_array().unwrap().iter().find(|r| r["chat"] == a.as_str()).unwrap().clone();
    assert_eq!((row["detached"].as_bool(), row["subs"].as_u64()), (Some(true), Some(0)), "새 항목은 첫 구독 전까지 떼어 둔다");
    assert!(row.get("window").is_none() && row.get("home").is_none());

    // 설정 끔 — 새 fresh 만 거절
    super::set_enabled_for_test(Some(false));
    assert!(reason(open(&new_id(11), fresh(json!(cwd.to_string_lossy())), json!("main"))).contains("[chat-tile-off]"));
    assert!(open(&a, fresh(json!(cwd.to_string_lossy())), json!("main")).is_ok(), "있던 항목은 계속");
    let r = new_id(12);
    assert!(open(&r, json!({ "kind": "resume", "conv": conv }), json!("main")).is_ok(), "resume 은 거절하지 않는다");
    super::set_enabled_for_test(Some(true));

    // id · 몸 판정
    assert!(reason(open("pc-abc", fresh(json!(null)), json!("main"))).contains("[wrong-chat-kind]"));
    assert!(reason(open("sc0001", fresh(json!(null)), json!("main"))).contains("[wrong-chat-kind]"));
    assert!(reason(open("../x", fresh(json!(null)), json!("main"))).contains("[bad-chat]"));
    assert!(reason(handle("chat_tile_close", json!({ "chat": "pc-abc" }), 0)).contains("[wrong-chat-kind]"));
    assert_eq!(handle("chat_tile_close", json!({ "chat": new_id(13) }), 0).unwrap(), json!(false), "없던 항목");
    let gone = handle("chat_tile_send", json!({ "chat": new_id(13), "epoch": 0, "text": "x", "clientId": "c1" }), 0);
    assert!(reason(gone).contains("[session-gone]"));
    assert!(reason(handle("chat_tile_subscribe", json!({ "chat": new_id(13), "window": "main" }), 0)).contains("[session-gone]"));
    let fork = handle("chat_tile_open", json!({ "chat": new_id(14), "cli": "claude", "model": "", "mode": { "kind": "fork", "from": conv } }), 0);
    assert_eq!(fork.unwrap_err().code, code::BAD_BODY);
    let badcli = handle("chat_tile_open", json!({ "chat": new_id(14), "cli": "gemini", "model": "", "mode": fresh(json!(null)) }), 0);
    assert!(reason(badcli).contains("[bad-cli]"));
    let badm = handle("chat_tile_open", json!({ "chat": new_id(14), "cli": "claude", "model": "x --dangerously", "mode": fresh(json!(null)) }), 0);
    assert!(reason(badm).contains("[bad-model]"));
    for (text, id) in [("  ", "c1"), ("x", ""), ("x", &"c".repeat(65)[..])] {
        let r = handle("chat_tile_send", json!({ "chat": a, "epoch": 0, "text": text, "clientId": id }), 0);
        assert!(reason(r).contains("[bad-text]"), "{text:?} {id:?}");
    }
    assert!(reason(handle("chat_tile_send", json!({ "chat": a, "epoch": 7, "text": "x", "clientId": "c1" }), 0)).contains("[stale-chat]"));
    assert!(reason(handle("chat_tile_decide", json!({ "chat": a, "epoch": 0, "requestId": "r", "decision": "maybe" }), 0)).contains("[bad-decision]"));
    assert!(reason(handle("chat_tile_decide", json!({ "chat": a, "epoch": 0, "requestId": "r", "decision": "allow" }), 0)).contains("[unknown-request]"));
    // 프로세스가 없으면 표만 고친다(다음 띄우기가 쓴다)
    assert_eq!(handle("chat_tile_set_model", json!({ "chat": a, "epoch": 0, "model": "sonnet" }), 0).unwrap(), json!(false));
    assert_eq!(handle("chat_tile_set_effort", json!({ "chat": a, "epoch": 0, "effort": "high" }), 0).unwrap(), json!(false));
    assert_eq!(handle("chat_tile_interrupt", json!({ "chat": a, "epoch": 0 }), 0).unwrap(), json!(false));
    let snap = handle("chat_tile_attach", json!({ "chat": a }), 0).unwrap();
    assert_eq!((snap["model"].as_str(), snap["effort"].as_str()), (Some("sonnet"), Some("high")));
    assert!(reason(handle("chat_tile_set_effort", json!({ "chat": a, "epoch": 0, "effort": "x y" }), 0)).contains("[bad-effort]"));
    // 사이드 채팅 표는 채팅 타일 id 를 받지 않는다
    let side = super::super::side_chat::handle(
        "side_chat_open",
        json!({ "chat": a, "cli": "claude", "model": "", "mode": { "kind": "fresh" }, "window": "main" }),
        0,
    );
    assert!(side.unwrap_err().message.contains("[wrong-chat-kind]"));

    for id in [&a, &r] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_enabled_for_test(None);
    super::set_fake_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 장부의 열림 = 항목 수명 — resume 으로 세우면 보내기 전에도 link · fresh 는 없음 · 닫기 · TTL 이 걷으면 놓음 · 다시 세우면 다시 link.
/// 프로세스 끝(`on_ending`)은 놓지 않고, 표에서 빼는 곳은 토큰 → 장부 → 프로세스 순서다.
#[test]
fn chat_tile_links_for_the_entry_lifetime() {
    let src = src();
    assert!(!body_of(&src, "fn on_ending(").contains("release_stream"));
    for f in ["fn close(", "pub(crate) fn close_all(", "fn expire(", "fn op_open("] {
        let b = body_of(&src, f);
        let forget = b.find("crate::chat_token::forget(").unwrap_or_else(|| panic!("{f}: forget"));
        let unlink = b.find("unlink(").unwrap_or_else(|| panic!("{f}: unlink"));
        let kill = b.find(".kill(\"closed\")").unwrap_or_else(|| panic!("{f}: kill"));
        assert!(forget < unlink && unlink < kill, "{f}");
    }
    assert_eq!(src.matches("release_stream(").count(), 2, "놓는 곳은 relink 와 unlink 뿐");

    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("ledger");
    let conv_root = root.join("convs");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    let conv = format!("5e5e5e5e-0000-4000-8000-{:012x}", std::process::id());
    claude_conversation(&conv_root, &conv, &cwd);
    fake_no_cli(&root, &conv_root);
    super::set_enabled_for_test(Some(true));
    let (chat, fresh) = (new_id(20), new_id(21));
    let resume = json!({ "kind": "resume", "conv": conv.to_ascii_uppercase() });

    open(&chat, resume.clone(), json!("main")).unwrap();
    let rows = crate::agent_state::conversation_links();
    let row = crate::agent_state::convo::row_of(&rows, "claude", &conv).expect("장부 행");
    assert!(row.streams.contains(&chat), "보내기 전에도 열림");
    open(&fresh, json!({ "kind": "fresh", "cwd": slash(&cwd) }), json!("main")).unwrap();
    assert!(!linked(&fresh), "fresh 는 대화가 없다");
    assert_eq!(handle("chat_tile_close", json!({ "chat": chat }), 0).unwrap(), json!(true));
    assert!(!linked(&chat), "닫기 = 놓기");
    open(&chat, resume, json!("main")).unwrap();
    assert!(linked(&chat), "다시 세우면 다시 link");

    super::set_detach_ttl_for_test(Some(std::time::Duration::from_millis(100)));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while listed(&chat) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    super::set_detach_ttl_for_test(None);
    assert!(!listed(&chat) && !listed(&fresh), "TTL 이 걷었다");
    assert!(!linked(&chat), "TTL 이 걷으면 놓는다");
    super::set_enabled_for_test(None);
    super::set_fake_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 사이드 채팅 ↔ 채팅 타일 — 장부가 아니라 두 표를 맞대 서로 거절한다. 거절이면 표에 세우지 않는다 · 사이드 채팅의 fork 는 원본에 쓰지 않아 통과.
#[test]
fn chat_tile_and_side_chat_refuse_each_other() {
    use super::super::side_chat;
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("mutual");
    let conv_root = root.join("convs");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    let conv = format!("6f6f6f6f-0000-4000-8000-{:012x}", std::process::id());
    claude_conversation(&conv_root, &conv, &cwd);
    fake_no_cli(&root, &conv_root);
    side_chat::set_fake_for_test(Some(side_chat::FakeCli {
        exe: "no-such-cli.exe".into(),
        args: Vec::new(),
        env: Vec::new(),
        root: root.join("sidechat"),
        mcp_port: None,
        conv_roots: vec![("claude", conv_root.clone())],
    }));
    super::set_enabled_for_test(Some(true));
    let (a, b) = (new_id(40), new_id(41));
    let pid = std::process::id();
    let (sc, fk) = (format!("sc-mutual-{pid}"), format!("sc-mutual-fork-{pid}"));
    let resume = json!({ "kind": "resume", "conv": conv });
    let side_open = |id: &str, mode: Value| {
        side_chat::handle("side_chat_open", json!({ "chat": id, "cli": "claude", "model": "", "mode": mode, "window": "main" }), 0)
    };
    let side_listed = |id: &str| side_chat::handle("side_chat_list", json!({}), 0).unwrap().as_array().unwrap().iter().any(|r| r["chat"] == id);
    let side_resume = json!({ "kind": "resume", "conv": conv.to_ascii_uppercase(), "project": false });

    open(&a, resume.clone(), json!("main")).unwrap();
    let e = side_open(&sc, side_resume.clone()).unwrap_err();
    assert!(e.message.contains("[conversation-in-chat-tile]"), "{}", e.message);
    assert!(!side_listed(&sc), "거절이면 표에 세우지 않는다");
    assert!(side_open(&fk, json!({ "kind": "fork", "from": conv })).is_ok(), "fork 는 원본에 쓰지 않는다");
    assert_eq!(side_chat::handle("side_chat_close", json!({ "chat": fk }), 0).unwrap(), json!(true));

    assert_eq!(handle("chat_tile_close", json!({ "chat": a }), 0).unwrap(), json!(true));
    side_open(&sc, side_resume.clone()).unwrap();
    assert!(side_open(&sc, side_resume).is_ok(), "그 대화를 쥔 사이드 채팅의 다시 붙기");
    assert!(reason(open(&b, resume.clone(), json!("main"))).contains("[conversation-in-side-chat]"));
    assert!(!listed(&b), "거절이면 표에 세우지 않는다");
    assert!(!linked(&b));

    assert_eq!(side_chat::handle("side_chat_close", json!({ "chat": sc }), 0).unwrap(), json!(true));
    open(&b, resume, json!("main")).unwrap();
    assert_eq!(handle("chat_tile_close", json!({ "chat": b }), 0).unwrap(), json!(true));
    side_chat::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    super::set_fake_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 첨부 판정 — 개수 · 빈 글은 표 앞에서 · 경로는 띄우기 전에 서버가 다시 본다(첨부 자리 밖은 거절 · 프로세스 없음). 이유 낱말은 사이드 채팅 그대로.
#[test]
fn chat_tile_send_checks_attachments_before_the_table() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("attach");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    let outside = root.join("secret.txt");
    std::fs::write(&outside, b"x").unwrap();
    let shot = root.join("shot.png");
    std::fs::write(&shot, [0x89, b'P', b'N', b'G']).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let send = |chat: &str, text: &str, images: Vec<String>, files: Vec<String>| {
        handle("chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": text, "clientId": "c1", "images": images, "files": files }), 0)
    };
    let gone = new_id(50);
    let p = slash(&outside);

    let nine = (0..9).map(|_| p.clone()).collect::<Vec<_>>();
    assert!(reason(send(&gone, "x", nine[..5].to_vec(), nine[5..].to_vec())).contains("[too-many-attachments]"), "표 앞");
    assert!(reason(send(&gone, " ", Vec::new(), Vec::new())).contains("[bad-text]"));
    let one = reason(send(&gone, "", Vec::new(), vec![p.clone()]));
    assert!(!one.contains("[bad-text]") && one.contains("[session-gone]"), "{one}");

    let a = new_id(51);
    open(&a, json!({ "kind": "fresh", "cwd": slash(&cwd) }), json!("main")).unwrap();
    assert!(reason(send(&a, "봐 줘", Vec::new(), vec![p.clone()])).contains("[file-outside]"));
    assert!(reason(send(&a, "", vec![slash(&shot)], Vec::new())).contains("[image-outside]"));
    let snap = handle("chat_tile_attach", json!({ "chat": a }), 0).unwrap();
    assert_eq!((snap["epoch"].as_u64(), snap["status"].as_str()), (Some(0), Some("stopped")), "띄우기 전에 거절");
    assert!(!root.join(".run").exists());
    assert_eq!(std::fs::read_dir(&cwd).unwrap().count(), 0, "cwd 에 아무것도 쓰지 않는다");
    handle("chat_tile_close", json!({ "chat": a }), 0).unwrap();
    super::set_enabled_for_test(None);
    super::set_fake_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 첨부는 사본을 두지 않는다 — 사이드 채팅의 판정(`chat_images` · `files_checked`)과 경로 꼬리(`with_file_refs`)만 부르고, 옮기는 길 · 쓰는 길이 없다.
#[test]
fn chat_tile_attachments_never_write_the_cwd() {
    let src = src();
    let send = body_of(&src, "fn op_send(");
    for want in ["side_chat::files_checked(", "side_chat::chat_images(", "with_file_refs("] {
        assert!(send.contains(want), "{want}");
    }
    let code = code_of(&src);
    for bad in ["files_in(", "chat_files(", "create_dir", "fs::write", "fs::copy", "OpenOptions"] {
        assert!(!send.contains(bad), "op_send: {bad}");
        assert!(!code.contains(bad), "mod.rs: {bad}");
    }
}

/// 채팅 타일은 메신저 다리의 대상이 아니다 — 다리가 읽는 `agent_state` 표(신호 · 띄우며 적은 연결)에 `ct-` 를 싣지 않는다. 장부 행에만 있다.
#[test]
fn chat_tile_is_not_a_bridge_target() {
    for (name, s) in sources_under("src/server/chat_tile").into_iter().filter(|(n, _)| !n.ends_with("tests.rs")) {
        let code = code_of(&s);
        for bad in ["agent_state::record", "agent_state::note_launch", "messenger_bridge", "tile_permission"] {
            assert!(!code.contains(bad), "{name}: {bad}");
        }
    }
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("bridge");
    let conv_root = root.join("convs");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    let conv = format!("7a7a7a7a-0000-4000-8000-{:012x}", std::process::id());
    claude_conversation(&conv_root, &conv, &cwd);
    fake_no_cli(&root, &conv_root);
    let chat = new_id(60);
    open(&chat, json!({ "kind": "resume", "conv": conv }), json!("main")).unwrap();
    assert!(linked(&chat));
    assert!(!crate::agent_state::snapshot().iter().any(|(s, _)| s.starts_with(super::ID_PREFIX)), "신호 표에 채팅 타일");
    handle("chat_tile_close", json!({ "chat": chat }), 0).unwrap();
    super::set_fake_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

// ---------------------------------------------------------------------------
// 가짜 CLI 통합 — 서버 · 파이프
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod live {
    use super::super::super::ipc::frame::{self, code};
    use super::super::super::ipc::{BoxStream, Frame, Grade};
    use super::super::super::tests::live::{config, connect_retry, err_code, hello, ok_body, test_pipe, SESSION_STATE};
    use super::super::super::tests_side_chat::{CWD_LOG_ENV, FAKE_ENV, FAKE_TEST, REWIND_MARK_ENV, STDIN_LOG_ENV};
    use super::super::super::{os, serve};
    use super::super::{FakeCli, EVENT};
    use super::{linked, new_id, scratch, slash};
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::time::Duration;

    fn fake(root: &std::path::Path, env: Vec<(String, String)>, mcp_port: Option<u16>) {
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        let mut env = env;
        env.push((FAKE_ENV.into(), "1".into()));
        super::super::set_fake_for_test(Some(FakeCli {
            exe,
            args: [FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env,
            root: root.to_path_buf(),
            mcp_port,
            conv_roots: Vec::new(),
            servers: Vec::new(),
        }));
        super::super::set_enabled_for_test(Some(true));
    }

    struct Client {
        s: BoxStream,
        evs: VecDeque<Value>,
        id: u64,
    }

    impl Client {
        async fn connect(pipe: &str) -> Client {
            let (s, _) = connect_retry(pipe).await;
            let mut c = Client { s, evs: VecDeque::new(), id: 0 };
            ok_body(c.call(Grade::Read, "hello", hello(7, frame::PROTOCOL_MAX)).await);
            c
        }

        async fn read(&mut self) -> Frame {
            tokio::time::timeout(Duration::from_secs(30), frame::read_frame(&mut self.s))
                .await
                .expect("30초 안에 프레임이 없다")
                .unwrap()
                .expect("연결이 닫혔다")
        }

        async fn call(&mut self, kind: Grade, op: &str, body: Value) -> Frame {
            self.id += 1;
            frame::write_frame(&mut self.s, &Frame::Request { id: self.id, kind, op: op.into(), body }).await.unwrap();
            loop {
                match self.read().await {
                    Frame::Event { name, body, .. } => {
                        if name == EVENT {
                            self.evs.push_back(body);
                        }
                    }
                    f => return f,
                }
            }
        }

        async fn ok(&mut self, kind: Grade, op: &str, body: Value) -> Value {
            ok_body(self.call(kind, op, body).await)
        }

        async fn err(&mut self, kind: Grade, op: &str, body: Value) -> String {
            match self.call(kind, op, body).await {
                Frame::Response { ok: false, error: Some(e), .. } => e.message,
                other => panic!("실패가 아님: {other:?}"),
            }
        }

        /// 다른 항목의 사건은 버리지 않고 줄에 되돌린다.
        async fn until(&mut self, chat: &str, stop: impl Fn(&Value) -> bool) -> Vec<Value> {
            let mut got = Vec::new();
            let mut others = Vec::new();
            loop {
                let body = match self.evs.pop_front() {
                    Some(b) => b,
                    None => match self.read().await {
                        Frame::Event { name, body, .. } if name == EVENT => body,
                        _ => continue,
                    },
                };
                if body["chat"] != chat {
                    others.push(body);
                    continue;
                }
                let done = stop(&body["ev"]);
                got.push(body);
                if done {
                    for o in others.into_iter().rev() {
                        self.evs.push_front(o);
                    }
                    return got;
                }
            }
        }

        async fn rows(&mut self) -> Vec<Value> {
            self.ok(Grade::Read, "chat_tile_list", json!({})).await.as_array().unwrap().clone()
        }

        async fn row(&mut self, chat: &str) -> Option<Value> {
            self.rows().await.into_iter().find(|r| r["chat"] == chat)
        }
    }

    fn t(ev: &Value) -> &str {
        ev["t"].as_str().unwrap_or("")
    }

    fn kinds(evs: &[Value]) -> Vec<String> {
        evs.iter().map(|e| t(&e["ev"]).to_string()).collect()
    }

    /// 사건 번호는 항목마다 빈틈 없이 1씩 · 세대 그대로 · 몸의 구독은 그 `(창, subGen)` 하나.
    fn check_run(evs: &[Value], last_seq: &mut u64, epoch: u64, window: &str, gen: u64) {
        for e in evs {
            let seq = e["seq"].as_u64().unwrap();
            assert_eq!(seq, *last_seq + 1, "빈틈: {e}");
            *last_seq = seq;
            assert_eq!(e["epoch"], epoch, "{e}");
            let subs = e["subs"].as_array().unwrap();
            assert_eq!(subs.len(), 1, "{e}");
            assert_eq!((subs[0]["window"].as_str(), subs[0]["subGen"].as_u64()), (Some(window), Some(gen)), "{e}");
            assert!(subs[0]["conn"].is_u64());
        }
    }

    fn open_body(chat: &str, cwd: &std::path::Path, window: Value) -> Value {
        json!({ "chat": chat, "cli": "claude", "model": "", "mode": { "kind": "fresh", "cwd": slash(cwd) }, "window": window })
    }

    /// open → subscribe → send(띄움) → 흐름 · 권한 카드 · 사람의 허용 · 옛 세대 거절 · 끊기 · 모델/강도 → close → `[session-gone]`. 실행 인자 ·
    /// cwd · stdin 의 사람 글 · 토큰(임시 `--mcp-config` 에만 · 닫으면 401) · 장부 link → 닫기에 release. 진짜 CLI 없음.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_fake_cli_roundtrip() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("round");
        let tile = root.join("tile");
        std::fs::create_dir_all(&tile).unwrap();
        let cwd_log = root.join("cwd.txt");
        let stdin_log = root.join("stdin.txt");
        fake(
            &root,
            vec![
                (CWD_LOG_ENV.into(), cwd_log.to_string_lossy().into_owned()),
                (STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned()),
            ],
            Some(1),
        );
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(100);

        // ── 열기 = 뜻만 ──
        assert_eq!(err_code(a.call(Grade::Read, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await), code::GRADE_MISMATCH);
        let snap = a.ok(Grade::Write, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await;
        assert_eq!((snap["epoch"].as_u64(), snap["status"].as_str(), snap["seq"].as_u64()), (Some(0), Some("stopped"), Some(0)));
        assert!(!root.join(".run").exists(), "열기는 아무것도 띄우지 않는다");
        let status = a.ok(Grade::Read, "status", json!({})).await;
        assert_eq!(status["chatTiles"], 1);

        // ── 구독 ──
        let sub = a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let g1 = sub["subGen"].as_u64().unwrap();
        assert_eq!(sub["snapshot"]["chat"], chat.as_str());
        let row = a.row(&chat).await.unwrap();
        assert_eq!((row["subs"].as_u64(), row["detached"].as_bool()), (Some(1), Some(false)));

        // ── 첫 보내기 = 띄우기 → 글 턴 ──
        let mut seq = 0u64;
        let r = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await;
        let e1 = r["epoch"].as_u64().unwrap();
        assert!(e1 > 0);
        let evs = a.until(&chat, |e| t(e) == "turnEnded").await;
        check_run(&evs, &mut seq, e1, "main", g1);
        // 가짜 `initialize` · `system/init` 이 알린 CLI 모드(`default`)는 걸러 본다 — 고른 적이 없으니 `chosen` 없음
        let modes: Vec<&Value> = evs.iter().filter(|e| t(&e["ev"]) == "cliMode").map(|e| &e["ev"]).collect();
        assert_eq!(modes, [&json!({ "t": "cliMode", "mode": "default", "choices": ["default", "acceptEdits", "plan"] })]);
        assert_eq!(evs.iter().filter(|e| t(&e["ev"]) == "rewindCaps").map(|e| &e["ev"]).collect::<Vec<_>>(), [&json!({ "t": "rewindCaps", "files": true, "conversation": true })]);
        let evs: Vec<Value> = evs.into_iter().filter(|e| t(&e["ev"]) != "cliMode" && t(&e["ev"]) != "rewindCaps").collect();
        let k = kinds(&evs);
        assert_eq!(&k[..3], ["ready", "turnStarted", "userAccepted"], "{k:?}");
        assert_eq!((evs[2]["ev"]["clientId"].as_str(), evs[2]["ev"]["text"].as_str()), (Some("c1"), Some("hello")));
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!((&snap["cliMode"]["mode"], &snap["permMode"]), (&json!("default"), &Value::Null));
        assert!(k.contains(&"textDelta".to_string()), "{k:?}");
        assert!(!k.iter().any(|x| x == "permissionAuto" || x == "permPolicy"));
        // 실행 인자 = 채팅 타일 고정 배열(제한 인자 없음) · cwd = 타일 폴더
        let argv = super::super::argv_for_test();
        for want in ["-p", "--permission-prompt-tool", "stdio", "--mcp-config", "--session-id"] {
            assert!(argv.iter().any(|a| a == want), "{want}: {argv:?}");
        }
        for bad in ["--setting-sources", "--settings", "--strict-mcp-config", "--tools", "--allowedTools", "--permission-mode", "--model"] {
            assert!(!argv.iter().any(|a| a == bad), "{bad}: {argv:?}");
        }
        assert!(!argv.iter().any(|a| a.contains("dangerously")));
        let ran = std::fs::read_to_string(&cwd_log).unwrap();
        assert_eq!(std::fs::canonicalize(&ran).ok(), std::fs::canonicalize(&tile).ok(), "타일 폴더에서 돈다");
        // 토큰 — 그 프로세스의 임시 `--mcp-config` 에만 · 살아 있는 동안 MCP 가 받는다
        let file = &argv[argv.iter().position(|a| a == "--mcp-config").unwrap() + 1];
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        let name = crate::instance::mcp_name(crate::instance::DEV);
        let bearer = cfg["mcpServers"][name]["headers"]["Authorization"].as_str().unwrap().to_string();
        let token = bearer.trim_start_matches("Bearer ").to_string();
        assert!(token.len() > 16);
        assert!(matches!(
            crate::chat_token::authenticate(Some(&bearer)),
            Some(crate::chat_token::Auth::Chat { kind: crate::chat_token::ChatKind::Tile, .. })
        ));
        for v in [&evs.iter().map(|e| e.to_string()).collect::<String>(), &a.rows().await.iter().map(|r| r.to_string()).collect::<String>()] {
            assert!(!v.contains(&token), "사건 · 목록에 토큰");
        }
        // 장부 — 턴이 선 뒤 이 채팅 id 로 link
        assert!(linked(&chat), "대화 장부에 link");

        // ── 옛 세대 ──
        assert!(a.err(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "x", "clientId": "c9" })).await.contains("[stale-chat]"));

        // ── 권한 카드 → 사람의 허용 ──
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "fetch it", "clientId": "c2" })).await;
        let evs = a.until(&chat, |e| t(e) == "permission").await;
        check_run(&evs, &mut seq, e1, "main", g1);
        let perm = evs.last().unwrap()["ev"].clone();
        let req = perm["requestId"].as_str().unwrap().to_string();
        assert_eq!(perm["toolName"], "WebFetch");
        assert!(perm["input"].is_object(), "채팅 타일 권한 카드는 도구 입력을 싣는다: {perm}");
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!(snap["status"], "running");
        assert_eq!(snap["pending"][0]["requestId"], req.as_str());
        assert!(!snap.to_string().contains(&token), "스냅숏에 토큰");
        let decide = |id: &str, d: &str, ep: u64| json!({ "chat": chat, "epoch": ep, "requestId": id, "decision": d });
        assert!(a.err(Grade::Write, "chat_tile_decide", decide("nope", "allow", e1)).await.contains("[unknown-request]"));
        assert!(a.err(Grade::Write, "chat_tile_decide", decide(&req, "allow", e1 + 1000)).await.contains("[stale-chat]"));
        assert_eq!(a.ok(Grade::Write, "chat_tile_decide", decide(&req, "allow", e1)).await, true);
        assert!(a.err(Grade::Write, "chat_tile_decide", decide(&req, "deny", e1)).await.contains("[unknown-request]"), "둘째 결정");
        let evs = a.until(&chat, |e| t(e) == "turnEnded").await;
        check_run(&evs, &mut seq, e1, "main", g1);
        let resolved = evs.iter().find(|e| t(&e["ev"]) == "permissionResolved").expect("결정 사건");
        assert_eq!((resolved["ev"]["by"].as_str(), resolved["ev"]["decision"].as_str()), (Some("human"), Some("allow")));

        // ── 끊기 · 모델 · 강도(산 프로세스에 곧바로 · 세대 그대로) ──
        assert_eq!(a.ok(Grade::Write, "chat_tile_interrupt", json!({ "chat": chat, "epoch": e1 })).await, false, "도는 턴이 없다");
        assert_eq!(a.ok(Grade::Write, "chat_tile_set_model", json!({ "chat": chat, "epoch": e1, "model": "sonnet" })).await, true);
        assert_eq!(a.ok(Grade::Write, "chat_tile_set_effort", json!({ "chat": chat, "epoch": e1, "effort": "high" })).await, true);
        assert_eq!(a.ok(Grade::Write, "chat_tile_set_effort", json!({ "chat": chat, "epoch": e1, "effort": null })).await, true);
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "long one", "clientId": "c3" })).await;
        a.until(&chat, |e| t(e) == "turnStarted").await;
        assert_eq!(a.ok(Grade::Write, "chat_tile_interrupt", json!({ "chat": chat, "epoch": e1 })).await, true);
        let evs = a.until(&chat, |e| t(e) == "turnEnded").await;
        assert_eq!(evs.last().unwrap()["ev"]["outcome"], "interrupted");

        // stdin 의 사람 글은 보낸 글 그대로(머리글 · 첨부 꼬리 없음)
        let said: Vec<String> = std::fs::read_to_string(&stdin_log)
            .unwrap()
            .lines()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|v| v["type"] == "user")
            .map(|v| v["message"]["content"].as_str().unwrap_or("").to_string())
            .collect();
        assert_eq!(said, ["hello", "fetch it", "long one"]);

        // ── 닫기 = 곧바로 · 토큰 먼저 · 장부 release ──
        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        assert!(crate::chat_token::authenticate(Some(&bearer)).is_none(), "닫으면 그 순간 토큰이 없다");
        let evs = a.until(&chat, |e| t(e) == "exited").await;
        assert_eq!(evs.last().unwrap()["ev"]["reason"], "closed");
        assert!(!linked(&chat), "닫기가 장부를 놓는다");
        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, false, "멱등");
        assert!(a.err(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await.contains("[session-gone]"));
        assert!(a.err(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "x", "clientId": "c4" })).await.contains("[session-gone]"));
        let left: Vec<_> = std::fs::read_dir(root.join(".run")).map(|d| d.flatten().collect()).unwrap_or_default();
        assert!(left.is_empty(), "임시 자리는 프로세스와 함께 지워졌다: {left:?}");

        // ── 서버 끝 = 남은 채팅 타일을 닫는다 ──
        a.ok(Grade::Write, "chat_tile_open", open_body(&new_id(101), &tile, json!("main"))).await;
        assert_eq!(super::super::live_count(), 1);
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        assert_eq!(super::super::live_count(), 0, "서버 끝에 채팅 타일이 남았다");
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 창 수명: 보조 창 파괴(`close_window`)는 책임 창인 항목만 닫는다(이관 중 `chatTiles` · 다른 책임 창 · 원격이 연 항목은 남고 구독만 걷힌다) ·
    /// `set_home` 뒤엔 옛 창 파괴에 남는다 · [모든 세션 종료] · 리로드(`detach_window{chatTileSubs}`) · 연결 끊김은 닫지 않고 TTL — 쉬는 항목은
    /// 닫히고, 도는 턴은 끝까지, 권한 대기는 TTL 에 닫힌다 · 구독 없이 열린 항목도 TTL 이 거둔다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_window_lifetime() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("life");
        let tile = root.join("tile");
        std::fs::create_dir_all(&tile).unwrap();
        fake(&root, Vec::new(), None);
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let sub = |a: &str, w: &str| json!({ "chat": a, "window": w });

        // ── 보조 창 파괴 ──
        let (d, e, f, n) = (new_id(200), new_id(201), new_id(202), new_id(203));
        a.ok(Grade::Write, "chat_tile_open", open_body(&d, &tile, json!("aux-1"))).await;
        a.ok(Grade::Write, "chat_tile_open", open_body(&e, &tile, json!("aux-1"))).await;
        a.ok(Grade::Write, "chat_tile_open", open_body(&f, &tile, json!("aux-2"))).await;
        a.ok(Grade::Write, "chat_tile_open", open_body(&n, &tile, json!(null))).await;
        let gf = a.ok(Grade::Write, "chat_tile_subscribe", sub(&f, "aux-1")).await["subGen"].as_u64().unwrap();
        a.ok(Grade::Write, "chat_tile_subscribe", sub(&n, "aux-1")).await;
        assert_eq!(a.row(&f).await.unwrap()["subs"], 1);
        let body = crate::server::proxy::close_body("aux-1", &[], &[], &[], &[], &[gf], std::slice::from_ref(&e));
        a.ok(Grade::Write, "close_window", body).await;
        assert!(a.row(&d).await.is_none(), "책임 창의 파괴 = 닫기");
        assert!(a.row(&e).await.is_some(), "이관 중인 것은 남는다");
        let rf = a.row(&f).await.unwrap();
        assert_eq!((rf["subs"].as_u64(), rf["detached"].as_bool()), (Some(0), Some(true)), "다른 책임 창 — 구독만 걷힌다");
        assert!(a.row(&n).await.is_some(), "원격 창이 연 항목(책임 창 없음)은 창 파괴로 닫히지 않는다");
        // 이관 — 받은 창이 책임 창 · 옛 창 파괴에 남고 새 창 파괴에 닫힌다
        a.ok(Grade::Write, "set_home", json!({ "window": "aux-3", "chatTiles": [e] })).await;
        a.ok(Grade::Write, "close_window", json!({ "window": "aux-1" })).await;
        assert!(a.row(&e).await.is_some());
        a.ok(Grade::Write, "close_window", json!({ "window": "aux-3" })).await;
        assert!(a.row(&e).await.is_none());
        // 다시 연 항목은 `window` 가 있을 때만 책임 창을 갈음한다
        a.ok(Grade::Write, "chat_tile_open", open_body(&f, &tile, json!(null))).await;
        a.ok(Grade::Write, "close_window", json!({ "window": "aux-2" })).await;
        assert!(a.row(&f).await.is_none());
        // [모든 세션 종료] — 채팅 타일도 닫는다(세션 수에는 넣지 않는다)
        assert_eq!(a.ok(Grade::Write, "close_all", json!({})).await, 0);
        assert_eq!(super::super::live_count(), 0);

        // ── 리로드 · TTL ──
        super::super::set_detach_ttl_for_test(Some(Duration::from_millis(300)));
        // 구독 없이 열린 항목
        let lone = new_id(204);
        a.ok(Grade::Write, "chat_tile_open", open_body(&lone, &tile, json!("main"))).await;
        // 쉬는 항목 · 권한 대기 · 도는 턴
        let (idle, waiting, running) = (new_id(205), new_id(206), new_id(207));
        let mut gens = Vec::new();
        let mut epochs = Vec::new();
        for c in [&idle, &waiting, &running] {
            a.ok(Grade::Write, "chat_tile_open", open_body(c, &tile, json!("main"))).await;
            gens.push(a.ok(Grade::Write, "chat_tile_subscribe", sub(c, "main")).await["subGen"].as_u64().unwrap());
            let ep = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": c, "epoch": 0, "text": "hi", "clientId": "c1" })).await["epoch"]
                .as_u64()
                .unwrap();
            a.until(c, |e| t(e) == "turnEnded").await;
            epochs.push(ep);
        }
        for (c, ep) in [(&waiting, epochs[1]), (&running, epochs[2])] {
            a.ok(Grade::Write, "chat_tile_send", json!({ "chat": c, "epoch": ep, "text": "fetch", "clientId": "c2" })).await;
        }
        a.until(&waiting, |e| t(e) == "permission").await;
        let req = a.until(&running, |e| t(e) == "permission").await.last().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        let ep_r = a.row(&running).await.unwrap()["epoch"].as_u64().unwrap();
        let ep_w = a.row(&waiting).await.unwrap()["epoch"].as_u64().unwrap();
        assert_ne!(ep_r, ep_w);
        a.ok(Grade::Write, "chat_tile_decide", json!({ "chat": running, "epoch": ep_r, "requestId": req, "decision": "allow" })).await;
        a.until(&running, |e| t(e) == "turnEnded").await;
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": running, "epoch": ep_r, "text": "long", "clientId": "c3" })).await;
        a.until(&running, |e| t(e) == "turnStarted").await;
        // 리로드 — 그 세대의 구독만 뗀다(닫지 않는다)
        let detach = crate::server::proxy::detach_body("main", crate::reap::Held::default(), &[], &gens);
        a.ok(Grade::Write, "detach_window", detach).await;
        for c in [&idle, &waiting, &running] {
            assert_eq!(a.row(c).await.unwrap()["detached"], true, "{c}");
        }
        let closed = a.until(&idle, |e| t(e) == "exited").await;
        assert_eq!(closed.last().unwrap()["ev"]["reason"], "closed", "쉬는 항목은 TTL 에 닫힌다");
        let closed = a.until(&waiting, |e| t(e) == "exited").await;
        let k = kinds(&closed);
        assert!(k.contains(&"permissionResolved".to_string()), "{k:?}");
        assert_eq!(closed.last().unwrap()["ev"]["reason"], "closed", "권한 대기는 TTL 에 닫힌다");
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(a.row(&lone).await.is_none(), "구독 없이 열린 항목도 TTL 이 거둔다");
        let rr = a.row(&running).await.expect("도는 턴은 끝까지");
        assert_eq!(rr["status"], "running");
        assert_eq!(a.ok(Grade::Write, "chat_tile_interrupt", json!({ "chat": running, "epoch": ep_r })).await, true);
        let closed = a.until(&running, |e| t(e) == "exited").await;
        assert!(kinds(&closed).contains(&"turnEnded".to_string()));
        assert_eq!(closed.last().unwrap()["ev"]["reason"], "closed", "턴이 끝나면 닫힌다");
        assert!(a.row(&running).await.is_none());

        // ── 연결 끊김 = 그 연결의 구독만 떼고 TTL ──
        super::super::set_detach_ttl_for_test(None);
        let mut b = Client::connect(&pipe).await;
        let k2 = new_id(208);
        b.ok(Grade::Write, "chat_tile_open", open_body(&k2, &tile, json!("main"))).await;
        b.ok(Grade::Write, "chat_tile_subscribe", sub(&k2, "main")).await;
        assert_eq!(a.row(&k2).await.unwrap()["detached"], false);
        drop(b);
        let mut kept = None;
        for _ in 0..50 {
            let r = a.row(&k2).await.unwrap();
            if r["detached"] == true {
                kept = Some(r);
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(kept.expect("연결이 끊기면 떼어 둔다")["subs"], 0);

        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        assert_eq!(super::super::live_count(), 0);
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 압축 op — 띄운 프로세스에만 사용자 줄 `/compact` 하나 · 턴 중이면 `[turn-running]` · Claude 의 스킬 몸은 `[unsupported]`(줄 없음).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_compact_live_with_fake_cli() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("compact");
        let tile = root.join("tile");
        std::fs::create_dir_all(&tile).unwrap();
        let stdin_log = root.join("stdin.txt");
        fake(&root, vec![(STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned())], None);
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(300);
        a.ok(Grade::Write, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await;
        a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let compact = |ep: u64, i: Value| json!({ "chat": chat, "epoch": ep, "instructions": i });
        assert!(a.err(Grade::Write, "chat_tile_compact", compact(0, Value::Null)).await.contains("[not-started]"));
        assert_eq!(err_code(a.call(Grade::Approve, "chat_tile_compact", compact(0, Value::Null)).await), code::APPROVE_REFUSED);
        let ep = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await["epoch"]
            .as_u64()
            .unwrap();
        a.until(&chat, |e| t(e) == "turnEnded").await;
        assert_eq!(a.ok(Grade::Write, "chat_tile_compact", compact(ep, json!("keep the auth notes"))).await, true);
        // 가짜 CLI 는 둘째 줄에 권한 요청을 낸 채 기다린다 — 그동안 턴이 돈다
        let evs = a.until(&chat, |e| t(e) == "permission").await;
        assert!(!kinds(&evs).contains(&"userAccepted".to_string()), "압축 op 의 줄은 말풍선이 없다: {:?}", kinds(&evs));
        assert!(a.err(Grade::Write, "chat_tile_compact", compact(ep, Value::Null)).await.contains("[turn-running]"));
        let skills = json!({ "chat": chat, "epoch": ep, "text": "$a x", "clientId": "c2", "skills": ["a"] });
        assert!(a.err(Grade::Write, "chat_tile_send", skills).await.contains("[unsupported]"));
        let said: Vec<String> = std::fs::read_to_string(&stdin_log)
            .unwrap()
            .lines()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|v| v["type"] == "user")
            .map(|v| v["message"]["content"].as_str().unwrap_or("").to_string())
            .collect();
        assert_eq!(said, ["hello", "/compact keep the auth notes"], "스킬이 거절된 보내기는 줄이 없다");
        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        a.until(&chat, |e| t(e) == "exited").await;
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 대화가 선 항목 · 프로세스 없음 → 미리 보기가 그 대화를 `--resume` 으로 띄운다(사람 글 줄 없음 · 답 `epoch` = 새 세대) · 실행은 띄우지 않는다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_rewind_preview_may_resume() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("rewind-resume");
        let tile = root.join("tile");
        let convs = root.join("convs");
        std::fs::create_dir_all(&tile).unwrap();
        let stdin_log = root.join("stdin.txt");
        fake(&root, vec![(STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned())], None);
        if let Some(f) = super::super::FAKE.lock().unwrap().as_mut() {
            f.conv_roots = vec![("claude", convs.clone())];
        }
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(510);
        a.ok(Grade::Write, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await;
        a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let e1 = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await["epoch"].as_u64().unwrap();
        a.until(&chat, |e| t(e) == "turnEnded").await;
        let conv = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["conversationId"].as_str().unwrap().to_string();
        super::claude_record(&convs, &conv, &tile, &[(super::U1, "hello")]);
        // 가짜 CLI 는 둘째 글의 권한 요청을 거절하면 끝난다
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "fetch", "clientId": "c2" })).await;
        let req = a.until(&chat, |e| t(e) == "permission").await.pop().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        a.ok(Grade::Write, "chat_tile_decide", json!({ "chat": chat, "epoch": e1, "requestId": req, "decision": "deny" })).await;
        a.until(&chat, |e| t(e) == "exited").await;
        let rw = |dry: bool| json!({ "chat": chat, "epoch": e1, "anchor": super::U1, "scope": "files", "dryRun": dry });
        super::super::note_argv_for_test(&[]);
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(false)).await.contains("[not-started]"));
        assert!(super::super::argv_for_test().is_empty());
        let before = stdin_lines(&stdin_log).len();
        let e2 = a.ok(Grade::Write, "chat_tile_rewind", rw(true)).await["epoch"].as_u64().unwrap();
        assert!(e2 > e1);
        let argv = super::super::argv_for_test();
        let at = argv.iter().position(|x| x == "--resume").expect("resume");
        assert_eq!(argv[at + 1], conv);
        let ev = a.until(&chat, |e| t(e) == "rewind").await.pop().unwrap();
        assert_eq!((ev["epoch"].as_u64(), ev["ev"]["phase"].as_str()), (Some(e2), Some("preview")));
        let new: Vec<Value> = stdin_lines(&stdin_log).into_iter().skip(before).collect();
        assert!(!new.iter().any(|v| v["type"] == "user"), "사람 글 없음: {new:?}");
        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        a.until(&chat, |e| t(e) == "exited").await;
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    fn stdin_lines(p: &std::path::Path) -> Vec<Value> {
        std::fs::read_to_string(p).unwrap_or_default().lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
    }

    /// 되감기 — 미리 보기(`can:true`) 뒤 같은 세대 · 기준점 · 범위만 실행 · 실행 뒤 · 다시 띄운 뒤 다시 미리 보기 · 대화 되감기마다 `rewindGen` ·
    /// 권한 카드가 떠 있거나 턴이 돌면 `[turn-running]`(CLI 는 그때도 되감는다) · 기준점 · 마지막 사람 말은 기록 파일에서 · 프로세스가 없으면 실행은
    /// `[not-started]` · 미리 보기는 같은 대화를 사람 글 없이 resume 으로 띄운다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_rewind_needs_preview() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("rewind");
        let tile = root.join("tile");
        let convs = root.join("convs");
        std::fs::create_dir_all(&tile).unwrap();
        let stdin_log = root.join("stdin.txt");
        fake(&root, vec![(STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned())], None);
        if let Some(f) = super::super::FAKE.lock().unwrap().as_mut() {
            f.conv_roots = vec![("claude", convs.clone())];
        }
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(500);
        let snap = a.ok(Grade::Write, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await;
        assert_eq!((&snap["rewind"], &snap["rewindGen"]), (&Value::Null, &json!(0)), "알린 적 없음");
        a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let rw = |ep: u64, anchor: &str, scope: &str, dry: bool| json!({ "chat": chat, "epoch": ep, "anchor": anchor, "scope": scope, "dryRun": dry });
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(0, super::U1, "files", true)).await.contains("[nothing-to-rewind]"));
        let e1 = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await["epoch"].as_u64().unwrap();
        a.until(&chat, |e| t(e) == "turnEnded").await;
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!(snap["rewind"], json!({ "files": true, "conversation": true }));
        let conv = snap["conversationId"].as_str().unwrap().to_string();
        super::claude_record(&convs, &conv, &tile, &[(super::U1, "hello"), (super::U2, "second")]);
        let (u1, u2) = (super::U1, super::U2);
        assert_eq!(err_code(a.call(Grade::Approve, "chat_tile_rewind", rw(e1, u1, "files", true)).await), code::APPROVE_REFUSED);

        // ── 미리 보기 없이 · 틀린 기준점 · 기록에 없는 줄 ──
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", false)).await.contains("[preview-first]"));
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, "x", "files", true)).await.contains("[bad-anchor]"));
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, "deadbeef-0000-4000-8000-000000000000", "files", true)).await.contains("[bad-anchor]"));
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, "all", true)).await.contains("[bad-scope]"));

        // ── 파일 — 미리 보기 → 다른 기준점 · 범위는 거절 → 같은 것만 실행 → 다시는 거절 ──
        assert_eq!(a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", true)).await["epoch"], e1);
        let ev = a.until(&chat, |e| t(e) == "rewind").await.pop().unwrap()["ev"].clone();
        assert_eq!((ev["phase"].as_str(), ev["can"].as_bool(), &ev["files"]), (Some("preview"), Some(true), &json!(["a.txt"])), "{ev}");
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert!(!snap["liveTurn"].to_string().contains("rewind"), "꼬리에 없다");
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u2, "files", false)).await.contains("[preview-first]"));
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, "both", false)).await.contains("[preview-first]"));
        a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", false)).await;
        let ev = a.until(&chat, |e| t(e) == "rewind").await.pop().unwrap()["ev"].clone();
        assert_eq!((ev["phase"].as_str(), ev["skippedLinks"].as_u64()), (Some("done"), Some(0)));
        assert_eq!(a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["rewindGen"], 0, "파일만 — 기록은 그대로");
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", false)).await.contains("[preview-first]"), "실행 뒤에는 다시 미리 보기");

        // ── 대화 · 둘 다 — 실행마다 rewindGen · 마지막 사람 말은 서버가 기록에서 ──
        a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "conversation", true)).await;
        let ev = a.until(&chat, |e| t(e) == "rewind").await.pop().unwrap()["ev"].clone();
        assert_eq!((ev["phase"].as_str(), ev["can"].as_bool(), &ev["turns"]), (Some("preview"), Some(true), &Value::Null));
        a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "conversation", false)).await;
        a.until(&chat, |e| t(e) == "rewind" && e["phase"] == "done").await;
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!((&snap["rewindGen"], &snap["context"]), (&json!(1), &Value::Null));
        a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "both", true)).await;
        a.until(&chat, |e| t(e) == "rewind").await;
        a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "both", false)).await;
        let ev = a.until(&chat, |e| t(e) == "rewind" && e["phase"] != "preview").await.pop().unwrap()["ev"].clone();
        assert_eq!((ev["phase"].as_str(), ev["scope"].as_str()), (Some("done"), Some("both")));
        assert_eq!(a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["rewindGen"], 2);
        let rewinds: Vec<Value> = stdin_lines(&stdin_log).into_iter().filter(|v| v["type"] == "control_request" && v["request"]["subtype"] != "initialize").map(|v| v["request"].clone()).collect();
        assert_eq!(
            rewinds,
            [
                json!({ "subtype": "rewind_files", "user_message_id": u1, "dry_run": true }),
                json!({ "subtype": "rewind_files", "user_message_id": u1 }),
                json!({ "subtype": "rewind_conversation", "target_message_uuid": u1, "last_seen_user_message_uuid": u2 }),
                json!({ "subtype": "rewind_files", "user_message_id": u1, "dry_run": true }),
                json!({ "subtype": "rewind_files", "user_message_id": u1 }),
                json!({ "subtype": "rewind_conversation", "target_message_uuid": u1, "last_seen_user_message_uuid": u2 }),
            ],
            "대화 미리 보기는 CLI 에 보내는 것이 없다"
        );

        // ── 권한 카드가 떠 있음 · 턴이 돎 → [turn-running] ──
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "fetch it", "clientId": "c2" })).await;
        let req = a.until(&chat, |e| t(e) == "permission").await.pop().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        for (scope, dry) in [("files", true), ("conversation", false), ("both", true)] {
            assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, scope, dry)).await.contains("[turn-running]"), "카드 대기: {scope}");
        }
        a.ok(Grade::Write, "chat_tile_decide", json!({ "chat": chat, "epoch": e1, "requestId": req, "decision": "allow" })).await;
        a.until(&chat, |e| t(e) == "turnEnded").await;
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "long one", "clientId": "c3" })).await;
        a.until(&chat, |e| t(e) == "turnStarted").await;
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", true)).await.contains("[turn-running]"));
        a.ok(Grade::Write, "chat_tile_interrupt", json!({ "chat": chat, "epoch": e1 })).await;
        a.until(&chat, |e| t(e) == "turnEnded").await;

        // ── 프로세스가 끝남 → 실행은 띄우지 않는다 · 미리 보기는 같은 대화를 resume ──
        a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", true)).await;
        a.until(&chat, |e| t(e) == "rewind").await;
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "die", "clientId": "c4" })).await;
        a.until(&chat, |e| t(e) == "exited").await;
        super::super::note_argv_for_test(&[]);
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", false)).await.contains("[not-started]"));
        assert!(super::super::argv_for_test().is_empty(), "실행은 띄우지 않는다");
        let before = stdin_lines(&stdin_log).len();
        let e2 = a.ok(Grade::Write, "chat_tile_rewind", rw(e1, u1, "files", true)).await["epoch"].as_u64().unwrap();
        assert!(e2 > e1, "미리 보기가 띄운 새 세대");
        let argv = super::super::argv_for_test();
        let at = argv.iter().position(|x| x == "--resume").expect("resume");
        assert_eq!(argv[at + 1], conv);
        assert!(!argv.iter().any(|x| x == "--session-id"));
        let ev = a.until(&chat, |e| t(e) == "rewind").await.pop().unwrap();
        assert_eq!((ev["epoch"].as_u64(), ev["ev"]["can"].as_bool()), (Some(e2), Some(true)));
        let new: Vec<Value> = stdin_lines(&stdin_log).into_iter().skip(before).collect();
        assert!(!new.iter().any(|v| v["type"] == "user"), "사람 글 없음: {new:?}");
        assert_eq!(new.iter().map(|v| v["request"]["subtype"].as_str().unwrap_or("")).collect::<Vec<_>>(), ["initialize", "rewind_files"]);
        // 다시 띄운 뒤에는 앞 세대의 미리 보기를 쓰지 않는다
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e2, "text": "b1", "clientId": "c5" })).await;
        a.until(&chat, |e| t(e) == "turnEnded").await;
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e2, "text": "b2", "clientId": "c6" })).await;
        let req = a.until(&chat, |e| t(e) == "permission").await.pop().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        a.ok(Grade::Write, "chat_tile_decide", json!({ "chat": chat, "epoch": e2, "requestId": req, "decision": "deny" })).await;
        a.until(&chat, |e| t(e) == "exited").await;
        let e3 = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e2, "text": "c1", "clientId": "c7" })).await["epoch"].as_u64().unwrap();
        a.until(&chat, |e| t(e) == "turnEnded").await;
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e3, u1, "files", false)).await.contains("[preview-first]"));
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(e2, u1, "files", true)).await.contains("[stale-chat]"));

        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        a.until(&chat, |e| t(e) == "exited").await;
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Claude 대화 되감기의 `done` 은 CLI 가 기록에 표지를 쓴 **뒤에** 닿는다(그때 `rewindGen` 도) · 표지가 오지 않으면 상한 뒤에 그래도 닿는다 ·
    /// 잡아 둔 동안 뒤 사건이 오면 그 앞에 번호 순서대로 낸다 · 그동안 CLI 에 더 보내는 줄은 없다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_rewind_done_waits_for_the_record_mark() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("rewind-mark");
        let tile = root.join("tile");
        let convs = root.join("convs");
        std::fs::create_dir_all(&tile).unwrap();
        std::fs::create_dir_all(&convs).unwrap();
        let stdin_log = root.join("stdin.txt");
        fake(
            &root,
            vec![(STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned()), (REWIND_MARK_ENV.into(), convs.to_string_lossy().into_owned())],
            None,
        );
        if let Some(f) = super::super::FAKE.lock().unwrap().as_mut() {
            f.conv_roots = vec![("claude", convs.clone())];
        }
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(520);
        a.ok(Grade::Write, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await;
        a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let e1 = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await["epoch"].as_u64().unwrap();
        a.until(&chat, |e| t(e) == "turnEnded").await;
        let conv = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["conversationId"].as_str().unwrap().to_string();
        let record = convs.join("proj-dir").join(format!("{conv}.jsonl"));
        let marked = || std::fs::read_to_string(&record).unwrap_or_default().contains("\"rewound\":true");
        let (u1, u2) = (super::U1, super::U2);
        let rw = |anchor: &str, dry: bool| json!({ "chat": chat, "epoch": e1, "anchor": anchor, "scope": "conversation", "dryRun": dry });
        let delay = |s: &str| std::fs::write(convs.join("mark-delay.txt"), s).unwrap();

        // ── 표지가 400ms 늦게 — done 은 표지 뒤 · 그때 rewindGen ──
        super::claude_record(&convs, &conv, &tile, &[(u1, "hello"), (u2, "second")]);
        delay("400");
        a.ok(Grade::Write, "chat_tile_rewind", rw(u2, true)).await;
        a.until(&chat, |e| t(e) == "rewind").await;
        let t0 = std::time::Instant::now();
        a.ok(Grade::Write, "chat_tile_rewind", rw(u2, false)).await;
        let done = a.until(&chat, |e| t(e) == "rewind" && e["phase"] != "preview").await.pop().unwrap();
        assert_eq!(done["ev"]["phase"], "done");
        assert!(marked(), "done 이 닿을 때 기록은 이미 잘려 있다");
        assert!(t0.elapsed() >= Duration::from_millis(350), "{:?}", t0.elapsed());
        assert!(t0.elapsed() < Duration::from_millis(1800), "표지를 보고 곧바로: {:?}", t0.elapsed());
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!((&snap["rewindGen"], snap["seq"].as_u64()), (&json!(1), done["seq"].as_u64()));

        // ── 표지가 오지 않음 — 상한 뒤에 그래도 done ──
        super::claude_record(&convs, &conv, &tile, &[(u1, "hello"), (u2, "second")]);
        delay("never");
        a.ok(Grade::Write, "chat_tile_rewind", rw(u2, true)).await;
        a.until(&chat, |e| t(e) == "rewind").await;
        let t0 = std::time::Instant::now();
        a.ok(Grade::Write, "chat_tile_rewind", rw(u2, false)).await;
        // 잡아 둔 동안 — 다음 되감기는 아직 받지 않고 붙는 창은 done 앞 번호 · 옛 rewindGen 을 본다
        tokio::time::sleep(Duration::from_millis(300)).await;
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!(snap["rewindGen"], 1, "잡아 둔 동안");
        assert!(a.err(Grade::Write, "chat_tile_rewind", rw(u1, true)).await.contains("[rewind-running]"));
        let done = a.until(&chat, |e| t(e) == "rewind" && e["phase"] != "preview").await.pop().unwrap();
        assert_eq!(done["ev"]["phase"], "done");
        assert_eq!(done["seq"].as_u64(), snap["seq"].as_u64().map(|s| s + 1), "붙은 창이 받을 다음 번호");
        assert!(!marked());
        assert!(t0.elapsed() >= Duration::from_millis(1900), "{:?}", t0.elapsed());
        assert_eq!(a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["rewindGen"], 2);

        // ── 잡아 둔 동안 턴이 섬 — done 이 먼저(번호 빈틈 없음) · 상한을 기다리지 않는다 ──
        super::claude_record(&convs, &conv, &tile, &[(u1, "hello"), (u2, "second")]);
        a.ok(Grade::Write, "chat_tile_rewind", rw(u2, true)).await;
        a.until(&chat, |e| t(e) == "rewind").await;
        let t0 = std::time::Instant::now();
        a.ok(Grade::Write, "chat_tile_rewind", rw(u2, false)).await;
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "fetch", "clientId": "c2" })).await;
        let evs = a.until(&chat, |e| t(e) == "permission").await;
        let at = |k: &str| evs.iter().position(|e| t(&e["ev"]) == k && (k != "rewind" || e["ev"]["phase"] == "done")).unwrap_or_else(|| panic!("{k}"));
        assert!(at("rewind") < at("turnStarted"));
        let seqs: Vec<u64> = evs.iter().map(|e| e["seq"].as_u64().unwrap()).collect();
        assert!(seqs.windows(2).all(|w| w[1] == w[0] + 1), "{seqs:?}");
        assert!(t0.elapsed() < Duration::from_millis(1800), "{:?}", t0.elapsed());
        let req = evs.last().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        a.ok(Grade::Write, "chat_tile_decide", json!({ "chat": chat, "epoch": e1, "requestId": req, "decision": "deny" })).await;
        a.until(&chat, |e| t(e) == "exited").await;
        let sent: Vec<String> = stdin_lines(&stdin_log).into_iter().filter(|v| v["type"] == "control_request").filter_map(|v| v["request"]["subtype"].as_str().map(str::to_string)).collect();
        assert_eq!(sent.iter().filter(|s| *s == "rewind_conversation").count(), 3, "실행 셋에 하나씩 — 서버가 더 보내지 않는다: {sent:?}");

        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    fn fake_tile(root: &std::path::Path, cli: &str, env: Vec<(String, String)>) {
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        let mut env = env;
        env.push((super::TILE_FAKE_ENV.into(), cli.into()));
        super::super::set_fake_for_test(Some(FakeCli {
            exe,
            args: [super::TILE_FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env,
            root: root.to_path_buf(),
            mcp_port: None,
            conv_roots: Vec::new(),
            servers: Vec::new(),
        }));
        super::super::set_enabled_for_test(Some(true));
    }

    /// 값 표지(`SECRET-S7-…`)가 사건 · 스냅숏 · 로그 어디에도 없다.
    fn no_secret(chat: &str, evs: &[Value], snap: &Value) {
        for e in evs {
            assert!(!e.to_string().contains("SECRET-S7"), "{e}");
        }
        assert!(!snap.to_string().contains("SECRET-S7"), "{snap}");
        let logs = super::super::super::log::CAPTURED.lock().unwrap().clone();
        for l in logs.iter().filter(|l| l.contains(chat)) {
            assert!(!l.contains("SECRET-S7") && !l.contains("OBJ-S7"), "{l}");
        }
    }

    /// Codex — 검토(띄움 · 두 턴 id · 끊기는 B · 표지 · 지시 글은 사람 말 아님) · 속도(첫 턴 몸 · 목록 밖 거절 · stdin 없음) · MCP 상태(사람의 읽기 ·
    /// 답을 기다리는 동안 `[mcp-status-busy]` · 표 · 값 없음) · 목표(정하기 → 사람 글 없는 턴 · [중지] = 끊기 + 멈춤 · 이어 하기 · 지우기 ·
    /// 프로세스 없으면 멈춤 · 지우기는 `[not-started]` · 이어 하기는 같은 대화를 띄움 · 다시 띄우면 MCP 줄은 `stale`).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_codex_review_goal_tier_mcp() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("codex7");
        let tile = root.join("tile");
        std::fs::create_dir_all(&tile).unwrap();
        let stdin_log = root.join("stdin.txt");
        fake_tile(&root, "codex", vec![(STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned())]);
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(700);
        let mut open = open_body(&chat, &tile, json!("main"));
        open["cli"] = json!("codex");
        open["tier"] = json!("priority");
        let snap = a.ok(Grade::Write, "chat_tile_open", open).await;
        assert_eq!((&snap["tier"], &snap["mcpStatus"], &snap["goal"], &snap["tiers"]), (&json!("priority"), &Value::Null, &Value::Null, &Value::Null));
        a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let ep = |e: u64| json!({ "chat": chat, "epoch": e });
        let goal = |e: u64, action: &str| json!({ "chat": chat, "epoch": e, "action": action });
        let sent = || stdin_lines(&stdin_log);
        let methods = |from: usize| sent().into_iter().skip(from).filter_map(|v| v["method"].as_str().map(str::to_string)).collect::<Vec<_>>();

        // ── 프로세스 없음 — 읽기 · 속도 · 멈춤은 띄우지 않는다 ──
        assert_eq!(a.ok(Grade::Write, "chat_tile_mcp_status", ep(0)).await, false);
        assert!(a.err(Grade::Write, "chat_tile_goal", goal(0, "pause")).await.contains("[no-goal]"));
        assert!(!stdin_log.exists(), "띄우지 않았다");

        // ── 검토 — 띄운다 · 같은 대화 안 · 턴 id 둘 ──
        let e1 = a.ok(Grade::Write, "chat_tile_review", json!({ "chat": chat, "epoch": 0, "target": { "type": "uncommittedChanges" } })).await["epoch"].as_u64().unwrap();
        assert!(e1 > 0);
        let evs = a.until(&chat, |e| t(e) == "turnEnded").await;
        let ks = kinds(&evs);
        assert!(!ks.iter().any(|k| k == "userAccepted"), "CLI 가 지은 지시 글은 사람 말이 아니다: {ks:?}");
        let started = evs.iter().find(|e| t(&e["ev"]) == "turnStarted").unwrap();
        let ended = evs.iter().find(|e| t(&e["ev"]) == "turnEnded").unwrap();
        assert_eq!((started["ev"]["turn"].as_str(), ended["ev"]["turn"].as_str()), (Some("rb1"), Some("rb1")));
        let reviews: Vec<&Value> = evs.iter().filter(|e| t(&e["ev"]) == "review").map(|e| &e["ev"]).collect();
        assert_eq!(reviews, [&json!({ "t": "review", "phase": "started", "label": "current changes", "text": null }), &json!({ "t": "review", "phase": "done", "label": "current changes", "text": null })]);
        assert!(ks.iter().position(|k| k == "turnStarted") < ks.iter().position(|k| k == "review"));
        let review = sent().into_iter().find(|v| v["method"] == "review/start").unwrap();
        assert_eq!(review["params"], json!({ "threadId": super::FAKE_THREAD, "target": { "type": "uncommittedChanges" }, "delivery": "inline" }));
        assert!(!sent().iter().any(|v| v["method"] == "turn/start"), "사람 글 없음");
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!(snap["tiers"], json!({ "byModel": { "gpt-x": [{ "id": "priority", "name": "Fast", "description": "2x speed" }] }, "thread": "default" }));
        let aynx = crate::instance::mcp_name(crate::instance::DEV);
        assert_eq!(snap["mcpStatus"]["servers"][0]["name"], aynx);
        assert_eq!((&snap["mcpStatus"]["servers"][0]["aynx"], &snap["mcpStatus"]["source"]), (&json!(true), &json!("startup")));
        no_secret(&chat, &evs, &snap);

        // ── 속도 — 첫 턴 몸에 · 목록 밖 거절 · 고르기는 stdin 없음 ──
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "hi", "clientId": "c1" })).await;
        a.until(&chat, |e| t(e) == "turnEnded").await;
        let turn = |n: usize| sent().into_iter().filter(|v| v["method"] == "turn/start").nth(n).unwrap()["params"].clone();
        assert_eq!(turn(0)["serviceTierForTurn"], "priority");
        let before = sent().len();
        assert!(a.err(Grade::Write, "chat_tile_set_tier", json!({ "chat": chat, "epoch": e1, "tier": "turbo" })).await.contains("[bad-tier]"));
        assert_eq!(a.ok(Grade::Write, "chat_tile_set_tier", json!({ "chat": chat, "epoch": e1, "tier": null })).await, true);
        assert_eq!(sent().len(), before, "stdin 없음");
        assert_eq!(a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["tier"], Value::Null);
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "hi", "clientId": "c2" })).await;
        a.until(&chat, |e| t(e) == "turnEnded").await;
        assert!(turn(1).get("serviceTierForTurn").is_none(), "CLI 기본 = 칸 없음");

        // ── MCP 상태 — 사람의 읽기 · 기다리는 동안 둘째는 거절 · 답 뒤 다시 ──
        assert_eq!(a.ok(Grade::Write, "chat_tile_mcp_status", ep(e1)).await, true);
        assert!(a.err(Grade::Write, "chat_tile_mcp_status", ep(e1)).await.contains("[mcp-status-busy]"));
        let evs = a.until(&chat, |e| t(e) == "mcpStatus" && e["source"] == "list").await;
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!(
            snap["mcpStatus"],
            json!({ "source": "list", "stale": false, "servers": [
                { "name": aynx, "state": "connected", "auth": "bearer", "tools": 2, "scope": "config", "aynx": true, "picked": false },
                { "name": "ext-one", "state": "unknown", "auth": "none", "tools": 0, "scope": "config", "aynx": false, "picked": false }] })
        );
        // 창에 내는 사건에도 스냅숏과 같은 표 둘 — 첫 풍선부터 "Aynx" 가 보인다
        assert_eq!(evs.last().unwrap()["ev"]["servers"], snap["mcpStatus"]["servers"], "사건 줄 = 스냅숏 줄(표 포함)");
        no_secret(&chat, &evs, &snap);
        let lists = sent().iter().filter(|v| v["method"] == "mcpServerStatus/list").count();
        assert_eq!(lists, 1, "기다리는 동안의 둘째는 보내지 않았다");
        assert_eq!(a.ok(Grade::Write, "chat_tile_mcp_status", ep(e1)).await, true, "답 뒤에는 다시");
        a.until(&chat, |e| t(e) == "mcpStatus" && e["source"] == "list").await;

        // ── 목표 — 정하기 → CLI 가 사람 글 없이 턴을 연다 · 턴 중 정하기 · 검토는 거절 · [중지] = 끊기 + 멈춤 ──
        let set = json!({ "chat": chat, "epoch": e1, "action": "set", "objective": "OBJ-S7 all tests pass", "tokenBudget": 500000 });
        assert_eq!(a.ok(Grade::Write, "chat_tile_goal", set.clone()).await["epoch"], e1);
        let evs = a.until(&chat, |e| t(e) == "turnStarted").await;
        let g = evs.iter().find(|e| t(&e["ev"]) == "goal").unwrap();
        assert_eq!((g["ev"]["goal"]["status"].as_str(), &g["ev"]["goal"]["auto"], &g["ev"]["goal"]["tokenBudget"]), (Some("active"), &json!(false), &json!(500000)));
        assert!(!kinds(&evs).contains(&"userAccepted".to_string()));
        assert!(a.err(Grade::Write, "chat_tile_goal", set.clone()).await.contains("[turn-running]"));
        assert!(a.err(Grade::Write, "chat_tile_review", json!({ "chat": chat, "epoch": e1, "target": { "type": "uncommittedChanges" } })).await.contains("[turn-running]"));
        let before = sent().len();
        assert_eq!(a.ok(Grade::Write, "chat_tile_interrupt", ep(e1)).await, true);
        let evs = a.until(&chat, |e| t(e) == "goal" && e["goal"]["status"] == "paused").await;
        assert!(kinds(&evs).contains(&"turnEnded".to_string()));
        let after: Vec<Value> = sent().into_iter().skip(before).collect();
        assert_eq!(after.iter().map(|v| v["method"].as_str().unwrap_or("")).collect::<Vec<_>>(), ["turn/interrupt", "thread/goal/set"]);
        assert_eq!(after[1]["params"], json!({ "threadId": super::FAKE_THREAD, "status": "paused", "origin": "user" }));
        // 멈춘 목표 · 쉬는 턴 — [중지] 는 아무것도 보내지 않는다
        let before = sent().len();
        assert_eq!(a.ok(Grade::Write, "chat_tile_interrupt", ep(e1)).await, false);
        assert_eq!(sent().len(), before);
        // 이어 하기 → 다시 사람 글 없는 턴 · [중지]
        a.ok(Grade::Write, "chat_tile_goal", goal(e1, "resume")).await;
        a.until(&chat, |e| t(e) == "turnStarted").await;
        a.ok(Grade::Write, "chat_tile_interrupt", ep(e1)).await;
        a.until(&chat, |e| t(e) == "goal" && e["goal"]["status"] == "paused").await;
        // 프로세스 끝 — 멈춤 · 지우기 · 읽기 · 속도는 띄우지 않는다 · 이어 하기는 같은 대화를 띄운다
        a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": e1, "text": "die", "clientId": "c3" })).await;
        a.until(&chat, |e| t(e) == "exited").await;
        for action in ["pause", "clear"] {
            assert!(a.err(Grade::Write, "chat_tile_goal", goal(e1, action)).await.contains("[not-started]"), "{action}");
        }
        assert_eq!(a.ok(Grade::Write, "chat_tile_mcp_status", ep(e1)).await, false);
        assert_eq!(a.ok(Grade::Write, "chat_tile_set_tier", json!({ "chat": chat, "epoch": e1, "tier": "priority" })).await, false);
        let before = sent().len();
        let e2 = a.ok(Grade::Write, "chat_tile_goal", goal(e1, "resume")).await["epoch"].as_u64().unwrap();
        assert!(e2 > e1, "이어 하기가 띄운 새 세대");
        assert!(super::super::argv_for_test().iter().all(|x| !x.contains("priority")));
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        assert_eq!(snap["mcpStatus"]["stale"], true, "새 프로세스는 아직 알리지 않았다");
        a.until(&chat, |e| t(e) == "turnStarted").await;
        let m = methods(before);
        assert!(m.contains(&"thread/resume".to_string()) && m.ends_with(&["thread/goal/set".to_string()]), "{m:?}");
        assert!(!m.contains(&"turn/start".to_string()), "사람 글 없음");
        a.ok(Grade::Write, "chat_tile_interrupt", ep(e2)).await;
        a.until(&chat, |e| t(e) == "goal" && e["goal"]["status"] == "paused").await;
        // 지우기
        a.ok(Grade::Write, "chat_tile_goal", goal(e2, "clear")).await;
        a.until(&chat, |e| t(e) == "goal" && e["goal"].is_null()).await;
        assert_eq!(a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await["goal"], Value::Null);
        let origins = sent().iter().filter(|v| v["params"]["origin"].is_string()).count();
        assert_eq!(origins, sent().iter().filter(|v| v["method"].as_str().is_some_and(|m| m.starts_with("thread/goal/"))).count(), "목표 줄은 모두 사람 op 의 것");
        assert!(!sent().iter().any(|v| v["method"] == "thread/goal/get"));
        no_secret(&chat, &[], &a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await);

        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        a.until(&chat, |e| t(e) == "exited").await;
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Claude — 사람이 연 MCP 상태 읽기(`mcp_status`) · 답의 `config` 에 든 머리글 · 명령 · 인자 · URL · 오류 글은 사건 · 스냅숏 · 로그에 없다 ·
    /// 턴의 `system/init` 줄도 받아 둔다 · 검토 · 목표 op 는 `[unsupported]`(`/code-review` · `/goal` 은 글로 간다).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chat_tile_claude_mcp_status() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("claude7");
        let tile = root.join("tile");
        std::fs::create_dir_all(&tile).unwrap();
        let stdin_log = root.join("stdin.txt");
        fake_tile(&root, "claude", vec![(STDIN_LOG_ENV.into(), stdin_log.to_string_lossy().into_owned())]);
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        super::super::close_all();
        let chat = new_id(710);
        a.ok(Grade::Write, "chat_tile_open", open_body(&chat, &tile, json!("main"))).await;
        a.ok(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": "main" })).await;
        let e1 = a.ok(Grade::Write, "chat_tile_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await["epoch"].as_u64().unwrap();
        let evs = a.until(&chat, |e| t(e) == "turnEnded").await;
        let init = evs.iter().find(|e| t(&e["ev"]) == "mcpStatus").unwrap();
        assert_eq!(init["ev"]["source"], "init");
        assert_eq!(a.ok(Grade::Write, "chat_tile_mcp_status", json!({ "chat": chat, "epoch": e1 })).await, true);
        let evs = a.until(&chat, |e| t(e) == "mcpStatus" && e["source"] == "list").await;
        let snap = a.ok(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await;
        let aynx = crate::instance::mcp_name(crate::instance::DEV);
        let servers = snap["mcpStatus"]["servers"].as_array().unwrap().clone();
        assert_eq!(servers.len(), 4);
        let me = servers.iter().find(|s| s["name"] == aynx).unwrap();
        assert_eq!((&me["aynx"], &me["state"], &me["scope"]), (&json!(true), &json!("failed"), &json!("app")));
        assert_eq!(servers[0], json!({ "name": "blender", "state": "connected", "auth": null, "tools": 2, "scope": "user", "aynx": false, "picked": false }));
        no_secret(&chat, &evs, &snap);
        let req = stdin_lines(&stdin_log).into_iter().filter(|v| v["request"]["subtype"] == "mcp_status").count();
        assert_eq!(req, 1);
        for (op, body) in [
            ("chat_tile_review", json!({ "chat": chat, "epoch": e1, "target": { "type": "uncommittedChanges" } })),
            ("chat_tile_goal", json!({ "chat": chat, "epoch": e1, "action": "set", "objective": "x", "tokenBudget": 500000 })),
        ] {
            assert!(a.err(Grade::Write, op, body).await.contains("[unsupported]"), "{op}");
        }
        assert_eq!(a.ok(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await, true);
        a.until(&chat, |e| t(e) == "exited").await;
        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        super::super::set_fake_for_test(None);
        super::super::set_enabled_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
use crate::side_chat::{Cli, Ev};

// ---------------------------------------------------------------------------
// 권한 모드 · 결정 넷
// ---------------------------------------------------------------------------

fn open_cli(chat: &str, cli: &str, cwd: &Path, perm: Value) -> Result<Value, super::super::ipc::WireError> {
    handle(
        "chat_tile_open",
        json!({ "chat": chat, "cli": cli, "model": "", "mode": { "kind": "fresh", "cwd": slash(cwd) }, "window": "main", "permMode": perm }),
        0,
    )
}

fn set_mode(chat: &str, epoch: u64, mode: &str) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_set_perm_mode", json!({ "chat": chat, "epoch": epoch, "mode": mode }), 0)
}

fn attach(chat: &str) -> Value {
    handle("chat_tile_attach", json!({ "chat": chat }), 0).unwrap()
}

/// 프로세스가 없으면 표에만(`false`) · 다음 띄우기의 인자에 그 값 · 고를 수 없는 값(bypass · 묻지 않기 · 전체 접근 · 알리지 않은 auto)은 `[bad-mode]` ·
/// 열기의 틀린 `permMode` 는 버리고 열린다 · `null` 은 서버가 쥔 값을 지우지 않는다.
#[test]
fn chat_tile_set_perm_mode_rules() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("permmode");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let a = new_id(200);
    let snap = open_cli(&a, "claude", &cwd, Value::Null).unwrap();
    assert_eq!((&snap["permMode"], &snap["cliMode"]), (&Value::Null, &Value::Null), "고른 적 없음 · 띄운 적 없음");
    assert_eq!(set_mode(&a, 0, "acceptEdits").unwrap(), json!(false), "표에만 적었다");
    assert_eq!(attach(&a)["permMode"], "acceptEdits");
    for bad in ["bypassPermissions", "dontAsk", "auto", "readOnly", "fullAccess", "a b", ""] {
        assert!(reason(set_mode(&a, 0, bad)).contains("[bad-mode]"), "{bad}");
    }
    assert_eq!(attach(&a)["permMode"], "acceptEdits", "거절은 값을 바꾸지 않는다");
    assert!(reason(set_mode(&a, 7, "plan")).contains("[stale-chat]"));
    assert!(reason(set_mode("pc-0001", 0, "plan")).contains("[wrong-chat-kind]"));
    assert!(reason(set_mode(&new_id(299), 0, "plan")).contains("[session-gone]"));
    // 다음 띄우기 — 가짜 CLI 가 없어 띄우기는 실패하지만 실행 인자는 그 전에 적힌다
    let _ = handle("chat_tile_send", json!({ "chat": a, "epoch": 0, "text": "hi", "clientId": "c1" }), 0);
    let argv = super::argv_for_test();
    let at = argv.iter().position(|x| x == "--permission-mode").unwrap_or_else(|| panic!("{argv:?}"));
    assert_eq!(argv[at + 1], "acceptEdits");
    // 열기 — 다시 세우는 명세의 값 · 틀린 값은 버린다 · null 은 지우지 않는다
    assert_eq!(open_cli(&a, "claude", &cwd, Value::Null).unwrap()["permMode"], "acceptEdits");
    assert_eq!(open_cli(&a, "claude", &cwd, json!("plan")).unwrap()["permMode"], "plan");
    assert_eq!(open_cli(&a, "claude", &cwd, json!("bypassPermissions")).unwrap()["permMode"], "plan");
    let b = new_id(201);
    for bad in ["bypassPermissions", "dontAsk", "auto", "readOnly", "x y"] {
        assert_eq!(open_cli(&b, "claude", &cwd, json!(bad)).unwrap()["permMode"], Value::Null, "{bad}");
    }
    assert!(open_cli(&b, "claude", &cwd, json!(3)).is_err(), "몸 꼴은 그대로 본다");
    // Codex — 칩 셋 · 계획은 CLI 가 알리기 전에는 받아 둔다
    let c = new_id(202);
    open_cli(&c, "codex", &cwd, json!("auto")).unwrap();
    assert_eq!(attach(&c)["permMode"], "auto");
    for bad in ["fullAccess", "dangerFullAccess", "never", "custom", "acceptEdits", "default"] {
        assert!(reason(set_mode(&c, 0, bad)).contains("[bad-mode]"), "{bad}");
    }
    assert_eq!(set_mode(&c, 0, "plan").unwrap(), json!(false));
    assert_eq!(open_cli(&new_id(203), "codex", &cwd, json!("acceptEdits")).unwrap()["permMode"], Value::Null);
    for id in [&a, &b, &c, &new_id(203)] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// CLI 가 옮긴 모드(계획 승인 · 제안 수락)는 사람이 고른 적이 있을 때만 따라간다 · 사건의 `chosen` = 서버가 다시 띄울 때 쓸 값 · 고를 수 없는 값은
/// 덮지 않는다 · 모드 제안의 늘 허용은 서버 자신의 대기 기록에서 읽는다.
#[test]
fn chat_tile_mode_tracks_cli_changes() {
    use super::super::chat_proc::{self, Host};
    use crate::side_chat::event::{PermKind, SessionAllow};
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("modetrack");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let mode_ev = |m: &str, choices: &[&str]| Ev::CliMode { mode: m.into(), choices: choices.iter().map(|s| s.to_string()).collect(), chosen: None };
    let base = ["default", "acceptEdits", "plan"];

    let a = new_id(210);
    open_cli(&a, "claude", &cwd, json!("plan")).unwrap();
    let chat = super::find(&a).unwrap();
    {
        let mut st = super::lock(&chat.st);
        let mut ev = mode_ev("default", &base);
        chat.shape(&mut st, &mut ev);
        assert_eq!(st.perm_mode.as_deref(), Some("default"), "계획 승인 뒤 CLI 가 옮긴 모드");
        assert!(matches!(&ev, Ev::CliMode { chosen: Some(c), .. } if c == "default"));
        let mut ev = mode_ev("bypassPermissions", &base);
        chat.shape(&mut st, &mut ev);
        assert_eq!(st.perm_mode.as_deref(), Some("default"), "고를 수 없는 값은 덮지 않는다");
        assert!(matches!(&ev, Ev::CliMode { chosen: Some(c), .. } if c == "default"));
        let mut ev = mode_ev("auto", &["default", "acceptEdits", "plan", "auto"]);
        chat.shape(&mut st, &mut ev);
        assert_eq!(st.perm_mode.as_deref(), Some("auto"), "CLI 가 알린 auto 는 따라간다");
    }
    let b = new_id(211);
    open_cli(&b, "claude", &cwd, Value::Null).unwrap();
    let chat_b = super::find(&b).unwrap();
    {
        let mut st = super::lock(&chat_b.st);
        let mut ev = mode_ev("acceptEdits", &base);
        chat_b.shape(&mut st, &mut ev);
        assert_eq!(st.perm_mode, None, "사용자 설정을 명세에 굳히지 않는다");
        assert!(matches!(&ev, Ev::CliMode { chosen: None, .. }));
        assert_eq!(serde_json::to_value(&ev).unwrap().get("chosen"), None);
        // 스냅숏의 cliMode 칸
        chat_proc::push(&*chat_b, &mut st, mode_ev("acceptEdits", &base));
    }
    let snap = attach(&b);
    assert_eq!((&snap["cliMode"], &snap["permMode"]), (&json!({ "mode": "acceptEdits", "choices": base }), &Value::Null));
    assert!(snap["liveTurn"].as_array().unwrap().is_empty(), "지금 턴 꼬리에 넣지 않는다");
    // 모드 제안의 늘 허용 — 서버가 대기 기록에서 읽고, 고를 수 있는 값일 때만
    {
        let mut st = super::lock(&chat_b.st);
        let perm = |id: &str, s: Option<SessionAllow>| Ev::Permission {
            request_id: id.into(),
            kind: PermKind::Tool,
            title: "Edit".into(),
            detail: String::new(),
            tool_name: "Edit".into(),
            input: None,
            session_allow: s,
        };
        chat_proc::push(&*chat_b, &mut st, perm("r1", Some(SessionAllow { kind: "mode", detail: "acceptEdits".into() })));
        chat_proc::push(&*chat_b, &mut st, perm("r2", Some(SessionAllow { kind: "rules", detail: "acceptEdits".into() })));
        chat_proc::push(&*chat_b, &mut st, perm("r3", Some(SessionAllow { kind: "mode", detail: "bypassPermissions".into() })));
        chat_proc::push(&*chat_b, &mut st, perm("r4", None));
        assert_eq!(super::session_mode(&st, "r1").as_deref(), Some("acceptEdits"));
        for id in ["r2", "r3", "r4", "nope"] {
            assert_eq!(super::session_mode(&st, id), None, "{id}");
        }
    }
    // 서버는 어댑터가 받아들인 뒤에만 모드를 적는다(거절이면 대기에 남고 값도 그대로)
    let src = src();
    let decide = body_of(&src, "fn op_decide(");
    let enc = decide.find(".map_err(|w| fail(w, \"the decision was not sent\"))?;").unwrap();
    assert!(decide.find("st.perm_mode = Some(m);").unwrap() > enc);
    let set = body_of(&src, "fn op_set_perm_mode(");
    assert!(set.find("st.perm_mode = Some(b.mode);\n    chat_proc::apply").unwrap() > set.find(".encode_set_perm_mode(&b.mode)").unwrap());
    for id in [&a, &b] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 결정 넷 — 표 앞에서 낱말 · 답 꼴을 본다(`remember` 등은 `[bad-decision]` · 답이 객체가 아니거나 64 KiB 를 넘으면 `[bad-answer]`).
#[test]
fn chat_tile_decide_kinds() {
    let gone = new_id(299);
    let decide = |d: &str, answers: Value| {
        handle("chat_tile_decide", json!({ "chat": gone, "epoch": 0, "requestId": "r1", "decision": d, "answers": answers }), 0)
    };
    for bad in ["remember", "allowAlways", "accept", "acceptForSession", ""] {
        assert!(reason(decide(bad, Value::Null)).contains("[bad-decision]"), "{bad}");
    }
    for bad in [Value::Null, json!(["Red"]), json!("Red"), json!({ "q": "x".repeat(64 * 1024) })] {
        assert!(reason(decide("answer", bad.clone())).contains("[bad-answer]"), "{bad}");
    }
    for ok in ["allow", "deny", "allowSession"] {
        assert!(reason(decide(ok, Value::Null)).contains("[session-gone]"), "{ok} 는 표까지 간다");
    }
    assert!(reason(decide("answer", json!({ "Which color?": "Red" }))).contains("[session-gone]"));
    // 몸에 제안 · 규칙 · 목적지 칸이 있어도 어댑터에 닿지 않는다(그런 칸이 없다)
    let extra = json!({ "chat": gone, "epoch": 0, "requestId": "r1", "decision": "allowSession",
        "suggestion": { "destination": "localSettings" }, "updatedPermissions": [], "mode": "bypassPermissions" });
    assert!(reason(handle("chat_tile_decide", extra, 0)).contains("[session-gone]"));
    // 오류면 어댑터가 대기에서 빼지 않는다 — 서버는 그 오류 낱말을 그대로 이유로 낸다
    let src = src();
    let body = body_of(&src, "fn op_decide(");
    assert!(body.contains(".map_err(|w| fail(w, \"the decision was not sent\"))?;"));
    assert!(body.find("chat_proc::apply(").unwrap() > body.find("the decision was not sent").unwrap());
}

/// 프런트는 결정 낱말(+ 질문 답)만 보낸다 — 제안 · 규칙 · 목적지 · 모드를 고를 칸이 서버 몸 · GUI 명령에 없고, 제안 글자는 Claude 어댑터 밖(서버 · 프록시)에 없다.
#[test]
fn chat_tile_frontend_cannot_choose_the_suggestion() {
    let src = src();
    let body = body_of(&src, "struct DecideBody {");
    let fields: Vec<&str> = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with("#[") && !l.starts_with("//") && l.contains(':'))
        .map(|l| l.split(':').next().unwrap().trim())
        .collect();
    assert_eq!(fields, ["chat", "epoch", "request_id", "decision", "message", "answers"]);
    let proxy = proxy_src();
    let proxy = proxy.split("#[cfg(test)]").next().unwrap();
    let cmd = body_of(proxy, "pub async fn chat_tile_decide(");
    let at = cmd.find("\"chat_tile_decide\",").unwrap();
    let keys: Vec<&str> = cmd[at..].split('"').skip(3).step_by(2).take_while(|k| !k.is_empty()).collect();
    assert_eq!(keys, ["chat", "epoch", "requestId", "decision", "message", "answers"], "{}", &cmd[at..]);
    let args = &cmd[..cmd.find(") -> Result").unwrap()];
    for bad in ["suggestion", "rule", "destination", "perm_mode", "mode:"] {
        assert!(!args.contains(bad), "{bad}");
    }
    let mut seen = 0;
    for (name, s) in sources_under("src/server").into_iter().filter(|(n, _)| !n.contains("tests")) {
        seen += 1;
        let code = code_of(s.split("mod tests {").next().unwrap_or(""));
        for bad in ["updatedPermissions", "permission_suggestions", "session_pick"] {
            assert!(!code.contains(bad), "{name}: {bad}");
        }
    }
    assert!(seen > 10);
    // 늘 허용의 고르기는 어댑터 하나 — 서버는 요약(`session_allow`)의 모드만 읽는다
    let claude = lf(include_str!("../../side_chat/claude.rs"));
    assert_eq!(claude.matches("session_pick(&req[\"permission_suggestions\"], &self.cwd)").count(), 1);
}

/// 내는 쪽(실행 인자 · 줄 · 고를 수 있는 값)에 넓히는 모드가 없다 — 읽는 쪽(사용자 설정 표지 · 시험)만 그 낱말을 안다.
#[test]
fn chat_tile_never_offers_wider_modes() {
    let code_only = |s: &str| code_of(lf(s).split("#[cfg(test)]").next().unwrap());
    for (name, s) in [("chat_tile/mod.rs", code_of(&src())), ("chat_tile/launch.rs", code_only(include_str!("launch.rs")))] {
        for bad in ["bypassPermissions", "dontAsk", "dangerFullAccess", "danger-full-access", "\"never\"", "\"untrusted\"", "acceptWithExecpolicyAmendment"] {
            assert!(!s.contains(bad), "{name}: {bad}");
        }
    }
    let claude = code_only(include_str!("../../side_chat/claude.rs"));
    for bad in ["bypassPermissions", "dontAsk", "dangerously"] {
        assert!(!claude.contains(bad), "claude.rs: {bad}");
    }
    let codex = code_only(include_str!("../../side_chat/codex.rs"));
    assert!(!codex.contains("dangerFullAccess") && !codex.contains("\"untrusted\""));
    // `"never"` 은 프로듀서의 `producer()` 하나뿐
    assert_eq!(codex.matches("\"never\"").count(), 1);
    let producer = body_of(&codex, "pub(crate) fn producer(");
    assert!(producer.contains("self.approval = \"never\";"));
    assert_eq!(crate::side_chat::claude::TILE_MODES, ["default", "acceptEdits", "plan", "auto"]);
    assert_eq!(crate::side_chat::codex::TILE_MODES, ["readOnly", "auto", "plan"]);
    // 서버가 받는 값도 같은 둘레
    for m in ["bypassPermissions", "dontAsk", "fullAccess", "dangerFullAccess", "never", "custom"] {
        for cli in [Cli::Claude, Cli::Codex] {
            assert!(!super::offered(cli, None, m), "{m}");
        }
    }
}

// ---------------------------------------------------------------------------
// 압축 · 스킬 · 목록 · 맥락 사용량
// ---------------------------------------------------------------------------

fn compact_op(chat: &str, epoch: u64, instructions: Value) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_compact", json!({ "chat": chat, "epoch": epoch, "instructions": instructions }), 0)
}

/// 지침 판정은 표 앞 · 프로세스가 없으면 `[not-started]` 이고 띄우지 않는다 · Codex 는 지침을 받지 않는다 · 옛 세대 · 틀린 종류.
/// (턴 중 `[turn-running]` · stdin 의 `/compact` 줄은 가짜 CLI 통합 `chat_tile_compact_live_with_fake_cli`.)
#[test]
fn chat_tile_compact_rules() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("compact-rules");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let gone = new_id(399);
    for bad in [json!("x".repeat(4097)), json!("a\u{7}b"), json!("tab\there")] {
        assert!(reason(compact_op(&gone, 0, bad.clone())).contains("[bad-instructions]"), "표 앞: {bad}");
    }
    assert!(reason(compact_op(&gone, 0, json!("x".repeat(4096)))).contains("[session-gone]"), "4 KiB 는 받는다");
    assert!(reason(compact_op(&gone, 0, json!("첫 줄\n둘째 줄"))).contains("[session-gone]"), "줄바꿈은 받는다");
    let a = new_id(300);
    open_cli(&a, "claude", &cwd, Value::Null).unwrap();
    super::note_argv_for_test(&[]);
    for i in [Value::Null, json!(""), json!("keep it")] {
        assert!(reason(compact_op(&a, 0, i.clone())).contains("[not-started]"), "{i}");
    }
    assert!(super::argv_for_test().is_empty(), "압축 op 는 띄우지 않는다");
    assert!(!root.join(".run").exists());
    assert_eq!(attach(&a)["status"], "stopped");
    assert!(reason(compact_op(&a, 9, Value::Null)).contains("[stale-chat]"));
    assert!(reason(compact_op("pc-0001", 0, Value::Null)).contains("[wrong-chat-kind]"));
    let c = new_id(301);
    open_cli(&c, "codex", &cwd, Value::Null).unwrap();
    assert!(reason(compact_op(&c, 0, json!("keep"))).contains("[bad-instructions]"), "Codex + 지침");
    assert!(reason(compact_op(&c, 0, Value::Null)).contains("[not-started]"));
    // 몸 꼴
    assert!(handle("chat_tile_compact", json!({ "chat": a, "epoch": "0" }), 0).is_err());
    // 판정 순서 — 턴 중 · 띄움 · 빈 Codex 스레드 · 어댑터
    let src = src();
    let body = body_of(&src, "fn op_compact(");
    let at = |s: &str| body.find(s).unwrap_or_else(|| panic!("{s}"));
    assert!(at("\"bad-instructions\", \"the compaction") < at("find(&b.chat)?"));
    assert!(at("check_epoch(") < at("\"Codex compaction takes no instructions\""));
    assert!(at("\"Codex compaction takes no instructions\"") < at("\"turn-running\""));
    assert!(at("\"turn-running\"") < at("\"not-started\""));
    assert!(at("\"not-started\"") < at("\"nothing-to-compact\""));
    assert!(at("\"nothing-to-compact\"") < at(".encode_compact("));
    assert!(!body.contains("log::"), "지침은 남기지 않는다");
    for id in [&a, &c] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 스킬 이름은 표 앞에서 본다(아홉 개 · 겹침 · 틀린 이름 → `[bad-skill]`) · 경로 칸은 몸에 없다.
/// (Claude 타일의 스킬 몸 `[unsupported]` 는 가짜 CLI 통합.)
#[test]
fn chat_tile_send_skills_rules() {
    let gone = new_id(398);
    let send = |skills: Value| handle("chat_tile_send", json!({ "chat": gone, "epoch": 0, "text": "$a hi", "clientId": "c1", "skills": skills }), 0);
    let nine: Vec<String> = (0..9).map(|i| format!("s{i}")).collect();
    for bad in [json!(nine), json!(["a", "a"]), json!(["a b"]), json!([""]), json!(["x".repeat(97)])] {
        assert!(reason(send(bad.clone())).contains("[bad-skill]"), "{bad}");
    }
    for ok in [json!([]), json!(["a"]), json!(["anthropic-skills:docx", "code-review", "__remote-workflow"])] {
        assert!(reason(send(ok.clone())).contains("[session-gone]"), "{ok} 는 표까지 간다");
    }
    assert!(reason(handle("chat_tile_send", json!({ "chat": gone, "epoch": 0, "text": "hi", "clientId": "c1" }), 0)).contains("[session-gone]"), "칸 없음 = 빈 목록");
    let src = src();
    let body = body_of(&src, "struct SendBody {");
    assert!(body.contains("skills: Vec<String>,") && !body.contains("path"), "{body}");
    let send = body_of(&src, "fn op_send(");
    assert!(send.find("\"bad-skill\"").unwrap() < send.find("find(&b.chat)?").unwrap(), "표 앞");
    assert!(send.contains("st.sent.push_back(Sent { client_id: b.client_id, text: b.text, files: names });"), "말풍선 글은 친 그대로");
}

/// 사건 셋은 스냅숏의 칸으로 남는다 — 처음엔 셋 다 `null` · 프로세스가 끝나도 남는다 · 지금 턴 꼬리에는 압축 표지만(목록 · 사용량은 칸이 맞춘다).
#[test]
fn chat_tile_snapshot_carries_commands_and_context() {
    use super::super::chat_proc;
    use crate::side_chat::event::{CompactPhase, SlashCommand};
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("snapcmd");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let a = new_id(310);
    let snap = open_cli(&a, "claude", &cwd, Value::Null).unwrap();
    assert_eq!((&snap["commands"], &snap["context"], &snap["lastCompaction"]), (&Value::Null, &Value::Null, &Value::Null));
    let chat = super::find(&a).unwrap();
    let cmd = SlashCommand { name: "compact".into(), description: "Free up context".into(), hint: "<instructions>".into(), kind: "builtin", aliases: vec![] };
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::TurnStarted { turn: None });
        chat_proc::push(&*chat, &mut st, Ev::Commands { commands: vec![cmd], terminal: vec!["doctor".into()] });
        chat_proc::push(&*chat, &mut st, Ev::ContextUsage { used: 36149, window: Some(1000000), source: "turn" });
        chat_proc::push(&*chat, &mut st, Ev::Compaction { phase: CompactPhase::Started, trigger: Some("manual".into()), pre_tokens: None, post_tokens: None });
        let snap = super::snapshot(&chat, &st);
        assert_eq!(snap["lastCompaction"], Value::Null, "시작만으로는 남지 않는다");
        chat_proc::push(&*chat, &mut st, Ev::Compaction { phase: CompactPhase::Done, trigger: Some("manual".into()), pre_tokens: Some(36241), post_tokens: Some(8335) });
    }
    let want = |snap: &Value| {
        assert_eq!(
            snap["commands"],
            json!({ "commands": [{ "name": "compact", "description": "Free up context", "hint": "<instructions>", "kind": "builtin", "aliases": [] }], "terminal": ["doctor"] })
        );
        assert_eq!(snap["context"], json!({ "used": 36149, "window": 1000000, "source": "turn" }));
        assert_eq!(snap["lastCompaction"], json!({ "trigger": "manual", "preTokens": 36241, "postTokens": 8335 }));
    };
    let snap = attach(&a);
    want(&snap);
    let tail: Vec<&str> = snap["liveTurn"].as_array().unwrap().iter().map(|e| e["t"].as_str().unwrap_or("")).collect();
    assert_eq!(tail, ["turnStarted", "compaction", "compaction"], "목록 · 사용량은 꼬리에 없다");
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::Exited { code: Some(0), reason: "exit" });
    }
    want(&attach(&a));
    // 다시 열기(다음 띄우기의 뜻)에도 지우지 않는다
    want(&open_cli(&a, "claude", &cwd, Value::Null).unwrap());
    let rows = handle("chat_tile_list", json!({}), 0).unwrap().to_string();
    assert!(!rows.contains("commands") && !rows.contains("lastCompaction"), "목록 줄은 그대로");
    handle("chat_tile_close", json!({ "chat": a }), 0).unwrap();
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

// ---------------------------------------------------------------------------
// 검토 · 목표 · 속도 · MCP 상태 (프로세스 없음 — 가짜 CLI 통합은 `live::chat_tile_codex_review_goal_tier_mcp` · `live::chat_tile_claude_mcp_status`)
// ---------------------------------------------------------------------------

fn review_op(chat: &str, epoch: u64, target: Value) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_review", json!({ "chat": chat, "epoch": epoch, "target": target }), 0)
}

fn goal_op(chat: &str, epoch: u64, action: &str, objective: Value, budget: Value) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_goal", json!({ "chat": chat, "epoch": epoch, "action": action, "objective": objective, "tokenBudget": budget }), 0)
}

fn tier_op(chat: &str, epoch: u64, tier: Value) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_set_tier", json!({ "chat": chat, "epoch": epoch, "tier": tier }), 0)
}

fn goal_ev(status: &'static str) -> Ev {
    Ev::Goal { goal: Some(crate::side_chat::event::GoalView { objective: "all tests pass".into(), status, tokens_used: 10, token_budget: Some(500000), seconds_used: 1, auto: true }) }
}

/// 꼴 · 지침 상한 → `[bad-review-target]`(표 앞 — 없는 항목이어도) · Claude → `[unsupported]` · 옛 세대 · 프로세스가 없으면 띄운다(같은 대화 · 사람 글 없음).
#[test]
fn chat_tile_review_rules() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("review");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let ghost = new_id(399);
    for bad in [
        json!({ "type": "baseBranch", "branch": "-x" }),
        json!({ "type": "baseBranch", "branch": "a..b" }),
        json!({ "type": "commit", "sha": "zz" }),
        json!({ "type": "custom", "instructions": "a".repeat(4097) }),
        json!({ "type": "nope" }),
        json!("uncommittedChanges"),
    ] {
        assert!(reason(review_op(&ghost, 0, bad.clone())).contains("[bad-review-target]"), "{bad}");
    }
    let claude = new_id(400);
    open_cli(&claude, "claude", &cwd, Value::Null).unwrap();
    assert!(reason(review_op(&claude, 0, json!({ "type": "uncommittedChanges" }))).contains("[unsupported]"));
    let codex = new_id(401);
    open_cli(&codex, "codex", &cwd, Value::Null).unwrap();
    assert!(reason(review_op(&codex, 5, json!({ "type": "uncommittedChanges" }))).contains("[stale-chat]"));
    super::note_argv_for_test(&[]);
    // 가짜 CLI 가 없어 띄우기는 실패하지만 실행 인자는 그 전에 적힌다 — 띄우려 했다
    let e = reason(review_op(&codex, 0, json!({ "type": "commit", "sha": "ea1dbc41" })));
    assert!(!e.contains("[not-started]") && !e.contains("[bad-review-target]"), "{e}");
    assert_eq!(super::argv_for_test().get(1).map(String::as_str), Some("app-server"));
    assert!(!super::argv_for_test().iter().any(|a| a.contains("service_tier") || a.contains("review")), "실행 인자에 검토 · 속도 없음");
    for id in [&claude, &codex] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 표 앞: 낱말 · 목표 글(빈 글 · 4000 글자 넘음 · 제어 문자) · 한도(없음 · 다섯 밖) · 멈춤 · 지우기 · 이어 하기에 글 · 한도 → 거절. Claude → `[unsupported]` ·
/// 목표 없이 멈춤 → `[no-goal]` · active 에 이어 하기 → `[no-goal]` · 턴 중 정하기 · 이어 하기 → `[turn-running]` · 프로세스 없는 멈춤 · 지우기 → `[not-started]` ·
/// 정하기 · 이어 하기는 띄운다.
#[test]
fn chat_tile_goal_rules() {
    use super::super::chat_proc;
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("goal");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let ghost = new_id(409);
    let ok_text = json!("모든 시험이 지날 때까지");
    for (action, objective, budget, want) in [
        ("start", ok_text.clone(), json!(500000), "[bad-goal]"),
        ("", Value::Null, Value::Null, "[bad-goal]"),
        ("set", Value::Null, json!(500000), "[bad-objective]"),
        ("set", json!("   "), json!(500000), "[bad-objective]"),
        ("set", json!("가".repeat(4001)), json!(500000), "[bad-objective]"),
        ("set", json!("a\u{1b}b"), json!(500000), "[bad-objective]"),
        ("set", ok_text.clone(), Value::Null, "[bad-budget]"),
        ("set", ok_text.clone(), json!(9999), "[bad-budget]"),
        ("set", ok_text.clone(), json!(50_000_001), "[bad-budget]"),
        ("set", ok_text.clone(), json!(300000), "[bad-budget]"),
        ("pause", ok_text.clone(), Value::Null, "[bad-goal]"),
        ("clear", Value::Null, json!(500000), "[bad-goal]"),
        ("resume", ok_text.clone(), json!(500000), "[bad-goal]"),
    ] {
        assert!(reason(goal_op(&ghost, 0, action, objective.clone(), budget.clone())).contains(want), "{action} {objective} {budget}: {want}");
    }
    assert!(reason(goal_op(&ghost, 0, "set", json!("가".repeat(4000)), json!(2_000_000))).contains("[session-gone]"), "4000 글자는 받는다 — 표에서 거절");
    let claude = new_id(410);
    open_cli(&claude, "claude", &cwd, Value::Null).unwrap();
    assert!(reason(goal_op(&claude, 0, "set", ok_text.clone(), json!(500000))).contains("[unsupported]"));
    assert!(reason(goal_op(&claude, 0, "pause", Value::Null, Value::Null)).contains("[unsupported]"));
    let codex = new_id(411);
    open_cli(&codex, "codex", &cwd, Value::Null).unwrap();
    assert!(reason(goal_op(&codex, 3, "pause", Value::Null, Value::Null)).contains("[stale-chat]"));
    for action in ["pause", "resume", "clear"] {
        assert!(reason(goal_op(&codex, 0, action, Value::Null, Value::Null)).contains("[no-goal]"), "{action}");
    }
    let chat = super::find(&codex).unwrap();
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, goal_ev("active"));
    }
    assert!(reason(goal_op(&codex, 0, "resume", Value::Null, Value::Null)).contains("[no-goal]"), "active 는 이어 하지 않는다");
    for action in ["pause", "clear"] {
        assert!(reason(goal_op(&codex, 0, action, Value::Null, Value::Null)).contains("[not-started]"), "{action}: 띄우지 않는다");
    }
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::TurnStarted { turn: Some("g1".into()) });
    }
    assert!(reason(goal_op(&codex, 0, "set", ok_text.clone(), json!(500000))).contains("[turn-running]"));
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::TurnEnded { turn: Some("g1".into()), outcome: crate::side_chat::event::Outcome::Ok, message: None });
        chat_proc::push(&*chat, &mut st, goal_ev("budgetLimited"));
    }
    super::note_argv_for_test(&[]);
    let e = reason(goal_op(&codex, 0, "resume", Value::Null, Value::Null));
    assert!(!e.contains("[not-started]") && !e.contains("[no-goal]"), "한도에 닿은 목표의 이어 하기는 띄운다: {e}");
    assert!(!super::argv_for_test().is_empty());
    super::note_argv_for_test(&[]);
    let e = reason(goal_op(&codex, 0, "set", ok_text.clone(), json!(100000)));
    assert!(!e.contains("[not-started]"), "{e}");
    assert!(!super::argv_for_test().is_empty(), "정하기는 띄운다");
    // 목표 글은 로그에 없다
    let logs = super::super::log::CAPTURED.lock().unwrap().clone();
    assert!(!logs.iter().any(|l| l.contains("모든 시험이")), "목표 글이 로그에");
    for id in [&claude, &codex] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// `word_ok` 밖 · 33 바이트 → `[bad-tier]`(표 앞) · Claude 에 값 → `[unsupported]` · Claude 에 null → 받음 · 프로세스 없음 → `false` 와 표에 남음 ·
/// 열기의 `tier` 가 첫 값(Claude 는 버림 · 틀린 꼴은 `[bad-tier]`) · 실행 인자에는 싣지 않는다.
#[test]
fn chat_tile_tier_rules() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("tier");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let open_tier = |chat: &str, cli: &str, tier: Value| {
        handle("chat_tile_open", json!({ "chat": chat, "cli": cli, "model": "", "mode": { "kind": "fresh", "cwd": slash(&cwd) }, "window": "main", "tier": tier }), 0)
    };
    let ghost = new_id(419);
    for bad in [json!("a b"), json!("x".repeat(33)), json!("fast!")] {
        assert!(reason(tier_op(&ghost, 0, bad.clone())).contains("[bad-tier]"), "{bad}");
    }
    let codex = new_id(420);
    let snap = open_tier(&codex, "codex", json!("priority")).unwrap();
    assert_eq!((&snap["tier"], &snap["tiers"], &snap["goal"], &snap["mcpStatus"]), (&json!("priority"), &Value::Null, &Value::Null, &Value::Null));
    assert!(reason(open_tier(&new_id(421), "codex", json!("a b"))).contains("[bad-tier]"));
    assert_eq!(open_tier(&new_id(422), "claude", json!("priority")).unwrap()["tier"], Value::Null, "Claude 는 버린다");
    assert_eq!(open_tier(&codex, "codex", Value::Null).unwrap()["tier"], "priority", "null 은 지우지 않는다");
    assert_eq!(tier_op(&codex, 0, json!("x".repeat(32))).unwrap(), json!(false), "표에만");
    assert_eq!(attach(&codex)["tier"], "x".repeat(32));
    assert_eq!(tier_op(&codex, 0, json!("")).unwrap(), json!(false), "빈 값 = CLI 기본");
    assert_eq!(attach(&codex)["tier"], Value::Null);
    assert!(reason(tier_op(&codex, 9, json!("priority"))).contains("[stale-chat]"));
    let claude = new_id(423);
    open_cli(&claude, "claude", &cwd, Value::Null).unwrap();
    assert!(reason(tier_op(&claude, 0, json!("priority"))).contains("[unsupported]"));
    assert_eq!(tier_op(&claude, 0, Value::Null).unwrap(), json!(false));
    tier_op(&codex, 0, json!("priority")).unwrap();
    let _ = handle("chat_tile_send", json!({ "chat": codex, "epoch": 0, "text": "hi", "clientId": "c1" }), 0);
    assert!(!super::argv_for_test().iter().any(|a| a.contains("priority") || a.contains("service_tier")), "실행 인자에는 없다(턴 몸에만)");
    for id in [&codex, &claude, &new_id(422)] {
        let _ = handle("chat_tile_close", json!({ "chat": id }), 0);
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 프로세스가 없으면 `false`(띄우지 않는다) · 스냅숏 줄의 표 둘은 서버가 얹는다(`aynx` = Aynx 세션 서버 이름 · `picked` = Aynx 가 실은 외부 서버).
#[test]
fn chat_tile_mcp_status_rules() {
    use crate::side_chat::event::McpRow;
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("mcpst");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let a = new_id(430);
    open_cli(&a, "codex", &cwd, Value::Null).unwrap();
    super::note_argv_for_test(&[]);
    assert_eq!(handle("chat_tile_mcp_status", json!({ "chat": a, "epoch": 0 }), 0).unwrap(), json!(false));
    assert!(super::argv_for_test().is_empty(), "띄우지 않는다");
    assert!(reason(handle("chat_tile_mcp_status", json!({ "chat": a, "epoch": 4 }), 0)).contains("[stale-chat]"));
    let aynx = crate::instance::mcp_name(crate::instance::DEV);
    let rows = [
        McpRow { name: aynx.into(), state: "connected", auth: Some("bearer"), tools: Some(14), scope: "config" },
        McpRow { name: "ext".into(), state: "needsAuth", auth: Some("oauth"), tools: None, scope: "config" },
        McpRow { name: "other".into(), state: "connecting", auth: None, tools: None, scope: "plugin" },
    ];
    let view = super::mcp_rows_view(&rows, aynx, &["ext".to_string()]);
    assert_eq!(view[0], json!({ "name": aynx, "state": "connected", "auth": "bearer", "tools": 14, "scope": "config", "aynx": true, "picked": false }));
    assert_eq!((&view[1]["aynx"], &view[1]["picked"]), (&json!(false), &json!(true)));
    assert_eq!((&view[2]["aynx"], &view[2]["picked"]), (&json!(false), &json!(false)));
    handle("chat_tile_close", json!({ "chat": a }), 0).unwrap();
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 사건 셋(`mcpStatus` · `goal` · `serviceTiers`)은 스냅숏 칸으로만 남고 지금 턴 꼬리에 없다 · 검토 표지는 꼬리에 남는다 · 다시 띄운 CLI 가 알린
/// 사람의 목표는 밖의 것으로 보이지 않는다 · 지워지면 칸도 비고 사람의 목표 표도 잊는다.
#[test]
fn chat_tile_snapshot_carries_stage7() {
    use super::super::chat_proc;
    use crate::side_chat::event::{McpRow, ReviewPhase, Tier};
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("snap7");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let a = new_id(440);
    let snap = open_cli(&a, "codex", &cwd, Value::Null).unwrap();
    assert_eq!((&snap["mcpStatus"], &snap["goal"], &snap["tiers"], &snap["tier"]), (&Value::Null, &Value::Null, &Value::Null, &Value::Null));
    assert_eq!(snap["cliModel"], Value::Null);
    let chat = super::find(&a).unwrap();
    let tiers = [("gpt-x".to_string(), vec![Tier { id: "priority".into(), name: "Fast".into(), description: "2x speed".into() }])].into_iter().collect();
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::McpServers { names: vec!["ext".into()] });
        chat_proc::push(&*chat, &mut st, Ev::TurnStarted { turn: Some("b".into()) });
        chat_proc::push(&*chat, &mut st, Ev::Review { phase: ReviewPhase::Started, label: "current changes".into(), text: None });
        let row = McpRow { name: "ext".into(), state: "connected", auth: None, tools: Some(2), scope: "config" };
        // 창에 내는 사건에도 스냅숏과 같은 표 둘 — 첫 풍선부터 보인다
        let aynx = McpRow { name: crate::instance::mcp_name(crate::instance::DEV).to_string(), ..row.clone() };
        let wire = super::ev_wire(&st, &Ev::McpStatus { servers: vec![row.clone(), aynx], source: "startup" });
        assert_eq!((&wire["t"], &wire["source"]), (&json!("mcpStatus"), &json!("startup")));
        assert_eq!(wire["servers"][0], json!({ "name": "ext", "state": "connected", "auth": null, "tools": 2, "scope": "config", "aynx": false, "picked": true }));
        assert_eq!((&wire["servers"][1]["aynx"], &wire["servers"][1]["picked"]), (&json!(true), &json!(false)));
        let other = Ev::TurnStarted { turn: Some("b".into()) };
        assert_eq!(super::ev_wire(&st, &other), json!(other), "그 밖 사건은 그대로");
        chat_proc::push(&*chat, &mut st, Ev::McpStatus { servers: vec![row], source: "startup" });
        chat_proc::push(&*chat, &mut st, goal_ev("active"));
        chat_proc::push(&*chat, &mut st, Ev::ServiceTiers { by_model: tiers, thread: Some("default".into()) });
        // 사람이 정한 목표(서버가 기억한 글) — 다시 띄운 CLI 의 알림은 출처가 없다
        st.goal_ours = Some("all tests pass".into());
        chat_proc::push(&*chat, &mut st, goal_ev("paused"));
    }
    {
        // 사람이 고른 모델이 없을 때 등급 표의 열쇠 — 다시 붙은 창이 칩 · 속도 줄을 잃지 않게
        let mut st = super::lock(&chat.st);
        let ready = |model: Option<&str>| Ev::Ready {
            cli: crate::side_chat::event::Cli::Codex,
            version: None,
            model: model.map(str::to_string),
            models: Vec::new(),
            efforts: Default::default(),
            conversation_id: None,
        };
        chat_proc::push(&*chat, &mut st, ready(Some("gpt-x")));
        chat_proc::push(&*chat, &mut st, ready(None));
    }
    let snap = attach(&a);
    assert_eq!(snap["cliModel"], "gpt-x", "모델을 알리지 않은 Ready 는 앞 값을 둔다");
    let tail: Vec<&str> = snap["liveTurn"].as_array().unwrap().iter().map(|e| e["t"].as_str().unwrap_or("")).collect();
    assert_eq!(tail, ["turnStarted", "review"], "MCP · 목표 · 속도는 꼬리에 없다");
    assert_eq!(
        snap["mcpStatus"],
        json!({ "source": "startup", "stale": false, "servers": [{ "name": "ext", "state": "connected", "auth": null, "tools": 2, "scope": "config", "aynx": false, "picked": true }] })
    );
    assert_eq!(snap["goal"], json!({ "objective": "all tests pass", "status": "paused", "tokensUsed": 10, "tokenBudget": 500000, "secondsUsed": 1, "auto": false }));
    assert_eq!(snap["tiers"], json!({ "byModel": { "gpt-x": [{ "id": "priority", "name": "Fast", "description": "2x speed" }] }, "thread": "default" }));
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::Goal { goal: None });
        assert_eq!(st.goal_ours, None, "지워지면 사람의 목표 표도 잊는다");
        st.goal_ours = None;
        chat_proc::push(&*chat, &mut st, goal_ev("active"));
    }
    assert_eq!(attach(&a)["goal"]["auto"], true, "밖에서 선 목표");
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::Exited { code: Some(0), reason: "exit" });
    }
    let snap = attach(&a);
    assert!(snap["mcpStatus"].is_object() && snap["goal"].is_object() && snap["tiers"].is_object(), "프로세스가 끝나도 남는다");
    let rows = handle("chat_tile_list", json!({}), 0).unwrap().to_string();
    assert!(!rows.contains("mcpStatus") && !rows.contains("tiers"), "목록 줄은 그대로");
    handle("chat_tile_close", json!({ "chat": a }), 0).unwrap();
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

// ---------------------------------------------------------------------------
// 되감기
// ---------------------------------------------------------------------------

pub(super) const U1: &str = "30b5bc5c-33b6-47d1-802c-c06d0d28a93a";
pub(super) const U2: &str = "9a573fe1-b87b-42a1-ab8f-77acc245e7d1";

/// 가짜 Claude 기록(`<루트>/proj-dir/<대화>.jsonl`) — 사람 말 줄마다 uuid · 답 한 줄씩.
pub(super) fn claude_record(root: &Path, conv: &str, cwd: &Path, said: &[(&str, &str)]) {
    let dir = root.join("proj-dir");
    std::fs::create_dir_all(&dir).unwrap();
    let cwd = cwd.to_string_lossy();
    let mut body = String::new();
    let mut parent = Value::Null;
    for (i, (uuid, text)) in said.iter().enumerate() {
        let reply = format!("{:08x}-0000-4000-8000-00000000000{i}", 0xabcdu32);
        body += &(json!({ "type": "user", "uuid": uuid, "parentUuid": parent, "cwd": cwd, "sessionId": conv, "entrypoint": "sdk-cli",
            "timestamp": "2026-11-28T01:00:00.000Z", "message": { "role": "user", "content": text } })
        .to_string()
            + "\n");
        body += &(json!({ "type": "assistant", "uuid": reply, "parentUuid": uuid, "cwd": cwd, "timestamp": "2026-11-28T01:00:01.000Z",
            "message": { "model": "claude-haiku", "content": [{ "type": "text", "text": "ok" }] } })
        .to_string()
            + "\n");
        parent = json!(reply);
    }
    std::fs::write(dir.join(format!("{conv}.jsonl")), body).unwrap();
}

fn rewind_op(chat: &str, epoch: u64, anchor: &str, scope: &str, dry: bool) -> Result<Value, super::super::ipc::WireError> {
    handle("chat_tile_rewind", json!({ "chat": chat, "epoch": epoch, "anchor": anchor, "scope": scope, "dryRun": dry }), 0)
}

/// 몸 판정은 표 앞(`[bad-anchor]` → `[bad-scope]`) · 옛 세대 · 틀린 종류 · 대화 없음 · 그 CLI 가 못 하는 범위 · 실행 + 프로세스 없음 → `[not-started]`
/// (띄우지 않는다) · Claude 기준점은 기록의 현재 갈래 사람 줄만. (미리 보기 · 실행 · 턴 중은 가짜 CLI 통합 `chat_tile_rewind_needs_preview`.)
#[test]
fn chat_tile_rewind_rules() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("rewind-rules");
    let cwd = root.join("work");
    let convs = root.join("convs");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &convs);
    super::set_enabled_for_test(Some(true));
    let gone = new_id(499);
    assert!(reason(rewind_op(&gone, 0, "x", "all", true)).contains("[bad-anchor]"), "표 앞 · 기준점 먼저");
    assert!(reason(rewind_op(&gone, 0, "30B5BC5C-33B6-47D1-802C-C06D0D28A93A;", "files", true)).contains("[bad-anchor]"));
    for bad in ["all", "", "Files", "files "] {
        assert!(reason(rewind_op(&gone, 0, U1, bad, true)).contains("[bad-scope]"), "{bad:?}");
    }
    assert!(reason(rewind_op(&gone, 0, U1, "both", true)).contains("[session-gone]"), "both 는 낱말이다");
    assert!(reason(rewind_op("pc-0001", 0, U1, "files", true)).contains("[wrong-chat-kind]"));
    assert!(handle("chat_tile_rewind", json!({ "chat": gone, "epoch": 0, "anchor": U1, "scope": "files" }), 0).is_err(), "dryRun 은 칸이 있어야 한다");
    let a = new_id(400);
    open_cli(&a, "claude", &cwd, Value::Null).unwrap();
    super::note_argv_for_test(&[]);
    assert!(reason(rewind_op(&a, 0, U1, "files", true)).contains("[nothing-to-rewind]"));
    assert!(reason(rewind_op(&a, 9, U1, "files", true)).contains("[stale-chat]"));
    let conv = format!("4d4d4d4d-0000-4000-8000-{:012x}", std::process::id());
    super::find(&a).map(|c| super::lock(&c.st).conversation = Some(conv.clone())).unwrap();
    assert!(reason(rewind_op(&a, 0, U1, "files", false)).contains("[bad-anchor]"), "기록이 없다");
    claude_record(&convs, &conv, &cwd, &[(U1, "hello"), (U2, "again")]);
    for scope in ["files", "conversation", "both"] {
        assert!(reason(rewind_op(&a, 0, U1, scope, false)).contains("[not-started]"), "{scope}");
    }
    assert!(reason(rewind_op(&a, 0, "deadbeef-0000-4000-8000-000000000000", "files", false)).contains("[bad-anchor]"), "기록에 없는 줄");
    assert!(super::argv_for_test().is_empty(), "거절은 띄우지 않는다");
    assert!(!root.join(".run").exists());
    let c = new_id(401);
    open_cli(&c, "codex", &cwd, Value::Null).unwrap();
    super::find(&c).map(|x| super::lock(&x.st).conversation = Some("01a30000-0000-7000-8000-00000000000c".into())).unwrap();
    for scope in ["files", "both"] {
        assert!(reason(rewind_op(&c, 0, U1, scope, true)).contains("[unsupported]"), "Codex + {scope}");
    }
    assert!(reason(rewind_op(&c, 0, U1, "conversation", false)).contains("[not-started]"), "Codex 는 기록을 보지 않는다(CLI 가 판정)");
    // 판정 순서
    let src = src();
    let body = body_of(&src, "fn op_rewind(");
    let at = |s: &str| body.find(s).unwrap_or_else(|| panic!("{s}"));
    assert!(at("\"bad-anchor\", \"the rewind anchor") < at("\"bad-scope\"") && at("\"bad-scope\"") < at("find(&b.chat)?"));
    assert!(at("rewind_checks(&mut st, b.epoch, scope)?") < at("claude_last_seen("));
    assert!(at("claude_last_seen(") < at("if !b.dry_run {") && at("\"not-started\"") < at("\"preview-first\""));
    assert!(at("\"preview-first\"") < at(".encode_rewind("));
    let checks = body_of(&src, "fn rewind_checks(");
    let at = |s: &str| checks.find(s).unwrap_or_else(|| panic!("{s}"));
    assert!(at("check_epoch(") < at("scope_ok(") && at("scope_ok(") < at("\"nothing-to-rewind\""));
    assert!(at("\"nothing-to-rewind\"") < at("\"turn-running\"") && at("\"turn-running\"") < at("\"rewind-running\""));
    assert!(checks.contains("st.core.status() == Status::Running || st.core.has_pending()"), "권한 카드가 떠 있어도");
    // 로그 — 기준점 · 경로 · CLI 글은 남기지 않는다
    for line in src.lines().filter(|l| l.contains("log::line(") && l.contains("rewind")) {
        assert!(!line.contains("anchor") && !line.contains("error") && !line.contains("files"), "{line}");
    }
    for id in [&a, &c] {
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 스냅숏 `rewind` · `rewindGen` — 처음엔 `null` · `0` · 캡 사건 뒤 그 값 · 대화 되감기가 끝날 때마다 +1(맥락 · 마지막 압축을 비운다) · 파일만이면 그대로 ·
/// 지금 턴 꼬리에는 되감기 사건이 없다 · 프로세스 끝에 미리 보기를 잊는다.
#[test]
fn chat_tile_rewind_snapshot_and_gen() {
    use super::super::chat_proc;
    use crate::side_chat::event::{rewind_ev, RewindMore, RewindPhase};
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("rewind-snap");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let a = new_id(410);
    let snap = open_cli(&a, "claude", &cwd, Value::Null).unwrap();
    assert_eq!((&snap["rewind"], &snap["rewindGen"]), (&Value::Null, &json!(0)));
    let chat = super::find(&a).unwrap();
    let done = |scope: &'static str| rewind_ev(RewindPhase::Done, U1, scope, true, RewindMore::default());
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::TurnStarted { turn: None });
        chat_proc::push(&*chat, &mut st, Ev::RewindCaps { files: true, conversation: false });
        chat_proc::push(&*chat, &mut st, Ev::ContextUsage { used: 100, window: None, source: "turn" });
        chat_proc::push(&*chat, &mut st, rewind_ev(RewindPhase::Preview, U1, "files", true, RewindMore::default()));
        assert!(st.rewind_ok.is_some());
        chat_proc::push(&*chat, &mut st, done("files"));
        assert!(st.rewind_ok.is_none() && st.rewinding.is_none());
    }
    let snap = attach(&a);
    assert_eq!((&snap["rewind"], &snap["rewindGen"]), (&json!({ "files": true, "conversation": false }), &json!(0)));
    assert_eq!(snap["context"]["used"], 100, "파일만 — 맥락은 그대로");
    let tail = snap["liveTurn"].to_string();
    assert!(!tail.contains("rewind"), "꼬리에 없다: {tail}");
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, Ev::Compaction { phase: crate::side_chat::event::CompactPhase::Done, trigger: None, pre_tokens: Some(9), post_tokens: Some(1) });
        chat_proc::push(&*chat, &mut st, done("conversation"));
        chat_proc::push(&*chat, &mut st, done("both"));
        chat_proc::push(&*chat, &mut st, rewind_ev(RewindPhase::Failed, U1, "conversation", false, RewindMore::default()));
    }
    let snap = attach(&a);
    assert_eq!((&snap["rewindGen"], &snap["context"], &snap["lastCompaction"]), (&json!(2), &Value::Null, &Value::Null));
    {
        let mut st = super::lock(&chat.st);
        chat_proc::push(&*chat, &mut st, rewind_ev(RewindPhase::Preview, U1, "files", true, RewindMore::default()));
        assert!(st.rewind_ok.is_some());
        chat_proc::push(&*chat, &mut st, rewind_ev(RewindPhase::Preview, U1, "files", false, RewindMore::default()));
        assert!(st.rewind_ok.is_none(), "can:false 미리 보기는 실행을 열지 않는다");
        chat_proc::push(&*chat, &mut st, rewind_ev(RewindPhase::Preview, U1, "files", true, RewindMore::default()));
        chat_proc::push(&*chat, &mut st, Ev::Exited { code: Some(0), reason: "exit" });
        assert!(st.rewind_ok.is_none(), "프로세스 끝");
    }
    assert_eq!(attach(&a)["rewind"], json!({ "files": true, "conversation": false }), "캡은 프로세스가 끝나도 남는다");
    let rows = handle("chat_tile_list", json!({}), 0).unwrap().to_string();
    assert!(!rows.contains("rewind"), "목록 줄은 그대로");
    handle("chat_tile_close", json!({ "chat": a }), 0).unwrap();
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 압축 경계 앞 기준점의 대화 거절만 `before_compact` 로 — 파일 쪽 · 다른 거절 · 경계 뒤는 그대로. 표지를 기다리는 길은 읽기만 한다.
#[test]
fn chat_tile_rewind_before_compact_and_mark_watch() {
    use super::failure_word;
    assert_eq!(failure_word(true, "conversation", "stale_target"), Some("before_compact"));
    assert_eq!(failure_word(true, "both", "target_not_found"), Some("before_compact"));
    assert_eq!(failure_word(true, "files", "stale_target"), None);
    assert_eq!(failure_word(true, "conversation", "turn_running"), None);
    assert_eq!(failure_word(false, "conversation", "stale_target"), None);
    let src = src();
    assert!(body_of(&src, "fn shape(").contains("failure_word(before_compact, scope, e)"));
    let watch = body_of(&src, "fn watch_marker(");
    for bad in [".encode_", "chat_proc::apply(", "adapter(", "op_rewind("] {
        assert!(!watch.contains(bad), "표지 기다림은 CLI 에 보내지 않는다: {bad}");
    }
    assert!(watch.contains("claude_marked_since(&path, from)") && watch.contains("MARK_WAIT"));
}

/// Claude 채팅 타일만 체크포인트 환경을 싣는다 — Codex 타일 · 사이드 채팅 · 프로듀서 · 헤드리스 턴은 아니다. 그 글자는 `launch.rs` 밖에 없다.
#[test]
fn chat_tile_claude_env_has_checkpointing() {
    let _g = super::super::tests::live::SESSION_STATE.blocking_lock();
    let root = scratch("ckpt");
    let cwd = root.join("work");
    std::fs::create_dir_all(&cwd).unwrap();
    fake_no_cli(&root, &root.join("convs"));
    super::set_enabled_for_test(Some(true));
    let name = super::launch::CLAUDE_CHECKPOINT_ENV;
    assert_eq!(name, "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING");
    for (cli, want) in [("claude", true), ("codex", false)] {
        let id = new_id(if want { 420 } else { 421 });
        open_cli(&id, cli, &cwd, Value::Null).unwrap();
        let chat = super::find(&id).unwrap();
        let st = super::lock(&chat.st);
        let proc = super::super::chat_proc::ProcId::next();
        let l = super::launch::prepare(&chat.id, &st, proc).unwrap();
        let got: Vec<&(String, String)> = l.env.iter().filter(|(k, _)| k == name).collect();
        assert_eq!(got.len(), usize::from(want), "{cli}");
        if want {
            assert_eq!(got[0].1, "1");
        }
        drop(l);
        drop(st);
        crate::chat_token::revoke(&id, proc);
        handle("chat_tile_close", json!({ "chat": id }), 0).unwrap();
    }
    for (name_, s) in sources_under("src") {
        let exempt = name_.ends_with("server/chat_tile/launch.rs") || name_.ends_with("server/chat_tile/tests.rs") || name_.ends_with("side_chat/tests.rs");
        if !exempt {
            assert!(!s.contains("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"), "{name_}");
        }
    }
    assert_eq!(launch_src().matches("CLAUDE_CHECKPOINT_ENV").count(), 3, "상수 · 머리말 · 싣는 줄 하나");
    super::set_fake_for_test(None);
    super::set_enabled_for_test(None);
    let _ = std::fs::remove_dir_all(&root);
}

/// 되감기를 부르는 길은 사람 op 하나 — MCP · 오케스트레이션 · 프로듀서 · 사이드 채팅 · 메신저 다리는 그 op · 메서드를 모른다.
#[test]
fn chat_tile_rewind_has_no_other_caller() {
    for dir in ["src/mcp", "src/orchestration", "src/server/producer", "src/server/messenger_bridge"] {
        for (name, s) in sources_under(dir) {
            assert!(!s.contains("chat_tile_rewind") && !s.contains("encode_rewind"), "{name}");
        }
    }
    for f in ["src/mcp.rs", "src/orchestration.rs", "src/server/side_chat.rs", "src/server/messenger_bridge.rs", "src/server/orchestration_proxy.rs", "src/server/producer_proxy.rs"] {
        let s = std::fs::read_to_string(f).unwrap();
        assert!(!s.contains("chat_tile_rewind") && !s.contains("encode_rewind"), "{f}");
    }
    let src = src();
    assert_eq!(src.matches(".encode_rewind(").count(), 1);
    assert!(src.contains("\"chat_tile_rewind\" => op_rewind(body(b)?)"));
    // 몸은 기준점 · 범위 · 미리 보기 여부뿐
    let body = body_of(&src, "struct RewindBody {");
    for want in ["chat: String,", "epoch: u64,", "anchor: String,", "scope: String,", "dry_run: bool,"] {
        assert!(body.contains(want), "{want}");
    }
    assert_eq!(body.matches(": ").count(), 5, "{body}");
}

// ---------------------------------------------------------------------------
// 가짜 채팅 타일 CLI — Codex app-server · Claude stream-json 의 7단계 줄(검토 · 목표 · MCP 상태 · 속도). 값 자리는 `SECRET-S7-…` 표지.
// ---------------------------------------------------------------------------

/// `codex` | `claude` — 이 환경이 있을 때만 [`fake_tile_cli`] 가 그 CLI 로 돈다.
pub(super) const TILE_FAKE_ENV: &str = "AYNX_TEST_CHAT_TILE_FAKE";
pub(super) const TILE_FAKE_TEST: &str = "server::chat_tile::tests::fake_tile_cli";
const FAKE_THREAD: &str = "01a00000-0000-7000-8000-0000000000f1";

#[test]
fn fake_tile_cli() {
    match std::env::var(TILE_FAKE_ENV).as_deref() {
        Ok("codex") => std::process::exit(fake_codex()),
        Ok("claude") => std::process::exit(fake_claude()),
        _ => {}
    }
}

fn fake_out(v: &Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

/// 받은 줄을 그대로 적는다(`STDIN_LOG_ENV`).
fn fake_log(line: &str) {
    use std::io::Write;
    if let Some(p) = std::env::var_os(super::super::tests_side_chat::STDIN_LOG_ENV) {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// 가짜 Codex — 글 `hold` 는 끊기를 기다리는 턴 · `die` 는 끝 코드 3 · 그 밖은 곧 끝나는 턴. 검토는 실측 꼴(답 A · `turn/started` B · 끝 A) ·
/// 목표를 active 로 놓으면 사람 글 없는 턴이 곧 서서 끊기를 기다린다 · MCP 읽기는 1.2초 뒤에 답한다. `thread/resume` 뒤에는 시작 알림이 없다.
fn fake_codex() -> i32 {
    use std::io::BufRead;
    let th = FAKE_THREAD;
    let aynx = crate::instance::mcp_name(crate::instance::DEV);
    let (mut n, mut held, mut objective, mut budget) = (0u32, None::<String>, String::new(), Value::Null);
    let turn_end = |t: &str, status: &str| fake_out(&json!({ "method": "turn/completed", "params": { "threadId": th, "turn": { "id": t, "status": status, "error": null } } }));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        fake_log(&line);
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let ok = |r: Value| fake_out(&json!({ "id": v["id"], "result": r }));
        let p = &v["params"];
        match v["method"].as_str().unwrap_or("") {
            "initialize" => ok(json!({ "userAgent": "fake" })),
            "model/list" => ok(json!({ "data": [
                { "id": "gpt-x", "hidden": false, "supportedReasoningEfforts": [{ "reasoningEffort": "low" }],
                  "serviceTiers": [{ "id": "priority", "name": "Fast", "description": "2x speed" }] },
                { "id": "gpt-plain", "hidden": false, "supportedReasoningEfforts": [], "serviceTiers": [] }] })),
            "collaborationMode/list" | "skills/list" => ok(json!({ "data": [] })),
            m @ ("thread/start" | "thread/resume") => {
                ok(json!({ "thread": { "id": th, "cliVersion": "0.172.0" }, "model": "gpt-x", "reasoningEffort": "low", "serviceTier": "default" }));
                if m == "thread/start" {
                    fake_out(&json!({ "method": "mcpServer/startupStatus/updated",
                        "params": { "threadId": th, "name": aynx, "status": "ready", "error": "SECRET-S7-startup", "failureReason": null } }));
                }
            }
            "turn/start" => {
                n += 1;
                let t = format!("u{n}");
                ok(json!({ "turn": { "id": t } }));
                fake_out(&json!({ "method": "turn/started", "params": { "turn": { "id": t } } }));
                fake_out(&json!({ "method": "item/started", "params": { "item": { "type": "userMessage", "id": format!("m{n}"), "clientId": p["clientUserMessageId"] } } }));
                match p["input"][0]["text"].as_str() {
                    Some("hold") => held = Some(t),
                    Some("die") => return 3,
                    _ => {
                        fake_out(&json!({ "method": "item/completed", "params": { "item": { "type": "agentMessage", "id": format!("a{n}"), "text": "ok" } } }));
                        turn_end(&t, "completed");
                    }
                }
            }
            "turn/interrupt" => {
                ok(json!({}));
                if let Some(t) = held.take() {
                    turn_end(&t, "interrupted");
                }
            }
            "review/start" => {
                n += 1;
                let (a, b) = (format!("ra{n}"), format!("rb{n}"));
                ok(json!({ "turn": { "id": a, "rootTurnId": null, "items": [], "status": "inProgress" }, "reviewThreadId": th }));
                fake_out(&json!({ "method": "item/started", "params": { "item": { "type": "enteredReviewMode", "id": "e1", "review": "current changes" }, "turnId": a } }));
                fake_out(&json!({ "method": "turn/started", "params": { "turn": { "id": b, "rootTurnId": a } } }));
                fake_out(&json!({ "method": "item/started", "params": { "item": { "type": "userMessage", "id": "rm", "clientId": null,
                    "content": [{ "type": "text", "text": "Review the current code changes and provide prioritized findings." }] }, "turnId": a } }));
                fake_out(&json!({ "method": "item/started", "params": { "item": { "type": "agentMessage", "id": "unpaired", "text": "" }, "turnId": a } }));
                fake_out(&json!({ "method": "item/completed", "params": { "item": { "type": "exitedReviewMode", "id": "e2", "review": "Looks fine." }, "turnId": a } }));
                fake_out(&json!({ "method": "item/completed", "params": { "item": { "type": "agentMessage", "id": "rr", "text": "Looks fine." }, "turnId": a } }));
                turn_end(&a, "completed");
            }
            "thread/goal/set" => {
                if let Some(o) = p["objective"].as_str() {
                    (objective, budget) = (o.to_string(), p["tokenBudget"].clone());
                }
                let status = p["status"].as_str().unwrap_or("active");
                let g = json!({ "threadId": th, "objective": objective, "status": status, "tokenBudget": budget, "tokensUsed": 0, "timeUsedSeconds": 0 });
                ok(json!({ "goal": g }));
                fake_out(&json!({ "method": "thread/goal/updated", "params": { "threadId": th, "turnId": null, "goal": g } }));
                if status == "active" && held.is_none() {
                    n += 1;
                    let t = format!("g{n}");
                    fake_out(&json!({ "method": "turn/started", "params": { "turn": { "id": t } } }));
                    held = Some(t);
                }
            }
            "thread/goal/clear" => {
                ok(json!({ "cleared": true }));
                fake_out(&json!({ "method": "thread/goal/cleared", "params": { "threadId": th } }));
            }
            "mcpServerStatus/list" => {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                ok(json!({ "data": [
                    { "name": aynx, "runtimeStatus": "connected", "authStatus": "bearerToken", "pluginId": null, "httpOrigin": "http://127.0.0.1:1/mcp?SECRET-S7-origin",
                      "serverInfo": { "name": "SECRET-S7-info" }, "tools": { "a": { "inputSchema": { "description": "SECRET-S7-schema" } }, "b": {} }, "toolsError": null },
                    { "name": "ext-one", "runtimeStatus": null, "authStatus": "unsupported", "pluginId": null, "tools": {}, "toolsError": "SECRET-S7-tools-err" }],
                    "nextCursor": null }));
            }
            _ => {}
        }
    }
    0
}

/// 가짜 Claude — 초기화 답 · 사람 글마다 MCP 칸이 든 `system/init` 과 한 턴 · `mcp_status` 답은 실측 꼴(`config` 에 머리글 · 명령 · 인자 · URL 값).
fn fake_claude() -> i32 {
    use std::io::BufRead;
    let init = include_str!("../../side_chat/fixtures/claude-2.1.309.jsonl").lines().next().unwrap_or("").to_string();
    let mcp = include_str!("../../side_chat/fixtures/claude-2.1.332-mcp.jsonl").lines().next().unwrap_or("").replace("SECRET-", "SECRET-S7-");
    let aynx = crate::instance::mcp_name(crate::instance::DEV);
    let mcp = mcp.replace("\"aynx-sessions\"", &format!("\"{aynx}\""));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        fake_log(&line);
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let id = v["request_id"].as_str().unwrap_or("").to_string();
        match (v["type"].as_str(), v["request"]["subtype"].as_str()) {
            (Some("control_request"), Some("initialize")) => fake_out(&serde_json::from_str(&init.replace("\"request_id\":\"r1\"", &format!("\"request_id\":\"{id}\""))).unwrap()),
            (Some("control_request"), Some("mcp_status")) => fake_out(&serde_json::from_str(&mcp.replace("\"RID\"", &format!("\"{id}\""))).unwrap()),
            (Some("user"), _) => {
                fake_out(&json!({ "type": "system", "subtype": "init", "session_id": "11111111-2222-4333-8444-0000000000f2", "model": "claude-haiku-5-5",
                    "permissionMode": "default", "tools": ["mcp__blender__a"],
                    "mcp_servers": [{ "name": "blender", "status": "pending", "source": "user" }, { "name": aynx, "status": "connected", "source": "dynamic" }] }));
                fake_out(&json!({ "type": "assistant", "message": { "model": "claude-haiku-5-5", "role": "assistant", "content": [{ "type": "text", "text": "ok" }] }, "parent_tool_use_id": null }));
                fake_out(&json!({ "type": "result", "subtype": "success", "is_error": false, "num_turns": 1, "result": "ok" }));
            }
            _ => {}
        }
    }
    0
}
