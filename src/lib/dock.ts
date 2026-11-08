/**
 * **떠 있는 층(독)의 순수 규칙** — 런처 칸 표 · 머리 아이콘 줄 표 · 자리별 폭 clamp 와 브라우저별 저장 · 가장자리 호버 판정
 * (docs/log/2026-09-08-hosts-dock.md · docs/log/2026-09-08-settings-dock.md ·
 * docs/log/2026-09-25-unified-dock.md · 2026-10-18 통합 독 — 흩어진 메뉴(상태바 메뉴 칸 · 알림 종 팝오버 · 하단 호버 독)를
 * 이 독 하나로 모았다).
 *
 * 룬 상태(`app/dock.svelte.ts`)와 나눠 둔 이유는 하나다: 이 저장소의 vitest 는 `environment:
 * "node"` 에 svelte 컴파일러가 없어 **`.svelte.ts` 를 들여올 수 없다**
 * (docs/log/2026-09-05-vitest.md). 규칙(경계값·저장 실패)이 회귀 테스트를 받을 수 있는 자리는
 * 순수 모듈뿐이라, 상태는 저쪽에 두고 **판정과 저장은 여기**로 내렸다.
 */

// 이름은 **문구 키**다 — 이 모듈은 순수하게 남아야 해서 사전을 부르지 않는다
// (`status-items.ts` 와 같은 규칙). `import type` 이라 런타임 모듈 그래프에는 남지 않는다.
import type { Key } from "$lib/i18n/keys";

/** 독이 담을 수 있는 화면 — 런처·설정 중 **한 번에 하나**다. */
export type DockKind = "alerts" | "hosts" | "projects" | "db" | "settings";

/**
 * **런처 독의 칸** — 알림 · 호스트 · 프로젝트 · DB (docs/log/2026-09-25-unified-dock.md · DB 는 2026-10-12 · 알림은 2026-10-18 —
 * 상태바 종이 띄우던 알림 센터 팝오버가 이 칸으로 들어왔다).
 *
 * 넷은 "찾아서 열고 나오는" 같은 일을 하는 목록이라 **한 면의 칸들**(칸 줄 + 목록이 한 카드)로 선다.
 * 모형은 그대로 `DockKind` 하나다 — 칸을 고르는 것이 곧 종류를 바꾸는 것이고, 열린 채 종류를
 * 바꾸면 여닫이가 다시 돌지 않는 규칙(docs/log/2026-09-25-dock-slide.md)이 그대로 "칸 전환" 이
 * 된다. 설정은 **칸이 아니다** — 앱이 자기 얘기를 하는 다른 화면이라 제 머리줄·제 폭을 갖는다.
 */
export type LauncherKind = "alerts" | "hosts" | "projects" | "db";

/**
 * 독을 **칸을 정하지 않고** 열 때의 칸 — 창 가장자리 호버 · 상태바 알림 배지(2026-10-18 — 사용자 확정 · 상태바 독 단추는 실기 뒤 걷음).
 * 전용 단축키(`open-hosts-dock` · `open-projects-dock` · `open-db-dock`)와 팔레트 줄은 제 칸으로 연다. 예전에는 마지막으로 쓴 칸을 열었다.
 */
export const DEFAULT_LAUNCHER_SEGMENT: LauncherKind = "alerts";

/** 폭을 기억하는 자리 — 런처 둘은 **한 폭**을 나눠 쓰고, 설정은 제 폭이다 */
export type DockSlot = "launcher" | "settings";

/** 이 종류가 런처 독의 칸인가 (설정이 아닌가) */
export function isLauncherKind(k: DockKind | null | undefined): k is LauncherKind {
  return k === "alerts" || k === "hosts" || k === "projects" || k === "db";
}

/** 종류 → 폭을 기억하는 자리 */
export function dockSlotOf(k: DockKind): DockSlot {
  return isLauncherKind(k) ? "launcher" : "settings";
}

/** 바닥 줄의 키 안내 하나 — 키 글자(`↵` · `F2` …)와 그 뜻의 문구 키 */
export interface DockHint {
  /** 키 글자 — 번역하지 않는다(자판의 글자다). 조합은 `+` 로 잇는다 — `Keys` 가 키마다 칩으로 편다 */
  keys: string;
  labelKey: Key;
}

