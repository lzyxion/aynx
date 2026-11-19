//! **메신저 다리 — 세션 서버 쪽**(2026-11-18 · 1a · 계획 docs/log/2026-11-18-messenger-bridge.md). 폰의 메신저에서 로컬 AI 타일(Claude Code ·
//! Codex)에 글을 보내고, 그 턴이 끝나면 답을 같은 대화방으로 받는다. 이 파일은 **채널 중립 코어**다(3a · 2026-11-19) — 순수 판정은 [`logic`],
//! 채널의 받기 · 보내기 · 글자 서식은 전송([`tg`] — Telegram, JSON · HTML 은 `crate::telegram` · [`dc`] — Discord 게이트웨이 · REST · 3b). 코어와 전송 사이는 이 파일의 "전송" 절
//! `match` 한 곳씩뿐이다(trait 로 벌리지 않는다 — `messenger.rs` 와 같은 관례).
//!
//! ```text
//! 전송(tg: getUpdates 롱폴 · dc: 게이트웨이) ──Incoming · ButtonPress──▶ on_message · on_press ──▶ 보낸 이 문지기 ──▶ 라우팅 ──▶ 넣기 문지기 ──▶ 넣기 함수 하나
//!    ▲                                                                                              (붙여넣기 + Enter)   │
//!    └──send(Text)── 답 보내기 ◀── agent-signal `stop`(notify) · 다리 턴 ◀──────────────────────────────────────────────────┘
//! ```
//!
//! ## 채널
//!
//! - 키는 `crate::messenger::Channel`. 전송이 있는 채널은 [`CHANNELS`](Telegram · Discord(3b) — 이 차례로 돈다 · Slack 은 `None` · `[unsupported]`).
//!   **채널마다 계정 하나**와 자기 상태(토큰 · 짝 · 고리 · 보낸 id · 고르기 · 다리 턴 · 돌봄 · 카드)를 갖고, 설정 · 런타임 · HTTP 클라이언트 ·
//!   이름표는 함께 쓴다. 다리 턴의 답은 그 글이 온 채널로만 · 카드 단추 통은 그 스트림을 돌보는 채널마다 · 누름은 먼저 온 것이 이긴다
//!   (`resolve_from_bridge` 는 두 번째부터 "이미" · 다른 채널의 통은 `gone` 으로 바꿔 쓴다). Telegram 과 Discord 는 함께 켤 수 있다.
//! - Discord(3b): **DM 만** · 의도 `DIRECT_MESSAGES` 하나 · 짝 = (보낸 사람 id, DM 대화방 id) · 스노플레이크는 `i64`(넘치면 버린다) · 한 통 2000자 ·
//!   최대 5통 · 마크다운은 걷는다(머리 줄만 굵게) · 멘션은 늘 막는다 · 누름은 받는 즉시 알리고(3초) 결과는 그 통을 바꿔 써서 보인다.
//! - 코어는 채널 서식을 짓지 않는다 — 보내는 글은 중립 [`Text`](굵은 머리 줄 + 평문 · 또는 `messenger.rs` 가 그 채널로 이미 그린 알림 글).
//!
//! ## 불변식
//!
//! - **봇 토큰을 읽는 것은 세션 서버뿐이다** — 채널의 봇 토큰 파일(`Channel::bot_file` — `<설정 루트>/telegram-bot` · `discord-bot`)은 이 파일만 읽고
//!   쓴다(GUI 는 등록 때 op `messenger_bot_set_token` 몸으로 넘길 뿐 · 시험 `gui_never_reads_the_token_file`). 토큰 · 받은 글 · 대화 글자는 로그 ·
//!   `Debug` · 오류 문구 · 서버 사건 · op 답에 없다 — 로그에는 고정 글자 · 수만, `reqwest` 오류는 `without_url()` 도 거치지 않고 아예 문구로
//!   만들지 않는다(종류만 — 전송의 `err_kind`).
//! - **받는 글**: 1:1 대화방 · 짝지은 사용자 id 와 대화방 id 가 둘 다 맞는 것만(`logic::classify`). 그 밖은 조용히 버린다. 짝이 없을 때만 짝짓기 —
//!   6자리 코드(`remote::auth::six_digits` — 원격 기기 페어링과 같은 난수 출처) · 대기 하나 · 10분 · 계정당 30초에 한 번 답. [허용]은 Tauri
//!   명령 `messenger_bot_pair`(HOME_ONLY)뿐이다.
//! - **지난 글은 실행하지 않는다**: 보낸 지 120초가 넘은 글은 넣지 않고 "보내지 않았습니다" 한 통.
//! - **넣기 문지기**(`logic::gate` — 전부 참이어야): 다리가 켜짐(채널의 `[messenger]` 칸 — Telegram `telegram_chat` · Discord `discord_chat` 을 글마다 다시 읽는다 ·
//!   [`chat_enabled`]) · 살아 있는 **로컬** 세션 · `agent_state` 항목이 있고(**없으면 무조건 거절** — CLI 가 끝난 셸에 글이 가면 셸 명령이 된다)
//!   CLI 가 claude · codex · 턴이 한 번 이상 끝났고 지금 끝나 입력을 기다림(메인 멈춤 · 서브 에이전트 0) · 권한 카드 · 질문이 없음 · 서버 해석기의
//!   괄호 붙여넣기 모드가 켜짐 · 입력 줄에 치다 만 글이 없음. 원격(SSH) 타일은 1단계에서 거절한다.
//! - **서버 안에서 PTY 에 쓰는 길은 둘뿐이다** — 세션 op `write`(창 · `server::sessions::dispatch`)와 이 파일의 [`RealEnv::write_pty`] 하나(시험
//!   `pty_writes_have_two_sites` — 전송 파일에는 없다). 쓰는 바이트는 늘 `ESC[200~` + 걷은 글 + `ESC[201~` 와 잠깐 뒤의 `\r` 둘뿐이다(프런트
//!   `submitText` 와 같은 틈 200ms · 그 사이 세션이 바뀌면 Enter 를 버린다). AI 문자열이 이 길에 오르는 일은 없다 — 글은 짝지은 사람의 메신저 글뿐이다.
//! - **다리에는 작업안 승인 · AI 권한 · 위임 · 앨범 · 볼트로 가는 길이 없다** — 승인 등급 프레임을 만들지 않는다(시험 `bridge_has_no_approval_path`
//!   — 코어 · 순수 층 · 전송을 훑는다).
//! - **2단계(2026-11-19) — 타일 권한 카드(`tile_permission` — 로컬 Claude · Codex)에 단추로 답한다.** 다리는 그 표의 **보는 쪽 하나**다:
//!   - **돌보는 스트림**(`logic::Tending` · 채널마다) = 다리 턴 ∪ 단추 달린 권한 알림을 보낸 스트림 — 그 턴이 끝나면(`stop` · `interrupt` ·
//!     `session-end`) 걷는다. 어느 채널이든 돌보는 동안만 `server::tile_permission` 의 "보는 창" 에 다리 표지가 붙는다([`tends`]) — 늘 보는
//!     쪽이면 Codex 의 면 규칙이 깨진다.
//!   - 카드 사건([`on_card_events`] — 카드 표 잠금 밖): 돌보는 스트림의 권한 카드 + 그 채널의 다리 켬 → 단추 통(`🟡 확인 필요 · 이름표` / 도구 +
//!     입력 한 줄 요약 300자 / [허용] [거절]) · 질문 카드(또는 꺼짐) → "앱에서 답하세요" 한 통(돌봄마다 한 번) · `gone`(다른 곳에서 풀림) → 그 통을 결과
//!     한 줄로 바꿔 쓴다(단추 걷음) · `auto` · `tui` 는 보지 않는다. 다리 턴의 신호 물음은 카드가 없는 물음에만 1a 의 한 통(틈 `ask_grace` — 한 물음에 한 통).
//!   - 다리 턴이 아닌 턴: 프런트의 권한 알림([`notify`] `kind: "permission"`)이 닿을 때 그 스트림에 권한 카드가 서 있으면 그 글에 단추를 달고 돌본다.
//!   - 누름([`on_press`] → `on_card_press`): 짝지은 계정 → 다리가 보낸 카드(`logic::Cards`) → 그 채널의 다리가 **지금** 켜짐 →
//!     `server::tile_permission::resolve_from_bridge`(Allow · Deny 둘뿐 — [이 세션 동안 허용] · 사유 · 질문의 답 없음) → 통을 결과 글로. 결정은
//!     **훅 응답으로만** 간다 — PTY 에 쓰지 않고(위의 두 길 그대로) 작업안 승인으로 가는 길도 아니다(시험 `bridge_answers_cards_through_one_function`).
//!   - 잠금 순서: 다리 잠금(채널 상태 포함 하나)을 쥔 채 카드 표 · 세션 코어 · 상태 표를 부르지 않는다(값을 꺼내 놓고 부른다). 카드 표 잠금 안에서
//!     다리를 부르지 않는다. 전송은 다리 잠금을 쥔 채 기다리지 않는다.
//! - **실기 후속(2026-11-19)** — 다리 이름표 = `<CLI 표시 이름> · <프로젝트 / 워크트리 | 폴더 끝 이름>`(탭 제목 · 타일 이름은 쓰지 않는다). 적는
//!   길은 미리 알리기(op `messenger_bot_label` — 적기만 · [`remember_label`]) 하나 — 알림(`notify`)의 이름은 적지 않는다 · 창이 알리지 않은 타일은
//!   같은 꼴의 대체 이름(`logic::fallback_label`) · "기다리는 타일이 없다" 에 타일별 짧은 까닭(`logic::nowhere_text`) · 겹친 고르기 단추에 대화 제목(`logic::pick_labels`) ·
//!   다리 턴의 답은 대화 파일이 다 쓰인 뒤의 글([`settled_answer`] — 신호가 파일 쓰기보다 빠르다 · 글을 가진 뒤 4초 · 글이 없으면 20초까지).
//! - **방어 기계는 최소** — 받기 실패는 고정 5초 물러남(Telegram 409 = 다른 프로그램이 같은 봇을 받음 · 30초 + 상태 `conflict`) 하나뿐. Discord 는
//!   IDENTIFY 예산(24시간 1000번 — 넘으면 토큰이 바뀐다) 때문에 RESUME 먼저 · 치명 닫힘 코드면 멈춤 · 갓 IDENTIFY 한 세션이 곧 죽으면 5초부터 두 배
//!   (5분까지) · REST 429 는 한 번 쉬고 다시(`dc` 머리말). 재시도 큐 · 놓친 글 재생 · 속도 제한기는 없다.
//! - 신호를 받는 HTTP 스레드(`signal_http::handle`)는 붙들지 않는다 — [`on_signal`] 은 잠금 · 비교뿐이고 보내기는 런타임 태스크로 넘긴다
//!   (서버가 뜰 때 [`start`] 가 쥔 런타임 손잡이 — `server::ai::mcp_route` 의 DB 손과 같은 관례).

