//! **원격 웹 클라이언트 관문** — 다른 PC·폰 브라우저가 tailnet 너머로 이 GUI 에 닿는 문
//! (설계 docs/log/2026-10-15-remote-web-client-design.md 2·13·14절). R1a 1번 커밋: 리스너 + 정적 파일 + 문지기.
//!
//! ```text
//! [브라우저] ─HTTPS(*.ts.net)─▶ tailscale serve ─HTTP─▶ 127.0.0.1:<포트>  이 관문 (GUI 프로세스)
//! ```
//!
//! 불변식:
//! - **127.0.0.1 에만 묶는다.** tailnet 노출은 `tailscale serve --bg --https=443 http://127.0.0.1:<포트>` 가 하고(사용자가 직접 걸거나
//!   집 PC 설정 화면의 [연결] — `serve.rs`), TLS·인증서도 그쪽이다. 앱은 다른 인터페이스에 듣지 않는다(기존 "리스너는 루프백" 원칙 — `loopback_http`).
//! - **`Host` 는 설정한 `*.ts.net` 이름**(`[remote] host`)일 때만 받는다 — DNS 리바인딩 막기. `Origin` 이 있으면 그
//!   `https://<Host>` 와 같아야 한다 — CSRF 막기. 루프백 이름(`127.0.0.1:<포트>`·`localhost:<포트>`)은 **개발 빌드에서만**
//!   (로컬 시험용 — [`crate::instance::DEV`]). 판정은 `gateway::check_request` 하나.
//! - **Tailscale Funnel(공개 인터넷)이 이 포트를 내보내면 열지 않는다** — 켤 때와 도는 동안 60초마다 `tailscale funnel status --json`
//!   을 보고, 보이면 리스너를 닫는다(`funnel.rs`). CLI 가 없으면 열되 상태가 "확인 불가" 를 말한다.
//! - **신원은 페어링 토큰, 열림은 원격 가림막**(R1a-2 — `auth.rs`·`gate.rs`): 미페어링 브라우저는 페어링 쪽만, 페어링된 기기는
//!   원격 가림막 쪽만, 가림막을 걷은 기기만 앱 파일을 받는다. 페어링 [허용]은 **집 PC 주 창의 사람만**(이벤트 `remote-pair-request`
//!   → 모달 → `remote_pair_respond`). 원격 가림막을 걷는 것이 곧 볼트를 여는 것이다(`gate.rs` 머리말).
//! - **원격 창**(R1a-3): 열린 기기가 받는 앱 셸에는 관문이 **폴리필**(`/remote/polyfill.js` — `window.__TAURI_INTERNALS__` 를 세운다)을
//!   첫 스크립트로 끼우고, 페이지는 `/remote/ws` 로 붙는다. 연결 하나 = GUI 안의 숨은 창 하나(`remote-<기기>-<세대>`)이고, 원격의
//!   `invoke`·`Channel`·이벤트는 그 창을 통해 Tauri 자신의 IPC 로 간다(`ws.rs` · `bridge.rs` · `frames.rs`). 숨은 창은 **창으로 세지
//!   않는다** — 창을 세는 곳은 모두 [`home_windows`]/[`is_remote_label`] 를 거치고, 볼트 창 0개 셈에만 원격 창을 따로 더한다
//!   (`windows.rs`). `convertFileSrc` 는 `/remote/asset?path=` — 같은 Tauri asset 스코프를 다시 본다(설계 14.6).
//!   정적 파일은 exe 에 박힌 같은 빌드(`asset_resolver`)이고, 응답마다 `tauri.conf.json` 의 **같은 CSP** 를 헤더로 붙인다
//!   (출처 하나 — 런타임에 `app.config()` 에서 읽는다 · `static_files.rs`).
//! - GET 과, POST 는 `gate::POST_ROUTES` 다섯만(Origin 필수). GET 의 본문·`..` 경로·이상한 글자는 거절한다(개발 빌드의 자산은 디스크
//!   `build/` 를 읽으므로).
//! - **원격 권한 B(R1a-4 — `deny.rs`)**: 원격 창의 앱 명령은 모두 `deny.rs` 의 표 넷(집 PC 전용 · 재확인 · 미지원 · 허용 — 명시
//!   목록, 시험이 `generate_handler!` 와 맞춘다)을 지나야 Tauri 에 닿는다(`bridge::invoke`). 집 PC 전용 = 볼트 마스터 바꾸기·전체 삭제 ·
//!   `remote_pair_respond`·`remote_pair_pending` · `save_settings` 의 `[automation]`·원격 켜기·이름·포트(칸 단위). 원격 허용 =
//!   `remote_status`·`remote_devices_list`·`remote_device_revoke`(자기 기기 포함) · 원격 끄기. 재확인(승인·AI 권한)은
//!   `POST /remote/reauth` 의 1회용 표(`gate.rs` "재확인").
//!
//! 수명: setup 이 [`install`] 로 한 번 세우고, 설정 저장(`settings::save_settings`)이 [`sync`] 를 부른다 — `[remote]` 가 그대로면
//! 아무것도 하지 않고, 바뀌었으면 닫고 다시 연다. Funnel 이 보여 닫힌 뒤에는 다음 [`sync`](아무 설정 저장) 나 앱 재시작이 다시
//! 시도한다(시작할 때 Funnel 을 다시 본다).

