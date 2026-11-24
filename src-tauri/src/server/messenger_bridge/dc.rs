//! 메신저 다리의 Discord 전송 — 게이트웨이 고리 · REST · 누름 받음 · 토큰 확인.
//!
//! - **DM 만** — `guild_id` 가 있는 글 · 누름은 버린다. 의도는 `DIRECT_MESSAGES` 하나 — 특권 의도 `MESSAGE_CONTENT` 는 쓰지 않는다
//!   (앱과의 DM 내용은 그것 없이 온다 — 문서 "Message Content Intent" 의 예외).
//! - **PTY · 카드 결정 · 승인으로 가는 길이 없다** — 코어의 입구만 부른다(시험 `pty_writes_have_two_sites` · `bridge_has_no_approval_path` 가
//!   이 파일도 훑는다).
//! - 로그에는 고정 글자 · 오류 종류([`err_kind`]) · 닫힘 코드 숫자만 싣는다. 누름의 콜백 토큰도 주소에만 든다(로그 · 오류 문구에 없다).
//! - **멘션은 늘 막는다** — 보내기 · 바꿔 쓰기 · 후속 글마다 `"allowed_mentions": {"parse": []}`. 답 전문의 서식(`messenger::md`)도 글자는
//!   마크다운 기호를 걷어 싣는다 — `<@…>` · 가린 링크 `[..](..)` 가 서식으로 읽히지 않는다.
//! - **IDENTIFY 예산**(24시간에 1000번 — 넘으면 Discord 가 토큰을 바꾼다): RESUME 을 먼저 쓰고, [`FATAL_CLOSE`] 면 고리를 끝낸다. 갓 IDENTIFY 한
//!   세션이 [`Conf::stable`] 안에 죽으면 다음 IDENTIFY 를 물러난다(`logic::Flap`). 그 밖의 방어 기계는 없다(AGENTS.md "작업 방식").
//! - Telegram 의 409 같은 것은 없다 — 같은 봇을 두 프로그램이 받으면 둘 다 사건을 받는다.
//! - REST 의 429 는 평소 일이다 — `retry_after`(최대 [`RETRY_CAP`])만큼 쉬고 **한 번만** 다시 보낸다. 큐는 없다.
//! - `content` 2000자를 무엇으로 세는지 문서에 없다 — UTF-16 단위로 보수적으로 재고 [`CONTENT_ROOM`] 까지만 쓴다.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use super::logic::Button;
use super::sock::{self, Event, Ws};
use super::{ButtonPress, Config, Incoming, Link, Text};
use crate::messenger::{md, Channel};
use crate::server::log;

const CHAN: Channel = Channel::Discord;

/// 봇 토큰이 나가는 곳은 이 둘뿐이다(시험만 [`Conf::at`] 으로 루프백을 꽂는다 → docs/invariants.md 전문 6).
pub(crate) const API_BASE: &str = "https://discord.com/api/v10";
pub(crate) const GATEWAY: &str = "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_QUERY: &str = "?v=10&encoding=json";
/// `DIRECT_MESSAGES`.
pub(crate) const INTENTS: u64 = 1 << 12;
pub(crate) const CONTENT_MAX: usize = 2000;
pub(crate) const CONTENT_ROOM: usize = 1990;
const _: () = assert!(CONTENT_ROOM < CONTENT_MAX);
pub(crate) const MAX_PARTS: usize = 5;
/// 글자 수 — 우리 데이터는 ASCII 라 바이트와 같다.
pub(crate) const DATA_MAX: usize = 100;
const LABEL_MAX: usize = 80;
/// `messenger.rs` 의 Discord 걷기와 같은 셋.
const MARKDOWN: &[char] = crate::messenger::DISCORD_MARKDOWN_CHARS;
const SUPPRESS_EMBEDS: u64 = 1 << 2;
const EPHEMERAL: u64 = 1 << 6;
const DEFERRED_UPDATE_MESSAGE: u64 = 6;
/// 문서 표의 "Reconnect false" · 새 세션으로 붙으라는 코드.
pub(crate) const FATAL_CLOSE: &[u16] = &[4004, 4010, 4011, 4012, 4013, 4014];
const FRESH_CLOSE: &[u16] = &[4007, 4009];
/// 1000 · 1001 로 닫으면 세션이 죽어 RESUME 할 수 없다.
const RESUMABLE_CLOSE: u16 = 4000;
const DISCORD_EPOCH_MS: i64 = 1_420_070_400_000;
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const RETRY_CAP: Duration = Duration::from_secs(5);
const HELLO_TIMEOUT: Duration = Duration::from_secs(20);
const IDENTIFY_BACKOFF: Duration = Duration::from_secs(5);
const IDENTIFY_BACKOFF_MAX: Duration = Duration::from_secs(300);
const STABLE: Duration = Duration::from_secs(60);
/// Discord 가 요구하는 모양(`DiscordBot ($url, $versionNumber)`).
const USER_AGENT: &str = concat!("DiscordBot (https://github.com/lzyxion/aynx, ", env!("CARGO_PKG_VERSION"), ")");

