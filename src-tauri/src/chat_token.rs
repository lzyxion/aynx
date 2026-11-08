//! **사이드 채팅 MCP 토큰 · 연결 표**(사이드 채팅 v2 5단계 — 설계 docs/log/2026-10-23-side-chat-v2-design.md 2절 MCP · 8절 1 (a) ·
//! v1 결정 10 "세션 연결 칩"). 세션 서버 프로세스에 한 벌.
//!
//! 타일 토큰(`crate::tile_token`)은 세션 코어의 `(stream, sessionEpoch)` 에 묶이는데, 사이드 채팅 프로세스는 세션 코어에 오르지 않는다
//! (`server::side_chat` 머리말) — 그래서 따로 둔다: 토큰은 **`(채팅, 프로세스 세대)`** 에 묶이고 호출자는 `Caller::SideChat{chat}` 이다.
//! 세대는 공용 채팅 프로세스 코어의 `server::chat_proc::ProcId` — **서버 전역 단조 증가 · 재사용 없음**(같은 채팅을 닫고 다시 열어도 옛 세대와
//! 겹치지 않는다 — 오케스트레이션 2단계 단계 1).
//!
//! ## 수명
//!
//! | 사건 | 토큰 |
//! | --- | --- |
//! | 프로세스를 띄움(`server::side_chat` 의 `prepare` — 보내기 op 의 게으른 띄우기) | 그 세대(새 `ProcId`)로 뽑는다([`issue`]) — 같은 채팅의 옛 칸은 갈아 치운다 |
//! | 프로세스가 끝남(끝 사건 · 닫기 · TTL · 모두 닫기) | 그 세대의 칸을 거둔다([`revoke`] — 정확히 같은 `ProcId` 만 · 새 세대가 갈아 치운 칸은 건드리지 않는다) |
//! | 서버 재시작 | 표가 메모리뿐이라 전부 새로 |
//!
//! **요청마다** 토큰이 가리키는 세대가 그 채팅의 지금 프로세스 세대와 같은지 본다([`authenticate`] — 아니면 `stale-chat-token`).
//!
//! ## 연결(link)
//!
//! 채팅마다 **사람이 칩으로 고른 세션 하나**(스트림 id — 서버 op `side_chat_link` 만 바꾼다 · Tauri 명령 · 주 창 · 원격 HOME_ONLY).
//! 프로세스와 따로 산다(띄우기 전에도 걸 수 있다 · 프로세스가 다시 떠도 그대로) — 채팅이 서버 표에서 빠지면 함께 빠지고([`forget`]),
//! 프런트가 `chats.json` 에 적어 두었다가 다시 붙을 때 다시 건다. MCP(`mcp/chat_read.rs`)는 **연결된 동안만** 읽기 도구를 받아 주고
//! 그 세션 하나만 보게 한다 — 판정은 요청마다 서버가(목록은 바뀌지 않는다 — Codex 는 대화 중 목록 갱신을 받지 않는다).
//!
//! ## 불변식
//!
//! - **값은 서버만** — Claude 는 그 프로세스의 임시 `--mcp-config` 파일(`<데이터 루트>/sidechat/.run/<id>-<세대>/` — 끝나면 지운다),
//!   Codex 는 그 프로세스의 환경 변수(`bearer_token_env_var`)에만. **프런트 · 로그 · `Debug` · 영속 파일 · 이벤트에 없다**(`Debug` 를 파생하지
//!   않는다 — 시험 `chat_token_never_reaches_frontend`).
//! - 이 토큰은 **읽기 도구만** 받는다(DB · 작업안 · 조율 도구 없음 — `mcp/rpc.rs`). 같은 계정 안의 보안 경계가 아니다(타일 토큰과 같은 등급).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use crate::server::chat_proc::ProcId;

/// 인증 실패 낱말 — 토큰은 알지만 그 채팅의 프로세스가 끝났거나 다시 떴다(401 몸).
pub(crate) const STALE_CHAT_TOKEN: &str = "stale-chat-token";
/// 같은 채팅 세대 · 같은 `requestId` 인데 입력이 다르다(오케스트레이션 Run 단위 기록 `orchestration::store::reason` 도 같은 낱말).
pub(crate) const REQUEST_ID_REUSED: &str = "request-id-reused";
/// 같은 `requestId` 의 처음 호출이 아직 효과를 내는 중이다.
pub(crate) const REQUEST_IN_PROGRESS: &str = "request-in-progress";

