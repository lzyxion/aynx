/**
 * **시작 화면 한 벌을 모양 프로필에 몰아 담는 시계** — 순수 모듈(룬 · DOM · Tauri 없음 — 2026-11-03).
 *
 * 고른 모양 프로필이 있으면 위젯을 옮기기 · 크기 · 더하기 · 빼기 · 처음 배치로 · 되돌리기 · 시계 표시 변경이 그 프로필의 시작 화면 칸에
 * 곧바로 담긴다(`theme-profiles.svelte.ts`). 배치는 놓는 순간에만 바뀌지만(`start-widgets.svelte.ts` — 끄는 동안은 쓰지 않는다),
 * 한 손짓이 잇달아 두세 번 바꾸는 일이 있다(시계 글자 크기를 놓으면 표시 · 배치가 함께, 표시를 바꾸면 박스를 다시 맞춘 배치가 뒤따른다).
 * 그래서 **마지막 값 하나만** 짧게 기다렸다 담는다 — [`createLatestDebounce`].
 *
 * `flush` 는 기다리던 값을 지금 담는다 — 다른 프로필을 입히기 **전**에 부른다(기다리던 배치는 입히기 전 프로필의 것이다).
 * `cancel` 은 버린다. 시계는 주입받는다(시험이 가짜 시계로 돈다).
 */

export interface LatestDebounce<T> {
  /** 값을 맡긴다 — 앞서 맡긴 값은 버리고 기다림을 처음부터 */
  push(value: T): void;
  /** 기다리던 값이 있으면 지금 넘긴다 */
  flush(): void;
  /** 기다리던 값을 버린다 */
  cancel(): void;
  /** 기다리는 값이 있는가 */
  pending(): boolean;
}

export interface DebounceTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: DebounceTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 마지막 값 하나만 `ms` 뒤에 `run` 으로 — 그사이 새 값이 오면 기다림을 다시 센다 */
export function createLatestDebounce<T>(ms: number, run: (value: T) => void, timers: DebounceTimers = realTimers): LatestDebounce<T> {
  let handle: unknown = null;
  let has = false;
  let value: T | undefined;
  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const fire = () => {
    stop();
    if (!has) return;
    const v = value as T;
    has = false;
    value = undefined;
    run(v);
  };
  return {
    push(v) {
      stop();
      has = true;
      value = v;
      handle = timers.set(fire, ms);
    },
    flush: fire,
    cancel() {
      stop();
      has = false;
      value = undefined;
    },
    pending: () => has,
  };
}

/** 배치 자동 저장을 묶는 기다림(ms) — 한 손짓이 잇달아 낸 변경이 하나로 담길 만큼 */
export const START_BOARD_SAVE_DELAY_MS = 400;
