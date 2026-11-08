import { describe, expect, it } from "vitest";
import {
  acceptSeq,
  admitHookSignal,
  AGENT_SIGNAL_TTL_MS,
  agentStatus,
  emptyAgentSignals,
  foldAgentStatus,
  forgetHook,
  hasHookMaterial,
  hookSignalKey,
  isHookSignalEvent,
  lastHookSignal,
  parseAgentStatesSnapshot,
  parseAgentStateWire,
  signalCli,
  signalsFromWire,
  stepHookSignal,
  subagentCount,
  type AgentSignals,
} from "$lib/agent-status";

// 점 셋 — 훅 신호만으로 (docs/log/2026-10-01-agent-status-three.md)
const sig = (over: Partial<AgentSignals> = {}): AgentSignals => ({ ...emptyAgentSignals(), ...over });

describe("agentStatus — 훅 신호만", () => {
  it("훅 신호가 없으면 점이 없다(미상은 없다)", () => {
    expect(agentStatus(sig(), 1_000, false)).toBeNull();
    expect(agentStatus(sig(), 1_000, true)).toBeNull();
  });

  it("실행 신호가 가장 늦으면 실행 중 — 10분이 지나면 점이 없다", () => {
    const s = sig({ signalRunningAt: 1_000 });
    expect(agentStatus(s, 1_000, false)).toBe("running");
    expect(agentStatus(s, 1_000 + AGENT_SIGNAL_TTL_MS - 1, false)).toBe("running");
    expect(agentStatus(s, 1_000 + AGENT_SIGNAL_TTL_MS, false)).toBeNull();
  });

  it("권한 신호가 가장 늦으면 권한 대기 — 시효가 없다", () => {
    const s = sig({ signalRunningAt: 1_000, signalPermissionAt: 2_000 });
    expect(agentStatus(s, 2_000, false)).toBe("permission");
    expect(agentStatus(s, 2_000 + AGENT_SIGNAL_TTL_MS * 10, false)).toBe("permission");
  });

  it("권한 뒤 실행(승인한 도구가 끝남 · 새 도구)이면 다시 실행 중", () => {
    expect(agentStatus(sig({ signalPermissionAt: 1_000, signalRunningAt: 1_500 }), 1_600, false)).toBe("running");
  });

  it("끝 신호가 가장 늦으면 — 안 봤으면 완료, 봤으면 점이 없다", () => {
    const s = sig({ signalRunningAt: 1_000, signalStopAt: 2_000 });
    expect(agentStatus(s, 2_000, true)).toBe("finished");
    expect(agentStatus(s, 2_000, false)).toBeNull();
    // 완료에는 시효가 없다 — 보기 전까지 남는다
    expect(agentStatus(s, 2_000 + AGENT_SIGNAL_TTL_MS * 10, true)).toBe("finished");
  });

  it("끝 뒤에 새 턴이 서면 실행 중 (표식이 남아 있어도)", () => {
    expect(agentStatus(sig({ signalStopAt: 1_000, signalRunningAt: 1_100 }), 1_200, true)).toBe("running");
  });

  it("권한 물음을 거절하면 곧 끝 — 끝이 이긴다", () => {
    const s = sig({ signalPermissionAt: 1_000, signalStopAt: 1_200 });
    expect(agentStatus(s, 1_300, true)).toBe("finished");
    expect(agentStatus(s, 1_300, false)).toBeNull();
  });

  it("세션이 끝나면 무엇이든 점이 없다", () => {
    expect(agentStatus(sig({ exitedAt: 5, signalPermissionAt: 10 }), 20, false)).toBeNull();
    expect(agentStatus(sig({ exitedAt: 5, signalStopAt: 10 }), 20, true)).toBeNull();
    expect(agentStatus(sig({ exitedAt: 5, signalRunningAt: 10 }), 20, false)).toBeNull();
  });
});

describe("lastHookSignal — 같은 시각이면 끝 > 권한 > 실행", () => {
  it("동률", () => {
    expect(lastHookSignal(sig({ signalRunningAt: 5, signalPermissionAt: 5 }))).toBe("permission");
    expect(lastHookSignal(sig({ signalPermissionAt: 5, signalStopAt: 5 }))).toBe("stop");
    expect(lastHookSignal(sig({ signalRunningAt: 5, signalStopAt: 5 }))).toBe("stop");
    expect(lastHookSignal(sig())).toBeNull();
  });
});

