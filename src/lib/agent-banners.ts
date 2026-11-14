/**
 * **에이전트 알림 배너의 규칙** — 순수 모듈 (docs/log/2026-09-27-agent-banners.md).
 *
 * 에이전트(Claude Code · Codex)의 **턴 끝**(`stop`)과 **권한 물음**(`permission`)은 토스트처럼 8초 뒤
 * 사라지면 안 되는 부름이다 — 사람이 답할 때까지 에이전트가 논다. 그래서 창 위 가운데에 **쌓이는
 * 배너**로 띄우고, 사람이 그 타일을 볼 때까지(또는 에이전트가 스스로 넘어갈 때까지) 남긴다.
 * 복사됨·저장됨 같은 일반 토스트는 오른쪽 위 그대로다(`toast.svelte.ts`).
 *
 * 룬도 DOM 도 Tauri 도 없다 — 상태를 받아 **새 상태**를 준다. `$state` 한 칸과 타이머·부작용은
 * `app/agent-banners.svelte.ts` 가 쥐고, 이 파일은 vitest 로 그대로 돈다(`agent-banners.test.ts`).
 *
 * ## 상태기계 — 항목 하나의 일생
 *
 * ```
 *   (알림) ─add─▶ 펼침 ──10초──▶ 알약 ──누름──▶ 펼침 (시계 다시)
 *                 │  ▲                │
 *                 ×  └─── 같은 타일의 새 알림(내용 교체 · 맨 위로 · 펼침)
 *                 ▼
 *               숨김(나중에) ── 배지·센터에는 남는다
 *
 *   어느 상태에서든 ─resolve─▶ 지난 알림 ("확인함" | "저절로 해결")
 * ```
 *
 * - **타일마다 하나** — 같은 타일의 새 알림은 그 항목의 내용을 바꾸고 맨 위로 올린다(숨김·알약도 풀린다).
 * - **해결**은 넷: [보기]를 눌렀다 · 그 타일로 갔다(어떤 길로든) → "확인함", 에이전트가 넘어갔다
 *   ([`resolvedBy`]) · 타일/세션이 닫혔다 → "저절로 해결". 해결된 항목은 지난 알림(최대 100)으로 간다.
 * - **×** 는 해결이 아니다 — 배너에서만 비키고 종의 배지·센터의 "확인할 것" 에는 남는다.
 *
 * ## 보고 있는 타일에서 선 항목 — `bornFocused` (2026-09-27)
 *
 * 포커스된 타일의 긴 턴도 알린다(`$lib/agent-notify` 의 `"focused"` — 포커스를 둔 채 자리를 비운 사람).
 * 그 항목은 이미 그 타일에 있으니 "그 타일로 갔다" 로 풀면 **서자마자 풀린다**. 그래서:
 *
 * - `bornFocused` 인 동안 방문 해결([`resolveVisit`])은 건너뛴다. 풀리는 길은 **그 타일을 만짐**(키 · 누름 —
 *   부르는 쪽이 [`resolveBanner`] 로 "확인함") · [보기] · 에이전트가 넘어감 · 타일이 닫힘.
 * - 포커스가 **다른 타일로 옮겨 가면** 표식을 벗는다([`releaseBornFocused`]) — 그 뒤로는 보통 항목이라
 *   다시 그 타일로 오면 방문으로 풀린다.
 * - 접힘 시계도 **사람이 돌아올 때까지** 멈춘다(`awaitingActivity`) — 자리를 비운 사이 10초 만에 알약으로
 *   줄어 있지 않게. 창 안의 첫 키·누름·마우스 움직임([`activityResumed`])부터 10초를 센다.
 *
 * ## 대상 — 타일 또는 사이드 채팅 (2026-11-13)
 *
 * 항목은 **타일**(`paneId`) 또는 **사이드 채팅**(`sideChatId`) 하나를 가리킨다(둘 중 하나만 — [`BannerWhere`]). 사이드 채팅 알림
 * (`app/side-chat-notify`)도 AI 타일 알림과 같은 것으로 알아보게 같은 기둥에 선다(사용자 결정 — 목업 A안). 규칙은 모두 같다 —
 * 합치기는 **대상마다 하나**, 해결 · 숨김 · 접힘 · 넘침 · 배지 · `` Alt+` `` 의 차례도 그대로다. 다른 것 셋:
 *
 * - 갈래가 하나 더 있다 — 답변 **실패**(`failed`, 채팅에만). 모양은 끝남과 같고 상태 점만 오류색이다.
 * - "그 타일로 갔다" 대신 **그 채팅을 봤다**(창이 앞 · 채팅 독(폰은 덮개)이 그 채팅) — 채팅에서는 보는 중이면 알리지 않으므로
 *   `bornFocused` 가 없다.
 * - 대상을 받는 함수는 문자열이면 타일(`paneId` — 옛 부름 그대로), `{ sideChatId }` 면 채팅이다([`BannerTarget`]).
 */

