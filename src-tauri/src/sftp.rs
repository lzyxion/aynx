//! SFTP — **원격 파일 편집**(외부 에디터 왕복)과 **드래그 업로드**.
//!
//! ```text
//!  [편집]  edit_remote_file(session, "~/nginx.conf")
//!            │  SftpSession.read  → data_dir()/aynx/edit/<세션-경로>/nginx.conf
//!            │  opener 로 기본 편집기 열기
//!            ▼
//!          감시 태스크 (2초 폴링, mtime 변화 감지)
//!            │  변하면 원자적으로 재업로드 → app.emit("sftp-uploaded")
//!            ▼
//!          stop_edit / 세션 종료로 멈춘다 (로컬 파일은 남긴다)
//!
//!  [업로드] upload_file(raw 바디 = 파일 바이트, 메타는 헤더)
//!            │  remote_dir + 파일명 → 같은 이름이 이미 있으면 오류(덮어쓰기는 프런트 확인 뒤)
//!            ▼
//!          SftpSession.create + write_all
//! ```
//!
//! ## 세션당 SFTP 채널 캐시
//!
//! SFTP 는 SSH 세션 위의 **서브시스템 채널 하나**다. 파일 하나 만질 때마다 채널을 새로
//! 열면 매번 `channel_open_session` → `request_subsystem` → `INIT/VERSION` 왕복이 붙는다
//! (레이턴시가 큰 원격에서는 그 자체가 전송 시간보다 오래 걸린다). 그래서 세션 id 로
//! 채널을 캐시하고, 세션이 닫힐 때([`crate::ssh::close_ssh`]) 함께 버린다 —
//! [`crate::port_forward`] 의 수명 규칙과 **정확히 같은 자리**를 탄다.
//!
//! ## 크기 상한이 왜 필요한가
//!
//! russh-sftp 2.4 는 쓰기만 최대 8개를 겹쳐 보내고(패킷 256KiB), **읽기는 한 요청씩
//! 순차**다 (docs/verification/russh.md 5절 — 파이프라이닝 이슈 #70). 즉 다운로드
//! 시간은 대략 `파일크기 / 256KiB × RTT` 로 레이턴시에 묶인다. RTT 50ms 면 10MB 에
//! 2초, 100MB 에 20초가 **왕복 대기만으로** 든다. 진행률도 취소도 없는 지금 단계에서
//! 그보다 큰 파일을 받아 놓고 앱이 멈춘 것처럼 보이게 두는 것보다, 상한에서 한국어로
//! 거절하는 편이 정직하다 (편집 10MB · 업로드 100MB).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime};

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncWriteExt;
use tokio::task::AbortHandle;

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/// 편집으로 내려받을 수 있는 최대 크기 (10MB — 모듈 주석의 근거).
const EDIT_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// 업로드 최대 크기 (100MB). 청크 스트리밍이 생기기 전까지는 통째로 메모리에 올린다.
const UPLOAD_MAX_BYTES: usize = 100 * 1024 * 1024;

/// 로컬 파일 변경 감시 주기.
const POLL: Duration = Duration::from_secs(2);

/// 저장이 **끝났다고 보는** 유예. 편집기가 쓰는 도중에 mtime 이 먼저 올라올 수 있어,
/// 마지막 변경이 이만큼 지나기 전에는 업로드하지 않는다 (다음 폴링에서 다시 본다).
const SETTLE: Duration = Duration::from_millis(500);

/// 요청 하나의 응답 대기 시간. 기본값 10초는 큰 파일의 마지막 쓰기 확인에 모자란다
/// (docs/verification/russh.md 5절 — #95).
const TIMEOUT_SECS: u64 = 60;

/// 채널을 여는 데 허용하는 시간 (전역 잠금을 쥐는 구간이라 상한이 필요하다).
const OPEN_TIMEOUT: Duration = Duration::from_secs(20);

// ---------------------------------------------------------------------------
// 전역 상태
// ---------------------------------------------------------------------------

