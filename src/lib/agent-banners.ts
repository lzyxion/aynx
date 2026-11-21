/**
 * 에이전트 알림 배너의 규칙 — 순수 모듈(룬 · DOM · Tauri 없음 — vitest 로 그대로 돈다). 상태 · 타이머는 `app/agent-banners.svelte.ts`.
 *
 * - 턴 끝 · 권한 물음은 사람이 답할 때까지 에이전트가 노는 부름이라 토스트처럼 사라지지 않고 해결될 때까지 남는다.
 * - 대상(타일 하나 또는 사이드 채팅 하나)마다 항목 하나 — 새 알림은 그 항목을 바꿔 맨 위로 올린다.
 * - × 는 해결이 아니다 — 배너에서만 비키고 배지 · 센터에는 남는다.
 * - `bornFocused`: 포커스된 타일에서 선 항목은 방문으로 풀면 서자마자 풀린다 — 포커스가 다른 타일로 떠날 때까지 방문 해결을
 *   건너뛰고, 접힘 시계도 사람이 돌아올(첫 입력) 때까지 멈춘다. 채팅은 보는 중이면 알리지 않으므로 이 표식이 없다.
 */

import type { AlertGroup } from "$lib/dock-alert-groups";

/** `stop` · `permission` 은 `$lib/agent-notify` 의 `AgentNotifyKind` 와 같은 값 · `failed` 는 사이드 채팅에만 */
export type BannerKind = "stop" | "permission" | "failed";

export type BannerWhere = { paneId: string; sideChatId?: undefined } | { sideChatId: string; paneId?: undefined };

/** 문자열은 타일의 `paneId`(옛 부름 그대로), `{ sideChatId }` 는 사이드 채팅 */
export type BannerTarget = string | { sideChatId: string };

export function bannerAt(b: BannerWhere, target: BannerTarget): boolean {
  return typeof target === "string" ? b.paneId === target : b.sideChatId === target.sideChatId;
}

function sameTarget(a: BannerWhere, b: BannerWhere): boolean {
  return a.paneId !== undefined ? b.paneId === a.paneId : b.sideChatId === a.sideChatId;
}

export type BannerResolution = "checked" | "auto";

export type BannerItem = BannerFields & BannerWhere;

export interface BannerFields {
  /** 같은 대상의 알림이 내용을 바꿔도 그대로다 — 키가 같아 카드가 제자리에서 바뀐다 */
  id: number;
  kind: BannerKind;
  /** 모르면 `null`(그리는 쪽이 일반 이름으로) */
  agent: string | null;
  logo: string | null;
  label: string;
  text: string;
  at: number;
  hidden: boolean;
  collapsed: boolean;
  /** 접힘 시계의 기준 */
  expandedAt: number;
  bornFocused: boolean;
  awaitingActivity: boolean;
  group?: AlertGroup;
  /** 없으면 `text` */
  short?: string;
}

export type ResolvedBanner = BannerItem & {
  resolution: BannerResolution;
  resolvedAt: number;
};

export interface BannerState {
  /** 새것이 앞 */
  active: readonly BannerItem[];
  /** 새것이 앞, [`MAX_RESOLVED`] 까지 */
  resolved: readonly ResolvedBanner[];
}

export type BannerInput = BannerWhere & {
  kind: BannerKind;
  agent: string | null;
  logo: string | null;
  label: string;
  text: string;
  bornFocused?: boolean;
  group?: AlertGroup;
  short?: string;
};

export const COLLAPSE_MS = 10_000;
export const MAX_SHOWN = 3;
/** 일반 알림 센터와 같은 한도(`MAX_NOTIFICATIONS`) */
export const MAX_RESOLVED = 100;

export const EMPTY_BANNERS: BannerState = { active: [], resolved: [] };

export function addBanner(state: BannerState, input: BannerInput, id: number, now: number): BannerState {
  const old = state.active.find((b) => sameTarget(b, input));
  const where: BannerWhere = input.paneId !== undefined ? { paneId: input.paneId } : { sideChatId: input.sideChatId };
  const item: BannerItem = {
    id: old?.id ?? id,
    ...where,
    kind: input.kind,
    agent: input.agent,
    logo: input.logo,
    label: input.label,
    text: input.text,
    at: now,
    hidden: false,
    collapsed: false,
    expandedAt: now,
    bornFocused: input.bornFocused === true,
    awaitingActivity: input.bornFocused === true,
  };
  if (input.group !== undefined) item.group = input.group;
  if (input.short !== undefined) item.short = input.short;
  return { ...state, active: [item, ...state.active.filter((b) => !sameTarget(b, input))] };
}

/** 그 항목이 `bornFocused` 면 건너뛴다. */
export function resolveVisit(state: BannerState, target: BannerTarget, now: number): BannerState {
  const item = state.active.find((b) => bannerAt(b, target));
  if (!item || item.bornFocused) return state;
  return resolveBanner(state, target, "checked", now);
}

export function releaseBornFocused(state: BannerState, focusedPaneId: string): BannerState {
  const off = (b: BannerItem) => b.bornFocused && b.paneId !== undefined && b.paneId !== focusedPaneId;
  if (!state.active.some(off)) return state;
  return { ...state, active: state.active.map((b) => (off(b) ? { ...b, bornFocused: false } : b)) };
}

export function awaitsActivity(state: BannerState): boolean {
  return state.active.some((b) => b.awaitingActivity);
}

export function activityResumed(state: BannerState, now: number): BannerState {
  if (!awaitsActivity(state)) return state;
  return {
    ...state,
    active: state.active.map((b) => (b.awaitingActivity ? { ...b, awaitingActivity: false, expandedAt: now } : b)),
  };
}

