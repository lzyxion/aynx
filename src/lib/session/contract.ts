// 세션 열기·손잡이의 **Rust 계약** — 종료 사유·자동 재연결 백오프·역압 수위·호스트 키/비밀번호/암호구
// 프롬프트·열기 실패 모양(`SessionError`·`OpenDiag`)·`OpenOptions`. invoke 는 부르지 않는다(타입·상수·순수 함수).

import type { SessionKind } from "./spec";
import type { InputSource } from "$lib/term/input-source";

// ---------------------------------------------------------------------------
// 세션 종료 사유 · 자동 재연결 (docs/log/2026-09-01-reconnect.md)
// ---------------------------------------------------------------------------

/**
 * 종료 이벤트의 원시 페이로드 (Rust 계약) — `ssh-exit` 과 `local-exit` 이 **같은 모양**이다.
 * 이름이 `Ssh…` 인 것은 이 계약이 SSH 에서 먼저 생겼기 때문일 뿐이다.
 */
export interface SshExitPayload {
  id: number;
  /** `"exit"` = 셸이 스스로 끝났다 / `"error"` = 연결이 사라졌다 */
  reason: string;
  message: string | null;
  /** 세션 코어의 스트림·회차(Rust `pty::LocalExit` · `ssh::session::SshExit`). 표에 오르기 전에 끝났으면 없다 */
  stream?: string | null;
  sessionEpoch?: number | null;
  /**
   * **로컬 종료 사유 코드**(세션 서버 ③-2 — Rust `pty::LocalExit`): 서버는 화면 언어를 모르므로 문구 대신 코드를 보낸다.
   * `"exit"`(+ 0 이 아니면 `exitCode`) · `"wait-failed"`(+ `detail` OS 오류 원문) · `"server-stopped"`(GUI 가 만든다).
   */
  code?: string | null;
  exitCode?: number | null;
  detail?: string | null;
}

/**
 * **세션 코어의 임대 열쇠** — Rust `session_core::Keys` (docs/internal/session-server-design-2026-10-08.md 4.3).
 *
 * 손잡이(로컬·SSH)는 열기·붙기·이관 재부착의 결과로 이 셋을 받고 **모든 be 호출**(write·resize·pause·resume·close)에
 * 동봉한다. 다른 창이 세션을 가져갔거나(붙기·이관) 같은 스트림에 새 회차가 섰으면(SSH 재접속 포함) Rust 가
 * `[stale-lease]` 로 거부한다 — 늦게 도착한 옛 손잡이의 닫기가 새 세션을 죽이지 않게.
 */
export interface SessionLease {
  /** 타일의 계보 = `historyStreamId ?? pane.id` */
  stream: string;
  /** 그 계보의 실행 회차 — 같은 스트림을 다시 열 때마다 +1 */
  sessionEpoch: number;
  /** 임대 회차 — 열기 1, 붙기·이관마다 +1 (SSH 재접속은 새 세션이라 다시 1) */
  leaseEpoch: number;
}

/**
 * 세션이 끝난 사유. **이 값 하나가 자동 재연결의 분기점**이다.
 *
 * - `"exit"`: 사용자가 `exit` 를 쳤거나 셸이 신호로 죽었다 → 재연결하지 않는다.
 * - `"error"`: keepalive 무응답·소켓 오류·서버가 먼저 끊음 → 백오프로 다시 붙는다.
 *
 * 인증 실패는 애초에 `openSession` 이 `SessionOpenError` 로 거부하므로 여기 오지 않는다.
 */
export interface SessionExitReason {
  kind: "exit" | "error";
  /** 배너·안내에 그대로 쓰는 한국어 한 줄 (없을 수 있다) */
  message: string | null;
  /** 로컬 종료 사유 코드(있으면 화면 문구는 이것으로 만든다 — [`SshExitPayload.code`]) */
  code?: "exit" | "wait-failed" | "server-stopped";
  exitCode?: number | null;
}

