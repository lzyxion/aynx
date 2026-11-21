// 사용량 화면의 순수 층 — 숫자는 Rust `agent_usage_summary` 가 모아 준다. 요금은 어디에도 없다(구독제 — 환산하지 않는다).
import type { Tr } from "$lib/session";
import type { Tokens } from "$lib/agent-usage";
import { modelLabel } from "$lib/model-order";

/** Rust `UsageDay` */
export interface UsageDay {
  date: string;
  tokens: Tokens;
  total: number;
}

/** Rust `UsageBucket` */
export interface UsageBucket {
  date: string;
  agent: string;
  model: string;
  tokens: Tokens;
  total: number;
}

/** Rust `UsageModel` */
export interface UsageModel {
  agent: string;
  model: string;
  tokens: Tokens;
  total: number;
  conversations: number;
}

/** Rust `UsageSummary` */
export interface UsageSummary {
  today: string;
  start: string;
  firstDay: string | null;
  agents: string[];
  daily: UsageDay[];
  /** 기간과 무관한 최근 35일 — 사용 잔디는 늘 이것을 그린다 */
  recent: UsageDay[];
  /** 기간과 최근 35일 중 긴 쪽의 칸 — 잔디에서 기간 밖의 날을 골라도 풀이가 선다 */
  buckets: UsageBucket[];
  models: UsageModel[];
  streak: number;
  priorAvg: number | null;
  priorDays: number;
  elapsedMs: number;
  /** 옛 답에는 없다 */
  remote?: RemoteCoverage[];
}

/** Rust `RemoteCoverage` */
export interface RemoteCoverage {
  host: string;
  counted: number;
  /** 아직 다 세지 못한 큰 대화 파일 — 에이전트별 · 남은 바이트 */
  pendingClaude: number;
  pendingCodex: number;
  pendingBytes: number;
  readAt: number | null;
}

/** 30일보다 긴 기간은 두지 않는다 — Claude Code 는 기본으로 30일이 지난 대화 기록을 지워(`cleanupPeriodDays`) 한쪽만 찬 그림이 된다 */
export type UsagePeriod = 7 | 30;
export const PERIODS: readonly UsagePeriod[] = [7, 30];
export const DEFAULT_PERIOD: UsagePeriod = 30;

/** 저장 모양 — 모르는 값(옛 판이 저장한 90일 · 전체)은 30일로 읽는다 */
export interface UsageFilter {
  agent: string | null;
  period: UsagePeriod;
}

export function parseUsageFilter(raw: string | null): UsageFilter {
  const fallback: UsageFilter = { agent: null, period: DEFAULT_PERIOD };
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<UsageFilter>;
    const period: UsagePeriod = v.period === 7 ? 7 : DEFAULT_PERIOD;
    const agent = typeof v.agent === "string" && /^[a-z0-9-]{1,32}$/.test(v.agent) ? v.agent : null;
    return { agent, period };
  } catch {
    return fallback;
  }
}

