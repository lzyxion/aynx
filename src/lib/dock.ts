/**
 * 떠 있는 층(독)의 순수 규칙 — 칸 표 · 폭 저장 · 가장자리 호버 판정.
 * 룬 상태(`app/dock.svelte.ts`)와 나눈 까닭: vitest 는 `.svelte.ts` 를 들여올 수 없어 판정 · 저장은 여기서만 테스트를 받는다.
 */

// 이 모듈은 사전을 부르지 않는다 — 이름은 문구 키로만 둔다
import type { Key } from "$lib/i18n/keys";

export type DockKind = "alerts" | "hosts" | "projects" | "db" | "settings";

/** 설정은 칸이 아니다 — 제 머리줄 · 제 폭을 갖는다 */
export type LauncherKind = "alerts" | "hosts" | "projects" | "db";

/** 독을 칸을 정하지 않고 열 때의 칸 — 창 가장자리 호버 · 상태바 알림 배지 */
export const DEFAULT_LAUNCHER_SEGMENT: LauncherKind = "alerts";

/** 런처 칸들은 한 폭을 나눠 쓴다 — 칸마다 폭이 다르면 다른 독으로 읽힌다 */
export type DockSlot = "launcher" | "settings";

export function isLauncherKind(k: DockKind | null | undefined): k is LauncherKind {
  return k === "alerts" || k === "hosts" || k === "projects" || k === "db";
}

export function dockSlotOf(k: DockKind): DockSlot {
  return isLauncherKind(k) ? "launcher" : "settings";
}

export interface DockHint {
  /** 번역하지 않는다(자판의 글자). 조합은 `+` 로 잇는다 — `Keys` 가 키마다 칩으로 편다 */
  keys: string;
  labelKey: Key;
}

export interface LauncherSegment {
  kind: LauncherKind;
  /** `keybindings.ts` 의 `ACTIONS` id(`settings.toml` 키) — `null` 이면 전용 단축키가 없고 `paletteId` 로 연다 */
  action: string | null;
  /** `CommandPalette` 의 `PALETTE_ONLY` id */
  paletteId?: string;
  icon: string;
  labelKey: Key;
  /** 그 칸에 실제로 있는 키만 적는다(키 처리는 `Sidebar` · `ProjectList`). 비어 있으면 제 바닥 줄을 그린다(`Dock.svelte`) */
  hints: readonly DockHint[];
}

/** 칸 줄 왼쪽→오른쪽 순서. 알림 다음은 단축키 H · J · K 와 같은 순서다 */
export const LAUNCHER_SEGMENTS: readonly LauncherSegment[] = [
  /** 전용 단축키는 없다 — id 는 `settings.toml` 키라 사용자가 정하기 전에는 만들지 않는다 */
  {
    kind: "alerts",
    action: null,
    paletteId: "open-alerts-dock",
    icon: "bell",
    labelKey: "app.dock.title.alerts",
    hints: [],
  },
  {
    kind: "hosts",
    action: "open-hosts-dock",
    icon: "server",
    labelKey: "app.dock.title.hosts",
    hints: [
      { keys: "↵", labelKey: "app.dock.hint.connect" },
      { keys: "Ctrl+↵", labelKey: "app.dock.hint.newTab" },
      { keys: "F2", labelKey: "app.dock.hint.edit" },
    ],
  },
  {
    kind: "projects",
    action: "open-projects-dock",
    icon: "project",
    labelKey: "app.dock.title.projects",
    hints: [
      { keys: "↵", labelKey: "app.dock.hint.open" },
      { keys: "Ctrl+↵", labelKey: "app.dock.hint.here" },
      { keys: "Ins", labelKey: "app.dock.hint.worktree" },
    ],
  },
  {
    kind: "db",
    action: "open-db-dock",
    icon: "database",
    labelKey: "app.dock.title.db",
    hints: [
      { keys: "↵", labelKey: "app.dock.hint.open" },
      { keys: "Ctrl+↵", labelKey: "app.dock.hint.newTile" },
      { keys: "F2", labelKey: "app.dock.hint.edit" },
    ],
  },
];

export function launcherSegment(k: LauncherKind): LauncherSegment {
  return LAUNCHER_SEGMENTS.find((s) => s.kind === k) ?? LAUNCHER_SEGMENTS[0];
}