/// 사이드 채팅이 받는 MCP 도구 — **세션 읽기 일곱**(전역 13개 중 작업안 · 결과 · 정책 도구를 뺀 것 · `mcp/chat_read.rs` 의 목록 · CLI 미리 허용이
/// 함께 쓴다). DB · 작업안 · 조율 도구는 없다.
pub(crate) const READ_TOOLS: [&str; 7] = [
    "list_sessions",
    "get_last_command",
    "get_scrollback",
    "list_commands",
    "get_command",
    "get_session_snapshot",
    "compare_command_results",
];

/// 채팅의 종류(오케스트레이션 2단계 단계 2 — 설계 2-2). 같은 표 · 같은 수명 규칙이고, 판정만 다르다: 사이드 채팅은 요청마다 그 채팅의 지금
/// 프로세스 세대를 표 밖에서 보고(`server::side_chat::live_proc`), **프로듀서는 칸이 있는 것 자체가 생존**이다(코어가 닫기를 시작하는 순간 ·
/// 끝에서 칸을 먼저 거둔다 — 인증은 이 표의 잠금 하나만 본다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChatKind {
    Side,
    Producer,
}

/// 멱등 기록 한 줄(프로듀서의 `start_run` · `adopt_run` · `complete_run`).
struct Rec {
    request_id: String,
    tool: String,
    input_sha: String,
    /// `None` = 처음 호출이 아직 효과를 내는 중.
    result: Option<serde_json::Value>,
}

/// **프로듀서 작업안 도구**(오케스트레이션 2단계 단계 2 — 사용자 결정 O5): 전역 13 중 작업안 여섯 + DB 쓰기 초안. 스튜디오 칸 "프로듀서
/// 작업안 도구"를 켰을 때만 프로듀서 목록 · 미리 허용에 싣고(띄울 때 값), 호출마다 지금 값으로 다시 판정한다(`mcp/rpc.rs`).
pub(crate) const PRODUCER_PLAN_TOOLS: [&str; 7] = [
    "create_execution_plan",
    "request_execution",
    "get_operation",
    "wait_for_operation",
    "get_operation_results",
    "get_auto_approval_policy",
    "create_db_write_plan",
];

/// 프로듀서가 묻지 않고 부르는 DB 도구 — 구조 읽기(행 없음 · Schema 등급). 행을 읽는 `db_query` 는 권한 카드(설계 4-3).
pub(crate) const PRODUCER_DB_SCHEMA_TOOLS: [&str; 5] =
    ["list_db_connections", "db_list_schemas", "db_list_objects", "db_describe_table", "db_get_definition"];

/// 한 칸 — 토큰 · 그 프로세스 세대 · 종류 · (프로듀서) 스튜디오 경로 열쇠 · 멱등 기록. **`Debug` 를 파생하지 않는다**(토큰).
struct Entry {
    token: String,
    proc: ProcId,
    kind: ChatKind,
    /// 서버가 준비한 앨범 저장소(옛 시작 길은 맡긴 저장소 경로). 몸의 경로를 그대로 싣지 않는다.
    repo: Option<String>,
    /// 사람이 연 앨범 또는 이어받기 대상. 옛 시작 길만 None을 쓴다(R1까지).
    album: Option<String>,
    /// (프로듀서) 띄울 때의 "프로듀서 작업안 도구" 값(O5 — 목록은 이 값으로 고정 · 판정은 호출마다 지금 맡기기).
    plan_tools: bool,
    /// 멱등 기록(최근 [`REQUESTS_MAX`] — 토큰과 함께 사라진다 · 같은 프로세스 안의 재시도만 처음 결과).
    requests: std::collections::VecDeque<Rec>,
}

/// 칸 하나의 멱등 기록 상한.
const REQUESTS_MAX: usize = 32;

