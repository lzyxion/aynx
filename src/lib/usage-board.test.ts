import { describe, expect, it } from "vitest";
import {
  barHeight,
  buildHeatmap,
  composition,
  dayDetail,
  levelScale,
  modelColor,
  modelTable,
  moveDate,
  parseUsageFilter,
  pctText,
  shortModel,
  summaryStrip,
  usageColors,
  weekChart,
  OTHER_KEY,
  type UsageBucket,
  type UsageSummary,
} from "$lib/usage-board";

const T = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({ input, cacheRead, cacheWrite, output });

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 오늘(2026-09-26 토)로 끝나는 `n` 일 — 합은 `totals[i]`(뒤에서부터 채운다) */
function summary(n: number, totals: number[], extra: Partial<UsageSummary> = {}): UsageSummary {
  const today = new Date(2026, 8, 26);
  const daily = Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    const total = totals[i - (n - totals.length)] ?? 0;
    return { date: iso(d), tokens: T(total, 0, 0, 0), total };
  });
  return {
    today: iso(today),
    start: daily[0].date,
    firstDay: daily.find((d) => d.total > 0)?.date ?? null,
    agents: ["claude"],
    daily,
    recent: daily.slice(-35),
    buckets: [],
    models: [],
    streak: 0,
    priorAvg: null,
    priorDays: 0,
    elapsedMs: 1,
    ...extra,
  };
}

describe("shortModel", () => {
  it("claude- 앞머리와 끝의 날짜를 뗀다", () => {
    expect(shortModel("claude-opus-5-20260101")).toBe("opus-5");
    expect(shortModel("claude-sonnet-4-5-20250929")).toBe("sonnet-4-5");
    expect(shortModel("gpt-6-codex")).toBe("gpt-6-codex");
    expect(shortModel("model-1234567")).toBe("model-1234567");
    expect(shortModel("")).toBe("");
  });
});

describe("거르개 저장", () => {
  it("모르는 값은 기본(30일 · 전체) · 옛 판의 90일 · 전체는 30일로", () => {
    expect(parseUsageFilter(null)).toEqual({ agent: null, period: 30 });
    expect(parseUsageFilter("{bad")).toEqual({ agent: null, period: 30 });
    expect(parseUsageFilter('{"agent":"codex","period":7}')).toEqual({ agent: "codex", period: 7 });
    expect(parseUsageFilter('{"agent":"codex","period":90}')).toEqual({ agent: "codex", period: 30 });
    expect(parseUsageFilter('{"agent":"codex","period":null}')).toEqual({ agent: "codex", period: 30 });
    expect(parseUsageFilter('{"agent":"<x>","period":12}')).toEqual({ agent: null, period: 30 });
  });
});

describe("요약 띠", () => {
  it("오늘 · 평균 대비 · 기간 합 · 하루 평균(기록 시작 뒤로만) · 활동일 · 최다", () => {
    const s = summary(30, [0, 100, 0, 300, 50], { priorAvg: 100, priorDays: 7, streak: 1 });
    const st = summaryStrip(s);
    expect(st.today).toBe(50);
    expect(st.todayDelta).toBe(-50);
    expect(st.periodTotal).toBe(450);
    expect(st.recordedDays).toBe(4);
    expect(st.dailyAvg).toBeCloseTo(112.5);
    expect(st.activeDays).toBe(3);
    expect(st.busiest).toEqual({ date: "2026-09-25", total: 300 });
    expect(summaryStrip(summary(7, [0])).todayDelta).toBeNull();
    // 연속은 기간 안에서만 — 7일 기간이면 7이 상한
    expect(summaryStrip(summary(7, [1], { streak: 35 })).streak).toBe(7);
  });
});