mod activity;
mod auth;
mod bridge;
mod deny;
mod frames;
mod funnel;
mod gate;
mod gateway;
pub(crate) mod mirror;
pub(crate) mod serve;
mod static_files;
mod theme;
mod windows;
mod ws;
#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod bridge_tests;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager};

use auth::{Auth, DeviceInfo, PairNotice};

pub(crate) use bridge::{channel_interceptor, close_all as close_remote_windows, window_gone as remote_window_gone};
pub(crate) use mirror::main_window_gone as mirror_main_window_gone;
pub(crate) use windows::{has_home_window_except, home_windows, is_remote_label, remote_present, vault_lock_due};

use crate::i18n::tr;
use crate::settings::RemotePrefs;

/// 관문의 앱 전역 상태(`app.manage`).
pub(crate) struct Gateway {
    inner: Arc<Mutex<Inner>>,
    /// [`sync`] 요청 번호 — 늦게 끝난 옛 읽기가 새 설정을 덮지 않게.
    sync_seq: AtomicU64,
    /// 기기·페어링·원격 세션(R1a-2) — 관문을 다시 열어도 같은 한 벌(끄면 세션만 지운다).
    auth: Arc<Auth>,
}

#[derive(Default)]
struct Inner {
    /// 마지막으로 적용한 설정.
    applied: Option<Config>,
    /// 도는 관문을 닫는 손잡이(`true` 를 보내면 닫는다). `None` = 돌지 않음.
    stop: Option<tokio::sync::watch::Sender<bool>>,
    /// 관문 회차 — 옛 회차의 늦은 상태 갱신을 버린다.
    generation: u64,
    /// 마지막으로 적용한 [`sync`] 요청 번호.
    applied_seq: u64,
    status: RemoteStatus,
}

/// 해석이 끝난 `[remote]` — 기본 포트·이름 정리까지 마친 값.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Config {
    pub enabled: bool,
    pub port: u16,
    /// 받을 `*.ts.net` 이름(소문자). `None` = 미설정.
    pub host: Option<String>,
}

impl Config {
    /// 설정 칸 → 관문 설정. 포트를 안 정했으면 인스턴스 기본([`crate::instance::remote_port`]).
    pub(crate) fn from_prefs(prefs: &RemotePrefs, dev: bool) -> Self {
        Config {
            enabled: prefs.enabled.unwrap_or(false),
            port: prefs
                .port
                .filter(|p| *p != 0)
                .unwrap_or(crate::instance::remote_port(dev)),
            host: prefs
                .host
                .as_deref()
                .map(|h| h.trim().to_ascii_lowercase())
                .filter(|h| !h.is_empty()),
        }
    }
}

