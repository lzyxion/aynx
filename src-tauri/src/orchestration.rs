//! **오케스트레이션** — 조정자 AI(프로듀서 채팅)가 작업자 AI 에게 일을 맡기고 사람이 감독한다. 세션 서버의 AI 평면이 쥐어 GUI 없이도 Run 이 산다.
//! 설계: docs/log/2026-10-14-orchestration-design.md · 2026-10-15-orchestration-integration-design.md · 2026-10-16-orchestration-headless-design.md · 2026-10-30-orchestration-structured-producer.md
//!
//! ## 불변식(AGENTS.md "보안 제약" · 설계 결정 절)
//!
//! - **역할 토큰 · 채팅 토큰은 같은 계정 안의 보안 경계가 아니다**(설계 C-1 (가)) — 방어선은 맡긴 역할의 권한 + 사람 감독이다(→ docs/invariants.md 전문 9).
//! - 역할은 **서버 표에서만** 읽는다. 조정자의 조율은 자기 Run 안에서만(다른 Run 은 `not-found`).
//! - **조정자 토큰은 없다** — 조정자는 프로듀서 채팅의 채팅 토큰에 서버 표의 묶음이 붙인 역할이고, 조율 요청은 예상 `runId` · `gen` 이 묶음과
//!   맞을 때만이다. 토큰 값은 프런트 · 로그 · `Debug` · 영속 파일 · 이벤트에 나가지 않는다(→ 전문 9).
//! - **타일 토큰은 자리가 되지 못한다** — 타일 도구 · 조율 도구를 부르면 모르는 도구다(시험 `tile_token_cannot_open_or_coordinate`).
//! - **Run 은 사람의 앨범 시작 op(`producer_album_start`)로만 열린다 — AI · MCP 에는 Run 을 열 길이 없다.** 조정자는 Run 을 멈추거나
//!   사람의 상태(일시정지 · 재개 · 중단)를 바꾸지 못하고, 완료(`complete_run`)는 스스로 main 을 건드리지 않는다 —
//!   병합이 따르는 것은 사람이 그 앨범에 자동 병합을 켰을 때뿐이다(`album_merge.rs`).
//! - 키 전송 · 권한 응답 · 승인 · 실행 · 위임 편집 도구는 어느 역할에도 없다.
//! - 브레이크(사람의 일시정지 · 중단 · 한도)가 실행 경로(작업자 생성 · 턴)보다 **먼저** 선다.
//! - **AI 문자열 → PTY 길은 없다.** AI 문자열이 프로세스에 닿는 길은 헤드리스 턴의 실행 인자 하나 — 셸 없는 인자 배열의 `--` 뒤 머리줄 `[` 로
//!   시작하는 한 칸(시험 `send_prompt_is_resume_turn_not_pty`).
//! - 서버가 GUI 요청 없이 띄우는 것은 **둘뿐** — 헤드리스 턴과 수락 전 검증 명령(사람이 [새 앨범] 구성에서 정한 한 줄 · 후보마다 사람 확인
//!   또는 사람이 켠 자동 실행 — 시험 `server_spawns_only_turns_and_verify`). 통합 git 은 셸 없음 · 훅 끔 · 지원 범위 밖 저장소는 거절(드라이버 · 필터가 돌지 않게).
//! - 자동 재개 없음 — 서버가 다시 뜨면 남은 Run 은 orphaned(읽기 전용 · 토큰 없음)이고 사람이 판단한다.

mod accept;
pub(crate) mod album;
pub(crate) mod config;
pub(crate) mod repo_identity;
pub(crate) mod album_start;
pub(crate) mod album_change;
mod album_merge;
pub(crate) mod artists;
mod attempts;
mod cleanup;
mod commit;
mod diff;
pub(crate) mod git;
mod integrate;
mod merge;
mod model;
pub(crate) mod notice;
pub(crate) mod ops;
mod persist;
pub(crate) mod progress;
mod report;
mod resolve;
mod resume;
mod review;
pub(crate) mod roles;
pub(crate) mod spawn;
mod start;
mod store;
mod tile;
mod tools;
pub(crate) mod turn;
pub(crate) mod verify;
pub(crate) mod wake;
pub(crate) mod worktree;

pub(crate) use attempts::SpawnVerdict;
pub(crate) use integrate::GitRefs;
pub(crate) use model::{AttemptKind, TurnArgsLabel, TurnRecord, WorkerCli};
pub(crate) use persist::store_dir;
pub(crate) use notice::EVT_NOTICE;
pub(crate) use store::reason::NOT_A_TILE;
pub(crate) use model::RunState;
pub(crate) use store::{Caller, Orchestration, Seat, EVT_CHANGED, EVT_PROGRESS};
pub(crate) use start::{repo_toplevel, tile_tool_schemas, TILE_TOOLS};
pub(crate) use tools::{coordinator_tool_schemas, is_tool_for, reviewer_tool_schemas, worker_tool_schemas, COORDINATOR_TOOLS};

/// 프로듀서 채팅 전용 미리 허용 표 — 로컬 AI 타일 · 감싸개 셸 타일에는 미리 허용이 없다(시험 `tile_token_cannot_open_or_coordinate`).
pub(crate) fn preallowed_tools() -> impl Iterator<Item = &'static str> {
    TILE_TOOLS.iter().chain(COORDINATOR_TOOLS.iter()).copied()
}

pub(crate) fn seed_conflict(worktree: &std::path::Path, seed: &spawn::ResolveSeed) -> Result<usize, store::OrchError> {
    resolve::seed_blocking(worktree, &seed.old, &seed.conflict_commit)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn review_place(
    repo: &std::path::Path,
    worktree_dir: &str,
    cwd_root: &std::path::Path,
    run_id: &str,
    task_id: &str,
    attempt_id: &str,
    commit: &str,
    sidecar: Option<&std::path::Path>,
) -> Result<(String, String), store::OrchError> {
    review::place_blocking(repo, worktree_dir, cwd_root, run_id, task_id, attempt_id, commit, sidecar)
}

pub(crate) fn review_links_ok(place: &std::path::Path) -> Result<(), store::OrchError> {
    review::check_links_blocking(place)
}

pub(crate) fn is_run_id(s: &str) -> bool {
    model::is_id("run", s)
}

pub(crate) fn is_attempt_id(s: &str) -> bool {
    model::is_id("att", s)
}

#[cfg(test)]
pub(crate) mod test_album;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_album;
#[cfg(test)]
mod tests_spawn;
#[cfg(test)]
mod tests_report;
#[cfg(test)]
mod tests_wt;
#[cfg(test)]
mod tests_headless;
#[cfg(test)]
mod tests_progress;
#[cfg(test)]
mod tests_commit;
#[cfg(test)]
mod tests_stage1;
#[cfg(test)]
mod tests_stage2;
#[cfg(test)]
mod tests_stage3;
#[cfg(test)]
mod tests_stage3b;
#[cfg(test)]
mod tests_stage4;
#[cfg(test)]
mod tests_stage5;
#[cfg(test)]
mod tests_stage6;
#[cfg(test)]
mod tests_archive;
#[cfg(test)]
mod tests_merge;
#[cfg(test)]
mod tests_turn;
#[cfg(test)]
mod tests_state;
#[cfg(test)]
mod tests_tile;
#[cfg(test)]
mod tests_start;
#[cfg(test)]
mod tests_producer;
#[cfg(test)]
mod tests_wake;
