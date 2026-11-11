//! 사이드 채팅 v2 2단계 시험 — 세션 서버의 프로세스 표(`server::side_chat`).
//!
//! - **소스 훑기**(불변식 — 설계 2절 · 4절): 생성은 보내기 길의 하나뿐 · stdin 에 닿는 사람 글 · 결정의 길 · 공용 정화 · MCP ·
//!   오케스트레이션에 길 없음.
//! - **가짜 CLI 통합**(Windows): 진짜 CLI 를 부르지 않는다 — 이 시험 실행 파일 자신을 [`FAKE_TEST`] 하나만 도는 꼴로 다시 띄워(환경
//!   [`FAKE_ENV`] 가 있을 때만 가짜로 돈다) stdin 을 읽고 1단계 재료(`side_chat/fixtures/claude-2.1.309.jsonl`)의 줄을 그대로 낸다.
//!   Node 를 띄우지 않은 까닭: cargo 시험이 PATH 의 node 에 기대지 않게, 그리고 새 바이너리 대상(Cargo.toml)을 늘리지 않게.
//!   libtest 가 앞에 찍는 `running 1 test` 같은 줄은 어댑터가 JSON 이 아닌 줄로 세고 버린다.

use std::path::Path;

/// 이 파일의 소스(시험 모듈이 아니다 — 그대로 훑는다).
const SRC: &str = include_str!("side_chat.rs");
/// 공용 채팅 프로세스 코어(오케스트레이션 2단계 단계 1 — 프로세스 몸이 `side_chat.rs` 에서 옮겨 갔다). 띄우기 · stdin 쓰기 · 환경 넘기기의
/// 불변식은 이제 이 셋과 `side_chat.rs` 를 함께 본다 — 검사의 강도는 그대로(같은 수 · 같은 자리).
const CORE_MOD: &str = include_str!("chat_proc/mod.rs");
const CORE_IO: &str = include_str!("chat_proc/io.rs");
const CORE_SPAWN: &str = include_str!("chat_proc/spawn.rs");
const CORE: [(&str, &str); 3] = [
    ("src/server/chat_proc/mod.rs", CORE_MOD),
    ("src/server/chat_proc/io.rs", CORE_IO),
    ("src/server/chat_proc/spawn.rs", CORE_SPAWN),
];

/// `fn name(` 의 몸(다음 최상위 `\n}` 까지).
fn body_of<'a>(src: &'a str, sig: &str) -> &'a str {
    let at = src.find(sig).unwrap_or_else(|| panic!("{sig} 없음"));
    let rest = &src[at..];
    &rest[..rest.find("\n}").unwrap()]
}

/// `src/` 아래 시험이 아닌 `.rs` 파일들(경로 `/` · 글).
fn sources() -> Vec<(String, String)> {
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
    walk(Path::new("src"), &mut files);
    files
        .into_iter()
        .filter_map(|f| {
            let name = f.to_string_lossy().replace('\\', "/");
            if name.contains("tests") || name.ends_with("test_album.rs") {
                return None;
            }
            let full = std::fs::read_to_string(&f).unwrap();
            Some((name, full.split("mod tests {").next().unwrap_or("").to_string()))
        })
        .collect()
}

/// 설계 2절 — 사이드 채팅의 생성은 공용 코어의 `os::spawn_in_job(…, Stdin::Pipe)` **하나**(`chat_proc::start` — 단계 1 에 이 파일에서
/// 옮겨 감)이고, 그것을 부르는 곳은 이 파일의 [`spawn`] 하나, [`spawn`] 은 op `side_chat_send` 의 몸(`op_send`)에서만 부른다(게으른 띄우기 —
/// `open` · 부팅은 안 띄운다). stdin 파이프를 여는 곳도 코어뿐이다.
#[test]
fn side_chat_spawns_only_from_the_send_op() {
    assert!(!SRC.contains("spawn_in_job"), "사이드 채팅 표는 직접 띄우지 않는다 — 코어 하나");
    assert_eq!(CORE_SPAWN.matches("os::spawn_in_job(").count(), 1);
    assert!(body_of(CORE_SPAWN, "pub(crate) fn start<")
        .contains("os::spawn_in_job(&l.exe, &turn::quote_argv(&l.argv), &l.cwd, &l.env, os::Stdin::Pipe)"));
    for (name, src) in [CORE[0], CORE[1]] {
        assert!(!src.contains("spawn_in_job"), "{name}");
    }
    // 코어의 띄우기를 부르는 곳 = 사이드 채팅 표의 `spawn` 하나(단계 2 에 프로듀서 레지스트리가 더해진다 — 이 목록과 함께 고친다).
    assert_eq!(SRC.matches("chat_proc::start(").count(), 1);
    assert!(body_of(SRC, "fn spawn(").contains("chat_proc::start(chat, st, proc, l)"));
    // (2단계 단계 2) 프로듀서 레지스트리가 더해졌다 — 그쪽 불변식은 `server::producer::tests::producer_spawns_only_from_dispatch`.
    let mut starts: Vec<String> = sources().into_iter().filter(|(_, s)| s.contains("chat_proc::start(")).map(|(n, _)| n).collect();
    starts.sort();
    assert_eq!(starts, vec!["src/server/producer/mod.rs".to_string(), "src/server/side_chat.rs".to_string()]);
    assert_eq!(SRC.matches("spawn(&chat, &mut st)").count(), 1, "띄우기를 부르는 곳은 하나");
    assert!(body_of(SRC, "fn op_send(").contains("spawn(&chat, &mut st)?"));
    assert!(SRC.contains("\"side_chat_send\" => op_send(body(b)?)"));
    for (name, src) in std::iter::once(("src/server/side_chat.rs", SRC)).chain(CORE) {
        for bad in ["std::process::Command", "Command::new", "spawn_shell", "spawn_program"] {
            assert!(!src.contains(bad), "{name}: {bad}");
        }
    }
    // `Stdin::Pipe` 를 쓰는 곳은 os.rs(정의)와 코어의 띄우기뿐 — 검증 · 헤드리스 턴은 `Stdin::Eof`.
    let pipes: Vec<String> = sources()
        .into_iter()
        .filter(|(n, s)| !n.ends_with("src/server/os.rs") && s.contains("Stdin::Pipe"))
        .map(|(n, _)| n)
        .collect();
    assert_eq!(pipes, vec!["src/server/chat_proc/spawn.rs".to_string()]);
    let workers = include_str!("workers.rs");
    assert!(workers.contains("os::Stdin::Eof") && !workers.contains("Stdin::Pipe"), "작업자 턴은 stdin EOF");
    let os = include_str!("os.rs");
    let vs = body_of(os, "pub(crate) fn verify_spawn(");
    assert!(vs.contains("Stdin::Eof"), "검증은 stdin EOF");
}

