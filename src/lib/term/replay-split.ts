// 재생 끝에서 덩어리 나누기 (오케스트레이션 7단계 발견 ① — 부트스트랩 DSR 무응답 멈춤). 순수 모듈 — 상태 저장소를 모른다.
//
// 떨어진 세션에 다시 붙을 때 이 채널의 첫 바이트 오프셋(`base`)과 재생 끝(`until` — 그 앞은 창이 없던 동안의 출력, 서버가 이미 질의에
// 답했다)은 붙기 결과가 와야 안다. 그 전에 온 덩어리는 모았다가(`Terminal.svelte` 의 `held`) 결과가 오면 이 함수로 경계를 찾아
// **재생분은 재생 표시 아래, 경계 뒤 실시간분은 재생 표시를 끈 뒤** 파싱되게 둘로 나누어 쓴다 — 실시간분의 DSR · DA 질의는 xterm 이 답한다.

/**
 * 오프셋 `off` 에서 시작하는 `len` 바이트 덩어리가 재생 끝 `until` 을 **안에** 품으면 그 자리(덩어리 안 바이트 수)를, 아니면 `null`.
 * 재생 중이 아니거나 경계를 모르면 `null`(통째로 쓴다).
 */
/**
 * 재생을 **어느 크기로** 쓰나(10-15 — 작업자 타일 첫 줄 찌꺼기). 링의 재생분은 붙기 전 PTY 크기(`pty`)의 화면에 쓰였다 — ConPTY 는 커서를
 * 절대 위치로 옮기므로 다른 폭의 xterm 에 그대로 쓰면 줄 끝 글자가 엉뚱한 칸에 남는다(서버가 120칸으로 띄운 작업자를 70칸 타일에 붙일 때
 * 첫 줄 끝 글자 하나가 빈 줄 오른쪽 끝에 남던 것). 맡긴 화면(체크포인트)이 있으면 그 화면이 이미 크기를 정했으니 `null`, 크기를 모르거나
 * 지금 타일과 같거나 타일 크기를 잴 수 없으면(숨은 탭 — 서버도 PTY 를 그대로 둔다) `null`. 아니면 재생할 크기 — 터미널은 그 크기로
 * 재생하고 재생 끝(`replaySplitAt` 의 경계)에서 타일 크기로 맞춘다(뒤 실시간분은 서버의 resize 뒤 ConPTY 다시 그림이다).
 */
export function replayResize(
  pty: { cols: number; rows: number } | null | undefined,
  term: { cols: number; rows: number },
  hasCheckpoint: boolean,
  sized: boolean,
): { cols: number; rows: number } | null {
  if (hasCheckpoint || !sized || !pty) return null;
  if (!(pty.cols > 0 && pty.rows > 0)) return null;
  if (pty.cols === term.cols && pty.rows === term.rows) return null;
  return { cols: pty.cols, rows: pty.rows };
}

export function replaySplitAt(off: number, len: number, until: number | null, replaying: boolean): number | null {
  if (!replaying || until === null || len <= 0) return null;
  if (off < until && off + len > until) return until - off;
  return null;
}
