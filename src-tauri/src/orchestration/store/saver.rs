//! 영속 쓰기 줄 — 잠금 안에서 넣은 Run 스냅숏을 쓰기 스레드 하나가 Run 마다 마지막 것만 원자 교체한다(리뷰 F10) · 저장 확인 손
//! [`SaveWait`](통합 설계 4-3 ⑥ — 그 Run 의 마지막 쓰기 결과를 돌려받는다 · 기다림은 잠금 밖) · 비우기(`flush`) · 끝(`Drop` = 줄 닫고 join).
//! 합치기 · 확인 응답은 debounce 가 아니다. `store.rs` 에서 그대로 옮겼다 — `persist::save` 를 부르는 곳은 여기 하나다.

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Condvar, Mutex};

use crate::orchestration::model::*;
use crate::orchestration::persist;
use crate::server::log;

/// 영속 쓰기 줄 — 보낸 쪽(잠금 안)과 쓰기 스레드 하나(잠금 밖). 순서는 보낸 순서 그대로(쓰기 스레드가 한 번에 모인 것 중
/// Run 마다 마지막 스냅숏만 쓴다 — 앞선 것은 뒤 것에 덮인다). 넣은 수 · 다 쓴 수는 [`Orchestration::flush_saves`] 가 본다.
///
/// **저장 확인**(통합 설계 4-3 ⑥ · R3): 확인 손([`SaveWait`])을 단 스냅숏은 그 Run 의 저장 결과(그 스냅숏, 또는 같은 묶음에서 그것을
/// 덮은 더 새 스냅숏의 원자 교체 결과)를 돌려받는다.
///
/// **저장 결과 알림**(F7): 확인 없는 저장도 Run 마다 결과를 [`SavedHook`] 으로 알린다(원문은 로그에만 — 손에는 분류 낱말만). 저장소가
/// 그것으로 메모리의 저장 상태([`PersistMark`])를 고치고 보기(`persist`)에 싣는다. 손은 쓰기 스레드에서 **saver 의 잠금을 하나도 쥐지 않은
/// 채로** 부른다(손이 저장소 잠금을 잡는다 — 잠금 순서는 저장소 → 쓰기 줄 한 방향).
pub(super) struct Saver {
    tx: Mutex<Option<mpsc::Sender<SaveItem>>>,
    progress: Arc<(Mutex<(u64, u64)>, Condvar)>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    /// 저장 결과 알림 손(F7 — 서버 시작의 `install_self` 가 꽂는다 · 없으면 알리지 않는다).
    hook: Arc<std::sync::RwLock<Option<SavedHook>>>,
    /// 시험 — 참이면 쓰기가 디스크에 닿지 않고 실패한다(디스크 가득 · 권한 거부 흉내).
    #[cfg(test)]
    pub(super) fault: Arc<std::sync::atomic::AtomicBool>,
}

/// 쓰기 줄의 한 칸 — 스냅숏 + (있으면) 저장 결과를 돌려받을 손.
struct SaveItem {
    run: Run,
    ack: Option<mpsc::Sender<Result<(), String>>>,
}

/// 저장 결과 알림 손(F7) — `(runId, 쓴 스냅숏의 seq, 결과 — 실패면 분류 낱말)`.
pub(super) type SavedHook = Arc<dyn Fn(&str, u64, Result<(), &'static str>) + Send + Sync>;

/// Run 하나의 **저장 상태**(F7 — 메모리만 · 영속하지 않는다). 마지막으로 디스크에 닿은 스냅숏의 seq · 지금 이어지는 실패(처음 시각 ·
/// 마지막 분류 낱말 · 연속 수). 다음 저장이 성공하면 실패 표지를 지운다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(in crate::orchestration) struct PersistMark {
    pub last_saved_seq: Option<u64>,
    pub failing: Option<PersistFailing>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::orchestration) struct PersistFailing {
    pub since: u64,
    pub reason: &'static str,
    pub count: u32,
}

