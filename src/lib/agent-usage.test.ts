import { describe, expect, it } from "vitest";
import {
  barWidth,
  durationText,
  formatTokens,
  isStale,
  limitCard,
  limitLevel,
  measuredText,
  resetPassed,
  resetText,
  usageKey,
  usageMap,
  usagePaletteEntries,
  usageRings,
  windowElapsed,
  windowLabel,
  type AgentLimits,
  type ConversationUsage,
  type LimitWindow,
} from "$lib/agent-usage";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/session";

const ko: Tr = (k, p) => translate("ko", k, p);
const en: Tr = (k, p) => translate("en", k, p);

const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();
const MIN = 60_000;
const H = 60 * MIN;

const W = (minutes: number | null, pct: number, resetsInMs: number | null): LimitWindow => ({
  windowMinutes: minutes,
  kind: null,
  usedPercent: pct,
  resetsAt: resetsInMs === null ? null : Math.floor((NOW + resetsInMs) / 1000),
});

describe("formatTokens", () => {
  it("줄인다 — k 는 한 자리, M·B 는 두 자리, 끝의 0 은 뗀다", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(2000)).toBe("2k");
    expect(formatTokens(21_400)).toBe("21k");
    expect(formatTokens(612_345)).toBe("612k");
    expect(formatTokens(1_240_000)).toBe("1.24M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(8_900_000)).toBe("8.9M");
    expect(formatTokens(89_340_000)).toBe("89.3M");
    expect(formatTokens(612_000_000)).toBe("612M");
    expect(formatTokens(7_930_000_000)).toBe("7.93B");
    expect(formatTokens(-5)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
  });
});

describe("windowLabel", () => {
  it("데이터의 분에서 짓는다 — 5시간을 박아 두지 않는다", () => {
    expect(windowLabel(300, ko)).toBe("5시간");
    expect(windowLabel(10080, ko)).toBe("7일");
    expect(windowLabel(43200, ko)).toBe("30일");
    expect(windowLabel(90, ko)).toBe("90분");
    expect(windowLabel(120, ko)).toBe("2시간");
    expect(windowLabel(null, ko)).toBe("한도");
    expect(windowLabel(10080, en)).toBe("7-day");
  });
});

describe("단과 막대", () => {
  it("80% 경고 · 95% 오류", () => {
    expect(limitLevel(79.9)).toBe("normal");
    expect(limitLevel(80)).toBe("warn");
    expect(limitLevel(94.9)).toBe("warn");
    expect(limitLevel(95)).toBe("err");
    expect(barWidth(120)).toBe(100);
    expect(barWidth(-1)).toBe(0);
  });
});

