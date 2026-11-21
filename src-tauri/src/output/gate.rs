//! 출력 수문(backpressure gate) — 로컬 PTY 의 블로킹 대기와 SSH 의 async 대기가 같은 상태를 쓴다.

use std::sync::{Condvar, Mutex};
use tokio::sync::watch;

/// 소비자(웹뷰)가 아니라 **생산자(읽기 스레드 · SSH 펌프 태스크)** 를 세운다 — 배칭 큐에 쌓으면 부풀던 메모리가 Rust 로 옮겨갈 뿐이라,
/// 수문은 늘 "읽은 직후 · 배처로 보내기 직전" 에 둔다. SSH 는 tokio 태스크라 런타임 워커를 점유하면 안 된다(`watch` 로 async 대기).
/// `watch` 값은 "변했다" 신호일 뿐 판단은 뮤텍스 안의 [`GateState`] 로 한다 — **구독 → 검사** 순서만 지키면 깨우기를 놓치지 않는다.
#[derive(Debug)]
pub(crate) struct Gate {
    state: Mutex<GateState>,
    resumed: Condvar,
    epoch: watch::Sender<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GateState {
    open: bool,
    /// 이후로는 **영구 통과** — 닫힌 수문에 대기가 남지 않게 한다.
    closed: bool,
    /// 세션 코어의 임대와 짝이다. 붙은 창이 없으면 수문은 열리고 `pause` 가 먹지 않는다 — 역압을 걸 소비자가 없는데 닫혀 있으면 셸이
    /// 영원히 멈춘다. `release()`(영구 개방)와 달리 되돌릴 수 있다.
    leased: bool,
}

impl Gate {
    pub(crate) fn new() -> Self {
        Gate {
            state: Mutex::new(GateState {
                open: true,
                closed: false,
                leased: true,
            }),
            resumed: Condvar::new(),
            epoch: watch::channel(0u64).0,
        }
    }

    pub(crate) fn pause(&self) {
        let mut state = self.state.lock().unwrap();
        if state.closed || !state.open || !state.leased {
            return;
        }
        state.open = false;
        // 깨울 필요는 없지만(어차피 다시 잠든다) 세대는 맞춰 둔다.
        self.epoch.send_modify(|v| *v += 1);
    }

    pub(crate) fn resume(&self) {
        let mut state = self.state.lock().unwrap();
        if state.open {
            return;
        }
        state.open = true;
        self.wake();
    }

    /// 세션 종료 — 영구 개방. 부르지 않으면 닫힌 채 끝난 세션의 생산자가 영원히 대기에 남는다(스레드 · 태스크 누수).
    pub(crate) fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        state.open = true;
        self.wake();
    }

    pub(crate) fn unlease(&self) {
        let mut state = self.state.lock().unwrap();
        state.leased = false;
        if !state.open {
            state.open = true;
            self.wake();
        }
    }

    /// 수문은 열린 채로 둔다 — 그 창의 `pending` 은 0 에서 시작한다.
    pub(crate) fn lease(&self) {
        self.state.lock().unwrap().leased = true;
    }

    /// 잠금을 쥔 채로 부른다.
    fn wake(&self) {
        self.resumed.notify_all();
        self.epoch.send_modify(|v| *v += 1);
    }

    pub(crate) fn passable(&self) -> bool {
        let state = self.state.lock().unwrap();
        state.open || state.closed
    }

    /// 로컬 PTY 읽기 스레드 전용 — 스레드를 세운다.
    pub(crate) fn wait_blocking(&self) {
        let mut state = self.state.lock().unwrap();
        while !state.open && !state.closed {
            state = self.resumed.wait(state).unwrap();
        }
    }

    /// SSH 펌프 태스크 전용 — 태스크만 양보한다.
    pub(crate) async fn wait_async(&self) {
        // 검사보다 구독이 먼저여야 한다 — 그 사이의 resume 도 세대 변화로 잡힌다.
        let mut rx = self.epoch.subscribe();
        loop {
            if self.passable() {
                return;
            }
            if rx.changed().await.is_err() {
                return;
            }
        }
    }
}
