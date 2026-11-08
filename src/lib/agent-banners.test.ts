import { describe, expect, it } from "vitest";
import {
  COLLAPSE_MS,
  EMPTY_BANNERS,
  MAX_RESOLVED,
  MAX_SHOWN,
  activityResumed,
  addBanner,
  awaitsActivity,
  bannerBadge,
  bannerTitle,
  bannerView,
  collapseDue,
  expandBanner,
  hideAllBanners,
  hideBanner,
  nextBannerToVisit,
  nextCollapseAt,
  releaseBornFocused,
  resolveAllFinished,
  resolveBanner,
  resolveVisit,
  resolvedBy,
  restartCollapse,
  type BannerInput,
  type BannerState,
} from "$lib/agent-banners";

/**
 * 에이전트 알림 배너의 상태기계 (docs/log/2026-09-27-agent-banners.md).
 */

const input = (paneId: string, kind: "stop" | "permission" = "stop"): BannerInput => ({
  paneId,
  kind,
  agent: "Claude Code",
  logo: "claude",
  label: `tab-${paneId}`,
  text: `tab-${paneId} — Claude Code 작업이 끝났습니다`,
});

/** 타일 셋을 차례로 알린 상태 (p3 가 맨 위) */
function three(): BannerState {
  let s = addBanner(EMPTY_BANNERS, input("p1"), 1, 1000);
  s = addBanner(s, input("p2", "permission"), 2, 2000);
  return addBanner(s, input("p3"), 3, 3000);
}

describe("addBanner — 쌓기 · 타일마다 하나", () => {
  it("새것이 맨 위에 펼친 채로 선다", () => {
    const s = three();
    expect(s.active.map((b) => b.paneId)).toEqual(["p3", "p2", "p1"]);
    expect(s.active[0]).toMatchObject({ id: 3, hidden: false, collapsed: false, expandedAt: 3000, at: 3000 });
  });

  it("같은 타일의 새 알림은 내용을 바꾸고 맨 위로 — 번호는 그대로", () => {
    const s = addBanner(three(), input("p1", "permission"), 99, 5000);
    expect(s.active.map((b) => b.paneId)).toEqual(["p1", "p3", "p2"]);
    expect(s.active[0]).toMatchObject({ id: 1, kind: "permission", at: 5000 });
    expect(s.active).toHaveLength(3);
  });

  it("숨김·알약이던 항목도 새 알림이면 다시 펼쳐 보인다", () => {
    let s = hideBanner(three(), 1);
    s = collapseDue(s, 3000 + COLLAPSE_MS);
    s = addBanner(s, input("p1"), 99, 20_000);
    expect(s.active[0]).toMatchObject({ paneId: "p1", hidden: false, collapsed: false, expandedAt: 20_000 });
  });
});

describe("resolveBanner — 지난 알림으로", () => {
  it("해결하면 배너에서 빠지고 지난 알림 맨 앞에 선다", () => {
    const s = resolveBanner(three(), "p2", "checked", 4000);
    expect(s.active.map((b) => b.paneId)).toEqual(["p3", "p1"]);
    expect(s.resolved[0]).toMatchObject({ paneId: "p2", resolution: "checked", resolvedAt: 4000 });
  });

  it("없는 타일이면 같은 상태", () => {
    const s = three();
    expect(resolveBanner(s, "nope", "auto", 1)).toBe(s);
  });

  it("갈래를 주면 그 갈래일 때만", () => {
    const s = three();
    expect(resolveBanner(s, "p2", "auto", 1, ["stop"])).toBe(s); // p2 는 권한
    expect(resolveBanner(s, "p2", "auto", 1, ["permission"]).active).toHaveLength(2);
  });

  it("숨긴 항목도 해결된다", () => {
    const s = resolveBanner(hideBanner(three(), 3), "p3", "auto", 9);
    expect(s.active.some((b) => b.paneId === "p3")).toBe(false);
    expect(s.resolved[0]).toMatchObject({ paneId: "p3", hidden: true, resolution: "auto" });
  });

  it(`지난 알림은 ${MAX_RESOLVED} 줄까지 — 오래된 것부터 버린다`, () => {
    let s: BannerState = EMPTY_BANNERS;
    for (let i = 0; i < MAX_RESOLVED + 5; i++) {
      s = addBanner(s, input(`p${i}`), i + 1, i);
      s = resolveBanner(s, `p${i}`, "auto", i);
    }
    expect(s.resolved).toHaveLength(MAX_RESOLVED);
    expect(s.resolved[0].paneId).toBe(`p${MAX_RESOLVED + 4}`);
  });
});

