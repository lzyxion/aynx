// 타일 머리줄에 얹는 도구줄 — 타일이 스니펫으로 맡기고, 머리줄이 없으면(`[app] tile_header` 끔 · 폰) 타일이 제 몸 맨 위에 그린다.
//
// 표시 규칙 `data-head-act`: 조작 요소에 달면 포커스 밖 타일에서 숨고 자리도 접는다(표시 없는 요소는 상태 · 정체로 늘 보인다).
// - 그 요소를 담은 줄의 `gap` 을 `--head-act-gap` 으로 같은 줄에 적는다 — 상속되니 간격이 다른 안쪽 줄은 다시 적는다(`LocationBar` 의 `.loc` = 0).
// - `lead` 는 통째로 조작 칸이지만 아이콘 · 이름 앞이라 접지 않고 자리를 쥔 채 흐려진다(접으면 정체가 옆으로 미끄러진다).
// - 머리줄 안(`inHead`)에서만 뜻이 있다.
// 쓰기는 `untrack` — 두 표 모두 `$effect` 안에서 등록하므로 제가 쓴 표를 읽어 스스로를 다시 돌리지 않게(`app/doc-dirty.svelte.ts` 와 같은 함정).

import { untrack, type Snippet } from "svelte";
import type { PaneMenuItem } from "$lib/pane/pane-menu";

export interface PaneTools {
  /** 인자 = 머리줄 안에서 그리는가 */
  bar: Snippet<[boolean]>;
  lead?: Snippet;
  /** 이름 묶음 바로 뒤 — 패널을 여닫아도 이 자리 그대로다 */
  tail?: Snippet;
  /**
   * 왼쪽 무리가 머리줄 왼쪽 끝부터 이 px 까지 차지한다(`pane/head-span.ts`) — 머리줄과 몸은 같은 상자 안에 `left: 0` 으로 서서 몸 안 x 를 그대로 준다.
   * 지금 쓰는 곳은 파일 타일 하나다. 등록을 다시 하지 않게 함수로 준다.
   */
  span?: () => number | null;
  /** 글자를 주면 타일 아이콘 대신 회전 고리가 선다 */
  iconBusy?: () => string | null;
  /** 좁으면 이름이 먼저 준다(기본은 도구 칸이 먼저) — 문서 타일의 [저장] 이 잘리지 않게 */
  keepBar?: boolean;
  /** 파일 타일: 빵부스러기 경로가 곧 이름이다 */
  replaceName?: boolean;
  hideIcon?: boolean;
  nameTip?: () => string | null;
  /** ⋯ 메뉴 맨 위에 얹을 줄 — 액션은 `tool:<열쇠>` 이고 [`run`] 이 그 열쇠로 불린다(`runTileMenu` → `runOnMenu` 통로) */
  menu?: () => PaneMenuItem[];
  /** ⋯ 메뉴 [경로 복사] 바로 위 — 머리줄이 서 있을 때만 얹힌다 */
  fileMenu?: () => PaneMenuItem[];
  run?: (key: string) => void;
}

export const TOOL_ACTION_PREFIX = "tool:";

let tools = $state.raw<ReadonlyMap<string, PaneTools>>(new Map());
let heads = $state.raw<ReadonlySet<string>>(new Set());

export function paneToolsOf(paneId: string): PaneTools | null {
  return tools.get(paneId) ?? null;
}

/** 푸는 함수는 같은 것이 아직 맡겨져 있을 때만 지운다 — 재마운트 순서가 뒤집혀도 새 것을 지우지 않게 */
export function setPaneTools(paneId: string, value: PaneTools): () => void {
  untrack(() => {
    const next = new Map(tools);
    next.set(paneId, value);
    tools = next;
  });
  return () =>
    untrack(() => {
      if (tools.get(paneId) !== value) return;
      const next = new Map(tools);
      next.delete(paneId);
      tools = next;
    });
}

export function paneHeadShown(paneId: string): boolean {
  return heads.has(paneId);
}

export function markPaneHead(paneId: string): () => void {
  untrack(() => {
    if (heads.has(paneId)) return;
    const next = new Set(heads);
    next.add(paneId);
    heads = next;
  });
  return () =>
    untrack(() => {
      if (!heads.has(paneId)) return;
      const next = new Set(heads);
      next.delete(paneId);
      heads = next;
    });
}
