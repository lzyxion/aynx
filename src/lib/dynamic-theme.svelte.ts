import {
  MAX_SAMPLE,
  NO_PIXELS_ERROR,
  cachedPaletteFromSource,
  chromeIsSourcePalette,
  paletteFromImageData,
  pixelsFromImageData,
  sourceColorFromPixels,
  tintSourceFromPixels,
  type DynamicMode,
  type DynamicPalette,
} from "$lib/dynamic-color";
import {
  adoptDynamicPalette,
  adoptWallpaperTint,
  clearDynamicTheme,
  currentDynamicSource,
  rememberDynamicSource,
  saveSettings,
  settings,
} from "$lib/settings.svelte.js";
import { isLightMode } from "$lib/mode.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 월페이퍼 색 뽑기의 화면 · 상태 쪽 (docs/log/2026-09-04-dynamic-color.md). 입력은 스토어가 아니라 URL 문자열이다 —
 * `wallpaper` 스토어를 import 하면 두 모듈이 서로를 부르는 순환이 생긴다.
 */

class DynamicThemeStore {
  busy = $state(false);
  error = $state<string | null>(null);
  /** 이번 실행에서만 뜻이 있는 결과라 설정이 아니라 여기 산다(소스색은 `[terminal.dynamic]` 의 `source-color` 칸에 따로 적힌다) */
  last = $state<DynamicPalette | null>(null);
}

export const dynamicTheme = new DynamicThemeStore();

function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** `<img>` 대신 `fetch` → `createImageBitmap` — asset 프로토콜 URL 은 출처가 달라 캔버스가 오염되고 `getImageData` 가 막힌다 */
async function imageDataFromUrl(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t("app.dynamic.fetchFailed", { status: res.status }));
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const scale = Math.min(1, MAX_SAMPLE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("app.dynamic.noCanvas"));
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    // 디코드된 비트맵은 GC 를 기다리지 않고 놓는다(4K 사진이면 수십 MB다)
    bitmap.close();
  }
}

/** 실패하면 아무것도 바꾸지 않는다 — 반쯤 적용된 팔레트(크롬만 바뀌고 터미널은 그대로)가 가장 나쁘다 */
export async function extractDynamicTheme(src: string): Promise<boolean> {
  if (!src || dynamicTheme.busy) return false;
  dynamicTheme.busy = true;
  dynamicTheme.error = null;
  try {
    // 밝기는 지금 앱 모드를 따른다 — 모드를 바꾸면 다시 불러 새 밝기로 다시 푼다
    const palette = paletteFromImageData(await imageDataFromUrl(src), !isLightMode());
    dynamicTheme.last = palette;
    adoptDynamicPalette(palette);
    return true;
  } catch (e) {
    // 순수 층(`dynamic-color.ts`)이 던지는 것은 문구 키다 — 그 한 갈래만 옮긴다
    const raw = describeError(e);
    dynamicTheme.error = t("app.dynamic.extractFailed", {
      error: raw === NO_PIXELS_ERROR ? t(NO_PIXELS_ERROR) : raw,
    });
    return false;
  } finally {
    dynamicTheme.busy = false;
  }
}

/** 같은 URL 이면 사진을 다시 디코딩하지 않는다 — `argb` 는 흑백 사진이면 `null` */
let tintCache: { src: string; argb: number | null } | null = null;

/**
 * 은은하게는 결과를 파일에 적지 않아 부팅할 때도 여기서 읽는다. 실패는 삼킨다 — 틴트는 장식이고 설정 화면의 오류 줄은 전체 추출의 몫이다.
 */
export async function syncWallpaperTint(src: string, mode: DynamicMode): Promise<void> {
  if (mode !== "subtle" || !src) {
    adoptWallpaperTint(null);
    if (mode === "full" && src) void primeDynamicSource(src);
    return;
  }
  if (tintCache?.src === src) {
    adoptWallpaperTint(tintCache.argb);
    return;
  }
  tintCache = { src, argb: null };
  let argb: number | null = null;
  try {
    argb = tintSourceFromPixels(pixelsFromImageData(await imageDataFromUrl(src)));
  } catch (e) {
    console.warn("[aynx] 월페이퍼 기운을 읽지 못했습니다 (무시):", describeError(e));
  }
  if (tintCache?.src !== src) return;
  tintCache.argb = argb;
  // 기다리는 사이 단계가 바뀌었을 수 있다 — 지금도 은은하게일 때만 얹는다.
  adoptWallpaperTint(settings.dynamicMode === "subtle" ? argb : null);
}

let primeSrc: string | null = null;

/**
 * 소스색 칸이 없는 옛 `settings.toml` 용 — 배경을 한 번 읽어 메모리에만 둔다(설정을 건드리지 않아 미저장 변경이 생기지 않는다).
 * 없으면 첫 밝기 전환이 사진 디코딩을 기다리며 한 번 검게 깜빡인다.
 */
async function primeDynamicSource(src: string): Promise<void> {
  if (currentDynamicSource() !== null || primeSrc === src) return;
  primeSrc = src;
  try {
    const argb = sourceColorFromPixels(pixelsFromImageData(await imageDataFromUrl(src)));
    if (primeSrc === src) rememberDynamicSource(argb);
  } catch (e) {
    console.warn("[aynx] 월페이퍼 소스색을 미리 읽지 못했습니다 (무시):", describeError(e));
  }
}

/** 배경이 사라진 상태는 건드리지 않는다 — 그 정리는 [`wallpaperChanged`] 의 몫이다 */
export async function modeChanged(src: string): Promise<void> {
  if (!settings.dynamicTheme || !src) return;
  // 이미 같은 소스색에서 새 밝기 팔레트로 갈아 끼웠으면(`syncAppColorTheme`) 다시 읽지 않는다 — 결과가 비트 단위로 같다
  const argb = currentDynamicSource();
  const isDark = !isLightMode();
  if (argb !== null && chromeIsSourcePalette(settings.current.app, argb, isDark)) {
    dynamicTheme.last = cachedPaletteFromSource(argb, isDark);
    return;
  }
  // 미저장 변경이 있으면 저장하지 않는다 — 사람의 [저장]/[취소] 를 앞질러 확정하지 않는다(다시 뽑은 팔레트도 같은 [저장] 에 들어간다)
  const wasDirty = settings.dirty;
  const ok = await extractDynamicTheme(src);
  if (!ok || wasDirty) return;
  try {
    await saveSettings();
  } catch (e) {
    console.warn("[aynx] 모드에 맞춰 다시 뽑은 색을 저장하지 못했습니다 (무시):", e);
  }
}

/**
 * 배경이 사라지면 토글을 끄고 되돌린다 — 원본 없이 그 사진의 색만 남으면 어디서 왔는지 알 길이 없다.
 * 앱 시작 경로에서는 부르지 않는다(저장된 팔레트가 이미 맞는 색이다).
 */
export async function wallpaperChanged(src: string): Promise<void> {
  if (!settings.dynamicTheme) return;
  if (!src) {
    dynamicTheme.error = null;
    dynamicTheme.last = null;
    clearDynamicTheme();
    return;
  }
  await extractDynamicTheme(src);
}
