<script lang="ts">
  // 다른 기기 크기 안내의 그림. `.size-pop` · `.size-tag` 클래스는 부모의 바깥 누름 판정이 본다.
  import { t as tr } from "$lib/i18n/i18n.svelte.js";
  import type { CardPlace, NoticeAction, NoticeSide, Size2 } from "$lib/term/size-notice";
  import type { TermSize } from "$lib/term/size-owner";
  import UiIcon from "$lib/UiIcon.svelte";

  let {
    kind,
    ownerSize,
    outline,
    card,
    cardW,
    cardH = $bindable(),
    pop = $bindable(),
    buttons,
    onrun,
    ondismiss,
  }: {
    kind: NoticeSide;
    ownerSize: TermSize;
    outline: Size2;
    /** `null` 이면 카드 없이 꼬리표 단추 */
    card: CardPlace | null;
    cardW: number;
    /** 그려지면 잰 값으로 고친다 */
    cardH: number;
    pop: boolean;
    buttons: NoticeAction[];
    onrun: (a: NoticeAction) => void;
    /** `over` 자리 카드의 ✕ */
    ondismiss: () => void;
  } = $props();

  const tag = $derived(tr(`pane.sizeNotice.tag.${kind}`, { cols: ownerSize.cols, rows: ownerSize.rows }));
</script>

{#snippet noticeIcon(kind: string)}
  {#if kind === "remoteDevice"}
    <svg class="size-icon" viewBox="0 0 16 16" aria-hidden="true"
      ><rect x="4.5" y="1.5" width="7" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4" /><path
        d="M7 12.2h2"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      /></svg
    >
  {:else}
    <svg class="size-icon" viewBox="0 0 16 16" aria-hidden="true"
      ><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4" /><path
        d="M5.5 14h5M8 11v3"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      /></svg
    >
  {/if}
{/snippet}
<div class="size-outline" style:width="{outline.width}px" style:height="{outline.height}px" aria-hidden="true"></div>
{#if card}
  <div class="size-tag" style:--outline-w="{outline.width}px" role="status">{@render noticeIcon(kind)}<span>{tag}</span></div>
{:else}
  <button
    type="button"
    class="size-tag interactive"
    style:--outline-w="{outline.width}px"
    aria-expanded={pop}
    title={tr("pane.sizeNotice.tagHint")}
    onclick={() => (pop = !pop)}>{@render noticeIcon(kind)}<span>{tag}</span></button
  >
{/if}
{#if pop && !card}
  <div class="size-pop" style:--outline-w="{outline.width}px" role="dialog" aria-label={tr(`pane.sizeNotice.title.${kind}`)}>
    {#each buttons as b (b.act)}
      <button type="button" class:primary={b.act === "tile"} onclick={() => onrun(b)}>{tr(b.label)}</button>
    {/each}
  </div>
{/if}
{#if card}
  <div
    class="size-card"
    style:left="calc(var(--term-pad) + {card.left}px)"
    style:top="calc(var(--term-pad) + {card.top}px)"
    style:width="{cardW}px"
    bind:offsetHeight={cardH}
    role="status"
  >
    {#if card.side === "over"}
      <button
        type="button"
        class="size-card-x"
        title={tr("app.actions.close")}
        aria-label={tr("app.actions.close")}
        onclick={ondismiss}><UiIcon name="close" size={14} /></button
      >
    {/if}
    <div class="size-card-title" class:with-x={card.side === "over"}>{tr(`pane.sizeNotice.title.${kind}`)}</div>
    <div class="size-card-actions">
      {#each buttons as b (b.act)}
        <button type="button" class:primary={b.act === "tile"} onclick={() => onrun(b)}>{tr(b.label)}</button>
      {/each}
    </div>
  </div>
{/if}


<style>
  /* 층: 테두리 · 꼬리표 · 카드(3) < 배너(4) < 토스트(5) < 확인 막(6). 테두리는 마우스를 받지 않는다(선택은 아래 터미널로). */
  .size-outline {
    position: absolute;
    left: var(--term-pad);
    top: var(--term-pad);
    z-index: 3;
    box-sizing: border-box;
    border: 1.5px dashed color-mix(in srgb, var(--m3-secondary) 70%, transparent);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }
  /* 꼬리표는 위 가장자리의 **오른쪽 끝**에 — 왼쪽(프롬프트 자리)의 첫 줄 글자를 가리지 않게 */
  .size-tag {
    position: absolute;
    left: calc(var(--term-pad) + var(--outline-w, 0px) - 10px);
    top: calc(var(--term-pad) - 10px);
    transform: translateX(-100%);
    z-index: 3;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 9px 0 7px;
    border: 1px solid color-mix(in srgb, var(--m3-secondary) 40%, transparent);
    border-radius: 999px;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: var(--fw-semibold);
    line-height: 1;
    white-space: nowrap;
    color: var(--m3-on-secondary-container);
    background: var(--m3-secondary-container);
    box-shadow: var(--shadow-raised);
    pointer-events: none;
  }
  .size-tag.interactive {
    pointer-events: auto;
    cursor: pointer;
  }
  .size-tag.interactive:hover {
    filter: brightness(1.06);
  }
  .size-tag.interactive:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .size-icon {
    width: 12px;
    height: 12px;
    flex: none;
  }
  .size-card,
  .size-pop {
    position: absolute;
    z-index: 3;
    box-sizing: border-box;
    font-family: var(--font-ui);
    color: var(--m3-on-surface);
    background: var(--m3-surface-container-high);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-raised);
  }
  .size-card {
    padding: 14px 14px 12px;
    animation: size-card-in 140ms ease-out;
  }
  .size-pop {
    left: calc(var(--term-pad) + var(--outline-w, 0px) - 10px);
    top: calc(var(--term-pad) + 16px);
    transform: translateX(-100%);
    display: flex;
    gap: 6px;
    padding: 6px;
  }
  .size-card-title {
    font-size: 13px;
    font-weight: var(--fw-semibold);
  }
  .size-card-title.with-x {
    padding-right: 24px;
  }
  .size-card .size-card-x {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--fg-2);
    background: transparent;
  }
  .size-card .size-card-x:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }
  .size-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .size-card button,
  .size-pop button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    font: inherit;
    font-size: 12px;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    color: var(--m3-on-surface);
    background: transparent;
    cursor: pointer;
  }
  .size-card button:hover,
  .size-pop button:hover {
    background: color-mix(in srgb, var(--m3-on-surface) var(--state-hover), transparent);
  }
  .size-card button.primary,
  .size-pop button.primary {
    border-color: transparent;
    color: var(--m3-on-secondary-container);
    background: var(--m3-secondary-container);
  }
  .size-card button.primary:hover,
  .size-pop button.primary:hover {
    filter: brightness(1.06);
  }
  .size-card button:focus-visible,
  .size-pop button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  @keyframes size-card-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .size-card {
      animation: none;
    }
  }
</style>
