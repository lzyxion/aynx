//! 메신저 다리 시험 — 루프백 가짜 Slack(Web API = tiny_http · Socket Mode = tokio-tungstenite 받는 쪽) 통합(4단계). 부모(`tests`)의 가짜 바깥 ·
//! 가짜 Telegram · 카드 표 도우미를 같이 쓴다.

use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize};

// 지어낸 값 — 조각으로 적어 컴파일 때 잇는다(소스에 토큰 꼴 글자가 통으로 있으면 저장소의 비밀 검사가 진짜 토큰으로 본다).
const BOT: &str = concat!("xo", "xb-", "1234567890", "-", "1234567890123", "-", "abcdefghijklmnopqrstuvwx");
const BOT_OTHER: &str = concat!("xo", "xb-", "9999999999", "-", "9999999999999", "-", "abcdefghijklmnopqrstuvwx");
const APP: &str = concat!("xa", "pp-", "1", "-", "A0123456789", "-", "1234567890123", "-", "abcdef0123456789abcdef0123456789");
const APP_OTHER: &str = concat!("xa", "pp-", "1", "-", "A9999999999", "-", "9999999999999", "-", "abcdef0123456789abcdef0123456789");
/// 문서의 견본 id — 짝지을 사람 · 그 DM · 다른 사람.
const USER: &str = "U024BE7LH";
const CHAT: &str = "D024BE91L";
const STRANGER: &str = "U0G9QF9C6";

fn pair_tokens(bot: &str, app: &str) -> String {
    format!("{bot}\n{app}")
}

/// 가짜 Slack — Web API 호출을 (메서드, 몸)으로 적고, Socket Mode 에는 줄 세운 봉투를 준다 · 받음 답을 적는다.
struct FakeSl {
    calls: Mutex<Vec<(String, Value)>>,
    seq: AtomicI64,
    envelopes: Mutex<Vec<Value>>,
    acks: Mutex<Vec<String>>,
    env_seq: AtomicUsize,
    /// 지금 연결에 이 까닭으로 `disconnect` 를 보낸다
    disconnect: Mutex<Option<String>>,
    /// 앱 수준 토큰 폐기 — `apps.connections.open` 이 `invalid_auth`
    revoked: AtomicBool,
    /// 다음 `chat.postMessage` 에 429 를 한 번
    limit_once: AtomicBool,
    opens: AtomicUsize,
    connections: AtomicUsize,
    ws_port: Mutex<u16>,
}

fn now_secs() -> i64 {
    (now_ms() / 1000) as i64
}

impl FakeSl {
    fn queue(&self, mut env: Value) -> String {
        let id = format!("env-{}", self.env_seq.fetch_add(1, Ordering::SeqCst));
        env["envelope_id"] = json!(id);
        self.envelopes.lock().unwrap().push(env);
        id
    }

    fn ts(&self, ago_secs: i64) -> String {
        format!("{}.{:06}", now_secs() - ago_secs, self.seq.fetch_add(1, Ordering::SeqCst) % 1_000_000)
    }

    /// DM 한 통(그 스레드 안이면 `thread`) — (봉투 id, 글 ts).
    fn dm(&self, user: &str, text: &str, ago_secs: i64, thread: Option<&str>) -> (String, String) {
        let ts = self.ts(ago_secs);
        let mut ev = json!({ "type": "message", "channel_type": "im", "channel": CHAT, "user": user, "text": text, "ts": ts, "event_ts": ts });
        if let Some(t) = thread {
            ev["thread_ts"] = json!(t);
        }
        let id = self.queue(json!({ "type": "events_api", "accepts_response_payload": false, "payload": { "type": "event_callback", "event": ev } }));
        (id, ts)
    }

    fn press(&self, user: &str, ts: &str, value: &str) -> String {
        self.queue(json!({ "type": "interactive", "accepts_response_payload": false, "payload": {
            "type": "block_actions", "user": { "id": user }, "channel": { "id": CHAT, "name": "directmessage" }, "message": { "ts": ts },
            "container": { "type": "message", "message_ts": ts, "channel_id": CHAT },
            "actions": [{ "action_id": "a0", "block_id": "b0", "value": value, "type": "button" }],
            "response_url": "https://hooks.slack.com/actions/T0/1/x", "trigger_id": "1.2.3" } }))
    }

