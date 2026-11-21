//! SFTP — 원격 파일 편집(외부 편집기 왕복 · 저장하면 되올림)과 드래그 업로드, 세션당 SFTP 채널 캐시.
//!
//! - 채널은 세션 id 로 캐시하고 세션이 닫힐 때([`crate::ssh::close_ssh`]) 함께 버린다 — [`crate::port_forward`] 의 수명 규칙과 같은 자리다.
//! - 크기 상한(편집 10MB · 업로드 100MB): russh-sftp 2.4 는 쓰기 8개 겹침이지만 읽기는 한 요청씩 순차라(docs/verification/russh.md 5절 — #70) 큰 파일은 RTT 에 묶인다 — 진행률 · 취소가 없는 동안은 상한에서 거절한다.

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

/// 편집 내려받기 상한 — 모듈 머리말의 근거.
const EDIT_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// 청크 스트리밍이 생기기 전까지는 통째로 메모리에 올린다.
const UPLOAD_MAX_BYTES: usize = 100 * 1024 * 1024;

const POLL: Duration = Duration::from_secs(2);

/// 편집기가 쓰는 도중에 mtime 이 먼저 올라올 수 있어, 마지막 변경이 이만큼 지나기 전에는 올리지 않는다.
const SETTLE: Duration = Duration::from_millis(500);

/// 기본값 10초는 큰 파일의 마지막 쓰기 확인에 모자란다(docs/verification/russh.md 5절 — #95).
const TIMEOUT_SECS: u64 = 60;

/// 채널 열기 시한 — 전역 잠금을 쥐는 구간이다.
const OPEN_TIMEOUT: Duration = Duration::from_secs(20);

// ---------------------------------------------------------------------------
// 전역 상태
// ---------------------------------------------------------------------------

/// tokio 뮤텍스 — 잠금을 쥔 채 채널을 열어 같은 세션에 채널이 두 번 열리지 않는다(버린 쪽이 서버에 유령 채널로 남는다).
static SFTP: LazyLock<tokio::sync::Mutex<HashMap<u32, Arc<SftpSession>>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));

/// 전역인 이유는 `port_forward::FORWARDS` 와 같다 — `close_ssh` 가 상태 타입을 몰라도 정리할 수 있어야 한다.
static EDITS: LazyLock<Mutex<HashMap<u32, Edit>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_EDIT_ID: AtomicU32 = AtomicU32::new(1);

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

#[derive(serde::Serialize, Clone)]
pub struct EditInfo {
    pub id: u32,
    pub session_id: u32,
    pub remote_path: String,
    pub local_path: String,
    pub file_name: String,
}

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
    message: Option<String>,
}

// ---------------------------------------------------------------------------
// 경로 다루기
// ---------------------------------------------------------------------------

/// `~` 는 벗긴다 — SFTP 에는 `~` 를 펼 셸이 없고(OpenSSH 는 `~` 라는 디렉터리로 읽는다), 상대 경로의 기준이 홈이라 `~/` 를 떼면 같은 자리다.
/// `..` 은 거절한다 — 임시 파일(`<경로>.aynx-tmp`)과 로컬 캐시 경로가 이 문자열에서 파생된다.
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

/// 경로가 아닌 이름 하나여야 한다 — 헤더는 프런트가 만드는 값이라 여기서 다시 막는다.
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

/// Windows 가 금지하는 문자만 바꾼다 — 한글·공백은 편집기 제목에 그대로 보여야 한다.
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

/// `<data_root>/edit/<세션id>-<접은 원격 디렉터리>/<파일명>` — 다른 경로의 같은 이름이 서로 덮어쓰지 않고, 같은 경로를 다시 열면 같은 자리를 쓴다(편집기가 이미 열어 두었을 수 있다).
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

/// 프런트가 `encodeURIComponent` 로 보낸 헤더 값을 푼다(헤더는 ASCII 만 안전하다) — `+` 는 공백이 아니다.
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

