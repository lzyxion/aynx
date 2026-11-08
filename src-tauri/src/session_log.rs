//! 세션 로깅 — 원격이 보낸 **원시 바이트**를 로컬 파일로 tee 한다.
//!
//! `~/.ssh/sessions.toml` 의 `[hosts.<별칭>] log = true` 인 호스트에만 붙고,
//! 기본은 꺼짐이다 (docs/log/2026-09-02-triggers-webgl-logging.md).
//!
//! ```text
//!   russh 채널 ──► [tee] ──► session_log 쓰기 스레드 ──► <data_dir>/aynx/logs/<별칭>-<시각>[-N].log
//!                     │
//!                     └────► 4ms/64KB 배칭 ──► 웹뷰 (기존 경로, 무변화)
//! ```
//!
//! ## 시퀀스를 벗겨내지 않는다
//!
//! 파일에는 ANSI 이스케이프·OSC 133 마커·커서 이동까지 **도착한 그대로** 들어간다.
//! 사람이 `cat` 으로 읽기 좋은 텍스트를 만드는 것이 목적이 아니라, 로드맵 4단계의
//! **"로그 재생"**(세션을 그대로 되감아 터미널에 다시 흘리기)의 재료를 남기는 것이 목적이다.
//! 시퀀스를 벗기면 화면이 어떻게 보였는지가 사라져 재생이 불가능해진다.
//! 읽기 좋은 텍스트가 필요하면 재생 쪽에서 만들면 되지만, 그 반대는 되돌릴 수 없다.
//!
//! ## 왜 별도 스레드인가
//!
//! tee 지점은 SSH 출력 펌프(tokio 태스크) 안이다. 거기서 파일에 직접 쓰면 디스크가 느릴 때
//! 런타임 워커를 물고 늘어져 **같은 런타임의 다른 세션과 keepalive 까지 굶는다**
//! (`Gate::wait_async` 가 블로킹이 아니어야 하는 것과 같은 이유). 그래서 배처와 같은 모양으로
//! 전용 std 스레드에 채널로 넘긴다. 송신자가 떨어지면(= 펌프 태스크 종료) 스레드가
//! flush 하고 파일을 닫는다.
//!
//! ## 실패는 세션에 영향을 주지 않는다
//!
//! 폴더를 못 만들거나 파일을 못 열면 경고 한 줄만 남기고 tee 없이 진행한다. 로그를 못 쓴다고
//! 접속이 막히면 안 된다 — 로깅은 보조 기능이다.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use crate::i18n::tr;

/// 파일 이름에서 바꿔 치울 문자 — Windows 가 금지하는 것들.
/// **한글·공백·하이픈은 그대로 둔다** (별칭이 `내 서버` 여도 알아볼 수 있어야 한다).
const FORBIDDEN: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

/// 금지 문자를 바꿔 넣을 글자.
const REPLACEMENT: char = '_';

/// 별칭이 통째로 사라졌을 때 쓰는 이름 (`"???"` 같은 별칭).
const FALLBACK_STEM: &str = "session";

/// 이름이 너무 길면 경로 상한(Windows MAX_PATH)에 걸린다 — 별칭 쪽을 자른다.
/// 문자 단위로 자른다 (한글이 바이트 중간에서 잘리지 않게).
const MAX_STEM_CHARS: usize = 64;

/// 별칭을 파일 이름에 넣을 수 있는 모양으로 — **순수 함수** (유닛 테스트 대상).
///
/// - 금지 문자(`\ / : * ? " < > |`)와 제어 문자는 `_` 로 바꾼다.
/// - Windows 는 이름 끝의 점·공백을 조용히 잘라 내므로 여기서 미리 떼어 낸다
///   (안 그러면 `web.` 로 만든 파일을 `web` 으로 다시 열 수 없다).
/// - 남은 것이 없으면 [`FALLBACK_STEM`].
///
/// 예약 이름(`CON`·`NUL` …)은 따로 다루지 않는다 — 파일 이름이 언제나
/// `<별칭>-<시각>.log` 라서 별칭만으로 예약 이름이 되는 경우가 없다.
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

    // 앞뒤 공백과 **끝의 점**을 떼어 낸다.
    let trimmed = mapped.trim().trim_end_matches('.').trim_end();
    if trimmed.is_empty() {
        FALLBACK_STEM.to_string()
    } else {
        trimmed.to_string()
    }
}