/// 토큰 확인 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Auth {
    /// 지금 프로세스의 채팅 — 채팅 id · 종류 · **인증한 세대**(호출자에 그대로 실린다 — 요청 처리 중 지금 세대로 바꾸지 않는다 · 설계 2-2).
    Chat { chat: String, kind: ChatKind, proc: ProcId },
    /// 토큰은 표에 있지만 그 세대의 프로세스가 아니다.
    Stale,
}

/// 채팅 → 토큰 칸 · 채팅 → 연결된 스트림. 순수 자료구조라 시험이 제 것을 만든다 — 서버는 전역 하나([`TABLE`]).
#[derive(Default)]
pub(crate) struct ChatTokens {
    tokens: HashMap<String, Entry>,
    links: HashMap<String, String>,
}

impl ChatTokens {
    pub(crate) fn insert(&mut self, chat: &str, token: String, proc: ProcId) {
        self.insert_kind(chat, token, proc, ChatKind::Side, None, false);
    }

    pub(crate) fn insert_kind(&mut self, chat: &str, token: String, proc: ProcId, kind: ChatKind, repo: Option<String>, plan_tools: bool) {
        self.tokens.insert(chat.to_string(), Entry { token, proc, kind, repo, album: None, plan_tools, requests: Default::default() });
    }

    /// 그 세대 칸이 띄울 때 받은 작업안 도구 값(없으면 거짓).
    pub(crate) fn plan_tools(&self, chat: &str, proc: ProcId) -> bool {
        self.tokens.get(chat).is_some_and(|e| e.proc == proc && e.plan_tools)
    }

    /// 그 채팅의 칸이 정확히 이 세대로 있나(프로듀서의 생존 재확인 — Run 을 세우는 잠금 안에서 · 설계 2-3).
    pub(crate) fn current(&self, chat: &str, proc: ProcId) -> bool {
        self.tokens.get(chat).is_some_and(|e| e.proc == proc)
    }

    /// 그 세대 칸의 스튜디오(없거나 다른 세대면 `None`).
    pub(crate) fn repo(&self, chat: &str, proc: ProcId) -> Option<String> {
        self.tokens.get(chat).filter(|e| e.proc == proc).and_then(|e| e.repo.clone())
    }

    /// 멱등 기록 시작 — 그 세대 칸이 없으면 `stale-chat-token` · 같은 열쇠의 다른 입력 `request-id-reused` · 진행 중 `request-in-progress`.
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

    /// 멱등 기록 끝 — 성공은 처음 결과로, 실패는 줄을 지운다(칸이 사라졌거나 세대가 바뀌었으면 아무 일 없음 — 새 세대에 닿지 않는다).
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

    /// 거둔다 — **그 채팅의 칸이 정확히 이 세대일 때만**(새 프로세스가 갈아 치운 칸은 둔다).
    pub(crate) fn revoke(&mut self, chat: &str, proc: ProcId) -> bool {
        if self.tokens.get(chat).is_some_and(|e| e.proc == proc) {
            self.tokens.remove(chat);
            return true;
        }
        false
    }

    /// `Authorization` 머리 → `(채팅, 세대)`. 모르는 토큰 · 빈 토큰 · `Bearer` 없는 머리면 `None`. 상수 시간으로 **전부** 훑는다.
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

    /// 판정 — `live` 는 "그 사이드 채팅의 지금 프로세스 세대"(시험이 끼운다 · 운영은 전역 [`authenticate`](fn@authenticate)). 프로듀서는
    /// 칸이 곧 생존이라 `live` 를 보지 않는다.
    #[cfg(test)]
    pub(crate) fn authenticate(&self, header: Option<&str>, live: impl Fn(&str) -> Option<ProcId>) -> Option<Auth> {
        let (chat, proc, kind) = self.lookup(header)?;
        let alive = kind == ChatKind::Producer || live(&chat) == Some(proc);
        Some(if alive { Auth::Chat { chat, kind, proc } } else { Auth::Stale })
    }

    /// 연결을 바꾼다 — 바뀌었나.
    pub(crate) fn set_link(&mut self, chat: &str, stream: Option<String>) -> bool {
        let before = self.links.get(chat).cloned();
        match &stream {
            Some(s) => {
                self.links.insert(chat.to_string(), s.clone());
            }
            None => {
                self.links.remove(chat);
            }
        }
        before != stream
    }

