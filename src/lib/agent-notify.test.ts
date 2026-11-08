import { describe, expect, it } from "vitest";
import { agentNotifyKind, agentNotifyMessage, agentStopMessage, shouldNotifyAgentStop } from "$lib/agent-notify";
import type { Tr } from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";

/**
 * Claude Code 턴 끝 알림의 판정 (docs/log/2026-09-25-agent-stop-notify.md).
 * 순수 모듈이라 그대로 돈다 — 토스트도 OS 알림도 여기 없다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

/** 턴 길이 규칙을 쓰지 않는 칸의 기본 — 짧은 턴 · 임계 60초 */
const SHORT = { turnMs: 5_000, focusedAfterMs: 60_000 };

describe("shouldNotifyAgentStop — 표 하나", () => {
  it("꺼 두었으면 어디서든 조용하다 (긴 턴이어도)", () => {
    for (const windowFocused of [true, false])
      for (const focusedTile of [true, false])
        for (const turnMs of [null, 5_000, 600_000])
          expect(
            shouldNotifyAgentStop({ enabled: false, windowFocused, focusedTile, turnMs, focusedAfterMs: 60_000 }),
          ).toBe("none");
  });

  it("창을 보고 있고 그 타일에 포커스가 있으면 짧은 턴은 알리지 않는다 — 화면이 이미 말했다", () => {
    expect(shouldNotifyAgentStop({ enabled: true, windowFocused: true, focusedTile: true, ...SHORT })).toBe("none");
  });

  it("창을 보고 있지만 다른 타일·탭이면 토스트(배너) — 턴 길이와 무관", () => {
    expect(shouldNotifyAgentStop({ enabled: true, windowFocused: true, focusedTile: false, ...SHORT })).toBe("toast");
    expect(
      shouldNotifyAgentStop({ enabled: true, windowFocused: true, focusedTile: false, turnMs: null, focusedAfterMs: 0 }),
    ).toBe("toast");
  });

  it("창이 앞에 없으면 타일과 무관하게 OS 알림", () => {
    expect(shouldNotifyAgentStop({ enabled: true, windowFocused: false, focusedTile: true, ...SHORT })).toBe("os");
    expect(shouldNotifyAgentStop({ enabled: true, windowFocused: false, focusedTile: false, ...SHORT })).toBe("os");
    expect(
      shouldNotifyAgentStop({ enabled: true, windowFocused: false, focusedTile: true, turnMs: 600_000, focusedAfterMs: 60_000 }),
    ).toBe("os");
  });
});

describe("shouldNotifyAgentStop — 보고 있는 타일도, 턴이 길었으면 (docs/log/2026-09-27-agent-banners.md)", () => {
  const focused = { enabled: true, windowFocused: true, focusedTile: true } as const;

  it("임계 이상이면 focused — 경계값 포함", () => {
    expect(shouldNotifyAgentStop({ ...focused, turnMs: 60_000, focusedAfterMs: 60_000 })).toBe("focused");
    expect(shouldNotifyAgentStop({ ...focused, turnMs: 14 * 60_000, focusedAfterMs: 60_000 })).toBe("focused");
  });

  it("임계 바로 아래는 조용하다", () => {
    expect(shouldNotifyAgentStop({ ...focused, turnMs: 59_999, focusedAfterMs: 60_000 })).toBe("none");
  });

  it("임계 0 = 끔 — 아무리 길어도 옛 동작", () => {
    expect(shouldNotifyAgentStop({ ...focused, turnMs: 3_600_000, focusedAfterMs: 0 })).toBe("none");
    expect(shouldNotifyAgentStop({ ...focused, turnMs: 3_600_000, focusedAfterMs: -1 })).toBe("none");
  });

  it("턴 시작을 못 봤으면(null) 알리지 않는다 — 길었는지 모른다", () => {
    expect(shouldNotifyAgentStop({ ...focused, turnMs: null, focusedAfterMs: 60_000 })).toBe("none");
  });

  it("꺼 두었으면 focused 도 없다", () => {
    expect(shouldNotifyAgentStop({ ...focused, enabled: false, turnMs: 600_000, focusedAfterMs: 60_000 })).toBe("none");
  });
});

describe("agentStopMessage — 사전을 거친다", () => {
  it("한국어: 본문은 이름 없이, 토스트는 이름을 앞에", () => {
    const m = agentStopMessage("aynx · feat-y", ko, "Claude Code");
    expect(m.body).toBe("Claude Code 작업이 끝났습니다");
    expect(m.toast).toBe("aynx · feat-y — Claude Code 작업이 끝났습니다");
  });

  it("영어도 같은 모양", () => {
    const m = agentStopMessage("aynx · feat-y", en, "Claude Code");
    expect(m.body).toBe("Claude Code finished its turn");
    expect(m.toast).toBe("aynx · feat-y — Claude Code finished its turn");
  });
});

describe("agentNotifyKind — 턴 끝과 권한 물음만 알린다 (docs/log/2026-09-25-shell-claude-signals.md)", () => {
  it("stop 은 범주와 무관하게 턴 끝", () => {
    expect(agentNotifyKind("stop", null)).toBe("stop");
    expect(agentNotifyKind("stop", undefined)).toBe("stop");
  });

  it("waiting 은 범주가 permission 일 때만", () => {
    expect(agentNotifyKind("waiting", "permission")).toBe("permission");
    expect(agentNotifyKind("waiting", "idle")).toBeNull();
    expect(agentNotifyKind("waiting", "other")).toBeNull();
    // 옛 훅 스크립트(1판)는 범주를 싣지 않는다 — 예전처럼 알리지 않는다.
    expect(agentNotifyKind("waiting", null)).toBeNull();
    expect(agentNotifyKind("waiting", undefined)).toBeNull();
    expect(agentNotifyKind("waiting", "Permission")).toBeNull();
  });

  it("실행 신호는 알리지 않는다", () => {
    for (const ev of ["start", "tool", "tool-done"]) expect(agentNotifyKind(ev, "permission")).toBeNull();
    expect(agentNotifyKind("bogus", "permission")).toBeNull();
  });
});

describe("agentNotifyMessage — 종류별 문구", () => {
  it("권한 물음: 한국어·영어", () => {
    const k = agentNotifyMessage("permission", "aynx · feat-y", ko, "Claude Code");
    expect(k.body).toBe("Claude Code 가 권한을 묻고 있습니다");
    expect(k.toast).toBe("aynx · feat-y — Claude Code 가 권한을 묻고 있습니다");
    const e = agentNotifyMessage("permission", "aynx · feat-y", en, "Claude Code");
    expect(e.body).toBe("Claude Code is asking for permission");
    expect(e.toast).toBe("aynx · feat-y — Claude Code is asking for permission");
  });

  it("턴 끝은 agentStopMessage 와 같다", () => {
    expect(agentNotifyMessage("stop", "x", ko, "Codex")).toEqual(agentStopMessage("x", ko, "Codex"));
  });

  it("에이전트 이름이 문구에 들어간다 — Codex · 모르면 일반 이름 (docs/log/2026-09-26-codex-hooks.md)", () => {
    expect(agentNotifyMessage("permission", "x", ko, "Codex").body).toBe("Codex 가 권한을 묻고 있습니다");
    expect(agentNotifyMessage("stop", "x", en, "Codex").toast).toBe("x — Codex finished its turn");
    expect(agentNotifyMessage("stop", "x", ko).body).toBe("AI 에이전트 작업이 끝났습니다");
    expect(agentNotifyMessage("stop", "x", en, null).body).toBe("The AI agent finished its turn");
  });
});
