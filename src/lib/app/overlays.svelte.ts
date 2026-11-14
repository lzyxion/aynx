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

/** 화면 위에 겹쳐 뜨는 명령 팔레트·검색·단축키 치트시트. */

// ---------------------------------------------------------------------------
// 명령 팔레트 (docs/log/2026-09-03-command-palette.md)
//
// 팔레트 자신은 아무것도 실행하지 않고 고른 것을 위로 올려 보낸다 — 그래서 접속·그룹
// 열기·탭 전환·액션 실행이 전부 **이미 있던 함수 그대로** 돈다.
// ---------------------------------------------------------------------------

/**
 * 포커스 복귀 이름표 넷 (`app/focus-return`) — 넷 다 `{#if}` 로 마운트되므로 닫는 순간
 * 포커스가 `<body>` 로 떨어진다. 닫고 나서 **스스로 갈 곳을 정하는** 경로(팔레트의 한 줄 실행 ·
 * 검색 결과 점프)는 그 판정이 `app/focus-return` 안에 있다.
 */
const FOCUS_PALETTE = "palette";
const FOCUS_SEARCH = "search";
const FOCUS_CHEAT = "cheat-sheet";

let paletteOpen = $state(false);

/**
 * 팔레트가 **열릴 때 입력칸에 미리 찍혀 있을 질의** (보통 접두사 한 글자).
 *
 * 검색 오버레이의 `seed` 와 같은 규약이다(이 파일 아래) — 팔레트는 `{#if}` 로 마운트되므로
 * 이 값은 **여는 순간 한 번**만 뜻이 있고, 그 뒤로는 사용자가 친 글자가 주인이다. 그래서
 * 여기 사는 것도 "지금 화면의 질의" 가 아니라 **다음에 열 때 찍을 글자**뿐이다.
 */
let paletteSeedState = $state("");

export function paletteSeed(): string {
  return paletteSeedState;
}

/**
 * **거울 모드** — 팔레트가 떠 있되 입력칸이 포커스를 **아직 받지 않은** 동안의 질의(`null` = 거울 아님,
 * 보통의 팔레트). launcher 에서 한글 IME 로 타자를 시작했을 때만 선다(docs/log/2026-09-25-launcher.md 3절).
 *
 * IME 조합은 그것이 시작된 편집 요소에 묶여 있고, 조합 중에 포커스를 옮기면 Chromium 이 조합을
 * **취소**한다(첫 자모가 사라지거나 쪼개진다). 그래서 조합은 launcher 의 숨은 입력칸(포커스 주인)에서
 * 그대로 이어 가고, 팔레트는 그 칸의 값을 이 상태로 받아 **비춰 보이기만** 한다. 조합이 아닌 키가
 * 처음 오는 순간(방향키·Enter·Escape·라틴 글자·Backspace …) launcher 가 [`releasePaletteMirror`] 로
 * 거울을 걷고 — 그때는 조합이 없으니 옮겨도 안전하다 — 팔레트 입력칸이 포커스와 질의를 넘겨받는다.
 */
let paletteMirrorState = $state<string | null>(null);

export function paletteMirror(): string | null {
  return paletteMirrorState;
}

/** 거울 모드의 질의를 갈아 끼운다 — 거울이 아니면 아무 일도 하지 않는다 */
export function mirrorPaletteQuery(query: string): void {
  if (paletteMirrorState !== null) paletteMirrorState = query;
}

/** 거울을 걷는다 — 팔레트가 마지막 질의를 쥔 채 입력칸에 포커스를 가져간다 (`CommandPalette`) */
export function releasePaletteMirror(): void {
  paletteMirrorState = null;
}

/**
 * 그룹 경로 → 그 폴더의 메타 (아이콘 `svg:docker` · `🚀` 와 색 — `GroupMeta`).
 *
 * 팔레트의 그룹 줄이 세션 타일과 **같은 얼굴**을 그리게 하려고 여기서 읽는다. 팔레트는
 * 스스로 파일을 읽지 않는 화면이고, 세션 타일은 떠 있지 않을 수도 있으므로(앱을 켜자마자
 * `Ctrl+Shift+P`) 팔레트를 **열 때마다** 한 번 읽어 둔다 — 늦게 와도 화면이 저절로
 * 갱신되고, 못 읽으면 조용히 빈 채로 둔다.
 */
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

