//! 메신저 알림 — 웹훅 채널 · 채널별 서식 (docs/log/2026-09-27-discord-notify.md · docs/log/2026-09-28-messenger-channels.md).
//! 무엇을 언제 보낼지는 프런트가 정하고, 여기는 채널마다 비밀 한 칸(웹훅 URL)의 보관 · 서식 · HTTPS POST 다.
//!
//! - 채널마다 갈리는 것은 [`Channel`] · [`Webhook`] 의 `match` 한 곳씩 — trait 로 벌리지 않는다(새 채널이 채울 칸을 컴파일러가 센다).
//! - Telegram · Discord 봇 · Slack 봇의 보내기 · 받기 · 봇 토큰은 세션 서버(`server::messenger_bridge`)가 쥔다 — **이 파일은 봇 토큰 파일을 읽지 않는다**([`send_bot`]).
//! - 웹훅이 있는 채널은 방법이 한 번에 하나다(웹훅 또는 봇). 봇이 등록돼 있는 동안 웹훅 등록은 거절하고, 봇 → 웹훅은
//!   [`messenger_replace_bot_with_webhook`](메인 PC 전용)만 간다.
//! - 서식은 이 한 층에서만 — 프런트는 서식 없는 구조([`Message`])만 넘긴다(채널이 늘어도 프런트가 채널을 모르게).
//!
//! ## 웹훅 URL 은 비밀이다 (→ docs/invariants.md 전문 6)
//!
//! - 채널마다 자기 파일 하나에 산다 — `settings.toml` 이 아니다(프런트가 통째로 읽고 쓰는 파일이다). 개발 폴더의 첫 씨앗
//!   ([`crate::instance`] 의 `SEED_FILES`)에도 없다.
//! - 프런트로 돌려주지 않는다 — 명령이 주는 것은 `configured` · `via` 뿐이다.
//! - 로그·`Debug`·오류 문구에 남기지 않는다 — `reqwest` 오류는 [`reqwest::Error::without_url`] 로 URL 을 뗀 뒤에만 문구가 된다.
//! - **MCP 에는 아무 도구도 없다** — AI 가 바깥으로 아무 글이나 밀어낼 통로가 되면 안 된다.
//! - 볼트에 두지 않는다 — 가림막이 걸리면 볼트가 잠기는데, 이 알림이 필요한 순간이 바로 사람이 자리를 비운 그동안이다.
//!
//! ## 멘션을 막는다
//!
//! 본문 일부는 원격 프로그램이 정한다(OSC 9·777 알림 · 창 제목에서 온 타일 이름). Discord 는 몸통에 늘 `"allowed_mentions": {"parse": []}`,
//! Slack 은 남의 글자의 `& < >` 걷기가 곧 멘션·링크 차단이다 — `link_names` 를 싣지 않아 맨글자 `@channel` 도 풀리지 않는다(실기 미확인 —
//! Slack 문서 기준). Slack 서식 기호(`* _ ~ \``)는 걷지 않는다 — 백슬래시 이스케이프가 없고, 그 기호는 모양만 바꿀 뿐 링크 · 멘션을 만들지 못한다.
//!
//! ## 대화에서 나온 글자 — 켠 사람에게만, Rust 안에서만
//!
//! `[messenger] include_conversation`(안 정하면 켬)이면 에이전트 알림에 대화 제목 · 마지막 답 앞부분을 싣는다. 프런트는 대화의 가리킴만
//! 넘기고 글자를 모른다 — 그 글자는 프런트로 돌아가지 않고, 로그·오류 문구에 없고([`conversation_lines`] 는 `Result` 가 아니다), `Debug` 도 없다.
//!
//! 재시도 큐 · 속도 제한기는 두지 않는다 — 실패(429 포함)는 그대로 `Err` 로 올라간다(CLAUDE.md "방어 기계를 미리 늘리지 않는다").

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use crate::i18n::tr;

const TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// 채널 — 채널마다 갈리는 것은 전부 여기 `match` 한 곳씩
// ---------------------------------------------------------------------------

/// 프런트와는 소문자 문자열(`"discord"`)로 오간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Discord,
    Slack,
    /// 웹훅이 아니라 봇 — 보내기 · 받기 모두 세션 서버(`server::messenger_bridge`)가 한다.
    Telegram,
}

/// 웹훅 채널(Discord · Slack) — Telegram 은 봇이라 없다([`Channel::webhook`] 이 `None`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Webhook {
    Discord,
    Slack,
}

const DISCORD_CONTENT_MAX_CHARS: usize = 2000;
const DISCORD_HOSTS: &[&str] = &[
    "discord.com",
    "discordapp.com",
    "ptb.discord.com",
    "canary.discord.com",
];
const DISCORD_PATH_PREFIX: &str = "/api/webhooks/";
const DISCORD_ALERT_COLOR: u32 = 0xE5_48_4D;
/// 앞에 `\` 를 붙이면 글자 그대로 그려진다. 다리의 Discord 전송(`server::messenger_bridge::dc`)도 같은 셋으로 걷는다.
pub(crate) const DISCORD_MARKDOWN_CHARS: &[char] = &[
    '\\', '`', '*', '_', '~', '|', '>', '[', ']', '(', ')', '<', '#',
];

