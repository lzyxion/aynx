import { describe, expect, it } from "vitest";
import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import type { WorktreeInfo } from "$lib/projects";
import type { Tr } from "$lib/session";
import {
  changeBadgeMerged,
  changeBadgeParts,
  changeBadgeText,
  changeBadgeTitle,
  changePathsOf,
  changesKey,
  compactCount,
  parseWorktreeChanges,
  type WorktreeChanges,
} from "$lib/worktree-changes";

const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);
const enTr: Tr = (key, params) => translate("en", key, params);

const c = (over: Partial<WorktreeChanges>): WorktreeChanges => ({
  path: "/w",
  ahead: null,
  addedLines: 0,
  deletedLines: 0,
  merged: false,
  mergedKind: null,
  ...over,
});

describe("parseWorktreeChanges", () => {
  it("읽고, 어긋난 줄은 버린다 — 줄 수 칸은 added_lines · deleted_lines, merged 는 true 일 때만", () => {
    expect(
      parseWorktreeChanges([
        { path: "/a", ahead: 7, added_lines: 84, deleted_lines: 19, merged: false },
        { path: "/b", ahead: 0, merged: true },
        { path: "", ahead: 1 },
        { ahead: 1 },
        null,
        { path: "/c", ahead: -2, added_lines: -5, deleted_lines: "9", merged: "true" },
        { path: "/d", ahead: null },
        { path: "/e", ahead: 3, merged: true, merged_kind: "squash" },
        { path: "/f", ahead: 3, merged: false, merged_kind: "squash" },
        { path: "/g", ahead: 2, merged: true, merged_kind: "weird" },
      ]),
    ).toEqual([
      { path: "/a", ahead: 7, addedLines: 84, deletedLines: 19, merged: false, mergedKind: null },
      { path: "/b", ahead: 0, addedLines: 0, deletedLines: 0, merged: true, mergedKind: null },
      { path: "/c", ahead: null, addedLines: 0, deletedLines: 0, merged: false, mergedKind: null },
      { path: "/d", ahead: null, addedLines: 0, deletedLines: 0, merged: false, mergedKind: null },
      { path: "/e", ahead: 3, addedLines: 0, deletedLines: 0, merged: true, mergedKind: "squash" },
      { path: "/f", ahead: 3, addedLines: 0, deletedLines: 0, merged: false, mergedKind: null },
      { path: "/g", ahead: 2, addedLines: 0, deletedLines: 0, merged: true, mergedKind: null },
    ]);
    expect(parseWorktreeChanges(null)).toEqual([]);
    expect(parseWorktreeChanges({})).toEqual([]);
  });
});

describe("compactCount", () => {
  it("1000 부터 k · 백만부터 M, 소수 한 자리는 내림 · 10 이상은 정수", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(84)).toBe("84");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1000)).toBe("1k");
    expect(compactCount(1234)).toBe("1.2k");
    expect(compactCount(1999)).toBe("1.9k");
    expect(compactCount(10_500)).toBe("10k");
    expect(compactCount(999_999)).toBe("999k");
    expect(compactCount(1_000_000)).toBe("1M");
    expect(compactCount(1_250_000)).toBe("1.2M");
    expect(compactCount(-3)).toBe("0");
    expect(compactCount(12.7)).toBe("12");
  });
});