/** 런처 독의 한 칸 */
export interface LauncherSegment {
  kind: LauncherKind;
  /**
   * 이 칸을 여닫는 키바인딩 액션 id — `keybindings.ts` 의 `ACTIONS` 에 있는 글자. `null` 이면 **전용 단축키가 없는 칸**이다
   * (알림 — id 는 `settings.toml` 키라 사용자가 정하기 전에는 만들지 않는다 · DB 는 2026-10-21 에 정해졌다). 그 칸은 칸 막대 ·
   * 팔레트 줄(`paletteId`)로만 연다.
   */
  action: string | null;
  /** 팔레트에만 서는 여닫기 명령 id (`CommandPalette` 의 `PALETTE_ONLY`) — 단축키 액션이 없는 칸만 */
  paletteId?: string;
  /** 팔레트의 명령 줄이 빌려 가는 그림 (`ui-icons.generated.ts` 의 키) */
  icon: string;
  /** 칸 막대의 이름 */
  labelKey: Key;
  /**
   * 바닥 줄의 키 안내 — **그 칸에 실제로 있는 키만** 적는다. 없는 키를 안내하면 사람은 눌러
   * 보고 아무 일도 없다는 것을 배운다(그 뒤로는 바닥 줄 전체를 믿지 않는다). 키 처리는
   * 본문 컴포넌트(`Sidebar` · `ProjectList`)의 `onKeydown` 에 있다. 비어 있으면 그 칸은 **제 바닥 줄**을
   * 그린다(알림 — 새 알림 수 · [작업안 기록] · [모두 읽음], `Dock.svelte`).
   */
  hints: readonly DockHint[];
}

/**
 * 칸의 **순서** — 칸 줄 왼쪽에서 오른쪽 그대로. 알림이 맨 앞(독을 칸 없이 열면 서는 칸 — [`DEFAULT_LAUNCHER_SEGMENT`]),
 * 그다음이 단축키 H · J · K 의 순서다(홈 줄에 나란한 세 글자가 같은 순서로 선다 — 호스트 · 프로젝트 · DB).
 */
