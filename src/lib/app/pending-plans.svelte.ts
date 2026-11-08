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
 * **승인 대기 작업안이 몇 건인가 · 그중 가장 먼저 만료되는 것은 언제인가** — 앱 차원의
 * 상주 모듈 (docs/log/2026-09-21-approval-ttl.md).
 *
 * ## 왜 관제판 밖인가
 *
 * 검토 대기는 **관제판을 열어야만 보였다**. AI 가 작업안을 올리면 그 자리에서 토스트 한 줄이
 * 떴지만(2026-09-22부터 `operation-state` 가 요청 즉시 온다 —
 * docs/log/2026-09-22-review-request-signal.md), 자리를 비운 사이에 뜬 토스트는 아무도 못
 * 본다 — 돌아온 사람은 "뭔가 기다리는 게 있는지" 를 알 길이 없어 관제판을 열어 봐야 했다.
 * 상태바 배지는 그 사실을 **늘 보이는 자리**에 둔다. (그 토스트는 같은 날 저녁에 걷혔다 —
 * 아래 "세 번째" 문단의 카드가 같은 말을 사라지지 않는 자리에서 한다.)
 *
 * 그래서 이 모듈은 `auto-approve.svelte.ts` 와 같은 결이다: **화면이 아니라 앱의 일**이고,
 * `boot()` 이 **메인 창에서만** 한 번 건다(분리 창에는 배지가 없다 — 두 창이 같은 수를
 * 각자 폴링할 이유가 없고, 상태바 배지의 자리는 주 화면이다).
 *
 * ## 권위는 언제나 백엔드다 (`list_operations`)
 *
 * 세는 것은 이벤트가 아니라 **목록**이다. `operation-state` 는 "무언가 바뀌었다" 는 신호로만
 * 쓰고(어떤 상태로 바뀌었는지로 수를 더하고 빼지 않는다), 받으면 목록을 다시 읽는다 —
 * 낙관적 카운터는 이벤트 하나만 놓쳐도 영원히 어긋난 채 남는다
 * (docs/log/2026-09-20-console-fixes.md ②의 교훈 그대로).
 *
 * 세 갈래로 다시 읽는다:
 * 1. **이벤트** — `operation-state` 가 올 때마다(300ms 디바운스: 승인 한 번이 여러 상태
 *    전이를 잇달아 내고, 만료는 한 번에 여러 건이 나간다).
 * 2. **창 포커스** — 다른 일을 하다 돌아온 순간이 배지를 가장 먼저 보는 순간이다.
 * 3. **느린 폴링(30초)** — 이벤트를 놓쳐도(창이 이벤트를 걸기 전에 끝난 전이 등) 배지가
 *    낡은 채 남지 않게 하는 그물. **2초 폴링은 여기 없다** — 관제판이 열려 있는 동안은
 *    그쪽이 자기 폴링을 돌린다.
 *
 * ## 같은 박자가 **지금 도는 것**도 먹인다 — 대시보드 칸의 배지 (2026-10-05)
 *
 * 2026-09-21 의 상태바 후미 `▶ 실행 중 N` 은 같은 날 지웠고(docs/log/2026-10-05-statusbar-trim.md),
 * 그 수가 **대시보드 칸의 배지 · 호버 카드**로 돌아왔다(docs/log/2026-10-05-dashboard-badge.md).
 * 대시보드가 닫혀 있어도 맞아야 하므로 대시보드의 2초 폴링에 기대지 않는다. 폴링을 새로 내지 않고
 * 같은 `refresh()` 한 번이 두 목록을 함께 읽는다 — 도는 작업안([`runningPlans`] · 같은 `list_operations`)과
 * 열린 헤드리스 위임 접속([`openHeadless`] · `list_console_sessions`). 헤드리스 접속은 작업안 실행이
 * 띄우므로(`operations/target.rs`) 여는 순간은 `operation-state` 가 데려오고, 떨어진 것은 포커스 · 30초
 * 그물이 잡는다. 카드가 뜰 때 한 번 더 읽는다([`peekRunning`]).
 *
 * ## 같은 목록이 세 번째로 **화면 위 대기 카드**를 먹인다 (2026-09-22)
 *
 * 토스트는 6초 뒤 사라지고 상태바 배지는 작다 — 자리를 비운 사이 올라온 검토 요청은 여전히
 * 놓치기 쉬웠다. 그래서 대기가 남아 있는 동안 화면에 머무는 카드 한 장을 더했고
 * (`$lib/ReviewCard.svelte` · docs/log/2026-09-22-review-card.md), 그 카드가 읽는 것이
 * [`pendingPlans`] 다. **폴링을 하나 더 내지 않는다** — 세는 수와 보여 줄 목록의 출처가 같은
 * 한 번의 `list_operations` 라야 둘이 어긋날 자리가 없고, 위의 세 갈래(이벤트·포커스·30초
 * 그물)면 충분하다(2026-09-22부터 `operation-state` 가 요청 그 자리에서 온다).
 *
 * ## 같은 목록이 네 번째로 **OS 알림**을 먹인다 (2026-09-22)
 *
 * 카드도 배지도 **이 창을 보고 있는 사람**에게만 닿는다. 다른 창에서 일하는 사이에 올라온
 * 요청은 돌아올 때까지 아무도 모르고, 그동안 만료(기본 30분)가 지나갈 수 있다. 그래서 갱신
 * 한 번이 끝날 때마다 "이번에 **새로** 들어온 대기가 있는가" 를 묻고, 창이 앞에 없으면 OS
 * 알림 한 줄을 쏜다 (판정은 순수 함수 [`planNotification`] · 발사는 `app/os-notify.ts` ·
 * docs/log/2026-09-22-review-notify.md). **여기서도 폴링을 하나 더 내지 않았다.**
 */

