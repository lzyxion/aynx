//! GUI 쪽 **메신저 다리 껍데기** — 상태 · 고리 · 짝짓기 · 넣기는 세션 서버 `server::messenger_bridge` 에 있다.
//!
//! - **이 파일은 봇 토큰 파일을 읽지 않는다** — 등록 때 사람이 붙여 넣은 글자를 서버 op 몸으로 넘길 뿐이고(로그에 남기지 않는다), 상태에는
//!   토큰이 없다(`configured` 하나 — docs/conventions.md "볼트 값은 프런트로 돌려주지 않는다" 와 같은 선). → docs/invariants.md 전문 6
//! - 그 채널의 판보다 낮은 서버면 명령은 `[server-outdated]` · 알림의 봇 몫은 조용히 건너뛴다 — 판 34 서버는 몸의 `channel` 을 모른 채
//!   Telegram 으로 다룰 수 있어 보내지 않는다.
//! - 승인 등급 프레임 · 방송 · 토큰 파일 읽기가 없다(시험 `commands_mirror_the_server_ops` 가 이 파일의 글자를 훑는다).

use serde_json::{json, Value};

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::{DISCORD_BOT_PROTOCOL, MESSENGER_BOT_PROTOCOL, SLACK_BOT_PROTOCOL};
use super::ipc::{Grade, WireError};
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;
use crate::messenger::Channel;

fn needs(chan: Channel) -> u32 {
    match chan {
        Channel::Discord => DISCORD_BOT_PROTOCOL,
        Channel::Slack => SLACK_BOT_PROTOCOL,
        Channel::Telegram => MESSENGER_BOT_PROTOCOL,
    }
}

fn outdated(chan: Channel) -> bool {
    client::negotiated_protocol().is_some_and(|p| p < needs(chan))
}

fn check_protocol(chan: Channel) -> Result<(), String> {
    if outdated(chan) {
        let name = chan.name();
        return Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 {name} 봇을 쓸 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot use the {name} bot — restart it in Settings › Session server (open shell sessions will close)"
            ),
        ));
    }
    Ok(())
}

/// 이유 코드는 앞에 남긴다 — 프런트가 가른다.
fn human(e: WireError, chan: Channel) -> String {
    let m = e.message.clone();
    let reason = |r: &str| m.starts_with(&format!("[{r}]"));
    let name = chan.name();
    if reason("bad-token") {
        let t = match chan {
            Channel::Discord => tr!(
                ko: "봇 토큰이 아니거나 Discord 가 거절했습니다 — Developer Portal › Bot 에서 받은 토큰을 그대로 붙여 넣으세요",
                en: "Not a bot token, or Discord rejected it — paste the token from Developer Portal › Bot as is"
            ),
            // Slack 은 토큰이 둘 — 서버 문구가 어느 쪽인지 가른다(`sl::check_token`)
            Channel::Slack if m.contains("rejected the app-level token") => tr!(
                ko: "앱 토큰(xapp-…)을 Slack 이 거절했습니다 — 앱 설정 › Basic Information › App-Level Tokens 에서 connections:write 범위로 만든 토큰인지, Socket Mode 가 켜져 있는지 확인하세요",
                en: "Slack rejected the app token (xapp-…) — check it was made under Basic Information › App-Level Tokens with the connections:write scope, and that Socket Mode is on"
            ),
            Channel::Slack if m.contains("rejected the bot token") => tr!(
                ko: "봇 토큰(xoxb-…)을 Slack 이 거절했습니다 — 앱 설정 › OAuth & Permissions 의 Bot User OAuth Token 을 그대로 붙여 넣으세요",
                en: "Slack rejected the bot token (xoxb-…) — paste the Bot User OAuth Token from OAuth & Permissions as is"
            ),
            Channel::Slack => tr!(
                ko: "Slack 토큰이 아닙니다 — 봇 토큰(xoxb-…)과 앱 토큰(xapp-…) 둘을 모두 넣으세요",
                en: "Not Slack tokens — enter both the bot token (xoxb-…) and the app token (xapp-…)"
            ),
            Channel::Telegram => tr!(
                ko: "봇 토큰이 아니거나 Telegram 이 거절했습니다 — BotFather 가 준 토큰을 그대로 붙여 넣으세요",
                en: "Not a bot token, or Telegram rejected it — paste the token from BotFather as is"
            ),
        };
        with_reason("bad-token", t)
    } else if reason("unreachable") {
        with_reason("unreachable", tr!(ko: "{name} 에 닿지 못했습니다 — 네트워크를 확인하세요", en: "Could not reach {name} — check the network"))
    } else if reason("no-pending") {
        with_reason("no-pending", tr!(ko: "그 연결 요청이 없거나 시간이 지났습니다", en: "That pairing request is gone or expired"))
    } else if reason("not-paired") {
        let t = match chan {
            Channel::Discord => tr!(ko: "연결된 Discord DM 이 없습니다", en: "No Discord DM is paired"),
            Channel::Slack => tr!(ko: "연결된 Slack DM 이 없습니다", en: "No Slack DM is paired"),
            Channel::Telegram => tr!(ko: "연결된 Telegram 대화방이 없습니다", en: "No Telegram chat is paired"),
        };
        with_reason("not-paired", t)
    } else if reason("send-failed") {
        with_reason("send-failed", tr!(ko: "{name} 에 보내지 못했습니다", en: "Could not send to {name}"))
    } else if reason("save-failed") {
        with_reason("save-failed", tr!(ko: "봇 설정 파일을 저장하지 못했습니다", en: "Could not save the bot files"))
    } else {
        wire_message(e)
    }
}