export const LAUNCHER_SEGMENTS: readonly LauncherSegment[] = [
  /**
   * **알림**(2026-10-18) — 승인 대기 · 확인할 것(에이전트 알림) · 지난 알림(`DockAlerts.svelte` — 옛 상태바 종의 팝오버).
   * 전용 단축키는 없다(id 는 `settings.toml` 키라 사용자가 정하기 전에는 만들지 않는다). 키 안내 대신
   * 제 바닥 줄을 그린다(`hints` 가 빈 칸).
   */
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
  /**
   * **DB** (2026-10-12 — 쿼리 타일의 연결 목록, docs/log/2026-10-12-query-tile.md). 데이터는 연결 목록 하나다(`db-connections.json` —
   * SSH 경유 · 직접 — 10-13 저장 하나로). 전용 단축키 `Ctrl+Shift+K`(2026-10-21 사용자 결정).
   */
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

/** 칸 하나를 찾는다 (순서 표에서) */
export function launcherSegment(k: LauncherKind): LauncherSegment {
  return LAUNCHER_SEGMENTS.find((s) => s.kind === k) ?? LAUNCHER_SEGMENTS[0];
}

/**
 * 칸 막대에서 옆 칸 — `delta` 는 ±1, 끝에서 **감싼다**(칸이 셋뿐이라 끝에서 멈추면 반대쪽
 * 끝으로 가는 길이 두 번 누르기가 된다 — WAI-ARIA 탭 목록의 관례도 감싸기다).
 */
export function adjacentSegment(k: LauncherKind, delta: number): LauncherKind {
  const n = LAUNCHER_SEGMENTS.length;
  const at = LAUNCHER_SEGMENTS.findIndex((s) => s.kind === k);
  const next = (((at < 0 ? 0 : at) + delta) % n + n) % n;
  return LAUNCHER_SEGMENTS[next].kind;
}

/** 브라우저별(창별이 아니다) 저장 자리 — 앱 접두사로 다른 값과 섞이지 않게 한다 */
export const DOCK_STORE_KEY = "aynx:dock";

/**
 * 1단계(호스트 전용)의 저장 자리 — **읽기에서만** 본다.
 *
 * 그때는 독이 하나뿐이라 `{ width }` 한 칸이었다. 지우지 않는 이유는 지울 값어치가 없기
 * 때문이다: 새 키가 생기는 순간(폭을 한 번 바꾸면) 이쪽은 다시 읽히지 않고, 남아 있어도
 * 몇 바이트다. **지우려다 던지는 편이 잃는 것이 크다** (`removeItem` 이 없는 스텁·차단된
 * 저장소에서 폭 하나 때문에 독이 안 뜨는 자리를 또 만든다).
 */
export const DOCK_LEGACY_STORE_KEY = "aynx:hosts-dock";

/**
 * 자리마다 다른 최소·기본 폭.
 *
 * - **런처**(호스트 · 프로젝트): 트리 한 줄(아이콘 + 이름 + 뒷글자 + 여백)이 잘리지
 *   않는 220, 기본 380 (2026-10-28 — 300 에서 넓혔다: 실행 단추 격자 판 E 의 글자 칸 두 열 + 52px 원
 *   둘이 이름을 자르지 않게. 저장된 폭은 그대로 이긴다 · 예전 고정 칼럼 240 · 다음 300).
 *   2026-09-25 에 세 칸이 한 면이 되면서 **한 폭**이 됐다 — 칸을 바꿀 때마다 상자가 들쑥날쑥
 *   하면 "같은 면의 다른 칸" 이 아니라 "다른 독" 으로 읽힌다 (docs/log/2026-09-25-unified-dock.md).
 * - **설정**: 왼쪽 섹션 내비 + 오른쪽 패널의 두 칸 구조라 훨씬 넓어야 한다. 기본 600 은
 *   **일부러 창을 다 덮지 않는 값**이다 — 색·투명도·글꼴을 바꾸는 화면이라, 오른쪽에
 *   터미널이 남아 있어야 바뀐 것이 그 자리에서 보인다 (1100px 창에서 500px 이 남는다).
 */
export const DOCK_SLOT_SPEC: Record<DockSlot, { min: number; def: number }> = {
  launcher: { min: 220, def: 380 },
  settings: { min: 420, def: 600 },
};

/** 종류별로 본 같은 표 — 런처 둘은 **같은 값**이다(한 자리를 나눠 쓴다) */
export const DOCK_SPEC: Record<DockKind, { min: number; def: number }> = {
  alerts: DOCK_SLOT_SPEC.launcher,
  hosts: DOCK_SLOT_SPEC.launcher,
  projects: DOCK_SLOT_SPEC.launcher,
  db: DOCK_SLOT_SPEC.launcher,
  settings: DOCK_SLOT_SPEC.settings,
};

/** 창 폭 대비 상한 — 독은 **작업면을 가리는 층**이라 절반을 넘는 것까지만 허용한다 */
export const DOCK_MAX_FRACTION = 0.6;

/**
 * 폭을 허용 범위로 자른다 — `[종류의 최소, max(종류의 최소, innerWidth × 0.6)]`.
 *
 * 상한을 `Math.max` 로 한 번 더 감싸는 이유: 좁은 창에서는 60% 가 최소 폭보다 작아져
 * **상한이 하한 아래로 내려간다**. 그때는 최소 폭을 지킨다 — 읽을 수 없는 독보다는 창을
 * 거의 덮는 독이 낫고, 그 폭에서는 어차피 타일 하나도 제대로 안 들어간다.
 *
 * `innerWidth` 를 모르면(0·NaN — 창이 아직 없는 자리) 상한을 걸지 않는다: 저장된 값을 상한
 * 때문에 조용히 깎아 놓고 다음 실행에서 되돌리지 못하는 일이 생기면 안 된다.
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

/** 저장된 표를 읽는다 — 못 읽으면 `null` (부르는 쪽이 기본값으로 간다) */
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

/** `{ width: 숫자 }` 모양이면 그 숫자, 아니면 `null` */
function widthOf(entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null) return null;
  const w = (entry as { width?: unknown }).width;
  return typeof w === "number" ? w : null;
}

