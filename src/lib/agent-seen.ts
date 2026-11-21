/**
 * 완료 확인 공유의 판정 — 사람이 본 창이 서버에 알리고 방송을 받은 창이 "안 봄" 표식을 거둔다.
 * 넓은 창은 포커스만으로는 안 된다 — 사람이 폰을 들고 비운 메인 PC 창이 폰의 완료를 바로 지운다. 시계가 달라 시각 대신 입력 번호(`gen`)로 묻는다.
 */
import { agentStatus, type AgentSignals } from "$lib/agent-status";

export interface SeenMark {
  seq: number;
  gen: number;
}

/** `unseen` 을 참으로 묻는다 — 스냅숏으로 깨어난 타일은 표식이 없다 */
export function turnEnded(sig: AgentSignals | null | undefined): boolean {
  return !!sig && agentStatus(sig, 0, true) === "finished";
}

export function noteEnded(prev: SeenMark | undefined, seq: number, gen: number): SeenMark {
  return prev?.seq === seq ? prev : { seq, gen };
}

export function watching(s: { veil: boolean; pageShown: boolean; handheld: boolean; focused: boolean }): boolean {
  if (s.veil || !s.pageShown) return false;
  return s.handheld || s.focused;
}

export function shouldSend(s: {
  visible: boolean;
  watching: boolean;
  handheld: boolean;
  mark: SeenMark;
  gen: number;
  /** 이 타일에 대해 마지막으로 알렸거나 받은 seq */
  sent: number | undefined;
}): boolean {
  if (!s.visible || !s.watching || s.sent === s.mark.seq) return false;
  return s.handheld || s.gen > s.mark.gen;
}

export function parseAgentSeen(v: unknown): { stream: string; seq: number } | null {
  if (typeof v !== "object" || v === null) return null;
  const { stream, seq } = v as Record<string, unknown>;
  return typeof stream === "string" && typeof seq === "number" && Number.isFinite(seq) ? { stream, seq } : null;
}

export function parseSideChatSeen(v: unknown): { chat: string; epoch: number; seq: number } | null {
  if (typeof v !== "object" || v === null) return null;
  const { chat, epoch, seq } = v as Record<string, unknown>;
  const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return typeof chat === "string" && num(epoch) && num(seq) ? { chat, epoch, seq } : null;
}

/** `mine` = 이 창이 받은 마지막 턴 끝(다음 턴이 섰으면 `null`) · 세대가 다르면 다른 턴이다 */
export function sideChatSeenApplies(seen: { epoch: number; seq: number }, mine: { epoch: number; seq: number } | null): boolean {
  return mine !== null && mine.epoch === seen.epoch && seen.seq >= mine.seq;
}

export function seenApplies(seq: number, mine: number | null): boolean {
  return mine === null || seq >= mine;
}
