//! **에이전트 사용량** — 지난 대화의 토큰 합과 요금제 한도 % (docs/log/2026-09-26-agent-usage.md). **요금 환산은 하지 않는다**(구독제라
//! 뜻이 없다).
//!
//! ## Codex 의 누적 칸
//!
//! `token_count.info.total_token_usage` 는 대화 누적이고 포크 파일의 첫 기록은 부모의 누적을 이어받는다 — 파일의 첫 `token_count` 는
//! `last` 만, 그 뒤로는 앞 누적과의 차이만 센다. 누적이 줄어들면(다시 이어 띄운 대화) 그 줄의 `last` 로 새 구간을 연다.
//! `token_usage_record` 는 한 파일 안에서도 구간마다 있다 없다 하므로 "그 구간에 응답 기록이 있으면 그것(+ 첫 기록 앞의 누적 차),
//! 없으면 누적 차" 로 센다.
//!
//! ## 증분 읽기
//!
//! 대화 파일은 덧붙이기만 한다(`/compact` 도) — 크기가 늘면 다 읽은 자리부터 새 줄만 읽는다. 끝의 반쯤 적힌 줄은 자리를 옮기지
//! 않는다. 크기가 줄었거나 크기는 같은데 mtime 이 바뀌었으면 처음부터 다시 읽는다.
//!
//! ## 개인정보
//!
//! 숫자(토큰 · 시각 · %)와 대화 id 만 담는다. 본문은 파싱 중에도 담지 않는다 — 줄 구조체에 본문 칸이 없다
//! (serde 가 건너뛴다). 캐시는 메모리에만 있다.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use chrono::Datelike;
use serde::{Deserialize, Serialize};

use crate::agent_sessions::{
    self as sessions, FileStamp, Layout, SessionSource, SessionTarget, TARGETS,
};

/// 로컬 날짜 — 서기 1년 1월 1일부터의 일수(`chrono::NaiveDate::num_days_from_ce`).
pub(crate) type Day = i32;

/// [`FileUsage::models`] 의 자리.
type ModelIx = u16;

/// 캐시 상한 — 넘으면 비우고 다시 채운다.
const CACHE_MAX: usize = 8192;
const READ_BUF: usize = 256 * 1024;
/// Codex 한도 — 최신 파일 이만큼의 꼬리만 본다.
const LIMIT_FILES: usize = 8;
const LIMIT_TAIL_BYTES: u64 = 256 * 1024;
const MAX_THREADS: usize = 8;

// ---------------------------------------------------------------------------
// 토큰
// ---------------------------------------------------------------------------

/// 토큰 네 칸. `input` 은 **캐시에 걸리지 않은** 입력이다(Codex 의 `input_tokens` 는 캐시 몫을 품어서 뺀다).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub output: u64,
}

impl Tokens {
    pub fn total(&self) -> u64 {
        self.input + self.cache_read + self.cache_write + self.output
    }

    fn add(&mut self, o: &Tokens) {
        self.input += o.input;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.output += o.output;
    }

    /// 같은 응답이 여러 줄에 적힌다 — 스트리밍 중 출력 수가 자란다.
    fn max_each(&mut self, o: &Tokens) {
        self.input = self.input.max(o.input);
        self.cache_read = self.cache_read.max(o.cache_read);
        self.cache_write = self.cache_write.max(o.cache_write);
        self.output = self.output.max(o.output);
    }

    fn minus(&self, o: &Tokens) -> Tokens {
        Tokens {
            input: self.input.saturating_sub(o.input),
            cache_read: self.cache_read.saturating_sub(o.cache_read),
            cache_write: self.cache_write.saturating_sub(o.cache_write),
            output: self.output.saturating_sub(o.output),
        }
    }
}

fn day_of(ts: Option<&str>) -> Option<Day> {
    let d = chrono::DateTime::parse_from_rfc3339(ts?).ok()?;
    Some(
        d.with_timezone(&chrono::Local)
            .date_naive()
            .num_days_from_ce(),
    )
}

fn today() -> Day {
    chrono::Local::now().date_naive().num_days_from_ce()
}

// ---------------------------------------------------------------------------
// 파일 하나의 누적 — 에이전트를 가리지 않는 모양
// ---------------------------------------------------------------------------

/// Codex 누적 칸의 한 구간 — 모듈 머리말.
#[derive(Default)]
struct Epoch {
    keyed_seen: bool,
    /// 첫 응답 기록 **앞**의 누적 차.
    pre: BTreeMap<(Day, ModelIx), Tokens>,
    keyed: HashMap<String, (Day, ModelIx, Tokens)>,
    delta: BTreeMap<(Day, ModelIx), Tokens>,
}

/// 창 길이(분)가 라벨의 근거다(Codex `window_minutes` · Claude 는 `five_hour`=300 · `seven_day`=10080).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    #[serde(default)]
    pub window_minutes: Option<u64>,
    /// 출처의 이름(`five_hour` · `seven_day` · `primary` · `secondary`) — 라벨은 분으로 짓는다.
    #[serde(default)]
    pub kind: Option<String>,
    /// 0~100.
    pub used_percent: f64,
    /// epoch 초
    #[serde(default)]
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Default)]
struct LimitSnap {
    at_ms: i64,
    windows: Vec<LimitWindow>,
}