describe("잰 시각 · 초기화", () => {
  it("기준 글자", () => {
    expect(measuredText(NOW - 20_000, NOW, ko)).toBe("방금 기준");
    expect(measuredText(NOW - 12 * MIN, NOW, ko)).toBe("12분 전 기준");
    expect(measuredText(NOW - 3 * H, NOW, ko)).toBe("3시간 전 기준");
    expect(measuredText(NOW - 20 * H, NOW, ko)).toBe("어제 기준");
    expect(measuredText(NOW - 4 * 24 * H, NOW, ko)).toBe("4일 전 기준");
  });

  it("묵음 — 3시간부터(값이 없어도)", () => {
    expect(isStale(NOW - 2 * H, NOW)).toBe(false);
    expect(isStale(NOW - 3 * H, NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
  });

  it("초기화 글자 — 지남 · 하루 안 · 날짜", () => {
    expect(resetText(W(300, 1, -MIN), NOW, ko, "ko-KR")).toBe("낡음");
    expect(resetText(W(300, 1, 2 * H + 10 * MIN), NOW, ko, "ko-KR")).toBe("2시간 10분 뒤 초기화");
    expect(resetText(W(300, 1, 45 * MIN), NOW, ko, "ko-KR")).toBe("45분 뒤 초기화");
    const far = resetText(W(10080, 1, 6 * 24 * H), NOW, ko, "ko-KR");
    expect(far).toMatch(/10월 2일/);
    expect(far).toMatch(/12:00/);
    expect(resetText(W(300, 1, null), NOW, ko, "ko-KR")).toBe("");
    expect(resetPassed(W(300, 1, 0), NOW)).toBe(true);
    expect(durationText(26 * H, ko)).toBe("1일 2시간");
  });
});

describe("limitCard", () => {
  it("값이 없으면 빈 카드 — 숫자를 짓지 않는다", () => {
    const c = limitCard({ agent: "claude", windows: [], measuredAt: null }, NOW, ko, "ko-KR");
    expect(c.empty).toBe(true);
    expect(c.rows).toEqual([]);
  });

  it("창은 짧은 것부터 · 지난 창과 묵은 값은 흐리게", () => {
    const l: AgentLimits = { agent: "claude", windows: [W(10080, 83, 3 * 24 * H), W(300, 24, -MIN)], measuredAt: NOW - 12 * MIN };
    const c = limitCard(l, NOW, ko, "ko-KR");
    expect(c.measured).toBe("12분 전 기준");
    expect(c.stale).toBe(false);
    expect(c.rows.map((r) => [r.label, r.pctText, r.level, r.dim, r.resetStale])).toEqual([
      ["5시간", "24%", "normal", true, true],
      ["7일", "83%", "warn", false, false],
    ]);
    const old = limitCard({ ...l, measuredAt: NOW - 26 * H }, NOW, ko, "ko-KR");
    expect(old.stale).toBe(true);
    expect(old.measured).toBe("어제 기준");
    expect(old.rows.every((r) => r.dim)).toBe(true);
  });
});

describe("windowElapsed", () => {
  it("흐른 몫 = 1 − 남은 시간 / 창 길이", () => {
    // 5시간 창에서 초기화까지 2시간 → 3/5 흘렀다
    expect(windowElapsed(W(300, 48, 2 * H), NOW)).toBeCloseTo(0.6);
    // 7일 창에서 하루 남음 → 6/7
    expect(windowElapsed(W(10080, 83, 24 * H), NOW)).toBeCloseTo(6 / 7);
  });

  it("창 길이나 초기화 시각을 모르면 null", () => {
    expect(windowElapsed(W(null, 48, 2 * H), NOW)).toBeNull();
    expect(windowElapsed(W(300, 48, null), NOW)).toBeNull();
    expect(windowElapsed(W(0, 48, 2 * H), NOW)).toBeNull();
  });

  it("초기화가 지났으면 null (지금 그 순간도)", () => {
    expect(windowElapsed(W(300, 48, -MIN), NOW)).toBeNull();
    expect(windowElapsed(W(300, 48, 0), NOW)).toBeNull();
  });

  it("0~1 로 죈다 — 남은 시간이 창보다 길면 0", () => {
    expect(windowElapsed(W(300, 48, 6 * H), NOW)).toBe(0);
    expect(windowElapsed(W(300, 48, 5 * H), NOW)).toBe(0);
    expect(windowElapsed(W(300, 48, 1000), NOW)).toBeLessThanOrEqual(1);
  });

  it("카드 줄에 실린다", () => {
    const c = limitCard({ agent: "claude", windows: [W(300, 48, 2 * H), W(null, 5, H)], measuredAt: NOW }, NOW, ko, "ko-KR");
    expect(c.rows[0].elapsed).toBeCloseTo(0.6);
    expect(c.rows[1].elapsed).toBeNull();
  });
});

describe("usageRings", () => {
  const name = (a: string) => (a === "claude" ? "Claude Code" : "Codex");

  it("고리 = 가장 긴 창 · 늘 선다 · 단과 묵음", () => {
    const r = usageRings(
      [
        { agent: "claude", windows: [W(300, 10, H), W(10080, 83, 24 * H)], measuredAt: NOW - 12 * MIN, seen: true },
        { agent: "codex", windows: [W(10080, 97, -H)], measuredAt: NOW - MIN, seen: true },
      ],
      NOW,
      ko,
      "ko-KR",
      name,
    );
    expect(r.map((x) => [x.agent, x.pct, x.level, x.stale])).toEqual([
      ["claude", 83, "warn", false],
      ["codex", 97, "err", true],
    ]);
    expect(r[0].tip).toBe("5시간 10% (1시간 뒤 초기화) · 7일 83% (9월 27일 (일) 12:00) — Claude Code · 12분 전 기준");
    const low = usageRings([{ agent: "claude", windows: [W(300, 10, H)], measuredAt: NOW, seen: true }], NOW, ko, "ko-KR", name);
    expect(low[0].level).toBe("normal");
    const old = usageRings([{ agent: "claude", windows: [W(300, 10, H)], measuredAt: NOW - 5 * H, seen: true }], NOW, ko, "ko-KR", name);
    expect(old[0].stale).toBe(true);
  });

  it("고리는 늘 가장 긴 창(7일) — 5시간이 더 차도 바뀌지 않는다", () => {
    const r = usageRings(
      [{ agent: "claude", windows: [W(300, 96, H), W(10080, 40, 24 * H)], measuredAt: NOW, seen: true }],
      NOW,
      ko,
      "ko-KR",
      name,
    );
    expect([r[0].pct, r[0].level]).toEqual([40, "normal"]);
    // 길이를 모르는 창은 아는 창이 없을 때만
    expect(usageRings([{ agent: "claude", windows: [W(null, 70, H), W(300, 20, H)], measuredAt: NOW, seen: true }], NOW, ko, "ko-KR", name)[0].pct).toBe(20);
    expect(usageRings([{ agent: "claude", windows: [W(null, 70, H)], measuredAt: NOW, seen: true }], NOW, ko, "ko-KR", name)[0].pct).toBe(70);
  });

  it("호버 카드 — 이름 · 잰 시각 · 짧은 창부터 줄 · 눈금", () => {
    const r = usageRings(
      [{ agent: "claude", windows: [W(10080, 83, 24 * H), W(300, 48, 2 * H)], measuredAt: NOW - 12 * MIN, seen: true }],
      NOW,
      ko,
      "ko-KR",
      name,
    );
    expect(r[0].name).toBe("Claude Code");
    expect(r[0].card.empty).toBe(false);
    expect(r[0].card.measured).toBe("12분 전 기준");
    expect(r[0].card.rows.map((x) => [x.label, x.pctText, x.level])).toEqual([
      ["5시간", "48%", "normal"],
      ["7일", "83%", "warn"],
    ]);
    expect(r[0].card.rows[0].elapsed).toBeCloseTo(0.6);
    expect(r[0].card.rows[0].reset).toBe("2시간 뒤 초기화");
  });

  it("값이 없으면 — 본 적 있는 에이전트만 빈 고리", () => {
    const r = usageRings(
      [
        { agent: "claude", windows: [], measuredAt: null, seen: true },
        { agent: "codex", windows: [], measuredAt: null, seen: false },
      ],
      NOW,
      ko,
      "ko-KR",
      name,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ agent: "claude", pct: null, stale: false, name: "Claude Code" });
    expect(r[0].card.empty).toBe(true);
    expect(r[0].card.rows).toEqual([]);
  });
});

describe("토큰 합", () => {
  const U = (agent: string, id: string, today: number, week: number): ConversationUsage => ({
    agent,
    id,
    tokens: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
    total: 10,
    today,
    week,
    subagents: false,
    forked: false,
  });

  it("열쇠는 대소문자를 가리지 않는다", () => {
    const m = usageMap({ conversations: [U("claude", "AA", 5, 50), U("codex", "bb", 1, 7)], files: 2, elapsedMs: 1 });
    expect(m.has(usageKey("claude", "aa"))).toBe(true);
    expect(m.get(usageKey("codex", "BB"))?.week).toBe(7);
  });
});

describe("usagePaletteEntries", () => {
  it("값이 있는 에이전트만 · 창과 잰 시각", () => {
    const e = usagePaletteEntries(
      [
        { agent: "claude", windows: [W(10080, 83, 24 * H), W(300, 24, H)], measuredAt: NOW - 12 * MIN },
        { agent: "codex", windows: [], measuredAt: null },
      ],
      NOW,
      ko,
      (a) => (a === "claude" ? "Claude Code" : a),
    );
    expect(e).toHaveLength(1);
    expect(e[0].label).toBe("Claude Code 사용량 — 5시간 24% · 7일 83% · 12분 전 기준");
    expect(e[0].level).toBe("warn");
  });
});
