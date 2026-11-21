<script lang="ts">
  // 단추는 여는 단추 밖에 둔다(단추 안 단추 금지).
  import type { Snippet } from "svelte";
  import StatusIcon from "../StatusIcon.svelte";
  import { statusTone, type StatusIcon as StatusIconName } from "../model/status-icon";

  let { name, meta, metaTitle, onopen, badge = null, showActions = false, cover, flag, actions, ...rest }: {
    name: string;
    meta: string;
    metaTitle?: string;
    onopen?: () => void;
    badge?: { icon: StatusIconName; label: string } | null;
    /** 터치 배치 — 올릴 수 없어 단추를 늘 보인다 */
    showActions?: boolean;
    cover: Snippet<[number]>;
    flag?: Snippet;
    actions?: Snippet;
    [attr: string]: unknown;
  } = $props();

  /** 첫 그림에서 0 이면 그림이 튀므로 격자의 최소 폭으로 시작한다 */
  let width = $state(132);
</script>

{#snippet body()}
  <span class="art">
    <span class="cover" bind:clientWidth={width} aria-hidden="true">{@render cover(width || 132)}</span>
    {#if badge}<span class="badge" data-tone={statusTone(badge.icon)} data-card-badge={badge.icon} role="img" aria-label={badge.label} title={badge.label}><StatusIcon icon={badge.icon} size={20} /></span>{/if}
  </span>
  <span class="text"><b class="name">{name}</b><small class="meta" title={metaTitle}>{meta}</small></span>
{/snippet}

<div class="tile" class:show-actions={showActions}>
  {#if onopen}
    <button type="button" class="open" onclick={onopen} {...rest}>{@render body()}</button>
  {:else}
    <div class="open" {...rest}>{@render body()}</div>
  {/if}
  {#if flag || actions}
    <div class="corner">
      {#if flag}<span class="flag">{@render flag()}</span>{/if}
      {#if actions}<span class="acts">{@render actions()}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .tile { position: relative; min-width: 0; }
  .open { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 0; border: 0; border-radius: 16px; background: transparent; color: var(--fg-1); font: inherit; text-align: left; }
  button.open { cursor: pointer; }
  /* 칸을 밀지 않게 그림자로 넓힌다 */
  .open { --hover-bg: color-mix(in srgb, var(--m3-primary-container, var(--accent-soft)) 45%, transparent); transition: background-color 120ms ease, box-shadow 120ms ease; }
  .tile:hover .open { background: var(--hover-bg); box-shadow: 0 0 0 6px var(--hover-bg); }
  button.open:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .art { position: relative; display: block; aspect-ratio: 1; }
  .cover { --album-bg: var(--m3-primary-container, var(--accent-soft)); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 16px; background: var(--album-bg); color: var(--m3-on-primary-container, var(--fg-1)); transition: filter 120ms ease; }
  button.open:hover .cover { filter: brightness(1.06); }

  .badge { position: absolute; right: 6px; bottom: 6px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--bg-panel-base); color: var(--fg-2); }
  .badge[data-tone="accent"] { background: var(--accent-soft); color: var(--on-accent-soft); }
  .badge[data-tone="warn"] { background: var(--warn-soft); color: var(--on-warn-soft); }
  .badge[data-tone="ok"] { background: var(--ok-soft); color: var(--on-ok-soft); }
  .badge[data-tone="err"] { background: var(--err-soft); color: var(--m3-on-error-container, var(--fg-1)); }
  .badge :global(.si[data-status-icon]), .badge :global(.eq[data-eq]) { color: inherit; }

  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { display: -webkit-box; overflow: hidden; font-size: var(--t-sm); font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .meta { display: -webkit-box; overflow: hidden; font-size: var(--t-xs); color: var(--fg-2); overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }

  /* 숨겨도 탭으로 닿게 투명만 */
  .corner { position: absolute; top: 6px; right: 6px; display: flex; justify-content: flex-end; }
  .flag { position: absolute; top: 0; right: 0; display: flex; }
  .acts { display: flex; gap: 4px; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
  .tile:hover .acts, .tile:focus-within .acts, .tile.show-actions .acts { opacity: 1; pointer-events: auto; }
  .tile:hover .flag, .tile:focus-within .flag, .tile.show-actions .flag { opacity: 0; }
  @media (hover: none) {
    .acts { opacity: 1; pointer-events: auto; }
    .flag { opacity: 0; }
  }
</style>
