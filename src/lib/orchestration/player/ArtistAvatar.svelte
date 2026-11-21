<script lang="ts">
  import { artistOf } from "../artists";
  import type { ArtistProfile } from "../artist-form";

  let {
    cli,
    size = 22,
    ring = false,
    square = false,
    dim = false,
    profile = null,
  }: { cli: string | null | undefined; size?: number; ring?: boolean; square?: boolean; dim?: boolean; profile?: Pick<ArtistProfile, "name" | "icon"> | null } = $props();

  const art = $derived(artistOf(cli, profile, size > 48));
</script>

<span class="avatar" class:ring class:square class:dim style:width="{size}px" style:height="{size}px" title={art.name} data-artist={art.cli}>
  {#if art.icon}
    <img src={art.icon} alt={art.name} draggable="false" />
  {:else}
    <span class="letter" style:font-size="{Math.round(size * 0.45)}px" aria-label={art.name}>{art.name.slice(0, 1)}</span>
  {/if}
</span>

<style>
  .avatar {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    background: var(--m3-surface-container-highest, var(--surface-hover));
    box-sizing: content-box;
  }
  .avatar.square {
    border-radius: var(--radius-md, 12px);
  }
  .avatar.ring {
    border: 2px solid var(--album-bg, var(--m3-surface-container-low, var(--bg-panel)));
  }
  .avatar.dim {
    opacity: 0.7;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
  }
  .letter {
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }
</style>
