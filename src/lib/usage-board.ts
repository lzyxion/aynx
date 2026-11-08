/**
 * **대시보드 "사용량" 칸** — 기간 요약을 화면의 덩어리들로 접는 순수 층
 * (docs/log/2026-09-26-agent-usage.md "사용량 칸").
 *
 * 숫자는 Rust `agent_usage_summary` 가 캐시에서 모아 준다(기간의 달력일 · (날짜, 에이전트, 모델) 칸 · 모델별 합 ·
 * 연속 · 앞 7일 평균). 여기는 그것을 요약 띠 · 잔디 · 하루 풀이 · 최근 7일 막대 · 토큰 구성 · 모델 표로 바꾼다.
 * 모양의 본보기는 사용자의 앞선 앱 token-chan(`src/panel/UsageCharts.tsx` — 잔디의 사분위 단계 · 기록 전 칸 ·
 * 격자 길이)이고, **요금은 어디에도 없다**(구독제 — 환산하지 않는다).
 */
import type { Tr } from "$lib/session";
import type { Tokens } from "$lib/agent-usage";

/** 하루 — Rust `UsageDay` */
export interface UsageDay {
  date: string;
  tokens: Tokens;
  total: number;
}

/** (날짜, 에이전트, 모델) 칸 — Rust `UsageBucket` */
export interface UsageBucket {
  date: string;
  agent: string;
  model: string;
  tokens: Tokens;
  total: number;
}

/** 기간의 모델 한 줄 — Rust `UsageModel` */
export interface UsageModel {
  agent: string;
  model: string;
  tokens: Tokens;
  total: number;
  conversations: number;
}

/** 기간 요약 — Rust `UsageSummary` */
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
  /** 원격 호스트가 들었으면 호스트마다 덮개 — 이 PC 만이면 빈 목록(옛 답에는 없다) */
  remote?: RemoteCoverage[];
}

/** 원격 호스트 하나의 덮개 — Rust `RemoteCoverage`(docs/log/2026-09-27-remote-conversations.md "2단계") */
export interface RemoteCoverage {
  host: string;
  /** 끝까지 센 대화 파일 수 */
  counted: number;
  /** 아직 다 세지 못한 대화 파일(머리 한 번에 다 오지 않은 큰 대화) — 에이전트별 · 남은 바이트 */
  pendingClaude: number;
  pendingCodex: number;
  pendingBytes: number;
  readAt: number | null;
}

/**
 * 기간 — **7일 · 30일** 둘뿐이다(사용자 결정). Claude Code 는 기본으로 30일이 지난 대화 기록을 지운다
 * (`cleanupPeriodDays` — 이 PC 의 가장 오래된 Claude 파일이 정확히 30일이었다). Codex 는 다 남기지만 두 에이전트를 한
 * 화면에서 견주려면 30일보다 긴 이력은 한쪽만 찬 그림이 된다. 그래서 "지난 한 달" 을 보는 칸이다.
 */
export type UsagePeriod = 7 | 30;
export const PERIODS: readonly UsagePeriod[] = [7, 30];
export const DEFAULT_PERIOD: UsagePeriod = 30;

/** 거르개 — 저장 모양. 모르는 값은 기본으로(옛 판이 저장한 90일 · 전체도 30일로 옮긴다) */
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

/** "2026-09-26" → 로컬 자정. `new Date(문자열)` 은 UTC 로 읽어 요일이 하루 밀린다 */
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

/**
 * 모델 이름을 짧게 — `claude-` 앞머리와 끝의 날짜(8자리 이상 숫자)를 뗀다. 빈 이름은 빈 글자(화면이 "모델 미상").
 */
export function shortModel(model: string): string {
  return model
    .trim()
    .replace(/^claude-/, "")
    .replace(/-\d{8,}$/, "");
}

// ---------------------------------------------------------------------------
// 요약 띠
// ---------------------------------------------------------------------------

export interface SummaryStrip {
  today: number;
  /** 앞 7일 평균 대비 % (반올림) — 비교할 날이 없거나 평균이 0 이면 `null` */
  todayDelta: number | null;
  periodTotal: number;
  /** 기록이 시작된 뒤의 날로 나눈 하루 평균 */
  dailyAvg: number;
  activeDays: number;
  /** 기간 중 기록이 시작된 뒤의 날 수 */
  recordedDays: number;
  /** 기간 안에서만 센 연속(기간 길이가 상한) */
  streak: number;
  busiest: { date: string; total: number } | null;
}

/** 기간 중 기록이 시작된 뒤의 날 — 설치 전 날짜로 평균을 나누면 "84일에 42.3M" 처럼 잘못 읽힌다 */
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

// ---------------------------------------------------------------------------
// 사용 잔디
// ---------------------------------------------------------------------------

export const HEAT_LEVELS = 4;

/**
 * 칸의 단계를 **순위**로 — 기록이 있는 날만 모아 사분위로 자른다(token-chan · GitHub 잔디와 같은 방식). 최댓값
 * 대비 선형이면 큰 하루 하나가 나머지를 전부 바닥으로 누른다. 기록이 없는 날은 0 이고 사분위 계산에서도 빠진다.
 */
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

/** 잔디가 그리는 주 — 늘 다섯 주(기간 거르개와 무관). 이번 주가 마지막 줄이다 */
export const HEAT_WEEKS = 5;