/// **`Debug` 없음** — 모듈의 결을 따른다.
#[derive(Default)]
pub(crate) struct FileUsage {
    /// Codex `session_meta.payload.id` — Claude 는 파일 이름이 id 다.
    meta_id: Option<String>,
    forked: bool,
    /// Claude `message.id:requestId` — 같은 키는 칸마다 큰 값.
    keyed: HashMap<String, (Day, ModelIx, Tokens)>,
    models: Vec<String>,
    /// Codex — 지금 턴의 모델. 그 뒤의 기록은 이 모델의 것이다.
    current_model: Option<ModelIx>,
    last_total: Option<(u64, Tokens)>,
    epochs: Vec<Epoch>,
    limits: Option<LimitSnap>,
}

impl FileUsage {
    fn epoch(&mut self) -> &mut Epoch {
        if self.epochs.is_empty() {
            self.epochs.push(Epoch::default());
        }
        self.epochs.last_mut().expect("방금 넣었다")
    }

    /// 번호가 넘치면 마지막 번호에 몰아 둔다.
    fn model_ix(&mut self, name: &str) -> ModelIx {
        if let Some(i) = self.models.iter().position(|m| m == name) {
            return i as ModelIx;
        }
        if self.models.len() >= ModelIx::MAX as usize {
            return ModelIx::MAX - 1;
        }
        self.models.push(name.to_owned());
        (self.models.len() - 1) as ModelIx
    }

    fn model_name(&self, i: ModelIx) -> &str {
        self.models.get(i as usize).map_or("", String::as_str)
    }

    /// 셈의 규칙(Codex 구간 규칙)은 여기 한 곳이다.
    fn buckets(&self) -> BTreeMap<(Day, ModelIx), Tokens> {
        let mut out: BTreeMap<(Day, ModelIx), Tokens> = BTreeMap::new();
        let mut put = |k: (Day, ModelIx), t: &Tokens| out.entry(k).or_default().add(t);
        for (d, m, t) in self.keyed.values() {
            put((*d, *m), t);
        }
        for e in &self.epochs {
            if e.keyed_seen {
                for (k, t) in &e.pre {
                    put(*k, t);
                }
                for (d, m, t) in e.keyed.values() {
                    put((*d, *m), t);
                }
            } else {
                for (k, t) in &e.delta {
                    put(*k, t);
                }
            }
        }
        out
    }

    fn days(&self) -> BTreeMap<Day, Tokens> {
        let mut out: BTreeMap<Day, Tokens> = BTreeMap::new();
        for ((d, _), t) in self.buckets() {
            out.entry(d).or_default().add(&t);
        }
        out
    }
}

// ---------------------------------------------------------------------------
// 에이전트 표의 두 칸
// ---------------------------------------------------------------------------

pub(crate) struct UsageSource {
    /// 이 글자(바이트) 중 하나라도 든 줄만 JSON 으로 푼다.
    needles: &'static [&'static str],
    /// 줄 하나(끝 `\n` 뗀 것). 읽히지 않는 줄은 조용히 건너뛴다.
    line: fn(&mut FileUsage, &[u8]),
    /// 같은 대화에 딸린 다른 파일(Claude 서브에이전트).
    companions: fn(&Path) -> Vec<PathBuf>,
    conversation_id: fn(&Path, &FileUsage) -> Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) enum LimitSource {
    /// 타일의 claude 가 실은 mod 가 한도 도우미로 적은 파일(`claude_usage.rs`).
    HelperFile,
    /// 최신 롤아웃 꼬리의 `token_count.rate_limits`.
    RolloutTail,
}

// ---- Claude Code ----

#[derive(Deserialize)]
struct CLine {
    #[serde(rename = "type", default)]
    ty: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(rename = "requestId", default)]
    request_id: Option<String>,
    #[serde(default)]
    message: Option<CMsg>,
}

#[derive(Deserialize)]
struct CMsg {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<CUsage>,
}

#[derive(Deserialize, Default)]
struct CUsage {
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    cache_read_input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
}

/// `(message.id, requestId)` 마다 칸마다 큰 값 — 스트리밍 중 출력 수가 자란다.
fn claude_line(u: &mut FileUsage, line: &[u8]) {
    let Ok(v) = serde_json::from_slice::<CLine>(line) else {
        return;
    };
    if v.ty.as_deref() != Some("assistant") {
        return;
    }
    let Some(msg) = v.message else { return };
    // `<synthetic>` 은 모델이 아니다(앱이 지어낸 응답 — 토큰도 0)
    if msg.model.as_deref().is_some_and(|m| m.starts_with('<')) {
        return;
    }
    let (Some(usage), Some(mid)) = (msg.usage, msg.id) else {
        return;
    };
    let Some(day) = day_of(v.timestamp.as_deref()) else {
        return;
    };
    let t = Tokens {
        input: usage.input_tokens.unwrap_or(0),
        cache_read: usage.cache_read_input_tokens.unwrap_or(0),
        cache_write: usage.cache_creation_input_tokens.unwrap_or(0),
        output: usage.output_tokens.unwrap_or(0),
    };
    let key = format!("{mid}:{}", v.request_id.as_deref().unwrap_or(""));
    let m = u.model_ix(msg.model.as_deref().unwrap_or("").trim());
    u.keyed
        .entry(key)
        .and_modify(|(_, _, old)| old.max_each(&t))
        .or_insert((day, m, t));
}

/// `<프로젝트>/<id>.jsonl` → `<프로젝트>/<id>/subagents/**/*.jsonl` (워크플로의 `workflows/wf_*/…` 까지).
fn claude_companions(file: &Path) -> Vec<PathBuf> {
    let (Some(dir), Some(stem)) = (file.parent(), file.file_stem()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut stack = vec![dir.join(stem).join("subagents")];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            match e.file_type() {
                Ok(ft) if ft.is_dir() => stack.push(p),
                Ok(ft) if ft.is_file() && sessions::is_jsonl(&p) => out.push(p),
                _ => {}
            }
        }
    }
    out
}

