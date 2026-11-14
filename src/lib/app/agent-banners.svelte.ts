import {
  EMPTY_BANNERS,
  activityResumed,
  addBanner,
  awaitsActivity,
  bannerBadge,
  collapseDue,
  expandBanner,
  hideAllBanners,
  hideBanner,
  nextBannerToVisit,
  nextCollapseAt,
  releaseBornFocused,
  resolveAllFinished,
  resolveBanner,
  resolveVisit,
  resolvedBy,
  restartCollapse,
  type BannerInput,
  type BannerItem,
  type BannerKind,
  type BannerResolution,
  type BannerState,
  type ResolvedBanner,
} from "$lib/agent-banners";
import { focusTile, tabOfPane } from "$lib/app/tabs.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";
import { openSideChatFromAlert } from "$lib/app/side-chat-open";

/**
 * **에이전트 알림 배너의 저장소** — 창 하나에 한 벌 (docs/log/2026-09-27-agent-banners.md).
 *
 * 규칙(더하기·합치기·해결·숨김·접힘·넘침·배지)은 순수 모듈 `$lib/agent-banners` 에 있고, 여기 있는
 * 것은 `$state` 한 칸 · 접힘 타이머 하나 · 부작용(타일로 가기 · 빛내기)뿐이다.
 *
 * 쓰는 자리:
 * - `app/agent-notify.ts` — 알릴 때 [`pushAgentBanner`] (창이 앞에 없어 OS 알림을 쏠 때도 — 돌아왔을 때 남아 있게).
 * - `app/agent-status.svelte.ts` — 훅 신호마다 [`agentBannerSignal`](에이전트가 넘어가면 저절로 해결) ·
 *   타일/세션이 닫히면 [`dropAgentBanner`].
 * - `AgentNotifyBanners.svelte` — 그리기 · × · 알약 펼치기 · 호버 멈춤 · "그 타일로 갔다" 감지([`resolveVisited`]).
 * - `PaneHost.svelte` — 타일 안의 키·누름([`touchAgentBanner`]) — 보고 있는 타일에서 선 항목(`bornFocused`)이
 *   풀리는 길이다(docs/log/2026-09-27-agent-banners.md "보고 있는 타일도").
 * - `DockAlerts.svelte`(독 알림 칸 — 2026-10-18 통합 독, 옛 알림 센터 팝오버) · 상태바 알림 배지 — 확인할 것 / 지난 알림 · 배지.
 * - **사이드 채팅**(2026-11-13 — 항목의 대상이 `sideChatId`): `app/side-chat-notify` 가 알릴 때 [`pushAgentBanner`],
 *   `app/side-chat-live` 가 채팅의 사건마다 [`sideChatBannerSignal`](다른 창에서 답했다 · 새 턴이 섰다 — 저절로 해결),
 *   `AgentNotifyBanners.svelte` 가 "그 채팅을 봤다"([`resolveVisitedSideChat`]) · 지워진 채팅([`dropSideChatBanner`]).
 *   여는 길은 `app/side-chat-open` 의 `openSideChatFromAlert`(빛낼 타일이 없어 빛내지 않는다).
 *
 * **메모리에만** 산다 — 알림 센터와 같은 이유(CLAUDE.md "보안 제약" · docs/log/2026-09-25-notification-center.md).
 */

let state = $state<BannerState>(EMPTY_BANNERS);
let seq = 0;
/** 호버·키보드 포커스가 배너 위에 있다 — 접지 않는다 */
let held = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function set(next: BannerState): void {
  if (next === state) return;
  state = next;
  schedule();
  watchActivity();
}

// ---------------------------------------------------------------------------
// 사람이 돌아왔나 — 보고 있는 타일에서 선 항목(`awaitingActivity`)은 창 안의 첫 입력부터 접힘 시계를 센다
// ---------------------------------------------------------------------------

const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove"] as const;
let watching = false;

function onActivity(): void {
  set(activityResumed(state, Date.now()));
}

/** 기다리는 항목이 있을 때만 창의 입력을 듣는다(캡처 · 수동) — 없으면 뗀다 */
function watchActivity(): void {
  if (typeof window === "undefined") return;
  const need = awaitsActivity(state);
  if (need === watching) return;
  watching = need;
  for (const ev of ACTIVITY_EVENTS) {
    if (need) window.addEventListener(ev, onActivity, { capture: true, passive: true });
    else window.removeEventListener(ev, onActivity, { capture: true });
  }
}

