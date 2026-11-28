//! 에이전트 대화 목록 — 에이전트 CLI 가 남긴 지난 대화를 프로젝트 · 워크트리별로 보여 주고 재개 · 새 대화로 계속(포크) 명령을 짓는다 (docs/log/2026-09-26-agent-sessions.md).
//! 화면의 단어는 "대화"다. 코드 이름 `agent_sessions` 는 CLI 들이 스스로를 "session" 이라 부르는 말 그대로 둔다.
//! 대화 파일은 90 MB 까지 자라므로 통째로 읽지 않는다 — 앞과 꼬리만 읽고 `(경로, mtime, 크기)` 캐시에 둔다.
//! 묶기 비교는 `crate::worktree::comparable` 한 벌이다 — OS 분기가 없다.
//!
//! ## 개인정보 — 제목은 화면에만
//!
//! 첫 프롬프트는 사용자가 친 글자라 화면으로만 간다 — MCP · 로그 · 설정 파일에 싣지 않고, 이 모듈의 자료형은 `Debug` 를 파생하지 않는다.
//! 본문 · 도구 출력 · `last-prompt` 는 파싱 중에도 담지 않는다 — 첫 프롬프트 한 줄을 자를 때까지만 손에 든다.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;

use crate::i18n::tr;

const TITLE_MAX_CHARS: usize = 80;
/// 제목(`ai-title`)은 주기적으로 다시 적혀 꼬리 64 KB 면 찾는다.
const TAIL_BYTES: u64 = 64 * 1024;
/// 앞 읽기가 줄 가운데서 끝났을 때 그 줄의 끝을 찾아 더 읽는 상한 — 그림 몇 장을 붙인 첫 말이 들어갈 만큼.
const HEAD_LINE_EXTRA_MAX: u64 = 4 * 1024 * 1024;
const MAX_FILES_PER_AGENT: usize = 600;
const MAX_CWDS: usize = 256;
const LIMIT_DEFAULT: usize = 50;
const LIMIT_MAX: usize = 500;
const OTHERS_MAX: usize = 100;
const INDEX_TAIL_BYTES: u64 = 1024 * 1024;
const CACHE_MAX: usize = 8192;

// ── 에이전트 표 — 에이전트마다 다른 것은 여기에만 있다 ──

pub(crate) struct Chunk {
    /// Claude 는 이것이 대화 id 다.
    pub(crate) stem: String,
    pub(crate) head: Vec<Value>,
    /// 앞과 겹치지 않는다(파일이 작으면 비어 있다).
    pub(crate) tail: Vec<Value>,
}

/// `Debug` 없음(모듈 머리말 "개인정보").
#[derive(Clone, Default)]
pub(crate) struct Parsed {
    pub(crate) id: String,
    /// 기록된 시작 cwd.
    pub(crate) cwd: String,
    branch: Option<String>,
    custom_title: Option<String>,
    ai_title: Option<String>,
    prompt: Option<String>,
    started_at: Option<i64>,
    model: Option<String>,
    forked_from: Option<String>,
}

pub(crate) enum Layout {
    /// Claude — `projects/<슬러그>/<id>.jsonl`. 하위 폴더(서브에이전트)는 보지 않는다.
    DirPerProject,
    /// Codex — `sessions/YYYY/MM/DD/rollout-….jsonl`. 이름 순이 곧 시작 순이다.
    DateTree,
}

pub(crate) enum SessionSource {
    JsonlFiles {
        layout: Layout,
        head_bytes: u64,
        /// 대화가 아니면(빈 대화 · 사이드체인 · 비대화형) `None`.
        parse: fn(&Chunk) -> Option<Parsed>,
    },
}

type CustomTitles = fn(&Path) -> HashMap<String, String>;

/// 지난 대화를 남기는 에이전트 CLI 하나 — 에이전트를 더하는 자리는 이 표 한 줄이다.
pub(crate) struct SessionTarget {
    /// 안정 id — `agent_hooks::TARGETS` · `pane-icons.ts` 의 `aiIconName` 과 같은 글자.
    pub id: &'static str,
    /// 제품 이름이라 번역하지 않는다.
    pub display: &'static str,
    pub(crate) roots: fn() -> Vec<PathBuf>,
    pub(crate) source: SessionSource,
    /// 명령 줄에 들어가는 값이라 이 모양이 아니면 명령을 짓지 않는다.
    pub(crate) id_ok: fn(&str) -> bool,
    pub(crate) resume_argv: fn(&str) -> Vec<String>,
    pub(crate) fork_argv: Option<fn(&str) -> Vec<String>>,
    custom_titles: Option<CustomTitles>,
    pub(crate) usage: Option<crate::agent_usage::UsageSource>,
    pub(crate) limits: crate::agent_usage::LimitSource,
    pub(crate) transcript: crate::agent_transcript::LineEvents,
    pub(crate) rename: Option<rename::Rename>,
    pub(crate) delete: Option<delete::Delete>,
}