fn claude_conversation_id(file: &Path, _: &FileUsage) -> Option<String> {
    let stem = file.file_stem()?.to_string_lossy();
    sessions::uuid_shape(&stem).then(|| stem.to_ascii_lowercase())
}

pub(crate) const CLAUDE_USAGE: UsageSource = UsageSource {
    needles: &["\"usage\""],
    line: claude_line,
    companions: claude_companions,
    conversation_id: claude_conversation_id,
};

// ---- Codex ----

#[derive(Deserialize)]
struct XLine {
    #[serde(rename = "type", default)]
    ty: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    payload: Option<XPayload>,
}

#[derive(Deserialize)]
struct XPayload {
    #[serde(rename = "type", default)]
    ty: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    forked_from_id: Option<String>,
    #[serde(default)]
    info: Option<XInfo>,
    #[serde(default)]
    rate_limits: Option<XRate>,
    #[serde(default)]
    response_id: Option<String>,
    #[serde(default)]
    usage: Option<XUsage>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Deserialize)]
struct XInfo {
    #[serde(default)]
    total_token_usage: Option<XUsage>,
    #[serde(default)]
    last_token_usage: Option<XUsage>,
}

#[derive(Deserialize, Default, Clone, Copy)]
struct XUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    cache_write_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    total_tokens: u64,
}

impl XUsage {
    /// Codex 의 `input_tokens` 는 캐시 몫을 품는다(`cached ≤ input` · `total = input + output`).
    fn tokens(&self) -> Tokens {
        Tokens {
            input: self
                .input_tokens
                .saturating_sub(self.cached_input_tokens)
                .saturating_sub(self.cache_write_input_tokens),
            cache_read: self.cached_input_tokens,
            cache_write: self.cache_write_input_tokens,
            output: self.output_tokens,
        }
    }

    fn total(&self) -> u64 {
        if self.total_tokens > 0 {
            self.total_tokens
        } else {
            self.input_tokens + self.output_tokens
        }
    }
}

#[derive(Deserialize)]
struct XRate {
    #[serde(default)]
    limit_id: Option<String>,
    #[serde(default)]
    primary: Option<XWin>,
    #[serde(default)]
    secondary: Option<XWin>,
}

#[derive(Deserialize)]
struct XWin {
    #[serde(default)]
    used_percent: Option<f64>,
    #[serde(default)]
    window_minutes: Option<f64>,
    #[serde(default)]
    resets_at: Option<f64>,
}

/// `limit_id` 가 `codex` 가 아닌 것(`base_model_inference` — 늘 0%)은 요금제 한도가 아니라 건너뛴다(없으면 받는다).
fn codex_windows(r: &XRate) -> Option<Vec<LimitWindow>> {
    if r.limit_id.as_deref().is_some_and(|id| id != "codex") {
        return None;
    }
    let win = |w: &XWin, kind: &str| -> Option<LimitWindow> {
        Some(LimitWindow {
            window_minutes: w
                .window_minutes
                .filter(|m| *m > 0.0)
                .map(|m| m.round() as u64),
            kind: Some(kind.to_owned()),
            used_percent: w.used_percent?.clamp(0.0, 1000.0),
            resets_at: w.resets_at.map(|s| s as i64),
        })
    };
    let out: Vec<LimitWindow> = [
        r.primary.as_ref().and_then(|w| win(w, "primary")),
        r.secondary.as_ref().and_then(|w| win(w, "secondary")),
    ]
    .into_iter()
    .flatten()
    .collect();
    (!out.is_empty()).then_some(out)
}

fn codex_line(u: &mut FileUsage, line: &[u8]) {
    let Ok(v) = serde_json::from_slice::<XLine>(line) else {
        return;
    };
    let Some(pl) = v.payload else { return };
    match v.ty.as_deref() {
        Some("session_meta") => {
            if u.meta_id.is_none() {
                u.meta_id = pl
                    .id
                    .filter(|s| sessions::uuid_shape(s))
                    .map(|s| s.to_ascii_lowercase());
                u.forked = pl.forked_from_id.is_some_and(|s| !s.is_empty());
            }
        }
        Some("turn_context") => {
            if let Some(m) = pl.model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                u.current_model = Some(u.model_ix(m));
            }
        }
        Some("token_usage_record") => {
            let (Some(rid), Some(usage)) = (pl.response_id, pl.usage) else {
                return;
            };
            let Some(day) = day_of(v.timestamp.as_deref()) else {
                return;
            };
            let t = usage.tokens();
            let m = codex_model(u);
            let e = u.epoch();
            e.keyed_seen = true;
            e.keyed
                .entry(rid)
                .and_modify(|(_, _, old)| old.max_each(&t))
                .or_insert((day, m, t));
        }
        Some("event_msg") if pl.ty.as_deref() == Some("token_count") => {
            let at = v
                .timestamp
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());
            if let (Some(r), Some(at)) = (&pl.rate_limits, at) {
                if let Some(windows) = codex_windows(r) {
                    let at_ms = at.timestamp_millis();
                    if u.limits.as_ref().is_none_or(|l| l.at_ms <= at_ms) {
                        u.limits = Some(LimitSnap { at_ms, windows });
                    }
                }
            }
            let Some(info) = pl.info else { return };
            let (Some(total), Some(last)) = (info.total_token_usage, info.last_token_usage) else {
                return;
            };
            let Some(day) = at.map(|d| {
                d.with_timezone(&chrono::Local)
                    .date_naive()
                    .num_days_from_ce()
            }) else {
                return;
            };
            let now = (total.total(), total.tokens());
            let delta = match u.last_total {
                // 파일의 첫 기록 — 앞 누적은 부모(포크) 몫일 수 있다. 이 응답만 센다.
                None => last.tokens(),
                // 누적이 줄었다 — 다시 이어 띄운 대화. 새 구간.
                Some((prev, _)) if now.0 < prev => {
                    u.epochs.push(Epoch::default());
                    last.tokens()
                }
                Some((_, prev)) => now.1.minus(&prev),
            };
            u.last_total = Some(now);
            if delta.total() == 0 {
                return;
            }
            let m = codex_model(u);
            let e = u.epoch();
            if !e.keyed_seen {
                e.pre.entry((day, m)).or_default().add(&delta);
            }
            e.delta.entry((day, m)).or_default().add(&delta);
        }
        _ => {}
    }
}

