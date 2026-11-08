import { invoke, isRemote, listen } from "./ipc";
import { isUserAppIconId } from "$lib/settings/model/options";
import { rememberSplashUserIcon } from "$lib/splash-memo";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { syncStoredMode } from "$lib/mode.svelte.js";
import { upgradeLegacyAppColors } from "$lib/app-color-themes";
import {
  applySettings,
  normalizeSettings,
  saveSettings,
  settings,
} from "$lib/settings.svelte.js";
import { collectWallpapers, refreshWallpaper, wallpaperUrl } from "$lib/wallpaper.svelte.js";
import { applyStartBoard, onStartBoardChange, startBoardSnapshot } from "$lib/start-widgets.svelte.js";
import { createLatestDebounce, START_BOARD_SAVE_DELAY_MS } from "$lib/start-board-sync";
import type { StartBoardSnapshot } from "$lib/start-widgets";
import { plainStartBoard } from "$lib/start-widgets";
import {
  MAX_PROFILES,
  MAX_PROFILE_NAME,
  applyAppearance,
  parseProfiles,
  profileNamed,
  renameProfile as renameInList,
  sameAppearance,
  serializeProfiles,
  snapshotAppearance,
  withProfile,
  withStartBoard,
  withoutProfile,
  type ThemeProfile,
} from "$lib/theme-profiles";

/**
 * **모양 프로필의 상태와 적용** (docs/log/2026-09-15-theme-profiles.md).
 *
 * 규칙은 전부 순수 층(`theme-profiles.ts`)에 있고, 여기서 하는 일은 셋이다 —
 * 목록을 창에 하나 들고 있기 · 파일과 주고받기 · **입힌 뒤의 뒤처리**.
 *
 * ## 왜 모듈 상태인가
 *
 * 읽는 화면이 둘(설정의 "프로필" 묶음 · 명령 팔레트)이고 둘은 서로를 모른다.
 * `layouts.svelte.ts` 와 같은 모양으로 둔다 — 값은 **창에 하나뿐인 목록**이라 나눠 들
 * 이유가 없다.
 *
 * ## 입힌 뒤의 뒤처리는 **설정 화면이 쓰는 함수 그대로**다
 *
 * | 무엇 | 누가 | 왜 |
 * | --- | --- | --- |
 * | 값 검사 | `normalizeSettings` | 파일에서 읽은 설정이 지나는 바로 그 그물 (모르는 모드·범위 밖 투명도) |
 * | `<html data-theme>` · 색 선택기 기본값 | `syncStoredMode` | [취소](`revertSettings`)가 쓰는 그 함수 |
 * | 인라인 색 토큰 · 파생 토큰 · `--term-bg` | `applySettings` | 미리보기와 같은 한 함수 |
 * | 파일 저장 · 다른 창 알림 | `saveSettings` | 설정 화면의 [저장] 과 같은 길 |
 * | 배경 URL | `refreshWallpaper` | 부팅·이미지 선택이 쓰는 그 함수 |
 * | 앱 아이콘(창 · 작업 표시줄 · 트레이) | `applySettings` 의 `syncAppIcon` → Rust `set_app_icon` | 고르기 칩과 같은 길 — 원격은 그대로 · 지워진 사용자 아이콘은 기본([`iconChoice`]) |
 * | 크롬/터미널 투명도 · xterm 팔레트 | `+page` 의 `$effect` | **아무것도 안 해도** 따라온다 (설정을 구독한다) |
 *
 * 모드만은 [`setAppMode`](`mode.svelte.ts`) 를 **부르지 않는다**: 그 함수는 모드에 맞춰
 * 터미널 프리셋을 짝으로 갈아 끼우는데, 프로필은 자기 프리셋을 이미 들고 있어 그 교체가
 * 방금 입힌 값을 덮는다. 값을 적고 `syncStoredMode` 로 화면만 맞추는 것이 맞는 순서다.
 *
 * ## 저장은 언제 하나
 *
 * **곧바로 저장한다**(프로필 고르기는 한 벌을 통째로 되살리는 일이라 설정 [저장] 을 기다리지 않는다 — 그래서 [저장] 의 프로필 반영도
 * 타지 않는다, 적용 직후엔 어차피 같다). 단 설정 화면에 **다른** 미저장 변경이 있으면 앞지르지 않는다 — 그때는 사람이 [저장]/[취소] 앞에 서 있는 중이고,
 * 프로필 적용이 그의 미결정 값까지 확정해 버리면 [취소] 가 되돌릴 자리를 잃는다.
 */

