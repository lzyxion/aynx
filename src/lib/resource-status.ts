/**
 * **상태바 자원 고리 · 호버 카드의 순수 계산** (2026-10-17 — 로컬 자원 모니터 둘째 조각). 룬도 Tauri 도 없다.
 *
 * - 고리 숫자 = **이 PC 전체**(표본의 `system` — 작업 관리자와 같은 숫자, 사용자 결정 A). CPU 는 `system.cpu`, 메모리는
 *   `memUsed / memTotal`. 색 단은 사용량 고리와 같은 규칙(`limitLevel` — 회색 · 80% 경고 · 95% 오류).
 * - **AYNX 몫** = GUI + 세션 서버 + 로컬 타일 트리의 합(CPU 는 100 으로 죈다). 화면에 숫자로는 안 내고 "많이 쓰는 셋" 막대의
 *   분모다(10-27 — 그 밖 · 몫 칸을 걷고 앱 · 타일 두 칸).
 * - **많이 쓰는 셋** = 타일마다 + 앱 자신(GUI + 서버) 한 줄을 한 줄 세워 큰 순. 막대 = AYNX 몫 대비 비율.
 * - **스파크라인** = 최근 5분을 `at` 시간축에 그린 SVG 경로(표본 간격이 2초 · 10초로 섞이므로 순번이 아니라 시각으로 놓는다).
 *   표본 사이가 `gapMs` 보다 벌면 선을 끊는다.
 *
 * 그리는 곳: `StatusBar.svelte`(고리) · `ResourceHoverCard.svelte`(카드).
 */
import { limitLevel, type LimitLevel } from "$lib/agent-usage";
import { aynxUsage, type ResourceSample, type ResourceSnapshot, type SystemUsage } from "$lib/resources";

export type ResourceMetric = "cpu" | "mem";

/** 고리 하나의 값 */
export interface ResourceRingValue {
  metric: ResourceMetric;
  /** 0~100 */
  pct: number;
  level: LimitLevel;
}

/** 가장 새 표본이 이만큼 묵었으면(마지막 당김 기준) 고리를 세우지 않는다 — 서버가 쉬는 중(세션 0)인 값을 지금처럼 보이지 않게 */
export const RING_STALE_MS = 30_000;

/** 호버 카드 스파크라인의 창 */
export const SPARK_WINDOW_MS = 5 * 60 * 1000;

function clampPct(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

/** 이 PC 전체의 % — 메모리 전체가 0 이면 `null`(모름) */
export function systemPct(s: SystemUsage, metric: ResourceMetric): number | null {
  if (metric === "cpu") return clampPct(s.cpu);
  return s.memTotal > 0 ? clampPct((s.memUsed / s.memTotal) * 100) : null;
}

/** `system` 이 있는 가장 새 표본 — 없으면 `null` */
export function lastSystemSample(ring: readonly ResourceSample[]): (ResourceSample & { system: SystemUsage }) | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    const s = ring[i];
    if (s.system) return s as ResourceSample & { system: SystemUsage };
  }
  return null;
}

/**
 * 고리 둘의 값 — 설 수 없으면 `null`. `now` 는 마지막 당김 시각(벽시계 ms — 같은 PC 라 서버 시계와 같다). 가장 새 `system` 표본이
 * [`RING_STALE_MS`] 보다 묵었거나 없으면 서지 않는다. 메모리 전체를 모르면 메모리 고리만 빠진다.
 */
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

/** 이 표본의 앱 전체(앱 + 로컬 타일) — CPU 는 %(100 으로 죔), 메모리는 바이트 */
export function prismShare(s: ResourceSample, metric: ResourceMetric): number {
  return aynxUsage(s)[metric];
}

/** 많이 쓰는 줄 하나 */
export interface ResourceTopRow {
  /** 타일 스트림 · 앱 자신은 `"@app"` */
  key: string;
  value: number;
  /** 그 뿌리에서 이 지표를 가장 많이 쓰는 프로세스 이름 — 모르면 `null`(앱 자신은 늘 `null`) */
  proc: string | null;
  /** 막대 — AYNX 몫 대비(0~1) */
  frac: number;
}

/**
 * 많이 쓰는 셋 — 타일마다 + 앱 자신(GUI + 서버) 한 줄 중 값이 큰 순 `n` 개(0 인 줄은 빼고, 같으면 열쇠 순). 막대는 몫 대비.
 */
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

/** 스파크라인 — SVG 경로(뷰박스 `w × h`) */
export interface Sparkline {
  /** 선 — 끊긴 자리마다 새 `M` */
  line: string;
  /** 채움 — 이어진 토막마다 바닥까지 닫은 경로 */
  area: string;
  /** 끝점(강조) — 점이 없으면 `null` */
  last: { x: number; y: number } | null;
  /** 80% 기준선의 y */
  refY: number;
}

/**
 * 최근 `windowMs`(끝 = 가장 새 표본의 시각) 안의 `system` 표본으로 스파크라인을 짓는다. x 는 시각 비례, y 는 0~100% 를 위아래 2px
 * 여백 안에. 앞뒤 표본 사이가 `gapMs` 보다 벌면 선을 끊는다(서버가 쉬던 틈).
 */
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

/** 카드 머리의 메모리 글자 — `9.8 / 16 GB` (GiB · 10 미만은 소수 한 자리) */
export function formatMemPair(used: number, total: number): string {
  const gb = (b: number) => {
    const v = Math.max(0, b) / 1024 ** 3;
    return v < 10 ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : `${Math.round(v)}`;
  };
  return `${gb(used)} / ${gb(total)} GB`;
}
