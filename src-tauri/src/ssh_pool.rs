//! 연결 공유 — 같은 호스트의 둘째 타일은 이미 서 있는 전송로 위의 채널 하나로 붙는다(인증 없음 · 볼트 관문 없음).
//! 순수 장부다 — 끊는 일은 부른 쪽이 한다([`TransportPool::release`] 가 마지막 사용자였으면 payload 를 돌려준다).
//!
//! 종료는 두 축이다 — 전송로의 죽음([`TransportSignal`])은 올라탄 세션 **전부**에, 셸 종료(`ExitSignal`)는 **그 세션만**에 닿는다.
//! 셸 종료 증거도 세션마다라 옆 타일이 `exit` 를 쳤다고 내 타일이 정상 종료로 판정되지 않는다.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// ── 종료 팬아웃 ──

/// 트레잇인 이유는 테스트다 — 구현 `ssh::ExitSignal` 은 `AppHandle` 을 들고 있어 테스트 바이너리에서 만들 수 없다.
pub(crate) trait ExitTarget: Send + Sync {
    fn fire(&self, failure: Option<String>);
}

/// `Arc::ptr_eq` 로 지우지 않는다 — `Arc<dyn ExitTarget>` 은 같은 값에 다른 vtable 주소가 붙을 수 있어 조용히 안 지워진다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct ExitToken(u64);

/// `on_death` 는 풀에서 이 전송로를 지우는 훅이다 — 죽은 항목이 남으면 다음 타일이 그 위에 채널을 열려다 실패한다.
/// 훅도 팬아웃도 `fired` 하나로 정확히 한 번이다.
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

    pub(crate) fn solo(target: Arc<dyn ExitTarget>) -> Arc<Self> {
        let signal = Self::new(None);
        signal.join(target);
        signal
    }

    pub(crate) fn join(&self, target: Arc<dyn ExitTarget>) -> ExitToken {
        let token = ExitToken(self.next.fetch_add(1, Ordering::Relaxed));
        if let Ok(mut list) = self.targets.lock() {
            list.push((token, target));
        }
        token
    }

    pub(crate) fn leave(&self, token: ExitToken) {
        if let Ok(mut list) = self.targets.lock() {
            list.retain(|(t, _)| *t != token);
        }
    }

    pub(crate) fn has_fired(&self) -> bool {
        self.fired.load(Ordering::SeqCst)
    }

    /// 목록은 꺼내 잠금을 푼 뒤 울린다 — 대상이 `emit` 을 타고 무엇을 또 잠글지 이 파일은 모른다.
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

// ── 전송로 풀 ──

struct Entry<T> {
    payload: T,
    users: HashSet<u32>,
}

pub(crate) struct TransportPool<T> {
    entries: Mutex<HashMap<String, Entry<T>>>,
    /// 같은 키의 "풀 보기 → 접속·인증 → 등록" 전체를 감싼다 — 없으면 동시에 누른 두 타일이 둘 다 접속한다.
    /// `entries` 의 std `Mutex` 는 `await` 를 넘어가지 않는다(docs/conventions.md 의 "느린 일을 잠금 위에서 하지 않는다").
    gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// 사용자 중 타일이 아닌 핀(쿼리 타일의 DB 연결) 번호.
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

    pub(crate) fn mark_pin(&self, id: u32) {
        self.pins.lock().unwrap_or_else(|e| e.into_inner()).insert(id);
    }

    /// 잠그는 것은 부른 쪽이다 — 여기서 잠그면 std 잠금을 `await` 위로 들고 가게 된다. 안 쓰는 자물쇠는 여기서 치운다
    /// (빠른 접속 별칭은 `user@host:port` 라 두면 쌓인다).
    pub(crate) fn gate(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self.gates.lock().unwrap_or_else(|e| e.into_inner());
        gates.retain(|k, g| k == key || Arc::strong_count(g) > 1);
        Arc::clone(
            gates
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }

    /// 게이트를 쥔 채 부른다 — 아니면 이 `None` 과 뒤의 [`insert`](Self::insert) 사이로 다른 타일이 끼어든다.
    pub(crate) fn join(&self, key: &str, id: u32) -> Option<T>
    where
        T: Clone,
    {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries.get_mut(key)?;
        entry.users.insert(id);
        Some(entry.payload.clone())
    }

    /// 같은 키가 이미 있으면 옛 payload 를 돌려준다 — 부른 쪽이 그것을 끊는다(소켓이 새지 않는다).
    pub(crate) fn insert(&self, key: &str, id: u32, payload: T) -> Option<T> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let mut users = HashSet::new();
        users.insert(id);
        entries
            .insert(key.to_string(), Entry { payload, users })
            .map(|old| old.payload)
    }

    /// `Some` 이 곧 "이제 전송로를 끊어라" 다. 유예 타이머는 두지 않는다 — 사용자가 닫은 연결이 서버에 더 남게 된다.
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

    /// 끊지는 않는다(이미 죽었다).
    pub(crate) fn evict(&self, key: &str) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.remove(key);
    }

    #[cfg(test)]
    pub(crate) fn users(&self, key: &str) -> usize {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .map(|e| e.users.len())
            .unwrap_or(0)
    }

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

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

#[cfg(test)]
mod tests;
