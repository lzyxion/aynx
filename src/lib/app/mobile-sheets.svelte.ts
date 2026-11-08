// **폰 배치의 덮개 화면들**(원격 웹 R5 · 10-20) — 탭 · 타일 고르기(`MobilePicker`) · "새 탭에 열기" 시트(`MobileSheet`) · 둘러보기
// (`MobileBrowse` — 호스트 · 프로젝트 · DB 전체) · 폰 설정(`MobileSettings`) · 폰 알림(`MobileAlerts` — 10-25: 상태줄 🔔 —
// 폰에서는 데스크톱 독을 열지 않는다) · 폰 작업안(`MobilePlans` — 10-25: 작업안은 주 창의 채팅 독 갈래라 원격 폰은 제 덮개로 연다 ·
// `app/plans.svelte.ts` 의 `openPlans` 원격 갈래) · 폰 사이드 채팅(`MobileChat` — 2026-11-01: 상태줄 말풍선 · 시트 줄 · [사이드 채팅에 묻기] —
// 데스크톱 폭의 채팅 독 대신). **한 번에 하나**만 선다: 시트 → 둘러보기는 밀어 넣기 (뒤로 = 시트), 설정 · 알림은 다른 것을
// 닫고 선다. 그리는 쪽은 위 띠(`MobileBar`) 하나다.
//
// 새 탭이 설 **워크스페이스**는 시트를 연 자리가 정한다 — 위 띠 `+` 는 원격 창이 보는 것, 고르기 화면의 `+ 새 탭` 은 그 화면이 보여 주던
// 것(칩 줄). 고른 것을 열 때([`openInTarget`]) 원격 창을 그 워크스페이스로 옮긴 뒤 연다 — 고르기 화면의 새 탭이 하던 그 순서(원격 창이
// 옮겨 가 있으면 `openInNewTab` 의 새 탭 요청이 그 워크스페이스를 싣는다 · R3 `newTab.workspace`). 시트를 고르지 않고 닫으면 아무것도
// 만들지 않는다. 전부 원격 로컬 상태다(Tauri 명령 없음) — 여는 일은 원격 창이 이미 하던 길(새 탭 요청)을 그대로 탄다.

import { currentWorkspaceId, switchWorkspace } from "$lib/app/workspaces.svelte.js";

export type MobileOverlay = "picker" | "sheet" | "browse" | "settings" | "alerts" | "plans" | "chat";
export type BrowseKind = "hosts" | "projects" | "db";

let overlay = $state<MobileOverlay | null>(null);
let target = $state<string | null>(null);
let browseKind = $state<BrowseKind>("hosts");

/** 지금 선 덮개(없으면 `null`) */
export function mobileOverlay(): MobileOverlay | null {
  return overlay;
}

/** 탭 · 타일 고르기 화면 */
export function openMobilePicker(): void {
  overlay = "picker";
}

/** "새 탭에 열기" 시트 — `workspace` 는 새 탭이 설 워크스페이스(없으면 원격 창이 보는 것) */
export function openMobileSheet(workspace?: string | null): void {
  target = workspace ?? currentWorkspaceId();
  overlay = "sheet";
}

/** 둘러보기 화면(시트에서 밀어 넣기 — 대상 워크스페이스는 시트의 것 그대로) */
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
 * **고른 것을 연다** — 덮개를 닫고, 원격 창을 대상 워크스페이스로 옮긴 뒤 `run`(새 탭을 여는 그 길)을 부른다. 실패는 여는 길이 스스로
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
