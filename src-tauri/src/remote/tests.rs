use super::funnel::{port_is_funneled, self_dns_name, targets_port};
use super::gateway::{asset_response, check_request, Allowed, Reject};
use super::static_files::{gateway_csp, inline_script_hashes, safe_asset_path};
use super::*;

use hyper::Method;
use tauri::utils::config::Csp;

const HOST: &str = "mypc.tailnet-abcd.ts.net";

fn allowed(loopback: bool) -> Allowed {
    Allowed {
        host: Some(HOST.to_string()),
        port: 47822,
        loopback,
    }
}

// ── 문지기: Host · Origin · 메서드 ─────────────────────────────────────────────

#[test]
fn host_must_be_the_configured_ts_net_name() {
    let a = allowed(false);
    assert_eq!(check_request(&Method::GET, "/", &[HOST], None, &a), Ok(()));
    assert_eq!(check_request(&Method::GET, "/", &["MyPC.Tailnet-ABCD.ts.net"], None, &a), Ok(()));
    // `tailscale serve --https=<포트>` 면 Host 에 포트가 붙는다.
    assert_eq!(check_request(&Method::GET, "/", &["mypc.tailnet-abcd.ts.net:47821"], None, &a), Ok(()));
    for bad in [
        "evil.example.com",
        "mypc.tailnet-abcd.ts.net.evil.com",
        "xmypc.tailnet-abcd.ts.net",
        "mypc.tailnet-abcd.ts.net:",
        "mypc.tailnet-abcd.ts.net:99999",
        "mypc.tailnet-abcd.ts.net:80x",
        "127.0.0.1:47822",
        "localhost:47822",
        "",
    ] {
        assert_eq!(check_request(&Method::GET, "/", &[bad], None, &a), Err(Reject::Host), "{bad}");
    }
    // 없음 · 둘
    assert_eq!(check_request(&Method::GET, "/", &[], None, &a), Err(Reject::Host));
    assert_eq!(check_request(&Method::GET, "/", &[HOST, HOST], None, &a), Err(Reject::Host));
}

#[test]
fn loopback_host_only_in_dev_and_only_on_our_port() {
    let dev = allowed(true);
    assert_eq!(check_request(&Method::GET, "/", &["127.0.0.1:47822"], None, &dev), Ok(()));
    assert_eq!(check_request(&Method::GET, "/", &["localhost:47822"], None, &dev), Ok(()));
    for bad in ["127.0.0.1", "127.0.0.1:47821", "localhost", "[::1]:47822", "0.0.0.0:47822"] {
        assert_eq!(check_request(&Method::GET, "/", &[bad], None, &dev), Err(Reject::Host), "{bad}");
    }
    // 이름 미설정 개발 빌드 — 루프백만
    let bare = Allowed { host: None, port: 47822, loopback: true };
    assert_eq!(check_request(&Method::GET, "/", &["127.0.0.1:47822"], None, &bare), Ok(()));
    assert_eq!(check_request(&Method::GET, "/", &[HOST], None, &bare), Err(Reject::Host));
}

#[test]
fn origin_must_be_the_same_origin() {
    let a = allowed(true);
    let ok = format!("https://{HOST}");
    assert_eq!(check_request(&Method::GET, "/", &[HOST], Some(&ok), &a), Ok(()));
    assert_eq!(
        check_request(&Method::GET, "/", &["127.0.0.1:47822"], Some("http://127.0.0.1:47822"), &a),
        Ok(())
    );
    let with_port = format!("{HOST}:8443");
    assert_eq!(
        check_request(&Method::GET, "/", &[&with_port], Some(&format!("https://{with_port}")), &a),
        Ok(())
    );
    for bad in [
        format!("http://{HOST}"),
        format!("https://{HOST}:8443"),
        "https://evil.example.com".to_string(),
        "null".to_string(),
        String::new(),
        "http://127.0.0.1:47822".to_string(),
    ] {
        assert_eq!(check_request(&Method::GET, "/", &[HOST], Some(&bad), &a), Err(Reject::Origin), "{bad}");
    }
}

#[test]
fn only_get_and_host_is_checked_first() {
    let a = allowed(false);
    for m in [Method::POST, Method::PUT, Method::DELETE, Method::HEAD, Method::OPTIONS] {
        assert_eq!(check_request(&m, "/", &[HOST], None, &a), Err(Reject::Method), "{m}");
    }
    assert_eq!(check_request(&Method::POST, "/", &["evil.example.com"], None, &a), Err(Reject::Host));
}

#[test]
fn ts_host_shape() {
    assert!(valid_ts_host(HOST));
    for bad in ["", "ts.net", "tailnet.ts.net", "mypc..ts.net", "MyPC.tailnet.ts.net", "mypc.tailnet.ts.net.", "my_pc.t.ts.net", "-a.b.ts.net", "a.b.example.com"] {
        assert!(!valid_ts_host(bad), "{bad}");
    }
}

