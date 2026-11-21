// 폰의 "이 기기" 설정 — 순수 모듈. 값은 그 브라우저의 `localStorage` 에만 산다(메인 PC 의 `settings.toml` 에는 한 글자도 가지 않는다).
// 없거나 모르는 글자는 기본값으로 읽는다 — 업데이트만으로 폰의 모양이 바뀌지 않게.

export const FONT_MIN = 8;
export const FONT_MAX = 24;

export function clampFont(n: number): number {
  if (!Number.isFinite(n)) return FONT_MIN;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

export function parseFont(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampFont(n) : null;
}

export type ThemePref = "main" | "system" | "light" | "dark";
export const THEME_PREFS: readonly ThemePref[] = ["main", "system", "light", "dark"];

export function parseTheme(raw: string | null): ThemePref {
  return raw === "system" || raw === "light" || raw === "dark" ? raw : "main";
}

export function serializeTheme(pref: ThemePref): string | null {
  return pref === "main" ? null : pref;
}

export function resolveTheme(pref: ThemePref, osDark: boolean): "light" | "dark" | null {
  if (pref === "main") return null;
  if (pref === "system") return osDark ? "dark" : "light";
  return pref;
}

// ── 키 띠 ──

/** 입력 방식 단추는 늘 띠의 맨 왼쪽에 고정이라 여기에 없다 — 바로 입력으로 돌아갈 길이 사라지지 않게 */
export type StripId = "ctrl" | "esc" | "tab" | "left" | "down" | "up" | "right" | "ctrlC" | "enter";

export const STRIP_DEFAULT: readonly StripId[] = ["ctrl", "esc", "tab", "left", "down", "up", "right", "ctrlC", "enter"];

export interface StripPrefs {
  order: StripId[];
  hidden: StripId[];
}

const isStripId = (v: unknown): v is StripId => typeof v === "string" && (STRIP_DEFAULT as readonly string[]).includes(v);

export function defaultStrip(): StripPrefs {
  return { order: [...STRIP_DEFAULT], hidden: [] };
}

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

export function isDefaultStrip(p: StripPrefs): boolean {
  return p.hidden.length === 0 && p.order.length === STRIP_DEFAULT.length && p.order.every((id, i) => id === STRIP_DEFAULT[i]);
}

export function visibleStrip(p: StripPrefs): StripId[] {
  return p.order.filter((id) => !p.hidden.includes(id));
}

export function toggleStrip(p: StripPrefs, id: StripId): StripPrefs {
  const hidden = p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id];
  return { order: [...p.order], hidden };
}

export function moveStrip(p: StripPrefs, id: StripId, by: -1 | 1): StripPrefs {
  const order = [...p.order];
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return { order, hidden: [...p.hidden] };
  [order[i], order[j]] = [order[j], order[i]];
  return { order, hidden: [...p.hidden] };
}

// ── 입력 방식 ──

export type InputMode = "field" | "direct";
export const INPUT_MODES: readonly InputMode[] = ["field", "direct"];

export function parseInputMode(raw: string | null): InputMode {
  return raw?.trim() === "direct" ? "direct" : "field";
}

export function serializeInputMode(mode: InputMode): string | null {
  return mode === "field" ? null : mode;
}

// ── AI 타일 첫 화면 ──

export type AiFace = "convo" | "term";
export const AI_FACES: readonly AiFace[] = ["convo", "term"];

export function parseAiFace(raw: string | null): AiFace {
  return raw?.trim() === "term" ? "term" : "convo";
}

export function serializeAiFace(face: AiFace): string | null {
  return face === "convo" ? null : face;
}

// ── 마지막으로 보던 탭 · 타일 ──

/** 원격 창이 다시 읽은 첫 화면의 씨앗(`$lib/mirror/reduce` 의 `MirrorSeed`) — 메인 PC 에는 가지 않는다 */

export interface LastView {
  tab: string | null;
  tile: string | null;
}

const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

export function parseLastView(raw: string | null): LastView | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const r = v as { tab?: unknown; tile?: unknown };
  const out: LastView = { tab: isKey(r.tab) ? r.tab : null, tile: isKey(r.tile) ? r.tile : null };
  return out.tab === null && out.tile === null ? null : out;
}

export function serializeLastView(v: LastView): string {
  return JSON.stringify({ tab: v.tab, tile: v.tile });
}
