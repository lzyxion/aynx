//! **사이드 채팅 · 프로듀서 MCP 토큰 · 연결 표**(docs/log/2026-10-23-side-chat-v2-design.md 2절 MCP). 세션 서버 프로세스에 한 벌.
//!
//! 사이드 채팅 프로세스는 세션 코어에 오르지 않아 타일 토큰(`crate::tile_token`)과 따로 둔다 — 토큰은 **`(채팅, 프로세스 세대)`** 에
//! 묶이고, 세대 `server::chat_proc::ProcId` 는 **서버 전역 단조 증가 · 재사용 없음**이다(같은 채팅을 닫고 다시 열어도 옛 세대와 겹치지
//! 않는다). 거두기([`revoke`])는 정확히 같은 `ProcId` 만 — 새 세대가 갈아 치운 칸은 건드리지 않는다. 표는 메모리뿐이다.
//!
//! ## 연결(link)
//!
//! 채팅마다 사람이 칩으로 고른 세션들 — 바꾸는 길은 서버 op `side_chat_link`(Tauri 명령 · 주 창 · 원격 HOME_ONLY) 하나다. 프로세스와
//! 따로 산다. MCP(`mcp/chat_read.rs`)는 **연결된 동안만** 그 세션들의 읽기를 받아 주고, 판정은 요청마다 서버가 한다(Codex 는 대화 중
//! 목록 갱신을 받지 않아 도구 목록은 바뀌지 않는다).
//!
//! ## 불변식
//!
//! - **값은 서버만** — Claude 는 그 프로세스의 임시 `--mcp-config` 파일(끝나면 지운다), Codex 는 그 프로세스의 환경 변수에만.
//!   **프런트 · 로그 · `Debug` · 영속 파일 · 이벤트에 없다**(`Debug` 를 파생하지 않는다 — 시험 `chat_token_never_reaches_frontend`).
//! - 사이드 채팅 토큰은 **읽기 도구만** 받는다(DB · 작업안 · 조율 도구 없음 — `mcp/rpc.rs`). 같은 계정 안의 보안 경계가 아니다
//!   (타일 토큰과 같은 등급 → docs/invariants.md 전문 9).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use crate::server::chat_proc::ProcId;

/// 토큰은 알지만 그 채팅의 프로세스가 끝났거나 다시 떴다(401 몸).
pub(crate) const STALE_CHAT_TOKEN: &str = "stale-chat-token";
/// 같은 채팅 세대 · 같은 `requestId` 인데 입력이 다르다(`orchestration::store::reason` 도 같은 낱말).
pub(crate) const REQUEST_ID_REUSED: &str = "request-id-reused";
/// 같은 `requestId` 의 처음 호출이 아직 효과를 내는 중이다.
pub(crate) const REQUEST_IN_PROGRESS: &str = "request-in-progress";

/// **세션 읽기 일곱** — `mcp/chat_read.rs` 의 목록 · CLI 미리 허용이 함께 쓴다. DB · 작업안 · 조율 도구는 없다.
pub(crate) const READ_TOOLS: [&str; 7] = [
    "list_sessions",
    "get_last_command",
    "get_scrollback",
    "list_commands",
    "get_command",
    "get_session_snapshot",
    "compare_command_results",
];

/// 판정만 다르다 — 사이드 채팅은 요청마다 그 채팅의 지금 프로세스 세대를 표 밖에서 보고(`server::side_chat::live_proc`), **프로듀서는
/// 칸이 있는 것 자체가 생존**이다(코어가 닫기를 시작하는 순간 칸을 먼저 거둔다 — 인증은 이 표의 잠금 하나만 본다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChatKind {
    Side,
    Producer,
}

/// 멱등 기록 한 줄(`start_run` · `adopt_run` · `complete_run`).
struct Rec {
    request_id: String,
    tool: String,
    input_sha: String,
    /// `None` = 처음 호출이 아직 효과를 내는 중.
    result: Option<serde_json::Value>,
}

/// 스튜디오 칸 "프로듀서 작업안 도구"를 켰을 때만 프로듀서 목록 · 미리 허용에 싣고(띄울 때 값), 호출마다 지금 값으로 다시 판정한다
/// (`mcp/rpc.rs`).
pub(crate) const PRODUCER_PLAN_TOOLS: [&str; 7] = [
    "create_execution_plan",
    "request_execution",
    "get_operation",
    "wait_for_operation",
    "get_operation_results",
    "get_auto_approval_policy",
    "create_db_write_plan",
];

