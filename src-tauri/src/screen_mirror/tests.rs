//! 서버 해석기 시험 — OSC 133 표본 → 블록 · 스크롤백 · ANSI 제거 · 상한, 그리고 거울 펜(창 ↔ 서버) · 권한 문지기 · MCP 읽기.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::vt::{make_excerpt, parse_exit, parse_osc7_cwd, parse_osc9_cwd, Caps, Interp, BLOCK_CAPS};
use super::*;
use crate::context::{self, SessionContext};

/// PowerShell 통합이 내는 모양 그대로(`aynx=1` 태그) — 프롬프트 `PS C:\work> ` · 명령 · 출력 · 종료 코드.
fn ps_command(cmd: &str, output: &[&str], exit: i64) -> String {
    let mut s = String::new();
    s.push_str("\x1b]133;A;aynx=1\x07PS C:\\work> \x1b]133;B;aynx=1\x07");
    s.push_str(cmd);
    s.push_str("\r\n\x1b]133;C;aynx=1\x07");
    for line in output {
        s.push_str(line);
        s.push_str("\r\n");
    }
    s.push_str(&format!("\x1b]133;D;{exit};aynx=1\x07"));
    s
}

fn prompt() -> &'static str {
    "\x1b]133;A;aynx=1\x07PS C:\\work> \x1b]133;B;aynx=1\x07"
}

#[test]
fn osc133_sample_makes_block_with_command_output_and_exit() {
    let mut vt = Interp::new(80, 24);
    let fed = vt.feed(format!("\x1b]7;file://host/C:/work\x07{}", ps_command("dir", &["a.txt", "b.txt"], 0)).as_bytes());
    assert!(fed.changed);
    assert_eq!(fed.blocks.len(), 1);
    let b = &fed.blocks[0];
    assert_eq!(b.command_line, "dir");
    assert_eq!(b.excerpt_head, vec!["a.txt", "b.txt"]);
    assert!(b.excerpt_tail.is_empty());
    assert_eq!(b.exit, Some(0));
    assert!(!b.running);
    assert_eq!(b.capture, "complete");
    assert!(!b.truncated);
    assert_eq!(b.cwd.as_deref(), Some("C:/work"));
    let snap = vt.snapshot();
    assert_eq!(snap.status.as_deref(), Some("ok"));
    let last = snap.last.expect("last");
    assert_eq!(last.command_line, "dir");
    assert_eq!(last.output, "a.txt\nb.txt");
    assert_eq!(last.exit, Some(0));
    assert!(!last.running);
}

#[test]
fn failing_command_and_running_state() {
    let mut vt = Interp::new(80, 24);
    vt.feed(prompt().as_bytes());
    let fed = vt.feed(b"make all\r\n\x1b]133;C;aynx=1\x07compiling\r\n");
    assert!(fed.changed && fed.blocks.is_empty());
    let snap = vt.snapshot();
    assert_eq!(snap.status.as_deref(), Some("running"));
    let last = snap.last.unwrap();
    assert_eq!(last.command_line, "make all");
    assert!(last.running);
    assert_eq!(last.exit, None);
    assert_eq!(last.output, "");
    let fed = vt.feed(b"error: boom\r\n\x1b]133;D;2;aynx=1\x07");
    assert_eq!(fed.blocks[0].exit, Some(2));
    assert_eq!(fed.blocks[0].excerpt_head, vec!["compiling", "error: boom"]);
    assert_eq!(vt.snapshot().status.as_deref(), Some("fail"));
}

#[test]
fn ansi_is_stripped_from_scrollback_and_blocks() {
    let mut vt = Interp::new(80, 24);
    let fed = vt.feed(ps_command("ls", &["\x1b[1;32mgreen\x1b[0m \x1b[38;2;1;2;3mrgb\x1b[0m"], 0).as_bytes());
    assert_eq!(fed.blocks[0].excerpt_head, vec!["green rgb"]);
    let tail = vt.snapshot().tail;
    assert!(tail.iter().any(|l| l == "green rgb"), "{tail:?}");
    assert!(tail.iter().all(|l| !l.contains('\x1b')));
}

