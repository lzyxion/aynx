import { describe, expect, it } from "vitest";
import { GATE_THEME_TOKENS, collectGateTheme, gateThemeKey } from "./gate-theme";

describe("gate-theme — 관문 쪽 색 모으기", () => {
  it("목록의 토큰만 · 다듬어 · 빈 칸은 빼고 모은다", () => {
    const values: Record<string, string> = { "--bg-base": " #111318 ", "--accent": "#aac7ff", "--chrome-pct": "60%", "--fg": "", "--not-listed": "#000" };
    const t = collectGateTheme((n) => values[n] ?? "", false);
    expect(t.mode).toBe("dark");
    expect(t.tokens).toEqual({ "--bg-base": "#111318", "--accent": "#aac7ff", "--chrome-pct": "60%" });
  });

  it("밝기는 dark · light 둘", () => {
    expect(collectGateTheme(() => "", true).mode).toBe("light");
  });

  it("같은 벌이면 열쇠가 같고 값 · 밝기가 다르면 다르다", () => {
    const read = (n: string) => (n === "--accent" ? "#aac7ff" : "");
    const a = gateThemeKey(collectGateTheme(read, false));
    expect(gateThemeKey(collectGateTheme(read, false))).toBe(a);
    expect(gateThemeKey(collectGateTheme(read, true))).not.toBe(a);
    expect(gateThemeKey(collectGateTheme(() => "#fff", false))).not.toBe(a);
  });

  it("관문 목록은 앱 theme.css 이름이다 — 접두 `--`", () => {
    for (const n of GATE_THEME_TOKENS) expect(n.startsWith("--")).toBe(true);
  });
});
