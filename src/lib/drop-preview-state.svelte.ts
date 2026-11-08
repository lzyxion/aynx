/**
 * 분할 드롭 미리보기의 **refit 정지 표시** — PaneHost 하나가 쓰고 터미널들이 읽는다.
 *
 * 미리 접힌 크기는 아직 사용자가 놓은 배치가 아니다. 그 크기로 fit·PTY resize 를 보내면
 * 관계없는 셸·TUI 도 다시 그려진다. 미리보기 동안은 원래 버퍼를 상자에 잘라 보이고,
 * 건너뛴 refit 은 종료 뒤 도착한 크기로 한 번 디바운스한다(Terminal 의 몫).
 */
let previewing = $state(false);

export function dropPreviewing(): boolean {
  return previewing;
}

/** 실제로 접힌 그림이 켜졌는가 — zone 판정만으로는 최대화·reduced-motion 을 알 수 없다. */
export function setDropPreviewing(on: boolean): void {
  previewing = on;
}
