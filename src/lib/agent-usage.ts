/**
 * **에이전트 사용량** — 대화의 토큰과 요금제 한도 % 의 순수 층 (docs/log/2026-09-26-agent-usage.md).
 *
 * 숫자를 읽는 일은 Rust 가 한다(`agent_usage_scan` — 대화마다 토큰 · `agent_usage_limits` — 에이전트마다
 * 한도 %). 여기는 그 숫자를 **글자로** 바꾼다: 토큰 줄임(612k · 1.24M) · 창 길이 라벨(데이터의 분에서 —
 * "5시간" 을 박아 두지 않는다) · 경고 단(80% 경고색 · 95% 오류색) · 잰 시각("12분 전 기준") · 초기화 글자 ·
 * 상태바 고리 · 팔레트 줄. **요금 환산은 하지 않는다** — 어디에도 $ 가 없다.
 *
 * 값이 없으면 숫자를 지어내지 않는다 — 화면은 안내 한 줄을 세운다.
 */
import type { Tr } from "$lib/session";

/** 토큰 네 칸 — Rust `Tokens`. `input` 은 캐시에 걸리지 않은 입력 */
export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** 대화 하나의 사용량 — Rust `ConversationUsage` */
export interface ConversationUsage {
  agent: string;
  id: string;
  tokens: Tokens;
  total: number;
  /** 오늘(로컬 날짜) 합 */
  today: number;
  /** 오늘 포함 7일 합 */
  week: number;
  /** 서브에이전트 파일을 합쳤다(Claude) */
  subagents: boolean;
  /** 포크로 시작한 대화 — 부모 몫을 뺀 수라 "+21k" 로 적는다 */
  forked: boolean;
}

/** 사용량 한 벌 — Rust `UsageScan` */
export interface UsageScan {
  conversations: ConversationUsage[];
  files: number;
  elapsedMs: number;
}

/** 한도 한 칸 — Rust `LimitWindow` */
export interface LimitWindow {
  /** 창 길이(분) — 라벨의 근거. 모르면 `null` */
  windowMinutes: number | null;
  kind: string | null;
  /** 0~100 */
  usedPercent: number;
  /** 초기화 시각(epoch **초**) */
  resetsAt: number | null;
}

/** 에이전트 하나의 한도 — Rust `AgentLimits` */
export interface AgentLimits {
  agent: string;
  /** 비었으면 아직 값이 없다 */
  windows: LimitWindow[];
  /** 잰 시각(epoch ms) */
  measuredAt: number | null;
  /** 이 PC 에서 그 에이전트를 본 적이 있나 — 값이 없어도 상태바에 빈 고리를 세울지 */
  seen?: boolean;
}

/** 경고 단 — 이 % 부터 경고색, 다음부터 오류색. 강조색은 사용량에 쓰지 않는다 */
export const WARN_PCT = 80;
export const ERR_PCT = 95;
/** 이만큼 묵은 값은 "낡았다" — 잰 시각 글자가 경고색이 되고 막대가 흐려진다 */
export const STALE_MS = 3 * 3600_000;

export type LimitLevel = "normal" | "warn" | "err";

/** 대화의 열쇠 — 목록 줄과 사용량을 잇는다 */
export function usageKey(agent: string, id: string): string {
  return `${agent}:${id.toLowerCase()}`;
}

/** 답 → 열쇠별 표 */
export function usageMap(scan: UsageScan | null): Map<string, ConversationUsage> {
  const m = new Map<string, ConversationUsage>();
  for (const c of scan?.conversations ?? []) m.set(usageKey(c.agent, c.id), c);
  return m;
}

function trimZero(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * 토큰 수 → 짧은 글자. 1,000 미만은 그대로, 그 위로는 `k` · `M` · `B` — 자릿수가 적을 때만 소수를 둔다
 * (`1.2k` · `612k` · `1.24M` · `89.3M` · `7.93B`). 끝의 0 은 뗀다(`2k` · `1.5M`).
 */
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
    // k 는 한 자리 소수(1.2k)까지만 — 토큰 수에서 두 자리는 소음이다. M·B 는 1.24M 처럼 두 자리.
    const digits = v >= 100 ? 0 : v >= 10 ? (unit === "k" ? 0 : 1) : unit === "k" ? 1 : 2;
    return `${trimZero(v.toFixed(digits))}${unit}`;
  }
  return String(n);
}