/// `Status` 는 그 파일에 대한 거절이라 채널은 멀쩡하다 — 나머지는 채널을 버려야 한 번 끊긴 세션이 같은 오류에 갇히지 않는다.
pub(crate) fn is_transport_error(e: &SftpError) -> bool {
    !matches!(e, SftpError::Status(_))
}

pub(crate) async fn forget(session_id: u32) {
    SFTP.lock().await.remove(&session_id);
}

/// 캐시를 거치지 않고 핸들 위에 새로 연다 — 세션 맵 등록 전에 도는 [`crate::shell_integration::upload_via_handle`] 용. 부른 쪽이 닫는다.
pub(crate) async fn open_sftp_on(
    handle: &russh::client::Handle<crate::ssh::SshHandler>,
) -> Result<SftpSession, String> {
    // 부르는 쪽이 전역 잠금을 쥔 채 기다릴 수 있어 반드시 시간 안에 끝나야 한다.
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

/// SSH 전송로는 세션 서버에 산다 — 이 SFTP 는 채널 터널(`crate::server::tunnel`) 위에서 돈다. `app` 은 쓰지 않는 옛 인자다.
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

/// 없으면 만들고 있으면 길이를 0으로 자른 뒤 쓴다 — `SftpSession::write` 는 없는 파일에 실패하고, 원래 파일이 더 길면 옛 꼬리가 남는다(russh-sftp 2.4.0).
async fn write_whole(sftp: &SftpSession, path: &str, data: &[u8]) -> Result<(), SftpError> {
    let mut file = sftp.create(path).await?;
    file.write_all(data).await?;
    file.close().await?;
    Ok(())
}

/// 원격에 덮어쓰기 저장 — 문서 타일 저장과 같은 문([`crate::sftp_browser::text::overwrite_remote`]).
/// 링크는 대상에 쓰고 쓸 수 없는 파일은 거절한다(교체가 읽기 전용을 우회하지 않게). 임시 파일에 전부 쓴 뒤 교체해 반쯤 쓰인 파일이 보이지 않는다(셸 통합 스니펫도 사용자 rc 가 읽고 있을 수 있다).
/// `session` 은 전송이 죽었을 때 버릴 채널 캐시의 세션 — 캐시 밖 채널은 `None`.
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

/// **동기로 남는다** (docs/conventions.md 의 예외): 메모리 맵 잠금 한 번과 몇 개 안 되는 항목의 복사·정렬뿐이다 — 원격도 디스크도 만지지 않는다.
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

/// 없는 id 도 성공이다(멱등). 로컬 파일은 지우지 않는다 — 사용자의 작업물이다.
/// **동기로 남는다**: `remove` 한 번과 `AbortHandle::abort()`(원자 플래그 하나) 뿐이고 여기서 기다리지 않는다.
#[tauri::command]
pub fn stop_edit(id: u32) -> Result<(), String> {
    let removed = EDITS.lock().unwrap().remove(&id);
    if let Some(edit) = removed {
        edit.abort.abort();
    }
    Ok(())
}

/// 본문은 raw 바이트 — JSON 숫자 배열이면 파싱 비용이 폭발한다(docs/verification/tauri-data-path.md 1절).
/// 메타는 헤더: `x-session-id` · `x-remote-dir` · `x-file-name`(둘 다 `encodeURIComponent`) · `x-overwrite: 1`(없으면 덮어쓰지 않는다).
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

    // 존재 확인과 쓰기 사이는 원자적이지 않다 — 막는 것은 사용자의 실수이지 경합이 아니다.
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

/// 세션이 닫힐 때 SFTP 채널과 편집 감시를 정리한다(돌려주는 값은 멈춘 편집 수).
/// 로컬 편집 파일은 남긴다 — 지우면 저장 안 한 내용이 사라지고, 다시 열면 같은 자리를 쓰므로 이어서 일할 수 있다.
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

    // `close_ssh` 를 async 로 물들이지 않도록 짧은 태스크로 떼어 낸다(드롭되면 채널이 닫힌다).
    tokio::spawn(async move {
        forget(session_id).await;
    });

    dead.len()
}

#[cfg(test)]
mod tests;
