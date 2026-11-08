/**
 * **승인 대기 작업안이 새로 왔다고 OS 알림을 쏠 것인가** — 순수 계산 하나
 * (docs/log/2026-09-22-review-notify.md · docs/internal/next.md 의 "검토 요청 가시성" ④).
 *
 * 화면 위 대기 카드는 **이 창을 보고 있는 사람**에게만 닿는다. 다른 창에서 일하거나 앱을
 * 최소화해 둔 사이에 올라온 요청은 돌아올 때까지 아무도 모르고, 만료(기본 30분)가 그 사이에
 * 지나갈 수 있다. 그래서 창이 앞에 없을 때만 OS 알림 한 줄을 더한다.
 *
 * ## 무엇이 "새로" 인가 — 본 id 의 집합
 *
 * 대기 목록은 몇 초마다 통째로 다시 읽힌다(`app/pending-plans.svelte.ts`). 그 목록을 그냥
 * 보면 **같은 요청이 갱신마다 새 요청으로 보인다.** 그래서 이미 본 `operationId` 들을 쥐고
 * 있다가 **거기 없는 id** 만 새것으로 친다.
 *
 * 집합은 **지금 대기 중인 id 로 매번 좁힌다**(`nextSeen = 지금 대기 전부`). 승인·거절·만료로
 * 목록을 떠난 id 를 계속 들고 있을 이유가 없고, 앱이 며칠 켜져 있으면 그 집합만 끝없이 자란다.
 * 떠난 id 가 되돌아오는 일은 없다 — 작업안은 `awaitingApproval` 을 한 번만 지난다.
 *
 * ## 부팅의 첫 갱신은 **씨앗만 뿌린다**
 *
 * 앱을 켰을 때 이미 기다리고 있던 작업안은 카드와 배지가 이미 보여 준다. 그것들로 알림을
 * 쏘면 "켤 때마다 밀린 알림이 쏟아지는" 앱이 된다. 그래서 첫 갱신은 집합을 채우기만 하고
 * (`seeded: false`) 아무것도 쏘지 않는다.
 *
 * ## 룬도 DOM 도 Tauri 도 없다
 *
 * 값을 받아 값을 준다 — 실제로 쏘는 쪽은 `app/os-notify.ts` 다. 문구도 만들지 않고 **`tr` 로
 * 받는다**(`finish-notify.ts` 와 같은 나눔: 사전을 몰라도 vitest 가 그대로 돈다).
 */

import type { Tr } from "$lib/finish-notify";
import type { Operation } from "$lib/operations";
import { headlineOf } from "$lib/review-card";

/** [`planNotification`] 이 보는 **바깥 사실** 넷 */
export interface PlanNotifyOptions {
  /** `[automation] notify_review_requests` — 꺼져 있으면 쏘지 않는다(집합은 그래도 따라간다) */
  enabled: boolean;
  /** 이 창이 지금 사람 앞에 있는가 (`app/os-notify` 의 `windowFocused()`) */
  focused: boolean;
  /**
   * **첫 갱신을 이미 지났는가.** `false` 면 집합만 채우고 아무것도 쏘지 않는다 — 부팅 때
   * 이미 기다리던 작업안으로 알림을 쏘면 켤 때마다 밀린 알림이 쏟아진다(머리말 참고).
   */
  seeded: boolean;
  /** 알림 제목 — `app/os-notify` 의 `APP`("aynx"). 글자를 두 벌 두지 않으려고 받는다. */
  title: string;
}

/** 쏠 알림 한 장 */
export interface PlanNotice {
  title: string;
  body: string;
}

/** [`planNotification`] 이 주는 것 — 다음 집합과 (있다면) 알림 한 장 */
export interface PlanNotifyResult {
  /** 다음 갱신에 넘길 "이미 본" id 들 — **지금 대기 중인 것으로 좁혀져 있다** */
  nextSeen: Set<string>;
  /** 쏠 것이 없으면 `null` */
  notice: PlanNotice | null;
}

/**
 * 대기 목록 한 벌 → (다음 집합, 쏠 알림) — **순수 함수** (테스트: `review-notify.test.ts`).
 *
 * `pending` 은 `list_operations` 의 `pending` 그대로다 — 백엔드가 `awaitingApproval` 인
 * 것만, 오래된 것부터 담아 준다(그래서 상태를 다시 걸러 보지 않는다).
 *
 * 한 갱신에 여러 건이 새로 들어왔으면 **알림은 한 장**이다: 대상 수를 세어 `승인 대기 N건`
 * 으로 줄인다. 요청 하나에 알림 하나를 쏘면 AI 가 한 번에 세 건을 올린 순간 알림 센터가
 * 같은 앱으로 도배된다.
 *
 * `nextSeen` 은 **언제나** 지금 대기 전부다 — 껐든(`enabled:false`) 창을 보고 있었든
 * (`focused:true`) 이번에 본 id 는 본 것으로 친다. 그러지 않으면 설정을 켜거나 창에서
 * 눈을 떼는 순간 그동안 쌓인 대기가 한꺼번에 "새것" 이 되어 쏟아진다.
 */
export function planNotification(
  prevSeen: ReadonlySet<string>,
  pending: readonly Operation[],
  opts: PlanNotifyOptions,
  tr: Tr,
): PlanNotifyResult {
  // 본 집합은 **지금 대기 중인 id 로 다시 짓는다** — 떠난 id 를 들고 있지 않는다(머리말).
  const nextSeen = new Set(pending.map((op) => op.operationId));

  // 첫 갱신 = 씨앗. 부팅 때 이미 기다리던 것은 카드·배지가 보여 준다.
  if (!opts.seeded) return { nextSeen, notice: null };

  const fresh = pending.filter((op) => !prevSeen.has(op.operationId));
  if (fresh.length === 0 || !opts.enabled || opts.focused) return { nextSeen, notice: null };

  const body =
    fresh.length === 1
      ? tr("app.review.notify.one", {
          headline: headlineOf(fresh[0]),
          n: fresh[0].targets.length,
        })
      : tr("app.review.notify.many", { n: fresh.length });

  return { nextSeen, notice: { title: opts.title, body } };
}
