use super::*;

const GOOD: &str = "https://discord.com/api/webhooks/123456789/abcDEF-token_xyz";
const D: Channel = Channel::Discord;

fn msg(app: &str, label: &str, event: &str, second: &str) -> Message {
    Message {
        app: app.into(),
        label: label.into(),
        event: event.into(),
        second: second.into(),
        lines: Vec::new(),
        alert: false,
    }
}

#[test]
fn channel_is_a_lowercase_string_on_the_wire() {
    assert_eq!(serde_json::to_string(&D).unwrap(), "\"discord\"");
    assert_eq!(serde_json::from_str::<Channel>("\"discord\"").unwrap(), D);
    assert!(serde_json::from_str::<Channel>("\"Discord\"").is_err());
    assert!(serde_json::from_str::<Channel>("\"email\"").is_err());
    assert_eq!(serde_json::to_string(&S).unwrap(), "\"slack\"");
    assert_eq!(serde_json::from_str::<Channel>("\"slack\"").unwrap(), S);
}

// ── Slack ────────────────────────────────────────────────────────────────

const S: Channel = Channel::Slack;
const SLACK_GOOD: &str = "https://hooks.slack.com/services/T0001/B0002/SlackSecretTok";

#[test]
fn slack_accepts_only_hooks_services() {
    assert!(S.validate(SLACK_GOOD).is_ok());
    assert_eq!(
        S.validate(&format!("  {SLACK_GOOD}\n")).unwrap().as_str(),
        SLACK_GOOD
    );
    for bad in [
        "",
        "not a url",
        "http://hooks.slack.com/services/T/B/x", // https 아님
        "https://slack.com/services/T/B/x",      // 다른 호스트
        "https://hooks.slack.com.evil.com/services/T/B/x", // 꼬리 붙인 호스트
        "https://evilhooks.slack.com/services/T/B/x",
        "https://hooks.slack.com/service/T/B/x", // 경로가 다르다
        "https://hooks.slack.com/services/",     // 경로 뒤가 비었다
        "https://hooks.slack.com/services//",
        "https://hooks.slack.com:8443/services/T/B/x", // 포트
        "https://u:p@hooks.slack.com/services/T/B/x",  // 사용자 정보
        "https://hooks.slack.com/workflows/T/A/x",     // 워크플로 웹훅은 몸통 모양이 다르다
        GOOD,                                          // Discord 주소는 Slack 칸에 못 넣는다
    ] {
        assert!(S.validate(bad).is_err(), "{bad}");
    }
    // 반대도 — Slack 주소는 Discord 칸에 못 넣는다.
    assert!(D.validate(SLACK_GOOD).is_err());
}

#[test]
fn slack_errors_never_contain_the_url() {
    for secret in [
        "https://evil.com/services/T/B/SECRET-TOKEN",
        "http://hooks.slack.com/services/T/B/SECRET-TOKEN",
        "https://hooks.slack.com:1/services/T/B/SECRET-TOKEN",
    ] {
        let err = S.validate(secret).unwrap_err();
        assert!(!err.contains("SECRET-TOKEN"), "{err}");
    }
    assert!(!format!("{:?}", S.validate(SLACK_GOOD).unwrap()).contains("SlackSecretTok"));
}

#[test]
fn slack_payload_shape() {
    let v = S.payload("<!everyone> 빌드 끝남", "aynx (dev)", false);
    assert_eq!(
        v["text"], "<!everyone> 빌드 끝남",
        "몸통은 그려 둔 글자 그대로 — 걷기는 render 가 한다"
    );
    assert_eq!(v["unfurl_links"], false);
    assert_eq!(v["unfurl_media"], false);
    let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys.len(),
        3,
        "username 등 다른 키는 싣지 않는다 ({keys:?})"
    );
    let long = "가".repeat(5000);
    let text = S.payload(&long, "aynx", false)["text"].as_str().unwrap().to_owned();
    assert_eq!(text.chars().count(), SLACK_TEXT_MAX_CHARS);
    assert!(text.ends_with('…'));
}

