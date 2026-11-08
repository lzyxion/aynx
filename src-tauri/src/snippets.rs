//! 스니펫 저장 — `<config_dir>/aynx/snippets.json` 읽기·쓰기
//! (docs/log/2026-09-16-snippets.md).
//!
//! 사용자가 이름 붙여 남겨 둔 **명령 한 줄**들의 목록이다. `layouts.json`·
//! `theme-profiles.json` 과 **완전히 같은 관례**를 쓴다 — 불투명 blob, 원자적 쓰기,
//! 무변경 생략, `clear_*` 없음. 실제 파일 조작도 [`crate::app_state`] 의 같은 헬퍼
//! ([`load_at`]·[`save_at`]) 하나를 지난다: 저장 규칙이 파일마다 갈릴 자리를 남기지 않는다.
//!
//! ## 왜 `app_state.rs` 안이 아니라 새 파일인가
//!
//! 저기 있는 세 파일은 전부 **화면의 모양**(열려 있는 배치 · 아껴 둔 배치 · 아껴 둔 테마)
//! 이고, 이것은 **사용자가 적어 둔 글자**다. 한 모듈에 넣으면 그 파일의 머리말이 "배치
//! 저장" 이라는 한 가지 이야기를 못 하게 된다. 헬퍼를 공유하는 것으로 충분하다.
//!
//! ## 백엔드는 스키마를 모른다
//!
//! 여기서도 마찬가지다 — JSON 문자열을 그대로 보관할 뿐 파싱도 검증도 하지 않는다
//! (`app_state.rs` 의 "백엔드는 스키마를 모른다" 와 같은 분담). 자리표시자 문법
//! (`{{이름}}`)도, 범위(`scope`)도, `enter` 도 전부 프런트의 관심사다
//! (`src/lib/snippets.ts` 의 `parseSnippets`).
//!
//! **보안 메모**: 이 파일에 들어오는 것은 사용자가 손으로 적은 명령뿐이다. 앱은 여기에
//! 아무것도 지어 넣지 않고, 읽어서 실행하지도 않는다 — 프런트가 사람이 누른 순간
//! 포커스된 타일의 PTY 에 써 넣을 뿐이다(사람이 키보드로 친 것과 같은 길).

use std::path::PathBuf;

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

/// `<config_dir>/aynx/snippets.json` — 저장해 둔 명령 목록.
///
/// `layouts.json` 과 같은 폴더·같은 관례지만 **파일은 따로**다 (모듈 문서). 여기에도
/// `clear_*` 명령을 두지 않는다 — 스니펫을 지우는 것은 목록에서 한 줄을 빼는 일이고,
/// 그 결과는 프런트가 다시 저장하는 새 목록이다.
fn snippets_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("snippets.json"))
}

/// 저장된 스니펫 목록을 읽는다. 아직 하나도 저장하지 않았으면 `None`.
///
/// 앱 소유 목록의 관례다 — 문자열을 그대로 올려 주고 스키마는 프런트가 본다
/// (`src/lib/snippets.ts` 의 `parseSnippets`).
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

/// 스니펫 목록을 저장한다 — **목록 전체**를 한 번에 쓴다.
///
/// 프런트가 이미 목록 전체를 들고 있으므로 부분 갱신 명령은 백엔드에 스키마 지식을 들여올
/// 뿐이다. 내용이 그대로면 디스크를 건드리지 않는다.
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

    /// 테스트마다 겹치지 않는 임시 경로 (app_state.rs 의 같은 헬퍼와 동일한 규칙).
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

    /// 프런트가 보낼 법한 모양 — 백엔드는 이 구조를 **모른 채** 문자열로만 다룬다.
    /// (자리표시자 `{{서비스}}` 가 그대로 왕복하는지도 함께 본다 — 중괄호는 JSON 안에서
    /// 특별한 글자가 아니지만, 한 번 깨지면 명령이 통째로 못 쓰게 되는 자리라 못 박아 둔다.)
    const SAMPLE: &str = r#"{"version":1,"snippets":[{"id":"S1","name":"nginx 상태","command":"systemctl status {{서비스}}","scope":{"kind":"host","alias":"web-01"},"enter":true}]}"#;

    #[test]
    fn save_then_load_returns_the_same_string() {
        let tmp = TempDir::new("왕복");
        let path = tmp.path("snippets.json");

        assert!(save_at(&path, SAMPLE).expect("저장"));
        assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));

        // 같은 내용이면 디스크를 안 때린다 (프리셋·테마 프로필과 같은 규칙).
        assert!(!save_at(&path, SAMPLE).expect("같은 내용"));
    }

    #[test]
    fn missing_file_loads_as_none() {
        let tmp = TempDir::new("없는파일");
        assert_eq!(load_at(&tmp.path("snippets.json")).expect("읽기"), None);
    }

    /// 스니펫 파일은 **다른 파일**이다 — 배치·프리셋과 이름도 수명도 갈린다.
    #[test]
    fn snippets_live_in_their_own_file() {
        let tmp = TempDir::new("따로");
        let snippets = tmp.path("snippets.json");
        save_at(&snippets, SAMPLE).expect("저장");
        assert!(!tmp.path("layouts.json").exists());
        assert!(!tmp.path("workspaces.json").exists());

        // 실제 경로 규칙도 설정 폴더 안의 그 이름이어야 한다 (홈을 못 찾는 환경이면 건너뛴다).
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
