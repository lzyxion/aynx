import { isNarrowOutline } from "$lib/doc-outline";

/**
 * 문서 타일 양옆 곁 패널의 폭 규칙(순수). 패널 ↔ 드롭다운 문턱은 목차의 [`isNarrowOutline`] 하나를 두 패널이 같이 쓴다.
 * 창을 줄여 문턱 밑으로 간 것은 보이기만 숨긴다 — 켬 값은 그대로라 넓히면 돌아온다.
 */

export const DOC_FILES_PANEL_W = 240;
export const DOC_OUTLINE_PANEL_W = 240;
export const DOC_PANEL_LINE_W = 1;
export const DOC_BODY_MIN_W = 400;
export const DOC_BOTH_PANELS_MIN_PX =
  DOC_FILES_PANEL_W + DOC_PANEL_LINE_W + DOC_OUTLINE_PANEL_W + DOC_PANEL_LINE_W + DOC_BODY_MIN_W;

export type DocSidePanel = "files" | "outline";

export interface DocPanelLayoutInput {
  /** 못 쟀으면 0 */
  width: number;
  files: boolean;
  outline: boolean;
  outlineReady: boolean;
  /** 나중에 연 쪽 — 저장 안 함 */
  last: DocSidePanel | null;
}

export interface DocPanelLayout {
  narrow: boolean;
  filesShown: boolean;
  outlineShown: boolean;
  bodyW: number;
}

/** 둘 다 서야 하는데 폭이 모자라면 `last` 쪽만 — 모르면 파일 */
export function docPanelLayout(i: DocPanelLayoutInput): DocPanelLayout {
  const narrow = isNarrowOutline(i.width);
  if (narrow) return { narrow, filesShown: false, outlineShown: false, bodyW: i.width };
  let filesShown = i.files;
  let outlineShown = i.outline && i.outlineReady;
  if (filesShown && outlineShown && i.width > 0 && i.width < DOC_BOTH_PANELS_MIN_PX) {
    if (i.last === "outline") filesShown = false;
    else outlineShown = false;
  }
  if (i.width <= 0) return { narrow, filesShown, outlineShown, bodyW: 0 };
  const used =
    (filesShown ? DOC_FILES_PANEL_W + DOC_PANEL_LINE_W : 0) + (outlineShown ? DOC_OUTLINE_PANEL_W + DOC_PANEL_LINE_W : 0);
  return { narrow, filesShown, outlineShown, bodyW: Math.max(0, i.width - used) };
}

export interface PanelOpenInput {
  width: number;
  opening: DocSidePanel;
  /** 여는 순간의 켬 값(여는 쪽은 아직 꺼져 있다) */
  files: boolean;
  outline: boolean;
  outlineReady: boolean;
}

/** 토글로 열 때 둘이 함께 설 폭이 없으면 먼저 열려 있던 쪽을 명세에서도 끈다. 창을 줄인 것은 여기를 지나지 않는다 */
export function panelToCloseOnOpen(i: PanelOpenInput): DocSidePanel | null {
  if (i.width <= 0 || isNarrowOutline(i.width)) return null;
  if (!i.outlineReady) return null;
  const other: DocSidePanel = i.opening === "files" ? "outline" : "files";
  const otherOn = other === "files" ? i.files : i.outline;
  if (!otherOn) return null;
  return i.width < DOC_BOTH_PANELS_MIN_PX ? other : null;
}
