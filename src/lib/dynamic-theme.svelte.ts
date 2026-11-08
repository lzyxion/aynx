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
 * 월페이퍼에서 MD3 색 뽑기 — **화면·상태** 쪽 (docs/log/2026-09-04-dynamic-color.md).
 *
 * 색을 만드는 계산은 전부 `$lib/dynamic-color.ts`(순수)에 있고, 여기서는 그 앞뒤만 한다:
 * 이미지 URL 을 캔버스에 그려 픽셀을 얻고 → 계산을 부르고 → 결과를 설정에 얹는다.
 * 그 사이의 "뽑는 중"·"실패했다" 를 설정 화면이 볼 수 있게 상태로 들고 있다.
 *
 * ## 왜 월페이퍼 모듈과 갈랐나
 *
 * `wallpaper.svelte.ts` 는 **파일**을 다룬다(고르기·복사·지우기). 이쪽은 그 파일이 화면에
 * 만든 **픽셀**을 다룬다. 두 관심사를 한 파일에 두면 색 추출이 파일 명령의 성패에 얽히고,
 * 무엇보다 이 모듈이 `wallpaper` 스토어를 import 하는 순간 두 모듈이 서로를 부르는
 * 순환이 생긴다 (월페이퍼를 바꾸면 다시 뽑아야 하므로 반대 방향 호출이 반드시 필요하다).
 * 그래서 이 모듈의 입력은 스토어가 아니라 **URL 문자열 하나**다 — 부르는 쪽이 건넨다.
 */

class DynamicThemeStore {
  /** 지금 색을 뽑는 중 — 설정 화면이 토글과 버튼을 잠근다 */
  busy = $state(false);
  /** 마지막 실패 (한국어). 성공하면 지워진다 */
  error = $state<string | null>(null);
  /**
   * 마지막으로 뽑아낸 팔레트 — 설정 화면의 **미리보기 견본**이 이걸 그린다.
   *
   * 설정(`settings.current`)이 아니라 여기 사는 이유는 `wallpaper.src` 와 같다: 저기는
   * 파일에 저장되는 값만 담고, 이것은 "방금 뽑은 결과" 라는 이번 실행에서만 뜻이 있는
   * 값이다 (소스색은 `[terminal.dynamic]` 의 `source-color` 칸에 따로 적힌다).
   */
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

/**
 * 이미지 URL → 축소된 `ImageData`.
 *
 * **`fetch` → `createImageBitmap` 경로를 쓴다.** `<img>` 에 asset 프로토콜 URL 을 물리면
 * 그림은 뜨지만 그것을 그린 캔버스가 **오염(tainted)** 될 수 있고, 그 순간 `getImageData`
 * 가 보안 오류로 막힌다 — `http://asset.localhost` 는 웹뷰 문서와 출처가 다르기 때문이다.
 * `fetch` 로 바이트를 직접 받아 blob 을 디코드하면 그 문제가 아예 없다 (같은 창이 이미
 * 그 URL 을 그릴 수 있으므로 권한 문제도 아니다).
 *
 * 축소는 [`MAX_SAMPLE`] 로 한다 — 4K 사진을 그대로 양자화하면 초 단위가 되고, 색의
 * **분포**를 보는 알고리즘이라 128px 로 줄여도 결과가 사실상 같다.
 */
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
    // `willReadFrequently` 는 안 준다 — 이 캔버스는 한 번 읽고 버린다.
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("app.dynamic.noCanvas"));
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    // 디코드된 비트맵은 GC 를 기다리지 않고 바로 놓아 준다 (4K 사진이면 수십 MB다).
    bitmap.close();
  }
}

/**
 * 지금 걸린 배경 이미지에서 색을 뽑아 **적용·저장 상태로 만든다**.
 *
 * 실패하면 아무것도 바꾸지 않고 [`dynamicTheme.error`] 에 한국어 한 줄을 남긴다 —
 * 반쯤 적용된 팔레트(크롬만 바뀌고 터미널은 그대로)가 남는 것이 가장 나쁘다.
 *
 * @param src 배경 레이어가 그리는 그 URL (`wallpaper.src`). 비면 아무 일도 안 한다.
 * @returns 적용에 성공했으면 `true`
 */
export async function extractDynamicTheme(src: string): Promise<boolean> {
  if (!src || dynamicTheme.busy) return false;
  dynamicTheme.busy = true;
  dynamicTheme.error = null;
  try {
    // 스킴의 밝기는 **지금 앱 모드**를 따른다 (docs/log/2026-09-04-light-theme.md).
    // 같은 사진에서 hue 는 그대로고 톤만 반대편으로 간다 — 그래서 모드를 바꾸면
    // `+page.svelte` 가 이 함수를 다시 불러 팔레트를 새 밝기로 다시 푼다.
    const palette = paletteFromImageData(await imageDataFromUrl(src), !isLightMode());
    dynamicTheme.last = palette;
    adoptDynamicPalette(palette);
    return true;
  } catch (e) {
    // 순수 층(`dynamic-color.ts`)이 던지는 것은 **문구 키**다 — 그 한 갈래만 옮겨 준다
    // (나머지는 브라우저·백엔드가 낸 글자라 그대로 싣는다).
    const raw = describeError(e);
    dynamicTheme.error = t("app.dynamic.extractFailed", {
      error: raw === NO_PIXELS_ERROR ? t(NO_PIXELS_ERROR) : raw,
    });
    return false;
  } finally {
    dynamicTheme.busy = false;
  }
}

/**
 * 은은하게가 마지막으로 읽은 배경 — 같은 URL 이면 사진을 다시 디코딩하지 않는다.
 * `argb` 는 그 사진의 소스색(흑백 사진이면 `null`).
 */
