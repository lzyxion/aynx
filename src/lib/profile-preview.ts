import { canonicalPreset, isFixedDynamicTermKey, termThemeOf, type UserTermTheme } from "$lib/theme";
import { dynamicTermTheme } from "$lib/dynamic-color";
import { fixedDynamicTerms } from "$lib/app-color-themes";
import type { AppearanceSnapshot } from "$lib/theme-profiles";

/** 은은하게(`dynamic = "subtle"`)의 틴트는 그리지 않는다 — 저장되지 않는 값이라 카드마다 사진을 디코딩해야 한다 */

export type PreviewMode = "dark" | "light";

export interface ProfilePreview {
  mode: PreviewMode;
  light: boolean;
  accent: string;
  bg: string;
  fg: string;
  ansi: string[];
}

/**
 * `theme.css` 기본값의 사본 — 다른 모드의 값은 `getComputedStyle` 로 읽을 수 없다(`profile-preview.test.ts` 가 대조).
 * `bg` 는 투명도를 섞기 전의 `--bg-base` 다.
 */
export const PREVIEW_DEFAULTS = {
  dark: { accent: "#aac7ff", bg: "#111318", fg: "#e2e2e9" },
  light: { accent: "#415f91", bg: "#f9f9ff", fg: "#191c20" },
} as const;

const ANSI_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

function pick(v: string | null | undefined, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s !== "" ? s : fallback;
}

/** 기본값은 `options.ts` 의 `DEFAULT_APP_MODE` 와 같아야 한다 — 룬 모듈을 부르지 않으려고 옮겨 적었다 */
function modeOf(raw: string | null | undefined): PreviewMode {
  return raw === "light" ? "light" : "dark";
}

export function profilePreview(
  a: AppearanceSnapshot,
  userThemes: Readonly<Record<string, UserTermTheme>> = {},
): ProfilePreview {
  const mode = modeOf(a.app.mode);
  const light = mode === "light";
  const base = light ? PREVIEW_DEFAULTS.light : PREVIEW_DEFAULTS.dark;
  const key = canonicalPreset(a.terminal.theme);
  const fixed = isFixedDynamicTermKey(key) ? fixedDynamicTerms(a) : undefined;
  const term = termThemeOf(key, dynamicTermTheme(a.terminal.dynamic), { themes: userThemes, light }, fixed);
  const fg = pick(a.app.fg, base.fg);
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
