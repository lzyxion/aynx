import type { MdBlock } from "$lib/markdown";
import { headingSlugs, inlineText } from "$lib/doc-links";

/** 문서 보기 타일의 목차 — 순수 모듈. */

/** `index` 는 거르기 전 목차에서의 자리 — 거른 목록에서도 "지금 절" 과 견줄 열쇠 */
export interface OutlineItem {
  /** [`headingSlugs`] 와 같은 이름이어야 앵커 스크롤이 찾는다 */
  slug: string;
  level: number;
  text: string;
  index: number;
}

/**
 * 최상위 제목만 싣는다(인용 · 알림 속 제목은 남의 글). 다만 이름은 문서 전체를 훑는 [`headingSlugs`] 의 것을 쓴다 —
 * 인용 속 제목도 겹침 번호를 먹으므로 최상위만 따로 세면 그린 제목의 `data-slug` 와 어긋난다.
 */
export function outlineOf(blocks: MdBlock[]): OutlineItem[] {
  const slugs = headingSlugs(blocks);
  const out: OutlineItem[] = [];
  for (const b of blocks) {
    if (b.kind !== "h") continue;
    const slug = slugs.get(b);
    if (slug === undefined) continue;
    out.push({
      slug,
      level: b.level,
      text: inlineText(b.inlines).trim(),
      index: out.length,
    });
  }
  return out;
}

export function filterOutline(items: readonly OutlineItem[], query: string): OutlineItem[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [...items];
  return items.filter((it) => it.text.toLocaleLowerCase().includes(q));
}

export const OUTLINE_BASELINE_PX = 24;

/** `tops` 는 스크롤 내용 기준 */
export interface ScrollView {
  tops: readonly number[];
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * 맨 아래까지 내렸으면 화면 안의 마지막 제목 — 짧은 끝 절들은 기준선까지 올라오지 못한다. `picked` 는 화면 안에 있는 동안 우선한다 —
 * 아니면 끝 근처 짧은 절을 골라도 앞 절이 강조돼 고른 것이 무시된 것처럼 보인다.
 */
export function currentSection(v: ScrollView, picked: number | null = null): number {
  const n = v.tops.length;
  if (n === 0) return -1;
  const bottomEdge = v.scrollTop + v.clientHeight;
  if (picked !== null && picked >= 0 && picked < n) {
    const t = v.tops[picked];
    if (t >= v.scrollTop - 1 && t < bottomEdge) return picked;
  }
  const atBottom = v.scrollHeight - bottomEdge <= 2 && v.scrollTop > 0;
  if (atBottom) {
    for (let i = n - 1; i >= 0; i--) if (v.tops[i] < bottomEdge) return i;
    return -1;
  }
  const line = v.scrollTop + OUTLINE_BASELINE_PX;
  let cur = -1;
  for (let i = 0; i < n; i++) {
    if (v.tops[i] <= line) cur = i;
    else break;
  }
  return cur;
}

export const OUTLINE_NARROW_PX = 640;

/** 폭을 아직 못 쟀으면(0) 넓은 쪽 */
export function isNarrowOutline(width: number): boolean {
  return width > 0 && width < OUTLINE_NARROW_PX;
}

/** `scrollIntoView` 는 쓰지 않는다 — 조상의 넘침 숨김 상자까지 밀어 타일 배치를 흔든다 */
export function revealScrollTop(scrollTop: number, viewHeight: number, rowTop: number, rowHeight: number): number {
  if (rowTop < scrollTop) return Math.max(0, rowTop);
  if (rowTop + rowHeight > scrollTop + viewHeight) return Math.max(0, rowTop + rowHeight - viewHeight);
  return scrollTop;
}
