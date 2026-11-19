//! **메신저 알림 — 웹훅 채널** (docs/log/2026-09-27-discord-notify.md · docs/log/2026-09-28-messenger-channels.md).
//!
//! OS 알림(`src/lib/app/os-notify.ts`) 옆의 두 번째 **내보내는 곳**이다. OS 알림은 "창이 뒤에 있다" 를
//! 맡고, 이것은 "사람이 PC 앞을 떠났다" 를 맡는다 — 폰의 메신저로 한 줄이 간다. **무엇을 언제** 보낼지는
//! 전부 프런트(`src/lib/messenger-notify.ts` · `src/lib/app/messenger.ts`)가 정하고, 여기 있는 것은
//! **채널마다 비밀 한 칸(웹훅 URL)의 보관** · **서식(채널 규칙으로 그리기)** · **HTTPS POST** 다.
//!
//! ## 채널 — `enum Channel`
//!
//! [`Channel::Discord`] · [`Channel::Slack`] · [`Channel::Telegram`] 셋이다(각자 등록 · 각자 보내기 칸, 사건 규칙은 함께). 채널마다 갈리는 것
//! (비밀 파일 이름 · 서식 · 오류 문구의 이름)은 [`Channel`] 의 `match` 한 곳씩에, **웹훅에만 있는 것**(주소 검사 · 본문 상한 · 몸통 모양 · 웹훅 파일)은
//! [`Webhook`](Discord · Slack)의 `match` 한 곳씩에 있다 — [`Channel::webhook`] 이 가른다. trait 로 벌리지 않는다 — 채널은 손에
//! 꼽고, 한 파일 안의 `match` 가 "새 채널이 채워야 할 칸" 을 컴파일러가 세어 준다. 공통으로 남는 것:
//! [`WebhookUrl`](비밀 감싸개) · 파일 load/save · [`client`] · [`post`] · 대화 줄 읽기 · `without_url` 오류 처리.
//!
//! **Telegram(2026-11-18 메신저 다리)** 은 웹훅이 아니라 봇이다 — 서식(HTML `parse_mode` · 굵게 `<b>` · `& < >` 걷기 · 상한 4096)만 여기서 그리고,
//! 보내기 · 받기 · 봇 토큰(`<설정 루트>/telegram-bot`)은 **세션 서버**의 `server::messenger_bridge` 가 쥔다. 이 파일은 토큰 파일을 읽지 않는다 —
//! 그린 한 통을 세션 서버 안이면 다리 함수로, GUI 면 서버 op `messenger_bot_notify` 로 넘긴다([`send_bot`]).
//!
//! **Discord 봇(2026-11-19 3b) · Slack 봇(4단계)** — 웹훅이 있는 채널은 방법이 **한 번에 하나**다: 웹훅(알림만 — 이 파일) 또는 봇(알림 + 말하기 —
//! 세션 서버의 다리 · 토큰 `<설정 루트>/discord-bot` · `slack-bot`). 웹훅이 등록돼 있으면 웹훅으로, 없으면 Telegram 과 같은 봇 길로 보낸다(봇 ·
//! 짝이 없으면 서버가 조용히 건너뛴다). 봇 토큰을 등록하면 GUI 껍데기(`messenger_bridge_proxy`)가 그 채널의 웹훅 파일을 지우고([`remove_webhook`]),
//! 봇이 등록돼 있는 동안 웹훅 등록은 거절한다(서버의 봇 상태를 묻는다 — 토큰 파일은 읽지 않는다). 봇에서 웹훅으로는 따로 둔
//! [`messenger_replace_bot_with_webhook`](메인 PC 전용 — 주소 검사 → 서버 op 로 봇 해제 → 웹훅 저장)만 간다. 상태 명령은
//! `{configured, via: "webhook" | "bot" | null}`. Slack 봇의 알림 글은 이 파일이 그린 mrkdwn(`& < >` 걷힘 · `*굵게*`)을 다리가 `verbatim` 으로 싣는다.
//!
//! ## 서식은 여기 한 층에서만
//!
//! 프런트는 **서식 없는 구조**([`Message`] — 등급 · 이름표 · 사건 · 둘째 줄)만 넘긴다. 마크다운도 이스케이프도
//! 없다. 첫 줄은 `🟡 **확인 필요 · <이름표>** — <사건>` 모양이다(등급 [`Grade`] — 확인 필요 · 완료 · 실패, 없으면 표시 없이
//! `**<이름표>** — <사건>`). 앱 이름은 첫 줄에 싣지 않는다 — 보낸 사람 이름(Discord `username`)이 이미 앱이다(2026-11-16). 채널마다 규칙이 다르므로(Discord 마크다운 ≠ 다른 메신저의 서식) 한 곳에서 그려야 채널이 늘어도 프런트가
//! 채널을 모른다. 대화에서 나온 글자는 원래 Rust 안에서만 다뤘으니 서식도 같은 층에 모인다
//! (docs/log/2026-09-28-messenger-channels.md).
//!
//! ## 웹훅 URL 은 비밀이다
//!
//! URL 을 아는 사람은 누구든 그 채널에 글을 쓸 수 있다(토큰이 경로에 들어 있다). 그래서:
//!
//! - **채널마다 자기 파일 하나**(`<설정 루트>/discord-webhook` · `<설정 루트>/slack-webhook`)에 산다 — `settings.toml` 이 아니다. 설정 파일은
//!   프런트가 통째로 읽고 쓰는 파일이라 거기 두면 곧바로 프런트로 나간다. 개발 폴더의 첫 씨앗
//!   ([`crate::instance`] 의 `SEED_FILES`)에도 없다 — MCP 토큰과 같은 취급이다.
//! - **프런트로 돌려주지 않는다** — 명령이 주는 것은 `configured: bool` 하나다(볼트의 `has_*` 와 같은
//!   선 — docs/conventions.md "볼트 값은 프런트로 돌려주지 않는다"). 담는 방향만 열려 있다.
//! - **로그·`Debug`·오류 문구에 남기지 않는다** — [`WebhookUrl`] 의 `Debug` 는 가린 글자를 찍고,
//!   `reqwest` 오류는 [`reqwest::Error::without_url`] 로 URL 을 뗀 뒤에만 문구가 된다.
//! - **MCP 에는 아무 도구도 없다** — AI 가 바깥으로 아무 글이나 밀어낼 통로가 되면 안 된다.
//!
//! **볼트가 아닌 이유**: 가림막이 걸리면 볼트가 잠긴다(CLAUDE.md 보안 제약). 그런데 이 알림이 필요한
//! 순간이 바로 가림막이 걸린 동안 — 사람이 자리를 비운 사이 — 이다. 볼트에 두면 가장 필요할 때
//! 꺼낼 수 없다.
//!
//! ## 멘션을 막는다
//!
//! 본문 일부는 원격 프로그램이 정한다(OSC 9·777 알림 · 창 제목에서 온 타일 이름) — 그 글자로 아무도 불려 나오지
//! 않게 채널마다 막는다.
//!
//! - **Discord** — 몸통에 늘 `"allowed_mentions": {"parse": []}` 를 싣는다. `@everyone` 이 글자로 있어도 울리지 않는다.
//! - **Slack** — 몸통에 그런 칸이 없다. 대신 Slack 의 멘션(`<!everyone>` · `<!here>` · `<@U…>`)과 링크(`<url|글자>`)는
//!   **전부 `<…>` 로만** 만들어지므로, 남의 글자의 `&` · `<` · `>` 를 `&amp;` · `&lt;` · `&gt;` 로 걷는 것이 곧 멘션·
//!   링크 차단이다(Slack 이 문서로 정한 이스케이프 셋). `link_names` 를 싣지 않으므로 맨글자 `@channel` 도 멘션으로
//!   풀리지 않는다(실기 미확인 — Slack 문서 기준). 링크 미리 보기(`unfurl_links` · `unfurl_media`)도 끈다.
//!   서식 기호(`*` · `_` · `~` · `` ` ``)는 걷지 않는다 — Slack mrkdwn 에는 백슬래시 이스케이프가 없고, 그 기호가
//!   할 수 있는 일은 **모양을 바꾸는 것**(굵게·기울임)뿐이라 가린 링크나 멘션을 만들지 못한다.
//!
//! ## 대화에서 나온 글자 — 켠 사람에게만, Rust 안에서만
//!
//! `[messenger] include_conversation`(**기본 켬** — 2026-11-16 사용자 결정, 그 전에는 기본 끔)이면 에이전트 알림에 **대화 제목**과
//! **에이전트 마지막 답의 앞부분**(500자 · 8줄 — [`excerpt_lines`]; 권한 물음이면 묻는 도구 이름과 입력 한 줄)을 싣는다. 프런트는 글자를 모른다 — [`messenger_send`] 에 **대화의
//! 가리킴**(에이전트 · 대화 id · 사건)만 넘기고, 여기서 설정을 한 번 더 본 뒤 대화 파일을 읽어
//! (`crate::agent_transcript::turn_tail`) **구조**([`ConvoLine`])로 뽑고, 채널마다 그려 몸통에 붙인다. 그 글자는
//! 프런트로 돌아가지 않고, 로그·오류 문구에 없고([`conversation_lines`] 는 `Result` 가 아니다 — 못 읽으면 그 칸을
//! 뺄 뿐), `Debug` 도 없다.
//!
//! ## 되풀이·속도 제한 기계는 없다
//!
//! 실패(연결 오류 · 2xx 아닌 응답 · 429 포함)는 그대로 `Err` 로 올라가고 프런트가 콘솔에 한 줄 남긴다.
//! 재시도 큐도 제한기도 두지 않는다 — 문제를 실제로 보기 전에 방어 기계를 늘리지 않는다(CLAUDE.md).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use crate::i18n::tr;