/** 끝에서 감싼다(WAI-ARIA 탭 목록의 관례) */
export function adjacentSegment(k: LauncherKind, delta: number): LauncherKind {
  const n = LAUNCHER_SEGMENTS.length;
  const at = LAUNCHER_SEGMENTS.findIndex((s) => s.kind === k);
  const next = (((at < 0 ? 0 : at) + delta) % n + n) % n;
  return LAUNCHER_SEGMENTS[next].kind;
}

/** 브라우저별(창별이 아니다) 저장 자리 — 값은 저장소에 남으니 바꾸지 않는다 */
export const DOCK_STORE_KEY = "aynx:dock";

/**
 * 옛 저장 자리 — 읽기에서만 본다. 지우지 않는다 — `removeItem` 이 없는 스텁 · 차단된 저장소에서 던지면 독이 안 뜬다.
 */
export const DOCK_LEGACY_STORE_KEY = "aynx:hosts-dock";

/** 설정 기본 600 은 일부러 창을 다 덮지 않는 값이다 — 색 · 글꼴을 바꾸면 옆 터미널에서 그 자리에서 보여야 한다 */
export const DOCK_SLOT_SPEC: Record<DockSlot, { min: number; def: number }> = {
  launcher: { min: 220, def: 380 },
  settings: { min: 420, def: 600 },
};

export const DOCK_SPEC: Record<DockKind, { min: number; def: number }> = {
  alerts: DOCK_SLOT_SPEC.launcher,
  hosts: DOCK_SLOT_SPEC.launcher,
  projects: DOCK_SLOT_SPEC.launcher,
  db: DOCK_SLOT_SPEC.launcher,
  settings: DOCK_SLOT_SPEC.settings,
};

export const DOCK_MAX_FRACTION = 0.6;

/**
 * 좁은 창에서 상한이 하한 아래로 내려가면 최소 폭을 지킨다.
 * `innerWidth` 를 모르면(0 · NaN) 상한을 걸지 않는다 — 저장된 값을 조용히 깎아 다음 실행에서 되돌리지 못한다.
 */
export function clampDockWidth(kind: DockKind, px: number, innerWidth: number): number {
  const spec = DOCK_SPEC[kind];
  const want = Number.isFinite(px) ? px : spec.def;
  const cap =
    Number.isFinite(innerWidth) && innerWidth > 0
      ? Math.max(spec.min, innerWidth * DOCK_MAX_FRACTION)
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(Math.max(want, spec.min), cap));
}

function readStore(key: string): Record<string, unknown> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function widthOf(entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null) return null;
  const w = (entry as { width?: unknown }).width;
  return typeof w === "number" ? w : null;
}

/**
 * 런처는 옛 칸(`hosts` · `projects` · `layouts` · 옛 키)까지 본다 — 옛 저장값을 잃지 않게. 옛 칸 중 누가 마지막인지 모르니
 * 가장 넓은 것을 고른다(좁은 쪽은 넓혀 둔 칸의 줄을 자른다). 옛 칸은 지우지 않는다(`DOCK_LEGACY_STORE_KEY` 와 같은 이유).
 */
export function readDockWidth(kind: DockKind, innerWidth: number): number {
  const slot = dockSlotOf(kind);
  const store = readStore(DOCK_STORE_KEY);
  const stored = widthOf(store?.[slot]);
  if (stored !== null) return clampDockWidth(kind, stored, innerWidth);
  if (slot === "launcher") {
    const olds = (["hosts", "projects", "layouts"] as const)
      .map((k) => widthOf(store?.[k]))
      .filter((w): w is number => w !== null);
    if (olds.length > 0) return clampDockWidth(kind, Math.max(...olds), innerWidth);
    const legacy = widthOf(readStore(DOCK_LEGACY_STORE_KEY));
    if (legacy !== null) return clampDockWidth(kind, legacy, innerWidth);
  }
  return clampDockWidth(kind, DOCK_SPEC[kind].def, innerWidth);
}

/** 그 자리 칸만 읽고 합쳐 쓴다 — 통째로 덮으면 다른 창이 저장한 칸이 조용히 사라진다 */
export function writeDockWidth(kind: DockKind, px: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    const store = readStore(DOCK_STORE_KEY) ?? {};
    store[dockSlotOf(kind)] = { width: px };
    localStorage.setItem(DOCK_STORE_KEY, JSON.stringify(store));
  } catch {
    /* 저장 못 해도 폭은 이번 세션 동안 유지된다 */
  }
}