/// 세션 id → 그 세션의 SFTP 채널.
///
/// **tokio 뮤텍스**인 이유는 잠금을 쥔 채 채널을 여는 `await` 를 하기 때문이다 — 같은
/// 세션에 두 요청이 동시에 들어와도 채널이 두 번 열리지 않는다 (열어 놓고 하나를 버리면
/// 서버 쪽에 유령 채널이 남는다). 여는 동안은 다른 세션의 조회도 함께 기다리지만,
/// 그 구간은 왕복 몇 번이고 전송 자체는 잠금 밖에서 돈다.
static SFTP: LazyLock<tokio::sync::Mutex<HashMap<u32, Arc<SftpSession>>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));

/// 편집 id → 감시 중인 편집 하나. (`port_forward::FORWARDS` 와 같은 이유로 전역이다 —
/// `close_ssh` 가 다른 모듈의 상태 타입을 몰라도 정리할 수 있어야 한다.)
static EDITS: LazyLock<Mutex<HashMap<u32, Edit>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_EDIT_ID: AtomicU32 = AtomicU32::new(1);

/// 감시 중인 편집 하나.
struct Edit {
    session_id: u32,
    remote_path: String,
    local_path: PathBuf,
    file_name: String,
    abort: AbortHandle,
}

impl Edit {
    fn info(&self, id: u32) -> EditInfo {
        EditInfo {
            id,
            session_id: self.session_id,
            remote_path: self.remote_path.clone(),
            local_path: self.local_path.to_string_lossy().into_owned(),
            file_name: self.file_name.clone(),
        }
    }
}

/// 프런트가 목록에 그리는 편집 하나.
#[derive(serde::Serialize, Clone)]
pub struct EditInfo {
    pub id: u32,
    pub session_id: u32,
    pub remote_path: String,
    pub local_path: String,
    pub file_name: String,
}

/// 업로드 한 건의 결과 (프런트 토스트 문구에 쓴다).
#[derive(serde::Serialize, Clone)]
pub struct UploadInfo {
    pub remote_path: String,
    pub bytes: usize,
}

/// `sftp-uploaded` / `sftp-upload-failed` 이벤트 페이로드.
#[derive(serde::Serialize, Clone)]
struct UploadEvent {
    id: u32,
    remote_path: String,
    /// 실패했을 때만 채워진다 (성공은 `None`).
    message: Option<String>,
}

// ---------------------------------------------------------------------------
// 경로 다루기 (순수 함수 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 원격 경로를 정규화한다.
///
/// **`~` 는 여기서 벗긴다.** SFTP 서브시스템에는 셸이 없어 `~` 를 확장해 주는 주체가
/// 아무도 없다 — OpenSSH sftp-server 는 `~/x` 를 "`~` 라는 이름의 디렉터리 안의 x" 로
/// 읽는다. 대신 상대 경로의 기준이 **로그인 사용자의 홈**이므로, `~/` 를 떼고 상대
/// 경로로 넘기면 사용자가 기대한 그 자리를 가리킨다. (그래서 프런트의 기본값도 `~/` 다.)
///
/// `..` 은 거절한다. 원격 서버가 알아서 처리하긴 하지만, 우리가 만드는 임시 파일
/// (`<경로>.aynx-tmp`)과 로컬 캐시 경로가 그 문자열에서 파생되므로 정규화되지 않은
/// 상위 이동을 통과시키면 "무엇을 덮어쓰는지" 를 우리 쪽에서 설명할 수 없다.
pub(crate) fn normalize_remote(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(tr!(
            ko: "원격 경로를 입력하세요 (예: ~/nginx.conf)",
            en: "Enter a remote path (for example ~/nginx.conf)"
        ));
    }
    if trimmed.contains('\0') {
        return Err(tr!(
            ko: "원격 경로에 쓸 수 없는 문자가 있습니다",
            en: "The remote path contains a character that cannot be used"
        ));
    }

    let absolute = trimmed.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for (i, part) in trimmed.split('/').enumerate() {
        match part {
            "" | "." => continue,
            ".." => {
                return Err(tr!(
                    ko: "원격 경로에 `..` 은 쓸 수 없습니다",
                    en: "A remote path cannot contain `..`"
                ))
            }
            // 맨 앞의 `~` 만 홈 표기다 (`a/~/b` 의 `~` 는 진짜 디렉터리 이름일 수 있다)
            "~" if i == 0 && !absolute => continue,
            other => parts.push(other),
        }
    }

    if parts.is_empty() {
        // `~` · `/` · `.` 만 남은 경우 — 디렉터리로는 뜻이 있다 (홈 · 루트)
        return Ok(if absolute {
            "/".to_string()
        } else {
            ".".to_string()
        });
    }
    Ok(if absolute {
        format!("/{}", parts.join("/"))
    } else {
        parts.join("/")
    })
}