/// 요청 하나의 제한 시간.
const TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// 채널 — 채널마다 갈리는 것은 전부 여기 `match` 한 곳씩
// ---------------------------------------------------------------------------

/// 보낼 수 있는 곳. 프런트와는 소문자 문자열(`"discord"`)로 오간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Discord,
    Slack,
    /// Telegram 봇(2026-11-18 메신저 다리 — 보내기 · 받기 모두 **세션 서버**가 한다: `server::messenger_bridge`). 웹훅이 아니라 [`Webhook`] 이 없다.
    Telegram,
}

/// **웹훅 채널** — 비밀 한 칸이 웹훅 URL 이고 HTTPS POST 한 번으로 보내는 채널(Discord · Slack). 웹훅에만 있는 칸(주소 검사 · 몸통 모양 ·
/// 본문 상한 · 파일 이름)은 여기 `match` 한 곳씩에 있다 — [`Channel`] 의 `match` 와 같이 새 웹훅 채널이 채울 칸을 컴파일러가 센다.
/// Telegram 은 웹훅이 아니라 봇이므로 이 enum 에 없다([`Channel::webhook`] 이 `None`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Webhook {
    Discord,
    Slack,
}

/// Discord 메시지 `content` 의 최대 글자 수.
const DISCORD_CONTENT_MAX_CHARS: usize = 2000;
/// Discord 가 웹훅 URL 로 내주는 네 갈래 호스트.
const DISCORD_HOSTS: &[&str] = &[
    "discord.com",
    "discordapp.com",
    "ptb.discord.com",
    "canary.discord.com",
];
/// Discord 웹훅 경로의 머리.
const DISCORD_PATH_PREFIX: &str = "/api/webhooks/";
/// 승인 대기 · 선언 어긋남 embed 의 색(붉은 실패색 — `#E5484D`).
const DISCORD_ALERT_COLOR: u32 = 0xE5_48_4D;
/// Discord 마크다운 기호 — 앞에 `\` 를 붙이면 글자 그대로 그려진다. 다리의 Discord 전송(`server::messenger_bridge::dc`)도 같은 셋으로 걷는다.
pub(crate) const DISCORD_MARKDOWN_CHARS: &[char] = &[
    '\\', '`', '*', '_', '~', '|', '>', '[', ']', '(', ')', '<', '#',
];

