import { describe, expect, it } from "vitest";
import {
  SVG_DEFAULT_NAME,
  fileImageName,
  freeFileName,
  imageMenuActions,
  imageSaveFilters,
  sanitizeFileStem,
  svgFileName,
} from "$lib/image-menu";

describe("imageMenuActions", () => {
  it("파일 그림은 링크 복사, svg 블록은 SVG 코드 복사", () => {
    expect(imageMenuActions("file", false)).toEqual(["download", "saveAs", "copyImage", "copyLink"]);
    expect(imageMenuActions("svg", false)).toEqual(["download", "saveAs", "copyImage", "copySvg"]);
  });

  it("원격 창에는 저장 대화상자 항목이 없다", () => {
    expect(imageMenuActions("file", true)).toEqual(["download", "copyImage", "copyLink"]);
    expect(imageMenuActions("svg", true)).toEqual(["download", "copyImage", "copySvg"]);
    expect(imageMenuActions("inline", false)).toEqual(["download", "saveAs", "copyImage"]);
    expect(imageMenuActions("inline", true)).toEqual(["download", "copyImage"]);
  });
});

describe("freeFileName", () => {
  it("겹치지 않으면 그대로", () => {
    expect(freeFileName("a.png", ["b.png"])).toBe("a.png");
  });

  it("겹치면 확장자 앞에 (1) · (2) …", () => {
    expect(freeFileName("a.png", ["a.png"])).toBe("a (1).png");
    expect(freeFileName("a.png", ["a.png", "a (1).png"])).toBe("a (2).png");
  });

  it("대소문자는 가리지 않는다", () => {
    expect(freeFileName("A.PNG", ["a.png"])).toBe("A (1).PNG");
  });

  it("확장자가 없거나 점으로 시작하는 이름", () => {
    expect(freeFileName("image", ["image"])).toBe("image (1)");
    expect(freeFileName(".png", [".png"])).toBe(".png (1)");
    expect(freeFileName("my.chart.svg", ["my.chart.svg"])).toBe("my.chart (1).svg");
  });
});

describe("이름", () => {
  it("파일 그림은 원래 이름 — 두 구분자 모두", () => {
    expect(fileImageName("C:\\Users\\me\\pics\\cat.png")).toBe("cat.png");
    expect(fileImageName("/home/me/a b.svg")).toBe("a b.svg");
  });

  it("svg 는 <title> 이 있으면 그 글자, 없으면 image.svg", () => {
    expect(svgFileName('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')).toBe(SVG_DEFAULT_NAME);
    expect(svgFileName("<svg><title>Sales chart</title></svg>")).toBe("Sales chart.svg");
    expect(svgFileName('<svg><title id="t">a/b: c?</title></svg>')).toBe("a_b_ c_.svg");
    expect(svgFileName("<svg><title>  ...  </title></svg>")).toBe(SVG_DEFAULT_NAME);
  });

  it("줄기 다듬기 — 못 쓰는 글자 · 앞뒤 점 · 길이", () => {
    expect(sanitizeFileStem(' <a>\n"b" ')).toBe("_a_ _b_");
    expect(sanitizeFileStem("..x..")).toBe("x");
    expect(sanitizeFileStem("x".repeat(200))).toHaveLength(80);
  });

  it("저장 대화상자 형식 칸 — 그림 확장자만", () => {
    expect(imageSaveFilters("a.PNG")).toEqual([{ name: "PNG", extensions: ["png"] }]);
    expect(imageSaveFilters("image.svg")).toEqual([{ name: "SVG", extensions: ["svg"] }]);
    expect(imageSaveFilters("noext")).toEqual([]);
  });
});
