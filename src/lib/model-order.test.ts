import { describe, expect, it } from "vitest";
import { effortLabel, modelLabel, orderModels } from "./model-order";

describe("orderModels", () => {
  it("Claude 등급 순 — fable > opus > sonnet > haiku", () => {
    expect(orderModels(["opus", "haiku", "fable", "sonnet"])).toEqual(["fable", "opus", "sonnet", "haiku"]);
  });

  it("Codex 등급 순 — astra > sol > terra > luna", () => {
    expect(orderModels(["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-6-terra"])).toEqual([
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-terra",
      "gpt-6-luna",
    ]);
  });

  it("버전 먼저 — 숫자 버전 내림차순, 같은 버전 안에서는 등급 순", () => {
    expect(orderModels(["claude-sonnet-5", "claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-opus-5-5"])).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
    expect(orderModels(["gpt-6.1-luna", "gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-astra"])).toEqual([
      "gpt-6.1-astra",
      "gpt-6.1-sol",
      "gpt-6.1-luna",
      "gpt-6-sol",
      "gpt-5.6-sol",
    ]);
  });

  it("하이픈으로 쪼갠 버전도 한 버전 — claude-opus-5-5 = 5.5 · 6 과 6.0 은 같다", () => {
    expect(orderModels(["claude-opus-5", "claude-opus-5-5", "claude-opus-4-1-20250805"])).toEqual([
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-1-20250805",
    ]);
    // 5.5(하이픈) 과 5.5(점)는 같은 버전 → 등급 순
    expect(orderModels(["claude-sonnet-5.5", "claude-opus-5-5"])).toEqual(["claude-opus-5-5", "claude-sonnet-5.5"]);
    expect(orderModels(["gpt-6.0-sol", "gpt-6-astra"])).toEqual(["gpt-6-astra", "gpt-6.0-sol"]);
  });

  it("날짜 꼬리는 버전이 아니다", () => {
    expect(orderModels(["claude-opus-4-20250514", "claude-opus-4-1-20250805"])).toEqual([
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
    ]);
  });

  it("별칭(버전 없음)은 버전 있는 것보다 앞 — 별칭끼리는 등급 순", () => {
    expect(orderModels(["claude-opus-5-5", "sonnet", "opus", "claude-fable-1", "claude-haiku-6"])).toEqual([
      "opus",
      "sonnet",
      "claude-haiku-6",
      "claude-opus-5-5",
      "claude-fable-1",
    ]);
  });

  it("가족이 섞이면 가족 먼저(Claude 앞) — 그 안에서 별칭 → 버전 → 등급", () => {
    expect(orderModels(["gpt-6.1-sol", "claude-opus-5", "gpt-7-luna", "haiku", "claude-sonnet-5-5"])).toEqual([
      "haiku",
      "claude-sonnet-5-5",
      "claude-opus-5",
      "gpt-7-luna",
      "gpt-6.1-sol",
    ]);
  });

  it("모르는 것은 뒤에 원래 순서", () => {
    expect(orderModels(["gpt-reserve", "gpt-6-luna", "codex-auto-review", "default", "gpt-6.1-sol"])).toEqual([
      "gpt-6.1-sol",
      "gpt-6-luna",
      "gpt-reserve",
      "codex-auto-review",
      "default",
    ]);
  });

  it("고정 순서 — 고른 값이어도 맨 위로 올리지 않는다(모르는 이름은 뒤 그대로)", () => {
    expect(orderModels(["sonnet", "fable", "opus"])).toEqual(["fable", "opus", "sonnet"]);
    expect(orderModels(["gpt-reserve", "gpt-6.1-sol", "gpt-6-luna"])).toEqual(["gpt-6.1-sol", "gpt-6-luna", "gpt-reserve"]);
  });

  it("목록을 더하거나 입력을 바꾸지 않는다", () => {
    const input = ["haiku", "opus"];
    expect(orderModels(input)).toEqual(["opus", "haiku"]);
    expect(input).toEqual(["haiku", "opus"]);
  });

  it("꼬리 괄호는 순서에 무관 — 같은 자리면 원래 순서", () => {
    expect(orderModels(["sonnet", "opus[1m]", "opus"])).toEqual(["opus[1m]", "opus", "sonnet"]);
  });
});

describe("modelLabel — 앱의 모든 자리의 모델 표시 글자", () => {
  it("Claude 별칭 — 첫 글자 대문자", () => {
    expect(["opus", "fable", "sonnet", "haiku"].map(modelLabel)).toEqual(["Opus", "Fable", "Sonnet", "Haiku"]);
  });

  it("Claude 전체 id — 등급 + 버전(하이픈 → 점) · 날짜 꼬리 · 꼬리 괄호 버림", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelLabel("claude-opus-4-20250514")).toBe("Opus 4");
    expect(modelLabel("claude-haiku-5")).toBe("Haiku 5");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(modelLabel("claude-fable")).toBe("Fable");
    expect(modelLabel("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
    expect(modelLabel(" claude-opus-5-5 ")).toBe("Opus 5.5");
  });

  it("Codex — 머리 gpt 는 GPT, 알파벳 낱말마다 첫 글자 대문자, 숫자 낱말은 그대로", () => {
    expect(modelLabel("gpt-6.1-sol")).toBe("GPT-6.1-Sol");
    expect(modelLabel("gpt-6-astra")).toBe("GPT-6-Astra");
    expect(modelLabel("gpt-6.1-luna")).toBe("GPT-6.1-Luna");
    expect(modelLabel("gpt-reserve")).toBe("GPT-Reserve");
    expect(modelLabel("codex-auto-review")).toBe("Codex-Auto-Review");
  });

  it("모르는 이름 · 직접 입력 · 빈 값 — 같은 낱말 규칙(나머지 글자는 그대로)", () => {
    expect(modelLabel("default")).toBe("Default");
    expect(modelLabel("gpteam-x")).toBe("Gpteam-X");
    expect(modelLabel("My-model")).toBe("My-Model");
    expect(modelLabel("myModel-xL")).toBe("MyModel-XL");
    expect(modelLabel("claude-")).toBe("Claude-");
    expect(modelLabel("")).toBe("");
    expect(modelLabel("  ")).toBe("");
  });
});

describe("effortLabel", () => {
  it("첫 글자만 대문자 · 빈 값은 빈 글", () => {
    expect(["low", "high", "xhigh", "max"].map(effortLabel)).toEqual(["Low", "High", "Xhigh", "Max"]);
    expect(effortLabel("")).toBe("");
  });
});
