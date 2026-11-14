import { describe, expect, it } from "vitest";
import {
  claudeSwitchAsk,
  latestAck,
  modelAcks,
  overrideOf,
  settleOverride,
  shownModel,
  SWITCH_NO_KEY,
  SWITCH_YES_KEY,
} from "./flip-model-ack";

// 화면 견본 — 실측한 줄의 모양(Claude Code 2.1.323 · Codex 0.168.0)
const C_OPUS = "  ⎿  Set model to Opus 5.5 and saved as your default for new sessions";
const C_DEFAULT = "  ⎿  Set model to Sonnet 5.5 (default) and saved as your default for new sessions";
const C_HIGH = "  ⎿  Set effort level to high (saved as your default for new sessions): Comprehensive implementation with extensive";
const C_AUTO = "  ⎿  Effort level set to auto";
const C_BAD_MODEL = "  ⎿  Model 'Default' not found";
const C_BAD_EFFORT = "  ⎿  Invalid argument: default. Valid options are: low, medium, high, xhigh, max, auto, ultracode [on|off]";
const C_KEPT = "  ⎿  Kept model as Opus 5.5";
const X_OK = "• Model changed to gpt-6-astra xhigh for this session only";
const X_BAD = "■ Reasoning level 'bogus' is unavailable for gpt-6-astra. Available: low, medium, high, xhigh, max, ultra.";

describe("modelAcks", () => {
  it("Claude 확인 · 거절 줄", () => {
    expect(modelAcks("claude", ["❯ /model opus", C_OPUS, "", C_DEFAULT, C_HIGH, C_AUTO, C_BAD_MODEL, C_BAD_EFFORT, C_KEPT])).toEqual([
      { kind: "model", ok: true, model: "claude-opus-5-5" },
      { kind: "model", ok: true, model: "claude-sonnet-5-5" },
      { kind: "effort", ok: true, effort: "high" },
      { kind: "effort", ok: true, effort: null },
      { kind: "model", ok: false },
      { kind: "any", ok: false },
      { kind: "model", ok: false },
    ]);
  });

  it("⎿ 머리 없는 말(대화 본문의 인용)은 보지 않는다", () => {
    expect(modelAcks("claude", ["● Set model to Opus 5.5 and saved", "Set effort level to high"])).toEqual([]);
  });

  it("Codex 확인 · 거절 줄", () => {
    expect(modelAcks("codex", [X_OK, "", X_BAD, "■ Model 'nosuch' is unavailable. Use /model to see available models."])).toEqual([
      { kind: "model", ok: true, model: "gpt-6-astra", effort: "xhigh" },
      { kind: "any", ok: false },
      { kind: "any", ok: false },
    ]);
  });

  it("모르는 CLI · 이상한 이름은 받지 않는다", () => {
    expect(modelAcks("gemini", [C_OPUS])).toEqual([]);
    expect(modelAcks("claude", ["  ⎿  Set model to <script> and saved"])).toEqual([{ kind: "model", ok: false }]);
    expect(modelAcks("codex", ["• Model changed to GPT_X; high for this session only"])).toEqual([{ kind: "any", ok: false }]);
  });
});

