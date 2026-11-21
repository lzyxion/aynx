/** AI 타일마다 지금 보이는 면. 알림으로 와도 면은 바꾸지 않는다 — 터미널 면이면 TUI, 대화 면이면 카드로 답한다. */

export type FlipView = "term" | "convo";

const views = $state<Record<string, "convo">>({});

export function flipViewOf(paneId: string): FlipView {
  return views[paneId] === "convo" ? "convo" : "term";
}

export function setFlipView(paneId: string, view: FlipView): void {
  if (view === "convo") views[paneId] = "convo";
  else if (paneId in views) delete views[paneId];
}
