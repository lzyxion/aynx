/**
 * 관리뷰(관제판)의 **행 조립 + 4상태 합성** — 순수 모듈
 * (docs/log/2026-09-09-management-view.md).
 *
 * `.svelte.ts`(룬 모듈)는 node vitest 에서 못 읽는다 — 러너가 `environment: "node"` 라
 * svelte 컴파일러가 없다 (`vitest.config.ts` 주석 · `$lib/dock` 이 같은 이유로 갈라져 있다).
 * 그래서 **테스트할 수 있는 로직은 전부 여기로 내린다**: 컴포넌트(`Console.svelte`)는 세션·
 * 블록 레지스트리에서 값만 꺼내 이 함수들에 넘기고, 이 모듈은 반응형도 DOM 도 세션도 알지
 * 못한다.
 *
 * 상태 축은 둘이다 — 셸 통합이 보고한 **원 상태**(`running|ok|fail|null`)와 백엔드 세션이
 * 붙어 있는가(**연결**). 관제판이 보여 주는 4상태는 그 둘의 합성이고, 합성 규칙이 한
 * 함수([`synthState`])에 모여 있어 리뷰 때 조정하기 쉽다.
 */

/**
 * 셸 통합이 보고하는 **원 상태** — `shell-integration.ts` 의 `PaneStatus | null` 과 같은 값.
 *
 * 그 타입을 import 하지 않는 이유: 저 모듈은 xterm 을 값으로 들여와 node 에서 못 읽는다.
 * 여기서 필요한 것은 문자열 넷뿐이라 구조가 같은 지역 타입으로 둔다 (컴포넌트가 넘기는
 * `PaneStatus` 값이 그대로 맞물린다).
 */
export type RawStatus = "running" | "ok" | "fail" | null;

/** 관제판이 보여 주는 **4상태** — 원 상태 + 연결 여부의 합성 결과 */
export type ConsoleState = "working" | "idle" | "fail" | "disconnected";

/** 한 타일에서 읽어 온 재료 (컴포넌트가 레지스트리에서 꺼내 채운다) */
export interface ConsoleRowInput {
  /**
   * 행 키 = `pane.historyStreamId ?? pane.id`. **위치가 바뀌어도 행이 안 튀는** 안정 신원이라
   * `#each` 의 키로 쓴다 (타일을 옮기거나 확장해도 그 행이 제자리에 남는다).
   */
  streamId: string;
  /** 이 타일이 속한 **탭 id** — 행을 클릭하면 `focusTile(tabId, paneId)` 로 점프한다 */
  tabId: string;
  /** 저장소 키(=`pane.id`) — 클릭 점프의 대상 패널 */
  paneId: string;
  /**
   * **안 본 결과** (그 패널의 sticky 값). 비활성 탭에서 명령이 끝났으면 `ok`·`fail`, 없으면
   * `null`. **순수하게 주입받는다** — 이 모듈은 `app/tabs` 를 import 하지 않고, 컴포넌트가
   * `stickyOf(paneId)` 로 읽어 넘긴다. 관제판이 이걸로 **세션 단위 주의 배지**를 켠다.
   */
  attention: RawStatus;
  /** 헤더에 박히는 짧은 신원 (`p2`·`t7·p2` — `tileCode`) */
  code: string;
  /** 사람이 읽는 이름 (`paneName`) */
  label: string;
  /** 셸 통합의 원 상태 */
  status: RawStatus;
  /** 백엔드 세션이 붙어 있는가 (`sessionOf(paneId) !== null`) */
  connected: boolean;
  /** 마지막 명령문 (없으면 `null`) */
  lastCommand: string | null;
  /** 마지막 완료 명령의 종료 코드 (없거나 아직 실행 중이면 `null`) */
  exit: number | null;

