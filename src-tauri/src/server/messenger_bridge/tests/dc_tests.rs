//! 메신저 다리 시험 — 루프백 가짜 Discord(REST = tiny_http · 게이트웨이 = tokio-tungstenite 받는 쪽) 통합(3b). 부모(`tests`)의 가짜 바깥 ·
//! 가짜 Telegram · 카드 표 도우미를 같이 쓴다.

use super::*;
use std::sync::atomic::AtomicUsize;

// 지어낸 값 — 조각으로 적어 컴파일 때 잇는다(소스에 토큰 꼴 글자가 통으로 있으면 저장소의 비밀 검사가 진짜 토큰으로 본다).
const DC_TOKEN: &str = concat!("MTIzNDU2Nzg5MDEy", "MzQ1Njc4", ".", "GabcDE", ".", "abcdefghijklmnopqrstuvwxyz", "0123456789ABCD");
const DC_OTHER: &str = concat!("OTk5OTk5OTk5OTk5", "OTk5OTk5", ".", "GabcDE", ".", "abcdefghijklmnopqrstuvwxyz", "0123456789ABCD");
/// 우리 봇 · 앱 id(READY)
const BOT_ID: i64 = 1;
const APP_ID: i64 = 200;

/// 가짜 Discord — REST 호출을 (메서드, 경로, 몸)으로 적고, 게이트웨이에는 줄 세운 사건을 준다.
struct FakeDc {
    calls: Mutex<Vec<(String, String, Value)>>,
    next_id: AtomicI64,
    /// 게이트웨이로 보낼 사건 `(t, d)`
    events: Mutex<Vec<(String, Value)>>,
    /// 다음 `POST /channels/…/messages` 에 429 를 한 번
    limit_once: std::sync::atomic::AtomicBool,
    /// 이 닫힘 코드로 지금 연결을 닫는다
    close_with: Mutex<Option<u16>>,
    /// 토큰 폐기 — 이어지는 IDENTIFY · RESUME 에도 4004
    revoked: std::sync::atomic::AtomicBool,
    connections: AtomicUsize,
    identifies: AtomicUsize,
    resumes: AtomicUsize,
    heartbeats: AtomicUsize,
}

static DC_MSG: AtomicI64 = AtomicI64::new(1);

/// 지금 시각의 스노플레이크(보낸 시각 = 그 id 의 시각 · 지난 글은 `ago_secs` 앞).
fn flake(ago_secs: i64) -> i64 {
    let ms = now_ms() as i64 - ago_secs * 1000 - 1_420_070_400_000;
    (ms << 22) | (DC_MSG.fetch_add(1, Ordering::SeqCst) & 0xfff)
}

impl FakeDc {
    fn dispatch(&self, t: &str, d: Value) {
        self.events.lock().unwrap().push((t.to_string(), d));
    }

    /// DM 한 통(보낸 사람 id · DM 대화방 = id × 100).
    fn dm(&self, from: i64, text: &str, ago_secs: i64, reply_to: Option<i64>) -> i64 {
        let id = flake(ago_secs);
        let mut d = json!({ "id": id.to_string(), "channel_id": (from * 100).to_string(), "type": 0, "content": text,
            "author": { "id": from.to_string(), "username": "tester", "global_name": "Tester" } });
        if let Some(r) = reply_to {
            d["type"] = json!(19);
            d["message_reference"] = json!({ "message_id": r.to_string() });
        }
        self.dispatch("MESSAGE_CREATE", d);
        id
    }

    /// 단추 누름(DM).
    fn press(&self, iid: i64, from: i64, message_id: i64, custom_id: &str) {
        self.dispatch(
            "INTERACTION_CREATE",
            json!({ "id": iid.to_string(), "application_id": APP_ID.to_string(), "type": 3, "token": format!("itok-{iid}"),
                "channel_id": (from * 100).to_string(), "user": { "id": from.to_string() },
                "message": { "id": message_id.to_string(), "channel_id": (from * 100).to_string() },
                "data": { "custom_id": custom_id, "component_type": 2 } }),
        );
    }

    fn sent(&self) -> Vec<(String, String, Value)> {
        self.calls.lock().unwrap().clone()
    }

    /// 보낸 · 바꿔 쓴 글(`content`).
    fn contents(&self) -> Vec<String> {
        self.sent()
            .into_iter()
            .filter(|(m, p, _)| (m == "POST" || m == "PATCH") && p.starts_with("/channels/"))
            .map(|(_, _, v)| v["content"].as_str().unwrap_or("").to_string())
            .collect()
    }

