//! 파일 묶음 작업(로컬 ↔ 원격 네 방향)의 공통 뼈대 — 진행률 · 취소 · 충돌 정책 · 자동 이름. 네 경로가 따로 정하면 UI 가 네 벌의 규칙을 갖는다.
//!
//! - 훑기 단계에서 충돌 정책까지 적용한다 — 그래야 진행률 분모가 실제로 옮길 것만 센다.
//! - **취소는 깃발이지 abort 가 아니다** — abort 하면 반쯤 쓰인 파일이 최종 이름으로 남고 SFTP 채널은 응답을 문 채 버려진다.
//!   전송 쪽이 청크 경계에서 깃발을 보고 스스로 멈춘다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::Channel;

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/// 청크마다 웹뷰로 보내면 큰 파일 하나가 수천 건의 IPC 가 된다.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// 로컬도 같은 값을 쓴다 — 취소 반응 시간(= 청크 하나)을 두 경로에서 같게 둔다.
pub(crate) const CHUNK: usize = 256 * 1024;

pub(crate) const RENAME_LIMIT: u32 = 1000;

/// 넘으면 임자 없는 취소 깃발부터 버린다.
const CANCEL_LIMIT: usize = 256;

// ---------------------------------------------------------------------------
// 프런트와 주고받는 모양
// ---------------------------------------------------------------------------

/// 값은 전부 누적 총합이다(증분이 아니다) — 한 건이 유실돼도 다음 한 건이 상태를 되돌려 놓는다.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    /// 프런트가 정하고 [`transfer_cancel`] 에 그대로 쓴다.
    pub op: u64,
    pub files_done: u32,
    pub files_total: u32,
    pub bytes_done: u64,
    pub bytes_total: u64,
    /// 대상 경로 — 빈 문자열이면 아직 시작 전이다.
    pub current: String,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// 목적지 쪽 경로다.
    pub path: String,
    pub kind: String,
}

/// 기본이 `Fail` 인 이유 — 못 물어봤으면 아무것도 없애지 않는다.
#[derive(serde::Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OnConflict {
    #[default]
    Fail,
    /// 디렉터리끼리는 합친다.
    Overwrite,
    Skip,
    Rename,
}

// ---------------------------------------------------------------------------
// 종류와 충돌 판정
// ---------------------------------------------------------------------------

/// 링크는 따라가지 않은 그 자리의 종류다(lstat 의미).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Dir,
    File,
    Link,
}

impl Kind {
    /// 링크는 한 항목이므로 파일 쪽이다.
    pub(crate) fn label(self) -> &'static str {
        if self.is_dir() {
            "dir"
        } else {
            "file"
        }
    }

    pub(crate) fn is_dir(self) -> bool {
        matches!(self, Kind::Dir)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    /// `clear` 면 기존 것을 먼저 지워야 한다.
    Use { clear: bool },
    Skip,
    /// 빈자리는 부르는 쪽이 찾는다.
    Rename,
    Fail,
}

/// 링크는 어느 쪽과도 다르다 — 제자리에 덮어쓸 수 없어 먼저 지워야 한다.
fn same_shape(existing: Kind, source: Kind) -> bool {
    matches!(
        (existing, source),
        (Kind::Dir, Kind::Dir) | (Kind::File, Kind::File)
    )
}

/// `Overwrite` 에서 모양이 같으면 지우지 않는다 — 먼저 지웠다가 만들기에 실패하면 사용자의 파일이 그냥 없어진다.
pub(crate) fn decide(existing: Option<Kind>, source: Kind, on_conflict: OnConflict) -> Decision {
    let Some(existing) = existing else {
        return Decision::Use { clear: false };
    };
    match on_conflict {
        OnConflict::Fail => Decision::Fail,
        OnConflict::Skip => Decision::Skip,
        OnConflict::Rename => Decision::Rename,
        OnConflict::Overwrite => Decision::Use {
            clear: !same_shape(existing, source),
        },
    }
}

/// 디렉터리는 통째로 이름이다(`v1.2` 를 `v1 (2).2` 로 만들지 않는다). 맨 앞의 점은 확장자 구분이 아니다.
pub(crate) fn split_extension(name: &str, is_dir: bool) -> (&str, &str) {
    if is_dir {
        return (name, "");
    }
    match name.rfind('.') {
        Some(0) | None => (name, ""),
        Some(dot) => (&name[..dot], &name[dot..]),
    }
}

/// `index` 는 2부터 센다.
pub(crate) fn candidate_name(name: &str, index: u32, is_dir: bool) -> String {
    let (stem, extension) = split_extension(name, is_dir);
    format!("{stem} ({index}){extension}")
}

pub(crate) fn no_free_name(name: &str) -> String {
    tr!(
        ko: "{name} 을(를) 놓을 빈 이름을 찾지 못했습니다 ({RENAME_LIMIT}개까지 밀어 봤습니다)",
        en: "Could not find a free name for {name} (tried up to {RENAME_LIMIT})"
    )
}

// ---------------------------------------------------------------------------
// 진행률
// ---------------------------------------------------------------------------