describe("resolveAllFinished — 독 알림 칸의 [모두 읽음] (2026-10-18)", () => {
  it("끝남만 확인함으로 풀고 권한 물음은 남긴다", () => {
    const s = resolveAllFinished(three(), 7000);
    expect(s.active.map((b) => b.paneId)).toEqual(["p2"]);
    expect(s.resolved.map((b) => [b.paneId, b.resolution, b.resolvedAt])).toEqual([
      ["p3", "checked", 7000],
      ["p1", "checked", 7000],
    ]);
  });

  it("끝남이 없으면 같은 상태", () => {
    const only = addBanner(EMPTY_BANNERS, input("p9", "permission"), 1, 1);
    expect(resolveAllFinished(only, 2)).toBe(only);
    expect(resolveAllFinished(EMPTY_BANNERS, 2)).toBe(EMPTY_BANNERS);
  });
});

describe("resolvedBy — 에이전트가 넘어가면 저절로", () => {
  it.each([
    ["start", ["stop", "permission"]],
    ["tool", ["stop"]],
    ["tool-done", ["permission"]],
    ["stop", ["permission"]],
    ["waiting", []],
    ["bogus", []],
  ])("%s → %j", (event, kinds) => {
    expect(resolvedBy(event)).toEqual(kinds);
  });

  it("끝남 항목은 새 턴(start/tool)에 풀리고 도구 끝에는 남는다", () => {
    const s = three(); // p1 끝남
    expect(resolveBanner(s, "p1", "auto", 1, resolvedBy("tool-done"))).toBe(s);
    expect(resolveBanner(s, "p1", "auto", 1, resolvedBy("tool")).active).toHaveLength(2);
  });

  it("권한 항목은 도구 끝·턴 끝에 풀리고 도구 시작에는 남는다", () => {
    const s = three(); // p2 권한
    expect(resolveBanner(s, "p2", "auto", 1, resolvedBy("tool"))).toBe(s);
    expect(resolveBanner(s, "p2", "auto", 1, resolvedBy("tool-done")).active).toHaveLength(2);
    expect(resolveBanner(s, "p2", "auto", 1, resolvedBy("stop")).active).toHaveLength(2);
  });
});

describe("× · 모두 지우기 — 해결이 아니다", () => {
  it("× 는 배너에서만 빠지고 배지에는 남는다", () => {
    const s = hideBanner(three(), 2);
    expect(bannerView(s, false).shown.map((b) => b.id)).toEqual([3, 1]);
    expect(bannerBadge(s)).toEqual({ count: 3, urgent: true });
  });

  it("이미 숨겼거나 없는 번호면 같은 상태", () => {
    const s = hideBanner(three(), 2);
    expect(hideBanner(s, 2)).toBe(s);
    expect(hideBanner(s, 42)).toBe(s);
  });

  it("모두 지우기 → 배너는 비고 배지는 그대로", () => {
    const s = hideAllBanners(three());
    expect(bannerView(s, false).shown).toHaveLength(0);
    expect(bannerBadge(s).count).toBe(3);
    expect(hideAllBanners(s)).toBe(s);
  });
});

