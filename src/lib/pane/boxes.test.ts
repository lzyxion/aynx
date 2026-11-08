import { describe, expect, it } from "vitest";
import { hostBoxes, zoomOf } from "$lib/pane/boxes";
import { FULL_RECT } from "$lib/layout";
import { leafOf, type PaneNode, type PaneSpec, type TabSpec } from "$lib/session";

const spec = (id: string): PaneSpec => ({ id, kind: "local" });
const leaf = (id: string): PaneNode => leafOf(spec(id));
const row = (a: PaneNode, b: PaneNode): PaneNode => ({ type: "split", dir: "row", ratio: 0.5, a, b });

const tab = (id: string, root: PaneNode, zoomedPaneId?: string): TabSpec => ({
  id,
  title: id,
  root,
  ...(zoomedPaneId === undefined ? {} : { zoomedPaneId }),
});

describe("zoomOf — 최대화의 그물", () => {
  it("표시가 없으면 `null`", () => {
    expect(zoomOf(tab("tab-1", row(leaf("pane-1"), leaf("pane-2"))))).toBeNull();
  });

  it("그 잎이 이 탭에 있으면 그대로 통과", () => {
    expect(zoomOf(tab("tab-1", row(leaf("pane-1"), leaf("pane-2")), "pane-2"))).toBe("pane-2");
  });

  it("그 잎이 없으면(닫혔거나 다른 탭으로 갔다) `null`", () => {
    expect(zoomOf(tab("tab-1", row(leaf("pane-1"), leaf("pane-2")), "pane-9"))).toBeNull();
  });

  it("타일이 하나뿐이면 최대화는 뜻이 없다 — 이미 화면 전체다", () => {
    expect(zoomOf(tab("tab-1", leaf("pane-1"), "pane-1"))).toBeNull();
  });
});

describe("hostBoxes", () => {
  const t1 = tab("tab-1", row(leaf("pane-2"), leaf("pane-1")));
  const t2 = tab("tab-2", leaf("pane-3"));

  it("전 탭의 전 패널을 **생성 순번**으로 늘어놓는다 (트리 순서도 탭 순서도 아니다)", () => {
    const ids = hostBoxes([t1, t2], "tab-1", () => "").map((b) => b.pane.id);
    expect(ids).toEqual(["pane-1", "pane-2", "pane-3"]);
  });

  it("활성 탭의 패널만 보인다 (나머지는 인스턴스만 살아 있다)", () => {
    const boxes = hostBoxes([t1, t2], "tab-1", () => "");
    expect(boxes.filter((b) => b.visible).map((b) => b.pane.id)).toEqual(["pane-1", "pane-2"]);
  });

  it("`paneCount` 는 **소속 탭**의 패널 수다", () => {
    const byId = new Map(hostBoxes([t1, t2], "tab-1", () => "").map((b) => [b.pane.id, b]));
    expect(byId.get("pane-1")?.paneCount).toBe(2);
    expect(byId.get("pane-3")?.paneCount).toBe(1);
  });

  it("포커스는 탭마다 따로 묻는다", () => {
    const focused = hostBoxes([t1, t2], "tab-1", (t) => (t.id === "tab-1" ? "pane-2" : "pane-3"))
      .filter((b) => b.focused)
      .map((b) => b.pane.id);
    expect(focused).toEqual(["pane-2", "pane-3"]);
  });

  it("최대화 중이면 그 타일만 캔버스 전체를 쓰고 형제는 숨는다", () => {
    const zoomed = tab("tab-1", row(leaf("pane-1"), leaf("pane-2")), "pane-2");
    const byId = new Map(hostBoxes([zoomed], "tab-1", () => "").map((b) => [b.pane.id, b]));
    expect(byId.get("pane-2")?.zoomed).toBe(true);
    expect(byId.get("pane-2")?.rect).toEqual(FULL_RECT);
    expect(byId.get("pane-2")?.visible).toBe(true);
    expect(byId.get("pane-1")?.visible).toBe(false);
    expect(byId.get("pane-1")?.zoomed).toBe(false);
  });

  it("탭 전환 슬라이드로 빠져나가는 탭은 그려지되(`shown`) 보이는 탭(`visible`)은 아니다", () => {
    const boxes = hostBoxes([t1, t2], "tab-2", () => "", "tab-1");
    expect(boxes.filter((b) => b.shown).map((b) => b.pane.id)).toEqual(["pane-1", "pane-2", "pane-3"]);
    expect(boxes.filter((b) => b.visible).map((b) => b.pane.id)).toEqual(["pane-3"]);
  });

  it("빠져나가는 탭이 최대화 중이면 그 타일만 그린다", () => {
    const zoomed = tab("tab-1", row(leaf("pane-1"), leaf("pane-2")), "pane-2");
    const boxes = hostBoxes([zoomed, t2], "tab-2", () => "", "tab-1");
    expect(boxes.filter((b) => b.shown).map((b) => b.pane.id)).toEqual(["pane-2", "pane-3"]);
  });

  it("슬라이드가 없으면 `shown` 은 `visible` 과 같다", () => {
    for (const b of hostBoxes([t1, t2], "tab-1", () => "")) expect(b.shown).toBe(b.visible);
  });
});

describe("hostBoxes — 타일 하나만(원격 웹 R5 모바일 배치)", () => {
  const t1 = tab("tab-1", row(leaf("pane-2"), leaf("pane-1")));
  const t2 = tab("tab-2", leaf("pane-3"));

  it("포커스 타일만 캔버스 전체로 보이고 나머지는 숨는다 — 최대화 표식은 서지 않는다", () => {
    const boxes = hostBoxes([t1, t2], "tab-1", () => "pane-2", null, true);
    const shown = boxes.filter((b) => b.shown);
    expect(shown.map((b) => b.pane.id)).toEqual(["pane-2"]);
    expect(shown[0].rect).toEqual(FULL_RECT);
    expect(shown[0].zoomed).toBe(false);
  });

  it("포커스가 이 탭에 없으면 첫 타일 · 타일이 하나인 탭은 그대로", () => {
    const boxes = hostBoxes([t1, t2], "tab-1", () => "pane-9", null, true);
    expect(boxes.filter((b) => b.visible).map((b) => b.pane.id)).toEqual(["pane-2"]);
    const lone = hostBoxes([t2], "tab-2", () => "pane-3", null, true);
    expect(lone[0].visible).toBe(true);
  });

  it("진짜 최대화는 표식을 그대로 둔다 · solo 를 끄면 예전과 같다", () => {
    const zt = tab("tab-1", row(leaf("pane-2"), leaf("pane-1")), "pane-1");
    const solo = hostBoxes([zt], "tab-1", () => "pane-1", null, true).find((b) => b.pane.id === "pane-1");
    expect(solo?.zoomed).toBe(true);
    const off = hostBoxes([t1], "tab-1", () => "pane-2");
    expect(off.filter((b) => b.visible)).toHaveLength(2);
  });
});
