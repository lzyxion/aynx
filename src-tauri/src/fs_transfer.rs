//! 파일 **묶음 작업**의 공통 뼈대 — 진행률·취소·충돌 정책·자동 이름.
//!
//! ```text
//!  local_browser.rs ─┐
//!                    ├─→ TransferProgress · Conflict · OnConflict · Kind
//!  sftp_browser.rs  ─┘    Progress(진행률 채널) · Cancel(취소 깃발) · decide/candidate_name
//! ```
//!
//! 잘라내기·복사·붙여넣기와 타일 간 드래그는 **네 방향**으로 흐른다 (로컬↔로컬,
//! 원격↔원격, 로컬→원격, 원격→로컬). 네 경로가 각자 "이미 있으면 어떻게 하지" 와
//! "몇 퍼센트 왔지" 를 따로 정하면 UI 는 네 벌의 규칙을 갖게 된다 — [`crate::fs_entry`]
//! 가 목록 한 줄의 모양을 한 자리에 모아 둔 것과 같은 이유로, 그 규칙들이 여기 산다.
//!
//! ## 계획을 먼저 세우고 그다음 옮긴다
//!
//! 네 경로 모두 **훑기(계획) → 실행** 두 단계다. 훑는 동안 충돌 정책까지 적용해 버리면
//! 진행률의 분모(`filesTotal`·`bytesTotal`)가 **실제로 옮길 것만** 세게 된다 — 건너뛴
//! 항목이 분모에 남아 막대가 90%에서 끝나는 일이 없다. 대신 훑기 자체가 큰 트리에서는
//! 시간을 먹는다(원격은 디렉터리마다 왕복 하나다). 그래서 훑기 중에도 취소가 듣는다.
//!
//! ## 취소는 깃발이지 kill 이 아니다
//!
//! 전송을 중간에 끊는 유일하게 안전한 자리는 **청크 경계**다. 태스크를 abort 하면 반쯤
//! 쓰인 파일이 최종 이름으로 남고, SFTP 채널은 응답을 기다리는 요청을 문 채로 버려진다.
//! 그래서 [`transfer_cancel`] 은 `AtomicBool` 하나를 세울 뿐이고, 전송 쪽이 다음 청크에서
//! 그것을 보고 스스로 멈춘다 (그 자리에서 만들던 부분 파일은 지운다).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::Channel;

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/// 진행률 보고 최소 간격. 청크마다 웹뷰로 보내면 큰 파일 하나가 수천 건의 IPC 가 되고,
/// 그 비용은 전송이 아니라 UI 쪽에 얹힌다 (`sftp_browser` 의 다운로드와 같은 눈금이다).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// 스트리밍 한 덩어리. 왕복이 비싼 SFTP 에 맞춰 위쪽(256KiB)을 쓴다 — 로컬에서도
/// 같은 값을 쓰는 이유는 취소 반응 시간(= 청크 하나)을 두 경로에서 같게 두기 위해서다.
pub(crate) const CHUNK: usize = 256 * 1024;

/// 자동 이름을 몇 번까지 밀어 볼 것인가 (`이름 (2)` … `이름 (1000)`).
pub(crate) const RENAME_LIMIT: u32 = 1000;

/// 취소 깃발 맵이 이만큼 넘게 불면 **임자 없는 것**부터 버린다 (아래 [`transfer_cancel`] 참고).
const CANCEL_LIMIT: usize = 256;

// 취소로 멈췄을 때의 오류 문구는 [`crate::errors::cancelled`] 가 만든다 — 문구가 언어를
// 타므로 `const &str` 일 수 없고(`ssh.rs` 의 고정 문구 일곱과 같은 이유), 프런트가 보는
// 것은 글자가 아니라 이유 코드 `[cancelled]` 다. 판정은 `errors::is_cancelled` 하나다.

// ---------------------------------------------------------------------------
// 프런트와 주고받는 모양
// ---------------------------------------------------------------------------

/// 진행률 한 건. **camelCase** 로 나간다 (`filesDone` · `bytesTotal`).
///
/// 값은 전부 **누적 총합**이다 (증분이 아니다) — 한 건이 유실돼도 다음 한 건이 상태를
/// 되돌려 놓는다. `op` 를 실어 보내므로 프런트는 여러 전송이 겹쳐도 막대를 가를 수 있다.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    /// 이 전송의 번호 (프런트가 정하고 [`transfer_cancel`] 에 그대로 쓴다).
    pub op: u64,
    pub files_done: u32,
    pub files_total: u32,
    pub bytes_done: u64,
    pub bytes_total: u64,
    /// 지금 옮기고 있는 **대상** 경로 (빈 문자열이면 아직 시작 전이다).
    pub current: String,
}

