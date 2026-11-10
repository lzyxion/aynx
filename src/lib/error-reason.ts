/**
 * **백엔드 실패의 이유 코드** — 프런트가 갈래를 가르려고 보는 것들.
 *
 * Rust 명령은 전부 `Result<_, String>` 이고, 그중 네 부류는 화면이 다르게 그린다:
 * 같은 이름이 이미 있으면 [덮어쓰기] 를 권하고, 디렉터리가 비어 있지 않으면 재귀 삭제를
 * 묻고, 세션이 사라졌으면 빨간 오류 대신 "연결 대기" 배너를 세우고, 사용자가 누른 취소는
 * 실패로 그리지 않는다.
 *
 * 국제화 이전에는 그 판정이 **한국어 조각**(`"이미 있습니다"`)을 `includes()` 로 맞춰 보는
 * 것이었다 — 그래서 그 넷만 번역에서 빠져 있었다(옮기는 순간 분기가 조용히 죽는다).
 * 지금은 백엔드가 **언어를 타지 않는 ASCII 접두사**를 앞에 단다:
 *
 * ```text
 * [exists] note.txt 이(가) 이미 있습니다 — 다른 이름을 지정하세요
 * [exists] note.txt already exists — choose a different name
 * ```
 *
 * 같은 표가 Rust 쪽 `src-tauri/src/errors.rs` 에 있다 (생성자와 접두사 상수).
 *
 * ## 규칙 둘
 *
 * 1. **판정은 "들어 있는가"** 다. 이 문구들은 감싸여 올라오기도 한다 —
 *    `"{무엇}: {까닭}"` · `"2개 이동 완료, 3번째에서 중단: {까닭}"`. 그래서 접두사가
 *    문자열 어딘가에 있으면 그 갈래다(국제화 이전의 `includes()` 와 같은 성질이라 화면
 *    동작이 바뀌지 않는다).
 * 2. **화면에 찍기 전에 [`stripReason`] 으로 뗀다.** 사용자는 대괄호를 볼 일이 없다.
 *    떼는 자리는 "문자열이 화면 상태가 되는 곳" 이다 (파일 타일의
 *    `failureOf`·`setError`·`edit.error` — `browser/file-listing.svelte.ts` · `SftpBrowser.svelte` · `browser/file-menu-controller.svelte.ts`, 업로드 모달의 `item.error`).
 *
 * 세션 **열기** 실패는 여기 오지 않는다 — 그쪽은 구조화된 페이로드(`{kind, message, …}`)로
 * 올라가고 `session.ts` 의 `parseSessionError` 가 받는다.
 */

/**
 * 프런트가 갈래를 가르는 이유 코드 (Rust `errors.rs` 의 상수와 글자까지 같다).
 *
 * 2026-09-19 에 금고 셋이 늘었다 (docs/log/2026-09-19-vault.md):
 * `vault-locked` 는 **오류가 아니라 관문**이라 화면이 잠금 해제 모달을 열고,
 * `vault-wrong-master` 는 모달을 닫지 않고 그 칸에 빨간 줄만 세우며,
 * `vault-absent` 는 "아직 안 만들었다" = 정상이라 권유로 읽는다.
 *
 * 2026-09-27 에 저장 둘이 늘었다 (docs/log/2026-09-27-doc-edit.md "R — 저장 명령"):
 * `conflict` 는 편집을 시작한 뒤 디스크의 파일이 바뀌어 **쓰지 않았다**는 뜻이라 화면이
 * [다시 불러오기]·[덮어쓰기] 띠를 세우고, `missing` 은 저장할 파일이 없다(지워졌거나
 * 옮겨졌다 — 저장은 파일을 새로 만들지 않는다)는 뜻이라 글을 그대로 두고 "저장 못 함" 띠를 세운다.
 */
