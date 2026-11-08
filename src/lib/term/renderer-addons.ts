// 터미널 한 장의 렌더러 애드온 — WebGL · 합자 · 인라인 이미지의 붙이기/떼기와 그 상태.
// **언제 붙이고 떼는지는 `Terminal.svelte` 가 정한다**(설정·가시성 `$effect` · `mount()` · 정리 순서) — 여기는 몸통뿐이다. `$effect` 없음.
import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { ImageAddon, type IImageAddonOptions } from "@xterm/addon-image";

/** 애드온이 타일에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface RendererHost {
  /** 마운트 뒤에만 선다 (`null` = 아직 없다 · 이미 걷었다) */
  readonly term: Terminal | null;
  /** 언마운트됐다 — 늦게 끝난 동적 import 는 붙이지 않는다 */
  readonly disposed: boolean;
}

// ---------------------------------------------------------------------------
// 인라인 이미지 — sixel · iTerm2 IIP (docs/log/2026-09-26-osc-notify-inline-images.md)
//
// 공식 `@xterm/addon-image` 다. 기본 켬이고 **합자처럼 열린 타일에도 바로** 붙고 떨어진다
// (`Terminal.svelte` 의 $effect). WebGL 과 달리 **보이는지와 무관하게** 붙어 있다 — 숨은 탭에 도착한
// 그림도 받아 둬야 돌아왔을 때 보인다. 렌더러가 WebGL ↔ DOM 으로 갈려도 애드온이
// `setRenderer` 를 가로채 제 캔버스 층을 다시 얹으므로 여기서 할 일은 없다.
//
// 정적 import 다(합자와 다르다) — 62KB 뿐이고, 동적으로 불러오면 타일이 열리자마자 온
// 그림(autorun 의 `imgcat` 등)이 import 가 끝나기 전에 지나가 버린다.
//
// **모르는 것**: 창 이관(serialize)·리로드 복원은 글자만 옮긴다 — 그림은 따라가지 않는다.
// tmux 는 통과(passthrough)를 일부러 막아 두었으므로 tmux 안에서는 보이지 않는다.
// 로컬 타일은 ConPTY 가 sixel(DCS)을 버리고, 열/행이 실제로 바뀌면 ConPTY 가 화면을 다시 그려
// 그림이 지워진다 (같은 로그의 "알려진 한계").
// ---------------------------------------------------------------------------

/**
 * 애드온 옵션 — 기본에서 바꾼 것은 **`storageLimit` 하나**다.
 *
 * 기본(128MB)은 **터미널 하나**를 전제한 값이다. 이 앱은 타일을 수십 개 띄우고, 저장소는
 * 타일마다 따로라 상한도 타일 수만큼 곱해진다(20타일 × 128MB = 2.5GB — 웹뷰 한 프로세스가
 * 버틸 양이 아니다). 32MB 면 RGBA 로 1920×1080 한 장이 ~8MB 라 화면 너덧 장 분량이 남고,
 * 넘치면 오래된 것부터(FIFO) 버리고 자리표시 무늬로 바뀐다. `pixelLimit`(한 장 16M 픽셀)은
 * 해독 중 잠깐만 드는 값이라 기본을 둔다.
 *
 * `enableSizeReports`(기본 켬)는 `CSI 14/16/18 t` 크기 보고를 연다 — 이미지 도구가 그림을
 * 칸에 맞추려고 묻는 것이고, 돌려주는 것은 창·칸의 픽셀 크기뿐이다.
 */
const IMAGE_OPTIONS: Partial<IImageAddonOptions> = {
  sixelSupport: true,
  iipSupport: true,
  storageLimit: 32,
};

/**
 * 타일 하나의 렌더러 애드온 셋. `Terminal.svelte` 가 옛 상태 자리에서 하나 만든다(컴포넌트 수명).
 * 메서드는 옮기기 전의 함수 몸통 그대로다(`webgl`·`term`·`disposed` 가 필드·게터로 바뀐 것뿐).
 */
export class RendererAddons {
  #h: RendererHost;

  constructor(h: RendererHost) {
    this.#h = h;
  }