mod dc;
pub(crate) mod logic;
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

/// 서버 사건 — 몸은 무엇이 바뀌었는지 한 낱말뿐(`{changed}` — 토큰 · 코드 · 이름 없음). 설정 화면이 상태를 다시 읽는다.
pub(crate) const EVENT: &str = "messenger-bot-event";
/// op 오류 코드.
pub(crate) const MESSENGER_BOT: &str = "messenger-bot";
/// Telegram 의 짝지은 계정 파일(설정 루트 바로 아래) — 비밀은 아니지만 토큰과 같은 제외 규칙(다른 PC 로 옮기면 다시 짝짓는다). 채널마다의 이름은 [`chat_file`].
pub(crate) const CHAT_FILE: &str = "telegram-chat";
/// Discord 의 짝지은 계정 파일(3b) — [`CHAT_FILE`] 과 같은 규칙.
pub(crate) const DISCORD_CHAT_FILE: &str = "discord-chat";
/// 짝 파일 전부 — 씨앗 · 설정 옮기기 제외 시험이 센다.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const CHAT_FILES: &[&str] = &[CHAT_FILE, DISCORD_CHAT_FILE];

/// HTTP 요청 시한(클라이언트 기본 · 롱폴 상한) · 받기 실패 물러남 · 409 물러남 · 붙여넣기와 Enter 사이.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const BACKOFF: Duration = Duration::from_secs(5);
const CONFLICT_BACKOFF: Duration = Duration::from_secs(30);
/// 프런트 `SUBMIT_ENTER_DELAY_MS` 와 같다(Codex 가 글 바로 뒤의 Enter 를 줄바꿈으로 받는다 — `term/submit-text.ts`).
const ENTER_DELAY: Duration = Duration::from_millis(200);
/// 다리 턴의 신호 물음(`waiting permission`)이 카드를 기다리는 틈 — 이 안에 카드가 서면 카드의 단추 통이 그 물음의 한 통이다(2단계).
const ASK_GRACE: Duration = Duration::from_millis(1500);
/// 다리 턴의 답 — `stop` 신호가 CLI 의 마지막 글 줄 쓰기보다 먼저 닿는다(실기 2026-11-19 · 8턴 중 2턴). 글이 있고 파일 크기가 직전 읽기와 같을
/// 때 보낸다 — 이 간격으로 다시 읽고, 글을 가진 뒤 4초면 그때 가진 글 · 글이 아직 없으면 20초까지 기다린다(CLI 가 몇 초 멈춘 턴 — 실기 11-19).
const ANSWER_POLL: Duration = Duration::from_millis(300);
const ANSWER_DEADLINE: Duration = Duration::from_secs(4);
const ANSWER_WAIT: Duration = Duration::from_secs(20);

