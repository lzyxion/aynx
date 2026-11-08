import { normalizeDynamicMode } from "$lib/dynamic-color";
import { bareName, normalizeStringMap, sameStringMap, text } from "$lib/settings-codec";
import type { AppSettings, AppTheme, DockPrefs, TermPrefs, WallpaperPrefs } from "$lib/settings.svelte.js";
import { DEFAULT_APP_ICON, isAppIconId } from "$lib/settings/model/options";
import { parseStartBoard, plainStartBoard, type StartBoardSnapshot } from "$lib/start-widgets";

/**
 * **모양 프로필** — 이름 붙여 아껴 두는 겉모습 한 벌 (docs/log/2026-09-15-theme-profiles.md).
 *
 * 설정의 **앱 테마 섹션이 정하는 것 전부**(월페이퍼·모드·색과 투명도·탭/상태바/타일 헤더
 * 모양)에 **터미널 팔레트**(`[terminal] theme` 과 동적 팔레트 테이블)를 더한 스냅숏이다.
 * 하나를 고르면 그 전부가 한 번에 바뀐다 — "밤에 쓰는 벌 / 발표용 밝은 벌" 을 손잡이
 * 열 개를 다시 만지지 않고 오가는 것이 이 기능의 전부다.
 *
 * ## 이 파일이 **필드 목록의 유일한 진실**이다
 *
 * 무엇이 모양이고 무엇이 아닌지를 정하는 표는 아래 세 배열([`APPEARANCE_APP_KEYS`] ·
 * [`APPEARANCE_TERM_KEYS`] · [`APPEARANCE_WALLPAPER_KEYS`])뿐이다. 담기는 값·비교하는 값·
 * 파일에서 되읽는 값이 전부 이 배열을 돌기 때문에, 설정에 모양 칸이 하나 늘면 **여기 한 줄**만
 * 고치면 세 곳이 함께 따라온다. `satisfies` 로 `AppTheme`/`TermPrefs`/`WallpaperPrefs` 의
 * 키인지 타입 검사를 받으므로, 저쪽에서 칸 이름이 바뀌면 여기서 컴파일이 깨진다.
 *
 * ## 앱 아이콘(`app.app_icon`)은 따로 다룬다 (2026-10-22 — docs/log/2026-10-22-custom-app-icon.md)
 *
 * 아이콘 칸은 **늘 있는 것처럼** 다룬다 — 없음(아이콘을 담기 전에 저장한 옛 프로필 · 모르는 값) = **기본(GPT)**. 읽을 때
 * [`parseAppearance`] 가 `"gpt"` 로 채우고, 담을 때도 기본을 글자로 적으며([`snapshotAppearance`]), 비교는 없음을 기본(GPT)으로
 * 보고 견준다([`sameAppearance`] — 그래서 옛 프로필도 지금 아이콘이 기본이 아니면 "(수정됨)"). 위 배열에 넣지 않은 것은 적용의
 * [`applyAppearance`] `icon` 옵션(원격은 그대로 · 사라진 사용자 아이콘은 기본) 때문이다.
 *
 * ## 무엇이 **빠졌나** (일부러)
 *
 * 모양이 아닌 것은 안 담는다 — `auto_reconnect`(시작 시 재접속) · `tiling`(새 타일이 놓이는
 * 규칙) · `idle_lock_min`(자동 잠금) · 단축키 · 셸 · AI · 자동 승인 · 트리거. 앞의 셋은
 * `[app]` 테이블에 같이 살지만 **동작**이라, 프로필을 바꿨을 때 접속·잠금 같은 것이 함께
 * 변하면 사용자가 "모양만 바꿨는데" 라고 느낀다. 터미널 쪽에서도 글꼴·커서·WebGL·합자·
 * 우클릭처럼 **취향이되 모양 한 벌에 묶이지 않는 것**은 빠진다 (글꼴은 프로필마다 다를
 * 이유가 거의 없고, 바뀌면 모든 터미널이 리플로한다).
 *
 * ## 순수 모듈이다
 *
 * 룬도 DOM 도 Tauri 도 없다 — `settings.svelte.ts` 에서 가져오는 것은 **타입뿐**이다
 * (`import type` 이라 런타임에 지워진다). 그래서 vitest 로 그대로 돌릴 수 있다
 * (`vitest.config.ts` 의 "`.svelte.ts` 는 대상이 아니다").
 *
 * 값의 **유효성**(모르는 모드·범위 밖 투명도)은 여기서 보지 않는다. 적용하는 쪽이
 * [`applyAppearance`] 의 결과를 `normalizeSettings` 에 한 번 더 통과시키기 때문이다 —
 * 후보 목록(`APP_MODES`·`TAB_STYLES`…)을 아는 쪽은 설정 모듈 하나여야 하고, 그 표를 여기에
 * 복사해 두면 둘이 조용히 갈린다. 여기서 하는 것은 **모양 검사**(문자열인가·숫자인가)뿐이다.
 */

