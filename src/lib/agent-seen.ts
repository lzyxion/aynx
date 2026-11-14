/**
 * **완료 확인 공유의 판정**(2026-11-04 — 저장소 `app/agent-seen.svelte.ts` · docs/log/2026-11-04-agent-seen-sync.md). 룬도 DOM 도 없다.
 *
 * "안 봄" 표식은 창마다 산다(`app/agent-unseen`) — 폰에서 턴 끝을 봐도 집 PC 창의 완료가 남았다. 그래서 **사람이 본** 창이 서버에 알리고 방송을 받은 창이 표식을 거둔다.
 *
 * ## 사람이 봤다
 *
 * | 창 | 조건 |
 * | --- | --- |
 * | 폰 · 터치 기기 | 가림막 없음 · 페이지 보임 — 화면이 켜진 채 그 타일이 떠 있다 |
 * | 집 PC · 넓은 원격 창 | 가림막 없음 · 창 포커스 · **그 턴이 끝난 뒤 이 창에 사람의 입력이 있었다** |
 *
 * 마지막 조건이 요점이다: 집 PC 창은 사람이 폰을 들고 자리를 비워도 포커스를 쥔 채 그 탭을 띄워 둔다. 입력을 따지지 않으면 집 PC 가 "봤다" 고 알려 폰의 완료가 뜨자마자
 * 지워진다. 시각을 비교하지 않고 입력 번호(`gen`)로 묻는다 — 넓은 원격 창은 서버와 시계가 다르다.
 */
import { agentStatus, type AgentSignals } from "$lib/agent-status";

/** 이 창이 그 턴 끝을 처음 안 때 — 그 턴의 seq · 그때의 입력 번호 */
export interface SeenMark {
  seq: number;
  gen: number;
}

/** 가장 늦은 훅 신호가 턴 끝인가 — 점 판정과 같은 규칙(`unseen` 만 참으로 물어 표식과 상관없이 — 스냅숏으로 깨어난 타일은 표식이 없다) */
export function turnEnded(sig: AgentSignals | null | undefined): boolean {
  return !!sig && agentStatus(sig, 0, true) === "finished";
}

/** 그 턴 끝을 처음 안 때를 적는다 — 같은 턴이면 그대로 */
export function noteEnded(prev: SeenMark | undefined, seq: number, gen: number): SeenMark {
  return prev?.seq === seq ? prev : { seq, gen };
}

/** 사람이 이 창을 보고 있는가 (입력 조건은 타일마다 — [`shouldSend`]) */
export function watching(s: { veil: boolean; pageShown: boolean; handheld: boolean; focused: boolean }): boolean {
  if (s.veil || !s.pageShown) return false;
  return s.handheld || s.focused;
}

/** 이 타일의 턴 끝을 지금 알리는가 */
export function shouldSend(s: {
  /** 이 창에 보이는 타일인가 */
  visible: boolean;
  watching: boolean;
  handheld: boolean;
  mark: SeenMark;
  /** 지금 입력 번호 */
  gen: number;
  /** 이 타일에 대해 마지막으로 알렸거나 받은 seq */
  sent: number | undefined;
}): boolean {
  if (!s.visible || !s.watching || s.sent === s.mark.seq) return false;
  return s.handheld || s.gen > s.mark.gen;
}

/** 방송의 몸 → 값(모양이 틀리면 `null`) */
export function parseAgentSeen(v: unknown): { stream: string; seq: number } | null {
  if (typeof v !== "object" || v === null) return null;
  const { stream, seq } = v as Record<string, unknown>;
  return typeof stream === "string" && typeof seq === "number" && Number.isFinite(seq) ? { stream, seq } : null;
}

/** 사이드 채팅 완료 확인 방송(`side-chat-seen`)의 몸 → 값(모양이 틀리면 `null`) */
export function parseSideChatSeen(v: unknown): { chat: string; epoch: number; seq: number } | null {
  if (typeof v !== "object" || v === null) return null;
  const { chat, epoch, seq } = v as Record<string, unknown>;
  const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return typeof chat === "string" && num(epoch) && num(seq) ? { chat, epoch, seq } : null;
}

/**
 * 사이드 채팅의 확인이 이 창의 지금 배너에 해당하는가 — `mine` = 이 창이 받은 마지막 턴 끝(다음 턴이 섰으면 `null` — 그 턴의 배너는 새 턴이
 * 이미 풀었다). 세대가 다르면(다시 떴다 · CLI 를 바꿨다) 다른 턴이고, 이 창이 더 늦은 턴 끝을 받았으면 지난 턴의 확인이다(그 배너는 남는다).
 */
export function sideChatSeenApplies(seen: { epoch: number; seq: number }, mine: { epoch: number; seq: number } | null): boolean {
  return mine !== null && mine.epoch === seen.epoch && seen.seq >= mine.seq;
}

/** 그 확인이 이 창의 지금 턴에 해당하는가 — 이 창이 더 새 신호를 받았으면 지난 턴의 확인이다 */
export function seenApplies(seq: number, mine: number | null): boolean {
  return mine === null || seq >= mine;
}
