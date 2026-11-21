/**
 * 설정값의 순수 정규화 · 직렬화 조각 — 룬 모듈이 아니라 vitest 로 시험한다.
 * "안 정함"과 "빈 값"은 같다(Rust `fold_empty` 와 같은 규칙) — 어기면 칸을 열었다 닫는 것만으로 [저장] 이 켜진다.
 */

import { ACTIONS } from "$lib/keybindings";
import type { Trigger } from "$lib/triggers";

export function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** 경로가 아니라 이름 한 조각만 — 백엔드 `Path::file_name()` 검사와 같은 뜻 */
export function bareName(v: unknown): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  if (t === "." || t === ".." || /[\\/]/.test(t)) return undefined;
  return t;
}

/** `in` 을 쓰지 않는다 — 프로토타입 사슬까지 보아 `"toString"` 같은 값이 아는 키로 통과한다 */
export function known(v: unknown, table: Record<string, string>): string | undefined {
  const t = text(v);
  return t && Object.hasOwn(table, t) ? t : undefined;
}

export function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export const VAULT_AUTO_LOCK_MAX = 24 * 60;

/** `[vault] auto_lock_minutes` — 앱은 읽지 않고 왕복 보존만 한다(Rust `VaultPrefs`). `0` 은 "잠그지 않는다" 라 살린다 */
export function vaultAutoLockMinutes(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < 0) return undefined;
  return Math.min(VAULT_AUTO_LOCK_MAX, n);
}

/** 비면 `undefined` — 빈 객체와 없음을 나누면 `dirty` 판정이 흔들린다 */
export function normalizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = text(k);
    const val = text(v);
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** 백엔드 `AutomationPrefs::sanitize` 의 `allow_patterns` 정리와 같은 규칙(순서 보존) */
export function cleanStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const t = text(v);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** `settings/model/schema.ts` 의 `AllowRule` 과 구조가 같다 — 코덱은 설정 모듈을 되돌아보지 않는다(순환 방지) */
export interface AllowRuleLike {
  exec: string;
  subcommands: string[];
  deny_flags?: string[];
  allow_flags?: string[];
  require_flags?: string[];
  first_arg?: string[];
  max_args?: number;
  sub_first?: boolean;
}

const ALLOW_RULE_LIST_FIELDS = ["deny_flags", "allow_flags", "require_flags", "first_arg"] as const;

function cleanTextList(raw: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const t = text(s);
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * 백엔드 `AutomationPrefs::sanitize` 의 allow 정리와 같은 규칙.
 * 인자 제약 칸을 버리지 않는다 — [저장] 에서 떨어뜨리면 사용자가 적은 금지가 사라져 규칙이 넓어진다.
 */
export function cleanAllowRules(raw: unknown): AllowRuleLike[] {
  if (!Array.isArray(raw)) return [];
  const out: AllowRuleLike[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const exec = text(o.exec);
    if (!exec) continue;
    const rule: AllowRuleLike = { exec, subcommands: cleanTextList(o.subcommands) };
    for (const f of ALLOW_RULE_LIST_FIELDS) {
      const list = cleanTextList(o[f]);
      if (list.length > 0) rule[f] = list;
    }
    const max = o.max_args;
    if (typeof max === "number" && Number.isInteger(max) && max >= 0) rule.max_args = max;
    if (o.sub_first === true) rule.sub_first = true;
    out.push(rule);
  }
  return out;
}

export function cloneAllowRule<T extends AllowRuleLike>(r: T): AllowRuleLike {
  const c: AllowRuleLike = { exec: r.exec, subcommands: [...r.subcommands] };
  for (const f of ALLOW_RULE_LIST_FIELDS) {
    const list = r[f];
    if (list !== undefined) c[f] = [...list];
  }
  if (r.max_args !== undefined) c.max_args = r.max_args;
  if (r.sub_first) c.sub_first = true;
  return c;
}

export function hasArgConstraints(r: AllowRuleLike): boolean {
  return (
    ALLOW_RULE_LIST_FIELDS.some((f) => (r[f]?.length ?? 0) > 0) ||
    r.max_args !== undefined ||
    r.sub_first === true
  );
}

export function sameAllowRules(a: readonly AllowRuleLike[], b: readonly AllowRuleLike[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (r, i) =>
      r.exec === b[i].exec &&
      sameStringList(r.subcommands, b[i].subcommands) &&
      ALLOW_RULE_LIST_FIELDS.every((f) => sameStringList(r[f] ?? [], b[i][f] ?? [])) &&
      r.max_args === b[i].max_args &&
      (r.sub_first === true) === (b[i].sub_first === true),
  );
}

/**
 * 백엔드 `sanitize` 와 같은 규칙. 모르는 묶음 · 키도 버리지 않는다 — 좁히기만 하는 칸이라 남아도 넓어지지 않고,
 * 옛 버전이 저장해도 사용자의 끄기가 살아 있어야 한다.
 */
export function cleanBundleOff(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = k.trim();
    if (!id) continue;
    const keys = [...new Set(cleanTextList(v))];
    if (keys.length === 0) continue;
    out[id] = [...new Set([...(out[id] ?? []), ...keys])];
  }
  return out;
}

