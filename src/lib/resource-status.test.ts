import { describe, expect, it } from "vitest";
import type { ResourceSample } from "./resources";
import {
  RING_STALE_MS,
  formatMemPair,
  prismShare,
  resourceRings,
  sparkline,
  systemPct,
  topConsumers,
} from "./resource-status";

const GB = 1024 ** 3;

const s = (at: number, sys: [number, number, number] | null, tiles: Record<string, [number, number]> = {}): ResourceSample => ({
  at,
  gui: { cpu: 1, mem: 100 },
  server: { cpu: 2, mem: 200 },
  tiles: Object.fromEntries(Object.entries(tiles).map(([k, [cpu, mem]]) => [k, { cpu, mem }])),
  ...(sys ? { system: { cpu: sys[0], memUsed: sys[1], memTotal: sys[2] } } : {}),
});

describe("resource-status", () => {
  it("이 PC 전체 % — 메모리 전체를 모르면 null", () => {
    expect(systemPct({ cpu: 23.4, memUsed: 0, memTotal: 0 }, "cpu")).toBe(23.4);
    expect(systemPct({ cpu: 130, memUsed: 0, memTotal: 0 }, "cpu")).toBe(100);
    expect(systemPct({ cpu: 0, memUsed: 0, memTotal: 0 }, "mem")).toBeNull();
    expect(systemPct({ cpu: 0, memUsed: 4, memTotal: 16 }, "mem")).toBe(25);
  });

  it("고리 — system 이 없거나 묵었으면 서지 않고, 단은 사용량 고리와 같은 규칙", () => {
    expect(resourceRings([], 0)).toBeNull();
    expect(resourceRings([s(1000, null)], 1000)).toBeNull();
    const ring = [s(1000, [50, 13 * GB, 16 * GB]), s(2000, null)];
    const r = resourceRings(ring, 2000)!;
    expect(r.cpu).toEqual({ metric: "cpu", pct: 50, level: "normal" });
    expect(r.mem?.pct).toBeCloseTo(81.25);
    expect(r.mem?.level).toBe("warn");
    expect(resourceRings([s(0, [96, 1, 2])], 0)?.cpu.level).toBe("err");
    expect(resourceRings(ring, 1000 + RING_STALE_MS + 1)).toBeNull();
    // 메모리 전체를 모르면 메모리 고리만 빠진다
    expect(resourceRings([s(0, [5, 0, 0])], 0)?.mem).toBeNull();
  });

  it("Aynx 몫 = GUI + 서버 + 타일 · CPU 는 100 으로 죔", () => {
    const x = s(0, [20, 1000, 4000], { a: [8, 400], b: [3, 100] });
    expect(prismShare(x, "cpu")).toBe(14);
    expect(prismShare(x, "mem")).toBe(800);
    const over = s(0, [5, 100, 4000], { a: [90, 900] });
    expect(prismShare(over, "cpu")).toBe(93);
    expect(prismShare(s(0, null, { a: [99, 0] }), "cpu")).toBe(100);
  });

  it("많이 쓰는 셋 — 앱 자신 줄 포함 · 큰 순 · 막대는 몫 대비 · 프로세스는 그 지표 1위", () => {
    const x = s(0, [20, 0, 0], { a: [8, 50], b: [0.5, 900], c: [4, 10], d: [0, 0] });
    const top = {
      gui: [],
      server: [],
      tiles: {
        a: [
          { name: "bash.exe", cpu: 1, mem: 40 },
          { name: "node.exe", cpu: 7, mem: 10 },
        ],
        b: [{ name: "rustc.exe", cpu: 0.5, mem: 900 }],
      },
    };
    const cpu = topConsumers(x, top, "cpu");
    expect(cpu.map((r) => r.key)).toEqual(["a", "c", "@app"]);
    expect(cpu[0].proc).toBe("node.exe");
    expect(cpu[1].proc).toBeNull();
    expect(cpu[2].proc).toBeNull();
    expect(cpu[0].frac).toBeCloseTo(8 / 15.5);
    const mem = topConsumers(x, top, "mem");
    expect(mem.map((r) => r.key)).toEqual(["b", "@app", "a"]);
    expect(mem[2].proc).toBe("bash.exe");
    expect(topConsumers(s(0, null), top, "cpu", 1).map((r) => r.key)).toEqual(["@app"]);
  });

  it("스파크라인 — 시각 비례 x · 틈에서 끊김 · 끝점 · 80% 기준선 · 창 밖은 버림", () => {
    const W = 100;
    const H = 24;
    const win = 100_000;
    const ring = [
      s(0, [0, 0, 1]), // 창 밖(끝 = 200_000 → 시작 100_000)
      s(100_000, [0, 0, 1]),
      s(110_000, [100, 0, 1]),
      s(190_000, [50, 0, 1]), // 80초 틈 → 끊김
      s(200_000, [50, 0, 1]),
      s(205_000, null), // system 없는 표본은 끝이 아니다
    ];
    const sp = sparkline(ring, "cpu", { w: W, h: H, windowMs: win, gapMs: 30_000 });
    expect(sp.line).toBe("M0 22 L10 2 M90 12 L100 12");
    expect(sp.area).toBe("M0 22 L10 2 L10 24 L0 24 Z M90 12 L100 12 L100 24 L90 24 Z");
    expect(sp.last).toEqual({ x: 100, y: 12 });
    expect(sp.refY).toBe(6);
    const empty = sparkline([s(0, null)], "mem", { w: W, h: H });
    expect(empty.line).toBe("");
    expect(empty.last).toBeNull();
    // 메모리 전체를 모르는 표본은 건너뛴다
    expect(sparkline([s(0, [0, 1, 0])], "mem").line).toBe("");
  });

  it("메모리 쌍 글자", () => {
    expect(formatMemPair(9.8 * GB, 16 * GB)).toBe("9.8 / 16 GB");
    expect(formatMemPair(2 * GB, 8 * GB)).toBe("2 / 8 GB");
    expect(formatMemPair(-1, 0)).toBe("0 / 0 GB");
  });
});
