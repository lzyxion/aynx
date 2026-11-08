/**
 * 관제판(관리뷰) **위임 로스터** — 헤드리스 위임 세션의 행 조립 + 주의-우선 정렬 (A3b-1).
 *
 * `console-rows.ts` 와 **같은 규칙의 순수 모듈**이다 — 룬도 DOM 도 `invoke` 도 없다(그래서
 * node vitest 로 바로 테스트한다). 컴포넌트(`Console.svelte`)가 `list_console_sessions` 폴링
 * 결과와 "지금 실행 중 작업안의 대상" 을 넘겨 주면, 여기서 4상태를 합성하고 주의가 필요한
 * 순서로 정렬한다.
 *
 * 창 타일 행(`console-rows.ts`)과 **다른 스코프**다: 저건 이 창의 타일에서만 오고, 이건 앱
 * 전역 세션 뷰(공유 창 세션 + 위임 대상 — 접속·미접속 모두)에서 온다. 헤드리스 세션은 셸이 없어
 * `status` 가 늘 `null` 이라, 유휴/작업중/실패는 **연결 여부 + 실행 중 작업안**으로 정한다.
 *
 * 4상태 합성 규칙과 명령 자르기는 `console-rows.ts` 것을 **재사용**한다(중복 금지) — 규칙이
 * 한 곳에 모여 있어야 창 행과 위임 행이 갈라지지 않는다.
 */

import { type ConsoleState, shortenCommand, synthState } from "./console-rows";

export type { ConsoleState };

/**
 * 위임 로스터 전용 상태 — 창 행의 [`ConsoleState`](넷)에 **`"unconnected"`(미접속)** 하나를
 * 더한 것이다. `ConsoleState` 를 넓히지 않는 이유: 그 타입은 창 타일 행과 공유하는데, 창
 * 세션에는 "미접속(붙은 적 없음)" 개념이 없다(타일은 열리는 순간 세션을 만든다). 미접속은
 * **위임 대상에만** 있는 상태라 여기서만 확장한다.
 *
 * - **미접속(unconnected)** — 지금 붙어 있지 않은 위임 대상. `list_console_sessions` 가
 *   `~/.ssh/config` 별칭을 발견 항목으로 실어 온 것이고, **한 번도 연결된 적이 없다**.
 * - **끊김(disconnected)** — 살아 있다가 **떨어진** 세션. (`ConsoleState` 에서 물려받는다.)
 * - **설정에 없음(orphan)** — 미접속인데 그 별칭이 `~/.ssh/config` 에 **없다**
 *   (`aliasKnown === false`). 호스트 이름을 바꾸면 `delegation.toml` 의 옛 별칭이 그대로 남는데,
 *   그 줄은 영원히 "미접속" 으로 보이면서 사람에게 "언젠가 붙겠지" 를 말한다 — 실제로 난
 *   일이다(`Remote-SSH` → `SSH`). 붙을 수 없는 줄은 붙을 수 있는 줄과 **다르게** 보여야 한다
 *   (docs/log/2026-09-21-fleet-delegation-ui.md).
 */
export type DelegationState = ConsoleState | "unconnected" | "orphan";

/**
 * `list_console_sessions`(Rust `enrich_sessions`)가 내는 객체 하나. camelCase 계약 그대로다.
 * 라이브 거울 세션과 미접속 위임 대상을 함께 담는다 — 위임 대상은 셸이 없어 `status` 가 `null`,
 * 미접속이면 `lastCommand` 도 `null`.
 */
export interface ConsoleSession {
  /** 세션 신원 = 거울 streamId. 위임 대상은 `"delegated:<alias>"` 로 시작한다. `#each` 키·정렬 tie-break. */
  id: string;
  /** 짧은 표시용 코드(창 세션은 `p2`·`t7·p2`, 헤드리스는 alias) */
  code: string;
  /** 사람이 읽는 이름 */
  label: string;
  /** 세션 종류(`ssh`·`local`) */
  kind: string;
  /** 셸 통합의 원 상태 — 헤드리스 위임 세션은 셸이 없어 언제나 `null` */
  status: RawStatusLike;
  /** 지금 명령이 실행 중인가(거울 보고 기준) */
  running: boolean;
  /** 마지막 완료 명령의 종료 코드(없거나 실행 중이면 `null`) */
  lastExit: number | null;
  /** 이 세션에 쌓인 이력 블록 수(0 이면 물어볼 것이 없다) */
  commands: number;
  /** 지금 백엔드 세션이 붙어 있는가(미접속 위임 발견 항목·떨어진 헤드리스 세션은 `false`) */
  connected: boolean;
  /**
   * 살아 있던 헤드리스 세션이 **떨어졌는가**(끊김). `!connected` 중에서 **붙은 적 없는**(미접속)
   * 발견 항목과 가르는 값이다 — Rust `enrich_sessions` 가 거울의 `disconnected` 를 실어 온다.
   * 창 세션·미접속 발견 항목은 언제나 `false`.
   */
  dropped: boolean;
  /** 마지막 명령문(없으면 `null`) */
  lastCommand: string | null;
  /**
   * 이 별칭이 아직 `~/.ssh/config` 에 **있는가** — 미접속 발견 항목을 `미접속`과
   * `설정에 없음`(고아)으로 가르는 유일한 값이다 (Rust `enrich_sessions`).
   *
   * 라이브 항목은 언제나 `true` 이고, 백엔드가 설정을 못 읽었을 때도 `true` 다
   * ("모른다" 를 고아로 칠하지 않는다). **없으면**(옛 백엔드) `undefined` 라 고아 판정이
   * 아예 돌지 않는다 — 오늘의 화면과 같다.
   */
  aliasKnown?: boolean;

