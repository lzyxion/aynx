/**
 * 설정값의 **순수 정규화·직렬화 조각들** — 상태도 DOM 도 보지 않는다.
 *
 * `settings.svelte.ts` 는 룬 모듈(`.svelte.ts`)이라 vitest 대상이 아니다
 * (`vitest.config.ts` 의 머리말: "`.svelte.ts` 는 대상이 아니다 — 그쪽은 svelte 컴파일러를
 * 태워야 한다"). 그런데 정작 손으로 고친 `settings.toml` 을 막아 내는 그물은 전부 그 안의
 * **작은 순수 함수들**이었다 — 빈 문자열 접기, 경로 조각 거르기, 범위 자르기, "빈 칸과 없음을
 * 같게 보기". 테스트가 하나도 없던 자리다.
 *
 * 그래서 그 조각들만 평범한 `.ts` 로 내려 둔다. 큰 표를 보는 판정(`normalizeSettings` ·
 * `toPayload` 의 몸통)은 여전히 `settings.svelte.ts` 에 있고, 여기 있는 것들을 불러 쓴다 —
 * 이 파일은 위로(설정 모듈로) 아무것도 되돌아보지 않으므로 순환이 생기지 않는다.
 *
 * 규칙 하나가 이 파일 전체를 관통한다: **"안 정함"과 "빈 값"은 같다** (백엔드
 * `settings.rs` 의 `fold_empty` 와 같은 규칙). 그래야 파일에 빈 문자열이 쌓이지 않고,
 * 설정 화면에서 칸을 열었다 닫는 것만으로 [저장] 버튼이 켜지지 않는다.
 */

import { ACTIONS } from "$lib/keybindings";
import type { Trigger } from "$lib/triggers";

/** 빈 문자열·공백만 있는 값은 "안 정함"과 같다 (백엔드 `fold_empty` 와 같은 규칙) */
export function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/**
 * **경로가 아니라 이름 한 조각**인 값만 통과시킨다 (`"wallpaper.jpg"` ✓, `"../x.png"` ✗).
 *
 * 백엔드가 `Path::file_name()` 으로 하는 검사와 같은 뜻이다. 브라우저에는 경로 API 가
 * 없으므로 구분자(`/`·`\`)와 `..`·`.` 를 직접 본다.
 */
export function bareName(v: unknown): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  if (t === "." || t === ".." || /[\\/]/.test(t)) return undefined;
  return t;
}

/**
 * 목록에 **있는 키**만 통과시킨다 (공백을 뗀 뒤에 본다). 없으면 `undefined` = 기본값 추종.
 *
 * `in` 이 아니라 `Object.hasOwn` 을 쓴다 — `in` 은 프로토타입 사슬까지 보므로
 * `tiling = "toString"` 이라고 적힌 파일이 "아는 키" 로 통과해, 화면의 select 가 비고
 * 타일 배치가 아무 모드도 아닌 값을 들고 있게 된다. 표에 **직접 적힌** 키만 아는 키다.
 */
export function known(v: unknown, table: Record<string, string>): string | undefined {
  const t = text(v);
  return t && Object.hasOwn(table, t) ? t : undefined;
}

/** 정수로 반올림해 범위로 자른다. 숫자가 아니면 "안 정함"(=기본값 추종) */
export function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** 금고 자동 잠금의 상한 — 하루. `settings.rs` 의 `MAX_AUTO_LOCK_MINUTES` 와 같은 값이어야 한다 */
export const VAULT_AUTO_LOCK_MAX = 24 * 60;

/**
 * `[vault] auto_lock_minutes` 를 믿을 수 있는 모양으로 (백엔드 `VaultPrefs::minutes` 와 같은 규칙).
 *
 * **`0` 을 살려 두는 것**이 [`clampInt`] 와 갈리는 점이다 — 여기서 `0` 은 "너무 짧음" 이 아니라
 * **"잠그지 않는다"** 라는 사용자의 답이고, 아래로 접으면 기본값(30분)으로 조용히 되돌아가
 * 화면이 고른 값과 실제가 어긋난다. 위는 하루로 자른다: 그보다 큰 값은 `0` 과 실질적으로
 * 같은데, 같은 뜻을 두 가지로 적을 수 있으면 화면이 둘을 다르게 보여 줘야 한다
 * (`settings.rs` 의 같은 줄).
 *
 * 음수·비숫자·비유한은 **"안 정함"** 이다 = 파일에 안 적힌 것과 같고, 그때 먹는 값은 기본 30분이다.
 */
export function vaultAutoLockMinutes(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < 0) return undefined;
  return Math.min(VAULT_AUTO_LOCK_MAX, n);
}

/**
 * 문자열 → 문자열 맵만 남긴다. 비면 `undefined`(= "없음") 이다 — 빈 객체와 없음을 구분하면
 * `dirty` 판정이 흔들린다 ([`sameStringMap`] 이 둘을 같게 본다).
 */
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

