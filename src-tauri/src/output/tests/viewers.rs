//! 다중 시청자(원격 웹 R2-A) — 주 싱크 + 시청자 싱크 목록, 같은 순서의 바이트, 실패한 시청자만 빠짐, 질의에 답하는 쪽.
use super::*;

/// `(오프셋, 바이트)` 를 모으는 싱크. `fail_after` 번째 send 부터 실패한다.
struct Probe {
    out: mpsc::Sender<(u64, Vec<u8>)>,
    sent: std::sync::atomic::AtomicUsize,
    fail_after: usize,
}

impl OutputSink for Probe {
    fn send(&self, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
        if self.sent.fetch_add(1, Ordering::SeqCst) >= self.fail_after {
            return Err("over budget".into());
        }
        let _ = self.out.send((offset, bytes));
        Ok(())
    }
}

fn probe(fail_after: usize) -> (Probe, mpsc::Receiver<(u64, Vec<u8>)>) {
    let (tx, rx) = mpsc::channel();
    (
        Probe {
            out: tx,
            sent: Default::default(),
            fail_after,
        },
        rx,
    )
}

/// 받은 것을 오프셋 축의 한 줄로 — 빈틈·겹침이 있으면 실패.
fn joined(rx: &mpsc::Receiver<(u64, Vec<u8>)>, from: u64) -> Vec<u8> {
    let mut at = from;
    let mut all = Vec::new();
    while let Ok((off, bytes)) = rx.recv_timeout(Duration::from_millis(300)) {
        assert_eq!(off, at, "오프셋은 빈틈없이 이어진다");
        at += bytes.len() as u64;
        all.extend(bytes);
    }
    all
}

/// 주 하나 + 시청자 둘이 **같은 순서의 같은 바이트**를 받는다(늦게 붙은 시청자는 링 재생부터 이어서). 실패한 시청자 싱크만 빠지고
/// 주와 다른 시청자는 계속 받는다.
#[test]
fn primary_and_viewers_get_identical_ordered_bytes_and_a_failing_viewer_drops_alone() {
    let (main, main_rx) = probe(usize::MAX);
    let slot = output_slot(Some(Box::new(main)));
    let (a, a_rx) = probe(usize::MAX);
    attach_viewer_output(&slot, 2, a, 0);
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    spawn_batcher(rx, Arc::clone(&slot), Arc::new(OutputStats::default()));
    tx.send(b"one ".to_vec()).unwrap();
    std::thread::sleep(Duration::from_millis(40));
    // 늦게 붙는 시청자 — 링의 처음부터 재생받고 실시간으로 잇는다. 둘째 send(실시간 첫 배치)부터 실패하는 시청자도 하나.
    let (b, b_rx) = probe(usize::MAX);
    let replay = attach_viewer_output(&slot, 3, b, 0);
    assert_eq!((replay.start, replay.end, replay.contiguous), (0, 4, true));
    let (c, c_rx) = probe(0);
    attach_viewer_output(&slot, 4, c, 4);
    assert_eq!(viewer_sinks(&slot), vec![2, 3, 4]);
    for chunk in [b"two ".as_slice(), b"three ", b"four"] {
        tx.send(chunk.to_vec()).unwrap();
        std::thread::sleep(Duration::from_millis(20));
    }
    let want = b"one two three four".to_vec();
    assert_eq!(joined(&main_rx, 0), want);
    assert_eq!(joined(&a_rx, 0), want);
    assert_eq!(joined(&b_rx, 0), want);
    assert!(joined(&c_rx, 4).is_empty(), "첫 실시간 배치에서 실패 — 아무것도 받지 못했다");
    assert_eq!(viewer_sinks(&slot), vec![2, 3], "실패한 시청자 싱크만 빠진다");
    // 다시 붙으면(재동기화) 소비 오프셋부터 링을 재생받는다.
    let (c2, c2_rx) = probe(usize::MAX);
    let r = attach_viewer_output(&slot, 5, c2, 8);
    assert_eq!((r.start, r.contiguous, r.overrun_bytes), (8, true, 0));
    assert_eq!(joined(&c2_rx, 8), b"three four".to_vec());
    assert!(remove_viewer_output(&slot, 5));
    assert!(!remove_viewer_output(&slot, 5), "멱등");
}

/// 질의에 답하는 쪽 = 크기 주인. 주인 쪽 싱크가 꽂혀 있으면 서버는 답하지 않고, 주인이 시청자인데 그 싱크가 없거나 주인이 없으면
/// 서버가 답한다(둘이 답하면 남는 답이 셸 입력으로 샌다).
#[test]
fn the_server_answers_only_when_the_size_owner_is_not_plugged() {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (main, _main_rx) = probe(usize::MAX);
    let slot = output_slot(Some(Box::new(main)));
    let (hit_tx, hit_rx) = mpsc::channel::<Vec<TermQuery>>();
    spawn_batcher_with(
        rx,
        Arc::clone(&slot),
        Arc::new(OutputStats::default()),
        Some(Box::new(move |qs| {
            let _ = hit_tx.send(qs);
        })),
    );
    let ask = || {
        tx.send(b"x\x1b[c".to_vec()).unwrap();
        hit_rx.recv_timeout(Duration::from_millis(300)).is_ok()
    };
    assert!(!ask(), "주가 주인이고 꽂혀 있다 — 주가 답한다");
    set_responder(&slot, Responder::Viewer(7));
    assert!(ask(), "주인 시청자의 싱크가 없다 — 서버가 답한다");
    let (v, _v_rx) = probe(usize::MAX);
    attach_viewer_output(&slot, 7, v, 0);
    assert!(!ask(), "주인 시청자가 꽂혔다 — 그 창이 답한다");
    set_responder(&slot, Responder::Server);
    assert!(ask(), "자격 있는 붙은 쪽이 없다 — 서버가 답한다");
}
