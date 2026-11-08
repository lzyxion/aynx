//! 탭 이관 — 창 사이로 탭을 옮긴다 (docs/log/2026-09-02-tear-out.md).
//!
//! 이 앱의 배치 모델은 **패널 ⊂ 탭 ⊂ 창** 이다. 앞의 두 겹은 프런트가 트리 하나로
//! 다루면 끝났지만(`session.ts`), 마지막 겹은 웹뷰가 갈리기 때문에 백엔드가 세 가지를
//! 맡아야 한다.
//!
//! ```text
//!  소스 창                                  대상 창 (새 창 또는 기존 창)
//!  ────────────────────────────────────     ──────────────────────────────────
//!  dragstart
//!    ├ 각 패널 버퍼 직렬화 (addon-serialize)
//!    ├ stash_handoff(token, payload) ──────► [사서함]
//!    └ dataTransfer: x-aynx-tear = token
//!                                            (드랍) take_handoff(token) ◄─────┐
//!  dragend (창 밖) ─► open_tear_window ─────► 새 창 부팅 /#tear=<token>         │
//!                                            take_handoff(token) ─────────────┘
//!                                            ▼
//!                                          reattach_output(kind, id, consumed, …)
//!                                            = (틈의 출력 재생 +) 출력 슬롯 교체 + resize + 수문 열기
//!  탭 제거 ◄── (workspace release ACK)
//! ```
//!
//! **세션은 죽지 않는다.** [`crate::pty::Sessions`]·[`crate::ssh::SshSessions`] 는 앱 전역
//! 상태라 창이 몇 개든 하나뿐이고, 창을 넘기는 것은 "그 세션의 출력이 어느 웹뷰로 가는가"
//! ([`crate::output::OutputSlot`]) 하나를 바꾸는 일이다. 프런트 쪽에서 언마운트 정리가
//! `close` 를 부르지 않게 막는 것은 `tear.ts` 의 `handoffPanes` 가 한다.
//!
//! 불변식: 소유 창 라벨은 **받는 쪽이 꺼내는 순간**(`take_handoff`) 옮긴다 — 늦으면 떼어 낸 창을 비울 때
//! `crate::reap` 이 옛 라벨로 세션을 닫는다 (docs/log/2026-09-30-tear-title-and-agent-handoff.md).
//!
//! 현재 서로 부름: `crate::reap` 과 순환한다(이쪽은 `reap::collect_held`, 저쪽은 사서함 [`Mailbox`]).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::ipc::{Channel as IpcChannel, InvokeResponseBody};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 사서함 (handoff mailbox)
// ---------------------------------------------------------------------------

/// 수령되지 않은 이관 페이로드의 수명. 넘기면 폐기한다.
///
/// 드래그를 취소하면 소스 창은 탭을 그대로 들고 있고 사서함만 남는다 — 그 쓰레기를
/// 치우는 것이 이 시한이다. 5분은 "사람이 드래그를 시작해서 놓기까지" 보다 훨씬 길고,
/// 스크롤백 한 탭치를 그만큼 붙들고 있어도 부담이 없는 길이다.
const TTL: Duration = Duration::from_secs(300);

struct Stashed {
    payload: String,
    at: Instant,
}

/// 창 사이로 큰 문자열(직렬화된 스크롤백 포함)을 넘기는 **1회용 우편함**.
///
/// 왜 이벤트가 아니라 우편함인가 — 받는 쪽이 **아직 존재하지 않을 수 있다** (분리는 새 창을
/// 만드는 일이다). 그리고 HTML5 `dataTransfer` 로는 수 MB 짜리 문자열을 창 밖으로 안전하게
/// 실어 보낼 수 없다. 그래서 드래그에는 **번호표만** 싣고 짐은 여기 맡긴다.
///
/// 시간 인자를 받는 이유는 만료를 시계 없이 테스트하기 위해서다.
#[derive(Default)]
pub struct Mailbox(Mutex<HashMap<u32, Stashed>>);

impl Mailbox {
    /// 만료된 자리를 치운다. 별도 청소 태스크를 두지 않고 **stash/take 때마다 게으르게**
    /// 돈다 — 항목이 많아야 몇 개라 훑는 비용이 없다.
    fn sweep(map: &mut HashMap<u32, Stashed>, now: Instant) {
        map.retain(|_, s| now.duration_since(s.at) < TTL);
    }

