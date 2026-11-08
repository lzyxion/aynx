//! 외부 파일 드롭 → 로컬 AI CLI가 읽는 사본. 웹 DnD에는 원본 경로가 없다.
//! 대화가 나중에도 사본을 읽을 수 있도록 data_root/attachments에 남긴다.
//! 남기는 기간은 30일 — Claude Code 가 지난 대화를 지우는 기본 기간과 같아, 그보다 오래 두어도
//! 다시 열 대화가 없다(2026-10-07 사용자 결정). 앱이 켜질 때 한 번 [`cleanup_stale`] 이 걷는다.
//! 원격 사본(`~/.aynx/attachments/*` — 옛 자리 `~/.aynx-attachment-*` 포함)은 같은 기간으로 프런트(`agent-attachments.ts`)가 걷는다.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::i18n::tr;

const MAX_BYTES: usize = 100 * 1024 * 1024;
/// 사본을 남기는 기간 — 프런트의 `ATTACHMENT_MAX_AGE_MS` 와 같은 값이다.
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// 앱 시작 때 오래된 첨부 폴더를 걷는다(블로킹 풀). 실패는 다음 시작에 다시 해 보면 되므로 삼킨다.
pub fn cleanup_stale() {
    let Some(root) = crate::instance::data_root() else { return };
    prune_at(&root.join("attachments"), SystemTime::now(), MAX_AGE);
}

/// `root` 아래 **우리가 만든 폴더**(64자 소문자 hex)만, 마지막 수정이 `max_age` 보다 오래된 것을 지운다.
/// 폴더의 수정 시각은 사본을 쓴 순간이다(한 폴더에 한 번만 쓴다). 지운 수를 돌려준다.
fn prune_at(root: &Path, now: SystemTime, max_age: Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(root) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let ours = name.to_str().is_some_and(|n| {
            n.len() == 64 && n.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        });
        let Ok(meta) = entry.metadata() else { continue };
        if !ours || !meta.is_dir() {
            continue;
        }
        let old = meta.modified().ok()
            .and_then(|at| now.duration_since(at).ok())
            .is_some_and(|age| age >= max_age);
        if old && std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[tauri::command]
pub async fn stage_agent_attachment(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let encoded = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| tr!(ko: "파일 이름이 없습니다", en: "The file name is missing"))?;
    let name = crate::sftp::percent_decode(encoded)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(tr!(ko: "본문이 바이너리가 아닙니다", en: "The body is not binary"));
    };
    validate(&name, bytes.len())?;
    let root = attachments_root()?;
    let bytes = bytes.clone();
    tokio::task::spawn_blocking(move || stage_at(&root, &name, &bytes)).await
        .map_err(|e| tr!(ko: "첨부를 저장하지 못했습니다: {e}", en: "Could not save the attachment: {e}"))?
}

/// 파일 타일에서 끈 **원격 파일**을 로컬 AI 타일에 첨부할 때 — 빈 첨부 폴더 하나만 만들어 경로를 준다.
/// 내용은 프런트가 `sftp_download_paths` 로 그 안에 내려받는다. 이름 규칙·자리가 [`stage_agent_attachment`]
/// 와 같아(`<data_root>/attachments/<64자 hex>`) 30일 정리([`cleanup_stale`])도 그대로 받는다.
#[tauri::command]
pub async fn create_agent_attachment_dir() -> Result<String, String> {
    let root = attachments_root()?;
    tokio::task::spawn_blocking(move || new_dir_at(&root)).await
        .map_err(|e| tr!(ko: "첨부 폴더를 만들지 못했습니다: {e}", en: "Could not create the attachment folder: {e}"))?
        .map(|dir| dir.to_string_lossy().into_owned())
}

/// 로컬 첨부 자리 `<data_root>/attachments` — 사이드 채팅 보내기의 그림 판정(`server::side_chat::chat_images`)도 이 자리만 받는다.
pub(crate) fn attachments_root() -> Result<PathBuf, String> {
    Ok(crate::instance::data_root()
        .ok_or_else(|| tr!(ko: "앱 데이터 폴더를 찾을 수 없습니다", en: "The app data folder is unavailable"))?
        .join("attachments"))
}

