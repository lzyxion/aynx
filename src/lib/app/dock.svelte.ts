import {
  clampDockWidth,
  DEFAULT_LAUNCHER_SEGMENT,
  DOCK_SLOT_SPEC,
  dockSlotOf,
  isLauncherKind,
  normalizeLauncherSegment,
  readDockWidth,
  writeDockWidth,
  type DockKind,
  type DockSlot,
} from "$lib/dock";
import { focusPaneBody } from "$lib/pane/focus";
import { activeTab, paneOf } from "$lib/app/tabs.svelte.js";

/**
 * 독 — 타일 위에 떠 있는 층 하나(창마다 하나 · 탭 트리에 들어가지 않고 배치에 저장되지 않는다).
 * 설정이 떠 있을 때 닫기 · 다른 종류로 열기는 먼저 [`setSettingsLeaveGuard`] 로 건 문에 묻는다 — 이 모듈은 설정을 모른다.
 */

let kind = $state<DockKind | null>(null);

/** 런처 칸들은 한 자리다 — 칸을 바꿀 때마다 폭이 들쑥날쑥하면 다른 독으로 읽힌다 */
let widths = $state<Record<DockSlot, number>>({
  launcher: DOCK_SLOT_SPEC.launcher.def,
  settings: DOCK_SLOT_SPEC.settings.def,
});

/** `$state` 가 아니다 — 룬으로 만들면 DOM 노드가 프록시에 감싸이고 그 프록시로 `focus()` 를 부르게 된다 */
let returnFocusTo: HTMLElement | null = null;

/** 임포트 시점에 DOM 을 만지지 않는다 */
let restored = false;

function windowWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

/** 논리의 답이다 — 닫히는 동안의 그림은 컴포넌트가 마지막으로 보이던 종류로 고른다(`Dock.svelte` 의 `shown`) */
export function dockKind(): DockKind | null {
  return kind;
}

/** 지금 열린 종류가 아니라 넘겨받은 종류의 폭 — 닫히는 동안 `kind === null` 이라 지금 종류로 물으면 폭이 튄다 */
export function dockWidthOf(k: DockKind): number {
  return widths[dockSlotOf(k)];
}

/** 임포트 순간 `localStorage` · `window` 를 만지면 던질 때 앱이 통째로 안 뜬다 — 그래서 마운트에서 부른다 */
export function restoreDockWidths(): void {
  if (restored) return;
  restored = true;
  const w = windowWidth();
  widths = {
    launcher: readDockWidth("hosts", w),
    settings: readDockWidth("settings", w),
  };
}

/** 끄는 매 프레임 불린다 — `persist` 는 손을 뗄 때만 참이다(프레임마다 동기 디스크 접근이 들지 않게) */
export function setDockWidth(px: number, persist = false): void {
  const k = kind;
  if (k === null) return;
  const slot = dockSlotOf(k);
  widths[slot] = clampDockWidth(k, px, windowWidth());
  if (persist) writeDockWidth(k, widths[slot]);
}

/** 이미 열려 있으면 내용만 바꾼다 — 돌아갈 자리는 처음 연 자리 그대로다 */
export function openDock(k: DockKind): void {
  if (kind === "settings" && k !== "settings" && leaveSettings(() => openDock(k))) return;
  if (kind === null) {
    const el = typeof document === "undefined" ? null : document.activeElement;
    returnFocusTo = el instanceof HTMLElement ? el : null;
  }
  kind = isLauncherKind(k) ? normalizeLauncherSegment(k) : k;
}

/** `restore` 는 키보드로 닫았을 때만 참이다 — 바깥 클릭에서 돌려주면 방금 누른 곳에서 포커스가 튕겨 나간다 */
export function closeDock(restore = true): void {
  if (kind === null) return;
  if (kind === "settings" && leaveSettings(() => closeDock(restore))) return;
  kind = null;
  const back = returnFocusTo;
  returnFocusTo = null;
  if (!restore) return;
  if (typeof document === "undefined") return;
  if (back?.isConnected && back !== document.body) {
    back.focus({ preventScroll: true });
    return;
  }
  // `routeTileFocus` 는 `[data-tile-focus]` 만 봐서 터미널 타일에서는 포커스가 `<body>` 로 떨어진다 — `focusPaneBody` 로 간다
  const tab = activeTab();
  const pane = tab ? paneOf(tab) : null;
  if (pane) focusPaneBody(pane);
}

/** 포커스는 돌려주지 않는다 — `then` 이 갈 곳을 정한다 */
export function closeDockThen(then: () => void): void {
  if (kind === "settings" && leaveSettings(() => closeDockThen(then))) return;
  closeDock(false);
  then();
}

/** 맡았으면 `true` — 나중에 `go()` 로 잇거나, 물리면 부르지 않는다. 맡은 동안 다시 불리면 또 묻지 않고 삼킨다 */
type SettingsLeaveGuard = (go: () => void) => boolean;
let settingsLeaveGuard: SettingsLeaveGuard | null = null;
let leaving = false;

export function setSettingsLeaveGuard(guard: SettingsLeaveGuard | null): void {
  settingsLeaveGuard = guard;
}

function leaveSettings(go: () => void): boolean {
  if (leaving) return false; // 문이 이어서 부른 `go` — 다시 묻지 않는다
  const guard = settingsLeaveGuard;
  if (!guard) return false;
  return guard(() => {
    leaving = true;
    try {
      go();
    } finally {
      leaving = false;
    }
  });
}

/** 닫는 것은 그 종류가 지금 보일 때만이다 — 다른 칸이 떠 있으면 누른 키가 뜻하는 화면으로 바뀐다 */
export function toggleDock(k: DockKind): void {
  if (kind === k) closeDock();
  else openDock(k);
}

export function toggleLauncherDock(): void {
  if (isLauncherKind(kind)) closeDock();
  else openDock(DEFAULT_LAUNCHER_SEGMENT);
}

/** 토글이 아니다 — 커서가 가장자리에 머문 것은 "열어 달라" 이지 "닫아 달라" 가 아니다 */
export function revealLauncherDock(): void {
  if (kind === null) openDock(DEFAULT_LAUNCHER_SEGMENT);
}