/**
 * 마우스 · 타자로 여는 길 — 시작 화면의 타자 · 독 머리의 팔레트 단추 (키 쪽은 `runAction("command-palette")` → [`togglePalette`]).
 *
 * `seed` 는 미리 찍을 질의다 — 빈 값이 기본이고, 접두사 하나를 넣으면 그 섹션만 보이는
 * 채로 열린다 ([`openSnippetPalette`]). `mirror` 는 거울 모드로 연다
 * ([`paletteMirror`] — 시작 화면의 IME 조합 시작 한 곳만 쓴다).
 *
 * 판은 어디서 열든 **같은 자리**다 — 타일 캔버스 기준([`tileCanvasRect`] · `placeDefaultPalette`). 예전엔 시작 화면의 검색 칸이
 * 보이면 그 칸 자리에 겹쳐 펼쳤는데(`anchor` · `visibleLauncherAnchor`), 2026-10-28 위젯 판에서 칸을 걷으며 함께 걷었다
 * (docs/log/2026-10-28-start-widgets.md).
 */
export function openPalette(seed = "", opts: { mirror?: boolean } = {}): void {
  if (!paletteOpen) rememberFocusOrigin(FOCUS_PALETTE);
  paletteSeedState = seed;
  paletteMirrorState = opts.mirror ? seed : null;
  refreshGroupIcons();
  paletteOpen = true;
}

/**
 * 타일 캔버스(`[data-tile-canvas]` — `+page` 의 `.pane`)의 지금 사각형 — 칸 없이 연 팔레트의 기준
 * 상자(`placeDefaultPalette`). 없거나 크기가 0 이면 `null`(팔레트는 CSS 의 창 기준 자리로 물러선다).
 * 팔레트가 창 크기가 바뀔 때마다 다시 부른다 — 예전 CSS 자리도 창을 따라 움직였다.
 */
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

/**
 * `Ctrl+Shift+P` 는 **토글**이다 — 같은 키로 열고 닫는다.
 *
 * 팔레트가 떠 있는 동안에는 창 핸들러까지 조합이 오지 않는다(입력칸이 포커스라 편집 필드
 * 가드에 걸린다). 그래서 닫는 쪽은 팔레트가 **자기 키 핸들러에서** 같은 조합을 보고 스스로
 * 닫는다. 여기 토글이 남아 있는 이유는 팔레트 밖에서 이 액션이 불렸을 때 뜻이 한결같게
 * 하기 위해서다.
 */
export function togglePalette(): void {
  // 여는 길·닫는 길 **둘 다 그 한 문을 지난다** — 포커스 복귀 배선이 한 벌이어야 한다.
  // 키로 여는 팔레트는 **언제나 빈 질의**다: 앞서 스니펫으로 연 글자가 남아 있으면
  // `Ctrl+Shift+P` 가 열 때마다 화면이 달라진다.
  if (paletteOpen) closePalette();
  else openPalette("");
}

// ---------------------------------------------------------------------------
// 터미널 검색 오버레이 (`SearchOverlay.svelte`)
//
// 팔레트와 **같은 모양**이다: 열림 여부 한 칸 + `{#if}` 마운트. 질의는 여기 두지 않고
// 컴포넌트의 지역 상태로 둔다 (파일 머리말 — 닫으면 저절로 비워진다). 여기 사는 것은
// **열림 여부와 seed 뿐**이고, seed 는 "열 때의 칩 + 검색어" 라는 일회성 값이다
// (`find` 액션이 포커스된 터미널의 **라벨을 칩으로** 넣어 준다).
//
// seed 가 문자열 한 줄이 아니라 두 칸인 이유는 오버레이가 범위를 글자가 아니라 **칩**으로
// 세우기 때문이다 (`search-chips.ts`). 타입만 빌려 오므로 값 임포트가 생기지 않는다 —
// 그 파일은 임포트가 하나도 없어 애초에 순환이 날 자리도 없다.
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