export type ErrorReason =
  | "exists"
  | "not-empty"
  | "session-gone"
  | "cancelled"
  | "vault-locked"
  | "vault-wrong-master"
  | "vault-absent"
  | "conflict"
  | "missing"
  /**
   * 2026-09-29 (docs/log/2026-09-28-project-create.md): 첫 커밋을 만들 git 신원(`user.name`·`user.email`)이 없다 —
   * 폼 · 독이 git 의 한 줄 대신 "먼저 설정하세요" + 복사할 `git config --global …` 두 줄을 그린다.
   */
  | "git-identity"
  /**
   * 2026-10-08 세션 코어 ② (docs/internal/session-server-design-2026-10-08.md 4.3): 옛 임대의 호출 거부 ·
   * 같은 스트림이 살아 있음(새로 열지 말고 붙어라) · 같은 스트림을 여는 중 · 다른 창이 붙어 있음.
   * 화면 분기는 없고(손잡이가 삼키거나 `Terminal` 이 다시 본다) 사람에게 보일 때 대괄호만 뗀다.
   */
  | "stale-lease"
  | "session-alive"
  | "session-busy"
  | "session-attached"
  /**
   * 2026-10-12 쿼리 타일 6단계: 붙은 세션 서버가 이 기능의 판(DB op — 판 8)보다 옛것이다. 문구(Rust `server::db_proxy`)가
   * 이미 "설정 › 세션 서버에서 [다시 시작]" 을 말한다 — 쿼리 타일은 [다시 열기] 대신 그 안내를 그대로 보인다.
   */
  | "server-outdated"
  /**
   * 2026-10-12 쿼리 타일 7단계: DB 가 비밀번호를 청했는데 실은 것이 없다 · DB 가 비밀번호를 거절했다(+ 그 값이 볼트의 것이었다) —
   * 쿼리 타일이 **DB 접속 모달**을 띄운다(`query/open-flow`). 열려 있던 DB 연결이 끊겼다 — "연결이 끊겼습니다 · [다시 연결]" 띠.
   */
  | "db-password"
  | "db-auth"
  /**
   * 2026-11-10: `[session-gone]` 의 덧말(쿼리 타일의 붙기만) — 같은 타일의 끊긴 연결이 빌린 비밀번호를 쥐고 있어 새 열기가 그 값으로
   * 붙을 수 있다. `query/open-flow` 가 볼트 잠금 해제를 먼저 묻지 않고 한 번 열어 본다(실패하면 평소 관문).
   */
  | "db-carry"
  | "db-stored-rejected"
  | "db-disconnected"
  /**
   * 2026-10-13 쿼리 타일 1단계(트랜잭션 작업): 작업 요청이 낡았다 — 이미 끝났거나 다른 작업이다(재부착 전의 [커밋] 등). 화면은
   * 작업 상태를 다시 읽는다.
   */
  | "db-tx-stale"
  /**
   * 2026-10-14 Codex 검토 반영 1: 자동 커밋을 끈 타일의 조회를 PG · MySQL 엔진이 실행 중에 읽기 전용으로 거절했다(함수 · CTE 안의
   * 쓰기). 서버는 다시 돌지 않았다 — 화면은 [트랜잭션 작업 시작] 뒤 다시 실행하라고 안내한다.
   */
  | "db-needs-work"
  /**
   * 2026-10-14 Codex 검토 반영 2(판 15): 실행 결과 미확인 — 응답 대기를 멈추고 연결을 버렸다 · 자동 커밋 단문의 COMMIT 응답을 못 받았다.
   * 그 문장이 실행 · 반영됐는지 앱은 모른다 — 화면은 '결과 불명' 틀로 눈에 띄게 보인다.
   */
  | "db-unconfirmed"
  /**
   * 2026-10-15 오케스트레이션(2b): Run 표의 거절 사유(서버 `orchestration::store::reason` · MCP 와 같은 낱말 — `conflict` 는 위의 것과
   * 같은 글자라 한 번만). 사람 문구(ko/en)는 `orchestration/model.ts` 의 `ORCH_REASON_KEY` → `orch.reason.*` 사전이다. 여기 두는 것은
   * 화면에 찍기 전 [`stripReason`] 이 대괄호를 떼게 하려는 것이다.
   */
  | "not-found"
  | "run-paused"
  | "run-stopped"
  | "run-orphaned"
  | "stale-generation"
  | "dependency-cycle"
  | "unknown-dependency"
  | "too-many-tasks"
  | "rate-limited"
  | "too-many-waiters"
  | "too-many-runs"
  | "worker-limit"
  | "invalid-argument"
  | "invalid-state"
  | "not-reported"
  | "task-not-editable"
  | "risk-not-confirmed"
  | "not-a-repo"
  | "limit-reached"
  // 2026-10-15 오케스트레이션 3단계 — 작업자 생성 · worktree op 층의 거절 사유(같은 규칙).
  | "cli-not-allowed"
  | "task-busy"
  | "dependency-not-accepted"
  | "needs-merge"
  | "spawn-unavailable"
  | "worktree-failed"
  | "worktree-dirty"
  | "worktree-in-use"
  | "not-run-worktree"
  | "branch-has-unmerged"
  // 2026-10-15 오케스트레이션 4단계 — 보고 · 수락의 거절 사유(같은 규칙).
  | "stale-attempt"
  | "already-reported"
  | "dirty-report"
  | "not-success"
  | "no-commit"
  // 2026-10-15 오케스트레이션 6단계 — 고정 대화를 아직 읽을 수 없다([기록 보기]).
  | "transcript-unavailable"
  // 2026-10-15 — 보고의 브랜치 · 커밋이 그 Attempt 와 맞지 않는다(수락 불가).
  | "report-mismatch"
  // 2026-10-15 통합 설계 2단계 — Run 보류 · 통합 작업(Run 당 하나 · 커밋 중 취소 불가 · 이미 통합됨 · 실패) · Run 완료 조건.
  | "run-on-hold"
  | "integration-busy"
  | "integration-committing"
  | "already-integrated"
  | "integration-failed"
  | "not-completable"
  // 2026-10-15 통합 설계 3단계 — git 판 · 지원 범위 밖 저장소 · 내보내기(체크아웃됨 · 앱 밖에서 바뀜).
  | "git-too-old"
  | "git-unsupported"
  | "export-checked-out"
  | "export-branch-moved"
  // 2026-10-16 통합 설계 4단계 — 수락 전 검증(통과 못 함 · 횟수 한도 · OS 스텁 · 사람 확인 묶음 어긋남 · 만료).
  | "verify-failed"
  | "verify-limit"
  | "verify-unsupported"
  | "approval-stale"
  | "approval-expired"
  // 2026-10-16 통합 설계 5단계 — 검토자(활성 · 대기 · 필수 · 변경 요청 · 예산 소진) · 검토 자리의 symlink 밖.
  | "review-active"
  | "review-pending"
  | "review-required"
  | "review-changes-requested"
  | "review-budget-exhausted"
  | "symlink-outside"
  // 2026-10-16 통합 설계 6단계 — 정리(남긴 서버 임시 폴더 · [정리] 대상 아님).
  | "cleanup-pending"
  | "not-cleanable"
  // 2026-11-05 앨범 보관함.
  | "worktrees-left"
  | "archive-unreadable"
  // 2026-10-17 헤드리스 설계 3a · 3b — 맡기기 · 역할 · 수락 규칙 · 헤드리스 턴(Rust `orchestration::store::reason`).
  | "unknown-role"
  | "role-invalid"
  | "role-removed"
  | "role-changed"
  | "rework-limit"
  | "accept-rule-unmet"
  | "busy"
  | "conversation-broken"
  | "turn-limit"
  /** 사람 [재개] — 조정자가 묶이지 않은 Run(Rust `orchestration::store::reason::NO_COORDINATOR`). */
  | "no-coordinator"
  /** 같은 requestId 를 다른 도구 · 다른 입력이 썼다(Rust `orchestration::store::reason::REQUEST_ID_REUSED` · `tile_token`). */
  | "request-id-reused"
  /**
   * 2026-10-23 사이드 채팅 v2(Rust `server::side_chat` · `server::side_chat_proxy`): 옛 프로세스 세대의 호출(`stale-chat` → 다시 attach) ·
   * CLI 가 시한 안에 준비되지 않음 · 준비 전에 끝남 · 기다리는 권한 요청이 아님 · 주 창이 아닌 창의 호출. 타일 대화 이어 가기(6단계)의 거절 둘 =
   * 그 CLI 의 대화 색인에 없는 대화(`conversation-not-found`) · 기록된 폴더가 없음(`conversation-folder-missing`).
   * 서버 표에 없는 채팅은 위의 `session-gone`(다시 open). `bad-effort` = 악수가 알린 목록 밖의 추론 강도. `bad-link`(5단계 연결 칩) = 서버
   * 거울에 없는 타일(닫힘 · 창 타일이 아님).
   */
  | "stale-chat"
  | "start-timeout"
  | "exited"
  | "unknown-request"
  | "conversation-not-found"
  | "conversation-folder-missing"
  | "main-window-only"
  | "bad-effort"
  | "bad-link"
  /** 2026-11-03 첫 설치 점검: 사이드 채팅 · 프로듀서 · 작업자가 띄울 CLI 의 `.exe` 를 PATH 에서 못 찾음(Rust `orchestration::spawn::find_exe` — `.cmd` 는 받지 않는다). */
  | "cli-not-found"
  /**
   * 2026-11-01 원격 사이드 채팅: 사이드 채팅 목록(`chats.json`)이 이 창이 읽은 뒤 다른 창(주 창 · 원격 창)에서 바뀌어 **쓰지 않았다** —
   * `app/side-chats` 가 다시 읽고 이 창의 바뀜을 다시 얹어 저장한다(사람에게 보이지 않는다).
   */
  | "stale-list";

