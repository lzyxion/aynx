<script module lang="ts">
  import { loadMermaid } from "$lib/mermaid-loader";

  const CACHE_MAX = 32;
  const cache = new Map<string, string>();

  let seq = 0;
  /** 그리기는 한 줄로 세운다 — `mermaid.initialize` 는 전역 설정이라 겹치면 앞의 것이 뒤의 테마로 그려질 수 있다 */
  let chain: Promise<unknown> = Promise.resolve();

  /** 시퀀스 다이어그램은 `themeVariables.fontSize` 를 보지 않고 제 칸(`actor` · `message` · `note`)을 따로 본다 */
  function render(code: string, theme: "default" | "dark", fontSize: number): Promise<string> {
    const key = `${theme}\n${fontSize}\n${code}`;
    const hit = cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const run = chain.then(async () => {
      const m = await loadMermaid();
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || undefined;
      m.initialize({
        startOnLoad: false,
        // 필수 — 다이어그램 안의 클릭 손잡이 · 스크립트 · HTML 라벨을 막는다(라벨은 mermaid 내장 DOMPurify 를 지난다)
        securityLevel: "strict",
        theme,
        fontFamily: font,
        themeVariables: { fontSize: `${fontSize}px`, ...(font ? { fontFamily: font } : {}) },
        sequence: { actorFontSize: fontSize, messageFontSize: fontSize, noteFontSize: fontSize },
      });
      const id = `aynx-mmd-${++seq}`;
      try {
        const { svg } = await m.render(id, code);
        cache.set(key, svg);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        return svg;
      } finally {
        // 실패하면 mermaid 가 body 에 임시 상자(`d<id>`)·오류 SVG 를 남기기도 한다 — 성공이면 이미 없다
        for (const left of [`d${id}`, id, `i${id}`]) document.getElementById(left)?.remove();
      }
    });
    chain = run.catch(() => {});
    return run;
  }
</script>

