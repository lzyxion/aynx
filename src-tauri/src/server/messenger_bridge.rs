//! **메신저 다리 — 세션 서버 쪽**(2026-11-18 · 1a · 계획 docs/log/2026-11-18-messenger-bridge.md). 폰의 Telegram 에서 로컬 AI 타일(Claude Code ·
//! Codex)에 글을 보내고, 그 턴이 끝나면 답을 같은 대화방으로 받는다. 순수 판정은 [`logic`], Telegram 글자 · JSON 은 `crate::telegram`.
//!
//! ```text
//! Telegram ──getUpdates(롱폴)──▶ 고리 ──▶ 보낸 이 문지기 ──▶ 라우팅 ──▶ 넣기 문지기 ──▶ 넣기 함수 하나(붙여넣기 + Enter)
//!    ▲                                                                                    │
//!    └──sendMessage── 답 보내기 ◀── agent-signal `stop`(notify) · 다리 턴 ◀────────────────┘
//! ```
//!
//! ## 불변식
//!
//! - **봇 토큰을 읽는 것은 세션 서버뿐이다** — `<설정 루트>/telegram-bot` 은 이 파일만 읽고 쓴다(GUI 는 등록 때 op `messenger_bot_set_token` 몸으로
//!   넘길 뿐 · 시험 `gui_never_reads_the_token_file`). 토큰 · 받은 글 · 대화 글자는 로그 · `Debug` · 오류 문구 · 서버 사건 · op 답에 없다 —
//!   로그에는 고정 글자 · 수만, `reqwest` 오류는 `without_url()` 도 거치지 않고 아예 문구로 만들지 않는다(종류만).
//! - **받는 글**: 1:1 대화방 · 짝지은 사용자 id 와 대화방 id 가 둘 다 맞는 것만(`logic::classify`). 그 밖은 조용히 버린다. 짝이 없을 때만 짝짓기 —
//!   6자리 코드(`remote::auth::six_digits` — 원격 기기 페어링과 같은 난수 출처) · 대기 하나 · 10분 · 계정당 30초에 한 번 답. [허용]은 Tauri
//!   명령 `messenger_bot_pair`(HOME_ONLY)뿐이다.
//! - **지난 글은 실행하지 않는다**: 보낸 지 120초가 넘은 글은 넣지 않고 "보내지 않았습니다" 한 통.
//! - **넣기 문지기**(`logic::gate` — 전부 참이어야): 다리가 켜짐(`[messenger] telegram_chat` 을 글마다 다시 읽는다) · 살아 있는 **로컬** 세션 ·
//!   `agent_state` 항목이 있고(**없으면 무조건 거절** — CLI 가 끝난 셸에 글이 가면 셸 명령이 된다) CLI 가 claude · codex · 턴이 한 번 이상 끝났고
//!   지금 끝나 입력을 기다림(메인 멈춤 · 서브 에이전트 0) · 권한 카드 · 질문이 없음 · 서버 해석기의 괄호 붙여넣기 모드가 켜짐 · 입력 줄에 치다 만 글이
//!   없음. 원격(SSH) 타일은 1단계에서 거절한다.
//! - **서버 안에서 PTY 에 쓰는 길은 둘뿐이다** — 세션 op `write`(창 · `server::sessions::dispatch`)와 이 파일의 [`RealEnv::write_pty`] 하나(시험
//!   `pty_writes_have_two_sites`). 쓰는 바이트는 늘 `ESC[200~` + 걷은 글 + `ESC[201~` 와 잠깐 뒤의 `\r` 둘뿐이다(프런트 `submitText` 와 같은 틈 200ms ·
//!   그 사이 세션이 바뀌면 Enter 를 버린다). AI 문자열이 이 길에 오르는 일은 없다 — 글은 짝지은 사람의 메신저 글뿐이다.
//! - **다리에는 작업안 승인 · AI 권한 · 위임 · 앨범 · 볼트로 가는 길이 없다** — 승인 등급 프레임을 만들지 않는다(시험 `bridge_has_no_approval_path`).
//! - **2단계(2026-11-19) — 타일 권한 카드(`tile_permission` — 로컬 Claude · Codex)에 단추로 답한다.** 다리는 그 표의 **보는 쪽 하나**다:
//!   - **돌보는 스트림**(`logic::Tending`) = 다리 턴 ∪ 단추 달린 권한 알림을 보낸 스트림 — 그 턴이 끝나면(`stop` · `interrupt` · `session-end`) 걷는다.
//!     돌보는 동안만 `server::tile_permission` 의 "보는 창" 에 다리 표지가 붙는다([`tends`]) — 늘 보는 쪽이면 Codex 의 면 규칙이 깨진다.
//!   - 카드 사건([`on_card_events`] — 카드 표 잠금 밖): 돌보는 스트림의 권한 카드 + `telegram_chat` 켬 → 단추 통(`🟡 확인 필요 · 이름표` / 도구 +
//!     입력 한 줄 요약 300자 / [허용] [거절]) · 질문 카드(또는 꺼짐) → "앱에서 답하세요" 한 통(돌봄마다 한 번) · `gone`(다른 곳에서 풀림) → 그 통을 결과
//!     한 줄로 바꿔 쓴다(단추 걷음) · `auto` · `tui` 는 보지 않는다. 다리 턴의 신호 물음은 카드가 없는 물음에만 1a 의 한 통(틈 `ask_grace` — 한 물음에 한 통).
//!   - 다리 턴이 아닌 턴: 프런트의 권한 알림([`notify`] `kind: "permission"`)이 닿을 때 그 스트림에 권한 카드가 서 있으면 그 글에 단추를 달고 돌본다.
//!   - 누름([`on_callback`] → `on_card_press`): 짝지은 계정 → 다리가 보낸 카드(`logic::Cards`) → `telegram_chat` 이 **지금** 켜짐 →
//!     `server::tile_permission::resolve_from_bridge`(Allow · Deny 둘뿐 — [이 세션 동안 허용] · 사유 · 질문의 답 없음) → 통을 결과 글로. 결정은
//!     **훅 응답으로만** 간다 — PTY 에 쓰지 않고(위의 두 길 그대로) 작업안 승인으로 가는 길도 아니다(시험 `bridge_answers_cards_through_one_function`).
//!   - 잠금 순서: 다리 잠금을 쥔 채 카드 표 · 세션 코어 · 상태 표를 부르지 않는다(값을 꺼내 놓고 부른다). 카드 표 잠금 안에서 다리를 부르지 않는다.
//! - **실기 후속(2026-11-19)** — 다리 이름표 = `<CLI 표시 이름> · <프로젝트 / 워크트리 | 폴더 끝 이름>`(탭 제목 · 타일 이름은 쓰지 않는다). 적는
//!   길은 미리 알리기(op `messenger_bot_label` — 적기만 · [`remember_label`]) 하나 — 알림(`notify`)의 이름은 적지 않는다 · 창이 알리지 않은 타일은
//!   같은 꼴의 대체 이름(`logic::fallback_label`) · "기다리는 타일이 없다" 에 타일별 짧은 까닭(`logic::nowhere_text`) · 겹친 고르기 단추에 대화 제목(`logic::pick_labels`) ·
//!   다리 턴의 답은 대화 파일이 다 쓰인 뒤의 글([`settled_answer`] — 신호가 파일 쓰기보다 빠르다 · 글을 가진 뒤 4초 · 글이 없으면 20초까지).
//! - **방어 기계는 최소** — 롱폴 실패는 고정 5초 물러남(409 = 다른 프로그램이 같은 봇을 받음 · 30초 + 상태 `conflict`) 하나뿐. 재시도 큐 · 놓친 글
//!   재생 · 속도 제한기는 없다.
//! - 신호를 받는 HTTP 스레드(`signal_http::handle`)는 붙들지 않는다 — [`on_signal`] 은 잠금 · 비교뿐이고 보내기는 런타임 태스크로 넘긴다
//!   (서버가 뜰 때 [`start`] 가 쥔 런타임 손잡이 — `server::ai::mcp_route` 의 DB 손과 같은 관례).

