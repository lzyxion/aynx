//! 탭 템플릿 저장 — `tab-templates.json`. 백엔드는 스키마를 모르는 불투명 문자열이다(형식 · 검증은 프런트 `src/lib/tab-templates.ts`).
//!
//! 이 파일에 비밀은 없다 · 앱은 여기서 읽은 것을 실행하지 않는다 — 템플릿은 사람이 눌러 여는 타일 배치일 뿐이고 인증은 여느 타일과 같은 길이다.

use std::path::PathBuf;

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

fn tab_templates_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("tab-templates.json"))
}

#[tauri::command]
pub async fn load_tab_templates() -> Result<Option<String>, String> {
    let path = tab_templates_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_at(&path))
        .await
        .map_err(|e| {
            tr!(
                ko: "템플릿을 읽는 작업이 실패했습니다: {e}",
                en: "The task that reads the templates failed: {e}"
            )
        })?
}

#[tauri::command]
pub async fn save_tab_templates(json: String) -> Result<(), String> {
    let path = tab_templates_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || save_at(&path, &json).map(|_| ()))
        .await
        .map_err(|e| {
            tr!(
                ko: "템플릿을 쓰는 작업이 실패했습니다: {e}",
                en: "The task that writes the templates failed: {e}"
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
                .join(format!("aynx-템플릿-{tag}-{}-{nanos}", std::process::id()));
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

    const SAMPLE: &str = r#"{"version":1,"templates":[{"id":"t1","name":"백엔드","projectId":"p1","root":{"dir":"row","ratio":0.5,"a":{"kind":"local","autorun":"claude","cwd":"."},"b":{"kind":"ssh","alias":"web-01"}},"savedAt":1}]}"#;

    #[test]
    fn save_then_load_returns_the_same_string() {
        let tmp = TempDir::new("왕복");
        let path = tmp.path("tab-templates.json");

        assert!(save_at(&path, SAMPLE).expect("저장"));
        assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));
        assert!(!save_at(&path, SAMPLE).expect("같은 내용"));
    }

    #[test]
    fn missing_file_loads_as_none() {
        let tmp = TempDir::new("없는파일");
        assert_eq!(load_at(&tmp.path("tab-templates.json")).expect("읽기"), None);
    }

    #[test]
    fn templates_live_in_their_own_file() {
        let tmp = TempDir::new("따로");
        save_at(&tmp.path("tab-templates.json"), SAMPLE).expect("저장");
        assert!(!tmp.path("workspaces.json").exists());
        assert!(!tmp.path("snippets.json").exists());

        if let Some(p) = tab_templates_path() {
            assert_eq!(
                p.file_name().and_then(|n| n.to_str()),
                Some("tab-templates.json")
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