  // ---------------------------------------------------------------------------
  // **호스트별 묶음**(목록 모드)이 읽는 네 칸 — Rust `enrich_sessions` 가 2026-09-21 에
  // 더했다 (docs/log/2026-09-21-console-host-groups.md). `aliasKnown` 과 같은 이유로 전부
  // 선택이다: 옛 백엔드가 이 칸을 안 보내도 화면은 "모른다" 로 그려야 한다.
  // ---------------------------------------------------------------------------

  /** 어느 계정으로 붙어 있는가 (로컬 셸·모르는 별칭은 `null`) */
  user?: string | null;
  /** 붙은 시각(epoch ms) — 아직 안 붙었거나 모르면 `null` */
  connectedAt?: number | null;
  /** 마지막 블록의 끝(또는 시작) 시각(epoch ms) — 없으면 `null` */
  lastActivityAt?: number | null;
  /**
   * 이 세션을 소유한 **창 라벨** — 헤드리스 세션은 창이 없어 `null` 이다.
   * 관제판이 "이 창" 과 "다른 창" 을 가르는 유일한 값이고, 다른 창의 줄에는 점프가 없다.
   */
  windowLabel?: string | null;
}

/**
 * `status` 는 `console-rows.ts` 의 `RawStatus` 와 같은 값(`running|ok|fail|null`)이지만, Rust 가
 * 셸 통합이 붙은 세션이면 임의 문자열을 낼 수 있어 방어적으로 넓게 받는다 — `synthState` 는
 * 아는 값만 반응하고 나머지는 유휴로 떨어뜨린다.
 */
type RawStatusLike = "running" | "ok" | "fail" | string | null;

/** 조립된 위임 행 하나 — 재료에 합성 상태·잘린 명령문을 더한 것 */
export interface DelegationRow {
  id: string;
  code: string;
  label: string;
  /** 상태 — 아래 [`delegationRows`] 규칙으로 합성 (창 4상태 + 위임 전용 `미접속`) */
  state: DelegationState;
  /** 표 한 칸에 맞게 자른 명령문(`commandShort`) */
  commandShort: string;
  /** 자르기 전 원문(툴팁용, 없으면 빈 문자열) */
  command: string;
  /** 마지막 완료 종료 코드(없으면 `null`) */
  exit: number | null;
  connected: boolean;
  commands: number;
}

/**
 * 주의-우선 정렬 순위 — 낮을수록 위로. `미접속`은 뒤쪽이다: 붙은 적 없이 조용한 대상이라
 * 가장 덜 급하다(떨어진 `끊김`보다도 뒤). 물어볼 것이 있는 실패·작업중이 늘 위로 온다.
 *
 * **`설정에 없음`(고아)이 맨 뒤다.** 급해서가 아니라 **붙을 수 없어서**다 — 살아 있는 헤드리스 세션을
 * 보러 온 사람의 눈앞에서 가리킬 것 없는 줄이 자리를 차지하면 안 된다. 치울 거리는 맞지만
 * 그것은 호스트 폼에서 할 일이고, 여기서는 목록의 바닥에 조용히 모인다.
 */
const STATE_RANK: Record<DelegationState, number> = {
  fail: 0,
  working: 1,
  idle: 2,
  disconnected: 3,
  unconnected: 4,
  orphan: 5,
};