    fn posts(&self) -> Vec<Value> {
        self.sent().into_iter().filter(|(m, p, _)| m == "POST" && p.starts_with("/channels/")).map(|(_, _, v)| v).collect()
    }

    fn patches(&self) -> Vec<Value> {
        self.sent().into_iter().filter(|(m, _, _)| m == "PATCH").map(|(_, _, v)| v).collect()
    }

    fn path_hit(&self, prefix: &str) -> Vec<Value> {
        self.sent().into_iter().filter(|(_, p, _)| p.starts_with(prefix)).map(|(_, _, v)| v).collect()
    }

    /// 단추 통(가장 최근)의 (본문, custom_id 들, 메시지 id).
    fn buttons(&self, needle: &str) -> Option<(String, Vec<String>, i64)> {
        let calls = self.calls.lock().unwrap();
        calls.iter().rev().find_map(|(m, p, v)| {
            let rows = v["components"].as_array().filter(|r| !r.is_empty())?;
            let text = v["content"].as_str().unwrap_or("").to_string();
            if m != "POST" || !p.starts_with("/channels/") || !text.contains(needle) {
                return None;
            }
            let ids = rows.iter().flat_map(|r| r["components"].as_array().cloned().unwrap_or_default()).filter_map(|b| b["custom_id"].as_str().map(str::to_string)).collect();
            Some((text, ids, v["_id"].as_i64()?))
        })
    }
}

/// 가짜 Discord 를 띄운다 — (가짜, REST 바탕, 게이트웨이 주소, REST 서버).
fn start_fake_dc() -> (Arc<FakeDc>, String, String, Arc<tiny_http::Server>) {
    let fake = Arc::new(FakeDc {
        calls: Mutex::new(Vec::new()),
        next_id: AtomicI64::new(5000),
        events: Mutex::new(Vec::new()),
        limit_once: false.into(),
        close_with: Mutex::new(None),
        revoked: false.into(),
        connections: AtomicUsize::new(0),
        identifies: AtomicUsize::new(0),
        resumes: AtomicUsize::new(0),
        heartbeats: AtomicUsize::new(0),
    });
    // REST
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
    let port = server.server_addr().to_ip().unwrap().port();
    let (f, s) = (fake.clone(), server.clone());
    std::thread::spawn(move || {
        for mut req in s.incoming_requests() {
            let f = f.clone();
            std::thread::spawn(move || {
                let method = req.method().as_str().to_string();
                let path = req.url().to_string();
                let auth = req.headers().iter().find(|h| h.field.equiv("Authorization")).map(|h| h.value.as_str().to_string());
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let mut v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let bot_ok = auth.as_deref() == Some(&format!("Bot {DC_TOKEN}"));
                let (code, out) = if path.starts_with("/interactions/") || path.starts_with("/webhooks/") {
                    // 누름의 토큰이 주소에 든다 — 봇 토큰을 싣지 않는다
                    assert!(auth.is_none(), "콜백 · 후속 글에 봇 토큰을 싣지 않는다");
                    (if path.starts_with("/interactions/") { 204 } else { 200 }, json!({ "id": "1" }))
                } else if !bot_ok {
                    (401, json!({ "message": "401: Unauthorized", "code": 0 }))
                } else if method == "GET" && path == "/users/@me" {
                    (200, json!({ "id": BOT_ID.to_string(), "username": "aynx_dc_bot", "bot": true }))
                } else if method == "POST" && path.ends_with("/messages") {
                    if f.limit_once.swap(false, Ordering::SeqCst) {
                        f.calls.lock().unwrap().push(("429".into(), path.clone(), v.clone()));
                        let _ = req.respond(tiny_http::Response::from_string(r#"{"message":"You are being rate limited.","retry_after":0.05,"global":false}"#).with_status_code(429));
                        return;
                    }
                    let id = f.next_id.fetch_add(1, Ordering::SeqCst);
                    v["_id"] = json!(id);
                    (200, json!({ "id": id.to_string(), "channel_id": "1", "content": "" }))
                } else {
                    (200, json!({}))
                };
                f.calls.lock().unwrap().push((method, path, v));
                let resp = if code == 204 { tiny_http::Response::from_string("") } else { tiny_http::Response::from_string(out.to_string()) };
                let _ = req.respond(resp.with_status_code(code));
            });
        }
    });
    // 게이트웨이
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let gw_port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let f = fake.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            loop {
                let Ok((tcp, _)) = listener.accept().await else { return };
                let f = f.clone();
                tokio::spawn(async move { gateway_conn(f, tcp, gw_port).await });
            }
        });
    });
    (fake, format!("http://127.0.0.1:{port}"), format!("ws://127.0.0.1:{gw_port}/?v=10&encoding=json"), server)
}

