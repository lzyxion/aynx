// 타일 머리줄의 **왼쪽 무리 폭**(2026-10-20 — 타일 머리줄 ④판, 목업 SJgp6bQEPiRYkBCvjy3NuL `DbTile`).
//
// 몸의 **왼쪽 곁 패널**(쿼리 타일의 스키마 사이드바 · 문서 타일의 목차 패널)이 열려 있으면 머리줄의 왼쪽 무리(로고 · 이름 · 패널 토글)가
// 정확히 그 패널 폭을 차지하고 토글은 그 오른쪽 끝, 나머지 도구(쿼리 탭 · 문서 도구)는 본문 열 위에서 시작한다. 머리줄과 몸은 같은 타일
// 상자 안에 `left: 0` 으로 서므로(`PaneHost` 의 `.pane-head` · `.pane-body`) 본문 열의 x = 패널 폭 + 경계선이다 — 그 값을 머리줄에
// `span` 으로 준다(`pane/pane-tools.svelte.ts`). 머리줄 왼쪽 여백 · 무리 뒤 간격은 머리줄이 CSS 로 뺀다(`PaneHeader` 의 `.pane-group.spanned`).
//
// 파일 타일도 같은 규칙이다 — 장소 패널이 펼쳐져 있으면 맨 앞 조각(뒤로/앞으로 · 보기 고르개)이 그 폭을 차지하고 경로 칸이 목록 열 위에서
// 시작한다(`filePlacesLayout`).
//
// 세 패널 모두 본문의 **왼쪽**이다 — 오른쪽 패널이 생기면 이 규칙(왼쪽 끝부터 경계까지)을 그대로 쓰지 말고 따로 정한다.
//
// Svelte 를 import 하지 않는다 — vitest 대상이다.

/**
 * 왼쪽 곁 패널 경계에 맞춘 무리 끝 x(타일 몸 왼쪽 끝 기준 px) — 패널이 닫혀 있으면 `null`(무리는 제 폭까지 — 토글은 이름 바로 뒤).
 * 끌어서 생긴 소수 폭은 반올림한다.
 */
export function sideHeadSpan(o: { open: boolean; panelW: number; lineW: number }): number | null {
  if (!o.open) return null;
  return Math.round(o.panelW) + o.lineW;
}

// ── 쿼리 타일 — 스키마 사이드바 ────────────────────────────────────────────────

/**
 * 넓음 ↔ 좁음의 경계 타일 폭(문서 타일의 640 과 같은 결의 한 상수) — 이보다 좁으면 사이드바는 사람이 열어 두었든 아니든 **늘 접히고**,
 * 머리줄의 토글은 스키마 트리를 떠 있는 패널(드롭다운)로 연다(`QueryView` 의 `treeDrop`). 넓으면 자동(사람이 토글을 누른 적 없음)은 편다.
 */
export const TREE_AUTO_MIN_WIDTH = 560;

/** 사이드바와 작업 칸 사이 경계선 폭(`QueryView` 의 `.vsplit`) */
export const TREE_SPLIT_W = 1;

/** 사이드바가 열려 있어도 편집기 열에 남기는 폭 — 넓은 타일에서 원하는 폭(`treeW`)이 너무 크면 상자는 이만큼을 비우는 데서 멈춘다 */
export const TREE_WORK_MIN_W = 160;

/** 사이드바 상자의 하한(끌기 · 화살표가 내려가는 끝과 같은 값) */
export const TREE_MIN_W = 140;

/** 좁은 타일의 떠 있는 스키마 트리 패널 폭 */
export const TREE_DROP_W = 280;

/** 좁은 타일인가 — 폭을 아직 못 쟀으면(0) 넓은 쪽으로 본다(문서 목차의 `isNarrowOutline` 과 같은 규칙) */
export function isNarrowTree(width: number): boolean {
  return width > 0 && width < TREE_AUTO_MIN_WIDTH;
}

/**
 * 쿼리 타일 사이드바의 **실제로 그려지는 상자** — 몸(`.side` 의 폭 · 경계선)과 머리줄(`span`)이 이 한 값에서 나온다(10-20 실기: 둘이 따로
 * 판정해 트리가 사라지는 순간과 머리줄 무리가 접히는 순간이 어긋났다).
 *
 * - `narrow` — `isNarrowTree(width)`. 참이면 사이드바 없음(`shown` 거짓 · `span` null) — 토글은 떠 있는 패널을 연다. 사람이 고른 값
 *   (`treeOpen`)은 지우지 않으므로 넓어지면 그 기억대로 다시 선다(10-20 사용자 — 좁을 때 상자를 줄이던 동작은 걷었다).
 * - `shown` — 넓으면 사람이 고른 값, 안 골랐으면 폈다. 폭을 아직 못 쟀으면(0) 자동은 접힘 · 고른 값은 그대로.
 * - `boxW` — 사이드바 상자 폭(px, 정수) = 원하는 폭(`treeW` — 끌기 · 화살표). 넓은 타일에서도 편집기 열에 `TREE_WORK_MIN_W` 는 남긴다
 *   (`TREE_MIN_W` 아래로는 줄이지 않는다 — 경계 폭 560 에서 그 상한은 399 라 하한에 닿지 않는다). 폭을 못 쟀으면 원하는 폭 그대로.
 * - `span` — 머리줄 왼쪽 무리가 끝나는 x(= 상자 폭 + 경계선, 쿼리 탭이 여기서 시작). 사이드바가 없으면 `null`.
 */
