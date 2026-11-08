<script lang="ts">
  import { boxStyle, computeLayout, FULL_RECT, toPx, type DividerBox, type Len, type Rect } from "$lib/layout";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { clampRatio, type PaneNode, type PaneSplit, type SplitDir } from "$lib/session";

  let {
    root,
    base = FULL_RECT,
  }: {
    /** 이 탭의 패널 트리 (`+page.svelte` 가 소유하는 `$state` 의 일부) */
    root: PaneNode;
    /** 트리의 뿌리 사각형 — 오케스트레이션 탭은 재생 막대 띠를 뺀 캔버스(`pane/boxes.ts` 의 `tabCanvas` — 상자와 같은 값) */
    base?: Rect;
  } = $props();

  // ---------------------------------------------------------------------------
  // 한 탭의 **분할선 레이어**.
  //
  // 예전에는 이 컴포넌트가 패널 목록까지 그렸다. 지금 터미널은 `PaneHost.svelte` 의
  // **앱 전역 목록** 하나에서 그려진다 — 탭 간 이동에서 인스턴스가 살아남으려면 목록이
  // 하나여야 하기 때문이다 (docs/log/2026-09-02-pane-host.md).
  //
  // 그러면 오버레이(✓ · × · 드랍 미리보기)는 왜 같이 못 넘어왔는가: 그것들은 터미널을
  // **덮는** 자리라 반드시 터미널 상자의 자식이어야 한다. 별도 레이어로 띄우면 그 레이어가
  // 커서를 먹어 xterm 의 선택·휠이 죽거나, `pointer-events: none` 으로 비켜 주면 이번엔
  // 오버레이 자체를 못 누른다. 분할선은 사정이 다르다 — **패널 사이 6px 간격**에만 있어서
  // 터미널과 겹치는 면적이 0 이다. 그래서 분할선만 위층에 남았다.
  //
  // 기하는 `layout.ts` 의 같은 함수로 계산한다 — 패널 상자와 분할선이 같은 사각형을 본다.
  // ---------------------------------------------------------------------------

  const lines = $derived(computeLayout(root, base).lines);

  // ---------------------------------------------------------------------------
  // 분할선 드래그
  //
  // pointerdown 에서 노드의 픽셀 영역을 한 번 재 두고(=드래그 중에는 안 바뀐다),
  // 이후 move 는 그 원점·길이로 비율만 환산한다. setPointerCapture 덕에 커서가
  // 터미널 위로 넘어가도 이벤트는 분할선이 계속 받는다.
  // ---------------------------------------------------------------------------

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

  /** 키보드로도 분할선을 움직인다 (한 번에 2%p) */
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
    <!--
      분할선은 `<button>` 이다 — div + role="separator" 로 두면 "포커스 가능한 비대화형
      요소" 로 잡혀 a11y 경고가 난다. 버튼이면 Tab 순회·화살표 조작이 공짜로 따라온다.
    -->
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

  /* 잡기 편하게 GAP 만큼 두껍고, 눈에 보이는 선은 가운데 1px 만.
     레이어는 `pointer-events: none` 이므로 분할선만 커서를 되받는다 */
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

  /* 쉬는 동안은 보이지 않는다 — 타일 사이 거터(빈 공간)가 이미 경계를 말한다.
     잡으려 다가가면(hover·focus·drag) 그때만 accent 로 또렷해진다. */
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