/// 구조 읽기(행 없음 · Schema 등급) — 행을 읽는 `db_query` 는 권한 카드.
pub(crate) const PRODUCER_DB_SCHEMA_TOOLS: [&str; 5] =
    ["list_db_connections", "db_list_schemas", "db_list_objects", "db_describe_table", "db_get_definition"];

/// **`Debug` 를 파생하지 않는다**(토큰).
struct Entry {
    token: String,
    proc: ProcId,
    kind: ChatKind,
    /// 서버가 준비한 앨범 저장소 — 몸의 경로를 그대로 싣지 않는다.
    repo: Option<String>,
    /// 사람이 연 앨범 또는 이어받기 대상. 옛 시작 길만 `None` 을 쓴다.
    album: Option<String>,
    /// 띄울 때의 "프로듀서 작업안 도구" 값 — 목록은 이 값으로 고정 · 판정은 호출마다 지금 맡기기.
    plan_tools: bool,
    /// 토큰과 함께 사라진다 — 같은 프로세스 안의 재시도만 처음 결과.
    requests: std::collections::VecDeque<Rec>,
}

const REQUESTS_MAX: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Auth {
    /// **인증한 세대**가 호출자에 그대로 실린다 — 요청 처리 중 지금 세대로 바꾸지 않는다.
    Chat { chat: String, kind: ChatKind, proc: ProcId },
    /// 토큰은 표에 있지만 그 세대의 프로세스가 아니다.
    Stale,
}

/// 넘으면 `[too-many-links]`.
pub(crate) const LINKS_MAX: usize = 8;

#[derive(Default)]
pub(crate) struct ChatTokens {
    tokens: HashMap<String, Entry>,
    links: HashMap<String, Vec<String>>,
}

impl ChatTokens {
    pub(crate) fn insert(&mut self, chat: &str, token: String, proc: ProcId) {
        self.insert_kind(chat, token, proc, ChatKind::Side, None, false);
    }

    pub(crate) fn insert_kind(&mut self, chat: &str, token: String, proc: ProcId, kind: ChatKind, repo: Option<String>, plan_tools: bool) {
        self.tokens.insert(chat.to_string(), Entry { token, proc, kind, repo, album: None, plan_tools, requests: Default::default() });
    }

    pub(crate) fn plan_tools(&self, chat: &str, proc: ProcId) -> bool {
        self.tokens.get(chat).is_some_and(|e| e.proc == proc && e.plan_tools)
    }

    /// 프로듀서의 생존 재확인 — Run 을 세우는 잠금 안에서.
    pub(crate) fn current(&self, chat: &str, proc: ProcId) -> bool {
        self.tokens.get(chat).is_some_and(|e| e.proc == proc)
    }

    pub(crate) fn repo(&self, chat: &str, proc: ProcId) -> Option<String> {
        self.tokens.get(chat).filter(|e| e.proc == proc).and_then(|e| e.repo.clone())
    }