/// [`Progress::silent`] 은 이동용이다 — 막대는 뜻이 없지만 볼륨이 달라 복사로 물러설 때 같은 실행기를 타야 한다.
pub(crate) struct Progress {
    op: u64,
    channel: Option<Channel<TransferProgress>>,
    files_total: u32,
    bytes_total: u64,
    files_done: u32,
    bytes_done: u64,
    current: String,
    last: Instant,
}

impl Progress {
    pub(crate) fn new(
        op: u64,
        channel: Channel<TransferProgress>,
        files_total: u32,
        bytes_total: u64,
    ) -> Self {
        let mut progress = Self {
            op,
            channel: Some(channel),
            files_total,
            bytes_total,
            files_done: 0,
            bytes_done: 0,
            current: String::new(),
            last: Instant::now(),
        };
        progress.send(true);
        progress
    }

    pub(crate) fn silent() -> Self {
        Self {
            op: 0,
            channel: None,
            files_total: 0,
            bytes_total: 0,
            files_done: 0,
            bytes_done: 0,
            current: String::new(),
            last: Instant::now(),
        }
    }

    /// `current` 는 대상 경로다.
    pub(crate) fn start(&mut self, current: &str) {
        self.current = current.to_string();
        self.send(false);
    }

    pub(crate) fn advance(&mut self, bytes: u64) {
        self.bytes_done += bytes;
        self.send(false);
    }

    pub(crate) fn file_done(&mut self) {
        self.files_done += 1;
        self.send(false);
    }

    /// 간격과 상관없이 보낸다 — 막대가 99% 에서 멈추지 않게.
    pub(crate) fn finish(&mut self) {
        self.current.clear();
        self.send(true);
    }

    fn send(&mut self, force: bool) {
        let Some(channel) = &self.channel else { return };
        if !force && self.last.elapsed() < PROGRESS_INTERVAL {
            return;
        }
        self.last = Instant::now();
        let _ = channel.send(TransferProgress {
            op: self.op,
            files_done: self.files_done,
            files_total: self.files_total,
            bytes_done: self.bytes_done,
            bytes_total: self.bytes_total,
            current: self.current.clone(),
        });
    }
}

// ---------------------------------------------------------------------------
// 취소
// ---------------------------------------------------------------------------

/// `claimed` = 전송이 실제로 이 번호를 집었는가 — 임자 없는 깃발을 나중에 골라 버린다.
struct Slot {
    flag: Arc<AtomicBool>,
    claimed: bool,
}

static CANCELS: LazyLock<Mutex<HashMap<u64, Slot>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// 드롭될 때 등록을 지운다 — 끝난 뒤 도착한 취소가 다음 전송에 남으면 안 된다.
pub(crate) struct Cancel {
    op: Option<u64>,
    flag: Arc<AtomicBool>,
}

impl Cancel {
    /// 취소가 먼저 도착했으면 이미 세워진 깃발을 받는다 — 부르자마자 누른 취소도 유실되지 않는다.
    pub(crate) fn claim(op: u64) -> Self {
        let mut map = CANCELS.lock().unwrap();
        let slot = map.entry(op).or_insert_with(|| Slot {
            flag: Arc::new(AtomicBool::new(false)),
            claimed: false,
        });
        slot.claimed = true;
        Cancel {
            op: Some(op),
            flag: Arc::clone(&slot.flag),
        }
    }

    pub(crate) fn inert() -> Self {
        Cancel {
            op: None,
            flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn stopped(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }

    pub(crate) fn check(&self) -> Result<(), String> {
        if self.stopped() {
            return Err(crate::errors::cancelled());
        }
        Ok(())
    }
}

impl Drop for Cancel {
    fn drop(&mut self) {
        if let Some(op) = self.op {
            CANCELS.lock().unwrap().remove(&op);
        }
    }
}

/// 시작 전에 취소한 깃발은 임자가 영영 안 나타날 수 있다 — 실행 중인 것은 `claimed` 라 살아남는다.
fn prune(map: &mut HashMap<u64, Slot>) {
    if map.len() >= CANCEL_LIMIT {
        map.retain(|_, slot| slot.claimed);
    }
}

/// 없는 번호도 성공이다 — 명령이 아직 시작하지 않았을 수 있어 깃발을 미리 세워 둔다.
///
/// **동기로 남는다** (docs/conventions.md 의 예외): 맵 잠금 한 번과 `AtomicBool` 저장 하나.
/// 오히려 동기라서 좋다 — [취소] 를 누른 순간과 깃발이 서는 순간 사이에 스레드 홉이
/// 끼지 않으므로, 그 사이에 전송이 청크 하나를 더 밀어 넣는 창이 없다.
#[tauri::command]
pub fn transfer_cancel(op: u64) -> Result<(), String> {
    let mut map = CANCELS.lock().unwrap();
    prune(&mut map);
    map.entry(op)
        .or_insert_with(|| Slot {
            flag: Arc::new(AtomicBool::new(false)),
            claimed: false,
        })
        .flag
        .store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests;
