import { describe, expect, it } from "vitest";
import {
  alignToNeighbours,
  boardBounds,
  boxesCollide,
  clampInto,
  clampResize,
  defaultStartWidgets,
  dragLanding,
  fitScale,
  guidesFor,
  isFree,
  isNarrowBoard,
  layoutValid,
  MIN_FIT_SCALE,
  narrowStack,
  nearestFreeSpot,
  parseStartWidgets,
  readingOrder,
  serializeStartWidgets,
  snapToGrid,
  widgetCapacity,
  widgetColumns,
  widgetRowsPerColumn,
  withNewWidget,
  withoutWidget,
  withWidgetBox,
  clampClockResize,
  boardChangedForUndo,
  popUndo,
  pushUndo,
  START_UNDO_MAX,
  withWidgetSize,
  START_WIDGET_KINDS,
  WIDGET_DEFAULT_SIZE,
  widgetDefaultSize,
  WIDGET_GAP,
  WIDGET_MAX_W,
  WIDGET_MIN,
  type StartWidget,
} from "$lib/start-widgets";
import { clockBoxSize, DEFAULT_CLOCK_OPTIONS } from "$lib/start-clock";

/** 시작 화면 위젯 판의 규칙 (docs/log/2026-10-28-start-widgets.md) */

const W = (kind: StartWidget["kind"], x: number, y: number, w = 240, h = 208): StartWidget => ({ kind, x, y, w, h });

describe("격자 · 줄 수", () => {
  it("8px 눈금에 맞춘다", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(0);
    expect(snapToGrid(4)).toBe(8);
    expect(snapToGrid(-13)).toBe(-16);
  });

  it("보이는 줄 = (높이 − 머리 40 − 아래 8) / 32, 넓으면(≥384) 두 단", () => {
    expect(widgetRowsPerColumn(208)).toBe(5);
    expect(widgetRowsPerColumn(112)).toBe(2);
    expect(widgetRowsPerColumn(40)).toBe(0);
    expect(widgetColumns(383)).toBe(1);
    expect(widgetColumns(384)).toBe(2);
    expect(widgetCapacity(240, 208)).toBe(5);
    expect(widgetCapacity(400, 208)).toBe(10);
  });
});

describe("부딪힘 · 빈자리", () => {
  it("16px 보다 가까우면 부딪힌다 — 딱 16 은 괜찮다", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    expect(boxesCollide(a, { x: 116, y: 0, w: 50, h: 50 })).toBe(false);
    expect(boxesCollide(a, { x: 115, y: 0, w: 50, h: 50 })).toBe(true);
    expect(boxesCollide(a, { x: 50, y: 50, w: 10, h: 10 })).toBe(true);
    expect(boxesCollide(a, { x: 0, y: 116, w: 100, h: 10 })).toBe(false);
    expect(isFree(a, [])).toBe(true);
  });

  it("빈자리면 그대로, 아니면 격자로 넓혀 가며 가장 가까운 빈자리", () => {
    const other = { x: 0, y: 0, w: 200, h: 200 };
    const free = { x: 400, y: 0, w: 100, h: 100 };
    expect(nearestFreeSpot(free, [other])).toEqual(free);
    // 오른쪽 가장자리에 걸쳤다 → 오른쪽으로 조금만 민다(왼쪽 · 위아래로 크게 돌지 않는다)
    const spot = nearestFreeSpot({ x: 184, y: 40, w: 100, h: 100 }, [other]);
    expect(spot).toEqual({ x: 216, y: 40, w: 100, h: 100 });
    expect(isFree(spot, [other])).toBe(true);
  });

  it("경계 안의 빈자리를 먼저 찾는다", () => {
    const other = { x: 0, y: 0, w: 200, h: 200 };
    const bounds = { left: -400, top: -400, right: 260, bottom: 400 };
    // 오른쪽으로 밀면 경계를 넘는다 → 다른 쪽(아래)으로
    const spot = nearestFreeSpot({ x: 120, y: 40, w: 100, h: 100 }, [other], bounds);
    expect(isFree(spot, [other])).toBe(true);
    expect(spot.x + spot.w).toBeLessThanOrEqual(260);
  });

  it("경계 안으로 민다 — 경계보다 크면 왼쪽 · 위에 맞춘다", () => {
    const b = { left: -100, top: -100, right: 100, bottom: 100 };
    expect(clampInto({ x: 50, y: -150, w: 100, h: 50 }, b)).toEqual({ x: 0, y: -100, w: 100, h: 50 });
    expect(clampInto({ x: 50, y: 0, w: 300, h: 50 }, b).x).toBe(-100);
  });
});

