<script lang="ts">
  /**
   * **앱 툴팁 말풍선** — 창에 한 벌만 뜬다 (docs/log/2026-09-16-themed-tooltips.md).
   *
   * 이 컴포넌트가 하는 일은 셋뿐이다: **리스너 걸기 · 재기 · 그리기**.
   * 무엇을 띄울지는 `tooltip.svelte.ts` 가 정하고(위임 리스너 + `title` 바꿔치기),
   * 어디에 놓을지와 어느 글자가 칩이 되는지는 `tooltip.ts` 의 순수 함수가 정한다.
   *
   * `+page` 에 **한 번만** 마운트한다 (토스트와 같은 규칙). 분리 창도 같은 `+page` 라
   * 창마다 자기 층을 하나씩 갖는다 — 층은 창 밖으로 나가지 않으므로 그것으로 충분하다.
   *
   * 두 걸음으로 그린다: 먼저 **투명하게** 그려 실제 크기를 재고, 그 크기로 자리를 잡은 뒤
   * 보인다. 말풍선의 폭이 내용에 달려 있어(`max-width` 만 고정) 그리기 전에는 알 수 없다.
   */
  import { onMount } from "svelte";
  import { placeTooltip, tooltipSegments } from "$lib/tooltip";
  import { installTooltips, tooltipShown } from "$lib/tooltip.svelte.js";
  import Keys from "$lib/Keys.svelte";

  const tip = $derived(tooltipShown());
  const segments = $derived(tip ? tooltipSegments(tip.text) : []);

  let bubble = $state<HTMLDivElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  onMount(() => installTooltips());

  /** 그려진 뒤 재고 놓는다 — `tip` 이 바뀌면(= 새 말풍선) 이 효과가 다시 돈다 */
  $effect(() => {
    const t = tooltipShown();
    const el = bubble;
    if (!t || !el) {
      pos = null;
      return;
    }
    const box = el.getBoundingClientRect();
    pos = placeTooltip(
      t.rect,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      t.above ? "above" : "below",
    );
  });
</script>

<!--
  `aria-hidden` 인 이유: 이 말풍선은 **순수한 시각 층**이다. 접근성 이름은 요소가 들고 있는
  `aria-label`·`title` 에서 이미 나오므로, 여기에 `role="tooltip"` 을 붙이면 같은 문구가
  두 번 읽힌다.
-->
{#if tip}
  <div
    class="tip"
    class:on={pos !== null}
    aria-hidden="true"
    bind:this={bubble}
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
  >{#each segments as seg, i (i)}{#if seg.kind === "kbd"}<Keys combo={seg.value} size="sm" />{:else}{seg.value}{/if}{/each}{#if tip.sub}<span
        class="sub">{tip.sub}</span
      >{/if}</div>
{/if}

<style>
  /*
    z 130 — 토스트(120) **위**, 그 위로는 아무것도 없다. 툴팁은 메뉴·모달·팔레트 어느 것
    위에서든 그 아래 요소를 설명하는 자리라, 한 층이라도 덮이면 정확히 그 자리에서만
    툴팁이 사라진다. 대신 `pointerdown` 한 번에 지므로(`tooltip.svelte.ts`) 무엇을 가리는
    시간은 사람이 마우스를 멈추고 있는 동안뿐이다.
  */
  .tip {
    position: fixed;
    z-index: 130;
    max-width: 360px;
    padding: 6px var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.45;
    /* `title` 의 `\n` 을 그대로 줄로 읽는다 (탭 툴팁·⋯ 버튼이 여러 줄이다) */
    white-space: pre-line;
    color: var(--fg-1);
    /* 무엇 위에든 뜨므로 비치지 않는 뜬 면 판. 그림자는 없다 — 작은 말풍선에는 가장자리 선
       하나로 족하다(감사: 뜨지 않은 면의 `--shadow-tile` 을 걷는다, docs/log/2026-09-25-finish-menus.md) */
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    /* 커서를 먹으면 자기 밑의 요소에서 pointerout 이 나 말풍선이 깜빡인다 */
    pointer-events: none;
    /* 잰 뒤에야 보인다 — 그 전에는 (0,0) 에 투명하게 서 있다 */
    opacity: 0;
  }

  .tip.on {
    opacity: 1;
    /* 전이 대신 애니메이션인 이유: 재고 클래스를 붙이는 것이 삽입과 같은 프레임이라
       전이는 시작 상태를 못 보고 건너뛸 수 있다. 사라질 때는 페이드가 없다(즉시). */
    animation: tip-in 80ms ease-out;
  }

  @keyframes tip-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tip.on {
      animation: none;
    }
  }

  /* 흐린 곁말(`data-tip-sub`) — 이름 뒤 같은 줄, 한 단계 흐리게 */
  .sub {
    margin-left: 6px;
    color: var(--fg-3);
  }
</style>
