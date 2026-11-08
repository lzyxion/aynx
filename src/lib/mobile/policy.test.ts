import { describe, expect, it } from "vitest";
import { isHandheld, isMobileLayout, parkDelayMs, preferDomRenderer, sizeOwnerEligible, wantsViewer } from "./policy";

const home = { remote: false, narrow: true, coarse: true, fitHere: false };
const phone = { remote: true, narrow: true, coarse: true, fitHere: false };
const tablet = { remote: true, narrow: false, coarse: true, fitHere: false };
const desk = { remote: true, narrow: false, coarse: false, fitHere: false };

describe("모바일 정책(원격 웹 R5)", () => {
  it("모바일 배치는 원격 창 · 좁은 폭만 — 집 PC 창은 좁아도 그대로", () => {
    expect(isMobileLayout(phone)).toBe(true);
    expect(isMobileLayout(home)).toBe(false);
    expect(isMobileLayout(tablet)).toBe(false);
    expect(isMobileLayout({ remote: true, narrow: true })).toBe(true);
  });

  it("폰 · 터치 기기는 크기 주인이 되지 않는다 — 사용자가 켜면 된다", () => {
    expect(sizeOwnerEligible(phone)).toBe(false);
    expect(sizeOwnerEligible(tablet)).toBe(false);
    expect(sizeOwnerEligible({ ...phone, fitHere: true })).toBe(true);
    expect(sizeOwnerEligible(desk)).toBe(true);
    expect(sizeOwnerEligible(home)).toBe(true);
    expect(isHandheld({ remote: true, narrow: true, coarse: false })).toBe(true);
  });

  it("시청 구독 — 페이지가 숨으면 떼고, 모바일 배치는 보이는 타일만", () => {
    expect(wantsViewer(phone, true, true)).toBe(true);
    expect(wantsViewer(phone, true, false)).toBe(false);
    expect(wantsViewer(phone, false, true)).toBe(false);
    // 데스크톱 원격의 숨은 탭은 붙은 채(탭 전환마다 재생하지 않게) · 백그라운드면 뗀다
    expect(wantsViewer(desk, true, false)).toBe(true);
    expect(wantsViewer(desk, false, true)).toBe(false);
    // 집 PC 창은 늘 참(시청자가 아니다)
    expect(wantsViewer(home, false, false)).toBe(true);
  });

  it("떼기 전 기다림 · 렌더러", () => {
    expect(parkDelayMs(true)).toBeLessThan(parkDelayMs(false));
    expect(preferDomRenderer(phone)).toBe(true);
    expect(preferDomRenderer(desk)).toBe(false);
    expect(preferDomRenderer(home)).toBe(false);
  });
});
