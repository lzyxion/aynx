//! 로컬 자원 모니터 — 로컬 타일(셸 아래 프로세스 트리) · 앱 자신 · 이 PC 전체의 CPU · 메모리 표본.
//!
//! - **상시 수집 · 간격만 바뀐다**(사용자 결정) — 간격은 순수 함수 [`pace`] 하나가 정한다. **세션 0 이면 쉰다**(프로세스 목록을 읽지 않는다).
//!   이벤트 방송은 쓰지 않는다(당김뿐).
//! - **자진 종료에 끼지 않는다** — `serve::Busy` 에 자원 칸은 없고 이 스레드는 세션 · 임대를 쥐지 않는다(시험 `idle_exit_ignores_resources`).
//! - **명령줄 인자는 읽지 않는다**(토큰이 섞일 수 있다) — sysinfo 갱신은 CPU 시간 · 메모리뿐이다(시험 `never_reads_command_lines`).
//! - **표본은 tokio 런타임 밖** 전용 std 스레드 하나가 돈다 — 블로킹 갱신이 연결 고리 · 블로킹 풀을 잡지 않게.
//! - CPU% 는 **기계 전체 대비**(작업 관리자와 같은 기준) — sysinfo 의 `cpu_usage()`(코어 하나 대비)는 쓰지 않는다.
//! - 메모리는 뿌리에 귀속된 프로세스만 **전용 작업 집합**(작업 관리자 "메모리" 칸과 같은 기준 · 사용자 결정) — 작업 집합을 더하면 나눠 쓰는
//!   DLL · WebView2 공용 코드가 겹쳐 앱 몫이 두 배쯤 보인다. 뿌리 밖(다른 프로그램)의 프로세스는 열지 않는다.
//! - 귀속은 **가장 가까운 뿌리 조상** — pid 재사용은 시작 시각으로 거른다.
//! - 서버의 몫에는 서버가 띄운 헤드리스 턴 · 검증 명령 · conhost 도 든다(타일 셸 트리 밖). WSL 타일은 Windows 쪽 `wsl.exe` 트리만 보인다.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::{Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::ipc::frame::code;
use super::os;
use super::ipc::{Grade, WireError};
use super::log;
use crate::i18n::tr;
use crate::session_core::Kind;

/// 쉬는 동안 세션 수를 다시 보는 간격이기도 하다.
pub(crate) const INTERVAL: Duration = Duration::from_secs(2);
pub(crate) const IDLE_INTERVAL: Duration = Duration::from_secs(10);
const LEASE: Duration = Duration::from_secs(10);
/// 보관 기준은 **시각**이다(간격이 섞여도 30분).
const KEEP_MS: u64 = 30 * 60 * 1000;
/// 보관 기준이 아니라 안전망(시계가 뒤로 가도 끝없이 쌓이지 않게).
const RING_CAP: usize = 1000;
const _: () = assert!(RING_CAP as u64 * INTERVAL.as_millis() as u64 > KEEP_MS);
const TOP_N: usize = 3;
const MAX_DEPTH: usize = 64;

// ── 순수 층 ─────────────────────────────────────────────────────────────────