// ---------------------------------------------------------------------------
// 설정 · 토큰
// ---------------------------------------------------------------------------

pub(crate) struct Conf {
    api: String,
    gateway: String,
    pub identify_backoff: Duration,
    pub identify_backoff_max: Duration,
    pub stable: Duration,
}

impl Conf {
    pub(crate) fn release() -> Conf {
        Conf {
            api: API_BASE.to_string(),
            gateway: GATEWAY.to_string(),
            identify_backoff: IDENTIFY_BACKOFF,
            identify_backoff_max: IDENTIFY_BACKOFF_MAX,
            stable: STABLE,
        }
    }

    #[cfg(test)]
    pub(crate) fn at(api: &str, gateway: &str) -> Conf {
        Conf { api: api.trim_end_matches('/').to_string(), gateway: gateway.to_string(), ..Conf::release() }
    }
}

/// **`Debug` 는 값을 찍지 않는다** · `Display` 없음.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct BotToken(String);

impl std::fmt::Debug for BotToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BotToken(<redacted>)")
    }
}

impl BotToken {
    /// 정확한 길이는 Discord 가 정하므로 넉넉히 본다.
    pub(crate) fn parse(raw: &str) -> Option<BotToken> {
        let raw = raw.trim();
        let parts: Vec<&str> = raw.split('.').collect();
        let ok = parts.len() == 3
            && (50..=120).contains(&raw.len())
            && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'));
        ok.then(|| BotToken(raw.to_string()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

pub(crate) fn parse_token(raw: &str) -> Option<BotToken> {
    BotToken::parse(raw)
}

/// **`Debug` 없음** · 로그에 싣지 않는다(콜백 토큰).
pub(crate) struct Ack {
    app: String,
    token: String,
}

fn hands(gen: Option<u64>) -> Option<(reqwest::Client, Arc<Config>, BotToken)> {
    let (client, cfg, token) = super::hands(CHAN, gen)?;
    Some((client, cfg, token.discord()?.clone()))
}

// ---------------------------------------------------------------------------
// 글자
// ---------------------------------------------------------------------------

pub(crate) fn escape(text: &str) -> String {
    md::escape_discord(text)
}

pub(crate) fn units(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// 걷은 뒤의 길이.
fn width(c: char) -> usize {
    c.len_utf16() + usize::from(MARKDOWN.contains(&c))
}

fn escaped_units(text: &str) -> usize {
    text.chars().map(width).sum()
}

/// 마크다운으로 그린 뒤의 길이 상한 — 글자 기호는 걷기 `\` 로 둘, `#`(제목 → `**…**`) · `|`(표 → 코드 블록 울타리)는 셋으로 친다.
fn md_width(c: char) -> usize {
    width(c) + usize::from(c == '#' || c == '|')
}

/// 코어가 울타리를 잇느라 더하는 닫는 줄(4자)과 다시 여는 줄(울타리 3 + 언어 20 + 줄바꿈)의 자리.
const FENCE_ROOM: usize = 32;

/// 조각의 길이는 **그린 뒤**로 잰다 — 부르는 쪽이 조각마다 그린다(기호가 많은 답도 한 통 상한 안).
pub(crate) fn split_answer(head: &str, body: &str, more: &str) -> Vec<String> {
    let room = CONTENT_ROOM.saturating_sub(escaped_units(head) + 4 + 1 + 4 + FENCE_ROOM);
    super::logic::split_by(body, room, MAX_PARTS, more, md_width)
}

/// 답 전문 한 조각 — 머리 줄은 글자 그대로 굵게, 몸은 `md` 의 Discord 마크다운.
fn markdown(head: Option<&str>, body: &str) -> String {
    let body = md::discord(&md::parse(body));
    match head {
        Some(h) => format!("**{}**\n{body}", escape(h)),
        // 빈 글은 Discord 가 거절한다
        None if body.trim().is_empty() => "…".to_string(),
        None => body,
    }
}

/// 걷기 `\` 와 그 짝 사이를 가르지 않는다.
pub(crate) fn clip(text: &str, max: usize) -> String {
    if units(text) <= max {
        return text.to_string();
    }
    let budget = max.saturating_sub(3);
    let mut cut = 0;
    let mut used = 0;
    for (i, c) in text.char_indices() {
        if used + c.len_utf16() > budget {
            break;
        }
        used += c.len_utf16();
        cut = i + c.len_utf8();
    }
    let mut out = text[..cut].to_string();
    // 끝의 `\` 가 홀수 개면 마지막 것은 다음 글자를 걷던 것이다
    if out.chars().rev().take_while(|&c| c == '\\').count() % 2 == 1 {
        out.pop();
    }
    if out.matches("**").count() % 2 == 1 {
        out.push_str("**");
    }
    out.push('…');
    out
}

/// 그려 둔 알림 글(`messenger::Channel::Discord.render`)은 이미 걷었으니 자르기만 한다.
pub(crate) fn render(t: &Text) -> String {
    match t {
        Text::Lines { head: None, body } => clip(&escape(body), CONTENT_ROOM),
        Text::Lines { head: Some(h), body } => clip(&format!("**{}**\n{}", escape(h), escape(body)), CONTENT_ROOM),
        // 나누기가 그린 뒤 길이로 자리를 잡았다 — 자르기는 코드 span 같은 드문 꼴에서 넘칠 때의 울타리일 뿐이다
        Text::Markdown { head, body } => clip(&markdown(head.as_deref(), body), CONTENT_ROOM),
        Text::Rendered { text, tail: None } => clip(text, CONTENT_ROOM),
        Text::Rendered { text, tail: Some(tail) } => {
            let tail = clip(&escape(tail), CONTENT_ROOM / 2);
            let head = clip(text, CONTENT_ROOM.saturating_sub(units(&tail) + 1));
            format!("{head}\n{tail}")
        }
    }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/// 문구 없이 종류만 — 토큰 · 콜백 토큰이 든 주소 · Discord 의 설명 글을 싣지 않는다.
#[derive(Debug, PartialEq, Eq)]
enum CallErr {
    Unauthorized,
    RateLimited,
    Code(u16),
    Malformed,
    Transport,
}

fn err_kind(e: &CallErr) -> String {
    match e {
        CallErr::Transport => "transport".into(),
        CallErr::Unauthorized => "unauthorized".into(),
        CallErr::RateLimited => "429".into(),
        CallErr::Code(c) => format!("http {c}"),
        CallErr::Malformed => "malformed".into(),
    }
}

fn parse_response(status: u16, body: &str) -> Result<Value, CallErr> {
    match status {
        200..=299 if body.trim().is_empty() => Ok(Value::Null),
        200..=299 => serde_json::from_str(body).map_err(|_| CallErr::Malformed),
        401 => Err(CallErr::Unauthorized),
        429 => Err(CallErr::RateLimited),
        c => Err(CallErr::Code(c)),
    }
}

/// `retry_after` 는 초 · 소수다.
pub(crate) fn retry_after(body: &str, header: Option<&str>) -> Duration {
    let secs = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("retry_after").and_then(Value::as_f64))
        .or_else(|| header.and_then(|h| h.trim().parse::<f64>().ok()))
        .unwrap_or(1.0);
    Duration::from_secs_f64(secs.clamp(0.0, RETRY_CAP.as_secs_f64()))
}

/// 콜백 · 후속 글은 그 누름의 토큰이 주소에 들어 봇 토큰을 싣지 않는다(`auth: None`).
async fn call(client: &reqwest::Client, api: &str, auth: Option<&BotToken>, method: reqwest::Method, path: &str, body: Option<&Value>) -> Result<Value, CallErr> {
    for attempt in 0..2 {
        let mut rq = client.request(method.clone(), format!("{api}{path}")).timeout(SEND_TIMEOUT).header(reqwest::header::USER_AGENT, USER_AGENT);
        if let Some(t) = auth {
            rq = rq.header(reqwest::header::AUTHORIZATION, format!("Bot {}", t.as_str()));
        }
        if let Some(b) = body {
            rq = rq.header(reqwest::header::CONTENT_TYPE, "application/json").body(b.to_string());
        }
        let res = rq.send().await.map_err(|_| CallErr::Transport)?;
        let status = res.status().as_u16();
        let header = res.headers().get(reqwest::header::RETRY_AFTER).and_then(|h| h.to_str().ok()).map(str::to_string);
        let text = res.text().await.map_err(|_| CallErr::Transport)?;
        if status == 429 && attempt == 0 {
            tokio::time::sleep(retry_after(&text, header.as_deref())).await;
            continue;
        }
        return parse_response(status, &text);
    }
    Err(CallErr::RateLimited)
}

/// 다섯 이하면 한 줄에 하나(Telegram 과 같은 모양) — Discord 는 한 줄에 다섯 · 다섯 줄까지다.
pub(crate) fn components(buttons: &[Button]) -> Value {
    let ok: Vec<Value> = buttons
        .iter()
        .filter(|(_, data)| !data.is_empty() && data.chars().count() <= DATA_MAX)
        .map(|(label, data)| {
            let label: String = label.chars().filter(|c| !c.is_control()).take(LABEL_MAX).collect();
            json!({ "type": 2, "style": 2, "label": label, "custom_id": data })
        })
        .collect();
    let per_row = if ok.len() <= 5 { 1 } else { 5 };
    let rows: Vec<Value> = ok.chunks(per_row).take(5).map(|c| json!({ "type": 1, "components": c })).collect();
    Value::Array(rows)
}

/// 멘션은 늘 막는다.
pub(crate) fn message_body(content: &str, reply_to: Option<i64>, buttons: &[Button]) -> Value {
    let mut v = json!({ "content": content, "allowed_mentions": { "parse": [] }, "flags": SUPPRESS_EMBEDS });
    if let Some(id) = reply_to {
        v["message_reference"] = json!({ "message_id": id.to_string(), "fail_if_not_exists": false });
    }
    if !buttons.is_empty() {
        v["components"] = components(buttons);
    }
    v
}

pub(crate) fn edit_body(content: &str) -> Value {
    json!({ "content": content, "allowed_mentions": { "parse": [] }, "flags": SUPPRESS_EMBEDS, "components": [] })
}

pub(crate) async fn send(chat: i64, t: &Text, reply_to: Option<i64>, buttons: &[Button]) -> Option<i64> {
    let (client, cfg, token) = hands(None)?;
    let body = message_body(&render(t), reply_to, buttons);
    match call(&client, &cfg.discord.api, Some(&token), reqwest::Method::POST, &format!("/channels/{chat}/messages"), Some(&body)).await {
        Ok(v) => snowflake(v.get("id")?),
        Err(e) => {
            log::line(format!("messenger bridge — discord send failed ({})", err_kind(&e)));
            None
        }
    }
}

pub(crate) async fn edit(chat: i64, message_id: i64, t: &Text) {
    let Some((client, cfg, token)) = hands(None) else { return };
    let body = edit_body(&render(t));
    if let Err(e) = call(&client, &cfg.discord.api, Some(&token), reqwest::Method::PATCH, &format!("/channels/{chat}/messages/{message_id}"), Some(&body)).await {
        log::line(format!("messenger bridge — discord edit failed ({})", err_kind(&e)));
    }
}

/// Discord 는 누름에 3초 안의 콜백을 요구한다 — 받기 고리가 [`super::on_press`] 앞에서 부른다.
async fn ack_press(client: &reqwest::Client, api: &str, id: i64, token: &str) {
    let body = json!({ "type": DEFERRED_UPDATE_MESSAGE });
    if let Err(e) = call(client, api, None, reqwest::Method::POST, &format!("/interactions/{id}/{token}/callback"), Some(&body)).await {
        log::line(format!("messenger bridge — discord interaction ack failed ({})", err_kind(&e)));
    }
}

/// 누름은 받는 때 이미 알렸다([`ack_press`]). 바꿔 쓰면 그 결과 줄이 곧 알림이라 `toast` 는 바꿔 쓰지 않을 때만 보낸다.
pub(crate) async fn finish_press(ack: &Ack, toast: Option<&str>, rewritten: bool) {
    let Some(text) = toast.filter(|_| !rewritten) else { return };
    let Some((client, cfg, _)) = hands(None) else { return };
    let body = json!({ "content": clip(&escape(text), CONTENT_ROOM), "flags": EPHEMERAL, "allowed_mentions": { "parse": [] } });
    if let Err(e) = call(&client, &cfg.discord.api, None, reqwest::Method::POST, &format!("/webhooks/{}/{}", ack.app, ack.token), Some(&body)).await {
        log::line(format!("messenger bridge — discord followup failed ({})", err_kind(&e)));
    }
}

pub(crate) fn parse_me(v: &Value) -> Option<String> {
    let name = v.get("username")?.as_str()?;
    let ok = !name.is_empty() && name.len() <= 32 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.');
    ok.then(|| name.to_string())
}

/// 실패 문구에 토큰을 싣지 않는다.
pub(crate) async fn check_token(client: &reqwest::Client, cfg: &Config, token: &BotToken) -> Result<Option<String>, String> {
    match call(client, &cfg.discord.api, Some(token), reqwest::Method::GET, "/users/@me", None).await {
        Ok(v) => Ok(parse_me(&v)),
        Err(CallErr::Unauthorized) => Err("[bad-token] discord rejected the token".into()),
        Err(e) => Err(format!("[unreachable] users/@me failed ({})", err_kind(&e))),
    }
}

// ---------------------------------------------------------------------------
// 받은 것
// ---------------------------------------------------------------------------

pub(crate) fn snowflake(v: &Value) -> Option<i64> {
    let s = v.as_str()?;
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse::<i64>().ok()
}

/// 유닉스 초.
pub(crate) fn snowflake_secs(id: i64) -> i64 {
    ((id >> 22) + DISCORD_EPOCH_MS) / 1000
}

fn display_name(user: &Value) -> String {
    let pick = |k: &str| user.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    let raw = pick("global_name").or_else(|| pick("username")).unwrap_or("?");
    raw.chars().filter(|c| !c.is_control()).take(64).collect()
}

/// 서버(길드) 글 · DM 이 아닌 대화방은 버린다(DM 만).
pub(crate) fn parse_message(d: &Value, me: Option<i64>) -> Option<Incoming> {
    if d.get("guild_id").is_some_and(|g| !g.is_null()) || d.get("webhook_id").is_some_and(|w| !w.is_null()) {
        return None;
    }
    if d.get("channel_type").and_then(Value::as_u64).is_some_and(|t| t != 1) {
        return None;
    }
    let kind = d.get("type").and_then(Value::as_u64).unwrap_or(0);
    if kind != 0 && kind != 19 {
        return None;
    }
    let author = d.get("author")?;
    if author.get("bot").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let from = snowflake(author.get("id")?)?;
    if Some(from) == me {
        return None;
    }
    let message_id = snowflake(d.get("id")?)?;
    Some(Incoming {
        message_id,
        from_id: Some(from),
        from_name: display_name(author),
        chat_id: snowflake(d.get("channel_id")?)?,
        private: true,
        date: snowflake_secs(message_id),
        text: d.get("content").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string),
        reply_to: d.get("message_reference").and_then(|r| r.get("message_id")).and_then(snowflake),
    })
}

/// 단추(`type` 3) · DM 만. 그 밖은 알리지도 않는다.
pub(crate) fn parse_press(d: &Value) -> Option<(i64, String, ButtonPress)> {
    if d.get("type").and_then(Value::as_u64) != Some(3) || d.get("guild_id").is_some_and(|g| !g.is_null()) {
        return None;
    }
    let id = snowflake(d.get("id")?)?;
    let token = d.get("token")?.as_str()?.to_string();
    let app = snowflake(d.get("application_id")?)?.to_string();
    let token_ok = !token.is_empty() && token.len() <= 512 && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.');
    if !token_ok {
        return None;
    }
    let msg = d.get("message");
    let press = ButtonPress {
        from_id: snowflake(d.get("user")?.get("id")?)?,
        chat_id: d.get("channel_id").and_then(snowflake).or_else(|| msg.and_then(|m| m.get("channel_id")).and_then(snowflake)),
        message_id: msg.and_then(|m| m.get("id")).and_then(snowflake),
        data: d.get("data").and_then(|x| x.get("custom_id")).and_then(Value::as_str).map(str::to_string),
        ack: super::Ack::Discord(Ack { app, token: token.clone() }),
    };
    Some((id, token, press))
}

// ---------------------------------------------------------------------------
// 게이트웨이
// ---------------------------------------------------------------------------

/// **이 주소로 토큰을 다시 보낸다** — `wss` 이고 호스트가 `discord.gg`(또는 그 아래)일 때만 쓴다(시험 `responses_and_close_codes`).
fn resume_url(base: &str) -> Option<String> {
    let base = base.trim_end_matches('/');
    let u = reqwest::Url::parse(base).ok()?;
    let host = u.host_str()?;
    let ok = match u.scheme() {
        "wss" => host == "discord.gg" || host.ends_with(".discord.gg"),
        "ws" => cfg!(test) && host == "127.0.0.1",
        _ => false,
    };
    (ok && !base.contains('?')).then(|| format!("{base}/{GATEWAY_QUERY}"))
}

struct Session {
    id: String,
    resume: String,
}

#[derive(Debug, PartialEq, Eq)]
enum End {
    Fatal(u16),
    Resume,
    Fresh,
}

pub(super) async fn gateway_loop(gen: u64) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    tokio::spawn(sock::worker(CHAN, gen, rx));
    let mut session: Option<Session> = None;
    let mut seq: Option<i64> = None;
    let mut me: Option<i64> = None;
    let mut identified: Option<tokio::time::Instant> = None;
    let mut flap = super::logic::Flap::default();
    loop {
        let Some((client, cfg, token)) = hands(Some(gen)) else { return };
        if session.is_none() {
            // IDENTIFY 예산(머리말).
            let short = identified.is_some_and(|at| at.elapsed() < cfg.discord.stable);
            if let Some(w) = flap.delay(short, cfg.discord.identify_backoff, cfg.discord.identify_backoff_max) {
                tokio::time::sleep(w).await;
                if hands(Some(gen)).is_none() {
                    return;
                }
            }
        }
        let url = session.as_ref().and_then(|s| resume_url(&s.resume)).unwrap_or_else(|| cfg.discord.gateway.clone());
        let Some(mut ws) = sock::connect(&url).await else {
            log::line("messenger bridge — discord gateway connect failed");
            super::set_link(CHAN, gen, Link::Error);
            tokio::time::sleep(cfg.backoff).await;
            continue;
        };
        let mut run = Run { gen, client: &client, cfg: &cfg, token: &token, tx: &tx, session: &mut session, seq: &mut seq, me: &mut me, ready: false };
        let (end, did_identify) = run.go(&mut ws).await;
        let ready = run.ready;
        if let Some(at) = did_identify {
            identified = Some(at);
        }
        if hands(Some(gen)).is_none() {
            return;
        }
        match end {
            End::Fatal(code) => {
                log::line(format!("messenger bridge — discord gateway closed for good (code {code})"));
                super::set_link(CHAN, gen, Link::Error);
                return;
            }
            End::Fresh => {
                session = None;
                seq = None;
            }
            End::Resume => {}
        }
        if !ready {
            // READY · RESUMED 전에 끝났다 — 곧바로 다시 두드리지 않는다
            super::set_link(CHAN, gen, Link::Error);
            tokio::time::sleep(cfg.backoff).await;
        }
    }
}

struct Run<'a> {
    gen: u64,
    client: &'a reqwest::Client,
    cfg: &'a Arc<Config>,
    token: &'a BotToken,
    tx: &'a tokio::sync::mpsc::UnboundedSender<Event>,
    session: &'a mut Option<Session>,
    seq: &'a mut Option<i64>,
    me: &'a mut Option<i64>,
    /// READY · RESUMED 를 받았다
    ready: bool,
}

async fn send_json(ws: &mut Ws, v: Value) -> bool {
    ws.send(Message::text(v.to_string())).await.is_ok()
}

async fn close(ws: &mut Ws) {
    let frame = CloseFrame { code: CloseCode::from(RESUMABLE_CLOSE), reason: "".into() };
    let _ = tokio::time::timeout(Duration::from_secs(2), ws.close(Some(frame))).await;
}

fn close_end(code: Option<u16>) -> End {
    match code {
        Some(c) if FATAL_CLOSE.contains(&c) => End::Fatal(c),
        Some(c) if FRESH_CLOSE.contains(&c) => End::Fresh,
        _ => End::Resume,
    }
}

/// 첫 박동은 `interval × jitter(0–1)` 뒤(Discord 문서).
fn jitter() -> f64 {
    let mut b = [0u8; 4];
    if getrandom::fill(&mut b).is_err() {
        return 0.5;
    }
    f64::from(u32::from_le_bytes(b)) / f64::from(u32::MAX)
}

impl Run<'_> {
    /// 둘째 값은 이번에 IDENTIFY 한 때.
    async fn go(&mut self, ws: &mut Ws) -> (End, Option<tokio::time::Instant>) {
        let hello = tokio::time::timeout(HELLO_TIMEOUT, next_json(ws)).await.ok().flatten();
        let Some(interval) = hello.as_ref().filter(|v| v.get("op").and_then(Value::as_u64) == Some(10)).and_then(|v| v["d"]["heartbeat_interval"].as_u64()) else {
            return (End::Resume, None);
        };
        let interval = Duration::from_millis(interval.max(1000));
        let mut identified = None;
        let first = match self.session.as_ref() {
            Some(s) => json!({ "op": 6, "d": { "token": self.token.as_str(), "session_id": s.id, "seq": *self.seq } }),
            None => {
                identified = Some(tokio::time::Instant::now());
                json!({ "op": 2, "d": { "token": self.token.as_str(), "intents": INTENTS,
                    "properties": { "os": std::env::consts::OS, "browser": "aynx", "device": "aynx" } } })
            }
        };
        if !send_json(ws, first).await {
            return (End::Resume, identified);
        }
        let mut next = tokio::time::Instant::now() + interval.mul_f64(jitter());
        let mut acked = true;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(next) => {
                    if !acked {
                        // 좀비 연결 — RESUME 할 수 있게 닫는다
                        close(ws).await;
                        return (End::Resume, identified);
                    }
                    if !send_json(ws, json!({ "op": 1, "d": *self.seq })).await {
                        return (End::Resume, identified);
                    }
                    acked = false;
                    next = tokio::time::Instant::now() + interval;
                }
                msg = ws.next() => {
                    let v = match msg {
                        None | Some(Err(_)) => return (End::Resume, identified),
                        Some(Ok(Message::Close(f))) => return (close_end(f.map(|f| u16::from(f.code))), identified),
                        Some(Ok(Message::Text(t))) => match serde_json::from_str::<Value>(t.as_str()) {
                            Ok(v) => v,
                            Err(_) => continue,
                        },
                        Some(Ok(_)) => continue,
                    };
                    match v.get("op").and_then(Value::as_u64) {
                        Some(0) => {
                            if let Some(s) = v.get("s").and_then(Value::as_i64) {
                                *self.seq = Some(s);
                            }
                            self.dispatch(v.get("t").and_then(Value::as_str).unwrap_or(""), v.get("d").unwrap_or(&Value::Null));
                        }
                        Some(1) => {
                            if !send_json(ws, json!({ "op": 1, "d": *self.seq })).await {
                                return (End::Resume, identified);
                            }
                        }
                        Some(7) => {
                            close(ws).await;
                            return (End::Resume, identified);
                        }
                        Some(9) => {
                            close(ws).await;
                            let resumable = v.get("d").and_then(Value::as_bool) == Some(true) && self.session.is_some();
                            return (if resumable { End::Resume } else { End::Fresh }, identified);
                        }
                        Some(11) => acked = true,
                        _ => {}
                    }
                }
            }
        }
    }

    /// 기다리지 않는다.
    fn dispatch(&mut self, t: &str, d: &Value) {
        match t {
            "READY" => {
                let (Some(id), Some(resume)) = (d.get("session_id").and_then(Value::as_str), d.get("resume_gateway_url").and_then(Value::as_str)) else {
                    return;
                };
                *self.session = Some(Session { id: id.to_string(), resume: resume.to_string() });
                *self.me = d.get("user").and_then(|u| u.get("id")).and_then(snowflake);
                self.ready = true;
                super::set_link(CHAN, self.gen, Link::Ok);
            }
            "RESUMED" => {
                self.ready = true;
                super::set_link(CHAN, self.gen, Link::Ok);
            }
            "MESSAGE_CREATE" => {
                if let Some(m) = parse_message(d, *self.me) {
                    let _ = self.tx.send(Event::Message(m));
                }
            }
            "INTERACTION_CREATE" => {
                if let Some((id, token, press)) = parse_press(d) {
                    // 3초 안 — 일꾼의 차례를 기다리지 않는다
                    let client = self.client.clone();
                    let api = self.cfg.discord.api.clone();
                    tokio::spawn(async move { ack_press(&client, &api, id, &token).await });
                    let _ = self.tx.send(Event::Press(press));
                }
            }
            _ => {}
        }
    }
}

