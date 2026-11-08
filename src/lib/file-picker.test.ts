import { describe, expect, it } from "vitest";
import {
  filePickerRoot,
  filterFiles,
  listRemoteShallow,
  parentDir,
  textEntries,
  type PickerFile,
} from "$lib/file-picker";
import type { SftpEntry } from "$lib/sftp-browser";
import type { PaneNode } from "$lib/session";

const leaf = (pane: Record<string, unknown>): PaneNode => ({ type: "leaf", pane }) as unknown as PaneNode;
const noTab = null;

describe("parentDir", () => {
  it("구분자 둘 · 뿌리", () => {
    expect(parentDir(String.raw`C:\a\b.md`)).toBe(String.raw`C:\a`);
    expect(parentDir(String.raw`C:\b.md`)).toBe("C:\\");
    expect(parentDir("C:/b.md")).toBe("C:/");
    expect(parentDir("/srv/app/x.py")).toBe("/srv/app");
    expect(parentDir("/x.py")).toBe("/");
    expect(parentDir("x.py")).toBeNull();
  });
});

describe("filePickerRoot — 포커스된 타일 → 훑을 뿌리", () => {
  it("ssh 터미널 — 원격 · 셸 폴더(모르면 홈) · 원본은 그 터미널", () => {
    const ssh = { id: "p1", kind: "ssh" as const, alias: "web-01" };
    expect(filePickerRoot({ focused: ssh, focusedCwd: "/srv/app", tab: noTab })).toEqual({
      where: "remote",
      root: "/srv/app",
      source: { paneId: "p1", alias: "web-01" },
    });
    expect(filePickerRoot({ focused: ssh, focusedCwd: null, tab: noTab })).toMatchObject({ root: null });
  });

  it("SFTP 타일 — 보고 있는 폴더 · 원본은 빌리던 터미널 · 원본 없으면 null", () => {
    const sftp = { id: "p2", kind: "sftp" as const, alias: "web-01", sourcePaneId: "p1", path: "/old" };
    expect(filePickerRoot({ focused: sftp, sftpDir: "/var/www", tab: noTab })).toEqual({
      where: "remote",
      root: "/var/www",
      source: { paneId: "p1", alias: "web-01" },
    });
    expect(filePickerRoot({ focused: sftp, sftpDir: "", tab: noTab })).toMatchObject({ root: "/old" });
    expect(filePickerRoot({ focused: { ...sftp, sourcePaneId: undefined }, tab: noTab })).toBeNull();
  });

  it("문서 타일 — 그 파일의 폴더 (원격이면 빌리던 터미널)", () => {
    expect(filePickerRoot({ focused: { id: "d", kind: "doc", path: String.raw`C:\p\README.md` }, tab: noTab })).toEqual({
      where: "local",
      root: String.raw`C:\p`,
    });
    expect(
      filePickerRoot({ focused: { id: "d", kind: "doc", path: "/srv/a.md", alias: "db", sourcePaneId: "p9" }, tab: noTab }),
    ).toEqual({ where: "remote", root: "/srv", source: { paneId: "p9", alias: "db" } });
  });

  it("그 밖 — 새 터미널의 시작 폴더 규칙(셸 폴더 → 로컬 파일 폴더 → 프로젝트 → 홈)", () => {
    expect(filePickerRoot({ focused: { id: "l", kind: "local" }, focusedCwd: "D:\\w", tab: noTab })).toEqual({
      where: "local",
      root: "D:\\w",
    });
    expect(filePickerRoot({ focused: { id: "f", kind: "localfs", path: "E:\\x" }, tab: noTab })).toEqual({
      where: "local",
      root: "E:\\x",
    });
    const tab = { projectFolder: "C:\\proj", root: leaf({ id: "s", kind: "start" }) };
    expect(filePickerRoot({ focused: { id: "s", kind: "start" }, tab })).toEqual({ where: "local", root: "C:\\proj" });
    expect(filePickerRoot({ focused: null, tab: noTab })).toEqual({ where: "local", root: null });
  });
});

describe("textEntries · filterFiles", () => {
  const files: PickerFile[] = [
    { rel: "README.md", path: "/r/README.md" },
    { rel: "logo.png", path: "/r/logo.png" },
    { rel: "src/app.ts", path: "/r/src/app.ts" },
    { rel: "docs/api.md", path: "/r/docs/api.md" },
    { rel: "docs/deep/apple.txt", path: "/r/docs/deep/apple.txt" },
  ];

  it("텍스트로 보이는 것만 남긴다", () => {
    expect(textEntries(files).map((f) => f.rel)).toEqual(["README.md", "src/app.ts", "docs/api.md", "docs/deep/apple.txt"]);
  });

  it("빈 질의는 그대로 · 부분수열은 경로 전체에 · 이름이 맞는 줄이 위로", () => {
    const text = textEntries(files);
    expect(filterFiles(text, "")).toEqual(text);
    // `ap` — 이름이 ap 로 시작(app.ts · api.md · apple.txt)이 앞, 들어온 순서 유지
    expect(filterFiles(text, "ap").map((f) => f.rel)).toEqual(["src/app.ts", "docs/api.md", "docs/deep/apple.txt"]);
    // 폴더까지 좁힌다
    expect(filterFiles(text, "docs/a").map((f) => f.rel)).toEqual(["docs/api.md", "docs/deep/apple.txt"]);
    // 경로에만 걸리는 줄은 맨 뒤
    expect(filterFiles(text, "dp").map((f) => f.rel)).toEqual(["docs/api.md", "docs/deep/apple.txt"]);
    expect(filterFiles(text, "zzz")).toEqual([]);
    expect(filterFiles(text, "", 2)).toHaveLength(2);
  });
});

describe("listRemoteShallow — 뿌리 한 층 + 하위 폴더 한 층", () => {
  const e = (path: string, kind: SftpEntry["kind"], linkIsDir = false): SftpEntry =>
    ({ name: path.slice(path.lastIndexOf("/") + 1), path, kind, size: 0, mtime: null, mode: null, symlinkTarget: null, linkIsDir }) as SftpEntry;
  const tree: Record<string, SftpEntry[]> = {
    "/srv": [e("/srv/a.md", "file"), e("/srv/conf", "dir"), e("/srv/.git", "dir"), e("/srv/link", "symlink", true), e("/srv/broken", "dir")],
    "/srv/conf": [e("/srv/conf/x.conf", "file"), e("/srv/conf/deeper", "dir")],
    "/srv/link": [e("/srv/link/y.txt", "file")],
    "/srv/.git": [e("/srv/.git/HEAD", "file")],
  };
  const list = async (p: string) => {
    const got = tree[p];
    if (!got) throw new Error("no");
    return got;
  };

  it("두 층까지 · 건너뛸 폴더 제외 · 못 읽은 폴더는 잘림으로", async () => {
    const out = await listRemoteShallow(list, "/srv/");
    expect(out.files.map((f) => f.rel)).toEqual(["a.md", "conf/x.conf", "link/y.txt"]);
    expect(out.files[1].path).toBe("/srv/conf/x.conf");
    expect(out.truncated).toBe(true); // /srv/broken 을 못 읽었다
  });

  it("폴더 수 상한", async () => {
    const out = await listRemoteShallow(async (p) => (p === "/srv" ? tree["/srv"].slice(0, 2) : tree[p] ?? []), "/srv", 0);
    expect(out.files.map((f) => f.rel)).toEqual(["a.md"]);
    expect(out.truncated).toBe(true);
  });

  it("뿌리를 못 읽으면 던진다", async () => {
    await expect(listRemoteShallow(list, "/nope")).rejects.toThrow();
  });
});
