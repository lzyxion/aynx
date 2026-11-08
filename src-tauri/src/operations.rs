//! 작업안(execution plan) 저장소 **+ 실행 브로커** — 로드맵 **단계 8·9·10**. AI(MCP)가 "여러
//! 호스트에 이 명령을 이렇게 돌리자" 는 **계획을 적어 두고 사용자 검토를 요청**하고, 사용자가
//! **앱에서 승인**하면 그 계획을 SSH exec 로 돌려 대상별 결과를 모으는 자리다.
//!
//! **③-3c 부터 저장소·결과·실행기·만료·감사는 세션 서버 프로세스에 산다**(`approval::OpsPlane` — `crate::server::ai` 가 쥔다).
//! GUI 에는 같은 이름의 Tauri 명령 껍데기만 남고, 승인은 승인 등급 프레임(`ops_approve`)으로 간다 — 그 프레임을 만드는 곳은
//! `approval::approve_operation` 하나다. 실행 환경은 `OpEnv`(내보내기·거울·라우팅 — `AppHandle` 없음). ③-4 부터 **사전 정책 자동
//! 승인의 시계도 서버**다(`auto::sweep` — 서버 안 함수 호출 `approve_in(method: auto)`, 파이프 프레임 아님) — 창이 0개여도 돈다.
//!
//! ## 실행이 있다 — 그러나 AI(MCP)는 실행 경로에 닿지 못한다 (보안 불변 · CLAUDE.md)
//!
//! 단계 8 에는 실행이 없었고 상태도 넷(검토 단계)뿐이었다. 단계 9(실행 브로커)가 실행을 더해
//! 상태는 이제 **열**이다([`OperationState`]): 검토 넷 + `Approved`·`Running` + 종료 넷
//! (`Succeeded`/`Partial`/`Failed`/`Cancelled`). 실행이 생겨도 경계는 그대로다:
//!
//! - **승인·실행은 Tauri 명령([`approve_operation`](approval::approve_operation)·[`cancel_operation`](approval::cancel_operation))뿐, MCP 에 없다** —
//!   AI 는 계획을 **제안**할 뿐(create/request), 승인 버튼은 사람이 앱에서 누른다.
//! - **원시 `send_command`(AI 문자열을 곧장 PTY로) 는 없다** — executor 는 저장된 작업안의
//!   `operation_id` 로 `command`·`targets`·`cwd` 를 읽을 뿐, 승인에 명령 문자열을 다시 받지
//!   않는다(AI 재주입 차단).
//! - **실행은 [`crate::ssh::run_exec`] 의 exec 채널(PTY 미요청)로** 나간다 — 사용자의 대화형
//!   셸을 오염시키지 않고 stdout/stderr·종료 코드만 [`ResultStore`] 로 모은다.
//! - 승인 진입은 [`approval_reject_reason`] 이 게이트하고(caps·자동 승인 정책·cwd 메타문자),
//!   모든 승인·실행·거절·취소는 [`crate::audit`] 로 기록된다(단계 10a). 실행 방식은 값과
//!   무관하게 **항상 순차 canary**([`execute`]·[`canary_proceed`]).
//!
//! ## [`crate::context`] 와의 관계
//!
//! 컨텍스트 저장소가 세션의 **거울**이라면, 이쪽은 그 세션들을 대상으로 한 **계획서 서랍**이다.
//! 둘은 별개의 `Mutex` 다. 두 잠금을 함께 잡을 때의 순서는 **언제나 컨텍스트 먼저, 작업안
//! 나중**이다 (교착 방지 — [`crate::mcp`] 디스패치와 [`crate::context`] 명령이 모두 이 순서).
//!
//! 작업안·결과는 **메모리 전용**이다 — 파일에 쓰지 않는다(보존 한도 [`FINISHED_RETENTION`] 로
//! 오래된 완료분을 거둔다). 별개로 감사 로그(단계 10a)만 append-only 파일로 남는다([`crate::audit`]).
//!
//! ## 자식 모듈 (역할별 — 형제끼리는 `use super::*` 로 부모의 재수출을 본다)
//!
//! | 파일 | 맡는 것 |
//! |---|---|
//! | `operations/model.rs` | `OperationState` · `Operation` · 저장소 `OperationStore`/`Operations` · `now_ms` · `new_operation_id` |
//! | `operations/analysis.rs` | **승인 요약의 앱 분석** — 원문만 보고 매기는 효과(읽기 · 쓰기 · 삭제 · 확인 필요) · 근거 · 프로그램 · sudo · DB 문장(테이블 · `WHERE`) · 선언과의 어긋남 `mismatch` · AI 설명 다듬기 — 진입점 + `analysis/`(`types` · `shell_lex` · `shell_effect` · `command_lines` · `command` · `sql` · `summary` · `tests`) |
//! | `operations/store.rs` | 검토 단계 순수 연산 — 초안·멱등 키·검토 요청·읽기·목록·거절·대상 수정·무효화 |
//! | `operations/expiry.rs` | 검토 대기 만료(TTL) — `expire_stale` · `approval_ttl_ms` · 잠금 밖 알림 |
//! | `operations/lifecycle.rs` | 실행 상태 전이 — `approve` · `mark_running` · `finish` · 보존 한도 · 사람의 취소 표식 |
//! | `operations/gate.rs` | 승인 게이트 — caps · 자동 승인 정책 재검증 · `auto_execute` 위임 · 빈도 한도 |
//! | `operations/results.rs` | 대상별 결과 `TargetState`/`TargetResult` · 결과 행렬 · 스냅샷 |
//! | `operations/classification.rs` | exec 산출물 분류 · canary 진행 판정 · 검증 실패 사유 · 집계 |
//! | `operations/audit_hook.rs` | 감사 연결 — 상태 이름 · 대상별 요약 · `AuditSink` · 대상 라벨 |
//! | `operations/events.rs` | 이벤트 이름(`operation-state`·`operation-progress`) · 결과 칸 저장+emit |
//! | `operations/target.rs` | 대상 하나 실행 — 위임 재검사 · 전역 예산 · 위임 자동 접속 · exec |
//! | `operations/executor.rs` | `compose_command` · 취소 스위치 · 전역 예산 · 순차 canary `execute` · `finalize` |
//! | `operations/commands.rs` | 검토 UI Tauri 명령 — 목록 · 결과 · 거절 · 대상 수정 |
//! | `operations/approval.rs` | **승인·취소 Tauri 명령**(MCP 아님) · 서버 몸 `approve_in`(→ `approve_in_with`) · `OpsPlane` |
//! | `operations/auto.rs` | **사전 정책 자동 승인의 시계**(③-4 — 세션 서버 2초) — `sweep` → `approve_in(…, "auto")` 하나 · 검토 중 제외 · 한 번만 |
//! | `operations/notify.rs` | 창 밖 결과 알림(③-4) — `FinishedRun` 문구 · 미전달 큐 `Unseen` · 창 없을 때 메신저 |
//! | `operations/db_exec.rs` | **DB 작업안 실행**(쿼리 타일 3b) — 재판정(권한 · 신원 스냅샷, 열기 전 · 첫 문장 직전) → `db::ai_write` 쓰기 연결 · 한 트랜잭션 · `maxAffected` |
//!
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `operations::approval::approve_operation` 처럼 정의 경로를 쓴다.
//! 그래서 명령만 든 자식(`commands`·`approval`)과 이름으로 부르는 `auto`·`notify` 는 재수출하지 않는다.

pub(crate) mod analysis;
pub(crate) mod approval;
pub(crate) mod auto;
mod audit_hook;
mod classification;
pub(crate) mod commands;
pub(crate) mod db_exec;
mod events;
mod executor;
mod expiry;
mod gate;
mod lifecycle;
mod model;
pub(crate) mod notify;
mod results;
mod store;
mod target;

pub(crate) use analysis::{Computed, Effect};
use audit_hook::*;
use classification::*;
pub(crate) use events::*;
pub(crate) use executor::*;
pub(crate) use expiry::*;
pub(crate) use gate::*;
use lifecycle::*;
pub(crate) use model::*;
pub(crate) use results::*;
pub(crate) use store::*;
use target::*;

// tests.rs 는 `use super::*` 로 부모 스코프의 std 이름까지 봐 왔다 — 분할 전 부모가 쥐던 그 이름들.
#[cfg(test)]
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::sync::{Arc, Mutex};

#[cfg(test)]
mod tests;
