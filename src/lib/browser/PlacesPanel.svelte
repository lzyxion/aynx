<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { formatSize } from "$lib/sftp-browser";
  import type { DiskSpace } from "$lib/fs-backend";
  import type { PlaceItem, PlaceSection } from "$lib/browser/places";
  import { LOW_SPACE_RATIO, usedRatio } from "$lib/browser/file-view";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** 접힘 판정 · 폭은 `pane/head-span` 의 `filePlacesLayout` 한 곳이다 — CSS 컨테이너 쿼리로 따로 판정하면 몸과 머리줄이 접히는 순간이 어긋난다 */
  let {
    sections,
    current,
    width,
    mini = false,
    dropTarget = null,
    disabled = false,
    onpick,
    ondragover,
    ondragleave,
    ondrop,
  }: {
    sections: readonly PlaceSection[];
    current: string;
    /** `filePlacesLayout` 의 `boxW` */
    width: number;
    mini?: boolean;
    dropTarget?: string | null;
    disabled?: boolean;
    onpick: (path: string) => void;
    ondragover?: (ev: DragEvent, path: string) => void;
    ondragleave?: (path: string) => void;
    ondrop?: (ev: DragEvent, path: string) => void;
  } = $props();

  const nameOf = (item: PlaceItem) => (item.labelKey ? t(item.labelKey) : (item.label ?? item.path));

  function titleOf(item: PlaceItem): string {
    if (!item.space) return item.path;
    return `${item.path}\n${t("files.space.of", { free: formatSize(item.space.free), total: formatSize(item.space.total) })}`;
  }

  const usedOf = (s: DiskSpace) => usedRatio(s);
  const lowOf = (s: DiskSpace) => 1 - usedRatio(s) < LOW_SPACE_RATIO;
</script>

<nav class="places" class:mini style:width="{width}px" aria-label={t("files.places.aria")}>
  {#each sections as section (section.id)}
    {#if section.items.length > 0}
      <div class="section">
        <h4 class="head">{t(section.titleKey)}</h4>
        {#each section.items as item (item.id)}
          {@const space = item.space ?? null}
          <button
            type="button"
            class="place"
            class:on={item.path === current}
            class:drop-over={dropTarget === item.path}
            title={titleOf(item)}
            aria-label={nameOf(item)}
            aria-current={item.path === current ? "location" : undefined}
            {disabled}
            data-place={item.path}
            onclick={() => onpick(item.path)}
            ondragover={(ev) => ondragover?.(ev, item.path)}
            ondragleave={() => ondragleave?.(item.path)}
            ondrop={(ev) => ondrop?.(ev, item.path)}
          >
            <UiIcon name={item.icon} size={14} />
            <span class="nm">{nameOf(item)}</span>
            {#if space}
              <span class="cap" class:low={lowOf(space)} aria-hidden="true"
                ><i style:width="{Math.round(usedOf(space) * 100)}%"></i></span
              >
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/each}
</nav>

<style>
  .places {
    flex: 0 0 auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 6px 4px;
    overflow-y: auto;
    background: color-mix(in srgb, var(--fg) 3%, transparent);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .head {
    margin: 0;
    padding: 0 8px 2px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .place {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 4px 8px;
    font-family: var(--font-ui);
    font-size: var(--row-font);
    color: var(--fg-2);
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .place:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .place:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .place:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .place.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .place.drop-over {
    color: var(--fg);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cap {
    flex: 0 0 auto;
    width: 34px;
    height: 4px;
    overflow: hidden;
    background: var(--bg-chip);
    border-radius: 2px;
  }

  .cap i {
    display: block;
    height: 100%;
    background: var(--fg-muted);
  }

  .cap.low i {
    background: var(--warn);
  }

  .places.mini .head,
  .places.mini .nm,
  .places.mini .cap {
    display: none;
  }
  .places.mini .place {
    justify-content: center;
    padding: 6px 0;
  }
</style>