// ── 채팅 독의 폭 ──

/** 최소 320 은 입력 칸 아래 칩과 보내기 단추가 한 줄에 서는 폭 */
export const CHAT_DOCK_SPEC = { min: 320, def: 380 } as const;

export function clampChatDockWidth(px: number, innerWidth: number): number {
  const want = Number.isFinite(px) ? px : CHAT_DOCK_SPEC.def;
  const cap =
    Number.isFinite(innerWidth) && innerWidth > 0
      ? Math.max(CHAT_DOCK_SPEC.min, innerWidth * DOCK_MAX_FRACTION)
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(Math.max(want, CHAT_DOCK_SPEC.min), cap));
}

export function readChatDockWidth(innerWidth: number): number {
  const stored = widthOf(readStore(DOCK_STORE_KEY)?.chat);
  return clampChatDockWidth(stored ?? CHAT_DOCK_SPEC.def, innerWidth);
}

export function writeChatDockWidth(px: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    const store = readStore(DOCK_STORE_KEY) ?? {};
    store.chat = { width: px };
    localStorage.setItem(DOCK_STORE_KEY, JSON.stringify(store));
  } catch {
    /* 저장 못 해도 폭은 이번 세션 동안 유지된다 */
  }
}

// ── 채팅 독의 갈래 ──

export type ChatDockSection = "chat" | "plans";

export function normalizeChatDockSection(value: unknown): ChatDockSection {
  return value === "plans" ? "plans" : "chat";
}

export function readChatDockSection(): ChatDockSection {
  return normalizeChatDockSection(readStore(DOCK_STORE_KEY)?.chatSection);
}

export function writeChatDockSection(section: ChatDockSection): void {
  try {
    if (typeof localStorage === "undefined") return;
    const store = readStore(DOCK_STORE_KEY) ?? {};
    store.chatSection = section;
    localStorage.setItem(DOCK_STORE_KEY, JSON.stringify(store));
  } catch {
    /* 저장 못 해도 갈래는 이번 세션 동안 유지된다 */
  }
}

/** 구형 저장값의 layouts 칸은 호스트 칸으로 접는다. ID를 실행 경로에 재사용하지 않는다. */
export function normalizeLauncherSegment(value: unknown): LauncherKind {
  return value === "alerts" || value === "projects" || value === "db" ? value : "hosts";
}

// ── 머리 아이콘 줄 ──

export interface DockTool {
  /** 저장 키가 아니다 */
  id: "lock" | "reload" | "settings" | "quit";
  /** 자물쇠는 볼트가 열려 있으면 `Dock.svelte` 가 `lock-open` 으로 바꿔 그린다 */
  icon: string;
  labelKey: Key;
  /** `null` 이면 레지스트리 밖 — 새로고침 `F5` 는 앱이 일부러 살려 둔 브라우저 키다(`isBrowserChromeCombo`) */
  action: string | null;
  fixedCombo?: string;
  danger?: boolean;
}

/** 문구 · 단축키 안내는 단추 옆에 적지 않는다 — 툴팁만(사용자 결정) */
export const DOCK_TOOLS: readonly DockTool[] = [
  { id: "lock", icon: "lock", labelKey: "app.statusbar.lock", action: "toggle-veil" },
  { id: "reload", icon: "refresh", labelKey: "app.dock.tool.reload", action: null, fixedCombo: "F5" },
  { id: "settings", icon: "settings", labelKey: "app.dock.tool.settings", action: "open-settings" },
  { id: "quit", icon: "power", labelKey: "app.dock.tool.quit", action: "quit-app", danger: true },
];

/** 명령 팔레트도 이 표를 빌려 간다 — 표를 둘로 나누면 한쪽만 고치는 사고가 난다 */
export const DOCK_ACTION_ICONS: readonly (readonly [action: string, icon: string])[] = [
  ["new-shell", "terminal"],
  ["open-localfs", "folder-open"],
  ["command-palette", "command"],
  ["folder-conversations", "conversations"],
  ["open-console", "list"],
  ["open-plans", "list-checks"],
  ["orchestration-start", "orchestra"],
  ["orchestration-board", "orchestra"],
  ["open-settings", "settings"],
  ["quit-app", "power"],
];