#[test]
fn scrollback_keeps_rows_that_left_the_screen_and_is_capped() {
    let mut vt = Interp::with_caps(40, 5, 50, BLOCK_CAPS);
    for i in 0..200 {
        vt.feed(format!("line {i}\r\n").as_bytes());
    }
    assert_eq!(vt.scrollback_len(), 50);
    let tail = vt.snapshot().tail;
    // 스크롤백 50 + 화면 5(마지막 빈 줄은 버린다) — 가장 최근 줄이 끝에 있다.
    assert_eq!(tail.last().map(String::as_str), Some("line 199"));
    assert_eq!(tail.first().map(String::as_str), Some("line 146"));
}

#[test]
fn tail_is_capped_at_tail_rows() {
    let mut vt = Interp::new(40, 10);
    for i in 0..1000 {
        vt.feed(format!("{i}\r\n").as_bytes());
    }
    let tail = vt.snapshot().tail;
    assert!(tail.len() <= vt::TAIL_ROWS, "{}", tail.len());
    assert_eq!(tail.last().map(String::as_str), Some("999"));
}

#[test]
fn wrapped_rows_join_into_one_logical_line() {
    let mut vt = Interp::new(10, 5);
    let long = "abcdefghijKLMNOPQRSTuvw";
    let fed = vt.feed(ps_command("x", &[long], 0).as_bytes());
    assert_eq!(fed.blocks[0].excerpt_head, vec![long]);
}

#[test]
fn block_output_that_scrolled_past_the_cap_is_unavailable() {
    let mut vt = Interp::with_caps(40, 5, 10, BLOCK_CAPS);
    vt.feed(prompt().as_bytes());
    vt.feed(b"cat big\r\n\x1b]133;C;aynx=1\x07");
    for i in 0..100 {
        vt.feed(format!("row {i}\r\n").as_bytes());
    }
    let fed = vt.feed(b"\x1b]133;D;0;aynx=1\x07");
    let b = &fed.blocks[0];
    assert_eq!(b.capture, "unavailable");
    assert!(b.truncated);
    assert!(b.excerpt_head.is_empty() && b.excerpt_tail.is_empty());
    assert_eq!(b.command_line, "cat big");
}

#[test]
fn clear_scrollback_ed3_drops_rows() {
    let mut vt = Interp::new(40, 5);
    for i in 0..30 {
        vt.feed(format!("old {i}\r\n").as_bytes());
    }
    assert!(vt.scrollback_len() > 0);
    // 배치 경계에 걸친 `ESC [ 3 J` 도 맞춘다.
    vt.feed(b"\x1b[");
    vt.feed(b"3J\x1b[2J\x1b[Hnew");
    assert_eq!(vt.scrollback_len(), 0);
    assert_eq!(vt.snapshot().tail, vec!["new"]);
}

#[test]
fn d_without_c_opens_and_closes_block_from_prompt_line() {
    // PSReadLine 없는 PowerShell — A/B/D 만 온다.
    let mut vt = Interp::new(80, 24);
    vt.feed(prompt().as_bytes());
    let fed = vt.feed(b"echo hi\r\nhi\r\n\x1b]133;D;0;aynx=1\x07");
    assert_eq!(fed.blocks.len(), 1);
    assert_eq!(fed.blocks[0].command_line, "echo hi");
    assert_eq!(fed.blocks[0].excerpt_head, vec!["hi"]);
    // `C` 가 없으면 마지막 명령(`last`)은 이 레코드를 고르지 않는다(프런트 `last()` 와 같다).
    assert!(vt.snapshot().last.is_none());
}

