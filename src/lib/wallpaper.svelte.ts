import { convertFileSrc, invoke } from "./ipc";
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

/** 효과 없이 곧바로 적용 — 고르기 · 지우기에 `reveal` 을 넘기지 않았을 때 */
const plainApply: Reveal = async (apply) => {
  await apply();
};

/**
 * 월페이퍼 — **파일**을 다루는 쪽 (docs/log/2026-09-04-wallpaper.md).
 *
 * `settings.svelte.ts` 는 `[wallpaper]` 의 **값**(어둡게·블러·배치)을 들고 있고, 이 모듈은
 * 그 값이 가리키는 **이미지 파일**을 다룬다 — 고르기·지우기·웹뷰가 읽을 URL 만들기.
 *
 * ## 왜 URL 을 상태로 들고 있나
 *
 * `settings.current.wallpaper.file` 은 파일 **이름**이라 그것만으로는 못 그린다. 그릴 수
 * 있는 것은 `convertFileSrc(<절대 경로>)` 가 만든 `http://asset.localhost/...` 뿐이고,
 * 절대 경로를 아는 쪽은 백엔드다(`<config_dir>` 위치는 OS마다 다르다). 그래서 명령을
 * 한 번 다녀와 나온 URL 을 여기 담아 두고, 배경 레이어가 그것을 구독한다.
 *
 * ## 캐시 무효화는 없다 — 이름이 곧 내용이다
 *
 * 예전에는 사본 이름이 `wallpaper.<확장자>` 로 **고정**이라 다른 사진으로 바꿔도 URL 이 그대로여서
 * `?v=<증가하는 수>` 를 붙였다. 이제 사본 이름은 내용 해시(`wp-<hex>.<확장자>`)라 사진이 바뀌면
 * URL 이 바뀌고, 같은 URL 은 언제나 같은 바이트다 (옛 이름도 이제 다시 쓰이지 않는다) —
 * docs/log/2026-09-28-profile-cards-wallpapers.md. 덤으로 같은 사진이면 URL 이 같아 은은하게의
 * 틴트 캐시(`dynamic-theme.svelte.ts`)가 다시 디코딩하지 않는다.
 *
 * ## 어느 이름을 그리나 — **화면의 설정**
 *
 * `refreshWallpaper` 는 파일이 아니라 `settings.current.wallpaper.file` 을 들고 백엔드에 절대
 * 경로를 묻는다(`wallpaper_resolve`). 부팅·창 사이 전파에서는 둘이 같은 값이고, 다른 것은
 * **설정 화면에 미저장 변경이 있을 때 프로필을 적용**한 경우뿐이다 — 그때 설정 파일은 옛 이름
 * 그대로라 파일을 읽으면 사진이 안 바뀐다. [취소] 는 이름을 되돌린 뒤 이 함수를 다시 부른다.
 *
 * ## 색 추출과의 관계 (docs/log/2026-09-04-dynamic-color.md)
 *
 * 이 모듈은 **파일**을, `dynamic-theme.svelte.ts` 는 그 파일이 만든 **픽셀**을 다룬다.
 * 여기서 하는 일은 배경이 바뀔 때마다 `wallpaperChanged(<새 URL>)` 을 한 번 부르는 것뿐이고,
 * 그 함수는 동적 테마가 꺼져 있으면 곧바로 돌아온다. `[wallpaper]` 테이블은 손대지 않고
 * 언제나 **원본**으로 남는다 — 뽑아낸 색은 `[app]` 과 `[terminal.dynamic]` 쪽으로 간다.
 *
 * 화살표가 한 방향인 것이 요점이다 (이쪽 → 저쪽). 그래서 `dynamic-theme` 은 이 모듈을
 * import 하지 않고 URL 문자열만 받는다 — 순환 import 가 생기지 않는다.
 */

