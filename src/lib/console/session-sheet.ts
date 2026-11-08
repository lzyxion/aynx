/**
 * **세션 시트의 세 묶음** — 타일 캔버스 위쪽에서 내려오는 세션 목록 판(2026-10-07 — 전체 화면 대시보드의 세션 칸을 옮겨 왔다).
 *
 * 시트는 "지금 나를 기다리는 게 뭐지?" 를 먼저 답하는 자리라, 타일을 호스트로 묶지 않고 **무게 순서**로 셋으로 나눈다:
 *
 * 1. **기다리는 것**(`waiting`) — AI 타일의 권한 대기 · 입력 대기(카드 상태 `input`)와 마지막 명령이 실패한 타일(`fail`).
 * 2. **오래 도는 것**(`long`) — 도는 중(`running`)인데 [`LONG_RUNNING_MS`] 를 넘긴 것. 시작 시각은 **이미 있는 값**만
 *    쓴다: AI 타일은 지금 턴의 시작(`agentTime.kind === "turn"`), 셸 타일은 지금 블록의 시작(도는 중이면 카드의
 *    `since` 가 그 블록의 시작이다 — `windowRows` 의 `lastActivityAt`). 모르면 이 묶음에 들지 않는다.
 * 3. **조용함**(`quiet`) — 나머지(유휴 · 끊김 · 짧게 도는 중). 접지 않고 다른 묶음처럼 카드로 펼쳐 보인다.
 *
 * 각 묶음 안에서는 **AI 에이전트 카드가 셸 · SSH 카드보다 앞**이다(2026-10-07 실기 — 판에서 먼저 찾는 것이 에이전트다).
 *
 * 재료는 대시보드 세션 칸이 쓰던 그대로다 — [`buildSessionCards`](./session-cards.ts) 의 카드(상태는 `cardStateOf`
 * 한 함수). 그래서 시트 · 상태바 세션 칸 · 탭 줄 워크스페이스 목록의 줄이 같은 타일을 다른 상태로 부르지 않는다
 * ([`sheetBadge`] · [`sheetBucketsBy`]). 시트의 스코프는 **이 창의 타일**이다 —
 * 헤드리스 위임 카드(누를 타일이 없다)는 뺀다.
 *
 * 룬도 DOM 도 `invoke` 도 없다 — node vitest 로 바로 테스트한다.
 */

import type { SessionBoard, SessionCard } from "./session-cards";

/**
 * "오래 돈다" 의 문턱 — 10분. 빌드 · 테스트 · 짧은 에이전트 턴은 대개 이 안에 끝난다. 그보다 길면 멎었는지(입력을
 * 기다리는 프롬프트 · 걸린 네트워크) 한 번 볼 만하다는 것이 이 묶음의 뜻이다. 화면에 숫자로 적지 않으니 바꿔도
 * 문구는 그대로다.
 */
export const LONG_RUNNING_MS = 10 * 60_000;

/** 시트의 세 묶음 — 각 묶음 안은 에이전트 먼저, 같은 단은 카드 판의 순서(로컬 먼저 · 급한 것 먼저 · 화면 순서) 그대로다 */
export interface SheetBuckets {
  waiting: SessionCard[];
  long: SessionCard[];
  quiet: SessionCard[];
  /** 셋을 합친 수(= 이 창의 세션 타일 수) */
  total: number;
}

/**
 * 도는 카드의 **시작 시각** — AI 는 지금 턴의 시작, 셸은 지금 블록의 시작. 모르면 `null`.
 *
 * AI 카드의 `since` 를 그대로 쓰지 않는 이유: 턴 시각이 없으면 `since` 는 셸 쪽 값(그 CLI 를 띄운 명령의 시작)으로
 * 떨어지는데, 에이전트를 몇 시간 띄워 둔 타일은 그 값이 늘 "오래" 다 — 턴이 도는지와 상관없이.
 */
export function runningSince(card: SessionCard): number | null {
  if (card.state !== "running") return null;
  if (card.kind === "ai") return card.agentTime?.kind === "turn" ? card.agentTime.at : null;
  return card.running ? card.since : null;
}

/** 카드 판 → 세 묶음. 순수 함수. */
export function sheetBuckets(board: SessionBoard, now: number): SheetBuckets {
  return bucketCards(board.groups.flatMap((group) => group.cards), now);
}

