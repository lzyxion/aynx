/**
 * **AI 타일 카드의 재료** — 순수 계산 (docs/log/2026-09-25-agent-board.md ·
 * docs/log/2026-09-28-dashboard-session-cards.md).
 *
 * 처음에는 대시보드 에이전트 칸 전체(나를 기다리는 것 + 에이전트 카드)를 짰다. 2026-09-28 에 그 칸이
 * 세션 칸의 카드 한 면으로 합쳐지며 여기 남은 것은 **AI 타일 하나의 글자**다: 자리(프로젝트 ·
 * 워크트리 — [`agentPlace`]), 상태에 맞는 시각([`agentTime`])과 그 사람 말([`agentTimeLabel`]),
 * 카드의 두 줄([`agentCardText`]). 순서·묶음은 `$lib/console/session-cards` 가 정한다.
 *
 * ## 앱이 **실제로 가진 것만**
 *
 * - 문구는 점 셋(실행 중 · 권한 대기 · 완료 — docs/log/2026-10-01-agent-status-three.md)과 같은 말이다 —
 *   훅은 턴의 프롬프트 글도 도구 이름도 싣지 않는다.
 * - 도구 호출 수는 **세지 않는다** — 훅 `tool`·`tool-done` 은 저장소에서 같은 칸
 *   (`signalRunningAt`)으로 접히고, 수를 보여 줄 자리가 판단을 돕지도 않는다(결정 — 로그 참고).
 * - 시각은 훅 신호 셋과 턴 시작(훅 `start`) 중 상태에 맞는 하나다([`agentTime`]).
 *
 * Svelte 를 import 하지 않는다 — vitest 대상이다.
 */

import type { AgentSignals, AgentStatus } from "$lib/agent-status";
import { relativeTime } from "$lib/history-search";
import { isRemote, paneStartedIn, projectTail, type Project, type WorktreeInfo } from "$lib/projects";
import type { PaneSpec, Tr } from "$lib/session";

// ---------------------------------------------------------------------------
// 자리 — 이 타일은 어느 프로젝트 · 워크트리의 것인가
// ---------------------------------------------------------------------------

/** 타일의 자리 — 모르면 둘 다 `null` */
export interface AgentPlace {
  /** 프로젝트 이름 */
  project: string | null;
  /** 워크트리 이름 — 브랜치(없으면 폴더 꼬리). 주 폴더는 목록을 읽어 둔 때만 브랜치를 안다 */
  worktree: string | null;
}

/**
 * 타일의 **시작 폴더**를 프로젝트 · 워크트리에 맞댄다 — 독 트리·실행기의 에이전트 점과 **같은
 * 판정**(`paneStartedIn`)이다. 세 길을 차례로 본다:
 *
 * 1. 읽어 둔 워크트리 목록(`listingOf` — 독이 펼쳐 읽은 사본)의 줄 → 프로젝트 + 브랜치.
 * 2. 프로젝트의 주 폴더 → 프로젝트(워크트리 모름).
 * 3. **탭 제목**이 앱이 워크트리 탭에 붙이는 `<프로젝트> · <이름>` 꼴이고 그 프로젝트가 같은
 *    자리(로컬 ↔ 로컬 타일, 원격 ↔ 같은 별칭)면 → 그 둘. 목록을 한 번도 안 읽은 창에서도 새
 *    워크트리 탭이 제 이름으로 읽히게 하는 길이다(목록을 읽으려고 git 을 부르지 않는다).
 *
 * 원격은 `homeOf(별칭)` 으로 `~` 를 편다(모르면 `null` — 글자 비교).
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

// ---------------------------------------------------------------------------
// 시각 — 상태마다 "무슨 시각" 인가
// ---------------------------------------------------------------------------

/**
 * 카드·줄에 적을 시각 한 칸.
 *
 * - `asked` — 권한을 물은 시각(권한 대기).
 * - `turn` — 지금 턴이 **시작된** 시각(실행 중 · 훅 `start` 를 받았을 때만) — "14분째".
 * - `active` — 마지막 실행 신호(실행 중인데 턴 시작을 모름 — 새로 고침 뒤 · `start` 없이 온 도구 신호).
 * - `ended` — 턴이 끝난 시각(훅 `stop`) — 완료이거나, 점이 없어도(이미 봤다) 마지막 턴이 끝난 때.
 */
export type AgentTime = { kind: "asked" | "turn" | "active" | "ended"; at: number } | null;

const at = (kind: NonNullable<AgentTime>["kind"], v: number | null): AgentTime => (v === null ? null : { kind, at: v });

/**
 * 상태에 맞는 시각 하나. 턴 시작은 **훅 실행 신호가 그 뒤에 있을 때만** 믿는다 — 턴 시작만 남고 실행
 * 신호가 그보다 앞서면 그 턴이 아직인지 모른다. 점이 없는 타일(`null`)은 마지막 턴이 끝난 시각만 말한다
 * (끝을 모르면 `null` — 지어내지 않는다).
 */
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

/**
 * 시각 → 사람 말. `asked` "권한 물음 3분 전" · `turn` "14분째" · `ended` "41분 전" ·
 * `active` "마지막 신호 5분 전". 상대 시각은 팔레트·실행기와 같은 [`relativeTime`] 계단이다.
 */
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

// ---------------------------------------------------------------------------
// 카드의 글자 — 세션 칸(`$lib/console/session-cards`)의 AI 카드가 읽는다
// ---------------------------------------------------------------------------

/** AI 타일 하나 — 부르는 쪽(`console/SessionBoard.svelte`)이 저장소에서 꺼내 채운다 */
export interface AgentTileInput {
  paneId: string;
  /** 지금 점 — 없으면 `null` */
  status: AgentStatus | null;
  signals: AgentSignals | null;
  turnStartedAt: number | null;
  place: AgentPlace;
  /** 그 타일이 든 탭의 제목(탭 바의 글자 그대로) — 자리를 모를 때의 이름 */
  tabTitle: string;
  /**
   * 에이전트의 **로고 이름**(`"claude"`·`"codex"` — `agentKindOf`). 카드의 아이콘 칸에 그 로고가
   * 선다(docs/log/2026-09-26-agent-logo-badges.md). 모르면 `null`(그림 없음).
   */
  ai: string | null;
}

/** AI 카드의 글자 두 줄과 시각 */
export interface AgentCardText {
  /** 첫 줄 — 프로젝트 이름, 모르면 탭 제목 */
  title: string;
  /** 둘째 줄(고정폭) — 워크트리 이름. 모르면 `null`(줄이 없다) */
  sub: string | null;
  time: AgentTime;
}

/**
 * AI 타일 → 카드의 글자. 프로젝트를 알면 제목 = 프로젝트 · 둘째 줄 = 워크트리, 모르면 탭 제목뿐이다
 * (지어내지 않는다). 시각은 상태에 맞는 하나([`agentTime`]).
 */
export function agentCardText(tile: AgentTileInput): AgentCardText {
  return {
    title: tile.place.project ?? (tile.tabTitle.trim() || "?"),
    sub: tile.place.project ? tile.place.worktree : null,
    time: agentTime(tile.status, tile.signals, tile.turnStartedAt),
  };
}

/** 카드 두 줄을 한 줄로 — 말풍선 · 스크린 리더가 읽는 이름 */
export function cardName(title: string, sub: string | null): string {
  return sub ? `${title} · ${sub}` : title;
}
