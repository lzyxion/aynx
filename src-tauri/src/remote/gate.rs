//! 관문의 **페어링·원격 가림막 경로**(R1a-2) — 쿠키를 읽어 단계(미페어링·페어링됨·열림)를 가르고, 관문이 직접 그리는 작은 쪽 둘
//! (페어링 · 잠금 해제)과 POST 넷을 낸다. 상태는 `auth.rs`, 볼트는 세션 서버(`server::vault_proxy` 의 GUI 문)다.
//!
//! | 경로 | 받는 단계 | 하는 일 |
//! | --- | --- | --- |
//! | `GET /` | 미페어링 → **페어링 쪽** · 페어링됨 → **잠금 해제 쪽** · 열림 → 앱(`index.html`) | |
//! | `GET /remote/gate.js` · `gate.css` | 누구나 | 위 두 쪽의 스크립트·모양(인라인 없음 — CSP `script-src 'self'`) |
//! | `GET /remote/theme.css` | 누구나 | 메인 PC 앱이 지금 칠한 색(`theme.rs` — 받은 값이 없으면 빈 몸). gate.css 뒤에 실린다 |
//! | 그 밖의 GET | 열림만(아니면 401) | 정적 파일(R1a-1) |
//! | `POST /remote/pair/request` | 미페어링 | 페어링 요청 하나 → 집 PC 주 창에 이벤트 `remote-pair-request` |
//! | `POST /remote/pair/status` `{poll}` | 폴 비밀을 든 브라우저 | `pending`·`denied`·`gone`·`allowed`(+ 기기 쿠키) |
//! | `POST /remote/unlock` `{password?}` | 페어링됨 | 원격 가림막을 걷는다(+ 세션 쿠키) — 아래 "볼트" |
//! | `POST /remote/lock` | 누구나 | 이 세션을 닫는다(세션 쿠키 지움) |
//! | `POST /remote/reauth` `{cmd, password?}` | 열림 | 마스터 재확인(R1a-4 — 없으면 그대로) → 그 명령 한 번의 표 `{ticket}` — 아래 "재확인" |
//!
//! POST 는 이 다섯만이고 **`Origin` 이 반드시 있어야** 하며 같은 출처여야 한다(`gateway::check_request`). 몸은 JSON 4KiB 까지.
//!
//! ## 쿠키
//!
//! - 기기: `__Host-pl_dev=<토큰>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=34560000`(400일 — Chrome 상한).
//! - 세션: `__Host-pl_ses=<토큰>; Path=/; Secure; HttpOnly; SameSite=Strict`(브라우저 세션 쿠키 — 서버 쪽 시한이 진짜다).
//! - `__Host-` 접두는 `Secure` 를 요구한다 — 개발 빌드의 `http://127.0.0.1:<포트>` 시험에서도 Chromium(Edge 실측)이 받아 되돌려
//!   보낸다(루프백은 "잠재적으로 믿을 만한" 출처). 그래서 이름은 빌드와 무관하게 하나다.
//!
//! ## 볼트 — **원격 가림막을 걷는 것이 곧 볼트를 여는 것** (결정 · 설계 3.1)
//!
//! 집 PC 가림막의 규칙("가림막을 걷는 것이 곧 볼트를 여는 것")을 원격 창에도 그대로 쓴다. 원격 창은 열린 동안 **창으로 세므로**
//! (3.1 — 세는 일은 `windows.rs`), 볼트가 창 0개·가림막으로 잠겨 있었어도 원격을 걷으면 연다:
//! - 마스터 있음: `vault_verify_master`(세션 서버 — 상태를 바꾸지 않는 확인 · 서버 쪽 빈도 제한) → 맞으면, 볼트가 열려 있지 않을 때만
//!   **기존 `vault_unlock(master)`** 로 연다(값을 돌려주는 새 길은 없다 — 사람이 친 암호가 GUI → 서버 한 방향으로 갈 뿐).
//! - 마스터 없음(사용자 선택 — 설정 화면이 6번 커밋에서 밝힌다): 단추 하나. 볼트가 잠겨 있으면 기존 `vault_unlock(None)`.
//! - 금고 없음: 세션만 연다.
//!
//! 집 PC 의 가림막(화면 층)은 원격을 걷어도 그대로이고, 원격 세션은 집 PC 를 걷어도 그대로다(창마다 자기 가림막). 원격 [잠그기]·
//! 무입력 만료는 그 세션만 닫는다 — 볼트를 잠그는 일(원격 창이 빠져 창 0개가 되면)은 `windows.rs` 의 셈이 한다(R1a-3).
//!
//! ## 재확인 (R1a-4 — 설계 3절 단계 3 · `deny.rs`)
//!
//! 원격 창의 `deny::REAUTH` 명령(작업안 승인 · AI 권한 올리기 …)은 폴리필이 먼저 여기에 묻는다. 마스터가 있으면 `password` 가 있어야 하고
//! (없으면 400 `{error:"password"}` — 폴리필이 그때 암호 칸을 띄운다) `vault_verify_master`(상태를 바꾸지 않는 확인)로 본다. 실패 셈은
//! 잠금 해제와 같은 두 겹(기기·전역) + 서버 쪽 셋째 겹이다. 마스터가 없거나 볼트가 없으면 암호 없이 표를 준다(사용자 결정 — 마스터는
//! 선택). 표는 60초 · 이 세션 · 이 명령 · 한 번(`auth::AuthState::issue_reauth`) — 폴리필이 ws 프레임에 싣고 `bridge` 가 소비한다.
//! **암호는 이 HTTP 몸으로만 간다** — ws 프레임에도 로그에도 없다.