/*
 * ## 시작 화면 한 벌(위젯 배치 + 시계 표시)도 프로필마다 담는다 (2026-11-03 — 자동 저장)
 *
 * 프로필 항목의 `startBoard` 칸(`theme-profiles.ts`). 길은 셋이다 —
 *  · **자동 저장** — 고른 프로필이 있으면 사람이 배치 · 시계 표시를 바꿀 때마다(`start-widgets.svelte.ts` 의 귀 —
 *    놓는 순간에만 불린다) 그 프로필의 칸에 담는다. 잇단 변경은 마지막 하나로 묶고(`start-board-sync.ts` — 400ms), 파일 쓰기는
 *    조작 단위 명령(아래 "쓰기" — 디스크의 최신 위에 그 칸만) 하나를 지난다. 저장 시각 · 목록 순서는 바꾸지 않고, "(수정됨)" 도
 *    켜지 않는다(배치는 `appearance` 밖이다).
 *  · **입히기** — [`applyProfile`] 이 그 프로필의 칸으로 배치 · 표시를 갈아 끼운다(localStorage 도). 칸이 없는 옛 프로필이면 지금
 *    배치를 그대로 두고, 그 뒤 옮기면 그때부터 담긴다. 입히기 **전**에 기다리던 변경은 앞 프로필에 먼저 담는다(`flush`).
 *  · **새로 저장 · 덮어쓰기 · 설정 저장의 반영** — 지금 한 벌을 함께 담는다.
 * 설정 화면 · Ctrl+Shift+U 전환기 · 명령 팔레트가 모두 [`applyProfile`] · [`saveCurrentAs`] 하나를 지나므로 길이 갈리지 않는다.
 *
 * **원격 웹 창**은 집 PC 주 창의 한 벌을 거울로 따른다(2026-11-04 · `start-widgets.svelte.ts` 머리말 — 예전엔 그 브라우저에 따로 들었다). 그래서 원격은 프로필의 배치를
 * **스스로 입히지 않는다** — 원격이 프로필을 고르면 그 고름이 파일을 지나 집 PC 주 창에 닿고(`theme-profiles-changed` → [`followActive`]) 그 창이 입힌 결과가 거울로 돌아온다
 * (집 PC 창이 없으면 지금 배치 그대로). 원격의 배치는 프로필에 자동으로 담지 않는다(원격에는 편집이 없다). [새로 저장] · 덮어쓰기는 지금 보이는 한 벌(= 받은 집 PC 값)을 담는다.
 */

/** 최신순 목록 (맨 앞이 가장 최근에 저장한 것) */
let profiles = $state<ThemeProfile[]>([]);
/** 마지막으로 적용한 프로필 id — 목록과 **같은 파일**에 산다 (`ThemeProfileFile.active`) */
let activeId = $state<string | null>(null);
/** 파일을 이미 읽었는가 — [`loadThemeProfiles`] 는 창당 한 번만 실제로 읽는다 */
let loaded = false;

/** 지금 목록 (최신순). 읽기는 반응형이라 저장·삭제가 곧바로 화면에 닿는다 */
export function themeProfiles(): readonly ThemeProfile[] {
  return profiles;
}

/** 지금 고른 프로필의 id (`null` = 고른 것 없음) */
export function activeProfileId(): string | null {
  return activeId;
}

