//! **잠자기 방지**(keep awake — 2026-10-23 사용자 확정) — 독 실행 판의 ☕ 칸이 켜고 끈다.
//!
//! 결정(사용자): **시스템만 깨운다**(디스플레이는 꺼져도 된다 — 디스플레이 옵션 없음) · **앱 시작 때 늘 꺼짐**(저장하지 않는다) ·
//! 트레이에 남아 있어도 유지 · **GUI 프로세스가 끝나면 풀린다**. 그래서 이 일은 세션 서버가 아니라 GUI 프로세스 몫이다 —
//! 요청 핸들을 이 프로세스가 쥐고, 프로세스가 끝나면 OS 가 핸들과 함께 요청을 거둔다(명시적인 정리 코드가 없어도 풀린다).
//!
//! ## OS 분기는 이 파일의 함수 **하나** 안에서만 갈린다
//!
//! `crate::cwd` 와 같은 모양이다: OS 를 타는 몸은 [`os_request`] 하나, 아직 구현하지 않은 OS(Linux · macOS)는 **명시적인 `None`
//! 스텁**이다 — 그 스텁이 곧 "여기가 비어 있다" 는 문서다. 프런트는 OS 를 모른다 — [`keep_awake_status`] 의 `supported` 하나로
//! 칸을 세우거나 숨긴다.
//!
//! ## Windows: 전원 요청 객체
//!
//! `SetThreadExecutionState` 는 **부른 스레드에 묶인다** — async 명령은 tokio 일꾼 스레드에서 돌고 그 스레드는 다음 일을 받거나
//! 사라지므로 요청이 엉뚱하게 남거나 풀린다. 그래서 스레드에 묶이지 않는 `PowerCreateRequest` → `PowerSetRequest(
//! PowerRequestSystemRequired)` 를 쓰고, 끌 때 `PowerClearRequest` + `CloseHandle` 한다. 핸들은 전역 `Mutex` 하나가 쥔다.

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// 켜진 동안 쥐고 있는 OS 요청 — 놓으면(`Drop`) 풀린다.
struct Request {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// HANDLE 은 날 포인터라 `Send` 가 아니다 — 전원 요청 핸들은 스레드에 묶이지 않으므로(머리말) 어느 스레드에서 놓아도 된다.
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

/// 지금 켜져 있으면 `Some`. 앱 시작 때 늘 `None`(저장하지 않는다 — 머리말).
static ACTIVE: Mutex<Option<Request>> = Mutex::new(None);

/// **OS 분기는 여기 한 곳뿐이다** — 시스템 잠자기를 막는 요청을 하나 만든다. 이 OS 가 지원하지 않거나 실패하면 `None`.
fn os_request() -> Option<Request> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Power::{PowerCreateRequest, PowerSetRequest, PowerRequestSystemRequired};
        use windows_sys::Win32::System::Threading::{REASON_CONTEXT, REASON_CONTEXT_0, POWER_REQUEST_CONTEXT_SIMPLE_STRING};

        // 전원 관리 진단(`powercfg /requests`)에 보이는 사유 — 호출 동안만 살아 있으면 된다(OS 가 복사한다).
        let mut reason: Vec<u16> = "AYNX keep awake".encode_utf16().chain(std::iter::once(0)).collect();
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

/// 이 OS 에 잠자기 방지가 있나 — Windows 만(머리말의 스텁).
fn supported() -> bool {
    cfg!(windows)
}

fn status_json(on: bool) -> Value {
    json!({ "supported": supported(), "on": on })
}

/// 켜고 끈다 — 이미 그 상태면 아무것도 하지 않는다. 결과는 지금 상태(`true` = 켜짐). 켜기에 실패하면 꺼진 채 `false`.
fn set(on: bool) -> bool {
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    if on {
        if active.is_none() {
            *active = os_request();
        }
    } else {
        // `Drop` 이 요청을 풀고 핸들을 닫는다
        *active = None;
    }
    active.is_some()
}

/// 지금 상태 — `{ supported, on }`. 칸을 세울지(`supported`)와 칸의 켜짐(`on`)을 함께 준다.
#[tauri::command]
pub async fn keep_awake_status() -> Result<Value, String> {
    let on = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    Ok(status_json(on))
}

/// 켜고 끈다 — 모든 창(과 상태바 ☕)이 같은 값을 보도록 `keep-awake` 이벤트로 알린다. 돌려주는 것은 `{ supported, on }`.
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
        // 실제 전원 요청을 건다(Windows) — 켜고 바로 끈다. 미지원 OS 에서는 늘 꺼짐이다.
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
