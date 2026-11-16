//! 탭 템플릿 저장 — `<config_dir>/aynx/tab-templates.json` 읽기·쓰기.
//!
//! 템플릿은 **탭 하나를 여는 법**(분할 트리 배치 + 타일마다 종류와 연결 대상)을 이름 붙여 남긴 것이다 — 열 때마다
//! 새 세션으로 찍어 낸다. 워크스페이스(살아 있는 탭 묶음 · `workspaces.json`)와 다르고, 2026-10-02 에 걷은 저장
//! 레이아웃과도 다르다.
//!
//! 스니펫(`snippets.rs`)과 **완전히 같은 관례**다 — 불투명 blob, 원자적 쓰기, 무변경 생략, `clear_*` 없음. 실제 파일
//! 조작도 [`crate::app_state`] 의 같은 헬퍼([`load_at`]·[`save_at`]) 하나를 지난다.
//!
//! ## 백엔드는 스키마를 모른다
//!
//! JSON 문자열을 그대로 보관할 뿐 파싱도 검증도 하지 않는다. 형식 버전 · 트리 검증 · 폴더 상대화는 전부 프런트의
//! 관심사다(`src/lib/tab-templates.ts` 의 `parseTemplates`).
//!
//! **보안 메모**: 이 파일에 비밀은 없다 — 프런트가 세션 고유 값(세션 id · 타일 키 · 스크롤백 · 대화 id)과 함께
//! 비밀번호 자리도 없는 저장 트리만 보낸다. 앱은 여기서 읽은 것을 실행하지 않는다 — 템플릿을 여는 것은 사람이 누른
//! 순간 프런트가 타일을 새로 세우는 일이고, 인증은 여느 타일과 같은 길(볼트 · 호스트 설정 · 비밀번호 입력)이다.

use std::path::PathBuf;

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

/// `<config_dir>/aynx/tab-templates.json` — 저장해 둔 템플릿 목록.
fn tab_templates_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("tab-templates.json"))
}

/// 저장된 템플릿 목록을 읽는다. 아직 하나도 저장하지 않았으면 `None`.
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

/// 템플릿 목록을 저장한다 — **목록 전체**를 한 번에 쓴다(내용이 그대로면 디스크를 건드리지 않는다).
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

    /// 테스트마다 겹치지 않는 임시 경로 (snippets.rs 의 같은 헬퍼와 동일한 규칙).
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

    /// 프런트가 보낼 법한 모양 — 백엔드는 이 구조를 **모른 채** 문자열로만 다룬다.
    const SAMPLE: &str = r#"{"version":1,"templates":[{"id":"t1","name":"백엔드","projectId":"p1","root":{"dir":"row","ratio":0.5,"a":{"kind":"local","autorun":"claude","cwd":"."},"b":{"kind":"ssh","alias":"web-01"}},"savedAt":1}]}"#;

    #[test]
    fn save_then_load_returns_the_same_string() {
        let tmp = TempDir::new("왕복");
        let path = tmp.path("tab-templates.json");

        assert!(save_at(&path, SAMPLE).expect("저장"));
        assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));
        // 같은 내용이면 디스크를 안 때린다 (스니펫과 같은 규칙).
        assert!(!save_at(&path, SAMPLE).expect("같은 내용"));
    }

    #[test]
    fn missing_file_loads_as_none() {
        let tmp = TempDir::new("없는파일");
        assert_eq!(load_at(&tmp.path("tab-templates.json")).expect("읽기"), None);
    }

    /// 템플릿 파일은 **다른 파일**이다 — 열린 탭 배치(`workspaces.json`)와 이름도 수명도 갈린다.
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
