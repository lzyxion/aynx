import type { MdBlock } from "$lib/markdown";
import { headingSlugs, inlineText } from "$lib/doc-links";

/**
 * **문서 보기 타일의 목차** — 순수 모듈. 그린 마크다운의 제목 → 목차 항목([`outlineOf`]) · 거르기([`filterOutline`]) ·
 * 지금 읽는 절([`currentSection`]) · 좁은 타일 판정([`isNarrowOutline`]). 패널 · 드롭다운 · 스크롤은 `DocView` 가 한다.
 */

/** 목차 한 줄 — `index` 는 거르기 전 목차에서의 자리(거른 목록에서도 "지금 절" 과 견줄 열쇠) */
export interface OutlineItem {
  /** 제목 요소의 `data-slug` — [`headingSlugs`] 와 **같은 이름**이어야 앵커 스크롤이 찾는다 */
  slug: string;
  level: number;
  text: string;
  index: number;
}

/**
 * 블록 → 목차. **최상위 제목만** 싣는다 — 인용 속 제목은 남의 글을 옮겨 적은 것이지 이 문서의 뼈대가 아니다.
 * 알림(`> [!NOTE]`) 속 제목도 같다(알림은 인용의 한 모양이다).
 * 다만 이름은 문서 전체를 훑는 [`headingSlugs`] 의 것을 그대로 쓴다: 인용 · 알림 속 제목도 겹침 번호(`-1`)를 먹으므로,
 * 최상위만 따로 세면 그린 제목의 `data-slug` 와 어긋난다.
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

/** 거르기 — 대소문자 무시 부분 일치. 빈 질의면 전부. 부모 제목 맥락은 살리지 않는다(목차가 짧아 찾는 것이 먼저) */
export function filterOutline(items: readonly OutlineItem[], query: string): OutlineItem[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [...items];
  return items.filter((it) => it.text.toLocaleLowerCase().includes(q));
}

/** 본문 상단에서 이만큼 아래가 "읽는 자리" 기준선이다 — 제목이 이 선을 지나면 그 절에 들어온 것 */
export const OUTLINE_BASELINE_PX = 24;

/** 본문 스크롤 상자의 지금 모양 — `tops` 는 목차 순서대로 각 제목의 **스크롤 내용 기준** 위 좌표 */
export interface ScrollView {
  tops: readonly number[];
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * 지금 읽는 절 — 기준선(본문 상단 + [`OUTLINE_BASELINE_PX`])을 이미 지난 **마지막** 제목의 자리. 아직 첫 제목 위면 `-1`.
 *
 * - 맨 아래까지 내렸으면 화면 안에 보이는 마지막 제목 — 짧은 끝 절들은 기준선까지 올라오지 못한다.
 * - `picked` (목차에서 방금 고른 자리)는 그 제목이 화면 안에 있는 동안 우선한다 — 끝 근처 짧은 절을 골랐는데
 *   스크롤이 더 못 내려가 앞 절이 강조되면 고른 것이 무시된 것처럼 보인다.
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

/** 이보다 좁은 타일은 곁 패널 대신 도구줄 드롭다운으로 목차를 보인다 */
export const OUTLINE_NARROW_PX = 640;

/** 좁은 타일인가 — 폭을 아직 못 쟀으면(0) 넓은 쪽으로 본다(재기 전에는 판정하지 않는다) */
export function isNarrowOutline(width: number): boolean {
  return width > 0 && width < OUTLINE_NARROW_PX;
}

/**
 * 목록 상자를 얼마나 밀어야 그 줄이 보이나 — 줄이 상자 안이면 지금 `scrollTop` 그대로. 좌표는 모두 목록 내용 기준.
 * (`scrollIntoView` 는 조상의 넘침 숨김 상자까지 밀어 타일 배치를 흔든다 — 목록 상자만 민다.)
 */
export function revealScrollTop(scrollTop: number, viewHeight: number, rowTop: number, rowHeight: number): number {
  if (rowTop < scrollTop) return Math.max(0, rowTop);
  if (rowTop + rowHeight > scrollTop + viewHeight) return Math.max(0, rowTop + rowHeight - viewHeight);
  return scrollTop;
}
