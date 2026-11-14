import { chatDockAvailable, openChatDockAt } from "$lib/app/chat-dock.svelte.js";
import { selectSideChat, sideChats } from "$lib/app/side-chats.svelte.js";
import { isRemote } from "$lib/app/window.svelte.js";
import { mobileLayout } from "$lib/app/mobile.svelte.js";
import { openMobileChat } from "$lib/app/mobile-sheets.svelte.js";

/**
 * **알림에서 그 사이드 채팅을 연다** — 타일 알림이 그 타일로 가는 것과 같은 결(2026-11-13). 부르는 자리는 배너 저장소
 * (`app/agent-banners` 의 `openAgentBanner` — 배너의 [보기] · [확인하러 가기] · 알약 · `` Alt+` `` · 독 "확인할 것")와
 * 독 알림 칸의 지난 알림 줄(`DockAlerts` — 메뉴 통로 뒤).
 *
 * `app/side-chat-notify` 에서 따로 뗀 것은 순환을 피하려서다 — 그 모듈은 배너 저장소를 부르고, 배너 저장소가 이 함수를 부른다.
 * `app/side-chat-ask` 의 `openSideChatHere` 도 같은 갈림이지만 그 모듈은 `side-chat-live` → `side-chat-notify` 를 거쳐 배너 저장소로
 * 돌아오므로 부르지 않는다.
 */

/**
 * 그 채팅을 고르고 이 창의 채팅 자리를 연다 — 원격 폰 배치는 폰 덮개, 독이 있는 창은 채팅 독의 채팅 갈래. 채팅이 지워졌으면
 * 아무 일도 없이 `false`(타일 알림의 없어진 타일과 같다 — 배너 저장소는 그때 그 항목을 저절로 해결로 접는다).
 */
export function openSideChatFromAlert(id: string): boolean {
  if (!sideChats().some((c) => c.id === id)) return false;
  selectSideChat(id);
  if (isRemote && mobileLayout()) openMobileChat();
  else if (chatDockAvailable()) openChatDockAt("chat");
  return true;
}
