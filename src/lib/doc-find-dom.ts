import { findMatches, joinChunks, locateMatch, type FindChunk } from "$lib/doc-find";

/**
 * 문서 안 검색의 DOM 층 — CSS Custom Highlight API 로 칠해 DOM 을 한 글자도 바꾸지 않는다.
 * `::highlight(이름)` 은 스타일시트에 글자로 적혀야 칠해지므로 이름은 둘뿐이다 — 창 전체가 나눠 쓰고 범위를 주인(타일)별로 넣고 뺀다.
 */

export const FIND_HL = "doc-find";
export const FIND_HL_CURRENT = "doc-find-current";

/** 수식(`data-math`)은 KaTeX 출력에 같은 글자가 두 번이고 기호가 쪼개져 셈이 어긋난다 — 받기 전 원문도 같이 빼 그려지기 전후로 일치 수가 같게 */
const SKIP = '[aria-hidden="true"], svg, button, [data-mermaid], [data-math], input, textarea, [data-find-skip]';

/** 일치가 이 경계를 건너지 못한다. 인라인 요소는 덩어리가 아니다 */
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dd, dt, figcaption, div";

function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) return (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return (n as Text).data === "" ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n as Text);
  return out;
}

export function findRanges(root: HTMLElement, query: string, caseSensitive: boolean): Range[] {
  if (query === "") return [];
  const nodes = textNodes(root);
  const chunks: FindChunk[] = nodes.map((n) => ({ text: n.data, block: n.parentElement?.closest(BLOCK) ?? root }));
  const joined = joinChunks(chunks);
  const out: Range[] = [];
  for (const m of findMatches(joined.text, query, caseSensitive)) {
    const span = locateMatch(joined, m);
    if (!span) continue;
    const r = document.createRange();
    r.setStart(nodes[span.startChunk], span.startOffset);
    r.setEnd(nodes[span.endChunk], span.endOffset);
    out.push(r);
  }
  return out;
}

/** 모르면(시험 환경) 칠하지 않고 셈 · 이동만 산다 */
function supported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

const owned = new Map<object, { all: Range[]; current: Range | null }>();

function registry(): { all: Highlight; current: Highlight } | null {
  if (!supported()) return null;
  let all = CSS.highlights.get(FIND_HL);
  if (!all) {
    all = new Highlight();
    CSS.highlights.set(FIND_HL, all);
  }
  let current = CSS.highlights.get(FIND_HL_CURRENT);
  if (!current) {
    current = new Highlight();
    current.priority = 1;
    CSS.highlights.set(FIND_HL_CURRENT, current);
  }
  return { all, current };
}

export function paintFind(owner: object, all: readonly Range[], current: Range | null): void {
  const reg = registry();
  if (!reg) return;
  const prev = owned.get(owner);
  if (prev) {
    for (const r of prev.all) reg.all.delete(r);
    if (prev.current) reg.current.delete(prev.current);
  }
  for (const r of all) reg.all.add(r);
  if (current) reg.current.add(current);
  owned.set(owner, { all: [...all], current });
}

export function clearFind(owner: object): void {
  paintFind(owner, [], null);
  owned.delete(owner);
}
