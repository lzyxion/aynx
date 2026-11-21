/** 세션 판의 세 묶음 — 호스트가 아니라 무게 순서(기다리는 것 · 오래 도는 것 · 조용함)로 나눈다. 이 창의 타일만(헤드리스 뺌). */

import type { SessionBoard, SessionCard } from "./session-cards";

/** 화면에 숫자로 적지 않으니 바꿔도 문구는 그대로다 */
export const LONG_RUNNING_MS = 10 * 60_000;

export interface SheetBuckets {
  waiting: SessionCard[];
  long: SessionCard[];
  quiet: SessionCard[];
  total: number;
}

/**
 * AI 카드는 `since` 를 쓰지 않는다 — 턴 시각이 없으면 `since` 는 CLI 를 띄운 명령의 시작으로 떨어져, 오래 띄운 타일이 늘 "오래" 가 된다.
 */
export function runningSince(card: SessionCard): number | null {
  if (card.state !== "running") return null;
  if (card.kind === "ai") return card.agentTime?.kind === "turn" ? card.agentTime.at : null;
  return card.running ? card.since : null;
}

export function sheetBuckets(board: SessionBoard, now: number): SheetBuckets {
  return bucketCards(board.groups.flatMap((group) => group.cards), now);
}

/** 열쇠가 `null` 인 카드는 어느 묶음에도 들지 않는다 */
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
  // 같은 단은 판의 순서를 지킨다(`sort` 는 안정 정렬).
  const agentFirst = (a: SessionCard, b: SessionCard) => Number(a.kind !== "ai") - Number(b.kind !== "ai");
  out.waiting.sort((a, b) => agentFirst(a, b) || Number(a.state !== "input") - Number(b.state !== "input"));
  out.long.sort(agentFirst);
  out.quiet.sort(agentFirst);
  return out;
}

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

export function sheetCounts(buckets: SheetBuckets): { running: number; waiting: number } {
  const running = [...buckets.long, ...buckets.quiet].filter((c) => c.state === "running").length;
  return { running, waiting: buckets.waiting.length };
}