impl PersistMark {
    /// 저장 결과 하나를 반영한다 — 실패 표지가 **바뀌었으면**(생김 · 지워짐) 그 사건 낱말(`persist_failed` · `persist_recovered`).
    pub(in crate::orchestration) fn record(&mut self, seq: u64, result: Result<(), &'static str>, now: u64) -> Option<&'static str> {
        match result {
            Ok(()) => {
                self.last_saved_seq = Some(self.last_saved_seq.map_or(seq, |s| s.max(seq)));
                self.failing.take().map(|_| "persist_recovered")
            }
            Err(reason) => match &mut self.failing {
                Some(f) => {
                    f.reason = reason;
                    f.count = f.count.saturating_add(1);
                    None
                }
                None => {
                    self.failing = Some(PersistFailing { since: now, reason, count: 1 });
                    Some("persist_failed")
                }
            },
        }
    }

    /// 보기 칸 `persist{ok, lastSavedSeq, failing?{since, reason, count}}` — 경로 · OS 문장 없음(분류 낱말만). 저장기가 없는 저장소(시험)는
    /// 늘 `ok` · `lastSavedSeq: null`.
    pub(in crate::orchestration) fn view(&self) -> serde_json::Value {
        serde_json::json!({
            "ok": self.failing.is_none(),
            "lastSavedSeq": self.last_saved_seq,
            "failing": self.failing.as_ref().map(|f| serde_json::json!({ "since": f.since, "reason": f.reason, "count": f.count })),
        })
    }
}

/// 저장 확인을 기다리는 손(잠금 밖에서 [`SaveWait::wait`]).
pub(in crate::orchestration) enum SaveWait {
    /// 확인을 청하지 않았다 · **시험의 명시적 비영속 모드**([`Orchestration::set_ephemeral`]). 확인할 것이 없다.
    Off,
    /// 확인을 청했는데 영속 저장기가 없다(데이터 루트 없음 · 저장 스레드 생성 실패 — 리뷰 F10). 실패로 본다 — 의도를 남길 곳이 없으니 CAS 하지 않는다.
    Missing,
    Pending(mpsc::Receiver<Result<(), String>>),
}

/// 저장 확인의 상한 — 넘으면 실패로 본다(디스크가 멎은 동안 CAS 하지 않는다).
const SAVE_CONFIRM_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

impl SaveWait {
    /// 저장 결과 — 실패 · 쓰기 스레드가 사라짐 · 시한 넘김은 모두 `Err`.
    pub(in crate::orchestration) fn wait(self) -> Result<(), String> {
        match self {
            SaveWait::Off => Ok(()),
            SaveWait::Missing => Err("there is no persistent run store — the integration intent cannot be saved".into()),
            SaveWait::Pending(rx) => match rx.recv_timeout(SAVE_CONFIRM_WAIT) {
                Ok(r) => r,
                Err(mpsc::RecvTimeoutError::Timeout) => Err("the run file was not saved in time".into()),
                Err(mpsc::RecvTimeoutError::Disconnected) => Err("the save thread is gone".into()),
            },
        }
    }
}

impl Saver {
    pub(super) fn start(dir: PathBuf) -> Option<Saver> {
        let (tx, rx) = mpsc::channel::<SaveItem>();
        let progress: Arc<(Mutex<(u64, u64)>, Condvar)> = Arc::default();
        let p = Arc::clone(&progress);
        #[cfg(test)]
        let fault: Arc<std::sync::atomic::AtomicBool> = Arc::default();
        #[cfg(test)]
        let fail = Arc::clone(&fault);
        let hook: Arc<std::sync::RwLock<Option<SavedHook>>> = Arc::default();
        let tell = Arc::clone(&hook);
        let thread = std::thread::Builder::new()
            .name("orchestration-save".into())
            .spawn(move || {
                while let Ok(first) = rx.recv() {
                    // 모인 것을 한 번에 — Run 마다 마지막 것만(보낸 순서가 곧 사건 순서). 확인 손은 그 Run 의 마지막 쓰기 결과를 받는다.
                    let mut batch: Vec<SaveItem> = vec![first];
                    batch.extend(rx.try_iter());
                    let n = batch.len() as u64;
                    let mut last: Vec<Run> = Vec::new();
                    let mut acks: Vec<(String, mpsc::Sender<Result<(), String>>)> = Vec::new();
                    for item in batch {
                        if let Some(a) = item.ack {
                            acks.push((item.run.id.clone(), a));
                        }
                        last.retain(|r| r.id != item.run.id);
                        last.push(item.run);
                    }
                    for run in &last {
                        #[cfg(test)]
                        let injected = fail.load(std::sync::atomic::Ordering::SeqCst);
                        #[cfg(not(test))]
                        let injected = false;
                        let result = if injected {
                            Err(persist::SaveError {
                                kind: "io-error",
                                detail: "injected save failure".to_string(),
                            })
                        } else {
                            persist::save(&dir, run)
                        };
                        if let Err(e) = &result {
                            log::line(format!("orchestration — could not save {} ({}): {}", run.id, e.kind, e.detail));
                        }
                        for (_, a) in acks.iter().filter(|(id, _)| *id == run.id) {
                            let _ = a.send(result.clone().map_err(|e| e.detail));
                        }
                        // 저장 상태 알림(F7) — saver 의 잠금 밖에서(손이 저장소 잠금을 잡는다). 손은 복제해 RwLock 도 놓고 부른다.
                        let h = tell.read().unwrap_or_else(|e| e.into_inner()).clone();
                        if let Some(h) = h {
                            h(&run.id, run.seq, result.as_ref().map(|_| ()).map_err(|e| e.kind));
                        }
                    }
                    let (m, cv) = &*p;
                    m.lock().unwrap_or_else(|e| e.into_inner()).1 += n;
                    cv.notify_all();
                }
            })
            .ok()?;
        Some(Saver {
            tx: Mutex::new(Some(tx)),
            progress,
            thread: Mutex::new(Some(thread)),
            hook,
            #[cfg(test)]
            fault,
        })
    }

