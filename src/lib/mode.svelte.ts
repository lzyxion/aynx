import { untrack } from "svelte";
import { DEFAULT_TERM_PRESET, isDynamicTermKey, pairedPreset } from "$lib/theme";
import {
  APP_MODES,
  DEFAULT_APP_MODE,
  applySettings,
  cloneSettings,
  setDeviceView,
  settings,
  setTermPreset,
  syncAppColorTheme,
  syncAppColorThemeOn,
  type AppMode,
} from "$lib/settings.svelte.js";

/**
 * 앱 **모드**(다크 / 라이트) — 크롬 팔레트를 통째로 갈아 끼우는 한 칸
 * (docs/log/2026-09-04-light-theme.md).
 *
 * ## 어떻게 화면에 걸리나
 *
 * 이 모듈이 하는 일은 사실상 하나다: `<html>` 에 `data-theme="dark"|"light"` 를 적는다.
 * 색은 `theme.css` 의 `:root[data-theme="light"]` 블록이 전부 갖고 있고, 그 블록이 붙는
 * 순간 앱 전체(사이드바·탭·모달·스크롤바·토스트·시작 화면·타일 테두리)가 함께 뒤집힌다 —
 * 컴포넌트는 전부 토큰만 쓰기 때문에 **어느 `.svelte` 도 모드를 알 필요가 없다**.
 *
 * 속성을 쓰고 나면 세 가지 뒤처리를 한다:
 * 1. [`syncAppColorTheme`] — 선택한 색 계열을 새 밝기로 바꾼다. 월페이퍼 추출(full)도
 *    소스색을 알면 여기서 **같은 틱에** 바꾼다 — 속성만 먼저 뒤집히면 새 팔레트가 올 때까지
 *    라이트 속성 위에 다크 토큰이 남아 화면이 한 번 검게 깜빡인다.
 * 2. 터미널 프리셋 짝 교체 — 밝은 창 한가운데 검은 터미널이 남지 않게 (`pairedPreset`).
 * 3. [`applySettings`] — 파생 토큰(흐린 글자·오버 배경…)이 모드에 따라 다른 톤을 쓴다.
 *
 * ## 저장 위치는 `settings.toml` 의 `[app] mode` 다
 *
 * 다른 `[app]` 키와 완전히 같은 방식이다 — 기본값(`dark`)이면 키를 아예 적지 않고, 모르는
 * 값은 정규화가 버려 기본값으로 떨어진다. 이 모듈이 직접 아는 것은 [`readStored`] /
 * [`writeStored`] 두 함수뿐이고, 나머지(정규화·직렬화·[취소] 비교)는 설정 모듈의 배관을
 * 그대로 탄다.
 *
 * ## 부팅이 두 걸음인 이유
 *
 * 값이 파일에 있으므로 **동기로 읽을 수 없다**. 그래서 시작이 둘로 갈린다:
 * [`initAppMode`] 는 첫 프레임에 기본 Dark를 걸고, 설정이 도착하면 [`adoptStoredMode`] 가
 * 저장된 값을 입힌다. OS 밝기는 구독하지 않는다.
 *
 * ## 왜 이 모듈이 `settings.svelte.ts` 를 부르고 그 반대가 아닌가
 *
 * 의존 방향을 한쪽으로 못 박아 순환을 없앤 것이다. 설정 쪽도 "지금 라이트인가" 를 알아야
 * 하지만(파생 토큰의 톤이 달라진다), 이 모듈을 import 하는 대신 **`<html>` 의 속성을 직접
 * 읽는다** — 그 속성이 모드의 유일한 진실이고, 그것을 쓰는 곳이 여기 하나뿐이라 두 모듈이
 * 서로를 부르지 않아도 값이 어긋날 수 없다. 같은 이유로 후보 둘(`APP_MODES`)도 저쪽에 산다:
 * 정규화가 모르는 값을 걸러야 하기 때문이다.
 */

class AppModeStore {
  /** 사용자가 고른 값 — `settings.current.app.mode` 를 이 창에 펼쳐 둔 사본이다 */
  choice = $state<AppMode>(DEFAULT_APP_MODE);
  /**
   * 설정 파일에서 고른 값을 **이미 읽어 왔는가** ([`adoptStoredMode`] 가 켠다).
   *
   * 구독하는 쪽(`+page` 의 동적 색 재추출)이 "기본값으로 시작했다가 저장된 값으로 바뀐 것"
   * 을 사용자의 모드 변경으로 오인하지 않게 하는 문지기다 — 그 사이의 값은 아직 아무도
   * 고른 적이 없는 값이다.
   */
  settled = $state(false);
  /** 실제로 화면에 걸린 밝기 — `<html data-theme>` 에 그대로 적힌다(`$state` 를 읽는 getter — 반응형이고 시험이 컴파일러 없이 읽는다) */
  get resolved(): AppMode {
    return this.choice;
  }
}

export const appMode = new AppModeStore();

