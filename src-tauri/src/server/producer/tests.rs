//! 프로듀서 채팅 레지스트리 시험(오케스트레이션 2단계 단계 2 — 설계 9절 단계 2 목록).
//!
//! - **소스 훑기**(불변식): 띄우기는 전송 길 하나(`producer_spawns_only_from_dispatch`) · 새 사용자 턴의 본문은 전송기 하나 · 제어 프레임은 사람
//!   op 에서만(`producer_stdin_only_human_or_wake` — 단계 4 의 깨움은 같은 전송기에 붙는다) · 잠금 순서(`producer_lock_order`) · 인자 정책 ·
//!   cwd · 환경.
//! - **가짜 CLI 통합**(Windows): 사이드 채팅 시험의 가짜 Claude(`server::tests_side_chat::fake_cli` — 이 시험 실행 파일 자신)를 그대로 띄운다 —
//!   **모델 호출 없음**. 종료 순서(`producer_end_order`) · 정책 거절이 실제 프로세스까지(`denied-by-policy` → 가짜가 거절을 받고 끝남) · 수명
//!   (`producer_lifetime_table` — TTL · 닫기 · 재시작 가능).

use std::path::Path;


const SRC: &str = include_str!("mod.rs");
const LAUNCH: &str = include_str!("launch.rs");
const INPUT: &str = include_str!("input.rs");
const WAKE: &str = include_str!("wake.rs");
const ALBUM: &str = include_str!("album.rs");

#[cfg(windows)]
#[path = "tests_album.rs"]
mod album;

/// `fn name(` 의 몸(그 줄의 들여쓰기와 같은 닫는 `}` 까지 — 줄 끝은 LF 로 편다).
fn body_of(src: &str, sig: &str) -> String {
    let src = src.replace("\r\n", "\n");
    let at = src.find(sig).unwrap_or_else(|| panic!("{sig} 없음"));
    let line_start = src[..at].rfind('\n').map_or(0, |i| i + 1);
    let indent = &src[line_start..at];
    let indent: String = indent.chars().take_while(|c| *c == ' ').collect();
    let rest = &src[at..];
    let end = rest.find(&format!("\n{indent}}}\n")).unwrap();
    rest[..end].to_string()
}

/// 주석 줄을 뺀 코드(시험 모듈 선언 줄도 뺀다).
fn code_lines(src: &str) -> String {
    src.replace("\r\n", "\n").lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
}

/// 설계 9절 단계 2 `producer_spawns_only_from_dispatch` — 프로듀서 프로세스의 생성은 공용 코어의 `chat_proc::start` 하나이고, 그것을 부르는
/// 곳은 이 레지스트리의 `spawn` 하나, `spawn` 은 전송 길의 `ensure_ready` 에서만, `ensure_ready` 는 사람 op 둘(보내기 · 쉬는 중의 끊고 전달)
/// 에서만 부른다(`open` · 부팅 · 시계 · MCP 는 띄우지 않는다).
#[test]
fn producer_spawns_only_from_dispatch() {
    let src = code_lines(SRC);
    assert!(!src.contains("spawn_in_job") && !src.contains("Command::new") && !LAUNCH.contains("spawn_in_job"));
    assert_eq!(src.matches("chat_proc::start(").count(), 1);
    assert!(body_of(SRC, "fn spawn(").contains("chat_proc::start(chat, st, proc, l)"));
    assert_eq!(src.matches("spawn(chat, &mut st, pre)").count(), 1, "spawn 을 부르는 곳은 하나");
    assert!(body_of(SRC, "fn ensure_ready<").contains("spawn(chat, &mut st, pre)"));
    assert_eq!(src.matches("ensure_ready(&chat, st, pre.as_ref())").count(), 2);
    assert!(body_of(SRC, "fn op_send(").contains("ensure_ready(&chat, st, pre.as_ref())"));
    assert!(body_of(SRC, "fn op_interrupt(").contains("ensure_ready(&chat, st, pre.as_ref())"));
    assert!(SRC.contains("\"producer_chat_send\" => op_send(body(b)?)"));
    // 토큰은 띄우기 직전에 그 세대로 — MCP 없이 띄우지 않는다.
    let sp = body_of(SRC, "fn spawn(");
    assert!(sp.contains("crate::chat_token::issue_producer(&chat.id, proc, &st.repo, st.album.as_deref(), pre.plan_tools)"));
    assert!(sp.contains("producer-mcp-unavailable"));
    assert_eq!(src.matches("issue_producer(").count(), 1);
    // 새 사람 시작도 같은 준비 함수를 쓴다. ref → 프로세스 → 확정 → 전송 순서는 바뀌면 안 된다.
    let album = code_lines(ALBUM);
    let prepare = album.find(".prepare_album(").unwrap();
    let ready = album.find("ensure_ready(").unwrap();
    let commit = album.find("prepared.commit(").unwrap();
    let dispatch = album.find("dispatch(&chat, &mut st, src, text)").unwrap();
    assert!(prepare < ready && ready < commit && commit < dispatch);
    assert_eq!(album.matches("ensure_ready(").count(), 1);
    assert!(!album.contains("chat_proc::start(") && !album.contains("issue_producer("));
}

