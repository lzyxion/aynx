// 전환/reveal 순서만 담당하는 순수 조립. resident 객체를 복사하거나 목록에서 제거하지 않는다.
import { findPane, type TabSpec } from "$lib/session";

export function switchResidentWorkspace<T extends { id: string; materialized: boolean }>(
  id: string,
  currentId: string | null,
  workspaces: readonly T[],
  callbacks: {
    remember: () => void;
    materialize: (workspace: T) => void;
    setCurrent: (id: string) => void;
    restore: (workspace: T) => void;
  },
): void {
  const target = workspaces.find((workspace) => workspace.id === id);
  if (!target || id === currentId) return;
  callbacks.remember();
  if (!target.materialized) callbacks.materialize(target);
  callbacks.setCurrent(id);
  callbacks.restore(target);
}

export function revealResidentPane(
  tabs: readonly TabSpec[],
  paneId: string,
  callbacks: {
    switchWorkspace: (id: string, selection: { tabId: string; paneId: string }) => void;
    select: (tab: TabSpec, paneId: string) => void;
  },
): boolean {
  const tab = tabs.find((tab) => findPane(tab.root, paneId));
  if (!tab) return false;
  if (tab.workspaceId) callbacks.switchWorkspace(tab.workspaceId, { tabId: tab.id, paneId });
  callbacks.select(tab, paneId);
  return true;
}