/// Slack 메시지 `text` 의 최대 글자 수(Slack 은 4000자 넘는 `text` 를 자른다).
const SLACK_TEXT_MAX_CHARS: usize = 4000;
/// Slack 이 Incoming Webhook 으로 내주는 호스트.
const SLACK_HOST: &str = "hooks.slack.com";
/// Slack 웹훅 경로의 머리.
const SLACK_PATH_PREFIX: &str = "/services/";

impl Webhook {
    /// 모든 웹훅 채널.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) const ALL: &'static [Webhook] = &[Webhook::Discord, Webhook::Slack];

    /// 그 채널.
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

    /// 본문(`content` · `text`)의 최대 글자 수.
    fn content_max_chars(self) -> usize {
        match self {
            Webhook::Discord => DISCORD_CONTENT_MAX_CHARS,
            Webhook::Slack => SLACK_TEXT_MAX_CHARS,
        }
    }

    /// 사용자가 붙여 넣은 글자 → 웹훅 URL. 틀리면 **까닭을 말하는** 문구 — 그 문구에 URL 은 없다.
    fn validate(self, raw: &str) -> Result<WebhookUrl, String> {
        match self {
            Webhook::Discord => validate_discord(raw),
            Webhook::Slack => validate_slack(raw),
        }
    }

    /// POST 몸통 — 본문은 여기서 상한으로 자른다. `alert`(승인 대기의 선언 어긋남)면 Discord 는 본문을 **붉은 embed** 하나에 싣는다
    /// (멘션 막기는 그대로 — embed 안의 멘션은 원래 울리지 않지만 같은 칸을 싣는다). Slack 은 색 칸이 없어 본문의 주의 줄이 대신한다.
    fn payload(self, text: &str, username: &str, alert: bool) -> serde_json::Value {
        let content = truncate_chars(text, self.content_max_chars());
        match self {
            Webhook::Discord if alert => serde_json::json!({
                "embeds": [{ "description": content, "color": DISCORD_ALERT_COLOR }],
                "username": username,
                "allowed_mentions": { "parse": [] },
            }),
            // `username`(창 제목과 같은 앱 이름) · 멘션 전부 막기.
            Webhook::Discord => serde_json::json!({
                "content": content,
                "username": username,
                "allowed_mentions": { "parse": [] },
            }),
            // `username` 은 싣지 않는다(앱의 Incoming Webhook 은 무시한다). 링크 미리 보기는 끈다 — 원격 글자의
            // 주소를 Slack 서버가 대신 열러 가지 않게. 멘션은 몸통 칸이 아니라 걷기([`Channel::escape`])가 막는다.
            Webhook::Slack => serde_json::json!({
                "text": content,
                "unfurl_links": false,
                "unfurl_media": false,
            }),
        }
    }
}