/// 명령줄은 없다(머리말).
#[derive(Debug, Clone)]
pub(crate) struct Proc {
    pub pid: u32,
    pub ppid: Option<u32>,
    /// 유닉스 초 — pid 재사용 거르기.
    pub start: u64,
    pub cpu_ms: u64,
    /// 바이트 — 읽을 때는 작업 집합, 뿌리에 귀속되면 [`with_private_memory`] 가 전용 작업 집합으로 바꾼다.
    pub mem: u64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum Bucket {
    Gui,
    Server,
    Tile(String),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub(crate) struct Usage {
    pub cpu: f32,
    /// 바이트.
    pub mem: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct TopProc {
    pub name: String,
    pub cpu: f32,
    pub mem: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct Sample {
    /// 벽시계 ms.
    pub at: u64,
    pub gui: Usage,
    pub server: Usage,
    pub tiles: BTreeMap<String, Usage>,
    /// 판 18 에 더한 칸 — 옛 GUI 는 모르는 칸을 버린다.
    pub system: SystemUsage,
}

/// CPU 는 타일 CPU% 와 같은 기준. 사용 메모리 = 전체 − 가용.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemUsage {
    pub cpu: f32,
    pub mem_used: u64,
    pub mem_total: u64,
}

pub(crate) fn system_usage(cpu: f32, mem_used: u64, mem_total: u64) -> SystemUsage {
    let cpu = if cpu.is_finite() { round1(cpu.clamp(0.0, 100.0)) } else { 0.0 };
    let mem_used = if mem_total > 0 { mem_used.min(mem_total) } else { mem_used };
    SystemUsage { cpu, mem_used, mem_total }
}

/// pid → (시작 시각, 누적 ms).
pub(crate) type PrevCpu = HashMap<u32, (u64, u64)>;

/// 직전 표본에 없던 프로세스는 그 사이에 시작했을 때만 누적 전부를 그 사이의 몫으로 센다 — 오래된데 처음 보이면 0 이다.
pub(crate) fn cpu_pct(p: &Proc, prev: &PrevCpu, prev_at_ms: u64, wall_ms: u64, ncpu: usize) -> f32 {
    if wall_ms == 0 || ncpu == 0 {
        return 0.0;
    }
    let delta = match prev.get(&p.pid) {
        Some(&(start, ms)) if start == p.start => p.cpu_ms.saturating_sub(ms),
        _ if p.start.saturating_mul(1000) + 1000 >= prev_at_ms => p.cpu_ms,
        _ => 0,
    };
    let pct = delta as f64 * 100.0 / (wall_ms as f64 * ncpu as f64);
    pct.clamp(0.0, 100.0) as f32
}

/// 부모가 자식보다 늦게 시작했으면(pid 재사용) 그 고리를 끊는다.
pub(crate) fn attribute(procs: &[Proc], roots: &HashMap<u32, Bucket>) -> HashMap<u32, Bucket> {
    let by_pid: HashMap<u32, &Proc> = procs.iter().map(|p| (p.pid, p)).collect();
    let mut out = HashMap::new();
    for p in procs {
        let mut cur: &Proc = p;
        let mut seen = HashSet::new();
        for _ in 0..MAX_DEPTH {
            if let Some(b) = roots.get(&cur.pid) {
                out.insert(p.pid, b.clone());
                break;
            }
            if !seen.insert(cur.pid) {
                break;
            }
            let Some(parent) = cur.ppid.filter(|&pp| pp != cur.pid).and_then(|pp| by_pid.get(&pp).copied()) else {
                break;
            };
            if parent.start > cur.start {
                break;
            }
            cur = parent;
        }
    }
    out
}

/// 뿌리 밖은 묻지도 않는다 — 다른 프로그램의 프로세스를 열지 않는다.
pub(crate) fn with_private_memory(procs: &mut [Proc], roots: &HashMap<u32, Bucket>, private: impl Fn(u32) -> Option<u64>) {
    let owned = attribute(procs, roots);
    for p in procs.iter_mut().filter(|p| owned.contains_key(&p.pid)) {
        if let Some(m) = private(p.pid) {
            p.mem = m;
        }
    }
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Summary {
    pub usage: BTreeMap<Bucket, Usage>,
    pub top: BTreeMap<Bucket, Vec<TopProc>>,
}

fn round1(x: f32) -> f32 {
    (x * 10.0).round() / 10.0
}

/// 뿌리에 든 프로세스가 하나도 없어도 그 뿌리의 줄은 선다(0).
pub(crate) fn summarize(procs: &[Proc], roots: &HashMap<u32, Bucket>, cpu_of: impl Fn(&Proc) -> f32) -> Summary {
    let owner = attribute(procs, roots);
    let mut usage: BTreeMap<Bucket, Usage> = roots.values().map(|b| (b.clone(), Usage::default())).collect();
    let mut members: BTreeMap<Bucket, Vec<TopProc>> = BTreeMap::new();
    for p in procs {
        let Some(b) = owner.get(&p.pid) else { continue };
        let cpu = cpu_of(p);
        let u = usage.entry(b.clone()).or_default();
        u.cpu += cpu;
        u.mem += p.mem;
        members.entry(b.clone()).or_default().push(TopProc { name: p.name.clone(), cpu: round1(cpu), mem: p.mem });
    }
    for u in usage.values_mut() {
        u.cpu = round1(u.cpu.min(100.0));
    }
    let top = members
        .into_iter()
        .map(|(b, mut v)| {
            v.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.mem.cmp(&a.mem)).then(a.name.cmp(&b.name)));
            v.truncate(TOP_N);
            (b, v)
        })
        .collect();
    Summary { usage, top }
}

pub(crate) fn sample_of(at: u64, s: &Summary, system: SystemUsage) -> Sample {
    let mut tiles = BTreeMap::new();
    let mut gui = Usage::default();
    let mut server = Usage::default();
    for (b, u) in &s.usage {
        match b {
            Bucket::Gui => gui = *u,
            Bucket::Server => server = *u,
            Bucket::Tile(stream) => {
                tiles.insert(stream.clone(), *u);
            }
        }
    }
    Sample { at, gui, server, tiles, system }
}

#[derive(Debug, Default)]
pub(crate) struct Ring {
    items: VecDeque<Sample>,
}

impl Ring {
    pub(crate) fn push(&mut self, s: Sample) {
        let now = s.at;
        self.items.push_back(s);
        while self.items.front().is_some_and(|f| f.at + KEEP_MS < now) || self.items.len() > RING_CAP {
            self.items.pop_front();
        }
    }

    pub(crate) fn since(&self, since: u64) -> Vec<Sample> {
        self.items.iter().filter(|s| s.at > since).cloned().collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Pace {
    Rest,
    Every(Duration),
}

/// 임대가 살아 있으면 세션 0 이어도 잰다 — 상태바 고리는 이 PC 전체 값이라 세션 0 이어도 보인다.
pub(crate) fn pace(sessions: usize, leased: bool) -> Pace {
    match (sessions, leased) {
        (_, true) => Pace::Every(INTERVAL),
        (0, false) => Pace::Rest,
        (_, false) => Pace::Every(IDLE_INTERVAL),
    }
}

pub(crate) fn leased(touched: Option<Instant>, now: Instant) -> bool {
    touched.is_some_and(|t| now.saturating_duration_since(t) <= LEASE)
}

/// 처음 본 시작 시각과 다르면 pid 재사용으로 보고 버린다.
pub(crate) fn gui_alive(pid: u32, known_start: Option<u64>, procs: &[Proc]) -> Option<u64> {
    let p = procs.iter().find(|p| p.pid == pid)?;
    known_start.is_none_or(|s| s == p.start).then_some(p.start)
}

// ── 서버: 임대 · 표본 스레드 · op ────────────────────────────────────────────

#[derive(Default)]
struct State {
    touched: Option<Instant>,
    running: bool,
    gui: Option<(u32, Option<u64>)>,
    ring: Ring,
    top: BTreeMap<Bucket, Vec<TopProc>>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);
static WAKE: Condvar = Condvar::new();

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 잠금과 복사뿐이라 `serve` 가 고리 안에서 처리한다.
pub(crate) fn is_resource_op(op: &str) -> bool {
    op == "resource_snapshot"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotArg {
    #[serde(default)]
    since: u64,
    #[serde(default)]
    gui_pid: Option<u32>,
}

/// 이미 있으면 그대로 — 잠금을 쥔 채로 본다.
fn ensure_running(st: &mut State) {
    if st.running {
        return;
    }
    st.running = true;
    if let Err(e) = std::thread::Builder::new().name("resource-sampler".into()).spawn(sampler) {
        st.running = false;
        log::line(format!("resource sampler spawn failed: {e}"));
    }
}

pub(crate) fn start() {
    ensure_running(&mut state());
}

pub(crate) fn handle(op: &str, b: Value) -> Result<Value, WireError> {
    if op != "resource_snapshot" {
        return Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}")));
    }
    let a: SnapshotArg = serde_json::from_value(b).map_err(|e| WireError::new(code::BAD_BODY, e.to_string()))?;
    let mut st = state();
    let now = Instant::now();
    let was_leased = leased(st.touched, now);
    st.touched = Some(now);
    if let Some(pid) = a.gui_pid {
        if st.gui.is_none_or(|(g, _)| g != pid) {
            st.gui = Some((pid, None));
        }
    }
    ensure_running(&mut st);
    if !was_leased {
        WAKE.notify_all();
    }
    let samples = st.ring.since(a.since);
    let mut tiles = BTreeMap::new();
    let mut gui = Vec::new();
    let mut server = Vec::new();
    for (b, v) in &st.top {
        match b {
            Bucket::Gui => gui = v.clone(),
            Bucket::Server => server = v.clone(),
            Bucket::Tile(s) => {
                tiles.insert(s.clone(), v.clone());
            }
        }
    }
    Ok(json!({
        "intervalMs": INTERVAL.as_millis() as u64,
        "keepMs": KEEP_MS,
        "samples": samples,
        "top": { "gui": gui, "server": server, "tiles": tiles },
    }))
}

fn current_roots(gui_pid: Option<u32>) -> HashMap<u32, Bucket> {
    let mut roots = HashMap::new();
    roots.insert(std::process::id(), Bucket::Server);
    if let Some(g) = gui_pid {
        roots.insert(g, Bucket::Gui);
    }
    let shells: Vec<(u32, u32)> = crate::pty::all_ids()
        .into_iter()
        .filter_map(|id| crate::pty::shell_pid(id).map(|pid| (id, pid)))
        .collect();
    let core = crate::session_core::core();
    for (id, pid) in shells {
        if let Some(stream) = core.stream_of(Kind::Local, id) {
            roots.insert(pid, Bucket::Tile(stream));
        }
    }
    roots
}

/// 스레드 하나가 쥐고 재사용한다(CPU% 는 직전 표본과의 차이).
pub(crate) struct Reader {
    sys: sysinfo::System,
    ncpu: usize,
}

impl Reader {
    pub(crate) fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        let ncpu = match sys.cpus().len() {
            0 => std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            n => n,
        };
        Reader { sys, ncpu }
    }

    /// CPU 시간 · 메모리만 갱신한다(머리말).
    pub(crate) fn read(&mut self) -> Vec<Proc> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate};
        self.sys
            .refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory());
        self.sys
            .processes()
            .values()
            .map(|p| Proc {
                pid: p.pid().as_u32(),
                ppid: p.parent().map(|pp| pp.as_u32()),
                start: p.start_time(),
                cpu_ms: p.accumulated_cpu_time(),
                mem: p.memory(),
                name: p.name().to_string_lossy().into_owned(),
            })
            .collect()
    }