/// 설계 9절 단계 2 · 4 `producer_stdin_only_human_or_wake` — **새 사용자 턴의 본문**(`encode_user`)을 짓는 곳은 전송기 `dispatch` 하나이고, 그
/// 글은 입력 상태기계가 사람 op 에서 받은 것(보내기 · 대기열)과 **깨움 하나**(단계 4 — `Src::Wake`: 오케스트레이션이 Run 장부에서 제한된 타입으로
/// 지은 문장 `wake_text` · 짓는 곳 하나 · 부르는 곳 하나)뿐이다. 제어 프레임(결정 · 끊기 · 모델 · 강도 — 시험 이름
/// `producer_control_frames_only_from_human_ops` 의 몫)은 사람 op 에서만 — 예외는 깨움 턴 시한의 끊기 하나(시계가 깨움 턴에만 붙인다).
/// 어댑터 밖(레지스트리 · 코어)에서 이 길을 짓는 다른 곳은 없다.
#[test]
fn producer_stdin_only_human_or_wake() {
    let src = code_lines(SRC);
    let wake = code_lines(WAKE);
    assert_eq!(src.matches(".encode_user(").count(), 1);
    assert!(!wake.contains(".encode_") && !wake.contains("chat_proc::apply("), "깨움도 전송기를 거친다");
    assert!(body_of(SRC, "fn dispatch(").contains("a.encode_user(&text, &[], Some(&id))"));
    assert!(!LAUNCH.contains(".encode_") && !INPUT.contains(".encode_"));
    // 전송기를 부르는 곳 = 보내기 · 쉬는 중의 끊고 전달(사람 op) · 턴 끝의 대기열 처리(사람이 이미 보낸 글) · 깨움.
    assert_eq!(src.matches("dispatch(&chat, &mut st, src, text)").count(), 2);
    assert!(body_of(SRC, "fn op_send(").contains("dispatch(&chat, &mut st, src, text)"));
    assert!(body_of(SRC, "fn op_interrupt(").contains("dispatch(&chat, &mut st, src, text)"));
    assert_eq!(src.matches("dispatch(self, st, src, text)").count(), 1);
    assert!(body_of(SRC, "fn on_event(").contains("st.input.turn_ended(end, now_ms())"));
    // 깨움 — 전송기 하나 · 글은 예약의 문장 하나(`Reserved.text` = `wake_text`) · 나머지 둘은 예약을 거둔 뒤의 대기열(사람 글).
    let fire = body_of(WAKE, "fn fire(");
    assert_eq!(wake.matches("dispatch(c, &mut st, src, text)").count(), 3);
    assert_eq!(wake.matches("st.input.start_wake(").count(), 1);
    let at = fire.find("let src = st.input.start_wake(&r.wake_id, &r.text, now_ms());").unwrap();
    assert!(fire[at..].starts_with("let src = st.input.start_wake(&r.wake_id, &r.text, now_ms());\n        st.wake_view = Some(r.event);\n        let text = r.text;\n        if dispatch(c, &mut st, src, text) {"));
    assert_eq!(fire.matches("st.input.release_wake(now_ms())").count(), 2, "거둔 뒤 = 대기열의 사람 글");
    let orch_wake = std::fs::read_to_string("src/orchestration/wake.rs").unwrap();
    assert!(orch_wake.contains("let text = wake_text(&note);") && orch_wake.contains("Some(Reserved { wake_id, text, event })"));
    // 입력 상태기계의 출처 — 사람(보내기 · 대기열)과 깨움. 깨움 글은 대기열에 넣지 않는다.
    let srcs = body_of(INPUT, "pub(crate) enum Src {");
    assert!(srcs.contains("Human {") && srcs.contains("Queue {") && srcs.contains("Wake {"));
    assert_eq!(INPUT.matches("self.queue.push_back(").count(), 1, "대기열에 넣는 곳은 사람 보내기 하나");
    assert!(body_of(INPUT, "pub(crate) fn submit(").contains("self.queue.push_back("));
    assert!(body_of(INPUT, "    fn fail_back(").contains("if src.is_wake() {"), "깨움 글은 대기열로 되돌리지 않는다");
    // 제어 프레임 — 사람 op 에서만(+ 깨움 턴 시한의 끊기).
    assert_eq!(src.matches(".encode_decision(").count(), 1);
    assert!(body_of(SRC, "fn op_decide(").contains(".encode_decision(&b.request_id, decision, b.message.as_deref())"));
    assert_eq!(src.matches(".encode_interrupt(").count(), 1);
    assert!(body_of(SRC, "fn send_interrupt(").contains(".encode_interrupt()"));
    assert_eq!(src.matches("send_interrupt(").count(), 3, "정의 + 사람 끊기 + 턴 시작 즉시 끊기(사람이 붙인 의도)");
    assert_eq!(wake.matches("send_interrupt(").count(), 1);
    assert!(wake.contains("if st.core.live() == Some(proc) && st.input.stop_wake() {\n                send_interrupt(&c, &mut st);"));
    assert!(body_of(INPUT, "pub(crate) fn stop_wake(").contains("Phase::Running { src: Src::Wake { .. }, stop }"), "깨움 턴에만");
    assert_eq!(src.matches(".encode_set_model(").count(), 1);
    assert!(body_of(SRC, "fn op_set_model(").contains(".encode_set_model("));
    assert_eq!(src.matches(".encode_set_effort(").count(), 1);
    assert!(body_of(SRC, "fn op_set_effort(").contains(".encode_set_effort("));
    // 코어로 가는 길은 `chat_proc::apply` 뿐 — 그 자리 = 전송기 · 끊기 · 모델 · 강도 · 결정.
    assert_eq!(src.matches("chat_proc::apply(").count(), 5);
    // MCP · 오케스트레이션 · 사이드 채팅 표는 프로듀서 op · 모듈을 모른다.
    for f in ["src/mcp/rpc.rs", "src/mcp/http.rs", "src/orchestration/tools.rs", "src/orchestration/start.rs", "src/server/side_chat.rs"] {
        let s = std::fs::read_to_string(f).unwrap();
        assert!(!s.contains("producer::") && !s.contains("\"producer_chat_"), "{f}");
    }
}

