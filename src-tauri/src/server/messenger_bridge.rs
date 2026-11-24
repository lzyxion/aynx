//! **메신저 다리 — 세션 서버 쪽.** 폰의 메신저에서 로컬 AI 타일(Claude Code · Codex)에 글을 보내고, 그 턴이 끝나면 답을 같은 대화방으로 받는다.
//! 이 파일은 **채널 중립 코어**다 — 순수 판정은 [`logic`], 채널의 받기 · 보내기 · 서식은 전송([`tg`] · [`dc`] · [`sl`] · 공용 [`sock`]).
//! 코어와 전송 사이는 이 파일의 "전송" 절 `match` 한 곳씩뿐이다(trait 로 벌리지 않는다 — `messenger.rs` 와 같은 관례).
//!
//! ## 채널
//!
//! - **채널마다 계정 하나**와 자기 상태(토큰 · 짝 · 고리 · 고르기 · 다리 턴 · 돌봄 · 카드)를 갖는다. 다리 턴의 답은 그 글이 온 채널로만 ·
//!   카드 누름은 먼저 온 것이 이긴다(`resolve_from_bridge` 는 두 번째부터 "이미").
//! - Discord · Slack 은 **DM 만**이고 멘션은 늘 막는다.
//! - 코어는 채널 서식을 짓지 않는다 — 보내는 글은 중립 [`Text`]. 마크다운으로 읽는 것은 다리 턴의 답 전문([`Text::Markdown`])뿐이고,
//!   우리 문구 · 이름표 · 사용자 글자는 글자 그대로다. 어느 쪽이든 링크 · 멘션은 만들지 않는다.
//!
//! ## 불변식
//!
//! - **봇 토큰을 읽는 것은 세션 서버뿐이다** — 채널의 봇 토큰 파일은 이 파일만 읽고 쓴다(시험 `gui_never_reads_the_token_file`).
//!   토큰 · 받은 글 · 대화 글자는 로그 · `Debug` · 오류 문구 · 서버 사건 · op 답에 없다 — 로그에는 고정 글자 · 수만, `reqwest` 오류는
//!   아예 문구로 만들지 않는다(종류만 — 전송의 `err_kind`). → docs/invariants.md 전문 6
//! - **받는 글**: 1:1 대화방 · 짝지은 사용자 id 와 대화방 id 가 둘 다 맞는 것만(`logic::classify`). 그 밖은 조용히 버린다. 짝이 없을 때만 짝짓기 —
//!   6자리 코드 · 대기 하나 · 10분 · 계정당 30초에 한 번 답. [허용]은 Tauri 명령 `messenger_bot_pair`(HOME_ONLY)뿐이다.
//! - **지난 글은 실행하지 않는다**: 보낸 지 120초가 넘은 글은 넣지 않고 "보내지 않았습니다" 한 통.
//! - **넣기 문지기**(`logic::gate` — 전부 참이어야): 그 채널의 다리가 켜짐(글마다 다시 읽는다) · 살아 있는 **로컬** 세션 · `agent_state`
//!   항목이 있고(**없으면 무조건 거절** — CLI 가 끝난 셸에 글이 가면 셸 명령이 된다) CLI 가 claude · codex · 턴이 한 번 이상 끝났고 지금
//!   입력을 기다림(메인 멈춤 · 서브 에이전트 0) · 권한 카드 · 질문이 없음 · 서버 해석기의 괄호 붙여넣기 모드가 켜짐 · 입력 줄에 치다 만 글이
//!   없음. 원격(SSH) 타일은 거절한다.
//! - **서버 안에서 PTY 에 쓰는 길은 둘뿐이다** — 세션 op `write` 와 이 파일의 [`RealEnv::write_pty`] 하나(시험 `pty_writes_have_two_sites`
//!   — 전송 파일에는 없다). 쓰는 바이트는 늘 `ESC[200~` + 걷은 글 + `ESC[201~` 와 잠깐 뒤의 `\r` 둘뿐이다(그 사이 세션이 바뀌면 Enter 를
//!   버린다). AI 문자열이 이 길에 오르는 일은 없다 — 글은 짝지은 사람의 메신저 글뿐이다.
//! - **다리에는 작업안 승인 · AI 권한 · 위임 · 앨범 · 볼트로 가는 길이 없다** — 승인 등급 프레임을 만들지 않는다(시험 `bridge_has_no_approval_path`).
//! - **타일 권한 카드에는 단추로 답한다** — 다리는 그 표의 **보는 쪽 하나**이고, **돌보는 스트림**(다리 턴 ∪ 단추 달린 권한 알림을 보낸
//!   스트림 — 턴이 끝나면 걷는다) 동안만 "보는 창" 에 다리 표지가 붙는다([`tends`] — 늘 보는 쪽이면 Codex 의 면 규칙이 깨진다).
//!   누름은 짝지은 계정 → 다리가 보낸 카드 → 그 채널의 다리가 **지금** 켜짐을 거쳐 `resolve_from_bridge`(Allow · Deny 둘뿐 — 세션 허용 ·
//!   사유 · 질문의 답 없음)로 간다. 결정은 **훅 응답으로만** 간다 — PTY 에 쓰지 않고 작업안 승인으로 가는 길도 아니다
//!   (시험 `bridge_answers_cards_through_one_function`). 질문 카드는 "앱에서 답하세요" 한 통뿐이다.
//! - **잠금 순서**: 다리 잠금을 쥔 채 카드 표 · 세션 코어 · 상태 표를 부르지 않는다(값을 꺼내 놓고 부른다). 카드 표 잠금 안에서 다리를
//!   부르지 않는다. 전송은 다리 잠금을 쥔 채 기다리지 않는다.
//! - 다리 이름표를 적는 길은 op `messenger_bot_label` 하나다 — 알림(`notify`)의 이름은 적지 않는다.
//! - **방어 기계는 최소** — 받기 실패는 고정 물러남 하나뿐이다(채널별 예외는 `dc` · `sl` 머리말). 재시도 큐 · 놓친 글 재생 · 속도 제한기는 없다.
//! - 신호를 받는 HTTP 스레드는 붙들지 않는다 — [`on_signal`] 은 잠금 · 비교뿐이고 보내기는 런타임 태스크로 넘긴다.

mod dc;
pub(crate) mod logic;
mod sl;
mod sock;
mod tg;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::hub;
use super::ipc::WireError;
use super::log;
use crate::i18n::tr;
use crate::messenger::Channel;
use crate::session_core::Kind;
use crate::settings::MessengerPrefs;
use logic::{Button, Cards, Clean, Held, PairStep, Pairing, Paired, Press, PressResult, Refusal, Route, Sender, SentMap, Tending, TileView, Turns};

/// 몸은 바뀐 것 한 낱말뿐(토큰 · 코드 · 이름 없음) — 그래서 `client::RELAYED` 로 창에 방송해도 된다.
pub(crate) const EVENT: &str = "messenger-bot-event";
pub(crate) const MESSENGER_BOT: &str = "messenger-bot";
/// 짝 파일 — 비밀은 아니지만 토큰과 같은 제외 규칙(다른 PC 로 옮기면 다시 짝짓는다). 파일 이름은 그대로 둔다.
pub(crate) const CHAT_FILE: &str = "telegram-chat";
pub(crate) const DISCORD_CHAT_FILE: &str = "discord-chat";
pub(crate) const SLACK_CHAT_FILE: &str = "slack-chat";
/// 씨앗 · 설정 옮기기 제외 시험이 센다.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const CHAT_FILES: &[&str] = &[CHAT_FILE, DISCORD_CHAT_FILE, SLACK_CHAT_FILE];

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const BACKOFF: Duration = Duration::from_secs(5);
const CONFLICT_BACKOFF: Duration = Duration::from_secs(30);
/// 프런트 `SUBMIT_ENTER_DELAY_MS` 와 같다(Codex 가 글 바로 뒤의 Enter 를 줄바꿈으로 받는다 — `term/submit-text.ts`).
const ENTER_DELAY: Duration = Duration::from_millis(200);
/// 이 안에 카드가 서면 카드의 단추 통이 그 신호 물음의 한 통이다(한 물음에 한 통).
const ASK_GRACE: Duration = Duration::from_millis(1500);
/// `stop` 신호가 CLI 의 마지막 글 줄 쓰기보다 먼저 닿기도 한다 — [`settled_answer`] 의 다시 읽기 간격 · 시한.
const ANSWER_POLL: Duration = Duration::from_millis(300);
const ANSWER_DEADLINE: Duration = Duration::from_secs(4);
const ANSWER_WAIT: Duration = Duration::from_secs(20);

// ---------------------------------------------------------------------------
// 바깥 — 시험이 갈아 끼우는 칸
// ---------------------------------------------------------------------------