describe("맞춤 안내선 · 끄는 동안", () => {
  const other = { x: 0, y: 0, w: 240, h: 208 };

  it("변 · 가운데가 6px 안이면 붙인다", () => {
    expect(alignToNeighbours({ x: 300, y: 4, w: 240, h: 120 }, [other])).toMatchObject({ x: 300, y: 0 });
    expect(alignToNeighbours({ x: 300, y: 7, w: 240, h: 120 }, [other])).toMatchObject({ y: 7 });
    // 가장 가까운 맞춤이 이긴다 — 아래 변(104)이 다른 위젯의 세로 가운데(104)와 이미 맞으면 그대로
    expect(alignToNeighbours({ x: 300, y: 4, w: 240, h: 100 }, [other])).toMatchObject({ y: 4 });
    // 가운데끼리 (오른쪽 위젯의 가로 가운데 = 다른 위젯의 가로 가운데)
    expect(alignToNeighbours({ x: 3, y: 300, w: 240, h: 100 }, [other]).x).toBe(0);
  });

  it("딱 맞는 줄마다 안내선 — 두 상자를 잇는 길이", () => {
    const g = guidesFor({ x: 300, y: 0, w: 100, h: 100 }, [other]);
    expect(g).toContainEqual({ axis: "y", at: 0, from: 0, to: 400 });
    expect(guidesFor({ x: 300, y: 13, w: 100, h: 50 }, [other])).toEqual([]);
  });

  it("끌기 = 격자 → 이웃에 붙이기 → 빈자리, 안내선은 놓일 자리의 것", () => {
    const orig = { x: 400, y: 0, w: 100, h: 120 };
    const r = dragLanding(orig, -3, 3, [other], null);
    expect(r.landing).toEqual({ x: 400, y: 0, w: 100, h: 120 });
    // 격자로는 8 이지만 이웃의 위 변(0)이 6px 안이라 붙는다
    expect(dragLanding({ ...orig, y: 2 }, 0, 0, [other], null).landing.y).toBe(0);
    expect(r.guides.some((g) => g.axis === "y" && g.at === 0)).toBe(true);
    // 다른 위젯 위로 끌어다 놓으면 가장 가까운 빈자리
    const onTop = dragLanding(orig, -380, 20, [other], null);
    expect(isFree(onTop.landing, [other])).toBe(true);
  });
});

