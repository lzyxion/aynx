import { describe, expect, it } from "vitest";
import {
  CLOCK_FONT_DEFAULT,
  CLOCK_FONT_MAX,
  CLOCK_FONT_MIN,
  clockBoxSize,
  clockFace,
  clockTimeEm,
  DEFAULT_CLOCK_OPTIONS,
  msUntilNextTick,
  parseClockOptions,
  serializeClockOptions,
  TICK_SLACK_MS,
} from "$lib/start-clock";

/** 시작 화면 시계 위젯의 규칙 (2026-11-03) */

// 지역 시각으로 짓는다 — 시험이 도는 PC 의 시간대와 상관없이 같은 글자가 나오게
const evening = new Date(2026, 10, 3, 21, 5, 9); // 2026-11-03(화) 21:05:09
const morning = new Date(2026, 10, 3, 0, 7, 3); // 자정 직후 00:07:03

describe("clockFace — 보이는 글자", () => {
  it("처음 값 = 24시간 · 초 없음 · 날짜 보임", () => {
    expect(DEFAULT_CLOCK_OPTIONS).toEqual({ hour12: false, seconds: false, date: true, size: CLOCK_FONT_DEFAULT });
  });

  it("24시간 — 앞 0 · 자정은 00(24 가 아니다) · 오전/오후 없음", () => {
    expect(clockFace(evening, "ko", { hour12: false, seconds: false })).toMatchObject({ time: "21:05", period: null });
    expect(clockFace(evening, "en", { hour12: false, seconds: true })).toMatchObject({ time: "21:05:09", period: null });
    expect(clockFace(morning, "ko", { hour12: false, seconds: false }).time).toBe("00:07");
    expect(clockFace(morning, "en", { hour12: false, seconds: false }).time).toBe("00:07");
  });

  it("12시간 — 앞 0 없음 · 자정은 12 · 오전/오후는 언어대로 앞 · 뒤", () => {
    const ko = clockFace(evening, "ko", { hour12: true, seconds: false });
    expect(ko).toMatchObject({ time: "9:05", period: "오후", periodFirst: true });
    const en = clockFace(evening, "en", { hour12: true, seconds: true });
    expect(en).toMatchObject({ time: "9:05:09", period: "PM", periodFirst: false });
    expect(clockFace(morning, "ko", { hour12: true, seconds: false })).toMatchObject({ time: "12:07", period: "오전" });
    expect(clockFace(morning, "en", { hour12: true, seconds: false })).toMatchObject({ time: "12:07", period: "AM" });
  });

  it("날짜 · 요일 한 줄 — 앱 언어대로", () => {
    expect(clockFace(evening, "ko", DEFAULT_CLOCK_OPTIONS).date).toBe("11월 3일 화요일");
    expect(clockFace(evening, "en", DEFAULT_CLOCK_OPTIONS).date).toBe("Tuesday, November 3");
  });
});

describe("msUntilNextTick — 경계에 맞춰 깨운다", () => {
  it("분 — 다음 분 경계까지 + 여유", () => {
    expect(msUntilNextTick(60_000 * 100, false)).toBe(60_000 + TICK_SLACK_MS);
    expect(msUntilNextTick(60_000 * 100 + 59_990, false)).toBe(10 + TICK_SLACK_MS);
    expect(msUntilNextTick(60_000 * 100 + 1, false)).toBe(59_999 + TICK_SLACK_MS);
  });

  it("초 — 다음 초 경계까지 + 여유", () => {
    expect(msUntilNextTick(1_000_250, true)).toBe(750 + TICK_SLACK_MS);
    expect(msUntilNextTick(1_000_000, true)).toBe(1000 + TICK_SLACK_MS);
  });

  it("깨어난 자리(경계 + 여유)에서 다시 재면 다음 경계 — 밀리지 않는다", () => {
    let at = 60_000 * 7 + 12_345;
    for (let i = 0; i < 5; i++) {
      at += msUntilNextTick(at, false);
      expect(at % 60_000).toBe(TICK_SLACK_MS);
    }
  });
});

