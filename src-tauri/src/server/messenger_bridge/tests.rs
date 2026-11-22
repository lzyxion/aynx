//! 메신저 다리 시험 — 순수(문지기 · 걷기 · 짝짓기 · 라우팅) · 루프백 가짜 Telegram 서버 통합 · 소스 훑기.

use super::logic::*;
use super::*;
use crate::telegram::Api;
use crate::agent_state::Phase;
use std::sync::atomic::{AtomicI64, Ordering};

/// 3b — 루프백 가짜 Discord 통합(이 모듈의 도우미를 같이 쓴다).
mod dc_tests;
/// 4단계 — 루프백 가짜 Slack 통합(이 모듈 · `dc_tests` 의 도우미를 같이 쓴다).
mod sl_tests;

// ---------------------------------------------------------------------------
// 순수
// ---------------------------------------------------------------------------

fn ready_tile(cli: &'static str) -> TileView {
    TileView {
        kind: Some(Kind::Local),
        agent: Some(AgentView { cli: Some(cli), state: Some(Phase::Finished), main_stopped: true, subagents: 0, stopped_once: true }),
        asking: false,
        bracketed: Some(true),
        leftover: Some(false),
    }
}

#[test]
fn gate_table() {
    let ok = ready_tile("claude");
    assert_eq!(gate(true, &ok), Ok("claude"));
    assert_eq!(gate(true, &ready_tile("codex")), Ok("codex"));
    assert_eq!(gate(false, &ok), Err(Refusal::Off));
    let with = |f: &dyn Fn(&mut TileView)| {
        let mut t = ready_tile("claude");
        f(&mut t);
        gate(true, &t)
    };
    assert_eq!(with(&|t| t.kind = None), Err(Refusal::NoTile));
    assert_eq!(with(&|t| t.kind = Some(Kind::Ssh)), Err(Refusal::Remote), "원격 타일은 1단계에서 거절");
    // **항목이 없으면 무조건 거절**(셸로 돌아감) — 다른 재료가 모두 좋아도.
    assert_eq!(with(&|t| t.agent = None), Err(Refusal::NoCli));
    assert_eq!(with(&|t| t.agent.as_mut().unwrap().cli = None), Err(Refusal::NoCli));
    assert_eq!(with(&|t| t.agent.as_mut().unwrap().cli = Some("aider")), Err(Refusal::NoCli));
    assert_eq!(with(&|t| t.asking = true), Err(Refusal::Asking));
    assert_eq!(with(&|t| t.agent.as_mut().unwrap().state = Some(Phase::Permission)), Err(Refusal::Asking));
    // 한 번도 턴이 끝나지 않은 새 CLI(대화 신호만 — 상태 없음)
    assert_eq!(
        with(&|t| {
            let a = t.agent.as_mut().unwrap();
            a.state = None;
            a.stopped_once = false;
            a.main_stopped = false;
        }),
        Err(Refusal::NotReady)
    );
    assert_eq!(with(&|t| t.agent.as_mut().unwrap().state = Some(Phase::Running)), Err(Refusal::Running));
    assert_eq!(with(&|t| t.agent.as_mut().unwrap().main_stopped = false), Err(Refusal::Running));
    assert_eq!(with(&|t| t.agent.as_mut().unwrap().subagents = 1), Err(Refusal::Running));
    assert_eq!(with(&|t| t.bracketed = Some(false)), Err(Refusal::NoBracketed));
    assert_eq!(with(&|t| t.bracketed = None), Err(Refusal::NoBracketed), "해석기가 없으면 넣지 않는다");
    assert_eq!(with(&|t| t.leftover = Some(true)), Err(Refusal::Leftover));
    assert_eq!(with(&|t| t.leftover = None), Ok("claude"), "입력 줄을 못 찾으면 막지 않는다");
    for r in [Refusal::Off, Refusal::NoTile, Refusal::Remote, Refusal::NoCli, Refusal::Asking, Refusal::NotReady, Refusal::Running, Refusal::NoBracketed, Refusal::Leftover] {
        assert!(!refusal_text(r).is_empty());
    }
}

#[test]
fn clean_strips_controls_and_paste_end() {
    assert_eq!(clean_text("  "), Clean::Empty);
    assert_eq!(clean_text("hi\r\nthere\rx\t1  \n"), Clean::Text("hi\nthere\nx\t1".into()));
    // ESC 가 없으니 붙여넣기 끝 표식을 글로 만들 수 없다.
    let Clean::Text(t) = clean_text("a\x1b[201~rm -rf /\x1b[200~\u{9b}201~\u{7f}\u{0}b") else { panic!() };
    assert!(!t.contains('\x1b') && !t.contains('\u{9b}') && !t.contains('\u{7f}') && !t.contains('\0'), "{t:?}");
    assert_eq!(t, "a[201~rm -rf /[200~201~b");
    assert_eq!(clean_text(&"가".repeat(TEXT_MAX_CHARS)), Clean::Text("가".repeat(TEXT_MAX_CHARS)));
    assert_eq!(clean_text(&"가".repeat(TEXT_MAX_CHARS + 1)), Clean::TooLong);
    assert_eq!(paste_bytes("a\nb"), b"\x1b[200~a\rb\x1b[201~".to_vec());
}

#[test]
fn sender_gate_and_stale() {
    let p = Paired { user_id: 5, chat_id: 5, name: "me".into() };
    assert_eq!(classify(Some(&p), Some(5), 5, true), Sender::Paired);
    assert_eq!(classify(Some(&p), Some(6), 6, true), Sender::Drop, "다른 사람");
    assert_eq!(classify(Some(&p), Some(5), -100, false), Sender::Drop, "그룹에서 같은 사람");
    assert_eq!(classify(Some(&p), Some(5), 7, true), Sender::Drop, "다른 대화방");
    assert_eq!(classify(None, Some(9), 9, true), Sender::Stranger);
    assert_eq!(classify(None, Some(9), -1, false), Sender::Drop);
    assert_eq!(classify(None, None, 9, true), Sender::Drop);
    assert!(!is_stale(1000, 1000 + STALE_SECS));
    assert!(is_stale(1000, 1000 + STALE_SECS + 1));
}

#[test]
fn pairing_machine() {
    let mut p = Pairing::default();
    let code = || Some("123456".to_string());
    assert_eq!(p.request(1, 1, "a", 0, code), PairStep::Reply { code: "123456".into(), fresh: true });
    assert_eq!(p.request(1, 1, "a", 10_000, code), PairStep::Quiet, "30초에 한 번");
    assert_eq!(p.request(2, 2, "b", 10_000, code), PairStep::Busy, "대기는 하나");
    assert_eq!(p.request(1, 1, "a", PAIR_REPEAT_MS + 1, || panic!("같은 코드")), PairStep::Reply { code: "123456".into(), fresh: false });
    assert!(p.take("000000", 1).is_none(), "다른 코드");
    assert!(p.current(PAIR_TTL_MS - 1).is_some());
    assert!(p.current(PAIR_TTL_MS).is_none(), "10분 시한");
    assert_eq!(p.request(2, 2, "b", PAIR_TTL_MS, || Some("654321".into())), PairStep::Reply { code: "654321".into(), fresh: true });
    let got = p.take("654321", PAIR_TTL_MS + 1).expect("허용");
    assert_eq!((got.user_id, got.name.as_str()), (2, "b"));
    assert!(p.current(PAIR_TTL_MS + 1).is_none());
    assert_eq!(p.request(3, 3, "c", 0, || None), PairStep::NoCode);
    let six = crate::remote::auth::six_digits().unwrap();
    assert!(six.len() == 6 && six.bytes().all(|b| b.is_ascii_digit()));
}

#[test]
fn routing_tables() {
    assert_eq!(route(Some("s1"), &["s2".into(), "s3".into()]), Route::To("s1".into()), "답장이 먼저");
    assert_eq!(route(None, &[]), Route::Nowhere);
    assert_eq!(route(None, &["s2".into()]), Route::To("s2".into()));
    assert_eq!(route(None, &["a".into(), "b".into()]), Route::Choose(vec!["a".into(), "b".into()]));
    let mut m = SentMap::default();
    for i in 0..(SENT_KEEP as i64 + 10) {
        m.insert(i, "s");
    }
    assert_eq!(m.len(), SENT_KEEP);
    assert!(m.get(0).is_none() && m.get(SENT_KEEP as i64 + 9) == Some("s"), "최근 200");
    assert_eq!(parse_pick(&pick_data(7, 2)), Some((7, 2)));
    assert!(pick_data(u64::MAX, 99).len() <= crate::telegram::CALLBACK_DATA_MAX);
    assert_eq!(parse_pick("x:1:2"), None);
    let mut t = Turns::default();
    assert!(!t.end("s", 0), "다리 턴이 아니면 답하지 않는다");
    t.begin("s", 0);
    assert!(t.owns("s", 0) && t.first_ask("s") && !t.first_ask("s"));
    assert!(t.end("s", 10) && !t.end("s", 11), "답은 한 번");
    assert!(t.owns("s", 10 + TURN_KEEP_MS - 1), "끝난 뒤 잠깐은 그 턴의 알림을 거른다");
    assert!(!t.owns("s", 10 + TURN_KEEP_MS));
    t.begin("s", 0);
    t.drop_stream("s");
    assert!(!t.end("s", 1), "끊긴 턴은 답하지 않는다");
    // 대체 이름 = `<CLI 표시 이름> · <cwd 끝 폴더>`(2026-11-19 — 프런트 다리 이름표와 같은 꼴)
    assert_eq!(fallback_label("Codex", Some("C:\\Users\\me\\")), "Codex · me");
    assert_eq!(fallback_label("Claude Code", Some("/home/me/proj")), "Claude Code · proj");
    assert_eq!(fallback_label("Claude Code", None), "Claude Code");
    let display = |id: &str| crate::agent_sessions::target(id).map(|t| t.display).unwrap();
    assert_eq!((display("claude"), display("codex")), ("Claude Code", "Codex"), "RealEnv 이 쓰는 표시 이름 표");
}

