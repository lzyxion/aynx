//! R1a-2 시험 — 페어링 · 기기 토큰 · 원격 가림막 세션 · 실패 제한 · 쿠키 단계 · POST 문지기 · 관문 쪽.

use std::time::{Duration, Instant};

use hyper::header::{HeaderMap, HeaderValue, COOKIE};
use hyper::Method;

use super::auth::*;
use super::funnel::whois_node_name;
use super::gate::*;
use super::gateway::{check_request, Allowed, Reject};
use super::static_files::inline_script_hashes;

const HOST: &str = "mypc.tailnet-abcd.ts.net";
const S: Duration = Duration::from_secs(1);

/// 페어링 한 바퀴 — (상태, 기기 id, 기기 토큰).
fn paired(st: &mut AuthState, now: Instant) -> (String, String) {
    let (ticket, notice) = st.pair_request(now, "Edge · Windows".into(), None, None).expect("요청");
    st.pair_respond(&notice.request_id, true, now).expect("허용");
    match st.pair_poll(ticket.poll.as_str(), now, "2026-10-15T00:00:00+09:00") {
        PairPoll::Allowed { token, device_id } => (device_id, token.as_str().to_string()),
        other => panic!("허용이어야: {other:?}"),
    }
}

fn cookies(pairs: &[(&str, &str)]) -> HeaderMap {
    let mut h = HeaderMap::new();
    let line = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ");
    h.insert(COOKIE, HeaderValue::from_str(&line).unwrap());
    h
}

fn auth_with(st: AuthState) -> Auth {
    let a = Auth::load(None);
    *a.lock() = st;
    a
}

// ── 페어링 ──────────────────────────────────────────────────────────────────

#[test]
fn pairing_flow_creates_a_device_with_only_a_hash() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    let (ticket, notice) = st
        .pair_request(t0, "Chrome · Android".into(), Some("me@example.com".into()), Some("Me\u{7}".into()))
        .unwrap();
    assert_eq!(notice.code, ticket.code);
    assert_eq!(notice.code.len(), 6);
    assert!(notice.code.bytes().all(|b| b.is_ascii_digit()));
    assert_eq!(notice.tailscale_login.as_deref(), Some("me@example.com"));
    assert_eq!(notice.tailscale_name.as_deref(), Some("Me"), "제어 문자는 걷는다");
    assert_eq!(notice.expires_in_ms, PAIR_TTL.as_millis() as u64);
    assert_eq!(st.pair_pending(t0), Some(notice.clone()));
    // 하나가 대기 중이면 다른 요청은 거절
    assert_eq!(st.pair_request(t0, "x".into(), None, None).unwrap_err(), PairError::Busy);
    // 사람이 답하기 전에는 대기
    assert!(matches!(st.pair_poll(ticket.poll.as_str(), t0, "s"), PairPoll::Pending));
    // 다른 폴 비밀은 아무것도 모른다
    let other = Secret::generate().unwrap();
    assert!(matches!(st.pair_poll(other.as_str(), t0, "s"), PairPoll::Gone));
    // 모르는 요청 id 에 답하면 거절
    assert!(st.pair_respond("nope", true, t0).is_err());
    st.pair_respond(&notice.request_id, true, t0).unwrap();
    assert_eq!(st.pair_pending(t0), None, "답한 요청은 더 기다리지 않는다");
    let PairPoll::Allowed { token, device_id } = st.pair_poll(ticket.poll.as_str(), t0 + S, "2026-10-15T00:00:00+09:00") else {
        panic!("허용");
    };
    assert!(secret_shape(token.as_str()));
    assert_eq!(st.device_for(token.as_str()), Some(device_id.clone()));
    // 한 번 받으면 끝
    assert!(matches!(st.pair_poll(ticket.poll.as_str(), t0 + S, "s"), PairPoll::Gone));
    // 파일에는 해시만 — 토큰 값은 어디에도 없다
    let file = st.snapshot();
    assert!(!file.contains(token.as_str()));
    assert!(file.contains("tokenSha256"));
    assert!(file.contains("me@example.com"));
    let list = st.list();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Chrome · Android");
    let shown = serde_json::to_string(&list).unwrap();
    assert!(!shown.contains("tokenSha256") && !shown.contains("Sha"), "프런트에는 해시가 없다: {shown}");
    // Debug 에 값이 없다
    assert_eq!(format!("{token:?}"), "Secret(***)");
    let parsed = parse_devices(&file);
    assert!(!format!("{parsed:?}").contains(&parsed[0].token_sha256));
}