use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::{self, HeaderMap, HeaderValue};
use hyper::{Response, StatusCode};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use zeroize::Zeroizing;

use super::auth::{self, Auth, PairError, PairPoll};
use crate::server::vault_proxy::{self, MasterVerdict};

/// 기기 쿠키 이름.
pub(crate) const DEVICE_COOKIE: &str = "__Host-pl_dev";
/// 세션 쿠키 이름.
pub(crate) const SESSION_COOKIE: &str = "__Host-pl_ses";
/// POST 몸 상한.
pub(crate) const MAX_POST_BODY: usize = 4096;
/// 마스터 암호 길이 상한(볼트 값 상한과 같은 자리).
const MAX_PASSWORD: usize = 1024;

/// 관문이 직접 그리는 쪽의 CSP — 우리 파일만, 인라인 없음.
pub(crate) const GATE_CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; \
base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// POST 를 받는 경로 — 이것들만(`gateway::check_request` 가 메서드 규칙을 이 목록으로 넓힌다).
pub(crate) const POST_ROUTES: [&str; 5] = ["/remote/pair/request", "/remote/pair/status", "/remote/unlock", "/remote/lock", "/remote/reauth"];

pub(crate) fn is_post_route(path: &str) -> bool {
    POST_ROUTES.contains(&path)
}

const GATE_JS: &str = include_str!("gate/gate.js");
const GATE_CSS: &str = include_str!("gate/gate.css");

/// 관문 자산(누구나) — `(본문, 내용 종류)`. `theme.css` 는 그때그때 짓는다(메인 PC 색 — `theme.rs`).
pub(crate) fn gate_asset(path: &str) -> Option<(Cow<'static, str>, &'static str)> {
    match path {
        "/remote/gate.js" => Some((Cow::Borrowed(GATE_JS), "text/javascript; charset=utf-8")),
        "/remote/gate.css" => Some((Cow::Borrowed(GATE_CSS), "text/css; charset=utf-8")),
        "/remote/theme.css" => Some((Cow::Owned(super::theme::css()), "text/css; charset=utf-8")),
        _ => None,
    }
}

/// 앱 셸로 가는 GET 경로인가(`/` · `/index.html`) — 단계가 모자라면 여기에 관문 쪽을 낸다.
pub(crate) fn is_shell(path: &str) -> bool {
    path == "/" || path == "/index.html"
}

// ── 단계 ───────────────────────────────────────────────────────────────────

/// 요청 하나의 신뢰 단계(설계 3절).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Level {
    Unpaired,
    Paired(String),
    Open(String),
}

/// `Cookie` 머리들에서 이름의 **첫** 값. 값이 이상하면 없는 것으로.
pub(crate) fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.trim())
}

/// 쿠키 → 단계. 열림이면 세션의 무입력 시계를 되감는다.
pub(crate) fn level(auth: &Auth, headers: &HeaderMap, now: Instant) -> Level {
    let mut st = auth.lock();
    let Some(device) = cookie(headers, DEVICE_COOKIE).and_then(|t| st.device_for(t)) else {
        return Level::Unpaired;
    };
    match cookie(headers, SESSION_COOKIE) {
        Some(ses) if st.session_for(&device, ses, now) => Level::Open(device),
        _ => Level::Paired(device),
    }
}

// ── 쿠키 · 응답 ─────────────────────────────────────────────────────────────

pub(crate) fn device_cookie(token: &str) -> String {
    format!("{DEVICE_COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=34560000")
}

pub(crate) fn session_cookie(token: &str) -> String {
    format!("{SESSION_COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict")
}

