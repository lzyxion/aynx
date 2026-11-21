/**
 * AI 타일 카드의 글자 — 순수 계산(Svelte 를 import 하지 않는다 — vitest 대상).
 *
 * 앱이 실제로 가진 것만 쓴다 — 훅은 프롬프트 글도 도구 이름도 싣지 않는다. 도구 호출 수는 세지 않는다
 * (`tool` · `tool-done` 은 같은 칸으로 접힌다 — 결정).
 */

import type { AgentSignals, AgentStatus } from "$lib/agent-status";
import { relativeTime } from "$lib/history-search";
import { isRemote, paneStartedIn, projectTail, type Project, type WorktreeInfo } from "$lib/projects";
import type { PaneSpec, Tr } from "$lib/session";

// ── 자리 ──

export interface AgentPlace {
  project: string | null;
  /** 브랜치(없으면 폴더 꼬리) */
  worktree: string | null;
}

/**
 * 독 트리 · 실행기의 에이전트 점과 같은 판정(`paneStartedIn`)이다. 마지막 길은 탭 제목 `<프로젝트> · <이름>` 꼴 —
 * 앱이 워크트리 탭에 붙이는 글자에 기대므로 그 꼴을 바꾸면 여기도 바꾼다(목록을 읽으려고 git 을 부르지 않으려는 길).
 */
export function agentPlace(
  pane: PaneSpec,
  projects: readonly Project[],
  listingOf: (projectId: string) => readonly WorktreeInfo[] | null,
  homeOf: (alias: string) => string | null,
  tabTitle: string,
): AgentPlace {
  for (const p of projects) {
    const home = isRemote(p) ? homeOf(p.host) : null;
    for (const w of listingOf(p.id) ?? []) {
      if (paneStartedIn(pane, p, w.path, home)) return { project: p.name, worktree: w.branch ?? projectTail(w.path) };
    }
  }
  for (const p of projects) {
    const home = isRemote(p) ? homeOf(p.host) : null;
    if (paneStartedIn(pane, p, p.path, home)) return { project: p.name, worktree: null };
  }
  const title = tabTitle.trim();
  for (const p of projects) {
    const head = `${p.name} · `;
    if (!title.startsWith(head) || title.length === head.length) continue;
    const sameSide = isRemote(p)
      ? pane.kind === "ssh" && pane.alias?.trim().toLowerCase() === p.host.trim().toLowerCase()
      : pane.kind === "local";
    if (sameSide) return { project: p.name, worktree: title.slice(head.length) };
  }
  return { project: null, worktree: null };
}

// ── 시각 ──

/** `active` = 실행 중인데 턴 시작을 모른다(새로 고침 뒤 · `start` 없이 온 도구 신호). */
export type AgentTime = { kind: "asked" | "turn" | "active" | "ended"; at: number } | null;

const at = (kind: NonNullable<AgentTime>["kind"], v: number | null): AgentTime => (v === null ? null : { kind, at: v });

/** 턴 시작은 실행 신호가 그 뒤에 있을 때만 믿는다 — 실행 신호가 앞서면 그 턴이 아직인지 모른다. */
export function agentTime(status: AgentStatus | null, sig: AgentSignals | null, turnStartedAt: number | null): AgentTime {
  if (sig === null) return null;
  switch (status) {
    case "permission":
      return at("asked", sig.signalPermissionAt);
    case "running":
      if (turnStartedAt !== null && sig.signalRunningAt !== null && turnStartedAt <= sig.signalRunningAt)
        return { kind: "turn", at: turnStartedAt };
      return at("active", sig.signalRunningAt);
    default:
      return at("ended", sig.signalStopAt);
  }
}

export function agentTimeLabel(time: AgentTime, now: number, tr: Tr): string {
  if (time === null) return "";
  if (time.kind === "turn") {
    const min = Math.floor(Math.max(0, now - time.at) / 60_000);
    if (min < 1) return tr("board.agents.time.turn.now");
    if (min < 60) return tr("board.agents.time.turn.minutes", { n: min });
    return tr("board.agents.time.turn.hours", { n: Math.floor(min / 60) });
  }
  const when = relativeTime(time.at, now, tr);
  if (time.kind === "asked") return tr("board.agents.time.asked", { when });
  if (time.kind === "active") return tr("board.agents.time.active", { when });
  return when;
}

// ── 카드의 글자 ──

export interface AgentTileInput {
  paneId: string;
  status: AgentStatus | null;
  signals: AgentSignals | null;
  turnStartedAt: number | null;
  place: AgentPlace;
  tabTitle: string;
  /** 로고 이름(`"claude"` · `"codex"`) — 모르면 `null` */
  ai: string | null;
}

export interface AgentCardText {
  title: string;
  sub: string | null;
  time: AgentTime;
}

export function agentCardText(tile: AgentTileInput): AgentCardText {
  return {
    title: tile.place.project ?? (tile.tabTitle.trim() || "?"),
    sub: tile.place.project ? tile.place.worktree : null,
    time: agentTime(tile.status, tile.signals, tile.turnStartedAt),
  };
}

export function cardName(title: string, sub: string | null): string {
  return sub ? `${title} · ${sub}` : title;
}
