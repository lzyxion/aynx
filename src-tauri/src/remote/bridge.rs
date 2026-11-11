//! **원격 창 다리**(R1a-3 — 설계 14.1·14.3) — 원격 브라우저의 `invoke`·`Channel`·이벤트를 Tauri 자신의 IPC 길에 잇는다.
//!
//! - ws 연결 하나 = **숨은 `WebviewWindow` 하나**(`remote-<기기>-<세대>` — `about:blank` · 보이지 않음 · 작업 표시줄 없음 · 포커스 없음).
//!   **연결마다** 하나다(기기마다가 아니다): 같은 기기의 탭 둘은 창 둘이고, 새로 고침은 새 창(새 세대)이다 — 라벨이 페이지 수명과
//!   같아서 옛 페이지의 늦은 Channel·이벤트가 새 페이지로 새지 않는다. 숨은 창은 앱 프런트를 돌리지 않는다(빈 쪽) — 목적은 라벨과
//!   `Webview` 손잡이뿐이다. 비용은 렌더러 하나(≈50MB · 유휴 CPU 0 — 스파이크 14.2). 연결이 끝나면 리스너를 모두 걷고 창을 부순다.
//! - **이 파일이 `InvokeRequest`·`Webview::on_message` 를 쓰는 유일한 곳이다.** `InvokeRequest` 는 tauri 문서상 *"NOT part of the
//!   public stable API"* — tauri 를 올릴 때 여기와 `remote::tests` 의 통합 시험(`bridge_*`)부터 본다. 키는 `AppHandle::invoke_key()`
//!   (**절대 브라우저로 내보내지 않는다**), URL 은 앱 자신의 출처(→ `Origin::Local` — 앱 명령은 ACL 을 안 본다. 그래서 **앱 명령의 문은
//!   [`invoke`] 첫머리의 [`admit`] 하나**다 — `remote/deny.rs` 의 표 넷 + 재확인 표 소비 + `save_settings` 칸 단위 문). 플러그인·core
//!   명령은 [`admit`] 을 그냥 지나 ACL 을 본다 — `capabilities/remote.json`(`remote-*`)은 이벤트
//!   `emit`·`emit_to` 와 `path` 만 연다. 나머지 플러그인은 `polyfill.js` 가 브라우저 쪽에서 대신하거나 거절한다(이중 문).
//! - **이벤트 문**(R1a-5): 원격의 `plugin:event|emit`·`emit_to` 는 ACL 을 지나도 [`admit_event`] 가 이벤트 이름으로 거른다 —
//!   `deny::REMOTE_EMIT` 넷만(집 PC 창의 리스너가 받는 순간 집 PC 전용 일을 하는 이벤트를 원격이 낼 수 없게).
//! - 응답: 우리가 넘긴 responder 가 `InvokeResponse` 를 직접 받는다(JS 를 거치지 않는다). **responder 가 불리지 않고 버려지면**(틀린
//!   키·명령이 끝나지 않고 버려짐) [`Reply`] 의 `Drop` 이 오류 응답을 보낸다 — 원격 쪽 promise 가 영영 매달리지 않게.
//! - 동기 명령은 **부른 스레드에서** 돈다(스파이크 — 메인 스레드 아님) → 블로킹 풀에서 부른다(관문의 tokio 고리를 막지 않게).
//! - **Channel**: `lib.rs` Builder 의 [`channel_interceptor`] 가 `remote-` 라벨 웹뷰의 Channel 전송을 **모두** 가로채 그 연결의 ws 로
//!   보낸다(이진 · 세대 + 콜백 id + 순번 · 본문 종류 그대로 — ArrayBuffer 는 이진 그대로). 숨은 웹뷰로는 한 바이트도 가지 않는다.
//!   순서: Tauri 가 순번을 매긴 뒤 가로채기를 부르고, 받는 쪽 `@tauri-apps/api` `Channel` 이 순번으로 다시 줄 세운다.
//!   **`end` 는 잃는다**: Channel 이 drop 될 때의 `{end:true}` 는 가로채기를 거치지 않고 숨은 웹뷰에 eval 로 간다(tauri `channel.rs`) —
//!   원격 페이지의 그 콜백은 페이지가 닫힐 때까지 표에 남는다(작은 누수 · 사용자 코드에는 `end` 를 받는 길이 없어 동작은 같다).
//! - **이벤트**: 원격 JS 의 `listen`/`unlisten` 은 Tauri 로 넘기지 않고 여기서 Rust 리스너로 대신 단다 — 대상 `Any` → `listen_any`,
//!   자기 라벨 → 숨은 창의 `listen`(창·웹뷰 이벤트), 다른 라벨 → 거절. 의미는 데스크톱 JS 리스너와 같다(같은 대상 판정 —
//!   `Any` 는 `emit_to("main")` 도 받는다 · 떼어 낸 창과 같음). 원격 JS 의 `emit`/`emitTo` 는 그대로 [`invoke`] — 출처 웹뷰 = 원격 창.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use serde_json::{Map, Value};
use tauri::http::{HeaderMap, HeaderName, HeaderValue};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, EventId, Listener, Runtime, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::mpsc;

