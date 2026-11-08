import { describe, expect, it } from "vitest";
import {
  fileUrlToLocalPath,
  findPathLinks,
  joinHome,
  joinNormalize,
  oscLinkAction,
  resolvePathLink,
  type PathLinkPlace,
} from "$lib/path-links";
import { wslCwdToWindows } from "$lib/shell-integration";

const paths = (text: string) => findPathLinks(text).map((m) => m.path);

describe("findPathLinks — 잡는 모양", () => {
  it("절대 경로 셋(윈도우 · UNC · POSIX)과 홈", () => {
    expect(paths(String.raw`open C:\Users\me\notes.md now`)).toEqual([String.raw`C:\Users\me\notes.md`]);
    expect(paths("see C:/proj/README.md")).toEqual(["C:/proj/README.md"]);
    expect(paths(String.raw`\\server\share\a.txt`)).toEqual([String.raw`\\server\share\a.txt`]);
    expect(paths("cat /etc/nginx/nginx.conf")).toEqual(["/etc/nginx/nginx.conf"]);
    expect(findPathLinks("vim ~/notes.md")[0]).toMatchObject({ path: "~/notes.md", form: "home" });
  });

  it("상대 경로 — 구분자가 있거나 점 있는 맨 이름", () => {
    expect(findPathLinks("./x.md ../y.txt docs/a.md src\\b.ts").map((m) => [m.path, m.form])).toEqual([
      ["./x.md", "rel"],
      ["../y.txt", "rel"],
      ["docs/a.md", "rel"],
      ["src\\b.ts", "rel"],
    ]);
    // `ls` 출력 — 맨 이름
    expect(paths("Cargo.toml  README.md  src")).toEqual(["Cargo.toml", "README.md"]);
  });

  it("줄·칸 꼬리를 떼고, 링크 범위에는 꼬리까지 든다", () => {
    const [m] = findPathLinks("error at src/a/b.ts:12:3: bad");
    expect(m).toMatchObject({ path: "src/a/b.ts", line: 12, col: 3, form: "rel" });
    expect("error at src/a/b.ts:12:3: bad".slice(m.start, m.end)).toBe("src/a/b.ts:12:3");
    const [w] = findPathLinks(String.raw`C:\p\x.rs:7`);
    expect(w).toMatchObject({ path: String.raw`C:\p\x.rs`, line: 7 });
    expect(w.col).toBeUndefined();
  });

  it("문장 부호 · 따옴표 · 괄호 · `=` 는 경로가 아니다", () => {
    expect(paths("see docs/a.md.")).toEqual(["docs/a.md"]);
    expect(paths('"docs/a.md", (b/c.txt)')).toEqual(["docs/a.md", "b/c.txt"]);
    expect(paths("--out=docs/a.md")).toEqual(["docs/a.md"]);
  });

  it("텍스트로 보이지 않는 이름 · 폴더 · 글롭 · 점 없는 낱말은 잡지 않는다", () => {
    expect(paths("img/logo.png bin/app.exe src/ docs/*.md README version 1.2.3 e.g.")).toEqual([]);
    expect(paths("//comment.md")).toEqual([]);
  });

  it("URL 과 겹치면 URL 이 이긴다", () => {
    expect(paths("https://example.com/docs/a.md and docs/b.md")).toEqual(["docs/b.md"]);
    expect(paths("file:///C:/a/b.md")).toEqual([]);
  });

  it("넓은 글자 뒤에서도 문자열 인덱스를 준다(셀 좌표는 부르는 쪽이 옮긴다)", () => {
    const text = "한글 docs/a.md";
    const [m] = findPathLinks(text);
    expect(text.slice(m.start, m.end)).toBe("docs/a.md");
  });
});

