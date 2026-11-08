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
 * **다른 창에서 저장된 설정을 이 창이 받아 입는다** (docs/log/2026-09-05-settings-sync.md).
 *
 * 설정 파일은 앱에 하나뿐인데 창은 여럿이다 (탭·타일 티어아웃으로 얼마든지 늘어난다).
 * 예전에는 창마다 부팅 때 `loadSettings` 를 한 번 하고 끝이라, 티어아웃 창의 설정 모달에서
 * 바꾼 값이 그 창에만 걸리고 나머지는 앱을 다시 켜야 따라왔다.
 *
 * ## 왜 이 모듈이 `settings.svelte.ts` 와 따로 있나 — **순환**
 *
 * 보내는 쪽(`SETTINGS_SAVED_EVENT`·`emitSettingsSaved`)은 저기 산다. 저장하는 함수 옆이
 * 그 자리이기 때문이다. 반면 **받는 쪽**은 다시 읽은 값을 화면에 입히느라 `mode` 와
 * `wallpaper` 를 불러야 하는데, 그 둘은 이미 `settings.svelte.ts` 를 부르고 있다 —
 * 저기에 두면 서로가 서로를 부르는 고리가 된다 (`npm run check:cycles`). 그래서 몸통만
 * 이쪽으로 뺐고, 의존은 한 방향뿐이다:
 *
 *     settings-sync → { settings, mode, wallpaper }
 *
 * ## 적용 경로를 **새로 파지 않는다**
 *
 * 이 설계의 요점이다. [`adoptExternalSettings`] 가 명시적으로 부르는 것은 셋뿐이고
 * (다시 읽기 · 모드 · 월페이퍼 파일), 나머지는 전부 `settings.current`(= `$state`)를 이미
 * 구독하고 있는 기존 `$derived`/`$effect` 가 알아서 다시 돈다 — 터미널 프리셋·글꼴·투명도,
 * 트리거, 단축키 레지스트리, 타일 배치·헤더, 탭 모양, 기본 셸, 크롬 투명도.
 * 즉 "바깥에서 값이 갈렸다" 는 설정 화면의 [취소](`revertSettings`)와 **같은 종류의 사건**
 * 이고, 그 길은 이미 나 있다.
 *
 * ## `dirty` 면 덮지 않는다
 *
 * 이 창의 설정 모달에 **저장하지 않은 편집**이 남아 있으면 조용히 덮어쓰지 않는다 —
 * 사용자가 30분 손본 트리거 목록이 남의 창의 [저장] 한 번에 사라지면 안 된다. 대신
 * [`settingsExternal`] 의 깃발만 세우고, 설정 화면이 배너 한 줄로 알린다
 * ("다른 창에서 설정이 바뀌었습니다 — [다시 읽기]"). 무엇을 버릴지는 사람이 고른다.
 *
 * ## 알려진 한계
 *
 * 설정 모달을 [저장]·[취소] 없이 헤더 `×` 로 닫아 **미저장 변경이 남은 창**은 그 상태로
 * 계속 옛 값을 쓴다. 배너를 걸 화면이 그 창에 없기 때문이다 — 그런 창은 다음에 설정 모달을
 * 열 때 배너로 알게 된다 (깃발은 모듈 상태라 그때까지 남아 있다).
 */

/**
 * 다른 창의 저장이 **아직 반영되지 않은 채 밀려 있는가**.
 *
 * 이 창에 미저장 편집이 있어서 자동으로 덮지 못했다는 뜻이다. 읽는 곳은 설정 화면의
 * 배너 하나뿐이고, 내리는 곳은 셋이다 — [`adoptExternalSettings`](다시 읽었다),
 * 설정 화면의 [저장](내 값이 파일을 이겼다), [취소](편집을 버렸다).
 *
 * 클래스가 아니라 객체 한 칸인 이유는 든 것이 깃발 하나뿐이라서다 (`settingsNav` 와 같은 모양).
 */
export const settingsExternal = $state<{ pending: boolean }>({ pending: false });

