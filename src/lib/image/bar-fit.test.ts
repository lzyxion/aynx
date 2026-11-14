import { describe, expect, it } from "vitest";
import {
  BAR_GAP,
  HEAD_BTN_W,
  PCT_TEXT_MIN,
  RELOAD_W,
  SEG_W,
  counterMinCss,
  expandedSlot,
  fitBar,
  navWidth,
  pctWidth,
  widestCounter,
} from "./bar-fit";

// `4 / 4` · `100%` 의 폭 — 배율 55.8(글자 칸 29.8) · 이전/다음 87.2(가운데 최소 35.2) · 세그먼트 75 · 다시 읽기 24, 칸마다 앞 간격 4
const PCT = BAR_GAP + pctWidth("100%");
const NAV = BAR_GAP + navWidth("4 / 4");
const SEG = BAR_GAP + SEG_W;
const RELOAD = BAR_GAP + RELOAD_W;

describe("fitBar", () => {
  it("폭을 아직 모르면 다 넣는다", () => {
    expect(fitBar(0, "4 / 4", "100%")).toEqual({ nav: true, seg: true, reload: true });
    expect(fitBar(0, null, "100%")).toEqual({ nav: false, seg: true, reload: true });
  });

  it("다 들어가면 다 넣는다", () => {
    expect(fitBar(Math.ceil(PCT + NAV + SEG + RELOAD), "4 / 4", "100%")).toEqual({ nav: true, seg: true, reload: true });
  });

  it("다시 읽기 → [맞춤 | 1:1] → 이전/다음 순서로 뺀다 — 배율은 늘 남는다", () => {
    const full = PCT + NAV + SEG + RELOAD;
    expect(fitBar(Math.floor(full) - 1, "4 / 4", "100%")).toEqual({ nav: true, seg: true, reload: false });
    expect(fitBar(Math.floor(PCT + NAV + SEG) - 1, "4 / 4", "100%")).toEqual({ nav: true, seg: false, reload: false });
    expect(fitBar(Math.floor(PCT + NAV) - 1, "4 / 4", "100%")).toEqual({ nav: false, seg: false, reload: false });
    expect(fitBar(10, "4 / 4", "100%")).toEqual({ nav: false, seg: false, reload: false });
  });

  it("앞의 것이 빠지면 더 작은 뒤의 것도 넣지 않는다(순서를 지킨다)", () => {
    // 이전/다음(87) 은 안 들어가도 세그먼트(75)는 들어갈 폭 — 그래도 세그먼트를 넣지 않는다
    const slot = Math.floor(PCT + NAV) - 1;
    expect(slot - PCT).toBeGreaterThan(SEG);
    expect(fitBar(slot, "4 / 4", "100%").seg).toBe(false);
  });

  it("이전/다음이 없으면(그림 한 장) 세그먼트부터 본다", () => {
    expect(fitBar(Math.ceil(PCT + SEG + RELOAD), null, "100%")).toEqual({ nav: false, seg: true, reload: true });
    expect(fitBar(Math.floor(PCT + SEG) - 1, null, "100%")).toEqual({ nav: false, seg: false, reload: false });
  });

  it("긴 글자는 그만큼 넓게 센다", () => {
    expect(navWidth("123 / 456")).toBeGreaterThan(navWidth("4 / 4"));
    expect(pctWidth("3200%")).toBeGreaterThan(pctWidth("42%"));
  });

  it("배율 단추는 `100%` 까지 같은 폭(CSS 최소 폭) — `—` 도 · 1000% 이상만 넓다", () => {
    for (const p of ["—", "5%", "42%", "100%"]) expect(pctWidth(p)).toBe(10 + 2 + PCT_TEXT_MIN + 2 + 12);
    expect(pctWidth("3200%")).toBeGreaterThan(pctWidth("100%"));
  });

  it("`3 / 12` 는 폴더의 가장 넓은 글자로 센다 — `9 / 12` 와 `10 / 12` 의 판정 재료가 같다", () => {
    expect(widestCounter(12)).toBe("12 / 12");
    expect(navWidth(widestCounter(12))).toBeGreaterThanOrEqual(navWidth("10 / 12"));
    expect(counterMinCss(12)).toBe("max(3.2em, calc(4ch + 1em))");
    expect(counterMinCss(120)).toBe("max(3.2em, calc(6ch + 1em))");
  });

  it("넘길 때 배율 글자만 다르면(42% ↔ 100%) 판정이 같다", () => {
    for (const slot of [120, 160, 200, 240, 280])
      expect(fitBar(slot, "3 / 12", "42%")).toEqual(fitBar(slot, "3 / 12", "100%"));
  });
});