/// 제품은 [`RealEnv`] — 시험은 가짜를 꽂는다.
pub(crate) trait Env: Send + Sync {
    /// 블로킹.
    fn prefs(&self) -> MessengerPrefs;
    fn streams(&self) -> Vec<String>;
    fn tile(&self, stream: &str) -> TileView;
    /// (손잡이, 세션 회차).
    fn local(&self, stream: &str) -> Option<(u32, u64)>;
    /// **블로킹.** 제품의 몸은 [`RealEnv::write_pty`] 하나(머리말).
    fn write_pty(&self, id: u32, bytes: &[u8]) -> Result<(), ()>;
    /// 블로킹. 대화 파일 크기는 "파일이 다 쓰였나" 를 보는 재료다.
    fn answer(&self, cli: &str, convo: Option<&str>) -> (Option<String>, Option<u64>);
    /// 블로킹.
    fn fallback_label(&self, stream: &str) -> String;
    /// 블로킹. 고르기 단추와 다리 글의 타일 이름([`named_of`])에 붙인다.
    fn title(&self, stream: &str) -> Option<String>;
}

pub(crate) struct Config {
    pub telegram: tg::Conf,
    pub discord: dc::Conf,
    pub slack: sl::Conf,
    /// 비밀 파일 폴더 — `None` 이면 `instance::config_root()`.
    pub dir: Option<PathBuf>,
    pub env: Arc<dyn Env>,
    pub backoff: Duration,
    pub conflict_backoff: Duration,
    pub enter_delay: Duration,
    pub ask_grace: Duration,
    pub answer_poll: Duration,
    pub answer_deadline: Duration,
    pub answer_wait: Duration,
}

impl Config {
    pub(crate) fn release() -> Config {
        Config {
            telegram: tg::Conf::release(),
            discord: dc::Conf::release(),
            slack: sl::Conf::release(),
            dir: None,
            env: Arc::new(RealEnv),
            backoff: BACKOFF,
            conflict_backoff: CONFLICT_BACKOFF,
            enter_delay: ENTER_DELAY,
            ask_grace: ASK_GRACE,
            answer_poll: ANSWER_POLL,
            answer_deadline: ANSWER_DEADLINE,
            answer_wait: ANSWER_WAIT,
        }
    }
}

pub(crate) struct RealEnv;

impl Env for RealEnv {
    fn prefs(&self) -> MessengerPrefs {
        crate::settings::messenger_prefs()
    }

    fn streams(&self) -> Vec<String> {
        let mut v: Vec<String> = crate::agent_state::snapshot().into_iter().map(|(s, _)| s).collect();
        v.sort();
        v
    }

    fn tile(&self, stream: &str) -> TileView {
        // 잠금은 하나씩 잡고 곧바로 놓는다 — 겹쳐 쥐지 않는다.
        let kind = crate::session_core::core().live_resource(stream).map(|(k, _, _)| k);
        let agent = crate::agent_state::get(stream).map(|a| logic::AgentView {
            cli: a.cli,
            state: a.state,
            main_stopped: a.main_stopped,
            subagents: a.subagents.len(),
            stopped_once: a.signal_stop_at.is_some(),
        });
        let asking = super::tile_permission::asking(stream);
        let view = crate::screen_mirror::input_view(stream);
        let cli = agent.as_ref().and_then(|a| a.cli);
        TileView {
            kind,
            asking,
            bracketed: view.as_ref().map(|v| v.bracketed),
            leftover: match (view, cli) {
                (Some(v), Some(cli)) => logic::input_leftover(cli, &v.rows),
                _ => None,
            },
            agent,
        }
    }

    fn local(&self, stream: &str) -> Option<(u32, u64)> {
        match crate::session_core::core().live_resource(stream)? {
            (Kind::Local, id, epoch) => Some((id, epoch)),
            (Kind::Ssh, _, _) => None,
        }
    }

    /// **서버 안에서 PTY 에 쓰는 두 길 중 하나**(다른 하나는 세션 op `write`) — 부르는 곳은 [`inject`] 하나다.
    fn write_pty(&self, id: u32, bytes: &[u8]) -> Result<(), ()> {
        crate::pty::write_blocking(id, bytes).map_err(|_| ())
    }

    fn answer(&self, cli: &str, convo: Option<&str>) -> (Option<String>, Option<u64>) {
        let Some(path) = (|| {
            let t = crate::agent_sessions::target(cli).ok()?;
            let roots = (t.roots)();
            Some((t, crate::agent_sessions::conversation_file(t, &roots, convo?).ok()?))
        })() else {
            return (None, None);
        };
        let (t, path) = path;
        // 크기를 먼저 — 읽는 사이 자라면 다음 읽기의 크기가 달라 한 번 더 읽는다
        let size = std::fs::metadata(&path).ok().map(|m| m.len());
        (crate::agent_transcript::turn_tail(&path, t.transcript).text, size)
    }

    fn title(&self, stream: &str) -> Option<String> {
        let a = crate::agent_state::get(stream)?;
        let t = crate::agent_sessions::target(a.cli?).ok()?;
        let roots = (t.roots)();
        let path = crate::agent_sessions::conversation_file(t, &roots, a.agent_run_id.as_deref()?).ok()?;
        logic::clean_title(&crate::agent_sessions::conversation_title_at(t, &roots, &path)?)
    }

    fn fallback_label(&self, stream: &str) -> String {
        let Some(a) = crate::agent_state::get(stream) else {
            return stream.to_string();
        };
        let cli = a.cli.unwrap_or("AI");
        let target = crate::agent_sessions::target(cli).ok();
        let cwd = a.agent_run_id.as_deref().and_then(|id| {
            let t = target?;
            let roots = (t.roots)();
            crate::agent_sessions::recorded_cwd_in(t, &roots, id).ok()
        });
        // 프런트 이름표와 같은 꼴(앱의 CLI 표시 이름)
        logic::fallback_label(target.map_or(cli, |t| t.display), cwd.as_deref())
    }
}

// ---------------------------------------------------------------------------
// 전송 — 채널마다 갈리는 것은 여기 `match` 한 곳씩(새 전송이 채울 칸을 컴파일러가 센다)
// ---------------------------------------------------------------------------

/// op 는 그 밖의 채널을 `[unsupported]` 로 거절한다.
const CHANNELS: &[Channel] = &[Channel::Telegram, Channel::Discord, Channel::Slack];

fn has_transport(chan: Channel) -> bool {
    CHANNELS.contains(&chan)
}

/// `Debug` 는 가린 글자 · `Display` 없음.
#[derive(Clone, PartialEq, Eq)]
enum Token {
    Telegram(tg::BotToken),
    Discord(dc::BotToken),
    /// 봇 토큰 + 앱 수준 토큰(파일 몸은 두 줄)
    Slack(sl::BotToken),
}

impl Token {
    fn as_file(&self) -> &str {
        match self {
            Token::Telegram(t) => t.as_str(),
            Token::Discord(t) => t.as_str(),
            Token::Slack(t) => t.as_str(),
        }
    }

    fn telegram(&self) -> Option<&tg::BotToken> {
        match self {
            Token::Telegram(t) => Some(t),
            Token::Discord(_) | Token::Slack(_) => None,
        }
    }

    fn discord(&self) -> Option<&dc::BotToken> {
        match self {
            Token::Discord(t) => Some(t),
            Token::Telegram(_) | Token::Slack(_) => None,
        }
    }

    fn slack(&self) -> Option<&sl::BotToken> {
        match self {
            Token::Slack(t) => Some(t),
            Token::Telegram(_) | Token::Discord(_) => None,
        }
    }
}

/// 누름을 받았다고 채널에 알릴 손잡이(Discord 는 그 누름의 콜백 토큰) — 로그에 싣지 않는다.
pub(crate) enum Ack {
    Telegram(String),
    Discord(dc::Ack),
    Slack(sl::Ack),
}

/// **`Debug` 없음**(본문).
pub(crate) struct Incoming {
    pub message_id: i64,
    pub from_id: Option<i64>,
    /// 짝짓기 확인 화면에만
    pub from_name: String,
    pub chat_id: i64,
    pub private: bool,
    /// 유닉스 초
    pub date: i64,
    pub text: Option<String>,
    pub reply_to: Option<i64>,
}

/// **`Debug` 없음**.
pub(crate) struct ButtonPress {
    pub from_id: i64,
    pub chat_id: Option<i64>,
    pub message_id: Option<i64>,
    pub data: Option<String>,
    pub ack: Ack,
}

