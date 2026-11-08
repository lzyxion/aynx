//! **연결 공유** — 같은 호스트의 둘째 타일은 새 TCP·새 인증이 아니라
//! **이미 서 있는 전송로 위의 채널 하나**로 붙는다 (OpenSSH 의 `ControlMaster` 를
//! 앱 **안**에서 한 것 — 소켓 파일도, 마스터 프로세스도 없다).
//!
//! ```text
//!   타일 ①  open_ssh_session(web-01)
//!      │  게이트(키별 tokio Mutex) 잡기 → 풀에 없다
//!      │  connect_transport → authenticate            ← TCP 하나 · 인증 한 번
//!      │  풀에 등록 { handle, jump, users: {7} }
//!      ▼
//!   타일 ②  open_ssh_session(web-01)   (①과 동시에 눌러도 된다)
//!         게이트에서 기다린다 → 풀에 있다
//!         channel_open_session 만 연다 · users: {7, 8}
//!         **인증 없음 · 볼트 관문 없음 · 서버에서 보면 연결은 하나**
//! ```
//!
//! ## 이 파일에 있는 것은 **순수 장부**다
//!
//! 러시 타입이 한 글자도 없다 — 풀은 `T` 를 그냥 들고 있고, 끊는 일은 **부른 쪽**이 한다
//! ([`TransportPool::release`] 가 "마지막 사용자였다" 를 payload 로 돌려주는 것이 그 계약).
//! 그래서 소켓 없이 유닛 테스트가 붙는다. 러시를 아는 쪽은 [`crate::ssh`] 하나다.
//!
//! ## 왜 `tauri::State` 가 아니라 전역인가
//!
//! 전송로는 **앱의 것이지 창의 것이 아니다** — 탭은 창 사이를 건너다니고(`handoff.rs`),
//! 세션 표(`SshSessions`)부터가 앱 전역이다. `vault.rs` 의 `LazyLock<Mutex<VaultState>>` ·
//! `port_forward.rs` 의 `FORWARDS` 와 같은 자리이고, 덕분에 [`crate::ssh::close_ssh`] ·
//! [`crate::reap`] · 헤드리스 종료의 **시그니처가 한 칸도 안 늘었다**.
//!
//! ## 종료는 **퍼진다** — 전송로 하나의 죽음이 그 위의 세션 전부에 닿는다
//!
//! 예전에는 [`crate::ssh::ExitSignal`] 이 전송로의 Handler 소유였고 세션 **하나**에 묶여
//! 있었다. 공유가 생기면 그 하나로는 부족하다 — 전송로가 죽으면 올라탄 타일이 **전부**
//! 자기 몫의 `ssh-exit{reason:"error"}` 를 받아야 각자 재연결한다. 그래서 축을 둘로 나눈다:
//!
//! | 축 | 타입 | 누가 쏘나 | 받는 것 |
//! | --- | --- | --- | --- |
//! | 전송로 하나 | [`TransportSignal`] | `Handler::disconnected` | 올라탄 **모든** 세션 |
//! | 세션 하나 | `ExitSignal` | 그 세션의 셸 채널 EOF/exit-status | **자기만** |
//!
//! "정확히 한 번" 은 **세션마다** 그대로다 (`ExitSignal::fired`). 셸 종료 증거
//! (`note_shell_exit`)도 세션마다라, 옆 타일이 `exit` 를 쳤다고 내 타일이 정상 종료로
//! 판정되는 일이 없다.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// 종료 팬아웃
// ---------------------------------------------------------------------------

/// 전송로가 죽었을 때 **한 세션**에게 그 사실을 알리는 통로.
///
/// 구현은 `ssh::ExitSignal` 하나뿐이지만 트레잇으로 두는 이유는 테스트다 — `ExitSignal` 은
/// `AppHandle` 을 들고 있어 테스트 바이너리에서 만들 수 없다. 팬아웃 규칙(셋이 붙으면 셋이
/// 울린다·한 번 울리면 끝)은 세는 스텁으로 검증한다.
pub(crate) trait ExitTarget: Send + Sync {
    fn fire(&self, failure: Option<String>);
}

/// [`TransportSignal::join`] 이 돌려주는 자리표 — 놓을 때 이것으로 뺀다.
///
/// `Arc::ptr_eq` 로 지우지 않는 이유: `Arc<dyn ExitTarget>` 은 뚱뚱한 포인터라 같은 값에
/// 서로 다른 vtable 주소가 붙을 수 있고, 그러면 **조용히 안 지워진다**(목록이 자라고 죽은
/// 타일이 이벤트를 받는다). 단조 증가하는 번호 하나면 그 애매함이 없다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct ExitToken(u64);

