/**
 * **로컬 자원 모니터의 순수 층** (2026-10-17) — 세션 서버 op `resource_snapshot`(`src-tauri/src/server/resources.rs`)의 답 모양 ·
 * 받은 표본을 링에 잇기 · 칩 글자 · 차트 시리즈. 룬도 Tauri 도 없다(저장소 · 폴링은 `app/resources.svelte.ts`).
 *
 * - CPU 는 **기계 전체 대비 %**(0~100 — 작업 관리자와 같은 기준), 메모리는 바이트(Windows **전용 작업 집합** — 작업 관리자
 *   "메모리" 칸과 같은 기준, 10-27 · 그 밖 RSS — 트리의 합. 머리말은 `src-tauri/src/server/resources.rs`).
 * - 타일 열쇠는 스트림(`PaneSpec.historyStreamId`) — 서버 세션 표의 열쇠와 같다.
 * - **이 PC 전체**(`system` — 10-17 더함): CPU % 와 메모리 사용 · 전체 바이트. 옛 서버(같은 판 18 의 앞 빌드)는 이 칸이 없어
 *   표본의 `system` 이 빠진다(상태바 자원 고리는 그때 서지 않는다 — `resource-status.ts`).
 */

/** 한 뿌리의 합 */
export interface ResourceUsage {
  cpu: number;
  mem: number;
}

/** 이 PC 전체 — CPU 는 기계 전체 대비 %(0~100), 메모리는 바이트 */
export interface SystemUsage {
  cpu: number;
  memUsed: number;
  memTotal: number;
}

/** 표본 하나 — `at` 은 벽시계 ms */
export interface ResourceSample {
  at: number;
  gui: ResourceUsage;
  server: ResourceUsage;
  tiles: Record<string, ResourceUsage>;
  /** 이 PC 전체 — 옛 서버면 없다 */
  system?: SystemUsage;
}

/** 상위 프로세스 한 줄(실행 파일 이름 — 명령줄은 오지 않는다) */
export interface TopProc {
  name: string;
  cpu: number;
  mem: number;
}

/** op 의 답 */
export interface ResourceSnapshot {
  intervalMs: number;
  keepMs: number;
  samples: ResourceSample[];
  top: { gui: TopProc[]; server: TopProc[]; tiles: Record<string, TopProc[]> };
}

/** 프런트 링이 쥐는 시간 — 서버와 같은 30분 */
export const RESOURCE_KEEP_MS = 30 * 60 * 1000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function usage(v: unknown): ResourceUsage {
  const o = (v ?? {}) as Record<string, unknown>;
  return { cpu: num(o.cpu), mem: num(o.mem) };
}

/** `system` 칸 — 객체가 아니면 없음(옛 서버). 사용은 전체를 넘지 않게 죈다(전체가 0 이면 그대로) */
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

/** 답을 모양 검사해 풀어 낸다 — 모르는 칸은 버리고 빠진 칸은 0 */
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

/**
 * 받은 표본을 링 뒤에 잇는다 — 이미 있는 시각 이하는 버리고(같은 표본을 두 번 받지 않게) `keepMs` 보다 오래된 것은 앞에서 걷는다.
 * 서버가 다시 떠 시계가 링의 끝보다 앞이면(드묾) 링을 비우고 새로 받은 것만 쥔다.
 */
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

/** AYNX 몫 = 앱 + 로컬 타일 전부(AYNX 가 이 PC 에서 띄운 프로세스 전부) — CPU 는 100 으로 죈다. 화면에 숫자로는 안 내고 상태바 카드 막대의 분모 */
export function aynxUsage(s: ResourceSample): ResourceUsage {
  const a = appUsage(s);
  const t = tilesUsage(s);
  return { cpu: Math.min(100, a.cpu + t.cpu), mem: a.mem + t.mem };
}

/** 가장 새 표본에서 이 타일의 값 — 없으면 `null`(아직 표본 전 · 닫힌 세션) */
export function tileUsage(ring: readonly ResourceSample[], stream: string): ResourceUsage | null {
  const last = ring[ring.length - 1];
  return last?.tiles[stream] ?? null;
}

/** CPU 글자 — 10 미만은 소수 한 자리, 그 위는 정수 (`3.4%` · `34%`) */
export function formatCpu(pct: number): string {
  const v = Math.max(0, Math.min(100, pct));
  return v < 10 ? `${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "")}%` : `${Math.round(v)}%`;
}

/** 메모리 글자 — 칩용으로 짧게 (`820MB` · `1.2GB`) */
export function formatMem(bytes: number): string {
  const mb = num(bytes) / (1024 * 1024);
  if (mb < 1) return "0MB";
  if (mb < 1000) return `${Math.round(mb)}MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}GB`;
}

/**
 * 메모리 차트 y 축 눈금 간격(MB) — 1GB 아래는 십진 값, 그 위는 GB 의 2 거듭제곱이라 눈금이 `4GB` · `8GB` 처럼 떨어진다
 * (10-27 사용자 — 예전엔 MB 그대로 `20000` · `10000`)
 */
