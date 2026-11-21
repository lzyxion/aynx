import { listen } from "./ipc";
import {
  SETTINGS_SAVED_EVENT,
  applyStoredLanguage,
  loadSettings,
  settings,
  thisWindowLabel,
  type SettingsSavedPayload,
} from "$lib/settings.svelte.js";
import { syncStoredMode } from "$lib/mode.svelte.js";
import { refreshWallpaper } from "$lib/wallpaper.svelte.js";
import { loadUserTermThemes } from "$lib/app/term-themes.svelte.js";
import { refreshAvatars } from "$lib/avatars.svelte.js";

/**
 * 다른 창에서 저장된 설정을 이 창이 받아 입는다(docs/log/2026-09-05-settings-sync.md).
 * 이 창에 미저장 편집이 있으면 덮지 않고 깃발만 세운다 — 무엇을 버릴지는 사람이 고른다.
 * 알려진 한계: 설정 모달을 `×` 로 닫아 미저장 변경이 남은 창은 다음에 모달을 열 때까지 옛 값을 쓴다.
 */

export const settingsExternal = $state<{ pending: boolean }>({ pending: false });

/**
 * 동적 색을 다시 뽑지 않는다 — 뽑은 팔레트는 이미 파일에 있고, 재추출은 저장으로 이어져 창들이 서로를 깨우는 고리가 된다.
 * `refreshWallpaper` 는 저장을 부르지 않으므로 이벤트가 되돌아오지 않는다.
 */
export async function adoptExternalSettings(): Promise<void> {
  // 먼저 내린다 — 마지막에 내리면 `await` 사이에 온 새 이벤트의 깃발까지 지운다
  settingsExternal.pending = false;
  await loadSettings();
  await loadUserTermThemes();
  await refreshAvatars();
  syncStoredMode();
  applyStoredLanguage();
  await refreshWallpaper();
}

/** 방송은 자기 자신에게도 도착한다 — 안 거르면 저장 직후 `current` 가 통째로 갈려 편집 커서 · 스크롤이 흔들린다 */
export function listenSettingsSaved(): Promise<() => void> {
  return listen<SettingsSavedPayload>(SETTINGS_SAVED_EVENT, (ev) => {
    if (ev.payload?.from === thisWindowLabel()) return;
    if (settings.dirty) {
      settingsExternal.pending = true;
      return;
    }
    void adoptExternalSettings();
  });
}