import type { AlertGroup } from "$lib/dock-alert-groups";

/**
 * 배너의 갈래 — 턴 끝 · 권한 물음 (`$lib/agent-notify` 의 `AgentNotifyKind` 와 같은 값) · 답변 실패(사이드 채팅에만 —
 * `$lib/side-chat-notify` 의 `failed`)
 */
export type BannerKind = "stop" | "permission" | "failed";

/** 항목이 가리키는 곳 — 타일 하나 또는 사이드 채팅 하나(머리말 "대상") */
export type BannerWhere = { paneId: string; sideChatId?: undefined } | { sideChatId: string; paneId?: undefined };

/** 대상을 받는 함수의 인자 — 문자열은 타일의 `paneId`, `{ sideChatId }` 는 사이드 채팅 */
export type BannerTarget = string | { sideChatId: string };

/** 그 항목이 그 대상을 가리키나 */
export function bannerAt(b: BannerWhere, target: BannerTarget): boolean {
  return typeof target === "string" ? b.paneId === target : b.sideChatId === target.sideChatId;
}

/** 두 항목이 같은 대상인가 — 합치기의 열쇠 */
function sameTarget(a: BannerWhere, b: BannerWhere): boolean {
  return a.paneId !== undefined ? b.paneId === a.paneId : b.sideChatId === a.sideChatId;
}

/** 해결의 두 갈래 — 사람이 봤다 · 저절로 풀렸다 */
export type BannerResolution = "checked" | "auto";

/** 배너 항목 하나 (아직 해결되지 않은 것) — 대상은 [`BannerWhere`] */
export type BannerItem = BannerFields & BannerWhere;

/** 항목의 대상 밖 칸들 */
export interface BannerFields {
  /** 창 안에서만 유일한 번호 — 같은 대상의 알림이 내용을 바꿔도 **그대로**다(키가 같아 카드가 제자리에서 바뀐다) */
  id: number;
  kind: BannerKind;
  /** 에이전트 이름(`aiDisplayName` — "Claude Code") · 모르면 `null`(그리는 쪽이 일반 이름으로) */
  agent: string | null;
  /** 로고 이름(`"claude"`·`"codex"`) · 모르면 `null` */
  logo: string | null;
  /** 탭/타일 이름 · 채팅 제목 — 알린 순간의 것 (`app/agent-notify` 의 `tileLabel` · `app/side-chat-notify`) */
  label: string;
  /** 알림 센터 한 줄 — 토스트 문구 그대로(`{name} — {agent} 작업이 끝났습니다`) */
  text: string;
  /** 마지막으로 알린 시각 (epoch ms) */
  at: number;
  /** × 로 비켰다 — 배너에서만 빠진다 */
  hidden: boolean;
  /** 알약으로 접혔다 */
  collapsed: boolean;
  /** 접힘 시계의 기준 — 펼쳐진 시각(더해짐·교체·다시 펼침·호버가 끝남) */
  expandedAt: number;
  /** 그 타일이 포커스된 채로 섰고 아직 포커스가 떠나지 않았다 — 방문으로 풀리지 않는다(머리말) */
  bornFocused: boolean;
  /** 사람이 돌아오기(창 안의 첫 입력)를 기다린다 — 그때까지 접힘 시계가 돌지 않는다 */
  awaitingActivity: boolean;
  /** 지난 알림 묶음의 열쇠 — 알린 순간 정한다(`$lib/dock-alert-groups`). 없으면 낱줄 */
  group?: AlertGroup;
  /** 묶음을 펼친 자식 줄의 짧은 글 — 출처 머리를 뗀 것(`app.agent.*.body`). 없으면 `text` */
  short?: string;
}

/** 해결된 항목 — 알림 센터의 "지난 알림" */
export type ResolvedBanner = BannerItem & {
  resolution: BannerResolution;
  resolvedAt: number;
};

/** 배너 저장소 전체 */
export interface BannerState {
  /** 해결되지 않은 항목 — **새것이 앞** */
  active: readonly BannerItem[];
  /** 해결된 항목 — 새것이 앞, [`MAX_RESOLVED`] 까지 */
  resolved: readonly ResolvedBanner[];
}

/** 알림 한 번이 싣고 오는 것 — 번호·시각·접힘은 저장하는 쪽이 붙인다 */
export type BannerInput = BannerWhere & {
  kind: BannerKind;
  agent: string | null;
  logo: string | null;
  label: string;
  text: string;
  /** 포커스된 타일에서 섰다(`"focused"` 갈래) — 안 주면 `false` */
  bornFocused?: boolean;
  group?: AlertGroup;
  short?: string;
};

