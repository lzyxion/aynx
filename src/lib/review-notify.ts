/** 승인 대기 작업안이 새로 왔다고 OS 알림을 쏠 것인가 — 창이 앞에 없을 때만 (docs/log/2026-09-22-review-notify.md). */

import type { Tr } from "$lib/finish-notify";
import type { Operation } from "$lib/operations";
import { headlineOf } from "$lib/review-card";

export interface PlanNotifyOptions {
  /** `[automation] notify_review_requests` — 꺼져 있어도 집합은 따라간다 */
  enabled: boolean;
  focused: boolean;
  /** `false` 면 집합만 채운다 — 부팅 때 이미 기다리던 작업안으로 쏘면 켤 때마다 밀린 알림이 쏟아진다 */
  seeded: boolean;
  title: string;
}

export interface PlanNotice {
  title: string;
  body: string;
}

export interface PlanNotifyResult {
  nextSeen: Set<string>;
  notice: PlanNotice | null;
}

/**
 * 대기 목록은 몇 초마다 통째로 다시 읽히므로 본 id 집합에 없는 것만 새것이다. 여러 건이면 알림은 한 장이다.
 * `nextSeen` 은 꺼졌든 창을 보고 있었든 언제나 지금 대기 전부다 — 아니면 켜거나 눈을 떼는 순간 쌓인 대기가 한꺼번에 쏟아진다.
 */
export function planNotification(
  prevSeen: ReadonlySet<string>,
  pending: readonly Operation[],
  opts: PlanNotifyOptions,
  tr: Tr,
): PlanNotifyResult {
  const nextSeen = new Set(pending.map((op) => op.operationId));

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