/// 실기 후속(2026-11-19) — "기다리는 타일이 없다" 의 까닭 줄 · 겹친 고르기 단추 · 제목 걷기.
#[test]
fn nowhere_lines_and_pick_labels() {
    let head = nowhere_text(&[]);
    assert!(!head.contains('\n'));
    // 세션 없음 · 꺼짐은 줄로 내지 않는다 — 줄이 없으면 한 줄만
    assert_eq!(nowhere_text(&[("a".into(), Refusal::NoTile), ("b".into(), Refusal::Off)]), head);
    let t = nowhere_text(&[("proj / wt".into(), Refusal::NotReady), ("x".into(), Refusal::NoTile), ("y".into(), Refusal::Running)]);
    let lines: Vec<&str> = t.lines().collect();
    assert_eq!(lines.len(), 3, "{t}");
    assert_eq!(lines[1], format!("· proj / wt — {}", refusal_short(Refusal::NotReady)));
    assert_eq!(lines[2], format!("· y — {}", refusal_short(Refusal::Running)));
    // 최대 5줄 + "외 N개"
    let many: Vec<(String, Refusal)> = (0..8).map(|i| (format!("t{i}"), Refusal::Running)).collect();
    let t = nowhere_text(&many);
    let lines: Vec<&str> = t.lines().collect();
    assert_eq!(lines.len(), 1 + NOWHERE_MAX_LINES + 1, "{t}");
    assert!(lines[5].starts_with("· t4") && lines[6].contains('3'), "{t}");
    for r in [Refusal::Off, Refusal::NoTile, Refusal::Remote, Refusal::NoCli, Refusal::Asking, Refusal::NotReady, Refusal::Running, Refusal::NoBracketed, Refusal::Leftover] {
        assert!(!refusal_short(r).is_empty());
    }

    assert_eq!(clean_title("  Fix\n the\t\u{1b}  bug "), Some("Fix the bug".into()));
    assert_eq!(clean_title(" \n "), None);
    let it = |l: &str, t: Option<&str>| (l.to_string(), t.map(str::to_string));
    // 안 겹치면 그대로(제목을 붙이지 않는다)
    assert_eq!(pick_labels(&[it("a", Some("T1")), it("b", Some("T2"))]), ["a", "b"]);
    // 겹친 것만 제목
    assert_eq!(pick_labels(&[it("p", Some("T1")), it("p", Some("T2")), it("q", None)]), ["p — T1", "p — T2", "q"]);
    // 제목까지 같음 · 제목 없음 → 번호
    assert_eq!(pick_labels(&[it("p", Some("T")), it("p", Some("T")), it("p", None)]), ["p — T (1)", "p — T (2)", "p"]);
    assert_eq!(pick_labels(&[it("p", None), it("p", None)]), ["p (1)", "p (2)"]);
    // 60자 — 제목 쪽을 … 로 줄이고 번호 꼬리는 남긴다
    let long = "가".repeat(80);
    let got = pick_labels(&[it("proj / wt", Some(&long)), it("proj / wt", Some(&long))]);
    assert!(got.iter().all(|g| g.chars().count() <= PICK_LABEL_MAX), "{got:?}");
    assert!(got[0].starts_with("proj / wt — 가") && got[0].ends_with("… (1)") && got[1].ends_with("… (2)"), "{got:?}");
    let got = pick_labels(&[it("proj / wt", Some(&format!("{long}A"))), it("proj / wt", Some(&format!("{long}B")))]);
    assert_eq!((got[0].ends_with(" (1)"), got[1].ends_with(" (2)")), (true, true), "자른 끝이 같으면 번호: {got:?}");
    // 이름표만으로 넘치면 이름표를 자른다
    let big = "x".repeat(70);
    let got = pick_labels(&[it(&big, Some("T")), it(&big, Some("U"))]);
    assert!(got.iter().all(|g| g.chars().count() <= PICK_LABEL_MAX) && got[0].ends_with(" (1)"), "{got:?}");
    assert_eq!(pick_labels(&[it(&big, None)])[0].chars().count(), PICK_LABEL_MAX, "안 겹치면 60자에서 자른다(지금 그대로)");
}

/// 실기 후속(2026-11-19) — 다리 턴의 답은 대화 파일이 다 쓰인 뒤의 글: (a) 첫 읽기 None → 다음 글 (b) 앞 글 → 파일이 자란 뒤의 마지막 글
/// (c) `answer_wait` 까지 None → None · 글이 `answer_deadline` 뒤에 나타나도 그 글.
#[test]
fn answer_waits_for_the_file() {
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let run = |script: Vec<(Option<&str>, Option<u64>)>| {
        let env = Arc::new(FakeEnv::default());
        *env.answers.lock().unwrap() = script.into_iter().map(|(t, n)| (t.map(str::to_string), n)).collect();
        let cfg = Arc::new(Config {
            telegram: tg::Conf { api: Api::at("http://127.0.0.1:9"), poll_timeout_secs: 1 },
            discord: dc::Conf::release(),
            slack: sl::Conf::release(),
            dir: None,
            env: env.clone(),
            backoff: Duration::from_millis(50),
            conflict_backoff: Duration::from_millis(50),
            enter_delay: Duration::from_millis(5),
            ask_grace: Duration::from_millis(100),
            answer_poll: Duration::from_millis(10),
            answer_deadline: Duration::from_millis(300),
            answer_wait: Duration::from_millis(2000),
        });
        rt.block_on(settled_answer(&cfg, "claude", Some("c1".into())))
    };
    // 글이 `answer_deadline` 을 넘겨서야(`answer_wait` 안에) 나타나면 그 글 — 읽기 40번(간격 10ms 이상)은 300ms 를 넘는다
    let mut late: Vec<(Option<&str>, Option<u64>)> = (0..40).map(|_| (None, Some(10))).collect();
    late.push((Some("late"), Some(20)));
    let t0 = std::time::Instant::now();
    assert_eq!(run(late).as_deref(), Some("late"), "늦은 글");
    assert!(t0.elapsed() > Duration::from_millis(300));
    // `answer_wait` 까지 없으면 None
    let t0 = std::time::Instant::now();
    assert_eq!(run(vec![(None, Some(10))]), None, "끝까지 없음");
    assert!(t0.elapsed() >= Duration::from_millis(1900), "글이 없으면 answer_wait 까지 기다린다");
    assert_eq!(run(vec![(None, Some(10)), (Some("last"), Some(20))]).as_deref(), Some("last"), "(a)");
    assert_eq!(
        run(vec![(Some("before tool"), Some(10)), (Some("before tool"), Some(15)), (Some("last"), Some(30))]).as_deref(),
        Some("last"),
        "(b)"
    );
    // 시한에 닿으면 그때 가진 글(파일이 계속 자라도)
    let growing: Vec<(Option<&str>, Option<u64>)> = (0..200).map(|i| (Some("x"), Some(i))).collect();
    assert_eq!(run(growing).as_deref(), Some("x"));
}

/// 2단계 — 돌보는 스트림 표 · 한 물음에 한 통(신호 먼저 / 카드 먼저 — 순서를 가정하지 않는다).
#[test]
fn tending_and_one_message_per_ask() {
    let mut t = Tending::default();
    assert!(!t.tends("s"));
    assert_eq!(t.signal("s", 0, false), None, "돌보지 않는 스트림의 신호는 보지 않는다");
    t.tend("s");
    assert!(t.tends("s"));
    // 신호 먼저 → 틈 안에 카드가 선다 → 신호 쪽 통은 나가지 않는다(카드의 단추 통이 그 물음의 한 통)
    let seq = t.signal("s", 0, false).expect("카드를 기다린다");
    t.card("s", 100);
    assert!(!t.fire("s", seq), "신호 먼저 · 카드 뒤");
    // 카드 먼저 → 신호는 곧바로 건너뛴다
    assert_eq!(t.signal("s", 200, false), None, "카드 먼저 · 신호 뒤");
    // 틈이 지난 뒤의 물음에 카드가 없다(Codex 가 TUI 로 묻는 등) → 틈 뒤 한 통 · 두 번 불러도 한 번
    let late = 100 + ASK_PAIR_MS;
    let seq = t.signal("s", late, false).expect("카드 없는 물음");
    assert!(t.fire("s", seq) && !t.fire("s", seq));
    // 풀리지 않은 다리 카드가 있으면(오래 서 있어도) 건너뛴다
    assert_eq!(t.signal("s", late * 3, true), None);
    // 신호 둘 → 마지막 하나만
    let a = t.signal("s", late * 3, false).unwrap();
    let b = t.signal("s", late * 3, false).unwrap();
    assert!(!t.fire("s", a) && t.fire("s", b));
    // "앱에서 답하세요" 는 돌봄마다 한 번 · 걷으면 끝 · 새 돌봄은 새로
    assert!(t.note_once("s") && !t.note_once("s"));
    t.untend("s");
    assert!(!t.tends("s") && !t.note_once("s"));
    t.tend("s");
    assert!(t.note_once("s"));
    t.clear();
    assert!(!t.tends("s"));
    let mut turns = Turns::default();
    turns.begin("x", 0);
    assert!(turns.running("x"));
    assert!(turns.end("x", 1) && !turns.running("x"));
}