/** 펼친 카드가 알약으로 접히기까지 (ms) */
export const COLLAPSE_MS = 10_000;
/** 배너 기둥에 한 번에 세우는 수 — 넘치면 "+N개 더" */
export const MAX_SHOWN = 3;
/** 지난 알림(해결된 항목)을 몇 줄까지 — 일반 알림 센터와 같은 한도(`MAX_NOTIFICATIONS`) */
export const MAX_RESOLVED = 100;

export const EMPTY_BANNERS: BannerState = { active: [], resolved: [] };

/**
 * 알림 하나를 더한다 — **같은 대상(타일 · 채팅)의 항목이 있으면 그것을 바꿔 맨 위로**(번호는 그대로), 없으면 새 번호로.
 * 어느 쪽이든 펼침 · 숨김 풀림 · 접힘 시계는 `now` 부터.
 */
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

/**
 * **그 타일로 갔다 · 그 채팅을 봤다** — 방문 해결. 그 항목이 `bornFocused` 면 건너뛴다(이미 거기 있던 채로 섰다 —
 * 머리말). 풀 것이 없으면 같은 상태.
 */
export function resolveVisit(state: BannerState, target: BannerTarget, now: number): BannerState {
  const item = state.active.find((b) => bannerAt(b, target));
  if (!item || item.bornFocused) return state;
  return resolveBanner(state, target, "checked", now);
}

/**
 * 포커스가 `focusedPaneId` 로 옮겨 왔다 — **다른 타일**의 `bornFocused` 표식을 벗긴다(다음 방문부터 보통
 * 항목처럼 풀린다). 벗길 것이 없으면 같은 상태.
 */
export function releaseBornFocused(state: BannerState, focusedPaneId: string): BannerState {
  const off = (b: BannerItem) => b.bornFocused && b.paneId !== undefined && b.paneId !== focusedPaneId;
  if (!state.active.some(off)) return state;
  return { ...state, active: state.active.map((b) => (off(b) ? { ...b, bornFocused: false } : b)) };
}

/** 사람을 기다리는 항목이 있는가 — 저장소가 창의 입력 감시를 켤지 정한다 */
export function awaitsActivity(state: BannerState): boolean {
  return state.active.some((b) => b.awaitingActivity);
}

/** 사람이 돌아왔다(창 안의 첫 입력) — 기다리던 항목의 접힘 시계를 `now` 부터 센다 */
export function activityResumed(state: BannerState, now: number): BannerState {
  if (!awaitsActivity(state)) return state;
  return {
    ...state,
    active: state.active.map((b) => (b.awaitingActivity ? { ...b, awaitingActivity: false, expandedAt: now } : b)),
  };
}

/**
 * 그 대상(타일 · 채팅)의 항목을 해결한다 — 지난 알림 맨 앞으로. `kinds` 를 주면 그 갈래일 때만(에이전트 신호의 자동
 * 해결 — [`resolvedBy`]). 없으면 **같은 상태를 그대로** 돌려준다(부르는 쪽이 `$state` 에 다시 넣어도 반응이 일지 않게).
 */
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

/**
 * **끝남(`stop` · 채팅의 `failed`)을 전부 "확인함" 으로** — 독 알림 칸 바닥 줄의 [모두 읽음](2026-10-18 통합 독). 권한 물음은 남긴다:
 * 에이전트가 사람의 답을 기다리며 멈춰 있는 일이라 "읽음" 한 번으로 치울 것이 아니다(그 타일로 가서 답해야 풀린다).
 * 해결된 순서는 지금 줄의 순서 그대로 지난 알림 맨 앞에 선다. 끝남이 없으면 **같은 상태**다.
 */
export function resolveAllFinished(state: BannerState, now: number): BannerState {
  const stops = state.active.filter((b) => b.kind !== "permission");
  if (stops.length === 0) return state;
  const done = stops.map((b): ResolvedBanner => ({ ...b, resolution: "checked", resolvedAt: now }));
  return {
    active: state.active.filter((b) => b.kind === "permission"),
    resolved: [...done, ...state.resolved].slice(0, MAX_RESOLVED),
  };
}

/**
 * 훅 신호(`agent-signal` 의 `event`) 하나가 **저절로 풀어 주는** 갈래.
 *
 * | 신호 | 풀리는 것 | 왜 |
 * | --- | --- | --- |
 * | `start` (새 턴) | 끝남 · 권한 | 사람이 이미 그 타일에서 다음 말을 걸었다 |
 * | `tool` (도구 시작) | 끝남 | 새 턴이 돌고 있다 — 권한 물음은 도구 **앞**에서 오므로 풀지 않는다 |
 * | `tool-done` (도구 끝) | 권한 | 승인한 도구가 돌고 끝났다 = 답했다 |
 * | `stop` (턴 끝) | 권한 | 물음을 지나 턴이 끝났다 (곧이어 끝남 알림이 같은 자리에 선다) |
 * | `waiting` | — | 입력 대기 그 자체다 |
 */
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

