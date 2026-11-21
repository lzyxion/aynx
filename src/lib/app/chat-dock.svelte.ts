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
 * 채팅 독 — 런처 독(`app/dock.svelte.ts`)과 따로 산다: 바깥 누르기로 닫히는 런처의 칸이 되면 대화가 가려진다.
 * 이 모듈은 창 종류를 묻지 않는다 — 독 컴포넌트가 마운트된 창에서만 [`setChatDockAvailable`] 이 켜진다.
 * 고정(pin)해도 타일 영역을 밀지 않고 덮는다(전 타일 리사이즈 · 원격 셸 다시 그리기를 피함) — 뜻은 "Esc · 바깥 누르기로 닫히지 않는다" 하나다.
 */

let open = $state(false);

/** 저장하지 않는다 */
let pinned = $state(false);

let available = $state(false);

let returnFocusTo: HTMLElement | null = null;

/** 마운트에서 [`restoreChatDockWidth`] 가 저장값으로 채운다 */
let section = $state<ChatDockSection>("chat");

export function chatDockSection(): ChatDockSection {
  return section;
}

export function setChatDockSection(next: ChatDockSection): void {
  if (section === next) return;
  section = next;
  writeChatDockSection(next);
}

export function openChatDockAt(next: ChatDockSection): void {
  setChatDockSection(next);
  openChatDock();
}

export function chatDockAvailable(): boolean {
  return available;
}

export function chatDockOpen(): boolean {
  return open;
}

export function chatDockPinned(): boolean {
  return pinned;
}

export function setChatDockAvailable(on: boolean): void {
  available = on;
  if (!on) {
    open = false;
    returnFocusTo = null;
  }
}

export function openChatDock(): void {
  if (!available || open) return;
  const el = typeof document === "undefined" ? null : document.activeElement;
  returnFocusTo = el instanceof HTMLElement ? el : null;
  open = true;
}

/**
 * `restore` 는 키보드 · 단추로 닫았을 때만 참이다 — 바깥 누르기면 누른 곳이 곧 갈 곳이다.
 * 고정 여부는 여기서 보지 않는다 — 막는 것은 부르는 쪽(Esc · 바깥 누르기)이다.
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
  // `routeTileFocus` 는 `[data-tile-focus]` 만 봐서 터미널 타일에 닿지 못한다 — `focusPaneBody` 로 간다
  const tab = activeTab();
  const pane = tab ? paneOf(tab) : null;
  if (pane) focusPaneBody(pane);
}

/** 고정해 두었어도 닫는다 — 누른 키의 뜻이다 */
export function toggleChatDock(): void {
  if (open && section === "chat") closeChatDock();
  else openChatDockAt("chat");
}

export function setChatDockPinned(on: boolean): void {
  pinned = on;
}

// ── 폭 ──

let width = $state<number>(CHAT_DOCK_SPEC.def);

/** 임포트 시점에 `localStorage` 를 만지지 않는다 */
let widthRestored = false;

function windowWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

export function chatDockWidth(): number {
  return width;
}

export function restoreChatDockWidth(): void {
  if (widthRestored) return;
  widthRestored = true;
  width = readChatDockWidth(windowWidth());
  section = isRemote ? "chat" : readChatDockSection();
}

/** 끄는 매 프레임 불린다 — `persist` 는 손을 뗄 때만 참이다(프레임마다 디스크에 쓰지 않게) */
export function setChatDockWidth(px: number, persist = false): void {
  width = clampChatDockWidth(px, windowWidth());
  if (persist) writeChatDockWidth(width);
}
