// 타일 머리줄 · 몸의 순수 표시 계산 — 앱 상태는 읽지 않는다(부르는 쪽 `PaneHost` 가 인자로 넘긴다).
import { hasSession, type PaneSpec } from "$lib/session";
import type { HostBox } from "$lib/pane/boxes";
import type { TileHeaderMode } from "$lib/settings/model/options";
import type { Project } from "$lib/projects";

/** 시작 타일은 어느 값에서도 빠진다 — 로고 · 바로가기가 가운데 선 그림이라 32px 띠가 붙으면 어긋난다 */
export function tileHeaded(item: HostBox, solo: boolean, when: TileHeaderMode): boolean {
  if (item.pane.kind === "start") return false;
  // 프로듀서 채팅 잎은 제 머리를 그린다 — 끌 수 없는 고정 잎이다
  if (item.pane.kind === "producer") return false;
  // 폰(모바일 배치) — 머리줄 대신 위 띠(`pane-menu.ts` 의 `phone`)
  if (solo) return false;
  if (when === "never") return false;
  if (when === "multi") return item.paneCount > 1;
  return true;
}

export const hostOfPane = <H>(pane: PaneSpec, hostByName: ReadonlyMap<string, H>): H | null =>
  pane.kind === "ssh" && pane.alias ? (hostByName.get(pane.alias) ?? null) : null;

/** 거짓이면 원본 타일이 닫혀 돌아오지 않는다 — 세션만 `null` 인 것(재연결로 돌아온다)과 다른 상태다 */
export const sourceAlive = (pane: PaneSpec, kindById: ReadonlyMap<string, unknown>): boolean =>
  pane.sourcePaneId !== undefined && kindById.has(pane.sourcePaneId);

export function fileProjectsFor(
  pane: PaneSpec,
  list: readonly Project[],
): { id: string; name: string; path: string }[] {
  const host = pane.kind === "sftp" ? (pane.alias ?? "") : null;
  return list
    .filter((p) => (host === null ? p.host === null : p.host === host))
    .map((p) => ({ id: p.id, name: p.name, path: p.path }));
}

export const isTerminalPane = (pane: PaneSpec): boolean => hasSession(pane.kind);