/// Slack 은 4000자 넘는 `text` 를 자른다.
const SLACK_TEXT_MAX_CHARS: usize = 4000;
const SLACK_HOST: &str = "hooks.slack.com";
const SLACK_PATH_PREFIX: &str = "/services/";

impl Webhook {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) const ALL: &'static [Webhook] = &[Webhook::Discord, Webhook::Slack];

    pub(crate) fn channel(self) -> Channel {
        match self {
            Webhook::Discord => Channel::Discord,
            Webhook::Slack => Channel::Slack,
        }
    }

    /// 웹훅 URL 을 담는 파일 이름(설정 루트 바로 아래).
    pub(crate) fn webhook_file(self) -> &'static str {
        match self {
            Webhook::Discord => "discord-webhook",
            Webhook::Slack => "slack-webhook",
        }
    }

    fn content_max_chars(self) -> usize {
        match self {
            Webhook::Discord => DISCORD_CONTENT_MAX_CHARS,
            Webhook::Slack => SLACK_TEXT_MAX_CHARS,
        }
    }

    /// 틀리면 까닭을 말하는 문구 — 그 문구에 URL 은 없다.
    fn validate(self, raw: &str) -> Result<WebhookUrl, String> {
        match self {
            Webhook::Discord => validate_discord(raw),
            Webhook::Slack => validate_slack(raw),
        }
    }

    /// `alert`(승인 대기의 선언 어긋남)면 Discord 는 본문을 붉은 embed 하나에 싣는다(멘션 막기 칸은 그대로). Slack 은 본문의 주의 줄이 대신한다.
    fn payload(self, text: &str, username: &str, alert: bool) -> serde_json::Value {
        let content = truncate_chars(text, self.content_max_chars());
        match self {
            Webhook::Discord if alert => serde_json::json!({
                "embeds": [{ "description": content, "color": DISCORD_ALERT_COLOR }],
                "username": username,
                "allowed_mentions": { "parse": [] },
            }),
            // 멘션 전부 막기.
            Webhook::Discord => serde_json::json!({
                "content": content,
                "username": username,
                "allowed_mentions": { "parse": [] },
            }),
            // `username` 은 싣지 않는다(Incoming Webhook 은 무시한다). 링크 미리 보기는 끈다 — 원격 글자의 주소를 Slack 서버가 대신 열러 가지 않게.
            Webhook::Slack => serde_json::json!({
                "text": content,
                "unfurl_links": false,
                "unfurl_media": false,
            }),
        }
    }
}