/// 설계 2절 ③ · 4절 `side_chat_stdin_only_human` — stdin 에 드는 **사람 글**(`encode_user`)은 op `side_chat_send` 의 몸에서만,
/// **권한 결정**(`encode_decision`)은 op `side_chat_decide` 의 몸에서만 짓는다. MCP · 오케스트레이션 · 그 밖의 어느 파일도 이 둘을
/// 부르지 않고, 사이드 채팅 op 이름 · 서버 모듈을 알지 못한다.
#[test]
fn side_chat_stdin_only_human() {
    assert_eq!(SRC.matches(".encode_user(").count(), 1);
    let send = body_of(SRC, "fn op_send(");
    assert!(send.contains(".encode_user(&text, &images, b.client_id.as_deref())"));
    // (2026-10-24) 사람이 그 글에 붙인 그림도 사람 글의 일부 — 이 몸의 몸 칸(`b.images` — 입력 칸 칩)에서만, 서버가 첨부 자리 안의 그림
    // 파일인지 본 것만(`chat_images`) 싣는다.
    assert!(send.contains("let images = chat_images(&b.images, cli == Cli::Claude)?;"));
    assert_eq!(SRC.matches("chat_images(&").count(), 1, "그림을 싣는 곳은 op_send 하나");
    assert!(body_of(SRC, "fn chat_images(").contains("crate::agent_attachments::attachments_root()"));
    // (5단계) 사람 글 앞의 **앱 고정 연결 머리글**도 이 몸에서만 붙는다 — 글 = 머리글(서버가 아는 연결 · 칩 이름 또는 거울 이름) + 사람 글,
    // 그 밖은 사람 글 그대로. 이름은 화면이 실어도 스트림은 서버 표의 것(`chat_token::link_of`)뿐이다.
    assert!(send.contains(
        "let text = if st.link_note { format!(\"{}{}\", link_header_now(&chat.id, b.link_name.as_deref()), b.text) } else { b.text.clone() };"
    ));
    // (2026-11-01) 다른 창에 보일 본문은 **사람 글 그대로**(머리글 없이) — 장부에 적을 뿐 stdin 에는 가지 않는다.
    assert!(send.contains("st.sent.push_back(Sent { client_id: b.client_id, text: b.text, files });"));
    let now = body_of(SRC, "fn link_header_now(");
    assert!(now.contains("crate::chat_token::link_of(chat)") && now.contains("link_display_name(hint, label.as_deref())"));
    assert_eq!(SRC.matches("link_header_now(&").count(), 1, "머리글을 붙이는 곳은 op_send 하나");
    assert_eq!(SRC.matches("event::link_header(").count(), 1, "머리글을 짓는 곳은 link_header_now 하나");
    assert!(body_of(SRC, "fn link_header_now(").contains("crate::side_chat::event::link_header("));
    assert_eq!(SRC.matches(".encode_decision(").count(), 1);
    assert!(body_of(SRC, "fn op_decide(").contains(".encode_decision(&b.request_id, decision, b.message.as_deref())"));
    assert!(SRC.contains("\"side_chat_decide\" => op_decide(body(b)?)"));
    assert_eq!(SRC.matches("crate::chat_token::set_link(").count(), 1);
    assert!(body_of(SRC, "fn op_link(").contains("crate::chat_token::set_link(&b.chat, b.stream)"));
    assert!(SRC.contains("\"side_chat_link\" => op_link(body(b)?)"));
    assert_eq!(SRC.matches("crate::chat_token::issue(").count(), 1);
    assert!(body_of(SRC, "fn chat_mcp(").contains("crate::chat_token::issue(id, proc)"));
    // 강도 바꾸기(사람이 칩에서 고른 낱말)도 op `side_chat_set_effort` 의 몸에서만.
    assert_eq!(SRC.matches(".encode_set_effort(").count(), 1);
    assert!(body_of(SRC, "fn op_set_effort(").contains(".encode_set_effort(b.effort.as_deref())"));
    assert!(SRC.contains("\"side_chat_set_effort\" => op_set_effort(body(b)?)"));
    // (단계 1 — 공용 코어) 지은 걸음이 stdin 에 닿는 길은 코어의 `apply` 하나이고, 이 표가 그것을 부르는 곳은 사람의 op 다섯(글 · 끊기 · 모델 ·
    // 강도 · 결정)뿐이다. 코어 안에서 stdin 에 줄을 넣는 곳은 `apply`(걸음의 줄)와 띄울 때의 악수 둘뿐이고, 코어는 어댑터의 `encode_*` 를
    // 부르지 않는다(아래 훑기 — 코어 폴더는 빼지 않는다).
    assert_eq!(SRC.matches("chat_proc::apply(").count(), 5);
    for f in ["fn op_send(", "fn op_interrupt(", "fn op_set_model(", "fn op_set_effort(", "fn op_decide("] {
        assert_eq!(body_of(SRC, f).matches("chat_proc::apply(&*chat, &mut st, step)").count(), 1, "{f}");
    }
    assert_eq!(CORE_IO.matches(".stdin.send(").count(), 1);
    assert!(body_of(CORE_IO, "pub(crate) fn apply<").contains("if p.stdin.send(line).is_err() {"));
    assert_eq!(CORE_SPAWN.matches("= tx.send(").count(), 1, "stdin 쓰기 스레드로 가는 줄은 악수 하나");
    assert!(!CORE_SPAWN.contains("stdin.send("));
    assert!(CORE_SPAWN.contains("for line in adapter.handshake() {"));
    for (name, src) in CORE {
        assert!(!src.contains(".encode_") && !src.contains("link_header"), "{name} 가 사람 글 · 결정을 짓는다");
    }
    for (name, src) in sources() {
        // (2단계 단계 2) 프로듀서 레지스트리도 같은 어댑터 얼굴로 사람 글 · 결정을 짓는다 — 그 판정은 `server::producer::tests` 의
        // `producer_stdin_only_human_or_wake`(전송기 하나 · 사람 op 에서만).
        if name.starts_with("src/side_chat/") || name == "src/server/side_chat.rs" || name.starts_with("src/server/producer/") {
            continue;
        }
        for bad in ["encode_user(", "encode_decision(", "encode_interrupt(", "encode_set_model(", "encode_set_effort(", "link_header("] {
            assert!(!src.contains(bad), "{name} 가 {bad} 를 부른다");
        }
        // (5단계) 연결을 바꾸는 것은 op `side_chat_link` 하나 — MCP · 오케스트레이션 · GUI 어디서도 표를 직접 바꾸지 않는다.
        if name != "src/chat_token.rs" {
            assert!(!src.contains("chat_token::set_link(") && !src.contains("chat_token::issue("), "{name} 가 연결 · 채팅 토큰을 바꾼다");
        }
        let mcp_or_orch = name.starts_with("src/mcp/")
            || name == "src/mcp.rs"
            || name.starts_with("src/orchestration/")
            || name == "src/orchestration.rs"
            || name == "src/server/orchestration_proxy.rs";
        let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        if mcp_or_orch {
            // (7단계) v1 의 스트림 판정(`tile_env` 의 사이드 채팅 머리)을 걷어 **맨 낱말**로 막는다 — 코드에 `side_chat` 이 한 글자도 없다
            // (op 이름 · 서버 모듈 · 어댑터 · 저장 모두). 주석 줄의 설명은 괜찮다. MCP 가 아는 것은 채팅 토큰의 `Caller::SideChat` 뿐이다.
            assert!(!code.contains("side_chat"), "{name} 에 side_chat");
        }
        if name.starts_with("src/agent_mcp") {
            // (2026-10-25) 외부 MCP 목록은 설정 칸 `side_chat` · `side_chat_no_ask` 와 그 고르기(`side_chat_selected` · `side_chat_servers`)를
            // 갖는다 — 그래도 사이드 채팅 모듈 · op 는 모른다(부르는 쪽은 서버 표 하나).
            for bad in ["side_chat::", "server::side_chat", "\"side_chat_open", "\"side_chat_send", "\"side_chat_decide"] {
                assert!(!code.contains(bad), "{name} 가 사이드 채팅 모듈 · op({bad})를 안다");
            }
        }
    }
    // 승인 등급 프레임은 여전히 `ops_approve` 하나 — 사이드 채팅 결정은 쓰기 등급이다.
    use super::ipc::{frame, Grade};
    assert_eq!(frame::required_grade("side_chat_decide"), Some(Grade::Write));
}

/// 설계 2절 `side_chat_env_uses_tile_scrub` — 사이드 채팅 CLI 의 환경은 헤드리스 턴과 같은 `turn::headless_env`(= `pty::scrub_env_names`
/// 공용 정화)에서만 짓고, 생성은 그 환경을 그대로 넘긴다(허용 목록 · 따로 고른 이름 없음).
#[test]
fn side_chat_env_uses_tile_scrub() {
    let prep = body_of(SRC, "fn prepare(");
    assert_eq!(prep.matches("turn::headless_env(").count(), 1);
    assert!(prep.contains("let env = turn::headless_env(std::env::vars(), &add);"));
    assert_eq!(SRC.matches("headless_env(").count(), 1, "환경을 짓는 곳은 하나");
    assert!(!SRC.contains("env_clear") && !SRC.contains("std::env::set_var"));
    // (단계 1) 코어는 주인이 지은 환경(`Launch.env`)을 그대로 넘긴다 — 고치거나 더하지 않는다.
    for (name, src) in CORE {
        for bad in ["headless_env(", "env_clear", "set_var", "std::env::vars", ".env.push", ".env.extend"] {
            assert!(!src.contains(bad), "{name}: {bad}");
        }
    }
    assert_eq!(CORE_SPAWN.matches("l.env").count(), 1, "환경은 생성에 그대로 하나");
    // 공용 정화가 실제로 걷는다(Aynx 토큰 · 세션 표지 — 대소문자 무관).
    let mut inherited: Vec<(String, String)> =
        crate::pty::scrub_env_names().map(|n| (n.to_ascii_lowercase(), "inherited".to_string())).collect();
    inherited.push(("CLAUDE_CONFIG_DIR".into(), "keep".into()));
    let env = crate::orchestration::turn::headless_env(inherited, &[]);
    assert!(env.iter().all(|(_, v)| v != "inherited"));
    assert!(env.iter().any(|(k, v)| k == "CLAUDE_CONFIG_DIR" && v == "keep"));
}

