//! 사이드 채팅의 권한 모드(`Manual` · `Auto`) · 허용 목록 — 순수 판정 + 채팅마다 저장.
//!
//! - 허용 목록의 종류 열쇠는 **서버가 기다리는 요청에서 읽는다** — 프런트가 보낸 글자를 믿지 않는다.
//! - Auto 는 "서버가 승인 요청에 대신 답하기" 일 뿐이다 — 대신 답하는 것은 카드가 되는 네 종류뿐이고(대화형 도구 · 그 밖 서버 요청은
//!   어댑터가 먼저 거절한다), CLI 쪽 제한(Claude `--tools` · Codex `read-only` + `on-request`)은 그대로다.
//! - **바꾸는 길은 사람의 op 뿐**(Tauri 명령 → 세션 서버 · 원격 창은 `remote/deny.rs` 의 문). MCP · 채팅 토큰 · AI 글에는 길이 없다.
//! - 저장은 `<데이터 루트>/sidechat/.perm/` — **채팅 폴더(CLI 의 cwd) 밖**이어야 한다. 안이면 그 CLI 가 읽고, 파일 바꾸기를 허용한
//!   Codex 가 제 모드를 고칠 수 있다.
//! - 옛 채팅(`.perm/` 전의 기록)은 Manual 이어야 한다 — `.perm/` 이 처음 설 때 있던 채팅 폴더마다 Manual 파일을 한 번 써 둔다([`load_or_init`]).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::event::PermKind;

/// `.` 이 든 이름이라 채팅 id 와 겹치지 않는다.
pub(crate) const DIR: &str = ".perm";
/// `_` 는 채팅 id 에 없는 글자 — 겹치지 않는다.
const LAST: &str = "_last.json";
pub(crate) const ALLOW_MAX: usize = 64;

