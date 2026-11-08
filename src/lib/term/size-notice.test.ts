import { describe, expect, it } from "vitest";
import { CARD_GAP, noticeActions, noticeSide, outlineBox, placeCard } from "./size-notice";

describe("noticeSide", () => {
  it("names the owner from this window's point of view", () => {
    // 집 PC 창 — 주인이 주가 아니면 원격 기기(모르면 원격 기기로).
    expect(noticeSide(false, false)).toBe("remoteDevice");
    expect(noticeSide(false, undefined)).toBe("remoteDevice");
    expect(noticeSide(false, true)).toBe("otherWindow");
    // 원격 창 — 주가 주인이면 메인 PC, 아니면 다른 창(다른 원격 기기).
    expect(noticeSide(true, true)).toBe("mainPc");
    expect(noticeSide(true, false)).toBe("otherWindow");
    expect(noticeSide(true, undefined)).toBe("otherWindow");
  });
});

describe("placeCard", () => {
  const card = { width: 260, height: 120 };

  it("puts the card right of a narrow region", () => {
    const p = placeCard({ width: 1000, height: 600 }, { width: 400, height: 500 }, card);
    expect(p?.side).toBe("right");
    expect(p!.left).toBe(400 + (600 - 260) / 2);
    expect(p!.top).toBeGreaterThanOrEqual(CARD_GAP);
    expect(p!.top + card.height).toBeLessThanOrEqual(600 - CARD_GAP);
  });

  it("puts the card below a short wide region", () => {
    const p = placeCard({ width: 1000, height: 600 }, { width: 980, height: 200 }, card);
    expect(p?.side).toBe("below");
    expect(p!.top).toBe(200 + (400 - 120) / 2);
    expect(p!.left).toBeGreaterThanOrEqual(CARD_GAP);
  });

  it("picks the roomier side when both fit", () => {
    expect(placeCard({ width: 1000, height: 600 }, { width: 300, height: 300 }, card)?.side).toBe("right");
    expect(placeCard({ width: 1000, height: 1000 }, { width: 700, height: 300 }, card)?.side).toBe("below");
  });

  it("gives up when the region is only slightly smaller", () => {
    expect(placeCard({ width: 1000, height: 600 }, { width: 900, height: 560 }, card)).toBeNull();
    // 영역이 상자보다 커도(스크롤) 빈 자리는 없다.
    expect(placeCard({ width: 500, height: 300 }, { width: 900, height: 900 }, card)).toBeNull();
  });

  it("stays inside a short box", () => {
    expect(placeCard({ width: 1000, height: 130 }, { width: 300, height: 100 }, card)).toBeNull();
  });
});

describe("noticeActions", () => {
  it("offers one button for one shrunk tile, two for more", () => {
    expect(noticeActions(1).map((a) => a.act)).toEqual(["tile"]);
    expect(noticeActions(0)[0].label).toBe("pane.sizeNotice.fitHere");
    expect(noticeActions(2).map((a) => a.act)).toEqual(["tile", "all"]);
    expect(noticeActions(3).map((a) => a.label)).toEqual(["pane.sizeNotice.fitTile", "pane.sizeNotice.fitAll"]);
    // 자격 없는 이 기기(폰) — 몇 개든 "이 기기 크기로" 하나.
    expect(noticeActions(3, false)).toEqual([{ act: "tile", label: "pane.sizeNotice.fitDevice" }]);
  });
});

describe("outlineBox", () => {
  it("clips the drawn region to the box", () => {
    expect(outlineBox({ width: 500, height: 300 }, { width: 400, height: 600 })).toEqual({ width: 400, height: 300 });
  });
});