impl Channel {
    /// 씨앗 시험(`instance.rs`)이 비밀 파일 이름을 이것으로 센다.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) const ALL: &'static [Channel] = &[Channel::Discord, Channel::Slack, Channel::Telegram];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Channel::Discord => "Discord",
            Channel::Slack => "Slack",
            Channel::Telegram => "Telegram",
        }
    }

    pub(crate) fn webhook(self) -> Option<Webhook> {
        match self {
            Channel::Discord => Some(Webhook::Discord),
            Channel::Slack => Some(Webhook::Slack),
            Channel::Telegram => None,
        }
    }

    /// 봇 토큰 파일 이름 — 그 파일을 **읽는 것은 세션 서버뿐**이다(이 파일은 이름만 안다).
    pub(crate) fn bot_file(self) -> Option<&'static str> {
        match self {
            Channel::Telegram => Some("telegram-bot"),
            Channel::Discord => Some("discord-bot"),
            Channel::Slack => Some("slack-bot"),
        }
    }

    /// 비밀 파일 이름 전부 — 씨앗 · 설정 옮기기 제외 시험이 센다.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn secret_files(self) -> Vec<&'static str> {
        self.webhook().map(Webhook::webhook_file).into_iter().chain(self.bot_file()).collect()
    }

    fn escape(self, text: &str) -> String {
        let flat = collapse(text);
        match self {
            Channel::Discord => {
                let mut out = String::with_capacity(flat.len() + 8);
                for c in flat.chars() {
                    if DISCORD_MARKDOWN_CHARS.contains(&c) {
                        out.push('\\');
                    }
                    out.push(c);
                }
                out
            }
            // mrkdwn 제어 글자 셋 — 멘션(`<!everyone>` · `<@U…>`)과 링크(`<url|글자>`)는 전부 `<…>` 라 이것으로 막힌다.
            Channel::Slack => flat
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;"),
            // HTML `parse_mode` — 태그 밖의 `& < >` 셋. 남의 글자로 링크 · 멘션 태그를 만들 수 없다.
            Channel::Telegram => crate::telegram::escape_html(&flat),
        }
    }

    /// 대화 글자는 줄마다 걷는다 — [`Channel::escape`] 는 한 줄로 펴므로 줄을 나눈 뒤에 부른다.
    fn render_convo_line(self, line: &ConvoLine) -> String {
        let out = self.render_convo_line_raw(line);
        match self {
            Channel::Discord | Channel::Slack => out,
            // HTML 에서는 태그 밖의 `>` 도 걷는다 — 우리 인용 표식 `> ` 를 `&gt; ` 로(남의 글자는 이미 걷었다).
            Channel::Telegram => out
                .split('\n')
                .map(|l| match l.strip_prefix("> ") {
                    Some(rest) => format!("&gt; {rest}"),
                    None => l.to_string(),
                })
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }

    fn render_convo_line_raw(self, line: &ConvoLine) -> String {
        match line {
            ConvoLine::Title(t) => format!("「{}」", self.escape(t)),
            ConvoLine::Excerpt(lines) => lines
                .iter()
                .map(|l| format!("> {}", self.escape(l)))
                .collect::<Vec<_>>()
                .join("\n"),
            ConvoLine::PendingTool { name, input } => {
                let name = self.escape(name);
                match input {
                    Some(input) => {
                        let input = self.escape(input);
                        tr!(ko: "> 묻는 도구: {name} · {input}", en: "> Tool awaiting approval: {name} · {input}")
                    }
                    None => tr!(ko: "> 묻는 도구: {name}", en: "> Tool awaiting approval: {name}"),
                }
            }
        }
    }

    /// 이름표가 비면 앱 이름.
    fn head(self, msg: &Message) -> String {
        let label = if msg.label.trim().is_empty() { &msg.app } else { &msg.label };
        let label = self.escape(label);
        let event = self.escape(&msg.event);
        let bold = |s: String| match self {
            Channel::Discord => format!("**{s}**"),
            Channel::Slack => format!("*{s}*"),
            Channel::Telegram => format!("<b>{s}</b>"),
        };
        match msg.grade {
            Some(g) => format!("{} {} — {event}", g.mark(), bold(format!("{} · {label}", g.word()))),
            None => format!("{} — {event}", bold(label)),
        }
    }

    fn render(self, msg: &Message, convo: &[ConvoLine]) -> String {
        let mut out = self.head(msg);
        if !msg.second.trim().is_empty() {
            out.push('\n');
            out.push_str(&self.escape(&msg.second));
        }
        // Rust 가 지은 덧줄도 똑같이 걷는다 — AI 가 쓴 글자가 섞여 있다.
        for line in &msg.lines {
            if !line.trim().is_empty() {
                out.push('\n');
                out.push_str(&self.escape(line));
            }
        }
        for line in convo {
            out.push('\n');
            out.push_str(&self.render_convo_line(line));
        }
        out
    }

    pub(crate) fn test_text(self) -> String {
        let app = crate::instance::WINDOW_TITLE;
        match self {
            Channel::Discord => tr!(
                ko: "**{app}** — 알림 시험입니다. 이 줄이 보이면 연결됐습니다.",
                en: "**{app}** — Test notification. If you can see this, it works.",
            ),
            Channel::Slack => tr!(
                ko: "*{app}* — 알림 시험입니다. 이 줄이 보이면 연결됐습니다.",
                en: "*{app}* — Test notification. If you can see this, it works.",
            ),
            Channel::Telegram => {
                let app = crate::telegram::escape_html(app);
                tr!(
                    ko: "<b>{app}</b> — 알림 시험입니다. 이 줄이 보이면 연결됐습니다.",
                    en: "<b>{app}</b> — Test notification. If you can see this, it works.",
                )
            }
        }
    }

    /// Telegram 은 HTML 을 깨지 않게 자른다(웹훅은 몸통이 자른다 — `Webhook::payload`).
    pub(crate) fn clip_rendered(self, text: String) -> String {
        match self {
            Channel::Discord | Channel::Slack => text,
            Channel::Telegram => crate::telegram::clip_html(&text, crate::telegram::TEXT_MAX),
        }
    }
}

// ---------------------------------------------------------------------------
// 비밀 한 칸
// ---------------------------------------------------------------------------

/// 검사를 지난 웹훅 URL. **`Debug` 는 값을 찍지 않는다** — 구조체째 `{:?}` 로 흘러도 새지 않게.
/// `Display` 는 일부러 구현하지 않는다(`format!("{url}")` 가 컴파일되지 않는다).
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct WebhookUrl(String);

impl std::fmt::Debug for WebhookUrl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WebhookUrl(<redacted>)")
    }
}

impl WebhookUrl {
    fn as_str(&self) -> &str {
        &self.0
    }
}

