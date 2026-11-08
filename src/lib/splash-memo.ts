import { APP_ICONS, DEFAULT_APP_ICON, isUserAppIconId, type AppIcon } from "$lib/settings/model/options";
import claude from "../../src-tauri/icons/characters/claude.png";
import gemini from "../../src-tauri/icons/characters/gemini.png";
import gpt from "../../src-tauri/icons/characters/gpt.png";
import grok from "../../src-tauri/icons/characters/grok.png";

/**
 * **스플래시가 미리 알아야 하는 것의 사본** — 고른 앱 아이콘(캐릭터)과 지금 칠해진 바탕·글자색.
 *
 * 스플래시는 `boot()` 이 설정 파일을 읽기 **전에** 칠해진다(`Splash.svelte` — 그 한 프레임 뒤에 창이 뜬다).
 * 그래서 그 순간에는 고른 아이콘도, 색 테마도, 밝기(라이트/다크)도 모른다 — 예전에는 언제나 기본 그림에
 * `theme.css` 기본(다크) 바탕이었다. 설정이 화면에 걸릴 때마다(`applySettings`) 그 결과를 `localStorage` 에
 * 한 줄씩 적어 두고, 다음 시작의 스플래시가 **동기로** 읽는다. 진짜 값은 여전히 `settings.toml` 이고 이것은
 * 첫 프레임만을 위한 사본이다 — 비어 있거나(첫 실행·지운 사이트 데이터) 모르는 값이면 예전 그대로다.
 * 개발 빌드는 WebView2 프로필이 따로라(`instance.rs`) 릴리스와 섞이지 않는다.
 *
 * 색은 설정 값이 아니라 **계산된 CSS 값**(`--bg-base` · `--fg-muted`)을 적는다 — 그래야 내장 테마·사용자 색·
 * 월페이퍼 추출·밝기가 어떤 조합이든 한 쌍으로 맞고, 스플래시가 색 규칙을 다시 알 필요가 없다.
 *
 * 그림은 Rust 가 창 아이콘으로 쓰는 256px 원본(`src-tauri/icons/characters/`)을 그대로 번들한다 —
 * 설정 화면 썸네일(96px)은 96px 로 그리는 스플래시에서 HiDPI 에 뭉개진다.
 *
 * 사용자 아이콘(`user-<12hex>` — docs/log/2026-10-22-custom-app-icon.md)은 번들에 없으므로 고를 때 받은 **썸네일 data URL**
 * (96px — HiDPI 에서 조금 흐리다, 알고 받음)을 id 와 한 쌍으로 따로 적어 둔다([`rememberSplashUserIcon`]). 읽을 때 id 가 맞아야만 쓴다.
 */
const ICON_KEY = "aynx.splash.app-icon";
const USER_ICON_KEY = "aynx.splash.app-icon-user";
const COLORS_KEY = "aynx.splash.colors";

const IMAGES: Record<AppIcon, string> = { claude, gemini, gpt, grok };

/** 스플래시가 칠할 두 색 — 비면 `theme.css` 기본값 */
export interface SplashColors {
  bg: string;
  fg: string;
}

/** 저장소에서 읽은 글자를 CSS 값으로 믿어도 되는가 — 색 함수·hex 모양만 받는다 */
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|color)\([0-9a-z.,%\s/-]*\))$/i;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // 막힌 저장소 — 스플래시가 예전 그대로일 뿐이다
  }
}

function write(key: string, value: string): void {
  try {
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
  } catch {
    // 위와 같다
  }
}

/** 지금 건 아이콘을 다음 시작의 스플래시용으로 적어 둔다 (`applySettings` → `syncAppIcon`) */
export function rememberSplashIcon(id: string): void {
  write(ICON_KEY, id);
}

/** 사용자 아이콘을 고를 때 그 썸네일을 적어 둔다 — 다음 시작의 스플래시가 [`splashIconSrc`] 로 꺼낸다 */
export function rememberSplashUserIcon(id: string, src: string): void {
  if (isUserAppIconId(id) && src.startsWith("data:image/png;base64,")) write(USER_ICON_KEY, JSON.stringify({ id, src }));
}

/** 적어 둔 사용자 아이콘 썸네일 — id 가 맞고 PNG data URL 일 때만 */
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

/** 스플래시에 세울 그림 URL — 적어 둔 키, 없거나 모르면 기본 */
export function splashIconSrc(): string {
  const id = read(ICON_KEY);
  if (id !== null && isUserAppIconId(id)) return userIconSrc(id) ?? IMAGES[DEFAULT_APP_ICON];
  return IMAGES[id !== null && id in APP_ICONS ? (id as AppIcon) : DEFAULT_APP_ICON];
}

/** 지금 화면에 걸린 바탕·글자색을 적어 둔다 (`applySettings` 끝 — 토큰을 다 얹은 뒤) */
export function rememberSplashColors(root: HTMLElement): void {
  const style = getComputedStyle(root);
  const bg = style.getPropertyValue("--bg-base").trim();
  const fg = style.getPropertyValue("--fg-muted").trim();
  if (COLOR_RE.test(bg) && COLOR_RE.test(fg)) write(COLORS_KEY, JSON.stringify({ bg, fg }));
}

/** 스플래시가 칠할 두 색 — 없거나 이상하면 `null`(= `theme.css` 기본) */
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