/// 2단계 — 단추 데이터 왕복 · 누름 판정 · 보낸 카드 표(보내는 사이 풀림 · 다리의 결정 · 다른 곳의 결정 · 실패).
#[test]
fn card_table_and_press() {
    let id = "0123456789abcdef0123456789ABCDEF".to_string();
    let allow = card_press_data(true, &id);
    assert!(allow.len() <= crate::telegram::CALLBACK_DATA_MAX);
    assert_eq!(parse_card_press(&allow), Some((true, id.clone())));
    assert_eq!(parse_card_press(&card_press_data(false, &id)), Some((false, id.clone())));
    for bad in ["pa:".to_string(), "pa:xyz".into(), format!("px:{id}"), format!("pa:{id}0"), "p:1:0".into(), format!("pa:{}", "g".repeat(32))] {
        assert_eq!(parse_card_press(&bad), None, "{bad}");
    }
    assert_eq!(parse_pick(&allow), None, "고르기 단추와 섞이지 않는다");
    assert_eq!(judge_press(false, true), Press::Stale);
    assert_eq!(judge_press(false, false), Press::Stale, "보낸 카드인지가 먼저");
    assert_eq!(judge_press(true, false), Press::Off);
    assert_eq!(judge_press(true, true), Press::Go);

    let mut c = Cards::default();
    assert!(c.open(&id, "s", 3) && !c.open(&id, "s", 3), "한 카드에 한 통");
    assert!(c.has(&id) && c.open_on("s") && !c.pressable(&id), "보내는 중에는 누를 수 없다");
    // 보내는 사이 다른 곳에서 풀림 → 보낸 뒤 곧바로 바꿔 쓴다
    assert_eq!(c.gone(&id, "terminal"), None);
    assert!(!c.open_on("s"));
    assert_eq!(c.sent(&id, Some(7), "L"), Some((7, "L".into(), "terminal".into())));
    assert!(!c.has(&id));
    // 보냄 → 누름이 잡음 → 그 결정의 `gone` 은 다리가 바꿔 쓴다 → 끝
    assert!(c.open(&id, "s", 3));
    assert_eq!(c.sent(&id, Some(8), "L"), None);
    assert!(c.pressable(&id));
    assert_eq!(c.begin_press(&id), Some(("s".into(), 3, "L".into(), Some(8))));
    assert_eq!(c.begin_press(&id), None, "두 번째 누름은 잡지 못한다");
    assert!(!c.pressable(&id));
    assert_eq!(c.gone(&id, "allowed"), None, "다리가 결정한 것");
    c.end_press(&id);
    assert!(!c.has(&id));
    // 보냄 → 다른 곳(앱 · TUI · 시한)에서 풀림 → 바꿔 쓸 것 · 두 번은 없다
    assert!(c.open(&id, "s", 3));
    c.sent(&id, Some(9), "L");
    assert_eq!(c.gone(&id, "denied"), Some((9, "L".into(), "denied".into())));
    assert_eq!(c.gone(&id, "denied"), None);
    // 보내기 실패 → 뺀다 · 꺼져 있어 단추 없이 → 뺀다
    assert!(c.open(&id, "s", 3));
    assert_eq!(c.sent(&id, None, "L"), None);
    assert!(!c.has(&id));
    assert!(c.open(&id, "s", 3));
    c.forget(&id);
    assert_eq!(c.len(), 0);
    for r in ["allowed", "allowed-session", "denied", "released", "terminal", "timeout", "no-viewer", "session-ended", "hook-gone"] {
        assert!(!gone_text(r).is_empty());
    }
    for r in [PressResult::Allowed, PressResult::Denied, PressResult::Already, PressResult::Closed, PressResult::Off] {
        assert!(!press_text(r).is_empty());
    }
}

/// 2단계 — 단추 통의 글: 도구 입력 한 줄(대화 기록 보기와 같은 요약 · 300자 · 제어 글자 걷기) · HTML 걷기.
#[test]
fn card_message_text() {
    assert_eq!(card_summary("Bash", &json!({"command": "rm -rf build\nmore", "description": "x"})), "rm -rf build");
    assert!(card_summary("Bash", &json!({"command": "가".repeat(1000)})).chars().count() <= SUMMARY_MAX_CHARS);
    let patch = json!({"command": "*** Begin Patch\n*** Update File: b.rs\n*** Add File: a.rs\n*** End Patch"});
    assert_eq!(card_summary("apply_patch", &patch), "a.rs, b.rs");
    assert_eq!(card_summary("Other", &json!({"weird": 1})), "");
    // 걷기는 전송(Telegram — 중립 글 → HTML)
    let h = tg::render(&Text::plain(card_text("<tile>", "Bash", "a && b <c>")));
    assert!(h.contains("&lt;tile&gt;") && h.contains("Bash · a &amp;&amp; b &lt;c&gt;") && !h.contains("<c>"), "{h}");
    assert!(tool_line("Read", "").ends_with("Read"));
    let b = card_buttons(&id32());
    assert_eq!((b.len(), parse_card_press(&b[0].1).map(|x| x.0), parse_card_press(&b[1].1).map(|x| x.0)), (2, Some(true), Some(false)));
    assert_eq!(tg::render(&Text::plain(result_text("x<", "y"))), "x&lt; · y");
    assert_eq!(tg::render(&Text::plain(result_text("", "y"))), "y");
    // 3a — 중립 글의 Telegram 모양(1a · 2단계의 글자 그대로): 굵은 머리 줄 · 그려 둔 알림(자르기) · 알림 + 도구 줄
    assert_eq!(tg::render(&Text::headed("🟢 a<b", "x & y")), "<b>🟢 a&lt;b</b>\nx &amp; y");
    assert_eq!(tg::render(&Text::Rendered { text: "<b>t</b>".into(), tail: None }), "<b>t</b>");
    assert_eq!(tg::render(&Text::Rendered { text: "<b>t</b>".into(), tail: Some("Tool: a<b".into()) }), "<b>t</b>\nTool: a&lt;b");
    let long = format!("<b>x</b> {}", "가".repeat(5000));
    let r = tg::render(&Text::Rendered { text: long.clone(), tail: Some("Tool: z".into()) });
    assert!(r.ends_with("…\nTool: z") && crate::telegram::units(&r) <= crate::telegram::TEXT_MAX, "{}", r.len());
    assert_eq!(tg::render(&Text::Rendered { text: long.clone(), tail: None }), crate::telegram::clip_html(&long, crate::telegram::TEXT_MAX));
    // 답 나누기의 자리 = 1a 의 `TEXT_MAX - (units(이름표) + 8)`(머리 줄 `🟢 <이름표>`)
    let label = "proj / wt";
    let body = "z".repeat(9000);
    let more = "…";
    assert_eq!(
        tg::split_answer(&format!("🟢 {label}"), &body, more),
        crate::telegram::split_text(&body, crate::telegram::TEXT_MAX - (crate::telegram::units(label) + 8), crate::telegram::MAX_PARTS, more)
    );
}

fn id32() -> String {
    "f".repeat(32)
}

/// `vt100` 0.18.1 — 괄호 붙여넣기 모드와 흐린 글자(SGR 2)를 서버 해석기가 준다(계획서의 확인 항목) · 입력 줄 판정은 프런트와 같다.
#[test]
fn server_interp_gives_bracketed_and_dim() {
    let mut i = crate::screen_mirror::vt::Interp::new(40, 4);
    assert!(!i.input_view().bracketed);
    i.feed("\x1b[?2004h❯ \x1b[2mTry \"refactor\"\x1b[0m".as_bytes());
    let v = i.input_view();
    assert!(v.bracketed);
    assert_eq!(input_leftover("claude", &v.rows), Some(false), "흐린 안내 글은 빈 입력 줄");
    i.feed(b"\r\n\x1b[2K");
    i.feed("❯ half typed".as_bytes());
    let v = i.input_view();
    assert_eq!(input_leftover("claude", &v.rows), Some(true), "치다 만 글");
    assert_eq!(input_leftover("codex", &v.rows), None, "그 CLI 의 입력 줄이 없다");
    i.feed(b"\x1b[?2004l");
    assert!(!i.input_view().bracketed);
    // 프런트 `flip-model.test.ts` 와 같은 표
    let r = |t: &str, d: bool| (t.to_string(), d);
    assert_eq!(input_leftover("codex", &[vec![r("› ", false), r("Ask Codex to do anything", true)], vec![r("  ~/w", false)]]), Some(false));
    assert_eq!(input_leftover("claude", &[vec![r("❯ ", false)]]), Some(false));
    assert_eq!(input_leftover("claude", &[vec![r("❯ old question", false)], vec![r("───", false)], vec![r("❯ ", false), r("Try", true)]]), Some(false));
    assert_eq!(input_leftover("codex", &[vec![r("›", false), r(" abc", false)]]), Some(true));
    assert_eq!(input_leftover("claude", &[vec![r("hello", false)]]), None);
}

// ---------------------------------------------------------------------------
// 소스 훑기
// ---------------------------------------------------------------------------

/// `src/` 의 모든 `.rs`(시험 파일 · `#[cfg(test)]` 아래는 뺀다) — (상대 경로, 본문).
fn sources() -> Vec<(String, String)> {
    fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<(String, String)>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, root, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                let name = p.file_name().unwrap().to_string_lossy().to_string();
                if name.starts_with("tests") || name.ends_with("_tests.rs") {
                    continue;
                }
                let body = std::fs::read_to_string(&p).unwrap().replace("\r\n", "\n");
                let body = body.split("#[cfg(test)]\nmod tests {").next().unwrap().to_string();
                out.push((rel, body));
            }
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    out
}