/** 파일 형식 버전. 모르는 버전은 **통째로 무시**한다 ([`parseProfiles`]) */
export const THEME_PROFILE_FILE_VERSION = 1;

/** 이름 길이 상한 — `MAX_LAYOUT_NAME` 과 같은 이유·같은 값 (목록 한 줄에 들어가야 한다) */
export const MAX_PROFILE_NAME = 60;

/**
 * 보관하는 최대 개수. 넘치면 **가장 오래된 것**부터 밀려난다 (레이아웃 프리셋과 같은 규칙 —
 * 방금 저장한 것을 거절하면 무엇을 지워야 하는지 모른 채 저장에 실패한다).
 */
export const MAX_PROFILES = 40;

// ---------------------------------------------------------------------------
// 무엇이 "모양" 인가 — 이 세 배열이 유일한 진실 (파일 머리말 참고)
// ---------------------------------------------------------------------------

/**
 * `[app]` 에서 담는 칸.
 *
 * 색 토큰 여덟 칸(`accent`…`warn`)은 테마 버튼과 월페이퍼 추출이 채우므로 전부 담는다.
 * `dynamic` 은 색이 아니라 **표시**인데 함께 담아야 "이 벌은
 * 월페이퍼에서 뽑은 것" 이라는 사실이 살아남는다 (그 표시가 꺼져 있으면 월페이퍼를 바꿔도
 * 색이 다시 뽑히지 않는다). 2026-09-25 부터 이 칸은 세 단계(`off`·`subtle`·`full`)다 — 은은하게도
 * 같은 자리로 담기고, 옛 프로필의 `true` 는 읽을 때 `full` 로 옮겨진다 (`parseAppearance`).
 *
 * 상태바의 자원 고리 · 사용량 고리(`resource_rings` · `usage_rings` — 2026-11-08)도 상태바 모양이라 담는다. 설정과 같이
 * 끈 때만 `false` 가 담기고, 이 칸 전에 저장한 옛 프로필을 적용하면 둘 다 켬(기본)이 된다.
 * 같은 날 UI 글꼴(`ui_font_family`) · 창 단추(`window_controls`)도 더했다 — 옛 프로필이면 기본(시스템 글꼴 · 끔).
 * 글자 · UI **크기**는 담지 않는다 — 모양보다 모니터 · 시력의 값이라 프로필을 바꿀 때 따라 바뀌면 불편하다.
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
 * `[terminal]` 에서 담는 칸 — 팔레트 키·터미널 투명도·탭 모양.
 *
 * 팔레트 **테이블**(`dynamic`)은 아래 [`AppearanceTerm`] 에서 따로 잇는다: 값이 문자열이
 * 아니라 맵이라 복사·비교 규칙이 다르다.
 *
 * `tab_style` 이 `[app]` 이 아니라 여기 있는 것은 저장 위치가 그렇기 때문이다(설정 화면에서는
 * "앱 테마 > 탭 모양" 이다). `opacity` 는 **터미널 칸**의 투명도이고 `app.opacity`(크롬)와
 * 다른 값이다 — 설정 화면에서 두 슬라이더가 나란히 서 있으므로 둘 다 담는다.
 * 글꼴 · 커서 모양 · 합자(2026-11-08)도 담는다(크기 `font_size` 는 담지 않는다 — `[app]` 머리말).
 */