/// `<별칭>-<YYYYMMDD-HHMMSS>.log` — **순수 함수** (유닛 테스트 대상).
///
/// `n` 은 같은 이름이 이미 있을 때 붙이는 차례다 — 1 이면 접미사 없이, 2 부터
/// `<별칭>-<시각>-<n>.log`. 같은 호스트 타일 둘이 같은 초에 열리면(배치 복원) 한 파일에
/// 섞이던 것을 [`create_unique_in`] 이 이것으로 피한다.
pub(crate) fn log_file_name(alias: &str, stamp: &str, n: u32) -> String {
    let stem = sanitize_alias(alias);
    if n <= 1 {
        format!("{stem}-{stamp}.log")
    } else {
        format!("{stem}-{stamp}-{n}.log")
    }
}

/// [`create_unique_in`] 이 접미사를 올려 볼 상한. 같은 초에 같은 호스트 타일이 이만큼
/// 열릴 일은 없다 — 넘으면 그냥 실패(경고 한 줄)로 둔다.
const MAX_NAME_TRIES: u32 = 100;

/// 지금 시각을 `YYYYMMDD-HHMMSS` 로 (로컬 시간). 파일 이름에만 쓴다.
fn now_stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// `<data_dir>/aynx/logs`.
///
/// `config_dir`(설정) 이 아니라 `data_dir` 인 것이 요점이다 — 로그는 사용자가 손으로 고칠
/// 설정이 아니라 앱이 쌓는 데이터다. Windows 는 `%APPDATA%`, Linux 는
/// `~/.local/share`, macOS 는 `~/Library/Application Support`.
pub(crate) fn logs_dir() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("logs"))
}

/// 주어진 폴더를 **있게 만든다** — 이미 있으면 아무 일도 하지 않는다(멱등).
///
/// [`logs_dir`] 를 부르지 않고 경로를 받는 이유는 하나다: 그래야 테스트가 임시 폴더로
/// 부를 수 있다. 부르는 자리는 둘 — 로깅 시작([`start`])과 **폴더 열기**
/// ([`session_logs_dir`]). 뒤쪽이 이것을 부르지 않던 동안, 로그를 한 번도 쓰지 않은
/// 사람이 "로그 폴더 열기" 를 누르면 탐색기가 "찾을 수 없습니다" 를 띄웠다
/// (docs/log/2026-09-17-scrollback-export-and-logs.md).
fn ensure_logs_dir_at(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| {
        tr!(
            ko: "{what} 폴더를 만들지 못했습니다: {e}",
            en: "Could not create the folder {what}: {e}",
            what = dir.display()
        )
    })
}

/// [`logs_dir`] 를 `Result` 로 — "데이터 디렉터리가 없다" 는 프런트에 보일 한 줄이 된다.
fn logs_dir_or_err() -> Result<PathBuf, String> {
    logs_dir().ok_or_else(
        || tr!(ko: "데이터 디렉터리를 찾을 수 없습니다", en: "Could not find the data folder"),
    )
}

/// `dir` 안에 이 세션만의 **새** 로그 파일을 만든다 — 이름이 이미 있으면 `-2`, `-3` … 을
/// 붙여 다시 시도한다([`MAX_NAME_TRIES`] 까지).
///
/// `create_new` 라 남의 파일에 이어 쓰는 일이 없다 — 예전엔 `create + append` 여서 같은 초에
/// 열린 같은 호스트 타일 둘의 바이트가 한 파일에 섞였다(재생 재료로 쓸 수 없게 된다).
/// 경로를 받는 이유는 [`ensure_logs_dir_at`] 과 같다(테스트가 임시 폴더로 부른다).
pub(crate) fn create_unique_in(
    dir: &Path,
    alias: &str,
    stamp: &str,
) -> Result<(PathBuf, std::fs::File), String> {
    // 세션 로그에는 원격에 친 것이 그대로 들어간다(토큰·경로·명령). 유닉스 기본 umask 는
    // 같은 기기의 다른 사용자에게 읽기를 열어 준다 — 소유자만 읽고 쓰게 못 박는다(F8).
    // import 도 `#[cfg(unix)]` 로 묶어야 윈도우 빌드에 unused import 경고가 나지 않는다.
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

/// 열린 파일로 쓰기 스레드를 띄운다 — 테스트가 부르는 알맹이.
///
/// 반환한 송신자를 떨어뜨리면 스레드가 flush 후 파일을 닫고 끝난다.
/// 쓰기가 한 번이라도 실패하면(디스크 가득 참 등) 경고 한 줄을 남기고 **그 세션의 로깅을
/// 아예 멈춘다** — 실패는 보통 계속 실패하고, 재시도하면 경고가 초당 수백 줄 쌓인다.
/// 송신자는 살아 있으므로 펌프 태스크는 아무것도 모른 채 그대로 돈다 (세션에 영향 없음).
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
        // 송신자가 사라졌다 = 세션 종료. 여기서 flush 하고 파일을 닫는다
        // (BufWriter 는 drop 에서도 flush 하지만 그 실패는 삼켜지므로 직접 부른다).
        if let Err(e) = writer.flush() {
            eprintln!("[aynx] 세션 로그를 마무리하지 못했습니다 ({display}): {e}");
        }
    });

    tx
}