// ---------------------------------------------------------------------------
// 바깥 — 시험이 갈아 끼우는 칸
// ---------------------------------------------------------------------------

/// 다리가 보는 바깥(세션 · 상태 표 · 설정 · 대화 파일 · PTY). 제품은 [`RealEnv`] — 시험은 가짜를 꽂는다.
pub(crate) trait Env: Send + Sync {
    /// `[messenger]` 설정(글마다 다시 읽는다 — 블로킹).
    fn prefs(&self) -> MessengerPrefs;
    /// 에이전트 상태가 있는 스트림들(고르기 후보).
    fn streams(&self) -> Vec<String>;
    /// 문지기의 재료.
    fn tile(&self, stream: &str) -> TileView;
    /// 살아 있는 로컬 세션의 (손잡이, 세션 회차).
    fn local(&self, stream: &str) -> Option<(u32, u64)>;
    /// **PTY 쓰기 — 블로킹.** 제품의 몸은 [`RealEnv::write_pty`] 하나(머리말).
    fn write_pty(&self, id: u32, bytes: &[u8]) -> Result<(), ()>;
    /// 그 대화의 마지막 답 전문과 그때의 대화 파일 크기(블로킹 — 대화 파일). 크기는 [`send_answer`] 가 "파일이 다 쓰였나" 를 보는 재료다.
    fn answer(&self, cli: &str, convo: Option<&str>) -> (Option<String>, Option<u64>);
    /// 이름표가 없을 때의 이름표(블로킹 — 대화의 기록된 cwd).
    fn fallback_label(&self, stream: &str) -> String;
    /// 그 타일 대화의 제목(블로킹 — 대화 파일 · 앱의 지난 대화 목록과 같은 글자). 겹친 고르기 단추에만 쓴다.
    fn title(&self, stream: &str) -> Option<String>;
}

/// 다리의 설정 — 제품은 [`Config::release`].
pub(crate) struct Config {
    /// Telegram 전송의 칸(API 주소 · 롱폴 시한)
    pub telegram: tg::Conf,
    /// Discord 전송의 칸(REST · 게이트웨이 주소 · IDENTIFY 물러남 — 3b)
    pub discord: dc::Conf,
    /// 비밀 파일 폴더 — `None` 이면 `instance::config_root()`.
    pub dir: Option<PathBuf>,
    pub env: Arc<dyn Env>,
    pub backoff: Duration,
    pub conflict_backoff: Duration,
    pub enter_delay: Duration,
    pub ask_grace: Duration,
    /// 다리 턴 답 읽기의 다시 읽는 간격 · 시한([`send_answer`] — 신호가 대화 파일 쓰기보다 빠르다)
    pub answer_poll: Duration,
    /// 글을 처음 가진 뒤의 시한 — 닿으면 그때 가진 글
    pub answer_deadline: Duration,
    /// 글이 아직 없을 때의 시한(부른 때부터) — 닿으면 "읽지 못했습니다"
    pub answer_wait: Duration,
}