use super::auth::Auth;
use super::deny::{self, Class};
use super::frames::{self, Encoded, ListenTarget};
use super::windows::is_remote_label;

/// 한 연결의 보내기 줄에 쌓일 수 있는 바이트 — 넘으면 그 연결을 끊는다(느린 폰이 GUI 메모리를 끝없이 먹지 않게 · 페이지가 다시 붙는다).
/// 터미널 출력은 ACK 크레딧이 이미 묶으므로 실사용에서 닿지 않는다.
const MAX_QUEUED: usize = 64 * 1024 * 1024;
/// 원격 브라우저가 실은 머리 상한(원시 본문 invoke).
const MAX_HEADERS: usize = 16;

/// 연결 하나의 보낼 것.
pub(crate) enum Out {
    Text(String),
    Binary(Vec<u8>),
    /// 이 까닭으로 닫는다(`bye` 를 보내고 닫는다).
    Close(&'static str),
}

/// 연결 하나의 보내기 손잡이 — 쌓인 바이트를 센다.
#[derive(Clone)]
pub(crate) struct Outbox {
    tx: mpsc::UnboundedSender<Out>,
    queued: Arc<AtomicUsize>,
}

impl Outbox {
    pub(crate) fn new() -> (Outbox, mpsc::UnboundedReceiver<Out>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Outbox {
                tx,
                queued: Arc::new(AtomicUsize::new(0)),
            },
            rx,
        )
    }

    fn push(&self, out: Out, len: usize) {
        if self.queued.fetch_add(len, Ordering::SeqCst) + len > MAX_QUEUED {
            let _ = self.tx.send(Out::Close("slow"));
            return;
        }
        let _ = self.tx.send(out);
    }

    pub(crate) fn text(&self, s: String) {
        let n = s.len();
        self.push(Out::Text(s), n);
    }

    pub(crate) fn binary(&self, b: Vec<u8>) {
        let n = b.len();
        self.push(Out::Binary(b), n);
    }

    pub(crate) fn close(&self, reason: &'static str) {
        let _ = self.tx.send(Out::Close(reason));
    }

    /// 보내기를 마친 프레임의 바이트를 덜어 낸다(ws 쓰기 쪽이 부른다).
    pub(crate) fn sent(&self, len: usize) {
        self.queued.fetch_sub(len, Ordering::SeqCst);
    }
}

/// 살아 있는 원격 창 하나.
struct Conn {
    gen: u64,
    out: Outbox,
    /// 이 연결이 단 Rust 리스너 — 끝날 때 모두 걷는다.
    listeners: Vec<EventId>,
}

/// 라벨 → 연결. 가로채기(아무 스레드)와 ws 태스크가 같이 본다.
static CONNS: LazyLock<Mutex<HashMap<String, Conn>>> = LazyLock::new(Mutex::default);

fn conns() -> std::sync::MutexGuard<'static, HashMap<String, Conn>> {
    CONNS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 지금 살아 있는 원격 창 수(시험·진단).
#[allow(dead_code)]
pub(crate) fn live() -> usize {
    conns().len()
}

/// 앱 자신의 출처 — `on_message` 가 `Origin::Local` 로 보게. Windows(·Android)는 `http://tauri.localhost`, 나머지는 `tauri://localhost`
/// (tauri `tauri_protocol_url` 과 같은 규칙 — OS 를 타는 곳은 이 함수 하나).
fn local_url() -> tauri::Url {
    #[cfg(any(windows, target_os = "android"))]
    let s = "http://tauri.localhost/";
    #[cfg(not(any(windows, target_os = "android")))]
    let s = "tauri://localhost/";
    tauri::Url::parse(s).expect("고정 URL")
}

