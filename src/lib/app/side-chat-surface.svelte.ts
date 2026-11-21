import { deleteSideChat, sideChats } from "$lib/app/side-chats.svelte.js";
import { closeSideChatLive, joinLiveSideChats, sideChatDot } from "$lib/app/side-chat-live.svelte.js";
import { mostUrgentDot, targetOf, type Dot } from "$lib/chat/chat-presentation";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { toast } from "$lib/toast.svelte.js";
import { deleteSideChatConversations } from "$lib/app/agent-sessions.svelte.js";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { SideChat } from "$lib/side-chat";

/** 사이드 채팅을 그리는 두 자리(채팅 독 · 폰 덮개)의 공용 몸 */

export function joinListedSideChats(): Promise<void> {
  return joinLiveSideChats((id) => {
    const c = sideChats().find((x) => x.id === id);
    return c ? targetOf(c) : null;
  });
}

export function sideChatsHeadDot(): Dot {
  return mostUrgentDot(sideChats().map((c) => sideChatDot(c.id)));
}

/**
 * 갈라 온 원본 대화는 지우지 않는다. 대화를 못 지우면 채팅을 남긴다 — 지난 대화 줄의 삭제는 사이드 채팅 대화를 막아 여기서만 다시 지울 수 있다.
 */
export async function removeSideChat(chat: SideChat): Promise<void> {
  const title = chat.title || t("app.chatDock.untitled");
  const ok = await askConfirm(t("app.chatDock.delete.confirm", { title }), {
    kind: "warning",
    danger: true,
    okLabel: t("app.chatDock.delete"),
  });
  if (!ok) return;
  const convs = Object.entries(chat.links)
    .filter(([agent, id]) => !(chat.forkedFrom?.agent === agent && chat.forkedFrom.conv === id))
    .map(([agent, id]) => ({ agent, id }));
  try {
    await closeSideChatLive(chat.id);
    await deleteSideChatConversations(convs);
  } catch (e) {
    showNotice(t("app.chatDock.delete.convFailed", { e: stripReason(e instanceof Error ? e.message : String(e)) }));
    return;
  }
  try {
    await deleteSideChat(chat.id);
    toast.success(t("app.chatDock.delete.done", { title }));
  } catch (e) {
    showNotice(t("app.chatDock.delete.failed", { e: stripReason(String(e)) }));
  }
}
