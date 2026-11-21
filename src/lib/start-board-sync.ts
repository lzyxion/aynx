/**
 * 시작 화면 배치를 모양 프로필에 담는 "마지막 값 하나" 디바운스 — 순수 모듈(시계는 주입받는다).
 * `flush` 는 다른 프로필을 입히기 전에 부른다 — 기다리던 배치는 입히기 전 프로필의 것이다.
 */

export interface LatestDebounce<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
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

export const START_BOARD_SAVE_DELAY_MS = 400;
