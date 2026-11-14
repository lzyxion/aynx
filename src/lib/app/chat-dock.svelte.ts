import { isRemote } from "../ipc";
import { focusPaneBody } from "$lib/pane/focus";
import { activeTab, paneOf } from "$lib/app/tabs.svelte.js";
import {
  CHAT_DOCK_SPEC,
  clampChatDockWidth,
  readChatDockSection,
  readChatDockWidth,
  writeChatDockSection,
  writeChatDockWidth,
  type ChatDockSection,
} from "$lib/dock";

/**
 * **채팅 독 — 런처 독의 반대쪽 창 끝에 떠 있는 층 하나** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md).
 *
 * 런처 독(`app/dock.svelte.ts`)과 **따로** 산다 — 바깥 누르기로 닫히는 런처의 칸이 되면 대화가 가려진다(설계 "갈림길에서 버린 것").
 * 둘은 동시에 떠 있을 수 있고, 쪽은 설정 `[dock] layout` 이 정한다(`$lib/dock` 의 `dockSides` — 늘 서로 반대쪽).
 *
 * 여기 사는 것은 다섯이다: **열렸나 · 고정했나 · 돌아갈 포커스 · 폭 · 갈래**(+ 이 창에 독이 있나).
 *
 * **갈래**(2026-10-25) — 독 맨 위 [채팅 | 작업안]. 작업안 갈래의 몸통이 옛 작업안 타일(`kind:"plans"`)의 `PlansView` 다 — 10-23 에
 * 채팅 독이 오른쪽에 서며 작업안 타일과 겹쳤고, 타일은 탭에 묶여 열 때마다 배치를 바꿨다. 여는 길은 `app/plans.svelte.ts`
 * (docs/log/2026-10-25-plans-tile-refresh.md). 고른 갈래는 `$lib/dock` 의 저장소 `chatSection` 칸에 남는다. 독 컴포넌트
 * (`ChatDock.svelte`)는 **사람 창의 데스크톱 폭**(집 PC 주 창 · 원격 웹 창 — 2026-11-01)에서만 마운트되고 마운트에서
 * [`setChatDockAvailable`] 을 켠다 — 보조 창 · 원격 폰 배치에서는 단축키 · 팔레트 줄이 아무 일도 하지 않는다(이 모듈이 창 종류를 묻지
 * 않는다). 원격 창(데스크톱 폭)도 갈래 둘을 그대로 쓴다(2026-11-13 — 예전엔 원격의 작업안이 캔버스를 덮는 판이었다).
 *
 * **고정(pin) = 덮기** — 고정해도 타일 영역을 밀지 않고 위에 겹친다(전 타일 리사이즈 · 원격 셸 다시 그리기를 피함). 고정의 뜻은
 * "Esc · 바깥 누르기로 닫히지 않는다" 하나다. 닫는 길은 머리줄 × · 단축키 · 팔레트로 남는다.
 */

/** 열려 있나 */
let open = $state(false);

/** 고정했나 — 이번 페이지 동안만(저장하지 않는다) */
let pinned = $state(false);

/** 이 창에 독이 붙어 있나 — 팔레트 · 치트시트가 이것으로 줄을 세운다(독이 마운트된 동안만 참) */
let available = $state(false);

/**
 * 열기 **직전에** 포커스를 쥐고 있던 요소 — 닫을 때 그리로 돌려준다(`app/dock.svelte.ts` 의 같은 칸과 같은 규칙).
 * `$state` 가 아니다: 아무도 그리지 않는다.
 */
let returnFocusTo: HTMLElement | null = null;

/** 지금 갈래 — 마운트에서 [`restoreChatDockWidth`] 가 저장값으로 채운다 */
let section = $state<ChatDockSection>("chat");

export function chatDockSection(): ChatDockSection {
  return section;
}

/** 갈래를 바꾸고 남긴다 */
export function setChatDockSection(next: ChatDockSection): void {
  if (section === next) return;
  section = next;
  writeChatDockSection(next);
}

/** 그 갈래로 연다 — 이미 열려 있으면 갈래만 바꾼다(작업안의 여는 길 · 채팅의 [AI에게 묻기] 등) */
export function openChatDockAt(next: ChatDockSection): void {
  setChatDockSection(next);
  openChatDock();
}