/** id 로 하나 찾기 (없으면 `undefined`) */
export function findThemeProfile(id: string): ThemeProfile | undefined {
  return profiles.find((p) => p.id === id);
}

/**
 * 고른 프로필이 있고, **지금 모양이 그것과 다른가** — 목록의 "(수정됨)" 표시가 이 값이다.
 *
 * 프로필을 적용한 뒤 색 하나를 고치면 그 자리에서 켜진다 (설정 상태를 반응형으로 읽는다).
 */
export function isModified(): boolean {
  const active = activeId === null ? undefined : findThemeProfile(activeId);
  if (!active) return false;
  return !sameAppearance(snapshotAppearance(settings.current), active.appearance);
}

// ---------------------------------------------------------------------------
// 파일
// ---------------------------------------------------------------------------

/**
 * 저장된 목록을 읽는다 — **창당 한 번**. 실패하면 빈 목록으로 시작한다
 * (`loadLayouts` 와 같은 규칙: 프로필 파일 하나 때문에 앱이 못 뜨면 안 된다).
 */
export async function loadThemeProfiles(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const file = parseProfiles(await invoke<string | null>("load_theme_profiles"));
    if (!file) return;
    profiles = file.profiles;
    activeId = file.active;
  } catch {
    // 명령이 없거나 못 읽는 환경 — 프로필 없이 시작한다.
  }
}

// ---------------------------------------------------------------------------
// 쓰기 — 조작 단위 (2026-11-03 — 창 여럿의 덮어쓰기 경합 없음)
//
// 예전엔 창마다 목록 전체를 파일에 통째로 썼다(`save_theme_profiles`) — 창 A 의 변경을 창 B 의 다음 쓰기가 B 의 옛 사본으로
// 덮었다. 이제 조작 하나(새로 저장 · 덮어쓰기 · 배치 칸 · 이름 · 삭제 · 고르기)를 Rust `theme_profiles_edit` 에 보내고, Rust 가
// 잠금 아래 **디스크의 최신 위에** 그 조작만 얹어 쓴다(`app_state.rs`). 화면은 먼저 고쳐 두고(바로 보이게) 돌아온 파일 글자로
// 맞춘다. 이 창의 조작은 줄 하나로 차례를 지킨다(늦게 온 응답이 앞선 응답을 덮지 않게). 쓴 뒤 Rust 가 `theme-profiles-changed`
// 를 내면 창마다(원격 웹 창 포함) 목록을 다시 읽는다 — 아래 [`reloadFromDisk`].
// ---------------------------------------------------------------------------

type ProfileOp =
  | { op: "put"; profile: unknown; max: number; activate: boolean }
  | { op: "board"; id: string; board: StartBoardSnapshot }
  | { op: "remove"; id: string }
  | { op: "rename"; id: string; name: string }
  | { op: "activate"; id: string | null };

/** 이 창의 쓰기 · 다시 읽기 차례 */
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch(() => {
    // 실패는 조용히 넘긴다 — 화면의 목록은 메모리에 그대로이고, 다음 다시 읽기(이벤트 · 다음 조작)가 파일과 맞춘다.
  });
}

function edit(op: ProfileOp): void {
  enqueue(async () => {
    const json = await invoke<string>("theme_profiles_edit", { op });
    adopt(json, false);
    // 덮어쓰기 · 삭제로 어느 배경도 안 가리키게 된 사본을 치운다 — 파일에 **쓴 뒤**라야 백엔드가 새 목록을 읽는다
    // (docs/log/2026-09-28-profile-cards-wallpapers.md).
    if (op.op === "put" || op.op === "remove") void collectWallpapers();
  });
}

/** 저장할 모양의 프로필 하나(칸 순서 고정 — `serializeProfiles` 와 같은 모양) */
const plainProfile = (p: ThemeProfile): unknown => serializeProfiles([p], null).profiles[0];