/**
 * 저장된 폭을 읽는다 — **없거나 못 읽으면 그 자리의 기본값**이다.
 *
 * `localStorage` 접근은 언제든 던진다 (사생활 보호 모드·저장소 차단·webview 초기화 순서).
 * 폭 하나 때문에 화면이 안 뜨는 일이 없도록 읽기 전체를 감싼다 — 이 저장소의 다른 저장값들과
 * 같은 규칙이다 (`Sidebar` 의 보기 모드 · `favorites`).
 *
 * 런처는 **옛 칸들까지 본다** (2026-09-25 통합 전의 저장값을 잃지 않게):
 * `launcher` 칸 → 없으면 옛 `hosts`·`projects`·`layouts` 칸 중 **가장 넓은 것** → 없으면 1단계의
 * 옛 키(`aynx:hosts-dock`) → 기본값. 가장 넓은 것을 고르는 이유는 셋 중 누가 "마지막으로 쓴
 * 폭" 인지 저장값에 적혀 있지 않기 때문이다 — 좁은 쪽을 고르면 넓혀 둔 칸의 줄이 잘리고,
 * 넓은 쪽은 기껏해야 한 뼘 더 가린다(손잡이로 곧장 줄일 수 있다). 옛 칸은 **지우지 않는다**
 * (`DOCK_LEGACY_STORE_KEY` 주석과 같은 이유 — 새 칸이 생기면 다시 읽히지 않는다).
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

/**
 * 폭을 남긴다 — **그 자리(`launcher`·`settings`)의 칸만 덮어쓰고 나머지는 그대로 둔다**
 * (못 남겨도 이번 세션의 폭은 그대로다).
 *
 * 읽고 합쳐 쓰는 이유는 창이 여럿이기 때문이다: 이 창이 설정 폭을 저장하는 사이 다른 창이
 * 런처 폭을 저장했을 수 있고, 통째로 덮어쓰면 그쪽이 조용히 사라진다.
 */
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

// ---------------------------------------------------------------------------
// 채팅 독의 폭 (2026-10-23) — 런처와 같은 저장소(`DOCK_STORE_KEY`)의 **제 칸 `chat`** 에 남는다
// ---------------------------------------------------------------------------

/**
 * 채팅 독의 최소 · 기본 폭 — 최소 320 은 입력 칸 아래 칩(CLI · 모델)과 보내기 단추가 한 줄에 서는 폭, 기본 380 은 1차의 고정 폭이다.
 * 상한은 런처와 같은 창 폭의 [`DOCK_MAX_FRACTION`].
 */
export const CHAT_DOCK_SPEC = { min: 320, def: 380 } as const;

/** 채팅 독 폭을 자른다 — [`clampDockWidth`] 와 같은 셈(좁은 창에서는 최소가 이긴다 · 창 폭을 모르면 상한 없음) */
export function clampChatDockWidth(px: number, innerWidth: number): number {
  const want = Number.isFinite(px) ? px : CHAT_DOCK_SPEC.def;
  const cap =
    Number.isFinite(innerWidth) && innerWidth > 0
      ? Math.max(CHAT_DOCK_SPEC.min, innerWidth * DOCK_MAX_FRACTION)
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(Math.max(want, CHAT_DOCK_SPEC.min), cap));
}

/** 저장된 채팅 독 폭 — 없거나 못 읽으면 기본값 */
export function readChatDockWidth(innerWidth: number): number {
  const stored = widthOf(readStore(DOCK_STORE_KEY)?.chat);
  return clampChatDockWidth(stored ?? CHAT_DOCK_SPEC.def, innerWidth);
}

/** 채팅 독 폭을 남긴다 — `chat` 칸만 덮어쓴다([`writeDockWidth`] 와 같은 읽고 합쳐 쓰기) */
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

// ---------------------------------------------------------------------------
// 채팅 독의 갈래 (2026-10-25) — [채팅 | 작업안]. 같은 저장소의 `chatSection` 칸(폭과 같은 읽고 합쳐 쓰기)
// ---------------------------------------------------------------------------

/** 채팅 독의 갈래 — 사이드 채팅 · 작업안(옛 작업안 타일 — docs/log/2026-10-25-plans-tile-refresh.md) */
export type ChatDockSection = "chat" | "plans";

/** 저장값 → 갈래 — 모르는 값 · 없음은 채팅(순수) */
export function normalizeChatDockSection(value: unknown): ChatDockSection {
  return value === "plans" ? "plans" : "chat";
}

/** 저장된 갈래 — 없거나 못 읽으면 채팅 */
export function readChatDockSection(): ChatDockSection {
  return normalizeChatDockSection(readStore(DOCK_STORE_KEY)?.chatSection);
}

