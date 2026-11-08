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

/**
 * **대시보드의 "어디서" 저장소** — 사용량 칸이 보는 출처(앞선 판은 지난 대화 덩어리와 함께 봤다 — 그 덩어리는 2026-09-28 에 뺐다 · docs/log/2026-09-27-remote-conversations.md
 * "2단계"). 규칙은 순수 층 `$lib/dashboard-source`, 그림은 `console/SourceChips.svelte`.
 *
 * 고른 출처는 이 창의 메모리에만 — 기본은 "이 PC"(대시보드를 열 때마다 그대로 둔다 · 앱을 다시 켜면 "이 PC"). 호스트 칩을
 * 고르면 그 호스트에 붙은 이 창의 SSH 타일로 다시 읽고(1분 캐시 — 새 접속은 열지 않는다), 붙은 타일이 없으면 마지막 값을 흐리게 둔다.
 */

let picked = $state<SourceKey>(LOCAL);

/** 지금 칩들과 고른 출처 — 반응형 */
export function dashboardSources(): { chips: SourceChip[]; key: SourceKey } {
  const list = conversationList();
  const localCount = list === null ? null : flatConversations(list).length;
  const hosts = remoteHostList().map((h) => ({ ...h, live: liveSessionFor(h.alias) !== null }));
  const chips = sourceChips(localCount, hosts);
  return { chips, key: resolveSource(picked, chips) };
}

/** 출처를 고른다 — 붙은 세션이 있는 호스트는 다시 읽는다(1분 안이면 캐시) */
export function pickDashboardSource(key: SourceKey): void {
  picked = key;
  const { chips } = dashboardSources();
  for (const alias of hostsToRefresh(key, chips)) ensureRemoteConversations(alias);
}

/** 대시보드가 열릴 때 — 고른 출처의 붙은 호스트를 (1분이 지났으면) 다시 읽는다 */
export function refreshDashboardSource(): void {
  const { chips, key } = dashboardSources();
  for (const alias of hostsToRefresh(key, chips)) ensureRemoteConversations(alias);
}
