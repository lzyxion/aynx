/**
 * 간이 모드(tmux 타일) 거울의 재료 — OSC 133 파서가 없어 상태 전이 때가 오지 않으므로, 출력이 잠잠해진 뒤와 쏟아지는 동안 상한마다 올린다.
 * xterm 타입을 들여오지 않는다 — vitest 가 가짜 버퍼로 규칙을 고정한다.
 */

export interface TailBuffer {
  readonly length: number;
  getLine(index: number): { readonly isWrapped?: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

export const SCREEN_PUSH_QUIET_MS = 1000;
/** 디바운스만 있으면 쏟아지는 동안 영영 안 올라간다 */
export const SCREEN_PUSH_MAX_MS = 5000;

export function screenPushDelay(now: number, pendingSince: number): number {
  return Math.max(0, Math.min(SCREEN_PUSH_QUIET_MS, pendingSince + SCREEN_PUSH_MAX_MS - now));
}

/**
 * 마지막 `rows` 화면 줄을 논리 줄로(`shell-integration/buffer-read.ts` 와 같은 규칙). 뒤쪽 빈 줄은 먼저 뗀다(tmux 는 화면 높이를 다 채운다).
 * 글자는 `translateToString` 으로만 꺼낸다 — 넓은 글자 셀을 직접 만지지 않는다.
 */
export function screenTail(buf: TailBuffer, rows: number): string[] {
  if (!Number.isFinite(rows) || rows <= 0) return [];
  let end = buf.length;
  while (end > 0 && (buf.getLine(end - 1)?.translateToString(true) ?? "") === "") end--;
  const out: string[] = [];
  for (let y = Math.max(0, end - rows); y < end; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const continues = buf.getLine(y + 1)?.isWrapped ?? false;
    const text = line.translateToString(!continues);
    if (line.isWrapped && out.length > 0) out[out.length - 1] += text;
    else out.push(text);
  }
  return out;
}
