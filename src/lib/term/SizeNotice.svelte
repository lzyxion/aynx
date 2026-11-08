<script lang="ts">
  /**
   * **다른 기기 크기 안내의 그림**(10-20 — 목업 B) — `Terminal.svelte` 에서 뗀 표시 조각(2026-10-26 분할 3차): 그려진 영역의 점선 테두리 ·
   * 위 가장자리 꼬리표(카드가 없으면 눌러 여는 단추) · 꼬리표 상자 · 카드. 크기 주인 판정 · 잰 값 · 카드 자리 · `refit` · 되찾기와
   * 바깥 누름/Esc 로 닫기는 부모가 쥐고, 여기는 받은 값대로 그리기만 한다 — 단추는 `onrun`, 꼬리표 상자 열림은 `bind:pop`,
   * 카드 높이(잰 값)는 `bind:cardH`. 감싸개 없음 — 부모 `.term` 안에 그대로 선다(`.size-pop` · `.size-tag` 표식은 부모의 바깥 누름 판정이 본다).
   */
  import { t as tr } from "$lib/i18n/i18n.svelte.js";
  import type { CardPlace, NoticeAction, NoticeSide, Size2 } from "$lib/term/size-notice";
  import type { TermSize } from "$lib/term/size-owner";

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
  }: {
    /** 꼬리표 문구 갈래(`noticeSide`) */
    kind: NoticeSide;
    /** 주인의 크기(cols × rows) */
    ownerSize: TermSize;
    /** 점선 테두리 상자(`outlineBox`) */
    outline: Size2;
    /** 카드 자리(`placeCard`) — `null` 이면 카드 없이 꼬리표 단추 */
    card: CardPlace | null;
    /** 카드 폭(px — CSS 고정) */
    cardW: number;
    /** 카드 높이 — 그려지면 잰 값으로 고친다 */
    cardH: number;
    /** 꼬리표를 눌러 연 단추 상자 */
    pop: boolean;
    /** 단추(`noticeActions`) */
    buttons: NoticeAction[];
    onrun: (a: NoticeAction) => void;
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
    <div class="size-card-title">{tr(`pane.sizeNotice.title.${kind}`)}</div>
    <div class="size-card-body">{tr("pane.sizeNotice.body")}</div>
    <div class="size-card-actions">
      {#each buttons as b (b.act)}
        <button type="button" class:primary={b.act === "tile"} onclick={() => onrun(b)}>{tr(b.label)}</button>
      {/each}
    </div>
  </div>
{/if}


<style>
  /*
   * 다른 기기 크기 안내(10-20 — 목업 B). 층: 테두리 · 꼬리표 · 카드(3) < 배너(4) < 토스트(5) < 확인 막(6) — 앱 모달은 그 위.
   * 테두리는 마우스를 받지 않는다(선택은 아래 터미널로). 꼬리표는 그려진 영역의 위 가장자리에 걸친다.
   */
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
  .size-card-body {
    margin-top: 4px;
    word-break: keep-all;
    font-size: 12px;
    line-height: 1.4;
    color: var(--fg-muted);
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
