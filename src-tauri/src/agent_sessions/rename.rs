//! **지난 대화 이름 바꾸기** — 사람이 지난 대화 줄에서 고친 이름을 **그 CLI 의 기록에** 적는다(CLI 의 `/resume` 목록 ·
//! Aynx 목록이 같은 이름을 본다 — docs/log/2026-10-24-convo-rename.md). 로컬 대화만이다(원격 대화에는 단추가 없다).
//!
//! 공용(이 파일의 [`rename_in`])과 에이전트마다 다른 것([`SessionTarget::rename`] 한 칸)으로 갈린다:
//!
//! - **공용** — 이름 다듬기([`clean_name`]) → 지우기와 같은 문 [`edit::locate_idle`](id 모양 · 목록과 같은 색인 — 화면이 넘긴 경로는
//!   받지 않는다 · **방금 쓰인 대화는 거절** — 화면의 "밖에서 열림" 과 같은 2분 창) → 어댑터.
//! - **Claude** ([`claude_rename`]) — 대화 파일 끝에 `/rename` 이 쓰는 줄 하나(`{"type":"custom-title","customTitle":…,"sessionId":…}` —
//!   10-24 이 PC 실측)를 덧붙인다. 목록은 꼬리의 `custom-title` 을 읽으므로 다음 목록에 곧 보인다(캐시 열쇠의 크기가 바뀐다).
//!   파일의 수정 시각은 **덧붙이기 전 값으로 되돌린다** — 이름만 바꾼 대화가 목록 맨 위로 뛰거나 "밖에서 열림" 으로 보이지 않게.
//! - **Codex** ([`codex_rename`]) — 파일을 직접 고치지 않는다. Codex 는 이름을 `$CODEX_HOME/session_index.jsonl` 과
//!   `state_5.sqlite` 의 `threads.name` **두 곳**에 두어(10-24 실측) 한쪽만 고치면 어긋난다. 그래서 공식 app-server RPC
//!   `thread/name/set`(codex-cli 0.163 스키마 · 0.164 실측)을 부른다 — GUI 가 잠깐 띄운 `codex app-server` 의 요청 하나
//!   ([`codex_rpc`] — 지우기와 같은 클라이언트). 목록은 `session_index.jsonl` 을 목록마다 다시 읽는다(`codex_custom_titles`).
//!
//! 이름은 사용자 글자다 — 오류 문구 · 로그 · `Debug` 에 싣지 않는다(모듈 머리말 "개인정보"). Codex 의 RPC 오류 문구는 Codex 가 지은
//! 것이라(이름을 담지 않는다 — "no rollout found for thread id …") 그대로 붙인다.

use std::io::Write;

use serde_json::json;

use super::edit::{self, now_ms};
use crate::agent_state::convo::ConvoLinkRow;
use super::*;

/// 어댑터가 받는 것 — 공용 판정을 지난 값만.
pub(crate) struct RenameAt<'a> {
    /// 색인이 고른 그 대화의 파일(그 에이전트의 루트 아래).
    pub path: &'a Path,
    /// 그 파일이 든 루트(Claude `…/projects` · Codex `<CODEX_HOME>/sessions`).
    pub root: &'a Path,
    /// 소문자로 편 대화 id.
    pub id: &'a str,
    /// 다듬은 이름([`clean_name`]).
    pub name: &'a str,
}

/// 에이전트의 이름 바꾸기 — [`SessionTarget::rename`].
pub(crate) type Rename = fn(&RenameAt<'_>) -> Result<(), String>;

/// 받은 이름 → 적을 이름: 공백류(줄바꿈 포함)를 한 칸으로 접고 앞뒤를 뗀다([`one_line`] 과 같은 규칙). 비었거나 제어 문자가 있거나
/// [`TITLE_MAX_CHARS`] 를 넘으면 거절한다(자르지 않는다 — 사람이 고른 글자를 몰래 바꾸지 않는다).
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

/// 이름 바꾸기의 몸통 — 루트와 지금 시각을 받는다(시험이 임시 폴더 · 시각을 넘긴다). 앱은 [`agent_session_rename`].
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

// ---------------------------------------------------------------------------
// Claude — 대화 파일에 `custom-title` 한 줄
// ---------------------------------------------------------------------------

/// `/rename` 과 같은 줄 하나(줄바꿈 포함).
fn claude_title_line(id: &str, name: &str) -> String {
    let mut s = json!({"type": "custom-title", "customTitle": name, "sessionId": id}).to_string();
    s.push('\n');
    s
}

/// 파일 끝에 `line` 을 **쓰기 한 번**으로 덧붙인다 — 끝이 줄바꿈이 아니면(쓰다 만 줄) 앞에 하나를 붙여 그 줄과 섞이지 않게. 수정
/// 시각은 덧붙이기 전 값으로 되돌린다(모듈 머리말).
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

// ---------------------------------------------------------------------------
// Codex — app-server `thread/name/set`
// ---------------------------------------------------------------------------

/// Codex 어댑터 — `thread/name/set {threadId, name}`(답 `{}`). 집은 그 대화를 찾은 루트의 부모([`codex_rpc::request`]).
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

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 지난 대화 이름 바꾸기 — 사람이 목록 줄에서 고친 이름을 그 CLI 의 기록에 적는다. 파일 쓰기 · 프로세스 실행이라 async + 블로킹 풀
/// (docs/conventions.md "Tauri 명령은 기본 async"). 화면은 성공 뒤 목록을 다시 읽는다.
#[tauri::command]
pub async fn agent_session_rename(agent: String, id: String, name: String) -> Result<(), String> {
    let t = target(&agent)?;
    // 열림 판정의 장부 — 세션 서버에서(못 읽으면 빈 장부 = 예전 mtime 규칙)
    let links = crate::server::proxy::conversation_links_now().await;
    tauri::async_runtime::spawn_blocking(move || rename_in(t, &(t.roots)(), &id, &name, now_ms(), &links))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
