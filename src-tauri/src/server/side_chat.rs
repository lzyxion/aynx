//! 사이드 채팅 프로세스 표 — 세션 서버에 한 벌. 프로세스 몸은 공용 코어 `server::chat_proc` 이고 이 파일은 그 주인([`chat_proc::Host`])이다.
//! 세션 코어에 오르지 않는다 — 떨어진 세션 목록 · MCP 에 섞이지 않고 출력 프레임 · ACK 크레딧도 쓰지 않는다.
//!
//! ## 보는 창 여럿
//!
//! - `open` · `attach` 는 보는 창 목록에 덧붙인다(덮어쓰면 원격 창이 붙을 때 주 창이 소리 없이 끊긴다). 떼어 둠(TTL)은 보는 창이 0 이 된 순간부터다.
//! - 두 창이 같은 권한 카드에 답하면 먼저 온 것만 먹고 둘째는 `[unknown-request]` 다.
//! - `epoch` 은 프로세스 세대 [`chat_proc::ProcId`] — 서버 전역 단조 증가 · 재사용 없음(0 = 아직 안 띄움). 옛 `epoch` 는 `[stale-chat]`.
//! - 완료 확인(`side_chat_seen`)은 표를 바꾸지 않고 방송만 한다 — 몸이 채팅 id · 세대 · 번호뿐이라 `client::RELAYED` 로 모든 창에 간다.
//!
//! ## 띄우기
//!
//! - 게으르게 — `side_chat_send` 에서만 [`spawn`] 한다. 생성은 코어의 잡 생성 하나다(`SPAWN_LOCK` · 생성과 동시에 Job — 검증 · 헤드리스 턴과 같은 몸).
//! - 실행 파일은 PATH 의 `.exe` 만 · 인자는 어댑터의 고정 배열 · 사용자 추가 인자 없음 · 환경은 `turn::headless_env` 정화.
//! - 서버 임시 자리 `<데이터 루트>/sidechat/.run/<id>-<epoch>/` 는 `.` 이 든 이름이라 채팅 id 와 겹치지 않는다. 사용자 CLI 설정 · CLAUDE.md 는 읽기만 한다.
//! - 대화 id 는 턴이 한 번 선 뒤에만 이어 가기 대상으로 적는다 — 첫 턴 전에 죽은 새 대화는 CLI 에 아직 없다.
//!
//! ## 타일 대화 이어 가기
//!
//! - `fork{from}` 은 대화 id 하나만 받는다(경로 없음) — cwd 는 서버가 대화 색인의 기록된 시작 cwd 로 정한다(`[conversation-not-found]` ·
//!   `[conversation-folder-missing]`). 갈라 오기라 원본 파일 · 도는 타일은 그대로다. 경로는 어디에도 저장하지 않는다.
//! - 타일의 대화를 그냥 이어 가는 길은 없다 — Claude 는 쓰기 잠금이 없어 도는 타일과 한 파일에 둘이 쓰면 대화가 갈라진다.
//!
//! ## stdin — 사람의 글과 사람의 결정뿐
//!
//! stdin 에 줄을 넣는 것은 코어의 쓰기 스레드 하나이고(이 파일은 `chat_proc::apply` 로만 넘긴다) 줄을 짓는 것은 어댑터뿐이다: 악수 · CLI 물음에 대한
//! 고정 답 · 사람 글(op `side_chat_send` 에서만 — 연결 머리글 · 서버가 확인한 첨부 그림 포함) · 끊기 · 모델 · 강도 바꾸기(사람의 op 에서만) ·
//! 권한 결정(사람의 그 자리 결정은 op `side_chat_decide` 에서만, 그 밖은 사람이 그 채팅에 정한 모드 · 허용 목록에 따라 서버가 대신 내는 허용뿐).
//! MCP · 오케스트레이션 · AI 문자열에서 여기로 오는 길은 없다(시험 `side_chat_stdin_only_human` → docs/invariants.md 전문 4).
//!
//! ## 권한 모드(`side_chat::perm`)
//!
//! - 저장은 `<sidechat>/.perm/<id>.json` — 채팅 폴더(= CLI cwd) 밖이어야 한다.
//! - 바꾸는 길은 사람의 op 셋(`side_chat_set_perm_mode` · `side_chat_forget_allow` · `side_chat_decide{remember}`)뿐 — `remember` 의 종류는 몸이 아니라
//!   서버의 pending 에서 읽는다. CLI 쪽 제한(Claude `--tools` · Codex `read-only` + `on-request`)은 그대로이고, 어댑터가 카드 없이 거절하는 요청은 Auto 여도 거절이다.
//!
//! ## 연결 · 채팅 MCP 토큰
//!
//! - 채팅 토큰은 [`prepare`] 가 그 세대로 뽑고 끝 정리 · 띄우기 실패가 거둔다. 값은 Claude 임시 `--mcp-config` · Codex 프로세스 환경에만 — 로그 · 이벤트 · 스냅숏에 없다.
//! - 연결은 op `side_chat_link` 만 바꾼다. 읽기 판정은 MCP 호출마다 서버가 한다. 연결 머리글에는 값 · 출력을 붙이지 않는다(AI 가 도구로 읽는다).
//!
//! ## 외부 MCP
//!
//! - 사람이 설정에서 사이드 채팅에 고른 외부 서버만 싣는다 — 이 프로세스가 저장된 설정을 직접 읽고 op 몸에 서버 목록 칸이 없다(시험
//!   `side_chat_ops_take_no_server_list`). 사용자 CLI 설정의 서버는 싣지 않는다.
//! - 비밀 값은 AI 타일과 같은 브로커 티켓으로 — 인자 · 파일 · 프런트에 값이 없다. 볼트가 잠겼으면 비밀 값이 있는 서버만 뺀다.
//! - 외부 서버의 도구는 CLI 에 미리 허용하지 않는다 — 묻지 않기는 권한 모드(Auto · 허용 목록의 `mcp:<서버>`)만 정한다.
//!
//! ## 사건 · 중계
//!
//! 사건 몸에는 대화 본문이 있어 `client.rs` 의 `RELAYED` 에 넣지 않는다 — 넣으면 모든 창으로 샌다. 몸의 `windows` 창의 통로로만 간다.
//!
//! ## 수명
//!
//! - F5 · 웹뷰 크래시 · 창 파괴는 그 창만 뗀다. GUI 재시작 · kill 은 그 연결의 창을 떼고 [`DETACH_TTL`] 안에 다시 붙으면 그대로 · 도는 턴은 끝까지 ·
//!   TTL 뒤 쉬는 순간 닫는다(권한 요청을 기다리는 턴은 TTL 에 닫는다). 트레이 [모든 세션 종료] · 서버 끝은 [`close_all`].
//! - 서버 고아 자진 종료(`serve::Busy`)는 사이드 채팅을 세지 않는다 — 붙은 채팅은 GUI 연결로 이미 세이고, 떼어 둔 것의 TTL 은 고아 시계와 같이 시작한다.
//!
//! 로그: 채팅 id · 세대 · pid · 끝 코드 · 버린 줄 수만. 글 · 모델 답 · 도구 출력 · 경로는 남기지 않는다.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::chat_proc::{self, Core, Launch, ProcExit, ProcId, Spot, Status};
use super::ipc::WireError;
use super::{hub, log};
use crate::errors::{with_reason, SESSION_GONE};
use crate::orchestration::turn;
use crate::side_chat::event::{model_ok, uuid_ok, word_ok, Mode, ResolvedBy};
use crate::side_chat::perm::{self, ChatPerm, PermMode};
use crate::side_chat::{claude, codex, store, Adapter, Cli, Decision, Ev};

pub(crate) const EVENT: &str = "side-chat-event";
/// 몸이 채팅 id · 세대 · 번호뿐이라(본문 · 토큰 없음) GUI 가 모든 창에 중계한다.
pub(crate) const SEEN_EVENT: &str = "side-chat-seen";
pub(crate) const SIDE_CHAT: &str = "side-chat";
pub(crate) const STALE_CHAT: &str = "stale-chat";
pub(crate) const DETACH_TTL: Duration = Duration::from_secs(600);
const TEXT_MAX: usize = 256 * 1024;
const SENT_MAX: usize = 32;
const DOC_MAX: u64 = 1024 * 1024;
// 지침 저장 상한은 읽기 상한과 같아야 한다 — 저장한 글이 읽기에서 잘리지 않게
const _: () = assert!(DOC_MAX as usize == store::INSTRUCTIONS_MAX);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn fail(reason: &str, message: impl Into<String>) -> WireError {
    WireError::new(SIDE_CHAT, with_reason(reason, message.into()))
}

