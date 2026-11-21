import type { CommandBlock } from "$lib/block-history";
import { blockDurationMs } from "$lib/block-history";
import { finishMessage, shouldNotifyFinish } from "$lib/finish-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { findPaneAnywhere, focusTile, tabOfPane } from "$lib/app/tabs.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import { tileAlertGroup, type AlertGroup } from "$lib/dock-alert-groups";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { messengerCommandFinish } from "$lib/app/messenger";
import { sessionStreamOf } from "$lib/session";

/** 긴 명령이 끝났다는 알림을 띄운다 (docs/log/2026-09-16-finish-notify-block-marks-bell.md) */

/** 탭은 누를 때 다시 찾는다 — 그 사이 타일을 다른 탭으로 옮겼을 수 있다 */
function asToast(paneId: string, text: string): void {
  const exists = tabOfPane(paneId) !== null;
  toast.info(text, {
    ms: 8000,
    action: exists
      ? {
          label: t("pane.block.notify.view"),
          run: () => {
            const tab = tabOfPane(paneId);
            if (tab) focusTile(tab.id, paneId);
          },
        }
      : undefined,
  });
}

/** 지난 알림 묶음의 열쇠 — 기록하는 순간 정해 줄에 담는다 */
export function tileNotifyGroup(paneId: string, tileName: string): AlertGroup {
  const pane = findPaneAnywhere(paneId);
  const tab = tabOfPane(paneId);
  return tileAlertGroup({
    paneId,
    host: pane?.kind === "ssh" ? pane.alias || null : null,
    tileLabel: (tab ? displayTabTitle(tab).trim() : "") || tileName,
  });
}

export function notifyFinishedBlock(
  paneId: string,
  tileName: string,
  block: CommandBlock,
  tileVisible: boolean,
  messengerName?: string,
): void {
  // `D` 를 못 본 블록은 걸린 시간 · 종료 코드가 지어낸 값이라 알리지 않는다
  if (block.exit === null || block.endedAt === null) return;

  const durationMs = blockDurationMs(block);
  if (durationMs === null) return;

  // 메신저는 아래 포커스 · 가시성 표와 독립이고 하한도 제 칸(`[messenger] command_min_secs`)이다
  const pane = findPaneAnywhere(paneId);
  messengerCommandFinish(
    messengerName || tileName,
    { commandLine: block.commandLine, durationMs, exit: block.exit },
    pane ? sessionStreamOf(pane) : null,
  );

  const where = shouldNotifyFinish({
    durationMs,
    thresholdSecs: settings.notifyAfterSecs,
    windowFocused: windowFocused(),
    tileVisible,
  });
  if (where === "none") return;

  const text = finishMessage({ commandLine: block.commandLine, durationMs, exit: block.exit }, t);
  // 어느 표면으로 나가든 한 번만 적는다(OS 가 막혀 토스트로 되돌아가도)
  recordNotification({
    kind: "command-finish",
    text,
    paneId,
    level: block.exit === 0 ? "success" : "error",
    group: tileNotifyGroup(paneId, tileName),
  });
  if (where === "toast") {
    asToast(paneId, text);
    return;
  }

  void notifyOs(`${APP} · ${tileName}`, text)
    .then((ok) => {
      if (!ok) asToast(paneId, text);
    })
    .catch(() => asToast(paneId, text));
}

/** 부르던 자리를 깨지 않으려 이름만 여기 남는다 */
export { resetNotifyPermission } from "$lib/app/os-notify";