/** 갈래를 남긴다 — `chatSection` 칸만 덮어쓴다 */
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

// ---------------------------------------------------------------------------
// 머리 아이콘 줄 — 독 오른쪽 위의 단추 넷 (2026-10-18 통합 독)
// ---------------------------------------------------------------------------

/** 머리 아이콘 줄의 단추 하나 */
export interface DockTool {
  /** 단추의 뜻 — `Dock.svelte` 가 이것으로 갈라 부른다(저장 키가 아니다) */
  id: "lock" | "reload" | "settings" | "quit";
  /** 그림 — `ui-icons.generated.ts` 의 키(자물쇠는 볼트가 열려 있으면 `Dock.svelte` 가 `lock-open` 으로 바꿔 그린다) */
  icon: string;
  /** 툴팁 · 스크린 리더 이름 */
  labelKey: Key;
  /**
   * 툴팁에 조합을 적을 키바인딩 액션 id — 사용자가 키를 바꾸면 따라온다. `null` 이면 레지스트리 밖이다:
   * 새로고침은 브라우저 자체 키 `F5`(`fixedCombo` — 앱이 일부러 살려 둔 키, `isBrowserChromeCombo`).
   */
  action: string | null;
  /** 레지스트리 밖의 고정 조합(번역하지 않는 자판 글자) */
  fixedCombo?: string;
  /** 되돌릴 수 없는 일 — 호버 · 포커스에 실패색(`--err`)이 비친다 */
  danger?: boolean;
}

/**
 * 머리 아이콘 줄 — 왼쪽에서 오른쪽 그대로. 화면 잠금(자물쇠 — `toggle-veil`: 가림막 + 볼트 잠금. 그림은 볼트 상태 — 열림 🔓 ·
 * 잠김 · 없음 🔒, 옛 상태바 자물쇠의 규칙 그대로. 2026-10-23 명령 팔레트 단추 자리에 섰다 — 팔레트는 단축키 · 다른 입구로) ·
 * 새로고침(F5 와 같은 페이지 재부착 — 세션은 임대만 풀고 산다) ·
 * 설정(설정 모달) · 끝내기(`quit-app` — 끝내기 모달: 이 창 닫기 · 트레이 · GUI 종료 · 모두 종료를 고른다. 원격 창에는 없다).
 * 툴팁은 넷 다 이름 + 지금 조합뿐이다(2026-10-29 — 끝내기의 긴 설명은 걷었다 · 판마다 툴팁이 있다).
 * 문구 · 단축키 안내는 단추 옆에 적지 않는다(툴팁만 — 사용자 확정).
 */
export const DOCK_TOOLS: readonly DockTool[] = [
  { id: "lock", icon: "lock", labelKey: "app.statusbar.lock", action: "toggle-veil" },
  { id: "reload", icon: "refresh", labelKey: "app.dock.tool.reload", action: null, fixedCombo: "F5" },
  { id: "settings", icon: "settings", labelKey: "app.dock.tool.settings", action: "open-settings" },
  { id: "quit", icon: "power", labelKey: "app.dock.tool.quit", action: "quit-app", danger: true },
];

/**
 * 독이 그리는 **동작의 그림** — 명령 팔레트가 같은 일의 줄에 같은 그림을 빌려 간다(같은 일을 독에서 누르든 팔레트에서
 * 고르든 한 그림이어야 한다 — 표가 둘이면 한쪽만 고치는 사고가 난다). 예전에는 상태바 메뉴 칸 표(`status-items.ts`)가 이
 * 자리였다 — 그 칸들이 이 독으로 들어오며 그림도 따라왔다. 로컬 파일은 **열린 폴더**(프로젝트의 닫힌 폴더와 갈린다).
 */
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

