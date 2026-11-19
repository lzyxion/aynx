//! **메신저 다리의 Telegram 전송**(2026-11-19 · 3a — 코어에서 떼어 냄). 롱폴 고리(`getUpdates`) · 요청 하나(`call`) · 보내기 · 바꿔 쓰기 ·
//! 누름 답(`answerCallbackQuery`) · 토큰 확인(`getMe`) · 지난 글 묶음 알림 · 중립 글([`Text`]) → HTML. 받은 것은 코어의 중립 값
//! ([`super::Incoming`] · [`super::ButtonPress`])으로 바꿔 [`super::on_message`] · [`super::on_press`] 로 넘긴다. JSON · HTML 글자는 `crate::telegram`.
//!
//! - **PTY · 카드 결정 · 승인으로 가는 길이 없다** — 코어의 입구만 부른다(시험 `pty_writes_have_two_sites` · `bridge_has_no_approval_path` 가
//!   이 파일도 훑는다).
//! - 토큰은 코어의 채널 상태에서 꺼낸 [`BotToken`] 으로만 쓰고 로그에는 고정 글자 · 오류 종류([`err_kind`])만 싣는다.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use super::logic::Button;
use super::{ButtonPress, Config, Incoming, Link, Text, REQUEST_TIMEOUT};
use crate::server::log;
use crate::i18n::tr;
use crate::messenger::Channel;
pub(crate) use crate::telegram::BotToken;
use crate::telegram::{self, Api, ApiFail, UpdateKind};

const CHAN: Channel = Channel::Telegram;

/// `getUpdates` 롱폴 시한(초) · 보내기 시한.
const POLL_TIMEOUT_SECS: u64 = 50;
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

/// Telegram 몫의 설정 — 제품은 [`Conf::release`].
pub(crate) struct Conf {
    pub api: Api,
    pub poll_timeout_secs: u64,
}

impl Conf {
    pub(crate) fn release() -> Conf {
        Conf { api: Api::release(), poll_timeout_secs: POLL_TIMEOUT_SECS }
    }
}

/// 단추 데이터 상한(바이트).
pub(crate) const DATA_MAX: usize = telegram::CALLBACK_DATA_MAX;

/// 붙여 넣은 글자 → 토큰(모양만 — 확인은 [`check_token`]).
pub(crate) fn parse_token(raw: &str) -> Option<BotToken> {
    BotToken::parse(raw)
}

