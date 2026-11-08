//! **로컬 파일 타일의 자동 새로고침** — 보이는 폴더의 OS 변경 알림(docs/log/2026-10-21-file-tile-auto-refresh.md).
//!
//! ```text
//!  local_watch_start(paths, ch) → id   타일 하나 = 구독 하나(경로 목록 · Channel 하나)
//!  local_watch_set(id, paths)          뿌리를 옮기거나 트리를 펼치고 접을 때 — 늘거나 준 경로만 OS 감시를 고친다
//!  local_watch_stop(id)                타일이 사라질 때 · 백엔드가 바뀔 때 · 설정을 끌 때
//!        ↓ (바뀜이 멎고 300ms · 길게 이어지면 2초마다 · 구독마다 최소 2초 간격)
//!  ch ← { dirs: [바뀐 감시 폴더] }        프런트가 그 폴더를 다시 읽는다(`ls.load` · `fetchFolder`)
//! ```
//!
//! ## 무엇을 보나 — 보이는 폴더만, 비재귀
//!
//! 타일이 내미는 경로는 **지금 폴더(`cwd`)와 트리에서 펼친 폴더**뿐이고 감시는 [`RecursiveMode::NonRecursive`] 다. 재귀로
//! 뿌리 하나를 보면 `node_modules` 아래 수만 개의 바뀜이 전부 이 길로 온다 — 화면에 없는 폴더의 바뀜은 아무도 그리지 않는다.
//! 같은 경로를 여러 타일이 보면 OS 감시는 **하나**다([`RefCounts`] — 참조 수). 폴링 감시(`PollWatcher`)는 쓰지 않는다:
//! 감시가 서지 않는 경로(네트워크 드라이브 · `\\wsl$` · 권한)는 **조용히 감시 없이** 둔다 — 지금처럼 ⟳ 로 남는다(오류 줄 없음).
//!
//! ## 디바운스는 여기 한 곳이다 ([`Debounce`])
//!
//! 프런트가 아니라 여기인 이유: 알림 하나하나를 `Channel::send` 로 넘기면 그것이 곧 웹뷰 UI 스레드의 `eval` 이다
//! (docs/conventions.md 의 "Tauri 명령은 기본 async fn" — 같은 스레드가 살아 있는 세션의 출력을 나른다). `npm install`
//! 한 번이 초당 수천 개를 낸다. 그래서 바뀜은 여기서 구독마다 모아 **멎고 [`QUIET`] 뒤 한 번**(길게 이어지면 [`MAX_WAIT`]
//! 마다), 그리고 같은 구독의 두 번 사이는 **최소 [`MIN_GAP`]** 로만 내보낸다.
//!
//! ## 잠금 둘 — 교착을 피하는 순서
//!
//! notify 의 Windows 몸은 `watch()` 가 감시 스레드의 답을 **기다리고**, 그 감시 스레드가 우리 알림 함수를 부른다. 알림 함수와
//! `watch()` 를 부르는 쪽이 같은 잠금을 쥐면 서로를 기다린다. 그래서 **OS 감시 쪽([`Os`])과 구독 표([`Table`])를 나누고**,
//! 알림 함수 · 시계 스레드는 표만 쥐며, 명령은 OS 감시를 고치는 동안 표를 쥐지 않는다.
//!
//! ## 수명 — 새는 구독이 없게
//!
//! 프런트가 언마운트 · 백엔드 바뀜 · 설정 끄기에 `stop` 을 부른다. 그 길이 돌지 않는 둘 — **페이지 리로드**와 **창 파괴** —
//! 는 `lib.rs` 의 `on_page_load(Started)` · `WindowEvent::Destroyed` 가 [`forget_window`] 로 그 창의 구독을 통째로 걷는다.
//! 보내기가 실패한 구독(Channel 이 닫혔다)도 그 자리에서 걷는다.
//!
//! OS 를 타는 코드는 없다 — notify 가 세 OS 를 감싼다.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::ipc::Channel;

use crate::i18n::tr;

