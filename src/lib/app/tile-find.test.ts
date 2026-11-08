import { describe, expect, it } from "vitest";
import { openFindZoneIn, openTileFind, registerFindZone, registerTileFind } from "$lib/app/tile-find";

describe("타일 찾기 문", () => {
  it("적힌 함수가 없으면 false — 터미널 검색으로 떨어진다", () => {
    expect(openTileFind("none")).toBe(false);
  });

  it("여는 함수의 답을 그대로 돌려준다(대화 면이 아니면 false 등)", () => {
    let convo = false;
    const off = registerTileFind("ai", () => convo);
    expect(openTileFind("ai")).toBe(false);
    convo = true;
    expect(openTileFind("ai")).toBe(true);
    off();
    expect(openTileFind("ai")).toBe(false);
  });

  it("다시 적은 뒤 옛 푸는 함수는 새 함수를 지우지 않는다(재마운트 순서)", () => {
    const offOld = registerTileFind("doc", () => true);
    const offNew = registerTileFind("doc", () => true);
    offOld();
    expect(openTileFind("doc")).toBe(true);
    offNew();
    expect(openTileFind("doc")).toBe(false);
  });
});

describe("찾기 자리", () => {
  const zoneEl = { matches: () => true, querySelector: () => null };
  const box = (inner: object | null) => ({ matches: () => false, querySelector: () => inner });

  it("상자 안의 첫 구역을 연다 — 상자 자신이 구역이어도", () => {
    let opened = 0;
    const off = registerFindZone(zoneEl, () => (opened++, true));
    expect(openFindZoneIn(box(zoneEl))).toBe(true);
    expect(openFindZoneIn(zoneEl)).toBe(true);
    expect(opened).toBe(2);
    off();
    expect(openFindZoneIn(box(zoneEl))).toBe(false);
  });

  it("구역이 없거나 묶이지 않았으면 false", () => {
    expect(openFindZoneIn(box(null))).toBe(false);
    expect(openFindZoneIn(box({ matches: () => true, querySelector: () => null }))).toBe(false);
  });
});
