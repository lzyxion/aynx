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

/** 에이전트 알림 배너의 저장소 — 창 하나에 한 벌 · 메모리에만 산다(알림 센터와 같은 이유 — CLAUDE.md "보안 제약") */

let state = $state<BannerState>(EMPTY_BANNERS);
let seq = 0;
let held = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function set(next: BannerState): void {
  if (next === state) return;
  state = next;
  schedule();
  watchActivity();
}

// ---------------------------------------------------------------------------
// 사람이 돌아왔나 — 보고 있는 타일에서 선 항목은 창 안의 첫 입력부터 접힘 시계를 센다
// ---------------------------------------------------------------------------

const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove"] as const;
let watching = false;

function onActivity(): void {
  set(activityResumed(state, Date.now()));
}

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

export function pushAgentBanner(input: BannerInput): void {
  set(addBanner(state, input, ++seq, Date.now()));
}

export function agentBannerSignal(paneId: string, event: unknown): void {
  const kinds = resolvedBy(event);
  if (kinds.length === 0) return;
  set(resolveBanner(state, paneId, "auto", Date.now(), kinds));
}

export function dropAgentBanner(paneId: string): void {
  set(resolveBanner(state, paneId, "auto", Date.now()));
}

export function sideChatBannerSignal(sideChatId: string, kinds: readonly BannerKind[]): void {
  if (kinds.length === 0) return;
  set(resolveBanner(state, { sideChatId }, "auto", Date.now(), kinds));
}

export function dropSideChatBanner(sideChatId: string): void {
  set(resolveBanner(state, { sideChatId }, "auto", Date.now()));
}

function resolveChecked(item: BannerItem & { paneId: string }): void {
  set(resolveBanner(state, item.paneId, "checked" satisfies BannerResolution, Date.now()));
  glowTile(item.paneId, item.kind === "permission" ? "accent" : "ok");
}

/** 탭은 누를 때 다시 찾는다 — 그 사이 타일을 옮겼을 수 있다 */
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
  // 면(터미널 · 대화)은 바꾸지 않는다 — 터미널 면이면 TUI 로, 대화 면이면 카드로 답한다(사용자 결정)
  focusTile(tab.id, item.paneId);
}

export function openNextAgentBanner(): void {
  const item = nextBannerToVisit(state);
  if (item) openAgentBanner(item.id);
}

/** 그 타일에 있던 채로 선 항목(`bornFocused`)은 건너뛴다 — 그것은 [`touchAgentBanner`] 로 풀린다 */
export function resolveVisited(paneId: string): void {
  const item = state.active.find((b) => b.paneId === paneId);
  if (!item) return;
  const next = resolveVisit(state, paneId, Date.now());
  if (next === state) return;
  set(next);
  glowTile(paneId, item.kind === "permission" ? "accent" : "ok");
}

export function resolveVisitedSideChat(sideChatId: string): void {
  set(resolveVisit(state, { sideChatId }, Date.now()));
}

/** 배너의 `$effect` 가 [`resolveVisited`] 앞에 부른다 */
export function focusMovedTo(paneId: string): void {
  set(releaseBornFocused(state, paneId));
}

/** 키마다 불리므로 항목이 없으면 곧바로 돌아간다 · 이미 거기서 치고 있으니 빛내지 않는다 */
export function touchAgentBanner(paneId: string): void {
  if (!state.active.some((b) => b.paneId === paneId)) return;
  set(resolveBanner(state, paneId, "checked", Date.now()));
}

/** 다른 창에서 본 턴 끝 — 권한 물음은 답해야 풀린다 */
export function seenAgentBanner(paneId: string): void {
  set(resolveBanner(state, paneId, "checked", Date.now(), ["stop"]));
}

export function seenSideChatBanner(sideChatId: string): void {
  set(resolveBanner(state, { sideChatId }, "checked", Date.now(), ["stop", "failed"]));
}

export function hideAgentBanner(id: number): void {
  set(hideBanner(state, id));
}

export function hideAllAgentBanners(): void {
  set(hideAllBanners(state));
}

export function expandAgentBanner(id: number): void {
  set(expandBanner(state, id, Date.now()));
}

export function holdAgentBanners(): void {
  if (held) return;
  held = true;
  schedule();
}

export function releaseAgentBanners(): void {
  if (!held) return;
  held = false;
  const next = restartCollapse(state, Date.now());
  if (next === state) schedule();
  else set(next);
}

export function agentBannerItems(): readonly BannerItem[] {
  return state.active;
}

export function resolvedAgentBanners(): readonly ResolvedBanner[] {
  return state.resolved;
}

export function agentBannerState(): BannerState {
  return state;
}

export function agentBannerBadge(): { count: number; urgent: boolean } {
  return bannerBadge(state);
}

export function forgetResolvedBanner(id: number): void {
  const next = state.resolved.filter((b) => b.id !== id);
  if (next.length !== state.resolved.length) state = { ...state, resolved: next };
}

export function resolveFinishedBanners(): void {
  set(resolveAllFinished(state, Date.now()));
}

export function clearResolvedBanners(): void {
  if (state.resolved.length > 0) state = { ...state, resolved: [] };
}
