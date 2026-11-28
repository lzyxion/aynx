//! 채팅 모양 AI 타일 표 — 세션 서버에 한 벌. 프로세스 몸은 공용 코어 `server::chat_proc` 이고 이 파일은 셋째 주인이다.
//! 세션이 아니다 — `session_core` 에 오르지 않고 떨어진 세션 목록 · 거울 · `serve::Busy` 에 들지 않는다.
//!
//! - 열쇠는 `ct-` 로 시작한다 — 사이드 채팅 · 프로듀서 표는 이 id 를 `[wrong-chat-kind]` 로 거절한다.
//! - **띄우는 곳은 [`start_ready`] 하나 — 보내기 · 되감기 미리 보기 · 검토 · 목표 정하기 · 이어 하기(같은 대화의 resume · 사람 글 없음)만 부른다**([`spawn`]).
//!   `open` 은 표에 세우기만 한다. 속도 · MCP 상태 · 목표 멈춤 · 지우기는 띄우지 않는다.
//! - **stdin 에는 사람 글 · 사람 결정 · 사람 제어만** — 줄은 사람 op(보내기 · 끊기 · 모델 · 강도 · 권한 모드 · 결정 · 압축 · 되감기 · 검토 · 목표 · MCP 상태)에서만
//!   짓는다. 서버가 권한 요청에 대신 답하는 길 · MCP → stdin 길은 없다(→ docs/invariants.md 전문 4).
//! - **목표는 사람이 정한다** — 서버는 스스로 목표를 정하거나 · 이어 하거나 · 멈추거나 · 지우지 않는다(Aynx 밖에서 선 목표도 사람 단추만). [중지]만 `active`
//!   Codex 목표의 멈춤을 함께 보낸다(끊기만으로는 CLI 가 곧 다음 턴을 연다). 목표 글 · 지침 · 브랜치 · sha · MCP 이름은 로그에 남기지 않는다.
//! - MCP 상태는 어댑터의 허용 목록 줄만 받아 두고, 스냅숏이 `aynx`(Aynx 세션 서버) · `picked`(Aynx 가 실은 외부 서버) 표를 얹는다.
//! - 압축 op 는 **띄우지 않는다**(프로세스가 없으면 `[not-started]`) · 턴 중이면 `[turn-running]` — Codex 는 턴 중의 압축으로 돌던 턴을 끊는다.
//! - 되감기는 미리 보기 → 실행 두 걸음 — 실행은 같은 세대 · 기준점 · 범위의 `can:true` 미리 보기 뒤에만 받고(`[preview-first]`) 띄우지 않는다.
//!   두 CLI 모두 턴 중 · 권한 대기 중에도 되감으므로 `[turn-running]` 이 유일한 방어다. Claude 기준점 · 마지막 사람 말은 서버가 기록 파일에서 읽는다(프런트 글자가 아니다).
//!   Claude 대화 되감기의 `done` 은 기록에 표지가 적힐 때까지(상한 [`MARK_WAIT`]) 잡아 둔다 — 창들이 다시 읽는 기록이 이미 잘려 있게. 그동안 CLI 에는 보내는 것이 없다.
//! - 스킬은 이름만 받는다 — 경로는 어댑터가 제 목록에서 찾는다. 목록 · 맥락 사용량은 CLI 가 알린 것을 받아 두기만 한다.
//! - 권한 모드는 **CLI 자신의 모드**다 — 사람이 고른 값([`offered`] 를 지난 것)만 `perm_mode` 에 남아 다시 띄울 때 실린다. bypass · 묻지 않기 · 전체 접근은 고를 수 없다.
//! - 결정의 몸에는 결정 낱말(+ 질문 답)뿐 — 늘 허용이 실을 제안 · 규칙 · 목적지는 어댑터가 제 대기 장부에서 고른다(프런트가 고르지 못한다).
//! - 사건 `chat-tile-event` 는 본문이 있어 `client::RELAYED` 에 넣지 않는다 — 받을 구독을 몸의 `subs` 에 싣는다.
//!
//! ## 수명
//!
//! - 닫기 = 곧바로. 보조 창 파괴 = 그 창이 책임 창인 항목 닫기(이관 중 제외). 리로드 · 떠나기 · 연결 끊김 = 구독만 떼고 [`DETACH_TTL`] —
//!   도는 턴은 끝까지, 쉬거나 권한을 기다리면 TTL 에 닫는다. 새 항목은 첫 구독 전까지 떼어 둔 상태다.
//! - **끝 정리는 토큰 먼저**(채팅 타일 토큰은 칸이 곧 생존) — `on_ending` 은 그 세대만 거두고, 표에서 빼는 닫기는 칸째 잊는다.
//! - 대화 장부의 열림은 **항목 수명** — 항목이 대화를 쥐면 link, 표에서 빠질 때만 release([`unlink`]). 프로세스 끝은 놓지 않는다.
//! - 사이드 채팅 표에 있는 대화의 resume 은 `[conversation-in-side-chat]` — 장부가 아니라 두 표를 맞대 본다.
//! - **첨부는 사본을 두지 않는다** — cwd 가 사용자 저장소라 앱 첨부 자리의 경로 줄만 글에 붙인다(서버가 그 자리 안의 실제 파일인지 다시 본다).
//!
//! **로그**: 채팅 id · 세대 · pid · 끝 코드 · 버린 줄 수 · 되감기 범위와 결과 낱말 · 검토 대상 종류 · 목표 낱말과 한도만. 글 · 모델 답 · 도구 출력 · 경로 · 토큰 ·
//! 기준점 · 목표 글 · 검토 지침 · MCP 줄 · CLI 오류 글은 남기지 않는다.

mod launch;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::chat_proc::{self, Core, ProcExit, ProcId, Status};
use super::ipc::WireError;
use super::side_chat::{DETACH_TTL, FOLDER_MISSING, STALE_CHAT};
use super::{hub, log};
use crate::errors::{with_reason, SESSION_GONE};
use crate::side_chat::event::{
    model_ok, review_target, rewind_scope, slash_name_ok, tier_ok, uuid_ok, word_ok, CompactPhase, GoalAction, GoalView, McpRow, RewindPhase, SlashCommand, TileAnswer,
    Tier, GOAL_BUDGETS, OBJECTIVE_CHARS,
};
use crate::side_chat::{store, Cli, Decision, Ev};

pub(crate) const EVENT: &str = "chat-tile-event";
pub(crate) const CHAT_TILE: &str = "chat-tile";
pub(crate) const ID_PREFIX: &str = "ct-";
const TEXT_MAX: usize = 256 * 1024;
const CLIENT_ID_MAX: usize = 64;
const SENT_MAX: usize = 32;
/// 질문 답 몸(직렬화) — 바이트.
const ANSWERS_MAX: usize = 64 * 1024;

/// 칩이 내는 값 — Claude 의 `auto` 는 CLI 가 알렸을 때만(`CliModeSeen.choices`), Codex 의 `plan` 은 알린 choices 가 있으면 그 안에 있을 때만.
const CLAUDE_MODES: [&str; 3] = ["default", "acceptEdits", "plan"];
const CODEX_MODES: [&str; 3] = ["readOnly", "auto", "plan"];

/// 마지막으로 CLI 가 알린 모드 · 고를 수 있는 값.
#[derive(Clone)]
struct CliModeSeen {
    mode: String,
    choices: Vec<String>,
}

/// **고를 수 있는 값만** — bypass · 묻지 않기 · Codex 전체 접근 · `custom` 은 여기를 지나지 못한다. 순수.
fn offered(cli: Cli, seen: Option<&CliModeSeen>, mode: &str) -> bool {
    let told = |m: &str| seen.is_some_and(|s| s.choices.iter().any(|c| c == m));
    match cli {
        Cli::Claude => CLAUDE_MODES.contains(&mode) || (mode == "auto" && told("auto")),
        Cli::Codex => CODEX_MODES.contains(&mode) && (mode != "plan" || seen.is_none() || told("plan")),
    }
}

