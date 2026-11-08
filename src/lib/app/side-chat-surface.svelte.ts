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

/**
 * **사이드 채팅을 그리는 자리들의 공용 몸**(2026-11-01 — docs/log/2026-11-01-remote-side-chat.md 화면 단계). 자리는 둘이다: 데스크톱 폭의
 * 채팅 독(`ChatDock` — 집 PC 주 창 · 원격 데스크톱 폭 창)과 원격 폰 배치의 전체 화면 덮개(`mobile/MobileChat`). 둘 다 서는 순간 서버 표에
 * 살아 있는 채팅(뒤에서 도는 턴 · 권한 대기)에 붙어 점을 세우고, 폰 상태줄의 말풍선은 같은 점을 읽는다.
 */

/** 서버 표에 살아 있는 채팅 가운데 **이 창의 목록에 있는 것**에 붙는다(구독 → attach — 띄우지 않는다) */
export function joinListedSideChats(): Promise<void> {
  return joinLiveSideChats((id) => {
    const c = sideChats().find((x) => x.id === id);
    return c ? targetOf(c) : null;
  });
}

/** 모든 채팅 중 가장 급한 점(권한 > 새 답 > 답하는 중) — 독 머리줄 ▾ · 폰 상태줄 말풍선. 반응형 */
export function sideChatsHeadDot(): Dot {
  return mostUrgentDot(sideChats().map((c) => sideChatDot(c.id)));
}

/**
 * 채팅 지우기(독 · 폰 덮개 공용 — 목록 줄의 우클릭 · 호버 단추 · 독 머리줄 ⋯) — 확인 뒤 서버의 프로세스를 닫고(`side_chat_close`) 그 채팅이
 * 쥔 대화들(`links` — 갈라 온 원본은 빼고)을 CLI 의 기록에서 영구히 지운 뒤 목록에서 빼고 폴더를 지운다. 대화를 못 지우면 채팅을 남긴다
 * (다시 지울 수 있게 — 지난 대화 줄의 삭제는 사이드 채팅 대화를 막는다).
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