/// 경로 뒤는 검사하지 않는다 — 틀리면 보내 볼 때 거절이 온다.
fn validate_discord(raw: &str) -> Result<WebhookUrl, String> {
    let raw = raw.trim();
    let invalid = || {
        tr!(
            ko: "Discord 웹훅 주소가 아닙니다 — 채널 설정 › 연동 › 웹후크에서 복사한 https://discord.com/api/webhooks/… 주소를 붙여 넣으세요",
            en: "Not a Discord webhook URL — paste the https://discord.com/api/webhooks/… address copied from Channel settings › Integrations › Webhooks",
        )
    };
    let url = reqwest::Url::parse(raw).map_err(|_| invalid())?;
    if url.scheme() != "https" {
        return Err(tr!(
            ko: "웹훅 주소는 https 여야 합니다",
            en: "The webhook URL must use https",
        ));
    }
    let host_ok = url.host_str().is_some_and(|h| DISCORD_HOSTS.contains(&h));
    let path_ok = url
        .path()
        .strip_prefix(DISCORD_PATH_PREFIX)
        .is_some_and(|rest| !rest.trim_matches('/').is_empty());
    if !host_ok
        || !path_ok
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    Ok(WebhookUrl(url.into()))
}

fn validate_slack(raw: &str) -> Result<WebhookUrl, String> {
    let raw = raw.trim();
    let invalid = || {
        tr!(
            ko: "Slack 웹훅 주소가 아닙니다 — Slack 앱 설정 › Incoming Webhooks 에서 복사한 https://hooks.slack.com/services/… 주소를 붙여 넣으세요",
            en: "Not a Slack webhook URL — paste the https://hooks.slack.com/services/… address copied from your Slack app › Incoming Webhooks",
        )
    };
    let url = reqwest::Url::parse(raw).map_err(|_| invalid())?;
    if url.scheme() != "https" {
        return Err(tr!(
            ko: "웹훅 주소는 https 여야 합니다",
            en: "The webhook URL must use https",
        ));
    }
    let host_ok = url.host_str() == Some(SLACK_HOST);
    let path_ok = url
        .path()
        .strip_prefix(SLACK_PATH_PREFIX)
        .is_some_and(|rest| !rest.trim_matches('/').is_empty());
    if !host_ok
        || !path_ok
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    Ok(WebhookUrl(url.into()))
}

fn webhook_path(channel: Webhook) -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join(channel.webhook_file()))
}

/// 손으로 고쳐 검사를 못 지나면 `None`(= 등록 안 됨).
fn load_at(channel: Webhook, path: &Path) -> Option<WebhookUrl> {
    let text = std::fs::read_to_string(path).ok()?;
    channel.validate(&text).ok()
}

fn save_at(path: &Path, url: Option<&WebhookUrl>) -> std::io::Result<()> {
    match url {
        Some(url) => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(path, url.as_str())
        }
        None => match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
    }
}

fn load(channel: Webhook) -> Option<WebhookUrl> {
    load_at(channel, &webhook_path(channel)?)
}

async fn load_async(channel: Webhook) -> Result<Option<WebhookUrl>, String> {
    tauri::async_runtime::spawn_blocking(move || load(channel)).await.map_err(|e| {
        tr!(ko: "웹훅 주소를 읽지 못했습니다: {e}", en: "Could not read the webhook URL: {e}")
    })
}

