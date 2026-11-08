//! 꼬리 링 · 재생 시험 — `output.rs` 에서 그대로 옮겼다(모듈 경로 `output::tail_ring_tests`).
use super::*;

fn probe(out: mpsc::Sender<Vec<u8>>) -> Channel<InvokeResponseBody> {
    Channel::new(move |body| {
        let bytes = match body {
            InvokeResponseBody::Raw(v) => v,
            InvokeResponseBody::Json(s) => s.into_bytes(),
        };
        let _ = out.send(bytes);
        Ok(())
    })
}

#[test]
fn records_with_absolute_offsets() {
    let mut ring = TailRing::default();
    ring.record(b"hello ");
    ring.record(b"world");
    assert_eq!(ring.base(), 0);
    assert_eq!(ring.end, 11);
    assert_eq!(ring.since(0).unwrap(), b"hello world");
    assert_eq!(ring.since(6).unwrap(), b"world");
    // 화면이 끝까지 따라와 있으면 재생할 것이 없다 (거절이 아니다).
    assert_eq!(ring.since(11).unwrap(), b"");
}

#[test]
fn overflow_drops_the_front_and_advances_base() {
    let mut ring = TailRing::default();
    ring.record(&vec![b'a'; TAIL_CAP - 10]);
    ring.record(&[b'b'; 30]);
    assert_eq!(ring.end, (TAIL_CAP + 20) as u64);
    assert_eq!(ring.base(), 20);
    assert_eq!(ring.buf.len(), TAIL_CAP);
    let tail = ring.since(ring.end - 30).unwrap();
    assert_eq!(tail, vec![b'b'; 30]);

    // 상한보다 큰 한 덩어리도 끝 TAIL_CAP 만 남는다.
    let mut big: Vec<u8> = vec![b'x'; TAIL_CAP];
    big.extend_from_slice(b"END");
    ring.record(&big);
    assert_eq!(ring.buf.len(), TAIL_CAP);
    assert_eq!(ring.base(), ring.end - TAIL_CAP as u64);
    assert!(ring.since(ring.end - 3).unwrap() == b"END");
}

#[test]
fn refuses_consumed_before_base() {
    let mut ring = TailRing::default();
    ring.record(&vec![0u8; TAIL_CAP + 100]);
    assert_eq!(
        ring.since(99),
        Err(ReplayRefusal::Overrun {
            consumed: 99,
            base: 100
        })
    );
    assert!(ring.since(100).is_ok());
}

#[test]
fn refuses_consumed_after_end() {
    let mut ring = TailRing::default();
    ring.record(b"abc");
    assert_eq!(
        ring.since(4),
        Err(ReplayRefusal::Ahead {
            consumed: 4,
            end: 3
        })
    );
}

#[test]
fn swap_replays_tail_into_new_channel_before_live_output() {
    // 옛 창이 화면에 반영한 데(consumed)부터 새 창의 첫 메시지가 시작되고, 그 뒤로
    // 실시간이 빈틈·겹침 없이 이어져야 한다.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (old_out, old_got) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(Some(Box::new(probe(old_out))));
    spawn_batcher(rx, Arc::clone(&slot), Arc::new(OutputStats::default()));

    tx.send(b"0123".to_vec()).unwrap();
    assert_eq!(old_got.recv_timeout(Duration::from_secs(2)).unwrap(), b"0123");
    // 옛 화면은 여기까지(오프셋 2)만 반영했다고 치고, 틈에 출력이 더 나갔다.
    tx.send(b"4567".to_vec()).unwrap();
    assert_eq!(old_got.recv_timeout(Duration::from_secs(2)).unwrap(), b"4567");

    let (new_out, new_got) = mpsc::channel::<Vec<u8>>();
    let done = swap_output_replaying(&slot, probe(new_out), Some(2));
    assert_eq!(
        done,
        Reattached {
            start: 2,
            replayed: true,
            reason: None,
            lease: None
        }
    );
    tx.send(b"89".to_vec()).unwrap();

    let first = new_got.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(first, b"234567", "재생 꼬리가 새 채널의 첫 메시지여야 한다");
    let second = new_got.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(second, b"89");
}

