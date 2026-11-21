import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";
import type { Key } from "$lib/i18n/keys";

/** i18n 의 순수한 속 — 지금 언어는 `i18n.svelte.ts` 의 `$state` 가 쥐고 여기 함수들은 그 값을 인자로 받는다 */

export type Locale = "ko" | "en";

/** 순서가 곧 설정 화면 select 의 순서다 */
export const LOCALES = ["ko", "en"] as const satisfies readonly Locale[];

export const FALLBACK_LOCALE: Locale = "ko";

const DICTS = { ko, en } as const;

/** 모르는 값 = 안 정함 = OS 를 따른다 — `settings.toml` 의 다른 `[app]` 키와 같은 규칙 */
export function resolveLocale(
  stored: string | null | undefined,
  navigatorLanguage: string,
): Locale {
  if (stored === "ko" || stored === "en") return stored;
  return navigatorLanguage.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function lookup(dict: Record<string, Record<string, string>>, key: string): string | undefined {
  // 표에서 빠진 서버 낱말이 `undefined` 키로 와도 화면 전체가 죽지 않게 — 마지막 그물. 낱말 → 문구 대체는 `keyText` 가 한다.
  if (typeof key !== "string") return undefined;
  const dot = key.indexOf(".");
  if (dot < 0) return undefined;
  return dict[key.slice(0, dot)]?.[key.slice(dot + 1)];
}

/**
 * 없는 인자는 `{이름}` 글자 그대로 남긴다 — 빈칸이 되면 깨진 문장을 아무도 못 본다(테스트가 본다).
 * `{{이름}}`(스니펫 자리표시자의 예시 문법)은 건드리지 않는다.
 */
function interpolate(raw: string, params: Record<string, string | number>): string {
  return raw.replace(/(?<!\{)\{([A-Za-z][A-Za-z0-9_]*)\}(?!\})/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** 고른 언어 → 한국어 → 키 자체. 마지막 단은 일부러다 — 빠진 칸이 화면에서 드러난다 */
export function translate(
  locale: Locale,
  key: Key,
  params?: Record<string, string | number>,
): string {
  const raw =
    lookup(DICTS[locale] as Record<string, Record<string, string>>, key) ??
    lookup(DICTS[FALLBACK_LOCALE] as Record<string, Record<string, string>>, key) ??
    String(key);
  return params ? interpolate(raw, params) : raw;
}

// ── 룬을 못 쓰는 순수 모듈을 위한 거울 ──

let mirrored: Locale = FALLBACK_LOCALE;

/** 부르는 곳은 `i18n.svelte.ts` 의 `setLocale` 뿐이다 — 값의 주인은 그쪽 `$state` 다 */
export function mirrorLocale(next: Locale): void {
  mirrored = next;
}

/**
 * 평범한 변수라 언어가 바뀌어도 다시 그리지 않는다 — 화면 코드는 쓰지 않는다.
 * 키를 돌려줄 수 없는 자리(던지는 `Error` 의 `message`)만 쓴다 — 돌려줄 수 있으면 키를 돌려주고 `t()` 로 푼다.
 */
export function translateNow(key: Key, params?: Record<string, string | number>): string {
  return translate(mirrored, key, params);
}

/** `Object.entries` 만 쓰면 값이 `string` 으로 넓어져 `t()` 에 못 넣는다 — 그 캐스팅을 한 자리에 모은다 */
export function optionEntries<T extends Record<string, Key>>(table: T): [string & keyof T, Key][] {
  return Object.entries(table) as [string & keyof T, Key][];
}
