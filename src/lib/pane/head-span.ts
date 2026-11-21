// 타일 머리줄의 왼쪽 무리 폭 — 지금 쓰는 곳은 파일 타일의 장소 패널 하나다(경로 칸이 목록 열 위에서 시작).
// 쿼리 · 문서 타일은 이 규칙을 쓰지 않는다 — 문서의 오른쪽 곁 패널(목차)은 대칭으로 만들 수 없어 토글은 고정 자리이고 가운데 도구줄은 늘 왼쪽 무리 바로 뒤에서 시작한다.
// Svelte 를 import 하지 않는다 — vitest 대상이다.

/** 패널이 닫혀 있으면 `null` */
export function sideHeadSpan(o: { open: boolean; panelW: number; lineW: number }): number | null {
  if (!o.open) return null;
  return Math.round(o.panelW) + o.lineW;
}

// ── 쿼리 타일 — 스키마 사이드바 ──

/** 이보다 좁으면 사이드바는 늘 접히고 토글은 떠 있는 패널로 연다 */
export const TREE_AUTO_MIN_WIDTH = 560;

/** `QueryView` 의 `.vsplit` 폭 */
export const TREE_SPLIT_W = 1;

export const TREE_WORK_MIN_W = 160;

export const TREE_MIN_W = 140;

export const TREE_DROP_W = 280;

/** 폭을 아직 못 쟀으면(0) 넓은 쪽으로 본다 */
export function isNarrowTree(width: number): boolean {
  return width > 0 && width < TREE_AUTO_MIN_WIDTH;
}

/**
 * 몸과 토글 모양이 이 한 값에서 나와야 한다 — 따로 판정하면 트리가 사라지는 순간과 머리줄이 접히는 순간이 어긋난다.
 * 좁아도 사람이 고른 값(`treeOpen`)은 지우지 않아 넓어지면 그대로 다시 선다.
 */
export function queryTreeLayout(o: { treeOpen: boolean | null; width: number; treeW: number }): {
  narrow: boolean;
  shown: boolean;
  boxW: number;
} {
  const narrow = isNarrowTree(o.width);
  const shown = !narrow && (o.treeOpen ?? o.width >= TREE_AUTO_MIN_WIDTH);
  if (!shown) return { narrow, shown: false, boxW: 0 };
  const want = Math.round(o.treeW);
  const boxW = o.width > 0 ? Math.min(want, Math.max(TREE_MIN_W, o.width - TREE_SPLIT_W - TREE_WORK_MIN_W)) : want;
  return { narrow, shown, boxW };
}

// ── 파일 타일 — 장소 패널 · 경로 칸 · 접히는 단추 ──
//
// 좁힐 때 경로 칸이 최대한 보이도록 줄어드는 순서: ① 경계 맞춤(`span`) ② 목록 "권한" 칸이 숨는 순간 맞춤을 푼다
// ③ 장소 패널이 아이콘만 + ④ 같은 순간 새 폴더 · 업로드가 ⋯ 로 ⑤ 장소 패널이 사라진다. 문턱은 아래 폭 상수에서 계산하고 시험이 순서를 지킨다.
// 폭은 CSS 값으로 셈한 것이다(실측이 아니다) — 머리줄의 여백 · 단추 폭을 바꾸면 여기도 고친다.

/** `PlacesPanel` 이 인라인으로 받는다 */
export const PLACES_PANEL_W = 168;

export const PLACES_MINI_W = 40;

/** 선이 아니라 옅은 면 차이라 폭이 없다 */
export const PLACES_LINE_W = 0;

export const FILE_PATH_MIN_W = 240;

/** 왼쪽 여백 12 + 왼쪽 무리 94 + 간격 8 */
export const FILE_HEAD_LEAD_END = 12 + 94 + 8;

export const FILE_FOLD_TOOLS_W = 60;

/** 찾기 30 + `⋯ ⤢ ✕` 100 */
export const FILE_HEAD_RIGHT_W = 30 + 100;

/** `FileList.svelte` 의 `@container file-list (max-width: 479px)` 와 같은 값 — 시험이 소스를 읽어 묶는다 */
export const FILE_LIST_MODE_MIN_W = 480;

export const PLACES_FULL_MIN_WIDTH = 560;

/** 장소 패널이 아이콘만으로 접히는 순간과 같다 */
export const FILE_FOLD_MIN_WIDTH = PLACES_FULL_MIN_WIDTH;

/** 켜 둔 상태는 그대로라 넓히면 돌아온다 */
export const PLACES_SHOWN_MIN_WIDTH = 400;

/**
 * 몸 · 머리줄 · 도구줄이 이 한 값에서 나와야 한다 — 따로 판정하면 접히는 순간이 어긋난다.
 * `span` 은 목록 칸 폭(`listW`)으로 정한다 — 머리줄은 몸 밖이라 되먹지 않는다. 폭을 아직 못 쟀으면(0) 넓은 쪽으로 본다.
 */
export function filePlacesLayout(o: { on: boolean; width: number; listW: number }): {
  mode: "none" | "mini" | "full";
  boxW: number;
  span: number | null;
  fold: boolean;
  foldOver: number;
} {
  const measured = o.width > 0;
  const below = (at: number) => measured && o.width < at;
  const fold = below(FILE_FOLD_MIN_WIDTH);
  const foldOver = measured ? o.width - FILE_FOLD_MIN_WIDTH : 0;
  if (!o.on || below(PLACES_SHOWN_MIN_WIDTH)) return { mode: "none", boxW: 0, span: null, fold, foldOver };
  if (below(PLACES_FULL_MIN_WIDTH)) return { mode: "mini", boxW: PLACES_MINI_W, span: null, fold, foldOver };
  return {
    mode: "full",
    boxW: PLACES_PANEL_W,
    span: o.listW > 0 && o.listW < FILE_LIST_MODE_MIN_W ? null : sideHeadSpan({ open: true, panelW: PLACES_PANEL_W, lineW: PLACES_LINE_W }),
    fold,
    foldOver,
  };
}
