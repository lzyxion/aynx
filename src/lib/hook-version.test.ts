import { describe, expect, it } from "vitest";
import { createOnceGate, hookNoticeKey, hookOutdated, sentVersionOf } from "$lib/hook-version";

describe("hookOutdated", () => {
  it("판을 싣지 않은 신호(4판 이하)는 옛 판", () => {
    expect(hookOutdated(undefined, 5)).toBe(true);
    expect(hookOutdated(null, 5)).toBe(true);
  });
  it("보낸 판이 낮으면 옛 판, 같거나 높으면 아니다", () => {
    expect(hookOutdated(4, 5)).toBe(true);
    expect(hookOutdated(5, 5)).toBe(false);
    expect(hookOutdated(6, 5)).toBe(false);
  });
  it("기준 판이 없으면 판정하지 않는다 (옛 Rust · 손 신호)", () => {
    expect(hookOutdated(undefined, undefined)).toBe(false);
    expect(hookOutdated(null, null)).toBe(false);
    expect(hookOutdated(3, "5")).toBe(false);
  });
  it("정수가 아닌 판은 없는 것으로 친다", () => {
    expect(hookOutdated("5", 5)).toBe(true);
    expect(hookOutdated(4.5, 5)).toBe(true);
    expect(hookOutdated(0, 5)).toBe(true);
  });
});

describe("sentVersionOf", () => {
  it("없으면 4판 이하", () => {
    expect(sentVersionOf(undefined)).toEqual({ n: 4, orOlder: true });
    expect(sentVersionOf(null)).toEqual({ n: 4, orOlder: true });
  });
  it("있으면 그 판", () => {
    expect(sentVersionOf(3)).toEqual({ n: 3, orOlder: false });
  });
});

describe("hookNoticeKey · createOnceGate", () => {
  it("원격은 별칭(대소문자·공백 무시)마다, 로컬은 하나", () => {
    expect(hookNoticeKey({ remote: " Dev-01 " })).toBe(hookNoticeKey({ remote: "dev-01" }));
    expect(hookNoticeKey({ remote: "dev-01" })).not.toBe(hookNoticeKey({ remote: "dev-02" }));
    expect(hookNoticeKey({ remote: null })).toBe("local");
  });
  it("같은 열쇠는 한 번만 통과한다", () => {
    const once = createOnceGate();
    expect(once("remote:dev-01")).toBe(true);
    expect(once("remote:dev-01")).toBe(false);
    expect(once("remote:dev-02")).toBe(true);
    expect(once("local")).toBe(true);
    expect(once("local")).toBe(false);
    // 문지기마다 따로 센다
    expect(createOnceGate()("remote:dev-01")).toBe(true);
  });
});
