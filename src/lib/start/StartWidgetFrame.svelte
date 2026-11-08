<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Box, StartWidgetKind } from "$lib/start-widgets";

  /**
   * **시작 화면 위젯의 판** — 유리 카드 하나(머리 줄 + 줄들) (docs/log/2026-10-28-start-widgets.md).
   *
   * 판 위 자리는 `transform: translate()` 하나로 선다(판 가운데가 0, 0 — `StartPage` 의 `.stage`). 끄는 동안은 그
   * `translate` 에 포인터의 차를 더할 뿐이라 **배치를 다시 계산하지 않는다**(레이아웃 없음 · 합성만). 크기는 놓는 순간 ·
   * 모서리를 끄는 동안만 바뀐다.
   *
   * **편집 모드**(`editing` — 2026-11-03, 휴대폰 홈 화면처럼): 평소(잠김)에는 끌기 · 크기 바꾸기 · × 가 없고 호버해도 아무것도
   * 드러나지 않는다(줄 클릭 · 내용은 그대로). 편집 중에는 모든 위젯에 옅은 점선 윤곽 · × (빼기) · 오른쪽 아래 크기 손잡이가 **한꺼번에**
   * 보이고, **몸 어디를 눌러도** `ongrip` 이 불린다(목록 위젯은 줄 위에서도 — 부르는 쪽이 편집 중 줄 실행을 막는다). 끌기는 부르는
   * 쪽이 포인터가 문턱을 넘을 때 세운다(`StartPage` 의 `armDrag`). 좁은 판(`fixed`)이면 편집 중이어도 끌기 · 크기는 없고 × 만 있다.
   * ×·모서리는 포커스를 가져가지 않는다(`mousedown` 기본 동작을 막는다 — 이 화면의 포커스 주인은 숨은 입력칸 하나다).
   *
   * **맨몸**(`bare` — 시계): 카드 · 머리 줄 없이 내용만 판 위에 뜬다. 배경 · 테두리 · 그림자가 없다. 내용 칸은 상자 전체다(상자
   * 크기는 부르는 쪽이 내용을 감싼 값으로 준다).
   *
   * 치수(머리 40 · 줄 32 · 여백 8 · 두 단 사이 8)는 `start-widgets.ts` 의 상수와 같은 값이다 — 줄 수를 거기서 센다.
   */
  let {
    kind,
    title,
    box,
    offset = null,
    mode = null,
    fixed = false,
    rows,
    count,
    empty = "",
    bare = false,
    editing = false,
    ongrip,
    onremove,
    onresize,
    children,
  }: {
    kind: StartWidgetKind;
    title: string;
    /** 판 위 자리 · 크기 (모서리를 끄는 동안은 그 순간의 크기) */
    box: Box;
    /** 끄는 동안 포인터가 간 만큼(판 좌표) — `transform` 에만 더한다 */
    offset?: { dx: number; dy: number } | null;
    mode?: "drag" | "resize" | null;
    /** 좁은 판 — 쌓아 그린 자리라 옮기기 · 크기 바꾸기가 없다(손잡이 · 모서리를 그리지 않는다, × 는 그대로) */
    fixed?: boolean;
    /** 한 단의 줄 수 — 줄은 단 우선으로 흐르고(단 수는 세운 줄 수가 정한다) */
    rows: number;
    /** 세운 줄 수 — 0 이면 `empty` 안내 한 줄 */
    count: number;
    empty?: string;
    /** 맨몸(시계) — 카드 · 머리 줄 없이 내용만(머리말). `rows` · `count` · `empty` 를 보지 않고 늘 그린다 */
    bare?: boolean;
    /** 편집 모드 — × · 크기 모서리 · 윤곽을 늘 보이고 몸 전체가 끄는 자리(머리말) */
    editing?: boolean;
    ongrip: (ev: PointerEvent) => void;
    onremove: () => void;
    onresize: (ev: PointerEvent) => void;
    children: Snippet;
  } = $props();

  const tx = $derived(box.x + (offset?.dx ?? 0));
  const ty = $derived(box.y + (offset?.dy ?? 0));
  /** 옮기기 · 크기 바꾸기가 되는가 — 편집 중 · 넓은 판 */
  const movable = $derived(editing && !fixed);
</script>

