import { describe, expect, it } from "vitest";
import { codeSpans } from "./code-spans";

describe("codeSpans", () => {
  it("백틱 없는 글은 맨 글자 한 조각", () => {
    expect(codeSpans("그냥 글")).toEqual([{ text: "그냥 글", code: false }]);
  });

  it("백틱 구간만 코드 조각이 된다", () => {
    expect(codeSpans("`git config --global user.name` · `user.email` 로 설정하세요.")).toEqual([
      { text: "git config --global user.name", code: true },
      { text: " · ", code: false },
      { text: "user.email", code: true },
      { text: " 로 설정하세요.", code: false },
    ]);
  });

  it("빈 조각은 싣지 않는다", () => {
    expect(codeSpans("``")).toEqual([]);
    expect(codeSpans("")).toEqual([]);
  });

  it("짝 없는 마지막 백틱은 글자 그대로 남는다", () => {
    expect(codeSpans("a `b` c `d")).toEqual([
      { text: "a ", code: false },
      { text: "b", code: true },
      { text: " c `d", code: false },
    ]);
  });

  it("HTML 은 글자 그대로 조각에 담긴다(해석하지 않는다)", () => {
    expect(codeSpans("<b>x</b> `<i>`")).toEqual([
      { text: "<b>x</b> ", code: false },
      { text: "<i>", code: true },
    ]);
  });
});
