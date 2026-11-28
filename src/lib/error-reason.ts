/**
 * 백엔드 실패의 이유 코드 — 언어를 타지 않는 ASCII 접두사(`[exists] …`)다. 같은 표가 Rust `src-tauri/src/errors.rs` 에 있다.
 *
 * 규칙 둘:
 * 1. 판정은 "들어 있는가" 다 — 문구가 `"{무엇}: {까닭}"` · `"2개 이동 완료, 3번째에서 중단: {까닭}"` 처럼 감싸여 올라오기도 한다.
 * 2. 화면에 찍기 전에 [`stripReason`] 으로 뗀다 — 사람은 대괄호를 볼 일이 없다.
 *
 * 세션 열기 실패는 여기 오지 않는다 — 구조화된 페이로드로 `session.ts` 의 `parseSessionError` 가 받는다.
 */

/** Rust 쪽 상수(`errors.rs` · `orchestration::store::reason` …)와 글자까지 같다 */
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
  | "git-identity"
  /** 세션 코어의 임대 · 스트림 거절 — 화면 분기는 없고 사람에게 보일 때 대괄호만 뗀다 */
  | "stale-lease"
  | "session-alive"
  | "session-busy"
  | "session-attached"
  | "server-outdated"
  | "db-password"
  | "db-auth"
  /** `[session-gone]` 의 덧말 — 같은 타일의 끊긴 연결이 빌린 비밀번호를 쥐고 있어 `query/open-flow` 가 잠금 해제를 먼저 묻지 않고 한 번 열어 본다 */
  | "db-carry"
  | "db-stored-rejected"
  | "db-disconnected"
  | "db-tx-stale"
  /** 엔진이 실행 중에 읽기 전용으로 거절했다 — 서버는 다시 돌지 않았다 */
  | "db-needs-work"
  /** 실행 결과 미확인 — 그 문장이 실행 · 반영됐는지 앱은 모른다 */
  | "db-unconfirmed"
  /** Run 표의 거절 사유(Rust `orchestration::store::reason` · MCP 와 같은 낱말) — 사람 문구는 `orchestration/model.ts` 의 `ORCH_REASON_KEY` */
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
  | "stale-attempt"
  | "already-reported"
  | "dirty-report"
  | "not-success"
  | "no-commit"
  | "transcript-unavailable"
  | "report-mismatch"
  | "run-on-hold"
  | "integration-busy"
  | "integration-committing"
  | "already-integrated"
  | "integration-failed"
  | "not-completable"
  | "git-too-old"
  | "git-unsupported"
  | "export-checked-out"
  | "export-branch-moved"
  | "verify-failed"
  | "verify-limit"
  | "verify-unsupported"
  | "approval-stale"
  | "approval-expired"
  | "review-active"
  | "review-pending"
  | "review-required"
  | "review-changes-requested"
  | "review-budget-exhausted"
  | "symlink-outside"
  | "cleanup-pending"
  | "not-cleanable"
  | "worktrees-left"
  | "archive-unreadable"
  | "unknown-role"
  | "role-invalid"
  | "role-removed"
  | "role-changed"
  | "rework-limit"
  | "accept-rule-unmet"
  | "busy"
  | "conversation-broken"
  | "turn-limit"
  /** 조정자가 묶이지 않은 Run 의 사람 [재개] */
  | "no-coordinator"
  /** 같은 requestId 를 다른 도구 · 다른 입력이 썼다 */
  | "request-id-reused"
  /** 사이드 채팅(Rust `server::side_chat` · `server::side_chat_proxy`) — `stale-chat` 은 옛 프로세스 세대의 호출이라 다시 attach 한다 */
  | "stale-chat"
  | "start-timeout"
  | "exited"
  | "unknown-request"
  | "conversation-not-found"
  | "conversation-folder-missing"
  | "main-window-only"
  | "bad-effort"
  | "bad-link"
  | "too-many-links"
  /** 채팅 모양 AI 타일(Rust `server::chat_tile`) — `wrong-chat-kind` = 다른 종류 채팅의 id(`ct-` · `pc-`) */
  | "wrong-chat-kind"
  | "bad-cwd"
  | "conversation-busy"
  | "chat-tile-off"
  | "not-ready"
  /** 채팅 타일의 권한 모드 · 결정 — `unsupported` = 그 어댑터가 받지 않는 동작 */
  | "bad-mode"
  | "bad-answer"
  | "no-session-allow"
  | "unsupported"
  /** 채팅 타일의 압축 · 스킬 — `not-started` = 프로세스가 없다(압축 op 는 띄우지 않는다) */
  | "turn-running"
  | "not-started"
  | "nothing-to-compact"
  | "bad-instructions"
  | "bad-skill"
  /** 채팅 타일 되감기 — `rewind-timeout` · `rewind-failed` 는 프런트가 짓는 낱말(답이 오지 않음 · CLI 가 글 없이 거절) */
  | "bad-anchor"
  | "bad-scope"
  | "nothing-to-rewind"
  | "preview-first"
  | "rewind-running"
  | "rewind-timeout"
  | "rewind-failed"
  /** 채팅 타일 검토 · 목표 · 속도 · MCP 상태 */
  | "bad-review-target"
  | "bad-goal"
  | "bad-objective"
  | "bad-budget"
  | "no-goal"
  | "bad-tier"
  | "mcp-status-busy"
  /** 한 대화는 한 곳에서만 — 사이드 채팅 표 ↔ 채팅 타일 표 */
  | "conversation-in-side-chat"
  | "conversation-in-chat-tile"
  /** CLI 의 `.exe` 를 PATH 에서 못 찾음(Rust `orchestration::spawn::find_exe` — `.cmd` 는 받지 않는다) */
  | "cli-not-found"
  /** 사이드 채팅 첨부 판정(Rust `server::side_chat` 의 `images_in` · `files_in`) */
  | "too-many-attachments"
  | "too-many-images"
  | "file-too-big"
  | "image-too-big"
  | "file-outside"
  | "file-missing"
  | "file-not-file"
  | "file-dest"
  | "file-copy"
  | "image-outside"
  | "image-missing"
  | "image-not-file"
  | "image-type"
  /** `chats.json` 이 다른 창에서 바뀌어 쓰지 않았다 — `app/side-chats` 가 다시 읽고 이 창의 바뀜을 다시 얹어 저장한다 */
  | "stale-list"
  /** 메신저 다리(`server/messenger_bridge_proxy.rs`) */
  | "bad-token"
  | "unreachable"
  | "no-pending"
  | "not-paired"
  | "send-failed"
  | "save-failed";

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
  "too-many-links",
  "wrong-chat-kind",
  "bad-cwd",
  "conversation-busy",
  "chat-tile-off",
  "not-ready",
  "bad-mode",
  "bad-answer",
  "no-session-allow",
  "unsupported",
  "turn-running",
  "not-started",
  "nothing-to-compact",
  "bad-instructions",
  "bad-skill",
  "bad-anchor",
  "bad-scope",
  "nothing-to-rewind",
  "preview-first",
  "rewind-running",
  "rewind-timeout",
  "rewind-failed",
  "bad-review-target",
  "bad-goal",
  "bad-objective",
  "bad-budget",
  "no-goal",
  "bad-tier",
  "mcp-status-busy",
  "conversation-in-side-chat",
  "conversation-in-chat-tile",
  "cli-not-found",
  "too-many-attachments",
  "too-many-images",
  "file-too-big",
  "image-too-big",
  "file-outside",
  "file-missing",
  "file-not-file",
  "file-dest",
  "file-copy",
  "image-outside",
  "image-missing",
  "image-not-file",
  "image-type",
  "stale-list",
  "bad-token",
  "unreachable",
  "no-pending",
  "not-paired",
  "send-failed",
  "save-failed",
];

function marker(reason: ErrorReason): string {
  return `[${reason}]`;
}

export function withReason(reason: ErrorReason, message: string): string {
  return `${marker(reason)} ${message}`;
}

/** 감싸인 문구도 알아본다 — 머리말의 규칙 1 */
export function hasReason(message: string, reason: ErrorReason): boolean {
  return message.includes(marker(reason));
}

const MARKERS = new RegExp(`\\[(?:${REASONS.join("|")})\\]\\s*`, "g");

export function stripReason(message: string): string {
  return message.replace(MARKERS, "");
}
