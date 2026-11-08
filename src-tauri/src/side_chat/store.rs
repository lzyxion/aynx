//! **채팅 사이드 독의 저장 · 폴더** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md 구현 순서 2).
//!
//! 사이드 채팅 하나 = 세션 서버의 채팅 프로세스 하나(v2 — `server::side_chat` · 목록 상태는 프런트 `app/side-chats.svelte.ts` · 그리는 곳은
//! `ChatDock`). v1 의 "워크스페이스 밖 AI 타일" 은 걷었다(7단계 — 스트림 머리 판정까지). 여기 사는 것은 둘뿐이다:
//!
//! - **목록 파일** `<데이터 루트>/sidechat/chats.json` — 불투명 blob(스키마는 프런트 `$lib/side-chat` 의 `parseSideChats`).
//!   스니펫과 같은 관례([`crate::app_state::load_at`] · [`crate::app_state::save_at`] — 원자적 쓰기 · 무변경 생략). 주 창 · 원격 창이 함께
//!   고치므로(2026-11-01) **판 번호**를 둔다 — 읽기는 `{json, rev}`, 쓰기는 읽은 판(`baseRev`)이 지금 판일 때만(아니면 `[stale-list]`) ·
//!   쓰면 모든 창에 본문 없는 `side-chats-changed{rev}`.
//! - **채팅마다 폴더** `<데이터 루트>/sidechat/<id>/` — 그 채팅 CLI 의 cwd(갈라 온 채팅은 그 대화의 기록된 폴더에서 돌고 이 폴더는
//!   지우기의 단위로만 남는다 — `server::side_chat` "타일 대화 이어 가기"). 이어 가기는 대화 id 로(`--resume` · `thread/resume`).
//!   경로를 정하는 것은 여기 하나다(`instance::data_root` — 개발 · 릴리스가 저절로 갈린다). 프런트는 경로를 다시 보내지 않는다.
//! - **사이드 채팅 지침** `<데이터 루트>/sidechat/CLAUDE.md`(2026-11-01 — 설정 › 지침의 "사이드 채팅" 칸) — 읽기 · 쓰기 명령 둘
//!   ([`side_chat_instructions_load`] · [`side_chat_instructions_save`]). 싣는 것은 세션 서버가 파일을 직접 읽어서다(`server::side_chat`).
//!
//! **지우기는 그 채팅 폴더 하나만**이고, 폴더나 그 안 어디에든 링크(심볼릭 · 정션)가 있으면 지우지 않는다 — `git worktree
//! remove` 가 정션을 따라가 노트 저장소를 지운 사고(CLAUDE.md)를 되풀이하지 않는다. 파일 안 값은 없다(대화는 CLI 가 제 폴더에 둔다).

use std::path::{Path, PathBuf};

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

/// 채팅 id 상한 — 프런트는 16자 hex 를 쓴다. 넉넉히 두되 경로 조각으로만 받는다.
const ID_MAX: usize = 64;

/// `<데이터 루트>/sidechat` — 모든 사이드 채팅 폴더 · 목록 파일의 부모(v2 세션 서버 `server::side_chat` 도 여기서 받는다).
pub(crate) fn root() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("sidechat"))
}

/// 채팅 id 로 받는 모양인가 — 영숫자 · `-` 만(경로 구분자 · `.` 없음 — 폴더 이름 하나로만 쓰인다). **순수**.
pub(crate) fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= ID_MAX && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// 그 채팅의 폴더 — 모양이 틀리면 `None`. **순수**(만들지 않는다).
pub(crate) fn chat_dir(root: &Path, id: &str) -> Option<PathBuf> {
    id_ok(id).then(|| root.join(id))
}

/// 목록이 바뀌었다는 알림(본문 없음 — `{rev}` 하나). 모든 창(주 창 · 원격 창)이 받아 다시 읽는다.
pub(crate) const CHANGED_EVENT: &str = "side-chats-changed";

/// **목록 판 번호**(2026-11-01 — 주 창 · 원격 창이 같은 `chats.json` 을 함께 고친다). 이 GUI 프로세스에서 쓸 때마다 +1(0 = 부팅 뒤 아직 안
/// 씀). 잠금이 파일 읽기 · 쓰기도 감싼다 — 읽은 글과 판이 어긋나지 않게.
static REV: std::sync::Mutex<u64> = std::sync::Mutex::new(0);

/// 저장의 판정 — **순수**. 읽은 판(`base`)이 지금 판(`now`)과 다르면 `[stale-list]`(다른 창이 그 사이 썼다 — 쓰지 않는다).
fn check_base(now: u64, base: u64) -> Result<(), String> {
    if now == base {
        return Ok(());
    }
    Err(crate::errors::with_reason(
        crate::errors::STALE_LIST,
        tr!(ko: "사이드 채팅 목록이 다른 창에서 바뀌었습니다", en: "The side chats were changed in another window"),
    ))
}

/// 읽기 · 쓰기의 몸 — 파일 경로를 받아 시험할 수 있게 둔다. → `(글, 판)`.
fn load_with_rev(path: &Path) -> Result<(Option<String>, u64), String> {
    let rev = REV.lock().unwrap_or_else(|e| e.into_inner());
    Ok((load_at(path)?, *rev))
}

/// → 새 판과 바뀌었나(같은 글이면 판을 올리지 않는다 · 디스크도 건드리지 않는다).
fn save_with_rev(path: &Path, json: &str, base: u64) -> Result<(u64, bool), String> {
    let mut rev = REV.lock().unwrap_or_else(|e| e.into_inner());
    check_base(*rev, base)?;
    let changed = save_at(path, json)?;
    if changed {
        *rev += 1;
    }
    Ok((*rev, changed))
}

