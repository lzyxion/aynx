// 내부 전용 — 배럴(`settings.svelte.ts`)이 내보내지 않는다.
import { APP_TOKENS, type AppTokenKey } from "./options";

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
