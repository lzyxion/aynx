/**
 * 주 창 한 곳이 알리고 서버에 확인한다 — 같은 사건 id 는 한 번만(이벤트와 꺼내기가 겹쳐도 · 보드는 따로 알리지 않는다).
 * 확인된 최근 사건을 알림 센터에 다시 적는다 — 알림 센터는 페이지 메모리라 F5 · 웹뷰 재부착이 지난 줄을 지운다.
 */

import { invoke, listen } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { recordNotification, recordPastNotification } from "$lib/app/notifications.svelte.js";
import { openOrchNotice } from "$lib/app/orchestration.svelte.js";
import { NOTICE_EVENT, noticeText, noticeUrgent, type OrchNotice } from "$lib/orchestration/model";
import { messengerOrchNotice } from "$lib/app/messenger";

const seen = new Set<string>();
let started = false;

function isNotice(v: unknown): v is OrchNotice {
  const n = v as OrchNotice | null;
  return !!n && typeof n.id === "string" && typeof n.runId === "string" && typeof n.kind === "string";
}

function show(n: OrchNotice, toastIt: boolean): boolean {
  if (seen.has(n.id)) return false;
  seen.add(n.id);
  const text = noticeText(n, t);
  recordNotification({ kind: "orchestration", text, level: "info" });
  if (toastIt) {
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

/** 미확인 꺼내기(`drain`) 뒤에 부른다 — 방금 꺼낸 것은 `seen` 이 거른다 */
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

/** 이벤트를 먼저 걸고 꺼낸다 */
export function startOrchestrationNotify(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen<unknown>(NOTICE_EVENT, (ev) => {
    if (!isNotice(ev.payload)) return;
    if (show(ev.payload, true)) {
      // 세션 서버는 붙은 창이 있으면 보내지 않는다 — `drain` 의 사건은 서버가 이미 보냈다.
      messengerOrchNotice(ev.payload);
      void ack([ev.payload.id]);
    }
  }).catch(() => {});
  void drain().then(restoreRecent);
}
