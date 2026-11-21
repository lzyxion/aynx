/** 세션 행 조립 + 4상태 합성 — `.svelte.ts` 는 node vitest 에서 못 읽어 테스트할 로직을 여기로 내린다 */

/** `shell-integration.ts` 의 `PaneStatus | null` 과 같은 값 — 그 모듈은 xterm 을 값으로 들여와 node 에서 못 읽어 import 하지 않는다 */
export type RawStatus = "running" | "ok" | "fail" | null;

export type ConsoleState = "working" | "idle" | "fail" | "disconnected";

export interface ConsoleRowInput {
  /** `pane.historyStreamId ?? pane.id` — 위치가 바뀌어도 안 튀는 안정 신원이라 `#each` 키로 쓴다 */
  streamId: string;
  tabId: string;
  paneId: string;
  /** 안 본 결과(그 패널의 sticky 값) */
  attention: RawStatus;
  code: string;
  label: string;
  status: RawStatus;
  connected: boolean;
  lastCommand: string | null;
  /** 아직 실행 중이면 `null` */
  exit: number | null;

  // ── 호스트별 묶음이 읽는 칸 — 전부 선택 ──

  /** 없으면 `"local"` 로 본다 */
  kind?: "ssh" | "local";
  /** `~/.ssh/config` 별칭 — 빠른 접속 · 로컬은 `null` */
  alias?: string | null;
  /** 빠른 접속 타일의 표시 이름(`user@host:port`) — 그 타일의 묶음 키다 */
  adhoc?: string | null;
  /** AI 에게 보이는가 — 없으면 `false` */
  shared?: boolean;
  connectedAt?: number | null;
  /** 마지막 블록의 끝(아직 도는 중이면 시작) 시각 */
  lastActivityAt?: number | null;
}

export interface ConsoleRow extends ConsoleRowInput {
  state: ConsoleState;
  commandShort: string;
}

export const COMMAND_MAX = 48;

/** 끊김을 먼저 본다 — 세션이 없으면 남아 있는 `running` 은 연결이 끊기기 전의 낡은 값이다 */
export function synthState(status: RawStatus, connected: boolean): ConsoleState {
  if (!connected) return "disconnected";
  if (status === "running") return "working";
  if (status === "fail") return "fail";
  return "idle";
}

export function shortenCommand(cmd: string | null, max = COMMAND_MAX): string {
  if (!cmd) return "";
  const collapsed = cmd.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/** 순서는 입력 그대로 — 부르는 쪽이 화면에서 읽는 순서로 넘긴다 */
export function buildRows(inputs: readonly ConsoleRowInput[]): ConsoleRow[] {
  return inputs.map((input) => ({
    ...input,
    state: synthState(input.status, input.connected),
    commandShort: shortenCommand(input.lastCommand),
  }));
}
