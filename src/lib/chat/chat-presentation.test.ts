import { describe, expect, it } from "vitest";
import type { SideChat } from "$lib/side-chat";
import { mostUrgentDot, targetOf } from "./chat-presentation";

const CONV = "11111111-2222-4333-8444-555555555555";
const FORK = "66666666-7777-4888-9999-aaaaaaaaaaaa";

function chat(over: Partial<SideChat> = {}): SideChat {
  return {
    id: "c1",
    cli: "claude",
    model: "",
    effort: "",
    title: "",
    createdAt: 1,
    usedAt: 1,
    links: {},
    tile: null,
    forkedFrom: null,
    ...over,
  } as SideChat;
}

describe("targetOf", () => {
  it("저장 모양을 붙을 뜻으로 — 그 CLI 의 대화 id · 연결 타일 스트림", () => {
    const t = targetOf(chat({ model: "opus", effort: "high", links: { claude: CONV }, tile: { stream: "s-1", name: "셸" } }));
    expect(t).toEqual({ id: "c1", cli: "claude", model: "opus", effort: "high", conversation: CONV, fork: null, link: "s-1" });
  });

  it("다른 CLI · 모델로 물으면 그 CLI 의 대화(없으면 null) · 갈라 올 원본은 그 CLI 가 원본의 에이전트일 때만", () => {
    const c = chat({ links: { claude: CONV }, forkedFrom: { agent: "codex", conv: FORK } });
    expect(targetOf(c, "codex", "")).toMatchObject({ cli: "codex", model: "", conversation: null, fork: FORK });
    expect(targetOf(c)).toMatchObject({ cli: "claude", conversation: CONV, fork: null });
  });

  it("세션 서버가 모르는 CLI 는 claude 로", () => {
    expect(targetOf(chat({ cli: "gemini" })).cli).toBe("claude");
  });
});

describe("mostUrgentDot", () => {
  it("권한 > 새 답 > 답하는 중 > 없음", () => {
    expect(mostUrgentDot(["running", "finished", "permission"])).toBe("permission");
    expect(mostUrgentDot(["running", null, "finished"])).toBe("finished");
    expect(mostUrgentDot([null, "running"])).toBe("running");
    expect(mostUrgentDot([null])).toBe(null);
    expect(mostUrgentDot([])).toBe(null);
  });
});
