import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";
import type { Key } from "$lib/i18n/keys";

/**
 * 국제화(i18n)의 **순수한 속**. 사전 두 벌을 들고, 키 하나를 문자열 하나로 바꾼다.
 *
 * 룬이 없는 평범한 `.ts` 인 것이 요점이다 — 지금 고른 언어는 `i18n.svelte.ts` 의 `$state`
 * 가 쥐고 있고, 여기 있는 함수들은 **그 값을 인자로 받는다**. 그래서 vitest 가 이 파일을
 * 그대로 들여와 규칙을 고정할 수 있다 (`vitest.config.ts` 는 svelte 컴파일러를 태우지
 * 않으므로 `.svelte.ts` 는 테스트 대상이 아니다).
 *
 * 라이브러리를 들이지 않은 이유는 docs/log/2026-09-17-i18n.md 에 적었다 — 필요한 것은
 * "키 → 문자열" 한 가지뿐이고, 그 답은 이 파일 하나면 나온다.
 */

/** 지원하는 언어. 늘릴 때는 `ko/`·`en/` 과 같은 모양의 폴더를 하나 더 만든다 */
export type Locale = "ko" | "en";

/** `{#each}` 로 도는 목록 — 순서가 곧 설정 화면 select 의 순서다 */
export const LOCALES = ["ko", "en"] as const satisfies readonly Locale[];

/** 폴백의 뿌리 — 번역이 비어 있으면 언제나 이 언어의 문장이 나온다 */
export const FALLBACK_LOCALE: Locale = "ko";

/** 언어 → 사전 한 벌 */
const DICTS = { ko, en } as const;

/**
 * 저장된 값과 브라우저(OS) 언어에서 **실제로 쓸 언어**를 고른다 — 순수 함수다.
 *
 * - `"ko"`·`"en"` → 그대로 (사용자가 명시적으로 고른 것).
 * - 그 밖(= `null`/`undefined`/모르는 값) → **OS 를 따른다**: `navigator.language` 가
 *   `ko` 로 시작하면 한국어, 아니면 영어.
 *
 * "모르는 값 = 안 정함" 은 `settings.toml` 의 다른 `[app]` 키와 같은 규칙이다
 * (`mode`·`tiling`·`tab_style`).
 */
export function resolveLocale(
  stored: string | null | undefined,
  navigatorLanguage: string,
): Locale {
  if (stored === "ko" || stored === "en") return stored;
  return navigatorLanguage.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** 사전 한 벌에서 `"<네임스페이스>.<키>"` 를 찾는다 (없으면 `undefined`) */
function lookup(dict: Record<string, Record<string, string>>, key: string): string | undefined {
  // 표에서 빠진 서버 낱말이 `undefined` 키로 오면(오케스트레이션 3a 실기의 보드 예외) 화면 전체가 죽지 않게 — 마지막 그물.
  // 낱말 → 문구의 대체는 부르는 쪽 한 곳(`orchestration/model.ts` 의 `keyText`)이 한다.
  if (typeof key !== "string") return undefined;
  const dot = key.indexOf(".");
  if (dot < 0) return undefined;
  return dict[key.slice(0, dot)]?.[key.slice(dot + 1)];
}

/**
 * `{이름}` 자리를 값으로 바꾼다.
 *
 * - **없는 인자는 `{이름}` 글자 그대로 남는다** — 조용히 빈칸이 되면 문장이 깨진 것을
 *   아무도 못 보지만, 중괄호가 화면에 남으면 그 자리에서 보인다 (테스트도 그것을 본다).
 * - `{{이름}}`(스니펫 자리표시자 문법)은 **건드리지 않는다** — 앞뒤로 중괄호가 하나 더
 *   붙어 있으면 이 치환의 대상이 아니다. 그 글자는 사용자에게 보여 주는 **예시 문법**이라
 *   두 언어 모두에서 그대로 남아야 한다.
 */
function interpolate(raw: string, params: Record<string, string | number>): string {
  return raw.replace(/(?<!\{)\{([A-Za-z][A-Za-z0-9_]*)\}(?!\})/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * 키 하나를 지금 언어의 문장으로 바꾼다 — **세 단 폴백**이다:
 * 고른 언어 → 한국어 → 키 자체.
 *
 * 키가 그대로 나오는 마지막 단이 일부러 남아 있다: 화면에 `settings.foo.bar` 가 보이면
 * 사전에 빠진 칸이 그 자리에서 드러난다 (빈 문자열이면 아무도 못 본다).
 */
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

// ---------------------------------------------------------------------------
// 룬을 못 쓰는 순수 모듈을 위한 **거울** 하나
// ---------------------------------------------------------------------------

/** 지금 언어의 거울. 쓰는 곳은 [`mirrorLocale`] 하나다 (= `setLocale`) */
let mirrored: Locale = FALLBACK_LOCALE;

/**
 * 거울을 갱신한다 — **부르는 곳은 `i18n.svelte.ts` 의 `setLocale` 뿐이다.**
 * 값의 주인은 여전히 그쪽의 `$state` 이고, 여기 있는 것은 읽기 전용 사본이다.
 */
export function mirrorLocale(next: Locale): void {
  mirrored = next;
}

/**
 * 지금 언어로 문구 하나 — **룬을 들일 수 없는 순수 모듈**의 창구다.
 *
 * 화면을 그리는 코드는 이것을 쓰지 않는다. 평범한 변수라 값이 바뀌어도 다시 그리지 않으므로
 * (`t()` 와 다른 점이 그것이다), **부르는 순간 만들어지고 그대로 끝나는 글자**만 여기 온다 —
 * 지금은 `fs-backend.ts` 가 세션 없이 원격을 부를 때 던지는 실패 하나뿐이다. 그 파일은
 * vitest 가 그대로 들여오는 순수 모듈이라 `.svelte.ts` 를 import 할 수 없다.
 *
 * 문구 키를 돌려주고 컴포넌트가 `t()` 로 푸는 것이 **먼저**다 (`fs-backend` 의 `nameError`).
 * 이 창구는 **키를 돌려줄 수 없는 자리**(던지는 `Error` 의 `message`)의 몫이다.
 */
export function translateNow(key: Key, params?: Record<string, string | number>): string {
  return translate(mirrored, key, params);
}

/**
 * 후보 표(`{ 저장값: 문구키 }`)를 `{#each}` 가 돌 수 있는 쌍 목록으로 만든다.
 *
 * `Object.entries` 만 쓰면 값이 `string` 으로 넓어져 `t()` 에 넣을 수 없다 — 그 캐스팅을
 * 한 자리에 모은다. 표 자신은 `settings.svelte.ts` 에 그대로 살아 있고(정규화가 `in` 으로
 * 후보를 거른다), 달라진 것은 **값이 한국어 문장이 아니라 문구 키**라는 점뿐이다.
 */
export function optionEntries<T extends Record<string, Key>>(table: T): [string & keyof T, Key][] {
  return Object.entries(table) as [string & keyof T, Key][];
}
