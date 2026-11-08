//! 분석 결과 · 효과 · 줄 표시 타입과 근거 모으기(`Verdict` · `stronger`) — 다른 자식이 모두 이것을 쓴다.

use serde::{Deserialize, Serialize};

/// AI 가 **선언한** 효과 — MCP 인자 `effect`(필수 · 셋 중 하나).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Read,
    Write,
    Delete,
}

impl Effect {
    /// MCP 인자 글자 → 선언. 셋 밖이면 `None`.
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

/// 앱이 **매긴** 효과 — 선언 셋에 "확인 필요"(표 밖 · 해석 못 함)가 더해진다.
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
    /// 선언과 견주는 무게 — 확인 필요는 쓰기와 같다.
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

/// **선언이 분석보다 약한가** — 읽기 < 쓰기 < 삭제, 확인 필요는 적어도 쓰기. 이것이 카드의 "선언과 다름" 이다.
pub(crate) fn mismatch(declared: Effect, computed: Computed) -> bool {
    declared.rank() < computed.rank()
}

/// DB 문장 하나의 분석.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StmtAnalysis {
    /// 첫 낱말(대문자 — 가드의 분류 그대로)
    pub keyword: String,
    /// 대상 테이블(찾았으면 — 적힌 그대로 · 64자까지)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    /// `UPDATE` · `DELETE` 의 바깥 `WHERE` 유무 — 다른 문장은 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub where_clause: Option<bool>,
    pub effect: Computed,
}

/// 칩 줄의 낱말 하나 — 프로그램(또는 그 효과를 낸 꼴 `find -delete` · `sed -i`)이나 구획 밖 근거(`>` · `$()`)와 **그 낱말이 낸 효과**.
/// 화면은 이 효과로 색을 고른다(삭제 = 실패색 · 쓰기 · 확인 필요 = 경고색) — 표시 글자를 다시 해석하지 않는다(결정적).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramToken {
    pub text: String,
    pub effect: Computed,
    /// 구획 밖 근거(`>` · `$()` · `<<` · `?`)인가 — 화면은 프로그램 사슬(`→`)과 따로 잇는다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub special: bool,
}

/// 작업안 하나의 앱 분석 — 작업안을 만들 때 한 번 매겨 [`super::Operation::analysis`] 에 둔다(원문은 바뀌지 않는다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAnalysis {
    pub effect: Computed,
    /// 그 효과를 낸 첫 근거 — 프로그램(`rm` · `find -delete` · `sed -i` · `tee`) · 리다이렉트(`>`) · 치환(`$()`) · 구분 줄 없는 heredoc(`<<`) ·
    /// 해석 못 함(`?`) · DB 면 `DELETE users` 꼴. 읽기면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    /// 셸 명령의 프로그램들(차례대로 — `du → sort → head`)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub programs: Vec<String>,
    /// 칩 줄의 낱말들 — 구획마다 하나(차례대로) + 구획 밖 근거. 낱말마다 그것이 낸 효과([`ProgramToken`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tokens: Vec<ProgramToken>,
    /// `sudo` · `doas` · `su` 를 거치는가
    #[serde(default)]
    pub sudo: bool,
    /// DB 작업안의 문장별 분석
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub statements: Vec<StmtAnalysis>,
    /// 긴 명령을 줄로 나눠 보이기 위한 최상위 구획 — 2줄 이상이거나, 한 줄이라도 읽기가 아니거나 `sudo` 표시가 있으면 그 한 줄(그 밖의
    /// 읽기 한 줄 · 치환 안 heredoc 이면 비움). [`command_lines`] 가 나눈다. DB 작업안은 문장마다 한 줄([`analyze_db`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<CmdLine>,
}

/// 긴 셸 명령의 **한 줄**(최상위 구획 — `;` · `&&` · `||` · `&` · 줄바꿈 사이) — 카드가 명령을 줄로 펼쳐 줄마다 효과를 보인다.
/// 줄의 효과는 그 줄만 따로 분석한 것과 같다(같은 표 · 같은 보수성).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdLine {
    /// 그 줄의 원문(앞뒤 공백만 걷음 — 글자는 그대로)
    pub text: String,
    /// 이 줄 뒤의 구분자: ";" | "&&" | "||" | "&" | "\n" — 마지막 줄은 없음(끝에 `;` · `&` 가 붙어 있었으면 그것)
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
    /// 이 줄 안에서 효과를 낸 낱말들의 자리 — `text` 의 **유니코드 코드 포인트** 색인 [start, end). 차례대로 · 겹치지 않음
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<LineMark>,
    /// 선언과 무관하게 위험한 줄 — DB 의 바깥 `WHERE` 없는 `UPDATE` · `DELETE`(테이블 전체) · `DROP` · `TRUNCATE`. 화면은 이 줄을
    /// 효과와 무관하게 실패색으로 그린다(`over` 는 "선언보다 셈" 그대로 — 뜻을 섞지 않는다).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub danger: bool,
}

/// 줄 안의 효과 낱말 하나(프로그램 `rm` · 효과를 낸 인자 `-delete` · 연산자 `>` · `$(`) — 화면은 이 자리를 효과 색으로 칠할 뿐 다시
/// 해석하지 않는다. 색인은 코드 포인트라 프런트의 `Array.from(text)` 와 같은 자리다(한글 · 이모지가 앞에 있어도).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMark {
    pub start: usize,
    pub end: usize,
    pub effect: Computed,
    /// 표시의 갈래 — 없으면 효과 낱말, `"sudo"` 면 권한 올리기 낱말(`sudo` · `doas` · `pkexec` · `su` — 따옴표 없이 적힌 것만). 화면은
    /// `sudo` 를 효과와 무관하게 경고색으로 칠하고, 그 표시만 있는 읽기 줄은 줄 판 · 띠 · 표지 없이 둔다(낱말만 색).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// 근거 하나 — 모을 때 쓴다.
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

/// 더 센 쪽을 남긴다(같으면 먼저 것 — 첫 근거).
pub(super) fn stronger(a: Verdict, b: Verdict) -> Verdict {
    if b.effect.order() > a.effect.order() {
        b
    } else {
        a
    }
}