/// 숨은 창을 만든다 — 블로킹 풀에서(창 생성은 이벤트 고리에 맡기고 기다린다). 이미 그 라벨이 있으면 실패.
pub(crate) async fn open_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<WebviewWindow<R>, String> {
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let url = WebviewUrl::External(tauri::Url::parse("about:blank").map_err(|e| e.to_string())?);
        WebviewWindowBuilder::new(&app, &label, url)
            .title("Aynx remote")
            .visible(false)
            .skip_taskbar(true)
            .focused(false)
            .decorations(false)
            .build()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 연결을 표에 올린다(이 뒤로 가로채기가 이 연결로 보낸다).
pub(crate) fn register(label: &str, gen: u64, out: Outbox) {
    conns().insert(
        label.to_string(),
        Conn {
            gen,
            out,
            listeners: Vec::new(),
        },
    );
}

/// 연결이 끝났다 — 표에서 빼고, 리스너를 모두 걷고, 숨은 창을 부순다(이미 부서졌으면 그대로).
pub(crate) fn unregister<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, label: &str) {
    let removed = conns().remove(label);
    if let Some(conn) = removed {
        for id in conn.listeners {
            app.unlisten(id);
        }
    }
    let _ = window.destroy();
}

/// 숨은 창이 밖에서 부서졌다(GUI 종료 등 — `lib.rs` 창 파괴 훅) — 그 연결을 닫게 한다.
pub(crate) fn window_gone(label: &str) {
    if let Some(conn) = conns().get(label) {
        conn.out.close("window");
    }
}

/// 모든 원격 창을 닫게 한다 — 집 PC 창이 모두 사라지고 트레이도 없을 때(숨은 창만 남아 Tauri 가 끝나지 않는 일을 막는다).
pub(crate) fn close_all() {
    for conn in conns().values() {
        conn.out.close("app");
    }
}

/// **Builder 의 Channel 가로채기**(`lib.rs` 에 한 줄) — `remote-` 라벨 웹뷰의 Channel 전송은 모두 여기서 끝난다(`true` = 소비).
/// 연결이 이미 없으면 버린다(숨은 웹뷰로 eval 하지 않는다). 다른 창은 손대지 않는다(`false`).
pub(crate) fn channel_interceptor<R: Runtime>(
    webview: &Webview<R>,
    callback: CallbackFn,
    index: usize,
    body: &InvokeResponseBody,
) -> bool {
    let label = webview.label();
    if !is_remote_label(label) {
        return false;
    }
    let target = conns().get(label).map(|c| (c.gen, c.out.clone()));
    if let Some((gen, out)) = target {
        out.binary(frames::channel(gen, callback.0, index, body));
    }
    true
}

/// 응답 하나의 몫 — 불리면 응답을, **불리지 않고 버려지면 오류를** 보낸다.
pub(crate) struct Reply {
    id: u32,
    out: Outbox,
    done: bool,
}

impl Reply {
    #[cfg(test)]
    pub(crate) fn for_test(id: u32, out: &Outbox) -> Reply {
        Reply {
            id,
            out: out.clone(),
            done: false,
        }
    }

    fn fail(mut self, why: String) {
        self.done = true;
        self.out.text(frames::res_err(self.id, &Value::String(why)));
    }

    fn send(mut self, response: &InvokeResponse) {
        self.done = true;
        match frames::response(self.id, response) {
            Encoded::Text(t) => self.out.text(t),
            Encoded::Binary(b) => self.out.binary(b),
        }
    }
}

impl Drop for Reply {
    fn drop(&mut self) {
        if !self.done {
            self.out.text(frames::res_err(
                self.id,
                &Value::String("응답 없이 끝났습니다 — invoke dropped".into()),
            ));
        }
    }
}