    fn begin_request(&mut self, chat: &str, proc: ProcId, request_id: &str, tool: &str, sha: &str) -> Result<Option<serde_json::Value>, &'static str> {
        let e = self.tokens.get_mut(chat).filter(|e| e.proc == proc).ok_or(STALE_CHAT_TOKEN)?;
        if let Some(r) = e.requests.iter().find(|r| r.request_id == request_id) {
            if r.tool != tool || r.input_sha != sha {
                return Err(REQUEST_ID_REUSED);
            }
            return r.result.clone().map(Some).ok_or(REQUEST_IN_PROGRESS);
        }
        if e.requests.len() >= REQUESTS_MAX {
            match e.requests.iter().position(|r| r.result.is_some()) {
                Some(i) => {
                    e.requests.remove(i);
                }
                None => return Err(REQUEST_IN_PROGRESS),
            }
        }
        e.requests.push_back(Rec { request_id: request_id.into(), tool: tool.into(), input_sha: sha.into(), result: None });
        Ok(None)
    }

    /// 실패는 줄을 지운다. 칸이 사라졌거나 세대가 바뀌었으면 아무 일 없음 — 새 세대에 닿지 않는다.
    fn finish_request(&mut self, chat: &str, proc: ProcId, request_id: &str, result: Option<serde_json::Value>) {
        let Some(e) = self.tokens.get_mut(chat).filter(|e| e.proc == proc) else { return };
        match result {
            Some(v) => {
                if let Some(r) = e.requests.iter_mut().find(|r| r.request_id == request_id) {
                    r.result = Some(v);
                }
            }
            None => e.requests.retain(|r| r.request_id != request_id),
        }
    }

    /// **그 채팅의 칸이 정확히 이 세대일 때만** 거둔다.
    pub(crate) fn revoke(&mut self, chat: &str, proc: ProcId) -> bool {
        if self.tokens.get(chat).is_some_and(|e| e.proc == proc) {
            self.tokens.remove(chat);
            return true;
        }
        false
    }

    /// 상수 시간으로 **전부** 훑는다.
    fn lookup(&self, header: Option<&str>) -> Option<(String, ProcId, ChatKind)> {
        let presented = header?.strip_prefix("Bearer ")?.trim();
        if presented.is_empty() {
            return None;
        }
        let mut hit: Option<(&String, ProcId, ChatKind)> = None;
        for (chat, e) in &self.tokens {
            if crate::token::ct_eq(e.token.as_bytes(), presented.as_bytes()) {
                hit = Some((chat, e.proc, e.kind));
            }
        }
        hit.map(|(c, p, k)| (c.clone(), p, k))
    }

    #[cfg(test)]
    pub(crate) fn authenticate(&self, header: Option<&str>, live: impl Fn(&str) -> Option<ProcId>) -> Option<Auth> {
        let (chat, proc, kind) = self.lookup(header)?;
        let alive = kind == ChatKind::Producer || live(&chat) == Some(proc);
        Some(if alive { Auth::Chat { chat, kind, proc } } else { Auth::Stale })
    }

    /// 거르기 · 상한은 부르는 쪽(`op_link`) — 바뀌었나를 돌려준다.
    pub(crate) fn set_links(&mut self, chat: &str, streams: Vec<String>) -> bool {
        let changed = self.links(chat) != streams;
        if streams.is_empty() {
            self.links.remove(chat);
        } else {
            self.links.insert(chat.to_string(), streams);
        }
        changed
    }

    pub(crate) fn links(&self, chat: &str) -> Vec<String> {
        self.links.get(chat).cloned().unwrap_or_default()
    }

    pub(crate) fn forget(&mut self, chat: &str) {
        self.tokens.remove(chat);
        self.links.remove(chat);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.tokens.len()
    }
}

/// 잠금은 문장 하나 안에서 끝난다 — 사이드 채팅 잠금을 쥔 채 잡을 수는 있지만, 이 잠금을 쥔 채 사이드 채팅 표를 잡지 않는다.
static TABLE: LazyLock<Mutex<ChatTokens>> = LazyLock::new(Default::default);

fn table() -> std::sync::MutexGuard<'static, ChatTokens> {
    TABLE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 프로세스를 띄우기 **전에** 뽑는다. 실패면 `None` — 그 프로세스는 MCP 없이 뜬다.
pub(crate) fn issue(chat: &str, proc: ProcId) -> Option<String> {
    if !crate::side_chat::store::id_ok(chat) {
        return None;
    }
    let token = crate::token::generate_token()?;
    table().insert(chat, token.clone(), proc);
    Some(token)
}

pub(crate) fn revoke(chat: &str, proc: ProcId) -> bool {
    table().revoke(chat, proc)
}

/// 저장소 · 앨범 id 는 서버의 준비 Run · 이어받기 대상에서 온다. 실패면 `None` — MCP 없이 띄우지 않는다.
pub(crate) fn issue_producer(chat: &str, proc: ProcId, repo: &str, album: Option<&str>, plan_tools: bool) -> Option<String> {
    if !crate::side_chat::store::id_ok(chat) {
        return None;
    }
    let token = crate::token::generate_token()?;
    let mut t = table();
    t.insert_kind(chat, token.clone(), proc, ChatKind::Producer, Some(repo.to_string()), plan_tools);
    t.tokens.get_mut(chat)?.album = album.map(str::to_string);
    Some(token)
}

