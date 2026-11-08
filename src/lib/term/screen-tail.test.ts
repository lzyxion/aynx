import { describe, expect, it } from "vitest";
import { SCREEN_PUSH_MAX_MS, SCREEN_PUSH_QUIET_MS, screenPushDelay, screenTail, type TailBuffer } from "./screen-tail";

/** 줄 문자열(오른쪽 공백 포함 가능)과 래핑 표시로 가짜 버퍼를 만든다 */
function fake(rows: Array<string | [string, boolean]>): TailBuffer {
  const lines = rows.map((r) => (typeof r === "string" ? { text: r, wrapped: false } : { text: r[0], wrapped: r[1] }));
  return {
    length: lines.length,
    getLine: (i) =>
      i >= 0 && i < lines.length
        ? {
            isWrapped: lines[i].wrapped,
            translateToString: (trim?: boolean) => (trim ? lines[i].text.replace(/\s+$/, "") : lines[i].text),
          }
        : undefined,
  };
}

describe("screenTail", () => {
  it("마지막 N줄만 낸다", () => {
    expect(screenTail(fake(["a", "b", "c", "d"]), 2)).toEqual(["c", "d"]);
  });

  it("뒤쪽 빈 줄은 떼고 가운데 빈 줄은 둔다", () => {
    expect(screenTail(fake(["a", "", "b  ", "   ", ""]), 10)).toEqual(["a", "", "b"]);
  });

  it("뒤쪽 빈 줄을 뗀 뒤에 N줄을 센다", () => {
    expect(screenTail(fake(["a", "b", "c", "", "", ""]), 2)).toEqual(["b", "c"]);
  });

  it("래핑된 줄은 앞줄에 이어 붙이고 이어지는 줄의 공백은 남긴다", () => {
    expect(screenTail(fake(["$ ls ", ["가나 다", true], "x"]), 10)).toEqual(["$ ls 가나 다", "x"]);
  });

  it("빈 버퍼·0줄은 빈 목록", () => {
    expect(screenTail(fake(["", ""]), 10)).toEqual([]);
    expect(screenTail(fake(["a"]), 0)).toEqual([]);
  });
});

describe("screenPushDelay", () => {
  it("막 시작한 출력은 잠잠함을 기다린다", () => {
    expect(screenPushDelay(1000, 1000)).toBe(SCREEN_PUSH_QUIET_MS);
  });

  it("상한이 가까우면 남은 만큼만 기다린다", () => {
    expect(screenPushDelay(4500, 0)).toBe(SCREEN_PUSH_MAX_MS - 4500);
  });

  it("상한을 지났으면 곧바로", () => {
    expect(screenPushDelay(9000, 0)).toBe(0);
  });
});
