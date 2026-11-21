<script lang="ts">
  import { boxStyle, computeLayout, FULL_RECT, toPx, type DividerBox, type Len, type Rect } from "$lib/layout";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { clampRatio, type PaneNode, type PaneSplit, type SplitDir } from "$lib/session";

  let {
    root,
    base = FULL_RECT,
  }: {
    root: PaneNode;
    /** 오케스트레이션 탭은 재생 막대 띠를 뺀 캔버스 — 상자(`pane/boxes.ts` 의 `tabCanvas`)와 같은 값이어야 한다 */
    base?: Rect;
  } = $props();

  // 한 탭의 분할선 레이어. 오버레이(✓ · × · 드랍 미리보기)는 여기 두지 않는다 — 터미널을 덮는 자리라 터미널 상자의 자식이어야 한다
  // (별도 층이면 xterm 의 선택·휠이 죽는다). 분할선은 타일 사이 간격에만 있어 터미널과 겹치지 않는다.

  const lines = $derived(computeLayout(root, base).lines);

  // ── 분할선 드래그 ──

  let host = $state<HTMLDivElement | null>(null);
  let drag = $state<{
    node: PaneSplit;
    dir: SplitDir;
    origin: number;
    size: number;
  } | null>(null);

  function px(l: Len, total: number) {
    return toPx(l, total);
  }

  function startDrag(ev: PointerEvent, d: DividerBox) {
    if (ev.button !== 0 || !host) return;
    const r = host.getBoundingClientRect();
    const size = d.dir === "row" ? px(d.host.w, r.width) : px(d.host.h, r.height);
    if (size <= 0) return;
    const origin =
      d.dir === "row" ? r.left + px(d.host.x, r.width) : r.top + px(d.host.y, r.height);
    drag = { node: d.node, dir: d.dir, origin, size };
    ev.currentTarget instanceof HTMLElement && ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }

  function moveDrag(ev: PointerEvent) {
    if (!drag) return;
    const pos = drag.dir === "row" ? ev.clientX : ev.clientY;
    // 고정 px 몫(`px` — 프로듀서 칸)은 끄는 순간 걷고 비율 하나로 잇는다(선이 포인터를 그대로 따라간다)
    delete drag.node.px;
    drag.node.ratio = clampRatio((pos - drag.origin) / drag.size);
  }

  function endDrag(ev: PointerEvent) {
    if (!drag) return;
    drag = null;
    if (ev.currentTarget instanceof HTMLElement && ev.currentTarget.hasPointerCapture(ev.pointerId))
      ev.currentTarget.releasePointerCapture(ev.pointerId);
  }

  function keyDrag(ev: KeyboardEvent, d: DividerBox) {
    const back = d.dir === "row" ? "ArrowLeft" : "ArrowUp";
    const fwd = d.dir === "row" ? "ArrowRight" : "ArrowDown";
    const step = ev.key === back ? -0.02 : ev.key === fwd ? 0.02 : 0;
    if (step === 0) return;
    ev.preventDefault();
    // 키보드도 지금 보이는 자리에서 2%p — 고정 px 몫을 비율로 접어 넣은 뒤 움직인다
    const size = d.dir === "row" ? (host?.getBoundingClientRect().width ?? 0) * (d.host.w.pct / 100) + d.host.w.px : 0;
    const folded = d.node.px && size > 0 ? clampRatio(d.node.ratio) + d.node.px / size : clampRatio(d.node.ratio);
    delete d.node.px;
    d.node.ratio = clampRatio(folded + step);
  }
</script>

<div class="dividers" bind:this={host}>
  {#each lines as line (line.key)}
    <!-- `<button>` 이다 — div + role="separator" 면 "포커스 가능한 비대화형 요소" a11y 경고가 난다 -->
    <button
      type="button"
      class="divider {line.dir}"
      class:dragging={drag?.node === line.node}
      style={boxStyle(line.rect)}
      title={line.dir === "row" ? t("pane.split.row.title") : t("pane.split.col.title")}
      aria-label={line.dir === "row" ? t("pane.split.row.aria") : t("pane.split.col.aria")}
      onpointerdown={(ev) => startDrag(ev, line)}
      onpointermove={moveDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onkeydown={(ev) => keyDrag(ev, line)}
    ></button>
  {/each}
</div>

<style>
  .dividers {
    position: absolute;
    inset: 0;
  }

  /* 레이어는 `pointer-events: none` 이라 분할선만 커서를 되받는다 */
  .divider {
    position: absolute;
    z-index: 2;
    padding: 0;
    background: transparent;
    border: none;
    appearance: none;
    touch-action: none;
    pointer-events: auto;
  }

  .divider.row {
    cursor: col-resize;
  }

  .divider.col {
    cursor: row-resize;
  }

  .divider::after {
    content: "";
    position: absolute;
    background: transparent;
    border-radius: 2px;
    transition: background 120ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .divider::after {
      transition: none;
    }
  }

  .divider.row::after {
    top: 8px;
    bottom: 8px;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
  }

  .divider.col::after {
    left: 8px;
    right: 8px;
    top: 50%;
    height: 2px;
    transform: translateY(-50%);
  }

  .divider:hover::after,
  .divider:focus-visible::after,
  .divider.dragging::after {
    background: var(--accent);
  }

  .divider:focus-visible {
    outline: none;
  }
</style>