    fn of(&self, method: &str) -> Vec<Value> {
        self.calls.lock().unwrap().iter().filter(|(m, _)| m == method).map(|(_, v)| v.clone()).collect()
    }

    fn posts(&self) -> Vec<Value> {
        self.of("chat.postMessage")
    }

    fn updates(&self) -> Vec<Value> {
        self.of("chat.update")
    }

    fn acked(&self, id: &str) -> bool {
        self.acks.lock().unwrap().iter().any(|a| a == id)
    }

    /// 보낸 · 바꿔 쓴 통마다 section 글자를 이은 것.
    fn texts(&self) -> Vec<String> {
        self.calls.lock().unwrap().iter().filter(|(m, _)| m == "chat.postMessage" || m == "chat.update").map(|(_, v)| body_text(v)).collect()
    }

    /// 단추 통(가장 최근)의 (본문, value 들, ts).
    fn buttons(&self, needle: &str) -> Option<(String, Vec<String>, String)> {
        self.posts().into_iter().rev().find_map(|v| {
            let values: Vec<String> = v["blocks"]
                .as_array()?
                .iter()
                .filter(|b| b["type"] == "actions")
                .flat_map(|b| b["elements"].as_array().cloned().unwrap_or_default())
                .filter_map(|e| e["value"].as_str().map(str::to_string))
                .collect();
            let text = body_text(&v);
            (!values.is_empty() && text.contains(needle)).then(|| (text, values, v["_ts"].as_str().unwrap_or("").to_string()))
        })
    }
}

/// section 글자들을 줄로 잇는다.
/// 블록 하나의 글 — section 은 그 글, rich_text 는 글 조각을 이은 것(굵은 머리 조각 + `\n` 몸).
fn block_text(b: &Value) -> Option<String> {
    match b["type"].as_str()? {
        "section" => b["text"]["text"].as_str().map(str::to_string),
        "rich_text" => Some(
            b["elements"]
                .as_array()?
                .iter()
                .flat_map(|s| s["elements"].as_array().cloned().unwrap_or_default())
                .filter_map(|e| e["text"].as_str().map(str::to_string))
                .collect(),
        ),
        _ => None,
    }
}

