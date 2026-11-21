/**
 * 작업안 — 채팅 독의 작업안 갈래. 탭 타일로 두지 않는다 — 채팅 독과 겹치고 열 때마다 배치를 바꿨다(docs/log/2026-10-25-plans-tile-refresh.md).
 * 보조 창에는 독이 없어 주 창에 부탁한다. 원격 창은 메인 PC 레이아웃을 바꾸지 않고 제 창 안에서 보고, 승인은 원격 재확인 규칙 그대로다.
 * 원격에 캔버스를 덮는 판을 쓰지 않는다 — 타일을 가린 채 승인하게 했다.
 */

import { invoke, isRemote } from "../ipc";
import { requestWindow } from "$lib/workspaces/window-events";
import { chatDockAvailable, chatDockOpen, chatDockSection, closeChatDock, openChatDockAt } from "$lib/app/chat-dock.svelte.js";
import { closeMobileOverlay, mobileOverlay, openMobilePlans } from "$lib/app/mobile-sheets.svelte.js";
import { mobileLayout } from "$lib/app/mobile.svelte.js";

/** `list` = 진행(라벨만 "진행" — id 는 그대로) · `history` = 기록 */
export type OpsView = "list" | "history";

let view = $state<OpsView>("list");

export function plansView(): OpsView {
  return view;
}

/** 모르는 값(걷은 `compare` · `matrix` 등)은 진행으로 떨어진다 */
export function setPlansView(next: OpsView): void {
  view = next === "history" ? "history" : "list";
}

export interface PlansAsk {
  at?: string;
  history?: string;
  view?: OpsView;
}

export function plansOpenableHere(): boolean {
  return isRemote || chatDockAvailable();
}

export function forwardPlans(ask: PlansAsk): void {
  void requestWindow("main", { kind: "plans", ...ask })
    .then(() => invoke("focus_window", { label: "main" }))
    .catch(() => {});
}

/** 검토 카드가 이것을 보고 물러난다 — 같은 작업안의 승인 단추가 두 벌이 되지 않게 */
export function plansShown(): boolean {
  if (isRemote && mobileOverlay() === "plans") return true;
  return chatDockAvailable() && chatDockOpen() && chatDockSection() === "plans";
}

export function openPlans(): void {
  if (isRemote && mobileLayout()) {
    openMobilePlans();
    return;
  }
  if (chatDockAvailable()) {
    openChatDockAt("plans");
    return;
  }
  if (!isRemote) forwardPlans({ view });
}

function closePlans(): void {
  if (isRemote && mobileOverlay() === "plans") {
    closeMobileOverlay();
    return;
  }
  closeChatDock();
}

export function togglePlans(): void {
  if (plansShown()) closePlans();
  else openPlans();
}

// ── 딥링크 한 칸 ──

// 한 번만 꺼내진다 — 남겨 두면 다시 열 때마다 옛 요청이 되살아난다
let spotlightRequest = $state<string | null>(null);

/** 데려갈 카드는 진행 보기에만 있어 보기를 진행으로 돌린다 */
export function openPlansAt(operationId: string): void {
  if (!plansOpenableHere()) {
    forwardPlans({ at: operationId });
    return;
  }
  view = "list";
  spotlightRequest = operationId;
  openPlans();
}

export function takePlansRequest(): string | null {
  const r = spotlightRequest;
  spotlightRequest = null;
  return r;
}

/** 읽기만 — 효과가 의존성을 걸 때 쓴다 */
export function plansRequestPending(): string | null {
  return spotlightRequest;
}
