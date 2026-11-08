import { describe, expect, it } from "vitest";
import type { AgentStatus } from "$lib/agent-status";
import type { Tr } from "$lib/session";
import type { PaneStatus } from "$lib/shell-integration";
import type { TabSpec } from "$lib/session";
import {
  subagentsLabel,
  tabDot,
  tabDotFacts,
  tabDotInput,
  tabHasUnseen,
  type TabDotInput,
  type TabDotSources,
} from "$lib/tab-dot";
import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";

/** 키를 그대로 돌려주는 번역 — 말풍선의 **순서**만 본다 */
const keyTr: Tr = (key) => key;
const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);
const enTr: Tr = (key, params) => translate("en", key, params);

/** `null` = 살아 있는 AI 타일인데 점이 없다 · `undefined` = AI 타일이 없다 */
const AGENT: (AgentStatus | null | undefined)[] = ["permission", "finished", "running", null, undefined];
const COMMAND: (PaneStatus | undefined)[] = ["fail", "running", "ok", undefined];

/** 우선순위 표 — 이 순서가 곧 계약이다 (tab-dot.ts 머리말 · docs/log/2026-10-01-agent-status-three.md) */
const ORDER = [
  "agent:permission",
  "agent:finished",
  "command:fail",
  "bell",
  "agent:running",
  "command:running",
  "command:ok",
  "activity",
];
type Win = { source: string; state?: string };
const keyOf = (f: Win) => (f.state ? `${f.source}:${f.state}` : f.source);
const rankOf = (f: Win) => ORDER.indexOf(keyOf(f));

/** 이름을 신경 쓰지 않는 자리의 짧은 입력 — 에이전트 하나 · 명령 타일 하나 */
function input(
  active: boolean,
  agent?: AgentStatus | null,
  command?: PaneStatus,
  activity?: boolean,
): TabDotInput {
  return {
    active,
    agents: agent !== undefined ? [{ name: "Claude Code", state: agent }] : undefined,
    command: command ? { state: command, name: "PowerShell 7", others: 0 } : undefined,
    activity,
  };
}
const winnerOf = (i: TabDotInput) => {
  const w = tabDot(i, keyTr)?.winner;
  return w ? { source: w.source, ...("state" in w ? { state: w.state } : {}) } : null;
};

describe("tabDot — 우선순위", () => {
  it("안 보는 탭: 에이전트 × 명령 조합마다 표에서 높은 것이 이긴다", () => {
    for (const agent of AGENT) {
      for (const command of COMMAND) {
        const win = winnerOf(input(false, agent, command));
        const candidates: Win[] = [];
        if (agent) candidates.push({ source: "agent", state: agent });
        if (command) candidates.push({ source: "command", state: command });
        if (candidates.length === 0) {
          expect(win, `${agent}/${command}`).toBeNull();
          continue;
        }
        const best = candidates.reduce((a, b) => (rankOf(a) <= rankOf(b) ? a : b));
        expect(win, `${agent}/${command}`).toEqual(best);
      }
    }
  });

  it("대표 조합", () => {
    expect(winnerOf(input(false, "permission", "fail"))).toEqual({ source: "agent", state: "permission" });
    expect(winnerOf(input(false, "finished", "fail"))).toEqual({ source: "agent", state: "finished" });
    expect(winnerOf(input(false, "running", "fail"))).toEqual({ source: "command", state: "fail" });
    expect(winnerOf(input(false, "running", "running"))).toEqual({ source: "agent", state: "running" });
    expect(winnerOf(input(false, null, "ok"))).toEqual({ source: "command", state: "ok" });
  });

  it("에이전트가 여럿이면 가장 급한 상태가 이긴다 (권한 대기 > 완료 > 실행 중)", () => {
    const i: TabDotInput = {
      active: false,
      agents: [
        { name: "Codex", state: "running" },
        { name: "Claude Code", state: "finished" },
        { name: "Claude Code", state: "permission" },
        { name: "Codex", state: null },
      ],
      command: { state: "fail", name: "PowerShell 7", others: 0 },
    };
    expect(winnerOf(i)).toEqual({ source: "agent", state: "permission" });
  });

  it("활동은 명령 상태가 없고 살아 있는 AI 타일이 없을 때만 사실이다", () => {
    expect(winnerOf(input(false, undefined, undefined, true))).toEqual({ source: "activity" });
    // 점이 없는 AI 타일도 활동을 가린다 — 에이전트 TUI 는 쉬지 않고 다시 그린다
    expect(tabDot(input(false, null, undefined, true), keyTr)).toBeNull();
    expect(tabDotFacts(input(false, undefined, "ok", true)).map(keyOf)).toEqual(["command:ok"]);
    expect(tabDotFacts(input(false, "running", undefined, true)).map(keyOf)).toEqual(["agent:running"]);
  });

  it("아무것도 없으면 점이 없다 — 점이 없는 에이전트(미상 없음)도", () => {
    expect(tabDot(input(false), keyTr)).toBeNull();
    expect(tabDot(input(true), keyTr)).toBeNull();
    expect(tabDot(input(false, null), keyTr)).toBeNull();
    expect(tabDot(input(true, null), keyTr)).toBeNull();
  });
});