/// (2026-10-25) **외부 MCP 목록은 프런트가 못 끼운다** — 사이드 채팅 op 몸(`*Body`)에 서버 · 명령 · URL 칸이 없고(모르는 칸은 버려진다),
/// 띄울 때의 목록은 [`prepare`] 가 저장된 설정에서 읽는 것(`agent_mcp::side_chat_servers`) 하나뿐이며, GUI 프록시(Tauri 명령)도 그 칸을 싣지
/// 않는다. 실린 것 = Aynx 채팅 서버 + 사람이 설정에서 사이드 채팅을 고른 외부 서버(Claude `--strict-mcp-config` 그대로).
#[test]
fn side_chat_ops_take_no_server_list() {
    let mut bodies = Vec::new();
    for (at, _) in SRC.match_indices("\nstruct ") {
        let rest = &SRC[at + 1..];
        let name = rest["struct ".len()..].split(|c: char| !c.is_alphanumeric()).next().unwrap();
        if name.ends_with("Body") {
            bodies.push(&rest[..rest.find("\n}").unwrap()]);
        }
    }
    assert!(bodies.len() >= 8, "op 몸을 다 찾았다: {}", bodies.len());
    for b in &bodies {
        for bad in ["McpServer", "mcp_servers", "servers", "command", "url", "headers", "env"] {
            assert!(!b.contains(bad), "op 몸에 {bad}: {b}");
        }
    }
    assert_eq!(SRC.matches("agent_mcp::side_chat_servers(").count(), 1, "설정을 읽는 곳은 하나");
    assert!(body_of(SRC, "fn picked_servers(").contains("crate::agent_mcp::side_chat_servers(Some(cwd))"));
    assert_eq!(SRC.matches("external_mcp(").count(), 2, "정의 + prepare 의 부르기 하나");
    assert!(body_of(SRC, "fn prepare(").contains("let ext = external_mcp(st.cli, &cwd_s, &user_names.names, &mut notices);"));
    assert!(include_str!("../side_chat/claude.rs").contains("\"--strict-mcp-config\","), "사용자 CLI 설정의 서버는 싣지 않는다");
    let proxy = include_str!("side_chat_proxy.rs");
    for bad in ["McpServer", "mcp_servers", "agent_mcp"] {
        assert!(!proxy.contains(bad), "GUI 프록시가 {bad} 를 싣는다");
    }
}

/// Claude 지침 파일은 늘 선다 — 맨 앞이 답변 지침 · 그다음 검색 지침(고정 글), 그 뒤에 있으면 CLAUDE.md 둘. Codex 에는 전역 CLAUDE.md 를
/// 싣지 않는다. 답변 지침은 사이드 채팅에만 — 프로듀서 지침 길에는 없다.
#[test]
fn side_chat_instructions_always_carry_search_guide() {
    use crate::side_chat::{fixed_guide, ANSWER_GUIDE, SEARCH_GUIDE};
    let ins = body_of(SRC, "fn instructions(");
    assert!(ins.contains("turn::instructions_text(&crate::side_chat::fixed_guide(), None, &docs)"));
    assert!(SRC.contains("let append = Some(spot.write(\"instructions.md\", &instructions(&root))"));
    let body = crate::orchestration::turn::instructions_text(&fixed_guide(), None, &[("Global CLAUDE.md", "G")]).unwrap();
    assert!(body.starts_with(ANSWER_GUIDE) && body.ends_with("G\n\n"), "{body}");
    let (a, s) = (body.find("Answering (Aynx side chat):").unwrap(), body.find("Web search (Aynx side chat):").unwrap());
    assert!(a < s, "답변 지침이 검색 지침 앞");
    assert!(SEARCH_GUIDE.lines().count() <= 10 && ANSWER_GUIDE.lines().count() <= 8, "짧게");
    // 범용 글 — 직업 · OS 를 가정하지 않는다(2026-11-01 사용자)
    for bad in ["Windows", "Linux", "macOS", "developer", "engineer", "PowerShell"] {
        assert!(!ANSWER_GUIDE.contains(bad), "{bad}");
    }
    // 프로듀서 지침에는 답변 지침이 실리지 않는다(Claude 지침 파일 · Codex `developerInstructions` 둘 다 `album_instructions` 가 짓는다)
    let launch = include_str!("producer/launch.rs");
    assert!(!launch.contains("ANSWER_GUIDE") && !launch.contains("fixed_guide"), "프로듀서에 답변 지침");
    // 출처는 뒷받침하는 문장 · 문단 바로 뒤의 괄호 링크(사이트 · 문서 이름) — 키워드 링크는 그 링크가 이야기 대상일 때만(2026-11-01)
    assert!(SEARCH_GUIDE.contains("in parentheses right after the sentence"));
    assert!(SEARCH_GUIDE.contains("([A](url1), [B](url2))"));
    assert!(SEARCH_GUIDE.contains("Link a word itself only when"));
    assert!(!SEARCH_GUIDE.contains("key term itself"));
    assert!(!crate::side_chat::SEARCH_GUIDE.contains("right next to the claims"));
    assert!(!include_str!("../side_chat/codex.rs").contains("CLAUDE.md\""), "Codex 에는 CLAUDE.md 를 싣지 않는다");
}

/// 사람의 사이드 채팅 지침(`sidechat/CLAUDE.md`) — 세션 서버가 파일을 직접 읽어 두 CLI 에 싣는다: Claude 는 지침 파일의 문서 절, Codex 는
/// 고정 지침 뒤 `developerInstructions`. op 몸 · 프록시는 그 글을 나르지 않는다.
#[test]
fn side_chat_person_instructions_from_file_for_both_clis() {
    use crate::side_chat::{codex_instructions, fixed_guide};
    assert!(body_of(SRC, "fn instructions(").contains("read_capped(&root.join(store::INSTRUCTIONS_FILE))"));
    assert!(body_of(SRC, "fn prepare(").contains("let person = read_capped(&root.join(store::INSTRUCTIONS_FILE));"));
    assert!(body_of(SRC, "fn prepare(").contains("codex::Codex::new(&o).person_instructions(person.as_deref())"));
    assert!(!include_str!("side_chat_proxy.rs").contains("INSTRUCTIONS_FILE"), "GUI 프록시가 지침을 나른다");
    // 순수 — 비었으면 고정 지침만 · 있으면 머리 + 정화한 본문 · 상한에서 자른다
    assert_eq!(codex_instructions(None), fixed_guide());
    assert_eq!(codex_instructions(Some(" \n ")), fixed_guide());
    let s = codex_instructions(Some("Be brief.\r\nKorean.\u{7}"));
    assert_eq!(s, format!("{}\n\nSide chat instructions (from the person):\nBe brief.\nKorean.", fixed_guide()));
    let big = "가".repeat(crate::orchestration::turn::INSTRUCTIONS_DOC_MAX);
    let cut = codex_instructions(Some(&big));
    assert!(cut.ends_with("(truncated)") && cut.len() < fixed_guide().len() + crate::orchestration::turn::INSTRUCTIONS_DOC_MAX + 100);
}

/// 사이드 채팅 op 는 모두 등급 표에 있고(attach · list = 읽기, 나머지 = 쓰기), 서버 표의 갈래와 맞는다.
#[test]
fn side_chat_ops_have_grades() {
    use super::ipc::{frame, Grade};
    for op in ["side_chat_attach", "side_chat_list"] {
        assert_eq!(frame::required_grade(op), Some(Grade::Read), "{op}");
        assert!(super::side_chat::is_side_chat_op(op));
    }
    for op in [
        "side_chat_open",
        "side_chat_send",
        "side_chat_interrupt",
        "side_chat_set_model",
        "side_chat_set_effort",
        "side_chat_decide",
        "side_chat_close",
        "side_chat_link",
    ] {
        assert_eq!(frame::required_grade(op), Some(Grade::Write), "{op}");
        assert!(super::side_chat::is_side_chat_op(op));
        assert!(SRC.contains(&format!("\"{op}\" =>")), "{op} 의 갈래");
    }
}

// ---------------------------------------------------------------------------
// 가짜 CLI
// ---------------------------------------------------------------------------

/// 이 환경이 있을 때만 [`fake_cli`] 가 가짜 Claude 로 돈다.
const FAKE_ENV: &str = "AYNX_TEST_SIDE_CHAT_FAKE";
/// 이 환경이 있으면 가짜 CLI 가 받은 stdin 줄을 그 파일에 덧붙인다(5단계 — 연결 머리글 시험).
const STDIN_LOG_ENV: &str = "AYNX_TEST_SIDE_CHAT_STDIN";
/// 이 환경이 있으면 가짜 CLI 가 띄워진 폴더(cwd)를 그 파일에 적는다(6단계 — 갈라 오기 시험).
const CWD_LOG_ENV: &str = "AYNX_TEST_SIDE_CHAT_CWD";
/// 이 환경이 있으면 둘째 글의 권한 요청이 `WebFetch` 대신 `Read` 다(프로듀서 단계 5 — 카드 · 결정 1회 시험).
const PERM_READ_ENV: &str = "AYNX_TEST_SIDE_CHAT_PERM_READ";
/// 다시 띄울 때 고르는 시험 이름(libtest `--exact`).
const FAKE_TEST: &str = "server::tests_side_chat::fake_cli";
const CLAUDE_FIX: &str = include_str!("../side_chat/fixtures/claude-2.1.309.jsonl");

/// 가짜 Claude(`-p` stream-json) — stdin 줄마다 길이를 stderr 로 되돌리고(메아리), 재료의 줄을 낸다:
/// `initialize` → 답(0줄 — 요청 id 를 받은 것으로) · 글 1 → 글만 턴(1–11) · 글 2 → WebFetch 권한 요청(12–20)에서 답을 기다려 **허용**이면
/// 나머지(21–33) · 글 3 → 턴 시작(56–62)에서 끊기 제어 요청을 기다려 답 + 끊긴 끝(64–69) · 글 4 → 권한 요청(12–20)을 낸 채 끝 코드 3.
/// stdin EOF 면 0.
#[test]
fn fake_cli() {
    if std::env::var_os(FAKE_ENV).is_none() {
        return;
    }
    std::process::exit(run_fake());
}