/// 바뀜이 이만큼 멎으면 한 번 내보낸다 — 저장 한 번이 내는 서너 개의 알림(임시 파일 → 이름 바꾸기 → 속성)을 한 번으로.
pub(crate) const QUIET: Duration = Duration::from_millis(300);
/// 바뀜이 멎지 않아도(빌드 · 설치) 첫 바뀜에서 이만큼 지나면 내보낸다 — 끝날 때까지 목록이 얼어 있지 않게.
pub(crate) const MAX_WAIT: Duration = Duration::from_secs(2);
/// 같은 구독의 두 번 사이 최소 간격 — 폭주에도 목록 다시 읽기가 초당 여러 번 돌지 않게.
pub(crate) const MIN_GAP: Duration = Duration::from_secs(2);
/// 구독 하나가 볼 경로의 상한 — 트리를 아무리 펼쳐도 OS 감시가 끝없이 늘지 않게(넘는 것은 감시 없이 ⟳ 로).
pub(crate) const MAX_PATHS_PER_SUB: usize = 64;
/// 구독 전체의 상한 — 타일이 새는 버그가 있어도 OS 자원이 끝없이 늘지 않게(넘으면 새 구독은 감시 없이 선다).
const MAX_SUBS: usize = 256;

/// 프런트로 가는 한 통 — 바뀐 **감시 폴더**들(타일이 내민 글자 그대로).
#[derive(Debug, Clone, serde::Serialize)]
pub struct WatchEvent {
    pub dirs: Vec<String>,
}

// ---------------------------------------------------------------------------
// 순수 — 디바운스 · 참조 수 · 알림 → 감시 폴더
// ---------------------------------------------------------------------------

/// 구독 하나의 디바운스 — 시각을 인자로 받는 순수 상태(시험이 시계를 쥔다).
#[derive(Debug, Default, Clone)]
pub(crate) struct Debounce {
    /// 아직 안 내보낸 바뀜의 첫 시각 (`None` = 쌓인 것이 없다)
    first: Option<Instant>,
    /// 마지막 바뀜 시각
    last: Option<Instant>,
    /// 마지막으로 내보낸 시각
    fired: Option<Instant>,
}

impl Debounce {
    /// 바뀜 하나가 왔다.
    pub(crate) fn hit(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    /// 쌓인 바뀜을 **언제** 내보낼까 — 쌓인 것이 없으면 `None`.
    /// `max(min(마지막 + QUIET, 첫 + MAX_WAIT), 지난 내보냄 + MIN_GAP)`.
    pub(crate) fn due(&self) -> Option<Instant> {
        let (first, last) = (self.first?, self.last?);
        let settle = (last + QUIET).min(first + MAX_WAIT);
        Some(match self.fired {
            Some(f) => settle.max(f + MIN_GAP),
            None => settle,
        })
    }

    /// 내보냈다 — 쌓인 것을 비우고 시각을 적는다.
    pub(crate) fn fire(&mut self, now: Instant) {
        self.first = None;
        self.last = None;
        self.fired = Some(now);
    }
}

/// 경로별 OS 감시 참조 수 — "OS 감시를 세워라 / 걷어라" 를 **돌려주기만** 한다(실제 감시는 부르는 쪽).
#[derive(Debug, Default)]
pub(crate) struct RefCounts {
    counts: HashMap<PathBuf, usize>,
}

impl RefCounts {
    /// 이 경로를 보는 구독이 이미 있는가.
    pub(crate) fn held(&self, path: &Path) -> bool {
        self.counts.contains_key(path)
    }
    /// 하나 더 본다 — 처음이면 `true`(OS 감시를 세운 **뒤에** 부른다: 실패한 경로는 세지 않는다).
    pub(crate) fn acquire(&mut self, path: &Path) -> bool {
        let n = self.counts.entry(path.to_path_buf()).or_insert(0);
        *n += 1;
        *n == 1
    }
    /// 하나 덜 본다 — 마지막이면 `true`(OS 감시를 걷는다).
    pub(crate) fn release(&mut self, path: &Path) -> bool {
        match self.counts.get_mut(path) {
            Some(n) if *n > 1 => {
                *n -= 1;
                false
            }
            Some(_) => {
                self.counts.remove(path);
                true
            }
            None => false,
        }
    }
}

/// 알림의 경로 하나 → 그것을 담은 **감시 폴더 후보** 둘(자기 자신 · 부모). 비재귀 감시의 알림은 그 폴더의 자식이거나
/// (만들기 · 지우기 · 이름 · 쓰기) 그 폴더 자신이다(폴더가 지워졌다 · 속성).
fn candidates(path: &Path) -> impl Iterator<Item = &Path> {
    std::iter::once(path).chain(path.parent())
}

/// 이 알림 종류가 목록을 바꿀 수 있는가 — **읽기(Access)는 아니다**. 우리가 목록을 읽는 것 자체가 inotify 에서는
/// 열기 · 닫기 알림이라, 이것을 걸러내지 않으면 다시 읽기가 다시 읽기를 부른다.
pub(crate) fn changes_listing(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_))
}