fn codex_model(u: &mut FileUsage) -> ModelIx {
    match u.current_model {
        Some(m) => m,
        None => u.model_ix(""),
    }
}

fn no_companions(_: &Path) -> Vec<PathBuf> {
    Vec::new()
}

fn codex_conversation_id(_: &Path, u: &FileUsage) -> Option<String> {
    u.meta_id.clone()
}

pub(crate) const CODEX_USAGE: UsageSource = UsageSource {
    needles: &[
        "token_count",
        "token_usage_record",
        "session_meta",
        "turn_context",
    ],
    line: codex_line,
    companions: no_companions,
    conversation_id: codex_conversation_id,
};

// ---------------------------------------------------------------------------
// 증분 읽기 + 캐시
// ---------------------------------------------------------------------------

struct Entry {
    agent: &'static str,
    mtime_ms: i64,
    size: u64,
    /// 다 읽은 자리(마지막 완전한 줄의 끝).
    offset: u64,
    usage: FileUsage,
}

impl Entry {
    fn fresh(agent: &'static str) -> Self {
        Entry {
            agent,
            mtime_ms: 0,
            size: 0,
            offset: 0,
            usage: FileUsage::default(),
        }
    }
}

static CACHE: LazyLock<Mutex<HashMap<PathBuf, Entry>>> = LazyLock::new(Default::default);

/// 사라진 파일의 누적을 메모리에 묵히지 않으려는 것이다 — 합계는 원래 있는 파일만 센다. `under` = Claude 의 딸린 폴더.
pub(crate) fn forget(path: &Path, under: Option<&Path>) {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.retain(|p, _| p != path && !under.is_some_and(|u| p.starts_with(u)));
}