export function queryTreeLayout(o: { treeOpen: boolean | null; width: number; treeW: number }): {
  narrow: boolean;
  shown: boolean;
  boxW: number;
  span: number | null;
} {
  const narrow = isNarrowTree(o.width);
  const shown = !narrow && (o.treeOpen ?? o.width >= TREE_AUTO_MIN_WIDTH);
  if (!shown) return { narrow, shown: false, boxW: 0, span: null };
  const want = Math.round(o.treeW);
  const boxW = o.width > 0 ? Math.min(want, Math.max(TREE_MIN_W, o.width - TREE_SPLIT_W - TREE_WORK_MIN_W)) : want;
  return { narrow, shown, boxW, span: sideHeadSpan({ open: true, panelW: boxW, lineW: TREE_SPLIT_W }) };
}

// ── 문서 타일 — 목차 곁 패널 ──────────────────────────────────────────────────

/** 목차 곁 패널 폭(`DocView` 의 `.outline-panel` — 이 값을 인라인으로 받는다) */
export const OUTLINE_PANEL_W = 240;

/** 목차 패널의 오른쪽 경계선(`.outline-panel` 의 `border-right` — 상자 폭 밖에 붙는다) */
export const OUTLINE_LINE_W = 1;

/**
 * 문서 타일 머리줄 왼쪽 무리가 끝나는 x — 문서 도구줄이 본문 열 위에서 시작한다. `panelOpen` 은 `DocView` 의 것
 * (켬 · 제목 있음 · 넓은 타일 — 좁은 타일은 목차 드롭다운이라 패널이 없다). 닫혀 있으면 `null`.
 * 패널을 그리는 조건(`{#if panelOpen}`)과 같은 값 하나에서 나오고, 패널은 줄지 않는 고정 폭(`flex: 0 0`)이며 넓은 판정의 하한(640)이
 * 패널 폭보다 넉넉해 그려진 상자 = `OUTLINE_PANEL_W` 다 — 쿼리 타일처럼 따로 잴 것이 없다.
 */
export function docHeadSpan(panelOpen: boolean): number | null {
  return sideHeadSpan({ open: panelOpen, panelW: OUTLINE_PANEL_W, lineW: OUTLINE_LINE_W });
}

// ── 파일 타일 — 장소 패널 · 경로 칸 · 접히는 단추 ─────────────────────────────────
//
// 타일을 좁힐 때 **경로 칸이 최대한 보이도록** 줄어드는 순서(2026-10-20 사용자):
//
//   ① 넓음 — 경로 칸이 장소 패널 경계(목록 열 위)에서 시작한다(`span`).
//   ② **목록의 "권한" 칸이 숨는 순간**(그려진 목록 칸 폭 < `FILE_LIST_MODE_MIN_W` — `FileList` 의 `@container file-list`)에 **먼저 경계 맞춤을
//      푼다** — 경로 칸이 왼쪽 무리(‹ › ▦▾) 바로 뒤로 붙어 그만큼 폭을 얻는다(10-20 사용자 — 목록이 좁아지는 첫 신호와 한 순간). 목록 폭이라
//      미리 보기 패널(F11)이 열려 있으면 그만큼 일찍 풀린다.
//   ③ 그다음 장소 패널이 아이콘만으로 접히고, ④ **같은 순간** 새 폴더 · 업로드도 ⋯ 로 접힌다(찾기는 남는다 — 10-20 사용자 "사이드 탭이 접힐 때
//      오른쪽 단추도 같이"). 그 폭에서도 경로 칸은 최소 몫(`FILE_PATH_MIN_W`) 이상 남는다.
//   ⑤ 마지막에 장소 패널이 사라진다.
//
// 문턱은 아래 폭 상수에서 **계산**한다(상수 하나를 고치면 문턱이 따라 움직이고, 시험이 순서를 지킨다). 폭은 **CSS 값으로 셈한 것**이다
// (앱을 띄워 잰 실측이 아니다 — 2026-10-20):
//
// - 머리줄 왼쪽 여백 12(`.pane-head` 의 `--space-3`) · 칸 사이 간격 8(`--space-2`) · 오른쪽 여백 4(`--space-1`)
// - 왼쪽 무리 94 = 뒤로/앞으로 54(`.bar-btn` 26 × 2 + 간격 2) + 4 + 보기 고르개 36(여백 10 + 테 2 + 그림 13 + 1 + 꺾쇠 10)
// - 접히는 단추 60 = 앞 간격 4 + 26 + 4 + 26 · 늘 서는 찾기 30 = 4 + 26
// - `⋯ ⤢ ✕` 100 = (간격 8 + 24) × 3 + 오른쪽 여백 4
//
// 머리줄이 없을 때(몸 위 줄 — 여백 6 · 간격 4 · 제 ⋯ 26)는 경로 칸이 머리줄보다 조금 넓게 남는다 — 같은 문턱을 그대로 써서 순서만 같게 둔다.