// ---------------------------------------------------------------------------
// 가장자리 호버로 열기 (2026-10-18 통합 독) — 사이드 독의 판정
//
// 사이드 독은 **창 끝 기준 고정 띠**에 커서가 머물면 연다(사용자 결정 — 상태바 자리 · 모양과 무관): 독이 놓인 쪽 창 바깥
// 끝(x=0 또는 창 폭)에서 [`EDGE_BAND_PX`] 폭 · 제목줄 아래 ~ 창 아래 끝. 왼쪽 상태바 기둥이 있어도 띠는 창 끝이다(기둥 위에
// 겹친다 — 기둥에는 이제 표시뿐이다). 하단 즐겨찾기 독(`FloatingStatusDock`)은 이 판정을 쓰지 않는다 — 가운데 아래 국소
// 영역이라 하단 상태바가 있으면 그 바로 위에 띠를 둔다(창 끝에 두면 상태바의 다른 칸과 겹친다 — 10-18 사용자 정정).
//
// **왜 16px 고정인가.** 테두리 없는 창(`decorations: false`)의 크기 조절을 위해 Tauri(`tauri-runtime-wry` 의
// `undecorated_resizing.rs`)는 창이 최대화가 아니면 클라이언트 영역 **안쪽 가장자리**에 `SM_CXFRAME` 폭(배율과 상관없이 CSS px
// 로 약 4~6)의 투명 자식 창 `TAURI_DRAG_RESIZE_BORDERS` 를 덮는다 — 그 위의 포인터는 웹뷰로 오지 않는다. 처음의 5px 띠는 그 밑에
// 거의 다 깔려 열리지 않았고(10-18 실기), 상태바 기둥 · 감싸기(hug) 테두리에 맞춰 띠를 옮기던 방식은 설정마다 위치가 달랐다
// (hug 의 3px inset 은 늘림 조건에도 걸리지 않았다). 그래서 창 끝에서 OS 띠를 넉넉히 넘는 16px 을 늘 같은 자리에 둔다 —
// 최대화 · 원격 창(테두리 없음)도 같은 16px 이다(단순하게).
//
// 닫기는 여기 없다 — 호버로 열었어도 커서를 떼면 닫히지 않는다(사이드 독 — Esc · 바깥 누르기뿐 · 2026-09-03 에 되돌린 자동 숨김
// 사이드바가 "떼면 닫힘" 에서 죽었다: 끌기 도중 상자가 사라졌다). 띠는 **창 좌표 사각형**이라 아래 터미널의 누르기를 가로채지
// 않는다. 규칙(띠 · 시계 · 다시 열리지 않기)은 여기, 리스너와 타이머는 `Dock.svelte` 다.
// ---------------------------------------------------------------------------

/** 감지 띠의 폭(CSS px) — 창 끝의 OS 크기 조절 띠(약 4~6px)를 넉넉히 넘는 값 */
export const EDGE_BAND_PX = 16;

/** 띠에 머물러야 하는 시간 — 지나가는 커서(옆 타일로 가로지르는 손)로는 열리지 않게 */
export const EDGE_DWELL_MS = 250;

/** 화면 좌표의 상자 (`DOMRect` 의 네 변만) */
export interface EdgeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 창 크기 (CSS px — `innerWidth` · `innerHeight`) */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * 사이드 독의 띠 — 독이 놓인 쪽 창 바깥 끝에서 [`EDGE_BAND_PX`] 폭, `chromeTop`(제목줄 · 탭 줄의 아래 끝 — 모바일 배치면 그 위 띠의
 * 아래 끝) ~ 창 아래 끝. 상태바 자리 · 모양을 받지 않는다 — 그것과 무관하게 늘 같은 사각형이라는 것이 이 함수의 약속이다.
 */
export function sideEdgeStrip(side: "left" | "right", viewport: Viewport, chromeTop: number): EdgeRect {
  const top = Math.max(0, chromeTop);
  return side === "left"
    ? { left: 0, top, right: EDGE_BAND_PX, bottom: viewport.height }
    : { left: viewport.width - EDGE_BAND_PX, top, right: viewport.width, bottom: viewport.height };
}

/** 점이 띠 안인가 — 오른쪽 · 아래 변은 **열린** 끝이다(띠 바로 옆 칸은 띠가 아니다) */
export function inEdgeStrip(strip: EdgeRect | null, x: number, y: number): boolean {
  if (!strip) return false;
  return x >= strip.left && x < strip.right && y >= strip.top && y < strip.bottom;
}

/**
 * 호버 시계 — `since` = 띠에 들어와 머물기 시작한 시각(`null` = 세지 않는다), `needLeave` = **띠를 한 번 벗어나야** 다시 센다.
 *
 * `needLeave` 가 있는 이유: 커서가 띠에 그대로 있는 채 Esc 로 닫으면, 시계가 곧바로 다시 돌아 250ms 뒤에 **도로 열린다** —
 * 닫은 사람의 뜻을 거스른다. 그래서 닫히는 순간(그리고 호버로 연 순간) 이 표식을 세우고, 띠 밖으로 나간 움직임 하나가 걷는다.
 */
