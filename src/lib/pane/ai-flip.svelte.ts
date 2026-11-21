/**
 * AI 타일의 면(`term` · `convo`) 상태 — 화면 상태일 뿐이라 저장하지 않고(배치 파일 · 이관 짐에 없다) 리로드 · 창 이관에서 터미널로 돌아온다.
 * 넘길 수 있는 것은 앱이 AI 로 아는 로컬 타일 · 설정의 SSH 타일뿐이다 — 빠른 접속은 원격 대화를 찾을 별칭이 없다.
 */

import { agentKindOf } from "$lib/app/agent-status.svelte.js";
import type { PaneSpec } from "$lib/session";
import { flipViewOf, setFlipView } from "$lib/pane/flip-view.svelte.js";

export type { FlipView } from "$lib/pane/flip-view.svelte.js";
import type { FlipView } from "$lib/pane/flip-view.svelte.js";

/** `card` 가 아니면 칸 위의 흐린 한 줄 · `terminal` = "터미널에서 답하기 →" */
export interface ComposerGate {
  text: string;
  card?: boolean;
  terminal?: boolean;
  action?: { label: string; run: () => void };
  tip?: string | null;
  /** 칸 위 줄 없이 칸 자체가 막힌다(자리표시 · 읽기 전용) */
  quiet?: boolean;
}

// 면 상태는 잎 모듈 `flip-view.svelte.ts` 에 산다 — 알림 배선이 `agent-status` 를 거치지 않고 부를 수 있게
export { flipViewOf, setFlipView } from "$lib/pane/flip-view.svelte.js";

/**
 * 앱이 짓거나 보내지 못한 글을 입력 칸에 채우기만 한다 — Enter 는 사람이 본 글에만, 보내기는 사람이 누른다.
 * 칸이 채우면 같은 번호로 걷는다 — 다시 그려져도 두 번 채우지 않게.
 */
const prefills = $state<Record<string, { text: string; n: number }>>({});
let prefillSeq = 0;

export function prefillFlip(paneId: string, text: string): void {
  prefillSeq += 1;
  prefills[paneId] = { text, n: prefillSeq };
}

export function flipPrefillOf(paneId: string): { text: string; n: number } | null {
  return prefills[paneId] ?? null;
}

export function clearFlipPrefill(paneId: string, n: number): void {
  if (prefills[paneId]?.n === n) delete prefills[paneId];
}

export function toggleFlip(paneId: string): FlipView {
  const next: FlipView = flipViewOf(paneId) === "convo" ? "term" : "convo";
  setFlipView(paneId, next);
  return next;
}

export function forgetFlip(paneId: string): void {
  setFlipView(paneId, "term");
}

export function flipRemoteAlias(pane: PaneSpec): string | null {
  if (pane.kind !== "ssh" || pane.adhoc) return null;
  const a = pane.alias?.trim();
  return a ? a : null;
}

export function canFlipPane(pane: PaneSpec): boolean {
  if (agentKindOf(pane) === null) return false;
  return pane.kind === "local" || flipRemoteAlias(pane) !== null;
}