pub(crate) fn plan_tools_listed(chat: &str, proc: ProcId) -> bool {
    table().plan_tools(chat, proc)
}

/// 프로듀서는 칸이 곧 생존이라 이 표의 잠금 하나로 끝난다(채팅 잠금을 잡지 않는다).
pub(crate) fn authenticate(header: Option<&str>) -> Option<Auth> {
    let (chat, proc, kind) = table().lookup(header)?;
    let alive = match kind {
        ChatKind::Producer => true,
        ChatKind::Side => crate::server::side_chat::live_proc(&chat) == Some(proc),
    };
    Some(if alive { Auth::Chat { chat, kind, proc } } else { Auth::Stale })
}

/// 잠금 순서는 오케스트레이션 잠금 → 이 표 잠금뿐이다.
pub(crate) fn still_current(chat: &str, proc: ProcId) -> bool {
    table().current(chat, proc)
}

pub(crate) fn repo_of(chat: &str, proc: ProcId) -> Option<String> {
    table().repo(chat, proc)
}

/// 이어받기는 같은 저장소의 다른 앨범도 허용하지 않는다.
pub(crate) fn album_of(chat: &str, proc: ProcId) -> Option<String> {
    table().tokens.get(chat).filter(|e| e.proc == proc).and_then(|e| e.album.clone())
}

/// 객체 열쇠를 정렬한다 — 열쇠 순서와 무관하게 같다. `requestId` 는 뺀다(부르는 쪽이 이미 뺀 것을 준다). 오케스트레이션 Run 단위
/// 요청 기록(`orchestration::store::rules::request_sha`)이 같은 함수를 쓴다.
pub(crate) fn input_sha(input: &serde_json::Value) -> String {
    use serde_json::Value;
    fn canon(v: &Value, out: &mut String) {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                out.push('{');
                for (i, k) in keys.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&Value::String(k.clone()).to_string());
                    out.push(':');
                    canon(&m[k], out);
                }
                out.push('}');
            }
            Value::Array(a) => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    canon(x, out);
                }
                out.push(']');
            }
            other => out.push_str(&other.to_string()),
        }
    }
    let mut s = String::new();
    canon(input, &mut s);
    crate::orchestration::verify::sha256_hex(s.as_bytes())
}

/// 역할 판정보다 앞. 효과는 표 잠금 **밖에서** 돈다. 오류 글자는 `code: message`.
pub(crate) fn with_request(
    chat: &str,
    proc: ProcId,
    request_id: &str,
    tool: &str,
    input: &serde_json::Value,
    run: impl FnOnce() -> Result<serde_json::Value, String>,
) -> Result<serde_json::Value, String> {
    let sha = input_sha(input);
    let seen = table().begin_request(chat, proc, request_id, tool, &sha);
    match seen {
        Ok(Some(first)) => return Ok(first),
        Ok(None) => {}
        Err(code) => {
            let message = match code {
                REQUEST_ID_REUSED => {
                    format!("requestId {request_id} was already used with a different input — use a new requestId for a different call")
                }
                REQUEST_IN_PROGRESS => {
                    "the first call with this requestId is still running — call again later with the same requestId to read its result".to_string()
                }
                _ => "this producer process ended or was replaced — the token is no longer valid".to_string(),
            };
            return Err(format!("{code}: {message}"));
        }
    }
    let out = run();
    table().finish_request(chat, proc, request_id, out.as_ref().ok().cloned());
    out
}

#[cfg(test)]
pub(crate) fn insert_producer_for_test(chat: &str, proc: ProcId, repo: &str, plan_tools: bool) -> String {
    let token = crate::token::generate_token().unwrap();
    table().insert_kind(chat, token.clone(), proc, ChatKind::Producer, Some(repo.to_string()), plan_tools);
    token
}

/// **시험 전용 가짜 프로듀서 채팅** — 끝나면(drop) 그 세대의 칸만 거둔다. 채팅 id 는 시험마다 겹치지 않는다(전역 표를 함께 쓴다).
#[cfg(test)]
pub(crate) struct FakeProducer {
    pub chat: String,
    pub proc: ProcId,
    pub token: String,
}