/** 창 길이(분) → 라벨. 데이터가 정한다 — 300 → "5시간", 10080 → "7일", 43200 → "30일" */
export function windowLabel(minutes: number | null, tr: Tr): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return tr("board.usage.window.unknown");
  if (minutes % 1440 === 0) return tr("board.usage.window.days", { n: minutes / 1440 });
  if (minutes % 60 === 0) return tr("board.usage.window.hours", { n: minutes / 60 });
  return tr("board.usage.window.minutes", { n: minutes });
}

/** 사용률 → 단 */
export function limitLevel(pct: number): LimitLevel {
  if (pct >= ERR_PCT) return "err";
  if (pct >= WARN_PCT) return "warn";
  return "normal";
}

/** 막대 폭(%) — 0~100 로 죈다(게이트웨이 지출 한도는 100 을 넘을 수 있다) */
export function barWidth(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** 초기화 시각이 지났다 — 그 값은 이미 초기화된 창의 것이다 */
export function resetPassed(w: LimitWindow, now: number): boolean {
  return w.resetsAt !== null && w.resetsAt * 1000 <= now;
}

/**
 * 창이 **흐른 몫**(0~1) — 1 − (초기화까지 남은 시간 / 창 길이). 상태바 카드의 막대 위 눈금 자리다: 사용 % 가
 * 이 눈금보다 앞서 있으면 창이 끝나기 전에 한도에 닿는 속도다 — 기록(시계열) 없이 지금 값 둘로 보이는 "속도".
 * 창 길이나 초기화 시각을 모르거나 초기화가 이미 지났으면 `null`(눈금을 그리지 않는다). 0~1 로 죈다.
 */
export function windowElapsed(w: LimitWindow, now: number): number | null {
  if (w.windowMinutes === null || !Number.isFinite(w.windowMinutes) || w.windowMinutes <= 0) return null;
  if (w.resetsAt === null) return null;
  const left = w.resetsAt * 1000 - now;
  if (left <= 0) return null;
  return Math.max(0, Math.min(1, 1 - left / (w.windowMinutes * 60_000)));
}

/** 값이 묵었다(또는 없다) */
export function isStale(measuredAt: number | null, now: number): boolean {
  return measuredAt === null || now - measuredAt >= STALE_MS;
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 잰 시각 → "방금 기준" · "12분 전 기준" · "3시간 전 기준" · "어제 기준" · "4일 전 기준" */
export function measuredText(measuredAt: number, now: number, tr: Tr): string {
  const min = Math.floor((now - measuredAt) / 60_000);
  if (min < 1) return tr("board.usage.measured.now");
  if (min < 60) return tr("board.usage.measured.minutes", { n: min });
  const days = Math.round((dayStart(now) - dayStart(measuredAt)) / 86_400_000);
  if (days <= 0) return tr("board.usage.measured.hours", { n: Math.floor(min / 60) });
  if (days === 1) return tr("board.usage.measured.yesterday");
  return tr("board.usage.measured.days", { n: days });
}

/** 남은 시간 → "2시간 10분" · "45분" · "3일 4시간" */
export function durationText(ms: number, tr: Tr): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? tr("board.usage.dur.dh", { d, h }) : tr("board.usage.dur.d", { d });
  if (h > 0) return m > 0 ? tr("board.usage.dur.hm", { h, m }) : tr("board.usage.dur.h", { h });
  return tr("board.usage.dur.m", { m });
}

/**
 * 초기화 글자 — 지났으면 "낡음"(그 % 는 지난 창의 것이다 — token-chan 과 같은 말 · 화면은 경고색 기울임), 하루 안이면 "2시간 10분 뒤 초기화", 그보다 멀면 날짜와 시각
 * ("10월 2일(금) 09:00"). 모르면 빈 글자.
 */
export function resetText(w: LimitWindow, now: number, tr: Tr, locale: string): string {
  if (w.resetsAt === null) return "";
  const at = w.resetsAt * 1000;
  if (at <= now) return tr("board.usage.reset.stale");
  if (at - now < 24 * 3600_000) return tr("board.usage.reset.in", { d: durationText(at - now, tr) });
  const date = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short" }).format(new Date(at));
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
  return tr("board.usage.reset.at", { date, time });
}

/** 카드의 한 줄 — 그리기에 필요한 것만 접어 둔다 */
export interface LimitRow {
  key: string;
  label: string;
  pct: number;
  /** 화면 글자(정수 %) */
  pctText: string;
  level: LimitLevel;
  /** 흐리게 — 초기화가 지났거나 값이 묵었다 */
  dim: boolean;
  reset: string;
  /** 초기화 시각이 지났다 — 초기화 글자를 "낡음" 모양(경고색 기울임)으로 */
  resetStale: boolean;
  /** 창이 흐른 몫(0~1) — 막대 위 눈금. 모르면 `null` (`windowElapsed`) */
  elapsed: number | null;
}

/** 카드 한 장 */
export interface LimitCard {
  agent: string;
  /** 값이 없다 — 안내 한 줄 */
  empty: boolean;
  measured: string;
  stale: boolean;
  rows: LimitRow[];
}

/** 한도 → 카드. 창은 짧은 것부터(5시간 → 7일) */
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

/** 상태바의 고리 하나 — 에이전트마다 */
export interface UsageRing {
  agent: string;
  /** 고리가 채우는 % — **가장 긴 창(7일)** 하나(`ringWindow`). 값이 없으면 `null`(빈 고리 + "–") */
  pct: number | null;
  level: LimitLevel;
  /** 흐리게 — 값이 묵었거나 그 창의 초기화가 지났다 */
  stale: boolean;
  /** 접근성 이름 한 줄 — 창마다(라벨 · % · 초기화) + 에이전트 · 잰 시각 · 누르면. 눈에 보이는 것은 아래 카드다 */
  tip: string;
  /** 에이전트 표시 이름("Claude Code") — 호버 카드 머리 */
  name: string;
  /** 호버 카드 — 대시보드 카드와 같은 줄들(`limitCard`) + 줄마다 흐른 몫 눈금. 값이 없으면 `empty` */
  card: LimitCard;
}

/**
 * 상태바 고리 — **늘** 선다(값이 있는 에이전트마다 하나). 값이 없으면 그 에이전트를 이 PC 에서 본 적이 있을 때만
 * 빈 고리 + "–" (없는 CLI 의 고리를 세우지 않는다). 고리 = 가장 긴 창(`ringWindow`) · 80% 경고색 · 95% 오류색.
 */
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
    // 접근성 이름은 카드의 줄에서 짓는다 — 같은 라벨 · % · 초기화 글자를 두 번 계산하지 않는다
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

/**
 * 고리에 싣는 창 — **가장 긴 창**(Claude · Codex 모두 7일) 하나로 고정한다. 예전에는 창 중 가장 찬 것이라
 * 5시간이 7일을 앞지르면 고리가 소리 없이 다른 창으로 바뀌어 같은 숫자가 무엇인지 헷갈렸다(2026-10-10 사용자
 * 결정). 다른 창은 호버 카드에 그대로 있다. 길이를 모르는 창(`windowMinutes: null`)은 아는 창이 없을 때만 쓴다.
 */
export function ringWindow(windows: readonly LimitWindow[]): LimitWindow {
  return windows.reduce((a, b) => ((b.windowMinutes ?? -1) > (a.windowMinutes ?? -1) ? b : a));
}

/** 팔레트 한 줄 — 값이 있는 에이전트만 */
export interface UsagePaletteEntry {
  key: string;
  agent: string;
  label: string;
  level: LimitLevel;
}

/** 한도 → 팔레트 줄("Claude Code 사용량 — 5시간 24% · 7일 83% · 12분 전") */
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
