import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { translate } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import { REMOTE_RAW_MAX_BYTES } from "$lib/ipc";
import { fakeFileInput } from "../test/fake-file-input";
import { WALLPAPER_ACCEPT, WALLPAPER_EXTENSIONS, WALLPAPER_MAX_BYTES, pickDeviceWallpaper, uploadWallpaper } from "./wallpaper-file";

const tr = (k: Key, p?: Record<string, string | number>) => translate("ko", k, p);
const MiB = 1024 * 1024;

/** 크기만 뜻이 있는 가짜 File — 큰 바이트를 실제로 만들지 않는다 */
function sized(name: string, size: number): File {
  return { name, size } as unknown as File;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("배경 그림 — 받는 확장자", () => {
  it("Rust `ALLOWED_EXTS` 와 같은 목록 · accept 는 그 목록 그대로", () => {
    expect([...WALLPAPER_EXTENSIONS]).toEqual(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
    expect(WALLPAPER_ACCEPT).toBe(".png,.jpg,.jpeg,.webp,.gif,.bmp");
    expect(WALLPAPER_MAX_BYTES).toBe(50 * MiB);
  });
});

describe("pickDeviceWallpaper — 원격 창은 이 기기의 고르기 창(그림 하나)", () => {
  it("같은 틱에 칸을 누른다(몸짓 사슬) · 하나만 · 그림 accept · 메인 PC 대화상자는 부르지 않는다", async () => {
    const f = new File([new Uint8Array([1, 2, 3])], "바다.png");
    const seen = fakeFileInput({ files: [f] });
    const pending = pickDeviceWallpaper(tr);
    expect(seen.clicked).toBe(1);
    expect(await pending).toEqual({ file: f });
    expect(seen.input).toMatchObject({ type: "file", multiple: false, accept: WALLPAPER_ACCEPT });
    expect(seen.removed).toBe(1);
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("취소하면 null(아무 일 없음)", async () => {
    fakeFileInput("cancel");
    expect(await pickDeviceWallpaper(tr)).toBeNull();
  });

  it("원격 창 상한(15MB)까지는 통과", async () => {
    const f = sized("a.jpg", REMOTE_RAW_MAX_BYTES);
    fakeFileInput({ files: [f] });
    expect(await pickDeviceWallpaper(tr)).toEqual({ file: f });
  });

  it("넘으면 올리지 않고 파일 타일 올리기와 같은 원격 창 문구", async () => {
    const size = REMOTE_RAW_MAX_BYTES + 1;
    fakeFileInput({ files: [sized("big.png", size)] });
    const got = await pickDeviceWallpaper(tr);
    expect(got).toEqual({ error: tr("files.transfer.toobig.device.upload", { size: "15.0MB", max: "15MB" }) });
    expect(got && "error" in got && got.error).toContain("원격 창에서는 15MB 까지 올릴 수 있습니다");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("uploadWallpaper — wallpaper_set_bytes 계약", () => {
  it("raw 바디 = 그림 바이트 · 헤더 x-file-name = encodeURIComponent(이름) · 돌려준 사본 경로 그대로", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("C:/cfg/wallpapers/wp-0a1b.png");
    const f = new File([new Uint8Array([9, 8, 7])], "바다 1.png");
    expect(await uploadWallpaper(f)).toBe("C:/cfg/wallpapers/wp-0a1b.png");
    expect(invoke).toHaveBeenCalledWith("wallpaper_set_bytes", new Uint8Array([9, 8, 7]), {
      headers: { "x-file-name": encodeURIComponent("바다 1.png") },
    });
  });
});
