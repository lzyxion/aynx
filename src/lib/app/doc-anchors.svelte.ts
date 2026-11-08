/**
 * **문서 타일에 걸어 둔 "이 제목으로" 한 번** — 문서 안의 링크 `other.md#절` 을 따라 연 타일이, 글을 다 그린 뒤
 * 그 제목으로 스크롤하도록 (docs/log/2026-09-27-doc-tile.md "B7 — 상대 링크").
 *
 * 패널 명세(`PaneSpec`)에 적지 않는다 — 명세는 배치 파일에 저장 · 창 이관에 실리고, 이 값은 **한 번 쓰고 버리는**
 * 것이라서다. 타일 id 로 쥐고, 문서 타일이 읽어 스크롤하면(또는 그 제목이 없으면) [`clearDocAnchor`] 로 지운다.
 * 의존이 없는 잎 모듈이다(`PaneHost` 와 `app/panes.svelte.ts` 가 같이 쓴다 — 순환을 만들지 않게).
 */

const anchors = $state<Record<string, string>>({});

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
