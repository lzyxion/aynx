import type { MdBlock, MdOptions } from "$lib/markdown";
import { headingLines } from "$lib/markdown";
import { headingSlugs } from "$lib/doc-links";
import type { DocEditView } from "$lib/session";

/** 문서 편집 중 미리 보기의 순수 판정. 좁은 타일의 두 칸 탭은 저장하지 않는다 — `PaneSpec.docEditView` 는 넓은 타일의 값이다. */

export const EDIT_WIDE_PX = 900;

/** 폭을 아직 못 쟀으면(0) 넓은 쪽 — 목차의 `isNarrowOutline` 과 같은 규칙 */
export function isWideEdit(width: number): boolean {
  return width <= 0 || width >= EDIT_WIDE_PX;
}

export type NarrowEditTab = "source" | "preview";

export function visibleEditView(chosen: DocEditView, width: number, tab: NarrowEditTab): DocEditView {
  return isWideEdit(width) ? chosen : tab;
}

export function narrowTabOf(chosen: DocEditView): NarrowEditTab {
  return chosen === "preview" ? "preview" : "source";
}

export const DOC_SPLIT_DEFAULT = 0.5;
export const DOC_SPLIT_MIN = 0.2;
export const DOC_SPLIT_MAX = 0.8;

export function clampDocSplit(r: unknown): number {
  if (typeof r !== "number" || !Number.isFinite(r)) return DOC_SPLIT_DEFAULT;
  return Math.min(DOC_SPLIT_MAX, Math.max(DOC_SPLIT_MIN, r));
}

export function splitAt(x: number, left: number, width: number): number {
  if (!(width > 0)) return DOC_SPLIT_DEFAULT;
  return clampDocSplit((x - left) / width);
}

/** `line` 은 0 기준 원문 줄, `slug` 는 그린 제목의 `data-slug` */
export interface SectionLine {
  line: number;
  slug: string;
}

/**
 * `blocks` 는 같은 글을 `parseMarkdown` 한 것이어야 한다. 줄 훑기와 블록의 제목 수가 다르면 빈 목록 — 엉뚱한 절로 가느니
 * 가만히 있는다. 인용(알림 포함) 속 제목은 번호는 먹되 절로 싣지 않는다(목차 `outlineOf` 와 같다).
 */
export function sectionLines(src: string, blocks: MdBlock[], opts?: MdOptions): SectionLine[] {
  const slugs = [...headingSlugs(blocks).values()];
  // 머리말 · 수식 블록 속 `#` 줄이 제목으로 세어지면 개수가 어긋난다 — 파싱 선택을 블록과 맞춘다
  const heads = headingLines(src, opts ?? { frontmatter: blocks[0]?.kind === "frontmatter" });
  if (heads.length !== slugs.length) return [];
  const out: SectionLine[] = [];
  heads.forEach((h, k) => {
    if (!h.quoted) out.push({ line: h.line, slug: slugs[k] });
  });
  return out;
}

export function sectionAt(sections: readonly SectionLine[], line: number): string | null {
  let cur: string | null = null;
  for (const s of sections) {
    if (s.line <= line) cur = s.slug;
    else break;
  }
  return cur;
}

/** 0 기준, 양끝 포함 */
export interface EditorViewport {
  top: number;
  bottom: number;
}

/** 한 방향만(편집기 → 미리 보기). 커서가 화면 밖이면 맨 위 줄 기준 — 두 몸짓이 한 기준으로 모여 서로 다투지 않는다 */
export function syncTarget(sections: readonly SectionLine[], cursor: number, view: EditorViewport): string | null {
  const inView = cursor >= view.top && cursor <= view.bottom;
  return sectionAt(sections, inView ? cursor : view.top);
}