/// 시작된 로깅 한 벌 — 펌프가 쥘 송신자와, **세션 표에 적어 둘 경로**.
///
/// 경로를 함께 내보내는 이유는 하나다: 예전에는 이 값이 `eprintln!` 한 줄로만 남아
/// 사용자가 "내 로그가 어디 있는가" 를 물을 자리가 없었다. 세션 표가 들고 있으면
/// [`session_log_path`] 가 그대로 답한다 (docs/log/2026-09-17-scrollback-export-and-logs.md).
pub(crate) struct StartedLog {
    /// 이 세션이 쓰고 있는 파일. 표에 적히고 프런트의 "세션 로그 열기" 가 이것을 연다.
    pub(crate) path: String,
    /// 출력 펌프 태스크가 소유한다 — 떨어지면 쓰기 스레드가 flush 하고 파일을 닫는다.
    pub(crate) tx: mpsc::Sender<Vec<u8>>,
}

/// 이 호스트의 세션 로깅을 시작한다. 실패하면 경고 한 줄 + `None` (세션은 그대로 진행).
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

// ---------------------------------------------------------------------------
// 프런트로 내는 두 문 (docs/log/2026-09-17-scrollback-export-and-logs.md)
//
// 로그는 지금까지 **쓰기만 하고 읽을 길이 없던** 기능이었다. 타일 ⋯ 메뉴의 "세션 로그
// 열기"·"로그 폴더 열기" 가 그 두 길이고, 여는 일 자체는 프런트가 `plugin-opener` 로
// 한다 — 여기서는 **경로만** 답한다(앱이 파일을 대신 읽어 주지 않는다).
// ---------------------------------------------------------------------------

/// 이 세션이 지금 쓰고 있는 로그 파일 (로깅이 꺼져 있으면 `None`).
///
/// 종류를 `kind` 하나로 받는 모양은 [`crate::session_commands::session_stats`] 와 같다 — 프런트에서는
/// 타일 종류를 가리지 않는 한 함수이기 때문이다. **로컬 세션은 언제나 `None`** 이다:
/// 세션 로깅은 `sessions.toml` 의 호스트 항목에 붙는 옵트인이라 로컬 셸은 범위 밖이다
/// (이 파일 머리말). 그래도 문을 로컬에도 열어 두는 이유는 프런트가 갈래를 갖지 않게
/// 하기 위해서고, 답이 `None` 이면 메뉴의 그 줄이 흐려질 뿐이다.
///
/// `async` 인 이유는 규칙 그대로다 (docs/conventions.md) — 하는 일은 표 잠금 한 번뿐이지만
/// 애매하면 `async` 다.
#[tauri::command]
pub async fn session_log_path(kind: String, id: u32) -> Result<Option<String>, String> {
    Ok(match kind.as_str() {
        // 로컬 PTY 에는 tee 자체가 붙지 않는다 (위 머리말).
        "local" => None,
        // SSH 세션(과 그 tee)은 세션 서버에 산다(③-3b2) — 경로만 묻는다.
        "ssh" => crate::server::ssh_proxy::log_path(id).await,
        other => {
            return Err(tr!(
                ko: "알 수 없는 세션 종류: {other}",
                en: "Unknown session kind: {other}"
            ))
        }
    })
}

/// 로그가 쌓이는 폴더 — `<data_dir>/aynx/logs`. **답하기 전에 만들어 둔다.**
///
/// 예전에는 경로만 답했다. 그런데 폴더는 로깅이 처음 시작될 때에야 생기므로(`start`),
/// 로그를 한 번도 켜지 않은 사람이 "로그 폴더 열기" 를 누르면 OS 가 "…\aynx\logs 을(를) 찾을
/// 수 없습니다" 를 띄웠다. 빈 폴더를 만들어 주는 편이 그 오류보다 낫다 — 사용자가 물은 것은
/// "로그가 쌓이는 자리" 이고, 그 자리는 비어 있을 수 있다
/// (docs/log/2026-09-17-scrollback-export-and-logs.md).
///
/// 만들지 못하면 `Err` 로 **보일 한 줄**을 준다(프런트가 그대로 띄운다). `Option` 이 아닌
/// 이유도 같다 — "데이터 디렉터리를 찾을 수 없다" 는 조용한 `null` 이 아니라 말해야 할 실패다.
///
/// `spawn_blocking` 인 이유는 다른 파일 명령들과 같다 (docs/conventions.md) — 디스크에 손을
/// 대는 일은 웹뷰 UI 스레드에서 돌면 안 된다.
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