fn claude_roots() -> Vec<PathBuf> {
    let base = match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => match dirs::home_dir() {
            Some(h) => h.join(".claude"),
            None => return Vec::new(),
        },
    };
    vec![base.join("projects")]
}

/// 보관함(`archived_sessions`)은 보지 않는다.
fn codex_roots() -> Vec<PathBuf> {
    let base = match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => match dirs::home_dir() {
            Some(h) => h.join(".codex"),
            None => return Vec::new(),
        },
    };
    vec![base.join("sessions")]
}

fn claude_resume(id: &str) -> Vec<String> {
    vec!["claude".into(), "--resume".into(), id.into()]
}

fn claude_fork(id: &str) -> Vec<String> {
    vec![
        "claude".into(),
        "--resume".into(),
        id.into(),
        "--fork-session".into(),
    ]
}

fn codex_resume(id: &str) -> Vec<String> {
    vec!["codex".into(), "resume".into(), id.into()]
}

fn codex_fork(id: &str) -> Vec<String> {
    vec!["codex".into(), "fork".into(), id.into()]
}

pub(crate) const TARGETS: &[SessionTarget] = &[
    SessionTarget {
        id: "claude",
        display: "Claude Code",
        roots: claude_roots,
        source: SessionSource::JsonlFiles {
            layout: Layout::DirPerProject,
            head_bytes: 64 * 1024,
            parse: claude_parse,
        },
        id_ok: uuid_shape,
        resume_argv: claude_resume,
        fork_argv: Some(claude_fork),
        custom_titles: None,
        usage: Some(crate::agent_usage::CLAUDE_USAGE),
        limits: crate::agent_usage::LimitSource::HelperFile,
        transcript: crate::agent_transcript::claude_events,
        rename: Some(rename::claude_rename),
        delete: Some(delete::claude_delete),
    },
    SessionTarget {
        id: "codex",
        display: "Codex",
        roots: codex_roots,
        // 128 KB — 주입된 개발자 지침 · AGENTS.md 뒤에 첫 프롬프트가 온다.
        source: SessionSource::JsonlFiles {
            layout: Layout::DateTree,
            head_bytes: 128 * 1024,
            parse: codex_parse,
        },
        id_ok: uuid_shape,
        resume_argv: codex_resume,
        fork_argv: Some(codex_fork),
        custom_titles: Some(codex_custom_titles),
        usage: Some(crate::agent_usage::CODEX_USAGE),
        limits: crate::agent_usage::LimitSource::RolloutTail,
        transcript: crate::agent_transcript::codex_events,
        rename: Some(rename::codex_rename),
        delete: Some(delete::codex_delete),
    },
];

pub(crate) fn target(id: &str) -> Result<&'static SessionTarget, String> {
    TARGETS
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| tr!(ko: "모르는 에이전트입니다: {id}", en: "Unknown agent: {id}"))
}

// ── 공용 판정 ──

