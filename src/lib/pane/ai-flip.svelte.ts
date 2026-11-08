/**
 * **AI 타일 넘기기의 상태** — 타일마다 지금 보이는 면(`term` 터미널 · `convo` 대화) 한 칸(2026-10-17).
 * 그림 · 움직임 · 키는 `pane/AiFlip.svelte`, 키 판정은 순수 층 `pane/ai-flip-keys.ts`.
 *
 * - **화면 상태일 뿐이다** — 저장하지 않고(`workspaces.json` · 이관 짐에 싣지 않는다) 세션 수명 · 임대와 무관하다. 페이지가
 *   다시 뜨거나(F5 · 웹뷰 크래시 재부착) 타일이 다른 창으로 건너가면 터미널 면으로 돌아온다 — 넘김은 "지금 잠깐 읽기" 라서다.
 *   (폰 배치만 예외 — 처음 볼 때 대화 면으로 다시 연다: 2026-11-04 · `pane/AiFlip` · 이 기기 값 `aiFacePref`.)
 * - 없는 칸 = 터미널. 대화 면인 타일만 적는다.
 * - **넘길 수 있는 타일**([`canFlipPane`]) = 앱이 AI 로 아는 터미널 타일(`agentKindOf` — Claude Code · Codex)이고 그 대화를 읽을
 *   길이 있는 것: 로컬이거나, 설정의 SSH 타일(별칭이 있다 — 원격 대화 읽기는 그 별칭의 목록 캐시로 파일을 찾는다). 빠른 접속
 *   SSH 타일은 별칭이 없어 넘기지 않는다. 머리줄 단추 · 단축키 · `AiFlip` 이 같은 판정을 읽는다.
 */

import { agentKindOf } from "$lib/app/agent-status.svelte.js";
import type { PaneSpec } from "$lib/session";
import { flipViewOf, setFlipView } from "$lib/pane/flip-view.svelte.js";

export type { FlipView } from "$lib/pane/flip-view.svelte.js";
import type { FlipView } from "$lib/pane/flip-view.svelte.js";

/**
 * 대화 면 입력 칸의 **보내기를 막는 사정**(채팅 독 — 2026-10-23 · `FlipComposer` 의 `gate`). `card` 가 아니면 칸 위의 흐린 한 줄,
 * 카드면 문구 + 단추(`terminal` = "터미널에서 답하기 →" · `action` = 부른 쪽의 일) + 안내 한 줄.
 */
export interface ComposerGate {
  text: string;
  card?: boolean;
  terminal?: boolean;
  action?: { label: string; run: () => void };
  tip?: string | null;
  /** 칸 위 줄 없이 칸 자체가 막힌다 — 글은 칸의 자리표시로 · 칸은 읽기 전용 · 점선(폴더 신뢰 질문 — 2026-11-04) */
  quiet?: boolean;
}

// 면 상태 칸 자체는 잎 모듈 `pane/flip-view.svelte.ts`(알림 배선이 `agent-status` 를 거치지 않고 부를 수 있게 — 2026-11-01)
export { flipViewOf, setFlipView } from "$lib/pane/flip-view.svelte.js";

/**
 * **대화 면 입력 칸에 채울 글**(2026-10-30 오케스트레이션 탭 ④ — 노트 D6 "Enter 는 사람이 본 글에만"): 앱이 짓거나 보내지 못한 글(이어받기
 * 문장 · 준비를 못 받아 보내지 않은 첫 지시)을 그 타일의 입력 칸(`FlipComposer` 의 `prefill`)에 **채우기만** 한다 — 보내기는 사람이 누른다.
 * 화면 상태일 뿐이다(저장 · 로그 없음). 칸이 채우면 걷는다([`clearFlipPrefill`]) — 다시 그려져도 두 번 채우지 않게.
 */
const prefills = $state<Record<string, { text: string; n: number }>>({});
let prefillSeq = 0;

export function prefillFlip(paneId: string, text: string): void {
  prefillSeq += 1;
  prefills[paneId] = { text, n: prefillSeq };
}

/** 그 타일 입력 칸에 채울 글(반응형 — 없으면 `null`) */
export function flipPrefillOf(paneId: string): { text: string; n: number } | null {
  return prefills[paneId] ?? null;
}

/** 칸이 그 글을 채웠다 — 같은 번호일 때만 걷는다 */
export function clearFlipPrefill(paneId: string, n: number): void {
  if (prefills[paneId]?.n === n) delete prefills[paneId];
}

/** 넘긴다 — 돌려준 것이 새 면 */
export function toggleFlip(paneId: string): FlipView {
  const next: FlipView = flipViewOf(paneId) === "convo" ? "term" : "convo";
  setFlipView(paneId, next);
  return next;
}

/** 타일이 사라졌다 — 칸을 걷는다 */
export function forgetFlip(paneId: string): void {
  setFlipView(paneId, "term");
}

/** 원격 대화를 읽을 별칭 — 설정의 SSH 타일만(빠른 접속은 `null`). 로컬이면 `null` */
export function flipRemoteAlias(pane: PaneSpec): string | null {
  if (pane.kind !== "ssh" || pane.adhoc) return null;
  const a = pane.alias?.trim();
  return a ? a : null;
}

/** 이 타일을 [터미널 | 대화] 로 넘길 수 있나 — 반응형(CLI 가 뜨고 지면 바뀐다) */
export function canFlipPane(pane: PaneSpec): boolean {
  if (agentKindOf(pane) === null) return false;
  return pane.kind === "local" || flipRemoteAlias(pane) !== null;
}