#[test]
fn pairing_denied_expired_and_rate_limited() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    // 거절
    let (ticket, notice) = st.pair_request(t0, "a".into(), None, None).unwrap();
    st.pair_respond(&notice.request_id, false, t0).unwrap();
    assert!(matches!(st.pair_poll(ticket.poll.as_str(), t0, "s"), PairPoll::Denied));
    // 거절된 뒤에는 새 요청이 선다 · 만료되면 답도 폴도 안 된다
    let (ticket, notice) = st.pair_request(t0, "b".into(), None, None).unwrap();
    let late = t0 + PAIR_TTL + S;
    assert!(st.pair_respond(&notice.request_id, true, late).is_err());
    assert_eq!(st.pair_pending(late), None);
    assert!(matches!(st.pair_poll(ticket.poll.as_str(), late, "s"), PairPoll::Gone));
    // 허용됐어도 받기 전에 만료되면 기기는 생기지 않는다
    let (ticket, notice) = st.pair_request(late, "c".into(), None, None).unwrap();
    st.pair_respond(&notice.request_id, true, late).unwrap();
    assert_eq!(st.pair_request(late, "d".into(), None, None).unwrap_err(), PairError::Busy, "허용 뒤 받기 전도 대기 중");
    let later = late + PAIR_TTL + S;
    assert!(matches!(st.pair_poll(ticket.poll.as_str(), later, "s"), PairPoll::Gone));
    assert!(st.list().is_empty());
    // 분당 5번 — 이미 3번 했다
    let mut st = AuthState::new(Vec::new());
    for i in 0..5 {
        let (_, n) = st.pair_request(t0 + S * i, format!("{i}"), None, None).unwrap();
        st.pair_respond(&n.request_id, false, t0 + S * i).unwrap();
    }
    assert_eq!(st.pair_request(t0 + 10 * S, "x".into(), None, None).unwrap_err(), PairError::RateLimited);
    assert!(st.pair_request(t0 + 61 * S, "y".into(), None, None).is_ok(), "1분이 지나면 다시");
}

#[test]
fn device_cap() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    for i in 0..MAX_DEVICES {
        paired(&mut st, t0 + Duration::from_secs(13 * i as u64));
    }
    assert_eq!(st.pair_request(t0 + Duration::from_secs(10_000), "x".into(), None, None).unwrap_err(), PairError::Full);
}

// ── 기기 토큰 ───────────────────────────────────────────────────────────────

#[test]
fn device_tokens_are_checked_against_every_device() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    let (a, ta) = paired(&mut st, t0);
    let (b, tb) = paired(&mut st, t0 + 61 * S);
    assert_ne!(a, b);
    assert_eq!(st.device_for(&ta), Some(a.clone()));
    assert_eq!(st.device_for(&tb), Some(b.clone()));
    // 모양이 틀리거나 한 글자 다른 토큰
    let mut flipped = ta.clone().into_bytes();
    flipped[0] = if flipped[0] == b'A' { b'B' } else { b'A' };
    for bad in [String::from_utf8(flipped).unwrap(), String::new(), "x".repeat(43), format!("{ta}="), ta[..42].to_string()] {
        assert_eq!(st.device_for(&bad), None, "{bad}");
    }
    // 파일 왕복 — 해시만으로 다시 알아본다
    let back = AuthState::new(parse_devices(&st.snapshot()));
    assert_eq!(back.device_for(&tb), Some(b));
    // 폐기하면 그 토큰은 끝
    assert!(st.revoke(&a));
    assert!(!st.revoke(&a));
    assert_eq!(st.device_for(&ta), None);
}

