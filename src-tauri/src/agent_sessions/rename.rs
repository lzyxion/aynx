//! 지난 대화 이름 바꾸기 — 그 CLI 의 기록에 적어 CLI 의 `/resume` 목록과 Aynx 목록이 같은 이름을 본다. 로컬 대화만이다 (docs/log/2026-10-24-convo-rename.md).
//! Claude: 대화 파일 끝에 `/rename` 이 쓰는 `custom-title` 줄을 덧붙이고, 수정 시각은 덧붙이기 전 값으로 되돌린다 — 목록 맨 위로 뛰거나 "밖에서 열림" 으로 보이지 않게.
//! Codex: 이름이 `session_index.jsonl` 과 `state_5.sqlite` 두 곳에 있어 직접 고치지 않고 app-server `thread/name/set` 을 부른다.
//! 이름은 사용자 글자다 — 오류 문구 · 로그 · `Debug` 에 싣지 않는다.

use std::io::Write;

use serde_json::json;

use super::edit::{self, now_ms};
use crate::agent_state::convo::ConvoLinkRow;
use super::*;

pub(crate) struct RenameAt<'a> {
    pub path: &'a Path,
    pub root: &'a Path,
    pub id: &'a str,
    pub name: &'a str,
}

pub(crate) type Rename = fn(&RenameAt<'_>) -> Result<(), String>;

/// 너무 길면 자르지 않고 거절한다 — 사람이 고른 글자를 몰래 바꾸지 않는다.
pub(crate) fn clean_name(raw: &str) -> Result<String, String> {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.is_empty() {
        return Err(tr!(ko: "이름이 비었습니다", en: "The name is empty"));
    }
    if joined.chars().any(char::is_control) {
        return Err(tr!(
            ko: "이름에 쓸 수 없는 글자가 있습니다",
            en: "The name contains characters that cannot be used"
        ));
    }
    if joined.chars().count() > TITLE_MAX_CHARS {
        return Err(tr!(
            ko: "이름은 {n}자까지입니다",
            en: "The name can be at most {n} characters",
            n = TITLE_MAX_CHARS
        ));
    }
    Ok(joined)
}

pub(crate) fn rename_in(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
    raw_name: &str,
    now_ms: i64,
    links: &[ConvoLinkRow],
) -> Result<(), String> {
    let Some(rename) = t.rename else {
        return Err(tr!(
            ko: "{name} 대화는 이름을 바꿀 수 없습니다",
            en: "{name} conversations cannot be renamed",
            name = t.display
        ));
    };
    let name = clean_name(raw_name)?;
    let at = edit::locate_idle(t, roots, id, now_ms, links)?;
    rename(&RenameAt {
        path: &at.path,
        root: &at.root,
        id: &at.id,
        name: &name,
    })
}

// ── Claude ──

/// `/rename` 과 같은 줄 하나(줄바꿈 포함).
fn claude_title_line(id: &str, name: &str) -> String {
    let mut s = json!({"type": "custom-title", "customTitle": name, "sessionId": id}).to_string();
    s.push('\n');
    s
}

/// 쓰기 한 번으로 덧붙인다 — 끝이 쓰다 만 줄이면 줄바꿈을 먼저 붙여 섞이지 않게.
fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().read(true).append(true).open(path)?;
    let md = f.metadata()?;
    let before = md.modified().ok();
    let mut buf = Vec::with_capacity(line.len() + 1);
    if md.len() > 0 {
        let mut last = [0u8; 1];
        f.seek(SeekFrom::End(-1))?;
        f.read_exact(&mut last)?;
        if last[0] != b'\n' {
            buf.push(b'\n');
        }
    }
    buf.extend_from_slice(line.as_bytes());
    f.write_all(&buf)?;
    f.flush()?;
    if let Some(t) = before {
        // 되돌리기에 실패해도 이름은 이미 적혔다 — 목록 순서만 바뀐다.
        let _ = f.set_modified(t);
    }
    Ok(())
}

pub(crate) fn claude_rename(at: &RenameAt<'_>) -> Result<(), String> {
    append_line(at.path, &claude_title_line(at.id, at.name)).map_err(|e| {
        tr!(
            ko: "대화 파일에 쓰지 못했습니다: {e}",
            en: "Could not write to the conversation file: {e}"
        )
    })
}

// ── Codex ──

pub(crate) fn codex_rename(at: &RenameAt<'_>) -> Result<(), String> {
    codex_rpc::request(at.root, "thread/name/set", json!({"threadId": at.id, "name": at.name}))
        .map(|_| ())
        .map_err(|f| {
            codex_rpc::fail_text(f, |msg| {
                tr!(
                    ko: "Codex 가 이름을 바꾸지 못했습니다: {msg}",
                    en: "Codex could not rename the conversation: {msg}"
                )
            })
        })
}

// ── 명령 ──

#[tauri::command]
pub async fn agent_session_rename(agent: String, id: String, name: String) -> Result<(), String> {
    let t = target(&agent)?;
    let links = crate::server::proxy::conversation_links_now().await;
    tauri::async_runtime::spawn_blocking(move || rename_in(t, &(t.roots)(), &id, &name, now_ms(), &links))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
