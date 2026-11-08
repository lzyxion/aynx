//! **집 PC 화면 배치 거울**(원격 웹 R2-B — 설계 5절) — 원격 창은 집 PC **주 창의 워크스페이스들**(탭 줄 · 타일 트리 · 포커스 타일 —
//! 10-20 부터 지금 것만이 아니라 전부 · 어느 것을 볼지는 원격 창 몫이고 집 PC 화면은 움직이지 않는다)을 그대로 그린다. 출처는 하나:
//! 주 창 웹뷰가 탭·트리가 바뀔 때마다(100ms 디바운스) [`mirror_publish`] 로 스냅숏을 올리고, GUI 는 마지막 한 장만 쥐고
//! 원격 창들에 이벤트 [`MIRROR_EVENT`] 로 방송한다. 원격 창은 붙을 때 [`mirror_get`] 으로 받아 간다.
//!
//! 불변식:
//! - **쓰는 쪽은 집 PC 주 창 하나**(라벨 `main`) — 다른 창(보조 · 떼어 낸 창 · 원격)이 부르면 거절한다. 원격 창 분류도 집 PC 전용
//!   (`deny::HOME_ONLY`) — 원격이 가짜 배치를 다른 원격에 흘리지 못하게.
//! - **스냅숏은 프런트가 걸러 만든다**(`src/lib/mirror/snapshot.ts` — 허용 칸만: 종류 · 별칭 · 스트림 · 경로 · 화면 주소). 1회용 실행
//!   재료(`autorun`·`cwd`·`setup`·`worktree`·`restore` 버퍼 · MCP 토큰 표식 · 조정자 Run)는 싣지 않는다. 여기서는 모양을 보지 않고
//!   (불투명 JSON) **크기 상한**([`MAX_BYTES`])만 지킨다. 값(비밀)은 애초에 탭 명세에 없다(볼트 · 토큰은 프런트에 오지 않는다).
//! - 주 창이 **부서지면**(트레이로 · 앱 끝) 스냅숏을 비우고 `null` 을 방송한다 — 원격은 `workspaces.json`(주 범위)을 읽어 읽기 전용으로
//!   그린다(그 경로는 프런트 `app/mirror.svelte.ts`). 주 창 **리로드**는 비우지 않는다 — 새 페이지가 곧 다시 올린다(원격이 깜빡이지 않게).
//! - 방송은 원격 창(`remote-*`)만 겨눈다. 집 PC 창의 프런트는 이 이벤트를 듣지 않는다(원격만 `isRemote` 에서 건다).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use tokio::sync::oneshot;

use super::windows::is_remote_label;

/// 원격 창에 내는 이벤트 — 몸은 스냅숏(없으면 `null`).
pub(crate) const MIRROR_EVENT: &str = "mirror-layout";

/// 스냅숏 상한(직렬화 바이트) — 탭 수십 개 · 쿼리 초안까지 넉넉하다. 넘으면 거절(원격은 옛 장을 그대로 본다).
pub(crate) const MAX_BYTES: usize = 2 * 1024 * 1024;

/// 쓰는 창.
const PUBLISHER: &str = "main";

static LATEST: Mutex<Option<Value>> = Mutex::new(None);

fn latest() -> std::sync::MutexGuard<'static, Option<Value>> {
    LATEST.lock().unwrap_or_else(|e| e.into_inner())
}

/// 올리기를 받을까 — 순수. 주 창만, 객체만, 상한 안에서.
pub(crate) fn admit(label: &str, snapshot: &Value, bytes: usize) -> Result<(), String> {
    if label != PUBLISHER {
        return Err(format!("[mirror-publisher] only the home main window publishes the layout (got {label})"));
    }
    if !snapshot.is_object() {
        return Err("[mirror-shape] snapshot must be an object".into());
    }
    if bytes > MAX_BYTES {
        return Err(format!("[mirror-too-large] {bytes} bytes > {MAX_BYTES}"));
    }
    Ok(())
}

fn broadcast(app: &AppHandle, body: &Value) {
    let _ = app.emit_filter(MIRROR_EVENT, body.clone(), |t| match t {
        EventTarget::Window { label } | EventTarget::Webview { label } | EventTarget::WebviewWindow { label } => {
            is_remote_label(label)
        }
        _ => false,
    });
}