export const APPEARANCE_TERM_KEYS = [
  "theme",
  "opacity",
  "tab_style",
  "font_family",
  "cursor_style",
  "ligatures",
] as const satisfies readonly (keyof TermPrefs)[];

/** `[dock]` 에서 담는 칸 — 독 배치(런처가 선 쪽 · 2026-11-08). 이 칸 전의 옛 프로필에는 `dock` 이 없다(적용하면 기본 배치). */
export const APPEARANCE_DOCK_KEYS = ["layout"] as const satisfies readonly (keyof DockPrefs)[];

/** `[wallpaper]` 는 **테이블 전부**다 (이미지 이름 + 어둡게·블러·배치) */
export const APPEARANCE_WALLPAPER_KEYS = [
  "file",
  "dim",
  "blur",
  "fit",
] as const satisfies readonly (keyof WallpaperPrefs)[];

/** 숫자인 `[app]` 칸 (나머지 `[app]` 칸은 문자열 — 아래 불리언 칸 빼고) */
const APP_NUMBER_KEYS = ["opacity"] as const;
/** 불리언인 `[app]` 칸 */
const APP_BOOL_KEYS = ["resource_rings", "usage_rings", "window_controls"] as const;
/** 불리언인 `[terminal]` 칸 */
const TERM_BOOL_KEYS = ["ligatures"] as const;
/** 숫자인 `[terminal]` 칸 */
const TERM_NUMBER_KEYS = ["opacity"] as const;
/** 숫자인 `[wallpaper]` 칸 */
const WALLPAPER_NUMBER_KEYS = ["dim", "blur"] as const;

export type AppearanceAppKey = (typeof APPEARANCE_APP_KEYS)[number];
export type AppearanceTermKey = (typeof APPEARANCE_TERM_KEYS)[number];
export type AppearanceWallpaperKey = (typeof APPEARANCE_WALLPAPER_KEYS)[number];

/** `app_icon` 은 위 배열 밖의 칸이다(머리말 "앱 아이콘은 따로") — 없으면 기본(GPT)으로 본다 */
export type AppearanceApp = Pick<AppTheme, AppearanceAppKey | "app_icon">;
/** 스칼라 셋 + 동적 팔레트 테이블 (`before-theme` 칸까지 그대로) */
export type AppearanceTerm = Pick<TermPrefs, AppearanceTermKey | "dynamic">;
export type AppearanceWallpaper = Pick<WallpaperPrefs, AppearanceWallpaperKey>;
export type AppearanceDock = Pick<DockPrefs, (typeof APPEARANCE_DOCK_KEYS)[number]>;

/** 모양 한 벌 — 프로필이 담는 **전부** */
export interface AppearanceSnapshot {
  app: AppearanceApp;
  terminal: AppearanceTerm;
  wallpaper: AppearanceWallpaper;
  /** 독 배치 — 선택 칸(옛 프로필에는 없다 · 적용하면 기본 배치) */
  dock?: AppearanceDock;
}

/** 프로필 하나 */
export interface ThemeProfile {
  /** 이 목록 안에서만 뜻이 있는 안정적인 키 (이름을 바꿔도 그대로다) */
  id: string;
  /** 사용자가 붙인 이름 — 목록에서 **유일**하다 (같은 이름으로 저장하면 덮어쓴다) */
  name: string;
  /** 저장한 시각 (`Date.now()`) */
  savedAt: number;
  /** 담긴 모양 한 벌 */
  appearance: AppearanceSnapshot;
  /**
   * 시작 화면 한 벌(위젯 배치 + 시계 표시 — 2026-11-03). **선택 칸** — 없으면(이 칸 전에 저장한 옛 프로필) 적용해도 지금 배치를
   * 건드리지 않는다. `appearance` 밖에 두는 것은 "(수정됨)" 판정([`sameAppearance`])에 들지 않게 하려는 것이다 — 고른 프로필이
   * 있으면 배치를 옮기는 순간 곧바로 이 칸에 담기므로(자동 저장 — `theme-profiles.svelte.ts`) 비교할 까닭도 없다.
   */
  startBoard?: StartBoardSnapshot;
}