describe("잔디", () => {
  it("단계 = 기록이 있는 날의 사분위 — 0 은 0", () => {
    const lv = levelScale([0, 1, 2, 3, 4, 5, 6, 7, 8, 0]);
    expect([0, 1, 3, 5, 7, 8].map(lv)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(levelScale([0, 0])(5)).toBe(0);
    // 큰 하루 하나가 나머지를 바닥으로 누르지 않는다
    const big = levelScale([1, 2, 3, 1000]);
    expect(big(3)).toBeGreaterThan(big(1));
  });

  it("달력 모양 — 다섯 줄(주) × 일곱 칸(일~토) · 이번 주가 마지막 줄 · 기록 전 칸 · 며칠", () => {
    // 7일 기간이어도 잔디는 recent(35일)로 그린다
    const r = summary(35, [5, 0, 7, 9]);
    const s = { ...summary(7, [9]), recent: r.daily, firstDay: r.firstDay };
    const h = buildHeatmap(s, "ko-KR")!;
    expect(h.rows).toHaveLength(5);
    expect(h.rows.every((row) => row.length === 7)).toBe(true);
    // 오늘(2026-09-26)은 토요일 — 다섯 줄이 꽉 찬다(35칸), 첫 칸은 일요일 8월 23일
    expect(h.days).toBe(35);
    expect(h.rows[0][0]).toMatchObject({ date: "2026-08-23", day: 23 });
    expect(h.rows[4][6]?.date).toBe(s.today);
    const cells = h.rows.flat().filter((c) => c !== null);
    expect(cells.filter((c) => c!.pre).length).toBe(31);
    expect(h.recorded).toBe(4);
    expect(cells.find((c) => c?.date === "2026-09-24")?.level).toBe(0);
    expect(h.months).toEqual(["8월", "9월"]);
  });

  it("오늘이 수요일이면 마지막 줄은 수요일까지 — 뒤는 빈 자리", () => {
    const wed = { ...summary(7, [1]), recent: summary(35, [1]).daily.slice(0, 32) };
    wed.today = wed.recent.at(-1)!.date; // 2026-09-23(수)
    const h = buildHeatmap(wed, "ko-KR")!;
    expect(h.rows).toHaveLength(5);
    expect(h.days).toBe(32);
    expect(h.rows[0][0]?.date).toBe("2026-08-23");
    expect(h.rows[4].map((c) => c?.date ?? null)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", null, null, null]);
  });

  it("키보드 — 달력이라 ←→ 하루 · ↑↓ 한 주 · 끝에서 멈춘다", () => {
    const dates = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    expect(moveDate(dates, "c", "ArrowRight")).toBe("d");
    expect(moveDate(dates, "c", "ArrowLeft")).toBe("b");
    expect(moveDate(dates, "a", "ArrowDown")).toBe("h");
    expect(moveDate(dates, "b", "ArrowUp")).toBe("a");
    expect(moveDate(dates, "i", "ArrowDown")).toBe("i");
  });
});

const B = (date: string, agent: string, model: string, total: number): UsageBucket => ({
  date,
  agent,
  model,
  tokens: T(0, total, 0, 0),
  total,
});

describe("고른 날 · 7일 막대", () => {
  const s = summary(7, [10, 10, 10, 10, 10, 10, 100], {
    buckets: [
      B("2026-09-26", "claude", "claude-opus-5", 60),
      B("2026-09-26", "codex", "gpt-6", 30),
      B("2026-09-26", "claude", "claude-haiku-5", 10),
      B("2026-09-25", "claude", "m3", 5),
      B("2026-09-24", "claude", "m4", 4),
      B("2026-09-23", "claude", "m5", 3),
    ],
  });

  it("하루 풀이 — 에이전트 몫과 모델 구성", () => {
    const d = dayDetail(s, "2026-09-26");
    expect(d.total).toBe(100);
    expect(d.agents.map((a) => [a.agent, a.total, a.share])).toEqual([
      ["claude", 70, 0.7],
      ["codex", 30, 0.3],
    ]);
    expect(d.models[0]).toMatchObject({ model: "claude-opus-5", share: 0.6 });
    expect(dayDetail(s, "2026-09-01").total).toBe(0);
  });

  it("위 네 모델 + 기타 · 오늘 표시", () => {
    const w = weekChart(s);
    expect(w.series.map((x) => x.key)).toEqual(["claude:claude-opus-5", "codex:gpt-6", "claude:claude-haiku-5", "claude:m3", OTHER_KEY]);
    expect(w.days.at(-1)).toMatchObject({ isToday: true, total: 100 });
    expect(w.days.find((d) => d.date === "2026-09-23")?.segs).toEqual([{ key: OTHER_KEY, total: 3 }]);
    expect(w.max).toBe(100);
    // 같은 에이전트 안에서는 네 단계 — 첫 Claude 와 둘째 Claude 의 빛깔이 다르다
    expect(w.series[0].color).not.toBe(w.series[2].color);
  });

  it("막대 바닥 높이", () => {
    expect(barHeight(0, 100)).toBe(0);
    expect(barHeight(1, 1000)).toBe(4);
    expect(barHeight(50, 100)).toBe(50);
  });
});

describe("빛깔 — 한 매핑", () => {
  it("에이전트 가족 네 단계 · 그 밖은 회색", () => {
    expect([0, 1, 2, 3].map((r) => modelColor("claude", r))).toEqual([
      "var(--agent-claude-1)",
      "var(--agent-claude-2)",
      "var(--agent-claude-3)",
      "var(--agent-claude-4)",
    ]);
    expect(modelColor("claude", 4)).toBe("var(--fg-3)");
    expect(modelColor("gemini", 0)).toBe("var(--fg-3)");
    expect(modelColor(null, 0)).toBe("var(--fg-3)");
  });

  it("같은 모델은 세 그림에서 같은 빛깔 — 기간의 모델 순이 기준", () => {
    const s = summary(7, [1], {
      models: [
        { agent: "claude", model: "b", tokens: T(0, 0, 0, 0), total: 90, conversations: 1 },
        { agent: "claude", model: "a", tokens: T(0, 0, 0, 0), total: 10, conversations: 1 },
      ],
      buckets: [
        { date: "2026-09-26", agent: "claude", model: "a", tokens: T(0, 0, 0, 0), total: 10 },
        { date: "2026-08-30", agent: "claude", model: "old", tokens: T(0, 0, 0, 0), total: 5 },
      ],
    });
    const c = usageColors(s);
    expect([c.get("claude:b"), c.get("claude:a"), c.get("claude:old")]).toEqual([
      "var(--agent-claude-1)",
      "var(--agent-claude-2)",
      "var(--agent-claude-3)",
    ]);
    // 하루에 "a" 만 있어도 7일 막대의 "a" 는 기간 순위의 빛깔(둘째)
    expect(weekChart(s).series.find((x) => x.model === "a")?.color).toBe("var(--agent-claude-2)");
    expect(modelTable(s).find((r) => r.model === "a")?.color).toBe("var(--agent-claude-2)");
  });
});

describe("토큰 구성 · 모델 표", () => {
  it("히트율 · 재사용 · 캐시 쓰기가 없으면 재사용 없음", () => {
    const c = composition(T(10, 900, 90, 0));
    expect(c.rows.map((r) => r.key)).toEqual(["cacheRead", "cacheWrite", "output", "input"]);
    expect(c.hitRate).toBeCloseTo(0.9);
    expect(c.reuse).toBeCloseTo(10);
    expect(composition(T(10, 5, 0, 1)).reuse).toBeNull();
    expect(composition(T(0, 0, 0, 0)).hitRate).toBeNull();
  });

  it("모델 표 — 몫 · 출력 · 입력+쓰기 · 대화", () => {
    const s = summary(7, [1], {
      models: [
        { agent: "claude", model: "claude-opus-5-20260101", tokens: T(1, 70, 4, 5), total: 80, conversations: 3 },
        { agent: "codex", model: "", tokens: T(10, 5, 0, 5), total: 20, conversations: 1 },
      ],
    });
    const rows = modelTable(s);
    expect(rows.map((r) => [r.label, r.total, r.share, r.output, r.inputWrite, r.conversations])).toEqual([
      ["opus-5", 80, 0.8, 5, 5, 3],
      ["", 20, 0.2, 5, 10, 1],
    ]);
    expect(pctText(0.004)).toBe("<1%");
    expect(pctText(0)).toBe("0%");
  });
});