    pub(crate) fn link(&self, chat: &str) -> Option<String> {
        self.links.get(chat).cloned()
    }

    /// 채팅이 서버 표에서 빠졌다 — 토큰 · 연결 모두.
    pub(crate) fn forget(&mut self, chat: &str) {
        self.tokens.remove(chat);
        self.links.remove(chat);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.tokens.len()
    }
}

/// **세션 서버 프로세스의** 표 — `/mcp` 요청 스레드(인증 · 연결 읽기)와 사이드 채팅 op(뽑고 거두고 연결을 바꾸는 쪽)가 함께 본다. 잠금은
/// 문장 하나 안에서 끝난다(사이드 채팅 잠금을 쥔 채 잡을 수는 있지만, 이 잠금을 쥔 채 사이드 채팅 표를 잡지 않는다 — [`authenticate`] 는
/// 표에서 꺼낸 뒤 놓고 프로세스 세대를 본다).
static TABLE: LazyLock<Mutex<ChatTokens>> = LazyLock::new(Default::default);

fn table() -> std::sync::MutexGuard<'static, ChatTokens> {
    TABLE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 프로세스를 띄우기 **전에** 그 세대의 토큰을 뽑는다. 채팅 id 모양이 틀렸거나 OS 난수를 못 얻으면 `None`(그 프로세스는 MCP 없이 뜬다).
pub(crate) fn issue(chat: &str, proc: ProcId) -> Option<String> {
    if !crate::side_chat::store::id_ok(chat) {
        return None;
    }
    let token = crate::token::generate_token()?;
    table().insert(chat, token.clone(), proc);
    Some(token)
}

/// 그 세대의 프로세스가 끝났다(또는 띄우기가 실패했다) — 자기 칸만 거둔다.
pub(crate) fn revoke(chat: &str, proc: ProcId) -> bool {
    table().revoke(chat, proc)
}

/// 프로듀서의 그 세대 토큰을 띄우기 전에 뽑는다. 저장소와 앨범 id는 서버의 준비 Run · 이어받기 대상에서 온다.
/// R1까지 남는 옛 시작 길만 앨범 없이 맡긴 저장소를 받는다. 모양 · OS 난수 실패면 None(MCP 없이 띄우지 않는다).
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

/// 그 세대 프로듀서가 띄울 때 받은 작업안 도구 값(`tools/list` — O5 "새 프로듀서부터").
pub(crate) fn plan_tools_listed(chat: &str, proc: ProcId) -> bool {
    table().plan_tools(chat, proc)
}

/// `/mcp` 인증 — 채팅 토큰이면 `Some`(살아 있으면 [`Auth::Chat`] — 종류 · 세대를 싣는다, 아니면 [`Auth::Stale`]). 사이드 채팅은 표의 잠금을
/// 놓은 뒤 세대를 보고, 프로듀서는 칸이 곧 생존이라 이 표의 잠금 하나로 끝난다(채팅 잠금을 잡지 않는다 — 설계 2-6).
pub(crate) fn authenticate(header: Option<&str>) -> Option<Auth> {
    let (chat, proc, kind) = table().lookup(header)?;
    let alive = match kind {
        ChatKind::Producer => true,
        ChatKind::Side => crate::server::side_chat::live_proc(&chat) == Some(proc),
    };
    Some(if alive { Auth::Chat { chat, kind, proc } } else { Auth::Stale })
}

/// 그 프로듀서 칸이 정확히 이 세대로 살아 있나(Run 을 세우는 · 이어받는 잠금 안에서 — 오케스트레이션 잠금 → 이 표 잠금 순서만 · 설계 2-6).
pub(crate) fn still_current(chat: &str, proc: ProcId) -> bool {
    table().current(chat, proc)
}

/// 그 세대 프로듀서 칸의 스튜디오(`start_run` 의 저장소 기본값 · 비교 — 없으면 `None`).
pub(crate) fn repo_of(chat: &str, proc: ProcId) -> Option<String> {
    table().repo(chat, proc)
}