/** 이 창에 채팅 독이 있나 — 독이 마운트된 동안만 참이다 */
export function chatDockAvailable(): boolean {
  return available;
}

export function chatDockOpen(): boolean {
  return open;
}

export function chatDockPinned(): boolean {
  return pinned;
}

/** 독 컴포넌트가 마운트에서 켜고 해제에서 끈다 — 끄면 열린 독도 논리상 닫는다 */
export function setChatDockAvailable(on: boolean): void {
  available = on;
  if (!on) {
    open = false;
    returnFocusTo = null;
  }
}

/** 연다 — 여는 순간의 포커스를 적어 둔다. 이미 열려 있으면 그대로 */
export function openChatDock(): void {
  if (!available || open) return;
  const el = typeof document === "undefined" ? null : document.activeElement;
  returnFocusTo = el instanceof HTMLElement ? el : null;
  open = true;
}

/**
 * 닫는다. `restore` 는 **키보드 · 단추로 닫았을 때만** 참이다 — 바깥 누르기로 닫으면 누른 곳이 곧 갈 곳이라 옛 자리로
 * 되돌리지 않는다(런처 독의 `closeDock` 과 같은 규칙). 고정 여부는 여기서 보지 않는다 — 막는 것은 부르는 쪽(Esc · 바깥 누르기)이다.
 */
export function closeChatDock(restore = true): void {
  if (!open) return;
  open = false;
  const back = returnFocusTo;
  returnFocusTo = null;
  if (!restore || typeof document === "undefined") return;
  if (back?.isConnected && back !== document.body) {
    back.focus({ preventScroll: true });
    return;
  }
  // 적어 둔 요소가 사라졌거나(독을 연 팔레트 · 상자가 걷혔다 · 타일이 닫혔다) `<body>` 였으면 지금 포커스된 타일의
  // **키보드 몸**으로 — 런처 독의 `closeDock` 과 같은 길이다(`focusPaneBody` — 터미널이면 xterm 의 textarea).
  // `routeTileFocus` 는 `[data-tile-focus]` 만 봐서 터미널 타일에 닿지 못한다.
  const tab = activeTab();
  const pane = tab ? paneOf(tab) : null;
  if (pane) focusPaneBody(pane);
}

/**
 * `open-chat-dock` · 팔레트 — 같은 키로 열고 닫는다(고정해 두었어도 닫는다 — 누른 키의 뜻이다). 채팅의 키라 **채팅 갈래로** 연다 —
 * 작업안 갈래가 보이는 중이면 닫지 않고 채팅으로 바꾼다.
 */
export function toggleChatDock(): void {
  if (open && section === "chat") closeChatDock();
  else openChatDockAt("chat");
}

export function setChatDockPinned(on: boolean): void {
  pinned = on;
}

// ---------------------------------------------------------------------------
// 폭 (2026-10-23) — 안쪽 끝 손잡이로 끈다. 저장은 `$lib/dock` 의 `chat` 칸(런처 폭과 같은 저장소 · 다른 칸)
// ---------------------------------------------------------------------------

/** 지금 폭(px) — 마운트에서 [`restoreChatDockWidth`] 가 저장값으로 채운다 */
let width = $state<number>(CHAT_DOCK_SPEC.def);

/** 저장된 폭을 아직 안 읽었다 — 창마다 한 번(임포트 시점에 `localStorage` 를 만지지 않는다 — `app/dock` 과 같은 규칙) */
let widthRestored = false;

function windowWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

export function chatDockWidth(): number {
  return width;
}

/** 저장된 폭을 한 번 읽어 온다 — 독 컴포넌트가 마운트에서 부른다 */
export function restoreChatDockWidth(): void {
  if (widthRestored) return;
  widthRestored = true;
  width = readChatDockWidth(windowWidth());
  // 원격 창에는 작업안 갈래가 없다(작업안은 원격의 제 판 — `ChatDock` 머리말)
  section = isRemote ? "chat" : readChatDockSection();
}

/** 폭을 바꾼다 — 끄는 **매 프레임** 불린다. `persist` 는 손을 뗄 때만 참이다(프레임마다 디스크에 쓰지 않게) */
export function setChatDockWidth(px: number, persist = false): void {
  width = clampChatDockWidth(px, windowWidth());
  if (persist) writeChatDockWidth(width);
}