/// 채널 서식은 전송이 짓는다.
pub(crate) enum Text {
    /// 나누기 · 상한은 코어가 맞췄다. 몸은 글자 그대로(서식으로 읽지 않는다).
    Lines { head: Option<String>, body: String },
    /// AI 답 전문의 한 조각 — 몸은 마크다운 원문이고 전송이 `messenger::md` 로 그 채널의 서식을 입힌다. 나누기 · 상한 · 울타리 잇기는 코어가 맞췄다.
    Markdown { head: Option<String>, body: String },
    /// 그 채널로 **이미 그린** 글(`messenger.rs`) — 전송이 상한 안으로 자른다.
    Rendered { text: String, tail: Option<String> },
}

impl Text {
    pub(crate) fn plain(body: impl Into<String>) -> Text {
        Text::Lines { head: None, body: body.into() }
    }

    pub(crate) fn headed(head: impl Into<String>, body: impl Into<String>) -> Text {
        Text::Lines { head: Some(head.into()), body: body.into() }
    }
}

fn chat_file(chan: Channel) -> Option<&'static str> {
    match chan {
        Channel::Telegram => Some(CHAT_FILE),
        Channel::Discord => Some(DISCORD_CHAT_FILE),
        Channel::Slack => Some(SLACK_CHAT_FILE),
    }
}

/// 모양만 본다.
fn parse_token(chan: Channel, raw: &str) -> Option<Token> {
    match chan {
        Channel::Telegram => tg::parse_token(raw).map(Token::Telegram),
        Channel::Discord => dc::parse_token(raw).map(Token::Discord),
        Channel::Slack => sl::parse_token(raw).map(Token::Slack),
    }
}

/// 글마다 · 누름마다 다시 읽는다.
fn chat_enabled(chan: Channel, p: &MessengerPrefs) -> bool {
    match chan {
        Channel::Telegram => p.telegram_chat == Some(true),
        Channel::Discord => p.discord_chat == Some(true),
        Channel::Slack => p.slack_chat == Some(true),
    }
}

fn data_max(chan: Channel) -> usize {
    match chan {
        Channel::Telegram => tg::DATA_MAX,
        Channel::Discord => dc::DATA_MAX,
        Channel::Slack => sl::DATA_MAX,
    }
}

fn split_answer(chan: Channel, head: &str, body: &str, more: &str) -> Vec<String> {
    match chan {
        Channel::Telegram => tg::split_answer(head, body, more),
        Channel::Discord => dc::split_answer(head, body, more),
        Channel::Slack => sl::split_answer(head, body, more),
    }
}

/// 세대 `gen` 이 바뀌면 고리가 스스로 끝난다.
fn spawn_loop(chan: Channel, rt: &tokio::runtime::Handle, gen: u64) -> Option<tokio::task::JoinHandle<()>> {
    match chan {
        Channel::Telegram => Some(rt.spawn(tg::poll_loop(gen))),
        Channel::Discord => Some(rt.spawn(dc::gateway_loop(gen))),
        Channel::Slack => Some(rt.spawn(sl::socket_loop(gen))),
    }
}

/// 실패면 `None` — 전송이 로그 한 줄(본문 없음).
async fn transport_send(chan: Channel, chat: i64, t: &Text, reply_to: Option<i64>, buttons: &[Button]) -> Option<i64> {
    match chan {
        Channel::Telegram => tg::send(chat, t, reply_to, buttons).await,
        Channel::Discord => dc::send(chat, t, reply_to, buttons).await,
        Channel::Slack => sl::send(chat, t, reply_to, buttons).await,
    }
}

/// 단추는 걷힌다.
async fn edit(chan: Channel, chat: i64, message_id: i64, t: &Text) {
    match chan {
        Channel::Telegram => tg::edit(chat, message_id, t).await,
        Channel::Discord => dc::edit(chat, message_id, t).await,
        Channel::Slack => sl::edit(chat, message_id, t).await,
    }
}

/// `toast` 는 누른 사람에게만 보이는 짧은 글 · `rewritten` 은 곧이어 그 통을 결과 글로 바꿔 쓰는가.
async fn finish_press(p: &ButtonPress, toast: Option<&str>, rewritten: bool) {
    match &p.ack {
        Ack::Telegram(id) => tg::finish_press(id, toast).await,
        Ack::Discord(a) => dc::finish_press(a, toast, rewritten).await,
        Ack::Slack(a) => sl::finish_press(a, toast, rewritten).await,
    }
}

/// 다리 턴의 글을 달 자리 — **Slack 만** 쓴다(Slack DM 에는 답장이 없어 스레드가 그 자리다).
fn turn_anchor(chan: Channel, source: Option<i64>) -> Option<i64> {
    match chan {
        Channel::Slack => source,
        Channel::Telegram | Channel::Discord => None,
    }
}

/// 실패는 이유 코드가 붙은 문구(토큰 없음).
async fn check_token(client: &reqwest::Client, cfg: &Config, token: &Token) -> Result<Option<String>, String> {
    match token {
        Token::Telegram(t) => tg::check_token(client, cfg, t).await,
        Token::Discord(t) => dc::check_token(client, cfg, t).await,
        Token::Slack(t) => sl::check_token(client, cfg, t).await,
    }
}

/// 실패는 이름 없음.
async fn bot_name(client: &reqwest::Client, cfg: &Config, token: &Token) -> Option<String> {
    match token {
        Token::Telegram(t) => tg::check_token(client, cfg, t).await.ok().flatten(),
        Token::Discord(t) => dc::check_token(client, cfg, t).await.ok().flatten(),
        Token::Slack(t) => sl::bot_name(client, cfg, t).await,
    }
}

/// 코어의 [`Chan::forget_chat`] 과 같은 때, 다리 잠금 밖에서 부른다.
fn forget_transport(chan: Channel) {
    match chan {
        Channel::Slack => sl::forget(),
        Channel::Telegram | Channel::Discord => {}
    }
}

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum Link {
    #[default]
    Off,
    Ok,
    Conflict,
    Error,
}

impl Link {
    fn as_str(self) -> &'static str {
        match self {
            Link::Off => "off",
            Link::Ok => "ok",
            Link::Conflict => "conflict",
            Link::Error => "error",
        }
    }
}

#[derive(Default)]
struct Chan {
    /// 다시 시작하면 올라가고, 옛 고리는 다음 바퀴에서 스스로 끝난다.
    gen: u64,
    task: Option<tokio::task::JoinHandle<()>>,
    token: Option<Token>,
    paired: Option<Paired>,
    bot: Option<String>,
    link: Link,
    pairing: Pairing,
    sent: SentMap,
    held: Option<Held>,
    held_seq: u64,
    turns: Turns,
    tending: Tending,
    cards: Cards,
}

impl Chan {
    fn forget_chat(&mut self) {
        self.sent.clear();
        self.held = None;
        self.turns.clear();
        self.tending.clear();
        self.cards.clear();
    }
}

struct State {
    cfg: Option<Arc<Config>>,
    rt: Option<tokio::runtime::Handle>,
    client: Option<reqwest::Client>,
    /// 채널과 상관없다
    labels: HashMap<String, String>,
    chans: HashMap<Channel, Chan>,
}

impl State {
    fn chan(&mut self, chan: Channel) -> &mut Chan {
        self.chans.entry(chan).or_default()
    }
}

static STATE: LazyLock<Mutex<State>> =
    LazyLock::new(|| Mutex::new(State { cfg: None, rt: None, client: None, labels: HashMap::new(), chans: HashMap::new() }));

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    crate::agent_signal::now_ms()
}

/// 사건 몸은 중계해도 되는 고정 글자뿐이다.
fn emit(changed: &str, chan: Channel) {
    hub::emit(EVENT, json!({ "changed": changed, "channel": chan }));
}

fn secret_dir(cfg: &Config) -> Option<PathBuf> {
    cfg.dir.clone().or_else(crate::instance::config_root)
}

fn token_path(cfg: &Config, chan: Channel) -> Option<PathBuf> {
    if !has_transport(chan) {
        return None;
    }
    Some(secret_dir(cfg)?.join(chan.bot_file()?))
}

fn chat_path(cfg: &Config, chan: Channel) -> Option<PathBuf> {
    Some(secret_dir(cfg)?.join(chat_file(chan)?))
}

/// **이 모듈만 부른다**(머리말).
fn load_token(cfg: &Config, chan: Channel) -> Option<Token> {
    parse_token(chan, &std::fs::read_to_string(token_path(cfg, chan)?).ok()?)
}

fn load_paired(cfg: &Config, chan: Channel) -> Option<Paired> {
    serde_json::from_str(&std::fs::read_to_string(chat_path(cfg, chan)?).ok()?).ok()
}

fn write_or_remove(path: Option<PathBuf>, body: Option<&str>) -> bool {
    let Some(path) = path else { return false };
    match body {
        Some(b) => {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&path, b).is_ok()
        }
        None => match std::fs::remove_file(&path) {
            Err(e) => e.kind() == std::io::ErrorKind::NotFound,
            Ok(()) => true,
        },
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    tokio::task::spawn_blocking(f).await.ok()
}