// ── 가장자리 호버로 열기 ──
// 커서를 떼도 닫지 않는다(Esc · 바깥 누르기뿐) — "떼면 닫힘" 은 끌기 도중 상자가 사라져 걷었다. 리스너 · 타이머는 `Dock.svelte`.

/**
 * 테두리 없는 창의 크기 조절용 Tauri 자식 창 `TAURI_DRAG_RESIZE_BORDERS`(`undecorated_resizing.rs` · 약 4~6px)가 창 안쪽 끝을
 * 덮어 그 위 포인터는 웹뷰로 오지 않는다 — 그보다 넉넉한 값이어야 띠가 열린다.
 */
export const EDGE_BAND_PX = 16;

/** 지나가는 커서로는 열리지 않게 */
export const EDGE_DWELL_MS = 250;

export interface EdgeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** 상태바 자리 · 모양과 무관하게 늘 창 끝의 같은 사각형이다(사용자 결정) */
export function sideEdgeStrip(side: "left" | "right", viewport: Viewport, chromeTop: number): EdgeRect {
  const top = Math.max(0, chromeTop);
  return side === "left"
    ? { left: 0, top, right: EDGE_BAND_PX, bottom: viewport.height }
    : { left: viewport.width - EDGE_BAND_PX, top, right: viewport.width, bottom: viewport.height };
}

/** 오른쪽 · 아래 변은 열린 끝이다 */
export function inEdgeStrip(strip: EdgeRect | null, x: number, y: number): boolean {
  if (!strip) return false;
  return x >= strip.left && x < strip.right && y >= strip.top && y < strip.bottom;
}

/** `needLeave` 를 빼면 띠에 커서를 둔 채 Esc 로 닫은 독이 250ms 뒤 도로 열린다 */
export interface EdgeHover {
  since: number | null;
  needLeave: boolean;
}

export const EDGE_IDLE: EdgeHover = { since: null, needLeave: false };

export const EDGE_AFTER_CLOSE: EdgeHover = { since: null, needLeave: true };

export interface EdgePointer {
  inStrip: boolean;
  /** 독 닫힘 · 모달 · 가림막 · 떠 있는 메뉴 없음 — 판정은 부르는 쪽 */
  allowed: boolean;
  /** `PointerEvent.buttons` */
  buttons: number;
}

/** 바뀐 것이 없으면 같은 객체를 돌려준다. 단추를 누른 채로는 세지 않는다 — 끌며 창 끝까지 간 손은 독을 부른 것이 아니다 */
export function edgeHoverMove(s: EdgeHover, p: EdgePointer, now: number): EdgeHover {
  if (!p.inStrip) return s.since === null && !s.needLeave ? s : EDGE_IDLE;
  if (!p.allowed) return s.since === null && s.needLeave ? s : EDGE_AFTER_CLOSE;
  if (p.buttons !== 0) return s.since === null ? s : { ...s, since: null };
  if (s.needLeave || s.since !== null) return s;
  return { since: now, needLeave: false };
}

/** 타이머가 울릴 때 한 번 더 묻는다 — 그 사이 시계가 멈췄을 수 있다 */
export function edgeHoverDue(s: EdgeHover, now: number, dwell = EDGE_DWELL_MS): boolean {
  return s.since !== null && now - s.since >= dwell;
}

// ── 독 배치 ──
// 채팅 독은 늘 런처의 반대쪽이다 — 두 독이 같은 창 끝 띠를 두고 다투지 않게. "상태바를 따름" 은 두지 않는다(사용자 결정).

export type DockSide = "left" | "right";

/** `[dock] layout` 의 값 — `settings.toml` 에 글자 그대로 남으니 바꾸지 않는다 */
export type DockLayout = "launcher-left" | "launcher-right";

export const DEFAULT_DOCK_LAYOUT: DockLayout = "launcher-left";

export function oppositeSide(side: DockSide): DockSide {
  return side === "left" ? "right" : "left";
}

/** 모르는 값(빈 값 · 옛 파일)은 기본 배치로 읽는다 */
export function dockSides(layout: string | null | undefined): { launcher: DockSide; chat: DockSide } {
  const launcher: DockSide = layout === "launcher-right" ? "right" : "left";
  return { launcher, chat: oppositeSide(launcher) };
}
