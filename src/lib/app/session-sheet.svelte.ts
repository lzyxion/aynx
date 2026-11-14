import { tick } from "svelte";
import { focusedPane } from "$lib/app/tabs.svelte.js";
import { focusPaneBody } from "$lib/pane/focus";

/**
 * **세션 목록 판의 열림 상태** — 타일 캔버스 위쪽 가장자리에서 내려오는 세션 목록(`SessionSheet.svelte` —
 * 2026-10-07, 전체 화면 대시보드의 세션 칸을 옮겨 온 자리. 처음엔 하단 독 위로 펼쳐졌다가 같은 날 위쪽 판으로 옮겼다).
 *
 * 창마다 하나 · 타일 트리 밖 · 레이아웃/탭에 저장 안 됨. 여는 길은 둘이다: 키바인딩 `open-console`(id 는 관리뷰
 * 시절 그대로 — `settings.toml` 키라 바꾸지 않는다) · 상태바 세션 칸(2026-10-07 — 같은 몸통 `toggleSessionSheet`). 닫히는 규칙
 * (Escape · 판 밖 클릭 · 창 비활성화 · 모달/가림막)은 판(`SessionSheet.svelte`)이 쥐고 여기를 부른다.
 *
 * 판은 **덮개**다 — 타일 크기를 바꾸지 않는다(터미널 refit · PTY resize 가 나가지 않는다).
 *
 * ## 포커스
 *
 * 기록 보기(`app/conversation-viewer`)와 같은 방식으로 **스스로** 돌려준다: 열 때의 `document.activeElement` 를 적어
 * 두고, 닫은 뒤 포커스가 `<body>` 로 떨어졌을 때만 그 자리로 돌려준다. 하단 독 · 메뉴 안에서 열었으면 그 자리는
 * 곧 숨으므로(`inert`) 적지 않고 포커스 타일로 돌려준다. 줄을 골라 타일로 가는 닫기는 돌려주지 않는다. 어느 닫기든 판 안의
 * 포커스는 닫는 순간 놓는다 — 나가는 전이 동안 남은 판이 쥐고 있으면 돌려주기 · `revealPane` 이 물러선다([`closeSessionSheet`]).
 */

let open = $state(false);
let returnTo: HTMLElement | null = null;

/** 열 때 돌려줄 자리로 적지 않는 곳 — 곧 숨는 하단 독 · 메뉴 */
const TRANSIENT = "[data-floating-status-dock], [role='menu']";

/** 지금 판이 펼쳐져 있는가 — 반응형(창의 Escape 사슬이 본다) */
export function sessionSheetOpen(): boolean {
  return open;
}

/** 펼친다 — 이미 펼쳐져 있으면 아무 일도 없다(돌아갈 자리는 처음 연 때의 것) */
export function openSessionSheet(): void {
  if (open) return;
  if (typeof document !== "undefined") {
    const el = document.activeElement;
    returnTo = el instanceof HTMLElement && el !== document.body && !el.closest(TRANSIENT) ? el : null;
  }
  open = true;
}

/**
 * 접는다. `restore` 가 참이면(Escape · 같은 키 · 판 밖 클릭 · 창 비활성화) 다음 틱에 포커스를 잃어버린 채일 때만 연
 * 자리로(없으면 포커스 타일로) 돌려준다. 거짓이면(줄 고르기 · 모달) 잊는다 — 그쪽이 포커스를 가져간다.
 */
export function closeSessionSheet(restore = true): void {
  if (!open) return;
  open = false;
  const back = returnTo;
  returnTo = null;
  if (typeof document === "undefined") return;
  // 판은 나가는 전이(200ms) 동안 남는다 — 칸 단추 · 판이 포커스를 쥔 채 남으면 아래 돌려주기와 `revealPane` 의 다음 프레임
  // 판정이 "누가 가져갔다" 로 읽고 물러서, 전이가 끝나 판이 사라지는 순간 포커스가 `<body>` 로 떨어진다(지금 포커스 타일의 칸을
  // 누르면 그 타일이 스스로 포커스를 가져가지도 않는다). 프로필 전환(`app/profile-switcher`)과 같은 처방 — 판 안의 포커스를 먼저 놓는다.
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && ae.closest("[data-session-sheet]")) ae.blur();
  if (!restore) return;
  void tick().then(() => {
    const el = document.activeElement;
    const lost = el === null || el === document.body || el === document.documentElement;
    if (!lost) return;
    if (back?.isConnected) {
      back.focus({ preventScroll: true });
      return;
    }
    const pane = focusedPane();
    if (pane) focusPaneBody(pane.id);
  });
}

/** `open-console`(기본 `Ctrl+Shift+M`) — 같은 손짓으로 펼치고 접는다 */
export function toggleSessionSheet(): void {
  if (open) closeSessionSheet();
  else openSessionSheet();
}