/// 훅 신호의 `session` 도 이 함수로 거른다(`crate::agent_signal`).
pub(crate) fn uuid_shape(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

pub(crate) fn one_line(s: &str) -> Option<String> {
    let joined = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.is_empty() {
        return None;
    }
    if joined.chars().count() <= TITLE_MAX_CHARS {
        return Some(joined);
    }
    let cut: String = joined.chars().take(TITLE_MAX_CHARS).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// 프롬프트 뒤에 도구가 붙인 표식(옵시디언 플러그인의 `<linked_content …>` 등)이 따라올 수 있어 태그처럼 보이는 첫 토막에서 자른다.
fn prompt_title(text: &str) -> Option<String> {
    let b = text.as_bytes();
    let cut = (0..b.len())
        .find(|&i| {
            b[i] == b'<'
                && b.get(i + 1)
                    .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
        })
        .unwrap_or(b.len());
    let head = &text[..cut]; // `<` 는 ASCII 라 글자 경계다
    let mut out = String::with_capacity(head.len());
    let mut depth = 0usize;
    for c in head.chars() {
        match c {
            '<' => depth += 1,
            '>' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    one_line(&out)
}

pub(crate) fn str_of(v: &Value) -> Option<&str> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty())
}

pub(crate) fn ms_of(ts: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(ts.as_str()?)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn branch_of(v: &Value) -> Option<String> {
    str_of(v).filter(|b| *b != "HEAD").map(str::to_owned)
}

// ── Claude Code ──

// 폴더 이름(슬러그)은 읽지 않는다 — 손실 변환(`a.b` 와 `a-b` 가 같다)이라 파일 안의 `cwd` 로 가른다.

fn claude_prompt(v: &Value) -> Option<String> {
    if v["isMeta"] == true || v["isCompactSummary"] == true || v["isSidechain"] == true {
        return None;
    }
    if let Some(kind) = v["origin"]["kind"].as_str() {
        if kind != "human" {
            return None;
        }
    }
    let content = &v["message"]["content"];
    let text = match content {
        Value::String(s) => s.as_str(),
        Value::Array(parts) => {
            if parts.iter().any(|p| p["type"] == "tool_result") {
                return None;
            }
            parts
                .iter()
                .find(|p| p["type"] == "text")
                .and_then(|p| p["text"].as_str())?
        }
        _ => return None,
    };
    let t = text.trim_start();
    if t.starts_with('<') || t.starts_with("[Request interrupted") || t.starts_with("Caveat:") {
        return None;
    }
    prompt_title(t)
}

fn claude_parse(c: &Chunk) -> Option<Parsed> {
    if !uuid_shape(&c.stem) {
        return None;
    }
    let mut p = Parsed {
        id: c.stem.to_ascii_lowercase(),
        ..Default::default()
    };
    let mut convo = false;
    let mut summary: Option<String> = None;
    for (in_head, v) in c
        .head
        .iter()
        .map(|v| (true, v))
        .chain(c.tail.iter().map(|v| (false, v)))
    {
        let ty = v["type"].as_str().unwrap_or("");
        if matches!(ty, "user" | "assistant" | "attachment" | "system") {
            if v["isSidechain"] == true {
                return None;
            }
            if p.cwd.is_empty() {
                if let Some(cwd) = str_of(&v["cwd"]) {
                    p.cwd = cwd.to_owned();
                }
            }
            if p.started_at.is_none() {
                p.started_at = ms_of(&v["timestamp"]);
            }
            if let Some(b) = branch_of(&v["gitBranch"]) {
                p.branch = Some(b);
            }
        }
        match ty {
            "user" => {
                if v["isMeta"] != true {
                    convo = true;
                }
                if in_head && p.prompt.is_none() {
                    p.prompt = claude_prompt(v);
                }
            }
            "assistant" => {
                convo = true;
                if let Some(m) = str_of(&v["message"]["model"]).filter(|m| !m.starts_with('<')) {
                    p.model = Some(m.to_owned());
                }
            }
            "ai-title" => {
                if let Some(t) = str_of(&v["aiTitle"]).and_then(one_line) {
                    p.ai_title = Some(t);
                }
            }
            "custom-title" => {
                if let Some(t) = str_of(&v["customTitle"]).and_then(one_line) {
                    p.custom_title = Some(t);
                }
            }
            // 옛 판의 요약 — AI 제목이 없을 때만.
            "summary" => {
                if let Some(t) = str_of(&v["summary"]).and_then(one_line) {
                    summary = Some(t);
                }
            }
            _ => {}
        }
    }
    if !convo || p.cwd.is_empty() {
        return None;
    }
    if p.ai_title.is_none() {
        p.ai_title = summary;
    }
    Some(p)
}

// ── Codex ──

pub(crate) fn codex_injected(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with('<') || t.starts_with("# AGENTS.md") || t.starts_with("# AGENTS")
}

/// 신형은 `event_msg.user_message`, 페이지형(`paginated`)은 `response_item` 의 `role:"user"` 만 남는다 — 둘 다 본다.
fn codex_prompt(v: &Value) -> Option<String> {
    let pl = &v["payload"];
    match v["type"].as_str()? {
        "event_msg" if pl["type"] == "user_message" => pl["message"]
            .as_str()
            .filter(|t| !codex_injected(t))
            .and_then(prompt_title),
        "response_item" if pl["role"] == "user" => pl["content"]
            .as_array()?
            .iter()
            .filter_map(|c| c["text"].as_str())
            .find(|t| !t.trim().is_empty() && !codex_injected(t))
            .and_then(prompt_title),
        _ => None,
    }
}

fn codex_meta(first: &Value) -> Option<&Value> {
    if first["type"] != "session_meta" {
        return None;
    }
    let pl = &first["payload"];
    match &pl["source"] {
        Value::String(s) if s == "exec" => None,
        Value::String(_) | Value::Null => Some(pl),
        _ => None,
    }
}

fn codex_parse(c: &Chunk) -> Option<Parsed> {
    let meta = codex_meta(c.head.first()?)?;
    let id = str_of(&meta["id"])
        .filter(|s| uuid_shape(s))?
        .to_ascii_lowercase();
    let mut p = Parsed {
        id,
        cwd: str_of(&meta["cwd"])?.to_owned(),
        branch: branch_of(&meta["git"]["branch"]),
        started_at: ms_of(&meta["timestamp"]),
        forked_from: str_of(&meta["forked_from_id"])
            .filter(|s| uuid_shape(s))
            .map(str::to_ascii_lowercase),
        ..Default::default()
    };
    let mut turns = false;
    for (in_head, v) in c
        .head
        .iter()
        .skip(1)
        .map(|v| (true, v))
        .chain(c.tail.iter().map(|v| (false, v)))
    {
        if v["type"] == "turn_context" {
            turns = true;
            if let Some(m) = str_of(&v["payload"]["model"]) {
                p.model = Some(m.to_owned());
            }
        } else if in_head && p.prompt.is_none() {
            p.prompt = codex_prompt(v);
        }
    }
    turns.then_some(p)
}

/// 나중 줄이 이긴다. `root` 는 `<CODEX_HOME>/sessions` 다.
fn codex_custom_titles(root: &Path) -> HashMap<String, String> {
    let Some(home) = root.parent() else {
        return HashMap::new();
    };
    let Ok(bytes) = read_tail(&home.join("session_index.jsonl"), INDEX_TAIL_BYTES) else {
        return HashMap::new();
    };
    codex_titles_from(&bytes)
}

/// 로컬과 원격이 같은 규칙을 지난다.
pub(crate) fn codex_titles_from(bytes: &[u8]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for v in json_lines(bytes) {
        if let (Some(id), Some(name)) = (
            str_of(&v["id"]),
            str_of(&v["thread_name"]).and_then(one_line),
        ) {
            if uuid_shape(id) {
                out.insert(id.to_ascii_lowercase(), name);
            }
        }
    }
    out
}

// ── 파일 읽기 — 앞과 꼬리만 ──

pub(crate) fn json_lines(buf: &[u8]) -> Vec<Value> {
    buf.split(|b| *b == b'\n')
        .filter(|l| l.iter().any(|b| !b.is_ascii_whitespace()))
        .filter_map(|l| serde_json::from_slice(l).ok())
        .collect()
}

pub(crate) fn read_tail(path: &Path, n: u64) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let size = f.metadata()?.len();
    let start = size.saturating_sub(n);
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    f.take(n).read_to_end(&mut buf)?;
    if start > 0 {
        let cut = buf
            .iter()
            .position(|b| *b == b'\n')
            .map_or(buf.len(), |i| i + 1);
        buf.drain(..cut);
    }
    Ok(buf)
}

/// 앞이 줄 가운데서 끝나면 그 줄의 끝까지 더 읽는다 — 그림을 붙인 첫 말은 한 줄이 수십~수백 KB 라, 앞이 그 줄을 자르면 목록에서 그 대화가 빠진다.
fn read_chunk(path: &Path, head: u64) -> std::io::Result<Chunk> {
    let mut f = std::fs::File::open(path)?;
    let size = f.metadata()?.len();
    let mut head_buf = Vec::new();
    (&mut f).take(head).read_to_end(&mut head_buf)?;
    if (head_buf.len() as u64) < size && head_buf.last().is_some_and(|b| *b != b'\n') {
        let mut more = Vec::new();
        let mut piece = [0u8; 64 * 1024];
        while (more.len() as u64) < HEAD_LINE_EXTRA_MAX {
            let n = f.read(&mut piece)?;
            if n == 0 {
                break;
            }
            if let Some(i) = piece[..n].iter().position(|b| *b == b'\n') {
                more.extend_from_slice(&piece[..=i]);
                break;
            }
            more.extend_from_slice(&piece[..n]);
        }
        head_buf.extend_from_slice(&more);
    }
    let head = head_buf.len() as u64;
    let mut tail_buf = None;
    if size > head {
        // 꼬리는 한 바이트 앞부터 — `chunk_from_parts` 가 꼬리의 첫 줄을 잘린 줄로 보고 버리므로, 꼬리가 줄 첫머리에서 시작하면 온전한 줄 하나를 잃는다.
        let start = size.saturating_sub(TAIL_BYTES).max(head).saturating_sub(1);
        f.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::new();
        f.take(TAIL_BYTES + 1).read_to_end(&mut buf)?;
        tail_buf = Some(buf);
    }
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(chunk_from_parts(stem, head_buf, tail_buf))
}

/// 로컬 [`read_chunk`] 와 원격(`crate::agent_sessions_remote`)이 같은 다듬기를 지난다.
pub(crate) fn chunk_from_parts(
    stem: String,
    mut head_buf: Vec<u8>,
    tail: Option<Vec<u8>>,
) -> Chunk {
    let mut tail_buf = Vec::new();
    if let Some(mut t) = tail {
        let end = head_buf
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |i| i + 1);
        head_buf.truncate(end);
        let cut = t
            .iter()
            .position(|b| *b == b'\n')
            .map_or(t.len(), |i| i + 1);
        t.drain(..cut);
        tail_buf = t;
    }
    Chunk {
        stem,
        head: json_lines(&head_buf),
        tail: json_lines(&tail_buf),
    }
}

#[derive(Clone)]
pub(crate) struct FileStamp {
    pub(crate) path: PathBuf,
    pub(crate) mtime_ms: i64,
    pub(crate) size: u64,
}

pub(crate) fn stamp(path: PathBuf) -> Option<FileStamp> {
    let md = std::fs::metadata(&path).ok()?;
    if !md.is_file() {
        return None;
    }
    let mtime_ms = md
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some(FileStamp {
        path,
        mtime_ms,
        size: md.len(),
    })
}

pub(crate) fn is_jsonl(p: &Path) -> bool {
    p.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("jsonl"))
}