export const MEM_AXIS_INCRS = [1, 2, 5, 10, 25, 50, 100, 250, 500, ...Array.from({ length: 10 }, (_, i) => 1024 * 2 ** i)];

/** 메모리 차트 y 축 글자 — 값은 MB (`0` · `500MB` · `1GB` · `1.5GB` · `16GB`) */
export function formatMemAxis(mb: number): string {
  if (mb <= 0) return "0";
  if (mb < 1024) return `${Math.round(mb)}MB`;
  const gb = Math.round((mb / 1024) * 10) / 10;
  return `${gb}GB`;
}

/**
 * 메모리 축 위 끝(MB) — 전체 메모리(바이트)를 **GB 올림**한다. OS 가 알리는 전체는 하드웨어 예약을 빼 `31.8GB` 처럼 나오지만 사람은
 * 꽂은 양(`32GB`)으로 안다(10-27 사용자 — 보드 칸의 `formatMem` 도 10GB 위는 정수). 내림이면 사용량 선이 위 끝을 넘을 수 있어 올림.
 * 모르면(0) 0 = 값에 맞춤.
 */
export function memAxisTop(totalBytes: number): number {
  const gb = num(totalBytes) / (1024 * 1024 * 1024);
  return gb > 0 ? Math.ceil(gb - 1e-9) * 1024 : 0;
}

/**
 * 위 끝이 고정된 메모리 축의 눈금(MB) — `incr` 배수에 **위 끝 자신**을 더한다(전체 메모리가 `31.8GB` 처럼 떨어지지 않아도 위가 비어
 * 보이지 않게 — 10-27 사용자). 위 끝과 반 간격보다 가까운 배수는 글자가 겹치니 뺀다.
 */
export function memAxisSplits(top: number, incr: number): number[] {
  if (!(top > 0) || !(incr > 0)) return [0];
  const out: number[] = [];
  for (let v = 0; v < top - incr / 2; v += incr) out.push(v);
  out.push(top);
  return out;
}

/** 시리즈 하나(차트) — 이름 열쇠 · 값 줄(빈자리는 `null`) */
export interface ResourceSeries {
  key: string;
  values: (number | null)[];
}

/** 차트 재료 — x(초) · 이 PC 전체 · 앱 · 타일 합계. 표본 사이가 간격의 2.5배보다 벌면 그 자리에 빈 점을 끼워 선을 끊는다 */
export interface ResourceChartData {
  xs: number[];
  series: ResourceSeries[];
}

/** 차트에서 "이 PC 전체" 시리즈의 열쇠 — 표본에 `system` 이 하나라도 있을 때만 맨 앞에 선다 */
export const SYSTEM_SERIES = "@system";

/** 차트에서 "로컬 타일 합계" 시리즈의 열쇠 */
export const TILES_SERIES = "@tiles";

/** 한 표본의 타일 합 — CPU 는 100 을 넘지 않게 죈다 */
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
 * 링 → 차트 재료. `metric` 의 값으로 [이 PC 전체(`@system` — 있을 때만)] + 앱(`@app` — 화면 + 세션 서버) + 로컬 타일 합계(`@tiles`)
 * **세 줄뿐**이다 — 서로 겹치지 않는 몫이고 보드 맨 위 칸 셋 · 상태바 호버 카드와 같은 차례(10-27 사용자 A안 · "PC 전체 · 앱 · 타일".
 * 같은 날 "앱 전체(앱 + 타일)" 를 칸 · 선으로 더해 봤다가 걷었다 — 넷은 복잡했다. 예전엔 타일마다 선이 최대 여섯이라
 * 엉키고, 메모리 위 끝을 전체 메모리로 고정한 뒤로는 바닥에 겹쳤다. 타일마다의 추이는 보드 표의 [`usageTrend`]).
 * 메모리는 MB 로 바꿔 둔다(축 글자가 짧게). 이 PC 전체의 메모리는 사용 바이트다.
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

/** 보드 표 줄의 추이 창 — 지난 10분 */
export const TREND_WINDOW_MS = 10 * 60 * 1000;

/**
 * 보드 표 한 줄의 추이 — 가장 새 표본에서 `windowMs` 안의 값(표본 차례). `key` 는 타일 스트림 · `@gui` · `@server`.
 * 그 표본에 그 타일이 없으면(아직 안 열림 · 닫힘) `null`.
 */
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

/**
 * 추이 선의 SVG 경로 — 가로는 표본 차례로 고르게, 세로는 **0 부터 그 줄의 최댓값까지**(작게 흔들리는 줄은 평평하게, 늘어나는 줄은
 * 오르막으로 — 줄끼리 크기를 견주는 그림은 아니다). `null` 에서 선을 끊는다. 점이 둘 못 되면 빈 글자.
 */
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

/** 칩 말풍선의 상위 프로세스 줄 — `node.exe 30% · 400MB` (CPU 0 이면 메모리만) */
export function topLine(p: TopProc): string {
  return p.cpu >= 0.1 ? `${p.name} ${formatCpu(p.cpu)} · ${formatMem(p.mem)}` : `${p.name} ${formatMem(p.mem)}`;
}