// ---------------------------------------------------------------------------
// 글자 다듬기 (채널 공통)
// ---------------------------------------------------------------------------

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 서식 걷기는 채널이 그릴 때 — 자른 뒤라 `\` 가 글자 수를 먹지 않고 기호 한가운데를 가르지도 않는다.
fn clip(text: &str, max: usize) -> String {
    truncate_chars(&collapse(text), max)
}

// ---------------------------------------------------------------------------
// 알림 한 통 — 프런트가 넘기는 서식 없는 구조
// ---------------------------------------------------------------------------

/// 프런트와는 소문자 글자로 오간다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Grade {
    Action,
    Done,
    Failed,
}

impl Grade {
    /// 확인 필요는 노랑 — 빨강은 실패처럼 보인다(사용자 결정).
    fn mark(self) -> &'static str {
        match self {
            Grade::Action => "🟡",
            Grade::Done => "🟢",
            Grade::Failed => "❌",
        }
    }

    fn word(self) -> String {
        match self {
            Grade::Action => tr!(ko: "확인 필요", en: "Needs action"),
            Grade::Done => tr!(ko: "완료", en: "Done"),
            Grade::Failed => tr!(ko: "실패", en: "Failed"),
        }
    }
}

/// 프런트가 넘기는 알림 — 평문이다. 서식은 채널이 입힌다([`Channel::render`]).
#[derive(serde::Deserialize)]
pub struct Message {
    /// 첫 줄에는 싣지 않는다(이름표가 빌 때만)
    app: String,
    #[serde(default)]
    grade: Option<Grade>,
    /// 남의 글자일 수 있다(원격이 창 제목을 바꾼다)
    label: String,
    /// 우리 문구에 남의 글자(에이전트 이름 · 명령 줄 · OSC 본문)가 섞여 있다
    event: String,
    #[serde(default)]
    second: String,
    /// Rust 가 짓는 한 통만 — 프런트는 채우지 못한다(역직렬화하지 않는다).
    #[serde(skip)]
    lines: Vec<String>,
    /// 프런트는 채우지 못한다.
    #[serde(skip)]
    alert: bool,
}

impl Message {
    pub(crate) fn plain(app: &str, label: String, event: String) -> Message {
        Message {
            app: app.to_string(),
            grade: None,
            label,
            event,
            second: String::new(),
            lines: Vec::new(),
            alert: false,
        }
    }

    pub(crate) fn with_lines(app: &str, label: String, event: String, lines: Vec<String>, alert: bool) -> Message {
        Message {
            lines,
            alert,
            ..Message::plain(app, label, event)
        }
    }

    pub(crate) fn graded(self, grade: Option<Grade>) -> Message {
        Message { grade, ..self }
    }

    #[cfg(test)]
    pub(crate) fn debug_lines(&self) -> Vec<String> {
        let mut v = vec![format!("{} — {}", self.label, self.event)];
        v.extend(self.lines.iter().cloned());
        v
    }

    #[cfg(test)]
    pub(crate) fn is_alert(&self) -> bool {
        self.alert
    }

    #[cfg(test)]
    pub(crate) fn grade(&self) -> Option<Grade> {
        self.grade
    }
}

/// 대화 글자 없이 켜진 채널로 보낸다 — 창 없이 작업안 결과를 보낼 때.
pub(crate) async fn send_plain(message: Message, channels: Vec<Channel>) -> Result<(), String> {
    messenger_send(message, None, channels, None, None, None).await
}

// ---------------------------------------------------------------------------
// 대화에서 나온 글자
// ---------------------------------------------------------------------------

const EXCERPT_MAX_CHARS: usize = 500;
const EXCERPT_MAX_LINES: usize = 8;
const PENDING_INPUT_MAX_CHARS: usize = 200;
/// 목록의 제목 상한(80)과 같다.
const TITLE_MAX_CHARS: usize = 80;

#[derive(Clone, Copy, PartialEq, Eq)]
enum AgentEvent {
    Stop,
    Permission,
}

/// 서식 없는 구조(걷지 않았다). `Debug` 없음 — 대화 글자가 `{:?}` 로 흐를 틈을 두지 않는다.
enum ConvoLine {
    Title(String),
    Excerpt(Vec<String>),
    PendingTool { name: String, input: Option<String> },
}

fn tidy_line(line: &str) -> String {
    let mut l = line.trim();
    let unhashed = l.trim_start_matches('#');
    if unhashed.len() != l.len() && (unhashed.is_empty() || unhashed.starts_with(' ')) {
        l = unhashed.trim_start();
    }
    let flat = collapse(l);
    for p in ["- ", "* ", "+ "] {
        if let Some(rest) = flat.strip_prefix(p) {
            return format!("· {rest}");
        }
    }
    flat
}

fn is_noise_line(line: &str) -> bool {
    let l = line.trim();
    l.starts_with("```") || (l.chars().count() >= 3 && l.chars().all(|c| matches!(c, '-' | '*' | '_')))
}

