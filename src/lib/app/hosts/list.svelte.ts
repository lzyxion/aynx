// 호스트 **목록 캐시와 재로드** — 세션 타일이 읽은 스냅숏 하나(`hostCache`)를 앱이 나눠 본다.
// 모듈 수준 상태 `cache` · `refreshKey` · `lastRefresh` 는 여기에만 산다 (형제는 게터로 읽는다).
import { refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
import { groupPaths, type HostEntry } from "$lib/hosts";

// ---------------------------------------------------------------------------
// 목록 캐시
// ---------------------------------------------------------------------------

/**
 * 세션 타일이 마지막으로 읽은 호스트 목록 (`onhosts` 로 올라온다).
 *
 * 드래그가 실어 나르는 것은 별칭 문자열뿐이라 `scrollback` 같은 메타는 여기서 찾는다.
 * **`$state` 다** — 패널 헤더의 색 점과 툴팁이 같은 스냅숏에서 나오므로 목록이 갱신되면
 * 화면도 따라야 한다.
 */
let cache = $state<HostEntry[]>([]);

/** 지금 목록 (사이드바가 보여 주는 것과 **같은 스냅숏**) */
export function hostCache(): HostEntry[] {
  return cache;
}

/** 세션 타일·시작 화면이 목록을 다시 읽었다 */
export function setHostCache(list: HostEntry[]): void {
  cache = list;
}

/** 별칭으로 호스트를 찾는다 */
export function lookupHost(name: string): HostEntry | null {
  return cache.find((h) => h.name === name) ?? null;
}

/**
 * 호스트 트리 재로드 트리거 — 값이 바뀌면 **독의 트리**가 목록을 다시 읽는다
 * (`hostActions.refreshKey`).
 */
let refreshKey = $state(0);

export function hostsRefreshKey(): number {
  return refreshKey;
}

/** 마지막 재로드 시각 (포커스 복귀 갱신의 과도 호출을 막는 데 쓴다) */
let lastRefresh = Date.now();
/** 재로드 최소 간격 */
const REFRESH_COOLDOWN_MS = 1000;

export function refreshHosts(): void {
  lastRefresh = Date.now();
  refreshKey += 1;
  // AI 위임 표도 같은 박자로 맞춘다 — 목록 줄의 위임 표식과 제거 확인 문구가 그 사본을
  // **동기로** 읽는다 (`app/delegation.svelte.ts` 머리말). 기다리지 않는다.
  refreshDelegationTargets();
}

/**
 * 에디터에서 저장하고 돌아오면 목록에 반영한다. 창을 자주 오가도 부담이 없도록 마지막
 * 로드 후 1초 이내면 건너뛴다.
 */
export function onWindowFocus(): void {
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) return;
  refreshHosts();
}

/**
 * 그룹 칸의 `<datalist>` 자동완성 후보 — 지금 쓰이고 있는 **서로 다른 그룹 경로**들
 * (조상 경로 포함). 규칙 자체는 `hosts.ts` 의 순수 함수다.
 */
export function groupSuggestions(): string[] {
  return groupPaths(cache);
}
