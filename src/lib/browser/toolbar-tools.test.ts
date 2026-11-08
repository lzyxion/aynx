import { FILE_FOLD_MIN_WIDTH } from "$lib/pane/head-span";
import { describe, expect, it } from "vitest";
import {
  fileMenuTools,
  foldGap,
  foldSpacer,
  nextMenuIndex,
  toPaneMenuItems,
  type ToolbarTool,
} from "$lib/browser/toolbar-tools";
import { UI_ICONS } from "$lib/ui-icons.generated";

describe("nextMenuIndex", () => {
  const all = [false, false, false];

  it("↓ ↑ 는 한 줄씩, 끝에서 돌아간다", () => {
    expect(nextMenuIndex("ArrowDown", 0, all)).toBe(1);
    expect(nextMenuIndex("ArrowDown", 2, all)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, all)).toBe(2);
  });

  it("포커스가 없으면 ↓ 는 첫 줄, ↑ 는 마지막 줄", () => {
    expect(nextMenuIndex("ArrowDown", -1, all)).toBe(0);
    expect(nextMenuIndex("ArrowUp", -1, all)).toBe(2);
  });

  it("흐린 줄은 건너뛴다 — Home·End 도", () => {
    const d = [true, false, true, false, true];
    expect(nextMenuIndex("ArrowDown", 1, d)).toBe(3);
    expect(nextMenuIndex("ArrowDown", 3, d)).toBe(1);
    expect(nextMenuIndex("ArrowUp", 1, d)).toBe(3);
    expect(nextMenuIndex("Home", -1, d)).toBe(1);
    expect(nextMenuIndex("End", -1, d)).toBe(3);
  });

  it("갈 줄이 없거나 모르는 키면 -1", () => {
    expect(nextMenuIndex("ArrowDown", -1, [true, true])).toBe(-1);
    expect(nextMenuIndex("Enter", 0, all)).toBe(-1);
  });
});

describe("foldGap", () => {
  it("넓은 모양 − 접힌 모양, 반올림", () => {
    expect(foldGap(150, 26)).toBe(124);
    expect(foldGap(77.4, 36)).toBe(41);
  });

  it("못 쟀거나 접힌 쪽이 더 넓으면 0", () => {
    expect(foldGap(undefined, 26)).toBe(0);
    expect(foldGap(150, undefined)).toBe(0);
    expect(foldGap(20, 26)).toBe(0);
  });
});

