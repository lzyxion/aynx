import { listen } from "../ipc";
import { listOperations, type Operation } from "$lib/operations";
import { listConsoleSessions } from "$lib/console/sessions";
import type { ConsoleSession } from "$lib/console/delegation-rows";
import { isOpenHeadless, isRunningPlan } from "$lib/running-now";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { planNotification } from "$lib/review-notify";
import { messengerOperationPending } from "$lib/app/messenger";
import { reasonText, type AutoApprovalReason } from "$lib/settings/model/auto-approval-test";
import { bundleById } from "$lib/automation-presets";
import type { Key } from "$lib/i18n/keys";
import { settings } from "$lib/settings.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 승인 대기 작업안 — 메인 창에서만 한 번 건다(docs/log/2026-09-21-approval-ttl.md).
 * 세는 것은 이벤트가 아니라 `list_operations` 목록이다 — `operation-state` 는 "바뀌었다" 신호로만 쓴다.
 * 낙관적 카운터는 이벤트 하나만 놓쳐도 영원히 어긋난다. 배지 · 카드 · OS 알림 · 메신저가 같은 한 번의 읽기를 본다 — 폴링을 따로 내지 않는다.
 */

let pending = $state(0);

/** 오래된 것부터(= 먼저 만료될 것부터) — 수와 같은 `refresh()` 한 번이 채워야 배지와 카드가 어긋나지 않는다 */
let pendingList = $state<Operation[]>([]);

let runningList = $state<Operation[]>([]);

let headlessList = $state<ConsoleSession[]>([]);

/** epoch ms. 만료 없음뿐이거나 대기가 없으면 `null` */
let earliest = $state<number | null>(null);

/** 쓸 때마다 새 `Map` 으로 갈아 끼운다 — 평범한 `Map` 의 `set` · `delete` 만으로는 카드가 다시 그려지지 않는다 */
let refusals = $state<Map<string, string>>(new Map());

/** 지우는 자리는 따로 없다 — 그 id 가 대기 목록을 떠나면 [`refresh`] 가 함께 걷는다 */
export function noteAutoRefusal(id: string, reason: string): void {
  const next = new Map(refusals);
  next.set(id, reason);
  refusals = next;
}

/** 시도 전에 걸러진 이유(서버 `autoWhy`) — 훑기는 정책 밖을 시도하지 않아 거부 사유가 생기지 않으므로 따로 든다 */
let whyTexts = $state<Map<string, string>>(new Map());

function bundleName(id: string): string {
  const b = bundleById(id);
  if (!b) return id;
  const k = `settings.automation.bundle.${b.id}.name`;
  const s = t(k as Key);
  return s === k ? b.name : s;
}

function whyText(r: AutoApprovalReason): string {
  return reasonText(r, (k, a) => t(k as Key, a), bundleName);
}

/** 시도 뒤의 거부(`refusals`)가 시도 전 이유(`whyTexts`)보다 앞선다 */
export function autoRefusals(): ReadonlyMap<string, string> {
  if (whyTexts.size === 0) return refusals;
  const merged = new Map(whyTexts);
  for (const [id, r] of refusals) merged.set(id, r);
  return merged;
}

export function pendingCount(): number {
  return pending;
}

export function pendingPlans(): Operation[] {
  return pendingList;
}

/** `reject_operation` 은 거절한 그 작업안의 `operation-state` 를 내보내지 않는다 — 화면이 바꾼 직후 이것을 부른다 */
export async function refreshPendingPlans(): Promise<void> {
  await refresh();
}

export function nextExpiry(): number | null {
  return earliest;
}

/** 메인 창에서만 찬다 */
export function runningPlans(): Operation[] {
  return runningList;
}

/** 메인 창에서만 찬다 */
export function openHeadless(): ConsoleSession[] {
  return headlessList;
}

export function peekRunning(): void {
  if (started) scheduleRefresh();
}

const DEBOUNCE_MS = 300;

const FALLBACK_POLL_MS = 30_000;

let started = false;

/** 매 갱신마다 지금 대기 중인 id 로 다시 지어진다 — 자라지 않는다 */
let notifiedIds: ReadonlySet<string> = new Set();

/** 첫 갱신은 위 집합을 채우기만 한다 — 부팅 때 이미 기다리던 것으로 알림을 쏟지 않게 */
let seeded = false;

let debounce: ReturnType<typeof setTimeout> | null = null;

async function refresh(): Promise<void> {
  const [list, sessions] = await Promise.all([listOperations(), listConsoleSessions()]);
  // 곧 자동 승인될 것(`autoPending`)은 빼고 본다 — 안 그러면 카드가 번쩍였다 사라진다. 훑기가 거부하면 서버가 이 목록에서 빼므로 영구히 숨는 대기는 없다.
  const autoPending = new Set(list.autoPending ?? []);
  const waiting = list.pending.filter((op) => !autoPending.has(op.operationId));
  pending = waiting.length;
  // 두 칸을 함께 훑는다 — 백엔드가 어느 칸에 담아 주는지에 기대면 안 된다(상태가 권위다)
  runningList = [...list.pending, ...list.recent].filter(isRunningPlan);
  headlessList = sessions.filter(isOpenHeadless);
  pendingList = waiting;
  const times = waiting
    .map((op) => op.expiresAt)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  earliest = times.length > 0 ? Math.min(...times) : null;

  // 쏘지 않을 때도 본 집합은 따라간다 — 안 그러면 설정을 켜거나 창에서 눈을 떼는 순간 쌓인 대기가 한꺼번에 쏟아진다
  const { nextSeen, notice } = planNotification(
    notifiedIds,
    waiting,
    {
      enabled: settings.current.automation.notify_review_requests,
      focused: windowFocused(),
      seeded,
      title: APP,
    },
    t,
  );
  if (seeded) {
    for (const op of waiting) if (!notifiedIds.has(op.operationId)) messengerOperationPending(op.operationId);
  }
  notifiedIds = nextSeen;
  seeded = true;
  // 사유도 본 id 집합(`nextSeen`)으로 좁힌다 — 안 그러면 표가 끝없이 자란다
  whyTexts = new Map(
    Object.entries(list.autoWhy ?? {})
      .filter(([id]) => nextSeen.has(id))
      .map(([id, r]) => [id, whyText(r)] as [string, string]),
  );
  const fromServer = Object.entries(list.autoRefusals ?? {}).filter(([id, r]) => refusals.get(id) !== r);
  if (fromServer.length > 0) refusals = new Map([...refusals, ...fromServer]);
  if (refusals.size > 0) {
    const kept = new Map([...refusals].filter(([id]) => nextSeen.has(id)));
    if (kept.size !== refusals.size) refusals = kept;
  }
  // OS 알림 권한이 거절돼도 토스트로 되돌아가지 않는다 — 창이 앞에 없어 아무도 못 보고, 카드 · 배지가 이미 서 있다
  if (notice !== null) void notifyOs(notice.title, notice.body);
}

function scheduleRefresh(): void {
  if (debounce !== null) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void refresh();
  }, DEBOUNCE_MS);
}

/** 메인 창에서만 한 번 — 정리 함수가 없다(걸린 뒤 앱이 사는 동안 산다) */
export function startPendingPlans(): void {
  if (started) return;
  started = true;
  void refresh();
  void listen("operation-state", () => scheduleRefresh());
  window.addEventListener("focus", () => scheduleRefresh());
  setInterval(() => void refresh(), FALLBACK_POLL_MS);
}
