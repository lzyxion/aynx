/** 문서 안 검색의 순수 층 — 문서 타일 · AI 타일의 대화 면 · diff 타일의 패치가 같은 규칙으로 찾는다. */

/** `[start, end)` */
export interface FindMatch {
  start: number;
  end: number;
}

/** 한 글자 질의로 큰 파일을 훑을 때 화면이 굳지 않게 */
export const FIND_LIMIT = 5000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `query/grid-find.ts` 가 칸마다 새로 만들지 않고 `lastIndex` 만 되돌려 쓴다 */
export function findRegExp(query: string, caseSensitive: boolean): RegExp {
  return new RegExp(escapeRe(query), caseSensitive ? "gu" : "giu");
}

/** 대소문자 무시는 정규식의 `i` 로 한다 — 소문자로 바꿔 견주면 글자 수가 바뀌는 글자(`İ` 등)에서 자리가 어긋난다 */
export function findMatches(text: string, query: string, caseSensitive: boolean, limit = FIND_LIMIT): FindMatch[] {
  if (query === "") return [];
  const re = findRegExp(query, caseSensitive);
  const out: FindMatch[] = [];
  for (let m = re.exec(text); m !== null && out.length < limit; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** `block` 이 같은 토막끼리만 일치가 이어진다 */
export interface FindChunk {
  text: string;
  block: unknown;
}

export interface JoinedChunks {
  text: string;
  starts: number[];
}

/** 덩어리가 바뀌는 자리에 줄바꿈 하나 — 검색 칸은 한 줄이라 질의에 줄바꿈이 없으니 일치가 문단 경계를 건너지 못한다 */
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

/** 끝은 배타 */
export interface MatchSpan {
  startChunk: number;
  startOffset: number;
  endChunk: number;
  endOffset: number;
}

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

/** 끝은 `end - 1` 이 든 토막 기준 — 토막 끝에서 끝나는 일치가 다음 토막으로 새지 않는다 */
export function locateMatch(joined: JoinedChunks, m: FindMatch): MatchSpan | null {
  if (joined.starts.length === 0 || m.end <= m.start) return null;
  const a = chunkAt(joined.starts, m.start);
  const b = chunkAt(joined.starts, m.end - 1);
  return { startChunk: a, startOffset: m.start - joined.starts[a], endChunk: b, endOffset: m.end - joined.starts[b] };
}

export function stepMatch(cur: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (cur < 0 || cur >= count) return dir === 1 ? 0 : count - 1;
  return (cur + dir + count) % count;
}

/** `topOf` 는 문서 순서라 줄지 않는다 — 좌표 재기가 싸지 않아 이분 탐색으로 몇 개만 잰다 */
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

export function revealOffset(scroll: number, view: number, start: number, size: number): number {
  if (start >= scroll && start + size <= scroll + view) return scroll;
  return Math.max(0, Math.round(start - view / 3));
}
