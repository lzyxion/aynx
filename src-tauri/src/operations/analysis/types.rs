//! 분석 결과 · 효과 · 줄 표시 타입과 근거 모으기(`Verdict` · `stronger`).

use serde::{Deserialize, Serialize};

/// AI 가 **선언한** 효과 — MCP 인자 `effect`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Read,
    Write,
    Delete,
}

impl Effect {
    pub(crate) fn parse(s: &str) -> Option<Effect> {
        match s.trim() {
            "read" => Some(Effect::Read),
            "write" => Some(Effect::Write),
            "delete" => Some(Effect::Delete),
            _ => None,
        }
    }

    fn rank(self) -> u8 {
        match self {
            Effect::Read => 0,
            Effect::Write => 1,
            Effect::Delete => 2,
        }
    }
}

/// 앱이 **매긴** 효과 — 선언 셋에 "확인 필요"가 더해진다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Computed {
    Read,
    Write,
    /// 표에 없는 프로그램 · 치환 · 해석 못 한 글 — 선언과 견줄 때는 **적어도 쓰기**다.
    Unknown,
    Delete,
}

impl Computed {
    fn rank(self) -> u8 {
        match self {
            Computed::Read => 0,
            Computed::Write | Computed::Unknown => 1,
            Computed::Delete => 2,
        }
    }

    /// 모을 때의 순서 — 읽기 < 쓰기 < 확인 필요 < 삭제(같은 무게면 "확인 필요" 가 쓰기를 이긴다 — 더 말해 주는 쪽).
    fn order(self) -> u8 {
        match self {
            Computed::Read => 0,
            Computed::Write => 1,
            Computed::Unknown => 2,
            Computed::Delete => 3,
        }
    }
}

/// 선언이 분석보다 약한가 — 카드의 "선언과 다름".
pub(crate) fn mismatch(declared: Effect, computed: Computed) -> bool {
    declared.rank() < computed.rank()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StmtAnalysis {
    /// 대문자 — 가드의 분류 그대로
    pub keyword: String,
    /// 적힌 그대로 · 64자까지
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    /// 다른 문장은 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub where_clause: Option<bool>,
    pub effect: Computed,
}

/// 칩 줄의 낱말 하나와 그 낱말이 낸 효과 — 화면은 이 효과로 색을 고르고 표시 글자를 다시 해석하지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramToken {
    pub text: String,
    pub effect: Computed,
    /// 구획 밖 근거(`>` · `$()` · `<<` · `?`)인가 — 화면은 프로그램 사슬(`→`)과 따로 잇는다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub special: bool,
}

/// 작업안을 만들 때 한 번 매겨 [`super::Operation::analysis`] 에 둔다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAnalysis {
    pub effect: Computed,
    /// 그 효과를 낸 첫 근거 — 읽기면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub programs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tokens: Vec<ProgramToken>,
    #[serde(default)]
    pub sudo: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub statements: Vec<StmtAnalysis>,
    /// 줄로 나눠 보이기 위한 최상위 구획([`command_lines`]) — DB 작업안은 문장마다 한 줄([`analyze_db`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<CmdLine>,
}

/// 긴 셸 명령의 한 줄(최상위 구획) — 줄의 효과는 그 줄만 따로 분석한 것과 같다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdLine {
    /// 앞뒤 공백만 걷음 — 글자는 그대로
    pub text: String,
    /// ";" | "&&" | "||" | "&" | "\n" — 마지막 줄은 없음(끝에 `;` · `&` 가 붙어 있었으면 그것)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sep: Option<String>,
    pub effect: Computed,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    /// echo/printf 만 있는 읽기 줄(구분 제목 노릇) — 화면이 흐리게 그린다
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub quiet: bool,
    /// AI 선언보다 센 줄인가 — `store::declare` 가 선언을 얹을 때 매긴다(분석 시점엔 false)
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub over: bool,
    /// `text` 의 **유니코드 코드 포인트** 색인 [start, end) · 차례대로 · 겹치지 않음
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<LineMark>,
    /// 선언과 무관하게 위험한 줄(DB 의 바깥 `WHERE` 없는 `UPDATE` · `DELETE` · `DROP` · `TRUNCATE`) — `over` 와 뜻을 섞지 않는다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub danger: bool,
}

/// 줄 안의 효과 낱말 하나 — 색인은 코드 포인트라 프런트의 `Array.from(text)` 와 같은 자리다(한글 · 이모지가 앞에 있어도).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMark {
    pub start: usize,
    pub end: usize,
    pub effect: Computed,
    /// 없으면 효과 낱말, `"sudo"` 면 권한 올리기 낱말 — 화면은 `sudo` 를 효과와 무관하게 경고색으로 칠한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct Verdict {
    pub(super) effect: Computed,
    pub(super) cause: Option<String>,
}

impl Verdict {
    pub(super) fn read() -> Verdict {
        Verdict { effect: Computed::Read, cause: None }
    }
    pub(super) fn of(effect: Computed, cause: impl Into<String>) -> Verdict {
        Verdict { effect, cause: Some(cause.into()) }
    }
}

/// 같으면 먼저 것 — 첫 근거.
pub(super) fn stronger(a: Verdict, b: Verdict) -> Verdict {
    if b.effect.order() > a.effect.order() {
        b
    } else {
        a
    }
}