/// 붙여넣기 전에 "덮어쓸까요?" 를 묻기 위한 답 한 줄 — **이미 그 자리에 있는 것**.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// 부딪히는 대상의 절대 경로 (원본이 아니라 **목적지** 쪽이다).
    pub path: String,
    /// `"file"` · `"dir"`. 심링크는 한 항목이므로 `"file"` 쪽이다.
    pub kind: String,
}

/// 같은 이름이 이미 있을 때 무엇을 할 것인가. 프런트에서 `"fail"`·`"overwrite"`·
/// `"skip"`·`"rename"` 문자열로 온다.
///
/// 기본값이 [`OnConflict::Fail`] 인 이유: 못 물어봤으면 아무것도 없애지 않는다.
#[derive(serde::Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OnConflict {
    /// 오류로 멈춘다 (프런트가 확인 대화상자를 띄우기 전의 기본).
    #[default]
    Fail,
    /// 덮어쓴다. 디렉터리끼리는 **합친다**(안의 항목마다 같은 정책을 다시 적용한다).
    Overwrite,
    /// 그 항목만 건너뛴다.
    Skip,
    /// `이름 (2)` 식으로 밀어 새 이름에 놓는다.
    Rename,
}

// ---------------------------------------------------------------------------
// 종류와 충돌 판정 (순수 함수 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 항목 하나의 종류. **링크는 따라가지 않은** 그 자리의 종류다(lstat 의미).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Dir,
    File,
    Link,
}

impl Kind {
    /// 충돌 목록으로 나가는 문자열. 링크는 "한 항목" 이므로 파일 쪽이다.
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

/// 충돌 하나를 어떻게 넘길 것인가.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    /// 이 자리에 놓는다. `clear` 면 **기존 것을 먼저 지워야 한다**.
    Use { clear: bool },
    /// 이 항목은 건너뛴다.
    Skip,
    /// 이름을 밀어야 한다 (빈자리는 부르는 쪽이 찾는다 — 로컬은 stat, 원격은 왕복이다).
    Rename,
    /// 오류로 멈춘다.
    Fail,
}

/// 같은 모양인가 — 디렉터리끼리, 파일끼리. 링크는 **어느 쪽과도 다르다**(제자리에 덮어쓸
/// 수 없어 반드시 먼저 지워야 한다).
fn same_shape(existing: Kind, source: Kind) -> bool {
    matches!(
        (existing, source),
        (Kind::Dir, Kind::Dir) | (Kind::File, Kind::File)
    )
}

/// 충돌 정책을 적용한다. `existing` 이 `None` 이면 빈자리라 정책을 볼 것도 없다.
///
/// `Overwrite` 에서 **모양이 같으면 지우지 않는다**: 파일끼리는 잘라 쓰기(truncate)가
/// 곧 덮어쓰기이고 — 먼저 지웠다가 만들기에 실패하면 사용자의 파일이 그냥 없어진다 —
/// 디렉터리끼리는 지우는 것이 아니라 **합치는** 것이 사람이 기대하는 동작이다.
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

/// 확장자를 가른다. **디렉터리는 통째로 이름**이다 (`v1.2` 를 `v1 (2).2` 로 만들지 않는다).
///
/// 맨 앞의 점은 확장자 구분이 아니다 — `.bashrc` 는 이름이 `.bashrc` 이지 확장자가
/// `.bashrc` 인 무명 파일이 아니다. 점이 여럿이면 **마지막 점**에서 가른다
/// (`a.tar.gz` → `a.tar` + `.gz`, 탐색기와 같은 규칙이다).
pub(crate) fn split_extension(name: &str, is_dir: bool) -> (&str, &str) {
    if is_dir {
        return (name, "");
    }
    match name.rfind('.') {
        Some(0) | None => (name, ""),
        Some(dot) => (&name[..dot], &name[dot..]),
    }
}

/// 자동 이름 후보 — `이름 (2).txt`. `index` 는 2부터 센다.
pub(crate) fn candidate_name(name: &str, index: u32, is_dir: bool) -> String {
    let (stem, extension) = split_extension(name, is_dir);
    format!("{stem} ({index}){extension}")
}

