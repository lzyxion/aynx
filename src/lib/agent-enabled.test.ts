import { describe, expect, it } from "vitest";
import { agentEnabled, allAgentsDisabled, toggleDisabled, withoutDisabled } from "./agent-enabled";
import { offeredAiClis, type AiCli } from "./session";

const cli = (id: string, installed: boolean): AiCli => ({ id, name: id, command: id, installed });

describe("agent-enabled", () => {
  it("목록에 없으면 쓴다 — 기본은 모두 사용", () => {
    expect(agentEnabled("claude", undefined)).toBe(true);
    expect(agentEnabled("claude", [])).toBe(true);
    expect(agentEnabled("codex", ["codex"])).toBe(false);
  });

  it("withoutDisabled 는 순서를 지키고 끈 것만 뺀다", () => {
    const list = [{ agent: "claude" }, { agent: "codex" }, { agent: "x" }];
    expect(withoutDisabled(list, (l) => l.agent, ["codex"]).map((l) => l.agent)).toEqual(["claude", "x"]);
    expect(withoutDisabled(list, (l) => l.agent, null)).toHaveLength(3);
  });

  it("allAgentsDisabled — 아는 에이전트가 모두 꺼졌을 때만", () => {
    expect(allAgentsDisabled(["codex"])).toBe(false);
    expect(allAgentsDisabled(["codex", "claude"])).toBe(true);
    expect(allAgentsDisabled([])).toBe(false);
  });

  it("toggleDisabled — 더하고 빼며 아는 순서로 정렬, 모르는 id 는 뒤에 남긴다", () => {
    expect(toggleDisabled(undefined, "codex", false)).toEqual(["codex"]);
    expect(toggleDisabled(["codex"], "claude", false)).toEqual(["claude", "codex"]);
    expect(toggleDisabled(["gemini", "codex"], "claude", false)).toEqual(["claude", "codex", "gemini"]);
    expect(toggleDisabled(["codex"], "codex", true)).toEqual([]);
    expect(toggleDisabled(["codex"], "codex", false)).toEqual(["codex"]);
  });
});

describe("offeredAiClis + 끈 에이전트", () => {
  it("설치된 것 중 끈 것을 뺀다", () => {
    const clis = [cli("claude", true), cli("codex", true)];
    expect(offeredAiClis(clis, ["codex"]).map((c) => c.id)).toEqual(["claude"]);
    expect(offeredAiClis(clis).map((c) => c.id)).toEqual(["claude", "codex"]);
  });

  it("감지가 비었을 때의 claude 폴백도 끄면 사라진다 · 모두 끄면 빈 목록", () => {
    expect(offeredAiClis([], []).map((c) => c.id)).toEqual(["claude"]);
    expect(offeredAiClis([], ["claude"])).toEqual([]);
    expect(offeredAiClis([cli("claude", true), cli("codex", true)], ["claude", "codex"])).toEqual([]);
  });

  it("설치된 것을 모두 껐으면 폴백하지 않는다(빈 목록)", () => {
    expect(offeredAiClis([cli("claude", false), cli("codex", true)], ["codex"])).toEqual([]);
  });

  it("감지는 됐는데 하나도 안 깔렸으면 빈 목록(폴백은 감지 실패 — 빈 목록 — 때만 · 2026-11-03)", () => {
    expect(offeredAiClis([cli("claude", false), cli("codex", false)])).toEqual([]);
    expect(offeredAiClis([cli("claude", false), cli("codex", true)]).map((c) => c.id)).toEqual(["codex"]);
  });
});
