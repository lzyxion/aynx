/**
 * **오케스트레이션 감독 사건의 창 알림**(리뷰 F11 · 설계 C-7 "알림 — 서버가 낸다", 2026-10-15 결정 ①).
 *
 * 사건(작업자 권한 대기 · 첫 화면 · 멈춤 · 복구 필요 · 비정상 종료 · 한도 · 조정자 종료 · Run 끝)은 **세션 서버가 사건 id 와 함께** 만든다
 * (`orchestration::notice`). 창이 하나도 없으면 서버가 메신저(켰으면)로 보내고 미확인 큐에 둔다. 여기는 **주 창 한 곳**이:
 * - 이벤트 `orchestration-notice` 로 온 사건을 한 번 알리고(토스트 + 알림 센터 한 줄) 서버에 확인한다(`orchestration_notices_ack`).
 * - 뜰 때(창이 없던 동안 쌓인) 미확인 사건을 꺼내(`orchestration_notices`) 알리고 확인한다.
 * - 뜰 때 **확인된 최근 사건**(`orchestration_notices{recent: true}` — 서버 메모리)을 알림 센터에만 그때 시각 · 읽음으로 다시 적는다(토스트 없음).
 *   알림 센터는 페이지 메모리라 F5 · 웹뷰 재부착이 지난 줄을 지우고, 사건은 보인 순간 확인돼 미확인 목록에도 없다 — 실기 b 에서 F5 뒤 주 창이
 *   "지난 알림이 없습니다" 였다(듣기는 F5 마다 새 페이지가 다시 건다 — 모듈 상태 `started` 도 새로 시작한다).
 *
 * 같은 사건 id 는 한 번만(이벤트와 꺼내기가 겹쳐도 · 보드가 여럿이어도 — 보드는 따로 알리지 않는다).
 */

import { invoke, listen } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { recordNotification, recordPastNotification } from "$lib/app/notifications.svelte.js";
import { openOrchNotice } from "$lib/app/orchestration.svelte.js";
import { NOTICE_EVENT, noticeText, noticeUrgent, type OrchNotice } from "$lib/orchestration/model";

/** 이 창이 이미 보인 사건 id */
const seen = new Set<string>();
let started = false;

function isNotice(v: unknown): v is OrchNotice {
  const n = v as OrchNotice | null;
  return !!n && typeof n.id === "string" && typeof n.runId === "string" && typeof n.kind === "string";
}

/** 사건 하나를 알린다(이미 본 것이면 아무것도 안 한다) — 알렸으면 `true` */
function show(n: OrchNotice, toastIt: boolean): boolean {
  if (seen.has(n.id)) return false;
  seen.add(n.id);
  const text = noticeText(n, t);
  recordNotification({ kind: "orchestration", text, level: "info" });
  if (toastIt) {
    // 작업자 사건은 그 시도를 보는 트랙으로, 앨범 사건은 앨범으로 간다.
    const action = { label: t("orch.notice.open"), run: () => void openOrchNotice(n) };
    toast.info(text, { ms: noticeUrgent(n.kind) ? 12000 : 6000, action });
  }
  return true;
}

async function ack(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await invoke("orchestration_notices_ack", { ids });
  } catch {
    /* 서버가 없다 — 다음 꺼내기 때 seen 이 걸러 낸다 */
  }
}

/** 미확인 사건을 꺼내 알린다 — 여럿이면 토스트는 한 줄(창이 없던 동안 N건) */
async function drain(): Promise<void> {
  let list: unknown = [];
  try {
    list = await invoke("orchestration_notices");
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  const fresh = list.filter(isNotice).filter((n) => !seen.has(n.id));
  const many = fresh.length > 1;
  for (const n of fresh) show(n, !many);
  if (many) {
    const last = fresh.filter((n) => n.runId).pop() ?? fresh[fresh.length - 1];
    toast.info(t("orch.notice.whileAway", { n: fresh.length }), {
      ms: 12000,
      action: { label: t("orch.notice.open"), run: () => void openOrchNotice(last) },
    });
  }
  await ack(list.filter(isNotice).map((n) => n.id));
}

/** 확인된 최근 사건을 알림 센터에 다시 적는다(토스트 없음 · 읽음 · 그때 시각 순 자리). 미확인 꺼내기(`drain` — 확인까지) **뒤에** 부른다: 방금 꺼낸
 * 것은 `seen` 이 거른다 */
async function restoreRecent(): Promise<void> {
  let list: unknown = [];
  try {
    list = await invoke("orchestration_notices", { recent: true });
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  for (const n of list.filter(isNotice)) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    recordPastNotification({ kind: "orchestration", text: noticeText(n, t), level: "info" }, typeof n.at === "number" ? n.at : Date.now());
  }
}

/** 주 창에서 한 번(부팅) — 이벤트를 먼저 걸고 미확인 사건을 꺼낸 뒤 확인된 최근 사건을 알림 센터에 되살린다 */
export function startOrchestrationNotify(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen<unknown>(NOTICE_EVENT, (ev) => {
    if (!isNotice(ev.payload)) return;
    if (show(ev.payload, true)) void ack([ev.payload.id]);
  }).catch(() => {});
  void drain().then(restoreRecent);
}
