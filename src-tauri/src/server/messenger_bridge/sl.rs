//! 메신저 다리의 Slack 전송 — Socket Mode 고리 · Web API · 누름 받음 · 토큰 확인.
//!
//! - **DM 만** — `channel_type` 이 `im` 이 아닌 글은 버린다. 누름은 메시지 단추(`container.type == "message"`)만.
//! - **PTY · 카드 결정 · 승인으로 가는 길이 없다** — 코어의 입구만 부른다(시험 `pty_writes_have_two_sites` · `bridge_has_no_approval_path` 가
//!   이 파일도 훑는다).
//! - **토큰이 둘이다** — 봇 토큰(Web API 에만)과 앱 수준 토큰(`apps.connections.open` 에만). **토큰이 나가는 곳은 `slack.com` 뿐이다** — REST 바탕은
//!   [`API_BASE`] 하나, WebSocket 은 `wss` 이고 호스트가 `slack.com` · `*.slack.com` 일 때만 붙는다([`socket_url_ok`] · 시험 `responses_urls_and_threads`).
//!   그 주소에는 토큰을 싣지 않고 주소도 로그에 싣지 않는다. 로그에는 고정 글자 · 오류 종류([`err_kind`])만.
//! - **멘션은 늘 막는다** — 남의 글자는 `rich_text` 블록의 글 조각으로(서식 · 멘션 · 링크로 읽히지 않는다), 그려 둔 알림 글은 `mrkdwn` 에
//!   `verbatim: true`, 미리 보기 `text` 도 `& < >` 를 걷는다. **`plain_text` section 은 쓰지 않는다** — Slack 웹이 그 글의 줄바꿈을 접는다.
//! - **id 는 `i64`** — 사용자 · 대화방 id 는 36진수로 읽고 되돌려 같은 글자일 때만([`id_num`]), 메시지 id 는 `ts` → `초 × 10⁶ + 마이크로초`([`ts_num`]).
//! - **스레드 = 답장** — Slack DM 에는 답장이 없고 스레드뿐이다. 스레드 안의 글에는 그 스레드로 답한다([`Threads`]).
//! - 방어 기계: 30초마다 Ping · 75초 조용하면 다시 붙기(반쯤 죽은 TCP) · 갓 붙은 연결이 곧 죽기를 거듭하면 물러남(`logic::Flap` — `refresh_requested`
//!   로 끊긴 것은 세지 않는다) · [`FATAL_ERRORS`] 와 `link_disabled` 면 고리를 끝낸다 · Web API 429 는 `Retry-After`(상한 [`RETRY_CAP`])만큼 쉬고
//!   **한 번만** 다시. 그 밖(재시도 큐 · 중복 제거 · 속도 제한기)은 없다.
//! - Slack 함정: **봉투마다 `{envelope_id}` 를 돌려보낸다**(안 보내면 다시 보낸다) · Web API 는 실패도 대개 HTTP 200 + `{ok: false}` ·
//!   `apps.connections.open` 에 몸 인자를 주면 오류 · section `text` 3000자를 무엇으로 세는지 문서에 없다(UTF-16 으로 재고 [`TEXT_ROOM`] 까지만).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

use super::logic::{Button, Flap};
use super::sock::{self, Event, Ws};
use super::{ButtonPress, Config, Incoming, Link, Text};
use crate::messenger::Channel;
use crate::server::log;

const CHAN: Channel = Channel::Slack;

/// 시험만 [`Conf::at`] 으로 루프백을 꽂는다.
pub(crate) const API_BASE: &str = "https://slack.com/api";
/// 조각으로 적는다 — 소스에 토큰 꼴 글자가 통으로 있으면 저장소의 비밀 검사가 진짜 토큰으로 본다.
const BOT_PREFIX: &str = concat!("xo", "xb-");
const APP_PREFIX: &str = concat!("xa", "pp-");
pub(crate) const TEXT_MAX: usize = 3000;
pub(crate) const TEXT_ROOM: usize = 2900;
const _: () = assert!(TEXT_ROOM < TEXT_MAX);
/// 알림 미리 보기용 `text` 의 자리.
const FALLBACK_ROOM: usize = 300;
pub(crate) const MAX_PARTS: usize = 5;
pub(crate) const DATA_MAX: usize = 100;
const LABEL_MAX: usize = 75;
const HEAD_ROOM: usize = 500;
/// 36¹² < 2⁶³.
const ID_MAX: usize = 12;
const THREADS_KEEP: usize = 64;
/// 다시 붙지 않는 `apps.connections.open` 오류 — 인증 · 권한.
pub(crate) const FATAL_ERRORS: &[&str] =
    &["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "not_allowed_token_type", "missing_scope", "no_permission"];
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const RETRY_CAP: Duration = Duration::from_secs(5);
const HELLO_TIMEOUT: Duration = Duration::from_secs(20);
const PING: Duration = Duration::from_secs(30);
const IDLE: Duration = Duration::from_secs(75);
const CONNECT_BACKOFF: Duration = Duration::from_secs(5);
const CONNECT_BACKOFF_MAX: Duration = Duration::from_secs(300);
const STABLE: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// 설정 · 토큰
// ---------------------------------------------------------------------------

pub(crate) struct Conf {
    api: String,
    pub hello_timeout: Duration,
    pub ping: Duration,
    pub idle: Duration,
    pub connect_backoff: Duration,
    pub connect_backoff_max: Duration,
    pub stable: Duration,
}

impl Conf {
    pub(crate) fn release() -> Conf {
        Conf {
            api: API_BASE.to_string(),
            hello_timeout: HELLO_TIMEOUT,
            ping: PING,
            idle: IDLE,
            connect_backoff: CONNECT_BACKOFF,
            connect_backoff_max: CONNECT_BACKOFF_MAX,
            stable: STABLE,
        }
    }

    #[cfg(test)]
    pub(crate) fn at(api: &str) -> Conf {
        Conf { api: api.trim_end_matches('/').to_string(), ..Conf::release() }
    }
}

/// 파일 몸 그대로 `"<봇 토큰>\n<앱 수준 토큰>"`. **`Debug` 는 값을 찍지 않는다** · `Display` 없음.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct BotToken(String);

impl std::fmt::Debug for BotToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BotToken(<redacted>)")
    }
}