#[test]
fn slack_escaping_blocks_mentions_and_links() {
    assert_eq!(S.escape("<!everyone> hi"), "&lt;!everyone&gt; hi");
    assert_eq!(S.escape("<@U123> <!here>"), "&lt;@U123&gt; &lt;!here&gt;");
    assert_eq!(S.escape("<https://x|y>"), "&lt;https://x|y&gt;");
    assert_eq!(S.escape("a & b &amp;"), "a &amp; b &amp;amp;");
    // 한 줄로 편다 · 서식 기호는 그대로(백슬래시 이스케이프가 없다)
    assert_eq!(
        S.escape("  *굵게*\n\n_기울임_ `x` ~s~  "),
        "*굵게* _기울임_ `x` ~s~"
    );
    assert!(!S.escape("a > b").contains('>'));
}

#[test]
fn slack_render_shapes() {
    assert_eq!(
        S.render(&msg("aynx", "web-01", "끝", ""), &[]),
        "*aynx · web-01* — 끝"
    );
    assert_eq!(
        S.render(&msg("aynx (dev)", "a<b>", "x & y", "  "), &[]),
        "*aynx (dev) · a&lt;b&gt;* — x &amp; y"
    );
    assert_eq!(
        S.render(&msg("aynx", "a", "x", "12분 30초"), &[]),
        "*aynx · a* — x\n12분 30초"
    );
    // 실패 문구의 괄호는 Slack 에서 걷지 않는다(Discord 와 달리 제어 글자가 아니다)
    assert_eq!(
        S.render(&msg("aynx", "t", "명령 실패 · 3분 05초 (코드 1)", ""), &[]),
        "*aynx · t* — 명령 실패 · 3분 05초 (코드 1)"
    );
    assert_eq!(
        S.render(
            &msg("aynx", "t", "프로그램 알림 — <!channel> [x](y)", ""),
            &[]
        ),
        "*aynx · t* — 프로그램 알림 — &lt;!channel&gt; [x](y)"
    );
    assert!(S
        .test_text()
        .starts_with(&format!("*{}*", crate::instance::WINDOW_TITLE)));
}

#[test]
fn slack_conversation_lines_keep_our_quote_marker() {
    let t = tail_of(
        Some("see <https://evil|here> & more\nlines"),
        Some("Bash<x>"),
    );
    let stop: Vec<String> = conversation_block(AgentEvent::Stop, Some("제목 <!here>"), &t)
        .iter()
        .map(|l| S.render_convo_line(l))
        .collect();
    assert_eq!(
        stop,
        vec![
            "「제목 &lt;!here&gt;」".to_string(),
            "> see &lt;https://evil|here&gt; &amp; more lines".to_string(),
        ]
    );
    let perm: Vec<String> = conversation_block(AgentEvent::Permission, None, &t)
        .iter()
        .map(|l| S.render_convo_line(l))
        .collect();
    assert_eq!(perm.len(), 1);
    assert!(
        perm[0].starts_with("> ") && perm[0].ends_with("Bash&lt;x&gt;"),
        "{perm:?}"
    );
    let body = S.render(
        &msg("aynx", "p", "e", "1분 00초"),
        &conversation_block(AgentEvent::Stop, None, &t),
    );
    assert_eq!(
        body,
        "*aynx · p* — e\n1분 00초\n> see &lt;https://evil|here&gt; &amp; more lines"
    );
}

#[test]
fn accepts_discord_webhook_hosts() {
    assert!(D.validate(GOOD).is_ok());
    for host in DISCORD_HOSTS {
        let url = format!("https://{host}/api/webhooks/1/tok");
        assert!(D.validate(&url).is_ok(), "{host}");
    }
    // 앞뒤 공백은 뗀다(붙여 넣기에 흔하다).
    assert_eq!(D.validate(&format!("  {GOOD}\n")).unwrap().as_str(), GOOD);
}

