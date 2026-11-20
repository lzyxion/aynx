import { describe, expect, it } from "vitest";
import { OUTLINE_NARROW_PX } from "$lib/doc-outline";
import {
  DOC_BODY_MIN_W,
  DOC_BOTH_PANELS_MIN_PX,
  DOC_FILES_PANEL_W,
  DOC_OUTLINE_PANEL_W,
  DOC_PANEL_LINE_W,
  docPanelLayout,
  panelToCloseOnOpen,
  type DocPanelLayoutInput,
} from "$lib/doc-side-panels";

const base: DocPanelLayoutInput = { width: 1200, files: false, outline: false, outlineReady: true, last: null };
const lay = (o: Partial<DocPanelLayoutInput>) => docPanelLayout({ ...base, ...o });

describe("상수 관계", () => {
  it("둘 다 서는 최소 폭 = 파일 + 경계 + 목차 + 경계 + 본문 최소", () => {
    expect(DOC_BOTH_PANELS_MIN_PX).toBe(882);
    expect(DOC_BOTH_PANELS_MIN_PX).toBe(
      DOC_FILES_PANEL_W + DOC_PANEL_LINE_W + DOC_OUTLINE_PANEL_W + DOC_PANEL_LINE_W + DOC_BODY_MIN_W,
    );
  });

  it("문턱(640)에서 패널 하나를 세우면 본문은 최소 폭을 넘지 않는다", () => {
    expect(OUTLINE_NARROW_PX - DOC_FILES_PANEL_W - DOC_PANEL_LINE_W).toBeLessThanOrEqual(DOC_BODY_MIN_W);
    expect(OUTLINE_NARROW_PX).toBeLessThan(DOC_BOTH_PANELS_MIN_PX);
  });
});

describe("docPanelLayout", () => {
  it("못 잰 폭(0)은 넓은 쪽 — 켬 값 그대로 · 본문 폭 0", () => {
    expect(lay({ width: 0, files: true, outline: true, last: "outline" })).toEqual({
      narrow: false,
      filesShown: true,
      outlineShown: true,
      bodyW: 0,
    });
  });

  it("639 는 좁다 — 둘 다 패널 아님 · 본문 = 타일 폭", () => {
    expect(lay({ width: 639, files: true, outline: true })).toEqual({
      narrow: true,
      filesShown: false,
      outlineShown: false,
      bodyW: 639,
    });
  });

  it("640 은 넓다 — 하나만 켜면 그 패널", () => {
    expect(lay({ width: 640, files: true })).toEqual({ narrow: false, filesShown: true, outlineShown: false, bodyW: 399 });
    expect(lay({ width: 640, outline: true })).toEqual({ narrow: false, filesShown: false, outlineShown: true, bodyW: 399 });
  });

  it("아무것도 켜지 않으면 본문 = 타일 폭", () => {
    expect(lay({ width: 1000 })).toEqual({ narrow: false, filesShown: false, outlineShown: false, bodyW: 1000 });
  });

  it("둘 다 켬 · 882 이상이면 둘 다", () => {
    expect(lay({ width: 882, files: true, outline: true })).toEqual({
      narrow: false,
      filesShown: true,
      outlineShown: true,
      bodyW: 400,
    });
  });

  it("둘 다 켬 · 882 미만이면 나중에 연 쪽만 — 모르면 파일", () => {
    expect(lay({ width: 881, files: true, outline: true, last: "outline" })).toMatchObject({ filesShown: false, outlineShown: true, bodyW: 640 });
    expect(lay({ width: 881, files: true, outline: true, last: "files" })).toMatchObject({ filesShown: true, outlineShown: false, bodyW: 640 });
    expect(lay({ width: 881, files: true, outline: true, last: null })).toMatchObject({ filesShown: true, outlineShown: false });
  });

  it("목차가 준비되지 않으면 파일만 — 본문 폭도 파일만 뺀다", () => {
    expect(lay({ width: 700, files: true, outline: true, outlineReady: false, last: "outline" })).toEqual({
      narrow: false,
      filesShown: true,
      outlineShown: false,
      bodyW: 459,
    });
    expect(lay({ width: 700, outline: true, outlineReady: false })).toMatchObject({ outlineShown: false, bodyW: 700 });
  });
});

describe("panelToCloseOnOpen", () => {
  const open = (o: Partial<Parameters<typeof panelToCloseOnOpen>[0]>) =>
    panelToCloseOnOpen({ width: 800, opening: "files", files: false, outline: false, outlineReady: true, ...o });

  it("함께 설 폭이 없으면 먼저 열려 있던 쪽", () => {
    expect(open({ opening: "files", outline: true })).toBe("outline");
    expect(open({ opening: "outline", files: true })).toBe("files");
    expect(open({ width: 881, opening: "files", outline: true })).toBe("outline");
  });

  it("폭이 넉넉하면 끄지 않는다", () => {
    expect(open({ width: 882, opening: "files", outline: true })).toBeNull();
  });

  it("다른 쪽이 꺼져 있으면 끌 것이 없다", () => {
    expect(open({ opening: "files" })).toBeNull();
    expect(open({ opening: "outline" })).toBeNull();
  });

  it("목차가 준비되지 않으면 자리를 다투지 않는다", () => {
    expect(open({ opening: "files", outline: true, outlineReady: false })).toBeNull();
    expect(open({ opening: "outline", files: true, outlineReady: false })).toBeNull();
  });

  it("못 잰 폭 · 좁은 타일(드롭다운)에서는 끄지 않는다", () => {
    expect(open({ width: 0, opening: "files", outline: true })).toBeNull();
    expect(open({ width: 639, opening: "files", outline: true })).toBeNull();
    expect(open({ width: 640, opening: "files", outline: true })).toBe("outline");
  });
});
