import { describe, expect, it } from "vitest";
import {
  dropDirOf,
  entryOrder,
  filterRows,
  nameMatch,
  fileTreeRows,
  findByPrefix,
  firstChildId,
  isAuxId,
  moreRowId,
  navOrder,
  parentRowId,
  rebasePaths,
  targetDirOf,
  TREE_PAGE,
  type FileTreeRow,
  type FolderState,
} from "$lib/file-tree";
import type { SftpEntry } from "$lib/sftp-browser";

/** 최소 항목 — 원격 문법(`/`)으로 만든다 */
function e(path: string, kind: SftpEntry["kind"] = "file", extra: Partial<SftpEntry> = {}): SftpEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return {
    name,
    path,
    kind,
    size: 0,
    mtime: null,
    mode: null,
    symlinkTarget: null,
    linkIsDir: false,
    hidden: null,
    ...extra,
  };
}

const ROOT = "/p";
const ROOT_ENTRIES = [e("/p/src", "dir"), e("/p/docs", "dir"), e("/p/.git", "dir"), e("/p/README.md")];
const ok = (...entries: SftpEntry[]): FolderState => ({ status: "ok", entries });

function rows(
  expanded: string[],
  folders: Record<string, FolderState> = {},
  extra: { tree?: boolean; showHidden?: boolean; limits?: Record<string, number>; page?: number } = {},
  rootEntries: readonly SftpEntry[] = ROOT_ENTRIES,
): FileTreeRow[] {
  return fileTreeRows(ROOT, rootEntries, {
    tree: extra.tree ?? true,
    showHidden: extra.showHidden ?? false,
    expanded: new Set(expanded),
    folders: new Map(Object.entries(folders)),
    limits: new Map(Object.entries(extra.limits ?? {})),
    page: extra.page,
  });
}

/** 줄을 한 줄 글자로 — 깊이만큼 두 칸 · 종류 표시 */
function shape(list: readonly FileTreeRow[]): string[] {
  return list.map((r) => {
    const pad = "  ".repeat(r.depth);
    if (r.kind === "entry") {
      const mark = r.expandable ? (r.expanded ? "▾ " : "▸ ") : "";
      return `${pad}${mark}${r.entry.name}${r.error ? ` !${r.error}` : ""}`;
    }
    if (r.kind === "more") return `${pad}+${r.hidden}`;
    return `${pad}(${r.kind})`;
  });
}

describe("fileTreeRows — 펼침", () => {
  it("아무것도 안 펼치면 뿌리 한 층 · 숨김은 빠진다", () => {
    expect(shape(rows([]))).toEqual(["▸ src", "▸ docs", "README.md"]);
  });

  it("숨김 켜면 닷폴더도 선다", () => {
    expect(shape(rows([], {}, { showHidden: true }))).toEqual(["▸ src", "▸ docs", "▸ .git", "README.md"]);
  });

  it("펼친 폴더 아래로 한 단 들여 편다 · 중첩도", () => {
    const r = rows(["/p/src", "/p/src/lib"], {
      "/p/src": ok(e("/p/src/lib", "dir"), e("/p/src/main.ts")),
      "/p/src/lib": ok(e("/p/src/lib/a.ts")),
    });
    expect(shape(r)).toEqual(["▾ src", "  ▾ lib", "    a.ts", "  main.ts", "▸ docs", "README.md"]);
    const a = r.find((x) => x.kind === "entry" && x.entry.name === "a.ts");
    expect(a?.parent).toBe("/p/src/lib");
    expect(a?.depth).toBe(2);
  });

  it("부모가 접혀 있으면 펼쳐 둔 자식도 안 보인다 (상태는 남는다)", () => {
    const r = rows(["/p/src/lib"], { "/p/src": ok(e("/p/src/lib", "dir")), "/p/src/lib": ok(e("/p/src/lib/a.ts")) });
    expect(shape(r)).toEqual(["▸ src", "▸ docs", "README.md"]);
  });

  it("게으른 자리 — 펼쳤는데 아직 모르면 읽는 중 한 줄 (상태 없음 · loading 둘 다)", () => {
    expect(shape(rows(["/p/src"]))).toEqual(["▾ src", "  (loading)", "▸ docs", "README.md"]);
    expect(shape(rows(["/p/src"], { "/p/src": { status: "loading" } }))).toEqual([
      "▾ src",
      "  (loading)",
      "▸ docs",
      "README.md",
    ]);
  });

  it("빈 폴더는 비어 있음 한 줄 (숨김뿐이어도)", () => {
    expect(shape(rows(["/p/docs"], { "/p/docs": ok(e("/p/docs/.keep")) }))).toEqual([
      "▸ src",
      "▾ docs",
      "  (empty)",
      "README.md",
    ]);
  });

  it("못 읽은 폴더는 펼치지 않고 그 줄에 오류를 싣는다", () => {
    const r = rows(["/p/src"], { "/p/src": { status: "error", message: "권한 없음" } });
    expect(shape(r)).toEqual(["▸ src !권한 없음", "▸ docs", "README.md"]);
  });

  it("디렉터리 링크도 펼칠 수 있다 · 파일 링크는 아니다", () => {
    const r = rows([], {}, {}, [
      e("/p/shared", "symlink", { linkIsDir: true }),
      e("/p/latest.log", "symlink"),
    ]);
    expect(r.map((x) => x.kind === "entry" && x.expandable)).toEqual([true, false]);
  });

  it("제 조상을 가리키는 링크 고리는 다시 펼치지 않는다", () => {
    // /p/src/loop 가 /p/src 로 풀리는 것이 아니라 **같은 경로 문자열**이 조상에 있을 때만 막는다
    const r = rows(["/p/src"], { "/p/src": ok(e("/p/src", "dir")) });
    expect(shape(r)).toEqual(["▾ src", "  ▸ src", "▸ docs", "README.md"]);
  });

  it("들어가기 보기 — 펼침 없음 · 화살표 없음 · 상한 없음", () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`/p/f${i}`));
    const r = rows(["/p/src"], { "/p/src": ok(e("/p/src/x")) }, { tree: false, page: 5 }, [e("/p/src", "dir"), ...many]);
    expect(r.length).toBe(13);
    expect(r.every((x) => x.kind === "entry" && !x.expandable && !x.expanded && x.depth === 0)).toBe(true);
  });
});