#[test]
fn rejects_everything_else() {
    for bad in [
        "",
        "not a url",
        "http://discord.com/api/webhooks/1/tok", // https 아님
        "https://evil.com/api/webhooks/1/tok",   // 다른 호스트
        "https://discord.com.evil.com/api/webhooks/1/tok", // 꼬리 붙인 호스트
        "https://evildiscord.com/api/webhooks/1/tok",
        "https://discord.com/api/webhook/1/tok", // 경로가 다르다
        "https://discord.com/api/webhooks/",     // 경로 뒤가 비었다
        "https://discord.com/api/webhooks//",
        "https://discord.com:8443/api/webhooks/1/tok", // 포트
        "https://user:pw@discord.com/api/webhooks/1/tok", // 사용자 정보
        "https://discord.com/channels/1/2",
    ] {
        assert!(D.validate(bad).is_err(), "{bad}");
    }
}

#[test]
fn errors_never_contain_the_url() {
    let secret = "https://evil.com/api/webhooks/1/SECRET-TOKEN";
    let err = D.validate(secret).unwrap_err();
    assert!(!err.contains("SECRET-TOKEN"), "{err}");
    // 채널 이름만 싣는 문구들
    for c in Channel::ALL {
        assert!(!not_registered(*c).contains("http"));
    }
}

#[test]
fn debug_is_redacted() {
    let url = D.validate(GOOD).unwrap();
    let shown = format!("{url:?}");
    assert!(!shown.contains("token"), "{shown}");
    assert!(!shown.contains("discord"), "{shown}");
    assert_eq!(shown, "WebhookUrl(<redacted>)");
    // 감싼 구조체로 흘러도 같다.
    let wrapped = format!("{:?}", Some(url));
    assert!(!wrapped.contains("abcDEF"), "{wrapped}");
}

#[test]
fn truncates_on_char_boundary() {
    assert_eq!(truncate_chars("abc", 5), "abc");
    assert_eq!(truncate_chars("abcde", 5), "abcde");
    assert_eq!(truncate_chars("abcdef", 5), "abcd…");
    // 여러 바이트 글자 — 바이트가 아니라 글자로 센다(경계를 가르면 패닉이다).
    let long = "가".repeat(2500);
    let cut = truncate_chars(&long, DISCORD_CONTENT_MAX_CHARS);
    assert_eq!(cut.chars().count(), DISCORD_CONTENT_MAX_CHARS);
    assert!(cut.ends_with('…'));
    let emoji = "😀".repeat(3);
    assert_eq!(truncate_chars(&emoji, 2), "😀…");
}

