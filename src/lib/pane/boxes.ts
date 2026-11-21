/** 전 탭의 전 타일을 한 평면 목록으로 — `PaneHost` 가 그린다 (docs/log/2026-09-02-pane-host.md) */

import { computeLayout, FULL_RECT, type Rect } from "$lib/layout";
import { listPanes, paneOrder, type PaneSpec, type TabSpec } from "$lib/session";
import { ORCH_CANVAS } from "$lib/orchestration/orch-tab";

/** 오케스트레이션 탭은 아래 재생 막대 띠를 뺀 사각형 — 상자 · 분할선 · 최대화가 모두 이 값을 뿌리로 쓴다 */
export function tabCanvas(tab: Pick<TabSpec, "orch">): Rect {
  return tab.orch ? ORCH_CANVAS : FULL_RECT;
}

export interface HostBox {
  tab: TabSpec;
  pane: PaneSpec;
  rect: Rect;
  paneCount: number;
  /** 활성 탭의 (최대화에 가려지지 않은) 타일 — 포커스 · 활동 판정이 본다 */
  visible: boolean;
  /** `visible` + 탭 전환 슬라이드로 빠져나가는 중인 탭의 타일. 거짓이면 `display:none` */
  shown: boolean;
  focused: boolean;
  zoomed: boolean;
}

/**
 * `tab.zoomedPaneId` 를 그대로 믿지 않는 그물 — 그 잎이 옮겨졌거나 닫혔거나 타일이 하나만 남았으면 `null`
 * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md). 본길은 `+page` 가 구조 조작마다 최대화를 푸는 것이다.
 */
export function zoomOf(tab: TabSpec): string | null {
  const id = tab.zoomedPaneId ?? null;
  if (id === null) return null;
  const panes = listPanes(tab.root);
  if (panes.length < 2) return null;
  return panes.some((p) => p.id === id) ? id : null;
}

/**
 * 정렬 키는 탭 순서가 아니라 패널 생성 순번이다 — 그래야 탭 이동에서 keyed each 가 살아 있는 노드를 옮기지 않는다.
 * 최대화로 숨긴 타일은 비활성 탭과 같은 길(`display:none`)이라 인스턴스 · 세션 · 스크롤백이 산다.
 */
export function hostBoxes(
  tabs: readonly TabSpec[],
  activeId: string | null,
  focusedPaneOf: (tab: TabSpec) => string,
  leavingId: string | null = null,
  /** 원격 창의 모바일 배치 — 포커스 타일만 캔버스 전체로 · `zoomed` 는 진짜 최대화에만 선다 */
  solo = false,
): HostBox[] {
  const out: HostBox[] = [];
  for (const tab of tabs) {
    const canvas = tabCanvas(tab);
    const panes = computeLayout(tab.root, canvas).panes;
    const visible = tab.id === activeId;
    const drawn = visible || tab.id === leavingId;
    const focusedId = focusedPaneOf(tab);
    const realZoom = zoomOf(tab);
    const soloId = solo && panes.length > 1 ? (panes.some((p) => p.pane.id === focusedId) ? focusedId : panes[0].pane.id) : null;
    const zoomId = soloId ?? realZoom;
    for (const b of panes) {
      const full = zoomId !== null && b.pane.id === zoomId;
      out.push({
        tab,
        pane: b.pane,
        rect: full ? canvas : b.rect,
        paneCount: panes.length,
        visible: visible && (zoomId === null || full),
        shown: drawn && (zoomId === null || full),
        focused: b.pane.id === focusedId,
        zoomed: full && b.pane.id === realZoom,
      });
    }
  }
  out.sort((x, y) => paneOrder(x.pane.id) - paneOrder(y.pane.id));
  return out;
}