/// **집 PC 주 창이 배치를 올린다** — 마지막 한 장을 쥐고 원격 창들에 방송한다. 주 창 말고는 거절(원격은 `deny::HOME_ONLY`).
#[tauri::command]
pub async fn mirror_publish(app: AppHandle, window: tauri::Window, snapshot: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(&snapshot).map(|v| v.len()).unwrap_or(usize::MAX);
    admit(window.label(), &snapshot, bytes)?;
    *latest() = Some(snapshot.clone());
    broadcast(&app, &snapshot);
    Ok(())
}

/// **지금 배치**(원격 창이 붙을 때) — 집 PC 주 창이 없으면(트레이) `null` — 그때 원격은 `workspaces.json` 을 읽는다.
#[tauri::command]
pub async fn mirror_get() -> Option<Value> {
    latest().clone()
}

/// 주 창이 부서졌다(`lib.rs` 의 창 파괴) — 스냅숏을 비우고 원격에 `null` 을 알린다. 배치 요청 채널도 거두고 기다리던 요청은
/// "주 창 없음" 으로 끝낸다(R3).
pub(crate) fn main_window_gone(app: &AppHandle, label: &str) {
    if label != PUBLISHER {
        return;
    }
    inbox().take();
    pending().clear(); // 보내는 쪽을 버리면 기다리던 `mirror_request` 가 `[mirror-no-home]` 으로 끝난다
    if latest().take().is_some() {
        broadcast(app, &Value::Null);
    }
}

// ---------------------------------------------------------------------------
// R3 — 원격의 배치 바꾸기 요청
// ---------------------------------------------------------------------------
//
// 원격 창은 제 탭을 바꾸지 않는다 — 배치 조작(새 탭 · 분할 · 타일 열기 · 닫기 · 옮기기 · 이름 바꾸기)은 [`mirror_request`] 로 **요청**하고,
// GUI 는 집 PC **주 창에만** 연 채널([`mirror_request_inbox`] — 원격 창이 `listen_any` 로 엿들을 수 있는 이벤트를 쓰지 않는다)로 넘긴다.
// 주 창이 제 함수로 적용하고 [`mirror_respond`] 로 답하면 그 답이 원격의 invoke 결과가 된다. 결과 배치는 평소의 거울 방송으로 돌아간다
// (쓰기 주인은 늘 주 창 하나 — `workspaces.json` 쓰기 임대 규칙 그대로).
//
// - 종류는 [`LayoutRequest`] 하나로 고정이다(serde 태그 enum · 모르는 종류·칸은 거절 — 프런트 `src/lib/mirror/request.ts` 의
//   `LAYOUT_OPS` 와 짝). 대상은 집 PC 의 타일·탭 열쇠(`k:<tileKey>` · `i:<id>`)이고, 있는지는 주 창이 본다(없으면 `[mirror-missing]`).
// - 남용 방지: 원격 창마다 [`RATE_WINDOW`] 에 [`RATE_MAX`] 개 · 몸 [`REQUEST_MAX_BYTES`] · 기다리는 요청 [`MAX_PENDING`] · 답을
//   [`REQUEST_TIMEOUT`] 까지만 기다린다.
// - 주 창이 없으면(트레이) `[mirror-no-home]` — 주 창을 몰래 띄우지 않는다. 주 창이 리로드 중이면 새 페이지가 채널을 다시 열 때까지
//   요청은 시간 초과로 끝난다.
// - 레이아웃 조작은 재확인(REAUTH) 대상이 아니다(권한 B — 원격 창 ≈ 집 PC 창). 세션을 끝내는 닫기의 확인은 요청한 원격 쪽이 묻는다.