describe("tabDot — 활성 탭", () => {
  it("에이전트 상태만 뜬다 (명령·활동은 안 본 결과라 빠진다)", () => {
    expect(tabDotFacts(input(true, "running", "fail", true)).map(keyOf)).toEqual(["agent:running"]);
    expect(tabDot(input(true, undefined, "fail", true), keyTr)).toBeNull();
    expect(tabDot(input(true, null, "ok"), keyTr)).toBeNull();
  });

  it("에이전트 점은 활성 탭에서도 같은 모양이다", () => {
    for (const agent of ["permission", "running"] as const) {
      expect(winnerOf(input(true, agent))).toEqual({ source: "agent", state: agent });
    }
  });
});

describe("tabDot — 말풍선", () => {
  it("사실 전부를 우선순위 순으로 잇는다", () => {
    expect(tabDot(input(false, "running", "fail"), keyTr)?.label).toBe(
      "app.tabs.dot.command.fail · app.tabs.dot.agent.running",
    );
    expect(tabDot(input(false, "permission", "ok"), keyTr)?.label).toBe(
      "app.tabs.dot.agent.permission · app.tabs.dot.command.ok",
    );
    expect(tabDot(input(false, undefined, undefined, true), keyTr)?.label).toBe("app.tabs.activity.title");
  });

  it("활성 탭은 에이전트 사실뿐", () => {
    expect(tabDot(input(true, "permission", "ok"), keyTr)?.label).toBe("app.tabs.dot.agent.permission");
  });

  it("실제 문구 — 세 상태 (ko)", () => {
    expect(tabDot(input(false, "permission", "fail"), koTr)?.label).toBe(
      "Claude Code 권한 대기 · PowerShell 7 명령 실패",
    );
    expect(tabDot(input(true, "running"), koTr)?.label).toBe("Claude Code 실행 중");
    expect(tabDot(input(false, "finished"), koTr)?.label).toBe("Claude Code 완료");
  });

  it("실제 문구 (en)", () => {
    expect(tabDot(input(false, "permission", "fail"), enTr)?.label).toBe(
      "Claude Code waiting for permission · PowerShell 7 command failed",
    );
    expect(tabDot(input(false, "finished"), enTr)?.label).toBe("Claude Code finished");
  });

  it("같은 에이전트 둘이 같은 상태면 ×2, 상태가 다르면 따로 선다", () => {
    const i: TabDotInput = {
      active: false,
      agents: [
        { name: "Claude Code", state: "permission" },
        { name: "Codex", state: "running" },
        { name: "Claude Code", state: "permission" },
        { name: "Claude Code", state: "finished" },
        { name: "Codex", state: null },
      ],
    };
    expect(tabDot(i, koTr)?.label).toBe("Claude Code ×2 권한 대기 · Claude Code 완료 · Codex 실행 중");
  });

  it("다른 타일에도 결과가 있으면 '외 N'", () => {
    const i: TabDotInput = { active: false, command: { state: "fail", name: "web-01", others: 2 } };
    expect(tabDot(i, koTr)?.label).toBe("web-01 외 2 명령 실패");
    expect(tabDot(i, enTr)?.label).toBe("web-01 +2 command failed");
  });
});

describe("tabHasUnseen — 탭 배경 강조", () => {
  it("안 보는 탭에 완료가 하나라도 있을 때만", () => {
    expect(tabHasUnseen({ active: false, agents: [{ name: "Claude Code", state: "finished" }] })).toBe(true);
    expect(tabHasUnseen({ active: true, agents: [{ name: "Claude Code", state: "finished" }] })).toBe(false);
    expect(tabHasUnseen({ active: false, agents: [{ name: "Claude Code", state: "permission" }] })).toBe(false);
    expect(tabHasUnseen({ active: false, agents: [{ name: "Claude Code", state: null }] })).toBe(false);
    expect(tabHasUnseen({ active: false })).toBe(false);
  });
});

