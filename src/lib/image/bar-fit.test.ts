import { describe, expect, it } from "vitest";
import { BAR_GAP, HEAD_BTN_W, RELOAD_W, SEG_W, expandedSlot, fitBar, navWidth, pctWidth } from "./bar-fit";

// `4 / 4` · `100%` 의 폭 — 배율 52.4 · 이전/다음 91.2(가운데 최소 35.2) · 세그먼트 75 · 다시 읽기 26, 칸마다 앞 간격 4
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
    // 이전/다음(91) 은 안 들어가도 세그먼트(75)는 들어갈 폭 — 그래도 세그먼트를 넣지 않는다
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

  it("그림이 없을 때의 `—` 는 한 자지만 두 자로 센다(숫자보다 넓다)", () => {
    expect(pctWidth("—")).toBe(pctWidth("1%"));
    expect(pctWidth("—")).toBeLessThan(pctWidth("100%"));
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