// ---------------------------------------------------------------------------
// 시작 · 고리
// ---------------------------------------------------------------------------

/// 서버가 뜰 때 런타임 안에서 한 번 부른다 — 런타임 손잡이를 여기서 쥔다.
pub(crate) fn start(cfg: Config) {
    let loaded: Vec<(Channel, Option<Token>, Option<Paired>)> = CHANNELS.iter().map(|&c| (c, load_token(&cfg, c), load_paired(&cfg, c))).collect();
    let client = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build().ok();
    {
        let mut s = state();
        s.rt = tokio::runtime::Handle::try_current().ok();
        s.cfg = Some(Arc::new(cfg));
        s.client = client;
        s.labels.clear();
        for (chan, token, paired) in loaded {
            let c = s.chan(chan);
            c.token = token;
            c.paired = paired;
            c.bot = None;
            c.pairing.clear();
            c.forget_chat();
        }
    }
    for &chan in CHANNELS {
        forget_transport(chan);
        restart(chan);
        learn_bot_name(chan);
    }
}

/// 봇 이름은 파일에 두지 않는다 — 서버가 뜰 때 한 번 묻는다. 실패하면 다음 토큰 등록 · 서버 시작까지 비어 있다(다시 묻지 않는다).
fn learn_bot_name(chan: Channel) {
    let Some(rt) = state().rt.clone() else { return };
    rt.spawn(async move {
        let Some((client, cfg, token)) = hands(chan, None) else { return };
        let Some(name) = bot_name(&client, &cfg, &token).await else { return };
        {
            let mut s = state();
            let c = s.chan(chan);
            // 묻는 사이 토큰이 바뀌었으면 버린다.
            if c.token.as_ref() != Some(&token) {
                return;
            }
            c.bot = Some(name);
        }
        emit("bot", chan);
    });
}

/// 토큰이 없으면 멈춘다.
fn restart(chan: Channel) {
    let mut s = state();
    let rt = s.rt.clone();
    let c = s.chan(chan);
    c.gen += 1;
    if let Some(t) = c.task.take() {
        t.abort();
    }
    let gen = c.gen;
    if c.token.is_none() {
        c.link = Link::Off;
        return;
    }
    if let Some(rt) = rt {
        c.task = spawn_loop(chan, &rt, gen);
    }
}

/// 그 세대가 아직 살아 있을 때만 — 전송이 부른다.
fn hands(chan: Channel, gen: Option<u64>) -> Option<(reqwest::Client, Arc<Config>, Token)> {
    let s = state();
    let c = s.chans.get(&chan)?;
    if gen.is_some_and(|g| g != c.gen) {
        return None;
    }
    Some((s.client.clone()?, s.cfg.clone()?, c.token.clone()?))
}

fn set_link(chan: Channel, gen: u64, link: Link) {
    let changed = {
        let mut s = state();
        let c = s.chan(chan);
        if c.gen != gen || c.link == link {
            false
        } else {
            c.link = link;
            true
        }
    };
    if changed {
        emit("link", chan);
    }
}

/// `stream` 이 있으면 "id → 스트림" 에 적는다(답장 라우팅의 재료).
async fn send(chan: Channel, chat: i64, t: &Text, reply_to: Option<i64>, buttons: &[Button], stream: Option<&str>) -> Option<i64> {
    let id = transport_send(chan, chat, t, reply_to, buttons).await;
    if let (Some(id), Some(s)) = (id, stream) {
        state().chan(chan).sent.insert(id, s);
    }
    id
}

async fn send_plain_text(chan: Channel, chat: i64, text: &str, reply_to: Option<i64>, stream: Option<&str>) -> Option<i64> {
    send(chan, chat, &Text::plain(text), reply_to, &[], stream).await
}

// ---------------------------------------------------------------------------
// 받은 글 — 전송이 부르는 입구
// ---------------------------------------------------------------------------

/// 지난 글이면 그 대화방 id 를 돌려준다(전송이 묶음 끝에 한 통으로 알린다).
async fn on_message(chan: Channel, cfg: &Arc<Config>, m: Incoming) -> Option<i64> {
    let paired = state().chan(chan).paired.clone();
    match logic::classify(paired.as_ref(), m.from_id, m.chat_id, m.private) {
        Sender::Drop => None,
        Sender::Stranger => {
            on_stranger(chan, m).await;
            None
        }
        Sender::Paired => {
            if logic::is_stale(m.date, (now_ms() / 1000) as i64) {
                return Some(m.chat_id);
            }
            on_paired(chan, cfg, m).await;
            None
        }
    }
}

async fn on_stranger(chan: Channel, m: Incoming) {
    let Some(user) = m.from_id else { return };
    let step = state().chan(chan).pairing.request(user, m.chat_id, &m.from_name, now_ms(), crate::remote::auth::six_digits);
    match step {
        PairStep::Reply { code, fresh } => {
            if fresh {
                log::line("messenger bridge — pairing requested");
                emit("pairing", chan);
            }
            let text = tr!(
                ko: "연결 코드: {code}\n메인 PC 의 Aynx 설정 화면에 같은 코드가 보이면 [허용]을 누르세요(10분 안).",
                en: "Pairing code: {code}\nIf the same code shows in Aynx settings on the main PC, press [Allow] (within 10 minutes).",
            );
            send_plain_text(chan, m.chat_id, &text, None, None).await;
        }
        PairStep::Quiet | PairStep::Busy | PairStep::NoCode => {}
    }
}

/// 프런트가 미리 알린 것이 없으면 대체 이름(대화 색인을 읽으므로 블로킹 풀에서).
async fn label_of(cfg: &Config, stream: &str) -> String {
    if let Some(l) = state().labels.get(stream).cloned() {
        return l;
    }
    let env = cfg.env.clone();
    let s = stream.to_string();
    blocking(move || env.fallback_label(&s)).await.unwrap_or_else(|| stream.to_string())
}

/// 다리가 보내는 글의 타일 이름 — 대화 제목이 있으면 붙인다(고르기 단추와 같은 규칙 · 번호 없음).
async fn named_of(cfg: &Config, stream: &str) -> String {
    let label = label_of(cfg, stream).await;
    let env = cfg.env.clone();
    let s = stream.to_string();
    let title = blocking(move || env.title(&s)).await.flatten();
    logic::named(&label, title.as_deref())
}

async fn on_paired(chan: Channel, cfg: &Arc<Config>, m: Incoming) {
    let chat = m.chat_id;
    let text = match logic::clean_text(m.text.as_deref().unwrap_or("")) {
        Clean::Text(t) => t,
        Clean::Empty => {
            if m.text.is_none() {
                let t = tr!(ko: "글만 타일에 보낼 수 있습니다", en: "Only text can be sent to a tile");
                send_plain_text(chan, chat, &t, Some(m.message_id), None).await;
            }
            return;
        }
        Clean::TooLong => {
            let max = logic::TEXT_MAX_CHARS;
            let t = tr!(ko: "글이 너무 깁니다 (최대 {max}자)", en: "The message is too long (at most {max} characters)");
            send_plain_text(chan, chat, &t, Some(m.message_id), None).await;
            return;
        }
    };
    if !chat_on(chan, cfg).await {
        send_plain_text(chan, chat, &logic::refusal_text(Refusal::Off), Some(m.message_id), None).await;
        return;
    }
    let target = m.reply_to.and_then(|id| state().chan(chan).sent.get(id).map(str::to_string));
    // 답장이 아닐 때만 — 까닭은 "없다" 답장의 줄이 된다
    let (waiting, refused): (Vec<String>, Vec<(String, Refusal)>) = if target.is_some() {
        (Vec::new(), Vec::new())
    } else {
        let env = cfg.env.clone();
        blocking(move || {
            let mut waiting = Vec::new();
            let mut refused = Vec::new();
            for s in env.streams() {
                match logic::gate(true, &env.tile(&s)) {
                    Ok(_) => waiting.push(s),
                    Err(r) => refused.push((s, r)),
                }
            }
            (waiting, refused)
        })
        .await
        .unwrap_or_default()
    };
    match logic::route(target.as_deref(), &waiting) {
        Route::To(stream) => deliver(chan, cfg, chat, m.message_id, &stream, &text, None, None).await,
        Route::Nowhere => {
            let mut items = Vec::new();
            for (st, r) in refused.into_iter().filter(|(_, r)| logic::listable(*r)) {
                items.push((label_of(cfg, &st).await, r));
            }
            send_plain_text(chan, chat, &logic::nowhere_text(&items), Some(m.message_id), None).await;
        }
        Route::Choose(streams) => {
            let seq = {
                let mut s = state();
                let c = s.chan(chan);
                c.held_seq += 1;
                c.held_seq
            };
            let labels = pick_labels_of(cfg, &streams).await;
            let mut buttons: Vec<Button> = Vec::new();
            for (i, label) in labels.iter().enumerate() {
                let data = logic::pick_data(seq, i);
                if data.len() <= data_max(chan) {
                    buttons.push((label.clone(), data));
                }
            }
            let q = tr!(ko: "어느 타일로 보낼까요? (2분)", en: "Which tile should get this? (2 minutes)");
            let id = send(chan, chat, &Text::plain(q), Some(m.message_id), &buttons, None).await;
            state().chan(chan).held = Some(Held { seq, text, streams, labels, at_ms: now_ms(), message_id: id, source_id: m.message_id });
        }
    }
}