describe("크기 바꾸기", () => {
  it("격자 · 최소 · 최대", () => {
    const w = W("hosts", 0, 0);
    expect(clampResize(w, 253, 211, [])).toEqual({ x: 0, y: 0, w: 256, h: 208 });
    expect(clampResize(w, 10, 10, [])).toEqual({ x: 0, y: 0, ...WIDGET_MIN.hosts });
    expect(clampResize(w, 5000, 208, []).w).toBe(WIDGET_MAX_W);
  });

  it("커지다 이웃의 변 16px 앞에서 멈춘다 — 오른쪽은 지금 높이, 아래는 새 폭 기준", () => {
    const w = W("hosts", 0, 0);
    const right = W("shells", 400, 0);
    expect(clampResize(w, 600, 208, [right]).w).toBe(400 - WIDGET_GAP);
    const below = W("projects", 0, 400);
    expect(clampResize(w, 240, 900, [below]).h).toBe(400 - WIDGET_GAP);
    // 대각선의 이웃 — 폭이 그 아래로 넓어지면 높이가 멈춘다
    const diag = W("shells", 300, 300);
    const r = clampResize(w, 400, 600, [diag]);
    expect(isFree({ x: 0, y: 0, w: r.w, h: r.h }, [diag])).toBe(true);
  });

  it("경계 안에서만", () => {
    const r = clampResize(W("hosts", 0, 0), 900, 900, [], { left: -500, top: -500, right: 300, bottom: 250 });
    expect(r).toMatchObject({ w: 296, h: 248 }); // 경계도 눈금 안쪽으로 내린다
  });
});

