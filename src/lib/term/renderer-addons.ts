// 터미널 한 장의 렌더러 애드온(WebGL · 합자 · 인라인 이미지) 붙이기/떼기. 언제 붙이고 떼는지는 `Terminal.svelte` 가 정한다.
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { ImageAddon, type IImageAddonOptions } from "@xterm/addon-image";

export interface RendererHost {
  readonly term: Terminal | null;
  /** 늦게 끝난 동적 import 는 붙이지 않는다 */
  readonly disposed: boolean;
}

// ── 인라인 이미지 — sixel · iTerm2 IIP ──
// 보이는지와 무관하게 붙어 있다 — 숨은 탭에 온 그림도 받아 둬야 돌아왔을 때 보인다.
// 정적 import 다 — 동적이면 타일이 열리자마자 온 그림(`imgcat`)이 import 전에 지나간다.
// 알려진 한계: 창 이관 · 리로드 복원은 글자만 옮긴다 · tmux 안에서는 안 보인다 · 로컬은 ConPTY 가 sixel 을 버리고 크기가 바뀌면 그림이 지워진다.

/** 기본에서 바꾼 것은 `storageLimit` 하나 — 기본 128MB 는 터미널 하나 전제라 타일 수만큼 곱해진다. */
const IMAGE_OPTIONS: Partial<IImageAddonOptions> = {
  sixelSupport: true,
  iipSupport: true,
  storageLimit: 32,
};

export class RendererAddons {
  #h: RendererHost;

  constructor(h: RendererHost) {
    this.#h = h;
  }

  // ── WebGL 렌더러 — 보이는 패널에만 (docs/verification/xterm.md §5) ──
  // Chromium 은 렌더러 프로세스당 WebGL 컨텍스트를 ~16개만 주고 넘치면 가장 오래된 것이 조용히 죽는다(WebView2 에선 못 올린다) — 상한 방어다.
  // 떼면 컨텍스트를 바로 돌려준다(`WEBGL_lose_context`) — 애드온 dispose 는 GC 를 기다려 죽은 컨텍스트가 쌓인다.
  // 컨텍스트 로스는 재시도하지 않는다 — 그 패널은 DOM 렌더러로 산다(VS Code 와 같은 정책 · 붙였다 잃었다 되풀이가 더 나쁘다).

  #webgl: WebglAddon | null = null;
  #webglCanvas: HTMLCanvasElement | null = null;
  #webglLost = false;

  /** 합자는 이것이 참일 때만 붙인다 */
  get hasWebgl(): boolean {
    return this.#webgl !== null;
  }

  unloadWebgl() {
    if (!this.#webgl) return;
    const addon = this.#webgl;
    const canvas = this.#webglCanvas;
    this.#webgl = null;
    this.#webglCanvas = null;
    addon.dispose();
    // dispose 뒤라 애드온의 `webglcontextlost` 리스너는 이미 풀렸다 — 아래가 `onContextLoss` 를 부르지 않는다.
    try {
      canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* 돌려주기 실패 — 예전처럼 GC 를 기다린다 */
    }
  }

  loadWebgl() {
    const term = this.#h.term;
    if (this.#webgl || this.#webglLost || this.#h.disposed || !term) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        console.warn("[aynx] WebGL 컨텍스트를 잃었습니다 — DOM 렌더러로 계속합니다");
        this.#webglLost = true;
        this.unloadWebgl();
        this.unloadLigatures();
      });
      // 애드온은 캔버스를 노출하지 않는다 — 붙이기 전후의 화면 캔버스를 비교해 새로 생긴 것을 쥔다.
      const before = new Set(term.element?.querySelectorAll(".xterm-screen > canvas:not(.xterm-image-layer)") ?? []);
      term.loadAddon(addon);
      this.#webgl = addon;
      this.#webglCanvas =
        [...(term.element?.querySelectorAll<HTMLCanvasElement>(".xterm-screen > canvas:not(.xterm-image-layer)") ?? [])].find(
          (c) => !before.has(c),
        ) ?? null;
    } catch (e) {
      console.warn("[aynx] WebGL 렌더러를 쓸 수 없습니다 — DOM 렌더러로 계속합니다:", e);
      this.#webglLost = true;
    }
  }

  // ── 합자 — 옵트인 (docs/verification/ligatures.md) ──
  // xterm 6 에서 합자 조이너는 WebGL 렌더러만 소비한다 — 합자를 켜면 WebGL 을 강제로 켜고, WebGL 이 붙은 뒤에 붙인다.

  #ligatures: { dispose(): void } | null = null;

  unloadLigatures() {
    if (!this.#ligatures) return;
    const addon = this.#ligatures;
    this.#ligatures = null;
    try {
      addon.dispose();
    } catch {
      // 이미 터미널이 dispose 중이면 여기서 던질 수 있다 — 무시한다.
    }
  }

  async loadLigatures() {
    if (this.#ligatures || this.#h.disposed || !this.#h.term || !this.#webgl) return;
    try {
      const { LigaturesAddon } = await import("@xterm/addon-ligatures");
      // await 사이에 숨겨지거나 dispose 되거나 WebGL 이 빠졌을 수 있다 — 다시 확인한다.
      const term = this.#h.term;
      if (this.#ligatures || this.#h.disposed || !term || !this.#webgl) return;
      const addon = new LigaturesAddon();
      term.loadAddon(addon);
      this.#ligatures = addon;
    } catch (e) {
      console.warn("[aynx] 합자 애드온을 불러오지 못했습니다 — 합자 없이 계속합니다:", e);
    }
  }

  // ── 인라인 이미지 ──

  #images: ImageAddon | null = null;
  /** 떼면 크기 보고도 되돌린다(애드온은 되돌리지 않는다) */
  #windowOptionsBefore: Terminal["options"]["windowOptions"] | undefined;

  unloadImages() {
    if (!this.#images) return;
    const addon = this.#images;
    this.#images = null;
    try {
      addon.dispose();
      const term = this.#h.term;
      if (term) term.options.windowOptions = this.#windowOptionsBefore ?? {};
    } catch {
      // 이미 터미널이 dispose 중이면 여기서 던질 수 있다 — 무시한다.
    }
  }

  loadImages() {
    const term = this.#h.term;
    if (this.#images || this.#h.disposed || !term) return;
    try {
      this.#windowOptionsBefore = { ...term.options.windowOptions };
      const addon = new ImageAddon(IMAGE_OPTIONS);
      term.loadAddon(addon);
      this.#images = addon;
    } catch (e) {
      console.warn("[aynx] 이미지 애드온을 붙이지 못했습니다 — 그림 없이 계속합니다:", e);
    }
  }
}
