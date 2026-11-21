//! 메인 PC 화면 배치 거울 — 원격 창은 메인 PC 주 창의 워크스페이스들을 그대로 그린다(어느 것을 볼지는 원격 창 몫 · 메인 PC 화면은 움직이지 않는다).
//!
//! 불변식:
//! - 쓰는 쪽은 메인 PC 주 창 하나(라벨 `main`) — 다른 창이 부르면 거절하고, 원격 분류도 메인 PC 전용(`deny::HOME_ONLY`)이다. 원격이 가짜 배치를
//!   다른 원격에 흘리지 못하게.
//! - 스냅숏은 프런트가 허용 칸만 걸러 만든다(`src/lib/mirror/snapshot.ts` — 1회용 실행 재료는 싣지 않는다). 여기서는 모양을 보지 않고 크기 상한만 지킨다.
//! - 주 창이 부서지면 스냅숏을 비우고 `null` 을 방송한다. 주 창 리로드는 비우지 않는다 — 새 페이지가 곧 다시 올린다(원격이 깜빡이지 않게).
//! - 방송은 원격 창(`remote-*`)만 겨눈다.

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

/// 몸은 스냅숏(없으면 `null`).
pub(crate) const MIRROR_EVENT: &str = "mirror-layout";

/// 직렬화 바이트. 넘으면 거절(원격은 옛 장을 그대로 본다).
pub(crate) const MAX_BYTES: usize = 2 * 1024 * 1024;

const PUBLISHER: &str = "main";

static LATEST: Mutex<Option<Value>> = Mutex::new(None);

fn latest() -> std::sync::MutexGuard<'static, Option<Value>> {
    LATEST.lock().unwrap_or_else(|e| e.into_inner())
}

/// 순수. 주 창만, 객체만, 상한 안에서.
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

/// 주 창 말고는 거절(원격은 `deny::HOME_ONLY`).
#[tauri::command]
pub async fn mirror_publish(app: AppHandle, window: tauri::Window, snapshot: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(&snapshot).map(|v| v.len()).unwrap_or(usize::MAX);
    admit(window.label(), &snapshot, bytes)?;
    *latest() = Some(snapshot.clone());
    broadcast(&app, &snapshot);
    Ok(())
}

/// 메인 PC 주 창이 없으면(트레이) `null` — 그때 원격은 `workspaces.json` 을 읽는다.
#[tauri::command]
pub async fn mirror_get() -> Option<Value> {
    latest().clone()
}

/// 주 창이 부서졌다 — 스냅숏을 비우고 원격에 `null` 을 알린다. 기다리던 배치 요청은 "주 창 없음" 으로 끝낸다.
pub(crate) fn main_window_gone(app: &AppHandle, label: &str) {
    if label != PUBLISHER {
        return;
    }
    inbox().take();
    pending().clear();
    if latest().take().is_some() {
        broadcast(app, &Value::Null);
    }
}

// ── 원격의 배치 바꾸기 요청 ──
//
// 원격 창은 제 탭을 바꾸지 않는다 — [`mirror_request`] 로 요청하고, GUI 는 메인 PC 주 창에만 연 채널로 넘긴다(원격 창이 `listen_any` 로
// 엿들을 수 있는 이벤트를 쓰지 않는다). 쓰기 주인은 늘 주 창 하나다.
// - 종류는 [`LayoutRequest`] 로 고정(모르는 종류 · 칸은 거절 — 프런트 `src/lib/mirror/request.ts` 의 `LAYOUT_OPS` 와 짝).
// - 주 창이 없으면 `[mirror-no-home]` — 주 창을 몰래 띄우지 않는다.
// - 레이아웃 조작은 재확인 대상이 아니다(권한 B). 세션을 끝내는 닫기의 확인은 요청한 원격 쪽이 묻는다.

/// 새 타일 명세(쿼리 초안 포함)까지.
pub(crate) const REQUEST_MAX_BYTES: usize = 256 * 1024;
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/// 원격 창마다 이 시간에 [`RATE_MAX`] 개.
pub(crate) const RATE_WINDOW: Duration = Duration::from_secs(1);
pub(crate) const RATE_MAX: usize = 10;
/// 모든 원격 합.
pub(crate) const MAX_PENDING: usize = 32;
/// 프런트 `mirror/request.ts` 와 같은 값.
const MAX_KEY: usize = 256;
const MAX_NAME: usize = 200;
const MAX_TABS: usize = 64;
const MAX_PATH: usize = 4096;
/// 프런트 `session/spec.ts` 의 `FILE_ZOOM_MAX` 와 같은 값.
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

/// 프런트 `LayoutRequest` 와 같은 모양. 비어 있을 수 있는 칸은 없으면 싣지 않는다 — `before` · `name`(tmux) 의 `null` 은 뜻이 있어 그대로 싣는다.
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
        /// 메인 PC 가 보는 것과 다르면 주 창은 넣기만 하고 화면을 옮기지 않는다.
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
        /// 보던 탭을 그대로 둔다 — `true` 만 뜻이 있다.
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
    /// 원격 창에 그 탭이 없을 때 메인 PC 가 앨범 탭(`runId`) · 홈을 연다.
    OpenOrchTab {
        #[serde(default, rename = "runId", skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace: Option<String>,
    },
    /// 파일 타일의 보기 설정 — 화면을 옮기지 않는다.
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

/// 순수. 원격 창만 · 상한 안 · 허용 목록의 모양.
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

#[derive(Default)]
pub(crate) struct Rate {
    hits: HashMap<String, VecDeque<Instant>>,
}

impl Rate {
    pub(crate) fn admit(&mut self, label: &str, now: Instant) -> bool {
        // 원격 창은 세대마다 새 라벨이라 오래된 줄은 가끔 걷는다.
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

/// 거절 머리(`[mirror-…]`)가 아니면 `invalid` 로 감싸고 길이를 자른다(원격 안내에 그대로 실린다).
pub(crate) fn respond_error(e: &str) -> String {
    let e: String = e.chars().take(300).collect();
    if e.starts_with("[mirror-") {
        e
    } else {
        format!("[mirror-invalid] {e}")
    }
}

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

/// 원격 허용 — 됐으면 `Ok`, 아니면 `[mirror-<사유>] …`(사유 글자는 프런트가 읽는다).
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

/// 메인 PC 전용 — 페이지를 다시 읽으면 새 채널로 갈아 끼운다.
#[tauri::command]
pub async fn mirror_request_inbox(window: tauri::Window, channel: Channel<Value>) -> Result<(), String> {
    if window.label() != PUBLISHER {
        return Err(format!("[mirror-publisher] only the home main window takes layout requests (got {})", window.label()));
    }
    *inbox() = Some(channel);
    Ok(())
}

/// 메인 PC 전용 — `error` 가 없으면 적용됨. 모르는 id(이미 시간 초과)는 조용히 버린다.
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

    /// 프런트 `LAYOUT_OPS` 를 소스로 읽어 두 목록이 짝인지 본다.
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
