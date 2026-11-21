/**
 * 로컬 타일의 "AI 읽기 허용" — 기본은 꺼짐이고 켜는 것은 명시적 조작이어야 한다.
 * 원격 타일에서는 뜻이 없다(Rust 도 안 본다) — "AI 에게 보이는가" 는 `isShared` 가 아니라 `paneAiReadable` 에 묻는다.
 */

import { SvelteSet } from "svelte/reactivity";

const shared = new SvelteSet<string>();

export function isShared(paneId: string): boolean {
  return shared.has(paneId);
}

/** 토글이 아니라 대입이다 — 창 이관은 "저쪽에서 켜져 있었다" 는 사실을 옮겨 심는다 */
export function setShared(paneId: string, on: boolean): void {
  if (on) shared.add(paneId);
  else shared.delete(paneId);
}

export function dropShared(paneId: string): void {
  shared.delete(paneId);
}