  // ---------------------------------------------------------------------------
  // **호스트별 묶음**(목록 모드)이 읽는 칸들 — 전부 **선택**이다
  // (docs/log/2026-09-21-console-host-groups.md).
  //
  // 선택으로 둔 이유: 4상태 합성 · 자르기(`buildRows`)는 아래 칸을 하나도 안 쓴다(옛 비교 보기도
  // 그랬다 — 2026-10-25 걷음). 필수로 만들면 이 모듈의 기존 테스트와 호출부가 뜻 없는 값을 채우게
  // 된다. 빠졌을 때의 기본값은 칸마다 적는다.
  // ---------------------------------------------------------------------------

  /** 세션 종류 — 호스트 머리줄과 행의 '종류' 칸을 가른다. 없으면 `"local"` 로 본다 */
  kind?: "ssh" | "local";
  /** `~/.ssh/config` 별칭 — 그 별칭으로 붙은 SSH 타일만. 빠른 접속·로컬은 `null` */
  alias?: string | null;
  /** 빠른 접속 타일의 표시 이름(`user@host:port`) — 그 타일의 묶음 키다. 아니면 `null` */
  adhoc?: string | null;
  /** 이 타일이 **AI 에게 보이는가**(공유 토글). 없으면 `false` */
  shared?: boolean;
  /** 세션이 붙은 시각(epoch ms) — 모르면 `null` */
  connectedAt?: number | null;
  /** 마지막 블록의 끝(아직 도는 중이면 시작) 시각(epoch ms) — 없으면 `null` */
  lastActivityAt?: number | null;
}

/** 조립된 한 행 — 재료에 합성 상태와 잘린 명령문을 더한 것 */
export interface ConsoleRow extends ConsoleRowInput {
  state: ConsoleState;
  /** 표 한 칸에 맞게 자른 명령문 (공백 접힘 · 끝을 …로) */
  commandShort: string;
}

/** 명령문 표시 상한 (자를 길이) */
export const COMMAND_MAX = 48;

/**
 * 원 상태 + 연결 여부 → **4상태**. 순수 함수라 규칙 조정이 여기 한 곳이다.
 *
 * 판정 순서(먼저 맞는 것이 이긴다):
 *  1. **끊김** — 세션이 없다(`!connected`). 세션이 없으면 "작업 중" 일 수 없다 — 남아 있는
 *     `running` 은 연결이 끊기기 전의 **낡은 값**이다. 그래서 연결을 가장 먼저 본다.
 *  2. **작업중** — `running` (그리고 연결돼 있다).
 *  3. **실패** — `fail` (마지막 명령이 0 아닌 코드로 끝났다).
 *  4. **유휴** — 그 밖(`ok`·`null`, 세션은 붙어 있음).
 *
 * 연결·유휴를 유휴 하나로 합치는 결정이 이 함수뿐이라, 나중에 다섯째 상태(예: "연결됨 ·
 * 133 없음")가 필요하면 여기만 고친다.
 */
export function synthState(status: RawStatus, connected: boolean): ConsoleState {
  if (!connected) return "disconnected";
  if (status === "running") return "working";
  if (status === "fail") return "fail";
  return "idle";
}

/**
 * 명령문을 표 한 칸에 맞게 자른다 — 공백(개행 포함)을 한 칸으로 접고, [`max`] 를 넘으면
 * 끝을 `…` 로. `null`·빈 문자열은 빈 문자열. 순수 함수.
 */
export function shortenCommand(cmd: string | null, max = COMMAND_MAX): string {
  if (!cmd) return "";
  const collapsed = cmd.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * 재료 목록 → 행 목록 (상태 합성 · 명령 자르기). 순서는 **입력 그대로** 다 — 컴포넌트가
 * 화면에서 읽는 순서(탭 순서 · 타일 왼쪽·위 우선)로 넘겨 준다.
 */
export function buildRows(inputs: readonly ConsoleRowInput[]): ConsoleRow[] {
  return inputs.map((input) => ({
    ...input,
    state: synthState(input.status, input.connected),
    commandShort: shortenCommand(input.lastCommand),
  }));
}