/**
 * 파일을 **다시 읽어** 이 창에 입힌다.
 *
 * 부르는 곳은 둘이다: 이벤트를 받았고 이 창에 미저장 편집이 없을 때(자동), 그리고 배너의
 * [다시 읽기] 를 눌렀을 때(수동 — 이때는 이 창의 편집이 사라진다).
 *
 * 명시적으로 하는 일은 셋뿐이다.
 *
 * 1. `loadSettings()` — 정규화 · `current`/`saved` 교체 · `applySettings()` 가 그 안에 다 있다.
 *    실패를 삼키므로 여기서 던질 일이 없다 (못 읽었으면 지금 값 그대로 남는다).
 * 2. `syncStoredMode()` — `[app] mode` 는 값만 바꿔서는 화면에 안 걸린다. `<html data-theme>`
 *    속성과 기본 토큰·파생 토큰을 새 밝기에 맞추는 곳이 저기 하나다 (설정 화면의 [취소] 가
 *    같은 이유로 같은 함수를 부른다).
 * 3. `refreshWallpaper()` — 다른 창이 **배경 이미지 자체**를 바꿨을 수 있다. 그릴 URL 은
 *    설정 값이 아니라 백엔드에 물어봐야 나오는 절대 경로라(`wallpaper.svelte.ts` 머리말),
 *    설정만 다시 읽어서는 옛 사진이 그대로 남는다. 이 함수는 실패를 삼키고, **저장을 부르지
 *    않으므로** 이벤트가 되돌아오지 않는다.
 *
 * **동적 색을 다시 뽑지는 않는다.** 이유가 둘이다. 하나, 뽑아낸 팔레트는 이미 파일 안에
 * 있어서(`[app]` 여덟 칸 + `[terminal.dynamic]`) 방금 다시 읽은 값이 곧 그 결과다 — 사진을
 * 한 번 더 디코딩해 봐야 같은 색이 나온다. 둘, 재추출은 **저장으로 이어진다**
 * (`dynamic-theme.svelte.ts` 의 `modeChanged`) — 받은 창이 저장하면 그 저장이 다시 이벤트를
 * 쏘아 창들이 서로를 깨우는 고리가 된다.
 */
export async function adoptExternalSettings(): Promise<void> {
  // 먼저 내린다 — 아래 `await` 들 사이에 또 한 번 이벤트가 와도 그쪽이 다시 세우면 되고,
  // 반대로 마지막에 내리면 그 새 이벤트의 깃발까지 같이 지워 버린다.
  settingsExternal.pending = false;
  await loadSettings();
  // 다른 창이 테마를 가져와 고르고 저장했을 수 있다 — `user:` 키를 풀 목록도 다시 읽는다.
  await loadUserTermThemes();
  // 다른 창이 아바타를 넣고 앱 아이콘 · CLI 아바타로 골라 저장했을 수 있다 — `user-<12hex>` 를 풀 목록도 다시 읽는다(10-31).
  await refreshAvatars();
  syncStoredMode();
  // 2-b. `applyStoredLanguage()` — 화면 언어도 같은 이유로 다시 건다. `[app] language` 는
  //      값만 바뀌어서는 화면에 안 걸린다 (`i18n` 의 `$state` 와 `<html lang>` 이 그 자리다).
  applyStoredLanguage();
  await refreshWallpaper();
}

/**
 * 다른 창의 저장 알림을 듣는다 — `mountAppListeners` 가 창 수명 동안 걸어 둔다.
 *
 * 방송은 **자기 자신에게도** 도착하므로 짐의 창 라벨로 먼저 거른다. 안 거르면 저장할 때마다
 * 자기가 방금 쓴 파일을 다시 읽어 오고(무해하지만 낭비다), 무엇보다 그 다시 읽기가 저장
 * 직후의 `current` 를 한 번 통째로 갈아 끼워 설정 화면의 편집 커서·스크롤이 흔들린다.
 */
export function listenSettingsSaved(): Promise<() => void> {
  return listen<SettingsSavedPayload>(SETTINGS_SAVED_EVENT, (ev) => {
    if (ev.payload?.from === thisWindowLabel()) return;
    // 미저장 편집이 있으면 **덮지 않는다** — 깃발만 세우고 사람이 고르게 한다 (머리말).
    if (settings.dirty) {
      settingsExternal.pending = true;
      return;
    }
    void adoptExternalSettings();
  });
}