/// `remote_status` 가 돌려주는 한 벌 — 6번 커밋의 설정 화면·상태바가 그린다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    pub listening: bool,
    pub port: u16,
    /// 설정한 이름(미설정이면 빈 문자열).
    pub host: String,
    /// `off` · `on` · `unknown` — Funnel 이 이 포트를 공개 인터넷에 내보내는가.
    pub funnel: &'static str,
    /// `tailscale` CLI 를 찾았는가(R1a-5 — 설정 화면). `remote_status` 가 부를 때마다 본다(파일 있음 확인뿐).
    pub tailscale_cli: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for RemoteStatus {
    fn default() -> Self {
        RemoteStatus {
            enabled: false,
            listening: false,
            port: crate::instance::remote_port(crate::instance::DEV),
            host: String::new(),
            funnel: "unknown",
            tailscale_cli: false,
            error: None,
        }
    }
}

/// `*.ts.net` MagicDNS 이름 모양인가 — `<기기>.<tailnet>.ts.net`, 소문자·숫자·`-`·`.` 만, 빈 조각 없음.
pub(crate) fn valid_ts_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    host.len() <= 253
        && host.ends_with(".ts.net")
        && labels.len() >= 4
        && labels.iter().all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// setup 에서 한 번 — 상태를 세우고(기기 파일을 읽는다 — 작은 파일 하나) 저장된 설정대로 연다.
pub(crate) fn install(app: &AppHandle) {
    app.manage(Gateway {
        inner: Arc::default(),
        sync_seq: AtomicU64::new(0),
        auth: Arc::new(Auth::load(crate::instance::config_root())),
    });
    sync(app);
}

/// 저장된 `[remote]` 를 다시 읽어 맞춘다 — 같으면 그대로, 바뀌었으면 닫고 다시 연다. 어느 스레드에서 불러도 된다
/// (설정 읽기는 블로킹 풀, 적용은 잠금 하나 — 리스너는 tauri 의 tokio 런타임에서 돈다).
pub(crate) fn sync(app: &AppHandle) {
    let Some(gateway) = app.try_state::<Gateway>() else {
        return;
    };
    let seq = gateway.sync_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(prefs) = tauri::async_runtime::spawn_blocking(crate::settings::remote_prefs).await else {
            return;
        };
        apply(&app, seq, Config::from_prefs(&prefs, crate::instance::DEV));
    });
}

fn apply(app: &AppHandle, seq: u64, cfg: Config) {
    let Some(gateway) = app.try_state::<Gateway>() else {
        return;
    };
    let mut inner = gateway.inner.lock().unwrap_or_else(|e| e.into_inner());
    if seq < inner.applied_seq {
        return;
    }
    inner.applied_seq = seq;
    if inner.applied.as_ref() == Some(&cfg) && inner.stop.is_some() {
        return;
    }
    // 옛 관문을 닫는다(받는 쪽이 이미 끝났으면 보내기 실패는 무해하다).
    if let Some(stop) = inner.stop.take() {
        let _ = stop.send(true);
    }
    inner.generation += 1;
    inner.applied = Some(cfg.clone());
    // 끄면 열린 원격 세션을 모두 닫는다(기기는 남는다 — 다시 켜면 가림막부터).
    if !cfg.enabled && gateway.auth.lock().drop_sessions() > 0 {
        activity::record(activity::Kind::DisconnectedAll, "", "");
        gate::sessions_changed(app, &gateway.auth);
    }
    inner.status = RemoteStatus {
        enabled: cfg.enabled,
        listening: false,
        port: cfg.port,
        host: cfg.host.clone().unwrap_or_default(),
        funnel: "unknown",
        tailscale_cli: false,
        error: None,
    };
    if !cfg.enabled {
        return;
    }
    if let Some(error) = config_error(&cfg, crate::instance::DEV) {
        eprintln!("[aynx] 원격 관문: {error}");
        inner.status.error = Some(error);
        return;
    }
    let (stop, stopped) = tokio::sync::watch::channel(false);
    inner.stop = Some(stop);
    let generation = inner.generation;
    let handle = Handle {
        app: app.clone(),
        inner: Arc::clone(&gateway.inner),
        generation,
        auth: Arc::clone(&gateway.auth),
    };
    tauri::async_runtime::spawn(gateway::run(handle, cfg, stopped));
}

