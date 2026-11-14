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
 * **독 — 타일 위에 떠 있는 층 하나** (docs/log/2026-09-08-hosts-dock.md ·
 * docs/log/2026-09-08-settings-dock.md).
 *
 * 규칙 한 줄: **작업면은 타일, 앱 자신의 화면은 떠 있는 층.** 호스트 목록은 무언가를 여는
 * **런처**이고 설정은 앱이 자기 얘기를 하는 화면이라, 둘 다 탭마다 한 칸씩 차지하고 배치
 * 파일에까지 남을 이유가 없다. 그래서 이것은 **창마다 하나**이고, 탭 트리에 들어가지 않으며,
 * 배치에 저장되지 않는다 (i3 의 scratchpad 와 같은 자리).
 *
 * **열린 표면은 하나** (`dockKind()`)다. 런처는 좌측 독, 설정은 가운데 모달로 그린다
 * (docs/log/2026-10-02-settings-modal.md). 여닫기 통로를 유지해 단축키·상태바·설정 줄 요청이
 * 같은 표면을 가리키고, 종류를 바꿔도 처음 열기 전의 포커스로 돌아간다.
 *
 * 설정은 모달만 제공한다. 설정 타일의 생성·복원·렌더링 경로는 없다.
 * 호스트 쪽에도 타일이 없다 (docs/log/2026-09-08-remove-hosts-tile.md).
 *
 * 호스트 · 프로젝트는 2026-09-25 에 **한 면(런처 독)의 두 칸**이 됐다
 * (docs/log/2026-09-25-unified-dock.md) — 모형은 그대로 종류 하나이고, 칸 막대가 그 종류를
 * 바꾼다. 둘은 한 폭을 나눠 쓴다(`DockSlot`).
 *
 * 2026-10-18 통합 독 — 칸이 넷(알림 · 호스트 · 프로젝트 · DB)이 되고, 칸을 정하지 않고 여는 길(창 가장자리 호버)은 **늘
 * 알림 칸**을 연다(`DEFAULT_LAUNCHER_SEGMENT` — 예전의 "마지막으로 쓴 칸" 기억은 걷었다). 상태바의 독 입구 칸은 같은 날 실기 뒤
 * 걷었다 — 독은 가장자리 호버 · 단축키 · 팔레트 · 알림 배지로 연다.
 *
 * **설정을 떠나는 길은 한 문을 지난다**(2026-10-22 — docs/log/2026-10-22-settings-close-asks-save.md): 설정이 떠 있을 때
 * [`closeDock`] · 다른 종류로 [`openDock`](토글 포함)은 먼저 [`setSettingsLeaveGuard`] 로 건 문에 묻는다 — 미저장 변경이 있으면
 * 그 문이 저장할지 물은 뒤 나중에 이어서 닫거나(또는 닫지 않거나) 한다. 문은 `SettingsModal.svelte` 가 건다(이 모듈은 설정을 모른다).
 *
 * 여기 사는 것은 셋뿐이다: **무엇이 열려 있나 · 자리별 폭 · 돌아갈 포커스**(+ 설정을 떠나는 문 하나).
 * 폭의 규칙과 저장은 순수 모듈(`$lib/dock`)에 있어 테스트를 받는다.
 */

/** 지금 독에 떠 있는 화면 (`null` = 닫혀 있다) */
let kind = $state<DockKind | null>(null);

/**
 * 자리마다 따로 기억한다 — 트리 한 칸과 설정 두 칸은 애초에 필요한 폭이 다르다. 런처 두 칸은
 * **한 자리**다: 칸을 바꿀 때마다 상자가 들쑥날쑥하면 한 면의 칸이 아니라 다른 독으로 읽힌다.
 */
let widths = $state<Record<DockSlot, number>>({
  launcher: DOCK_SLOT_SPEC.launcher.def,
  settings: DOCK_SLOT_SPEC.settings.def,
});

/**
 * 독을 열기 **직전에** 포커스를 쥐고 있던 요소 — 닫을 때 그리로 돌려준다.
 *
 * `$state` 가 아니다: 아무도 이 값을 그리지 않는다 (룬으로 만들면 DOM 노드 하나가 프록시에
 * 감싸이고, 그 프록시로 `focus()` 를 부르는 자리가 생긴다).
 */
let returnFocusTo: HTMLElement | null = null;