impl Config {
    pub(crate) fn release() -> Config {
        Config {
            telegram: tg::Conf::release(),
            discord: dc::Conf::release(),
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

/// 제품의 바깥 — 세션 서버 프로세스의 표들.
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
        // 잠금은 하나씩 잡고 곧바로 놓는다(세션 코어 · 상태 표 · 카드 표 · 해석기 — 겹쳐 쥐지 않는다).
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
        // CLI 는 앱의 표시 이름(`Claude Code` · `Codex` — 대화 목록 표와 같은 글자) — 프런트 이름표와 같은 꼴
        logic::fallback_label(target.map_or(cli, |t| t.display), cwd.as_deref())
    }
}

// ---------------------------------------------------------------------------
// 전송 — 채널마다 갈리는 것은 여기 `match` 한 곳씩(새 전송이 채울 칸을 컴파일러가 센다)
// ---------------------------------------------------------------------------

/// 전송이 있는 채널 — 시작([`start`])은 이것만 띄우고, op 는 그 밖의 채널을 `[unsupported]` 로 거절한다.
const CHANNELS: &[Channel] = &[Channel::Telegram, Channel::Discord];

fn has_transport(chan: Channel) -> bool {
    CHANNELS.contains(&chan)
}

/// 채널의 봇 토큰 — 감싸개는 채널마다(`Debug` 는 가린 글자 · `Display` 없음).
#[derive(Clone, PartialEq, Eq)]
enum Token {
    Telegram(tg::BotToken),
    Discord(dc::BotToken),
}

impl Token {
    /// 비밀 파일의 몸.
    fn as_file(&self) -> &str {
        match self {
            Token::Telegram(t) => t.as_str(),
            Token::Discord(t) => t.as_str(),
        }
    }

    fn telegram(&self) -> Option<&tg::BotToken> {
        match self {
            Token::Telegram(t) => Some(t),
            Token::Discord(_) => None,
        }
    }

    fn discord(&self) -> Option<&dc::BotToken> {
        match self {
            Token::Discord(t) => Some(t),
            Token::Telegram(_) => None,
        }
    }
}

/// 누름을 받았다고 채널에 알릴 손잡이(Telegram: 콜백 질의 id · Discord: 앱 id + 그 누름의 콜백 토큰). 받기만 하고 로그에 싣지 않는다.
pub(crate) enum Ack {
    Telegram(String),
    Discord(dc::Ack),
}

/// 받은 글 하나 — 채널 중립(전송이 지은 것). **`Debug` 없음**(본문).
pub(crate) struct Incoming {
    pub message_id: i64,
    /// 보낸 사람 id(없을 수 있다)
    pub from_id: Option<i64>,
    /// 보낸 사람 표시 이름(짝짓기 확인 화면에만) — 제어 글자를 걷고 64자
    pub from_name: String,
    pub chat_id: i64,
    /// 1:1 대화방
    pub private: bool,
    /// 보낸 시각(유닉스 초)
    pub date: i64,
    pub text: Option<String>,
    /// 답장이면 그 대상 메시지 id
    pub reply_to: Option<i64>,
}

/// 단추 누름 하나 — 채널 중립. **`Debug` 없음**.
pub(crate) struct ButtonPress {
    pub from_id: i64,
    /// 단추가 달린 메시지의 대화방 · id(모르면 `None`)
    pub chat_id: Option<i64>,
    pub message_id: Option<i64>,
    pub data: Option<String>,
    pub ack: Ack,
}

/// 코어가 보내는 글 — 채널 서식은 전송이 짓는다.
pub(crate) enum Text {
    /// 평문 — 굵은 머리 줄(있으면) + 몸. 나누기 · 상한은 코어가 맞췄다(답 전문은 [`split_answer`]).
    Lines { head: Option<String>, body: String },
    /// 그 채널로 **이미 그린** 글(알림 — `messenger.rs` · 시험 한 통)과 덧붙일 평문 한 줄(있으면). 전송이 상한 안으로 자른다.
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

/// 그 채널의 짝 파일 이름.
fn chat_file(chan: Channel) -> Option<&'static str> {
    match chan {
        Channel::Telegram => Some(CHAT_FILE),
        Channel::Discord => Some(DISCORD_CHAT_FILE),
        Channel::Slack => None,
    }
}

/// 붙여 넣은 글자 → 그 채널의 토큰(모양만).
fn parse_token(chan: Channel, raw: &str) -> Option<Token> {
    match chan {
        Channel::Telegram => tg::parse_token(raw).map(Token::Telegram),
        Channel::Discord => dc::parse_token(raw).map(Token::Discord),
        Channel::Slack => None,
    }
}

/// **그 채널의 다리가 켜져 있나**(`[messenger]` 의 채널 칸 — 글마다 · 누름마다 다시 읽는다).
fn chat_enabled(chan: Channel, p: &MessengerPrefs) -> bool {
    match chan {
        Channel::Telegram => p.telegram_chat == Some(true),
        Channel::Discord => p.discord_chat == Some(true),
        Channel::Slack => false,
    }
}

/// 단추 데이터 상한(바이트).
fn data_max(chan: Channel) -> usize {
    match chan {
        Channel::Telegram => tg::DATA_MAX,
        Channel::Discord => dc::DATA_MAX,
        Channel::Slack => 0,
    }
}

/// 답 전문을 그 채널의 한 통 상한 · 통 수로 나눈다(첫 통은 굵은 머리 줄 `head` 와 함께 간다).
fn split_answer(chan: Channel, head: &str, body: &str, more: &str) -> Vec<String> {
    match chan {
        Channel::Telegram => tg::split_answer(head, body, more),
        Channel::Discord => dc::split_answer(head, body, more),
        Channel::Slack => Vec::new(),
    }
}

/// 받기 고리를 띄운다(세대 `gen` — 바뀌면 고리가 스스로 끝난다).
fn spawn_loop(chan: Channel, rt: &tokio::runtime::Handle, gen: u64) -> Option<tokio::task::JoinHandle<()>> {
    match chan {
        Channel::Telegram => Some(rt.spawn(tg::poll_loop(gen))),
        Channel::Discord => Some(rt.spawn(dc::gateway_loop(gen))),
        Channel::Slack => None,
    }
}

/// 한 통 — 보낸 메시지 id(실패면 `None` — 전송이 로그 한 줄, 본문 없음).
async fn transport_send(chan: Channel, chat: i64, t: &Text, reply_to: Option<i64>, buttons: &[Button]) -> Option<i64> {
    match chan {
        Channel::Telegram => tg::send(chat, t, reply_to, buttons).await,
        Channel::Discord => dc::send(chat, t, reply_to, buttons).await,
        Channel::Slack => None,
    }
}

/// 보낸 통을 바꿔 쓴다(단추는 걷힌다).
async fn edit(chan: Channel, chat: i64, message_id: i64, t: &Text) {
    match chan {
        Channel::Telegram => tg::edit(chat, message_id, t).await,
        Channel::Discord => dc::edit(chat, message_id, t).await,
        Channel::Slack => {}
    }
}

/// 누름을 마친다 — `toast` 는 누른 사람에게만 보이는 짧은 글(있으면) · `rewritten` 은 곧이어 그 통을 결과 글로 바꿔 쓰는가(Telegram 은 늘
/// 띄우고, Discord 는 누름을 받을 때 이미 알렸으니 바꿔 쓰지 않을 때만 후속 글로 — `dc::finish_press`).
async fn finish_press(p: &ButtonPress, toast: Option<&str>, rewritten: bool) {
    match &p.ack {
        Ack::Telegram(id) => tg::finish_press(id, toast).await,
        Ack::Discord(a) => dc::finish_press(a, toast, rewritten).await,
    }
}

/// 토큰 확인 → 봇 이름. 실패는 이유 코드가 붙은 문구(토큰 없음).
async fn check_token(client: &reqwest::Client, cfg: &Config, token: &Token) -> Result<Option<String>, String> {
    match token {
        Token::Telegram(t) => tg::check_token(client, cfg, t).await,
        Token::Discord(t) => dc::check_token(client, cfg, t).await,
    }
}

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

/// 받기 고리의 상태 — 상태 op 의 `link`.
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

/// 채널 하나의 상태(계정 하나).
#[derive(Default)]
struct Chan {
    /// 고리 세대 — 다시 시작하면 올라가고, 옛 고리는 다음 바퀴에서 스스로 끝난다.
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
    /// 다리가 돌보는 스트림(2단계 — 권한 카드의 보는 쪽)
    tending: Tending,
    /// 다리가 단추 통을 보낸 카드(요청 id → 스트림 · 회차 · 메시지 id)
    cards: Cards,
}

impl Chan {
    /// 짝 · 봇이 바뀌었다 — 그 대화방에 걸린 것을 모두 잊는다.
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
    /// 스트림 → 프런트가 미리 알린 마지막 이름표(채널과 상관없다)
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

/// 사건 몸 = 바뀐 것 한 낱말 + 채널 한 낱말(`telegram` · `discord` — 3b · 중계해도 되는 고정 글자뿐).
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

/// 파일에서 토큰을 읽는다(없거나 모양이 틀리면 `None`). **이 모듈만 부른다**(머리말).
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

/// 서버가 뜰 때(`serve::run` — 런타임 안에서) 한 번 — 런타임 손잡이를 쥐고, 채널마다 파일의 토큰 · 짝을 읽고, 토큰이 있으면 고리를 띄운다.
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
        restart(chan);
    }
}