/// 게이트웨이 연결 하나 — HELLO(박동 300ms) → IDENTIFY 면 READY · RESUME 이면 RESUMED → 박동에 ACK · 줄 세운 사건 · 닫으라면 그 코드로.
async fn gateway_conn(f: Arc<FakeDc>, tcp: tokio::net::TcpStream, port: u16) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::protocol::CloseFrame;
    use tokio_tungstenite::tungstenite::Message;
    let Ok(mut ws) = tokio_tungstenite::accept_async(tcp).await else { return };
    f.connections.fetch_add(1, Ordering::SeqCst);
    let mut s = 0i64;
    let _ = ws.send(Message::text(json!({ "op": 10, "d": { "heartbeat_interval": 300 } }).to_string())).await;
    let mut ready = false;
    loop {
        let close = f.close_with.lock().unwrap().take();
        if let Some(code) = close {
            let _ = ws.send(Message::Close(Some(CloseFrame { code: CloseCode::from(code), reason: "".into() }))).await;
            // 닫힘 맞잡기 — 상대의 닫힘(또는 끊김)까지 기다린다(곧바로 끊으면 상대가 코드를 못 읽을 수 있다)
            while let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
                if matches!(m, Message::Close(_)) {
                    break;
                }
            }
            return;
        }
        if ready {
            let batch: Vec<(String, Value)> = std::mem::take(&mut *f.events.lock().unwrap());
            for (t, d) in batch {
                s += 1;
                let _ = ws.send(Message::text(json!({ "op": 0, "s": s, "t": t, "d": d }).to_string())).await;
            }
        }
        let next = tokio::time::timeout(Duration::from_millis(20), ws.next()).await;
        let msg = match next {
            Err(_) => continue,
            Ok(None) | Ok(Some(Err(_))) => return,
            Ok(Some(Ok(m))) => m,
        };
        let Message::Text(t) = msg else {
            if matches!(msg, Message::Close(_)) {
                return;
            }
            continue;
        };
        let v: Value = serde_json::from_str(t.as_str()).unwrap();
        match v["op"].as_u64() {
            Some(1) => {
                f.heartbeats.fetch_add(1, Ordering::SeqCst);
                let _ = ws.send(Message::text(json!({ "op": 11 }).to_string())).await;
            }
            // 토큰이 폐기됐다 — 진짜 Discord 처럼 IDENTIFY · RESUME 마다 4004
            Some(2 | 6) if f.revoked.load(Ordering::SeqCst) => *f.close_with.lock().unwrap() = Some(4004),
            Some(2) => {
                assert_eq!(v["d"]["intents"], json!(INTENTS_DM), "의도는 DIRECT_MESSAGES 하나");
                assert!(v["d"]["token"] == DC_TOKEN);
                f.identifies.fetch_add(1, Ordering::SeqCst);
                s += 1;
                let ready_d = json!({ "v": 10, "session_id": "sess-1", "resume_gateway_url": format!("ws://127.0.0.1:{port}"),
                    "user": { "id": BOT_ID.to_string(), "username": "aynx_dc_bot", "bot": true }, "guilds": [], "application": { "id": APP_ID.to_string() } });
                let _ = ws.send(Message::text(json!({ "op": 0, "s": s, "t": "READY", "d": ready_d }).to_string())).await;
                ready = true;
            }
            Some(6) => {
                assert_eq!(v["d"]["session_id"], "sess-1");
                assert!(v["d"]["seq"].is_i64(), "{v}");
                f.resumes.fetch_add(1, Ordering::SeqCst);
                s += 1;
                let _ = ws.send(Message::text(json!({ "op": 0, "s": s, "t": "RESUMED", "d": null }).to_string())).await;
                ready = true;
            }
            _ => {}
        }
    }
}

const INTENTS_DM: u64 = 1 << 12;

