import { describe, expect, it } from "vitest";
import { dragTabHoverAction, type TabHoverDrag } from "$lib/tab-hover";

const hover = (overrides: Partial<Parameters<typeof dragTabHoverAction>[0]> = {}) =>
  dragTabHoverAction({
    kind: "pane", overId: "target", activeId: "source", pendingId: null,
    ...overrides,
  });

describe("dragTabHoverAction — 드래그 중 탭 머무름", () => {
  it("타일 드래그로 다른 탭에 들어가면 시계를 건다", () => {
    expect(hover()).toBe("arm");
  });

  it("타일 드래그가 같은 탭에 머물면 반복 이벤트로 시계를 늦추지 않는다", () => {
    expect(hover({ pendingId: "target" })).toBe("keep");
  });

  it("커서 아래 탭이 바뀌면 새 탭에서 처음부터 센다", () => {
    expect(hover({ overId: "next", pendingId: "target" })).toBe("arm");
    expect(hover({ overId: "target", pendingId: "next" })).toBe("arm");
  });

  it("타일 드래그라도 활성 탭에서는 시계를 지운다", () => {
    expect(hover({ overId: "source", pendingId: "target" })).toBe("clear");
    expect(hover({ activeId: "target", pendingId: "target" })).toBe("clear");
  });

  it("탭 드래그도 걸쳐 머문 다른 탭에 시계를 건다", () => {
    expect(hover({ kind: "tab" })).toBe("arm");
    expect(hover({ kind: "tab", pendingId: "target" })).toBe("keep");
    expect(hover({ kind: "tab", overId: "source" })).toBe("clear");
  });

  it.each<TabHoverDrag>([null])("%s 처럼 대상 밖의 종류는 남은 시계도 지운다", (kind) => {
    expect(hover({ kind })).toBe("clear");
    expect(hover({ kind, pendingId: "target" })).toBe("clear");
  });

  it("탭 사이 빈 공간·탭 바 밖에서는 시계를 지운다", () => {
    expect(hover({ overId: null, pendingId: "target" })).toBe("clear");
  });

  it("활성 탭이 없어도 커서 아래 탭은 열 수 있다", () => {
    expect(hover({ activeId: null })).toBe("arm");
  });
});
