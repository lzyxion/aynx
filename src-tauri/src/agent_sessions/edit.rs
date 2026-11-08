//! **지난 대화를 고치는 일의 공용 판정** — 이름 바꾸기([`super::rename`])와 지우기([`super::delete`])가 어댑터를 부르기 전에 지나는 문
//! (docs/log/2026-10-24-convo-rename.md). 로컬 대화만이다(원격 대화에는 단추가 없다).
//!
//! - id 모양([`SessionTarget::id_ok`]) · 파일 찾기 — 목록과 같은 색인([`conversation_file`]). **화면이 넘긴 경로는 받지 않는다**:
//!   돌려주는 경로는 언제나 그 에이전트의 루트 아래이고, 파싱해 같은 id 로 확인된 파일이다.
//! - **열린 대화 · 방금 쓰인 대화는 거절** — 세션 서버의 대화 ↔ 스트림 장부(`crate::agent_state::convo`)와 같은 규칙([`convo::busy`]):
//!   AYNX 의 산 스트림(어느 창이든)에 연결돼 있으면 거절, 아니면 [`convo::OPEN_ELSEWHERE_WINDOW_MS`](2분 — 화면의 "밖에서 열림" 과 같은 창) 안에 쓰였고 놓인 뒤
//!   유예보다 늦게 쓰였을 때 거절. 타일을 막 닫은 대화는 곧바로 고칠 수 있다(예전에는 2분을 기다렸다). 장부를 못 읽으면(서버에 닿지 못함 ·
//!   옛 서버) 예전 mtime 규칙 그대로. 도는 CLI 는 같은 파일에 덧붙이므로 그 사이에 끼어 고치지 않는다 · 화면이 이미 단추를 흐리지만
//!   목록이 낡았을 수 있어 여기서 한 번 더 본다.

use std::time::SystemTime;

use super::*;
use crate::agent_state::convo::{self, Busy, ConvoLinkRow};

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 공용 판정을 지난 대화 하나 — 어댑터가 받는 것.
pub(crate) struct Located {
    /// 색인이 고른 그 대화의 파일(그 에이전트의 루트 아래).
    pub path: PathBuf,
    /// 그 파일이 든 루트(Claude `…/projects` · Codex `<CODEX_HOME>/sessions`).
    pub root: PathBuf,
    /// 소문자로 편 대화 id.
    pub id: String,
}

fn not_found() -> String {
    tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation")
}

/// 고칠 대화를 찾는다 — id 모양 → 색인 → 루트 → 열려 있나 · 방금 쓰였나(`links` = 세션 서버의 장부 — 비었으면 기록 없음). 시각은
/// 받은 값으로 잰다(시험이 넘긴다).
pub(crate) fn locate_idle(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
    now_ms: i64,
    links: &[ConvoLinkRow],
) -> Result<Located, String> {
    let path = conversation_file(t, roots, id)?;
    let root = roots.iter().find(|r| path.starts_with(r)).ok_or_else(not_found)?.clone();
    let f = stamp(path.clone()).ok_or_else(not_found)?;
    match convo::busy(convo::row_of(links, t.id, id), f.mtime_ms, now_ms) {
        Some(Busy::Linked) => {
            return Err(tr!(
                ko: "이 대화는 AYNX 타일에 열려 있습니다 — 그 타일의 CLI 를 끝내거나 타일을 닫은 뒤 다시 해 보세요",
                en: "This conversation is open in an AYNX tile — quit the CLI there or close the tile, then try again"
            ))
        }
        Some(Busy::RecentWrite) => {
            return Err(tr!(
                ko: "이 대화는 방금 쓰였습니다 — 다른 곳에서 열려 있을 수 있습니다. 2분 뒤에 다시 해 보세요",
                en: "This conversation was just written to — it may be open elsewhere. Try again in 2 minutes"
            ))
        }
        None => {}
    }
    Ok(Located {
        path,
        root,
        id: id.to_ascii_lowercase(),
    })
}

/// 지운 대화를 목록 캐시에서 뺀다 — 낡은 항목이 남아도 목록은 있는 파일만 보지만([`candidates`] · [`cached_hit`] 의 `is_file`),
/// 메모리에 묵히지 않는다. 그 파일 · `under` 아래(그 폴더 자신 포함) · 같은 에이전트의 같은 id 로 읽힌 항목(같은 Codex 대화가 롤아웃 둘에
/// 적힐 수 있다)을 뺀다.
pub(crate) fn forget_cached(agent: &str, id: &str, path: &Path, under: Option<&Path>) {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.retain(|p, e| {
        let same_conv = e.agent == agent && e.parsed.as_ref().is_some_and(|x| x.id == id);
        p != path && !same_conv && !under.is_some_and(|u| p.starts_with(u))
    });
}
