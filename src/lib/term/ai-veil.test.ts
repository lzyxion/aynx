import { describe, expect, it } from "vitest";
import { AI_VEIL_TIMING, createAiVeil, type AiVeilClock, type AiVeilLiftReason } from "./ai-veil";

// 로컬 AI 타일의 로딩 덮개 — 첫 `C` 에서 화면 지우기 · 먼저 오는 걷기 신호 하나 · 움직임 줄이기면 즉시.

/** 손으로 돌리는 시계 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: AiVeilClock = {
    set(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      timers.delete(h as number);
    },
  };
  function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  }
  return { clock, advance, pending: () => timers.size };
}

function setup(reducedMotion = false) {
  const c = fakeClock();
  const lifts: { reason: AiVeilLiftReason; instant: boolean }[] = [];
  let clears = 0;
  const veil = createAiVeil({
    reducedMotion,
    clock: c.clock,
    clearScreen: () => void clears++,
    lift: (reason, instant) => lifts.push({ reason, instant }),
  });
  return { veil, lifts, clears: () => clears, ...c };
}

describe("createAiVeil", () => {
  it("씌우는 순간 덮여 있고 첫 `C` 에서만 화면을 지운다", () => {
    const s = setup();
    expect(s.veil.on).toBe(true);
    s.veil.commandStarted();
    s.veil.commandStarted();
    expect(s.clears()).toBe(1);
    expect(s.lifts).toEqual([]);
  });

  it("훅 신호가 오면 걷는다 — `C` 전이어도", () => {
    const s = setup();
    s.veil.hookSignal();
    expect(s.lifts).toEqual([{ reason: "signal", instant: false }]);
    expect(s.veil.on).toBe(false);
    expect(s.pending()).toBe(0);
  });

  it("`C` 뒤 첫 출력부터 멎음을 잰다 — 출력이 이어지면 미룬다", () => {
    const s = setup();
    s.veil.commandStarted();
    // CLI 기동 시간(출력 없음)은 세지 않는다
    s.advance(2000);
    expect(s.lifts).toEqual([]);
    s.veil.output();
    s.advance(AI_VEIL_TIMING.quietMs - 50);
    s.veil.output();
    s.advance(AI_VEIL_TIMING.quietMs - 50);
    expect(s.lifts).toEqual([]);
    s.advance(50);
    expect(s.lifts).toEqual([{ reason: "quiet", instant: false }]);
  });

  it("`C` 전의 출력(셸 프롬프트)은 멎음 시계를 걸지 않는다", () => {
    const s = setup();
    s.veil.output();
    s.advance(AI_VEIL_TIMING.quietMs * 3);
    expect(s.lifts).toEqual([]);
  });

  it("명령이 끝나면(`D`) 걷는다 — `C` 를 본 뒤에만", () => {
    const s = setup();
    s.veil.commandEnded(); // 첫 프롬프트의 D — 무시
    expect(s.lifts).toEqual([]);
    s.veil.commandStarted();
    s.veil.commandEnded();
    expect(s.lifts).toEqual([{ reason: "ended", instant: false }]);
  });

  it("시한이 지나면 걷는다 — 셸 통합이 없는 셸(`C` 없음)도", () => {
    const s = setup();
    s.advance(AI_VEIL_TIMING.maxMs - 1);
    expect(s.lifts).toEqual([]);
    s.advance(1);
    expect(s.lifts).toEqual([{ reason: "timeout", instant: false }]);
    expect(s.clears()).toBe(0);
  });

  it("키 입력 · 세션 종료에 걷는다", () => {
    const a = setup();
    a.veil.input();
    expect(a.lifts).toEqual([{ reason: "input", instant: false }]);
    const b = setup();
    b.veil.exit();
    expect(b.lifts).toEqual([{ reason: "exit", instant: false }]);
  });

  it("한 번만 걷는다 — 뒤의 신호 · 시계는 아무것도 하지 않는다", () => {
    const s = setup();
    s.veil.commandStarted();
    s.veil.output();
    s.veil.hookSignal();
    s.veil.input();
    s.veil.commandEnded();
    s.advance(AI_VEIL_TIMING.maxMs * 2);
    expect(s.lifts).toEqual([{ reason: "signal", instant: false }]);
    // 걷힌 뒤의 `C` 는 화면을 지우지 않는다(사용자가 친 명령)
    s.veil.commandStarted();
    expect(s.clears()).toBe(1);
  });

  it("타일이 닫히면 시계를 걷고 곧바로 걷는다", () => {
    const s = setup();
    s.veil.commandStarted();
    s.veil.output();
    s.veil.close();
    expect(s.pending()).toBe(0);
    expect(s.lifts).toEqual([{ reason: "closed", instant: true }]);
  });

  it("움직임 줄이기면 걷힘이 즉시다", () => {
    const s = setup(true);
    s.veil.commandStarted();
    s.veil.output();
    s.advance(AI_VEIL_TIMING.quietMs);
    expect(s.lifts).toEqual([{ reason: "quiet", instant: true }]);
  });
});