/// 인증한 그 세대의 앨범 범위. 이어받기는 같은 저장소의 다른 앨범도 허용하지 않는다.
pub(crate) fn album_of(chat: &str, proc: ProcId) -> Option<String> {
    table().tokens.get(chat).filter(|e| e.proc == proc).and_then(|e| e.album.clone())
}

/// 입력의 정규화 글자 → SHA-256 hex(객체 열쇠를 정렬 — 같은 입력이면 열쇠 순서와 무관하게 같다). `requestId` 는 뺀다(부르는 쪽이 이미 뺀 것을 준다).
/// 프로듀서의 멱등 기록 · 오케스트레이션 Run 단위 요청 기록(`orchestration::store::rules::request_sha`)이 같은 함수를 쓴다.
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

/// 프로듀서의 **멱등 기록 층** — `(chat, proc, requestId)` 로 처음 결과를 찾고 없으면 `run` 을 부른 뒤 성공만 적는다(역할 판정보다 앞).
/// 효과는 표 잠금 **밖에서** 돈다. 오류 글자는 `code: message`.
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

/// 시험 전용 — 프로듀서 칸 하나를 세운다(가짜 CLI 없이 신원 · 귀속 시험 — 토큰 값을 돌려준다).
#[cfg(test)]
pub(crate) fn insert_producer_for_test(chat: &str, proc: ProcId, repo: &str, plan_tools: bool) -> String {
    let token = crate::token::generate_token().unwrap();
    table().insert_kind(chat, token.clone(), proc, ChatKind::Producer, Some(repo.to_string()), plan_tools);
    token
}

/// **시험 전용 가짜 프로듀서 채팅** — 이 표에 그 세대의 칸(토큰 · 스튜디오)을 세운다(레지스트리 · 가짜 CLI 없이 — 프로세스 = 칸이 사는 동안).
/// 끝나면(drop) 그 세대의 칸만 거둔다. 채팅 id 는 시험마다 겹치지 않는다(전역 표를 함께 쓴다). 조정자 판정 · 시작 · 이어받기 시험이 쓴다
/// (`crate::tile_token::FakeTile` 과 같은 자리 — 타일은 조정자 자리가 되지 못한다).
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

    /// `/mcp` 인증 뒤의 호출자(인증 때 확정한 `(chat, proc)`).
    pub(crate) fn caller(&self) -> crate::orchestration::Caller {
        crate::orchestration::Caller::Producer { chat: self.chat.clone(), proc: self.proc }
    }

    pub(crate) fn seat(&self) -> crate::orchestration::Seat {
        crate::orchestration::Seat { chat: self.chat.clone(), proc: self.proc }
    }

    pub(crate) fn header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    /// 그 세대의 칸을 거둔다(프로세스 끝 · 사람의 거두기의 앞 몫 — 레지스트리 종료 순서의 첫 걸음).
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

/// 연결을 바꾼다(서버 op `side_chat_link` 만) — 바뀌었나.
pub(crate) fn set_link(chat: &str, stream: Option<String>) -> bool {
    table().set_link(chat, stream)
}

/// 그 채팅에 연결된 스트림(MCP 판정 · 머리글).
pub(crate) fn link_of(chat: &str) -> Option<String> {
    table().link(chat)
}

