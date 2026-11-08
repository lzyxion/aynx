import { describe, expect, it } from "vitest";
import {
  canSplit,
  chunks,
  docBlock,
  effectiveView,
  entriesTotal,
  entryKey,
  hunkHeader,
  isNarrow,
  lineKey,
  parseDiffFile,
  parseDiffFiles,
  pickEntry,
  rangeText,
  scopeArgs,
  splitPath,
  splitRows,
  stepEntry,
  unifiedRows,
  type DiffEntry,
  type DiffFile,
  type DiffFiles,
  type DiffLine,
} from "$lib/diff-view";
import type { Tr } from "$lib/session";
import { translate } from "$lib/i18n/dict";

/**
 * diff 타일 — 순수 규칙 (docs/log/2026-10-05-diff-tile.md).
 *
 * 백엔드 답 읽기 · 범위 글자 · 한 줄/나란히 줄 짓기(빈 칸 채움 정렬) · 폭 규칙(나란히 900 · 좁은 720) · 파일 걸음.
 */

const ko: Tr = (key, params) => translate("ko", key, params);

const L = (kind: DiffLine["kind"], oldNo: number | null, newNo: number | null, text = ""): DiffLine => ({
  kind,
  oldNo,
  newNo,
  text,
  noNewline: false,
});

const FILE: DiffFile = {
  path: "src/a.rs",
  oldPath: null,
  binary: false,
  truncated: false,
  added: 3,
  deleted: 2,
  hunks: [
    {
      oldStart: 38,
      oldLines: 5,
      newStart: 38,
      newLines: 6,
      section: "impl Refresher",
      lines: [
        L("ctx", 38, 38, "fn refresh"),
        L("del", 39, null, "old a"),
        L("del", 40, null, "old b"),
        L("add", null, 39, "new a"),
        L("add", null, 40, "new b"),
        L("add", null, 41, "new c"),
        L("ctx", 41, 42, "}"),
      ],
    },
    {
      oldStart: 70,
      oldLines: 1,
      newStart: 71,
      newLines: 1,
      section: "",
      lines: [L("add", null, 71, "x"), L("del", 70, null, "y")],
    },
  ],
};

const E = (path: string, group: DiffEntry["group"] = "committed", status: DiffEntry["status"] = "M"): DiffEntry => ({
  path,
  oldPath: null,
  status,
  added: 1,
  deleted: 2,
  binary: false,
  group,
});

describe("scopeArgs — range (orchestration report)", () => {
  it("needs both base and tip; worktree rides along", () => {
    expect(scopeArgs({ projectId: "P", scope: "range", base: " aaaaaaa ", tip: "bbbbbbb", worktreePath: "C:/wt" })).toEqual({
      kind: "range",
      base: "aaaaaaa",
      commit: "bbbbbbb",
      worktree: "C:/wt",
    });
    expect(scopeArgs({ projectId: "P", scope: "range", base: "aaaaaaa" })).toBeNull();
    expect(scopeArgs({ projectId: "P", scope: "range", tip: "bbbbbbb" })).toBeNull();
    expect(scopeArgs({ projectId: "P", scope: "range", base: "aaaaaaa", tip: "bbbbbbb", commit: "ccccccc" })?.commit).toBe("bbbbbbb");
  });
});

describe("scopeArgs", () => {
  it("범위마다 쓰는 칸만 — 모자라면 null", () => {
    expect(scopeArgs({ projectId: "P", scope: "branch", branch: " feat " })).toEqual({ kind: "branch", branch: "feat" });
    expect(scopeArgs({ projectId: "P", scope: "branch" })).toBeNull();
    expect(scopeArgs({ projectId: "P", scope: "commit", commit: "abc1234", branch: "feat" })).toEqual({
      kind: "commit",
      commit: "abc1234",
      branch: "feat",
    });
    expect(scopeArgs({ projectId: "P", scope: "commit" })).toBeNull();
    expect(scopeArgs({ projectId: "P", scope: "wip", worktreePath: "/w" })).toEqual({ kind: "wip", worktree: "/w" });
    expect(scopeArgs({ projectId: "P", scope: "wip", branch: "x" })).toBeNull();
  });
});

