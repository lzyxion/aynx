import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fitWithin,
  thumbable,
  thumbEdge,
  thumbKey,
  thumbMaxBytes,
  THUMB_NET_MAX_BYTES,
} from "$lib/browser/thumbs";
import { PREVIEW_MAX_BYTES } from "$lib/browser/preview";
import type { SftpEntry } from "$lib/sftp-browser";

function e(name: string, kind: SftpEntry["kind"] = "file", size = 10, extra: Partial<SftpEntry> = {}): SftpEntry {
  return { name, path: `/p/${name}`, kind, size, mtime: null, mode: null, symlinkTarget: null, linkIsDir: false, hidden: null, ...extra };
}

describe("아이콘 보기 그림 칸 — 대상 · 상한", () => {
  it("로컬 타일을 메인 PC 에서 볼 때만 20 MB, 원격 타일 · 원격 창은 2 MB", () => {
    expect(thumbMaxBytes(true, false)).toBe(PREVIEW_MAX_BYTES);
    expect(thumbMaxBytes(true, true)).toBe(THUMB_NET_MAX_BYTES);
    expect(thumbMaxBytes(false, false)).toBe(THUMB_NET_MAX_BYTES);
    expect(thumbMaxBytes(false, true)).toBe(THUMB_NET_MAX_BYTES);
  });

  it("그림 파일만 · 폴더와 폴더 링크는 아니다 · 상한은 포함 · 빈 파일은 아니다", () => {
    const max = THUMB_NET_MAX_BYTES;
    expect(thumbable(e("a.png"), max)).toBe(true);
    expect(thumbable(e("a.SVG"), max)).toBe(true);
    expect(thumbable(e("a.txt"), max)).toBe(false);
    expect(thumbable(e("pics.png", "dir"), max)).toBe(false);
    expect(thumbable(e("pics.png", "symlink", 10, { linkIsDir: true }), max)).toBe(false);
    expect(thumbable(e("ln.png", "symlink"), max)).toBe(true);
    expect(thumbable(e("a.png", "file", max), max)).toBe(true);
    expect(thumbable(e("a.png", "file", max + 1), max)).toBe(false);
    expect(thumbable(e("a.png", "file", 0), max)).toBe(false);
  });

  it("열쇠는 백엔드 · 경로 · 수정 시각 · 크기가 다 같아야 같다", () => {
    const a = e("a.png", "file", 10, { mtime: 1 });
    expect(thumbKey("local", a)).toBe(thumbKey("local", { ...a }));
    expect(thumbKey("local", a)).not.toBe(thumbKey("ssh:2", a));
    expect(thumbKey("local", a)).not.toBe(thumbKey("local", { ...a, mtime: 2 }));
    expect(thumbKey("local", a)).not.toBe(thumbKey("local", { ...a, size: 11 }));
  });
});

describe("아이콘 보기 그림 칸 — 줄이는 크기", () => {
  it("가장 큰 단계(36 × 1.75)를 화면 픽셀로 덮고 256 을 넘지 않는다", () => {
    expect(thumbEdge(1)).toBe(63);
    expect(thumbEdge(2)).toBe(126);
    expect(thumbEdge(0)).toBe(63);
    expect(thumbEdge(Number.NaN)).toBe(63);
    expect(thumbEdge(8)).toBe(256);
  });

  it("비율 그대로 긴 변만 맞추고 작은 그림은 키우지 않는다", () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ w: 100, h: 50 });
    expect(fitWithin(300, 3000, 100)).toEqual({ w: 10, h: 100 });
    expect(fitWithin(40, 20, 100)).toEqual({ w: 40, h: 20 });
    expect(fitWithin(5000, 1, 100)).toEqual({ w: 100, h: 1 });
  });

  it("글리프 바탕 크기가 theme.css 의 --tile-icon-size 와 같다", () => {
    const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
    expect(/--tile-icon-size:\s*36px/.test(css)).toBe(true);
  });
});
