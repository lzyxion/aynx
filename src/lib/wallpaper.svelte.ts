import { convertFileSrc, invoke, isRemote } from "./ipc";
import { WALLPAPER_EXTENSIONS, pickDeviceWallpaper, uploadWallpaper } from "./wallpaper-file";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  adoptWallpaperFile,
  emitSettingsSaved,
  settings,
  DEFAULT_WALLPAPER_FIT,
  type WallpaperFit,
} from "$lib/settings.svelte.js";
import { wallpaperChanged } from "$lib/dynamic-theme.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Reveal } from "$lib/theme-reveal";

const plainApply: Reveal = async (apply) => {
  await apply();
};

/**
 * 월페이퍼의 이미지 파일 쪽 (docs/log/2026-09-04-wallpaper.md).
 * 사본 이름은 내용 해시(`wp-<hex>.<확장자>`)라 캐시 무효화가 없다 — 같은 URL 은 언제나 같은 바이트다.
 * 그리는 이름은 파일이 아니라 화면의 설정이다 — 미저장 편집 중 프로필을 적용하면 설정 파일은 옛 이름 그대로다.
 * `[wallpaper]` 테이블은 언제나 원본으로 남는다 — 뽑아낸 색은 `[app]` · `[terminal.dynamic]` 쪽으로 간다.
 */

class WallpaperStore {
  /** 이번 실행에서만 뜻이 있는 `http://asset.localhost/...` — 저장되는 값이 아니라 `settings` 에 두지 않는다 */
  src = $state<string>("");
  busy = $state(false);
  /** `busy` 중 랜덤 월페이퍼를 받는 중인가 */
  fetching = $state(false);
  error = $state<string | null>(null);
  /** 그 사본(`file`)이 지금 걸려 있을 때만 "출처" 로 보인다 · 저장하지 않는다 */
  source = $state<{ file: string; url: string } | null>(null);
}

export const wallpaper = new WallpaperStore();

function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}

export async function wallpaperUrl(file: string | undefined): Promise<string> {
  if (!file) return "";
  try {
    const path = await invoke<string | null>("wallpaper_resolve", { file });
    return path ? convertFileSrc(path) : "";
  } catch {
    return "";
  }
}

/** 실패를 삼킨다 — 앱 시작 경로에서 불리므로 폴더를 못 읽어도 앱이 떠야 한다 */
export async function refreshWallpaper(): Promise<void> {
  const file = settings.current.wallpaper.file;
  try {
    const path = file ? await invoke<string | null>("wallpaper_resolve", { file }) : null;
    wallpaper.src = path ? convertFileSrc(path) : "";
    // 사용자가 폴더에서 파일만 지웠으면 설정의 이름도 털어 낸다
    if (!path && file) {
      adoptWallpaperFile(undefined);
      // 배경이 있는 경우에는 다시 뽑지 않는다 — 저장된 팔레트가 이미 맞는 색이다
      await wallpaperChanged("");
    }
  } catch (e) {
    wallpaper.src = "";
    console.warn("[aynx] 월페이퍼를 읽지 못했습니다 (무시):", describeError(e));
  }
}

/** 화면의 설정 이름을 하나 더 얹는다 — 파일에 아직 안 적힌 이름이 지워지면 [저장] 뒤 배경이 사라진다 */
export async function collectWallpapers(): Promise<void> {
  try {
    await invoke("wallpaper_gc", { keep: settings.current.wallpaper.file ?? null });
  } catch {
    // 청소는 다음 기회가 있다
  }
}

/** 원격 창의 고르기 창은 첫 `await` 앞에서 연다 — 몸짓 사슬(단추의 `onclick` 에서 여기까지 동기) */
export async function pickWallpaper(reveal: Reveal = plainApply, remoteWindow: boolean = isRemote): Promise<void> {
  if (wallpaper.busy) return;
  if (remoteWindow) {
    const picked = await pickDeviceWallpaper(t);
    if (picked === null) return;
    if ("error" in picked) {
      wallpaper.error = picked.error;
      return;
    }
    const file = picked.file;
    await applyCopy(() => uploadWallpaper(file), reveal);
    return;
  }
  let picked: string | string[] | null;
  try {
    picked = await openFileDialog({
      title: t("app.wallpaper.pick.title"),
      multiple: false,
      directory: false,
      filters: [{ name: t("app.wallpaper.pick.filter"), extensions: [...WALLPAPER_EXTENSIONS] }],
    });
  } catch (e) {
    wallpaper.error = t("app.wallpaper.pick.failed", { error: describeError(e) });
    return;
  }
  if (typeof picked !== "string") return;

  const source = picked;
  await applyCopy(() => invoke<string>("wallpaper_set", { source }), reveal);
}

