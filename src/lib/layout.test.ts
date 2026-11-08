import { describe, expect, it } from "vitest";
import {
  autoSplitDir,
  computeLayout,
  FULL_RECT,
  GAP,
  neighborInDirection,
  neighborOfRect,
  toPx,
  type PaneBox,
  type Rect,
} from "$lib/layout";
import {
  leafOf,
  type PaneNode,
  type PaneSpec,
  type SplitDir,
} from "$lib/session";

// ---------------------------------------------------------------------------
// 도우미 — 트리와 사각형을 손으로 짓는다.
//
// 좌표는 전부 **명목 1000px** 로 읽는다 (`toPx(len, 1000)`). layout.ts 의 방향 이웃 판정이
// 쓰는 눈금과 같은 값이라, 여기서 잰 숫자를 그대로 규칙과 견줄 수 있다.
// ---------------------------------------------------------------------------

/** 잎 하나 — `PaneSpec` 의 종류는 기하와 무관하므로 전부 `local` 이다 */
const spec = (id: string): PaneSpec => ({ id, kind: "local" });
const leaf = (id: string): PaneNode => leafOf(spec(id));

/** 분할 하나 (비율 기본 0.5) */
const split = (dir: SplitDir, a: PaneNode, b: PaneNode, ratio = 0.5): PaneNode => ({
  type: "split",
  dir,
  ratio,
  a,
  b,
});

/** px 만으로 된 사각형 — 퍼센트가 섞이지 않아 좌표를 눈으로 읽을 수 있다 */
const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x: { pct: 0, px: x },
  y: { pct: 0, px: y },
  w: { pct: 0, px: w },
  h: { pct: 0, px: h },
});

/** 상자 하나 (`neighborOfRect` 의 후보) */
const box = (id: string, x: number, y: number, w: number, h: number): PaneBox => ({
  pane: spec(id),
  rect: rect(x, y, w, h),
});

/** 컨테이너 1000px 기준의 `[x0, y0, x1, y1]` */
function edges(r: Rect): [number, number, number, number] {
  const x0 = toPx(r.x, 1000);
  const y0 = toPx(r.y, 1000);
  return [x0, y0, x0 + toPx(r.w, 1000), y0 + toPx(r.h, 1000)];
}

/** 트리를 펴서 `id → 명목 좌표` 표로 */
function rectsOf(root: PaneNode): Record<string, [number, number, number, number]> {
  const out: Record<string, [number, number, number, number]> = {};
  for (const b of computeLayout(root).panes) out[b.pane.id] = edges(b.rect);
  return out;
}

// ---------------------------------------------------------------------------