class WallpaperStore {
  /**
   * 배경 레이어가 그릴 URL (`http://asset.localhost/...`). 배경이 없으면 빈 문자열.
   *
   * `settings` 가 아니라 여기 사는 이유: 저기는 `settings.toml` 과 1:1인 **저장되는 값**만
   * 담고, 이것은 그 값에서 파생된 **이번 실행에서만 뜻이 있는** 문자열이다.
   */
  src = $state<string>("");
  /** 이미지를 고르거나 지우는 중 — 설정 화면이 버튼을 잠근다 (파일 복사는 느릴 수 있다) */
  busy = $state(false);
  /** `busy` 중 랜덤 월페이퍼를 받는 중인가 — 버튼 문구를 가른다 (네트워크라 오래 걸릴 수 있다) */
  fetching = $state(false);
  /** 마지막 실패 (한국어). 성공하면 지워진다 */
  error = $state<string | null>(null);
  /**
   * 마지막으로 받은 랜덤 월페이퍼의 원본 게시물 — **그 사본이 지금 걸려 있을 때만** 설정 화면이
   * "출처" 로 보인다(`file` 로 맞춰 본다). 저장하지 않는다: 앱을 다시 켜면 사라진다.
   */
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

/** 절대 경로에서 파일 이름 한 조각만 (`C:\...\wallpaper.jpg` → `wallpaper.jpg`) */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}

/**
 * 사본 이름 하나 → 웹뷰가 그릴 URL. 이름이 없거나 사본이 없으면 빈 문자열.
 *
 * 설정 화면의 프로필 카드가 **각 프로필의** 배경을 미리 그릴 때도 이 길을 쓴다. 실패를
 * 삼킨다 — 못 읽으면 없는 것과 같다.
 */
export async function wallpaperUrl(file: string | undefined): Promise<string> {
  if (!file) return "";
  try {
    const path = await invoke<string | null>("wallpaper_resolve", { file });
    return path ? convertFileSrc(path) : "";
  } catch {
    return "";
  }
}

/**
 * 화면의 설정이 가리키는 사본을 물어 `src` 를 다시 만든다 (머리말 "어느 이름을 그리나").
 *
 * **실패를 삼킨다** — 앱 시작 경로(`loadSettings` 직후)에서 불리므로, 명령이 없거나
 * 폴더를 못 읽는다고 해서 앱이 못 뜨면 안 된다. 그런 경우 배경 없이 시작한다.
 */
export async function refreshWallpaper(): Promise<void> {
  const file = settings.current.wallpaper.file;
  try {
    const path = file ? await invoke<string | null>("wallpaper_resolve", { file }) : null;
    wallpaper.src = path ? convertFileSrc(path) : "";
    // 백엔드가 "없다" 고 하면 설정의 이름도 털어 낸다 — 사용자가 폴더에서 파일만 지웠을 때
    // 화면과 파일이 어긋난 채로 남지 않게 한다.
    if (!path && file) {
      adoptWallpaperFile(undefined);
      // 원본이 사라진 사진의 색만 남아 있으면 사용자가 그 색의 출처를 알 길이 없다.
      // (배경이 **있는** 경우에는 다시 뽑지 않는다 — 저장된 팔레트가 이미 맞는 색이다.)
      await wallpaperChanged("");
    }
  } catch (e) {
    wallpaper.src = "";
    console.warn("[aynx] 월페이퍼를 읽지 못했습니다 (무시):", describeError(e));
  }
}

/**
 * 아무도 가리키지 않는 사본을 백엔드에 지우게 한다 (`wallpaper_gc`).
 *
 * 백엔드는 설정 파일과 `theme-profiles.json` 을 읽어 참조를 모으고, 여기서는 **화면의 설정**
 * 이름을 하나 더 얹는다 — 미저장 편집 중에 프로필을 적용해 파일에 아직 안 적힌 이름이 지워지면
 * [저장] 뒤 배경이 사라진다. 실패는 삼킨다 (청소는 다음 기회가 있다).
 */