/**
 * 오버레이를 닫고 **열려 있던 모든 터미널의 하이라이트를 지운다**.
 *
 * 지우지 않으면 사용자에게 색칠을 걷을 길이 남지 않는다 — 강조는 창 전역 오버레이가 얹은
 * 것이고, 타일 쪽에는 그것을 끄는 손잡이가 없다. "닫았는데 화면이 알록달록한 채로 남는"
 * 상태는 그 자체로 버그처럼 보이므로 닫기와 지우기를 한 동작으로 묶는다.
 *
 * 예외는 하나, **결과로 점프한 경우**다 → [`closeSearchKeeping`].
 */
export function closeSearch(): void {
  searchOpen = false;
  for (const t of searchTargets()) t.clear();
  returnFocus(FOCUS_SEARCH);
}

/**
 * 점프 전용 닫기 — `keepPaneId` **하나만 빼고** 나머지 하이라이트를 지운다.
 *
 * 결과 목록에서 한 줄을 고르는 몸짓의 뜻은 "찾았다, 거기로 가자" 라서 오버레이는 닫혀야
 * 한다. 그런데 [`closeSearch`] 를 그대로 쓰면 방금 간 그 터미널의 강조까지 같이 지워져,
 * 화면에 도착했을 때 **무엇을 찾았는지 표시가 사라진** 상태가 된다 — 점프의 목적이 통째로
 * 무너진다. 그래서 닫기를 두 갈래로 나눴다: 그냥 닫으면 전부 지우고, 점프로 닫으면 도착한
 * 타일의 색칠만 남긴다.
 *
 * 남긴 색칠은 **영원하지 않다** — 도착한 타일에 `keep()` 으로 "이건 남긴 것" 이라고 알려
 * 두면, 그 타일이 `stepKept`(`search-registry.ts`)의 규칙대로 **사용자의 다음 행동**에
 * 스스로 걷는다: 그 터미널에 키를 치거나, 그 타일이 포커스를 잃는 순간이다. (물론 새 검색을
 * 열고 닫아도 [`closeSearch`] 가 걷는다 — 그건 그대로 남아 있는 길이다.)
 */
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
//
// 팔레트가 "액션을 **실행하는** 길" 이라면 이쪽은 **읽는 길**이다. 그래서 목록도 다르다:
// 레지스트리의 조합뿐 아니라 **레지스트리에 없는 고정 키**(탐색기 타일의 Ctrl+A/C/X/V·
// F2·Backspace, 마우스 몸짓)까지 한 장에 편다 — 그것들은 어디에도 적혀 있지 않아서 실제로
// 아무도 몰랐다.
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

/** 액션 `cheat-sheet`·`?`·메뉴·시작 화면이 모두 이리로 온다 — 같은 키로 닫힌다 */
export function toggleCheatSheet(): void {
  if (cheatOpen) {
    closeCheatSheet();
    return;
  }
  rememberFocusOrigin(FOCUS_CHEAT);
  cheatOpen = true;
}

/**
 * 치트시트의 "설정에서 바꾸기" — 설정 독을 열고 **단축키 섹션**을 펴 준다
 * (docs/log/2026-09-08-settings-dock.md).
 *
 * 섹션 요청은 모듈 상태 한 칸(`settingsNav`)으로 간다. 설정 화면은 여기서 컴포넌트를 직접
 * 부를 길이 없고(독은 늘 마운트돼 있고 타일은 이미 떠 있을 수도, 방금 생길 수도 있다),
 * 프롭으로 내리려면 `Dock`·`PaneHost` 를 한 겹 더 지나야 한다 — 값이 한 번 쓰이고 버려지는
 * 신호라 통로를 새로 파는 것보다 게시판 한 칸이 맞다. **먼저 적고 나서 연다**: `SettingsModal`
 * 의 `$effect` 가 그 칸을 읽고 곧바로 비운다.
 */
export function openKeybindingSettings(): void {
  settingsNav.want = "keys";
  // 갈 곳을 이 몸짓이 정했다(설정 독) — [`closeCheatSheet`] 를 타지 않는다: 그쪽이 포커스를 놓으면 독이 `<body>` 를
  // 돌아갈 자리로 적어, 독을 닫을 때 포커스 타일로 가지 못한다(적어 둔 상자가 사라져야 독이 포커스 타일로 돌려준다).
  cheatOpen = false;
  forgetFocusOrigin(FOCUS_CHEAT);
  openDock("settings");
}

