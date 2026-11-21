/** 에이전트 사용량(토큰 · 요금제 한도 %)을 글자로 바꾸는 순수 층 — 요금 환산은 하지 않는다 · 값이 없으면 숫자를 지어내지 않는다 */
import type { Tr } from "$lib/session";

/** Rust `Tokens` — `input` 은 캐시에 걸리지 않은 입력 */
export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Rust `ConversationUsage` */
export interface ConversationUsage {
  agent: string;
  id: string;
  tokens: Tokens;
  total: number;
  /** 로컬 날짜 */
  today: number;
  week: number;
  subagents: boolean;
  /** 부모 몫을 뺀 수라 "+21k" 로 적는다 */
  forked: boolean;
}

/** Rust `UsageScan` */
export interface UsageScan {
  conversations: ConversationUsage[];
  files: number;
  elapsedMs: number;
}

/** Rust `LimitWindow` */
export interface LimitWindow {
  windowMinutes: number | null;
  kind: string | null;
  usedPercent: number;
  /** epoch 초 */
  resetsAt: number | null;
}

/** Rust `AgentLimits` */
export interface AgentLimits {
  agent: string;
  windows: LimitWindow[];
  measuredAt: number | null;
  /** 값이 없어도 상태바에 빈 고리를 세울지 */
  seen?: boolean;
}

/** 강조색은 사용량에 쓰지 않는다 */
export const WARN_PCT = 80;
export const ERR_PCT = 95;
export const STALE_MS = 3 * 3600_000;

export type LimitLevel = "normal" | "warn" | "err";

export function usageKey(agent: string, id: string): string {
  return `${agent}:${id.toLowerCase()}`;
}

export function usageMap(scan: UsageScan | null): Map<string, ConversationUsage> {
  const m = new Map<string, ConversationUsage>();
  for (const c of scan?.conversations ?? []) m.set(usageKey(c.agent, c.id), c);
  return m;
}

function trimZero(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [base, unit] of units) {
    if (n < base) continue;
    const v = n / base;
    const digits = v >= 100 ? 0 : v >= 10 ? (unit === "k" ? 0 : 1) : unit === "k" ? 1 : 2;
    return `${trimZero(v.toFixed(digits))}${unit}`;
  }
  return String(n);
}

/** 라벨은 데이터의 분에서 짓는다 — "5시간" 을 박아 두지 않는다 */
export function windowLabel(minutes: number | null, tr: Tr): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return tr("board.usage.window.unknown");
  if (minutes % 1440 === 0) return tr("board.usage.window.days", { n: minutes / 1440 });
  if (minutes % 60 === 0) return tr("board.usage.window.hours", { n: minutes / 60 });
  return tr("board.usage.window.minutes", { n: minutes });
}

export function limitLevel(pct: number): LimitLevel {
  if (pct >= ERR_PCT) return "err";
  if (pct >= WARN_PCT) return "warn";
  return "normal";
}