/// 대화 제목은 블로킹 풀에서 읽는다.
async fn pick_labels_of(cfg: &Config, streams: &[String]) -> Vec<String> {
    let mut items: Vec<(String, Option<String>)> = Vec::new();
    for st in streams {
        let label = label_of(cfg, st).await;
        let env = cfg.env.clone();
        let s = st.clone();
        let title = blocking(move || env.title(&s)).await.flatten();
        items.push((label, title));
    }
    logic::pick_labels(&items)
}

async fn on_press(chan: Channel, cfg: &Arc<Config>, p: ButtonPress) {
    let paired = state().chan(chan).paired.clone();
    let Some(pd) = paired.filter(|x| x.user_id == p.from_id && p.chat_id.is_none_or(|ch| ch == x.chat_id)) else {
        return;
    };
    if let Some((allow, id)) = p.data.as_deref().and_then(logic::parse_card_press) {
        on_card_press(chan, cfg, pd.chat_id, &p, allow, &id).await;
        return;
    }
    finish_press(&p, None, false).await;
    let picked = p.data.as_deref().and_then(logic::parse_pick);
    let held = {
        let mut s = state();
        let now = now_ms();
        let c = s.chan(chan);
        match (&c.held, picked) {
            (Some(h), Some((seq, i))) if h.seq == seq && now.saturating_sub(h.at_ms) < logic::HOLD_MS && i < h.streams.len() => {
                c.held.take().map(|h| (h, i))
            }
            _ => None,
        }
    };
    let Some((h, i)) = held else {
        if let Some(mid) = p.message_id {
            let t = tr!(ko: "시간이 지났거나 다른 글로 바뀌어 보내지 않았습니다", en: "Expired or replaced — nothing was sent");
            edit(chan, pd.chat_id, mid, &Text::plain(t)).await;
        }
        return;
    };
    let stream = h.streams[i].clone();
    let shown = h.labels.get(i).cloned();
    deliver(chan, cfg, pd.chat_id, h.source_id, &stream, &h.text, h.message_id.or(p.message_id), shown).await;
}

/// `shown` 은 고르기 단추에 보였던 글자 — 있으면 `→` 줄도 그 글자다.
#[allow(clippy::too_many_arguments)]
async fn deliver(chan: Channel, cfg: &Arc<Config>, chat: i64, source: i64, stream: &str, text: &str, edit_id: Option<i64>, shown: Option<String>) {
    let result = inject(chan, cfg, stream, text, source).await;
    let line = match result {
        Ok(()) => {
            let label = match shown {
                Some(l) => l,
                None => named_of(cfg, stream).await,
            };
            format!("→ {label}")
        }
        Err(r) => logic::refusal_text(r),
    };
    let t = Text::plain(line);
    match edit_id {
        Some(mid) => {
            edit(chan, chat, mid, &t).await;
            if result.is_ok() {
                state().chan(chan).sent.insert(mid, stream);
            }
        }
        None => {
            send(chan, chat, &t, Some(source), &[], result.is_ok().then_some(stream)).await;
        }
    }
}

/// **넣기 함수 하나** — 문지기를 그 순간의 재료로 다시 본다. 쓰는 바이트는 [`logic::paste_bytes`] 와 `\r` 뿐이고, 그 사이 세션이 바뀌면
/// Enter 를 버린다.
async fn inject(chan: Channel, cfg: &Arc<Config>, stream: &str, text: &str, source: i64) -> Result<(), Refusal> {
    let env = cfg.env.clone();
    let s = stream.to_string();
    let checked = blocking(move || {
        let enabled = chat_enabled(chan, &env.prefs());
        logic::gate(enabled, &env.tile(&s)).map(|_| env.local(&s))
    })
    .await
    .unwrap_or(Err(Refusal::NoTile))?;
    let Some((id, epoch)) = checked else {
        return Err(Refusal::NoTile);
    };
    let paste = logic::paste_bytes(text);
    let env = cfg.env.clone();
    blocking(move || env.write_pty(id, &paste)).await.unwrap_or(Err(())).map_err(|_| Refusal::NoTile)?;
    // 다리 턴은 붙여넣기 뒤에 곧바로 — Enter 와 첫 신호 사이에 틈이 없게.
    {
        let mut s = state();
        let c = s.chan(chan);
        c.turns.begin_from(stream, now_ms(), source);
        c.tending.tend(stream);
    }
    tokio::time::sleep(cfg.enter_delay).await;
    let env = cfg.env.clone();
    let s = stream.to_string();
    let entered = blocking(move || match env.local(&s) {
        Some(now) if now == (id, epoch) => env.write_pty(id, b"\r").is_ok(),
        _ => false,
    })
    .await
    .unwrap_or(false);
    if !entered {
        let mut s = state();
        let c = s.chan(chan);
        c.turns.drop_stream(stream);
        c.tending.untend(stream);
        return Err(Refusal::NoTile);
    }
    log::line("messenger bridge — delivered a message to a local AI tile");
    Ok(())
}

// ---------------------------------------------------------------------------
// 신호 — 답 보내기
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TurnEvent {
    Done,
    Asked,
    Gone,
}

/// 신호 평면이 표를 갱신한 **뒤에** HTTP 스레드에서 부른다 — 잠금 · 비교뿐, 보내기는 런타임 태스크로.
pub(crate) fn on_signal(sig: &crate::agent_signal::AgentSignal, step: &crate::agent_state::Step) {
    use crate::agent_signal::SignalEvent;
    let ev = match sig.event {
        SignalEvent::Stop if step.notify => TurnEvent::Done,
        SignalEvent::Waiting if sig.detail.as_deref() == Some("permission") => TurnEvent::Asked,
        SignalEvent::Interrupt | SignalEvent::SessionEnd => TurnEvent::Gone,
        _ => return,
    };
    on_turn_event(&sig.stream, ev, step.next.cli, step.next.agent_run_id.clone());
}

/// 답은 그 턴을 연 채널로만 간다.
pub(crate) fn on_turn_event(stream: &str, ev: TurnEvent, cli: Option<&'static str>, convo: Option<String>) {
    let mut s = state();
    let now = now_ms();
    let mut jobs: Vec<(Channel, Option<u64>, i64, Option<i64>)> = Vec::new();
    for &chan in CHANNELS {
        let Some(c) = s.chans.get_mut(&chan) else { continue };
        // 끝내기 전에 — 끝난 턴은 시작한 글을 내주지 않는다
        let anchor = turn_anchor(chan, c.turns.source(stream));
        let ask_seq = match ev {
            TurnEvent::Done => {
                c.tending.untend(stream);
                if !c.turns.end(stream, now) {
                    continue;
                }
                None
            }
            // 카드가 선 물음은 카드의 단추 통이 맡는다(한 물음에 한 통) — 아니면 틈을 두고 다시 본다.
            TurnEvent::Asked => {
                if !c.turns.running(stream) {
                    continue;
                }
                let open = c.cards.open_on(stream);
                match c.tending.signal(stream, now, open) {
                    Some(seq) => Some(seq),
                    None => continue,
                }
            }
            TurnEvent::Gone => {
                c.turns.drop_stream(stream);
                c.tending.untend(stream);
                continue;
            }
        };
        if let Some(p) = &c.paired {
            jobs.push((chan, ask_seq, p.chat_id, anchor));
        }
    }
    let (Some(rt), Some(cfg)) = (s.rt.clone(), s.cfg.clone()) else { return };
    drop(s);
    for (chan, ask_seq, chat, anchor) in jobs {
        let stream = stream.to_string();
        let cfg = cfg.clone();
        let convo = convo.clone();
        rt.spawn(async move {
            match (ev, ask_seq) {
                (TurnEvent::Done, _) => send_answer(chan, &cfg, chat, &stream, cli, convo, anchor).await,
                (TurnEvent::Asked, Some(seq)) => {
                    tokio::time::sleep(cfg.ask_grace).await;
                    // 그 사이 카드가 서지 않았고 이 턴의 첫 물음 알림일 때만(턴당 한 번)
                    let go = {
                        let mut s = state();
                        let c = s.chan(chan);
                        c.tending.fire(&stream, seq) && c.turns.first_ask(&stream)
                    };
                    if go {
                        let label = named_of(&cfg, &stream).await;
                        let t = tr!(ko: "🟡 확인 필요 · {label} — 앱에서 답하세요", en: "🟡 Needs action · {label} — answer in the app");
                        send_plain_text(chan, chat, &t, anchor, Some(&stream)).await;
                    }
                }
                _ => {}
            }
        });
    }
}

