//! GUI 쪽 **메신저 다리 껍데기**(2026-11-18 · 판 34 · Discord 는 판 35 — 상태 · 고리 · 짝짓기 · 넣기는 세션 서버 `server::messenger_bridge`).
//!
//! | Tauri 명령 | 서버 op | 등급 | 원격 창 | 인자 → 답 |
//! | --- | --- | --- | --- | --- |
//! | [`messenger_bot_status`] | 같은 이름 | 읽기 | ALLOW | `channel?` → `{configured, bot, paired, pairName, pending: {code, name} \| null, link: ok \| conflict \| error \| off}` |
//! | [`messenger_bot_set_token`] | 같은 이름 | 쓰기 | HOME_ONLY | `token?, channel?`(빈 값 · 없음 = 해제 — 짝도 지운다 · Discord 등록이면 Discord 웹훅을 지운다) → 상태 |
//! | [`messenger_bot_pair`] | 같은 이름 | 쓰기 | HOME_ONLY | `code, allow, channel?` → 상태 |
//! | [`messenger_bot_unpair`] | 같은 이름 | 쓰기 | HOME_ONLY | `channel?` → 상태 |
//! | [`messenger_bot_test`] | 같은 이름 | 쓰기 | ALLOW | `channel?` → — |
//! | [`messenger_bot_label`] | 같은 이름 | 쓰기 | ALLOW | `stream, label` → —(서버가 이름표를 적기만 한다 · 채널과 상관없다 · 판 34 미만이면 조용히 건너뜀) |
//! | (없음 — `messenger::messenger_send` 안) | `messenger_bot_notify` | 쓰기 | — | `{text, stream?, kind?, label?, channel?}` → — |
//!
//! - Discord 봇 → 웹훅 바꾸기(`messenger::messenger_replace_bot_with_webhook` · HOME_ONLY)는 주소를 검사한 뒤 [`messenger_bot_set_token`] 의 해제 길을
//!   그대로 부른다(새 op 없음).
//! - `channel` 은 `"telegram"`(없으면 이것 — 지금 프런트 그대로) · `"discord"`(3b). Telegram 이면 와이어에 싣지 않는다(판 34 의 몸 그대로).
//! - **이 파일은 봇 토큰 파일을 읽지 않는다** — 토큰은 등록 때 사람이 붙여 넣은 글자를 서버 op 몸으로 넘길 뿐이고(로그에 남기지 않는다), 상태에는
//!   토큰이 없다(`configured` 하나 — 볼트의 `has_*` 와 같은 선 · docs/conventions.md "볼트 값은 프런트로 돌려주지 않는다").
//! - 판 34 미만 서버면 명령은 `[server-outdated]` · 알림의 봇 몫은 조용히 건너뛴다(웹훅 채널은 그대로 간다). **Discord 채널은 판 35 미만이면 같은
//!   규칙**이다 — 판 34 서버는 몸의 `channel` 을 모른 채 받아 Telegram 으로 다룰 수 있어 보내지 않는다.
//! - 사건 `messenger-bot-event{changed, channel}` 은 몸이 낱말 둘이라 `client::RELAYED` 로 창에 그대로 중계한다.
//! - 승인 등급 프레임을 쓰지 않는다(시험 `commands_mirror_the_server_ops`).

use serde_json::{json, Value};

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::{DISCORD_BOT_PROTOCOL, MESSENGER_BOT_PROTOCOL};
use super::ipc::{Grade, WireError};
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;
use crate::messenger::Channel;

