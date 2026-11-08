/**
 * **간이 모드(tmux 타일) 거울의 재료** — 화면 꼬리 읽기와 올리는 때 판정
 * (docs/log/2026-09-16-tmux-toggle.md 의 "꺼지지 않는 것: AI 읽기(스크롤백)").
 *
 * 일반 타일은 OSC 133 상태 전이마다 `shell.tail(400)` 을 올린다. 간이 모드에는 파서가 없어
 * 그 때가 오지 않으므로, `Terminal.svelte` 가 **출력이 잠잠해진 뒤**(디바운스)와 **쏟아지는 동안
 * 상한마다** 이 파일의 [`screenTail`] 로 xterm 버퍼 꼬리를 읽어 올린다.
 *
 * xterm 타입을 들여오지 않는다 — `term.buffer.active` 가 이미 만족하는 구조적 모양 하나만 받아
 * vitest 가 가짜 버퍼로 규칙을 고정한다(`$lib/scrollback` 과 같은 방식).
 */

/** `term.buffer.active` 가 이미 만족하는 최소한의 모양 */
export interface TailBuffer {
  readonly length: number;
  getLine(index: number): { readonly isWrapped?: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

/** 출력이 이만큼 멎으면 올린다(ms) */
export const SCREEN_PUSH_QUIET_MS = 1000;
/** 출력이 계속 쏟아져도 이만큼마다는 한 번 올린다(ms) — 디바운스만 있으면 영영 안 올라간다 */
export const SCREEN_PUSH_MAX_MS = 5000;

/**
 * 출력이 막 왔을 때 걸 타이머의 지연 — 마지막 출력 뒤 `QUIET`, 단 첫 미반영 출력(`pendingSince`)에서
 * `MAX` 를 넘기지 않는다. 음수는 0 으로(이미 상한을 지났다 = 곧바로).
 */
export function screenPushDelay(now: number, pendingSince: number): number {
  return Math.max(0, Math.min(SCREEN_PUSH_QUIET_MS, pendingSince + SCREEN_PUSH_MAX_MS - now));
}

/**
 * 버퍼의 마지막 `rows` 개 화면 줄을 **논리 줄**로 — 뒤쪽 빈 줄은 먼저 떼고(tmux 는 화면 높이를
 * 다 채운다), 가운데 빈 줄은 그대로 둔다. 래핑된 줄(`isWrapped`)은 앞줄에 이어 붙이고, 오른쪽 공백은
 * 다음 줄이 이어지지 않을 때만 뗀다(`shell-integration/buffer-read.ts` 와 같은 규칙).
 * 글자는 `translateToString` 으로만 꺼낸다 — 넓은 글자(한글) 셀을 직접 만지지 않는다.
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
