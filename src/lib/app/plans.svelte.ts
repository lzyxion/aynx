/**
 * **작업안 — 보기 · 딥링크 · 여는 길** (2026-10-07 대시보드의 작업안 칸 → 작업안 타일 · 2026-10-25 → **채팅 독의 갈래**).
 *
 * 작업안(AI 가 저장한 실행 계획)의 검토 · 승인 · 실행 결과는 **가끔 · 길게** 지켜보는 일이다. 10-07 에는 옆 터미널과 나란히 띄우는 타일
 * (`kind:"plans"`)이 됐지만, 10-23 에 오른쪽에 채팅 독이 서며 겹쳤고, 타일은 탭에 묶여 열 때마다 배치(지금 탭 루트를 45% 로 쪼개기)를
 * 바꿨다. 그래서 **탭 밖에 뜨는 채팅 독의 갈래 [채팅 | 작업안]** 로 옮겼다(사용자 결정 10-25 · docs/log/2026-10-25-plans-tile-refresh.md).
 * 몸통은 그대로 `PlansView.svelte` 다.
 *
 * 여기 사는 것: **보기**(진행 · 기록 — 창마다 하나, 저장하지 않는다) · **딥링크 한 칸**("이 작업안으로 데려가 달라" — take-once) ·
 * **여는 길** · **보이는가**(검토 카드 · 결과 토스트가 물러날 조건).
 *
 * **창마다 여는 자리가 다르다**:
 * - 주 창 — 채팅 독의 작업안 갈래(`app/chat-dock.svelte.ts` 의 `openChatDockAt("plans")`). 독은 주 창에만 마운트된다.
 * - 보조 창 — 독이 없다. 주 창에 부탁하고(`requestWindow("main", {kind:"plans"})` — 받는 쪽은 `boot.svelte.ts` 의 창 요청 처리)
 *   주 창을 앞으로(`focus_window`) — 워크스페이스 전환 · 프로젝트 위치가 쓰는 같은 패턴.
 * - 원격 창 — 집 PC 레이아웃을 바꾸지 않고 **제 창 안의 덮개**로 본다: 폰 배치면 전체 화면 덮개(`app/mobile-sheets` 의 `plans` ·
 *   `MobilePlans.svelte` — 휴대폰 '뒤로' = 닫기), 데스크톱 폭이면 캔버스를 덮는 판(`app/usage-view` 의 `plans` · `PlansCover.svelte`).
 *   승인은 원격 재확인 규칙 그대로다(새 명령 없음).
 */

import { invoke, isRemote } from "../ipc";
import { requestWindow } from "$lib/workspaces/window-events";
import { chatDockAvailable, chatDockOpen, chatDockSection, closeChatDock, openChatDockAt } from "$lib/app/chat-dock.svelte.js";
import { closeCoverView, openPlansCover, plansCoverOpen } from "$lib/app/usage-view.svelte.js";
import { closeMobileOverlay, mobileOverlay, openMobilePlans } from "$lib/app/mobile-sheets.svelte.js";
import { mobileLayout } from "$lib/app/mobile.svelte.js";

/**
 * 작업안의 **보기** — 진행(`list` — 검토 대기 + 지금·최근 실행 결과) · 기록(`history` — 감사 로그의
 * 장부, 앱을 다시 켜도 남는다 · docs/log/2026-09-28-run-history.md). id `list` 는 그대로 두고 라벨만 "진행" 이다.
 * 비교(타일들의 마지막 명령 결과) · 행렬(호스트 × 작업안)은 2026-10-25 에 걷었다(docs/log/2026-10-25-plans-tile-refresh.md).
 */
export type OpsView = "list" | "history";

/** 지금 보기 — 독을 닫았다 다시 열어도 보던 보기가 남는다(창을 다시 만들면 진행) */
let view = $state<OpsView>("list");

/** 작업안의 지금 보기 */
export function plansView(): OpsView {
  return view;
}

/** 보기를 바꾼다 — 모르는 값(걷은 `compare` · `matrix` 등)은 진행으로 떨어진다 */
export function setPlansView(next: OpsView): void {
  view = next === "history" ? "history" : "list";
}

/** 보조 창이 주 창에 넘기는 부탁 — `at` = 그 작업안 · `history` = 기록의 그 실행 · 아니면 `view` */
export interface PlansAsk {
  at?: string;
  history?: string;
  view?: OpsView;
}

