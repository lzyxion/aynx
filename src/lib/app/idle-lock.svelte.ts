/**
 * 무입력 자동 잠금 — 입력이 일정 시간 없으면 프라이버시 가림막(`Veil`)을 연다.
 * 입력 시계는 메인 PC 창끼리 나눈다 — 가림막은 앱 전체에 서므로, 창마다 따로 세면 쓰지 않던 보조 창이 앱 전체를 가린다.
 * 메신저 알림의 자리 비움 판정도 같은 시계를 읽는다(두 벌이면 어긋난다). 원격 창은 끼지 않는다(`remote/deny.rs`).
 */

import { openVeil, veilVisible } from "$lib/app/veil.svelte.js";
import { emit, isRemote, listen } from "$lib/ipc";
import { settings } from "$lib/settings.svelte.js";

/** 짐 없음 */
export const USER_ACTIVE_EVENT = "user-active";

const SHARE_MS = 30_000;

const CHECK_MS = 5000;

const BUMP_THROTTLE_MS = 1000;

/** 리스너를 걸기 전이면 모듈이 뜬 시각이 마지막 입력이다 */
let lastActivity = Date.now();

export function msSinceLastInput(now: number = Date.now()): number {
  return Math.max(0, now - lastActivity);
}

export function installIdleLock(): () => void {
  lastActivity = Date.now();
  let lastBump = 0;
  let lastShare = 0;

  function bump(): void {
    const now = Date.now();
    if (now - lastBump < BUMP_THROTTLE_MS) return;
    lastBump = now;
    lastActivity = now;
    // 제 이벤트를 제가 받아도 같은 값이라 무해하다
    if (!isRemote && now - lastShare >= SHARE_MS) {
      lastShare = now;
      void emit(USER_ACTIVE_EVENT).catch(() => {});
    }
  }

  const shared = isRemote
    ? Promise.resolve(() => {})
    : listen(USER_ACTIVE_EVENT, () => {
        lastActivity = Math.max(lastActivity, Date.now());
      }).catch(() => () => {});

  // 여는 조건이라 이동 · 휠도 활동으로 친다
  const EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  for (const type of EVENTS) window.addEventListener(type, bump, opts);

  const timer = setInterval(() => {
    // 평범한 모듈이라 `$effect` 로 구독할 수 없어 매 틱 새로 읽는다
    const min = settings.idleLockMin;
    if (min <= 0) return;
    if (veilVisible()) return;
    if (Date.now() - lastActivity >= min * 60_000) openVeil();
  }, CHECK_MS);

  return () => {
    clearInterval(timer);
    for (const type of EVENTS) window.removeEventListener(type, bump, opts);
    void shared.then((un) => un());
  };
}