/// 전송로 하나의 죽음을 **그 위에 올라탄 세션 전부**에 뿌린다.
///
/// `on_death` 는 풀에서 이 전송로를 지우는 훅이다 — 죽은 항목이 풀에 남아 있으면 다음
/// 타일이 그 위에 채널을 열려다 실패하는 **막다른 길**이 된다. 훅도 팬아웃도 `fired`
/// 하나로 **정확히 한 번**이다.
pub(crate) struct TransportSignal {
    targets: Mutex<Vec<(ExitToken, Arc<dyn ExitTarget>)>>,
    next: AtomicU64,
    fired: AtomicBool,
    on_death: Option<Box<dyn Fn() + Send + Sync>>,
}

impl TransportSignal {
    pub(crate) fn new(on_death: Option<Box<dyn Fn() + Send + Sync>>) -> Arc<Self> {
        Arc::new(TransportSignal {
            targets: Mutex::new(Vec::new()),
            next: AtomicU64::new(1),
            fired: AtomicBool::new(false),
            on_death,
        })
    }

    /// 공유하지 않는 전송로(설치 검증·헤드리스)에 쓰는 지름길 — 대상 하나만 실은 신호.
    pub(crate) fn solo(target: Arc<dyn ExitTarget>) -> Arc<Self> {
        let signal = Self::new(None);
        signal.join(target);
        signal
    }

    /// 이 전송로에 세션 하나를 얹는다.
    pub(crate) fn join(&self, target: Arc<dyn ExitTarget>) -> ExitToken {
        let token = ExitToken(self.next.fetch_add(1, Ordering::Relaxed));
        if let Ok(mut list) = self.targets.lock() {
            list.push((token, target));
        }
        token
    }

    /// 세션이 닫혔다 — 목록에서 뺀다. **전송로는 그대로 산다**(다른 타일이 쓰고 있다).
    pub(crate) fn leave(&self, token: ExitToken) {
        if let Ok(mut list) = self.targets.lock() {
            list.retain(|(t, _)| *t != token);
        }
    }

    /// 이 전송로가 이미 끝났나 — 아직 셸이 없는(종료 명단의 대상이 울릴 곳이 없는) 대기 쪽이 보는 자리
    /// (`crate::remote_worktree` 의 첫 커밋 질문 — 답을 기다리는 사이 연결이 죽으면 대기를 푼다).
    pub(crate) fn has_fired(&self) -> bool {
        self.fired.load(Ordering::SeqCst)
    }

    /// 전송로가 끝났다 — 올라탄 세션 **전부**에게 같은 사유로 알린다.
    ///
    /// 목록은 **복사해서 잠금을 푼 뒤** 울린다: 대상이 `emit` 을 타고 들어가는 길에
    /// 무엇을 또 잠글지 이 파일은 모른다.
    pub(crate) fn fire(&self, failure: Option<String>) {
        if self.fired.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(hook) = &self.on_death {
            hook();
        }
        let targets: Vec<Arc<dyn ExitTarget>> = match self.targets.lock() {
            Ok(mut list) => list.drain(..).map(|(_, t)| t).collect(),
            Err(_) => return,
        };
        for target in targets {
            target.fire(failure.clone());
        }
    }
}

// ---------------------------------------------------------------------------
// 전송로 풀
// ---------------------------------------------------------------------------

struct Entry<T> {
    payload: T,
    /// 이 전송로를 타고 있는 **세션 id** 들. 비면 그 자리에서 항목이 사라진다.
    users: HashSet<u32>,
}

/// 키 하나당 전송로 하나. `T` 는 러시 핸들 묶음이지만 이 파일은 그것을 모른다.
pub(crate) struct TransportPool<T> {
    entries: Mutex<HashMap<String, Entry<T>>>,
    /// **합치기 자물쇠** — 같은 키의 "풀 보기 → 접속·인증 → 등록" 전체를 감싼다. 이것이
    /// 없으면 동시에 누른 두 타일이 둘 다 "풀에 없다" 를 보고 **둘 다** 접속한다(연결 둘 ·
    /// 인증 둘 · 볼트 관문 둘 — 이 기능이 없애려는 바로 그 비용).
    ///
    /// `tokio::sync::Mutex` 인 이유는 그 안에 `await` 가 있기 때문이다. 아래 `entries` 의
    /// std `Mutex` 는 **절대 `await` 를 넘어가지 않는다**(잠근 문장 안에서 끝난다 —
    /// docs/conventions.md 의 "느린 일을 잠금 위에서 하지 않는다").
    gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// 사용자 중 **타일이 아닌 핀**(쿼리 타일의 DB 연결이 빌린 자리 — `ssh::open::acquire_shared`) 번호. 정보 카드의 "공유 중인
    /// 다른 타일 수" 에서 빼고 "DB 연결 N" 으로 따로 센다([`count_users`](Self::count_users)).
    pins: Mutex<HashSet<u32>>,
}

impl<T> Default for TransportPool<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> TransportPool<T> {
    pub(crate) fn new() -> Self {
        TransportPool {
            entries: Mutex::new(HashMap::new()),
            gates: Mutex::new(HashMap::new()),
            pins: Mutex::new(HashSet::new()),
        }
    }

