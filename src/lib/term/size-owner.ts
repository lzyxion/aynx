// **크기 주인**(원격 웹 R2-A 서버 · R2-B 프런트 — tmux `latest`). 순수 모듈 — 상태 저장소를 모른다.
//
// 한 세션을 여러 창(집 PC 창 = 주 · 원격 창 = 시청자)이 함께 볼 때 PTY 크기는 **마지막으로 사람이 입력한 쪽**의 것이다(서버 `session_core::viewers`).
// 이 파일은 그 사실을 터미널 하나가 쓰는 꼴로 바꾼다:
//
// - **질의 응답은 주인만** — xterm 이 스스로 내는 터미널 응답(DSR 커서 위치 · DA · DECRQM · OSC 10/11 색 — 출처 `protocol`,
//   `input-source.ts`)은 이 쪽이 크기 주인일 때만 보낸다. 둘 다 답하면 셸 입력에 답이 두 번 샌다. 사람의 키 · 붙여넣기는 **언제나** 보낸다
//   ([`shouldSendInput`]).
// - **사람이 치면 곧 주인** — 서버는 사람 입력을 받는 순간 그 쪽을 주인으로 삼는다(자격 있으면). 이벤트가 돌아오기 전의 틈에 온 질의에
//   답하도록 터미널이 먼저 주인으로 친다([`claimsOwnership`]).
// - **주인이 아니면 주인의 크기로 그린다**([`viewSize`]) — 제 상자에 맞추지 않는다(남는 칸은 여백 · 넘치면 스크롤). resize 는 그래도
//   보낸다(서버가 적어 두었다가 이 쪽이 치는 순간 건다).
// - **치지 않고 되찾기**(10-20) — 주인이 아닌 타일은 그린 영역에 점선 테두리 · 꼬리표를 달고, 포커스 타일은 [이 창 크기로] 카드를 띄운다
//   (`size-notice.ts` · `$lib/app/size-notice.svelte`). 단추는 손잡이의 `claimSize`(서버 `claim_size`) — 셸에 아무것도 쓰지 않는다.

import type { SessionLease } from "$lib/session/contract";
import type { InputSource } from "./input-source";

export interface TermSize {
  cols: number;
  rows: number;
}

/** 이 터미널이 본 크기 주인 — 주인인가 · 주인의 크기(모르면 `null`) */
export interface OwnerView {
  owner: boolean;
  size: TermSize | null;
  /** 주인이 주(집 PC 창)인가 — 꼬리표 문구를 가른다(`size-notice.ts`). 모르면(옛 서버 · 낙관적 주인) 없다 */
  primary?: boolean;
}

function sizeOf(cols: unknown, rows: unknown): TermSize | null {
  return typeof cols === "number" && typeof rows === "number" && cols > 0 && rows > 0 ? { cols, rows } : null;
}

/**
 * 서버 이벤트 `session-size-owner` → 이 터미널의 주인 상태. 몸 = `{stream, sessionEpoch, leaseEpoch: 주인 | null, primary, cols?, rows?}`.
 * 이 손잡이의 세션이 아니면(다른 스트림 · 다른 회차) `null`. `leaseEpoch` 가 `null` 이면 붙은 쪽 중 자격 있는 것이 없다(서버가 답한다) —
 * 이 쪽은 주인이 아니다.
 */
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

/** 붙기 · 시청자 붙기 답(`sizeOwner` · `ownerCols`/`ownerRows` · `ownerPrimary`) → 주인 상태. 답에 칸이 없으면(옛 서버) 주인으로 본다(예전 동작). */
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

/** 이 입력을 셸에 보낼까 — 터미널 응답(`protocol`)은 주인일 때만, 사람 것은 언제나. */
export function shouldSendInput(source: InputSource, owner: boolean): boolean {
  return source !== "protocol" || owner;
}

/** 이 입력이 이 쪽을 크기 주인으로 만드나(서버 규칙과 같다 — 사람 입력 · 자격 있음). */
export function claimsOwnership(source: InputSource, eligible: boolean): boolean {
  return eligible && source !== "protocol";
}

/**
 * xterm 을 어느 크기로 그리나 — 주인이면 제 상자에 맞춘 크기(`fitted`), 아니면 주인의 크기(모르면 맞춘 크기). 맞출 수 없으면(숨은 상자)
 * `null` — 부르는 쪽이 건드리지 않는다.
 */
export function viewSize(view: OwnerView, fitted: TermSize | null): TermSize | null {
  if (!view.owner && view.size) return view.size;
  return fitted;
}