fn run_fake() -> i32 {
    use std::io::{BufRead, Write};
    let fix: Vec<&str> = CLAUDE_FIX.lines().filter(|l| !l.trim().is_empty()).collect();
    let stdin = std::io::stdin();
    let mut input = stdin.lock().lines();
    let mut out = std::io::stdout().lock();
    let mut emit = |lines: &[&str]| {
        for l in lines {
            let _ = writeln!(out, "{l}");
        }
        let _ = out.flush();
    };
    let next = |input: &mut std::io::Lines<std::io::StdinLock<'_>>| -> Option<serde_json::Value> {
        let line = input.next()?.ok()?;
        eprintln!("stdin {} byte(s)", line.len());
        // (5단계 시험) 받은 줄을 그대로 적는다 — 연결 머리글이 사람 글 앞에 붙었는지 본다.
        if let Some(p) = std::env::var_os(STDIN_LOG_ENV) {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
                let _ = writeln!(f, "{line}");
            }
        }
        serde_json::from_str(&line).ok()
    };
    // (6단계 시험) 띄워진 폴더를 적는다 — 갈라 온 채팅이 그 대화의 기록된 cwd 에서 도는지 본다.
    if let (Some(p), Ok(cwd)) = (std::env::var_os(CWD_LOG_ENV), std::env::current_dir()) {
        let _ = std::fs::write(p, cwd.to_string_lossy().as_bytes());
    }
    let mut turn = 0;
    while let Some(v) = next(&mut input) {
        match (v["type"].as_str(), v["request"]["subtype"].as_str()) {
            (Some("control_request"), Some("initialize")) => {
                let id = v["request_id"].as_str().unwrap_or("");
                emit(&[&fix[0].replace("\"request_id\":\"r1\"", &format!("\"request_id\":\"{id}\""))]);
            }
            (Some("user"), _) => {
                turn += 1;
                match turn {
                    1 => emit(&fix[1..=11]),
                    2 => {
                        // (프로듀서 단계 5 시험) 권한 요청을 `Read` 로 — 프로듀서 정책 감싸개가 카드로 세우는 요청(결정 1회 시험)
                        if std::env::var_os(PERM_READ_ENV).is_some() {
                            let lines: Vec<String> = fix[12..=20].iter().map(|l| l.replace("\"tool_name\":\"WebFetch\"", "\"tool_name\":\"Read\"")).collect();
                            emit(&lines.iter().map(String::as_str).collect::<Vec<_>>());
                        } else {
                            emit(&fix[12..=20]);
                        }
                        let ans = next(&mut input).unwrap_or_default();
                        if ans["response"]["response"]["behavior"] != "allow" {
                            return 9;
                        }
                        emit(&fix[21..=33]);
                    }
                    3 => {
                        emit(&fix[56..=62]);
                        let req = next(&mut input).unwrap_or_default();
                        if req["request"]["subtype"] != "interrupt" {
                            return 8;
                        }
                        let id = req["request_id"].as_str().unwrap_or("");
                        let ok = serde_json::json!({"type": "control_response", "response": {"subtype": "success", "request_id": id}});
                        emit(&[&ok.to_string()]);
                        emit(&fix[64..=69]);
                    }
                    _ => {
                        emit(&fix[12..=20]);
                        return 3;
                    }
                }
            }
            _ => {}
        }
    }
    0
}