/// 자동 이름을 [`RENAME_LIMIT`] 번 밀고도 빈자리를 못 찾았을 때의 문구.
pub(crate) fn no_free_name(name: &str) -> String {
    tr!(
        ko: "{name} 을(를) 놓을 빈 이름을 찾지 못했습니다 ({RENAME_LIMIT}개까지 밀어 봤습니다)",
        en: "Could not find a free name for {name} (tried up to {RENAME_LIMIT})"
    )
}

// ---------------------------------------------------------------------------
// 진행률
// ---------------------------------------------------------------------------

/// 진행률 채널 하나를 **간격을 지켜** 먹인다.
///
/// 채널이 없는 [`Progress::silent`] 이 따로 있는 이유는 이동(`local_move`·`sftp_move`)
/// 때문이다 — 이름 바꾸기 한 번으로 끝나는 일에 진행률 막대는 뜻이 없지만, 볼륨이 달라
/// 복사로 물러설 때는 **같은 실행기**를 타야 한다.
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
        // 첫 한 건은 분모를 알려 주는 값이다 — 막대가 뜨자마자 "0 / 전체" 를 그린다.
        progress.send(true);
        progress
    }

    /// 채널 없는 진행률 (이동처럼 보고할 곳이 없는 경로용).
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

    /// 파일 하나를 시작한다 (`current` 는 **대상** 경로다).
    pub(crate) fn start(&mut self, current: &str) {
        self.current = current.to_string();
        self.send(false);
    }

    /// 방금 흘려보낸 바이트를 더한다.
    pub(crate) fn advance(&mut self, bytes: u64) {
        self.bytes_done += bytes;
        self.send(false);
    }

    /// 파일 하나를 끝냈다.
    pub(crate) fn file_done(&mut self) {
        self.files_done += 1;
        self.send(false);
    }

    /// 마지막 한 건 — 간격과 상관없이 보낸다 (막대가 99% 에서 멈추지 않게).
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

/// 전송 하나의 취소 깃발. `claimed` 는 **전송이 실제로 이 번호를 집었는가** —
/// 시작 전에 취소가 먼저 도착한 번호(임자 없는 깃발)를 나중에 골라 버리기 위한 표시다.
struct Slot {
    flag: Arc<AtomicBool>,
    claimed: bool,
}

/// 전송 번호(op) → 취소 깃발.
static CANCELS: LazyLock<Mutex<HashMap<u64, Slot>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// 전송 하나가 쥐고 있는 취소 깃발. **드롭될 때 스스로 등록을 지운다** — 전송이 끝난
/// 뒤에 도착한 취소가 다음 전송에 남아 있으면 안 된다.
pub(crate) struct Cancel {
    op: Option<u64>,
    flag: Arc<AtomicBool>,
}

impl Cancel {
    /// 번호 하나를 집는다. **취소가 먼저 도착했으면 이미 세워진 깃발을 받는다** —
    /// 프런트가 명령을 부르자마자 취소를 눌러도 그 취소가 유실되지 않는다.
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

    /// 취소가 없는 경로용 (이동처럼 청크 경계가 없는 일). 절대 세워지지 않는다.
    pub(crate) fn inert() -> Self {
        Cancel {
            op: None,
            flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn stopped(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }

    /// 취소됐으면 [`crate::errors::cancelled`] 오류로 멈춘다.
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

/// 시작하지 않은 전송을 취소한 깃발은 **임자가 영영 안 나타날 수 있다**(프런트가
/// 명령을 부르지 않았거나 그 전에 오류가 났다). 맵이 불면 그런 것부터 버린다 —
/// 실행 중인 전송의 깃발은 `claimed` 라 살아남는다.
fn prune(map: &mut HashMap<u64, Slot>) {
    if map.len() >= CANCEL_LIMIT {
        map.retain(|_, slot| slot.claimed);
    }
}

/// 전송 하나를 취소한다 — 깃발만 세우고 **바로 돌아온다**.
///
/// 실제 중단은 전송 쪽이 다음 청크에서 한다(모듈 주석). 없는 번호도 성공이다: 명령이
/// 아직 시작하지 않았을 수 있으므로 깃발을 **미리 세워 두고** 기다린다
/// (`stop_edit` 과 같은 멱등 계약이다).
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
