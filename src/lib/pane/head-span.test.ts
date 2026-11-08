import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  docHeadSpan,
  FILE_FOLD_MIN_WIDTH,
  FILE_FOLD_TOOLS_W,
  FILE_HEAD_LEAD_END,
  FILE_HEAD_RIGHT_W,
  FILE_LIST_MODE_MIN_W,
  FILE_PATH_MIN_W,
  filePlacesLayout,
  isNarrowTree,
  OUTLINE_LINE_W,
  OUTLINE_PANEL_W,
  PLACES_FULL_MIN_WIDTH,
  PLACES_LINE_W,
  PLACES_PANEL_W,
  PLACES_SHOWN_MIN_WIDTH,
  queryTreeLayout,
  sideHeadSpan,
  TREE_AUTO_MIN_WIDTH,
  TREE_SPLIT_W,
  TREE_WORK_MIN_W,
} from "./head-span";

describe("sideHeadSpan", () => {
  it("열려 있으면 패널 폭 + 경계선", () => {
    expect(sideHeadSpan({ open: true, panelW: 200, lineW: 1 })).toBe(201);
  });
  it("닫혀 있으면 고정하지 않는다", () => {
    expect(sideHeadSpan({ open: false, panelW: 200, lineW: 1 })).toBeNull();
  });
});

describe("isNarrowTree", () => {
  it("경계 폭 아래만 좁다 — 못 쟀으면(0) 넓은 쪽", () => {
    expect(isNarrowTree(0)).toBe(false);
    expect(isNarrowTree(1)).toBe(true);
    expect(isNarrowTree(TREE_AUTO_MIN_WIDTH - 1)).toBe(true);
    expect(isNarrowTree(TREE_AUTO_MIN_WIDTH)).toBe(false);
  });
});

describe("queryTreeLayout", () => {
  const at = (treeOpen: boolean | null, width: number, treeW = 220) => queryTreeLayout({ treeOpen, width, treeW });
  const none = (narrow: boolean) => ({ narrow, shown: false, boxW: 0, span: null });

  it("넓은 타일 · 자동 — 상자 = 원하는 폭, 무리 끝 = 상자 + 경계선", () => {
    expect(at(null, 900)).toEqual({ narrow: false, shown: true, boxW: 220, span: 220 + TREE_SPLIT_W });
  });
  it("끌어서 생긴 소수 폭은 반올림 — 상자와 무리가 같은 정수", () => {
    const l = at(null, 900, 233.6);
    expect(l.boxW).toBe(234);
    expect(l.span).toBe(234 + TREE_SPLIT_W);
  });
  it("경계 폭에서 트리 · 무리 · 좁음 판정이 같은 순간에 바뀐다", () => {
    for (const open of [null, true] as const) {
      const wide = at(open, TREE_AUTO_MIN_WIDTH);
      expect(wide.narrow).toBe(false);
      expect(wide.shown).toBe(true);
      expect(wide.span).not.toBeNull();
      expect(at(open, TREE_AUTO_MIN_WIDTH - 1)).toEqual(none(true));
    }
  });
  it("좁으면 사람이 열어 두었어도 접힌다 — 상자를 줄여 남기지 않는다", () => {
    for (const w of [1, 100, 300, 359, 400, 559]) expect(at(true, w, 300)).toEqual(none(true));
  });
  it("좁음 → 넓음이면 사람이 고른 값대로 다시 선다(고른 값은 지우지 않는다)", () => {
    expect(at(true, 900).shown).toBe(true);
    expect(at(false, 900)).toEqual(none(false));
  });
  it("폭을 아직 못 쟀으면(0) 자동은 접힘, 사람이 연 것은 원하는 폭 그대로", () => {
    expect(at(null, 0)).toEqual(none(false));
    expect(at(true, 0)).toEqual({ narrow: false, shown: true, boxW: 220, span: 220 + TREE_SPLIT_W });
  });
  it("사람이 닫았으면 넓어도 없다", () => {
    expect(at(false, 1200)).toEqual(none(false));
  });
  it("넓은 타일에서도 편집기 열은 남긴다 — 원하는 폭이 너무 크면 상자가 멈춘다", () => {
    const l = at(true, TREE_AUTO_MIN_WIDTH, 600);
    expect(l.boxW).toBe(TREE_AUTO_MIN_WIDTH - TREE_SPLIT_W - TREE_WORK_MIN_W);
    expect(l.span).toBe(l.boxW + TREE_SPLIT_W);
  });
});

describe("docHeadSpan", () => {
  it("목차 패널이 열려 있으면 본문 열의 x(패널 폭 + 오른쪽 경계선)", () => {
    expect(docHeadSpan(true)).toBe(OUTLINE_PANEL_W + OUTLINE_LINE_W);
  });
  it("패널이 닫혀 있으면(좁은 타일의 드롭다운 포함) 고정하지 않는다", () => {
    expect(docHeadSpan(false)).toBeNull();
  });
});