#[test]
fn source_is_pinned_by_first_a_and_foreign_markers_are_dropped() {
    let mut vt = Interp::new(80, 24);
    vt.feed(prompt().as_bytes());
    // 남의 통합의 C/D — 버린다.
    let fed = vt.feed(b"x\r\n\x1b]133;C\x07\x1b]133;D;1\x07");
    assert!(!fed.changed && fed.blocks.is_empty());
    assert_eq!(vt.snapshot().status, None);
}

#[test]
fn second_a_on_same_line_collapses() {
    let mut vt = Interp::new(80, 24);
    let fed = vt.feed(b"\x1b]133;A\x07\x1b]133;A\x07PS> \x1b]133;B\x07ls\r\n\x1b]133;C\x07out\r\n\x1b]133;D\x07");
    assert_eq!(fed.blocks.len(), 1);
    assert_eq!(fed.blocks[0].command_line, "ls");
    // `D` 만(코드 없음)은 성공.
    assert_eq!(fed.blocks[0].exit, Some(0));
}

#[test]
fn exit_code_parses_like_parse_int() {
    assert_eq!(parse_exit(""), 0);
    assert_eq!(parse_exit("0"), 0);
    assert_eq!(parse_exit("127"), 127);
    assert_eq!(parse_exit("-1"), -1);
    assert_eq!(parse_exit("aynx=1"), 0);
    assert_eq!(parse_exit("3x"), 3);
}

#[test]
fn cwd_parsers_match_frontend() {
    assert_eq!(parse_osc7_cwd("file://h/C:/Users/x").as_deref(), Some("C:/Users/x"));
    assert_eq!(parse_osc7_cwd("file://h/home/me%20x").as_deref(), Some("/home/me x"));
    assert_eq!(parse_osc7_cwd("http://h/x"), None);
    assert_eq!(parse_osc9_cwd("9;C:\\work").as_deref(), Some("C:\\work"));
    assert_eq!(parse_osc9_cwd("4;1;50"), None);
}

#[test]
fn excerpt_matches_frontend_rules() {
    let caps = Caps { head_lines: 2, tail_lines: 3, line_units: 5, head_units: 1000, tail_units: 1000 };
    let lines: Vec<String> = (0..10).map(|i| format!("l{i}")).collect();
    let (h, t, truncated, capture) = make_excerpt(&lines, &caps);
    assert_eq!(h, vec!["l0", "l1"]);
    assert_eq!(t, vec!["l7", "l8", "l9"]);
    assert!(truncated);
    assert_eq!(capture, "partial");
    let (h, _, truncated, _) = make_excerpt(&["abcdefgh".to_string()], &caps);
    assert_eq!(h, vec!["abcde"]);
    assert!(truncated);
    let (h, t, truncated, capture) = make_excerpt(&["a".to_string(), "b".to_string()], &caps);
    assert_eq!((h.len(), t.len(), truncated, capture), (2, 0, false, "complete"));
}

#[test]
fn resize_grow_keeps_marker_rows_aligned() {
    let mut vt = Interp::new(40, 5);
    for i in 0..20 {
        vt.feed(format!("pre {i}\r\n").as_bytes());
    }
    vt.feed(prompt().as_bytes());
    vt.feed(b"dir\r\n\x1b]133;C;aynx=1\x07one\r\n");
    vt.resize(40, 12);
    let fed = vt.feed(b"two\r\n\x1b]133;D;0;aynx=1\x07");
    assert_eq!(fed.blocks[0].command_line, "dir");
    assert_eq!(fed.blocks[0].excerpt_head, vec!["one", "two"]);
}

// ---------------------------------------------------------------------------
// 거울 펜 — 창이 붙어 있으면 쓰지 않고, 떨어지면 잇는다.
// ---------------------------------------------------------------------------

fn store_with(key: &str, kind: &str, opted_in: bool) -> crate::context::Store {
    let store = crate::context::Store::default();
    {
        let mut map = store.lock().unwrap();
        context::report(&mut map, key.into(), "pwsh".into(), kind.into(), "p1".into(), opted_in);
    }
    store
}

