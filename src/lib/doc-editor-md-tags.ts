import { Tag } from "@lezer/highlight";

/**
 * **편집기 마크다운 모드의 따로 칠하는 표지** — 수식 · 각주(2026-11-11).
 *
 * lezer `tags` 에 맞는 이름이 없어 새로 만든다. 모드(`doc-editor-markdown.ts` — 늦게 받는다)의 `tokenTable` 과 강조 표
 * (`doc-editor-cm.ts`)가 **같은 객체**를 봐야 해서 둘 사이의 작은 모듈로 뗐다(모드를 강조 표 쪽에서 정적으로 부르면 지연 로딩이
 * 깨지고, 반대로 부르면 고리가 된다).
 */
const math = Tag.define();

export const mdTags = {
  /** 수식 본문 — `$…$` · `$$…$$` · ```math 안 */
  math,
  /** 수식의 여닫는 표식 — `$` · `$$` · `` $` `` · `` `$ `` */
  mathMark: Tag.define(),
  /** 수식 속 TeX 명령어 `\frac` — 칠이 없으면 수식 본문 색을 따른다 */
  texCommand: Tag.define(math),
  /** 각주 참조 `[^id]` */
  footnoteRef: Tag.define(),
  /** 각주 정의 줄의 머리 `[^id]:` */
  footnoteDef: Tag.define(),
};