    /// 전역 CPU 는 직전 호출과의 차라 첫 호출 값은 버려진다. 메모리는 RAM 만(스왑 · 전체 갱신 없음).
    pub(crate) fn system(&mut self) -> SystemUsage {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory_specifics(sysinfo::MemoryRefreshKind::nothing().with_ram());
        system_usage(self.sys.global_cpu_usage(), self.sys.used_memory(), self.sys.total_memory())
    }
}

/// 수집으로 돌아온 첫 바퀴는 재료만 쌓는다(CPU% 는 차이라 직전이 필요하다). 로그는 쉼 ↔ 수집 전환만.
fn sampler() {
    let mut reader: Option<Reader> = None;
    let mut prev: Option<(u64, PrevCpu)> = None;
    loop {
        let sessions = super::sessions::live_count();
        let step = pace(sessions, leased(state().touched, Instant::now()));
        let wait = match step {
            Pace::Rest => {
                if reader.take().is_some() {
                    prev = None;
                    log::line("resource sampler resting (no sessions, no viewer)");
                }
                INTERVAL
            }
            Pace::Every(d) => {
                let r = reader.get_or_insert_with(|| {
                    log::line(format!("resource sampler sampling ({sessions} session(s))"));
                    Reader::new()
                });
                sample_once(r, &mut prev);
                d
            }
        };
        nap(wait);
    }
}

