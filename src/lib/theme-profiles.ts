import { normalizeDynamicMode } from "$lib/dynamic-color";
import { bareName, normalizeStringMap, sameStringMap, text } from "$lib/settings-codec";
import type { AppSettings, AppTheme, DockPrefs, TermPrefs, WallpaperPrefs } from "$lib/settings.svelte.js";
import { DEFAULT_APP_ICON, isAppIconId } from "$lib/settings/model/options";
import { parseStartBoard, plainStartBoard, type StartBoardSnapshot } from "$lib/start-widgets";

/**
 * 모양 프로필 — 이름 붙여 아껴 두는 겉모습 한 벌(앱 테마 섹션 전부 + 터미널 팔레트). 순수 모듈이다(`settings.svelte.ts` 는 타입만).
 * 무엇이 모양인지는 아래 `APPEARANCE_*_KEYS` 배열이 유일한 진실이다 — 담기 · 비교 · 되읽기가 전부 이 배열을 돈다.
 * 동작(`auto_reconnect` · `tiling` · `idle_lock_min` · 단축키 …)과 글자 · UI 크기는 일부러 담지 않는다 — 모양만 바꿨는데 동작이 변하면 안 된다.
 * 앱 아이콘(`app_icon`)은 배열 밖이다 — 없음(옛 프로필) = 기본(GPT)으로 읽고 · 담고 · 견준다(적용의 `icon` 옵션 때문).
 * 값의 유효성은 여기서 보지 않는다 — 적용 쪽이 `normalizeSettings` 를 한 번 더 지난다(후보 표를 여기 복사하면 둘이 갈린다).
 */

/** 모르는 버전은 통째로 무시한다 */
export const THEME_PROFILE_FILE_VERSION = 1;

export const MAX_PROFILE_NAME = 60;

/** 넘치면 가장 오래된 것부터 밀려난다 — 방금 저장한 것을 거절하지 않는다 */
export const MAX_PROFILES = 40;

/**
 * `[app]` 에서 담는 칸. `dynamic` 은 색이 아니라 표시지만 함께 담아야 "월페이퍼에서 뽑은 벌" 이 살아남는다.
 * 이 칸들 전에 저장한 옛 프로필을 적용하면 늦게 더한 칸은 기본값이 된다.
 */
export const APPEARANCE_APP_KEYS = [
  "accent",
  "bg",
  "bg_panel",
  "fg",
  "border",
  "err",
  "ok",
  "warn",
  "dynamic",
  "opacity",
  "mode",
  "tile_header",
  "status_bar",
  "status_bar_style",
  "material",
  "resource_rings",
  "usage_rings",
  "ui_font_family",
  "window_controls",
] as const satisfies readonly (keyof AppTheme)[];

/**
 * `[terminal]` 에서 담는 칸. 팔레트 테이블(`dynamic`)은 맵이라 따로 잇는다. `opacity` 는 터미널 칸의 투명도(`app.opacity` 와 다른 값),
 * `tab_style` 은 저장 위치가 `[terminal]` 이라 여기 있다. `font_size` 는 담지 않는다.
 */
export const APPEARANCE_TERM_KEYS = [
  "theme",
  "opacity",
  "tab_style",
  "font_family",
  "cursor_style",
  "ligatures",
] as const satisfies readonly (keyof TermPrefs)[];

/** 옛 프로필에는 `dock` 이 없다(적용하면 기본 배치) */
export const APPEARANCE_DOCK_KEYS = ["layout"] as const satisfies readonly (keyof DockPrefs)[];

export const APPEARANCE_WALLPAPER_KEYS = [
  "file",
  "dim",
  "blur",
  "fit",
] as const satisfies readonly (keyof WallpaperPrefs)[];

const APP_NUMBER_KEYS = ["opacity"] as const;
const APP_BOOL_KEYS = ["resource_rings", "usage_rings", "window_controls"] as const;
const TERM_BOOL_KEYS = ["ligatures"] as const;
const TERM_NUMBER_KEYS = ["opacity"] as const;
const WALLPAPER_NUMBER_KEYS = ["dim", "blur"] as const;

export type AppearanceAppKey = (typeof APPEARANCE_APP_KEYS)[number];
export type AppearanceTermKey = (typeof APPEARANCE_TERM_KEYS)[number];
export type AppearanceWallpaperKey = (typeof APPEARANCE_WALLPAPER_KEYS)[number];

