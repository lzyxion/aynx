import { describe, expect, it } from "vitest";
import { hookEventNames } from "./hook-preview";

describe("hookEventNames", () => {
  it("hooks 객체의 키를 원문 순서대로", () => {
    const preview = JSON.stringify({ hooks: { UserPromptSubmit: [], PreToolUse: [], Stop: [] } }, null, 2);
    expect(hookEventNames(preview)).toEqual(["UserPromptSubmit", "PreToolUse", "Stop"]);
  });

  it("빈 hooks 는 빈 목록", () => {
    expect(hookEventNames('{"hooks": {}}')).toEqual([]);
  });

  it("깨진 JSON · 다른 꼴이면 null", () => {
    expect(hookEventNames("")).toBeNull();
    expect(hookEventNames("{ hooks")).toBeNull();
    expect(hookEventNames("[]")).toBeNull();
    expect(hookEventNames('{"other": {}}')).toBeNull();
    expect(hookEventNames('{"hooks": []}')).toBeNull();
    expect(hookEventNames('{"hooks": null}')).toBeNull();
  });
});
