// 오케스트레이션 탭 ⑤ 막대 상태의 순수 층(`model/pulse.ts`) — 앨범 요약 → 막대 하나 · 독 칸 접기 — 노트 5-2 · D9.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UI_ICONS } from "$lib/ui-icons.generated";
import { albumLive, albumPulse, dockPulse, type RunSummary } from "./model";

function run(id: string, extra: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: id,
    name: id,
    state: "running",
    orphaned: false,
    gen: 1,
    createdAt: 0,
    updatedAt: 0,
    repo: "C:/work/api",
    latestSeq: 1,
    taskCount: 0,
    taskStates: {},
    attemptCount: 0,
    coordinatorAttached: true,
    origin: { by: "ai", producer: "pc-1" },
    running: { write: 0, judge: 0 },
    hold: null,
    adoptable: { restore: false, autoResume: false, why: "running" },
    coordinatorChat: "pc-1",
    producers: ["pc-1"],
    wake: null,
    ...extra,
  };
}

describe("albumPulse", () => {
  it("요약이 없으면 로고(헤드폰)", () => {
    expect(albumPulse(null)).toBe("logo");
    expect(albumPulse(undefined)).toBe("logo");
  });

  it("끝 · 멈춤 · 멈추는 중", () => {
    expect(albumPulse(run("a", { state: "done" }))).toBe("done");
    expect(albumPulse(run("a", { state: "stopped" }))).toBe("idle");
    expect(albumPulse(run("a", { state: "stopping", running: { write: 2, judge: 0 } }))).toBe("idle");
  });

  it("사람 필요 — orphaned · 일시정지 · blocked · 보류 · 영속 실패 · 상세의 사람 필요", () => {
    expect(albumPulse(run("a", { state: "orphaned", orphaned: true }))).toBe("attention");
    expect(albumPulse(run("a", { state: "paused" }))).toBe("paused");
    // 조율 멈춤은 까닭(막힘 · 보류)과 무관하게 ⏸ — 아티스트가 계속 돌아도
    expect(albumPulse(run("a", { state: "paused", blocked: 1, running: { write: 1, judge: 0 } }))).toBe("paused");
    expect(albumPulse(run("a", { blocked: 1, running: { write: 1, judge: 0 } }))).toBe("attention");
    expect(albumPulse(run("a", { hold: { kind: "x" } as unknown as RunSummary["hold"] }))).toBe("attention");
    expect(albumPulse(run("a", { persist: { ok: false, lastSavedSeq: 1, failing: { since: 1, reason: "io", count: 2 } } }))).toBe(
      "attention",
    );
    expect(albumPulse(run("a", { running: { write: 1, judge: 0 } }), 1)).toBe("attention");
  });

  it("도는 종류 — 쓰기형이 판정형을 이긴다 · 아무도 안 돌면 쉼", () => {
    expect(albumPulse(run("a", { running: { write: 1, judge: 1 } }))).toBe("playing");
    expect(albumPulse(run("a", { running: { write: 0, judge: 1 } }))).toBe("reviewing");
    expect(albumPulse(run("a", { running: { write: 0, judge: 0 }, attemptCount: 3 }))).toBe("idle");
  });

});

describe("dockPulse", () => {
  it("산 앨범이 없으면 로고 · 배지 없음", () => {
    expect(dockPulse([])).toEqual({ pulse: "logo", live: 0, attention: false });
    expect(dockPulse([run("a", { state: "done" }), run("b", { state: "orphaned", orphaned: true })])).toEqual({
      pulse: "logo",
      live: 0,
      attention: false,
    });
  });

  it("움직임이 이기고 사람 필요는 배지로 따로", () => {
    const d = dockPulse([run("a", { state: "paused" }), run("b", { running: { write: 0, judge: 1 } }), run("c", { state: "done" })]);
    expect(d).toEqual({ pulse: "reviewing", live: 2, attention: true });
    expect(dockPulse([run("a", { running: { write: 1, judge: 0 } }), run("b", { running: { write: 0, judge: 1 } })]).pulse).toBe("playing");
    expect(dockPulse([run("a", { state: "paused" })]).pulse).toBe("paused");
    expect(dockPulse([run("a", { state: "paused" })]).attention).toBe(true);
    expect(dockPulse([run("a", { state: "paused" }), run("b", { blocked: 1 })]).pulse).toBe("attention");
    expect(dockPulse([run("a")]).pulse).toBe("idle");
  });

  it("albumLive — 도는 · 멈춘 · 멈추는 중만", () => {
    expect(albumLive(run("a"))).toBe(true);
    expect(albumLive(run("a", { state: "paused" }))).toBe(true);
    expect(albumLive(run("a", { state: "stopping" }))).toBe(true);
    expect(albumLive(run("a", { state: "stopped" }))).toBe(false);
    expect(albumLive(run("a", { state: "orphaned", orphaned: true }))).toBe(false);
  });
});

// 10-31 사용자 결정 — 로고 = 헤드폰 · 사람 필요와 조율 멈춤은 같은 ⏸ · 끝은 원 ✓ · 런처 독 칸은 늘 헤드폰 + 배지(모양의 화면 단언은 하네스 orch-tab ⑨)
describe("상태 그림 소스", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("정적 로고 orchestra 는 헤드폰", () => {
    expect(UI_ICONS.orchestra.source).toBe("material-symbols:headphones-outline-rounded");
  });

  it("EqBars — 헤드폰 · ⏸ 하나(attention · paused 같은 갈래) · 원 ✓ · 막대는 재생 · 검토만", () => {
    const src = read("./EqBars.svelte");
    expect(src).toContain("{@html UI_ICONS.orchestra.body}");
    expect(src).toContain('{#if state === "attention" || state === "paused"}');
    expect(src).toContain('state === "playing" || state === "reviewing"');
    expect(src).toMatch(/<circle cx="12" cy="12" r="9" fill="none"/);
  });

  it("런처 독 칸은 상태 그림 없이 헤드폰 로고 + 배지", () => {
    const src = read("../DockLaunch.svelte");
    expect(src).not.toContain("EqBars");
    expect(src).toMatch(/data-launch="orchestration-start"[\s\S]*?<UiIcon name="orchestra"[\s\S]*?data-orch-badge/);
  });
});