/** `theme-profiles.json` 한 장 — 목록과 **지금 고른 프로필**이 같은 파일에 산다 */
export interface ThemeProfileFile {
  version: number;
  /**
   * 마지막으로 적용한 프로필의 id (`null` = 고른 것 없음).
   *
   * 목록과 같은 파일에 두는 이유는 **두 값이 함께 뜻을 이루기** 때문이다 — 목록에 없는 id 를
   * 가리키는 상태를 만들지 않으려면 한 번의 쓰기로 둘이 같이 움직여야 하고, `settings.toml`
   * 에 두면 "지금 쓰는 값" 과 "아껴 둔 것" 의 경계가 다시 흐려진다.
   */
  active: string | null;
  profiles: ThemeProfile[];
}

// ---------------------------------------------------------------------------
// 스냅숏 — 지금 설정 → 모양 한 벌
// ---------------------------------------------------------------------------

/** 정해진 값만 담는다 (`undefined`/`null` 칸은 키 자체를 안 만든다 — "안 정함") */
function put<T extends object, K extends keyof T>(into: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined && value !== null) into[key] = value;
}

/**
 * 목록에 있는 칸을 통째로 옮겨 적는다 — 없는 칸은 `undefined` 로 **지운다**.
 *
 * [`put`] 과 다른 점이 여기다: 프로필을 입힐 때는 "그 프로필이 안 정한 칸" 이 지금 값으로
 * 남아 있으면 안 된다 (밝은 벌로 갈아탔는데 지난 벌의 강조색이 그대로 남는 식).
 */
function overwrite<T, K extends keyof T>(into: T, from: Pick<T, K>, keys: readonly K[]): void {
  for (const key of keys) into[key] = from[key];
}

/**
 * 지금 설정에서 **모양만** 떠낸다.
 *
 * 값은 이미 `normalizeSettings`·setter 를 지난 것들이라 여기서 다시 검사하지 않는다 —
 * 하는 일은 목록에 있는 칸을 고르고 맵을 복사하는 것뿐이다(맵을 얕게라도 복사하지 않으면
 * 설정을 나중에 고칠 때 저장해 둔 프로필의 팔레트가 함께 바뀐다).
 */
