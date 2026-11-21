<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { templateCells } from "$lib/tab-templates";
  import type { SavedNode } from "$lib/tabs";
  import { templateLeafLabel, templateLeafLogo } from "$lib/app/tab-templates.svelte.js";
  import { ensureDbConns } from "$lib/app/db-conns.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { root, width = 96, height = 60 }: { root: SavedNode; width?: number; height?: number } = $props();

  const cells = $derived(
    templateCells(root).map((c) => {
      const side = Math.min(c.w * width, c.h * height) - 5;
      return { ...c, logo: templateLeafLogo(c.leaf), label: templateLeafLabel(c.leaf), size: Math.min(18, Math.floor(side * 0.7)) };
    }),
  );

  $effect(() => {
    if (cells.some((c) => c.leaf.kind === "query")) void ensureDbConns().catch(() => {});
  });
</script>

<div class="tpl-preview" style:width="{width}px" style:height="{height}px" role="img" aria-label={t("app.tabTemplates.preview.aria")}>
  {#each cells as c, i (i)}
    <span
      class="cell"
      class:ai={c.chip === "ai"}
      data-chip={c.chip}
      title={c.label}
      style:left="{c.x * 100}%"
      style:top="{c.y * 100}%"
      style:width="{c.w * 100}%"
      style:height="{c.h * 100}%"
      ><span class="in"
        >{#if c.size >= 8}{#if c.logo.type === "ai"}<AiGlyph name={c.logo.name} size={c.size} />{:else if c.logo.type === "host"}<HostIcon
              icon={c.logo.icon}
              size={c.size}
              fallback={c.logo.fallback}
              color={c.logo.color}
            />{:else}<UiIcon name={c.logo.name} size={c.size} />{/if}{/if}</span
      ></span
    >
  {/each}
</div>

<style>
  .tpl-preview {
    position: relative;
    flex: none;
  }

  .cell {
    position: absolute;
    box-sizing: border-box;
    padding: 1.5px;
  }

  .in {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: hidden;
    line-height: 1;
    color: var(--fg-3);
    background: var(--surface-hover);
    border: 1px solid var(--line);
    border-radius: 4px;
  }

  .in :global(svg),
  .in :global(img) {
    flex: none;
  }

  .cell.ai .in {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
</style>