let tintCache: { src: string; argb: number | null } | null = null;

/**
 * **은은하게의 소스색을 지금 배경·단계에 맞춘다** — `+page.svelte` 의 `$effect` 가 배경 URL 과
 * 단계를 지켜보며 부른다 (`app/boot.svelte.ts` 의 `syncWallpaperTintNow`).
 *
 * 은은하게가 아니거나 배경이 없으면 소스색을 내린다(틴트가 걷힌다). 은은하게이고 배경이
 * 있으면 그 사진을 읽는다 — 전체 모드와 달리 결과를 파일에 적지 않으므로 부팅할 때도
 * 여기서 한 번 읽는다 (`settings.svelte.ts` 의 `wallpaperTintSource` 주석).
 *
 * **실패를 삼킨다.** 틴트는 장식이라 못 읽으면 테마 그대로 남는 것이 가장 자연스럽고,
 * 설정 화면의 오류 줄은 사용자가 방금 누른 전체 추출의 몫이다.
 * 사진을 읽는 동안 배경이 또 바뀌었으면 늦게 온 결과는 버린다.
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

/** [`primeDynamicSource`] 가 마지막으로 읽기 시작한 배경 — 같은 URL 을 두 번 디코딩하지 않는다 */
let primeSrc: string | null = null;

/**
 * **월페이퍼 추출(full)의 소스색을 미리 알아 둔다** — 소스색 칸이 없는 옛 `settings.toml` 용.
 *
 * 밝기 전환은 소스색을 알면 동기로 새 팔레트를 풀어 깜빡임이 없다
 * (`actions-appearance.ts` 의 `syncAppColorTheme`). 지금 추출은 소스색을 파일에 함께 적지만,
 * 그 전에 뽑아 둔 파일은 칸이 없어 첫 전환이 사진 디코딩을 기다리며 한 번 검게 깜빡인다.
 * 그래서 칸이 없을 때만 배경을 한 번 읽어 **메모리에만** 둔다 (설정을 건드리지 않으므로
 * 미저장 변경도 저장도 생기지 않는다). 쓰기 전에 지금 토큰과 맞는지 다시 확인하므로, 읽은
 * 사진이 지금 팔레트의 원본이 아니면 그냥 쓰이지 않는다. 실패는 삼킨다(장식의 준비일 뿐이다).
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

/**
 * 앱 **모드가 바뀌었을 때** 부른다 (`+page.svelte` 의 `$effect`).
 *
 * 동적 색이 꺼져 있으면 아무 일도 없다 — 켜져 있으면 **같은 사진**을 새 밝기로 다시 푼다.
 * 프리셋처럼 짝을 찾아 갈아 끼우지 않는 이유는, 이 팔레트의 원본이 프리셋 목록이 아니라
 * 사진이기 때문이다: 사진은 그대로 두고 스킴만 라이트/다크로 다시 계산하면 hue 는 유지된 채
 * 톤만 뒤집힌 한 벌이 나온다 (docs/log/2026-09-04-light-theme.md).
 *
 * 배경 이미지가 사라진 상태(추출은 켜져 있는데 파일이 없음)에서는 아무것도 하지 않는다 —
 * 그 정리는 [`wallpaperChanged`] 의 몫이고, 모드 전환이 남의 일을 대신 처리하면 안 된다.
 */
export async function modeChanged(src: string): Promise<void> {
  if (!settings.dynamicTheme || !src) return;
  // 모드 전환이 이미 같은 소스색에서 새 밝기 팔레트를 동기로 갈아 끼웠으면(`syncAppColorTheme`)
  // 사진을 다시 읽을 일이 없다 — 같은 사진의 재추출은 같은 소스색이라 결과가 비트 단위로 같다.
  // 저장은 모드와 함께 설정 [저장] 이 한다 (모드 전환은 미저장 변경 — `mode.svelte.ts` 의 `setAppMode`).
  const argb = currentDynamicSource();
  const isDark = !isLightMode();
  if (argb !== null && chromeIsSourcePalette(settings.current.app, argb, isDark)) {
    dynamicTheme.last = cachedPaletteFromSource(argb, isDark);
    return;
  }
  // 미저장 변경이 없을 때만 파일에 남긴다 — 사람이 설정 화면에서 편집 중이면 그의 [저장]/[취소] 를 앞질러 확정하지 않는다.
  // 설정 화면의 모드 전환은 그 자체가 미저장 변경이라(`mode.svelte.ts` 의 `setAppMode`) 여기서 저장하지 않고 다시 뽑은 팔레트도
  // 같은 [저장] 에 함께 들어간다. 미저장 없이 여기 오는 것은 [취소] 로 저장된 밝기에 돌아온 경우다(저장된 값과 같은 팔레트).
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
 * 월페이퍼가 **바뀌었을 때** 부른다 (`wallpaper.svelte.ts` 의 고르기/지우기 경로).
 *
 * - 동적 테마가 꺼져 있으면 아무 일도 없다.
 * - 새 배경이 있으면 그것으로 다시 뽑는다.
 * - 배경이 사라졌으면(지우기·파일이 없어짐) 토글을 끄고 되돌린다 — 원본이 없는데 그 사진의
 *   색만 남아 있으면 사용자가 그 색이 어디서 왔는지 알 길이 없다.
 *
 * 앱 시작 경로에서는 부르지 **않는다**: 저장된 팔레트가 이미 있어 첫 프레임부터 맞는 색이고,
 * 켤 때마다 이미지를 다시 디코딩할 이유가 없다.
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