/// Telegram 은 싣지 않는다 — 판 34 서버의 몸 그대로.
fn with_channel(mut body: Value, chan: Channel) -> Value {
    if chan != Channel::Telegram {
        if !body.is_object() {
            body = json!({});
        }
        body["channel"] = json!(chan);
    }
    body
}

async fn call(kind: Grade, op: &str, body: Value, chan: Channel) -> Result<Value, String> {
    check_protocol(chan)?;
    client::request(kind, op, with_channel(body, chan)).await.map_err(|e| human(e, chan))
}

/// 토큰 없음.
#[tauri::command]
pub async fn messenger_bot_status(channel: Option<Channel>) -> Result<Value, String> {
    call(Grade::Read, "messenger_bot_status", Value::Null, channel.unwrap_or(Channel::Telegram)).await
}

/// `token` 없음 · 빈 값 = 해제(짝도 지운다). 등록이 되면 그 채널의 웹훅을 지운다(방법은 한 번에 하나).
/// Slack 의 `token` 은 봇 토큰과 앱 수준 토큰을 줄바꿈(또는 공백)으로 이은 글자다.
#[tauri::command]
pub async fn messenger_bot_set_token(token: Option<String>, channel: Option<Channel>) -> Result<Value, String> {
    let chan = channel.unwrap_or(Channel::Telegram);
    let registering = token.as_deref().is_some_and(|t| !t.trim().is_empty());
    let st = call(Grade::Write, "messenger_bot_set_token", json!({ "token": token }), chan).await?;
    if let Some(w) = chan.webhook().filter(|_| registering && st.get("configured").and_then(Value::as_bool) == Some(true)) {
        crate::messenger::remove_webhook(w).await?;
    }
    Ok(st)
}

/// 메인 PC 에서만(`remote/deny.rs`).
#[tauri::command]
pub async fn messenger_bot_pair(code: String, allow: bool, channel: Option<Channel>) -> Result<Value, String> {
    call(Grade::Write, "messenger_bot_pair", json!({ "code": code, "allow": allow }), channel.unwrap_or(Channel::Telegram)).await
}

#[tauri::command]
pub async fn messenger_bot_unpair(channel: Option<Channel>) -> Result<Value, String> {
    call(Grade::Write, "messenger_bot_unpair", Value::Null, channel.unwrap_or(Channel::Telegram)).await
}

#[tauri::command]
pub async fn messenger_bot_test(channel: Option<Channel>) -> Result<(), String> {
    call(Grade::Write, "messenger_bot_test", Value::Null, channel.unwrap_or(Channel::Telegram)).await.map(|_| ())
}

/// 서버는 적기만 한다(아무것도 보내지 않는다 · 채널과 상관없다). 옛 서버면 조용히 건너뛴다.
#[tauri::command]
pub async fn messenger_bot_label(stream: String, label: String) -> Result<(), String> {
    if outdated(Channel::Telegram) {
        return Ok(());
    }
    client::request(Grade::Write, "messenger_bot_label", json!({ "stream": stream, "label": label }))
        .await
        .map(|_| ())
        .map_err(|e| human(e, Channel::Telegram))
}