#[test]
fn device_file_parsing_is_strict_and_closed_on_error() {
    assert!(parse_devices("not json").is_empty());
    assert!(parse_devices("{}").is_empty());
    let good = format!("{{\"id\":\"ab12\",\"name\":\"n\",\"tokenSha256\":\"{}\",\"created\":\"c\",\"lastSeen\":\"l\"}}", "a".repeat(64));
    let short = "{\"id\":\"cd\",\"name\":\"n\",\"tokenSha256\":\"abc\",\"created\":\"c\",\"lastSeen\":\"l\"}";
    let upper = format!("{{\"id\":\"ef\",\"name\":\"n\",\"tokenSha256\":\"{}\",\"created\":\"c\",\"lastSeen\":\"l\"}}", "A".repeat(64));
    let bad_id = format!("{{\"id\":\"a/b\",\"name\":\"n\",\"tokenSha256\":\"{}\",\"created\":\"c\",\"lastSeen\":\"l\"}}", "b".repeat(64));
    let text = format!("{{\"version\":1,\"devices\":[{good},{short},{upper},{bad_id}]}}");
    let devices = parse_devices(&text);
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, "ab12");
    assert!(!format!("{:?}", devices[0]).contains(&"a".repeat(64)), "Debug 에 해시 없음");
}

#[test]
fn user_agent_names() {
    let edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
    let android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
    let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    assert_eq!(device_name_from_ua(edge), "Edge · Windows");
    assert_eq!(device_name_from_ua(android), "Chrome · Android");
    assert_eq!(device_name_from_ua(iphone), "Safari · iPhone");
    assert_eq!(device_name_from_ua(""), "브라우저");
}

#[test]
fn pair_device_name_prefers_the_tailnet_node() {
    let android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
    assert_eq!(pair_device_name(Some("my-phone"), android), "my-phone · Chrome");
    // 브라우저를 모르면 기기 이름만 · 기기 이름이 없으면 오늘의 UA 이름 그대로
    assert_eq!(pair_device_name(Some("my-phone"), "curl/8.0"), "my-phone");
    assert_eq!(pair_device_name(None, android), device_name_from_ua(android));
    assert_eq!(pair_device_name(None, ""), "브라우저");
}

#[test]
fn forwarded_ip_must_be_one_whole_address() {
    assert_eq!(client_ip_from_forwarded(" 100.64.0.7 ").map(|ip| ip.to_string()).as_deref(), Some("100.64.0.7"));
    assert_eq!(client_ip_from_forwarded("fd7a:115c:a1e0::1").map(|ip| ip.to_string()).as_deref(), Some("fd7a:115c:a1e0::1"));
    for bad in ["", "100.64.0.7, 10.0.0.1", "100.64.0.7 10.0.0.1", "--socket=x", "peer", "100.64.0.7:443", "fe80::1%eth0"] {
        assert_eq!(client_ip_from_forwarded(bad), None, "{bad}");
    }
}