    /// 페이로드를 맡긴다. 이미 살아 있는 번호면 **거절**한다 — 남의 짐을 덮어쓰면
    /// 그 창의 탭이 조용히 사라진다.
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

    /// 짐을 찾아간다. **1회용** — 두 번째 호출은 언제나 `None` 이다 (같은 탭이 두 창에
    /// 복제되는 사고를 타입이 아니라 상태로 막는다).
    #[cfg(test)]
    fn take(&self, token: u32, now: Instant) -> Option<String> {
        self.take_then(token, now, |_| {})
    }

    /// [`take`](Self::take) 와 같되, 짐을 꺼낸 **잠금 안에서** `adopt` 를 한 번 부른다.
    ///
    /// [`take_handoff`] 가 짐에 실린 세션의 소유 창을 받는 창으로 옮기는 자리다. 잠금 안이어야 하는
    /// 이유: 짐이 사서함에서 빠지는 순간 그 세션은 [`held_sessions`](Self::held_sessions) 의 보호를
    /// 잃는다. 소유를 옮기기 **전에** 잠금이 풀리면 그 틈에 도는 [`crate::reap`] 이 "보호도 없고 주인은
    /// 아직 보낸 창" 인 세션을 거둔다. 잠금 안에서 끝내면 reap 은 둘 중 하나만 본다 — 아직 사서함에
    /// 있다(보호) 또는 이미 받는 창의 것이다.
    #[cfg(test)]
    fn take_then(&self, token: u32, now: Instant, adopt: impl FnOnce(&str)) -> Option<String> {
        self.take_checked_then(token, now, |_| Ok(()), adopt)
            .ok()
            .flatten()
    }

    // 검사/저장 성공 전에는 remove하지 않는다. 같은 잠금 안에서 owner도 바꾼다.
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

    /// 짐이 아직 있는가 (꺼내지 않는다). 분리 창을 열기 직전, 그 사이 다른 창이
    /// 먼저 가져가지 않았는지 보는 데 쓴다.
    fn has(&self, token: u32, now: Instant) -> bool {
        let mut map = self.0.lock().unwrap();
        Self::sweep(&mut map, now);
        map.contains_key(&token)
    }

