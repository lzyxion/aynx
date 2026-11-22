// 세션 열기·손잡이의 Rust 계약 — 타입·상수·순수 함수만(invoke 는 부르지 않는다).

import type { SessionKind } from "./spec";
import type { InputSource } from "$lib/term/input-source";

// ── 세션 종료 사유 · 자동 재연결 ──

/** `ssh-exit` 과 `local-exit` 이 같은 모양이다 */
export interface SshExitPayload {
  id: number;
  /** `"exit"` = 셸이 스스로 끝났다 / `"error"` = 연결이 사라졌다 */
  reason: string;
  message: string | null;
  /** 표에 오르기 전에 끝났으면 없다 */
  stream?: string | null;
  sessionEpoch?: number | null;
  /**
   * 로컬 종료 사유 코드(Rust `pty::LocalExit`) — 서버는 화면 언어를 모르므로 문구 대신 코드를 보낸다.
   * `"exit"`(+ 0 이 아니면 `exitCode`) · `"wait-failed"`(+ `detail` OS 오류 원문) · `"server-stopped"`(GUI 가 만든다).
   */
  code?: string | null;
  exitCode?: number | null;
  detail?: string | null;
}

/**
 * Rust `session_core::Keys` — 다른 창이 세션을 가져갔거나 같은 스트림에 새 회차가 섰으면 Rust 가 `[stale-lease]` 로 거부한다
 * (늦게 도착한 옛 손잡이의 닫기가 새 세션을 죽이지 않게).
 */
export interface SessionLease {
  /** `historyStreamId ?? pane.id` */
  stream: string;
  sessionEpoch: number;
  leaseEpoch: number;
}

/** `kind` 하나가 자동 재연결의 분기점이다 — `"error"` 만 백오프로 다시 붙는다 */
export interface SessionExitReason {
  kind: "exit" | "error";
  message: string | null;
  /** 있으면 화면 문구는 이것으로 만든다 */
  code?: "exit" | "wait-failed" | "server-stopped";
  exitCode?: number | null;
}

/** 모양을 못 알아보면 `"exit"` — 알 수 없는 값에서 재연결 루프를 도는 것보다 조용히 멈추는 쪽이 안전하다 */
export function parseExitReason(payload: unknown): SessionExitReason {
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    const code =
      o.code === "exit" || o.code === "wait-failed" || o.code === "server-stopped" ? o.code : undefined;
    const detail = typeof o.detail === "string" && o.detail !== "" ? o.detail : null;
    return {
      kind: o.reason === "error" ? "error" : "exit",
      // 코드가 있으면(로컬) 문구는 부른 쪽 i18n 이 만든다 — 여기 `message` 는 OS 오류 원문(`detail`)뿐이다.
      message: typeof o.message === "string" && o.message !== "" ? o.message : detail,
      ...(code ? { code, exitCode: typeof o.exitCode === "number" ? o.exitCode : null } : {}),
    };
  }
  return { kind: "exit", message: null };
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/** 와이파이가 바뀌면 세션이 전부 같은 순간 끊긴다 — 지터가 없으면 같은 초에 재접속해 서버의 `MaxStartups` 를 때린다 */
export const RECONNECT_JITTER = 0.3;

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  // 지수부터 자른다 — 시도 수가 커지면 2 ** n 이 Infinity 가 되어 계산이 NaN 으로 무너진다.
  const steps = Math.min(n - 1, 30);
  const base = Math.min(RECONNECT_BASE_MS * 2 ** steps, RECONNECT_MAX_MS);
  return Math.round(base * (1 + (random() * 2 - 1) * RECONNECT_JITTER));
}

