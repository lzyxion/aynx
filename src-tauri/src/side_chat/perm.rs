//! **사이드 채팅의 권한 모드 · 허용 목록**(2026-11-20 — 권한 모드 목업 · 사용자 확정).
//!
//! - **모드** 둘: `Manual`(기본 — 카드로 묻는다) · `Auto`(그 채팅의 권한 요청에 세션 서버가 허용으로 답한다 — 카드 없음).
//! - **허용 목록**: Manual 에서 사람이 [이 채팅에서 허용] 을 누른 카드의 **종류**(서버가 그 기다리는 요청에서 읽는다 — 프런트가 보낸 글자를
//!   믿지 않는다). 그 뒤 같은 종류는 서버가 허용으로 답한다. 종류 열쇠는 넷: [`OUTSIDE_READ`](Claude 의 채팅 폴더 밖 읽기 — `PermKind::Tool`) ·
//!   [`FILE_CHANGE`] · [`COMMAND`](Codex 의 샌드박스 밖 명령) · `mcp:<서버>`(외부 MCP 서버 하나 — 서버 이름 단위).
//! - 대신 답하는 것은 **지금 카드가 되는 네 종류뿐**이다 — 대화형 도구 · 그 밖 서버 요청은 어댑터가 카드 없이 거절하므로(`claude::INTERACTIVE` ·
//!   `codex` 의 `on_server_request`) 여기까지 오지 않는다. CLI 쪽 제한(Claude `--tools` 다섯 · Codex `read-only` + `on-request`)은 그대로 —
//!   Auto 는 "서버가 승인 요청에 대신 답하기" 일 뿐이다.
//! - **바꾸는 길은 사람의 op 뿐**(`side_chat_set_perm_mode` · `side_chat_forget_allow` · `side_chat_decide{remember}` — Tauri 명령 → 세션
//!   서버 · 원격 창은 `remote/deny.rs` 의 문). MCP · 채팅 토큰 · AI 글에는 길이 없다.
//!
//! ## 저장(채팅마다 — 세션이 아니라 채팅 단위 · 사용자 확정)
//!
//! `<데이터 루트>/sidechat/.perm/<채팅 id>.json` = `{"mode": "manual"|"auto", "allow": [열쇠…]}` · 마지막으로 고른 모드 =
//! `.perm/_last.json` = `{"mode"}`(`_` 는 채팅 id 에 없는 글자 — 겹치지 않는다). **채팅 폴더(CLI 의 cwd) 밖**에 둔다 — cwd 안이면
//! 그 채팅의 CLI 가 읽기 도구로 바로 보고, 파일 바꾸기를 허용한 Codex 가 제 모드를 고칠 수 있는 자리가 된다. 읽기는 세션 서버가 채팅을
//! **열 때**(표에 새로 세울 때)만 한다. 채팅을 지우면 그 파일도 지운다(`store::remove_chat_dir`).
//!
//! **새 채팅 · 옛 채팅**: 파일이 없는 채팅은 새 채팅 — 마지막으로 고른 모드로 열고 곧바로 파일을 쓴다. 옛 기록(이 판 전의 채팅)은 Manual 로
//! 읽어야 하므로 `.perm/` 폴더가 처음 설 때 그 순간 있던 채팅 폴더마다 Manual 파일을 한 번 써 둔다([`load_or_init`]). 값은 비밀이 아니다
//! (토큰 · 경로 없음).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::event::PermKind;

/// 저장 폴더 이름(`<sidechat>/.perm/` — `.` 이 든 이름이라 채팅 id 와 겹치지 않는다 · `.run` 과 같은 결).
pub(crate) const DIR: &str = ".perm";
/// 마지막으로 고른 모드의 파일 이름.
const LAST: &str = "_last.json";
/// 허용 목록 상한(종류는 넷이지만 MCP 서버마다 하나라 넉넉히).
pub(crate) const ALLOW_MAX: usize = 64;

/// Claude 의 채팅 폴더 밖 읽기(`PermKind::Tool` — 도구는 읽기 셋 · 웹 둘뿐이고 웹 · cwd 안 읽기는 미리 허용).
pub(crate) const OUTSIDE_READ: &str = "outsideRead";
/// Codex 의 파일 바꾸기.
pub(crate) const FILE_CHANGE: &str = "fileChange";
/// Codex 의 샌드박스 밖 명령.
pub(crate) const COMMAND: &str = "command";
/// 외부 MCP 서버 하나의 머리.
pub(crate) const MCP_PREFIX: &str = "mcp:";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PermMode {
    /// 카드로 묻는다(기본 · 옛 기록).
    #[default]
    Manual,
    /// 그 채팅의 권한 요청에 서버가 허용으로 답한다.
    Auto,
}

/// 채팅 하나의 모드 · 허용 목록(저장 모양 그대로).
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

/// 종류 열쇠로 받는 모양인가 — 넷 중 하나(MCP 는 서버 이름이 `mcp_name` 글자 · 64자). **순수**.
pub(crate) fn key_ok(k: &str) -> bool {
    match k.strip_prefix(MCP_PREFIX) {
        Some(n) => !n.is_empty() && n.len() <= 64 && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
        None => matches!(k, OUTSIDE_READ | FILE_CHANGE | COMMAND),
    }
}

/// **기다리는 요청의 종류 열쇠** — 서버가 그 요청(`Ev::Permission` 의 칸)에서 읽는다. MCP 는 도구 이름 `mcp__<서버>__<도구>` 에서 서버를 —
/// 실린 서버 이름(`servers` — `Ev::McpServers`)에 맞는 가장 긴 머리, 없으면 첫 `__` 에서 가른다. 모양이 틀리면 `None`(기억하지 않는다). **순수**.
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