pub(crate) mod logic;
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
use crate::session_core::Kind;
use crate::settings::MessengerPrefs;
use crate::telegram::{self, Api, ApiFail, BotToken, Button, UpdateKind};
use logic::{Cards, Clean, Held, PairStep, Pairing, Paired, Press, PressResult, Refusal, Route, Sender, SentMap, Tending, TileView, Turns};

/// 서버 사건 — 몸은 무엇이 바뀌었는지 한 낱말뿐(`{changed}` — 토큰 · 코드 · 이름 없음). 설정 화면이 상태를 다시 읽는다.
pub(crate) const EVENT: &str = "messenger-bot-event";
/// op 오류 코드.
pub(crate) const MESSENGER_BOT: &str = "messenger-bot";
/// 짝지은 계정 파일(설정 루트 바로 아래) — 비밀은 아니지만 토큰과 같은 제외 규칙(다른 PC 로 옮기면 다시 짝짓는다).
pub(crate) const CHAT_FILE: &str = "telegram-chat";

/// `getUpdates` 롱폴 시한(초) · 요청 시한 · 실패 물러남 · 409 물러남 · 붙여넣기와 Enter 사이.
const POLL_TIMEOUT_SECS: u64 = 50;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
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
    pub api: Api,
    /// 비밀 파일 폴더 — `None` 이면 `instance::config_root()`.
    pub dir: Option<PathBuf>,
    pub env: Arc<dyn Env>,
    pub poll_timeout_secs: u64,
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
            api: Api::release(),
            dir: None,
            env: Arc::new(RealEnv),
            poll_timeout_secs: POLL_TIMEOUT_SECS,
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
// 상태
// ---------------------------------------------------------------------------

/// 롱폴의 상태 — 상태 op 의 `link`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Link {
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

struct State {
    cfg: Option<Arc<Config>>,
    rt: Option<tokio::runtime::Handle>,
    client: Option<reqwest::Client>,
    /// 고리 세대 — 다시 시작하면 올라가고, 옛 고리는 다음 바퀴에서 스스로 끝난다.
    gen: u64,
    task: Option<tokio::task::JoinHandle<()>>,
    token: Option<BotToken>,
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
    /// 스트림 → 프런트가 알림에 실어 보낸 마지막 이름표
    labels: HashMap<String, String>,
}

impl State {
    /// 짝 · 봇이 바뀌었다 — 그 대화방에 걸린 것을 모두 잊는다.
    fn forget_chat(&mut self) {
        self.sent.clear();
        self.held = None;
        self.turns.clear();
        self.tending.clear();
        self.cards.clear();
    }
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| {
    Mutex::new(State {
        cfg: None,
        rt: None,
        client: None,
        gen: 0,
        task: None,
        token: None,
        paired: None,
        bot: None,
        link: Link::Off,
        pairing: Pairing::default(),
        sent: SentMap::default(),
        held: None,
        held_seq: 0,
        turns: Turns::default(),
        tending: Tending::default(),
        cards: Cards::default(),
        labels: HashMap::new(),
    })
});

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    crate::agent_signal::now_ms()
}

fn emit(changed: &str) {
    hub::emit(EVENT, json!({ "changed": changed }));
}

fn secret_dir(cfg: &Config) -> Option<PathBuf> {
    cfg.dir.clone().or_else(crate::instance::config_root)
}

fn token_path(cfg: &Config) -> Option<PathBuf> {
    Some(secret_dir(cfg)?.join(crate::messenger::Channel::Telegram.secret_file()))
}

fn chat_path(cfg: &Config) -> Option<PathBuf> {
    Some(secret_dir(cfg)?.join(CHAT_FILE))
}

/// 파일에서 토큰을 읽는다(없거나 모양이 틀리면 `None`). **이 모듈만 부른다**(머리말).
fn load_token(cfg: &Config) -> Option<BotToken> {
    BotToken::parse(&std::fs::read_to_string(token_path(cfg)?).ok()?)
}