/** 저장된 폭을 아직 안 읽었다 — 마운트 때 한 번만 읽는다 (임포트 시점에 DOM 을 만지지 않는다) */
let restored = false;

function windowWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

/**
 * 지금 떠 있는 화면 (`null` = 닫혀 있다) — **논리의** 답이다. 닫히는 140ms 동안의 그림(제목·
 * 본문·폭)은 컴포넌트가 마지막으로 보이던 종류로 고른다 (`Dock.svelte` 의 `shown`).
 */
export function dockKind(): DockKind | null {
  return kind;
}

/**
 * 그 종류의 폭 — **지금 열린 종류가 아니라 넘겨받은 종류**다.
 *
 * 닫히는 동안(`--edge-dock-dur` — 2026-10-23 부터 200ms) 독은 `kind === null` 인데도 아직 그려져 있다 (docs/log/2026-09-25-dock-slide.md).
 * 그때 "지금 종류의 폭" 을 물으면 답할 종류가 없어 호스트 폭으로 튀었다 — 그래서 컴포넌트가
 * **마지막으로 보이던 종류**를 들고 와서 묻는다. 드래그 중에는 그 종류가 곧 지금 종류라
 * `setDockWidth` 가 바꾼 값이 그대로 따라온다.
 */
export function dockWidthOf(k: DockKind): number {
  return widths[dockSlotOf(k)];
}

/**
 * 저장된 폭을 한 번 읽어 온다 — 컴포넌트가 마운트에서 부른다.
 *
 * 모듈이 임포트되는 순간 `localStorage`·`window` 를 만지지 않으려고 함수로 뺐다 (그 순간에
 * 던지면 앱이 통째로 안 뜬다). 두 번 불려도 한 번만 읽는다 — 창을 분리하면 같은 모듈이
 * 새 창에서 다시 살아나므로 창마다 한 번이다.
 */
export function restoreDockWidths(): void {
  if (restored) return;
  restored = true;
  const w = windowWidth();
  widths = {
    launcher: readDockWidth("hosts", w), // 런처 둘은 한 자리 — 어느 칸으로 물어도 같다
    settings: readDockWidth("settings", w),
  };
}

/**
 * 지금 떠 있는 화면의 폭을 바꾼다 — 손잡이를 끄는 **매 프레임** 불린다. `persist` 는 손을
 * 뗄 때만 참이다 (드래그 내내 `localStorage` 에 쓰면 프레임마다 동기 디스크 접근이 든다).
 */
export function setDockWidth(px: number, persist = false): void {
  const k = kind;
  if (k === null) return; // 닫혀 있으면 끌 손잡이도 없다
  const slot = dockSlotOf(k);
  widths[slot] = clampDockWidth(k, px, windowWidth());
  if (persist) writeDockWidth(k, widths[slot]);
}

/**
 * 연다 — **여는 순간의 포커스를 적어 둔다.** 독은 잠깐 들렀다 나오는 층이라, 나올 때
 * 원래 치던 자리로 돌아가지 않으면 키보드가 어디 있는지 알 수 없다.
 *
 * 이미 열려 있으면 **내용만 바꾼다** — 그때 돌아갈 자리는 처음 연 자리 그대로다 (독 안에서
 * 화면을 갈아 끼운 것은 "들렀다" 의 일부이지 새로 들른 것이 아니다).
 */
export function openDock(k: DockKind): void {
  if (kind === "settings" && k !== "settings" && leaveSettings(() => openDock(k))) return;
  if (kind === null) {
    const el = typeof document === "undefined" ? null : document.activeElement;
    returnFocusTo = el instanceof HTMLElement ? el : null;
  }
  kind = isLauncherKind(k) ? normalizeLauncherSegment(k) : k;
}