/// 이 세대가 아직 살아 있으면 보낼 손(클라이언트 · 설정 · 토큰).
fn hands(gen: Option<u64>) -> Option<(reqwest::Client, Arc<Config>, BotToken)> {
    let (client, cfg, token) = super::hands(CHAN, gen)?;
    Some((client, cfg, token.telegram()?.clone()))
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

fn err_kind(e: &CallErr) -> String {
    match e {
        CallErr::Transport => "transport".into(),
        CallErr::Api(ApiFail::Conflict) => "409".into(),
        CallErr::Api(ApiFail::Unauthorized) => "unauthorized".into(),
        CallErr::Api(ApiFail::Code(c)) => format!("http {c}"),
        CallErr::Api(ApiFail::Malformed) => "malformed".into(),
    }
}

/// 롱폴 고리 — 세대가 바뀌면 끝난다.
pub(super) async fn poll_loop(gen: u64) {
    let mut offset: Option<i64> = None;
    loop {
        let Some((client, cfg, token)) = hands(Some(gen)) else { return };
        let body = telegram::get_updates_body(offset, cfg.telegram.poll_timeout_secs);
        let wait = Duration::from_secs(cfg.telegram.poll_timeout_secs) + Duration::from_secs(10);
        let r = call(&client, &cfg.telegram.api, &token, "getUpdates", body, wait.min(REQUEST_TIMEOUT)).await;
        if hands(Some(gen)).is_none() {
            return;
        }
        match r {
            Ok(v) => {
                super::set_link(CHAN, gen, Link::Ok);
                let mut stale = 0usize;
                let mut last_chat = None;
                for u in telegram::parse_updates(&v) {
                    offset = Some(u.update_id + 1);
                    match u.kind {
                        UpdateKind::Message(m) => {
                            if let Some(chat) = super::on_message(CHAN, &cfg, incoming(m)).await {
                                stale += 1;
                                last_chat = Some(chat);
                            }
                        }
                        UpdateKind::Callback(c) => super::on_press(CHAN, &cfg, press(c)).await,
                        UpdateKind::Other => {}
                    }
                }
                if let (n @ 1.., Some(chat)) = (stale, last_chat) {
                    let text = tr!(
                        ko: "서버가 꺼져 있던 동안 온 글 {n}개는 타일에 보내지 않았습니다 — 필요하면 다시 보내 주세요",
                        en: "{n} message(s) that arrived while the server was off were not sent to any tile — send again if needed",
                    );
                    super::send(CHAN, chat, &Text::plain(text), None, &[], None).await;
                }
            }
            Err(CallErr::Api(ApiFail::Conflict)) => {
                log::line("messenger bridge — getUpdates conflict (another program uses this bot)");
                super::set_link(CHAN, gen, Link::Conflict);
                tokio::time::sleep(cfg.conflict_backoff).await;
            }
            Err(e) => {
                log::line(format!("messenger bridge — getUpdates failed ({})", err_kind(&e)));
                super::set_link(CHAN, gen, Link::Error);
                tokio::time::sleep(cfg.backoff).await;
            }
        }
    }
}

fn incoming(m: telegram::Incoming) -> Incoming {
    Incoming {
        message_id: m.message_id,
        from_id: m.from_id,
        from_name: m.from_name,
        chat_id: m.chat_id,
        private: m.private,
        date: m.date,
        text: m.text,
        reply_to: m.reply_to,
    }
}

fn press(c: telegram::Callback) -> ButtonPress {
    ButtonPress { from_id: c.from_id, chat_id: c.chat_id, message_id: c.message_id, data: c.data, ack: super::Ack::Telegram(c.id) }
}

/// **중립 글 → Telegram HTML**(1a · 2단계의 글자 그대로). 평문은 `& < >` 를 걷고 머리 줄은 `<b>` — 나누기 · 상한은 코어가 맞췄다(답 전문은
/// [`split_answer`]). 그려 둔 알림 글은 4096 안으로 자르고, 덧붙일 줄이 있으면 그 자리를 남긴 뒤 한 줄 아래에 단다.
pub(crate) fn render(t: &Text) -> String {
    match t {
        Text::Lines { head: None, body } => telegram::escape_html(body),
        Text::Lines { head: Some(h), body } => format!("<b>{}</b>\n{}", telegram::escape_html(h), telegram::escape_html(body)),
        Text::Rendered { text, tail: None } => telegram::clip_html(text, telegram::TEXT_MAX),
        Text::Rendered { text, tail: Some(tail) } => {
            let tail = telegram::escape_html(tail);
            let head = telegram::clip_html(text, telegram::TEXT_MAX.saturating_sub(telegram::units(&tail) + 1));
            format!("{head}\n{tail}")
        }
    }
}

/// 답 전문 나누기 — 첫 통은 굵은 머리 줄 `head` 와 함께 간다(4096자씩 · 최대 4통 · 넘치면 마지막 통 끝에 `more`). 머리 줄 + 줄바꿈 + 여유
/// = `units(head) + 5`(1a 의 `units(이름표) + 8` 과 같다 — 머리 줄은 `🟢 <이름표>`).
pub(crate) fn split_answer(head: &str, body: &str, more: &str) -> Vec<String> {
    let room = telegram::TEXT_MAX.saturating_sub(telegram::units(head) + 5);
    telegram::split_text(body, room, telegram::MAX_PARTS, more)
}

/// 한 통 보낸다 — 보낸 메시지 id(실패면 `None` — 로그 한 줄, 본문 없음).
pub(crate) async fn send(chat: i64, t: &Text, reply_to: Option<i64>, buttons: &[Button]) -> Option<i64> {
    let (client, cfg, token) = hands(None)?;
    let body = telegram::send_message_body(chat, &render(t), reply_to, buttons);
    match call(&client, &cfg.telegram.api, &token, "sendMessage", body, SEND_TIMEOUT).await {
        Ok(v) => telegram::parse_sent_id(&v),
        Err(e) => {
            log::line(format!("messenger bridge — sendMessage failed ({})", err_kind(&e)));
            None
        }
    }
}

async fn call_quiet(method: &str, body: Value) {
    let Some((client, cfg, token)) = hands(None) else { return };
    if let Err(e) = call(&client, &cfg.telegram.api, &token, method, body, SEND_TIMEOUT).await {
        log::line(format!("messenger bridge — {method} failed ({})", err_kind(&e)));
    }
}

/// 보낸 통을 바꿔 쓴다(단추는 걷힌다 — `editMessageText` 에 `reply_markup` 이 없다).
pub(crate) async fn edit(chat: i64, message_id: i64, t: &Text) {
    call_quiet("editMessageText", telegram::edit_message_text_body(chat, message_id, &render(t))).await;
}

/// 누름 답 — 알릴 글이 없어도 불러야 단추의 도는 표시가 멈춘다.
pub(crate) async fn finish_press(callback_id: &str, toast: Option<&str>) {
    call_quiet("answerCallbackQuery", telegram::answer_callback_body(callback_id, toast)).await;
}

/// 토큰 확인(`getMe`) → 봇 이름. 실패는 이유 코드가 붙은 문구(토큰 없음).
pub(crate) async fn check_token(client: &reqwest::Client, cfg: &Config, token: &BotToken) -> Result<Option<String>, String> {
    match call(client, &cfg.telegram.api, token, "getMe", json!({}), SEND_TIMEOUT).await {
        Ok(v) => Ok(telegram::parse_me(&v)),
        Err(CallErr::Api(ApiFail::Unauthorized)) => Err("[bad-token] telegram rejected the token".into()),
        Err(e) => Err(format!("[unreachable] getMe failed ({})", err_kind(&e))),
    }
}
