import type { DocFilesSeed } from "$lib/doc-files";

/**
 * **문서 → 문서 갈아 끼우기의 인계 자리** — 순수 모듈(2026-11-20 — 사용자 B 안).
 *
 * 문서 타일에서 문서만 바꾸는 길(파일 칸에서 고름 `app/panes` 의 `switchDocHere` · 파일 타일의 미리 보기 바꾸기 `openDoc` 의 replace ·
 * 원격 창의 같은 요청)은 새 명세 · 새 pane id 로 칸을 갈아 끼운다(`app/tabs` 의 `replaceTile`). 그 갈아 끼우기는 타일 등장 애니메이션 없이
 * 뚝 바뀌고(`replaceTile` 이 배치 애니메이션을 켜지 않는다), 새 `DocView` 는 **본문만** 짧게 떠오른다. 새 `DocView` 가 "나는 갈아 끼워진
 * 문서다" 와 옛 파일 칸의 상태를 알 길이 이 한 칸이다.
 *
 * - [`noteDocSwap`] — `replaceTile` 이 문서 → 문서일 때 새 id 로 표시한다. `switchDocHere` 는 그 직전에 파일 칸 인계([`DocFilesSeed`])를 싣는다 —
 *   같은 id 로 인계 없이 다시 표시하면 실린 인계를 그대로 둔다.
 * - [`takeDocSwap`] — 새 `DocView` 가 초기화 때 **제 id 일 때만** 한 번 꺼낸다.
 *
 * Map 이 아니라 **한 칸**이다: 원격 창은 요청만 보내고 메인 PC 가 새 id 를 붙이므로 꺼낼 사람이 없다 — 다음 표시가 덮어 쌓이지 않는다.
 * 물음에서 취소했거나 같은 문서 · 다른 타일로 끝난 바꾸기는 싣지 않는다(싣는 자리가 갈아 끼우기 바로 앞이다).
 */

/** 갈아 끼워진 문서의 본문이 떠오르는 시간(ms) — `prefers-reduced-motion` 이면 없다 */
export const DOC_SWAP_FADE_MS = 120;

export interface DocSwap {
  /** 새 문서 타일의 id */
  paneId: string;
  /** 파일 칸에서 골라 바꾼 경우 옛 칸의 상태(파일 타일의 미리 보기 바꾸기 · 원격 창 요청에는 없다) */
  files?: DocFilesSeed;
}

let slot: DocSwap | null = null;

/** 다음에 설 문서 타일 `paneId` 가 갈아 끼워진 문서라고 적는다 — 같은 id 에 이미 실린 파일 칸 인계는 `files` 없이 부르면 남긴다 */
export function noteDocSwap(paneId: string, files?: DocFilesSeed): void {
  if (files === undefined && slot?.paneId === paneId) return;
  slot = files === undefined ? { paneId } : { paneId, files };
}

/** `paneId` 의 표시를 꺼낸다(한 번만) — 다른 id 의 것이면 건드리지 않고 `null` */
export function takeDocSwap(paneId: string): DocSwap | null {
  if (slot === null || slot.paneId !== paneId) return null;
  const got = slot;
  slot = null;
  return got;
}