/**
 * 닫는다. `restore` 는 **키보드로 닫았을 때만** 참이다 (Escape · 머리줄의 ×).
 *
 * 런처 바깥 클릭으로 닫을 때는 **돌려주지 않는다**: 그 몸짓은 이미 갈 곳을
 * 정해 놓았고(클릭한 그 타일), 여기서 옛 자리로 한 번 더 옮기면 방금
 * 누른 곳에서 포커스가 튕겨 나간다.
 */
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
  // 적어 둔 요소가 사라졌거나(타일이 닫혔다·다시 그려졌다 · 치트시트의 [설정에서 바꾸기] 단추처럼 독을 연 상자가 걷혔다)
  // `<body>` 였으면 지금 포커스된 타일의 **키보드 몸**으로 — 모달이 닫힐 때 돌려주는 것과 같은 길이다(`focusPaneBody`
  // — 터미널이면 xterm 의 textarea, 세션 없는 타일이면 `[data-tile-focus]`). `routeTileFocus` 는 "옮겨 왔을 때" 의 효과라
  // `[data-tile-focus]` 만 보고, 터미널 타일에서는 아무것도 하지 않아 포커스가 `<body>` 로 떨어졌다.
  const tab = activeTab();
  const pane = tab ? paneOf(tab) : null;
  if (pane) focusPaneBody(pane);
}

/**
 * 독을 닫은 **뒤에** `then` 을 잇는다 — 설정에서 다른 화면으로 가는 길(설정 › 테마 › 아바타의 [아티스트에서 편집 →]). 설정이면 떠나는 문
 * ([`setSettingsLeaveGuard`])을 먼저 지난다: 미저장 변경을 물은 뒤 떠나면 잇고, 물리면(계속 편집) 잇지 않는다. 포커스는 돌려주지 않는다
 * (`then` 이 갈 곳을 정한다).
 */
export function closeDockThen(then: () => void): void {
  if (kind === "settings" && leaveSettings(() => closeDockThen(then))) return;
  closeDock(false);
  then();
}

/**
 * 설정을 떠나기 전에 묻는 문 — `go` 를 받아 **맡았으면 `true`**(나중에 `go()` 로 잇거나, 물리면 부르지 않는다), 그냥 떠나도 되면
 * `false`. 맡은 동안 다시 불리면(Escape 를 거듭 누름) 또 묻지 않고 삼킨다.
 */
type SettingsLeaveGuard = (go: () => void) => boolean;
let settingsLeaveGuard: SettingsLeaveGuard | null = null;
let leaving = false;

/** 설정을 떠나는 문을 건다(`null` = 걷는다) — `SettingsModal.svelte` 가 마운트에서 */
export function setSettingsLeaveGuard(guard: SettingsLeaveGuard | null): void {
  settingsLeaveGuard = guard;
}

/** 문에 묻는다 — 참이면 문이 맡았다(부른 쪽은 멈춘다). 문이 `go` 를 부를 때는 문을 건너 곧바로 떠난다 */
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

/**
 * `open-hosts-dock`(`Ctrl+Shift+H`) · `open-projects-dock`(`Ctrl+Shift+J`) ·
 * `open-settings`(`Ctrl+,`) · 상태바 알림 배지(`alerts`) · 팔레트 —
 * **같은 키로 열고 닫는다.**
 *
 * 닫는 것은 **그 종류가 지금 보일 때만**이다. 호스트 칸을 띄워 둔 채 `Ctrl+Shift+J` 를
 * 누르면 닫히는 것이 아니라 프로젝트 칸으로 **바뀐다**(여닫이는 다시 돌지 않는다), `Ctrl+,`
 * 면 설정으로 바뀐다 — 누른 키가 뜻하는 화면이 나오는 것이 언제나 맞다.
 */
export function toggleDock(k: DockKind): void {
  if (kind === k) closeDock();
  else openDock(k);
}

/**
 * 하단 가운데 독의 **런처 단추**(2026-10-18) — 런처 독이 떠 있으면 닫고, 아니면 기본 칸(알림)으로 연다. 설정 모달 동안에는
 * 하단 독 자체가 막혀 있어 여기 오지 않는다(오더라도 런처로 바뀐다 — 누른 단추가 뜻하는 화면).
 */
export function toggleLauncherDock(): void {
  if (isLauncherKind(kind)) closeDock();
  else openDock(DEFAULT_LAUNCHER_SEGMENT);
}

/**
 * 독을 **연다**(이미 런처가 떠 있으면 그대로) — 창 가장자리 호버(2026-10-18). 토글이 아니다: 커서가 가장자리에 머문 것은
 * "열어 달라" 이지 "닫아 달라" 가 아니다. 설정 모달이 떠 있으면 건드리지 않는다(부르는 쪽이 `dockKind() === null` 만 부른다).
 */
export function revealLauncherDock(): void {
  if (kind === null) openDock(DEFAULT_LAUNCHER_SEGMENT);
}