// ---------------------------------------------------------------------------
// 타일 권한 카드에 단추로 답한다
// ---------------------------------------------------------------------------

/// `server::tile_permission` 의 "보는 창" 이 다리 표지를 덧붙일지 — 잠금 하나 · 비교뿐.
pub(crate) fn tends(stream: &str) -> bool {
    state().chans.values().any(|c| c.tending.tends(stream))
}

/// 대화 면 [중지]는 신호 평면을 지나지 않는다 — 돌봄만 걷는다(다리 턴의 답은 다음 `stop` 에).
pub(crate) fn untend(stream: &str) {
    for c in state().chans.values_mut() {
        c.tending.untend(stream);
    }
}

/// 본문은 요약 한 줄로만 — `Debug` 없음.
enum CardJob {
    Request { id: String, stream: String, question: bool, tool: String, summary: String },
    Rewrite { message_id: i64, label: String, reason: String },
}

/// 카드 표 잠금 밖에서 불린다 — 그 스레드를 붙들지 않게 판정 · 표 갱신만 하고 보내기는 런타임 태스크로. `auto` · `tui` 는 보지 않는다.
pub(crate) fn on_card_events(evs: &[crate::tile_permission::Ev]) {
    // 도구 입력 본문은 여기서 한 줄로 줄고 그 밖으로 나가지 않는다
    let requests: Vec<(String, String, u64, bool, String, String)> = evs
        .iter()
        .filter(|ev| ev.body.get("t").and_then(Value::as_str) == Some("request"))
        .filter_map(|ev| {
            let card = ev.body.get("card")?;
            let id = card.get("requestId")?.as_str()?.to_string();
            let tool = card.get("tool").and_then(Value::as_str).unwrap_or("").to_string();
            let question = card.get("kind").and_then(Value::as_str) == Some("question");
            let summary = if question { String::new() } else { logic::card_summary(&tool, card.get("input").unwrap_or(&Value::Null)) };
            Some((id, ev.stream.clone(), ev.session_epoch, question, tool, summary))
        })
        .collect();
    let mut jobs: Vec<(Channel, i64, CardJob)> = Vec::new();
    let (rt, cfg) = {
        let mut s = state();
        let (Some(rt), Some(cfg)) = (s.rt.clone(), s.cfg.clone()) else { return };
        let now = now_ms();
        for &chan in CHANNELS {
            let Some(c) = s.chans.get_mut(&chan) else { continue };
            let Some(chat) = c.paired.as_ref().map(|p| p.chat_id) else { continue };
            if c.token.is_none() {
                continue;
            }
            for (id, stream, epoch, question, tool, summary) in &requests {
                if !c.tending.tends(stream) {
                    continue;
                }
                c.tending.card(stream, now);
                // 보내기 전에 표에 연다 — 보내는 사이의 `gone` · 알림 길(`notify`)의 중복을 이 표가 막는다
                if !*question && !c.cards.open(id, stream, *epoch) {
                    continue;
                }
                let job = CardJob::Request { id: id.clone(), stream: stream.clone(), question: *question, tool: tool.clone(), summary: summary.clone() };
                jobs.push((chan, chat, job));
            }
            for ev in evs {
                if ev.body.get("t").and_then(Value::as_str) != Some("gone") {
                    continue;
                }
                let (Some(id), Some(reason)) = (ev.body.get("requestId").and_then(Value::as_str), ev.body.get("reason").and_then(Value::as_str)) else {
                    continue;
                };
                if let Some((message_id, label, reason)) = c.cards.gone(id, reason) {
                    jobs.push((chan, chat, CardJob::Rewrite { message_id, label, reason }));
                }
            }
        }
        (rt, cfg)
    };
    if jobs.is_empty() {
        return;
    }
    rt.spawn(async move {
        for (chan, chat, job) in jobs {
            match job {
                CardJob::Request { id, stream, question, tool, summary } => card_request(chan, &cfg, chat, &id, &stream, question, &tool, &summary).await,
                CardJob::Rewrite { message_id, label, reason } => rewrite(chan, chat, message_id, &label, &logic::gone_text(&reason)).await,
            }
        }
    });
}

async fn rewrite(chan: Channel, chat: i64, message_id: i64, label: &str, line: &str) {
    edit(chan, chat, message_id, &Text::plain(logic::result_text(label, line))).await;
}

async fn chat_on(chan: Channel, cfg: &Config) -> bool {
    let env = cfg.env.clone();
    blocking(move || chat_enabled(chan, &env.prefs())).await.unwrap_or(false)
}

/// 보내는 사이 풀렸으면 곧바로 바꿔 쓴다.
async fn after_card_sent(chan: Channel, chat: i64, id: &str, message_id: Option<i64>, label: &str) {
    let rewrite_now = state().chan(chan).cards.sent(id, message_id, label);
    if let Some((mid, label, reason)) = rewrite_now {
        rewrite(chan, chat, mid, &label, &logic::gone_text(&reason)).await;
    }
}

/// 질문 카드 · 꺼짐이면 "앱에서 답하세요" 를 이 돌봄에 한 번만.
#[allow(clippy::too_many_arguments)]
async fn card_request(chan: Channel, cfg: &Arc<Config>, chat: i64, id: &str, stream: &str, question: bool, tool: &str, summary: &str) {
    let on = !question && chat_on(chan, cfg).await;
    let label = named_of(cfg, stream).await;
    let anchor = turn_anchor(chan, state().chan(chan).turns.source(stream));
    if on {
        let mid = send(chan, chat, &Text::plain(logic::card_text(&label, tool, summary)), anchor, &logic::card_buttons(id), Some(stream)).await;
        after_card_sent(chan, chat, id, mid, &label).await;
        return;
    }
    let note = {
        let mut s = state();
        let c = s.chan(chan);
        if !question {
            c.cards.forget(id);
        }
        c.tending.note_once(stream)
    };
    if note {
        let t = tr!(ko: "🟡 확인 필요 · {label} — 앱에서 답하세요", en: "🟡 Needs action · {label} — answer in the app");
        send_plain_text(chan, chat, &t, anchor, Some(stream)).await;
    }
}

/// 결정은 `resolve_from_bridge` 하나로 훅 응답으로만 간다(머리말). 그 함수는 다리 잠금을 쥐지 않은 채 블로킹 풀에서 부른다
/// (카드 표 잠금 · 깨움 · 사건).
async fn on_card_press(chan: Channel, cfg: &Arc<Config>, chat: i64, p: &ButtonPress, allow: bool, id: &str) {
    // 설정을 먼저 읽는다 — 잡은 뒤 기다리는 동안 다른 곳의 `gone` 을 놓치지 않게
    let on = chat_on(chan, cfg).await;
    let (taken, known) = {
        let mut s = state();
        let c = s.chan(chan);
        if on {
            let t = c.cards.begin_press(id);
            let known = t.is_some();
            (t, known)
        } else {
            (None, c.cards.pressable(id))
        }
    };
    let result = match logic::judge_press(known, on) {
        Press::Stale => PressResult::Already,
        Press::Off => PressResult::Off,
        Press::Go => {
            let (stream, epoch) = taken.as_ref().map(|t| (t.0.clone(), t.1)).unwrap_or_default();
            let rid = id.to_string();
            let r = blocking(move || super::tile_permission::resolve_from_bridge(&stream, epoch, &rid, allow)).await;
            state().chan(chan).cards.end_press(id);
            match r {
                Some(Ok(true)) if allow => PressResult::Allowed,
                Some(Ok(true)) => PressResult::Denied,
                Some(Ok(false)) => PressResult::Already,
                _ => PressResult::Closed,
            }
        }
    };
    let line = logic::press_text(result);
    // 꺼짐 — 단추는 그대로(다시 켜면 누를 수 있다) · 표에 없던 누름 — 다른 누름 · 사건이 이미 바꿔 쓴다(또는 쓴다)
    let rewrite_it = match result {
        PressResult::Off => false,
        PressResult::Already => taken.is_some(),
        _ => true,
    };
    let (label, mid) = taken.map(|(_, _, l, m)| (l, m)).unwrap_or_default();
    let target = mid.or(p.message_id).filter(|_| rewrite_it);
    finish_press(p, Some(&line), target.is_some()).await;
    if let Some(mid) = target {
        rewrite(chan, chat, mid, &label, &line).await;
    }
    if matches!(result, PressResult::Allowed | PressResult::Denied) {
        log::line("messenger bridge — answered a tile permission card");
    }
}