static ALLOW: AtomicBool = AtomicBool::new(true);
fn allow_flag(_: &str) -> bool {
    ALLOW.load(Ordering::SeqCst)
}

fn entry(store: &crate::context::Store, key: &str) -> SessionContext {
    store.lock().unwrap().get(key).cloned().unwrap()
}

#[test]
fn window_attached_front_owns_then_server_continues_after_detach() {
    let key = "tap-pen-1";
    let store = store_with(key, "local", true);
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    // 창이 주인 — 해석기는 따라가지만 거울에 쓰지 않는다.
    tap.feed(ps_command("dir", &["a"], 0).as_bytes());
    tap.flush();
    let e = entry(&store, key);
    assert!(e.history.is_empty() && e.last.is_none() && e.scrollback.is_empty());
    // 프런트가 쓴 값.
    {
        let mut map = store.lock().unwrap();
        context::update(&mut map, key, Some("ok".into()), None, vec!["front".into()]);
    }
    // 떨어짐 → 서버가 잇는다: 다음 읽기 전에 지금 화면으로 한 장.
    tap.on_detach();
    assert!(tap.server_pen());
    tap.flush();
    let e = entry(&store, key);
    assert_ne!(e.scrollback, vec!["front".to_string()]);
    assert!(e.scrollback.iter().any(|l| l == "a"));
    assert_eq!(e.last.as_ref().map(|l| l.command_line.as_str()), Some("dir"));
    // 창이 없는 동안 끝난 명령 — 블록이 곧바로 쌓이고 번호는 이어진다.
    tap.feed(ps_command("whoami", &["me"], 1).as_bytes());
    let e = entry(&store, key);
    assert_eq!(e.history.len(), 1);
    assert_eq!(e.history[0].command_line, "whoami");
    assert_eq!(e.history[0].exit, Some(1));
    assert_eq!(e.status.as_deref(), Some("fail"));
    // 다시 붙음 → 프런트가 주인: 서버는 더 쓰지 않는다.
    tap.on_attach();
    let v = e.context_version;
    tap.feed(ps_command("ls", &["x"], 0).as_bytes());
    tap.flush();
    let e = entry(&store, key);
    assert_eq!(e.context_version, v);
    assert_eq!(e.history.len(), 1);
    // 다시 떨어짐 → 다시 잇는다.
    tap.on_detach();
    tap.feed(ps_command("pwd", &["C:\\work"], 0).as_bytes());
    let e = entry(&store, key);
    assert_eq!(e.history.iter().map(|b| b.command_line.as_str()).collect::<Vec<_>>(), vec!["whoami", "pwd"]);
}

#[test]
fn server_writes_respect_opt_in_and_local_ai_read() {
    // 거울이 옵트아웃이면 쓰지 않는다(서버는 `opted_in` 을 바꾸지 않는다).
    let key = "tap-gate-1";
    let store = store_with(key, "local", false);
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    tap.on_detach();
    tap.feed(ps_command("dir", &["secret"], 0).as_bytes());
    tap.flush();
    let e = entry(&store, key);
    assert!(e.history.is_empty() && e.scrollback.is_empty() && e.last.is_none());
    // 로컬 타일의 읽기 허용(세션 코어)이 꺼져 있으면 거울이 옵트인이어도 쓰지 않는다.
    let key = "tap-gate-2";
    let store = store_with(key, "local", true);
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), allow_flag);
    ALLOW.store(false, Ordering::SeqCst);
    tap.on_detach();
    tap.feed(ps_command("dir", &["secret"], 0).as_bytes());
    tap.flush();
    let e = entry(&store, key);
    assert!(e.history.is_empty() && e.scrollback.is_empty());
    ALLOW.store(true, Ordering::SeqCst);
    // 항목이 없으면(창이 한 번도 보고하지 않았다) 만들지 않는다.
    let empty = crate::context::Store::default();
    let tap = Tap::with_allow("tap-gate-3", 80, 24, Some(empty.clone()), always);
    tap.on_detach();
    tap.feed(ps_command("dir", &["x"], 0).as_bytes());
    tap.flush();
    assert!(empty.lock().unwrap().is_empty());
}