impl Channel {
    /// 모든 채널 — 씨앗 시험(`instance.rs`)이 비밀 파일 이름을 이것으로 센다.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) const ALL: &'static [Channel] = &[Channel::Discord, Channel::Slack, Channel::Telegram];

    /// 사람이 읽는 이름(오류 문구에 쓴다).
    pub(crate) fn name(self) -> &'static str {
        match self {
            Channel::Discord => "Discord",
            Channel::Slack => "Slack",
            Channel::Telegram => "Telegram",
        }
    }

    /// 웹훅 채널이면 그 갈래 — Telegram(봇)은 `None`.
    pub(crate) fn webhook(self) -> Option<Webhook> {
        match self {
            Channel::Discord => Some(Webhook::Discord),
            Channel::Slack => Some(Webhook::Slack),
            Channel::Telegram => None,
        }
    }

    /// 이 채널의 **봇 토큰 파일** 이름(설정 루트 바로 아래 — 메신저 다리가 있는 채널만). 그 파일을 **읽는 것은 세션 서버뿐**이다
    /// (`server::messenger_bridge` — 이 파일은 이름만 안다).
    pub(crate) fn bot_file(self) -> Option<&'static str> {
        match self {
            Channel::Telegram => Some("telegram-bot"),
            Channel::Discord => Some("discord-bot"),
            Channel::Slack => Some("slack-bot"),
        }
    }

    /// 이 채널의 **비밀 파일** 이름 전부 — 웹훅 URL · 봇 토큰(Discord · Slack 은 둘 — 3b · 4단계). 씨앗 · 설정 옮기기 제외 시험이 센다.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn secret_files(self) -> Vec<&'static str> {
        self.webhook().map(Webhook::webhook_file).into_iter().chain(self.bot_file()).collect()
    }

    /// 남의 글자를 한 줄로 펴고 이 채널의 서식 기호를 걷는다.
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
            // Slack mrkdwn 의 제어 글자 셋만 — 멘션(`<!everyone>` · `<@U…>`)과 링크(`<url|글자>`)는 전부 `<…>` 라
            // 이것으로 막힌다. 서식 기호(`* _ ~ \``)는 걷지 않는다(모듈 머리말 "멘션을 막는다").
            Channel::Slack => flat
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;"),
            // Telegram HTML `parse_mode` — 태그 밖의 `& < >` 셋(Bot API 문서). 우리가 다는 태그(`<b>`)만 남는다 — 남의 글자로 링크 ·
            // 멘션 태그를 만들 수 없다. 링크 미리 보기는 몸통이 끈다(`telegram::send_message_body`).
            Channel::Telegram => crate::telegram::escape_html(&flat),
        }
    }

    /// 대화 줄 하나를 그린다(발췌는 여러 줄 — 줄마다 `> `). 앞의 `「」` · `> ` 는 우리 글자라 걷지 않는다 — 대화 글자는
    /// **줄마다** 걷는다([`Channel::escape`] 는 한 줄로 펴므로 줄을 나눈 뒤에 부른다).
    fn render_convo_line(self, line: &ConvoLine) -> String {
        let out = self.render_convo_line_raw(line);
        match self {
            Channel::Discord | Channel::Slack => out,
            // HTML 에서는 태그 밖의 `>` 도 걷는다(Bot API) — 우리 인용 표식 `> ` 를 `&gt; ` 로(남의 글자는 이미 걷었다).
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

    /// 첫 줄 — `🟡 **확인 필요 · 이름표** — 사건`(등급이 없으면 `**이름표** — 사건`). 이름표가 비면 앱 이름.
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

    /// 알림 한 통을 그린다 — 첫 줄 · (있으면) 둘째 줄 · 대화 줄들. **모든 글자를 걷는다**(우리 문구에 기호가
    /// 없으면 그대로 나간다).
    fn render(self, msg: &Message, convo: &[ConvoLine]) -> String {
        let mut out = self.head(msg);
        if !msg.second.trim().is_empty() {
            out.push('\n');
            out.push_str(&self.escape(&msg.second));
        }
        // Rust 가 지은 덧줄(승인 대기 — AI 설명 · 분석 · 대상 …) — 한 줄씩 **똑같이 걷는다**(AI 가 쓴 글자가 섞여 있다).
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

    /// 설정 화면 "테스트 보내기" 의 고정 문구.
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

    /// 그린 한 통의 상한 — 웹훅은 몸통이 자르고(`Webhook::payload`), Telegram 은 HTML 을 깨지 않게 자른다([`crate::telegram::clip_html`]).
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

/// Discord 주소 검사.
///
/// 받는 모양: `https://<DISCORD_HOSTS>/api/webhooks/<무엇>` — 기본 포트(443)만, 사용자 정보(`user@`) 없이.
/// 경로 뒤는 검사하지 않는다(아이디·토큰의 모양은 Discord 가 정하고, 틀리면 보내 볼 때 거절이 온다).
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

/// Slack 주소 검사.
///
/// 받는 모양: `https://hooks.slack.com/services/<무엇>` — 기본 포트(443)만, 사용자 정보 없이. 경로 뒤(`T…/B…/토큰`)는
/// 검사하지 않는다 — Discord 와 같은 까닭.
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

/// `<설정 루트>/<채널 파일>` (개발 빌드는 `aynx-dev` 아래 — [`crate::instance::config_root`]).
fn webhook_path(channel: Webhook) -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join(channel.webhook_file()))
}

/// 파일에서 읽는다 — 없거나 · 못 읽거나 · 손으로 고쳐 검사를 못 지나면 `None`(= 등록 안 됨).
fn load_at(channel: Webhook, path: &Path) -> Option<WebhookUrl> {
    let text = std::fs::read_to_string(path).ok()?;
    channel.validate(&text).ok()
}

/// 파일에 쓴다(`Some`) · 지운다(`None` — 없어도 성공). 부모 폴더는 만들어 준다.
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

/// 블로킹 없이 읽는다. 실행기 오류도 문구로(URL 없음).
async fn load_async(channel: Webhook) -> Result<Option<WebhookUrl>, String> {
    tauri::async_runtime::spawn_blocking(move || load(channel)).await.map_err(|e| {
        tr!(ko: "웹훅 주소를 읽지 못했습니다: {e}", en: "Could not read the webhook URL: {e}")
    })
}

// ---------------------------------------------------------------------------
// 글자 다듬기 (채널 공통)
// ---------------------------------------------------------------------------

/// `max` 글자(코드 포인트)에서 자른다 — 넘으면 마지막 한 칸을 `…` 로. UTF-8 경계를 가르지 않는다.
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// 한 줄로 편다 — 공백류(줄바꿈 포함) 뭉치를 한 칸으로, 앞뒤를 뗀다.
fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 펴고 → `max` 글자에서 자른다(`…`). 서식 걷기는 채널이 그릴 때 — **자른 뒤**라 `\` 가 글자 수를 먹지 않고
/// 기호 한가운데를 가르지도 않는다.
fn clip(text: &str, max: usize) -> String {
    truncate_chars(&collapse(text), max)
}

// ---------------------------------------------------------------------------
// 알림 한 통 — 프런트가 넘기는 서식 없는 구조
// ---------------------------------------------------------------------------

/// 알림의 **등급** — 첫 줄 앞의 표시(2026-11-16 · 목업 SLiVDZuGJvL9QYg4R93Kav). 프런트와는 소문자 글자로 오간다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Grade {
    /// 사람이 돌아와 눌러야 한다(권한 물음 · 승인 대기 · 앨범의 사람 확인)
    Action,
    /// 끝났다(턴 끝 · 명령 성공 · 실행 성공 · 앨범 끝)
    Done,
    /// 실패했다(명령 실패 · 실행 실패 · 검증 실패)
    Failed,
}

impl Grade {
    /// 앞 표시 — 확인 필요는 노랑(빨강은 실패처럼 보인다 — 사용자 결정).
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

/// 프런트가 넘기는 알림 — **평문**이다(마크다운·이스케이프 없음). 서식은 채널이 입힌다([`Channel::render`]).
#[derive(serde::Deserialize)]
pub struct Message {
    /// 앱 이름(창 제목 — `aynx` · `aynx (dev)`) — 첫 줄에는 싣지 않는다(이름표가 빌 때만)
    app: String,
    /// 등급(없으면 앞 표시 없음)
    #[serde(default)]
    grade: Option<Grade>,
    /// 이름표 — 탭·타일 이름 또는 프로젝트 · 워크트리. 남의 글자일 수 있다(원격이 창 제목을 바꾼다)
    label: String,
    /// 사건 한 토막 — 우리 문구에 남의 글자(에이전트 이름 · 명령 줄 · OSC 본문)가 섞여 있다
    event: String,
    /// 둘째 줄(없으면 빈 글자) — 에이전트 알림의 `12분 30초 · 도구 23회 · …`
    #[serde(default)]
    second: String,
    /// 덧줄 — **Rust 가 짓는 한 통만**(승인 대기 — `operations::notify::pending_message`). 프런트는 채우지 못한다(역직렬화하지 않는다).
    #[serde(skip)]
    lines: Vec<String>,
    /// 경고 색으로 그릴 것인가(승인 대기의 선언 어긋남 — Discord 붉은 embed). 프런트는 채우지 못한다.
    #[serde(skip)]
    alert: bool,
}

impl Message {
    /// Rust 가 짓는 한 통(③-4 — 창이 없을 때의 작업안 결과 · `operations::notify`). 둘째 줄 없음.
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

    /// Rust 가 짓는 여러 줄 한 통(승인 대기 — `operations::notify::pending_message`). 줄마다 채널이 걷는다.
    pub(crate) fn with_lines(app: &str, label: String, event: String, lines: Vec<String>, alert: bool) -> Message {
        Message {
            lines,
            alert,
            ..Message::plain(app, label, event)
        }
    }

    /// 등급을 단다.
    pub(crate) fn graded(self, grade: Option<Grade>) -> Message {
        Message { grade, ..self }
    }

    /// 시험용 — 첫 줄(이름표 · 사건)과 덧줄을 평문 그대로.
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

/// 대화 글자 없이 켜진 채널로 보낸다 — [`messenger_send`] 와 같은 길(등록 안 된 채널은 조용히 건너뛴다). GUI 트레이·세션 서버가
/// 창 없이 작업안 결과를 보낼 때 쓴다(③-4). 실패는 채널마다 모은 문구 하나(URL 없음).
pub(crate) async fn send_plain(message: Message, channels: Vec<Channel>) -> Result<(), String> {
    messenger_send(message, None, channels, None, None, None).await
}

// ---------------------------------------------------------------------------
// 대화에서 나온 글자 (모듈 머리말 "대화에서 나온 글자")
// ---------------------------------------------------------------------------

/// 에이전트 마지막 답 발췌의 최대 글자 수(2026-11-16 300 → 500 — 사용자 결정: 첫 문단 + 끝 질문이 한 화면에).
const EXCERPT_MAX_CHARS: usize = 500;
/// 발췌의 최대 줄 수 — 폰 메신저 한 화면(머리 2~3줄 + 이것).
const EXCERPT_MAX_LINES: usize = 8;
/// 권한 물음의 입력 한 줄(명령 · 경로)의 최대 글자 수.
const PENDING_INPUT_MAX_CHARS: usize = 200;
/// 대화 제목의 최대 글자 수 — 목록의 제목 상한(80)과 같다.
const TITLE_MAX_CHARS: usize = 80;

/// 무슨 사건의 알림인가 — 프런트가 넘긴 글자(`"stop"` · `"permission"`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum AgentEvent {
    Stop,
    Permission,
}

/// 덧붙일 대화 줄 하나 — **서식 없는** 구조(펴고 잘랐을 뿐, 걷지 않았다). 그리는 것은 채널이다
/// ([`Channel::render_convo_line`]). `Debug` 없음 — 대화 글자가 `{:?}` 로 흐를 틈을 두지 않는다.
enum ConvoLine {
    /// 대화 제목
    Title(String),
    /// 에이전트 마지막 답(턴 끝) — 다듬은 줄들([`excerpt_lines`])
    Excerpt(Vec<String>),
    /// 권한을 묻는 도구 이름과 입력 한 줄(권한 물음)
    PendingTool { name: String, input: Option<String> },
}

/// 답의 한 줄을 다듬는다 — 제목 기호(`#`)를 떼고 목록 머리(`-` · `*` · `+`)를 `·` 로, 공백을 편다.
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

/// 그릴 것이 없는 줄 — 코드 울타리(```` ``` ````)와 가로줄(`---` · `***` · `___`).
fn is_noise_line(line: &str) -> bool {
    let l = line.trim();
    l.starts_with("```") || (l.chars().count() >= 3 && l.chars().all(|c| matches!(c, '-' | '*' | '_')))
}

/// 답 → 문단(빈 줄로 갈린 줄 묶음 — 다듬은 줄들).
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

/// 줄 끝에 `…` 를 단다(이미 있으면 그대로).
fn mark_cut(lines: &mut [String]) {
    if let Some(last) = lines.last_mut() {
        if !last.ends_with('…') {
            last.push('…');
        }
    }
}

/// 줄들을 앞에서부터 `max_lines` 줄 · `max_chars` 글자 안에 담는다 — 다 못 담으면 마지막 줄 끝이 `…`.
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
        // 이 줄이 넘친다 — 남은 자리가 넉넉하면 잘라 담고, 아니면 앞 줄 끝에 `…`.
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

/// **턴 끝 발췌** — 줄바꿈을 살려 [`EXCERPT_MAX_CHARS`] 글자 · [`EXCERPT_MAX_LINES`] 줄 안. 넘치면 **첫 문단 + `…` + 끝 문단**
/// (끝 문단이 먼저 자리를 잡는다 — 답 끝의 "다음으로 …할까요?" 가 폰에서 판단할 거리라서). 문단이 하나면 앞에서부터 자른다.
/// 제목 기호(`#`)는 떼고 목록 머리는 `·` 로. 순수 — 걷기는 채널이 줄마다 한다.
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
    // 끝 문단이 먼저 — 첫 문단 한 줄과 `…` 한 줄의 자리(줄 둘 · 글자 80)를 남긴다.
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

/// 프런트가 넘기는 **대화의 가리킴** — 글자가 아니다. `Debug` 없음.
#[derive(serde::Deserialize)]
pub struct ConversationRef {
    /// 에이전트 id(`agent_sessions::TARGETS` — `claude` · `codex`)
    agent: String,
    /// 대화 id(UUID 모양 — 아니면 찾지 않는다)
    id: String,
    /// `"stop"` · `"permission"` — 그 밖은 싣지 않는다
    event: String,
}

/// 대화 제목 · 턴 끝 → 덧붙일 줄들(펴고 잘랐다). **순수 함수** — 시험이 이것을 본다.
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

/// 가리킴 → 덧붙일 줄들. `include` 가 거짓이면 파일을 열지도 않는다. 무엇이든 못 하면 **빈 목록** —
/// 오류 문구를 만들지 않는다(그 문구에 대화 글자가 섞일 틈을 두지 않는다). 루트를 받는다(시험이 임시 폴더를 넘긴다).
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

/// 앱의 길 — 설정 파일의 `include_conversation` 을 **여기서 다시** 본다(프런트가 가리킴을 보냈어도). 블로킹.
fn conversation_lines(c: &ConversationRef) -> Vec<ConvoLine> {
    conversation_lines_in(crate::settings::messenger_include_conversation(), c, None)
}

// ---------------------------------------------------------------------------
// 보내기 (채널 공통)
// ---------------------------------------------------------------------------

/// 클라이언트 하나를 앱 수명 동안 나눠 쓴다 — TLS 설정(OS 신뢰 저장소 읽기)을 매번 다시 하지 않게.
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

/// 그려 둔 본문 하나를 그 채널의 웹훅으로 보낸다. 오류 문구에는 URL 이 없다.
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

/// 등록 안 된 채널의 문구.
fn not_registered(channel: Channel) -> String {
    let name = channel.name();
    match channel.webhook() {
        Some(_) => tr!(ko: "등록된 {name} 웹훅이 없습니다", en: "No {name} webhook is registered"),
        None => tr!(ko: "연결된 {name} 봇이 없습니다", en: "No {name} bot is connected"),
    }
}

/// 봇 채널(Telegram · 웹훅이 없는 Discord · Slack) 몫 한 통 — **세션 서버가 보낸다**(봇 토큰을 읽는 것은 서버뿐 — `server::messenger_bridge` 머리말).
/// 세션 서버 안에서 부르면(작업안 결과 · 승인 대기 · 앨범 사건 — `send_plain`) 다리 함수를 곧장, GUI 프로세스면 서버 op `messenger_bot_notify` 로
/// (`messenger_bridge_proxy`). 봇이 없거나 짝이 없으면 조용히 건너뛴다(웹훅의 "등록 안 됨" 과 같다).
async fn send_bot(notice: crate::server::messenger_bridge::Notice) -> Result<(), String> {
    if crate::server::hub::in_server() {
        crate::server::messenger_bridge::notify(notice).await
    } else {
        crate::server::messenger_bridge_proxy::notify(notice).await
    }
}

/// 그 채널의 봇이 세션 서버에 등록돼 있는가(토큰은 오가지 않는다 — 상태의 `configured`). 서버 안이면 다리 표를, GUI 면 서버 op 를 본다.
async fn bot_configured(channel: Channel) -> bool {
    if crate::server::hub::in_server() {
        crate::server::messenger_bridge::configured(channel)
    } else {
        crate::server::messenger_bridge_proxy::configured(channel).await
    }
}

/// 그 채널의 웹훅 파일을 지운다 — 봇 토큰을 등록하면(방법은 한 번에 하나 — 3b · 4단계 사용자 결정) `messenger_bridge_proxy` 가 부른다.
pub(crate) async fn remove_webhook(webhook: Webhook) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || match webhook_path(webhook) {
        Some(path) => save_at(&path, None).map_err(|e| tr!(ko: "웹훅 주소를 지우지 못했습니다: {e}", en: "Could not remove the webhook URL: {e}")),
        None => Ok(()),
    })
    .await
    .map_err(|e| tr!(ko: "웹훅 지우기를 실행하지 못했습니다: {e}", en: "Could not run the webhook removal: {e}"))?
}