/// **다 쓰인 뒤의 답 글** — `stop` 신호가 CLI 의 마지막 글 줄 쓰기보다 먼저 닿으면 첫 읽기는 비거나 도구 앞의 글이다. 그래서 다시 읽어
/// **글이 있고 파일 크기가 직전 읽기와 같을 때** 그 글을 쓴다. 대화 id 는 부를 때 받은 것 그대로 — 그 사이 새 다리 턴이 서도 이 답은 이 대화의 것이다.
async fn settled_answer(cfg: &Arc<Config>, cli: &'static str, convo: Option<String>) -> Option<String> {
    let read = |convo: Option<String>| {
        let env = cfg.env.clone();
        async move { blocking(move || env.answer(cli, convo.as_deref())).await.unwrap_or((None, None)) }
    };
    let start = tokio::time::Instant::now();
    let mut last = read(convo.clone()).await;
    let mut seen = last.0.is_some().then(tokio::time::Instant::now);
    loop {
        let until = match seen {
            Some(at) => at + cfg.answer_deadline,
            None => start + cfg.answer_wait,
        };
        if tokio::time::Instant::now() + cfg.answer_poll > until {
            return last.0;
        }
        tokio::time::sleep(cfg.answer_poll).await;
        let now = read(convo.clone()).await;
        if now.0.is_some() && now.1 == last.1 {
            return now.0;
        }
        if seen.is_none() && now.0.is_some() {
            seen = Some(tokio::time::Instant::now());
        }
        last = now;
    }
}

async fn send_answer(chan: Channel, cfg: &Arc<Config>, chat: i64, stream: &str, cli: Option<&'static str>, convo: Option<String>, anchor: Option<i64>) {
    let label = named_of(cfg, stream).await;
    let text = match cli {
        Some(cli) => settled_answer(cfg, cli, convo).await,
        None => None,
    };
    let head = format!("🟢 {label}");
    let Some(text) = text.filter(|t| !t.trim().is_empty()) else {
        let t = tr!(ko: "턴이 끝났습니다 (답을 읽지 못했습니다)", en: "The turn ended (could not read the reply)");
        send(chan, chat, &Text::headed(head, t), anchor, &[], Some(stream)).await;
        return;
    };
    let more = tr!(ko: "… (앱에서 전체 보기)", en: "… (see the full reply in the app)");
    let parts = logic::mend_fences(split_answer(chan, &head, &text, &more), &more);
    for (i, part) in parts.into_iter().enumerate() {
        let t = Text::Markdown { head: (i == 0).then(|| head.clone()), body: part };
        send(chan, chat, &t, anchor, &[], Some(stream)).await;
    }
}

// ---------------------------------------------------------------------------
// 알림 — 다른 길(프런트 · 서버 안 `send_plain`)의 다리 채널 몫
// ---------------------------------------------------------------------------

/// `Debug` 없음(본문).
#[derive(serde::Serialize, Deserialize)]
pub(crate) struct Notice {
    pub text: String,
    #[serde(default)]
    pub stream: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// **다리는 쓰지 않는다** — 다리 이름표는 op `messenger_bot_label` 하나로만 적는다(와이어 모양은 그대로 둔다).
    #[serde(default)]
    pub label: Option<String>,
    /// 없으면 Telegram — 없을 때는 와이어에 싣지 않는다(판 34 서버의 몸 그대로)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<Channel>,
    /// 그려 둔 글이 이미 "묻는 도구" 줄을 싣고 있다 — 참이면 단추를 달 때 그 줄을 다시 덧붙이지 않는다(같은 줄이 두 번 나온다).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_tool: bool,
}

/// op `messenger_bot_label` 만 부른다.
fn remember_label(s: &mut State, stream: &str, label: &str) {
    if !crate::tile_env::stream_ok(stream) {
        return;
    }
    let l: String = label.chars().filter(|c| !c.is_control()).take(120).collect();
    if !l.trim().is_empty() {
        s.labels.insert(stream.to_string(), l);
    }
}

/// 전송 · 봇 · 짝이 없으면 조용히 건너뛴다. 그 채널의 다리 턴의 같은 알림(턴 끝 · 권한 물음)은 다리가 이미 보냈으니 건너뛴다.
pub(crate) async fn notify(n: Notice) -> Result<(), String> {
    let chan = n.channel.unwrap_or(Channel::Telegram);
    if !has_transport(chan) {
        return Ok(());
    }
    let failed = || {
        let name = chan.name();
        tr!(ko: "{name} 에 보내지 못했습니다", en: "Could not send to {name}")
    };
    let chat = {
        let mut s = state();
        let c = s.chan(chan);
        // `n.label` 은 적지 않는다 — 알림의 이름이 다리 이름표를 덮어쓰면 안 된다.
        let owned = matches!(n.kind.as_deref(), Some("stop" | "permission"))
            && n.stream.as_deref().is_some_and(|st| c.turns.owns(st, now_ms()));
        if owned || c.token.is_none() {
            return Ok(());
        }
        match &c.paired {
            Some(p) => p.chat_id,
            None => return Ok(()),
        }
    };
    let stream = n.stream.as_deref().filter(|s| crate::tile_env::stream_ok(s));
    // 다리 턴이 아닌 턴의 권한 알림 — 그 스트림에 권한 카드가 서 있고 켜져 있으면 단추를 단다(그 뒤 그 턴은 다리가 돌본다)
    if let (Some("permission"), Some(st)) = (n.kind.as_deref(), stream) {
        if let Some(done) = permission_notice(chan, chat, st, &n.text, n.has_tool).await {
            return done.map_err(|_| failed());
        }
    }
    match send(chan, chat, &Text::Rendered { text: n.text, tail: None }, None, &[], stream).await {
        Some(_) => Ok(()),
        None => Err(failed()),
    }
}

/// (요청 id, 회차, 도구, 요약).
type CardBrief = (String, u64, String, String);

fn brief(card: &Value) -> Option<CardBrief> {
    let id = card.get("requestId")?.as_str()?.to_string();
    let epoch = card.get("sessionEpoch")?.as_u64()?;
    let tool = card.get("tool").and_then(Value::as_str).unwrap_or("").to_string();
    let summary = logic::card_summary(&tool, card.get("input").unwrap_or(&Value::Null));
    Some((id, epoch, tool, summary))
}

/// `None` 이면 글만 보낸다. 스트림을 돌보는 중으로 적는 것은 **보내기 전**이어야 한다 — 그때부터 다리 표지가 "보는 창" 에 있어야 누름이 먹는다.
/// 카드 표 · 다리 잠금은 차례로(겹쳐 쥐지 않는다).
async fn permission_notice(chan: Channel, chat: i64, stream: &str, rendered: &str, has_tool: bool) -> Option<Result<(), ()>> {
    let cfg = state().cfg.clone()?;
    let standing: Vec<CardBrief> = super::tile_permission::standing_cards(stream).iter().filter_map(brief).collect();
    if standing.is_empty() {
        return None;
    }
    let (fresh, tended): (Vec<CardBrief>, bool) = {
        let mut s = state();
        let c = s.chan(chan);
        (standing.into_iter().filter(|b| !c.cards.has(&b.0)).collect(), c.tending.tends(stream))
    };
    if fresh.is_empty() {
        return tended.then_some(Ok(()));
    }
    if !chat_on(chan, &cfg).await {
        return None;
    }
    let opened: Vec<CardBrief> = {
        let mut s = state();
        let c = s.chan(chan);
        c.tending.tend(stream);
        fresh.into_iter().filter(|b| c.cards.open(&b.0, stream, b.1)).collect()
    };
    // 연 뒤 다시 본다 — 열기 전에 풀린 카드(그 `gone` 은 표가 받지 못했다)는 뺀다
    let still: Vec<String> = super::tile_permission::standing_cards(stream).iter().filter_map(brief).map(|b| b.0).collect();
    let opened: Vec<CardBrief> = {
        let mut s = state();
        let c = s.chan(chan);
        opened
            .into_iter()
            .filter(|b| {
                let keep = still.contains(&b.0);
                if !keep {
                    c.cards.forget(&b.0);
                }
                keep
            })
            .collect()
    };
    let (first, rest) = opened.split_first()?;
    let label = named_of(&cfg, stream).await;
    let text = Text::Rendered { text: rendered.to_string(), tail: (!has_tool).then(|| logic::tool_line(&first.2, &first.3)) };
    let mid = send(chan, chat, &text, None, &logic::card_buttons(&first.0), Some(stream)).await;
    after_card_sent(chan, chat, &first.0, mid, &label).await;
    for (id, _, tool, summary) in rest {
        let m = send(chan, chat, &Text::plain(logic::card_text(&label, tool, summary)), None, &logic::card_buttons(id), Some(stream)).await;
        after_card_sent(chan, chat, id, m, &label).await;
    }
    Some(mid.map(|_| ()).ok_or(()))
}