impl BotToken {
    /// 두 조각의 차례는 무관하다. 정확한 꼴은 Slack 이 정하므로 넉넉히 본다.
    pub(crate) fn parse(raw: &str) -> Option<BotToken> {
        let parts: Vec<&str> = raw.split_whitespace().collect();
        let [a, b] = parts.as_slice() else { return None };
        let piece = |p: &str| (20..=300).contains(&p.len()) && p.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-');
        let (bot, app) = if a.starts_with(BOT_PREFIX) && b.starts_with(APP_PREFIX) {
            (a, b)
        } else if a.starts_with(APP_PREFIX) && b.starts_with(BOT_PREFIX) {
            (b, a)
        } else {
            return None;
        };
        (piece(bot) && piece(app)).then(|| BotToken(format!("{bot}\n{app}")))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// Web API 에만.
    fn bot(&self) -> &str {
        self.0.split('\n').next().unwrap_or("")
    }

    /// `apps.connections.open` 에만.
    fn app(&self) -> &str {
        self.0.split('\n').nth(1).unwrap_or("")
    }
}

pub(crate) fn parse_token(raw: &str) -> Option<BotToken> {
    BotToken::parse(raw)
}

/// 받음 알림은 봉투 답으로 이미 끝났다. **`Debug` 없음**.
pub(crate) struct Ack {
    channel: String,
    user: String,
}

fn hands(gen: Option<u64>) -> Option<(reqwest::Client, Arc<Config>, BotToken)> {
    let (client, cfg, token) = super::hands(CHAN, gen)?;
    Some((client, cfg, token.slack()?.clone()))
}

// ---------------------------------------------------------------------------
// id
// ---------------------------------------------------------------------------

/// 되돌려 쓴 글자가 같지 않으면 `None`.
pub(crate) fn id_num(s: &str) -> Option<i64> {
    if s.is_empty() || s.len() > ID_MAX || !s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
        return None;
    }
    let n = i64::from_str_radix(s, 36).ok()?;
    (id_text(n) == s).then_some(n)
}