/// 요청 몸 상한(직렬화 바이트) — 새 타일 명세(쿼리 초안 포함)까지.
pub(crate) const REQUEST_MAX_BYTES: usize = 256 * 1024;
/// 주 창의 답을 기다리는 시간.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/// 빈도 상한 — 원격 창마다 이 시간에 [`RATE_MAX`] 개.
pub(crate) const RATE_WINDOW: Duration = Duration::from_secs(1);
pub(crate) const RATE_MAX: usize = 10;
/// 한꺼번에 기다리는 요청 상한(모든 원격 합).
pub(crate) const MAX_PENDING: usize = 32;
/// 열쇠 · 이름 · 탭 수 상한 — 프런트 `mirror/request.ts` 와 같은 값.
const MAX_KEY: usize = 256;
const MAX_NAME: usize = 200;
const MAX_TABS: usize = 64;
const MAX_PATH: usize = 4096;
/// 아이콘 크기 단계의 끝 — 프런트 `session/spec.ts` 의 `FILE_ZOOM_MAX` 와 같은 값.
const FILE_ZOOM_MAX: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SplitDir {
    Row,
    Col,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Side {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FocusDir {
    Left,
    Right,
    Up,
    Down,
}

type Pane = Map<String, Value>;

/// **배치 바꾸기 요청의 허용 목록**(R3) — 프런트 `LayoutRequest` 와 같은 모양. 모르는 종류 · 모르는 칸은 역직렬화에서 거절된다.
/// 비어 있을 수 있는 칸(`title` 등)은 없으면 싣지 않는다 — `before` · `name`(tmux) 의 `null` 은 뜻이 있어 그대로 싣는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum LayoutRequest {
    NewTab {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pane: Option<Pane>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, rename = "projectFolder", skip_serializing_if = "Option::is_none")]
        project_folder: Option<String>,
        #[serde(default, rename = "projectId", skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        /// 설 워크스페이스(원격 창이 보던 것) — 집 PC 가 보는 것과 다르면 주 창은 넣기만 하고 화면을 옮기지 않는다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace: Option<String>,
    },
    OpenPane {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        near: Option<String>,
        pane: Pane,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, rename = "projectId", skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
    },
    OpenBeside {
        tile: String,
        pane: Pane,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dir: Option<SplitDir>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        side: Option<Side>,
    },
    ReplaceTile {
        tile: String,
        pane: Pane,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    Split {
        tile: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dir: Option<SplitDir>,
    },
    TmuxTile {
        tile: String,
        name: Option<String>,
    },
    CloseTile {
        tile: String,
    },
    CloseTabs {
        tabs: Vec<String>,
    },
    RenameTab {
        tab: String,
        name: String,
    },
    ReorderTab {
        tab: String,
        before: Option<String>,
    },
    MoveTile {
        tile: String,
        target: String,
        dir: SplitDir,
        side: Side,
        /// 보던 탭을 그대로 둔다(세션 판 칸 끌기 · 2026-11-04) — `true` 만 뜻이 있다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stay: Option<bool>,
    },
    PromoteTile {
        tile: String,
        before: Option<String>,
    },
    MergeTab {
        tab: String,
        target: String,
        dir: SplitDir,
        side: Side,
    },
    SwapTile {
        tile: String,
        dir: FocusDir,
    },
    ExpandTile {
        tile: String,
        dir: FocusDir,
    },
    /// (오케스트레이션 탭) 원격 창에 그 탭이 없을 때 집 PC 가 앨범 탭(`runId`) · 홈을 연다 — 배치 요청 하나(새 Tauri 명령 아님 · 원격 관문 표 그대로).
    OpenOrchTab {
        #[serde(default, rename = "runId", skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace: Option<String>,
    },
    /// 파일 타일의 보기 설정(2026-11-04 — 원격 창의 토글을 집 PC 배치에 적는다 · 없으면 다음 거울 갱신에 되돌아간다). 화면을 옮기지 않는다.
    FileUi {
        tile: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        zoom: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        places: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preview: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hidden: Option<bool>,
    },
}

fn key_ok(k: &str) -> bool {
    !k.is_empty() && k.len() <= MAX_KEY && (k.starts_with("k:") || k.starts_with("i:"))
}

fn text_ok(s: &Option<String>, max: usize) -> bool {
    s.as_ref().is_none_or(|s| s.chars().count() <= max)
}

fn pane_ok(p: &Pane) -> bool {
    p.get("kind").and_then(Value::as_str).is_some_and(|k| !k.is_empty() && k.len() <= 32)
}