fn load_paired(cfg: &Config) -> Option<Paired> {
    serde_json::from_str(&std::fs::read_to_string(chat_path(cfg)?).ok()?).ok()
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

/// 서버가 뜰 때(`serve::run` — 런타임 안에서) 한 번 — 런타임 손잡이를 쥐고, 파일의 토큰 · 짝을 읽고, 토큰이 있으면 고리를 띄운다.
pub(crate) fn start(cfg: Config) {
    let token = load_token(&cfg);
    let paired = load_paired(&cfg);
    let client = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build().ok();
    {
        let mut s = state();
        s.rt = tokio::runtime::Handle::try_current().ok();
        s.cfg = Some(Arc::new(cfg));
        s.client = client;
        s.token = token;
        s.paired = paired;
        s.bot = None;
        s.pairing.clear();
        s.forget_chat();
        s.labels.clear();
    }
    restart();
}

/// 고리를 다시 띄운다(토큰이 없으면 멈춘다).
fn restart() {
    let mut s = state();
    s.gen += 1;
    if let Some(t) = s.task.take() {
        t.abort();
    }
    let gen = s.gen;
    if s.token.is_none() {
        s.link = Link::Off;
        return;
    }
    if let Some(rt) = s.rt.clone() {
        s.task = Some(rt.spawn(poll_loop(gen)));
    }
}

/// 이 세대가 아직 살아 있으면 보낼 손(클라이언트 · 주소 · 토큰 · 설정).
fn hands(gen: Option<u64>) -> Option<(reqwest::Client, Arc<Config>, BotToken)> {
    let s = state();
    if gen.is_some_and(|g| g != s.gen) {
        return None;
    }
    Some((s.client.clone()?, s.cfg.clone()?, s.token.clone()?))
}

fn set_link(gen: u64, link: Link) {
    let changed = {
        let mut s = state();
        if s.gen != gen || s.link == link {
            false
        } else {
            s.link = link;
            true
        }
    };
    if changed {
        emit("link");
    }
}

/// 보내기의 실패 — 문구 없이 종류만(토큰이 든 주소 · 설명 글을 싣지 않는다).
#[derive(Debug, PartialEq, Eq)]
enum CallErr {
    Api(ApiFail),
    Transport,
}

async fn call(client: &reqwest::Client, api: &Api, token: &BotToken, method: &str, body: Value, timeout: Duration) -> Result<Value, CallErr> {
    let res = client
        .post(api.method_url(token, method))
        .timeout(timeout)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| CallErr::Transport)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|_| CallErr::Transport)?;
    telegram::parse_response(status, &text).map_err(CallErr::Api)
}

/// 롱폴 고리 — 세대가 바뀌면 끝난다.
async fn poll_loop(gen: u64) {
    let mut offset: Option<i64> = None;
    loop {
        let Some((client, cfg, token)) = hands(Some(gen)) else { return };
        let body = telegram::get_updates_body(offset, cfg.poll_timeout_secs);
        let wait = Duration::from_secs(cfg.poll_timeout_secs) + Duration::from_secs(10);
        let r = call(&client, &cfg.api, &token, "getUpdates", body, wait.min(REQUEST_TIMEOUT)).await;
        if hands(Some(gen)).is_none() {
            return;
        }
        match r {
            Ok(v) => {
                set_link(gen, Link::Ok);
                let mut stale = 0usize;
                let mut last_chat = None;
                for u in telegram::parse_updates(&v) {
                    offset = Some(u.update_id + 1);
                    match u.kind {
                        UpdateKind::Message(m) => {
                            if let Some(chat) = on_message(&cfg, m).await {
                                stale += 1;
                                last_chat = Some(chat);
                            }
                        }
                        UpdateKind::Callback(c) => on_callback(&cfg, c).await,
                        UpdateKind::Other => {}
                    }
                }
                if let (n @ 1.., Some(chat)) = (stale, last_chat) {
                    let text = tr!(
                        ko: "서버가 꺼져 있던 동안 온 글 {n}개는 타일에 보내지 않았습니다 — 필요하면 다시 보내 주세요",
                        en: "{n} message(s) that arrived while the server was off were not sent to any tile — send again if needed",
                    );
                    send(chat, &telegram::escape_html(&text), None, &[], None).await;
                }
            }
            Err(CallErr::Api(ApiFail::Conflict)) => {
                log::line("messenger bridge — getUpdates conflict (another program uses this bot)");
                set_link(gen, Link::Conflict);
                tokio::time::sleep(cfg.conflict_backoff).await;
            }
            Err(e) => {
                log::line(format!("messenger bridge — getUpdates failed ({})", err_kind(&e)));
                set_link(gen, Link::Error);
                tokio::time::sleep(cfg.backoff).await;
            }
        }
    }
}

fn err_kind(e: &CallErr) -> String {
    match e {
        CallErr::Transport => "transport".into(),
        CallErr::Api(ApiFail::Conflict) => "409".into(),
        CallErr::Api(ApiFail::Unauthorized) => "unauthorized".into(),
        CallErr::Api(ApiFail::Code(c)) => format!("http {c}"),
        CallErr::Api(ApiFail::Malformed) => "malformed".into(),
    }
}

/// 한 통 보낸다 — 보낸 메시지 id(실패면 `None` — 로그 한 줄, 본문 없음). `stream` 이 있으면 "id → 스트림" 에 적는다.
async fn send(chat: i64, html: &str, reply_to: Option<i64>, buttons: &[Button], stream: Option<&str>) -> Option<i64> {
    let (client, cfg, token) = hands(None)?;
    let body = telegram::send_message_body(chat, html, reply_to, buttons);
    match call(&client, &cfg.api, &token, "sendMessage", body, SEND_TIMEOUT).await {
        Ok(v) => {
            let id = telegram::parse_sent_id(&v);
            if let (Some(id), Some(s)) = (id, stream) {
                state().sent.insert(id, s);
            }
            id
        }
        Err(e) => {
            log::line(format!("messenger bridge — sendMessage failed ({})", err_kind(&e)));
            None
        }
    }
}

async fn send_plain_text(chat: i64, text: &str, reply_to: Option<i64>, stream: Option<&str>) -> Option<i64> {
    send(chat, &telegram::escape_html(text), reply_to, &[], stream).await
}