fn body_text(v: &Value) -> String {
    v["blocks"].as_array().map(|bs| bs.iter().filter_map(block_text).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

fn has_actions(v: &Value) -> bool {
    v["blocks"].as_array().is_some_and(|bs| bs.iter().any(|b| b["type"] == "actions"))
}

/// 가짜 Slack 을 띄운다 — (가짜, Web API 바탕, 서버).
fn start_fake_sl() -> (Arc<FakeSl>, String, Arc<tiny_http::Server>) {
    let fake = Arc::new(FakeSl {
        calls: Mutex::new(Vec::new()),
        seq: AtomicI64::new(1),
        envelopes: Mutex::new(Vec::new()),
        acks: Mutex::new(Vec::new()),
        env_seq: AtomicUsize::new(1),
        disconnect: Mutex::new(None),
        revoked: false.into(),
        limit_once: false.into(),
        opens: AtomicUsize::new(0),
        connections: AtomicUsize::new(0),
        ws_port: Mutex::new(0),
    });
    // Socket Mode
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    *fake.ws_port.lock().unwrap() = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let f = fake.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            loop {
                let Ok((tcp, _)) = listener.accept().await else { return };
                let f = f.clone();
                tokio::spawn(async move { socket_conn(f, tcp).await });
            }
        });
    });
    // Web API
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
    let port = server.server_addr().to_ip().unwrap().port();
    let (f, s) = (fake.clone(), server.clone());
    std::thread::spawn(move || {
        for mut req in s.incoming_requests() {
            let f = f.clone();
            std::thread::spawn(move || {
                let method = req.url().trim_start_matches('/').to_string();
                let auth = req.headers().iter().find(|h| h.field.equiv("Authorization")).map(|h| h.value.as_str().to_string());
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let mut v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let bearer = |t: &str| auth.as_deref() == Some(&format!("Bearer {t}"));
                let mut headers = Vec::new();
                let (code, out) = match method.as_str() {
                    "auth.test" if bearer(BOT) => (200, json!({ "ok": true, "user": "aynx_sl_bot", "user_id": "U0BOT0001", "bot_id": "B0BOT0001" })),
                    "apps.connections.open" => {
                        assert!(!bearer(BOT), "봇 토큰은 Web API 에만 — 앱 연결 열기에 싣지 않는다");
                        if bearer(APP) && !f.revoked.load(Ordering::SeqCst) {
                            let n = f.opens.fetch_add(1, Ordering::SeqCst);
                            let port = *f.ws_port.lock().unwrap();
                            (200, json!({ "ok": true, "url": format!("ws://127.0.0.1:{port}/link/?ticket=t{n}&app_id=A1") }))
                        } else {
                            (200, json!({ "ok": false, "error": "invalid_auth" }))
                        }
                    }
                    m if m.starts_with("chat.") => {
                        assert!(!bearer(APP), "앱 수준 토큰은 Web API 에 싣지 않는다");
                        if !bearer(BOT) {
                            (200, json!({ "ok": false, "error": "invalid_auth" }))
                        } else if m == "chat.postMessage" && f.limit_once.swap(false, Ordering::SeqCst) {
                            f.calls.lock().unwrap().push(("429".into(), v.clone()));
                            headers.push(tiny_http::Header::from_bytes("Retry-After", "0").unwrap());
                            (429, json!({ "ok": false, "error": "ratelimited" }))
                        } else if m == "chat.postMessage" {
                            let ts = f.ts(0);
                            v["_ts"] = json!(ts);
                            f.calls.lock().unwrap().push((m.to_string(), v.clone()));
                            (200, json!({ "ok": true, "channel": CHAT, "ts": ts }))
                        } else {
                            f.calls.lock().unwrap().push((m.to_string(), v.clone()));
                            (200, json!({ "ok": true }))
                        }
                    }
                    _ => (200, json!({ "ok": false, "error": "invalid_auth" })),
                };
                let mut resp = tiny_http::Response::from_string(out.to_string()).with_status_code(code);
                for h in headers {
                    resp = resp.with_header(h);
                }
                let _ = req.respond(resp);
            });
        }
    });
    (fake, format!("http://127.0.0.1:{port}"), server)
}

/// Socket Mode 연결 하나 — `hello` → 줄 세운 봉투 · 받음 답 적기 · `disconnect` 하라면 그 까닭으로.
async fn socket_conn(f: Arc<FakeSl>, tcp: tokio::net::TcpStream) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let Ok(mut ws) = tokio_tungstenite::accept_async(tcp).await else { return };
    f.connections.fetch_add(1, Ordering::SeqCst);
    let hello = json!({ "type": "hello", "num_connections": 1, "connection_info": { "app_id": "A1" }, "debug_info": { "approximate_connection_time": 18060 } });
    let _ = ws.send(Message::text(hello.to_string())).await;
    loop {
        let reason = f.disconnect.lock().unwrap().take();
        if let Some(reason) = reason {
            let _ = ws.send(Message::text(json!({ "type": "disconnect", "reason": reason, "debug_info": { "host": "x" } }).to_string())).await;
            while let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
                if matches!(m, Message::Close(_)) {
                    break;
                }
            }
            return;
        }
        let batch: Vec<Value> = std::mem::take(&mut *f.envelopes.lock().unwrap());
        for env in batch {
            let _ = ws.send(Message::text(env.to_string())).await;
        }
        let msg = match tokio::time::timeout(Duration::from_millis(20), ws.next()).await {
            Err(_) => continue,
            Ok(None) | Ok(Some(Err(_))) => return,
            Ok(Some(Ok(m))) => m,
        };
        match msg {
            Message::Text(t) => {
                let v: Value = serde_json::from_str(t.as_str()).unwrap();
                if let Some(id) = v["envelope_id"].as_str() {
                    f.acks.lock().unwrap().push(id.to_string());
                }
            }
            Message::Close(_) => return,
            _ => {}
        }
    }
}

