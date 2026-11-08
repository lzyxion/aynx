import { beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 상태 — 컴파일러 없이 평범한 값으로(`app/confirm-dialog.test.ts` 와 같은 관례).
vi.hoisted(() => {
  const state = <T>(value: T) => value;
  vi.stubGlobal("$state", Object.assign(state, { raw: state }));
});
const mocks = vi.hoisted(() => ({
  applySettings: vi.fn(),
  saveSettings: vi.fn(async () => {}),
  setTermPreset: vi.fn(),
  syncAppColorTheme: vi.fn(),
}));
vi.mock("$lib/settings.svelte.js", async () => {
  const { emptySettings, cloneSettings } = await import("$lib/settings/model/normalize");
  const { APP_MODES, DEFAULT_APP_MODE } = await import("$lib/settings/model/options");
  return {
    APP_MODES,
    DEFAULT_APP_MODE,
    cloneSettings,
    settings: { current: emptySettings(), saved: emptySettings(), dirty: false },
    setDeviceView: vi.fn(),
    syncAppColorThemeOn: vi.fn(),
    ...mocks,
  };
});

import { emptySettings, cloneSettings, sameSettings } from "$lib/settings/model/normalize";
import { settings } from "$lib/settings.svelte.js";
import { appMode, setAppMode, syncStoredMode } from "./mode.svelte.js";

/**
 * 모드 전환은 **미저장 변경**이다(2026-10-22 사용자 — docs/log/2026-10-22-settings-close-asks-save.md): 곧바로 걸지만 저장은
 * 설정 [저장](고른 테마 프로필 반영 포함 — `saveAndReflect`)이 하고, [취소] 는 `revertSettings` → `syncStoredMode` 로 되돌린다.
 */
describe("앱 모드 전환 = 미저장 변경", () => {
  beforeEach(() => {
    settings.current = emptySettings();
    settings.saved = emptySettings();
    appMode.choice = "dark";
    Object.values(mocks).forEach((m) => m.mockClear());
  });

  it("곧바로 걸고(색 계열 · 프리셋 짝 · 토큰) 저장하지 않는다 — 저장된 값과 달라진다", () => {
    setAppMode("light");
    expect(appMode.resolved).toBe("light");
    expect(settings.current.app.mode).toBe("light");
    expect(mocks.syncAppColorTheme).toHaveBeenCalledWith(false);
    expect(mocks.applySettings).toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(sameSettings(settings.current, settings.saved)).toBe(false); // = dirty
  });

  it("미저장 편집이 없어도 저장하지 않는다(예전의 곧바로 저장 없음)", () => {
    setAppMode("light");
    setAppMode("dark");
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(settings.current.app.mode).toBeUndefined(); // 기본(dark)은 빈 칸
  });

  it("[취소] — 저장된 값으로 돌린 뒤(`revertSettings`) syncStoredMode 가 밝기를 되돌린다", () => {
    setAppMode("light");
    settings.current = cloneSettings(settings.saved); // revertSettings 의 몸
    syncStoredMode();
    expect(appMode.resolved).toBe("dark");
    expect(sameSettings(settings.current, settings.saved)).toBe(true);
  });
});
