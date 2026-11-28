import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GOAL_BUDGETS,
  GOAL_BUDGET_DEFAULT,
  claudeGoalSet,
  goalBar,
  goalBudgetOk,
  goalObjectiveError,
  goalStatusKey,
  goalViewOf,
} from "./chat-tile-goal";
import type { GoalViewWire } from "$lib/side-chat-api";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";

const lookup = (dict: Record<string, Record<string, string>>, key: string) => dict[key.slice(0, key.indexOf("."))]?.[key.slice(key.indexOf(".") + 1)];
const goal = (over: Partial<GoalViewWire> = {}): GoalViewWire => ({ objective: "모든 시험이 지날 때까지\n둘째 줄", status: "active", tokensUsed: 81230, tokenBudget: 500000, secondsUsed: 312, auto: false, ...over });

describe("토큰 한도 — 다섯 값만", () => {
  it("100k · 250k · 500k(기본) · 1M · 2M 밖은 보낼 수 없다", () => {
    expect([...GOAL_BUDGETS]).toEqual([100_000, 250_000, 500_000, 1_000_000, 2_000_000]);
    expect(Object.isFrozen(GOAL_BUDGETS)).toBe(true);
    expect(GOAL_BUDGET_DEFAULT).toBe(500_000);
    for (const b of GOAL_BUDGETS) expect(goalBudgetOk(b)).toBe(true);
    for (const b of [0, 9_999, 10_000, 499_999, 500_001, 3_000_000, 50_000_000, -1, Number.NaN, "500000", null, undefined]) expect(goalBudgetOk(b)).toBe(false);
  });
});

describe("목표 글", () => {
  it("빈 글 · 4000자 넘음 · 줄바꿈 밖 제어 문자는 거절 · 줄바꿈은 된다", () => {
    expect(goalObjectiveError("시험이 지날 때까지\n고쳐 줘")).toBeNull();
    expect(goalObjectiveError("가".repeat(4000))).toBeNull();
    expect(goalObjectiveError("😀".repeat(4000))).toBeNull();
    for (const bad of ["", "   \n ", "가".repeat(4001), "a\tb", "a\u0000b"]) expect(goalObjectiveError(bad)).toBe("pane.chatTile.goal.err.goal");
  });
});

describe("goalViewOf — 칸째 다시 짓는다", () => {
  it("상태 낱말은 고정 표 · 수는 0 이상 · 한도 없으면 null · 다른 칸은 버린다", () => {
    expect(goalViewOf({ ...goal(), threadId: "T", origin: "user" })).toEqual(goal());
    expect(goalViewOf({ ...goal(), status: "weird" })?.status).toBe("unknown");
    expect(goalViewOf({ ...goal(), tokensUsed: -5, tokenBudget: 0, secondsUsed: "x" })).toMatchObject({ tokensUsed: 0, tokenBudget: null, secondsUsed: 0 });
    expect(goalViewOf({ ...goal(), auto: "yes" })?.auto).toBe(false);
    for (const bad of [null, undefined, [], "x", { status: "active" }]) expect(goalViewOf(bad)).toBeNull();
  });
});

describe("goalBar — 상태마다 단추", () => {
  it.each([
    ["active", "run", true, false],
    ["paused", "paused", false, true],
    ["blocked", "stopped", false, true],
    ["usageLimited", "stopped", false, true],
    ["budgetLimited", "stopped", false, true],
    ["complete", "done", false, false],
    ["unknown", "stopped", false, false],
  ] as const)("%s → tone %s · 멈춤 %s · 다시 %s · 지우기 늘", (status, tone, canPause, canResume) => {
    expect(goalBar(goal({ status }))).toMatchObject({ status, tone, canPause, canResume, canClear: true, statusKey: `pane.chatTile.goal.status.${status}` });
  });

  it("수 · 백분율 · 첫 줄 · 밖에서 정한 목표", () => {
    expect(goalBar(null)).toBeNull();
    expect(goalBar(goal())).toMatchObject({ used: 81230, budget: 500000, pct: 16, head: "모든 시험이 지날 때까지", outside: false });
    expect(goalBar(goal({ tokensUsed: 900000 }))?.pct).toBe(100);
    expect(goalBar(goal({ tokenBudget: null }))).toMatchObject({ budget: null, pct: null });
    // Aynx 밖에서 선 목표도 같은 단추 — 앱이 스스로 멈추지 않는다
    expect(goalBar(goal({ auto: true }))).toMatchObject({ outside: true, canPause: true, canClear: true });
    expect(goalBar(goal({ auto: true, status: "paused" }))).toMatchObject({ outside: true, canResume: true });
  });

  it("상태 문구가 두 사전에 있다 · 모르는 낱말은 unknown", () => {
    for (const s of ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete", "unknown"]) {
      expect(lookup(ko as never, goalStatusKey(s))).toBeTruthy();
      expect(lookup(en as never, goalStatusKey(s))).toBeTruthy();
    }
    expect(goalStatusKey("x")).toBe("pane.chatTile.goal.status.unknown");
  });
});

describe("claudeGoalSet — Claude `/goal <조건>` 만 안내", () => {
  it.each([
    ["/goal 시험이 다 지날 때까지", true],
    ["  /GOAL a.txt 에 3줄\n더", true],
    ["/goal clearly done", true],
    ["/goal", false],
    ["/goal   ", false],
    ["/goal clear", false],
    ["/goal CLEAR ", false],
    ["/goals x", false],
    ["goal x", false],
    ["안녕 /goal x", false],
  ] as const)("%s → %s", (text, want) => {
    expect(claudeGoalSet(text)).toBe(want);
  });
});

describe("모듈", () => {
  it("값 import 가 없다", () => {
    const src = readFileSync(new URL("./chat-tile-goal.ts", import.meta.url), "utf8");
    for (const m of src.matchAll(/^import\s+(.+?)\s+from/gm)) expect(m[1].startsWith("type ")).toBe(true);
  });
});