impl LayoutRequest {
    /// 칸 값 검사 — 열쇠 모양 · 길이 · 탭 수 · 타일 명세에 종류가 있는가.
    fn check(&self) -> bool {
        use LayoutRequest::*;
        match self {
            NewTab { pane, title, project_folder, project_id, workspace } => {
                pane.as_ref().is_none_or(pane_ok)
                    && text_ok(title, MAX_NAME)
                    && text_ok(project_folder, MAX_PATH)
                    && text_ok(project_id, MAX_KEY)
                    && workspace.as_deref().is_none_or(|w| !w.is_empty() && w.len() <= MAX_KEY)
            }
            OpenPane { tab, near, pane, title, project_id } => {
                tab.as_deref().is_none_or(key_ok)
                    && near.as_deref().is_none_or(key_ok)
                    && pane_ok(pane)
                    && text_ok(title, MAX_NAME)
                    && text_ok(project_id, MAX_KEY)
            }
            OpenBeside { tile, pane, .. } => key_ok(tile) && pane_ok(pane),
            ReplaceTile { tile, pane, title } => key_ok(tile) && pane_ok(pane) && text_ok(title, MAX_NAME),
            Split { tile, .. } | CloseTile { tile } | SwapTile { tile, .. } | ExpandTile { tile, .. } => key_ok(tile),
            TmuxTile { tile, name } => key_ok(tile) && text_ok(name, MAX_NAME),
            CloseTabs { tabs } => !tabs.is_empty() && tabs.len() <= MAX_TABS && tabs.iter().all(|t| key_ok(t)),
            RenameTab { tab, name } => key_ok(tab) && name.chars().count() <= MAX_NAME,
            ReorderTab { tab, before } => key_ok(tab) && before.as_deref().is_none_or(key_ok),
            PromoteTile { tile, before } => key_ok(tile) && before.as_deref().is_none_or(key_ok),
            MoveTile { tile, target, stay, .. } => key_ok(tile) && key_ok(target) && stay.is_none_or(|s| s),
            MergeTab { tab, target, .. } => key_ok(tab) && key_ok(target),
            OpenOrchTab { run_id, workspace } => [run_id, workspace]
                .iter()
                .all(|f| f.as_deref().is_none_or(|s| !s.is_empty() && s.len() <= MAX_KEY)),
            FileUi { tile, view, zoom, places, preview, hidden } => {
                key_ok(tile)
                    && view.as_deref().is_none_or(|v| matches!(v, "icons" | "compact" | "details"))
                    && zoom.is_none_or(|z| z <= FILE_ZOOM_MAX)
                    && (view.is_some() || zoom.is_some() || places.is_some() || preview.is_some() || hidden.is_some())
            }
        }
    }
}

/// 요청을 받을까 — 순수. 원격 창만 · 상한 안 · 허용 목록의 모양.
pub(crate) fn parse_request(label: &str, request: &Value, bytes: usize) -> Result<LayoutRequest, String> {
    if !is_remote_label(label) {
        return Err(format!("[mirror-requester] only remote windows send layout requests (got {label})"));
    }
    if bytes > REQUEST_MAX_BYTES {
        return Err(format!("[mirror-invalid] {bytes} bytes > {REQUEST_MAX_BYTES}"));
    }
    let req: LayoutRequest =
        serde_json::from_value(request.clone()).map_err(|e| format!("[mirror-invalid] {e}"))?;
    if !req.check() {
        return Err("[mirror-invalid] bad field".into());
    }
    Ok(req)
}

/// 원격 창마다 지난 [`RATE_WINDOW`] 의 요청 시각.
#[derive(Default)]
pub(crate) struct Rate {
    hits: HashMap<String, VecDeque<Instant>>,
}

impl Rate {
    /// 하나 더 받을까 — 받으면 센다.
    pub(crate) fn admit(&mut self, label: &str, now: Instant) -> bool {
        // 오래된 창의 줄은 가끔 걷는다(원격 창은 세대마다 새 라벨이다).
        if self.hits.len() > 64 {
            self.hits.retain(|_, q| q.back().is_some_and(|t| now.duration_since(*t) < RATE_WINDOW));
        }
        let q = self.hits.entry(label.to_string()).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= RATE_WINDOW) {
            q.pop_front();
        }
        if q.len() >= RATE_MAX {
            return false;
        }
        q.push_back(now);
        true
    }
}

/// 주 창의 답 글자 — 거절 머리(`[mirror-…]`)가 아니면 `invalid` 로 감싸고 길이를 자른다(원격 안내에 그대로 실린다).
pub(crate) fn respond_error(e: &str) -> String {
    let e: String = e.chars().take(300).collect();
    if e.starts_with("[mirror-") {
        e
    } else {
        format!("[mirror-invalid] {e}")
    }
}

