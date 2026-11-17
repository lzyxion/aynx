//! **내보내기** — 고른 범주의 파일을 허용 목록(`catalog`)대로 모은다. 목록 밖의 파일은 **열지도 않는다**
//! (볼트 · 웹훅 · 토큰 파일을 읽는 줄이 이 파일에 없다).

use std::path::Path;

use toml_edit::{DocumentMut, Item, Table};

use super::catalog::{self, AI_MCP_KEY};
use super::zipfile::{Entry, MAX_ENTRY_BYTES};
use super::Roots;
use crate::i18n::tr;

/// 없으면 `None`. 상한을 넘는 파일은 오류(조용히 빼면 사람이 모른다).
pub(super) fn read_opt(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() => {
            if m.len() > MAX_ENTRY_BYTES {
                return Err(tr!(ko: "파일이 너무 큽니다: {path}", en: "A file is too large: {path}", path = path.display()));
            }
            std::fs::read(path)
                .map(Some)
                .map_err(|e| tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()))
        }
        Ok(_) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display())),
    }
}

pub(super) fn read_text_opt(path: &Path) -> Result<Option<String>, String> {
    Ok(read_opt(path)?.map(|b| String::from_utf8_lossy(&b).into_owned()))
}

/// 폴더 안 파일 이름들(정렬) — 없으면 빈 목록. 하위 폴더 · 링크가 아닌 일반 파일만.
pub(super) fn file_names(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = rd
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

pub(super) fn parse_toml(text: &str) -> Option<DocumentMut> {
    text.parse::<DocumentMut>().ok()
}

/// 맨 위 키 → 범주(`settings.toml`). `[ai]` 는 general · mcp 두 범주가 나눠 갖는다.
fn settings_subset(doc: &DocumentMut, has: &dyn Fn(&str) -> bool) -> DocumentMut {
    let mut out = DocumentMut::new();
    for (key, item) in doc.iter() {
        if key == "ai" {
            let Some(ai) = item.as_table() else { continue };
            let mut table = Table::new();
            for (k, v) in ai.iter() {
                let want = if k == AI_MCP_KEY { has("mcp") } else { has("general") };
                if want {
                    table.insert(k, v.clone());
                }
            }
            if !table.is_empty() {
                out.insert("ai", Item::Table(table));
            }
            continue;
        }
        if catalog::section_category(key).is_some_and(has) {
            out.insert(key, item.clone());
        }
    }
    out
}

/// `~/.ssh/sessions.toml` 에서 내보낸 별칭의 `[hosts.*]` 와 `[groups.*]` 만.
fn sessions_subset(doc: &DocumentMut, names: &[String]) -> DocumentMut {
    let mut out = DocumentMut::new();
    if let Some(hosts) = doc.get("hosts").and_then(Item::as_table_like) {
        let mut table = Table::new();
        for (k, v) in hosts.iter() {
            if names.iter().any(|n| n.eq_ignore_ascii_case(k)) {
                table.insert(k, v.clone());
            }
        }
        if !table.is_empty() {
            table.set_implicit(true);
            out.insert("hosts", Item::Table(table));
        }
    }
    if let Some(groups) = doc.get("groups") {
        if groups.as_table_like().is_some_and(|t| !t.is_empty()) {
            out.insert("groups", groups.clone());
        }
    }
    out
}

/// 위임 표에서 호스트 `[[target]]` · DB `[[database]]` 만(오케스트레이션 `[[repo]]` 는 이 PC 의 저장소에 묶여 뺀다).
fn delegation_subset(doc: &DocumentMut) -> DocumentMut {
    let mut out = DocumentMut::new();
    for key in ["target", "database"] {
        if let Some(item) = doc.get(key) {
            if item.is_array_of_tables() {
                out.insert(key, item.clone());
            }
        }
    }
    out
}

fn push(out: &mut Vec<Entry>, name: impl Into<String>, bytes: Vec<u8>) {
    out.push(Entry { name: name.into(), bytes });
}

/// 고른 범주의 묶음 항목들(manifest 제외).
pub(crate) fn collect(roots: &Roots, categories: &[&str]) -> Result<Vec<Entry>, String> {
    let has = |c: &str| categories.contains(&c);
    let mut out = Vec::new();

    if has("hosts") {
        if let Some(config) = read_text_opt(&roots.ssh.join("config"))? {
            let blocks = crate::config_edit::concrete_host_blocks(&config);
            if !blocks.is_empty() {
                let names: Vec<String> = blocks.iter().flat_map(|b| b.names.clone()).collect();
                let text: Vec<&str> = blocks.iter().map(|b| b.text.as_str()).collect();
                push(&mut out, catalog::SSH_HOSTS, text.join("\n").into_bytes());
                if let Some(meta) = read_text_opt(&roots.ssh.join("sessions.toml"))?.as_deref().and_then(parse_toml) {
                    let subset = sessions_subset(&meta, &names);
                    if !subset.is_empty() {
                        push(&mut out, catalog::SSH_META, subset.to_string().into_bytes());
                    }
                }
            }
        }
    }

    if has("ai") {
        if let Some(doc) = read_text_opt(&roots.home.join("delegation.toml"))?.as_deref().and_then(parse_toml) {
            let subset = delegation_subset(&doc);
            if !subset.is_empty() {
                push(&mut out, catalog::DELEGATION, subset.to_string().into_bytes());
            }
        }
    }

    if let Some(doc) = read_text_opt(&roots.config.join("settings.toml"))?.as_deref().and_then(parse_toml) {
        let subset = settings_subset(&doc, &has);
        if !subset.is_empty() {
            push(&mut out, catalog::SETTINGS, subset.to_string().into_bytes());
        }
    }

    for (name, cat) in catalog::config_files() {
        if has(cat) {
            if let Some(bytes) = read_opt(&roots.config.join(name))? {
                push(&mut out, format!("config/{name}"), bytes);
            }
        }
    }

    if has("appearance") {
        for name in file_names(&roots.config) {
            if crate::wallpaper::is_managed_name(&name) {
                if let Some(bytes) = read_opt(&roots.config.join(&name))? {
                    push(&mut out, format!("config/{name}"), bytes);
                }
            }
        }
        let icons = roots.config.join("app-icons");
        for name in file_names(&icons) {
            let rel = format!("config/app-icons/{name}");
            if name != "current.ico" && catalog::category_of(&rel) == Some("appearance") {
                if let Some(bytes) = read_opt(&icons.join(&name))? {
                    push(&mut out, rel, bytes);
                }
            }
        }
        let themes = roots.config.join("terminal-themes");
        for name in file_names(&themes) {
            let rel = format!("config/terminal-themes/{name}");
            if catalog::category_of(&rel) == Some("appearance") {
                if let Some(bytes) = read_opt(&themes.join(&name))? {
                    push(&mut out, rel, bytes);
                }
            }
        }
    }

    if has("instructions") {
        let dir = roots.config.join("instructions");
        for name in file_names(&dir) {
            if catalog::is_instruction_name(&name) {
                if let Some(bytes) = read_opt(&dir.join(&name))? {
                    push(&mut out, format!("config/instructions/{name}"), bytes);
                }
            }
        }
    }

    Ok(out)
}