#[cfg(test)]
impl FakeProducer {
    pub(crate) fn open(tag: &str, repo: &str) -> FakeProducer {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let chat = format!("pc-{tag}-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::SeqCst));
        let proc = ProcId::next();
        let token = insert_producer_for_test(&chat, proc, repo, false);
        FakeProducer { chat, proc, token }
    }

    pub(crate) fn caller(&self) -> crate::orchestration::Caller {
        crate::orchestration::Caller::Producer { chat: self.chat.clone(), proc: self.proc }
    }

    pub(crate) fn seat(&self) -> crate::orchestration::Seat {
        crate::orchestration::Seat { chat: self.chat.clone(), proc: self.proc }
    }

    pub(crate) fn header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    pub(crate) fn close(&self) -> bool {
        revoke(&self.chat, self.proc)
    }


}

#[cfg(test)]
impl Drop for FakeProducer {
    fn drop(&mut self) {
        self.close();
    }
}

/// 서버 op `side_chat_link` 만.
pub(crate) fn set_links(chat: &str, streams: Vec<String>) -> bool {
    table().set_links(chat, streams)
}

pub(crate) fn links_of(chat: &str) -> Vec<String> {
    table().links(chat)
}

pub(crate) fn forget(chat: &str) {
    table().forget(chat);
}

#[cfg(test)]
pub(crate) fn set_album_for_test(chat: &str, proc: ProcId, album: &str) {
    if let Some(e)=table().tokens.get_mut(chat).filter(|e| e.proc==proc) { e.album=Some(album.into()); }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 시험 `chat_token_bound_to_process_epoch` — 옛 세대의 늦은 거두기는 새 칸을 거두지 못한다.
    #[test]
    fn chat_token_bound_to_process_epoch() {
        let mut t = ChatTokens::default();
        let (p1, p2) = (ProcId::next(), ProcId::next());
        t.insert("c1", "tok-1".into(), p1);
        let live1 = |c: &str| (c == "c1").then_some(p1);
        let live2 = |c: &str| (c == "c1").then_some(p2);
        let dead = |_: &str| None::<ProcId>;
        let side = |proc| Some(Auth::Chat { chat: "c1".into(), kind: ChatKind::Side, proc });
        assert_eq!(t.authenticate(Some("Bearer tok-1"), live1), side(p1));
        assert_eq!(t.authenticate(Some("Bearer tok-1"), live2), Some(Auth::Stale), "다시 뜸");
        assert_eq!(t.authenticate(Some("Bearer tok-1"), dead), Some(Auth::Stale), "끝남");
        assert_eq!(t.authenticate(Some("Bearer nope"), live1), None);
        assert_eq!(t.authenticate(Some("Bearer "), live1), None);
        assert_eq!(t.authenticate(Some("tok-1"), live1), None);
        assert_eq!(t.authenticate(None, live1), None);
        t.insert("c1", "tok-2".into(), p2);
        assert_eq!(t.authenticate(Some("Bearer tok-1"), live2), None);
        assert_eq!(t.authenticate(Some("Bearer tok-2"), live2), side(p2));
        assert!(!t.revoke("c1", p1));
        assert_eq!(t.len(), 1);
        assert!(t.revoke("c1", p2));
        assert_eq!(t.authenticate(Some("Bearer tok-2"), live2), None, "거둔 뒤엔 모르는 토큰");
    }

    /// 시험 `chat_token_never_reaches_frontend` — 값이 닿는 곳은 서버의 실행 재료(임시 `--mcp-config` · Codex 환경 변수) 둘뿐이다.
    #[test]
    fn chat_token_never_reaches_frontend() {
        fn strip(s: &str) -> String {
            s.replace("\r\n", "\n").split("\nmod tests {").next().unwrap_or("").to_string()
        }
        // (1) GUI 의 Tauri 명령(사이드 채팅 프록시 · AI 프록시)은 채팅 토큰 표를 부르지 않는다.
        for (name, src) in [
            ("side_chat_proxy.rs", include_str!("server/side_chat_proxy.rs")),
            ("ai_proxy.rs", include_str!("server/ai_proxy.rs")),
            ("proxy.rs", include_str!("server/proxy.rs")),
        ] {
            assert!(!src.contains("chat_token"), "{name} 가 채팅 토큰 표를 안다");
        }
        // (2) 서버 표: 토큰 값이 실리는 곳은 실행 재료 둘(Claude 파일 본문 · Codex 환경)뿐 — 스냅숏 · 목록 · 연결 보기 · 사건 · 로그에 없다.
        let srv = strip(include_str!("server/side_chat.rs"));
        assert_eq!(srv.matches("m.token").count(), 2, "토큰 값을 쓰는 곳은 둘");
        assert!(srv.contains("claude::mcp_config(m.name, &m.url, &m.token)"));
        assert!(srv.contains("add.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), m.token.clone()));"));
        // 공용 프로세스 코어는 토큰을 모른다 — 실행 재료(`Launch`)를 그대로 넘길 뿐 칸을 읽지 않고, 로그 · 이벤트를 쓰지 않는다.
        let core: Vec<(&str, String)> = [
            ("chat_proc/mod.rs", strip(include_str!("server/chat_proc/mod.rs"))),
            ("chat_proc/io.rs", strip(include_str!("server/chat_proc/io.rs"))),
            ("chat_proc/spawn.rs", strip(include_str!("server/chat_proc/spawn.rs"))),
        ]
        .into_iter()
        .collect();
        for (name, src) in &core {
            for bad in ["chat_token", "log::line(", "hub::emit(", "json!(", ".token"] {
                assert!(!src.contains(bad), "{name} 에 {bad}");
            }
        }
        for line in srv.lines().filter(|l| l.contains("log::line(") || l.contains("hub::emit(") || l.contains("json!({")) {
            assert!(!line.to_ascii_lowercase().contains("token"), "{line}");
        }
        for f in ["fn snapshot(", "fn list(", "fn link_view(", "fn op_link("] {
            let at = srv.find(f).unwrap();
            let body = &srv[at..at + srv[at..].find("\n}").unwrap()];
            // 연결을 읽는 `chat_token::links_of` 는 된다 — 토큰 값(`.token`) · 뽑기(`issue(`)는 안 된다.
            assert!(!body.contains(".token") && !body.contains("issue(") && !body.contains("\"token"), "{f} 에 토큰");
        }
        // (2') 프로듀서: GUI 껍데기는 표를 모르고, 레지스트리 · 실행 재료의 로그 · 사건 · 스냅숏에 토큰이 없다.
        assert!(!include_str!("server/producer_proxy.rs").contains("chat_token"), "producer_proxy.rs 가 채팅 토큰 표를 안다");
        let reg = strip(include_str!("server/producer/mod.rs"));
        let launch = strip(include_str!("server/producer/launch.rs"));
        for (name, src) in [("producer/mod.rs", &reg), ("producer/launch.rs", &launch)] {
            for line in src.lines().filter(|l| l.contains("log::line(") || l.contains("hub::emit(") || l.contains("json!({")) {
                assert!(!line.to_ascii_lowercase().contains("token"), "{name}: {line}");
            }
        }
        for f in ["fn snapshot(", "fn list(", "fn emit(", "fn notice("] {
            let at = reg.find(f).unwrap();
            let body = &reg[at..at + reg[at..].find("\n}").unwrap()];
            assert!(!body.contains("token") && !body.contains("issue_producer("), "{f} 에 토큰");
        }
        let uses: Vec<&str> = launch
            .lines()
            .filter(|l| !l.trim_start().starts_with("//") && l.contains("token") && !l.contains("token_env") && !l.contains("chat_token::"))
            .collect();
        assert_eq!(uses.len(), 3, "토큰 값 = 받기 하나 + 쓰는 곳 둘: {uses:?}");
        assert!(launch.contains("claude::mcp_config(server, url, token)"));
        assert!(launch.contains("add.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), token.to_string()));"));
        // (3) 토큰이 든 구조는 `Debug` 를 파생하지 않는다.
        let me = strip(include_str!("chat_token.rs"));
        let spawn = &core[2].1;
        for (src, ty) in [(&me, "struct Entry"), (&me, "struct ChatTokens"), (&srv, "struct ChatMcp"), (spawn, "struct Launch")] {
            let at = src.find(ty).unwrap();
            let head = &src[src[..at].rfind("\n\n").unwrap_or(0)..at];
            assert!(!head.lines().any(|l| l.trim_start().starts_with("#[derive") && l.contains("Debug")), "{ty} 가 Debug 를 파생한다");
        }
        // (4) 프런트 소스에 채팅 토큰을 부르는 글자가 없다.
        fn walk(dir: &std::path::Path, hits: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, hits);
                } else if p.extension().is_some_and(|x| x == "ts" || x == "svelte") {
                    let s = std::fs::read_to_string(&p).unwrap_or_default();
                    if ["chat_token", "chatToken", "STALE_CHAT_TOKEN", "stale-chat-token"].iter().any(|n| s.contains(n)) {
                        hits.push(p.display().to_string());
                    }
                }
            }
        }
        let mut hits = Vec::new();
        walk(std::path::Path::new("../src"), &mut hits);
        assert!(hits.is_empty(), "{hits:?}");
    }

    /// 시험 `producer_token_is_its_own_liveness` — 프로듀서 칸은 **칸이 곧 생존**이고 멱등 기록은 그 세대 칸과 함께 사라진다.
    #[test]
    fn producer_token_is_its_own_liveness() {
        let mut t = ChatTokens::default();
        let (p1, p2) = (ProcId::next(), ProcId::next());
        t.insert_kind("pc-x", "ptok".into(), p1, ChatKind::Producer, Some("C:/repo".into()), true);
        let never = |_: &str| None::<ProcId>;
        assert_eq!(t.authenticate(Some("Bearer ptok"), never), Some(Auth::Chat { chat: "pc-x".into(), kind: ChatKind::Producer, proc: p1 }));
        assert!(t.current("pc-x", p1) && !t.current("pc-x", p2));
        assert_eq!(t.repo("pc-x", p1).as_deref(), Some("C:/repo"));
        assert_eq!(t.repo("pc-x", p2), None);
        assert!(t.plan_tools("pc-x", p1) && !t.plan_tools("pc-x", p2));
        assert_eq!(t.begin_request("pc-x", p1, "r1", "start_run", "h"), Ok(None));
        assert_eq!(t.begin_request("pc-x", p1, "r1", "start_run", "h"), Err(REQUEST_IN_PROGRESS));
        t.finish_request("pc-x", p1, "r1", Some(serde_json::json!({"runId": "run-1"})));
        assert_eq!(t.begin_request("pc-x", p1, "r1", "start_run", "h"), Ok(Some(serde_json::json!({"runId": "run-1"}))));
        assert_eq!(t.begin_request("pc-x", p1, "r1", "start_run", "other"), Err(REQUEST_ID_REUSED));
        assert_eq!(t.begin_request("pc-x", p2, "r1", "start_run", "h"), Err(STALE_CHAT_TOKEN), "다른 세대는 기록에 닿지 않는다");
        assert!(t.revoke("pc-x", p1));
        assert_eq!(t.authenticate(Some("Bearer ptok"), never), None, "거둔 뒤엔 모르는 토큰(401)");
        t.insert_kind("pc-x", "ptok2".into(), p2, ChatKind::Producer, Some("C:/repo".into()), false);
        assert_eq!(t.begin_request("pc-x", p2, "r1", "start_run", "h"), Ok(None), "새 세대의 기록은 새로");
    }

    /// 같은 묶음을 다시 걸면 false — 머리글을 되풀이하지 않게.
    #[test]
    fn link_lives_apart_from_the_token() {
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let mut t = ChatTokens::default();
        assert!(t.set_links("c1", v(&["tile-a"])));
        assert!(!t.set_links("c1", v(&["tile-a"])), "같은 연결 = 바뀐 것 아님");
        assert!(t.set_links("c1", v(&["tile-a", "tile-b"])));
        assert!(t.set_links("c1", v(&["tile-b", "tile-a"])), "순서도 묶음의 일부");
        assert_eq!(t.links("c1"), v(&["tile-b", "tile-a"]));
        let p3 = ProcId::next();
        t.insert("c1", "tok".into(), p3);
        assert!(t.revoke("c1", p3));
        assert_eq!(t.links("c1"), v(&["tile-b", "tile-a"]), "프로세스가 끝나도 연결은 남는다");
        assert!(t.set_links("c1", Vec::new()));
        assert!(!t.set_links("c1", Vec::new()));
        assert!(t.links("c1").is_empty());
        t.set_links("c1", v(&["tile-c"]));
        t.insert("c1", "tok".into(), ProcId::next());
        t.forget("c1");
        assert!(t.links("c1").is_empty());
        assert_eq!(t.len(), 0);
    }
}