/**
 * 종료 이벤트 페이로드를 사유로 정규화한다 — **순수 함수**.
 *
 * 모양을 못 알아보면 `"exit"` 로 떨어뜨린다. 알 수 없는 값에서 재연결 루프를 도는 것보다
 * 조용히 멈추는 쪽이 안전하다 (사용자는 [지금 재연결] 로 언제든 다시 붙을 수 있다).
 */
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

/** 첫 재시도까지의 대기 (ms). 이후 시도마다 ×2 */
export const RECONNECT_BASE_MS = 1_000;
/** 백오프 상한 (ms) — 아무리 오래 끊겨 있어도 30초마다는 한 번 두드린다 */
export const RECONNECT_MAX_MS = 30_000;
/**
 * 지터 폭 (±30%).
 *
 * 와이파이가 바뀌면 열려 있던 세션이 **전부 같은 순간** 끊긴다. 지터가 없으면
 * 그 세션들이 같은 초에 동시에 재접속을 시도해 서버의 `MaxStartups` 를 때리고,
 * 실패하면 다시 같은 초에 몰린다. 30% 를 흩뿌려 그 동기화를 깬다.
 */
export const RECONNECT_JITTER = 0.3;

/**
 * `attempt` 번째 재시도까지 기다릴 시간 (ms) — **순수 함수**.
 *
 * `1000 × 2^(attempt-1)` 를 [`RECONNECT_MAX_MS`] 로 자른 뒤 ±30% 지터를 얹는다.
 * `random` 은 테스트에서 갈아 끼우기 위한 구멍이다 (기본 `Math.random`).
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  // 지수부터 자른다 — 시도 수가 커지면 2 ** n 이 Infinity 가 되어 계산이 NaN 으로 무너진다.
  const steps = Math.min(n - 1, 30);
  const base = Math.min(RECONNECT_BASE_MS * 2 ** steps, RECONNECT_MAX_MS);
  return Math.round(base * (1 + (random() * 2 - 1) * RECONNECT_JITTER));
}

/** 열린 세션 하나에 대한 손잡이. 모든 호출은 실패해도 throw 하지 않는다 */
export interface SessionHandle {
  readonly id: number;
  readonly kind: SessionKind;
  /**
   * **로컬 새 열림에서만** 채워진다 — 백엔드가 해석한 셸 id (기본 `None` 이 `pwsh`/
   * `powershell` 중 무엇으로 환원됐는지). 헤더가 "로컬" 대신 진짜 셸 이름을 띄우는 근거다.
   * SSH 열림·창 이관 재부착에서는 `undefined` 다 (그쪽은 셸 id 가 없거나 이미 알려졌다).
   */
  readonly resolvedShell?: string;
  /**
   * **tmux 호스트의 SSH 새 열림에서만** 채워진다 — 백엔드가 고른 tmux 세션 이름(`aynx-1` …).
   * 타일이 이 값을 [`PaneSpec.tmux`] 에 적어 두었다가 **재접속 때 힌트로 되돌려 준다**.
   * `resolvedShell` 과 같은 자리·같은 수명이다 (창 이관 재부착에는 없다 — 그쪽은 타일이
   * 이미 값을 들고 넘어온다).
   */
  readonly tmuxName?: string;
  /**
   * **창 이관 재부착에서만** 채워진다 — 이 손잡이의 채널로 오는 **첫 바이트**가 Rust 출력 꼬리 링
   * (`output.rs` `TailRing`)에서 갖는 오프셋 (Rust `Reattached.start`). 새 열림은 `undefined` 이고
   * 그 채널은 0 에서 시작한다. 터미널은 여기에 "콜백이 돌아온 바이트" 를 더해 다음 이관의 `consumed` 를 낸다.
   */
  readonly outputStart?: number;
  /** 세션 코어의 임대 열쇠([`SessionLease`] — 로컬·SSH). 모든 be 호출에 실린다 */
  readonly lease?: SessionLease;
  /**
   * **떨어진 세션에 붙었을 때만** (페이지 리로드 뒤 — `attachSession`) — 링 재생이 끝나는 오프셋(이 뒤는
   * 실시간)과 링을 넘쳐 잃은 바이트. 터미널은 재생 구간 동안 알림·클립보드·DSR 응답·벨을 억제하고, 잃은 바이트가
   * 있으면 "출력 일부 유실" 을 단다.
   */
  readonly replayEnd?: number;
  readonly overrunBytes?: number;
  /**
   * **떨어진 세션에 붙었을 때만**(로컬) — 붙기 전 PTY 크기, 곧 재생분이 쓰인 화면 크기(10-15). 맡긴 화면이 없으면 터미널이 이 크기로
   * 재생하고 재생 끝에서 타일 크기로 맞춘다(`$lib/term/replay-split` 의 `replayResize`).
   */
  readonly replaySize?: { cols: number; rows: number };
  /**
   * **시청자 손잡이인가**(원격 웹 R2-B — `attachSessionViewer`). 참이면 닫기 · 놓기가 시청 끝이고(세션은 닫지 않는다) 임대 표에 오르지
   * 않는다(창의 닫기 · 떠나기 · 체크포인트가 이 열쇠로 나가지 않는다).
   */
  readonly viewer?: boolean;
  /**
   * **붙기 · 시청자 붙기 답의 크기 주인**(R2-A) — 이 쪽이 지금 PTY 크기를 정하고 터미널 질의에 답하는가. 새 열림은 없다(연 쪽이 주인).
   * 그 뒤의 바뀜은 이벤트 `session-size-owner` 로 온다(`$lib/term/size-owner`).
   */
  readonly sizeOwner?: boolean;
  /** 시청자 붙기에서 — 지금 주인의 크기(주인이 아니면 이 크기로 그린다) */
  readonly ownerSize?: { cols: number; rows: number };
  /** 시청자 붙기에서 — 지금 주인이 주(집 PC 창)인가(옛 서버는 없다) */
  readonly ownerPrimary?: boolean;
  /**
   * 입력을 셸에 — `source` 는 출처(`keyboard`(기본) · `paste` · `protocol` — `$lib/term/input-source`). 세션 서버가 오케스트레이션
   * 작업자 타일의 사람 개입(잠금 · 초안)을 이것으로 가른다. 터미널 응답만 `protocol` 이다.
   */
  write(data: string, source?: InputSource): void;
  resize(cols: number, rows: number): void;
  /**
   * **크기 되찾기**(10-20 — 주인이 아닌 타일의 [이 창 크기로]) — 셸에 아무것도 쓰지 않고 이 쪽을 크기 주인으로 삼아 이 크기를 건다(서버
   * `claim_size` · 자격 규칙은 사람 입력과 같다). 주인이 됐으면 `true`, 자격이 없거나(폰) 실패면 `false`. throw 하지 않는다.
   */
  claimSize(cols: number, rows: number): Promise<boolean>;
  /**
   * 출력 역압 — 미소비 바이트가 [`HIGH_WATER`] 를 넘었을 때 소스를 세운다.
   * fire-and-forget: 명령이 아직 등록되지 않았거나 세션이 이미 죽었어도 조용히 넘어간다
   * (그 경우 역압만 없어질 뿐 데이터 경로는 그대로 동작한다).
   */
  pause(): void;
  /** [`LOW_WATER`] 아래로 내려왔을 때 소스를 재개한다 */
  resume(): void;
  /**
   * **ACK 크레딧** — 이 손잡이의 채널에서 화면에 반영한 출력 오프셋(꼬리 링 축)을 돌려준다(로컬만 — 세션 서버 ③-2).
   * 서버는 송신 − ACK 가 예산을 넘으면 생산자를 멈춘다. 로컬의 `pause`/`resume` 은 아무 일도 하지 않는다. fire-and-forget.
   */
  ack?(consumed: number): void;
  close(): Promise<void>;
  /**
   * **세션은 살려 둔 채** 이 손잡이만 놓는다 (창 이관 — docs/log/2026-09-02-tear-out.md).
   *
   * `close` 와 하는 일이 같되 백엔드 `close_*` 를 **부르지 않는다**: 종료 이벤트 구독을
   * 풀고 손잡이를 죽은 것으로 표시할 뿐이다. 탭을 다른 창으로 넘길 때 이 창의 터미널이
   * 언마운트되면서 세션까지 죽이는 것을 막는 유일한 출구다.
   */
  detach(): Promise<void>;
}

