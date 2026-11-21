/**
 * 세션 서버 op `resource_snapshot`(`src-tauri/src/server/resources.rs`)의 답 모양과 그 순수 계산.
 * CPU 는 기계 전체 대비 %(0~100), 메모리는 바이트(Windows 전용 작업 집합 · 그 밖 RSS — 트리의 합). 타일 열쇠는 스트림(`PaneSpec.historyStreamId`) — 서버 세션 표의 열쇠와 같다.
 */

/** 한 뿌리의 합 */
export interface ResourceUsage {
  cpu: number;
  mem: number;
}

export interface SystemUsage {
  cpu: number;
  memUsed: number;
  memTotal: number;
}

/** `at` 은 벽시계 ms */
export interface ResourceSample {
  at: number;
  gui: ResourceUsage;
  server: ResourceUsage;
  tiles: Record<string, ResourceUsage>;
  /** 옛 서버면 없다 */
  system?: SystemUsage;
}

/** 실행 파일 이름 — 명령줄은 오지 않는다 */
export interface TopProc {
  name: string;
  cpu: number;
  mem: number;
}

export interface ResourceSnapshot {
  intervalMs: number;
  keepMs: number;
  samples: ResourceSample[];
  top: { gui: TopProc[]; server: TopProc[]; tiles: Record<string, TopProc[]> };
}

/** 서버와 같은 30분 */
export const RESOURCE_KEEP_MS = 30 * 60 * 1000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function usage(v: unknown): ResourceUsage {
  const o = (v ?? {}) as Record<string, unknown>;
  return { cpu: num(o.cpu), mem: num(o.mem) };
}

function systemOf(v: unknown): SystemUsage | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const memTotal = num(o.memTotal);
  const memUsed = num(o.memUsed);
  return { cpu: Math.min(100, num(o.cpu)), memUsed: memTotal > 0 ? Math.min(memUsed, memTotal) : memUsed, memTotal };
}

function tops(v: unknown): TopProc[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string")
    .map((x) => ({ name: x.name as string, cpu: num(x.cpu), mem: num(x.mem) }));
}

export function parseSnapshot(v: unknown): ResourceSnapshot {
  const o = (v ?? {}) as Record<string, unknown>;
  const samples = Array.isArray(o.samples) ? o.samples : [];
  const top = (o.top ?? {}) as Record<string, unknown>;
  const tileTops: Record<string, TopProc[]> = {};
  for (const [k, list] of Object.entries((top.tiles ?? {}) as Record<string, unknown>)) tileTops[k] = tops(list);
  return {
    intervalMs: num(o.intervalMs) || 2000,
    keepMs: num(o.keepMs) || RESOURCE_KEEP_MS,
    samples: samples
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && typeof (s as { at?: unknown }).at === "number")
      .map((s) => {
        const tiles: Record<string, ResourceUsage> = {};
        for (const [k, u] of Object.entries((s.tiles ?? {}) as Record<string, unknown>)) tiles[k] = usage(u);
        const system = systemOf(s.system);
        return { at: s.at as number, gui: usage(s.gui), server: usage(s.server), tiles, ...(system ? { system } : {}) };
      }),
    top: { gui: tops(top.gui), server: tops(top.server), tiles: tileTops },
  };
}

/** 서버가 다시 떠 시계가 링의 끝보다 앞이면 링을 비우고 새로 받은 것만 쥔다 */
export function mergeSamples(ring: readonly ResourceSample[], incoming: readonly ResourceSample[], keepMs = RESOURCE_KEEP_MS): ResourceSample[] {
  if (incoming.length === 0) return ring as ResourceSample[];
  const last = ring.length > 0 ? ring[ring.length - 1].at : -Infinity;
  const sorted = [...incoming].sort((a, b) => a.at - b.at);
  const fresh = sorted.filter((s) => s.at > last);
  const base = fresh.length === 0 && sorted[sorted.length - 1].at < last ? [] : ring;
  const out = [...base, ...(base.length === 0 ? sorted : fresh)];
  const newest = out[out.length - 1].at;
  let i = 0;
  while (i < out.length && out[i].at < newest - keepMs) i++;
  return i > 0 ? out.slice(i) : out;
}

/** 앱 = GUI(WebView2 포함) + 세션 서버 */
export function appUsage(s: ResourceSample): ResourceUsage {
  return { cpu: Math.min(100, s.gui.cpu + s.server.cpu), mem: s.gui.mem + s.server.mem };
}

/** 상태바 카드 막대의 분모 — 화면에 숫자로는 안 낸다 */
export function aynxUsage(s: ResourceSample): ResourceUsage {
  const a = appUsage(s);
  const t = tilesUsage(s);
  return { cpu: Math.min(100, a.cpu + t.cpu), mem: a.mem + t.mem };
}

export function tileUsage(ring: readonly ResourceSample[], stream: string): ResourceUsage | null {
  const last = ring[ring.length - 1];
  return last?.tiles[stream] ?? null;
}

export function formatCpu(pct: number): string {
  const v = Math.max(0, Math.min(100, pct));
  return v < 10 ? `${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "")}%` : `${Math.round(v)}%`;
}