describe("hookSignalKey — 훅 이벤트 → 칸", () => {
  it("실행 셋 · 권한(범주 permission 만) · 끝", () => {
    expect(hookSignalKey("start", null)).toBe("signalRunningAt");
    expect(hookSignalKey("tool", null)).toBe("signalRunningAt");
    expect(hookSignalKey("tool-done", null)).toBe("signalRunningAt");
    expect(hookSignalKey("waiting", "permission")).toBe("signalPermissionAt");
    expect(hookSignalKey("stop", null)).toBe("signalStopAt");
  });

  it("waiting 의 idle · other · 범주 없음은 상태를 바꾸지 않는다", () => {
    expect(hookSignalKey("waiting", "idle")).toBeNull();
    expect(hookSignalKey("waiting", "other")).toBeNull();
    expect(hookSignalKey("waiting", null)).toBeNull();
    expect(hookSignalKey("waiting", undefined)).toBeNull();
  });

  it("모르는 이벤트는 버린다", () => {
    expect(hookSignalKey("bogus", "permission")).toBeNull();
    expect(isHookSignalEvent("bogus")).toBe(false);
    expect(isHookSignalEvent("waiting")).toBe(true);
  });

  it("완료 뒤 idle 이 와도 완료 · 안 봄의 수명이 그대로 간다", () => {
    // idle 은 적을 칸이 없다 — 신호가 그대로라 판정도 그대로다
    const s = sig({ signalRunningAt: 1_000, signalStopAt: 2_000 });
    expect(hookSignalKey("waiting", "idle")).toBeNull();
    expect(agentStatus(s, 62_000, true)).toBe("finished");
  });
});

describe("foldAgentStatus — 여럿을 하나로 (권한 대기 > 완료 > 실행 중)", () => {
  it("가장 급한 것", () => {
    expect(foldAgentStatus(["running", "finished", "permission", null])).toBe("permission");
    expect(foldAgentStatus([null, "running", "finished"])).toBe("finished");
    expect(foldAgentStatus(["running", null])).toBe("running");
  });

  it("점이 없는 것뿐이거나 비었으면 null", () => {
    expect(foldAgentStatus([null, null])).toBeNull();
    expect(foldAgentStatus([])).toBeNull();
  });
});

// ── 서브 에이전트 — "메인이 멈췄고 + 진행 중 0개" 가 완료 (docs/log/2026-10-04-subagent-signals.md) ──

type Ev = [event: string, extra?: { detail?: string | null; agent?: string | null }];

/** 신호를 차례로 흘린다 — 시각은 100ms 씩. 마지막 상태와 완료·알림이 선 이벤트 번호(0부터)를 돌려준다 */
function run(events: readonly Ev[], from: AgentSignals = emptyAgentSignals()) {
  let s = from;
  const completed: number[] = [];
  const notified: number[] = [];
  events.forEach(([event, extra], i) => {
    const step = stepHookSignal(s, event, extra?.detail ?? null, extra?.agent ?? null, 1_000 + i * 100);
    s = step.sig;
    if (step.completed) completed.push(i);
    if (step.notify) notified.push(i);
  });
  return { s, completed, notified, at: 1_000 + events.length * 100 };
}

const sub = (event: "subagent-start" | "subagent-stop", agent: string | null): Ev => [event, { agent }];

