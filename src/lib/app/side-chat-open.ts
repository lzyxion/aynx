import { chatDockAvailable, openChatDockAt } from "$lib/app/chat-dock.svelte.js";
import { selectSideChat, sideChats } from "$lib/app/side-chats.svelte.js";
import { isRemote } from "$lib/app/window.svelte.js";
import { mobileLayout } from "$lib/app/mobile.svelte.js";
import { openMobileChat } from "$lib/app/mobile-sheets.svelte.js";

/** 채팅이 지워졌으면 `false` — 배너 저장소가 그 항목을 해결로 접는다 */
export function openSideChatFromAlert(id: string): boolean {
  if (!sideChats().some((c) => c.id === id)) return false;
  selectSideChat(id);
  if (isRemote && mobileLayout()) openMobileChat();
  else if (chatDockAvailable()) openChatDockAt("chat");
  return true;
}