// ---------------------------------------------------------------------------
// op — GUI Rust 만(`server::messenger_bridge_proxy`)
// ---------------------------------------------------------------------------

pub(crate) fn is_op(op: &str) -> bool {
    matches!(
        op,
        "messenger_bot_status" | "messenger_bot_set_token" | "messenger_bot_pair" | "messenger_bot_unpair" | "messenger_bot_test"
            | "messenger_bot_notify" | "messenger_bot_label"
    )
}

fn bad(msg: &str) -> WireError {
    WireError::new(MESSENGER_BOT, msg)
}

/// 없으면 Telegram(판 34 의 와이어 그대로).
fn channel_of(body: &Value) -> Result<Channel, WireError> {
    let chan = match body.get("channel") {
        None | Some(Value::Null) => Channel::Telegram,
        Some(v) => serde_json::from_value(v.clone()).map_err(|_| bad("bad channel"))?,
    };
    if !has_transport(chan) {
        return Err(bad("[unsupported] no messenger bridge for this channel"));
    }
    Ok(chan)
}

/// 잠금 하나 · 비교뿐.
pub(crate) fn configured(chan: Channel) -> bool {
    state().chans.get(&chan).is_some_and(|c| c.token.is_some())
}

/// 토큰 없음.
fn status(chan: Channel) -> Value {
    let mut s = state();
    let now = now_ms();
    let c = s.chan(chan);
    let pending = c.pairing.current(now).map(|p| json!({ "code": p.code, "name": p.name }));
    json!({
        "configured": c.token.is_some(),
        "bot": c.bot,
        "paired": c.paired.is_some(),
        "pairName": c.paired.as_ref().map(|p| p.name.clone()),
        "pending": pending,
        "link": c.link.as_str(),
    })
}

#[derive(Deserialize)]
struct TokenBody {
    #[serde(default)]
    token: Option<String>,
}

#[derive(Deserialize)]
struct LabelBody {
    stream: String,
    label: String,
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
    allow: bool,
}

/// 몸(토큰 · 본문)은 로그에 남기지 않는다.
pub(crate) async fn handle(op: &str, body: Value) -> Result<Value, WireError> {
    match op {
        "messenger_bot_status" => Ok(status(channel_of(&body)?)),
        "messenger_bot_set_token" => {
            let chan = channel_of(&body)?;
            let b: TokenBody = serde_json::from_value(body).map_err(|_| bad("bad token body"))?;
            set_token(chan, b.token).await
        }
        "messenger_bot_pair" => {
            let chan = channel_of(&body)?;
            let b: PairBody = serde_json::from_value(body).map_err(|_| bad("bad pair body"))?;
            pair(chan, &b.code, b.allow).await
        }
        "messenger_bot_unpair" => {
            let chan = channel_of(&body)?;
            unpair(chan).await?;
            Ok(status(chan))
        }
        "messenger_bot_test" => {
            let chan = channel_of(&body)?;
            let chat = state().chan(chan).paired.as_ref().map(|p| p.chat_id).ok_or_else(|| bad("[not-paired] no paired chat"))?;
            let text = Text::Rendered { text: chan.test_text(), tail: None };
            send(chan, chat, &text, None, &[], None).await.map(|_| Value::Null).ok_or_else(|| bad("[send-failed] sendMessage failed"))
        }
        "messenger_bot_notify" => {
            channel_of(&body)?;
            let n: Notice = serde_json::from_value(body).map_err(|_| bad("bad notify body"))?;
            notify(n).await.map(|_| Value::Null).map_err(|e| bad(&e))
        }
        // 적기만 한다(아무것도 보내지 않는다) — 다리 이름표를 적는 길은 이것 하나다.
        "messenger_bot_label" => {
            let b: LabelBody = serde_json::from_value(body).map_err(|_| bad("bad label body"))?;
            remember_label(&mut state(), &b.stream, &b.label);
            Ok(Value::Null)
        }
        _ => Err(bad("unknown op")),
    }
}

fn cfg_now() -> Result<Arc<Config>, WireError> {
    state().cfg.clone().ok_or_else(|| bad("[bridge-off] messenger bridge is not running"))
}

/// 해제는 짝도 함께 지운다.
async fn set_token(chan: Channel, raw: Option<String>) -> Result<Value, WireError> {
    let cfg = cfg_now()?;
    let raw = raw.filter(|r| !r.trim().is_empty());
    let Some(raw) = raw else {
        let c = cfg.clone();
        let ok = blocking(move || write_or_remove(token_path(&c, chan), None) & write_or_remove(chat_path(&c, chan), None)).await.unwrap_or(false);
        {
            let mut s = state();
            let c = s.chan(chan);
            c.token = None;
            c.paired = None;
            c.bot = None;
            c.pairing.clear();
            c.forget_chat();
        }
        forget_transport(chan);
        restart(chan);
        emit("token", chan);
        if !ok {
            return Err(bad("[save-failed] could not remove the bot files"));
        }
        log::line("messenger bridge — bot token removed");
        return Ok(status(chan));
    };
    let token = parse_token(chan, &raw).ok_or_else(|| bad("[bad-token] not a bot token"))?;
    let client = state().client.clone().ok_or_else(|| bad("[bridge-off] no http client"))?;
    let bot = check_token(&client, &cfg, &token).await.map_err(|m| bad(&m))?;
    let c = cfg.clone();
    let body = token.as_file().to_string();
    let same = state().chan(chan).token.as_ref() == Some(&token);
    let ok = blocking(move || write_or_remove(token_path(&c, chan), Some(&body)) && (same || write_or_remove(chat_path(&c, chan), None)))
        .await
        .unwrap_or(false);
    if !ok {
        return Err(bad("[save-failed] could not save the bot token"));
    }
    {
        let mut s = state();
        let c = s.chan(chan);
        // 다른 봇으로 바꾸면 짝도 새로(그 봇의 대화방이 아니다).
        if !same {
            c.paired = None;
            c.forget_chat();
        }
        c.token = Some(token);
        c.bot = bot;
        c.pairing.clear();
    }
    if !same {
        forget_transport(chan);
    }
    restart(chan);
    emit("token", chan);
    log::line("messenger bridge — bot token registered");
    Ok(status(chan))
}

/// 코드가 지금 대기의 것이어야 한다.
async fn pair(chan: Channel, code: &str, allow: bool) -> Result<Value, WireError> {
    let cfg = cfg_now()?;
    let taken = state().chan(chan).pairing.take(code, now_ms()).ok_or_else(|| bad("[no-pending] no matching pairing request"))?;
    emit("pairing", chan);
    if !allow {
        log::line("messenger bridge — pairing denied");
        return Ok(status(chan));
    }
    let p = Paired { user_id: taken.user_id, chat_id: taken.chat_id, name: taken.name.clone() };
    let body = serde_json::to_string(&p).map_err(|_| bad("[save-failed] encode"))?;
    let c = cfg.clone();
    if !blocking(move || write_or_remove(chat_path(&c, chan), Some(&body))).await.unwrap_or(false) {
        return Err(bad("[save-failed] could not save the paired chat"));
    }
    state().chan(chan).paired = Some(p.clone());
    emit("paired", chan);
    log::line("messenger bridge — paired");
    // Slack DM 에는 답장이 없다 — 스레드가 그 자리다(`sl` 머리말)
    let t = match chan {
        Channel::Slack => tr!(
            ko: "연결됐습니다 — 알림이 이 대화방으로 옵니다. 알림에 스레드로 글을 달면 그 타일로 갑니다(설정에서 켠 경우).",
            en: "Connected — notifications will come to this chat. Reply in a thread on a notification to send it to that tile (when enabled in settings).",
        ),
        Channel::Telegram | Channel::Discord => tr!(
            ko: "연결됐습니다 — 알림이 이 대화방으로 옵니다. 알림에 답장하면 그 타일로 갑니다(설정에서 켠 경우).",
            en: "Connected — notifications will come to this chat. Reply to a notification to send it to that tile (when enabled in settings).",
        ),
    };
    send_plain_text(chan, p.chat_id, &t, None, None).await;
    Ok(status(chan))
}

async fn unpair(chan: Channel) -> Result<(), WireError> {
    let cfg = cfg_now()?;
    let c = cfg.clone();
    if !blocking(move || write_or_remove(chat_path(&c, chan), None)).await.unwrap_or(false) {
        return Err(bad("[save-failed] could not remove the paired chat"));
    }
    {
        let mut s = state();
        let c = s.chan(chan);
        c.paired = None;
        c.forget_chat();
    }
    forget_transport(chan);
    emit("paired", chan);
    log::line("messenger bridge — unpaired");
    Ok(())
}