/// 서버 안에서 PTY(로컬 · SSH)에 쓰는 호출 자리는 둘 — 세션 op `write` 와 다리의 넣기 함수 하나.
#[test]
fn pty_writes_have_two_sites() {
    let mut local = Vec::new();
    let mut ssh = Vec::new();
    for (path, body) in sources() {
        for (i, line) in body.lines().enumerate() {
            let code = line.split("//").next().unwrap_or("");
            if code.contains("pty::write_blocking(") {
                local.push(format!("{path}:{}", i + 1));
            }
            if code.contains("ssh::write(") {
                ssh.push(format!("{path}:{}", i + 1));
            }
        }
    }
    let mut files: Vec<&str> = local.iter().map(|s| s.split(':').next().unwrap()).collect();
    files.sort();
    assert_eq!(files, ["server/messenger_bridge.rs", "server/sessions/dispatch.rs"], "{local:?}");
    assert_eq!(ssh.len(), 1, "SSH 쓰기는 세션 op `write` 하나 — 다리는 원격 타일에 쓰지 않는다: {ssh:?}");
    assert!(ssh[0].starts_with("server/sessions/dispatch.rs"), "{ssh:?}");
    // 다리 안에서도 쓰기는 `RealEnv::write_pty` 한 곳 — 부르는 곳은 `inject` 뿐.
    let bridge = include_str!("../messenger_bridge.rs").replace("\r\n", "\n");
    let calls = bridge.lines().filter(|l| l.split("//").next().unwrap_or("").contains(".write_pty(")).count();
    assert_eq!(calls, 2, "넣기의 붙여넣기 · Enter 두 번");
    let inject = &bridge[bridge.find("async fn inject(").unwrap()..];
    let inject = &inject[..inject.find("\n}\n").unwrap()];
    assert_eq!(inject.matches(".write_pty(").count(), 2, "둘 다 inject 안");
    // 전송(3a · 3b)은 넣기 길을 갖지 않는다 — 바깥(`Env`)도 넣기 함수도 부르지 않는다.
    for (name, src) in [("tg.rs", include_str!("tg.rs")), ("dc.rs", include_str!("dc.rs")), ("sl.rs", include_str!("sl.rs")), ("sock.rs", include_str!("sock.rs"))] {
        for bad in ["write_pty", "inject(", "deliver(", ".env", "Env", "pty::", "ssh::write"] {
            assert!(!src.lines().any(|l| l.split("//").next().unwrap_or("").contains(bad)), "{name}: {bad}");
        }
    }
}

/// 다리는 승인 등급 프레임을 만들지 않고 작업안 · 권한 카드 · 위임 · 앨범 · 볼트로 가는 길이 없다.
#[test]
fn bridge_has_no_approval_path() {
    let bad = [
        "Grade::Approve", "request_approve", "approve_operation", "ops_approve", "approve_in", "tile_permission_decide", "decide(",
        "delegation::", "orchestration::", "vault_ops", "hub::vault", "producer::",
    ];
    let server_side = [
        include_str!("../messenger_bridge.rs"),
        include_str!("logic.rs"),
        include_str!("tg.rs"),
        include_str!("dc.rs"),
        include_str!("sl.rs"),
        include_str!("sock.rs"),
        include_str!("../../telegram.rs"),
    ];
    for (i, src) in server_side.iter().chain([include_str!("../messenger_bridge_proxy.rs")].iter()).enumerate() {
        let src = src.replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]\nmod tests {").next().unwrap();
        let code: Vec<&str> = src.lines().map(|l| l.split("//").next().unwrap_or("")).collect();
        for b in bad {
            assert!(!code.iter().any(|l| l.contains(b)), "{i}: {b}");
        }
        // 서버 쪽은 GUI 파이프 클라이언트를 부르지 않는다(서버가 서버에게 요청을 만들 길이 없다).
        if i < server_side.len() {
            assert!(!code.iter().any(|l| l.contains("client::request")), "{i}");
        }
    }
}

/// 2단계 — 다리가 권한 카드에 답하는 길은 `server::tile_permission::resolve_from_bridge` 하나이고, 부르는 곳은 다리의 카드 누름 하나뿐이다
/// (Allow · Deny 둘 — 세션 허용 · 풀기 · 답 없음). 다리 표지는 그 함수 · 보는 창 · 사건 거르기 · 창의 op 거절에만 쓰인다.
#[test]
fn bridge_answers_cards_through_one_function() {
    let mut calls = Vec::new();
    for (path, body) in sources() {
        for (i, line) in body.lines().enumerate() {
            if line.split("//").next().unwrap_or("").contains("resolve_from_bridge(") && !line.contains("fn resolve_from_bridge(") {
                calls.push(format!("{path}:{}", i + 1));
            }
        }
    }
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert!(calls[0].starts_with("server/messenger_bridge.rs"), "{calls:?}");
    let bridge = include_str!("../messenger_bridge.rs").replace("\r\n", "\n");
    let press = &bridge[bridge.find("async fn on_card_press(").unwrap()..];
    let press = &press[..press.find("\n}\n").unwrap()];
    assert!(press.contains("resolve_from_bridge("), "카드 누름 안");
    let perm = include_str!("../tile_permission.rs").replace("\r\n", "\n");
    let f = &perm[perm.find("pub(crate) fn resolve_from_bridge(").unwrap()..];
    let f = &f[..f.find("\n}\n").unwrap()];
    assert!(f.contains("Decision::Allow } else { Decision::Deny }") && !f.contains("AllowSession") && !f.contains("Release") && !f.contains(".answer("));
    // 창의 op 는 다리 표지를 받지 않는다 · 사건 몸에는 싣지 않는다
    let op = &perm[perm.find("\"tile_permission_decide\" => {").unwrap()..];
    assert!(op[..op.find("let w = watchers").unwrap()].contains("b.window == BRIDGE_WINDOW"));
    let emit = &perm[perm.find("fn emit(evs: Vec<Ev>)").unwrap()..];
    let emit = &emit[..emit.find("\n}\n").unwrap()];
    assert!(emit.contains("real_watchers(") && emit.contains("w != BRIDGE_WINDOW") && !emit.contains(" watchers(&ev"));
    // 창 라벨이 될 수 없는 글자(Tauri 라벨은 영숫자 · `-` · `/` · `:` · `_`)
    assert!(crate::server::tile_permission::BRIDGE_WINDOW.chars().any(|c| !(c.is_ascii_alphanumeric() || "-/:_".contains(c))));
}

/// 낱말 경계로 찾는다(`SIDE_CHAT_FILES_PROTOCOL` 이 `CHAT_FILE` 로 잡히지 않게).
fn has_word(code: &str, word: &str) -> bool {
    let ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    code.match_indices(word).any(|(i, _)| {
        let before = code[..i].chars().next_back().is_none_or(|c| !ident(c));
        let after = code[i + word.len()..].chars().next().is_none_or(|c| !ident(c));
        before && after
    })
}

/// GUI 프로세스의 코드는 봇 토큰 파일을 읽지 않는다 — 토큰 파일 이름 · 짝 파일 이름 · 읽는 함수는 다리(서버)에만.
#[test]
fn gui_never_reads_the_token_file() {
    for (path, body) in sources() {
        let code: String = body.lines().map(|l| l.split("//").next().unwrap_or("")).collect::<Vec<_>>().join("\n");
        let allowed = path.starts_with("server/messenger_bridge");
        let chat_names = ["CHAT_FILE", "DISCORD_CHAT_FILE", "SLACK_CHAT_FILE", "CHAT_FILES"];
        if chat_names.iter().any(|w| has_word(&code, w)) || code.contains("load_token(") {
            assert!(allowed || path == "instance.rs", "{path} 가 봇 짝 파일 · 토큰 읽기를 만진다");
        }
        // 다리는 채널 값으로 봇 토큰 파일 이름을 묻는다(`chan.bot_file()` — 3b: Telegram · Discord · 4단계: Slack). 묻는 곳은 이름의 주인 · 다리뿐이다
        // (`messenger.rs` 는 상태 · 알림의 갈래를 고를 때 "봇이 있는 채널인가" 만 본다 — 파일을 열지 않는다).
        if code.contains(".bot_file()") {
            assert!(allowed || path == "messenger.rs", "{path} 가 봇 토큰 파일 이름을 묻는다");
        }
        // 비밀 파일 이름 전부(`secret_files`)는 씨앗 시험 · 이름의 주인만
        if code.contains(".secret_files()") {
            assert!(path == "messenger.rs" || path == "instance.rs", "{path} 가 비밀 파일 이름을 묻는다");
        }
        for name in ["\"telegram-bot\"", "\"discord-bot\"", "\"slack-bot\""] {
            if code.contains(name) {
                assert!(path == "messenger.rs", "{path} — {name} 은 `Channel::bot_file` 한 곳에만");
            }
        }
        if code.contains("\"discord-chat\"") || code.contains("\"telegram-chat\"") || code.contains("\"slack-chat\"") {
            assert!(path == "server/messenger_bridge.rs", "{path} — 짝 파일 이름은 다리에만");
        }
    }
    let messenger = include_str!("../../messenger.rs");
    let telegram_arm = messenger.split("Channel::Telegram").count();
    assert!(telegram_arm > 1);
    assert!(!messenger.contains("load_token") && !messenger.contains("BotToken::parse"));
    // `messenger.rs` 가 여는 파일은 웹훅 파일뿐 — 읽는 함수(`load_at`)의 길은 `webhook_path` 하나다.
    let reads: Vec<&str> = messenger.lines().filter(|l| l.split("//").next().unwrap_or("").contains("read_to_string(")).collect();
    assert_eq!(reads.len(), 1, "{reads:?}");
    assert!(!messenger.contains("bot_file()?)") && !messenger.contains("join(channel.bot_file"), "봇 토큰 파일 경로를 짓지 않는다");
}