/**
 * 파일 글자로 목록 · 고른 프로필을 맞춘다. `fromOther` — 다른 창(또는 이 창이 모르는 길)의 변경을 받은 것. 그때 고른 프로필이
 * 바뀌었으면 [`followActive`].
 */
function adopt(json: string | null, fromOther: boolean): void {
  const file = parseProfiles(json);
  if (!file) return;
  const prev = activeId;
  profiles = file.profiles;
  activeId = file.active;
  if (fromOther && prev !== activeId) followActive();
}

/**
 * **다른 창이 고른 프로필을 바꿨다** — 이 창의 시작 화면 배치도 그 프로필의 것으로 맞춘다(담긴 칸이 있을 때만 — 입히기와 같은 규칙).
 * 모양(색 · 테마)은 설정 저장 알림(`settings-saved`)이 따로 맞춘다. 이렇게 해야 "이 창의 배치 = 고른 프로필의 배치" 가 지켜져, 이
 * 창이 다음에 배치를 옮길 때 새 프로필 칸을 앞 프로필의 배치로 덮지 않는다. 기다리던 배치 변경은 앞 프로필 id 로 이미 붙어 있어
 * 그쪽으로 먼저 담긴다(`flush`).
 */
function followActive(): void {
  boardSaver.flush();
  if (isRemote) return; // 원격의 배치는 거울이 준다(머리말)
  const now = activeId === null ? undefined : findThemeProfile(activeId);
  if (now?.startBoard) applyStartBoard(now.startBoard);
}

/** 디스크에서 다시 읽는다 — `theme-profiles-changed`(Rust 가 쓴 뒤 낸다) */
function reloadFromDisk(): void {
  if (!loaded) return; // 아직 한 번도 안 읽은 창은 처음 읽을 때 최신을 본다
  enqueue(async () => adopt(await invoke<string | null>("load_theme_profiles"), true));
}

void listen("theme-profiles-changed", () => reloadFromDisk()).catch(() => {
  // 이벤트를 못 거는 환경(웹 미리보기 · 시험) — 다른 창의 변경은 다음 부팅에 본다
});

/**
 * 새 프로필 id — 시각(36진)과 짧은 난수를 잇는다 (`layouts.svelte.ts` 의 `nextId` 와 같은
 * 이유: 파일에 남아 다음 실행에서도 같은 프로필을 가리켜야 하므로 창 카운터를 쓸 수 없다).
 */
