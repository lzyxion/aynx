// **폰의 "이 기기" 설정**(원격 웹 R5 · 10-20) — 순수 모듈. 값은 그 브라우저의 `localStorage` 에만 산다(`app/mobile` 이 읽고 쓴다 —
// 집 PC 의 `settings.toml` 에는 한 글자도 가지 않는다). 여기는 글자 ↔ 값과 범위만 셈한다.
//
// - 터미널 글자 크기: 폰에서 읽기 좋은 범위로 묶는다(`FONT_MIN`~`FONT_MAX`). `null` = 메인 PC 설정 그대로.
// - 테마: `main`(메인 PC 설정 그대로 — 이 기기 값 없음 · 기본) · `system`(이 기기의 밝기 — `prefers-color-scheme`) · `light` · `dark`.
//   없거나 모르는 글자는 `main` — 업데이트만으로 폰의 모양이 바뀌지 않게(10-20).
// - 키 띠: 띠에 서는 단추의 순서와 숨김. 모르는 id 는 버리고, 빠진 id 는 기본 순서대로 끝에 붙인다(새 키가 생겨도 띠에 선다).
//   옛 `input`(입력 칸 여닫기 '가')은 10-20 에 띠에서 빠졌다 — 저장된 글자에 남아 있어도 모르는 id 로 버려진다.
// - 입력 방식: `field`(한 줄 입력 칸 — 기본) · `direct`(터미널을 눌러 화면 키보드로 바로). 없거나 모르는 글자는 `field`.

/** 폰 터미널 글자 크기의 범위 */
export const FONT_MIN = 8;
export const FONT_MAX = 24;

/** 글자 크기 한 칸 — 범위 밖 · 숫자가 아닌 것은 범위 끝으로 접는다(정수) */
export function clampFont(n: number): number {
  if (!Number.isFinite(n)) return FONT_MIN;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

/** 저장된 글자 → 글자 크기(없거나 못 읽으면 `null` = 메인 PC 설정) */
export function parseFont(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampFont(n) : null;
}

export type ThemePref = "main" | "system" | "light" | "dark";
/** 고르는 순서(세그먼트 순서) — 기본(`main`)이 맨 앞 */
export const THEME_PREFS: readonly ThemePref[] = ["main", "system", "light", "dark"];

/** 저장된 글자 → 테마 고름(없거나 모르는 글자는 `main` = 메인 PC 설정) */
export function parseTheme(raw: string | null): ThemePref {
  return raw === "system" || raw === "light" || raw === "dark" ? raw : "main";
}

/** 테마 고름 → 저장할 글자(`main` 은 지운다 — `null`) */
export function serializeTheme(pref: ThemePref): string | null {
  return pref === "main" ? null : pref;
}

/** 테마 고름 → 화면에 걸 이 기기 밝기(`main` 은 `null` = 이 기기 값 없음 · `system` 은 이 기기의 밝기) */
export function resolveTheme(pref: ThemePref, osDark: boolean): "light" | "dark" | null {
  if (pref === "main") return null;
  if (pref === "system") return osDark ? "dark" : "light";
  return pref;
}

// ---------------------------------------------------------------------------
// 키 띠
// ---------------------------------------------------------------------------

/**
 * 띠의 단추 — `ctrl`(끈적 Ctrl)은 키가 아니라 띠의 몫이지만 순서 · 숨김은 같이 고른다. 입력 방식 단추는 늘 띠의 맨 왼쪽에 고정이라
 * 여기에 없다(숨기거나 옮기지 않는다 — 입력 칸이 기본이 된 뒤 바로 입력으로 돌아갈 길이 사라지지 않게).
 */
export type StripId = "ctrl" | "esc" | "tab" | "left" | "down" | "up" | "right" | "ctrlC" | "enter";

/** 기본 띠 */
export const STRIP_DEFAULT: readonly StripId[] = ["ctrl", "esc", "tab", "left", "down", "up", "right", "ctrlC", "enter"];

export interface StripPrefs {
  /** 모든 단추의 순서(숨긴 것 포함) */
  order: StripId[];
  hidden: StripId[];
}

const isStripId = (v: unknown): v is StripId => typeof v === "string" && (STRIP_DEFAULT as readonly string[]).includes(v);

export function defaultStrip(): StripPrefs {
  return { order: [...STRIP_DEFAULT], hidden: [] };
}

/** 저장된 글자 → 띠 설정(모양이 틀리면 기본) */
export function parseStrip(raw: string | null): StripPrefs {
  if (raw === null) return defaultStrip();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return defaultStrip();
  }
  if (typeof v !== "object" || v === null) return defaultStrip();
  const r = v as { order?: unknown; hidden?: unknown };
  const order: StripId[] = [];
  if (Array.isArray(r.order)) for (const id of r.order) if (isStripId(id) && !order.includes(id)) order.push(id);
  for (const id of STRIP_DEFAULT) if (!order.includes(id)) order.push(id);
  const hidden: StripId[] = [];
  if (Array.isArray(r.hidden)) for (const id of r.hidden) if (isStripId(id) && !hidden.includes(id)) hidden.push(id);
  return { order, hidden };
}

