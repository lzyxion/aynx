import { describe, expect, it } from "vitest";
import {
  CHIP_TEXT,
  chipLabel,
  chipOf,
  compareVersions,
  isNewerView,
  isSkipped,
  megabytes,
  percent,
  shouldToast,
  shownVersion,
  summarizeBusy,
  type UpdateView,
} from "./updater";

function view(patch: Partial<UpdateView> = {}): UpdateView {
  return {
    current: "0.1.1",
    phase: "available",
    checking: false,
    available: { version: "0.1.2", notes: "", date: null, page: "https://example.invalid/v0.1.2" },
    received: 0,
    total: null,
    error: null,
    failedAt: null,
    checkError: null,
    checkedAt: null,
    skipped: null,
    toasted: null,
    rev: 1,
    ...patch,
  };
}

describe("compareVersions", () => {
  it("숫자 마디로 견준다", () => {
    expect(compareVersions("0.1.2", "0.1.1")).toBeGreaterThan(0);
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
  });
  it("꼬리가 있는 판이 작다", () => {
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBeGreaterThan(0);
  });
});

describe("사본 차례", () => {
  it("쥔 것보다 작은 차례는 버리고, 같거나 큰 것은 받는다", () => {
    const held = view({ phase: "ready", rev: 5 });
    expect(isNewerView(held, view({ phase: "downloading", rev: 4 }))).toBe(false);
    expect(isNewerView(held, view({ rev: 5 }))).toBe(true);
    expect(isNewerView(held, view({ rev: 6 }))).toBe(true);
    expect(isNewerView(null, view({ rev: 1 }))).toBe(true);
  });
});

describe("건너뛰기", () => {
  it("건너뛴 판과 그보다 낮은 판은 숨고, 더 새 판은 보인다", () => {
    expect(isSkipped("0.1.2", "0.1.2")).toBe(true);
    expect(isSkipped("0.1.1", "0.1.2")).toBe(true);
    expect(isSkipped("0.1.3", "0.1.2")).toBe(false);
    expect(isSkipped("0.1.2", null)).toBe(false);
  });
  it("건너뛴 판은 칩도 알림도 없다", () => {
    const v = view({ skipped: "0.1.2" });
    expect(shownVersion(v)).toBeNull();
    expect(chipOf(v)).toEqual({ kind: "none" });
    expect(shouldToast(v)).toBe(false);
  });
  it("더 새 판이 나오면 다시 보인다", () => {
    const v = view({ skipped: "0.1.2", available: { version: "0.1.3", notes: "", date: null, page: "" } });
    expect(chipOf(v)).toEqual({ kind: "available", version: "0.1.3" });
    expect(shouldToast(v)).toBe(true);
  });
  it("[업데이트]를 고른 뒤에는 건너뛰기를 보지 않는다", () => {
    expect(chipOf(view({ skipped: "0.1.2", phase: "downloading" })).kind).toBe("downloading");
  });
  it("실패한 판을 건너뛰면 실패 칩이 걷힌다 — 다른 판의 실패는 그대로", () => {
    expect(chipOf(view({ skipped: "0.1.2", phase: "failed" })).kind).toBe("none");
    expect(chipOf(view({ skipped: "0.1.1", phase: "failed" })).kind).toBe("failed");
  });
});

describe("한 번만 알리기", () => {
  it("판마다 한 번", () => {
    expect(shouldToast(view())).toBe(true);
    expect(shouldToast(view({ toasted: "0.1.2" }))).toBe(false);
    expect(shouldToast(view({ toasted: "0.1.1" }))).toBe(true);
  });
  it("새 판이 아닐 때 · 받는 중에는 알리지 않는다", () => {
    expect(shouldToast(view({ phase: "idle", available: null }))).toBe(false);
    expect(shouldToast(view({ phase: "downloading" }))).toBe(false);
    expect(shouldToast(null)).toBe(false);
  });
});

describe("칩", () => {
  it("단계마다", () => {
    expect(chipOf(view({ phase: "idle", available: null }))).toEqual({ kind: "none" });
    expect(chipOf(view())).toEqual({ kind: "available", version: "0.1.2" });
    expect(chipOf(view({ phase: "downloading", received: 42, total: 100 }))).toEqual({
      kind: "downloading",
      version: "0.1.2",
      pct: 42,
    });
    expect(chipOf(view({ phase: "downloading", received: 42, total: null }))).toMatchObject({ pct: null });
    expect(chipOf(view({ phase: "ready" }))).toEqual({ kind: "ready", version: "0.1.2" });
    expect(chipOf(view({ phase: "installing" }))).toEqual({ kind: "installing", version: "0.1.2" });
    expect(chipOf(view({ phase: "failed", error: "x" }))).toEqual({ kind: "failed", version: "0.1.2" });
  });
});

describe("칩 글자(늘 영어)", () => {
  it("판 · 퍼센트 · 고정 영어 이름표", () => {
    expect(chipLabel({ kind: "available", version: "0.1.2" })).toBe("0.1.2");
    expect(chipLabel({ kind: "downloading", version: "0.1.2", pct: 42 })).toBe("42%");
    expect(chipLabel({ kind: "downloading", version: "0.1.2", pct: null })).toBe("…");
    expect(chipLabel({ kind: "ready", version: "0.1.2" })).toBe("Restart to update");
    expect(chipLabel({ kind: "failed", version: "0.1.2" })).toBe("Update failed");
    expect(chipLabel({ kind: "installing", version: "0.1.2" })).toBe(CHIP_TEXT.installing);
    expect(chipLabel({ kind: "none" })).toBe("");
  });
});

describe("진행 글자", () => {
  it("퍼센트는 0~100 정수 · 길이를 모르면 null", () => {
    expect(percent(14_200_000, 33_800_000)).toBe(42);
    expect(percent(200, 100)).toBe(100);
    expect(percent(5, 0)).toBeNull();
    expect(percent(5, null)).toBeNull();
  });
  it("MB 는 소수 한 자리", () => {
    expect(megabytes(14_200_000)).toBe("14.2");
    expect(megabytes(33_849_999)).toBe("33.8");
  });
});

describe("바쁜 세션 요약", () => {
  it("끝날 세션 · 바쁜 것 · 유휴", () => {
    const s = summarizeBusy({ sessions: 7, ai: ["aynx"], shell: ["npm run build"], plans: ["재시작"] });
    expect(s.sessions).toBe(7);
    expect(s.busy.map((b) => b.kind)).toEqual(["ai", "shell", "plan"]);
    expect(s.idle).toBe(5);
  });
  it("세션 수를 모르면 바쁜 세션 수 이상으로 잡는다 · 빈 이름은 ?", () => {
    const s = summarizeBusy({ sessions: null, ai: [" "], shell: [], plans: [] });
    expect(s).toEqual({ sessions: 1, busy: [{ kind: "ai", name: "?" }], idle: 0 });
  });
});
