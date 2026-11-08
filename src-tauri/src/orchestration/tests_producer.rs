//! 오케스트레이션 2단계 단계 2 시험 — **프로듀서 자리**(설계 aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 2절 · 3-3 ·
//! 8-1 M13 · M14 · M16): 신원(`Caller::Producer{chat, proc}` — 인증 때 확정) · 자리(`Seat{chat, proc}`) · 귀속(Run 파일 `producers` · 색인
//! `producer_ever` · 잠금 안 검사) · `adopt_verdict` · 대기 취소(`cancel_gen`) · 잠정/확정 커서. 프로세스 · 모델 호출 없음 — 프로듀서 토큰 칸은
//! 시험 손(`chat_token::insert_producer_for_test`)으로 세운다(가짜 CLI 통합은 `server::producer::tests`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::store::*;
use super::tests_start::{body, code, harness, H};
use crate::server::chat_proc::ProcId;

/// 프로듀서 프로세스 하나(토큰 칸 = 생존).
#[derive(Clone)]
struct P {
    chat: String,
    proc: ProcId,
}

fn chat_id(tag: &str) -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!("pc-{tag}-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::SeqCst))
}

fn spawn_p(h: &H, chat: &str) -> P {
    let proc = ProcId::next();
    crate::chat_token::insert_producer_for_test(chat, proc, &h.repo.display().to_string(), false);
    P { chat: chat.to_string(), proc }
}

impl P {
    fn caller(&self) -> Caller {
        Caller::Producer { chat: self.chat.clone(), proc: self.proc }
    }

    fn seat(&self) -> Seat {
        Seat { chat: self.chat.clone(), proc: self.proc }
    }

    /// 프로세스 끝 — 레지스트리의 종료 순서(토큰 → 묶음 해제) 그대로.
    fn exit(&self, h: &H) -> usize {
        crate::chat_token::revoke(&self.chat, self.proc);
        h.o.coordinator_exited_seat(&self.seat())
    }
}

fn start(h: &H, p: &P, _req: &str) -> Result<Value, String> {
    Ok(super::tests_start::open(h, &p.seat()))
}

fn adopt(h: &H, p: &P, req: &str, run: &str) -> Result<Value, String> {
    crate::chat_token::set_album_for_test(&p.chat,p.proc,run);
    h.o.call_tool(&p.caller(), "adopt_run", Some(&json!({ "requestId": req, "runId": run })))
}

fn run_of(v: &Value) -> String {
    v["runId"].as_str().unwrap().to_string()
}

fn summary(h: &H, run: &str) -> Value {
    h.o.snapshot().as_array().unwrap().iter().find(|r| r["runId"] == run).unwrap().clone()
}

/// 시험 `adopt_verdict_table`(설계 2-4 표 전부) — `adoptable` 칸(목록 요약)과 `adopt_run` 이 같은 판정: running · 사람 일시정지(조정자 있음) ·
/// 조정자 끝(자동 재개) · 사람이 멈춘 뒤 끝(복원만) · 조율 한도 · 끝.
#[test]
fn adopt_verdict_table() {
    let h = harness("p-verdict");
    let a = spawn_p(&h, &chat_id("v"));
    let run = run_of(&start(&h, &a, "v1").unwrap());
    let ad = |s: &Value| s["adoptable"].clone();
    assert_eq!(ad(&summary(&h, &run)), json!({ "restore": false, "autoResume": false, "why": "running" }));
    h.o.pause(&run).unwrap();
    assert_eq!(ad(&summary(&h, &run))["why"], "paused-by-person");
    // 사람이 멈춘 뒤 프로세스가 끝남 → 복원만(reattach).
    a.exit(&h);
    assert_eq!(ad(&summary(&h, &run)), json!({ "restore": true, "autoResume": false }));
    let a2 = spawn_p(&h, &a.chat);
    let v = adopt(&h, &a2, "v2", &run).unwrap();
    assert_eq!(v["paused"], true, "사람이 멈춘 앨범은 복원해도 멈춤 그대로");
    assert_eq!(summary(&h, &run)["state"], "paused");
    h.o.resume(&run).unwrap();
    // 조정자 끝(running 에서) → 자동 재개.
    a2.exit(&h);
    assert_eq!(ad(&summary(&h, &run)), json!({ "restore": true, "autoResume": true }));
    // 조율 한도 — 시각이 지나면.
    h.clock.fetch_add(10 * 24 * 60 * 60 * 1000, Ordering::SeqCst);
    assert_eq!(ad(&summary(&h, &run))["why"], "coordination-limit");
    let a4 = spawn_p(&h, &a.chat);
    assert_eq!(body(&adopt(&h, &a4, "v4", &run))["why"], "coordination-limit", "adopt_run 도 같은 판정");
    // 끝.
    h.o.stop(&run).unwrap();
    assert!(["ended", "running"].contains(&ad(&summary(&h, &run))["why"].as_str().unwrap()) || summary(&h, &run)["state"] == "stopping");
}