describe("정리 · 처음 배치 · 더하기 · 빼기", () => {
  it("처음 배치 = 위 줄에 시계, 아래 줄에 목록 셋이 나란히 — 가로 가운데 · 세로 가운데보다 위, 겹치지 않는다", () => {
    const d = defaultStartWidgets();
    expect(d.map((w) => w.kind)).toEqual(["clock", "hosts", "projects", "shells"]);
    expect(d).toEqual([
      { kind: "clock", x: -128, y: -224, w: 264, h: 136 },
      { kind: "hosts", x: -376, y: -72, w: 240, h: 208 },
      { kind: "projects", x: -120, y: -72, w: 240, h: 208 },
      { kind: "shells", x: 136, y: -72, w: 240, h: 208 },
    ]);
    const [clock, ...lists] = d;
    // 시계는 글자를 감싼 박스로 혼자 위 줄 가운데, 그 아래 틈 16 을 두고 목록 셋
    expect(Math.abs(clock.x + clock.w / 2)).toBeLessThanOrEqual(4);
    expect(clock.y + clock.h + WIDGET_GAP).toBe(lists[0].y);
    expect(new Set(lists.map((w) => w.y)).size).toBe(1);
    expect(lists[0].x + lists[2].x + lists[2].w).toBe(0);
    expect(clock.y + (lists[0].y + lists[0].h - clock.y) / 2).toBeLessThan(0);
    expect(layoutValid(d)).toBe(true);
  });

  it("종류마다 처음 크기 — 시계는 처음 표시의 글자 박스, 시계도 종류마다 하나", () => {
    expect(START_WIDGET_KINDS).toEqual(["clock", "hosts", "projects", "shells"]);
    expect(widgetDefaultSize("clock")).toEqual(clockBoxSize("ko", DEFAULT_CLOCK_OPTIONS));
    expect(widgetDefaultSize("hosts")).toEqual(WIDGET_DEFAULT_SIZE);
    // 가장 작은 글자 · 날짜 없음의 박스도 저장값 검증의 바닥 위
    const tiny = clockBoxSize("en", { ...DEFAULT_CLOCK_OPTIONS, size: 0, date: false });
    expect(tiny.w).toBeGreaterThanOrEqual(WIDGET_MIN.clock.w);
    expect(tiny.h).toBeGreaterThanOrEqual(WIDGET_MIN.clock.h);
    expect(layoutValid([W("clock", 0, 0, 264, 136), W("clock", 0, 400, 264, 136)])).toBe(false);
  });

  it("처음 배치 — 시계는 늘 혼자 한 줄", () => {
    const d = defaultStartWidgets();
    const clock = d.find((w) => w.kind === "clock")!;
    expect(d.filter((w) => w.y === clock.y)).toHaveLength(1);
  });

  it("읽는 순서 — 세로로 겹친 것끼리 한 줄, 줄 안은 왼쪽부터", () => {
    const list = [W("shells", 500, 20), W("hosts", 0, 0), W("projects", 0, 400)];
    expect(readingOrder(list).map((w) => w.kind)).toEqual(["hosts", "shells", "projects"]);
  });

  it("더하기 — 누른 자리 가까운 빈자리에, 이미 있으면 그대로", () => {
    const list = [W("hosts", -120, -104)];
    const added = withNewWidget(list, "shells", { x: 0, y: 0 });
    expect(added).toHaveLength(2);
    expect(layoutValid(added)).toBe(true);
    expect(withNewWidget(added, "shells", { x: 900, y: 900 })).toEqual(added);
    const far = withNewWidget([], "projects", { x: 500, y: 300 });
    expect(far[0]).toMatchObject({ kind: "projects", x: 384, y: 200 });
  });

  it("시계를 더하면 시계의 처음 크기로, 누른 자리 가까운 빈자리에", () => {
    const lists = defaultStartWidgets().filter((w) => w.kind !== "clock");
    const added = withNewWidget(lists, "clock", { x: 0, y: 300 });
    expect(added[3]).toEqual({ kind: "clock", x: -128, y: 232, w: 264, h: 136 });
    expect(layoutValid(added)).toBe(true);
  });

  it("시계 박스가 바뀌면(초 · 날짜) 가운데를 지키고, 부딪히면 가장 가까운 빈자리로", () => {
    const d = defaultStartWidgets();
    const wide = withWidgetSize(d, "clock", { w: 400, h: 136 });
    expect(wide[0]).toEqual({ kind: "clock", x: -192, y: -224, w: 400, h: 136 }); // 가운데(4) − 200 → 눈금
    const low = withWidgetSize(d, "clock", { w: 264, h: 104 });
    expect(low[0]).toMatchObject({ x: -128, y: -208, w: 264, h: 104 });
    // 아래 목록과 부딪히는 크기 — 시계가 비켜 선다(목록은 그대로)
    const tall = withWidgetSize(d, "clock", { w: 264, h: 232 });
    expect(layoutValid(tall)).toBe(true);
    expect(tall.slice(1)).toEqual(d.slice(1));
    expect(withWidgetSize(d.slice(1), "clock", { w: 9, h: 9 })).toEqual(d.slice(1));
  });

  it("시계의 크기 모서리 = 글자 크기 — 박스가 비율대로 따라가고, 이웃 앞에서 멈춘다", () => {
    const d = defaultStartWidgets();
    const clock = d[0];
    const boxOf = (size: number) => clockBoxSize("ko", { ...DEFAULT_CLOCK_OPTIONS, size });
    const same = clampClockResize(clock, 88, clock.w, clock.h, d.slice(1), null, boxOf);
    expect(same).toEqual({ font: 88, box: { x: clock.x, y: clock.y, w: clock.w, h: clock.h } });
    const smaller = clampClockResize(clock, 88, clock.w / 2, clock.h / 2, d.slice(1), null, boxOf);
    expect(smaller.font).toBe(44);
    expect(smaller.box).toEqual({ x: clock.x, y: clock.y, ...boxOf(44) });
    expect(clampClockResize(clock, 88, 1, 1, [], null, boxOf).font).toBe(24); // 바닥
    expect(clampClockResize(clock, 88, 99_999, 99_999, [], null, boxOf).font).toBe(160); // 천장
    // 아래 목록(틈 16)에 닿으면 들어가는 데까지만 — 지금보다 작아지지는 않는다
    const grown = clampClockResize(clock, 88, clock.w * 3, clock.h * 3, d.slice(1), null, boxOf);
    expect(grown.font).toBeGreaterThanOrEqual(88);
    expect(layoutValid([{ kind: "clock", ...grown.box }, ...d.slice(1)])).toBe(true);
  });

  it("빼기 · 자리 바꾸기", () => {
    const d = defaultStartWidgets();
    expect(withoutWidget(d, "projects").map((w) => w.kind)).toEqual(["clock", "hosts", "shells"]);
    expect(withWidgetBox(d, "hosts", { x: 1, y: 2, w: 300, h: 300 })[1]).toEqual({ kind: "hosts", x: 1, y: 2, w: 300, h: 300 });
  });
});