/// 설계 2-6 `producer_lock_order` — 채팅 잠금(L4)을 쥔 채 오케스트레이션(L1)을 부르지 않는다: 코어 콜백 중 잠금 안의 것(`on_event` ·
/// `on_ending`)과 잠금 안 도우미(`dispatch` · `close_proc` · `send_interrupt`)에는 `orch()` 가 없다(턴 끝의 커서 · 깨움 끝은 `orch_later` 일꾼에게) ·
/// `on_exit` 은 오케스트레이션을 먼저 부르고 그 뒤에 잠근다 · 깨움(`wake.rs`)은 잠금 구역 사이에서만 오케스트레이션을 부른다 · 오케스트레이션
/// 쪽은 프로듀서 · 사이드 채팅 모듈을 부르지 않는다.
#[test]
fn producer_lock_order() {
    let on_event = body_of(SRC, "fn on_event(");
    assert_eq!(on_event.matches("orch()").count(), 0);
    assert_eq!(on_event.matches("orch_later(move |o|").count(), 2, "턴 시작 · 턴 끝의 오케스트레이션 일은 일꾼에게");
    let ol = body_of(SRC, "fn orch_later(");
    assert!(ol.contains("later(move ||") && ol.contains("orch()"));
    for f in ["fn on_ending(", "fn dispatch(", "fn close_proc(", "fn send_interrupt(", "fn ensure_ready<", "fn spawn("] {
        assert!(!body_of(SRC, f).contains("orch()"), "{f}");
    }
    let on_exit = body_of(SRC, "fn on_exit(");
    assert!(on_exit.find("coordinator_exited_seat").unwrap() < on_exit.find("lock(&self.st)").unwrap(), "묶음 해제 뒤에 잠근다");
    let interrupt = body_of(SRC, "fn op_interrupt(");
    assert!(interrupt.find("cancel_seat_waits").unwrap() < interrupt.find("let mut st = lock(&chat.st)").unwrap(), "대기 취소는 잠금 앞");
    let sweep = body_of(SRC, "pub(crate) fn sweep(");
    assert!(sweep.find("producer_album").unwrap() < sweep.find("let mut st = lock(&c.st)").unwrap());
    // 깨움 — ① 잠금 구역(블록) → ② `wake_reserve`(잠금 밖) → ③ 잠금 · 그 뒤 오케스트레이션은 일꾼으로만.
    let fire = body_of(WAKE, "fn fire(");
    let first = fire.find("let rest = {").unwrap();
    let first_end = first + fire[first..].find("\n    };").unwrap();
    let reserve = fire.find("o.wake_reserve(").unwrap();
    let third = fire.find("let mut st = lock(&c.st);\n    let kept").unwrap();
    assert!(first_end < reserve && reserve < third);
    assert!(!fire[first..first_end].contains("o."), "① 안에서 오케스트레이션 없음");
    let after = &fire[third..];
    assert_eq!(after.matches("o.wake_").count(), after.matches("orch_later(move |o| o.wake_").count(), "③ 뒤는 일꾼으로만");
    let tick = body_of(WAKE, "pub(super) fn tick(");
    let snap_end = tick.find("let s = seat(&c.id, proc);").unwrap();
    assert!(tick.find("let (proc, idle_now, rest) = {").unwrap() < snap_end);
    assert!(tick[snap_end..].find("o.wake_overdue(&s)").unwrap() < tick[snap_end..].find("let mut st = lock(&c.st);").unwrap());
    fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(Path::new("src/orchestration"), &mut files);
    for f in files.iter().filter(|f| !f.to_string_lossy().contains("tests")) {
        let s = std::fs::read_to_string(f).unwrap();
        let code: String = s.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        assert!(!code.contains("producer::") && !code.contains("side_chat::"), "{}", f.display());
    }
}

