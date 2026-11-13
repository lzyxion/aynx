/**
 * **캔버스를 덮는 판 — 사용량 화면 · 자원 화면의 상태** (2026-10-04 — 대시보드의 "사용량" 칸에서 떼어 냈다 · 2026-10-17 자원 화면을
 * 같은 급의 둘째 판으로 더했다).
 *
 * 규칙: 창마다 **하나만** 떠 있다(`view` 하나 — 둘이 동시에 서지 않는다) · 타일 트리 밖 · 레이아웃/탭에 저장 안 됨 · 캔버스를
 * 가리므로 **타일로 가는 일이 곧 이 판에서 나오는 일**(`tabs.svelte.ts` 가 [`leaveCoverView`] 를 부른다). 키바인딩은 없다(사용자 결정).
 *
 * - **사용량 화면**(`UsageView.svelte`) — 진입점은 상태바의 사용량 고리(토글)와 팔레트의 사용량 줄.
 * - **자원 화면**(`ResourceView.svelte` — 로컬 자원 모니터) — 진입점은 상태바의 CPU · 메모리 고리(토글)와 타일 머리줄의 자원 칩.
 *   10-17 첫 조각에서는 사용량 화면 안의 [사용량 | 자원] 칸이었다 — 상태바 자원 고리를 세우며 판을 갈랐다.
 *
 * 한 판이 떠 있는데 다른 판을 열면 판만 바뀐다(포커스를 돌려줄 자리는 처음 열 때 적은 그대로). 이 모듈은 아무것도 import 하지
 * 않는다(잎). 파일 이름은 하네스가 부르는 경로라 그대로 둔다.
 */

/**
 * 캔버스를 덮는 판의 종류. (2026-10-25 ~ 11-13 에는 원격 창의 작업안 판 `plans` 도 있었다 — 이제 원격도 채팅 독의 작업안 갈래다 ·
 * `app/plans.svelte.ts`.)
 */
export type CoverView = "usage" | "resources";

let view = $state<CoverView | null>(null);

/**
 * 열기 **직전**의 포커스 — 토글·Escape·× 로 닫을 때 그리로 돌려준다(비반응형 취급: 아무도 이 값을 그리지
 * 않는다).
 */
let returnFocusTo: HTMLElement | null = null;

function activeHtml(): HTMLElement | null {
  const el = typeof document === "undefined" ? null : document.activeElement;
  return typeof HTMLElement !== "undefined" && el instanceof HTMLElement ? el : null;
}

/** 지금 떠 있는 판(`null` = 없음) */
export function coverView(): CoverView | null {
  return view;
}

/** 캔버스가 판 하나로 덮여 있는가(어느 판이든) — 탭 · 워크스페이스 · 작업안 · 덮개 쪽이 묻는 것 */
export function coverViewOpen(): boolean {
  return view !== null;
}

/** 사용량 화면이 떠 있는가 */
export function usageViewOpen(): boolean {
  return view === "usage";
}

/** 자원 화면이 떠 있는가 */
export function resourceViewOpen(): boolean {
  return view === "resources";
}

function openCover(next: CoverView): void {
  if (view === next) return;
  if (view === null) returnFocusTo = activeHtml();
  view = next;
}

/** 사용량 화면을 연다 — 자원 화면이 떠 있으면 판만 바꾼다 */
export function openUsageView(): void {
  openCover("usage");
}

/** 자원 화면을 연다 — 사용량 화면이 떠 있으면 판만 바꾼다 */
export function openResourceView(): void {
  openCover("resources");
}

/**
 * 떠 있는 판을 닫는다. `restore` 는 **토글·Escape·× 로 닫았을 때만** 참이다 — 적어 둔 요소가 아직 살아 있으면 그리로
 * 포커스를 돌려준다. 타일로 가면서 닫을 때는 [`leaveCoverView`] 가 거짓으로 부른다.
 */
export function closeCoverView(restore = true): void {
  if (view === null) return;
  view = null;
  const back = returnFocusTo;
  returnFocusTo = null;
  if (!restore) return;
  if (back?.isConnected) back.focus({ preventScroll: true });
}

/** 상태바 사용량 고리 — 같은 고리로 열고 닫는다(자원 화면이 떠 있으면 사용량으로 바꾼다) */
export function toggleUsageView(): void {
  if (view === "usage") closeCoverView();
  else openUsageView();
}

/** 상태바 자원 고리 — 같은 고리로 열고 닫는다(사용량 화면이 떠 있으면 자원으로 바꾼다) */
export function toggleResourceView(): void {
  if (view === "resources") closeCoverView();
  else openResourceView();
}

/** **타일로 가는 길이 이 판을 걷는다** — 떠 있지 않으면 아무 일도 없다(`false`) */
export function leaveCoverView(): boolean {
  if (view === null) return false;
  closeCoverView(false);
  return true;
}