/**
 * 역압 워터마크 (xterm.js 공식 문서 권고값 — docs/verification/xterm.md).
 *
 * `pending`(= `term.write()` 에 넣었지만 파서가 아직 소비하지 않은 바이트)이
 * `HIGH_WATER` 를 넘는 순간 소스를 세우고, `LOW_WATER` 아래로 내려오면 재개한다.
 * 히스테리시스가 있어야 경계에서 pause/resume 이 진동하지 않는다.
 *
 * HIGH 를 더 키우면 처리량은 늘지만 Ctrl+C 반응이 그만큼 늦어진다 (이미 큐에 들어간
 * 바이트는 다 그려야 하므로). 공식 문서도 500KB 초과를 금한다.
 */
export const HIGH_WATER = 100_000;
export const LOW_WATER = 10_000;

/**
 * `write()` 콜백을 붙이는 간격 (바이트).
 *
 * 청크마다 콜백을 달면 버스트 한 번에 수백 개의 클로저가 파서 큐에 얹힌다.
 * xterm.js 가 권하는 최적화대로 **누적 ~50KB 마다 한 번만** 달고, 콜백이 오면
 * "직전 콜백 이후 누적분" 을 한꺼번에 차감한다 (write 는 순서를 지키므로
 * 콜백 시점에 그 앞의 바이트는 전부 파싱이 끝나 있다).
 *
 * HIGH_WATER 의 절반이라 `pending` 추정 오차도 최대 50KB — HIGH 를 넘기 전에
 * 반드시 한 번은 차감이 일어난다.
 */