  // ---------------------------------------------------------------------------
  // WebGL 렌더러 — **보이는 패널에만** (docs/verification/xterm.md §5, VS Code 전략)
  //
  // Chromium 은 렌더러 프로세스당 WebGL 컨텍스트를 ~16개만 준다. 17번째를 만들면 가장
  // 오래된 것이 **조용히 죽는다** — 탭 17개를 연 사용자의 1번 탭이 백지가 되는 식이다.
  // WebView2 에선 그 상한을 플래그로 못 올린다. 그래서 컨텍스트를 "지금 보이는 패널" 에만
  // 준다: 숨겨지면 dispose 하고 다시 보이면 새로 붙인다. 상한 방어가 목적이지 메모리
  // 절약이 아니다.
  //
  // **떼면 컨텍스트를 바로 돌려준다**(`WEBGL_lose_context`). 애드온의 dispose 는 캔버스만 DOM 에서
  // 걷고 컨텍스트는 GC 를 기다린다 — 탭을 오갈 때마다 죽은 컨텍스트가 쌓여, 보이는 타일이 1~3개인데도
  // "Too many active WebGL contexts" 가 뜨고 렌더러 메모리가 시간당 수십 MB 씩 올랐다(실측 10-15).
  //
  // 컨텍스트 로스(GPU 드라이버 재시작·절전 복귀)는 **재시도하지 않는다.** 한 번 잃은
  // 패널은 그 세션이 끝날 때까지 DOM 렌더러로 산다 (VS Code 와 같은 정책) — 로스가
  // 반복되는 기기에서 붙였다 잃었다를 무한히 되풀이하는 것이 더 나쁘다.
  // ---------------------------------------------------------------------------

  #webgl: WebglAddon | null = null;
  /** 그 애드온이 만든 캔버스 — 뗀 뒤 컨텍스트를 돌려줄 손잡이 */
  #webglCanvas: HTMLCanvasElement | null = null;
  /** 이 패널은 컨텍스트를 한 번 잃었다 — 다시 시도하지 않는다 */
  #webglLost = false;

  /** WebGL 렌더러가 지금 붙어 있는가 (합자는 이것이 참일 때만 붙인다) */
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
    // 이미 있는 webgl2 캔버스의 `getContext` 는 새로 만들지 않고 그 컨텍스트를 돌려준다.
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
        // 합자 조이너는 WebGL 렌더러만 소비한다 (xterm 6). 컨텍스트를 잃으면 DOM 렌더러가
        // 되어 합자가 무의미해지므로 애드온도 함께 뗀다 (조이너 오버헤드만 남기지 않는다).
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
      // WebGL2 자체가 없는 기기 — 조용히 DOM 렌더러로 산다 (기능 손실은 없다).
      console.warn("[aynx] WebGL 렌더러를 쓸 수 없습니다 — DOM 렌더러로 계속합니다:", e);
      this.#webglLost = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 합자(ligatures) — 옵트인 (docs/verification/ligatures.md)
  //
  // **xterm 6 에서 합자는 WebGL 렌더러에서만 그려진다.** `registerCharacterJoiner`(합자
  // 애드온이 쓰는 API)의 타이핑 주석이 "character joiners are only used by the webgl
  // renderer" 라고 못박는다 — 예전의 "DOM/canvas 전용" 통설과 정반대다(xterm 5 에선 canvas).
  // 그래서 이 앱은 합자를 켜면 **WebGL 을 강제로 켠다** (`Terminal.svelte` 의 $effect 의 `useWebgl`).
  //
  // 애드온은 동적 import 로 지연 로드한다 — 켰을 때만 비용을 내고, 로드/폰트 실패가 터미널을
  // 무너뜨리지 않게 전부 try/catch 로 감싼다(실패하면 조용히 합자 없이 간다). WebGL 이
  // 붙은 뒤에 붙여야 조이너가 소비된다.
  // ---------------------------------------------------------------------------

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
    // WebGL 이 서 있어야 의미가 있다 (조이너를 WebGL 렌더러가 소비한다).
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
      // 애드온·폰트 로드 실패 — 합자 없이 계속한다 (기능 손실뿐, 터미널은 멀쩡하다).
      console.warn("[aynx] 합자 애드온을 불러오지 못했습니다 — 합자 없이 계속합니다:", e);
    }
  }

  // ── 인라인 이미지 (위 머리말) ──────────────────────────────────────────────

  #images: ImageAddon | null = null;
  /** 애드온을 붙이기 전의 `windowOptions` — 떼면 크기 보고도 되돌린다 (애드온은 되돌리지 않는다) */
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
      // 애드온 실패 — 그림 없이 계속한다 (시퀀스는 xterm 이 조용히 버린다, 터미널은 멀쩡하다).
      console.warn("[aynx] 이미지 애드온을 붙이지 못했습니다 — 그림 없이 계속합니다:", e);
    }
  }
}