/// `root` 아래 새 첨부 폴더(64자 소문자 hex — [`prune_at`] 이 알아보는 이름) 하나. 이미 있으면 실패한다.
fn new_dir_at(root: &Path) -> Result<PathBuf, String> {
    let id = crate::token::generate_token()
        .ok_or_else(|| tr!(ko: "첨부 폴더 이름을 만들지 못했습니다", en: "Could not generate an attachment folder name"))?;
    let dir = root.join(id);
    std::fs::create_dir_all(root)
        .and_then(|()| std::fs::create_dir(&dir))
        .map_err(|e| tr!(ko: "첨부 폴더를 만들지 못했습니다: {e}", en: "Could not create the attachment folder: {e}"))?;
    Ok(dir)
}

fn validate(name: &str, size: usize) -> Result<(), String> {
    if !crate::local_browser::is_bare_name(name) || name.chars().any(char::is_control) {
        return Err(
            tr!(ko: "올바른 첨부 파일 이름이 아닙니다: {name}", en: "Invalid attachment file name: {name}"),
        );
    }
    if size > MAX_BYTES {
        return Err(
            tr!(ko: "첨부 파일은 100 MB까지 지원합니다", en: "Attachments support files up to 100 MB"),
        );
    }
    Ok(())
}

fn stage_at(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    validate(name, bytes.len())?;
    let path = new_dir_at(root)?.join(name);
    std::fs::write(&path, bytes).map_err(
        |e| tr!(ko: "첨부를 저장하지 못했습니다: {e}", en: "Could not save the attachment: {e}"),
    )?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_names_and_bytes_without_overwriting_previous_attachments() {
        let root = std::env::temp_dir().join(format!(
            "aynx-attachments-test-{}",
            crate::token::generate_token().unwrap()
        ));
        let first = stage_at(&root, "한글 image.png", &[0, 255, 42]).unwrap();
        let second = stage_at(&root, "한글 image.png", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(Path::new(&first).file_name().unwrap(), "한글 image.png");
        assert_eq!(std::fs::read(&first).unwrap(), [0, 255, 42]);
        assert_eq!(std::fs::read(&second).unwrap(), b"second");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn new_dirs_are_empty_distinct_and_pruned_like_staged_copies() {
        let root = std::env::temp_dir().join(format!(
            "aynx-attachments-dir-{}",
            crate::token::generate_token().unwrap()
        ));
        let first = new_dir_at(&root).unwrap();
        let second = new_dir_at(&root).unwrap();
        assert_ne!(first, second);
        assert_eq!(first.parent().unwrap(), root);
        assert!(std::fs::read_dir(&first).unwrap().next().is_none(), "빈 폴더여야 한다");
        let name = first.file_name().unwrap().to_str().unwrap();
        assert_eq!(name.len(), 64);
        std::fs::write(first.join("copy.png"), b"x").unwrap();
        let later = SystemTime::now() + MAX_AGE + Duration::from_secs(60);
        assert_eq!(prune_at(&root, later, MAX_AGE), 2, "같은 이름 규칙이라 30일 정리를 그대로 받는다");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prunes_only_old_attachment_folders() {
        let root = std::env::temp_dir().join(format!(
            "aynx-attachments-prune-{}",
            crate::token::generate_token().unwrap()
        ));
        let kept = stage_at(&root, "a.png", b"a").unwrap();
        let stranger = root.join("not-ours");
        std::fs::create_dir_all(&stranger).unwrap();
        let now = SystemTime::now();
        assert_eq!(prune_at(&root, now, MAX_AGE), 0);
        assert!(Path::new(&kept).exists());
        assert_eq!(prune_at(&root, now + MAX_AGE + Duration::from_secs(60), MAX_AGE), 1);
        assert!(!Path::new(&kept).exists());
        assert!(stranger.exists(), "이름이 다른 폴더는 건드리지 않는다");
        assert_eq!(prune_at(&root.join("missing"), now, MAX_AGE), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_paths_control_characters_and_oversized_bodies() {
        for name in [
            "",
            ".",
            "..",
            "../escape",
            "C:\\escape",
            "a:b",
            "a\nb",
            "a\0b",
        ] {
            assert!(validate(name, 0).is_err(), "{name:?}");
        }
        assert!(validate("empty.txt", 0).is_ok());
        assert!(validate("large.png", MAX_BYTES).is_ok());
        assert!(validate("large.png", MAX_BYTES + 1).is_err());
    }
}