/// 원격 창 라벨(`remote-<기기 id>-<세대>`) → 기기 id.
pub(crate) fn device_id_of(label: &str) -> Option<&str> {
    let rest = label.strip_prefix(super::windows::REMOTE_PREFIX)?;
    rest.rsplit_once('-').map(|(id, _)| id).filter(|id| !id.is_empty())
}

type Waiters = HashMap<u64, oneshot::Sender<Option<String>>>;

static INBOX: Mutex<Option<Channel<Value>>> = Mutex::new(None);
static PENDING: LazyLock<Mutex<Waiters>> = LazyLock::new(Default::default);
static RATE: LazyLock<Mutex<Rate>> = LazyLock::new(Default::default);
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn inbox() -> std::sync::MutexGuard<'static, Option<Channel<Value>>> {
    INBOX.lock().unwrap_or_else(|e| e.into_inner())
}

fn pending() -> std::sync::MutexGuard<'static, Waiters> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

fn device_name(app: &AppHandle, label: &str) -> String {
    let Some(id) = device_id_of(label) else { return String::new() };
    app.try_state::<super::Gateway>().map(|g| g.auth.lock().device_name(id)).unwrap_or_default()
}

/// **원격 창의 배치 바꾸기 요청**(R3 · 원격 허용) — 집 PC 주 창에 넘겨 답을 기다린다. 됐으면 `Ok`, 아니면 `[mirror-<사유>] …`
/// (`no-home` · `missing` · `elsewhere` · `cold` · `unsaved` · `dbtx` · `start` · `rate` · `busy` · `timeout` · `invalid`).
#[tauri::command]
pub async fn mirror_request(app: AppHandle, window: tauri::Window, request: Value) -> Result<(), String> {
    let label = window.label().to_string();
    let bytes = serde_json::to_vec(&request).map(|v| v.len()).unwrap_or(usize::MAX);
    let req = parse_request(&label, &request, bytes)?;
    if !RATE.lock().unwrap_or_else(|e| e.into_inner()).admit(&label, Instant::now()) {
        return Err("[mirror-rate] too many layout requests".into());
    }
    if app.get_webview_window(PUBLISHER).is_none() {
        return Err("[mirror-no-home] the home main window is closed".into());
    }
    let Some(channel) = inbox().clone() else {
        return Err("[mirror-no-home] the home main window is not listening".into());
    };
    let body = serde_json::json!({
        "id": 0,
        "device": device_name(&app, &label),
        "request": serde_json::to_value(&req).map_err(|e| format!("[mirror-invalid] {e}"))?,
    });
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = oneshot::channel();
    {
        let mut p = pending();
        if p.len() >= MAX_PENDING {
            return Err("[mirror-busy] too many pending layout requests".into());
        }
        p.insert(id, tx);
    }
    let mut body = body;
    body["id"] = Value::from(id);
    if channel.send(body).is_err() {
        pending().remove(&id);
        return Err("[mirror-no-home] the home main window is not listening".into());
    }
    match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
        Ok(Ok(None)) => Ok(()),
        Ok(Ok(Some(e))) => Err(e),
        Ok(Err(_)) => Err("[mirror-no-home] the home main window went away".into()),
        Err(_) => {
            pending().remove(&id);
            Err("[mirror-timeout] the home main window did not answer".into())
        }
    }
}

/// **집 PC 주 창이 배치 요청을 받는 채널을 연다**(R3 · 집 PC 전용) — 페이지를 다시 읽으면 새 채널로 갈아 끼운다.
#[tauri::command]
pub async fn mirror_request_inbox(window: tauri::Window, channel: Channel<Value>) -> Result<(), String> {
    if window.label() != PUBLISHER {
        return Err(format!("[mirror-publisher] only the home main window takes layout requests (got {})", window.label()));
    }
    *inbox() = Some(channel);
    Ok(())
}