/** 다음 접힘 시각에 타이머 하나 — 상태가 바뀔 때마다 다시 건다 */
function schedule(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (held) return;
  const at = nextCollapseAt(state);
  if (at === null) return;
  timer = setTimeout(
    () => {
      timer = null;
      set(collapseDue(state, Date.now(), held));
      // 같은 순간에 접힐 것이 없어 상태가 그대로면 `set` 이 다시 걸지 않는다 — 여기서 건다.
      if (timer === null) schedule();
    },
    Math.max(0, at - Date.now()),
  );
}

/** 알림 하나 — 같은 타일의 것이 있으면 바꿔 맨 위로 */
export function pushAgentBanner(input: BannerInput): void {
  set(addBanner(state, input, ++seq, Date.now()));
}

/** 훅 신호 하나 — 에이전트가 넘어갔으면 그 타일의 항목이 저절로 풀린다 (`resolvedBy` 의 표) */
export function agentBannerSignal(paneId: string, event: unknown): void {
  const kinds = resolvedBy(event);
  if (kinds.length === 0) return;
  set(resolveBanner(state, paneId, "auto", Date.now(), kinds));
}

/** 타일이 사라졌다 · 세션이 끝났다 */
export function dropAgentBanner(paneId: string): void {
  set(resolveBanner(state, paneId, "auto", Date.now()));
}

/** 사이드 채팅의 사건 하나 — 그 채팅의 `kinds` 갈래 항목을 저절로 해결한다(`$lib/side-chat-notify` 의 `sideChatResolvedBy`) */
export function sideChatBannerSignal(sideChatId: string, kinds: readonly BannerKind[]): void {
  if (kinds.length === 0) return;
  set(resolveBanner(state, { sideChatId }, "auto", Date.now(), kinds));
}

/** 채팅이 지워졌다 */
export function dropSideChatBanner(sideChatId: string): void {
  set(resolveBanner(state, { sideChatId }, "auto", Date.now()));
}

/** 한 항목을 해결하고 그 타일을 한 번 빛낸다 — 사람이 봤다 */
function resolveChecked(item: BannerItem & { paneId: string }): void {
  set(resolveBanner(state, item.paneId, "checked" satisfies BannerResolution, Date.now()));
  glowTile(item.paneId, item.kind === "permission" ? "accent" : "ok");
}

/**
 * [보기] · [확인하러 가기] · 알림 센터의 "확인할 것" 줄 — 그 탭으로 가 그 타일에 포커스를 주고 해결한다.
 * 탭은 **누를 때** 다시 찾는다(그 사이 타일을 옮겼을 수 있다). 타일이 없어졌으면 저절로 해결로 접는다.
 * 사이드 채팅 항목은 그 채팅을 열고(`openSideChatFromAlert`) 해결한다 — 채팅이 지워졌으면 저절로 해결로 접는다.
 */
export function openAgentBanner(id: number): void {
  const item = state.active.find((b) => b.id === id);
  if (!item) return;
  if (item.sideChatId !== undefined) {
    const chat = item.sideChatId;
    set(resolveBanner(state, { sideChatId: chat }, openSideChatFromAlert(chat) ? "checked" : "auto", Date.now()));
    return;
  }
  const tab = tabOfPane(item.paneId);
  if (!tab) {
    dropAgentBanner(item.paneId);
    return;
  }
  resolveChecked(item);
  // 면(터미널 · 대화)은 그대로 둔다 — 터미널 면이면 TUI 로, 대화 면이면 카드로 답한다(2026-11-03 사용자 결정)
  focusTile(tab.id, item.paneId);
}

/** 단축키 `` Alt+` `` — 남은 알림 하나로 간다([`nextBannerToVisit`] 의 순서). 남은 것이 없으면 아무 일도 없다. */
export function openNextAgentBanner(): void {
  const item = nextBannerToVisit(state);
  if (item) openAgentBanner(item.id);
}

/**
 * 사람이 **그 타일로 갔다**(어떤 길로든 — 탭 클릭 · Alt+화살표 · 마우스 · 탭 점) — 창이 앞에 있고 그
 * 타일이 활성 탭의 포커스된 타일이 되는 순간, 배너가 부른다(`AgentNotifyBanners` 의 `$effect`).
 * 그 타일에 **있던 채로** 선 항목(`bornFocused`)은 건너뛴다 — 그것은 [`touchAgentBanner`] 로 풀린다.
 */
export function resolveVisited(paneId: string): void {
  const item = state.active.find((b) => b.paneId === paneId);
  if (!item) return;
  const next = resolveVisit(state, paneId, Date.now());
  if (next === state) return;
  set(next);
  glowTile(paneId, item.kind === "permission" ? "accent" : "ok");
}

