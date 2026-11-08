import { programNotifyText, type ProgramNotice } from "$lib/osc-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { messengerProgramNotice } from "$lib/app/messenger";
import { tileNotifyGroup } from "$lib/app/finish-notify";

/**
 * **타일 안 프로그램이 보낸 알림(OSC 9 · OSC 777)을 띄운다**
 * (docs/log/2026-09-26-osc-notify-inline-images.md).
 *
 * 파싱·글자 다듬기·속도 제한은 순수 모듈 `$lib/osc-notify` 에 있고, 설정(`osc_notify`)과
 * 속도 제한 한 벌은 부르는 쪽(`term/osc-handlers.ts` 의 `attachProgramNotify` — 타일마다 한 번)이 쥔다. 여기 있는 것은
 * 표면을 고르고 실제로 여는 일뿐이다 — `app/finish-notify.ts` 와 같은 분담.
 *
 * | 창이 앞에 있고 그 타일이 보인다 | 앱 토스트 |
 * | --- | --- |
 * | 그 밖 | OS 알림 (권한 거절·실패면 토스트로 되돌아간다) |
 *
 * ## 앱이 말한 것처럼 보이게 두지 않는다
 *
 * 본문은 원격의 아무 프로그램이 정한다. 그래서
 * - OS 알림의 **제목은 늘 `aynx · <타일 이름>`** 이다 — 긴 명령 알림과 같은 머리. 타일 이름은
 *   사용자의 별칭·셸 이름(`paneName`)이지 프로그램이 바꿀 수 있는 창 제목(OSC 0·2)이 아니다.
 *   프로그램이 준 제목(777)은 본문 앞머리로 내려간다 (`programNotifyText`).
 * - 토스트는 앱의 다른 토스트와 같은 상자에 뜨므로 **타일 이름을 앞에 붙인다** — "볼트가
 *   잠겼습니다" 같은 문구를 보내도 "web-01 의 프로그램:" 뒤에 놓인다.
 * - **누를 거리를 달지 않는다** — 토스트 버튼도, 알림 클릭 동작도, 여는 URL 도 없다.
 *   (지난 알림 목록의 줄은 그 타일로 가는 것뿐이다 — 앱이 정한 동작이다.)
 */

/**
 * 알림 한 장을 띄운다. 속도 제한·설정은 부르는 쪽이 이미 걸렀다.
 *
 * @param paneId      그 타일 (지난 알림 줄이 찾아갈 자리)
 * @param tileName    제목·토스트 앞머리에 넣을 타일 이름
 * @param notice      파서가 준 알림 (이미 다듬어진 글자)
 * @param tileVisible 그 타일이 지금 보이는 탭에 있는가 (`Terminal` 의 `visible`)
 */
export function notifyFromProgram(
  paneId: string,
  tileName: string,
  notice: ProgramNotice,
  tileVisible: boolean,
): void {
  const text = programNotifyText(notice);
  const labelled = t("pane.program_notify.toast", { tile: tileName, text });
  // 지난 알림에 **한 번** — 어느 표면으로 나가든 같은 사실이다 (finish-notify 와 같은 규칙).
  recordNotification({
    kind: "program-notify",
    text: labelled,
    paneId,
    level: "info",
    group: tileNotifyGroup(paneId, tileName),
    short: text,
  });
  // 메신저(Discord) — 아래 표면 판정과 **독립**이다. 속도 제한(타일당 2초)과 `osc_notify` 는 부르는 쪽이
  // 이미 걸렀다 — 그래서 프로그램 알림을 끄면 메신저로도 가지 않는다(docs/log/2026-09-27-discord-notify.md).
  messengerProgramNotice(tileName, text);

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