<script lang="ts">
  /**
   * `{@html}` 원칙의 첫 번째 예외(둘째는 수식 — `MathView`) — mermaid 가 돌려준 SVG 글자를 그대로 넣는다.
   * `securityLevel: "strict"` 의 출력이라 라벨은 내장 DOMPurify 를 지났고 클릭 손잡이 · 스크립트는 막혀 있다. `bindFunctions` 는 부르지 않는다.
   * 넣는 곳은 아래 `$effect` 의 `innerHTML` 한 곳뿐이다. 늦게 도착한 옛 결과는 토큰으로 버린다 — 새 글의 그림을 덮지 않게.
   * 다이어그램 글자는 문서 검색이 훑지 않는다(`doc-find-dom.ts` 의 `[data-mermaid]`).
   */
  import { tick, untrack } from "svelte";
  import CodeView from "$lib/CodeView.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { appMode } from "$lib/mode.svelte.js";
  import { errorFirstLine } from "$lib/mermaid-text";
  import { docZoomContext } from "$lib/doc-zoom-context";
  import {
    ZOOM_MAX,
    ZOOM_MIN,
    anchoredScroll,
    effectiveZoom,
    toggleZoom,
    wheelZoom,
    zoomIn,
    zoomOut,
    zoomPercent,
    type MermaidZoom,
  } from "$lib/mermaid-zoom";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { code }: { code: string } = $props();

  const theme = $derived<"default" | "dark">(appMode.resolved === "light" ? "default" : "dark");

  let svg = $state<string | null>(null);
  let error = $state<string | null>(null);
  let box = $state<HTMLDivElement | null>(null);
  /** 그리기 전에도 있어야 한다 — 둘레 글자 크기를 잰다 */
  let root = $state<HTMLDivElement | null>(null);

  /** 문서 타일의 글자 크기는 CSS 변수라 직접 볼 수 없어 이 신호로 다시 잰다 */
  const docZoom = docZoomContext();

  let token = 0;
  let lastKey = "";
  $effect(() => {
    const src = code;
    const th = theme;
    // 값은 쓰지 않는다 — 배율이 바뀌면 깨어나 아래에서 글자 크기를 다시 재기 위해 구독만 한다
    void docZoom?.();
    if (!root) return;
    const fs = Math.round(parseFloat(getComputedStyle(root).fontSize)) || 14;
    const key = `${th}\n${fs}\n${src}`;
    if (key === lastKey) return;
    lastKey = key;
    const my = ++token;
    render(src, th, fs).then(
      (out) => {
        if (my !== token) return;
        svg = out;
        error = null;
      },
      (e: unknown) => {
        if (my !== token) return;
        svg = null;
        error = errorFirstLine(e);
      },
    );
  });

  // ── 확대 · 축소 ──

  let zoom = $state<MermaidZoom>(null);
  let fit = $state(1);
  /** mermaid 가 적어 둔 `max-width` — 맞춤으로 돌아갈 때 되살린다 */
  let natural = 0;
  let fitMaxWidth = "";

  const svgEl = () => box?.querySelector<SVGSVGElement>(":scope > svg") ?? null;

  /** 맞춤일 때만 잰다 — 확대 중의 폭은 맞춤이 아니다 */
  function measureFit() {
    const el = svgEl();
    if (!el || natural <= 0 || zoom !== null) return;
    const w = el.getBoundingClientRect().width;
    if (w > 0) fit = Math.min(1, w / natural);
  }

  // SVG 를 넣는 유일한 곳 — 근거는 머리말. 새 그림은 맞춤에서 시작한다
  $effect(() => {
    if (!box || svg === null) return;
    box.innerHTML = svg;
    const el = box.querySelector<SVGSVGElement>(":scope > svg");
    fitMaxWidth = el?.style.maxWidth ?? "";
    const vb = el?.viewBox?.baseVal?.width ?? 0;
    natural = vb > 0 ? vb : parseFloat(fitMaxWidth) || 0;
    // 배율을 읽지 않는다 — 읽으면 배율이 바뀔 때마다 SVG 를 다시 넣는다
    untrack(() => {
      zoom = null;
      measureFit();
    });
  });

  $effect(() => {
    void svg;
    const z = zoom;
    const el = svgEl();
    if (!el || natural <= 0) return;
    if (z === null) {
      el.style.width = "";
      el.style.maxWidth = fitMaxWidth;
    } else {
      el.style.maxWidth = "none";
      el.style.width = `${natural * z}px`;
    }
  });

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => measureFit());
    ro.observe(box);
    return () => ro.disconnect();
  });

  function setZoom(next: MermaidZoom, clientX?: number, clientY?: number) {
    if (!box || next === zoom) return;
    const from = effectiveZoom(zoom, fit);
    const to = effectiveZoom(next, fit);
    const r = box.getBoundingClientRect();
    const ox = clientX === undefined ? box.clientWidth / 2 : clientX - r.left;
    const oy = clientY === undefined ? box.clientHeight / 2 : clientY - r.top;
    const sl = box.scrollLeft;
    const st = box.scrollTop;
    zoom = next;
    void tick().then(() => {
      if (!box) return;
      box.scrollLeft = anchoredScroll(sl, ox, from, to);
      box.scrollTop = anchoredScroll(st, oy, from, to);
      if (next === null) measureFit();
    });
  }

  /** 굴린 양을 모은다 — 터치패드 집기(잘게 오는 `ctrlKey` 휠)가 한 번에 끝까지 튀지 않게. `preventDefault` 를 하려면 passive 가 아니어야 해 손으로 단다 */
  const WHEEL_STEP = 50;
  let wheelAcc = 0;
  $effect(() => {
    const el = box;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      wheelAcc += ev.deltaMode === 0 ? ev.deltaY : ev.deltaY * 40;
      if (Math.abs(wheelAcc) < WHEEL_STEP) return;
      const d = wheelAcc;
      wheelAcc = 0;
      setZoom(wheelZoom(zoom, fit, d), ev.clientX, ev.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  let drag = $state<{ id: number; x: number; y: number; sl: number; st: number } | null>(null);

  function onPointerDown(ev: PointerEvent) {
    if (!box || zoom === null || ev.button !== 0) return;
    if (box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight) return;
    // 끌기가 글자 선택을 시작하지 않게
    ev.preventDefault();
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sl: box.scrollLeft, st: box.scrollTop };
    box.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev: PointerEvent) {
    if (!box || !drag || ev.pointerId !== drag.id) return;
    box.scrollLeft = drag.sl - (ev.clientX - drag.x);
    box.scrollTop = drag.st - (ev.clientY - drag.y);
  }

  function endDrag(ev: PointerEvent) {
    if (!drag || ev.pointerId !== drag.id) return;
    drag = null;
    box?.releasePointerCapture(ev.pointerId);
  }

  const pct = $derived(zoomPercent(zoom, fit));
</script>

<div class="root" bind:this={root}>
{#if svg !== null}
  <div class="mw">
    <!-- 끌기 · 더블클릭 · Ctrl+휠은 포인터의 덤이다 — 같은 일을 하는 단추가 옆에 있다(키보드로 닿는다) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="mmd"
      class:zoomed={zoom !== null}
      class:dragging={drag !== null}
      bind:this={box}
      data-mermaid
      ondblclick={(ev) => setZoom(toggleZoom(zoom), ev.clientX, ev.clientY)}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    ></div>
    <div class="zoom" role="group" aria-label={t("files.doc.md.mermaid.zoom")}>
      <!-- 축소와 확대를 나란히 — 가운데 배율이 둘을 가르면 어색하다(사용자 요청) -->
      <button
        type="button"
        class="btn btn-ghost btn-sm zb pct"
        title={t("files.doc.md.mermaid.zoomfit")}
        aria-label={t("files.doc.md.mermaid.zoomfit")}
        onclick={() => setZoom(null)}>{pct}</button
      >
      <button
        type="button"
        class="btn btn-ghost btn-sm zb"
        title={t("files.doc.md.mermaid.zoomout")}
        aria-label={t("files.doc.md.mermaid.zoomout")}
        disabled={effectiveZoom(zoom, fit) <= ZOOM_MIN + 0.001}
        onclick={() => setZoom(zoomOut(zoom, fit))}
      >
        <UiIcon name="zoom-out" size={13} />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm zb"
        title={t("files.doc.md.mermaid.zoomin")}
        aria-label={t("files.doc.md.mermaid.zoomin")}
        disabled={effectiveZoom(zoom, fit) >= ZOOM_MAX - 0.001}
        onclick={() => setZoom(zoomIn(zoom, fit))}
      >
        <UiIcon name="zoom-in" size={13} />
      </button>
    </div>
  </div>
{:else}
  <div data-mermaid-source>
    {#if error !== null}
      <div class="err" title={error}>
        {error ? t("files.doc.md.mermaid.fail", { reason: error }) : t("files.doc.md.mermaid.fail.bare")}
      </div>
    {/if}
    <CodeView {code} lang={null} framed />
  </div>
{/if}
</div>

<style>
  .mmd {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    padding: var(--space-3);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    /* 문서 본문의 줄바꿈 규칙(`overflow-wrap: anywhere` · `pre-wrap`)이 HTML 라벨로 새지 않게 */
    line-height: normal;
    white-space: normal;
    overflow-wrap: normal;
  }

  .mmd :global(svg) {
    display: block;
    height: auto;
    margin: 0 auto;
  }

  .mmd.zoomed {
    max-height: var(--doc-mmd-max, 70vh);
    overflow: auto;
    cursor: grab;
  }

  .mmd.zoomed.dragging {
    cursor: grabbing;
    user-select: none;
  }

  /* 미는 상자(`.mmd`) 바깥이라 밀어도 단추가 제자리다 */
  .mw {
    position: relative;
    min-width: 0;
  }

  /* `CodeView` `.copy` 와 같은 자리 · 모양 · 호버 규칙 */
  .zoom {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .mw:hover .zoom,
  .mw:focus-within .zoom {
    opacity: 1;
  }

  .zb {
    width: 24px;
    padding: 0;
    background: var(--surface-field-solid);
    border-color: var(--line);
  }

  .zb.pct {
    width: auto;
    min-width: 44px;
    padding: 0 var(--space-1);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
  }

  .zb:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--surface-field-solid);
    border-color: var(--line-strong);
  }

  .root {
    min-width: 0;
  }

  .err {
    margin-bottom: var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
