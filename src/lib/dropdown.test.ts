import { describe, expect, it } from "vitest";
import {
  DROPDOWN_GAP,
  DROPDOWN_MARGIN,
  DROPDOWN_MAX_HEIGHT,
  DROPDOWN_MIN_HEIGHT,
  dropdownMaxHeight,
  filterSuggestions,
  placeBelowOrAbove,
  typeaheadIndex,
} from "$lib/dropdown";

/** 고르개·자동완성 목록의 자리와 거르기 (docs/log/2026-09-20-host-form-tabs.md) */

describe("placeBelowOrAbove", () => {
  it("자리가 넉넉하면 손잡이 바로 아래", () => {
    const r = placeBelowOrAbove({ top: 100, bottom: 124 }, 200, 800);
    expect(r).toEqual({ top: 124 + DROPDOWN_GAP, flipped: false });
  });

  it("아래가 모자라면 위로 뒤집는다 (손잡이 위에 딱 붙어 끝난다)", () => {
    const r = placeBelowOrAbove({ top: 600, bottom: 624 }, 200, 700);
    expect(r.flipped).toBe(true);
    expect(r.top).toBe(600 - DROPDOWN_GAP - 200);
    expect(r.top + 200).toBe(600 - DROPDOWN_GAP); // 손잡이를 덮지 않는다
  });

  it("경계 한 칸 차이 — 여백 안에 들어가면 아래를 지킨다 (위에 자리가 있을 때)", () => {
    const trigger = { top: 300, bottom: 324 };
    const just = 324 + DROPDOWN_GAP + 200 + DROPDOWN_MARGIN;
    expect(placeBelowOrAbove(trigger, 200, just).flipped).toBe(false);
    expect(placeBelowOrAbove(trigger, 200, just - 1).flipped).toBe(true);
  });

  it("양쪽 다 모자라면 넓은 쪽에 붙인다", () => {
    // 손잡이가 위쪽에 있다 → 아래가 넓다
    const below = placeBelowOrAbove({ top: 60, bottom: 84 }, 400, 300);
    expect(below).toEqual({ top: 84 + DROPDOWN_GAP, flipped: false });
    // 손잡이가 아래쪽에 있다 → 위가 넓다. 화면 위 여백에 붙고 넘침은 목록이 스크롤한다
    const above = placeBelowOrAbove({ top: 240, bottom: 264 }, 400, 300);
    expect(above).toEqual({ top: DROPDOWN_MARGIN, flipped: true });
  });
});

describe("dropdownMaxHeight", () => {
  it("넓은 쪽의 자리만큼, 상한 안에서", () => {
    expect(dropdownMaxHeight({ top: 100, bottom: 124 }, 800)).toBe(DROPDOWN_MAX_HEIGHT);
    // 아래로 120 남짓만 남은 자리 (위는 더 좁다)
    expect(dropdownMaxHeight({ top: 20, bottom: 44 }, 180)).toBe(180 - DROPDOWN_MARGIN - 44 - DROPDOWN_GAP);
  });

  it("자리가 아무리 좁아도 하한만큼은 편다", () => {
    expect(dropdownMaxHeight({ top: 40, bottom: 64 }, 90)).toBe(DROPDOWN_MIN_HEIGHT);
  });
});

describe("filterSuggestions", () => {
  const all = ["prod/web", "prod/db", "staging", "dev/web"];

  it("빈 칸이면 전부 (상한까지)", () => {
    expect(filterSuggestions(all, "")).toEqual(all);
    expect(filterSuggestions(all, "  ")).toEqual(all);
    expect(filterSuggestions(all, "", 2)).toEqual(["prod/web", "prod/db"]);
  });

  it("포함하는 것들 — 대소문자를 무시하고, 뒤쪽 조각도 걸린다", () => {
    expect(filterSuggestions(all, "pr")).toEqual(["prod/web", "prod/db"]);
    expect(filterSuggestions(all, "PROD")).toEqual(["prod/web", "prod/db"]);
    expect(filterSuggestions(all, "web")).toEqual(["prod/web", "dev/web"]);
  });

  it("걸리는 것이 없으면 빈 목록이다 (상위가 상자를 아예 안 띄운다)", () => {
    expect(filterSuggestions(all, "zzz")).toEqual([]);
  });

  it("차례는 넘어온 그대로 — 호스트 목록·그룹 목록의 차례가 고르개에서 뒤바뀌지 않는다", () => {
    expect(filterSuggestions(["b/x", "a/x", "c/x"], "x")).toEqual(["b/x", "a/x", "c/x"]);
  });
});

describe("typeaheadIndex — 열린 목록에서 글자로 건너뛰기", () => {
  const shells = ["PowerShell 7", "Windows PowerShell", "Command Prompt", "Git Bash", "WSL: Ubuntu", "WSL: Debian"];

  it("글자 하나는 지금 줄 다음부터 그 글자로 시작하는 줄 (대소문자 무시)", () => {
    expect(typeaheadIndex(shells, "c", 0)).toBe(2);
    expect(typeaheadIndex(shells, "G", 0)).toBe(3);
  });

  it("같은 글자를 거듭 치면 그 글자의 줄들 사이를 돈다", () => {
    expect(typeaheadIndex(shells, "w", 0)).toBe(1);
    expect(typeaheadIndex(shells, "ww", 1)).toBe(4);
    expect(typeaheadIndex(shells, "www", 4)).toBe(5);
    expect(typeaheadIndex(shells, "wwww", 5)).toBe(1); // 끝에서 처음으로 돈다
  });

  it("이어 친 접두사는 지금 줄부터 찾는다 — 이미 맞으면 머문다", () => {
    expect(typeaheadIndex(shells, "wsl: d", 4)).toBe(5);
    expect(typeaheadIndex(shells, "wi", 1)).toBe(1);
  });

  it("맞는 줄이 없거나 목록·글자가 비면 -1", () => {
    expect(typeaheadIndex(shells, "z", 0)).toBe(-1);
    expect(typeaheadIndex([], "a", 0)).toBe(-1);
    expect(typeaheadIndex(shells, "", 0)).toBe(-1);
  });
});