/// 설계 1-2 `producer_args_policy` — Claude: 읽기 셋만 · 웹 없음 · 설정 출처 끔 · 엄격 MCP · stdio 권한 질문 · `MCP_TOOL_TIMEOUT` · 지침 파일.
/// Codex: 웹 검색 끔 · 샌드박스 몸 · `notify` 끔 · 외부 MCP 없음 · 스레드 `never` · 사용자 MCP 이름별 끔(건너뛴 이름이면 띄우지 않음).
#[test]
fn producer_args_policy() {
    use crate::side_chat::event::Mode;
    use crate::side_chat::{claude, codex};
    let allowed = vec!["mcp__aynx-sessions__start_run".to_string()];
    let o = claude::Opts {
        exe: "claude.exe",
        mode: Mode::Fresh,
        session_id: "11111111-2222-4333-8444-555555555555",
        model: "",
        effort: None,
        settings_file: "s.json",
        mcp_config_file: "m.json",
        append_file: Some("i.md"),
        mcp_allowed: &allowed,
    };
    let a = claude::producer_argv(&o).unwrap();
    let at = |k: &str| a.iter().position(|x| x == k).unwrap_or_else(|| panic!("{k} 없음: {a:?}"));
    assert_eq!(a[at("--tools") + 1], "Read,Grep,Glob");
    assert_eq!(a[at("--setting-sources") + 1], "");
    assert_eq!(a[at("--permission-prompt-tool") + 1], "stdio");
    at("--strict-mcp-config");
    assert!(!a.iter().any(|x| x.contains("WebSearch") || x.contains("WebFetch")), "{a:?}");
    assert!(a.contains(&"Read(./**)".to_string()) && a.contains(&allowed[0]));
    assert!(LAUNCH.contains("add.push((\"MCP_TOOL_TIMEOUT\".into(), MCP_TOOL_TIMEOUT_MS.into()));"));
    assert!(super::launch::MCP_TOOL_TIMEOUT_MS.parse::<u64>().unwrap() >= 130_000, "wait_run 120초 위");
    let names = vec!["node_repl".to_string()];
    let tools = ["start_run"];
    let x = codex::Opts {
        exe: "codex.exe",
        mode: Mode::Fresh,
        cwd: "C:/srv/empty",
        model: "",
        effort: None,
        mcp_names: &names,
        client_version: "0",
        mcp: Some(codex::Mcp { name: "aynx-sessions", url: "http://127.0.0.1:1/mcp", token_env: "AYNX_MCP_TOKEN", tools: &tools }),
        external: &[],
    };
    let c = codex::producer_argv(&x).unwrap();
    for want in ["web_search=\"disabled\"", "windows.sandbox=\"unelevated\"", "notify=[]", "mcp_servers.node_repl.enabled=false"] {
        assert!(c.contains(&want.to_string()), "{want}: {c:?}");
    }
    assert!(!c.iter().any(|v| v.contains("context_size") || v == "web_search=\"live\""), "{c:?}");
    assert!(LAUNCH.contains("external: &[],"), "외부 MCP 없음");
    assert!(LAUNCH.contains("\"external-mcp-unblockable\""));
    assert!(LAUNCH.contains(".producer(album_instructions(&st.repo, st.album.as_deref(), Cli::Codex))"));
    assert!(include_str!("../../side_chat/codex.rs").contains("self.approval = \"never\";"));
    // 고정 지침(U1) — 사람이 일을 맡길 때만 앨범 · 애매하면 먼저 묻기 · 스튜디오 경로 · 주 폴더 직접 고치지 말 것.
    let ins = super::launch::album_instructions("C:/repo", Some("run-test"), crate::side_chat::Cli::Codex);
    // 사람이 멈춘 앨범은 wait_run 으로 기다리지 않는다(실기 a — 다시 붙인 프로듀서가 2분 넘게 "응답 중") — Claude · Codex 같은 글.
    for cli in [crate::side_chat::Cli::Claude, crate::side_chat::Cli::Codex] {
        let ins = super::launch::album_instructions("C:/repo", Some("run-test"), cli);
        for want in ["C:/repo", "A person opened this album", "only they can change them", "Never change the repository's main folder", "adopt_run", "paused by the person, do not wait for it with wait_run", "only the ones in your current tool list"] {
            assert!(ins.contains(want), "{want}");
        }
        // 사이드 채팅의 답변 지침은 프로듀서에 싣지 않는다(2026-11-01)
        assert!(!ins.contains("Answering (Aynx side chat)"), "{cli:?}");
    }
    assert!(ins.contains("end your turn"));
    // 미리 허용 — 행을 읽는 db_query 는 Claude 카드 · Codex 미리 허용(`never` 에서 카드가 설 길이 없다 — 판정은 서버의 연결 AI 권한) ·
    // 작업안 도구는 칸이 켰을 때만.
    use crate::side_chat::Cli as C;
    let off = super::launch::preallowed(false, C::Claude);
    assert!(!off.contains(&"db_query") && !off.contains(&"create_execution_plan") && off.contains(&"db_describe_table") && off.contains(&"adopt_run"));
    assert!(super::launch::preallowed(true, C::Claude).contains(&"create_execution_plan"));
    let codex_off = super::launch::preallowed(false, C::Codex);
    assert!(codex_off.contains(&"db_query") && !codex_off.contains(&"create_execution_plan") && !codex_off.contains(&"create_db_write_plan"));
    assert!(LAUNCH.contains("let tools = preallowed(plan_tools, st.cli);"));
}