/// 그 채널의 고리를 다시 띄운다(토큰이 없으면 멈춘다).
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

/// 그 채널의 이 세대가 아직 살아 있으면 보낼 손(클라이언트 · 설정 · 토큰) — 전송이 부른다.
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

/// 한 통 보낸다 — 보낸 메시지 id. `stream` 이 있으면 그 채널의 "id → 스트림" 에 적는다.
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

/// 글 하나. 지난 글이면 그 대화방 id 를 돌려준다(전송이 묶음 끝에 한 통으로 알린다).
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

/// 짝이 없을 때 1:1 대화방에서 온 글 — 짝짓기.
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

/// 그 타일의 이름표 — 프런트가 미리 알린 마지막 것(op `messenger_bot_label`), 없으면 `<CLI 표시 이름> · <기록된 cwd 끝 폴더>`(대화 색인을 읽으므로
/// 블로킹 풀에서).
async fn label_of(cfg: &Config, stream: &str) -> String {
    if let Some(l) = state().labels.get(stream).cloned() {
        return l;
    }
    let env = cfg.env.clone();
    let s = stream.to_string();
    blocking(move || env.fallback_label(&s)).await.unwrap_or_else(|| stream.to_string())
}

/// 짝지은 사람의 글 — 걷기 → 다리 켜짐 → 라우팅 → 넣기.
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
    // 기다리는 타일 · 기다리지 않는 타일의 까닭(답장이 아닐 때만 — 까닭은 "없다" 답장의 줄이 된다)
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

/// 고르기 단추 글자 — 이름표가 겹치는 것만 대화 제목을 읽어(블로킹 풀) `logic::pick_labels` 로 푼다.
async fn pick_labels_of(cfg: &Config, streams: &[String]) -> Vec<String> {
    let mut labels = Vec::new();
    for st in streams {
        labels.push(label_of(cfg, st).await);
    }
    let mut items: Vec<(String, Option<String>)> = Vec::new();
    for (i, st) in streams.iter().enumerate() {
        let title = if labels.iter().filter(|l| **l == labels[i]).count() > 1 {
            let env = cfg.env.clone();
            let s = st.clone();
            blocking(move || env.title(&s)).await.flatten()
        } else {
            None
        };
        items.push((labels[i].clone(), title));
    }
    logic::pick_labels(&items)
}

