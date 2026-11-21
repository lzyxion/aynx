import { conversationList } from "$lib/app/agent-sessions.svelte.js";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { ensureRemoteConversations, remoteHostList } from "$lib/app/remote-conversations.svelte.js";
import { flatConversations } from "$lib/agent-sessions";
import {
  hostsToRefresh,
  LOCAL,
  resolveSource,
  sourceChips,
  type SourceChip,
  type SourceKey,
} from "$lib/dashboard-source";

/** 대시보드 사용량 칸의 출처 — 호스트는 이미 붙은 SSH 타일로만 다시 읽는다(새 접속은 열지 않는다). */

let picked = $state<SourceKey>(LOCAL);

export function dashboardSources(): { chips: SourceChip[]; key: SourceKey } {
  const list = conversationList();
  const localCount = list === null ? null : flatConversations(list).length;
  const hosts = remoteHostList().map((h) => ({ ...h, live: liveSessionFor(h.alias) !== null }));
  const chips = sourceChips(localCount, hosts);
  return { chips, key: resolveSource(picked, chips) };
}

export function pickDashboardSource(key: SourceKey): void {
  picked = key;
  const { chips } = dashboardSources();
  for (const alias of hostsToRefresh(key, chips)) ensureRemoteConversations(alias);
}

export function refreshDashboardSource(): void {
  const { chips, key } = dashboardSources();
  for (const alias of hostsToRefresh(key, chips)) ensureRemoteConversations(alias);
}
