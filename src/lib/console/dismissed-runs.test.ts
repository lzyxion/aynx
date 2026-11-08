import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISSED_RUNS_MAX, dismissRuns, isRunDismissed, resetDismissedRunsForTest } from "./dismissed-runs";

describe("dismissed-runs", () => {
  // node 환경에는 `localStorage` 가 없다 — 키 → 값 표로 심는다
  let store: Record<string, string> = {};
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
    } as Partial<Storage> as Storage);
    resetDismissedRunsForTest();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("치운 id 를 기억하고 저장소에서 다시 읽는다(F5 · 다른 창)", () => {
    dismissRuns(["op-a"]);
    expect(isRunDismissed("op-a")).toBe(true);
    expect(isRunDismissed("op-b")).toBe(false);
    resetDismissedRunsForTest();
    expect(isRunDismissed("op-a")).toBe(true);
  });

  it("상한을 넘으면 오래된 것부터 버린다", () => {
    dismissRuns(Array.from({ length: DISMISSED_RUNS_MAX + 3 }, (_, i) => `op-${i}`));
    expect(isRunDismissed("op-0")).toBe(false);
    expect(isRunDismissed(`op-${DISMISSED_RUNS_MAX + 2}`)).toBe(true);
  });

  it("깨진 저장소는 빈 목록으로 시작한다", () => {
    store["aynx:dismissed-runs"] = "{nope";
    expect(isRunDismissed("op-a")).toBe(false);
  });
});

describe("dismissed-runs — 저장소가 던질 때", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("모듈 상태만으로 기억한다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as Partial<Storage> as Storage);
    resetDismissedRunsForTest();
    dismissRuns(["op-x"]);
    expect(isRunDismissed("op-x")).toBe(true);
  });
});
