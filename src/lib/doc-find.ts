/**
 * **문서 안 검색 — 순수 층** (문서 보기 타일의 `Ctrl+F`). 글자에서 일치를 찾고([`findMatches`]), 글자 토막(DOM 의
 * 텍스트 노드) 여럿을 한 줄로 이어 찾은 자리를 다시 토막 좌표로 돌리고([`joinChunks`] · [`locateMatch`]), 다음 · 이전
 * 자리([`stepMatch`]) · 처음 고를 자리([`firstFrom`]) · 보이게 밀 양([`revealOffset`])을 정한다.
 *
 * DOM(텍스트 노드 훑기 · `Range` · CSS Custom Highlight)은 `doc-find-dom.ts`, 띠와 키는 `FindBar` · `DomFindBar` 가 한다 —
 * 문서 타일만이 아니라 AI 타일의 대화 면 · diff 타일의 패치도 같은 규칙으로 찾는다(쿼리 결과 표는 `query/grid-find.ts` 가 칸 글자로).
 */

/** 이은 글 안의 한 일치 — `[start, end)` */
export interface FindMatch {
  start: number;
  end: number;
}

/** 일치가 너무 많으면 여기서 멈춘다 — 한 글자 질의로 큰 코드 파일을 훑을 때 화면이 굳지 않게 */
export const FIND_LIMIT = 5000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 질의 하나의 정규식 — 글자 그대로(특수 글자는 이스케이프) · 전역(`g`) · 유니코드. 같은 질의로 칸 여럿을 훑는 쪽(쿼리 결과 표 —
 * `query/grid-find.ts`)이 칸마다 새로 만들지 않고 `lastIndex` 만 되돌려 쓴다. 빈 질의는 부르는 쪽이 거른다.
 */
export function findRegExp(query: string, caseSensitive: boolean): RegExp {
  return new RegExp(escapeRe(query), caseSensitive ? "gu" : "giu");
}

/**
 * 글자 그대로의 일치들(정규식이 아니다) — 겹치지 않게 앞에서부터. 빈 질의면 없음. 대소문자 무시는 정규식의 `i`
 * 로 한다 — 소문자로 바꿔 견주면 글자 수가 바뀌는 글자(`İ` 등)에서 자리가 어긋난다.
 */
export function findMatches(text: string, query: string, caseSensitive: boolean, limit = FIND_LIMIT): FindMatch[] {
  if (query === "") return [];
  const re = findRegExp(query, caseSensitive);
  const out: FindMatch[] = [];
  for (let m = re.exec(text); m !== null && out.length < limit; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** 글자 토막 하나 — `block` 이 같은 토막끼리만 일치가 이어진다(문단 · 칸 · 코드 블록 따위) */
export interface FindChunk {
  text: string;
  block: unknown;
}

/** 이은 글 — `starts[k]` 는 토막 k 가 이은 글에서 시작하는 자리 */
export interface JoinedChunks {
  text: string;
  starts: number[];
}

/**
 * 토막들을 한 줄로 잇는다. **덩어리(`block`)가 바뀌는 자리에 줄바꿈 하나**를 끼운다 — 그 글자는 어느 토막에도
 * 속하지 않고, 검색 칸은 한 줄이라 질의에 줄바꿈이 없으니 일치가 문단 경계를 건너지 못한다. 같은 덩어리 안의 토막
 * (`**굵게**` 앞뒤 · 코드 강조의 조각)은 틈 없이 이어져 그 경계를 건너는 일치도 찾는다.
 */
export function joinChunks(chunks: readonly FindChunk[]): JoinedChunks {
  let text = "";
  const starts: number[] = [];
  let prev: unknown = undefined;
  chunks.forEach((c, k) => {
    if (k > 0 && c.block !== prev) text += "\n";
    starts.push(text.length);
    text += c.text;
    prev = c.block;
  });
  return { text, starts };
}

/** 일치의 토막 좌표 — 시작 토막 · 그 안의 자리, 끝 토막 · 그 안의 자리(끝은 배타) */
export interface MatchSpan {
  startChunk: number;
  startOffset: number;
  endChunk: number;
  endOffset: number;
}

/** 이은 글의 자리 `pos` 가 든 토막 — `starts` 를 이분 탐색. 사이 줄바꿈 자리면 그 앞 토막 */
function chunkAt(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 일치 → 토막 좌표. 끝은 `end - 1`(마지막 글자)이 든 토막 기준이라 토막 끝에서 끝나는 일치가 다음 토막으로 새지 않는다 */
export function locateMatch(joined: JoinedChunks, m: FindMatch): MatchSpan | null {
  if (joined.starts.length === 0 || m.end <= m.start) return null;
  const a = chunkAt(joined.starts, m.start);
  const b = chunkAt(joined.starts, m.end - 1);
  return { startChunk: a, startOffset: m.start - joined.starts[a], endChunk: b, endOffset: m.end - joined.starts[b] };
}

/** 다음(`+1`) · 이전(`-1`) 일치 — 끝에서 처음으로 돈다. 일치가 없으면 -1, 아직 고른 것이 없으면 처음 · 마지막 */
export function stepMatch(cur: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (cur < 0 || cur >= count) return dir === 1 ? 0 : count - 1;
  return (cur + dir + count) % count;
}

/**
 * 질의를 바꿨을 때 처음 고를 일치 — 위 좌표(`topOf(i)`, 문서 순서라 줄지 않는다)가 지금 보는 자리(`from`) 이상인 첫
 * 일치. 모두 위에 있으면 처음(돈다). 일치가 없으면 -1. 좌표 재기(`getBoundingClientRect`)가 싸지 않아 이분 탐색으로
 * 몇 개만 잰다.
 */
export function firstFrom(count: number, topOf: (i: number) => number, from: number): number {
  if (count <= 0) return -1;
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (topOf(mid) >= from) hi = mid;
    else lo = mid + 1;
  }
  return lo >= count ? 0 : lo;
}

/**
 * 한 축으로 상자를 얼마나 밀어야 그 범위가 보이나 — 이미 보이면 지금 자리 그대로, 아니면 범위를 상자의 1/3 지점에 둔다
 * (바로 가장자리에 붙이면 앞뒤 글이 안 보인다). 좌표는 모두 상자 내용 기준.
 */
export function revealOffset(scroll: number, view: number, start: number, size: number): number {
  if (start >= scroll && start + size <= scroll + view) return scroll;
  return Math.max(0, Math.round(start - view / 3));
}