export const ACK_INTERVAL = 50_000;

/**
 * **사람이 호스트 키 다이얼로그에서 고를 수 있는 것** — Rust `HostKeyDecision` 과 같은 철자다
 * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
 *
 * `"reject"` 만 백엔드로 가지 않는다 — 거부는 재시도를 하지 않는다는 뜻이라 프런트에서 끝난다.
 */
export type HostKeyDecision = "trust" | "once" | "replace" | "reject";

/** 호스트 키 확인 다이얼로그에 넘길 정보 */
export interface HostKeyPrompt {
  /** 이 접속의 이름 (설정 별칭이거나 빠른 접속의 `user@host:port`) */
  alias: string;
  fingerprint: string;
  key_type: string;
  /**
   * **기록된 키와 다른가** — `false` 면 처음 보는 키(TOFU)다.
   *
   * 이 한 칸이 다이얼로그의 제목·문구·버튼 세 벌을 통째로 가른다. 두 사건은 급이 다르다:
   * 처음 보는 키는 "이 서버를 신뢰할 것인가" 이고, 바뀐 키는 "**신뢰했던 것이 달라졌다**" 다.
   */
  changed: boolean;
  /** 바뀐 키일 때 known_hosts 에 적혀 있던 지문 (못 읽었으면 `null`) */
  oldFingerprint: string | null;
  /** 실제로 붙으려던 곳 — 별칭이 아니라 `HostName`/포트다 (`null` 이면 백엔드가 안 알려줬다) */
  host: string | null;
  port: number | null;
  /**
   * 기록 계열 선택지(수락(기록)·갱신)를 **보여도 되는가**.
   *
   * `UserKnownHostsFile none` 인 호스트는 수락해도 파일에 적히지 않는다 — 그런 호스트에
   * "갱신" 버튼을 두면 누르고도 아무 일이 없고, 다음 접속에 같은 창이 또 뜬다.
   */
  canRecord: boolean;
  /**
   * `"이번만"` 을 보여도 되는가. 공개키 설치 흐름은 `false` 다 — 그 연결은 한 번 붙었다
   * 사라지는 것이라 "기록하지 않고 통과" 에 뜻이 없다 (백엔드도 그 경로에 결정을 두 갈래로만
   * 받는다).
   */
  allowOnce: boolean;
}

