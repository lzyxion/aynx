// **내부 전용** — `settings/model/` 형제끼리만 나누는 비공개 조각(색 토큰 키 목록 · 오류 글자).
// 배럴(`settings.svelte.ts`)이 내보내지 않는다.
import { APP_TOKENS, type AppTokenKey } from "./options";

/**
 * `APP_TOKENS` 의 키 목록 — 순회할 때마다 `Object.keys` 를 캐스팅하지 않으려고 한 번만 만든다.
 *
 * 테마 버튼·월페이퍼 추출·정규화·저장·비교는 언제나 여덟 칸 전부를 다룬다.
 */
export const APP_TOKEN_KEYS = Object.keys(APP_TOKENS) as AppTokenKey[];

export function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