describe("fileTreeRows — 큰 폴더", () => {
  const big = Array.from({ length: 3000 }, (_, i) => e(`/p/nm/pkg${String(i).padStart(4, "0")}`, "dir"));

  it("상한을 넘으면 N개 더 보기 한 줄로 접는다", () => {
    const r = rows(["/p/nm"], { "/p/nm": ok(...big) }, {}, [e("/p/nm", "dir")]);
    expect(r.length).toBe(1 + TREE_PAGE + 1);
    const more = r[r.length - 1];
    expect(more.kind).toBe("more");
    expect(more.kind === "more" && more.hidden).toBe(3000 - TREE_PAGE);
    expect(more.id).toBe(moreRowId("/p/nm"));
    expect(more.depth).toBe(1);
  });

  it("폴더별 한도를 늘리면 그만큼 더 편다 · 다 펴면 더 보기 줄이 사라진다", () => {
    const r = rows(["/p/nm"], { "/p/nm": ok(...big) }, { limits: { "/p/nm": TREE_PAGE * 2 } }, [e("/p/nm", "dir")]);
    expect(r.filter((x) => x.kind === "entry").length).toBe(1 + TREE_PAGE * 2);
    const all = rows(["/p/nm"], { "/p/nm": ok(...big) }, { limits: { "/p/nm": 5000 } }, [e("/p/nm", "dir")]);
    expect(all.some((x) => x.kind === "more")).toBe(false);
  });

  it("뿌리에도 같은 상한이 걸린다", () => {
    const r = rows([], {}, { page: 10 }, big.slice(0, 25));
    expect(shape(r).slice(-1)).toEqual(["+15"]);
  });

  it("3000 줄 폴더 펴기가 빠르다", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) rows(["/p/nm"], { "/p/nm": ok(...big) }, { limits: { "/p/nm": 5000 } }, [e("/p/nm", "dir")]);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
});

describe("순서 · 이웃", () => {
  const r = rows(["/p/src"], { "/p/src": ok(e("/p/src/lib", "dir"), e("/p/src/main.ts")) }, { page: 1 });
  // page 1: 뿌리는 src 하나 + 더 보기, src 아래는 lib 하나 + 더 보기

  it("항목 순서는 곁줄을 뺀다 · 커서 순서는 더 보기를 품는다", () => {
    expect(shape(r)).toEqual(["▾ src", "  ▸ lib", "  +1", "+2"]);
    expect(entryOrder(r)).toEqual(["/p/src", "/p/src/lib"]);
    expect(navOrder(r)).toEqual(["/p/src", "/p/src/lib", moreRowId("/p/src"), moreRowId(ROOT)]);
    expect(isAuxId(moreRowId(ROOT))).toBe(true);
    expect(isAuxId("/p/src")).toBe(false);
  });

  it("← 는 든 폴더 줄로 · 뿌리 바로 아래는 없음", () => {
    expect(parentRowId(r, "/p/src/lib")).toBe("/p/src");
    expect(parentRowId(r, moreRowId("/p/src"))).toBe("/p/src");
    expect(parentRowId(r, "/p/src")).toBeNull();
  });

  it("→ 는 펼친 폴더의 첫 아이로 · 접힌 폴더·파일은 없음", () => {
    expect(firstChildId(r, "/p/src")).toBe("/p/src/lib");
    expect(firstChildId(r, "/p/src/lib")).toBeNull();
    const loading = rows(["/p/src"]);
    expect(firstChildId(loading, "/p/src")).toBeNull(); // 읽는 중 줄에는 앉지 않는다
  });
});