/// 업로드 파일 이름 검사 — **경로 조각이 아니라 이름 하나**여야 한다.
///
/// 웹 표준 DnD 의 `File.name` 은 이름만 담고 경로를 담지 않지만(그것이 이 기능이 File
/// 객체로 오는 이유다 — docs/log/2026-09-01-drag-split-sync-select.md 코디네이터 메모),
/// 헤더는 프런트가 만드는 값이라 여기서 다시 막는다.
fn sanitize_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(tr!(ko: "파일 이름이 비어 있습니다", en: "The file name is empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(tr!(
            ko: "파일 이름으로 쓸 수 없습니다",
            en: "That cannot be used as a file name"
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(tr!(
            ko: "파일 이름에 경로를 넣을 수 없습니다: {trimmed}",
            en: "A file name cannot contain a path: {trimmed}"
        ));
    }
    Ok(trimmed.to_string())
}

/// 디렉터리와 파일 이름을 잇는다 (원격은 언제나 `/` 구분자).
pub(crate) fn join_remote(dir: &str, name: &str) -> String {
    match dir {
        "." | "" => name.to_string(),
        "/" => format!("/{name}"),
        other => format!("{}/{name}", other.trim_end_matches('/')),
    }
}

/// 경로에서 마지막 이름 조각. 정규화를 거친 값에만 쓴다.
fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// 로컬 파일 이름으로 쓸 수 있게 다듬는다 — **Windows 가 금지하는 문자만** 바꾼다.
/// 원격 이름의 한글·공백은 그대로 둔다 (편집기 제목 표시줄에 그대로 보여야 한다).
fn local_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed
    }
}

/// 디렉터리 한 칸 이름으로 접은 원격 경로 (충돌만 피하면 되므로 읽기 좋을 정도로만).
fn slug(path: &str) -> String {
    let mut out = String::new();
    for c in path.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
            out.push(c);
        } else if !out.ends_with('_') {
            out.push('_');
        }
        if out.chars().count() >= 48 {
            break;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "_".to_string()
    } else {
        trimmed
    }
}

/// 편집용 로컬 경로 — `<data_dir>/aynx/edit/<세션id>-<접은 원격 디렉터리>/<파일명>`.
/// `app_data` 는 앱의 데이터 루트(`<data_dir>/aynx` — 개발 빌드는 `aynx-dev`, [`crate::instance::data_root`]).
///
/// 세션 id 와 원격 **디렉터리**를 한 칸에 접어 넣는 이유는 이름 충돌이다. `/etc/nginx.conf`
/// 와 `~/nginx.conf` 를 나란히 열어도 로컬에서 서로 덮어쓰면 안 되고, 같은 경로를 다시
/// 열면 같은 자리를 다시 써야 한다 (에디터가 이미 그 파일을 열어 두고 있을 수 있다).
fn local_edit_path(app_data: &Path, session_id: u32, remote_path: &str) -> PathBuf {
    let name = base_name(remote_path);
    let dir = remote_path
        .strip_suffix(name)
        .unwrap_or("")
        .trim_end_matches('/');
    app_data
        .join("edit")
        .join(format!("{session_id}-{}", slug(dir)))
        .join(local_name(name))
}

/// `encodeURIComponent` 로 온 헤더 값을 되돌린다.
///
/// 헤더는 ASCII 만 안전하게 실어 나른다 — 한글 파일 이름을 그대로 넣으면 값이 깨지거나
/// 요청이 거절된다. 그래서 프런트가 퍼센트 인코딩해 보내고 여기서 푼다 (`+` 는 공백이
/// 아니다 — `encodeURIComponent` 는 공백을 `%20` 으로 낸다).
pub(crate) fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let broken = || tr!(ko: "헤더 값이 깨졌습니다", en: "The header value is malformed");
            let hex = bytes.get(i + 1..i + 3).ok_or_else(broken)?;
            let text = std::str::from_utf8(hex).map_err(|_| broken())?;
            let byte = u8::from_str_radix(text, 16).map_err(|_| broken())?;
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out)
        .map_err(|_| tr!(ko: "헤더 값이 UTF-8 이 아닙니다", en: "The header value is not UTF-8"))
}