/// 타일이 내민 경로 목록 → 감시할 경로(빈 칸 · 겹침을 빼고 상한까지 — 앞의 것이 먼저다: 프런트가 `cwd` 를 맨 앞에 둔다).
pub(crate) fn wanted_paths(paths: &[String]) -> Vec<(PathBuf, String)> {
    let mut seen = HashSet::new();
    paths
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .filter(|p| seen.insert(PathBuf::from(p)))
        .take(MAX_PATHS_PER_SUB)
        .map(|p| (PathBuf::from(p), p.to_string()))
        .collect()
}

// ---------------------------------------------------------------------------
// 상태 — OS 감시 · 구독 표
// ---------------------------------------------------------------------------

/// OS 감시 쪽 — 감시자 하나 + 참조 수. **명령만** 쥔다(알림 함수는 여기를 쥐지 않는다 — 머리말 "잠금 둘").
#[derive(Default)]
struct Os {
    watcher: Option<RecommendedWatcher>,
    refs: RefCounts,
}

struct Sub {
    window: String,
    /// OS 감시가 실제로 선 경로(실패한 것은 없다) → 프런트가 준 글자
    held: HashMap<PathBuf, String>,
    channel: Channel<WatchEvent>,
    debounce: Debounce,
    dirty: BTreeSet<String>,
}

#[derive(Default)]
struct Table {
    subs: HashMap<u64, Sub>,
    next_id: u64,
    /// 시계 스레드가 섰는가
    ticking: bool,
}

struct State {
    os: Mutex<Os>,
    table: Mutex<Table>,
    wake: Condvar,
}

fn state() -> &'static State {
    static STATE: OnceLock<State> = OnceLock::new();
    STATE.get_or_init(|| State {
        os: Mutex::new(Os::default()),
        table: Mutex::new(Table::default()),
        wake: Condvar::new(),
    })
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// OS 알림 하나 — 그 경로를 보는 구독마다 바뀜을 적고 시계를 깨운다(표만 쥔다).
fn on_event(res: notify::Result<notify::Event>) {
    let Ok(event) = res else { return };
    if !changes_listing(&event.kind) {
        return;
    }
    let st = state();
    let now = Instant::now();
    let mut table = lock(&st.table);
    let mut any = false;
    for sub in table.subs.values_mut() {
        for path in &event.paths {
            for dir in candidates(path) {
                if let Some(text) = sub.held.get(dir) {
                    sub.dirty.insert(text.clone());
                    sub.debounce.hit(now);
                    any = true;
                }
            }
        }
    }
    drop(table);
    if any {
        st.wake.notify_all();
    }
}

/// 감시자가 없으면 세운다 — 실패하면 `None`(그 구독은 감시 없이 선다 · 다음 구독이 다시 해 본다).
fn watcher(os: &mut Os) -> Option<&mut RecommendedWatcher> {
    if os.watcher.is_none() {
        match notify::recommended_watcher(on_event) {
            Ok(w) => os.watcher = Some(w),
            Err(e) => {
                eprintln!("[aynx] 파일 감시를 세우지 못했습니다(감시 없이 둡니다): {e}");
                return None;
            }
        }
    }
    os.watcher.as_mut()
}