/**
 * 팔레트의 **"스니펫 관리…"** 줄 · 설정으로 가는 길 — 설정 독을 열고 스니펫 섹션을 펴 준다
 * (docs/log/2026-09-16-snippets.md).
 *
 * 위 [`openKeybindingSettings`] 와 같은 배관이다 (게시판 한 칸 `settingsNav` → 독 열기).
 * 스니펫을 **고르는** 길은 이제 [`openSnippetPalette`] 이고, 이 함수는 **만들고 고치는**
 * 길만 맡는다.
 */
export function openSnippetSettings(): void {
  settingsNav.want = "snippets";
  openDock("settings");
}

/**
 * **설정 › 보안**을 연다 — 부팅의 "설정에 없는 AI 위임" 알림이 누르는 단추
 * (docs/log/2026-09-21-fleet-delegation-ui.md).
 *
 * 위 둘과 같은 배관이다 (게시판 한 칸 `settingsNav` → 독 열기). 섹션 id 는 화면 이름(`보안`)
 * 이 아니라 `credentials` 다 — 라벨만 바뀌었고 id 는 그대로다(docs/conventions.md).
 * `anchor` 를 주면 그 줄까지 간다 — 알림은 `DELEGATION_ORPHANS_ANCHOR` 로 AI 권한 호스트 하위 화면을 [정리 필요]로 연다(2026-10-21).
 */
export function openCredentialsSettings(anchor: string | null = null): void {
  settingsNav.anchor = anchor;
  settingsNav.want = "credentials";
  openDock("settings");
}

/*
 * (옛 `openAutomationSettings` — 상태바 `⚡` 가 설정 › 자동 승인을 열던 길 — 은 2026-10-24 End-4 알약에서 ⚡ 가 표시뿐이
 * 되며 걷었다. 같은 섹션은 아래 `openSettingsAt("automation")` 으로 연다.)
 */

/**
 * 팔레트의 **설정 줄** — 설정 독을 열고 그 섹션을 편 뒤 그 줄까지 간다
 * (docs/log/2026-09-25-palette.md · 색인은 `settings-index.ts`).
 *
 * 위 셋과 같은 배관이다 (게시판 한 칸 `settingsNav` → 독 열기). 줄은 `anchor`(DOM id)로
 * 가리키고, 없으면 섹션만 편다. 독이 이미 설정을 보이고 있어도 같은 길이다 — 섹션 교체와
 * 스크롤은 `SettingsModal` 이 게시판을 읽는 자리 하나에서 일어난다.
 */
export function openSettingsAt(section: string, anchor: string | null = null): void {
  settingsNav.anchor = anchor;
  settingsNav.want = section;
  openDock("settings");
}

/**
 * `insert-snippet`(`Ctrl+Shift+;`) — **팔레트를 스니펫 접두사로 연다**
 * (docs/log/2026-09-16-snippets.md).
 *
 * 액션 하나에 "어느 스니펫" 을 실을 수 없으므로(사용할 스니펫을 고르는
 * 사정) 이 키는 **고르는 화면을 여는 문**이고, 그 화면이 팔레트다: 목록을 그 자리에서 글자로
 * 좁히고 `Enter` 로 넣는다. 접두사를 찍어 두는 이유는 키로 들어온 사람의 관심이 스니펫
 * 하나뿐이기 때문이고, 지우면 그대로 전체 팔레트가 된다 (접두사는 지름길이지 모드가 아니다).
 *
 * 열려 있는 팔레트에 접두사를 **덮어쓰지 않는다** — `seed` 는 마운트 한 번의 값이라
 * ([`paletteSeedState`]) 어차피 닿지 않고, 팔레트가 떠 있는 동안에는 입력칸 포커스 가드에
 * 막혀 이 액션이 오지도 않는다.
 */
export function openSnippetPalette(): void {
  openPalette(SNIPPET_QUERY_PREFIX);
}
