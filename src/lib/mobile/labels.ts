// 모바일 위 띠 · 고르기 화면의 라벨 — 순수 모듈. 이름은 데스크톱 탭 바와 같은 출처(`app/titles` 의 `displayName`)를 받아 나누기만 한다.

import type { AgentStatus } from "$lib/agent-status";
import type { Key } from "$lib/i18n/keys";
import type { PaneView } from "$lib/mirror/snapshot";

export interface TileParts {
  name: string;
  sub: string;
}

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

export function tileLabel(name: string, view: PaneView | null | undefined): string {
  const { name: head, sub } = tileParts(name, view);
  return sub ? `${head} · ${sub}` : head;
}

export function positionChip(tabIndex: number, tileIndex: number, tileCount: number): string {
  if (tabIndex < 1) return "";
  if (tileCount <= 1 || tileIndex < 1) return `${tabIndex}`;
  return `${tabIndex} · ${tileIndex}/${tileCount}`;
}

export const AGENT_LABEL: Record<AgentStatus, Key> = {
  running: "app.mobile.agent.running",
  permission: "app.mobile.agent.permission",
  finished: "app.mobile.agent.finished",
};

/** 급한 차례 — 권한 > 안 본 끝 > 도는 중 */
const URGENCY: readonly AgentStatus[] = ["permission", "finished", "running"];

export function mostUrgentAgent(states: Iterable<AgentStatus | null | undefined>): AgentStatus | null {
  let best = URGENCY.length;
  for (const s of states) {
    const i = s ? URGENCY.indexOf(s) : -1;
    if (i >= 0 && i < best) best = i;
  }
  return URGENCY[best] ?? null;
}

export interface WorkspaceChip {
  id: string;
  name: string;
  tabs: number;
  cold: boolean;
  agent: AgentStatus | null;
  selected: boolean;
}

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
