// **이 창의 줄어든 타일 표**(10-20 — 다른 기기 크기 안내 · 순수 판정은 `$lib/term/size-notice`).
//
// 크기 주인이 아닌 터미널 타일(`Terminal.svelte` — 주인의 크기로 그리는 중)은 여기에 제 되찾기 함수를 올린다. 카드 · 꼬리표의 단추 수(하나면
// [이 창 크기로], 둘 이상이면 [이 타일만] [모두 되돌리기])와 [모두 되돌리기] 의 대상이 이 표다. **범위 = 이 창의 지금 워크스페이스**:
// 페이지(창)마다 모듈이 따로라 다른 창은 섞이지 않고, 이 창에 상주하는 다른 워크스페이스의 타일(숨은 채 마운트)은 걸러 낸다.

import { SvelteMap } from "svelte/reactivity";
import { currentWorkspaceTabs } from "$lib/app/tabs.svelte.js";
import { listPanes } from "$lib/session/tree";

/** 타일 id → 그 타일을 이 창 크기로 되돌리는 함수(셸에 아무것도 쓰지 않는다 — 손잡이 `claimSize`) */
const shrunk = new SvelteMap<string, () => Promise<void>>();

/** 이 타일이 줄었다(주인이 아니고 주인의 크기를 안다) — 되찾기 함수를 올린다 */
export function markShrunk(paneId: string, reclaim: () => Promise<void>): void {
  shrunk.set(paneId, reclaim);
}

/** 이 타일이 더는 줄지 않았다(주인이 됐다 · 세션이 떠났다 · 언마운트) */
export function clearShrunk(paneId: string): void {
  shrunk.delete(paneId);
}

/** 지금 워크스페이스 안의 줄어든 타일 id */
function inScope(): string[] {
  if (shrunk.size === 0) return [];
  const here = new Set(currentWorkspaceTabs().flatMap((t) => listPanes(t.root).map((p) => p.id)));
  return [...shrunk.keys()].filter((id) => here.has(id));
}

/** 이 창(지금 워크스페이스)의 줄어든 타일 수 — 단추 갈래(`noticeActions`) */
export function shrunkCount(): number {
  return inScope().length;
}

/** [모두 되돌리기] — 이 창의 지금 워크스페이스에서 줄어든 타일을 모두 이 창 크기로(다른 창 · 다른 워크스페이스는 그대로) */
export async function reclaimAll(): Promise<void> {
  await Promise.all(inScope().map((id) => shrunk.get(id)?.() ?? Promise.resolve()));
}
