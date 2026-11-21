//! 지난 대화 지우기 — 그 CLI 의 기록에서 영구히 지운다(보관함 · 휴지통 없음). 로컬 대화만이다 (docs/log/2026-10-24-convo-rename.md "지우기").
//! Claude: 링크를 따라가지 않는다 — 딸린 폴더나 그 안에 링크가 하나라도 있으면 아무것도 지우지 않고 거절한다(정션을 따라 다른 저장소를 지운 사고).
//! 대화 파일을 먼저 지운다 — 도는 CLI 가 쥐고 있으면 여기서 실패해 아무것도 바뀌지 않는다. `file-history/<id>/` 는 남긴다 — 갈라 나간 대화가 옛 체크포인트로 그 백업을 가리킨다.
//! Codex: 파일을 직접 지우지 않고 app-server `thread/delete` 를 부른다. 오류 문구에는 제목을 싣지 않는다 — 경로 · id · OS 문구만.

use serde_json::json;

use super::edit::{self, now_ms, Located};
use crate::agent_state::convo::ConvoLinkRow;
use super::*;

pub(crate) type Delete = fn(&Located) -> Result<(), String>;

pub(crate) fn delete_in(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
    now_ms: i64,
    links: &[ConvoLinkRow],
) -> Result<(), String> {
    let Some(delete) = t.delete else {
        return Err(tr!(
            ko: "{name} 대화는 지울 수 없습니다",
            en: "{name} conversations cannot be deleted",
            name = t.display
        ));
    };
    let at = edit::locate_idle(t, roots, id, now_ms, links)?;
    let out = delete(&at);
    // 일부만 지워졌어도(딸린 폴더 실패) 캐시는 뺀다 — 다음 목록이 있는 그대로를 다시 읽는다.
    let companion = companion_dir(&at);
    edit::forget_cached(t.id, &at.id, &at.path, Some(&companion));
    crate::agent_usage::forget(&at.path, Some(&companion));
    out
}

fn companion_dir(at: &Located) -> PathBuf {
    at.path.with_extension("")
}

// ── 링크를 따라가지 않는 걸음 — OS 를 타는 것은 [`is_link`] 하나다 ──

/// 정션을 포함한 모든 재분석 지점이 링크다. `symlink_metadata` 로 읽은 것이어야 한다.
pub(crate) fn is_link(md: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const REPARSE_POINT: u32 = 0x400;
        md.file_type().is_symlink() || md.file_attributes() & REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        md.file_type().is_symlink()
    }
}

/// 링크 안으로는 들어가지 않는다.
pub(crate) fn find_link(dir: &Path) -> std::io::Result<Option<PathBuf>> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let md = std::fs::symlink_metadata(&d)?;
        if is_link(&md) {
            return Ok(Some(d));
        }
        if !md.is_dir() {
            continue;
        }
        for e in std::fs::read_dir(&d)? {
            stack.push(e?.path());
        }
    }
    Ok(None)
}

/// 링크만 걷는다 — 가리키는 곳은 건드리지 않는다.
fn remove_link(p: &Path) -> std::io::Result<()> {
    std::fs::remove_dir(p).or_else(|_| std::fs::remove_file(p))
}

/// 제 손으로 걷고 링크 안으로 들어가지 않는다(걸음 사이에 생긴 링크는 링크만 걷는다).
/// `std::fs::remove_dir_all` 도 요즘은 링크를 따라가지 않지만(CVE-2022-21658 뒤) 그 약속에 기대지 않는다.
pub(crate) fn remove_tree(dir: &Path) -> std::io::Result<()> {
    let md = std::fs::symlink_metadata(dir)?;
    if is_link(&md) {
        return remove_link(dir);
    }
    if !md.is_dir() {
        return std::fs::remove_file(dir);
    }
    for e in std::fs::read_dir(dir)? {
        remove_tree(&e?.path())?;
    }
    std::fs::remove_dir(dir)
}

// ── Claude ──

