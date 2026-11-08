import { findMatches, joinChunks, locateMatch, type FindChunk } from "$lib/doc-find";

/**
 * **문서 안 검색 — DOM 층**. 상자 안의 보이는 글자 노드를 훑어 일치마다 `Range` 를 만들고([`findRanges`]),
 * **CSS Custom Highlight API** 로 칠한다([`paintFind`]) — DOM 을 한 글자도 바꾸지 않는다(그린 블록 · 선택 · 스크롤 ·
 * mermaid SVG 가 그대로다). 규칙(잇기 · 자리 셈)은 `doc-find.ts` 의 순수 함수다.
 *
 * ## 하이라이트 이름은 둘뿐이다
 *
 * `::highlight(이름)` 은 스타일시트에 **글자로** 적혀야 칠해지므로 타일마다 이름을 만들 수 없다. 그래서 이름 둘
 * ([`FIND_HL`] · [`FIND_HL_CURRENT`])을 창 전체가 나눠 쓰고, 그 안의 범위를 **주인(타일)별로** 넣고 뺀다 — 문서 타일
 * 여럿이 동시에 찾아도 서로의 칠을 지우지 않는다. 색은 `DocView` 의 스타일이 준다.
 */

export const FIND_HL = "doc-find";
export const FIND_HL_CURRENT = "doc-find-current";

/**
 * 훑지 않는 곳 — 줄 번호 거터 · 그림(`aria-hidden`), mermaid 다이어그램(SVG — 글자가 그림의 일부다), 수식(`data-math` —
 * KaTeX 출력은 보이는 HTML 과 숨긴 MathML 에 같은 글자가 두 번이고 기호가 글자 노드로 쪼개져 셈이 어긋난다 · 받기 전 원문도
 * 같이 빼 그려지기 전후로 일치 수가 바뀌지 않게), 단추(코드 블록 [복사] 따위 — 글의 일부가 아니다), 그리고 그리는 쪽이
 * `data-find-skip` 을 단 곳(diff 의 +/- 표 · 줄 코멘트 카드 따위 — 본문이 아닌 글자). 요소에서 걸러 **그 아래를 통째로**
 * 건너뛴다(노드마다 `closest` 를 묻지 않는다).
 */
const SKIP = '[aria-hidden="true"], svg, button, [data-mermaid], [data-math], input, textarea, [data-find-skip]';

/** 글자 노드의 덩어리 — 일치가 이 경계를 건너지 못한다(`joinChunks`). 인라인 요소(굵게 · 링크 · 코드 강조)는 덩어리가 아니다 */
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dd, dt, figcaption, div";

/** 상자 안의 글자 노드들 — 문서 순서 */
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

/** 상자 안 일치들의 범위 — 문서 순서. 빈 질의면 빈 목록 */
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

/** 이 웹뷰가 Custom Highlight 를 아는가 — 모르면(시험 환경) 칠하지 않고 셈 · 이동만 산다 */
function supported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/** 주인(타일) → 지금 넣어 둔 범위들 */
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
    // 지금 일치가 모든 일치의 칠 위에 선다
    current.priority = 1;
    CSS.highlights.set(FIND_HL_CURRENT, current);
  }
  return { all, current };
}

/** 그 주인의 칠을 바꾼다 — 다른 주인의 범위는 건드리지 않는다 */
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

/** 그 주인의 칠을 걷는다 — 띠를 닫을 때 · 타일이 내려갈 때 */
export function clearFind(owner: object): void {
  paintFind(owner, [], null);
  owned.delete(owner);
}