/// 단추 누름(전송이 부르는 입구).
async fn on_press(chan: Channel, cfg: &Arc<Config>, p: ButtonPress) {
    let paired = state().chan(chan).paired.clone();
    let Some(pd) = paired.filter(|x| x.user_id == p.from_id && p.chat_id.is_none_or(|ch| ch == x.chat_id)) else {
        return;
    };
    // 2단계 — 권한 카드의 [허용] · [거절]
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

/// 문지기를 다시 보고(그 순간의 재료) 넣는다 — 결과를 답장(`edit` 이면 그 단추 통을 바꿔 쓴다). `shown` 은 고르기 단추에 보였던 글자(있으면 `→` 줄도 그 글자).
#[allow(clippy::too_many_arguments)]
async fn deliver(chan: Channel, cfg: &Arc<Config>, chat: i64, source: i64, stream: &str, text: &str, edit_id: Option<i64>, shown: Option<String>) {
    let result = inject(chan, cfg, stream, text).await;
    let line = match result {
        Ok(()) => {
            let label = match shown {
                Some(l) => l,
                None => label_of(cfg, stream).await,
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

/// **넣기 함수 하나** — 문지기 → 붙여넣기 → 잠깐 → (세션이 그대로면) Enter → 다리 턴 표시. 쓰는 바이트는 [`logic::paste_bytes`] 와 `\r` 뿐이다.
async fn inject(chan: Channel, cfg: &Arc<Config>, stream: &str, text: &str) -> Result<(), Refusal> {
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
    // 다리 턴은 붙여넣기 뒤에 곧바로 — Enter 와 첫 신호 사이에 틈이 없게. 다리 턴인 동안 그 채널이 그 스트림을 돌본다(권한 카드의 보는 쪽 — 2단계).
    {
        let mut s = state();
        let c = s.chan(chan);
        c.turns.begin(stream, now_ms());
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

/// 다리 턴에 닿는 신호의 갈래.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TurnEvent {
    /// 알리는 완료(`stop` + `notify`)
    Done,
    /// 권한 물음
    Asked,
    /// 사람이 끊었다 · CLI 가 끝났다
    Gone,
}

/// 신호 평면이 표를 갱신한 **뒤에** 부른다(`server::tile_permission::forward_signal` — HTTP 스레드). 잠금 · 비교뿐 — 보내기는 런타임 태스크로.
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

/// [`on_signal`] 의 몸(시험이 곧장 부른다) — 채널마다 자기 다리 턴 · 돌봄을 본다(답은 그 턴을 연 채널로만).
pub(crate) fn on_turn_event(stream: &str, ev: TurnEvent, cli: Option<&'static str>, convo: Option<String>) {
    let mut s = state();
    let now = now_ms();
    // (채널, 물음 번호, 대화방)
    let mut jobs: Vec<(Channel, Option<u64>, i64)> = Vec::new();
    for &chan in CHANNELS {
        let Some(c) = s.chans.get_mut(&chan) else { continue };
        // 턴이 끝났다 · 끊겼다 — 돌봄을 걷는다(다리 턴이든 단추 달린 알림이든)
        let ask_seq = match ev {
            TurnEvent::Done => {
                c.tending.untend(stream);
                if !c.turns.end(stream, now) {
                    continue;
                }
                None
            }
            // 다리 턴의 권한 물음 — 카드가 선 물음은 카드의 단추 통이 맡는다(한 물음에 한 통). 카드가 이미 섰으면 보내지 않고, 아니면 틈을 두고 다시 본다.
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
            jobs.push((chan, ask_seq, p.chat_id));
        }
    }
    let (Some(rt), Some(cfg)) = (s.rt.clone(), s.cfg.clone()) else { return };
    drop(s);
    for (chan, ask_seq, chat) in jobs {
        let stream = stream.to_string();
        let cfg = cfg.clone();
        let convo = convo.clone();
        rt.spawn(async move {
            match (ev, ask_seq) {
                (TurnEvent::Done, _) => send_answer(chan, &cfg, chat, &stream, cli, convo).await,
                (TurnEvent::Asked, Some(seq)) => {
                    tokio::time::sleep(cfg.ask_grace).await;
                    // 그 사이 카드가 서지 않았고 이 턴의 첫 물음 알림일 때만(1a 그대로 — 턴당 한 번)
                    let go = {
                        let mut s = state();
                        let c = s.chan(chan);
                        c.tending.fire(&stream, seq) && c.turns.first_ask(&stream)
                    };
                    if go {
                        let label = label_of(&cfg, &stream).await;
                        let t = tr!(ko: "🟡 확인 필요 · {label} — 앱에서 답하세요", en: "🟡 Needs action · {label} — answer in the app");
                        send_plain_text(chan, chat, &t, None, Some(&stream)).await;
                    }
                }
                _ => {}
            }
        });
    }
}

// ---------------------------------------------------------------------------
// 2단계 — 타일 권한 카드에 단추로 답한다
// ---------------------------------------------------------------------------

/// 다리가 그 스트림을 돌보나(어느 채널이든) — `server::tile_permission` 의 "보는 창" 이 다리 표지를 덧붙일지(잠금 하나 · 비교뿐).
pub(crate) fn tends(stream: &str) -> bool {
    state().chans.values().any(|c| c.tending.tends(stream))
}

/// 대화 면 [중지](op `agent_state_interrupt` — 신호 평면을 지나지 않는다) — 모든 채널의 돌봄만 걷는다(다리 턴의 답은 1a 그대로 다음 `stop` 에).
pub(crate) fn untend(stream: &str) {
    for c in state().chans.values_mut() {
        c.tending.untend(stream);
    }
}

/// 카드 사건 한 장에서 뽑은 것(본문은 요약 한 줄로만 — `Debug` 없음).
enum CardJob {
    /// 돌보는 스트림에 카드가 섰다 — 단추 통(권한) · "앱에서 답하세요"(질문)
    Request { id: String, stream: String, question: bool, tool: String, summary: String },
    /// 단추 통을 결과 한 줄로 바꿔 쓴다
    Rewrite { message_id: i64, label: String, reason: String },
}

/// **카드 사건 → 다리**(`server::tile_permission::emit` 끝 — 카드 표 잠금 밖 · 그 스레드를 붙들지 않는다). 판정 · 표 갱신만 하고 보내기는 런타임 태스크로.
/// 그 스트림을 돌보는 채널마다 한 통. `auto`(세션 허용) · `tui` 는 보지 않는다.
pub(crate) fn on_card_events(evs: &[crate::tile_permission::Ev]) {
    // 요약은 잠금 밖에서 먼저(도구 입력 본문은 여기서 한 줄로 줄고 그 밖으로 나가지 않는다)
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
    // (채널, 대화방, 할 일)
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
                // 권한 카드는 보내기 전에 표에 연다 — 보내는 사이의 `gone` · 알림 길(`notify`)의 중복을 이 표가 막는다
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

/// 단추 통을 결과 한 줄로(단추는 걷힌다).
async fn rewrite(chan: Channel, chat: i64, message_id: i64, label: &str, line: &str) {
    edit(chan, chat, message_id, &Text::plain(logic::result_text(label, line))).await;
}

/// 그 채널의 다리가 지금 켜져 있나(설정 파일 — 블로킹 풀).
async fn chat_on(chan: Channel, cfg: &Config) -> bool {
    let env = cfg.env.clone();
    blocking(move || chat_enabled(chan, &env.prefs())).await.unwrap_or(false)
}

/// 단추 통을 보낸 뒤 — 표에 메시지 id 를 적고, 보내는 사이 풀렸으면 곧바로 바꿔 쓴다.
async fn after_card_sent(chan: Channel, chat: i64, id: &str, message_id: Option<i64>, label: &str) {
    let rewrite_now = state().chan(chan).cards.sent(id, message_id, label);
    if let Some((mid, label, reason)) = rewrite_now {
        rewrite(chan, chat, mid, &label, &logic::gone_text(&reason)).await;
    }
}

/// 돌보는 스트림의 카드 하나 — 권한 카드 · 켜져 있으면 단추 통, 그 밖(질문 카드 · 꺼짐)은 "앱에서 답하세요" 를 이 돌봄에 한 번.
#[allow(clippy::too_many_arguments)]
async fn card_request(chan: Channel, cfg: &Arc<Config>, chat: i64, id: &str, stream: &str, question: bool, tool: &str, summary: &str) {
    let on = !question && chat_on(chan, cfg).await;
    let label = label_of(cfg, stream).await;
    if on {
        let mid = send(chan, chat, &Text::plain(logic::card_text(&label, tool, summary)), None, &logic::card_buttons(id), Some(stream)).await;
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
        send_plain_text(chan, chat, &t, None, Some(stream)).await;
    }
}

/// 카드 단추 누름(짝지은 계정은 지났다) — 그 채널이 보낸 카드인가 → 그 채널의 다리가 지금 켜져 있나 → 결정(`server::tile_permission` 의 다리용
/// 함수 하나 — 훅 응답으로만 간다) → 통을 결과 글로. 결정 함수는 다리 잠금을 쥐지 않은 채 블로킹 풀에서 부른다(카드 표 잠금 · 깨움 · 사건).
async fn on_card_press(chan: Channel, cfg: &Arc<Config>, chat: i64, p: &ButtonPress, allow: bool, id: &str) {
    // 설정을 먼저 읽는다 — 잡은 뒤 기다리는 동안 다른 곳의 `gone` 을 놓치지 않게(잡은 카드의 `gone` 은 다리가 바꿔 쓰는 몫이라 건너뛴다)
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

/// 다리 턴의 답 글 — **다 쓰인 뒤의 것**(실기 후속 2026-11-19). `stop` 신호가 CLI 의 마지막 글 줄 쓰기보다 먼저 닿으면 첫 읽기는 비거나
/// (`None`) 도구 앞의 글이다. 그래서 [`Config::answer_poll`] 마다 다시 읽어 **글이 있고 파일 크기가 직전 읽기와 같을 때** 그 글을 쓴다. 시한은
/// 둘이다 — 글을 처음 가진 때부터 [`Config::answer_deadline`] 이면 그때 가진 글, 글이 아직 없으면 부른 때부터 [`Config::answer_wait`] 까지
/// 기다리고 그때 `None`(CLI 가 몇 초 멈춘 드문 턴 — 실기 11-19 훅 소요 9.5초). 스트림 · 대화 id 는 부를 때 받은 것 그대로 — 그 사이 새 다리
/// 턴이 서도 이 답은 이 대화의 것이다.
async fn settled_answer(cfg: &Arc<Config>, cli: &'static str, convo: Option<String>) -> Option<String> {
    let read = |convo: Option<String>| {
        let env = cfg.env.clone();
        async move { blocking(move || env.answer(cli, convo.as_deref())).await.unwrap_or((None, None)) }
    };
    let start = tokio::time::Instant::now();
    let mut last = read(convo.clone()).await;
    // 글을 처음 가진 때
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

/// 다리 턴의 답 — 대화 파일의 마지막 답 **전문**(채널의 한 통 상한씩 · 최대 통 수 · 그 뒤 "앱에서 전체 보기" — [`split_answer`]).
async fn send_answer(chan: Channel, cfg: &Arc<Config>, chat: i64, stream: &str, cli: Option<&'static str>, convo: Option<String>) {
    let label = label_of(cfg, stream).await;
    let text = match cli {
        Some(cli) => settled_answer(cfg, cli, convo).await,
        None => None,
    };
    let head = format!("🟢 {label}");
    let Some(text) = text.filter(|t| !t.trim().is_empty()) else {
        let t = tr!(ko: "턴이 끝났습니다 (답을 읽지 못했습니다)", en: "The turn ended (could not read the reply)");
        send(chan, chat, &Text::headed(head, t), None, &[], Some(stream)).await;
        return;
    };
    let more = tr!(ko: "… (앱에서 전체 보기)", en: "… (see the full reply in the app)");
    for (i, part) in split_answer(chan, &head, &text, &more).into_iter().enumerate() {
        let t = if i == 0 { Text::headed(head.clone(), part) } else { Text::plain(part) };
        send(chan, chat, &t, None, &[], Some(stream)).await;
    }
}

// ---------------------------------------------------------------------------
// 알림 — 다른 길(프런트 · 서버 안 `send_plain`)의 다리 채널 몫
// ---------------------------------------------------------------------------

/// 알림 한 통의 다리 채널 몫 — 그 채널로 그려 둔 글(`messenger::Channel::render`)과 (있으면) 그 타일 · 종류 · 이름표 · 채널(없으면 Telegram).
/// `Debug` 없음(본문).
#[derive(serde::Serialize, Deserialize)]
pub(crate) struct Notice {
    pub text: String,
    #[serde(default)]
    pub stream: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// 알림의 이름 — **다리는 쓰지 않는다**(2026-11-19 — 다리 이름표는 op `messenger_bot_label` 하나로만 · 와이어 모양은 그대로 둔다).
    #[serde(default)]
    pub label: Option<String>,
    /// 어느 다리 채널로(3a — 없으면 Telegram · 없을 때는 와이어에 싣지 않는다)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<Channel>,
    /// 그려 둔 글이 이미 "묻는 도구" 줄을 싣고 있다(대화 글자 싣기 — `messenger` 의 `ConvoLine::PendingTool`). 참이면 단추를 달 때 그 줄을 다시
    /// 덧붙이지 않는다(실기 2026-11-19 — 같은 줄이 두 번 나왔다).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_tool: bool,
}

/// 프런트가 미리 알린 다리 이름표(`<CLI 표시 이름> · <프로젝트 / 워크트리 | 폴더 끝 이름>`)를 적는다 — op `messenger_bot_label` 만 부른다.
/// 걸러내기: 스트림 모양(`tile_env::stream_ok`) · 제어 글자 제거 · 120자. 비면 적지 않는다.
fn remember_label(s: &mut State, stream: &str, label: &str) {
    if !crate::tile_env::stream_ok(stream) {
        return;
    }
    let l: String = label.chars().filter(|c| !c.is_control()).take(120).collect();
    if !l.trim().is_empty() {
        s.labels.insert(stream.to_string(), l);
    }
}

/// 그 채널의 짝지은 대화방으로 한 통. 전송 · 봇 · 짝이 없으면 조용히 건너뛴다. 그 채널의 다리 턴의 같은 알림(턴 끝 · 권한 물음)은 다리가 이미
/// 보냈으니 건너뛴다.
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
        // `n.label`(알림의 이름 — 프로젝트 / 워크트리 · 탭 제목)은 적지 않는다: 다리 이름표는 `messenger_bot_label` 하나로만 적는다(2026-11-19 —
        // 알림의 이름이 다리 이름표를 덮어쓰면 안 된다).
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
    // 2단계 — 다리 턴이 아닌 턴의 권한 알림: 그 스트림에 권한 카드가 서 있고 켜져 있으면 단추를 단다(그 뒤 그 턴은 다리가 돌본다)
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

/// 카드 한 장의 단추 재료 — (요청 id, 회차, 도구, 요약).
type CardBrief = (String, u64, String, String);

fn brief(card: &Value) -> Option<CardBrief> {
    let id = card.get("requestId")?.as_str()?.to_string();
    let epoch = card.get("sessionEpoch")?.as_u64()?;
    let tool = card.get("tool").and_then(Value::as_str).unwrap_or("").to_string();
    let summary = logic::card_summary(&tool, card.get("input").unwrap_or(&Value::Null));
    Some((id, epoch, tool, summary))
}

/// 권한 알림에 단추를 달까 — `None` 이면 지금처럼 글만. 서 있는 권한 카드(질문 빼고) 가운데 그 채널에 아직 단추 통이 없는 것: 가장 오래된 것은 이
/// 알림 글에 단추를 달고, 나머지는 각각 단추 통으로. 스트림을 돌보는 중으로 적는 것은 **보내기 전** — 그때부터 다리 표지가 "보는 창" 에 있어야 누름이
/// 먹는다. 서 있는 카드마다 이미 단추 통이 나갔으면 같은 물음의 알림은 보내지 않는다(`Some(Ok)`). 카드 표 · 다리 잠금은 차례로(겹쳐 쥐지 않는다).
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
    let label = label_of(&cfg, stream).await;
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

/// op 몸의 `channel`(없으면 Telegram — 3a 의 와이어는 그대로) — 전송이 없는 채널은 `[unsupported]`.
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

/// 그 채널의 봇이 등록돼 있나(서버 안의 `messenger::messenger_status` — 잠금 하나 · 비교뿐).
pub(crate) fn configured(chan: Channel) -> bool {
    state().chans.get(&chan).is_some_and(|c| c.token.is_some())
}

/// 그 채널의 상태 — 토큰 없음.
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

/// op 하나 — 블로킹 없음(파일 쓰기는 블로킹 풀). 몸(토큰 · 본문)은 로그에 남기지 않는다. 몸의 `channel` 은 [`channel_of`].
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
        // 이름표 미리 알리기(실기 후속 2026-11-19) — 적기만 한다(아무것도 보내지 않는다 · 채널과 상관없다). 다리 이름표를 적는 길은 이것 하나다.
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

/// 토큰 등록(전송이 확인 — Telegram `getMe`) · 해제(짝도 함께 지운다) → 그 채널의 고리 다시 시작.
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
    restart(chan);
    emit("token", chan);
    log::line("messenger bridge — bot token registered");
    Ok(status(chan))
}

/// 대기 중인 짝짓기 허용 · 거절(코드가 지금 대기의 것이어야).
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
    let t = tr!(
        ko: "연결됐습니다 — 알림이 이 대화방으로 옵니다. 알림에 답장하면 그 타일로 갑니다(설정에서 켠 경우).",
        en: "Connected — notifications will come to this chat. Reply to a notification to send it to that tile (when enabled in settings).",
    );
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
    emit("paired", chan);
    log::line("messenger bridge — unpaired");
    Ok(())
}