// ---------------------------------------------------------------------------
// 명령 — 전부 `async fn` (docs/conventions.md). 값을 돌려주는 명령은 없다.
// ---------------------------------------------------------------------------

/// 프런트가 받는 상태 — **등록됐는가**와 **어느 방법으로**(`"webhook"` · `"bot"` · 없음). URL · 토큰은 싣지 않는다.
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

/// 그 채널이 등록돼 있는가 · 어느 방법인가 — Telegram: 봇(세션 서버의 상태) · Discord · Slack: 웹훅이 있으면 웹훅, 없으면 봇(방법은 한 번에
/// 하나 — 3b · 4단계).
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

/// 그 채널의 웹훅을 등록한다(`Some`) · 지운다(`None` 또는 빈 글자). 틀린 주소는 까닭과 함께 거절한다. Telegram 봇 토큰은 이 명령이 아니라
/// `messenger_bot_set_token` 으로 등록한다(세션 서버가 받는다). Discord · Slack 은 방법이 한 번에 하나라 봇 토큰이 등록돼 있으면 등록을 거절한다
/// (지우기는 된다 · 서버의 봇 상태를 묻는다 — 토큰 파일은 읽지 않는다). 봇을 웹훅으로 바꾸는 것은 [`messenger_replace_bot_with_webhook`] —
/// 이 명령은 원격 창에도 열려 있어 봇을 지우지 않는다.
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

