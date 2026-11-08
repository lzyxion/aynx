import { describe, expect, it } from "vitest";
import { addTags, removeTagAt, splitTagText } from "$lib/tag-input";

/** 태그 칩 입력의 순수 규칙 (docs/log/2026-09-20-host-form-tabs.md 의 "태그 = 칩 입력") */

describe("splitTagText", () => {
  it("쉼표로 쪼개고 앞뒤 공백을 다듬는다", () => {
    expect(splitTagText("prod, web")).toEqual(["prod", "web"]);
    expect(splitTagText("  prod  ")).toEqual(["prod"]);
  });

  it("빈 조각은 버린다 (쉼표만 친 손가락)", () => {
    expect(splitTagText("")).toEqual([]);
    expect(splitTagText("   ")).toEqual([]);
    expect(splitTagText(",,")).toEqual([]);
    expect(splitTagText("a,,b")).toEqual(["a", "b"]);
  });

  it("줄바꿈도 구분자다 — 목록을 통째로 붙여 넣는 길", () => {
    expect(splitTagText("a\nb\r\nc")).toEqual(["a", "b", "c"]);
  });

  it("태그 안의 공백은 지키다 (한 낱말로 만들지 않는다)", () => {
    expect(splitTagText("web server, db")).toEqual(["web server", "db"]);
  });
});

describe("addTags", () => {
  it("없는 것만 뒤에 붙인다 — 차례는 그대로", () => {
    expect(addTags(["prod"], "web")).toEqual(["prod", "web"]);
    expect(addTags(["prod"], "a, b")).toEqual(["prod", "a", "b"]);
  });

  it("이미 있는 것은 건너뛴다", () => {
    expect(addTags(["prod", "web"], "web")).toEqual(["prod", "web"]);
    expect(addTags(["prod"], "prod, new")).toEqual(["prod", "new"]);
  });

  it("한 번에 친 글자 안의 중복도 한 번만", () => {
    expect(addTags([], "a, a, b")).toEqual(["a", "b"]);
  });

  it("대소문자는 **가린다** — 사람이 붙인 이름표라 `Web` 과 `web` 은 다른 태그다", () => {
    expect(addTags(["web"], "Web")).toEqual(["web", "Web"]);
  });

  it("바뀐 것이 없으면 **같은 배열**을 그대로 (새 참조를 만들지 않는다)", () => {
    const list = ["prod", "web"];
    expect(addTags(list, "web")).toBe(list);
    expect(addTags(list, "   ")).toBe(list);
    expect(addTags(list, "new")).not.toBe(list);
  });

  it("원본을 건드리지 않는다", () => {
    const list = ["prod"];
    addTags(list, "web");
    expect(list).toEqual(["prod"]);
  });
});

describe("removeTagAt", () => {
  it("그 자리 하나만 뺀다", () => {
    expect(removeTagAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeTagAt(["a"], 0)).toEqual([]);
  });

  it("범위 밖이면 같은 배열 그대로", () => {
    const list = ["a", "b"];
    expect(removeTagAt(list, -1)).toBe(list);
    expect(removeTagAt(list, 2)).toBe(list);
  });

  it("원본을 건드리지 않는다", () => {
    const list = ["a", "b"];
    removeTagAt(list, 0);
    expect(list).toEqual(["a", "b"]);
  });
});
