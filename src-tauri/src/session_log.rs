//! 세션 로깅 — 원격이 보낸 원시 바이트를 로컬 파일로 tee 한다(호스트별 옵트인 · 기본 꺼짐 — docs/log/2026-09-02-triggers-webgl-logging.md).
//!
//! - 시퀀스(ANSI · OSC 133)를 벗기지 않는다 — 로그 재생의 재료라 벗기면 되돌릴 수 없다.
//! - 쓰기는 전용 std 스레드 — 출력 펌프(tokio) 안에서 파일에 쓰면 느린 디스크가 같은 런타임의 다른 세션 · keepalive 를 굶긴다.
//! - 실패는 경고 한 줄로 끝난다 — 로그를 못 쓴다고 접속이 막히면 안 된다.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use crate::i18n::tr;

/// Windows 가 파일 이름에 금지하는 문자 — 한글 · 공백 · 하이픈은 그대로 둔다.
const FORBIDDEN: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

const REPLACEMENT: char = '_';

const FALLBACK_STEM: &str = "session";

/// 경로 상한(Windows MAX_PATH) 때문에 별칭을 자른다 — 문자 단위.
const MAX_STEM_CHARS: usize = 64;

/// Windows 는 이름 끝의 점 · 공백을 조용히 잘라 내므로 미리 뗀다(안 그러면 `web.` 로 만든 파일을 다시 열 수 없다).
/// 예약 이름(`CON`·`NUL` …)은 다루지 않는다 — 이름 뒤에 늘 `-<시각>.log` 가 붙는다.
pub(crate) fn sanitize_alias(alias: &str) -> String {
    let mapped: String = alias
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c.is_control() {
                REPLACEMENT
            } else {
                c
            }
        })
        .take(MAX_STEM_CHARS)
        .collect();

    let trimmed = mapped.trim().trim_end_matches('.').trim_end();
    if trimmed.is_empty() {
        FALLBACK_STEM.to_string()
    } else {
        trimmed.to_string()
    }
}

/// `<별칭>-<YYYYMMDD-HHMMSS>.log` — `n` 이 2 부터면 `-<n>` 이 붙는다.
pub(crate) fn log_file_name(alias: &str, stamp: &str, n: u32) -> String {
    let stem = sanitize_alias(alias);
    if n <= 1 {
        format!("{stem}-{stamp}.log")
    } else {
        format!("{stem}-{stamp}-{n}.log")
    }
}

const MAX_NAME_TRIES: u32 = 100;

fn now_stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// 설정 루트가 아니라 데이터 루트다 — 로그는 앱이 쌓는 데이터다.
pub(crate) fn logs_dir() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("logs"))
}

fn ensure_logs_dir_at(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| {
        tr!(
            ko: "{what} 폴더를 만들지 못했습니다: {e}",
            en: "Could not create the folder {what}: {e}",
            what = dir.display()
        )
    })
}

fn logs_dir_or_err() -> Result<PathBuf, String> {
    logs_dir().ok_or_else(
        || tr!(ko: "데이터 디렉터리를 찾을 수 없습니다", en: "Could not find the data folder"),
    )
}

/// `create_new` 여야 한다 — 같은 초에 열린 같은 호스트 타일 둘의 바이트가 한 파일에 섞이지 않게.
pub(crate) fn create_unique_in(
    dir: &Path,
    alias: &str,
    stamp: &str,
) -> Result<(PathBuf, std::fs::File), String> {
    // 로그에는 원격에 친 것(토큰 · 명령)이 그대로 든다 — 유닉스는 소유자만 읽게 0600 으로 못 박는다.
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = std::fs::OpenOptions::new();
    options.append(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);

    for n in 1..=MAX_NAME_TRIES {
        let path = dir.join(log_file_name(alias, stamp, n));
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(tr!(
                    ko: "{what} 을(를) 열지 못했습니다: {e}",
                    en: "Could not open {what}: {e}",
                    what = path.display()
                ))
            }
        }
    }
    Err(tr!(
        ko: "{what} 에 같은 이름의 로그가 너무 많습니다 ({stamp})",
        en: "Too many logs with the same name in {what} ({stamp})",
        what = dir.display()
    ))
}

/// 쓰기가 한 번 실패하면 그 세션의 로깅을 멈춘다 — 재시도하면 경고가 초당 수백 줄 쌓인다.
pub(crate) fn spawn_writer(path: &Path, file: std::fs::File) -> mpsc::Sender<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let display = path.display().to_string();

    std::thread::spawn(move || {
        let mut writer = std::io::BufWriter::new(file);
        while let Ok(chunk) = rx.recv() {
            if let Err(e) = writer.write_all(&chunk) {
                eprintln!("[aynx] 세션 로그 쓰기 실패 — 이 세션의 로깅을 멈춥니다 ({display}): {e}");
                break;
            }
        }
        // BufWriter 의 drop flush 는 실패를 삼키므로 직접 부른다
        if let Err(e) = writer.flush() {
            eprintln!("[aynx] 세션 로그를 마무리하지 못했습니다 ({display}): {e}");
        }
    });

    tx
}

pub(crate) struct StartedLog {
    pub(crate) path: String,
    /// 떨어지면 쓰기 스레드가 flush 하고 파일을 닫는다.
    pub(crate) tx: mpsc::Sender<Vec<u8>>,
}

pub(crate) fn start(alias: &str) -> Option<StartedLog> {
    let opened = logs_dir_or_err().and_then(|dir| {
        ensure_logs_dir_at(&dir)?;
        create_unique_in(&dir, alias, &now_stamp())
    });
    match opened {
        Ok((path, file)) => {
            let tx = spawn_writer(&path, file);
            eprintln!("[aynx] 세션 로깅: {}", path.display());
            Some(StartedLog {
                path: path.display().to_string(),
                tx,
            })
        }
        Err(e) => {
            eprintln!("[aynx] 세션 로깅을 시작하지 못했습니다: {e}");
            None
        }
    }
}

// ── 프런트로 내는 두 문 ── 경로만 답한다(앱이 파일을 대신 읽어 주지 않는다)

/// 로컬 세션은 늘 `None`(로깅은 호스트별 옵트인) — 그래도 문을 열어 두는 것은 프런트가 갈래를 갖지 않게 하려는 것이다.
#[tauri::command]
pub async fn session_log_path(kind: String, id: u32) -> Result<Option<String>, String> {
    Ok(match kind.as_str() {
        "local" => None,
        "ssh" => crate::server::ssh_proxy::log_path(id).await,
        other => {
            return Err(tr!(
                ko: "알 수 없는 세션 종류: {other}",
                en: "Unknown session kind: {other}"
            ))
        }
    })
}

/// 답하기 전에 폴더를 만든다 — 로그를 한 번도 켜지 않았으면 OS 가 "찾을 수 없습니다" 를 띄운다
/// (docs/log/2026-09-17-scrollback-export-and-logs.md).
#[tauri::command]
pub async fn session_logs_dir() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = logs_dir_or_err()?;
        ensure_logs_dir_at(&dir)?;
        Ok(dir.display().to_string())
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "로그 폴더를 준비하는 작업이 실패했습니다: {e}",
            en: "The task that prepares the logs folder failed: {e}"
        )
    })?
}

#[cfg(test)]
mod tests;