export function snapshotAppearance(s: AppSettings): AppearanceSnapshot {
  const app = {} as AppearanceApp;
  for (const key of APPEARANCE_APP_KEYS) put(app, key, s.app[key]);
  // 기본(설정에서는 빈 칸)도 글자로 적는다 — 파일을 손으로 읽어도 무엇을 담았는지 보이게(없음도 기본으로 읽힌다 — 머리말).
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
 * 모양 한 벌을 지금 설정 위에 얹은 **새 설정 객체**를 만든다 (원본은 건드리지 않는다).
 *
 * ## 왜 setter 를 하나씩 부르지 않는가
 *
 * `setAppColorTheme`·`setTermPreset` 은 "사용자가 손으로 골랐다" 는 신호라 **동적 표시를 끈다**.
 * 프로필을 입히는 것은 그 반대의 일(저장해 둔 한 벌을 통째로 되살리는 것)이라, 그 길로
 * 가면 월페이퍼에서 뽑아 만든 벌이 불러오는 순간 자기 표시를 잃는다. 그래서 여기서는 값을
 * 통째로 갈아 끼우고, **검사는 `normalizeSettings` 한 번으로** 대신한다 (파일에서 읽은
 * 설정이 지나는 바로 그 함수다 — 모르는 모드·범위 밖 투명도가 거기서 걸린다).
 *
 * 그 밖의 뒤처리(`<html data-theme>` · 인라인 토큰 · 저장 · 배경 URL)는 전부 설정 화면이
 * 쓰는 함수 그대로다 — 이 함수는 **값만** 만든다 (`theme-profiles.svelte.ts` 참고).
 *
 * `keepWallpaper` 는 "배경은 지금 것을 그대로 둔다" 는 뜻이다 — 프로필이 가리키는 이미지
 * 사본이 이미 없을 때 쓴다 (없는 이름을 걸면 배경이 통째로 사라진다).
 *
 * 앱 아이콘은 늘 프로필의 것으로 바꾼다(없으면 기본 GPT). `icon` 이 `"keep"` 이면 그대로 두고(원격 창 — 앱 아이콘 미지원),
 * `"default"` 면 기본으로 접는다(가리키는 사용자 아이콘 파일이 지워졌을 때 — 앱이 막히지 않게).
 * 기본(GPT)은 설정의 관례대로 빈 칸으로 적는다(`setAppIcon` 과 같다).
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

/**
 * 두 모양이 같은가 — 목록의 "(수정됨)" 판정 하나가 이 함수다.
 *
 * `sameSettings` 와 같은 결로 **칸을 직접 비교**한다 (JSON 비교는 키 순서에 흔들린다).
 * 팔레트 테이블만 맵 비교이고, 없음과 빈 맵을 같게 본다 (`sameStringMap`).
 */
export function sameAppearance(a: AppearanceSnapshot, b: AppearanceSnapshot): boolean {
  return (
    APPEARANCE_APP_KEYS.every((k) => a.app[k] === b.app[k]) &&
    // 아이콘 — 없음은 기본(GPT)으로 보고 견준다(머리말).
    (a.app.app_icon ?? DEFAULT_APP_ICON) === (b.app.app_icon ?? DEFAULT_APP_ICON) &&
    APPEARANCE_TERM_KEYS.every((k) => a.terminal[k] === b.terminal[k]) &&
    sameStringMap(a.terminal.dynamic, b.terminal.dynamic) &&
    APPEARANCE_WALLPAPER_KEYS.every((k) => a.wallpaper[k] === b.wallpaper[k]) &&
    APPEARANCE_DOCK_KEYS.every((k) => a.dock?.[k] === b.dock?.[k])
  );
}

// ---------------------------------------------------------------------------
// 검증 — 파일 → 믿을 수 있는 목록 (순수, 절대 throw 하지 않는다)
// ---------------------------------------------------------------------------

/** 숫자 칸 — 유한한 수만 통과시켜 정수로 접는다. 범위는 `normalizeSettings` 가 자른다 */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

/**
 * 파일에서 온 모양 한 벌을 **모양 검사만** 해서 받는다 (모르는 키는 버린다).
 *
 * 값의 유효성은 보지 않는다 — 적용 직전에 `normalizeSettings` 가 본다 (머리말).
 */
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
  // 아이콘 — 내장 키 · 사용자 아이콘 id 모양만 받고, 없음(옛 프로필) · 그 밖은 기본(GPT).
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
  // 팔레트는 **키·값을 검사하지 않는다** (설정 파일의 `[terminal.dynamic]` 과 같은 "보관만"
  // 분담) — 문자열이 아닌 값만 걷어 내고, 아는 칸을 고르는 것은 화면에 걸리기 직전이다.
  terminal.dynamic = normalizeStringMap(rawTerm.dynamic);

  const wallpaper = {} as AppearanceWallpaper;
  for (const key of APPEARANCE_WALLPAPER_KEYS) {
    const v = (WALLPAPER_NUMBER_KEYS as readonly string[]).includes(key)
      ? num(rawWp[key])
      : // 이미지는 **이름 한 조각**만 통과시킨다 (설정의 `[wallpaper] file` 과 같은 그물 —
        // 손으로 고친 파일이 앱 폴더 밖을 가리키지 못하게 한다).
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
 * 원시 JSON 문자열 → 검증된 파일 한 장. 파싱 실패·모르는 버전이면 `null`.
 *
 * **깨진 줄만 버린다** (`parseLayoutFile` 과 같은 판정): 프로필은 서로 독립이라 한 줄이
 * 이상하다고 나머지를 함께 버리면 잃는 것이 훨씬 크다. 이름·id 가 없는 줄, `appearance` 가
 * 객체가 아닌 줄, id 가 겹치는 줄만 빠진다.
 *
 * `active` 는 **목록에 실제로 있는 id 일 때만** 살아남는다 — 없는 프로필을 가리키는
 * "지금 고른 것" 은 화면에서 빈 select 가 되고, 그 상태로는 "(수정됨)" 판정도 뜻을 잃는다.
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

/**
 * 목록 → 파일 모양 — **순수 함수**.
 *
 * 저장 쪽이 이 결과를 `JSON.stringify` 해 직전 값과 비교하므로(`layouts.svelte.ts` 와 같은
 * 규칙) **같은 목록이면 같은 문자열**이 나와야 한다. 그래서 키 순서를 고정한다.
 */
export function serializeProfiles(
  list: readonly ThemeProfile[],
  active: string | null,
): ThemeProfileFile {
  // 목록에 없는 id 는 파일에 남기지 않는다 (`parseProfiles` 가 읽을 때 하는 판정과 짝).
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

// ---------------------------------------------------------------------------
// 목록 조작 — 전부 **새 배열**을 돌려준다 (모듈 상태는 `theme-profiles.svelte.ts`)
// ---------------------------------------------------------------------------

/**
 * 이름으로 하나 찾기 — **대소문자·앞뒤 공백을 무시**한다 (`layoutNamed` 와 같은 규칙).
 * 덮어쓸지 묻는 판정이 이 함수 하나다.
 */
export function profileNamed(
  list: readonly ThemeProfile[],
  name: string,
): ThemeProfile | undefined {
  const key = name.trim().toLowerCase();
  if (key === "") return undefined;
  return list.find((p) => p.name.trim().toLowerCase() === key);
}

/**
 * 프로필 하나를 목록에 넣는다 — **같은 id 가 있으면 그 자리 값을 갈아 끼우고**(맨 앞으로
 * 올린다), 없으면 앞에 붙인다. 넘치면 가장 오래된 것부터 밀려난다.
 */
export function withProfile(
  list: readonly ThemeProfile[],
  profile: ThemeProfile,
): ThemeProfile[] {
  return [profile, ...list.filter((p) => p.id !== profile.id)].slice(0, MAX_PROFILES);
}

/**
 * 그 프로필의 시작 화면 칸만 갈아 끼운 새 목록 — **자리 · 저장 시각은 그대로**다(배치 자동 저장은 "그 프로필을 다시 저장했다" 가
 * 아니라 그 프로필의 한 칸을 고친 것이라, 목록 순서가 배치를 옮길 때마다 흔들리면 안 된다). 없는 id 면 같은 내용의 새 배열.
 */
export function withStartBoard(
  list: readonly ThemeProfile[],
  id: string,
  board: StartBoardSnapshot,
): ThemeProfile[] {
  return list.map((p) => (p.id === id ? { ...p, startBoard: plainStartBoard(board) } : p));
}

/** 프로필 하나를 뺀다 (없는 id 면 같은 내용의 새 배열) */
export function withoutProfile(list: readonly ThemeProfile[], id: string): ThemeProfile[] {
  return list.filter((p) => p.id !== id);
}

/**
 * 이름만 바꾼 새 목록. 빈 이름·없는 id·**다른 프로필이 이미 쓰는 이름**이면 `null`
 * (`renameLayout` 과 같은 규칙 — 이름이 겹치면 덮어쓰기 판정이 흔들린다).
 */
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
