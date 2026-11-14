import { bannerKindOfSideChat, shouldNotifySideChat, sideChatNotifyText, type SideChatNotifyKind } from "$lib/side-chat-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { aiDisplayName, aiIconName } from "$lib/pane-icons";
import { settings } from "$lib/settings.svelte.js";
import { pushAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { sideChats } from "$lib/app/side-chats.svelte.js";

/**
 * **사이드 채팅 알림을 띄우는 자리** — 규칙은 순수 모듈 `$lib/side-chat-notify`, 여기는 바깥 사실과 부작용뿐이다. 부르는 자리는
 * `app/side-chat-live` 의 사건 적용 하나라, 스냅숏으로 다시 맞춘 지난 일은 알리지 않는다.
 *
 * ## 표면 — AI 타일과 같은 배너 (2026-11-13 사용자 결정 · 목업 A안)
 *
 * 창 안 표면은 오른쪽 위 토스트가 아니라 **AI 타일 알림 배너**(`AgentNotifyBanners.svelte` · `app/agent-banners` — 항목의 대상이
 * `sideChatId`)다 — 사람이 그 채팅을 볼 때까지 남고 시간이 지나면 알약으로 접힌다. 창이 앞에 없으면(`"os"`) OS 알림을 쏘고
 * **배너 항목도 만든다**(`app/agent-notify` 와 같은 결) — 돌아왔을 때 그 자리에 있게. 그래서 OS 알림이 못 나가도 따로 되돌아갈 곳이 없다.
 * 지난 알림 기록도 배너 저장소가 쥔다(해결되면 독의 "지난 알림" 으로) — 일반 기록(`recordNotification`)에는 적지 않는다(두 번 적히지 않게).
 * 알림 · 줄을 누르면 그 채팅을 연다(`app/side-chat-open` 의 `openSideChatFromAlert`).
 */

/** 채팅 하나의 턴이 끝났다 · 실패했다 · 권한을 묻는다 — `chatShown` = 지금 그 채팅이 사람 눈에 보이나 */
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
    // 지난 알림 묶음 — 같은 채팅의 알림은 카드 한 장으로(타일 알림의 타일 갈래와 같은 결)
    group: { key: `chat:${id}`, label: title },
  });
  if (where === "os") void notifyOs(APP, text).catch(() => {});
}
