/**
 * **전 탭의 전 타일을 한 목록으로** — 순수 계산 (docs/log/2026-09-02-pane-host.md).
 *
 * `PaneHost` 가 그리는 것은 트리가 아니라 이 평면 목록이다. 왜 평면인지는 그쪽 머리말에
 * 적혀 있고(인스턴스 보존), 여기서는 그 목록을 **어떻게 만드는가**만 든다: 탭마다
 * `computeLayout` 으로 사각형을 얻고, 최대화를 한 겹 걸러 내고, 패널 생성 순번으로 정렬한다.
 *
 * 셋 다 상태를 보지 않는 셈이라 순수 함수로 내려왔다 — 최대화 판정(`zoomOf`)은 특히
 * 그물이라(아래 설명) 값으로 고정해 둘 값이 있었다.
 */

import { computeLayout, FULL_RECT, type Rect } from "$lib/layout";
import { listPanes, paneOrder, type PaneSpec, type TabSpec } from "$lib/session";
import { ORCH_CANVAS } from "$lib/orchestration/orch-tab";

/**
 * 그 탭의 타일 캔버스 — 보통은 탭 본문 전체, **오케스트레이션 탭은 아래 재생 막대 띠를 뺀 사각형**(2026-10-29 — 띠는 타일이 아니라
 * `PaneHost` 가 그 자리에 그린다). 상자 · 분할선 · 최대화가 모두 이 값을 뿌리로 쓴다.
 */
export function tabCanvas(tab: Pick<TabSpec, "orch">): Rect {
  return tab.orch ? ORCH_CANVAS : FULL_RECT;
}

export interface HostBox {
  tab: TabSpec;
  pane: PaneSpec;
  rect: Rect;
  /**
   * 소속 탭의 패널 수 — 1개면 **활성 테두리**를 그리지 않는다 (비교할 형제가 없다).
   * 헤더는 이제 이 값만 보지 않는다: `[app] tile_header` 가 `multi` 일 때만 여기에 걸린다.
   */
  paneCount: number;
  /** 활성 탭의 (최대화에 가려지지 않은) 타일인가 — 포커스·활동 판정이 이 값을 본다 */
  visible: boolean;
  /**
   * **화면에 그려지는가** — `visible` 에 더해, 탭 전환 슬라이드로 **빠져나가는 중인 탭**의 타일도
   * 참이다 (docs/log/2026-09-29-tab-slide.md). 거짓이면 `display:none`.
   */
  shown: boolean;
  focused: boolean;
  /** 이 타일이 지금 **최대화되어** 캔버스를 통째로 쓰고 있는가 (헤더 표식이 이 값을 본다) */
  zoomed: boolean;
}

/**
 * 이 탭에서 **실제로 최대화 중인** 잎 id, 아니면 `null`
 * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
 *
 * `tab.zoomedPaneId` 를 그대로 믿지 않고 한 번 거르는 이유는 **그물**이다: 그 잎이 다른
 * 탭으로 옮겨졌거나 닫혔거나, 형제가 전부 닫혀 타일이 하나만 남았으면 최대화는
 * 뜻이 없다 (하나뿐인 타일은 이미 화면 전체다). `+page` 가 구조 조작마다 최대화를
 * 풀지만(그쪽이 본길이다), 새 조작이 그 호출을 빠뜨려도 화면이 이상해지지는 않게 판정을
 * 그리는 자리에도 한 겹 둔다.
 */
export function zoomOf(tab: TabSpec): string | null {
  const id = tab.zoomedPaneId ?? null;
  if (id === null) return null;
  const panes = listPanes(tab.root);
  if (panes.length < 2) return null;
  return panes.some((p) => p.id === id) ? id : null;
}

/**
 * 전 탭의 전 패널. **정렬 키는 탭 순서가 아니라 패널 생성 순번**이다 — 그래야 탭 순서
 * 변경·탭 간 이동에서 keyed each 가 살아 있는 노드를 옮길 일조차 없다 (`paneOrder` 주석
 * 참고). 패널은 전부 절대배치라 DOM 순서는 화면과 무관하다.
 *
 * 최대화 중이면 **그 타일만** 캔버스 전체 사각형으로, 나머지는 숨긴다. 숨김은 비활성
 * 탭과 **완전히 같은 길**(`visible:false` → `display:none`)이라 인스턴스가 살아
 * 있고 세션도 스크롤백도 그대로다 — 되돌리면 원래 사각형으로 미끄러져 돌아온다.
 */
export function hostBoxes(
  tabs: readonly TabSpec[],
  activeId: string | null,
  focusedPaneOf: (tab: TabSpec) => string,
  /** 탭 전환 슬라이드로 빠져나가는 중인 탭 — 그 탭의 타일도 그려 둔다 (`shown`) */
  leavingId: string | null = null,
  /**
   * **타일 하나만**(원격 웹 R5 — 원격 창의 모바일 배치). 탭마다 포커스 타일을 최대화처럼 캔버스 전체에 그리고 나머지는 숨긴다 —
   * 트리(거울)는 그대로, 보여 주는 것만 하나다. 헤더의 최대화 표식(`zoomed`)은 진짜 최대화에만 선다.
   */
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