export function formatMem(bytes: number): string {
  const mb = num(bytes) / (1024 * 1024);
  if (mb < 1) return "0MB";
  if (mb < 1000) return `${Math.round(mb)}MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}GB`;
}

/** 값은 MB — 1GB 위는 GB 의 2 거듭제곱이라 눈금이 `4GB` · `8GB` 처럼 떨어진다 */
export const MEM_AXIS_INCRS = [1, 2, 5, 10, 25, 50, 100, 250, 500, ...Array.from({ length: 10 }, (_, i) => 1024 * 2 ** i)];

/** 값은 MB */
export function formatMemAxis(mb: number): string {
  if (mb <= 0) return "0";
  if (mb < 1024) return `${Math.round(mb)}MB`;
  const gb = Math.round((mb / 1024) * 10) / 10;
  return `${gb}GB`;
}

/** GB 올림 — 내림이면 사용량 선이 위 끝을 넘을 수 있다. 모르면(0) 0 = 값에 맞춤 */
export function memAxisTop(totalBytes: number): number {
  const gb = num(totalBytes) / (1024 * 1024 * 1024);
  return gb > 0 ? Math.ceil(gb - 1e-9) * 1024 : 0;
}

/** 위 끝과 반 간격보다 가까운 배수는 글자가 겹치니 뺀다 */
export function memAxisSplits(top: number, incr: number): number[] {
  if (!(top > 0) || !(incr > 0)) return [0];
  const out: number[] = [];
  for (let v = 0; v < top - incr / 2; v += incr) out.push(v);
  out.push(top);
  return out;
}

export interface ResourceSeries {
  key: string;
  values: (number | null)[];
}

/** `xs` 는 초 */
export interface ResourceChartData {
  xs: number[];
  series: ResourceSeries[];
}

export const SYSTEM_SERIES = "@system";

export const TILES_SERIES = "@tiles";

export function tilesUsage(s: ResourceSample): ResourceUsage {
  let cpu = 0;
  let mem = 0;
  for (const u of Object.values(s.tiles)) {
    cpu += u.cpu;
    mem += u.mem;
  }
  return { cpu: Math.min(100, cpu), mem };
}

/**
 * 선은 서로 겹치지 않는 몫 셋뿐 — "앱 + 타일" 선 · 타일마다의 선은 쓰지 않는다(엉키고 바닥에 겹친다 — 타일 추이는 `usageTrend`).
 * 메모리는 MB 로 바꿔 둔다.
 */
export function chartData(ring: readonly ResourceSample[], metric: "cpu" | "mem", intervalMs: number): ResourceChartData {
  const scale = metric === "mem" ? 1 / (1024 * 1024) : 1;
  const hasSystem = ring.some((s) => s.system !== undefined);
  const xs: number[] = [];
  const system: (number | null)[] = [];
  const app: (number | null)[] = [];
  const tiles: (number | null)[] = [];
  const gap = Math.max(1, intervalMs) * 2.5;
  let prev: number | null = null;
  for (const s of ring) {
    if (prev !== null && s.at - prev > gap) {
      xs.push((prev + Math.max(1, intervalMs)) / 1000);
      system.push(null);
      app.push(null);
      tiles.push(null);
    }
    xs.push(s.at / 1000);
    system.push(s.system ? (metric === "cpu" ? s.system.cpu : s.system.memUsed * scale) : null);
    app.push(appUsage(s)[metric] * scale);
    tiles.push(tilesUsage(s)[metric] * scale);
    prev = s.at;
  }
  return {
    xs,
    series: [
      ...(hasSystem ? [{ key: SYSTEM_SERIES, values: system }] : []),
      { key: "@app", values: app },
      { key: TILES_SERIES, values: tiles },
    ],
  };
}

export const TREND_WINDOW_MS = 10 * 60 * 1000;

/** `key` 는 타일 스트림 · `@gui` · `@server` */
export function usageTrend(
  ring: readonly ResourceSample[],
  key: string,
  metric: "cpu" | "mem",
  windowMs = TREND_WINDOW_MS,
): (number | null)[] {
  if (ring.length === 0) return [];
  const from = ring[ring.length - 1].at - windowMs;
  const out: (number | null)[] = [];
  for (const s of ring) {
    if (s.at < from) continue;
    const u = key === "@gui" ? s.gui : key === "@server" ? s.server : s.tiles[key];
    out.push(u ? u[metric] : null);
  }
  return out;
}

/** 세로는 0 부터 그 줄의 최댓값까지 — 줄끼리 크기를 견주는 그림은 아니다 */
export function sparkPath(values: readonly (number | null)[], w: number, h: number): string {
  if (values.filter((v) => v !== null).length < 2) return "";
  const max = Math.max(...values.map((v) => v ?? 0)) || 1;
  const step = w / (values.length - 1);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((h - 1 - (v / max) * (h - 2)) * 10) / 10;
    d += `${pen ? "L" : "M"}${x},${y}`;
    pen = true;
  });
  return d;
}

export function topLine(p: TopProc): string {
  return p.cpu >= 0.1 ? `${p.name} ${formatCpu(p.cpu)} · ${formatMem(p.mem)}` : `${p.name} ${formatMem(p.mem)}`;
}