#[test]
fn whois_json_prefers_hostname_then_computed_name() {
    // 실측 모양 — 한글이 든 Hostname 이 그대로 온다
    let json = r#"{"Node":{"ComputedName":"my-phone","Hostinfo":{"Hostname":"내 폰 My Phone"}},"UserProfile":{}}"#;
    assert_eq!(whois_node_name(json).as_deref(), Some("내 폰 My Phone"));
    // Hostname 이 없거나 · 비었거나 · 글자가 아니면 ComputedName
    for fallback in [
        r#"{"Node":{"ComputedName":"my-phone"}}"#,
        r#"{"Node":{"ComputedName":"my-phone","Hostinfo":{}}}"#,
        r#"{"Node":{"ComputedName":"my-phone","Hostinfo":{"Hostname":"  "}}}"#,
        r#"{"Node":{"ComputedName":"my-phone","Hostinfo":{"Hostname":7}}}"#,
    ] {
        assert_eq!(whois_node_name(fallback).as_deref(), Some("my-phone"), "{fallback}");
    }
    assert_eq!(whois_node_name(r#"{"Node":{"Hostinfo":{"Hostname":"My Phone"}}}"#).as_deref(), Some("My Phone"));
    assert_eq!(whois_node_name(r#"{"Node":{"Hostinfo":{"Hostname":"a\u0007b"}}}"#).as_deref(), Some("ab"), "제어 문자는 걷는다");
    // 둘 다 없음 · 빈 값 · JSON 아님(`peer not found`)
    for bad in [r#"{"Node":{"ComputedName":"  "}}"#, r#"{"Node":{"ComputedName":7}}"#, r#"{"Node":{}}"#, "{}", "", "peer not found"] {
        assert_eq!(whois_node_name(bad), None, "{bad}");
    }
}

#[test]
fn pair_refusal_matches_pair_request_without_changing_state() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    assert_eq!(st.pair_refusal(t0), None);
    // 묻기만 해서는 빈도를 쓰지 않는다
    for _ in 0..(5 * 2) {
        assert_eq!(st.pair_refusal(t0), None);
    }
    // 대기 중
    let (_, n) = st.pair_request(t0, "a".into(), None, None).unwrap();
    assert_eq!(st.pair_refusal(t0), Some(PairError::Busy));
    assert_eq!(st.pair_pending(t0).as_ref().map(|p| p.request_id.as_str()), Some(n.request_id.as_str()), "대기 요청은 그대로");
    st.pair_respond(&n.request_id, false, t0).unwrap();
    assert_eq!(st.pair_refusal(t0), None, "거절된 요청은 자리를 막지 않는다");
    // 분당 5번 — 이미 1번 했다
    for i in 1..5 {
        let (_, n) = st.pair_request(t0 + S * i, format!("{i}"), None, None).unwrap();
        st.pair_respond(&n.request_id, false, t0 + S * i).unwrap();
    }
    assert_eq!(st.pair_refusal(t0 + 10 * S), Some(PairError::RateLimited));
    assert_eq!(st.pair_request(t0 + 10 * S, "x".into(), None, None).unwrap_err(), PairError::RateLimited);
    assert_eq!(st.pair_refusal(t0 + 61 * S), None, "1분이 지나면 다시");
    // 가득 참
    let mut st = AuthState::new(Vec::new());
    for i in 0..MAX_DEVICES {
        paired(&mut st, t0 + Duration::from_secs(13 * i as u64));
    }
    assert_eq!(st.pair_refusal(t0 + Duration::from_secs(10_000)), Some(PairError::Full));
}

#[test]
fn whois_runs_one_at_a_time() {
    let first = WhoisPermit::take().expect("빈 자리");
    assert!(WhoisPermit::take().is_none(), "도는 동안은 다음 것이 서지 않는다");
    drop(first);
    assert!(WhoisPermit::take().is_some(), "끝나면 다시");
}

// ── 세션 · 실패 제한 ─────────────────────────────────────────────────────────

#[test]
fn sessions_expire_on_idle_and_absolute_and_die_with_the_device() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    let (dev, _) = paired(&mut st, t0);
    let (other, _) = paired(&mut st, t0 + 61 * S);
    let idle = 10 * S;
    assert!(st.open_session("unknown", idle, t0).is_none(), "모르는 기기에는 세션이 없다");
    let ses = st.open_session(&dev, idle, t0).unwrap();
    assert_eq!(st.unlocked_devices(t0), 1);
    assert!(st.session_for(&dev, ses.as_str(), t0 + 9 * S));
    // 되감겼다 — 18초에도 산다
    assert!(st.session_for(&dev, ses.as_str(), t0 + 18 * S));
    // 다른 기기의 쿠키와 짝지으면 아니다
    assert!(!st.session_for(&other, ses.as_str(), t0 + 19 * S));
    // 무입력 만료
    assert!(!st.session_for(&dev, ses.as_str(), t0 + 29 * S));
    assert_eq!(st.unlocked_devices(t0 + 29 * S), 0);
    // 절대 상한 — 계속 되감아도 12시간이면 끝
    let long = st.open_session(&dev, SESSION_MAX * 2, t0).unwrap();
    assert!(st.session_for(&dev, long.as_str(), t0 + SESSION_MAX - S));
    assert!(!st.session_for(&dev, long.as_str(), t0 + SESSION_MAX + S));
    // 잠그기 · 폐기
    let a = st.open_session(&dev, idle, t0).unwrap();
    assert!(st.close_session(a.as_str()));
    assert!(!st.session_for(&dev, a.as_str(), t0));
    let b = st.open_session(&dev, idle, t0).unwrap();
    st.revoke(&dev);
    assert!(!st.session_for(&dev, b.as_str(), t0));
    assert_eq!(st.unlocked_devices(t0), 0);
    let c = st.open_session(&other, idle, t0).unwrap();
    assert_eq!(st.drop_sessions(), 1);
    assert!(!st.session_for(&other, c.as_str(), t0));
}

#[test]
fn unlock_brute_force_locks_out_per_device_and_globally() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    let (dev, _) = paired(&mut st, t0);
    for i in 0..4 {
        assert_eq!(st.unlock_failed(&dev, t0).0, None, "{i}");
        assert_eq!(st.unlock_blocked(&dev, t0), None);
    }
    assert_eq!(st.unlock_failed(&dev, t0).0, Some(60 * S));
    assert_eq!(st.unlock_blocked(&dev, t0 + S).map(Blocked::left), Some(59 * S));
    assert!(matches!(st.unlock_blocked(&dev, t0 + S), Some(Blocked::Device(_))));
    // 다음 잠김은 두 배
    let t1 = t0 + 61 * S;
    assert_eq!(st.unlock_blocked(&dev, t1), None);
    for _ in 0..4 {
        st.unlock_failed(&dev, t1);
    }
    assert_eq!(st.unlock_failed(&dev, t1).0, Some(120 * S));
    // 걷으면 기기 셈은 처음으로
    st.open_session(&dev, 60 * S, t1 + 200 * S).unwrap();
    assert_eq!(st.unlock_blocked(&dev, t1 + 200 * S), None);

    // 전역: 여러 기기를 돌려 막기를 피해도 20번이면 모두 막힌다
    let mut st = AuthState::new(Vec::new());
    let ids: Vec<String> = (0..5).map(|i| paired(&mut st, t0 + Duration::from_secs(61 * i)).0).collect();
    let t2 = t0 + 400 * S;
    let mut locked = None;
    for round in 0..4 {
        for id in &ids {
            let (l, total) = st.unlock_failed(id, t2);
            assert!(total >= 1);
            if round == 3 && id == ids.last().unwrap() {
                locked = l;
            }
        }
    }
    assert_eq!(locked, Some(60 * S));
    let fresh = paired(&mut st, t2 + 61 * S).0;
    assert!(matches!(st.unlock_blocked(&fresh, t2 + S), Some(Blocked::Global(_))));
}

// ── 쿠키 단계 ───────────────────────────────────────────────────────────────

#[test]
fn levels_from_cookies() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    let (dev, token) = paired(&mut st, t0);
    let ses = st.open_session(&dev, 60 * S, Instant::now()).unwrap().as_str().to_string();
    let auth = auth_with(st);
    let now = Instant::now();
    // 쿠키 없음 · 엉뚱한 토큰 · 세션만
    assert_eq!(level(&auth, &HeaderMap::new(), now), Level::Unpaired);
    assert_eq!(level(&auth, &cookies(&[(DEVICE_COOKIE, &"A".repeat(43))]), now), Level::Unpaired);
    assert_eq!(level(&auth, &cookies(&[(SESSION_COOKIE, &ses)]), now), Level::Unpaired);
    // 이름이 비슷한 다른 쿠키는 보지 않는다
    assert_eq!(level(&auth, &cookies(&[("pl_dev", &token)]), now), Level::Unpaired);
    // 페어링됨 · 열림
    assert_eq!(level(&auth, &cookies(&[(DEVICE_COOKIE, &token)]), now), Level::Paired(dev.clone()));
    assert_eq!(level(&auth, &cookies(&[("other", "1"), (DEVICE_COOKIE, &token), (SESSION_COOKIE, &ses)]), now), Level::Open(dev.clone()));
    assert_eq!(level(&auth, &cookies(&[(DEVICE_COOKIE, &token), (SESSION_COOKIE, &"B".repeat(43))]), now), Level::Paired(dev.clone()));
    // 폐기된 기기 → 미페어링(세션도 함께 죽는다)
    auth.lock().revoke(&dev);
    assert_eq!(level(&auth, &cookies(&[(DEVICE_COOKIE, &token), (SESSION_COOKIE, &ses)]), now), Level::Unpaired);
}