describe("changeBadgeParts", () => {
  it("+더한 줄 · −뺀 줄 · ↑앞선 커밋 — 0 인 조각은 빠진다", () => {
    expect(changeBadgeParts(c({ ahead: 2, addedLines: 84, deletedLines: 19 }))).toEqual([
      { kind: "plus", sym: "+", n: "84" },
      { kind: "minus", sym: "−", n: "19" },
      { kind: "up", sym: "↑", n: "2" },
    ]);
    expect(changeBadgeText(changeBadgeParts(c({ ahead: 2, addedLines: 84, deletedLines: 19 })))).toBe("+84 −19 ↑2");
    expect(changeBadgeText(changeBadgeParts(c({ ahead: 1 })))).toBe("↑1");
    expect(changeBadgeText(changeBadgeParts(c({ deletedLines: 3 })))).toBe("−3");
    expect(changeBadgeText(changeBadgeParts(c({ addedLines: 1234, deletedLines: 1_500_000 })))).toBe("+1.2k −1.5M");
  });

  it("모두 0 · 모름 · 없음 → 배지 없음", () => {
    expect(changeBadgeParts(c({}))).toEqual([]);
    expect(changeBadgeParts(c({ ahead: 0 }))).toEqual([]);
    expect(changeBadgeParts(undefined)).toEqual([]);
    expect(changeBadgeText([])).toBe("");
  });

  it("병합됨 → 숫자 대신 칩 (조각은 비고 changeBadgeMerged 가 참)", () => {
    expect(changeBadgeParts(c({ ahead: 0, merged: true }))).toEqual([]);
    // 모양이 어긋난 답이라도 병합됨이면 숫자를 세우지 않는다.
    expect(changeBadgeParts(c({ ahead: 3, addedLines: 5, merged: true }))).toEqual([]);
    expect(changeBadgeMerged(c({ ahead: 0, merged: true }))).toBe(true);
    // squash · rebase 병합 — 앞선 커밋이 남아 있어도 숫자 배지 없이 칩.
    const sq = c({ ahead: 3, addedLines: 40, deletedLines: 2, merged: true, mergedKind: "squash" });
    expect(changeBadgeParts(sq)).toEqual([]);
    expect(changeBadgeMerged(sq)).toBe(true);
    expect(changeBadgeMerged(c({ ahead: 0 }))).toBe(false);
    expect(changeBadgeMerged(null)).toBe(false);
  });
});

describe("changeBadgeTitle", () => {
  it("두 줄 — main 이후 커밋한 줄 수 · 앞선 커밋", () => {
    expect(changeBadgeTitle(c({ ahead: 3, addedLines: 1234, deletedLines: 19 }), koTr)).toBe(
      "main 이후 커밋: +1234 −19 줄\nmain 보다 커밋 3개 앞섬",
    );
    expect(changeBadgeTitle(c({ addedLines: 5 }), koTr)).toBe("main 이후 커밋: +5 −0 줄");
    expect(changeBadgeTitle(c({ ahead: 2 }), koTr)).toBe("main 보다 커밋 2개 앞섬");
    expect(changeBadgeTitle(c({}), koTr)).toBe("");
    expect(changeBadgeTitle(null, koTr)).toBe("");
    expect(changeBadgeTitle(c({ ahead: 3, addedLines: 84, deletedLines: 19 }), enTr)).toBe(
      "Committed since main: +84 −19 lines\n3 commit(s) ahead of main",
    );
  });

  it("병합됨 — 한 줄", () => {
    expect(changeBadgeTitle(c({ ahead: 0, merged: true }), koTr)).toBe(
      "커밋이 모두 main 에 들어갔습니다 — [정리] 로 워크트리와 브랜치를 제거할 수 있습니다",
    );
    expect(changeBadgeTitle(c({ ahead: 0, merged: true }), enTr)).toBe(
      "All commits are in main — use Clean up to remove the worktree and its branch",
    );
    expect(changeBadgeTitle(c({ ahead: 3, merged: true, mergedKind: "ancestry" }), koTr)).toBe(
      "커밋이 모두 main 에 들어갔습니다 — [정리] 로 워크트리와 브랜치를 제거할 수 있습니다",
    );
    expect(changeBadgeTitle(c({ ahead: 3, merged: true, mergedKind: "squash" }), koTr)).toBe(
      "squash 병합으로 main 에 들어갔습니다 — [정리] 로 워크트리와 브랜치를 제거할 수 있습니다",
    );
    expect(changeBadgeTitle(c({ ahead: 3, merged: true, mergedKind: "rebase" }), enTr)).toBe(
      "Merged into main by rebase — use Clean up to remove the worktree and its branch",
    );
  });
});

describe("changePathsOf", () => {
  it("주 폴더(첫 줄) · bare 는 묻지 않는다", () => {
    const w = (path: string, bare = false): WorktreeInfo => ({
      path,
      branch: null,
      head: null,
      bare,
      detached: false,
      createdByApp: false,
    });
    expect(changePathsOf([w("/repo"), w("/repo-wt/a"), w("/bare", true), w("/repo-wt/b")])).toEqual([
      "/repo-wt/a",
      "/repo-wt/b",
    ]);
    expect(changePathsOf([w("/repo")])).toEqual([]);
    expect(changePathsOf([])).toEqual([]);
  });

  it("열쇠는 프로젝트마다 따로", () => {
    expect(changesKey("p1", "/a")).not.toBe(changesKey("p2", "/a"));
  });
});