fn paragraphs(text: &str) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    for raw in text.lines() {
        if is_noise_line(raw) {
            continue;
        }
        let l = tidy_line(raw);
        if l.is_empty() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        cur.push(l);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn mark_cut(lines: &mut [String]) {
    if let Some(last) = lines.last_mut() {
        if !last.ends_with('…') {
            last.push('…');
        }
    }
}

fn fit_lines(lines: &[String], max_lines: usize, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut used = 0usize;
    for l in lines {
        if out.len() >= max_lines {
            break;
        }
        let n = l.chars().count();
        if used + n <= max_chars {
            out.push(l.clone());
            used += n;
            continue;
        }
        let rest = max_chars.saturating_sub(used);
        if rest >= 12 || out.is_empty() {
            out.push(truncate_chars(l, rest.max(1)));
        } else {
            mark_cut(&mut out);
        }
        return out;
    }
    if out.len() < lines.len() {
        mark_cut(&mut out);
    }
    out
}

/// 넘치면 첫 문단 + `…` + 끝 문단 — 끝 문단이 먼저 자리를 잡는다(답 끝의 "다음으로 …할까요?" 가 폰에서 판단할 거리라서).
fn excerpt_lines(text: &str) -> Vec<String> {
    let paras = paragraphs(text);
    if paras.is_empty() {
        return Vec::new();
    }
    let all: Vec<String> = paras.concat();
    let total: usize = all.iter().map(|l| l.chars().count()).sum();
    if all.len() <= EXCERPT_MAX_LINES && total <= EXCERPT_MAX_CHARS {
        return all;
    }
    if paras.len() < 2 {
        return fit_lines(&all, EXCERPT_MAX_LINES, EXCERPT_MAX_CHARS);
    }
    let last = fit_lines(&paras[paras.len() - 1], EXCERPT_MAX_LINES - 2, EXCERPT_MAX_CHARS - 80);
    let used: usize = last.iter().map(|l| l.chars().count()).sum::<usize>() + 1;
    let mut out = fit_lines(
        &paras[0],
        EXCERPT_MAX_LINES - last.len() - 1,
        EXCERPT_MAX_CHARS.saturating_sub(used),
    );
    out.push("…".to_string());
    out.extend(last);
    out
}

/// 글자가 아니라 가리킴이다. `Debug` 없음.
#[derive(serde::Deserialize)]
pub struct ConversationRef {
    agent: String,
    /// UUID 모양이 아니면 찾지 않는다
    id: String,
    event: String,
}

fn conversation_block(
    event: AgentEvent,
    title: Option<&str>,
    tail: &crate::agent_transcript::TurnTail,
) -> Vec<ConvoLine> {
    let mut out = Vec::new();
    if let Some(t) = title
        .map(|t| clip(t, TITLE_MAX_CHARS))
        .filter(|t| !t.is_empty())
    {
        out.push(ConvoLine::Title(t));
    }
    match event {
        AgentEvent::Stop => {
            if let Some(x) = tail
                .text
                .as_deref()
                .map(excerpt_lines)
                .filter(|lines| !lines.is_empty())
            {
                out.push(ConvoLine::Excerpt(x));
            }
        }
        AgentEvent::Permission => {
            let name = tail
                .pending_tool
                .as_deref()
                .map(|t| clip(t, TITLE_MAX_CHARS));
            if let Some(name) = name.filter(|t| !t.is_empty()) {
                let input = tail
                    .pending_input
                    .as_deref()
                    .map(|t| clip(t, PENDING_INPUT_MAX_CHARS))
                    .filter(|t| !t.is_empty());
                out.push(ConvoLine::PendingTool { name, input });
            }
        }
    }
    out
}

/// 무엇이든 못 하면 빈 목록 — 오류 문구를 만들지 않는다(그 문구에 대화 글자가 섞일 틈을 두지 않는다).
fn conversation_lines_in(
    include: bool,
    c: &ConversationRef,
    roots: Option<&[PathBuf]>,
) -> Vec<ConvoLine> {
    if !include {
        return Vec::new();
    }
    let event = match c.event.as_str() {
        "stop" => AgentEvent::Stop,
        "permission" => AgentEvent::Permission,
        _ => return Vec::new(),
    };
    let Ok(t) = crate::agent_sessions::target(&c.agent) else {
        return Vec::new();
    };
    let owned;
    let roots = match roots {
        Some(r) => r,
        None => {
            owned = (t.roots)();
            &owned
        }
    };
    let Ok(path) = crate::agent_sessions::conversation_file(t, roots, &c.id) else {
        return Vec::new();
    };
    let title = crate::agent_sessions::conversation_title_at(t, roots, &path);
    let tail = crate::agent_transcript::turn_tail(&path, t.transcript);
    conversation_block(event, title.as_deref(), &tail)
}

/// 설정의 `include_conversation` 을 여기서 다시 본다(프런트가 가리킴을 보냈어도). 블로킹.
fn conversation_lines(c: &ConversationRef) -> Vec<ConvoLine> {
    conversation_lines_in(crate::settings::messenger_include_conversation(), c, None)
}

// ---------------------------------------------------------------------------
// 보내기 (채널 공통)
// ---------------------------------------------------------------------------

/// TLS 설정(OS 신뢰 저장소 읽기)을 매번 다시 하지 않게 앱 수명 동안 나눠 쓴다.
fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let built = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| {
        let e = e.without_url();
        tr!(ko: "HTTP 클라이언트를 만들지 못했습니다: {e}", en: "Could not create the HTTP client: {e}")
    })?;
    Ok(CLIENT.get_or_init(|| built))
}

/// 오류 문구에는 URL 이 없다.
async fn post(channel: Webhook, url: &WebhookUrl, text: &str, alert: bool) -> Result<(), String> {
    let name = channel.channel().name();
    let body = channel
        .payload(text, crate::instance::WINDOW_TITLE, alert)
        .to_string();
    let res = client()?
        .post(url.as_str())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| {
            let e = e.without_url();
            tr!(ko: "{name} 에 보내지 못했습니다: {e}", en: "Could not send to {name}: {e}")
        })?;
    let status = res.status();
    if !status.is_success() {
        let code = status.as_u16();
        return Err(tr!(
            ko: "{name} 서버가 거절했습니다 (HTTP {code})",
            en: "{name} rejected the message (HTTP {code})",
        ));
    }
    Ok(())
}

fn not_registered(channel: Channel) -> String {
    let name = channel.name();
    match channel.webhook() {
        Some(_) => tr!(ko: "등록된 {name} 웹훅이 없습니다", en: "No {name} webhook is registered"),
        None => tr!(ko: "연결된 {name} 봇이 없습니다", en: "No {name} bot is connected"),
    }
}

