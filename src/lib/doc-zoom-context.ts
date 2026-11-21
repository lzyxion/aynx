/**
 * 문서 글자 크기 배율을 아래로 알리는 문 — 글자 크기 자체는 CSS 변수(`--doc-zoom`)가 옮기고, 이것은 둘레 글자 크기로 다시 그려야 하는
 * 자식(`MermaidView`)을 깨우는 신호뿐이다. 문서 타일 밖에는 없다(`undefined`).
 */
import { getContext, setContext } from "svelte";

const KEY = Symbol("doc-zoom");

/** 컴포넌트 초기화 중에 부른다 */
export function provideDocZoom(get: () => number): void {
  setContext(KEY, get);
}

export function docZoomContext(): (() => number) | undefined {
  return getContext<(() => number) | undefined>(KEY);
}