/**
 * 호스트 키 확인 콜백 — 사람이 고른 것을 돌려준다.
 *
 * 예전에는 `Promise<boolean>`(수락/취소)이었다. 바뀐 키에 "이번만"·"갱신" 이 생기면서
 * 세 갈래가 되었고, 그 셋을 boolean 두 개로 쪼개면 호출부마다 조합이 달라진다.
 */
export type ConfirmHostKey = (prompt: HostKeyPrompt) => Promise<HostKeyDecision>;

/** 비밀번호 입력 모달에 넘길 정보 */
export interface PasswordPrompt {
  alias: string;
  /** Rust 가 준 사유 (키 거부 / 에이전트 없음 / 비밀번호 틀림) */
  message: string;
  /** 이번이 몇 번째 시도인지 (1부터). 모달이 "N/3" 을 보여 줄 수 있게 */
  attempt: number;
  /** 허용된 총 시도 횟수 */
  maxAttempts: number;
  /**
   * **금고에 담아 둔 비밀번호가 거부됐다** (2026-09-19 ② · docs/log/2026-09-19-vault.md).
   * 모달이 "저장된 비밀번호가 더 이상 맞지 않습니다" 를 덧붙이고 저장 체크를 미리 켠다 —
   * 사람이 새로 치면 그것이 곧 갱신이다.
   */
  storedRejected: boolean;
  /**
   * **DB 접속 모달**(쿼리 타일 7단계) — 있으면 같은 모달이 DB 비밀번호를 묻는다(문구 · 대상 줄이 DB 의 것으로 바뀌고, "이 앱에
   * 저장" 은 볼트 `db_password`(대상 = 연결 `id`)로 간다). 없으면 SSH 비밀번호(예전 그대로).
   */
  db?: DbPasswordTarget;
  /**
   * **"이 앱에 저장" 을 숨긴다** — DB 연결 폼의 [연결 테스트](`query/conn-test`)가 묻을 때. 테스트는 볼트에 아무것도 담지 않는다
   * (DB 비밀번호를 볼트에 담는 길은 쿼리 타일 접속 모달 하나). 없으면 예전 그대로(체크가 보인다).
   */
  noSave?: boolean;
}

/** DB 접속 모달이 보일 대상 — 값이 아니라 이름들이다(비밀 없음) */
export interface DbPasswordTarget {
  /** 연결 id — 볼트 열쇠 */
  id: string;
  /** 연결 이름 */
  name: string;
  /** `사용자@DB` (모르면 빈 글자) */
  who: string;
  /** 경유 호스트 별칭(`null` = 경유 없음 — 내 PC) */
  via: string | null;
}

/**
 * 비밀번호 입력 콜백 — 입력값, 취소면 `null`.
 * 돌려준 문자열은 invoke 한 번에만 쓰이고 곧바로 버려진다 (앱은 저장하지 않는다).
 */
export type PromptPassword = (prompt: PasswordPrompt) => Promise<string | null>;

/** 비밀번호 재시도 상한 — 틀린 값으로 서버의 인증 시도 한도를 태우지 않게 막는다 */
export const MAX_PASSWORD_ATTEMPTS = 3;