pub(crate) fn is_side_chat_op(op: &str) -> bool {
    matches!(
        op,
        "side_chat_open"
            | "side_chat_send"
            | "side_chat_interrupt"
            | "side_chat_set_model"
            | "side_chat_set_effort"
            | "side_chat_decide"
            | "side_chat_close"
            | "side_chat_attach"
            | "side_chat_list"
            | "side_chat_link"
            | "side_chat_seen"
            | "side_chat_set_perm_mode"
            | "side_chat_forget_allow"
    )
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

struct Viewer {
    window: String,
    conn: u64,
}

/// `Debug` 를 파생하지 않는다(본문).
struct Sent {
    client_id: Option<String>,
    text: String,
    files: Vec<String>,
}

struct State {
    cli: Cli,
    model: String,
    effort: Option<String>,
    /// 턴이 한 번 선 것만.
    conversation: Option<String>,
    /// `conversation` 이 서기 전의 첫 띄우기만 쓴다.
    fork_from: Option<String>,
    /// `None` = 채팅 자기 폴더.
    cwd: Option<PathBuf>,
    /// 턴이 서면 `conversation` 으로 옮긴다.
    conv_seen: Option<String>,
    viewers: Vec<Viewer>,
    lease_epoch: u64,
    sent: VecDeque<Sent>,
    /// 보는 창이 0 이 된 순간부터.
    detached: Option<Instant>,
    core: Core,
    /// 사람의 다음 글 앞에 연결 머리글을 붙인다(붙인 뒤 내린다).
    link_note: bool,
    mcp: Vec<String>,
    /// 서버가 권한 요청에 대신 답할지는 이것만 본다 — 사람의 op 가 바꿀 때마다 저장한다.
    perm: ChatPerm,
}

struct Chat {
    id: String,
    st: Mutex<State>,
    cv: Condvar,
}

#[derive(Default)]
struct Table {
    chats: HashMap<String, Arc<Chat>>,
    /// 끊긴 뒤에 끝난 열기 · 붙기는 곧바로 떼어 둔다.
    conns: HashSet<u64>,
}

static TABLE: LazyLock<Mutex<Table>> = LazyLock::new(Default::default);

fn find(id: &str) -> Result<Arc<Chat>, WireError> {
    lock(&TABLE).chats.get(id).cloned().ok_or_else(|| {
        WireError::new(
            SIDE_CHAT,
            with_reason(SESSION_GONE, "this side chat is not open on the session server".into()),
        )
    })
}

fn check_epoch(st: &State, epoch: u64) -> Result<(), WireError> {
    if st.core.id().get() != epoch {
        return Err(fail(STALE_CHAT, format!("stale side chat process (now {})", st.core.id())));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 코어의 주인 — 사건 내보내기 · 끝 정리
// ---------------------------------------------------------------------------

fn windows_of(st: &State) -> Vec<String> {
    st.viewers.iter().map(|v| v.window.clone()).collect()
}

fn event_body(windows: &[String], chat: &str, proc: ProcId, seq: u64, ev: &Ev) -> Value {
    json!({ "windows": windows, "chat": chat, "epoch": proc, "seq": seq, "ev": ev })
}

impl chat_proc::Host for Chat {
    type St = State;

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.st)
    }

    fn core(st: &mut State) -> &mut Core {
        &mut st.core
    }

    /// `clientId` 앞의 글은 버린다 — 받아들여지지 않고 끝난 글이다.
    fn shape(&self, st: &mut State, ev: &mut Ev) {
        if let Ev::UserAccepted { client_id, text, files } = ev {
            let at = match client_id.as_deref() {
                Some(id) => st.sent.iter().position(|s| s.client_id.as_deref() == Some(id)),
                None => (!st.sent.is_empty()).then_some(0),
            };
            if let Some(s) = at.and_then(|i| st.sent.drain(..=i).next_back()) {
                *text = Some(crate::side_chat::event::Said(s.text));
                *files = s.files;
            }
        }
    }

    /// 보는 창이 없으면 `windows: []` — 다시 붙는 창은 스냅숏으로 맞춘다.
    fn on_event(&self, st: &mut State, proc: ProcId, seq: u64, ev: &Ev) {
        match ev {
            Ev::Ready { conversation_id, .. } => {
                if conversation_id.is_some() {
                    st.conv_seen = conversation_id.clone();
                }
                self.cv.notify_all();
            }
            Ev::TurnStarted { .. } => {
                if st.conv_seen.is_some() {
                    st.conversation = st.conv_seen.clone();
                }
            }
            Ev::Notice { code: "conversation-changed", detail: Some(id) } => {
                st.conv_seen = Some(id.clone());
                if st.core.status() == Status::Running {
                    st.conversation = Some(id.clone());
                }
            }
            Ev::McpServers { names } => st.mcp = names.clone(),
            Ev::Exited { .. } => self.cv.notify_all(),
            // 사람이 그 채팅에 정한 모드 · 허용 목록이 허용하면 카드 없이 서버가 허용으로 답한다
            Ev::Permission { request_id, kind, title, tool_name, .. } => {
                let key = perm::key_of(*kind, tool_name, &st.mcp);
                if let Some(by) = perm::answer_by(&st.perm, key.as_deref()) {
                    let shown = Ev::PermissionAuto {
                        request_id: request_id.clone(),
                        kind: *kind,
                        title: title.clone(),
                        tool_name: tool_name.clone(),
                        by,
                    };
                    hub::emit(EVENT, event_body(&windows_of(st), &self.id, proc, seq, &shown));
                    policy_answer(self, st, request_id, by);
                    return;
                }
            }
            _ => {}
        }
        hub::emit(EVENT, event_body(&windows_of(st), &self.id, proc, seq, ev));
    }

    /// 토큰은 정확히 이 세대만 거둔다 — 늦은 끝 정리가 새 세대의 칸을 건드리지 않게. 대화를 놓았다고 적어야 채팅 지우기가 "방금 쓰임"에 막히지 않는다.
    fn on_ending(&self, st: &mut State, proc: ProcId) {
        crate::chat_token::revoke(&self.id, proc);
        let agent = cli_name(st.cli);
        for conv in st.conversation.iter().chain(st.conv_seen.iter()) {
            crate::agent_state::note_released(agent, conv);
        }
    }

    fn on_exit(&self, e: ProcExit) {
        log::line(format!(
            "side chat {} — process {} ended ({}, code {:?}, dropped {} bad · {} unknown line(s))",
            self.id, e.proc, e.reason, e.code, e.dropped.bad, e.dropped.unknown
        ));
        wake_reaper();
    }
}

// ---------------------------------------------------------------------------
// 띄우기
// ---------------------------------------------------------------------------

fn read_capped(p: &Path) -> Option<String> {
    let f = std::fs::File::open(p).ok()?;
    let mut buf = Vec::new();
    f.take(DOC_MAX).read_to_end(&mut buf).ok()?;
    let s = String::from_utf8_lossy(&buf).into_owned();
    (!s.trim().is_empty()).then_some(s)
}

/// CLAUDE.md 둘은 읽기만 한다.
fn instructions(root: &Path) -> String {
    let global = turn::global_claude_md(std::env::var_os("CLAUDE_CONFIG_DIR").as_deref(), dirs::home_dir()).and_then(|p| read_capped(&p));
    let local = read_capped(&root.join(store::INSTRUCTIONS_FILE));
    let mut docs: Vec<(&str, &str)> = Vec::new();
    if let Some(g) = global.as_deref() {
        docs.push(("Global CLAUDE.md", g));
    }
    if let Some(l) = local.as_deref() {
        docs.push(("Side chat CLAUDE.md", l));
    }
    turn::instructions_text(&crate::side_chat::fixed_guide(), None, &docs).expect("고정 글이 있어 늘 Some")
}

/// 사용자 Codex 설정은 읽기만 한다.
fn codex_mcp_names() -> codex::McpNames {
    let home = match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(h) => PathBuf::from(h),
        None => match dirs::home_dir() {
            Some(h) => h.join(".codex"),
            None => return codex::McpNames::default(),
        },
    };
    read_capped(&home.join("config.toml")).map(|t| codex::mcp_server_names(&t)).unwrap_or_default()
}

fn cli_name(cli: Cli) -> &'static str {
    match cli {
        Cli::Claude => "claude",
        Cli::Codex => "codex",
    }
}

fn sidechat_root() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return Some(f.root.clone());
    }
    store::root()
}

/// `Debug` 를 파생하지 않는다(토큰).
struct ChatMcp {
    name: &'static str,
    url: String,
    token: String,
}

fn mcp_port() -> Option<u16> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return f.mcp_port;
    }
    hub::signal_port()
}

/// `None` 이면 그 프로세스는 Aynx MCP 없이 뜬다.
fn chat_mcp(id: &str, proc: ProcId) -> Option<ChatMcp> {
    let port = mcp_port()?;
    let token = crate::chat_token::issue(id, proc)?;
    Some(ChatMcp {
        name: crate::instance::mcp_name(crate::instance::DEV),
        url: format!("{}/mcp", crate::tile_env::base_url(port)),
        token,
    })
}

/// 저장된 설정을 이 프로세스가 직접 읽는다 — op 몸 · 프런트 인자에서 받지 않는다.
fn picked_servers(cwd: &str) -> Vec<crate::agent_mcp::McpServer> {
    #[cfg(test)]
    {
        let _ = cwd;
        crate::agent_mcp::side_chat_selected(lock(&FAKE_SERVERS).as_deref().unwrap_or_default(), None)
    }
    #[cfg(not(test))]
    crate::agent_mcp::side_chat_servers(Some(cwd))
}

/// 비밀 값이 있는 서버는 브로커가 티켓을 박은 모양으로 바꾼다 — 값은 볼트에서 그 자식 · 프록시로만 간다. Codex 사용자 설정과 같은 이름은
/// 싣지 않는다(표가 합쳐져 그쪽 칸이 섞인다).
fn external_mcp(cli: Cli, cwd: &str, user_names: &[String], notices: &mut Vec<Ev>) -> Vec<crate::agent_mcp::McpServer> {
    let picked = picked_servers(cwd);
    if picked.is_empty() {
        return Vec::new();
    }
    let vault_open = hub::vault().is_some_and(|v| v.is_unlocked());
    let broker = hub::broker();
    let (mut out, mut locked, mut taken, mut failed) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for s in picked {
        match mcp_skip(&s, cli, user_names, vault_open) {
            Some(Skip::Taken) => {
                taken.push(s.name);
                continue;
            }
            Some(Skip::Locked) => {
                locked.push(s.name);
                continue;
            }
            None => {}
        }
        let secret = !s.env.is_empty() || !s.headers.is_empty();
        let prepared = if !secret { Some(s.clone()) } else { broker.as_ref().and_then(|b| b.prepare(&s, Some(cwd)).ok()) };
        match prepared.filter(crate::agent_mcp::launch_ok) {
            Some(p) => out.push(p),
            None => failed.push(s.name),
        }
    }
    for (code, names) in [("mcp-locked", locked), ("mcp-name-taken", taken), ("mcp-failed", failed)] {
        if !names.is_empty() {
            notices.push(Ev::Notice { code, detail: Some(names.join(", ")) });
        }
    }
    out
}