describe("작은 창 — 통째로 줄인다", () => {
  const d = defaultStartWidgets(); // 폭 752 · 높이 360(시계 136 + 틈 16 + 목록 208), 가운데보다 위 — 위로 224 · 아래로 136

  it("들어가면 1 — 키우지 않는다", () => {
    expect(fitScale(d, 1200, 800)).toBe(1);
    expect(fitScale([], 100, 100)).toBe(1);
    expect(fitScale(d, 0, 0)).toBe(1);
  });

  it("안 들어가면 바깥 상자(+여백 16)가 들어갈 만큼만", () => {
    // 가로 반폭 376 → (600/2 − 16) / 376
    expect(fitScale(d, 600, 800)).toBeCloseTo(284 / 376);
    const s = fitScale(d, 720, 480);
    expect(s).toBeCloseTo(344 / 376);
    // 세로 반높이 224 → (400/2 − 16) / 224 — 가장 작은 창에서도 좁은 판으로 떨어지지 않는다
    expect(fitScale(d, 900, 400)).toBeCloseTo(184 / 224);
    expect(isNarrowBoard(d, 720, 400)).toBe(false);
  });

  it("판 경계는 배율로 넓어지고, 눈금 안쪽으로 내린다", () => {
    expect(boardBounds(800, 600, 0.5)).toEqual({ left: -784, top: -584, right: 784, bottom: 584 });
    expect(boardBounds(1064, 704, 1)).toEqual({ left: -512, top: -336, right: 512, bottom: 336 });
    expect(boardBounds(0, 600, 1)).toBeNull();
  });

  it("경계에 밀려 붙은 새 위젯도 눈금에 남아 이웃 사이의 꼭 맞는 틈에 들어간다", () => {
    const layout = [W("hosts", -376, -152, 240, 272), W("shells", 136, -152)];
    const b = boardBounds(1064, 704, 1);
    const added = withNewWidget(layout, "projects", { x: -490, y: -320 }, b);
    expect(added[2]).toMatchObject({ x: -120, y: -336 });
    expect(layoutValid(added)).toBe(true);
  });
});

