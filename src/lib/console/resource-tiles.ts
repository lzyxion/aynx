/** 자원 표본의 타일 열쇠(스트림) → 이 창의 로컬 타일 이름. 대시보드 자원 판과 상태바 자원 호버 카드가 같은 이름을 쓴다. */
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { displayName, displayTabTitle } from "$lib/app/titles.svelte.js";
import { listPanes, type PaneSpec } from "$lib/session";

export interface ResourceTileInfo {
  tabId: string;
  paneId: string;
  name: string;
  paneName: string;
  /** 탭 제목 — 타일 이름과 같으면 `null` */
  place: string | null;
  pane: PaneSpec;
}

export function localTileInfo(): Map<string, ResourceTileInfo> {
  const m = new Map<string, ResourceTileInfo>();
  for (const tab of residentWindowTabs()) {
    const tabTitle = displayTabTitle(tab);
    for (const pane of listPanes(tab.root)) {
      if (pane.kind !== "local" || !pane.historyStreamId) continue;
      const name = displayName(pane);
      const place = name === tabTitle ? null : tabTitle;
      m.set(pane.historyStreamId, {
        tabId: tab.id,
        paneId: pane.id,
        name: place === null ? name : `${name} · ${place}`,
        paneName: name,
        place,
        pane,
      });
    }
  }
  return m;
}
