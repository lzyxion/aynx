import { isNarrowOutline } from "$lib/doc-outline";

/**
 * **문서 타일 양옆 곁 패널의 폭 규칙** — 순수 모듈(2026-11-19). 왼쪽 = 파일, 오른쪽 = 목차.
 *
 * - [`docPanelLayout`] — 타일 폭 · 켬 값 · 목차 준비 · 나중에 연 쪽 → 무엇이 패널로 보이나 · 본문 폭.
 * - [`panelToCloseOnOpen`] — 토글로 **열 때** 둘이 함께 설 폭이 없으면 먼저 열려 있던 쪽을 명세에서도 끈다.
 *
 * 패널 ↔ 드롭다운 문턱은 목차의 것(`doc-outline.ts` 의 [`isNarrowOutline`] · 640px) 하나를 두 패널이 같이 쓴다.
 * 창을 줄여 문턱 밑으로 간 것은 보이기만 숨긴다(켬 값은 그대로 — 넓히면 돌아온다). `DocView` 가 쓴다.
 */

/** 파일 곁 패널 폭(px) */
export const DOC_FILES_PANEL_W = 240;
/** 목차 곁 패널 폭(px) — 옛 `pane/head-span.ts` 의 `OUTLINE_PANEL_W` 와 같은 값 */
export const DOC_OUTLINE_PANEL_W = 240;
/** 패널과 본문 사이 경계선 폭(px) */
export const DOC_PANEL_LINE_W = 1;
/** 두 패널을 함께 세울 때 본문이 지킬 최소 폭(px) */
export const DOC_BODY_MIN_W = 400;
/** 두 패널이 함께 서는 가장 좁은 타일 폭 — 240 + 1 + 240 + 1 + 400 = 882 */
export const DOC_BOTH_PANELS_MIN_PX =
  DOC_FILES_PANEL_W + DOC_PANEL_LINE_W + DOC_OUTLINE_PANEL_W + DOC_PANEL_LINE_W + DOC_BODY_MIN_W;

/** 곁 패널 하나 */
export type DocSidePanel = "files" | "outline";

export interface DocPanelLayoutInput {
  /** 타일 폭(px) — 못 쟀으면 0 */
  width: number;
  /** 파일 켬(`PaneSpec.docFiles`) */
  files: boolean;
  /** 목차 켬(`PaneSpec.docOutline`) */
  outline: boolean;
  /** 목차가 설 수 있나(그린 마크다운에 제목이 있다 — `oc.hasOutline`) */
  outlineReady: boolean;
  /** 나중에 연 쪽 — `DocView` 의 한때 값(저장 안 함). 모르면 `null` */
  last: DocSidePanel | null;
}

export interface DocPanelLayout {
  /** 좁은 타일 — 두 패널 모두 드롭다운 단추가 된다 */
  narrow: boolean;
  filesShown: boolean;
  outlineShown: boolean;
  /** 타일 폭에서 보이는 패널 폭과 경계선을 뺀 본문 폭 — 못 쟀으면 0 */
  bodyW: number;
}

/**
 * 무엇이 패널로 보이나.
 *
 * - 못 쟀으면(0) 넓은 쪽으로 본다(켬 값 그대로 · `bodyW` 0).
 * - 640 미만(`isNarrowOutline`)이면 둘 다 패널이 아니다(켬 값은 그대로 — 드롭다운 단추가 된다).
 * - 목차는 켰고 **준비됐을 때만** 선다.
 * - 둘 다 서야 하는데 [`DOC_BOTH_PANELS_MIN_PX`] 미만이면 `last` 쪽만 — `last` 를 모르면 파일.
 */
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
  /** 타일 폭(px) — 못 쟀으면 0 */
  width: number;
  /** 지금 토글로 여는 쪽 */
  opening: DocSidePanel;
  /** 여는 순간의 켬 값(여는 쪽은 아직 꺼져 있다) */
  files: boolean;
  outline: boolean;
  /** 목차가 설 수 있나 */
  outlineReady: boolean;
}

/**
 * 토글로 **열 때** 명세에서도 끌 다른 쪽(규칙 5 — 나중에 연 쪽만 남긴다). 끌 것이 없으면 `null`.
 *
 * | 경우 | 결과 |
 * | --- | --- |
 * | 못 잰 폭(0) · 좁은 타일(640 미만 — 단추가 드롭다운) | `null` |
 * | 다른 쪽이 꺼져 있음 · 목차가 준비되지 않음(어느 쪽을 열든 목차는 자리를 차지하지 않는다) | `null` |
 * | 폭 ≥ [`DOC_BOTH_PANELS_MIN_PX`] | `null` |
 * | 그 밖(둘이 함께 설 폭이 없다) | 다른 쪽 |
 *
 * 창을 줄여서 문턱 밑으로 간 것은 여기를 지나지 않는다 — [`docPanelLayout`] 이 보이기만 숨긴다.
 */
export function panelToCloseOnOpen(i: PanelOpenInput): DocSidePanel | null {
  if (i.width <= 0 || isNarrowOutline(i.width)) return null;
  if (!i.outlineReady) return null;
  const other: DocSidePanel = i.opening === "files" ? "outline" : "files";
  const otherOn = other === "files" ? i.files : i.outline;
  if (!otherOn) return null;
  return i.width < DOC_BOTH_PANELS_MIN_PX ? other : null;
}
