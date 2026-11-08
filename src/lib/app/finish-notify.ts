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

/**
 * **긴 명령이 끝났다** — 그 사실을 어디에 띄울지 정하고 실제로 띄운다
 * (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 *
 * 규칙(포커스·가시성 표)은 순수 모듈 `$lib/finish-notify` 에 있다. 여기 있는 것은 그 규칙이
 * 필요로 하는 **바깥 사실**(창이 포커스를 쥐었나 · 임계는 몇 초인가)과, 고른 표면을 실제로
 * 여는 일뿐이다.
 *
 * ## OS 알림 권한은 **처음 쓸 때** 묻는다
 *
 * 그 일은 이제 `app/os-notify.ts` 가 한다(2026-09-22 — 검토 요청 알림이 두 번째 손님이 되어
 * 꺼냈다). 부팅에서 미리 묻지 않고, 거절당하면 여기서는 **토스트로 되돌아간다**: 창을
 * 안 보고 있으니 그 토스트는 당장은 안 읽히지만, 돌아왔을 때 알림 무리에 남아 있다.
 *
 * ## 셸 통합이 없는 타일에는 아예 오지 않는다
 *
 * 부르는 자리가 `Terminal.svelte` 의 블록 싱크(`onblock`) 하나이고, 그 싱크는 OSC 133 의
 * `D` 에서만 불린다. 즉 **진짜로 끝난 명령**만 여기 온다 — 새 프롬프트가 떠서 강제로 닫힌
 * 블록(`exit === null`)은 `endBlock` 을 지나지 않으므로 싱크에 실리지 않고, 그래도 혹시
 * 모를 경우를 위해 아래에서 한 번 더 막는다.
 */

/**
 * 토스트로 띄운다 — "보기" 를 누르면 그 탭으로 옮겨 가 그 타일에 포커스를 준다.
 *
 * 버튼을 **달지 말지**는 지금 판정하고(이미 닫힌 타일에 눌러도 아무 일 없는 버튼을 세우지
 * 않는다), 어느 탭인지는 **누를 때** 다시 찾는다 — 그 사이에 타일을 다른 탭으로 끌어다
 * 놓았을 수 있고, 그때 옛 탭으로 가면 알림이 거짓말을 한 셈이 된다.
 */
function asToast(paneId: string, text: string): void {
  const exists = tabOfPane(paneId) !== null;
  toast.info(text, {
    ms: 8000, // 알림은 읽고 누르러 가는 물건이라 기본(3초)보다 길다
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

/**
 * 지난 알림 묶음의 열쇠 — 명령 끝남 · 프로그램 알림(`app/osc-notify.ts`)이 함께 쓴다. 원격(ssh) 타일은 호스트 별칭,
 * 로컬은 그 타일(이름은 탭 제목 → 타일 이름). **기록하는 순간** 정해 줄에 담는다(`$lib/dock-alert-groups`).
 */
export function tileNotifyGroup(paneId: string, tileName: string): AlertGroup {
  const pane = findPaneAnywhere(paneId);
  const tab = tabOfPane(paneId);
  return tileAlertGroup({
    paneId,
    host: pane?.kind === "ssh" ? pane.alias || null : null,
    tileLabel: (tab ? displayTabTitle(tab).trim() : "") || tileName,
  });
}

/**
 * 끝난 블록 하나를 알린다 (알릴 것이 없으면 아무 일도 하지 않는다).
 *
 * @param paneId      그 타일 (토스트의 "보기" 가 찾아갈 자리)
 * @param tileName    알림 제목에 넣을 타일 이름 (`aynx · web-01`)
 * @param block       방금 닫힌 블록
 * @param tileVisible 그 타일이 지금 보이는 탭에 있는가 (`Terminal` 의 `visible`)
 */
export function notifyFinishedBlock(
  paneId: string,
  tileName: string,
  block: CommandBlock,
  tileVisible: boolean,
): void {
  // 인위적으로 닫힌 블록은 알리지 않는다 — `D` 를 못 본 블록의 "끝난 시각" 은 다음 명령이
  // 시작한 시각이라, 걸린 시간도 종료 코드도 지어낸 값이 된다.
  if (block.exit === null || block.endedAt === null) return;

  const durationMs = blockDurationMs(block);
  if (durationMs === null) return;

  // 메신저(Discord) — 아래 포커스·가시성 표와 **독립**이고 하한도 제 칸(`[messenger] command_min_secs`)이다
  // (docs/log/2026-09-27-discord-notify.md).
  messengerCommandFinish(tileName, { commandLine: block.commandLine, durationMs, exit: block.exit });

  const where = shouldNotifyFinish({
    durationMs,
    thresholdSecs: settings.notifyAfterSecs,
    windowFocused: windowFocused(),
    tileVisible,
  });
  if (where === "none") return;

  const text = finishMessage({ commandLine: block.commandLine, durationMs, exit: block.exit }, t);
  // 알림 센터의 지난 알림에 한 줄 — 어느 표면으로 나가든 **한 번**(OS 가 막혀 토스트로 되돌아가도
  // 같은 사실이다). "알리지 않는다" 였으면 여기 오지 않으므로 적히지도 않는다.
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

  // OS 알림 — 권한을 처음 쓸 때 묻고, 안 되면 토스트로 되돌아간다.
  void notifyOs(`${APP} · ${tileName}`, text)
    .then((ok) => {
      if (!ok) asToast(paneId, text);
    })
    .catch(() => asToast(paneId, text));
}

/**
 * 테스트·재시도용 — 권한 기억을 지운다 (다음 알림에서 다시 묻는다).
 * 살림은 `app/os-notify.ts` 로 옮겼고 이름만 여기 남는다(부르던 자리를 깨지 않는다).
 */
export { resetNotifyPermission } from "$lib/app/os-notify";
