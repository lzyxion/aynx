import { describe, expect, it } from "vitest";
import { tileRefreshOf } from "./tile-refresh";

const key = (o: Partial<KeyboardEvent> = {}) => ({
  code: "F5",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  defaultPrevented: false,
  ...o,
});
const on = { selected: true, modal: false, dataTab: false };

describe("DB 타일의 F5", () => {
  it("선택된 DB 타일 — 데이터 탭이면 데이터, SQL 탭이면 트리", () => {
    expect(tileRefreshOf(key(), { ...on, dataTab: true })).toBe("data");
    expect(tileRefreshOf(key(), on)).toBe("tree");
  });

  it("선택된 타일이 아니거나 모달이 떠 있으면 앱의 몫", () => {
    expect(tileRefreshOf(key(), { ...on, selected: false })).toBeNull();
    expect(tileRefreshOf(key(), { ...on, modal: true })).toBeNull();
  });

  it("맨 F5 만 — 수식 · 이미 가져간 키 · 다른 키는 건드리지 않는다", () => {
    expect(tileRefreshOf(key({ ctrlKey: true }), on)).toBeNull();
    expect(tileRefreshOf(key({ shiftKey: true }), on)).toBeNull();
    expect(tileRefreshOf(key({ defaultPrevented: true }), on)).toBeNull();
    expect(tileRefreshOf(key({ code: "KeyR", ctrlKey: true }), on)).toBeNull();
  });
});