fn sl_cfg(api: &str, tg_base: &str, dir: &std::path::Path, env: Arc<FakeEnv>) -> Config {
    let mut slack = sl::Conf::at(api);
    slack.connect_backoff = Duration::from_millis(100);
    slack.stable = Duration::from_millis(50);
    slack.hello_timeout = Duration::from_secs(2);
    Config {
        telegram: tg::Conf { api: Api::at(tg_base), poll_timeout_secs: 1 },
        discord: dc::Conf::release(),
        slack,
        dir: Some(dir.to_path_buf()),
        env,
        backoff: Duration::from_millis(50),
        conflict_backoff: Duration::from_millis(50),
        enter_delay: Duration::from_millis(5),
        ask_grace: Duration::from_millis(100),
        answer_poll: Duration::from_millis(20),
        answer_deadline: Duration::from_millis(500),
        answer_wait: Duration::from_millis(1000),
    }
}

fn sl(body: Value) -> Value {
    let mut b = if body.is_object() { body } else { json!({}) };
    b["channel"] = json!("slack");
    b
}

#[test]
fn live_bridge_with_fake_slack() {
    let _one = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (fake, api, server) = start_fake_sl();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let dir = std::env::temp_dir().join(format!("aynx-bridge-sl-{}-{}", std::process::id(), now_ms()));
    let env = Arc::new(FakeEnv::default());
    rt.block_on(async { start(sl_cfg(&api, "http://127.0.0.1:9", &dir, env.clone())) });
    let op = |name: &str, body: Value| rt.block_on(handle(name, body));
    let status = || op("messenger_bot_status", sl(Value::Null)).unwrap();
    let st = status();
    assert_eq!((st["configured"].as_bool(), st["link"].as_str()), (Some(false), Some("off")));

    // 토큰 — 틀린 모양(하나만 · 봇 둘) · 봇 토큰 거절 · 앱 수준 토큰 거절(어느 쪽인지 가른다 · 토큰 없음) · 등록(차례 무관) · 파일 몸은 두 줄.
    for bad in [BOT.to_string(), pair_tokens(BOT, BOT_OTHER), "nope".into()] {
        assert!(op("messenger_bot_set_token", sl(json!({ "token": bad }))).unwrap_err().message.starts_with("[bad-token]"));
    }
    let e = op("messenger_bot_set_token", sl(json!({ "token": pair_tokens(BOT_OTHER, APP) }))).unwrap_err();
    assert!(e.message.starts_with("[bad-token]") && e.message.contains("bot token") && !e.message.contains("abcdef"), "{}", e.message);
    let e = op("messenger_bot_set_token", sl(json!({ "token": pair_tokens(BOT, APP_OTHER) }))).unwrap_err();
    assert!(e.message.starts_with("[bad-token]") && e.message.contains("app-level token") && !e.message.contains("abcdef"), "{}", e.message);
    assert!(!dir.join("slack-bot").exists());
    let st = op("messenger_bot_set_token", sl(json!({ "token": format!("  {APP}  {BOT}\n") }))).unwrap();
    assert_eq!((st["configured"].as_bool(), st["bot"].as_str(), st["paired"].as_bool()), (Some(true), Some("aynx_sl_bot"), Some(false)));
    assert!(!st.to_string().contains("abcdef"), "상태에 토큰이 없다");
    assert_eq!(std::fs::read_to_string(dir.join("slack-bot")).unwrap(), pair_tokens(BOT, APP));
    assert!(configured(Channel::Slack) && !configured(Channel::Discord) && !configured(Channel::Telegram));
    wait_for("소켓 ok", || status()["link"] == "ok");

    // 짝짓기 — 봇 글 · DM 이 아닌 글은 버린다 · 낯선 사람 → 코드 답(봉투마다 받음 답) · [허용].
    fake.queue(json!({ "type": "events_api", "payload": { "event": { "type": "message", "channel_type": "channel", "channel": "C024BE91L", "user": STRANGER, "text": "hi", "ts": fake.ts(0) } } }));
    fake.queue(json!({ "type": "events_api", "payload": { "event": { "type": "message", "channel_type": "im", "channel": CHAT, "bot_id": "B1", "user": STRANGER, "text": "hi", "ts": fake.ts(0) } } }));
    let (env_id, _) = fake.dm(USER, "hello", 0, None);
    wait_for("코드 답", || fake.texts().iter().any(|t| t.contains("연결 코드") || t.contains("Pairing code")));
    wait_for("받음 답", || fake.acked(&env_id));
    assert_eq!(fake.posts().len(), 1, "버린 글에는 답하지 않는다");
    assert!(fake.posts().iter().all(|v| v["channel"] == CHAT && v["unfurl_links"] == false && v["unfurl_media"] == false));
    let pending = status()["pending"].clone();
    let code = pending["code"].as_str().unwrap().to_string();
    assert_eq!(pending["name"], USER, "이름 = 사용자 id 글자(users:read 를 요구하지 않는다)");
    let st = op("messenger_bot_pair", sl(json!({ "code": code, "allow": true }))).unwrap();
    assert_eq!(st["paired"].as_bool(), Some(true));
    let chat_file = std::fs::read_to_string(dir.join("slack-chat")).unwrap();
    assert!(chat_file.contains(&format!("\"chatId\":{}", sl::id_num(CHAT).unwrap())), "{chat_file}");

    // 다리 꺼짐(Slack 칸) → 거절 답 · Telegram 칸이 켜져 있어도.
    env.chat_on.store(true, Ordering::SeqCst);
    let before = fake.posts().len();
    fake.dm(USER, "do it", 0, None);
    wait_for("꺼짐 답", || fake.posts().len() > before);
    assert!(env.writes.lock().unwrap().is_empty());
    env.slack_on.store(true, Ordering::SeqCst);

    // 하나뿐 → 넣기(글자 되돌리기 — 걷힌 `& < >` · 링크로 바뀐 글자) · "→ 이름표" 는 맨 위 글이라 맨 위로.
    env.tiles.lock().unwrap().insert("local-s1".into(), (ready_tile("claude"), 11));
    fake.dm(USER, "fix &lt;x&gt; &amp; *bug* in <http://main.rs|main.rs> for <@U0G9QF9C6>", 0, None);
    wait_for("넣기", || env.writes.lock().unwrap().len() == 2);
    assert_eq!(env.writes.lock().unwrap()[0], (11, b"\x1b[200~fix <x> & *bug* in main.rs for @U0G9QF9C6\x1b[201~".to_vec()));
    wait_for("→ 답", || fake.posts().iter().any(|v| body_text(v) == "→ claude · local-s1"));
    let arrow = fake.posts().into_iter().rfind(|v| body_text(v) == "→ claude · local-s1").unwrap();
    assert!(arrow.get("thread_ts").is_none(), "맨 위 글에는 맨 위로");
    assert_eq!(arrow["blocks"][0]["type"], "rich_text");

    // 다리 턴의 끝 → 답 전문(rich_text 한 블록 — 굵은 머리 조각 + 몸 · 답의 서식은 조각의 style · 멘션 꼴은 글자 그대로 · 2900 단위 안).
    let before = fake.posts().len();
    on_turn_event("local-s1", TurnEvent::Done, Some("claude"), Some("c1".into()));
    wait_for("답", || fake.posts().len() >= before + 2);
    let posts = fake.posts();
    let answer = &posts[before];
    let pieces = &answer["blocks"][0]["elements"][0]["elements"];
    assert_eq!(answer["blocks"][0]["type"], "rich_text");
    assert_eq!(pieces[0], json!({ "type": "text", "text": "🟢 claude · local-s1", "style": { "bold": true } }));
    assert_eq!(pieces[1], json!({ "type": "text", "text": "\nDONE <ok> & " }), "{answer}");
    assert_eq!(pieces[2], json!({ "type": "text", "text": "굵게", "style": { "bold": true } }));
    assert_eq!(pieces[4], json!({ "type": "text", "text": "a*b", "style": { "code": true } }));
    assert!(!answer.to_string().contains("\"link\"") && !answer.to_string().contains("\"user\""), "링크 · 멘션 요소는 없다");
    assert!(answer["text"].as_str().unwrap().contains("&lt;ok&gt; &amp;"), "미리 보기 글은 걷는다");
    for p in &posts[before..] {
        for b in p["blocks"].as_array().unwrap() {
            // 머리 조각 + 줄바꿈 + 몸(몸이 2900 단위 안)
            assert!(sl::units(&block_text(b).unwrap()) <= sl::TEXT_ROOM + 64);
        }
    }

    // 스레드 = 답장 — 답 통의 스레드에 단 글은 그 타일로 · 그 결과 줄은 그 스레드로.
    let answer_ts = answer["_ts"].as_str().unwrap().to_string();
    let before = fake.posts().len();
    fake.dm(USER, "next", 0, Some(&answer_ts));
    wait_for("스레드 넣기", || env.writes.lock().unwrap().len() == 4);
    wait_for("스레드 답", || fake.posts().len() > before);
    let reply = fake.posts().into_iter().rfind(|v| body_text(v) == "→ claude · local-s1").unwrap();
    assert_eq!(reply["thread_ts"], json!(answer_ts), "스레드 안의 글에는 그 스레드로");
    // 그 턴의 답도 그 스레드로(턴을 시작한 글의 자리 — 실기 2026-11-19: 답만 맨 위로 왔다) · 맨 위에서 시작한 턴의 답은 맨 위로.
    assert!(answer.get("thread_ts").is_none(), "맨 위에서 시작한 턴의 답은 맨 위로");
    let before = fake.posts().len();
    on_turn_event("local-s1", TurnEvent::Done, Some("claude"), Some("c1".into()));
    wait_for("스레드 턴의 답", || fake.posts().len() > before);
    assert_eq!(fake.posts()[before]["thread_ts"], json!(answer_ts), "스레드에서 시작한 턴의 답은 그 스레드로");

    // 여럿 → 고르기 단추(블록마다 하나) · 다른 사람의 누름은 버린다 · 누르면 그 타일에 · 단추 통을 결과로(단추 걷음 · 받음 답).
    on_turn_event("local-s1", TurnEvent::Gone, None, None);
    env.tiles.lock().unwrap().insert("local-s2".into(), (ready_tile("codex"), 22));
    fake.dm(USER, "which", 0, None);
    wait_for("단추", || fake.buttons("").is_some());
    let (_, values, ts) = fake.buttons("").unwrap();
    assert_eq!(values.len(), 2);
    let pick = fake.posts().into_iter().rfind(has_actions).unwrap();
    assert_eq!(pick["blocks"].as_array().unwrap().iter().filter(|b| b["type"] == "actions").count(), 2, "다섯 이하면 블록마다 하나");
    fake.press(STRANGER, &ts, &values[1]);
    let press_env = fake.press(USER, &ts, &values[1]);
    wait_for("고른 타일에 넣기", || env.writes.lock().unwrap().iter().any(|(id, _)| *id == 22));
    wait_for("단추 통 바꿈", || fake.updates().iter().any(|v| body_text(v).starts_with("→") && !has_actions(v) && v["ts"] == json!(ts)));
    assert!(fake.acked(&press_env));
    assert!(fake.of("chat.postEphemeral").is_empty(), "바꿔 쓰는 누름에는 따로 글이 없다");
    assert_eq!(env.writes.lock().unwrap().iter().filter(|(id, _)| *id == 22).count(), 2, "다른 사람의 누름은 넣지 않았다");

    // 지난 글 → 넣지 않고 한 통.
    let writes = env.writes.lock().unwrap().len();
    on_turn_event("local-s2", TurnEvent::Gone, None, None);
    fake.dm(USER, "old", STALE_SECS + 30, None);
    wait_for("지난 글 알림", || fake.texts().iter().any(|t| t.contains("1개") || t.contains("1 message")));
    assert_eq!(env.writes.lock().unwrap().len(), writes);

    // 알림 — 그려 둔 mrkdwn 은 verbatim(429 한 번은 쉬고 다시) · 시험 한 통.
    fake.limit_once.store(true, Ordering::SeqCst);
    let before = fake.posts().len();
    rt.block_on(notify(Notice { text: "*작업안* — x &lt;y&gt;".into(), stream: None, kind: None, label: None, channel: Some(Channel::Slack), has_tool: false })).unwrap();
    assert_eq!(fake.posts().len(), before + 1);
    assert!(fake.calls.lock().unwrap().iter().any(|(m, _)| m == "429"), "429 뒤 한 번 다시");
    let n = fake.posts().pop().unwrap();
    assert_eq!(n["blocks"][0]["text"], json!({ "type": "mrkdwn", "text": "*작업안* — x &lt;y&gt;", "verbatim": true }));
    op("messenger_bot_test", sl(Value::Null)).unwrap();

    // `disconnect refresh_requested` → 새 주소로 다시 붙는다 · 그 뒤에도 받는다.
    let opens = fake.opens.load(Ordering::SeqCst);
    *fake.disconnect.lock().unwrap() = Some("refresh_requested".into());
    wait_for("다시 열기", || fake.opens.load(Ordering::SeqCst) > opens);
    wait_for("다시 ok", || status()["link"] == "ok");
    let before = fake.posts().len();
    fake.dm(USER, "after refresh", 0, None);
    wait_for("다시 붙은 뒤 받기", || fake.posts().len() > before);

    // 짝 끊기 → 알림은 조용히 건너뛴다.
    assert_eq!(op("messenger_bot_unpair", sl(Value::Null)).unwrap()["paired"], false);
    assert!(!dir.join("slack-chat").exists());
    let before = fake.posts().len();
    rt.block_on(notify(Notice { text: "x".into(), stream: None, kind: None, label: None, channel: Some(Channel::Slack), has_tool: false })).unwrap();
    assert_eq!(fake.posts().len(), before, "짝이 없으면 보내지 않는다");
    assert!(op("messenger_bot_test", sl(Value::Null)).unwrap_err().message.starts_with("[not-paired]"));

    // `link_disabled` → 상태 error · 고리는 멈춘다(다시 열지 않는다).
    *fake.disconnect.lock().unwrap() = Some("link_disabled".into());
    wait_for("error", || status()["link"] == "error");
    let opens = fake.opens.load(Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(fake.opens.load(Ordering::SeqCst), opens, "link_disabled 뒤에는 다시 열지 않는다");

    // 다시 등록(같은 토큰) → 다시 붙는다 · 앱 수준 토큰 폐기(invalid_auth) → error · 멈춘다.
    op("messenger_bot_set_token", sl(json!({ "token": pair_tokens(BOT, APP) }))).unwrap();
    wait_for("다시 등록 ok", || status()["link"] == "ok");
    fake.revoked.store(true, Ordering::SeqCst);
    let conns = fake.connections.load(Ordering::SeqCst);
    *fake.disconnect.lock().unwrap() = Some("warning".into());
    wait_for("인증 오류 error", || status()["link"] == "error");
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(fake.connections.load(Ordering::SeqCst), conns, "인증 오류 뒤에는 다시 붙지 않는다");

    // 토큰 해제 — 파일 둘 다 지우고 고리 멈춤.
    let st = op("messenger_bot_set_token", sl(json!({ "token": null }))).unwrap();
    assert_eq!((st["configured"].as_bool(), st["link"].as_str()), (Some(false), Some("off")));
    assert!(!dir.join("slack-bot").exists());
    // 보낸 몸 어디에도 토큰이 없다
    assert!(!fake.calls.lock().unwrap().iter().any(|(_, v)| v.to_string().contains("abcdef")));
    server.unblock();
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}

/// Telegram 과 Slack 이 **같은 스트림**을 함께 돌본다: 카드 → 두 채널에 단추 → Slack 에서 먼저 누름 → 결정 · Telegram 통은 `gone` 으로 바꿔 쓴다 ·
/// 늦은 Telegram 누름은 "이미" · 꺼진 Slack 의 누름은 바꿔 쓰지 않으니 누른 사람에게만 보이는 글(`chat.postEphemeral`).
#[test]
fn live_cards_on_telegram_and_slack() {
    let _one = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (tgf, tg_base, tg_server) = start_fake();
    let (fake, api, server) = start_fake_sl();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let dir = std::env::temp_dir().join(format!("aynx-bridge-tgsl-{}-{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("telegram-bot"), TOKEN).unwrap();
    std::fs::write(dir.join(CHAT_FILE), r#"{"userId":42,"chatId":42,"name":"Tester"}"#).unwrap();
    std::fs::write(dir.join("slack-bot"), pair_tokens(BOT, APP)).unwrap();
    let paired = format!(r#"{{"userId":{},"chatId":{},"name":"{USER}"}}"#, sl::id_num(USER).unwrap(), sl::id_num(CHAT).unwrap());
    std::fs::write(dir.join(SLACK_CHAT_FILE), paired).unwrap();
    let env = Arc::new(FakeEnv::default());
    env.chat_on.store(true, Ordering::SeqCst);
    env.slack_on.store(true, Ordering::SeqCst);
    rt.block_on(async { start(sl_cfg(&api, &tg_base, &dir, env.clone())) });
    let op = |name: &str, body: Value| rt.block_on(handle(name, body));
    wait_for("둘 다 ok", || {
        op("messenger_bot_status", Value::Null).unwrap()["link"] == "ok" && op("messenger_bot_status", sl(Value::Null)).unwrap()["link"] == "ok"
    });

    let emit: crate::server::signal_http::Emit = Arc::new(|_| {});
    let plane = crate::server::signal_http::start(emit, None).expect("평면");
    let port = plane.port;
    let ask = |t: &Tile, body: Value| {
        let raw = perm_req(port, &t.stream, "ask", &t.token, &body);
        std::thread::spawn(move || http(port, &raw))
    };
    let a = open_tile("sl", 8);
    a.detach();
    let label = format!("claude · {}", a.stream);
    for chan in [Channel::Telegram, Channel::Slack] {
        let mut s = state();
        let c = s.chan(chan);
        c.turns.begin(&a.stream, now_ms());
        c.tending.tend(&a.stream);
    }
    let waiter = ask(&a, bash("claude", "Bash", "rm -rf build"));
    wait_for("Telegram 단추", || tgf.button_message(&label).is_some());
    wait_for("Slack 단추", || fake.buttons(&label).is_some());
    let (_, tg_allow, _) = tgf.button_message(&label).unwrap();
    let (text, values, ts) = fake.buttons(&label).unwrap();
    assert!(text.contains("🟡") && text.contains("Bash · rm -rf build"), "{text}");
    assert!(values[0].starts_with("pa:") && values[1].starts_with("pd:"));
    // Slack 에서 [허용] → 훅 허용 · 그 통은 결과로(단추 걷음) · Telegram 통은 `gone` 으로
    fake.press(USER, &ts, &values[0]);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""behavior":"allow""#), "{got}");
    wait_for("Slack 바꿈", || {
        fake.updates().iter().any(|v| body_text(v).contains(&label) && body_text(v).ends_with(&logic::press_text(PressResult::Allowed)) && !has_actions(v))
    });
    wait_for("Telegram 바꿈", || tgf.edits().iter().any(|t| t.contains(&label) && t.ends_with(&logic::gone_text("allowed"))));
    // 늦은 Telegram 누름은 "이미"
    tgf.press("late", 42, &tg_allow);
    wait_for("이미", || tgf.callback_answer("late").is_some_and(|t| t == logic::press_text(PressResult::Already)));

    // 다음 카드 — Slack 칸을 끄고 누르면 바꿔 쓰지 않으니 누른 사람에게만 보이는 글
    let waiter = ask(&a, bash("claude", "Bash", "cargo publish"));
    wait_for("Slack 둘째 단추", || fake.buttons("cargo publish").is_some());
    let (_, values, ts) = fake.buttons("cargo publish").unwrap();
    env.slack_on.store(false, Ordering::SeqCst);
    let updates = fake.updates().len();
    fake.press(USER, &ts, &values[0]);
    wait_for("누른 사람에게만", || !fake.of("chat.postEphemeral").is_empty());
    let eph = fake.of("chat.postEphemeral").pop().unwrap();
    assert_eq!((eph["channel"].as_str(), eph["user"].as_str()), (Some(CHAT), Some(USER)));
    assert_eq!(fake.updates().len(), updates, "꺼짐 — 단추는 그대로");
    assert_eq!(standing(&a.stream), 1);
    // Telegram 에서 거절 → Slack 통은 `gone` 으로
    let (_, _, tg_deny) = tgf.button_message("cargo publish").unwrap();
    tgf.press("tgd", 42, &tg_deny);
    assert!(waiter.join().unwrap().contains(r#""behavior":"deny""#));
    wait_for("Slack 이 gone 으로", || fake.updates().iter().any(|v| body_text(v).ends_with(&logic::gone_text("denied")) && v["ts"] == json!(ts)));

    on_turn_event(&a.stream, TurnEvent::Gone, None, None);
    assert!(!tends(&a.stream), "두 채널 모두 걷는다");
    a.close();
    op("messenger_bot_set_token", json!({ "token": null })).unwrap();
    op("messenger_bot_set_token", sl(json!({ "token": null }))).unwrap();
    server.unblock();
    tg_server.unblock();
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}
