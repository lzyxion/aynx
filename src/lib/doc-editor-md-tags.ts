import { Tag } from "@lezer/highlight";

/**
 * 마크다운 모드의 `tokenTable` 과 강조 표(`doc-editor-cm.ts`)가 같은 객체를 봐야 해서 뗀 모듈 — 모드를 강조 표 쪽에서
 * 정적으로 부르면 지연 로딩이 깨지고, 반대로 부르면 고리가 된다.
 */
const math = Tag.define();

export const mdTags = {
  math,
  mathMark: Tag.define(),
  /** 칠이 없으면 수식 본문 색을 따른다 */
  texCommand: Tag.define(math),
  footnoteRef: Tag.define(),
  footnoteDef: Tag.define(),
};