export async function collectWallpapers(): Promise<void> {
  try {
    await invoke("wallpaper_gc", { keep: settings.current.wallpaper.file ?? null });
  } catch {
    // 명령이 없는 환경 — 청소를 건너뛴다.
  }
}

/**
 * 파일 탐색기를 열어 이미지를 고르고 **앱 폴더로 복사**한다 (`wallpaper_set`).
 *
 * 취소하면 아무 일도 없다. 실패는 `wallpaper.error` 로 설정 화면에 남는다 —
 * 여기서만 삼키지 않는 이유는 사용자가 방금 누른 버튼의 결과이기 때문이다.
 *
 * `reveal` — 누른 자리에서 원으로 퍼지는 전환(`theme-reveal.ts`)을 설정 화면이 넘긴다. 사본이 생긴 뒤 새 그림을 디코딩하고
 * 그 안에서 배경을 갈아 끼운다(아래 `applyCopy`).
 */
export async function pickWallpaper(reveal: Reveal = plainApply): Promise<void> {
  if (wallpaper.busy) return;
  let picked: string | string[] | null;
  try {
    picked = await openFileDialog({
      title: t("app.wallpaper.pick.title"),
      multiple: false,
      directory: false,
      filters: [
        { name: t("app.wallpaper.pick.filter"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
      ],
    });
  } catch (e) {
    wallpaper.error = t("app.wallpaper.pick.failed", { error: describeError(e) });
    return;
  }
  if (typeof picked !== "string") return;

  const source = picked;
  await applyCopy(() => invoke<string>("wallpaper_set", { source }), reveal);
}

/**
 * konachan.net 에서 16:9 · 1920×1080 이상 그림 하나를 받아 **곧바로 건다** (`wallpaper_random`,
 * docs/log/2026-10-01-random-wallpaper.md). 받은 뒤의 길은 [이미지 선택…] 과 같다 — 사본 이름을
 * 되받고, 색을 다시 뽑고, 다른 창에 알린다. 실패는 `wallpaper.error` 로 설정 화면에 남는다.
 */
export async function randomWallpaper(reveal: Reveal = plainApply): Promise<void> {
  if (wallpaper.busy) return;
  wallpaper.fetching = true;
  try {
    await applyCopy(async () => {
      const res = await invoke<{ path: string; source: string }>("wallpaper_random");
      // 출처는 사본 이름과 짝지어 둔다 — 화면은 그 이름이 걸려 있을 때만 보인다.
      wallpaper.source = { file: baseName(res.path), url: res.source };
      return res.path;
    }, reveal);
  } finally {
    wallpaper.fetching = false;
  }
}

/** 랜덤 월페이퍼의 원본 게시물을 시스템 기본 브라우저로 연다 (포워드 열기와 같은 `openUrl`). */
export function openWallpaperSource(): void {
  const url = wallpaper.source?.url;
  if (!url) return;
  void openUrl(url).catch((e: unknown) => {
    wallpaper.error = describeError(e);
  });
}

/**
 * 백엔드가 사본을 만들고 설정에 건 뒤(`run` 이 사본의 절대 경로를 돌려준다) 화면을 맞춘다 —
 * [이미지 선택…] 과 [랜덤 월페이퍼] 가 함께 지나는 끝.
 *
 * 배경 갈아 끼우기와 동적 색 다시 뽑기는 `reveal` 하나 안에서 한다 — 원 안의 새 화면이 새 사진 · 새 색을 함께 갖게.
 * 새 그림은 전환 전에 디코딩한다(`preload`).
 */
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
        // 백엔드가 이미 `settings.toml` 에 썼다 — 상태를 그 사실에 맞춘다(저장 필요 없음).
        adoptWallpaperFile(baseName(dest));
        wallpaper.src = src;
        wallpaper.busy = false;
        // 동적 테마가 켜져 있으면 **새 사진으로 다시 뽑는다** (꺼져 있으면 아무 일도 없다).
        // 파일 복사가 실패했으면 여기 오지 않는다 — `wallpaper.src` 는 이전 사진 그대로라 다시 뽑을 것이 없다.
        // 실패는 각자 자기 자리에 남는다 (파일 오류는 `wallpaper.error`, 추출 오류는 `dynamicTheme.error`).
        await wallpaperChanged(src);
      },
      { preload: src },
    );
  } catch (e) {
    wallpaper.error = describeError(e);
  } finally {
    wallpaper.busy = false;
  }
  // 다른 창에도 알린다 (docs/log/2026-09-05-settings-sync.md). 이 경로는 `saveSettings` 를
  // 지나지 않는다 — `wallpaper_set` 이 백엔드에서 `settings.toml` 을 직접 썼기 때문이다.
  // 그래서 저장 알림도 여기서 따로 보내야 다른 창의 배경이 따라온다.
  if (!wallpaper.error) emitSettingsSaved();
}

