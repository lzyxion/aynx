import type { DocFilesSeed } from "$lib/doc-files";

/**
 * 문서 → 문서 갈아 끼우기(`app/tabs` 의 `replaceTile` — 새 pane id)의 인계 자리. Map 이 아니라 한 칸이다 — 원격 창은 요청만 보내고
 * 메인 PC 가 새 id 를 붙여 꺼낼 사람이 없을 수 있으니 다음 표시가 덮어 쌓이지 않게.
 */

export const DOC_SWAP_FADE_MS = 120;

export interface DocSwap {
  paneId: string;
  files?: DocFilesSeed;
}

let slot: DocSwap | null = null;

/** 같은 id 에 이미 실린 파일 칸 인계는 `files` 없이 부르면 남긴다 */
export function noteDocSwap(paneId: string, files?: DocFilesSeed): void {
  if (files === undefined && slot?.paneId === paneId) return;
  slot = files === undefined ? { paneId } : { paneId, files };
}

export function takeDocSwap(paneId: string): DocSwap | null {
  if (slot === null || slot.paneId !== paneId) return null;
  const got = slot;
  slot = null;
  return got;
}
