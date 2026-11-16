<script lang="ts">
  import { templateCells, type TemplateChip } from "$lib/tab-templates";
  import type { SavedNode } from "$lib/tabs";
  import { chipLabel } from "$lib/app/tab-templates.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **탭 템플릿의 작은 분할 그림**(2026-11-16) — 저장 상자와 프로젝트 시작 화면의 템플릿 카드가 함께 쓴다. 칸은 순수 층
   * `templateCells` 가 비율로 내고, 여기는 칸마다 종류 글자 하나를 얹은 상자를 그린다(AI 칸만 강조색 — 강조는 아껴 쓴다).
   */
  let { root, width = 96, height = 60 }: { root: SavedNode; width?: number; height?: number } = $props();

  const cells = $derived(templateCells(root));

  const short = (chip: TemplateChip) => chipLabel(chip);
</script>

<div class="tpl-preview" style:width="{width}px" style:height="{height}px" role="img" aria-label={t("app.tabTemplates.preview.aria")}>
  {#each cells as c, i (i)}
    <span
      class="cell"
      class:ai={c.chip === "ai"}
      data-chip={c.chip}
      style:left="{c.x * 100}%"
      style:top="{c.y * 100}%"
      style:width="{c.w * 100}%"
      style:height="{c.h * 100}%"
      ><span class="in">{#if c.w * width >= 26 && c.h * height >= 14}{short(c.chip)}{/if}</span></span
    >
  {/each}
</div>

<style>
  .tpl-preview {
    position: relative;
    flex: none;
  }

  /* 칸 사이 틈은 안쪽 상자의 여백으로 — 바깥 사각형은 비율 그대로 붙어 선다 */
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
    font-size: 9px;
    line-height: 1;
    color: var(--fg-3);
    white-space: nowrap;
    background: var(--surface-hover);
    border: 1px solid var(--line);
    border-radius: 4px;
  }

  .cell.ai .in {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
</style>