describe("좁은 판 — 줄이는 바닥 아래면 한 줄로 쌓는다", () => {
  const d = defaultStartWidgets(); // 폭 752(반폭 376) · 위로 224

  it("배율이 바닥(0.5) 아래일 때만 좁은 판 — 그 사이는 예전처럼 줄인다", () => {
    expect(MIN_FIT_SCALE).toBe(0.5);
    expect(isNarrowBoard(d, 1200, 800)).toBe(false); // 배율 1
    // 가로 — 반폭 376 × 0.5 = 188 → 판 폭 (188 + 16) × 2 = 408 이 경계
    expect(fitScale(d, 596, 800)).toBeGreaterThan(MIN_FIT_SCALE);
    expect(fitScale(d, 596, 800)).toBeLessThan(1);
    expect(isNarrowBoard(d, 596, 800)).toBe(false); // 예전(0.75) 경계 — 이제는 줄인다
    expect(isNarrowBoard(d, 408, 800)).toBe(false);
    expect(isNarrowBoard(d, 406, 800)).toBe(true);
    expect(isNarrowBoard(d, 360, 800)).toBe(true);
    // 세로 — 위로 224 × 0.5 = 112 → 판 높이 (112 + 16) × 2 = 256 이 경계
    expect(isNarrowBoard(d, 1200, 256)).toBe(false);
    expect(isNarrowBoard(d, 1200, 254)).toBe(true);
    expect(isNarrowBoard([], 100, 100)).toBe(false);
    expect(isNarrowBoard(d, 0, 0)).toBe(false); // 아직 못 쟀다
  });

  it("읽는 순서로 위에서 아래, 가로 가운데, 사이 16, 위 · 아래 여백 16", () => {
    const list = [W("shells", 500, 20), W("hosts", 0, 0), W("projects", 0, 400, 300, 160)];
    const { boxes, height } = narrowStack(list, 400);
    expect(boxes.map((w) => w.kind)).toEqual(["hosts", "shells", "projects"]);
    expect(boxes.map((w) => w.y)).toEqual([16, 16 + 208 + WIDGET_GAP, 16 + 2 * (208 + WIDGET_GAP)]);
    expect(boxes.map((w) => w.x)).toEqual([80, 80, 50]);
    expect(boxes.map((w) => w.h)).toEqual([208, 208, 160]);
    expect(height).toBe(16 + 208 + 16 + 208 + 16 + 160 + 16);
    expect(layoutValid(boxes)).toBe(true);
  });

  it("폭 = 저장된 폭과 판 폭(− 여백) 중 작은 것, 최소 폭 아래로는 판이 그보다 좁을 때만", () => {
    const list = [W("projects", 0, 0, 600, 208)];
    expect(narrowStack(list, 400).boxes[0]).toMatchObject({ x: 16, w: 368 });
    // 판 − 여백 = 168 < 최소 200 → 판에 맞춘다(가로로는 굴리지 않는다)
    expect(narrowStack(list, 200).boxes[0]).toMatchObject({ x: 16, w: 168 });
    expect(narrowStack(list, 10).boxes[0].w).toBe(0);
  });

  it("판보다 낮으면 세로 가운데, 높으면 위에서부터 — 저장된 배치는 그대로", () => {
    const list = [W("hosts", 0, 0)];
    const before = JSON.stringify(list);
    expect(narrowStack(list, 400, 600).boxes[0].y).toBe(196);
    expect(narrowStack(list, 400, 100).boxes[0].y).toBe(16);
    expect(JSON.stringify(list)).toBe(before);
    expect(narrowStack([], 400, 600)).toEqual({ boxes: [], height: 0 });
  });
});

describe("저장 글자", () => {
  it("왕복", () => {
    const d = defaultStartWidgets();
    expect(parseStartWidgets(serializeStartWidgets(d))).toEqual(d);
    expect(parseStartWidgets(serializeStartWidgets([]))).toEqual([]);
  });

  it("시계가 생기기 전의 저장값(목록 셋)도 그대로 읽힌다 — 시계를 끼워 넣지 않는다", () => {
    const old = JSON.stringify({
      v: 1,
      widgets: [
        { kind: "hosts", x: -376, y: -152, w: 240, h: 208 },
        { kind: "projects", x: -120, y: -152, w: 240, h: 208 },
        { kind: "shells", x: 136, y: -152, w: 240, h: 208 },
      ],
    });
    expect(parseStartWidgets(old)?.map((w) => w.kind)).toEqual(["hosts", "projects", "shells"]);
    const withClock = JSON.stringify({ v: 1, widgets: [{ kind: "clock", x: 0, y: 0, w: 368, h: 160 }] });
    expect(parseStartWidgets(withClock)).toEqual([{ kind: "clock", x: 0, y: 0, w: 368, h: 160 }]);
  });

  it("저장된 적 없음 · 깨진 글자 · 모르는 판 · 규칙 위반은 null(= 처음 배치)", () => {
    expect(parseStartWidgets(null)).toBeNull();
    expect(parseStartWidgets("{")).toBeNull();
    expect(parseStartWidgets("[]")).toBeNull();
    expect(parseStartWidgets(JSON.stringify({ v: 2, widgets: [] }))).toBeNull();
    const bad = (widgets: unknown) => parseStartWidgets(JSON.stringify({ v: 1, widgets }));
    expect(bad([{ kind: "weather", x: 0, y: 0, w: 240, h: 208 }])).toBeNull();
    expect(bad([{ kind: "clock", x: 0, y: 0, w: 40, h: 208 }])).toBeNull(); // 시계도 바닥보다 작으면
    expect(bad([{ kind: "hosts", x: "0", y: 0, w: 240, h: 208 }])).toBeNull();
    expect(bad([W("hosts", 0, 0), W("hosts", 400, 0)])).toBeNull(); // 같은 종류 둘
    expect(bad([W("hosts", 0, 0), W("shells", 100, 0)])).toBeNull(); // 겹친다
    expect(bad([W("hosts", 0, 0, 20, 20)])).toBeNull(); // 최소보다 작다
    expect(bad([null])).toBeNull();
  });
});

