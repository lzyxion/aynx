import { describe, expect, it } from "vitest";
import { SVG_MAX_BYTES, isSvgLang, svgPlan } from "$lib/svg-text";

describe("isSvgLang", () => {
  it("svg 만 — 대소문자 · 공백 무시", () => {
    expect(isSvgLang("svg")).toBe(true);
    expect(isSvgLang(" SVG ")).toBe(true);
    expect(isSvgLang("xml")).toBe(false);
    expect(isSvgLang("svgz")).toBe(false);
    expect(isSvgLang(null)).toBe(false);
    expect(isSvgLang(undefined)).toBe(false);
  });
});

describe("svgPlan — 그릴지", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4"/></svg>';
  it("<svg 태그가 있으면 그린다", () => {
    expect(svgPlan(svg)).toBe("draw");
    expect(svgPlan('<?xml version="1.0"?>\n<SVG>\n</SVG>')).toBe("draw");
    expect(svgPlan("<svg/>")).toBe("draw");
  });
  it("태그가 없으면(조각 · 설명) 원문", () => {
    expect(svgPlan("<circle r='4'/>")).toBe("not-svg");
    expect(svgPlan("<svgfoo>")).toBe("not-svg");
    expect(svgPlan("")).toBe("not-svg");
  });
  it("상한은 UTF-8 바이트로 잰다", () => {
    const pad = (n: number) => `<svg>${"a".repeat(n)}</svg>`;
    const head = "<svg></svg>".length;
    expect(svgPlan(pad(SVG_MAX_BYTES - head))).toBe("draw");
    expect(svgPlan(pad(SVG_MAX_BYTES - head + 1))).toBe("large");
    // 한글은 한 글자 3바이트 — 글자 수는 상한의 1/3 을 조금 넘을 뿐이어도 넘는다
    expect(svgPlan(`<svg>${"가".repeat(Math.ceil(SVG_MAX_BYTES / 3))}</svg>`)).toBe("large");
    expect(svgPlan(`<svg>${"가".repeat(Math.floor((SVG_MAX_BYTES - head) / 3))}</svg>`)).toBe("draw");
  });
});