/// `producer_fork_brief_fixed` — 첫 사람 글 앞 앱 머리글: 서버의 repo · run만 받고, 고정 지침으로 한 곳에서 짓고 전송기에서만 붙인다.
/// Codex · 갈라 옴 · 자신의 대화가 서기 전에만 붙이며, 깨움 틀과 섞이지 않는다.
#[test]
fn producer_fork_brief_fixed() {
    use super::launch::{album_fork_brief, album_instructions, needs_brief};
    use crate::side_chat::event::{parse_producer_brief, BRIEF_CLOSE, BRIEF_OPEN};
    use crate::side_chat::Cli::{Claude, Codex};

    for (cli, forked, conv, want) in [
        (Codex, true, false, true),
        (Codex, true, true, false),
        (Codex, false, false, false),
        (Codex, false, true, false),
        (Claude, true, false, false),
        (Claude, true, true, false),
        (Claude, false, false, false),
        (Claude, false, true, false),
    ] {
        assert_eq!(needs_brief(cli, forked, conv), want, "{cli:?} {forked} {conv}");
    }
    let repo = "C:/repo";
    let run = "run-00000000000000000000000000000001";
    let b = album_fork_brief(repo, Some(run));
    assert!(b.starts_with(BRIEF_OPEN) && b.ends_with(BRIEF_CLOSE));
    assert_eq!(&b[BRIEF_OPEN.len()..b.len() - BRIEF_CLOSE.len()], album_instructions(repo, Some(run), Codex).trim_end());
    assert!(b.contains(repo) && b.contains(run) && b.contains("Call get_run first"));
    assert!(!b.contains("Open an album with start_run"));
    assert!(b.contains("only the ones in your current tool list"));
    assert_eq!(parse_producer_brief(&format!("{b}hello")), Some("hello"));
    assert_eq!(parse_producer_brief(&b), Some(""));
    assert!(parse_producer_brief(&format!("x{b}")).is_none());
    assert!(!b.starts_with(crate::orchestration::wake::PREFIX));
    assert!(crate::orchestration::wake::parse_wake_note(&format!("{b}x")).is_none());

    // 짓는 곳 하나 · 인자는 서버의 repo · run뿐 · 몸 전체가 틀 + 같은 고정 지침(사람 · AI 문자열 없음).
    assert_eq!(LAUNCH.matches("fn album_fork_brief(").count(), 1);
    assert_eq!(
        body_of(LAUNCH, "pub(super) fn album_fork_brief("),
        concat!(
            "pub(super) fn album_fork_brief(repo: &str, run: Option<&str>) -> String {\n",
            "    use crate::side_chat::event::{BRIEF_CLOSE, BRIEF_OPEN};\n",
            "    format!(\"{BRIEF_OPEN}{}{BRIEF_CLOSE}\", album_instructions(repo, run, Cli::Codex).trim_end())"
        )
    );
    let event = include_str!("../../side_chat/event.rs");
    assert_eq!(event.matches("BRIEF_OPEN").count() - event.matches("[`BRIEF_OPEN`]").count(), 2, "정의 + 읽기");

    // 붙이는 곳 하나 — 전송기 · 깨움 아님 · 기록 판독 시험 감싸개는 따로 센다.
    let src = code_lines(SRC);
    assert_eq!(src.matches("album_fork_brief(").count(), 2, "전송기 하나 + 기록 판독 시험 감싸개");
    let d = body_of(SRC, "fn dispatch(");
    assert!(d.contains("let text = if !wake && launch::needs_brief(st.cli, st.fork_from.is_some(), st.conversation.is_some()) {"));
    assert!(d.contains("format!(\"{}{text}\", launch::album_fork_brief(&st.repo, st.album.as_deref()))"));
    assert_eq!(d.matches("album_fork_brief(").count(), 1);
    assert!(d.find("launch::album_fork_brief").unwrap() < d.find(".encode_user(").unwrap());
    assert_eq!(
        body_of(SRC, "pub(crate) fn album_brief_for_test("),
        "pub(crate) fn album_brief_for_test(repo: &str) -> String {\n    launch::album_fork_brief(repo, Some(\"run-test\"))"
    );
    let old_name = regex::Regex::new(r"\bfork_brief\(").unwrap();
    for source in [SRC, LAUNCH, INPUT, WAKE, ALBUM] {
        assert!(!old_name.is_match(source), "옛 fork_brief 함수는 되살리지 않는다");
    }
    for source in [INPUT, WAKE, ALBUM] {
        assert!(!code_lines(source).contains("album_fork_brief(") && !code_lines(source).contains("BRIEF_OPEN"));
    }
}

// ---------------------------------------------------------------------------
// 가짜 CLI 통합
// ---------------------------------------------------------------------------



