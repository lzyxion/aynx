import { describe, expect, it } from "vitest";
import {
  agentPlace,
  agentTime,
  agentTimeLabel,
  agentCardText,
  cardName,
  type AgentTileInput,
} from "$lib/agent-board";
import { emptyAgentSignals, type AgentSignals, type AgentStatus } from "$lib/agent-status";
import type { Project, WorktreeInfo } from "$lib/projects";
import { newLocalPane, newSshPane, type Tr } from "$lib/session";
import { translate } from "$lib/i18n/dict";

const tr: Tr = (key, params) => translate("ko", key, params);
const MIN = 60_000;
const NOW = 1_000 * MIN;

const sig = (over: Partial<AgentSignals> = {}): AgentSignals => ({ ...emptyAgentSignals(), ...over });

const project = (over: Partial<Project> = {}): Project => ({
  id: "L1",
  name: "aynx",
  host: null,
  path: "C:\\src\\proj",
  shell: null,
  agent: "claude", setupScript: "", migration: null,
  tmux: false,
  worktreeDir: null,
  ...over,
});

const wt = (path: string, branch: string | null): WorktreeInfo => ({
  path,
  branch,
  head: "a1",
  bare: false,
  detached: branch === null,
});

let seq = 0;
const tile = (status: AgentStatus | null, over: Partial<AgentTileInput> = {}): AgentTileInput => {
  const n = seq++;
  return {
    paneId: `p${n}`,
    status,
    signals: null,
    turnStartedAt: null,
    place: { project: null, worktree: null },
    tabTitle: `탭 ${n}`,
    ai: "claude",
    ...over,
  };
};

describe("agentPlace — 타일의 프로젝트 · 워크트리", () => {
  const L = project();
  const R = project({ id: "R1", name: "api", host: "dev-01", path: "~/api" });
  const none = () => null;

  it("읽어 둔 워크트리 목록의 줄 → 프로젝트 + 브랜치 (분리된 HEAD 면 폴더 꼬리)", () => {
    const p = newLocalPane("pwsh");
    p.cwd = "C:\\src\\proj-wt\\feat-x";
    const listing = () => [wt("C:/src/proj", "main"), wt("C:/src/proj-wt/feat-x", "feat-x")];
    expect(agentPlace(p, [L], listing, none, "아무 제목")).toEqual({ project: "aynx", worktree: "feat-x" });
    const detached = () => [wt("C:/src/proj-wt/feat-x", null)];
    expect(agentPlace(p, [L], detached, none, "")).toEqual({ project: "aynx", worktree: "feat-x" });
    // 주 폴더도 목록에 있으면 브랜치를 안다
    p.cwd = "C:\\src\\proj";
    expect(agentPlace(p, [L], listing, none, "")).toEqual({ project: "aynx", worktree: "main" });
  });

  it("목록이 없으면 주 폴더 → 프로젝트만 (브랜치를 지어내지 않는다)", () => {
    const p = newLocalPane("pwsh");
    p.cwd = "c:/src/proj/";
    expect(agentPlace(p, [L], none, none, "")).toEqual({ project: "aynx", worktree: null });
  });

  it("탭 제목이 `<프로젝트> · <이름>` 이고 같은 자리면 그 둘 — 로컬 ↔ 로컬 타일, 원격 ↔ 같은 별칭", () => {
    const p = newLocalPane("pwsh");
    p.cwd = "C:\\src\\proj-wt\\feat-y";
    expect(agentPlace(p, [L, R], none, none, "aynx · feat-y")).toEqual({ project: "aynx", worktree: "feat-y" });
    // 로컬 타일은 원격 프로젝트 이름과 맞대지 않는다
    expect(agentPlace(p, [L, R], none, none, "api · fix")).toEqual({ project: null, worktree: null });
    const s = newSshPane("dev-01");
    s.cwd = "~/api-wt/fix";
    expect(agentPlace(s, [L, R], none, none, "api · fix")).toEqual({ project: "api", worktree: "fix" });
    // 이름만 있고 뒤가 비었으면 아니다
    expect(agentPlace(p, [L], none, none, "aynx · ")).toEqual({ project: null, worktree: null });
  });

  it("원격은 그 서버의 홈으로 `~` 를 펴서 맞댄다", () => {
    const s = newSshPane("dev-01");
    s.cwd = "~/api";
    const listing = (id: string) => (id === "R1" ? [wt("/root/api", "main")] : null);
    expect(agentPlace(s, [R], listing, () => "/root", "")).toEqual({ project: "api", worktree: "main" });
  });

  it("어느 것도 아니면 모른다", () => {
    const p = newLocalPane("pwsh");
    p.cwd = "D:\\elsewhere";
    expect(agentPlace(p, [L], none, none, "탭 3")).toEqual({ project: null, worktree: null });
  });
});