async fn next_json(ws: &mut Ws) -> Option<Value> {
    loop {
        match ws.next().await? {
            Ok(Message::Text(t)) => return serde_json::from_str(t.as_str()).ok(),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => continue,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 지어낸 값 — 조각으로 적어 컴파일 때 잇는다(소스에 토큰 꼴 글자가 통으로 있으면 저장소의 비밀 검사가 진짜 토큰으로 본다).
    const TOKEN: &str = concat!("MTIzNDU2Nzg5MDEy", "MzQ1Njc4", ".", "GabcDE", ".", "abcdefghijklmnopqrstuvwxyz", "0123456789ABCD");

    #[test]
    fn token_shape_and_redaction() {
        let t = BotToken::parse(&format!("  {TOKEN}\n")).expect("모양");
        assert_eq!(t.as_str(), TOKEN);
        assert_eq!(format!("{t:?}"), "BotToken(<redacted>)");
        for bad in ["", "a.b.c", "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ", &format!("{TOKEN}.x"), &TOKEN.replace('.', " "), &format!("Bot {TOKEN}")] {
            assert!(BotToken::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn escape_and_split() {
        assert_eq!(escape("**b** _i_ `c` <@1> [l](u)\nx"), r"\*\*b\*\* \_i\_ \`c\` \<@1\> \[l\]\(u\)".to_string() + "\nx");
        assert_eq!(render(&Text::headed("🟢 a*b", "x_y")), "**🟢 a\\*b**\nx\\_y");
        // 기호뿐인 답도 그린 뒤 상한 안 · 최대 5통 · 꼬리 · 울타리를 이어도(코어 `mend_fences`) 자르기 울타리에 닿지 않는다
        let head = "🟢 proj / wt";
        let more = "… (more)";
        let bodies = [
            "*_~`[]()<>#|\\".repeat(3000),
            "*a_".repeat(10_000),
            format!("앞\n```rust\n{}```\n끝", "let x = `a` < 1 && *p; // **\n".repeat(400)),
            format!("# 제목\n| a | b |\n|---|---|\n{}", "| x_y | <z> |\n".repeat(600)),
            "## h\n- **굵게**는 `c` [l](https://x.y) _i_ ~~s~~ <@1>\n> q *i*\n".repeat(300),
        ];
        for body in &bodies {
            let parts = super::super::logic::mend_fences(split_answer(head, body, more), more);
            assert_eq!(parts.len(), MAX_PARTS);
            for (i, p) in parts.iter().enumerate() {
                let r = markdown((i == 0).then_some(head), p);
                assert!(units(&r) <= CONTENT_ROOM && CONTENT_ROOM < CONTENT_MAX, "{i}: {}", units(&r));
            }
            assert!(parts[4].ends_with("\n… (more)"));
        }
        // 마크다운 답 — 서식은 Discord 기호 · 남의 글자의 멘션 · 가린 링크는 걷는다
        let r = render(&Text::Markdown { head: Some("🟢 a*b".into()), body: "**굵게**는 `x` [l](https://e.x) <@1>".into() });
        assert_eq!(r, r"**🟢 a\*b**".to_string() + "\n" + r"**굵게**는 `x` l \(https://e.x\) \<@1\>");
        assert_eq!(render(&Text::Markdown { head: None, body: "---".into() }), "…");
        // 문단에서 가른다
        let t = format!("{}\n\n{}", "a".repeat(1500), "b".repeat(1500));
        assert_eq!(split_answer("h", &t, "…"), ["a".repeat(1500), "b".repeat(1500)]);
        // 자르기는 걷기 짝을 가르지 않고 열린 굵게를 닫는다
        let c = clip(&format!("**{}", "\\*".repeat(50)), 20);
        assert!(c.ends_with("**…") && units(&c) <= 20, "{c}");
        assert!(!c.trim_end_matches("**…").ends_with("\\\\*"));
        let r = render(&Text::Rendered { text: format!("**x** {}", "가".repeat(3000)), tail: Some("Tool: a*b".into()) });
        assert!(r.ends_with("…\nTool: a\\*b") && units(&r) <= CONTENT_ROOM, "{}", units(&r));
    }

    #[test]
    fn bodies_and_parsing() {
        let b = message_body("x", Some(42), &[("A".into(), "p:1:0".into()), ("B".into(), "p:1:1".into())]);
        assert_eq!(b["allowed_mentions"]["parse"], json!([]));
        assert_eq!(b["message_reference"], json!({ "message_id": "42", "fail_if_not_exists": false }));
        assert_eq!(b["components"].as_array().unwrap().len(), 2, "한 줄에 하나");
        assert_eq!(b["components"][0]["components"][0]["custom_id"], "p:1:0");
        let many: Vec<Button> = (0..8).map(|i| ("가".repeat(100), format!("p:1:{i}"))).collect();
        let c = components(&many);
        assert_eq!(c.as_array().unwrap().len(), 2, "다섯 넘으면 줄마다 다섯");
        assert_eq!(c[0]["components"][0]["label"].as_str().unwrap().chars().count(), LABEL_MAX);
        assert!(components(&[("x".into(), "y".repeat(101))]).as_array().unwrap().is_empty());
        assert_eq!(edit_body("y")["components"], json!([]));
        assert!(message_body("x", None, &[]).get("components").is_none());

        assert_eq!(snowflake(&json!("1234")), Some(1234));
        for bad in [json!("-1"), json!("12a"), json!(""), json!(5), json!("99999999999999999999")] {
            assert_eq!(snowflake(&bad), None, "{bad}");
        }
        let id = ((1_800_000_000_000i64 - DISCORD_EPOCH_MS) << 22) | 7;
        assert_eq!(snowflake_secs(id), 1_800_000_000);
        let dm = json!({ "id": id.to_string(), "channel_id": "55", "type": 0, "content": "hi", "author": { "id": "9", "username": "u", "global_name": "Jin\u{7}" } });
        let m = parse_message(&dm, Some(1)).unwrap();
        assert_eq!((m.message_id, m.chat_id, m.from_id, m.date, m.private, m.from_name.as_str()), (id, 55, Some(9), 1_800_000_000, true, "Jin"));
        assert_eq!(m.text.as_deref(), Some("hi"));
        let with = |k: &str, v: Value| {
            let mut d = dm.clone();
            d[k] = v;
            parse_message(&d, Some(1)).is_none()
        };
        assert!(with("guild_id", json!("3")), "서버 글은 버린다");
        assert!(with("type", json!(7)));
        assert!(with("webhook_id", json!("4")));
        assert!(with("channel_type", json!(0)));
        assert!(with("author", json!({ "id": "9", "bot": true })));
        assert!(parse_message(&dm, Some(9)).is_none(), "우리 봇 자신");
        assert!(parse_message(&{ let mut d = dm.clone(); d["content"] = json!(""); d }, None).unwrap().text.is_none(), "첨부만 = 글 없음");
        let reply = parse_message(&{ let mut d = dm.clone(); d["type"] = json!(19); d["message_reference"] = json!({ "message_id": "77" }); d }, None).unwrap();
        assert_eq!(reply.reply_to, Some(77));

        let ix = json!({ "id": "100", "application_id": "200", "type": 3, "token": "tok_en-1.x", "channel_id": "55",
            "user": { "id": "9" }, "message": { "id": "300", "channel_id": "55" }, "data": { "custom_id": "pa:x", "component_type": 2 } });
        let (iid, tok, p) = parse_press(&ix).unwrap();
        assert_eq!((iid, tok.as_str(), p.from_id, p.chat_id, p.message_id, p.data.as_deref()), (100, "tok_en-1.x", 9, Some(55), Some(300), Some("pa:x")));
        assert!(parse_press(&{ let mut d = ix.clone(); d["guild_id"] = json!("1"); d }).is_none());
        assert!(parse_press(&{ let mut d = ix.clone(); d["type"] = json!(2); d }).is_none());
        assert!(parse_press(&{ let mut d = ix.clone(); d["token"] = json!("a/b"); d }).is_none());
    }

    #[test]
    fn responses_and_close_codes() {
        assert_eq!(parse_response(204, ""), Ok(Value::Null));
        assert_eq!(parse_response(401, "{}"), Err(CallErr::Unauthorized));
        assert_eq!(parse_response(500, "x"), Err(CallErr::Code(500)));
        assert_eq!(parse_response(200, "nope"), Err(CallErr::Malformed));
        assert_eq!(parse_me(&json!({ "username": "aynx.bot_1" })), Some("aynx.bot_1".into()));
        assert_eq!(parse_me(&json!({ "username": "bad name" })), None);
        assert_eq!(retry_after(r#"{"retry_after": 0.25, "global": false}"#, None), Duration::from_millis(250));
        assert_eq!(retry_after("x", Some("2")), Duration::from_secs(2));
        assert_eq!(retry_after(r#"{"retry_after": 64.57}"#, None), RETRY_CAP);
        for c in [4004, 4010, 4011, 4012, 4013, 4014] {
            assert_eq!(close_end(Some(c)), End::Fatal(c));
        }
        assert_eq!(close_end(Some(4007)), End::Fresh);
        assert_eq!(close_end(Some(4009)), End::Fresh);
        assert_eq!(close_end(Some(4000)), End::Resume);
        assert_eq!(close_end(None), End::Resume);
        assert_eq!(resume_url("wss://gateway-us-east1-b.discord.gg/").as_deref(), Some("wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json"));
        assert_eq!(resume_url("https://evil"), None);
        // 토큰을 다시 보내는 주소 — Discord 도메인만
        assert_eq!(resume_url("wss://evil.example/"), None);
        assert_eq!(resume_url("wss://discord.gg.evil.example/"), None);
        assert_eq!(resume_url("wss://gateway.discord.gg@evil.example/"), None);
        assert!(USER_AGENT.starts_with("DiscordBot (https://"));
    }
}
