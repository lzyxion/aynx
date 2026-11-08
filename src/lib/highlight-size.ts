/**
 * **강조를 할지 말지의 크기 판정** — `highlight.ts` 에서 떼어 낸 조각이다(2026-09-27, 문서 보기 B6).
 *
 * 강조기(`highlight.ts` — lowlight + 언어 22개)는 **동적 import** 로만 불러 메인 청크에서 뺐다
 * (`highlight-loader.ts`). 그런데 `DocView` 는 "강조를 껐다" 띠를 걸려고 이 판정을 **곧바로** 봐야 한다 —
 * 판정이 강조기 모듈 안에 있으면 그 정적 import 한 줄이 강조기 전체를 메인 청크로 도로 끌고 온다.
 * 그래서 판정만 여기 두고, 강조기와 화면이 **같은 함수**를 본다(`highlight.ts` 가 다시 내보낸다).
 */

/** 이보다 긴 글은 강조하지 않는다(평문) — 트리가 수십만 노드가 되면 그리는 데 초가 걸린다 */
export const HIGHLIGHT_MAX_LINES = 20_000;
/** 글자 수 기준(UTF-16 단위 — 바이트와 거의 같은 규모면 된다) */
export const HIGHLIGHT_MAX_CHARS = 1_000_000;

/** 강조하기에 너무 큰가 — 화면이 "강조를 껐다" 띠를 걸 때도 이것 하나를 본다 */
export function tooLargeToHighlight(code: string): boolean {
  if (code.length > HIGHLIGHT_MAX_CHARS) return true;
  let lines = 1;
  for (let i = code.indexOf("\n"); i >= 0; i = code.indexOf("\n", i + 1)) if (++lines > HIGHLIGHT_MAX_LINES) return true;
  return false;
}