/// [`external_mcp`] 와 [`planned_mcp`] 가 같은 규칙을 써야 한다.
enum Skip {
    Taken,
    Locked,
}

fn mcp_skip(s: &crate::agent_mcp::McpServer, cli: Cli, user_names: &[String], vault_open: bool) -> Option<Skip> {
    if cli == Cli::Codex && user_names.contains(&s.name) {
        return Some(Skip::Taken);
    }
    if !vault_open && (!s.env.is_empty() || !s.headers.is_empty()) {
        return Some(Skip::Locked);
    }
    None
}

/// 첫 보내기 전의 예정 이름만(값 · 티켓 · 토큰 없음). 블로킹이라 표 · 채팅 잠금 앞에서 부른다.
fn planned_mcp(cli: Cli, cwd: &str) -> Vec<String> {
    let picked = picked_servers(cwd);
    if picked.is_empty() {
        return Vec::new();
    }
    let user = if cli == Cli::Codex { codex_mcp_names().names } else { Vec::new() };
    let vault_open = hub::vault().is_some_and(|v| v.is_unlocked());
    picked.into_iter().filter(|s| mcp_skip(s, cli, &user, vault_open).is_none()).map(|s| s.name).collect()
}

fn run_cwd(root: &Path, id: &str, forked: Option<&Path>) -> Result<PathBuf, WireError> {
    let own = store::chat_dir(root, id).ok_or_else(|| fail("bad-chat", "invalid side chat id"))?;
    std::fs::create_dir_all(&own).map_err(|e| fail("chat-dir", e.to_string()))?;
    match forked {
        Some(p) if p.is_dir() => Ok(p.to_path_buf()),
        Some(_) => Err(fail(FOLDER_MISSING, "the conversation's folder no longer exists")),
        None => Ok(own),
    }
}

/// 파일을 쓰지만 아무것도 띄우지 않는다.
fn prepare(id: &str, st: &State, proc: ProcId) -> Result<Launch, WireError> {
    let root = sidechat_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let cwd = run_cwd(&root, id, st.cwd.as_deref())?;
    let dir = root.join(".run").join(format!("{id}-{proc}"));
    std::fs::create_dir_all(&dir).map_err(|e| fail("temp-dir", e.to_string()))?;
    let mut spot = Spot::new(dir);
    let name = cli_name(st.cli);
    let exe = crate::orchestration::spawn::find_exe(name, std::env::var_os("PATH").as_deref())
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| fail("cli-not-found", format!("{name} was not found on PATH (an .exe is required)")));
    #[cfg(test)]
    let exe = match lock(&FAKE).as_ref() {
        Some(f) => Ok(f.exe.clone()),
        None => exe,
    };
    let exe = exe?;
    let bad = |w: &'static str| fail(w, "the side chat settings were refused");
    let mut add: Vec<(String, String)> = Vec::new();
    let mut notices = Vec::new();
    let fresh = if st.conversation.is_none() {
        Some(crate::orchestration::spawn::new_uuid().ok_or_else(|| fail("uuid", "no randomness"))?)
    } else {
        None
    };
    // 채팅 토큰 값은 이 프로세스의 실행 재료에만 싣는다. 실패한 띄우기는 부르는 쪽(`spawn`)이 거둔다
    let mcp = chat_mcp(id, proc);
    let cwd_s = cwd.to_string_lossy().replace('\\', "/");
    let user_names = if st.cli == Cli::Codex { codex_mcp_names() } else { codex::McpNames::default() };
    let ext = external_mcp(st.cli, &cwd_s, &user_names.names, &mut notices);
    let names: Vec<String> = ext.iter().map(|s| s.name.clone()).collect();
    if !names.is_empty() || !st.mcp.is_empty() {
        notices.insert(0, Ev::McpServers { names });
    }
    let (argv, adapter): (Vec<String>, Box<dyn Adapter>) = match st.cli {
        Cli::Claude => {
            let settings = spot.write("settings.json", claude::SETTINGS_JSON).map_err(|e| fail("temp-file", e))?;
            let body = match &mcp {
                Some(m) => claude::mcp_config(m.name, &m.url, &m.token),
                None => claude::MCP_CONFIG_EMPTY.to_string(),
            };
            let mcp_file = spot.write("mcp.json", &claude::mcp_config_with(&body, &ext)).map_err(|e| fail("temp-file", e))?;
            // 읽기 도구는 묻지 않는다 — 판정은 호출마다 서버가 한다(`mcp/chat_read.rs`)
            let mut allowed: Vec<String> = match &mcp {
                Some(m) => crate::chat_token::READ_TOOLS.iter().map(|t| format!("mcp__{}__{t}", m.name)).collect(),
                None => Vec::new(),
            };
            // 외부 서버의 도구는 미리 허용하지 않는다 — 묻지 않기는 이 서버가 채팅의 모드 · 허용 목록으로 답한다
            // 갈라 온 채팅은 cwd 가 다른 폴더라 첨부 폴더 하나의 읽기만 더한다(쓰기 · 실행 도구는 `--tools` 에 없다)
            let attach_dir = if st.cwd.is_some() { attach_read(id) } else { None };
            if let Some((_, rule)) = &attach_dir {
                allowed.push(rule.clone());
            }
            let append = Some(spot.write("instructions.md", &instructions(&root)).map_err(|e| fail("temp-file", e))?);
            let (mode, session_id) = match (st.conversation.as_deref(), fresh.as_deref()) {
                (Some(c), _) => (Mode::Resume { conv: c }, c),
                (None, Some(n)) => match st.fork_from.as_deref() {
                    Some(from) => (Mode::Fork { from }, n),
                    None => (Mode::Fresh, n),
                },
                (None, None) => unreachable!("새 대화 id 는 위에서 지었다"),
            };
            let o = claude::Opts {
                exe: &exe,
                mode,
                session_id,
                model: &st.model,
                effort: st.effort.as_deref(),
                settings_file: &settings,
                mcp_config_file: &mcp_file,
                append_file: append.as_deref(),
                mcp_allowed: &allowed,
            };
            let mut a = claude::argv(&o).map_err(bad)?;
            if let Some((dir, _)) = &attach_dir {
                a.extend(["--add-dir".to_string(), dir.clone()]);
            }
            (a, Box::new(claude::Claude::new(&o)))
        }
        Cli::Codex => {
            let names = user_names;
            if names.skipped > 0 {
                notices.push(Ev::Notice { code: "mcp-names-skipped", detail: Some(names.skipped.to_string()) });
            }
            let mode = match (st.conversation.as_deref(), st.fork_from.as_deref()) {
                (Some(c), _) => Mode::Resume { conv: c },
                (None, Some(from)) => Mode::Fork { from },
                (None, None) => Mode::Fresh,
            };
            let o = codex::Opts {
                exe: &exe,
                mode,
                cwd: &cwd_s,
                model: &st.model,
                effort: st.effort.as_deref(),
                mcp_names: &names.names,
                client_version: env!("CARGO_PKG_VERSION"),
                mcp: mcp.as_ref().map(|m| codex::Mcp {
                    name: m.name,
                    url: &m.url,
                    token_env: crate::tile_env::MCP_TOKEN_ENV,
                    tools: &crate::chat_token::READ_TOOLS,
                }),
                external: &ext,
            };
            if let Some(m) = &mcp {
                add.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), m.token.clone()));
            }
            let mut argv = codex::argv(&o).map_err(bad)?;
            let launch = crate::codex_launch::codex_launch_env();
            crate::codex_launch::apply_tile_path(&mut add, launch.as_ref());
            argv.extend(crate::codex_launch::codex_extra_args(launch.as_ref()));
            // 지침은 이 프로세스가 파일에서 직접 읽는다 — op 몸으로 받지 않는다
            let person = read_capped(&root.join(store::INSTRUCTIONS_FILE));
            (argv, Box::new(codex::Codex::new(&o).person_instructions(person.as_deref())))
        }
    };
    #[cfg(test)]
    let argv = match lock(&FAKE).as_ref() {
        Some(f) => {
            add.extend(f.env.iter().cloned());
            std::iter::once(f.exe.clone()).chain(f.args.iter().cloned()).collect()
        }
        None => argv,
    };
    let env = turn::headless_env(std::env::vars(), &add);
    Ok(Launch { name, exe, argv, cwd, env, adapter, spot, notices })
}

/// `side_chat_send` 에서만. 부르는 쪽이 채팅 잠금을 쥐고 있어 코어의 스레드들은 세대 · 프로세스 칸이 선 뒤에야 줄을 반영한다.
fn spawn(chat: &Arc<Chat>, st: &mut State) -> Result<(), WireError> {
    let proc = ProcId::next();
    // 띄우지 못하면 이 세대의 채팅 토큰을 곧바로 거둔다
    let revoke = |e: WireError| {
        crate::chat_token::revoke(&chat.id, proc);
        e
    };
    let l = prepare(&chat.id, st, proc).map_err(revoke)?;
    let pid = chat_proc::start(chat, st, proc, l).map_err(|(w, m)| revoke(fail(w, m)))?;
    log::line(format!("side chat {} — started {} (process {proc}, pid {pid})", chat.id, cli_name(st.cli)));
    st.conv_seen = None;
    st.sent.clear();
    Ok(())
}

