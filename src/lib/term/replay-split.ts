// 재생분은 재생 표시 아래, 재생 끝 뒤 실시간분은 표시를 끈 뒤 파싱되게 덩어리를 나눈다 — 실시간분의 DSR · DA 질의는 xterm 이 답해야
// 한다(안 나누면 부트스트랩이 DSR 무응답으로 멈춘다).

/**
 * 재생분은 붙기 전 PTY 크기로 쓰였다 — ConPTY 는 커서를 절대 위치로 옮기므로 다른 폭에 그대로 쓰면 줄 끝 글자가 엉뚱한 칸에 남는다.
 * 그 크기로 재생하고 재생 끝에서 타일 크기로 맞춘다. 숨은 탭(`!sized`)이면 서버도 PTY 를 그대로 두니 `null`.
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
