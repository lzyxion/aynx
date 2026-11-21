//! 채팅 사이드 독의 저장 · 폴더 — 목록 파일 `chats.json`(불투명 blob) · 채팅마다 폴더(그 CLI 의 cwd) · 사이드 채팅 지침.
//!
//! 채팅 폴더 경로를 정하는 것은 여기 하나다 — 프런트는 경로를 다시 보내지 않는다.
//! **지우기는 그 채팅 폴더 하나만**(+ 권한 파일 하나)이고, 그 안 어디에든 링크(심볼릭 · 정션)가 있으면 지우지 않는다 — `git worktree
//! remove` 가 정션을 따라가 노트 저장소를 지운 사고를 되풀이하지 않는다.

use std::path::{Path, PathBuf};

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

const ID_MAX: usize = 64;

pub(crate) fn root() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("sidechat"))
}

/// 폴더 이름 하나로만 쓰인다 — 경로 구분자 · `.` 를 받지 않는다.
pub(crate) fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= ID_MAX && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub(crate) fn chat_dir(root: &Path, id: &str) -> Option<PathBuf> {
    id_ok(id).then(|| root.join(id))
}

/// 본문 없음 — `{rev}` 하나.
pub(crate) const CHANGED_EVENT: &str = "side-chats-changed";

/// 목록 판 번호 — 주 창 · 원격 창이 같은 `chats.json` 을 함께 고친다. 잠금이 파일 읽기 · 쓰기도 감싼다 — 읽은 글과 판이 어긋나지 않게.
static REV: std::sync::Mutex<u64> = std::sync::Mutex::new(0);

fn check_base(now: u64, base: u64) -> Result<(), String> {
    if now == base {
        return Ok(());
    }
    Err(crate::errors::with_reason(
        crate::errors::STALE_LIST,
        tr!(ko: "사이드 채팅 목록이 다른 창에서 바뀌었습니다", en: "The side chats were changed in another window"),
    ))
}

fn load_with_rev(path: &Path) -> Result<(Option<String>, u64), String> {
    let rev = REV.lock().unwrap_or_else(|e| e.into_inner());
    Ok((load_at(path)?, *rev))
}

fn save_with_rev(path: &Path, json: &str, base: u64) -> Result<(u64, bool), String> {
    let mut rev = REV.lock().unwrap_or_else(|e| e.into_inner());
    check_base(*rev, base)?;
    let changed = save_at(path, json)?;
    if changed {
        *rev += 1;
    }
    Ok((*rev, changed))
}

#[tauri::command]
pub async fn side_chats_load() -> Result<serde_json::Value, String> {
    let path = root().ok_or_else(missing_dir)?.join("chats.json");
    let (json, rev) = tauri::async_runtime::spawn_blocking(move || load_with_rev(&path))
        .await
        .map_err(|e| tr!(ko: "사이드 채팅 목록을 읽는 작업이 실패했습니다: {e}", en: "The task that reads the side chats failed: {e}"))??;
    Ok(serde_json::json!({ "json": json, "rev": rev }))
}

/// 읽은 판(`baseRev`)이 지금 판과 다르면 쓰지 않고 `[stale-list]` — 프런트가 다시 읽고 제 바뀜을 다시 얹는다.
#[tauri::command]
pub async fn side_chats_save(app: tauri::AppHandle, json: String, base_rev: u64) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    let path = root().ok_or_else(missing_dir)?.join("chats.json");
    let (rev, changed) = tauri::async_runtime::spawn_blocking(move || save_with_rev(&path, &json, base_rev))
        .await
        .map_err(|e| tr!(ko: "사이드 채팅 목록을 쓰는 작업이 실패했습니다: {e}", en: "The task that writes the side chats failed: {e}"))??;
    if changed {
        let _ = app.emit(CHANGED_EVENT, serde_json::json!({ "rev": rev }));
    }
    Ok(serde_json::json!({ "rev": rev }))
}