/** 검토 대기(awaitingApproval) 작업안 수 */
let pending = $state(0);

/**
 * 검토 대기 목록 그대로 — **오래된 것부터**(= 먼저 만료될 것부터). 화면 위 대기 카드가 읽는다.
 *
 * 수([`pending`])와 따로 세지 않고 같은 `refresh()` 한 번이 둘을 함께 채운다 — 배지의 숫자와
 * 카드가 가리키는 작업안이 서로 다른 시점을 말하면 "3건이라면서 카드는 왜 저것인가" 가 된다.
 */
let pendingList = $state<Operation[]>([]);

/** 지금 도는(승인됨 · 실행 중) 작업안 — 대시보드 칸의 배지 · 카드 (`isRunningPlan`) */
let runningList = $state<Operation[]>([]);

/** 열린 헤드리스 위임 접속 — 대시보드 칸의 배지 · 카드 (`isOpenHeadless`) */
let headlessList = $state<ConsoleSession[]>([]);

/** 가장 먼저 만료되는 대기의 만료 시각(epoch ms). 만료 없음뿐이거나 대기가 없으면 `null` */
let earliest = $state<number | null>(null);

/**
 * **자동 승인이 거부당한 사유** — `작업안 id → 백엔드가 돌려준 한 줄`.
 *
 * ## 왜 여기인가
 *
 * 쓰는 쪽은 `app/auto-approve.svelte.ts`(권위 게이트가 거부하면 사유를 받는다), 읽는 쪽은
 * 화면 위 검토 대기 카드다. 카드가 읽는 목록이 이미 이 모듈에 있으므로 **세 번째 주인을
 * 만들지 않으려고** 같은 자리에 둔다 — 둘 다 메인 창에서만 도는 앱 차원 모듈이고, 대기
 * 목록과 사유가 다른 모듈에 갈라져 있으면 "목록에서 사라진 id 의 사유" 를 누가 지울지가
 * 애매해진다(여기 있으면 [`refresh`] 한 번이 둘을 같은 시점으로 맞춘다).
 *
 * 이 한 줄이 토스트가 아니라 카드에 사는 이유: 사유는 "방금 일어난 일" 이 아니라 **사람이
 * 왜 직접 승인해야 하는가**라서, 그 작업안이 대기에 남아 있는 내내 곁에 있어야 한다
 * (docs/log/2026-09-22-review-card.md 의 "토스트 둘을 카드로 접었다").
 *
 * `$state` 한 칸이고 **쓸 때마다 새 `Map` 으로 갈아 끼운다** — 평범한 `Map` 은 룬이 감싸지
 * 않아 `set`·`delete` 만으로는 카드가 다시 그려지지 않는다(대개 한두 칸짜리라 값싸다).
 */
