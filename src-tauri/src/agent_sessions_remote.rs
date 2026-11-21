//! 원격 에이전트 대화 — SSH 로 붙은 서버에 남은 Claude Code · Codex 대화를 로컬과 같은 모양의 줄로 읽는다 (docs/log/2026-09-27-remote-conversations.md).
//!
//! 새 접속을 열지 않는다 — 이미 살아 있는 타일 세션의 전송로 위에 exec 채널을 얹는다. 화면이 넘긴 세션 번호가 타일 세션이 아니면(없거나 헤드리스)
//! 읽지 않고, 캐시 열쇠는 화면이 넘긴 이름이 아니라 그 세션이 붙은 별칭이다.
//! 경로는 서버가 준 목록의 것으로 그 루트 아래 `*.jsonl` 만 받고 명령에는 [`crate::ssh::sh_quote`] 로만 들어간다. 대화 본문에서 온 글자는 명령에 들어가지 않는다.
//! 캐시는 메모리에만 있고 서버에도 이 PC 에도 아무것도 쓰지 않는다. 이 모듈의 자료형은 `Debug` 를 파생하지 않는다.
//! "밖에서 열림" 은 서버의 시계로 재야 한다 — 목록 exec 이 서버의 지금을 함께 찍고 그 차이만큼 mtime 을 옮겨 `updatedAt` 으로 낸다.
//! 루트의 `CLAUDE_CONFIG_DIR` · `CODEX_HOME` 은 exec 셸의 환경에 있을 때만 따른다(대화형 설정 파일에서만 거는 값은 보이지 않는다).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::agent_sessions::{
    self as local, AgentSession, LaunchSpec, Parsed, SessionSource, SessionTarget,
};
use crate::i18n::tr;

const MAX_FILES: usize = 300;
const LIST_MAX_BYTES: usize = 1024 * 1024;
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const BATCH_MAX_FILES: usize = 40;
const BATCH_MAX_BYTES: u64 = 6 * 1024 * 1024;
const CALL_BUDGET: Duration = Duration::from_secs(4);
const FRESH: Duration = Duration::from_secs(60);
/// 꼬리 바이트 — 로컬과 같다(`agent_sessions::TAIL_BYTES`).
const TAIL_BYTES: u64 = 64 * 1024;
const INDEX_TAIL_BYTES: u64 = 256 * 1024;
const CWDS_MAX: usize = 256;

// ── 1. 목록 ──

#[derive(Clone, PartialEq)]
pub(crate) struct Listed {
    /// `"claude"` · `"codex"` · `"index"`(Codex 이름표)
    pub agent: &'static str,
    pub size: u64,
    /// 서버 시계의 mtime(epoch ms).
    pub mtime_ms: i64,
    pub path: String,
}

#[derive(Clone, PartialEq)]
pub(crate) struct Listing {
    /// 서버의 지금(epoch 초) — 못 읽었으면 `None`(시계 보정 없음).
    pub now_s: Option<i64>,
    pub home: Option<String>,
    pub files: Vec<Listed>,
    pub index: Option<Listed>,
}

/// `sh -c` 로 감싼다 — 로그인 셸이 fish 여도 같은 뜻이다.
pub(crate) fn list_command() -> String {
    let script = format!(
        r#"C="${{CLAUDE_CONFIG_DIR:-$HOME/.claude}}/projects"; XH="${{CODEX_HOME:-$HOME/.codex}}"; X="$XH/sessions"
printf 'N %s\nH %s\nC %s\nX %s\n' "$(date +%s)" "$HOME" "$C" "$X"
if find / -maxdepth 0 -printf '' >/dev/null 2>&1; then
L() {{ t=$1; shift; find "$@" -type f -printf "$t %s %T@ %p\n" 2>/dev/null; }}
elif stat -c %s / >/dev/null 2>&1; then
L() {{ t=$1; shift; find "$@" -type f -exec stat -c "$t %s %Y %n" {{}} + 2>/dev/null; }}
else
L() {{ t=$1; shift; find "$@" -type f -exec stat -f "$t %z %m %N" {{}} + 2>/dev/null; }}
fi
{{ if [ -d "$C" ]; then L c "$C" -mindepth 2 -maxdepth 2 -name '*.jsonl'; fi; if [ -d "$X" ]; then L x "$X" -mindepth 4 -maxdepth 4 -name 'rollout-*.jsonl'; fi; }} | LC_ALL=C sort -k3,3 -rn | head -n {max}
if [ -f "$XH/session_index.jsonl" ]; then L i "$XH" -maxdepth 1 -name session_index.jsonl; fi
exit 0"#,
        max = MAX_FILES
    );
    format!("sh -c {}", crate::ssh::sh_quote(&script))
}

fn clean_path(p: &str) -> bool {
    p.starts_with('/') && !p.chars().any(char::is_control) && !p.split('/').any(|seg| seg == "..")
}