// ---------------------------------------------------------------------------
// 통합 — 루프백 가짜 Telegram 서버
// ---------------------------------------------------------------------------

const TOKEN: &str = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";

/// 가짜 Telegram — 받은 (메서드, 몸)을 적고, `getUpdates` 에는 줄 세운 갱신을 준다(없으면 잠깐 쉬고 빈 배열).
struct Fake {
    calls: Mutex<Vec<(String, Value)>>,
    queue: Mutex<Vec<Value>>,
    conflict: std::sync::atomic::AtomicBool,
    next_id: AtomicI64,
}

fn start_fake() -> (Arc<Fake>, String, Arc<tiny_http::Server>) {
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
    let port = server.server_addr().to_ip().unwrap().port();
    let fake = Arc::new(Fake { calls: Mutex::new(Vec::new()), queue: Mutex::new(Vec::new()), conflict: false.into(), next_id: AtomicI64::new(1000) });
    let (f, s) = (fake.clone(), server.clone());
    std::thread::spawn(move || {
        for mut req in s.incoming_requests() {
            let f = f.clone();
            std::thread::spawn(move || {
                let url = req.url().to_string();
                let method = url.rsplit('/').next().unwrap_or("").to_string();
                let authed = url.starts_with(&format!("/bot{TOKEN}/"));
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                f.calls.lock().unwrap().push((method.clone(), v));
                let (code, out) = if !authed {
                    (401, json!({ "ok": false, "error_code": 401, "description": "Unauthorized" }))
                } else {
                    match method.as_str() {
                        "getMe" => (200, json!({ "ok": true, "result": { "id": 1, "is_bot": true, "username": "aynx_test_bot" } })),
                        "getUpdates" => {
                            if f.conflict.load(Ordering::SeqCst) {
                                std::thread::sleep(Duration::from_millis(30));
                                (409, json!({ "ok": false, "error_code": 409, "description": "Conflict" }))
                            } else {
                                let batch: Vec<Value> = std::mem::take(&mut *f.queue.lock().unwrap());
                                if batch.is_empty() {
                                    std::thread::sleep(Duration::from_millis(50));
                                }
                                (200, json!({ "ok": true, "result": batch }))
                            }
                        }
                        "sendMessage" => (200, json!({ "ok": true, "result": { "message_id": f.next_id.fetch_add(1, Ordering::SeqCst) } })),
                        _ => (200, json!({ "ok": true, "result": true })),
                    }
                };
                let _ = req.respond(tiny_http::Response::from_string(out.to_string()).with_status_code(code));
            });
        }
    });
    (fake, format!("http://127.0.0.1:{port}"), server)
}

static UPDATE_ID: AtomicI64 = AtomicI64::new(1);

impl Fake {
    fn push(&self, v: Value) {
        let id = UPDATE_ID.fetch_add(1, Ordering::SeqCst);
        let mut v = v;
        v["update_id"] = json!(id);
        self.queue.lock().unwrap().push(v);
    }

    fn message(&self, from: i64, text: &str, date: i64, reply_to: Option<i64>) {
        let mut m = json!({ "message_id": UPDATE_ID.load(Ordering::SeqCst) + 500, "from": { "id": from, "first_name": "Tester" },
            "chat": { "id": from, "type": "private" }, "date": date, "text": text });
        if let Some(r) = reply_to {
            m["reply_to_message"] = json!({ "message_id": r });
        }
        self.push(json!({ "message": m }));
    }

    fn sent(&self) -> Vec<(String, Value)> {
        self.calls.lock().unwrap().iter().filter(|(m, _)| m != "getUpdates").cloned().collect()
    }

    fn texts(&self) -> Vec<String> {
        self.sent().into_iter().filter(|(m, _)| m == "sendMessage" || m == "editMessageText").map(|(_, v)| v["text"].as_str().unwrap_or("").to_string()).collect()
    }
}

/// 가짜 바깥 — 타일 표 · 쓰기 기록.
#[derive(Default)]
struct FakeEnv {
    chat_on: std::sync::atomic::AtomicBool,
    /// `[messenger] discord_chat`(3b)
    discord_on: std::sync::atomic::AtomicBool,
    /// `[messenger] slack_chat`(4단계)
    slack_on: std::sync::atomic::AtomicBool,
    tiles: Mutex<HashMap<String, (TileView, u32)>>,
    writes: Mutex<Vec<(u32, Vec<u8>)>>,
    /// 답 읽기의 각본 — 앞에서 하나씩(마지막 하나는 계속) · 비면 고정 답
    answers: Mutex<std::collections::VecDeque<(Option<String>, Option<u64>)>>,
    titles: Mutex<HashMap<String, String>>,
}

impl Env for FakeEnv {
    fn prefs(&self) -> MessengerPrefs {
        MessengerPrefs {
            telegram_chat: Some(self.chat_on.load(Ordering::SeqCst)),
            discord_chat: Some(self.discord_on.load(Ordering::SeqCst)),
            slack_chat: Some(self.slack_on.load(Ordering::SeqCst)),
            ..Default::default()
        }
    }
    fn streams(&self) -> Vec<String> {
        let mut v: Vec<String> = self.tiles.lock().unwrap().keys().cloned().collect();
        v.sort();
        v
    }
    fn tile(&self, stream: &str) -> TileView {
        self.tiles.lock().unwrap().get(stream).map(|t| t.0.clone()).unwrap_or_default()
    }
    fn local(&self, stream: &str) -> Option<(u32, u64)> {
        self.tiles.lock().unwrap().get(stream).map(|t| (t.1, 1))
    }
    fn write_pty(&self, id: u32, bytes: &[u8]) -> Result<(), ()> {
        self.writes.lock().unwrap().push((id, bytes.to_vec()));
        Ok(())
    }
    fn answer(&self, _cli: &str, _convo: Option<&str>) -> (Option<String>, Option<u64>) {
        let mut q = self.answers.lock().unwrap();
        match q.len() {
            0 => (Some(format!("DONE <ok> & {}\n\n{}", "가".repeat(10), "z".repeat(5000))), Some(1)),
            1 => q[0].clone(),
            _ => q.pop_front().unwrap(),
        }
    }
    fn fallback_label(&self, stream: &str) -> String {
        format!("claude · {stream}")
    }
    fn title(&self, stream: &str) -> Option<String> {
        self.titles.lock().unwrap().get(stream).and_then(|t| clean_title(t))
    }
}

fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
    let until = std::time::Instant::now() + Duration::from_secs(8);
    while std::time::Instant::now() < until {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("기다림 실패: {what}");
}

/// 다리 상태는 프로세스 하나에 하나 — 통합 시험 둘은 차례로(같은 `start` 를 부른다).
static LIVE: Mutex<()> = Mutex::new(());