pub(crate) fn clear_session_cookie() -> String {
    format!("{SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0")
}

fn common(headers: &mut HeaderMap) {
    set(headers, header::CACHE_CONTROL, "no-store");
    set(headers, header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    set(headers, header::REFERRER_POLICY, "no-referrer");
}

fn set(headers: &mut HeaderMap, name: header::HeaderName, value: &str) {
    if let Ok(v) = HeaderValue::from_str(value) {
        headers.insert(name, v);
    }
}

/// 관문 쪽(HTML) 하나 — 관문 CSP · 저장 안 함.
pub(crate) fn page_response(html: String) -> Response<Full<Bytes>> {
    let mut r = Response::new(Full::new(Bytes::from(html)));
    let h = r.headers_mut();
    set(h, header::CONTENT_TYPE, "text/html; charset=utf-8");
    set(h, header::CONTENT_SECURITY_POLICY, GATE_CSP);
    common(h);
    r
}

/// 관문 자산 하나(저장 안 함 — `common`).
pub(crate) fn asset_response(body: Cow<'static, str>, mime: &str) -> Response<Full<Bytes>> {
    let bytes = match body {
        Cow::Borrowed(s) => Bytes::from_static(s.as_bytes()),
        Cow::Owned(s) => Bytes::from(s),
    };
    let mut r = Response::new(Full::new(bytes));
    let h = r.headers_mut();
    set(h, header::CONTENT_TYPE, mime);
    set(h, header::CONTENT_SECURITY_POLICY, GATE_CSP);
    common(h);
    r
}

/// JSON 답 — 쿠키를 붙일 수 있다.
pub(crate) fn json_response(status: StatusCode, body: Value, cookies: &[String]) -> Response<Full<Bytes>> {
    let mut r = Response::new(Full::new(Bytes::from(body.to_string())));
    *r.status_mut() = status;
    let h = r.headers_mut();
    set(h, header::CONTENT_TYPE, "application/json; charset=utf-8");
    common(h);
    for c in cookies {
        if let Ok(v) = HeaderValue::from_str(c) {
            h.append(header::SET_COOKIE, v);
        }
    }
    r
}

fn ms(d: Duration) -> u64 {
    d.as_millis() as u64
}

// ── 쪽 ────────────────────────────────────────────────────────────────────

/// 자물쇠(Lucide `lock` — 앱 `UiIcon name="lock"` 과 같은 경로). 굵기 · 크기는 gate.css 의 `.lock-badge svg`.
const ICON_LOCK: &str = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/></g></svg>";

/// 기기 연결(Lucide `monitor-smartphone` — 앱 `UiIcon name="remote"`).
const ICON_REMOTE: &str = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8m-2 4v-3.96v3.15M7 19h5\"/><rect width=\"6\" height=\"10\" x=\"16\" y=\"12\" rx=\"2\"/></g></svg>";

/// 알림 줄 — 가림막 카드의 틀림 줄 자리(비면 gate.css 가 숨긴다). `gate.js` 가 진행 · 결과를 적는다.
const MSG: &str = "<p id=\"msg\" class=\"msg\" role=\"status\" aria-live=\"polite\"></p>";

/// 쪽 틀 — 메인 PC 가림막의 잠금 카드와 한 벌([배지] → 제목 → 나머지). 카드 밖 시계 · 세션 요약은 싣지 않는다.
/// 색은 gate.css 위에 `theme.css`(메인 PC 가 칠한 값)를 얹고, 그 값이 있으면 `<html data-mode>` 로 메인 PC 모드를 따른다.
fn shell(page: &str, extra: &str, icon: &str, title: &str, body: &str) -> String {
    let mode = super::theme::mode().map(|m| format!(" data-mode=\"{m}\"")).unwrap_or_default();
    // `gate.js` 도 이 값으로 문구를 고른다 — 관문 쪽은 앱 번들 밖이라 프런트 사전이 없다.
    let lang = match crate::i18n::lang() {
        crate::i18n::Lang::Ko => "ko",
        crate::i18n::Lang::En => "en",
    };
    format!(
        "<!doctype html>\n<html lang=\"{lang}\"{mode}><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<meta name=\"robots\" content=\"noindex\"><title>Aynx</title>\
<link rel=\"stylesheet\" href=\"/remote/gate.css\"><link rel=\"stylesheet\" href=\"/remote/theme.css\">\
<script src=\"/remote/gate.js\" defer></script></head>\
<body data-page=\"{page}\"{extra}><main class=\"lock-card\"><span class=\"lock-badge\">{icon}</span>\
<h1 class=\"lock-title\">{title}</h1>{body}</main></body></html>\n"
    )
}

/// 미페어링 — 연결 요청 쪽. 코드는 [연결 요청] 뒤에 카드 안에 선다.
pub(crate) fn pair_page() -> String {
    shell(
        "pair",
        "",
        ICON_REMOTE,
        &crate::i18n::tr!(ko: "기기 연결", en: "Connect this device"),
        &crate::i18n::tr!(
            ko: "<p class=\"lock-lead\">메인 PC 에서 허용하면 연결됩니다.</p><div class=\"lock-form\"><div id=\"code\" class=\"code\" hidden></div>{MSG}<button id=\"pair\" class=\"lock-open\" type=\"button\">연결 요청</button></div>",
            en: "<p class=\"lock-lead\">Connects once you allow it on the main PC.</p><div class=\"lock-form\"><div id=\"code\" class=\"code\" hidden></div>{MSG}<button id=\"pair\" class=\"lock-open\" type=\"button\">Request connection</button></div>"
        ),
    )
}

/// 페어링됨·잠김 — 원격 가림막. 마스터가 없으면 단추 하나(그 사실을 밝힌다).
pub(crate) fn unlock_page(master: bool) -> String {
    if master {
        shell(
            "unlock",
            " data-master=\"1\"",
            ICON_LOCK,
            &crate::i18n::tr!(ko: "잠김", en: "Locked"),
            &crate::i18n::tr!(
                ko: "<form id=\"unlock\" class=\"lock-form\"><label class=\"lock-label\" for=\"pw\">마스터 암호</label><input id=\"pw\" class=\"lock-input\" type=\"password\" autocomplete=\"current-password\" spellcheck=\"false\" maxlength=\"1024\">{MSG}<button id=\"open\" class=\"lock-open\" type=\"submit\">열기</button></form>",
                en: "<form id=\"unlock\" class=\"lock-form\"><label class=\"lock-label\" for=\"pw\">Master password</label><input id=\"pw\" class=\"lock-input\" type=\"password\" autocomplete=\"current-password\" spellcheck=\"false\" maxlength=\"1024\">{MSG}<button id=\"open\" class=\"lock-open\" type=\"submit\">Unlock</button></form>"
            ),
        )
    } else {
        shell(
            "unlock",
            " data-master=\"0\"",
            ICON_LOCK,
            &crate::i18n::tr!(ko: "잠김", en: "Locked"),
            &crate::i18n::tr!(
                ko: "<p class=\"lock-lead\">마스터 암호가 없어 단추 하나로 열립니다.</p><form id=\"unlock\" class=\"lock-form\">{MSG}<button id=\"open\" class=\"lock-open\" type=\"submit\">열기</button></form>",
                en: "<p class=\"lock-lead\">No master password is set, so one button unlocks this.</p><form id=\"unlock\" class=\"lock-form\">{MSG}<button id=\"open\" class=\"lock-open\" type=\"submit\">Unlock</button></form>"
            ),
        )
    }
}

/// 잠금 해제 쪽 — 마스터 유무는 세션 서버에 묻는다. 닿지 못하면 **암호 칸이 있는 쪽**(보수적으로 — 서버가 다시 본다).
pub(crate) async fn unlock_page_now() -> String {
    let master = match vault_proxy::status_checked().await {
        Ok(v) => v.get("hasMaster").and_then(Value::as_bool).unwrap_or(true),
        Err(_) => true,
    };
    unlock_page(master)
}

// ── 이벤트 ─────────────────────────────────────────────────────────────────

/// 열린 원격 세션이 바뀌었다 — 집 PC 주 창에(상태바 — [`activity_changed`]).
/// 원격 창(ws)이 자기 세션을 곧바로 다시 보게 깨우고(끝난 세션의 연결은 닫힌다 — R1a-3), 볼트 셈에 알린다(`windows`).
pub(crate) fn sessions_changed(app: &AppHandle, auth: &Auth) {
    let n = activity_changed(app, auth);
    super::ws::sessions_changed();
    super::windows::sessions_changed(app, n);
}

/// 원격 접속 모습이 바뀌었다(세션 열림·닫힘 · 원격 창 붙음·끊김 · 기기 이름) — 집 PC 주 창에 `remote-sessions
/// {unlocked, active}`(R1a-5). `unlocked` = 열린 기기 수 · `active` = 열렸고 **원격 창이 붙은** 기기 수(상태바 "원격 접속 중 (N)").
/// 몸은 수뿐이고 프런트가 `remote_devices_list`·`remote_log` 를 다시 읽는다. 열린 기기 수를 돌려준다.
pub(crate) fn activity_changed(app: &AppHandle, auth: &Auth) -> usize {
    let ids = auth.lock().unlocked_ids(Instant::now());
    let live = super::activity::live();
    let active = ids.iter().filter(|id| live.get(*id).copied().unwrap_or(0) > 0).count();
    let _ = app.emit_to("main", "remote-sessions", json!({ "unlocked": ids.len(), "active": active }));
    ids.len()
}

/// 집 PC 에 OS 알림 — **끌 수 없다**(설계 9-⑤ 권장 · 13절). 원격 기기가 페어링을 청하거나 원격 가림막을 걷었을 때.
/// 문구에는 기기 이름만(코드·IP·토큰 없음).
pub(crate) fn notify_home(app: &AppHandle, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let title = format!(
        "{} — {}",
        crate::instance::window_title(crate::instance::DEV),
        crate::i18n::tr!(ko: "원격 접속", en: "Remote access")
    );
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[aynx] 원격 관문: OS 알림 실패: {e}");
    }
}