/// 켤 수 없는 설정이면 그 까닭. 릴리스는 이름이 있어야 하고, 개발 빌드는 이름 없이도 루프백 시험용으로 연다.
pub(crate) fn config_error(cfg: &Config, dev: bool) -> Option<String> {
    match cfg.host.as_deref() {
        None if dev => None,
        None => Some(tr!(
            ko: "받을 이름([remote] host — 내 *.ts.net 이름)이 없어 열지 않았습니다",
            en: "Not opened: no host name ([remote] host — your *.ts.net name)"
        )),
        Some(h) if !valid_ts_host(h) => Some(tr!(
            ko: "[remote] host 가 *.ts.net 이름이 아닙니다: {h}",
            en: "[remote] host is not a *.ts.net name: {h}",
            h = h
        )),
        Some(_) => None,
    }
}

/// 도는 관문 한 회차가 자기 상태를 고치는 손잡이 — 회차가 바뀌었으면 아무것도 하지 않는다.
#[derive(Clone)]
pub(crate) struct Handle {
    pub app: AppHandle,
    inner: Arc<Mutex<Inner>>,
    generation: u64,
    auth: Arc<Auth>,
}

impl Handle {
    /// 이 회차가 아직 현재일 때만 `f` 로 상태를 고친다. `stopped` 면 닫는 손잡이도 걷는다(다음 [`sync`] 가 다시 연다).
    pub(crate) fn update(&self, stopped: bool, f: impl FnOnce(&mut RemoteStatus)) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.generation != self.generation {
            return;
        }
        f(&mut inner.status);
        if stopped {
            inner.stop = None;
        }
    }
}

/// 관문 쪽 색(`/remote/theme.css`) — 집 PC 주 창이 칠한 원천 토큰의 계산값과 모드(`src/lib/gate-theme.ts`). **집 PC 전용**(`deny.rs` —
/// 원격 창은 이 기기 밝기 사본을 칠할 수 있다). 메모리만 · 허용 목록 밖 이름 · 나쁜 값은 버린다(`theme.rs`). 모드가 둘 밖이면 아무것도 안 바꾼다.
#[tauri::command]
pub async fn remote_gate_theme_set(mode: String, tokens: std::collections::HashMap<String, String>) -> Result<(), ()> {
    if let Some(t) = theme::build(&mode, &tokens) {
        theme::set(t);
    }
    Ok(())
}

/// 원격 관문 상태 — 메모리만 읽는다. **원격 허용**(`deny.rs` — 원격 화면이 자기 연결 상태를 그린다).
#[tauri::command]
pub async fn remote_status(state: tauri::State<'_, Gateway>) -> Result<RemoteStatus, ()> {
    let cli = tauri::async_runtime::spawn_blocking(|| funnel::tailscale_binary().is_some())
        .await
        .unwrap_or(false);
    let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let mut status = inner.status.clone();
    status.tailscale_cli = cli;
    Ok(status)
}

/// 이 PC 의 MagicDNS 이름(`tailscale status --json` 의 `Self.DNSName`) — 설정 화면의 [찾기](R1a-5). **집 PC 전용**(`deny.rs` —
/// 그 값이 켜기·이름 칸을 채운다. 집 PC 에서 `tailscale` 을 실행한다).
#[tauri::command]
pub async fn remote_detect_host() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(funnel::detect_host)
        .await
        .map_err(|e| e.to_string())?
}

/// 지금 열린(원격 가림막을 걷은) 원격 기기 수 — 상태바 "원격 접속 중" 의 원천. 바뀔 때마다 주 창에 이벤트
/// `remote-sessions {unlocked}` 가 간다(`gate::sessions_changed`). 볼트 창 0개 셈은 이것이 아니라 `windows.rs`(살아 있는 원격 창).
#[allow(dead_code)] // R1a 6번 커밋(상태바)이 부른다
pub(crate) fn unlocked_devices(app: &AppHandle) -> usize {
    app.try_state::<Gateway>()
        .map_or(0, |g| g.auth.lock().unlocked_devices(Instant::now()))
}

/// 집 PC 사람의 페어링 답([허용]·[거절]) — **집 PC 전용**(`deny.rs`). 6자리 코드를 견주는 것은 사람이다.
#[tauri::command]
pub async fn remote_pair_respond(
    app: AppHandle,
    state: tauri::State<'_, Gateway>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    let answered = state.auth.lock().pair_respond(&request_id, allow, Instant::now());
    let _ = app.emit_to("main", "remote-pair-closed", serde_json::json!({}));
    match answered {
        Ok(()) => {
            eprintln!("[aynx] 원격 관문: 페어링 {}", if allow { "허용" } else { "거절" });
            Ok(())
        }
        Err(()) => Err(tr!(
            ko: "페어링 요청이 이미 끝났거나 없습니다",
            en: "The pairing request has already ended or does not exist"
        )),
    }
}