/** 지금 라이트 모드인가 (동적 색 추출이 다크/라이트 스킴을 고를 때 읽는다) */
export function isLightMode(): boolean {
  return appMode.resolved === "light";
}

/**
 * 설정에서 고른 값을 읽는다. **모르는 값은 조용히 기본값**이다 — 설정 파일의 모르는 키를
 * 다루는 규칙(`theme`·`tab_style`)과 같다. (정규화가 이미 한 번 걸렀지만, 여기서 한 번 더
 * 좁혀야 반환 타입이 `AppMode` 가 된다.)
 */
function readStored(): AppMode {
  const v = settings.current.app.mode;
  return v && v in APP_MODES ? (v as AppMode) : DEFAULT_APP_MODE;
}

/**
 * 고른 값을 설정에 적는다. 기본값이면 칸을 **비운다** (파일에 키가 남지 않는다 —
 * `tab_style`·`tiling` 과 같은 "기본값 추종" 규칙). 파일에 쓰는 것은 설정 [저장] 이다([`setAppMode`]).
 */
function writeStored(m: AppMode): void {
  settings.current.app.mode = m === DEFAULT_APP_MODE ? undefined : m;
}

/**
 * `<html data-theme>` 를 지금 값으로 맞춘다. **다크도 명시적으로 적는다** — 속성이 없는
 * 상태를 "다크" 로 읽는 규칙을 만들면 CSS 를 볼 때마다 그 암묵을 기억해야 한다.
 */
function writeAttr(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = deviceMode ?? appMode.resolved;
}

// ---------------------------------------------------------------------------
// **이 기기 밝기**(원격 폰 — 10-20). 폰 설정 화면의 [시스템 · 밝게 · 어둡게] 가 고른 밝기를 **화면에만** 건다 — `appMode` ·
// `settings.current` 는 메인 PC 의 값 그대로다(원격 창의 저장이 이 기기의 밝기를 집 PC 에 싣지 않게 · 설정 화면의 모드 단추도 메인 PC
// 의 값을 보인다). 밝기가 메인 PC 와 다르면 `settings.current` 의 **사본**에 모드 전환과 같은 규칙(크롬 색 계열 · 터미널 프리셋 짝)을
// 걸어 색 층에 얹는다(`setDeviceView` — 설정 모듈의 "이 기기 보기 층"). 거는 쪽은 `app/mobile` 하나이고, 폰 배치가 아니면 `null` 이다.
// ---------------------------------------------------------------------------

let deviceMode = $state<AppMode | null>(null);

/** 이 기기의 밝기를 건다(`null` = 메인 PC 설정 그대로) */
export function setDeviceMode(m: AppMode | null): void {
  if (deviceMode !== m) deviceMode = m;
}

/** 사본에 걸었나 — 걷을 때 한 번 다시 칠한다 */
let deviceViewOn = false;

/** 이 기기 밝기를 따라 사본을 다시 짓는다 — 메인 PC 의 설정 · 모드가 바뀌어도 따라간다(`initAppMode` 의 구독) */
function syncDeviceMode(): void {
  const want = deviceMode;
  const home = appMode.resolved;
  if (want === null || want === home) {
    untrack(() => {
      writeAttr();
      if (!deviceViewOn) return;
      deviceViewOn = false;
      setDeviceView(null);
      applySettings();
    });
    return;
  }
  const copy = cloneSettings(settings.current); // 읽기가 곧 구독이다 — 설정이 바뀌면 사본을 다시 짓는다
  untrack(() => {
    syncAppColorThemeOn(copy, want === "dark");
    // 터미널 프리셋 짝 — `setTermPreset` 과 같은 두 칸(사본에만)
    const next = pairedPreset(copy.terminal.theme, want === "light");
    if (next) {
      copy.terminal.theme = next === DEFAULT_TERM_PRESET ? undefined : next;
      if (!isDynamicTermKey(next) && copy.app.dynamic === "full") copy.app.dynamic = "off";
    }
    deviceViewOn = true;
    setDeviceView(copy);
    writeAttr();
    applySettings();
  });
}

/**
 * `<html data-material>` 를 지금 재질로 맞춘다 (2026-10-11 — `[app] material`, 기본 `glass`).
 * `data-theme` 과 같은 규칙이다: **기본값도 명시적으로 적는다**. 판·흐림은 `theme.css` 의 재질 절이
 * 이 속성 하나를 보고 전부 정하므로 어느 `.svelte` 도 재질을 알 필요가 없다. 재질은 모드와 독립된 축이라
 * 모드 뒤처리(프리셋 짝·파생 토큰)를 부르지 않는다 — 색은 그대로이고 판의 알파·흐림만 갈린다.
 */
function writeMaterialAttr(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.material = settings.material;
}

/**
 * 모드가 실제로 바뀐 뒤의 뒤처리. `resolved`가 달라졌을 때만 터미널 프리셋을 교체한다.
 */
