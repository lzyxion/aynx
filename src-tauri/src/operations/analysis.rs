//! **승인 요약의 앱 분석**(docs/log/2026-10-21-approval-summary.md) — 작업안 원문(셸 명령 · DB 문장)만 보고 **결정적으로** 매기는
//! 효과(읽기 · 쓰기 · 삭제 · 확인 필요)와 그 근거. AI 가 적은 글(`summary` · 선언 `effect`)은 **한 글자도 보지 않는다** — 그래서 둘을
//! 견줄 수 있다([`mismatch`]: 선언이 분석보다 약하면 검토 카드가 테두리를 실패색으로 물들이고 [승인]을 두 번 받는다).
//!
//! ## 불변
//!
//! - **순수**다 — 문자열을 읽을 뿐 셸 · 세션 · 저장소에 닿지 않는다. 실행을 막는 경계도 아니다(경계는 사람의 승인 · 게이트).
//! - **보수적**이다 — 표에 없는 프로그램은 "읽기" 가 아니라 [`Computed::Unknown`](확인 필요 — 비교에서는 쓰기와 같은 무게)이고,
//!   치환(`$(…)` · 백틱) · 해석 못 한 따옴표 · 구분 줄 없는 heredoc 도 그렇다(heredoc 본문은 데이터 — 받는 프로그램이 정한다 ·
//!   따옴표 없는 구분 낱말의 본문에 치환이 있으면 확인 필요). 오탐(괜히 붉음)이 미탐(삭제를 읽기로)보다 낫다.
//! - 표는 **작고 명시적**이다(아래 `READ` · `WRITE` · `DELETE` 와 갈래 몇 개). 늘릴 때는 시험을 함께 늘린다.
//!
//! ## 분해 — 자동 승인 분해기와 따로인 이유
//!
//! 자동 승인의 구획 분해(`policy::split_segments`)는 파이프 · 리다이렉트 · 치환을 **거절**하도록 만든 것이라(그 자체가 판정이다)
//! `du | sort | head` 같은 흔한 읽기 명령을 나누지 못한다. 여기는 거절하지 않고 **끝까지 나눠 본다** — 파이프 · `&&` · `||` · `;` ·
//! `&` · 줄바꿈 · `(` `)` 에서 나누고, 리다이렉트(`>` · `>>` — `/dev/null` · `2>&1` 은 제외)는 쓰기로 센다. 자동 승인 거부 사유는
//! 여기서 다시 만들지 않는다 — 카드는 서버가 이미 쥔 사유(`autoRefusals`)를 그대로 칩으로 보인다.
//!
//! DB 문장은 쿼리 타일 가드가 이미 매긴 첫 낱말(`DbPlanStmt::keyword`)을 그대로 쓰고, 여기서는 대상 테이블 이름과
//! `UPDATE` · `DELETE` 의 `WHERE` 유무만 더한다(문자열 · 주석 · 괄호 안은 건너뛴다).
//!
//! ## 자식 모듈 (`analysis/` 폴더 — 이 파일은 선언 · 재수출 진입점)
//!
//! | 파일 | 맡는 것 |
//! |---|---|
//! | `types.rs` | 효과(`Effect` · `Computed`) · 결과(`PlanAnalysis` · `CmdLine` · `LineMark` …) · `mismatch` · 근거 모으기 |
//! | `shell_lex.rs` | 셸 글 쪼개기 — 구획 · 낱말 자리 · 리다이렉트 · 치환 · heredoc |
//! | `shell_effect.rs` | 명령 분류 표 · 감싸개 해석 · 구획 판정 · 한 명령의 분석(`analyze_flat`) |
//! | `command_lines.rs` | 줄 나누기 — 최상위 구획 훑개 · 줄별 효과 · 줄 안 효과 낱말 자리 |
//! | `command.rs` | `analyze_command` · `analyze_plan` 조립 |
//! | `sql.rs` | DB 문장 분석 `analyze_db` |
//! | `summary.rs` | `clean_summary` · `SUMMARY_MAX_CHARS` |
//!
//! 의존은 한 방향이다: `types` ← `shell_lex` ← `shell_effect` ← `command_lines` ← `command` · `types` ← `sql` · `summary` 는 홀로.

mod command;
mod command_lines;
mod shell_effect;
mod shell_lex;
mod sql;
mod summary;
mod types;

pub use types::{Computed, Effect, PlanAnalysis};
pub(crate) use command::analyze_plan;
pub(crate) use sql::analyze_db;
pub(crate) use summary::{clean_summary, SUMMARY_MAX_CHARS};
pub(crate) use types::mismatch;

// 시험(`tests.rs` — `use super::*`)만 쓰는 이름.
#[cfg(test)]
use super::DbPlanStmt;
#[cfg(test)]
use command::analyze_command;
#[cfg(test)]
use command_lines::command_lines;
#[cfg(test)]
use types::{CmdLine, LineMark};

#[cfg(test)]
mod tests;