describe("대상 폴더 규칙", () => {
  const r = rows(["/p/src"], { "/p/src": ok(e("/p/src/lib", "dir"), e("/p/src/main.ts")) });
  const by = (id: string) => r.find((x) => x.id === id);

  it("폴더 = 그 폴더 · 파일 = 든 폴더 · 없음 = 뿌리", () => {
    expect(targetDirOf(by("/p/src/lib"), ROOT)).toBe("/p/src/lib");
    expect(targetDirOf(by("/p/src/main.ts"), ROOT)).toBe("/p/src");
    expect(targetDirOf(by("/p/README.md"), ROOT)).toBe(ROOT);
    expect(targetDirOf(null, ROOT)).toBe(ROOT);
  });

  it("곁줄은 그것이 달린 폴더", () => {
    const loading = rows(["/p/src"]);
    const aux = loading.find((x) => x.kind === "loading");
    expect(targetDirOf(aux, ROOT)).toBe("/p/src");
  });

  it("끌어 놓는 자리도 같은 규칙", () => {
    expect(dropDirOf(by("/p/src/lib")!)).toBe("/p/src/lib");
    expect(dropDirOf(by("/p/src/main.ts")!)).toBe("/p/src");
    expect(dropDirOf(by("/p/README.md")!)).toBe(ROOT);
  });
});

describe("글자 쳐서 고르기", () => {
  const r = rows([], {}, { showHidden: true }, [e("/p/alpha"), e("/p/Beta"), e("/p/bravo"), e("/p/charlie")]);

  it("한 글자는 다음 줄부터 돈다 (대소문자 무시)", () => {
    expect(findByPrefix(r, null, "b")).toBe("/p/Beta");
    expect(findByPrefix(r, "/p/Beta", "b")).toBe("/p/bravo");
    expect(findByPrefix(r, "/p/bravo", "b")).toBe("/p/Beta");
  });

  it("두 글자 이상은 지금 줄부터", () => {
    expect(findByPrefix(r, "/p/bravo", "br")).toBe("/p/bravo");
    expect(findByPrefix(r, "/p/Beta", "br")).toBe("/p/bravo");
  });

  it("없으면 null", () => {
    expect(findByPrefix(r, null, "z")).toBeNull();
    expect(findByPrefix(r, null, "")).toBeNull();
  });
});

describe("rebasePaths", () => {
  it("그 폴더와 아래를 옮겨 적는다 (두 구분자)", () => {
    const s = new Set(["/p/src", "/p/src/lib", "/p/srcx", "C:\\a\\b", "C:\\a\\b\\c"]);
    expect([...rebasePaths(s, "/p/src", "/p/app")].sort()).toEqual(["/p/app", "/p/app/lib", "/p/srcx", "C:\\a\\b", "C:\\a\\b\\c"].sort());
    expect([...rebasePaths(s, "C:\\a\\b", "C:\\a\\z")]).toContain("C:\\a\\z\\c");
  });

  it("null 이면 버린다 · 없으면 같은 집합", () => {
    const s = new Set(["/p/src", "/p/src/lib", "/p/docs"]);
    expect([...rebasePaths(s, "/p/src", null)]).toEqual(["/p/docs"]);
    expect(rebasePaths(s, "/q", "/r")).toBe(s);
  });
});

describe("filterRows — 필터 줄 (docs/log/2026-10-07-file-tile-dolphin.md)", () => {
  const deep = () =>
    rows(["/p/src", "/p/src/lib", "/p/docs"], {
      "/p/src": ok(e("/p/src/lib", "dir"), e("/p/src/main.ts")),
      "/p/src/lib": ok(e("/p/src/lib/Theme.css"), e("/p/src/lib/a.ts")),
      "/p/docs": ok(),
    });

  it("맞는 줄과 그 조상 폴더만 남기고 곁줄은 뺀다 · 대소문자 무시", () => {
    const f = filterRows(deep(), "theme");
    expect(shape(f.rows)).toEqual(["▾ src", "  ▾ lib", "    Theme.css"]);
    expect([...f.matched]).toEqual(["/p/src/lib/Theme.css"]);
    expect(f.count).toBe(1);
  });

  it("폴더 이름이 맞으면 그 폴더도 맞는 줄이다(아래는 따로 걸러진다)", () => {
    const f = filterRows(deep(), "LIB");
    expect(shape(f.rows)).toEqual(["▾ src", "  ▾ lib"]);
    expect(f.matched.has("/p/src/lib")).toBe(true);
    expect(f.matched.has("/p/src")).toBe(false);
  });

  it("뿌리 한 층(아이콘·간단히 보기) — 맞는 것만", () => {
    const f = filterRows(rows([], {}, { tree: false }), "o");
    expect(shape(f.rows)).toEqual(["docs"]);
    expect(f.count).toBe(1);
  });

  it("빈 질의는 손대지 않는다 · 맞는 것이 없으면 빈 목록", () => {
    const all = deep();
    expect(filterRows(all, "  ").rows).toBe(all);
    expect(filterRows(all, "zzz")).toMatchObject({ rows: [], count: 0 });
  });

  it("nameMatch — 처음 맞는 자리 [시작, 끝)", () => {
    expect(nameMatch("Theme.css", "eme")).toEqual([2, 5]);
    expect(nameMatch("Theme.css", "THE")).toEqual([0, 3]);
    expect(nameMatch("Theme.css", "x")).toBeNull();
    expect(nameMatch("Theme.css", "")).toBeNull();
  });
});