/// 저장된 목록을 읽는다 → `{json: 글 | null(아직 없음), rev}`(`rev` 는 다음 저장의 `baseRev`).
#[tauri::command]
pub async fn side_chats_load() -> Result<serde_json::Value, String> {
    let path = root().ok_or_else(missing_dir)?.join("chats.json");
    let (json, rev) = tauri::async_runtime::spawn_blocking(move || load_with_rev(&path))
        .await
        .map_err(|e| tr!(ko: "사이드 채팅 목록을 읽는 작업이 실패했습니다: {e}", en: "The task that reads the side chats failed: {e}"))??;
    Ok(serde_json::json!({ "json": json, "rev": rev }))
}

/// 목록 전체를 저장한다 → `{rev}`. 읽은 판(`baseRev`)이 지금 판과 다르면 쓰지 않고 `[stale-list]`(프런트가 다시 읽고 제 바뀜을 다시 얹는다).
/// 내용이 그대로면 디스크를 건드리지 않고 판도 그대로다. 바뀌었으면 모든 창에 본문 없는 `side-chats-changed{rev}` 를 낸다.
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

/// 그 채팅의 폴더를 (없으면 만들어) 돌려준다 — 타일의 시작 폴더(`cwd`). 구분자는 `/`(다른 타일 경로와 같은 모양).
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

/// 그 채팅의 폴더를 지운다(채팅 지우기) — 없으면 그대로 성공. 링크가 하나라도 있으면 지우지 않고 오류(모듈 머리말).
#[tauri::command]
pub async fn side_chat_remove(id: String) -> Result<(), String> {
    let root = root().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || remove_chat_dir(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}

/// [`side_chat_remove`] 의 몸 — 부모(`root`)를 받아 시험할 수 있게 둔다.
fn remove_chat_dir(root: &Path, id: &str) -> Result<(), String> {
    let dir = chat_dir(root, id).ok_or_else(|| tr!(ko: "사이드 채팅 id 가 올바르지 않습니다", en: "Invalid side chat id"))?;
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

/// 이 경로 자신이나 그 아래 어디에든 링크가 있나 — 링크는 따라가지 않는다(`symlink_metadata` — Windows 정션도 링크로 본다).
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

/// **사이드 채팅 지침** 파일 이름 — `<데이터 루트>/sidechat/CLAUDE.md`(2026-11-01). 사람이 설정 › 지침에서 쓰고, 세션 서버가 채팅을 띄울 때
/// 직접 읽어 두 CLI 에 싣는다(Claude 지침 파일 · Codex `developerInstructions` — `server::side_chat`). 프런트 · op 몸은 글을 나르지 않는다.
pub(crate) const INSTRUCTIONS_FILE: &str = "CLAUDE.md";
/// 사이드 채팅 지침 저장 상한(바이트) — 세션 서버의 읽기 상한(`server::side_chat` 의 `DOC_MAX`)과 같다(컴파일 단언).
pub(crate) const INSTRUCTIONS_MAX: usize = 1024 * 1024;

/// 지침 읽기의 몸 — 없으면 빈 글.
fn load_instructions_at(path: &Path) -> Result<String, String> {
    Ok(load_at(path)?.unwrap_or_default())
}

/// 지침 쓰기의 몸 — 상한을 넘으면 거절 · 빈 글(공백뿐 포함)이면 파일을 지운다(없으면 그대로) · 아니면 원자적 쓰기(임시 파일 → rename).
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

/// 사이드 채팅 지침을 읽는다 → 글(없으면 빈 글). 본문은 로그에 남기지 않는다.
#[tauri::command]
pub async fn side_chat_instructions_load() -> Result<String, String> {
    let path = root().ok_or_else(missing_dir)?.join(INSTRUCTIONS_FILE);
    tauri::async_runtime::spawn_blocking(move || load_instructions_at(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// 사이드 채팅 지침을 저장한다 — 빈 글이면 파일을 지운다. 새로 띄우는 채팅 프로세스부터 실린다(도는 프로세스는 그대로).
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

    /// 사이드 채팅 지침 — 없으면 빈 글 · 쓰고 읽기 · 상한 넘으면 거절(파일 그대로) · 빈 글이면 지운다(이미 없어도 성공).
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

    /// 시험마다 겹치지 않는 임시 폴더
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

    /// 목록 판 — 읽은 판으로만 쓴다 · 다른 창이 그 사이 썼으면 `[stale-list]` · 같은 글은 판을 올리지 않는다.
    #[test]
    fn list_saves_only_on_the_read_rev() {
        let tmp = TempDir::new("rev");
        let path = tmp.0.join("chats.json");
        let (none, r0) = load_with_rev(&path).unwrap();
        assert_eq!(none, None);
        let (r1, changed) = save_with_rev(&path, "{\"v\":2,\"a\":1}", r0).unwrap();
        assert!(changed && r1 > r0);
        // 같은 글 — 판 그대로
        assert_eq!(save_with_rev(&path, "{\"v\":2,\"a\":1}", r1).unwrap(), (r1, false));
        // 옛 판으로 쓰려는 창(다른 창이 그 사이 썼다) — 쓰지 않는다
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
        remove_chat_dir(&tmp.0, "aaaa").unwrap(); // 이미 없다
        assert!(remove_chat_dir(&tmp.0, "../bbbb").is_err());
        assert!(b.exists());
    }

    /// 링크가 있으면 지우지 않는다 — 링크를 만들 권한이 없는 환경(Windows 개발자 모드 꺼짐)이면 이 시험은 건너뛴다.
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