fn dc_cfg(api: &str, gw: &str, tg_base: &str, dir: &std::path::Path, env: Arc<FakeEnv>) -> Config {
    let mut discord = dc::Conf::at(api, gw);
    discord.identify_backoff = Duration::from_millis(100);
    discord.stable = Duration::from_millis(50);
    Config {
        telegram: tg::Conf { api: Api::at(tg_base), poll_timeout_secs: 1 },
        discord,
        slack: sl::Conf::release(),
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

fn dc(body: Value) -> Value {
    let mut b = if body.is_object() { body } else { json!({}) };
    b["channel"] = json!("discord");
    b
}

#[test]
fn live_bridge_with_fake_discord() {
    let _one = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (fake, api, gw, server) = start_fake_dc();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let dir = std::env::temp_dir().join(format!("aynx-bridge-dc-{}-{}", std::process::id(), now_ms()));
    let env = Arc::new(FakeEnv::default());
    rt.block_on(async { start(dc_cfg(&api, &gw, "http://127.0.0.1:9", &dir, env.clone())) });
    let op = |name: &str, body: Value| rt.block_on(handle(name, body));
    let st = op("messenger_bot_status", dc(Value::Null)).unwrap();
    assert_eq!((st["configured"].as_bool(), st["link"].as_str()), (Some(false), Some("off")));

    // 토큰 — 틀린 모양 · Discord 거절(401) · 등록(`users/@me`) · 파일 · 상태에 토큰 없음 · Telegram 은 그대로.
    assert!(op("messenger_bot_set_token", dc(json!({ "token": "nope" }))).unwrap_err().message.starts_with("[bad-token]"));
    let e = op("messenger_bot_set_token", dc(json!({ "token": DC_OTHER }))).unwrap_err();
    assert!(e.message.starts_with("[bad-token]") && !e.message.contains("GabcDE"), "{}", e.message);
    assert!(!dir.join("discord-bot").exists());
    let st = op("messenger_bot_set_token", dc(json!({ "token": DC_TOKEN }))).unwrap();
    assert_eq!((st["configured"].as_bool(), st["bot"].as_str(), st["paired"].as_bool()), (Some(true), Some("aynx_dc_bot"), Some(false)));
    assert!(!st.to_string().contains("GabcDE"), "상태에 토큰이 없다");
    assert_eq!(std::fs::read_to_string(dir.join("discord-bot")).unwrap(), DC_TOKEN);
    assert!(!dir.join("telegram-bot").exists());
    assert_eq!(op("messenger_bot_status", Value::Null).unwrap()["configured"], false, "Telegram 칸은 따로");
    assert!(configured(Channel::Discord) && !configured(Channel::Telegram));
    wait_for("게이트웨이 ok", || op("messenger_bot_status", dc(Value::Null)).unwrap()["link"] == "ok");
    assert_eq!(fake.identifies.load(Ordering::SeqCst), 1);
    wait_for("박동", || fake.heartbeats.load(Ordering::SeqCst) >= 1);

    // 짝짓기 — 서버(길드) 글은 버린다 · DM 의 낯선 사람 → 코드 답 · [허용].
    let mut guild = json!({ "id": flake(0).to_string(), "channel_id": "777", "guild_id": "9", "type": 0, "content": "hi",
        "author": { "id": "43", "username": "g" } });
    fake.dispatch("MESSAGE_CREATE", guild.take());
    fake.dm(42, "hello", 0, None);
    wait_for("코드 답", || fake.contents().iter().any(|t| t.contains("연결 코드") || t.contains("Pairing code")));
    let pending = op("messenger_bot_status", dc(Value::Null)).unwrap()["pending"].clone();
    let code = pending["code"].as_str().unwrap().to_string();
    assert_eq!(pending["name"], "Tester");
    assert!(fake.path_hit("/channels/777/").is_empty(), "서버 글에는 답하지 않는다");
    assert!(fake.posts().iter().all(|v| v["allowed_mentions"]["parse"] == json!([])), "멘션은 늘 막는다");
    let st = op("messenger_bot_pair", dc(json!({ "code": code, "allow": true }))).unwrap();
    assert_eq!((st["paired"].as_bool(), st["pairName"].as_str()), (Some(true), Some("Tester")));
    assert!(std::fs::read_to_string(dir.join("discord-chat")).unwrap().contains("\"chatId\":4200"));
    assert!(!dir.join("telegram-chat").exists());

    // 다리 꺼짐(Discord 칸) → 거절 답 · Telegram 칸이 켜져 있어도.
    env.chat_on.store(true, Ordering::SeqCst);
    let before = fake.contents().len();
    fake.dm(42, "do it", 0, None);
    wait_for("꺼짐 답", || fake.contents().len() > before);
    assert!(env.writes.lock().unwrap().is_empty());
    env.discord_on.store(true, Ordering::SeqCst);

    // 하나뿐 → 넣기 · "→ 이름표" 는 원 글에 답장.
    env.tiles.lock().unwrap().insert("local-s1".into(), (ready_tile("claude"), 11));
    let src = fake.dm(42, "fix the **bug**", 0, None);
    wait_for("넣기", || env.writes.lock().unwrap().len() == 2);
    assert_eq!(env.writes.lock().unwrap()[0], (11, b"\x1b[200~fix the **bug**\x1b[201~".to_vec()));
    wait_for("→ 답", || fake.posts().iter().any(|v| v["content"] == "→ claude · local-s1"));
    let arrow = fake.posts().into_iter().rfind(|v| v["content"] == "→ claude · local-s1").unwrap();
    assert_eq!(arrow["message_reference"], json!({ "message_id": src.to_string(), "fail_if_not_exists": false }));

    // 다리 턴의 끝 → 답 전문(2000자 안 · 기호는 걷는다 · 머리 줄만 굵게) · 그 답에 답장하면 그 타일로.
    let before = fake.posts().len();
    on_turn_event("local-s1", TurnEvent::Done, Some("claude"), Some("c1".into()));
    wait_for("답", || fake.posts().len() >= before + 3);
    let posts = fake.posts();
    let answer = posts[before]["content"].as_str().unwrap().to_string();
    assert!(answer.starts_with("**🟢 claude · local-s1**\nDONE \\<ok\\> & "), "{answer}");
    assert!(posts[before..].iter().all(|v| dc::units(v["content"].as_str().unwrap()) <= dc::CONTENT_MAX && v["flags"] == 4));
    assert_eq!(answer.matches("**").count(), 2, "굵게는 머리 줄 하나");
    let answer_id = posts[before]["_id"].as_i64().unwrap();
    fake.dm(42, "next", 0, Some(answer_id));
    wait_for("답장 넣기", || env.writes.lock().unwrap().len() == 4);

    // 여럿 → 고르기 단추(줄마다 하나) · 누르면 곧바로 콜백(지연 갱신) · 그 타일에 · 단추 통을 결과로(단추 걷음).
    on_turn_event("local-s1", TurnEvent::Gone, None, None);
    env.tiles.lock().unwrap().insert("local-s2".into(), (ready_tile("codex"), 22));
    fake.dm(42, "which", 0, None);
    wait_for("단추", || fake.buttons("").is_some());
    let (_, ids, mid) = fake.buttons("").unwrap();
    assert_eq!(ids.len(), 2);
    fake.press(900, 99, mid, &ids[1]);
    fake.press(901, 42, mid, &ids[1]);
    wait_for("고른 타일에 넣기", || env.writes.lock().unwrap().iter().any(|(id, _)| *id == 22));
    wait_for("단추 통 바꿈", || fake.patches().iter().any(|v| v["content"].as_str().is_some_and(|t| t.starts_with("→")) && v["components"] == json!([])));
    assert!(fake.path_hit("/interactions/901/itok-901/callback").iter().any(|v| v["type"] == 6), "누름은 곧바로 알린다");
    assert!(fake.path_hit("/webhooks/").is_empty(), "바꿔 쓰는 누름에는 후속 글이 없다");

    // 지난 글 → 넣지 않고 한 통.
    let writes = env.writes.lock().unwrap().len();
    on_turn_event("local-s2", TurnEvent::Gone, None, None);
    fake.dm(42, "old", STALE_SECS + 30, None);
    wait_for("지난 글 알림", || fake.contents().iter().any(|t| t.contains("1개") || t.contains("1 message")));
    assert_eq!(env.writes.lock().unwrap().len(), writes);

    // 알림 — 짝이 있으면 간다(429 한 번은 쉬고 다시) · 시험 한 통.
    fake.limit_once.store(true, Ordering::SeqCst);
    let before = fake.posts().len();
    rt.block_on(notify(Notice { text: "**작업안** — x".into(), stream: None, kind: None, label: None, channel: Some(Channel::Discord), has_tool: false })).unwrap();
    assert_eq!(fake.posts().len(), before + 1);
    assert!(fake.sent().iter().any(|(m, _, _)| m == "429"), "429 뒤 한 번 다시");
    op("messenger_bot_test", dc(Value::Null)).unwrap();

    // RESUME — 끊기면(4000) 이어 붙는다(IDENTIFY 를 다시 쓰지 않는다).
    *fake.close_with.lock().unwrap() = Some(4000);
    wait_for("RESUME", || fake.resumes.load(Ordering::SeqCst) == 1);
    wait_for("다시 ok", || op("messenger_bot_status", dc(Value::Null)).unwrap()["link"] == "ok");
    assert_eq!(fake.identifies.load(Ordering::SeqCst), 1, "RESUME 은 IDENTIFY 예산을 쓰지 않는다");
    let before = fake.contents().len();
    fake.dm(42, "after resume", 0, None);
    wait_for("이어 붙은 뒤 받기", || fake.contents().len() > before);

    // 짝 끊기 → 알림은 조용히 건너뛴다.
    assert_eq!(op("messenger_bot_unpair", dc(Value::Null)).unwrap()["paired"], false);
    assert!(!dir.join("discord-chat").exists());
    let before = fake.posts().len();
    rt.block_on(notify(Notice { text: "x".into(), stream: None, kind: None, label: None, channel: Some(Channel::Discord), has_tool: false })).unwrap();
    assert_eq!(fake.posts().len(), before, "짝이 없으면 보내지 않는다");
    assert!(op("messenger_bot_test", dc(Value::Null)).unwrap_err().message.starts_with("[not-paired]"));

    // 다시 붙지 말라는 닫힘 코드(4004) → 상태 error · 고리는 멈춘다(다시 붙지 않는다).
    fake.revoked.store(true, Ordering::SeqCst);
    *fake.close_with.lock().unwrap() = Some(4004);
    wait_for("error", || op("messenger_bot_status", dc(Value::Null)).unwrap()["link"] == "error");
    let conns = fake.connections.load(Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(fake.connections.load(Ordering::SeqCst), conns, "치명 코드 뒤에는 다시 붙지 않는다");

    // 토큰 해제 — 파일 둘 다 지우고 고리 멈춤.
    let st = op("messenger_bot_set_token", dc(json!({ "token": null }))).unwrap();
    assert_eq!((st["configured"].as_bool(), st["link"].as_str()), (Some(false), Some("off")));
    assert!(!dir.join("discord-bot").exists());
    // 받은 글 · 토큰은 REST 몸 밖 어디에도(로그 갈래는 부모 시험이 소스로 잰다)
    server.unblock();
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 3a 보고의 후속 — Telegram 과 Discord 가 **같은 스트림**을 함께 돌본다: 카드 → 두 채널에 단추 → 한쪽(Discord)에서 누름 → 결정 · 다른 쪽(Telegram)은
/// `gone` 으로 바꿔 쓴다 · 늦은 누름은 "이미" · 꺼진 채널의 누름은 바꿔 쓰지 않으니 후속 글(누른 사람에게만).
#[test]
fn live_cards_on_telegram_and_discord() {
    let _one = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (tgf, tg_base, tg_server) = start_fake();
    let (fake, api, gw, server) = start_fake_dc();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let dir = std::env::temp_dir().join(format!("aynx-bridge-both-{}-{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("telegram-bot"), TOKEN).unwrap();
    std::fs::write(dir.join(CHAT_FILE), r#"{"userId":42,"chatId":42,"name":"Tester"}"#).unwrap();
    std::fs::write(dir.join("discord-bot"), DC_TOKEN).unwrap();
    std::fs::write(dir.join(DISCORD_CHAT_FILE), r#"{"userId":42,"chatId":4200,"name":"Tester"}"#).unwrap();
    let env = Arc::new(FakeEnv::default());
    env.chat_on.store(true, Ordering::SeqCst);
    env.discord_on.store(true, Ordering::SeqCst);
    rt.block_on(async { start(dc_cfg(&api, &gw, &tg_base, &dir, env.clone())) });
    let op = |name: &str, body: Value| rt.block_on(handle(name, body));
    wait_for("둘 다 ok", || {
        op("messenger_bot_status", Value::Null).unwrap()["link"] == "ok" && op("messenger_bot_status", dc(Value::Null)).unwrap()["link"] == "ok"
    });

    let emit: crate::server::signal_http::Emit = Arc::new(|_| {});
    let plane = crate::server::signal_http::start(emit, None).expect("평면");
    let port = plane.port;
    let ask = |t: &Tile, body: Value| {
        let raw = perm_req(port, &t.stream, "ask", &t.token, &body);
        std::thread::spawn(move || http(port, &raw))
    };
    let a = open_tile("dc", 7);
    a.detach();
    let label = format!("claude · {}", a.stream);
    // 두 채널 모두 돌본다(각자의 다리 턴처럼)
    for chan in [Channel::Telegram, Channel::Discord] {
        let mut s = state();
        let c = s.chan(chan);
        c.turns.begin(&a.stream, now_ms());
        c.tending.tend(&a.stream);
    }
    let waiter = ask(&a, bash("claude", "Bash", "rm -rf build"));
    wait_for("Telegram 단추", || tgf.button_message(&label).is_some());
    wait_for("Discord 단추", || fake.buttons(&label).is_some());
    let (_, tg_allow, _) = tgf.button_message(&label).unwrap();
    let (text, ids, mid) = fake.buttons(&label).unwrap();
    assert!(text.starts_with("🟡") && text.contains("Bash · rm -rf build"), "{text}");
    assert!(ids[0].starts_with("pa:") && ids[1].starts_with("pd:"));
    // Discord 에서 [허용] → 훅 허용 · 그 통은 결과로(단추 걷음) · Telegram 통은 `gone` 으로 바꿔 쓴다
    fake.press(910, 42, mid, &ids[0]);
    let got = waiter.join().unwrap();
    assert!(got.contains(r#""behavior":"allow""#), "{got}");
    wait_for("Discord 바꿈", || {
        fake.patches().iter().any(|v| v["content"].as_str().is_some_and(|t| t.contains(&label) && t.ends_with(&logic::press_text(PressResult::Allowed))) && v["components"] == json!([]))
    });
    wait_for("Telegram 바꿈", || tgf.edits().iter().any(|t| t.contains(&label) && t.ends_with(&logic::gone_text("allowed"))));
    assert!(fake.path_hit("/interactions/910/").iter().any(|v| v["type"] == 6));
    // 늦은 Telegram 누름은 "이미"
    tgf.press("late", 42, &tg_allow);
    wait_for("이미", || tgf.callback_answer("late").is_some_and(|t| t == logic::press_text(PressResult::Already)));

    // 다음 카드 — Discord 칸을 끄고 누르면 바꿔 쓰지 않으니 누른 사람에게만 보이는 후속 글
    let waiter = ask(&a, bash("claude", "Bash", "cargo publish"));
    wait_for("Discord 둘째 단추", || fake.buttons("cargo publish").is_some());
    let (_, ids, mid) = fake.buttons("cargo publish").unwrap();
    env.discord_on.store(false, Ordering::SeqCst);
    let patches = fake.patches().len();
    fake.press(911, 42, mid, &ids[0]);
    wait_for("후속 글", || !fake.path_hit("/webhooks/").is_empty());
    let follow = fake.path_hit(&format!("/webhooks/{APP_ID}/itok-911")).pop().expect("앱 id · 그 누름의 토큰");
    assert_eq!(follow["flags"], 64);
    assert_eq!(follow["allowed_mentions"]["parse"], json!([]));
    assert_eq!(fake.patches().len(), patches, "꺼짐 — 단추는 그대로");
    assert_eq!(standing(&a.stream), 1);
    // Telegram 에서 거절 → Discord 통은 `gone` 으로
    let (_, _, tg_deny) = tgf.button_message("cargo publish").unwrap();
    tgf.press("tgd", 42, &tg_deny);
    assert!(waiter.join().unwrap().contains(r#""behavior":"deny""#));
    wait_for("Discord 가 gone 으로", || fake.patches().iter().any(|v| v["content"].as_str().is_some_and(|t| t.ends_with(&dc::escape(&logic::gone_text("denied"))))));

    on_turn_event(&a.stream, TurnEvent::Gone, None, None);
    assert!(!tends(&a.stream), "두 채널 모두 걷는다");
    a.close();
    op("messenger_bot_set_token", json!({ "token": null })).unwrap();
    op("messenger_bot_set_token", dc(json!({ "token": null }))).unwrap();
    server.unblock();
    tg_server.unblock();
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}