describe("stepHookSignal — 서브 에이전트 없이는 예전 그대로", () => {
  it("start → tool → stop 이면 stop 에서 완료 · 알림 한 번", () => {
    const r = run([["start"], ["tool"], ["tool-done"], ["stop"]]);
    expect(r.completed).toEqual([3]);
    expect(r.notified).toEqual([3]);
    expect(agentStatus(r.s, r.at, true)).toBe("finished");
    expect(agentStatus(r.s, r.at, false)).toBeNull();
  });

  it("권한 물음 · idle 은 예전 칸 그대로 (idle 은 아무것도 바꾸지 않는다)", () => {
    const base = run([["start"], ["stop"]]).s;
    const idle = stepHookSignal(base, "waiting", "idle", null, 9_000);
    expect(idle.sig).toBe(base);
    const perm = stepHookSignal(base, "waiting", "permission", null, 9_000);
    expect(perm.sig.signalPermissionAt).toBe(9_000);
    expect(perm.completed).toBe(false);
  });

  it("interrupt(사람이 끊음) — 실행이 풀리지만 완료 · 알림은 아니다 · 다음 start 면 다시 실행", () => {
    const r = run([["start"], ["tool"], ["interrupt"]]);
    expect(r.completed).toEqual([]);
    expect(r.notified).toEqual([]);
    expect(isHookSignalEvent("interrupt")).toBe(true);
    expect(agentStatus(r.s, r.at, false)).toBeNull();
    const again = stepHookSignal(r.s, "start", null, null, r.at + 1000);
    expect(agentStatus(again.sig, r.at + 1000, false)).toBe("running");
  });

  it("모르는 이벤트는 그대로 돌려준다", () => {
    const base = emptyAgentSignals();
    expect(stepHookSignal(base, "bogus", null, null, 1).sig).toBe(base);
  });

  it("받은 값을 고치지 않는다(순수)", () => {
    const base = run([["start"], sub("subagent-start", "a")]).s;
    const copy = JSON.parse(JSON.stringify(base));
    stepHookSignal(base, "subagent-stop", null, "a", 99_000);
    stepHookSignal(base, "stop", null, null, 99_000);
    expect(base).toEqual(copy);
  });
});

describe("stepHookSignal — Stop 이 먼저 (백그라운드 서브 에이전트)", () => {
  it("Stop → 서브 2개 진행 중이면 완료가 아니다 → 둘 다 끝나야 완료(서브 에이전트의 끝은 알리지 않는다)", () => {
    const r = run([
      ["start"],
      sub("subagent-start", "a"),
      sub("subagent-start", "b"),
      ["stop"], // 3 — 서브 둘이 아직 돈다
      ["tool"], // 서브의 도구
      sub("subagent-stop", "a"), // 5 — 하나 남음
      sub("subagent-stop", "b"), // 6 — 0개, 메인은 멈춰 있다 → 완료(점만)
    ]);
    expect(r.completed).toEqual([6]);
    expect(r.notified).toEqual([]);
    expect(r.s.subagents).toEqual([]);
    expect(r.s.signalStopAt).toBe(1_000 + 6 * 100); // 완료 시각 = 마지막 서브 에이전트가 끝난 때
    expect(agentStatus(r.s, r.at, true)).toBe("finished");
  });

  it("진행 중이 있는 동안의 점은 실행 중이고 수를 센다", () => {
    const mid = run([["start"], sub("subagent-start", "a"), sub("subagent-start", "b"), ["stop"]]);
    expect(subagentCount(mid.s)).toBe(2);
    expect(agentStatus(mid.s, mid.at, true)).toBe("running");
    expect(agentStatus(mid.s, mid.at, false)).toBe("running");
    const one = run([sub("subagent-stop", "a")], mid.s);
    expect(subagentCount(one.s)).toBe(1);
    expect(one.completed).toEqual([]);
    expect(agentStatus(one.s, one.at, true)).toBe("running");
  });

  it("진행 중의 실행 시효는 서브 에이전트 신호 · 끝 신호까지 넣어 잰다", () => {
    const s = sig({
      signalRunningAt: 1_000,
      signalStopAt: 2_000,
      signalSubagentAt: 5_000,
      subagents: ["a"],
      mainStopped: true,
    });
    expect(agentStatus(s, 5_000 + AGENT_SIGNAL_TTL_MS - 1, false)).toBe("running");
    expect(agentStatus(s, 5_000 + AGENT_SIGNAL_TTL_MS, false)).toBeNull();
  });

  it("서브 에이전트의 권한 물음은 메인의 Stop 보다 앞서도 보인다", () => {
    const r = run([
      ["start"],
      sub("subagent-start", "a"),
      ["waiting", { detail: "permission" }], // 서브가 묻는다
      ["stop"], // 메인은 턴을 끝냈다
    ]);
    expect(agentStatus(r.s, r.at, true)).toBe("permission");
    // 승인 → 그 도구가 끝남 → 실행 중, 서브가 끝나면 완료(알리지 않는다)
    const after = run([["tool-done"], sub("subagent-stop", "a")], r.s);
    expect(after.completed).toEqual([1]);
    expect(after.notified).toEqual([]);
  });
});

