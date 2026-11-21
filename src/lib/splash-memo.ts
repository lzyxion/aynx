import { APP_ICONS, DEFAULT_APP_ICON, isUserAppIconId, type AppIcon } from "$lib/settings/model/options";
import claude from "../../src-tauri/icons/characters/claude.png";
import gemini from "../../src-tauri/icons/characters/gemini.png";
import gpt from "../../src-tauri/icons/characters/gpt.png";
import grok from "../../src-tauri/icons/characters/grok.png";

/**
 * 스플래시는 `boot()` 이 설정을 읽기 전에 칠해지므로 고른 앱 아이콘 · 바탕·글자색의 사본을 `localStorage` 에 둔다 — 진짜 값은 `settings.toml` 이고 비거나 모르면 기본이다.
 * 색은 설정 값이 아니라 계산된 CSS 값(`--bg-base` · `--fg-muted`)을 적는다 — 스플래시가 색 규칙을 다시 알 필요가 없다.
 * 그림은 256px 원본을 번들한다 — 96px 설정 썸네일은 HiDPI 에서 뭉개진다. 사용자 아이콘만 96px 썸네일 data URL 이다(조금 흐리다 — 알고 받음 · id 가 맞아야만 쓴다).
 */
const ICON_KEY = "aynx.splash.app-icon";
const USER_ICON_KEY = "aynx.splash.app-icon-user";
const COLORS_KEY = "aynx.splash.colors";

const IMAGES: Record<AppIcon, string> = { claude, gemini, gpt, grok };

export interface SplashColors {
  bg: string;
  fg: string;
}

/** 저장소 글자를 CSS 값으로 믿어도 되는가 — 색 함수 · hex 모양만 받는다 */
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|color)\([0-9a-z.,%\s/-]*\))$/i;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
  } catch {
    // 위와 같다
  }
}

export function rememberSplashIcon(id: string): void {
  write(ICON_KEY, id);
}

export function rememberSplashUserIcon(id: string, src: string): void {
  if (isUserAppIconId(id) && src.startsWith("data:image/png;base64,")) write(USER_ICON_KEY, JSON.stringify({ id, src }));
}

function userIconSrc(id: string): string | null {
  const raw = read(USER_ICON_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: unknown; src?: unknown };
    return v.id === id && typeof v.src === "string" && v.src.startsWith("data:image/png;base64,") ? v.src : null;
  } catch {
    return null;
  }
}

export function splashIconSrc(): string {
  const id = read(ICON_KEY);
  if (id !== null && isUserAppIconId(id)) return userIconSrc(id) ?? IMAGES[DEFAULT_APP_ICON];
  return IMAGES[id !== null && id in APP_ICONS ? (id as AppIcon) : DEFAULT_APP_ICON];
}

/** `applySettings` 끝에서 — 토큰을 다 얹은 뒤에 읽어야 한다 */
export function rememberSplashColors(root: HTMLElement): void {
  const style = getComputedStyle(root);
  const bg = style.getPropertyValue("--bg-base").trim();
  const fg = style.getPropertyValue("--fg-muted").trim();
  if (COLOR_RE.test(bg) && COLOR_RE.test(fg)) write(COLORS_KEY, JSON.stringify({ bg, fg }));
}

export function splashColors(): SplashColors | null {
  const raw = read(COLORS_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SplashColors>;
    return typeof v.bg === "string" && typeof v.fg === "string" && COLOR_RE.test(v.bg) && COLOR_RE.test(v.fg)
      ? { bg: v.bg, fg: v.fg }
      : null;
  } catch {
    return null;
  }
}
