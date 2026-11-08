/**
 * **채팅 독의 순수 표시 계산**(룬 · DOM 없음) — `ChatDock.svelte` 에서 그대로 옮겼다.
 * - `targetOf` — 저장 모양 → 붙을 뜻(그 CLI 의 기록된 대화 id 로 이어 가기 · 갈라 올 원본 · 연결 타일).
 * - `Dot` · `mostUrgentDot` — 상태 점과 머리줄 ▾ 의 점(모든 채팅 중 가장 급한 것).
 */
import { sideChatCliOk, sideChatConversation, sideChatForkFrom, type SideChat } from "$lib/side-chat";
import type { SideChatTarget } from "$lib/app/side-chat-live.svelte.js";

/** 저장 모양 → 붙을 뜻(그 CLI 의 기록된 대화 id 로 이어 가기) */
export function targetOf(c: SideChat, cli = c.cli, model = c.model): SideChatTarget {
  return {
    id: c.id,
    cli: sideChatCliOk(cli) ? cli : "claude",
    model,
    effort: c.effort,
    conversation: sideChatConversation(c, cli),
    fork: sideChatForkFrom(c, cli),
    link: c.tile?.stream ?? null,
  };
}

/** 채팅 하나의 상태 점 — 답하는 중 · 권한 대기 · 새 답 */
export type Dot = "running" | "permission" | "finished" | null;

/** 머리줄 ▾ 의 점 — 모든 채팅 중 가장 급한 것(권한 > 새 답 > 답하는 중) */
export function mostUrgentDot(dots: readonly Dot[]): Dot {
  if (dots.includes("permission")) return "permission";
  if (dots.includes("finished")) return "finished";
  return dots.includes("running") ? "running" : null;
}