describe("tabDot — 진행 중 서브 에이전트 (docs/log/2026-10-04-subagent-signals.md)", () => {
  it("이긴 에이전트 사실이 수를 들고, 말풍선이 '서브 에이전트 N개 진행 중' 을 덧붙인다", () => {
    const i: TabDotInput = { active: false, agents: [{ name: "Claude Code", state: "running", subagents: 2 }] };
    const dot = tabDot(i, koTr);
    expect(dot?.winner).toMatchObject({ source: "agent", state: "running", subagents: 2 });
    expect(dot?.label).toBe("Claude Code 실행 중 (서브 에이전트 2개 진행 중)");
    expect(tabDot(i, enTr)?.label).toBe("Claude Code running (2 subagents running)");
  });

  it("같은 사실로 묶인 타일들의 수를 더하고, 수가 없으면 예전 말풍선 그대로", () => {
    const i: TabDotInput = {
      active: true,
      agents: [
        { name: "Claude Code", state: "running", subagents: 1 },
        { name: "Claude Code", state: "running", subagents: 2 },
        { name: "Codex", state: "permission" },
      ],
    };
    const facts = tabDotFacts(i);
    expect(facts.map((f) => (f.source === "agent" ? [f.name, f.state, f.subagents] : null))).toEqual([
      ["Codex", "permission", 0],
      ["Claude Code", "running", 3],
    ]);
    expect(tabDot(i, koTr)?.label).toBe("Codex 권한 대기 · Claude Code ×2 실행 중 (서브 에이전트 3개 진행 중)");
  });

  it("하나일 때는 단수 문구", () => {
    expect(subagentsLabel(1, koTr)).toBe("서브 에이전트 1개 진행 중");
    expect(subagentsLabel(1, enTr)).toBe("1 subagent running");
    expect(subagentsLabel(4, enTr)).toBe("4 subagents running");
  });
});

describe("tabDot — 벨 (docs/log/2026-11-03-tab-status-glyphs.md)", () => {
  it("벨은 명령 실패 아래 · 에이전트 실행 중 위", () => {
    const bell = (i: TabDotInput): TabDotInput => ({ ...i, bell: true });
    expect(winnerOf(bell(input(false, "running", "fail")))).toEqual({ source: "command", state: "fail" });
    expect(winnerOf(bell(input(false, "running", "running")))).toEqual({ source: "bell" });
    expect(winnerOf(bell(input(false, "finished")))).toEqual({ source: "agent", state: "finished" });
    expect(winnerOf(bell(input(false, undefined, "ok", true)))).toEqual({ source: "bell" });
    expect(tabDotFacts(bell(input(false, "running", "fail"))).map(keyOf)).toEqual([
      "command:fail",
      "bell",
      "agent:running",
    ]);
    expect(tabDot(bell(input(false)), koTr)?.label).toBe("벨이 울렸습니다");
  });

  it("활성 탭에서는 벨이 사실이 아니다", () => {
    expect(tabDot({ active: true, bell: true }, keyTr)).toBeNull();
    expect(tabDotFacts({ active: true, bell: true, agents: [{ name: "Claude Code", state: "running" }] }).map(keyOf)).toEqual([
      "agent:running",
    ]);
  });
});

describe("tabDot — 에이전트 사실의 패널 (탭 앞자리 아이콘)", () => {
  it("묶인 사실은 화면 순서로 첫 타일의 패널 id 를 든다", () => {
    const i: TabDotInput = {
      active: false,
      agents: [
        { name: "Codex", state: "running", paneId: "p1" },
        { name: "Claude Code", state: "permission", paneId: "p2" },
        { name: "Claude Code", state: "permission", paneId: "p3" },
      ],
    };
    expect(tabDot(i, keyTr)?.winner).toMatchObject({ source: "agent", state: "permission", count: 2, paneId: "p2" });
    expect(tabDotFacts(i).map((f) => (f.source === "agent" ? f.paneId : null))).toEqual(["p2", "p1"]);
  });
});

describe("tabDotInput — 탭 줄과 세션 판이 함께 쓰는 입력", () => {
  const tab = {
    id: "t1",
    root: { type: "leaf", pane: { id: "p1", kind: "local" } },
  } as Pick<TabSpec, "id" | "root">;
  const sources = (over: Partial<TabDotSources> = {}): TabDotSources => ({
    activeId: null,
    agents: {},
    status: {},
    bells: {},
    activity: {},
    paneName: (pane) => `이름:${pane.id}`,
    ...over,
  });

  it("탭 id 의 표들을 모으고 명령은 그 값을 정한 타일의 이름으로", () => {
    const agents = [{ name: "Claude Code", state: "running" as const }];
    expect(
      tabDotInput(
        tab,
        sources({
          activeId: "t1",
          agents: { t1: agents },
          status: { t1: { state: "fail", paneId: "p1", others: 2 } },
          bells: { t1: true },
          activity: { t1: true },
        }),
      ),
    ).toEqual({ active: true, agents, command: { state: "fail", name: "이름:p1", others: 2 }, bell: true, activity: true });
  });

  it("표에 없는 탭은 사실이 없고 · 트리에 없는 타일은 이름을 비운다", () => {
    expect(tabDot(tabDotInput(tab, sources()), keyTr)).toBeNull();
    const gone = tabDotInput(tab, sources({ status: { t1: { state: "ok", paneId: "gone", others: 0 } } }));
    expect(gone.command).toEqual({ state: "ok", name: "", others: 0 });
  });
});
