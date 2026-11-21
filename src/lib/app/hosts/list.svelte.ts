import { refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
import { groupPaths, type HostEntry } from "$lib/hosts";

// ---------------------------------------------------------------------------
// 목록 캐시
// ---------------------------------------------------------------------------

/** 드래그는 별칭만 실어 나르므로 메타는 여기서 찾는다 */
let cache = $state<HostEntry[]>([]);

export function hostCache(): HostEntry[] {
  return cache;
}

export function setHostCache(list: HostEntry[]): void {
  cache = list;
}

export function lookupHost(name: string): HostEntry | null {
  return cache.find((h) => h.name === name) ?? null;
}

/** 바뀌면 독의 트리가 목록을 다시 읽는다 */
let refreshKey = $state(0);

export function hostsRefreshKey(): number {
  return refreshKey;
}

let lastRefresh = Date.now();
const REFRESH_COOLDOWN_MS = 1000;

export function refreshHosts(): void {
  lastRefresh = Date.now();
  refreshKey += 1;
  // 위임 표식 · 제거 확인 문구가 그 사본을 동기로 읽는다
  refreshDelegationTargets();
}

/** 에디터에서 저장하고 돌아오면 반영한다 */
export function onWindowFocus(): void {
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) return;
  refreshHosts();
}

export function groupSuggestions(): string[] {
  return groupPaths(cache);
}