/// `held` 를 `wanted` 로 갈아 끼운다 — 늘어난 경로만 OS 감시를 세우고, 준 경로만 걷는다. 돌려주는 것은 새 `held`.
fn retarget(held: &HashMap<PathBuf, String>, wanted: Vec<(PathBuf, String)>) -> HashMap<PathBuf, String> {
    let st = state();
    let mut os = lock(&st.os);
    let want: HashSet<&PathBuf> = wanted.iter().map(|(p, _)| p).collect();
    for path in held.keys().filter(|p| !want.contains(p)) {
        if os.refs.release(path) {
            if let Some(w) = os.watcher.as_mut() {
                let _ = w.unwatch(path); // 이미 사라진 폴더면 실패한다 — 걷는 길이라 상관없다
            }
        }
    }
    let mut next = HashMap::new();
    for (path, text) in wanted {
        if held.contains_key(&path) {
            next.insert(path, text);
            continue;
        }
        let ok = os.refs.held(&path)
            || watcher(&mut os).is_some_and(|w| w.watch(&path, RecursiveMode::NonRecursive).is_ok());
        if ok {
            os.refs.acquire(&path);
            next.insert(path, text);
        }
        // 실패(네트워크 드라이브 · `\\wsl$` · 권한 · 없는 폴더)는 조용히 감시 없이 — 머리말
    }
    next
}

/// 구독 하나를 표에서 빼고 그 OS 감시 몫을 걷는다.
fn drop_sub(id: u64) {
    let st = state();
    let sub = lock(&st.table).subs.remove(&id);
    if let Some(sub) = sub {
        retarget(&sub.held, Vec::new());
    }
}

/// 시계 스레드 — 때가 된 구독의 바뀜을 내보낸다. 표를 쥔 채 보내지 않는다(보내기는 웹뷰로 가는 길이다).
fn tick_loop() {
    let st = state();
    let mut table = lock(&st.table);
    loop {
        let now = Instant::now();
        let mut ready: Vec<(u64, Channel<WatchEvent>, Vec<String>)> = Vec::new();
        let mut next: Option<Instant> = None;
        for (id, sub) in table.subs.iter_mut() {
            let Some(due) = sub.debounce.due() else { continue };
            if due <= now {
                sub.debounce.fire(now);
                let dirs = std::mem::take(&mut sub.dirty).into_iter().collect();
                ready.push((*id, sub.channel.clone(), dirs));
            } else {
                next = Some(next.map_or(due, |n| n.min(due)));
            }
        }
        if !ready.is_empty() {
            drop(table);
            for (id, channel, dirs) in ready {
                if channel.send(WatchEvent { dirs }).is_err() {
                    drop_sub(id); // Channel 이 닫혔다 — 받을 이가 없다
                }
            }
            table = lock(&st.table);
            continue;
        }
        // 셈과 기다림이 **한 잠금 안**이다 — 그 사이에 온 알림이 깨움을 놓치지 않는다(알림 함수도 이 잠금을 쥐고 적는다).
        let wait = next.map_or(Duration::from_secs(60), |n| n.saturating_duration_since(now));
        table = st.wake.wait_timeout(table, wait).map(|(g, _)| g).unwrap_or_else(|e| e.into_inner().0);
    }
}

fn ensure_ticking() {
    let st = state();
    let mut table = lock(&st.table);
    if table.ticking {
        return;
    }
    table.ticking = true;
    drop(table);
    std::thread::Builder::new()
        .name("aynx-local-watch".into())
        .spawn(tick_loop)
        .map(|_| ())
        .unwrap_or_else(|e| {
            eprintln!("[aynx] 파일 감시 시계를 세우지 못했습니다: {e}");
            lock(&st.table).ticking = false;
        });
}

// ---------------------------------------------------------------------------
// 몸통 — 명령 · 창 거두기가 부른다
// ---------------------------------------------------------------------------

fn start(window: String, paths: &[String], channel: Channel<WatchEvent>) -> u64 {
    ensure_ticking();
    let st = state();
    let full = lock(&st.table).subs.len() >= MAX_SUBS;
    let held = if full { HashMap::new() } else { retarget(&HashMap::new(), wanted_paths(paths)) };
    let mut table = lock(&st.table);
    table.next_id += 1;
    let id = table.next_id;
    table.subs.insert(id, Sub { window, held, channel, debounce: Debounce::default(), dirty: BTreeSet::new() });
    id
}