/** 장소 패널의 펼친 폭(`PlacesPanel` 이 인라인으로 받는다 — 머리줄 무리 폭과 한 값) */
export const PLACES_PANEL_W = 168;

/** 좁은 타일에서 아이콘만 남은 장소 패널의 폭 */
export const PLACES_MINI_W = 40;

/** 장소 패널과 목록 사이 경계 — 선이 아니라 옅은 면 차이라(`PlacesPanel` 의 `.places` 배경) 폭이 없다 */
export const PLACES_LINE_W = 0;

/** 경로 칸의 최소 몫(정렬을 푼 뒤) — 이보다 좁아지려 하면 단추를 접는다(④). 정렬 해제(②)는 목록 칸 폭이 정한다 */
export const FILE_PATH_MIN_W = 240;

/** 머리줄 왼쪽 끝 ~ 경로 칸 시작(정렬을 풀었을 때) = 왼쪽 여백 12 + 왼쪽 무리 94 + 간격 8 */
export const FILE_HEAD_LEAD_END = 12 + 94 + 8;

/** 접히는 단추 무리(새 폴더 · 업로드 — 앞 간격 포함) */
export const FILE_FOLD_TOOLS_W = 60;

/** 경로 칸 오른쪽에 늘 남는 몫 = 찾기 30 + `⋯ ⤢ ✕` 100 */
export const FILE_HEAD_RIGHT_W = 30 + 100;

/**
 * ② 목록 칸(`FileList` 의 `.list` — 컨테이너 `file-list`, 안쪽 여백 · 스크롤 막대를 뺀 내용 폭)이 이보다 좁으면 "권한" 칸이 숨고 경계 맞춤도 풀린다.
 * CSS 컨테이너 쿼리는 상수를 못 읽으므로 `FileList.svelte` 의 `@container file-list (max-width: 479px)` 와 **같은 값**임을 시험이 소스를 읽어 묶는다.
 */
export const FILE_LIST_MODE_MIN_W = 480;

/** ③ 이보다 좁은 타일이면 장소 패널은 아이콘만 */
export const PLACES_FULL_MIN_WIDTH = 560;

/**
 * ④ 이보다 좁은 타일이면 새 폴더 · 업로드를 ⋯ 로 — **장소 패널이 아이콘만으로 접히는 순간과 같다**(10-20 사용자 — "사이드 탭이 접힐 때 오른쪽 단추도 같이").
 * 그 폭에서도 경로 칸은 최소 몫(`FILE_PATH_MIN_W`) 이상 남는다(시험이 지킨다 — 단추를 다 세운 폭 544 보다 넓다)
 */
export const FILE_FOLD_MIN_WIDTH = PLACES_FULL_MIN_WIDTH;

/** ⑤ 이보다 좁은 타일이면 장소 패널은 그리지 않는다(켜 둔 상태는 그대로라 넓히면 돌아온다) */
export const PLACES_SHOWN_MIN_WIDTH = 400;

/**
 * 파일 타일의 **좁힘 판정 하나** — 몸(`PlacesPanel` 의 폭 · 아이콘만) · 머리줄(`span`) · 도구줄(접힘)이 이 한 값에서 나온다
 * (쿼리 타일 `queryTreeLayout` 과 같은 교훈 — 몸이 CSS 컨테이너 쿼리로, 머리줄이 JS 로 따로 판정하면 접히는 순간이 어긋난다). 순서는 위 절.
 *
 * - `mode` — `"none"`(끔(`F9` · `PaneSpec.filePlaces`) 또는 타일 폭 < 400) · `"mini"`(< 560 — 아이콘만) · `"full"`. 패널 폭은 사람이 끌 수 없다.
 * - `boxW` — 패널 상자 폭(px). 없으면 0.
 * - `span` — 머리줄 왼쪽 무리가 끝나는 x(경로 칸이 목록 열 위에서 시작) — 펼친 패널 · 목록 칸 폭(`listW` — 그려진 값) ≥ `FILE_LIST_MODE_MIN_W`
 *   일 때만. 아니면 `null`. 목록 폭은 머리줄과 무관해(머리줄은 몸 밖) 정렬이 바뀌어도 되먹지 않는다.
 * - `fold` — 새 폴더 · 업로드를 ⋯ 로 접는가(타일 폭 < `FILE_FOLD_MIN_WIDTH` — 패널 켬끔과 무관).
 * - `foldOver` — 타일 폭 − 접는 폭. 접힌 뒤 빈칸이 1:1 로 닳는 식(`browser/toolbar-tools` 의 `foldSpacer`)의 몫이다.
 *
 * 폭을 아직 못 쟀으면(0) 넓은 쪽으로 본다(`isNarrowTree` 와 같은 규칙).
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