/**
 * 문자열 목록을 정리한다 — 공백을 떼고, 빈 값·중복을 버리되 **순서는 보존**한다
 * (백엔드 `AutomationPrefs::sanitize` 의 `allow_patterns` 정리와 같은 규칙).
 *
 * 자동 승인 allowlist 가 쓴다: 같은 패턴이 둘이면 판정이 달라질 것도 없고, 빈 칸은
 * (편집 중 잠깐 생겨도) 저장할 것이 없다.
 */
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

/** 문자열 목록이 같은가 — 순서까지 본다 (allowlist 매칭 순서가 곧 의미다) */
export function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * 자동 승인 **구조적 규칙**(A4b)의 최소 모양 — `settings.svelte.ts` 의 `AllowRule` 과
 * 구조적으로 같다(여기 두는 이유는 순환 방지: 코덱은 설정 모듈을 되돌아보지 않는다).
 * 인자 제약 다섯 칸은 선택이다(2026-10-05).
 */
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

/** 인자 제약의 문자열 목록 칸 — 정리·비교·복사가 같은 순서로 돈다. */
const ALLOW_RULE_LIST_FIELDS = ["deny_flags", "allow_flags", "require_flags", "first_arg"] as const;

/** 문자열 목록을 공백 떼고 빈 항목 버린 사본으로. 배열이 아니면 빈 목록. */
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
 * `[[automation.allow]]` 규칙 목록을 믿을 수 있는 모양으로 (백엔드 `AutomationPrefs::sanitize`
 * 의 allow 정리와 같은 규칙): exec·서브커맨드·인자 제약 목록의 공백을 떼고, exec 가 빈 규칙과
 * 빈 항목은 버린다. 순서·중복은 매칭 의미가 없어 손대지 않는다.
 *
 * **인자 제약 칸을 버리지 않는다** — 프런트가 [저장] 할 때 이 칸을 떨어뜨리면 사용자가 손으로
 * 적은 금지가 조용히 사라져 규칙이 넓어진다. 빈 목록 칸은 아예 싣지 않고(옛 모양 그대로 왕복),
 * `max_args` 는 0 이상의 정수일 때만 싣는다(그 밖의 값은 없는 것 = 제약 없음 — Rust 도 숫자가
 * 아니면 파일을 못 읽어 기본값으로 떨어지므로 여기서 지어내지 않는다).
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

/** 규칙 하나의 깊은 사본 — 있는 칸만 옮긴다(빈 칸을 지어내지 않는다). */
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

/** 규칙이 인자 제약을 하나라도 갖는가 — 없으면 옛 exec+서브커맨드 규칙이다. */
export function hasArgConstraints(r: AllowRuleLike): boolean {
  return (
    ALLOW_RULE_LIST_FIELDS.some((f) => (r[f]?.length ?? 0) > 0) ||
    r.max_args !== undefined ||
    r.sub_first === true
  );
}

/** 구조적 규칙 목록이 같은가 — 순서·exec·서브커맨드·인자 제약(순서까지)을 모두 본다 */
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
 * `[automation.bundle_off]` 을 믿을 수 있는 모양으로 (백엔드 `sanitize` 와 같은 규칙): 키·값의 공백을 떼고
 * 빈 값·중복을 버린다(순서 보존). 빈 목록은 칸째 버린다. **모르는 묶음·키도 버리지 않는다** — 좁히기만
 * 하는 칸이라 남아도 넓어지지 않고, 옛 버전이 저장해도 사용자의 끄기가 살아 있어야 한다.
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

/** 끈 명령 표가 같은가 — 묶음 순서는 보지 않고(표다), 키 목록은 순서까지 본다. */
export function sameBundleOff(a: Readonly<Record<string, readonly string[]>>, b: Readonly<Record<string, readonly string[]>>): boolean {
  const ka = Object.keys(a).filter((k) => a[k].length > 0);
  const kb = Object.keys(b).filter((k) => b[k].length > 0);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b[k] !== undefined && sameStringList(a[k], b[k]));
}

/** 끈 명령 표의 깊은 사본. */
export function cloneBundleOff(o: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o)) out[k] = [...v];
  return out;
}

/** 폐기 ID는 설정 왕복만 보존한다. ACTIONS에 넣지 않으므로 실행/설정/도움말에서 보이지 않는다. */
export const DEPRECATED_ACTION_IDS = ["open-layouts", "save-layout"] as const;

/** 실행 레지스트리와 폐기 ID 외의 모르는 오버라이드는 버린다. */
const KNOWN_ACTION_IDS = new Set([...ACTIONS.map((a) => a.id), ...DEPRECATED_ACTION_IDS]);