describe("latestAck — 화면 맨 아래의 확인이 보낸 것의 답인가(2026-11-14 실기 화면 모양)", () => {
  const C = (cmd: string, ack: string) => [`❯ ${cmd}`, `  ⎿  ${ack}`, ""];
  const EFF = (l: string) => C(`/effort ${l}`, `Set effort level to ${l} (saved as your default for new sessions): Comprehensive implementation`);
  const MOD = (a: string, n: string) => C(`/model ${a}`, `Set model to ${n} and saved as your default for new sessions`);
  const BOX = ["────", "❯ ", "────"];
  const eff = (l: string) => ({ kind: "effort" as const, line: `/effort ${l}` });

  it("Claude — 같은 문구가 여러 번 쌓여도 · 위 줄이 밀려 나가도(수 비교 없음) 맨 아래 짝이 보낸 명령이면 받는다", () => {
    const full = [...Array.from({ length: 10 }, () => [...MOD("opus", "Opus 5.5"), ...EFF("high")]).flat()];
    expect(latestAck("claude", eff("low"), [...full, ...BOX])).toBe("wait");
    expect(latestAck("claude", eff("low"), [...full.slice(3), ...EFF("low"), ...BOX])).toEqual({ ack: { kind: "effort", ok: true, effort: "low" } });
    // 같은 값 두 번 — 맨 아래 옛 짝이 곧바로 맞는다(이미 그 값)
    expect(latestAck("claude", eff("high"), [...full, ...BOX])).toEqual({ ack: { kind: "effort", ok: true, effort: "high" } });
    expect(latestAck("claude", { kind: "model", line: "/model sonnet" }, [...full, ...MOD("sonnet", "Sonnet 5.5"), ...BOX])).toEqual({ ack: { kind: "model", ok: true, model: "claude-sonnet-5-5" } });
  });

  it("Claude — 입력 줄에 친 채(아래가 ⎿ 아님)는 건너뛰고 · 앞 명령까지만 처리됐으면 · 거절이면 기다린다", () => {
    expect(latestAck("claude", eff("max"), [...EFF("medium"), "────", "❯ /effort max", "────"])).toBe("wait");
    expect(latestAck("claude", eff("max"), [...EFF("medium"), ...EFF("max"), ...BOX])).toEqual({ ack: { kind: "effort", ok: true, effort: "max" } });
    expect(latestAck("claude", { kind: "model", line: "/model sonnet" }, [...C("/model sonnet", "Model 'sonnet' not found"), ...BOX])).toBe("wait");
    expect(latestAck("claude", eff("auto"), [...C("/effort auto", "Effort level set to auto"), ...BOX])).toEqual({ ack: { kind: "effort", ok: true, effort: null } });
    // 대화 본문의 인용(⎿ 없이)은 짝이 아니다
    expect(latestAck("claude", eff("low"), ["● ❯ /effort low", "  Set effort level to low", ...BOX])).toBe("wait");
  });

  it("확인 카드의 [전환](line 없음) — 맨 아래 짝의 받아들임이면", () => {
    expect(latestAck("claude", { kind: "model", line: null }, [...MOD("opus", "Opus 5.5"), ...BOX])).toEqual({ ack: { kind: "model", ok: true, model: "claude-opus-5-5" } });
    expect(latestAck("claude", { kind: "model", line: null }, [...C("/model opus", "Kept model as Haiku 5.5"), ...BOX])).toBe("wait");
  });

  it("Codex — 맨 아래 확인 줄의 값이 보낸 값이면(모델을 보냈으면 slug 도)", () => {
    const X = (s: string, l: string) => `• Model changed to ${s} ${l} for this session only`;
    const full = Array.from({ length: 30 }, () => X("gpt-6-luna", "medium"));
    const box = ["", "› Ask Codex to do anything"];
    expect(latestAck("codex", { kind: "effort", line: "/model --reasoning=low" }, [...full, ...box])).toBe("wait");
    expect(latestAck("codex", { kind: "effort", line: "/model --reasoning=low" }, [...full.slice(1), X("gpt-6-luna", "low"), ...box])).toEqual({ ack: { kind: "model", ok: true, model: "gpt-6-luna", effort: "low" } });
    expect(latestAck("codex", { kind: "effort", line: "/model --reasoning=medium" }, [...full, ...box])).toEqual({ ack: { kind: "model", ok: true, model: "gpt-6-luna", effort: "medium" } });
    expect(latestAck("codex", { kind: "model", line: "/model gpt-6-astra --reasoning=medium" }, [...full, ...box])).toBe("wait");
    expect(latestAck("codex", { kind: "model", line: "/model gpt-6-astra --reasoning=medium" }, [...full, X("gpt-6-astra", "medium"), ...box])).toEqual({ ack: { kind: "model", ok: true, model: "gpt-6-astra", effort: "medium" } });
    expect(latestAck("codex", { kind: "effort", line: "/model --reasoning=low" }, [...full, "■ Reasoning level 'low' is unavailable for x.", ...box])).toBe("wait");
  });
});