export async function randomWallpaper(reveal: Reveal = plainApply): Promise<void> {
  if (wallpaper.busy) return;
  wallpaper.fetching = true;
  try {
    await applyCopy(async () => {
      const res = await invoke<{ path: string; source: string }>("wallpaper_random");
      wallpaper.source = { file: baseName(res.path), url: res.source };
      return res.path;
    }, reveal);
  } finally {
    wallpaper.fetching = false;
  }
}

export function openWallpaperSource(): void {
  const url = wallpaper.source?.url;
  if (!url) return;
  void openUrl(url).catch((e: unknown) => {
    wallpaper.error = describeError(e);
  });
}

/** 배경 갈아 끼우기와 색 다시 뽑기는 `reveal` 하나 안에서 한다 — 원 안의 새 화면이 새 사진 · 새 색을 함께 갖게 */
async function applyCopy(run: () => Promise<string>, reveal: Reveal): Promise<void> {
  wallpaper.busy = true;
  wallpaper.error = null;
  let dest: string;
  try {
    dest = await run();
  } catch (e) {
    wallpaper.error = describeError(e);
    wallpaper.busy = false;
    return;
  }
  const src = convertFileSrc(dest);
  try {
    await reveal(
      async () => {
        // 백엔드가 이미 `settings.toml` 에 썼다 — 저장하지 않는다
        adoptWallpaperFile(baseName(dest));
        wallpaper.src = src;
        wallpaper.busy = false;
        await wallpaperChanged(src);
      },
      { preload: src },
    );
  } catch (e) {
    wallpaper.error = describeError(e);
  } finally {
    wallpaper.busy = false;
  }
  // `saveSettings` 를 지나지 않는 경로라 저장 알림을 따로 보내야 다른 창의 배경이 따라온다
  if (!wallpaper.error) emitSettingsSaved();
}

export async function clearWallpaper(reveal: Reveal = plainApply): Promise<void> {
  if (wallpaper.busy) return;
  wallpaper.busy = true;
  wallpaper.error = null;
  try {
    await invoke("wallpaper_clear");
  } catch (e) {
    wallpaper.error = describeError(e);
    wallpaper.busy = false;
    return;
  }
  try {
    await reveal(async () => {
      adoptWallpaperFile(undefined);
      wallpaper.src = "";
      wallpaper.busy = false;
      await wallpaperChanged("");
    });
  } catch (e) {
    wallpaper.error = describeError(e);
  } finally {
    wallpaper.busy = false;
  }
  if (!wallpaper.error) emitSettingsSaved();
}

export interface WallpaperLayer {
  image: string;
  size: string;
  repeat: string;
  position: string;
  blur: string;
  /** 블러 가장자리 번짐을 감추는 확대 배율 */
  scale: string;
  dim: string;
}

function fitCss(fit: WallpaperFit): Pick<WallpaperLayer, "size" | "repeat" | "position"> {
  switch (fit) {
    case "contain":
      return { size: "contain", repeat: "no-repeat", position: "center" };
    case "tile":
      return { size: "auto", repeat: "repeat", position: "top left" };
    case "center":
      return { size: "auto", repeat: "no-repeat", position: "center" };
    case "cover":
    default:
      return { size: "cover", repeat: "no-repeat", position: "center" };
  }
}

/** 블러가 있으면 4% 확대한다 — `filter: blur()` 는 가장자리 바깥을 투명으로 섞어 테두리가 뿌옇게 빈다 */
export function wallpaperLayer(): WallpaperLayer {
  const src = wallpaper.src;
  const fit = (settings.wallpaperFit ?? DEFAULT_WALLPAPER_FIT) as WallpaperFit;
  const blur = settings.wallpaperBlur;
  return {
    image: src ? `url("${src}")` : "none",
    ...fitCss(fit),
    blur: `${blur}px`,
    scale: blur > 0 ? "1.04" : "1",
    dim: `rgba(0, 0, 0, ${(settings.wallpaperDim / 100).toFixed(3)})`,
  };
}
