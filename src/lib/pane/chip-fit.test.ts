import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chipBudget,
  FIT_HYSTERESIS,
  fitChips,
  fitSignature,
  overflowAnchor,
  TITLE_MIN_PX,
  type FitChip,
  type FitInput,
} from "./chip-fit";

const GAP = 6;
const MORE = 28;

// 기본 순서의 칩 한 벌 — 폭은 실기 캡처 근처의 값(제 폭 · 그림만 · 자원은 CPU · 그림)
const folder: FitChip = { id: "folder", widths: [90, 24] };
const branch: FitChip = { id: "branch", widths: [120, 24] };
const jump: FitChip = { id: "jump", widths: [100, 24] };
const tmux: FitChip = { id: "tmux", widths: [110, 24] };
const forward: FitChip = { id: "forward", widths: [80, 30] };
const resource: FitChip = { id: "resource", widths: [110, 60, 24] };
const ai: FitChip = { id: "ai", widths: [60, 30], pinned: true };

const ALL = [folder, branch, jump, tmux, forward, resource, ai];

/** 칩 줄의 폭(간격 포함) */
const total = (ws: number[]) => ws.reduce((s, w) => s + w + GAP, 0);

function fit(chips: FitChip[], available: number, extra: Partial<FitInput> = {}) {
  return fitChips({ chips, available, gap: GAP, overflowWidth: MORE, ...extra });
}

/** id → 꼴 */
const modes = (r: ReturnType<typeof fit>) => Object.fromEntries(r.ids.map((id, i) => [id, r.modes[i]]));

describe("fitChips — 들어가면 접지 않는다", () => {
  it("칩이 적으면 좁은 타일에서도 그대로다", () => {
    const r = fit([folder, ai], total([90, 60]));
    expect(r.modes).toEqual(["full", "full"]);
    expect(r.hidden).toEqual([]);
    expect(r.step).toBe(0);
    expect(r.overflows).toBe(false);
  });

  it("칩 수와 상관없이 다 들어가면 다 편다", () => {
    const r = fit(ALL, 2000);
    expect(r.modes.every((m) => m === "full")).toBe(true);
  });

  it("칩이 없으면 아무 일도 없다", () => {
    const r = fit([], 0);
    expect(r.modes).toEqual([]);
    expect(r.overflows).toBe(false);
  });
});

describe("fitChips — 1차: 끝에서부터 한 칩씩 짧은 꼴", () => {
  it("모자라는 만큼만 끝 칩을 접는다", () => {
    // AI 권한(끝) 하나만 게이지로 접으면 들어간다
    const full = total(ALL.map((c) => c.widths[0]));
    const r = fit(ALL, full - 10);
    expect(modes(r)).toMatchObject({ ai: "compact", resource: "full", folder: "full" });
    expect(r.hidden).toEqual([]);
  });

  it("자원 칩은 CPU 만 → 그림 두 번 접힌 뒤에야 앞 칩으로 간다", () => {
    const chips = [folder, resource];
    // 자원 CPU 만이면 들어간다
    expect(modes(fit(chips, total([90, 60]))).resource).toBe("compact");
    // CPU 만으로도 모자라면 그림
    expect(modes(fit(chips, total([90, 24])))).toEqual({ folder: "full", resource: "icon" });
    // 그래도 모자라면 이제 폴더가 그림만
    expect(modes(fit(chips, total([24, 24])))).toEqual({ folder: "compact", resource: "icon" });
  });

  it("짧아지지 않는 꼴(이름 없는 폴더 칩)은 단계가 아니다", () => {
    const bare: FitChip = { id: "folder", widths: [24] };
    const r = fit([bare, branch], total([24, 24]));
    expect(modes(r)).toEqual({ folder: "full", branch: "compact" });
    // 브랜치까지 접어도 모자라면 폴더는 접을 꼴이 없어 곧장 2차(숨김)로 간다
    const r2 = fit([bare, { id: "branch", widths: [120, 60] }, ai], total([24, 30]) + MORE + GAP);
    expect(modes(r2)).toEqual({ folder: "full", branch: "hidden", ai: "compact" });
  });
});