#[test]
fn config_defaults_and_errors() {
    let off = Config::from_prefs(&RemotePrefs::default(), false);
    assert_eq!(off, Config { enabled: false, port: 47821, host: None });
    assert_eq!(Config::from_prefs(&RemotePrefs::default(), true).port, 47822);
    assert_eq!(crate::instance::remote_port(false), 47821);
    assert_eq!(crate::instance::remote_port(true), 47822);
    let prefs = RemotePrefs {
        enabled: Some(true),
        port: Some(0),
        host: Some(" MyPC.Tailnet-ABCD.ts.net ".to_string()),
    };
    let cfg = Config::from_prefs(&prefs, false);
    assert_eq!(cfg.port, 47821);
    assert_eq!(cfg.host.as_deref(), Some(HOST));
    assert_eq!(config_error(&cfg, false), None);
    // 릴리스는 이름이 있어야 한다 · 개발 빌드는 루프백 시험용으로 이름 없이도 연다
    let bare = Config { enabled: true, port: 47821, host: None };
    assert!(config_error(&bare, false).is_some());
    assert_eq!(config_error(&bare, true), None);
    let wrong = Config { enabled: true, port: 47821, host: Some("example.com".into()) };
    assert!(config_error(&wrong, true).is_some());
}

// ── Funnel ────────────────────────────────────────────────────────────────

/// `tailscale serve --bg --https=443 http://127.0.0.1:47821` 만 건 상태(tailnet 안) — Funnel 아님.
const SERVE_ONLY: &str = r#"{
  "TCP": { "443": { "HTTPS": true } },
  "Web": { "mypc.tailnet-abcd.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:47821" } } } }
}"#;

/// 같은 자리를 `tailscale funnel` 로 연 상태.
const FUNNELED: &str = r#"{
  "TCP": { "443": { "HTTPS": true } },
  "Web": { "mypc.tailnet-abcd.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:47821" } } } },
  "AllowFunnel": { "mypc.tailnet-abcd.ts.net:443": true }
}"#;

#[test]
fn funnel_json_detects_only_our_port() {
    assert_eq!(port_is_funneled(SERVE_ONLY, 47821), Ok(false));
    assert_eq!(port_is_funneled(FUNNELED, 47821), Ok(true));
    // 다른 포트를 Funnel 로 낸 것은 우리 일이 아니다.
    assert_eq!(port_is_funneled(FUNNELED, 47822), Ok(false));
    // 빈 설정
    for empty in ["", "  ", "{}", "null"] {
        assert_eq!(port_is_funneled(empty, 47821), Ok(false), "{empty:?}");
    }
    assert!(port_is_funneled("not json", 47821).is_err());
}

#[test]
fn funnel_json_variants() {
    // AllowFunnel false
    let off = FUNNELED.replace("\"mypc.tailnet-abcd.ts.net:443\": true", "\"mypc.tailnet-abcd.ts.net:443\": false");
    assert_eq!(port_is_funneled(&off, 47821), Ok(false));
    // 경로 여럿 중 하나가 우리 포트 · localhost · 포트만
    let multi = r#"{"Web":{"h.t.ts.net:8443":{"Handlers":{"/a":{"Path":"/srv"},"/b":{"Proxy":"localhost:47821/x"}}}},
                    "AllowFunnel":{"h.t.ts.net:8443":true}}"#;
    assert_eq!(port_is_funneled(multi, 47821), Ok(true));
    // TCP 전달
    let tcp = r#"{"TCP":{"10000":{"TCPForward":"127.0.0.1:47821"}},"AllowFunnel":{"h.t.ts.net:10000":true}}"#;
    assert_eq!(port_is_funneled(tcp, 47821), Ok(true));
    // 전경 `tailscale funnel 47821`
    let fg = format!(r#"{{"Foreground":{{"abc123":{FUNNELED}}}}}"#);
    assert_eq!(port_is_funneled(&fg, 47821), Ok(true));
    // 다른 기기를 가리키는 프록시
    let remote = FUNNELED.replace("http://127.0.0.1:47821", "http://10.0.0.5:47821");
    assert_eq!(port_is_funneled(&remote, 47821), Ok(false));
}

#[test]
fn proxy_targets() {
    assert!(targets_port("http://127.0.0.1:47821", 47821));
    assert!(targets_port("https+insecure://localhost:47821/", 47821));
    assert!(targets_port("47821", 47821));
    assert!(targets_port("127.0.0.1:47821", 47821));
    assert!(!targets_port("http://127.0.0.1:478210", 47821));
    assert!(!targets_port("http://127.0.0.1:4782", 47821));
    assert!(!targets_port("http://example.com:47821", 47821));
    assert!(!targets_port("text:hello", 47821));
}

// ── 정적 파일 · CSP ─────────────────────────────────────────────────────────

/// `tauri.conf.json` 의 CSP — 관문이 런타임에 `app.config()` 로 읽는 것과 같은 칸(출처 하나).
fn conf_csp() -> Csp {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json");
    serde_json::from_value(conf["app"]["security"]["csp"].clone()).expect("csp")
}

