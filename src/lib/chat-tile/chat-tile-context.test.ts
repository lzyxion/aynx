import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTEXT_HIGH, CONTEXT_WARN, contextView, formatTokens } from "./chat-tile-context";

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [950, "950"],
    [999, "999"],
    [1000, "1k"],
    [36149, "36.1k"],
    [999_949, "999.9k"],
    [999_950, "1M"],
    [1_000_000, "1M"],
    [1_234_567, "1.2M"],
    [-5, "0"],
  ])("%d → %s", (n, s) => {
    expect(formatTokens(n)).toBe(s);
  });
});

describe("contextView", () => {
  it("null → null", () => {
    expect(contextView(null)).toBeNull();
  });

  it("pct 는 반올림한 정수 · 0–100 으로 자른다", () => {
    expect(contextView({ used: 36149, window: 1_000_000, source: "turn" })).toEqual({
      used: 36149,
      window: 1_000_000,
      pct: 4,
      tone: "ok",
      label: "36.1k / 1M",
      short: "4%",
      stale: false,
    });
    expect(contextView({ used: 1_200_000, window: 1_000_000, source: "turn" })?.pct).toBe(100);
    expect(contextView({ used: 5, window: 1_000_000, source: "turn" })?.pct).toBe(0);
  });

  it("경계 69 · 70 · 84 · 85", () => {
    const tone = (pct: number) => contextView({ used: pct * 1000, window: 100_000, source: "turn" })?.tone;
    expect([CONTEXT_WARN, CONTEXT_HIGH]).toEqual([70, 85]);
    expect([tone(69), tone(70), tone(84), tone(85), tone(100)]).toEqual(["ok", "warn", "warn", "high", "high"]);
  });

  it("window 모름 → pct null · ok · 사용량만", () => {
    expect(contextView({ used: 36149, window: null, source: "tokenUsage" })).toEqual({
      used: 36149,
      window: null,
      pct: null,
      tone: "ok",
      label: "36.1k",
      short: "36.1k",
      stale: false,
    });
    expect(contextView({ used: 10, window: 0, source: "turn" })?.pct).toBeNull();
  });

  it("압축 전 값(preCompact)만 흐림 표지", () => {
    expect(contextView({ used: 39200, window: 1_000_000, source: "preCompact" })?.stale).toBe(true);
    for (const source of ["turn", "command", "tokenUsage", "compact"]) expect(contextView({ used: 1, window: null, source })?.stale).toBe(false);
  });

  it("값 import 가 없다(순환 검사 · 화면 밖 시험)", () => {
    const src = readFileSync(new URL("./chat-tile-context.ts", import.meta.url), "utf8");
    for (const m of src.matchAll(/^import\s+(.+?)\s+from/gm)) expect(m[1].startsWith("type ")).toBe(true);
  });
});
