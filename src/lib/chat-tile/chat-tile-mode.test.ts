import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODES, CLI_MODE_WORD, CODEX_MODES, chatModeView, cliModeWord, isPlanItem, permModeOk, planOf } from "./chat-tile-mode";

describe("chatModeView — 칩이 보일 값 · 메뉴 줄", () => {
  it("아직 모름 → current null · CLI 별 기본 줄(Claude 에 auto 없음)", () => {
    expect(chatModeView("claude", null, null)).toEqual({ current: null, foreign: false, choices: ["default", "acceptEdits", "plan"] });
    expect(chatModeView("codex", null, null)).toEqual({ current: null, foreign: false, choices: ["readOnly", "auto", "plan"] });
  });

  it("CLI 가 알린 것이 사람이 고른 것보다 먼저 · 알림이 없으면 고른 것", () => {
    expect(chatModeView("claude", { mode: "acceptEdits", choices: ["default", "acceptEdits", "plan"] }, "plan").current).toBe("acceptEdits");
    expect(chatModeView("claude", null, "plan").current).toBe("plan");
  });

  it("서버가 auto 를 알렸을 때만 Claude 메뉴에 auto", () => {
    const v = chatModeView("claude", { mode: "default", choices: ["default", "acceptEdits", "plan", "auto"] }, null);
    expect(v.choices).toEqual(["default", "acceptEdits", "plan", "auto"]);
    expect(chatModeView("claude", { mode: "default", choices: ["default", "acceptEdits", "plan"] }, null).choices).not.toContain("auto");
  });

  it("bypass · 묻지 않기 · Codex custom → foreign(읽기 전용 표지) · 메뉴에 그 줄은 없다", () => {
    const b = chatModeView("claude", { mode: "bypassPermissions", choices: ["default", "acceptEdits", "plan"] }, null);
    expect(b).toMatchObject({ current: "bypassPermissions", foreign: true });
    expect(chatModeView("claude", { mode: "dontAsk", choices: ["default"] }, null).foreign).toBe(true);
    expect(chatModeView("codex", { mode: "custom", choices: ["readOnly", "auto", "plan"] }, null).foreign).toBe(true);
    // 서버 목록에 섞여 와도 칩이 내지 않는 값은 줄로 서지 않는다
    const leak = chatModeView("claude", { mode: "default", choices: ["default", "bypassPermissions", "dontAsk"] }, null);
    expect(leak.choices).toEqual(["default"]);
    expect(chatModeView("codex", { mode: "readOnly", choices: ["readOnly", "fullAccess", "never"] }, null).choices).toEqual(["readOnly"]);
  });

  it("Codex plan 을 못 쓰면(choices 에 없음) 메뉴에 없다", () => {
    expect(chatModeView("codex", { mode: "auto", choices: ["readOnly", "auto"] }, null)).toEqual({ current: "auto", foreign: false, choices: ["readOnly", "auto"] });
  });
});

describe("permModeOk — 명세 · open 에 실을 수 있는 값", () => {
  it("CLI 별 표", () => {
    for (const m of CLAUDE_MODES) expect(permModeOk("claude", m)).toBe(true);
    for (const m of CODEX_MODES) expect(permModeOk("codex", m)).toBe(true);
    expect(permModeOk("claude", "readOnly")).toBe(false);
    expect(permModeOk("codex", "default")).toBe(false);
    expect(permModeOk("codex", "acceptEdits")).toBe(false);
    for (const bad of ["bypassPermissions", "dontAsk", "fullAccess", "never", "untrusted", "dangerFullAccess", "", "Manual", null, undefined, 3]) {
      expect(permModeOk("claude", bad)).toBe(false);
      expect(permModeOk("codex", bad)).toBe(false);
    }
    expect(permModeOk("gemini", "plan")).toBe(false);
  });
});

describe("칩 낱말", () => {
  it("번역하지 않고 · 모르는 낱말은 그대로", () => {
    expect(CLI_MODE_WORD.default).toBe("Manual");
    expect(cliModeWord("bypassPermissions")).toBe("Bypass");
    expect(cliModeWord("weird")).toBe("weird");
    expect(cliModeWord("toString")).toBe("toString");
  });
});

describe("계획", () => {
  it("isPlanItem — 항목 id 끝이 #plan", () => {
    expect(isPlanItem("i1#plan")).toBe(true);
    expect(isPlanItem("i1")).toBe(false);
    expect(isPlanItem("i1#image")).toBe(false);
    expect(isPlanItem(null)).toBe(false);
  });

  it("planOf — 입력의 plan · planFilePath, 없으면 detail", () => {
    expect(planOf({ plan: "## 1\n- a", planFilePath: "C:/u/.claude/plans/x.md" }, "잘린 글")).toEqual({ plan: "## 1\n- a", path: "C:/u/.claude/plans/x.md" });
    expect(planOf(undefined, "잘린 글")).toEqual({ plan: "잘린 글", path: null });
    expect(planOf({ planFilePath: "" }, "d")).toEqual({ plan: "d", path: null });
    expect(planOf(["x"], "d")).toEqual({ plan: "d", path: null });
  });
});

describe("값 import 없음 — check:cycles 가 이 모듈을 잎으로 둔다", () => {
  it("import 는 모두 import type", () => {
    const src = readFileSync(new URL("./chat-tile-mode.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
    expect(imports.length).toBeGreaterThan(0);
    for (const l of imports) expect(l).toMatch(/^import type /);
  });
});