describe("parse", () => {
  it("목록 답 — 어긋난 줄은 버린다", () => {
    const f = parseDiffFiles({
      main: "main",
      branch: "feat",
      base: "b".repeat(40),
      tip: "c".repeat(40),
      worktree: "/w",
      head: null,
      merge: false,
      root: false,
      files: [
        { path: "a", old_path: null, status: "M", added: 1, deleted: 0, binary: false, group: "committed" },
        { path: "b", status: "X" },
        { path: "c", old_path: "o", status: "R", added: null, deleted: null, binary: true, group: "uncommitted" },
      ],
      commits: [{ hash: "c".repeat(40), subject: "s", time: 5 }, { hash: 3 }],
      commits_truncated: true,
      wip_count: 1,
      truncated: false,
    })!;
    expect(f.files.map((e) => [e.path, e.group, e.binary, e.oldPath])).toEqual([
      ["a", "committed", false, null],
      ["c", "uncommitted", true, "o"],
    ]);
    expect(f.commits).toHaveLength(1);
    expect(f.commitsTruncated).toBe(true);
    expect(f.wipCount).toBe(1);
    expect(parseDiffFiles({ files: "x" })).toBeNull();
    expect(parseDiffFiles(null)).toBeNull();
  });

  it("파일 답", () => {
    const f = parseDiffFile({
      path: "a",
      old_path: null,
      binary: false,
      truncated: true,
      added: 1,
      deleted: 1,
      hunks: [
        {
          old_start: 1,
          old_lines: 1,
          new_start: 1,
          new_lines: 1,
          section: "s",
          lines: [
            { kind: "del", old_no: 1, new_no: null, text: "a", no_newline: true },
            { kind: "zzz" },
            { kind: "add", old_no: null, new_no: 1, text: "b", no_newline: false },
          ],
        },
      ],
    })!;
    expect(f.truncated).toBe(true);
    expect(f.hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo, l.noNewline])).toEqual([
      ["del", 1, null, true],
      ["add", null, 1, false],
    ]);
    expect(parseDiffFile({ path: "a" })).toBeNull();
  });
});

describe("rangeText", () => {
  const base: DiffFiles = {
    main: "main",
    branch: "feat",
    base: "3f2a91c000",
    tip: "a1b2c3d000",
    worktree: "/w",
    head: null,
    merge: false,
    root: false,
    files: [],
    commits: [],
    commitsTruncated: false,
    wipCount: null,
    truncated: false,
  };
  it("목업 그대로", () => {
    expect(rangeText("branch", base, ko)).toBe("merge-base 3f2a91c … HEAD a1b2c3d + 작업 폴더");
    expect(rangeText("branch", { ...base, worktree: null }, ko)).toBe("merge-base 3f2a91c … HEAD a1b2c3d");
    expect(rangeText("commit", { ...base, tip: "9f8e7d6aaa" }, ko)).toBe("9f8e7d6^ … 9f8e7d6");
    expect(rangeText("commit", { ...base, tip: "9f8e7d6aaa", root: true }, ko)).toBe("빈 트리 … 9f8e7d6");
    expect(rangeText("commit", { ...base, tip: "9f8e7d6aaa", merge: true }, ko)).toBe("9f8e7d6 (병합 커밋)");
    expect(rangeText("wip", base, ko)).toBe("HEAD … 작업 폴더");
  });
});