describe("저장 글자 — 시계 표시", () => {
  const D = DEFAULT_CLOCK_OPTIONS;

  it("왕복", () => {
    for (const o of [D, { hour12: true, seconds: false, date: false, size: 40 }, { hour12: true, seconds: true, date: true, size: 160 }])
      expect(parseClockOptions(serializeClockOptions(o))).toEqual(o);
  });

  it("저장된 적 없음 · 깨진 글자 · 모르는 모양은 처음 값", () => {
    expect(parseClockOptions(null)).toEqual(D);
    expect(parseClockOptions("{")).toEqual(D);
    expect(parseClockOptions("[true, true]")).toEqual(D);
    expect(parseClockOptions("7")).toEqual(D);
  });

  it("칸 하나만 깨졌으면 그 칸만 처음 값 · 글자 크기는 범위 안으로", () => {
    expect(parseClockOptions(JSON.stringify({ hour12: true, seconds: "yes", date: false }))).toEqual({ ...D, hour12: true, date: false });
    expect(parseClockOptions(JSON.stringify({ seconds: true }))).toEqual({ ...D, seconds: true });
    expect(parseClockOptions(JSON.stringify({ date: 0, size: "big" }))).toEqual(D);
    expect(parseClockOptions(JSON.stringify({ size: 9999 })).size).toBe(CLOCK_FONT_MAX);
    expect(parseClockOptions(JSON.stringify({ size: 1 })).size).toBe(CLOCK_FONT_MIN);
  });

  it("날짜 · 글자 크기 칸이 생기기 전의 저장값(칸 없음)은 날짜를 보이고 처음 크기", () => {
    expect(parseClockOptions('{"hour12":true,"seconds":true}')).toEqual({ ...D, hour12: true, seconds: true });
  });

  it("처음 값은 바뀌지 않는다(돌려받은 값을 고쳐도)", () => {
    const o = parseClockOptions(null);
    o.hour12 = true;
    expect(DEFAULT_CLOCK_OPTIONS.hour12).toBe(false);
  });
});

describe("clockBoxSize — 박스가 글자를 감싼다", () => {
  const D = DEFAULT_CLOCK_OPTIONS;

  it("처음 표시(한국어 · 24시간 · 날짜 · 88px) = 264×136, 변은 8 의 배수", () => {
    expect(clockBoxSize("ko", D)).toEqual({ w: 264, h: 136 });
    for (const o of [D, { ...D, seconds: true }, { ...D, hour12: true }, { ...D, size: 37 }])
      for (const l of ["ko", "en"]) {
        const b = clockBoxSize(l, o);
        expect(b.w % 8).toBe(0);
        expect(b.h % 8).toBe(0);
      }
  });

  it("초 · 12시간이면 넓어지고, 날짜를 끄면 낮아진다", () => {
    const base = clockBoxSize("ko", D);
    expect(clockBoxSize("ko", { ...D, seconds: true }).w).toBeGreaterThan(base.w);
    expect(clockBoxSize("ko", { ...D, seconds: true, hour12: true }).w).toBeGreaterThan(clockBoxSize("ko", { ...D, seconds: true }).w);
    const noDate = clockBoxSize("ko", { ...D, date: false });
    expect(noDate.h).toBeLessThan(base.h);
    expect(noDate.w).toBe(base.w);
  });

  it("글자 크기에 비례해 자라고 범위 밖은 죈다", () => {
    const small = clockBoxSize("en", { ...D, size: CLOCK_FONT_MIN });
    const big = clockBoxSize("en", { ...D, size: CLOCK_FONT_MAX });
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBeGreaterThan(small.h);
    expect(clockBoxSize("en", { ...D, size: 9999 })).toEqual(big);
  });

  it("숫자 폭은 시각 값이 아니라 형식으로 — 12시간도 두 자리 시로 어림한다", () => {
    expect(clockTimeEm("ko", { hour12: false, seconds: false })).toBeCloseTo(4 * 0.6 + 0.3);
    expect(clockTimeEm("ko", { hour12: false, seconds: true })).toBeCloseTo(6 * 0.6 + 2 * 0.3);
    // 12시간 = 같은 숫자 폭 + 오전/오후 칸(한국어는 두 글자 · 1em 씩)
    expect(clockTimeEm("ko", { hour12: true, seconds: false })).toBeCloseTo(2.7 + 2 * 0.32 + 0.15);
  });
});