/** 풀 것이 없으면 같은 상태를 그대로 돌려준다 — 부르는 쪽이 `$state` 에 다시 넣어도 반응이 일지 않게(다른 함수들도 같다). */
export function resolveBanner(
  state: BannerState,
  target: BannerTarget,
  resolution: BannerResolution,
  now: number,
  kinds?: readonly BannerKind[],
): BannerState {
  const item = state.active.find((b) => bannerAt(b, target));
  if (!item || (kinds && !kinds.includes(item.kind))) return state;
  const done: ResolvedBanner = { ...item, resolution, resolvedAt: now };
  return {
    active: state.active.filter((b) => b !== item),
    resolved: [done, ...state.resolved].slice(0, MAX_RESOLVED),
  };
}

/** [모두 읽음] — 권한 물음은 남긴다: 에이전트가 답을 기다리며 멈춰 있어 "읽음" 한 번으로 치울 것이 아니다. */
export function resolveAllFinished(state: BannerState, now: number): BannerState {
  const stops = state.active.filter((b) => b.kind !== "permission");
  if (stops.length === 0) return state;
  const done = stops.map((b): ResolvedBanner => ({ ...b, resolution: "checked", resolvedAt: now }));
  return {
    active: state.active.filter((b) => b.kind === "permission"),
    resolved: [...done, ...state.resolved].slice(0, MAX_RESOLVED),
  };
}

/** 훅 신호 하나가 저절로 풀어 주는 갈래 — `tool` 은 권한을 풀지 않는다(권한 물음은 도구 앞에서 온다). */
export function resolvedBy(event: unknown): readonly BannerKind[] {
  switch (event) {
    case "start":
      return ["stop", "permission"];
    case "tool":
      return ["stop"];
    case "tool-done":
    case "stop":
      return ["permission"];
    default:
      return [];
  }
}

export function hideBanner(state: BannerState, id: number): BannerState {
  if (!state.active.some((b) => b.id === id && !b.hidden)) return state;
  return { ...state, active: state.active.map((b) => (b.id === id ? { ...b, hidden: true } : b)) };
}

/** "모두 지우기" — 해결은 아니다 */
export function hideAllBanners(state: BannerState): BannerState {
  if (!state.active.some((b) => !b.hidden)) return state;
  return { ...state, active: state.active.map((b) => (b.hidden ? b : { ...b, hidden: true })) };
}

export function expandBanner(state: BannerState, id: number, now: number): BannerState {
  if (!state.active.some((b) => b.id === id)) return state;
  return {
    ...state,
    active: state.active.map((b) => (b.id === id ? { ...b, collapsed: false, expandedAt: now } : b)),
  };
}

/** 호버가 끝났다 — 읽다가 손을 뗀 순간 접히지 않게 시계를 다시 센다. */
export function restartCollapse(state: BannerState, now: number): BannerState {
  if (!state.active.some((b) => !b.collapsed)) return state;
  return { ...state, active: state.active.map((b) => (b.collapsed ? b : { ...b, expandedAt: now })) };
}

/** `paused` = 호버 중 */
export function collapseDue(state: BannerState, now: number, paused = false): BannerState {
  if (paused) return state;
  const due = (b: BannerItem) =>
    !b.collapsed && !b.hidden && !b.awaitingActivity && now - b.expandedAt >= COLLAPSE_MS;
  if (!state.active.some(due)) return state;
  return { ...state, active: state.active.map((b) => (due(b) ? { ...b, collapsed: true } : b)) };
}

export function nextCollapseAt(state: BannerState): number | null {
  let next: number | null = null;
  for (const b of state.active) {
    if (b.collapsed || b.hidden || b.awaitingActivity) continue;
    const at = b.expandedAt + COLLAPSE_MS;
    if (next === null || at < next) next = at;
  }
  return next;
}

export interface BannerView {
  shown: readonly BannerItem[];
  /** "+N개 더" */
  more: number;
  canFold: boolean;
  clearAll: boolean;
}

export function bannerView(state: BannerState, showAll: boolean): BannerView {
  const visible = state.active.filter((b) => !b.hidden);
  const over = visible.length > MAX_SHOWN;
  return {
    shown: showAll ? visible : visible.slice(0, MAX_SHOWN),
    more: showAll ? 0 : Math.max(0, visible.length - MAX_SHOWN),
    canFold: showAll && over,
    clearAll: visible.length >= 2,
  };
}

/** `` Alt+` `` 가 갈 항목 — × 로 비킨 것 포함, 권한 물음이 먼저. */
export function nextBannerToVisit(state: BannerState): BannerItem | null {
  const urgent = (b: BannerItem) => b.kind === "permission";
  let best: BannerItem | null = null;
  for (const b of state.active) {
    if (best === null || (urgent(b) && !urgent(best)) || (urgent(b) === urgent(best) && b.at > best.at)) {
      best = b;
    }
  }
  return best;
}

/** 숨김 포함 */
export function bannerBadge(state: BannerState): { count: number; urgent: boolean } {
  return { count: state.active.length, urgent: state.active.some((b) => b.kind === "permission") };
}

/** 에이전트는 옆의 로고가 말한다 — 화면 읽기 프로그램은 로고를 읽지 않으므로 [`bannerAria`] 가 에이전트까지 붙인다. */
export function bannerTitle(item: Pick<BannerItem, "label">): string {
  return item.label;
}

export function bannerAria(item: Pick<BannerItem, "agent" | "label">, generic: string): string {
  return `${item.agent || generic} · ${item.label}`;
}
