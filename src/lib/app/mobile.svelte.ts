// **원격 창의 모바일 상태**(원격 웹 R5) — 폭 · 터치 · 페이지 보임 · 끈적 Ctrl · "이 기기 크기로 맞추기". 판정은 순수 `$lib/mobile/policy`.
//
// 집 PC 창에서는 아무것도 하지 않는다 — `startMobile` 은 원격 부팅에서만 불리고, 원격이 아니면 모든 판정이 데스크톱 그대로다.
// "이 기기 크기로 맞추기" 는 이 브라우저의 편의라 `localStorage` 에 둔다(없거나 막혀도 기본값 — 끔).
//
// **이 기기 설정**(10-20 — 폰 설정 화면 `mobile/MobileSettings`): 터미널 글자 크기 · 밝기(메인 PC(기본) · 시스템 · 밝게 · 어둡게) · 키 띠도 같은 결로
// 이 브라우저의 `localStorage` 에만 산다(읽기 · 쓰기는 모두 try/catch — 막히면 이 페이지 동안만). 집 PC 의 `settings.toml` 에는 가지
// 않는다 — 화면에 거는 길은 설정 모듈의 "이 기기 보기 층"(`setDeviceFontSize`)과 `mode.svelte.ts` 의 `setDeviceMode` 이고, 둘 다
// **폰 배치일 때만** 건다(넓은 원격 창 · 집 PC 창은 늘 메인 PC 설정 그대로).
//
// **입력 방식**(10-20): `field`(기본 — 한 줄 입력 칸에 쓰고 보낸다) · `direct`(터미널을 눌러 화면 키보드로 바로). 이것도 이 브라우저의
// `localStorage` 에만. 입력 칸 방식이면 터미널이 자기 textarea 대신 띠의 입력 칸에 포커스를 넘긴다(`lineFieldMode` · `focusLineField` —
// 칸 요소는 `mobile/MobileKeys` 가 걸어 둔다). 폰 배치가 아니면(넓은 원격 창 · 집 PC 창) 늘 바로 입력 그대로다.

// **AI 타일 첫 화면**(2026-11-04): `convo`(기본 — 폰에서 AI 타일을 처음 볼 때 대화 면으로 · `pane/AiFlip`) · `term`. 이것도 이 브라우저의 `localStorage` 에만.

import { isRemote } from "$lib/ipc";
import { setDeviceFontSize, settings } from "$lib/settings.svelte.js";
import { setDeviceMode } from "$lib/mode.svelte.js";
import {
  clampFont,
  defaultStrip,
  isDefaultStrip,
  parseAiFace,
  parseFont,
  parseInputMode,
  parseStrip,
  parseTheme,
  resolveTheme,
  serializeAiFace,
  serializeInputMode,
  serializeStrip,
  serializeTheme,
  type AiFace,
  type InputMode,
  type StripPrefs,
  type ThemePref,
} from "$lib/mobile/prefs";
import {
  isHandheld,
  isMobileLayout,
  MOBILE_MAX_WIDTH,
  preferDomRenderer,
  sizeOwnerEligible,
  wantsViewer,
  type DeviceState,
} from "$lib/mobile/policy";

const FIT_KEY = "aynx.remote.fitHere";
const FONT_KEY = "aynx.remote.fontSize";
const THEME_KEY = "aynx.remote.theme";
const STRIP_KEY = "aynx.remote.keyStrip";
const INPUT_KEY = "aynx.remote.inputMode";
const AI_FACE_KEY = "aynx.remote.aiFace";

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // 막힌 저장소 — 기본값
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 막힌 저장소 — 이 페이지 동안만 */
  }
}

let fontPref = $state<number | null>(null);
let themePref = $state<ThemePref>("main");
let strip = $state<StripPrefs>(defaultStrip());
let inputPref = $state<InputMode>("field");
let aiFace = $state<AiFace>("convo");
/** 띠의 입력 칸(입력 칸 방식일 때 `MobileKeys` 가 건다) — 반응형이 아니어도 된다(누를 때 한 번 읽는다) */
let lineField: HTMLInputElement | null = null;
let osDark = $state(true);

let narrow = $state(false);
let coarse = $state(false);
let pageVisible = $state(true);
let fitHere = $state(false);
let ctrlArmed = $state(false);
let started = false;

function device(): DeviceState {
  return { remote: isRemote, narrow, coarse, fitHere };
}