/** × — 배너에서만 비킨다 (없는 번호·이미 숨김이면 같은 상태) */
export function hideBanner(state: BannerState, id: number): BannerState {
  if (!state.active.some((b) => b.id === id && !b.hidden)) return state;
  return { ...state, active: state.active.map((b) => (b.id === id ? { ...b, hidden: true } : b)) };
}

/** "모두 지우기" — 보이는 것 전부에 × (해결은 아니다) */
export function hideAllBanners(state: BannerState): BannerState {
  if (!state.active.some((b) => !b.hidden)) return state;
  return { ...state, active: state.active.map((b) => (b.hidden ? b : { ...b, hidden: true })) };
}

/** 알약을 다시 펼친다 — 접힘 시계도 `now` 부터 다시 */
export function expandBanner(state: BannerState, id: number, now: number): BannerState {
  if (!state.active.some((b) => b.id === id)) return state;
  return {
    ...state,
    active: state.active.map((b) => (b.id === id ? { ...b, collapsed: false, expandedAt: now } : b)),
  };
}

/**
 * 호버가 끝났다 — 펼친 카드들의 접힘 시계를 `now` 부터 다시 센다(머무는 동안 멈췄던 몫을 돌려준다 —
 * 읽다가 손을 뗀 순간 접히지 않게).
 */
export function restartCollapse(state: BannerState, now: number): BannerState {
  if (!state.active.some((b) => !b.collapsed)) return state;
  return { ...state, active: state.active.map((b) => (b.collapsed ? b : { ...b, expandedAt: now })) };
}

/** 때가 된 펼친 카드를 알약으로 — `paused`(호버 중)면 아무것도 접지 않는다 · 사람을 기다리는 카드는 빼고 */
export function collapseDue(state: BannerState, now: number, paused = false): BannerState {
  if (paused) return state;
  const due = (b: BannerItem) =>
    !b.collapsed && !b.hidden && !b.awaitingActivity && now - b.expandedAt >= COLLAPSE_MS;
  if (!state.active.some(due)) return state;
  return { ...state, active: state.active.map((b) => (due(b) ? { ...b, collapsed: true } : b)) };
}

/** 다음에 접힐 시각 — 접힐 카드가 없으면 `null` (저장소가 타이머 하나를 이 시각에 건다) */
export function nextCollapseAt(state: BannerState): number | null {
  let next: number | null = null;
  for (const b of state.active) {
    if (b.collapsed || b.hidden || b.awaitingActivity) continue;
    const at = b.expandedAt + COLLAPSE_MS;
    if (next === null || at < next) next = at;
  }
  return next;
}

/** 배너 기둥이 그릴 것 */
export interface BannerView {
  /** 세울 항목 — 새것이 위 */
  shown: readonly BannerItem[];
  /** 접혀서 안 보이는 수 ("+N개 더") — `showAll` 이면 0 */
  more: number;
  /** "접기" 칩을 세울까 — 다 펼쳐 봤고 넘치는 몫이 있었다 */
  canFold: boolean;
  /** "모두 지우기" 칩 — 보이는 항목이 둘 이상일 때 */
  clearAll: boolean;
}

/** 기둥의 모양 — 숨기지 않은 항목 중 위 셋(`showAll` 이면 전부) + 칩 둘 */
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

/**
 * `` Alt+` ``(알림 위치로 가기)가 갈 항목 — 해결되지 않은 것(× 로 비킨 것 포함) 중 **권한 물음이 먼저**,
 * 그 밖(끝남 · 실패)끼리는 최근(`at`)이 먼저 — 타일 · 채팅을 가리지 않는다. 가면 그 항목이 해결되므로 다시 누르면 다음 것으로
 * 넘어간다. 없으면 `null`.
 */
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

/** 종의 배지 — 해결되지 않은 에이전트 항목 수(숨김 포함) · 권한 물음이 하나라도 있으면 강조색 */
export function bannerBadge(state: BannerState): { count: number; urgent: boolean } {
  return { count: state.active.length, urgent: state.active.some((b) => b.kind === "permission") };
}

/** 배너 머리줄 — `{에이전트} · {이름}` */
export function bannerTitle(item: Pick<BannerItem, "agent" | "label">, generic: string): string {
  return `${item.agent || generic} · ${item.label}`;
}
