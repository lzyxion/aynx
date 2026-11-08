//! Codex 모델 이름 — 사이드 채팅 칩의 모델 목록(2026-10-23).
//!
//! **지어내지 않는다** — 두 곳에서 읽기만 한다(프로세스를 띄우지 않는다 — 드롭다운을 열 때마다 `codex debug models` 를
//! 돌리면 느리다):
//! - `<codex_home>/models_cache.json` — Codex 자신이 받아 둔 모델 목록(`models[].slug` · `visibility` · `priority`).
//!   `visibility: "list"` 인 것만(Codex 의 `/model` 고르개가 보여 주는 것), `priority` 오름차순.
//! - `<codex_home>/config.toml` 의 맨 위 `model` — 사용자가 고른 기본 모델.
//!
//! 두 파일 다 없거나 깨져 있으면 빈 값이다(오류 아님 — 칩은 "CLI 기본" 과 직접 입력만 남는다). 파일 내용은 싣지 않는다.

use serde::Serialize;

/// `codex_models` 결과(camelCase)
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModels {
    /// `config.toml` 의 `model`(없으면 `None`)
    pub configured: Option<String>,
    /// 캐시의 보이는 모델 slug — 순서 = Codex 의 `priority`
    pub models: Vec<String>,
}

/// 모델 이름으로 받아 줄 글자 — 프런트 `sideChatModelOk` 와 같은 모양(셸 줄에 실릴 값이라 좁게 · 64자)
fn plausible(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "._:[]-".contains(c))
}

/// `models_cache.json` 본문 → 보이는 slug 목록(중복 없음 · `priority` 순)
pub(crate) fn parse_cache(text: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(list) = v.get("models").and_then(|m| m.as_array()) else {
        return Vec::new();
    };
    let mut rows: Vec<(i64, usize, String)> = Vec::new();
    for (i, m) in list.iter().enumerate() {
        let Some(slug) = m.get("slug").and_then(|s| s.as_str()) else { continue };
        if m.get("visibility").and_then(|s| s.as_str()) != Some("list") || !plausible(slug) {
            continue;
        }
        if rows.iter().any(|r| r.2 == slug) {
            continue;
        }
        let prio = m.get("priority").and_then(|p| p.as_i64()).unwrap_or(i64::MAX);
        rows.push((prio, i, slug.to_owned()));
    }
    rows.sort_by_key(|r| (r.0, r.1));
    rows.into_iter().map(|r| r.2).collect()
}

/// `config.toml` 본문 → 맨 위 `model`(프로필 안 값은 보지 않는다)
pub(crate) fn parse_config_model(text: &str) -> Option<String> {
    let doc: toml_edit::DocumentMut = text.parse().ok()?;
    let s = doc.get("model")?.as_str()?.trim();
    plausible(s).then(|| s.to_owned())
}

/// 사이드 채팅 칩의 Codex 모델 목록 — 파일 둘을 읽기만 한다(블로킹 풀)
#[tauri::command]
pub async fn codex_models() -> Result<CodexModels, ()> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(home) = crate::codex_mcp::codex_home() else {
            return CodexModels::default();
        };
        let read = |name: &str| std::fs::read_to_string(home.join(name)).ok();
        CodexModels {
            configured: read("config.toml").as_deref().and_then(parse_config_model),
            models: read("models_cache.json").as_deref().map(parse_cache).unwrap_or_default(),
        }
    })
    .await
    .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_keeps_listed_models_in_priority_order() {
        let text = r#"{"models":[
            {"slug":"b-model","visibility":"list","priority":4},
            {"slug":"hidden","visibility":"hide","priority":1},
            {"slug":"a-model","visibility":"list","priority":1},
            {"slug":"a-model","visibility":"list","priority":9},
            {"slug":"bad name;rm","visibility":"list","priority":0},
            {"visibility":"list","priority":0}
        ]}"#;
        assert_eq!(parse_cache(text), vec!["a-model", "b-model"]);
    }

    #[test]
    fn broken_or_missing_cache_is_empty() {
        assert!(parse_cache("").is_empty());
        assert!(parse_cache("{").is_empty());
        assert!(parse_cache(r#"{"models":3}"#).is_empty());
    }

    #[test]
    fn config_model_is_top_level_only() {
        assert_eq!(parse_config_model("model = \"x-1\"\n").as_deref(), Some("x-1"));
        assert_eq!(parse_config_model("[profiles.a]\nmodel = \"x-1\"\n"), None);
        assert_eq!(parse_config_model("model = \"\"\n"), None);
        assert_eq!(parse_config_model("model = 3\n"), None);
        assert_eq!(parse_config_model("model = \"x\n"), None);
    }
}
