/**
 * **AI 타일 넘김의 면 칸**(잎 모듈 — 2026-11-01 `pane/ai-flip.svelte.ts` 에서 떼어 냄). 타일마다 지금 보이는 면(`term` · `convo`) 한 칸.
 * 알림(배너 · 알림 칸 · 폰)으로 와도 면은 바꾸지 않는다 — 터미널 면이면 TUI, 대화 면이면 카드로 답한다(2026-11-03 사용자 결정 · 예전 `revealPermissionCards` 걷음).
 * 넘길 수 있나(`canFlipPane`) · 채울 글 · 토글은 `pane/ai-flip.svelte.ts`(이 파일을 다시 내보낸다).
 */

export type FlipView = "term" | "convo";

const views = $state<Record<string, "convo">>({});

/** 그 타일의 지금 면 — 반응형 */
export function flipViewOf(paneId: string): FlipView {
  return views[paneId] === "convo" ? "convo" : "term";
}

export function setFlipView(paneId: string, view: FlipView): void {
  if (view === "convo") views[paneId] = "convo";
  else if (paneId in views) delete views[paneId];
}