/// 열기 · 명세에서 받는 값 — Claude `auto` 는 띄우기 전에는 쓸 수 있는지 몰라 버린다.
fn open_mode_ok(cli: Cli, mode: &str) -> bool {
    match cli {
        Cli::Claude => CLAUDE_MODES.contains(&mode),
        Cli::Codex => CODEX_MODES.contains(&mode),
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn fail(reason: &str, message: impl Into<String>) -> WireError {
    WireError::new(CHAT_TILE, with_reason(reason, message.into()))
}

pub(crate) fn is_op(op: &str) -> bool {
    matches!(
        op,
        "chat_tile_open"
            | "chat_tile_send"
            | "chat_tile_interrupt"
            | "chat_tile_set_model"
            | "chat_tile_set_effort"
            | "chat_tile_set_perm_mode"
            | "chat_tile_decide"
            | "chat_tile_compact"
            | "chat_tile_rewind"
            | "chat_tile_review"
            | "chat_tile_goal"
            | "chat_tile_set_tier"
            | "chat_tile_mcp_status"
            | "chat_tile_close"
            | "chat_tile_subscribe"
            | "chat_tile_unsubscribe"
            | "chat_tile_attach"
            | "chat_tile_list"
    )
}

fn cli_name(cli: Cli) -> &'static str {
    match cli {
        Cli::Claude => "claude",
        Cli::Codex => "codex",
    }
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

/// 같은 `subGen` 만 지운다.
struct Sub {
    conn: u64,
    window: String,
    gen: u64,
}

/// `Debug` 를 파생하지 않는다(본문).
struct Sent {
    client_id: String,
    text: String,
    /// 첨부의 파일 이름만.
    files: Vec<String>,
}

pub(super) struct State {
    pub(super) cli: Cli,
    pub(super) model: String,
    pub(super) effort: Option<String>,
    /// `/` 로 적은 이 PC 의 절대 경로 — fresh 는 서버가 다시 본 타일 폴더, resume 은 대화 색인의 기록된 cwd.
    pub(super) cwd: String,
    /// 턴이 한 번 선 것만 — 다음 띄우기가 resume 한다.
    pub(super) conversation: Option<String>,
    conv_seen: Option<String>,
    /// 대화 장부에 이 채팅 id 로 link 한 대화 — 표에서 빠질 때 release 와 짝을 맞춘다.
    linked: Option<String>,
    /// 책임 창 — 이 라벨의 보조 창이 부서지면 닫는다. 원격 창이 연 항목은 `None`. 화면에 싣지 않는다.
    home: Option<String>,
    subs: Vec<Sub>,
    /// 구독이 0 이 된 순간부터.
    detached: Option<Instant>,
    sent: VecDeque<Sent>,
    pub(super) mcp: Vec<String>,
    /// 사람이 그 타일에서 고른(또는 고른 뒤 CLI 가 옮긴) 모드 — 다시 띄울 때 싣는다. None = 사용자 CLI 설정 그대로.
    pub(super) perm_mode: Option<String>,
    /// 띄운 뒤에도 지우지 않는다(다음 CLI 가 곧 다시 알린다).
    cli_mode: Option<CliModeSeen>,
    /// 마지막 `Ev::Commands` · `Ev::ContextUsage` · `Ev::Compaction{Done}` — 띄운 뒤에도 지우지 않는다.
    commands: Option<CommandsSeen>,
    context: Option<ContextSeen>,
    last_compaction: Option<CompactSeen>,
    /// 마지막 `Ev::RewindCaps` — 띄운 뒤에도 지우지 않는다.
    rewind_caps: Option<RewindCaps>,
    /// 보낸 되감기 요청의 답을 기다린다 — 하나뿐.
    rewinding: Option<Rewinding>,
    /// 기록에 표지가 적히기를 기다리는 Claude 대화 되감기 `done` — 그동안 `rewindGen` 도 그대로다.
    held: Option<Held>,
    /// 마지막으로 `can:true` 로 끝난 미리 보기 — 세대가 바뀌면 지운다.
    rewind_ok: Option<Previewed>,
    /// 대화 되감기가 끝날 때마다 +1 — 다른 창이 기록을 처음부터 다시 읽는다.
    rewind_gen: u64,
    /// 마지막 `Ev::McpStatus` · `Ev::Goal` · `Ev::ServiceTiers` — 띄운 뒤에도 지우지 않는다(다음 CLI 가 곧 다시 알린다). MCP 줄은 띄우면 `stale`.
    mcp_status: Option<McpSeen>,
    /// 사람이 연 읽기의 답을 기다린다 — 답이 오거나 [`MCP_WAIT`] 가 지나면 다음 읽기를 받는다.
    mcp_asked: Option<Instant>,
    goal: Option<GoalView>,
    /// 사람이 `set` 으로 정한 목표 글 — 다시 띄운 CLI 가 알린 같은 목표를 밖의 것으로 보이지 않게(CLI 는 출처를 알리지 않는다).
    goal_ours: Option<String>,
    /// 사람이 고른 Codex 속도 등급 — 다시 띄울 때 어댑터에 싣는다(턴 몸에만).
    pub(super) tier: Option<String>,
    tiers: Option<TiersSeen>,
    /// CLI 가 마지막 `Ready` 에 알린 모델 — 사람이 고른 것이 없을 때 속도 등급 표의 열쇠다(다시 붙은 창이 칩을 잃지 않게).
    cli_model: Option<String>,
    core: Core,
}

#[derive(Clone)]
struct McpSeen {
    servers: Vec<McpRow>,
    source: &'static str,
    stale: bool,
}

#[derive(Clone)]
struct TiersSeen {
    by_model: BTreeMap<String, Vec<Tier>>,
    thread: Option<String>,
}

/// 실측 한 번에 약 7.5초 — 쪽을 나눠 읽는 시한.
const MCP_WAIT: Duration = Duration::from_secs(15);

/// 순수 — 스냅숏의 MCP 줄. 어댑터의 허용 목록 칸에 표 둘만 얹는다.
fn mcp_rows_view(rows: &[McpRow], aynx: &str, picked: &[String]) -> Vec<Value> {
    rows.iter()
        .map(|r| {
            json!({ "name": r.name, "state": r.state, "auth": r.auth, "tools": r.tools, "scope": r.scope,
                "aynx": r.name == aynx, "picked": picked.contains(&r.name) })
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct RewindCaps {
    files: bool,
    conversation: bool,
}

#[derive(PartialEq, Eq)]
struct Previewed {
    anchor: String,
    scope: &'static str,
    proc: ProcId,
}

struct Rewinding {
    at: Instant,
    /// Claude 대화 되감기 실행 — 표지를 기다릴 기록 파일과 보내기 전 길이.
    watch: Option<(PathBuf, u64)>,
    /// 기준점이 압축 경계 앞이다 — CLI 의 기준점 거절을 `before_compact` 로 읽는다.
    before_compact: bool,
}

/// 받은 그대로의 사건과 그 번호 — 놓을 때 같은 번호로 낸다(창들이 빈틈으로 보지 않게).
struct Held {
    proc: ProcId,
    seq: u64,
    ev: Ev,
    hold: u64,
}

/// 답이 이만큼 없으면 다음 되감기 op 가 기다림을 버린다(서버는 스스로 사건을 짓지 않는다).
const REWIND_WAIT: Duration = Duration::from_secs(30);
/// CLI 는 대화 되감기 답을 낸 뒤에 기록에 표지를 쓴다 — 그때까지 `done` 을 잡아 두는 상한 · 살피는 간격.
const MARK_WAIT: Duration = Duration::from_secs(2);
const MARK_POLL: Duration = Duration::from_millis(25);
static NEXT_HOLD: AtomicU64 = AtomicU64::new(1);

/// 순수 — 캡을 아직 모르면(띄운 적 없음) CLI 의 정적 범위: Claude = 셋 · Codex = 대화.
fn scope_ok(cli: Cli, caps: Option<&RewindCaps>, scope: &str) -> bool {
    let (files, conversation) = match (cli, caps) {
        (_, Some(c)) => (c.files, c.conversation),
        (Cli::Claude, None) => (true, true),
        (Cli::Codex, None) => (false, true),
    };
    match scope {
        "files" => cli == Cli::Claude && files,
        "conversation" => conversation,
        "both" => cli == Cli::Claude && files && conversation,
        _ => false,
    }
}

#[derive(Clone)]
struct CommandsSeen {
    commands: Vec<SlashCommand>,
    terminal: Vec<String>,
}

#[derive(Clone)]
struct ContextSeen {
    used: u64,
    window: Option<u64>,
    source: &'static str,
}

#[derive(Clone)]
struct CompactSeen {
    trigger: Option<String>,
    pre_tokens: Option<u64>,
    post_tokens: Option<u64>,
}

pub(super) struct ChatTile {
    id: String,
    st: Mutex<State>,
    cv: Condvar,
}

#[derive(Default)]
struct Table {
    chats: HashMap<String, Arc<ChatTile>>,
    /// 끊긴 뒤에 끝난 구독은 덧붙이지 않는다.
    conns: HashSet<u64>,
    next_sub: u64,
}

static TABLE: LazyLock<Mutex<Table>> = LazyLock::new(Default::default);

/// `bad-chat` → `wrong-chat-kind` 순서.
fn id_check(id: &str) -> Result<(), WireError> {
    if !store::id_ok(id) {
        return Err(fail("bad-chat", "invalid chat tile id"));
    }
    if !(id.starts_with(ID_PREFIX) && id.len() > ID_PREFIX.len()) {
        return Err(fail("wrong-chat-kind", "a chat tile id starts with ct-"));
    }
    Ok(())
}

fn find(id: &str) -> Result<Arc<ChatTile>, WireError> {
    id_check(id)?;
    lock(&TABLE)
        .chats
        .get(id)
        .cloned()
        .ok_or_else(|| fail(SESSION_GONE, "this chat tile is not open on the session server"))
}

fn check_epoch(st: &State, epoch: u64) -> Result<(), WireError> {
    if st.core.id().get() != epoch {
        return Err(fail(STALE_CHAT, format!("stale chat tile process (now {})", st.core.id())));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 코어의 주인 — 사건 · 장부 · 끝 정리
// ---------------------------------------------------------------------------

fn emit(chat: &ChatTile, st: &State, proc: ProcId, seq: u64, ev: &Ev) {
    let subs: Vec<Value> = st.subs.iter().map(|s| json!({ "conn": s.conn, "window": s.window, "subGen": s.gen })).collect();
    let body = json!({ "chat": chat.id, "epoch": proc, "seq": seq, "ev": ev_wire(st, ev), "subs": subs });
    hub::emit(EVENT, body);
}

/// 창에 내는 사건 — MCP 줄에는 스냅숏과 같은 표 둘을 얹는다(어댑터는 그 둘을 모른다).
fn ev_wire(st: &State, ev: &Ev) -> Value {
    match ev {
        Ev::McpStatus { servers, source } => json!({
            "t": "mcpStatus", "source": source,
            "servers": mcp_rows_view(servers, crate::instance::mcp_name(crate::instance::DEV), &st.mcp),
        }),
        _ => json!(ev),
    }
}

/// 장부의 link 를 지금 이어 갈 대화에 맞춘다 — 대화가 바뀌면 옛 것을 놓는다.
fn relink(chat: &ChatTile, st: &mut State) {
    if st.linked == st.conversation {
        return;
    }
    let agent = cli_name(st.cli);
    if let Some(old) = st.linked.take() {
        crate::agent_state::release_stream(agent, &old, &chat.id);
    }
    if let Some(c) = st.conversation.as_deref() {
        crate::agent_state::link_stream(agent, c, &chat.id);
        st.linked = Some(c.to_string());
    }
}

/// 항목이 표에서 빠질 때만 — 프로세스 끝이 아니라 항목 끝이 열림의 끝이다(잎이 남으면 다음 보내기가 같은 대화를 잇는다).
fn unlink(chat: &ChatTile, st: &mut State) {
    if let Some(c) = st.linked.take() {
        crate::agent_state::release_stream(cli_name(st.cli), &c, &chat.id);
    }
}

/// 그 대화를 쥔 항목이 있나(`conversation` 또는 `conv_seen` · 프로세스 유무 무관). 블로킹 — 부르는 쪽은 잠금을 쥐지 않는다.
pub(crate) fn holds_conversation(cli: Cli, conv: &str) -> bool {
    let chats: Vec<Arc<ChatTile>> = lock(&TABLE).chats.values().cloned().collect();
    chats.iter().any(|c| {
        let st = lock(&c.st);
        st.cli == cli && [&st.conversation, &st.conv_seen].into_iter().flatten().any(|x| x.eq_ignore_ascii_case(conv))
    })
}

impl chat_proc::Host for ChatTile {
    type St = State;

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.st)
    }

    fn core(st: &mut State) -> &mut Core {
        &mut st.core
    }

    /// 다른 창(원격)이 사람 말풍선을 그리게 보낸 글을 얹는다. CLI 가 옮긴 모드(계획 승인 · 제안 수락)는 사람이 고른 적이 있을 때만 따라간다 —
    /// 사용자 설정을 명세에 굳히지 않는다.
    fn shape(&self, st: &mut State, ev: &mut Ev) {
        if let Ev::CliMode { mode, choices, chosen } = ev {
            let seen = CliModeSeen { mode: mode.clone(), choices: choices.clone() };
            if st.perm_mode.is_some() && offered(st.cli, Some(&seen), mode) {
                st.perm_mode = Some(mode.clone());
            }
            *chosen = st.perm_mode.clone();
        }
        // resume 한 CLI 는 압축 전 기준점을 "못 찾음" 으로 거절한다 — 다시 해도 안 되는 까닭으로 바꿔 알린다
        if let Ev::Rewind { phase: RewindPhase::Failed, scope, error: Some(e), .. } = ev {
            let before_compact = st.rewinding.as_ref().is_some_and(|r| r.before_compact);
            if let Some(w) = failure_word(before_compact, scope, e) {
                *e = w.to_string();
            }
        }
        // 다시 띄운 CLI 는 사람이 정한 목표도 출처 없이 알린다 — 서버가 기억한 글이면 Aynx 의 목표다
        if let Ev::Goal { goal: Some(g) } = ev {
            if st.goal_ours.as_deref() == Some(g.objective.trim()) {
                g.auto = false;
            }
        }
        if let Ev::UserAccepted { client_id, text, files } = ev {
            let at = match client_id.as_deref() {
                Some(id) => st.sent.iter().position(|s| s.client_id == id),
                None => (!st.sent.is_empty()).then_some(0),
            };
            if let Some(s) = at.and_then(|i| st.sent.drain(..=i).next_back()) {
                *text = Some(crate::side_chat::event::Said(s.text));
                *files = s.files;
            }
        }
    }

    fn on_event(&self, st: &mut State, proc: ProcId, seq: u64, ev: &Ev) {
        // 잡아 둔 `done` 은 뒤 사건보다 먼저 — 번호 순서 그대로(프로세스 끝도 여기서 푼다)
        if st.held.is_some() {
            release_held(self, st);
        }
        match ev {
            Ev::Ready { conversation_id, model, .. } => {
                if conversation_id.is_some() {
                    st.conv_seen = conversation_id.clone();
                }
                if model.is_some() {
                    st.cli_model = model.clone();
                }
                self.cv.notify_all();
            }
            // 첫 턴 전의 새 대화는 CLI 에 아직 없다 — 턴이 선 뒤에만 이어 갈 대화 · 장부에 적는다.
            Ev::TurnStarted { .. } => {
                if st.conv_seen.is_some() {
                    st.conversation = st.conv_seen.clone();
                }
                relink(self, st);
            }
            Ev::Notice { code: "conversation-changed", detail: Some(id) } => {
                st.conv_seen = Some(id.clone());
                if st.core.status() == Status::Running {
                    st.conversation = Some(id.clone());
                    relink(self, st);
                }
            }
            Ev::McpServers { names } => st.mcp = names.clone(),
            Ev::CliMode { mode, choices, .. } => st.cli_mode = Some(CliModeSeen { mode: mode.clone(), choices: choices.clone() }),
            Ev::Commands { commands, terminal } => st.commands = Some(CommandsSeen { commands: commands.clone(), terminal: terminal.clone() }),
            Ev::ContextUsage { used, window, source } => st.context = Some(ContextSeen { used: *used, window: *window, source }),
            Ev::Compaction { phase: CompactPhase::Done, trigger, pre_tokens, post_tokens } => {
                st.last_compaction = Some(CompactSeen { trigger: trigger.clone(), pre_tokens: *pre_tokens, post_tokens: *post_tokens })
            }
            Ev::RewindCaps { files, conversation } => st.rewind_caps = Some(RewindCaps { files: *files, conversation: *conversation }),
            Ev::McpStatus { servers, source } => {
                if *source == "list" {
                    st.mcp_asked = None;
                }
                st.mcp_status = Some(McpSeen { servers: servers.clone(), source, stale: false });
            }
            Ev::Notice { code: "mcp-status-failed", .. } => st.mcp_asked = None,
            Ev::Goal { goal } => {
                if goal.is_none() {
                    st.goal_ours = None;
                }
                st.goal = goal.clone();
            }
            Ev::ServiceTiers { by_model, thread } => st.tiers = Some(TiersSeen { by_model: by_model.clone(), thread: thread.clone() }),
            Ev::Rewind { phase: RewindPhase::Done, scope, .. } if *scope != "files" => {
                // 창들이 `rewindGen` 을 보고 곧바로 기록을 다시 읽는다 — 표지가 적힌 뒤에 낸다(CLI 에는 아무것도 보내지 않는다)
                if let Some((path, from)) = st.rewinding.as_mut().and_then(|r| r.watch.take()) {
                    let hold = NEXT_HOLD.fetch_add(1, Ordering::Relaxed);
                    st.rewind_ok = None;
                    st.held = Some(Held { proc, seq, ev: ev.clone(), hold });
                    watch_marker(self.id.clone(), hold, path, from);
                    return;
                }
                rewind_ended(self, st, proc, ev);
            }
            Ev::Rewind { .. } => rewind_ended(self, st, proc, ev),
            Ev::Exited { .. } => {
                st.rewinding = None;
                st.rewind_ok = None;
                self.cv.notify_all();
            }
            _ => {}
        }
        emit(self, st, proc, seq, ev);
    }

    /// **그 세대의 토큰을 먼저** 거둔다 — 끝 사건을 본 쪽에게 남은 것이 없게. 장부는 놓지 않는다([`unlink`]).
    fn on_ending(&self, _st: &mut State, proc: ProcId) {
        crate::chat_token::revoke(&self.id, proc);
    }

    fn on_exit(&self, e: ProcExit) {
        log::line(format!(
            "chat tile {} — process {} ended ({}, code {:?}, dropped {} bad · {} unknown line(s))",
            self.id, e.proc, e.reason, e.code, e.dropped.bad, e.dropped.unknown
        ));
        wake_reaper();
    }
}

/// 순수 — 압축 경계 앞 기준점의 대화 거절이면 `before_compact`. 같은 프로세스는 그 기준점을 받으므로 미리 막지 않고 거절만 바꿔 읽는다.
fn failure_word(before_compact: bool, scope: &str, error: &str) -> Option<&'static str> {
    (before_compact && scope != "files" && matches!(error, "stale_target" | "target_not_found")).then_some("before_compact")
}

/// 되감기 답(미리 보기 · 끝 · 실패)의 장부 반영.
fn rewind_ended(chat: &ChatTile, st: &mut State, proc: ProcId, ev: &Ev) {
    let Ev::Rewind { phase, anchor, scope, can, .. } = ev else { return };
    st.rewinding = None;
    st.rewind_ok = (*phase == RewindPhase::Preview && *can).then(|| Previewed { anchor: anchor.clone(), scope, proc });
    if *phase != RewindPhase::Preview {
        let word = if *phase == RewindPhase::Done { "done" } else { "failed" };
        log::line(format!("chat tile {} — rewind {scope} {word} (process {proc})", chat.id));
    }
    // 대화가 바뀌었다 — 맥락 크기 · 마지막 압축은 옛 대화의 것이다
    if *phase == RewindPhase::Done && *scope != "files" {
        st.rewind_gen += 1;
        st.context = None;
        st.last_compaction = None;
    }
}

/// 잡아 둔 `done` 을 받은 번호 그대로 낸다.
fn release_held(chat: &ChatTile, st: &mut State) {
    let Some(h) = st.held.take() else { return };
    rewind_ended(chat, st, h.proc, &h.ev);
    emit(chat, st, h.proc, h.seq, &h.ev);
}

/// 기록 파일을 잠금 밖에서 살핀다 — 표지가 보이거나 [`MARK_WAIT`] 가 지나면 잡아 둔 `done` 을 놓는다. 읽기만 한다(stdin 길 없음).
fn watch_marker(id: String, hold: u64, path: PathBuf, from: u64) {
    std::thread::spawn(move || {
        let end = Instant::now() + MARK_WAIT;
        while Instant::now() < end && !crate::agent_transcript::claude_marked_since(&path, from) {
            std::thread::sleep(MARK_POLL);
        }
        let Some(chat) = lock(&TABLE).chats.get(&id).cloned() else { return };
        let mut st = lock(&chat.st);
        if st.held.as_ref().is_some_and(|h| h.hold == hold) {
            release_held(&chat, &mut st);
        }
    });
}

/// [`start_ready`] 에서만. 부르는 쪽이 채팅 잠금을 쥐고 있어 코어의 스레드들은 세대 · 프로세스 칸이 선 뒤에야 줄을 반영한다.
fn spawn(chat: &Arc<ChatTile>, st: &mut State) -> Result<(), WireError> {
    let proc = ProcId::next();
    // 띄우지 못하면 이 세대의 토큰을 곧바로 거둔다
    let revoke = |e: WireError| {
        crate::chat_token::revoke(&chat.id, proc);
        e
    };
    let l = launch::prepare(&chat.id, st, proc).map_err(revoke)?;
    let pid = chat_proc::start(chat, st, proc, l).map_err(|(w, m)| revoke(fail(w, m)))?;
    log::line(format!("chat tile {} — started {} (process {proc}, pid {pid})", chat.id, cli_name(st.cli)));
    st.conv_seen = None;
    st.sent.clear();
    // 다른 세대의 미리 보기는 쓰지 않는다
    st.rewinding = None;
    st.rewind_ok = None;
    // 새 프로세스는 아직 MCP 상태를 알리지 않았다
    st.mcp_asked = None;
    if let Some(m) = st.mcp_status.as_mut() {
        m.stale = true;
    }
    Ok(())
}

/// 프로세스가 없으면 띄우고 준비를 기다린다 — **`spawn(` 을 부르는 유일한 함수**. 부르는 곳은 `op_send` · `op_rewind`(미리 보기) · `op_review` ·
/// `op_goal`(정하기 · 이어 하기)뿐.
fn start_ready<'a>(chat: &'a Arc<ChatTile>, mut st: MutexGuard<'a, State>) -> Result<MutexGuard<'a, State>, WireError> {
    if !st.core.has_proc() {
        spawn(chat, &mut st)?;
    }
    let deadline = Instant::now() + Duration::from_millis(crate::orchestration::turn::START_MS);
    while st.core.status() == Status::Starting && st.core.has_proc() {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            st.core.kill("start-timeout");
            return Err(fail("start-timeout", "the CLI did not become ready in time"));
        }
        st = chat.cv.wait_timeout(st, left).unwrap_or_else(|e| e.into_inner()).0;
    }
    Ok(st)
}

// ---------------------------------------------------------------------------
// op
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ModeBody {
    Fresh {
        #[serde(default)]
        cwd: Option<String>,
    },
    Resume {
        conv: String,
    },
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
    /// GUI 가 웹뷰 라벨로 채운다(원격 창은 `null`) — 책임 창으로만 쓴다.
    #[serde(default)]
    window: Option<String>,
    /// 명세가 기억한 모드 — 틀린 값은 거절하지 않고 버린다(복원을 막지 않는다).
    #[serde(default)]
    perm_mode: Option<String>,
    /// 명세가 기억한 Codex 속도 등급 — 꼴이 틀리면 `[bad-tier]` · Claude 는 버린다.
    #[serde(default)]
    tier: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    chat: String,
    epoch: u64,
    text: String,
    client_id: String,
    /// 서버가 첨부 자리 안의 그림인지 다시 본다.
    #[serde(default)]
    images: Vec<String>,
    /// 서버가 첨부 자리 안의 파일인지 다시 본다 — 옮기지 않는다.
    #[serde(default)]
    files: Vec<String>,
    /// 이름만 — 경로는 어댑터가 제 목록에서 찾는다.
    #[serde(default)]
    skills: Vec<String>,
}

/// 한 번 보내기에 싣는 스킬 수.
const SKILLS_MAX: usize = 8;
/// 압축 지침 — 바이트.
const INSTRUCTIONS_MAX: usize = 4 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactBody {
    chat: String,
    epoch: u64,
    #[serde(default)]
    instructions: Option<String>,
}

/// 기준점 · 범위 낱말 · 미리 보기 여부뿐 — CLI 에 닿는 다른 칸은 없다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RewindBody {
    chat: String,
    epoch: u64,
    anchor: String,
    scope: String,
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpochBody {
    chat: String,
    epoch: u64,
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
    #[serde(default)]
    effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermModeBody {
    chat: String,
    epoch: u64,
    mode: String,
}

/// 제안 · 규칙 · 목적지 · 모드 칸은 없다 — 늘 허용이 실을 것은 어댑터가 대기 장부에서 고른다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecideBody {
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    answers: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatBody {
    chat: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubBody {
    chat: String,
    window: String,
    #[serde(default)]
    sub_gen: Option<u64>,
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    // serde 문구는 몸(사람 글)을 되풀이할 수 있다 — 싣지 않는다
    serde_json::from_value(v).map_err(|_| WireError::new(super::ipc::frame::code::BAD_BODY, "bad chat tile request body"))
}

/// 블로킹 — `serve` 가 블로킹 풀에서 부른다.
pub(crate) fn handle(op: &str, b: Value, conn: u64) -> Result<Value, WireError> {
    match op {
        "chat_tile_open" => op_open(body(b)?),
        "chat_tile_send" => op_send(body(b)?),
        "chat_tile_interrupt" => op_interrupt(body(b)?),
        "chat_tile_set_model" => op_set_model(body(b)?),
        "chat_tile_set_effort" => op_set_effort(body(b)?),
        "chat_tile_set_perm_mode" => op_set_perm_mode(body(b)?),
        "chat_tile_decide" => op_decide(body(b)?),
        "chat_tile_compact" => op_compact(body(b)?),
        "chat_tile_rewind" => op_rewind(body(b)?),
        "chat_tile_review" => op_review(body(b)?),
        "chat_tile_goal" => op_goal(body(b)?),
        "chat_tile_set_tier" => op_set_tier(body(b)?),
        "chat_tile_mcp_status" => op_mcp_status(body(b)?),
        "chat_tile_close" => {
            let c: ChatBody = body(b)?;
            id_check(&c.chat)?;
            Ok(json!(close(&c.chat)))
        }
        "chat_tile_subscribe" => op_subscribe(body(b)?, conn),
        "chat_tile_unsubscribe" => op_unsubscribe(body(b)?, conn),
        "chat_tile_attach" => {
            let c: ChatBody = body(b)?;
            let chat = find(&c.chat)?;
            let st = lock(&chat.st);
            Ok(snapshot(&chat, &st))
        }
        "chat_tile_list" => Ok(list()),
        _ => Err(WireError::new(super::ipc::frame::code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

/// 책임 창 · 구독 창 · 토큰 · 임시 경로 · 보낸 글 장부는 싣지 않는다.
fn snapshot(chat: &ChatTile, st: &State) -> Value {
    json!({
        "chat": chat.id,
        "cli": st.cli,
        "model": st.model,
        "effort": st.effort,
        "cwd": st.cwd,
        "epoch": st.core.id(),
        // 잡아 둔 `done` 은 아직 안 낸 사건이다 — 지금 붙는 창도 그것을 받게 그 앞 번호를
        "seq": st.held.as_ref().map_or(st.core.seq(), |h| h.seq - 1),
        "status": st.core.status(),
        "conversationId": st.conv_seen.as_ref().or(st.conversation.as_ref()),
        "mcpServers": st.mcp,
        "liveTurn": st.core.live_turn(),
        "pending": st.core.pending(),
        "permMode": st.perm_mode,
        "cliMode": st.cli_mode.as_ref().map(|c| json!({ "mode": c.mode, "choices": c.choices })),
        "commands": st.commands.as_ref().map(|c| json!({ "commands": c.commands, "terminal": c.terminal })),
        "context": st.context.as_ref().map(|c| json!({ "used": c.used, "window": c.window, "source": c.source })),
        "lastCompaction": st.last_compaction.as_ref().map(|c| json!({ "trigger": c.trigger, "preTokens": c.pre_tokens, "postTokens": c.post_tokens })),
        "rewind": st.rewind_caps.map(|c| json!({ "files": c.files, "conversation": c.conversation })),
        "rewindGen": st.rewind_gen,
        "mcpStatus": st.mcp_status.as_ref().map(|m| json!({
            "source": m.source, "stale": m.stale,
            "servers": mcp_rows_view(&m.servers, crate::instance::mcp_name(crate::instance::DEV), &st.mcp),
        })),
        "goal": st.goal,
        "tier": st.tier,
        "tiers": st.tiers.as_ref().map(|t| json!({ "byModel": t.by_model, "thread": t.thread })),
        "cliModel": st.cli_model,
    })
}

fn list() -> Value {
    let chats: Vec<Arc<ChatTile>> = lock(&TABLE).chats.values().cloned().collect();
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
                "subs": st.subs.len(),
                "detached": st.detached.is_some(),
            })
        })
        .collect();
    rows.sort_by(|a, b| a["chat"].as_str().cmp(&b["chat"].as_str()));
    json!(rows)
}

fn bad_cwd() -> WireError {
    fail("bad-cwd", "the tile folder is missing or not a local folder")
}

/// UNC(`\\wsl$` 포함)는 이 PC 의 폴더로 치지 않는다.
fn local_dir(p: &Path) -> bool {
    let s = p.to_string_lossy();
    p.is_absolute() && !s.starts_with(r"\\") && !s.starts_with("//") && p.is_dir()
}

fn fresh_cwd(cwd: Option<&str>) -> Result<String, WireError> {
    let p = match cwd {
        Some(s) => PathBuf::from(s),
        None => PathBuf::from(std::env::var_os("USERPROFILE").ok_or_else(bad_cwd)?),
    };
    if !local_dir(&p) {
        return Err(bad_cwd());
    }
    Ok(p.to_string_lossy().replace('\\', "/"))
}

fn conv_roots(t: &'static crate::agent_sessions::SessionTarget) -> Vec<PathBuf> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return f.conv_roots.iter().filter(|(a, _)| *a == t.id).map(|(_, p)| p.clone()).collect();
    }
    (t.roots)()
}

/// 대화 색인에서만 cwd 를 얻고, 다른 타일 · 사이드 채팅 · 다른 곳에서 열린 대화는 거절한다. 블로킹(파일) — 표 잠금 앞에서.
fn resume_cwd(cli: Cli, chat: &str, conv: &str) -> Result<String, WireError> {
    use crate::agent_sessions::{recorded_cwd_in, target, CwdMiss};
    let t = target(cli_name(cli)).map_err(|_| fail("bad-cli", "unknown chat tile CLI"))?;
    let roots = conv_roots(t);
    let cwd = match recorded_cwd_in(t, &roots, conv) {
        Ok(cwd) => PathBuf::from(cwd),
        Err(CwdMiss::NoFolder(_)) => return Err(fail(FOLDER_MISSING, "the conversation's folder no longer exists")),
        Err(CwdMiss::BadId) => return Err(fail("bad-conversation", "invalid conversation id")),
        Err(CwdMiss::NotFound) => return Err(fail("conversation-not-found", "that conversation was not found for this CLI")),
    };
    if !cwd.is_absolute() {
        return Err(fail(FOLDER_MISSING, "the conversation's folder no longer exists"));
    }
    if !local_dir(&cwd) {
        return Err(bad_cwd());
    }
    // 사이드 채팅은 장부에 link 하지 않는다 — 그 표를 직접 본다
    if super::side_chat::holds_conversation(cli, conv) {
        return Err(fail("conversation-in-side-chat", "this conversation is held by a side chat"));
    }
    // 이 채팅 자신의 link 는 판정에서 뺀다 — 서버가 다시 뜬 뒤 같은 잎이 다시 세울 때
    let mut links = crate::agent_state::conversation_links();
    for r in &mut links {
        r.streams.retain(|s| s != chat);
    }
    let now = crate::agent_sessions::edit::now_ms();
    crate::agent_sessions::edit::locate_idle(t, &roots, conv, now, &links).map_err(|msg| fail("conversation-busy", msg))?;
    Ok(cwd.to_string_lossy().replace('\\', "/"))
}

fn tile_enabled() -> bool {
    #[cfg(test)]
    if let Some(on) = *lock(&TEST_ENABLED) {
        return on;
    }
    crate::settings::chat_tile_enabled()
}

/// 열기가 세울 대화 · 폴더 — 이미 표에 있는 같은 대화면 판정을 건너뛰고 세우지 않는다(`None`).
struct Plan {
    conversation: Option<String>,
    cwd: String,
}

/// 표에 세우기만 한다(띄우지 않는다). 파일 읽기(색인 · 장부)는 표 잠금 앞에서.
fn op_open(mut b: OpenBody) -> Result<Value, WireError> {
    b.effort = super::producer::blank_none(b.effort);
    b.tier = super::producer::blank_none(b.tier);
    id_check(&b.chat)?;
    let cli = match b.cli.as_str() {
        "claude" => Cli::Claude,
        "codex" => Cli::Codex,
        _ => return Err(fail("bad-cli", "unknown chat tile CLI")),
    };
    // 빈 모델 = CLI 기본
    if !model_ok(&b.model) || b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-model", "invalid model"));
    }
    if b.tier.as_deref().is_some_and(|t| !tier_ok(t)) {
        return Err(fail("bad-tier", "invalid speed tier"));
    }
    if cli != Cli::Codex {
        b.tier = None;
    }
    let conv = match &b.mode {
        ModeBody::Resume { conv } if uuid_ok(conv) => Some(conv.to_ascii_lowercase()),
        ModeBody::Resume { .. } => return Err(fail("bad-conversation", "invalid conversation id")),
        ModeBody::Fresh { .. } => None,
    };
    // 둘째 바퀴는 표가 그 사이 바뀌어 건너뛴 판정이 필요할 때만 돈다.
    for full in [false, true] {
        let same: Option<Option<String>> = lock(&TABLE).chats.get(&b.chat).cloned().and_then(|c| {
            let st = lock(&c.st);
            (st.cli == cli).then(|| st.conversation.clone())
        });
        let skip = !full && conv.is_some() && same.as_ref().is_some_and(|c| *c == conv);
        let plan = match (&b.mode, &conv) {
            (_, Some(_)) if skip => None,
            (ModeBody::Resume { .. }, Some(c)) => Some(Plan { conversation: Some(c.clone()), cwd: resume_cwd(cli, &b.chat, c)? }),
            (ModeBody::Fresh { cwd }, _) => {
                let cwd = fresh_cwd(cwd.as_deref())?;
                if same.is_none() && !tile_enabled() {
                    return Err(fail("chat-tile-off", "the chat form for AI tiles is turned off in the settings"));
                }
                Some(Plan { conversation: None, cwd })
            }
            (ModeBody::Resume { .. }, None) => unreachable!("틀린 대화 id 는 위에서 거절했다"),
        };
        let (chat, old) = {
            let mut t = lock(&TABLE);
            let old = t.chats.get(&b.chat).cloned();
            let reuse = old.as_ref().filter(|c| lock(&c.st).cli == cli).cloned();
            let chat = match (reuse, &plan) {
                (Some(c), _) => c,
                (None, None) => continue,
                (None, Some(p)) => {
                    // 새 항목의 세대는 0 · 첫 구독 전까지 떼어 둔다(구독 없이 떠난 창의 항목을 TTL 이 거둔다)
                    let c = Arc::new(ChatTile {
                        id: b.chat.clone(),
                        st: Mutex::new(State {
                            cli,
                            model: b.model.clone(),
                            effort: b.effort.clone(),
                            cwd: p.cwd.clone(),
                            conversation: p.conversation.clone(),
                            conv_seen: None,
                            linked: None,
                            home: b.window.clone(),
                            subs: Vec::new(),
                            detached: Some(Instant::now()),
                            sent: VecDeque::new(),
                            mcp: Vec::new(),
                            perm_mode: None,
                            cli_mode: None,
                            commands: None,
                            context: None,
                            last_compaction: None,
                            rewind_caps: None,
                            rewinding: None,
                            held: None,
                            rewind_ok: None,
                            rewind_gen: 0,
                            mcp_status: None,
                            mcp_asked: None,
                            goal: None,
                            goal_ours: None,
                            tier: None,
                            tiers: None,
                            cli_model: None,
                            core: Core::new(),
                        }),
                        cv: Condvar::new(),
                    });
                    t.chats.insert(b.chat.clone(), Arc::clone(&c));
                    c
                }
            };
            let replaced = old.filter(|o| !Arc::ptr_eq(o, &chat));
            (chat, replaced)
        };
        if let Some(o) = old {
            // 다른 CLI 로 다시 세웠다 — 옛 세대의 토큰 칸은 새 항목에 아직 없다
            crate::chat_token::forget(&o.id);
            let mut ost = lock(&o.st);
            unlink(&o, &mut ost);
            ost.core.kill("closed");
        }
        let mut st = lock(&chat.st);
        if let Some(w) = b.window {
            st.home = Some(w);
        }
        // 프로세스가 없을 때만 띄울 뜻을 바꾼다 — 이어 갈 대화가 있는 항목을 새 대화로 덮지 않는다
        if !st.core.has_proc() {
            st.model = b.model;
            st.effort = b.effort;
            // `None` 은 서버가 쥔 값을 지우지 않는다 — 원격 창이 고른 값을 메인 PC 명세가 아직 모를 수 있다
            if let Some(m) = b.perm_mode.take().filter(|m| open_mode_ok(cli, m)) {
                st.perm_mode = Some(m);
            }
            if let Some(t) = b.tier.take() {
                st.tier = Some(t);
            }
            match plan {
                Some(Plan { conversation: Some(c), cwd }) => {
                    st.conversation = Some(c);
                    st.cwd = cwd;
                }
                Some(Plan { conversation: None, cwd }) if st.conversation.is_none() => st.cwd = cwd,
                _ => {}
            }
        }
        // resume 은 보내기 전부터 열림이다 — 다른 창의 목록 · 이름 바꾸기 · 지우기 판정이 보게
        relink(&chat, &mut st);
        drop(st);
        wake_reaper();
        let st = lock(&chat.st);
        return Ok(snapshot(&chat, &st));
    }
    Err(fail(SESSION_GONE, "the chat tile changed while opening — try again"))
}

/// 사람이 보낸 글 — 이 함수가 `encode_user` 를 부르는 유일한 곳이다(프로세스가 없으면 [`start_ready`] 가 띄운다).
fn op_send(b: SendBody) -> Result<Value, WireError> {
    if (b.text.trim().is_empty() && b.images.is_empty() && b.files.is_empty()) || b.text.len() > TEXT_MAX {
        return Err(fail("bad-text", "the message is empty or too long"));
    }
    if b.client_id.is_empty() || b.client_id.len() > CLIENT_ID_MAX {
        return Err(fail("bad-text", "clientId must be 1 to 64 bytes"));
    }
    if b.images.len() + b.files.len() > super::side_chat::IMAGES_MAX {
        return Err(fail("too-many-attachments", "too many attachments in one message"));
    }
    let dup = b.skills.iter().enumerate().any(|(i, s)| b.skills[..i].contains(s));
    if b.skills.len() > SKILLS_MAX || dup || !b.skills.iter().all(|s| slash_name_ok(s)) {
        return Err(fail("bad-skill", "the skill names are invalid"));
    }
    let chat = find(&b.chat)?;
    // 파일을 읽는 일이라 채팅 잠금 앞에서 — CLI 는 항목마다 고정이다. 이유 낱말은 사이드 채팅의 것 그대로
    let cli = lock(&chat.st).cli;
    let as_tile = |e: WireError| WireError::new(CHAT_TILE, e.message);
    let images = super::side_chat::chat_images(&b.images, cli == Cli::Claude).map_err(as_tile)?;
    let files = super::side_chat::files_checked(&b.files).map_err(as_tile)?;
    let st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let mut st = start_ready(&chat, st)?;
    let epoch = st.core.id();
    let Some(a) = st.core.adapter() else {
        return Err(fail("exited", "the CLI exited before it was ready"));
    };
    // 꼬리는 서버가 다시 본 경로로만 짓는다 — 사용자 저장소(cwd)에는 쓰지 않는다
    let text = super::side_chat::with_file_refs(&b.text, &files);
    if !b.skills.is_empty() {
        a.encode_tile_skills(&b.skills).map_err(|w| fail(w, "the skill was not found"))?;
    }
    let step = a.encode_user(&text, &images, Some(&b.client_id)).map_err(|w| fail(w, "the message was not sent"))?;
    let names = images
        .iter()
        .map(|im| im.path.as_str())
        .chain(files.iter().map(|f| f.path()))
        .filter_map(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    if st.sent.len() >= SENT_MAX {
        st.sent.pop_front();
    }
    st.sent.push_back(Sent { client_id: b.client_id, text: b.text, files: names });
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!({ "epoch": epoch }))
}

fn op_interrupt(b: EpochBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let goal_active = st.cli == Cli::Codex && st.goal.as_ref().is_some_and(|g| g.status == "active");
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    let step = a.encode_interrupt().ok();
    // 사람의 [중지] 는 active 목표도 멈춘다 — 끊기만으로는 목표가 남아 CLI 가 곧 다음 턴을 연다
    let pause = if goal_active { a.encode_goal(&GoalAction::Pause).ok() } else { None };
    let sent = step.is_some() || pause.is_some();
    if let Some(step) = step {
        chat_proc::apply(&*chat, &mut st, step);
    }
    if let Some(pause) = pause {
        log::line(format!("chat tile {} — goal pause with stop (process {})", chat.id, st.core.id()));
        chat_proc::apply(&*chat, &mut st, pause);
    }
    Ok(json!(sent))
}

/// 프로세스가 없으면 다음 띄우기가 쓴다.
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

/// `null` = CLI 기본.
fn op_set_effort(mut b: EffortBody) -> Result<Value, WireError> {
    b.effort = super::producer::blank_none(b.effort);
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

/// 칩 — 이 함수가 `encode_set_perm_mode` 를 부르는 유일한 곳이다. 프로세스가 없으면 다음 띄우기가 쓴다. 턴 중에도 받는다(TUI 의 Shift+Tab 처럼).
fn op_set_perm_mode(b: PermModeBody) -> Result<Value, WireError> {
    if !word_ok(&b.mode) {
        return Err(fail("bad-mode", "invalid permission mode"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !offered(st.cli, st.cli_mode.as_ref(), &b.mode) {
        return Err(fail("bad-mode", "this permission mode cannot be chosen here"));
    }
    let Some(a) = st.core.adapter() else {
        st.perm_mode = Some(b.mode);
        return Ok(json!(false));
    };
    let step = a.encode_set_perm_mode(&b.mode).map_err(|w| fail(w, "the permission mode was not changed"))?;
    st.perm_mode = Some(b.mode);
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// 결정 낱말 넷 — 그 밖의 것은 어댑터에 닿지 않는다.
enum Decided<'a> {
    Plain(Decision),
    Tile(TileAnswer<'a>),
}

/// **권한 요청의 답은 사람의 이 op 하나** — 이 함수가 `encode_decision` · `encode_tile_answer` 를 부르는 유일한 곳이다. 두 창이 같은 카드에 답하면 둘째는
/// `[unknown-request]`. 늘 허용이 실을 제안은 어댑터가 고르고, 그것이 모드 제안이면 칩을 고른 것과 같이 `perm_mode` 에 남긴다(다시 띄워도).
fn op_decide(b: DecideBody) -> Result<Value, WireError> {
    let decided = match b.decision.as_str() {
        "allow" => Decided::Plain(Decision::Allow),
        "deny" => Decided::Plain(Decision::Deny),
        "allowSession" => Decided::Tile(TileAnswer::AllowSession),
        "answer" => match &b.answers {
            Some(v @ Value::Object(_)) if serde_json::to_string(v).is_ok_and(|s| s.len() <= ANSWERS_MAX) => Decided::Tile(TileAnswer::Answers(v)),
            _ => return Err(fail("bad-answer", "the answers are missing or too large")),
        },
        _ => return Err(fail("bad-decision", "unknown decision")),
    };
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !st.core.is_pending(&b.request_id) {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    }
    let session_mode = match decided {
        Decided::Tile(TileAnswer::AllowSession) => session_mode(&st, &b.request_id),
        _ => None,
    };
    let Some(a) = st.core.adapter() else {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    };
    let step = match decided {
        Decided::Plain(decision) => a.encode_decision(&b.request_id, decision, b.message.as_deref()),
        Decided::Tile(answer) => a.encode_tile_answer(&b.request_id, answer),
    }
    .map_err(|w| fail(w, "the decision was not sent"))?;
    // 어댑터가 받아들인 뒤에만 — 거절이면 그 요청은 대기에 남는다
    if let Some(m) = session_mode {
        st.perm_mode = Some(m);
    }
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// 늘 허용이 모드 제안(`acceptEdits`)이면 그 모드 — 서버 자신의 대기 기록에서 읽는다(프런트 글자가 아니다).
fn session_mode(st: &State, request_id: &str) -> Option<String> {
    st.core.pending().into_iter().find_map(|e| match e {
        Ev::Permission { request_id: id, session_allow: Some(s), .. } if id == request_id && s.kind == "mode" => {
            offered(st.cli, st.cli_mode.as_ref(), &s.detail).then(|| s.detail.clone())
        }
        _ => None,
    })
}

/// 사람이 부른 맥락 압축 — 이 함수가 `encode_compact` 를 부르는 유일한 곳이다. **띄우지 않는다**(프로세스가 없으면 `[not-started]`).
/// 지침은 사람 글이라 남기지 않는다.
fn op_compact(b: CompactBody) -> Result<Value, WireError> {
    let instructions = super::producer::blank_none(b.instructions).filter(|s| !s.trim().is_empty());
    if instructions.as_deref().is_some_and(|s| s.len() > INSTRUCTIONS_MAX || s.chars().any(|c| c.is_control() && c != '\n' && c != '\r')) {
        return Err(fail("bad-instructions", "the compaction instructions are too long or contain control characters"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if st.cli == Cli::Codex && instructions.is_some() {
        return Err(fail("bad-instructions", "Codex compaction takes no instructions"));
    }
    if st.core.status() == Status::Running {
        return Err(fail("turn-running", "a turn is running — compact after it ends"));
    }
    if !st.core.has_proc() {
        return Err(fail("not-started", "the CLI is not running — send a message first"));
    }
    // Codex 는 빈 스레드의 압축도 받는다 — 끝난 턴이 없으면 압축할 것이 없다
    if st.cli == Cli::Codex && st.conversation.is_none() {
        return Err(fail("nothing-to-compact", "there is nothing to compact yet"));
    }
    let Some(a) = st.core.adapter() else {
        return Err(fail("not-started", "the CLI is not running — send a message first"));
    };
    let step = a.encode_compact(instructions.as_deref()).map_err(|w| fail(w, "the conversation was not compacted"))?;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// 잠금 안의 판정 — 기록을 읽는 동안 잠금을 놓으므로 다시 잡은 뒤 한 번 더 부른다.
fn rewind_checks(st: &mut State, epoch: u64, scope: &str) -> Result<(), WireError> {
    check_epoch(st, epoch)?;
    if !scope_ok(st.cli, st.rewind_caps.as_ref(), scope) {
        // Codex 파일은 터미널 모양에서도 되돌릴 길이 없다 — 다른 자리를 약속하지 않는다
        return Err(fail("unsupported", "this CLI cannot rewind that in the chat form"));
    }
    if st.conversation.is_none() {
        return Err(fail("nothing-to-rewind", "no turn has finished in this conversation yet"));
    }
    // 두 CLI 모두 턴 중 · 권한 대기 중에도 되감는다 — 이 판정이 유일한 방어다
    if st.core.status() == Status::Running || st.core.has_pending() {
        return Err(fail("turn-running", "a turn is running — rewind after it ends"));
    }
    if st.held.is_none() && st.rewinding.as_ref().is_some_and(|r| r.at.elapsed() > REWIND_WAIT) {
        st.rewinding = None;
    }
    if st.rewinding.is_some() {
        return Err(fail("rewind-running", "a rewind is already in progress"));
    }
    Ok(())
}

/// Claude 기준점은 기록 파일의 **현재 갈래의 진짜 사람 줄**이어야 한다 — 그 파일의 마지막 사람 말(`last_seen`) · 압축 경계 앞인지 · 지금 길이도
/// 같은 읽기에서. 블로킹(파일).
fn claude_last_seen(conv: &str, anchor: &str) -> Result<(crate::agent_transcript::RewindPoint, PathBuf, u64), WireError> {
    let bad = || fail("bad-anchor", "that message is not in this conversation's record");
    let t = crate::agent_sessions::target("claude").map_err(|_| bad())?;
    let path = crate::agent_sessions::conversation_file(t, &conv_roots(t), conv).map_err(|_| bad())?;
    let len = std::fs::metadata(&path).map_err(|_| bad())?.len();
    let point = crate::agent_transcript::claude_rewind_point(&path, anchor).ok_or_else(bad)?;
    Ok((point, path, len))
}

/// **사람이 부른 되감기** — 이 함수가 `encode_rewind` 를 부르는 유일한 곳이다. 미리 보기(`dryRun`)가 먼저 · 실행은 띄우지 않는다.
/// 프런트에서 오는 것은 기준점 · 범위 낱말 · 미리 보기 여부뿐이다.
fn op_rewind(b: RewindBody) -> Result<Value, WireError> {
    if !uuid_ok(&b.anchor) {
        return Err(fail("bad-anchor", "the rewind anchor is malformed"));
    }
    let Some(scope) = rewind_scope(&b.scope) else {
        return Err(fail("bad-scope", "the rewind scope must be files, conversation or both"));
    };
    let chat = find(&b.chat)?;
    let (cli, conv) = {
        let mut st = lock(&chat.st);
        rewind_checks(&mut st, b.epoch, scope)?;
        (st.cli, st.conversation.clone().unwrap_or_default())
    };
    let point = match cli {
        Cli::Claude => Some(claude_last_seen(&conv, &b.anchor)?),
        Cli::Codex => None,
    };
    let last_seen = point.as_ref().map(|(p, _, _)| p.last_seen.clone());
    let mut st = lock(&chat.st);
    rewind_checks(&mut st, b.epoch, scope)?;
    if st.conversation.as_deref() != Some(conv.as_str()) {
        return Err(fail("bad-anchor", "the conversation changed — try again"));
    }
    if !b.dry_run {
        if !st.core.has_proc() {
            return Err(fail("not-started", "the CLI is not running — preview the rewind first"));
        }
        let want = Previewed { anchor: b.anchor.clone(), scope, proc: st.core.id() };
        if st.rewind_ok.as_ref() != Some(&want) {
            return Err(fail("preview-first", "preview this rewind first"));
        }
    } else if !st.core.has_proc() {
        // 그 대화의 resume 만 — 사람 글은 없다
        st = start_ready(&chat, st)?;
    }
    let Some(a) = st.core.adapter() else {
        return Err(fail("exited", "the CLI exited before it was ready"));
    };
    let step = a.encode_rewind(&b.anchor, scope, b.dry_run, last_seen.as_deref()).map_err(|w| fail(w, "the rewind was not sent"))?;
    let before_compact = point.as_ref().is_some_and(|(p, _, _)| p.before_compact);
    let watch = point.filter(|_| !b.dry_run && scope != "files").map(|(_, path, len)| (path, len));
    st.rewinding = Some(Rewinding { at: Instant::now(), watch, before_compact });
    let what = if b.dry_run { "preview" } else { "apply" };
    log::line(format!("chat tile {} — rewind {scope} {what} (process {})", chat.id, st.core.id()));
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!({ "epoch": st.core.id() }))
}

/// 대상 꼴은 서버가 본다 — serde 오류 글을 내지 않는다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewBody {
    chat: String,
    epoch: u64,
    target: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoalBody {
    chat: String,
    epoch: u64,
    action: String,
    #[serde(default)]
    objective: Option<String>,
    #[serde(default, rename = "tokenBudget")]
    budget: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TierBody {
    chat: String,
    epoch: u64,
    #[serde(default)]
    tier: Option<String>,
}

/// 순수 · 표 앞 — 낱말 넷 · `set` 만 목표 글(다듬은 뒤 1–4000 글자 · 줄바꿈 밖 제어 문자 없음)과 고정 한도 다섯 중 하나.
fn goal_action<'a>(action: &str, objective: Option<&'a str>, budget: Option<u64>) -> Result<GoalAction<'a>, WireError> {
    let objective = objective.map(str::trim).filter(|s| !s.is_empty());
    let extra = objective.is_some() || budget.is_some();
    match action {
        "set" => {
            let o = objective.filter(|o| o.chars().count() <= OBJECTIVE_CHARS && !o.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')));
            let o = o.ok_or_else(|| fail("bad-objective", "the goal is empty or too long"))?;
            let budget = budget.filter(|n| GOAL_BUDGETS.contains(n)).ok_or_else(|| fail("bad-budget", "choose one of the token budgets"))?;
            Ok(GoalAction::Set { objective: o, budget })
        }
        "pause" | "resume" | "clear" if extra => Err(fail("bad-goal", "only a new goal takes a text and a budget")),
        "pause" => Ok(GoalAction::Pause),
        "resume" => Ok(GoalAction::Resume),
        "clear" => Ok(GoalAction::Clear),
        _ => Err(fail("bad-goal", "unknown goal action")),
    }
}

/// **사람이 고른 검토**(Codex · 같은 대화 안) — 이 함수가 `encode_review` 를 부르는 유일한 곳이다. 프로세스가 없으면 같은 대화를 띄운다(사람 글 없음).
/// **Aynx 는 git 을 부르지 않는다** — 브랜치 · 커밋이 있는지는 CLI 가 판정한다. 로그에는 대상 종류 낱말만.
fn op_review(b: ReviewBody) -> Result<Value, WireError> {
    let target = review_target(&b.target).ok_or_else(|| fail("bad-review-target", "the review target is malformed"))?;
    let chat = find(&b.chat)?;
    let st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if st.cli != Cli::Codex {
        return Err(fail("unsupported", "Claude reviews run as /code-review in a message"));
    }
    if st.core.status() == Status::Running {
        return Err(fail("turn-running", "a turn is running — review after it ends"));
    }
    let mut st = start_ready(&chat, st)?;
    let Some(a) = st.core.adapter() else {
        return Err(fail("exited", "the CLI exited before it was ready"));
    };
    let step = a.encode_review(&target).map_err(|w| fail(w, "the review was not started"))?;
    log::line(format!("chat tile {} — review {} (process {})", chat.id, target.kind(), st.core.id()));
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!({ "epoch": st.core.id() }))
}

/// **사람이 정한 목표**(Codex) — 정하기 · 멈춤 · 이어 하기 · 지우기. 이 함수와 [`op_interrupt`](멈춤)만 `encode_goal` 을 부른다 — 서버는 목표를
/// 스스로 정하거나 · 이어 하거나 · 멈추거나 · 지우지 않는다. 정하기 · 이어 하기만 띄울 수 있다. 목표 글은 사람 글이라 남기지 않는다.
fn op_goal(b: GoalBody) -> Result<Value, WireError> {
    let action = goal_action(&b.action, b.objective.as_deref(), b.budget)?;
    let starts = matches!(action, GoalAction::Set { .. } | GoalAction::Resume);
    let chat = find(&b.chat)?;
    let st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if st.cli != Cli::Codex {
        return Err(fail("unsupported", "Claude goals are set with /goal in a message"));
    }
    if starts && st.core.status() == Status::Running {
        return Err(fail("turn-running", "a turn is running — set the goal after it ends"));
    }
    match (&action, st.goal.as_ref()) {
        (GoalAction::Set { .. }, _) => {}
        (_, None) => return Err(fail("no-goal", "there is no goal")),
        (GoalAction::Resume, Some(g)) if !matches!(g.status, "paused" | "blocked" | "budgetLimited" | "usageLimited") => {
            return Err(fail("no-goal", "the goal is not paused"));
        }
        _ => {}
    }
    let mut st = if st.core.has_proc() {
        st
    } else if starts {
        start_ready(&chat, st)?
    } else {
        return Err(fail("not-started", "the CLI is not running — send a message first"));
    };
    let Some(a) = st.core.adapter() else {
        return Err(fail("exited", "the CLI exited before it was ready"));
    };
    let step = a.encode_goal(&action).map_err(|w| fail(w, "the goal was not changed"))?;
    if let GoalAction::Set { objective, budget } = &action {
        st.goal_ours = Some(objective.to_string());
        log::line(format!("chat tile {} — goal set, budget {budget} (process {})", chat.id, st.core.id()));
    } else {
        log::line(format!("chat tile {} — goal {} (process {})", chat.id, action.word(), st.core.id()));
    }
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!({ "epoch": st.core.id() }))
}

/// 다음 턴부터의 Codex 속도 등급 — 이 함수가 `encode_set_tier` 를 부르는 유일한 곳이다. stdin 없음 · 띄우지 않는다(프로세스가 없으면 다음 띄우기가 쓴다).
fn op_set_tier(mut b: TierBody) -> Result<Value, WireError> {
    b.tier = super::producer::blank_none(b.tier);
    if b.tier.as_deref().is_some_and(|t| !tier_ok(t)) {
        return Err(fail("bad-tier", "invalid speed tier"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let codex = st.cli == Cli::Codex;
    if !codex && b.tier.is_some() {
        return Err(fail("unsupported", "this CLI has no speed tiers in the chat form"));
    }
    let Some(a) = st.core.adapter() else {
        st.tier = b.tier;
        return Ok(json!(false));
    };
    if codex {
        a.encode_set_tier(b.tier.as_deref()).map_err(|w| fail(w, "that speed is not available for this model"))?;
    }
    st.tier = b.tier;
    Ok(json!(true))
}

/// **사람이 연 MCP 상태 풍선의 읽기** — 이 함수가 `encode_mcp_status` 를 부르는 유일한 곳이다. 띄우지 않는다 · 턴 중에도 받는다(대화를 바꾸지 않는 읽기).
/// 답은 사건 `mcpStatus{list}` 로 온다. 로그 없음.
fn op_mcp_status(b: EpochBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !st.core.has_proc() {
        return Ok(json!(false));
    }
    if st.mcp_asked.is_some_and(|at| at.elapsed() < MCP_WAIT) {
        return Err(fail("mcp-status-busy", "the MCP status is still being read"));
    }
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    let step = match a.encode_mcp_status() {
        Ok(step) => step,
        Err("unsupported") => return Ok(json!(false)),
        Err(w) => return Err(fail(w, "the MCP status was not read")),
    };
    st.mcp_asked = Some(Instant::now());
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// 같은 `(연결, 창)` 의 옛 구독은 갈음한다. 이미 끊긴 연결이면 덧붙이지 않고 스냅숏만.
fn op_subscribe(b: SubBody, conn: u64) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let (gen, alive) = {
        let mut t = lock(&TABLE);
        t.next_sub += 1;
        (t.next_sub, t.conns.contains(&conn))
    };
    let mut st = lock(&chat.st);
    if alive {
        st.subs.retain(|s| !(s.conn == conn && s.window == b.window));
        st.subs.push(Sub { conn, window: b.window, gen });
        st.detached = None;
    } else if st.subs.is_empty() && st.detached.is_none() {
        st.detached = Some(Instant::now());
    }
    // 모은 조각을 먼저 낸다 — 스냅숏 뒤 사건이 이어지게
    chat_proc::flush(&*chat, &mut st);
    let snap = snapshot(&chat, &st);
    drop(st);
    if !alive {
        wake_reaper();
    }
    Ok(json!({ "subGen": gen, "snapshot": snap }))
}

fn op_unsubscribe(b: SubBody, conn: u64) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    let before = st.subs.len();
    st.subs.retain(|s| !(s.conn == conn && s.window == b.window && Some(s.gen) == b.sub_gen));
    let removed = st.subs.len() != before;
    if removed && st.subs.is_empty() && st.detached.is_none() {
        st.detached = Some(Instant::now());
    }
    drop(st);
    if removed {
        wake_reaper();
    }
    Ok(json!(removed))
}

/// 멱등 — 순서 고정: **토큰 먼저** → 장부 → 프로세스.
fn close(id: &str) -> bool {
    let Some(chat) = lock(&TABLE).chats.remove(id) else { return false };
    crate::chat_token::forget(id);
    let mut st = lock(&chat.st);
    unlink(&chat, &mut st);
    st.core.kill("closed");
    true
}

// ---------------------------------------------------------------------------
// 수명 — 구독 · 창 · TTL · 모두 닫기
// ---------------------------------------------------------------------------

pub(crate) fn conn_opened(conn: u64) {
    lock(&TABLE).conns.insert(conn);
}

pub(crate) fn conn_gone(conn: u64) -> usize {
    lock(&TABLE).conns.remove(&conn);
    drop_subs(|s| s.conn == conn)
}

/// 리로드 · 떠나기 — `gens` 의 **그 세대만** 지운다(같은 라벨의 새 페이지가 건 구독은 남는다). 닫지 않는다.
pub(crate) fn detach_window(window: &str, gens: &[u64]) -> usize {
    drop_subs(|s| s.window == window && gens.contains(&s.gen))
}

/// 남은 구독이 없으면 그 순간부터 떼어 둔다(TTL).
fn drop_subs(pick: impl Fn(&Sub) -> bool) -> usize {
    let chats: Vec<Arc<ChatTile>> = lock(&TABLE).chats.values().cloned().collect();
    let now = Instant::now();
    let mut n = 0;
    for c in chats {
        let mut st = lock(&c.st);
        let before = st.subs.len();
        st.subs.retain(|s| !pick(s));
        if st.subs.len() == before {
            continue;
        }
        n += before - st.subs.len();
        if st.subs.is_empty() && st.detached.is_none() {
            st.detached = Some(now);
        }
    }
    if n > 0 {
        wake_reaper();
    }
    n
}

/// 보조 창 파괴 — 구독을 떼고, 그 창이 책임 창이고 이관 중(`held`)이 아닌 항목을 닫는다. 닫은 수.
pub(crate) fn close_window(window: &str, gens: &[u64], held: &HashSet<String>) -> usize {
    detach_window(window, gens);
    let chats: Vec<Arc<ChatTile>> = lock(&TABLE).chats.values().cloned().collect();
    let doomed: Vec<String> = chats
        .iter()
        .filter(|c| !held.contains(&c.id) && lock(&c.st).home.as_deref() == Some(window))
        .map(|c| c.id.clone())
        .collect();
    doomed.iter().filter(|id| close(id)).count()
}

/// 창 이관 — 받은 창이 책임 창이 된다.
pub(crate) fn set_home(ids: &[String], window: &str) {
    let chats: Vec<Arc<ChatTile>> = {
        let t = lock(&TABLE);
        ids.iter().filter_map(|id| t.chats.get(id).cloned()).collect()
    };
    for c in chats {
        lock(&c.st).home = Some(window.to_string());
    }
}

pub(crate) fn close_all() -> usize {
    let chats: Vec<Arc<ChatTile>> = lock(&TABLE).chats.drain().map(|(_, c)| c).collect();
    for c in &chats {
        crate::chat_token::forget(&c.id);
        let mut st = lock(&c.st);
        unlink(c, &mut st);
        st.core.kill("closed");
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
    wake_reaper();
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
    let gone: Vec<Arc<ChatTile>> = doomed.iter().filter_map(|id| t.chats.remove(id)).collect();
    drop(t);
    for c in &gone {
        crate::chat_token::forget(&c.id);
        let mut st = lock(&c.st);
        unlink(c, &mut st);
        st.core.kill("closed");
    }
    (gone.len(), next)
}

static REAPER: LazyLock<(Mutex<bool>, Condvar)> = LazyLock::new(|| (Mutex::new(false), Condvar::new()));

/// 시계 스레드 하나 — 깨우면 곧바로, 아니면 가장 이른 시한에 다시 본다.
fn wake_reaper() {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        std::thread::spawn(|| loop {
            let (gone, next) = expire(Instant::now());
            if gone > 0 {
                log::line(format!("chat tile: closed {gone} detached tile(s) after the {} s grace", ttl().as_secs()));
            }
            let (m, cv) = &*REAPER;
            let mut woke = lock(m);
            if !*woke {
                let wait = next.map_or(Duration::from_secs(3600), |n| n.saturating_duration_since(Instant::now()));
                woke = cv.wait_timeout(woke, wait).unwrap_or_else(|e| e.into_inner()).0;
            }
            *woke = false;
        });
    });
    let (m, cv) = &*REAPER;
    *lock(m) = true;
    cv.notify_all();
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
    /// `None` = Aynx MCP 없음(토큰을 뽑지 않는다).
    pub mcp_port: Option<u16>,
    /// `(에이전트 id, 루트)`
    pub conv_roots: Vec<(&'static str, PathBuf)>,
    /// 저장된 설정 대신 쓰는 외부 MCP 목록.
    pub servers: Vec<crate::agent_mcp::McpServer>,
}

#[cfg(test)]
static FAKE: Mutex<Option<FakeCli>> = Mutex::new(None);
#[cfg(test)]
static TEST_ENABLED: Mutex<Option<bool>> = Mutex::new(None);
/// 가짜로 바꾸기 전의 실행 인자.
#[cfg(test)]
static TEST_ARGV: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[cfg(test)]
pub(crate) fn set_fake_for_test(f: Option<FakeCli>) {
    *lock(&FAKE) = f;
}

#[cfg(test)]
pub(crate) fn set_enabled_for_test(on: Option<bool>) {
    *lock(&TEST_ENABLED) = on;
}

#[cfg(test)]
fn note_argv_for_test(a: &[String]) {
    *lock(&TEST_ARGV) = a.to_vec();
}

#[cfg(test)]
pub(crate) fn argv_for_test() -> Vec<String> {
    lock(&TEST_ARGV).clone()
}
