//! 스니펫 저장 — `snippets.json` 읽기·쓰기(불투명 blob — 스키마는 프런트 `src/lib/snippets.ts`).
//!
//! 이 파일에 들어오는 것은 사용자가 손으로 적은 명령뿐이다 — 앱은 여기에 아무것도 지어 넣지 않고 읽어서 실행하지도 않는다
//! (프런트가 사람이 누른 순간 포커스된 타일의 PTY 에 써 넣을 뿐이다).

use std::path::PathBuf;

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

fn snippets_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("snippets.json"))
}

#[tauri::command]
pub async fn load_snippets() -> Result<Option<String>, String> {
    let path = snippets_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_at(&path))
        .await
        .map_err(|e| {
            tr!(
                ko: "스니펫을 읽는 작업이 실패했습니다: {e}",
                en: "The task that reads the snippets failed: {e}"
            )
        })?
}

#[tauri::command]
pub async fn save_snippets(json: String) -> Result<(), String> {
    let path = snippets_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || save_at(&path, &json).map(|_| ()))
        .await
        .map_err(|e| {
            tr!(
                ko: "스니펫을 쓰는 작업이 실패했습니다: {e}",
                en: "The task that writes the snippets failed: {e}"
            )
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir()
                .join(format!("aynx-스니펫-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("임시 폴더 생성");
            Self(dir)
        }

        fn path(&self, rel: &str) -> PathBuf {
            self.0.join(rel)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const SAMPLE: &str = r#"{"version":1,"snippets":[{"id":"S1","name":"nginx 상태","command":"systemctl status {{서비스}}","scope":{"kind":"host","alias":"web-01"},"enter":true}]}"#;

    #[test]
    fn save_then_load_returns_the_same_string() {
        let tmp = TempDir::new("왕복");
        let path = tmp.path("snippets.json");

        assert!(save_at(&path, SAMPLE).expect("저장"));
        assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));

        assert!(!save_at(&path, SAMPLE).expect("같은 내용"));
    }

    #[test]
    fn missing_file_loads_as_none() {
        let tmp = TempDir::new("없는파일");
        assert_eq!(load_at(&tmp.path("snippets.json")).expect("읽기"), None);
    }

    #[test]
    fn snippets_live_in_their_own_file() {
        let tmp = TempDir::new("따로");
        let snippets = tmp.path("snippets.json");
        save_at(&snippets, SAMPLE).expect("저장");
        assert!(!tmp.path("layouts.json").exists());
        assert!(!tmp.path("workspaces.json").exists());

        if let Some(p) = snippets_path() {
            assert_eq!(
                p.file_name().and_then(|n| n.to_str()),
                Some("snippets.json")
            );
            assert_eq!(
                p.parent()
                    .and_then(|d| d.file_name())
                    .and_then(|n| n.to_str()),
                Some(crate::instance::app_dir_name(crate::instance::DEV))
            );
        }
    }
}