/// 사람이 읽는 크기 (오류 문구용).
pub(crate) fn human_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes}B")
    }
}

// ---------------------------------------------------------------------------
// SFTP 채널
// ---------------------------------------------------------------------------

/// 전송로가 죽은 오류인가 — 그렇다면 캐시된 채널은 더 쓸 수 없다.
///
/// `Status` 는 서버가 정상적으로 돌려준 **그 파일에 대한** 거절이므로(없는 파일·권한)
/// 채널은 멀쩡하다. 나머지(IO·타임아웃·프로토콜 이탈)는 채널을 버리고 다음 요청에서
/// 새로 열게 한다 — 안 그러면 한 번 끊긴 세션에서 영원히 같은 오류만 난다.
pub(crate) fn is_transport_error(e: &SftpError) -> bool {
    !matches!(e, SftpError::Status(_))
}

/// 캐시에서 세션의 SFTP 채널을 버린다 (다음 요청이 새로 연다).
pub(crate) async fn forget(session_id: u32) {
    SFTP.lock().await.remove(&session_id);
}

/// 러시 핸들 위에 SFTP 채널을 **하나 새로 연다** (캐시를 거치지 않는다).
///
/// 캐시([`sftp_of`])는 **세션 id** 를 열쇠로 쓰는데, 접속이 진행 중인 동안
/// (`open_ssh_session` 안)에는 아직 그 id 가 세션 맵에 없다 — 셸 통합 스니펫을 심는
/// [`crate::shell_integration::upload_via_handle`] 이 바로 그 구간에서 돌기 때문에
/// 핸들만 받는 문이 따로 필요하다. 여기서 연 채널은 **부른 쪽이 닫는다**.
pub(crate) async fn open_sftp_on(
    handle: &russh::client::Handle<crate::ssh::SshHandler>,
) -> Result<SftpSession, String> {
    // 부르는 쪽이 전역 잠금을 쥔 채 기다릴 수 있으므로 **반드시 시간 안에 끝나야 한다** —
    // 죽어 가는 세션에서 채널 열기가 매달리면 다른 세션의 SFTP 요청까지 함께 멈춘다.
    let session = tokio::time::timeout(OPEN_TIMEOUT, async {
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| tr!(ko: "SFTP 채널을 열지 못했습니다: {e}", en: "Could not open an SFTP channel: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| tr!(ko: "서버가 SFTP 를 지원하지 않습니다: {e}", en: "The server does not support SFTP: {e}"))?;
        SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| tr!(ko: "서버가 SFTP 를 지원하지 않습니다: {e}", en: "The server does not support SFTP: {e}"))
    })
    .await
    .map_err(|_| tr!(
        ko: "SFTP 채널을 여는 데 너무 오래 걸립니다 — 연결 상태를 확인하세요",
        en: "Opening the SFTP channel is taking too long — check the connection"
    ))??;
    session.set_timeout(TIMEOUT_SECS);
    Ok(session)
}

/// 세션의 SFTP 채널을 가져온다 (없으면 연다).
///
/// ③-3b2 — SSH 전송로는 세션 서버에 산다. 그래서 여기서 여는 SFTP 는 **채널 터널** 위에서 돈다: 서버가 그 세션의 전송로에
/// `sftp` 서브시스템 채널을 열고(`chan_open`) 그 바이트를 파이프의 채널 프레임으로 나르며, 이 프로세스의 russh-sftp
/// 클라이언트는 예전 그대로 그 스트림 위에서 돈다(`crate::server::tunnel`). `app` 은 예전 계약의 인자(이제 쓰지 않는다).
pub(crate) async fn sftp_of(
    app: &tauri::AppHandle,
    session_id: u32,
) -> Result<Arc<SftpSession>, String> {
    let _ = app;
    let mut map = SFTP.lock().await;
    if let Some(existing) = map.get(&session_id) {
        return Ok(Arc::clone(existing));
    }
    let arc = Arc::new(open_sftp_tunnel(session_id).await?);
    map.insert(session_id, Arc::clone(&arc));
    Ok(arc)
}