describe("computeLayout", () => {
  it("잎 하나면 컨테이너 전체를 차지하고 분할선이 없다", () => {
    const only = spec("A");
    const { panes, lines } = computeLayout(leafOf(only));

    expect(panes).toHaveLength(1);
    expect(lines).toHaveLength(0);
    // 패널 명세는 **복사되지 않는다** — 트리에 있던 그 객체가 그대로 나온다.
    expect(panes[0].pane).toBe(only);
    expect(panes[0].rect).toEqual(FULL_RECT);
  });

  it("row 분할(비율 0.5)은 좌우로 반씩 나누고 사이에 GAP 을 둔다", () => {
    const { panes, lines } = computeLayout(split("row", leaf("A"), leaf("B")));
    const half = GAP / 2;

    expect(panes.map((p) => p.pane.id)).toEqual(["A", "B"]);
    // 왼쪽: 폭이 50% 에서 거터의 절반만큼 줄어든다.
    expect(panes[0].rect).toEqual({
      x: { pct: 0, px: 0 },
      y: { pct: 0, px: 0 },
      w: { pct: 50, px: -half },
      h: { pct: 100, px: 0 },
    });
    // 오른쪽: 50% 지점에서 거터의 절반만큼 밀려 시작한다.
    expect(panes[1].rect).toEqual({
      x: { pct: 50, px: half },
      y: { pct: 0, px: 0 },
      w: { pct: 50, px: -half },
      h: { pct: 100, px: 0 },
    });
    // 명목 1000px 로 펴면 496 / 8 / 496 이다 (합이 딱 1000).
    expect(edges(panes[0].rect)).toEqual([0, 0, 496, 1000]);
    expect(edges(panes[1].rect)).toEqual([504, 0, 1000, 1000]);

    expect(lines).toHaveLength(1);
    expect(lines[0].dir).toBe("row");
    expect(lines[0].key).toBe("r");
    expect(lines[0].host).toEqual(FULL_RECT);
    // 분할선은 두께 GAP 의 세로 띠다.
    expect(lines[0].rect).toEqual({
      x: { pct: 50, px: -half },
      y: { pct: 0, px: 0 },
      w: { pct: 0, px: GAP },
      h: { pct: 100, px: 0 },
    });
  });

  it("col 분할은 같은 규칙을 세로축에 적용한다", () => {
    const { panes, lines } = computeLayout(split("col", leaf("A"), leaf("B")));

    expect(edges(panes[0].rect)).toEqual([0, 0, 1000, 496]);
    expect(edges(panes[1].rect)).toEqual([0, 504, 1000, 1000]);
    expect(lines[0].dir).toBe("col");
    // 가로 분할선 — 폭은 host 그대로, 높이만 GAP.
    expect(lines[0].rect.w).toEqual({ pct: 100, px: 0 });
    expect(lines[0].rect.h).toEqual({ pct: 0, px: GAP });
  });

  it("비율이 반영된다 (0.25 면 1:3)", () => {
    const { panes } = computeLayout(split("row", leaf("A"), leaf("B"), 0.25));

    expect(panes[0].rect.w).toEqual({ pct: 25, px: -GAP / 2 });
    expect(panes[1].rect.x).toEqual({ pct: 25, px: GAP / 2 });
    expect(panes[1].rect.w).toEqual({ pct: 75, px: -GAP / 2 });
  });

  it("범위 밖 비율은 clampRatio 로 잘려서 그려진다 (0.95 → 0.85)", () => {
    const { panes } = computeLayout(split("row", leaf("A"), leaf("B"), 0.95));

    expect(panes[0].rect.w.pct).toBeCloseTo(85, 6);
    expect(panes[1].rect.w.pct).toBeCloseTo(15, 6);
  });

  it("중첩된 분할은 부모의 사각형 안에서 다시 나뉜다", () => {
    // A | (B / C)
    const root = split("row", leaf("A"), split("col", leaf("B"), leaf("C")));
    const { panes, lines } = computeLayout(root);

    expect(panes.map((p) => p.pane.id)).toEqual(["A", "B", "C"]);
    expect(lines).toHaveLength(2);
    // 안쪽 분할선이 먼저(자식 순회 중에) 쌓이고 바깥 것이 나중이다.
    expect(lines.map((l) => l.key)).toEqual(["rb", "r"]);

    const r = rectsOf(root);
    expect(r.A).toEqual([0, 0, 496, 1000]);
    // B·C 는 오른쪽 절반(504~1000) 안에서 위아래로 나뉜다.
    expect(r.B).toEqual([504, 0, 1000, 496]);
    expect(r.C).toEqual([504, 504, 1000, 1000]);
  });
});