/// 열린 세션의 `(기기, 세션 열쇠)` — 앱 셸의 부팅 표·`/remote/ws`·`/remote/asset` 이 쓴다(R1a-3). 열림이 아니면 `None`.
pub(crate) fn open_session(auth: &Auth, headers: &HeaderMap, now: Instant) -> Option<(String, [u8; 32])> {
    let Level::Open(device) = level(auth, headers, now) else {
        return None;
    };
    let key = cookie(headers, SESSION_COOKIE).and_then(auth::session_key)?;
    Some((device, key))
}

fn pair_closed(app: &AppHandle) {
    let _ = app.emit_to("main", "remote-pair-closed", json!({}));
}

async fn persist(auth: &Arc<Auth>) {
    let a = Arc::clone(auth);
    let _ = tauri::async_runtime::spawn_blocking(move || a.persist_blocking()).await;
}

// ── POST ───────────────────────────────────────────────────────────────────

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// POST 다섯 — 문지기(Host·Origin·경로)는 이미 지났다. `body` 는 4KiB 안.
pub(crate) async fn post(app: &AppHandle, auth: &Arc<Auth>, path: &str, headers: &HeaderMap, body: Bytes) -> Response<Full<Bytes>> {
    let now = Instant::now();
    match path {
        "/remote/pair/request" => pair_request(app, auth, headers, now).await,
        "/remote/pair/status" => pair_status(app, auth, body, now).await,
        "/remote/unlock" => unlock(app, auth, headers, body, now).await,
        "/remote/lock" => lock(app, auth, headers),
        "/remote/reauth" => reauth(auth, headers, body, now).await,
        _ => json_response(StatusCode::NOT_FOUND, json!({ "error": "route" }), &[]),
    }
}

