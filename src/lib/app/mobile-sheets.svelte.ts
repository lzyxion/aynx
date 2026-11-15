// **폰 배치의 덮개 화면들**(원격 웹 R5 · 10-20) — 탭 · 타일 고르기(`MobilePicker`) · 열기 시트(`MobileSheet`) · 둘러보기
// (`MobileBrowse` — 호스트 · 프로젝트 · DB 전체) · 폰 설정(`MobileSettings`) · 폰 알림(`MobileAlerts` — 10-25: 상태줄 🔔 —
// 폰에서는 데스크톱 독을 열지 않는다) · 폰 작업안(`MobilePlans` — 10-25: 작업안은 주 창의 채팅 독 갈래라 원격 폰은 제 덮개로 연다 ·
// `app/plans.svelte.ts` 의 `openPlans` 원격 갈래) · 폰 사이드 채팅(`MobileChat` — 2026-11-01: 상태줄 말풍선 · 시트 줄 · [사이드 채팅에 묻기] —
// 데스크톱 폭의 채팅 독 대신). **한 번에 하나**만 선다: 시트 → 둘러보기는 밀어 넣기 (뒤로 = 시트), 설정 · 알림은 다른 것을
// 닫고 선다. 그리는 쪽은 위 띠(`MobileBar`) 하나다.
//
// **여는 자리**(11-15 — 시트 맨 위의 [지금 탭에 | 새 탭에]): 위 띠 `+` 로 열면 "지금 탭에"(원격 창이 보는 탭에 타일 하나 더 — 원격 창의
// `openPaneHere` 가 메인 PC 에 `openPane` 요청을 보내고, 메인 PC 는 그 탭에 자동 배치로 넣고 포커스를 새 타일로 옮긴다 · 폰은 포커스를
// 따라가므로 새 타일이 곧 뜬다), 고르기 화면의 `+ 새 탭` 으로 열면 "새 탭에"로 시작한다. 둘러보기도 같은 고름을 따른다.
// "지금 탭에" 가 뜻이 없거나 메인 PC 가 거절할 자리(시트의 대상이 지금 워크스페이스가 아님 · 탭이 없음 · 메인 PC 가 다른 워크스페이스를
// 보는 중 — `openPane` 은 메인 PC 의 지금 워크스페이스에서만 된다)면 시트가 "새 탭에"로 고정한다(`$lib/mobile/launch` 의 `sheetHereBlock`).
//
// 새 탭이 설 **워크스페이스**는 시트를 연 자리가 정한다 — 위 띠 `+` 는 원격 창이 보는 것, 고르기 화면의 `+ 새 탭` 은 그 화면이 보여 주던
// 것(칩 줄). 새 탭에 열 때([`openInTarget`]) 원격 창을 그 워크스페이스로 옮긴 뒤 연다 — 고르기 화면의 새 탭이 하던 그 순서(원격 창이
// 옮겨 가 있으면 `openInNewTab` 의 새 탭 요청이 그 워크스페이스를 싣는다 · R3 `newTab.workspace`). 시트를 고르지 않고 닫으면 아무것도
// 만들지 않는다. 전부 원격 로컬 상태다(Tauri 명령 없음) — 여는 일은 원격 창이 이미 하던 길(새 탭 · 타일 열기 요청)을 그대로 탄다.

import { currentWorkspaceId, switchWorkspace } from "$lib/app/workspaces.svelte.js";

export type MobileOverlay = "picker" | "sheet" | "browse" | "settings" | "alerts" | "plans" | "chat";
export type BrowseKind = "hosts" | "projects" | "db";
/** 시트의 여는 자리 — 연 자리가 정한다(위 띠 `+` = 지금 탭 · 고르기 화면의 `+ 새 탭` = 새 탭) */
export type SheetPlace = "here" | "new";

let overlay = $state<MobileOverlay | null>(null);
let target = $state<string | null>(null);
let browseKind = $state<BrowseKind>("hosts");
let place = $state<SheetPlace>("here");

/** 지금 선 덮개(없으면 `null`) */
export function mobileOverlay(): MobileOverlay | null {
  return overlay;
}

/** 탭 · 타일 고르기 화면 */
export function openMobilePicker(): void {
  overlay = "picker";
}

/** 열기 시트 — `workspace` 는 새 탭이 설 워크스페이스(없으면 원격 창이 보는 것) · `start` 는 처음 고른 여는 자리 */
export function openMobileSheet(workspace?: string | null, start: SheetPlace = "here"): void {
  target = workspace ?? currentWorkspaceId();
  place = start;
  overlay = "sheet";
}

/** 시트의 여는 자리(시트가 "지금 탭에" 를 못 쓰는 자리면 이미 `new` 로 고정해 둔다) */
export function mobileSheetPlace(): SheetPlace {
  return place;
}

export function setMobileSheetPlace(next: SheetPlace): void {
  place = next;
}

/** 둘러보기 화면(시트에서 밀어 넣기 — 대상 워크스페이스 · 여는 자리는 시트의 것 그대로) */
export function openMobileBrowse(kind?: BrowseKind): void {
  if (kind) browseKind = kind;
  overlay = "browse";
}

/** 둘러보기 → 시트 */
export function backToMobileSheet(): void {
  overlay = "sheet";
}

/** 폰 설정 화면 — 다른 덮개는 닫힌다 */
export function openMobileSettings(): void {
  overlay = "settings";
}

/** 폰 알림 화면 — 다른 덮개는 닫힌다(상태줄 🔔) */
export function openMobileAlerts(): void {
  overlay = "alerts";
}

/** 폰 작업안 화면 — 다른 덮개는 닫힌다(시트의 작업안 줄 · 알림 화면의 [작업안 기록] · 원격의 `openPlans`) */
export function openMobilePlans(): void {
  overlay = "plans";
}

/** 폰 사이드 채팅 화면 — 다른 덮개는 닫힌다(상태줄 말풍선 · 시트의 줄 · `app/side-chat-ask` 의 `openSideChatHere`) */
export function openMobileChat(): void {
  overlay = "chat";
}

export function closeMobileOverlay(): void {
  overlay = null;
}

/** 둘러보기 화면의 칸 */
export function mobileBrowseKind(): BrowseKind {
  return browseKind;
}

export function setMobileBrowseKind(kind: BrowseKind): void {
  browseKind = kind;
}

/** 새 탭이 설 워크스페이스의 id(시트를 연 자리) */
export function mobileSheetTarget(): string | null {
  return target ?? currentWorkspaceId();
}

/**
 * **고른 것을 연다** — 여는 자리가 "지금 탭에" 면 덮개만 닫고 `here`(지금 탭에 여는 길 — 워크스페이스를 옮기지 않는다), 아니면
 * [`openInTarget`] 으로 `fresh`(새 탭에 여는 길).
 */
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

/**
 * **새 탭에 연다** — 덮개를 닫고, 원격 창을 대상 워크스페이스로 옮긴 뒤 `run`(새 탭을 여는 그 길)을 부른다. 실패는 여는 길이 스스로
 * 알린다(안내 한 줄) — 여기서는 삼킨다.
 */
export function openInTarget(run: () => void | Promise<void>): void {
  const ws = mobileSheetTarget();
  overlay = null;
  if (ws && ws !== currentWorkspaceId()) switchWorkspace(ws);
  void Promise.resolve()
    .then(run)
    .catch((e) => console.warn("[aynx] 폰 새 탭 열기 실패:", e));
}
