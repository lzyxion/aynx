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
 * 모양 프로필의 상태와 적용. 입힌 뒤의 뒤처리는 설정 화면이 쓰는 함수 그대로다(`normalizeSettings` · `syncStoredMode` · `applySettings` ·
 * `saveSettings` · `refreshWallpaper`).
 * 모드는 `setAppMode` 를 부르지 않는다 — 그 함수가 터미널 프리셋을 짝으로 갈아 끼워 방금 입힌 값을 덮는다.
 * 곧바로 저장하되, 설정 화면에 **다른** 미저장 변경이 있으면 앞지르지 않는다 — 확정해 버리면 [취소] 가 되돌릴 자리를 잃는다.
 * 시작 화면 배치(`startBoard`)는 고른 프로필에 자동 저장한다(목록 순서 · 저장 시각 · "(수정됨)" 은 건드리지 않는다).
 * 원격 웹 창은 프로필의 배치를 스스로 입히지도 담지도 않는다 — 메인 PC 주 창이 입힌 결과를 거울로 받는다.
 */

let profiles = $state<ThemeProfile[]>([]);
let activeId = $state<string | null>(null);
/** 창당 한 번만 실제로 읽는다 */
let loaded = false;

export function themeProfiles(): readonly ThemeProfile[] {
  return profiles;
}

export function activeProfileId(): string | null {
  return activeId;
}

export function findThemeProfile(id: string): ThemeProfile | undefined {
  return profiles.find((p) => p.id === id);
}

/** 목록의 "(수정됨)" */
export function isModified(): boolean {
  const active = activeId === null ? undefined : findThemeProfile(activeId);
  if (!active) return false;
  return !sameAppearance(snapshotAppearance(settings.current), active.appearance);
}

// ── 파일 ──

/** 실패하면 빈 목록으로 시작한다 — 프로필 파일 하나 때문에 앱이 못 뜨면 안 된다 */
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

// ── 쓰기 — 조작 단위 ──
// 목록 전체를 쓰지 않는다 — 창 B 의 옛 사본이 창 A 의 변경을 덮는다. 조작 하나를 Rust `theme_profiles_edit` 에 보내 잠금 아래 디스크의 최신 위에 얹는다.
// 이 창의 조작은 줄 하나로 차례를 지킨다(늦게 온 응답이 앞선 응답을 덮지 않게).

/** Rust `app_state.rs` 의 조작과 같은 모양 */
type ProfileOp =
  | { op: "put"; profile: unknown; max: number; activate: boolean }
  | { op: "board"; id: string; board: StartBoardSnapshot }
  | { op: "remove"; id: string }
  | { op: "rename"; id: string; name: string }
  | { op: "activate"; id: string | null };

let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch(() => {
    // 실패는 조용히 넘긴다 — 다음 다시 읽기(이벤트 · 다음 조작)가 파일과 맞춘다.
  });
}

function edit(op: ProfileOp): void {
  enqueue(async () => {
    const json = await invoke<string>("theme_profiles_edit", { op });
    adopt(json, false);
    // 파일에 **쓴 뒤**라야 백엔드가 새 목록을 읽는다 (docs/log/2026-09-28-profile-cards-wallpapers.md).
    if (op.op === "put" || op.op === "remove") void collectWallpapers();
  });
}

const plainProfile = (p: ThemeProfile): unknown => serializeProfiles([p], null).profiles[0];

/** `fromOther` — 다른 창(또는 이 창이 모르는 길)의 변경 */
function adopt(json: string | null, fromOther: boolean): void {
  const file = parseProfiles(json);
  if (!file) return;
  const prev = activeId;
  profiles = file.profiles;
  activeId = file.active;
  if (fromOther && prev !== activeId) followActive();
}

/**
 * 다른 창이 고른 프로필을 바꿨다 — 이 창의 배치도 그것으로 맞춘다. 안 맞추면 이 창이 다음에 배치를 옮길 때 새 프로필 칸을 앞 프로필의
 * 배치로 덮는다. 기다리던 배치 변경은 앞 프로필 id 로 붙어 있어 그쪽으로 먼저 담긴다.
 */
function followActive(): void {
  boardSaver.flush();
  if (isRemote) return;
  const now = activeId === null ? undefined : findThemeProfile(activeId);
  if (now?.startBoard) applyStartBoard(now.startBoard);
}

function reloadFromDisk(): void {
  if (!loaded) return; // 아직 한 번도 안 읽은 창은 처음 읽을 때 최신을 본다
  enqueue(async () => adopt(await invoke<string | null>("load_theme_profiles"), true));
}

void listen("theme-profiles-changed", () => reloadFromDisk()).catch(() => {
  // 이벤트를 못 거는 환경(웹 미리보기 · 시험)
});