/**
 * 헤드리스 세션 목록 → 행 목록(상태 합성 · 명령 선택 · 주의-우선 정렬). **순수 함수**.
 *
 * ## 상태 합성 (먼저 맞는 것이 이긴다)
 *  1. **끊김** — 살아 있다가 떨어진 헤드리스 세션(`dropped`). 거울 항목은 남아 있으되 전송로가
 *     끊겨(네트워크 손실·keepalive) `connect_delegated` 의 종료 훅이 표시한 것이다. **붙은 적 없는**
 *     미접속과 갈리는 첫 갈래다(그래서 `!connected` 보다 앞이다).
 *  2. **설정에 없음(고아)** — 안 붙어 있는데 그 별칭이 `~/.ssh/config` 에 없다
 *     (`aliasKnown === false`). 미접속의 **부분집합**이라 그 앞에 선다 — 둘 다 `!connected`
 *     이지만 이쪽은 **붙을 수 있는 날이 오지 않는다**.
 *  3. **미접속** — 세션이 안 붙어 있다(`!connected`, `dropped` 아님). `list_console_sessions` 가
 *     실어 온 위임 발견 항목이 여기 든다 — **끊김(떨어짐)이 아니라 애초에 붙은 적 없음**이다.
 *  4. **작업중** — [`runningTargets`] 에 있다(지금 실행 중 작업안의 대상). 헤드리스 세션은 셸이 없어
 *     스스로 "running" 을 보고하지 못하므로, "지금 뭔가 돌고 있다" 는 **작업안**에서 온다.
 *  5. 그 밖은 [`synthState`] 로 떨어진다(헤드리스 `null` → 유휴, 혹시 거울이 보고한
 *     `fail`/`running` 이 있으면 그대로 살린다 — 규칙이 창 행과 한 곳이라 자동으로 맞는다).
 *
 * ## 헤드리스 SSH 드롭 감지 (SessionLifecycle)
 * `connect_delegated` 는 이제 종료 훅을 배선한다 — 헤드리스 전송이 도중에 끊기면 백엔드가 거울을
 * `disconnected` 로 표시하고 라우팅을 지운다. `enrich_sessions` 가 그것을 `dropped:true`·
 * `connected:false` 로 실어 오므로, 위 규칙 1 이 그 세션을 **`끊김`**(붙은 적 없는 `미접속`과
 * 구별)으로 낸다. 다음 실행이 A2b 자동 재연결하면 `report_delegated` 이 깃발을 내려 다시 유휴로 돌아온다.
 *
 * [`runningTargets`] 는 상태가 `running`/`approved` 인 작업안들의 대상 id 집합이다(컴포넌트가
 * `listOperations` 에서 만든다).
 *
 * ## 명령문 선택
 * 작업중이면 지금 도는 작업안의 명령을 보여 준다([`commandByTarget`]: 대상 id → 명령문). 없으면
 * (또는 작업중이 아니면) `lastCommand`. 모듈을 순수하게 두려고 맵을 주입받는다.
 *
 * ## 정렬 (주의-우선)
 * `fail → working → idle → disconnected → unconnected → orphan`, 동순위는 `label` → `id` 로
 * tie-break. **안정 정렬**. (`설정에 없음`이 맨 뒤 — [`STATE_RANK`] 주석 참고.)
 */
export function delegationRows(
  sessions: readonly ConsoleSession[],
  runningTargets: ReadonlySet<string>,
  commandByTarget?: ReadonlyMap<string, string>,
): DelegationRow[] {
  const rows = sessions.map((s): DelegationRow => {
    // `dropped` → **끊김**(떨어짐)이 먼저 — `!connected` 중 붙은 적 없는 **미접속**과 가른다.
    // 나머지 연결된 세션은 창 행과 같은 [`synthState`] 로 떨어진다(working/idle/fail).
    const state: DelegationState = s.dropped
      ? "disconnected"
      : !s.connected
        ? // 붙은 적 없는 줄 안에서 **가리킬 것이 있는가**로 한 번 더 갈린다.
          // `=== false` 로 못 박는다: 옛 백엔드는 이 칸을 아예 안 보내고(`undefined`),
          // 그때의 화면은 오늘과 같아야 한다(고아 판정 없음).
          s.aliasKnown === false
          ? "orphan"
          : "unconnected"
        : runningTargets.has(s.id)
          ? "working"
          : synthState(normalizeStatus(s.status), s.connected);

    // 작업중이면 도는 작업안의 명령이 우선(없으면 lastCommand 로 폴백).
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

  // 주의-우선. `Array.prototype.sort` 는 안정 정렬이라 동순위는 입력 순서를 지킨 뒤 label·id 로 가른다.
  rows.sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  return rows;
}

/**
 * `synthState` 는 `RawStatus`(넷)만 받으므로, Rust 가 낼 수 있는 임의 문자열을 아는 값으로
 * 좁힌다 — 모르는 값은 `null`(유휴)로 떨어뜨린다(헤드리스 세션은 애초에 `null` 이다).
 */
function normalizeStatus(status: RawStatusLike): "running" | "ok" | "fail" | null {
  return status === "running" || status === "ok" || status === "fail" ? status : null;
}

/** 위임 요약 — 로스터 위 한 줄 띠에 쓴다(총계·접속·작업중·실패 수). 순수 함수. */
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