#[test]
fn local_ai_read_from_core_gates_real_taps() {
    // 실제 로컬 문지기 — 코어에 세션이 없으면(끝났다 · 모른다) 거짓.
    assert!(!local_ai_read("tap-core-unknown"));
}

#[test]
fn front_block_ids_after_server_blocks_never_overwrite() {
    let key = "tap-ids-1";
    let store = store_with(key, "ssh", true);
    let mk = |id: i64, line: &str, at: i64| crate::context::CommandBlockMirror {
        id,
        command_line: line.into(),
        cwd: None,
        started_at: at,
        ended_at: Some(at + 1),
        exit: Some(0),
        running: false,
        excerpt_head: vec![],
        excerpt_tail: vec![],
        truncated: false,
        capture: "complete".into(),
    };
    {
        let mut map = store.lock().unwrap();
        context::push_block(&mut map, key, mk(1, "a", 10));
        context::push_block(&mut map, key, mk(2, "b", 20));
    }
    // 창이 없는 동안 서버가 블록 둘.
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    tap.on_detach();
    tap.feed(ps_command("c", &[], 0).as_bytes());
    tap.feed(ps_command("d", &[], 0).as_bytes());
    // GUI 를 다시 켠 새 페이지 — 1 부터 다시 센다. 덮어쓰지 않고 뒤로 민다.
    tap.on_attach();
    {
        let mut map = store.lock().unwrap();
        context::push_block(&mut map, key, mk(1, "e", 50));
        context::push_block(&mut map, key, mk(2, "f", 60));
        // 같은 블록을 다시 보낸다(백필) — 같은 번호 그대로.
        context::push_blocks(&mut map, key, vec![mk(1, "e", 50), mk(2, "f", 60)]);
    }
    let e = entry(&store, key);
    let got: Vec<(i64, &str)> = e.history.iter().map(|b| (b.id, b.command_line.as_str())).collect();
    assert_eq!(got, vec![(1, "a"), (2, "b"), (3, "c"), (4, "d"), (5, "e"), (6, "f")]);
    // 이관이 실어 온 이력(같은 블록 · 같은 번호)은 밀리지 않는다.
    {
        let mut map = store.lock().unwrap();
        context::push_block(&mut map, key, mk(3, "g", 70));
    }
    let e = entry(&store, key);
    assert_eq!(e.history.last().map(|b| (b.id, b.command_line.as_str())), Some((7, "g")));
}

/// 프런트 거울 묶음의 한 줄(GUI 프록시가 싣는 camelCase 그대로)을 서버가 적용한다.
fn front(plane: &crate::server::ai::AiPlane, op: Value) {
    crate::server::ai::apply_mirror(plane, serde_json::from_value(op).unwrap());
}

fn front_block(id: i64, line: &str, at: i64) -> Value {
    json!({ "id": id, "commandLine": line, "cwd": null, "startedAt": at, "endedAt": at + 5, "exit": 0, "running": false,
            "excerptHead": [line], "excerptTail": [], "truncated": false, "capture": "complete" })
}