/// 지금 도는 `tailscale whois` 표시 — 인증 없는 경로라 CLI 를 한 번에 하나만 띄운다.
static WHOIS_RUNNING: AtomicBool = AtomicBool::new(false);

/// `whois` 한 번을 띄울 자리. 떨어지면 자리를 돌려준다 — 프로세스가 끝날 때 풀리게 블로킹 작업 안으로 옮겨 쥔다
/// (요청이 먼저 끊겨도 CLI 가 끝나기 전에는 다음 것이 서지 않는다).
pub(crate) struct WhoisPermit;

impl WhoisPermit {
    pub(crate) fn take() -> Option<WhoisPermit> {
        (!WHOIS_RUNNING.swap(true, Ordering::AcqRel)).then_some(WhoisPermit)
    }
}

impl Drop for WhoisPermit {
    fn drop(&mut self) {
        WHOIS_RUNNING.store(false, Ordering::Release);
    }
}

fn pair_refused(error: PairError) -> Response<Full<Bytes>> {
    match error {
        PairError::Busy => json_response(StatusCode::CONFLICT, json!({ "error": "busy" }), &[]),
        PairError::RateLimited => json_response(StatusCode::TOO_MANY_REQUESTS, json!({ "error": "limited" }), &[]),
        PairError::Full => json_response(StatusCode::FORBIDDEN, json!({ "error": "full" }), &[]),
        PairError::Entropy => json_response(StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "entropy" }), &[]),
    }
}