/** 모든 호출은 실패해도 throw 하지 않는다 */
export interface SessionHandle {
  readonly id: number;
  readonly kind: SessionKind;
  readonly resolvedShell?: string;
  readonly tmuxName?: string;
  /** 창 이관 재부착에서만 — 첫 바이트가 Rust 출력 꼬리 링(`output.rs` `TailRing`)에서 갖는 오프셋. 새 열림의 채널은 0 에서 시작한다 */
  readonly outputStart?: number;
  readonly lease?: SessionLease;
  readonly replayEnd?: number;
  readonly overrunBytes?: number;
  /** 떨어진 세션에 붙었을 때만(로컬) — 붙기 전 PTY 크기, 곧 재생분이 쓰인 화면 크기 */
  readonly replaySize?: { cols: number; rows: number };
  readonly viewer?: boolean;
  /** 새 열림은 없다(연 쪽이 주인) — 그 뒤의 바뀜은 이벤트 `session-size-owner` 로 온다 */
  readonly sizeOwner?: boolean;
  readonly ownerSize?: { cols: number; rows: number };
  /** 옛 서버는 없다 */
  readonly ownerPrimary?: boolean;
  /** 세션 서버가 `source` 로 크기 주인을 가른다(키 · 붙여넣기만 주인이 된다 — `term/input-source.ts`). 없으면 키다 */
  write(data: string, source?: InputSource): void;
  resize(cols: number, rows: number): void;
  /** 셸에 아무것도 쓰지 않고 이 쪽을 크기 주인으로 삼는다 — 자격이 없거나(폰) 실패면 `false` */
  claimSize(cols: number, rows: number): Promise<boolean>;
  pause(): void;
  resume(): void;
  /** 로컬의 `pause`/`resume` 은 아무 일도 하지 않는다 — 역압은 이 ACK 크레딧이다 */
  ack?(consumed: number): void;
  close(): Promise<void>;
  /** 백엔드 `close_*` 를 부르지 않는다 — 탭을 다른 창으로 넘길 때 언마운트가 세션까지 죽이는 것을 막는 유일한 출구다 */
  detach(): Promise<void>;
}

/**
 * xterm.js 공식 문서 권고값(docs/verification/xterm.md) — 히스테리시스가 있어야 경계에서 pause/resume 이 진동하지 않는다.
 * HIGH 를 키우면 Ctrl+C 반응이 그만큼 늦어진다(공식 문서도 500KB 초과를 금한다).
 */
export const HIGH_WATER = 100_000;
export const LOW_WATER = 10_000;

/** `write()` 콜백을 붙이는 간격 — HIGH_WATER 의 절반이라 HIGH 를 넘기 전에 반드시 한 번은 차감이 일어난다 */
export const ACK_INTERVAL = 50_000;

/** Rust `HostKeyDecision` 과 같은 철자다 — `"reject"` 만 백엔드로 가지 않는다(프런트에서 끝난다) */
export type HostKeyDecision = "trust" | "once" | "replace" | "reject";

export interface HostKeyPrompt {
  alias: string;
  fingerprint: string;
  key_type: string;
  /** `false` 면 처음 보는 키(TOFU)다 */
  changed: boolean;
  oldFingerprint: string | null;
  host: string | null;
  port: number | null;
  /** `UserKnownHostsFile none` 인 호스트는 수락해도 파일에 적히지 않는다 — 기록 계열 버튼을 두면 누르고도 아무 일이 없다 */
  canRecord: boolean;
  /** 공개키 설치 흐름은 `false` 다 — 백엔드도 그 경로에 결정을 두 갈래로만 받는다 */
  allowOnce: boolean;
}

export type ConfirmHostKey = (prompt: HostKeyPrompt) => Promise<HostKeyDecision>;

export interface PasswordPrompt {
  alias: string;
  message: string;
  /** 1부터 */
  attempt: number;
  maxAttempts: number;
  /** 금고에 담아 둔 비밀번호가 거부됐다(docs/log/2026-09-19-vault.md) */
  storedRejected: boolean;
  /** 있으면 같은 모달이 DB 비밀번호를 묻고, "이 앱에 저장" 은 볼트 `db_password`(대상 = 연결 `id`)로 간다 */
  db?: DbPasswordTarget;
  /** DB 연결 폼의 [연결 테스트] — 테스트는 볼트에 아무것도 담지 않는다(DB 비밀번호를 볼트에 담는 길은 쿼리 타일 접속 모달 하나) */
  noSave?: boolean;
}

/** 값이 아니라 이름들이다(비밀 없음) */
export interface DbPasswordTarget {
  /** 볼트 열쇠 */
  id: string;
  name: string;
  /** `사용자@DB` (모르면 빈 글자) */
  who: string;
  /** `null` = 경유 없음 */
  via: string | null;
}

/** 돌려준 문자열은 invoke 한 번에만 쓰이고 곧바로 버려진다 */
export type PromptPassword = (prompt: PasswordPrompt) => Promise<string | null>;

/** 틀린 값으로 서버의 인증 시도 한도를 태우지 않게 막는다 */
export const MAX_PASSWORD_ATTEMPTS = 3;

