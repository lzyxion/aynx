/** 오케스트레이션 홈 입력 칸의 초안 — `orch-start` 와 `orchestration` 이 서로를 부르지 않게 따로 둔다. `focusN` 이 `focusDone` 보다 앞서면 홈이 포커스를 주고 맞춘다 */
export const homeDraft = $state({ text: "", primed: false, cliId: "", model: "", effort: "", studio: "", focusN: 0, focusDone: 0 });

export function selectHomeStudio(path: string): void {
  homeDraft.studio = path;
  homeDraft.focusN += 1;
}