/** `new Date(문자열)` 은 UTC 로 읽어 요일이 하루 밀린다 — 로컬 자정으로 */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function tokensAdd(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

export const ZERO_TOKENS: Tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

/** 글자만이다 — 칸 키 · 색은 원래 id 로 센다 */
export function shortModel(model: string): string {
  return modelLabel(model);
}

// ── 요약 띠 ──

export interface SummaryStrip {
  today: number;
  /** 앞 7일 평균 대비 % */
  todayDelta: number | null;
  periodTotal: number;
  dailyAvg: number;
  activeDays: number;
  recordedDays: number;
  streak: number;
  busiest: { date: string; total: number } | null;
}

/** 기록이 시작된 뒤의 날만 — 설치 전 날짜로 평균을 나누면 잘못 읽힌다 */
function recordedOf(s: UsageSummary): UsageDay[] {
  return s.firstDay === null ? [] : s.daily.filter((d) => d.date >= (s.firstDay as string));
}

export function summaryStrip(s: UsageSummary): SummaryStrip {
  const today = s.daily.find((d) => d.date === s.today)?.total ?? 0;
  const recorded = recordedOf(s);
  const periodTotal = s.daily.reduce((n, d) => n + d.total, 0);
  let busiest: SummaryStrip["busiest"] = null;
  for (const d of s.daily) if (d.total > 0 && (busiest === null || d.total > busiest.total)) busiest = { date: d.date, total: d.total };
  return {
    today,
    todayDelta: s.priorAvg !== null && s.priorAvg > 0 ? Math.round((today / s.priorAvg - 1) * 100) : null,
    periodTotal,
    dailyAvg: recorded.length > 0 ? periodTotal / recorded.length : 0,
    activeDays: s.daily.filter((d) => d.total > 0).length,
    recordedDays: recorded.length,
    streak: Math.min(s.streak, s.daily.length),
    busiest,
  };
}

// ── 사용 잔디 ──

export const HEAT_LEVELS = 4;

/** 사분위로 자른다 — 최댓값 대비 선형이면 큰 하루 하나가 나머지를 전부 바닥으로 누른다 */
export function levelScale(values: readonly number[]): (v: number) => number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const t = [at(0.25), at(0.5), at(0.75)];
  return (v: number) => {
    if (v <= 0) return 0;
    if (v < t[0]) return 1;
    if (v < t[1]) return 2;
    if (v < t[2]) return 3;
    return HEAT_LEVELS;
  };
}

/** 기간 거르개와 무관하게 늘 다섯 주 */
export const HEAT_WEEKS = 5;

export interface HeatCell {
  date: string;
  /** 그달의 며칠 */
  day: number;
  total: number;
  level: number;
  /** 기록이 시작되기 전 — "안 씀" 이 아니라 기록이 없던 날 */
  pre: boolean;
}

export interface Heatmap {
  /** 줄 = 주, 칸 = 요일(일~토) · 오늘 뒤는 `null` */
  rows: (HeatCell | null)[][];
  months: string[];
  recorded: number;
  days: number;
}

/** 요일이 줄이던 GitHub 모양은 쓰지 않는다 — 다섯 열에 일곱 줄이라 카드가 옆 카드의 두 배로 길어진다 */
export function buildHeatmap(s: UsageSummary, locale: string): Heatmap | null {
  if (s.recent.length === 0) return null;
  const todayDow = localDate(s.recent[s.recent.length - 1].date).getDay();
  const len = Math.min(s.recent.length, (HEAT_WEEKS - 1) * 7 + todayDow + 1);
  const days = s.recent.slice(-len);
  const first = s.firstDay;
  const levelOf = levelScale(days.filter((d) => first === null || d.date >= first).map((d) => d.total));
  const flat: (HeatCell | null)[] = [
    ...Array<null>(localDate(days[0].date).getDay()).fill(null),
    ...days.map((d) => {
      const pre = first === null || d.date < first;
      return { date: d.date, day: localDate(d.date).getDate(), total: d.total, level: pre ? 0 : levelOf(d.total), pre };
    }),
  ];
  while (flat.length % 7 !== 0) flat.push(null);
  const rows: (HeatCell | null)[][] = [];
  for (let i = 0; i < flat.length; i += 7) rows.push(flat.slice(i, i + 7));
  const fmt = new Intl.DateTimeFormat(locale, { month: "short" });
  const months: string[] = [];
  for (const d of days) {
    const m = fmt.format(localDate(d.date));
    if (months[months.length - 1] !== m) months.push(m);
  }
  const recorded = first === null ? 0 : days.filter((d) => d.date >= first).length;
  return { rows, months, recorded, days: days.length };
}

export function moveDate(dates: readonly string[], from: string, key: string): string {
  const i = dates.indexOf(from);
  if (i < 0) return from;
  const step = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -7 : key === "ArrowDown" ? 7 : 0;
  const j = Math.max(0, Math.min(dates.length - 1, i + step));
  return dates[j];
}