let refusals = $state<Map<string, string>>(new Map());

/**
 * 자동 승인이 거부당했다고 적어 둔다 — 세션 서버의 거부 이벤트(`operation-auto-refused` — `auto-approve`)와 목록의
 * `autoRefusals`([`refresh`])가 쓰는 자리.
 *
 * 서버가 한 작업안을 한 번만 시도하므로(`attempted`) 같은 id 의 사유가 바뀔 일은 드물다.
 * 지우는 자리도 따로 없다 — 그 id 가 대기 목록을 떠나면 [`refresh`] 가 함께 걷는다.
 */
export function noteAutoRefusal(id: string, reason: string): void {
  const next = new Map(refusals);
  next.set(id, reason);
  refusals = next;
}

/**
 * 시도 **전에** 걸러진 이유(서버 `autoWhy` — 자동 승인 꺼짐 · 정책 밖 · 대상 수 상한) — `작업안 id → 문구`. 10-22: 이것이 없어서
 * 호스트를 '자동 승인 실행' 으로 두고도 전체 스위치가 꺼진 카드 · 파이프가 든 카드가 아무 이유도 말하지 못했다(훑기는 정책 밖을
 * 시도하지 않으므로 거부 사유가 생기지 않는다). [`refresh`] 가 목록과 같은 시점으로 갈아 끼운다.
 */
let whyTexts = $state<Map<string, string>>(new Map());

/** 묶음 id → 화면 이름(설정 › 자동 승인 시험 칸과 같은 규칙) */
function bundleName(id: string): string {
  const b = bundleById(id);
  if (!b) return id;
  const k = `settings.automation.bundle.${b.id}.name`;
  const s = t(k as Key);
  return s === k ? b.name : s;
}

/** 서버의 이유 하나 → 문구(시험 칸의 `reasonText` 그대로) */
function whyText(r: AutoApprovalReason): string {
  return reasonText(r, (k, a) => t(k as Key, a), bundleName);
}

/**
 * 지금 살아 있는 "자동 승인 안 됨" 사유들 — 시도 뒤의 거부(`refusals`)가 먼저, 없으면 시도 전에 걸러진 이유(`whyTexts`).
 * 화면 위 대기 카드(`reviewCardModel`)와 작업안 카드(`AnalysisChips`)가 읽는다.
 */
export function autoRefusals(): ReadonlyMap<string, string> {
  if (whyTexts.size === 0) return refusals;
  const merged = new Map(whyTexts);
  for (const [id, r] of refusals) merged.set(id, r);
  return merged;
}

/** 승인을 기다리는 작업안 수 — 상태바 배지가 읽는다(0 이면 배지가 없다) */
export function pendingCount(): number {
  return pending;
}

/**
 * 승인을 기다리는 작업안 **목록** — 화면 위 대기 카드(`ReviewCard.svelte`)가 읽는다.
 * 오래된 것부터라 `[0]` 이 가장 먼저 만료될 하나다(백엔드 `list_operations` 의 순서 그대로).
 */
export function pendingPlans(): Operation[] {
  return pendingList;
}

