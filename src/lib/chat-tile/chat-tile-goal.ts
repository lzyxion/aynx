// 채팅 타일 목표의 순수 층 — Codex 목표 카드 · 띠 재료와 Claude `/goal` 안내 판정. 값 import 없음.
// 토큰 한도는 아래 다섯 값만 보낸다(서버가 그 밖을 `[bad-budget]` 으로 거절한다) — 직접 입력 칸을 짓지 않는다.
// 앱은 목표를 스스로 정하거나 다시 켜지 않는다 — 여기 있는 것은 사람이 누른 단추의 재료뿐이다.

import type { Key } from "$lib/i18n/keys";
import type { GoalViewWire } from "$lib/side-chat-api";

export const GOAL_BUDGETS = Object.freeze([100_000, 250_000, 500_000, 1_000_000, 2_000_000] as const);
export type GoalBudget = (typeof GOAL_BUDGETS)[number];
export const GOAL_BUDGET_DEFAULT: GoalBudget = 500_000;
/** CLI 의 한도(글자 수) */
export const GOAL_OBJECTIVE_MAX = 4000;

export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete" | "unknown";
const STATUSES: readonly GoalStatus[] = ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"];
/** 서버가 `resume` 을 받는 상태 */
const RESUMABLE: readonly GoalStatus[] = ["paused", "blocked", "usageLimited", "budgetLimited"];

/** 서버 `char::is_control` 과 같은 범위 — 줄바꿈 밖 제어 문자(`chat-tile-review` 와 같은 규칙 · 값 import 를 두지 않으려 따로 둔다) */
function hasControl(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0a || c === 0x0d) continue;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

export function goalBudgetOk(v: unknown): v is GoalBudget {
  return typeof v === "number" && (GOAL_BUDGETS as readonly number[]).includes(v);
}

/** 빈 글 · 4000자 넘음 · 줄바꿈 밖 제어 문자 */
export function goalObjectiveError(text: string): Key | null {
  const s = text.trim();
  if (s === "" || [...s].length > GOAL_OBJECTIVE_MAX || hasControl(s)) return "pane.chatTile.goal.err.goal";
  return null;
}

export function goalStatusOf(v: unknown): GoalStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v) ? (v as GoalStatus) : "unknown";
}

export function goalStatusKey(status: string): Key {
  return `pane.chatTile.goal.status.${goalStatusOf(status)}` as Key;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** 사건 · 스냅숏의 목표를 칸째 다시 짓는다 — 모르는 상태 낱말은 "unknown" · 다른 칸은 버린다 */
export function goalViewOf(raw: unknown): GoalViewWire | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.objective !== "string") return null;
  const budget = typeof g.tokenBudget === "number" && Number.isFinite(g.tokenBudget) && g.tokenBudget > 0 ? Math.floor(g.tokenBudget) : null;
  return {
    objective: g.objective,
    status: goalStatusOf(g.status),
    tokensUsed: count(g.tokensUsed),
    tokenBudget: budget,
    secondsUsed: count(g.secondsUsed),
    auto: g.auto === true,
  };
}

export type GoalTone = "run" | "paused" | "stopped" | "done";

export interface GoalBar {
  tone: GoalTone;
  status: GoalStatus;
  statusKey: Key;
  /** 목표 글의 첫 줄(띠) — 전체 글은 title 로 */
  head: string;
  used: number;
  budget: number | null;
  /** 0–100 · 한도를 모르면 null */
  pct: number | null;
  /** Aynx 밖에서 정한 목표 — 띠 머리에 `goal.auto` */
  outside: boolean;
  canPause: boolean;
  canResume: boolean;
  canClear: boolean;
}

/** 띠 재료 — 수 글("81.2k / 500k")은 화면이 `formatTokens` 로 짓는다 */
export function goalBar(g: GoalViewWire | null): GoalBar | null {
  if (!g) return null;
  const status = goalStatusOf(g.status);
  const tone: GoalTone = status === "active" ? "run" : status === "paused" ? "paused" : status === "complete" ? "done" : "stopped";
  const budget = g.tokenBudget !== null && g.tokenBudget > 0 ? g.tokenBudget : null;
  const used = count(g.tokensUsed);
  return {
    tone,
    status,
    statusKey: goalStatusKey(status),
    head: g.objective.trim().split(/\r?\n/, 1)[0] ?? "",
    used,
    budget,
    pct: budget !== null ? Math.min(100, Math.round((used / budget) * 100)) : null,
    outside: g.auto === true,
    canPause: status === "active",
    canResume: RESUMABLE.includes(status),
    canClear: true,
  };
}

/**
 * Claude 에 보내는 `/goal <조건>`(인자 있음 · `clear` 아님) — 보내기는 막지 않고 고정 안내 한 줄만 남긴다.
 * `/goal` 만(지금 목표 보기) · `/goal clear` 는 안내하지 않는다.
 */
export function claudeGoalSet(text: string): boolean {
  const m = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return false;
  const args = (m[1] ?? "").trim();
  return args !== "" && args.toLowerCase() !== "clear";
}
