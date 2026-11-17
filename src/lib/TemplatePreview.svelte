<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { templateCells } from "$lib/tab-templates";
  import type { SavedNode } from "$lib/tabs";
  import { templateLeafLabel, templateLeafLogo } from "$lib/app/tab-templates.svelte.js";
  import { ensureDbConns } from "$lib/app/db-conns.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **탭 템플릿의 작은 분할 그림**(2026-11-16) — 저장 상자 · 프로젝트 시작 화면의 템플릿 카드 · 설정 › 템플릿 줄이 함께 쓴다. 칸은
   * 순수 층 `templateCells` 가 비율로 내고, 여기는 칸마다 **그 타일의 로고**를 얹은 상자를 그린다(2026-11-17 사용자 — "셸" · "DB"
   * 같은 글자 대신). 그림은 타일 앞자리 아이콘(`PaneIcon`)과 같은 규칙(`templateLeafLogo` — 셸 종류 · Claude/Codex · 호스트 아이콘 ·
   * DB 엔진 · UI 아이콘). 칸 이름은 `title` 로 남긴다. AI 칸만 강조색 면(강조는 아껴 쓴다).
   *
   * 로고 크기는 칸에 맞춰 줄고(짧은 변의 70% · 8~18px), 8px 도 안 들어가는 칸은 비워 둔다.
   */
  let { root, width = 96, height = 60 }: { root: SavedNode; width?: number; height?: number } = $props();

  const cells = $derived(
    templateCells(root).map((c) => {
      const side = Math.min(c.w * width, c.h * height) - 5;
      return { ...c, logo: templateLeafLogo(c.leaf), label: templateLeafLabel(c.leaf), size: Math.min(18, Math.floor(side * 0.7)) };
    }),
  );

  // 쿼리 타일의 엔진 로고는 연결 사본에서 찾는다 — 아직 안 읽었으면 읽어 온다(오는 동안은 DB 그림)
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