#[cfg(windows)]
mod live {
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};

    use super::super::{handle, set_end_grace_for_test, FakeCli, FAKE, TEST_EVENTS, TEST_ORCH};

    /// 사이드 채팅 시험의 가짜 Claude(같은 실행 파일 · 같은 시험 이름 · 같은 환경 표지).
    const FAKE_ENV: &str = "AYNX_TEST_SIDE_CHAT_FAKE";
    const FAKE_TEST: &str = "server::tests_side_chat::fake_cli";

    // 시험 서버의 shutdown/close_all도 같은 전역 프로듀서 표를 비운다.
    pub(super) use crate::server::tests::live::SESSION_STATE as SERIAL;

    pub(super) fn setup(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("aynx-producer-{tag}-{}-{}", std::process::id(), crate::operations::now_ms()));
        std::fs::create_dir_all(&root).unwrap();
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        *FAKE.lock().unwrap() = Some(FakeCli {
            exe,
            args: [FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env: vec![(FAKE_ENV.into(), "1".into())],
            root: root.clone(),
            mcp_port: Some(1),
            conv_roots: Vec::new(),
        });
        *TEST_ORCH.lock().unwrap() = Some(Arc::new(crate::orchestration::Orchestration::new(None, Arc::new(|_: &str, _: Value| {}), None)));
        TEST_EVENTS.lock().unwrap().clear();
        root
    }

    pub(super) fn teardown(root: &std::path::Path) {
        *FAKE.lock().unwrap() = None;
        *TEST_ORCH.lock().unwrap() = None;
        set_end_grace_for_test(None);
        let _ = std::fs::remove_dir_all(root);
    }

    pub(super) fn ok(op: &str, b: Value) -> Value {
        handle(op, b, 1).unwrap_or_else(|e| panic!("{op}: {}", e.message))
    }

    pub(super) fn err(op: &str, b: Value) -> String {
        handle(op, b, 1).err().unwrap_or_else(|| panic!("{op} 는 실패해야 한다")).message
    }

    /// 그 채팅의 사건 중 `stop`(사건 몸 전체 — `epoch` · `ev`)이 참인 첫 것까지 기다린다(30초).
    fn wait_body(chat: &str, stop: impl Fn(&Value) -> bool) -> Vec<Value> {
        let t = Instant::now();
        loop {
            let evs: Vec<Value> = TEST_EVENTS.lock().unwrap().iter().filter(|e| e["chat"] == chat).cloned().collect();
            if evs.iter().any(&stop) {
                return evs;
            }
            assert!(t.elapsed() < Duration::from_secs(30), "사건을 기다리다 시한: {evs:?}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    pub(super) fn wait_ev(chat: &str, stop: impl Fn(&Value) -> bool) -> Vec<Value> {
        wait_body(chat, |b| stop(&b["ev"]))
    }

    // 수명·구독 시험도 사람이 연 앨범의 이어받기 채팅으로 시작한다.
    fn open(chat: &str, root: &std::path::Path) -> Value {
        let o=TEST_ORCH.lock().unwrap().as_ref().unwrap().clone();
        crate::orchestration::test_album::delegate_all(&o);
        let (run,_)=o.start_run(crate::orchestration::album_start::StartRun {
            name:"사람 앨범".into(),repo:root.display().to_string(),worktree_dir:root.display().to_string(),limits:Default::default(),verify:None
        }).unwrap();
        o.pause(&run).unwrap();
        ok("producer_chat_open",serde_json::json!({"chat":chat,"cli":"claude","model":"","mode":{"kind":"adopt","run":run}}))
    }

    fn last_sub_windows(chat: &str) -> Vec<String> {
        let evs = TEST_EVENTS.lock().unwrap();
        let last = evs.iter().rev().find(|e| e["chat"] == chat).expect("사건");
        let mut w: Vec<String> = last["subs"].as_array().unwrap().iter().map(|s| s["window"].as_str().unwrap().to_string()).collect();
        w.sort();
        w
    }

    fn poke(chat: &str) {
        let c = super::super::find(chat).unwrap();
        let st = c.st.lock().unwrap();
        super::super::notice(&c, &st, "queue-changed", None);
    }

    #[test]
    fn producer_end_order() {
        let _g = SERIAL.blocking_lock();
        let root = setup("end");
        let chat = format!("pc-end-{}", std::process::id());
        let snap = open(&chat, &root);
        assert_eq!(snap["epoch"], 0, "열기는 띄우지 않는다");
        let r = ok("producer_chat_send", json!({ "chat": chat, "clientId": "c1", "text": "hello" }));
        assert_eq!(r["state"], "dispatching");
        let p1 = r["epoch"].as_u64().unwrap();
        wait_ev(&chat, |e| e["t"] == "turnEnded");
        // 같은 clientId 재전송 — 같은 답 · 효과 없음.
        assert_eq!(ok("producer_chat_send", json!({ "chat": chat, "clientId": "c1", "text": "hello" }))["state"], "sent");
        assert!(err("producer_chat_send", json!({ "chat": chat, "clientId": "c1", "text": "other" })).contains("[client-id-reused]"));
        // 둘째 글 — WebFetch 권한 요청 → 정책 거절.
        ok("producer_chat_send", json!({ "chat": chat, "clientId": "c2", "text": "fetch" }));
        let evs = wait_ev(&chat, |e| e["t"] == "exited");
        assert!(evs.iter().any(|e| e["ev"]["t"] == "notice" && e["ev"]["code"] == "denied-by-policy"), "{evs:?}");
        assert!(!evs.iter().any(|e| e["ev"]["t"] == "permission"), "카드가 서지 않는다");
        let exited = evs.iter().find(|e| e["ev"]["t"] == "exited").unwrap();
        assert_eq!(exited["ev"]["why"], "crashed");
        assert_eq!(exited["ev"]["restartable"], true);
        // 끝 사건은 마지막 — 그 뒤 같은 세대의 사건이 없다 · 토큰 칸이 이미 없다.
        assert_eq!(evs.last().unwrap()["ev"]["t"], "exited");
        let st = ok("producer_chat_status", json!({ "chat": chat }));
        assert_eq!(st["snapshot"]["life"], "ended");
        assert_eq!(st["snapshot"]["ended"], "crashed");
        // 다시 띄우기 — 새 세대.
        let r = ok("producer_chat_send", json!({ "chat": chat, "clientId": "c3", "text": "again" }));
        let p2 = r["epoch"].as_u64().unwrap();
        assert!(p2 > p1, "{r}");
        wait_body(&chat, |b| b["epoch"] == p2 && b["ev"]["t"] == "turnEnded");
        // 닫기 — 레지스트리에서 지운다 · status = closed · 보내기 = session-gone.
        assert_eq!(ok("producer_chat_close", json!({ "chat": chat })), json!(true));
        assert_eq!(ok("producer_chat_status", json!({ "chat": chat }))["gone"], "closed");
        assert!(err("producer_chat_send", json!({ "chat": chat, "clientId": "c4", "text": "x" })).contains("[session-gone]"));
        teardown(&root);
    }

    #[test]
    fn producer_subs_windows_gen() {
        let _g = SERIAL.blocking_lock();
        let root = setup("subs");
        let chat = format!("pc-subs-{}", std::process::id());
        open(&chat, &root);
        let sub = |w: &str, conn: u64| -> u64 {
            handle("producer_chat_subscribe", json!({ "chat": chat, "window": w }), conn).unwrap()["subGen"].as_u64().unwrap()
        };
        let main1 = sub("main", 1);
        let aux1 = sub("aux-1", 1);
        let ra1 = sub("remote-a-1", 1);
        sub("remote-b-1", 2);
        poke(&chat);
        assert_eq!(last_sub_windows(&chat), ["aux-1", "main", "remote-a-1", "remote-b-1"]);
        // 주 창 F5 — 같은 창의 새 구독이 옛 세대를 갈음 · 옛 세대의 늦은 정리는 아무것도 지우지 않는다
        let main2 = sub("main", 1);
        assert!(main2 > main1);
        assert_eq!(super::super::detach_window("main", &[main1]), 0, "옛 세대의 늦은 정리");
        poke(&chat);
        assert_eq!(last_sub_windows(&chat), ["aux-1", "main", "remote-a-1", "remote-b-1"]);
        // 원격 창 새로 고침 = 새 라벨(새 세대) → 옛 라벨의 창 파괴 정리는 옛 창만
        sub("remote-a-2", 1);
        assert_eq!(super::super::detach_window("remote-a-1", &[ra1]), 1);
        // 다른 원격 연결이 끊김 — 그 연결의 구독만
        assert_eq!(super::super::conn_gone(2), 1);
        poke(&chat);
        assert_eq!(last_sub_windows(&chat), ["aux-1", "main", "remote-a-2"]);
        let subs = TEST_EVENTS.lock().unwrap().iter().rev().find(|e| e["chat"] == chat).unwrap()["subs"].clone();
        assert!(subs.as_array().unwrap().iter().any(|s| s["window"] == "main" && s["subGen"] == main2), "{subs}");
        // 세대를 싣지 않은 정리는 아무것도 지우지 않는다 · 그 세대를 실으면 그 구독만
        assert_eq!(super::super::detach_window("aux-1", &[]), 0);
        assert_eq!(super::super::detach_window("aux-1", &[aux1]), 1);
        // 종류를 섞지 않는다 — 사이드 채팅 id 로 프로듀서 구독 · 프로듀서 id 로 사이드 채팅 붙기
        assert!(err("producer_chat_subscribe", json!({ "chat": "sc0001", "window": "main" })).contains("[wrong-chat-kind]"));
        assert!(crate::server::side_chat::handle("side_chat_attach", json!({ "chat": chat, "window": "main" }), 1).is_err());
        ok("producer_chat_close", json!({ "chat": chat }));
        teardown(&root);
    }

    #[test]
    fn producer_two_windows_one_decision() {
        let _g = SERIAL.blocking_lock();
        let root = setup("decide");
        if let Some(f) = FAKE.lock().unwrap().as_mut() {
            f.env.push(("AYNX_TEST_SIDE_CHAT_PERM_READ".into(), "1".into()));
        }
        let chat = format!("pc-decide-{}", std::process::id());
        open(&chat, &root);
        ok("producer_chat_subscribe", json!({ "chat": chat, "window": "main" }));
        handle("producer_chat_subscribe", json!({ "chat": chat, "window": "remote-a-1" }), 2).unwrap();
        ok("producer_chat_send", json!({ "chat": chat, "clientId": "d1", "text": "hello" }));
        let evs = wait_ev(&chat, |e| e["t"] == "turnEnded");
        assert_eq!(last_sub_windows(&chat), ["main", "remote-a-1"], "{:?}", evs.last());
        let r = ok("producer_chat_send", json!({ "chat": chat, "clientId": "d2", "text": "read it" }));
        let epoch = r["epoch"].as_u64().unwrap();
        // 다른 창의 같은 clientId 재전송 — 같은 답 · 효과 없음
        assert!(handle("producer_chat_send", json!({ "chat": chat, "clientId": "d2", "text": "read it" }), 2).is_ok());
        let evs = wait_ev(&chat, |e| e["t"] == "permission");
        let req = evs.iter().find(|e| e["ev"]["t"] == "permission").unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        let decide = |d: &str, conn: u64| handle("producer_chat_decide", json!({ "chat": chat, "epoch": epoch, "requestId": req, "decision": d }), conn);
        assert_eq!(decide("allow", 1).unwrap(), json!(true));
        assert!(decide("allow", 2).err().unwrap().message.contains("[unknown-request]"), "둘째 창의 같은 결정");
        assert!(decide("deny", 2).err().unwrap().message.contains("[unknown-request]"), "둘째 창의 다른 결정");
        let evs = wait_ev(&chat, |e| e["t"] == "permissionResolved");
        assert_eq!(evs.iter().filter(|e| e["ev"]["t"] == "permissionResolved").count(), 1);
        let ended = wait_body(&chat, |b| b["ev"]["t"] == "turnEnded" && b["seq"].as_u64() > evs.last().unwrap()["seq"].as_u64());
        assert_eq!(ended.iter().filter(|e| e["ev"]["t"] == "turnStarted").count(), 2, "턴 둘(재전송은 턴을 세우지 않는다)");
        ok("producer_chat_close", json!({ "chat": chat }));
        teardown(&root);
    }

    #[test]
    fn producer_wake_dispatch() {
        let _g = SERIAL.blocking_lock();
        let root = setup("wake");
        let log = root.join("stdin.log");
        if let Some(f) = FAKE.lock().unwrap().as_mut() {
            f.env.push(("AYNX_TEST_SIDE_CHAT_STDIN".into(), log.display().to_string()));
        }
        let chat = format!("pc-wake-{}", std::process::id());
        open(&chat, &root);
        let r = ok("producer_chat_send", json!({ "chat": chat, "clientId": "w1", "text": "hello" }));
        assert_eq!(r["state"], "dispatching");
        let proc = super::super::find(&chat).unwrap().st.lock().unwrap().core.live().unwrap();
        wait_ev(&chat, |e| e["t"] == "turnEnded");
        let o = TEST_ORCH.lock().unwrap().clone().unwrap();
        let run = o.wake_test_album(&chat, proc);
        assert_eq!(crate::chat_token::album_of(&chat, proc).as_deref(), Some(run.as_str()));
        assert_eq!(o.album_producer_policy(&chat).unwrap().unwrap().2, 30);
        // 묶기 3초 · 턴 뒤 2초는 이미 지난 것으로(장부 줄 · 턴 끝을 10초 앞당긴다).
        // 시한 표 자체는 `orchestration::tests_wake::wake_due_table` · `wake_liveness` 가 통제 시계로 본다.
        o.wake_test_ledger(&run, 10_000);
        super::super::find(&chat).unwrap().st.lock().unwrap().last_turn_end = Some(crate::operations::now_ms() - 10_000);
        let t = Instant::now();
        while o.wake_test_records(&run).is_empty() {
            super::super::wake::tick();
            assert!(
                t.elapsed() < Duration::from_secs(20),
                "깨우지 않았다: {} · {:?}",
                super::super::list(),
                TEST_EVENTS.lock().unwrap().iter().filter(|e| e["chat"] == chat).map(|e| e["ev"]["t"].to_string()).collect::<Vec<_>>()
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        let evs = wait_ev(&chat, |e| e["t"] == "woken");
        let started = evs.iter().rposition(|e| e["ev"]["t"] == "turnStarted").unwrap();
        let woken = evs.iter().position(|e| e["ev"]["t"] == "woken").unwrap();
        assert!(started < woken, "표지는 턴 시작 뒤");
        let w = &evs[woken]["ev"]["wake"];
        assert_eq!(w["runId"], json!(run));
        assert_eq!(w["items"][0]["what"], "person-resumed");
        wait_ev(&chat, |e| e["t"] == "exited");
        let line = std::fs::read_to_string(&log).unwrap().lines().filter(|l| l.contains("\"type\":\"user\"")).nth(1).unwrap().to_string();
        let v: Value = serde_json::from_str(&line).unwrap();
        let text = v["message"]["content"].as_str().unwrap();
        assert!(text.starts_with(crate::orchestration::wake::PREFIX), "{text}");
        let rec = o.wake_test_records(&run);
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0].sha, crate::orchestration::verify::sha256_hex(text.as_bytes()));
        assert_eq!(rec[0].chat, chat);
        ok("producer_chat_close", json!({ "chat": chat }));
        teardown(&root);
    }

}
