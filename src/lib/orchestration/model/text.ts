/**
 * 공통 표시 — 번역 함수 타입 `Tr` · 서버 낱말 → 문구의 단 하나의 대체(`keyOf` · `keyText`) · 시간 · 짧은 해시 · 줄임.
 */

import type { Key } from "$lib/i18n/keys";

export type Tr = (key: Key, params?: Record<string, string | number>) => string;

/**
 * **서버 낱말 → 사람 문구의 단 하나의 대체 길**(3차 3b — 3a 실기의 보드 예외 `lookup(undefined).indexOf`). 표(`*_KEY`)에 있으면 그 키의
 * 문구, 없으면(서버가 새 값을 더했는데 프런트 표가 모름 · 칸이 비었음) **날 낱말 그대로**를 돌려준다 — 예외를 내지 않는다. 표가 서버
 * enum 을 전부 덮는지는 시험이 Rust serde 이름 목록으로 지킨다(`model.test.ts` "번역 키 표").
 */
export function keyOf(table: Readonly<Record<string, Key>>, value: string | null | undefined): Key | null {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(table, value)) return null;
  return table[value] ?? null;
}

/** [`keyOf`] 의 문구 — 모르는 값은 날 낱말(빈 값이면 `?`) */
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

/** 긴 글을 한 줄로 줄인다 — `{short, clipped}`(펼침은 부르는 쪽이 원문으로) */
export function clipText(s: string, max = 140): { short: string; clipped: boolean } {
  const flat = s.replace(/\s+/g, " ").trim();
  if ([...flat].length <= max) return { short: flat, clipped: false };
  return { short: [...flat].slice(0, max - 1).join("") + "…", clipped: true };
}

/** `1:05:09` · `12:03` 꼴의 시간(초 단위 버림) */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 커밋 짧은 해시(7자) — 없으면 빈 글자 */
export function shortOid(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 7) : "";
}