#[test]
fn payload_shape_blocks_mentions() {
    let v = D.payload("@everyone 빌드 끝남", "aynx (dev)", false);
    assert_eq!(v["content"], "@everyone 빌드 끝남");
    assert_eq!(v["username"], "aynx (dev)");
    assert_eq!(v["allowed_mentions"], serde_json::json!({ "parse": [] }));
    assert_eq!(v.as_object().unwrap().len(), 3, "다른 키는 싣지 않는다");
    let long = "x".repeat(5000);
    assert_eq!(
        D.payload(&long, "aynx", false)["content"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        DISCORD_CONTENT_MAX_CHARS
    );
}

#[test]
fn file_round_trip_and_removal() {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aynx-messenger-{}-{nanos}", std::process::id()));
    let path = dir.join(D.webhook_file());

    assert!(load_at(D, &path).is_none(), "파일이 없으면 등록 안 됨");
    let url = D.validate(GOOD).unwrap();
    save_at(&path, Some(&url)).expect("쓰기(부모 폴더도 만든다)");
    assert_eq!(load_at(D, &path), Some(url));

    // 손으로 고쳐 망가진 파일은 등록 안 됨으로 읽는다.
    std::fs::write(&path, "https://evil.com/api/webhooks/1/x").unwrap();
    assert!(load_at(D, &path).is_none());

    save_at(&path, None).expect("지우기");
    assert!(!path.exists());
    save_at(&path, None).expect("없는 파일을 지워도 성공");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discord_escaping_rules() {
    // 옛 프런트 `escapeDiscordMarkdown` 시험(messenger-notify.test.ts)과 같은 입력 · 같은 결과.
    assert_eq!(
        D.escape("[click](https://evil.example)"),
        r"\[click\]\(https://evil.example\)"
    );
    assert_eq!(
        D.escape("[눌러](https://evil.example)"),
        r"\[눌러\]\(https://evil.example\)"
    );
    assert_eq!(D.escape("  a\n\n b\t*c*  "), r"a b \*c\*");
    assert_eq!(
        D.escape("**굵게** _기울임_ `코드` ~~취소~~ ||가림|| > 인용 # 제목"),
        r"\*\*굵게\*\* \_기울임\_ \`코드\` \~\~취소\~\~ \|\|가림\|\| \> 인용 \# 제목"
    );
    assert_eq!(D.escape("a\n\nb\\c <@123>"), r"a b\\c \<@123\>");
    assert_eq!(
        D.escape(r"<@123> # h > q `x` ~s~ |sp| _u_ \"),
        r"\<@123\> \# h \> q \`x\` \~s\~ \|sp\| \_u\_ \\"
    );
}

/// 옛 프런트 서식 시험(`messengerLine` · `messengerBody` · 사건 문구의 이스케이프)을 옮겨 온 것 — 결과 글자가
/// 1단계 전과 같아야 한다(docs/log/2026-09-28-messenger-channels.md).
#[test]
fn discord_render_matches_the_old_front_format() {
    // 머리 — 앱 이름 · 이름표를 굵게
    assert_eq!(
        D.render(&msg("aynx", "web-01", "끝", ""), &[]),
        "**aynx · web-01** — 끝"
    );
    assert_eq!(
        D.render(&msg("aynx (dev)", "a*b", "끝", ""), &[]),
        r"**aynx \(dev\) · a\*b** — 끝"
    );
    // 둘째 줄 — 비면 한 줄
    assert_eq!(
        D.render(&msg("aynx", "a", "x", "  "), &[]),
        "**aynx · a** — x"
    );
    assert_eq!(
        D.render(&msg("aynx", "a", "x", "12분 30초"), &[]),
        "**aynx · a** — x\n12분 30초"
    );
    // 사건에 섞인 남의 글자 — 명령 줄 · OSC 본문 · 에이전트 이름 · 여러 줄
    assert_eq!(
        D.render(
            &msg("aynx", "t", "\"npm run *build*\" 끝남 · 3분 05초", ""),
            &[]
        ),
        r#"**aynx · t** — "npm run \*build\*" 끝남 · 3분 05초"#
    );
    assert_eq!(
        D.render(&msg("aynx", "t", "Program notification — [x](y)", ""), &[]),
        r"**aynx · t** — Program notification — \[x\]\(y\)"
    );
    assert_eq!(
        D.render(&msg("aynx", "t", "Claude Code 작업이 끝났습니다", ""), &[]),
        "**aynx · t** — Claude Code 작업이 끝났습니다"
    );
    assert_eq!(
        D.render(&msg("aynx", "t", "프로그램 알림 — a\n\nb", ""), &[]),
        "**aynx · t** — 프로그램 알림 — a b"
    );
    // 알려진 차이 하나: 실패 문구의 괄호 `(코드 1)` 는 이제 걷힌다(Discord 가 그리는 모양은 같다).
    assert_eq!(
        D.render(&msg("aynx", "t", "명령 실패 · 3분 05초 (코드 1)", ""), &[]),
        r"**aynx · t** — 명령 실패 · 3분 05초 \(코드 1\)"
    );
}

#[test]
fn excerpt_collapses_cuts_on_char_boundary_then_escapes() {
    let long = format!("{}\n\n{}", "가".repeat(200), "*".repeat(200));
    let x = D.escape(&clip(&long, EXCERPT_MAX_CHARS));
    assert!(x.ends_with('…'), "{x}");
    // 자른 뒤 걷는다 — 글자 수(백슬래시 뺀)는 상한 그대로
    assert_eq!(x.replace('\\', "").chars().count(), EXCERPT_MAX_CHARS);
    assert!(!x.contains('\n'));
    assert_eq!(clip("짧다", EXCERPT_MAX_CHARS), "짧다");
    assert_eq!(clip("😀😀😀", 2), "😀…");
}

fn tail_of(text: Option<&str>, tool: Option<&str>) -> crate::agent_transcript::TurnTail {
    crate::agent_transcript::TurnTail {
        text: text.map(str::to_owned),
        pending_tool: tool.map(str::to_owned),
    }
}

fn rendered(lines: &[ConvoLine]) -> Vec<String> {
    lines.iter().map(|l| D.render_convo_line(l)).collect()
}

#[test]
fn conversation_block_shapes() {
    let t = tail_of(Some("Split the **center**\ninto two."), Some("Bash"));
    let stop = conversation_block(AgentEvent::Stop, Some("알림 [센터]"), &t);
    assert_eq!(
        rendered(&stop),
        vec![
            r"「알림 \[센터\]」".to_string(),
            r"> Split the \*\*center\*\* into two.".to_string()
        ]
    );
    let perm = rendered(&conversation_block(AgentEvent::Permission, None, &t));
    assert_eq!(perm.len(), 1);
    assert!(
        perm[0].starts_with("> ") && perm[0].ends_with("Bash"),
        "{perm:?}"
    );
    assert!(
        !perm[0].contains("center"),
        "권한 물음에는 답 발췌를 싣지 않는다"
    );
    assert!(conversation_block(AgentEvent::Stop, None, &tail_of(None, None)).is_empty());
    assert!(
        conversation_block(AgentEvent::Stop, Some("  "), &tail_of(Some(" \n "), None)).is_empty()
    );
    // 본문 뒤에 붙는 모양 — 첫 줄 · 둘째 줄 · 대화 줄들
    assert_eq!(D.render(&msg("aynx", "p", "e", ""), &[]), "**aynx · p** — e");
    assert_eq!(
        D.render(&msg("aynx", "p", "e", "1분 00초"), &stop),
        "**aynx · p** — e\n1분 00초\n「알림 \\[센터\\]」\n> Split the \\*\\*center\\*\\* into two."
    );
}

const CONVO_ID: &str = "11111111-2222-4333-8444-5555555555aa";

/// 임시 Claude 루트 하나에 대화 파일 하나 — 루트.
fn claude_fixture(tag: &str, lines: &[serde_json::Value]) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!(
        "aynx-messenger-convo-{tag}-{}-{nanos}",
        std::process::id()
    ));
    let dir = root.join("C--w-p");
    std::fs::create_dir_all(&dir).unwrap();
    let body: String = lines.iter().map(|v| v.to_string() + "\n").collect();
    std::fs::write(dir.join(format!("{CONVO_ID}.jsonl")), body).unwrap();
    root
}

fn claude_lines(answer: &str) -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({"type": "user", "cwd": "/w/p", "sessionId": CONVO_ID, "timestamp": "2026-09-27T01:00:00.000Z",
               "origin": {"kind": "human"}, "message": {"role": "user", "content": "please split the center"}}),
        json!({"type": "ai-title", "aiTitle": "알림 센터 두 칸으로 나누기", "sessionId": CONVO_ID}),
        json!({"type": "assistant", "cwd": "/w/p", "sessionId": CONVO_ID, "timestamp": "2026-09-27T01:00:05.000Z",
               "message": {"model": "m", "content": [{"type": "thinking", "thinking": "SECRET-THOUGHT"}, {"type": "text", "text": answer}]}}),
    ]
}

