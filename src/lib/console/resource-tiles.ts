/**
 * **자원 표본의 타일 열쇠(스트림) → 이 창의 타일** (2026-10-17 — `ResourceBoard.svelte` 에서 뗐다. 상태바 자원 고리의 호버 카드
 * `ResourceHoverCard.svelte` 와 같은 이름을 쓰려고). 이 창의 탭(숨은 워크스페이스 포함 — `residentWindowTabs`)에서 로컬 타일을 찾아
 * 이름을 짓는다: 타일 이름이 탭 제목과 같으면 그 하나, 다르면 `타일 · 탭`. 없으면(다른 창 · 떨어진 세션) 부르는 쪽이 "다른 창의
 * 타일" 로 적는다. 반응형 저장소를 읽기만 하므로 `$derived` 안에서 부르면 탭이 바뀔 때 다시 돈다.
 *
 * 줄 앞 로고(10-17)는 `pane` 을 `PaneIcon` 에 넘겨 그린다. 폭이 좁은 호버 카드는 타일 이름 글자를 로고로 갈음하고 `place`(탭 제목)만
 * 글자로 붙인다.
 */
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { displayName, displayTabTitle } from "$lib/app/titles.svelte.js";
import { listPanes, type PaneSpec } from "$lib/session";

export interface ResourceTileInfo {
  tabId: string;
  paneId: string;
  /** `타일` 또는 `타일 · 탭` */
  name: string;
  /** 타일 이름만(`displayName` — `Claude` · `PowerShell 7` …) — 로고의 접근성 이름 */
  paneName: string;
  /** 탭 제목 — 타일 이름과 같으면 `null`(그때 `name` 이 곧 타일 이름) */
  place: string | null;
  /** 줄 앞 로고를 그릴 타일(`PaneIcon` — 타일 머리줄 · 탭과 같은 그림: AI 면 그 로고, 아니면 해석된 셸) */
  pane: PaneSpec;
}

/** 스트림 → (탭 id · 타일 id · 이름) — 이 창의 로컬 타일만 */
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
