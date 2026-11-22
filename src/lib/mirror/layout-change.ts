// 원격 창이 거울 스냅숏을 끼울 때 배치 애니메이션을 켤지 — 메인 PC 의 구조 조작(`app/tabs` 의 `withLayoutAnim` 을 지나는 것)과 짝을 맞춘다. 순수 모듈.
// 비율 · 포커스 · 제목만 바뀐 스냅숏은 켜지 않는다 — 메인 PC 도 분할선 끌기 · 키보드 크기 조절에는 문을 열지 않는다.

import type { PaneNode, PaneSpec, TabSpec } from "$lib/session/spec";

export interface MirrorLayoutChange {
  animate: boolean;
  /** 유령을 띄울 닫힌 타일 — 닫기가 하나로 짚일 때만 */
  closed: string | null;
  /** 문서 → 문서로 갈아 끼운 새 타일 id — 메인 PC 처럼 틀은 뚝 서고 본문만 떠오른다(`doc-swap.ts`) */
  docSwaps: string[];
}

const NONE: MirrorLayoutChange = { animate: false, closed: null, docSwaps: [] };

/** 분할 방향과 중첩만 — `ratio` · `px` 는 끌기로 바뀌므로 뺀다 */
function shapeOf(node: PaneNode): string {
  return node.type === "leaf" ? "L" : `${node.dir}(${shapeOf(node.a)},${shapeOf(node.b)})`;
}

function leavesOf(node: PaneNode, out: PaneSpec[] = []): PaneSpec[] {
  if (node.type === "leaf") out.push(node.pane);
  else {
    leavesOf(node.a, out);
    leavesOf(node.b, out);
  }
  return out;
}

function allIds(tabs: readonly TabSpec[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) for (const p of leavesOf(tab.root)) ids.add(p.id);
  return ids;
}

const isLoneStart = (tab: TabSpec): boolean => tab.root.type === "leaf" && tab.root.pane.kind === "start";

export function mirrorLayoutChange(prev: readonly TabSpec[], next: readonly TabSpec[]): MirrorLayoutChange {
  if (prev.length === 0) return NONE;
  const prevIds = allIds(prev);
  const nextIds = allIds(next);
  const prevById = new Map(prev.map((tab) => [tab.id, tab]));
  let animate = false;
  const closing: string[] = [];
  const docSwaps: string[] = [];
  for (const tab of next) {
    const old = prevById.get(tab.id);
    if (!old) {
      if (!isLoneStart(tab)) animate = true;
      continue;
    }
    if ((old.zoomedPaneId ?? null) !== (tab.zoomedPaneId ?? null)) animate = true;
    const was = leavesOf(old.root);
    const now = leavesOf(tab.root);
    if (shapeOf(old.root) === shapeOf(tab.root) && was.length === now.length) {
      for (let i = 0; i < now.length; i++) {
        const a = was[i];
        const b = now[i];
        if (a.id === b.id) continue;
        if (a.kind === "doc" && b.kind === "doc" && !prevIds.has(b.id) && !nextIds.has(a.id)) docSwaps.push(b.id);
        else animate = true;
      }
      continue;
    }
    animate = true;
    const gone = was.filter((p) => !nextIds.has(p.id));
    const fresh = now.filter((p) => !prevIds.has(p.id));
    if (gone.length === 1 && fresh.length === 0) closing.push(gone[0].id);
  }
  return { animate, closed: closing.length === 1 ? closing[0] : null, docSwaps };
}
