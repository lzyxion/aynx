//! 원격 창(R1a-3) 시험 — 프레임·부팅 표·창 셈의 순수 시험과, **`tauri::test`(MockRuntime) 위의 다리 통합 시험**(설계 14.5).
//!
//! 통합 시험(`bridge_*`)은 불안정 API(`InvokeRequest`·`Webview::on_message`·`channel_interceptor`)가 tauri 판을 올려도 그대로인지 지키는
//! 문이다 — 스파이크(14.2)의 넷: ping invoke · 명령이 보는 창 라벨 = `remote-*` · `Channel<ArrayBuffer>` 300개 순서 · 이벤트(`emit_to`).
//! 깨지면 tauri 올리기를 멈추고 `bridge.rs` 부터 본다.

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::http::HeaderMap;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use super::auth::{remote_label, session_key, Auth, AuthState, Secret, REAUTH_TTL, TICKET_TTL};
use super::bridge::{self, Out, Outbox};
use super::frames::{self, ClientFrame, ListenTarget};
use super::static_files::{asset_request, inject_remote_boot, inline_script_hashes, query_param};
use super::windows::{is_remote_label, vault_lock_due, Presence, DISCONNECT_GRACE, UNLOCK_GRACE};
use super::ws::accept_key;

// ── 창 셈 ─────────────────────────────────────────────────────────────────────

#[test]
fn remote_labels_are_not_home_windows() {
    assert!(is_remote_label("remote-0123abcd-1"));
    assert!(is_remote_label(&remote_label("0123abcd", 7)));
    assert_eq!(remote_label("0123abcd", 7), "remote-0123abcd-7");
    for home in ["main", "tear-1", "aux-x", "remotely", "Remote-1", ""] {
        assert!(!is_remote_label(home), "{home}");
    }
}

#[test]
fn vault_locks_only_with_no_home_window_and_no_remote() {
    assert!(vault_lock_due(0, false));
    assert!(!vault_lock_due(0, true), "열린 원격이 있으면 집 PC 창 0개여도 잠그지 않는다(3.1)");
    assert!(!vault_lock_due(1, false));
    assert!(!vault_lock_due(2, true));
}

#[test]
fn presence_counts_live_windows_and_graces() {
    let t0 = Instant::now();
    let mut p = Presence::default();
    assert!(!p.present(t0));
    // 가림막을 걷었다 — 페이지가 붙기 전에도 있음(유예).
    assert_eq!(p.unlocked(t0), UNLOCK_GRACE);
    assert!(p.present(t0 + UNLOCK_GRACE - Duration::from_secs(1)));
    assert!(!p.present(t0 + UNLOCK_GRACE + Duration::from_secs(1)));
    // 창 둘 → 하나 닫힘: 아직 있음 · 다시 판정 없음.
    p.opened();
    p.opened();
    assert_eq!(p.closed(t0, false), None);
    assert!(p.present(t0 + Duration::from_secs(3600)));
    // 마지막이 끊김(세션은 살아 있음) — 끊김 유예 뒤 다시 판정.
    let t1 = t0 + Duration::from_secs(100);
    assert_eq!(p.closed(t1, false), Some(DISCONNECT_GRACE));
    assert!(p.present(t1 + DISCONNECT_GRACE - Duration::from_secs(1)));
    assert!(!p.present(t1 + DISCONNECT_GRACE + Duration::from_secs(1)));
    // 세션이 끝나 닫힘 — 유예 없음, 곧바로 판정.
    p.opened();
    let t2 = t1 + Duration::from_secs(100);
    assert_eq!(p.closed(t2, true), Some(Duration::ZERO));
    assert!(!p.present(t2));
    // 열린 세션이 하나도 없으면 걷은 직후의 유예도 걷힌다.
    p.unlocked(t2);
    p.sessions_gone();
    assert!(!p.present(t2));
}

// ── 부팅 표 ───────────────────────────────────────────────────────────────────