/// 임대가 새로 서면 곧바로 깬다(가짜 깸 · 놓친 알림은 다시 재서 거른다).
fn nap(wait: Duration) {
    let deadline = Instant::now() + wait;
    let mut st = state();
    loop {
        let now = Instant::now();
        if now >= deadline || (wait > INTERVAL && leased(st.touched, now)) {
            return;
        }
        st = WAKE.wait_timeout(st, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
    }
}

fn sample_once(reader: &mut Reader, prev: &mut Option<(u64, PrevCpu)>) {
    let mut procs = reader.read();
    let system = reader.system();
    let gui_pid = {
        let mut st = state();
        match st.gui {
            Some((pid, known)) => match gui_alive(pid, known, &procs) {
                Some(start) => {
                    st.gui = Some((pid, Some(start)));
                    Some(pid)
                }
                None => {
                    st.gui = None;
                    None
                }
            },
            None => None,
        }
    };
    let roots = current_roots(gui_pid);
    with_private_memory(&mut procs, &roots, os::private_memory);
    let now = crate::session_core::now_ms();
    if let Some((prev_at, prev_cpu)) = prev.as_ref() {
        let wall = now.saturating_sub(*prev_at);
        let s = summarize(&procs, &roots, |p| cpu_pct(p, prev_cpu, *prev_at, wall, reader.ncpu));
        let sample = sample_of(now, &s, system);
        let mut st = state();
        st.ring.push(sample);
        st.top = s.top;
    }
    *prev = Some((now, procs.iter().map(|p| (p.pid, (p.start, p.cpu_ms))).collect()));
}

// ── GUI 껍데기 ──────────────────────────────────────────────────────────────

/// 연결이 없으면 기다리지 않는다(다음 바퀴가 다시 묻는다). 판 17 이하 서버면 `[server-outdated]`.
#[tauri::command]
pub async fn resource_snapshot(since: Option<u64>) -> Result<Value, String> {
    if super::client::negotiated_protocol().is_some_and(|p| p < super::ipc::frame::RESOURCE_PROTOCOL) {
        return Err(crate::errors::with_reason(
            crate::errors::SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 자원 사용량을 볼 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요",
                en: "The session server is an older version and cannot report resource usage — restart it in Settings › Session server"
            ),
        ));
    }
    let body = json!({ "since": since.unwrap_or(0), "guiPid": std::process::id() });
    super::client::request_now(Grade::Read, "resource_snapshot", body)
        .await
        .map_err(|e| format!("{}: {}", e.code, e.message))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, ppid: Option<u32>, start: u64, cpu_ms: u64, mem: u64, name: &str) -> Proc {
        Proc { pid, ppid, start, cpu_ms, mem, name: name.into() }
    }

    fn tile(s: &str) -> Bucket {
        Bucket::Tile(s.into())
    }

    #[test]
    fn nearest_root_wins() {
        // gui(10) → server(20) → shell(30) → node(31) → child(32); gui → webview(11)
        let procs = vec![
            p(10, Some(1), 100, 0, 0, "aynx.exe"),
            p(11, Some(10), 101, 0, 0, "msedgewebview2.exe"),
            p(20, Some(10), 102, 0, 0, "aynx.exe"),
            p(21, Some(20), 103, 0, 0, "conhost.exe"),
            p(30, Some(20), 104, 0, 0, "pwsh.exe"),
            p(31, Some(30), 105, 0, 0, "node.exe"),
            p(32, Some(31), 106, 0, 0, "esbuild.exe"),
            p(99, Some(1), 50, 0, 0, "explorer.exe"),
        ];
        let roots = HashMap::from([(10, Bucket::Gui), (20, Bucket::Server), (30, tile("s1"))]);
        let a = attribute(&procs, &roots);
        assert_eq!(a.get(&11), Some(&Bucket::Gui));
        assert_eq!(a.get(&21), Some(&Bucket::Server));
        assert_eq!(a.get(&32), Some(&tile("s1")));
        assert_eq!(a.get(&30), Some(&tile("s1")));
        assert_eq!(a.get(&99), None);
    }

    #[test]
    fn private_memory_only_for_owned_and_falls_back() {
        // gui(10) → webview(11) · 서버(20) · 밖(99). 전용 값은 11 만 모른다(None) → 작업 집합 그대로
        let mut procs = vec![
            p(10, Some(1), 100, 0, 500, "aynx.exe"),
            p(11, Some(10), 101, 0, 400, "msedgewebview2.exe"),
            p(20, Some(1), 102, 0, 300, "aynx.exe"),
            p(99, Some(1), 50, 0, 900, "explorer.exe"),
        ];
        let roots = HashMap::from([(10, Bucket::Gui), (20, Bucket::Server)]);
        let asked = std::cell::RefCell::new(Vec::new());
        with_private_memory(&mut procs, &roots, |pid| {
            asked.borrow_mut().push(pid);
            (pid != 11).then_some(u64::from(pid))
        });
        let mems: Vec<u64> = procs.iter().map(|x| x.mem).collect();
        assert_eq!(mems, vec![10, 400, 20, 900]);
        assert!(!asked.borrow().contains(&99), "뿌리 밖 프로세스는 열지 않는다");
    }

    /// 실제 OS 호출 — 자기 프로세스의 전용 작업 집합을 읽는다(Windows 10 21H2+ · 이 앱의 지원 범위)
    #[cfg(windows)]
    #[test]
    fn private_memory_reads_self() {
        let m = os::private_memory(std::process::id()).expect("전용 작업 집합");
        assert!(m > 0 && m < 64 * 1024 * 1024 * 1024, "{m}");
        assert_eq!(os::private_memory(0), None);
    }

    #[test]
    fn reused_parent_pid_is_cut() {
        // 30 의 부모 pid 20 이 재사용돼 자식보다 늦게 시작한 프로세스가 됐다 — 서버 몫으로 세지 않는다.
        let procs = vec![p(20, None, 500, 0, 0, "other.exe"), p(30, Some(20), 400, 0, 0, "orphan.exe")];
        let roots = HashMap::from([(20, Bucket::Server)]);
        let a = attribute(&procs, &roots);
        assert_eq!(a.get(&30), None);
        assert_eq!(a.get(&20), Some(&Bucket::Server));
    }

    #[test]
    fn parent_cycle_terminates() {
        let procs = vec![p(1, Some(2), 10, 0, 0, "a"), p(2, Some(1), 10, 0, 0, "b"), p(3, Some(3), 10, 0, 0, "c")];
        let roots = HashMap::from([(9, Bucket::Server)]);
        assert!(attribute(&procs, &roots).is_empty());
    }

    #[test]
    fn cpu_pct_is_machine_wide() {
        let prev: PrevCpu = HashMap::from([(5, (100, 1_000))]);
        // 2초 동안 1초 CPU · 4 CPU → 12.5%
        let cur = p(5, None, 100, 2_000, 0, "x");
        assert!((cpu_pct(&cur, &prev, 1_000_000, 2_000, 4) - 12.5).abs() < 1e-4);
        // 같은 pid 지만 시작 시각이 다르다(재사용) · 오래전 시작 → 0
        let reused = p(5, None, 200, 9_000, 0, "x");
        assert_eq!(cpu_pct(&reused, &prev, 1_000_000, 2_000, 4), 0.0);
        // 직전 표본 뒤에 시작한 새 프로세스 → 누적 전부
        let fresh = p(6, None, 1_001, 500, 0, "y");
        assert!((cpu_pct(&fresh, &prev, 1_000_000, 2_000, 1) - 25.0).abs() < 1e-4);
        // 상한 · 0 나눗셈
        let hog = p(5, None, 100, 100_000, 0, "x");
        assert_eq!(cpu_pct(&hog, &prev, 1_000_000, 2_000, 1), 100.0);
        assert_eq!(cpu_pct(&cur, &prev, 1_000_000, 0, 4), 0.0);
    }

    #[test]
    fn summarize_sums_and_ranks() {
        let procs = vec![
            p(30, None, 1, 0, 100, "pwsh.exe"),
            p(31, Some(30), 2, 0, 1_000, "node.exe"),
            p(32, Some(30), 2, 0, 50, "git.exe"),
            p(33, Some(30), 2, 0, 10, "cat.exe"),
        ];
        let roots = HashMap::from([(30, tile("s1")), (40, tile("gone")), (20, Bucket::Server)]);
        let cpu = |x: &Proc| match x.pid {
            31 => 60.0,
            32 => 50.0,
            _ => 0.04,
        };
        let s = summarize(&procs, &roots, cpu);
        assert_eq!(s.usage[&tile("s1")], Usage { cpu: 100.0, mem: 1_160 });
        assert_eq!(s.usage[&tile("gone")], Usage::default());
        assert_eq!(s.usage[&Bucket::Server], Usage::default());
        let names: Vec<_> = s.top[&tile("s1")].iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["node.exe", "git.exe", "pwsh.exe"]);
        let sys = system_usage(12.34, 8, 16);
        let sample = sample_of(7, &s, sys);
        assert_eq!(sample.tiles.len(), 2);
        assert_eq!(sample.system, sys);
        assert_eq!(sample.at, 7);
    }

    #[test]
    fn ring_keeps_thirty_minutes_and_filters_since() {
        let mut r = Ring::default();
        let mk = |at| Sample { at, gui: Usage::default(), server: Usage::default(), tiles: BTreeMap::new(), system: SystemUsage::default() };
        r.push(mk(1_000));
        r.push(mk(3_000));
        r.push(mk(1_000 + KEEP_MS + 1));
        let ats: Vec<_> = r.since(0).iter().map(|s| s.at).collect();
        assert_eq!(ats, [3_000, 1_000 + KEEP_MS + 1]);
        assert_eq!(r.since(3_000).len(), 1);
        for i in 0..(RING_CAP as u64 + 10) {
            r.push(mk(KEEP_MS + 2_000 + i));
        }
        assert_eq!(r.since(0).len(), RING_CAP);
    }

    /// 보관 기준은 시각 — 10초 간격(보는 쪽 없음)으로도 30분이 남고, 2초 · 10초가 섞여도 30분 창 그대로.
    #[test]
    fn ring_keeps_thirty_minutes_at_idle_interval() {
        let mut r = Ring::default();
        let mk = |at| Sample { at, gui: Usage::default(), server: Usage::default(), tiles: BTreeMap::new(), system: SystemUsage::default() };
        let idle = IDLE_INTERVAL.as_millis() as u64;
        let fast = INTERVAL.as_millis() as u64;
        let mut at = 0;
        for i in 0..400u64 {
            at += if i % 3 == 0 { fast } else { idle };
            r.push(mk(at));
        }
        let all = r.since(0);
        let span = all.last().unwrap().at - all.first().unwrap().at;
        assert!(span <= KEEP_MS && span + idle > KEEP_MS, "span {span}");
        assert!(all.len() < RING_CAP);
        // 10초 간격만이면 30분 = 181개 안팎
        let mut r = Ring::default();
        for i in 0..1000u64 {
            r.push(mk(i * idle));
        }
        assert_eq!(r.since(0).len() as u64, KEEP_MS / idle + 1);
    }

    #[test]
    fn system_usage_clamps_and_rounds() {
        assert_eq!(system_usage(12.34, 4, 16), SystemUsage { cpu: 12.3, mem_used: 4, mem_total: 16 });
        assert_eq!(system_usage(130.0, 20, 16), SystemUsage { cpu: 100.0, mem_used: 16, mem_total: 16 });
        assert_eq!(system_usage(-1.0, 5, 0), SystemUsage { cpu: 0.0, mem_used: 5, mem_total: 0 });
        assert_eq!(system_usage(f32::NAN, 0, 0).cpu, 0.0);
        // 응답 칸 이름(프런트 계약) — camelCase
        let v = serde_json::to_value(system_usage(1.0, 2, 3)).unwrap();
        assert_eq!(v, json!({ "cpu": 1.0, "memUsed": 2, "memTotal": 3 }));
    }

    #[test]
    fn pace_follows_sessions_and_lease() {
        assert_eq!(pace(0, false), Pace::Rest);
        assert_eq!(pace(0, true), Pace::Every(Duration::from_secs(2)), "보는 쪽이 있으면 세션 0 이어도 잰다(이 PC 전체 고리)");
        assert_eq!(pace(1, true), Pace::Every(Duration::from_secs(2)));
        assert_eq!(pace(3, false), Pace::Every(Duration::from_secs(10)));
        let t0 = Instant::now();
        assert!(!leased(None, t0));
        assert!(leased(Some(t0), t0 + LEASE));
        assert!(!leased(Some(t0), t0 + LEASE + Duration::from_millis(1)));
    }

    #[test]
    fn gui_root_dropped_when_gone_or_reused() {
        let procs = vec![p(10, None, 100, 0, 0, "aynx.exe")];
        assert_eq!(gui_alive(10, None, &procs), Some(100));
        assert_eq!(gui_alive(10, Some(100), &procs), Some(100));
        assert_eq!(gui_alive(10, Some(90), &procs), None, "같은 pid 의 다른 프로세스");
        assert_eq!(gui_alive(11, None, &procs), None, "사라진 GUI");
    }

    /// 고아 자진 종료(`serve::Busy`)에 자원 표본이 끼지 않는다 — 바쁜 이유 칸 · 그 계산에 이 파일을 부르는 자리가 없다(소스 훑기).
    #[test]
    fn idle_exit_ignores_resources() {
        let serve = include_str!("serve.rs");
        let block = |start: &str| {
            let i = serve.find(start).unwrap_or_else(|| panic!("{start}"));
            let rest = &serve[i..];
            &rest[..rest.find("\n    }").or_else(|| rest.find("\n}")).unwrap()]
        };
        for b in [block("pub(crate) struct Busy {"), block("fn busy(&self) -> Busy {"), block("pub(crate) fn idle(&self) -> bool {")] {
            assert!(!b.contains("resource"), "{b}");
        }
        assert!(super::super::serve::Busy { clients: 0, sessions: 0, plans: 0, runs: 0 }.idle());
        // 이 파일도 서버의 세션 · 임대를 쥐지 않는다 — 세션 수 · 표만 읽는다.
        let me = include_str!("resources.rs");
        let body = me.split("#[cfg(test)]").next().unwrap();
        for bad in ["attach(", "adopt(", "request_stop"] {
            assert!(!body.contains(bad), "{bad}");
        }
    }

    #[test]
    fn op_is_read_grade() {
        use super::super::ipc::frame::{check_grade, required_grade};
        assert!(is_resource_op("resource_snapshot"));
        assert_eq!(required_grade("resource_snapshot"), Some(Grade::Read));
        assert!(check_grade("resource_snapshot", Grade::Write).is_err());
        assert!(check_grade("resource_snapshot", Grade::Approve).is_err());
    }

    /// 머리말 불변식 — 명령줄 · 환경 · exe 경로 · 작업 폴더를 sysinfo 에 묻지 않는다(소스 훑기).
    #[test]
    fn never_reads_command_lines() {
        let me = include_str!("resources.rs");
        let body = me.split("#[cfg(test)]").next().unwrap();
        for bad in [".cmd()", ".environ()", ".exe()", ".cwd()", "with_cmd", "with_environ", "with_exe", "with_cwd", "with_user", "refresh_all"] {
            assert!(!body.contains(bad), "{bad}");
        }
    }

    /// 표본 비용 재기 — 이 PC 의 실제 프로세스 목록 + 전체 CPU · 메모리로 20회(평균 · 최대 ms). `cargo test resource_sample_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn resource_sample_cost() {
        let mut reader = Reader::new();
        let _ = reader.read(); // 첫 읽기(핸들 · 표 채우기 · PDH 질의 열기)는 따로 잰다
        let _ = reader.system();
        let mut times = Vec::new();
        let mut n = 0;
        let roots = HashMap::from([(std::process::id(), Bucket::Server)]);
        let mut prev: PrevCpu = HashMap::new();
        let mut prev_at = crate::session_core::now_ms();
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(200));
            let t = Instant::now();
            let procs = reader.read();
            let system = reader.system();
            let now = crate::session_core::now_ms();
            let s = summarize(&procs, &roots, |p| cpu_pct(p, &prev, prev_at, now - prev_at, reader.ncpu));
            let _ = sample_of(now, &s, system);
            prev = procs.iter().map(|p| (p.pid, (p.start, p.cpu_ms))).collect();
            prev_at = now;
            times.push(t.elapsed().as_secs_f64() * 1000.0);
            n = procs.len();
        }
        let avg = times.iter().sum::<f64>() / times.len() as f64;
        let max = times.iter().cloned().fold(0.0, f64::max);
        println!("resource sample: {n} processes · ncpu {} · avg {avg:.2} ms · max {max:.2} ms", reader.ncpu);
    }
}