export type AppearanceApp = Pick<AppTheme, AppearanceAppKey | "app_icon">;
export type AppearanceTerm = Pick<TermPrefs, AppearanceTermKey | "dynamic">;
export type AppearanceWallpaper = Pick<WallpaperPrefs, AppearanceWallpaperKey>;
export type AppearanceDock = Pick<DockPrefs, (typeof APPEARANCE_DOCK_KEYS)[number]>;

export interface AppearanceSnapshot {
  app: AppearanceApp;
  terminal: AppearanceTerm;
  wallpaper: AppearanceWallpaper;
  dock?: AppearanceDock;
}

export interface ThemeProfile {
  /** 이름을 바꿔도 그대로다 */
  id: string;
  /** 목록에서 유일하다(같은 이름으로 저장하면 덮어쓴다) */
  name: string;
  savedAt: number;
  appearance: AppearanceSnapshot;
  /**
   * 선택 칸 — 없으면(옛 프로필) 적용해도 지금 배치를 건드리지 않는다. `appearance` 밖에 두어 "(수정됨)" 판정에 들지 않는다
   * (배치를 옮기면 곧바로 자동 저장된다).
   */
  startBoard?: StartBoardSnapshot;
}

/** 목록과 지금 고른 프로필이 같은 파일에 산다 — 한 번의 쓰기로 함께 움직여야 없는 id 를 가리키지 않는다 */
export interface ThemeProfileFile {
  version: number;
  active: string | null;
  profiles: ThemeProfile[];
}

// ── 스냅숏 ──

/** `undefined`/`null` 칸은 키 자체를 안 만든다 */
function put<T extends object, K extends keyof T>(into: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined && value !== null) into[key] = value;
}

/** 없는 칸은 `undefined` 로 **지운다** — 프로필이 안 정한 칸에 지난 벌의 값이 남으면 안 된다 */
function overwrite<T, K extends keyof T>(into: T, from: Pick<T, K>, keys: readonly K[]): void {
  for (const key of keys) into[key] = from[key];
}

/** 맵은 복사한다 — 안 하면 나중에 설정을 고칠 때 저장해 둔 팔레트가 함께 바뀐다 */
export function snapshotAppearance(s: AppSettings): AppearanceSnapshot {
  const app = {} as AppearanceApp;
  for (const key of APPEARANCE_APP_KEYS) put(app, key, s.app[key]);
  // 기본(설정에서는 빈 칸)도 글자로 적는다 — 파일을 손으로 읽어도 무엇을 담았는지 보이게.
  app.app_icon = s.app.app_icon ?? DEFAULT_APP_ICON;

  const terminal = {} as AppearanceTerm;
  for (const key of APPEARANCE_TERM_KEYS) put(terminal, key, s.terminal[key]);
  if (s.terminal.dynamic && Object.keys(s.terminal.dynamic).length > 0) {
    terminal.dynamic = { ...s.terminal.dynamic };
  }

  const wallpaper = {} as AppearanceWallpaper;
  for (const key of APPEARANCE_WALLPAPER_KEYS) put(wallpaper, key, s.wallpaper[key]);

  const dock = {} as AppearanceDock;
  for (const key of APPEARANCE_DOCK_KEYS) put(dock, key, s.dock?.[key]);

  return { app, terminal, wallpaper, dock };
}

/**
 * 새 설정 객체를 만든다 — 값만. setter(`setAppColorTheme` 등)를 부르지 않는다 — 그쪽은 동적 표시를 꺼서 월페이퍼에서 뽑은 벌이 표시를 잃는다.
 * `keepWallpaper` — 프로필이 가리키는 이미지 사본이 없을 때(없는 이름을 걸면 배경이 사라진다).
 * `icon`: `"keep"` = 그대로(원격 창), `"default"` = 기본으로(사용자 아이콘 파일이 지워졌을 때). 기본(GPT)은 빈 칸으로 적는다(`setAppIcon` 과 같다).
 */