/**
 * 목록을 **지금 당장** 다시 읽는다 — 카드의 [거절]처럼 화면이 스스로 상태를 바꾼 직후에.
 *
 * `reject_operation` 은 거절한 그 작업안에 대해 `operation-state` 를 내보내지 않는다
 * (`src-tauri/src/operations.rs` — 그 명령이 emit 하는 것은 함께 쓸려 만료된 것들뿐이다).
 * 그래서 이벤트만 기다리면 카드가 다음 건으로 넘어가는 데 최대 30초가 걸린다.
 */
export async function refreshPendingPlans(): Promise<void> {
  await refresh();
}

/**
 * 가장 먼저 만료되는 대기의 만료 시각(epoch ms) — 없으면 `null`.
 * (만료 시각이 없는 대기만 있으면 `null` 이다 — "만료 없음")
 */
export function nextExpiry(): number | null {
  return earliest;
}

/** 지금 도는 작업안 — 대시보드 칸의 배지가 읽는다(메인 창에서만 찬다) */
export function runningPlans(): Operation[] {
  return runningList;
}

/** 열린 헤드리스 위임 접속 — 대시보드 칸의 배지가 읽는다(메인 창에서만 찬다) */
export function openHeadless(): ConsoleSession[] {
  return headlessList;
}

/**
 * 대시보드 칸의 호버 카드가 뜰 때 — 30초 그물을 기다리지 않고 한 번 읽는다. 훅이 걸린 창(메인)에서만
 * 돈다(분리 창에서 부르면 아무 일도 없다 — 그 창은 이 목록을 갖지 않는다).
 */
export function peekRunning(): void {
  if (started) scheduleRefresh();
}

/** 이벤트 폭주를 한 번으로 묶는 창 — 승인 하나가 여러 전이를 잇달아 낸다 */
const DEBOUNCE_MS = 300;

/** 놓친 이벤트의 그물 — 관제판의 2초 폴링과 달리 **늘** 도는 값이라 느리게 잡는다 */
const FALLBACK_POLL_MS = 30_000;

/** 두 번 걸리지 않게 하는 빗장 (개발 서버의 재실행·중복 호출 방어) */
let started = false;

/**
 * **이미 본 대기 작업안 id 들** — OS 알림이 같은 요청을 갱신마다 다시 쏘지 않게 하는 기억.
 *
 * 매 갱신마다 **지금 대기 중인 id 로 다시 지어진다**(`planNotification` 이 좁힌 집합을
 * 그대로 받는다) — 앱이 며칠 켜져 있어도 자라지 않는다.
 */
let notifiedIds: ReadonlySet<string> = new Set();

/**
 * 첫 갱신을 지났는가 — **부팅 때 이미 기다리던 작업안으로는 알리지 않는다**.
 *
 * 그것들은 카드와 배지가 이미 보여 준다. 그런데도 알림을 쏘면 앱을 켤 때마다 밀린 알림이
 * 쏟아진다. 그래서 첫 갱신은 위 집합을 **채우기만** 한다.
 */
let seeded = false;

/** 디바운스 타이머 — 이벤트가 몰아치면 마지막 하나만 산다 */
let debounce: ReturnType<typeof setTimeout> | null = null;

