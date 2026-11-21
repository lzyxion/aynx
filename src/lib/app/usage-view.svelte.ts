/**
 * 캔버스를 덮는 판(사용량 화면 · 자원 화면) — 창마다 하나만 서고 저장되지 않는다. 타일로 가는 일이 곧 이 판에서 나오는 일이다.
 * 파일 이름은 하네스가 부르는 경로라 그대로 둔다.
 */

import { tick } from "svelte";

export type CoverView = "usage" | "resources";

let view = $state<CoverView | null>(null);

let returnFocusTo: HTMLElement | null = null;

function activeHtml(): HTMLElement | null {
  const el = typeof document === "undefined" ? null : document.activeElement;
  return typeof HTMLElement !== "undefined" && el instanceof HTMLElement ? el : null;
}

export function coverView(): CoverView | null {
  return view;
}

export function coverViewOpen(): boolean {
  return view !== null;
}

export function usageViewOpen(): boolean {
  return view === "usage";
}

export function resourceViewOpen(): boolean {
  return view === "resources";
}

function openCover(next: CoverView): void {
  if (view === next) return;
  if (view === null) returnFocusTo = activeHtml();
  view = next;
}

export function openUsageView(): void {
  openCover("usage");
}

export function openResourceView(): void {
  openCover("resources");
}

/**
 * 포커스 돌려주기는 `tick()` 뒤다 — 판이 떠 있는 동안 타일 쪽은 `visibility: hidden` 이라(`+page.svelte`) 닫는 그 순간의
 * `focus()` 는 아무 일도 하지 않는다.
 */
export function closeCoverView(restore = true): void {
  if (view === null) return;
  view = null;
  const back = returnFocusTo;
  returnFocusTo = null;
  if (!restore || back === null) return;
  void tick().then(() => {
    if (view === null && back.isConnected) back.focus({ preventScroll: true });
  });
}

export function toggleUsageView(): void {
  if (view === "usage") closeCoverView();
  else openUsageView();
}

export function toggleResourceView(): void {
  if (view === "resources") closeCoverView();
  else openResourceView();
}

export function leaveCoverView(): boolean {
  if (view === null) return false;
  closeCoverView(false);
  return true;
}
