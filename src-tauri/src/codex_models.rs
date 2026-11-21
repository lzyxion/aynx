//! Codex 모델 이름 — 사이드 채팅 칩 · AI 타일 대화 면의 모델 목록. 지어내지 않고 Codex 의 `models_cache.json` · `config.toml` 을 읽기만 한다
//! (드롭다운을 열 때마다 `codex debug models` 를 돌리면 느리다). 파일이 없거나 깨지면 빈 값이고, 파일 내용은 싣지 않는다.

use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModels {
    pub configured: Option<String>,
    pub models: Vec<String>,
    pub levels: BTreeMap<String, CodexLevels>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexLevels {
    pub levels: Vec<String>,
    pub default: Option<String>,
}

fn level_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 16 && s.chars().all(|c| c.is_ascii_lowercase())
}

pub(crate) fn parse_cache_levels(text: &str) -> BTreeMap<String, CodexLevels> {
    let mut out = BTreeMap::new();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return out;
    };
    let Some(list) = v.get("models").and_then(|m| m.as_array()) else {
        return out;
    };
    for m in list {
        let Some(slug) = m.get("slug").and_then(|s| s.as_str()) else { continue };
        if m.get("visibility").and_then(|s| s.as_str()) != Some("list") || !plausible(slug) || out.contains_key(slug) {
            continue;
        }
        let mut levels: Vec<String> = Vec::new();
        for l in m.get("supported_reasoning_levels").and_then(|l| l.as_array()).into_iter().flatten() {
            let e = l.get("effort").and_then(|e| e.as_str()).or_else(|| l.as_str());
            if let Some(e) = e.filter(|e| level_ok(e)) {
                if !levels.iter().any(|x| x == e) {
                    levels.push(e.to_owned());
                }
            }
        }
        let default = m
            .get("default_reasoning_level")
            .and_then(|d| d.as_str())
            .filter(|d| level_ok(d))
            .map(str::to_owned);
        out.insert(slug.to_owned(), CodexLevels { levels, default });
    }
    out
}

/// 프런트 `sideChatModelOk` 와 같은 모양 — 셸 줄에 실릴 값이라 좁게 둔다.
fn plausible(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "._:[]-".contains(c))
}

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

pub(crate) fn parse_config_model(text: &str) -> Option<String> {
    let doc: toml_edit::DocumentMut = text.parse().ok()?;
    let s = doc.get("model")?.as_str()?.trim();
    plausible(s).then(|| s.to_owned())
}

#[tauri::command]
pub async fn codex_models() -> Result<CodexModels, ()> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(home) = crate::codex_mcp::codex_home() else {
            return CodexModels::default();
        };
        let read = |name: &str| std::fs::read_to_string(home.join(name)).ok();
        let cache = read("models_cache.json");
        CodexModels {
            configured: read("config.toml").as_deref().and_then(parse_config_model),
            models: cache.as_deref().map(parse_cache).unwrap_or_default(),
            levels: cache.as_deref().map(parse_cache_levels).unwrap_or_default(),
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
    fn cache_levels_per_listed_model() {
        let text = r#"{"models":[
            {"slug":"a-model","visibility":"list","default_reasoning_level":"low",
             "supported_reasoning_levels":[{"effort":"low"},{"effort":"high"},{"effort":"Bad Level"},{"effort":"low"}]},
            {"slug":"b-model","visibility":"list","default_reasoning_level":"--x"},
            {"slug":"hidden","visibility":"hide","supported_reasoning_levels":[{"effort":"low"}]}
        ]}"#;
        let m = parse_cache_levels(text);
        assert_eq!(m.keys().collect::<Vec<_>>(), ["a-model", "b-model"]);
        assert_eq!(m["a-model"], CodexLevels { levels: vec!["low".into(), "high".into()], default: Some("low".into()) });
        assert_eq!(m["b-model"], CodexLevels::default());
        assert!(parse_cache_levels("{").is_empty());
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
