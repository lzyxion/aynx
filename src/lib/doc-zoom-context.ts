/**
 * **문서 글자 크기를 아래로 알리는 문** — `DocView` 가 배율 읽기 함수를 내려 주고, 글자 크기로 **다시 그려야 하는**
 * 자식(`MermaidView` — 둘레 글자 크기로 SVG 를 그린다)이 그 함수를 읽어 배율이 바뀌면 깨어난다. 글자 크기 자체는
 * CSS 변수(`--doc-zoom`)가 옮기므로 이 문은 "다시 재라" 는 신호뿐이다. 문서 타일 밖(기록 보기 등)에는 없다(`undefined`).
 */
import { getContext, setContext } from "svelte";

const KEY = Symbol("doc-zoom");

/** 문서 타일이 제 배율(%)을 읽는 함수를 내려 준다 — 컴포넌트 초기화 중에 부른다 */
export function provideDocZoom(get: () => number): void {
  setContext(KEY, get);
}

/** 위의 문서 타일 배율 읽기 함수 — 없으면 `undefined` */
export function docZoomContext(): (() => number) | undefined {
  return getContext<(() => number) | undefined>(KEY);
}