describe("접힘 — 10초 뒤 알약", () => {
  it("10초가 지나야 접히고, 호버 중이면 접지 않는다", () => {
    const s = addBanner(EMPTY_BANNERS, input("p1"), 1, 0);
    expect(collapseDue(s, COLLAPSE_MS - 1)).toBe(s);
    expect(collapseDue(s, COLLAPSE_MS, true)).toBe(s);
    expect(collapseDue(s, COLLAPSE_MS).active[0].collapsed).toBe(true);
  });

  it("다시 펼치면 시계가 처음부터", () => {
    let s = collapseDue(addBanner(EMPTY_BANNERS, input("p1"), 1, 0), COLLAPSE_MS);
    s = expandBanner(s, 1, 50_000);
    expect(s.active[0]).toMatchObject({ collapsed: false, expandedAt: 50_000 });
    expect(nextCollapseAt(s)).toBe(50_000 + COLLAPSE_MS);
    expect(collapseDue(s, 50_000 + COLLAPSE_MS - 1).active[0].collapsed).toBe(false);
  });

  it("호버가 끝나면 펼친 카드의 시계를 다시 센다 (알약은 그대로)", () => {
    let s = three();
    s = collapseDue(s, 1000 + COLLAPSE_MS); // p1 만 접힌다
    s = restartCollapse(s, 30_000);
    expect(s.active.find((b) => b.paneId === "p1")?.collapsed).toBe(true);
    expect(s.active.filter((b) => !b.collapsed).every((b) => b.expandedAt === 30_000)).toBe(true);
  });

  it("다음 접힘 시각 — 가장 이른 펼친 카드 · 숨김·알약은 빼고 · 없으면 null", () => {
    const s = three();
    expect(nextCollapseAt(s)).toBe(1000 + COLLAPSE_MS);
    expect(nextCollapseAt(hideBanner(s, 1))).toBe(2000 + COLLAPSE_MS);
    expect(nextCollapseAt(EMPTY_BANNERS)).toBeNull();
    expect(nextCollapseAt(collapseDue(s, 100_000))).toBeNull();
  });
});

describe("bannerView — 넘침", () => {
  function many(n: number): BannerState {
    let s: BannerState = EMPTY_BANNERS;
    for (let i = 1; i <= n; i++) s = addBanner(s, input(`p${i}`), i, i);
    return s;
  }

  it(`${MAX_SHOWN} 개까지는 칩 없이 (모두 지우기는 둘부터)`, () => {
    expect(bannerView(many(1), false)).toMatchObject({ more: 0, canFold: false, clearAll: false });
    expect(bannerView(many(3), false)).toMatchObject({ more: 0, canFold: false, clearAll: true });
  });

  it("넘치면 위 셋 + '+N개 더' · 전부 보기면 전부 + '접기'", () => {
    const s = many(5);
    const folded = bannerView(s, false);
    expect(folded.shown.map((b) => b.id)).toEqual([5, 4, 3]);
    expect(folded.more).toBe(2);
    const all = bannerView(s, true);
    expect(all.shown).toHaveLength(5);
    expect(all).toMatchObject({ more: 0, canFold: true });
  });

  it("숨긴 것은 세지 않는다", () => {
    const s = hideBanner(hideBanner(many(5), 5), 4);
    expect(bannerView(s, false)).toMatchObject({ more: 0 });
    expect(bannerView(s, false).shown.map((b) => b.id)).toEqual([3, 2, 1]);
  });
});

describe("bannerBadge · bannerTitle", () => {
  it("권한 물음이 없으면 중성", () => {
    expect(bannerBadge(resolveBanner(three(), "p2", "auto", 1))).toEqual({ count: 2, urgent: false });
    expect(bannerBadge(EMPTY_BANNERS)).toEqual({ count: 0, urgent: false });
  });

  it("머리줄 = 에이전트 · 이름 (모르는 에이전트는 일반 이름)", () => {
    expect(bannerTitle({ agent: "Codex", label: "aynx · feat" }, "AI")).toBe("Codex · aynx · feat");
    expect(bannerTitle({ agent: null, label: "x" }, "AI 에이전트")).toBe("AI 에이전트 · x");
  });
});