/// 채팅이 서버 표에서 빠졌다(닫기 · TTL · 모두 닫기).
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

    /// 시험 `chat_token_bound_to_process_epoch` — 토큰은 `(채팅, 프로세스 세대)` 에 묶인다: 그 세대가 살아 있는 동안만 `Chat`, 끝났거나
    /// 다시 떴으면(세대 +1 — 새 토큰이 갈아 치우기 전의 틈) `Stale`, 갈아 치운 뒤의 옛 토큰은 모르는 토큰(`None` → 401). 옛 세대의 늦은
    /// 거두기는 새 칸을 거두지 못한다.
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
        // 모르는 · 빈 · Bearer 없는 머리.
        assert_eq!(t.authenticate(Some("Bearer nope"), live1), None);
        assert_eq!(t.authenticate(Some("Bearer "), live1), None);
        assert_eq!(t.authenticate(Some("tok-1"), live1), None);
        assert_eq!(t.authenticate(None, live1), None);
        // 다시 뜸 — 새 토큰이 갈아 치운다(옛 토큰은 모르는 토큰) · 옛 세대의 늦은 거두기는 새 칸을 못 거둔다.
        t.insert("c1", "tok-2".into(), p2);
        assert_eq!(t.authenticate(Some("Bearer tok-1"), live2), None);
        assert_eq!(t.authenticate(Some("Bearer tok-2"), live2), side(p2));
        assert!(!t.revoke("c1", p1));
        assert_eq!(t.len(), 1);
        assert!(t.revoke("c1", p2));
        assert_eq!(t.authenticate(Some("Bearer tok-2"), live2), None, "거둔 뒤엔 모르는 토큰");
    }

    /// 시험 `chat_token_never_reaches_frontend`(타일 토큰의 `tile_token_never_reaches_frontend` 와 같은 규칙 — 소스 훑기): 채팅 토큰은 Tauri
    /// 명령 몸 · 스냅숏 · 목록 · 이벤트 · 로그 · 프런트 소스 · `Debug` 어디에도 없다. 값이 닿는 곳은 서버의 실행 재료(임시 `--mcp-config` ·
    /// Codex 환경 변수) 둘뿐이다.
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
        // 공용 프로세스 코어(`server/chat_proc/` — 단계 1 에 옮겨 감)는 토큰을 모른다: 실행 재료(`Launch`)를 그대로 넘길 뿐 칸을 읽지
        // 않고, 로그 · 이벤트를 쓰지 않는다(내보내기는 주인의 `on_event` — 위 `srv` 가 그 몸이다).
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
            // 연결을 읽는 `chat_token::link_of` 는 된다 — 토큰 값(`.token`) · 뽑기(`issue(`)는 안 된다.
            assert!(!body.contains(".token") && !body.contains("issue(") && !body.contains("\"token"), "{f} 에 토큰");
        }
        // (2') 프로듀서(2단계 단계 2 — 종류 둘): GUI 껍데기는 표를 모르고, 레지스트리 · 실행 재료의 로그 · 사건 · 스냅숏에 토큰이 없다. 값이
        // 닿는 곳은 실행 재료 둘(Claude `--mcp-config` 본문 · Codex 환경)뿐이다.
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

    /// 시험 `producer_token_is_its_own_liveness`(2단계 단계 2 — 설계 2-2): 프로듀서 칸은 **칸이 곧 생존** — 인증은 표 밖을 보지 않고 종류 ·
    /// 세대를 싣는다 · 스튜디오 · 작업안 값은 그 세대 칸에만 · 거두면 모르는 토큰 · 멱등 기록은 그 세대 칸과 함께 사라진다(새 세대에 닿지 않는다).
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
        // 멱등 — 같은 열쇠 · 다른 입력 · 진행 중 · 다른 세대.
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

    /// 연결은 토큰과 따로 산다 — 바뀌었나를 돌려주고(같은 값을 다시 걸면 false — 머리글을 되풀이하지 않게), 잊으면 둘 다 빠진다.
    #[test]
    fn link_lives_apart_from_the_token() {
        let mut t = ChatTokens::default();
        assert!(t.set_link("c1", Some("tile-a".into())));
        assert!(!t.set_link("c1", Some("tile-a".into())), "같은 연결 = 바뀐 것 아님");
        assert!(t.set_link("c1", Some("tile-b".into())));
        assert_eq!(t.link("c1").as_deref(), Some("tile-b"));
        let p3 = ProcId::next();
        t.insert("c1", "tok".into(), p3);
        assert!(t.revoke("c1", p3));
        assert_eq!(t.link("c1").as_deref(), Some("tile-b"), "프로세스가 끝나도 연결은 남는다");
        assert!(t.set_link("c1", None));
        assert!(!t.set_link("c1", None));
        t.set_link("c1", Some("tile-c".into()));
        t.insert("c1", "tok".into(), ProcId::next());
        t.forget("c1");
        assert_eq!(t.link("c1"), None);
        assert_eq!(t.len(), 0);
    }
}