pub(crate) fn entries_desc(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok().map(|e| e.path())).collect(),
        Err(_) => return Vec::new(),
    };
    v.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    v
}

pub(crate) fn candidates(layout: &Layout, root: &Path) -> Vec<FileStamp> {
    let mut out: Vec<FileStamp> = Vec::new();
    match layout {
        Layout::DirPerProject => {
            // 서브에이전트(`<id>/subagents/…`)는 한 단 더 아래라 여기서 빠진다.
            for dir in entries_desc(root).into_iter().filter(|d| d.is_dir()) {
                out.extend(
                    entries_desc(&dir)
                        .into_iter()
                        .filter(|p| is_jsonl(p))
                        .filter_map(stamp),
                );
            }
        }
        Layout::DateTree => {
            'walk: for y in entries_desc(root).into_iter().filter(|d| d.is_dir()) {
                for m in entries_desc(&y).into_iter().filter(|d| d.is_dir()) {
                    for d in entries_desc(&m).into_iter().filter(|d| d.is_dir()) {
                        for f in entries_desc(&d).into_iter().filter(|p| is_jsonl(p)) {
                            if let Some(s) = stamp(f) {
                                out.push(s);
                            }
                            if out.len() >= MAX_FILES_PER_AGENT * 2 {
                                break 'walk;
                            }
                        }
                    }
                }
            }
        }
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.mtime_ms));
    out.truncate(MAX_FILES_PER_AGENT);
    out
}

