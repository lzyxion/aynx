import { describe, expect, it } from "vitest";
import {
  agentFirst,
  firstLauncherPos,
  launcherMove,
  launcherSeed,
  placeDefaultPalette,
  shellColumn,
  type LauncherArea,
} from "$lib/launcher";

/** 시작 화면(launcher)의 규칙 (docs/log/2026-09-25-launcher.md) */

const sh = (...ids: string[]) => ids.map((id) => ({ id }));

describe("shellColumn — 셸 단의 줄", () => {
  it("기본 셸이 맨 위, 나머지는 감지 순서", () => {
    expect(shellColumn(sh("cmd", "pwsh", "wsl:Ubuntu"), "pwsh").shells.map((s) => s.id)).toEqual(["pwsh", "cmd", "wsl:Ubuntu"]);
  });
  it("기본이 목록에 없으면 순서 그대로", () => {
    expect(shellColumn(sh("a", "b"), "zzz").shells.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("예약 슬롯 없이 셸이 다섯까지", () => {
    expect(shellColumn(sh("a", "b", "c", "d", "e", "f"), "f").shells.map((s) => s.id)).toEqual(["f", "a", "b", "c", "d"]);
    expect(shellColumn(sh("a"), "a").shells).toHaveLength(1);
  });
});

describe("launcherMove — 화살표 (위젯 판)", () => {
  // 위젯 셋이 나란히(처음 배치): 호스트 3줄 · 프로젝트 0줄 · 셸 2줄 — 한 단에 5줄
  const box = (x: number, y = -152, w = 240, h = 208) => ({ x, y, w, h });
  const area = (size: number, rect: LauncherArea["rect"], rows = 5, cols = 1): LauncherArea => ({ size, rect, rows, cols });
  const row3: LauncherArea[] = [area(3, box(-376)), area(0, box(-120)), area(2, box(136))];

  it("선택이 없으면 비지 않은 첫 위젯의 첫 줄", () => {
    expect(launcherMove(row3, null, "down")).toEqual({ area: 0, index: 0 });
    expect(firstLauncherPos([area(0, box(0)), area(2, box(300))])).toEqual({ area: 1, index: 0 });
    expect(firstLauncherPos([area(0, box(0))])).toBeNull();
    expect(firstLauncherPos([])).toBeNull();
  });

  it("위젯 안의 ↑↓, 가장자리에서 위아래 이웃이 없으면 제자리", () => {
    expect(launcherMove(row3, { area: 0, index: 0 }, "down")).toEqual({ area: 0, index: 1 });
    expect(launcherMove(row3, { area: 0, index: 2 }, "down")).toEqual({ area: 0, index: 2 });
    expect(launcherMove(row3, { area: 2, index: 0 }, "up")).toEqual({ area: 2, index: 0 });
  });

  it("←→ 는 빈 위젯을 건너 가장 가까운 위젯의 같은 번째 줄로 (짧으면 끝 줄)", () => {
    expect(launcherMove(row3, { area: 0, index: 2 }, "right")).toEqual({ area: 2, index: 1 });
    expect(launcherMove(row3, { area: 2, index: 0 }, "left")).toEqual({ area: 0, index: 0 });
    expect(launcherMove(row3, { area: 2, index: 0 }, "right")).toEqual({ area: 2, index: 0 });
    expect(launcherMove(row3, { area: 0, index: 0 }, "left")).toEqual({ area: 0, index: 0 });
  });

  it("↑↓ 가 가장자리를 넘어 바로 아래 · 위에 가로로 겹친 위젯으로 이어진다", () => {
    // 호스트 위 · 셸 아래(겹친다) · 프로젝트는 오른쪽 멀리(겹치지 않는다)
    const stack = [area(3, box(0, 0)), area(2, box(40, 240)), area(4, box(600, 240))];
    expect(launcherMove(stack, { area: 0, index: 2 }, "down")).toEqual({ area: 1, index: 0 });
    expect(launcherMove(stack, { area: 1, index: 0 }, "up")).toEqual({ area: 0, index: 2 });
    // 셸에서 아래로는 아무도 없다
    expect(launcherMove(stack, { area: 1, index: 1 }, "down")).toEqual({ area: 1, index: 1 });
    // 프로젝트 위에는 가로로 겹친 위젯이 없다
    expect(launcherMove(stack, { area: 2, index: 0 }, "up")).toEqual({ area: 2, index: 0 });
  });

  it("←→ 는 세로로 겹친 위젯이 먼저, 없으면 가운데가 가장 가까운 위젯", () => {
    const free = [area(1, box(0, 0)), area(1, box(400, 300)), area(1, box(800, 0))];
    // 오른쪽에 세로로 겹친 것은 셋째(먼 것)뿐 — 겹친 쪽이 이긴다
    expect(launcherMove(free, { area: 0, index: 0 }, "right")).toEqual({ area: 2, index: 0 });
    const loose = [area(1, box(0, 0)), area(1, box(400, 400)), area(1, box(900, 600))];
    expect(launcherMove(loose, { area: 0, index: 0 }, "right")).toEqual({ area: 1, index: 0 });
  });

  it("두 단 위젯 — ↑↓ 는 단 안, ←→ 는 먼저 옆 단, 끝 단에서 옆 위젯", () => {
    // 넓은 호스트 위젯(두 단 · 한 단 3줄 → 6줄: 0·1·2 | 3·4·5) 옆에 셸 위젯
    const wide = [area(6, box(0, 0, 400), 3, 2), area(2, box(432, 0))];
    expect(launcherMove(wide, { area: 0, index: 2 }, "down")).toEqual({ area: 0, index: 2 });
    expect(launcherMove(wide, { area: 0, index: 1 }, "right")).toEqual({ area: 0, index: 4 });
    expect(launcherMove(wide, { area: 0, index: 4 }, "left")).toEqual({ area: 0, index: 1 });
    expect(launcherMove(wide, { area: 0, index: 4 }, "right")).toEqual({ area: 1, index: 1 });
    expect(launcherMove(wide, { area: 1, index: 0 }, "left")).toEqual({ area: 0, index: 3 });
    // 둘째 단이 짧으면 그 단의 끝 줄
    const short = [area(4, box(0, 0, 400), 3, 2)];
    expect(launcherMove(short, { area: 0, index: 2 }, "right")).toEqual({ area: 0, index: 3 });
  });

  it("시계(줄 없는 위젯)는 건너뛴다 — 처음 배치: 위 줄 시계 · 아래 줄 목록 셋", () => {
    const clock = area(0, box(-376, -232, 752, 144), 3);
    const lists = [area(3, box(-376, -72)), area(0, box(-120, -72)), area(2, box(136, -72))];
    const board = [clock, ...lists];
    // 첫 자리는 시계가 아니라 첫 목록의 첫 줄
    expect(firstLauncherPos(board)).toEqual({ area: 1, index: 0 });
    expect(launcherMove(board, null, "up")).toEqual({ area: 1, index: 0 });
    // 목록 맨 윗줄에서 ↑ — 위는 시계뿐이라 제자리
    expect(launcherMove(board, { area: 1, index: 0 }, "up")).toEqual({ area: 1, index: 0 });
    expect(launcherMove(board, { area: 3, index: 0 }, "up")).toEqual({ area: 3, index: 0 });
    // ←→ 도 시계로 가지 않는다
    expect(launcherMove(board, { area: 1, index: 0 }, "left")).toEqual({ area: 1, index: 0 });
    expect(launcherMove(board, { area: 1, index: 2 }, "right")).toEqual({ area: 3, index: 1 });
    // 시계가 두 목록 사이에 끼어 있으면 ↓ 가 시계를 지나 그 아래 목록으로
    const between = [area(2, box(0, 0)), area(0, box(0, 224, 240, 144)), area(2, box(0, 384))];
    expect(launcherMove(between, { area: 0, index: 1 }, "down")).toEqual({ area: 2, index: 0 });
    expect(launcherMove(between, { area: 2, index: 0 }, "up")).toEqual({ area: 0, index: 1 });
  });

  it("범위를 벗어난 선택(목록이 줄었다)은 첫 자리로", () => {
    expect(launcherMove(row3, { area: 2, index: 9 }, "up")).toEqual({ area: 0, index: 0 });
  });
});

describe("launcherSeed — 타자가 팔레트를 연다", () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) =>
    launcherSeed({ key, ctrlKey: false, altKey: false, metaKey: false, ...mods });

  it("글자 하나는 그 글자로", () => {
    expect(k("w")).toBe("w");
    expect(k("W")).toBe("W");
    expect(k(">")).toBe(">");
  });

  it("스페이스·화살표·Enter·수식 조합은 아니다", () => {
    expect(k(" ")).toBeNull();
    expect(k("ArrowDown")).toBeNull();
    expect(k("Enter")).toBeNull();
    expect(k("w", { ctrlKey: true })).toBeNull();
    expect(k("w", { altKey: true })).toBeNull();
  });

  it("IME 조합 시작은 빈 칸으로 연다", () => {
    expect(k("Process")).toBe("");
    expect(k("ㅎ", { isComposing: true })).toBe("");
  });
});

describe("agentFirst — 에이전트가 붙은 프로젝트가 위로", () => {
  it("권한 대기 → 완료 → 실행 중 → 없음, 같은 무게끼리는 제자리", () => {
    const st: Record<string, string | null> = { a: null, b: "running", c: "permission", d: null, e: "finished", f: "other" };
    expect(agentFirst(["a", "b", "c", "d", "e", "f"], (x) => st[x])).toEqual(["c", "e", "b", "a", "d", "f"]);
  });
});

describe("placeDefaultPalette — 칸 없이 여는 팔레트는 타일 캔버스 기준", () => {
  it("캔버스 가로 가운데 · 캔버스 위 + 높이의 12%", () => {
    // 상태바 위: 캔버스가 창 전폭, 위 67
    expect(placeDefaultPalette({ left: 0, top: 67, width: 1100, height: 733 }, 1100, 800)).toEqual({
      left: 270,
      top: 67 + 733 * 0.12,
      width: 560,
      maxHeight: 560,
    });
  });

  it("상태바가 왼쪽 기둥이면 캔버스 가운데로 비켜 선다(창 가운데가 아니라)", () => {
    const r = placeDefaultPalette({ left: 48, top: 40, width: 1052, height: 760 }, 1100, 800);
    expect(r.left + r.width / 2).toBe(48 + 1052 / 2);
    expect(r.top).toBeCloseTo(40 + 760 * 0.12);
  });

  it("창보다 넓으면 좌우 여백 안으로, 가운데가 가장자리에 붙어도 화면 밖으로 안 나간다", () => {
    expect(placeDefaultPalette({ left: 0, top: 40, width: 400, height: 700 }, 400, 800)).toMatchObject({ left: 16, width: 368 });
    expect(placeDefaultPalette({ left: 900, top: 40, width: 100, height: 700 }, 1100, 800)).toMatchObject({ left: 1100 - 16 - 560 });
  });

  it("낮은 창 — 아래 자리가 모자라면 끌어올리고, 높이 상한은 바닥까지", () => {
    const r = placeDefaultPalette({ left: 0, top: 100, width: 1100, height: 250 }, 1100, 350);
    expect(r.top).toBe(350 - 16 - 280);
    expect(r.maxHeight).toBeCloseTo(245); // 70vh (바닥까지 = 280 보다 작다)
  });
});
