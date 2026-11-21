//! 지난 대화를 고치는 일(이름 바꾸기 · 지우기)의 공용 판정.
//! 화면이 넘긴 경로는 받지 않는다 — 돌려주는 경로는 언제나 그 에이전트의 루트 아래이고, 파싱해 같은 id 로 확인된 파일이다.
//! 열린 대화 · 방금 쓰인 대화는 거절한다(세션 서버 장부 `convo::busy` 와 같은 규칙 · 장부를 못 읽으면 mtime 규칙) — 도는 CLI 가 같은 파일에 덧붙인다.
//! 화면이 이미 단추를 흐리지만 목록이 낡았을 수 있어 여기서 한 번 더 본다.

use std::time::SystemTime;

use super::*;
use crate::agent_state::convo::{self, Busy, ConvoLinkRow};

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) struct Located {
    pub path: PathBuf,
    pub root: PathBuf,
    pub id: String,
}

fn not_found() -> String {
    tr!(ko: "그 대화를 찾지 못했습니다", en: "Could not find that conversation")
}

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
                ko: "이 대화는 Aynx 타일에 열려 있습니다 — 그 타일의 CLI 를 끝내거나 타일을 닫은 뒤 다시 해 보세요",
                en: "This conversation is open in an Aynx tile — quit the CLI there or close the tile, then try again"
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

/// 같은 id 로 읽힌 항목도 뺀다 — 같은 Codex 대화가 롤아웃 둘에 적힐 수 있다.
pub(crate) fn forget_cached(agent: &str, id: &str, path: &Path, under: Option<&Path>) {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.retain(|p, e| {
        let same_conv = e.agent == agent && e.parsed.as_ref().is_some_and(|x| x.id == id);
        p != path && !same_conv && !under.is_some_and(|u| p.starts_with(u))
    });
}