export function sameBundleOff(a: Readonly<Record<string, readonly string[]>>, b: Readonly<Record<string, readonly string[]>>): boolean {
  const ka = Object.keys(a).filter((k) => a[k].length > 0);
  const kb = Object.keys(b).filter((k) => b[k].length > 0);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b[k] !== undefined && sameStringList(a[k], b[k]));
}

export function cloneBundleOff(o: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o)) out[k] = [...v];
  return out;
}

/** 폐기 ID는 설정 왕복만 보존한다. ACTIONS에 넣지 않으므로 실행/설정/도움말에서 보이지 않는다. */
export const DEPRECATED_ACTION_IDS = ["open-layouts", "save-layout"] as const;

const KNOWN_ACTION_IDS = new Set([...ACTIONS.map((a) => a.id), ...DEPRECATED_ACTION_IDS]);

/** 조합 문법은 검사하지 않는다 — 이상한 값은 `resolveBindings` 에서 매칭 안 되는 조합으로 남을 뿐이다 */
export function normalizeKeybindings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [id, combo] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_ACTION_IDS.has(id)) continue;
    const c = text(combo);
    if (c) out[id] = c;
  }
  return out;
}

/** 정규식 문법은 검사하지 않는다 — 잘못된 패턴도 남아 있어야 설정 화면에서 고칠 수 있다(`triggerErrors`) */
export function normalizeTriggers(raw: unknown, max: number): Trigger[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({
      pattern: typeof t?.pattern === "string" ? t.pattern.trim() : "",
      fg: text(t?.fg),
      bg: text(t?.bg),
      url: text(t?.url),
      tooltip: text(t?.tooltip),
      // 빠져 있으면 켜진 것으로 본다(백엔드와 같은 규칙)
      enabled: typeof t?.enabled === "boolean" ? t.enabled : true,
    }))
    .filter((t) => t.pattern !== "")
    .slice(0, max);
}

export function sameKeybindings(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/** "없음"을 빈 맵과 같게 본다 — 동적 팔레트가 그 상태다 */
export function sameStringMap(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined,
): boolean {
  return sameKeybindings(a ?? {}, b ?? {});
}

/** 순서까지 본다 — 겹칠 때 이기는 쪽이 순서로 정해진다 */
export function sameTriggers(a: readonly Trigger[], b: readonly Trigger[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (t, i) =>
      t.pattern === b[i].pattern &&
      (t.fg ?? null) === (b[i].fg ?? null) &&
      (t.bg ?? null) === (b[i].bg ?? null) &&
      // `""` 와 없음을 같게 본다 — 아니면 칸을 열었다 닫는 것만으로 [저장] 이 켜진다
      (t.url || "") === (b[i].url || "") &&
      (t.tooltip || "") === (b[i].tooltip || "") &&
      t.enabled === b[i].enabled,
  );
}

/** 부르는 쪽은 목록을 언제나 보낸다(빈 배열 포함) — 빼면 백엔드가 "파일에 없음" 으로 읽고 내장 트리거를 되살린다 */
export function triggersToPayload(list: readonly Trigger[]): Trigger[] {
  return list
    .filter((t) => t.pattern.trim() !== "")
    .map((t) => {
      const out: Trigger = { pattern: t.pattern.trim(), enabled: t.enabled };
      if (t.fg) out.fg = t.fg;
      if (t.bg) out.bg = t.bg;
      if (t.url?.trim()) out.url = t.url.trim();
      if (t.tooltip?.trim()) out.tooltip = t.tooltip.trim();
      return out;
    });
}

export function keybindingsToPayload(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, combo] of Object.entries(map)) {
    const c = combo.trim();
    if (c !== "") out[id] = c;
  }
  return out;
}