/**
 * **개인키 파일의 암호구를 묻는다** (docs/log/2026-09-19-identity-file-auth.md).
 *
 * 비밀번호 모달과 모양이 같지만 대상이 다르다 — 저쪽은 **서버의** 비밀번호이고 이쪽은
 * **내 디스크의 키 파일**이다. 그래서 모달이 말하는 것도 호스트가 아니라 파일 이름이다.
 *
 * `path` 는 백엔드가 준 **전체 경로 그대로**다: 재시도에서 `passphraseFor` 로 되돌려 주어야
 * 백엔드가 "어느 후보의 암호구인가" 를 가릴 수 있다 (홉을 가리지 않는 유일한 이름이다).
 * 화면에 띄우는 것은 그 파일 이름뿐이다.
 */
export interface PassphrasePrompt {
  /** 전체 경로 — 재시도의 열쇠. 화면은 파일 이름만 보여 준다 */
  path: string;
  /** 짝이 되는 `.pub` 에서 읽은 지문 (없으면 `null`) — 모달이 곁말로 띄운다 */
  fingerprint: string | null;
  /** 방금 넣은 암호구가 틀렸다 */
  wrong: boolean;
  /**
   * **금고에 담아 둔 암호구로 열리지 않았다** ([`wrong`] 과 다르다 — 저쪽은 사람이 방금
   * 친 것이 틀렸다는 뜻이고, 이쪽에서는 아직 아무것도 치지 않았다).
   */
  storedRejected: boolean;
  attempt: number;
  maxAttempts: number;
  /** "이 앱에 저장" 을 숨긴다 — [`PasswordPrompt.noSave`] 와 같은 뜻(DB 연결 폼의 [연결 테스트] 가 경유 SSH 관문에서) */
  noSave?: boolean;
}

/**
 * 암호구 입력 콜백 — 입력값, 취소면 `null` (비밀번호 콜백과 **같은 모양**이다).
 *
 * 돌려준 문자열은 invoke 한 번에만 쓰이고 곧바로 버려진다. 사용자가 "이 앱에 저장" 을
 * 켰다면 그 값을 **금고에 담는 것은 프런트**이고(`app/prompts` 의 `flushVaultSaves`),
 * 이 함수의 계약에는 그 사실이 실리지 않는다 — 세션 열기는 담는 일을 알 필요가 없다.
 */
export type PromptPassphrase = (prompt: PassphrasePrompt) => Promise<string | null>;

/** 암호구 재시도 상한 — **키 파일 하나당** 센다 (후보가 여럿일 수 있다) */
export const MAX_PASSPHRASE_ATTEMPTS = 3;

/**
 * **접속이 왜 실패했는가** — Rust `ssh::OpenCause` 와 글자까지 같은 표
 * (docs/log/2026-09-17-connect-diagnostics.md).
 *
 * `kind` 는 "프런트가 무엇을 해야 하는가"(모달·재시도·끝)이고, 이쪽은 "무엇이 잘못됐는가"다.
 * 둘은 **직교한다** — 같은 `other` 안에 DNS·닫힌 포트·SSH 아닌 포트가 섞여 있어서, 화면이
 * 할 수 있는 말이 러시의 영문 한 줄뿐이던 자리를 이 축이 연다.
 */
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

/** 진단 한 벌. `jump`·`inner` 는 경유 호스트 쪽 실패에서만 채워진다 */
export interface OpenDiag {
  cause: OpenCause;
  /** 경유 호스트 별칭 (`cause === "jump"` 일 때만) */
  jump?: string;
  /** 경유 쪽에서 실제로 난 사유 (`cause === "jump"` 일 때만) */
  inner?: OpenCause;
  /**
   * 그 홉이 `IdentitiesOnly yes` 였다 — **지정한 키만** 내고 거절당했다.
   * 사유는 그대로이고 힌트 끝에 한 마디가 붙는다 (`openErrorHint`).
   */
  identitiesOnly?: boolean;
}

