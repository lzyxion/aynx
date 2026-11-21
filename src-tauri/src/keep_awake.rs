//! **잠자기 방지** — 독 실행 판의 ☕ 칸이 켜고 끈다.
//!
//! 시스템만 깨우고(디스플레이 옵션 없음) 앱 시작 때 늘 꺼짐(저장하지 않는다)이다. GUI 프로세스 몫이다 — 프로세스가 끝나면
//! OS 가 핸들과 함께 요청을 거둔다.
//!
//! OS 분기는 [`os_request`] 하나이고 아직 구현하지 않은 OS 는 명시적인 `None` 스텁이다 — 프런트는 `supported` 만 본다.
//!
//! Windows: `SetThreadExecutionState` 는 부른 스레드에 묶여 tokio 일꾼 스레드에서는 요청이 엉뚱하게 남거나 풀린다 — 스레드에
//! 묶이지 않는 `PowerCreateRequest` → `PowerSetRequest(PowerRequestSystemRequired)` 를 쓴다.

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct Request {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// HANDLE 은 날 포인터라 `Send` 가 아니다 — 전원 요청 핸들은 스레드에 묶이지 않으므로 어느 스레드에서 놓아도 된다.
#[cfg(windows)]
unsafe impl Send for Request {}

#[cfg(windows)]
impl Drop for Request {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Power::{PowerClearRequest, PowerRequestSystemRequired};
        // SAFETY: `handle` 은 `os_request` 가 만든 유효한 전원 요청 핸들이고 여기서 한 번만 닫는다.
        unsafe {
            PowerClearRequest(self.handle, PowerRequestSystemRequired);
            CloseHandle(self.handle);
        }
    }
}

static ACTIVE: Mutex<Option<Request>> = Mutex::new(None);

/// **OS 분기는 여기 한 곳뿐이다** — 시스템 잠자기를 막는 요청을 하나 만든다. 이 OS 가 지원하지 않거나 실패하면 `None`.
fn os_request() -> Option<Request> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Power::{PowerCreateRequest, PowerSetRequest, PowerRequestSystemRequired};
        use windows_sys::Win32::System::Threading::{REASON_CONTEXT, REASON_CONTEXT_0, POWER_REQUEST_CONTEXT_SIMPLE_STRING};

        // 사유 문자열은 호출 동안만 살아 있으면 된다(OS 가 복사한다).
        let mut reason: Vec<u16> = "Aynx keep awake".encode_utf16().chain(std::iter::once(0)).collect();
        let ctx = REASON_CONTEXT {
            Version: 0, // POWER_REQUEST_CONTEXT_VERSION
            Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
            Reason: REASON_CONTEXT_0 { SimpleReasonString: reason.as_mut_ptr() },
        };
        // SAFETY: `ctx` 와 그 사유 문자열은 이 호출 동안 살아 있다. 돌려받은 핸들은 실패면 닫고, 성공이면 `Request` 가 쥔다.
        unsafe {
            let handle = PowerCreateRequest(&ctx);
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                return None;
            }
            if PowerSetRequest(handle, PowerRequestSystemRequired) == 0 {
                CloseHandle(handle);
                return None;
            }
            Some(Request { handle })
        }
    }
    #[cfg(not(windows))]
    {
        // Linux(systemd-inhibit · D-Bus) · macOS(IOPMAssertion) — 아직 없다. 프런트는 `supported: false` 를 보고 칸을 숨긴다.
        None
    }
}

fn supported() -> bool {
    cfg!(windows)
}

fn status_json(on: bool) -> Value {
    json!({ "supported": supported(), "on": on })
}

fn set(on: bool) -> bool {
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    if on {
        if active.is_none() {
            *active = os_request();
        }
    } else {
        *active = None;
    }
    active.is_some()
}

#[tauri::command]
pub async fn keep_awake_status() -> Result<Value, String> {
    let on = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    Ok(status_json(on))
}

/// 모든 창(과 상태바 ☕)이 같은 값을 보도록 `keep-awake` 이벤트로 알린다.
#[tauri::command]
pub async fn keep_awake_set(app: AppHandle, on: bool) -> Result<Value, String> {
    if on && !supported() {
        return Err("keep awake is not supported on this OS".into());
    }
    let now = set(on);
    let _ = app.emit("keep-awake", now);
    Ok(status_json(now))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_is_idempotent_and_off_releases() {
        let first = set(true);
        assert_eq!(first, supported());
        assert_eq!(set(true), first, "두 번 켜도 요청은 하나");
        assert!(!set(false));
        assert!(!set(false), "두 번 꺼도 그대로");
    }

    #[test]
    fn status_shape() {
        let v = status_json(false);
        assert_eq!(v["supported"], json!(supported()));
        assert_eq!(v["on"], json!(false));
    }
}