// ── 캐시 ──

struct CacheEntry {
    mtime_ms: i64,
    size: u64,
    agent: &'static str,
    /// `None` = 대화가 아니다 — 그것도 기억해 다시 읽지 않는다.
    parsed: Option<Arc<Parsed>>,
}

static CACHE: LazyLock<Mutex<HashMap<PathBuf, CacheEntry>>> = LazyLock::new(Default::default);

/// 입출력은 잠금 밖에서 한다.
fn parsed_of(t: &SessionTarget, f: &FileStamp) -> Option<Arc<Parsed>> {
    {
        let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(e) = cache.get(&f.path) {
            if e.mtime_ms == f.mtime_ms && e.size == f.size && e.agent == t.id {
                return e.parsed.clone();
            }
        }
    }
    let SessionSource::JsonlFiles {
        head_bytes, parse, ..
    } = &t.source;
    let parsed = read_chunk(&f.path, *head_bytes)
        .ok()
        .and_then(|c| parse(&c))
        .map(Arc::new);
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= CACHE_MAX {
        cache.clear();
    }
    cache.insert(
        f.path.clone(),
        CacheEntry {
            mtime_ms: f.mtime_ms,
            size: f.size,
            agent: t.id,
            parsed: parsed.clone(),
        },
    );
    parsed
}

// ── 목록 ──

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TitleSource {
    Custom,
    Ai,
    Prompt,
    Fallback,
}

