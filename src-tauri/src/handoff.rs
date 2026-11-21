//! 탭 이관 — 창 사이로 탭을 옮긴다 (docs/log/2026-09-02-tear-out.md).
//!
//! 세션은 앱 전역이라 창을 넘기는 것은 그 세션의 출력이 가는 웹뷰를 바꾸는 일이다 — 프런트 언마운트가 `close` 를 부르지 않게
//! 막는 것은 `tear.ts` 의 `handoffPanes` 다.
//!
//! 불변식: 소유 창 라벨은 **받는 쪽이 꺼내는 순간**(`take_handoff`) 옮긴다 — 늦으면 떼어 낸 창을 비울 때
//! `crate::reap` 이 옛 라벨로 세션을 닫는다 (docs/log/2026-09-30-tear-title-and-agent-handoff.md).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::ipc::{Channel as IpcChannel, InvokeResponseBody};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 사서함 (handoff mailbox)
// ---------------------------------------------------------------------------

/// 수령되지 않은 이관 페이로드의 수명 — 취소된 드래그가 남긴 짐을 치운다.
const TTL: Duration = Duration::from_secs(300);

struct Stashed {
    payload: String,
    at: Instant,
}

/// 창 사이로 큰 문자열(직렬화된 스크롤백 포함)을 넘기는 **1회용 우편함** — 받는 창이 아직 없을 수 있고
/// `dataTransfer` 로는 수 MB 를 실을 수 없어 드래그에는 번호표만 싣는다.
#[derive(Default)]
pub struct Mailbox(Mutex<HashMap<u32, Stashed>>);

impl Mailbox {
    fn sweep(map: &mut HashMap<u32, Stashed>, now: Instant) {
        map.retain(|_, s| now.duration_since(s.at) < TTL);
    }

/// 이미 살아 있는 번호면 거절한다 — 남의 짐을 덮어쓰면 그 창의 탭이 조용히 사라진다.
    fn put(&self, token: u32, payload: String, now: Instant) -> Result<(), String> {
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        if map.contains_key(&token) {
            return Err(tr!(
                ko: "이미 사용 중인 이관 번호입니다: {token}",
                en: "That handoff number is already in use: {token}"
            ));
        }
        map.insert(token, Stashed { payload, at: now });
        Ok(())
    }

/// **1회용** — 두 번째 호출은 언제나 `None` 이다 (같은 탭이 두 창에 복제되지 않게).
    #[cfg(test)]
    fn take(&self, token: u32, now: Instant) -> Option<String> {
        self.take_then(token, now, |_| {})
    }

    #[cfg(test)]
    fn take_then(&self, token: u32, now: Instant, adopt: impl FnOnce(&str)) -> Option<String> {
        self.take_checked_then(token, now, |_| Ok(()), adopt)
            .ok()
            .flatten()
    }

    // 검사 · 저장이 성공하기 전에는 꺼내지 않는다. `adopt` 는 같은 잠금 안에서 돈다 — 잠금이 먼저 풀리면
    // 그 틈에 `crate::reap` 이 "보호도 없고 주인은 아직 보낸 창" 인 세션을 거둔다.
    fn take_checked_then(
        &self,
        token: u32,
        now: Instant,
        check: impl FnOnce(&str) -> Result<(), String>,
        adopt: impl FnOnce(&str),
    ) -> Result<Option<String>, String> {
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        let Some(stashed) = map.get(&token) else {
            return Ok(None);
        };
        check(&stashed.payload)?;
        let stashed = map.remove(&token).expect("checked stash");
        adopt(&stashed.payload);
        Ok(Some(stashed.payload))
    }

    fn peek(&self, token: u32, now: Instant) -> Option<String> {
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        map.get(&token).map(|stash| stash.payload.clone())
    }

    fn has(&self, token: u32, now: Instant) -> bool {
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        map.contains_key(&token)
    }