describe("줄 짓기", () => {
  it("한 줄 보기 — 헝크 머리줄 + 줄, 열쇠는 파일 안에서 유일", () => {
    const rows = unifiedRows(FILE);
    expect(rows[0]).toEqual({ type: "hunk", key: "h0", header: "@@ -38,5 +38,6 @@ impl Refresher" });
    expect(rows).toHaveLength(2 + 7 + 2);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(lineKey(L("ctx", 38, 38))).toBe("38:38");
    expect(lineKey(L("add", null, 39))).toBe("-:39");
    expect(lineKey(L("del", 39, null))).toBe("39:-");
    expect(hunkHeader(FILE.hunks[1])).toBe("@@ -70,1 +71,1 @@");
  });

  it("나란히 — 뺌 덩어리와 더함 덩어리를 짝짓고 짧은 쪽은 빈 칸", () => {
    const rows = splitRows(FILE);
    const pairs = rows.map((r) =>
      r.type === "hunk" ? r.header.slice(0, 2) : `${r.left?.oldNo ?? "_"}|${r.right?.newNo ?? "_"}`,
    );
    expect(pairs).toEqual([
      "@@",
      "38|38", // 맥락은 양쪽 같은 줄
      "39|39",
      "40|40",
      "_|41", // 더함이 하나 더 — 왼쪽은 빈 칸
      "41|42",
      "@@",
      "_|71", // 더함 뒤의 뺌은 짝짓지 않는다(뺌 → 더함만 나란히)
      "70|_",
    ]);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("덩어리", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });

  it("5천 줄도 한 번에 짓는다(순수 층은 가볍다)", () => {
    const lines: DiffLine[] = [];
    for (let i = 0; i < 5000; i++) lines.push(i % 3 === 0 ? L("del", i + 1, null) : L("add", null, i + 1));
    const big: DiffFile = { ...FILE, hunks: [{ ...FILE.hunks[0], lines }] };
    const t0 = performance.now();
    const u = unifiedRows(big);
    const s = splitRows(big);
    expect(u).toHaveLength(5001);
    expect(s.length).toBeGreaterThan(3000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("폭 규칙", () => {
  it("나란히는 900px 이상 · 좁은 모드는 720px 미만", () => {
    expect(canSplit(900)).toBe(true);
    expect(canSplit(899)).toBe(false);
    expect(canSplit(1046)).toBe(true); // 175% 배율 · 최대화 창의 타일 폭(실기)
    expect(isNarrow(719)).toBe(true);
    expect(isNarrow(720)).toBe(false);
    expect(isNarrow(0)).toBe(false); // 아직 재지 않았다
    expect(effectiveView("split", 1200)).toBe("split");
    expect(effectiveView("split", 850)).toBe("unified");
    expect(effectiveView(undefined, 1400)).toBe("unified");
  });
});

describe("파일 목록", () => {
  const files = [E("a"), E("b"), E("b", "uncommitted"), E("c", "committed", "D")];
  it("걸음 — 끝에서 멈춘다", () => {
    expect(stepEntry(files, entryKey(files[0]), 1)?.path).toBe("b");
    expect(stepEntry(files, entryKey(files[0]), -1)?.path).toBe("a");
    expect(entryKey(stepEntry(files, entryKey(files[1]), 1)!)).toBe("uncommitted:b");
    expect(stepEntry(files, null, 1)?.path).toBe("a");
    expect(stepEntry(files, null, -1)?.path).toBe("c");
    expect(stepEntry([], null, 1)).toBeNull();
  });

  it("처음 고를 파일 — 명세의 파일(묶음 우선) · 없으면 첫 파일", () => {
    expect(entryKey(pickEntry(files, "b")!)).toBe("committed:b");
    expect(entryKey(pickEntry(files, "b", "uncommitted")!)).toBe("uncommitted:b");
    expect(pickEntry(files, "zzz")?.path).toBe("a");
    expect(pickEntry([], "a")).toBeNull();
  });

  it("문서로 열기 · 합계 · 경로", () => {
    expect(docBlock(files[0], "/w")).toBeNull();
    expect(docBlock(files[3], "/w")).toBe("deleted");
    expect(docBlock(files[0], null)).toBe("noWorktree");
    expect(docBlock(null, "/w")).toBe("noFile");
    expect(entriesTotal(files)).toEqual({ added: 4, deleted: 8 });
    expect(splitPath("src/lib/a.ts")).toEqual({ dir: "src/lib/", name: "a.ts" });
    expect(splitPath("a.ts")).toEqual({ dir: "", name: "a.ts" });
  });
});
