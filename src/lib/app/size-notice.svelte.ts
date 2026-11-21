// 이 창의 줄어든 타일 표(크기 주인이 아닌 터미널 타일) — 범위는 이 창의 지금 워크스페이스다(숨은 채 마운트된 다른 워크스페이스 타일은 거른다).

import { SvelteMap } from "svelte/reactivity";
import { currentWorkspaceTabs } from "$lib/app/tabs.svelte.js";
import { listPanes } from "$lib/session/tree";

/** 되찾기 함수는 셸에 아무것도 쓰지 않는다(`claimSize`) */
const shrunk = new SvelteMap<string, () => Promise<void>>();

export function markShrunk(paneId: string, reclaim: () => Promise<void>): void {
  shrunk.set(paneId, reclaim);
}

export function clearShrunk(paneId: string): void {
  shrunk.delete(paneId);
}

function inScope(): string[] {
  if (shrunk.size === 0) return [];
  const here = new Set(currentWorkspaceTabs().flatMap((t) => listPanes(t.root).map((p) => p.id)));
  return [...shrunk.keys()].filter((id) => here.has(id));
}

export function shrunkCount(): number {
  return inScope().length;
}

export async function reclaimAll(): Promise<void> {
  await Promise.all(inScope().map((id) => shrunk.get(id)?.() ?? Promise.resolve()));
}
