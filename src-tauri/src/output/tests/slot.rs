//! 출력 슬롯 · 배처 시험 — `output.rs` 에서 그대로 옮겼다(모듈 경로 `output::output_slot_tests`).
use super::*;

/// 받은 배치를 테스트 쪽 채널로 되돌려 주는 가짜 웹뷰 채널.
/// `tag` 로 "어느 창이 받았는가" 를 구분한다.
fn probe(
    tag: &'static str,
    out: mpsc::Sender<(&'static str, Vec<u8>)>,
) -> Channel<InvokeResponseBody> {
    Channel::new(move |body| {
        let bytes = match body {
            InvokeResponseBody::Raw(v) => v,
            InvokeResponseBody::Json(s) => s.into_bytes(),
        };
        let _ = out.send((tag, bytes));
        Ok(())
    })
}

fn next(got: &mpsc::Receiver<(&'static str, Vec<u8>)>) -> (&'static str, Vec<u8>) {
    got.recv_timeout(Duration::from_secs(2))
        .expect("배치가 도착하지 않았다")
}

#[test]
fn batcher_follows_the_slot() {
    // 창 이관의 알맹이 — 배처는 채널을 소유하지 않고 **매 배치 슬롯을 읽는다.**
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (out, got) = mpsc::channel::<(&'static str, Vec<u8>)>();
    let slot = output_slot(Some(Box::new(probe("A", out.clone()))));
    let stats = Arc::new(OutputStats::default());
    spawn_batcher(rx, Arc::clone(&slot), Arc::clone(&stats));

    tx.send(b"one".to_vec()).unwrap();
    assert_eq!(next(&got), ("A", b"one".to_vec()));

    // 슬롯을 갈아 끼우면 **그다음 배치부터** 새 창으로 간다.
    swap_output(&slot, probe("B", out.clone()));
    tx.send(b"two".to_vec()).unwrap();
    assert_eq!(next(&got), ("B", b"two".to_vec()));

    // 옛 창의 채널로는 더 이상 아무것도 가지 않는다.
    assert!(got.try_recv().is_err());

    // 계수기는 창이 바뀌어도 **세션 기준**으로 이어진다 (진단은 세션 단위다).
    let snap = stats.snapshot();
    assert_eq!(snap.sent_chunks, 2);
    assert_eq!(snap.sent_bytes, 6);
    assert_eq!(snap.send_failures, 0);
    assert!(snap.last_error.is_none());
}

#[test]
fn empty_slot_drops_the_batch_but_keeps_the_loop() {
    // 창이 닫힌 직후(슬롯 비었거나 채널이 죽음)에 루프를 끊으면, 이관된 세션이
    // 새 창에서 영영 벙어리가 된다. 배치만 버리고 계속 돌아야 한다.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let (out, got) = mpsc::channel::<(&'static str, Vec<u8>)>();
    let slot = output_slot(None);
    let stats = Arc::new(OutputStats::default());
    spawn_batcher(rx, Arc::clone(&slot), Arc::clone(&stats));

    tx.send(b"lost".to_vec()).unwrap();
    assert!(
        got.recv_timeout(Duration::from_millis(200)).is_err(),
        "받을 창이 없는데 배치가 어딘가로 갔다"
    );

    // 오류를 내는 채널(= 닫힌 창)이 꽂혀 있어도 마찬가지다.
    swap_output(&slot, Channel::new(|_| Err(tauri::Error::WebviewNotFound)));
    tx.send(b"also lost".to_vec()).unwrap();
    assert!(got.recv_timeout(Duration::from_millis(200)).is_err());

    // 그리고 이어붙이면 그때부터 정상 동작한다.
    swap_output(&slot, probe("C", out));
    tx.send(b"three".to_vec()).unwrap();
    assert_eq!(next(&got), ("C", b"three".to_vec()));

    // 진단이 갈라야 하는 세 상태가 여기 다 있다:
    // - 슬롯이 비어 있던 배치는 **보낸 것도 아니다** (`"lost"` 는 세지 않는다).
    // - 죽은 채널로 나간 배치는 보낸 수에 들어가고 **실패로도 잡힌다** — 이 한 번이
    //   곧 채널 번호의 빈칸, 즉 그 세션의 영구 침묵이다.
    let snap = stats.snapshot();
    assert_eq!(snap.sent_chunks, 2, "슬롯이 빈 배치까지 보낸 것으로 셌다");
    assert_eq!(
        snap.sent_bytes,
        (b"also lost".len() + b"three".len()) as u64
    );
    assert_eq!(snap.send_failures, 1);
    assert!(
        snap.last_error.is_some(),
        "전송 실패인데 사유가 남지 않았다"
    );
}