/** 목록을 한 번 읽어 두 값을 갱신한다. 실패해도 조용하다(`listOperations` 가 빈 목록을 준다). */
async function refresh(): Promise<void> {
  const [list, sessions] = await Promise.all([listOperations(), listConsoleSessions()]);
  // **곧 자동 승인될 것은 사람을 기다리는 대기가 아니다**(10-22) — 서버가 `autoPending` 으로 알린다(다음 훑기가 시도할 것과 같은 집합).
  // 카드 · 배지 · OS 알림 · 메신저 모두 그것을 빼고 본다: 안 그러면 승인되기까지의 순간에 카드가 번쩍였다 사라진다(결과 토스트는
  // `operation-notify` 가 그대로 낸다). 훑기가 거부하면 서버가 이 목록에서 빼므로 다음 갱신(`operation-auto-refused` 가 곧바로 부른다)에
  // 카드가 선다 — 영구히 숨는 대기는 없다.
  const autoPending = new Set(list.autoPending ?? []);
  const waiting = list.pending.filter((op) => !autoPending.has(op.operationId));
  pending = waiting.length;
  // 도는 것은 **두 칸을 함께** 훑는다 — 승인된 작업안은 `pending` 에서 빠져 `recent` 로 넘어가지만,
  // 백엔드가 어느 칸에 담아 주는지에 이 수가 기대면 안 된다(상태가 권위다).
  runningList = [...list.pending, ...list.recent].filter(isRunningPlan);
  headlessList = sessions.filter(isOpenHeadless);
  pendingList = waiting;
  const times = waiting
    .map((op) => op.expiresAt)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  earliest = times.length > 0 ? Math.min(...times) : null;

  // 네 번째 손님 — 새로 들어온 대기가 있으면 OS 알림 한 줄. 설정이 꺼져 있거나 창이 앞에
  // 있으면 쏘지 않지만 **본 집합은 그래도 따라간다**(안 그러면 설정을 켜거나 창에서 눈을 떼는
  // 순간 그동안 쌓인 대기가 한꺼번에 "새것" 이 되어 쏟아진다 — 판정은 `planNotification`).
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
  // 다섯 번째 손님 — 메신저 승인 대기(승인 요약). 새로 들어온 것만(부팅 때 이미 기다리던 것은 아니다 — 위와 같은 `seeded` 규칙).
  // 보낼지 · 무엇을 적을지는 `messengerOperationPending` 과 Rust 가 정한다(자동 승인된 것은 거기서 걸러진다).
  if (seeded) {
    for (const op of waiting) if (!notifiedIds.has(op.operationId)) messengerOperationPending(op.operationId);
  }
  notifiedIds = nextSeen;
  seeded = true;
  // 자동 승인 거부 사유도 **같은 자리에서** 좁힌다 — 승인·거절·만료로 목록을 떠난 작업안의
  // 사유를 들고 있을 이유가 없고(카드가 그 id 를 다시 그릴 일이 없다), 앱이 며칠 켜져 있으면
  // 그 표만 끝없이 자란다. 본 id 집합(`nextSeen`)과 같은 규칙이다.
  // 서버가 쥔 거부 사유(③-4 — 자동 승인은 세션 서버가 돈다)를 먼저 합친다 — GUI 가 없던 동안 거부된 것도 카드가 보인다.
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
  // 권한이 거절돼 있으면 **아무 일도 안 한다** — `finish-notify` 와 달리 토스트로 되돌아가지
  // 않는다. 창이 앞에 없어서 쏘는 알림이라 그 토스트는 아무도 못 보고, 돌아왔을 때 사람이
  // 볼 것(대기 카드·상태바 배지)은 이미 화면에 서 있다. 한 사실의 세 번째 반복일 뿐이다.
  if (notice !== null) void notifyOs(notice.title, notice.body);
}

/** 디바운스된 갱신 — 이벤트 경로가 부른다 */
function scheduleRefresh(): void {
  if (debounce !== null) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void refresh();
  }, DEBOUNCE_MS);
}

/**
 * 훅을 건다 — **부팅에서 딱 한 번**, 메인 창에서만(`boot()` 이 `isMainWindow` 로 가른다).
 *
 * 걸린 뒤에는 앱이 사는 동안 산다 — 걷을 자리가 없다(메인 창은 닫히면 프로세스가 끝난다).
 * 그래서 반환값도, 정리 함수도 없다: `startAutoApprove` 와 같은 모양이다.
 */
export function startPendingPlans(): void {
  if (started) return;
  started = true;
  void refresh();
  // 상태가 바뀌었다는 신호 — **무엇으로 바뀌었는지는 보지 않는다**(목록이 권위다).
  void listen("operation-state", () => scheduleRefresh());
  // 돌아온 순간 = 배지를 처음 보는 순간.
  window.addEventListener("focus", () => scheduleRefresh());
  setInterval(() => void refresh(), FALLBACK_POLL_MS);
}
