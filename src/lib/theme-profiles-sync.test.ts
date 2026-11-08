import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 상태 — 컴파일러 없이 평범한 값으로(`app/app-icons.test.ts` 와 같은 관례).
vi.hoisted(() => {
  const state = <T>(value: T) => value;
  vi.stubGlobal("$state", Object.assign(state, { raw: state }));
});

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, () => void>(),
}));
const board = vi.hoisted(() => ({
  applyStartBoard: vi.fn(),
  listener: null as null | ((b: unknown) => void),
}));

vi.mock("./ipc", () => ({
  invoke: ipc.invoke,
  isRemote: false,
  listen: async (name: string, fn: () => void) => {
    ipc.handlers.set(name, fn);
    return () => {};
  },
}));
vi.mock("$lib/start-widgets.svelte.js", () => ({
  applyStartBoard: board.applyStartBoard,
  onStartBoardChange: (fn: (b: unknown) => void) => (board.listener = fn),
  startBoardSnapshot: () => ({ widgets: [], clock: { hour12: false, seconds: false, date: true, size: 88 } }),
}));
vi.mock("$lib/settings.svelte.js", async () => {
  const { emptySettings } = await import("$lib/settings/model/normalize");
  return {
    settings: { current: emptySettings(), dirty: false },
    applySettings: vi.fn(),
    normalizeSettings: (s: unknown) => s,
    saveSettings: vi.fn(async () => {}),
  };
});
vi.mock("$lib/wallpaper.svelte.js", () => ({
  collectWallpapers: vi.fn(async () => {}),
  refreshWallpaper: vi.fn(async () => {}),
  wallpaperUrl: vi.fn(async () => ""),
}));
vi.mock("$lib/mode.svelte.js", () => ({ syncStoredMode: vi.fn() }));
vi.mock("$lib/app/confirm-dialog.svelte.js", () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/splash-memo", () => ({ rememberSplashUserIcon: vi.fn() }));

import {
  activeProfileId,
  loadThemeProfiles,
  renameThemeProfile,
  themeProfiles,
} from "$lib/theme-profiles.svelte.js";

/**
 * 모양 프로필의 **창 사이 맞추기** (2026-11-03) — 쓰기는 조작 단위 명령(`theme_profiles_edit`), 다른 창이 쓰면
 * `theme-profiles-changed` 로 다시 읽는다. 고른 프로필이 다른 창에서 바뀌면 그 프로필의 시작 화면 배치로 맞춘다.
 */

const boardA = { widgets: [], clock: { hour12: true, seconds: false, date: true, size: 88 } };
const boardB = {
  widgets: [{ kind: "hosts", x: 0, y: 0, w: 240, h: 208 }],
  clock: { hour12: false, seconds: true, date: false, size: 60 },
};
const prof = (id: string, name: string, startBoard?: unknown) => ({
  id,
  name,
  savedAt: 1,
  appearance: { app: {}, terminal: {}, wallpaper: {} },
  ...(startBoard ? { startBoard } : {}),
});
const fileOf = (active: string | null, profiles: unknown[]) => JSON.stringify({ version: 1, active, profiles });

let disk = fileOf("A", [prof("A", "밤", boardA), prof("B", "낮", boardB)]);
const edits: unknown[] = [];

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  ipc.invoke.mockImplementation(async (cmd: string, args?: { op: unknown }) => {
    if (cmd === "load_theme_profiles") return disk;
    if (cmd === "theme_profiles_edit") {
      edits.push(args?.op);
      return disk;
    }
    return undefined;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("모양 프로필 — 창 사이 맞추기", () => {
  it("처음 읽기 · 다른 창이 쓰면 다시 읽고, 고른 프로필이 바뀌면 그 배치로 맞춘다", async () => {
    await loadThemeProfiles();
    expect(activeProfileId()).toBe("A");
    expect(ipc.handlers.has("theme-profiles-changed")).toBe(true);

    // 다른 창: 이름을 바꿨다 — 목록만 다시 읽고 배치는 건드리지 않는다
    disk = fileOf("A", [prof("A", "밤", boardA), prof("B", "아침", boardB)]);
    ipc.handlers.get("theme-profiles-changed")!();
    await settle();
    expect(themeProfiles().map((p) => p.name)).toEqual(["밤", "아침"]);
    expect(board.applyStartBoard).not.toHaveBeenCalled();

    // 다른 창: B 를 골랐다 — 이 창의 시작 화면도 B 의 배치로
    disk = fileOf("B", [prof("A", "밤", boardA), prof("B", "아침", boardB)]);
    ipc.handlers.get("theme-profiles-changed")!();
    await settle();
    expect(activeProfileId()).toBe("B");
    expect(board.applyStartBoard).toHaveBeenCalledTimes(1);
    expect(board.applyStartBoard).toHaveBeenCalledWith(boardB);
  });

  it("배치 자동 저장은 바뀐 순간의 프로필로 — 그사이 다른 창이 고른 것을 바꿔도 앞 프로필에 담긴다", async () => {
    vi.useFakeTimers();
    edits.length = 0;
    board.applyStartBoard.mockClear();
    // 지금 고른 것 = B. 이 창에서 배치를 옮겼다(400ms 묶기 중)
    board.listener!(boardA);
    await settle();
    // 다른 창이 A 를 골랐다는 알림 — 기다리던 배치는 B 로 먼저 간다
    disk = fileOf("A", [prof("A", "밤", boardA), prof("B", "아침", boardB)]);
    ipc.handlers.get("theme-profiles-changed")!();
    await settle();
    expect(edits).toEqual([{ op: "board", id: "B", board: boardA }]);
    expect(activeProfileId()).toBe("A");
    expect(board.applyStartBoard).toHaveBeenCalledWith(boardA);
    vi.advanceTimersByTime(1000);
    await settle();
    expect(edits).toHaveLength(1); // 묶기 시계가 다시 쏘지 않는다
  });

  it("이름 바꾸기 = 조작 하나만 보낸다(목록 통째가 아니다)", async () => {
    edits.length = 0;
    expect(renameThemeProfile("A", "새벽")).toBe(true);
    await settle();
    expect(edits).toEqual([{ op: "rename", id: "A", name: "새벽" }]);
  });
});