describe("되돌리기 기록 (판 · 시계 우클릭의 [되돌리기])", () => {
  const clock = { ...DEFAULT_CLOCK_OPTIONS };
  const board = (widgets: StartWidget[], c = clock) => ({ widgets, clock: { ...c } });
  const d = defaultStartWidgets();

  it("배치가 바뀌었나 — 위젯 배치와 시계 글자 크기만 보고, 시계 옵션(12/24 · 초 · 날짜)은 보지 않는다", () => {
    expect(boardChangedForUndo(board(d), board(d))).toBe(false); // 제자리 놓기
    expect(boardChangedForUndo(board(d), board(withoutWidget(d, "hosts")))).toBe(true);
    expect(boardChangedForUndo(board(d), board(d, { ...clock, size: 120 }))).toBe(true); // 글자 크기 = 크기 바꾸기
    expect(boardChangedForUndo(board(d), board(d, { ...clock, hour12: true, seconds: true, date: false }))).toBe(false);
  });

  it("쌓고 차례로 꺼낸다 — 상한을 넘으면 가장 오래된 것부터 버린다", () => {
    let stack = pushUndo([], board(d));
    stack = pushUndo(stack, board(withoutWidget(d, "hosts")));
    const r1 = popUndo(stack, board(withoutWidget(withoutWidget(d, "hosts"), "shells")))!;
    expect(r1.board.widgets).toEqual(withoutWidget(d, "hosts"));
    const r2 = popUndo(r1.stack, r1.board)!;
    expect(r2.board.widgets).toEqual(d);
    expect(popUndo(r2.stack, r2.board)).toBeNull();
    let many: ReturnType<typeof pushUndo> = [];
    for (let i = 0; i < START_UNDO_MAX + 5; i++) many = pushUndo(many, board([W("hosts", i * 8, 0)]));
    expect(many).toHaveLength(START_UNDO_MAX);
    expect(many[0].widgets[0].x).toBe(5 * 8);
  });

  it("되돌리면 시계 옵션은 지금 것 + 그때의 글자 크기 — 지운 시계를 되살릴 때만 그때의 표시 전부", () => {
    const then = { ...clock, hour12: true, size: 60 };
    const now = { ...clock, seconds: true, size: 100 };
    // 시계 크기를 바꾼 것을 되돌린다 — 옵션은 지금 것(초 켬), 크기만 그때
    const back = popUndo(pushUndo([], board(d, then)), board(d, now))!;
    expect(back.board.clock).toEqual({ ...now, size: 60 });
    // 시계를 지운 것을 되돌린다 — 그때의 표시 전부(12시간 · 60)
    const revived = popUndo(pushUndo([], board(d, then)), board(withoutWidget(d, "clock"), now))!;
    expect(revived.board.clock).toEqual(then);
    expect(revived.board.widgets.map((w) => w.kind)).toContain("clock");
  });

  it("쌓은 것은 복사본 — 나중에 배치를 고쳐도 기록이 따라 변하지 않는다", () => {
    const live = defaultStartWidgets();
    const stack = pushUndo([], board(live));
    live[0].x += 8;
    expect(stack[0].widgets[0].x).toBe(d[0].x);
  });
});