describe("neighborOfRect — 방향 이웃의 규칙", () => {
  const me = rect(0, 0, 100, 100);

  it("겹치지 않으면 후보가 아니다 (닿기만 하는 것도 겹침이 아니다)", () => {
    // 오른쪽에 있지만 수직 축에서 정확히 맞닿기만 한다 (y: 100 에서 시작).
    const touching = box("T", 110, 100, 100, 100);
    expect(neighborOfRect([touching], me, "right")).toBeNull();

    // 1px 이라도 겹치면 후보가 된다.
    const overlapping = box("O", 110, 99, 100, 100);
    expect(neighborOfRect([overlapping], me, "right")).toBe("O");
  });

  it("진행 축에서 내 변을 넘어서지 않은 것은 후보가 아니다", () => {
    // 왼쪽에 있는 상자는 `right` 의 후보가 아니다.
    expect(neighborOfRect([box("L", -200, 0, 100, 100)], me, "right")).toBeNull();
    // 방향을 뒤집으면 같은 상자가 후보가 된다.
    expect(neighborOfRect([box("L", -200, 0, 100, 100)], me, "left")).toBe("L");
  });

  it("1순위는 가장자리 거리 — 가까운 쪽이 이긴다", () => {
    const near = box("N", 110, 0, 100, 100);
    const far = box("F", 400, 0, 100, 100);
    expect(neighborOfRect([far, near], me, "right")).toBe("N");
    expect(neighborOfRect([near, far], me, "right")).toBe("N");
  });

  it("2순위는 겹침 길이 — 거리가 같으면 나와 더 많이 겹친 쪽", () => {
    // 둘 다 x=110 에서 시작(거리 동률)하고, 겹침만 다르다.
    const thin = box("thin", 110, 0, 100, 20);
    const wide = box("wide", 110, 0, 100, 80);
    expect(neighborOfRect([thin, wide], me, "right")).toBe("wide");
    expect(neighborOfRect([wide, thin], me, "right")).toBe("wide");
  });

  it("3순위는 중심 거리 — 겹침까지 같으면 수직 축 중심이 가까운 쪽", () => {
    // 둘 다 거리 10, 겹침 50. 중심만 다르다 (내 중심 = 50).
    const centered = box("centered", 110, 20, 100, 50); // 중심 45 → 거리 5
    const offset = box("offset", 110, 50, 100, 50); // 중심 75 → 거리 25
    expect(neighborOfRect([offset, centered], me, "right")).toBe("centered");
    expect(neighborOfRect([centered, offset], me, "right")).toBe("centered");
  });

  it("exclude 에 든 잎은 후보에서 빠진다", () => {
    const near = box("N", 110, 0, 100, 100);
    const far = box("F", 400, 0, 100, 100);
    expect(neighborOfRect([near, far], me, "right", new Set(["N"]))).toBe("F");
    expect(neighborOfRect([near, far], me, "right", new Set(["N", "F"]))).toBeNull();
  });

  it("후보가 없으면 null (감싸 돌지 않는다)", () => {
    expect(neighborOfRect([], me, "up")).toBeNull();
    expect(neighborOfRect([box("B", 110, 0, 100, 100)], me, "left")).toBeNull();
  });
});