fn under(root: &str, path: &str, depth: usize) -> bool {
    let root = root.trim_end_matches('/');
    match path.strip_prefix(root).and_then(|r| r.strip_prefix('/')) {
        Some(rest) => rest.split('/').count() == depth && rest.split('/').all(|s| !s.is_empty()),
        None => false,
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

pub(crate) fn parse_listing(out: &str) -> Option<Listing> {
    let mut now_s = None;
    let mut home = None;
    let mut claude_root: Option<String> = None;
    let mut codex_root: Option<String> = None;
    let mut files = Vec::new();
    let mut index = None;
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        let Some((tag, rest)) = line.split_once(' ') else {
            continue;
        };
        match tag {
            "N" => now_s = rest.trim().parse::<i64>().ok(),
            "H" => home = crate::ssh::parse_remote_home(rest),
            "C" if clean_path(rest) => claude_root = Some(rest.trim_end_matches('/').to_string()),
            "X" if clean_path(rest) => codex_root = Some(rest.trim_end_matches('/').to_string()),
            "c" | "x" | "i" => {
                let mut parts = rest.splitn(3, ' ');
                let (Some(size), Some(mtime), Some(path)) =
                    (parts.next(), parts.next(), parts.next())
                else {
                    continue;
                };
                let (Ok(size), Ok(mtime)) = (size.parse::<u64>(), mtime.parse::<f64>()) else {
                    continue;
                };
                if !clean_path(path)
                    || !path.to_ascii_lowercase().ends_with(".jsonl")
                    || !mtime.is_finite()
                {
                    continue;
                }
                let listed = |agent| Listed {
                    agent,
                    size,
                    mtime_ms: (mtime * 1000.0) as i64,
                    path: path.to_string(),
                };
                match (tag, claude_root.as_deref(), codex_root.as_deref()) {
                    ("c", Some(root), _) if under(root, path, 2) => files.push(listed("claude")),
                    ("x", _, Some(root))
                        if under(root, path, 4) && file_name(path).starts_with("rollout-") =>
                    {
                        files.push(listed("codex"))
                    }
                    ("i", _, Some(root)) => {
                        let parent = root.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
                        if path == format!("{parent}/session_index.jsonl") {
                            index = Some(listed("index"));
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    claude_root.as_ref()?;
    codex_root.as_ref()?;
    files.sort_by_key(|f| std::cmp::Reverse(f.mtime_ms));
    files.truncate(MAX_FILES);
    Some(Listing {
        now_s,
        home,
        files,
        index,
    })
}

// ── 2. 머리 · 꼬리 ──

/// `head` · `tail` 이 0 이면 그쪽은 읽지 않는다.
#[derive(Clone, PartialEq)]
pub(crate) struct FetchItem {
    pub path: String,
    pub head: u64,
    pub tail: u64,
}

fn head_bytes(t: &SessionTarget) -> u64 {
    let SessionSource::JsonlFiles { head_bytes, .. } = &t.source;
    *head_bytes
}

/// 로컬 `read_chunk` 와 같은 범위다.
pub(crate) fn fetch_item(f: &Listed) -> FetchItem {
    if f.agent == "index" {
        return FetchItem {
            path: f.path.clone(),
            head: 0,
            tail: INDEX_TAIL_BYTES,
        };
    }
    let head = local::target(f.agent).map(head_bytes).unwrap_or(64 * 1024);
    // 꼬리는 로컬처럼 한 바이트 더 — 꼬리의 첫 줄은 잘린 줄로 버려지므로, 꼬리가 줄 첫머리에서 시작하면 온전한 줄 하나를 잃는다.
    let tail = if f.size > head {
        (TAIL_BYTES + 1).min(f.size - head + 1)
    } else {
        0
    };
    FetchItem {
        path: f.path.clone(),
        head,
        tail,
    }
}

fn item_bound(i: &FetchItem) -> u64 {
    i.head + i.tail + 64
}

/// 대화 파일의 줄은 JSON(`{` 로 시작)이라 표식 줄과 섞이지 않는다 — 부를 때마다 새 표식이라 더 그렇다.
/// 표식 앞의 줄바꿈은 우리가 넣은 것이라 가를 때 떼어 낸다([`parse_fetch`]).
pub(crate) fn fetch_command(nonce: &str, items: &[FetchItem]) -> String {
    let mut script = String::new();
    for (i, it) in items.iter().enumerate() {
        let p = crate::ssh::sh_quote(&it.path);
        if it.head > 0 {
            script.push_str(&format!(
                "printf '\\n{nonce} {i} H\\n'; head -c {} {p} 2>/dev/null; ",
                it.head
            ));
        }
        if it.tail > 0 {
            script.push_str(&format!(
                "printf '\\n{nonce} {i} T\\n'; tail -c {} {p} 2>/dev/null; ",
                it.tail
            ));
        }
    }
    script.push_str(&format!("printf '\\n{nonce} END\\n'"));
    format!("sh -c {}", crate::ssh::sh_quote(&script))
}

#[derive(Default, Clone, PartialEq)]
pub(crate) struct Fetched {
    pub head: Option<Vec<u8>>,
    pub tail: Option<Vec<u8>>,
}

/// 끝이 잘렸으면(시한 · 상한) 마지막 조각은 버린다 — 반쯤 온 조각을 온전한 것으로 믿지 않는다.
pub(crate) fn parse_fetch(nonce: &str, out: &[u8]) -> (HashMap<usize, Fetched>, bool) {
    let (pieces, complete) = split_marked(nonce, out);
    let mut got: HashMap<usize, Fetched> = HashMap::new();
    for (label, body) in pieces {
        let mut parts = label.split(' ');
        let (Some(i), Some(which)) = (
            parts.next().and_then(|s| s.parse::<usize>().ok()),
            parts.next(),
        ) else {
            continue;
        };
        let e = got.entry(i).or_default();
        match which {
            "H" => e.head = Some(body.to_vec()),
            "T" => e.tail = Some(body.to_vec()),
            _ => {}
        }
    }
    (got, complete)
}

/// 다음 표식이 없는 마지막 조각은 잘린 것이라 버린다.
pub(crate) fn split_marked<'a>(nonce: &str, out: &'a [u8]) -> (Vec<(String, &'a [u8])>, bool) {
    let needle = format!("\n{nonce} ");
    let finder = memchr::memmem::Finder::new(needle.as_bytes());
    let marks: Vec<usize> = finder.find_iter(out).collect();
    let mut pieces = Vec::new();
    for (k, &m) in marks.iter().enumerate() {
        let head_start = m + needle.len();
        let Some(nl) = out[head_start..].iter().position(|b| *b == b'\n') else {
            break;
        };
        let label = String::from_utf8_lossy(&out[head_start..head_start + nl]).into_owned();
        let body_start = head_start + nl + 1;
        if label == "END" {
            return (pieces, true);
        }
        let Some(&next) = marks.get(k + 1) else { break };
        pieces.push((label, out.get(body_start..next).unwrap_or_default()));
    }
    (pieces, false)
}

fn fetched_whole(it: &FetchItem, f: &Fetched) -> bool {
    (it.head == 0 || f.head.is_some()) && (it.tail == 0 || f.tail.is_some())
}

pub(crate) fn codex_tokens(lines: &[Value]) -> Option<u64> {
    lines.iter().rev().find_map(|v| {
        if v["type"] != "event_msg" || v["payload"]["type"] != "token_count" {
            return None;
        }
        let u = &v["payload"]["info"]["total_token_usage"];
        let input = u["input_tokens"].as_u64()?;
        Some(input + u["output_tokens"].as_u64().unwrap_or(0))
    })
}

/// 로컬과 같은 다듬기(`chunk_from_parts`) · 같은 파서.
pub(crate) fn parse_fetched(f: &Listed, got: Fetched) -> (Option<Parsed>, Option<u64>) {
    let Ok(t) = local::target(f.agent) else {
        return (None, None);
    };
    let SessionSource::JsonlFiles { parse, .. } = &t.source;
    let name = file_name(&f.path);
    let stem = name
        .strip_suffix(".jsonl")
        .or_else(|| name.strip_suffix(".JSONL"))
        .unwrap_or(name)
        .to_string();
    let chunk = local::chunk_from_parts(stem, got.head.unwrap_or_default(), got.tail);
    let tokens = if f.agent == "codex" {
        codex_tokens(if chunk.tail.is_empty() {
            &chunk.head
        } else {
            &chunk.tail
        })
    } else {
        None
    };
    (parse(&chunk), tokens)
}

/// 셈은 머리 한 번에 파일 전체가 온 때만 선다 — 큰 파일은 머리 · 꼬리 사이를 모르므로 세지 않는다.
fn usage_from_fetch(
    f: &Listed,
    it: &FetchItem,
    got: &Fetched,
) -> (
    Option<RemoteUsage>,
    Option<(i64, Vec<crate::agent_usage::LimitWindow>)>,
) {
    let head = got.head.as_deref().unwrap_or_default();
    let whole = it.tail == 0
        && got.head.is_some()
        && ((head.len() as u64) < it.head || head.len() as u64 == f.size);
    let usage = whole.then(|| {
        let mut u = RemoteUsage::fresh();
        u.offset = crate::agent_usage::feed_lines(f.agent, &mut u.file, head);
        u
    });
    let limits = if f.agent == "codex" {
        crate::agent_usage::codex_limits_in(got.tail.as_deref().unwrap_or(head))
    } else {
        None
    };
    (usage, limits)
}

pub(crate) fn parse_index(f: &Listed, got: Fetched) -> HashMap<String, String> {
    let mut bytes = got.tail.unwrap_or_default();
    if f.size > INDEX_TAIL_BYTES {
        let cut = bytes
            .iter()
            .position(|b| *b == b'\n')
            .map_or(bytes.len(), |i| i + 1);
        bytes.drain(..cut);
    }
    local::codex_titles_from(&bytes)
}

/// 제어 문자가 든 폴더는 묻지 않는다.
pub(crate) fn exists_command(cwds: &[String]) -> String {
    let mut script = String::from("for d in");
    for c in cwds {
        script.push(' ');
        script.push_str(&crate::ssh::sh_quote(c));
    }
    script.push_str("; do [ -d \"$d\" ] && printf '%s\\n' \"$d\"; done; exit 0");
    format!("sh -c {}", crate::ssh::sh_quote(&script))
}

// ── 캐시 — 별칭마다, 메모리에만 ──

struct Entry {
    size: u64,
    mtime_ms: i64,
    agent: &'static str,
    /// `None` = 대화가 아니거나 못 읽었다 — 파일이 바뀌기 전까지 다시 읽지 않는다.
    parsed: Option<Arc<Parsed>>,
    tokens: Option<u64>,
    usage: Option<RemoteUsage>,
    /// Codex 롤아웃 꼬리의 가장 늦은 요금제 한도 — `(잰 시각 ms, 칸들)`.
    limits: Option<(i64, Vec<crate::agent_usage::LimitWindow>)>,
}

struct RemoteUsage {
    /// 다 읽은 자리(마지막 온전한 줄의 끝).
    offset: u64,
    file: crate::agent_usage::FileUsage,
    chunk: u64,
    stalls: u32,
    /// 더 읽을 수 없다(아주 긴 한 줄 · 서버가 거듭 끊음) — 파일이 바뀌기 전까지 다시 조르지 않는다.
    broken: bool,
}

impl RemoteUsage {
    fn fresh() -> Self {
        RemoteUsage {
            offset: 0,
            file: Default::default(),
            chunk: USAGE_CHUNK_START,
            stalls: 0,
            broken: false,
        }
    }
}

#[derive(Default)]
struct HostCache {
    /// 목록과 그것을 뽑은 때(이 PC 의 시계 — 단조 · epoch ms).
    listing: Option<(Instant, i64, Listing)>,
    files: HashMap<String, Entry>,
    /// 이름표 — 읽은 파일의 (크기, mtime) 와 함께.
    titles: Option<(u64, i64, HashMap<String, String>)>,
    exists: HashMap<String, bool>,
}

static HOSTS: LazyLock<Mutex<HashMap<String, HostCache>>> = LazyLock::new(Default::default);
/// 별칭마다 한 번에 하나씩 — 시작 화면과 고르는 목록이 함께 불러도 같은 파일을 두 번 읽지 않는다.
static GATES: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(Default::default);

fn key_of(alias: &str) -> String {
    alias.trim().to_ascii_lowercase()
}

fn gate(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut g = GATES.lock().unwrap_or_else(|e| e.into_inner());
    Arc::clone(g.entry(key.to_string()).or_default())
}

fn with_hosts<R>(f: impl FnOnce(&mut HashMap<String, HostCache>) -> R) -> R {
    let mut h = HOSTS.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut h)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 대화 파일은 덧붙기만 하므로 자랐으면 센 자리부터 이어 센다(로컬 `catch_up` 과 같은 규칙). 줄었거나 다시 쓴 파일이면 버린다.
fn carried_usage(old: Option<Entry>, f: &Listed) -> Option<RemoteUsage> {
    let old = old?;
    let mut u = old.usage?;
    if old.agent != f.agent
        || f.size < u.offset
        || (f.size == old.size && f.mtime_ms != old.mtime_ms)
    {
        return None;
    }
    if f.size != old.size {
        u.broken = false;
        u.stalls = 0;
    }
    Some(u)
}

fn stale(cache: &HostCache, f: &Listed) -> bool {
    match cache.files.get(&f.path) {
        Some(e) => e.size != f.size || e.mtime_ms != f.mtime_ms || e.agent != f.agent,
        None => true,
    }
}

fn index_stale(cache: &HostCache, idx: &Listed) -> bool {
    !matches!(&cache.titles, Some((s, m, _)) if *s == idx.size && *m == idx.mtime_ms)
}

fn pending(cache: &HostCache, listing: &Listing) -> Vec<Listed> {
    let mut out = Vec::new();
    if let Some(idx) = &listing.index {
        if index_stale(cache, idx) {
            out.push(idx.clone());
        }
    }
    out.extend(listing.files.iter().filter(|f| stale(cache, f)).cloned());
    out
}

/// 적어도 하나는 담는다.
pub(crate) fn next_batch(pending: &[Listed]) -> Vec<(Listed, FetchItem)> {
    let mut out = Vec::new();
    let mut bytes = 0u64;
    for f in pending {
        let it = fetch_item(f);
        let b = item_bound(&it);
        if !out.is_empty() && (out.len() >= BATCH_MAX_FILES || bytes + b > BATCH_MAX_BYTES) {
            break;
        }
        bytes += b;
        out.push((f.clone(), it));
    }
    out
}

fn nonce() -> String {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("@@aynx{:x}{:x}", now_ms(), n)
}

// ── 화면이 받는 것 ──

/// `Debug` 없음.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSession {
    #[serde(flatten)]
    pub session: AgentSession,
    pub host: String,
    /// 끝까지 센 파일이면 그 합, 아니면 Codex 꼬리의 누적(입력 + 출력), 모르면 `None`.
    pub tokens: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionList {
    pub host: String,
    pub sessions: Vec<RemoteSession>,
    pub total: usize,
    pub done: usize,
    pub complete: bool,
    /// 목록을 뽑은 때(이 PC 의 epoch ms).
    pub read_at: i64,
    pub home: Option<String>,
}

fn row_tokens(e: &Entry, size: u64) -> Option<u64> {
    let u = e.usage.as_ref().filter(|u| u.offset >= size)?;
    Some(crate::agent_usage::file_tokens(&u.file).total())
}

/// 잠금 안에서만 부른다.
fn rows_of(host: &str, cache: &HostCache, listing: &Listing, skew_ms: i64) -> Vec<RemoteSession> {
    let empty = HashMap::new();
    let titles = cache.titles.as_ref().map(|(_, _, t)| t).unwrap_or(&empty);
    let mut seen: HashSet<(&'static str, String)> = HashSet::new();
    let mut out = Vec::new();
    for f in &listing.files {
        let Some(e) = cache.files.get(&f.path) else {
            continue;
        };
        if e.size != f.size || e.mtime_ms != f.mtime_ms {
            continue;
        }
        let Some(p) = &e.parsed else { continue };
        let Ok(t) = local::target(f.agent) else {
            continue;
        };
        if !seen.insert((t.id, p.id.clone())) {
            continue;
        }
        let exists = cache.exists.get(&p.cwd).copied().unwrap_or(true);
        let custom = if t.id == "codex" {
            titles.get(&p.id)
        } else {
            None
        };
        out.push(RemoteSession {
            session: local::record(t, p, f.mtime_ms + skew_ms, custom, exists),
            host: host.to_string(),
            tokens: row_tokens(e, f.size).or(e.tokens),
        });
    }
    out
}

fn exec_failure(r: &crate::ssh::ExecBytes, secs: u64) -> Option<String> {
    if let Some(e) = &r.error {
        return Some(e.clone());
    }
    if r.timed_out && r.stdout.is_empty() {
        return Some(tr!(
            ko: "서버가 {secs}초 안에 답하지 않았습니다",
            en: "The server did not answer within {secs} seconds",
            secs = secs
        ));
    }
    None
}

async fn ensure_listing(
    handle: &crate::ssh::ExecHandle,
    key: &str,
    force: bool,
) -> Result<(), String> {
    let fresh = with_hosts(|h| {
        h.get(key)
            .and_then(|c| c.listing.as_ref())
            .is_some_and(|(at, _, _)| at.elapsed() < FRESH)
    });
    if fresh && !force {
        return Ok(());
    }
    let r = crate::ssh::run_exec_bytes(
        handle.clone(),
        list_command(),
        LIST_TIMEOUT,
        LIST_MAX_BYTES,
    )
    .await;
    if let Some(e) = exec_failure(&r, LIST_TIMEOUT.as_secs()) {
        return Err(e);
    }
    let text = String::from_utf8_lossy(&r.stdout);
    let Some(listing) = parse_listing(&text) else {
        let line = r.stderr.trim();
        return Err(if line.is_empty() {
            tr!(ko: "서버의 대화 목록을 읽지 못했습니다", en: "Could not read the server's conversation list")
        } else {
            line.lines().next().unwrap_or(line).to_string()
        });
    };
    with_hosts(|h| {
        let c = h.entry(key.to_string()).or_default();
        // 목록에서 빠진 파일은 잊는다(캐시가 목록 크기를 넘지 않게)
        let keep: HashSet<&str> = listing.files.iter().map(|f| f.path.as_str()).collect();
        c.files.retain(|p, _| keep.contains(p.as_str()));
        if listing.index.is_none() {
            c.titles = None;
        }
        c.exists.clear();
        c.listing = Some((Instant::now(), now_ms(), listing));
    });
    Ok(())
}

async fn fetch_batch(
    handle: &crate::ssh::ExecHandle,
    key: &str,
    batch: Vec<(Listed, FetchItem)>,
) -> Result<usize, String> {
    let n = nonce();
    let items: Vec<FetchItem> = batch.iter().map(|(_, it)| it.clone()).collect();
    let bound: u64 = items.iter().map(item_bound).sum::<u64>() + 4096;
    let r = crate::ssh::run_exec_bytes(
        handle.clone(),
        fetch_command(&n, &items),
        FETCH_TIMEOUT,
        usize::try_from(bound).unwrap_or(usize::MAX),
    )
    .await;
    if let Some(e) = exec_failure(&r, FETCH_TIMEOUT.as_secs()) {
        return Err(e);
    }
    let (mut got, complete) = parse_fetch(&n, &r.stdout);
    let mut done = 0usize;
    let mut updates: Vec<(Listed, Entry)> = Vec::new();
    let mut titles: Option<(Listed, HashMap<String, String>)> = None;
    for (i, (f, it)) in batch.into_iter().enumerate() {
        let part = got.remove(&i).unwrap_or_default();
        let whole = fetched_whole(&it, &part);
        // 끝까지 왔는데 이 파일의 몫이 없다(지워졌다 · 못 읽는다) — 빈 것으로 기억해 다시 조르지 않는다.
        // 끝이 잘렸으면 못 받은 파일은 다음 번으로 미룬다.
        if !whole && !complete {
            continue;
        }
        done += 1;
        if f.agent == "index" {
            let t = parse_index(&f, part);
            titles = Some((f, t));
            continue;
        }
        let (usage, limits) = if whole {
            usage_from_fetch(&f, &it, &part)
        } else {
            (None, None)
        };
        let (parsed, tokens) = if whole {
            parse_fetched(&f, part)
        } else {
            (None, None)
        };
        let entry = Entry {
            size: f.size,
            mtime_ms: f.mtime_ms,
            agent: f.agent,
            parsed: parsed.map(Arc::new),
            tokens,
            usage,
            limits,
        };
        updates.push((f, entry));
    }
    with_hosts(|h| {
        let c = h.entry(key.to_string()).or_default();
        for (f, mut entry) in updates {
            if entry.usage.is_none() {
                entry.usage = carried_usage(c.files.remove(&f.path), &f);
            }
            c.files.insert(f.path.clone(), entry);
        }
        if let Some((f, t)) = titles {
            c.titles = Some((f.size, f.mtime_ms, t));
        }
    });
    Ok(done)
}

/// 실패하면 모두 "있다" 로 둔다(재개가 서버의 한 줄로 실패한다).
async fn check_exists(handle: &crate::ssh::ExecHandle, key: &str) {
    let ask: Vec<String> = with_hosts(|h| {
        let Some(c) = h.get(key) else {
            return Vec::new();
        };
        let mut seen = HashSet::new();
        c.files
            .values()
            .filter_map(|e| e.parsed.as_ref().map(|p| p.cwd.clone()))
            .filter(|cwd| {
                !c.exists.contains_key(cwd) && clean_path(cwd) && seen.insert(cwd.clone())
            })
            .take(CWDS_MAX)
            .collect()
    });
    if ask.is_empty() {
        return;
    }
    let r = crate::ssh::run_exec_bytes(
        handle.clone(),
        exists_command(&ask),
        CHECK_TIMEOUT,
        LIST_MAX_BYTES,
    )
    .await;
    let ok = r.error.is_none() && !r.timed_out;
    let there: HashSet<String> = String::from_utf8_lossy(&r.stdout)
        .lines()
        .map(str::to_owned)
        .collect();
    with_hosts(|h| {
        let c = h.entry(key.to_string()).or_default();
        for cwd in ask {
            let e = !ok || there.contains(&cwd);
            c.exists.insert(cwd, e);
        }
    });
}

#[tauri::command]
pub async fn agent_sessions_remote_list(
    id: u32,
    force: bool,
) -> Result<RemoteSessionList, String> {
    let (handle, alias) =
        crate::server::ssh_ops::tile_handle_and_alias(id).await.ok_or_else(crate::errors::session_gone)?;
    let key = key_of(&alias);
    let g = gate(&key);
    let _held = g.lock().await;
    let started = Instant::now();

    ensure_listing(&handle, &key, force).await?;
    loop {
        let todo = with_hosts(|h| {
            let c = h.entry(key.clone()).or_default();
            match &c.listing {
                Some((_, _, l)) => pending(c, l),
                None => Vec::new(),
            }
        });
        if todo.is_empty() || started.elapsed() >= CALL_BUDGET {
            break;
        }
        let batch = next_batch(&todo);
        let first = batch.first().map(|(f, _)| f.clone());
        let done = fetch_batch(&handle, &key, batch).await?;
        if done == 0 {
            // 한 파일도 끝내지 못했다 — 그 파일을 빈 것으로 두고 넘어간다(같은 자리를 맴돌지 않게).
            if let Some(f) = first {
                with_hosts(|h| {
                    let c = h.entry(key.clone()).or_default();
                    if f.agent == "index" {
                        c.titles = Some((f.size, f.mtime_ms, HashMap::new()));
                    } else {
                        let usage = carried_usage(c.files.remove(&f.path), &f);
                        c.files.insert(
                            f.path.clone(),
                            Entry {
                                size: f.size,
                                mtime_ms: f.mtime_ms,
                                agent: f.agent,
                                parsed: None,
                                tokens: None,
                                usage,
                                limits: None,
                            },
                        );
                    }
                });
            }
        }
    }
    let complete = with_hosts(|h| {
        h.get(&key)
            .and_then(|c| c.listing.as_ref().map(|(_, _, l)| pending(c, l).is_empty()))
            .unwrap_or(true)
    });
    if complete {
        check_exists(&handle, &key).await;
    }
    Ok(with_hosts(|h| {
        let c = h.entry(key.clone()).or_default();
        let Some((_, read_at, listing)) = &c.listing else {
            return RemoteSessionList {
                host: alias.clone(),
                sessions: Vec::new(),
                total: 0,
                done: 0,
                complete: true,
                read_at: now_ms(),
                home: None,
            };
        };
        let skew = listing.now_s.map_or(0, |s| read_at - s * 1000);
        let total = listing.files.len();
        let done = listing.files.iter().filter(|f| !stale(c, f)).count();
        RemoteSessionList {
            host: alias.clone(),
            sessions: rows_of(&alias, c, listing, skew),
            total,
            done,
            complete,
            read_at: *read_at,
            home: listing.home.clone(),
        }
    }))
}

// ── 재개 · 포크 ──

fn launch_from_cache(
    cache: &HostCache,
    t: &'static SessionTarget,
    id: &str,
    mode: &str,
) -> Result<LaunchSpec, String> {
    if !(t.id_ok)(id) {
        return Err(
            tr!(ko: "대화 id 모양이 올바르지 않습니다", en: "The conversation id is malformed"),
        );
    }
    let id = id.to_ascii_lowercase();
    let argv = match mode {
        "resume" => (t.resume_argv)(&id),
        "fork" => match t.fork_argv {
            Some(f) => f(&id),
            None => {
                return Err(tr!(
                    ko: "{name} 은(는) 새 대화로 계속할 수 없습니다",
                    en: "{name} cannot continue in a new conversation",
                    name = t.display
                ))
            }
        },
        other => return Err(tr!(ko: "모르는 방식입니다: {other}", en: "Unknown mode: {other}")),
    };
    let cwd = cache
        .files
        .values()
        .filter(|e| e.agent == t.id)
        .filter_map(|e| {
            e.parsed
                .as_ref()
                .filter(|p| p.id == id)
                .map(|p| (e.mtime_ms, p.cwd.clone()))
        })
        .max_by_key(|(m, _)| *m)
        .map(|(_, cwd)| cwd)
        .ok_or_else(
            || tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation"),
        )?;
    if !clean_path(&cwd) || cache.exists.get(&cwd) == Some(&false) {
        return Err(
            tr!(ko: "대화의 폴더가 없습니다: {cwd}", en: "The conversation's folder no longer exists: {cwd}"),
        );
    }
    Ok(LaunchSpec {
        cwd,
        command: local::join_argv(&argv)?,
    })
}

/// 그 별칭을 읽어 둔 캐시에서만 찾는다 — 화면이 넘긴 폴더를 믿지 않는다.
#[tauri::command]
pub async fn agent_session_remote_launch_spec(
    alias: String,
    agent: String,
    id: String,
    mode: String,
) -> Result<LaunchSpec, String> {
    let t = local::target(&agent)?;
    with_hosts(|h| match h.get(&key_of(&alias)) {
        Some(c) => launch_from_cache(c, t, &id, &mode),
        None => Err(tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation")),
    })
}

// ── 3. 전체 사용량 읽기 — 사람이 누를 때만 ──
// 서버의 `awk` 가 조각의 온전한 줄 중 바늘(`agent_usage::needles_of`)이 든 줄만 돌려준다 — 도구 출력이 든 큰 줄은 서버에서 걸러진다. 서버에는 아무것도 쓰지 않는다.

const USAGE_CHUNK_START: u64 = 16 * 1024 * 1024;
const USAGE_CHUNK_MIN: u64 = 1024 * 1024;
const USAGE_CHUNK_MAX: u64 = 256 * 1024 * 1024;
const USAGE_BATCH_RAW: u64 = 96 * 1024 * 1024;
const USAGE_BATCH_FILES: usize = 40;
const USAGE_OUT_MAX: usize = 8 * 1024 * 1024;
const USAGE_TIMEOUT: Duration = Duration::from_secs(45);
const USAGE_STALLS_MAX: u32 = 6;

#[derive(Clone, PartialEq)]
pub(crate) struct UsageItem {
    pub path: String,
    pub agent: &'static str,
    pub start: u64,
    pub len: u64,
}

/// awk 문자열 글자로 — 따옴표와 역빗금만 푼다(바늘은 짧은 고정 글자다).
fn awk_str(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// 조각 끝에 `\n@@E` 를 붙여 awk 가 끝의 반쯤 온 줄을 알아보게 한다 — 끝에서 둘째 레코드는 세지 않는다. `length` 가 바이트를 세게 `LC_ALL=C`.
pub(crate) fn usage_command(nonce: &str, items: &[UsageItem]) -> String {
    let mut script = String::new();
    for (i, it) in items.iter().enumerate() {
        let needles = crate::agent_usage::needles_of(it.agent);
        let cond = if needles.is_empty() {
            "0".to_string()
        } else {
            needles
                .iter()
                .map(|n| format!("index(a,{})", awk_str(n)))
                .collect::<Vec<_>>()
                .join("||")
        };
        let awk = format!(
            "NR>2{{s+=length(a)+1; if({cond}) print a}} {{a=b; b=$0}} END{{if(b!=\"@@E\") s=-1; printf \"\\n%s %d E %.0f\\n\", m, i, s}}"
        );
        script.push_str(&format!(
            "printf '\\n{nonce} {i} U\\n'; {{ tail -c +{} {p} 2>/dev/null | head -c {}; printf '\\n@@E'; }} | LC_ALL=C awk -v m={nonce} -v i={i} {q}; ",
            it.start + 1,
            it.len,
            p = crate::ssh::sh_quote(&it.path),
            q = crate::ssh::sh_quote(&awk),
        ));
    }
    script.push_str(&format!("printf '\\n{nonce} END\\n'"));
    format!("sh -c {}", crate::ssh::sh_quote(&script))
}

/// 바이트가 음수(조각 끝 표식이 없었다)면 받지 않는다.
pub(crate) fn parse_usage(nonce: &str, out: &[u8]) -> (HashMap<usize, (Vec<u8>, u64)>, bool) {
    let (pieces, complete) = split_marked(nonce, out);
    let mut bodies: HashMap<usize, Vec<u8>> = HashMap::new();
    let mut got = HashMap::new();
    for (label, body) in pieces {
        let parts: Vec<&str> = label.split(' ').collect();
        let Some(i) = parts.first().and_then(|s| s.parse::<usize>().ok()) else {
            continue;
        };
        match parts.get(1).copied() {
            Some("U") => {
                bodies.insert(i, body.to_vec());
            }
            Some("E") => {
                let Some(n) = parts.get(2).and_then(|s| s.parse::<i64>().ok()) else {
                    continue;
                };
                if let (Some(b), true) = (bodies.remove(&i), n >= 0) {
                    got.insert(i, (b, n as u64));
                }
            }
            _ => {}
        }
    }
    (got, complete)
}

fn usage_pending(c: &HostCache, l: &Listing) -> Vec<UsageItem> {
    let mut out = Vec::new();
    for f in &l.files {
        let Some(e) = c.files.get(&f.path) else {
            continue;
        };
        if e.parsed.is_none() || e.size != f.size || e.mtime_ms != f.mtime_ms {
            continue;
        }
        let (start, chunk) = match &e.usage {
            Some(u) if u.broken || u.offset >= f.size => continue,
            Some(u) => (u.offset, u.chunk),
            None => (0, USAGE_CHUNK_START),
        };
        out.push(UsageItem {
            path: f.path.clone(),
            agent: f.agent,
            start,
            len: chunk.min(f.size - start),
        });
    }
    out
}

/// 적어도 하나는 담는다.
pub(crate) fn usage_batch(pending: &[UsageItem]) -> Vec<UsageItem> {
    let mut out: Vec<UsageItem> = Vec::new();
    let mut raw = 0u64;
    for it in pending {
        if !out.is_empty() && (out.len() >= USAGE_BATCH_FILES || raw + it.len > USAGE_BATCH_RAW) {
            break;
        }
        raw += it.len;
        out.push(it.clone());
    }
    out
}

fn apply_usage(
    c: &mut HostCache,
    items: &[UsageItem],
    mut got: HashMap<usize, (Vec<u8>, u64)>,
) -> usize {
    let mut progressed = 0usize;
    for (i, it) in items.iter().enumerate() {
        let Some(e) = c.files.get_mut(&it.path) else {
            continue;
        };
        let u = e.usage.get_or_insert_with(RemoteUsage::fresh);
        if u.offset != it.start {
            continue;
        }
        match got.remove(&i) {
            Some((body, n)) if n > 0 => {
                crate::agent_usage::feed_lines(it.agent, &mut u.file, &body);
                u.offset += n;
                u.stalls = 0;
                progressed += 1;
            }
            Some(_) => {
                u.chunk = (u.chunk * 4).min(USAGE_CHUNK_MAX);
                u.stalls += 1;
            }
            None if progressed == 0 && i == 0 => {
                u.chunk = (u.chunk / 4).max(USAGE_CHUNK_MIN);
                u.stalls += 1;
            }
            None => {}
        }
        if u.stalls >= USAGE_STALLS_MAX {
            u.broken = true;
        }
    }
    progressed
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUsageProgress {
    pub host: String,
    pub done_bytes: u64,
    pub total_bytes: u64,
    pub pending: usize,
    pub complete: bool,
}

fn usage_progress(host: &str, c: &HostCache) -> RemoteUsageProgress {
    let Some((_, _, l)) = &c.listing else {
        return RemoteUsageProgress {
            host: host.to_string(),
            done_bytes: 0,
            total_bytes: 0,
            pending: 0,
            complete: true,
        };
    };
    let (mut done, mut total) = (0u64, 0u64);
    for f in &l.files {
        let Some(e) = c.files.get(&f.path) else {
            continue;
        };
        if e.parsed.is_none() || e.usage.as_ref().is_some_and(|u| u.broken) {
            continue;
        }
        total += f.size;
        done += e.usage.as_ref().map_or(0, |u| u.offset.min(f.size));
    }
    let pending = usage_pending(c, l).len();
    RemoteUsageProgress {
        host: host.to_string(),
        done_bytes: done,
        total_bytes: total,
        pending,
        complete: pending == 0,
    }
}

/// 목록은 새로 뽑지 않는다 — 이미 읽어 둔 것의 크기까지만 센다.
#[tauri::command]
pub async fn agent_usage_remote_read(
    id: u32,
) -> Result<RemoteUsageProgress, String> {
    let (handle, alias) =
        crate::server::ssh_ops::tile_handle_and_alias(id).await.ok_or_else(crate::errors::session_gone)?;
    let key = key_of(&alias);
    let g = gate(&key);
    let _held = g.lock().await;
    let started = Instant::now();
    loop {
        let batch = with_hosts(|h| {
            h.get(&key)
                .and_then(|c| {
                    c.listing
                        .as_ref()
                        .map(|(_, _, l)| usage_batch(&usage_pending(c, l)))
                })
                .unwrap_or_default()
        });
        if batch.is_empty() || started.elapsed() >= CALL_BUDGET {
            break;
        }
        let n = nonce();
        let r = crate::ssh::run_exec_bytes(
            handle.clone(),
            usage_command(&n, &batch),
            USAGE_TIMEOUT,
            USAGE_OUT_MAX,
        )
        .await;
        if let Some(e) = exec_failure(&r, USAGE_TIMEOUT.as_secs()) {
            return Err(e);
        }
        let (got, _) = parse_usage(&n, &r.stdout);
        with_hosts(|h| {
            let c = h.entry(key.clone()).or_default();
            apply_usage(c, &batch, got);
        });
    }
    Ok(with_hosts(|h| {
        usage_progress(&alias, h.entry(key.clone()).or_default())
    }))
}

/// 잠금을 쥔 채 `f` 를 부른다. 서버에는 묻지 않는다 — 연결이 없는 호스트도 마지막으로 읽은 값이 든다.
pub(crate) fn with_usage_files<R>(
    hosts: &[String],
    f: impl FnOnce(
        Vec<crate::agent_usage::SummaryFile<'_>>,
        Vec<crate::agent_usage::RemoteCoverage>,
    ) -> R,
) -> R {
    let guard = HOSTS.lock().unwrap_or_else(|e| e.into_inner());
    let mut files = Vec::new();
    let mut coverage = Vec::new();
    for alias in hosts {
        let mut cov = crate::agent_usage::RemoteCoverage {
            host: alias.clone(),
            counted: 0,
            pending_claude: 0,
            pending_codex: 0,
            pending_bytes: 0,
            read_at: None,
        };
        if let Some((c, (_, read_at, l))) = guard
            .get(&key_of(alias))
            .and_then(|c| c.listing.as_ref().map(|l| (c, l)))
        {
            cov.read_at = Some(*read_at);
            for fl in &l.files {
                let Some(e) = c.files.get(&fl.path) else {
                    continue;
                };
                let Some(p) = &e.parsed else { continue };
                let offset = e.usage.as_ref().map_or(0, |u| u.offset);
                if let Some(u) = e.usage.as_ref().filter(|u| u.offset > 0) {
                    files.push((fl.agent, p.id.clone(), &u.file));
                }
                if offset >= fl.size {
                    cov.counted += 1;
                } else {
                    if fl.agent == "codex" {
                        cov.pending_codex += 1;
                    } else {
                        cov.pending_claude += 1;
                    }
                    cov.pending_bytes += fl.size - offset;
                }
            }
        }
        coverage.push(cov);
    }
    f(files, coverage)
}

/// Codex 만 — Claude 의 한도는 이 PC 의 상태줄 도우미만 적으므로 원격에는 없다.
#[tauri::command]
pub async fn agent_usage_remote_limits(
    host: String,
) -> Result<Vec<crate::agent_usage::AgentLimits>, String> {
    let snap = with_hosts(|h| {
        h.get(&key_of(&host)).and_then(|c| {
            c.files
                .values()
                .filter_map(|e| e.limits.as_ref())
                .max_by_key(|(at, _)| *at)
                .cloned()
        })
    });
    Ok(vec![crate::agent_usage::remote_codex_limits(snap)])
}

// ── 4. 원격 기록 보기 — 끝에서 거꾸로, 창 하나씩 ──

const VIEW_WINDOW_FIRST: u64 = 512 * 1024;
const VIEW_WINDOW_MAX: u64 = 40 * 1024 * 1024;
const VIEW_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn view_command(path: &str, before: Option<u64>, window: u64) -> String {
    let end = before.map_or_else(|| "$s".to_string(), |b| b.to_string());
    let script = format!(
        "p={p}; s=$(wc -c < \"$p\") || exit 3; s=$((s+0)); e={end}; if [ \"$e\" -gt \"$s\" ]; then e=$s; fi; \
st=$((e > {window} ? e - {window} : 0)); printf '%s %s\\n' \"$s\" \"$st\"; tail -c +$((st+1)) \"$p\" | head -c $((e-st))",
        p = crate::ssh::sh_quote(path),
    );
    format!("sh -c {}", crate::ssh::sh_quote(&script))
}

/// 받은 바이트가 창의 길이와 다르면(잘렸다 · 그 사이 줄었다) 믿지 않는다.
pub(crate) fn parse_view(out: &[u8], before: Option<u64>) -> Result<(u64, u64, &[u8]), String> {
    let bad = || tr!(ko: "서버에서 기록을 다 받지 못했습니다", en: "Could not receive the transcript from the server");
    let nl = out.iter().position(|b| *b == b'\n').ok_or_else(bad)?;
    let head = String::from_utf8_lossy(&out[..nl]);
    let mut parts = head.split_whitespace();
    let (Some(size), Some(start)) = (
        parts.next().and_then(|s| s.parse::<u64>().ok()),
        parts.next().and_then(|s| s.parse::<u64>().ok()),
    ) else {
        return Err(bad());
    };
    let end = before.map_or(size, |b| b.min(size));
    let data = &out[nl + 1..];
    if start > end || data.len() as u64 != end - start {
        return Err(bad());
    }
    Ok((size, start, data))
}

fn conversation_path(c: &HostCache, agent: &str, id: &str) -> Option<String> {
    c.files
        .iter()
        .filter(|(_, e)| e.agent == agent && e.parsed.as_ref().is_some_and(|p| p.id == id))
        .max_by_key(|(_, e)| e.mtime_ms)
        .map(|(p, _)| p.clone())
}

/// 파일은 그 별칭을 읽어 둔 캐시의 것만 — 화면이 넘긴 경로는 받지 않는다. 본문은 화면으로만 간다(로그 · MCP · 디스크 없음).
#[tauri::command]
pub async fn agent_conversation_transcript_remote(
    id: u32,
    agent: String,
    conversation: String,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<crate::agent_transcript::TranscriptPage, String> {
    let (handle, alias) =
        crate::server::ssh_ops::tile_handle_and_alias(id).await.ok_or_else(crate::errors::session_gone)?;
    let t = local::target(&agent)?;
    if !(t.id_ok)(&conversation) {
        return Err(
            tr!(ko: "대화 id 모양이 올바르지 않습니다", en: "The conversation id is malformed"),
        );
    }
    let conv = conversation.to_ascii_lowercase();
    let path = with_hosts(|h| {
        h.get(&key_of(&alias))
            .and_then(|c| conversation_path(c, t.id, &conv))
    })
    .ok_or_else(|| tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation"))?;
    let limit = limit.unwrap_or_else(crate::agent_transcript::default_limit);
    let mut window = VIEW_WINDOW_FIRST;
    loop {
        let r = crate::ssh::run_exec_bytes(
            handle.clone(),
            view_command(&path, before, window),
            VIEW_TIMEOUT,
            usize::try_from(window + 64).unwrap_or(usize::MAX),
        )
        .await;
        if let Some(e) = exec_failure(&r, VIEW_TIMEOUT.as_secs()) {
            return Err(e);
        }
        let (size, start, data) = parse_view(&r.stdout, before)?;
        match crate::agent_transcript::page_in_window(
            size,
            start,
            data,
            before,
            limit,
            t.transcript,
        )? {
            crate::agent_transcript::WindowPage::Page(p) => return Ok(p),
            crate::agent_transcript::WindowPage::NeedMore if window < VIEW_WINDOW_MAX => {
                window = (window * 4).min(VIEW_WINDOW_MAX);
            }
            crate::agent_transcript::WindowPage::NeedMore => {
                return Err(
                    tr!(ko: "기록을 더 읽지 못했습니다", en: "Could not read further back in the transcript"),
                );
            }
        }
    }
}

/// 바이트는 화면으로만.
#[tauri::command]
pub async fn agent_conversation_image_remote(
    id: u32,
    agent: String,
    conversation: String,
    at: u64,
    len: u64,
    n: u32,
) -> Result<tauri::ipc::Response, String> {
    let (handle, alias) =
        crate::server::ssh_ops::tile_handle_and_alias(id).await.ok_or_else(crate::errors::session_gone)?;
    let t = local::target(&agent)?;
    if !(t.id_ok)(&conversation) {
        return Err(
            tr!(ko: "대화 id 모양이 올바르지 않습니다", en: "The conversation id is malformed"),
        );
    }
    if len == 0 || len > crate::agent_transcript::image_line_max() {
        return Err(tr!(ko: "그 그림을 기록에서 찾지 못했습니다", en: "Could not find that image in the transcript"));
    }
    let conv = conversation.to_ascii_lowercase();
    let path = with_hosts(|h| {
        h.get(&key_of(&alias))
            .and_then(|c| conversation_path(c, t.id, &conv))
    })
    .ok_or_else(|| tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation"))?;
    let before = at.saturating_add(len).saturating_add(1);
    let window = len + 2;
    let r = crate::ssh::run_exec_bytes(
        handle,
        view_command(&path, Some(before), window),
        VIEW_TIMEOUT,
        usize::try_from(window + 64).unwrap_or(usize::MAX),
    )
    .await;
    if let Some(e) = exec_failure(&r, VIEW_TIMEOUT.as_secs()) {
        return Err(e);
    }
    let (size, start, data) = parse_view(&r.stdout, Some(before))?;
    crate::agent_transcript::image_in_window(size, start, data, at, len, n).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests;
