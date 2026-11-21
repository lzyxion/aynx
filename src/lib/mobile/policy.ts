// 원격 창의 모바일 정책 — 순수 모듈. 메인 PC 창은 좁아도 모바일 배치가 되지 않는다.
// 폰은 기본으로 크기 주인이 되지 않는다 — 폰에서 쳐도 메인 PC 창의 셸 크기를 빼앗지 않는다("이 기기 크기로 맞추기" 를 켜면 자격이 생긴다).

export const MOBILE_MAX_WIDTH = 720;

export interface DeviceState {
  remote: boolean;
  narrow: boolean;
  /** 주 입력이 터치(`pointer: coarse`) */
  coarse: boolean;
  fitHere: boolean;
}

export function isMobileLayout(d: Pick<DeviceState, "remote" | "narrow">): boolean {
  return d.remote && d.narrow;
}

export function isHandheld(d: Pick<DeviceState, "remote" | "narrow" | "coarse">): boolean {
  return d.remote && (d.narrow || d.coarse);
}

export function sizeOwnerEligible(d: DeviceState): boolean {
  return !isHandheld(d) || d.fitHere;
}

/** 데스크톱 원격의 숨은 탭은 붙어 있다 — 탭 전환마다 재생하지 않게 */
export function wantsViewer(d: Pick<DeviceState, "remote" | "narrow">, pageVisible: boolean, tileShown: boolean): boolean {
  if (!d.remote) return true;
  if (!pageVisible) return false;
  return !isMobileLayout(d) || tileShown;
}

/** 잠깐 다른 타일 · 다른 앱을 보고 돌아오는 것에 재생을 치르지 않게 */
export function parkDelayMs(pageVisible: boolean): number {
  return pageVisible ? 3_000 : 10_000;
}

/** 터치 기기의 원격 창은 WebGL 을 쓰지 않는다(모바일 GPU 컨텍스트 상실 · 메모리) */
export function preferDomRenderer(d: Pick<DeviceState, "remote" | "narrow" | "coarse">): boolean {
  return isHandheld(d);
}
