import { describe, expect, it, vi } from "vitest";
import { installGateOnCore, looksLikeDomRenderer } from "$lib/term/hidden-render-gate";

// xterm 6.0.0 의 모양만 흉내 낸 모형 — `CoreBrowserTerminal._createRenderer` 가 DOM 렌더러를 만들고,
// `RenderService._renderer.value` 가 지금 렌더러다. DOM 렌더러의 `handleResize` · `handleSelectionChanged` 는
// 안에서 `this.renderRows(0, rows - 1)` 를 부른다(원본과 같은 호출 모양 — 인스턴스 덮어쓰기가 걸리는지 본다).
function makeDom() {
  const drawn: [number, number][] = [];
  const r = {
    _widthCache: {},
    spacingCalls: 0,
    renderRows(start: number, end: number) {
      drawn.push([start, end]);
    },
    handleResize() {
      this.renderRows(0, 23);
    },
    handleSelectionChanged() {
      this.renderRows(0, 23);
    },
    _setDefaultSpacing() {
      this.spacingCalls += 1;
    },
  };
  return { r, drawn };
}

function makeCore() {
  const made: ReturnType<typeof makeDom>[] = [];
  const core = {
    _renderService: { _renderer: { value: null as unknown } },
    _createRenderer() {
      const d = makeDom();
      made.push(d);
      return d.r;
    },
  };
  // open() 이 첫 DOM 렌더러를 세운 상태
  core._renderService._renderer.value = core._createRenderer();
  return { core, made };
}

/** WebGL 렌더러 모형 — 글자 폭 캐시가 없다 */
const webgl = { renderRows() {} };

describe("looksLikeDomRenderer", () => {
  it("DOM 렌더러만 고른다", () => {
    expect(looksLikeDomRenderer(makeDom().r)).toBe(true);
    expect(looksLikeDomRenderer(webgl)).toBe(false);
    expect(looksLikeDomRenderer(null)).toBe(false);
  });
});

describe("installGateOnCore", () => {
  it("모양이 다르면 손대지 않는다", () => {
    expect(installGateOnCore({}, () => {}, false)).toBeNull();
    expect(installGateOnCore(undefined, () => {}, false)).toBeNull();
  });

  it("보이는 동안은 그대로 그린다", () => {
    const { core, made } = makeCore();
    const g = installGateOnCore(core, () => {}, false)!;
    expect(g.hidden).toBe(false);
    made[0].r.handleSelectionChanged();
    expect(made[0].drawn).toEqual([[0, 23]]);
  });

  it("숨은 동안 지금 렌더러의 행 그리기(선택 갱신 · resize 길)를 건너뛰고, 보이면 한 번 다 그린다", () => {
    const { core, made } = makeCore();
    const refresh = vi.fn();
    const g = installGateOnCore(core, refresh, false)!;
    g.hide();
    made[0].r.handleSelectionChanged(); // 숨은 탭에 출력이 와 화면이 밀렸다(SelectionService.refresh 의 rAF)
    made[0].r.handleResize();
    expect(made[0].drawn).toEqual([]);
    g.show();
    expect(refresh).toHaveBeenCalledTimes(1);
    // 처음부터 보이던 렌더러라 기본 간격은 다시 재지 않는다
    expect(made[0].r.spacingCalls).toBe(0);
    made[0].r.handleSelectionChanged();
    expect(made[0].drawn).toEqual([[0, 23]]);
  });

  it("건너뛴 것이 없으면 보일 때 다시 그리지 않는다", () => {
    const { core } = makeCore();
    const refresh = vi.fn();
    const g = installGateOnCore(core, refresh, false)!;
    g.hide();
    g.show();
    g.show(); // 두 번 불려도
    expect(refresh).not.toHaveBeenCalled();
  });

  it("숨은 채 새로 생긴 DOM 렌더러(WebGL 떼기)에도 문이 달린다 — dispose 의 resize 가 그리지 않는다", () => {
    const { core, made } = makeCore();
    core._renderService._renderer.value = webgl; // 보이는 동안 WebGL
    const refresh = vi.fn();
    const g = installGateOnCore(core, refresh, false)!;
    g.hide(); // 숨길 때 — 문을 먼저 닫고
    const fresh = core._createRenderer(); // WebglAddon.dispose → setRenderer(_createRenderer()) → handleResize
    core._renderService._renderer.value = fresh;
    made[1].r.handleResize();
    expect(made[1].drawn).toEqual([]);
    // 다시 보일 때 WebGL 이 섰으면 DOM 렌더러는 버려진다 — 할 일 없음
    core._renderService._renderer.value = webgl;
    g.show();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("숨은 채 생긴 DOM 렌더러가 보일 때 남았으면(WebGL 꺼짐) 기본 간격을 다시 재고 다시 그린다", () => {
    const { core, made } = makeCore();
    const refresh = vi.fn();
    const g = installGateOnCore(core, refresh, false)!;
    g.hide();
    core._renderService._renderer.value = core._createRenderer();
    g.show();
    expect(made[1].r.spacingCalls).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("숨은 채 열린 타일(startHidden)은 닫힌 문으로 시작한다", () => {
    const { core, made } = makeCore();
    const refresh = vi.fn();
    const g = installGateOnCore(core, refresh, true)!;
    expect(g.hidden).toBe(true);
    made[0].r.handleSelectionChanged();
    expect(made[0].drawn).toEqual([]);
    g.show();
    expect(made[0].r.spacingCalls).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

// 실제 xterm 번들이 이 문이 기대는 내부 이름을 그대로 들고 있는가 — 업그레이드로 이름이 바뀌면 문은 조용히 빠진다
// (`installHiddenRenderGate` 가 경고만 남긴다). 그때 여기서 먼저 걸린다.
describe("xterm 번들의 내부 이름", () => {
  it("DOM 렌더러 · 코어 · WebGL 애드온 dispose 가 기대는 이름이 있다", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../../node_modules/@xterm");
    const core = fs.readFileSync(path.join(root, "xterm/lib/xterm.mjs"), "utf8");
    const gl = fs.readFileSync(path.join(root, "addon-webgl/lib/addon-webgl.mjs"), "utf8");
    for (const name of ["_createRenderer", "_widthCache", "_setDefaultSpacing", "renderRows", "_renderer.value"]) {
      expect(core.includes(name), name).toBe(true);
    }
    // 애드온 dispose 가 코어의 `_createRenderer` 를 **속성으로** 부른다 — 인스턴스에서 감싼 함수가 걸리는 이유
    expect(gl.includes("_core._createRenderer()")).toBe(true);
  });
});
