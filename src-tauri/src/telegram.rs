//! **Telegram Bot API — 순수 층**(2026-11-18 메신저 다리 1a · docs/log/2026-11-18-messenger-bridge.md "구조").
//!
//! 여기 있는 것은 **글자와 JSON 뿐**이다 — 토큰 모양 검사, API 요청 몸통(`getMe` · `getUpdates` · `sendMessage` · `answerCallbackQuery` ·
//! `editMessageText`), 응답 해석, HTML 걷기(`& < >`), 4096자 나누기. 네트워크 · 파일 · 잠금은 세션 서버의 다리(`server::messenger_bridge`)가 한다.
//!
//! ## 불변식
//!
//! - **봇 토큰은 [`BotToken`] 감싸개 안에서만 산다** — `Debug` 는 가린 글자를 찍고 `Display` 는 없다(`format!("{token}")` 이 컴파일되지 않는다).
//!   토큰은 URL 경로(`/bot<토큰>/<메서드>`)에 들어가므로 `reqwest` 오류는 늘 `without_url()` 로 뗀 뒤에만 문구가 된다(부르는 쪽).
//! - **API 바탕 주소는 [`Api`] 구조체 칸 하나** — 릴리스 경로는 [`Api::release`] 의 고정 `https://api.telegram.org` 뿐이다. 환경 변수 · 설정
//!   파일로 바꾸는 길은 없다(시험만 [`Api::at`] 으로 루프백 가짜 서버를 꽂는다 — `cfg(test)`).
//! - **받은 글은 `Debug` 가 없는 구조**([`Incoming`] · [`Callback`])로만 든다 — 본문이 `{:?}` 로 로그에 흐를 틈을 두지 않는다.
//! - 응답 해석의 오류([`ApiFail`])에는 Telegram 이 준 `description` 을 싣지 않는다 — 코드 숫자만(설명 글이 무엇을 되풀이할지 모른다).
//!
//! Bot API 세부(2026-11-18 core.telegram.org/bots/api 에서 확인): `sendMessage.text` 는 엔티티 해석 뒤 1–4096자 · `parse_mode: "HTML"` 이면
//! 태그 밖의 `<` `>` `&` 를 `&lt;` `&gt;` `&amp;` 로 · `link_preview_options.is_disabled` · `reply_parameters.message_id` ·
//! `InlineKeyboardButton.callback_data` 1–64바이트 · `getUpdates` 의 `offset` · `timeout`(초) · `allowed_updates` · `answerCallbackQuery` 는
//! 알릴 글이 없어도 불러야 단추의 도는 표시가 멈춘다. **409 는 문서에 없다** — 다른 `getUpdates`(또는 웹훅)가 같은 봇을 쓸 때 오는 것은 널리
//! 알려진 동작이라 그 코드로 가른다(실기 확인 필요).

use serde_json::{json, Value};

/// 릴리스의 API 바탕 주소 — 이것 하나뿐이다(머리말).
pub(crate) const API_BASE: &str = "https://api.telegram.org";
/// 메시지 한 통의 글자 상한(엔티티 해석 뒤 — 걷기 **전** 글자로 센다: `&amp;` 는 해석 뒤 한 글자).
pub(crate) const TEXT_MAX: usize = 4096;
/// 긴 답을 나눌 때 최대 통 수 — 그 뒤는 "앱에서 전체 보기" 한 줄.
pub(crate) const MAX_PARTS: usize = 4;
/// `callback_data` 상한(바이트).
pub(crate) const CALLBACK_DATA_MAX: usize = 64;

// ---------------------------------------------------------------------------
// 토큰
// ---------------------------------------------------------------------------

/// 봇 토큰 — `<봇 id 숫자>:<35자 안팎의 비밀>`. **`Debug` 는 값을 찍지 않는다** · `Display` 없음.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct BotToken(String);

impl std::fmt::Debug for BotToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BotToken(<redacted>)")
    }
}