/// 떨어진 동안(채널 없음)에도 링은 적고, 붙으면 `[consumed, end)` 가 실시간보다 먼저 온다 (세션 코어 ②).
#[test]
fn detached_ring_keeps_recording_and_attach_replays_before_live() {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (old_out, old_got) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(Some(Box::new(probe(old_out))));
    let stats = Arc::new(OutputStats::default());
    spawn_batcher(rx, Arc::clone(&slot), Arc::clone(&stats));

    tx.send(b"ab".to_vec()).unwrap();
    assert_eq!(old_got.recv_timeout(Duration::from_secs(2)).unwrap(), b"ab");
    // 떨어짐 — 채널을 비운다. 그 사이 출력은 어디로도 안 가지만 링에는 남는다.
    clear_output(&slot);
    tx.send(b"cd".to_vec()).unwrap();
    tx.send(b"ef".to_vec()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while produced(&slot) < 6 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(produced(&slot), 6, "채널이 없어도 링은 생산을 센다");
    assert!(old_got.try_recv().is_err());
    assert_eq!(stats.snapshot().sent_bytes, 2, "계수기는 시도한 전송만 센다");

    let (new_out, new_got) = mpsc::channel::<Vec<u8>>();
    let done = attach_output(&slot, probe(new_out), 2);
    assert_eq!(
        done,
        AttachReplay {
            start: 2,
            end: 6,
            contiguous: true,
            overrun_bytes: 0
        }
    );
    tx.send(b"gh".to_vec()).unwrap();
    assert_eq!(new_got.recv_timeout(Duration::from_secs(2)).unwrap(), b"cdef");
    assert_eq!(new_got.recv_timeout(Duration::from_secs(2)).unwrap(), b"gh");
}

/// 열린 시퀀스 판정 — 끝난 것은 `None`, 끝나지 않은 CSI·OSC·DCS·UTF-8 은 그 시작.
#[test]
fn open_sequence_start_finds_the_unfinished_tail() {
    assert_eq!(open_sequence_start(b"plain text\r\n"), None);
    assert_eq!(open_sequence_start(b"ab\x1b[38;2;1;2;3mcd"), None);
    assert_eq!(open_sequence_start(b"ab\x1b[38;2;1"), Some(2));
    assert_eq!(open_sequence_start(b"ab\x1b"), Some(2));
    // OSC — BEL 로 끝남 · 끝나지 않음 · 문자열 끝(ST)의 ESC 에서 잘림(시작은 OSC 의 ESC)
    assert_eq!(open_sequence_start(b"x\x1b]0;title\x07y"), None);
    assert_eq!(open_sequence_start(b"x\x1b]52;c;QUJD"), Some(1));
    assert_eq!(open_sequence_start(b"x\x1b]8;;http://a\x1b"), Some(1));
    assert_eq!(open_sequence_start(b"x\x1b]8;;http://a\x1b\\y"), None);
    // DCS 는 BEL 로 끝나지 않는다
    assert_eq!(open_sequence_start(b"\x1bPq#0\x07"), Some(0));
    // UTF-8 — 한(3바이트) · 😀(4바이트)
    let han = "한".as_bytes();
    assert_eq!(open_sequence_start(&han[..2]), Some(0));
    assert_eq!(open_sequence_start(han), None);
    let emoji = "a😀".as_bytes();
    assert_eq!(open_sequence_start(&emoji[..3]), Some(1));
    // 문자열 안의 새 ESC(ST 가 아님)는 새 시퀀스 — 시작이 그리로 옮는다
    assert_eq!(open_sequence_start(b"\x1b]0;t\x1b[3"), Some(5));
    // CAN 은 끊는다
    assert_eq!(open_sequence_start(b"\x1b[3\x18z"), None);
}

/// **소비 오프셋이 시퀀스·글자 한가운데면 그 시작으로 당긴다**(체크포인트·이관) — 화면은 그 조각을 아직 그리지 않았다.
#[test]
fn pull_back_moves_a_mid_sequence_offset_to_its_start() {
    let mut ring = TailRing::default();
    let line = "\x1b[38;2;252;120;200m한글😀 n=1\x1b[0m\r\n".as_bytes().to_vec();
    ring.record(&line);
    ring.record(&line);
    let second = line.len() as u64;
    // 둘째 줄의 색 시퀀스 한가운데 · 한글 첫 바이트 뒤 · 이모지 둘째 바이트 뒤 → 모두 그 시작으로
    assert_eq!(ring.pull_back(second + 5), second);
    let han_at = second + "\x1b[38;2;252;120;200m".len() as u64;
    assert_eq!(ring.pull_back(han_at + 1), han_at);
    let emoji_at = han_at + "한글".len() as u64;
    assert_eq!(ring.pull_back(emoji_at + 2), emoji_at);
    // 경계면 그대로
    assert_eq!(ring.pull_back(second), second);
    assert_eq!(ring.pull_back(han_at), han_at);
    assert_eq!(ring.pull_back(ring.end), ring.end);
}

/// 이관 재생(`swap_output_replaying`)도 당긴 자리부터 보낸다 — 새 채널의 첫 바이트 오프셋이 그 자리다.
#[test]
fn swap_replay_starts_at_the_pulled_back_offset() {
    let (out, got) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(None);
    slot.lock().unwrap().tail.record(b"ok\r\n\x1b[31mred");
    let done = swap_output_replaying(&slot, probe(out), Some(6)); // `\x1b[` 뒤 — CSI 한가운데
    assert!(done.replayed);
    assert_eq!(done.start, 4);
    assert_eq!(got.try_recv().unwrap(), b"\x1b[31mred");
}

/// **링이 넘친 붙기는 첫 줄 시작부터** — 잘린 반쪽 줄·시퀀스 꼬리를 보내지 않고, 민 만큼도 유실로 센다.
#[test]
fn attach_after_overrun_starts_at_a_line_boundary() {
    let (out, got) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(None);
    let line = "\x1b[38;2;252;120;200m한글😀 n=1 zzzz\x1b[0m\r\n".as_bytes().to_vec();
    let mut all = Vec::new();
    while all.len() < TAIL_CAP + 1000 {
        all.extend_from_slice(&line);
    }
    slot.lock().unwrap().tail.record(&all);
    let (base, end) = {
        let s = slot.lock().unwrap();
        (s.tail.base(), s.tail.end)
    };
    assert!(base % line.len() as u64 != 0, "시험이 줄 한가운데를 자르지 못했다");
    let done = attach_output(&slot, probe(out), 0);
    let replayed = got.try_recv().unwrap();
    assert!(replayed.starts_with(b"\x1b[38;2;"), "재생이 줄 시작이 아니다");
    assert_eq!(done.start % line.len() as u64, 0);
    assert_eq!(done.overrun_bytes, done.start);
    assert_eq!(replayed.len() as u64, end - done.start);
    assert!(done.start > base && done.start - base < line.len() as u64);
}

/// 넘친 링에 줄바꿈이 없으면 첫 시퀀스 시작, 그것도 없으면 첫 글자 시작.
#[test]
fn safe_base_falls_back_to_sequence_then_char_start() {
    let mut ring = TailRing::default();
    ring.record(&[b'x'; 10]);
    let mut bytes = b"[1m".to_vec();
    bytes.extend(std::iter::repeat_n(b'y', TAIL_CAP - 5));
    ring.record(&bytes); // 링 처음은 x(오프셋 9) — 줄바꿈이 없으니 첫 ESC(오프셋 10)
    let esc_at = 10u64;
    assert_eq!(ring.base(), 9);
    assert_eq!(ring.safe_base(), esc_at);

    let mut ring = TailRing::default();
    let mut bytes = Vec::new();
    while bytes.len() < TAIL_CAP + 1 {
        bytes.extend_from_slice("한".as_bytes());
    }
    ring.record(&bytes);
    let base = ring.base();
    let lead = ring
        .range(base, base + 3)
        .iter()
        .take_while(|&&b| is_continuation(b))
        .count();
    assert!(lead > 0, "시험이 글자 한가운데를 자르지 못했다");
    assert_eq!(ring.safe_base(), base + lead as u64);
}

/// 링이 넘친 붙기 — 남은 링 전부를 보내고 잃은 바이트를 센다. 축이 어긋나면 재생 없이 끝에서 시작.
#[test]
fn attach_after_overrun_replays_what_is_left_and_counts_the_loss() {
    let (out, got) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(None);
    slot.lock().unwrap().tail.record(&vec![b'x'; TAIL_CAP + 50]);
    let done = attach_output(&slot, probe(out.clone()), 10);
    assert_eq!(done.start, 50);
    assert_eq!(done.overrun_bytes, 40);
    assert!(!done.contiguous);
    assert_eq!(got.try_recv().unwrap().len(), TAIL_CAP);

    let end = produced(&slot);
    let done = attach_output(&slot, probe(out), end + 5);
    assert_eq!(done.start, end);
    assert_eq!(done.overrun_bytes, 0);
    assert!(!done.contiguous);
    assert!(got.try_recv().is_err());
}

/// 종료 표식은 그 앞의 배치를 다 적은 뒤의 링 끝을 돌려준다 — 종료를 배처 뒤로 정렬.
#[test]
fn flush_mark_answers_after_the_batch_before_it() {
    let (tx, rx) = mpsc::channel::<Chunk>();
    let slot = output_slot(None);
    spawn_batcher(rx, Arc::clone(&slot), Arc::new(OutputStats::default()));
    tx.send(Chunk::Data(b"12345".to_vec())).unwrap();
    tx.send(Chunk::Data(b"678".to_vec())).unwrap();
    assert_eq!(flush_mark(&tx, &slot, Duration::from_secs(2)), 8);
}

/// ②-2 — SSH 의 모양(펌프가 `Chunk` 를 보내고 표식 입구 복제를 세션 표가 쥔다): 떨어진 동안 링이 적고, 펌프가 끝나도
/// (생산자 하나가 떨어져도) 표식 입구가 살아 있어 종료 마감이 최종 오프셋을 받고, 붙기는 그 링을 재생한다.
#[test]
fn ssh_shaped_producer_records_while_detached_and_marks_after_the_pump_ends() {
    let (tx, rx) = mpsc::channel::<Chunk>();
    let mark = tx.clone(); // 세션 표의 `ShellPipe.mark`
    let slot = output_slot(None); // 떨어진 세션 — 채널 없음
    let gate = Gate::new();
    gate.unlease();
    gate.pause(); // 떨어진 동안 pause 는 먹지 않는다 — 펌프가 서면 원격 셸이 멈춘다
    assert!(gate.passable());
    spawn_batcher(rx, Arc::clone(&slot), Arc::new(OutputStats::default()));
    tx.send(Chunk::Data(b"remote ".to_vec())).unwrap();
    tx.send(Chunk::Data(b"out".to_vec())).unwrap();
    drop(tx); // 펌프 끝(채널 Close)
    assert_eq!(flush_mark(&mark, &slot, Duration::from_secs(2)), 10);
    let (out, got) = mpsc::channel::<Vec<u8>>();
    let done = attach_output(&slot, probe(out), 0);
    assert_eq!((done.start, done.end, done.contiguous), (0, 10, true));
    assert_eq!(got.recv_timeout(Duration::from_secs(2)).unwrap(), b"remote out");
}

#[test]
fn swap_without_or_with_refused_consumed_just_swaps() {
    let (out, got) = mpsc::channel::<Vec<u8>>();
    let slot = output_slot(Some(Box::new(probe(out.clone()))));
    slot.lock().unwrap().tail.record(b"abcdef");

    // 옛 짐(consumed 없음) — 재생 없음, 이유도 없음, 새 채널은 end 에서 시작.
    let done = swap_output_replaying(&slot, probe(out.clone()), None);
    assert_eq!(
        done,
        Reattached {
            start: 6,
            replayed: false,
            reason: None,
            lease: None
        }
    );
    // 어긋난 오프셋 — 재생 없음 + 이유.
    let done = swap_output_replaying(&slot, probe(out), Some(7));
    assert!(!done.replayed);
    assert_eq!(done.start, 6);
    assert!(done.reason.unwrap().starts_with("ahead"));
    assert!(got.try_recv().is_err(), "거절했는데 무언가 보냈다");
}