describe("stepHookSignal — 서브 에이전트가 먼저 끝남 (포그라운드)", () => {
  it("서브 시작·끝이 메인의 Stop 보다 먼저면 Stop 에서 완료 · 알림 한 번", () => {
    const r = run([
      ["start"],
      ["tool"],
      sub("subagent-start", "a"),
      ["tool"],
      sub("subagent-stop", "a"),
      ["tool-done"],
      ["stop"],
    ]);
    expect(r.completed).toEqual([6]);
    expect(r.notified).toEqual([6]);
  });

  it("메인이 도는 중에 마지막 서브가 끝나면 완료가 아니다", () => {
    const r = run([["start"], sub("subagent-start", "a"), sub("subagent-stop", "a")]);
    expect(r.completed).toEqual([]);
    expect(agentStatus(r.s, r.at, true)).toBe("running");
  });
});

describe("stepHookSignal — 겹침 · 유실 · 중복", () => {
  it("겹친 서브 에이전트 셋 — 순서가 섞여도 마지막에 한 번 완료", () => {
    const r = run([
      ["start"],
      sub("subagent-start", "a"),
      sub("subagent-start", "b"),
      ["stop"],
      sub("subagent-stop", "b"),
      sub("subagent-start", "c"), // 메인이 멈춘 뒤 새 서브(드묾) — 그래도 센다
      sub("subagent-stop", "a"),
      sub("subagent-stop", "c"),
    ]);
    expect(r.completed).toEqual([7]);
    expect(r.notified).toEqual([]);
  });

  it("같은 id 의 시작 두 번은 하나 · 끝 두 번은 한 번만 뺀다(음수가 없다)", () => {
    const r = run([
      ["start"],
      sub("subagent-start", "a"),
      sub("subagent-start", "a"),
      ["stop"],
      sub("subagent-stop", "a"),
      sub("subagent-stop", "a"), // 중복 — 아무것도 바꾸지 않는다
    ]);
    expect(r.s.subagents).toEqual([]);
    expect(r.completed).toEqual([4]);
    expect(r.notified).toEqual([]);
  });

  it("시작을 놓친 끝 · id 없는 신호는 세지 않는다", () => {
    const base = run([["start"], ["stop"]]);
    expect(base.notified).toEqual([1]);
    const lost = stepHookSignal(base.s, "subagent-stop", null, "ghost", 9_000);
    expect(lost.sig).toBe(base.s);
    expect(lost.completed).toBe(false);
    expect(stepHookSignal(base.s, "subagent-start", null, null, 9_000).sig).toBe(base.s);
    expect(stepHookSignal(base.s, "subagent-start", null, "", 9_000).sig).toBe(base.s);
  });

  it("id 없는 시작(옛 스크립트) 뒤의 Stop 은 예전처럼 곧장 완료다", () => {
    const r = run([["start"], sub("subagent-start", null), ["stop"]]);
    expect(r.completed).toEqual([2]);
    expect(r.notified).toEqual([2]);
  });
});

describe("stepHookSignal — 알림은 메인의 stop 으로 선 완료뿐", () => {
  it("서브 에이전트가 끝나도 알리지 않고, 메인이 결과를 받아 다시 돌고 멈출 때 한 번 알린다", () => {
    const r = run([
      ["start"],
      sub("subagent-start", "a"),
      ["stop"],
      sub("subagent-stop", "a"), // 3 — 완료(점만) · 알리지 않는다
      ["tool"], // 메인이 깨어나 보고(UserPromptSubmit 없이)
      ["stop"], // 5 — 진짜 끝 · 알림
    ]);
    expect(r.completed).toEqual([3, 5]);
    expect(r.notified).toEqual([5]);
    expect(agentStatus(r.s, r.at, true)).toBe("finished");
  });

  it("서브 에이전트가 없는 턴은 예전 그대로 stop 마다 알린다", () => {
    const r = run([["start"], ["stop"], ["tool"], ["stop"], ["stop"]]);
    expect(r.notified).toEqual([1, 3, 4]);
    // 포그라운드 서브 에이전트(Stop 전에 끝남)도 같다 — 메인의 stop 마다
    const f = run([["start"], sub("subagent-start", "a"), sub("subagent-stop", "a"), ["stop"], ["tool"], ["stop"]]);
    expect(f.notified).toEqual([3, 5]);
  });

  it("서브 에이전트 뒤 메인의 stop · 다음 사용자 턴의 stop 이 하나씩 알린다", () => {
    const r = run([["start"], sub("subagent-start", "a"), ["stop"], sub("subagent-stop", "a"), ["stop"], ["start"], ["stop"]]);
    expect(r.notified).toEqual([4, 6]);
  });

  it("start 는 진행 중 서브 에이전트를 비우지 않는다 — 백그라운드는 턴을 넘어 산다", () => {
    const r = run([
      ["start"],
      sub("subagent-start", "a"),
      ["stop"],
      ["start"], // 사람이 다음 말을 걸었다
      ["stop"], // 4 — a 가 아직 돈다 → 완료 아님
      sub("subagent-stop", "a"), // 5 — 완료(점만) · 알리지 않는다
    ]);
    expect(r.completed).toEqual([5]);
    expect(r.notified).toEqual([]);
  });

  it("메인이 다시 돌면(start) 실행 중 — 진행 중 수는 그대로 보인다", () => {
    const r = run([["start"], sub("subagent-start", "a"), ["stop"], ["start"]]);
    expect(agentStatus(r.s, r.at, true)).toBe("running");
    expect(subagentCount(r.s)).toBe(1);
  });
});

