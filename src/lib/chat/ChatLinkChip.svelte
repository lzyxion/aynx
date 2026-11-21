<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { linkChipIcon, type LinkChip } from "$lib/side-chat-link";

  let { chip, unlink, touch = false }: { chip: LinkChip; unlink: () => void; touch?: boolean } = $props();

  const icon = $derived(linkChipIcon(chip));
</script>

<span
  class="link-chip"
  class:closed={chip.closed}
  class:off={chip.readable === false}
  class:touch
  title={t("app.chatDock.link.title")}
  data-chat-link-chip={chip.closed ? "closed" : "linked"}
>
  {#if icon === "pane" && chip.tile?.pane}
    <span class="logo"><PaneIcon pane={chip.tile.pane} size={13} /></span>
  {:else}
    <UiIcon name={icon === "ai-off" ? "ai-off" : "link"} size={13} />
  {/if}
  <span class="name">{chip.closed ? t("app.chatDock.link.chipClosed", { name: chip.name }) : chip.name}</span>
  <button
    type="button"
    class="x"
    data-chat-link-unlink
    title={t("app.chatDock.link.unlink")}
    aria-label={t("app.chatDock.link.unlink")}
    onclick={unlink}><UiIcon name="close" size={12} /></button
  >
</span>

<style>
  .link-chip {
    min-width: 0;
    max-width: 100%;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    padding: 0 3px 0 9px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border: 1px solid transparent;
    border-radius: 999px;
  }

  .link-chip :global(svg) {
    flex: none;
  }

  .logo {
    flex: none;
    display: inline-flex;
    align-items: center;
  }

  .link-chip.closed {
    color: var(--fg-3);
    background: transparent;
    border: 1px dashed var(--line-strong);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .x {
    flex: none;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .link-chip.touch {
    height: 32px;
    padding-right: 2px;
  }

  .link-chip.touch .x {
    width: 28px;
    height: 28px;
  }

  .x:hover {
    background: var(--control-ghost-hover);
  }

  .x:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
</style>