describe("resolvePathLink — 그 타일에서 열 경로", () => {
  const local: PathLinkPlace = { kind: "local", cwd: String.raw`C:\proj\app` };
  const remote: PathLinkPlace = { kind: "remote", cwd: "/srv/app" };
  const wsl: PathLinkPlace = {
    kind: "wsl",
    cwd: "/mnt/c/proj",
    toLocal: (p) => wslCwdToWindows("Ubuntu", p),
  };

  it("로컬 — 상대는 셸 폴더에 잇고 `.`·`..` 를 접는다", () => {
    expect(resolvePathLink({ path: "docs/a.md", form: "rel" }, local)).toEqual({ path: String.raw`C:\proj\app\docs\a.md` });
    expect(resolvePathLink({ path: "../x/./b.ts", form: "rel" }, local)).toEqual({ path: String.raw`C:\proj\x\b.ts` });
    expect(resolvePathLink({ path: String.raw`D:\z.txt`, form: "abs" }, local)).toEqual({ path: String.raw`D:\z.txt` });
    expect(resolvePathLink({ path: "~/n.md", form: "home" }, local)).toEqual({ home: "n.md" });
  });

  it("셸 폴더를 모르면 상대 경로는 걸지 않는다", () => {
    expect(resolvePathLink({ path: "docs/a.md", form: "rel" }, { kind: "local", cwd: null })).toBeNull();
    expect(resolvePathLink({ path: "docs/a.md", form: "rel" }, { kind: "remote", cwd: "" })).toBeNull();
  });

  it("원격 — POSIX 로 잇고, 윈도우 절대 경로는 열 수 없다", () => {
    expect(resolvePathLink({ path: "../etc/x.conf", form: "rel" }, remote)).toEqual({ path: "/srv/etc/x.conf" });
    expect(resolvePathLink({ path: "/var/log/a.log", form: "abs" }, remote)).toEqual({ path: "/var/log/a.log" });
    expect(resolvePathLink({ path: String.raw`C:\a.md`, form: "abs" }, remote)).toBeNull();
    expect(resolvePathLink({ path: "~/a.md", form: "home" }, remote)).toEqual({ home: "a.md" });
  });

  it("WSL — POSIX 로 이은 뒤 이 컴퓨터의 경로로 옮긴다 · `~` 는 걸지 않는다", () => {
    expect(resolvePathLink({ path: "docs/a.md", form: "rel" }, wsl)).toEqual({ path: String.raw`C:\proj\docs\a.md` });
    expect(resolvePathLink({ path: "/mnt/d/x.txt", form: "abs" }, wsl)).toEqual({ path: String.raw`D:\x.txt` });
    expect(resolvePathLink({ path: "~/a.md", form: "home" }, wsl)).toBeNull();
  });

  it("joinNormalize — 뿌리 위로 올라가지 않는다 · 구분자를 맞춘다", () => {
    expect(joinNormalize("C:\\", "../../a.md", "\\")).toBe(String.raw`C:\a.md`);
    expect(joinNormalize("/", "../a.md", "/")).toBe("/a.md");
    expect(joinNormalize(String.raw`\\srv\share\d`, "../x.txt", "\\")).toBe(String.raw`\\srv\share\x.txt`);
    expect(joinNormalize("C:/proj", "src/a.ts", "\\")).toBe(String.raw`C:\proj\src\a.ts`);
    expect(joinHome("/home/me", "notes/a.md")).toBe("/home/me/notes/a.md");
    expect(joinHome(String.raw`C:\Users\me`, "a.md")).toBe(String.raw`C:\Users\me\a.md`);
  });
});

describe("OSC 8 file:// 링크", () => {
  it("호스트가 비었거나 localhost 일 때만 이 컴퓨터의 경로", () => {
    expect(fileUrlToLocalPath("file:///C:/a/b%20c.md")).toBe("C:/a/b c.md");
    expect(fileUrlToLocalPath("file://localhost/home/me/a.md")).toBe("/home/me/a.md");
    expect(fileUrlToLocalPath("file://web-01/home/me/a.md")).toBeNull();
    expect(fileUrlToLocalPath("https://x/a.md")).toBeNull();
  });

  it("oscLinkAction — http(s) 는 웹 · 로컬 타일의 텍스트 file:// 만 문서 · 그 밖은 없음", () => {
    expect(oscLinkAction("https://x.dev/a", false)).toEqual({ kind: "web", url: "https://x.dev/a" });
    expect(oscLinkAction("file:///C:/a/readme.md", true)).toEqual({ kind: "doc", path: "C:/a/readme.md" });
    expect(oscLinkAction("file:///C:/a/readme.md", false)).toBeNull();
    expect(oscLinkAction("file:///C:/a/app.exe", true)).toBeNull();
    expect(oscLinkAction("javascript:alert(1)", true)).toBeNull();
    expect(oscLinkAction("not a url", true)).toBeNull();
  });
});