function afterModeChange(): void {
  writeAttr();
  syncAppColorTheme(!isLightMode());
  // 터미널 프리셋을 짝으로 교체. 짝이 없으면(`light`·`dynamic`·모르는 키) 그대로 둔다.
  const next = pairedPreset(settings.current.terminal.theme, isLightMode());
  if (next) setTermPreset(next);
  // 파생 토큰(흐린 글자·오버 배경·저채도 배너)의 톤이 모드에 따라 갈린다.
  applySettings();
}

/**
 * 앱 시작 때 **한 번** 부른다 (`+page.svelte` 의 스크립트 본문, `loadSettings` **앞**).
 *
 * 고른 값은 아직 파일 안에 있으므로 첫 프레임에는 기본 모드 속성을 건다.
 *
 * 저장된 값을 입히는 것은 [`adoptStoredMode`] 다.
 */
export function initAppMode(): void {
  writeAttr();
  // 재질은 [저장]을 기다리지 않는 미리보기 값이라(설정 화면의 칩·[취소]·프로필 전환·다른 창의 저장이 모두
  // `settings.current` 를 바꾼다) 그 파생값을 구독해 그때그때 적는다. 첫 프레임은 기본(glass)이고, 설정이
  // 도착하면 같은 구독이 저장된 값으로 고친다 — 모드의 두 걸음과 같은 모양이다.
  $effect.root(() => {
    $effect(() => writeMaterialAttr());
    $effect(() => syncDeviceMode());
  });
}

/**
 * 설정을 읽은 **직후** 한 번 부른다 (`+page.svelte` 의 `boot`, `loadSettings` 바로 뒤).
 * 저장된 모드를 화면에 입힌다.
 *
 * 여기서는 터미널 프리셋 짝 교체를 하지 **않는다**: 저장된 프리셋은 이미 지난번 모드에
 * 맞춰 저장된 값이라, 켤 때마다 다시 짝을 찾으면 사용자가 일부러 고른 조합이 매번 덮인다.
 * 나머지 뒤처리(파생 토큰)는 **실제로 밝기가 달라졌을 때만** 한다 — 바로 앞의
 * `loadSettings` 가 첫 프레임의 밝기 기준으로 잡아 둔 값들이 그때 틀린 값이 되기 때문이다.
 */
export function adoptStoredMode(): void {
  applyStoredMode();
  appMode.settled = true;
}

/**
 * 설정 값이 **바깥에서 통째로 갈린 뒤** 화면을 그 값에 다시 맞춘다 — 설정 화면의 [취소]
 * (`revertSettings`)가 부른다.
 *
 * 모드 전환은 미저장 변경이라([`setAppMode`]) [취소] 는 그것까지 되돌린다 —
 * 그때 `settings.current.app.mode` 만 옛 값으로 돌아가고 화면은 새 모드로 남으면 두 값이
 * 어긋난다. (`revertSettings` 가 직접 부르지 않는 이유는 의존 방향이다 — 모듈 주석 참고.)
 */
export function syncStoredMode(): void {
  applyStoredMode();
}

/**
 * 설정에 적힌 값을 화면에 입힌다. 터미널 프리셋 짝 교체는 **하지 않는다** — 이 함수를 부르는
 * 두 자리(부팅·[취소]) 모두 프리셋이 이미 제 값이다. 나머지 뒤처리는 **실제로 밝기가
 * 달라졌을 때만** 한다.
 */
function applyStoredMode(): void {
  const before = appMode.resolved;
  appMode.choice = readStored();
  writeAttr();
  if (appMode.resolved !== before) {
    applySettings();
  }
}

/**
 * 모드를 고른다 (설정 화면의 Light/Dark 버튼 — 모드를 바꾸는 길은 이것 하나다). 모르는 값은 기본값으로 떨어진다.
 *
 * **곧바로 화면에 걸고, 저장은 설정 [저장] 이 한다**(2026-10-22 사용자 — 아이콘 · 색과 같은 미저장 변경). 딸려 바뀌는 크롬 색 계열과
 * 터미널 프리셋 짝도 같은 미저장 변경이다. [저장] 은 파일에 쓰고 고른 테마 프로필에도 반영하며(`settings/settings-close.ts` 의
 * `saveAndReflect`), [취소] · 닫기의 [저장 안 함] 은 `revertSettings`(색 · 프리셋까지 저장된 값으로) → [`syncStoredMode`](밝기 ·
 * `<html data-theme>`)로 되돌린다. 예전에는 곧바로 저장해 [저장] 을 지나지 않았고, 그래서 고른 프로필이 "(수정됨)" 으로 남았다.
 *
 * 동적 색 재추출은 여기서 하지 않는다 — 그건 `+page.svelte` 가 [`appMode`] 를 구독해
 * 처리한다 (이 모듈이 월페이퍼·이미지 디코딩까지 알 필요는 없다).
 */
export function setAppMode(m: string): void {
  const next = (m in APP_MODES ? m : DEFAULT_APP_MODE) as AppMode;
  if (next === appMode.choice) return;
  const before = appMode.resolved;
  appMode.choice = next;
  writeStored(next);
  if (appMode.resolved !== before) afterModeChange();
}