fn set(id: u64, paths: &[String]) {
    let st = state();
    // 지금 몫을 꺼내 OS 감시를 고친 뒤 되돌려 놓는다 — 고치는 동안 표를 쥐지 않는다(머리말 "잠금 둘").
    let Some(held) = lock(&st.table).subs.get(&id).map(|s| s.held.clone()) else { return };
    let next = retarget(&held, wanted_paths(paths));
    let mut table = lock(&st.table);
    match table.subs.get_mut(&id) {
        Some(sub) => {
            // 빠진 폴더의 쌓인 바뀜은 버린다(이제 그 폴더를 그리지 않는다)
            sub.dirty.retain(|d| next.values().any(|t| t == d));
            sub.held = next;
        }
        None => {
            // 그새 걷혔다(stop · 창 거두기) — 방금 세운 몫을 되돌린다
            drop(table);
            retarget(&next, Vec::new());
        }
    }
}

/// 이 창의 구독을 통째로 걷는다 — 페이지 리로드 · 창 파괴(프런트의 `stop` 이 돌지 않는 길 — 머리말 "수명").
pub(crate) fn forget_window(label: &str) {
    let st = state();
    let ids: Vec<u64> = lock(&st.table).subs.iter().filter(|(_, s)| s.window == label).map(|(id, _)| *id).collect();
    for id in ids {
        drop_sub(id);
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| tr!(ko: "작업을 끝내지 못했습니다: {e}", en: "The task did not finish: {e}"))
}

/// 타일 하나의 감시를 세운다 — 돌려주는 id 로 고치고(`local_watch_set`) 걷는다(`local_watch_stop`).
/// 감시가 서지 않는 경로는 조용히 빠진다(그래도 id 는 돌려준다 — 프런트가 실패를 가를 일이 없다).
/// OS 감시를 세우는 일이 감시 스레드의 답을 기다리므로 블로킹 풀에서 한다.
#[tauri::command]
pub async fn local_watch_start(
    window: tauri::Window,
    paths: Vec<String>,
    on_change: Channel<WatchEvent>,
) -> Result<u64, String> {
    let label = window.label().to_string();
    blocking(move || start(label, &paths, on_change)).await
}

/// 그 구독이 볼 경로를 갈아 끼운다 — 없는 id 면 아무 일도 없다.
#[tauri::command]
pub async fn local_watch_set(id: u64, paths: Vec<String>) -> Result<(), String> {
    blocking(move || set(id, &paths)).await
}