pub(crate) fn claude_delete(at: &Located) -> Result<(), String> {
    let companion = companion_dir(at);
    // 색인이 고른 파일은 루트 아래 · 이름이 `<id>.jsonl` 이다 — 딸린 폴더도 같은 프로젝트 폴더 안 `<id>` 하나뿐인지 한 번 더 본다.
    if !companion.starts_with(&at.root) || companion.file_name() != Some(std::ffi::OsStr::new(&at.id)) {
        return Err(tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation"));
    }
    let companion = match std::fs::symlink_metadata(&companion) {
        Ok(md) if is_link(&md) || md.is_dir() => {
            if let Some(link) = find_link(&companion).map_err(|e| folder_err(&companion, e))? {
                return Err(tr!(
                    ko: "대화 폴더 안에 링크가 있어 지우지 않았습니다(아무것도 지우지 않음): {p}",
                    en: "Not deleted — there is a link inside the conversation folder (nothing was removed): {p}",
                    p = link.display()
                ));
            }
            Some(companion)
        }
        // 같은 이름의 **파일**은 이 대화의 것이 아니다 — 두고 간다.
        Ok(_) => None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(folder_err(&companion, e)),
    };
    std::fs::remove_file(&at.path).map_err(|e| {
        tr!(
            ko: "대화 파일을 지우지 못했습니다(아무것도 지우지 않음): {e}",
            en: "Could not delete the conversation file (nothing was removed): {e}"
        )
    })?;
    if let Some(dir) = companion {
        remove_tree(&dir).map_err(|e| {
            tr!(
                ko: "대화는 지웠지만 딸린 폴더 일부가 남았습니다({p}): {e}",
                en: "The conversation was deleted, but part of its folder remains ({p}): {e}",
                p = dir.display()
            )
        })?;
    }
    // 설정 폴더(`projects` 의 부모)의 빈 `session-env/<id>/` — 비어 있지 않거나 링크면 두고 간다(`remove_dir` 은 빈 폴더만 지운다).
    if let Some(env) = at.root.parent().map(|c| c.join("session-env").join(&at.id)) {
        if std::fs::symlink_metadata(&env).is_ok_and(|md| md.is_dir() && !is_link(&md)) {
            let _ = std::fs::remove_dir(&env);
        }
    }
    Ok(())
}

fn folder_err(p: &Path, e: std::io::Error) -> String {
    tr!(
        ko: "대화 폴더를 읽지 못했습니다(아무것도 지우지 않음 — {p}): {e}",
        en: "Could not read the conversation folder (nothing was removed — {p}): {e}",
        p = p.display()
    )
}

// ── Codex ──

/// Codex(0.164)가 갈라 나간 대화가 있는 대화를 거절할 때의 문구.
const CODEX_FORK_REFUSAL: &str = "forked history still references";

pub(crate) fn codex_delete_error(msg: &str) -> String {
    if msg.contains(CODEX_FORK_REFUSAL) {
        tr!(
            ko: "이 대화에서 갈라 나간 대화가 있어 Codex 가 지우지 않습니다 — 갈라 나간 대화를 먼저 지우세요",
            en: "Codex will not delete this conversation while conversations forked from it exist — delete those first"
        )
    } else {
        tr!(ko: "Codex 가 대화를 지우지 못했습니다: {msg}", en: "Codex could not delete the conversation: {msg}")
    }
}

pub(crate) fn codex_delete(at: &Located) -> Result<(), String> {
    codex_rpc::request(&at.root, "thread/delete", json!({"threadId": at.id}))
        .map_err(|f| codex_rpc::fail_text(f, codex_delete_error))?;
    // 답은 `{}` 뿐이다 — 목록이 본 그 파일이 정말 사라졌는지 본다(다른 집을 본 Codex 면 남는다).
    if at.path.exists() {
        return Err(tr!(
            ko: "Codex 가 지웠다고 답했지만 대화 파일이 남았습니다: {p}",
            en: "Codex reported the conversation deleted, but its file remains: {p}",
            p = at.path.display()
        ));
    }
    Ok(())
}

// ── 명령 ──

#[tauri::command]
pub async fn agent_session_delete(agent: String, id: String) -> Result<(), String> {
    let t = target(&agent)?;
    let links = crate::server::proxy::conversation_links_now().await;
    tauri::async_runtime::spawn_blocking(move || delete_in(t, &(t.roots)(), &id, now_ms(), &links))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