/// **서버가 대신 답할까** — Auto 면 `Auto`, Manual 이고 그 종류가 허용 목록에 있으면 `Remembered`, 아니면 `None`(카드). **순수**.
pub(crate) fn answer_by(p: &ChatPerm, key: Option<&str>) -> Option<super::event::ResolvedBy> {
    use super::event::ResolvedBy;
    match p.mode {
        PermMode::Auto => Some(ResolvedBy::Auto),
        PermMode::Manual => key.filter(|k| p.allow.iter().any(|a| a == k)).map(|_| ResolvedBy::Remembered),
    }
}

/// 허용 목록에 더한다(이미 있으면 그대로 · 상한이면 더하지 않는다) — 바뀌었나. **순수**.
pub(crate) fn remember(p: &mut ChatPerm, key: &str) -> bool {
    if !key_ok(key) || p.allow.iter().any(|a| a == key) || p.allow.len() >= ALLOW_MAX {
        return false;
    }
    p.allow.push(key.to_string());
    true
}

/// 허용 목록에서 뺀다 — 바뀌었나. **순수**.
pub(crate) fn forget(p: &mut ChatPerm, key: &str) -> bool {
    let before = p.allow.len();
    p.allow.retain(|a| a != key);
    p.allow.len() != before
}

/// 읽은 저장 글 → 모양(틀린 열쇠 · 겹친 열쇠는 버린다 · JSON 이 아니면 기본 = Manual). **순수**.
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

/// 마지막으로 고른 모드(없으면 Manual).
fn last_mode(root: &Path) -> PermMode {
    crate::app_state::load_at(&root.join(DIR).join(LAST))
        .ok()
        .flatten()
        .and_then(|t| serde_json::from_str::<Last>(&t).ok())
        .map(|l| l.mode)
        .unwrap_or_default()
}

/// 옛 채팅을 Manual 로 — `.perm/` 이 처음 설 때 한 번(머리말 "새 채팅 · 옛 채팅"). 그 순간 있던 채팅 폴더(`id_ok` 이름의 폴더)마다.
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

/// **그 채팅의 모드 · 허용 목록** — 파일이 있으면 그것, 없으면 새 채팅(마지막 모드로 세우고 곧바로 쓴다). `.perm/` 이 아직 없으면 먼저 옛 채팅을
/// Manual 로 씨앗한다. 블로킹(파일) — 표 · 채팅 잠금 앞에서 부른다. `root` = `<데이터 루트>/sidechat`.
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

/// 그 채팅의 모양을 쓴다(원자적 — `app_state::save_at`).
pub(crate) fn save(root: &Path, id: &str, p: &ChatPerm) -> Result<(), String> {
    let f = chat_file(root, id).ok_or_else(|| "invalid side chat id".to_string())?;
    let body = serde_json::to_string(p).map_err(|e| e.to_string())?;
    crate::app_state::save_at(&f, &body).map(|_| ())
}

/// 사람이 고른 모드를 "마지막 모드" 로 쓴다(새 채팅이 이어받는다).
pub(crate) fn save_last(root: &Path, mode: PermMode) -> Result<(), String> {
    let body = serde_json::to_string(&Last { mode }).map_err(|e| e.to_string())?;
    crate::app_state::save_at(&root.join(DIR).join(LAST), &body).map(|_| ())
}

/// 채팅 지우기 — 그 채팅의 파일 하나(없으면 그대로).
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

    /// 종류 열쇠 — 서버가 요청에서 읽는다 · MCP 는 실린 서버 이름의 가장 긴 머리.
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

    /// Auto = 다 · Manual = 허용 목록의 종류만 · 지우면 다시 묻는다. 목록은 Auto 로 갔다 와도 남는다.
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

    /// 저장 — 새 채팅은 마지막 모드 · 파일이 있으면 그것 · 옛 채팅(`.perm/` 이 서기 전 폴더)은 Manual · 지우기.
    #[test]
    fn store_new_chat_takes_last_mode_old_chat_is_manual() {
        let root = tmp("store");
        std::fs::create_dir_all(root.join("oldchat")).unwrap();
        std::fs::create_dir_all(root.join(".run")).unwrap();
        // 처음 — 옛 채팅 씨앗 · 새 채팅은 마지막(없음 = Manual)
        assert_eq!(load_or_init(&root, "c1"), ChatPerm::default());
        assert!(root.join(DIR).join("oldchat.json").is_file(), "옛 채팅 씨앗");
        assert!(!root.join(DIR).join(".run.json").exists());
        save_last(&root, PermMode::Auto).unwrap();
        // 옛 채팅 — 마지막이 Auto 여도 Manual
        assert_eq!(load_or_init(&root, "oldchat").mode, PermMode::Manual);
        // 새 채팅 — 마지막 모드
        let fresh = load_or_init(&root, "c2");
        assert_eq!(fresh.mode, PermMode::Auto);
        // 쓴 것을 다시 읽는다(앱을 다시 켜도)
        let mut p = fresh.clone();
        remember(&mut p, "mcp:tavily");
        p.mode = PermMode::Manual;
        save(&root, "c2", &p).unwrap();
        assert_eq!(load_or_init(&root, "c2"), p);
        // 틀린 글 · 겹친 열쇠 · 모르는 열쇠
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
