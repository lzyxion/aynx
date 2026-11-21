/**
 * 고리 숫자는 이 PC 전체다(표본의 `system` — 작업 관리자와 같은 숫자, 사용자 결정).
 * 스파크라인은 순번이 아니라 `at` 시각으로 놓는다 — 표본 간격이 2초 · 10초로 섞인다.
 */
import { limitLevel, type LimitLevel } from "$lib/agent-usage";
import { aynxUsage, type ResourceSample, type ResourceSnapshot, type SystemUsage } from "$lib/resources";

export type ResourceMetric = "cpu" | "mem";

export interface ResourceRingValue {
  metric: ResourceMetric;
  /** 0~100 */
  pct: number;
  level: LimitLevel;
}

/** 가장 새 표본이 이만큼 묵었으면 고리를 세우지 않는다 — 서버가 쉬는 중(세션 0)인 값을 지금처럼 보이지 않게 */
export const RING_STALE_MS = 30_000;

export const SPARK_WINDOW_MS = 5 * 60 * 1000;

function clampPct(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

export function systemPct(s: SystemUsage, metric: ResourceMetric): number | null {
  if (metric === "cpu") return clampPct(s.cpu);
  return s.memTotal > 0 ? clampPct((s.memUsed / s.memTotal) * 100) : null;
}

export function lastSystemSample(ring: readonly ResourceSample[]): (ResourceSample & { system: SystemUsage }) | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    const s = ring[i];
    if (s.system) return s as ResourceSample & { system: SystemUsage };
  }
  return null;
}

/** `now` 는 마지막 당김 시각(벽시계 ms — 같은 PC 라 서버 시계와 같다) */
export function resourceRings(
  ring: readonly ResourceSample[],
  now: number,
): { cpu: ResourceRingValue; mem: ResourceRingValue | null } | null {
  const last = lastSystemSample(ring);
  if (!last || now - last.at > RING_STALE_MS) return null;
  const cpu = systemPct(last.system, "cpu") ?? 0;
  const mem = systemPct(last.system, "mem");
  return {
    cpu: { metric: "cpu", pct: cpu, level: limitLevel(cpu) },
    mem: mem === null ? null : { metric: "mem", pct: mem, level: limitLevel(mem) },
  };
}

/** CPU 는 %(100 으로 죔), 메모리는 바이트 */
export function prismShare(s: ResourceSample, metric: ResourceMetric): number {
  return aynxUsage(s)[metric];
}

export interface ResourceTopRow {
  /** 타일 스트림 · 앱 자신은 `"@app"` */
  key: string;
  value: number;
  proc: string | null;
  /** Aynx 몫 대비(0~1) */
  frac: number;
}

export function topConsumers(
  s: ResourceSample,
  top: ResourceSnapshot["top"],
  metric: ResourceMetric,
  n = 3,
): ResourceTopRow[] {
  const total = prismShare(s, metric);
  const rows: { key: string; value: number }[] = [{ key: "@app", value: s.gui[metric] + s.server[metric] }];
  for (const [key, u] of Object.entries(s.tiles)) rows.push({ key, value: u[metric] });
  return rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, n)
    .map((r) => {
      const procs = r.key === "@app" ? [] : (top.tiles[r.key] ?? []);
      const best = [...procs].sort((a, b) => b[metric] - a[metric])[0];
      return {
        key: r.key,
        value: r.value,
        proc: best ? best.name : null,
        frac: total > 0 ? Math.max(0, Math.min(1, r.value / total)) : 0,
      };
    });
}

export interface Sparkline {
  line: string;
  area: string;
  last: { x: number; y: number } | null;
  refY: number;
}

export function sparkline(
  ring: readonly ResourceSample[],
  metric: ResourceMetric,
  opts: { w?: number; h?: number; windowMs?: number; gapMs?: number } = {},
): Sparkline {
  const w = opts.w ?? 240;
  const h = opts.h ?? 38;
  const windowMs = opts.windowMs ?? SPARK_WINDOW_MS;
  const gapMs = opts.gapMs ?? 30_000;
  const yOf = (pct: number) => round(h - 2 - (clampPct(pct) / 100) * (h - 4));
  const refY = yOf(80);
  const last = lastSystemSample(ring);
  if (!last) return { line: "", area: "", last: null, refY };
  const end = last.at;
  const start = end - windowMs;
  const segs: { x: number; y: number }[][] = [];
  let prevAt: number | null = null;
  for (const s of ring) {
    if (!s.system || s.at < start || s.at > end) continue;
    const pct = systemPct(s.system, metric);
    if (pct === null) continue;
    const pt = { x: round(((s.at - start) / windowMs) * w), y: yOf(pct) };
    if (prevAt === null || s.at - prevAt > gapMs) segs.push([pt]);
    else segs[segs.length - 1].push(pt);
    prevAt = s.at;
  }
  const line = segs.map((seg) => seg.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")).join(" ");
  const area = segs
    .map((seg) => `${seg.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")} L${seg[seg.length - 1].x} ${h} L${seg[0].x} ${h} Z`)
    .join(" ");
  const tail = segs.length > 0 ? segs[segs.length - 1] : [];
  return { line, area, last: tail.length > 0 ? tail[tail.length - 1] : null, refY };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

/** `9.8 / 16 GB` (GiB · 10 미만은 소수 한 자리) */
export function formatMemPair(used: number, total: number): string {
  const gb = (b: number) => {
    const v = Math.max(0, b) / 1024 ** 3;
    return v < 10 ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : `${Math.round(v)}`;
  };
  return `${gb(used)} / ${gb(total)} GB`;
}
