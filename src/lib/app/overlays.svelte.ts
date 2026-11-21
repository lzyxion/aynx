import { openDock } from "$lib/app/dock.svelte.js";
import {
  forgetFocusOrigin,
  rememberFocusOrigin,
  returnFocus,
} from "$lib/app/focus-return.svelte.js";
import { settingsNav } from "$lib/settings.svelte.js";
import { listGroupMeta, type GroupMeta } from "$lib/hosts";
import { searchTargets } from "$lib/search-registry";
import { SNIPPET_QUERY_PREFIX } from "$lib/snippets";
import type { CanvasRect } from "$lib/launcher";
import type { ChipState } from "$lib/search-chips";

// ---------------------------------------------------------------------------
// 명령 팔레트 (docs/log/2026-09-03-command-palette.md)
// ---------------------------------------------------------------------------

const FOCUS_PALETTE = "palette";
const FOCUS_SEARCH = "search";
const FOCUS_CHEAT = "cheat-sheet";

let paletteOpen = $state(false);

/** 팔레트는 `{#if}` 로 마운트되므로 이 값은 여는 순간 한 번만 뜻이 있다 — 다음에 열 때 찍을 글자 */
let paletteSeedState = $state("");

export function paletteSeed(): string {
  return paletteSeedState;
}

/**
 * IME 조합 중에 포커스를 옮기면 Chromium 이 조합을 취소한다 — 조합은 launcher 의 숨은 입력칸에서 이어 가고 팔레트는 비춰 보이기만 한다.
 * 조합이 아닌 키가 처음 오는 순간 launcher 가 [`releasePaletteMirror`] 로 거울을 걷는다. `null` = 거울 아님.
 */
let paletteMirrorState = $state<string | null>(null);

export function paletteMirror(): string | null {
  return paletteMirrorState;
}

export function mirrorPaletteQuery(query: string): void {
  if (paletteMirrorState !== null) paletteMirrorState = query;
}

export function releasePaletteMirror(): void {
  paletteMirrorState = null;
}

let groupMeta = $state<Record<string, GroupMeta>>({});

export function paletteVisible(): boolean {
  return paletteOpen;
}

export function groupMetaMap(): Record<string, GroupMeta> {
  return groupMeta;
}

function refreshGroupIcons(): void {
  void listGroupMeta()
    .then((m) => {
      groupMeta = m;
    })
    .catch(() => {});
}

export function openPalette(seed = "", opts: { mirror?: boolean } = {}): void {
  if (!paletteOpen) rememberFocusOrigin(FOCUS_PALETTE);
  paletteSeedState = seed;
  paletteMirrorState = opts.mirror ? seed : null;
  refreshGroupIcons();
  paletteOpen = true;
}

export function tileCanvasRect(): CanvasRect | null {
  if (typeof document === "undefined") return null;
  const r = document.querySelector("[data-tile-canvas]")?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

export function closePalette(): void {
  paletteOpen = false;
  paletteMirrorState = null;
  returnFocus(FOCUS_PALETTE);
}

/** 팔레트가 떠 있는 동안에는 이 조합이 창 핸들러에 오지 않는다 — 닫기는 팔레트가 자기 키 핸들러에서 한다 */
export function togglePalette(): void {
  // 키로 여는 팔레트는 언제나 빈 질의다 — 스니펫으로 연 글자가 남으면 열 때마다 화면이 달라진다.
  if (paletteOpen) closePalette();
  else openPalette("");
}

// ---------------------------------------------------------------------------
// 터미널 검색 오버레이 (`SearchOverlay.svelte`)
// ---------------------------------------------------------------------------

let searchOpen = $state(false);
let searchSeedState = $state<ChipState>({ scopeChip: null, blockChip: null, text: "" });

export function searchVisible(): boolean {
  return searchOpen;
}

export function searchSeed(): ChipState {
  return searchSeedState;
}

export function openSearch(seed: ChipState): void {
  if (!searchOpen) rememberFocusOrigin(FOCUS_SEARCH);
  searchSeedState = seed;
  searchOpen = true;
}

/** 닫기와 하이라이트 지우기는 한 동작이다 — 타일 쪽에는 강조를 끄는 손잡이가 없다 */
export function closeSearch(): void {
  searchOpen = false;
  for (const t of searchTargets()) t.clear();
  returnFocus(FOCUS_SEARCH);
}

/** 도착한 타일의 색칠만 남긴다 — 남긴 것은 그 타일이 사용자의 다음 행동에 스스로 걷는다(`search-registry.ts` 의 `stepKept`) */
export function closeSearchKeeping(keepPaneId: string): void {
  searchOpen = false;
  // 갈 곳을 이 몸짓이 이미 정했다 (점프한 타일) — 옛 자리로 되돌리지 않는다.
  forgetFocusOrigin(FOCUS_SEARCH);
  for (const t of searchTargets()) {
    if (t.paneId === keepPaneId) t.keep();
    else t.clear();
  }
}

// ---------------------------------------------------------------------------
// 단축키 치트시트 (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md)
// ---------------------------------------------------------------------------

let cheatOpen = $state(false);

export function cheatSheetVisible(): boolean {
  return cheatOpen;
}

export function closeCheatSheet(): void {
  cheatOpen = false;
  // 치트시트는 나가는 전이(220ms) 동안 남는다 — 상자가 포커스를 쥔 채 남으면 돌려주기가 "누가 가져갔다" 로 읽고 물러서고,
  // 전이가 끝나면 포커스가 `<body>` 로 떨어진다. 프로필 전환(`app/profile-switcher`)과 같은 처방 — 상자의 포커스를 먼저 놓는다.
  const ae = typeof document === "undefined" ? null : document.activeElement;
  if (ae instanceof HTMLElement && ae.closest("[data-cheat-sheet]")) ae.blur();
  returnFocus(FOCUS_CHEAT);
}

export function toggleCheatSheet(): void {
  if (cheatOpen) {
    closeCheatSheet();
    return;
  }
  rememberFocusOrigin(FOCUS_CHEAT);
  cheatOpen = true;
}

/** 먼저 적고 나서 연다 — `SettingsModal` 의 `$effect` 가 그 칸을 읽고 곧바로 비운다 */
export function openKeybindingSettings(): void {
  settingsNav.want = "keys";
  // [`closeCheatSheet`] 를 타지 않는다 — 그쪽이 포커스를 놓으면 독이 `<body>` 를 돌아갈 자리로 적어 독을 닫을 때 포커스 타일로 가지 못한다.
  cheatOpen = false;
  forgetFocusOrigin(FOCUS_CHEAT);
  openDock("settings");
}

export function openSnippetSettings(): void {
  settingsNav.want = "snippets";
  openDock("settings");
}

export function openTemplateSettings(): void {
  settingsNav.want = "templates";
  openDock("settings");
}

/** 섹션 id 는 화면 이름(`보안`)이 아니라 `credentials` 다 — 라벨만 바뀌었고 id 는 그대로다(docs/conventions.md) */
export function openCredentialsSettings(anchor: string | null = null): void {
  settingsNav.anchor = anchor;
  settingsNav.want = "credentials";
  openDock("settings");
}

export function openSettingsAt(section: string, anchor: string | null = null): void {
  settingsNav.anchor = anchor;
  settingsNav.want = section;
  openDock("settings");
}

export function openSnippetPalette(): void {
  openPalette(SNIPPET_QUERY_PREFIX);
}
