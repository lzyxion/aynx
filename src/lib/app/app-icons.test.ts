import { beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 상태 — 컴파일러 없이 평범한 값으로(`confirm-dialog.test.ts` 와 같은 관례).
vi.hoisted(() => {
  const state = <T>(value: T) => value;
  vi.stubGlobal("$state", Object.assign(state, { raw: state }));
});
const store = vi.hoisted(() => ({ applySettings: vi.fn(), saveSettings: vi.fn(async () => {}) }));
const overwriteProfileWithCurrent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("$lib/settings/model/store.svelte.js", async () => {
  const { emptySettings } = await import("$lib/settings/model/normalize");
  return { settings: { current: emptySettings(), saved: emptySettings() }, ...store };
});
vi.mock("$lib/theme-profiles.svelte.js", () => ({ overwriteProfileWithCurrent, profilesUsingIcon: async () => 0 }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/splash-memo", () => ({ rememberSplashUserIcon: vi.fn() }));
vi.mock("../ipc", () => ({ invoke: vi.fn(), isRemote: false }));

import { emptySettings, sameSettings } from "$lib/settings/model/normalize";
import { setAppIcon } from "$lib/settings/model/actions-appearance";
import { settings } from "$lib/settings/model/store.svelte.js";
import { pickUserAppIcon } from "./app-icons.svelte.js";

/**
 * 앱 아이콘 고르기는 **미저장 변경**이다(2026-10-22 사용자 — docs/log/2026-10-22-custom-app-icon.md): 곧바로 걸어 미리 보이고
 * (`applySettings` → `syncAppIcon`), 저장 · 테마 프로필 덮어쓰기는 설정 [저장](`SettingsModal` 의 `save`)만 한다.
 */
describe("앱 아이콘 고르기 = 미저장 변경", () => {
  beforeEach(() => {
    settings.current = emptySettings();
    settings.saved = emptySettings();
    store.applySettings.mockClear();
    store.saveSettings.mockClear();
    overwriteProfileWithCurrent.mockClear();
  });

  it("내장 칩 — 곧바로 걸지만 저장하지 않고 묻지 않는다", () => {
    setAppIcon("claude");
    expect(settings.current.app.app_icon).toBe("claude");
    expect(store.applySettings).toHaveBeenCalledTimes(1);
    expect(store.saveSettings).not.toHaveBeenCalled();
    expect(overwriteProfileWithCurrent).not.toHaveBeenCalled();
    expect(sameSettings(settings.current, settings.saved)).toBe(false); // = dirty
  });

  it("내 아이콘 칩도 같은 길 — 저장 · 묻기 없음", () => {
    pickUserAppIcon({ id: "user-0123456789ab", src: "data:image/png;base64,AA" });
    expect(settings.current.app.app_icon).toBe("user-0123456789ab");
    expect(store.saveSettings).not.toHaveBeenCalled();
    expect(overwriteProfileWithCurrent).not.toHaveBeenCalled();
  });

  it("기본(gpt)으로 돌리면 칸을 비운다 — 저장된 기본과 같아 미저장 변경이 사라진다", () => {
    setAppIcon("claude");
    setAppIcon("gpt");
    expect(settings.current.app.app_icon).toBeUndefined();
    expect(sameSettings(settings.current, settings.saved)).toBe(true);
  });
});