// ---------------------------------------------------------------------------
// 통합 — 서버 · 파이프 · 가짜 CLI
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod live {
    use super::super::ipc::frame::{self, code};
    use super::super::ipc::{BoxStream, Frame, Grade};
    use super::super::side_chat::{self, FakeCli, EVENT};
    use super::super::tests::live::{config, connect_retry, err_code, hello, ok_body, post_mcp, test_pipe, SESSION_STATE};
    use super::super::{os, serve};
    use super::{CWD_LOG_ENV, FAKE_ENV, FAKE_TEST, STDIN_LOG_ENV};
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::time::Duration;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("aynx-sidechat-srv-{tag}-{}-{}", std::process::id(), serve::now_ms()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn fake(root: &std::path::Path) {
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        side_chat::set_fake_for_test(Some(FakeCli {
            exe,
            args: [FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env: vec![(FAKE_ENV.into(), "1".into())],
            root: root.to_path_buf(),
            mcp_port: None,
            conv_roots: Vec::new(),
        }));
    }

    /// 사이드 채팅 사건을 모으는 클라이언트 — 응답을 기다리는 동안 온 사건도 줄에 넣는다.
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

        /// 실패 문구(코드는 `side-chat`).
        async fn err(&mut self, kind: Grade, op: &str, body: Value) -> String {
            match self.call(kind, op, body).await {
                Frame::Response { ok: false, error: Some(e), .. } => e.message,
                other => panic!("실패가 아님: {other:?}"),
            }
        }

        /// 그 채팅의 사건을 `stop(ev)` 이 참일 때까지 모은다(마지막 것 포함).
        async fn until(&mut self, chat: &str, stop: impl Fn(&Value) -> bool) -> Vec<Value> {
            let mut got = Vec::new();
            loop {
                let body = match self.evs.pop_front() {
                    Some(b) => b,
                    None => match self.read().await {
                        Frame::Event { name, body, .. } if name == EVENT => body,
                        _ => continue,
                    },
                };
                if body["chat"] != chat {
                    continue;
                }
                let done = stop(&body["ev"]);
                got.push(body);
                if done {
                    return got;
                }
            }
        }
    }

    fn t(ev: &Value) -> &str {
        ev["t"].as_str().unwrap_or("")
    }

    /// 사건 번호는 채팅마다 빈틈 없이 1씩 · 세대 · 보는 창들은 그대로.
    fn check_run(evs: &[Value], last_seq: &mut u64, epoch: u64, windows: &[&str]) {
        for e in evs {
            let seq = e["seq"].as_u64().unwrap();
            assert_eq!(seq, *last_seq + 1, "빈틈: {e}");
            *last_seq = seq;
            assert_eq!(e["epoch"], epoch, "{e}");
            assert_eq!(e["windows"], json!(windows), "보는 창에만: {e}");
        }
    }

    fn kinds(evs: &[Value]) -> Vec<String> {
        evs.iter().map(|e| t(&e["ev"]).to_string()).collect()
    }

    /// 띄우기(첫 보내기) → 악수 · 준비 → 글 턴(조각 모으기) → 낡은 세대 거절 → 권한 요청 · 다시 붙기 스냅숏 · 사람의 허용 → 끊기 →
    /// 권한 요청을 둔 채 프로세스가 죽음(`by: closed` · `exited`) → 다시 보내면 새 세대 → F5(떼어 둠 · 다시 붙기) → 연결 끊김 TTL 닫기 →
    /// [모든 세션 종료] → 서버 끝. 진짜 CLI · 모델 호출 없음(가짜 CLI).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn side_chat_process_lifecycle_with_fake_cli() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("life");
        fake(&root);
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        let chat = "sc0001";

        // ── 열기 = 뜻만(띄우지 않음) · 등급 · 거절 ──
        let open = json!({ "chat": chat, "cli": "claude", "model": "haiku", "mode": { "kind": "fresh" }, "window": "main" });
        assert_eq!(err_code(a.call(Grade::Read, "side_chat_open", open.clone()).await), code::GRADE_MISMATCH);
        let snap = a.ok(Grade::Write, "side_chat_open", open.clone()).await;
        assert_eq!((snap["epoch"].as_u64(), snap["status"].as_str(), snap["seq"].as_u64()), (Some(0), Some("stopped"), Some(0)));
        assert!(!root.join(".run").exists() || std::fs::read_dir(root.join(".run")).unwrap().next().is_none(), "열기는 아무것도 띄우지 않는다");
        let mut fork = open.clone();
        fork["chat"] = json!("sc0002");
        fork["mode"] = json!({ "kind": "fork", "from": "11111111-2222-4333-8444-000000000001" });
        assert!(a.err(Grade::Write, "side_chat_open", fork).await.contains("[conversation-not-found]"), "가짜 색인이 비었다");
        let mut bad = open.clone();
        bad["chat"] = json!("../x");
        assert!(a.err(Grade::Write, "side_chat_open", bad).await.contains("[bad-chat]"));
        let mut badm = open.clone();
        badm["model"] = json!("haiku --dangerously");
        assert!(a.err(Grade::Write, "side_chat_open", badm).await.contains("[bad-model]"));
        // 빈 모델 = CLI 기본(4단계 칩) — 받는다(다른 채팅 · 곧바로 닫음)
        let mut dflt = open.clone();
        dflt["chat"] = json!("sc0003");
        dflt["model"] = json!("");
        assert_eq!(a.ok(Grade::Write, "side_chat_open", dflt).await["model"].as_str(), Some(""));
        assert_eq!(a.ok(Grade::Write, "side_chat_close", json!({ "chat": "sc0003" })).await, true);
        let listed = a.ok(Grade::Read, "side_chat_list", json!({})).await;
        assert_eq!(listed.as_array().unwrap().len(), 1);

        // ── 첫 보내기 = 띄우기 → 준비 → 글 턴 ──
        let mut seq = 0u64;
        let r = a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": 0, "text": "hello", "clientId": "c1" })).await;
        let e1 = r["epoch"].as_u64().unwrap();
        assert!(e1 > 0, "세대는 서버 전역 ProcId — 0(없음)이 아니다");
        let evs = a.until(chat, |e| t(e) == "turnEnded").await;
        check_run(&evs, &mut seq, e1, &["main"]);
        let k = kinds(&evs);
        assert_eq!(&k[..3], ["ready", "turnStarted", "userAccepted"], "{k:?}");
        assert_eq!(evs[0]["ev"]["version"], "2.1.309");
        assert_eq!(evs[2]["ev"]["clientId"], "c1");
        // 사람이 보낸 본문이 얹혀 온다(다른 창이 곧바로 그린다 — 그림이 없으면 `files` 칸 없음)
        assert_eq!(evs[2]["ev"]["text"], "hello");
        assert!(evs[2]["ev"].get("files").is_none());
        assert!(k.contains(&"text".to_string()) && k.contains(&"textDelta".to_string()), "{k:?}");
        assert_eq!(evs.last().unwrap()["ev"]["outcome"], "ok");

        // ── 낡은 세대 ──
        let stale = a.err(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": 0, "text": "x" })).await;
        assert!(stale.contains("[stale-chat]"), "{stale}");

        // ── 권한 요청 → 다시 붙기(새 창) 스냅숏 → 사람의 허용 ──
        a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": e1, "text": "fetch it", "clientId": "c2" })).await;
        let evs = a.until(chat, |e| t(e) == "permission").await;
        check_run(&evs, &mut seq, e1, &["main"]);
        let req = evs.last().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        assert_eq!(evs.last().unwrap()["ev"]["toolName"], "WebFetch");
        let snap = a.ok(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": "main2" })).await;
        assert_eq!((snap["status"].as_str(), snap["leaseEpoch"].as_u64()), (Some("running"), Some(2)));
        assert_eq!(snap["pending"].as_array().unwrap().len(), 1);
        assert_eq!(snap["pending"][0]["requestId"], req.as_str());
        assert!(!snap["liveTurn"].as_array().unwrap().is_empty());
        assert!(snap["seq"].as_u64().unwrap() >= seq);
        let unknown = a
            .err(Grade::Write, "side_chat_decide", json!({ "chat": chat, "epoch": e1, "requestId": "nope", "decision": "allow" }))
            .await;
        assert!(unknown.contains("[unknown-request]"));
        a.ok(Grade::Write, "side_chat_decide", json!({ "chat": chat, "epoch": e1, "requestId": req, "decision": "allow" })).await;
        let evs = a.until(chat, |e| t(e) == "turnEnded").await;
        let resolved = evs.iter().find(|e| t(&e["ev"]) == "permissionResolved").expect("결정 사건");
        assert_eq!((resolved["ev"]["by"].as_str(), resolved["ev"]["decision"].as_str()), (Some("human"), Some("allow")));
        // 다른 창이 붙은 뒤의 사건은 두 창 모두로(덧붙임 — 주 창이 끊기지 않는다).
        let after: Vec<Value> = evs.iter().filter(|e| e["seq"].as_u64().unwrap() > snap["seq"].as_u64().unwrap()).cloned().collect();
        assert!(!after.is_empty() && after.iter().all(|e| e["windows"] == json!(["main", "main2"])));
        assert_eq!(a.ok(Grade::Read, "side_chat_list", json!({})).await[0]["viewers"], 2);
        assert!(a.ok(Grade::Read, "side_chat_list", json!({})).await[0].get("window").is_none(), "남의 창 라벨은 목록에 없다");
        seq = evs.last().unwrap()["seq"].as_u64().unwrap();
        assert_eq!(evs.last().unwrap()["ev"]["outcome"], "ok");

        // ── 끊기 ──
        assert_eq!(a.ok(Grade::Write, "side_chat_interrupt", json!({ "chat": chat, "epoch": e1 })).await, false, "도는 턴이 없다");
        a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": e1, "text": "long one" })).await;
        let first = a.until(chat, |e| t(e) == "turnStarted").await;
        check_run(&first, &mut seq, e1, &["main", "main2"]);
        assert_eq!(a.ok(Grade::Write, "side_chat_interrupt", json!({ "chat": chat, "epoch": e1 })).await, true);
        let evs = a.until(chat, |e| t(e) == "turnEnded").await;
        check_run(&evs, &mut seq, e1, &["main", "main2"]);
        assert_eq!(evs.last().unwrap()["ev"]["outcome"], "interrupted");
        // 재료의 글 조각 셋(한 번에 쓴 줄)은 50ms 틈 안에서 하나로 모인다.
        let deltas = kinds(&first).iter().chain(kinds(&evs).iter()).filter(|x| *x == "textDelta").count();
        assert!((1..=2).contains(&deltas), "조각 {deltas}");
        assert_eq!(a.ok(Grade::Write, "side_chat_set_model", json!({ "chat": chat, "epoch": e1, "model": "sonnet" })).await, true);
        // 강도 — 산 프로세스에 곧바로(다시 띄우지 않는다 · 세대 그대로) · null = CLI 기본
        assert_eq!(a.ok(Grade::Write, "side_chat_set_effort", json!({ "chat": chat, "epoch": e1, "effort": "high" })).await, true);
        assert_eq!(a.ok(Grade::Write, "side_chat_set_effort", json!({ "chat": chat, "epoch": e1, "effort": null })).await, true);

        // ── 권한 요청을 둔 채 프로세스가 죽는다 → by: closed · exited ──
        a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": e1, "text": "and die" })).await;
        let evs = a.until(chat, |e| t(e) == "exited").await;
        check_run(&evs, &mut seq, e1, &["main", "main2"]);
        let k = kinds(&evs);
        let p = k.iter().position(|x| x == "permission").expect("권한 요청");
        let c = k.iter().position(|x| x == "permissionResolved").expect("닫힌 요청");
        assert!(p < c, "{k:?}");
        assert_eq!(evs[c]["ev"]["by"], "closed");
        let ex = &evs.last().unwrap()["ev"];
        assert_eq!((ex["code"].as_i64(), ex["reason"].as_str()), (Some(3), Some("crash")));
        let row = &a.ok(Grade::Read, "side_chat_list", json!({})).await[0];
        assert_eq!((row["status"].as_str(), row["model"].as_str()), (Some("stopped"), Some("sonnet")));
        let decided = a
            .err(Grade::Write, "side_chat_decide", json!({ "chat": chat, "epoch": e1, "requestId": evs[p]["ev"]["requestId"], "decision": "deny" }))
            .await;
        assert!(decided.contains("[unknown-request]"), "닫힌 요청에는 결정을 보낼 수 없다");

        // ── 다시 보내면 새 세대(이어 가기) ──
        let r = a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": e1, "text": "again" })).await;
        let e2 = r["epoch"].as_u64().unwrap();
        assert!(e2 > e1, "다시 띄우면 새 세대(전역 단조 증가)");
        let evs = a.until(chat, |e| t(e) == "turnEnded").await;
        check_run(&evs, &mut seq, e2, &["main", "main2"]);
        assert!(a.ok(Grade::Read, "side_chat_list", json!({})).await[0]["conversationId"].is_string());

        // ── F5(그 창만 뗌 — 남은 창이 있으면 떼어 두지 않는다) → 둘 다 떼면 떼어 둠 → 다시 붙기 ──
        a.ok(Grade::Write, "detach_window", json!({ "window": "main2" })).await;
        let row = &a.ok(Grade::Read, "side_chat_list", json!({})).await[0];
        assert_eq!((row["detached"].as_bool(), row["viewers"].as_u64()), (Some(false), Some(1)));
        a.ok(Grade::Write, "detach_window", json!({ "window": "main" })).await;
        let row = &a.ok(Grade::Read, "side_chat_list", json!({})).await[0];
        assert_eq!((row["detached"].as_bool(), row["viewers"].as_u64()), (Some(true), Some(0)));
        let snap = a.ok(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": "main2" })).await;
        assert_eq!((snap["epoch"].as_u64(), snap["status"].as_str()), (Some(e2), Some("ready")));
        assert_eq!(a.ok(Grade::Read, "side_chat_list", json!({})).await[0]["detached"], false);
        // 원격 웹 창이 덧붙고 그 창이 부서지면(ws 끝 = `close_window`) 그 창만 떨어진다 — 남은 창은 그대로 · 떼어 두지 않는다.
        a.ok(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": "remote-dev1-1" })).await;
        assert_eq!(side_chat::viewers_for_test(chat), Some((vec!["main2".to_string(), "remote-dev1-1".to_string()], false)));
        a.ok(Grade::Write, "close_window", json!({ "window": "remote-dev1-1" })).await;
        assert_eq!(side_chat::viewers_for_test(chat), Some((vec!["main2".to_string()], false)));

        // ── GUI 연결 끊김 → 떼어 둠 → TTL 뒤 쉬는 채팅은 닫힌다 ──
        side_chat::set_detach_ttl_for_test(Some(Duration::from_millis(300)));
        let mut b = Client::connect(&pipe).await;
        drop(a);
        let evs = b.until(chat, |e| t(e) == "exited").await;
        assert_eq!((evs.last().unwrap()["epoch"].as_u64(), evs.last().unwrap()["ev"]["reason"].as_str()), (Some(e2), Some("closed")));
        assert!(b.ok(Grade::Read, "side_chat_list", json!({})).await.as_array().unwrap().is_empty());
        side_chat::set_detach_ttl_for_test(None);

        // ── 트레이 [모든 세션 종료] = 사이드 채팅도 닫는다(세션 수에는 넣지 않는다) ──
        let chat2 = "sc0003";
        let mut o2 = open.clone();
        o2["chat"] = json!(chat2);
        b.ok(Grade::Write, "side_chat_open", o2).await;
        b.ok(Grade::Write, "side_chat_send", json!({ "chat": chat2, "epoch": 0, "text": "hi" })).await;
        b.until(chat2, |e| t(e) == "turnEnded").await;
        assert_eq!(b.ok(Grade::Write, "close_all", json!({})).await, 0);
        let evs = b.until(chat2, |e| t(e) == "exited").await;
        assert_eq!(evs.last().unwrap()["ev"]["reason"], "closed");
        assert_eq!(side_chat::live_count(), 0);
        // 임시 자리는 프로세스와 함께 지워졌다.
        let left: Vec<_> = std::fs::read_dir(root.join(".run")).map(|d| d.flatten().collect()).unwrap_or_default();
        assert!(left.is_empty(), "{left:?}");

        // ── 서버 끝 = 남은 채팅을 닫는다 ──
        let mut o3 = open.clone();
        o3["chat"] = json!("sc0004");
        b.ok(Grade::Write, "side_chat_open", o3).await;
        assert_eq!(side_chat::live_count(), 1);
        assert_eq!(b.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        assert_eq!(side_chat::live_count(), 0, "서버 끝에 채팅이 남았다");
        side_chat::set_fake_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 가짜 Claude 대화 파일 하나(`<루트>/<폴더>/<id>.jsonl` — 사람 말 · 답 한 줄씩, cwd 를 기록).
    fn claude_conversation(root: &std::path::Path, id: &str, cwd: &std::path::Path) {
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
        std::fs::write(dir.join(format!("{id}.jsonl")), body).unwrap();
    }

    fn same_dir(a: &std::path::Path, b: &std::path::Path) -> bool {
        std::fs::canonicalize(a).ok() == std::fs::canonicalize(b).ok()
    }

    /// 6단계 — **타일 대화 이어 가기**(가짜 CLI · 가짜 색인): `fork{from}` 은 색인의 기록된 cwd 를 서버가 정하고(스냅숏 `cwd` · 화면은 경로를
    /// 주지 않는다) 첫 띄우기가 그 폴더에서 돈다 · 갈라 온 원본 id 는 이어 갈 대화가 아니다(새 id) · 색인에 없는 대화 · 다른 CLI 의 대화 ·
    /// 폴더가 사라진 대화 · 틀린 id 는 거절 · `resume{project}` 는 그 대화의 기록된 cwd, `project` 없는 이어 가기는 채팅 자기 폴더.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn side_chat_fork_runs_in_the_recorded_cwd_with_fake_cli() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("fork");
        let index = root.join("claude-projects");
        let proj = root.join("tile-project");
        std::fs::create_dir_all(&proj).unwrap();
        let src = "0f0f0f0f-1111-4222-8333-444444444444";
        claude_conversation(&index, src, &proj);
        let gone_id = "0f0f0f0f-1111-4222-8333-555555555555";
        claude_conversation(&index, gone_id, &root.join("deleted-worktree"));
        let cwd_log = root.join("cwd.log");
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        side_chat::set_fake_for_test(Some(FakeCli {
            exe,
            args: [FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env: vec![(FAKE_ENV.into(), "1".into()), (CWD_LOG_ENV.into(), cwd_log.to_string_lossy().into_owned())],
            root: root.to_path_buf(),
            mcp_port: None,
            conv_roots: vec![("claude", index.clone())],
        }));
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        let open = |chat: &str, mode: Value| json!({ "chat": chat, "cli": "claude", "model": "haiku", "mode": mode, "window": "main" });

        // ── 거절 — 색인에 없음 · 다른 CLI 의 색인 · 폴더 사라짐 · 틀린 id ──
        let e = a.err(Grade::Write, "side_chat_open", open("fk01", json!({ "kind": "fork", "from": "0f0f0f0f-1111-4222-8333-999999999999" }))).await;
        assert!(e.contains("[conversation-not-found]"), "{e}");
        let mut codex = open("fk01", json!({ "kind": "fork", "from": src }));
        codex["cli"] = json!("codex");
        let e = a.err(Grade::Write, "side_chat_open", codex).await;
        assert!(e.contains("[conversation-not-found]"), "Codex 색인에서 Claude 대화를 찾지 않는다: {e}");
        let e = a.err(Grade::Write, "side_chat_open", open("fk01", json!({ "kind": "fork", "from": gone_id }))).await;
        assert!(e.contains("[conversation-folder-missing]"), "{e}");
        let e = a.err(Grade::Write, "side_chat_open", open("fk01", json!({ "kind": "fork", "from": "../etc" }))).await;
        assert!(e.contains("[bad-conversation]"), "{e}");
        let e = a.err(Grade::Write, "side_chat_open", open("fk01", json!({ "kind": "fork", "cwd": "C:/x", "from": "../x" }))).await;
        assert!(e.contains("[bad-conversation]"), "경로 칸은 읽지 않는다: {e}");
        assert!(a.ok(Grade::Read, "side_chat_list", json!({})).await.as_array().unwrap().is_empty(), "거절된 열기는 표에 남지 않는다");

        // ── 갈라 오기 — 서버가 정한 폴더 · 첫 띄우기가 그 폴더에서 ──
        let snap = a.ok(Grade::Write, "side_chat_open", open("fk01", json!({ "kind": "fork", "from": src.to_uppercase() }))).await;
        assert!(same_dir(std::path::Path::new(snap["cwd"].as_str().unwrap()), &proj), "{snap}");
        assert_eq!(snap["forkFrom"], src, "원본 id 는 소문자로");
        assert!(snap["conversationId"].is_null(), "원본은 이어 갈 대화가 아니다");
        a.ok(Grade::Write, "side_chat_send", json!({ "chat": "fk01", "epoch": 0, "text": "hello" })).await;
        let evs = a.until("fk01", |e| t(e) == "turnEnded").await;
        assert_eq!(evs.last().unwrap()["ev"]["outcome"], "ok");
        let ran = std::fs::read_to_string(&cwd_log).unwrap();
        assert!(same_dir(std::path::Path::new(&ran), &proj), "CLI 는 기록된 cwd 에서 돈다: {ran}");
        let row = a.ok(Grade::Read, "side_chat_list", json!({})).await[0].clone();
        assert!(row["conversationId"].is_string() && row["conversationId"] != src, "새 대화 id: {row}");
        assert_eq!(a.ok(Grade::Write, "side_chat_close", json!({ "chat": "fk01" })).await, true);

        // ── 서버 표를 잃은 뒤 — `resume{project}` 는 그 대화의 기록된 cwd, 보통 이어 가기는 채팅 자기 폴더 ──
        let snap = a.ok(Grade::Write, "side_chat_open", open("fk02", json!({ "kind": "resume", "conv": src, "project": true }))).await;
        assert!(same_dir(std::path::Path::new(snap["cwd"].as_str().unwrap()), &proj), "{snap}");
        assert!(snap["forkFrom"].is_null());
        let snap = a.ok(Grade::Write, "side_chat_open", open("fk03", json!({ "kind": "resume", "conv": src }))).await;
        assert!(snap["cwd"].is_null(), "project 없는 이어 가기는 채팅 자기 폴더: {snap}");
        let e = a.err(Grade::Write, "side_chat_open", open("fk04", json!({ "kind": "resume", "conv": gone_id, "project": true }))).await;
        assert!(e.contains("[conversation-folder-missing]"), "{e}");

        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        side_chat::set_fake_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// MCP `tools/call` — `(isError, 결과 글)`.
    async fn mcp_call(port: u16, token: &str, name: &str, args: Value) -> (bool, String) {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } });
        let (status, text) = post_mcp(port, token, body.to_string()).await;
        assert!(status.starts_with("HTTP/1.1 200"), "{status} {text}");
        let v: Value = serde_json::from_str(&text).unwrap();
        (v["result"]["isError"].as_bool().unwrap_or(false), v["result"]["content"][0]["text"].as_str().unwrap().to_string())
    }

    /// 사람 글 줄(stdin 기록에서 `type: user` 의 글).
    fn user_lines(log: &std::path::Path) -> Vec<String> {
        std::fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|v| v["type"] == "user")
            .map(|v| v["message"]["content"].as_str().unwrap_or("").to_string())
            .collect()
    }

    /// 5단계 — **채팅 MCP 토큰 · 연결 칩**(가짜 CLI · 실제 `/mcp`): 띄울 때 그 세대의 토큰이 임시 `--mcp-config`(Aynx 서버 + 사람이 사이드
    /// 채팅에 고른 외부 서버만 — 2026-10-25 · 볼트가 잠겨 비밀 값을 못 준비한 서버는 빼고 `mcp-locked`)에만 들고 →
    /// 목록은 세션 읽기 일곱(작업안 · DB · 조율 없음) → 연결 없으면 `not-linked` → `side_chat_link` 는 서버 거울의 창 타일만(`bad-link`) ·
    /// 연결된 세션 하나만(다른 id · `sessions` 는 `not-the-linked-session` · `list_sessions` 는 그 하나) · 읽기 허용이 꺼진 타일은 `not-readable` →
    /// 연결이 바뀐 뒤 첫 글에만 앱 고정 머리글 → 닫으면 토큰 폐기(401) · 임시 파일 지움 · 연결도 잊음. 전역 토큰의 판정은 그대로.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn side_chat_link_and_chat_token_with_fake_cli() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("link");
        let log = root.join("stdin.log");
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        let port = a.ok(Grade::Read, "mcp_coords", json!({})).await["port"].as_u64().unwrap() as u16;
        let global = a.ok(Grade::Read, "mcp_token", json!({})).await["token"].as_str().unwrap().to_string();
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        side_chat::set_fake_for_test(Some(FakeCli {
            exe,
            args: [FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env: vec![(FAKE_ENV.into(), "1".into()), (STDIN_LOG_ENV.into(), log.to_string_lossy().into_owned())],
            root: root.to_path_buf(),
            mcp_port: Some(port),
            conv_roots: Vec::new(),
        }));
        // (2026-10-25) 저장된 설정 대신 — 사이드 채팅을 고른 서버 · 고르지 않은 서버 · 비밀 값이 있는 서버(이 서버의 볼트는 없다 = 잠김)
        let ext = |name: &str, side: bool, env: bool| {
            let mut v = json!({ "name": name, "enabled": true, "transport": "stdio", "command": "node", "args": ["srv.mjs"], "side_chat": side });
            if env {
                v["env"] = json!([{ "name": "TOKEN", "secret_ref": "global/x/TOKEN:ref" }]);
            }
            serde_json::from_value::<crate::agent_mcp::McpServer>(v).unwrap()
        };
        side_chat::set_fake_servers_for_test(Some(vec![ext("plain", true, false), ext("tiles", false, false), ext("secret", true, true)]));
        let pid = std::process::id();
        let (sa, sb) = (format!("sclink-a-{pid}"), format!("sclink-b-{pid}"));
        let now = serve::now_ms();
        a.ok(
            Grade::Write,
            "ctx_batch",
            json!({ "ops": [
                { "at": now, "op": "report", "key": sa, "label": "pwsh", "kind": "local", "code": "p1", "optedIn": true, "owner": "main" },
                { "at": now, "op": "update", "key": sa, "status": "ok", "last": null, "scrollbackTail": ["link-line-1"] },
                { "at": now, "op": "report", "key": sb, "label": "secret", "kind": "local", "code": "p2", "optedIn": false, "owner": "main" },
            ]}),
        )
        .await;
        let chat = "lnk001";
        let open = json!({ "chat": chat, "cli": "claude", "model": "haiku", "mode": { "kind": "fresh" }, "window": "main" });
        assert!(a.ok(Grade::Write, "side_chat_open", open.clone()).await["link"].is_null());
        // 연결 — 모르는 스트림 · 없는 채팅 · 읽기 등급은 거절.
        assert!(a.err(Grade::Write, "side_chat_link", json!({ "chat": chat, "stream": "nope-x" })).await.contains("[bad-link]"));
        assert!(a.err(Grade::Write, "side_chat_link", json!({ "chat": "nochat", "stream": sa })).await.contains("[session-gone]"));
        assert_eq!(err_code(a.call(Grade::Read, "side_chat_link", json!({ "chat": chat, "stream": sa })).await), code::GRADE_MISMATCH);

        // ── 첫 보내기 = 띄우기 — 토큰은 그 세대의 임시 `--mcp-config` 에만 ──
        let r = a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": 0, "text": "hello" })).await;
        assert!(r["link"].is_null(), "머리글을 붙이지 않았으면 답에도 연결이 없다");
        let evs = a.until(chat, |e| t(e) == "turnEnded").await;
        let e = r["epoch"].as_u64().unwrap();
        let cfg_path = root.join(".run").join(format!("{chat}-{e}")).join("mcp.json");
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(&cfg_path).expect("채팅 mcp.json")).unwrap();
        let servers = cfg["mcpServers"].as_object().unwrap();
        // Aynx 서버 + 사람이 사이드 채팅에 고른 외부 서버만(고르지 않은 것 · 볼트가 잠겨 못 준비한 것은 없다)
        let mut keys: Vec<&str> = servers.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, [crate::instance::mcp_name(crate::instance::DEV), "plain"], "Aynx + 고른 서버만");
        assert_eq!(servers["plain"], json!({ "type": "stdio", "command": "node", "args": ["srv.mjs"] }));
        let mcp_ev = evs.iter().map(|e| &e["ev"]).find(|e| t(e) == "mcpServers").expect("실린 외부 서버 이름");
        assert_eq!(mcp_ev["names"], json!(["plain"]));
        assert!(evs.iter().map(|e| &e["ev"]).any(|e| t(e) == "notice" && e["code"] == "mcp-locked" && e["detail"] == "secret"), "{evs:?}");
        let snap = a.ok(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": "main" })).await;
        assert_eq!(snap["mcpServers"], json!(["plain"]));
        let srv = &servers[crate::instance::mcp_name(crate::instance::DEV)];
        assert_eq!(srv["url"], format!("http://127.0.0.1:{port}/mcp"));
        let tok = srv["headers"]["Authorization"].as_str().unwrap().strip_prefix("Bearer ").unwrap().to_string();
        assert_eq!(tok.len(), 64);
        assert_ne!(tok, global);

        // ── 목록 = 세션 읽기 일곱(늘 같다) · 전역 토큰은 그대로 13 ──
        let names = |body: &str| -> Vec<String> {
            let v: Value = serde_json::from_str(body).unwrap();
            v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
        };
        let list = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
        let (st, body) = post_mcp(port, &tok, list.clone()).await;
        assert!(st.starts_with("HTTP/1.1 200"), "{st}");
        assert_eq!(names(&body), crate::chat_token::READ_TOOLS.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        let (_, body) = post_mcp(port, &global, list).await;
        // DB 도구(뒷면이 있으면 늘 일곱 — 2026-11-09)는 빼고 센다
        let global_names: Vec<String> = names(&body).into_iter().filter(|n| !crate::mcp::db::is_db_tool(n)).collect();
        assert_eq!(global_names.len(), 13, "전역 토큰의 목록은 그대로");

        // ── 연결 없음 = not-linked · 목록 밖 도구 = 모르는 도구 ──
        let (err, text) = mcp_call(port, &tok, "list_sessions", json!({})).await;
        assert!(err && text.starts_with("not-linked:"), "{text}");
        for other in ["create_execution_plan", "get_operation_results", "wait_for_operation", "start_run", "db_query"] {
            let (err, text) = mcp_call(port, &tok, other, json!({})).await;
            assert!(err && text.starts_with("Unknown tool"), "{other}: {text}");
        }

        // ── 연결 A(읽기 허용) — 그 세션 하나만 ──
        let l = a.ok(Grade::Write, "side_chat_link", json!({ "chat": chat, "epoch": e, "stream": sa })).await;
        assert_eq!((l["changed"].as_bool(), l["link"]["readable"].as_bool(), l["link"]["code"].as_str()), (Some(true), Some(true), Some("p1")));
        assert_eq!(a.ok(Grade::Write, "side_chat_link", json!({ "chat": chat, "stream": sa })).await["changed"], false);
        let (err, text) = mcp_call(port, &tok, "get_scrollback", json!({ "session": sa })).await;
        assert!(!err && text.contains("link-line-1"), "{text}");
        let (err, text) = mcp_call(port, &tok, "get_scrollback", json!({ "session": sb })).await;
        assert!(err && text.starts_with("not-the-linked-session:"), "{text}");
        let (err, text) = mcp_call(port, &tok, "compare_command_results", json!({ "sessions": [sa, sb] })).await;
        assert!(err && text.starts_with("not-the-linked-session:"), "{text}");
        let (err, text) = mcp_call(port, &tok, "list_sessions", json!({})).await;
        let rows: Value = serde_json::from_str(&text).unwrap();
        assert!(!err && rows.as_array().unwrap().len() == 1 && rows[0]["id"] == sa.as_str(), "{text}");
        assert!(a.ok(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": "main" })).await["link"]["stream"] == sa.as_str());

        // ── 연결이 바뀐 뒤 첫 글에만 머리글(가짜 CLI 의 둘째 글 = 권한 요청 → 허용) ──
        let r = a.ok(Grade::Write, "side_chat_send", json!({ "chat": chat, "epoch": e, "text": "second", "linkName": " Claude Code " })).await;
        assert_eq!(r["link"], json!({ "label": "Claude Code" }), "붙인 머리글의 연결(화면의 칩 — 보낼 때 실은 칩 이름 · 코드 없음) — 스트림 id 는 없다");
        let evs = a.until(chat, |e| t(e) == "permission").await;
        let req = evs.last().unwrap()["ev"]["requestId"].as_str().unwrap().to_string();
        a.ok(Grade::Write, "side_chat_decide", json!({ "chat": chat, "epoch": e, "requestId": req, "decision": "allow" })).await;
        a.until(chat, |e| t(e) == "turnEnded").await;
        let users = user_lines(&log);
        assert_eq!(users, vec!["hello".to_string(), format!("[연결된 타일: Claude Code · 세션 {sa}] second")], "{users:?}");

        // ── 연결 B(읽기 허용 꺼짐) = not-readable · 끊기 = not-linked ──
        let l = a.ok(Grade::Write, "side_chat_link", json!({ "chat": chat, "stream": sb })).await;
        assert_eq!(l["link"]["readable"], false);
        let (err, text) = mcp_call(port, &tok, "get_scrollback", json!({ "session": sb })).await;
        assert!(err && text.starts_with("not-readable:") && !text.contains("secret"), "{text}");
        let l = a.ok(Grade::Write, "side_chat_link", json!({ "chat": chat, "stream": null })).await;
        assert!(l["changed"] == true && l["link"].is_null());
        let (err, text) = mcp_call(port, &tok, "get_last_command", json!({ "session": sa })).await;
        assert!(err && text.starts_with("not-linked:"), "{text}");

        // ── 닫기 = 토큰 폐기 · 임시 파일 지움 · 연결 잊음 ──
        a.ok(Grade::Write, "side_chat_link", json!({ "chat": chat, "stream": sa })).await;
        a.ok(Grade::Write, "side_chat_close", json!({ "chat": chat })).await;
        a.until(chat, |e| t(e) == "exited").await;
        let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }).to_string();
        let (st, _) = post_mcp(port, &tok, init).await;
        assert!(st.starts_with("HTTP/1.1 401"), "닫힌 채팅의 토큰: {st}");
        assert!(!cfg_path.exists(), "토큰이 든 임시 파일은 프로세스와 함께 지워진다");
        assert!(a.ok(Grade::Write, "side_chat_open", open).await["link"].is_null(), "닫으면 연결도 잊는다");

        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        side_chat::set_fake_for_test(None);
        side_chat::set_fake_servers_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 시험 `proc_id_never_reused`(설계 9절 단계 1 · 리뷰 F1 — 단위 쪽은 `server::chat_proc::tests`)의 **가짜 CLI 통합**: 같은 채팅 id 를 닫고
    /// 옛 끝 정리를 기다리지 않고 곧바로 다시 열어 띄운 세대는 옛 세대보다 크다(예전에는 둘 다 1 — 옛 프로세스의 늦은 끝 정리가 새 세대의
    /// 채팅 토큰을 거둘 수 있었다). 옛 끝 사건 · 새 첫 턴이 어떤 순서로 오든 끝나면: 옛 세대의 호출은 `[stale-chat]` · 옛 토큰은 401 · 새 토큰은 산다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn proc_id_never_reused_across_close_open_with_fake_cli() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("procid");
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(600))));
        let mut a = Client::connect(&pipe).await;
        let port = a.ok(Grade::Read, "mcp_coords", json!({})).await["port"].as_u64().unwrap() as u16;
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        side_chat::set_fake_for_test(Some(FakeCli {
            exe,
            args: [FAKE_TEST, "--exact", "--nocapture", "--test-threads=1", "-q"].iter().map(|s| s.to_string()).collect(),
            env: vec![(FAKE_ENV.into(), "1".into())],
            root: root.to_path_buf(),
            mcp_port: Some(port),
            conv_roots: Vec::new(),
        }));
        let chat = "pid001";
        let open = json!({ "chat": chat, "cli": "claude", "model": "haiku", "mode": { "kind": "fresh" }, "window": "main" });
        let token_of = |e: u64| -> String {
            let p = root.join(".run").join(format!("{chat}-{e}")).join("mcp.json");
            let cfg: Value = serde_json::from_str(&std::fs::read_to_string(&p).expect("채팅 mcp.json")).unwrap();
            let auth = cfg["mcpServers"][crate::instance::mcp_name(crate::instance::DEV)]["headers"]["Authorization"].as_str().unwrap();
            auth.strip_prefix("Bearer ").unwrap().to_string()
        };
        let send = |epoch: u64| json!({ "chat": chat, "epoch": epoch, "text": "hello" });

        a.ok(Grade::Write, "side_chat_open", open.clone()).await;
        let e1 = a.ok(Grade::Write, "side_chat_send", send(0)).await["epoch"].as_u64().unwrap();
        a.until(chat, |e| t(e) == "turnEnded").await;
        let t1 = token_of(e1);

        // ── 닫고 곧바로 다시 연다(옛 끝 정리를 기다리지 않는다) — 다시 연 항목은 아직 안 띄움 · 다음 띄우기는 새 전역 세대 ──
        assert_eq!(a.ok(Grade::Write, "side_chat_close", json!({ "chat": chat })).await, true);
        let snap = a.ok(Grade::Write, "side_chat_open", open.clone()).await;
        assert_eq!(snap["epoch"], 0);
        let e2 = a.ok(Grade::Write, "side_chat_send", send(0)).await["epoch"].as_u64().unwrap();
        assert!(e2 > e1, "닫고 다시 연 같은 채팅의 세대가 겹쳤다: {e1} → {e2}");
        let t2 = token_of(e2);
        assert_ne!(t1, t2);
        let (mut old_exit, mut new_end) = (false, false);
        while !(old_exit && new_end) {
            for e in a.until(chat, |_| true).await {
                old_exit |= e["epoch"] == e1 && t(&e["ev"]) == "exited";
                new_end |= e["epoch"] == e2 && t(&e["ev"]) == "turnEnded";
            }
        }

        // ── 옛 세대 — 호출은 stale · 토큰은 401 / 새 세대의 토큰은 옛 끝 정리 뒤에도 산다 ──
        assert!(a.err(Grade::Write, "side_chat_send", send(e1)).await.contains("[stale-chat]"));
        let list = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
        let (st, _) = post_mcp(port, &t1, list.clone()).await;
        assert!(st.starts_with("HTTP/1.1 401"), "옛 세대의 토큰: {st}");
        let (st, _) = post_mcp(port, &t2, list).await;
        assert!(st.starts_with("HTTP/1.1 200"), "옛 끝 정리가 새 세대의 토큰을 거뒀다: {st}");

        assert_eq!(a.ok(Grade::Write, "shutdown", json!({})).await["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        side_chat::set_fake_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **고아 자진 종료는 사이드 채팅을 세지 않는다**(`serve::Busy` 머리말 · DB 와 같은 근거): 산 채팅 프로세스만 남은 서버는 고아 시계대로
    /// 끝나고, 끝날 때 그 프로세스를 닫는다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn orphan_server_with_only_side_chats_exits_and_closes_them() {
        let _g = SESSION_STATE.lock().await;
        let root = scratch("orphan");
        fake(&root);
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_millis(800))));
        let mut a = Client::connect(&pipe).await;
        let open = json!({ "chat": "orph01", "cli": "claude", "model": "haiku", "mode": { "kind": "fresh" }, "window": "main" });
        a.ok(Grade::Write, "side_chat_open", open).await;
        a.ok(Grade::Write, "side_chat_send", json!({ "chat": "orph01", "epoch": 0, "text": "hi" })).await;
        a.until("orph01", |e| t(e) == "turnEnded").await;
        assert_eq!(side_chat::live_count(), 1);
        drop(a);
        let exit = tokio::time::timeout(Duration::from_secs(10), server).await.expect("사이드 채팅이 서버를 붙들었다").unwrap();
        assert!(matches!(exit, serve::Exit::Shutdown(ref r) if r.contains("idle")), "{exit:?}");
        assert_eq!(side_chat::live_count(), 0, "끝날 때 채팅을 닫는다");
        side_chat::set_fake_for_test(None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