/// **트레이 → 다시 연 창**(2026-11-10 실기 재현). 창이 붙은 채 명령이 돌다 트레이로 가고(서버 펜), 그 동안 끝난 명령을 서버가 블록으로
/// 쓴다. 다시 연 창의 새 페이지가 실제로 보내는 순서(붙기가 토글을 되살린 뒤의 첫 보고 → 모르는 상태의 갱신 → 그 뒤 첫 블록 번호 1)를
/// 그대로 재생하면 서버 블록이 남고 새 블록은 그 뒤 번호로 붙는다 · `lastCommand` 도 지워지지 않는다.
///
/// 예전 시험(`front_block_ids_after_server_blocks_never_overwrite`)이 이 실기를 못 잡은 까닭: 블록만 `push_block` 으로 넣고 새 페이지의
/// **마운트 보고**(그때는 토글이 아직 꺼진 `optedIn:false` — 서버가 이력 · 마지막 명령을 지우는 옵트아웃)와 첫 갱신을 재생하지 않았다.
#[test]
fn reopened_window_keeps_server_blocks_and_numbers_after_them() {
    let (tx, _rx) = tokio::sync::broadcast::channel(16);
    let plane = crate::server::ai::AiPlane::new(tx, None, None, None);
    let key = "tap-reopen-1";
    let report = |opted_in: bool| {
        json!({ "op": "report", "key": key, "label": "pwsh", "kind": "local", "code": "p1", "optedIn": opted_in, "owner": "main" })
    };
    // 옛 페이지 — 공유 켬 · 블록 하나.
    front(&plane, report(true));
    front(&plane, json!({ "op": "block", "key": key, "block": front_block(1, "dir", 10) }));
    // 창이 붙은 채 긴 명령이 시작된다(해석기는 따라간다) → 트레이(주 싱크 빠짐) → 그 동안 끝난다.
    let tap = Tap::with_allow(key, 80, 24, Some(plane.ctx().clone()), always);
    tap.feed(ps_command("dir", &["a"], 0).as_bytes());
    tap.feed(format!("{}1..40 | % {{ \"tick $_\" }}\r\n\x1b]133;C;aynx=1\x07tick 1\r\n", prompt()).as_bytes());
    tap.on_detach();
    tap.feed(b"tick 40\r\n\x1b]133;D;0;aynx=1\x07");
    tap.flush();
    let e = entry(&plane.ctx().clone(), key);
    assert_eq!(e.history.iter().map(|b| (b.id, b.command_line.as_str())).collect::<Vec<_>>(), vec![
        (1, "dir"),
        (2, "1..40 | % { \"tick $_\" }")
    ]);
    // 다시 연 창 — 주 싱크가 꽂힌다(펜은 창). 새 페이지는 붙기가 토글을 되살린 **뒤** 첫 보고를 켜진 채 보내고, 아직 아무 명령도 모르는
    // 갱신을 보낸다(`pushContext` — status · last 가 null).
    tap.on_attach();
    front(&plane, report(true));
    front(&plane, json!({ "op": "update", "key": key, "status": null, "last": null, "scrollbackTail": ["tick 40", "PS C:\\work> "] }));
    let e = entry(&plane.ctx().clone(), key);
    assert_eq!(e.history.len(), 2, "다시 붙은 보고 · 갱신이 서버 블록을 지우지 않는다");
    let last = e.last.as_ref().expect("모르는 갱신이 서버의 마지막 명령을 지우지 않는다");
    assert_eq!((last.command_line.as_str(), last.exit), ("1..40 | % { \"tick $_\" }", Some(0)));
    // 새 페이지의 첫 블록 — 프런트 번호 1. 서버 번호(정본)의 뒤로 붙는다 · 다음 블록도 이어서.
    front(&plane, json!({ "op": "block", "key": key, "block": front_block(1, "echo after-reopen", 900) }));
    front(&plane, json!({ "op": "block", "key": key, "block": front_block(2, "echo again", 950) }));
    let e = entry(&plane.ctx().clone(), key);
    assert_eq!(e.history.iter().map(|b| (b.id, b.command_line.as_str())).collect::<Vec<_>>(), vec![
        (1, "dir"),
        (2, "1..40 | % { \"tick $_\" }"),
        (3, "echo after-reopen"),
        (4, "echo again"),
    ]);
    // 끄기(사람이 정한 꺼짐)는 여전히 그 자리에서 지운다 — 프라이버시 게이트는 그대로다.
    front(&plane, report(false));
    let e = entry(&plane.ctx().clone(), key);
    assert!(e.history.is_empty() && e.last.is_none() && e.scrollback.is_empty());
}