/** 원격 부팅에서 한 번 — 폭 · 터치 · 페이지 보임을 듣는다 */
export function startMobile(): void {
  if (!isRemote || started || typeof window === "undefined") return;
  started = true;
  const wide = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH - 1}px)`);
  const touch = window.matchMedia("(pointer: coarse)");
  narrow = wide.matches;
  coarse = touch.matches;
  wide.addEventListener("change", (e) => (narrow = e.matches));
  touch.addEventListener("change", (e) => (coarse = e.matches));
  pageVisible = document.visibilityState !== "hidden";
  document.addEventListener("visibilitychange", () => (pageVisible = document.visibilityState !== "hidden"));
  // 화면 키보드 · 주소 줄을 뺀 높이 — 모바일 배치(`.app.mobile`)가 `--app-h` 로 쓴다(키 띠가 키보드 밑에 숨지 않게).
  const vv = window.visualViewport;
  if (vv) {
    const setHeight = () => document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    setHeight();
    vv.addEventListener("resize", setHeight);
  }
  try {
    fitHere = localStorage.getItem(FIT_KEY) === "1";
  } catch {
    /* 막힌 저장소 — 기본값 */
  }
  fontPref = parseFont(readKey(FONT_KEY));
  themePref = parseTheme(readKey(THEME_KEY));
  strip = parseStrip(readKey(STRIP_KEY));
  inputPref = parseInputMode(readKey(INPUT_KEY));
  aiFace = parseAiFace(readKey(AI_FACE_KEY));
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  osDark = scheme.matches;
  scheme.addEventListener("change", (e) => (osDark = e.matches));
  // 이 기기 값은 폰 배치일 때만 화면에 건다 — 넓어지면(가로 · 데스크톱 브라우저) 메인 PC 설정 그대로
  $effect.root(() => {
    $effect(() => {
      const on = isMobileLayout(device());
      setDeviceFontSize(on ? fontPref : null);
      setDeviceMode(on ? resolveTheme(themePref, osDark) : null);
    });
  });
}

/** 폰 터미널 글자 크기 — 이 기기 값(없으면 메인 PC 설정) */
export function terminalFontSize(): number {
  return fontPref ?? settings.fontSize;
}

/** 이 기기 글자 크기를 한 칸 옮긴다 — 메인 PC 값과 같아지면 이 기기 값을 지운다(그 뒤로는 메인 PC 를 따른다) */
export function stepTerminalFont(by: number): void {
  const next = clampFont(terminalFontSize() + by);
  fontPref = next === settings.fontSize ? null : next;
  writeKey(FONT_KEY, fontPref === null ? null : String(fontPref));
}

/** 이 기기 밝기 고름(`main` = 메인 PC 설정 그대로 — 기본) */
export function themeChoice(): ThemePref {
  return themePref;
}

export function setThemeChoice(pref: ThemePref): void {
  themePref = pref;
  writeKey(THEME_KEY, serializeTheme(pref));
}

/** 키 띠 설정(순서 · 숨김) */
export function keyStrip(): StripPrefs {
  return strip;
}

export function setKeyStrip(next: StripPrefs): void {
  strip = next;
  writeKey(STRIP_KEY, isDefaultStrip(next) ? null : serializeStrip(next));
}

/** 폰 입력 방식(이 기기 값 · 기본 `field`) */
export function inputMode(): InputMode {
  return inputPref;
}

export function setInputMode(mode: InputMode): void {
  inputPref = mode;
  writeKey(INPUT_KEY, serializeInputMode(mode));
}

/** 폰에서 AI 타일의 첫 화면(이 기기 값 · 기본 `convo`) */
export function aiFacePref(): AiFace {
  return aiFace;
}

export function setAiFacePref(face: AiFace): void {
  aiFace = face;
  writeKey(AI_FACE_KEY, serializeAiFace(face));
}

/** 지금 입력 칸 방식인가 — 폰 배치 + `field`. 아니면 터미널이 바로 입력을 받는다(오늘 그대로) */
export function lineFieldMode(): boolean {
  return inputPref === "field" && isMobileLayout(device());
}

/** 띠의 입력 칸을 건다(떼는 함수를 돌려준다 — 내가 건 그 칸일 때만 뗀다) */
export function registerLineField(el: HTMLInputElement): () => void {
  lineField = el;
  return () => {
    if (lineField === el) lineField = null;
  };
}

/** 입력 칸 방식이면 띠의 입력 칸에 포커스를 준다 — 줬으면 `true`(칸이 없거나 막혀 있으면 `false` — 부르는 쪽이 그대로 둔다) */
export function focusLineField(): boolean {
  const el = lineField;
  if (!lineFieldMode() || !el || el.disabled || !el.isConnected) return false;
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  return true;
}

/** 타일 하나 + 띠 배치인가(원격 · 좁은 폭) */
export function mobileLayout(): boolean {
  return isMobileLayout(device());
}

/** 폰 취급 기기인가(크기 주인 기본 거짓 · 길게 누르면 메뉴 · DOM 렌더러) */
export function handheld(): boolean {
  return isHandheld(device());
}

/** 시청자로 붙을 때 실을 크기 주인 자격 */
export function viewerEligible(): boolean {
  return sizeOwnerEligible(device());
}

/** 이 터미널 타일이 지금 시청자로 붙어 있어야 하나(`tileShown` = 화면에 그려지는 타일) */
export function viewerWanted(tileShown: boolean): boolean {
  return wantsViewer(device(), pageVisible, tileShown);
}

export function pageShown(): boolean {
  return pageVisible;
}

/** WebGL 대신 DOM 렌더러로 그리나 */
export function domRendererOnly(): boolean {
  return preferDomRenderer(device());
}

/** "이 기기 크기로 맞추기" 가 켜져 있나 */
export function fitThisDevice(): boolean {
  return fitHere;
}

export function setFitThisDevice(on: boolean): void {
  fitHere = on;
  try {
    localStorage.setItem(FIT_KEY, on ? "1" : "0");
  } catch {
    /* 막힌 저장소 — 이 페이지 동안만 */
  }
}

/** 끈적 Ctrl — 띠의 [Ctrl] 이 걸고, 다음 키 하나가 쓰고 푼다 */
export function stickyCtrl(): boolean {
  return ctrlArmed;
}

export function setStickyCtrl(on: boolean): void {
  ctrlArmed = on;
}

/** 걸려 있으면 풀고 `true` — 터미널이 다음 글자에 Ctrl 을 붙일지 묻는다 */
export function takeStickyCtrl(): boolean {
  if (!ctrlArmed) return false;
  ctrlArmed = false;
  return true;
}