export interface EdgeHover {
  since: number | null;
  needLeave: boolean;
}

export const EDGE_IDLE: EdgeHover = { since: null, needLeave: false };

/** 독이 열렸다 · 닫혔다 — 띠를 벗어나기 전에는 다시 세지 않는다 */
export const EDGE_AFTER_CLOSE: EdgeHover = { since: null, needLeave: true };

/** 포인터 움직임 하나의 사실 — 부르는 쪽(`Dock.svelte`)이 잰다 */
export interface EdgePointer {
  /** 커서가 띠 안인가([`inEdgeStrip`]) */
  inStrip: boolean;
  /** 지금 열어도 되는 때인가 — 독 닫힘 · 모달 · 가림막 · 떠 있는 메뉴 없음(그 판정은 부르는 쪽) */
  allowed: boolean;
  /** 눌린 마우스 단추(`PointerEvent.buttons`) */
  buttons: number;
}

/**
 * 포인터 움직임 하나 → 다음 시계. 바뀐 것이 없으면 **같은 객체**를 돌려준다.
 *
 * - 띠 밖 — 시계도 표식도 걷는다(다음에 들어오면 처음부터 센다).
 * - 띠 안인데 열 수 없는 때(독이 이미 떠 있다 · 모달 …) — **띠를 벗어나야** 다시 센다. 독이 떠 있는 동안 커서가 그 자리에
 *   있다가 Esc 로 닫혀도 곧바로 도로 열리지 않게 — [`EdgeHover`] 의 `needLeave`.
 * - **단추를 누른 채로는 세지 않는다** — 글자를 고르거나 무언가를 끌며 창 끝까지 간 손은 독을 부른 것이 아니다(놓은 뒤
 *   머물면 그때부터 센다).
 */
export function edgeHoverMove(s: EdgeHover, p: EdgePointer, now: number): EdgeHover {
  if (!p.inStrip) return s.since === null && !s.needLeave ? s : EDGE_IDLE;
  if (!p.allowed) return s.since === null && s.needLeave ? s : EDGE_AFTER_CLOSE;
  if (p.buttons !== 0) return s.since === null ? s : { ...s, since: null };
  if (s.needLeave || s.since !== null) return s;
  return { since: now, needLeave: false };
}

/** 머문 시간이 찼는가 — 타이머가 울릴 때 한 번 더 묻는다(그 사이 시계가 멈췄을 수 있다) */
export function edgeHoverDue(s: EdgeHover, now: number, dwell = EDGE_DWELL_MS): boolean {
  return s.since !== null && now - s.since >= dwell;
}

// ---------------------------------------------------------------------------
// 독 배치 — 런처 독 · 채팅 독이 어느 쪽에 서나 (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md)
//
// 설정 `[dock] layout` 하나가 정한다. 채팅 독은 **늘 런처의 반대쪽**이라 두 독이 같은 창 끝(띠)을 두고 다투지 않는다 —
// 두 띠는 창의 양 끝 16px 이라 창이 32px 보다 넓으면 겹치지 않는다. "자동(상태바를 따름)" 은 두지 않는다(사용자 결정 — 예전에는
// 상태바가 오른쪽이면 런처가 오른쪽이었다).
// ---------------------------------------------------------------------------

/** 창의 한쪽 끝 */
export type DockSide = "left" | "right";

/** `[dock] layout` 의 값 — **`settings.toml` 키라 바꾸지 않는다** */
export type DockLayout = "launcher-left" | "launcher-right";

/** 안 정했을 때 — 런처 왼쪽 · 채팅 오른쪽 */
export const DEFAULT_DOCK_LAYOUT: DockLayout = "launcher-left";

/** 반대쪽 끝 */
export function oppositeSide(side: DockSide): DockSide {
  return side === "left" ? "right" : "left";
}

/** 배치 → 두 독의 쪽. 모르는 값(빈 값 · 옛 파일)은 기본 배치로 읽는다 */
export function dockSides(layout: string | null | undefined): { launcher: DockSide; chat: DockSide } {
  const launcher: DockSide = layout === "launcher-right" ? "right" : "left";
  return { launcher, chat: oppositeSide(launcher) };
}