    /// 아직 주인을 기다리는 짐이 데리고 있는 세션 id — 소유 라벨이 아직 보낸 창이라 `crate::reap` 에서 빼야 한다.
    pub(crate) fn held_sessions(&self, now: Instant) -> crate::reap::Held {
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        let mut held = crate::reap::Held::default();
        for stashed in map.values() {
            crate::reap::collect_held(&stashed.payload, &mut held);
        }
        held
    }
}

// ---------------------------------------------------------------------------
// 명령
//
// [`stash_handoff`] 는 **동기로 남는다** (docs/conventions.md 의 예외): 사서함은 메모리 맵
// 하나이고 하는 일은 잠금 한 번 + `insert` 뿐이다. 디스크도 프로세스도 없으므로 UI 스레드를
// 잡는 시간이 마이크로초다. 그리고 `dragstart` 핸들러 바로 뒤를 따라가는 호출이라 **지연이 곧
// 버그**다 — 짐이 도착하기 전에 상대 창이 `take_handoff` 를 부르면 드롭이 빈손으로 끝난다.
// ---------------------------------------------------------------------------

/// 번호는 프런트가 고른다 — `dragstart` 는 동기라 `invoke` 로 발급받아 실을 수 없다.
#[tauri::command]
pub fn stash_handoff(
    state: tauri::State<'_, Mailbox>,
    window: tauri::WebviewWindow,
    token: u32,
    payload: String,
) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    if value.get("workspace").is_some()
        && value["workspace"]["sourceWindow"].as_str() != Some(window.label())
    {
        return Err("handoffSourceMismatch".into());
    }
    state.put(token, payload, Instant::now())
}