/// 시험 `wait_run_cancelled_per_seat`(M16 — 설계 3-3 · 리뷰 F5): 그 자리의 `wait_run` 은 사람 interrupt(`cancel_seat_waits`) · 프로세스 끝 ·
/// 곧바로 `wait-cancelled` 로 나오고 대기 수를 돌려놓는다 — 대기 상한(2)에서 거듭 끊어도 다음 정상 대기가 선다 · 취소된 대기는
/// 잠정 커서를 올리지 못한다.
#[test]
fn wait_run_cancelled_per_seat() {
    let h = Arc::new(harness("p-wait"));
    let a = spawn_p(&h, &chat_id("w"));
    let run = run_of(&start(&h, &a, "w1").unwrap());
    let before = h.o.seat_cursor(&run).unwrap();
    for round in 0..4 {
        let waits: Vec<_> = (0..2)
            .map(|_| {
                let (h, a, run) = (Arc::clone(&h), a.clone(), run.clone());
                std::thread::spawn(move || {
                    let t = Instant::now();
                    let r = h.o.call_tool(&a.caller(), "wait_run", Some(&json!({ "runId": run, "gen": 1, "timeoutSeconds": 30 })));
                    (r, t.elapsed())
                })
            })
            .collect();
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(h.o.cancel_seat_waits(&a.seat()), 1, "round {round}");
        for w in waits {
            let (r, took) = w.join().unwrap();
            assert_eq!(code(&r), "wait-cancelled", "round {round}");
            assert!(took < Duration::from_secs(10), "곧바로 깬다");
        }
    }
    let after = h.o.seat_cursor(&run).unwrap();
    assert!(after.cancel_gen > before.cancel_gen);
    assert_eq!(after.pending, after.committed, "취소(끊기)는 잠정 커서를 되돌리고 취소된 대기의 늦은 응답은 올리지 못한다");
    // 다음 정상 대기가 선다(대기 수가 돌아왔다).
    let ok = h.o.call_tool(&a.caller(), "wait_run", Some(&json!({ "runId": run, "gen": 1, "timeoutSeconds": 1 }))).unwrap();
    assert_eq!(ok["timedOut"], true);
    // 프로세스 끝도 대기를 깨운다(running → paused 라 상태 변화로 곧바로 — 상태가 그대로인 해제는 `wait-cancelled`).
    let (h2, a2, run2) = (Arc::clone(&h), a.clone(), run.clone());
    let w = std::thread::spawn(move || {
        let t = Instant::now();
        let r = h2.o.call_tool(&a2.caller(), "wait_run", Some(&json!({ "runId": run2, "gen": 1, "timeoutSeconds": 30 })));
        (r, t.elapsed())
    });
    std::thread::sleep(Duration::from_millis(150));
    a.exit(&h);
    let (r, took) = w.join().unwrap();
    assert!(took < Duration::from_secs(10));
    assert_eq!(r.unwrap()["stateChanged"], true);
    assert_eq!(h.o.seat_cursor(&run).unwrap().pending, h.o.seat_cursor(&run).unwrap().committed, "해제는 잠정 커서를 되돌린다");
}

/// 시험 `seat_cursor_commit_rollback`(설계 3-3 · R7) — seen = 유효한 조회 응답으로 돌려준 범위(잠정) · 자연 종료 때만 확정 · 끊김 · 오류는
/// 되돌림 · 묶음이 바뀌면 새 자리는 옛 `committed` 를 물려받지 않는다.
#[test]
fn seat_cursor_commit_rollback() {
    let h = harness("p-cursor");
    let a = spawn_p(&h, &chat_id("c"));
    let v = start(&h, &a, "c1").unwrap();
    let run = run_of(&v);
    let first = h.o.call_tool(&a.caller(), "get_run", Some(&json!({}))).unwrap();
    let seq0 = first["latestSeq"].as_u64().unwrap();
    assert_eq!(h.o.seat_cursor(&run).unwrap().pending, seq0, "첫 get_run 응답의 범위가 잠정으로");
    h.o.seat_turn_ended(&a.seat(), true);
    assert_eq!(h.o.seat_cursor(&run).unwrap().committed, seq0, "자연 종료 = 확정");
    h.o.call_tool(&a.caller(), "create_task", Some(&json!({ "runId": run, "gen": 1, "requestId": "t1", "title": "t", "goal": "g" })))
        .unwrap();
    let g = h.o.call_tool(&a.caller(), "get_run", Some(&json!({ "runId": run, "gen": 1 }))).unwrap();
    let seq1 = g["latestSeq"].as_u64().unwrap();
    assert!(seq1 > seq0);
    assert_eq!(h.o.seat_cursor(&run).unwrap().pending, seq1);
    // 실패한 조회는 올리지 않는다.
    let _ = h.o.call_tool(&a.caller(), "get_run", Some(&json!({ "runId": run, "gen": 9 })));
    assert_eq!(h.o.seat_cursor(&run).unwrap().pending, seq1);
    h.o.seat_turn_ended(&a.seat(), false);
    let c = h.o.seat_cursor(&run).unwrap();
    assert_eq!((c.committed, c.pending), (seq0, seq0), "끊김 · 오류 = 되돌림");
    // 다른 자리(옛 세대)의 턴 끝은 지금 자리에 닿지 않는다.
    a.exit(&h);
    let a2 = spawn_p(&h, &a.chat);
    adopt(&h, &a2, "c2", &run).unwrap();
    let c2 = h.o.seat_cursor(&run).unwrap();
    assert!(c2.committed == 0 && c2.pending > seq1, "새 자리는 옛 committed 를 물려받지 않는다 · adopt 응답이 잠정으로: {c2:?}");
    h.o.seat_turn_ended(&a.seat(), true);
    assert_eq!(h.o.seat_cursor(&run).unwrap().committed, 0);
}