/// 그 구독을 걷는다 — 없는 id 면 아무 일도 없다(멱등).
#[tauri::command]
pub async fn local_watch_stop(id: u64) -> Result<(), String> {
    blocking(move || drop_sub(id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(base: Instant, ms: u64) -> Instant {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn debounce_fires_after_quiet() {
        let t0 = Instant::now();
        let mut d = Debounce::default();
        assert_eq!(d.due(), None);
        d.hit(t0);
        assert_eq!(d.due(), Some(at(t0, 300)));
        d.hit(at(t0, 100));
        assert_eq!(d.due(), Some(at(t0, 400)), "새 바뀜이 오면 멎은 시각부터 다시 센다");
    }

    #[test]
    fn debounce_caps_wait_during_a_storm() {
        let t0 = Instant::now();
        let mut d = Debounce::default();
        // 100ms 마다 끝없이 — 멎지 않아도 첫 바뀜에서 2초면 내보낸다
        for ms in (0..=1900).step_by(100) {
            d.hit(at(t0, ms));
        }
        assert_eq!(d.due(), Some(at(t0, 2000)));
    }

    #[test]
    fn debounce_keeps_min_gap_between_fires() {
        let t0 = Instant::now();
        let mut d = Debounce::default();
        d.hit(t0);
        d.fire(at(t0, 300));
        assert_eq!(d.due(), None, "내보내면 쌓인 것이 없다");
        d.hit(at(t0, 400));
        // 멎은 지 300ms(=700ms)가 아니라 지난 내보냄 + 2초(=2300ms)
        assert_eq!(d.due(), Some(at(t0, 2300)));
        d.fire(at(t0, 2300));
        d.hit(at(t0, 9000));
        assert_eq!(d.due(), Some(at(t0, 9300)), "간격이 이미 지났으면 멎음만 기다린다");
    }

    #[test]
    fn refcounts_share_one_os_watch() {
        let mut r = RefCounts::default();
        let p = Path::new("C:\\a");
        assert!(!r.held(p));
        assert!(r.acquire(p), "처음 = OS 감시를 세운다");
        assert!(!r.acquire(p), "둘째 타일은 같은 감시를 나눈다");
        assert!(!r.release(p));
        assert!(r.release(p), "마지막 = OS 감시를 걷는다");
        assert!(!r.held(p));
        assert!(!r.release(p), "없는 것을 걷어도 아무 일 없다");
    }

    #[test]
    fn wanted_paths_trims_dedups_and_caps() {
        let mut input = vec!["".to_string(), " C:\\a ".to_string(), "C:\\a".to_string(), "C:\\b".to_string()];
        let got: Vec<String> = wanted_paths(&input).into_iter().map(|(_, s)| s).collect();
        assert_eq!(got, vec!["C:\\a", "C:\\b"]);
        input = (0..100).map(|i| format!("C:\\d{i}")).collect();
        let got = wanted_paths(&input);
        assert_eq!(got.len(), MAX_PATHS_PER_SUB);
        assert_eq!(got[0].1, "C:\\d0", "앞의 것(cwd)이 남는다");
    }

    #[test]
    fn access_events_do_not_change_listing() {
        use notify::event::{AccessKind, CreateKind};
        assert!(!changes_listing(&EventKind::Access(AccessKind::Any)));
        assert!(changes_listing(&EventKind::Create(CreateKind::File)));
        assert!(changes_listing(&EventKind::Any));
    }

    #[test]
    fn candidates_are_self_and_parent() {
        let p = Path::new("/x/y/z.txt");
        let got: Vec<&Path> = candidates(p).collect();
        assert_eq!(got, vec![Path::new("/x/y/z.txt"), Path::new("/x/y")]);
    }

    /// 실제 OS 감시 — 임시 폴더에 파일을 만들면 그 폴더가 비재귀 감시의 알림으로 온다(감시 폴더 후보 = 부모).
    /// 몸통([`retarget`] · 알림 함수 · 참조 수)을 Channel 없이 지난다(Channel 은 웹뷰가 있어야 선다).
    #[test]
    fn real_watch_reports_child_change() {
        use std::sync::mpsc;
        let dir = std::env::temp_dir().join(format!("aynx-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if changes_listing(&ev.kind) {
                    let _ = tx.send(ev.paths);
                }
            }
        })
        .unwrap();
        w.watch(&dir, RecursiveMode::NonRecursive).unwrap();
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        let canon = dir.canonicalize().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut hit = false;
        while Instant::now() < deadline && !hit {
            if let Ok(paths) = rx.recv_timeout(Duration::from_millis(200)) {
                hit = paths.iter().any(|p| {
                    candidates(p).any(|c| c == dir || c.canonicalize().ok().as_deref() == Some(canon.as_path()))
                });
            }
        }
        let _ = w.unwatch(&dir);
        drop(w);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(hit, "임시 폴더의 새 파일이 감시 알림으로 와야 한다");
    }

    /// 몸통의 참조 수 — 두 구독이 같은 폴더를 보면 OS 감시는 하나, 하나가 빠져도 남고 둘 다 빠지면 걷힌다.
    #[test]
    fn retarget_shares_and_releases() {
        let dir = std::env::temp_dir().join(format!("aynx-watch-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let text = dir.to_string_lossy().to_string();
        let a = retarget(&HashMap::new(), wanted_paths(std::slice::from_ref(&text)));
        let b = retarget(&HashMap::new(), wanted_paths(std::slice::from_ref(&text)));
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert!(lock(&state().os).refs.held(&dir));
        retarget(&a, Vec::new());
        assert!(lock(&state().os).refs.held(&dir), "다른 구독이 아직 본다");
        retarget(&b, Vec::new());
        assert!(!lock(&state().os).refs.held(&dir));
        // 없는 폴더는 조용히 빠진다
        let gone = retarget(&HashMap::new(), wanted_paths(&[dir.join("nope").to_string_lossy().to_string()]));
        assert!(gone.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