async fn pair_request(app: &AppHandle, auth: &Arc<Auth>, headers: &HeaderMap, now: Instant) -> Response<Full<Bytes>> {
    if level(auth, headers, now) != Level::Unpaired {
        return json_response(StatusCode::CONFLICT, json!({ "error": "paired" }), &[]);
    }
    // 어차피 거절될 요청은 CLI 를 띄우지 않는다 — 잠금은 이 줄에서 끝나고, 아래 `pair_request` 가 다시 판정한다.
    let refused = auth.lock().pair_refusal(now);
    if let Some(error) = refused {
        return pair_refused(error);
    }
    let node = match header_str(headers, "x-forwarded-for").and_then(auth::client_ip_from_forwarded) {
        None => None,
        Some(ip) => {
            // 앞선 요청의 whois 가 도는 중이면 그 요청이 곧 대기 자리를 잡는다 — 같은 답(`busy`).
            let Some(permit) = WhoisPermit::take() else {
                return pair_refused(PairError::Busy);
            };
            tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                super::funnel::whois_node(ip)
            })
            .await
            .ok()
            .flatten()
        }
    };
    let name = auth::pair_device_name(node.as_deref(), header_str(headers, "user-agent").unwrap_or(""));
    let login = header_str(headers, "tailscale-user-login").map(str::to_owned);
    let ts_name = header_str(headers, "tailscale-user-name").map(str::to_owned);
    // whois 를 기다렸을 수 있으니 시각을 다시 잰다(요청의 수명 · 빈도 셈).
    let made = auth.lock().pair_request(Instant::now(), name, login, ts_name);
    match made {
        Ok((ticket, notice)) => {
            eprintln!("[aynx] 원격 관문: 페어링 요청 — 집 PC 확인 대기");
            let _ = app.emit_to("main", "remote-pair-request", &notice);
            notify_home(
                app,
                crate::i18n::tr!(
                    ko: "{name} 이(가) 연결을 요청합니다 — 이 PC 화면에서 코드를 견주고 허용하세요",
                    en: "{name} asks to connect — compare the code on this PC's screen and allow it",
                    name = notice.device_name
                ),
            );
            json_response(
                StatusCode::OK,
                json!({ "code": ticket.code, "poll": ticket.poll.as_str(), "expiresInMs": ms(ticket.expires_in) }),
                &[],
            )
        }
        Err(error) => pair_refused(error),
    }
}

#[derive(serde::Deserialize)]
struct PollBody {
    poll: String,
}

async fn pair_status(app: &AppHandle, auth: &Arc<Auth>, body: Bytes, now: Instant) -> Response<Full<Bytes>> {
    let Ok(b) = serde_json::from_slice::<PollBody>(&body) else {
        return json_response(StatusCode::BAD_REQUEST, json!({ "error": "body" }), &[]);
    };
    let polled = auth.lock().pair_poll(&b.poll, now, &auth::stamp());
    match polled {
        PairPoll::Pending => json_response(StatusCode::OK, json!({ "state": "pending" }), &[]),
        PairPoll::Denied => {
            pair_closed(app);
            json_response(StatusCode::OK, json!({ "state": "denied" }), &[])
        }
        PairPoll::Gone => json_response(StatusCode::OK, json!({ "state": "gone" }), &[]),
        PairPoll::Allowed { token, device_id } => {
            persist(auth).await;
            pair_closed(app);
            let name = auth.lock().device_name(&device_id);
            super::activity::record(super::activity::Kind::Paired, &device_id, &name);
            activity_changed(app, auth);
            eprintln!("[aynx] 원격 관문: 기기 페어링됨 — {device_id}");
            json_response(StatusCode::OK, json!({ "state": "allowed" }), &[device_cookie(token.as_str())])
        }
    }
}

#[derive(serde::Deserialize)]
struct UnlockBody {
    #[serde(default)]
    password: Option<String>,
}

/// 실패 하나를 세고 401 — 막혔으면 남은 시간도.
fn unlock_fail(auth: &Arc<Auth>, device: &str, now: Instant, server_lock: Option<u64>) -> Response<Full<Bytes>> {
    let (locked, total, name) = {
        let mut st = auth.lock();
        let (locked, total) = st.unlock_failed(device, now);
        (locked, total, st.device_name(device))
    };
    super::activity::record(super::activity::Kind::UnlockFailed, device, &name);
    eprintln!("[aynx] 원격 관문: 잠금 해제 실패(누계 {total}){}", if locked.is_some() { " · 잠시 막음" } else { "" });
    let retry = locked.map(ms).max(server_lock);
    let mut body = json!({ "error": "bad" });
    if let Some(r) = retry {
        body["retryAfterMs"] = json!(r);
    }
    json_response(StatusCode::UNAUTHORIZED, body, &[])
}