/**
 * 배경을 뗀다 — 설정의 이름을 비운다 (`wallpaper_clear`; 아무도 안 가리키는 사본은 백엔드 GC 가 지운다).
 * `reveal` 은 [`pickWallpaper`] 와 같다 — 백엔드가 지운 뒤 화면을 바꾸는 순간만 감싼다.
 */
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
      // 배경이 사라졌으면 동적 테마도 끈다 (켜져 있었을 때만) — 위 `pickWallpaper` 와 같은 규칙.
      await wallpaperChanged("");
    });
  } catch (e) {
    wallpaper.error = describeError(e);
  } finally {
    wallpaper.busy = false;
  }
  // `wallpaper_clear` 도 백엔드가 `settings.toml` 을 직접 쓰는 경로라 저장 알림을 따로 보낸다.
  if (!wallpaper.error) emitSettingsSaved();
}

/** 배경 레이어에 그대로 꽂을 CSS 값 묶음 (`+page.svelte` 의 `.wallpaper` 가 인라인한다) */
export interface WallpaperLayer {
  /** `background-image` — 없으면 레이어 자체를 안 그린다 */
  image: string;
  size: string;
  repeat: string;
  position: string;
  /** `filter: blur(...)` 에 들어갈 값 (`"0px"` 이면 필터를 안 건다) */
  blur: string;
  /** 블러 가장자리 번짐을 감추는 확대 배율 */
  scale: string;
  /** 이미지 위에 덮는 검정 (`rgba(0,0,0,α)`) */
  dim: string;
}

/**
 * 배치 키 → CSS 3종. **CSS 를 아는 곳은 여기 하나**다 — 설정 값(`cover`…)이 화면에
 * 어떤 모양이 되는지가 한 함수 안에 다 보인다.
 */
function fitCss(fit: WallpaperFit): Pick<WallpaperLayer, "size" | "repeat" | "position"> {
  switch (fit) {
    case "contain":
      return { size: "contain", repeat: "no-repeat", position: "center" };
    case "tile":
      // 원본 픽셀 그대로 바둑판 — 작은 패턴 이미지를 위한 배치다.
      return { size: "auto", repeat: "repeat", position: "top left" };
    case "center":
      return { size: "auto", repeat: "no-repeat", position: "center" };
    case "cover":
    default:
      return { size: "cover", repeat: "no-repeat", position: "center" };
  }
}

/**
 * 지금 설정으로 그려야 할 배경 레이어. `src` 가 비면 `image` 가 `"none"` 이고,
 * 호출부는 그때 레이어를 아예 렌더하지 않는다 (DOM 노드 하나도 안 남긴다).
 *
 * 블러가 있으면 4% 확대한다: `filter: blur()` 는 요소 **가장자리 바깥을 투명으로 보고**
 * 섞어서 테두리가 뿌옇게 비는데, 살짝 키워 그 띠를 화면 밖으로 밀어낸다.
 */
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
