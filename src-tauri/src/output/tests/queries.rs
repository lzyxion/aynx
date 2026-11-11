//! 터미널 질의 해석 · 대신 답하기 시험 — `output.rs` 에서 그대로 옮겼다(모듈 경로 `output::queries::dsr_tests` — 질의 상수를 보므로 `queries` 아래).
use super::*;
use crate::output::*;

const Q: &[u8] = b"\x1b[6n";

fn count_dsr(carry: &[u8], batch: &[u8]) -> usize {
    scan_queries(carry, batch).into_iter().filter(|q| *q == TermQuery::Dsr).count()
}

/// 커서 위치 질의 세기 — 한 배치 안 · 여럿 · 배치 경계에 걸친 것 · 앞 배치에서 이미 센 것은 다시 세지 않는다.
#[test]
fn counts_queries_across_batch_boundaries_once() {
    assert_eq!(count_dsr(b"", b"plain"), 0);
    assert_eq!(count_dsr(b"", Q), 1);
    let two = [Q, b"x", Q].concat();
    assert_eq!(count_dsr(b"", &two), 2);
    // 경계에 걸친 질의: 앞 배치가 `ESC[6` 로 끝나고 다음이 `n` 으로 시작.
    let first = b"abc\x1b[6";
    let carry = next_carry(b"", first);
    assert_eq!(count_dsr(b"", first), 0);
    assert_eq!(count_dsr(&carry, b"n tail"), 1);
    // 앞 배치 안에서 끝난 질의는 carry 에 남아도 다시 세지 않는다.
    let carry = next_carry(b"", &[b"xx".as_slice(), Q].concat());
    assert!(carry.ends_with(Q) && carry.len() < QUERY_MAX);
    assert_eq!(count_dsr(&carry, b"more"), 0);
    // 아주 짧은 배치들로 쪼개져 와도 한 번.
    let mut carry = Vec::new();
    let mut n = 0;
    for b in Q {
        n += count_dsr(&carry, std::slice::from_ref(b));
        carry = next_carry(&carry, std::slice::from_ref(b));
    }
    assert_eq!(n, 1);
}

/// Claude Code 가 시작할 때 보내는 질의 묶음(실측 순서 흉내) — kitty 그래픽 질의는 답하지 않는다(DA1 이 기다림을 끝낸다).
const BOOT: &[u8] = b"\x1b[>0q\x1b[?2026$p\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[?1016$p\x1b]10;?\x1b\\\x1b]11;?\x07\x1b[>c\x1b[c\x1b[6n\x1b[38;2;1;2;3mtext\x1b[0c";

fn expected_boot() -> Vec<TermQuery> {
    vec![
        TermQuery::XtVersion,
        TermQuery::Decrqm { private: true, mode: 2026 },
        TermQuery::Decrqm { private: true, mode: 1016 },
        TermQuery::Color { which: 10, st: true },
        TermQuery::Color { which: 11, st: false },
        TermQuery::Da2,
        TermQuery::Da1,
        TermQuery::Dsr,
        TermQuery::Da1,
    ]
}