export interface HeatCell {
  date: string;
  /** 그달의 며칠 — 칸 안에 작게 */
  day: number;
  total: number;
  level: number;
  /** 기록이 시작되기 전 — "안 씀" 이 아니라 기록이 없던 날(투명 · 점선) */
  pre: boolean;
}

export interface Heatmap {
  /**
   * **달력 모양** — 줄 = 주(위가 오래된 주, 마지막 줄이 이번 주), 칸 = 요일(일~토). 이번 주의 **오늘 뒤**는 `null`
   * (칸이 아니라 빈 자리 — 누를 수 없다).
   */
  rows: (HeatCell | null)[][];
  /** 보이는 달 이름(순서대로) — 머리에 "8월 · 9월" */
  months: string[];
  recorded: number;
  days: number;
}

/**
 * 잔디 — 최근 다섯 주를 **달력처럼**(셋째 판 실기 뒤 — 요일이 줄이던 GitHub 모양은 다섯 열에 일곱 줄이라 카드가 옆 카드의
 * 두 배로 길어지고 옆은 비었다). 첫 줄은 네 주 전 일요일, 마지막 줄은 이번 주 — 칸 수는 29~35(미래 칸은 없다). 단계는
 * 보이는 날(기록이 시작된 뒤) 중 0 이 아닌 값의 사분위(token-chan 과 같은 규칙).
 */
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

/** 선택 칸을 키보드로 옮긴다 — 달력 모양이라 ←→ 하루, ↑↓ 한 주. 보이는 날 밖으로는 가지 않는다 */
export function moveDate(dates: readonly string[], from: string, key: string): string {
  const i = dates.indexOf(from);
  if (i < 0) return from;
  const step = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -7 : key === "ArrowDown" ? 7 : 0;
  const j = Math.max(0, Math.min(dates.length - 1, i + step));
  return dates[j];
}

// ---------------------------------------------------------------------------
// 하루 풀이
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 빛깔 — 에이전트마다 한 빛깔, 모델은 그 밝기로
// ---------------------------------------------------------------------------

/** 에이전트 빛깔 가족 — theme.css 의 `--agent-<id>-1..4` (순위마다 한 단계 · 두 테마에서 대비를 검산했다) */
const AGENT_FAMILY: Record<string, string> = { claude: "--agent-claude", codex: "--agent-codex" };
/** 한 에이전트 안에서 따로 빛깔을 받는 모델 수 — 그 밖은 "기타" 회색 */
export const COLOR_STEPS = 4;

/**
 * 그 에이전트 안에서 `rank` 번째(0부터, 토큰 순) 모델의 빛깔 — **빛깔 매핑은 이 함수 하나**다(7일 막대 · 하루 구성 막대 ·
 * 모델 표가 모두 이 순위 규칙을 쓴다). 모르는 에이전트 · 네 번째 뒤 · 기타는 회색.
 */
export function modelColor(agent: string | null, rank: number): string {
  const fam = agent ? AGENT_FAMILY[agent] : undefined;
  if (!fam || rank < 0 || rank >= COLOR_STEPS) return "var(--fg-3)";
  return `var(${fam}-${rank + 1})`;
}

/** 모델 목록(토큰 순) → 열쇠별 빛깔 — 같은 에이전트 안의 순위로 밝기를 가른다 */
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

/**
 * 요약 한 벌의 빛깔 표 — 기간의 모델 순(토큰 순)으로 순위를 매기고, 기간 밖 날(잔디에서 고른 날)에만 나오는 모델은
 * 그 뒤에 칸 합 순으로. **세 그림이 이 표 하나를 쓴다** — 같은 모델은 7일 막대 · 하루 구성 · 모델 표에서 같은 빛깔이다.
 */
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

// ---------------------------------------------------------------------------
// 최근 7일 · 모델별
// ---------------------------------------------------------------------------

/** 막대에 따로 세우는 모델 수 — 나머지는 "기타" */
export const WEEK_TOP = 4;
export const OTHER_KEY = "__other";

export interface WeekChart {
  /** 조각의 차례 — 위 네 모델 + (있으면) 기타 */
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

/** 막대 높이(%) — 아주 작은 날도 보이게 바닥을 둔다(0 인 날은 0) */
export function barHeight(total: number, max: number, minPct = 4): number {
  if (total <= 0 || max <= 0) return 0;
  return Math.max(minPct, (total / max) * 100);
}

// ---------------------------------------------------------------------------
// 토큰 구성 · 모델 표
// ---------------------------------------------------------------------------

export interface Composition {
  rows: { key: "cacheRead" | "cacheWrite" | "output" | "input"; total: number; share: number }[];
  total: number;
  /** 캐시 히트율 = 캐시 읽기 / (입력 + 캐시 쓰기 + 캐시 읽기) — 들어간 입력이 없으면 `null` */
  hitRate: number | null;
  /** 캐시 재사용 = 캐시 읽기 / 캐시 쓰기 — 캐시 쓰기가 없으면 `null`("캐시 적재 미기록") */
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

/** 기간 전체 네 칸 */
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

/** 비율 → "42%"(1% 미만은 "<1%", 0 은 "0%") */
export function pctText(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** 요일 이름(짧게) — 로캘 */
export function weekdayName(weekday: number, locale: string): string {
  const base = new Date(2026, 8, 20 + weekday); // 2026-09-20 은 일요일
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(base);
}

/** "9월 24일" — 로캘 */
export function monthDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(localDate(iso));
}

/** 기간 라벨 */
export function periodLabel(p: UsagePeriod, tr: Tr): string {
  return tr("board.usage.period.days", { n: p });
}