/// 세션 서버의 SSH 세션 하나에 SFTP 채널 터널을 새로 연다(캐시를 거치지 않는다 — 부른 쪽이 닫는다).
pub(crate) async fn open_sftp_tunnel(session_id: u32) -> Result<SftpSession, String> {
    let session = tokio::time::timeout(OPEN_TIMEOUT, async {
        let stream = crate::server::tunnel::open_sftp(session_id).await?;
        SftpSession::new(stream)
            .await
            .map_err(|e| tr!(ko: "서버가 SFTP 를 지원하지 않습니다: {e}", en: "The server does not support SFTP: {e}"))
    })
    .await
    .map_err(|_| tr!(
        ko: "SFTP 채널을 여는 데 너무 오래 걸립니다 — 연결 상태를 확인하세요",
        en: "Opening the SFTP channel is taking too long — check the connection"
    ))??;
    session.set_timeout(TIMEOUT_SECS);
    Ok(session)
}

/// 파일 하나를 통째로 쓴다 (없으면 만들고, 있으면 **길이를 0으로 자른 뒤** 쓴다).
///
/// `SftpSession::write` 를 쓰지 않는 이유: 그쪽은 `OpenFlags::WRITE` 만 걸어서 **파일이
/// 없으면 실패하고, 원래 파일이 더 길면 뒷부분이 남는다** (2.4.0 구현 확인). 설정 파일을
/// 짧게 고쳤을 때 옛 꼬리가 남는 것은 조용한 데이터 손상이다.
async fn write_whole(sftp: &SftpSession, path: &str, data: &[u8]) -> Result<(), SftpError> {
    let mut file = sftp.create(path).await?;
    file.write_all(data).await?;
    file.close().await?;
    Ok(())
}

/// 원격에 **덮어쓰기 저장**한다 — 문서 타일 저장과 **같은 문**을 탄다
/// ([`crate::sftp_browser::text::save_target`] → [`crate::sftp_browser::text::overwrite_remote`]).
///
/// 1. 마지막 조각이 링크면 대상 파일에 쓰고, 쓸 수 없는 파일은 거절한다(교체가 읽기 전용을 우회하지 않게).
/// 2. 같은 폴더 임시 파일에 전부 쓴 뒤 rename 으로 교체한다 — OpenSSH 는 대상이 있으면 rename 이
///    실패하므로 원본을 백업 이름으로 비켜 두는 두 번의 rename 이다(둘째가 실패하면 되돌린다).
/// 3. 교체하면 주인·권한이 바뀌는 파일(남의 파일 · setstat 거절)만 제자리 덮어쓰기다. 그때도 **자르기
///    전에** 새 내용 전부가 임시 파일에 있어, 쓰다 끊겨도 원본이나 새 내용 중 하나는 남는다(오류가 경로를 알려 준다).
///
/// 없는 파일은 임시 파일 → rename 으로 만든다. 예전에는 rename 실패 = 곧 TRUNCATE 제자리 쓰기라
/// OpenSSH 에서 사실상 늘 제자리였다(docs/log/2026-09-27-doc-edit.md).
///
/// [`crate::shell_integration`] 이 스니펫 파일을 심을 때도 같은 절차를 탄다(앱이 만든 파일이라 늘 교체) —
/// 사용자의 rc 가 `. ~/.aynx/integration.sh` 로 읽고 있을 수 있으므로 반쯤 쓰인 파일이 보이면 안 된다.
/// `session` 은 전송이 죽었을 때 버릴 채널 캐시의 세션 — 캐시 밖 채널(스니펫 심기)은 `None`.
pub(crate) async fn save_remote(
    session: Option<u32>,
    sftp: &SftpSession,
    remote: &str,
    data: &[u8],
) -> Result<(), String> {
    use crate::sftp_browser::text::{overwrite_remote, save_target};
    match save_target(session, sftp, remote).await? {
        Some((target, meta)) => overwrite_remote(session, sftp, &target, &meta, data, remote).await,
        None => {
            let fresh = russh_sftp::protocol::FileAttributes::default();
            overwrite_remote(session, sftp, remote, &fresh, data, remote).await
        }
    }
}

