//! AI 가 쓴 설명(`summary`) 다듬기 — 제어 · 양방향 글자를 걷고 상한에서 자른다.

// ---------------------------------------------------------------------------
// AI 가 쓴 설명
// ---------------------------------------------------------------------------

/// `summary` 의 상한(글자).
pub(crate) const SUMMARY_MAX_CHARS: usize = 300;

/// AI 가 쓴 설명을 다듬는다 — 제어 글자를 걷고(줄바꿈 · 탭은 빈칸으로) 빈칸 뭉치를 하나로, 앞뒤를 떼고, [`SUMMARY_MAX_CHARS`] 에서
/// 자른다(`…`). 남는 것이 없으면 `None`. 순수.
pub(crate) fn clean_summary(raw: &str) -> Option<String> {
    let spaced: String = raw
        .chars()
        .filter_map(|c| {
            if c.is_whitespace() {
                Some(' ')
            } else if c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}') {
                // 제어 글자 · 폭 없는 글자 · 양방향 제어(화면에서 글자 순서를 뒤집어 다른 명령처럼 보이게 할 수 있다)는 걷는다.
                None
            } else {
                Some(c)
            }
        })
        .collect();
    let flat = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return None;
    }
    if flat.chars().count() <= SUMMARY_MAX_CHARS {
        return Some(flat);
    }
    let mut out: String = flat.chars().take(SUMMARY_MAX_CHARS - 1).collect();
    out.push('…');
    Some(out)
}