/**
 * 카드 판 → **열쇠마다** 세 묶음 — 탭 줄의 워크스페이스 단추 · 목록이 워크스페이스마다 센다
 * (2026-10-07). 열쇠는 부르는 쪽이 정한다(카드 → 워크스페이스 id, 모르면 `null` — 그 카드는 어느 묶음에도 들지
 * 않는다). 묶음 규칙과 순서는 [`sheetBuckets`] 그대로다 — 같은 카드를 판과 독이 다른 묶음으로 부르지 않게.
 */
export function sheetBucketsBy(
  board: SessionBoard,
  keyOf: (card: SessionCard) => string | null | undefined,
  now: number,
): Map<string, SheetBuckets> {
  const cards = new Map<string, SessionCard[]>();
  for (const group of board.groups) {
    for (const card of group.cards) {
      const key = keyOf(card);
      if (key === null || key === undefined) continue;
      const list = cards.get(key);
      if (list) list.push(card);
      else cards.set(key, [card]);
    }
  }
  return new Map([...cards].map(([key, list]) => [key, bucketCards(list, now)]));
}

/** 카드 몇 장 → 세 묶음 — [`sheetBuckets`] · [`sheetBucketsBy`] 의 몸통 */
function bucketCards(cards: Iterable<SessionCard>, now: number): SheetBuckets {
  const out: SheetBuckets = { waiting: [], long: [], quiet: [], total: 0 };
  for (const card of cards) {
    if (card.kind === "headless" || card.tabId === null || card.paneId === null) continue;
    out.total += 1;
    if (card.state === "input" || card.state === "fail") {
      out.waiting.push(card);
      continue;
    }
    const since = runningSince(card);
    if (since !== null && now - since >= LONG_RUNNING_MS) out.long.push(card);
    else out.quiet.push(card);
  }
  // 묶음마다 에이전트 카드가 앞이다. 기다리는 것 안에서는 그다음 입력 대기가 실패보다 먼저다(사람이 답해야 멈춘
  // 일이 풀린다) — 같은 단은 판의 순서(`sort` 는 안정 정렬).
  const agentFirst = (a: SessionCard, b: SessionCard) => Number(a.kind !== "ai") - Number(b.kind !== "ai");
  out.waiting.sort((a, b) => agentFirst(a, b) || Number(a.state !== "input") - Number(b.state !== "input"));
  out.long.sort(agentFirst);
  out.quiet.sort(agentFirst);
  return out;
}

/**
 * 배지 하나 — 세 묶음에서 **가장 급한 것**만 고른다. 상태바 세션 칸(이 워크스페이스) · 탭 줄 워크스페이스 목록의 줄
 * (워크스페이스마다)이 같은 규칙으로 읽는다(2026-10-07 — 자리마다 할 일 나누기. 줄 배지는 2026-10-13 에 하단 독 칸에서 옮겨 왔다).
 *
 * - 기다리는 것(`waiting` — 입력 대기 · 권한 대기 · 실패)이 있으면 그 수. 입력 대기가 하나라도 있으면 `input`
 *   (사람이 답해야 풀린다 — 강조색), 실패뿐이면 `fail`(오류색).
 * - 없고 도는 타일(카드 상태 `running` — 오래 도는 것 포함)이 있으면 `running` 과 그 수(독은 점, 상태바는 옅은 수).
 * - 둘 다 없으면 `null`(배지 없음).
 */
export interface SheetBadge {
  kind: "input" | "fail" | "running";
  n: number;
}

export function sheetBadge(buckets: SheetBuckets): SheetBadge | null {
  const waiting = buckets.waiting.length;
  if (waiting > 0) {
    return { kind: buckets.waiting.some((c) => c.state === "input") ? "input" : "fail", n: waiting };
  }
  const running = [...buckets.long, ...buckets.quiet].filter((c) => c.state === "running").length;
  return running > 0 ? { kind: "running", n: running } : null;
}

/**
 * 독 알림 칸 맨 위 세션 요약 줄의 두 수 — **도는 것 · 기다리는 것**(2026-10-18 통합 독 — "세션 · 실행 N · 대기 N ›").
 * 배지([`sheetBadge`])와 같은 재료 · 같은 셈이되 둘 중 급한 것 하나가 아니라 **둘 다**다(줄에는 자리가 있다).
 * 기다리는 것 = 입력 대기 · 권한 대기 · 실패, 도는 것 = 카드 상태 `running`(오래 도는 것 포함).
 */
export function sheetCounts(buckets: SheetBuckets): { running: number; waiting: number } {
  const running = [...buckets.long, ...buckets.quiet].filter((c) => c.state === "running").length;
  return { running, waiting: buckets.waiting.length };
}
