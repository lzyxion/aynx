// 패널 id → 명령 창구(`CommandApi`) 레지스트리 — 패널 헤더·MCP·검색·이관이 터미널 컴포넌트를 거치지 않고 두드리는 문.
// 불변식: 모듈 수준 바뀌는 상태(`registry`)는 이 파일에만 산다.

import type { CommandApi, CopyResult, MarkerDistance } from "./types";

// ---------------------------------------------------------------------------
// 레지스트리 (sync.svelte.ts 의 입력 레지스트리와 같은 패턴)
//
// 패널 헤더의 ⧉ 버튼은 `PaneHost` 에 있고 터미널은 `Terminal.svelte` 안에 있다. 컴포넌트
// 경계를 넘어 메서드를 부르는 대신, 살아 있는 패널이 자기 창구를 이름표와 함께 여기 올려
// 둔다. 6단계의 MCP `get_last_command` 도 같은 문을 쓴다 — **이번에는 노출만** 한다.
// ---------------------------------------------------------------------------

const registry = new Map<string, CommandApi>();

/**
 * 패널의 명령 창구를 등록한다 (터미널 마운트 시 1회).
 * 해제는 **내가 넣은 그 창구일 때만** 지운다 (`registerInput` 과 같은 이유).
 */
export function registerCommands(paneId: string, api: CommandApi): () => void {
  registry.set(paneId, api);
  return () => {
    if (registry.get(paneId) === api) registry.delete(paneId);
  };
}

/** 그 패널의 창구 (없으면 null) */
export function commandsOf(paneId: string): CommandApi | null {
  return registry.get(paneId) ?? null;
}

/** 그 패널의 셸이 마지막으로 알려 준 폴더 (없으면 `null`) — [`CommandApi.cwd`] 참고 */
export function paneCwd(paneId: string): string | null {
  return registry.get(paneId)?.cwd() ?? null;
}

/**
 * 그 패널이 지금 들고 있는 블록 마커의 거리 목록 (없으면 빈 배열) — 이관 페이로드가 읽는다.
 * `tear.ts` 가 이 레지스트리를 직접 알지 않도록 `paneCwd` 와 같은 자리에 둔다.
 */
export function paneMarkerDistances(paneId: string): MarkerDistance[] {
  return registry.get(paneId)?.markerDistances() ?? [];
}

/** 패널 헤더의 ⧉ — 그 패널의 마지막 출력을 클립보드로 */
export function copyPaneOutput(paneId: string): Promise<CopyResult> {
  const api = registry.get(paneId);
  return api ? api.copyOutput() : Promise.resolve<CopyResult>("none");
}
