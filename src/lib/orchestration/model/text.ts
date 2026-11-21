import type { Key } from "$lib/i18n/keys";

export type Tr = (key: Key, params?: Record<string, string | number>) => string;

/**
 * 서버 낱말 → 문구의 단 하나의 길 — 표에 없는 값(서버가 새로 더한 값)에 예외를 내지 않는다.
 * 표가 서버 enum 을 전부 덮는지는 `model.test.ts` "번역 키 표" 가 지킨다.
 */
export function keyOf(table: Readonly<Record<string, Key>>, value: string | null | undefined): Key | null {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(table, value)) return null;
  return table[value] ?? null;
}

export function keyText(
  table: Readonly<Record<string, Key>>,
  value: string | null | undefined,
  tr: Tr,
  params?: Record<string, string | number>,
): string {
  const key = keyOf(table, value);
  if (key) return tr(key, params);
  return typeof value === "string" && value !== "" ? value : "?";
}

export function clipText(s: string, max = 140): { short: string; clipped: boolean } {
  const flat = s.replace(/\s+/g, " ").trim();
  if ([...flat].length <= max) return { short: flat, clipped: false };
  return { short: [...flat].slice(0, max - 1).join("") + "…", clipped: true };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function shortOid(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 7) : "";
}
