//! 둘째 GUI 실행의 경합 메우기 — `tauri-plugin-single-instance` 앞에서 도는 문 하나.
//!
//! 플러그인(2.4)은 뮤텍스(`<id>-sim`)가 있어도 첫 인스턴스의 이벤트 창(`<id>-sic`/`<id>-siw`)을 **못 찾으면 그냥 계속 뜬다** —
//! 뮤텍스와 창 사이의 틈이라 거의 동시에 두 번 실행하면 GUI 가 둘 남는다(`scripts/dev/survival` 의 `race` 행). 그래서 플러그인보다
//! 먼저 우리 뮤텍스(`<id>-gate`)를 잡고, 이미 있으면 그 창이 설 때까지 [`WAIT`] 만큼 기다린 뒤 플러그인에 넘긴다.
//! Windows 밖은 아직 스텁이다(그 OS 의 플러그인은 DBus·소켓이라 이 틈이 없거나 다르다 — 붙일 때 같은 자리).

#[cfg(windows)]
use std::time::{Duration, Instant};

#[cfg(windows)]
const WAIT: Duration = Duration::from_secs(5);

/// 플러그인 앞에서 부른다. `identifier` 는 플러그인과 같은 값이어야 한다(개발 빌드는 `-dev`).
pub(crate) fn wait_for_first_instance(identifier: &str) {
    imp(identifier);
}

#[cfg(windows)]
fn imp(identifier: &str) {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

    let wide = |s: String| {
        s.encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    };
    let gate = wide(format!("{identifier}-gate"));
    // SAFETY: 이름은 널로 끝난 UTF-16. 핸들은 일부러 닫지 않는다 — 이 프로세스가 사는 동안 "첫 인스턴스" 표식이다.
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, gate.as_ptr()) };
    if handle.is_null() {
        return;
    }
    // SAFETY: 바로 앞 호출의 마지막 오류.
    if unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
        return; // 첫 인스턴스
    }
    let class = wide(format!("{identifier}-sic"));
    let window = wide(format!("{identifier}-siw"));
    let start = Instant::now();
    while start.elapsed() < WAIT {
        // SAFETY: 널로 끝난 UTF-16 두 개.
        if !unsafe { FindWindowW(class.as_ptr(), window.as_ptr()) }.is_null() {
            return; // 플러그인이 찾아 넘기고 끝낸다
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    eprintln!(
        "[aynx] 다른 인스턴스가 떠 있는데 {}초 안에 창이 서지 않았습니다 — 그대로 진행합니다",
        WAIT.as_secs()
    );
}

/// 아직 구현하지 않은 OS — 문 없음(플러그인 판정 그대로).
#[cfg(not(windows))]
fn imp(_identifier: &str) {}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn second_caller_waits_then_proceeds_when_no_window_appears() {
        let id = format!("aynx-gate-test-{}", std::process::id());
        let t = Instant::now();
        wait_for_first_instance(&id);
        assert!(
            t.elapsed() < Duration::from_millis(500),
            "첫 부름은 기다리지 않는다"
        );
        let t = Instant::now();
        wait_for_first_instance(&id);
        assert!(t.elapsed() >= WAIT, "창이 서기를 기다렸다");
    }
}
