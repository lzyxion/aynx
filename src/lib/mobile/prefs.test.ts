import { describe, expect, it } from "vitest";
import {
  AI_FACES,
  clampFont,
  FONT_MAX,
  FONT_MIN,
  INPUT_MODES,
  isDefaultStrip,
  moveStrip,
  parseAiFace,
  parseInputMode,
  parseFont,
  parseStrip,
  parseTheme,
  resolveTheme,
  serializeAiFace,
  serializeInputMode,
  serializeStrip,
  serializeTheme,
  THEME_PREFS,
  STRIP_DEFAULT,
  toggleStrip,
  visibleStrip,
} from "./prefs";

describe("폰 터미널 글자 크기", () => {
  it("범위로 접고 정수로", () => {
    expect(clampFont(3)).toBe(FONT_MIN);
    expect(clampFont(99)).toBe(FONT_MAX);
    expect(clampFont(13.6)).toBe(14);
    expect(clampFont(Number.NaN)).toBe(FONT_MIN);
  });
  it("저장 글자 — 없거나 못 읽으면 메인 PC 설정(null)", () => {
    expect(parseFont(null)).toBeNull();
    expect(parseFont("")).toBeNull();
    expect(parseFont("abc")).toBeNull();
    expect(parseFont("12")).toBe(12);
    expect(parseFont("40")).toBe(FONT_MAX);
  });
});

describe("폰 테마", () => {
  it("기본 · 없거나 모르는 글자는 메인 PC(이 기기 값 없음)", () => {
    for (const raw of [null, "", "weird", "main", "SYSTEM", " dark"]) expect(parseTheme(raw)).toBe("main");
    expect(resolveTheme("main", true)).toBeNull();
    expect(resolveTheme("main", false)).toBeNull();
  });
  it("시스템은 이 기기 밝기 · 밝게 · 어둡게는 그대로", () => {
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
  it("저장 — 메인 PC 는 지우고(null) 나머지는 글자 그대로 · 되읽으면 같다", () => {
    expect(serializeTheme("main")).toBeNull();
    for (const pref of THEME_PREFS) expect(parseTheme(serializeTheme(pref))).toBe(pref);
  });
  it("세그먼트 순서 — 메인 PC 가 맨 앞", () => {
    expect(THEME_PREFS).toEqual(["main", "system", "light", "dark"]);
  });
});

describe("키 띠 설정", () => {
  it("없거나 틀린 글자는 기본(오늘의 띠)", () => {
    for (const raw of [null, "", "{", "[]", "3", JSON.stringify({ order: "x" })]) {
      const p = parseStrip(raw);
      expect(p.order).toEqual([...STRIP_DEFAULT]);
      expect(p.hidden).toEqual([]);
      expect(isDefaultStrip(p)).toBe(true);
    }
  });

  it("모르는 id 는 버리고 · 겹친 것은 한 번 · 빠진 것은 끝에", () => {
    const p = parseStrip(JSON.stringify({ order: ["enter", "nope", "esc", "enter"], hidden: ["tab", "zzz", "tab"] }));
    expect(p.order.slice(0, 2)).toEqual(["enter", "esc"]);
    expect(p.order).toHaveLength(STRIP_DEFAULT.length);
    expect(new Set(p.order).size).toBe(STRIP_DEFAULT.length);
    expect(p.hidden).toEqual(["tab"]);
    expect(visibleStrip(p)).not.toContain("tab");
  });

  it("왕복 · 켜고 끄기 · 옮기기(끝에서는 그대로)", () => {
    let p = parseStrip(null);
    p = toggleStrip(p, "esc");
    expect(visibleStrip(p)).not.toContain("esc");
    p = toggleStrip(p, "esc");
    expect(visibleStrip(p)).toContain("esc");
    p = moveStrip(p, "esc", -1);
    expect(p.order.slice(0, 2)).toEqual(["esc", "ctrl"]);
    expect(moveStrip(p, "esc", -1).order).toEqual(p.order);
    expect(moveStrip(p, "enter", 1).order).toEqual(p.order);
    expect(isDefaultStrip(p)).toBe(false);
    expect(parseStrip(serializeStrip(p))).toEqual(p);
  });
});

describe("입력 방식", () => {
  it("없거나 모르는 글자는 입력 칸(기본)", () => {
    for (const raw of [null, "", "field", "Direct", "nope", "{}"]) expect(parseInputMode(raw)).toBe("field");
    expect(parseInputMode("direct")).toBe("direct");
    expect(parseInputMode(" direct ")).toBe("direct");
  });

  it("기본은 지우고 · 나머지는 왕복", () => {
    expect(INPUT_MODES[0]).toBe("field");
    expect(serializeInputMode("field")).toBeNull();
    for (const m of INPUT_MODES) expect(parseInputMode(serializeInputMode(m))).toBe(m);
  });

  it("옛 띠의 입력 칸 단추(input)는 모르는 id 로 버린다", () => {
    const p = parseStrip(JSON.stringify({ order: ["input", "esc"], hidden: ["input"] }));
    expect(p.order).not.toContain("input");
    expect(p.hidden).toEqual([]);
    expect(p.order[0]).toBe("esc");
  });
});

describe("AI 타일 첫 화면", () => {
  it("없거나 모르는 글자는 대화(기본)", () => {
    for (const raw of [null, "", "convo", "Term", "nope", "{}"]) expect(parseAiFace(raw)).toBe("convo");
    expect(parseAiFace("term")).toBe("term");
    expect(parseAiFace(" term ")).toBe("term");
  });

  it("기본값은 저장하지 않고 왕복한다", () => {
    expect(serializeAiFace("convo")).toBeNull();
    expect(serializeAiFace("term")).toBe("term");
    for (const f of AI_FACES) expect(parseAiFace(serializeAiFace(f))).toBe(f);
  });
});