describe("forgetHook · subagentCount · isHookSignalEvent", () => {
  it("새 CLI 는 진행 중까지 지우고 종료 표식만 둔다", () => {
    const r = run([["start"], sub("subagent-start", "a"), ["stop"]]);
    const f = forgetHook({ ...r.s, exitedAt: 7 });
    expect(f).toEqual({ ...emptyAgentSignals(), exitedAt: 7 });
    expect(subagentCount(f)).toBe(0);
    expect(subagentCount(null)).toBe(0);
  });

  it("isHookSignalEvent 는 서브 에이전트 둘을 안다", () => {
    expect(isHookSignalEvent("subagent-start")).toBe(true);
    expect(isHookSignalEvent("subagent-stop")).toBe(true);
    expect(isHookSignalEvent("subagent")).toBe(false);
    expect(isHookSignalEvent(42)).toBe(false);
  });

  it("`session`(훅 10판 SessionStart)은 받되 상태 재료를 바꾸지 않는다 — 연결 전용", () => {
    expect(isHookSignalEvent("session")).toBe(true);
    const fresh = stepHookSignal(emptyAgentSignals(), "session", null, null, 5);
    expect(fresh.sig).toEqual(emptyAgentSignals());
    expect(fresh.completed || fresh.notify).toBe(false);
    const stopped = stepHookSignal(emptyAgentSignals(), "stop", null, null, 6).sig;
    expect(stepHookSignal(stopped, "session", null, null, 7).sig).toEqual(stopped);
  });
});

describe("admitHookSignal — 신호가 밝힌 CLI 로 분류 (스크립트 8판 `cli`)", () => {
  it("이미 AI 타일이면 받고 분류는 그대로", () => {
    expect(admitHookSignal(true, undefined)).toEqual({ admit: true, attest: null });
    expect(admitHookSignal(true, "codex")).toEqual({ admit: true, attest: null });
  });

  it("미분류 타일은 cli 가 있으면 받고 그 CLI 로 분류한다", () => {
    expect(admitHookSignal(false, "codex")).toEqual({ admit: true, attest: "codex" });
    expect(admitHookSignal(false, "claude")).toEqual({ admit: true, attest: "claude" });
  });

  it("미분류 타일에 온 cli 없는 옛 신호 · 모르는 cli 는 버린다", () => {
    for (const cli of [undefined, null, "", "gemini", "Codex", 1]) {
      expect(admitHookSignal(false, cli)).toEqual({ admit: false, attest: null });
    }
    expect(signalCli("codex")).toBe("codex");
    expect(signalCli("CODEX")).toBeNull();
  });
});

