// 로컬 AI 타일의 **로딩 덮개** 판정 — 순수 모듈(시계 · 화면 지우기 · 걷기는 부르는 쪽이 넣는다). 그리는 것은 `term/AiVeil.svelte`,
// 배선은 `Terminal.svelte`(첫 열기에서 autorun 을 쓸 때만 — 다시 붙기 · 복원 · SSH · 설정 스크립트 갈래에는 없다).
//
// 앱이 셸에 `claude --settings … --mcp-config …` 긴 한 줄을 쳐 넣는 동안 프롬프트와 그 줄이 그대로 보이던 것을 가린다.
//
// - **명령이 시작되는 순간**(셸 통합 OSC 133 `C` — 이 타일의 첫 `C` 가 곧 autorun 줄이다) xterm 화면만 지운다(`clearScreen` —
//   셸에는 아무것도 보내지 않는다). 걷혔을 때 명령 줄이 위에 남지 않게. 셸 통합이 없는 셸(cmd.exe)은 `C` 가 오지 않아
//   지우지 못하고 시한 · 신호 · 키 입력으로만 걷힌다.
// - **걷기**(먼저 오는 것): 그 타일의 에이전트 훅 신호(Claude `SessionStart` → `session`) · `C` 뒤 출력이 [`AI_VEIL_TIMING.quietMs`]
//   멎음(Codex 와 훅이 꺼진 Claude 의 그물 — `C` 뒤 **첫 출력부터** 잰다: CLI 가 아직 아무것도 그리지 않은 기동 시간은 세지 않는다) ·
//   명령이 끝남(133 `D` — CLI 없음 · 오류를 가리지 않게) · 세션 종료/열기 실패 · 시한([`AI_VEIL_TIMING.maxMs`]) · 사용자의 키 입력 ·
//   타일 닫힘.
// - 걷힘 모양은 그리는 쪽이 정한다 — 여기서는 `instant`(움직임 줄이기면 참)만 넘긴다.

/** 시간 값 — 한 곳에 모은다 */
export const AI_VEIL_TIMING = {
  /** `C` 뒤 출력이 이만큼 멎으면 CLI 가 그리기를 마쳤다고 본다 */
  quietMs: 300,
  /** 덮개를 씌운 뒤 이만큼 지나면 무조건 걷는다 */
  maxMs: 8000,
  /** 걷힘 페이드 — 그리는 쪽(`AiVeil.svelte`)이 쓴다 */
  fadeMs: 150,
} as const;

/** 왜 걷혔나 — 시험 · 로그용 */
export type AiVeilLiftReason = "signal" | "quiet" | "ended" | "exit" | "timeout" | "input" | "closed";

/** 시계 — 시험이 가짜를 넣는다 */
export interface AiVeilClock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface AiVeilOptions {
  /** 움직임 줄이기 — 참이면 걷힘이 즉시다(`lift` 의 `instant`) */
  reducedMotion: boolean;
  /** 이 타일의 xterm 화면만 지운다(첫 `C` 에서 한 번) */
  clearScreen: () => void;
  /** 덮개를 걷는다 — 한 번만 불린다 */
  lift: (reason: AiVeilLiftReason, instant: boolean) => void;
  clock?: AiVeilClock;
  timing?: { quietMs: number; maxMs: number };
}

export interface AiVeil {
  /** 덮여 있는가 */
  readonly on: boolean;
  /** 셸이 명령을 시작했다(OSC 133 `C`) — 첫 번째만 센다 */
  commandStarted(): void;
  /** 세션 출력이 왔다 — `C` 뒤에만 멎음 시계를 다시 건다 */
  output(): void;
  /** 명령이 끝났다(OSC 133 `D`) — `C` 를 본 뒤에만 */
  commandEnded(): void;
  /** 그 타일의 에이전트 훅 신호(SessionStart 계열) */
  hookSignal(): void;
  /** 사용자가 그 타일에 키를 눌렀다 · 덮개를 눌렀다 */
  input(): void;
  /** 세션이 끝났다 · 열기에 실패했다 */
  exit(): void;
  /** 타일이 닫혔다 — 시계를 걷고 곧바로(`instant`) 걷는다 */
  close(): void;
}

const realClock: AiVeilClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 덮개 하나를 씌운다 — 만드는 순간부터 덮여 있고 시한 시계가 돈다 */
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
