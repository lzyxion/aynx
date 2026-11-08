import { describe, expect, it } from "vitest";
import { SYSTEM_SERIES, TILES_SERIES, appUsage, aynxUsage, chartData, formatCpu, formatMem, formatMemAxis, memAxisSplits, memAxisTop, MEM_AXIS_INCRS, mergeSamples, parseSnapshot, sparkPath, tileUsage, topLine, usageTrend, type ResourceSample } from "./resources";

const s = (at: number, tiles: Record<string, [number, number]> = {}): ResourceSample => ({
  at,
  gui: { cpu: 1, mem: 100 },
  server: { cpu: 2, mem: 200 },
  tiles: Object.fromEntries(Object.entries(tiles).map(([k, [cpu, mem]]) => [k, { cpu, mem }])),
});

describe("resources", () => {
  it("parseSnapshot 은 모양을 검사하고 빠진 칸을 0 으로", () => {
    const r = parseSnapshot({
      intervalMs: 2000,
      samples: [{ at: 5, gui: { cpu: 1.5, mem: 10 }, server: {}, tiles: { a: { cpu: "x", mem: 3 } } }, { nope: 1 }],
      top: { tiles: { a: [{ name: "node.exe", cpu: 3, mem: 4 }, { cpu: 1 }] }, gui: null },
    });
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0].server).toEqual({ cpu: 0, mem: 0 });
    expect(r.samples[0].tiles.a).toEqual({ cpu: 0, mem: 3 });
    expect(r.top.tiles.a).toEqual([{ name: "node.exe", cpu: 3, mem: 4 }]);
    expect(r.top.gui).toEqual([]);
    expect(parseSnapshot(null).samples).toEqual([]);
  });

  it("mergeSamples 는 중복을 버리고 오래된 것을 걷는다", () => {
    const ring = mergeSamples([], [s(2000), s(1000)]);
    expect(ring.map((x) => x.at)).toEqual([1000, 2000]);
    const more = mergeSamples(ring, [s(2000), s(3000)]);
    expect(more.map((x) => x.at)).toEqual([1000, 2000, 3000]);
    expect(mergeSamples(more, [s(10_000)], 5000).map((x) => x.at)).toEqual([10_000]);
    // 서버가 다시 떠 시계가 앞이면 새것만
    expect(mergeSamples(more, [s(500)]).map((x) => x.at)).toEqual([500]);
    expect(mergeSamples(more, [])).toBe(more);
  });

  it("앱 = GUI + 서버, 타일 값은 가장 새 표본", () => {
    expect(appUsage(s(1))).toEqual({ cpu: 3, mem: 300 });
    const ring = [s(1, { a: [5, 50] }), s(2, { a: [7, 70] })];
    expect(tileUsage(ring, "a")).toEqual({ cpu: 7, mem: 70 });
    expect(tileUsage(ring, "b")).toBeNull();
    expect(tileUsage([], "a")).toBeNull();
  });

  it("글자", () => {
    expect(formatCpu(0)).toBe("0%");
    expect(formatCpu(3.44)).toBe("3.4%");
    expect(formatCpu(34.4)).toBe("34%");
    expect(formatCpu(140)).toBe("100%");
    expect(formatMem(820 * 1024 * 1024)).toBe("820MB");
    expect(formatMem(1.2 * 1024 * 1024 * 1024)).toBe("1.2GB");
    expect(formatMem(12 * 1024 * 1024 * 1024)).toBe("12GB");
    expect(formatMem(10)).toBe("0MB");
    expect(topLine({ name: "node.exe", cpu: 30, mem: 400 * 1024 * 1024 })).toBe("node.exe 30% · 400MB");
    expect(topLine({ name: "pwsh.exe", cpu: 0, mem: 80 * 1024 * 1024 })).toBe("pwsh.exe 80MB");
  });

  it("메모리 축 — MB 값을 MB · GB 글자로, 눈금 간격은 GB 위에서 2 거듭제곱", () => {
    expect([0, 500, 1024, 1536, 4096, 20480].map(formatMemAxis)).toEqual(["0", "500MB", "1GB", "1.5GB", "4GB", "20GB"]);
    // 위 끝(31.8GB)에도 눈금 · 반 간격보다 가까운 배수만 뺀다(2GB 간격의 30GB 는 1.8GB 떨어져 남고, 31.5GB 끝이면 빠짐)
    const top = 31.8 * 1024;
    expect(memAxisSplits(top, 4096).map(formatMemAxis)).toEqual(["0", "4GB", "8GB", "12GB", "16GB", "20GB", "24GB", "28GB", "31.8GB"]);
    expect(memAxisSplits(top, 2048).at(-2)).toBe(30 * 1024);
    expect(memAxisSplits(31.5 * 1024, 4096).at(-2)).toBe(28 * 1024);
    expect(memAxisSplits(32.5 * 1024, 4096).map(formatMemAxis).slice(-2)).toEqual(["28GB", "32.5GB"]);
    expect(memAxisSplits(16384, 4096).map(formatMemAxis)).toEqual(["0", "4GB", "8GB", "12GB", "16GB"]);
    expect(memAxisSplits(0, 4096)).toEqual([0]);
    // 위 끝 = 전체 메모리 GB 올림(OS 가 알리는 31.8GB → 꽂은 32GB)
    const GB = 1024 * 1024 * 1024;
    expect([31.8 * GB, 15.9 * GB, 7.7 * GB, 16 * GB, 0].map(memAxisTop)).toEqual([32 * 1024, 16 * 1024, 8 * 1024, 16 * 1024, 0]);
    expect(MEM_AXIS_INCRS.filter((v) => v >= 1024).every((v) => Number.isInteger(Math.log2(v / 1024)))).toBe(true);
  });

  it("chartData — 앱 · 타일 합계 두 줄(+ 이 PC 전체) · 틈은 빈 점", () => {
    const ring = [s(0, { a: [1, 0], b: [9, 0] }), s(2000, { a: [1, 0], b: [9, 0] }), s(20_000, { a: [3, 0] })];
    const d = chartData(ring, "cpu", 2000);
    expect(d.series.map((x) => x.key)).toEqual(["@app", TILES_SERIES]);
    expect(d.xs).toEqual([0, 2, 4, 20]);
    expect(d.series[0].values).toEqual([3, 3, null, 3]);
    expect(d.series[1].values).toEqual([10, 10, null, 3]);
    expect(chartData([s(0, { a: [70, 0], b: [60, 0] })], "cpu", 2000).series[1].values).toEqual([100]);
    const mem = chartData([s(0)], "mem", 2000);
    expect(mem.series[0].values[0]).toBeCloseTo(300 / (1024 * 1024));
    expect(mem.series[1].values).toEqual([0]);
    expect(aynxUsage(s(0, { a: [8, 400] }))).toEqual({ cpu: 11, mem: 700 });
  });

  it("usageTrend · sparkPath — 표 줄의 10분 추이", () => {
    const ring = [s(0, { a: [0, 5] }), s(500_000, { a: [0, 10] }), s(700_000, {}), s(800_000, { a: [0, 20] })];
    expect(usageTrend(ring, "a", "mem")).toEqual([10, null, 20]);
    expect(usageTrend(ring, "@gui", "cpu")).toEqual([1, 1, 1]);
    expect(usageTrend(ring, "@server", "mem")).toEqual([200, 200, 200]);
    expect(usageTrend([], "a", "mem")).toEqual([]);
    expect(sparkPath([0, 10], 100, 20)).toBe("M0,19L100,1");
    expect(sparkPath([10, null, 20], 100, 20)).toBe("M0,10M100,1");
    expect(sparkPath([5, null], 100, 20)).toBe("");
    expect(sparkPath([0, 0], 100, 20)).toBe("M0,19L100,19");
  });

  it("system 칸 — 있으면 풀고(사용 ≤ 전체), 없으면 빠진다 · 차트 맨 앞 @system", () => {
    const r = parseSnapshot({
      samples: [
        { at: 1, system: { cpu: 12.5, memUsed: 20, memTotal: 16 } },
        { at: 2, system: "x" },
        { at: 3 },
      ],
    });
    expect(r.samples[0].system).toEqual({ cpu: 12.5, memUsed: 16, memTotal: 16 });
    expect(r.samples[1].system).toBeUndefined();
    expect("system" in r.samples[2]).toBe(false);
    const ring = [{ ...s(0), system: { cpu: 40, memUsed: 2 * 1024 * 1024, memTotal: 8 } }, s(2000)];
    const cpu = chartData(ring, "cpu", 2000);
    expect(cpu.series.map((x) => x.key)).toEqual([SYSTEM_SERIES, "@app", TILES_SERIES]);
    expect(cpu.series[0].values).toEqual([40, null]);
    expect(chartData(ring, "mem", 2000).series[0].values).toEqual([2, null]);
    expect(chartData([s(0)], "cpu", 2000).series.map((x) => x.key)).toEqual(["@app", TILES_SERIES]);
  });
});