/** 이 창에서 작업안을 그릴 수 있나 — 주 창(채팅 독이 붙어 있다) · 원격 창(제 덮개) */
export function plansOpenableHere(): boolean {
  return isRemote || chatDockAvailable();
}

/** 보조 창 → 주 창: 부탁을 넘기고 주 창을 앞으로 가져온다(실패는 삼킨다 — 주 창이 없으면 할 수 있는 일이 없다) */
export function forwardPlans(ask: PlansAsk): void {
  void requestWindow("main", { kind: "plans", ...ask })
    .then(() => invoke("focus_window", { label: "main" }))
    .catch(() => {});
}

/**
 * 작업안이 **지금 보이는가** — 주 창이면 채팅 독이 열려 있고 작업안 갈래다 · 원격 창이면 제 덮개(폰 · 판)가 떠 있다. 화면 아래 검토 카드
 * (같은 작업안의 승인 단추가 두 벌이 되지 않게)와 실행 결과 토스트(결과가 이미 눈앞이다)가 물러날 조건이다. 보조 창은 늘 거짓.
 */
export function plansShown(): boolean {
  if (isRemote) return plansCoverOpen() || mobileOverlay() === "plans";
  return chatDockAvailable() && chatDockOpen() && chatDockSection() === "plans";
}

/** 작업안을 **연다** — 위 머리말의 "창마다 여는 자리". 보기는 지금 보기 그대로다 */
export function openPlans(): void {
  if (isRemote) {
    if (mobileLayout()) openMobilePlans();
    else openPlansCover();
    return;
  }
  if (chatDockAvailable()) {
    openChatDockAt("plans");
    return;
  }
  forwardPlans({ view });
}

/** 작업안을 닫는다 — 그 창의 자리에 맞게(독 · 덮개) */
function closePlans(): void {
  if (isRemote) {
    if (mobileOverlay() === "plans") closeMobileOverlay();
    if (plansCoverOpen()) closeCoverView();
    return;
  }
  closeChatDock();
}

/** `open-plans` 단축키 · 팔레트 — **토글**이다. 작업안이 보이면 닫고, 아니면 [`openPlans`] */
export function togglePlans(): void {
  if (plansShown()) closePlans();
  else openPlans();
}

// ---------------------------------------------------------------------------
// **딥링크 한 칸** — "이 작업안으로 데려가 달라" (docs/log/2026-09-22-review-card.md).
//
// 검토 대기 카드의 [작업안에서 보기] · 알림 센터의 "승인 대기" · 결과 알림의 [결과 보기]가 쓰는 길이다. 보기는 여기서
// 곧바로 바꾸고, 칸에 남는 것은 **데려갈 작업안** 하나뿐이다 — 그 작업안은 폴링이 채우는 목록 어딘가에 있어서
// `PlansView` 가 목록이 오기를 기다렸다가 스크롤해야 한다. 칸은 **한 번만 꺼내진다**([`takePlansRequest`]) — 남겨 두면
// 다시 열 때마다 옛 요청이 되살아난다(`mcp.rs` 의 우편함과 같은 take-once).
// ---------------------------------------------------------------------------

let spotlightRequest = $state<string | null>(null);

/**
 * 작업안을 열고 **그 작업안으로** 데려간다. 데려갈 카드는 진행 보기에만 있어 보기를 진행으로 돌린다 — 메모리에
 * 그 실행이 없으면(앱을 다시 켠 뒤) `PlansView` 가 첫 폴링 뒤 기록 보기로 넘긴다. 보조 창이면 주 창에 넘긴다.
 */
export function openPlansAt(operationId: string): void {
  if (!plansOpenableHere()) {
    forwardPlans({ at: operationId });
    return;
  }
  view = "list";
  spotlightRequest = operationId;
  openPlans();
}

/** 데려갈 작업안을 **가져간다**(한 번만) — `PlansView.svelte` 가 읽는다. 없으면 `null`. */
export function takePlansRequest(): string | null {
  const r = spotlightRequest;
  spotlightRequest = null;
  return r;
}

/** 남아 있는 요청(읽기만 — 효과가 의존성을 걸 때 쓴다) */
export function plansRequestPending(): string | null {
  return spotlightRequest;
}