// ---------------------------------------------------------------------------
// MCP — 창이 없을 때 서버 거울이 갱신되고 `stale` 이 서지 않는다 · 읽기 권한은 그대로.
// ---------------------------------------------------------------------------

fn call(store: &crate::context::Store, delegation: &crate::delegation::Delegation, tool: &str, args: Value) -> Result<Value, String> {
    flush_dirty();
    let map: HashMap<String, SessionContext> = store.lock().unwrap().clone();
    let args = Some(&args);
    match tool {
        "list_sessions" => Ok(crate::mcp::sessions::enrich_sessions(&map, delegation, None)),
        "get_scrollback" => crate::mcp::sessions::get_scrollback(&map, delegation, args),
        "get_last_command" => crate::mcp::sessions::get_last_command(&map, delegation, args),
        _ => unreachable!(),
    }
}

fn read_host(alias: &str) -> crate::delegation::Delegation {
    crate::delegation::Delegation::parse(&format!(
        "[[target]]
alias = {alias:?}
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
"
    ))
    .expect("delegation")
}

#[test]
fn mcp_reads_server_mirror_while_no_window_and_not_stale() {
    let key = "tap-mcp-local-1";
    let store = store_with(key, "local", true);
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    register(&tap);
    tap.feed(ps_command("dir", &["one"], 0).as_bytes());
    tap.on_detach();
    // 창이 없는 동안의 출력 — 상태 전이가 없어도 읽는 순간 최신이다.
    tap.feed(b"\x1b]133;A;aynx=1\x07PS C:\\work> \x1b]133;B;aynx=1\x07tail -f log\r\n\x1b]133;C;aynx=1\x07live line 1\r\n");
    tap.feed(b"live line 2\r\n");
    let d = crate::delegation::Delegation::default();
    let sb = call(&store, &d, "get_scrollback", json!({ "session": key })).unwrap();
    let lines: Vec<&str> = sb["lines"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert!(lines.contains(&"live line 2"), "{lines:?}");
    let last = call(&store, &d, "get_last_command", json!({ "session": key })).unwrap();
    assert_eq!(last["commandLine"], "tail -f log");
    assert_eq!(last["running"], true);
    // 코어에 없는 스트림이라 `state` 는 null — `stale` 은 거짓(낡았다고 말할 근거가 없다).
    let list = call(&store, &d, "list_sessions", Value::Null).unwrap();
    let row = list.as_array().unwrap().iter().find(|r| r["id"] == key).cloned().unwrap();
    assert_eq!(row["stale"], false);
    assert!(server_pen(key));
}

#[test]
fn mcp_hides_local_session_without_read_allow_even_with_server_mirror() {
    let key = "tap-mcp-local-2";
    let store = store_with(key, "local", false);
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    register(&tap);
    tap.on_detach();
    tap.feed(ps_command("dir", &["secret"], 0).as_bytes());
    let d = crate::delegation::Delegation::default();
    assert!(call(&store, &d, "get_scrollback", json!({ "session": key })).is_err());
    let list = call(&store, &d, "list_sessions", Value::Null).unwrap();
    assert!(list.as_array().unwrap().iter().all(|r| r["id"] != key));
}

#[test]
fn mcp_remote_follows_host_permission_with_server_mirror() {
    let key = "tap-mcp-ssh-1";
    let store = store_with(key, "ssh", true);
    store.lock().unwrap().get_mut(key).unwrap().host_alias = Some("web-01".into());
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    register(&tap);
    tap.on_detach();
    tap.feed(ps_command("uptime", &["up 3 days"], 0).as_bytes());
    // 호스트 권한이 없으면(목록에 없음 · 끔) 서버 거울이 있어도 보이지 않는다.
    let off = crate::delegation::Delegation::default();
    assert!(call(&store, &off, "get_scrollback", json!({ "session": key })).is_err());
    // 호스트에 읽기를 주면 보인다.
    let on = read_host("web-01");
    let last = call(&store, &on, "get_last_command", json!({ "session": key })).unwrap();
    assert_eq!(last["commandLine"], "uptime");
    let e = entry(&store, key);
    assert_eq!(e.history[0].excerpt_head, vec!["up 3 days"]);
    // 다른 시험이 등록표를 건드려도 이 시험의 해석기는 살아 있다.
    drop(Arc::clone(&tap));
}

// ---------------------------------------------------------------------------
// 실제 출력 길 — 배처 · 출력 슬롯의 주 싱크 빼기/꽂기가 펜을 넘긴다.
// ---------------------------------------------------------------------------

struct NullSink;
impl crate::output::OutputSink for NullSink {
    fn send(&self, _offset: u64, _bytes: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn batcher_feeds_tap_and_slot_sink_switches_pen() {
    use crate::output::{clear_output, flush_mark, output_slot, set_tap, spawn_batcher, swap_output, Chunk, OutputStats};
    let key = "tap-batcher-1";
    let store = store_with(key, "local", true);
    let slot = output_slot(Some(Box::new(NullSink)));
    let (tx, rx) = std::sync::mpsc::channel::<Chunk>();
    spawn_batcher(rx, Arc::clone(&slot), Arc::new(OutputStats::default()));
    let wait = std::time::Duration::from_secs(5);
    // 꽂기 전에 나온 출력(첫 프롬프트) — 링에서 따라잡는다.
    tx.send(Chunk::Data(prompt().as_bytes().to_vec())).unwrap();
    flush_mark(&tx, &slot, wait);
    let tap = Tap::with_allow(key, 80, 24, Some(store.clone()), always);
    register(&tap);
    set_tap(&slot, Arc::clone(&tap));
    // 창이 붙어 있다 — 블록은 프런트 몫이라 거울에 쓰지 않는다.
    tx.send(Chunk::Data(b"dir\r\n\x1b]133;C;aynx=1\x07a.txt\r\n\x1b]133;D;0;aynx=1\x07".to_vec())).unwrap();
    flush_mark(&tx, &slot, wait);
    assert!(entry(&store, key).history.is_empty());
    // 창이 떠났다(주 싱크 빠짐) → 서버가 잇는다.
    clear_output(&slot);
    assert!(server_pen(key));
    tx.send(Chunk::Data(ps_command("git status", &["clean"], 0).into_bytes())).unwrap();
    flush_mark(&tx, &slot, wait);
    let e = entry(&store, key);
    assert_eq!(e.history.len(), 1);
    assert_eq!(e.history[0].command_line, "git status");
    assert_eq!(e.history[0].excerpt_head, vec!["clean"]);
    let d = crate::delegation::Delegation::default();
    let last = call(&store, &d, "get_last_command", json!({ "session": key })).unwrap();
    assert_eq!(last["commandLine"], "git status");
    // 앞선 명령(`dir` — 창이 있던 동안)도 해석기가 따라가 스크롤백에 있다.
    let sb = call(&store, &d, "get_scrollback", json!({ "session": key })).unwrap();
    let lines: Vec<&str> = sb["lines"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert!(lines.contains(&"a.txt") && lines.contains(&"clean"), "{lines:?}");
    // 창이 다시 붙었다 → 서버는 멈춘다.
    swap_output(&slot, NullSink);
    assert!(!server_pen(key));
    tx.send(Chunk::Data(ps_command("ls", &["x"], 0).into_bytes())).unwrap();
    flush_mark(&tx, &slot, wait);
    assert_eq!(entry(&store, key).history.len(), 1);
    // 크기 바꾸기도 해석기에 닿는다(패닉 없이).
    crate::output::resize_tap(&slot, 120, 40);
}