impl BotToken {
    /// 붙여 넣은 글자 → 토큰. 모양: 숫자 5–20자 `:` `[A-Za-z0-9_-]` 30–64자(BotFather 가 내주는 모양 — 정확한 길이는 Telegram 이 정하므로
    /// 넉넉히). 틀리면 `None` — 부르는 쪽이 사람 문구를 짓는다(그 문구에 토큰은 없다).
    pub(crate) fn parse(raw: &str) -> Option<BotToken> {
        let raw = raw.trim();
        let (id, secret) = raw.split_once(':')?;
        let id_ok = (5..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit());
        let secret_ok = (30..=64).contains(&secret.len())
            && secret.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        (id_ok && secret_ok).then(|| BotToken(raw.to_string()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

// ---------------------------------------------------------------------------
// 주소
// ---------------------------------------------------------------------------

/// API 바탕 주소 — 구조체 칸(머리말 "불변식").
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Api {
    base: String,
}

impl Api {
    /// 릴리스 · 개발 빌드의 유일한 주소.
    pub(crate) fn release() -> Api {
        Api { base: API_BASE.to_string() }
    }

    /// 시험 — 루프백 가짜 서버(`http://127.0.0.1:<포트>`).
    #[cfg(test)]
    pub(crate) fn at(base: &str) -> Api {
        Api { base: base.trim_end_matches('/').to_string() }
    }

    /// `<바탕>/bot<토큰>/<메서드>` — **비밀이 든 주소**다. 로그 · 오류 문구에 쓰지 않는다.
    pub(crate) fn method_url(&self, token: &BotToken, method: &str) -> String {
        format!("{}/bot{}/{method}", self.base, token.as_str())
    }
}

// ---------------------------------------------------------------------------
// 요청 몸통
// ---------------------------------------------------------------------------

/// 받는 갱신 종류 — 글과 단추 누름만.
pub(crate) const ALLOWED_UPDATES: &[&str] = &["message", "callback_query"];

/// `getUpdates` 몸통 — `offset`(없으면 생략) · 롱폴 `timeout`(초).
pub(crate) fn get_updates_body(offset: Option<i64>, timeout_secs: u64) -> Value {
    let mut v = json!({ "timeout": timeout_secs, "allowed_updates": ALLOWED_UPDATES });
    if let Some(o) = offset {
        v["offset"] = json!(o);
    }
    v
}

/// 인라인 단추 한 줄 — (글자, `callback_data`).
pub(crate) type Button = (String, String);

/// `sendMessage` 몸통 — HTML · 링크 미리 보기 끔 · (있으면) 답장 대상 · 단추(한 줄에 하나씩). `html` 은 이미 그린 글자다(걷기는 부르는 쪽).
pub(crate) fn send_message_body(chat_id: i64, html: &str, reply_to: Option<i64>, buttons: &[Button]) -> Value {
    let mut v = json!({
        "chat_id": chat_id,
        "text": html,
        "parse_mode": "HTML",
        "link_preview_options": { "is_disabled": true },
    });
    if let Some(id) = reply_to {
        v["reply_parameters"] = json!({ "message_id": id, "allow_sending_without_reply": true });
    }
    if !buttons.is_empty() {
        v["reply_markup"] = keyboard(buttons);
    }
    v
}

fn keyboard(buttons: &[Button]) -> Value {
    let rows: Vec<Value> = buttons
        .iter()
        .map(|(text, data)| json!([{ "text": text, "callback_data": data }]))
        .collect();
    json!({ "inline_keyboard": rows })
}

/// `answerCallbackQuery` 몸통 — 알릴 글이 없어도 부른다(머리말).
pub(crate) fn answer_callback_body(id: &str, text: Option<&str>) -> Value {
    let mut v = json!({ "callback_query_id": id });
    if let Some(t) = text {
        v["text"] = json!(t.chars().take(200).collect::<String>());
    }
    v
}

/// `editMessageText` 몸통 — 고르기 단추 통을 결과 한 줄로 바꾼다(단추는 사라진다).
pub(crate) fn edit_message_text_body(chat_id: i64, message_id: i64, html: &str) -> Value {
    json!({
        "chat_id": chat_id,
        "message_id": message_id,
        "text": html,
        "parse_mode": "HTML",
        "link_preview_options": { "is_disabled": true },
    })
}

// ---------------------------------------------------------------------------
// 응답 해석
// ---------------------------------------------------------------------------

/// 실패 — 설명 글은 싣지 않는다(머리말).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ApiFail {
    /// 409 — 다른 프로그램이 같은 봇을 받는다(`getUpdates` 둘 · 웹훅).
    Conflict,
    /// 401 · 404 — 토큰이 틀렸거나 폐기됐다.
    Unauthorized,
    /// 그 밖의 HTTP · `error_code`.
    Code(u16),
    /// 몸이 JSON 이 아니다 · `ok`/`result` 가 없다.
    Malformed,
}

/// HTTP 상태 + 몸 → `result`. `ok: false` 면 `error_code`(없으면 HTTP 상태)로 가른다.
pub(crate) fn parse_response(status: u16, body: &str) -> Result<Value, ApiFail> {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return Err(fail_of(status)),
    };
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        return v.get("result").cloned().ok_or(ApiFail::Malformed);
    }
    let code = v
        .get("error_code")
        .and_then(Value::as_u64)
        .and_then(|c| u16::try_from(c).ok())
        .unwrap_or(status);
    Err(fail_of(code))
}

fn fail_of(code: u16) -> ApiFail {
    match code {
        409 => ApiFail::Conflict,
        401 | 404 => ApiFail::Unauthorized,
        200..=299 => ApiFail::Malformed,
        c => ApiFail::Code(c),
    }
}

/// `getMe` 의 결과 → 봇 사용자 이름(`@` 없이). 없으면 `None`.
pub(crate) fn parse_me(result: &Value) -> Option<String> {
    let name = result.get("username")?.as_str()?;
    let ok = !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    ok.then(|| name.to_string())
}

/// `sendMessage` 의 결과 → 보낸 메시지 id.
pub(crate) fn parse_sent_id(result: &Value) -> Option<i64> {
    result.get("message_id")?.as_i64()
}

/// 받은 글 하나 — **`Debug` 없음**(본문).
pub(crate) struct Incoming {
    pub message_id: i64,
    /// 보낸 사람 id(채널 글처럼 없을 수 있다)
    pub from_id: Option<i64>,
    /// 보낸 사람 표시 이름(이름 · 성 — 짝짓기 확인 화면에만) — 제어 글자를 걷고 64자
    pub from_name: String,
    pub chat_id: i64,
    /// `chat.type == "private"`
    pub private: bool,
    /// 보낸 시각(유닉스 초)
    pub date: i64,
    pub text: Option<String>,
    /// 답장이면 그 대상 메시지 id
    pub reply_to: Option<i64>,
}

/// 단추 누름 하나 — **`Debug` 없음**.
pub(crate) struct Callback {
    pub id: String,
    pub from_id: i64,
    /// 단추가 달린 메시지의 대화방 · id(오래된 메시지면 없을 수 있다)
    pub chat_id: Option<i64>,
    pub message_id: Option<i64>,
    pub data: Option<String>,
}

/// 갱신 하나의 몸.
pub(crate) enum UpdateKind {
    Message(Incoming),
    Callback(Callback),
    /// 받기로 하지 않은 종류(편집 · 채널 글 …) — 버린다
    Other,
}

pub(crate) struct Update {
    pub update_id: i64,
    pub kind: UpdateKind,
}

/// 보낸 사람 표시 이름 — 제어 글자를 걷고 64자.
fn display_name(user: &Value) -> String {
    let first = user.get("first_name").and_then(Value::as_str).unwrap_or("");
    let last = user.get("last_name").and_then(Value::as_str).unwrap_or("");
    let joined = if last.is_empty() { first.to_string() } else { format!("{first} {last}") };
    let name: String = joined.chars().filter(|c| !c.is_control()).take(64).collect();
    let name = name.trim().to_string();
    if name.is_empty() {
        user.get("username").and_then(Value::as_str).unwrap_or("?").chars().take(64).collect()
    } else {
        name
    }
}

fn parse_message(m: &Value) -> Option<Incoming> {
    let chat = m.get("chat")?;
    Some(Incoming {
        message_id: m.get("message_id")?.as_i64()?,
        from_id: m.get("from").and_then(|f| f.get("id")).and_then(Value::as_i64),
        from_name: m.get("from").map(display_name).unwrap_or_default(),
        chat_id: chat.get("id")?.as_i64()?,
        private: chat.get("type").and_then(Value::as_str) == Some("private"),
        date: m.get("date").and_then(Value::as_i64).unwrap_or(0),
        text: m.get("text").and_then(Value::as_str).map(str::to_string),
        reply_to: m.get("reply_to_message").and_then(|r| r.get("message_id")).and_then(Value::as_i64),
    })
}

fn parse_callback(c: &Value) -> Option<Callback> {
    let msg = c.get("message");
    Some(Callback {
        id: c.get("id")?.as_str()?.to_string(),
        from_id: c.get("from")?.get("id")?.as_i64()?,
        chat_id: msg.and_then(|m| m.get("chat")).and_then(|ch| ch.get("id")).and_then(Value::as_i64),
        message_id: msg.and_then(|m| m.get("message_id")).and_then(Value::as_i64),
        data: c.get("data").and_then(Value::as_str).map(str::to_string),
    })
}

/// `getUpdates` 의 결과(배열) → 갱신들. `update_id` 가 없는 줄은 버린다(다음 `offset` 을 셀 수 없다).
pub(crate) fn parse_updates(result: &Value) -> Vec<Update> {
    let Some(arr) = result.as_array() else { return Vec::new() };
    arr.iter()
        .filter_map(|u| {
            let update_id = u.get("update_id")?.as_i64()?;
            let kind = if let Some(m) = u.get("message") {
                parse_message(m).map_or(UpdateKind::Other, UpdateKind::Message)
            } else if let Some(c) = u.get("callback_query") {
                parse_callback(c).map_or(UpdateKind::Other, UpdateKind::Callback)
            } else {
                UpdateKind::Other
            };
            Some(Update { update_id, kind })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 글자
// ---------------------------------------------------------------------------

/// HTML `parse_mode` 의 걷기 셋 — `&` 먼저.
pub(crate) fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// UTF-16 단위 길이 — Telegram 의 글자 수는 UTF-16 으로 센다고 보고 보수적으로 잰다(이모지 하나 = 2).
pub(crate) fn units(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// 앞에서 `max` 단위 안의 마지막 문자 경계(바이트 위치).
fn cut_at_units(text: &str, max: usize) -> usize {
    let mut used = 0;
    for (i, c) in text.char_indices() {
        let n = c.len_utf16();
        if used + n > max {
            return i;
        }
        used += n;
    }
    text.len()
}

/// 그린 HTML 한 통을 상한 안으로 — 걷기 **뒤** 글자를 재므로(보수적) 상한은 지켜진다. 자른 자리가 엔티티(`&…;`) · 태그(`<…>`) 한가운데면
/// 그 앞에서 자르고 `…` 를 단다. 열린 `<b>` 는 닫아 준다(첫 줄 머리에만 쓴다 — 그 안에서 잘리면).
pub(crate) fn clip_html(html: &str, max: usize) -> String {
    if units(html) <= max {
        return html.to_string();
    }
    let mut cut = cut_at_units(html, max.saturating_sub(8));
    let head = &html[..cut];
    if let Some(amp) = head.rfind('&') {
        if !head[amp..].contains(';') {
            cut = amp;
        }
    }
    let head = &html[..cut];
    if let Some(lt) = head.rfind('<') {
        if !head[lt..].contains('>') {
            cut = lt;
        }
    }
    let mut out = html[..cut].to_string();
    if out.matches("<b>").count() > out.matches("</b>").count() {
        out.push_str("</b>");
    }
    out.push('…');
    out
}

/// **나누기** — 평문 `text` 를 조각마다 `max` 단위 안으로, 문단(빈 줄) → 줄 → 글자 경계 순으로 가른다. 최대 `parts` 조각이고, 넘치면 마지막
/// 조각 끝에 `more`(예: "… (앱에서 전체 보기)")를 단다(그 자리를 남긴다). 걷기 **전** 글자를 나눈다 — 부르는 쪽이 조각마다 걷는다(엔티티 해석 뒤
/// 길이 = 걷기 전 길이). 빈 글이면 빈 목록.
pub(crate) fn split_text(text: &str, max: usize, parts: usize, more: &str) -> Vec<String> {
    let mut rest = text.trim_end();
    let mut out: Vec<String> = Vec::new();
    while !rest.is_empty() && out.len() < parts {
        let last = out.len() + 1 == parts;
        if units(rest) <= max {
            out.push(rest.to_string());
            rest = "";
            break;
        }
        // 마지막 조각이면 `more` 의 자리를 남긴다.
        let budget = if last { max.saturating_sub(units(more) + 1) } else { max };
        let hard = cut_at_units(rest, budget).max(rest.chars().next().map_or(0, char::len_utf8));
        let head = &rest[..hard];
        let at = head
            .rfind("\n\n")
            .filter(|&i| i > hard / 3)
            .or_else(|| head.rfind('\n').filter(|&i| i > hard / 3))
            .unwrap_or(hard);
        let piece = rest[..at].trim_end();
        out.push(piece.to_string());
        rest = rest[at..].trim_start_matches(['\n', '\r']);
    }
    if !rest.is_empty() {
        if let Some(last) = out.last_mut() {
            last.push('\n');
            last.push_str(more);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";

    #[test]
    fn token_shape_and_redaction() {
        let t = BotToken::parse(&format!("  {TOKEN}\n")).expect("모양");
        assert_eq!(t.as_str(), TOKEN);
        assert_eq!(format!("{t:?}"), "BotToken(<redacted>)");
        for bad in [
            "", "123456789", "123456789:", "abc:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ", "1234:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ",
            "123456789:short", "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw Q", "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ/x",
            "https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ",
        ] {
            assert!(BotToken::parse(bad).is_none(), "{bad}");
        }
        let api = Api::release();
        assert_eq!(api.method_url(&t, "getMe"), format!("https://api.telegram.org/bot{TOKEN}/getMe"));
        assert!(!format!("{api:?}").contains(TOKEN));
    }

    #[test]
    fn request_bodies() {
        let g = get_updates_body(Some(42), 50);
        assert_eq!(g["offset"], 42);
        assert_eq!(g["timeout"], 50);
        assert_eq!(g["allowed_updates"], json!(["message", "callback_query"]));
        assert!(get_updates_body(None, 1).get("offset").is_none());
        let s = send_message_body(7, "<b>x</b>", Some(9), &[("A".into(), "p:1:0".into())]);
        assert_eq!(s["parse_mode"], "HTML");
        assert_eq!(s["link_preview_options"]["is_disabled"], true);
        assert_eq!(s["reply_parameters"]["message_id"], 9);
        assert_eq!(s["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "p:1:0");
        let plain = send_message_body(7, "x", None, &[]);
        assert!(plain.get("reply_parameters").is_none() && plain.get("reply_markup").is_none());
        assert_eq!(answer_callback_body("q", None), json!({ "callback_query_id": "q" }));
        assert_eq!(answer_callback_body("q", Some(&"가".repeat(300)))["text"].as_str().unwrap().chars().count(), 200);
        let e = edit_message_text_body(7, 8, "y");
        assert_eq!((e["chat_id"].as_i64(), e["message_id"].as_i64()), (Some(7), Some(8)));
    }

    #[test]
    fn responses() {
        assert_eq!(parse_response(200, r#"{"ok":true,"result":{"username":"aynx_bot"}}"#).ok().and_then(|r| parse_me(&r)), Some("aynx_bot".into()));
        assert_eq!(parse_response(409, r#"{"ok":false,"error_code":409,"description":"Conflict: terminated by other getUpdates request"}"#), Err(ApiFail::Conflict));
        assert_eq!(parse_response(401, r#"{"ok":false,"error_code":401,"description":"Unauthorized"}"#), Err(ApiFail::Unauthorized));
        assert_eq!(parse_response(502, "<html>bad gateway</html>"), Err(ApiFail::Code(502)));
        assert_eq!(parse_response(200, "{}"), Err(ApiFail::Malformed));
        assert_eq!(parse_response(200, r#"{"ok":true}"#), Err(ApiFail::Malformed));
        assert_eq!(parse_sent_id(&json!({ "message_id": 77 })), Some(77));
        assert_eq!(parse_me(&json!({ "username": "bad name" })), None);
    }

    #[test]
    fn updates_parse() {
        let r = json!([
            { "update_id": 10, "message": { "message_id": 1, "from": { "id": 5, "first_name": "Jin\u{7}", "last_name": "Lee" },
              "chat": { "id": 5, "type": "private" }, "date": 1700000000, "text": "hi", "reply_to_message": { "message_id": 3 } } },
            { "update_id": 11, "callback_query": { "id": "cb", "from": { "id": 5 }, "message": { "message_id": 4, "chat": { "id": 5 } }, "data": "p:1:0" } },
            { "update_id": 12, "edited_message": {} },
            { "message": {} },
            { "update_id": 13, "message": { "message_id": 2, "chat": { "id": -100, "type": "group" }, "date": 1 } }
        ]);
        let u = parse_updates(&r);
        assert_eq!(u.iter().map(|u| u.update_id).collect::<Vec<_>>(), [10, 11, 12, 13]);
        match &u[0].kind {
            UpdateKind::Message(m) => {
                assert_eq!((m.message_id, m.from_id, m.chat_id, m.private, m.reply_to), (1, Some(5), 5, true, Some(3)));
                assert_eq!(m.from_name, "Jin Lee");
                assert_eq!(m.text.as_deref(), Some("hi"));
            }
            _ => panic!("message"),
        }
        match &u[1].kind {
            UpdateKind::Callback(c) => assert_eq!((c.id.as_str(), c.from_id, c.chat_id, c.message_id, c.data.as_deref()), ("cb", 5, Some(5), Some(4), Some("p:1:0"))),
            _ => panic!("callback"),
        }
        assert!(matches!(u[2].kind, UpdateKind::Other));
        assert!(matches!(&u[3].kind, UpdateKind::Message(m) if !m.private && m.from_id.is_none()));
        assert!(parse_updates(&json!({})).is_empty());
    }

    #[test]
    fn html_escape() {
        assert_eq!(escape_html("a & <b>c</b> &amp;"), "a &amp; &lt;b&gt;c&lt;/b&gt; &amp;amp;");
        assert_eq!(clip_html("short", 10), "short");
        let c = clip_html(&format!("<b>{}</b>", "a".repeat(50)), 20);
        assert!(units(&c) <= 20 && c.ends_with("</b>…"), "{c}");
        let e = clip_html(&format!("{}&amp;tail-tail-tail", "a".repeat(8)), 18);
        assert_eq!(e, format!("{}…", "a".repeat(8)), "엔티티 한가운데서 자르지 않는다");
    }

    #[test]
    fn split_at_paragraphs_and_cap_parts() {
        assert!(split_text("", 10, 4, "…").is_empty());
        assert_eq!(split_text("short", 10, 4, "…"), ["short"]);
        // 문단 경계에서
        let t = format!("{}\n\n{}", "a".repeat(30), "b".repeat(30));
        assert_eq!(split_text(&t, 40, 4, "…"), ["a".repeat(30), "b".repeat(30)]);
        // 줄 경계 없이 긴 글 — 글자 경계에서 · 넘치면 마지막 통에 표식
        let long = "가".repeat(100);
        let parts = split_text(&long, 10, 4, "…more");
        assert_eq!(parts.len(), 4);
        assert!(parts.iter().all(|p| units(p) <= 10), "{parts:?}");
        assert!(parts[3].ends_with("…more"));
        // 이모지(UTF-16 둘)도 상한 안
        let emoji = "😀".repeat(20);
        assert!(split_text(&emoji, 7, 10, "…").iter().all(|p| units(p) <= 7));
        // 실제 상한
        let big = format!("{}\n\n{}", "x".repeat(4000), "y".repeat(4000));
        let p = split_text(&big, TEXT_MAX, MAX_PARTS, "…");
        assert_eq!(p.len(), 2);
        assert!(p.iter().all(|s| units(s) <= TEXT_MAX));
    }
}