describe("fitChips — 2차: 끝에서부터 숨김 + \"+N\"", () => {
  it("다 접어도 넘치면 끝 칩부터 숨기고 숨은 수만큼 +N", () => {
    const compactAll = ALL.map((c) => c.widths[c.widths.length - 1]);
    // 그림만 다 늘어놓은 폭에서 자원 · 포워딩 둘을 숨기고 +N 을 세운 폭
    const room = total(compactAll) - (24 + GAP) - (30 + GAP) + MORE + GAP;
    const r = fit(ALL, room);
    expect(r.hidden).toEqual(["forward", "resource"]);
    expect(modes(r)).toMatchObject({ folder: "compact", tmux: "compact", ai: "compact" });
    expect(overflowAnchor(r)).toBe("forward");
  });

  it("AI 권한은 어느 자리에 있든 숨지 않는다 — 게이지만까지", () => {
    const r = fit(ALL, 0);
    expect(modes(r).ai).toBe("compact");
    expect(r.hidden).toEqual(["folder", "branch", "jump", "tmux", "forward", "resource"]);
    expect(r.overflows).toBe(true);
  });

  it("AI 권한을 앞에 옮겨도 숨지 않고, 숨김은 여전히 끝에서부터", () => {
    const chips = [ai, folder, branch, tmux];
    const r = fit(chips, total([30, 24]) + MORE + GAP);
    expect(r.ids).toEqual(["ai", "folder", "branch", "tmux"]);
    expect(modes(r)).toEqual({ ai: "compact", folder: "compact", branch: "hidden", tmux: "hidden" });
    // +N 은 첫 숨은 칩(브랜치)의 자리 — 끝
    expect(overflowAnchor(r)).toBe("branch");
  });

  it("기본 순서면 +N 은 AI 권한 바로 앞(숨은 칩들이 서 있던 자리)", () => {
    const wideTmux: FitChip = { id: "tmux", widths: [110, 40] };
    const r = fit([folder, branch, wideTmux, ai], total([24, 24]) + MORE + GAP + 30 + GAP);
    expect(r.hidden).toEqual(["tmux"]);
    expect(modes(r)).toMatchObject({ folder: "compact", branch: "compact", ai: "compact" });
    expect(overflowAnchor(r)).toBe("tmux");
  });

  it("사용자 순서를 그대로 중요도로 쓴다 — 자원을 앞에 두면 자원이 오래 산다", () => {
    const chips = [resource, folder, branch];
    const r = fit(chips, total([110, 24]) + MORE + GAP);
    expect(modes(r)).toEqual({ resource: "full", folder: "compact", branch: "compact" });
  });

  it("숨기는 것이 +N 때문에 오히려 넓으면 숨기지 않는다(넘침은 묶음이 자른다)", () => {
    const pin: FitChip = { id: "ai", widths: [40, 20], pinned: true };
    // 그림만 둘 = 52. 폴더를 숨기면 26 + 34 = 60 이라 더 넓다 — 넘쳐도 가장 좁은 단계(둘 다 그림만)
    const r = fit([{ id: "folder", widths: [40, 20] }, pin], 35);
    expect(r.overflows).toBe(true);
    expect(r.hidden).toEqual([]);
    expect(r.modes).toEqual(["compact", "compact"]);
  });
});

describe("fitChips — 이력(hysteresis)", () => {
  const chips = [folder, branch, ai];
  const fullW = total([90, 120, 60]);

  it("접는 쪽은 모자라는 즉시, 펴는 쪽은 여유가 생길 때만", () => {
    const narrow = fit(chips, fullW - 1);
    expect(narrow.step).toBeGreaterThan(0);
    // 다시 딱 맞는 폭 — 지난 결과가 있으면 펴지 않는다
    const same = fit(chips, fullW, { prev: narrow });
    expect(same.step).toBe(narrow.step);
    // 여유가 문턱만큼 생겨야 편다
    const almost = fit(chips, fullW + FIT_HYSTERESIS - 1, { prev: narrow });
    expect(almost.step).toBe(narrow.step);
    const wide = fit(chips, fullW + FIT_HYSTERESIS, { prev: narrow });
    expect(wide.step).toBe(0);
    // 지난 결과가 없으면 문턱 없이 맞는 대로
    expect(fit(chips, fullW).step).toBe(0);
  });

  it("숫자가 흔들려도(자원 칩) 문턱 안이면 꼴이 그대로다", () => {
    const a = fit([folder, resource], total([90, 60]) + 2);
    expect(modes(a).resource).toBe("compact");
    const jitter: FitChip = { id: "resource", widths: [104, 58, 24] };
    const b = fit([folder, jitter], total([90, 60]) + 2, { prev: a });
    expect(modes(b).resource).toBe("compact");
  });

  it("칩 구성이 바뀌면 지난 결과를 이력으로 쓰지 않는다", () => {
    const narrow = fit(chips, fullW - 1);
    const other = fit([folder, ai], total([90, 60]), { prev: narrow });
    expect(other.step).toBe(0);
    expect(fitSignature([folder, ai])).not.toBe(narrow.signature);
  });

  it("펴는 쪽도 접는 쪽도 단계 하나씩만 움직이지 않고 맞는 단계로 곧장 간다", () => {
    const tight = fit(ALL, 0);
    const back = fit(ALL, 5000, { prev: tight });
    expect(back.step).toBe(0);
  });
});