// 열쇠 값은 저장 파일에 글자 그대로 남는다 — 바꾸지 않는다.
/// Claude 의 채팅 폴더 밖 읽기(`PermKind::Tool`).
pub(crate) const OUTSIDE_READ: &str = "outsideRead";
pub(crate) const FILE_CHANGE: &str = "fileChange";
/// Codex 의 샌드박스 밖 명령.
pub(crate) const COMMAND: &str = "command";
pub(crate) const MCP_PREFIX: &str = "mcp:";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PermMode {
    #[default]
    Manual,
    Auto,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ChatPerm {
    #[serde(default)]
    pub mode: PermMode,
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Last {
    #[serde(default)]
    mode: PermMode,
}

pub(crate) fn key_ok(k: &str) -> bool {
    match k.strip_prefix(MCP_PREFIX) {
        Some(n) => !n.is_empty() && n.len() <= 64 && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
        None => matches!(k, OUTSIDE_READ | FILE_CHANGE | COMMAND),
    }
}

/// MCP 는 실린 서버 이름(`servers`)에 맞는 가장 긴 머리로 가른다 — 서버 이름에 `__` 가 들 수 있다.
pub(crate) fn key_of(kind: PermKind, tool_name: &str, servers: &[String]) -> Option<String> {
    let k = match kind {
        PermKind::Tool => OUTSIDE_READ.to_string(),
        PermKind::FileChange => FILE_CHANGE.to_string(),
        PermKind::Command => COMMAND.to_string(),
        PermKind::McpTool => {
            let rest = tool_name.strip_prefix("mcp__")?;
            let known = servers
                .iter()
                .filter(|s| rest.strip_prefix(s.as_str()).is_some_and(|t| t.starts_with("__")))
                .max_by_key(|s| s.len())
                .cloned();
            let server = known.or_else(|| super::event::split_mcp_tool(tool_name, None).map(|(s, _)| s.to_string()))?;
            format!("{MCP_PREFIX}{server}")
        }
    };
    key_ok(&k).then_some(k)
}

pub(crate) fn answer_by(p: &ChatPerm, key: Option<&str>) -> Option<super::event::ResolvedBy> {
    use super::event::ResolvedBy;
    match p.mode {
        PermMode::Auto => Some(ResolvedBy::Auto),
        PermMode::Manual => key.filter(|k| p.allow.iter().any(|a| a == k)).map(|_| ResolvedBy::Remembered),
    }
}

pub(crate) fn remember(p: &mut ChatPerm, key: &str) -> bool {
    if !key_ok(key) || p.allow.iter().any(|a| a == key) || p.allow.len() >= ALLOW_MAX {
        return false;
    }
    p.allow.push(key.to_string());
    true
}

pub(crate) fn forget(p: &mut ChatPerm, key: &str) -> bool {
    let before = p.allow.len();
    p.allow.retain(|a| a != key);
    p.allow.len() != before
}

pub(crate) fn parse(text: &str) -> ChatPerm {
    let mut p: ChatPerm = serde_json::from_str(text).unwrap_or_default();
    let mut seen: Vec<String> = Vec::new();
    for k in std::mem::take(&mut p.allow) {
        if key_ok(&k) && !seen.contains(&k) && seen.len() < ALLOW_MAX {
            seen.push(k);
        }
    }
    p.allow = seen;
    p
}

fn chat_file(root: &Path, id: &str) -> Option<PathBuf> {
    super::store::id_ok(id).then(|| root.join(DIR).join(format!("{id}.json")))
}

fn last_mode(root: &Path) -> PermMode {
    crate::app_state::load_at(&root.join(DIR).join(LAST))
        .ok()
        .flatten()
        .and_then(|t| serde_json::from_str::<Last>(&t).ok())
        .map(|l| l.mode)
        .unwrap_or_default()
}

fn seed_old_chats(root: &Path) {
    let manual = serde_json::to_string(&ChatPerm::default()).unwrap_or_default();
    let Ok(dir) = std::fs::read_dir(root) else { return };
    for e in dir.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !e.file_type().is_ok_and(|t| t.is_dir()) || !super::store::id_ok(&name) {
            continue;
        }
        if let Some(f) = chat_file(root, &name) {
            let _ = crate::app_state::save_at(&f, &manual);
        }
    }
}

/// 블로킹(파일) — 표 · 채팅 잠금 앞에서 부른다.
pub(crate) fn load_or_init(root: &Path, id: &str) -> ChatPerm {
    let Some(f) = chat_file(root, id) else { return ChatPerm::default() };
    if !root.join(DIR).is_dir() {
        seed_old_chats(root);
        let _ = std::fs::create_dir_all(root.join(DIR));
    }
    if let Ok(Some(t)) = crate::app_state::load_at(&f) {
        return parse(&t);
    }
    let p = ChatPerm { mode: last_mode(root), allow: Vec::new() };
    let _ = save(root, id, &p);
    p
}

pub(crate) fn save(root: &Path, id: &str, p: &ChatPerm) -> Result<(), String> {
    let f = chat_file(root, id).ok_or_else(|| "invalid side chat id".to_string())?;
    let body = serde_json::to_string(p).map_err(|e| e.to_string())?;
    crate::app_state::save_at(&f, &body).map(|_| ())
}

pub(crate) fn save_last(root: &Path, mode: PermMode) -> Result<(), String> {
    let body = serde_json::to_string(&Last { mode }).map_err(|e| e.to_string())?;
    crate::app_state::save_at(&root.join(DIR).join(LAST), &body).map(|_| ())
}

pub(crate) fn remove(root: &Path, id: &str) {
    if let Some(f) = chat_file(root, id) {
        let _ = std::fs::remove_file(f);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::side_chat::event::ResolvedBy;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("aynx-perm-{tag}-{}", crate::token::generate_token().unwrap()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn keys_come_from_the_request() {
        let servers = vec!["a".to_string(), "a__b".to_string(), "tavily".to_string()];
        assert_eq!(key_of(PermKind::Tool, "Read", &servers).as_deref(), Some(OUTSIDE_READ));
        assert_eq!(key_of(PermKind::FileChange, "fileChange", &servers).as_deref(), Some(FILE_CHANGE));
        assert_eq!(key_of(PermKind::Command, "commandExecution", &servers).as_deref(), Some(COMMAND));
        assert_eq!(key_of(PermKind::McpTool, "mcp__tavily__search", &servers).as_deref(), Some("mcp:tavily"));
        assert_eq!(key_of(PermKind::McpTool, "mcp__a__b__c", &servers).as_deref(), Some("mcp:a__b"));
        assert_eq!(key_of(PermKind::McpTool, "mcp__other__x", &servers).as_deref(), Some("mcp:other"));
        // Codex 의 도구 이름을 모르는 승인(`mcp__<서버>__`)
        assert_eq!(key_of(PermKind::McpTool, "mcp__tavily__", &servers).as_deref(), Some("mcp:tavily"));
        assert_eq!(key_of(PermKind::McpTool, "search", &servers), None);
        assert!(!key_ok("mcp:") && !key_ok("mcp:a b") && !key_ok("Read") && key_ok("mcp:x-1_y"));
    }

    #[test]
    fn answers_follow_mode_and_allow_list() {
        let mut p = ChatPerm::default();
        assert_eq!(answer_by(&p, Some(COMMAND)), None);
        assert!(remember(&mut p, COMMAND) && !remember(&mut p, COMMAND) && !remember(&mut p, "bogus"));
        assert_eq!(answer_by(&p, Some(COMMAND)), Some(ResolvedBy::Remembered));
        assert_eq!(answer_by(&p, Some(FILE_CHANGE)), None);
        assert_eq!(answer_by(&p, None), None);
        p.mode = PermMode::Auto;
        assert_eq!(answer_by(&p, Some(FILE_CHANGE)), Some(ResolvedBy::Auto));
        assert_eq!(answer_by(&p, None), Some(ResolvedBy::Auto));
        p.mode = PermMode::Manual;
        assert_eq!(p.allow, vec![COMMAND.to_string()]);
        assert!(forget(&mut p, COMMAND) && !forget(&mut p, COMMAND));
        assert_eq!(answer_by(&p, Some(COMMAND)), None);
    }

    #[test]
    fn store_new_chat_takes_last_mode_old_chat_is_manual() {
        let root = tmp("store");
        std::fs::create_dir_all(root.join("oldchat")).unwrap();
        std::fs::create_dir_all(root.join(".run")).unwrap();
        assert_eq!(load_or_init(&root, "c1"), ChatPerm::default());
        assert!(root.join(DIR).join("oldchat.json").is_file(), "옛 채팅 씨앗");
        assert!(!root.join(DIR).join(".run.json").exists());
        save_last(&root, PermMode::Auto).unwrap();
        assert_eq!(load_or_init(&root, "oldchat").mode, PermMode::Manual);
        let fresh = load_or_init(&root, "c2");
        assert_eq!(fresh.mode, PermMode::Auto);
        let mut p = fresh.clone();
        remember(&mut p, "mcp:tavily");
        p.mode = PermMode::Manual;
        save(&root, "c2", &p).unwrap();
        assert_eq!(load_or_init(&root, "c2"), p);
        std::fs::write(root.join(DIR).join("c3.json"), r#"{"mode":"auto","allow":["command","command","x",3]}"#).unwrap();
        assert_eq!(load_or_init(&root, "c3"), ChatPerm::default(), "모양이 틀린 칸이 있으면 기본(Manual)");
        std::fs::write(root.join(DIR).join("c4.json"), r#"{"mode":"auto","allow":["command","command","x"]}"#).unwrap();
        assert_eq!(load_or_init(&root, "c4"), ChatPerm { mode: PermMode::Auto, allow: vec![COMMAND.into()] });
        std::fs::write(root.join(DIR).join("c5.json"), r#"{}"#).unwrap();
        assert_eq!(load_or_init(&root, "c5"), ChatPerm::default(), "칸 없음 = Manual");
        remove(&root, "c2");
        assert!(!root.join(DIR).join("c2.json").exists());
        assert_eq!(load_or_init(&root, "../x"), ChatPerm::default());
        std::fs::remove_dir_all(root).unwrap();
    }
}
