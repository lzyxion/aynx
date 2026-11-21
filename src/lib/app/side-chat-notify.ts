import { bannerKindOfSideChat, shouldNotifySideChat, sideChatNotifyText, type SideChatNotifyKind } from "$lib/side-chat-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { aiDisplayName, aiIconName } from "$lib/pane-icons";
import { settings } from "$lib/settings.svelte.js";
import { pushAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { sideChats } from "$lib/app/side-chats.svelte.js";

/**
 * 사이드 채팅 알림 — 사건 적용(`app/side-chat-live`)에서만 부른다: 스냅숏으로 다시 맞춘 지난 일은 알리지 않는다.
 * 일반 기록(`recordNotification`)에는 적지 않는다 — 배너 저장소가 지난 알림을 쥐어 두 번 적히지 않게.
 */

export function notifySideChat(id: string, kind: SideChatNotifyKind, chatShown: boolean): void {
  const where = shouldNotifySideChat({ enabled: settings.notifySideChat, windowFocused: windowFocused(), chatShown });
  if (where === "none") return;

  const chat = sideChats().find((c) => c.id === id);
  const title = chat?.title || t("app.chatDock.untitled");
  const text = sideChatNotifyText(kind, title, t);
  const bannerKind = bannerKindOfSideChat(kind);
  pushAgentBanner({
    sideChatId: id,
    kind: bannerKind,
    agent: chat ? aiDisplayName(chat.cli) : null,
    logo: chat ? aiIconName(chat.cli) : null,
    label: title,
    text,
    short: t(
      bannerKind === "permission"
        ? "app.agent.banner.permission"
        : bannerKind === "failed"
          ? "app.agent.banner.failed"
          : "app.agent.banner.chat.stop",
    ),
    group: { key: `chat:${id}`, label: title },
  });
  if (where === "os") void notifyOs(APP, text).catch(() => {});
}