/**
 * 사람이 **그 채팅을 봤다** — 창이 앞에 있고 채팅 독(폰은 채팅 덮개)이 그 채팅을 보이는 순간, 배너가 부른다(`AgentNotifyBanners` 의
 * `$effect` · 보이는 채팅은 `app/side-chat-live` 의 `shownSideChat`). 타일의 [`resolveVisited`] 와 같은 결이다(빛낼 타일은 없다).
 */
export function resolveVisitedSideChat(sideChatId: string): void {
  set(resolveVisit(state, { sideChatId }, Date.now()));
}

/**
 * 포커스가 `paneId` 로 옮겨 왔다 — 다른 타일에서 `bornFocused` 로 선 항목은 표식을 벗는다(다음에 그 타일로
 * 가면 방문으로 풀린다). 배너의 `$effect` 가 [`resolveVisited`] 앞에 부른다.
 */
export function focusMovedTo(paneId: string): void {
  set(releaseBornFocused(state, paneId));
}

/**
 * 사람이 **그 타일을 만졌다**(타일 안의 키 · 누름 — `PaneHost` 의 캡처 핸들러) — 그 타일의 항목을 "확인함" 으로
 * 푼다. 이미 거기서 치고 있으니 빛내지 않는다. 항목이 없으면 아무 일도 없다(키마다 불리므로 싸게).
 */
export function touchAgentBanner(paneId: string): void {
  if (!state.active.some((b) => b.paneId === paneId)) return;
  set(resolveBanner(state, paneId, "checked", Date.now()));
}

/** **다른 창에서 사람이 그 타일의 턴 끝을 봤다**(`app/agent-seen`) — 끝남 항목만 "확인함" 으로 푼다. 권한 물음은 답해야 풀린다 */
export function seenAgentBanner(paneId: string): void {
  set(resolveBanner(state, paneId, "checked", Date.now(), ["stop"]));
}

/** **다른 창에서 사람이 그 채팅의 턴 끝을 봤다**(`app/agent-seen`) — 끝남 · 실패 항목만 "확인함" 으로 푼다. 권한 물음은 답해야 풀린다 */
export function seenSideChatBanner(sideChatId: string): void {
  set(resolveBanner(state, { sideChatId }, "checked", Date.now(), ["stop", "failed"]));
}

/** × — 배너에서만 비킨다 */
export function hideAgentBanner(id: number): void {
  set(hideBanner(state, id));
}

/** "모두 지우기" — 보이는 것 전부에 × */
export function hideAllAgentBanners(): void {
  set(hideAllBanners(state));
}

/** 알약 → 펼침 (시계 다시) */
export function expandAgentBanner(id: number): void {
  set(expandBanner(state, id, Date.now()));
}

/** 호버·포커스가 배너 위에 올라왔다 — 접힘 시계를 멈춘다 */
export function holdAgentBanners(): void {
  if (held) return;
  held = true;
  schedule();
}

/** 호버·포커스가 떠났다 — 펼친 카드의 시계를 처음부터 다시 */
export function releaseAgentBanners(): void {
  if (!held) return;
  held = false;
  const next = restartCollapse(state, Date.now());
  if (next === state) schedule();
  else set(next);
}

/** 해결되지 않은 항목 — 새것이 앞 (숨김 포함) */
export function agentBannerItems(): readonly BannerItem[] {
  return state.active;
}

/** 해결된 항목 — 새것이 앞 */
export function resolvedAgentBanners(): readonly ResolvedBanner[] {
  return state.resolved;
}

/** 저장소 통째 — 배너 기둥의 `bannerView` 재료 */
export function agentBannerState(): BannerState {
  return state;
}

/** 종의 배지 — 해결되지 않은 수 · 권한 물음이 있으면 강조색 */
export function agentBannerBadge(): { count: number; urgent: boolean } {
  return bannerBadge(state);
}

/** 지난 알림 한 줄 지우기 (알림 센터의 ×) */
export function forgetResolvedBanner(id: number): void {
  const next = state.resolved.filter((b) => b.id !== id);
  if (next.length !== state.resolved.length) state = { ...state, resolved: next };
}

/** 독 알림 칸의 [모두 읽음] — 끝남을 전부 "확인함" 으로(권한 물음은 남는다 — 순수 [`resolveAllFinished`]) */
export function resolveFinishedBanners(): void {
  set(resolveAllFinished(state, Date.now()));
}

/** 지난 알림 모두 지우기 (확인할 것은 남는다) */
export function clearResolvedBanners(): void {
  if (state.resolved.length > 0) state = { ...state, resolved: [] };
}
