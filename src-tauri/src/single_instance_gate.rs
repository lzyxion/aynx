//! **둘째 GUI 실행의 경합 메우기** — `tauri-plugin-single-instance` 앞에서 도는 문 하나(설계 10절 "중복 실행 0").
//!
//! 플러그인(2.4)은 뮤텍스(`<id>-sim`)가 이미 있으면 첫 인스턴스의 이벤트 창(`<id>-sic`/`<id>-siw`)을 `FindWindowW` 로 찾아
//! 넘기고 끝나는데, **창을 못 찾으면 그냥 계속 뜬다** — 첫 인스턴스가 뮤텍스를 만든 뒤 창을 만들기 전의 틈이다. 두 번 거의 동시에
//! 실행하면(바로 가기 두 번 누르기) 걸린다: 실측 10-10 `scripts/dev/survival` 의 `race` 행에서 GUI 가 둘 남았고, 둘째는 웹뷰도
//! 없이 창 없는 프로세스로 남았다.
//!
//! 그래서 플러그인보다 먼저 **우리 뮤텍스**(`<id>-gate`)를 잡는다. 먼저 만든 쪽이 첫 인스턴스이고(핸들은 프로세스가 끝날 때
//! 닫힌다), 이미 있으면 첫 인스턴스의 이벤트 창이 설 때까지 잠깐([`WAIT`]) 기다린다 — 그 뒤 플러그인이 창을 찾아 넘기고 끝낸다.
//! 첫 인스턴스가 그 사이 죽었으면(창이 끝내 안 선다) 시한 뒤 그냥 진행한다(플러그인이 다시 판정한다 — 예전과 같은 길).
//! OS 분기는 이 파일 하나이고 Windows 밖은 아직 스텁이다(그 OS 의 플러그인은 DBus·소켓이라 이 틈이 없거나 다르다 — 붙일 때 같은 자리).

#[cfg(windows)]
use std::time::{Duration, Instant};

/// 첫 인스턴스의 이벤트 창을 기다리는 상한 — 첫 인스턴스의 플러그인 setup 은 보통 수십 ms 안이다.
#[cfg(windows)]
const WAIT: Duration = Duration::from_secs(5);

/// 플러그인 앞에서 부른다. `identifier` 는 Tauri identifier(개발 빌드는 `-dev` — 플러그인과 같은 값이어야 한다).
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

    /// 이벤트 창이 없는 이름 — 둘째 부름은 시한까지 기다렸다가 돌아온다(막히지 않는다). 첫 부름은 곧바로.
    #[test]
    fn second_caller_waits_then_proceeds_when_no_window_appears() {
        let id = format!("aynx-gate-test-{}", std::process::id());
        let t = Instant::now();
        wait_for_first_instance(&id);
        assert!(
            t.elapsed() < Duration::from_millis(500),
            "첫 부름은 기다리지 않는다"
        );
        // 같은 프로세스의 둘째 부름도 이미 있는 뮤텍스를 본다 — 창이 없으니 WAIT 뒤 진행.
        let t = Instant::now();
        wait_for_first_instance(&id);
        assert!(t.elapsed() >= WAIT, "창이 서기를 기다렸다");
    }
}