/** 표 하나 — 모르는 코드를 걸러 내는 유일한 기준 (Rust `OpenCause` 와 같은 글자) */
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
      /** 실제로 붙으려던 곳 (옛 백엔드·다른 경로에서 오면 `null`) */
      host: string | null;
      port: number | null;
      /** `UserKnownHostsFile none` — 수락해도 기록되지 않는다 */
      noStore: boolean;
      /** `host_key_changed` 에서만 채워진다 — 기록돼 있던 키의 지문 */
      oldFingerprint: string | null;
    }
  | {
      kind: "password_required" | "auth" | "other";
      message: string;
      /** 옛 백엔드·프런트가 스스로 만든 실패에는 없다 */
      diag?: OpenDiag;
      /** 금고에 담아 둔 비밀번호가 거부됐다 (`password_required` 에서만 뜻이 있다) */
      storedRejected?: boolean;
    }
  | {
      /**
       * 개인키 파일이 잠겨 있다 — 호스트 키와 같은 **다이얼로그 계약**이라 `message` 도
       * `diag` 도 없다(화면이 그릴 글자는 전부 사전이 만든다).
       */
      kind: "passphrase_required";
      /** 전체 경로 — 재시도의 `passphraseFor` 로 그대로 돌아간다 */
      path: string;
      fingerprint: string | null;
      /** 방금 넣은 것이 틀렸다 */
      wrong: boolean;
      /** 금고에 담아 둔 암호구로 열리지 않았다 */
      storedRejected: boolean;
    }
  | { kind: "cancelled" }
  | { kind: "password_cancelled" }
  | { kind: "passphrase_cancelled" };

export interface OpenOptions {
  /** PTY 출력 콜백 — Rust 가 모아 보낸 바이트 덩어리를 그대로 받는다 */
  onData: (data: ArrayBuffer) => void;
  cols: number;
  rows: number;
  /** SSH 전용: 미등록 호스트 키를 만났을 때의 확인 콜백 */
  confirmHostKey?: ConfirmHostKey;
  /** SSH 전용: 서버가 비밀번호를 요구할 때의 입력 콜백 */
  promptPassword?: PromptPassword;
  /** SSH 전용: 개인키 파일에 암호구가 걸려 있을 때의 입력 콜백 */
  promptPassphrase?: PromptPassphrase;
  /**
   * 세션이 원격에서 끝났을 때 (ssh-exit). `reason.kind` 로 정상 종료와 끊김을 가른다 —
   * 호출부(Terminal.svelte)는 후자에서만 자동 재연결을 돌린다.
   */
  onExit?: (reason: SessionExitReason) => void;
  /**
   * **SSH 전용 · 첫 접속에만** — 원격 프로젝트 타일의 시작 폴더와 시작 명령
   * (docs/log/2026-09-24-projects.md). 실어 보내는 것은 `Terminal.svelte` 의 첫 열기 하나이고
   * (재연결은 싣지 않는다 — 1회용), 한 줄로 조립하는 것은 Rust 다(`ssh::project_start_line`).
   */
  start?: {
    cwd: string;
    command: string | null;
    /**
     * 새 워크트리에서 열기 — 먼저 만들 저장소·이름과 그 타일의 **표**(`ticket` — 준비 이벤트 `ssh-worktree-prep` 와 답
     * `ssh_worktree_answer` 가 이 글자로 타일을 가리킨다. Rust `ssh::SshWorktree`)
     */
    worktree?: { repo: string; name: string; ticket: string } | null;
    /** 설정 스크립트 — 프로젝트 id 와 끝 신호 값 (Rust `ssh::SshSetup` — 스크립트 글자는 싣지 않는다) */
    setup?: { projectId: string; nonce: string } | null;
  };
}