describe("덮은 값", () => {
  it("모델 위에 강도만 바꾸면 모델은 덮은 값 그대로 · 기록 위에 그린다", () => {
    const a = overrideOf(null, { kind: "model", ok: true, model: "claude-haiku-5-5" }, 10);
    const b = overrideOf(a, { kind: "effort", ok: true, effort: "low" }, 10);
    expect(b).toEqual({ model: "claude-haiku-5-5", effort: "low", lastAt: 10 });
    expect(shownModel({ model: "claude-opus-5-5", effort: "high" }, b)).toEqual({ model: "claude-haiku-5-5", effort: "low" });
    expect(shownModel({ model: "claude-opus-5-5", effort: "high" }, a)).toEqual({ model: "claude-haiku-5-5", effort: "high" });
    // auto = 강도 모름
    const c = overrideOf(a, { kind: "effort", ok: true, effort: null }, 10);
    expect(shownModel({ model: "m", effort: "high" }, c)).toEqual({ model: "claude-haiku-5-5", effort: null });
  });

  it("새 답이 지난 덮은 값 위에는 쌓지 않는다", () => {
    const a = overrideOf(null, { kind: "model", ok: true, model: "x" }, 10);
    expect(overrideOf(a, { kind: "effort", ok: true, effort: "low" }, 20)).toEqual({ effort: "low", lastAt: 20 });
  });

  it("모델을 끝내 모르면 그리지 않는다 · 덮은 값이 없으면 기록 그대로", () => {
    expect(shownModel(null, { effort: "low", lastAt: null })).toBeNull();
    expect(shownModel({ model: "m" }, null)).toEqual({ model: "m" });
  });

  it("값을 실은 줄이 바뀔 때만 걷는다 — 사람 말 · 도구 항목(last 그대로 · 이 쪽 밖)으로는 걷지 않는다", () => {
    const ov = overrideOf(null, { kind: "effort", ok: true, effort: "low" }, 10);
    expect(settleOverride(ov, 10)).toBe(ov);
    expect(settleOverride(ov, undefined)).toBe(ov);
    expect(settleOverride(ov, 30)).toBeNull();
    expect(settleOverride(null, 30)).toBeNull();
    // 기록에 값이 없을 때 덮었다 → 첫 답이 오면 걷는다
    const none = overrideOf(null, { kind: "model", ok: true, model: "m" }, null);
    expect(settleOverride(none, undefined)).toBe(none);
    expect(settleOverride(none, 0)).toBeNull();
    // 쪽을 몰랐을 때 덮었다 → 처음 받은 자리를 그 자리로
    const early = overrideOf(null, { kind: "model", ok: true, model: "m" }, undefined);
    expect(settleOverride(early, 10)).toEqual({ model: "m", lastAt: 10 });
    expect(settleOverride(early, undefined)).toEqual({ model: "m", lastAt: null });
  });
});

describe("claudeSwitchAsk", () => {
  const screen = [
    "❯ hi",
    "● 안녕하세요!",
    "▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔",
    "   Switch model?",
    "   Your next response will be slower and use more tokens",
    "",
    "   This conversation is cached for the current model. Switching to Haiku 5.5 means the full history gets re-read.",
    "",
    "   ❯ 1. Yes, switch to Haiku 5.5",
    "     2. No, go back",
  ];

  it("실측 화면 — 표시용 모델 이름", () => {
    expect(claudeSwitchAsk(screen)).toEqual({ kind: "model", name: "Haiku 5.5" });
  });

  it("고른 표시가 2번에 있어도", () => {
    const s = [...screen.slice(0, 8), "     1. Yes, switch to Sonnet 5.5", "   ❯ 2. No, go back"];
    expect(claudeSwitchAsk(s)).toEqual({ kind: "model", name: "Sonnet 5.5" });
  });

  it("머리 · 두 줄 중 하나라도 빠지면 아니다 · 문장 속 인용도 아니다", () => {
    expect(claudeSwitchAsk(screen.slice(0, 9))).toBeNull();
    expect(claudeSwitchAsk(screen.filter((l) => !l.includes("Switch model?")))).toBeNull();
    expect(claudeSwitchAsk(["● 화면에 Switch model? 이 뜨면 1. Yes, switch to Haiku 5.5 를 고르세요", "2. No, go back"])).toBeNull();
    expect(claudeSwitchAsk([])).toBeNull();
  });

  it("이상한 이름은 빈 글(카드는 서되 이름 없이)", () => {
    const s = [...screen.slice(0, 8), "   ❯ 1. Yes, switch to <b>x</b>", "     2. No, go back"];
    expect(claudeSwitchAsk(s)).toEqual({ kind: "model", name: "" });
  });

  it("Effort 확인(Change effort level? — 같은 부품) · 단계 이름은 목록 안만", () => {
    const eff = ["   Change effort level?", "   Your next response will be slower and use more tokens", "",
      "   This conversation is cached for the current effort level. Switching to high means the full history gets re-read.", "",
      "   ❯ 1. Yes, switch to high", "     2. No, go back"];
    expect(claudeSwitchAsk(eff)).toEqual({ kind: "effort", name: "high" });
    expect(claudeSwitchAsk(eff.map((l) => l.replace("switch to high", "switch to auto")))).toEqual({ kind: "effort", name: "auto" });
    expect(claudeSwitchAsk(eff.map((l) => l.replace("switch to high", "switch to Opus 5.5")))).toEqual({ kind: "effort", name: "" });
    // 번호를 숨긴 판(Effort 고르기 화면 안)은 보지 않는다
    expect(claudeSwitchAsk(eff.map((l) => l.replace("1. ", "").replace("2. ", "")))).toBeNull();
  });

  it("보내는 키는 고정 상수", () => {
    expect([SWITCH_YES_KEY, SWITCH_NO_KEY]).toEqual(["1", "2"]);
  });
});