fn state_with_session(now: Instant) -> (AuthState, String, [u8; 32]) {
    let mut st = AuthState::new(Vec::new());
    let (ticket, _) = st.pair_request(now, "Edge".into(), None, None).expect("요청");
    let poll = ticket.poll.as_str().to_string();
    let notice = st.pair_pending(now).expect("대기");
    st.pair_respond(&notice.request_id, true, now).expect("허용");
    let super::auth::PairPoll::Allowed { device_id, .. } = st.pair_poll(&poll, now, "t") else {
        panic!("허용 아님");
    };
    let ses: Secret = st.open_session(&device_id, Duration::from_secs(900), now).expect("세션");
    let key = session_key(ses.as_str()).expect("열쇠");
    (st, device_id, key)
}

#[test]
fn boot_ticket_is_once_same_session_and_expires() {
    let t0 = Instant::now();
    let (mut st, dev, key) = state_with_session(t0);
    let (ticket, label, gen) = st.issue_ticket(&dev, &key, t0).expect("표");
    assert_eq!(label, remote_label(&dev, gen));
    // 다른 세션 · 다른 기기 · 엉터리 → 없음(그리고 표는 소비된다 — 한 번).
    assert_eq!(st.take_ticket(ticket.as_str(), &dev, &[7u8; 32], t0), None);
    assert_eq!(st.take_ticket(ticket.as_str(), &dev, &key, t0), None, "한 번 틀리면 그 표는 끝");
    let (ticket, label2, gen2) = st.issue_ticket(&dev, &key, t0).expect("표");
    assert!(gen2 > gen, "세대는 줄지 않는다");
    assert_eq!(st.take_ticket(ticket.as_str(), "other", &key, t0), None);
    let (ticket, label3, _) = st.issue_ticket(&dev, &key, t0).expect("표");
    assert_eq!(st.take_ticket("short", &dev, &key, t0), None);
    assert_eq!(st.take_ticket(ticket.as_str(), &dev, &key, t0), Some((label3.clone(), gen2 + 1)));
    assert_eq!(st.take_ticket(ticket.as_str(), &dev, &key, t0), None, "두 번은 안 된다");
    assert_ne!(label2, label3);
    // 시한.
    let (ticket, _, _) = st.issue_ticket(&dev, &key, t0).expect("표");
    assert_eq!(st.take_ticket(ticket.as_str(), &dev, &key, t0 + TICKET_TTL + Duration::from_secs(1)), None);
    // 세션이 닫히면 표도 통하지 않는다.
    let (ticket, _, _) = st.issue_ticket(&dev, &key, t0).expect("표");
    st.drop_sessions();
    assert_eq!(st.take_ticket(ticket.as_str(), &dev, &key, t0), None);
    assert!(st.issue_ticket(&dev, &key, t0).is_none(), "죽은 세션엔 표를 뽑지 않는다");
}

#[test]
fn session_alive_does_not_touch_but_touch_does() {
    let t0 = Instant::now();
    let (mut st, _dev, key) = state_with_session(t0);
    let idle = Duration::from_secs(900);
    assert!(st.session_alive(&key, t0 + idle - Duration::from_secs(1)));
    // alive 는 시계를 되감지 않는다 — 시한을 넘기면 죽는다.
    assert!(!st.session_alive(&key, t0 + idle + Duration::from_secs(1)));
    let (mut st, _dev, key) = state_with_session(t0);
    assert!(st.touch_session(&key, t0 + idle - Duration::from_secs(1)));
    assert!(st.session_alive(&key, t0 + idle + Duration::from_secs(60)), "입력이 되감았다");
    assert!(!st.touch_session(&[0u8; 32], t0));
}

// ── 관문 조각 ─────────────────────────────────────────────────────────────────

#[test]
fn ws_accept_key_matches_rfc6455() {
    assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ==").as_deref(), Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
    assert_eq!(accept_key("not base64!"), None);
    assert_eq!(accept_key("AAAA"), None, "16바이트가 아니다");
}