// ---------------------------------------------------------------------------
// 편집 — 감시 태스크
// ---------------------------------------------------------------------------

/// 로컬 파일이 바뀔 때마다 원격에 되올린다. [`stop_edit`]·세션 종료로만 끝난다.
async fn watch_edit(
    app: tauri::AppHandle,
    id: u32,
    session_id: u32,
    remote: String,
    local: PathBuf,
    mut last: SystemTime,
) {
    loop {
        tokio::time::sleep(POLL).await;

        // 편집기가 "지우고 새로 쓰기" 로 저장하는 순간에는 파일이 잠깐 없을 수 있다.
        let Ok(modified) = std::fs::metadata(&local).and_then(|m| m.modified()) else {
            continue;
        };
        if modified == last {
            continue;
        }
        // 아직 쓰는 중일 수 있다 — `last` 를 갱신하지 않으므로 다음 폴링에서 다시 본다.
        if SystemTime::now()
            .duration_since(modified)
            .is_ok_and(|age| age < SETTLE)
        {
            continue;
        }

        let Ok(data) = std::fs::read(&local) else {
            continue;
        };
        last = modified;

        let message = match sftp_of(&app, session_id).await {
            // 실패 문구는 경로·이유를 담고, 전송이 죽었으면 채널 캐시도 이미 버렸다.
            Ok(sftp) => save_remote(Some(session_id), &sftp, &remote, &data).await.err(),
            Err(e) => Some(e),
        };

        let event = if message.is_none() {
            "sftp-uploaded"
        } else {
            "sftp-upload-failed"
        };
        let _ = app.emit(
            event,
            UploadEvent {
                id,
                remote_path: remote.clone(),
                message,
            },
        );
    }
}

/// 기본 편집기로 연다 (Windows 에 연결 프로그램이 없으면 메모장 — `config_edit` 과 같은 규칙).
fn open_in_editor(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    match app
        .opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
    {
        Ok(()) => Ok(()),
        Err(e) => crate::config_edit::open_with_fallback_editor(path).map_err(|fallback| {
            tr!(
                ko: "편집기를 열지 못했습니다: {e} ({fallback}) — 직접 {what} 를 여세요",
                en: "Could not open an editor: {e} ({fallback}) — open {what} yourself",
                what = path.display()
            )
        }),
    }
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 원격 파일을 내려받아 기본 편집기로 열고, 저장할 때마다 되올린다.
#[tauri::command]
pub async fn edit_remote_file(
    app: tauri::AppHandle,
    session_id: u32,
    remote_path: String,
) -> Result<EditInfo, String> {
    let remote = normalize_remote(&remote_path)?;
    let name = base_name(&remote).to_string();
    if name.is_empty() || name == "." || name == "/" {
        return Err(tr!(
            ko: "파일 경로를 지정하세요 (디렉터리는 편집할 수 없습니다)",
            en: "Give a file path (a folder cannot be edited)"
        ));
    }

    let sftp = sftp_of(&app, session_id).await?;

    let meta = sftp.metadata(remote.clone()).await.map_err(|e| {
        if matches!(&e, SftpError::Status(s) if s.status_code == russh_sftp::protocol::StatusCode::NoSuchFile)
        {
            tr!(ko: "원격에 그런 파일이 없습니다: {remote}", en: "No such file on the remote: {remote}")
        } else {
            tr!(ko: "원격 파일을 읽지 못했습니다: {e}", en: "Could not read the remote file: {e}")
        }
    })?;
    if meta.file_type().is_dir() {
        return Err(tr!(
            ko: "디렉터리는 편집할 수 없습니다: {remote}",
            en: "A folder cannot be edited: {remote}"
        ));
    }
    let size = meta.len();
    if size > EDIT_MAX_BYTES {
        return Err(tr!(
            ko: "파일이 너무 큽니다 ({size}) — 편집은 {max} 까지만 지원합니다",
            en: "The file is too large ({size}) — editing supports up to {max}",
            size = human_size(size),
            max = human_size(EDIT_MAX_BYTES)
        ));
    }

    let data = match sftp.read(remote.clone()).await {
        Ok(data) => data,
        Err(e) => {
            if is_transport_error(&e) {
                forget(session_id).await;
            }
            return Err(tr!(
                ko: "원격 파일을 내려받지 못했습니다: {e}",
                en: "Could not download the remote file: {e}"
            ));
        }
    };

    let root = crate::instance::data_root().ok_or_else(
        || tr!(ko: "데이터 디렉터리를 찾을 수 없습니다", en: "Could not find the data folder"),
    )?;
    let local = local_edit_path(&root, session_id, &remote);
    if let Some(parent) = local.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            tr!(
                ko: "{what} 를 만들지 못했습니다: {e}",
                en: "Could not create {what}: {e}",
                what = parent.display()
            )
        })?;
    }
    std::fs::write(&local, &data).map_err(|e| {
        tr!(
            ko: "{what} 쓰기 실패: {e}",
            en: "Could not write {what}: {e}",
            what = local.display()
        )
    })?;
    let stamp = std::fs::metadata(&local)
        .and_then(|m| m.modified())
        .unwrap_or_else(|_| SystemTime::now());

    open_in_editor(&app, &local)?;

    let id = NEXT_EDIT_ID.fetch_add(1, Ordering::Relaxed);
    let task = tokio::spawn(watch_edit(
        app.clone(),
        id,
        session_id,
        remote.clone(),
        local.clone(),
        stamp,
    ));
    let edit = Edit {
        session_id,
        remote_path: remote,
        local_path: local,
        file_name: name,
        abort: task.abort_handle(),
    };
    let info = edit.info(id);
    EDITS.lock().unwrap().insert(id, edit);
    Ok(info)
}