// ---------------------------------------------------------------------------
// op
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ModeBody {
    Fresh,
    Resume {
        conv: String,
        /// 갈라 온 채팅 자신의 대화 — cwd 를 그 대화의 색인에서 다시 얻는다.
        #[serde(default)]
        project: bool,
    },
    Fork { from: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenBody {
    chat: String,
    cli: String,
    model: String,
    #[serde(default)]
    effort: Option<String>,
    mode: ModeBody,
    window: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    chat: String,
    epoch: u64,
    text: String,
    #[serde(default)]
    client_id: Option<String>,
    /// 스트림 id → 칩 이름 — 머리글을 붙일 때만 쓴다.
    #[serde(default)]
    link_names: Option<HashMap<String, String>>,
    /// 서버가 첨부 자리 안의 그림인지 다시 본다.
    #[serde(default)]
    images: Vec<String>,
    /// 서버가 다시 보고 채팅 자기 폴더로 옮겨 적는다.
    #[serde(default)]
    files: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpochBody {
    chat: String,
    epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeenBody {
    chat: String,
    epoch: u64,
    seq: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelBody {
    chat: String,
    epoch: u64,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffortBody {
    chat: String,
    epoch: u64,
    /// `None` = CLI 기본.
    #[serde(default)]
    effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecideBody {
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    #[serde(default)]
    message: Option<String>,
    /// [이 채팅에서 허용] — 종류는 서버가 기다리는 요청에서 읽는다(몸에 종류 칸이 없다).
    #[serde(default)]
    remember: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermModeBody {
    chat: String,
    mode: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgetBody {
    chat: String,
    /// 빼기만 한다 — 넓히는 길이 아니다.
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatBody {
    chat: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachBody {
    chat: String,
    window: String,
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    // serde 문구는 몸(사람 글)을 되풀이할 수 있다 — 싣지 않는다
    serde_json::from_value(v).map_err(|_| WireError::new(super::ipc::frame::code::BAD_BODY, "bad side chat request body"))
}

/// 블로킹 — 블로킹 풀에서 부른다.
pub(crate) fn handle(op: &str, b: Value, conn: u64) -> Result<Value, WireError> {
    match op {
        "side_chat_open" => op_open(body(b)?, conn),
        "side_chat_send" => op_send(body(b)?),
        "side_chat_interrupt" => op_interrupt(body(b)?),
        "side_chat_set_model" => op_set_model(body(b)?),
        "side_chat_set_effort" => op_set_effort(body(b)?),
        "side_chat_decide" => op_decide(body(b)?),
        "side_chat_close" => {
            let c: ChatBody = body(b)?;
            Ok(json!(close(&c.chat)))
        }
        "side_chat_attach" => op_attach(body(b)?, conn),
        "side_chat_list" => Ok(list()),
        "side_chat_link" => op_link(body(b)?),
        "side_chat_seen" => Ok(op_seen(body(b)?)),
        "side_chat_set_perm_mode" => op_set_perm_mode(body(b)?),
        "side_chat_forget_allow" => op_forget_allow(body(b)?),
        _ => Err(WireError::new(super::ipc::frame::code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

/// `links` 는 부르는 쪽이 채팅 잠금 앞에서 짓는다 — 권한 파일 읽기를 잠금 위에서 하지 않게.
fn snapshot(chat: &Chat, st: &State, links: Value) -> Value {
    json!({
        "links": links,
        "chat": chat.id,
        "cli": st.cli,
        "model": st.model,
        "effort": st.effort,
        "epoch": st.core.id(),
        "leaseEpoch": st.lease_epoch,
        "seq": st.core.seq(),
        "status": st.core.status(),
        "conversationId": st.conv_seen.as_ref().or(st.conversation.as_ref()),
        "cwd": st.cwd.as_ref().map(|p| p.to_string_lossy().replace('\\', "/")),
        "forkFrom": st.fork_from,
        "mcpServers": st.mcp,
        "permMode": st.perm.mode,
        "permAllow": st.perm.allow,
        "liveTurn": st.core.live_turn(),
        "pending": st.core.pending(),
    })
}

/// 연결이 이미 끊겼으면 덧붙이지 않는다. 모은 조각은 먼저 낸다 — 스냅숏 뒤 사건이 이어지게.
fn add_viewer(chat: &Chat, st: &mut State, window: String, conn: u64, conn_alive: bool) {
    st.lease_epoch += 1;
    if conn_alive {
        st.viewers.retain(|v| v.window != window);
        st.viewers.push(Viewer { window, conn });
        st.detached = None;
    } else if st.viewers.is_empty() && st.detached.is_none() {
        st.detached = Some(Instant::now());
    }
    chat_proc::flush(chat, st);
}

pub(crate) const FOLDER_MISSING: &str = "conversation-folder-missing";

/// 대화 색인에서만 고른다 — 화면이 준 경로는 없다.
fn recorded_cwd(cli: Cli, id: &str) -> Result<PathBuf, WireError> {
    use crate::agent_sessions::{recorded_cwd_in, target, CwdMiss};
    let t = target(cli_name(cli)).map_err(|_| fail("bad-cli", "unknown side chat CLI"))?;
    match recorded_cwd_in(t, &conv_roots(t), id) {
        Ok(cwd) if Path::new(&cwd).is_absolute() => Ok(PathBuf::from(cwd)),
        Ok(_) | Err(CwdMiss::NoFolder(_)) => Err(fail(FOLDER_MISSING, "the conversation's folder no longer exists")),
        Err(CwdMiss::BadId) => Err(fail("bad-conversation", "invalid conversation id")),
        Err(CwdMiss::NotFound) => Err(fail("conversation-not-found", "that conversation was not found for this CLI")),
    }
}

fn conv_roots(t: &'static crate::agent_sessions::SessionTarget) -> Vec<PathBuf> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return f.conv_roots.iter().filter(|(a, _)| *a == t.id).map(|(_, p)| p.clone()).collect();
    }
    (t.roots)()
}

fn op_open(b: OpenBody, conn: u64) -> Result<Value, WireError> {
    if !store::id_ok(&b.chat) {
        return Err(fail("bad-chat", "invalid side chat id"));
    }
    // 프로듀서 채팅 id(`pc-`)는 이 표가 받지 않는다
    if b.chat.starts_with("pc-") {
        return Err(fail("wrong-chat-kind", "that id belongs to a producer chat — use producer_chat_*"));
    }
    let cli = match b.cli.as_str() {
        "claude" => Cli::Claude,
        "codex" => Cli::Codex,
        _ => return Err(fail("bad-cli", "unknown side chat CLI")),
    };
    // 빈 모델 = CLI 기본
    if !model_ok(&b.model) || b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-model", "invalid model"));
    }
    // 폴더는 색인에서만 — 파일을 찾으므로 표 잠금 앞에서
    let (conversation, fork_from, cwd) = match b.mode {
        ModeBody::Fresh => (None, None, None),
        ModeBody::Resume { conv, project } if uuid_ok(&conv) => {
            let cwd = if project { Some(recorded_cwd(cli, &conv)?) } else { None };
            (Some(conv), None, cwd)
        }
        ModeBody::Fork { from } if uuid_ok(&from) => {
            let from = from.to_ascii_lowercase();
            let cwd = recorded_cwd(cli, &from)?;
            (None, Some(from), Some(cwd))
        }
        ModeBody::Resume { .. } | ModeBody::Fork { .. } => {
            return Err(fail("bad-conversation", "invalid conversation id"))
        }
    };
    // 띄울 폴더는 `prepare` 와 같은 자리여야 한다 — 잠금 앞에서
    let plan_cwd = cwd.clone().or_else(|| sidechat_root().and_then(|r| store::chat_dir(&r, &b.chat)));
    let planned = plan_cwd.map(|p| planned_mcp(cli, &p.to_string_lossy().replace('\\', "/"))).unwrap_or_default();
    // 표에 새로 세울 때만 쓴다(다시 붙기는 표의 것이 최신) — 잠금 앞에서
    let perm0 = sidechat_root().map(|r| perm::load_or_init(&r, &b.chat)).unwrap_or_default();
    let (chat, alive, old) = {
        let mut t = lock(&TABLE);
        let alive = t.conns.contains(&conn);
        let old = t.chats.get(&b.chat).cloned();
        let reuse = old.as_ref().filter(|c| lock(&c.st).cli == cli).cloned();
        // 새 항목의 세대는 0 — 다음 띄우기가 서버 전역의 새 `ProcId` 를 받아야 옛 프로세스의 늦은 끝 정리가 새 세대의 토큰을 거두지 않는다
        let chat = match reuse {
            Some(c) => c,
            None => {
                let c = Arc::new(Chat {
                    id: b.chat.clone(),
                    st: Mutex::new(State {
                        cli,
                        model: b.model.clone(),
                        effort: b.effort.clone(),
                        conversation: conversation.clone(),
                        fork_from: fork_from.clone(),
                        cwd: cwd.clone(),
                        conv_seen: None,
                        viewers: Vec::new(),
                        lease_epoch: 0,
                        sent: VecDeque::new(),
                        detached: None,
                        core: Core::new(),
                        link_note: !crate::chat_token::links_of(&b.chat).is_empty(),
                        mcp: Vec::new(),
                        perm: perm0,
                    }),
                    cv: Condvar::new(),
                });
                t.chats.insert(b.chat.clone(), Arc::clone(&c));
                c
            }
        };
        let replaced = old.filter(|o| !Arc::ptr_eq(o, &chat));
        (chat, alive, replaced)
    };
    if let Some(o) = old {
        lock(&o.st).core.kill("closed");
    }
    let links = link_views(&chat.id);
    let mut st = lock(&chat.st);
    // 프로세스가 없을 때만 띄울 뜻을 바꾼다 — 도는 프로세스는 그대로
    if !st.core.has_proc() {
        st.model = b.model;
        st.effort = b.effort;
        st.mcp = planned;
        if conversation.is_some() {
            st.conversation = conversation;
            st.cwd = cwd;
        } else if fork_from.is_some() && st.conversation.is_none() {
            st.fork_from = fork_from;
            st.cwd = cwd;
        }
    }
    add_viewer(&chat, &mut st, b.window, conn, alive);
    if !alive {
        wake_reaper();
    }
    Ok(snapshot(&chat, &st, links))
}

fn op_attach(b: AttachBody, conn: u64) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let alive = lock(&TABLE).conns.contains(&conn);
    let links = link_views(&chat.id);
    let mut st = lock(&chat.st);
    add_viewer(&chat, &mut st, b.window, conn, alive);
    if !alive {
        wake_reaper();
    }
    Ok(snapshot(&chat, &st, links))
}

/// 사람이 보낸 글 — 이 함수가 `encode_user` 를 부르는 유일한 곳이다(시험 `side_chat_stdin_only_human`).
fn op_send(b: SendBody) -> Result<Value, WireError> {
    if (b.text.trim().is_empty() && b.images.is_empty() && b.files.is_empty()) || b.text.len() > TEXT_MAX {
        return Err(fail("bad-text", "the message is empty or too long"));
    }
    if b.images.len() + b.files.len() > IMAGES_MAX {
        return Err(fail("too-many-attachments", "too many attachments in one message"));
    }
    let chat = find(&b.chat)?;
    // 파일을 읽고 쓰는 일이라 채팅 잠금 앞에서 — CLI 는 채팅마다 고정이다
    let cli = lock(&chat.st).cli;
    let images = chat_images(&b.images, cli == Cli::Claude)?;
    let attached = chat_files(&chat.id, &b.files)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !st.core.has_proc() {
        spawn(&chat, &mut st)?;
    }
    let deadline = Instant::now() + Duration::from_millis(turn::START_MS);
    while st.core.status() == Status::Starting && st.core.has_proc() {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            st.core.kill("start-timeout");
            return Err(fail("start-timeout", "the side chat CLI did not become ready in time"));
        }
        st = chat.cv.wait_timeout(st, left).unwrap_or_else(|e| e.into_inner()).0;
    }
    let epoch = st.core.id();
    // 연결 머리글은 서버가 아는 연결 · 칩 이름이나 거울의 타일 이름으로만 짓는다
    let text = if st.link_note { format!("{}{}", link_header_now(&chat.id, b.link_names.as_ref()), b.text) } else { b.text.clone() };
    let text = with_file_refs(&text, &attached);
    let Some(a) = st.core.adapter() else {
        return Err(fail("exited", "the side chat CLI exited before it was ready"));
    };
    let step = a.encode_user(&text, &images, b.client_id.as_deref()).map_err(|w| fail(w, "the message was not sent"))?;
    let link = if st.link_note { crate::side_chat::event::parse_link_note(&text).map(|(l, _)| l) } else { None };
    st.link_note = false;
    // 읽기 스레드는 이 잠금이 풀린 뒤에야 반영하므로 apply 앞이든 뒤든 같다
    let files = images
        .iter()
        .map(|im| im.path.as_str())
        .chain(attached.iter().map(|f| f.path.as_str()))
        .filter_map(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    if st.sent.len() >= SENT_MAX {
        st.sent.pop_front();
    }
    st.sent.push_back(Sent { client_id: b.client_id, text: b.text, files });
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!({ "epoch": epoch, "link": link }))
}

const IMAGES_MAX: usize = 8;
/// 기록 그림(`agent_transcript::IMAGE_MAX_BYTES`)과 같은 값.
const IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// 앱 첨부 자리 안의 실제 파일만 받는다 — 링크로 빠져나가도 같다.
fn chat_images(paths: &[String], bytes: bool) -> Result<Vec<crate::side_chat::UserImage>, WireError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let root = crate::agent_attachments::attachments_root().map_err(|_| fail("image-outside", "the attachment folder is unavailable"))?;
    images_in(&root, paths, bytes)
}

fn images_in(root: &Path, paths: &[String], bytes: bool) -> Result<Vec<crate::side_chat::UserImage>, WireError> {
    if paths.len() > IMAGES_MAX {
        return Err(fail("too-many-images", "too many images in one message"));
    }
    let root = std::fs::canonicalize(root).map_err(|_| fail("image-outside", "the attachment folder is unavailable"))?;
    paths
        .iter()
        .map(|p| {
            let real = std::fs::canonicalize(p).map_err(|_| fail("image-missing", "an attached image is missing"))?;
            if real == root || !real.starts_with(&root) {
                return Err(fail("image-outside", "an attached image is outside the attachment folder"));
            }
            let meta = std::fs::metadata(&real).map_err(|_| fail("image-missing", "an attached image is missing"))?;
            if !meta.is_file() {
                return Err(fail("image-not-file", "an attachment is not a file"));
            }
            let ext = real.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
            let media_type = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                _ => return Err(fail("image-type", "only png, jpeg, gif and webp images can be attached")),
            };
            if meta.len() > IMAGE_MAX_BYTES {
                return Err(fail("image-too-big", "an attached image is larger than 10 MB"));
            }
            let data = if bytes {
                let raw = std::fs::read(&real).map_err(|_| fail("image-missing", "an attached image could not be read"))?;
                if raw.len() as u64 > IMAGE_MAX_BYTES {
                    return Err(fail("image-too-big", "an attached image is larger than 10 MB"));
                }
                Some(crate::setup_script::base64_encode(&raw))
            } else {
                None
            };
            Ok(crate::side_chat::UserImage { path: plain_path(&real), media_type, data })
        })
        .collect()
}

/// `canonicalize` 의 Windows 확장 머리(`\\?\`)를 걷는다(UNC 는 그대로).
fn plain_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => rest.to_string(),
        _ => s.into_owned(),
    }
}

const FILE_MAX_BYTES: u64 = IMAGE_MAX_BYTES;
const FILES_DIR: &str = "attachments";

#[derive(Debug, PartialEq)]
pub(super) struct AttachedFile {
    path: String,
}

/// 앱 첨부 자리 안의 실제 파일만 받고, 사본은 늘 그 채팅 자기 폴더의 `attachments/` 에 둔다 — 갈라 온 채팅도 기록된 cwd(사용자 저장소)에는
/// 쓰지 않는다(사용자 결정). 사본 자리는 서버가 정한다.
fn chat_files(id: &str, paths: &[String]) -> Result<Vec<AttachedFile>, WireError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let root = crate::agent_attachments::attachments_root().map_err(|_| fail("file-outside", "the attachment folder is unavailable"))?;
    let chats = sidechat_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let own = store::chat_dir(&chats, id).ok_or_else(|| fail("bad-chat", "invalid side chat id"))?;
    std::fs::create_dir_all(&own).map_err(|e| fail("chat-dir", e.to_string()))?;
    files_in(&root, &own, paths)
}

/// 갈라 온 Claude 채팅의 첨부 폴더 읽기 — 폴더를 지금 만든다(없으면 `--add-dir` 가 실패한다). `(--add-dir 경로, --allowedTools 규칙)`.
/// 경로에 규칙 문법 글자가 있으면 `None`(허용 없이 띄운다 — 그 읽기는 권한 카드).
fn attach_read(id: &str) -> Option<(String, String)> {
    let own = store::chat_dir(&sidechat_root()?, id)?;
    let dir = plain_path(&files_dir(&own).ok()?);
    let rule = crate::orchestration::spawn::claude_read_rule(Path::new(&dir))?;
    Some((dir, rule))
}

/// 모두 확인한 뒤에 옮긴다 — 하나라도 틀리면 아무것도 쓰지 않는다. 같은 이름은 덮지 않는다(`create_new`).
pub(super) fn files_in(root: &Path, cwd: &Path, paths: &[String]) -> Result<Vec<AttachedFile>, WireError> {
    if paths.len() > IMAGES_MAX {
        return Err(fail("too-many-attachments", "too many attachments in one message"));
    }
    let root = std::fs::canonicalize(root).map_err(|_| fail("file-outside", "the attachment folder is unavailable"))?;
    let mut picked = Vec::with_capacity(paths.len());
    for p in paths {
        let real = std::fs::canonicalize(p).map_err(|_| fail("file-missing", "an attached file is missing"))?;
        if real == root || !real.starts_with(&root) {
            return Err(fail("file-outside", "an attached file is outside the attachment folder"));
        }
        let meta = std::fs::metadata(&real).map_err(|_| fail("file-missing", "an attached file is missing"))?;
        if !meta.is_file() {
            return Err(fail("file-not-file", "an attachment is not a file"));
        }
        if meta.len() > FILE_MAX_BYTES {
            return Err(fail("file-too-big", "an attached file is larger than 10 MB"));
        }
        let Some(name) = real.file_name().map(|n| n.to_os_string()) else {
            return Err(fail("file-missing", "an attached file has no name"));
        };
        picked.push((real, name));
    }
    let dest = files_dir(cwd)?;
    picked.into_iter().map(|(real, name)| copy_unique(&real, &dest, Path::new(&name))).collect()
}

/// 링크 · 정션이 아닌 그 폴더 바로 아래 실제 폴더인지 본다 — 밖으로 쓰지 않게.
fn files_dir(cwd: &Path) -> Result<PathBuf, WireError> {
    let bad = || fail("file-dest", "the attachment folder in the chat folder is not usable");
    let cwd = std::fs::canonicalize(cwd).map_err(|_| bad())?;
    let dir = cwd.join(FILES_DIR);
    match std::fs::symlink_metadata(&dir) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(bad()),
        Ok(_) => {}
        Err(_) => std::fs::create_dir(&dir).map_err(|_| bad())?,
    }
    // 정션처럼 `is_symlink` 가 못 알아볼 수 있는 되돌림도 — 실제 경로가 그 자리 그대로여야 한다
    if std::fs::canonicalize(&dir).map_err(|_| bad())? != dir {
        return Err(bad());
    }
    Ok(dir)
}

/// 있는 파일은 덮지 않는다.
fn copy_unique(src: &Path, dir: &Path, name: &Path) -> Result<AttachedFile, WireError> {
    use std::io::{Read, Write};
    let copy_err = || fail("file-copy", "an attached file could not be copied");
    let stem = name.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = name.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1..=999u32 {
        let candidate = if n == 1 { dir.join(name) } else { dir.join(format!("{stem} ({n}){ext}")) };
        let mut out = match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(copy_err()),
        };
        let written = std::fs::File::open(src)
            .and_then(|f| std::io::copy(&mut f.take(FILE_MAX_BYTES + 1), &mut out))
            .and_then(|w| out.flush().map(|()| w));
        drop(out);
        match written {
            Ok(w) if w <= FILE_MAX_BYTES => return Ok(AttachedFile { path: plain_path(&candidate) }),
            Ok(_) => {
                let _ = std::fs::remove_file(&candidate);
                return Err(fail("file-too-big", "an attached file is larger than 10 MB"));
            }
            Err(_) => {
                let _ = std::fs::remove_file(&candidate);
                return Err(copy_err());
            }
        }
    }
    Err(copy_err())
}

/// 꾸밈 없는 꼬리표 + 절대 경로로 둔다 — Claude 의 `@경로` 는 대화형 TUI 만 펼치고 stream-json · Codex app-server 의 글은 모델에 그대로 간다.
/// 재료는 서버가 지은 사본 경로뿐이라 AI 문자열이 끼지 않는다.
fn with_file_refs(text: &str, files: &[AttachedFile]) -> String {
    if files.is_empty() {
        return text.to_string();
    }
    use crate::side_chat::event::FILE_REF_PREFIX;
    let refs: Vec<String> = files.iter().map(|f| format!("{FILE_REF_PREFIX}{}", f.path)).collect();
    if text.trim().is_empty() {
        return refs.join("\n");
    }
    // 끝 줄바꿈만 걷는다 — 머리글만 있는 글의 `] ` 는 남아야 기록 보기(`parse_file_refs`)가 둘 다 떼어 읽는다
    format!("{}\n\n{}", text.trim_end_matches(['\n', '\r']), refs.join("\n"))
}

/// 채팅이 없어도 오류가 아니다(이미 닫힌 채팅의 늦은 확인).
fn op_seen(b: SeenBody) -> Value {
    let payload = find(&b.chat).ok().and_then(|chat| {
        let st = lock(&chat.st);
        seen_payload(&chat.id, st.core.id().get(), st.core.seq(), b.epoch, b.seq)
    });
    let sent = payload.is_some();
    if let Some(p) = payload {
        hub::emit(SEEN_EVENT, p);
    }
    json!({ "sent": sent })
}

fn seen_payload(chat: &str, cur_epoch: u64, cur_seq: u64, epoch: u64, seq: u64) -> Option<Value> {
    if epoch != cur_epoch || seq > cur_seq {
        return None;
    }
    Some(json!({ "chat": chat, "epoch": epoch, "seq": seq }))
}

fn op_interrupt(b: EpochBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    match a.encode_interrupt() {
        Ok(step) => {
            chat_proc::apply(&*chat, &mut st, step);
            Ok(json!(true))
        }
        Err(_) => Ok(json!(false)),
    }
}

fn op_set_model(b: ModelBody) -> Result<Value, WireError> {
    if !word_ok(&b.model) {
        return Err(fail("bad-model", "invalid model"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    st.model = b.model.clone();
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    let step = a.encode_set_model(&b.model).map_err(|w| fail(w, "the model was not changed"))?;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// 이 함수가 `encode_set_effort` 를 부르는 유일한 곳이다(시험 `side_chat_stdin_only_human`).
fn op_set_effort(b: EffortBody) -> Result<Value, WireError> {
    if b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-effort", "invalid reasoning effort"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let Some(a) = st.core.adapter() else {
        st.effort = b.effort;
        return Ok(json!(false));
    };
    let step = a.encode_set_effort(b.effort.as_deref()).map_err(|w| fail(w, "the reasoning effort was not changed"))?;
    st.effort = b.effort;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// 사람의 결정이 `encode_decision` 에 닿는 유일한 곳이다(MCP · 오케스트레이션에 이 길이 없다). 그 밖에 부르는 곳은 사람이 정한 모드 ·
/// 허용 목록으로 서버가 허용만 내는 [`policy_answer`] 하나다. `remember` 의 종류는 서버의 pending 에서 읽는다.
fn op_decide(b: DecideBody) -> Result<Value, WireError> {
    let decision = match b.decision.as_str() {
        "allow" => Decision::Allow,
        "deny" => Decision::Deny,
        _ => return Err(fail("bad-decision", "unknown decision")),
    };
    if b.remember && decision != Decision::Allow {
        return Err(fail("bad-decision", "only an allow can be remembered"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !st.core.is_pending(&b.request_id) {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    }
    // 기억할 종류는 그 기다리는 요청에서 — 화면이 보낸 글자는 없다
    let key = if b.remember { pending_key(&st, &b.request_id) } else { None };
    let Some(a) = st.core.adapter() else {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    };
    let step = a
        .encode_decision(&b.request_id, decision, b.message.as_deref())
        .map_err(|w| fail(w, "the decision was not sent"))?;
    chat_proc::apply(&*chat, &mut st, step);
    if let Some(k) = key {
        let mut next = st.perm.clone();
        if perm::remember(&mut next, &k) {
            // 저장이 실패해도 이 채팅 표에는 남긴다(사람이 방금 고른 뜻 — 다시 열면 그때의 저장 판)
            if let Some(root) = sidechat_root() {
                if perm::save(&root, &chat.id, &next).is_err() {
                    log::line(format!("side chat {} — could not save the permission list", chat.id));
                }
            }
            st.perm = next;
            note_policy(&chat, &mut st);
            answer_waiting(&chat, &mut st);
        }
    }
    Ok(json!(true))
}

fn pending_key(st: &State, request_id: &str) -> Option<String> {
    st.core.pending().into_iter().find_map(|ev| match ev {
        Ev::Permission { request_id: id, kind, tool_name, .. } if id == request_id => perm::key_of(*kind, tool_name, &st.mcp),
        _ => None,
    })
}

// ---------------------------------------------------------------------------
// 권한 모드 · 허용 목록
// ---------------------------------------------------------------------------

/// 서버가 대신 낸 허용 — 사람이 그 채팅에 정한 모드 · 허용 목록(`perm::answer_by`)이 그렇다고 할 때만 부른다. 늘 허용이고 글이 없다.
fn policy_answer(chat: &Chat, st: &mut State, request_id: &str, by: ResolvedBy) {
    let Some(a) = st.core.adapter() else { return };
    let Ok(mut step) = a.encode_decision(request_id, Decision::Allow, None) else { return };
    for ev in &mut step.evs {
        if let Ev::PermissionResolved { by: b, .. } = ev {
            *b = by;
        }
    }
    chat_proc::apply(chat, st, step);
}

fn answer_waiting(chat: &Chat, st: &mut State) {
    let waiting: Vec<(String, ResolvedBy)> = st
        .core
        .pending()
        .into_iter()
        .filter_map(|ev| match ev {
            Ev::Permission { request_id, kind, tool_name, .. } => {
                let key = perm::key_of(*kind, tool_name, &st.mcp);
                perm::answer_by(&st.perm, key.as_deref()).map(|by| (request_id.clone(), by))
            }
            _ => None,
        })
        .collect();
    for (id, by) in waiting {
        policy_answer(chat, st, &id, by);
    }
}

/// 지금 턴 꼬리에는 들지 않는다 — 스냅숏의 `permMode` · `permAllow` 가 맞춘다.
fn note_policy(chat: &Chat, st: &mut State) {
    let ev = Ev::PermPolicy { mode: st.perm.mode, allow: st.perm.allow.clone() };
    chat_proc::push(chat, st, ev);
}

fn perm_view(p: &ChatPerm) -> Value {
    json!({ "mode": p.mode, "allow": p.allow })
}

/// 프로세스를 다시 띄우지 않고 다음 요청부터 듣는다. Auto 면 이미 기다리는 카드도 허용으로 답한다.
fn op_set_perm_mode(b: PermModeBody) -> Result<Value, WireError> {
    let mode = match b.mode.as_str() {
        "manual" => PermMode::Manual,
        "auto" => PermMode::Auto,
        _ => return Err(fail("bad-mode", "unknown permission mode")),
    };
    let chat = find(&b.chat)?;
    let root = sidechat_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let mut st = lock(&chat.st);
    let mut next = st.perm.clone();
    next.mode = mode;
    perm::save(&root, &chat.id, &next).map_err(|_| fail("perm-save", "the permission mode was not saved"))?;
    // 새 채팅이 이어받는 "마지막 모드" — 실패해도 이 채팅은 바뀐다
    let _ = perm::save_last(&root, mode);
    st.perm = next;
    note_policy(&chat, &mut st);
    answer_waiting(&chat, &mut st);
    Ok(perm_view(&st.perm))
}

/// 빼기만 한다 — 넓히는 길은 `op_decide` 의 `remember` 하나다.
fn op_forget_allow(b: ForgetBody) -> Result<Value, WireError> {
    if !perm::key_ok(&b.kind) {
        return Err(fail("bad-kind", "unknown permission kind"));
    }
    let chat = find(&b.chat)?;
    let root = sidechat_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let mut st = lock(&chat.st);
    let mut next = st.perm.clone();
    if perm::forget(&mut next, &b.kind) {
        perm::save(&root, &chat.id, &next).map_err(|_| fail("perm-save", "the permission list was not saved"))?;
        st.perm = next;
        note_policy(&chat, &mut st);
    }
    Ok(perm_view(&st.perm))
}

// ---------------------------------------------------------------------------
// 연결
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkBody {
    chat: String,
    #[serde(default)]
    epoch: Option<u64>,
    /// 빈 배열 = 모두 끊기.
    streams: Vec<String>,
}

/// 서버 거울에 있는 창 타일만(헤드리스 아님). 읽기 권한은 여기서 보지 않는다 — 판정은 MCP 호출마다(`mcp/chat_read.rs`).
pub(crate) fn link_target_ok(map: &HashMap<String, crate::context::SessionContext>, stream: &str) -> bool {
    crate::tile_env::stream_ok(stream)
        && map.get(stream).is_some_and(|c| c.owner_kind == crate::session_owner::SessionOwnerKind::Window)
}

fn mirror_of(stream: &str) -> Option<(String, String, String, crate::context::SessionContext)> {
    let plane = hub::ai()?;
    let m = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
    m.get(stream).map(|c| (c.code.clone(), c.label.clone(), c.kind.clone(), crate::context::permission_view(c)))
}

fn link_views(chat: &str) -> Value {
    let delegation = crate::delegation::Delegation::load_default();
    Value::Array(crate::chat_token::links_of(chat).iter().map(|s| link_view(s, &delegation)).collect())
}

fn link_view(stream: &str, delegation: &crate::delegation::Delegation) -> Value {
    match mirror_of(stream) {
        Some((code, label, kind, view)) => {
            let readable = crate::context::ai_readable(&view, delegation);
            json!({ "stream": stream, "code": code, "label": label, "kind": kind, "readable": readable, "closed": false })
        }
        None => json!({ "stream": stream, "code": null, "label": null, "kind": null, "readable": false, "closed": true }),
    }
}

/// 스트림은 늘 서버가 아는 연결이다(화면이 고를 수 없다) — 화면은 칩 이름만 준다.
fn link_header_now(chat: &str, hints: Option<&HashMap<String, String>>) -> String {
    let links = crate::chat_token::links_of(chat);
    let names: Vec<String> = links
        .iter()
        .map(|s| {
            let label = mirror_of(s).map(|(_, label, ..)| label);
            let hint = hints.and_then(|h| h.get(s)).map(String::as_str);
            crate::side_chat::event::link_display_name(hint, label.as_deref())
        })
        .collect();
    let pairs: Vec<(&str, &str)> = links.iter().map(String::as_str).zip(names.iter().map(String::as_str)).collect();
    crate::side_chat::event::link_headers(&pairs)
}

/// 프런트 `side_chat_proxy::dedup` 과 같은 규칙이어야 한다.
pub(crate) fn dedup_streams(streams: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(streams.len());
    for s in streams {
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// 연결을 바꾸는 유일한 길이다(사람의 칩). 거절이면 아무것도 바꾸지 않는다.
fn op_link(b: LinkBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    if let Some(e) = b.epoch {
        check_epoch(&lock(&chat.st), e)?;
    }
    let streams = dedup_streams(b.streams);
    if streams.len() > crate::chat_token::LINKS_MAX {
        return Err(fail("too-many-links", "too many tiles linked to one side chat"));
    }
    if !streams.is_empty() {
        let plane = hub::ai().ok_or_else(|| fail("no-mirror", "the session mirror is not available"))?;
        let ok = {
            let map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
            streams.iter().all(|s| link_target_ok(&map, s))
        };
        if !ok {
            return Err(fail("bad-link", "that tile is not an open session the server knows"));
        }
    }
    let changed = crate::chat_token::set_links(&b.chat, streams);
    if changed {
        lock(&chat.st).link_note = true;
    }
    Ok(json!({ "links": link_views(&b.chat), "changed": changed }))
}

/// 채팅 토큰 판정에 쓴다 — 닫는 중이면 `None`.
pub(crate) fn live_proc(id: &str) -> Option<ProcId> {
    let chat = lock(&TABLE).chats.get(id).cloned()?;
    let live = lock(&chat.st).core.live();
    live
}

fn close(id: &str) -> bool {
    let Some(chat) = lock(&TABLE).chats.remove(id) else { return false };
    lock(&chat.st).core.kill("closed");
    crate::chat_token::forget(id);
    true
}

fn list() -> Value {
    let chats: Vec<Arc<Chat>> = lock(&TABLE).chats.values().cloned().collect();
    let mut rows: Vec<Value> = chats
        .iter()
        .map(|c| {
            let st = lock(&c.st);
            json!({
                "chat": c.id,
                "cli": st.cli,
                "model": st.model,
                "effort": st.effort,
                "epoch": st.core.id(),
                "status": st.core.status(),
                "conversationId": st.conv_seen.as_ref().or(st.conversation.as_ref()),
                "viewers": st.viewers.len(),
                "detached": st.detached.is_some(),
            })
        })
        .collect();
    rows.sort_by(|a, b| a["chat"].as_str().cmp(&b["chat"].as_str()));
    json!(rows)
}

// ---------------------------------------------------------------------------
// 수명 — 떼어 두기 · TTL · 모두 닫기
// ---------------------------------------------------------------------------

pub(crate) fn conn_opened(conn: u64) {
    lock(&TABLE).conns.insert(conn);
}

/// 남은 창이 없으면 그 순간부터 떼어 둔다(TTL).
fn detach_where(pick: impl Fn(&Viewer) -> bool) -> usize {
    let chats: Vec<Arc<Chat>> = lock(&TABLE).chats.values().cloned().collect();
    let now = Instant::now();
    let mut n = 0;
    for c in chats {
        let mut st = lock(&c.st);
        let before = st.viewers.len();
        st.viewers.retain(|v| !pick(v));
        if st.viewers.len() == before {
            continue;
        }
        n += 1;
        if st.viewers.is_empty() && st.detached.is_none() {
            st.detached = Some(now);
        }
    }
    if n > 0 {
        wake_reaper();
    }
    n
}

pub(crate) fn conn_gone(conn: u64) -> usize {
    lock(&TABLE).conns.remove(&conn);
    detach_where(|v| v.conn == conn)
}

/// 그 창 하나만 뗀다 — 다른 창은 계속 받는다.
pub(crate) fn detach_window(window: &str) -> usize {
    detach_where(|v| v.window == window)
}

#[cfg(test)]
pub(crate) fn viewers_for_test(id: &str) -> Option<(Vec<String>, bool)> {
    let chat = lock(&TABLE).chats.get(id).cloned()?;
    let st = lock(&chat.st);
    Some((windows_of(&st), st.detached.is_some()))
}

pub(crate) fn close_all() -> usize {
    let chats: Vec<Arc<Chat>> = lock(&TABLE).chats.drain().map(|(_, c)| c).collect();
    for c in &chats {
        lock(&c.st).core.kill("closed");
        crate::chat_token::forget(&c.id);
    }
    chats.len()
}

pub(crate) fn live_count() -> usize {
    lock(&TABLE).chats.len()
}

/// ms · 0 = [`DETACH_TTL`].
static TTL_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn ttl() -> Duration {
    match TTL_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => DETACH_TTL,
        ms => Duration::from_millis(ms),
    }
}

#[cfg(test)]
pub(crate) fn set_detach_ttl_for_test(d: Option<Duration>) {
    TTL_OVERRIDE_MS.store(d.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::SeqCst);
    REAPER_WAKE.notify_one();
}

/// 도는 턴은 끝까지 두지만, 사람이 없어 끝날 수 없는 권한 요청을 기다리는 턴은 TTL 에 닫는다.
fn expire(now: Instant) -> (usize, Option<Instant>) {
    let ttl = ttl();
    let mut t = lock(&TABLE);
    let mut next: Option<Instant> = None;
    let mut doomed = Vec::new();
    for (id, c) in &t.chats {
        let st = lock(&c.st);
        let Some(at) = st.detached else { continue };
        let due = at + ttl;
        if due > now {
            next = Some(next.map_or(due, |n| n.min(due)));
        } else if st.core.status() == Status::Running && !st.core.has_pending() {
            let again = now + Duration::from_secs(1);
            next = Some(next.map_or(again, |n| n.min(again)));
        } else {
            doomed.push(id.clone());
        }
    }
    let gone: Vec<Arc<Chat>> = doomed.iter().filter_map(|id| t.chats.remove(id)).collect();
    drop(t);
    for c in &gone {
        lock(&c.st).core.kill("closed");
        crate::chat_token::forget(&c.id);
    }
    (gone.len(), next)
}

static REAPER_WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);
static REAPER_RUNNING: AtomicBool = AtomicBool::new(false);

/// 시계가 없으면(처음 · 시험 런타임이 바뀌었다) 지금 런타임에 띄운다 — 런타임 밖 스레드면 깨우기만.
fn wake_reaper() {
    if !REAPER_RUNNING.swap(true, Ordering::SeqCst) {
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
                rt.spawn(reaper());
            }
            Err(_) => REAPER_RUNNING.store(false, Ordering::SeqCst),
        }
    }
    REAPER_WAKE.notify_one();
}

struct ReaperFlag;

impl Drop for ReaperFlag {
    fn drop(&mut self) {
        REAPER_RUNNING.store(false, Ordering::SeqCst);
    }
}

async fn reaper() {
    let _flag = ReaperFlag;
    loop {
        let (gone, next) = expire(Instant::now());
        if gone > 0 {
            log::line(format!("side chat: closed {gone} detached chat(s) after the {} s grace", ttl().as_secs()));
        }
        match next {
            Some(at) => {
                tokio::select! {
                    _ = tokio::time::sleep_until(at.into()) => {}
                    _ = REAPER_WAKE.notified() => {}
                }
            }
            None => REAPER_WAKE.notified().await,
        }
    }
}

// ---------------------------------------------------------------------------
// 시험 — 가짜 CLI
// ---------------------------------------------------------------------------

/// 모델을 부르지 않는 가짜 CLI.
#[cfg(test)]
pub(crate) struct FakeCli {
    pub exe: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub root: PathBuf,
    /// `None` = MCP 없음(채팅 토큰을 뽑지 않는다).
    pub mcp_port: Option<u16>,
    /// `(에이전트 id, 루트)`
    pub conv_roots: Vec<(&'static str, PathBuf)>,
}

#[cfg(test)]
static FAKE: Mutex<Option<FakeCli>> = Mutex::new(None);

#[cfg(test)]
pub(crate) fn set_fake_for_test(f: Option<FakeCli>) {
    *lock(&FAKE) = f;
}

/// 시험 빌드는 진짜 설정을 읽지 않는다.
#[cfg(test)]
static FAKE_SERVERS: Mutex<Option<Vec<crate::agent_mcp::McpServer>>> = Mutex::new(None);

#[cfg(test)]
pub(crate) fn set_fake_servers_for_test(list: Option<Vec<crate::agent_mcp::McpServer>>) {
    *lock(&FAKE_SERVERS) = list;
}

#[cfg(test)]
mod image_tests {
    use super::*;

    fn reason(e: WireError) -> String {
        e.message
    }

    #[test]
    fn images_only_from_the_attachment_folder() {
        let base = std::env::temp_dir().join(format!("aynx-sidechat-img-{}", crate::token::generate_token().unwrap()));
        let root = base.join("attachments");
        let dir = root.join("a".repeat(64));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("붙임 1.PNG");
        std::fs::write(&png, [0x89, b'P', b'N', b'G']).unwrap();
        let txt = dir.join("note.txt");
        std::fs::write(&txt, b"x").unwrap();
        let outside = base.join("out.png");
        std::fs::write(&outside, b"x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();

        let ok = images_in(&root, &[s(&png)], true).unwrap();
        assert_eq!(ok.len(), 1);
        assert_eq!(ok[0].media_type, "image/png");
        assert_eq!(ok[0].data.as_deref(), Some(crate::setup_script::base64_encode(&[0x89, b'P', b'N', b'G']).as_str()));
        assert!(!ok[0].path.starts_with(r"\?\"), "CLI 에는 확장 머리 없는 경로");
        assert!(Path::new(&ok[0].path).ends_with("붙임 1.PNG"));
        // Codex 몫은 바이트를 읽지 않는다
        assert_eq!(images_in(&root, &[s(&png)], false).unwrap()[0].data, None);
        // 첨부 자리 밖 · `..` 로 빠져나가기
        let escape = format!("{}/../../out.png", s(&dir));
        for p in [s(&outside), escape] {
            assert!(reason(images_in(&root, &[p], false).unwrap_err()).contains("[image-outside]"));
        }
        assert!(reason(images_in(&root, &[s(&root)], false).unwrap_err()).contains("[image-outside]"));
        assert!(reason(images_in(&root, &[s(&dir)], false).unwrap_err()).contains("[image-not-file]"));
        assert!(reason(images_in(&root, &[s(&txt)], false).unwrap_err()).contains("[image-type]"));
        assert!(reason(images_in(&root, &[s(&dir.join("없음.png"))], false).unwrap_err()).contains("[image-missing]"));
        let many: Vec<String> = (0..=IMAGES_MAX).map(|_| s(&png)).collect();
        assert!(reason(images_in(&root, &many, false).unwrap_err()).contains("[too-many-images]"));
        assert_eq!(images_in(&root, &many[..IMAGES_MAX], false).unwrap().len(), IMAGES_MAX);
        let big = dir.join("big.webp");
        std::fs::File::create(&big).unwrap().set_len(IMAGE_MAX_BYTES + 1).unwrap();
        assert!(reason(images_in(&root, &[s(&big)], false).unwrap_err()).contains("[image-too-big]"));
        assert!(chat_images(<&[String]>::default(), true).unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn files_only_from_the_attachment_folder_into_the_chat_cwd() {
        let base = std::env::temp_dir().join(format!("aynx-sidechat-file-{}", crate::token::generate_token().unwrap()));
        let root = base.join("attachments");
        let dir = root.join("b".repeat(64));
        let cwd = base.join("chat");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&cwd).unwrap();
        let ts = dir.join("main.ts");
        std::fs::write(&ts, b"export {}").unwrap();
        let noext = dir.join("Makefile");
        std::fs::write(&noext, b"all:").unwrap();
        let outside = base.join("secret.txt");
        std::fs::write(&outside, b"x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();

        let got = files_in(&root, &cwd, &[s(&ts), s(&noext)]).unwrap();
        let real_cwd = std::fs::canonicalize(&cwd).unwrap();
        let first = Path::new(&got[0].path);
        assert!(!got[0].path.starts_with(r"\\?\"), "CLI 에는 확장 머리 없는 경로");
        assert!(first.ends_with("attachments/main.ts") || first.ends_with(r"attachments\main.ts"));
        assert!(Path::new(&plain_path(&real_cwd)).join("attachments").join("main.ts") == first);
        assert_eq!(std::fs::read(first).unwrap(), b"export {}");
        assert!(Path::new(&got[1].path).ends_with("Makefile"));
        // 같은 이름은 덮지 않는다 — ` (2)` · ` (3)`
        let again = files_in(&root, &cwd, &[s(&ts), s(&ts)]).unwrap();
        assert!(Path::new(&again[0].path).ends_with("main (2).ts"));
        assert!(Path::new(&again[1].path).ends_with("main (3).ts"));
        assert_eq!(std::fs::read(first).unwrap(), b"export {}", "처음 사본은 그대로");
        // 첨부 자리 밖 · `..` 로 빠져나가기 · 폴더 · 없음
        let escape = format!("{}/../../secret.txt", s(&dir));
        for p in [s(&outside), escape, s(&cwd.join("attachments").join("main.ts"))] {
            assert!(reason(files_in(&root, &cwd, &[p]).unwrap_err()).contains("[file-outside]"));
        }
        assert!(reason(files_in(&root, &cwd, &[s(&root)]).unwrap_err()).contains("[file-outside]"));
        assert!(reason(files_in(&root, &cwd, &[s(&dir)]).unwrap_err()).contains("[file-not-file]"));
        assert!(reason(files_in(&root, &cwd, &[s(&dir.join("없음.ts"))]).unwrap_err()).contains("[file-missing]"));
        let many: Vec<String> = (0..=IMAGES_MAX).map(|_| s(&ts)).collect();
        assert!(reason(files_in(&root, &cwd, &many).unwrap_err()).contains("[too-many-attachments]"));
        let big = dir.join("big.pdf");
        std::fs::File::create(&big).unwrap().set_len(FILE_MAX_BYTES + 1).unwrap();
        // 하나라도 틀리면 아무것도 옮기지 않는다
        let before = std::fs::read_dir(cwd.join("attachments")).unwrap().count();
        assert!(reason(files_in(&root, &cwd, &[s(&noext), s(&big)]).unwrap_err()).contains("[file-too-big]"));
        assert_eq!(std::fs::read_dir(cwd.join("attachments")).unwrap().count(), before);
        assert!(chat_files("x", &[]).unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn file_refs_append_after_the_text() {
        let f = |p: &str| AttachedFile { path: p.to_string() };
        assert_eq!(with_file_refs("봐 줘", &[]), "봐 줘");
        assert_eq!(
            with_file_refs("봐 줘\n", &[f(r"C:\c\attachments\a.ts"), f(r"C:\c\attachments\b.pdf")]),
            "봐 줘\n\nAttached file: C:\\c\\attachments\\a.ts\nAttached file: C:\\c\\attachments\\b.pdf"
        );
        assert_eq!(with_file_refs("", &[f("/c/attachments/a.ts")]), "Attached file: /c/attachments/a.ts");
        // 기록 읽기(`parse_file_refs`)가 그대로 되읽는다 — 머리글만 있는 글(연결이 바뀐 뒤 파일만 보냄)도 머리글 · 꼬리 둘 다
        use crate::side_chat::event::{parse_file_refs, parse_link_note, LINK_HEADER_NONE};
        let made = with_file_refs("봐 줘", &[f(r"C:\c\attachments\a.ts"), f(r"C:\c\attachments\b (2).pdf")]);
        assert_eq!(parse_file_refs(&made), Some((vec!["a.ts".to_string(), "b (2).pdf".to_string()], "봐 줘")));
        let only = with_file_refs("", &[f("/c/attachments/a.ts")]);
        assert_eq!(parse_file_refs(&only), Some((vec!["a.ts".to_string()], "")));
        let both = with_file_refs(LINK_HEADER_NONE, &[f("/c/attachments/a.ts")]);
        let (names, rest) = parse_file_refs(&both).unwrap();
        assert_eq!((names, parse_link_note(rest).map(|(_, r)| r)), (vec!["a.ts".to_string()], Some("")));
    }
}