pub(crate) fn id_text(n: i64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut n = n.max(0) as u64;
    let mut out = Vec::new();
    loop {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// `ts` 는 "초.마이크로초 6자리".
pub(crate) fn ts_num(s: &str) -> Option<i64> {
    let (secs, micros) = s.split_once('.')?;
    let digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    if !digits(secs) || secs.len() > 12 || micros.len() != 6 || !digits(micros) {
        return None;
    }
    secs.parse::<i64>().ok()?.checked_mul(1_000_000)?.checked_add(micros.parse::<i64>().ok()?)
}

pub(crate) fn ts_text(n: i64) -> String {
    let n = n.max(0);
    format!("{}.{:06}", n / 1_000_000, n % 1_000_000)
}

// ---------------------------------------------------------------------------
// 스레드 뿌리 표
// ---------------------------------------------------------------------------

/// 받은 글 ts → 그 글이 든 스레드의 뿌리 ts(스레드 안의 글만).
#[derive(Default)]
pub(crate) struct Threads {
    order: VecDeque<i64>,
    map: HashMap<i64, i64>,
}

impl Threads {
    pub(crate) fn note(&mut self, ts: i64, root: i64) {
        if self.map.insert(ts, root).is_none() {
            self.order.push_back(ts);
        }
        while self.order.len() > THREADS_KEEP {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
    }

    pub(crate) fn root(&self, ts: i64) -> Option<i64> {
        self.map.get(&ts).copied()
    }

    pub(crate) fn clear(&mut self) {
        self.order.clear();
        self.map.clear();
    }
}

static THREADS: LazyLock<Mutex<Threads>> = LazyLock::new(|| Mutex::new(Threads::default()));

fn threads() -> std::sync::MutexGuard<'static, Threads> {
    THREADS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 잠금은 이 표 하나 — 다리 잠금을 부르지 않는다.
pub(super) fn forget() {
    threads().clear();
}

// ---------------------------------------------------------------------------
// 글자
// ---------------------------------------------------------------------------

pub(crate) fn units(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// 멘션 · 링크는 전부 `<…>` 라 이것으로 막힌다.
pub(crate) fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// 받은 글자 되돌리기 — `<url|글자>` 는 글자를 살린다(사람이 친 `main.rs` 를 Slack 이 `<http://main.rs|main.rs>` 로 바꾼다). `&amp;` 는 맨 끝에.
pub(crate) fn unslack(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else {
            out.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let inner = &after[..close];
        let (target, label) = match inner.split_once('|') {
            Some((t, l)) => (t, Some(l).filter(|l| !l.is_empty())),
            None => (inner, None),
        };
        let piece = if let Some(id) = target.strip_prefix('@') {
            format!("@{}", label.unwrap_or(id))
        } else if let Some(id) = target.strip_prefix('#') {
            format!("#{}", label.unwrap_or(id))
        } else if let Some(word) = target.strip_prefix('!') {
            match label {
                Some(l) => l.to_string(),
                None => format!("@{word}"),
            }
        } else {
            label.unwrap_or(target).to_string()
        };
        out.push_str(&piece);
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn clip_plain(text: &str, max: usize) -> String {
    if units(text) <= max {
        return text.to_string();
    }
    let budget = max.saturating_sub(1);
    let mut used = 0;
    let mut out = String::new();
    for c in text.chars() {
        if used + c.len_utf16() > budget {
            break;
        }
        used += c.len_utf16();
        out.push(c);
    }
    out.push('…');
    out
}

/// `&amp;` 같은 걷기 조각 가운데를 가르지 않는다.
pub(crate) fn clip_mrkdwn(text: &str, max: usize) -> String {
    if units(text) <= max {
        return text.to_string();
    }
    let mut out = clip_plain(text, max.saturating_sub(1));
    out.pop();
    if let Some(amp) = out.rfind('&') {
        if !out[amp..].contains(';') {
            out.truncate(amp);
        }
    }
    if out.matches('*').count() % 2 == 1 {
        out.push('*');
    }
    out.push('…');
    out
}

fn section_mrkdwn(text: &str) -> Value {
    json!({ "type": "section", "text": { "type": "mrkdwn", "text": clip_mrkdwn(text, TEXT_ROOM), "verbatim": true } })
}

/// 남의 글자는 이 블록으로만 싣는다 — 서식 · 멘션 · 링크로 읽히지 않고 줄바꿈이 산다(머리말).
fn rich(head: Option<&str>, body: &str) -> Option<Value> {
    let head: Option<String> = head
        .map(|h| h.chars().filter(|c| !c.is_control()).collect::<String>())
        .map(|h| clip_plain(h.trim(), HEAD_ROOM))
        .filter(|h| !h.is_empty());
    let body = Some(clip_plain(body, TEXT_ROOM)).filter(|b| !b.trim().is_empty());
    let mut els = Vec::new();
    if let Some(h) = &head {
        els.push(json!({ "type": "text", "text": h, "style": { "bold": true } }));
    }
    if let Some(b) = body {
        els.push(json!({ "type": "text", "text": if head.is_some() { format!("\n{b}") } else { b } }));
    }
    (!els.is_empty()).then(|| json!({ "type": "rich_text", "elements": [{ "type": "rich_text_section", "elements": els }] }))
}

pub(crate) fn blocks(t: &Text) -> Vec<Value> {
    let mut out = Vec::new();
    match t {
        Text::Lines { head, body } => out.extend(rich(head.as_deref(), body)),
        Text::Rendered { text, tail } => {
            if !text.trim().is_empty() {
                out.push(section_mrkdwn(text));
            }
            out.extend(tail.as_deref().and_then(|t| rich(None, t)));
        }
    }
    if out.is_empty() {
        out.extend(rich(None, "…"));
    }
    out
}

/// 알림 미리 보기용 `text` — 이것도 `& < >` 를 걷는다.
pub(crate) fn fallback(t: &Text) -> String {
    let s = match t {
        Text::Lines { head: Some(h), body } => clip_mrkdwn(&escape(&format!("{h}\n{body}")), FALLBACK_ROOM),
        Text::Lines { head: None, body } => clip_mrkdwn(&escape(body), FALLBACK_ROOM),
        Text::Rendered { text, .. } => clip_mrkdwn(text, FALLBACK_ROOM),
    };
    if s.trim().is_empty() {
        "…".to_string()
    } else {
        s
    }
}

/// 다섯 이하면 블록 하나에 단추 하나(세로로 쌓인다 — 다른 채널과 같은 모양). `action_id` 는 블록 안에서 겹치지 않아야 한다.
pub(crate) fn actions(buttons: &[Button]) -> Vec<Value> {
    let ok: Vec<Value> = buttons
        .iter()
        .filter(|(_, data)| !data.is_empty() && data.chars().count() <= DATA_MAX)
        .filter_map(|(label, data)| {
            let label: String = label.chars().filter(|c| !c.is_control()).take(LABEL_MAX).collect();
            (!label.trim().is_empty()).then_some((label, data))
        })
        .enumerate()
        .map(|(i, (label, data))| {
            json!({ "type": "button", "text": { "type": "plain_text", "text": label, "emoji": false }, "action_id": format!("a{i}"), "value": data })
        })
        .collect();
    let per = if ok.len() <= 5 { 1 } else { 5 };
    ok.chunks(per).take(5).map(|c| json!({ "type": "actions", "elements": c })).collect()
}

pub(crate) fn post_body(channel: &str, t: &Text, thread: Option<&str>, buttons: &[Button]) -> Value {
    let mut blocks = blocks(t);
    blocks.extend(actions(buttons));
    let mut v = json!({ "channel": channel, "text": fallback(t), "blocks": blocks, "unfurl_links": false, "unfurl_media": false });
    if let Some(ts) = thread {
        v["thread_ts"] = json!(ts);
    }
    v
}

/// 단추(actions)는 뺀다.
pub(crate) fn update_body(channel: &str, ts: &str, t: &Text) -> Value {
    json!({ "channel": channel, "ts": ts, "text": fallback(t), "blocks": blocks(t) })
}

/// 머리 줄은 따로 조각이라 몸마다 [`TEXT_ROOM`] 단위.
pub(crate) fn split_answer(_head: &str, body: &str, more: &str) -> Vec<String> {
    super::logic::split_by(body, TEXT_ROOM, MAX_PARTS, more, char::len_utf16)
}

// ---------------------------------------------------------------------------
// Web API
// ---------------------------------------------------------------------------

/// 문구 없이 종류만 — 토큰 · Slack 의 설명 글을 싣지 않는다.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CallErr {
    /// Slack 의 오류 코드 낱말 — 로그에 실리므로 소문자 · 숫자 · `_` 40자로 거른다
    Api(String),
    RateLimited,
    Code(u16),
    Malformed,
    Transport,
}

pub(crate) fn err_kind(e: &CallErr) -> String {
    match e {
        CallErr::Api(code) => code.clone(),
        CallErr::RateLimited => "429".into(),
        CallErr::Code(c) => format!("http {c}"),
        CallErr::Malformed => "malformed".into(),
        CallErr::Transport => "transport".into(),
    }
}

/// 2xx 라도 `ok` 가 참이 아니면 오류다(Slack 은 실패도 대개 200).
pub(crate) fn parse_response(status: u16, body: &str) -> Result<Value, CallErr> {
    match status {
        429 => Err(CallErr::RateLimited),
        200..=299 => {
            let v: Value = serde_json::from_str(body).map_err(|_| CallErr::Malformed)?;
            if v.get("ok").and_then(Value::as_bool) == Some(true) {
                return Ok(v);
            }
            let code: String = v
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .chars()
                .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_')
                .take(40)
                .collect();
            Err(CallErr::Api(if code.is_empty() { "unknown".into() } else { code }))
        }
        c => Err(CallErr::Code(c)),
    }
}

pub(crate) fn retry_after(header: Option<&str>) -> Duration {
    let secs = header.and_then(|h| h.trim().parse::<f64>().ok()).unwrap_or(1.0);
    Duration::from_secs_f64(secs.clamp(0.0, RETRY_CAP.as_secs_f64()))
}

/// 어느 토큰을 실을지는 부르는 쪽이 고른다(머리말).
async fn call(client: &reqwest::Client, api: &str, token: &str, method: &str, body: Option<&Value>) -> Result<Value, CallErr> {
    for attempt in 0..2 {
        let mut rq = client.post(format!("{api}/{method}")).timeout(SEND_TIMEOUT).header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
        rq = match body {
            Some(b) => rq.header(reqwest::header::CONTENT_TYPE, "application/json; charset=utf-8").body(b.to_string()),
            None => rq.header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded").body(""),
        };
        let res = rq.send().await.map_err(|_| CallErr::Transport)?;
        let status = res.status().as_u16();
        let header = res.headers().get(reqwest::header::RETRY_AFTER).and_then(|h| h.to_str().ok()).map(str::to_string);
        let text = res.text().await.map_err(|_| CallErr::Transport)?;
        if status == 429 && attempt == 0 {
            tokio::time::sleep(retry_after(header.as_deref())).await;
            continue;
        }
        return parse_response(status, &text);
    }
    Err(CallErr::RateLimited)
}

/// `reply_to` 가 스레드 안의 받은 글이면 그 스레드로(머리말).
pub(crate) async fn send(chat: i64, t: &Text, reply_to: Option<i64>, buttons: &[Button]) -> Option<i64> {
    let (client, cfg, token) = hands(None)?;
    let thread = reply_to.and_then(|id| threads().root(id)).map(ts_text);
    let body = post_body(&id_text(chat), t, thread.as_deref(), buttons);
    match call(&client, &cfg.slack.api, token.bot(), "chat.postMessage", Some(&body)).await {
        Ok(v) => ts_num(v.get("ts")?.as_str()?),
        Err(e) => {
            log::line(format!("messenger bridge — slack chat.postMessage failed ({})", err_kind(&e)));
            None
        }
    }
}

pub(crate) async fn edit(chat: i64, message_id: i64, t: &Text) {
    let Some((client, cfg, token)) = hands(None) else { return };
    let body = update_body(&id_text(chat), &ts_text(message_id), t);
    if let Err(e) = call(&client, &cfg.slack.api, token.bot(), "chat.update", Some(&body)).await {
        log::line(format!("messenger bridge — slack chat.update failed ({})", err_kind(&e)));
    }
}

/// 바꿔 쓰면 그 결과 줄이 곧 알림이라 `toast` 는 바꿔 쓰지 않을 때만 보낸다.
pub(crate) async fn finish_press(ack: &Ack, toast: Option<&str>, rewritten: bool) {
    let Some(text) = toast.filter(|_| !rewritten) else { return };
    let Some((client, cfg, token)) = hands(None) else { return };
    let body = json!({ "channel": ack.channel, "user": ack.user, "text": clip_mrkdwn(&escape(text), FALLBACK_ROOM) });
    if let Err(e) = call(&client, &cfg.slack.api, token.bot(), "chat.postEphemeral", Some(&body)).await {
        log::line(format!("messenger bridge — slack chat.postEphemeral failed ({})", err_kind(&e)));
    }
}

pub(crate) fn parse_auth(v: &Value) -> Option<String> {
    let name = v.get("user")?.as_str()?;
    let ok = !name.is_empty() && name.len() <= 80 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-');
    ok.then(|| name.to_string())
}

/// 실패 문구는 어느 토큰이 틀렸는지 가르고 토큰은 싣지 않는다. `apps.connections.open` 이 준 주소는 쓰지 않는다.
pub(crate) async fn check_token(client: &reqwest::Client, cfg: &Config, token: &BotToken) -> Result<Option<String>, String> {
    let name = match call(client, &cfg.slack.api, token.bot(), "auth.test", None).await {
        Ok(v) => parse_auth(&v),
        Err(CallErr::Api(code)) => return Err(format!("[bad-token] slack rejected the bot token ({code})")),
        Err(e) => return Err(format!("[unreachable] auth.test failed ({})", err_kind(&e))),
    };
    match call(client, &cfg.slack.api, token.app(), "apps.connections.open", None).await {
        Ok(_) => Ok(name),
        Err(CallErr::Api(code)) => Err(format!("[bad-token] slack rejected the app-level token ({code})")),
        Err(e) => Err(format!("[unreachable] apps.connections.open failed ({})", err_kind(&e))),
    }
}

// ---------------------------------------------------------------------------
// 받은 것
// ---------------------------------------------------------------------------

/// DM 이 아니면 버린다. `Err` = id 꼴이 틀려 버린다(부른 쪽이 고정 글자 한 줄 — 받은 글은 로그에 싣지 않는다).
#[allow(clippy::result_unit_err)]
pub(crate) fn parse_message(payload: &Value) -> Result<Option<(Incoming, Option<i64>)>, ()> {
    let Some(ev) = payload.get("event") else { return Ok(None) };
    if ev.get("type").and_then(Value::as_str) != Some("message") || ev.get("channel_type").and_then(Value::as_str) != Some("im") {
        return Ok(None);
    }
    if ev.get("bot_id").is_some_and(|b| !b.is_null()) {
        return Ok(None);
    }
    let file_only = match ev.get("subtype").and_then(Value::as_str) {
        None => false,
        Some("file_share") => true,
        Some(_) => return Ok(None),
    };
    let Some(user) = ev.get("user").and_then(Value::as_str) else { return Ok(None) };
    let from = id_num(user).ok_or(())?;
    let chat = ev.get("channel").and_then(Value::as_str).and_then(id_num).ok_or(())?;
    let ts = ev.get("ts").and_then(Value::as_str).and_then(ts_num).ok_or(())?;
    let root = ev.get("thread_ts").and_then(Value::as_str).and_then(ts_num).filter(|&r| r != ts);
    let text = if file_only { None } else { ev.get("text").and_then(Value::as_str).map(unslack).filter(|t| !t.is_empty()) };
    let m = Incoming {
        message_id: ts,
        from_id: Some(from),
        from_name: user.to_string(),
        chat_id: chat,
        private: true,
        date: ts / 1_000_000,
        text,
        reply_to: root,
    };
    Ok(Some((m, root)))
}

#[allow(clippy::result_unit_err)]
pub(crate) fn parse_press(payload: &Value) -> Result<Option<ButtonPress>, ()> {
    if payload.get("type").and_then(Value::as_str) != Some("block_actions") {
        return Ok(None);
    }
    let container = payload.get("container");
    if container.and_then(|c| c.get("type")).and_then(Value::as_str) != Some("message") {
        return Ok(None);
    }
    let Some(user) = payload.get("user").and_then(|u| u.get("id")).and_then(Value::as_str) else { return Ok(None) };
    let channel = payload
        .get("channel")
        .and_then(|c| c.get("id"))
        .and_then(Value::as_str)
        .or_else(|| container.and_then(|c| c.get("channel_id")).and_then(Value::as_str));
    let Some(channel) = channel else { return Ok(None) };
    let from = id_num(user).ok_or(())?;
    let chat = id_num(channel).ok_or(())?;
    let message_id = payload
        .get("message")
        .and_then(|m| m.get("ts"))
        .and_then(Value::as_str)
        .or_else(|| container.and_then(|c| c.get("message_ts")).and_then(Value::as_str))
        .and_then(ts_num);
    let data = payload.get("actions").and_then(|a| a.get(0)).and_then(|a| a.get("value")).and_then(Value::as_str).map(str::to_string);
    Ok(Some(ButtonPress {
        from_id: from,
        chat_id: Some(chat),
        message_id,
        data,
        ack: super::Ack::Slack(Ack { channel: channel.to_string(), user: user.to_string() }),
    }))
}

/// 토큰 경계(머리말) — `slack.com` 도메인의 `wss` 만.
pub(crate) fn socket_url_ok(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    let Some(host) = u.host_str() else { return false };
    if !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    match u.scheme() {
        "wss" => host == "slack.com" || host.ends_with(".slack.com"),
        "ws" => cfg!(test) && host == "127.0.0.1",
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Socket Mode
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
enum End {
    Again,
    /// `refresh_requested` — 몇 시간마다 오는 평소 일(물러남에 세지 않는다)
    Refresh,
    /// `link_disabled` — Socket Mode 가 꺼졌다(멈춘다)
    Disabled,
}

pub(super) async fn socket_loop(gen: u64) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    tokio::spawn(sock::worker(CHAN, gen, rx));
    let mut flap = Flap::default();
    let mut hello_at: Option<tokio::time::Instant> = None;
    loop {
        let Some((client, cfg, token)) = hands(Some(gen)) else { return };
        let short = hello_at.is_some_and(|at| at.elapsed() < cfg.slack.stable);
        if let Some(w) = flap.delay(short, cfg.slack.connect_backoff, cfg.slack.connect_backoff_max) {
            tokio::time::sleep(w).await;
            if hands(Some(gen)).is_none() {
                return;
            }
        }
        let opened = call(&client, &cfg.slack.api, token.app(), "apps.connections.open", None).await;
        if hands(Some(gen)).is_none() {
            return;
        }
        let url = match opened {
            Ok(v) => {
                let url = v.get("url").and_then(Value::as_str).filter(|u| socket_url_ok(u)).map(str::to_string);
                if url.is_none() {
                    log::line("messenger bridge — slack socket url refused");
                }
                url
            }
            Err(CallErr::Api(code)) if FATAL_ERRORS.contains(&code.as_str()) => {
                log::line(format!("messenger bridge — slack apps.connections.open refused for good ({code})"));
                super::set_link(CHAN, gen, Link::Error);
                return;
            }
            Err(e) => {
                log::line(format!("messenger bridge — slack apps.connections.open failed ({})", err_kind(&e)));
                None
            }
        };
        let ws = match url {
            Some(u) => sock::connect(&u).await,
            None => None,
        };
        let Some(mut ws) = ws else {
            log::line("messenger bridge — slack socket connect failed");
            super::set_link(CHAN, gen, Link::Error);
            tokio::time::sleep(cfg.backoff).await;
            continue;
        };
        let (end, hello) = session(&mut ws, gen, &cfg, &tx).await;
        if hello.is_some() {
            hello_at = hello;
        }
        if hands(Some(gen)).is_none() {
            return;
        }
        match end {
            End::Disabled => {
                log::line("messenger bridge — slack socket mode disabled (link_disabled)");
                super::set_link(CHAN, gen, Link::Error);
                return;
            }
            End::Refresh => hello_at = None,
            End::Again => {}
        }
        if hello.is_none() {
            // `hello` 전에 끝났다 — 곧바로 다시 두드리지 않는다
            super::set_link(CHAN, gen, Link::Error);
            tokio::time::sleep(cfg.backoff).await;
        }
    }
}

async fn close(ws: &mut Ws) {
    let _ = tokio::time::timeout(Duration::from_secs(2), ws.close(None)).await;
}

async fn wait_hello(ws: &mut Ws) -> Option<Value> {
    loop {
        match ws.next().await? {
            Ok(Message::Text(t)) => {
                let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
                match v.get("type").and_then(Value::as_str) {
                    Some("hello") => return Some(v),
                    Some("disconnect") => return None,
                    _ => {}
                }
            }
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

/// 둘째 값은 `hello` 를 받은 때.
async fn session(ws: &mut Ws, gen: u64, cfg: &Config, tx: &tokio::sync::mpsc::UnboundedSender<Event>) -> (End, Option<tokio::time::Instant>) {
    let Some(hello) = tokio::time::timeout(cfg.slack.hello_timeout, wait_hello(ws)).await.ok().flatten() else {
        close(ws).await;
        return (End::Again, None);
    };
    let at = tokio::time::Instant::now();
    // 연결 수는 로그에 숫자만 — 상태 `conflict` 로 쓰지 않는다
    let n = hello.get("num_connections").and_then(Value::as_u64).unwrap_or(0);
    log::line(format!("messenger bridge — slack socket connected (connections {n})"));
    super::set_link(CHAN, gen, Link::Ok);
    let mut ping = tokio::time::interval_at(at + cfg.slack.ping, cfg.slack.ping);
    let mut last = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = ping.tick() => {
                if ws.send(Message::Ping(Default::default())).await.is_err() {
                    return (End::Again, Some(at));
                }
            }
            _ = tokio::time::sleep_until(last + cfg.slack.idle) => {
                // 반쯤 죽은 TCP — 다른 길로는 알 수 없다
                log::line("messenger bridge — slack socket quiet, reconnecting");
                close(ws).await;
                return (End::Again, Some(at));
            }
            msg = ws.next() => {
                last = tokio::time::Instant::now();
                let v = match msg {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return (End::Again, Some(at)),
                    Some(Ok(Message::Text(t))) => match serde_json::from_str::<Value>(t.as_str()) {
                        Ok(v) => v,
                        Err(_) => continue,
                    },
                    Some(Ok(_)) => continue,
                };
                if let Some(id) = v.get("envelope_id").and_then(Value::as_str) {
                    // 먼저 받음 답 — 안 보내면 Slack 이 같은 봉투를 다시 보낸다
                    let acked = ws.send(Message::text(json!({ "envelope_id": id }).to_string())).await.is_ok();
                    dispatch(&v, tx);
                    if !acked {
                        return (End::Again, Some(at));
                    }
                    continue;
                }
                if v.get("type").and_then(Value::as_str) == Some("disconnect") {
                    close(ws).await;
                    let end = match v.get("reason").and_then(Value::as_str) {
                        Some("link_disabled") => End::Disabled,
                        Some("refresh_requested") => End::Refresh,
                        _ => End::Again,
                    };
                    return (end, Some(at));
                }
            }
        }
    }
}

/// 기다리지 않는다.
fn dispatch(v: &Value, tx: &tokio::sync::mpsc::UnboundedSender<Event>) {
    let payload = v.get("payload").unwrap_or(&Value::Null);
    let parsed = match v.get("type").and_then(Value::as_str) {
        Some("events_api") => parse_message(payload).map(|o| {
            o.map(|(m, root)| {
                if let Some(r) = root {
                    threads().note(m.message_id, r);
                }
                Event::Message(m)
            })
        }),
        Some("interactive") => parse_press(payload).map(|o| o.map(Event::Press)),
        _ => Ok(None),
    };
    match parsed {
        Ok(Some(ev)) => {
            let _ = tx.send(ev);
        }
        Ok(None) => {}
        Err(()) => log::line("messenger bridge — slack event dropped (id shape)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 지어낸 값 — 조각으로 적는다(머리말 · 저장소의 비밀 검사).
    const BOT: &str = concat!("xo", "xb-", "1234567890", "-", "1234567890123", "-", "abcdefghijklmnopqrstuvwx");
    const APP: &str = concat!("xa", "pp-", "1", "-", "A0123456789", "-", "1234567890123", "-", "abcdef0123456789abcdef0123456789");

    #[test]
    fn token_shape_order_and_redaction() {
        let t = BotToken::parse(&format!("  {BOT}\n{APP}  ")).expect("모양");
        assert_eq!(t.as_str(), format!("{BOT}\n{APP}"));
        assert_eq!((t.bot(), t.app()), (BOT, APP));
        assert_eq!(BotToken::parse(&format!("{APP} {BOT}")), Some(t.clone()), "차례 무관");
        assert_eq!(format!("{t:?}"), "BotToken(<redacted>)");
        let short = format!("{BOT_PREFIX}1");
        for bad in [
            String::new(),
            BOT.to_string(),
            format!("{BOT} {BOT}"),
            format!("{APP} {APP}"),
            format!("{BOT} {APP} {APP}"),
            format!("{BOT}_x {APP}"),
            format!("{short} {APP}"),
            format!("Bearer {BOT}"),
        ] {
            assert!(BotToken::parse(&bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn ids_round_trip() {
        for id in ["U024BE7LH", "D024BE91L", "W0123ABC", "ZZZZZZZZZZZZ", "U1"] {
            let n = id_num(id).unwrap_or_else(|| panic!("{id}"));
            assert_eq!(id_text(n), id);
        }
        for bad in ["", "u024be7lh", "0U1", "ZZZZZZZZZZZZZ", "U-1", "U 1"] {
            assert_eq!(id_num(bad), None, "{bad:?}");
        }
        assert_eq!(ts_num("1355517523.000005"), Some(1_355_517_523_000_005));
        assert_eq!(ts_text(1_355_517_523_000_005), "1355517523.000005");
        assert_eq!(ts_text(ts_num("1800000000.123456").unwrap()), "1800000000.123456");
        for bad in ["", "1355517523", "1355517523.5", "1355517523.0000051", "a.000001", ".000001", "-1.000001", "9999999999999.000001"] {
            assert_eq!(ts_num(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn incoming_text_is_restored() {
        assert_eq!(unslack("hi <@U123> and <#C123|general> <!here> <!subteam^S1|@devs>"), "hi @U123 and #general @here @devs");
        assert_eq!(unslack("see <http://main.rs|main.rs> or <https://example.com>"), "see main.rs or https://example.com");
        assert_eq!(unslack("a &lt;b&gt; &amp;lt; c"), "a <b> &lt; c", "&amp; 는 맨 끝에");
        assert_eq!(unslack("<!channel> x &lt; y"), "@channel x < y");
        assert_eq!(unslack("open <never closes"), "open <never closes");
        assert_eq!(unslack("<mailto:a@example.com|a@example.com>"), "a@example.com");
    }

    #[test]
    fn blocks_and_clipping() {
        // 평문 — rich_text 한 블록: 굵은 머리 조각 + 줄바꿈으로 시작하는 몸(기호 · 멘션 꼴 · 줄바꿈이 글자 그대로 · 걷지 않는다)
        let b = blocks(&Text::headed("🟢 a*b_c `d` <e>", "x *y* <@U1> & z\nline 2"));
        assert_eq!(b.len(), 1);
        assert_eq!(
            b[0],
            json!({ "type": "rich_text", "elements": [{ "type": "rich_text_section", "elements": [
                { "type": "text", "text": "🟢 a*b_c `d` <e>", "style": { "bold": true } },
                { "type": "text", "text": "\nx *y* <@U1> & z\nline 2" },
            ] }] })
        );
        assert!(!b[0].to_string().contains("plain_text"), "plain_text section 은 줄바꿈이 접힌다");
        let plain = blocks(&Text::plain("a\nb"));
        assert_eq!(plain[0]["elements"][0]["elements"], json!([{ "type": "text", "text": "a\nb" }]));
        assert_eq!(blocks(&Text::plain("")).len(), 1, "빈 글도 블록 하나");
        let r = blocks(&Text::Rendered { text: "*a* &lt;b&gt;".into(), tail: Some("Tool: x*y".into()) });
        assert_eq!(r[0]["text"]["verbatim"], true);
        assert_eq!(r[1]["elements"][0]["elements"][0]["text"], "Tool: x*y");
        let long = blocks(&Text::headed("h", "가".repeat(5000)));
        assert!(units(long[0]["elements"][0]["elements"][1]["text"].as_str().unwrap()) <= TEXT_ROOM + 1);
        // 자르기 — 걷기 조각 가운데를 가르지 않고 열린 `*` 는 닫는다
        let c = clip_mrkdwn(&format!("*{}", "&amp;".repeat(50)), 22);
        assert!(units(&c) <= 22 && c.ends_with("*…"), "{c}");
        assert!(c.trim_end_matches("*…").ends_with("&amp;"), "{c}");
        let big = blocks(&Text::Rendered { text: "가".repeat(5000), tail: None });
        assert!(units(big[0]["text"]["text"].as_str().unwrap()) <= TEXT_ROOM);
        assert_eq!(fallback(&Text::headed("h", "<b> & c")), "h\n&lt;b&gt; &amp; c");
        assert!(units(&fallback(&Text::plain("x".repeat(5000)))) <= FALLBACK_ROOM);
    }

    #[test]
    fn answer_split_and_actions() {
        let body = "z".repeat(30_000);
        let parts = split_answer("🟢 x", &body, "… (more)");
        assert_eq!(parts.len(), MAX_PARTS);
        for p in &parts {
            assert!(units(p) <= TEXT_ROOM);
        }
        assert!(parts[4].ends_with("… (more)"));
        let t = format!("{}\n\n{}", "a".repeat(2000), "b".repeat(2000));
        assert_eq!(split_answer("h", &t, "…"), ["a".repeat(2000), "b".repeat(2000)]);

        let two = actions(&[("A".into(), "p:1:0".into()), ("B".into(), "p:1:1".into())]);
        assert_eq!(two.len(), 2, "다섯 이하면 블록마다 하나");
        assert_eq!(
            two[1]["elements"][0],
            json!({ "type": "button", "text": { "type": "plain_text", "text": "B", "emoji": false }, "action_id": "a1", "value": "p:1:1" })
        );
        let many: Vec<Button> = (0..8).map(|i| ("가".repeat(100), format!("p:1:{i}"))).collect();
        let m = actions(&many);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0]["elements"].as_array().unwrap().len(), 5);
        assert_eq!(m[0]["elements"][0]["text"]["text"].as_str().unwrap().chars().count(), LABEL_MAX);
        assert!(actions(&[("x".into(), "y".repeat(101))]).is_empty());
        let body = post_body("D024BE91L", &Text::plain("q"), Some("1.000001"), &[("A".into(), "p:1:0".into())]);
        assert_eq!((body["thread_ts"].as_str(), body["unfurl_links"].as_bool(), body["unfurl_media"].as_bool()), (Some("1.000001"), Some(false), Some(false)));
        assert_eq!(body["blocks"].as_array().unwrap().len(), 2);
        assert!(post_body("D1", &Text::plain("q"), None, &[]).get("thread_ts").is_none());
        let up = update_body("D1", "1.000001", &Text::plain("done"));
        assert!(up["blocks"].as_array().unwrap().iter().all(|b| b["type"] != "actions"));
    }

    #[test]
    fn responses_urls_and_threads() {
        assert_eq!(parse_response(200, r#"{"ok":true,"ts":"1.000001"}"#).unwrap()["ts"], "1.000001");
        assert_eq!(parse_response(200, r#"{"ok":false,"error":"invalid_auth"}"#), Err(CallErr::Api("invalid_auth".into())));
        assert_eq!(parse_response(200, r#"{"ok":false,"error":"Bad <x>"}"#), Err(CallErr::Api("adx".into())), "오류 코드는 낱말 글자만");
        assert_eq!(parse_response(200, r#"{"ok":false}"#), Err(CallErr::Api("unknown".into())));
        assert_eq!(parse_response(429, ""), Err(CallErr::RateLimited));
        assert_eq!(parse_response(500, "x"), Err(CallErr::Code(500)));
        assert_eq!(parse_response(200, "nope"), Err(CallErr::Malformed));
        assert_eq!(retry_after(Some("2")), Duration::from_secs(2));
        assert_eq!(retry_after(Some("60")), RETRY_CAP);
        assert_eq!(retry_after(None), Duration::from_secs(1));
        assert_eq!(parse_auth(&json!({ "ok": true, "user": "aynx_bot" })), Some("aynx_bot".into()));
        assert_eq!(parse_auth(&json!({ "ok": true, "user": "bad name" })), None);
        assert!(FATAL_ERRORS.contains(&"invalid_auth") && FATAL_ERRORS.contains(&"missing_scope"));

        assert!(socket_url_ok("wss://wss-primary.slack.com/link/?ticket=abc&app_id=A1"));
        assert!(socket_url_ok("wss://slack.com/link/"));
        assert!(socket_url_ok("ws://127.0.0.1:9/link/"), "시험만");
        for bad in [
            "https://wss-primary.slack.com/link/",
            "ws://wss-primary.slack.com/link/",
            "wss://evil.example/link/",
            "wss://slack.com.evil.example/link/",
            "wss://evilslack.com/link/",
            "wss://u:p@wss-primary.slack.com/link/",
            "wss://wss-primary.slack.com@evil.example/",
            "nope",
        ] {
            assert!(!socket_url_ok(bad), "{bad}");
        }

        let mut t = Threads::default();
        for i in 0..100 {
            t.note(i, 1000 + i);
        }
        assert_eq!((t.root(99), t.root(36), t.root(35)), (Some(1099), Some(1036), None), "최근 64개");
        t.clear();
        assert_eq!(t.root(99), None);
    }

    #[test]
    fn parsing_events() {
        let ev = |extra: Value| {
            let mut e = json!({ "type": "message", "channel_type": "im", "channel": "D024BE91L", "user": "U024BE7LH", "text": "hi &lt;x&gt;", "ts": "1800000000.000100" });
            for (k, v) in extra.as_object().unwrap() {
                e[k] = v.clone();
            }
            json!({ "type": "event_callback", "event": e })
        };
        let (m, root) = parse_message(&ev(json!({}))).unwrap().unwrap();
        assert_eq!((m.message_id, m.from_id, m.chat_id, m.date, m.private), (1_800_000_000_000_100, id_num("U024BE7LH"), id_num("D024BE91L").unwrap(), 1_800_000_000, true));
        assert_eq!((m.text.as_deref(), m.from_name.as_str(), m.reply_to, root), (Some("hi <x>"), "U024BE7LH", None, None));
        let (m, root) = parse_message(&ev(json!({ "thread_ts": "1800000000.000001" }))).unwrap().unwrap();
        assert_eq!((m.reply_to, root), (Some(1_800_000_000_000_001), Some(1_800_000_000_000_001)));
        assert_eq!(parse_message(&ev(json!({ "thread_ts": "1800000000.000100" }))).unwrap().unwrap().0.reply_to, None, "뿌리 자신");
        assert!(parse_message(&ev(json!({ "subtype": "file_share" }))).unwrap().unwrap().0.text.is_none(), "파일만 = 글 없음");
        for drop in [json!({ "channel_type": "channel" }), json!({ "bot_id": "B1" }), json!({ "subtype": "message_changed" }), json!({ "subtype": "bot_message" }), json!({ "type": "app_mention" })] {
            assert!(parse_message(&ev(drop.clone())).unwrap().is_none(), "{drop}");
        }
        let mut no_user = ev(json!({}));
        no_user["event"].as_object_mut().unwrap().remove("user");
        assert!(parse_message(&no_user).unwrap().is_none());
        assert!(parse_message(&ev(json!({ "user": "u024be7lh" }))).is_err(), "id 꼴이 틀리면 버린다");
        assert!(parse_message(&ev(json!({ "ts": "1.5" }))).is_err());

        let press = json!({ "type": "block_actions", "user": { "id": "U024BE7LH" }, "channel": { "id": "D024BE91L" }, "message": { "ts": "1800000000.000200" },
            "container": { "type": "message", "message_ts": "1800000000.000200", "channel_id": "D024BE91L" }, "actions": [{ "action_id": "a0", "value": "pa:x" }] });
        let p = parse_press(&press).unwrap().unwrap();
        assert_eq!((p.from_id, p.chat_id, p.message_id, p.data.as_deref()), (id_num("U024BE7LH").unwrap(), id_num("D024BE91L"), Some(1_800_000_000_000_200), Some("pa:x")));
        let super::super::Ack::Slack(a) = &p.ack else { panic!("Slack 손잡이") };
        assert_eq!((a.channel.as_str(), a.user.as_str()), ("D024BE91L", "U024BE7LH"));
        let mut no_msg = press.clone();
        no_msg.as_object_mut().unwrap().remove("message");
        assert_eq!(parse_press(&no_msg).unwrap().unwrap().message_id, Some(1_800_000_000_000_200), "container 의 ts");
        let mut view = press.clone();
        view["container"]["type"] = json!("view");
        assert!(parse_press(&view).unwrap().is_none());
        let mut other = press.clone();
        other["type"] = json!("view_submission");
        assert!(parse_press(&other).unwrap().is_none());
        let mut bad = press.clone();
        bad["user"]["id"] = json!("x-1");
        assert!(parse_press(&bad).is_err());
    }
}
