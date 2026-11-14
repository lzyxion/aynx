import { describe, expect, it } from "vitest";
import type { SftpEntry } from "$lib/sftp-browser";
import { imageBaseName, imageSiblings, neighborPath, siblingCounter, withoutCurrent, withoutEntry } from "./neighbors";

function entry(name: string, extra: Partial<SftpEntry> = {}): SftpEntry {
  return {
    name,
    path: `C:\\pics\\${name}`,
    kind: "file",
    size: 1,
    mtime: null,
    mode: null,
    symlinkTarget: null,
    linkIsDir: false,
    hidden: false,
    ...extra,
  };
}

// 백엔드 목록 차례 그대로(폴더 먼저 · 이름순) — 여기서 다시 정렬하지 않는다
const listing = [
  entry("album", { kind: "dir" }),
  entry("a.png"),
  entry("b.txt"),
  entry("c.JPG"),
  entry(".hidden.png", { hidden: true }),
  entry("d.svg"),
  entry("link", { kind: "symlink", linkIsDir: true }),
];

describe("imageSiblings — 같은 폴더의 그림만, 목록 차례 그대로", () => {
  it("그림만 남기고(폴더 · 글 · 폴더 링크 · 숨김 제외) 지금 자리를 이름으로 찾는다", () => {
    const s = imageSiblings(listing, "C:/pics/c.JPG", true);
    expect(s.list.map((e) => e.name)).toEqual(["a.png", "c.JPG", "d.svg"]);
    expect(s.index).toBe(1);
  });
  it("로컬은 대소문자를 가리지 않고 한 번 더 찾는다 · 원격은 가린다", () => {
    expect(imageSiblings(listing, "C:\\pics\\C.jpg", true).index).toBe(1);
    expect(imageSiblings(listing, "/pics/C.jpg", false).index).toBe(-1);
  });
  it("지금 그림이 숨김이면 그것만은 남긴다", () => {
    const s = imageSiblings(listing, "C:\\pics\\.hidden.png", true);
    expect(s.list.map((e) => e.name)).toEqual(["a.png", "c.JPG", ".hidden.png", "d.svg"]);
    expect(s.index).toBe(2);
  });
});

describe("neighborPath · siblingCounter — 끝에서 멈춘다", () => {
  const s = imageSiblings(listing, "C:\\pics\\a.png", true);
  it("처음에서 이전은 없고 다음은 있다", () => {
    expect(neighborPath(s, -1)).toBeNull();
    expect(neighborPath(s, 1)).toBe("C:\\pics\\c.JPG");
  });
  it("끝에서 다음은 없다(순환하지 않는다)", () => {
    const last = imageSiblings(listing, "C:\\pics\\d.svg", true);
    expect(neighborPath(last, 1)).toBeNull();
    expect(neighborPath(last, -1)).toBe("C:\\pics\\c.JPG");
  });
  it("자리를 모르면 이웃도 없다 · 칸은 둘 이상일 때만", () => {
    const lost = imageSiblings(listing, "C:\\pics\\gone.png", true);
    expect(neighborPath(lost, 1)).toBeNull();
    expect(siblingCounter(lost)).toBeNull();
    expect(siblingCounter(s)).toEqual({ at: 1, total: 3 });
    expect(siblingCounter(imageSiblings([entry("only.png")], "C:\\pics\\only.png", true))).toBeNull();
  });
  it("지금 그림이 없어지면 빼고 빈자리 양옆으로 간다 — 사라진 그림은 세지 않는다", () => {
    const at = imageSiblings(listing, "C:\\pics\\c.JPG", true);
    const gone = withoutCurrent(at, "C:\\pics\\c.JPG");
    expect(gone.list.map((e) => e.name)).toEqual(["a.png", "d.svg"]);
    expect(siblingCounter(gone)).toBeNull();
    expect(neighborPath(gone, -1)).toBe("C:\\pics\\a.png");
    expect(neighborPath(gone, 1)).toBe("C:\\pics\\d.svg");
    // 맨 앞 · 맨 끝이 사라지면 한쪽만
    const first = withoutCurrent(s, "C:\\pics\\a.png");
    expect(neighborPath(first, -1)).toBeNull();
    expect(neighborPath(first, 1)).toBe("C:\\pics\\c.JPG");
  });
  it("이미 빠진 목록(폴더를 다시 읽음)이면 이름이 들어갈 자리가 빈자리다", () => {
    const relisted = imageSiblings(
      listing.filter((e) => e.name !== "c.JPG"),
      "C:\\pics\\c.JPG",
      true,
    );
    expect(relisted.index).toBe(-1);
    const gone = withoutCurrent(relisted, "C:\\pics\\c.JPG");
    expect(gone.gap).toBe(1);
    expect(neighborPath(gone, -1)).toBe("C:\\pics\\a.png");
    expect(neighborPath(gone, 1)).toBe("C:\\pics\\d.svg");
    expect(siblingCounter(gone)).toBeNull();
  });
  it("이름 조각", () => {
    expect(imageBaseName("/srv/a/b.png")).toBe("b.png");
    expect(imageBaseName("C:\\a\\b.png")).toBe("b.png");
  });
});

describe("withoutEntry — 없어진 그림을 폴더 목록 캐시에서 뺀다", () => {
  it("그 항목만 빠지고 다른 그림으로 옮겨도 다시 세지 않는다", () => {
    const cached = withoutEntry(listing, "C:/pics/c.JPG", true);
    expect(cached.map((e) => e.name)).not.toContain("c.JPG");
    expect(cached).toHaveLength(listing.length - 1);
    // c 가 지워진 뒤 d 로 옮겼다 — 3 장이 아니라 2 장이고, ← 는 지운 c 가 아니라 a 로
    const atD = imageSiblings(cached, "C:/pics/d.svg", true);
    expect(siblingCounter(atD)).toEqual({ at: 2, total: 2 });
    expect(neighborPath(atD, -1)).toBe("C:\\pics\\a.png");
  });
  it("로컬이면 대소문자를 가리지 않고, 원격이면 가린다", () => {
    expect(withoutEntry(listing, "C:/pics/C.jpg", true)).toHaveLength(listing.length - 1);
    expect(withoutEntry(listing, "/pics/C.jpg", false)).toBe(listing);
  });
  it("목록에 없으면 받은 배열 그대로", () => {
    expect(withoutEntry(listing, "C:/pics/zzz.png", true)).toBe(listing);
  });
});