#[test]
fn cookie_attributes() {
    let t = "T".repeat(43);
    let d = device_cookie(&t);
    let s = session_cookie(&t);
    for c in [&d, &s] {
        for attr in ["; Path=/", "; Secure", "; HttpOnly", "; SameSite=Strict"] {
            assert!(c.contains(attr), "{c} 에 {attr} 없음");
        }
        assert!(!c.contains("Domain"), "__Host- 는 Domain 이 없어야");
    }
    assert!(d.starts_with("__Host-pl_dev="));
    assert!(s.starts_with("__Host-pl_ses=") && !s.contains("Max-Age"));
    assert!(clear_session_cookie().contains("Max-Age=0"));
}

// ── 문지기: POST ────────────────────────────────────────────────────────────

#[test]
fn post_only_on_gate_routes_with_a_same_origin() {
    let a = Allowed { host: Some(HOST.into()), port: 47822, loopback: true };
    let origin = format!("https://{HOST}");
    for route in POST_ROUTES {
        assert_eq!(check_request(&Method::POST, route, &[HOST], Some(&origin), &a), Ok(()), "{route}");
        // Origin 이 없으면 403(브라우저의 fetch POST 는 늘 싣는다)
        assert_eq!(check_request(&Method::POST, route, &[HOST], None, &a), Err(Reject::Origin), "{route}");
        assert_eq!(check_request(&Method::POST, route, &[HOST], Some("https://evil.example.com"), &a), Err(Reject::Origin));
        assert_eq!(check_request(&Method::POST, route, &[HOST], Some(&format!("http://{HOST}")), &a), Err(Reject::Origin));
        // 엉뚱한 이름이면 Host 가 먼저
        assert_eq!(check_request(&Method::POST, route, &["evil.example.com"], Some(&origin), &a), Err(Reject::Host));
        // 다른 메서드는 그 경로에도 안 된다
        assert_eq!(check_request(&Method::PUT, route, &[HOST], Some(&origin), &a), Err(Reject::Method));
    }
    // 개발 빌드 루프백 출처
    assert_eq!(
        check_request(&Method::POST, "/remote/unlock", &["127.0.0.1:47822"], Some("http://127.0.0.1:47822"), &a),
        Ok(())
    );
    // 다른 경로의 POST 는 405
    for path in ["/", "/index.html", "/remote/pair", "/remote/unlock/", "/remote/gate.js"] {
        assert_eq!(check_request(&Method::POST, path, &[HOST], Some(&origin), &a), Err(Reject::Method), "{path}");
    }
}