/**
 * 단축키 오버라이드를 믿을 수 있는 모양으로.
 *
 * - 문자열이 아닌 값·빈 값은 버린다.
 * - 레지스트리에 없는 액션 id 도 버린다 (옛 버전이 남긴 키가 조용히 쌓이지 않게).
 *
 * 조합 문자열의 문법(수식 순서·code 유효성)은 여기서 검사하지 않는다 — 손으로 고친
 * 파일에 이상한 값이 있어도 `resolveBindings` 가 그냥 매칭 안 되는 조합으로 둘 뿐이라
 * 앱이 깨지지 않는다.
 */
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

/**
 * 트리거 목록을 믿을 수 있는 모양으로. **정규식 문법은 여기서 검사하지 않는다** —
 * 잘못된 패턴도 목록에 남아 있어야 사용자가 설정 화면에서 고칠 수 있다
 * (컴파일 실패는 `triggerErrors` 로 따로 보여준다).
 *
 * `max` 는 개수 상한(`MAX_TRIGGERS`)이다. 상수 자체는 `settings.svelte.ts` 가 들고 있고
 * (백엔드 `settings.rs` 와 짝을 맞춰야 하는 값이라 그쪽이 한 자리) 여기로는 값만 온다.
 */
export function normalizeTriggers(raw: unknown, max: number): Trigger[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({
      pattern: typeof t?.pattern === "string" ? t.pattern.trim() : "",
      fg: text(t?.fg),
      bg: text(t?.bg),
      // URL·툴팁은 **양 끝 공백만** 떼고 안쪽은 그대로 둔다 (툴팁은 사람이 읽는 문장이다).
      url: text(t?.url),
      tooltip: text(t?.tooltip),
      // 손으로 고친 파일에서 빠져 있으면 켜진 것으로 본다 (백엔드와 같은 규칙).
      enabled: typeof t?.enabled === "boolean" ? t.enabled : true,
    }))
    .filter((t) => t.pattern !== "")
    .slice(0, max);
}

/** 오버라이드 맵이 같은가 — 키 집합과 값이 모두 같아야 한다 */
export function sameKeybindings(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/** 위와 같되 "없음"(`null`/`undefined`)을 빈 맵과 **같게** 본다 — 동적 팔레트가 그 상태다 */
export function sameStringMap(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined,
): boolean {
  return sameKeybindings(a ?? {}, b ?? {});
}

/** 트리거 목록이 같은가 — 순서까지 본다 (겹칠 때 이기는 쪽이 순서로 정해진다) */
export function sameTriggers(a: readonly Trigger[], b: readonly Trigger[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (t, i) =>
      t.pattern === b[i].pattern &&
      (t.fg ?? null) === (b[i].fg ?? null) &&
      (t.bg ?? null) === (b[i].bg ?? null) &&
      // 빈 문자열과 "없음" 을 **같게** 본다: 설정 화면에서 링크/툴팁 칸만 열어 두고 아직
      // 아무것도 안 적은 상태(`""`)는 저장할 것이 없다 ([`triggersToPayload`] 도 그때 키를 뺀다).
      // 이러지 않으면 칸을 열었다 닫는 것만으로 [저장] 버튼이 켜진다.
      (t.url || "") === (b[i].url || "") &&
      (t.tooltip || "") === (b[i].tooltip || "") &&
      t.enabled === b[i].enabled,
  );
}

/**
 * 저장용 트리거 목록 — 빈 패턴을 버리고, 값이 없는 칸은 **키 자체를 뺀다**.
 *
 * 목록은 **언제나** 보낸다 (빈 배열 포함). 빼면 백엔드가 "파일에 없음" 으로 읽고 내장 두 개를
 * 되살려, 사용자가 다 지운 목록이 저장 한 번에 부활한다 — 그 판단은 부르는 쪽에 있고
 * 여기서는 목록 하나를 모양만 다듬는다.
 */
export function triggersToPayload(list: readonly Trigger[]): Trigger[] {
  return list
    .filter((t) => t.pattern.trim() !== "")
    .map((t) => {
      const out: Trigger = { pattern: t.pattern.trim(), enabled: t.enabled };
      if (t.fg) out.fg = t.fg;
      if (t.bg) out.bg = t.bg;
      // 빈 칸(`""` — 종류만 켜 두고 안 적음)은 키 자체를 빼고 보낸다. 색과 같은 규칙이다.
      if (t.url?.trim()) out.url = t.url.trim();
      if (t.tooltip?.trim()) out.tooltip = t.tooltip.trim();
      return out;
    });
}

/**
 * 저장용 단축키 맵 — 값이 있는 키만 추린다.
 *
 * 오버라이드만 담으므로 **언제나** 그대로 보낸다 (빈 객체 포함). 빈 객체는 "전부 기본값"
 * 이라는 뜻이고, 백엔드가 이를 `[keybindings]` 없음과 같게 다뤄도 결과가 같다.
 */
export function keybindingsToPayload(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, combo] of Object.entries(map)) {
    const c = combo.trim();
    if (c !== "") out[id] = c;
  }
  return out;
}