async fn unlock(app: &AppHandle, auth: &Arc<Auth>, headers: &HeaderMap, body: Bytes, now: Instant) -> Response<Full<Bytes>> {
    let device = match level(auth, headers, now) {
        Level::Unpaired => return json_response(StatusCode::UNAUTHORIZED, json!({ "error": "unpaired" }), &[]),
        Level::Paired(d) | Level::Open(d) => d,
    };
    if let Some(b) = auth.lock().unlock_blocked(&device, now) {
        return json_response(StatusCode::TOO_MANY_REQUESTS, json!({ "error": "limited", "retryAfterMs": ms(b.left()) }), &[]);
    }
    let password: Option<Zeroizing<String>> = match serde_json::from_slice::<UnlockBody>(&body) {
        Ok(b) => b.password.map(Zeroizing::new),
        Err(_) if body.is_empty() => None,
        Err(_) => return json_response(StatusCode::BAD_REQUEST, json!({ "error": "body" }), &[]),
    };
    let Ok(status) = vault_proxy::status_checked().await else {
        return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "server" }), &[]);
    };
    let has_master = status.get("hasMaster").and_then(Value::as_bool) == Some(true);
    let state = status.get("state").and_then(Value::as_str).unwrap_or("absent").to_string();
    if has_master {
        let Some(pw) = password.filter(|p| !p.is_empty() && p.len() <= MAX_PASSWORD) else {
            return json_response(StatusCode::BAD_REQUEST, json!({ "error": "password" }), &[]);
        };
        match vault_proxy::verify_master(&pw).await {
            Ok(MasterVerdict::Ok) => {}
            Ok(MasterVerdict::Bad(server_lock)) => return unlock_fail(auth, &device, now, server_lock),
            Ok(MasterVerdict::Limited(left)) => {
                return json_response(StatusCode::TOO_MANY_REQUESTS, json!({ "error": "limited", "retryAfterMs": left }), &[])
            }
            // 그 사이 마스터가 풀렸다 — 쪽을 다시 그리게 한다(단추 쪽).
            Ok(MasterVerdict::NoMaster | MasterVerdict::NoVault) => {
                return json_response(StatusCode::CONFLICT, json!({ "error": "master" }), &[])
            }
            Err(_) => return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "server" }), &[]),
        }
        if state != "unlocked" {
            if let Err(e) = vault_proxy::vault_unlock(Some(pw.to_string())).await {
                if crate::errors::has_reason(&e, crate::errors::VAULT_WRONG_MASTER) {
                    return unlock_fail(auth, &device, now, None);
                }
                return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "server" }), &[]);
            }
        }
    } else if state == "locked" && vault_proxy::vault_unlock(None).await.is_err() {
        return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "server" }), &[]);
    }
    let idle = tauri::async_runtime::spawn_blocking(crate::settings::idle_lock_min)
        .await
        .ok()
        .flatten()
        .map(|m| Duration::from_secs(u64::from(m) * 60))
        .unwrap_or(auth::DEFAULT_IDLE);
    let (token, name) = {
        let mut st = auth.lock();
        let t = st.open_session(&device, idle, Instant::now());
        st.touch_seen(&device, &auth::stamp());
        (t, st.device_name(&device))
    };
    let Some(token) = token else {
        return json_response(StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "session" }), &[]);
    };
    persist(auth).await;
    eprintln!("[aynx] 원격 관문: 원격 가림막 걷힘 — 기기 {device}");
    super::activity::record(super::activity::Kind::Unlocked, &device, &name);
    notify_home(
        app,
        crate::i18n::tr!(
            ko: "{name} 이(가) 원격으로 열었습니다 — 상태바의 원격 칩에서 끊을 수 있습니다",
            en: "{name} opened remotely — disconnect from the remote chip in the status bar",
            name = name
        ),
    );
    sessions_changed(app, auth);
    // 볼트를 열었다 — 페이지가 원격 창으로 붙기 전까지도 원격을 "있음" 으로 센다(집 PC 창 0개일 때 곧바로 다시 잠그지 않게).
    super::windows::unlocked(app);
    json_response(StatusCode::OK, json!({ "ok": true }), &[session_cookie(token.as_str())])
}

#[derive(serde::Deserialize)]
struct ReauthBody {
    cmd: String,
    #[serde(default)]
    password: Option<String>,
}

/// 재확인의 첫 갈래 — 볼트 상태와 받은 암호로. 순수(시험).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReauthCheck<'a> {
    /// 마스터가 없다(볼트 없음 포함) — 암호 없이 표를 준다(사용자 결정 — 마스터는 선택).
    Pass,
    /// 마스터가 있는데 암호가 없다(또는 비었거나 너무 길다) — 폴리필이 칸을 띄운다.
    NeedPassword,
    /// 이 암호로 마스터를 확인한다.
    Verify(&'a str),
}