// ── 관문 쪽 ────────────────────────────────────────────────────────────────

#[test]
fn gate_pages_carry_no_app_and_no_inline_script() {
    for html in [pair_page(), unlock_page(true), unlock_page(false)] {
        assert!(inline_script_hashes(&html).is_empty(), "인라인 스크립트 없음: {html}");
        assert!(!html.contains("_app/") && !html.contains("__sveltekit"), "앱 번들을 싣지 않는다");
        assert!(html.contains("<script src=\"/remote/gate.js\" defer></script>"));
        assert!(!html.contains("style="), "인라인 style 없음(CSP style-src 'self')");
        assert!(html.contains("class=\"lock-card\"") && html.contains("id=\"msg\""), "가림막 카드 틀 · 알림 줄");
        let (base, theme) = (html.find("/remote/gate.css"), html.find("/remote/theme.css"));
        assert!(base.is_some() && theme > base, "메인 PC 색(theme.css)은 gate.css 뒤에 — 기본값을 이긴다");
    }
    assert!(pair_page().contains("id=\"pair\""));
    assert!(unlock_page(true).contains("type=\"password\""));
    assert!(!unlock_page(false).contains("type=\"password\""));
    // 앱 언어를 따른다 — 스레드 지역 값이라 다른 시험의 한국어 단언에 닿지 않는다.
    crate::i18n::set_lang(crate::i18n::Lang::En);
    for html in [pair_page(), unlock_page(true), unlock_page(false)] {
        assert!(html.contains("<html lang=\"en\""), "{html}");
        assert!(!html.chars().any(|c| ('가'..='힣').contains(&c)), "{html}");
    }
    crate::i18n::set_lang(crate::i18n::Lang::Ko);
    assert!(unlock_page(false).contains("마스터 암호가 없어"), "마스터 없음을 밝힌다");
    assert!(!GATE_CSP.contains("unsafe"));
    assert!(GATE_CSP.contains("frame-ancestors 'none'") && GATE_CSP.contains("script-src 'self'"));
    let r = page_response(pair_page());
    assert_eq!(r.headers()["content-security-policy"], GATE_CSP);
    assert_eq!(r.headers()["cache-control"], "no-store");
    assert!(gate_asset("/remote/gate.js").is_some() && gate_asset("/remote/gate.css").is_some());
    assert!(gate_asset("/remote/theme.css").is_some_and(|(_, mime)| mime.starts_with("text/css")));
    assert!(gate_asset("/remote/../gate.js").is_none() && gate_asset("/remote/x.js").is_none());
    assert!(is_shell("/") && is_shell("/index.html") && !is_shell("/_app/x.js"));
    // JSON 답의 쿠키는 Set-Cookie 로만
    let r = json_response(hyper::StatusCode::OK, serde_json::json!({ "ok": true }), &[session_cookie(&"T".repeat(43))]);
    assert_eq!(r.headers().get_all("set-cookie").iter().count(), 1);
}

