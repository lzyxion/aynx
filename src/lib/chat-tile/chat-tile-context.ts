// 채팅 모양 AI 타일의 맥락 사용량 — CLI 가 알린 수(받기만 한 것)를 미터 글 · 색으로 바꾸는 순수 층. 값 import 없음.

import type { ChatTileContext } from "./chat-tile-api";

export const CONTEXT_WARN = 70; // %
/** 미터에 [압축] 단추가 선다 */
export const CONTEXT_HIGH = 85; // %

export interface ContextView {
  used: number;
  window: number | null;
  /** 0–100 정수 · window 를 모르면 null */
  pct: number | null;
  /** pct null 이면 "ok" */
  tone: "ok" | "warn" | "high";
  /** 칩 글 — "36.1k / 1M" · window 모름이면 "36.1k" */
  label: string;
  /** 폰 칩 글 — "4%" · 모름이면 "36.1k" */
  short: string;
  /** 압축 전 값을 다시 보이는 중(`preCompact`) — 다음 턴 값이 올 때까지 칩을 흐린다 */
  stale: boolean;
}

function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, "");
}

/** 950 → "950" · 36149 → "36.1k" · 1000000 → "1M" · 1234567 → "1.2M" · 소수 한 자리 · 끝의 ".0" 뺌 */
export function formatTokens(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  if (v < 1000) return String(v);
  // 반올림이 다음 단위에 닿으면(999950 → "1000k") 올린다
  if (Math.round(v / 100) < 10000) return `${trim1(v / 1000)}k`;
  return `${trim1(v / 1_000_000)}M`;
}

export function contextView(c: ChatTileContext | null): ContextView | null {
  if (!c || typeof c.used !== "number" || !Number.isFinite(c.used)) return null;
  const used = Math.max(0, Math.round(c.used));
  const window = typeof c.window === "number" && Number.isFinite(c.window) && c.window > 0 ? Math.round(c.window) : null;
  const pct = window === null ? null : Math.min(100, Math.max(0, Math.round((used / window) * 100)));
  const tone = pct === null ? "ok" : pct >= CONTEXT_HIGH ? "high" : pct >= CONTEXT_WARN ? "warn" : "ok";
  const u = formatTokens(used);
  return {
    used,
    window,
    pct,
    tone,
    label: window === null ? u : `${u} / ${formatTokens(window)}`,
    short: pct === null ? u : `${pct}%`,
    stale: c.source === "preCompact",
  };
}