pub(crate) fn reauth_check<'a>(status: &Value, password: Option<&'a str>) -> ReauthCheck<'a> {
    if status.get("hasMaster").and_then(Value::as_bool) != Some(true) {
        return ReauthCheck::Pass;
    }
    match password {
        Some(p) if !p.is_empty() && p.len() <= MAX_PASSWORD => ReauthCheck::Verify(p),
        _ => ReauthCheck::NeedPassword,
    }
}

/// 마스터 확인의 답 → 재확인의 끝. 순수(시험).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReauthVerdict {
    Issue,
    /// 틀림 — 이번 실패로 서버가 막았으면 그 길이(ms).
    Wrong(Option<u64>),
    Limited(u64),
    Server,
}

pub(crate) fn reauth_verdict(v: Result<MasterVerdict, String>) -> ReauthVerdict {
    match v {
        // 그 사이 마스터가 풀렸거나 볼트가 사라졌다 — 마스터 없음과 같다.
        Ok(MasterVerdict::Ok | MasterVerdict::NoMaster | MasterVerdict::NoVault) => ReauthVerdict::Issue,
        Ok(MasterVerdict::Bad(server_lock)) => ReauthVerdict::Wrong(server_lock),
        Ok(MasterVerdict::Limited(left)) => ReauthVerdict::Limited(left),
        Err(_) => ReauthVerdict::Server,
    }
}

/// 재확인 — 열린 세션만. 맞으면 그 명령 한 번의 표(머리말 "재확인").
async fn reauth(auth: &Arc<Auth>, headers: &HeaderMap, body: Bytes, now: Instant) -> Response<Full<Bytes>> {
    let Some((device, session)) = open_session(auth, headers, now) else {
        return json_response(StatusCode::UNAUTHORIZED, json!({ "error": "session" }), &[]);
    };
    let Ok(b) = serde_json::from_slice::<ReauthBody>(&body) else {
        return json_response(StatusCode::BAD_REQUEST, json!({ "error": "body" }), &[]);
    };
    let password = b.password.map(Zeroizing::new);
    if !super::deny::command_shape(&b.cmd) {
        return json_response(StatusCode::BAD_REQUEST, json!({ "error": "body" }), &[]);
    }
    if let Some(blocked) = auth.lock().unlock_blocked(&device, now) {
        return json_response(StatusCode::TOO_MANY_REQUESTS, json!({ "error": "limited", "retryAfterMs": ms(blocked.left()) }), &[]);
    }
    let Ok(status) = vault_proxy::status_checked().await else {
        return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "server" }), &[]);
    };
    let check = reauth_check(&status, password.as_deref().map(String::as_str));
    let has_master = check != ReauthCheck::Pass;
    match check {
        ReauthCheck::Pass => {}
        ReauthCheck::NeedPassword => return json_response(StatusCode::BAD_REQUEST, json!({ "error": "password" }), &[]),
        ReauthCheck::Verify(pw) => match reauth_verdict(vault_proxy::verify_master(pw).await) {
            ReauthVerdict::Issue => {}
            ReauthVerdict::Wrong(server_lock) => return unlock_fail(auth, &device, now, server_lock),
            ReauthVerdict::Limited(left) => {
                return json_response(StatusCode::TOO_MANY_REQUESTS, json!({ "error": "limited", "retryAfterMs": left }), &[])
            }
            ReauthVerdict::Server => return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "server" }), &[]),
        },
    }
    let ticket = {
        let mut st = auth.lock();
        if has_master {
            st.unlock_succeeded(&device);
        }
        st.issue_reauth(&session, &b.cmd, Instant::now())
    };
    match ticket {
        Some(t) => json_response(StatusCode::OK, json!({ "ticket": t.as_str() }), &[]),
        None => json_response(StatusCode::UNAUTHORIZED, json!({ "error": "session" }), &[]),
    }
}

fn lock(app: &AppHandle, auth: &Arc<Auth>, headers: &HeaderMap) -> Response<Full<Bytes>> {
    let closed = cookie(headers, SESSION_COOKIE).and_then(|t| {
        let mut st = auth.lock();
        let device = st.session_device(t);
        st.close_session(t).then_some(device).flatten()
    });
    if let Some(device) = closed {
        eprintln!("[aynx] 원격 관문: 원격 세션 잠김");
        let name = auth.lock().device_name(&device);
        super::activity::record(super::activity::Kind::Locked, &device, &name);
        sessions_changed(app, auth);
    }
    json_response(StatusCode::OK, json!({ "ok": true }), &[clear_session_cookie()])
}
