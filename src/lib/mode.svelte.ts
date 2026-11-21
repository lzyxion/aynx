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
 * 앱 모드(다크 / 라이트) — `<html data-theme>` 가 모드의 유일한 진실이고 쓰는 곳은 이 모듈 하나다.
 * 설정 모듈은 이 모듈을 부르지 않고 그 속성을 직접 읽는다 — 의존 방향을 한쪽으로 못 박아 순환을 없앤다.
 */

class AppModeStore {
  choice = $state<AppMode>(DEFAULT_APP_MODE);
  /** 저장된 값을 읽어 왔는가 — 구독하는 쪽이 기본값 → 저장된 값 바뀜을 사용자의 모드 변경으로 오인하지 않게 */
  settled = $state(false);
  /** getter 다 — 반응형이고 시험이 컴파일러 없이 읽는다 */
  get resolved(): AppMode {
    return this.choice;
  }
}

export const appMode = new AppModeStore();

export function isLightMode(): boolean {
  return appMode.resolved === "light";
}

function readStored(): AppMode {
  const v = settings.current.app.mode;
  return v && v in APP_MODES ? (v as AppMode) : DEFAULT_APP_MODE;
}

/** 기본값이면 칸을 비운다(파일에 키가 남지 않는다) */
function writeStored(m: AppMode): void {
  settings.current.app.mode = m === DEFAULT_APP_MODE ? undefined : m;
}

/** 다크도 명시적으로 적는다 — 속성 없음을 다크로 읽는 암묵 규칙을 만들지 않는다 */
function writeAttr(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = deviceMode ?? appMode.resolved;
}

// ── 이 기기 밝기(원격 폰) ──
// 화면에만 건다 — `appMode` · `settings.current` 는 메인 PC 값 그대로다(원격 창의 저장이 이 기기의 밝기를 메인 PC 에 싣지 않게).
// 밝기가 다르면 `settings.current` 의 사본에 모드 전환과 같은 규칙을 걸어 색 층에 얹는다(`setDeviceView`).

let deviceMode = $state<AppMode | null>(null);

/** `null` = 메인 PC 설정 그대로 */
export function setDeviceMode(m: AppMode | null): void {
  if (deviceMode !== m) deviceMode = m;
}

/** 걷을 때 한 번 다시 칠한다 */
let deviceViewOn = false;

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

/** 기본값도 명시적으로 적는다(`data-theme` 과 같은 규칙) */
function writeMaterialAttr(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.material = settings.material;
}

function afterModeChange(): void {
  writeAttr();
  // 속성과 같은 틱에 색 계열을 바꾼다 — 늦으면 라이트 속성 위에 다크 토큰이 남아 화면이 한 번 검게 깜빡인다
  syncAppColorTheme(!isLightMode());
  // 짝이 없으면(`light`·`dynamic`·모르는 키) 그대로 둔다
  const next = pairedPreset(settings.current.terminal.theme, isLightMode());
  if (next) setTermPreset(next);
  // 파생 토큰의 톤이 모드에 따라 갈린다
  applySettings();
}

/** `+page.svelte` 에서 `loadSettings` 앞에 한 번 — 값이 파일에 있어 동기로 읽을 수 없으니 첫 프레임은 기본 모드다 */
export function initAppMode(): void {
  writeAttr();
  // 재질은 [저장]을 기다리지 않는 미리보기 값이라 `settings.current` 를 구독해 그때그때 적는다
  $effect.root(() => {
    $effect(() => writeMaterialAttr());
    $effect(() => syncDeviceMode());
  });
}

/**
 * `loadSettings` 바로 뒤에 한 번. 터미널 프리셋 짝 교체는 하지 않는다 — 켤 때마다 짝을 찾으면 사용자가 고른 조합이 매번 덮인다.
 */
export function adoptStoredMode(): void {
  applyStoredMode();
  appMode.settled = true;
}

/** 설정 [취소](`revertSettings`)가 부른다 — 안 부르면 `settings.current.app.mode` 와 화면 모드가 어긋난다 */
export function syncStoredMode(): void {
  applyStoredMode();
}

/** 프리셋 짝 교체는 하지 않는다(부팅 · [취소] 모두 프리셋이 이미 제 값) · 파생 토큰은 밝기가 실제로 달라졌을 때만 */
function applyStoredMode(): void {
  const before = appMode.resolved;
  appMode.choice = readStored();
  writeAttr();
  if (appMode.resolved !== before) {
    applySettings();
  }
}

/**
 * 모드를 바꾸는 길은 이것 하나다. 곧바로 화면에 걸고 저장은 설정 [저장] 이 한다 — 딸린 크롬 색 계열 · 터미널 프리셋 짝도 같은 미저장 변경이다.
 */
export function setAppMode(m: string): void {
  const next = (m in APP_MODES ? m : DEFAULT_APP_MODE) as AppMode;
  if (next === appMode.choice) return;
  const before = appMode.resolved;
  appMode.choice = next;
  writeStored(next);
  if (appMode.resolved !== before) afterModeChange();
}