#[test]
fn csp_header_is_the_config_policy_plus_inline_hashes() {
    let csp = conf_csp();
    let header = gateway_csp(&csp, &[]);
    for d in [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
    ] {
        assert!(header.split("; ").any(|x| x == d), "{d} 없음: {header}");
    }
    let hashed = gateway_csp(&csp, &["'sha256-abc='".to_string()]);
    assert!(hashed.contains("script-src 'self' 'wasm-unsafe-eval' 'sha256-abc='"), "{hashed}");
    // script-src 가 없는 정책이면 default-src 를 물려받는다.
    let bare = Csp::Policy("default-src 'self'; img-src data:".to_string());
    assert_eq!(gateway_csp(&bare, &["'sha256-x'".into()]), "default-src 'self'; img-src data:; script-src 'self' 'sha256-x'");
}

#[test]
fn inline_script_hash_matches_the_browser() {
    // MDN 의 CSP 해시 예(`alert('Hello, world.');`).
    let html = "<html><body><script>alert('Hello, world.');</script></body></html>";
    assert_eq!(inline_script_hashes(html), vec!["'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='".to_string()]);
    // src 있는 것 · 빈 것은 빼고, 대소문자·속성·CRLF 를 견딘다.
    let html = "<SCRIPT type=\"module\" src=\"/a.js\"></SCRIPT><script></script>\
                <script type=\"text/javascript\">alert('Hello, world.');</script><scripts>x</scripts>";
    assert_eq!(inline_script_hashes(html).len(), 1);
    let crlf = "<script>a\r\nb</script>";
    let lf = "<script>a\nb</script>";
    assert_eq!(inline_script_hashes(crlf), inline_script_hashes(lf));
}

#[test]
fn asset_response_carries_csp_and_security_headers() {
    let csp = conf_csp();
    let html = b"<!doctype html><script>alert('Hello, world.');</script>".to_vec();
    let r = asset_response("index.html", html, "text/html".into(), &csp);
    let h = r.headers();
    assert_eq!(h["content-type"], "text/html; charset=utf-8");
    assert_eq!(h["cache-control"], "no-store");
    assert_eq!(h["x-content-type-options"], "nosniff");
    assert_eq!(h["referrer-policy"], "no-referrer");
    let policy = h["content-security-policy"].to_str().unwrap();
    assert!(policy.contains("'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='"), "{policy}");
    assert!(policy.contains("frame-ancestors 'none'"));

    let js = asset_response("_app/immutable/entry/start.js", b"x".to_vec(), "text/javascript".into(), &csp);
    assert_eq!(js.headers()["content-type"], "text/javascript");
    assert_eq!(js.headers()["cache-control"], "public, max-age=31536000, immutable");
    assert!(js.headers().contains_key("content-security-policy"));
    assert_eq!(js.headers()["x-content-type-options"], "nosniff");
}

#[test]
fn asset_paths_are_filtered() {
    assert_eq!(safe_asset_path("/").as_deref(), Some("index.html"));
    assert_eq!(safe_asset_path("/_app/immutable/chunks/DJQCpgoZ.js").as_deref(), Some("_app/immutable/chunks/DJQCpgoZ.js"));
    assert_eq!(safe_asset_path("/favicon.png").as_deref(), Some("favicon.png"));
    for bad in [
        "",
        "relative",
        "/../secret",
        "/_app/../../x",
        "/./x",
        "//x",
        "/a//b",
        "/%2e%2e/x",
        "/a\\b",
        "/C:/Windows",
        "/a b",
        "/a\0b",
    ] {
        assert_eq!(safe_asset_path(bad), None, "{bad:?}");
    }
    assert_eq!(safe_asset_path(&format!("/{}", "a".repeat(600))), None);
}

#[test]
fn status_serializes_for_the_ui() {
    let s = RemoteStatus {
        enabled: true,
        listening: true,
        port: 47821,
        host: HOST.into(),
        funnel: "unknown",
        tailscale_cli: true,
        error: Some("x".into()),
    };
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(
        v,
        serde_json::json!({"enabled": true, "listening": true, "port": 47821, "host": HOST, "funnel": "unknown", "tailscaleCli": true, "error": "x"})
    );
    let v = serde_json::to_value(RemoteStatus::default()).unwrap();
    assert!(v.get("error").is_none());
}

#[test]
fn self_dns_name_reads_magicdns() {
    let json = r#"{"Version":"1.80.0","Self":{"DNSName":"MyPC.tail1234.ts.net.","HostName":"MyPC"},"MagicDNSSuffix":"tail1234.ts.net"}"#;
    assert_eq!(self_dns_name(json).as_deref(), Some("mypc.tail1234.ts.net"));
    // MagicDNS 꺼짐 · 모양이 아님 · 칸 없음 · JSON 아님
    assert_eq!(self_dns_name(r#"{"Self":{"DNSName":""}}"#), None);
    assert_eq!(self_dns_name(r#"{"Self":{"DNSName":"mypc.example.com."}}"#), None);
    assert_eq!(self_dns_name(r#"{"Self":{}}"#), None);
    assert_eq!(self_dns_name("not json"), None);
}
