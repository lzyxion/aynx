/**
 * **무입력 자동 잠금** — 사용자 입력이 일정 시간 없으면 프라이버시 가림막(`Veil`)을 연다.
 *
 * 설정(`app.idle_lock_min`)이 켜져 있을 때만 동작한다. 보안 잠금이 아니라 시선 가림일 뿐이라
 * (아무 키·클릭에 곧바로 풀린다 — `veil.svelte.ts`) 자리를 비운 사이의 무인 방어로 충분하다.
 *
 * ## 왜 인터벌 하나인가
 *
 * 활동 리스너는 `lastActivity` 만 갱신하고(재무장 없음), 5초짜리 인터벌이 매 틱 조건을
 * 평가한다: 켜져 있고(min>0) · 마지막 입력에서 `min`분이 지났고 · 가림막이 아직 안 떠 있으면
 * 연다. 타이머를 활동마다 재무장하는 방식보다 단순하고, `pointermove`·`wheel` 홍수에도
 * 타이머가 요동치지 않는다(리스너는 변수 하나만 건드린다).
 *
 * ## 설정은 매 틱 다시 읽는다
 *
 * 이 모듈은 컴포넌트가 아니라 평범한 모듈이라 `$effect` 로 설정을 구독할 수 없다. 대신
 * 인터벌 콜백 안에서 `settings.idleLockMin` 을 **매번 새로 읽는다** — 설정을 바꾸면 재배선
 * 없이 다음 틱부터 새 값이 먹고, 끄면(0) 인터벌은 그저 아무것도 열지 않는다.
 *
 * 순환 없음: `veil` 은 아무것도 import 하지 않고, `settings` 는 이 모듈을 부르지 않는다.
 *
 * ## 마지막 입력 시각은 모듈에 산다 (2026-09-27)
 *
 * 메신저 알림(`app/messenger.ts`)의 "자리를 비웠나" 가 **같은 시계**를 읽는다
 * ([`msSinceLastInput`] — docs/log/2026-09-27-discord-notify.md). 시계를 두 벌 두면 "잠금은 걸렸는데
 * 자리 비움은 아니다" 같은 어긋남이 생긴다. 그래서 `lastActivity` 를 설치 함수의 지역에서 모듈로 올렸다 —
 * 리스너가 걸려 있지 않으면(설치 전) 모듈이 뜬 시각이 마지막 입력이다.
 *
 * ## 입력 시계는 집 PC 창끼리 나눈다 (2026-10-28)
 *
 * 가림막이 앱 전체에 하나처럼 서면서(`app/veil` — 한 창이 서면 모든 창이 선다) 창마다 따로 센 시계로는 **쓰지 않던 보조 창
 * 하나가 메인 창에서 일하는 중에 앱 전체를 가린다.** 그래서 활동한 창이 [`USER_ACTIVE_EVENT`] 를 [`SHARE_MS`] 에 한 번씩 내고,
 * 받은 창은 제 `lastActivity` 를 그 시각으로 당긴다 — 사람이 어느 창에서든 움직이면 모든 창의 시계가 함께 미뤄진다(분 단위
 * 판정이라 30초 간격이면 충분하다). 원격 창은 끼지 않는다(낼 수도 없다 — `remote/deny.rs`).
 */

import { openVeil, veilVisible } from "$lib/app/veil.svelte.js";
import { emit, isRemote, listen } from "$lib/ipc";
import { settings } from "$lib/settings.svelte.js";

/** 이 창에서 사람이 움직였다 — 다른 집 PC 창의 입력 시계를 미룬다 (짐 없음) */
export const USER_ACTIVE_EVENT = "user-active";

/** 활동을 다른 창에 알리는 최소 간격(ms) — 분 단위 판정에 30초면 충분하고 이벤트는 드물다 */
const SHARE_MS = 30_000;

/** 조건 평가 주기(ms) — 분 단위 설정에 비하면 충분히 촘촘하고 비용은 무시할 만하다. */
const CHECK_MS = 5000;

/**
 * `pointermove`·`wheel` 은 한 번 움직여도 수십~수백 번 터진다. 활동 기록은 값 하나를 쓰는
 * 일이라 싸지만, 그래도 이 간격(ms)보다 자주는 갱신하지 않아 순수한 낭비를 막는다 — 분 단위
 * 판정에 밀리초의 오차는 아무 의미가 없다.
 */
const BUMP_THROTTLE_MS = 1000;

/** 이 창에서 마지막으로 사람의 활동(키·클릭·이동·휠)을 본 시각(epoch ms) — 머리말의 "모듈에 산다" */
let lastActivity = Date.now();

/** 마지막 활동에서 지난 시간(ms) — 메신저 알림의 자리 비움 판정이 읽는다 */
export function msSinceLastInput(now: number = Date.now()): number {
  return Math.max(0, now - lastActivity);
}

/**
 * 활동 리스너·인터벌을 창에 걸고, 정리 함수를 돌려준다. `+page` 의 부팅 lifecycle 에서 한 번
 * 부르고, 그 반환값을 `onDestroy`(또는 `$effect` 정리)에서 부른다.
 */
export function installIdleLock(): () => void {
  lastActivity = Date.now();
  let lastBump = 0;
  let lastShare = 0;

  function bump(): void {
    const now = Date.now();
    // 스로틀 — 잦은 이벤트(이동·휠)가 매번 쓰지 않게 한다. 첫 호출은 `lastBump=0` 이라 지난다.
    if (now - lastBump < BUMP_THROTTLE_MS) return;
    lastBump = now;
    lastActivity = now;
    // 다른 집 PC 창의 시계도 미룬다(머리말 "입력 시계는 집 PC 창끼리 나눈다") — 제 이벤트를 제가 받아도 같은 값이라 무해하다
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

  // 의도한 입력만이 아니라 **어떤 활동이든** 무인 판정을 미룬다 — 이동·휠도 "사람이 있다"는
  // 신호다(가림막을 **여는** 조건이라, 푸는 조건과 달리 이동·휠도 활동으로 친다).
  const EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  for (const type of EVENTS) window.addEventListener(type, bump, opts);

  const timer = setInterval(() => {
    // 설정은 매 틱 새로 읽는다(머리말 참고). 0/끔이면 아무것도 하지 않는다.
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