    /// **아직 주인을 기다리는 짐이 데리고 있는 세션 id 들** — 창 정리에서 빼야 할 것들이다.
    ///
    /// 이관 중인 세션은 소유 창 라벨이 아직 **보낸 쪽**이다 (받는 쪽이 짐을 꺼내는
    /// [`take_handoff`] 에서야 넘어간다). 그 사이에 보낸 창이 새로고침되거나 닫히면
    /// [`crate::reap`] 이 넘겨 준 세션을 죽여 버린다 — 그 한 구멍을 막는 값이다.
    ///
    /// 페이로드를 복제하지 않고 **잠금 안에서 훑는다** (스크롤백까지 실려 있어 MB 단위다).
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
//
// [`take_handoff`] 는 2026-09-30 에 `async` 가 됐다 — 꺼낸 짐(MB 단위 JSON)을 한 번 훑어 세션의
// 소유 창을 옮기므로 더는 마이크로초가 아니다(docs/log/2026-09-30-tear-title-and-agent-handoff.md).
// 창을 만드는 [`open_tear_window`] 와 세션을 옮기는 [`reattach_output`] 도 `async` 다
// (창 생성·resize 가 느리다).
// ---------------------------------------------------------------------------

/// 이관 페이로드를 맡긴다.
///
/// **번호를 프런트가 만든다**는 점이 이 API 의 유일한 특이점이다. `dragstart` 는 동기
/// 이벤트라 그 자리에서 `dataTransfer` 에 값을 실어야 하는데, `invoke` 는 비동기라
/// "발급받아 싣기" 가 성립하지 않는다. 그래서 프런트가 난수 u32 를 골라 싣고, 짐은
/// 곧이어 이 명령으로 따라 보낸다. 충돌하면 위에서 거절한다 (2³² 중 동시에 살아 있는
/// 번호는 많아야 몇 개라 실질 확률은 0 이다).
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

/// 맡긴 짐을 찾아간다 (1회용). 없거나 이미 가져갔거나 만료됐으면 `None`.
///
/// ## 짐을 꺼내는 순간 세션의 **소유 창도 이 창으로 옮긴다** (2026-09-30)
///
/// 예전에는 소유가 [`reattach_output`] 에서야 넘어갔다. 그런데 받는 창은 짐을 꺼낸 뒤 타일을
/// 마운트하고 **스크롤백을 다 쓴 다음에야** 재부착한다 — 그 사이 세션은 사서함의 보호도 없고 주인은
/// 아직 보낸 창이다. 창 사이 합치기(분리 창의 마지막 탭을 다른 창에 놓기)에서 보낸 창은
/// workspace release ACK 을 받자마자 비어서 닫히고, 그 창의 [`crate::reap`] 이 이 틈의 세션을 거둔다 → 받는
/// 창의 재부착이 "이어받을 세션이 없습니다". 스크롤백이 큰 타일(에이전트 CLI)일수록 쓰기가 길어
/// 이 경주에서 진다(docs/log/2026-09-30-tear-title-and-agent-handoff.md).
///
/// 꺼내는 순간 옮기면 틈이 없다: 이 창이 재부착 전에 죽거나 새로고침되면 그때는 **이 창의** reap 이
/// 거두는 것이 맞다(그 세션을 보여 줄 창이 이제 없다).
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
                // 책임 창(세션 코어 `home`)은 세션 서버의 코어다(로컬·SSH 모두 — ③-3b2) — 아래(블로킹 풀 밖)에서 서버 op 로.
                // 임대는 재부착(`reattach_output` → `adopt`)이 옮긴다.
            },
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    // 로컬의 책임 창도 지금 옮긴다 — **돌려주기 전에** 서버에 실어야 보낸 창의 파괴 거둠(`close_window`)보다 먼저 닿는다
    // (같은 연결 위에서 차례로 처리된다 · 2026-09-30 합치기 경주).
    if let Some(payload) = &taken {
        let mut held = crate::reap::Held::default();
        crate::reap::collect_held(payload, &mut held);
        if !held.local.is_empty() || !held.ssh.is_empty() || !held.db_streams.is_empty() {
            let ids: Vec<u32> = held.local.into_iter().collect();
            let ssh_ids: Vec<u32> = held.ssh.into_iter().collect();
            // 쿼리 타일의 DB 연결(세션 코어 밖 `db::table`)도 같은 op 로 — 받는 타일은 같은 열쇠로 `db_open` 해 재부착한다.
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

/// 분리 창의 기본 크기. 메인 창(1100×720)보다 작게 잡는다 — 탭 하나를 떼어 옆에
/// 세워 두는 용도라 원본만 한 창이 겹쳐 뜨면 오히려 방해가 된다.
const TEAR_WIDTH: f64 = 900.0;
const TEAR_HEIGHT: f64 = 600.0;

/// 창의 최소 크기 — 주 창(`tauri.conf.json` 의 `minWidth`·`minHeight`)과 같은 값이어야 한다.
/// 이보다 좁으면 탭 줄·상태바·타일 머리줄이 서로 밀어내 조작할 자리가 사라진다.
const MIN_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 480.0;

/// 드롭 지점이 새 창의 **제목 표시줄 근처**가 되도록 왼쪽·위로 조금 당긴다
/// (커서가 창 한복판에 박히면 방금 놓은 자리와 창이 어긋나 보인다).
const TEAR_OFFSET_X: f64 = 60.0;
const TEAR_OFFSET_Y: f64 = 20.0;

/// 떼어 낸 탭을 담을 **새 창**을 연다.
///
/// URL 은 기존 창과 **완전히 같은 페이지**이고 `#tear=<token>` 해시만 붙는다 — 해시는
/// 라우터가 보지 않으므로(SPA·`ssr = false`) 라우팅에 간섭하지 않고, 새 창의 부팅
/// 스크립트만 그 값을 읽어 사서함에서 짐을 찾는다.
///
/// `disable_drag_drop_handler()`(= `tauri.conf.json` 의 `dragDropEnabled: false`) 는
/// **필수**다. Tauri 의 OS 레벨 파일 드랍이 켜져 있으면
/// 웹뷰의 HTML5 드래그 앤 드랍이 통째로 죽는데, 이 앱의 탭·패널·호스트 이동이 전부
/// 그 위에 서 있다 (`tauri.conf.json` 의 메인 창 설정과 같은 근거다).
#[tauri::command]
pub async fn open_tear_window(
    app: AppHandle,
    state: tauri::State<'_, Mailbox>,
    token: u32,
    x: f64,
    y: f64,
) -> Result<(), String> {
    // 창을 만들기 전에 짐이 아직 있는지 본다 — 창 간 드래그로 **다른 창이 이미 가져간**
    // 경우(그쪽은 workspace release 요청을 보낸다) 여기서 또 창을 열면 탭이 둘로 늘어난다.
    if !state.has(token, Instant::now()) {
        return Err(tr!(
            ko: "이관할 내용이 없습니다 (이미 다른 창이 가져갔거나 만료되었습니다)",
            en: "There is nothing to hand off (another window already took it, or it expired)"
        ));
    }

    // **반드시 메인 스레드에서 만든다.** 명령은 비동기 스레드풀에서 도는데, Windows 의
    // 창(HWND)은 만든 스레드가 메시지를 퍼 줘야 산다 — 스레드풀 스레드에는 펌프가 없어
    // 제목 표시줄만 있는 흰 무응답 창이 된다 (실기에서 발견: 그리기·닫기·웹뷰 초기화
    // 전부 얼어붙음). 결과는 oneshot 으로 돌려받아 오류 계약을 유지한다.
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let label = format!("tear-{token}");
        let result = WebviewWindowBuilder::new(
            &app2,
            &label,
            // 앱 루트 그대로. 토큰은 URL 이 아니라 아래 초기화 스크립트로 넣는다 —
            // `WebviewUrl::App` 은 경로로 취급되어 `#` 가 `%23` 으로 인코딩되고, SvelteKit 이
            // `/%23tear=N` 이라는 없는 라우트를 받아 404 가 난다.
            WebviewUrl::App(Default::default()),
        )
        // 페이지 스크립트보다 먼저 실행된다 — 부팅 코드가 `window.__TEAR_TOKEN__` 을 읽는다.
        .initialization_script(format!("window.__TEAR_TOKEN__ = {token};"))
        // 사용자에게 보이는 창 제목이라 소문자 id 가 아니라 **표시명**이다
        // (tauri.conf.json 의 메인 창 `title` 과 같은 값 — 개발 빌드는 `aynx (dev)`, `instance.rs`).
        .title(crate::instance::WINDOW_TITLE)
        // 메인 창과 같은 커스텀 타이틀바(탭 바)를 쓰므로 분리 창도 네이티브 장식을 끈다 —
        // 안 그러면 새 창에만 네이티브 제목줄이 이중으로 얹힌다.
        .decorations(false)
        .inner_size(TEAR_WIDTH, TEAR_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        // 음수 좌표는 화면 밖이다 — 다중 모니터에서는 유효할 수 있으나, 드롭 좌표가
        // 0 근처면 창이 제목 표시줄째 잘려 붙잡을 수 없게 되므로 0 으로 막는다.
        .position((x - TEAR_OFFSET_X).max(0.0), (y - TEAR_OFFSET_Y).max(0.0))
        // 메인 창과 같은 창 속성으로 만든다(tauri.conf.json 의 메인 창 `transparent:true` 와 같다).
        // 화면은 늘 불투명하다(theme.css 의 `html` 이 기저색을 칠한다 — 10-22) — 이 플래그는 창 가장자리 ·
        // 첫 프레임이 메인 창과 어긋나지 않게 맞춰 둘 뿐이다.
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

/// 살아 있는 세션의 출력을 **이 창으로** 돌린다.
///
/// 하는 일은 셋이고 순서에 뜻이 있다.
/// 1. 출력 슬롯 교체 — 이 순간부터 배치는 새 창의 채널로 간다. `consumed`(짐을 뜬 순간 소스
///    화면에 반영돼 있던 출력 오프셋)가 있으면 **교체 전에, 같은 잠금 안에서** 그 뒤의 꼬리를
///    새 채널로 먼저 흘린다 — dragstart ~ 지금 사이 옛 채널로 가 사라진 출력이다
///    ([`crate::output::swap_output_replaying`]). 링이 넘쳤거나 오프셋이 어긋나면 재생 없이
///    3 의 재그림에 맡기고 로그 한 줄을 남긴다. 돌려주는 [`crate::output::Reattached`] 의
///    `start` 에서 새 창이 다음 이관의 오프셋을 이어 센다.
/// 2. **수문 열기** — 옛 창이 역압으로 닫아 둔 채 탭을 넘겼다면 새 창은 그 사실을 알
///    방법이 없다. 새 창의 `pending` 은 0 에서 시작하므로 `resume` 을 부를 계기가 영영
///    없고, 세션은 살아 있는데 화면만 멈춘다. 그래서 이관은 **무조건** 수문을 연다.
/// 3. 크기 맞추기 — 새 창의 터미널은 대개 크기가 다르다.
///
/// 2 를 3 보다 먼저 두는 이유: `resize` 가 실패해 조기 반환하더라도 데이터 경로는
/// 이미 살아 있어야 한다 (크기가 어긋난 화면 > 멈춘 화면).
///
/// ## 넷째 일 — **소유 창 라벨을 이 창으로 옮긴다** (`set_owner`)
///
/// 세션마다 적어 두는 소유 창은 [`crate::reap`] 이 "새로고침된 창이 남긴 세션" 을 고르는
/// 유일한 열쇠다. 이관의 소유는 짐을 꺼내는 [`take_handoff`] 가 이미 옮겨 두었고(2026-09-30 —
/// 재부착까지의 틈에 보낸 창의 reap 이 세션을 거두던 구멍), 여기서는 같은 라벨을 한 번 더 적는다
/// (짐 없이 이 경로를 타는 자가 회복에서도 소유가 이 창이라는 것을 확정한다).
///
/// ## **같은 창**에서 불러도 된다 — 침묵한 타일의 자가 회복이 이 경로를 그대로 쓴다
///
/// (docs/log/2026-09-05-silent-session-selfheal.md) 세션을 열었는데 첫 출력이 오지 않으면
/// 프런트는 채널이 이미 죽었다고 보고(번호에 빈칸이 생겨 그 뒤가 JS 큐에 갇혔다) **새
/// 채널을 만들어 이 명령을 부른다**. 창은 그대로다.
///
/// 그래도 안전한 이유는 이 함수에 **이관 전용 부수 효과가 하나도 없기 때문**이다:
/// 사서함([`Mailbox`])을 건드리지 않고(토큰이 인자에 없다), 창을 만들지 않고, 탭을
/// 지우지 않는다. 넷째 일인 `set_owner` 도 같은 라벨을 다시 적는 것이라 사실상 no-op 다.
/// 남는 것은 정확히 회복에 필요한 셋뿐이다 — 채널 교체 · 수문 열기 · 크기 재통보.
/// (`consumed` 는 짐이 있을 때만 온다 — 없으면 재생도 없다.)
/// 그래서 경량 사본(`reattach_output_here`)을 따로 두지 않았다: 갈라 두면 두 벌이 서로
/// 어긋나는 자리가 생기고, 정작 다른 점은 **부르는 쪽의 라벨** 하나뿐이다.
///
/// ## 로컬은 **임대를 빼앗아** 받는다 (2026-10-08 세션 코어 ②)
///
/// 뜻으로는 세션 코어의 `attach { take: true }` 다 — 이 창이 새 임대(회차 +1)를 받고 옛 창의 손잡이는 그
/// 순간 낡는다([`crate::session_core::Core::adopt`]). 경로·재생 규칙은 예전 그대로 두고(이관은 체크포인트
/// 대신 짐의 화면을 쓴다) 결과에 새 열쇠(`lease`)만 실어 보낸다 — 받는 손잡이가 그 열쇠로 write·close 한다.
/// SSH 도 같다(②-2) — 채널 교체·꼬리 재생은 예전 그대로, 결과에 새 열쇠를 싣는다.
#[tauri::command]
// 인자는 전부 Tauri 가 이름으로 넘기는 값이다 — 구조체로 묶으면 프런트 계약만 복잡해진다
// (`open_ssh_session` 과 같은 이유).
#[allow(clippy::too_many_arguments)]
pub async fn reattach_output(
    // 이 세션을 이어받는 창 — 라벨만 쓴다 (소유 이전).
    webview: tauri::Webview,
    kind: String,
    id: u32,
    on_data: IpcChannel<InvokeResponseBody>,
    cols: u16,
    rows: u16,
    // 짐을 뜬 순간 소스 터미널이 소비한 출력 오프셋 (`tear.ts`). 없으면(옛 짐) 재생 없음.
    consumed: Option<u64>,
) -> Result<serde_json::Value, String> {
    let label = webview.window().label().to_string();
    // 로컬·SSH 모두 세션 서버가 이관한다 — 임대 빼앗기·꼬리 재생·크기를 한 op 로(`server::sessions::adopt` · ③-3b2).
    let kind = match kind.as_str() {
        "local" => crate::session_core::Kind::Local,
        "ssh" => crate::session_core::Kind::Ssh,
        other => {
            return Err(tr!(ko: "알 수 없는 세션 종류: {other}", en: "Unknown session kind: {other}"))
        }
    };
    crate::server::proxy::adopt(&label, kind, id, on_data, cols, rows, consumed).await
}

// ---------------------------------------------------------------------------
// 프런트가 고르는 번호와 겹치지 않는 테스트용 카운터
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 테스트마다 다른 번호를 쓴다 (사서함은 테스트마다 새로 만들지만, 번호가 겹치면
    /// "충돌 거절" 테스트의 의도가 흐려진다).
    static TEST_TOKEN: AtomicU32 = AtomicU32::new(1);

    fn token() -> u32 {
        TEST_TOKEN.fetch_add(1, Ordering::Relaxed)
    }

    /// 분리 창의 최소 크기는 주 창(`tauri.conf.json`)과 같다 — 한쪽만 고치면 창마다 하한이 갈린다.
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
        // 같은 번호로 두 창이 받아 가면 탭이 복제된다 — 두 번째는 반드시 None.
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
        // 부르면 잠금에서 기다리므로 "보호도 없고 주인은 보낸 창" 인 틈을 볼 수 없다
        // (docs/log/2026-09-30-tear-title-and-agent-handoff.md).
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        let payload = r#"{"panes":[{"pane":{"kind":"local"},"sessionId":7}]}"#;
        mb.put(t, payload.into(), now).unwrap();
        let mut seen = crate::reap::Held::default();
        let got = mb.take_then(t, now, |p| {
            // 잠금 안: 사서함의 짐은 이미 빠졌지만 다른 스레드는 아직 그 사실을 볼 수 없다.
            assert!(mb.0.try_lock().is_err(), "콜백은 사서함 잠금 안에서 돈다");
            crate::reap::collect_held(p, &mut seen);
        });
        assert_eq!(got.as_deref(), Some(payload));
        assert!(seen.local.contains(&7), "짐에 실린 세션을 콜백이 본다");
        // 1회용 계약은 그대로다 — 두 번째는 콜백 없이 None.
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
        // TTL 직전에는 살아 있다.
        assert!(mb.has(t, start + TTL - Duration::from_secs(1)));
        // TTL 을 넘기면 사라진다 (수령 시도도, 존재 확인도).
        assert!(!mb.has(t, start + TTL + Duration::from_secs(1)));
        assert!(mb.take(t, start + TTL + Duration::from_secs(1)).is_none());
    }

    #[test]
    fn sweep_also_clears_other_expired_slots() {
        // 게으른 청소 — 아무 stash/take 한 번이면 만료된 이웃까지 함께 치운다.
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
        // 남의 짐을 덮어쓰면 그 창의 탭이 조용히 사라진다 — 거절이 맞다.
        let mb = mailbox();
        let now = Instant::now();
        let t = token();
        mb.put(t, "first".into(), now).unwrap();
        assert!(mb.put(t, "second".into(), now).is_err());
        // 원래 짐은 그대로다.
        assert_eq!(mb.take(t, now).as_deref(), Some("first"));
    }

    #[test]
    fn expired_token_can_be_reused() {
        // 만료로 비워진 번호는 다시 쓸 수 있어야 한다 (거절이 영구 예약이 되면 안 된다).
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
