// 로컬 AI 타일의 로딩 덮개 판정 — 앱이 셸에 쳐 넣는 긴 autorun 줄을 가린다.
// 이 타일의 첫 OSC 133 `C` 가 곧 autorun 줄이다 — 그때 xterm 화면만 지운다(셸에는 아무것도 보내지 않는다).
// 셸 통합이 없는 셸(cmd.exe)은 `C` 가 오지 않아 시한 · 신호 · 키 입력으로만 걷힌다.

export const AI_VEIL_TIMING = {
  /** `C` 뒤 첫 출력부터 잰다 — CLI 가 아직 아무것도 그리지 않은 기동 시간은 세지 않는다 */
  quietMs: 300,
  maxMs: 8000,
  fadeMs: 150,
} as const;

export type AiVeilLiftReason = "signal" | "quiet" | "ended" | "exit" | "timeout" | "input" | "closed";

export interface AiVeilClock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface AiVeilOptions {
  reducedMotion: boolean;
  clearScreen: () => void;
  /** 한 번만 불린다 */
  lift: (reason: AiVeilLiftReason, instant: boolean) => void;
  clock?: AiVeilClock;
  timing?: { quietMs: number; maxMs: number };
}

export interface AiVeil {
  readonly on: boolean;
  commandStarted(): void;
  output(): void;
  /** OSC 133 `D` — CLI 가 없거나 오류로 끝난 것을 가리지 않게 걷는다 */
  commandEnded(): void;
  hookSignal(): void;
  input(): void;
  exit(): void;
  close(): void;
}

const realClock: AiVeilClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createAiVeil(o: AiVeilOptions): AiVeil {
  const clock = o.clock ?? realClock;
  const timing = o.timing ?? AI_VEIL_TIMING;
  let on = true;
  let started = false;
  let quiet: unknown = null;
  let max: unknown = clock.set(() => lift("timeout"), timing.maxMs);

  function stopTimers(): void {
    if (quiet !== null) clock.clear(quiet);
    if (max !== null) clock.clear(max);
    quiet = null;
    max = null;
  }

  function lift(reason: AiVeilLiftReason): void {
    if (!on) return;
    on = false;
    stopTimers();
    o.lift(reason, o.reducedMotion);
  }

  return {
    get on() {
      return on;
    },
    commandStarted() {
      if (!on || started) return;
      started = true;
      o.clearScreen();
    },
    output() {
      if (!on || !started) return;
      if (quiet !== null) clock.clear(quiet);
      quiet = clock.set(() => lift("quiet"), timing.quietMs);
    },
    commandEnded() {
      if (started) lift("ended");
    },
    hookSignal() {
      lift("signal");
    },
    input() {
      lift("input");
    },
    exit() {
      lift("exit");
    },
    close() {
      if (!on) return;
      on = false;
      stopTimers();
      o.lift("closed", true);
    },
  };
}
