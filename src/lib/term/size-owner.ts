// 크기 주인 — 여러 창이 한 세션을 볼 때 PTY 크기는 마지막으로 사람이 입력한 쪽의 것이다(서버 `session_core::viewers`).
// - 터미널 응답(`protocol`)은 주인일 때만 보낸다 — 둘 다 답하면 셸 입력에 답이 두 번 샌다. 사람 입력은 언제나 보낸다.
// - 사람이 치면 서버 이벤트를 기다리지 않고 먼저 주인으로 친다 — 그 틈에 온 질의에 답해야 한다.
// - 주인이 아니면 주인의 크기로 그린다(제 상자에 맞추지 않는다). resize 는 그래도 보낸다 — 서버가 적어 두었다가 이 쪽이 치는 순간 건다.

import type { SessionLease } from "$lib/session/contract";
import type { InputSource } from "./input-source";

export interface TermSize {
  cols: number;
  rows: number;
}

export interface OwnerView {
  owner: boolean;
  size: TermSize | null;
  /** 주인이 주(메인 PC 창)인가. 모르면(옛 서버 · 낙관적 주인) 없다 */
  primary?: boolean;
}

function sizeOf(cols: unknown, rows: unknown): TermSize | null {
  return typeof cols === "number" && typeof rows === "number" && cols > 0 && rows > 0 ? { cols, rows } : null;
}

/** 서버 이벤트 `session-size-owner` → 주인 상태. 다른 스트림 · 회차면 `null`. `leaseEpoch: null` = 자격 있는 쪽이 없다 — 이 쪽은 주인이 아니다. */
export function ownerFromEvent(lease: SessionLease | null | undefined, body: unknown): OwnerView | null {
  if (!lease || typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.stream !== lease.stream || b.sessionEpoch !== lease.sessionEpoch) return null;
  return {
    owner: b.leaseEpoch === lease.leaseEpoch,
    size: sizeOf(b.cols, b.rows),
    ...(typeof b.primary === "boolean" ? { primary: b.primary } : {}),
  };
}

/** 답에 칸이 없으면(옛 서버) 주인으로 본다 */
export function ownerFromReply(reply: {
  sizeOwner?: unknown;
  ownerCols?: unknown;
  ownerRows?: unknown;
  ownerPrimary?: unknown;
}): OwnerView {
  return {
    owner: reply.sizeOwner !== false,
    size: sizeOf(reply.ownerCols, reply.ownerRows),
    ...(typeof reply.ownerPrimary === "boolean" ? { primary: reply.ownerPrimary } : {}),
  };
}

export function shouldSendInput(source: InputSource, owner: boolean): boolean {
  return source !== "protocol" || owner;
}

/** 서버 규칙과 같아야 한다 — 사람 입력 · 자격 있음 */
export function claimsOwnership(source: InputSource, eligible: boolean): boolean {
  return eligible && source !== "protocol";
}

/** 맞출 수 없으면(숨은 상자) `null` — 부르는 쪽이 건드리지 않는다 */
export function viewSize(view: OwnerView, fitted: TermSize | null): TermSize | null {
  if (!view.owner && view.size) return view.size;
  return fitted;
}
