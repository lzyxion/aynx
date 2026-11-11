/**
 * **문서 타일에 걸어 둔 "이 제목으로" 한 번** — 문서 안의 링크 `other.md#절` 을 따라 연 타일이, 글을 다 그린 뒤
 * 그 제목으로 스크롤하도록 (docs/log/2026-09-27-doc-tile.md "B7 — 상대 링크").
 *
 * 패널 명세(`PaneSpec`)에 적지 않는다 — 명세는 배치 파일에 저장 · 창 이관에 실리고, 이 값은 **한 번 쓰고 버리는**
 * 것이라서다. 타일 id 로 쥐고, 문서 타일이 읽어 스크롤하면(또는 그 제목이 없으면) [`clearDocAnchor`] 로 지운다.
 * 의존이 없는 잎 모듈이다(`PaneHost` 와 `app/panes.svelte.ts` 가 같이 쓴다 — 순환을 만들지 않게).
 *
 * 같은 모양의 **"이 줄로" 한 번**도 여기 산다 — 터미널의 `파일:12` 링크를 Ctrl+클릭해 연(또는 포커스만 옮긴) 타일이 글을
 * 그린 뒤 그 줄(1 기준)로 스크롤하고 잠깐 강조한다(`doc-line-jump.ts`). 쓰고 나면(또는 못 찾았으면) [`clearDocLine`].
 *
 * **"편집으로" 한 번**도 같은 모양이다 — 타일 ⋯ · 본문 우클릭의 [새 문서…](`app/new-doc`)로 만들어 연 타일이 글을 읽은 뒤 한 번
 * 편집을 시작한다([편집] 단추와 같은 문 — 막혔거나 편집기 지연 로딩이 실패하면 읽기 보기 그대로). 쓰고 나면 [`clearDocEdit`].
 */

const anchors = $state<Record<string, string>>({});
const lines = $state<Record<string, number>>({});
const edits = $state<Record<string, true>>({});

/** 이 타일이 글을 그린 뒤 찾아갈 앵커 — 없으면 `undefined` */
export function docAnchorOf(paneId: string): string | undefined {
  return anchors[paneId];
}

/** 앵커를 건다 — 같은 값을 다시 걸어도 한 번 지웠다 거는 것이라 문서가 다시 스크롤한다 */
export function setDocAnchor(paneId: string, anchor: string): void {
  anchors[paneId] = anchor;
}

/** 다 썼다(스크롤했거나 그 제목이 없었다) */
export function clearDocAnchor(paneId: string): void {
  if (paneId in anchors) delete anchors[paneId];
}

/** 이 타일이 글을 그린 뒤 찾아갈 줄(1 기준) — 없으면 `undefined` */
export function docLineOf(paneId: string): number | undefined {
  return lines[paneId];
}

/** 줄을 건다 — 앵커와 같이, 다 쓰고 지운 뒤 같은 줄을 다시 걸면 다시 스크롤한다 */
export function setDocLine(paneId: string, line: number): void {
  lines[paneId] = line;
}

/** 다 썼다(스크롤했거나 찾지 못했다) */
export function clearDocLine(paneId: string): void {
  if (paneId in lines) delete lines[paneId];
}

/** 이 타일이 글을 읽은 뒤 한 번 편집을 시작하는가 */
export function docEditOf(paneId: string): boolean {
  return edits[paneId] === true;
}

/** "편집으로" 를 건다 */
export function setDocEdit(paneId: string): void {
  edits[paneId] = true;
}

/** 다 썼다(편집을 시작했거나 읽기가 실패했다) */
export function clearDocEdit(paneId: string): void {
  if (paneId in edits) delete edits[paneId];
}