// ── 하루 풀이 ──

export interface DayDetail {
  date: string;
  total: number;
  agents: { agent: string; total: number; share: number }[];
  models: { key: string; agent: string; model: string; total: number; share: number }[];
}

export function dayDetail(s: UsageSummary, date: string): DayDetail {
  const rows = s.buckets.filter((b) => b.date === date);
  const total = rows.reduce((n, b) => n + b.total, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);
  const byAgent = new Map<string, number>();
  for (const b of rows) byAgent.set(b.agent, (byAgent.get(b.agent) ?? 0) + b.total);
  const byModel = new Map<string, { agent: string; model: string; total: number }>();
  for (const b of rows) {
    const k = `${b.agent}:${b.model}`;
    const m = byModel.get(k) ?? { agent: b.agent, model: b.model, total: 0 };
    m.total += b.total;
    byModel.set(k, m);
  }
  return {
    date,
    total,
    agents: [...byAgent].map(([agent, t]) => ({ agent, total: t, share: share(t) })).sort((a, b) => b.total - a.total),
    models: [...byModel]
      .map(([key, m]) => ({ key, ...m, share: share(m.total) }))
      .sort((a, b) => b.total - a.total),
  };
}

// ── 빛깔 ── 에이전트마다 한 빛깔, 모델은 그 밝기로

/** theme.css 의 `--agent-<id>-1..4` 와 짝이다 */
const AGENT_FAMILY: Record<string, string> = { claude: "--agent-claude", codex: "--agent-codex" };
export const COLOR_STEPS = 4;

export function modelColor(agent: string | null, rank: number): string {
  const fam = agent ? AGENT_FAMILY[agent] : undefined;
  if (!fam || rank < 0 || rank >= COLOR_STEPS) return "var(--fg-3)";
  return `var(${fam}-${rank + 1})`;
}

export function colorMap(models: readonly { agent: string; model: string }[]): Map<string, string> {
  const rank = new Map<string, number>();
  const out = new Map<string, string>();
  for (const m of models) {
    const r = rank.get(m.agent) ?? 0;
    rank.set(m.agent, r + 1);
    out.set(`${m.agent}:${m.model}`, modelColor(m.agent, r));
  }
  return out;
}

/** 세 그림이 이 표 하나를 쓴다 — 같은 모델은 7일 막대 · 하루 구성 · 모델 표에서 같은 빛깔이다 */
export function usageColors(s: UsageSummary): Map<string, string> {
  const seen = new Set(s.models.map((m) => `${m.agent}:${m.model}`));
  const extra = new Map<string, { agent: string; model: string; total: number }>();
  for (const b of s.buckets) {
    const k = `${b.agent}:${b.model}`;
    if (seen.has(k)) continue;
    const e = extra.get(k) ?? { agent: b.agent, model: b.model, total: 0 };
    e.total += b.total;
    extra.set(k, e);
  }
  return colorMap([...s.models, ...[...extra.values()].sort((a, b) => b.total - a.total)]);
}

// ── 최근 7일 · 모델별 ──

export const WEEK_TOP = 4;
export const OTHER_KEY = "__other";

export interface WeekChart {
  series: { key: string; agent: string | null; model: string; total: number; color: string }[];
  days: { date: string; weekday: number; isToday: boolean; total: number; segs: { key: string; total: number }[] }[];
  max: number;
}