#[test]
fn shell_gets_meta_and_polyfill_first_without_new_inline_script() {
    let html = "<!doctype html><html><HEAD lang=x><meta charset=utf-8><script>boot()</script></head><body></body></html>";
    let out = inject_remote_boot(html, r#"{"label":"remote-a-1","ticket":"x<\"&'>"}"#).expect("head");
    let head_at = out.find("<HEAD lang=x>").expect("head") + "<HEAD lang=x>".len();
    assert!(out[head_at..].starts_with("<meta name=\"aynx-remote\" content=\""));
    let meta_end = out[head_at..].find('>').unwrap() + head_at;
    assert!(out[head_at..meta_end].contains("&quot;label&quot;"));
    assert!(!out[head_at..meta_end].contains('<') || out[head_at..meta_end].starts_with("<meta"));
    assert!(out[meta_end + 1..].starts_with("<script src=\"/remote/polyfill.js\"></script><meta charset"));
    // 끼운 것은 인라인 스크립트가 아니다 — CSP 해시는 원래 부트스트랩 하나 그대로.
    assert_eq!(inline_script_hashes(&out), inline_script_hashes(html));
    assert_eq!(inject_remote_boot("<html><body></body></html>", "{}"), None);
    assert!(inject_remote_boot("<header></header><head></head>", "{}").unwrap().starts_with("<header></header><head><meta"));
}

#[test]
fn query_and_asset_paths() {
    assert_eq!(query_param(Some("path=C%3A%5Cx%5Cwp-1.png&z=1"), "path").as_deref(), Some("C:\\x\\wp-1.png"));
    assert_eq!(query_param(Some("t=a&t=b"), "t"), None, "둘이면 없음");
    assert_eq!(query_param(Some("x=1"), "t"), None);
    assert_eq!(query_param(None, "t"), None);
    #[cfg(windows)]
    let ok = r"C:\Users\u\AppData\Roaming\aynx-dev\wp-0123.PNG";
    #[cfg(not(windows))]
    let ok = "/home/u/.config/aynx-dev/wp-0123.PNG";
    assert_eq!(asset_request(ok).map(|(_, m)| m), Some("image/png"));
    #[cfg(windows)]
    let bad = [r"relative\wp.png", r"C:\a\..\b\wp.png", r"C:\a\x.svg", r"C:\a\settings.toml", ""];
    #[cfg(not(windows))]
    let bad = ["relative/wp.png", "/a/../b/wp.png", "/a/x.svg", "/a/settings.toml", ""];
    for b in bad {
        assert!(asset_request(b).is_none(), "{b}");
    }
}

// ── 프레임 ────────────────────────────────────────────────────────────────────

#[test]
fn client_frames_parse() {
    let f: ClientFrame = serde_json::from_str(r#"{"t":"invoke","id":3,"cmd":"x","args":{"a":1},"headers":{"x-a":"b"}}"#).unwrap();
    assert!(matches!(f, ClientFrame::Invoke { id: 3, ref cmd, .. } if cmd == "x"));
    let f: ClientFrame = serde_json::from_str(r#"{"t":"listen","id":4,"event":"e","target":{"kind":"Any"},"handler":9}"#).unwrap();
    assert!(matches!(f, ClientFrame::Listen { id: 4, handler: 9, .. }));
    let f: ClientFrame = serde_json::from_str(r#"{"t":"unlisten","id":5,"event":"e","eventId":11}"#).unwrap();
    assert_eq!(f, ClientFrame::Unlisten { id: 5, event: "e".into(), event_id: 11 });
    assert_eq!(serde_json::from_str::<ClientFrame>(r#"{"t":"active"}"#).unwrap(), ClientFrame::Active);
    assert!(serde_json::from_str::<ClientFrame>(r#"{"t":"nope"}"#).is_err());

    let head = br#"{"cmd":"raw_cmd","headers":{"x-k":"v"}}"#;
    let mut b = vec![frames::KIND_RAW_INVOKE];
    b.extend_from_slice(&9u32.to_le_bytes());
    b.extend_from_slice(&(head.len() as u32).to_le_bytes());
    b.extend_from_slice(head);
    b.extend_from_slice(&[1, 2, 3]);
    let raw = frames::parse_raw_invoke(&b).expect("raw");
    assert_eq!((raw.id, raw.cmd.as_str(), raw.body.as_slice()), (9, "raw_cmd", &[1u8, 2, 3][..]));
    assert!(frames::parse_raw_invoke(&b[..10]).is_none());
    assert!(frames::parse_raw_invoke(&[1, 0, 0]).is_none());
}

#[test]
fn server_frames_shape() {
    assert_eq!(frames::res_ok_json(7, "{\"a\":1}"), r#"{"t":"res","id":7,"ok":true,"b":{"a":1}}"#);
    assert_eq!(frames::res_ok_json(7, ""), r#"{"t":"res","id":7,"ok":true,"b":null}"#);
    let v: Value = serde_json::from_str(&frames::res_err(8, &json!("bad"))).unwrap();
    assert_eq!(v, json!({"t":"res","id":8,"ok":false,"b":"bad"}));
    let v: Value = serde_json::from_str(&frames::event(5, "a:b", 12, "{\"x\":true}")).unwrap();
    assert_eq!(v, json!({"t":"event","h":5,"e":"a:b","i":12,"p":{"x":true}}));
    let c = frames::channel(3, 4242, 7, &InvokeResponseBody::Raw(vec![9, 9]));
    assert_eq!(c, [&[1u8][..], &3u32.to_le_bytes(), &4242u32.to_le_bytes(), &7u32.to_le_bytes(), &[1u8], &[9, 9]].concat());
    let c = frames::channel(3, 1, 0, &InvokeResponseBody::Json("[1]".into()));
    assert_eq!(c[13], 0);
    assert_eq!(&c[14..], b"[1]");
    assert_eq!(frames::res_raw(2, &[5]), vec![2, 2, 0, 0, 0, 5]);
    assert!(frames::valid_event_name("remote-sessions"));
    assert!(frames::valid_event_name("tauri://resize"));
    assert!(!frames::valid_event_name("a b"));
    assert!(!frames::valid_event_name(""));
    assert_eq!(frames::listen_target(&json!({"kind":"Any"}), "remote-a-1"), ListenTarget::Any);
    assert_eq!(frames::listen_target(&Value::Null, "remote-a-1"), ListenTarget::Any);
    assert_eq!(frames::listen_target(&json!({"kind":"Window","label":"remote-a-1"}), "remote-a-1"), ListenTarget::Own);
    assert_eq!(frames::listen_target(&json!({"kind":"AnyLabel","label":"main"}), "remote-a-1"), ListenTarget::Other);
}

#[test]
fn a_dropped_reply_answers_with_an_error() {
    let (out, mut rx) = Outbox::new();
    drop(bridge::Reply::for_test(41, &out));
    let Some(Out::Text(t)) = rx.try_recv().ok() else {
        panic!("오류 응답이 없다");
    };
    let v: Value = serde_json::from_str(&t).unwrap();
    assert_eq!((v["id"].as_u64(), v["ok"].as_bool()), (Some(41), Some(false)));
}

// ── 다리 통합 시험(MockRuntime) ───────────────────────────────────────────────

#[tauri::command]
async fn rt_ping(msg: String) -> String {
    format!("pong:{msg}")
}

#[tauri::command]
fn rt_whoami<R: Runtime>(window: tauri::Window<R>, webview: tauri::Webview<R>) -> (String, String) {
    (window.label().to_string(), webview.label().to_string())
}

#[tauri::command]
fn rt_chan(on: Channel<InvokeResponseBody>, n: u32) {
    for i in 0..n {
        // 크기를 섞는다(eval 문턱 1KiB/8KiB 위아래 — 가로채기는 문턱 앞이다).
        let len = [16usize, 2048, 70_000][(i % 3) as usize];
        let mut body = i.to_le_bytes().to_vec();
        body.resize(len, (i % 251) as u8);
        on.send(InvokeResponseBody::Raw(body)).expect("send");
    }
}

fn mock_app() -> tauri::App<MockRuntime> {
    mock_builder()
        .channel_interceptor(bridge::channel_interceptor)
        .invoke_handler(tauri::generate_handler![rt_ping, rt_whoami, rt_chan])
        .build(mock_context(noop_assets()))
        .expect("mock app")
}

/// 받은 것을 시한 안에 하나.
fn next(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Out>) -> Out {
    tauri::async_runtime::block_on(async { tokio::time::timeout(Duration::from_secs(10), rx.recv()).await })
        .expect("시한")
        .expect("닫힘")
}

fn text(o: Out) -> Value {
    match o {
        Out::Text(t) => serde_json::from_str(&t).expect("json"),
        Out::Binary(_) => panic!("텍스트가 아니다"),
        Out::Close(r) => panic!("닫힘 {r}"),
    }
}

#[test]
fn bridge_invoke_channel_and_events_through_a_hidden_window() {
    let app = mock_app();
    let label = "remote-feedc0de-1";
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::External("about:blank".parse().unwrap()))
        .visible(false)
        .build()
        .expect("숨은 창");
    let (out, mut rx) = Outbox::new();
    bridge::register(label, 1, out.clone());
    let handle = app.handle().clone();

    // 1) ping — async 명령.
    bridge::invoke_ungated(&handle, &window, 1, "rt_ping".into(), InvokeBody::Json(json!({"msg":"hi"})), HeaderMap::new(), &out);
    assert_eq!(text(next(&mut rx)), json!({"t":"res","id":1,"ok":true,"b":"pong:hi"}));

    // 2) 명령이 보는 창·웹뷰 라벨 = 원격 창(동기 명령 — 블로킹 풀에서 돈다).
    bridge::invoke_ungated(&handle, &window, 2, "rt_whoami".into(), InvokeBody::Json(json!({})), HeaderMap::new(), &out);
    assert_eq!(text(next(&mut rx))["b"], json!([label, label]));

    // 없는 명령 → 오류 응답(매달리지 않는다).
    bridge::invoke_ungated(&handle, &window, 3, "nope".into(), InvokeBody::Json(json!({})), HeaderMap::new(), &out);
    assert_eq!(text(next(&mut rx))["ok"], json!(false));

    // 3) Channel<ArrayBuffer> 300개 — 모두 가로채기로, 콜백 id·세대 그대로, 순번 = 차례, 원시 그대로.
    bridge::invoke_ungated(
        &handle,
        &window,
        4,
        "rt_chan".into(),
        InvokeBody::Json(json!({"on": "__CHANNEL__:4242", "n": 300})),
        HeaderMap::new(),
        &out,
    );
    let mut seen = 0u32;
    loop {
        match next(&mut rx) {
            Out::Binary(b) => {
                assert_eq!(b[0], frames::KIND_CHANNEL);
                assert_eq!(u32::from_le_bytes(b[1..5].try_into().unwrap()), 1, "세대");
                assert_eq!(u32::from_le_bytes(b[5..9].try_into().unwrap()), 4242, "콜백 id");
                assert_eq!(u32::from_le_bytes(b[9..13].try_into().unwrap()), seen, "순번");
                assert_eq!(b[13], 1, "원시");
                assert_eq!(u32::from_le_bytes(b[14..18].try_into().unwrap()), seen, "본문");
                assert_eq!(b.len() - 14, [16usize, 2048, 70_000][(seen % 3) as usize]);
                seen += 1;
            }
            Out::Text(t) => {
                let v: Value = serde_json::from_str(&t).unwrap();
                assert_eq!((v["id"].as_u64(), v["ok"].as_bool()), (Some(4), Some(true)));
                break;
            }
            Out::Close(r) => panic!("닫힘 {r}"),
        }
    }
    assert_eq!(seen, 300);

    // 4) 이벤트 — 대상 Any 는 emit_to("main") 도 받는다(데스크톱 JS 와 같음) · 자기 라벨 대상은 자기 것만.
    let any = bridge::listen(&handle, &window, "rt-ev", &json!({"kind":"Any"}), 77).expect("listen");
    let own = bridge::listen(&handle, &window, "rt-own", &json!({"kind":"WebviewWindow","label":label}), 78).expect("listen");
    assert!(bridge::listen(&handle, &window, "rt-ev", &json!({"kind":"Window","label":"main"}), 79).is_err());
    assert!(bridge::listen(&handle, &window, "bad name", &json!({"kind":"Any"}), 80).is_err());
    handle.emit_to("main", "rt-ev", json!({"n": 1})).unwrap();
    assert_eq!(text(next(&mut rx)), json!({"t":"event","h":77,"e":"rt-ev","i":any,"p":{"n":1}}));
    handle.emit_to("main", "rt-own", 5).unwrap();
    handle.emit_to(label, "rt-own", 6).unwrap();
    assert_eq!(text(next(&mut rx)), json!({"t":"event","h":78,"e":"rt-own","i":own,"p":6}));
    // 걷은 뒤에는 오지 않는다.
    bridge::unlisten(&handle, label, any);
    handle.emit("rt-ev", 2).unwrap();
    assert!(rx.try_recv().is_err());

    // 5) 끝 — 표에서 빠지고 리스너를 걷고 창을 부순다. 그 뒤의 Channel 은 버린다(숨은 웹뷰로 eval 하지 않는다).
    bridge::unregister(&handle, &window, label);
    handle.emit_to(label, "rt-own", 7).unwrap();
    assert!(rx.try_recv().is_err(), "리스너가 걷혔다");
    let webview = window.as_ref().clone();
    assert!(bridge::channel_interceptor(&webview, tauri::ipc::CallbackFn(1), 0, &InvokeResponseBody::Raw(vec![1])));
    assert!(rx.try_recv().is_err());
    let _ = app.get_webview_window(label);
}

#[test]
fn bridge_leaves_home_windows_alone() {
    let app = mock_app();
    let main = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().expect("main");
    let webview = main.as_ref().clone();
    assert!(!bridge::channel_interceptor(&webview, tauri::ipc::CallbackFn(1), 0, &InvokeResponseBody::Raw(vec![1])));
    assert_eq!(super::windows::home_windows(&app).len(), 1);
    let _hidden = WebviewWindowBuilder::new(&app, "remote-abcd-9", WebviewUrl::External("about:blank".parse().unwrap()))
        .build()
        .expect("숨은 창");
    assert_eq!(app.webview_windows().len(), 2);
    let homes = super::windows::home_windows(&app);
    assert_eq!(homes.keys().collect::<Vec<_>>(), vec!["main"]);
    assert!(!super::windows::has_home_window_except(&app, "main"));
    assert!(super::windows::has_home_window_except(&app, "remote-abcd-9"));
}

// ── 원격 권한 B · 재확인(R1a-4) ───────────────────────────────────────────────

#[test]
fn reauth_ticket_is_once_same_session_same_command_and_expires() {
    let t0 = Instant::now();
    let (mut st, _dev, key) = state_with_session(t0);
    let cmd = "approve_operation";
    let t = st.issue_reauth(&key, cmd, t0).expect("표");
    assert!(st.take_reauth(t.as_str(), &key, cmd, t0));
    assert!(!st.take_reauth(t.as_str(), &key, cmd, t0), "한 번만");
    // 다른 명령 · 다른 세션 — 그리고 틀리면 그 표는 끝.
    let t = st.issue_reauth(&key, cmd, t0).expect("표");
    assert!(!st.take_reauth(t.as_str(), &key, "db_ai_set", t0));
    assert!(!st.take_reauth(t.as_str(), &key, cmd, t0), "틀린 뒤엔 끝");
    let t = st.issue_reauth(&key, cmd, t0).expect("표");
    assert!(!st.take_reauth(t.as_str(), &[9u8; 32], cmd, t0));
    assert!(!st.take_reauth("short", &key, cmd, t0));
    // 시한.
    let t = st.issue_reauth(&key, cmd, t0).expect("표");
    assert!(!st.take_reauth(t.as_str(), &key, cmd, t0 + REAUTH_TTL + Duration::from_secs(1)));
    // 세션이 닫히면 표도 통하지 않고, 죽은 세션엔 뽑지 않는다.
    let t = st.issue_reauth(&key, cmd, t0).expect("표");
    st.drop_sessions();
    assert!(!st.take_reauth(t.as_str(), &key, cmd, t0));
    assert!(st.issue_reauth(&key, cmd, t0).is_none());
}

fn admits(auth: &Auth, key: &[u8; 32], cmd: &str, reauth: Option<&str>) -> bool {
    bridge::admit(cmd, &bridge::Caller { auth, session: key, reauth }).is_ok()
}

#[test]
fn admit_follows_the_tables_and_consumes_reauth() {
    let t0 = Instant::now();
    let (st, dev, key) = state_with_session(t0);
    let auth = Auth::for_test(st);
    assert!(admits(&auth, &key, "list_shells", None));
    assert!(admits(&auth, &key, "remote_device_revoke", None));
    // 플러그인은 ACL 몫 — 여기서는 지나간다.
    assert!(admits(&auth, &key, "plugin:dialog|open", None));
    for denied in ["vault_set_master", "vault_delete_all", "remote_pair_respond", "open_tear_window", "nope_cmd"] {
        assert!(!admits(&auth, &key, denied, None), "{denied}");
    }
    // 재확인 — 표 없이는 거절, 표가 있으면 한 번 통과.
    assert!(!admits(&auth, &key, "approve_operation", None));
    let t = auth.lock().issue_reauth(&key, "approve_operation", Instant::now()).expect("표");
    assert!(!admits(&auth, &key, "delegation_set_target", Some(t.as_str())), "다른 명령의 표");
    let t = auth.lock().issue_reauth(&key, "approve_operation", Instant::now()).expect("표");
    assert!(admits(&auth, &key, "approve_operation", Some(t.as_str())));
    assert!(!admits(&auth, &key, "approve_operation", Some(t.as_str())), "두 번은 안 된다");
    // 통과한 재확인은 기록에 기기와 일의 이름만 남는다(R4 — 표·인자 없음). 기록은 프로세스 전역이라 이 기기 id 로 찾는다.
    let line = super::activity::snapshot()
        .into_iter()
        .find(|e| e.kind == "reauthorized" && e.device_id == dev)
        .expect("재확인 기록 줄");
    assert_eq!(line.what, super::deny::command_label("approve_operation"));
    assert!(!line.what.contains(t.as_str()));
}

#[test]
fn reauth_rides_on_the_invoke_frame() {
    let f: ClientFrame =
        serde_json::from_str(r#"{"t":"invoke","id":3,"cmd":"approve_operation","args":{},"reauth":"abc"}"#).unwrap();
    assert!(matches!(f, ClientFrame::Invoke { ref reauth, .. } if reauth.as_deref() == Some("abc")));
    let f: ClientFrame = serde_json::from_str(r#"{"t":"invoke","id":3,"cmd":"x"}"#).unwrap();
    assert!(matches!(f, ClientFrame::Invoke { reauth: None, .. }));
}

#[test]
fn bridge_refuses_home_only_without_reaching_tauri() {
    let app = mock_app();
    let label = "remote-feedc0de-7";
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::External("about:blank".parse().unwrap()))
        .visible(false)
        .build()
        .expect("숨은 창");
    let (out, mut rx) = Outbox::new();
    let handle = app.handle().clone();
    let t0 = Instant::now();
    let (st, _dev, key) = state_with_session(t0);
    let auth = Auth::for_test(st);
    let caller = bridge::Caller {
        auth: &auth,
        session: &key,
        reauth: None,
    };
    for (id, cmd) in [(1, "vault_delete_all"), (2, "approve_operation"), (3, "rt_ping")] {
        bridge::invoke(&handle, &window, id, cmd.into(), InvokeBody::Json(json!({"msg":"x"})), HeaderMap::new(), &out, &caller);
        let v = text(next(&mut rx));
        assert_eq!((v["id"].as_u64(), v["ok"].as_bool()), (Some(u64::from(id)), Some(false)), "{cmd}");
        assert!(v["b"].as_str().is_some_and(|s| !s.is_empty()));
    }
}

/// 이벤트 문(R1a-5) — `plugin:event|emit*` 는 이름으로 거른다(기본 거절). 다른 명령·플러그인은 그대로.
#[test]
fn bridge_event_gate_by_name() {
    use super::bridge::admit_event;
    let body = |event: &str| tauri::ipc::InvokeBody::Json(serde_json::json!({ "event": event, "payload": {} }));
    assert!(admit_event("plugin:event|emit", &body("settings-saved")).is_ok());
    assert!(admit_event("plugin:event|emit_to", &body("host-renamed")).is_ok());
    for bad in ["tray-quit", "workspace-request", "remote-pair-request", "session-server-connected", ""] {
        assert!(admit_event("plugin:event|emit", &body(bad)).is_err(), "{bad}");
        assert!(admit_event("plugin:event|emit_to", &body(bad)).is_err(), "{bad}");
    }
    assert!(admit_event("plugin:event|emit", &tauri::ipc::InvokeBody::Json(serde_json::json!({}))).is_err());
    assert!(admit_event("plugin:event|emit", &tauri::ipc::InvokeBody::Raw(vec![1, 2])).is_err());
    // 다른 길은 이 문의 몫이 아니다.
    assert!(admit_event("plugin:event|listen", &body("tray-quit")).is_ok());
    assert!(admit_event("list_shells", &body("tray-quit")).is_ok());
}