#[test]
fn conversation_lines_read_title_and_excerpt_only_when_on() {
    let answer = format!(
        "NotificationCenter.svelte 에 두 칸을 나눴습니다.\n\n{}",
        "자세히 ".repeat(100)
    );
    let root = claude_fixture("on", &claude_lines(&answer));
    let roots = vec![root.clone()];
    let c = ConversationRef {
        agent: "claude".into(),
        id: CONVO_ID.into(),
        event: "stop".into(),
    };

    let lines = rendered(&conversation_lines_in(true, &c, Some(&roots)));
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert!(lines[0].contains("알림 센터 두 칸으로 나누기"), "{lines:?}");
    assert!(
        lines[1].starts_with("> NotificationCenter.svelte 에 두 칸을"),
        "{lines:?}"
    );
    assert!(lines[1].ends_with('…'));
    assert!(
        lines.iter().all(|l| !l.contains("SECRET-THOUGHT")),
        "생각은 싣지 않는다"
    );

    // 꺼져 있으면 아무것도 — 파일을 열지도 않는다.
    assert!(conversation_lines_in(false, &c, Some(&roots)).is_empty());
    // 모르는 사건 · 모르는 에이전트 · 모양이 틀린 id · 없는 대화 → 빈 목록(오류 문구 없음).
    for bad in [
        ConversationRef {
            agent: "claude".into(),
            id: CONVO_ID.into(),
            event: "other".into(),
        },
        ConversationRef {
            agent: "nope".into(),
            id: CONVO_ID.into(),
            event: "stop".into(),
        },
        ConversationRef {
            agent: "claude".into(),
            id: "../../etc/passwd".into(),
            event: "stop".into(),
        },
        ConversationRef {
            agent: "claude".into(),
            id: "99999999-2222-4333-8444-555555555555".into(),
            event: "stop".into(),
        },
    ] {
        assert!(conversation_lines_in(true, &bad, Some(&roots)).is_empty());
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn webhook_file_lives_in_the_config_root() {
    // 개발 폴더 씨앗에 들지 않는 것은 `instance.rs` 의 `seed_list_never_carries_secrets_or_tokens` 가 잰다.
    for c in Channel::ALL {
        let path = webhook_path(*c).expect("설정 루트");
        assert_eq!(path.file_name().unwrap(), c.webhook_file());
        assert_eq!(path.parent(), crate::instance::config_root().as_deref());
    }
    assert_eq!(
        D.webhook_file(),
        "discord-webhook",
        "파일 이름은 1단계 전과 같다(기존 등록이 산다)"
    );
    assert_eq!(S.webhook_file(), "slack-webhook");
}

/// 승인 대기(승인 요약) — Rust 가 지은 덧줄도 **한 줄씩 똑같이 걷는다**(AI 가 쓴 설명이 섞여 있다). 어긋남은 Discord 붉은 embed.
#[test]
fn pending_lines_are_escaped_and_alert_is_an_embed() {
    let m = Message::with_lines(
        "AYNX",
        "원격 명령 승인 대기".into(),
        "제목".into(),
        vec!["AI 설명: <!everyone> **굵게** [링크](https://evil)".into(), "  ".into()],
        true,
    );
    let s = S.render(&m, &[]);
    assert!(s.contains("&lt;!everyone&gt;"), "{s}");
    assert!(!s.contains("<!everyone>"), "{s}");
    assert_eq!(s.lines().count(), 2, "빈 덧줄은 싣지 않는다: {s}");
    let d = D.render(&m, &[]);
    assert!(d.contains(r"\*\*굵게\*\*") && d.contains(r"\[링크\]\(https://evil\)"), "{d}");
    let v = D.payload(&d, "aynx", true);
    assert!(v.get("content").is_none(), "{v}");
    assert_eq!(v["embeds"][0]["color"], DISCORD_ALERT_COLOR);
    assert_eq!(v["allowed_mentions"]["parse"], serde_json::json!([]));
    let calm = D.payload(&d, "aynx", false);
    assert!(calm.get("embeds").is_none() && calm["content"].is_string());
    // 프런트가 보낸 몸통에는 덧줄 · 경고 칸이 없다(역직렬화하지 않는다).
    let from_front: Message =
        serde_json::from_value(serde_json::json!({ "app": "a", "label": "b", "event": "c", "lines": ["x"], "alert": true })).unwrap();
    assert!(from_front.lines.is_empty() && !from_front.alert);
}
