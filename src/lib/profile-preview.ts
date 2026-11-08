import { canonicalPreset, isFixedDynamicTermKey, termThemeOf, type UserTermTheme } from "$lib/theme";
import { dynamicTermTheme } from "$lib/dynamic-color";
import { fixedDynamicTerms } from "$lib/app-color-themes";
import type { AppearanceSnapshot } from "$lib/theme-profiles";

/**
 * **모양 프로필 카드의 미리 보기 색** — 저장된 한 벌(`AppearanceSnapshot`)에서 카드가 그릴
 * 색을 푼다 (docs/log/2026-09-28-profile-cards-wallpapers.md).
 *
 * 카드는 그 프로필을 **입히지 않고** 그려야 한다 — 지금 화면의 CSS 변수는 지금 모양의 것이라
 * 쓸 수 없다. 그래서 프로필이 정한 칸은 그 값을, 안 정한 칸은 **그 프로필 모드의
 * `theme.css` 기본값**을 쓴다. 기본값을 여기 한 번 더 적는 이유는, 다른 모드의 기본값은
 * `getComputedStyle` 로 읽을 수 없기 때문이다(지금 `<html data-theme>` 의 것만 보인다).
 * 두 벌이 어긋나지 않는지는 `profile-preview.test.ts` 가 `theme.css` 를 읽어 대조한다.
 *
 * 터미널 팔레트는 앱이 실제로 거는 길과 **같은 함수**로 푼다 — 옛 키 별칭(`canonicalPreset`) →
 * 프리셋 또는 월페이퍼에서 뽑은 팔레트(`termThemeOf` + `dynamicTermTheme`). 모르는 키는 앱과
 * 똑같이 기본 프리셋으로 떨어진다. 사용자 테마(`user:<id>`)는 부르는 쪽이 건넨 목록으로 풀고, 없으면 **그 프로필 모드의**
 * AYNX 로 떨어진다(앱이 그리는 것과 같은 규칙).
 *
 * 은은하게(`dynamic = "subtle"`)의 틴트는 여기 없다 — 그 색은 저장되지 않고 사진을 디코딩해야
 * 나오는 값이라, 카드 수만큼 사진을 읽는 비용을 치를 만큼의 차이가 아니다.
 */

/** 카드에 보이는 모드 — 프로필이 안 정했으면 앱 기본값(Dark)과 같다 */
export type PreviewMode = "dark" | "light";

/** 카드가 그리는 색 한 벌 (전부 CSS 색 문자열) */
export interface ProfilePreview {
  mode: PreviewMode;
  /** 실제로 칠할 밝기 */
  light: boolean;
  accent: string;
  bg: string;
  fg: string;
  /** ANSI 여덟 칸 — black·red·green·yellow·blue·magenta·cyan·white 순 */
  ansi: string[];
}

/**
 * `theme.css` 의 기본값 — `:root`(다크)와 `:root[data-theme="light"]`.
 * `bg` 는 투명도를 섞기 전의 **기저색**(`--bg-base`)이다.
 */
export const PREVIEW_DEFAULTS = {
  dark: { accent: "#aac7ff", bg: "#111318", fg: "#e2e2e9" },
  light: { accent: "#415f91", bg: "#f9f9ff", fg: "#191c20" },
} as const;

/** ANSI 여덟 칸의 xterm `ITheme` 이름 (순서가 곧 카드의 막대 순서다) */
const ANSI_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** 빈 문자열·공백은 "안 정함" 이다 (설정 파일의 규칙과 같다) */
function pick(v: string | null | undefined, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s !== "" ? s : fallback;
}

/**
 * 프로필 모드 → 카드 모드. 모르는 값·안 정함은 앱 기본값(Dark).
 * 기본값을 상수로 빌리지 않는 것은 이 모듈이 룬 모듈을 부르지 않기 위해서다(옮겨 적은 사본 —
 * `options.ts` 의 `DEFAULT_APP_MODE` 와 같아야 한다).
 */
function modeOf(raw: string | null | undefined): PreviewMode {
  return raw === "light" ? "light" : "dark";
}

/** 한 벌 → 카드 색. */
export function profilePreview(
  a: AppearanceSnapshot,
  userThemes: Readonly<Record<string, UserTermTheme>> = {},
): ProfilePreview {
  const mode = modeOf(a.app.mode);
  const light = mode === "light";
  const base = light ? PREVIEW_DEFAULTS.light : PREVIEW_DEFAULTS.dark;
  const key = canonicalPreset(a.terminal.theme);
  // 고정 밝기(`dynamic-dark` · `dynamic-light`)는 그 키일 때만 푼다 — 카드마다 원천을 다시 푸는 값을 아낀다
  const fixed = isFixedDynamicTermKey(key) ? fixedDynamicTerms(a) : undefined;
  const term = termThemeOf(key, dynamicTermTheme(a.terminal.dynamic), { themes: userThemes, light }, fixed);
  const fg = pick(a.app.fg, base.fg);
  // 팔레트에 없는 칸은 터미널 글자색으로 채운다 (빈 막대를 그리지 않는다)
  const termFg = pick(term.foreground, fg);
  return {
    mode,
    light,
    accent: pick(a.app.accent, base.accent),
    bg: pick(a.app.bg, base.bg),
    fg,
    ansi: ANSI_KEYS.map((k) => pick(term[k], termFg)),
  };
}

/**
 * 카드 미리 보기의 배경 사진 위에 얹을 **어둡게·블러** (CSS 값).
 *
 * 블러는 줄인다 — 카드는 창보다 훨씬 작아서 같은 px 을 걸면 실제보다 훨씬 뭉개져 보인다.
 * 창 폭(대략 1600px) 대비 카드 폭(대략 240px)의 비율만큼 줄여 인상을 맞춘다.
 */
export function previewWallpaperFx(a: AppearanceSnapshot): { dim: string; blur: string } {
  const dimPct = clamp(a.wallpaper.dim ?? 0, 0, 100);
  const blurPx = clamp(a.wallpaper.blur ?? 0, 0, 100) * PREVIEW_BLUR_SCALE;
  return {
    dim: `rgba(0, 0, 0, ${(dimPct / 100).toFixed(3)})`,
    blur: `${blurPx.toFixed(1)}px`,
  };
}

/** 카드 폭 ÷ 창 폭 — [`previewWallpaperFx`] 의 블러 축소 비율 */
export const PREVIEW_BLUR_SCALE = 0.15;

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
