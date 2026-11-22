import { describe, expect, it } from "vitest";
import { claimsOnAttach, dropsFitOnLoss, isHandheld, isMobileLayout, parkDelayMs, preferDomRenderer, sizeOwnerEligible, wantsViewer } from "./policy";

const home = { remote: false, narrow: true, coarse: true, fitHere: false };
const phone = { remote: true, narrow: true, coarse: true, fitHere: false };
const tablet = { remote: true, narrow: false, coarse: true, fitHere: false };
const desk = { remote: true, narrow: false, coarse: false, fitHere: false };

describe("모바일 정책(원격 웹 R5)", () => {
  it("모바일 배치는 원격 창 · 좁은 폭만 — 메인 PC 창은 좁아도 그대로", () => {
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
    // 메인 PC 창은 늘 참(시청자가 아니다)
    expect(wantsViewer(home, false, false)).toBe(true);
  });

  it("폰 배치의 이 기기 크기로 맞추기 — 켜 있으면 붙자마자 되찾는다(태블릿 · 데스크톱은 카드 길)", () => {
    expect(claimsOnAttach({ ...phone, fitHere: true })).toBe(true);
    expect(claimsOnAttach(phone)).toBe(false);
    expect(claimsOnAttach({ ...tablet, fitHere: true })).toBe(false);
    expect(claimsOnAttach({ ...desk, fitHere: true })).toBe(false);
    expect(claimsOnAttach({ ...home, fitHere: true })).toBe(false);
  });

  it("보이는 폰 타일이 주인을 잃으면 끈다 — 주인이 아니었거나 숨은 타일이면 그대로", () => {
    const on = { ...phone, fitHere: true };
    expect(dropsFitOnLoss(on, true, true, false)).toBe(true);
    expect(dropsFitOnLoss(on, true, false, false)).toBe(false);
    expect(dropsFitOnLoss(on, true, true, true)).toBe(false);
    expect(dropsFitOnLoss(on, false, true, false)).toBe(false);
    expect(dropsFitOnLoss(phone, true, true, false)).toBe(false);
    expect(dropsFitOnLoss({ ...tablet, fitHere: true }, true, true, false)).toBe(false);
  });

  it("떼기 전 기다림 · 렌더러", () => {
    expect(parkDelayMs(true)).toBeLessThan(parkDelayMs(false));
    expect(preferDomRenderer(phone)).toBe(true);
    expect(preferDomRenderer(desk)).toBe(false);
    expect(preferDomRenderer(home)).toBe(false);
  });
});
