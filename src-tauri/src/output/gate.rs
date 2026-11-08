//! 출력 수문(backpressure gate) — 생산자를 세우는 [`Gate`] 하나. 로컬 PTY 의 블로킹 대기와 SSH 의 async 대기가 같은 상태를 쓴다.
//! `output.rs` 에서 그대로 옮겼다(시험은 부모의 `output::gate_tests`).

use std::sync::{Condvar, Mutex};
use tokio::sync::watch;

/// 세션 하나의 출력 수문. 프런트가 밀린 바이트(pending)를 세다가 워터마크를 넘으면
/// `pause_*_output` 으로 닫고, 다시 내려오면 `resume_*_output` 으로 연다.
///
/// 소비자(웹뷰)가 아니라 **생산자(읽기 스레드 · SSH 펌프 태스크)** 를 세우는 것이 핵심이다.
/// 배칭 큐에 계속 쌓아 두면 부풀던 메모리가 웹뷰에서 Rust 로 옮겨갈 뿐이므로,
/// 수문은 언제나 "읽은 직후 · 배처로 보내기 직전" 에 둔다.
///
/// 두 생산자의 대기 방식이 달라 원시 동기화 기본형을 둘 다 들고 있다.
/// - 로컬 PTY: 전용 읽기 스레드 → `Condvar` 로 **블로킹 대기** (세워도 무해한 스레드다).
/// - SSH: tokio 태스크 → `watch` 채널로 **async 대기** (런타임 워커를 점유하면 안 된다).
///
/// `watch` 의 값은 상태가 바뀔 때마다 오르는 세대 번호일 뿐이다. 값이 아니라 "변했다" 는
/// 신호만 쓰고 판단은 뮤텍스 안의 [`GateState`] 로 한다 — `subscribe()` 가 현재 값을
/// '본 것' 으로 표시하므로 **구독 → 검사** 순서만 지키면 깨우기를 놓치지 않는다.
#[derive(Debug)]
pub(crate) struct Gate {
    state: Mutex<GateState>,
    /// 블로킹 대기자(로컬 PTY 읽기 스레드)를 깨운다.
    resumed: Condvar,
    /// async 대기자(SSH 펌프 태스크)를 깨우는 세대 번호.
    epoch: watch::Sender<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GateState {
    /// 열려 있으면 생산자가 그냥 지나간다.
    open: bool,
    /// 세션이 닫혔다. 이후로는 **영구 통과** — 닫힌 수문에 대기가 남지 않게 한다.
    closed: bool,
    /// 이 수문을 **쥔 창이 있다** — 세션 코어의 임대(`crate::session_core`)와 짝이다. 붙은 창이 없으면
    /// (`unlease` — 떨어진 세션) 수문은 열리고 `pause` 가 먹지 않는다: 역압을 걸 소비자가 없는데 닫혀
    /// 있으면 셸이 영원히 멈춘다. 새 임대가 붙으면(`lease`) 그 창의 pause/resume 이 다시 수문을 쥔다.
    /// `release()`(세션 종료 — 영구 개방)와 다르다 — 이쪽은 되돌릴 수 있다.
    leased: bool,
}

impl Gate {
    pub(crate) fn new() -> Self {
        Gate {
            state: Mutex::new(GateState {
                open: true,
                closed: false,
                // 새 세션은 연 창이 쥐고 태어난다(SSH 는 늘 이 값 그대로다).
                leased: true,
            }),
            resumed: Condvar::new(),
            epoch: watch::channel(0u64).0,
        }
    }

    /// 수문을 닫는다. 이미 닫혔거나 세션이 끝났으면 아무 일도 하지 않는다.
    pub(crate) fn pause(&self) {
        let mut state = self.state.lock().unwrap();
        if state.closed || !state.open || !state.leased {
            return;
        }
        state.open = false;
        // 깨울 필요는 없지만(어차피 다시 잠든다) 세대는 맞춰 둔다.
        self.epoch.send_modify(|v| *v += 1);
    }

    /// 수문을 연다.
    pub(crate) fn resume(&self) {
        let mut state = self.state.lock().unwrap();
        if state.open {
            return;
        }
        state.open = true;
        self.wake();
    }

    /// 세션 종료 — 영구 개방. 이걸 부르지 않으면 닫힌 채 끝난 세션의 생산자가
    /// 영원히 대기에 남는다 (스레드·태스크 누수).
    pub(crate) fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        state.open = true;
        self.wake();
    }

    /// **임대 해제** — 붙은 창이 떠났다(떨어진 세션). 수문을 열고, 다시 임대될 때까지 `pause` 를 무시한다.
    pub(crate) fn unlease(&self) {
        let mut state = self.state.lock().unwrap();
        state.leased = false;
        if !state.open {
            state.open = true;
            self.wake();
        }
    }

    /// **임대** — 새 창이 붙었다. 수문은 열린 채로 두고(그 창의 `pending` 은 0 에서 시작한다) 그 창의
    /// pause/resume 이 이제부터 먹는다.
    pub(crate) fn lease(&self) {
        self.state.lock().unwrap().leased = true;
    }

    /// 두 대기 경로를 함께 깨운다. 잠금을 쥔 채로 부른다.
    fn wake(&self) {
        self.resumed.notify_all();
        self.epoch.send_modify(|v| *v += 1);
    }

    pub(crate) fn passable(&self) -> bool {
        let state = self.state.lock().unwrap();
        state.open || state.closed
    }

    /// 수문이 열릴 때까지 **스레드를 세운다**. 로컬 PTY 읽기 스레드 전용.
    pub(crate) fn wait_blocking(&self) {
        let mut state = self.state.lock().unwrap();
        while !state.open && !state.closed {
            state = self.resumed.wait(state).unwrap();
        }
    }

    /// 수문이 열릴 때까지 **태스크만 양보한다**. SSH 펌프 태스크 전용.
    pub(crate) async fn wait_async(&self) {
        // 검사보다 구독이 먼저여야 한다 — 그 사이의 resume 도 세대 변화로 잡힌다.
        let mut rx = self.epoch.subscribe();
        loop {
            if self.passable() {
                return;
            }
            // 송신자는 Gate 자신이라 살아 있다. 그래도 오류면 대기를 풀어 준다.
            if rx.changed().await.is_err() {
                return;
            }
        }
    }
}