/** `path` 는 백엔드가 준 전체 경로 그대로다 — 재시도에서 `passphraseFor` 로 되돌려야 백엔드가 어느 후보인지 가린다(화면은 파일 이름만) */
export interface PassphrasePrompt {
  path: string;
  fingerprint: string | null;
  wrong: boolean;
  /** 금고에 담아 둔 암호구로 열리지 않았다 — `wrong` 과 달리 아직 아무것도 치지 않았다 */
  storedRejected: boolean;
  attempt: number;
  maxAttempts: number;
  /** [`PasswordPrompt.noSave`] 와 같은 뜻 */
  noSave?: boolean;
}

/** 돌려준 값을 금고에 담는 것은 프런트다(`app/prompts` 의 `flushVaultSaves`) — 세션 열기는 담는 일을 알 필요가 없다 */
export type PromptPassphrase = (prompt: PassphrasePrompt) => Promise<string | null>;

/** 키 파일 하나당 센다 */
export const MAX_PASSPHRASE_ATTEMPTS = 3;

/** Rust `ssh::OpenCause` 와 글자까지 같다 — `kind`(프런트가 무엇을 할까)와 직교하는 "무엇이 잘못됐나" 축이다 */
export type OpenCause =
  | "dns"
  | "tcp_refused"
  | "tcp_timeout"
  | "tcp_unreachable"
  | "auth_key_rejected"
  | "key_file_unreadable"
  | "auth_password_rejected"
  | "auth_no_method"
  | "banner_or_protocol"
  | "jump"
  | "other";

export interface OpenDiag {
  cause: OpenCause;
  /** `cause === "jump"` 일 때만 */
  jump?: string;
  inner?: OpenCause;
  identitiesOnly?: boolean;
}

/** 모르는 코드를 걸러 내는 유일한 기준 (Rust `OpenCause` 와 같은 글자) */
export const OPEN_CAUSES: readonly OpenCause[] = [
  "dns",
  "tcp_refused",
  "tcp_timeout",
  "tcp_unreachable",
  "auth_key_rejected",
  "key_file_unreadable",
  "auth_password_rejected",
  "auth_no_method",
  "banner_or_protocol",
  "jump",
  "other",
];

/** `open_ssh_session` 이 거부할 때의 페이로드 (Rust 계약) + 프런트 전용 `cancelled` */
export type SessionError =
  | {
      kind: "host_key_unknown" | "host_key_changed";
      fingerprint: string;
      key_type: string;
      host: string | null;
      port: number | null;
      noStore: boolean;
      oldFingerprint: string | null;
    }
  | {
      kind: "password_required" | "auth" | "other";
      message: string;
      /** 옛 백엔드·프런트가 스스로 만든 실패에는 없다 */
      diag?: OpenDiag;
      storedRejected?: boolean;
    }
  | {
      /** 다이얼로그 계약이라 `message` 도 `diag` 도 없다 — 글자는 전부 사전이 만든다 */
      kind: "passphrase_required";
      path: string;
      fingerprint: string | null;
      wrong: boolean;
      storedRejected: boolean;
    }
  | { kind: "cancelled" }
  | { kind: "password_cancelled" }
  | { kind: "passphrase_cancelled" };

export interface OpenOptions {
  onData: (data: ArrayBuffer) => void;
  cols: number;
  rows: number;
  confirmHostKey?: ConfirmHostKey;
  promptPassword?: PromptPassword;
  promptPassphrase?: PromptPassphrase;
  onExit?: (reason: SessionExitReason) => void;
  /** 로컬 전용 · 이 열기 한 번 — 있으면 `PaneSpec.cwd` 대신 이 폴더에서 셸을 띄운다 */
  localCwd?: string;
  /** SSH 첫 접속에만(재연결은 싣지 않는다 — 1회용) — 한 줄로 조립하는 것은 Rust 다(`ssh::project_start_line`) */
  start?: {
    cwd: string;
    command: string | null;
    /** `ticket` — 준비 이벤트 `ssh-worktree-prep` 와 답 `ssh_worktree_answer` 가 이 글자로 타일을 가리킨다(Rust `ssh::SshWorktree`) */
    worktree?: { repo: string; name: string; ticket: string } | null;
    /** 스크립트 글자는 싣지 않는다(Rust `ssh::SshSetup`) */
    setup?: { projectId: string; nonce: string } | null;
  };
}