#[test]
fn live_bridge_with_fake_telegram() {
    let _one = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (fake, base, server) = start_fake();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let dir = std::env::temp_dir().join(format!("aynx-bridge-{}-{}", std::process::id(), now_ms()));
    let env = Arc::new(FakeEnv::default());
    let cfg = Config {
        telegram: tg::Conf { api: Api::at(&base), poll_timeout_secs: 1 },
        discord: dc::Conf::release(),
        slack: sl::Conf::release(),
        dir: Some(dir.clone()),
        env: env.clone(),
        backoff: Duration::from_millis(50),
        conflict_backoff: Duration::from_millis(50),
        enter_delay: Duration::from_millis(5),
        ask_grace: Duration::from_millis(100),
        answer_poll: Duration::from_millis(20),
        answer_deadline: Duration::from_millis(500),
        answer_wait: Duration::from_millis(1000),
    };
    rt.block_on(async { start(cfg) });
    let op = |name: &str, body: Value| rt.block_on(handle(name, body));
    assert_eq!(op("messenger_bot_status", Value::Null).unwrap()["configured"], false);
    assert_eq!(op("messenger_bot_status", Value::Null).unwrap()["link"], "off");
    // 3a — 몸의 `channel`: 없으면 Telegram · 모르는 채널은 거절(4단계부터 세 채널 모두 전송이 있다 — `CHANNELS`)
    assert_eq!(op("messenger_bot_status", json!({ "channel": "telegram" })).unwrap(), op("messenger_bot_status", Value::Null).unwrap());
    assert!(Channel::ALL.iter().all(|c| has_transport(*c)));
    assert_eq!(op("messenger_bot_status", json!({ "channel": "slack" })).unwrap()["configured"], false, "Slack 칸은 따로");
    assert!(op("messenger_bot_status", json!({ "channel": "nope" })).is_err());

    // 토큰 — 틀린 모양 · Telegram 거절 · 등록(`getMe`) · 파일 · 상태에 토큰 없음.
    let e = op("messenger_bot_set_token", json!({ "token": "nope" })).unwrap_err();
    assert!(e.message.starts_with("[bad-token]"));
    let e = op("messenger_bot_set_token", json!({ "token": "987654321:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ" })).unwrap_err();
    assert!(e.message.starts_with("[bad-token]") && !e.message.contains("AAHdq"), "{}", e.message);
    let st = op("messenger_bot_set_token", json!({ "token": TOKEN })).unwrap();
    assert_eq!((st["configured"].as_bool(), st["bot"].as_str(), st["paired"].as_bool()), (Some(true), Some("aynx_test_bot"), Some(false)));
    assert!(!st.to_string().contains("AAHdq"), "상태에 토큰이 없다");
    assert_eq!(std::fs::read_to_string(dir.join("telegram-bot")).unwrap(), TOKEN);
    wait_for("롱폴 ok", || op("messenger_bot_status", Value::Null).unwrap()["link"] == "ok");

    // 짝짓기 — 낯선 사람 → 코드 답장 · 상태의 대기 · 30초 안 재요청은 조용히 · [허용].
    let now = (now_ms() / 1000) as i64;
    fake.message(42, "hello", now, None);
    wait_for("코드 답장", || fake.texts().iter().any(|t| t.contains("연결 코드") || t.contains("Pairing code")));
    let pending = op("messenger_bot_status", Value::Null).unwrap()["pending"].clone();
    let code = pending["code"].as_str().unwrap().to_string();
    assert_eq!(pending["name"], "Tester");
    assert!(fake.texts().iter().any(|t| t.contains(&code)));
    fake.message(43, "me too", now, None);
    fake.message(42, "again", now, None);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(fake.texts().iter().filter(|t| t.contains(&code)).count(), 1, "다른 계정 · 30초 안 재요청은 답하지 않는다");
    assert!(op("messenger_bot_pair", json!({ "code": "000000", "allow": true })).unwrap_err().message.starts_with("[no-pending]"));
    let st = op("messenger_bot_pair", json!({ "code": code, "allow": true })).unwrap();
    assert_eq!((st["paired"].as_bool(), st["pairName"].as_str()), (Some(true), Some("Tester")));
    assert!(std::fs::read_to_string(dir.join("telegram-chat")).unwrap().contains("\"chatId\":42"));

    // 다리 꺼짐 → 거절 답장 · 쓰기 없음.
    let before = fake.texts().len();
    fake.message(42, "do it", now, None);
    wait_for("꺼짐 답장", || fake.texts().len() > before);
    assert!(env.writes.lock().unwrap().is_empty());
    env.chat_on.store(true, Ordering::SeqCst);

    // 타일 없음 → "기다리는 타일이 없다" · 실행 중 타일도 후보가 아니다.
    let mut running = ready_tile("claude");
    running.agent.as_mut().unwrap().state = Some(Phase::Running);
    env.tiles.lock().unwrap().insert("local-s1".into(), (running, 11));
    let before = fake.texts().len();
    fake.message(42, "do it", now, None);
    wait_for("없음 답장", || fake.texts().len() > before);
    assert!(env.writes.lock().unwrap().is_empty(), "실행 중 타일에 넣지 않는다");
    let nowhere = fake.texts().last().cloned().unwrap();
    assert!(nowhere.ends_with(&format!("\n· claude · local-s1 — {}", refusal_short(Refusal::Running))), "타일별 까닭 줄: {nowhere}");

    // 하나뿐 → 넣기(붙여넣기 + Enter) · "→ 이름표" 답장.
    env.tiles.lock().unwrap().insert("local-s1".into(), (ready_tile("claude"), 11));
    fake.message(42, "fix the \x1b[201~ bug\nplease", now, None);
    wait_for("넣기", || env.writes.lock().unwrap().len() == 2);
    {
        let w = env.writes.lock().unwrap();
        assert_eq!(w[0], (11, b"\x1b[200~fix the [201~ bug\rplease\x1b[201~".to_vec()));
        assert_eq!(w[1], (11, b"\r".to_vec()));
    }
    wait_for("→ 답장", || fake.texts().iter().any(|t| t.contains("→ claude · local-s1")));

    // 다리 턴의 끝 → 답 전문(나눠서) · 그 턴의 프런트 알림은 건너뛴다 · 스트림 없는 알림은 간다.
    let before = fake.texts().len();
    let sends_before = fake.sent().iter().filter(|(m, _)| m == "sendMessage").count() as i64;
    on_turn_event("local-s1", TurnEvent::Done, Some("claude"), Some("c1".into()));
    wait_for("답", || fake.texts().len() >= before + 2);
    let texts = fake.texts();
    let answer = &texts[before];
    assert!(answer.starts_with("<b>🟢 claude · local-s1</b>\nDONE &lt;ok&gt; &amp; "), "{answer}");
    // 상한은 엔티티 해석 뒤 글자로 잰다(Bot API) — 태그 · 엔티티를 풀어 센다.
    let parsed = |t: &str| t.replace("<b>", "").replace("</b>", "").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&");
    assert!(texts[before..].iter().all(|t| crate::telegram::units(&parsed(t)) <= crate::telegram::TEXT_MAX));
    let answer_id = 1000 + sends_before;
    let before = fake.texts().len();
    rt.block_on(notify(Notice { text: "<b>턴 끝</b>".into(), stream: Some("local-s1".into()), kind: Some("stop".into()), label: Some("내 타일".into()), channel: None, has_tool: false })).unwrap();
    assert_eq!(fake.texts().len(), before, "다리 턴의 같은 알림은 한 번 더 가지 않는다");
    rt.block_on(notify(Notice { text: "<b>작업안</b>".into(), stream: None, kind: None, label: None, channel: None, has_tool: false })).unwrap();
    assert_eq!(fake.texts().len(), before + 1);
    // 알림의 이름(`label`)은 다리 이름표가 아니다 — 다리가 맡지 않은 알림이어도 적지 않는다(이름표를 적는 길은 `messenger_bot_label` 하나).
    rt.block_on(notify(Notice { text: "<b>권한</b>".into(), stream: Some("local-s1".into()), kind: Some("osc".into()), label: Some("내 타일".into()), channel: None, has_tool: false })).unwrap();
    assert!(!state().labels.contains_key("local-s1"), "notify 는 이름표를 덮어쓰지 않는다");

    // 답장 → 그 타일로(이름표는 알림의 이름이 아니라 대체 이름 — 미리 알린 것이 없다).
    let arrows = || fake.texts().iter().filter(|t| t.as_str() == "→ claude · local-s1").count();
    let arrows_before = arrows();
    fake.message(42, "next", now, Some(answer_id));
    wait_for("답장 넣기", || env.writes.lock().unwrap().len() == 4);
    wait_for("이름표", || arrows() == arrows_before + 1);
    assert!(!fake.texts().iter().any(|t| t.contains("내 타일")));

    // 지난 글 → 넣지 않고 한 통.
    let writes = env.writes.lock().unwrap().len();
    on_turn_event("local-s1", TurnEvent::Gone, None, None);
    fake.message(42, "old", now - STALE_SECS - 30, None);
    wait_for("지난 글 알림", || fake.texts().iter().any(|t| t.contains("1개") || t.contains("1 message")));
    assert_eq!(env.writes.lock().unwrap().len(), writes);

    // 여럿 → 고르기 단추 · 누르면 그 타일에 · 단추 통을 결과로.
    env.tiles.lock().unwrap().insert("local-s2".into(), (ready_tile("codex"), 22));
    fake.message(42, "which", now, None);
    wait_for("단추", || fake.sent().iter().any(|(m, v)| m == "sendMessage" && v.get("reply_markup").is_some()));
    let (_, kb) = fake.sent().into_iter().rev().find(|(m, v)| m == "sendMessage" && v.get("reply_markup").is_some()).unwrap();
    let rows = kb["reply_markup"]["inline_keyboard"].as_array().unwrap().clone();
    assert_eq!(rows.len(), 2);
    let data = rows[1][0]["callback_data"].as_str().unwrap().to_string();
    fake.push(json!({ "callback_query": { "id": "cb1", "from": { "id": 99 }, "data": data } }));
    fake.push(json!({ "callback_query": { "id": "cb2", "from": { "id": 42 }, "message": { "message_id": 1, "chat": { "id": 42 } }, "data": data } }));
    wait_for("고른 타일에 넣기", || env.writes.lock().unwrap().iter().any(|(id, _)| *id == 22));
    wait_for("단추 통 바꿈", || fake.sent().iter().any(|(m, v)| m == "editMessageText" && v["text"].as_str().is_some_and(|t| t.starts_with("→"))));
    assert!(fake.sent().iter().any(|(m, v)| m == "answerCallbackQuery" && v["callback_query_id"] == "cb2"));
    assert!(!fake.sent().iter().any(|(m, v)| m == "answerCallbackQuery" && v["callback_query_id"] == "cb1"), "남의 누름은 조용히");

    // 다리 턴의 권한 물음 → "확인 필요" 한 번.
    let before = fake.texts().len();
    on_turn_event("local-s2", TurnEvent::Asked, None, None);
    on_turn_event("local-s2", TurnEvent::Asked, None, None);
    wait_for("확인 필요", || fake.texts().len() == before + 1);

    // 실기 후속 — 이름표 미리 알리기(보내지 않는다) · 겹친 이름표는 대화 제목 · 고른 뒤 `→` 줄도 단추 글자.
    let before = fake.texts().len();
    op("messenger_bot_label", json!({ "stream": "local-s1", "label": "proj / wt" })).unwrap();
    op("messenger_bot_label", json!({ "stream": "local-s2", "label": "proj / wt\u{7}" })).unwrap();
    assert_eq!(fake.texts().len(), before, "미리 알리기는 아무것도 보내지 않는다");
    env.titles.lock().unwrap().insert("local-s1".into(), "Fix\n the   bug".into());
    let kb_count = || fake.sent().iter().filter(|(m, v)| m == "sendMessage" && v.get("reply_markup").is_some()).count();
    let kbs = kb_count();
    fake.message(42, "dup", now, None);
    wait_for("겹친 단추", || kb_count() > kbs);
    let (_, kb) = fake.sent().into_iter().rev().find(|(m, v)| m == "sendMessage" && v.get("reply_markup").is_some()).unwrap();
    let rows = kb["reply_markup"]["inline_keyboard"].as_array().unwrap().clone();
    let shown: Vec<&str> = rows.iter().map(|r| r[0]["text"].as_str().unwrap()).collect();
    assert_eq!(shown, ["proj / wt — Fix the bug", "proj / wt"]);
    let data = rows[0][0]["callback_data"].as_str().unwrap().to_string();
    fake.push(json!({ "callback_query": { "id": "cb3", "from": { "id": 42 }, "message": { "message_id": 2, "chat": { "id": 42 } }, "data": data } }));
    wait_for("→ 단추 글자", || fake.sent().iter().any(|(m, v)| m == "editMessageText" && v["text"] == "→ proj / wt — Fix the bug"));

    // 실기 후속 — 답 읽기가 끝까지 비면 "읽지 못했습니다".
    *env.answers.lock().unwrap() = [(None, Some(5))].into_iter().collect();
    tend_as_bridge_turn("local-s2");
    let before = fake.texts().len();
    on_turn_event("local-s2", TurnEvent::Done, Some("claude"), Some("c2".into()));
    wait_for("못 읽음", || fake.texts().len() > before);
    let t = fake.texts().last().cloned().unwrap();
    assert!(t.contains("답을 읽지 못했습니다") || t.contains("could not read the reply"), "{t}");
    env.answers.lock().unwrap().clear();

    // 409 → 상태 conflict.
    fake.conflict.store(true, Ordering::SeqCst);
    wait_for("conflict", || op("messenger_bot_status", Value::Null).unwrap()["link"] == "conflict");
    fake.conflict.store(false, Ordering::SeqCst);
    wait_for("다시 ok", || op("messenger_bot_status", Value::Null).unwrap()["link"] == "ok");

    // 시험 한 통 · 짝 끊기 · 토큰 해제(파일 둘 다 지운다 · 고리 멈춤).
    op("messenger_bot_test", Value::Null).unwrap();
    assert_eq!(op("messenger_bot_unpair", Value::Null).unwrap()["paired"], false);
    assert!(!dir.join("telegram-chat").exists());
    assert!(op("messenger_bot_test", Value::Null).unwrap_err().message.starts_with("[not-paired]"));
    let st = op("messenger_bot_set_token", json!({ "token": null })).unwrap();
    assert_eq!((st["configured"].as_bool(), st["link"].as_str()), (Some(false), Some("off")));
    assert!(!dir.join("telegram-bot").exists());
    // 받은 글 본문 · 토큰은 로그 갈래에 없다 — 로그는 고정 글자뿐(소스가 `log::line(` 에 변수를 싣는 곳은 오류 종류뿐).
    for src in [include_str!("../messenger_bridge.rs"), include_str!("tg.rs"), include_str!("dc.rs"), include_str!("sl.rs"), include_str!("sock.rs")] {
        for l in src.lines().filter(|l| l.contains("log::line(format!")) {
            // 실을 수 있는 변수는 오류 종류 · 게이트웨이 닫힘 코드 숫자(`u16`) · Slack 의 오류 코드 낱말(`sl::parse_response` 가 소문자 · 숫자 · `_`
            // 40자로 거른 것) · Slack 이 알려 준 연결 수(숫자)뿐
            let ok = l.contains("err_kind") || l.contains("(code {code})") || l.contains("refused for good ({code})") || l.contains("(connections {n})");
            assert!(ok, "{l}");
        }
    }
    server.unblock();
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// 통합 — 2단계: 가짜 Telegram + 진짜 카드 표(신호 평면의 `/agent-permission` 롱폴)
// ---------------------------------------------------------------------------

fn http(port: u16, raw: &str) -> String {
    use std::io::{Read, Write};
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(15))).unwrap();
    s.write_all(raw.as_bytes()).unwrap();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

