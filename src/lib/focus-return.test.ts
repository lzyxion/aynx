import { beforeEach, describe, expect, it } from "vitest";
import {
  decideFocusReturn,
  dropFocusOrigin,
  openFocusOrigins,
  popFocusOrigin,
  pushFocusOrigin,
  resetFocusOrigins,
  type FocusOrigin,
  type FocusWorld,
} from "$lib/focus-return";

/**
 * 모달이 닫힌 뒤의 포커스 규칙. 표(겹침)와 판정 둘 다 DOM 을 모르는 순수 함수라 여기서
 * 전부 확인한다 — `document` 도 룬도 필요 없다 (`app/focus-return.svelte.ts` 는 이 답을 받아
 * `.focus()` 만 부른다).
 */

/** 가짜 요소 — 판정이 요소에 대해 묻는 것은 `usable` 하나뿐이라 이름표면 충분하다 */
function el(tag: string): HTMLElement {
  return { tag } as unknown as HTMLElement;
}

/** `panes` 에 있는 타일만 보이고, `dead` 에 든 요소만 못 쓴다 */
function world(panes: string[], dead: HTMLElement[] = []): FocusWorld {
  return {
    paneVisible: (id) => panes.includes(id),
    usable: (e) => !dead.includes(e),
  };
}

const inTile = (paneId: string, element: HTMLElement | null = null): FocusOrigin => ({
  paneId,
  element,
  inTile: element !== null,
});

describe("decideFocusReturn", () => {
  it("타일 안에서 열었으면 그 타일로 돌아간다", () => {
    const textarea = el("textarea");
    expect(decideFocusReturn(inTile("p1", textarea), world(["p1"]))).toEqual({
      kind: "pane",
      id: "p1",
    });
  });

  it("타일 **밖**에서 열었으면 그 요소가 먼저다 (독의 검색 칸 등)", () => {
    const input = el("dock-search");
    const origin: FocusOrigin = { paneId: "p1", element: input, inTile: false };
    expect(decideFocusReturn(origin, world(["p1"]))).toEqual({ kind: "element", el: input });
  });

  it("타일 밖 요소가 사라졌으면 포커스 타일로 물러난다", () => {
    const gone = el("menu-button");
    const origin: FocusOrigin = { paneId: "p1", element: gone, inTile: false };
    expect(decideFocusReturn(origin, world(["p1"], [gone]))).toEqual({ kind: "pane", id: "p1" });
  });

  it("타일이 닫혔으면(지금 탭에 없으면) 살아 있는 요소라도 준다", () => {
    const input = el("dock-search");
    expect(decideFocusReturn(inTile("p1", input), world([]))).toEqual({
      kind: "element",
      el: input,
    });
  });

  it("타일도 요소도 없으면 아무것도 하지 않는다", () => {
    const gone = el("x");
    expect(decideFocusReturn(inTile("p1", gone), world([], [gone]))).toBeNull();
    expect(decideFocusReturn({ paneId: null, element: null, inTile: false }, world([]))).toBeNull();
    expect(decideFocusReturn(null, world(["p1"]))).toBeNull();
  });

  it("다른 탭으로 옮겨 간 타일은 끌어오지 않는다", () => {
    // `paneVisible` 이 **활성 탭 기준**이라는 계약이 이 줄에 실려 있다.
    expect(decideFocusReturn(inTile("p1"), world(["p2", "p3"]))).toBeNull();
  });
});

describe("열린 모달 표", () => {
  beforeEach(() => resetFocusOrigins());

  it("하나만 열렸다 닫히면 그 자리를 돌려준다", () => {
    const origin = inTile("p1");
    pushFocusOrigin("forward", origin);
    expect(openFocusOrigins()).toBe(1);
    expect(popFocusOrigin("forward")).toBe(origin);
    expect(openFocusOrigins()).toBe(0);
  });

  it("겹쳐 뜬 모달은 **표가 빌 때만** 돌려준다", () => {
    const outer = inTile("p1");
    const inner = inTile("p2");
    pushFocusOrigin("host-form", outer);
    pushFocusOrigin("password", inner);
    // 위에 뜬 것이 먼저 닫혔다 — 아직 호스트 폼이 떠 있으므로 포커스를 옮기면 안 된다.
    expect(popFocusOrigin("password")).toBeNull();
    // 마지막 하나가 닫히자 비로소 **처음 자리**로 돌아간다.
    expect(popFocusOrigin("host-form")).toBe(outer);
  });

  it("닫히는 순서가 뒤집혀도 마지막 하나가 돌려준다", () => {
    const a = inTile("p1");
    const b = inTile("p2");
    pushFocusOrigin("forward", a);
    pushFocusOrigin("upload", b);
    // 세션이 죽어 **아래 깔린 것**이 먼저 닫히는 경우 (LIFO 가 아니다).
    expect(popFocusOrigin("forward")).toBeNull();
    expect(popFocusOrigin("upload")).toBe(b);
  });

  it("같은 이름표로 두 번 열면 덮어쓴다 (항목이 쌓이지 않는다)", () => {
    const first = inTile("p1");
    const second = inTile("p2");
    pushFocusOrigin("snippet-save", first);
    pushFocusOrigin("snippet-save", second);
    expect(openFocusOrigins()).toBe(1);
    expect(popFocusOrigin("snippet-save")).toBe(second);
    expect(openFocusOrigins()).toBe(0);
  });

  it("열린 적 없는 이름표를 닫는 것은 아무 일도 아니다", () => {
    expect(popFocusOrigin("upload")).toBeNull();
    pushFocusOrigin("forward", inTile("p1"));
    // 없는 이름표를 닫아도 **떠 있는 모달의 자리를 건드리지 않는다**.
    expect(popFocusOrigin("upload")).toBeNull();
    expect(openFocusOrigins()).toBe(1);
  });

  it("`dropFocusOrigin` 은 빼기만 한다 — 갈 곳을 스스로 정한 닫기", () => {
    pushFocusOrigin("search", inTile("p1"));
    dropFocusOrigin("search");
    expect(openFocusOrigins()).toBe(0);
    expect(popFocusOrigin("search")).toBeNull();
  });
});
