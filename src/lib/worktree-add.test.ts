import { describe, expect, it } from "vitest";
import {
  defaultRow,
  firstSelectableRow,
  parseAddPreview,
  rowSelectable,
  stepSelectableRow,
  worktreeRows,
  type AddPreview,
  type WorktreeRow,
} from "$lib/worktree-add";

const P: AddPreview = parseAddPreview({
  main: "main",
  local: ["feat-x", "fix-login", "main", "spare", "old-feat"],
  remote: ["origin/HEAD", "origin/main", "origin/feat-y", "origin/spare", "origin/dup", "up/dup", "origin/Feature-z"],
  checked_out: ["main", "feat-x"],
});

/** 줄을 짧은 글자로 — `+name` 만들기 · `L:` 로컬 · `R:` 원격 · `B:` 다른 워크트리 · `A:` 여러 원격 */
const short = (rows: WorktreeRow[]) =>
  rows.map((r) =>
    r.kind === "create" ? `+${r.name}@${r.main ?? "-"}` : `${{ local: "L", remote: "R", busy: "B", ambiguous: "A" }[r.kind]}:${r.name}`,
  );

describe("worktree-add", () => {
  it("parses the preview defensively (snake_case)", () => {
    expect(parseAddPreview(null)).toEqual({ main: null, local: [], remote: [], checkedOut: [] });
    expect(parseAddPreview({ main: "", local: ["a", 1, ""], checked_out: ["a"] })).toEqual({
      main: null,
      local: ["a"],
      remote: [],
      checkedOut: ["a"],
    });
  });

  it.each([
    // 빈 칸 = 모든 브랜치(주 브랜치 · origin/HEAD · 로컬과 같은 이름의 원격 줄 제외), 로컬 → 원격
    ["", ["B:feat-x", "L:fix-login", "L:spare", "L:old-feat", "R:feat-y", "A:dup", "R:Feature-z"]],
    // 거르기 — 앞 일치 먼저, 안쪽 일치 뒤 · 대소문자 무시 · 새 이름이라 만들기 줄이 맨 위
    ["feat", ["+feat@main", "B:feat-x", "R:feat-y", "R:Feature-z", "L:old-feat"]],
    ["FIX", ["+FIX@main", "L:fix-login"]],
    // 친 글자가 있는 브랜치와 똑같으면 만들기 줄이 없고 그 줄이 맨 앞
    ["spare", ["L:spare"]],
    ["feat-y", ["R:feat-y"]],
    ["dup", ["A:dup"]],
    // 주 브랜치는 똑같이 칠 때만(체크아웃돼 있어 흐림) — 만들기 줄도 없다
    ["main", ["B:main"]],
    // 이름 규칙에 어긋나면 만들기 줄이 없다(검증 한 줄이 대신 말한다)
    ["-bad", []],
    ["a b", []],
    ["brand-new", ["+brand-new@main"]],
  ] as const)("rows for %j", (text, want) => {
    expect(short(worktreeRows(text, P))).toEqual(want);
  });

  it("create row without a known main", () => {
    expect(worktreeRows("x1", { ...P, main: null })[0]).toEqual({ kind: "create", name: "x1", main: null });
  });

  it("remote row keeps the full ref for the label", () => {
    expect(worktreeRows("feat-y", P)[0]).toEqual({ kind: "remote", name: "feat-y", ref: "origin/feat-y" });
    expect(worktreeRows("dup", P)[0]).toEqual({ kind: "ambiguous", name: "dup", refs: ["origin/dup", "up/dup"] });
  });

  it.each([
    // [친 글자, 기본 강조] — 빈 칸(공백뿐 포함)은 없음, 치면 고를 수 있는 첫 줄
    ["", -1],
    ["  ", -1],
    ["ol", 0], // 만들기 줄
    ["spare", 0],
    ["feat-x", -1], // 흐린 줄뿐
  ] as const)("default highlight for %j", (text, want) => {
    expect(defaultRow(text, worktreeRows(text, P))).toBe(want);
  });

  it("from no highlight, ↓ goes to the first selectable row and ↑ to the last", () => {
    const rows = worktreeRows("", P); // B L L L R A R
    expect(stepSelectableRow(rows, defaultRow("", rows), 1)).toBe(1);
    expect(stepSelectableRow(rows, defaultRow("", rows), -1)).toBe(6);
  });

  it("selection skips busy/ambiguous rows and wraps", () => {
    const rows = worktreeRows("", P); // B L L L R A R
    expect(rows.map(rowSelectable)).toEqual([false, true, true, true, true, false, true]);
    expect(firstSelectableRow(rows)).toBe(1);
    expect(stepSelectableRow(rows, 1, -1)).toBe(6); // 맨 앞 흐린 줄을 건너 끝으로
    expect(stepSelectableRow(rows, 4, 1)).toBe(6); // 흐린 dup 를 건너뛴다
    expect(stepSelectableRow(rows, 6, 1)).toBe(1);
    expect(stepSelectableRow(rows, -1, 1)).toBe(1);
    expect(firstSelectableRow(worktreeRows("dup", P))).toBe(-1);
    expect(stepSelectableRow(worktreeRows("dup", P), -1, 1)).toBe(-1);
    expect(stepSelectableRow([], -1, 1)).toBe(-1);
  });
});