describe("filePlacesLayout", () => {
  /** 목록 칸 폭의 모형 — 타일 폭 − 장소 패널 − (미리 보기 패널 240 — 타일 720 이상에서만) − 목록 좌우 여백 4 × 2 */
  const listOf = (on: boolean, width: number, preview = false) => {
    const panel = filePlacesLayout({ on, width, listW: 0 }).boxW;
    return width - panel - (preview && width >= 720 ? 240 : 0) - 8;
  };
  const at = (on: boolean, width: number, preview = false) =>
    filePlacesLayout({ on, width, listW: listOf(on, width, preview) });

  it("넓음 — 펼친 패널 · 무리 끝 = 패널 폭 + 경계(면 차이라 0) · 접힘 없음", () => {
    expect(at(true, 900)).toEqual({
      mode: "full",
      boxW: PLACES_PANEL_W,
      span: PLACES_PANEL_W + PLACES_LINE_W,
      fold: false,
      foldOver: 900 - FILE_FOLD_MIN_WIDTH,
    });
  });

  it("정렬 해제는 목록 칸 폭 < 480(권한 칸이 숨는 순간)과 같은 판정", () => {
    const l = (listW: number) => filePlacesLayout({ on: true, width: 900, listW }).span;
    expect(l(FILE_LIST_MODE_MIN_W)).toBe(PLACES_PANEL_W);
    expect(l(FILE_LIST_MODE_MIN_W - 1)).toBeNull();
    expect(l(0)).toBe(PLACES_PANEL_W); // 못 쟀으면 넓은 쪽
  });

  it("좁혀 가면 정렬 해제 → 패널 아이콘만 + 단추 접기(같은 순간) → 패널 없음 순서로 바뀐다", () => {
    for (const preview of [false, true]) {
      const first: Record<string, number> = {};
      const mark = (k: string, w: number) => (first[k] ??= w);
      for (let w = 1200; w >= 200; w--) {
        const l = at(true, w, preview);
        if (l.span === null) mark("unalign", w);
        if (l.mode === "mini") mark("mini", w);
        if (l.fold) mark("fold", w);
        if (l.mode === "none") mark("none", w);
      }
      expect(first.mini).toBe(PLACES_FULL_MIN_WIDTH - 1);
      expect(first.fold).toBe(FILE_FOLD_MIN_WIDTH - 1);
      expect(first.none).toBe(PLACES_SHOWN_MIN_WIDTH - 1);
      expect(first.unalign).toBeGreaterThan(first.mini);
      expect(first.mini).toBe(first.fold); // 사이드 탭이 접히는 순간 오른쪽 단추도 같이(10-20 사용자)
      expect(first.fold).toBeGreaterThan(first.none);
    }
  });

  it("미리 보기 패널이 열려 있으면 목록이 좁아 더 일찍 풀린다", () => {
    // 미리 보기 없음: 목록 = 타일 − 176 → 656 아래에서 풀림 / 있음(타일 720 이상): 목록 = 타일 − 416 → 896 아래에서 풀림
    expect(at(true, 656).span).not.toBeNull();
    expect(at(true, 655).span).toBeNull();
    expect(at(true, 896, true).span).not.toBeNull();
    expect(at(true, 895, true).span).toBeNull();
    // 타일 720 아래면 미리 보기가 숨어(PreviewPanel 의 컨테이너 규칙) 목록이 넓어지고 권한 칸과 함께 정렬이 돌아온다
    expect(at(true, 719, true).span).not.toBeNull();
  });

  it("단추 접기 직전에도 경로 칸에 최소 몫이 남는다(머리줄 모형)", () => {
    expect(FILE_FOLD_MIN_WIDTH - FILE_HEAD_LEAD_END - FILE_FOLD_TOOLS_W - FILE_HEAD_RIGHT_W).toBeGreaterThanOrEqual(FILE_PATH_MIN_W);
  });

  it("끄면(F9) 패널도 정렬도 없다 — 접힘은 폭대로", () => {
    for (const w of [300, 500, 1200]) {
      const l = at(false, w);
      expect(l.mode).toBe("none");
      expect(l.span).toBeNull();
      expect(l.fold).toBe(w < FILE_FOLD_MIN_WIDTH);
    }
  });

  it("폭을 아직 못 쟀으면(0) 넓은 쪽", () => {
    expect(filePlacesLayout({ on: true, width: 0, listW: 0 })).toEqual({
      mode: "full",
      boxW: PLACES_PANEL_W,
      span: PLACES_PANEL_W,
      fold: false,
      foldOver: 0,
    });
  });

  it("문턱이 FileList 의 권한 칸 컨테이너 쿼리와 같은 값이다", () => {
    const src = readFileSync(new URL("../browser/FileList.svelte", import.meta.url), "utf8");
    const m = /@container file-list \(max-width: (\d+)px\)\s*\{[^@]*?\.mode\s*\{\s*display:\s*none/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1]) + 1).toBe(FILE_LIST_MODE_MIN_W);
  });
});
