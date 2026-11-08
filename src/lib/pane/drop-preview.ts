/**
 * 분할 드롭의 **미리 접힌 기하** — 실제 삽입과 같은 원시 연산을 쓰는 순수 모듈.
 *
 * 반쪽 사각형을 따로 계산하면 거터·분할 비율이 커밋과 어긋난다. 그래서 내부 고스트 잎을
 * `insertSubtree` 로 끼운 뒤 `computeLayout` 으로 편다. 밖으로 나가는 것은 사각형뿐이고,
 * 고스트 명세·id 는 이 파일 안에 남는다. 같은 탭의 이동도 원래 잎은 빼지 않는다 —
 * 미리보기는 대상 쪽만 접고, source 를 거두는 일은 실제 이동의 몫이다.
 */
import { computeLayout, type Rect } from "$lib/layout";
import { insertSubtree, type PaneNode, type PaneSide, type PaneSpec, type SplitDir } from "$lib/session";

// 실제 타일 id(pane-N)와 겹치지 않는 내부 센티널. 세션도 생성자 카운터도 쓰지 않는다.
const GHOST: PaneSpec = { id: "\0drop-preview", kind: "start" };

export interface DropPreview {
  rects: Map<string, Rect>;
  ghost: Rect;
}

/** 대상을 못 찾으면 null. 입력 트리와 패널 명세는 그대로 둔다. */
export function dropPreview(
  root: PaneNode,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
): DropPreview | null {
  const inserted = insertSubtree(root, targetPaneId, dir, { type: "leaf", pane: GHOST }, side);
  if (inserted === root) return null;
  const rects = new Map<string, Rect>();
  let ghost: Rect | null = null;
  for (const box of computeLayout(inserted).panes) {
    if (box.pane === GHOST) ghost = box.rect;
    else rects.set(box.pane.id, box.rect);
  }
  return ghost === null ? null : { rects, ghost };
}