/// 한 세션에서 감시 중인 편집 목록 (id 오름차순 = 연 순서).
///
/// **동기로 남는다** (docs/conventions.md 의 예외): 메모리 맵 잠금 한 번과 몇 개 안 되는
/// 항목의 복사·정렬뿐이다 — 원격도 디스크도 만지지 않는다.
#[tauri::command]
pub fn list_edits(session_id: u32) -> Vec<EditInfo> {
    let map = EDITS.lock().unwrap();
    let mut list: Vec<EditInfo> = map
        .iter()
        .filter(|(_, e)| e.session_id == session_id)
        .map(|(id, e)| e.info(*id))
        .collect();
    list.sort_by_key(|info| info.id);
    list
}

/// 편집 하나의 감시를 멈춘다. **없는 id 도 성공이다** (`remove_forward` 와 같은 멱등 계약).
/// 로컬 파일은 지우지 않는다 — 사용자가 편집 중인 작업물이다.
///
/// **동기로 남는다**: `remove` 한 번과 `AbortHandle::abort()`(원자 플래그 하나) 뿐이다.
/// 실제 정리는 감시 태스크가 다음 깨어남에서 알아서 한다 — 여기서 기다리지 않는다.
#[tauri::command]
pub fn stop_edit(id: u32) -> Result<(), String> {
    let removed = EDITS.lock().unwrap().remove(&id);
    if let Some(edit) = removed {
        edit.abort.abort();
    }
    Ok(())
}

