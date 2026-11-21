// 폰 배치의 덮개 화면들 — 한 번에 하나만 선다.
// "지금 탭에" 는 메인 PC 의 지금 워크스페이스에서만 된다(`openPane`) — 아니면 시트가 "새 탭에"로 고정한다(`$lib/mobile/launch` 의 `sheetHereBlock`).
// 새 탭에 열 때는 원격 창을 대상 워크스페이스로 먼저 옮긴다 — 새 탭 요청이 원격 창의 워크스페이스를 싣는다.

import { currentWorkspaceId, switchWorkspace } from "$lib/app/workspaces.svelte.js";

export type MobileOverlay = "picker" | "sheet" | "browse" | "settings" | "alerts" | "plans" | "chat";
export type BrowseKind = "hosts" | "projects" | "db";
export type SheetPlace = "here" | "new";

let overlay = $state<MobileOverlay | null>(null);
let target = $state<string | null>(null);
let browseKind = $state<BrowseKind>("hosts");
let place = $state<SheetPlace>("here");

export function mobileOverlay(): MobileOverlay | null {
  return overlay;
}

export function openMobilePicker(): void {
  overlay = "picker";
}

export function openMobileSheet(workspace?: string | null, start: SheetPlace = "here"): void {
  target = workspace ?? currentWorkspaceId();
  place = start;
  overlay = "sheet";
}

export function mobileSheetPlace(): SheetPlace {
  return place;
}

export function setMobileSheetPlace(next: SheetPlace): void {
  place = next;
}

export function openMobileBrowse(kind?: BrowseKind): void {
  if (kind) browseKind = kind;
  overlay = "browse";
}

export function backToMobileSheet(): void {
  overlay = "sheet";
}

export function openMobileSettings(): void {
  overlay = "settings";
}

export function openMobileAlerts(): void {
  overlay = "alerts";
}

export function openMobilePlans(): void {
  overlay = "plans";
}

export function openMobileChat(): void {
  overlay = "chat";
}

export function closeMobileOverlay(): void {
  overlay = null;
}

export function mobileBrowseKind(): BrowseKind {
  return browseKind;
}

export function setMobileBrowseKind(kind: BrowseKind): void {
  browseKind = kind;
}

export function mobileSheetTarget(): string | null {
  return target ?? currentWorkspaceId();
}

export function openFromSheet(here: () => void | Promise<void>, fresh: () => void | Promise<void>): void {
  if (place !== "here") {
    openInTarget(fresh);
    return;
  }
  overlay = null;
  void Promise.resolve()
    .then(here)
    .catch((e) => console.warn("[aynx] 폰 지금 탭에 열기 실패:", e));
}

export function openInTarget(run: () => void | Promise<void>): void {
  const ws = mobileSheetTarget();
  overlay = null;
  if (ws && ws !== currentWorkspaceId()) switchWorkspace(ws);
  void Promise.resolve()
    .then(run)
    .catch((e) => console.warn("[aynx] 폰 새 탭 열기 실패:", e));
}