describe("보고 있는 타일에서 선 항목 — bornFocused (docs/log/2026-09-27-agent-banners.md)", () => {
  const born = (paneId: string): BannerInput => ({ ...input(paneId), bornFocused: true });

  it("보통 항목은 방문으로 풀린다 (확인함)", () => {
    const s = resolveVisit(three(), "p1", 9000);
    expect(s.active.map((b) => b.paneId)).toEqual(["p3", "p2"]);
    expect(s.resolved[0]).toMatchObject({ paneId: "p1", resolution: "checked", resolvedAt: 9000 });
  });

  it("bornFocused 항목은 서자마자 방문으로 풀리지 않는다", () => {
    const s = addBanner(EMPTY_BANNERS, born("p1"), 1, 1000);
    expect(s.active[0]).toMatchObject({ bornFocused: true, awaitingActivity: true });
    expect(resolveVisit(s, "p1", 2000)).toBe(s);
  });

  it("그 타일을 만지면(resolveBanner) 풀린다", () => {
    const s = resolveBanner(addBanner(EMPTY_BANNERS, born("p1"), 1, 1000), "p1", "checked", 2000);
    expect(s.active).toHaveLength(0);
    expect(s.resolved[0]).toMatchObject({ paneId: "p1", resolution: "checked" });
  });

  it("에이전트가 넘어가면(start) 저절로 풀린다", () => {
    const s = addBanner(EMPTY_BANNERS, born("p1"), 1, 1000);
    const r = resolveBanner(s, "p1", "auto", 2000, resolvedBy("start"));
    expect(r.active).toHaveLength(0);
    expect(r.resolved[0].resolution).toBe("auto");
  });

  it("포커스가 다른 타일로 가면 표식을 벗고, 돌아오면 방문으로 풀린다", () => {
    let s = addBanner(EMPTY_BANNERS, born("p1"), 1, 1000);
    // 같은 타일에 머무는 동안은 그대로 (같은 상태)
    expect(releaseBornFocused(s, "p1")).toBe(s);
    s = releaseBornFocused(s, "p2");
    expect(s.active[0].bornFocused).toBe(false);
    expect(resolveVisit(s, "p2", 2000)).toBe(s); // p2 에는 항목이 없다
    s = resolveVisit(s, "p1", 3000);
    expect(s.active).toHaveLength(0);
    expect(s.resolved[0]).toMatchObject({ paneId: "p1", resolution: "checked" });
  });

  it("같은 타일의 보통 알림이 오면 표식은 새 입력을 따른다", () => {
    let s = addBanner(EMPTY_BANNERS, born("p1"), 1, 1000);
    s = addBanner(s, input("p1"), 2, 2000);
    expect(s.active[0]).toMatchObject({ id: 1, bornFocused: false, awaitingActivity: false });
  });

  it("사람이 돌아올 때까지 접히지 않는다 — 돌아온 뒤 10초", () => {
    let s = addBanner(EMPTY_BANNERS, born("p1"), 1, 1000);
    s = addBanner(s, input("p2"), 2, 1000);
    expect(awaitsActivity(s)).toBe(true);
    // 보통 항목(p2)만 시계를 건다
    expect(nextCollapseAt(s)).toBe(1000 + COLLAPSE_MS);
    s = collapseDue(s, 1000 + 10 * COLLAPSE_MS);
    expect(s.active.find((b) => b.paneId === "p1")?.collapsed).toBe(false);
    expect(s.active.find((b) => b.paneId === "p2")?.collapsed).toBe(true);
    expect(nextCollapseAt(s)).toBeNull();

    s = activityResumed(s, 500_000);
    expect(awaitsActivity(s)).toBe(false);
    expect(s.active.find((b) => b.paneId === "p1")).toMatchObject({ awaitingActivity: false, expandedAt: 500_000 });
    expect(nextCollapseAt(s)).toBe(500_000 + COLLAPSE_MS);
    s = collapseDue(s, 500_000 + COLLAPSE_MS);
    expect(s.active.find((b) => b.paneId === "p1")?.collapsed).toBe(true);
  });

  it("기다리는 항목이 없으면 activityResumed 는 같은 상태", () => {
    const s = three();
    expect(activityResumed(s, 9000)).toBe(s);
  });
});

describe("nextBannerToVisit (Alt+` 알림 위치로 가기)", () => {
  it("없으면 null", () => {
    expect(nextBannerToVisit(EMPTY_BANNERS)).toBeNull();
  });
  it("권한 물음이 최근 완료보다 먼저", () => {
    // three(): p1 완료(1000) · p2 권한(2000) · p3 완료(3000)
    expect(nextBannerToVisit(three())?.paneId).toBe("p2");
  });
  it("같은 갈래면 최근 것이 먼저 · × 로 비킨 것도 포함", () => {
    let s = addBanner(EMPTY_BANNERS, input("p1"), 1, 1000);
    s = addBanner(s, input("p2"), 2, 2000);
    s = hideBanner(s, 2);
    expect(nextBannerToVisit(s)?.paneId).toBe("p2");
  });
  it("가서 해결하면 다음 것으로 넘어간다", () => {
    const s = resolveBanner(three(), "p2", "checked", 4000);
    expect(nextBannerToVisit(s)?.paneId).toBe("p3");
  });
});
