// 이 기기 값은 이 브라우저의 `localStorage` 에만 산다 — 메인 PC 의 `settings.toml` 에는 가지 않고, 폰 배치일 때만 화면에 건다.

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
    return null;
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
/** 반응형이 아니어도 된다 — 누를 때 한 번 읽는다 */
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
  // 화면 키보드 · 주소 줄을 뺀 높이 — 키 띠가 키보드 밑에 숨지 않게 모바일 배치가 `--app-h` 로 쓴다.
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
  $effect.root(() => {
    $effect(() => {
      const on = isMobileLayout(device());
      setDeviceFontSize(on ? fontPref : null);
      setDeviceMode(on ? resolveTheme(themePref, osDark) : null);
    });
  });
}

export function terminalFontSize(): number {
  return fontPref ?? settings.fontSize;
}

export function stepTerminalFont(by: number): void {
  const next = clampFont(terminalFontSize() + by);
  fontPref = next === settings.fontSize ? null : next;
  writeKey(FONT_KEY, fontPref === null ? null : String(fontPref));
}

export function themeChoice(): ThemePref {
  return themePref;
}

export function setThemeChoice(pref: ThemePref): void {
  themePref = pref;
  writeKey(THEME_KEY, serializeTheme(pref));
}

export function keyStrip(): StripPrefs {
  return strip;
}

export function setKeyStrip(next: StripPrefs): void {
  strip = next;
  writeKey(STRIP_KEY, isDefaultStrip(next) ? null : serializeStrip(next));
}

export function inputMode(): InputMode {
  return inputPref;
}

export function setInputMode(mode: InputMode): void {
  inputPref = mode;
  writeKey(INPUT_KEY, serializeInputMode(mode));
}

export function aiFacePref(): AiFace {
  return aiFace;
}

export function setAiFacePref(face: AiFace): void {
  aiFace = face;
  writeKey(AI_FACE_KEY, serializeAiFace(face));
}

export function lineFieldMode(): boolean {
  return inputPref === "field" && isMobileLayout(device());
}

export function registerLineField(el: HTMLInputElement): () => void {
  lineField = el;
  return () => {
    if (lineField === el) lineField = null;
  };
}

export function focusLineField(): boolean {
  const el = lineField;
  if (!lineFieldMode() || !el || el.disabled || !el.isConnected) return false;
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  return true;
}

export function mobileLayout(): boolean {
  return isMobileLayout(device());
}

export function handheld(): boolean {
  return isHandheld(device());
}

export function viewerEligible(): boolean {
  return sizeOwnerEligible(device());
}

export function viewerWanted(tileShown: boolean): boolean {
  return wantsViewer(device(), pageVisible, tileShown);
}

export function pageShown(): boolean {
  return pageVisible;
}

export function domRendererOnly(): boolean {
  return preferDomRenderer(device());
}

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

export function stickyCtrl(): boolean {
  return ctrlArmed;
}

export function setStickyCtrl(on: boolean): void {
  ctrlArmed = on;
}

export function takeStickyCtrl(): boolean {
  if (!ctrlArmed) return false;
  ctrlArmed = false;
  return true;
}