/// 봇 채널 몫 한 통 — 세션 서버가 보낸다(봇 토큰을 읽는 것은 서버뿐). 봇이 없거나 짝이 없으면 조용히 건너뛴다.
async fn send_bot(notice: crate::server::messenger_bridge::Notice) -> Result<(), String> {
    if crate::server::hub::in_server() {
        crate::server::messenger_bridge::notify(notice).await
    } else {
        crate::server::messenger_bridge_proxy::notify(notice).await
    }
}

/// 토큰은 오가지 않는다 — 상태의 `configured` 만.
async fn bot_configured(channel: Channel) -> bool {
    if crate::server::hub::in_server() {
        crate::server::messenger_bridge::configured(channel)
    } else {
        crate::server::messenger_bridge_proxy::configured(channel).await
    }
}

/// 봇 토큰을 등록하면 `messenger_bridge_proxy` 가 부른다(방법은 한 번에 하나).
pub(crate) async fn remove_webhook(webhook: Webhook) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || match webhook_path(webhook) {
        Some(path) => save_at(&path, None).map_err(|e| tr!(ko: "웹훅 주소를 지우지 못했습니다: {e}", en: "Could not remove the webhook URL: {e}")),
        None => Ok(()),
    })
    .await
    .map_err(|e| tr!(ko: "웹훅 지우기를 실행하지 못했습니다: {e}", en: "Could not run the webhook removal: {e}"))?
}

// ---------------------------------------------------------------------------
// 명령 — 전부 `async fn`. 값을 돌려주는 명령은 없다.
// ---------------------------------------------------------------------------

/// URL · 토큰은 싣지 않는다.
#[derive(Debug, serde::Serialize)]
pub struct MessengerStatus {
    pub configured: bool,
    pub via: Option<&'static str>,
}

impl MessengerStatus {
    fn of(via: Option<&'static str>) -> MessengerStatus {
        MessengerStatus { configured: via.is_some(), via }
    }
}

#[tauri::command]
pub async fn messenger_status(channel: Channel) -> MessengerStatus {
    if let Some(w) = channel.webhook() {
        if load_async(w).await.ok().flatten().is_some() {
            return MessengerStatus::of(Some("webhook"));
        }
    }
    if channel.bot_file().is_some() && bot_configured(channel).await {
        return MessengerStatus::of(Some("bot"));
    }
    MessengerStatus::of(None)
}

/// 봇 토큰이 등록돼 있으면 등록을 거절한다(지우기는 된다). 이 명령은 원격 창에도 열려 있어 봇을 지우지 않는다 —
/// 봇 → 웹훅은 [`messenger_replace_bot_with_webhook`].
#[tauri::command]
pub async fn messenger_set_webhook(
    channel: Channel,
    url: Option<String>,
) -> Result<MessengerStatus, String> {
    let Some(webhook) = channel.webhook() else {
        return Err(tr!(
            ko: "Telegram 은 웹훅이 아니라 봇 토큰으로 연결합니다",
            en: "Telegram connects with a bot token, not a webhook",
        ));
    };
    let channel = webhook;
    let parsed = match url.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => Some(channel.validate(raw)?),
    };
    if parsed.is_some() && channel.channel().bot_file().is_some() && bot_configured(channel.channel()).await {
        let name = channel.channel().name();
        return Err(tr!(
            ko: "{name} 봇이 연결돼 있어 웹훅을 등록할 수 없습니다 — 봇 연결을 먼저 해제하세요(방법은 하나만)",
            en: "A {name} bot is connected, so a webhook cannot be registered — remove the bot first (one method at a time)",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = webhook_path(channel) else {
            return Err(tr!(
                ko: "설정 폴더를 찾지 못했습니다",
                en: "Could not find the settings folder",
            ));
        };
        save_at(&path, parsed.as_ref()).map_err(|e| {
            tr!(ko: "웹훅 주소를 저장하지 못했습니다: {e}", en: "Could not save the webhook URL: {e}")
        })?;
        Ok(MessengerStatus::of(parsed.is_some().then_some("webhook")))
    })
    .await
    .map_err(|e| tr!(ko: "웹훅 저장을 실행하지 못했습니다: {e}", en: "Could not run the webhook save: {e}"))?
}