fn perm_req(port: u16, stream: &str, phase: &str, tok: &str, body: &Value) -> String {
    let body = body.to_string();
    format!(
        "POST {}?stream={stream}&phase={phase} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {tok}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        crate::tile_permission::PATH,
        body.len()
    )
}

/// 시험 세션 하나 — 세션 코어 항목 · 권한 결정 토큰.
struct Tile {
    stream: String,
    epoch: u64,
    lease: u64,
    token: String,
    id: u32,
    owner: u64,
}

const WINDOW: &str = "brcard-window";

fn open_tile(name: &str, n: u32) -> Tile {
    let pid = std::process::id();
    let stream = format!("brcard-{name}-{pid}");
    let id = 3_960_000_000u32 + (pid % 1000) * 10 + n;
    let keys = crate::session_core::core().commit(&stream, Kind::Local, id, WINDOW, std::time::Instant::now());
    let owner = 7_800_000_000u64 + u64::from(n);
    let token = crate::tile_permission::issue(&stream, owner).expect("토큰");
    assert!(crate::tile_permission::bind_epoch(&stream, owner, keys.session_epoch));
    Tile { stream, epoch: keys.session_epoch, lease: keys.lease_epoch, token, id, owner }
}

impl Tile {
    /// 보는 창을 모두 뗀다(트레이 · GUI 없음과 같다).
    fn detach(&self) {
        crate::session_core::core().detach(&self.stream, self.epoch, self.lease).unwrap();
    }

    fn close(&self) {
        crate::server::tile_permission::revoke(&self.stream, self.owner);
        crate::session_core::core().remove_id(Kind::Local, self.id);
    }
}

fn bash(cli: &str, tool: &str, cmd: &str) -> Value {
    json!({"cli": cli, "tool": tool, "digest": format!("{:064x}", cmd.len()), "input": {"command": cmd}, "session": "c1"})
}

/// 다리 턴처럼 돌본다(넣기 함수가 하는 것과 같은 두 줄).
fn tend_as_bridge_turn(stream: &str) {
    let mut s = state();
    let c = s.chan(Channel::Telegram);
    c.turns.begin(stream, now_ms());
    c.tending.tend(stream);
}

impl Fake {
    /// 그 타일 이름표가 든 단추 통(가장 최근)의 (본문, 허용 데이터, 거절 데이터).
    fn button_message(&self, label: &str) -> Option<(String, String, String)> {
        self.sent().into_iter().rev().find_map(|(m, v)| {
            let text = v["text"].as_str()?.to_string();
            let rows = v["reply_markup"]["inline_keyboard"].as_array()?;
            let data = |i: usize| rows.get(i)?[0]["callback_data"].as_str().map(str::to_string);
            let (a, d) = (data(0)?, data(1)?);
            (m == "sendMessage" && text.contains(label) && a.starts_with("pa:")).then_some((text, a, d))
        })
    }

    fn press(&self, cb: &str, from: i64, data: &str) {
        self.push(json!({ "callback_query": { "id": cb, "from": { "id": from }, "message": { "message_id": 1, "chat": { "id": from } }, "data": data } }));
    }

    fn callback_answer(&self, cb: &str) -> Option<String> {
        self.sent().into_iter().find(|(m, v)| m == "answerCallbackQuery" && v["callback_query_id"] == cb).map(|(_, v)| v["text"].as_str().unwrap_or("").to_string())
    }

    fn edits(&self) -> Vec<String> {
        self.sent().into_iter().filter(|(m, _)| m == "editMessageText").map(|(_, v)| v["text"].as_str().unwrap_or("").to_string()).collect()
    }
}

fn standing(stream: &str) -> usize {
    crate::server::tile_permission::standing_cards(stream).len()
}