describe("chipBudget — 이름 최소 폭", () => {
  it("이름은 최소 폭(또는 제 폭)만큼 지키고 나머지가 칩 몫이다", () => {
    expect(chipBudget({ boxWidth: 400, nameNatural: 200, gap: GAP })).toBe(400 - TITLE_MIN_PX);
    // 짧은 이름은 제 폭만
    expect(chipBudget({ boxWidth: 400, nameNatural: 30, nameMargin: 4, gap: GAP })).toBe(400 - 34);
  });

  it("칩이 아닌 칸(● · Run 칩)은 간격과 함께 뺀다", () => {
    expect(chipBudget({ boxWidth: 400, nameNatural: 100, fixed: [10, 50], gap: GAP })).toBe(400 - TITLE_MIN_PX - 16 - 56);
  });

  it("음수로 내려가지 않고, 무한(도구줄 머리줄의 '다 들어감')은 무한이다", () => {
    expect(chipBudget({ boxWidth: 20, nameNatural: 100, gap: GAP })).toBe(0);
    expect(chipBudget({ boxWidth: Number.POSITIVE_INFINITY, nameNatural: 100, gap: GAP })).toBe(Number.POSITIVE_INFINITY);
  });

  it("긴 이름 + 칩 많음 — 이름 최소 폭을 지키느라 칩이 먼저 접힌다", () => {
    const box = 360;
    const budget = chipBudget({ boxWidth: box, nameNatural: 300, nameMargin: 4, gap: GAP });
    const r = fit([folder, branch, ai], budget);
    expect(r.needed).toBeLessThanOrEqual(budget);
    expect(r.step).toBeGreaterThan(0);
    // 이름이 짧으면 같은 폭에서 덜 접힌다
    const short = fit([folder, branch, ai], chipBudget({ boxWidth: box, nameNatural: 40, nameMargin: 4, gap: GAP }));
    expect(short.step).toBeLessThan(r.step);
  });
});

describe("머리줄 칩 접기 — 배선", () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("고정 문턱(container query)은 걷혔다", () => {
    expect(src("./HeaderChips.svelte")).not.toContain("@container pane-head");
    expect(src("./PaneHeader.svelte")).not.toContain("container: pane-head");
  });

  it("칩마다 접기 표식을 달고, 하네스 손잡이는 그대로다", () => {
    const chips = src("./HeaderChips.svelte");
    for (const handle of [
      "data-ai-menu-btn",
      "data-tmux-menu-btn",
      "data-jump-chip",
      "data-forward-chip",
      "data-folder-chip",
      "data-branch-chip",
      "data-resource-chip",
    ]) {
      expect(chips).toContain(handle);
    }
    for (const id of ["folder", "branch", "jump", "tmux", "forward"]) expect(chips).toContain(`fitAttrs("${id}"`);
    expect(chips).toContain('fitAttrs("resource", 3)');
    // AI 권한 칩 네 갈래 모두 숨지 않음(pin)
    expect(chips.match(/fitAttrs\("ai", 2, true\)/g)?.length).toBe(4);
    expect(chips).toContain("data-chip-more={pane.id}");
  });

  it("묶음은 재는 상자이고 \"+N\" 메뉴는 상자 밖에서 그린다", () => {
    const head = src("./PaneHeader.svelte");
    expect(head).toContain("data-chip-fit bind:this={identEl}");
    expect(head).toContain("data-fit-name");
    expect(head).toContain("fitBox={identEl}");
    const host = src("../PaneHost.svelte");
    // 그림은 상자 밖 층 PanePopovers(2026-10-26 PaneHost 에서 뗌) — 줄 실행 pickChipMore 를 받는다 · 칩 배선은 PaneHost
    const pops = src("./PanePopovers.svelte");
    expect(pops).toContain("<ChipMoreMenu");
    expect(pops).toContain("onpick={pickChipMore}");
    expect(host).toContain("<PanePopovers");
    expect(host).toContain("{pickChipMore}");
    expect(host).toContain("onchipmore={(ev, items) => cm.toggle(ev, item, items)}");
    // 줄 실행은 메뉴 통로(runOnMenu)를 지난다
    expect(src("./chip-more-menu.svelte.ts")).toContain("this.#m.run(fn)");
  });
});