export function weekChart(s: UsageSummary): WeekChart {
  const dates = s.daily.slice(-7).map((d) => d.date);
  const inWeek = s.buckets.filter((b) => dates.includes(b.date));
  const totals = new Map<string, { agent: string; model: string; total: number }>();
  for (const b of inWeek) {
    const k = `${b.agent}:${b.model}`;
    const m = totals.get(k) ?? { agent: b.agent, model: b.model, total: 0 };
    m.total += b.total;
    totals.set(k, m);
  }
  const ranked = [...totals].map(([key, m]) => ({ key, ...m })).sort((a, b) => b.total - a.total);
  const top = ranked.slice(0, WEEK_TOP);
  const colors = usageColors(s);
  const topKeys = new Set(top.map((m) => m.key));
  const rest = ranked.slice(WEEK_TOP).reduce((n, m) => n + m.total, 0);
  const series: WeekChart["series"] = top.map((m) => ({ ...m, color: colors.get(m.key) ?? modelColor(null, 0) }));
  if (rest > 0) series.push({ key: OTHER_KEY, agent: null, model: "", total: rest, color: modelColor(null, 0) });
  const days = dates.map((date) => {
    const segs = new Map<string, number>();
    let total = 0;
    for (const b of inWeek) {
      if (b.date !== date) continue;
      const k0 = `${b.agent}:${b.model}`;
      const k = topKeys.has(k0) ? k0 : OTHER_KEY;
      segs.set(k, (segs.get(k) ?? 0) + b.total);
      total += b.total;
    }
    return {
      date,
      weekday: localDate(date).getDay(),
      isToday: date === s.today,
      total,
      segs: series.filter((x) => segs.has(x.key)).map((x) => ({ key: x.key, total: segs.get(x.key) ?? 0 })),
    };
  });
  return { series, days, max: Math.max(0, ...days.map((d) => d.total)) };
}

export function barHeight(total: number, max: number, minPct = 4): number {
  if (total <= 0 || max <= 0) return 0;
  return Math.max(minPct, (total / max) * 100);
}

// ── 토큰 구성 · 모델 표 ──

export interface Composition {
  rows: { key: "cacheRead" | "cacheWrite" | "output" | "input"; total: number; share: number }[];
  total: number;
  hitRate: number | null;
  reuse: number | null;
}

export function composition(t: Tokens): Composition {
  const total = t.input + t.cacheRead + t.cacheWrite + t.output;
  const share = (v: number) => (total > 0 ? v / total : 0);
  const inbound = t.input + t.cacheWrite + t.cacheRead;
  return {
    rows: (["cacheRead", "cacheWrite", "output", "input"] as const).map((key) => ({ key, total: t[key], share: share(t[key]) })),
    total,
    hitRate: inbound > 0 ? t.cacheRead / inbound : null,
    reuse: t.cacheWrite > 0 ? t.cacheRead / t.cacheWrite : null,
  };
}

export function periodTokens(s: UsageSummary): Tokens {
  return s.daily.reduce((acc, d) => tokensAdd(acc, d.tokens), ZERO_TOKENS);
}

export interface ModelRow {
  key: string;
  agent: string;
  model: string;
  label: string;
  total: number;
  share: number;
  output: number;
  inputWrite: number;
  conversations: number;
  color: string;
}

export function modelTable(s: UsageSummary): ModelRow[] {
  const total = s.models.reduce((n, m) => n + m.total, 0);
  const colors = usageColors(s);
  return s.models.map((m) => {
    const key = `${m.agent}:${m.model}`;
    return {
      key,
      agent: m.agent,
      model: m.model,
      label: shortModel(m.model),
      total: m.total,
      share: total > 0 ? m.total / total : 0,
      output: m.tokens.output,
      inputWrite: m.tokens.input + m.tokens.cacheWrite,
      conversations: m.conversations,
      color: colors.get(key) ?? modelColor(null, 0),
    };
  });
}

export function pctText(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

export function weekdayName(weekday: number, locale: string): string {
  const base = new Date(2026, 8, 20 + weekday); // 2026-09-20 은 일요일
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(base);
}

export function monthDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(localDate(iso));
}

export function periodLabel(p: UsagePeriod, tr: Tr): string {
  return tr("board.usage.period.days", { n: p });
}