/// **집 PC 주 창의 답**(R3 · 집 PC 전용) — `error` 가 없으면 적용됨. 모르는 id(이미 시간 초과)는 조용히 버린다.
#[tauri::command]
pub async fn mirror_respond(window: tauri::Window, id: u64, error: Option<String>) -> Result<(), String> {
    if window.label() != PUBLISHER {
        return Err(format!("[mirror-publisher] only the home main window answers layout requests (got {})", window.label()));
    }
    if let Some(tx) = pending().remove(&id) {
        let _ = tx.send(error.as_deref().map(respond_error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_main_window_publishes() {
        let s = json!({ "v": 1, "tabs": [] });
        assert!(admit("main", &s, 10).is_ok());
        for other in ["tear-3", "aux-1", "remote-abc-1", ""] {
            let e = admit(other, &s, 10).unwrap_err();
            assert!(e.starts_with("[mirror-publisher]"), "{other}: {e}");
        }
    }

    #[test]
    fn shape_and_size_are_bounded() {
        assert!(admit("main", &json!([1, 2]), 5).unwrap_err().starts_with("[mirror-shape]"));
        assert!(admit("main", &Value::Null, 4).unwrap_err().starts_with("[mirror-shape]"));
        let s = json!({});
        assert!(admit("main", &s, MAX_BYTES).is_ok());
        assert!(admit("main", &s, MAX_BYTES + 1).unwrap_err().starts_with("[mirror-too-large]"));
    }

    const R: &str = "remote-ab12-3";

    fn parse(v: Value) -> Result<LayoutRequest, String> {
        let n = serde_json::to_vec(&v).unwrap().len();
        parse_request(R, &v, n)
    }

    /// 프런트 `src/lib/mirror/request.ts` 의 `LAYOUT_OPS` 를 소스로 읽는다(두 목록이 짝인지 본다).
    fn front_ops() -> Vec<String> {
        let ts = include_str!("../../../src/lib/mirror/request.ts");
        let start = ts.find("export const LAYOUT_OPS = [").expect("LAYOUT_OPS") + "export const LAYOUT_OPS = [".len();
        let end = start + ts[start..].find("] as const").expect("LAYOUT_OPS 끝");
        ts[start..end].split(',').map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect()
    }

    #[test]
    fn every_front_op_parses_and_round_trips() {
        let samples = [
            json!({ "op": "newTab" }),
            json!({ "op": "newTab", "pane": { "id": "", "kind": "local", "cwd": "C:/w" }, "title": "t", "projectFolder": "C:/p", "projectId": "p1" }),
            json!({ "op": "newTab", "workspace": "ws-2" }),
            json!({ "op": "openPane", "tab": "k:tab1", "near": "i:pane-2", "pane": { "id": "", "kind": "sftp" } }),
            json!({ "op": "openBeside", "tile": "k:a", "pane": { "id": "", "kind": "local" }, "dir": "row", "side": "before" }),
            json!({ "op": "replaceTile", "tile": "k:a", "pane": { "id": "", "kind": "local" }, "title": "x" }),
            json!({ "op": "split", "tile": "k:a", "dir": "col" }),
            json!({ "op": "tmuxTile", "tile": "k:a", "name": null }),
            json!({ "op": "closeTile", "tile": "k:a" }),
            json!({ "op": "closeTabs", "tabs": ["k:t1", "i:tab-3"] }),
            json!({ "op": "renameTab", "tab": "k:t1", "name": "빌드" }),
            json!({ "op": "reorderTab", "tab": "k:t1", "before": null }),
            json!({ "op": "moveTile", "tile": "k:a", "target": "k:b", "dir": "row", "side": "after" }),
            json!({ "op": "moveTile", "tile": "k:a", "target": "k:b", "dir": "row", "side": "after", "stay": true }),
            json!({ "op": "promoteTile", "tile": "k:a", "before": "k:t2" }),
            json!({ "op": "mergeTab", "tab": "k:t1", "target": "k:b", "dir": "col", "side": "before" }),
            json!({ "op": "swapTile", "tile": "k:a", "dir": "left" }),
            json!({ "op": "expandTile", "tile": "k:a", "dir": "down" }),
            json!({ "op": "openOrchTab", "runId": "run-1", "workspace": "ws-2" }),
            json!({ "op": "fileUi", "tile": "k:a", "view": "icons", "zoom": 3, "places": false, "preview": true, "hidden": true }),
            json!({ "op": "fileUi", "tile": "k:a", "hidden": false }),
        ];
        let mut seen: Vec<String> = Vec::new();
        for s in &samples {
            let req = parse(s.clone()).unwrap_or_else(|e| panic!("{s}: {e}"));
            // 다시 실은 것이 받은 것과 같다(빈 칸은 싣지 않고 · `null` 의 뜻은 그대로).
            assert_eq!(serde_json::to_value(&req).unwrap(), *s, "{s}");
            seen.push(s["op"].as_str().unwrap().to_string());
        }
        seen.dedup();
        assert_eq!(seen, front_ops(), "프런트 LAYOUT_OPS 와 GUI LayoutRequest 가 어긋났다");
    }

    #[test]
    fn unknown_ops_fields_and_shapes_are_refused() {
        for bad in [
            json!({ "op": "runCommand", "tile": "k:a" }),
            json!({ "op": "closeTile" }),
            json!({ "op": "closeTile", "tile": "k:a", "extra": 1 }),
            json!({ "op": "closeTile", "tile": "pane-3" }),
            json!({ "op": "closeTile", "tile": "" }),
            json!({ "op": "closeTabs", "tabs": [] }),
            json!({ "op": "split", "tile": "k:a", "dir": "diag" }),
            json!({ "op": "openPane", "pane": [] }),
            json!({ "op": "openPane", "pane": { "id": "" } }),
            json!({ "op": "renameTab", "tab": "k:t", "name": "x".repeat(201) }),
            json!({ "op": "newTab", "workspace": "" }),
            json!({ "op": "openOrchTab", "runId": "" }),
            json!({ "op": "openOrchTab", "runId": "x", "tile": "k:a" }),
            json!({ "op": "newTab", "workspace": "w".repeat(257) }),
            json!({ "op": "moveTile", "tile": "k:a", "target": "k:b", "dir": "row", "side": "after", "stay": false }),
            json!({ "op": "fileUi", "tile": "k:a" }),
            json!({ "op": "fileUi", "tile": "pane-3", "hidden": true }),
            json!({ "op": "fileUi", "tile": "k:a", "view": "tree" }),
            json!({ "op": "fileUi", "tile": "k:a", "zoom": 5 }),
            json!({ "op": "fileUi", "tile": "k:a", "zoom": -1 }),
            json!({ "op": "fileUi", "tile": "k:a", "zoom": 1.5 }),
            json!({ "op": "fileUi", "tile": "k:a", "hidden": "yes" }),
            json!({ "op": "fileUi", "tile": "k:a", "hidden": true, "autorun": "rm" }),
            json!({ "tile": "k:a" }),
            json!("closeTile"),
        ] {
            let e = parse(bad.clone()).unwrap_err();
            assert!(e.starts_with("[mirror-invalid]"), "{bad}: {e}");
        }
        let many: Vec<String> = (0..65).map(|i| format!("k:{i}")).collect();
        assert!(parse(json!({ "op": "closeTabs", "tabs": many })).is_err());
        assert!(parse(json!({ "op": "closeTile", "tile": format!("k:{}", "a".repeat(300)) })).is_err());
    }

    #[test]
    fn only_remote_windows_request_and_size_is_bounded() {
        let v = json!({ "op": "closeTile", "tile": "k:a" });
        for home in ["main", "aux-1", "tear-2"] {
            assert!(parse_request(home, &v, 10).unwrap_err().starts_with("[mirror-requester]"), "{home}");
        }
        assert!(parse_request(R, &v, REQUEST_MAX_BYTES).is_ok());
        assert!(parse_request(R, &v, REQUEST_MAX_BYTES + 1).unwrap_err().starts_with("[mirror-invalid]"));
    }

    #[test]
    fn rate_is_per_window_and_slides() {
        let mut r = Rate::default();
        let t0 = Instant::now();
        for _ in 0..RATE_MAX {
            assert!(r.admit("remote-a-1", t0));
        }
        assert!(!r.admit("remote-a-1", t0), "넘치면 거절");
        assert!(r.admit("remote-b-1", t0), "다른 창은 따로");
        assert!(r.admit("remote-a-1", t0 + RATE_WINDOW), "창이 지나면 다시");
    }

    #[test]
    fn answers_and_labels() {
        assert_eq!(respond_error("[mirror-unsaved]"), "[mirror-unsaved]");
        assert_eq!(respond_error("boom"), "[mirror-invalid] boom");
        assert_eq!(respond_error(&"[mirror-x]".repeat(100)).chars().count(), 300);
        assert_eq!(device_id_of("remote-ab12cd-7"), Some("ab12cd"));
        assert_eq!(device_id_of("main"), None);
        assert_eq!(device_id_of("remote--7"), None);
    }
}
