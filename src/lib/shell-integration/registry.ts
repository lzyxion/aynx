// 패널 id → 명령 창구(`CommandApi`) 레지스트리 — 터미널 컴포넌트를 거치지 않고 두드리는 문.
// 불변식: 모듈 수준 바뀌는 상태(`registry`)는 이 파일에만 산다.

import type { CommandApi, CopyResult, MarkerDistance } from "./types";

const registry = new Map<string, CommandApi>();

/** 해제는 내가 넣은 그 창구일 때만 지운다 (`registerInput` 과 같은 이유). */
export function registerCommands(paneId: string, api: CommandApi): () => void {
  registry.set(paneId, api);
  return () => {
    if (registry.get(paneId) === api) registry.delete(paneId);
  };
}

export function commandsOf(paneId: string): CommandApi | null {
  return registry.get(paneId) ?? null;
}

export function paneCwd(paneId: string): string | null {
  return registry.get(paneId)?.cwd() ?? null;
}

/** `tear.ts` 가 이 레지스트리를 직접 알지 않도록 여기 둔다. */
export function paneMarkerDistances(paneId: string): MarkerDistance[] {
  return registry.get(paneId)?.markerDistances() ?? [];
}

export function copyPaneOutput(paneId: string): Promise<CopyResult> {
  const api = registry.get(paneId);
  return api ? api.copyOutput() : Promise.resolve<CopyResult>("none");
}