/// `Debug` 없음 — 제목은 사용자 글자일 수 있다.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub agent: &'static str,
    pub id: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub title: String,
    pub title_source: TitleSource,
    pub started_at: Option<i64>,
    /// 마지막 활동(파일 mtime, epoch ms).
    pub updated_at: i64,
    pub model: Option<String>,
    pub forked_from: Option<String>,
    pub cwd_exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CwdSessions {
    /// 요청에 받은 글자 그대로.
    pub cwd: String,
    pub exists: bool,
    pub sessions: Vec<AgentSession>,
    pub more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionList {
    pub groups: Vec<CwdSessions>,
    pub others: Vec<AgentSession>,
    pub others_more: bool,
}

pub(crate) fn record(
    t: &SessionTarget,
    p: &Parsed,
    updated_at: i64,
    custom: Option<&String>,
    cwd_exists: bool,
) -> AgentSession {
    let (title, title_source) = if let Some(c) = custom.or(p.custom_title.as_ref()) {
        (c.clone(), TitleSource::Custom)
    } else if let Some(a) = &p.ai_title {
        (a.clone(), TitleSource::Ai)
    } else if let Some(pr) = &p.prompt {
        (pr.clone(), TitleSource::Prompt)
    } else {
        let t = match &p.branch {
            Some(b) => format!("{} · {b}", t.display),
            None => t.display.to_owned(),
        };
        (t, TitleSource::Fallback)
    };
    AgentSession {
        agent: t.id,
        id: p.id.clone(),
        cwd: p.cwd.clone(),
        branch: p.branch.clone(),
        title,
        title_source,
        started_at: p.started_at,
        updated_at,
        model: p.model.clone(),
        forked_from: p.forked_from.clone(),
        cwd_exists,
    }
}

/// `keys` 는 [`crate::worktree::comparable`] 로 편 것.
fn owner_of(keys: &[String], cwd: &str) -> Option<usize> {
    let c = crate::worktree::comparable(cwd);
    keys.iter()
        .enumerate()
        .filter(|(_, k)| {
            !k.is_empty()
                && (c == **k
                    || c.strip_prefix(k.as_str())
                        .is_some_and(|rest| rest.starts_with('/') || k.ends_with('/')))
        })
        .max_by_key(|(_, k)| k.len())
        .map(|(i, _)| i)
}

fn scan(
    sources: &[(&'static SessionTarget, Vec<PathBuf>)],
    cwds: &[String],
    limit: usize,
) -> AgentSessionList {
    let keys: Vec<String> = cwds
        .iter()
        .map(|c| crate::worktree::comparable(c))
        .collect();
    let mut groups: Vec<Vec<AgentSession>> = vec![Vec::new(); cwds.len()];
    let mut others: Vec<AgentSession> = Vec::new();
    let mut exists: HashMap<String, bool> = HashMap::new();
    // 같은 대화가 파일 둘에 적힐 수 있다(포크한 Codex 대화를 다시 이을 때) — 에이전트 · id 마다 가장 최근 파일 하나만 남긴다.
    let mut seen: std::collections::HashSet<(&'static str, String)> =
        std::collections::HashSet::new();
    for (t, roots) in sources {
        let SessionSource::JsonlFiles { layout, .. } = &t.source;
        for root in roots {
            let titles = t.custom_titles.map(|f| f(root)).unwrap_or_default();
            for f in candidates(layout, root) {
                let Some(p) = parsed_of(t, &f) else { continue };
                if !seen.insert((t.id, p.id.clone())) {
                    continue;
                }
                let key = crate::worktree::comparable(&p.cwd);
                let ok = *exists
                    .entry(key)
                    .or_insert_with(|| Path::new(&p.cwd).is_dir());
                let rec = record(t, &p, f.mtime_ms, titles.get(&p.id), ok);
                match owner_of(&keys, &p.cwd) {
                    Some(i) => groups[i].push(rec),
                    None => others.push(rec),
                }
            }
        }
    }
    let cut = |v: &mut Vec<AgentSession>, n: usize| -> bool {
        v.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        let more = v.len() > n;
        v.truncate(n);
        more
    };
    let others_more = cut(&mut others, OTHERS_MAX);
    let groups = cwds
        .iter()
        .zip(groups)
        .map(|(cwd, mut sessions)| {
            let more = cut(&mut sessions, limit);
            CwdSessions {
                cwd: cwd.clone(),
                exists: Path::new(cwd).is_dir(),
                sessions,
                more,
            }
        })
        .collect();
    AgentSessionList {
        groups,
        others,
        others_more,
    }
}

fn list_blocking(cwds: Vec<String>, limit: Option<usize>) -> AgentSessionList {
    let mut seen = std::collections::HashSet::new();
    let cwds: Vec<String> = cwds
        .into_iter()
        .map(|c| c.trim().to_owned())
        .filter(|c| !c.is_empty() && seen.insert(crate::worktree::comparable(c)))
        .take(MAX_CWDS)
        .collect();
    let limit = limit.unwrap_or(LIMIT_DEFAULT).clamp(1, LIMIT_MAX);
    let sources: Vec<(&'static SessionTarget, Vec<PathBuf>)> =
        TARGETS.iter().map(|t| (t, (t.roots)())).collect();
    scan(&sources, &cwds, limit)
}

#[tauri::command]
pub async fn agent_sessions_list(
    cwds: Vec<String>,
    limit_per_cwd: Option<usize>,
) -> Result<AgentSessionList, String> {
    tauri::async_runtime::spawn_blocking(move || list_blocking(cwds, limit_per_cwd))
        .await
        .map_err(|e| e.to_string())
}

// ── 재개 · 포크 명령 ──

/// `Debug` — 폴더와 명령(에이전트 이름 · 인자 · id)뿐이라 사용자 글자가 없다.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSpec {
    pub cwd: String,
    pub command: String,
}

/// 대화 id 는 이미 모양을 봤지만 명령 줄에 들어가는 값이라 여기서 한 번 더 막는다.
pub(crate) fn join_argv(argv: &[String]) -> Result<String, String> {
    let safe = |a: &String| {
        !a.is_empty()
            && a.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    if argv.is_empty() || !argv.iter().all(safe) {
        return Err(tr!(ko: "명령을 지을 수 없습니다", en: "Could not build the command"));
    }
    Ok(argv.join(" "))
}

/// 지운 · 옮긴 파일의 낡은 항목을 믿지 않는다 — 루트 아래 · 파일이 아직 있는 것만. 같은 id 면 가장 최근 파일(목록이 보여 주는 것)이 이긴다.
fn cached_hit(agent: &str, roots: &[PathBuf], id: &str) -> Option<(PathBuf, String)> {
    let mut hit: Vec<(i64, PathBuf, String)> = {
        let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .iter()
            .filter(|(path, e)| e.agent == agent && roots.iter().any(|r| path.starts_with(r)))
            .filter_map(|(path, e)| {
                e.parsed
                    .as_ref()
                    .filter(|p| p.id == id)
                    .map(|p| (e.mtime_ms, path.clone(), p.cwd.clone()))
            })
            .collect()
    };
    hit.sort_by_key(|(m, _, _)| std::cmp::Reverse(*m));
    hit.into_iter()
        .find(|(_, path, _)| path.is_file())
        .map(|(_, path, cwd)| (path, cwd))
}

/// 포크 파일은 부모 id 도 이름에 품으니 파싱한 id 로 확정한다.
fn locate(t: &'static SessionTarget, roots: &[PathBuf], id: &str) -> Option<(PathBuf, String)> {
    let SessionSource::JsonlFiles { layout, .. } = &t.source;
    for root in roots {
        let files: Vec<PathBuf> = match layout {
            Layout::DirPerProject => entries_desc(root)
                .into_iter()
                .map(|d| d.join(format!("{id}.jsonl")))
                .filter(|p| p.is_file())
                .collect(),
            Layout::DateTree => candidates(layout, root)
                .into_iter()
                .map(|s| s.path)
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().to_ascii_lowercase().contains(id))
                })
                .collect(),
        };
        for f in files.into_iter().filter_map(stamp) {
            if let Some(p) = parsed_of(t, &f).filter(|p| p.id == id) {
                return Some((f.path.clone(), p.cwd.clone()));
            }
        }
    }
    None
}

/// `into` — 새 대화로 계속을 기록된 폴더가 아니라 이 폴더에서 연다(기록된 폴더가 지워졌어도 된다).
/// 재개에는 받지 않는다 — 같은 대화를 다른 폴더에서 이으면 그 대화가 두 폴더에 걸친다.
fn launch_spec_in(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
    mode: &str,
    into: Option<&str>,
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
    if let Some(into) = into {
        if mode != "fork" {
            return Err(tr!(
                ko: "다른 폴더로 가져오기는 새 대화로 계속할 때만 됩니다",
                en: "Only continuing as a new conversation can move to another folder"
            ));
        }
        if !Path::new(into).is_dir() {
            return Err(
                tr!(ko: "폴더가 없습니다: {into}", en: "The folder does not exist: {into}"),
            );
        }
        cached_hit(t.id, roots, &id)
            .or_else(|| locate(t, roots, &id))
            .ok_or_else(
                || tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation"),
            )?;
        return Ok(LaunchSpec {
            cwd: into.to_string(),
            command: join_argv(&argv)?,
        });
    }
    let cwd = recorded_cwd_in(t, roots, &id).map_err(|m| match m {
        CwdMiss::BadId => {
            tr!(ko: "대화 id 모양이 올바르지 않습니다", en: "The conversation id is malformed")
        }
        CwdMiss::NotFound => {
            tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation")
        }
        CwdMiss::NoFolder(cwd) => tr!(
            ko: "대화의 폴더가 없습니다: {cwd}",
            en: "The conversation's folder no longer exists: {cwd}"
        ),
    })?;
    Ok(LaunchSpec {
        cwd,
        command: join_argv(&argv)?,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CwdMiss {
    BadId,
    NotFound,
    NoFolder(String),
}

/// 화면이 넘긴 경로는 받지 않는다 — 목록과 같은 색인에서만 고르고, 지금 폴더로 있을 때만 준다.
pub(crate) fn recorded_cwd_in(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
) -> Result<String, CwdMiss> {
    if !(t.id_ok)(id) {
        return Err(CwdMiss::BadId);
    }
    let id = id.to_ascii_lowercase();
    let (_, cwd) = cached_hit(t.id, roots, &id)
        .or_else(|| locate(t, roots, &id))
        .ok_or(CwdMiss::NotFound)?;
    if !Path::new(&cwd).is_dir() {
        return Err(CwdMiss::NoFolder(cwd));
    }
    Ok(cwd)
}

/// 화면이 넘긴 경로는 받지 않는다 — 목록과 같은 색인에서만 골라, 돌려주는 경로는 언제나 그 에이전트의 루트 아래이고 파싱해 같은 id 로 확인된 파일이다.
/// 예외 — Claude 는 파싱이 대화를 못 알아봐도 이름이 곧 id 인 파일을 쓴다([`named_file`]): 큰 요청 기록 줄이 앞 · 꼬리를 차지하는 동안 파싱이 `None` 이다.
pub(crate) fn conversation_file(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
) -> Result<PathBuf, String> {
    if !(t.id_ok)(id) {
        return Err(
            tr!(ko: "대화 id 모양이 올바르지 않습니다", en: "The conversation id is malformed"),
        );
    }
    let id = id.to_ascii_lowercase();
    cached_hit(t.id, roots, &id)
        .or_else(|| locate(t, roots, &id))
        .map(|(path, _)| path)
        .or_else(|| named_file(t, roots, &id))
        .ok_or_else(|| tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation"))
}

/// 첫 줄 하나(줄 상한 [`HEAD_LINE_EXTRA_MAX`]) — Codex 의 `session_meta` 는 지침을 품어 수십 KB 다.
pub(crate) fn first_line_json(path: &Path) -> Option<Value> {
    let f = std::fs::File::open(path).ok()?;
    let mut line = Vec::new();
    std::io::BufRead::read_until(&mut std::io::BufReader::new(f.take(HEAD_LINE_EXTRA_MAX)), b'\n', &mut line).ok()?;
    serde_json::from_slice(&line).ok()
}

/// Codex 대화 하나의 롤아웃 파일들(되감기 조각 포함) — 이름에 id 가 들고 첫 줄 `session_meta.id == id` 인 것 · 이름(만든 순) 순. 목록 · 색인과 따로 논다.
pub(crate) fn codex_files_of(roots: &[PathBuf], id: &str) -> Vec<PathBuf> {
    const FILES_MAX: usize = 64;
    let id = id.to_ascii_lowercase();
    let mut out: Vec<PathBuf> = Vec::new();
    for root in roots {
        for y in entries_desc(root).into_iter().filter(|d| d.is_dir()) {
            for m in entries_desc(&y).into_iter().filter(|d| d.is_dir()) {
                for d in entries_desc(&m).into_iter().filter(|d| d.is_dir()) {
                    out.extend(entries_desc(&d).into_iter().filter(|p| {
                        is_jsonl(p) && p.file_name().is_some_and(|n| n.to_string_lossy().to_ascii_lowercase().contains(&id))
                    }));
                }
            }
        }
    }
    out.retain(|p| {
        first_line_json(p).is_some_and(|v| v["type"] == "session_meta" && str_of(&v["payload"]["id"]).is_some_and(|x| x.eq_ignore_ascii_case(&id)))
    });
    out.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    let over = out.len().saturating_sub(FILES_MAX);
    out.drain(..over);
    out
}

/// `id` 는 부르는 쪽이 모양을 확인했다(경로 글자 없음).
fn named_file(t: &'static SessionTarget, roots: &[PathBuf], id: &str) -> Option<PathBuf> {
    let SessionSource::JsonlFiles { layout, .. } = &t.source;
    if !matches!(layout, Layout::DirPerProject) {
        return None;
    }
    roots
        .iter()
        .flat_map(|root| entries_desc(root).into_iter().filter(|d| d.is_dir()))
        .filter_map(|d| stamp(d.join(format!("{id}.jsonl"))))
        .max_by_key(|f| f.mtime_ms)
        .map(|f| f.path)
}

/// 목록과 같은 제목. 메신저 알림(`crate::messenger`)이 켠 사람에게만 싣는다. `path` 는 [`conversation_file`] 이 고른 것이어야 한다.
pub(crate) fn conversation_title_at(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    path: &Path,
) -> Option<String> {
    let f = stamp(path.to_path_buf())?;
    let p = parsed_of(t, &f)?;
    let titles = match (t.custom_titles, roots.iter().find(|r| path.starts_with(r))) {
        (Some(read), Some(root)) => read(root),
        _ => HashMap::new(),
    };
    Some(record(t, &p, f.mtime_ms, titles.get(&p.id), true).title)
}

#[cfg(test)]
pub(crate) fn launch_lines_for_tests(
    claude_id: &str,
    codex_id: &str,
) -> Vec<(&'static str, &'static str, String)> {
    let mut out = Vec::new();
    for t in TARGETS {
        let id = if t.id == "codex" { codex_id } else { claude_id };
        out.push((t.id, "resume", join_argv(&(t.resume_argv)(id)).unwrap()));
        if let Some(f) = t.fork_argv {
            out.push((t.id, "fork", join_argv(&f(id)).unwrap()));
        }
    }
    out
}

#[tauri::command]
pub async fn agent_session_launch_spec(
    agent: String,
    id: String,
    mode: String,
    into: Option<String>,
) -> Result<LaunchSpec, String> {
    let t = target(&agent)?;
    tauri::async_runtime::spawn_blocking(move || {
        launch_spec_in(t, &(t.roots)(), &id, &mode, into.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) mod codex_rpc;
pub(crate) mod delete;
pub(crate) mod edit;
pub(crate) mod rename;

#[cfg(test)]
mod tests;