/// **Discord · Slack 봇을 웹훅으로 바꾼다**(2026-11-19 — 설정의 "연결 방식" 확인 [바꾸기]). 순서: 주소 검사(틀리면 거절 · 아무것도 안 바뀜) → 봇 해제
/// (서버 op `messenger_bot_set_token{token: null}` — 짝도 지운다 · 실패하면 거절 · 웹훅은 저장하지 않음) → 웹훅 저장. 원격 창은 막힌다(`remote/deny.rs`
/// HOME_ONLY — 봇 토큰 해제와 같은 쪽 · 웹훅만 넣는 [`messenger_set_webhook`] 은 원격 허용이라 봇을 지우지 않는다). 토큰 파일은 읽지 않는다.
/// 웹훅이 있는 채널(Discord · Slack)만 — Telegram 은 거절.
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

/// 고정된 시험 문구 한 줄을 그 채널로 보낸다 — 설정 화면의 "테스트 보내기". Telegram 은 `messenger_bot_test` 와 같은 길 · Discord · Slack 은 등록된
/// 방법으로(웹훅이 있으면 웹훅, 없으면 봇).
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

/// 알림 한 통을 `channels` 가운데 **등록된 채널 각각**에 보낸다. 무엇을 언제 보낼지는 프런트가 정한다
/// (`src/lib/app/messenger.ts`). 등록 안 된 채널은 조용히 건너뛴다. 한 채널의 실패가 다른 채널을 막지 않고,
/// 실패는 채널마다 모아 문구 하나로 돌려준다(URL 없음). 사건이 빈 글자면 아무것도 보내지 않는다.
///
/// `conversation` 이 오면(에이전트 알림 · `include_conversation` 을 켠 사람) 여기서 설정을 다시 보고 대화 파일을
/// 읽어 제목·발췌를 **뒤에 붙인다** — 그 글자는 이 함수 밖으로(프런트·로그·오류) 나가지 않는다(모듈 머리말).
///
/// `operation` 이 오면(승인 대기 — 승인 요약) 프런트가 넘긴 `message` 는 앱 이름만 쓰고, 한 통은 여기서 짓는다: 서버 목록에서 그 작업안이
/// **아직 사람을 기다리는지** 다시 보고(자동 승인 · 거절 · 만료로 떠났으면 보내지 않는다) 설정 파일의 칸을 다시 본 뒤
/// `operations::notify::pending_message` 가 짓는다. 프런트는 작업안 id 하나만 넘긴다(글자를 짓지 않는다).
///
/// `stream` · `kind`(2026-11-18 메신저 다리 — 선택): 그 알림을 낸 타일의 스트림과 종류(`stop` · `permission` …). Telegram 몫에만 쓰인다 —
/// 서버가 "보낸 메시지 id → 스트림" 을 적어 답장을 그 타일로 보내고(이름표도 기억), 다리가 시작한 턴의 같은 알림은 한 번 더 보내지 않는다.
/// 없으면 그 둘만 빠진다(알림은 그대로 간다).
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
    // 봇으로 보낼 채널(Telegram · 웹훅이 없는 Discord · Slack — 봇 · 짝이 없으면 서버가 조용히 건너뛴다)
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
            // 등록 안 됨 — 봇이 있는 채널(Discord · Slack)은 봇으로, 아니면 조용히 건너뛴다
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
            // Telegram 은 와이어에 채널을 싣지 않는다(3a 그대로 — 없으면 Telegram)
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
