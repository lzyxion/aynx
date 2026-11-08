//! Codex 전역 등록 해제 이관 — 이 인스턴스의 현재·옛 서버 표만 걷는다.
//! toml_edit로 다른 서버·주석·순서·줄바꿈을 보존한다. 파일 내용은 오류에 싣지 않는다.

use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Item};

use crate::i18n::tr;
use crate::sessions_meta::match_line_endings;

/// `$CODEX_HOME`(비어 있지 않으면), 아니면 `~/.codex` — `agent_hooks`·`agent_sessions` 와 같은 규칙.
pub(crate) fn codex_home() -> Option<PathBuf> {
    match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(h) => Some(PathBuf::from(h)),
        None => Some(dirs::home_dir()?.join(".codex")),
    }
}

/// codex 설정 파일 — `<codex_home>/config.toml`.
pub(crate) fn config_path() -> Option<PathBuf> {
    Some(codex_home()?.join("config.toml"))
}

/// 파서 오류를 사용자 문구로 — **파일 내용을 싣지 않는다**(모듈 머리말). 줄 번호만.
fn parse_error(text: &str, e: &toml_edit::TomlError) -> String {
    let line = e
        .span()
        .map(|s| text[..s.start.min(text.len())].matches('\n').count() + 1);
    match line {
        Some(line) => tr!(
            ko: "Codex 설정 파일(config.toml)이 TOML 로 읽히지 않습니다({line}번째 줄) — 파일을 고친 뒤 앱을 다시 시작하세요.",
            en: "The Codex config file (config.toml) is not valid TOML (line {line}) — fix it, then restart the app."
        ),
        None => tr!(
            ko: "Codex 설정 파일(config.toml)이 TOML 로 읽히지 않습니다 — 파일을 고친 뒤 앱을 다시 시작하세요.",
            en: "The Codex config file (config.toml) is not valid TOML — fix it, then restart the app."
        ),
    }
}

/// 전역 등록 해제 — 요청한 이름의 표 하나만 걷는다. 다른 서버·주석·개발/릴리스 이름은 그대로다.
pub(crate) fn remove(text: &str, name: &str) -> Result<String, String> {
    let mut doc: DocumentMut = text.parse().map_err(|e| parse_error(text, &e))?;
    let Some(servers) = doc.get_mut("mcp_servers").and_then(Item::as_table_like_mut) else {
        return Ok(text.to_owned());
    };
    if servers.remove(name).is_none() {
        return Ok(text.to_owned());
    }
    Ok(match_line_endings(text, doc.to_string()))
}

/// 기존 Codex 등록과 같은 원자적 저장 경로. 파일·항목이 없으면 쓰지 않는다.
pub(crate) fn remove_at(path: &Path, name: &str) -> Result<bool, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => {
            return Err(
                tr!(ko: "Codex 설정 파일을 읽지 못했습니다: {e}", en: "Could not read the Codex config file: {e}"),
            )
        }
    };
    let next = remove(&text, name)?;
    if next == text {
        return Ok(false);
    }
    write_atomic(path, &next)?;
    Ok(true)
}

/// 같은 폴더의 임시 파일에 쓰고 제자리로 옮긴다 — codex 가 반쯤 적힌 설정을 읽지 않게.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let fail = |e: std::io::Error| {
        tr!(
            ko: "Codex 설정 파일을 쓰지 못했습니다: {e}",
            en: "Could not write the Codex config file: {e}"
        )
    };
    let dir = path
        .parent()
        .ok_or_else(|| fail(std::io::ErrorKind::NotFound.into()))?;
    std::fs::create_dir_all(dir).map_err(fail)?;
    let tmp = dir.join(format!(".config.toml.aynx-{}.tmp", std::process::id()));
    std::fs::write(&tmp, contents).map_err(fail)?;
    // Windows 의 `rename` 도 대상이 있으면 덮어쓴다(MOVEFILE_REPLACE_EXISTING).
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        fail(e)
    })
}

#[cfg(test)]
mod removal_tests {
    use super::*;

    #[test]
    fn removal_preserves_other_servers_comments_and_line_endings() {
        for newline in ["\n", "\r\n"] {
            let before = "# keep\nmodel = \"test\"\n\n[mcp_servers.aynx-sessions]\nurl = \"http://127.0.0.1:1/mcp\"\n\n[mcp_servers.aynx-sessions-dev] # keep dev\nurl = \"http://127.0.0.1:2/mcp\"\n\n[mcp_servers.other]\ncommand = \"npx\"\n".replace('\n', newline);
            let out = remove(&before, "aynx-sessions").unwrap();
            assert!(!out.contains("[mcp_servers.aynx-sessions]"));
            assert!(out.contains("[mcp_servers.aynx-sessions-dev]"));
            assert!(out.contains("[mcp_servers.other]"));
            assert!(out.contains("# keep") && out.contains("# keep dev"));
            assert_eq!(remove(&out, "aynx-sessions").unwrap(), out);
            if newline == "\r\n" {
                assert!(!out.replace("\r\n", "").contains('\n'));
            }
        }
    }

    #[test]
    fn missing_or_broken_config_is_not_rewritten() {
        assert_eq!(
            remove("model = \"test\"\n", "aynx-sessions").unwrap(),
            "model = \"test\"\n"
        );
        let broken =
            "[mcp_servers.aynx-sessions]\nhttp_headers = { Authorization = \"Bearer test-secret\"\n";
        let error = remove(broken, "aynx-sessions").unwrap_err();
        assert!(!error.contains("test-secret"));
    }
}

#[cfg(test)]
mod file_tests {
    use super::*;

    #[test]
    fn isolated_removal_writes_only_when_the_name_exists() {
        let dir = std::env::current_dir().unwrap().join("target").join(format!(
            "mcp-sessions-remove-{}-{}", std::process::id(), crate::token::generate_token().unwrap()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        assert_eq!(remove_at(&path, "aynx-sessions"), Ok(false));
        assert!(!path.exists());
        let text = "# 유지\n[mcp_servers.aynx-sessions]\nurl = 'http://127.0.0.1:1/mcp'\n[mcp_servers.aynx-sessions-dev]\nurl = 'http://127.0.0.1:2/mcp'\n";
        std::fs::write(&path, text).unwrap();
        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(remove_at(&path, "other"), Ok(false));
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), before);
        assert_eq!(remove_at(&path, "aynx-sessions"), Ok(true));
        assert!(std::fs::read_to_string(&path).unwrap().contains("[mcp_servers.aynx-sessions-dev]"));
        assert_eq!(remove_at(&path, "aynx-sessions"), Ok(false));
        let broken = "[mcp_servers.aynx-sessions]\nhttp_headers = { Authorization = 'Bearer test-secret'\n";
        std::fs::write(&path, broken).unwrap();
        assert!(remove_at(&path, "aynx-sessions").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