describe("agentTime — 상태마다 고르는 시각 (훅 신호만)", () => {
  it("권한 대기 — 권한을 물은 시각", () => {
    expect(agentTime("permission", sig({ signalPermissionAt: 5, signalRunningAt: 3 }), null)).toEqual({ kind: "asked", at: 5 });
  });

  it("실행 중 — 턴 시작은 훅 실행 신호가 그 뒤에 있을 때만, 아니면 마지막 실행 신호", () => {
    expect(agentTime("running", sig({ signalRunningAt: 20 }), 10)).toEqual({ kind: "turn", at: 10 });
    expect(agentTime("running", sig({ signalRunningAt: 5 }), 10)).toEqual({ kind: "active", at: 5 });
    expect(agentTime("running", sig({ signalRunningAt: 5 }), null)).toEqual({ kind: "active", at: 5 });
    expect(agentTime("running", sig(), null)).toBeNull();
  });

  it("완료 · 점 없음 — 마지막 턴이 끝난 시각, 모르면 null", () => {
    expect(agentTime("finished", sig({ signalStopAt: 9 }), null)).toEqual({ kind: "ended", at: 9 });
    expect(agentTime(null, sig({ signalStopAt: 8 }), null)).toEqual({ kind: "ended", at: 8 });
    expect(agentTime(null, sig({ signalRunningAt: 8 }), null)).toBeNull();
    expect(agentTime(null, null, null)).toBeNull();
  });

  it("사람 말", () => {
    expect(agentTimeLabel({ kind: "asked", at: NOW - 3 * MIN }, NOW, tr)).toBe("권한 물음 3분 전");
    expect(agentTimeLabel({ kind: "turn", at: NOW - 14 * MIN }, NOW, tr)).toBe("14분째");
    expect(agentTimeLabel({ kind: "turn", at: NOW - 10_000 }, NOW, tr)).toBe("방금 시작");
    expect(agentTimeLabel({ kind: "turn", at: NOW - 130 * MIN }, NOW, tr)).toBe("2시간째");
    expect(agentTimeLabel({ kind: "ended", at: NOW - 41 * MIN }, NOW, tr)).toBe("41분 전");
    expect(agentTimeLabel({ kind: "active", at: NOW - 5 * MIN }, NOW, tr)).toBe("마지막 신호 5분 전");
    expect(agentTimeLabel(null, NOW, tr)).toBe("");
  });
});

describe("agentCardText — AI 카드의 글자", () => {
  it("프로젝트면 제목 + 워크트리, 아니면 탭 제목뿐 (지어내지 않는다)", () => {
    const a = tile("running", { place: { project: "aynx", worktree: "feat-y" }, tabTitle: "aynx · feat-y" });
    const b = tile(null, { tabTitle: "탭 7" });
    const c = tile(null, { tabTitle: "  " });
    expect([a, b, c].map((x) => [agentCardText(x).title, agentCardText(x).sub])).toEqual([
      ["aynx", "feat-y"],
      ["탭 7", null],
      ["?", null],
    ]);
  });

  it("시각은 상태에 맞는 하나 — agentTime 과 같다", () => {
    const w = tile("permission", { signals: sig({ signalPermissionAt: NOW - 3 * MIN }) });
    expect(agentCardText(w).time).toEqual({ kind: "asked", at: NOW - 3 * MIN });
  });

  it("두 줄을 한 줄로", () => {
    expect(cardName("aynx", "feat-y")).toBe("aynx · feat-y");
    expect(cardName("aynx", null)).toBe("aynx");
  });
});
