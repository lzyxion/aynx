// **원격 창의 모바일 정책**(원격 웹 R5) — 순수 모듈. 상태는 `app/mobile.svelte.ts` 가 쥐고, 판정은 여기서 한다.
//
// - **모바일 배치**: 원격 창이고 폭이 720px 보다 좁다 → 타일 하나 + 위 띠 + 아래 키 띠(`+page`). 집 PC 창은 좁아도 바뀌지 않는다.
// - **크기 주인 자격**: 폰(모바일 배치 · 터치가 주 입력인 기기)은 기본으로 크기 주인이 되지 않는다 — 폰에서 쳐도 집 PC 창의 셸 크기를
//   빼앗지 않고 주인의 크기로 그린다(서버 `sizeOwnerEligible:false`). "이 기기 크기로 맞추기" 를 켜면 자격이 생긴다(이 기기에만 기억).
// - **시청 구독**: 페이지가 뒤로 가 있으면(백그라운드) 시청자를 떼고, 모바일 배치에서는 화면에 없는 터미널 타일도 뗀다 — 돌아오면 받은
//   자리부터 다시 붙어 재동기화한다(데이터 · 배터리). 데스크톱 원격의 숨은 탭은 예전처럼 붙어 있다(탭 전환마다 재생하지 않게).

/** 모바일 배치가 되는 폭의 상한(이보다 좁으면) */
export const MOBILE_MAX_WIDTH = 720;

export interface DeviceState {
  /** 원격 창인가 */
  remote: boolean;
  /** 폭이 [`MOBILE_MAX_WIDTH`] 보다 좁다 */
  narrow: boolean;
  /** 주 입력이 터치(`pointer: coarse`) */
  coarse: boolean;
  /** 사용자가 "이 기기 크기로 맞추기" 를 켰다 */
  fitHere: boolean;
}

/** 타일 하나 + 띠 배치를 쓰나 */
export function isMobileLayout(d: Pick<DeviceState, "remote" | "narrow">): boolean {
  return d.remote && d.narrow;
}

/** 이 기기가 폰 취급(크기 주인 기본 거짓)인가 — 원격이고 좁거나 터치가 주 입력 */
export function isHandheld(d: Pick<DeviceState, "remote" | "narrow" | "coarse">): boolean {
  return d.remote && (d.narrow || d.coarse);
}

/** 시청자로 붙을 때 크기 주인 자격(`sizeOwnerEligible`) — 폰은 사용자가 켰을 때만 */
export function sizeOwnerEligible(d: DeviceState): boolean {
  return !isHandheld(d) || d.fitHere;
}

/**
 * 이 터미널 타일이 지금 시청자로 붙어 있어야 하나 — 페이지가 보이고, 모바일 배치면 그 타일이 화면에 있을 때. 집 PC 창은 늘 참
 * (시청자가 아니다 — 부르는 쪽이 원격 시청자에만 쓴다).
 */
export function wantsViewer(d: Pick<DeviceState, "remote" | "narrow">, pageVisible: boolean, tileShown: boolean): boolean {
  if (!d.remote) return true;
  if (!pageVisible) return false;
  return !isMobileLayout(d) || tileShown;
}

/** 떼기 전 기다림(ms) — 잠깐 다른 타일 · 다른 앱을 보고 돌아오는 것에 재생을 치르지 않게. 페이지가 숨으면 더 길게. */
export function parkDelayMs(pageVisible: boolean): number {
  return pageVisible ? 3_000 : 10_000;
}

/** 터치 기기의 원격 창은 WebGL 을 쓰지 않는다(모바일 GPU 컨텍스트 상실 · 메모리) — DOM 렌더러 */
export function preferDomRenderer(d: Pick<DeviceState, "remote" | "narrow" | "coarse">): boolean {
  return isHandheld(d);
}