/// 원격 브라우저가 실은 머리 → `HeaderMap`. 이름·값이 이상한 것과 상한 넘는 것은 버린다.
pub(crate) fn headers_from(map: &Map<String, Value>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (k, v) in map.iter().take(MAX_HEADERS) {
        let (Ok(name), Some(value)) = (HeaderName::from_bytes(k.as_bytes()), v.as_str()) else {
            continue;
        };
        if let Ok(value) = HeaderValue::from_str(value) {
            headers.insert(name, value);
        }
    }
    headers
}

/// 원격 invoke 를 보낸 쪽 — 재확인 표를 소비할 세션과, 프레임에 실려 온 표.
pub(crate) struct Caller<'a> {
    pub auth: &'a Auth,
    pub session: &'a [u8; 32],
    /// `{t:"invoke", …, reauth}` — 폴리필이 `POST /remote/reauth` 로 받은 1회용 표. 원시(이진) invoke 에는 없다.
    pub reauth: Option<&'a str>,
}

/// **원격 창의 문**(R1a-4 — `deny.rs`). `Err(문구)` 면 그 invoke 는 Tauri 에 닿지 않는다. `plugin:*` 는 ACL 몫이라 지나간다
/// (`capabilities/remote.json` — 실측으로 확인, `deny.rs` 머리말). 재확인 명령은 표가 이 세션·이 명령의 것일 때만 — 표는 맞든
/// 틀리든 여기서 끝난다(한 번).
pub(crate) fn admit(cmd: &str, caller: &Caller<'_>) -> Result<(), String> {
    if cmd.starts_with("plugin:") {
        return Ok(());
    }
    match deny::class_of(cmd) {
        Class::Allow => Ok(()),
        Class::HomeOnly => Err(deny::home_only_message(&deny::command_label(cmd))),
        Class::Unsupported => Err(deny::unsupported_message(cmd)),
        Class::Unknown => Err(deny::unknown_message(cmd)),
        Class::Reauth => {
            // 표를 쓰고(맞든 틀리든 끝) 맞았으면 그 기기를 찾아 기록에 한 줄(R4 — 일의 이름만 · 값·인자 없음). 서버의 판정
            // (만료·상한·정책·권한)은 이 뒤 명령 몸이 그대로 한다 — 여기는 "어느 기기가 재확인하고 보냈나" 만.
            let who = caller.reauth.and_then(|t| {
                let mut st = caller.auth.lock();
                if !st.take_reauth(t, caller.session, cmd, Instant::now()) {
                    return None;
                }
                let device = st.session_key_device(caller.session).unwrap_or_default();
                let name = st.device_name(&device);
                Some((device, name))
            });
            match who {
                Some((device, name)) => {
                    super::activity::record_with(super::activity::Kind::Reauthorized, &device, &name, &deny::command_label(cmd));
                    Ok(())
                }
                None => Err(deny::reauth_message()),
            }
        }
    }
}

/// **원격 창의 이벤트 문**(R1a-5 — `deny.rs` 머리말 "이벤트 문"). `plugin:event|emit`·`emit_to` 는 ACL 이 열어 두었으므로 여기서
/// **이벤트 이름**으로 거른다 — [`deny::REMOTE_EMIT`] 만 지나간다(기본 거절). 다른 명령은 그대로 `Ok`. 몸을 못 읽으면 거절.
pub(crate) fn admit_event(cmd: &str, body: &InvokeBody) -> Result<(), String> {
    if cmd != "plugin:event|emit" && cmd != "plugin:event|emit_to" {
        return Ok(());
    }
    let event = match body {
        InvokeBody::Json(args) => args.get("event").and_then(Value::as_str).unwrap_or(""),
        InvokeBody::Raw(_) => "",
    };
    if deny::emit_allowed(event) {
        Ok(())
    } else {
        Err(deny::emit_message(event))
    }
}

/// `save_settings` 의 칸 단위 문 — 지금 저장된 설정과 견준다(**블로킹** — 파일을 읽는다). 몸을 못 읽으면 닫히는 쪽(거절).
fn admit_settings(body: &InvokeBody) -> Result<(), String> {
    let refuse = || deny::unknown_message(deny::SAVE_SETTINGS);
    let InvokeBody::Json(args) = body else {
        return Err(refuse());
    };
    let incoming = args
        .get("settings")
        .cloned()
        .and_then(|v| serde_json::from_value::<crate::settings::AppSettings>(v).ok())
        .ok_or_else(refuse)?;
    let (current, next) = crate::settings::current_and_sanitized(incoming);
    match deny::settings_home_only(&current, &next, crate::instance::DEV) {
        Some(why) => Err(why),
        None => Ok(()),
    }
}