function nextId(): string {
  return `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// 시작 화면 자동 저장 (머리말 "시작 화면 한 벌")
// ---------------------------------------------------------------------------

/** 그 프로필의 시작 화면 칸에 담는다 — id 는 **바뀐 순간의** 고른 프로필(그사이 다른 창이 고른 것을 바꿔도 제 프로필로 간다) */
function saveBoard({ id, board }: { id: string; board: StartBoardSnapshot }): void {
  if (!findThemeProfile(id)) return;
  profiles = withStartBoard(profiles, id, board);
  edit({ op: "board", id, board: plainStartBoard(board) });
}

const boardSaver = createLatestDebounce<{ id: string; board: StartBoardSnapshot }>(START_BOARD_SAVE_DELAY_MS, saveBoard);

/** 배치가 바뀌었다 — 고른 프로필이 있으면 담을 차례에 올린다(목록을 아직 안 읽었으면 읽은 뒤에 — 고른 프로필은 파일에 산다) */
function boardChanged(board: StartBoardSnapshot): void {
  if (!loaded) {
    void loadThemeProfiles().then(() => boardChanged(board));
    return;
  }
  if (activeId !== null && findThemeProfile(activeId)) boardSaver.push({ id: activeId, board });
}

// 원격 창은 귀를 걸지 않는다(머리말 — 원격의 배치는 프로필에 자동으로 담지 않는다)
if (!isRemote) onStartBoardChange(boardChanged);

// ---------------------------------------------------------------------------
// 조작
// ---------------------------------------------------------------------------

/**
 * 지금 모양을 이름 붙여 저장한다 — **같은 이름이 있으면 한 번 되묻고 덮어쓴다**
 * (id 는 유지된다: 그 프로필을 갱신한 것이지 새로 만든 것이 아니다).
 *
 * 확인 창을 못 띄우면 **저장하지 않는다** — 묻지 못한 채 남의 벌을 지우느니 아무 일도 안
 * 하는 쪽이 낫다 (레이아웃 저장과 같은 판단).
 */
export async function saveCurrentAs(name: string): Promise<ThemeProfile | null> {
  const clean = name.trim().slice(0, MAX_PROFILE_NAME);
  if (clean === "") return null;

  const existing = profileNamed(profiles, clean);
  if (existing) {
    try {
      const go = await askConfirm(t("app.profile.overwrite.confirm", { name: clean }), {
        title: t("app.profile.overwrite.title"),
        kind: "warning",
      });
      if (!go) return null;
    } catch {
      showNotice(t("app.profile.save.noDialog"));
      return null;
    }
  }

  const made: ThemeProfile = {
    id: existing?.id ?? nextId(),
    name: clean,
    savedAt: Date.now(),
    appearance: snapshotAppearance(settings.current),
    startBoard: startBoardSnapshot(),
  };
  boardSaver.flush(); // 기다리던 배치는 앞서 고른 프로필의 것이다 — 그쪽에 먼저 담는다(새 한 벌에는 지금 배치가 이미 들었다)
  profiles = withProfile(profiles, made);
  // 방금 만든 벌이 곧 지금 모양이다 — 고른 것으로 두어야 "(수정됨)" 이 그때부터 뜻을 갖는다.
  activeId = made.id;
  edit({ op: "put", profile: plainProfile(made), max: MAX_PROFILES, activate: true });
  showNotice(t("app.profile.save.done", { name: made.name }));
  return made;
}

/**
 * 고른 프로필이 있고 지금 모양이 그와 다르면(수정됨) 그 프로필 — 아니면 `null`. 설정 저장이 이것으로 프로필에 반영할지 정한다
 * (순서는 `settings/settings-close.ts` 의 `saveAndReflect` — docs/log/2026-10-22-settings-close-asks-save.md).
 * 설정 › 앱 테마를 한 번도 안 열었으면 목록이 아직 없다 — 창당 한 번 읽는다.
 */
export async function modifiedActiveProfile(): Promise<{ id: string; name: string } | null> {
  await loadThemeProfiles();
  const active = activeId === null ? undefined : findThemeProfile(activeId);
  if (!active || !isModified()) return null;
  return { id: active.id, name: active.name };
}

/**
 * 그 프로필을 **지금 모양으로 덮어쓴다** — 설정 저장의 반영(묻지 않음). 이름 · id 는 그대로다(같은 프로필이다 — 이름 충돌 물음 없음).
 * 그사이 다른 창 · 다른 길로 고른 프로필이 바뀌었거나 사라졌으면 손대지 않는다.
 */
export function overwriteProfileWithCurrent(id: string): void {
  const active = findThemeProfile(id);
  if (!active || activeId !== id) return;
  const made: ThemeProfile = {
    ...active,
    savedAt: Date.now(),
    appearance: snapshotAppearance(settings.current),
    startBoard: startBoardSnapshot(),
  };
  profiles = withProfile(profiles, made);
  edit({ op: "put", profile: plainProfile(made), max: MAX_PROFILES, activate: false });
  showNotice(t("app.profile.reflect.done", { name: made.name }));
}

/**
 * 프로필 하나를 **입힌다** — 담긴 모양 전부가 한 번에 바뀐다.
 *
 * 월페이퍼는 **이름**만 담겨 있다 — 앱 폴더의 내용 해시 사본(`wp-<hex>.<확장자>`, `wallpaper.rs`)
 * 이라 프로필마다 제 사진을 가리킨다. 그 사본이 이미 없으면 배경 네 칸은 건드리지 않고 나머지만 입힌 뒤 한 줄 알린다: 없는
 * 이름을 걸면 배경이 통째로 사라지는데, 그건 사용자가 이 프로필에서 기대한 결과가 아니다.
 */
export async function applyProfile(id: string): Promise<void> {
  const profile = findThemeProfile(id);
  if (!profile) {
    showNotice(t("app.profile.missing"));
    return;
  }

  // 아무것도 건드리기 **전**에 본다 — 아래에서 우리가 만든 변경까지 세면 언제나 dirty 다
  // (위 "저장은 언제 하나").
  const wasDirty = settings.dirty;
  // 기다리던 배치 변경은 지금(입히기 전) 프로필의 것이다 — 먼저 담는다
  boardSaver.flush();

  const want = profile.appearance.wallpaper.file;
  const keepWallpaper = !!want && !(await wallpaperCopyExists(want));
  const icon = await iconChoice(profile.appearance.app.app_icon);

  const patched = applyAppearance(settings.current, profile.appearance, { keepWallpaper, icon });
  // 검사는 **우리가 만진 네 테이블에만** 건다(독 배치 — 2026-11-08). 설정 전체를 `normalizeSettings` 에 넣으면
  // 편집 중인 다른 섹션까지 그 그물을 지나는데, 거기에는 "아직 비어 있는 줄을 버린다" 같은
  // 규칙이 있다 (`normalizeTriggers`) — 방금 [트리거 추가] 를 눌러 둔 빈 줄이 프로필을
  // 고르는 순간 사라지면, 사용자에게는 자기가 누른 적 없는 삭제다.
  const checked = normalizeSettings({
    app: patched.app,
    terminal: patched.terminal,
    wallpaper: patched.wallpaper,
    dock: patched.dock,
  });
  upgradeLegacyAppColors(checked); // 2026-10-18 전에 저장한 프로필의 크롬 → 같은 테마의 MD3 크롬
  settings.current = {
    ...patched,
    app: checked.app,
    terminal: checked.terminal,
    wallpaper: checked.wallpaper,
    dock: checked.dock,
  };
  syncStoredMode(); // `<html data-theme>` · 색 선택기의 "(기본값)"
  applySettings(); // 인라인 색 토큰 · 파생 토큰 · `--term-bg`
  // 시작 화면 한 벌 — 담긴 프로필만(옛 프로필은 지금 배치 그대로 · 원격은 거울로 받는다 — 머리말)
  if (profile.startBoard && !isRemote) applyStartBoard(profile.startBoard);
  activeId = id;
  edit({ op: "activate", id });

  if (!wasDirty) {
    try {
      await saveSettings();
    } catch (e) {
      console.warn("[aynx] 테마 프로필을 파일에 남기지 못했습니다 (화면에는 적용됨):", e);
    }
  }
  // 배경 URL 은 **화면의 설정** 이름으로 만든다 — 미저장 편집 중이라 파일에 안 적었어도 사진은
  // 바뀐다. 전체 동적 색은 다시 뽑지 않는다: 프로필이 저장해 둔 팔레트가 곧 그 사진의 색이다
  // (은은하게의 틴트는 URL 을 지켜보는 효과가 알아서 새 사진으로 다시 읽는다).
  await refreshWallpaper();
  // 앞 배경을 아무도 안 가리키게 됐으면 치운다 (편집 중인 이름은 백엔드에 함께 넘겨 지킨다).
  void collectWallpapers();

  showNotice(t("app.profile.apply.done", { name: profile.name }));
  if (keepWallpaper) showNotice(t("app.profile.apply.keptWallpaper"));
  if (icon === "default") showNotice(t("app.profile.apply.missingIcon"));
}

/**
 * 그 프로필이 걸 월페이퍼의 URL(없거나 사본이 없으면 빈 문자열) — 입히는 UI 가 원 퍼짐 전에 그림을 디코딩해 두게
 * (`theme-reveal.ts` 의 `preload`). 상태는 건드리지 않는다.
 */
export function profileWallpaperSrc(id: string): Promise<string> {
  return wallpaperUrl(findThemeProfile(id)?.appearance.wallpaper.file ?? undefined);
}

/**
 * 프로필의 앱 아이콘을 어떻게 입힐까(docs/log/2026-10-22-custom-app-icon.md). 원격 창은 앱 아이콘을 지원하지 않으므로
 * 그대로 둔다(`"keep"`). 사용자 아이콘이 이미 지워졌으면 기본으로 접는다(`"default"`) — 목록을 못 읽으면 적힌 대로 두고
 * Rust 가 없는 파일을 기본 그림으로 접는다(`app_icon::resolve`). 이 모듈은 `app/app-icons` 를 부르지 않는다(그쪽이 이쪽을
 * 불러 지울 아이콘을 담은 프로필 수를 센다 — 순환을 피한다) — 같은 명령을 직접 부른다.
 */
async function iconChoice(want: string | null | undefined): Promise<"use" | "keep" | "default"> {
  if (isRemote) return "keep";
  if (!want || !isUserAppIconId(want)) return "use";
  try {
    const found = (await invoke<{ id: string; src: string }[]>("app_icon_list")).find((i) => i.id === want);
    // 다음 시작의 스플래시도 이 아이콘으로 — 칩 줄에서 고를 때와 같은 사본(`pickUserAppIcon`).
    if (found) rememberSplashUserIcon(found.id, found.src);
    return found ? "use" : "default";
  } catch {
    return "use";
  }
}

/** 이 사용자 아이콘을 담은 프로필 수 — 아이콘을 지우기 전 확인 상자가 알린다(지우기를 막지는 않는다) */
export async function profilesUsingIcon(id: string): Promise<number> {
  await loadThemeProfiles();
  return profiles.filter((p) => p.appearance.app.app_icon === id).length;
}

/**
 * 그 이름의 사본이 앱 폴더에 있는가. **실패하면 "없다"** 로 본다 — 그 결과는 배경을 그대로
 * 두는 것이라, 명령이 없는 옛 백엔드에서도 잃는 것이 없다.
 */
async function wallpaperCopyExists(file: string): Promise<boolean> {
  return (await wallpaperUrl(file)) !== "";
}

/**
 * 프로필 하나를 지운다 — 되돌릴 수 없으므로 먼저 묻는다 (레이아웃 삭제와 같은 `ask`).
 * 지운 것이 고른 프로필이었으면 선택도 함께 비운다.
 */
export async function removeProfile(id: string): Promise<void> {
  const profile = findThemeProfile(id);
  if (!profile) return;
  let go = false;
  try {
    go = await askConfirm(t("app.profile.remove.confirm", { name: profile.name }), {
      title: t("app.profile.remove.title"),
      kind: "warning",
      danger: true,
    });
  } catch {
    return; // 확인 창을 못 열면 아무것도 지우지 않는다
  }
  if (!go) return;
  profiles = withoutProfile(profiles, id);
  if (activeId === id) activeId = null;
  edit({ op: "remove", id });
}

/**
 * 이름만 바꾼다. 빈 이름이나 **다른 프로필이 이미 쓰는 이름**이면 아무 일도 없다(`false`) —
 * 이름은 목록에서 유일해야 하고, 겹치면 덮어쓰기 판정이 흔들린다.
 */
export function renameThemeProfile(id: string, name: string): boolean {
  const next = renameInList(profiles, id, name);
  if (!next) return false;
  profiles = next;
  edit({ op: "rename", id, name: findThemeProfile(id)?.name ?? name });
  return true;
}
