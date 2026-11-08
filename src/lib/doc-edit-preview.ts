import type { MdBlock, MdOptions } from "$lib/markdown";
import { headingLines } from "$lib/markdown";
import { headingSlugs } from "$lib/doc-links";
import type { DocEditView } from "$lib/session";

/**
 * **문서 편집 중 미리 보기** — 순수 모듈. 보이는 보기([`visibleEditView`]) · 경계 비율([`clampDocSplit`] ·
 * [`splitAt`]) · 원문 줄 → 절([`sectionLines`] · [`sectionAt`]). 편집기 · 그린 보기 · 디바운스 · 스크롤은 `DocView` 가 한다.
 *
 * 고른 보기(`PaneSpec.docEditView`)는 넓은 타일의 것이다 — 좁은 타일은 [원문 | 미리 보기] 두 칸 탭이고 그 탭은
 * 저장하지 않는다(타일이 넓어지면 고른 값이 그대로 돌아온다).
 */

/** 이 폭(px) 이상이면 넓은 타일 — 세 칸 묶음 [원문만 | 나란히 | 미리 보기만]. 미만이면 두 칸 탭 */
export const EDIT_WIDE_PX = 900;

/** 넓은 타일인가 — 폭을 아직 못 쟀으면(0) 넓은 쪽으로 본다(목차의 `isNarrowOutline` 과 같은 규칙) */
export function isWideEdit(width: number): boolean {
  return width <= 0 || width >= EDIT_WIDE_PX;
}

/** 좁은 타일의 두 칸 탭 */
export type NarrowEditTab = "source" | "preview";

/**
 * 지금 **보이는** 보기 — 넓으면 고른 값, 좁으면 두 칸 탭의 값(나란히는 좁은 타일에 없다). 고른 값은 바꾸지 않는다.
 */
export function visibleEditView(chosen: DocEditView, width: number, tab: NarrowEditTab): DocEditView {
  return isWideEdit(width) ? chosen : tab;
}

/** 좁은 탭의 처음 값 — "미리 보기만" 을 골라 두었으면 미리 보기, 아니면 원문 */
export function narrowTabOf(chosen: DocEditView): NarrowEditTab {
  return chosen === "preview" ? "preview" : "source";
}

/** 나란히의 왼쪽(편집기) 몫 — 기본 · 한계 */
export const DOC_SPLIT_DEFAULT = 0.5;
export const DOC_SPLIT_MIN = 0.2;
export const DOC_SPLIT_MAX = 0.8;

/** 비율을 20~80% 로 묶는다. 숫자가 아니면 기본(50%) */
export function clampDocSplit(r: unknown): number {
  if (typeof r !== "number" || !Number.isFinite(r)) return DOC_SPLIT_DEFAULT;
  return Math.min(DOC_SPLIT_MAX, Math.max(DOC_SPLIT_MIN, r));
}

/** 끄는 손가락 자리 → 비율 (상자 왼쪽 · 폭은 끌기 시작 때 잰 것). 폭을 못 쟀으면 기본 */
export function splitAt(x: number, left: number, width: number): number {
  if (!(width > 0)) return DOC_SPLIT_DEFAULT;
  return clampDocSplit((x - left) / width);
}

/** 절 하나의 시작 — `line` 은 0 기준 원문 줄, `slug` 는 그린 제목의 `data-slug` */
export interface SectionLine {
  line: number;
  slug: string;
}

/**
 * 원문의 **최상위 제목 줄 ↔ 그린 제목의 이름**. 이름은 [`headingSlugs`] 의 것(문서 전체 번호 — 인용 속 제목도
 * 겹침 번호를 먹는다), 싣는 것은 목차(`outlineOf`)와 같이 **최상위만** — 인용(알림 포함) 속 제목은 남의 글이라 절이 아니다.
 *
 * `blocks` 는 **같은 글**을 `parseMarkdown` 한 것이어야 한다. 줄 훑기(`headingLines`)와 블록의 제목 수가 다르면
 * (둘이 어긋났다 — 고칠 버그) 빈 목록을 돌려 맞추기를 쉬게 한다: 엉뚱한 절로 가느니 가만히 있는다.
 */
export function sectionLines(src: string, blocks: MdBlock[], opts?: MdOptions): SectionLine[] {
  const slugs = [...headingSlugs(blocks).values()];
  // 파싱 선택을 받으면 그대로(문서 타일은 `DOC_TILE_MD` — 수식 블록 속 `#` 줄이 제목으로 세어지지 않게). 없으면 머리말만
  // 블록에서 짐작한다 — 머리말을 뗀 블록이면 원문 쪽도 같이 뗀다(머리말 속 `#` 줄이 제목 줄로 세어지면 개수가 어긋난다)
  const heads = headingLines(src, opts ?? { frontmatter: blocks[0]?.kind === "frontmatter" });
  if (heads.length !== slugs.length) return [];
  const out: SectionLine[] = [];
  heads.forEach((h, k) => {
    if (!h.quoted) out.push({ line: h.line, slug: slugs[k] });
  });
  return out;
}

/** 그 줄(0 기준)이 속한 절 — 바로 위(같은 줄 포함)의 마지막 제목. 첫 제목 위면 `null` */
export function sectionAt(sections: readonly SectionLine[], line: number): string | null {
  let cur: string | null = null;
  for (const s of sections) {
    if (s.line <= line) cur = s.slug;
    else break;
  }
  return cur;
}

/** 편집기에서 지금 보이는 줄 범위(0 기준, 양끝 포함) — 아직 스크롤을 못 쟀으면 끝이 무한 */
export interface EditorViewport {
  top: number;
  bottom: number;
}

/**
 * 스크롤 맞추기가 미리 보기를 데려갈 절 — **한 방향만**(편집기 → 미리 보기, 미리 보기를 밀어도 편집기는 가만히다).
 *
 * 커서가 편집기 화면 안에 있으면 커서 줄의 절, 커서를 두고 편집기만 스크롤해 커서가 화면 밖이면 맨 위 줄의 절.
 * 두 몸짓이 한 기준 하나로 모여 서로 다투지 않는다. 첫 제목 위면 `null`(미리 보기 맨 위).
 */
export function syncTarget(sections: readonly SectionLine[], cursor: number, view: EditorViewport): string | null {
  const inView = cursor >= view.top && cursor <= view.bottom;
  return sectionAt(sections, inView ? cursor : view.top);
}