export function applyAppearance(
  current: AppSettings,
  snapshot: AppearanceSnapshot,
  options: { keepWallpaper?: boolean; icon?: "use" | "keep" | "default" } = {},
): AppSettings {
  const app: AppTheme = { ...current.app };
  overwrite(app, snapshot.app, APPEARANCE_APP_KEYS);
  if (options.icon !== "keep") {
    const next = options.icon === "default" ? DEFAULT_APP_ICON : (snapshot.app.app_icon ?? DEFAULT_APP_ICON);
    app.app_icon = next === DEFAULT_APP_ICON ? undefined : next;
  }

  const terminal: TermPrefs = { ...current.terminal };
  overwrite(terminal, snapshot.terminal, APPEARANCE_TERM_KEYS);
  terminal.dynamic = snapshot.terminal.dynamic ? { ...snapshot.terminal.dynamic } : undefined;

  const wallpaper: WallpaperPrefs = { ...current.wallpaper };
  if (!options.keepWallpaper) {
    overwrite(wallpaper, snapshot.wallpaper, APPEARANCE_WALLPAPER_KEYS);
  }

  const dock: DockPrefs = { ...current.dock };
  overwrite(dock, snapshot.dock ?? {}, APPEARANCE_DOCK_KEYS);

  return { ...current, app, terminal, wallpaper, dock };
}

/** "(수정됨)" 판정. 칸을 직접 비교한다(JSON 비교는 키 순서에 흔들린다) */
export function sameAppearance(a: AppearanceSnapshot, b: AppearanceSnapshot): boolean {
  return (
    APPEARANCE_APP_KEYS.every((k) => a.app[k] === b.app[k]) &&
    (a.app.app_icon ?? DEFAULT_APP_ICON) === (b.app.app_icon ?? DEFAULT_APP_ICON) &&
    APPEARANCE_TERM_KEYS.every((k) => a.terminal[k] === b.terminal[k]) &&
    sameStringMap(a.terminal.dynamic, b.terminal.dynamic) &&
    APPEARANCE_WALLPAPER_KEYS.every((k) => a.wallpaper[k] === b.wallpaper[k]) &&
    APPEARANCE_DOCK_KEYS.every((k) => a.dock?.[k] === b.dock?.[k])
  );
}

// ── 검증 — 절대 throw 하지 않는다 ──

/** 범위는 `normalizeSettings` 가 자른다 */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

/** 모양 검사만 — 모르는 키는 버린다 */
export function parseAppearance(raw: unknown): AppearanceSnapshot {
  const src = (raw ?? {}) as Record<string, unknown>;
  const rawApp = (src.app ?? {}) as Record<string, unknown>;
  const rawTerm = (src.terminal ?? {}) as Record<string, unknown>;
  const rawWp = (src.wallpaper ?? {}) as Record<string, unknown>;

  const app = {} as AppearanceApp;
  for (const key of APPEARANCE_APP_KEYS) {
    // `dynamic` 은 세 단계 문자열이지만 옛 프로필에는 불리언으로 적혀 있다 — 둘 다 받는다.
    const v = key === "dynamic"
      ? normalizeDynamicMode(rawApp[key])
      : (APP_BOOL_KEYS as readonly string[]).includes(key)
        ? (typeof rawApp[key] === "boolean" ? rawApp[key] : undefined)
        : (APP_NUMBER_KEYS as readonly string[]).includes(key)
          ? num(rawApp[key])
          : text(rawApp[key]);
    put(app, key, v);
  }
  const icon = text(rawApp.app_icon);
  app.app_icon = isAppIconId(icon) ? icon : DEFAULT_APP_ICON;

  const terminal = {} as AppearanceTerm;
  for (const key of APPEARANCE_TERM_KEYS) {
    const v = (TERM_BOOL_KEYS as readonly string[]).includes(key)
      ? (typeof rawTerm[key] === "boolean" ? rawTerm[key] : undefined)
      : (TERM_NUMBER_KEYS as readonly string[]).includes(key)
        ? num(rawTerm[key])
        : text(rawTerm[key]);
    put(terminal, key, v);
  }
  // 팔레트는 키 · 값을 검사하지 않는다(보관만) — 아는 칸을 고르는 것은 화면에 걸리기 직전이다.
  terminal.dynamic = normalizeStringMap(rawTerm.dynamic);

  const wallpaper = {} as AppearanceWallpaper;
  for (const key of APPEARANCE_WALLPAPER_KEYS) {
    const v = (WALLPAPER_NUMBER_KEYS as readonly string[]).includes(key)
      ? num(rawWp[key])
      : // 이미지는 이름 한 조각만 — 손으로 고친 파일이 앱 폴더 밖을 가리키지 못하게.
        key === "file"
        ? bareName(rawWp[key])
        : text(rawWp[key]);
    put(wallpaper, key, v);
  }

  const rawDock = (src.dock ?? {}) as Record<string, unknown>;
  const dock = {} as AppearanceDock;
  for (const key of APPEARANCE_DOCK_KEYS) put(dock, key, text(rawDock[key]));

  return { app, terminal, wallpaper, dock };
}