describe("foldSpacer — 줄 폭 → 경로 칸 폭이 끊기지 않는다 (2026-10-20 B안)", () => {
  /**
   * 도구줄의 모형 — 경로 칸 = 줄 폭 − (접히는 무리(새 폴더 · 업로드) 또는 그 빈칸 + 보기 고르개 · 찾기 · 고정 몫). 접힌 모양은
   * 아무것도 없다(⋯ 는 접힘과 무관하게 선다 — 머리줄이면 타일 ⋯). 단추 수가 달라도(접히는 무리 폭) 이어져야 한다.
   */
  function pathWidth(w: number, tools: number) {
    const fixed = 60 + 40 + 28 + 12; // 뒤로/앞으로 · 보기 고르개 · 찾기 · 줄 간격
    const fold = w < FILE_FOLD_MIN_WIDTH ? foldSpacer(foldGap(tools, 0), w, FILE_FOLD_MIN_WIDTH) : tools;
    return w - fixed - fold;
  }

  for (const tools of [28, 56]) {
    it(`접히는 무리 ${tools}px — 1px 씩 좁혀도 경로 칸은 1px 넘게 안 변하고, 넓어지지 않는다`, () => {
      for (let w = 600; w > 120; w--) {
        const d = pathWidth(w, tools) - pathWidth(w - 1, tools);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    });

    it(`접히는 무리 ${tools}px — 접는 지점의 폭에 머물다가 빈칸이 닳으면 다시 준다`, () => {
      const at = FILE_FOLD_MIN_WIDTH;
      const p = pathWidth(at, tools);
      expect(pathWidth(at - 1, tools)).toBe(p);
      expect(pathWidth(at - tools, tools)).toBe(p);
      expect(pathWidth(at - tools - 10, tools)).toBe(p - 10);
    });
  }
});
describe("fileMenuTools — ⋯ 에 설 도구 줄(2026-10-20 B안)", () => {
  const run = () => {};
  const bar: ToolbarTool[] = [
    { id: "newfolder", icon: "folder-plus", label: "새 폴더", fold: true, run },
    { id: "upload", icon: "upload", label: "업로드", fold: true, run },
    { id: "filter-toggle", icon: "search", label: "찾기", pressed: false, run },
  ];
  const menu: ToolbarTool[] = [
    // 새로고침은 ⋯ 에 없다 — 경로 칸 안 오른쪽 끝의 ⟳(`LocationBar` — 2026-10-20 사용자 실기로 되돌림)
    { id: "hidden", icon: "show-hidden", label: "숨김 파일 보기", pressed: true, run },
    { id: "places", icon: "layout", label: "장소 패널", pressed: false, run },
  ];

  it("넓으면 ⋯ 줄만 — 줄 위 단추는 오지 않는다", () => {
    expect(fileMenuTools(bar, menu, false).map((x) => x.id)).toEqual(["hidden", "places"]);
    expect(fileMenuTools(bar, menu, false)[0].sep).toBe(false);
  });

  it("좁으면 접히는 단추(새 폴더 · 업로드)가 먼저, 찾기는 줄에 남고, 둘 사이에 선", () => {
    const rows = fileMenuTools(bar, menu, true);
    expect(rows.map((x) => x.id)).toEqual(["newfolder", "upload", "hidden", "places"]);
    expect(rows.map((x) => x.sep === true)).toEqual([false, false, true, false]);
  });
});

describe("toPaneMenuItems — 타일 ⋯ 의 줄로", () => {
  const run = () => {};

  it("액션은 `tool:<id>` · 켜고 끄는 줄은 체크 관례(켜졌을 때만 check) · 단축키 글자", () => {
    const items = toPaneMenuItems(
      [
        { id: "newfolder", icon: "folder-plus", label: "새 폴더", run },
        { id: "places", icon: "layout", label: "장소 패널", pressed: false, action: "files-places", run },
        { id: "preview", icon: "preview", label: "미리 보기 패널", pressed: true, action: "files-preview", sep: true, run },
      ],
      (a) => (a === "files-places" ? "F9" : a === "files-preview" ? "F11" : ""),
    );
    expect(items.map((i) => i.action)).toEqual(["tool:newfolder", "tool:places", "tool:preview"]);
    expect(items[0]).toMatchObject({ icon: "folder-plus", hint: undefined });
    expect(items[0].checkbox).toBeUndefined();
    expect(items[1]).toMatchObject({ icon: null, checkbox: true, checked: false, hint: "F9" });
    expect(items[2]).toMatchObject({ icon: "check", checkbox: true, checked: true, hint: "F11", separator: true });
  });

  it("흐린 줄에만 툴팁(왜 못 누르는지)", () => {
    const [on, off] = toPaneMenuItems(
      [
        { id: "a", icon: "refresh", label: "가", run },
        { id: "b", icon: "upload", label: "나", title: "여기에는 놓을 수 없습니다", disabled: true, run },
      ],
      () => "",
    );
    expect(on.title).toBeUndefined();
    expect(off).toMatchObject({ disabled: true, title: "여기에는 놓을 수 없습니다" });
  });

  it("그림 이름이 생성 목록에 있다(파일 타일의 줄)", () => {
    for (const name of ["refresh", "show-hidden", "layout", "preview", "folder-plus", "upload", "search", "check"]) {
      expect(UI_ICONS[name as keyof typeof UI_ICONS]).toBeDefined();
    }
  });
});
