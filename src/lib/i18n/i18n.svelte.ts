import { invoke } from "../ipc";
import { FALLBACK_LOCALE, mirrorLocale, translate, type Locale } from "$lib/i18n/dict";

/**
 * 지금 고른 언어와 그것을 읽는 창구 `t()`. 규칙(사전 찾기·폴백·자리 치환·OS 언어 판정)은 순수 `dict.ts` 에 둔다 — vitest 가 `.svelte.ts` 를 들여오지 못한다.
 * 저장 위치는 `settings.toml` 의 `[app] language` 이고 읽고 쓰는 것은 `settings.svelte.ts` 다 — 이 모듈은 설정을 알지 못한다(의존은 한 방향뿐이다).
 */

let current = $state<Locale>(FALLBACK_LOCALE);

/** 읽는 쪽이 반응형으로 따라오도록 함수다 */
export function locale(): Locale {
  return current;
}

/**
 * `<html lang>` 도 적는다(접근성 도구 · 줄바꿈 · 글꼴 대체가 본다). Rust 가 만드는 문구는 `src-tauri/src/i18n.rs` 의 전역 한 칸을 봐서 같은 값을 알린다
 * — 결과는 기다리지 않는다(실패해도 백엔드가 한국어로 남을 뿐이다 · 웹 미리보기 · 하네스에서는 `invoke` 가 `stub:` 으로 거절한다).
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
 * 없는 키는 컴파일에서 막히고(`Key`), 사전에 칸이 비면 한국어 → 키 자체 순으로 내려간다.
 */
export function t(key: Parameters<typeof translate>[1], params?: Record<string, string | number>) {
  return translate(current, key, params);
}

export { LOCALES, resolveLocale, optionEntries, type Locale } from "$lib/i18n/dict";
export type { Key } from "$lib/i18n/keys";