// ── 재확인(R1a-4) ─────────────────────────────────────────────────────────────

#[test]
fn reauth_asks_for_the_master_only_when_one_exists() {
    use crate::server::vault_proxy::MasterVerdict;
    use serde_json::json;
    // 마스터 없음 · 볼트 없음 · 상태를 모름(hasMaster 칸 없음) — 암호 없이 통과(사용자 결정: 마스터는 선택).
    for status in [json!({"state":"unlocked","hasMaster":false}), json!({"state":"absent"}), json!({})] {
        assert_eq!(reauth_check(&status, None), ReauthCheck::Pass, "{status}");
        assert_eq!(reauth_check(&status, Some("x")), ReauthCheck::Pass);
    }
    // 마스터 있음 — 암호가 있어야 하고(빈 것·너무 긴 것은 없는 것), 있으면 그것으로 확인.
    let master = json!({"state":"unlocked","hasMaster":true});
    assert_eq!(reauth_check(&master, None), ReauthCheck::NeedPassword);
    assert_eq!(reauth_check(&master, Some("")), ReauthCheck::NeedPassword);
    let long = "a".repeat(1025);
    assert_eq!(reauth_check(&master, Some(&long)), ReauthCheck::NeedPassword);
    assert_eq!(reauth_check(&master, Some("pw")), ReauthCheck::Verify("pw"));
    // 확인의 답.
    assert_eq!(reauth_verdict(Ok(MasterVerdict::Ok)), ReauthVerdict::Issue);
    assert_eq!(reauth_verdict(Ok(MasterVerdict::NoMaster)), ReauthVerdict::Issue);
    assert_eq!(reauth_verdict(Ok(MasterVerdict::NoVault)), ReauthVerdict::Issue);
    assert_eq!(reauth_verdict(Ok(MasterVerdict::Bad(Some(60_000)))), ReauthVerdict::Wrong(Some(60_000)));
    assert_eq!(reauth_verdict(Ok(MasterVerdict::Limited(5))), ReauthVerdict::Limited(5));
    assert_eq!(reauth_verdict(Err("down".into())), ReauthVerdict::Server);
}

#[test]
fn reauth_failures_share_the_unlock_limits() {
    let t0 = Instant::now();
    let mut st = AuthState::new(Vec::new());
    let (device, _) = paired(&mut st, t0);
    // 틀린 재확인은 잠금 해제 실패와 같은 셈 — 다섯 번이면 막히고, 맞으면 기기 셈이 지워진다.
    for _ in 0..4 {
        st.unlock_failed(&device, t0);
    }
    assert!(st.unlock_blocked(&device, t0).is_none());
    st.unlock_succeeded(&device);
    for _ in 0..4 {
        st.unlock_failed(&device, t0);
    }
    assert!(st.unlock_blocked(&device, t0).is_none(), "성공이 셈을 지웠다");
    st.unlock_failed(&device, t0);
    assert!(st.unlock_blocked(&device, t0).is_some());
}