/** 게이트웨이 지출 한도는 100 을 넘을 수 있다 */
export function barWidth(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

export function resetPassed(w: LimitWindow, now: number): boolean {
  return w.resetsAt !== null && w.resetsAt * 1000 <= now;
}

/** 창이 흐른 몫(0~1) — 막대 위 눈금. 사용 % 가 이보다 앞서면 창이 끝나기 전에 한도에 닿는다 */
export function windowElapsed(w: LimitWindow, now: number): number | null {
  if (w.windowMinutes === null || !Number.isFinite(w.windowMinutes) || w.windowMinutes <= 0) return null;
  if (w.resetsAt === null) return null;
  const left = w.resetsAt * 1000 - now;
  if (left <= 0) return null;
  return Math.max(0, Math.min(1, 1 - left / (w.windowMinutes * 60_000)));
}

export function isStale(measuredAt: number | null, now: number): boolean {
  return measuredAt === null || now - measuredAt >= STALE_MS;
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function measuredText(measuredAt: number, now: number, tr: Tr): string {
  const min = Math.floor((now - measuredAt) / 60_000);
  if (min < 1) return tr("board.usage.measured.now");
  if (min < 60) return tr("board.usage.measured.minutes", { n: min });
  const days = Math.round((dayStart(now) - dayStart(measuredAt)) / 86_400_000);
  if (days <= 0) return tr("board.usage.measured.hours", { n: Math.floor(min / 60) });
  if (days === 1) return tr("board.usage.measured.yesterday");
  return tr("board.usage.measured.days", { n: days });
}

export function durationText(ms: number, tr: Tr): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? tr("board.usage.dur.dh", { d, h }) : tr("board.usage.dur.d", { d });
  if (h > 0) return m > 0 ? tr("board.usage.dur.hm", { h, m }) : tr("board.usage.dur.h", { h });
  return tr("board.usage.dur.m", { m });
}

export function resetText(w: LimitWindow, now: number, tr: Tr, locale: string): string {
  if (w.resetsAt === null) return "";
  const at = w.resetsAt * 1000;
  if (at <= now) return tr("board.usage.reset.stale");
  if (at - now < 24 * 3600_000) return tr("board.usage.reset.in", { d: durationText(at - now, tr) });
  const date = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short" }).format(new Date(at));
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
  return tr("board.usage.reset.at", { date, time });
}

export interface LimitRow {
  key: string;
  label: string;
  pct: number;
  pctText: string;
  level: LimitLevel;
  dim: boolean;
  reset: string;
  resetStale: boolean;
  elapsed: number | null;
}

export interface LimitCard {
  agent: string;
  empty: boolean;
  measured: string;
  stale: boolean;
  rows: LimitRow[];
}

export function limitCard(l: AgentLimits, now: number, tr: Tr, locale: string): LimitCard {
  const stale = isStale(l.measuredAt, now);
  if (l.windows.length === 0 || l.measuredAt === null) {
    return { agent: l.agent, empty: true, measured: "", stale: false, rows: [] };
  }
  const windows = [...l.windows].sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
  return {
    agent: l.agent,
    empty: false,
    measured: measuredText(l.measuredAt, now, tr),
    stale,
    rows: windows.map((w, i) => ({
      key: `${w.kind ?? ""}:${w.windowMinutes ?? i}`,
      label: windowLabel(w.windowMinutes, tr),
      pct: w.usedPercent,
      pctText: `${Math.round(w.usedPercent)}%`,
      level: limitLevel(w.usedPercent),
      dim: stale || resetPassed(w, now),
      reset: resetText(w, now, tr, locale),
      resetStale: resetPassed(w, now),
      elapsed: windowElapsed(w, now),
    })),
  };
}

export interface UsageRing {
  agent: string;
  /** 값이 없으면 `null`(빈 고리 + "–") */
  pct: number | null;
  level: LimitLevel;
  stale: boolean;
  /** 접근성 이름 */
  tip: string;
  name: string;
  card: LimitCard;
}

export function usageRings(
  limits: readonly AgentLimits[],
  now: number,
  tr: Tr,
  locale: string,
  displayName: (agent: string) => string,
): UsageRing[] {
  const out: UsageRing[] = [];
  for (const l of limits) {
    const name = displayName(l.agent);
    const card = limitCard(l, now, tr, locale);
    if (card.empty) {
      if (!l.seen) continue;
      out.push({ agent: l.agent, pct: null, level: "normal", stale: false, tip: tr("app.statusbar.usage.none", { agent: name }), name, card });
      continue;
    }
    const shown = ringWindow(l.windows);
    const parts = card.rows.map((r) =>
      tr("app.statusbar.usage.window", { label: r.label, pct: r.pctText, reset: r.reset === "" ? "—" : r.reset }),
    );
    out.push({
      agent: l.agent,
      pct: shown.usedPercent,
      level: limitLevel(shown.usedPercent),
      stale: card.stale || resetPassed(shown, now),
      tip: tr("app.statusbar.usage", { windows: parts.join(" · "), agent: name, measured: card.measured }),
      name,
      card,
    });
  }
  return out;
}

/** 가장 긴 창 하나로 고정한다 — 가장 찬 창을 고르면 고리가 소리 없이 다른 창으로 바뀌어 숫자가 헷갈린다 */
export function ringWindow(windows: readonly LimitWindow[]): LimitWindow {
  return windows.reduce((a, b) => ((b.windowMinutes ?? -1) > (a.windowMinutes ?? -1) ? b : a));
}

export interface UsagePaletteEntry {
  key: string;
  agent: string;
  label: string;
  level: LimitLevel;
}

export function usagePaletteEntries(
  limits: readonly AgentLimits[],
  now: number,
  tr: Tr,
  displayName: (agent: string) => string,
): UsagePaletteEntry[] {
  const out: UsagePaletteEntry[] = [];
  for (const l of limits) {
    if (l.measuredAt === null) continue;
    const live = [...l.windows]
      .filter((w) => !resetPassed(w, now))
      .sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
    if (live.length === 0) continue;
    const parts = live.map((w) => `${windowLabel(w.windowMinutes, tr)} ${Math.round(w.usedPercent)}%`);
    const ago = measuredText(l.measuredAt, now, tr);
    const top = Math.max(...live.map((w) => w.usedPercent));
    out.push({
      key: `u:${l.agent}`,
      agent: l.agent,
      label: tr("commands.palette.usage.row", { agent: displayName(l.agent), detail: [...parts, ago].join(" · ") }),
      level: limitLevel(top),
    });
  }
  return out;
}
