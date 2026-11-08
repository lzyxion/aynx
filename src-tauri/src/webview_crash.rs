//! **웹뷰 렌더러가 죽으면 페이지를 다시 읽는다** — 설계 10절 "창 크래시(웹뷰)" 행(복구②: 마지막 체크포인트 + 링).
//!
//! WebView2 는 렌더러 프로세스가 죽어도(크래시·작업 관리자 종료·메모리 압박 종료) **스스로 다시 읽지 않는다** — 창은
//! 빈 화면으로 남고 아무 입력도 받지 않는다(실측 2026-10-10, `scripts/dev/survival` 의 `webview-crash` 행: 렌더러 kill 뒤
//! CDP 페이지가 답하지 않음). 세션은 서버에 살아 있으므로 페이지만 다시 읽으면 된다 — 다시 읽기는 F5 와 같은 길이다
//! (`on_page_load(Started)` 의 거둠이 임대를 풀고 새 페이지의 타일이 다시 붙는다 · `reap.rs` 머리말 4).
//!
//! `ProcessFailed` 중 **렌더러 종료**(`RENDER_PROCESS_EXITED`)만 다시 읽는다. 응답 없음(`UNRESPONSIVE`)은 스스로 돌아올 수
//! 있어 건드리지 않고, 브라우저 프로세스 종료는 웹뷰 자체가 죽은 것이라 다시 읽을 수 없다(창을 새로 만들어야 한다 — 범위 밖).
//! 조건 없는 무한 재시도를 막으려고 같은 웹뷰가 [`LOOP_WINDOW`] 안에 [`LOOP_LIMIT`] 번 죽었으면 더 다시 읽지 않는다(크래시 고리 —
//! 그때는 빈 창이 남고 로그 한 줄이 이유를 밝힌다).
//!
//! 창마다 한 번만 건다 — `on_page_load(Started)` 는 다시 읽을 때마다 오므로 라벨 집합으로 막고, 창이 파괴되면 지운다
//! ([`forget`]). OS 분기는 이 파일 하나이고 Windows 밖은 아직 스텁이다(WKWebView·WebKitGTK 는 각자의 "웹 프로세스 종료"
//! 신호가 있다 — 붙일 때 같은 자리에).

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
#[cfg(windows)]
use std::time::{Duration, Instant};

static WATCHED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// 크래시 고리 판정 — 이 시간 안에 이만큼 죽었으면 더 다시 읽지 않는다.
#[cfg(windows)]
const LOOP_WINDOW: Duration = Duration::from_secs(60);
#[cfg(windows)]
const LOOP_LIMIT: usize = 3;

/// 다시 읽어도 되나 — 창 안의 최근 죽음 기록을 고치고 판정한다(순수 — 시험 대상).
#[cfg(any(windows, test))]
fn may_reload(
    recent: &mut Vec<std::time::Instant>,
    now: std::time::Instant,
    window: std::time::Duration,
    limit: usize,
) -> bool {
    recent.retain(|t| now.duration_since(*t) < window);
    if recent.len() >= limit {
        return false;
    }
    recent.push(now);
    true
}

/// 이 웹뷰에 감시를 건다(이미 걸었으면 아무것도 안 한다).
pub(crate) fn watch(webview: &tauri::Webview) {
    let label = webview.label().to_string();
    {
        let mut set = WATCHED.lock().unwrap_or_else(|e| e.into_inner());
        if !set.insert(label.clone()) {
            return;
        }
    }
    install(webview, label);
}

/// 창이 파괴됐다 — 같은 라벨의 새 창이 다시 걸 수 있게.
pub(crate) fn forget(label: &str) {
    WATCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(label);
}

#[cfg(windows)]
fn install(webview: &tauri::Webview, label: String) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
    };
    use webview2_com::ProcessFailedEventHandler;

    let result = webview.with_webview(move |pw| {
        let recent: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
        let label2 = label.clone();
        let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let (Some(sender), Some(args)) = (sender, args) else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            // SAFETY: WebView2 가 넘긴 살아 있는 인자 객체 — 콜백 안에서만 쓴다.
            unsafe { args.ProcessFailedKind(&mut kind)? };
            if kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                eprintln!("[aynx] 웹뷰 {label2}: 프로세스 실패(종류 {}) — 다시 읽지 않음", kind.0);
                return Ok(());
            }
            let mut recent = recent.lock().unwrap_or_else(|e| e.into_inner());
            if !may_reload(&mut recent, Instant::now(), LOOP_WINDOW, LOOP_LIMIT) {
                eprintln!("[aynx] 웹뷰 {label2}: 렌더러가 {}초 안에 {LOOP_LIMIT}번 죽음 — 더 다시 읽지 않음(크래시 고리)", LOOP_WINDOW.as_secs());
                return Ok(());
            }
            eprintln!("[aynx] 웹뷰 {label2}: 렌더러가 죽음 — 페이지를 다시 읽는다(세션은 다시 붙는다)");
            // SAFETY: 보낸 쪽 웹뷰 — 이 콜백은 그 웹뷰의 UI 스레드에서 온다.
            unsafe { sender.Reload() }
        }));
        let mut token = 0i64;
        // SAFETY: with_webview 콜백은 UI 스레드에서 돈다 — 컨트롤러·코어는 그 스레드의 것이다.
        let added = unsafe {
            pw.controller()
                .CoreWebView2()
                .and_then(|core| core.add_ProcessFailed(&handler, &mut token))
        };
        if let Err(e) = added {
            eprintln!("[aynx] 웹뷰 {label}: 렌더러 감시를 걸지 못함 — {e}");
            forget(&label);
        }
    });
    if let Err(e) = result {
        eprintln!("[aynx] 웹뷰 렌더러 감시를 걸지 못함 — {e}");
    }
}

/// 아직 구현하지 않은 OS — 렌더러 종료 감시 없음(그 OS 의 웹뷰가 스스로 다시 읽지 않으면 창이 빈 채 남는다).
#[cfg(not(windows))]
fn install(_webview: &tauri::Webview, _label: String) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forget_lets_the_same_label_watch_again() {
        // `watch` 는 Tauri 웹뷰가 있어야 해서 집합만 본다 — 걸었던 라벨은 지워야 다시 걸린다.
        WATCHED.lock().unwrap().insert("t-crash".into());
        assert!(!WATCHED.lock().unwrap().insert("t-crash".into()));
        forget("t-crash");
        assert!(WATCHED.lock().unwrap().insert("t-crash".into()));
        forget("t-crash");
    }

    #[test]
    fn reload_stops_after_a_crash_loop_and_resumes_when_it_ages_out() {
        use std::time::{Duration, Instant};
        let w = Duration::from_secs(60);
        let t = Instant::now();
        let mut recent = Vec::new();
        assert!(may_reload(&mut recent, t, w, 3));
        assert!(may_reload(&mut recent, t + Duration::from_secs(1), w, 3));
        assert!(may_reload(&mut recent, t + Duration::from_secs(2), w, 3));
        // 넷째 — 60초 안에 셋이 이미 있다.
        assert!(!may_reload(&mut recent, t + Duration::from_secs(3), w, 3));
        // 첫 죽음이 창 밖으로 나가면 다시 읽는다.
        assert!(may_reload(&mut recent, t + Duration::from_secs(61), w, 3));
    }
}
