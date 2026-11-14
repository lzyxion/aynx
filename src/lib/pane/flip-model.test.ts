import { describe, expect, it } from "vitest";
import {
  tuiInputHolds,
  CLAUDE_EFFORT_LEVELS,
  CLAUDE_MODEL_ALIASES,
  CODEX_FALLBACK_LEVELS,
  claudeTierOf,
  codexEffortLine,
  codexLevelsFor,
  codexMenuModels,
  codexModelLine,
  codexReasoningFor,
  codexSlugOk,
  flipEffortLevels,
  flipModelLabel,
  flipModelLocked,
  slashEffortLine,
  slashModelLine,
  tuiInputLeftover,
  type CodexModelList,
} from "./flip-model";

describe("flipModelLabel", () => {
  it("Claude 전체 이름은 짧게 — claude- 떼기 · 등급 대문자 · 버전 점 · 날짜 꼬리 버림", () => {
    expect(flipModelLabel("claude", "claude-opus-5-5")).toBe("Opus 5.5");
    expect(flipModelLabel("claude", "claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(flipModelLabel("claude", "claude-haiku-5")).toBe("Haiku 5");
    expect(flipModelLabel("claude", "claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(flipModelLabel("claude", "opus")).toBe("Opus");
  });
  it("Codex 는 목록 줄과 같은 modelLabel", () => {
    expect(flipModelLabel("codex", "gpt-6-astra")).toBe("GPT-6-astra");
  });
});

describe("claudeTierOf", () => {
  it("전체 이름 · 별칭에서 등급 — 모르면 null", () => {
    expect(claudeTierOf("claude-opus-5-5")).toBe("opus");
    expect(claudeTierOf("sonnet")).toBe("sonnet");
    expect(claudeTierOf("gpt-6-astra")).toBeNull();
  });
});

describe("Claude 보내는 줄 — 고정 허용 목록 낱말만(불변식 4)", () => {
  it("메뉴 순서는 fable · opus · sonnet · haiku", () => {
    expect(CLAUDE_MODEL_ALIASES).toEqual(["fable", "opus", "sonnet", "haiku"]);
    expect(CLAUDE_EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
  it("별칭 · default, 단계 · auto(Default 고리 = 빈 글) — 밖이면 null", () => {
    expect(slashModelLine("sonnet")).toBe("/model sonnet");
    expect(slashModelLine("default")).toBe("/model default");
    expect(slashModelLine("Default")).toBeNull();
    expect(slashEffortLine("high")).toBe("/effort high");
    expect(slashEffortLine("")).toBe("/effort auto");
    expect(slashEffortLine("auto")).toBe("/effort auto");
    expect(slashEffortLine("default")).toBeNull();
    expect(slashModelLine("claude-opus-5-5")).toBeNull();
    expect(slashModelLine("opus; rm -rf ~")).toBeNull();
    expect(slashModelLine("opus\r/exit")).toBeNull();
    expect(slashEffortLine("ultra")).toBeNull();
  });
});

describe("Codex 보내는 줄 — 목록의 slug · 허용 단계 상수만(불변식 4)", () => {
  const list: CodexModelList = {
    models: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "Bad Slug", "gpt-x;rm"],
    levels: {
      "gpt-6-astra": { levels: ["low", "medium", "high", "xhigh", "max", "ultra"], default: "low" },
      "gpt-6-luna": { levels: ["low", "medium", "high", "xhigh", "max"], default: "medium" },
      "gpt-6.1-sol": { levels: ["low", "weird", "medium"], default: "weird" },
    },
  };
  it("slug 모양 · 메뉴 줄은 모양 맞는 것만 · 고정 순서", () => {
    expect(codexSlugOk("gpt-6.1-sol")).toBe(true);
    expect(codexSlugOk("gpt x")).toBe(false);
    expect(codexSlugOk("--reasoning=max")).toBe(false);
    expect(codexMenuModels(list)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]);
    expect(codexMenuModels(null)).toEqual([]);
  });
  it("모델 줄 — 지금 강도를 받으면 그것, 아니면 모델 기본, 아니면 medium", () => {
    expect(codexModelLine(list, "gpt-6-astra", "ultra")).toBe("/model gpt-6-astra --reasoning=ultra");
    expect(codexModelLine(list, "gpt-6-luna", "ultra")).toBe("/model gpt-6-luna --reasoning=medium");
    expect(codexModelLine(list, "gpt-6-astra", null)).toBe("/model gpt-6-astra --reasoning=low");
    expect(codexModelLine(list, "gpt-6.1-sol", "bogus")).toBe("/model gpt-6.1-sol --reasoning=medium");
    expect(codexReasoningFor(list, "gpt-6-astra", "high")).toBe("high");
  });
  it("목록 밖 · 모양 밖 slug 는 줄이 없다 — 기록의 이름 · 꾸민 글이 실리지 않는다", () => {
    expect(codexModelLine(list, "gpt-9-made-up", "low")).toBeNull();
    expect(codexModelLine(list, "Bad Slug", "low")).toBeNull();
    expect(codexModelLine(list, "gpt-x;rm", "low")).toBeNull();
    expect(codexModelLine(null, "gpt-6-astra", "low")).toBeNull();
  });
  it("강도 줄 — 허용 단계만", () => {
    expect(codexEffortLine("xhigh")).toBe("/model --reasoning=xhigh");
    expect(codexEffortLine("ultra")).toBe("/model --reasoning=ultra");
    expect(codexEffortLine("high --speed=fast")).toBeNull();
    expect(codexEffortLine("")).toBeNull();
  });
  it("모델별 단계 — 허용 목록 순서 · 모르면 대체 칸", () => {
    expect(codexLevelsFor(list, "gpt-6-luna")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(codexLevelsFor(list, "gpt-6.1-sol")).toEqual(["low", "medium"]);
    expect(codexLevelsFor(list, "unknown")).toEqual(CODEX_FALLBACK_LEVELS);
    expect(codexLevelsFor(null, null)).toEqual(CODEX_FALLBACK_LEVELS);
  });
});

describe("flipModelLocked · flipEffortLevels", () => {
  it("일하는 중 · 권한 대기 · 카드 · TUI 질문이면 잠긴다", () => {
    expect(flipModelLocked({ status: "running", cards: 0, tuiAsking: false })).toBe(true);
    expect(flipModelLocked({ status: "permission", cards: 0, tuiAsking: false })).toBe(true);
    expect(flipModelLocked({ status: "finished", cards: 1, tuiAsking: false })).toBe(true);
    expect(flipModelLocked({ status: null, cards: 0, tuiAsking: true })).toBe(true);
    expect(flipModelLocked({ status: "finished", cards: 0, tuiAsking: false })).toBe(false);
  });
  it("CLI 마다 막대 칸", () => {
    expect(flipEffortLevels("claude")).toHaveLength(5);
    expect(flipEffortLevels("codex")).toEqual(CODEX_FALLBACK_LEVELS);
    expect(flipEffortLevels("aider")).toEqual([]);
  });
});

describe("tuiInputLeftover — 입력 줄의 흐리지 않은 글(실측 모양)", () => {
  const R = (text: string, dim = false) => ({ text, dim });
  it("빈 입력 줄(흐린 안내 글) — 남은 글 없음", () => {
    expect(tuiInputLeftover("claude", [[R("───")], [R("❯ "), R('Try "refactor <filepath>"', true)], [R("───")], [R("  ⏵⏵ auto mode on")]])).toBe(false);
    expect(tuiInputLeftover("codex", [[R("› ", false), R("Ask Codex to do anything", true)], [R("  ~/w")]])).toBe(false);
    expect(tuiInputLeftover("claude", [[R("❯ ")]])).toBe(false);
  });
  it("친 글이 남았다 — 참(가장 아래 입력 줄만 본다)", () => {
    expect(tuiInputLeftover("claude", [[R("❯ /model sonnet")], [R("  ⎿  Set model")], [R("───")], [R("❯ "), R("abc")], [R("───")]])).toBe(true);
    expect(tuiInputLeftover("claude", [[R("❯ old question")], [R("───")], [R("❯ "), R("Try", true)], [R("───")]])).toBe(false);
    expect(tuiInputLeftover("codex", [[R("›"), R(" abc")]])).toBe(true);
  });
  it("입력 줄을 못 찾으면 모른다(null) · 모르는 CLI 도", () => {
    expect(tuiInputLeftover("claude", [[R("hello")]])).toBeNull();
    expect(tuiInputLeftover("aider", [[R("› abc")]])).toBeNull();
  });
});

describe("tuiInputHolds — Codex 가 Enter 를 삼켰나(2026-11-14 실측 화면 모양)", () => {
  const R = (text: string, dim = false) => ({ text, dim });
  const history = [[R("› ", true), R("hi")], [R("  /model --reasoning=high")], [R("• ", true), R("Model changed to gpt-6-astra high for this session only")]];
  it("입력 줄에 보낸 글이 그대로 — 참", () => {
    expect(tuiInputHolds("codex", [...history, [R("› /model --reasoning=low")], [R("  ~\\w")]], "/model --reasoning=low")).toBe(true);
  });
  it("먹었다(흐린 안내 글) · 다른 글 · 입력 줄 없음 · Claude — 거짓", () => {
    expect(tuiInputHolds("codex", [...history, [R("› "), R("Ask Codex to do anything", true)], [R("  ← for agents", true)]], "/model --reasoning=low")).toBe(false);
    expect(tuiInputHolds("codex", [...history, [R("› /model --reasoning=lowx")]], "/model --reasoning=low")).toBe(false);
    expect(tuiInputHolds("codex", [[R("plain")]], "/model --reasoning=low")).toBe(false);
    expect(tuiInputHolds("codex", [[R("› ")]], "")).toBe(false);
  });
  it("칸이 좁아 접힌 입력 줄 — 이어 붙여 본다 · 뒤에 다른 줄이 붙으면 거짓", () => {
    expect(tuiInputHolds("codex", [[R("› /model -")], [R("-reasoning")], [R("=high")]], "/model --reasoning=high")).toBe(true);
    expect(tuiInputHolds("codex", [[R("› /model -")], [R("~\\w")]], "/model --reasoning=high")).toBe(false);
  });
  it("지난 사람 말(› hi)은 입력 줄이 아니다 — 맨 아래 › 줄만 본다", () => {
    expect(tuiInputHolds("codex", [...history, [R("› "), R("Ask Codex to do anything", true)]], "hi")).toBe(false);
  });
});
