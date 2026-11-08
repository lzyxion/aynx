import { describe, expect, it, vi } from "vitest";

// WebGL 애드온 모형 — 붙이면 화면에 캔버스 하나를 얹고, dispose 하면 걷는다(진짜 애드온과 같은 모양).
// 진짜처럼 **컨텍스트는 돌려주지 않는다** — 돌려주는 것은 우리 몫이다.
const screen: FakeCanvas[] = [];
interface FakeCanvas {
  cls: string;
  lost: number;
  kind: "webgl2" | "2d";
}
const canvas = (kind: FakeCanvas["kind"], cls = ""): FakeCanvas => ({ cls, lost: 0, kind });

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    #c: FakeCanvas | null = null;
    onContextLoss() {}
    activate() {
      this.#c = canvas("webgl2");
      screen.push(this.#c);
      // 이미지 애드온은 렌더러가 바뀔 때 제 캔버스를 새로 만들어 다시 얹는다
      const img = screen.findIndex((c) => c.cls === "xterm-image-layer");
      if (img >= 0) screen.splice(img, 1, canvas("2d", "xterm-image-layer"));
    }
    dispose() {
      const i = this.#c ? screen.indexOf(this.#c) : -1;
      if (i >= 0) screen.splice(i, 1);
    }
  },
}));
vi.mock("@xterm/addon-image", () => ({ ImageAddon: class {} }));
vi.mock("@xterm/addon-ligatures", () => ({ LigaturesAddon: class {} }));

const { RendererAddons } = await import("$lib/term/renderer-addons");

function asElement(c: FakeCanvas) {
  return {
    __fake: c,
    getContext: (type: string) =>
      type === c.kind ? { getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: () => c.lost++ } : null) } : null,
  };
}
const views = new Map<FakeCanvas, ReturnType<typeof asElement>>();
const view = (c: FakeCanvas) => views.get(c) ?? (views.set(c, asElement(c)), views.get(c)!);

function host() {
  const term = {
    element: {
      querySelectorAll: (sel: string) =>
        screen.filter((c) => !(sel.includes(":not(.xterm-image-layer)") && c.cls === "xterm-image-layer")).map(view),
    },
    loadAddon: (a: { activate(): void }) => a.activate(),
  };
  return { term: term as never, disposed: false };
}

describe("RendererAddons — WebGL 떼기", () => {
  it("떼면 그 캔버스의 컨텍스트를 바로 돌려준다(GC 를 기다리지 않는다)", () => {
    screen.length = 0;
    const r = new RendererAddons(host());
    r.loadWebgl();
    const gl = screen.find((c) => c.kind === "webgl2")!;
    expect(r.hasWebgl).toBe(true);
    r.unloadWebgl();
    expect(r.hasWebgl).toBe(false);
    expect(gl.lost).toBe(1);
  });

  it("탭을 오가며 붙였다 뗐다 해도 매번 돌려준다", () => {
    screen.length = 0;
    const r = new RendererAddons(host());
    const seen: FakeCanvas[] = [];
    for (let i = 0; i < 20; i++) {
      r.loadWebgl();
      seen.push(screen.find((c) => c.kind === "webgl2")!);
      r.unloadWebgl();
    }
    expect(seen.every((c) => c.lost === 1)).toBe(true);
  });

  it("이미지 애드온이 그 사이 새로 얹은 캔버스를 WebGL 캔버스로 잡지 않는다", () => {
    screen.length = 0;
    screen.push(canvas("2d", "xterm-image-layer"));
    const r = new RendererAddons(host());
    r.loadWebgl();
    const gl = screen.find((c) => c.kind === "webgl2")!;
    r.unloadWebgl();
    expect(gl.lost).toBe(1);
  });
});
