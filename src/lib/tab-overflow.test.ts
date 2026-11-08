import { describe, expect, it } from "vitest";
import { elidedTabIds, tabCapacity } from "./tab-overflow";

const fit = { width: 400, slot: 40, reserve: 60, more: 44 };

describe("tabCapacity", () => {
  it("다 들어가면 전부", () => {
    expect(tabCapacity(fit, 8)).toBe(8); // 8*40 + 60 = 380
  });
  it("넘치면 +N 자리를 빼고 센다", () => {
    expect(tabCapacity(fit, 9)).toBe(7); // (400-60-44)/40 = 7.4
  });
  it("아무리 좁아도 한 칸은 그린다", () => {
    expect(tabCapacity({ ...fit, width: 50 }, 5)).toBe(1);
  });
  it("아직 재지 못했으면 전부", () => {
    expect(tabCapacity({ ...fit, width: 0 }, 30)).toBe(30);
  });
});

describe("elidedTabIds", () => {
  const ids = ["a", "b", "c", "d", "e"];
  it("다 들어가면 아무것도 안 접는다", () => {
    expect(elidedTabIds(ids, "e", 5).size).toBe(0);
  });
  it("뒤에서부터 접는다", () => {
    expect([...elidedTabIds(ids, "a", 3)]).toEqual(["d", "e"]);
  });
  it("활성 탭은 마지막 칸을 받아 늘 보인다", () => {
    expect([...elidedTabIds(ids, "e", 3)]).toEqual(["c", "d"]);
  });
  it("한 칸뿐이면 활성 탭만", () => {
    expect([...elidedTabIds(ids, "d", 1)]).toEqual(["a", "b", "c", "e"]);
  });
});
