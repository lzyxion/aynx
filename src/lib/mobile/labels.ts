// **모바일 위 띠 · 고르기 화면의 라벨**(원격 웹 R5 · 10-16 · 고르기 화면 10-20) — 순수 모듈.
//
// - 이름은 데스크톱 탭 바 · 머리줄과 **같은 출처**(`app/titles` 의 `displayName` — 원격은 집 PC 거울이 알려 준 AI 로 "Claude Code"
//   · "Claude Code · dev-01")를 받고, 여기서는 굵은 이름 / 흐린 덧말(호스트 · 작업 폴더 한 토막)로 나누기만 한다.
// - 에이전트 상태는 글자 기호가 아니라 글리프(`AgentStatusGlyph` — 탭 줄과 같은 그림) + 낱말이다 — 고르기가 `<select>` 한 줄이던 때(10-16)의 기호는 걷었다.
// - 위치 칩: 탭 번호 하나, 그 탭에 타일이 둘 이상이면 `탭 · 타일/타일 수`.

import type { AgentStatus } from "$lib/agent-status";
import type { Key } from "$lib/i18n/keys";
import type { PaneView } from "$lib/mirror/snapshot";

/** 이름 두 토막 — `name` 은 굵게, `sub` 는 흐리게(없으면 빈 글자) */
export interface TileParts {
  name: string;
  sub: string;
}

/**
 * **타일 이름 나누기** — `displayName` 의 첫 토막이 이름, 나머지(원격 AI 의 호스트) + 작업 폴더가 덧말. 폴더는 이름에 이미
 * 들어 있으면(같은 낱말) 붙이지 않는다. `view` 는 집 PC 가 알려 준 보이는 모습(없으면 `null`).
 */
export function tileParts(name: string, view: PaneView | null | undefined): TileParts {
  const parts = name
    .trim()
    .split(" · ")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const folder = view?.folder?.trim();
  if (folder && !parts.includes(folder)) parts.push(folder);
  return { name: parts[0] ?? "", sub: parts.slice(1).join(" · ") };
}

/** **타일 한 줄**(글자만) — `이름 · 호스트 · 폴더`. 이름 없는 단독 타일 탭의 제목이 이것이다 */
export function tileLabel(name: string, view: PaneView | null | undefined): string {
  const { name: head, sub } = tileParts(name, view);
  return sub ? `${head} · ${sub}` : head;
}

/**
 * **위 띠의 위치 칩** — 1부터 센다. 타일이 하나면 탭 번호만, 둘 이상이면 `탭 · 타일/타일 수`.
 * 고른 탭이 없으면(`tabIndex < 1`) 빈 글자 — 칩을 그리지 않는다.
 */
export function positionChip(tabIndex: number, tileIndex: number, tileCount: number): string {
  if (tabIndex < 1) return "";
  if (tileCount <= 1 || tileIndex < 1) return `${tabIndex}`;
  return `${tabIndex} · ${tileIndex}/${tileCount}`;
}

/** 에이전트 상태 낱말의 키 — 고르기 화면 줄 끝(점 옆) */
export const AGENT_LABEL: Record<AgentStatus, Key> = {
  running: "app.mobile.agent.running",
  permission: "app.mobile.agent.permission",
  finished: "app.mobile.agent.finished",
};

/** 급한 차례 — 손을 기다리는 것(권한) > 안 본 끝 > 도는 중 */
const URGENCY: readonly AgentStatus[] = ["permission", "finished", "running"];

/** **가장 급한 에이전트 상태** 하나(없으면 `null`) — 워크스페이스 칩의 점 */
export function mostUrgentAgent(states: Iterable<AgentStatus | null | undefined>): AgentStatus | null {
  let best = URGENCY.length;
  for (const s of states) {
    const i = s ? URGENCY.indexOf(s) : -1;
    if (i >= 0 && i < best) best = i;
  }
  return URGENCY[best] ?? null;
}

/** 고르기 화면의 워크스페이스 칩 한 장 */
export interface WorkspaceChip {
  id: string;
  name: string;
  /** 탭 수 — 열린 것은 거울의 탭 수, cold 는 저장된 탭 수 */
  tabs: number;
  /** 집 PC 가 아직 열지 않았다(고를 타일이 없다) */
  cold: boolean;
  /** 그 워크스페이스 타일들 중 가장 급한 에이전트 상태 */
  agent: AgentStatus | null;
  /** 고르기 화면이 지금 보여 주는 워크스페이스 */
  selected: boolean;
}

/**
 * **워크스페이스 칩 줄**(10-20 — 폰 고르기 화면) — 순수. 거울의 워크스페이스 목록 순서 그대로, 탭 수 · 가장 급한 에이전트 점 ·
 * 고른 칩(`browsing`). `tabs` 는 원격 창의 탭(소속 · 타일 id), `agentOf` 는 타일의 에이전트 상태(거울의 보이는 모습).
 */
export function workspaceChips(
  rows: readonly { id: string; name: string; cold?: boolean; tabCount?: number }[],
  tabs: readonly { workspaceId?: string; paneIds: readonly string[] }[],
  agentOf: (paneId: string) => AgentStatus | null | undefined,
  browsing: string | null,
): WorkspaceChip[] {
  return rows.map((w) => {
    const own = w.cold ? [] : tabs.filter((tab) => tab.workspaceId === w.id);
    return {
      id: w.id,
      name: w.name,
      tabs: w.cold ? (w.tabCount ?? 0) : own.length,
      cold: !!w.cold,
      agent: mostUrgentAgent(own.flatMap((tab) => tab.paneIds.map(agentOf))),
      selected: w.id === browsing,
    };
  });
}
