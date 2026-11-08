//! 출력 수문([`Gate`](super::Gate)) 시험 — `output.rs` 에서 그대로 옮겼다(모듈 경로 `output::gate_tests`).
use super::*;
use std::sync::atomic::AtomicBool;

/// 대기가 풀리면 신호를 보내는 스레드를 띄운다. 반환값으로 "이미 통과했는지" 를 본다.
fn spawn_waiter(gate: &Arc<Gate>) -> (Arc<AtomicBool>, mpsc::Receiver<()>) {
    let passed = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<()>();
    let gate = Arc::clone(gate);
    let flag = Arc::clone(&passed);
    std::thread::spawn(move || {
        gate.wait_blocking();
        flag.store(true, Ordering::SeqCst);
        let _ = tx.send(());
    });
    (passed, rx)
}

fn assert_passes(rx: &mpsc::Receiver<()>) {
    assert!(
        rx.recv_timeout(Duration::from_secs(2)).is_ok(),
        "수문이 열렸는데도 대기가 풀리지 않았다"
    );
}

/// 임대 전환 — 떨어지면 열리고 pause 가 안 먹고, 새 임대가 붙으면 그 창의 pause 가 다시 먹는다.
#[test]
fn unlease_opens_and_ignores_pause_until_leased_again() {
    let gate = Arc::new(Gate::new());
    gate.pause();
    let (passed, rx) = spawn_waiter(&gate);
    std::thread::sleep(Duration::from_millis(50));
    assert!(!passed.load(Ordering::SeqCst));
    gate.unlease();
    assert_passes(&rx);

    gate.pause();
    assert!(gate.passable(), "떨어진 세션의 pause 는 무시된다");

    gate.lease();
    gate.pause();
    assert!(!gate.passable(), "새 임대의 pause 는 먹는다");
    gate.resume();
    assert!(gate.passable());
}

#[test]
fn open_gate_never_blocks() {
    let gate = Arc::new(Gate::new());
    let (_, rx) = spawn_waiter(&gate);
    assert_passes(&rx);
}

#[test]
fn closed_gate_blocks_until_resume() {
    let gate = Arc::new(Gate::new());
    gate.pause();
    let (passed, rx) = spawn_waiter(&gate);

    // 닫아 둔 동안에는 통과하지 않는다.
    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(!passed.load(Ordering::SeqCst));

    gate.resume();
    assert_passes(&rx);
}

#[test]
fn resume_before_wait_is_not_lost() {
    // 닫기 → 열기 가 대기보다 먼저 끝나도 깨우기를 놓치면 안 된다.
    let gate = Arc::new(Gate::new());
    gate.pause();
    gate.resume();
    let (_, rx) = spawn_waiter(&gate);
    assert_passes(&rx);
}

#[test]
fn release_frees_a_blocked_waiter() {
    // 세션이 닫힌 채 끝나도 대기가 남으면 안 된다 (스레드 누수).
    let gate = Arc::new(Gate::new());
    gate.pause();
    let (_, rx) = spawn_waiter(&gate);
    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());

    gate.release();
    assert_passes(&rx);
}

#[test]
fn pause_after_release_is_ignored() {
    // 종료 뒤 늦게 도착한 pause 가 수문을 다시 닫아 버리면 안 된다.
    let gate = Arc::new(Gate::new());
    gate.release();
    gate.pause();
    let (_, rx) = spawn_waiter(&gate);
    assert_passes(&rx);
}

#[test]
fn repeated_pause_and_resume_are_idempotent() {
    let gate = Arc::new(Gate::new());
    gate.pause();
    gate.pause();
    gate.resume();
    gate.resume();
    let (_, rx) = spawn_waiter(&gate);
    assert_passes(&rx);
}

#[tokio::test]
async fn async_wait_passes_when_open() {
    let gate = Gate::new();
    gate.wait_async().await; // 열려 있으면 즉시 반환
}

#[tokio::test]
async fn async_wait_wakes_on_resume() {
    let gate = Arc::new(Gate::new());
    gate.pause();

    let waiter = {
        let gate = Arc::clone(&gate);
        tokio::spawn(async move { gate.wait_async().await })
    };

    // 닫힌 동안에는 끝나지 않는다 (sleep 이 대기 태스크에 폴링 기회를 준다).
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!waiter.is_finished(), "닫힌 수문을 그냥 통과했다");

    gate.resume();
    tokio::time::timeout(Duration::from_secs(2), waiter)
        .await
        .expect("resume 후에도 async 대기가 풀리지 않았다")
        .expect("대기 태스크가 패닉했다");
}

#[tokio::test]
async fn async_wait_wakes_on_release() {
    let gate = Arc::new(Gate::new());
    gate.pause();
    let waiter = {
        let gate = Arc::clone(&gate);
        tokio::spawn(async move { gate.wait_async().await })
    };

    gate.release();
    tokio::time::timeout(Duration::from_secs(2), waiter)
        .await
        .expect("release 후에도 async 대기가 풀리지 않았다")
        .expect("대기 태스크가 패닉했다");
}