async fn call_quiet(method: &str, body: Value) {
    let Some((client, cfg, token)) = hands(None) else { return };
    if let Err(e) = call(&client, &cfg.api, &token, method, body, SEND_TIMEOUT).await {
        log::line(format!("messenger bridge — {method} failed ({})", err_kind(&e)));
    }
}

// ---------------------------------------------------------------------------
// 받은 글
// ---------------------------------------------------------------------------

/// 글 하나. 지난 글이면 그 대화방 id 를 돌려준다(묶음 끝에 한 통으로 알린다).
async fn on_message(cfg: &Arc<Config>, m: telegram::Incoming) -> Option<i64> {
    let paired = state().paired.clone();
    match logic::classify(paired.as_ref(), m.from_id, m.chat_id, m.private) {
        Sender::Drop => None,
        Sender::Stranger => {
            on_stranger(m).await;
            None
        }
        Sender::Paired => {
            if logic::is_stale(m.date, (now_ms() / 1000) as i64) {
                return Some(m.chat_id);
            }
            on_paired(cfg, m).await;
            None
        }
    }
}

/// 짝이 없을 때 1:1 대화방에서 온 글 — 짝짓기.
async fn on_stranger(m: telegram::Incoming) {
    let Some(user) = m.from_id else { return };
    let step = state().pairing.request(user, m.chat_id, &m.from_name, now_ms(), crate::remote::auth::six_digits);
    match step {
        PairStep::Reply { code, fresh } => {
            if fresh {
                log::line("messenger bridge — pairing requested");
                emit("pairing");
            }
            let text = tr!(
                ko: "연결 코드: {code}\n메인 PC 의 Aynx 설정 화면에 같은 코드가 보이면 [허용]을 누르세요(10분 안).",
                en: "Pairing code: {code}\nIf the same code shows in Aynx settings on the main PC, press [Allow] (within 10 minutes).",
            );
            send_plain_text(m.chat_id, &text, None, None).await;
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
async fn on_paired(cfg: &Arc<Config>, m: telegram::Incoming) {
    let chat = m.chat_id;
    let text = match logic::clean_text(m.text.as_deref().unwrap_or("")) {
        Clean::Text(t) => t,
        Clean::Empty => {
            if m.text.is_none() {
                let t = tr!(ko: "글만 타일에 보낼 수 있습니다", en: "Only text can be sent to a tile");
                send_plain_text(chat, &t, Some(m.message_id), None).await;
            }
            return;
        }
        Clean::TooLong => {
            let max = logic::TEXT_MAX_CHARS;
            let t = tr!(ko: "글이 너무 깁니다 (최대 {max}자)", en: "The message is too long (at most {max} characters)");
            send_plain_text(chat, &t, Some(m.message_id), None).await;
            return;
        }
    };
    let env = cfg.env.clone();
    let enabled = blocking(move || env.prefs().telegram_chat == Some(true)).await.unwrap_or(false);
    if !enabled {
        send_plain_text(chat, &logic::refusal_text(Refusal::Off), Some(m.message_id), None).await;
        return;
    }
    let target = m.reply_to.and_then(|id| state().sent.get(id).map(str::to_string));
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
        Route::To(stream) => deliver(cfg, chat, m.message_id, &stream, &text, None, None).await,
        Route::Nowhere => {
            let mut items = Vec::new();
            for (st, r) in refused.into_iter().filter(|(_, r)| logic::listable(*r)) {
                items.push((label_of(cfg, &st).await, r));
            }
            send_plain_text(chat, &logic::nowhere_text(&items), Some(m.message_id), None).await;
        }
        Route::Choose(streams) => {
            let seq = {
                let mut s = state();
                s.held_seq += 1;
                s.held_seq
            };
            let labels = pick_labels_of(cfg, &streams).await;
            let mut buttons: Vec<Button> = Vec::new();
            for (i, label) in labels.iter().enumerate() {
                let data = logic::pick_data(seq, i);
                if data.len() <= telegram::CALLBACK_DATA_MAX {
                    buttons.push((label.clone(), data));
                }
            }
            let q = tr!(ko: "어느 타일로 보낼까요? (2분)", en: "Which tile should get this? (2 minutes)");
            let id = send(chat, &telegram::escape_html(&q), Some(m.message_id), &buttons, None).await;
            state().held = Some(Held { seq, text, streams, labels, at_ms: now_ms(), message_id: id, source_id: m.message_id });
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

/// 단추 누름.
async fn on_callback(cfg: &Arc<Config>, c: telegram::Callback) {
    let paired = state().paired.clone();
    let Some(p) = paired.filter(|p| p.user_id == c.from_id && c.chat_id.is_none_or(|ch| ch == p.chat_id)) else {
        return;
    };
    // 2단계 — 권한 카드의 [허용] · [거절]
    if let Some((allow, id)) = c.data.as_deref().and_then(logic::parse_card_press) {
        on_card_press(cfg, p.chat_id, &c, allow, &id).await;
        return;
    }
    call_quiet("answerCallbackQuery", telegram::answer_callback_body(&c.id, None)).await;
    let picked = c.data.as_deref().and_then(logic::parse_pick);
    let held = {
        let mut s = state();
        let now = now_ms();
        match (&s.held, picked) {
            (Some(h), Some((seq, i))) if h.seq == seq && now.saturating_sub(h.at_ms) < logic::HOLD_MS && i < h.streams.len() => {
                s.held.take().map(|h| (h, i))
            }
            _ => None,
        }
    };
    let Some((h, i)) = held else {
        if let Some(mid) = c.message_id {
            let t = tr!(ko: "시간이 지났거나 다른 글로 바뀌어 보내지 않았습니다", en: "Expired or replaced — nothing was sent");
            call_quiet("editMessageText", telegram::edit_message_text_body(p.chat_id, mid, &telegram::escape_html(&t))).await;
        }
        return;
    };
    let stream = h.streams[i].clone();
    let shown = h.labels.get(i).cloned();
    deliver(cfg, p.chat_id, h.source_id, &stream, &h.text, h.message_id.or(c.message_id), shown).await;
}

/// 문지기를 다시 보고(그 순간의 재료) 넣는다 — 결과를 답장(`edit` 이면 그 단추 통을 바꿔 쓴다). `shown` 은 고르기 단추에 보였던 글자(있으면 `→` 줄도 그 글자).
async fn deliver(cfg: &Arc<Config>, chat: i64, source: i64, stream: &str, text: &str, edit: Option<i64>, shown: Option<String>) {
    let result = inject(cfg, stream, text).await;
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
    let html = telegram::escape_html(&line);
    match edit {
        Some(mid) => {
            call_quiet("editMessageText", telegram::edit_message_text_body(chat, mid, &html)).await;
            if result.is_ok() {
                state().sent.insert(mid, stream);
            }
        }
        None => {
            send(chat, &html, Some(source), &[], result.is_ok().then_some(stream)).await;
        }
    }
}

/// **넣기 함수 하나** — 문지기 → 붙여넣기 → 잠깐 → (세션이 그대로면) Enter → 다리 턴 표시. 쓰는 바이트는 [`logic::paste_bytes`] 와 `\r` 뿐이다.
async fn inject(cfg: &Arc<Config>, stream: &str, text: &str) -> Result<(), Refusal> {
    let env = cfg.env.clone();
    let s = stream.to_string();
    let checked = blocking(move || {
        let enabled = env.prefs().telegram_chat == Some(true);
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
    // 다리 턴은 붙여넣기 뒤에 곧바로 — Enter 와 첫 신호 사이에 틈이 없게. 다리 턴인 동안 다리가 그 스트림을 돌본다(권한 카드의 보는 쪽 — 2단계).
    {
        let mut s = state();
        s.turns.begin(stream, now_ms());
        s.tending.tend(stream);
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
        s.turns.drop_stream(stream);
        s.tending.untend(stream);
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

/// [`on_signal`] 의 몸(시험이 곧장 부른다).
pub(crate) fn on_turn_event(stream: &str, ev: TurnEvent, cli: Option<&'static str>, convo: Option<String>) {
    let mut s = state();
    let now = now_ms();
    // 턴이 끝났다 · 끊겼다 — 돌봄을 걷는다(다리 턴이든 단추 달린 알림이든)
    let ask_seq = match ev {
        TurnEvent::Done => {
            s.tending.untend(stream);
            if !s.turns.end(stream, now) {
                return;
            }
            None
        }
        // 다리 턴의 권한 물음 — 카드가 선 물음은 카드의 단추 통이 맡는다(한 물음에 한 통). 카드가 이미 섰으면 보내지 않고, 아니면 틈을 두고 다시 본다.
        TurnEvent::Asked => {
            if !s.turns.running(stream) {
                return;
            }
            let open = s.cards.open_on(stream);
            match s.tending.signal(stream, now, open) {
                Some(seq) => Some(seq),
                None => return,
            }
        }
        TurnEvent::Gone => {
            s.turns.drop_stream(stream);
            s.tending.untend(stream);
            return;
        }
    };
    let (Some(rt), Some(cfg), Some(p)) = (s.rt.clone(), s.cfg.clone(), s.paired.clone()) else { return };
    drop(s);
    let stream = stream.to_string();
    rt.spawn(async move {
        match (ev, ask_seq) {
            (TurnEvent::Done, _) => send_answer(&cfg, p.chat_id, &stream, cli, convo).await,
            (TurnEvent::Asked, Some(seq)) => {
                tokio::time::sleep(cfg.ask_grace).await;
                // 그 사이 카드가 서지 않았고 이 턴의 첫 물음 알림일 때만(1a 그대로 — 턴당 한 번)
                let go = {
                    let mut s = state();
                    s.tending.fire(&stream, seq) && s.turns.first_ask(&stream)
                };
                if go {
                    let label = label_of(&cfg, &stream).await;
                    let t = tr!(ko: "🟡 확인 필요 · {label} — 앱에서 답하세요", en: "🟡 Needs action · {label} — answer in the app");
                    send_plain_text(p.chat_id, &t, None, Some(&stream)).await;
                }
            }
            _ => {}
        }
    });
}

// ---------------------------------------------------------------------------
// 2단계 — 타일 권한 카드에 단추로 답한다
// ---------------------------------------------------------------------------

/// 다리가 그 스트림을 돌보나 — `server::tile_permission` 의 "보는 창" 이 다리 표지를 덧붙일지(잠금 하나 · 비교뿐).
pub(crate) fn tends(stream: &str) -> bool {
    state().tending.tends(stream)
}

/// 대화 면 [중지](op `agent_state_interrupt` — 신호 평면을 지나지 않는다) — 돌봄만 걷는다(다리 턴의 답은 1a 그대로 다음 `stop` 에).
pub(crate) fn untend(stream: &str) {
    state().tending.untend(stream);
}

/// 카드 사건 한 장에서 뽑은 것(본문은 요약 한 줄로만 — `Debug` 없음).
enum CardJob {
    /// 돌보는 스트림에 카드가 섰다 — 단추 통(권한) · "앱에서 답하세요"(질문)
    Request { id: String, stream: String, question: bool, tool: String, summary: String },
    /// 단추 통을 결과 한 줄로 바꿔 쓴다
    Rewrite { message_id: i64, label: String, reason: String },
}

/// **카드 사건 → 다리**(`server::tile_permission::emit` 끝 — 카드 표 잠금 밖 · 그 스레드를 붙들지 않는다). 판정 · 표 갱신만 하고 보내기는 런타임 태스크로.
/// `auto`(세션 허용) · `tui` 는 보지 않는다.
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
    let mut jobs = Vec::new();
    let (rt, cfg, chat) = {
        let mut s = state();
        let (Some(rt), Some(cfg), Some(p)) = (s.rt.clone(), s.cfg.clone(), s.paired.clone()) else { return };
        if s.token.is_none() {
            return;
        }
        let now = now_ms();
        for (id, stream, epoch, question, tool, summary) in requests {
            if !s.tending.tends(&stream) {
                continue;
            }
            s.tending.card(&stream, now);
            // 권한 카드는 보내기 전에 표에 연다 — 보내는 사이의 `gone` · 알림 길(`notify`)의 중복을 이 표가 막는다
            if !question && !s.cards.open(&id, &stream, epoch) {
                continue;
            }
            jobs.push(CardJob::Request { id, stream, question, tool, summary });
        }
        for ev in evs {
            if ev.body.get("t").and_then(Value::as_str) != Some("gone") {
                continue;
            }
            let (Some(id), Some(reason)) = (ev.body.get("requestId").and_then(Value::as_str), ev.body.get("reason").and_then(Value::as_str)) else {
                continue;
            };
            if let Some((message_id, label, reason)) = s.cards.gone(id, reason) {
                jobs.push(CardJob::Rewrite { message_id, label, reason });
            }
        }
        (rt, cfg, p.chat_id)
    };
    if jobs.is_empty() {
        return;
    }
    rt.spawn(async move {
        for job in jobs {
            match job {
                CardJob::Request { id, stream, question, tool, summary } => card_request(&cfg, chat, &id, &stream, question, &tool, &summary).await,
                CardJob::Rewrite { message_id, label, reason } => rewrite(chat, message_id, &label, &logic::gone_text(&reason)).await,
            }
        }
    });
}

/// 단추 통을 결과 한 줄로(단추는 걷힌다 — `editMessageText` 에 `reply_markup` 이 없다).
async fn rewrite(chat: i64, message_id: i64, label: &str, line: &str) {
    call_quiet("editMessageText", telegram::edit_message_text_body(chat, message_id, &logic::result_html(label, line))).await;
}

/// `telegram_chat` 이 지금 켜져 있나(설정 파일 — 블로킹 풀).
async fn chat_on(cfg: &Config) -> bool {
    let env = cfg.env.clone();
    blocking(move || env.prefs().telegram_chat == Some(true)).await.unwrap_or(false)
}

/// 단추 통을 보낸 뒤 — 표에 메시지 id 를 적고, 보내는 사이 풀렸으면 곧바로 바꿔 쓴다.
async fn after_card_sent(chat: i64, id: &str, message_id: Option<i64>, label: &str) {
    let rewrite_now = state().cards.sent(id, message_id, label);
    if let Some((mid, label, reason)) = rewrite_now {
        rewrite(chat, mid, &label, &logic::gone_text(&reason)).await;
    }
}

/// 돌보는 스트림의 카드 하나 — 권한 카드 · 켜져 있으면 단추 통, 그 밖(질문 카드 · 꺼짐)은 "앱에서 답하세요" 를 이 돌봄에 한 번.
async fn card_request(cfg: &Arc<Config>, chat: i64, id: &str, stream: &str, question: bool, tool: &str, summary: &str) {
    let on = !question && chat_on(cfg).await;
    let label = label_of(cfg, stream).await;
    if on {
        let mid = send(chat, &logic::card_html(&label, tool, summary), None, &logic::card_buttons(id), Some(stream)).await;
        after_card_sent(chat, id, mid, &label).await;
        return;
    }
    let note = {
        let mut s = state();
        if !question {
            s.cards.forget(id);
        }
        s.tending.note_once(stream)
    };
    if note {
        let t = tr!(ko: "🟡 확인 필요 · {label} — 앱에서 답하세요", en: "🟡 Needs action · {label} — answer in the app");
        send_plain_text(chat, &t, None, Some(stream)).await;
    }
}

/// 카드 단추 누름(짝지은 계정은 지났다) — 다리가 보낸 카드인가 → `telegram_chat` 이 지금 켜져 있나 → 결정(`server::tile_permission` 의 다리용 함수
/// 하나 — 훅 응답으로만 간다) → 통을 결과 글로. 결정 함수는 다리 잠금을 쥐지 않은 채 블로킹 풀에서 부른다(카드 표 잠금 · 깨움 · 사건).
async fn on_card_press(cfg: &Arc<Config>, chat: i64, c: &telegram::Callback, allow: bool, id: &str) {
    // 설정을 먼저 읽는다 — 잡은 뒤 기다리는 동안 다른 곳의 `gone` 을 놓치지 않게(잡은 카드의 `gone` 은 다리가 바꿔 쓰는 몫이라 건너뛴다)
    let on = chat_on(cfg).await;
    let (taken, known) = {
        let mut s = state();
        if on {
            let t = s.cards.begin_press(id);
            let known = t.is_some();
            (t, known)
        } else {
            (None, s.cards.pressable(id))
        }
    };
    let result = match logic::judge_press(known, on) {
        Press::Stale => PressResult::Already,
        Press::Off => PressResult::Off,
        Press::Go => {
            let (stream, epoch) = taken.as_ref().map(|t| (t.0.clone(), t.1)).unwrap_or_default();
            let rid = id.to_string();
            let r = blocking(move || super::tile_permission::resolve_from_bridge(&stream, epoch, &rid, allow)).await;
            state().cards.end_press(id);
            match r {
                Some(Ok(true)) if allow => PressResult::Allowed,
                Some(Ok(true)) => PressResult::Denied,
                Some(Ok(false)) => PressResult::Already,
                _ => PressResult::Closed,
            }
        }
    };
    let line = logic::press_text(result);
    call_quiet("answerCallbackQuery", telegram::answer_callback_body(&c.id, Some(&line))).await;
    // 꺼짐 — 단추는 그대로(다시 켜면 누를 수 있다) · 표에 없던 누름 — 다른 누름 · 사건이 이미 바꿔 쓴다(또는 쓴다)
    let rewrite_it = match result {
        PressResult::Off => false,
        PressResult::Already => taken.is_some(),
        _ => true,
    };
    if rewrite_it {
        let (label, mid) = taken.map(|(_, _, l, m)| (l, m)).unwrap_or_default();
        if let Some(mid) = mid.or(c.message_id) {
            rewrite(chat, mid, &label, &line).await;
        }
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

/// 다리 턴의 답 — 대화 파일의 마지막 답 **전문**(4096자씩 · 최대 4통 · 그 뒤 "앱에서 전체 보기").
async fn send_answer(cfg: &Arc<Config>, chat: i64, stream: &str, cli: Option<&'static str>, convo: Option<String>) {
    let label = label_of(cfg, stream).await;
    let text = match cli {
        Some(cli) => settled_answer(cfg, cli, convo).await,
        None => None,
    };
    let head = format!("<b>{}</b>", telegram::escape_html(&format!("🟢 {label}")));
    let Some(text) = text.filter(|t| !t.trim().is_empty()) else {
        let t = tr!(ko: "턴이 끝났습니다 (답을 읽지 못했습니다)", en: "The turn ended (could not read the reply)");
        send(chat, &format!("{head}\n{}", telegram::escape_html(&t)), None, &[], Some(stream)).await;
        return;
    };
    let more = tr!(ko: "… (앱에서 전체 보기)", en: "… (see the full reply in the app)");
    let room = telegram::TEXT_MAX.saturating_sub(telegram::units(&label) + 8);
    for (i, part) in telegram::split_text(&text, room, telegram::MAX_PARTS, &more).iter().enumerate() {
        let html = if i == 0 { format!("{head}\n{}", telegram::escape_html(part)) } else { telegram::escape_html(part) };
        send(chat, &html, None, &[], Some(stream)).await;
    }
}

// ---------------------------------------------------------------------------
// 알림 — 다른 길(프런트 · 서버 안 `send_plain`)의 Telegram 몫
// ---------------------------------------------------------------------------

/// 알림 한 통의 Telegram 몫 — 그려 둔 HTML(`messenger::Channel::Telegram`)과 (있으면) 그 타일 · 종류 · 이름표. `Debug` 없음(본문).
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

/// 짝지은 대화방으로 한 통. 봇 · 짝이 없으면 조용히 건너뛴다. 다리 턴의 같은 알림(턴 끝 · 권한 물음)은 다리가 이미 보냈으니 건너뛴다.
pub(crate) async fn notify(n: Notice) -> Result<(), String> {
    let chat = {
        let mut s = state();
        // `n.label`(알림의 이름 — 프로젝트 / 워크트리 · 탭 제목)은 적지 않는다: 다리 이름표는 `messenger_bot_label` 하나로만 적는다(2026-11-19 —
        // 알림의 이름이 다리 이름표를 덮어쓰면 안 된다).
        let owned = matches!(n.kind.as_deref(), Some("stop" | "permission"))
            && n.stream.as_deref().is_some_and(|st| s.turns.owns(st, now_ms()));
        if owned || s.token.is_none() {
            return Ok(());
        }
        match &s.paired {
            Some(p) => p.chat_id,
            None => return Ok(()),
        }
    };
    let stream = n.stream.as_deref().filter(|s| crate::tile_env::stream_ok(s));
    // 2단계 — 다리 턴이 아닌 턴의 권한 알림: 그 스트림에 권한 카드가 서 있고 켜져 있으면 단추를 단다(그 뒤 그 턴은 다리가 돌본다)
    if let (Some("permission"), Some(st)) = (n.kind.as_deref(), stream) {
        if let Some(done) = permission_notice(chat, st, &n.text).await {
            return done.map_err(|_| tr!(ko: "Telegram 에 보내지 못했습니다", en: "Could not send to Telegram"));
        }
    }
    match send(chat, &telegram::clip_html(&n.text, telegram::TEXT_MAX), None, &[], stream).await {
        Some(_) => Ok(()),
        None => Err(tr!(ko: "Telegram 에 보내지 못했습니다", en: "Could not send to Telegram")),
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

/// 권한 알림에 단추를 달까 — `None` 이면 지금처럼 글만. 서 있는 권한 카드(질문 빼고) 가운데 아직 단추 통이 없는 것: 가장 오래된 것은 이 알림 글에
/// 단추를 달고, 나머지는 각각 단추 통으로. 스트림을 돌보는 중으로 적는 것은 **보내기 전** — 그때부터 다리 표지가 "보는 창" 에 있어야 누름이 먹는다.
/// 서 있는 카드마다 이미 단추 통이 나갔으면 같은 물음의 알림은 보내지 않는다(`Some(Ok)`). 카드 표 · 다리 잠금은 차례로(겹쳐 쥐지 않는다).
async fn permission_notice(chat: i64, stream: &str, html: &str) -> Option<Result<(), ()>> {
    let cfg = state().cfg.clone()?;
    let standing: Vec<CardBrief> = super::tile_permission::standing_cards(stream).iter().filter_map(brief).collect();
    if standing.is_empty() {
        return None;
    }
    let (fresh, tended): (Vec<CardBrief>, bool) = {
        let s = state();
        (standing.into_iter().filter(|c| !s.cards.has(&c.0)).collect(), s.tending.tends(stream))
    };
    if fresh.is_empty() {
        return tended.then_some(Ok(()));
    }
    if !chat_on(&cfg).await {
        return None;
    }
    let opened: Vec<CardBrief> = {
        let mut s = state();
        s.tending.tend(stream);
        fresh.into_iter().filter(|c| s.cards.open(&c.0, stream, c.1)).collect()
    };
    // 연 뒤 다시 본다 — 열기 전에 풀린 카드(그 `gone` 은 표가 받지 못했다)는 뺀다
    let still: Vec<String> = super::tile_permission::standing_cards(stream).iter().filter_map(brief).map(|c| c.0).collect();
    let opened: Vec<CardBrief> = {
        let mut s = state();
        opened
            .into_iter()
            .filter(|c| {
                let keep = still.contains(&c.0);
                if !keep {
                    s.cards.forget(&c.0);
                }
                keep
            })
            .collect()
    };
    let (first, rest) = opened.split_first()?;
    let label = label_of(&cfg, stream).await;
    let tail = telegram::escape_html(&logic::tool_line(&first.2, &first.3));
    let head = telegram::clip_html(html, telegram::TEXT_MAX.saturating_sub(telegram::units(&tail) + 1));
    let mid = send(chat, &format!("{head}\n{tail}"), None, &logic::card_buttons(&first.0), Some(stream)).await;
    after_card_sent(chat, &first.0, mid, &label).await;
    for (id, _, tool, summary) in rest {
        let m = send(chat, &logic::card_html(&label, tool, summary), None, &logic::card_buttons(id), Some(stream)).await;
        after_card_sent(chat, id, m, &label).await;
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

/// 상태 — 토큰 없음.
fn status() -> Value {
    let mut s = state();
    let now = now_ms();
    let pending = s.pairing.current(now).map(|p| json!({ "code": p.code, "name": p.name }));
    json!({
        "configured": s.token.is_some(),
        "bot": s.bot,
        "paired": s.paired.is_some(),
        "pairName": s.paired.as_ref().map(|p| p.name.clone()),
        "pending": pending,
        "link": s.link.as_str(),
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

/// op 하나 — 블로킹 없음(파일 쓰기는 블로킹 풀). 몸(토큰 · 본문)은 로그에 남기지 않는다.
pub(crate) async fn handle(op: &str, body: Value) -> Result<Value, WireError> {
    match op {
        "messenger_bot_status" => Ok(status()),
        "messenger_bot_set_token" => {
            let b: TokenBody = serde_json::from_value(body).map_err(|_| bad("bad token body"))?;
            set_token(b.token).await
        }
        "messenger_bot_pair" => {
            let b: PairBody = serde_json::from_value(body).map_err(|_| bad("bad pair body"))?;
            pair(&b.code, b.allow).await
        }
        "messenger_bot_unpair" => {
            unpair().await?;
            Ok(status())
        }
        "messenger_bot_test" => {
            let chat = state().paired.as_ref().map(|p| p.chat_id).ok_or_else(|| bad("[not-paired] no paired chat"))?;
            let text = crate::messenger::Channel::Telegram.test_text();
            send(chat, &text, None, &[], None).await.map(|_| Value::Null).ok_or_else(|| bad("[send-failed] sendMessage failed"))
        }
        "messenger_bot_notify" => {
            let n: Notice = serde_json::from_value(body).map_err(|_| bad("bad notify body"))?;
            notify(n).await.map(|_| Value::Null).map_err(|e| bad(&e))
        }
        // 이름표 미리 알리기(실기 후속 2026-11-19) — 적기만 한다(아무것도 보내지 않는다). 다리 이름표를 적는 길은 이것 하나다.
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

/// 토큰 등록(`getMe` 로 확인) · 해제(짝도 함께 지운다) → 고리 다시 시작.
async fn set_token(raw: Option<String>) -> Result<Value, WireError> {
    let cfg = cfg_now()?;
    let raw = raw.filter(|r| !r.trim().is_empty());
    let Some(raw) = raw else {
        let c = cfg.clone();
        let ok = blocking(move || write_or_remove(token_path(&c), None) & write_or_remove(chat_path(&c), None)).await.unwrap_or(false);
        {
            let mut s = state();
            s.token = None;
            s.paired = None;
            s.bot = None;
            s.pairing.clear();
            s.forget_chat();
        }
        restart();
        emit("token");
        if !ok {
            return Err(bad("[save-failed] could not remove the bot files"));
        }
        log::line("messenger bridge — bot token removed");
        return Ok(status());
    };
    let token = BotToken::parse(&raw).ok_or_else(|| bad("[bad-token] not a bot token"))?;
    let client = state().client.clone().ok_or_else(|| bad("[bridge-off] no http client"))?;
    let me = call(&client, &cfg.api, &token, "getMe", json!({}), SEND_TIMEOUT).await;
    let bot = match me {
        Ok(v) => telegram::parse_me(&v),
        Err(CallErr::Api(ApiFail::Unauthorized)) => return Err(bad("[bad-token] telegram rejected the token")),
        Err(e) => return Err(bad(&format!("[unreachable] getMe failed ({})", err_kind(&e)))),
    };
    let c = cfg.clone();
    let body = token.as_str().to_string();
    let same = state().token.as_ref() == Some(&token);
    let ok = blocking(move || write_or_remove(token_path(&c), Some(&body)) && (same || write_or_remove(chat_path(&c), None)))
        .await
        .unwrap_or(false);
    if !ok {
        return Err(bad("[save-failed] could not save the bot token"));
    }
    {
        let mut s = state();
        // 다른 봇으로 바꾸면 짝도 새로(그 봇의 대화방이 아니다).
        if !same {
            s.paired = None;
            s.forget_chat();
        }
        s.token = Some(token);
        s.bot = bot;
        s.pairing.clear();
    }
    restart();
    emit("token");
    log::line("messenger bridge — bot token registered");
    Ok(status())
}

/// 대기 중인 짝짓기 허용 · 거절(코드가 지금 대기의 것이어야).
async fn pair(code: &str, allow: bool) -> Result<Value, WireError> {
    let cfg = cfg_now()?;
    let taken = state().pairing.take(code, now_ms()).ok_or_else(|| bad("[no-pending] no matching pairing request"))?;
    emit("pairing");
    if !allow {
        log::line("messenger bridge — pairing denied");
        return Ok(status());
    }
    let p = Paired { user_id: taken.user_id, chat_id: taken.chat_id, name: taken.name.clone() };
    let body = serde_json::to_string(&p).map_err(|_| bad("[save-failed] encode"))?;
    let c = cfg.clone();
    if !blocking(move || write_or_remove(chat_path(&c), Some(&body))).await.unwrap_or(false) {
        return Err(bad("[save-failed] could not save the paired chat"));
    }
    state().paired = Some(p.clone());
    emit("paired");
    log::line("messenger bridge — paired");
    let t = tr!(
        ko: "연결됐습니다 — 알림이 이 대화방으로 옵니다. 알림에 답장하면 그 타일로 갑니다(설정에서 켠 경우).",
        en: "Connected — notifications will come to this chat. Reply to a notification to send it to that tile (when enabled in settings).",
    );
    send_plain_text(p.chat_id, &t, None, None).await;
    Ok(status())
}

async fn unpair() -> Result<(), WireError> {
    let cfg = cfg_now()?;
    let c = cfg.clone();
    if !blocking(move || write_or_remove(chat_path(&c), None)).await.unwrap_or(false) {
        return Err(bad("[save-failed] could not remove the paired chat"));
    }
    {
        let mut s = state();
        s.paired = None;
        s.forget_chat();
    }
    emit("paired");
    log::line("messenger bridge — unpaired");
    Ok(())
}