/// **원격 invoke 한 번** — 문([`admit`])을 지나면 숨은 창의 웹뷰로 Tauri IPC 에 넣는다(블로킹 풀). 응답은 그 연결의 ws 로.
#[allow(clippy::too_many_arguments)]
pub(crate) fn invoke<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    id: u32,
    cmd: String,
    body: InvokeBody,
    headers: HeaderMap,
    out: &Outbox,
    caller: &Caller<'_>,
) {
    if let Err(why) = admit(&cmd, caller).and_then(|()| admit_event(&cmd, &body)) {
        eprintln!("[aynx] 원격 창: 거절 — {cmd}");
        out.text(frames::res_err(id, &Value::String(why)));
        return;
    }
    dispatch(app, window, id, cmd, body, headers, out);
}

/// 시험 전용 — 문 없이 넣는다(시험 명령 `rt_*` 은 분류 표에 없다).
#[cfg(test)]
pub(crate) fn invoke_ungated<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    id: u32,
    cmd: String,
    body: InvokeBody,
    headers: HeaderMap,
    out: &Outbox,
) {
    dispatch(app, window, id, cmd, body, headers, out);
}

/// 문을 지난 invoke 를 Tauri IPC 에 넣는다 — **[`invoke`] 밖에서 부르지 않는다**(시험만 [`invoke_ungated`]).
/// `save_settings` 는 블로킹 풀 안에서 칸 단위 문([`admit_settings`])을 먼저 본다.
fn dispatch<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    id: u32,
    cmd: String,
    body: InvokeBody,
    headers: HeaderMap,
    out: &Outbox,
) {
    let settings_gate = cmd == deny::SAVE_SETTINGS;
    let request = InvokeRequest {
        cmd,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: local_url(),
        body,
        headers,
        invoke_key: app.invoke_key().to_string(),
    };
    let reply = Reply {
        id,
        out: out.clone(),
        done: false,
    };
    let webview: Webview<R> = window.as_ref().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if settings_gate {
            if let Err(why) = admit_settings(&request.body) {
                eprintln!("[aynx] 원격 창: 설정 저장 거절(집 PC 전용 칸)");
                reply.fail(why);
                return;
            }
        }
        webview.on_message(
            request,
            Box::new(move |_webview, _cmd, response, _callback, _error| reply.send(&response)),
        );
    });
}

/// 원격 JS 의 `listen` — Rust 리스너를 대신 단다. 리스너 id(= JS 의 eventId)를 돌려준다.
pub(crate) fn listen<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    event: &str,
    target: &Value,
    handler: u32,
) -> Result<EventId, String> {
    if !frames::valid_event_name(event) {
        return Err(format!("이벤트 이름이 올바르지 않습니다: {event}"));
    }
    let label = window.label().to_string();
    let Some(out) = conns().get(&label).map(|c| c.out.clone()) else {
        return Err("원격 창이 닫혔습니다".into());
    };
    let name = event.to_string();
    let relay = move |e: tauri::Event| out.text(frames::event(handler, &name, e.id(), e.payload()));
    let id = match frames::listen_target(target, &label) {
        ListenTarget::Any => app.listen_any(event, relay),
        ListenTarget::Own => window.listen(event, relay),
        ListenTarget::Other => return Err("원격 창은 다른 창 대상의 이벤트를 들을 수 없습니다".into()),
    };
    match conns().get_mut(&label) {
        Some(conn) => conn.listeners.push(id),
        None => {
            app.unlisten(id);
            return Err("원격 창이 닫혔습니다".into());
        }
    }
    Ok(id)
}

/// 원격 JS 의 `unlisten` — **이 연결이 단 리스너만** 걷는다(남의 id 를 걷지 못하게).
pub(crate) fn unlisten<R: Runtime>(app: &AppHandle<R>, label: &str, id: EventId) {
    let owned = conns().get_mut(label).is_some_and(|c| {
        let before = c.listeners.len();
        c.listeners.retain(|l| *l != id);
        c.listeners.len() != before
    });
    if owned {
        app.unlisten(id);
    }
}
