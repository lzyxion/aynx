import { describe, expect, it } from "vitest";
import { gridColumn, launchLayout } from "./dock-launch-layout";

const at = (row: number, col: number, span = 1) => ({ row, col, span });

describe("launchLayout", () => {
  it("AI 둘 · 아이콘 넷 — 목업 E 그대로(셸 1줄 두 열 · AI 2줄 한 칸씩 · 아이콘 2×2)", () => {
    const l = launchLayout(2, 4);
    expect(l.shell).toEqual(at(1, 1, 2));
    expect(l.ais).toEqual([at(2, 1), at(2, 2)]);
    expect(l.icons).toEqual([at(1, 3), at(1, 4), at(2, 3), at(2, 4)]);
    expect(l.rows).toBe(2);
  });

  it("AI 하나 — 마지막 줄의 외톨이는 두 열을 쓴다", () => {
    const l = launchLayout(1, 4);
    expect(l.ais).toEqual([at(2, 1, 2)]);
    expect(l.rows).toBe(2);
  });

  it("AI 셋 — 3줄의 외톨이가 두 열 · 아이콘은 두 줄에서 끝나고 3줄 아이콘 자리는 빈다", () => {
    const l = launchLayout(3, 4);
    expect(l.ais).toEqual([at(2, 1), at(2, 2), at(3, 1, 2)]);
    expect(l.icons.at(-1)).toEqual(at(2, 4));
    expect(l.rows).toBe(3);
  });

  it("AI 0 — 셸 한 줄 · 아이콘이 줄 수를 정한다(2줄 글자 칸은 빈다)", () => {
    const l = launchLayout(0, 4);
    expect(l.ais).toEqual([]);
    expect(l.rows).toBe(2);
  });

  it("잠자기 방지가 없는 OS(아이콘 셋) — 2줄 끝 자리가 빈다", () => {
    const l = launchLayout(2, 3);
    expect(l.icons).toEqual([at(1, 3), at(1, 4), at(2, 3)]);
    expect(l.rows).toBe(2);
  });

  it("AI 넷 — 짝이 맞으면 외톨이가 없다", () => {
    const l = launchLayout(4, 4);
    expect(l.ais.every((c) => c.span === 1)).toBe(true);
    expect(l.ais.at(-1)).toEqual(at(3, 2));
    expect(l.rows).toBe(3);
  });

  it("아이콘 0 · 음수 · 소수는 0 으로 친다", () => {
    expect(launchLayout(-1, 0)).toEqual({ shell: at(1, 1, 2), ais: [], icons: [], rows: 1 });
  });
});

describe("gridColumn", () => {
  it("시작 / span n", () => {
    expect(gridColumn(at(1, 1, 2))).toBe("1 / span 2");
    expect(gridColumn(at(2, 4))).toBe("4 / span 1");
  });
});