/** 파일에 남아 다음 실행에서도 같은 프로필을 가리켜야 하므로 창 카운터를 쓸 수 없다 */
function nextId(): string {
  return `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── 시작 화면 자동 저장 ──

/** id 는 바뀐 순간의 고른 프로필이다 — 그사이 고른 것이 바뀌어도 제 프로필로 간다 */
function saveBoard({ id, board }: { id: string; board: StartBoardSnapshot }): void {
  if (!findThemeProfile(id)) return;
  profiles = withStartBoard(profiles, id, board);
  edit({ op: "board", id, board: plainStartBoard(board) });
}

const boardSaver = createLatestDebounce<{ id: string; board: StartBoardSnapshot }>(START_BOARD_SAVE_DELAY_MS, saveBoard);

/** 목록을 아직 안 읽었으면 읽은 뒤에 — 고른 프로필은 파일에 산다 */
function boardChanged(board: StartBoardSnapshot): void {
  if (!loaded) {
    void loadThemeProfiles().then(() => boardChanged(board));
    return;
  }
  if (activeId !== null && findThemeProfile(activeId)) boardSaver.push({ id: activeId, board });
}

if (!isRemote) onStartBoardChange(boardChanged);

// ── 조작 ──

/** 같은 이름이면 되묻고 덮어쓴다(id 유지). 확인 창을 못 띄우면 저장하지 않는다 — 묻지 못한 채 남의 벌을 지우지 않는다. */
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
  boardSaver.flush(); // 기다리던 배치는 앞서 고른 프로필의 것이다 — 그쪽에 먼저 담는다
  profiles = withProfile(profiles, made);
  activeId = made.id;
  edit({ op: "put", profile: plainProfile(made), max: MAX_PROFILES, activate: true });
  showNotice(t("app.profile.save.done", { name: made.name }));
  return made;
}

/** 설정 저장이 프로필에 반영할지 정한다(`settings/settings-close.ts`). 목록을 아직 안 읽었을 수 있어 한 번 읽는다. */
export async function modifiedActiveProfile(): Promise<{ id: string; name: string } | null> {
  await loadThemeProfiles();
  const active = activeId === null ? undefined : findThemeProfile(activeId);
  if (!active || !isModified()) return null;
  return { id: active.id, name: active.name };
}

/** 설정 저장의 반영(묻지 않음). 그사이 고른 프로필이 바뀌었거나 사라졌으면 손대지 않는다. */
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

/** 월페이퍼는 이름(앱 폴더의 사본)만 담긴다 — 사본이 없으면 배경은 건드리지 않고 나머지만 입힌다(없는 이름을 걸면 배경이 사라진다). */
export async function applyProfile(id: string): Promise<void> {
  const profile = findThemeProfile(id);
  if (!profile) {
    showNotice(t("app.profile.missing"));
    return;
  }

  // 아무것도 건드리기 **전**에 본다 — 아래 변경까지 세면 언제나 dirty 다.
  const wasDirty = settings.dirty;
  boardSaver.flush();

  const want = profile.appearance.wallpaper.file;
  const keepWallpaper = !!want && !(await wallpaperCopyExists(want));
  const icon = await iconChoice(profile.appearance.app.app_icon);

  const patched = applyAppearance(settings.current, profile.appearance, { keepWallpaper, icon });
  // 검사는 만진 네 테이블에만 — 전체를 넣으면 편집 중인 다른 섹션의 빈 줄(`normalizeTriggers`)이 사람이 누른 적 없이 사라진다.
  const checked = normalizeSettings({
    app: patched.app,
    terminal: patched.terminal,
    wallpaper: patched.wallpaper,
    dock: patched.dock,
  });
  upgradeLegacyAppColors(checked); // 옛 프로필의 크롬 → 같은 테마의 MD3 크롬
  settings.current = {
    ...patched,
    app: checked.app,
    terminal: checked.terminal,
    wallpaper: checked.wallpaper,
    dock: checked.dock,
  };
  syncStoredMode();
  applySettings();
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
  // 화면의 설정 이름으로 만든다(미저장이어도 사진은 바뀐다). 동적 색은 다시 뽑지 않는다 — 저장해 둔 팔레트가 곧 그 사진의 색이다.
  await refreshWallpaper();
  void collectWallpapers();

  showNotice(t("app.profile.apply.done", { name: profile.name }));
  if (keepWallpaper) showNotice(t("app.profile.apply.keptWallpaper"));
  if (icon === "default") showNotice(t("app.profile.apply.missingIcon"));
}

/** 입히는 UI 가 원 퍼짐 전에 그림을 디코딩해 두게(`theme-reveal.ts` 의 `preload`) */
export function profileWallpaperSrc(id: string): Promise<string> {
  return wallpaperUrl(findThemeProfile(id)?.appearance.wallpaper.file ?? undefined);
}

/**
 * 원격 창은 앱 아이콘을 지원하지 않아 `"keep"`. 사용자 아이콘이 지워졌으면 `"default"` — 목록을 못 읽으면 적힌 대로 두고 Rust 가 접는다.
 * `app/app-icons` 를 부르지 않는다 — 그쪽이 이쪽을 불러 순환이 된다.
 */
async function iconChoice(want: string | null | undefined): Promise<"use" | "keep" | "default"> {
  if (isRemote) return "keep";
  if (!want || !isUserAppIconId(want)) return "use";
  try {
    const found = (await invoke<{ id: string; src: string }[]>("app_icon_list")).find((i) => i.id === want);
    // 다음 시작의 스플래시도 이 아이콘으로
    if (found) rememberSplashUserIcon(found.id, found.src);
    return found ? "use" : "default";
  } catch {
    return "use";
  }
}

/** 아이콘을 지우기 전 확인 상자가 알린다(지우기를 막지는 않는다) */
export async function profilesUsingIcon(id: string): Promise<number> {
  await loadThemeProfiles();
  return profiles.filter((p) => p.appearance.app.app_icon === id).length;
}

/** 실패하면 "없다" 로 본다 — 결과가 배경을 그대로 두는 것이라 잃는 것이 없다 */
async function wallpaperCopyExists(file: string): Promise<boolean> {
  return (await wallpaperUrl(file)) !== "";
}

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

export function renameThemeProfile(id: string, name: string): boolean {
  const next = renameInList(profiles, id, name);
  if (!next) return false;
  profiles = next;
  edit({ op: "rename", id, name: findThemeProfile(id)?.name ?? name });
  return true;
}