/// 봇 → 웹훅. 순서: 주소 검사 → 봇 해제(실패하면 거절 · 웹훅은 저장하지 않음) → 웹훅 저장. 원격 창은 막힌다(`remote/deny.rs` HOME_ONLY).
/// 토큰 파일은 읽지 않는다.
#[tauri::command]
pub async fn messenger_replace_bot_with_webhook(channel: Channel, url: String) -> Result<MessengerStatus, String> {
    let Some(webhook) = channel.webhook() else {
        return Err(tr!(
            ko: "봇을 웹훅으로 바꾸는 것은 Discord · Slack 만 됩니다",
            en: "Only Discord and Slack can switch from a bot to a webhook",
        ));
    };
    let raw = url.trim();
    if raw.is_empty() {
        return Err(tr!(ko: "웹훅 주소를 넣으세요", en: "Enter a webhook URL"));
    }
    let parsed = webhook.validate(raw)?;
    let st = crate::server::messenger_bridge_proxy::messenger_bot_set_token(None, Some(channel)).await?;
    if st.get("configured").and_then(serde_json::Value::as_bool) != Some(false) {
        let name = channel.name();
        return Err(tr!(ko: "{name} 봇 연결을 해제하지 못했습니다", en: "Could not remove the {name} bot"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = webhook_path(webhook) else {
            return Err(tr!(ko: "설정 폴더를 찾지 못했습니다", en: "Could not find the settings folder"));
        };
        save_at(&path, Some(&parsed))
            .map_err(|e| tr!(ko: "웹훅 주소를 저장하지 못했습니다: {e}", en: "Could not save the webhook URL: {e}"))?;
        Ok(MessengerStatus::of(Some("webhook")))
    })
    .await
    .map_err(|e| tr!(ko: "웹훅 저장을 실행하지 못했습니다: {e}", en: "Could not run the webhook save: {e}"))?
}

/// 설정 화면의 "테스트 보내기".
#[tauri::command]
pub async fn messenger_test(channel: Channel) -> Result<(), String> {
    let Some(w) = channel.webhook() else {
        return crate::server::messenger_bridge_proxy::messenger_bot_test(Some(channel)).await;
    };
    match load_async(w).await? {
        Some(url) => post(w, &url, &channel.test_text(), false).await,
        None if channel.bot_file().is_some() && bot_configured(channel).await => {
            crate::server::messenger_bridge_proxy::messenger_bot_test(Some(channel)).await
        }
        None => Err(not_registered(channel)),
    }
}

/// 등록된 채널 각각에 보낸다 — 한 채널의 실패가 다른 채널을 막지 않고, 실패는 문구 하나로 모은다(URL 없음).
///
/// `conversation` 의 글자는 이 함수 밖으로(프런트·로그·오류) 나가지 않는다. `operation` 이 오면 그 작업안이 아직 사람을 기다리는지
/// 다시 보고 한 통을 여기서 짓는다(떠났으면 보내지 않는다). `stream` · `kind` 는 봇 몫에만 — 답장을 그 타일로 보내는 데 쓴다.
#[tauri::command]
pub async fn messenger_send(
    message: Message,
    conversation: Option<ConversationRef>,
    channels: Vec<Channel>,
    operation: Option<String>,
    stream: Option<String>,
    kind: Option<String>,
) -> Result<(), String> {
    let message = match operation {
        Some(id) => match crate::operations::notify::pending_from_gui(&id, &message.app).await {
            Some(m) => m,
            None => return Ok(()),
        },
        None => message,
    };
    if message.event.trim().is_empty() {
        return Ok(());
    }
    let mut targets: Vec<(Webhook, WebhookUrl)> = Vec::new();
    let mut bots: Vec<Channel> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for channel in channels {
        let Some(w) = channel.webhook() else {
            if !bots.contains(&channel) {
                bots.push(channel);
            }
            continue;
        };
        if targets.iter().any(|(c, _)| *c == w) || bots.contains(&channel) {
            continue;
        }
        match load_async(w).await {
            Ok(Some(url)) => targets.push((w, url)),
            // 등록 안 됨 — 봇이 있는 채널은 봇으로
            Ok(None) if channel.bot_file().is_some() => bots.push(channel),
            Ok(None) => {}
            Err(e) => errors.push(e),
        }
    }
    if !targets.is_empty() || !bots.is_empty() {
        let convo = match conversation {
            Some(c) => tauri::async_runtime::spawn_blocking(move || conversation_lines(&c))
                .await
                .unwrap_or_default(),
            None => Vec::new(),
        };
        for (channel, url) in &targets {
            let text = channel.channel().render(&message, &convo);
            if let Err(e) = post(*channel, url, &text, message.alert).await {
                errors.push(e);
            }
        }
        for channel in bots {
            let text = channel.clip_rendered(channel.render(&message, &convo));
            let label = (!message.label.trim().is_empty()).then(|| message.label.clone());
            // Telegram 은 와이어에 채널을 싣지 않는다(없으면 Telegram)
            let wire = (channel != Channel::Telegram).then_some(channel);
            let has_tool = convo.iter().any(|l| matches!(l, ConvoLine::PendingTool { .. }));
            let notice = crate::server::messenger_bridge::Notice { text, stream: stream.clone(), kind: kind.clone(), label, channel: wire, has_tool };
            if let Err(e) = send_bot(notice).await {
                errors.push(e);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" · "))
    }
}


#[cfg(test)]
mod tests;