/// 맡긴 짐을 찾아간다 (1회용). 꺼내는 순간 세션의 소유 창도 이 창으로 옮긴다 — 재부착까지 미루면 그 틈에
/// 보낸 창이 비어 닫히며 그 창의 [`crate::reap`] 이 세션을 거둔다 (docs/log/2026-09-30-tear-title-and-agent-handoff.md).
#[tauri::command]
pub async fn take_handoff(
    app: AppHandle,
    webview: tauri::Webview,
    token: u32,
    workspace_id: Option<String>,
    merge: Option<crate::workspaces::schema::TabMerge>,
) -> Result<Option<String>, String> {
    let label = webview.window().label().to_string();
    let home = label.clone();
    let taken = tauri::async_runtime::spawn_blocking(move || {
        let mailbox = app.state::<Mailbox>();
        mailbox.take_checked_then(
            token,
            Instant::now(),
            |payload| {
                let value: serde_json::Value =
                    serde_json::from_str(payload).map_err(|e| e.to_string())?;
                if value.get("workspaceId").is_none() {
                    return Ok(());
                }
                let bindings = app.state::<crate::workspace_windows::Bindings>();
                let binding = bindings.get(&label).ok_or("workspaceBindingMissing")?;
                validate_workspace(&value, &binding.workspace_id, workspace_id.as_deref())?;
                let meta = &value["workspace"];
                let source = meta["sourceWindow"]
                    .as_str()
                    .ok_or("handoffSourceMissing")?;
                let source_binding = bindings.get(source).ok_or("workspaceBindingMissing")?;
                if (source != "main" && source_binding.workspace_id != binding.workspace_id)
                    || source == label
                {
                    return Err("workspaceMismatch".into());
                }
                let mut tab: crate::workspaces::schema::SavedWorkspaceTab =
                    serde_json::from_value(meta["savedTab"].clone()).map_err(|e| e.to_string())?;
                tab.placement = binding.scope;
                let source_tab_key = meta["sourceTabKey"]
                    .as_str()
                    .ok_or("sourceTabMissing")?
                    .to_string();
                crate::workspaces::transfer_handoff(
                    &label,
                    binding.workspace_id,
                    source_tab_key,
                    source,
                    &source_binding.scope,
                    tab,
                    merge,
                )
            },
            |_payload| {
                // 책임 창은 세션 서버의 코어라 아래(블로킹 풀 밖)에서 서버 op 로 옮긴다 · 임대는 재부착(`reattach_output`)이 옮긴다.
            },
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    // **돌려주기 전에** 서버에 실어야 보낸 창의 파괴 거둠(`close_window`)보다 먼저 닿는다(같은 연결 위에서 차례로 처리된다).
    if let Some(payload) = &taken {
        let mut held = crate::reap::Held::default();
        crate::reap::collect_held(payload, &mut held);
        if !held.local.is_empty() || !held.ssh.is_empty() || !held.db_streams.is_empty() {
            let ids: Vec<u32> = held.local.into_iter().collect();
            let ssh_ids: Vec<u32> = held.ssh.into_iter().collect();
            let db_streams: Vec<String> = held.db_streams.into_iter().collect();
            if let Err(e) = crate::server::proxy::call(
                crate::server::ipc::Grade::Write,
                "set_home",
                serde_json::json!({ "window": home, "ids": ids, "sshIds": ssh_ids, "dbStreams": db_streams }),
            )
            .await
            {
                eprintln!("[server] 이관 책임 창을 옮기지 못했습니다: {e}");
            }
        }
    }
    Ok(taken)
}

fn validate_workspace(
    value: &serde_json::Value,
    actual: &str,
    requested: Option<&str>,
) -> Result<(), String> {
    let incoming = value["workspaceId"].as_str().ok_or("workspaceMissing")?;
    if incoming != actual
        || requested != Some(actual)
        || value["workspace"]["workspaceId"].as_str() != Some(actual)
        || value["tab"]["workspaceId"].as_str() != Some(actual)
    {
        return Err("workspaceMismatch".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn peek_handoff(app: AppHandle, token: u32) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Mailbox>().peek(token, Instant::now()))
        .await
        .map_err(|e| e.to_string())
}

const TEAR_WIDTH: f64 = 900.0;
const TEAR_HEIGHT: f64 = 600.0;

const MIN_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 480.0;

const TEAR_OFFSET_X: f64 = 60.0;
const TEAR_OFFSET_Y: f64 = 20.0;

/// 떼어 낸 탭을 담을 **새 창**을 연다.
///
/// `disable_drag_drop_handler()` 는 **필수**다 — Tauri 의 OS 파일 드랍이 켜지면 웹뷰의 HTML5 드래그 앤 드랍이
/// 통째로 죽는데, 탭 · 패널 · 호스트 이동이 전부 그 위에 서 있다.
#[tauri::command]
pub async fn open_tear_window(
    app: AppHandle,
    state: tauri::State<'_, Mailbox>,
    token: u32,
    x: f64,
    y: f64,
) -> Result<(), String> {
    // 다른 창이 이미 가져갔는데 여기서 또 창을 열면 탭이 둘로 는다.
    if !state.has(token, Instant::now()) {
        return Err(tr!(
            ko: "이관할 내용이 없습니다 (이미 다른 창이 가져갔거나 만료되었습니다)",
            en: "There is nothing to hand off (another window already took it, or it expired)"
        ));
    }

    // **반드시 메인 스레드에서 만든다** — 스레드풀 스레드에는 메시지 펌프가 없어 Windows 창이 흰 무응답 창이 된다.
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let label = format!("tear-{token}");
        let result = WebviewWindowBuilder::new(
            &app2,
            &label,
            // 토큰은 URL 이 아니라 초기화 스크립트로 넣는다 — `WebviewUrl::App` 이 `#` 를 `%23` 으로 바꿔 SvelteKit 이 404 를 낸다.
            WebviewUrl::App(Default::default()),
        )
        .initialization_script(format!("window.__TEAR_TOKEN__ = {token};"))
        // 메인 창 `title`(tauri.conf.json)과 같은 표시명 — 개발 빌드 값은 `instance.rs` 가 정한다.
        .title(crate::instance::WINDOW_TITLE)
        // 메인 창과 같은 커스텀 타이틀바(탭 바)를 쓴다 — 켜면 네이티브 제목줄이 이중으로 얹힌다.
        .decorations(false)
        .inner_size(TEAR_WIDTH, TEAR_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        // 드롭 좌표가 0 근처면 창이 제목 표시줄째 화면 밖으로 잘려 붙잡을 수 없다.
        .position((x - TEAR_OFFSET_X).max(0.0), (y - TEAR_OFFSET_Y).max(0.0))
        // 메인 창의 `transparent:true`(tauri.conf.json)와 맞춘다 — 화면은 늘 불투명하고 창 가장자리 · 첫 프레임만 맞춘다.
        .transparent(true)
        .disable_drag_drop_handler()
        .build()
        .map(|_| ())
        .map_err(
            |e| tr!(ko: "새 창을 열지 못했습니다: {e}", en: "Could not open a new window: {e}"),
        );
        let _ = tx.send(result);
    })
    .map_err(|e| {
        tr!(
            ko: "창 생성을 메인 스레드로 넘기지 못했습니다: {e}",
            en: "Could not hand window creation to the main thread: {e}"
        )
    })?;

    rx.await.map_err(|_| {
        tr!(
            ko: "창 생성 결과를 받지 못했습니다",
            en: "Did not get the result of creating the window"
        )
    })?
}

/// 살아 있는 세션의 출력을 **이 창으로** 돌린다 — 임대를 빼앗아 받고(옛 창의 손잡이는 낡는다) 결과에 새 열쇠(`lease`)를 싣는다.
///
/// **같은 창**에서 불러도 된다 — 침묵한 타일의 자가 회복이 새 채널로 이 경로를 그대로 쓴다. 그래서 이관 전용 부수 효과
/// (사서함 · 창 생성 · 탭 지우기)를 여기 두지 않는다 (docs/log/2026-09-05-silent-session-selfheal.md).
#[tauri::command]
// 인자는 전부 Tauri 가 이름으로 넘기는 값이다 — 구조체로 묶으면 프런트 계약만 복잡해진다.
#[allow(clippy::too_many_arguments)]
pub async fn reattach_output(
    webview: tauri::Webview,
    kind: String,
    id: u32,
    on_data: IpcChannel<InvokeResponseBody>,
    cols: u16,
    rows: u16,
    // 짐을 뜬 순간 소스 터미널이 소비한 출력 오프셋 (`tear.ts`). 없으면 재생 없음.
    consumed: Option<u64>,
) -> Result<serde_json::Value, String> {
    let label = webview.window().label().to_string();
    let kind = match kind.as_str() {
        "local" => crate::session_core::Kind::Local,
        "ssh" => crate::session_core::Kind::Ssh,
        other => {
            return Err(tr!(ko: "알 수 없는 세션 종류: {other}", en: "Unknown session kind: {other}"))
        }
    };
    crate::server::proxy::adopt(&label, kind, id, on_data, cols, rows, consumed).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_TOKEN: AtomicU32 = AtomicU32::new(1);

    fn token() -> u32 {
        TEST_TOKEN.fetch_add(1, Ordering::Relaxed)
    }

    #[test]
    fn min_size_matches_main_window_config() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let win = &conf["app"]["windows"][0];
        assert_eq!(win["minWidth"].as_f64(), Some(MIN_WIDTH));
        assert_eq!(win["minHeight"].as_f64(), Some(MIN_HEIGHT));
    }

    fn mailbox() -> Mailbox {
        Mailbox::default()
    }

    #[test]
    fn stash_then_take_returns_the_payload() {
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        mb.put(t, "hello".into(), now).expect("맡기기 실패");
        assert_eq!(mb.take(t, now).as_deref(), Some("hello"));
    }

    #[test]
    fn take_is_single_use() {
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        mb.put(t, "payload".into(), now).unwrap();
        assert!(mb.take(t, now).is_some());
        assert!(mb.take(t, now).is_none());
    }

    #[test]
    fn take_then_adopts_while_the_stash_is_still_locked() {
        // 소유를 옮기는 콜백은 짐이 빠진 **잠금 안에서** 돈다 — 그 사이 reap 이 `held_sessions` 를
        // 부르면 잠금에서 기다리므로 "보호도 없고 주인은 보낸 창" 인 틈을 볼 수 없다.
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        let payload = r#"{"panes":[{"pane":{"kind":"local"},"sessionId":7}]}"#;
        mb.put(t, payload.into(), now).unwrap();
        let mut seen = crate::reap::Held::default();
        let got = mb.take_then(t, now, |p| {
            assert!(mb.0.try_lock().is_err(), "콜백은 사서함 잠금 안에서 돈다");
            crate::reap::collect_held(p, &mut seen);
        });
        assert_eq!(got.as_deref(), Some(payload));
        assert!(seen.local.contains(&7), "짐에 실린 세션을 콜백이 본다");
        assert!(mb
            .take_then(t, now, |_| panic!("빈 번호에 콜백이 돌면 안 된다"))
            .is_none());
        assert!(mb.held_sessions(now).local.is_empty());
    }

    #[test]
    fn unknown_token_is_none() {
        let mb = mailbox();
        assert!(mb.take(999_999, Instant::now()).is_none());
    }

    #[test]
    fn expired_payload_is_dropped() {
        let mb = mailbox();
        let start = Instant::now();
        let t = token();
        mb.put(t, "stale".into(), start).unwrap();
        assert!(mb.has(t, start + TTL - Duration::from_secs(1)));
        assert!(!mb.has(t, start + TTL + Duration::from_secs(1)));
        assert!(mb.take(t, start + TTL + Duration::from_secs(1)).is_none());
    }

    #[test]
    fn sweep_also_clears_other_expired_slots() {
        let mb = mailbox();
        let start = Instant::now();
        let old = token();
        let fresh = token();
        mb.put(old, "old".into(), start).unwrap();

        let later = start + TTL + Duration::from_secs(1);
        mb.put(fresh, "fresh".into(), later).unwrap();

        assert_eq!(mb.0.lock().unwrap().len(), 1, "만료된 자리가 남아 있다");
        assert_eq!(mb.take(fresh, later).as_deref(), Some("fresh"));
    }

    #[test]
    fn duplicate_token_is_rejected() {
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        mb.put(t, "first".into(), now).unwrap();
        assert!(mb.put(t, "second".into(), now).is_err());
        assert_eq!(mb.take(t, now).as_deref(), Some("first"));
    }

    #[test]
    fn expired_token_can_be_reused() {
        let mb = mailbox();
        let start = Instant::now();
        let t = token();
        mb.put(t, "old".into(), start).unwrap();
        let later = start + TTL + Duration::from_secs(1);
        mb.put(t, "new".into(), later)
            .expect("만료된 번호를 거절했다");
        assert_eq!(mb.take(t, later).as_deref(), Some("new"));
    }

    #[test]
    fn workspace_mismatch_and_save_failure_leave_mailbox_unconsumed() {
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        let payload = serde_json::json!({
            "workspaceId": "A", "tab": {"workspaceId": "A"},
            "workspace": {"workspaceId": "A"}
        })
        .to_string();
        mb.put(t, payload.clone(), now).unwrap();
        assert!(mb
            .take_checked_then(
                t,
                now,
                |p| validate_workspace(&serde_json::from_str(p).unwrap(), "B", Some("B")),
                |_| panic!("거절된 짐은 owner를 바꾸면 안 된다"),
            )
            .is_err());
        assert!(mb.has(t, now));
        assert!(mb
            .take_checked_then(
                t,
                now,
                |_| Err("simulated-save-failure".into()),
                |_| panic!("저장 실패는 owner를 바꾸면 안 된다"),
            )
            .is_err());
        assert_eq!(mb.peek(t, now).as_deref(), Some(payload.as_str()));
        assert!(mb
            .take_checked_then(
                t,
                now,
                |p| validate_workspace(&serde_json::from_str(p).unwrap(), "A", Some("A")),
                |_| {},
            )
            .unwrap()
            .is_some());
        assert!(!mb.has(t, now));
    }
}