fn wanted(finders: &[memchr::memmem::Finder<'_>], line: &[u8]) -> bool {
    finders.iter().any(|f| f.find(line).is_some())
}

fn catch_up(e: &mut Entry, st: &FileStamp, src: &UsageSource) {
    if e.size == st.size && e.mtime_ms == st.mtime_ms {
        return;
    }
    if st.size < e.offset || (st.size == e.size && e.mtime_ms != st.mtime_ms) {
        *e = Entry::fresh(e.agent);
    }
    let finders: Vec<memchr::memmem::Finder<'_>> = src
        .needles
        .iter()
        .map(|n| memchr::memmem::Finder::new(n.as_bytes()))
        .collect();
    let mut read = || -> std::io::Result<()> {
        let mut f = std::fs::File::open(&st.path)?;
        f.seek(SeekFrom::Start(e.offset))?;
        // 도장의 크기까지만 — 크기와 자리가 어긋나지 않게.
        let mut r = BufReader::with_capacity(READ_BUF, f.take(st.size - e.offset));
        let mut buf = Vec::new();
        loop {
            buf.clear();
            let n = r.read_until(b'\n', &mut buf)?;
            if n == 0 || buf.last() != Some(&b'\n') {
                break; // 끝 — 반쯤 적힌 줄은 자리를 옮기지 않는다
            }
            e.offset += n as u64;
            let line = buf
                .strip_suffix(b"\r\n")
                .or_else(|| buf.strip_suffix(b"\n"))
                .unwrap_or(&buf);
            if wanted(&finders, line) {
                (src.line)(&mut e.usage, line);
            }
        }
        Ok(())
    };
    if read().is_err() {
        // 못 읽었다 — 도장은 옛것으로 남긴다(다음에 다시).
        return;
    }
    e.size = st.size;
    e.mtime_ms = st.mtime_ms;
}

struct Job {
    stamp: FileStamp,
    src: &'static UsageSource,
    entry: Entry,
}

fn run_jobs(jobs: &mut [Job]) {
    let busy: Vec<&mut Job> = jobs
        .iter_mut()
        .filter(|j| !(j.entry.size == j.stamp.size && j.entry.mtime_ms == j.stamp.mtime_ms))
        .collect();
    if busy.is_empty() {
        return;
    }
    let threads = std::thread::available_parallelism()
        .map_or(2, |n| n.get())
        .clamp(1, MAX_THREADS)
        .min(busy.len());
    // 큰 파일부터 나눠 줘야 한 스레드가 90 MB 둘을 떠안지 않는다.
    let mut busy = busy;
    busy.sort_by_key(|j| std::cmp::Reverse(j.stamp.size.saturating_sub(j.entry.offset)));
    let mut lanes: Vec<Vec<&mut Job>> = (0..threads).map(|_| Vec::new()).collect();
    let mut load = vec![0u64; threads];
    for j in busy {
        let i = (0..threads).min_by_key(|i| load[*i]).unwrap_or(0);
        load[i] += j.stamp.size.saturating_sub(j.entry.offset);
        lanes[i].push(j);
    }
    std::thread::scope(|s| {
        for lane in lanes {
            s.spawn(move || {
                for j in lane {
                    catch_up(&mut j.entry, &j.stamp, j.src);
                }
            });
        }
    });
}

// ---------------------------------------------------------------------------
// 대화별 합
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationUsage {
    pub agent: &'static str,
    pub id: String,
    pub tokens: Tokens,
    pub total: u64,
    /// 오늘(로컬 날짜) 합.
    pub today: u64,
    /// 오늘 포함 7일 합.
    pub week: u64,
    pub subagents: bool,
    /// 화면이 "+21k" 로 적는다 — 부모 몫을 빼고 센 것이라서.
    pub forked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageScan {
    pub conversations: Vec<ConversationUsage>,
    pub files: usize,
    pub elapsed_ms: u64,
}

type ConvFiles = (
    &'static SessionTarget,
    &'static UsageSource,
    PathBuf,
    Vec<PathBuf>,
);

/// 두 명령(대화별 · 기간 요약)이 같은 캐시를 나눠 쓴다.
fn refresh(
    sources: &[(&'static SessionTarget, Vec<PathBuf>)],
) -> (
    std::sync::MutexGuard<'static, HashMap<PathBuf, Entry>>,
    Vec<ConvFiles>,
    usize,
) {
    let mut convs: Vec<ConvFiles> = Vec::new();
    let mut stamps: Vec<(FileStamp, &'static UsageSource, &'static str)> = Vec::new();
    for (t, roots) in sources {
        let Some(src) = t.usage.as_ref() else {
            continue;
        };
        let SessionSource::JsonlFiles { layout, .. } = &t.source;
        for root in roots {
            for f in sessions::candidates(layout, root) {
                let extra = (src.companions)(&f.path);
                for p in &extra {
                    if let Some(s) = sessions::stamp(p.clone()) {
                        stamps.push((s, src, t.id));
                    }
                }
                convs.push((t, src, f.path.clone(), extra));
                stamps.push((f, src, t.id));
            }
        }
    }

    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() + stamps.len() > CACHE_MAX {
        cache.clear();
    }
    let mut jobs: Vec<Job> = stamps
        .into_iter()
        .map(|(stamp, src, agent)| {
            let entry = match cache.remove(&stamp.path) {
                Some(e) if e.agent == agent => e,
                _ => Entry::fresh(agent),
            };
            Job { stamp, src, entry }
        })
        .collect();
    // 잠금을 쥔 채 읽는다 — 두 읽기가 겹치면 뒤의 것이 기다렸다가 캐시를 그대로 받는다.
    run_jobs(&mut jobs);
    let files = jobs.len();
    for j in jobs {
        cache.insert(j.stamp.path, j.entry);
    }
    (cache, convs, files)
}

fn scan(sources: &[(&'static SessionTarget, Vec<PathBuf>)]) -> UsageScan {
    let started = std::time::Instant::now();
    let (cache, convs, files) = refresh(sources);
    let today = today();
    let mut by_id: HashMap<(&'static str, String), ConversationUsage> = HashMap::new();
    for (t, src, path, extra) in convs {
        let Some(main) = cache.get(&path) else {
            continue;
        };
        let Some(id) = (src.conversation_id)(&path, &main.usage) else {
            continue;
        };
        let mut days = main.usage.days();
        let mut forked = main.usage.forked;
        for p in &extra {
            if let Some(e) = cache.get(p) {
                for (d, tk) in e.usage.days() {
                    days.entry(d).or_default().add(&tk);
                }
                forked |= e.usage.forked;
            }
        }
        let mut tokens = Tokens::default();
        let (mut today_sum, mut week_sum) = (0u64, 0u64);
        for (d, tk) in &days {
            tokens.add(tk);
            if *d == today {
                today_sum += tk.total();
            }
            if *d <= today && *d > today - 7 {
                week_sum += tk.total();
            }
        }
        // 같은 대화 id 가 파일 둘에 있으면(다시 이은 Codex 포크) 둘을 더한다.
        let slot = by_id
            .entry((t.id, id.clone()))
            .or_insert_with(|| ConversationUsage {
                agent: t.id,
                id,
                tokens: Tokens::default(),
                total: 0,
                today: 0,
                week: 0,
                subagents: false,
                forked: false,
            });
        slot.tokens.add(&tokens);
        slot.total = slot.tokens.total();
        slot.today += today_sum;
        slot.week += week_sum;
        slot.subagents |= !extra.is_empty();
        slot.forked |= forked;
    }
    let mut conversations: Vec<ConversationUsage> = by_id.into_values().collect();
    conversations.sort_by(|a, b| (a.agent, &a.id).cmp(&(b.agent, &b.id)));
    UsageScan {
        conversations,
        files,
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

// ---------------------------------------------------------------------------
// 기간 요약 — 대시보드 "사용량" 칸 (docs/log/2026-09-26-agent-usage.md)
// ---------------------------------------------------------------------------

/// 하루 — 기간의 모든 달력일이 선다(기록이 없는 날은 0).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDay {
    /// `YYYY-MM-DD`(로컬 날짜).
    pub date: String,
    pub tokens: Tokens,
    pub total: u64,
}

/// (날짜, 에이전트, 모델) 한 칸 — 기간 안의 기록이 있는 칸만.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    pub date: String,
    pub agent: &'static str,
    pub model: String,
    pub tokens: Tokens,
    pub total: u64,
}

/// 기간의 모델 한 줄 — 토큰 순.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageModel {
    pub agent: &'static str,
    pub model: String,
    pub tokens: Tokens,
    pub total: u64,
    pub conversations: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    /// 로컬 `YYYY-MM-DD`.
    pub today: String,
    pub start: String,
    /// 기록이 시작된 날(거르개의 에이전트 기준 · 전체 이력) — 없으면 `None`.
    pub first_day: Option<String>,
    /// 기록이 하나라도 있는 에이전트(거르개와 무관 — 칩은 있는 것만 선다).
    pub agents: Vec<&'static str>,
    /// 기간의 달력일 전부(첫날 → 오늘).
    pub daily: Vec<UsageDay>,
    /// 기간과 무관한 최근 [`RECENT_DAYS`] 달력일 — 사용 잔디는 늘 이만큼을 그린다.
    pub recent: Vec<UsageDay>,
    /// (날짜, 에이전트, 모델) 칸 — 기간과 최근 [`RECENT_DAYS`] 일 중 **긴 쪽**(잔디에서 기간 밖의 날을 골라도 풀이가 선다).
    pub buckets: Vec<UsageBucket>,
    pub models: Vec<UsageModel>,
    /// 오늘부터 거꾸로 세어 토큰이 있는 날이 이어진 수(오늘이 비면 0) — 기간과 무관.
    pub streak: u32,
    /// 오늘 앞 최대 7 달력일(기록이 시작된 뒤만)의 하루 평균 — 없으면 `None`.
    pub prior_avg: Option<f64>,
    pub prior_days: u32,
    pub elapsed_ms: u64,
    /// 원격 호스트마다 덮개 — 이 PC 만이면 비었다.
    pub remote: Vec<RemoteCoverage>,
}

/// 아직 세지 못한 파일 = 머리 한 번에 다 오지 않은 큰 대화(사람이 [전체 사용량 읽기] 를 누르면 선다).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCoverage {
    pub host: String,
    pub counted: u32,
    /// 아직 못 센 대화 파일 수(에이전트별) · 그 바이트 합(남은 몫).
    pub pending_claude: u32,
    pub pending_codex: u32,
    pub pending_bytes: u64,
    /// 이 PC 의 epoch ms — 없으면 아직 읽지 않았다.
    pub read_at: Option<i64>,
}

/// 다섯 주 — Claude Code 가 기본으로 30일이 지난 대화 기록을 지워(`cleanupPeriodDays`) 그보다 긴 이력은 뜻이 없다.
const RECENT_DAYS: Day = 35;

fn date_str(d: Day) -> String {
    chrono::NaiveDate::from_num_days_from_ce_opt(d)
        .map_or_else(String::new, |n| n.format("%Y-%m-%d").to_string())
}

/// 로컬 캐시와 원격 캐시(`agent_sessions_remote`)가 같은 모양으로 넘긴다 — 셈의 규칙은 [`summarize_files`] 한 곳이다.
pub(crate) type SummaryFile<'a> = (&'static str, String, &'a FileUsage);

/// 몸통 — `period` 는 기간의 날 수(`None` = 기록 전체), `agent` 는 거르개(`None` = 전체).
fn summarize(
    sources: &[(&'static SessionTarget, Vec<PathBuf>)],
    period: Option<u32>,
    agent: Option<&str>,
    today: Day,
) -> UsageSummary {
    let started = std::time::Instant::now();
    let (cache, convs, _) = refresh(sources);
    let files = local_files(&cache, &convs);
    let mut s = summarize_files(files, period, agent, today);
    s.elapsed_ms = started.elapsed().as_millis() as u64;
    s
}

fn local_files<'a>(
    cache: &'a HashMap<PathBuf, Entry>,
    convs: &'a [ConvFiles],
) -> Vec<SummaryFile<'a>> {
    let mut out = Vec::new();
    for (t, src, path, extra) in convs {
        let Some(main) = cache.get(path) else {
            continue;
        };
        let conv = (src.conversation_id)(path, &main.usage)
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        for f in std::iter::once(path).chain(extra.iter()) {
            if let Some(e) = cache.get(f) {
                out.push((t.id, conv.clone(), &e.usage));
            }
        }
    }
    out
}

pub(crate) fn summarize_files(
    files: Vec<SummaryFile<'_>>,
    period: Option<u32>,
    agent: Option<&str>,
    today: Day,
) -> UsageSummary {
    let mut all_days: BTreeMap<Day, Tokens> = BTreeMap::new();
    let mut agents: Vec<&'static str> = Vec::new();
    let mut cells: BTreeMap<(Day, &'static str, String), Tokens> = BTreeMap::new();
    let mut model_convs: HashMap<(&'static str, String), std::collections::HashSet<(Day, String)>> =
        HashMap::new();
    for (aid, conv, usage) in &files {
        for ((d, m), tk) in usage.buckets() {
            if tk.total() == 0 {
                continue;
            }
            if !agents.contains(aid) {
                agents.push(aid);
            }
            if agent.is_some_and(|a| a != *aid) {
                continue;
            }
            all_days.entry(d).or_default().add(&tk);
            let model = usage.model_name(m).to_owned();
            model_convs
                .entry((aid, model.clone()))
                .or_default()
                .insert((d, conv.clone()));
            cells.entry((d, aid, model)).or_default().add(&tk);
        }
    }
    // 표의 순서로 — 칩 순서가 흔들리지 않게
    agents.sort_by_key(|a| TARGETS.iter().position(|t| t.id == *a));

    let first = all_days.keys().next().copied();
    let start = match period {
        Some(n) => today - (n.clamp(1, 3660) as Day - 1),
        None => first.unwrap_or(today).min(today),
    };
    let day_row = |d: Day| {
        let tokens = all_days.get(&d).copied().unwrap_or_default();
        UsageDay {
            date: date_str(d),
            tokens,
            total: tokens.total(),
        }
    };
    let daily: Vec<UsageDay> = (start..=today).map(day_row).collect();
    let recent: Vec<UsageDay> = (today - (RECENT_DAYS - 1)..=today).map(day_row).collect();
    let bucket_start = start.min(today - (RECENT_DAYS - 1));
    let mut buckets: Vec<UsageBucket> = Vec::new();
    let mut models: HashMap<(&'static str, String), (Tokens, std::collections::HashSet<String>)> =
        HashMap::new();
    for ((d, a, m), tk) in cells.range((bucket_start, "", String::new())..) {
        if *d > today {
            continue;
        }
        buckets.push(UsageBucket {
            date: date_str(*d),
            agent: a,
            model: m.clone(),
            tokens: *tk,
            total: tk.total(),
        });
        if *d >= start {
            models.entry((*a, m.clone())).or_default().0.add(tk);
        }
    }
    for ((a, m), slot) in models.iter_mut() {
        if let Some(set) = model_convs.get(&(*a, m.clone())) {
            slot.1 = set
                .iter()
                .filter(|(d, _)| *d >= start && *d <= today)
                .map(|(_, c)| c.clone())
                .collect();
        }
    }
    let mut models: Vec<UsageModel> = models
        .into_iter()
        .map(|((a, m), (tk, convs))| UsageModel {
            agent: a,
            model: m,
            tokens: tk,
            total: tk.total(),
            conversations: convs.len() as u32,
        })
        .collect();
    models.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.model.cmp(&b.model)));

    let mut streak = 0u32;
    let mut d = today;
    while all_days.get(&d).is_some_and(|t| t.total() > 0) {
        streak += 1;
        d -= 1;
    }
    // 기록이 시작된 뒤만 — 설치 전 빈 날을 0 으로 넣으면 첫 며칠의 "평균 대비" 가 부푼다
    let prior: Vec<u64> = match first {
        Some(f) => ((today - 7).max(f)..today)
            .map(|d| all_days.get(&d).map_or(0, Tokens::total))
            .collect(),
        None => Vec::new(),
    };
    let prior_avg =
        (!prior.is_empty()).then(|| prior.iter().sum::<u64>() as f64 / prior.len() as f64);

    UsageSummary {
        today: date_str(today),
        start: date_str(start),
        first_day: first.map(date_str),
        agents,
        daily,
        recent,
        buckets,
        models,
        streak,
        prior_avg,
        prior_days: prior.len() as u32,
        elapsed_ms: 0,
        remote: Vec::new(),
    }
}

fn all_sources() -> Vec<(&'static SessionTarget, Vec<PathBuf>)> {
    TARGETS.iter().map(|t| (t, (t.roots)())).collect()
}

/// `days` = 기간의 날 수(없으면 기록 전체) · `agent` = 에이전트 거르개 · `local`(기본 참) = 이 PC 를 넣나 · `hosts` = 넣을 원격
/// 별칭들. 원격 몫은 **이미 읽어 둔 캐시에서만** 온다(여기서는 서버에 묻지 않는다).
#[tauri::command]
pub async fn agent_usage_summary(
    days: Option<u32>,
    agent: Option<String>,
    local: Option<bool>,
    hosts: Option<Vec<String>>,
) -> Result<UsageSummary, String> {
    let local = local.unwrap_or(true);
    let hosts = hosts.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        if hosts.is_empty() {
            let sources = if local { all_sources() } else { Vec::new() };
            return summarize(&sources, days, agent.as_deref(), today());
        }
        summarize_with_hosts(local, &hosts, days, agent.as_deref(), today())
    })
    .await
    .map_err(|e| e.to_string())
}

/// 잠금 순서는 늘 로컬 캐시 → 원격 캐시(원격 쪽은 로컬 캐시를 잡지 않는다).
fn summarize_with_hosts(
    local: bool,
    hosts: &[String],
    period: Option<u32>,
    agent: Option<&str>,
    today: Day,
) -> UsageSummary {
    let started = std::time::Instant::now();
    let sources = if local { all_sources() } else { Vec::new() };
    let (cache, convs, _) = refresh(&sources);
    let mine = if local {
        local_files(&cache, &convs)
    } else {
        Vec::new()
    };
    let mut s = crate::agent_sessions_remote::with_usage_files(hosts, |remote, coverage| {
        let mut files: Vec<SummaryFile<'_>> = mine.to_vec();
        files.extend(remote);
        let mut s = summarize_files(files, period, agent, today);
        s.remote = coverage;
        s
    });
    s.elapsed_ms = started.elapsed().as_millis() as u64;
    s
}

// ---------------------------------------------------------------------------
// 원격 판이 빌려 쓰는 것 — 같은 줄 파서 · 같은 셈
// ---------------------------------------------------------------------------

/// 원격 전체 읽기는 서버에서 이 바늘로 줄을 걸러 받는다.
pub(crate) fn needles_of(agent: &str) -> &'static [&'static str] {
    match sessions::target(agent).ok().and_then(|t| t.usage.as_ref()) {
        Some(src) => src.needles,
        None => &[],
    }
}

/// 답 = 먹은 바이트(마지막 줄바꿈까지). 끝의 반쯤 온 줄은 먹지 않는다(로컬 `catch_up` 과 같은 규칙).
pub(crate) fn feed_lines(agent: &str, u: &mut FileUsage, bytes: &[u8]) -> u64 {
    let Some(src) = sessions::target(agent).ok().and_then(|t| t.usage.as_ref()) else {
        return 0;
    };
    let finders: Vec<memchr::memmem::Finder<'_>> = src
        .needles
        .iter()
        .map(|n| memchr::memmem::Finder::new(n.as_bytes()))
        .collect();
    let Some(end) = bytes.iter().rposition(|b| *b == b'\n') else {
        return 0;
    };
    for raw in bytes[..end].split(|b| *b == b'\n') {
        let line = raw.strip_suffix(b"\r").unwrap_or(raw);
        if wanted(&finders, line) {
            (src.line)(u, line);
        }
    }
    end as u64 + 1
}

pub(crate) fn file_tokens(u: &FileUsage) -> Tokens {
    let mut t = Tokens::default();
    for tk in u.buckets().values() {
        t.add(tk);
    }
    t
}

/// `(잰 시각 ms, 칸들)`. 로컬 `codex_rollout_limits` 와 같은 풀이.
pub(crate) fn codex_limits_in(bytes: &[u8]) -> Option<(i64, Vec<LimitWindow>)> {
    let mut u = FileUsage::default();
    // 누적 칸을 흉내 내지 않게 줄마다 새 판으로 — 한도만 본다.
    for line in bytes.split(|b| *b == b'\n') {
        if memchr::memmem::find(line, b"rate_limits").is_none() {
            continue;
        }
        u.last_total = None;
        codex_line(&mut u, line);
    }
    u.limits.map(|l| (l.at_ms, l.windows))
}

/// Claude 는 싣지 않는다 — 한도 파일은 이 PC 의 것.
pub(crate) fn remote_codex_limits(snap: Option<(i64, Vec<LimitWindow>)>) -> AgentLimits {
    match snap {
        Some((at, windows)) => AgentLimits {
            agent: "codex",
            windows,
            measured_at: Some(at),
            seen: true,
        },
        None => AgentLimits {
            agent: "codex",
            windows: Vec::new(),
            measured_at: None,
            seen: false,
        },
    }
}

/// 목록(`agent_sessions_list`)과 **따로** 부른다 — 목록은 앞 · 꼬리만 읽어 빠르고, 이것은 첫 호출에 파일 전체를 읽는다.
#[tauri::command]
pub async fn agent_usage_scan() -> Result<UsageScan, String> {
    tauri::async_runtime::spawn_blocking(|| scan(&all_sources()))
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 한도 %
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLimits {
    pub agent: &'static str,
    /// 비었으면 아직 값이 없다 — 숫자를 지어내지 않는다.
    pub windows: Vec<LimitWindow>,
    /// epoch ms
    pub measured_at: Option<i64>,
    /// 이 PC 에서 그 에이전트를 본 적이 있나(대화 루트 폴더가 있다) — 값이 없어도 상태바에 빈 고리를 세울지.
    pub seen: bool,
}

/// Codex — 최신 롤아웃 몇 개의 꼬리에서 `rate_limits` 가 든 마지막 `token_count`(줄 시각이 가장 늦은 것).
fn codex_rollout_limits(layout: &Layout, roots: &[PathBuf]) -> Option<LimitSnap> {
    let mut best: Option<LimitSnap> = None;
    for root in roots {
        for f in sessions::candidates(layout, root)
            .into_iter()
            .take(LIMIT_FILES)
        {
            let Ok(bytes) = sessions::read_tail(&f.path, LIMIT_TAIL_BYTES) else {
                continue;
            };
            if let Some((at_ms, windows)) = codex_limits_in(&bytes) {
                if best.as_ref().is_none_or(|b| b.at_ms < at_ms) {
                    best = Some(LimitSnap { at_ms, windows });
                }
            }
        }
    }
    best
}

fn limits_of(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    claude_file: Option<&Path>,
) -> AgentLimits {
    let snap = match t.limits {
        LimitSource::HelperFile => claude_file
            .and_then(crate::claude_usage::read_limits_file)
            .map(|f| LimitSnap {
                at_ms: f.measured_at,
                windows: f.windows,
            }),
        LimitSource::RolloutTail => {
            let SessionSource::JsonlFiles { layout, .. } = &t.source;
            codex_rollout_limits(layout, roots)
        }
    };
    let seen = roots.iter().any(|r| r.is_dir());
    match snap {
        Some(s) => AgentLimits {
            agent: t.id,
            windows: s.windows,
            measured_at: Some(s.at_ms),
            seen: true,
        },
        None => AgentLimits {
            agent: t.id,
            windows: Vec::new(),
            measured_at: None,
            seen,
        },
    }
}

/// 싸다(파일 한 개 + 꼬리 몇 개) — 대시보드 에이전트 칸이 보이는 동안 1분마다 부른다.
#[tauri::command]
pub async fn agent_usage_limits() -> Result<Vec<AgentLimits>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let file = crate::claude_usage::limits_path();
        TARGETS
            .iter()
            .map(|t| limits_of(t, &(t.roots)(), file.as_deref()))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