describe("expandedSlot — 펼친 머리줄의 폭으로 센다", () => {
  const open = { width: HEAD_BTN_W, marginLeft: 0 };
  const shut = { width: 0, marginLeft: -8 };
  it("펼친 머리줄이면 잰 폭 그대로", () => {
    expect(expandedSlot(135, [open, open, open])).toBe(135);
  });
  it("접힌 머리줄(⋯ ⤢ × 가 비운 폭 3 × 32)이면 펼친 때의 폭으로 돌린다", () => {
    expect(expandedSlot(231, [shut, shut, shut])).toBe(135);
  });
  it("움직이는 중(폭 · 여백이 그 사이)에도 같은 값 — 판정이 프레임마다 바뀌지 않는다", () => {
    const mid = { width: 12, marginLeft: -4 };
    expect(expandedSlot(183, [mid, mid, mid])).toBe(135);
  });
  it("접히지 않는 단추(최대화 켬 · 메뉴 열림)는 빼지 않는다", () => {
    expect(expandedSlot(199, [shut, open, shut])).toBe(135);
  });
  it("머리줄이 없으면(몸 위 도구줄) 잰 폭 그대로", () => {
    expect(expandedSlot(300, [])).toBe(300);
  });
});

describe("expandedSlot — 이름이 최대 폭까지 가져간 때로 센다", () => {
  const open = { width: HEAD_BTN_W, marginLeft: 0 };
  // 머리줄 안쪽 600 → 이름 묶음 최대 240(40%). 도구줄 칸 + 이름 묶음 = 400 (다른 칸 · 간격을 뺀 몫)
  const SUM = 400;
  const MAX = 240;
  const at = (nameW: number) => expandedSlot(SUM - nameW, [open, open, open], { width: nameW, maxWidth: MAX });

  it("이름이 최대 폭이면 잰 폭 그대로", () => {
    expect(at(MAX)).toBe(SUM - MAX);
  });

  it("같은 머리줄 폭 · 이름만 다른 두 그림 → 같은 폭 · 같은 판정(이전/다음이 움직이지 않는다)", () => {
    expect(at(60)).toBe(at(200));
    // 이름이 짧은 그림에서는 다 들어갈 실제 칸이지만, 긴 그림과 같은 판정이다
    const short = 60;
    const long = 230;
    expect(fitBar(SUM - short, "3 / 12", "100%")).not.toEqual(fitBar(SUM - long, "3 / 12", "100%"));
    expect(fitBar(at(short), "3 / 12", "42%")).toEqual(fitBar(at(long), "3 / 12", "100%"));
  });

  it("접힌 단추와 함께 깎는다", () => {
    const shut = { width: 0, marginLeft: -8 };
    expect(expandedSlot(160 + 96, [shut, shut, shut], { width: 100, maxWidth: MAX })).toBe(160 - 140);
  });

  it("최대보다 넓게 잴 일은 없지만 그래도 더하지 않는다", () => {
    expect(expandedSlot(200, [], { width: 260, maxWidth: MAX })).toBe(200);
  });

  it("깎아서 0 이하가 되어도 '모름'(0)이 아니라 1 — 다 넣지 않고 배율만 남긴다", () => {
    expect(expandedSlot(50, [], { width: 20, maxWidth: MAX })).toBe(1);
    expect(fitBar(1, "3 / 12", "100%")).toEqual({ nav: false, seg: false, reload: false });
  });

  it("아직 재지 않았으면(0) 0 그대로", () => {
    expect(expandedSlot(0, [], { width: 0, maxWidth: MAX })).toBe(0);
  });
});
