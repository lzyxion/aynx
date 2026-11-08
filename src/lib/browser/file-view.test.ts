import { describe, expect, it } from "vitest";
import {
  extBadge,
  folderSummary,
  folderSummaryText,
  gridStep,
  iconZoomScale,
  selectionSummary,
  stepIconZoom,
  usedRatio,
} from "$lib/browser/file-view";
import type { SftpEntry } from "$lib/sftp-browser";

function e(name: string, kind: SftpEntry["kind"] = "file", size = 0, extra: Partial<SftpEntry> = {}): SftpEntry {
  return { name, path: `/p/${name}`, kind, size, mtime: null, mode: null, symlinkTarget: null, linkIsDir: false, hidden: null, ...extra };
}

describe("gridStep — 아이콘 보기(줄 흐름)", () => {
  // 3칸 너비 · 8개: 0 1 2 / 3 4 5 / 6 7
  const step = (i: number, key: Parameters<typeof gridStep>[2]) => gridStep(8, i, key, "row", 3);

  it("←→ 는 한 칸 — 줄 끝에서 다음 줄로 이어지고 양끝에서 멈춘다", () => {
    expect(step(2, "ArrowRight")).toBe(3);
    expect(step(3, "ArrowLeft")).toBe(2);
    expect(step(7, "ArrowRight")).toBe(7);
    expect(step(0, "ArrowLeft")).toBe(0);
  });

  it("↑↓ 는 한 줄 — 위로 넘치면 제자리", () => {
    expect(step(1, "ArrowDown")).toBe(4);
    expect(step(4, "ArrowUp")).toBe(1);
    expect(step(1, "ArrowUp")).toBe(1);
  });

  it("짧은 마지막 줄 — 바로 아래가 비었으면 마지막 칸으로, 이미 마지막 줄이면 제자리", () => {
    expect(step(5, "ArrowDown")).toBe(7);
    expect(step(4, "ArrowDown")).toBe(7);
    expect(step(7, "ArrowDown")).toBe(7);
    expect(step(6, "ArrowDown")).toBe(6);
  });

  it("커서가 없으면 진행 방향의 첫 칸", () => {
    expect(step(-1, "ArrowDown")).toBe(0);
    expect(step(-1, "ArrowRight")).toBe(0);
    expect(step(-1, "ArrowUp")).toBe(7);
    expect(gridStep(0, -1, "ArrowDown", "row", 3)).toBe(-1);
  });
});

describe("gridStep — 간단히 보기(열 흐름)", () => {
  // 한 열에 4칸 · 10개: 열0 = 0..3, 열1 = 4..7, 열2 = 8 9
  const step = (i: number, key: Parameters<typeof gridStep>[2]) => gridStep(10, i, key, "column", 4);

  it("↑↓ 는 한 칸(열 끝에서 다음 열로), ←→ 는 한 열", () => {
    expect(step(3, "ArrowDown")).toBe(4);
    expect(step(4, "ArrowUp")).toBe(3);
    expect(step(1, "ArrowRight")).toBe(5);
    expect(step(5, "ArrowLeft")).toBe(1);
    expect(step(1, "ArrowLeft")).toBe(1);
  });

  it("오른쪽 열이 짧으면 그 열의 마지막 칸으로", () => {
    expect(step(6, "ArrowRight")).toBe(9);
    expect(step(9, "ArrowRight")).toBe(9);
  });
});

describe("아이콘 크기 · 확장자 배지", () => {
  it("단계 → 배율은 끝에서 자른다 · 휠은 한 단계씩 끝에서 멈춘다", () => {
    expect(iconZoomScale(1)).toBe(1);
    expect(iconZoomScale(-3)).toBe(iconZoomScale(0));
    expect(iconZoomScale(99)).toBe(iconZoomScale(4));
    expect(stepIconZoom(1, 120)).toBe(2);
    expect(stepIconZoom(1, -120)).toBe(0);
    expect(stepIconZoom(4, 1)).toBe(4);
    expect(stepIconZoom(0, -1)).toBe(0);
  });

  it("확장자 배지 — 점으로 시작하는 이름 · 긴 꼬리 · 점 없음은 배지가 없다", () => {
    expect(extBadge("report.pdf")).toBe("PDF");
    expect(extBadge("archive.tar.gz")).toBe("GZ");
    expect(extBadge(".gitignore")).toBeNull();
    expect(extBadge("Makefile")).toBeNull();
    expect(extBadge("trailing.")).toBeNull();
    expect(extBadge("x.backup2026")).toBeNull();
  });
});

describe("상태 줄 요약", () => {
  const list = [
    e("src", "dir"),
    e("link", "symlink", 0, { linkIsDir: true }),
    e("a.txt", "file", 100),
    e("b.bin", "file", 2048),
    e(".env", "file", 7),
    e("Thumbs.db", "file", 9, { hidden: true }),
  ];

  it("폴더(링크된 폴더 포함) · 파일 · 크기 합 · 안 보이는 숨김 수", () => {
    expect(folderSummary(list, false)).toEqual({ folders: 2, files: 2, bytes: 2148, hidden: 2 });
    expect(folderSummary(list, true)).toEqual({ folders: 2, files: 4, bytes: 2164, hidden: 0 });
    expect(folderSummary([], false)).toEqual({ folders: 0, files: 0, bytes: 0, hidden: 0 });
  });

  it("선택 — 하나면 그 항목, 여럿이면 파일 크기만 더한다", () => {
    expect(selectionSummary([list[2]])).toEqual({ count: 1, bytes: 100, single: list[2] });
    expect(selectionSummary([list[0], list[2], list[3]])).toEqual({ count: 3, bytes: 2148, single: null });
    expect(selectionSummary([])).toEqual({ count: 0, bytes: 0, single: null });
  });

  it("쓴 몫 — 0…1 로 자른다", () => {
    expect(usedRatio({ free: 25, total: 100 })).toBe(0.75);
    expect(usedRatio({ free: 0, total: 0 })).toBe(0);
    expect(usedRatio({ free: 200, total: 100 })).toBe(0);
  });
});

describe("folderSummaryText — 상태 줄 · 미리 보기 패널의 한 줄", () => {
  const tr = (key: string, p: Record<string, string | number> = {}) => `${key.slice(13)}(${Object.values(p).join("/")})`;
  const size = (b: number) => `${b}B`;

  it("있는 것만 잇고 숨김은 뒤에 · 비었으면 empty", () => {
    expect(folderSummaryText({ folders: 2, files: 3, bytes: 10, hidden: 1 }, tr, size)).toBe(
      "folders(2), files(3/10B) · hidden(1)",
    );
    expect(folderSummaryText({ folders: 0, files: 1, bytes: 4, hidden: 0 }, tr, size)).toBe("files(1/4B)");
    expect(folderSummaryText({ folders: 0, files: 0, bytes: 0, hidden: 2 }, tr, size)).toBe("empty() · hidden(2)");
  });
});