/// 파일 하나를 원격 디렉터리에 올린다.
///
/// **본문이 raw 바이트다.** 파일 내용을 JSON 숫자 배열로 직렬화하면 MB 당 수 배의 문자열이
/// 만들어져 웹뷰와 Rust 양쪽에서 파싱 비용이 폭발한다 (docs/verification/tauri-data-path.md
/// 1절과 같은 근거). 메타데이터(세션·디렉터리·파일명·덮어쓰기)는 헤더로 온다:
///
/// ```text
/// x-session-id: 3
/// x-remote-dir: %2Fetc%2Fnginx      (encodeURIComponent)
/// x-file-name:  %EC%84%A4%EC%A0%95.conf
/// x-overwrite:  1                    (없으면 덮어쓰지 않는다)
/// ```
#[tauri::command]
pub async fn upload_file(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<UploadInfo, String> {
    let header = |name: &str| -> Option<String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };

    let session_id: u32 = header("x-session-id")
        .ok_or_else(|| tr!(ko: "세션 정보가 없습니다", en: "The session information is missing"))?
        .parse()
        .map_err(|_| {
            tr!(ko: "세션 정보가 올바르지 않습니다", en: "The session information is not valid")
        })?;
    let dir = normalize_remote(&percent_decode(&header("x-remote-dir").ok_or_else(
        || tr!(ko: "원격 디렉터리가 없습니다", en: "The remote folder is missing"),
    )?)?)?;
    let name = sanitize_file_name(&percent_decode(
        &header("x-file-name")
            .ok_or_else(|| tr!(ko: "파일 이름이 없습니다", en: "The file name is missing"))?,
    )?)?;
    let overwrite = header("x-overwrite").as_deref() == Some("1");

    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(tr!(
            ko: "업로드 본문이 바이너리가 아닙니다",
            en: "The upload body is not binary"
        ));
    };
    if data.len() > UPLOAD_MAX_BYTES {
        return Err(tr!(
            ko: "파일이 너무 큽니다 ({size}) — 업로드는 {max} 까지만 지원합니다",
            en: "The file is too large ({size}) — uploading supports up to {max}",
            size = human_size(data.len() as u64),
            max = human_size(UPLOAD_MAX_BYTES as u64)
        ));
    }

    let target = join_remote(&dir, &name);
    let sftp = sftp_of(&app, session_id).await?;

    // 존재 확인과 쓰기 사이는 원자적이지 않다 (그 사이 누군가 같은 이름을 만들면 덮어쓴다).
    // 여기서 막는 것은 **사용자 자신의 실수**이지 경합이 아니다 — 확인 대화상자를 띄우려면
    // 프런트가 "이미 있다" 를 알아야 하고, 그 답을 주는 것이 이 검사다.
    if !overwrite {
        match sftp.try_exists(target.clone()).await {
            Ok(true) => return Err(crate::errors::exists_pick_another_name(&name)),
            Ok(false) => {}
            Err(e) => {
                if is_transport_error(&e) {
                    forget(session_id).await;
                }
                return Err(tr!(
                    ko: "원격 디렉터리를 확인하지 못했습니다: {e}",
                    en: "Could not check the remote folder: {e}"
                ));
            }
        }
    }

    if let Err(e) = write_whole(&sftp, &target, data).await {
        if is_transport_error(&e) {
            forget(session_id).await;
        }
        return Err(tr!(
            ko: "{name} 을(를) 올리지 못했습니다: {e}",
            en: "Could not upload {name}: {e}"
        ));
    }

    Ok(UploadInfo {
        remote_path: target,
        bytes: data.len(),
    })
}

/// 세션이 닫힐 때 그 세션의 SFTP 채널과 편집 감시를 정리한다
/// ([`crate::ssh::close_ssh`] 가 부른다). 돌려주는 값은 멈춘 편집 수 (테스트·진단용).
///
/// **로컬 편집 파일은 남긴다.** 세션이 끊겼다고 사용자가 편집기에 띄워 둔 작업물을
/// 지우면 저장하지 못한 내용까지 사라진다 — 다시 접속해 같은 경로를 열면 같은 자리를
/// 다시 쓰므로(`local_edit_path` 는 경로에서 결정된다) 이어서 일할 수 있다.
pub(crate) fn stop_session_sftp(session_id: u32) -> usize {
    let mut map = EDITS.lock().unwrap();
    let dead: Vec<u32> = map
        .iter()
        .filter(|(_, e)| e.session_id == session_id)
        .map(|(id, _)| *id)
        .collect();
    for id in &dead {
        if let Some(edit) = map.remove(id) {
            edit.abort.abort();
        }
    }
    drop(map);

    // 채널 자체는 비동기 잠금 뒤에 있다 — `close_ssh` 를 async 로 물들이지 않도록
    // 짧은 태스크로 떼어 낸다 (드롭되면 `RawSftpSession::drop` 이 채널을 닫는다).
    tokio::spawn(async move {
        forget(session_id).await;
    });

    dead.len()
}

#[cfg(test)]
mod tests;