{#snippet removeButton()}
  <button
    type="button"
    class="remove"
    tabindex="-1"
    aria-label={t("app.start.widget.remove", { name: title })}
    title={t("app.start.widget.remove", { name: title })}
    data-widget-remove
    onmousedown={(ev) => ev.preventDefault()}
    onclick={onremove}
  >
    <UiIcon name="close" size={12} />
  </button>
{/snippet}

<!-- 편집 중이면 몸 전체가 끄는 자리다(`data-widget-grip` — 하네스가 끄는 자리를 이 표식으로 찾는다). 잠김 · 좁은 판이면 끌지 않는다 -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="widget"
  class:glass-mid={!bare}
  class:bare
  class:editing
  class:movable
  class:dragging={mode === "drag"}
  class:resizing={mode === "resize"}
  class:fixed
  data-start-widget={kind}
  data-widget-grip={movable ? "" : undefined}
  aria-label={title}
  style:width="{box.w}px"
  style:height="{box.h}px"
  style:transform="translate({tx}px, {ty}px)"
  onpointerdown={movable ? ongrip : undefined}
>
  {#if bare}
    <div class="body">
      {@render children()}
    </div>
    {#if editing}{@render removeButton()}{/if}
  {:else}
    <header class="head">
      <h3>{title}</h3>
      {#if editing}{@render removeButton()}{/if}
    </header>

    {#if count > 0}
      <div class="rows" style:grid-template-rows="repeat({Math.max(1, rows)}, 32px)">
        {@render children()}
      </div>
    {:else if empty}
      <p class="empty">{empty}</p>
    {/if}
  {/if}

  <!-- 크기 손잡이 — 오른쪽 아래 모서리(편집 중 · 넓은 판만) -->
  {#if movable}
    <span
      class="corner"
      role="presentation"
      title={t("app.start.widget.resize", { name: title })}
      data-widget-resize
      onmousedown={(ev) => ev.preventDefault()}
      onpointerdown={onresize}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M9 3 3 9M9 6.5 6.5 9" /></svg>
    </span>
  {/if}
</section>

<style>
  /*
   * 카드 — 글래스면 독과 같은 등급의 떠 있는 면(`.glass-mid` — 10-29: 흐림 24px · 흰 선, 판 진하기는 슬라이더를 탄다).
   * 평면은 판 위의 부품과 같은 칠(`--start-widget-bg` — 크롬 투명도를 탄다) + 안쪽 그림자 선(`--glass-ctl-edge` 가 없으니
   * 머리카락 선). 모서리는 떠 있는 면의 토큰(`--radius-surface` — docs/conventions.md "큰 면의 모서리는 토큰 둘").
   * `overflow: hidden` 이어도 흐림 판은 `inset: 0` 이라 넘침이 없다.
   */
  .widget {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-mid, var(--start-widget-bg, var(--control-tile-bg)));
    border-radius: var(--radius-surface);
    box-shadow: var(--glass-ctl-edge, inset 0 0 0 1px var(--line));
  }

  /* 글래스 — 공용 선 규칙은 이미 있는 선의 색만 바꾸므로(theme.css) 선 하나를 둔다. 색 · 그림자 · `padding-box` 칠은 공용 규칙이
     정한다(안쪽 그림자 선은 그 그림자로 바뀐다 — 흐림 판이 덮어 어차피 보이지 않는다). 상자 크기는 그대로(`border-box` — 줄 수 셈이
     바깥 크기 기준이라 안쪽만 1px 씩 준다 · 아래 여백 8 안에서 끝난다). 평면은 선이 없다 — HEAD 그대로 */
  :global(:root[data-material="glass"]) .widget {
    /* 색은 적지 않는다 — 이 규칙(0,4,0)이 공용 규칙(0,3,1)보다 세서 `border` 단축형이면 색이 `currentColor` 로 되돌아간다 */
    border-width: 1px;
    border-style: solid;
  }

  /* 끄는 동안 — 합성 층에 올리고 그림자로 들어 보인다. **`opacity` 를 낮추지 않는다** — 1 아래면 카드가 배경 뿌리가 되어 흐림이
     창 뒤를 못 본다(theme.css "글래스 면의 등장은 `opacity` 를 움직이지 않는다" 10-28) */
  .widget.dragging {
    z-index: 2;
    box-shadow: var(--glass-ctl-edge, inset 0 0 0 1px var(--line)), var(--shadow-raised);
    will-change: transform;
    cursor: grabbing;
  }

  :global(:root[data-material="glass"]) .widget.dragging {
    box-shadow: var(--glass-shadow), var(--shadow-raised);
  }

  /* 머리 줄 — 위 여백 8 + 줄 32 = 40 (`WIDGET_HEADER_H`) */
  .head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
    box-sizing: border-box;
    height: 40px;
    padding: var(--space-2) var(--space-2) 0;
  }

  .head h3 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 32px;
    color: var(--fg-2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
   * 편집 중 — 옅은 점선 윤곽 하나(움직이는 효과는 없다 — 휴대폰의 흔들림 대신 정적인 표시). 몸 전체가 끄는 자리라 끄는 커서 ·
   * 글자가 잡히지 않게. 줄은 실행되지 않으므로(부르는 쪽) 줄의 손 커서 · 호버 칠을 걷는다.
   */
  .widget.editing {
    outline: 1px dashed var(--line-strong, var(--line));
    /* 줄어든 판(`--start-scale` — `StartPage` 의 무대 배율)에서도 화면에 1px 은 남게 */
    outline-width: max(1px, calc(1px / var(--start-scale, 1)));
    outline-offset: 3px;
  }

  /*
   * 누르는 부품(× · 크기 모서리)은 판이 줄어도 너무 작아지지 않게 — 무대 배율이 0.75 아래면 역배율로 키워 화면 크기를 제 크기의
   * 75% 로 지킨다(판 배율 바닥 0.5 에서 24px × 0.75 = 18px). 키우는 기준점은 위젯 모서리 쪽이라 위젯 밖으로만 조금 넘는다.
   */
  .remove,
  .corner {
    scale: max(1, calc(0.75 / var(--start-scale, 1)));
  }

  .remove {
    transform-origin: right center;
  }

  .corner {
    transform-origin: right bottom;
  }

  .widget.movable {
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .widget.movable.dragging {
    cursor: grabbing;
  }

  .widget.editing :global(.row) {
    cursor: inherit;
  }

  .widget.editing :global(.row:not(.selected):hover) {
    background: transparent;
  }

  .remove {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 24px;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
  }

  /* 제목은 줄의 글자 자리에 맞춘다(손잡이가 있던 자리 — 줄의 안쪽 여백 8) */
  .head h3 {
    padding-left: var(--space-2);
  }

  .remove {
    width: 24px;
    cursor: pointer;
  }

  .remove:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 줄들 — 단 우선으로 흐른다(첫 단을 채우고 다음 단). 줄 수는 위젯 높이에서 셌으므로 넘치지 않는다 — 혹시 넘쳐도 굴리지 않고 자른다 */
  .rows {
    display: grid;
    flex: 1 1 auto;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    column-gap: 8px;
    min-height: 0;
    padding: 0 var(--space-2) var(--space-2);
    overflow: hidden;
  }

  /*
   * 맨몸(시계) — 칠 · 선 · 그림자 · 흐림 없이 내용만(상자가 내용을 꼭 감싼다). 편집 중 윤곽은 위 규칙 그대로(상자 안쪽으로).
   * 글래스의 공용 선 규칙(`border-style`)도 걷는다(위 규칙이 선을 세운다).
   */
  .widget.bare {
    overflow: visible;
    background: none;
    box-shadow: none;
  }

  .widget.bare.editing {
    outline-offset: -1px;
  }

  :global(:root[data-material="glass"]) .widget.bare {
    border-style: none;
  }

  .widget.bare.dragging {
    box-shadow: none;
  }

  :global(:root[data-material="glass"]) .widget.bare.dragging {
    box-shadow: none;
  }

  /* 맨몸의 내용 칸 — 상자 전체(상자가 곧 내용을 감싼 크기다 — 시계). 어림이 모자라도 글자를 자르지 않는다 */
  .bare .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: visible;
  }

  /* 맨몸의 × — 상자가 글자를 꼭 감싸 안에 둘 자리가 없으니 오른쪽 위 모서리 바깥에 걸쳐 뜬다(칩 면 — 월페이퍼 위에서도 보이게) */
  .bare .remove {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 20px;
    height: 20px;
    background: var(--bg-chip);
    border-radius: 999px;
  }

  /* 안내 한 줄 — 좁은 위젯에서 접히면 어절 단위로 (한국어가 글자 중간에서 끊기지 않게) */
  .empty {
    margin: 0;
    padding: var(--space-1) var(--space-4);
    overflow: hidden;
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-3);
    word-break: keep-all;
  }

  .corner {
    position: absolute;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    width: 20px;
    height: 20px;
    padding: 0 5px 5px 0;
    box-sizing: border-box;
    color: var(--fg-3);
    cursor: nwse-resize;
    touch-action: none;
  }

  .corner svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

</style>