export function serializeStrip(p: StripPrefs): string {
  return JSON.stringify({ order: p.order, hidden: p.hidden });
}

/** 기본과 같은가(저장 대신 지우는 데 쓴다) */
export function isDefaultStrip(p: StripPrefs): boolean {
  return p.hidden.length === 0 && p.order.length === STRIP_DEFAULT.length && p.order.every((id, i) => id === STRIP_DEFAULT[i]);
}

/** 띠에 서는 단추(순서대로 · 숨긴 것 뺌) */
export function visibleStrip(p: StripPrefs): StripId[] {
  return p.order.filter((id) => !p.hidden.includes(id));
}

/** 하나를 켜거나 끈다 */
export function toggleStrip(p: StripPrefs, id: StripId): StripPrefs {
  const hidden = p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id];
  return { order: [...p.order], hidden };
}

/** 하나를 한 칸 옮긴다(`-1` 위 · `+1` 아래) — 끝이면 그대로 */
export function moveStrip(p: StripPrefs, id: StripId, by: -1 | 1): StripPrefs {
  const order = [...p.order];
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return { order, hidden: [...p.hidden] };
  [order[i], order[j]] = [order[j], order[i]];
  return { order, hidden: [...p.hidden] };
}

// ---------------------------------------------------------------------------
// 입력 방식
// ---------------------------------------------------------------------------

/** `field` = 한 줄 입력 칸에 쓰고 보낸다(기본) · `direct` = 터미널을 눌러 화면 키보드로 바로 친다 */
export type InputMode = "field" | "direct";
/** 고르는 순서(세그먼트 순서) — 기본(`field`)이 맨 앞 */
export const INPUT_MODES: readonly InputMode[] = ["field", "direct"];

/** 저장된 글자 → 입력 방식(없거나 모르는 글자는 `field`) */
export function parseInputMode(raw: string | null): InputMode {
  return raw?.trim() === "direct" ? "direct" : "field";
}

/** 입력 방식 → 저장할 글자(기본 `field` 는 지운다 — `null`) */
export function serializeInputMode(mode: InputMode): string | null {
  return mode === "field" ? null : mode;
}

// ---------------------------------------------------------------------------
// AI 타일 첫 화면
// ---------------------------------------------------------------------------

/** `convo` = 폰에서 AI 타일을 처음 볼 때 대화 면으로(기본) · `term` = 터미널 면 그대로 */
export type AiFace = "convo" | "term";
/** 고르는 순서(세그먼트 순서) — 기본(`convo`)이 맨 앞 */
export const AI_FACES: readonly AiFace[] = ["convo", "term"];

/** 저장된 글자 → 첫 화면(없거나 모르는 글자는 `convo`) */
export function parseAiFace(raw: string | null): AiFace {
  return raw?.trim() === "term" ? "term" : "convo";
}

/** 첫 화면 → 저장할 글자(기본 `convo` 는 지운다 — `null`) */
export function serializeAiFace(face: AiFace): string | null {
  return face === "convo" ? null : face;
}