/**
 * 파싱 실패 · 모르는 버전이면 `null`. 깨진 줄만 버린다(프로필은 서로 독립이다).
 * `active` 는 목록에 실제로 있는 id 일 때만 살아남는다.
 */
export function parseProfiles(json: string | null | undefined): ThemeProfileFile | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== THEME_PROFILE_FILE_VERSION) return null;
  if (!Array.isArray(o.profiles)) return null;

  const profiles: ThemeProfile[] = [];
  const seen = new Set<string>();
  for (const item of o.profiles) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const name = typeof p.name === "string" ? p.name.trim().slice(0, MAX_PROFILE_NAME) : "";
    if (id === "" || name === "" || seen.has(id)) continue;
    if (!p.appearance || typeof p.appearance !== "object") continue;
    const savedAt = typeof p.savedAt === "number" && Number.isFinite(p.savedAt) ? p.savedAt : 0;
    seen.add(id);
    const startBoard = parseStartBoard(p.startBoard);
    profiles.push({ id, name, savedAt, appearance: parseAppearance(p.appearance), ...(startBoard ? { startBoard } : {}) });
    if (profiles.length >= MAX_PROFILES) break;
  }

  const active = typeof o.active === "string" && seen.has(o.active.trim()) ? o.active.trim() : null;
  return { version: THEME_PROFILE_FILE_VERSION, active, profiles };
}

/** 같은 목록이면 같은 문자열이 나와야 한다 — 키 순서를 고정한다 */
export function serializeProfiles(
  list: readonly ThemeProfile[],
  active: string | null,
): ThemeProfileFile {
  const activeId = list.some((p) => p.id === active) ? active : null;
  return {
    version: THEME_PROFILE_FILE_VERSION,
    active: activeId,
    profiles: list.map((p) => ({
      id: p.id,
      name: p.name,
      savedAt: p.savedAt,
      appearance: p.appearance,
      ...(p.startBoard ? { startBoard: plainStartBoard(p.startBoard) } : {}),
    })),
  };
}

// ── 목록 조작 — 전부 새 배열을 돌려준다 ──

/** 대소문자 · 앞뒤 공백을 무시한다 — 덮어쓸지 묻는 판정이 이 함수 하나다 */
export function profileNamed(
  list: readonly ThemeProfile[],
  name: string,
): ThemeProfile | undefined {
  const key = name.trim().toLowerCase();
  if (key === "") return undefined;
  return list.find((p) => p.name.trim().toLowerCase() === key);
}

/** 같은 id 면 갈아 끼우고 맨 앞으로 올린다 */
export function withProfile(
  list: readonly ThemeProfile[],
  profile: ThemeProfile,
): ThemeProfile[] {
  return [profile, ...list.filter((p) => p.id !== profile.id)].slice(0, MAX_PROFILES);
}

/** 자리 · 저장 시각은 그대로다 — 배치를 옮길 때마다 목록 순서가 흔들리면 안 된다 */
export function withStartBoard(
  list: readonly ThemeProfile[],
  id: string,
  board: StartBoardSnapshot,
): ThemeProfile[] {
  return list.map((p) => (p.id === id ? { ...p, startBoard: plainStartBoard(board) } : p));
}

export function withoutProfile(list: readonly ThemeProfile[], id: string): ThemeProfile[] {
  return list.filter((p) => p.id !== id);
}

/** 빈 이름 · 없는 id · 다른 프로필이 쓰는 이름이면 `null`(이름이 겹치면 덮어쓰기 판정이 흔들린다) */
export function renameProfile(
  list: readonly ThemeProfile[],
  id: string,
  name: string,
): ThemeProfile[] | null {
  const clean = name.trim().slice(0, MAX_PROFILE_NAME);
  if (clean === "") return null;
  const target = list.find((p) => p.id === id);
  if (!target) return null;
  const clash = profileNamed(list, clean);
  if (clash && clash.id !== id) return null;
  if (target.name === clean) return null; // 할 일 없음 — 저장도 건너뛴다
  return list.map((p) => (p.id === id ? { ...p, name: clean } : p));
}