    /// 저장 결과 알림 손을 꽂는다(F7 — `Orchestration::install_save_hook`).
    pub(super) fn set_hook(&self, h: SavedHook) {
        *self.hook.write().unwrap_or_else(|e| e.into_inner()) = Some(h);
    }

    pub(super) fn push(&self, run: Run, ack: Option<mpsc::Sender<Result<(), String>>>) {
        let (m, _) = &*self.progress;
        m.lock().unwrap_or_else(|e| e.into_inner()).0 += 1;
        if let Some(tx) = self.tx.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            let _ = tx.send(SaveItem { run, ack });
        }
    }
}

/// 저장소가 사라질 때(서버 종료 · 시험의 "서버 재시작") — 줄을 닫고 쓰기 스레드가 남은 것을 다 쓰기를 기다린다.
/// 저장 결과 알림 손(F7)이 약한 참조를 올린 사이 마지막 참조가 풀리면 저장소가 **쓰기 스레드 안에서** 사라질 수 있다 — 그때는 자기 자신을
/// 기다리지 않는다(줄이 닫혔으니 스레드는 손에서 돌아오면 곧 끝난다).
impl Drop for Saver {
    fn drop(&mut self) {
        drop(self.tx.lock().unwrap_or_else(|e| e.into_inner()).take());
        if let Some(t) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            if t.thread().id() != std::thread::current().id() {
                let _ = t.join();
            }
        }
    }
}

impl Saver {
    /// 지금까지 넣은 것이 다 쓰일 때까지(상한 `wait`).
    pub(super) fn flush(&self, wait: std::time::Duration) {
        let (m, cv) = &*self.progress;
        let deadline = std::time::Instant::now() + wait;
        let mut g = m.lock().unwrap_or_else(|e| e.into_inner());
        while g.1 < g.0 {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                return;
            }
            g = cv.wait_timeout(g, left).unwrap_or_else(|e| e.into_inner()).0;
        }
    }
}
