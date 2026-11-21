/** 헤드리스 위임 세션의 행 조립 + 주의-우선 정렬 — 4상태 합성 · 명령 자르기는 `console-rows.ts` 것을 쓴다(창 행과 갈라지지 않게) */

import { type ConsoleState, shortenCommand, synthState } from "./console-rows";

export type { ConsoleState };

/**
 * `unconnected` = 한 번도 붙은 적 없는 위임 대상 · `disconnected` = 살아 있다가 떨어진 세션 · `orphan` = 미접속인데 별칭이
 * `~/.ssh/config` 에 없다(호스트 이름을 바꾸면 `delegation.toml` 의 옛 별칭이 남는다 — 붙을 수 없는 줄은 다르게 보여야 한다).
 */
export type DelegationState = ConsoleState | "unconnected" | "orphan";

/** `list_console_sessions`(Rust `enrich_sessions`)의 camelCase 계약 그대로 */
export interface ConsoleSession {
  /** 거울 streamId — 위임 대상은 `"delegated:<alias>"` 로 시작한다 */
  id: string;
  code: string;
  label: string;
  kind: string;
  /** 헤드리스 위임 세션은 셸이 없어 언제나 `null` */
  status: RawStatusLike;
  running: boolean;
  lastExit: number | null;
  commands: number;
  connected: boolean;
  /** 살아 있던 헤드리스 세션이 떨어졌다 — `!connected` 중 붙은 적 없는 발견 항목과 가르는 값 */
  dropped: boolean;
  lastCommand: string | null;
  /**
   * 백엔드가 설정을 못 읽었을 때도 `true` 다("모른다" 를 고아로 칠하지 않는다). 없으면(옛 백엔드) 고아 판정이 돌지 않는다.
   */
  aliasKnown?: boolean;

  // ── 호스트별 묶음이 읽는 칸 — 옛 백엔드가 안 보내도 "모른다" 로 그리게 전부 선택 ──

  user?: string | null;
  connectedAt?: number | null;
  lastActivityAt?: number | null;
  /** 헤드리스 세션은 창이 없어 `null` */
  windowLabel?: string | null;
}

/** Rust 가 임의 문자열을 낼 수 있어 넓게 받는다 — 모르는 값은 유휴로 떨어진다 */
type RawStatusLike = "running" | "ok" | "fail" | string | null;

export interface DelegationRow {
  id: string;
  code: string;
  label: string;
  state: DelegationState;
  commandShort: string;
  command: string;
  exit: number | null;
  connected: boolean;
  commands: number;
}

/** 고아가 맨 뒤다 — 급해서가 아니라 붙을 수 없어서다 */
const STATE_RANK: Record<DelegationState, number> = {
  fail: 0,
  working: 1,
  idle: 2,
  disconnected: 3,
  unconnected: 4,
  orphan: 5,
};

/**
 * 헤드리스 세션은 셸이 없어 스스로 `running` 을 보고하지 못한다 — 작업중은 실행 중 작업안의 대상(`runningTargets`)에서 온다.
 */
export function delegationRows(
  sessions: readonly ConsoleSession[],
  runningTargets: ReadonlySet<string>,
  commandByTarget?: ReadonlyMap<string, string>,
): DelegationRow[] {
  const rows = sessions.map((s): DelegationRow => {
    // `dropped` 가 `!connected` 보다 먼저다 — 붙은 적 없는 미접속과 가른다
    const state: DelegationState = s.dropped
      ? "disconnected"
      : !s.connected
        ? // `=== false` 로 못 박는다 — 옛 백엔드는 이 칸을 안 보낸다(`undefined` = 고아 판정 없음)
          s.aliasKnown === false
          ? "orphan"
          : "unconnected"
        : runningTargets.has(s.id)
          ? "working"
          : synthState(normalizeStatus(s.status), s.connected);

    const opCommand = state === "working" ? commandByTarget?.get(s.id) : undefined;
    const command = opCommand ?? s.lastCommand ?? "";

    return {
      id: s.id,
      code: s.code,
      label: s.label,
      state,
      commandShort: shortenCommand(command),
      command,
      exit: s.lastExit,
      connected: s.connected,
      commands: s.commands,
    };
  });

  rows.sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  return rows;
}

function normalizeStatus(status: RawStatusLike): "running" | "ok" | "fail" | null {
  return status === "running" || status === "ok" || status === "fail" ? status : null;
}

export function delegationSummary(rows: readonly DelegationRow[]): {
  total: number;
  connected: number;
  working: number;
  fail: number;
} {
  let connected = 0;
  let working = 0;
  let fail = 0;
  for (const r of rows) {
    if (r.connected) connected += 1;
    if (r.state === "working") working += 1;
    if (r.state === "fail") fail += 1;
  }
  return { total: rows.length, connected, working, fail };
}