    /// 이 사용자 번호는 타일이 아니라 핀이다(DB 연결) — [`release`](Self::release) 가 표시를 지운다.
    pub(crate) fn mark_pin(&self, id: u32) {
        self.pins.lock().unwrap_or_else(|e| e.into_inner()).insert(id);
    }

    /// 이 키의 합치기 자물쇠. **잠그는 것은 부른 쪽**이다 (`gate(key).lock().await`) —
    /// 여기서 잠그면 std 잠금을 `await` 위로 들고 가게 된다.
    ///
    /// 아무도 안 쓰는 자물쇠는 이 자리에서 치운다(`strong_count == 1` = 표만 들고 있다).
    /// 호스트 수만큼밖에 안 자라지만, 빠른 접속 별칭은 `user@host:port` 라 손대지 않으면
    /// 앱이 도는 내내 쌓인다.
    pub(crate) fn gate(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self.gates.lock().unwrap_or_else(|e| e.into_inner());
        gates.retain(|k, g| k == key || Arc::strong_count(g) > 1);
        Arc::clone(
            gates
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }

    /// 이미 선 전송로에 세션 하나를 얹는다. 없으면 `None` (= 차갑게 붙어야 한다).
    ///
    /// **게이트를 쥔 채 부르는 것이 계약**이다 — 그러지 않으면 이 `None` 과 뒤의
    /// [`insert`](Self::insert) 사이로 다른 타일이 끼어든다.
    pub(crate) fn join(&self, key: &str, id: u32) -> Option<T>
    where
        T: Clone,
    {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries.get_mut(key)?;
        entry.users.insert(id);
        Some(entry.payload.clone())
    }

    /// 방금 세운 전송로를 등록한다 (사용자는 `id` 하나로 시작).
    ///
    /// 게이트 계약대로라면 이 자리에 같은 키가 있을 수 없다. 그래도 있으면 **옛 payload 를
    /// 돌려준다** — 부른 쪽이 그것을 끊는다(소켓이 새지 않는다). 옛 세션들은 그 전송로가
    /// 끊기는 순간 자기 `TransportSignal` 로 `ssh-exit` 을 받아 평소대로 재연결한다.
    pub(crate) fn insert(&self, key: &str, id: u32, payload: T) -> Option<T> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let mut users = HashSet::new();
        users.insert(id);
        entries
            .insert(key.to_string(), Entry { payload, users })
            .map(|old| old.payload)
    }

    /// 세션 하나가 내렸다. **마지막이었으면** 항목을 거두고 payload 를 돌려준다 —
    /// 그 `Some` 이 곧 "이제 전송로를 끊어라" 다. 남은 사용자가 있으면 `None`.
    ///
    /// v1 에 **유예 타이머는 없다**: 마지막 타일을 닫자마자 끊는다. 이 기능이 버는 것은
    /// "동시에 열린 타일들" 이지 "닫았다 곧 다시 여는 사람" 이 아니고, 유예는 사용자가
    /// 닫은 연결이 서버에 잠시 더 남아 있는다는 뜻이라 설명 없이 둘 물건이 아니다.
    pub(crate) fn release(&self, key: &str, id: u32) -> Option<T> {
        self.pins.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries.get_mut(key)?;
        entry.users.remove(&id);
        if entry.users.is_empty() {
            entries.remove(key).map(|e| e.payload)
        } else {
            None
        }
    }

    /// 죽었거나 더는 못 쓰는 전송로를 장부에서 뺀다 — **끊지는 않는다**(이미 죽었다).
    ///
    /// 남아 있던 세션들은 자기 `close_ssh` 에서 `release` 가 `None` 을 받아 조용히 끝난다.
    pub(crate) fn evict(&self, key: &str) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.remove(key);
    }

    /// 이 전송로를 타고 있는 세션 수 (없으면 0) — 시험용. 정보 카드는 타일과 DB 핀을 나눠 센다([`count_users`](Self::count_users)).
    #[cfg(test)]
    pub(crate) fn users(&self, key: &str) -> usize {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .map(|e| e.users.len())
            .unwrap_or(0)
    }

    /// 이 전송로의 사용자를 `(타일, 핀)` 으로 나눠 센다 — 정보 카드: 공유 중인 다른 타일 = 타일 − 1, DB 연결 = 핀(9단계).
    /// 잠금 순서는 `entries` → `pins`(다른 곳은 둘을 함께 쥐지 않는다).
    pub(crate) fn count_users(&self, key: &str) -> (usize, usize) {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = entries.get(key) else {
            return (0, 0);
        };
        let pins = self.pins.lock().unwrap_or_else(|e| e.into_inner());
        let p = e.users.iter().filter(|id| pins.contains(id)).count();
        (e.users.len() - p, p)
    }

    /// 지금 살아 있는 전송로 수 — 진단·테스트용.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

// ---------------------------------------------------------------------------
// 테스트 — 소켓도 AppHandle 도 없이 장부와 팬아웃만 본다
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