/// 그 채널의 op 가 서는 판.
fn needs(chan: Channel) -> u32 {
    match chan {
        Channel::Discord => DISCORD_BOT_PROTOCOL,
        Channel::Telegram | Channel::Slack => MESSENGER_BOT_PROTOCOL,
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

/// 서버 오류 → 사람 문구(이유 코드는 앞에 남긴다 — 프런트가 가른다). 서버 문구에는 토큰 · 본문이 없다.
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
            Channel::Telegram | Channel::Slack => tr!(
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
            Channel::Telegram | Channel::Slack => tr!(ko: "연결된 Telegram 대화방이 없습니다", en: "No Telegram chat is paired"),
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

/// 몸에 채널을 싣는다 — Telegram 은 싣지 않는다(판 34 의 몸 그대로).
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

/// 봇 상태(토큰 없음).
#[tauri::command]
pub async fn messenger_bot_status(channel: Option<Channel>) -> Result<Value, String> {
    call(Grade::Read, "messenger_bot_status", Value::Null, channel.unwrap_or(Channel::Telegram)).await
}

/// 토큰 등록(Telegram `getMe` · Discord `users/@me` 로 확인) · 해제(`token` 없음 · 빈 값 — 짝도 함께 지운다). Discord 등록이 되면 Discord
/// 웹훅을 지운다(방법은 한 번에 하나 — 3b).
#[tauri::command]
pub async fn messenger_bot_set_token(token: Option<String>, channel: Option<Channel>) -> Result<Value, String> {
    let chan = channel.unwrap_or(Channel::Telegram);
    let registering = token.as_deref().is_some_and(|t| !t.trim().is_empty());
    let st = call(Grade::Write, "messenger_bot_set_token", json!({ "token": token }), chan).await?;
    if chan == Channel::Discord && registering && st.get("configured").and_then(Value::as_bool) == Some(true) {
        crate::messenger::remove_discord_webhook().await?;
    }
    Ok(st)
}

/// 대기 중인 짝짓기에 사람이 답한다(메인 PC 에서만 — `remote/deny.rs`).
#[tauri::command]
pub async fn messenger_bot_pair(code: String, allow: bool, channel: Option<Channel>) -> Result<Value, String> {
    call(Grade::Write, "messenger_bot_pair", json!({ "code": code, "allow": allow }), channel.unwrap_or(Channel::Telegram)).await
}

/// 짝을 지운다.
#[tauri::command]
pub async fn messenger_bot_unpair(channel: Option<Channel>) -> Result<Value, String> {
    call(Grade::Write, "messenger_bot_unpair", Value::Null, channel.unwrap_or(Channel::Telegram)).await
}

/// 짝지은 대화방에 시험 한 통.
#[tauri::command]
pub async fn messenger_bot_test(channel: Option<Channel>) -> Result<(), String> {
    call(Grade::Write, "messenger_bot_test", Value::Null, channel.unwrap_or(Channel::Telegram)).await.map(|_| ())
}

/// 그 타일의 이름표를 서버에 미리 알린다(실기 후속 2026-11-19) — 알림이 나간 적 없는 타일도 고르기 단추 · `→` 줄이 알림과 같은 이름을 쓰게.
/// 서버는 적기만 한다(아무것도 보내지 않는다 · 채널과 상관없다). 옛 서버면 조용히 건너뛴다(알림의 봇 몫과 같다).
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

/// `messenger_status(telegram · discord)` — 그 채널의 봇이 등록돼 있는가(서버가 옛 판 · 닿지 않으면 거짓).
pub(crate) async fn configured(chan: Channel) -> bool {
    match call(Grade::Read, "messenger_bot_status", Value::Null, chan).await {
        Ok(v) => v.get("configured").and_then(Value::as_bool).unwrap_or(false),
        Err(_) => false,
    }
}

/// 알림의 봇 몫을 서버로(`messenger::messenger_send` · 트레이의 `send_plain`). 옛 서버면 조용히 건너뛴다(Discord 는 판 35 미만도).
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

    /// 명령은 `async fn` · 등급은 서버 표와 같다 · 승인 등급 없음 · 방송 없음 · 토큰 파일 없음(소스 훑기).
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
        // 3b — 채널을 받는 명령 다섯(없으면 Telegram) · 이름표는 채널과 상관없다
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

    /// 3b — 판 가르기: Discord 는 판 35 · Telegram 은 판 34 · Telegram 몸에는 채널을 싣지 않는다.
    #[test]
    fn discord_needs_protocol_35() {
        assert_eq!(needs(Channel::Telegram), 34);
        assert_eq!(needs(Channel::Discord), 35);
        assert_eq!(with_channel(Value::Null, Channel::Telegram), Value::Null);
        assert_eq!(with_channel(Value::Null, Channel::Discord), json!({ "channel": "discord" }));
        assert_eq!(with_channel(json!({ "token": "x" }), Channel::Discord), json!({ "token": "x", "channel": "discord" }));
    }
}