/// 창 없는 세션 — DA1 · DA2 · XTVERSION · DECRQM · OSC 10/11 · DSR 에 답하고, 배치 경계에 걸쳐도(한 바이트씩 와도) 한 번씩만.
#[test]
fn unattached_session_answers_terminal_queries() {
    assert_eq!(scan_queries(b"", BOOT), expected_boot());
    // 한 바이트씩 쪼개져 와도 같은 질의를 같은 순서로 한 번씩.
    let mut carry = Vec::new();
    let mut got = Vec::new();
    for b in BOOT {
        got.extend(scan_queries(&carry, std::slice::from_ref(b)));
        carry = next_carry(&carry, std::slice::from_ref(b));
    }
    assert_eq!(got, expected_boot());
    // 질의가 아닌 것 — 다른 CSI · 다른 OSC · 다른 DA 매개변수.
    assert!(scan_queries(b"", b"\x1b[2J\x1b]0;title\x07\x1b[1c\x1b[>1q\x1b[?$p\x1b[5n").is_empty());

    // 답 내용 표.
    let reply = |q: TermQuery| String::from_utf8(term_reply(&q, 30)).unwrap();
    assert_eq!(reply(TermQuery::Dsr), "\x1b[30;1R");
    assert_eq!(reply(TermQuery::Da1), "\x1b[?1;2c");
    assert_eq!(reply(TermQuery::Da2), "\x1b[>0;276;0c");
    assert!(reply(TermQuery::XtVersion).starts_with("\x1bP>|Aynx("));
    assert!(reply(TermQuery::XtVersion).ends_with("\x1b\\"));
    assert_eq!(reply(TermQuery::Decrqm { private: true, mode: 2026 }), "\x1b[?2026;0$y");
    assert_eq!(reply(TermQuery::Decrqm { private: false, mode: 4 }), "\x1b[4;0$y");
    assert_eq!(reply(TermQuery::Color { which: 10, st: true }), format!("\x1b]10;{DEFAULT_FG}\x1b\\"));
    assert_eq!(reply(TermQuery::Color { which: 11, st: false }), format!("\x1b]11;{DEFAULT_BG}\x07"));

    // 배처 — 떨어진 동안 손이 질의 전부를 받는다.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (hit_tx, hit_rx) = mpsc::channel::<Vec<TermQuery>>();
    spawn_batcher_with(
        rx,
        output_slot(None),
        Arc::new(OutputStats::default()),
        Some(Box::new(move |qs| {
            let _ = hit_tx.send(qs);
        })),
    );
    tx.send(BOOT.to_vec()).unwrap();
    assert_eq!(hit_rx.recv_timeout(Duration::from_secs(2)).unwrap(), expected_boot());
}

/// 10-15 — **스트림 맨 앞**의 `ESC[6n`(ConPTY 커서 상속 질의 — 빈 화면)은 `1;1` 로, 그 뒤의 것은 예전처럼 맨 아래 줄로 답한다.
/// 맨 아래 줄로 답하면 ConPTY 가 넘친 줄을 절대 위치로 다시 찍어, 창 없이 띄운 작업자를 처음 붙일 때 첫 줄 글자가 빈 줄 끝에 남았다.
#[test]
fn first_cursor_query_of_a_stream_is_home() {
    assert_eq!(String::from_utf8(term_reply(&TermQuery::DsrStart, 30)).unwrap(), "\x1b[1;1R");
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (hit_tx, hit_rx) = mpsc::channel::<Vec<TermQuery>>();
    spawn_batcher_with(
        rx,
        output_slot(None),
        Arc::new(OutputStats::default()),
        Some(Box::new(move |qs| {
            let _ = hit_tx.send(qs);
        })),
    );
    tx.send(b"\x1b[6n\x1b[?9001h".to_vec()).unwrap();
    assert_eq!(hit_rx.recv_timeout(Duration::from_secs(2)).unwrap(), vec![TermQuery::DsrStart]);
    tx.send(b"text\x1b[6n".to_vec()).unwrap();
    assert_eq!(hit_rx.recv_timeout(Duration::from_secs(2)).unwrap(), vec![TermQuery::Dsr]);
}

/// 배처의 대답 손 — **붙은 창(채널)이 없을 때만** 부른다. 붙어 있으면 창의 xterm 이 답한다(두 번 답하지 않는다).
#[test]
fn attached_session_does_not_double_answer() {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(None);
    let stats = Arc::new(OutputStats::default());
    let (hit_tx, hit_rx) = mpsc::channel::<Vec<TermQuery>>();
    spawn_batcher_with(
        rx,
        Arc::clone(&slot),
        stats,
        Some(Box::new(move |qs| {
            let _ = hit_tx.send(qs);
        })),
    );
    tx.send(Q.to_vec()).unwrap();
    // (스트림 맨 앞의 질의라 `DsrStart` — 10-15.)
    assert_eq!(hit_rx.recv_timeout(Duration::from_secs(2)).unwrap(), vec![TermQuery::DsrStart], "떨어진 동안은 서버가 답한다");

    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    swap_output(
        &slot,
        Channel::<InvokeResponseBody>::new(move |body| {
            if let InvokeResponseBody::Raw(b) = body {
                let _ = out_tx.send(b);
            }
            Ok(())
        }),
    );
    tx.send(BOOT.to_vec()).unwrap();
    assert_eq!(out_rx.recv_timeout(Duration::from_secs(2)).unwrap(), BOOT.to_vec());
    assert!(hit_rx.recv_timeout(Duration::from_millis(200)).is_err(), "붙어 있으면 답하지 않는다");
}
