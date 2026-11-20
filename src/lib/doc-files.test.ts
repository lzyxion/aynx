import { describe, expect, it } from "vitest";
import { DOC_FILES_ROWS_MAX, acceptFilesSeed, folderRows, hasParent, samePath, type DocFilesSeed } from "$lib/doc-files";
import { winParentOf } from "$lib/fs-backend";
import { parentOf as posixParentOf, type SftpEntry } from "$lib/sftp-browser";

const e = (name: string, kind: SftpEntry["kind"], o: Partial<SftpEntry> = {}): SftpEntry => ({
  name,
  path: `/d/${name}`,
  kind,
  size: 0,
  mtime: null,
  mode: null,
  symlinkTarget: null,
  linkIsDir: false,
  hidden: false,
  ...o,
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("folderRows", () => {
  it("순서 `..` → 폴더 → 파일 · 이름은 자연순", () => {
    const out = folderRows(
      [e("b.md", "file"), e("web-10", "dir"), e("A.txt", "file"), e("web-2", "dir"), e("notes", "dir")],
      { parent: "/" },
    );
    expect(out.rows.map((r) => r.kind)).toEqual(["up", "dir", "dir", "dir", "file", "file"]);
    expect(names(out.rows)).toEqual(["..", "notes", "web-2", "web-10", "A.txt", "b.md"]);
    expect(out.rows[0].path).toBe("/");
    expect(out.more).toBe(0);
  });

  it("`parent` 가 없으면 `..` 줄도 없다", () => {
    expect(names(folderRows([e("a.md", "file")]).rows)).toEqual(["a.md"]);
    expect(names(folderRows([e("a.md", "file")], { parent: null }).rows)).toEqual(["a.md"]);
  });

  it("숨김(닷파일 · 숨김 속성)은 뺀다", () => {
    const out = folderRows([e(".git", "dir"), e(".env", "file"), e("x.md", "file", { hidden: true }), e("y.md", "file")]);
    expect(names(out.rows)).toEqual(["y.md"]);
  });

  it("심링크 폴더는 폴더 · 심링크 파일은 글 파일이면 파일", () => {
    const out = folderRows([e("lnk", "symlink", { linkIsDir: true }), e("l.md", "symlink"), e("l.bin", "symlink")]);
    expect(out.rows).toEqual([
      { kind: "dir", name: "lnk", path: "/d/lnk" },
      { kind: "file", name: "l.md", path: "/d/l.md" },
    ]);
  });

  it("그림 · 바이너리 · 그 밖 종류는 뺀다", () => {
    const out = folderRows([e("a.png", "file"), e("b.exe", "file"), e("sock.md", "other"), e("c.py", "file")]);
    expect(names(out.rows)).toEqual(["c.py"]);
  });

  it("상한 — 폴더가 먼저 자리를 갖고 `..` 는 세지 않는다", () => {
    const out = folderRows([e("z.md", "file"), e("d1", "dir"), e("d2", "dir"), e("a.md", "file")], { parent: "/", max: 3 });
    expect(names(out.rows)).toEqual(["..", "d1", "d2", "a.md"]);
    expect(out.more).toBe(1);
  });

  it("기본 상한은 500", () => {
    expect(DOC_FILES_ROWS_MAX).toBe(500);
    const many = Array.from({ length: 502 }, (_, i) => e(`f${i}.md`, "file"));
    const out = folderRows(many);
    expect(out.rows).toHaveLength(500);
    expect(out.more).toBe(2);
  });
});

describe("hasParent", () => {
  it("로컬 — 드라이브 뿌리 위는 내 PC(`\"\"`) · 내 PC 는 꼭대기", () => {
    expect(hasParent("C:\\Users", winParentOf)).toBe(true);
    expect(hasParent("C:\\", winParentOf)).toBe(true);
    expect(hasParent("", winParentOf)).toBe(false);
  });

  it("원격 — `/` 는 꼭대기", () => {
    expect(hasParent("/srv", posixParentOf)).toBe(true);
    expect(hasParent("/", posixParentOf)).toBe(false);
  });
});

describe("samePath", () => {
  it("`\\` 백엔드 — 구분자 섞임 · 꼬리 구분자 · 대소문자를 같게 본다", () => {
    expect(samePath("C:\\Notes\\a.md", "c:/notes/A.md", "\\")).toBe(true);
    expect(samePath("C:\\Notes\\", "C:/Notes", "\\")).toBe(true);
    expect(samePath("C:\\Notes\\a.md", "C:\\Notes\\b.md", "\\")).toBe(false);
  });

  it("`/` 백엔드 — 글자 그대로(대소문자 구분)", () => {
    expect(samePath("/srv/a.md", "/srv/a.md", "/")).toBe(true);
    expect(samePath("/srv/a.md", "/srv/A.md", "/")).toBe(false);
  });
});

describe("acceptFilesSeed", () => {
  const seed = (o: Partial<DocFilesSeed> = {}): DocFilesSeed => ({
    key: "local",
    dir: "/d",
    query: "a",
    active: 2,
    browse: { rows: [{ kind: "file", name: "a.md", path: "/d/a.md" }], more: 0 },
    browseFor: "/d",
    ready: true,
    scan: { state: "ready", root: "/d", files: [], truncated: false, shallow: false },
    scanFor: "local\n/d",
    scrollTop: 120,
    ...o,
  });

  it("같은 원본이면 그대로 받는다", () => {
    const s = seed();
    expect(acceptFilesSeed(s, "local")).toBe(s);
  });

  it("원본이 다르거나 없으면 받지 않는다", () => {
    expect(acceptFilesSeed(seed(), "ssh:web-01")).toBeNull();
    expect(acceptFilesSeed(null, "local")).toBeNull();
    expect(acceptFilesSeed(undefined, "local")).toBeNull();
  });

  it("훑는 중이던 찾기 자료는 `idle` 로 — 새 칸의 첫 읽기가 다시 훑는다(나머지는 그대로)", () => {
    const got = acceptFilesSeed(seed({ scan: { state: "scanning" } }), "local");
    expect(got?.scan).toEqual({ state: "idle" });
    expect(got?.query).toBe("a");
    expect(got?.scrollTop).toBe(120);
  });
});