#[tauri::command]
pub async fn side_chat_dir(id: String) -> Result<String, String> {
    let root = root().ok_or_else(missing_dir)?;
    let dir = chat_dir(&root, &id).ok_or_else(|| tr!(ko: "사이드 채팅 id 가 올바르지 않습니다", en: "Invalid side chat id"))?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir.to_str()
            .map(|s| s.replace('\\', "/"))
            .ok_or_else(|| tr!(ko: "사이드 채팅 폴더 경로를 글자로 바꿀 수 없습니다", en: "The side chat folder path is not valid text"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn side_chat_remove(id: String) -> Result<(), String> {
    let root = root().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || remove_chat_dir(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}

fn remove_chat_dir(root: &Path, id: &str) -> Result<(), String> {
    let dir = chat_dir(root, id).ok_or_else(|| tr!(ko: "사이드 채팅 id 가 올바르지 않습니다", en: "Invalid side chat id"))?;
    super::perm::remove(root, id);
    let meta = match std::fs::symlink_metadata(&dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.is_dir() || has_link(&dir)? {
        let path = dir.display();
        return Err(tr!(
            ko: "사이드 채팅 폴더에 링크(심볼릭 · 정션)가 있거나 폴더가 아니라 지우지 않았습니다: {path}",
            en: "Did not remove the side chat folder — it is not a plain folder or holds a link (symlink · junction): {path}",
            path = path
        ));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

/// 링크는 따라가지 않는다(`symlink_metadata` — Windows 정션도 링크로 본다).
fn has_link(path: &Path) -> Result<bool, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Ok(true);
    }
    if !meta.is_dir() {
        return Ok(false);
    }
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        if has_link(&entry.map_err(|e| e.to_string())?.path())? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 세션 서버가 채팅을 띄울 때 직접 읽는다 — 프런트 · op 몸은 글을 나르지 않는다.
pub(crate) const INSTRUCTIONS_FILE: &str = "CLAUDE.md";
/// 세션 서버의 읽기 상한(`server::side_chat` 의 `DOC_MAX`)과 같다(컴파일 단언).
pub(crate) const INSTRUCTIONS_MAX: usize = 1024 * 1024;

fn load_instructions_at(path: &Path) -> Result<String, String> {
    Ok(load_at(path)?.unwrap_or_default())
}

fn save_instructions_at(path: &Path, text: &str) -> Result<(), String> {
    if text.len() > INSTRUCTIONS_MAX {
        let max = INSTRUCTIONS_MAX / 1024;
        return Err(tr!(
            ko: "사이드 채팅 지침이 너무 깁니다(최대 {max} KB)",
            en: "The side chat instructions are too long (at most {max} KB)",
            max = max
        ));
    }
    if text.trim().is_empty() {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    save_at(path, text).map(|_| ())
}

/// 본문은 로그에 남기지 않는다.
#[tauri::command]
pub async fn side_chat_instructions_load() -> Result<String, String> {
    let path = root().ok_or_else(missing_dir)?.join(INSTRUCTIONS_FILE);
    tauri::async_runtime::spawn_blocking(move || load_instructions_at(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn side_chat_instructions_save(text: String) -> Result<(), String> {
    let path = root().ok_or_else(missing_dir)?.join(INSTRUCTIONS_FILE);
    tauri::async_runtime::spawn_blocking(move || save_instructions_at(&path, &text))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instructions_save_load_clear() {
        let tmp = TempDir::new("ins");
        let path = tmp.0.join(INSTRUCTIONS_FILE);
        assert_eq!(load_instructions_at(&path).unwrap(), "");
        save_instructions_at(&path, "Answer in Korean.").unwrap();
        assert_eq!(load_instructions_at(&path).unwrap(), "Answer in Korean.");
        assert!(save_instructions_at(&path, &"x".repeat(INSTRUCTIONS_MAX + 1)).is_err());
        assert_eq!(load_instructions_at(&path).unwrap(), "Answer in Korean.", "거절은 파일을 건드리지 않는다");
        save_instructions_at(&path, " \n ").unwrap();
        assert!(!path.exists());
        save_instructions_at(&path, "").unwrap();
        assert!(!tmp.0.read_dir().unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".tmp")), "임시 파일 없음");
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let p = std::env::temp_dir().join(format!("aynx-sidechat-{tag}-{}-{n}", std::process::id()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn list_saves_only_on_the_read_rev() {
        let tmp = TempDir::new("rev");
        let path = tmp.0.join("chats.json");
        let (none, r0) = load_with_rev(&path).unwrap();
        assert_eq!(none, None);
        let (r1, changed) = save_with_rev(&path, "{\"v\":2,\"a\":1}", r0).unwrap();
        assert!(changed && r1 > r0);
        assert_eq!(save_with_rev(&path, "{\"v\":2,\"a\":1}", r1).unwrap(), (r1, false));
        let e = save_with_rev(&path, "{\"v\":2,\"b\":1}", r0).unwrap_err();
        assert!(e.starts_with("[stale-list] "), "{e}");
        assert_eq!(load_with_rev(&path).unwrap(), (Some("{\"v\":2,\"a\":1}".to_string()), r1));
        assert!(check_base(3, 3).is_ok() && check_base(3, 2).is_err());
    }

    #[test]
    fn id_is_one_plain_path_segment() {
        assert!(id_ok("0123abcd0123abcd"));
        assert!(id_ok("a-b"));
        assert!(!id_ok(""));
        assert!(!id_ok(".."));
        assert!(!id_ok("a/b"));
        assert!(!id_ok(r"a\b"));
        assert!(!id_ok("a.b"));
        assert!(!id_ok(&"a".repeat(ID_MAX + 1)));
        let root = Path::new("/x/sidechat");
        assert_eq!(chat_dir(root, "abc"), Some(root.join("abc")));
        assert_eq!(chat_dir(root, "../abc"), None);
    }

    #[test]
    fn remove_takes_only_that_folder_and_missing_is_ok() {
        let tmp = TempDir::new("rm");
        let a = tmp.0.join("aaaa");
        let b = tmp.0.join("bbbb");
        std::fs::create_dir_all(a.join("sub")).unwrap();
        std::fs::write(a.join("sub").join("f.txt"), "x").unwrap();
        std::fs::create_dir_all(&b).unwrap();
        remove_chat_dir(&tmp.0, "aaaa").unwrap();
        assert!(!a.exists());
        assert!(b.exists(), "다른 채팅 폴더는 남는다");
        remove_chat_dir(&tmp.0, "aaaa").unwrap();
        assert!(remove_chat_dir(&tmp.0, "../bbbb").is_err());
        assert!(b.exists());
    }

    /// 링크를 만들 권한이 없는 환경(Windows 개발자 모드 꺼짐)이면 이 시험은 건너뛴다.
    #[test]
    fn remove_refuses_a_folder_holding_a_link() {
        let tmp = TempDir::new("link");
        let outside = tmp.0.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), "x").unwrap();
        let chat = tmp.0.join("cccc");
        std::fs::create_dir_all(&chat).unwrap();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, chat.join("ln")).is_ok();
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, chat.join("ln")).is_ok();
        if !made {
            return;
        }
        assert!(remove_chat_dir(&tmp.0, "cccc").is_err());
        assert!(outside.join("keep.txt").exists(), "링크 너머는 그대로");
        assert!(chat.exists());
    }
}
