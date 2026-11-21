/**
 * 강조 크기 판정 — `highlight.ts` 밖에 둔다: 화면이 이 판정을 보려고 강조기를 정적 import 하면 강조기 전체가 메인 청크로 돌아온다.
 */

/** 트리가 수십만 노드가 되면 그리는 데 초가 걸린다 */
export const HIGHLIGHT_MAX_LINES = 20_000;
/** UTF-16 단위 */
export const HIGHLIGHT_MAX_CHARS = 1_000_000;

export function tooLargeToHighlight(code: string): boolean {
  if (code.length > HIGHLIGHT_MAX_CHARS) return true;
  let lines = 1;
  for (let i = code.indexOf("\n"); i >= 0; i = code.indexOf("\n", i + 1)) if (++lines > HIGHLIGHT_MAX_LINES) return true;
  return false;
}