/** 표 하나 — [`stripReason`] 의 정규식이 이 목록에서 만들어진다 */
export const REASONS: readonly ErrorReason[] = [
  "exists",
  "not-empty",
  "session-gone",
  "cancelled",
  "vault-locked",
  "vault-wrong-master",
  "vault-absent",
  "conflict",
  "missing",
  "git-identity",
  "stale-lease",
  "session-alive",
  "session-busy",
  "session-attached",
  "server-outdated",
  "db-password",
  "db-auth",
  "db-carry",
  "db-stored-rejected",
  "db-disconnected",
  "db-tx-stale",
  "db-needs-work",
  "db-unconfirmed",
  "not-found",
  "run-paused",
  "run-stopped",
  "run-orphaned",
  "stale-generation",
  "dependency-cycle",
  "unknown-dependency",
  "too-many-tasks",
  "rate-limited",
  "too-many-waiters",
  "too-many-runs",
  "worker-limit",
  "invalid-argument",
  "invalid-state",
  "not-reported",
  "task-not-editable",
  "risk-not-confirmed",
  "not-a-repo",
  "limit-reached",
  "cli-not-allowed",
  "task-busy",
  "dependency-not-accepted",
  "needs-merge",
  "spawn-unavailable",
  "worktree-failed",
  "worktree-dirty",
  "worktree-in-use",
  "not-run-worktree",
  "branch-has-unmerged",
  "stale-attempt",
  "already-reported",
  "dirty-report",
  "not-success",
  "no-commit",
  "transcript-unavailable",
  "report-mismatch",
  "run-on-hold",
  "integration-busy",
  "integration-committing",
  "already-integrated",
  "integration-failed",
  "not-completable",
  "git-too-old",
  "git-unsupported",
  "export-checked-out",
  "export-branch-moved",
  "verify-failed",
  "verify-limit",
  "verify-unsupported",
  "approval-stale",
  "approval-expired",
  "review-active",
  "review-pending",
  "review-required",
  "review-changes-requested",
  "review-budget-exhausted",
  "symlink-outside",
  "cleanup-pending",
  "not-cleanable",
  "worktrees-left",
  "archive-unreadable",
  "unknown-role",
  "role-invalid",
  "role-removed",
  "role-changed",
  "rework-limit",
  "accept-rule-unmet",
  "busy",
  "conversation-broken",
  "turn-limit",
  "no-coordinator",
  "request-id-reused",
  "stale-chat",
  "start-timeout",
  "exited",
  "unknown-request",
  "conversation-not-found",
  "conversation-folder-missing",
  "main-window-only",
  "bad-effort",
  "bad-link",
  "cli-not-found",
  "stale-list",
];

/** `[exists]` 처럼 문자열에 박히는 표식 */
function marker(reason: ErrorReason): string {
  return `[${reason}]`;
}

/** 이유 코드를 앞에 단다 — 프런트가 스스로 만드는 실패(`fs-backend` 의 세션 없음)에서 쓴다 */
export function withReason(reason: ErrorReason, message: string): string {
  return `${marker(reason)} ${message}`;
}

/** 이 실패가 그 갈래인가. 감싸인 문구도 알아본다 (머리말의 규칙 1) */
export function hasReason(message: string, reason: ErrorReason): boolean {
  return message.includes(marker(reason));
}

/** `[exists] ` · `[not-empty] ` … (뒤따르는 공백까지 함께 먹는다) */
const MARKERS = new RegExp(`\\[(?:${REASONS.join("|")})\\]\\s*`, "g");

/** 표식을 전부 떼어 낸 **사람이 읽는 줄** — 화면에 찍기 직전에 한 번 지난다 */
export function stripReason(message: string): string {
  return message.replace(MARKERS, "");
}
