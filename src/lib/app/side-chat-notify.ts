import { shouldNotifySideChat, sideChatNotifyText, type SideChatNotifyKind } from "$lib/side-chat-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { chatDockAvailable, openChatDockAt } from "$lib/app/chat-dock.svelte.js";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { selectSideChat, sideChats } from "$lib/app/side-chats.svelte.js";

/**
 * **사이드 채팅 알림을 띄우는 자리** — 규칙은 순수 모듈 `$lib/side-chat-notify`, 여기는 바깥 사실과 부작용뿐이다. 부르는 자리는
 * `app/side-chat-live` 의 사건 적용 하나라, 스냅숏으로 다시 맞춘 지난 일은 알리지 않는다.
 *
 * 배너(`app/agent-banners`)는 타일에 묶여 있어 쓰지 않는다 — 창 안은 토스트, 창이 뒤면 OS 알림, 돌아왔을 때는 지난 알림 한 줄과 독의 점이 남는다.
 */

/** [보기] = 그 채팅을 고르고 독을 연다. 독이 없는 창(폰 배치)에는 단추가 없다 — 상태줄 말풍선의 점이 대신 말한다 */
function asToast(id: string, text: string): void {
  toast.info(text, {
    ms: 8000,
    action: chatDockAvailable()
      ? {
          label: t("pane.block.notify.view"),
          run: () => {
            selectSideChat(id);
            openChatDockAt("chat");
          },
        }
      : undefined,
  });
}

/** 채팅 하나의 턴이 끝났다 · 권한을 묻는다 — `chatShown` = 지금 그 채팅이 사람 눈에 보이나 */
export function notifySideChat(id: string, kind: SideChatNotifyKind, chatShown: boolean): void {
  const where = shouldNotifySideChat({ enabled: settings.notifySideChat, windowFocused: windowFocused(), chatShown });
  if (where === "none") return;

  const title = sideChats().find((c) => c.id === id)?.title || t("app.chatDock.untitled");
  const text = sideChatNotifyText(kind, title, t);
  recordNotification({ kind: "side-chat", text, level: kind === "failed" ? "error" : kind === "finished" ? "success" : "info" });
  if (where === "toast") {
    asToast(id, text);
    return;
  }
  // OS 알림 — 못 나가면(권한 거절 · 원격 창) 토스트로 되돌아간다
  void notifyOs(APP, text)
    .then((ok) => {
      if (!ok) asToast(id, text);
    })
    .catch(() => asToast(id, text));
}