#[test]
fn live_card_buttons_with_fake_telegram() {
    let _one = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (fake, base, server) = start_fake();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let dir = std::env::temp_dir().join(format!("aynx-bridge-cards-{}-{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("telegram-bot"), TOKEN).unwrap();
    std::fs::write(dir.join(CHAT_FILE), r#"{"userId":42,"chatId":42,"name":"Tester"}"#).unwrap();
    let env = Arc::new(FakeEnv::default());
    env.chat_on.store(true, Ordering::SeqCst);
    let cfg = Config {
        telegram: tg::Conf { api: Api::at(&base), poll_timeout_secs: 1 },
        discord: dc::Conf::release(),
        slack: sl::Conf::release(),
        dir: Some(dir.clone()),
        env: env.clone(),
        backoff: Duration::from_millis(50),
        conflict_backoff: Duration::from_millis(50),
        enter_delay: Duration::from_millis(5),
        ask_grace: Duration::from_millis(100),
        answer_poll: Duration::from_millis(20),
        answer_deadline: Duration::from_millis(500),
        answer_wait: Duration::from_millis(1000),
    };
    rt.block_on(async { start(cfg) });
    let op = |name: &str, body: Value| rt.block_on(handle(name, body));
    wait_for("롱폴 ok", || op("messenger_bot_status", Value::Null).unwrap()["link"] == "ok");
    assert_eq!(op("messenger_bot_status", Value::Null).unwrap()["paired"], true);
    // 토큰 파일이 이미 있는 시작(서버를 다시 띄움) — 봇 이름을 다시 묻는다.
    wait_for("봇 이름", || op("messenger_bot_status", Value::Null).unwrap()["bot"] == "aynx_test_bot");

    let emit: crate::server::signal_http::Emit = Arc::new(|_| {});
    let plane = crate::server::signal_http::start(emit, None).expect("평면");
    let port = plane.port;
    let ask = |t: &Tile, body: Value| {
        let raw = perm_req(port, &t.stream, "ask", &t.token, &body);
        std::thread::spawn(move || http(port, &raw))
    };

    // ① 돌보지 않는 스트림은 예전 그대로 — 보는 창이 없으면 카드 없이 곧바로 빈 출력 · 메신저에는 아무것도 없다.
    let a = open_tile("a", 1);
    a.detach();
    let label_a = format!("claude · {}", a.stream);
    let got = ask(&a, bash("claude", "Bash", "rm -rf build")).join().unwrap();
    assert!(got.contains(r#""state":"release""#), "{got}");
    std::thread::sleep(Duration::from_millis(200));
    assert!(!fake.texts().iter().any(|t| t.contains(&label_a)), "돌보지 않으면 다리는 보지 않는다");

    // ② 다리 턴(돌봄) — 보는 창이 하나도 없어도 카드가 서고 단추 통이 나간다 · 남의 누름은 무시 · [허용] → 훅 출력 allow.
    tend_as_bridge_turn(&a.stream);
    let waiter = ask(&a, bash("claude", "Bash", "rm -rf build"));
    wait_for("단추 통", || fake.button_message(&label_a).is_some());
    let (text, allow, _) = fake.button_message(&label_a).unwrap();
    assert!(text.contains("Bash · rm -rf build"), "{text}");
    assert!(text.starts_with("🟡"), "{text}");
    // 카드가 선 물음의 신호(`waiting permission`)는 한 통을 더 만들지 않는다(카드 먼저 · 신호 뒤)
    let before = fake.texts().len();
    on_turn_event(&a.stream, TurnEvent::Asked, Some("claude"), None);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(fake.texts().len(), before, "한 물음에 한 통");
    fake.press("x1", 99, &allow);
    std::thread::sleep(Duration::from_millis(300));
    assert!(fake.callback_answer("x1").is_none(), "남의 계정 누름은 조용히");
    assert_eq!(standing(&a.stream), 1, "남의 누름은 먹지 않는다");
    fake.press("c1", 42, &allow);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""state":"decided""#) && got.contains(r#""behavior":"allow""#), "{got}");
    wait_for("허용 답", || fake.callback_answer("c1").is_some_and(|t| t == logic::press_text(PressResult::Allowed)));
    wait_for("통 바꿈", || fake.edits().iter().any(|t| t.contains(&label_a) && t.ends_with(&logic::press_text(PressResult::Allowed))));
    // 같은 단추를 또 누르면 "이미 처리됐습니다"
    fake.press("c1b", 42, &allow);
    wait_for("이미", || fake.callback_answer("c1b").is_some_and(|t| t == logic::press_text(PressResult::Already)));

    // ③ [거절] → 훅 출력 deny.
    let waiter = ask(&a, bash("claude", "Bash", "git push --force"));
    wait_for("둘째 단추 통", || fake.button_message("git push --force").is_some());
    let (_, _, deny) = fake.button_message("git push --force").unwrap();
    fake.press("c2", 42, &deny);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""behavior":"deny""#), "{got}");
    wait_for("거절 답", || fake.callback_answer("c2").is_some_and(|t| t == logic::press_text(PressResult::Denied)));

    // ④ 꺼진 뒤 누름 → 거절(카드는 그대로) · 다른 곳에서 풀림(TUI 에서 [Yes] — `post`) → 통이 결과 한 줄로 바뀐다.
    let body = bash("claude", "Bash", "cargo publish");
    let waiter = ask(&a, body.clone());
    wait_for("셋째 단추 통", || fake.button_message("cargo publish").is_some());
    let (_, allow3, _) = fake.button_message("cargo publish").unwrap();
    env.chat_on.store(false, Ordering::SeqCst);
    fake.press("c3", 42, &allow3);
    wait_for("꺼짐 답", || fake.callback_answer("c3").is_some_and(|t| t == logic::press_text(PressResult::Off)));
    assert_eq!(standing(&a.stream), 1, "꺼져 있으면 결정하지 않는다");
    env.chat_on.store(true, Ordering::SeqCst);
    assert!(http(port, &perm_req(port, &a.stream, "post", &a.token, &body)).starts_with("HTTP/1.1 204"));
    assert!(waiter.join().unwrap().contains(r#""state":"release""#));
    wait_for("다른 곳에서 풀림", || fake.edits().iter().any(|t| t.ends_with(&logic::gone_text("terminal"))));
    fake.press("c3b", 42, &allow3);
    wait_for("풀린 뒤 누름", || fake.callback_answer("c3b").is_some_and(|t| t == logic::press_text(PressResult::Already)));

    // ⑤ 질문 카드 — 단추 없이 "앱에서 답하세요" 한 통.
    let q = json!({"cli": "claude", "tool": "AskUserQuestion", "digest": "e".repeat(64), "session": "c1",
        "input": {"questions": [{"question": "Which?", "header": "W", "options": [{"label": "A"}]}]}});
    let before = fake.sent().iter().filter(|(m, _)| m == "sendMessage").count();
    let waiter = ask(&a, q.clone());
    wait_for("질문 알림", || fake.sent().iter().filter(|(m, _)| m == "sendMessage").count() == before + 1);
    let (_, last) = fake.sent().into_iter().rfind(|(m, _)| m == "sendMessage").unwrap();
    assert!(last.get("reply_markup").is_none(), "질문 카드에는 단추가 없다");
    assert!(last["text"].as_str().unwrap().contains(&label_a));
    assert!(http(port, &perm_req(port, &a.stream, "post", &a.token, &q)).starts_with("HTTP/1.1 204"));
    waiter.join().unwrap();

    // ⑥ Codex — 대화 면으로 보는 창이 없으면 예전대로 TUI(카드 없음) · 돌보면 TUI 대신 카드 → [거절] → deny.
    let b = open_tile("b", 2);
    let label_b = format!("claude · {}", b.stream);
    let got = ask(&b, bash("codex", "exec_command", "ls -la")).join().unwrap();
    assert!(got.contains(r#""state":"release""#), "면 규칙 그대로: {got}");
    tend_as_bridge_turn(&b.stream);
    let waiter = ask(&b, bash("codex", "exec_command", "ls -la"));
    wait_for("Codex 단추 통", || fake.button_message(&label_b).is_some());
    let (_, _, deny) = fake.button_message(&label_b).unwrap();
    fake.press("c4", 42, &deny);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""behavior":"deny""#), "{got}");

    // ⑦ 다리 턴이 아닌 턴 — 사람 창이 보는 동안 선 카드 · 프런트의 권한 알림이 닿으면 그 글에 단추를 달고 돌본다 → 창을 떼도 누름이 먹는다.
    let c = open_tile("c", 3);
    let label_c = format!("claude · {}", c.stream);
    let waiter = ask(&c, bash("claude", "Bash", "npm publish"));
    wait_for("카드", || standing(&c.stream) == 1);
    std::thread::sleep(Duration::from_millis(200));
    assert!(fake.button_message(&label_c).is_none() && !tends(&c.stream), "돌보지 않는 동안은 단추 통이 없다");
    rt.block_on(notify(Notice { text: "<b>권한 확인</b>".into(), stream: Some(c.stream.clone()), kind: Some("permission".into()), label: None, channel: None, has_tool: false })).unwrap();
    assert!(tends(&c.stream), "알림에 단추를 단 스트림은 돌본다");
    let (text, allow, _) = fake.button_message("<b>권한 확인</b>").expect("알림에 단추");
    assert!(text.starts_with("<b>권한 확인</b>\n") && text.contains("Bash · npm publish"), "{text}");
    // 같은 카드의 알림이 또 와도 한 통 더 보내지 않는다
    let n = fake.texts().len();
    rt.block_on(notify(Notice { text: "<b>권한 확인</b>".into(), stream: Some(c.stream.clone()), kind: Some("permission".into()), label: None, channel: None, has_tool: false })).unwrap();
    assert_eq!(fake.texts().len(), n);
    c.detach();
    fake.press("c5", 42, &allow);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""behavior":"allow""#), "{got}");
    // 카드가 없는 권한 알림은 지금처럼 글만
    rt.block_on(notify(Notice { text: "<b>또 권한</b>".into(), stream: Some(c.stream.clone()), kind: Some("permission".into()), label: None, channel: None, has_tool: false })).unwrap();
    let (_, last) = fake.sent().into_iter().rfind(|(m, _)| m == "sendMessage").unwrap();
    assert!(last["text"] == "<b>또 권한</b>" && last.get("reply_markup").is_none());
    // 턴이 끝나면 돌봄을 걷는다
    on_turn_event(&c.stream, TurnEvent::Done, Some("claude"), None);
    assert!(!tends(&c.stream));
    on_turn_event(&a.stream, TurnEvent::Gone, None, None);
    assert!(!tends(&a.stream));

    // ⑧ 알림 글이 이미 "묻는 도구" 줄을 실었으면(`has_tool` — 대화 글자 싣기) 단추를 달 때 다시 덧붙이지 않는다(실기 2026-11-19 — 두 번 나왔다).
    let d = open_tile("d", 4);
    let waiter = ask(&d, bash("claude", "Bash", "npm test"));
    wait_for("카드", || standing(&d.stream) == 1);
    rt.block_on(notify(Notice { text: "<b>도구 줄 있음</b>".into(), stream: Some(d.stream.clone()), kind: Some("permission".into()), label: None, channel: None, has_tool: true })).unwrap();
    let (text, allow, _) = fake.button_message("<b>도구 줄 있음</b>").expect("알림에 단추");
    assert_eq!(text, "<b>도구 줄 있음</b>", "도구 줄을 덧붙이지 않는다");
    fake.press("c6", 42, &allow);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""behavior":"allow""#), "{got}");
    on_turn_event(&d.stream, TurnEvent::Done, Some("claude"), None);

    for t in [&a, &b, &c, &d] {
        t.close();
    }
    let st = op("messenger_bot_set_token", json!({ "token": null })).unwrap();
    assert_eq!(st["configured"], false);
    server.unblock();
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}