/// 지금 답을 기다리는 페어링 요청(주 창이 새로 떴을 때 놓친 이벤트 대신) — **집 PC 전용**.
#[tauri::command]
pub async fn remote_pair_pending(state: tauri::State<'_, Gateway>) -> Result<Option<PairNotice>, ()> {
    Ok(state.auth.lock().pair_pending(Instant::now()))
}

/// 페어링된 기기 목록 — 해시 없이 id·이름·시각 + 지금 열림·붙은 원격 창 수(R1a-5). **원격 허용**(`deny.rs`).
#[tauri::command]
pub async fn remote_devices_list(state: tauri::State<'_, Gateway>) -> Result<Vec<DeviceInfo>, ()> {
    let live = activity::live();
    let mut st = state.auth.lock();
    let unlocked = st.unlocked_ids(Instant::now());
    Ok(st.list_with(&unlocked, &live))
}

/// 최근 원격 접속 기록(메모리 고리 — 새것이 앞 · 비밀 없음 · `activity.rs`). **원격 허용**.
#[tauri::command]
pub async fn remote_log() -> Result<Vec<activity::Entry>, ()> {
    Ok(activity::snapshot())
}

/// 기기 이름 바꾸기(R1a-5) — 제어 문자를 걷고 80자로 자른다. **원격 허용**(이름은 권한이 아니다 — 표시만).
#[tauri::command]
pub async fn remote_device_rename(
    app: AppHandle,
    state: tauri::State<'_, Gateway>,
    id: String,
    name: String,
) -> Result<(), String> {
    let changed = state.auth.lock().rename(&id, &name).map_err(|()| {
        tr!(
            ko: "기기 이름을 바꾸지 못했습니다 — 빈 이름이거나 없는 기기입니다",
            en: "Could not rename the device — the name is empty or the device is gone"
        )
    })?;
    if changed {
        let auth = Arc::clone(&state.auth);
        tauri::async_runtime::spawn_blocking(move || auth.persist_blocking())
            .await
            .map_err(|e| e.to_string())?;
        gate::activity_changed(&app, &state.auth);
    }
    Ok(())
}

/// **모두 끊기**(R1a-5 — 상태바 원격 칩) — 열린 원격 세션을 모두 닫는다(원격 창은 곧바로 닫히고 잠금 해제 쪽으로 돌아간다 ·
/// 기기는 남는다). 닫은 세션 수. **원격 허용**(좁히기만 한다 — 원격 끄기·기기 폐기와 같은 결).
#[tauri::command]
pub async fn remote_disconnect_all(app: AppHandle, state: tauri::State<'_, Gateway>) -> Result<usize, ()> {
    let n = state.auth.lock().drop_sessions();
    if n > 0 {
        eprintln!("[aynx] 원격 관문: 원격 세션 모두 끊음 — {n}");
        activity::record(activity::Kind::DisconnectedAll, "", "");
        gate::sessions_changed(&app, &state.auth);
    }
    Ok(n)
}

/// 기기를 폐기한다 — 그 기기의 원격 세션도 곧바로 닫는다(다음 요청부터 페어링 쪽). **원격 허용**(설계 7절 — 자기 기기 폐기).
#[tauri::command]
pub async fn remote_device_revoke(app: AppHandle, state: tauri::State<'_, Gateway>, id: String) -> Result<bool, String> {
    let name = state.auth.lock().device_name(&id);
    let removed = state.auth.lock().revoke(&id);
    if removed {
        activity::record(activity::Kind::Revoked, &id, &name);
        let auth = Arc::clone(&state.auth);
        tauri::async_runtime::spawn_blocking(move || auth.persist_blocking())
            .await
            .map_err(|e| e.to_string())?;
        eprintln!("[aynx] 원격 관문: 기기 폐기 — {id}");
        gate::sessions_changed(&app, &state.auth);
    }
    Ok(removed)
}