// Rust 표의 몫 — 세션 서버 설계 9절 ① (src-tauri/src/agent_state.rs)
describe("Rust 에이전트 상태 표 받기", () => {
  const wire = (over: Record<string, unknown> = {}) => ({
    cli: "claude",
    state: "finished",
    agentRunId: null,
    seq: 7,
    at: 50,
    subagents: [],
    lastEvent: "stop",
    signalRunningAt: 10,
    signalPermissionAt: null,
    signalStopAt: 50,
    signalSubagentAt: null,
    mainStopped: true,
    ...over,
  });

  it("항목을 읽는다 — seq 가 없으면 버리고, 모르는 값은 없는 것으로", () => {
    const w = parseAgentStateWire(wire());
    expect(w?.seq).toBe(7);
    expect(w?.cli).toBe("claude");
    expect(w?.state).toBe("finished");
    expect(parseAgentStateWire(wire({ seq: undefined }))).toBeNull();
    expect(parseAgentStateWire(null)).toBeNull();
    expect(parseAgentStateWire("x")).toBeNull();
    const odd = parseAgentStateWire(wire({ cli: "gemini", state: "idle", subagents: ["a", 3] }));
    expect(odd?.cli).toBeNull();
    expect(odd?.state).toBeNull();
    expect(odd?.subagents).toEqual(["a"]);
  });

  it("스냅숏은 [스트림, 항목] 줄 중 쓸 수 있는 것만", () => {
    const rows = parseAgentStatesSnapshot([["s1", wire()], ["s2", { seq: "x" }], "bad", [3, wire()]]);
    expect(rows.map(([k]) => k)).toEqual(["s1"]);
    expect(parseAgentStatesSnapshot(null)).toEqual([]);
  });

  it("낮거나 같은 seq 는 버린다 — 스냅숏과 이벤트가 어느 순서로 와도 늦은 값이 이긴다", () => {
    expect(acceptSeq(undefined, 1)).toBe(true);
    expect(acceptSeq(null, 1)).toBe(true);
    expect(acceptSeq(5, 6)).toBe(true);
    expect(acceptSeq(5, 5)).toBe(false);
    expect(acceptSeq(5, 4)).toBe(false);
    // 이벤트(8) 다음 늦게 도착한 스냅숏(7)은 무시, 그 뒤 이벤트(9)는 적는다
    let have: number | undefined;
    const applied: number[] = [];
    for (const seq of [8, 7, 9, 9]) {
      if (acceptSeq(have, seq)) {
        have = seq;
        applied.push(seq);
      }
    }
    expect(applied).toEqual([8, 9]);
  });

  it("항목 → 판정 재료 — 종료 표식은 창의 값을 둔다 · 점은 같은 규칙으로", () => {
    const w = parseAgentStateWire(wire())!;
    const s = signalsFromWire(w, null);
    expect(s).toEqual({
      exitedAt: null,
      signalRunningAt: 10,
      signalPermissionAt: null,
      signalStopAt: 50,
      subagents: [],
      signalSubagentAt: null,
      mainStopped: true,
    });
    expect(agentStatus(s, 60, true)).toBe("finished");
    expect(agentStatus(s, 60, false)).toBeNull();
    expect(agentStatus(signalsFromWire(w, 55), 60, true)).toBeNull();
    // 서브 에이전트가 돌면 끝은 완료가 아니다 — Rust `state` 와 같은 답
    const busy = signalsFromWire(parseAgentStateWire(wire({ subagents: ["a1"], signalSubagentAt: 40, state: "running" }))!, null);
    expect(agentStatus(busy, 60, true)).toBe("running");
  });

  it("Rust 전이와 순수 명세가 같은 재료를 낸다 — start → stop", () => {
    const step1 = stepHookSignal(emptyAgentSignals(), "start", null, null, 10);
    const step2 = stepHookSignal(step1.sig, "stop", null, null, 50);
    expect(step2.completed && step2.notify).toBe(true);
    expect(signalsFromWire(parseAgentStateWire(wire())!, null)).toEqual(step2.sig);
  });

  it("재료가 없는 항목(idle 만 받은)으로는 새 칸을 만들지 않는다", () => {
    const idle = parseAgentStateWire(
      wire({ state: null, lastEvent: "waiting", signalRunningAt: null, signalStopAt: null, mainStopped: false }),
    )!;
    expect(hasHookMaterial(idle)).toBe(false);
    expect(hasHookMaterial(parseAgentStateWire(wire())!)).toBe(true);
  });
});

describe("session-end — CLI 가 끝났다 (훅 9판 · Rust agent_state 와 같은 규칙)", () => {
  it("아는 이벤트이고, 재료를 비워 점이 사라진다 — 종료 표식은 둔다", () => {
    expect(isHookSignalEvent("session-end")).toBe(true);
    const busy = sig({ exitedAt: 5, signalRunningAt: 10, subagents: ["a"], signalSubagentAt: 11, mainStopped: true });
    const step = stepHookSignal(busy, "session-end", null, null, 20);
    expect(step).toEqual({ sig: { ...emptyAgentSignals(), exitedAt: 5 }, completed: false, notify: false });
    expect(agentStatus(step.sig, 21, false)).toBeNull();
  });
});
