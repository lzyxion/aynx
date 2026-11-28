<script lang="ts">
  /**
   * 맥락 사용량 칩 — CLI 가 알린 수를 보이기만 한다(앱이 묻지 않는다). 가득 차 가면 곁에 [압축] 이 선다(폰은 풍선 안에서만).
   * 압축 직후의 수는 미터와 기준이 달라 보이지 않는다 — 압축 전 값을 흐리게 두고 다음 턴 값을 기다린다(`stale`).
   */
  import type { ContextView } from "$lib/chat-tile/chat-tile-context";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    view,
    busy,
    canCompact,
    open,
    touch = false,
    ontoggle,
    oncompact,
  }: {
    view: ContextView;
    /** 압축 · 턴이 도는 중 */
    busy: boolean;
    canCompact: boolean;
    open: boolean;
    touch?: boolean;
    ontoggle: (el: HTMLElement) => void;
    oncompact: () => void;
  } = $props();

  const R = 5.5;
  const C = 2 * Math.PI * R;
  const dash = $derived(view.pct === null ? 0 : (C * view.pct) / 100);
  const tip = $derived(
    (view.pct === null ? t("pane.chatTile.ctx.title") : `${t("pane.chatTile.ctx.title")} — ${view.pct}%`) +
      (view.stale ? ` · ${t("pane.chatTile.ctx.src.preCompact")}` : ""),
  );
</script>

<button
  type="button"
  class="ctm"
  class:on={open}
  class:touch
  class:stale={view.stale}
  data-chat-tile-context={view.tone}
  data-chat-tile-context-stale={view.stale ? "" : undefined}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-busy={busy}
  aria-label={`${t("pane.chatTile.ctx.title")} — ${view.label}${view.pct === null ? "" : ` (${view.pct}%)`}`}
  title={tip}
  onclick={(ev) => ontoggle(ev.currentTarget)}
>
  <svg class="ring" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
    <circle class="track" cx="7" cy="7" r={R} />
    {#if view.pct !== null}
      <circle class="fill" cx="7" cy="7" r={R} stroke-dasharray="{dash} {C}" transform="rotate(-90 7 7)" />
    {/if}
  </svg>
  <span class="ctm-word">{touch ? view.short : view.label}</span>
</button>
{#if view.tone === "high" && !touch}
  <button
    type="button"
    class="btn btn-secondary btn-sm ctm-compact"
    aria-disabled={canCompact ? undefined : "true"}
    title={canCompact ? t("pane.chatTile.ctx.compact") : t("pane.chatTile.ctx.busy")}
    data-chat-tile-compact-inline
    onclick={() => {
      if (canCompact) oncompact();
    }}>{t("pane.chatTile.ctx.compactShort")}</button
  >
{/if}

<style>
  .ctm {
    position: relative;
    flex: none;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 6px;
    padding: 0 9px 0 7px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    --ring: var(--fg-2);
  }

  .ctm:hover {
    color: var(--fg-1);
    background: var(--control-tile-bg);
  }

  .ctm.on {
    background: var(--control-tile-bg);
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .ctm:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .ctm[data-chat-tile-context="warn"] {
    --ring: var(--warn);
    color: var(--fg-1);
  }

  .ctm[data-chat-tile-context="high"] {
    --ring: var(--err);
    color: var(--err);
  }

  .ring {
    flex: none;
    display: block;
  }

  .ctm.stale .ring,
  .ctm.stale .ctm-word {
    opacity: 0.5;
  }

  .track {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 2;
  }

  .fill {
    fill: none;
    stroke: var(--ring);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .ctm-word {
    min-width: 0;
  }

  .ctm.touch::after {
    content: "";
    position: absolute;
    inset: -10px -3px;
  }

  .ctm-compact {
    flex: none;
    height: 24px;
    margin-left: 2px;
    padding: 0 10px;
  }

  .ctm-compact[aria-disabled="true"] {
    opacity: 0.5;
    cursor: default;
  }
</style>
