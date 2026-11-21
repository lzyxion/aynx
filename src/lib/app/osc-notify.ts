import { programNotifyText, type ProgramNotice } from "$lib/osc-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { messengerProgramNotice } from "$lib/app/messenger";
import { tileNotifyGroup } from "$lib/app/finish-notify";
import { findPaneAnywhere } from "$lib/app/tabs.svelte.js";
import { sessionStreamOf } from "$lib/session";

/**
 * 본문은 원격의 아무 프로그램이 정한다 — OS 알림 제목은 늘 `aynx · <타일 이름>`(프로그램이 바꾸는 OSC 0·2 창 제목이 아니다),
 * 토스트는 타일 이름을 앞에 붙이고, 누를 거리(토스트 버튼 · 알림 클릭 동작 · URL)는 달지 않는다.
 */

export function notifyFromProgram(
  paneId: string,
  tileName: string,
  notice: ProgramNotice,
  tileVisible: boolean,
  fromAgent = false,
): void {
  const text = programNotifyText(notice);
  const labelled = t("pane.program_notify.toast", { tile: tileName, text });
  recordNotification({
    kind: "program-notify",
    text: labelled,
    paneId,
    level: "info",
    group: tileNotifyGroup(paneId, tileName),
    short: text,
  });
  const pane = findPaneAnywhere(paneId);
  messengerProgramNotice(tileName, text, fromAgent, pane ? sessionStreamOf(pane) : null);

  const asToast = () => toast.info(labelled, { ms: 8000 });
  if (windowFocused() && tileVisible) {
    asToast();
    return;
  }
  void notifyOs(`${APP} · ${tileName}`, text)
    .then((ok) => {
      if (!ok) asToast();
    })
    .catch(asToast);
}