describe("neighborInDirection", () => {
  // 2×2 격자 — ((A|B)/(C|D))
  const grid = split("col", split("row", leaf("A"), leaf("B")), split("row", leaf("C"), leaf("D")));
  const panes = computeLayout(grid).panes;

  it("2×2 격자에서 네 방향이 서로 맞물린다", () => {
    expect(neighborInDirection(panes, "A", "right")).toBe("B");
    expect(neighborInDirection(panes, "A", "down")).toBe("C");
    expect(neighborInDirection(panes, "B", "left")).toBe("A");
    expect(neighborInDirection(panes, "D", "up")).toBe("B");
  });

  it("대각선 타일로는 튀지 않는다 (겹치지 않으므로 후보가 아니다)", () => {
    // A 의 오른쪽에 D 도 있지만 세로로 겹치지 않는다 → 언제나 B 다.
    expect(neighborInDirection(panes, "A", "right")).not.toBe("D");
    expect(neighborInDirection(panes, "C", "right")).toBe("D");
  });

  it("가장자리면 null", () => {
    expect(neighborInDirection(panes, "A", "left")).toBeNull();
    expect(neighborInDirection(panes, "A", "up")).toBeNull();
    expect(neighborInDirection(panes, "D", "right")).toBeNull();
    expect(neighborInDirection(panes, "D", "down")).toBeNull();
  });

  it("이웃이 잎 하나가 아니라 서브트리여도 화면에서 가장 가까운 잎을 고른다", () => {
    // A | (B / (C|D)) — A 의 오른쪽 절반 전체가 이웃이지만, 사각형으로 보면 B 가 가장 가깝다.
    const spiral = split("row", leaf("A"), split("col", leaf("B"), split("row", leaf("C"), leaf("D"))));
    const boxes = computeLayout(spiral).panes;
    expect(neighborInDirection(boxes, "A", "right")).toBe("B");
  });

  it("없는 id 면 null", () => {
    expect(neighborInDirection(panes, "없는-패널", "right")).toBeNull();
  });

  // 소스의 ASCII 그림 그대로 — 주석이 그림과 어긋나지 않는지 여기서 잡는다.
  //
  //   ┌───────┬───────┐
  //   │       │   B   │
  //   │   A   ├───────┤
  //   │       │   C   │
  //   ├───────┴───────┤
  //   │       D       │
  //   └───────────────┘
  describe("소스 주석의 그림", () => {
    const figure = split("col", split("row", leaf("A"), split("col", leaf("B"), leaf("C"))), leaf("D"));
    const boxes = computeLayout(figure).panes;

    it("A 에서 ↓ 는 D 다 (아래로 넘어서고 가로로 겹친다)", () => {
      expect(neighborInDirection(boxes, "A", "down")).toBe("D");
    });

    it("B 에서 ↓ 는 C 다 — D 도 후보지만 가장자리가 더 멀다", () => {
      expect(neighborInDirection(boxes, "B", "down")).toBe("C");
    });

    it("B 에서 ← 는 A", () => {
      expect(neighborInDirection(boxes, "B", "left")).toBe("A");
    });

    it("A 에서 → 는 B·C 가 완전 대칭이라 어느 쪽이든 뜻이 같다", () => {
      // 가장자리 거리도 겹침 길이도 중심 거리도 같다 = 세 규칙 전부 동점.
      expect(["B", "C"]).toContain(neighborInDirection(boxes, "A", "right"));
    });
  });
});

describe("autoSplitDir — 긴 변으로 자른다", () => {
  const full = FULL_RECT;

  it("가로로 긴 사각형은 row(좌우)", () => {
    expect(autoSplitDir(full, 1600, 900)).toBe("row");
  });

  it("세로로 긴 사각형은 col(상하)", () => {
    expect(autoSplitDir(full, 900, 1600)).toBe("col");
  });

  it("경계(정사각형)는 row — `w >= h` 라 기본값 쪽으로 떨어진다", () => {
    expect(autoSplitDir(full, 1000, 1000)).toBe("row");
  });

  it("컨테이너 안의 한 칸도 그 칸의 픽셀 두 변으로 판단한다", () => {
    // 창은 가로로 길지만(1600×900) 이 칸은 폭 25% 라 세로로 길다 → col.
    const column: Rect = {
      x: { pct: 0, px: 0 },
      y: { pct: 0, px: 0 },
      w: { pct: 25, px: 0 },
      h: { pct: 100, px: 0 },
    };
    expect(autoSplitDir(column, 1600, 900)).toBe("col"); // 400 × 900
    expect(autoSplitDir(column, 1600, 300)).toBe("row"); // 400 × 300
  });

  it("컨테이너 크기를 모르면 row 로 떨어진다 (마운트 전 폴백)", () => {
    expect(autoSplitDir(full, 0, 0)).toBe("row");
    expect(autoSplitDir(full, 0, 900)).toBe("row");
    expect(autoSplitDir(full, Number.NaN, 900)).toBe("row");
  });
});
