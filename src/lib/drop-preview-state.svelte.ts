/**
 * 분할 드롭 미리보기 동안의 refit 정지 표시 — 미리 접힌 크기로 fit · PTY resize 를 보내면 관계없는 셸 · TUI 도 다시 그려진다.
 * 건너뛴 refit 은 종료 뒤 한 번 디바운스한다(Terminal 의 몫).
 */
let previewing = $state(false);

export function dropPreviewing(): boolean {
  return previewing;
}

/** 실제로 접힌 그림이 켜졌는가 — zone 판정만으로는 최대화 · reduced-motion 을 알 수 없다 */
export function setDropPreviewing(on: boolean): void {
  previewing = on;
}
