import { invoke } from "../ipc";
import { FALLBACK_LOCALE, mirrorLocale, translate, type Locale } from "$lib/i18n/dict";

/**
 * **지금 고른 언어**와 그것을 읽는 창구 `t()`.
 *
 * 룬을 쓰므로 파일 이름이 `.svelte.ts` 여야 하고, import 는 `$lib/i18n/i18n.svelte.js` 로
 * 적는다 (Svelte 5 관례 — `settings.svelte.ts` 와 같다).
 *
 * ## 왜 두 파일인가 (`dict.ts` / 이 파일)
 *
 * 규칙(사전 찾기·폴백·자리 치환·OS 언어 판정)은 전부 **순수**라 vitest 로 고정할 수 있어야
 * 하는데, `vitest.config.ts` 는 svelte 컴파일러를 태우지 않아 `.svelte.ts` 를 들여올 수
 * 없다. 그래서 규칙은 `dict.ts` 에 두고, 여기에는 **지금 값 하나**(`$state`)와 그것을
 * 규칙에 먹이는 얇은 껍데기만 남긴다.
 *
 * ## 화면이 따라오는 방법
 *
 * [`t`] 가 매번 `current` 를 **읽는다**. 그래서 템플릿 안의 `{t("…")}` 와 `$derived` 는
 * [`setLocale`] 이 값을 바꾸는 순간 함께 다시 돈다 — 컴포넌트는 언어를 알 필요가 없고,
 * 새로고침도 없다 (`mode.svelte.ts` 가 `<html data-theme>` 하나로 팔레트를 뒤집는 것과
 * 같은 모양이다).
 *
 * ## 저장 위치는 `settings.toml` 의 `[app] language` 다
 *
 * 값을 읽고 쓰는 배관은 `settings.svelte.ts`(`applyStoredLanguage`·`setLanguage`)에 있다 —
 * 이 모듈은 설정을 알지 못한다(의존은 한 방향뿐이다). 부팅에서 언어가 걸리는 자리는
 * `app/boot.svelte.ts` 의 `adoptStoredMode()` 바로 다음이다.
 */

/** 지금 화면에 걸린 언어. 기본은 한국어 — 부팅이 곧바로 저장된 값(또는 OS)으로 덮는다 */
let current = $state<Locale>(FALLBACK_LOCALE);

/** 지금 언어 (읽는 쪽이 반응형으로 따라오도록 **함수**다) */
export function locale(): Locale {
  return current;
}

/**
 * 언어를 건다. `<html lang>` 도 함께 적는다 — 접근성 도구와 브라우저의 줄바꿈·글꼴 대체가
 * 그 속성을 본다 (`<html data-theme>` 를 모드가 적는 것과 같은 자리·같은 이유다).
 *
 * **백엔드에도 같은 값을 알린다.** Rust 가 만들어 올려 보내는 문구(실패 메시지·안내문·셸
 * 표시 이름)는 프런트 사전에 없고 `src-tauri/src/i18n.rs` 의 전역 한 칸을 본다
 * (docs/log/2026-09-17-i18n.md 의 "Rust 쪽"). 이 호출은 **결과를 기다리지 않는다** —
 * 화면 전환이 IPC 왕복에 매달릴 이유가 없고, 실패해도 백엔드가 한국어로 남을 뿐이다
 * (`npm run dev` 의 웹 미리보기·헤드리스 하네스에서는 `invoke` 가 `stub:` 으로 거절한다).
 */
export function setLocale(next: Locale): void {
  current = next;
  // 룬을 들일 수 없는 순수 모듈이 읽는 거울도 함께 민다 (`dict.translateNow`).
  mirrorLocale(next);
  if (typeof document !== "undefined") document.documentElement.lang = next;
  void invoke("set_language", { lang: next }).catch((e: unknown) => {
    console.warn("[aynx] 백엔드 문구의 언어를 바꾸지 못했습니다 (무시):", e);
  });
}

/**
 * 문구 하나 — `t("settings.general.language.label")`.
 *
 * 없는 키는 **컴파일에서** 막히고(`Key`), 사전에 칸이 비면 한국어 → 키 자체 순으로
 * 내려간다. `{이름}` 자리는 `params` 로 채운다: `t("…", { name })`.
 */
export function t(key: Parameters<typeof translate>[1], params?: Record<string, string | number>) {
  return translate(current, key, params);
}

export { LOCALES, resolveLocale, optionEntries, type Locale } from "$lib/i18n/dict";
export type { Key } from "$lib/i18n/keys";
