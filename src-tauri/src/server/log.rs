//! 서버 로그 `instance::data_root()/server.log` — 분리 실행이라 콘솔이 없다. 1 MiB 를 넘으면 `server.log.1` 로 밀고
//! 새로 연다(두 장 — 최대 약 2 MiB). **비밀을 적지 않는다**(파이프 이름·pid·exe 경로·사유만).
//! 경로를 걸지 않았으면(시험·GUI 쪽) 아무것도 쓰지 않는다.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const ROTATE_AT: u64 = 1024 * 1024;

static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub(crate) fn init(path: PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    *PATH.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
}

/// 시험이 "로그에 비밀이 없다" 를 보려고 모으는 줄(시험 빌드만 — 경로와 무관하게 모은다).
#[cfg(test)]
pub(crate) static CAPTURED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 한 줄 — `시각 [pid] 내용`.
pub(crate) fn line(msg: impl std::fmt::Display) {
    #[cfg(test)]
    CAPTURED.lock().unwrap_or_else(|e| e.into_inner()).push(msg.to_string());
    let guard = PATH.lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = guard.as_ref() else { return };
    if std::fs::metadata(path).is_ok_and(|m| m.len() > ROTATE_AT) {
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
    let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let _ = writeln!(f, "{now} [{}] {msg}", std::process::id());
}