/// 서버가 옛 판이거나 닿지 않으면 거짓.
pub(crate) async fn configured(chan: Channel) -> bool {
    match call(Grade::Read, "messenger_bot_status", Value::Null, chan).await {
        Ok(v) => v.get("configured").and_then(Value::as_bool).unwrap_or(false),
        Err(_) => false,
    }
}

/// 봇 토큰을 읽는 서버가 보낸다. 옛 서버면 조용히 건너뛴다.
pub(crate) async fn notify(notice: super::messenger_bridge::Notice) -> Result<(), String> {
    let chan = notice.channel.unwrap_or(Channel::Telegram);
    if outdated(chan) {
        return Ok(());
    }
    let body = serde_json::to_value(&notice).map_err(|_| tr!(ko: "알림을 싣지 못했습니다", en: "Could not encode the notification"))?;
    client::request(Grade::Write, "messenger_bot_notify", body).await.map(|_| ()).map_err(|e| human(e, chan))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_mirror_the_server_ops() {
        use super::super::ipc::frame;
        let src = include_str!("messenger_bridge_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        for (op, grade) in [
            ("messenger_bot_status", Grade::Read),
            ("messenger_bot_set_token", Grade::Write),
            ("messenger_bot_pair", Grade::Write),
            ("messenger_bot_unpair", Grade::Write),
            ("messenger_bot_test", Grade::Write),
            ("messenger_bot_label", Grade::Write),
        ] {
            assert!(src.contains(&format!("pub async fn {op}(")), "{op}");
            assert_eq!(frame::required_grade(op), Some(grade), "{op}");
            assert!(super::super::messenger_bridge::is_op(op), "{op}");
        }
        for op in ["messenger_bot_status", "messenger_bot_set_token", "messenger_bot_pair", "messenger_bot_unpair", "messenger_bot_test"] {
            let sig = &src[src.find(&format!("pub async fn {op}(")).unwrap()..];
            let sig = &sig[..sig.find('{').unwrap()];
            assert!(sig.contains("channel: Option<Channel>"), "{op}: {sig}");
        }
        assert!(!src[src.find("pub async fn messenger_bot_label(").unwrap()..].split('{').next().unwrap().contains("channel"));
        assert_eq!(frame::required_grade("messenger_bot_notify"), Some(Grade::Write));
        assert!(!src.contains("Grade::Approve") && !src.contains("request_approve"));
        for bad in ["emit(", "emit_to(", "eprintln!", "log::", "read_to_string", "secret_file", "bot_file", "telegram-bot", "discord-bot", "CHAT_FILE"] {
            assert!(!src.contains(bad), "{bad}");
        }
        let client = include_str!("client.rs");
        let relayed = &client[client.find("const RELAYED").unwrap()..];
        let relayed = &relayed[..relayed.find("];").unwrap()];
        assert!(relayed.contains("messenger_bridge::EVENT"), "사건은 몸이 낱말뿐이라 중계한다");
    }

    #[test]
    fn discord_needs_protocol_35() {
        assert_eq!(needs(Channel::Telegram), 34);
        assert_eq!(needs(Channel::Discord), 35);
        assert_eq!(with_channel(Value::Null, Channel::Telegram), Value::Null);
        assert_eq!(with_channel(Value::Null, Channel::Discord), json!({ "channel": "discord" }));
        assert_eq!(with_channel(json!({ "token": "x" }), Channel::Discord), json!({ "token": "x", "channel": "discord" }));
    }

    #[test]
    fn slack_needs_protocol_36() {
        assert_eq!(needs(Channel::Slack), 36);
        assert_eq!(with_channel(Value::Null, Channel::Slack), json!({ "channel": "slack" }));
        let h = |m: &str| human(WireError::new("messenger-bot", m), Channel::Slack);
        let app = h("[bad-token] slack rejected the app-level token (invalid_auth)");
        let bot = h("[bad-token] slack rejected the bot token (invalid_auth)");
        let shape = h("[bad-token] not a bot token");
        assert!(app.starts_with("[bad-token]") && bot.starts_with("[bad-token]") && shape.starts_with("[bad-token]"));
        assert!(app != bot && bot != shape && app != shape);
        assert!(app.contains("xapp") && bot.contains("xoxb"));
        assert!(h("[not-paired] no paired chat").contains("Slack"));
    }
}
