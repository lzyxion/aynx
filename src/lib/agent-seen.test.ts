import { describe, expect, it } from "vitest";
import { emptyAgentSignals } from "$lib/agent-status";
import { noteEnded, parseAgentSeen, parseSideChatSeen, seenApplies, shouldSend, sideChatSeenApplies, turnEnded, watching } from "$lib/agent-seen";

const base = { visible: true, watching: true, handheld: false, mark: { seq: 5, gen: 1 }, gen: 2, sent: undefined };

describe("turnEnded", () => {
  it("턴 끝만 — 실행 · 권한 · 신호 없음 · 끝난 세션은 아니다", () => {
    expect(turnEnded(null)).toBe(false);
    expect(turnEnded(emptyAgentSignals())).toBe(false);
    expect(turnEnded({ ...emptyAgentSignals(), signalStopAt: 10 })).toBe(true);
    expect(turnEnded({ ...emptyAgentSignals(), signalStopAt: 10, signalRunningAt: 20 })).toBe(false);
    expect(turnEnded({ ...emptyAgentSignals(), signalStopAt: 10, signalPermissionAt: 20 })).toBe(false);
    expect(turnEnded({ ...emptyAgentSignals(), signalStopAt: 10, exitedAt: 20 })).toBe(false);
  });

  it("서브 에이전트가 도는 동안의 끝은 끝이 아니다", () => {
    expect(turnEnded({ ...emptyAgentSignals(), signalStopAt: 10, subagents: ["a"] })).toBe(false);
  });
});

describe("noteEnded", () => {
  it("같은 턴이면 처음 안 때를 지키고 새 턴이면 지금 번호로", () => {
    const first = noteEnded(undefined, 5, 1);
    expect(first).toEqual({ seq: 5, gen: 1 });
    expect(noteEnded(first, 5, 9)).toBe(first);
    expect(noteEnded(first, 6, 9)).toEqual({ seq: 6, gen: 9 });
  });
});

describe("watching", () => {
  const on = { veil: false, pageShown: true, handheld: false, focused: true };
  it("가림막 · 숨은 페이지는 어느 창이든 아니다", () => {
    expect(watching({ ...on, veil: true })).toBe(false);
    expect(watching({ ...on, handheld: true, pageShown: false })).toBe(false);
  });
  it("넓은 창은 포커스까지 · 폰은 페이지가 보이면", () => {
    expect(watching(on)).toBe(true);
    expect(watching({ ...on, focused: false })).toBe(false);
    expect(watching({ ...on, focused: false, handheld: true })).toBe(true);
  });
});

describe("shouldSend", () => {
  it("넓은 창은 그 턴이 끝난 뒤의 입력이 있어야 한다 — 자리를 비운 채 앞에 있는 창이 폰의 완료를 지우지 않게", () => {
    expect(shouldSend(base)).toBe(true);
    expect(shouldSend({ ...base, gen: 1 })).toBe(false);
  });
  it("폰은 입력을 묻지 않는다", () => {
    expect(shouldSend({ ...base, gen: 1, handheld: true })).toBe(true);
  });
  it("안 보이거나 · 안 보고 있거나 · 이미 알린 턴이면 보내지 않는다", () => {
    expect(shouldSend({ ...base, visible: false })).toBe(false);
    expect(shouldSend({ ...base, watching: false })).toBe(false);
    expect(shouldSend({ ...base, sent: 5 })).toBe(false);
    expect(shouldSend({ ...base, sent: 4 })).toBe(true);
  });
});

describe("parseSideChatSeen · sideChatSeenApplies", () => {
  it("모양이 틀리면 null — 몸은 채팅 id · 세대 · 번호뿐", () => {
    expect(parseSideChatSeen({ chat: "c", epoch: 2, seq: 9 })).toEqual({ chat: "c", epoch: 2, seq: 9 });
    for (const v of [null, "x", {}, { chat: "c", seq: 9 }, { chat: "c", epoch: 2 }, { chat: 1, epoch: 2, seq: 9 }, { chat: "c", epoch: "2", seq: 9 }, { chat: "c", epoch: 2, seq: Infinity }]) {
      expect(parseSideChatSeen(v)).toBeNull();
    }
  });
  it("이 창의 마지막 턴 끝과 같은 세대 · 그 번호 이후의 확인만 푼다", () => {
    const mine = { epoch: 2, seq: 9 };
    expect(sideChatSeenApplies({ epoch: 2, seq: 9 }, mine)).toBe(true);
    expect(sideChatSeenApplies({ epoch: 2, seq: 12 }, mine)).toBe(true);
    // 이 창이 더 늦은 턴 끝을 받았다 — 지난 턴의 확인
    expect(sideChatSeenApplies({ epoch: 2, seq: 8 }, mine)).toBe(false);
    // 다시 떴다 · CLI 를 바꿨다
    expect(sideChatSeenApplies({ epoch: 3, seq: 9 }, mine)).toBe(false);
    // 다음 턴이 섰다(턴 끝 없음) — 풀 것이 없다
    expect(sideChatSeenApplies({ epoch: 2, seq: 9 }, null)).toBe(false);
  });
});

describe("parseAgentSeen · seenApplies", () => {
  it("모양이 틀리면 null", () => {
    expect(parseAgentSeen({ stream: "s", seq: 3 })).toEqual({ stream: "s", seq: 3 });
    for (const v of [null, 1, {}, { stream: "s" }, { seq: 1 }, { stream: 1, seq: 1 }, { stream: "s", seq: "1" }, { stream: "s", seq: NaN }]) {
      expect(parseAgentSeen(v)).toBeNull();
    }
  });
  it("이 창이 더 새 신호를 받았으면 지난 턴의 확인이다", () => {
    expect(seenApplies(5, null)).toBe(true);
    expect(seenApplies(5, 5)).toBe(true);
    expect(seenApplies(6, 5)).toBe(true);
    expect(seenApplies(4, 5)).toBe(false);
  });
});
