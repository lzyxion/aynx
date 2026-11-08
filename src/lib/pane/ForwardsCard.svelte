<script lang="ts">
  /**
   * **포워딩 칩 호버 카드** (2026-10-11) — 머리줄 포워딩 칩에 얹으면 뜨는, 이 타일의 포워드를 한 줄씩 늘어놓은 작은 카드.
   * 예전에는 칩의 `title`(여러 줄 글자 — 머리 + 터널마다 한 줄 + 중계 중 연결 수)였다. tmux 칩 호버 카드
   * (`TmuxSessionsCard.svelte`)와 **같은 판·같은 몸짓**이다.
   *
   * ```text
   * 포트 포워딩 2개              연결 2개 중계 중
   * ● -L 127.0.0.1:15432 → localhost:5432   활성 2
   * ○ -D SOCKS 127.0.0.1:1080               대기 중
   * ```
   *
   * 자리·층·몸짓은 tmux 카드와 같다: `position: fixed`, 자리는 `placeTooltip`, **타일 상자 밖**(`PaneHost` 최상위)에
   * 그린다, 두 걸음(재고 → 보인다), 커서를 먹지 않는다 — 틀은 공용 `HoverCard.svelte`. `aria-hidden` — 시각 층이다(칩의 `aria-label` 이 이름을
   * 쥐고, 목록은 칩을 누르면 연다). 8줄까지만 그리고 나머지는 `+N`.
   */
  import {
    forwardKindFlag,
    forwardLabel,
    forwardStateLabel,
    isForwardActive,
    relayingConns,
    type ForwardInfo,
  } from "$lib/forward";
  import HoverCard from "$lib/HoverCard.svelte";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    forwards,
    anchor,
  }: {
    forwards: ForwardInfo[];
    /** 칩의 상자(뷰포트 좌표) */
    anchor: TooltipRect;
  } = $props();

  /** 카드에 그리는 줄 수 상한 — 넘으면 `+N` */
  const MAX_SHOWN = 8;

  const shown = $derived(forwards.slice(0, MAX_SHOWN));
  const more = $derived(forwards.length - shown.length);
  const relaying = $derived(relayingConns(forwards));
</script>

<HoverCard
  {anchor}
  watch={forwards}
  minWidth={220}
  maxWidth={420}
  padX="10px"
  gap="7px"
  lineHeight={1.3}
  data-forwards-card=""
>
  <div class="f-head">
    <span class="f-title">{t("pane.header.forward.title", { n: forwards.length })}</span>
    {#if relaying > 0}
      <span class="f-relay">{t("pane.header.forward.relaying", { n: relaying })}</span>
    {/if}
  </div>
  <div class="f-list">
    {#each shown as f (f.id)}
      {@const on = isForwardActive(f)}
      <div class="f-row">
        <span class="f-dot" class:on></span>
        <span class="f-flag">{forwardKindFlag(f)}</span>
        <span class="f-route">{forwardLabel(f, t)}</span>
        <span class="f-state" class:on>{forwardStateLabel(f, t)}</span>
      </div>
    {/each}
    {#if more > 0}
      <span class="f-more">{t("pane.tmux.card.more", { n: more })}</span>
    {/if}
  </div>
</HoverCard>

<style>
  /* 머리 — 개수(남는 폭) + 중계 중 연결 수(초록) */
  .f-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .f-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
  }
  .f-relay {
    color: var(--ok);
    white-space: nowrap;
  }

  .f-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .f-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  /* 상태 점 — 목록 메뉴의 점과 같은 값 */
  .f-dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-muted);
    opacity: 0.5;
  }
  .f-dot.on {
    background: var(--ok);
    opacity: 1;
  }
  .f-flag {
    flex: none;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }
  .f-route {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .f-state {
    flex: none;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .f-state.on {
    color: var(--ok);
  }
  .f-more {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }
</style>
