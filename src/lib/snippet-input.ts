/**
 * 프롬프트에서 지금 치고 있는 글자 — OSC 133 의 `B`~`C` 사이를 정하는 순수 규칙.
 * 여러 줄 입력이면 포기한다 — 이어쓰기 프롬프트(`> `)가 섞여 지우는 길이(DEL 개수)도 틀린다.
 */

export interface InputAnchor {
  /** 마커가 스크롤을 따라가므로 읽을 때마다 다시 묻는다 */
  line: number;
  col: number;
}

export interface CursorAt {
  line: number;
  col: number;
}

/** 열을 그대로 `translateToString` 에 넘긴다 — 한글·CJK 는 두 칸이라 문자열로 바꿔 `slice` 하면 어긋난다 */
export interface InputRange {
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * `B` 를 안 보내는 훅에서는 제안이 아예 뜨지 않는다 — 명령문의 시작을 알 길이 없으니 맞는 답이다.
 * 모르는 조각(`E`·`P` …)은 상태를 건드리지 않는다 — 반응하면 모르는 확장 하나가 입력 모드를 꺼 버린다.
 */
export function inputModeAfter(active: boolean, kind: string): boolean {
  if (kind === "B") return true;
  if (kind === "A" || kind === "C" || kind === "D") return false;
  return active;
}

export function inputRange(
  anchor: InputAnchor | null | undefined,
  cursor: CursorAt,
): InputRange | null {
  if (!anchor) return null;
  if (cursor.line !== anchor.line) return null;
  if (cursor.col < anchor.col) return null;
  return { line: anchor.line, startCol: anchor.col, endCol: cursor.col };
}

/** 열이 아니라 글자 수다 — 줄 편집기는 문자를 지운다(두 칸 한글도 `\x7f` 하나 · 이모지도 한 글자) */
export function eraseCount(typed: string | null | undefined): number {
  return typeof typed === "string" ? Array.from(typed).length : 0;
}
