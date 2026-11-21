<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import {
    fileMenuTools,
    foldGap,
    type ToolbarMenuRow,
    type ToolbarTool,
  } from "$lib/browser/toolbar-tools";

  /**
   * 파일 타일의 도구줄 한 줄 (docs/log/2026-10-07-file-tile-dolphin.md).
   *
   * 접힘 판정은 타일 폭 하나(`folded`)다 — 줄 안의 폭을 재서 접으면 접힘이 제 결과에 되먹는다.
   *
   * ### 접혀서 빈 자리는 경로가 한꺼번에 받지 않는다
   * 경로 칸이 빈 폭을 다 받으면 타일을 좁히는데 경로 칸이 갑자기 넓어진다 — 빈칸으로 남겨 줄 폭과 1:1 로 닳게 한다(`foldSpacer` 와 같은 식).
   *
   * 스니펫 내용은 넘겨준 쪽의 스코프로 컴파일된다 — 부모가 단 `.bar-btn` 에 닿도록 버튼 클래스만 전역으로 낸다.
   */
  let {
    disabled = false,
    /** 테두리 · 여백이 없고 제 ⋯ 를 달지 않는다(타일 ⋯ 가 그 줄들을 맡는다) */
    inHead = false,
    nav,
    /** 줄 왼쪽 끝 기준 px — `null` 이면 제 폭 */
    navSpan = null,
    folded = false,
    foldOver = 0,
    location,
    tools = [],
    menuTools = [],
    right,
  }: {
    disabled?: boolean;
    inHead?: boolean;
    nav?: Snippet;
    navSpan?: number | null;
    folded?: boolean;
    foldOver?: number;
    location?: Snippet;
    tools?: readonly ToolbarTool[];
    menuTools?: readonly ToolbarTool[];
    right?: Snippet;
  } = $props();

  const hintOf = (action: string | undefined) =>
    action ? displayCombo(effectiveCombo(action, settings.keybindings)) : "";

  const foldTools = $derived(tools.filter((tool) => tool.fold === true));
  const stayTools = $derived(tools.filter((tool) => tool.fold !== true));

  // ── 제 ⋯ 메뉴 ─────────────────────
  let moreOpen = $state(false);
  let moreBtn = $state<HTMLButtonElement | null>(null);

  // ── 접혀서 빈 폭 ─────────────────────
  let foldEl = $state<HTMLElement | null>(null);
  let foldWidth = $state(0);

  $effect(() => {
    const el = foldEl;
    if (!el) return;
    // + 4 = 무리 뒤 간격(줄의 gap 4px)
    const measure = () => (foldWidth = foldGap(el.offsetWidth + 4, 0));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  let moreTools = $state<ToolbarTool[]>([]);

  const toolRows = $derived<ToolbarMenuRow[]>(
    moreTools.map((tool) => ({
      key: tool.id,
      icon: tool.icon,
      label: tool.label,
      hint: hintOf(tool.action),
      checked: tool.pressed,
      disabled: tool.disabled,
      title: tool.disabled ? (tool.title ?? tool.label) : undefined,
      sep: tool.sep,
    })),
  );

  function toggleMore() {
    if (!moreOpen) moreTools = fileMenuTools(tools, menuTools, folded);
    moreOpen = !moreOpen;
  }

  function closeMenu(back: boolean) {
    moreOpen = false;
    if (back) moreBtn?.focus({ preventScroll: true });
  }

  function pickTool(key: string) {
    runOnMenu(
      () => moreTools.find((tool) => tool.id === key),
      () => closeMenu(true),
      (tool) => tool.run(),
    );
  }
</script>

{#snippet toolButton(tool: ToolbarTool)}
  {#if tool.sep}<span class="bar-sep" aria-hidden="true"></span>{/if}
  <button
    type="button"
    class="bar-btn"
    class:on={tool.pressed === true}
    {...{ [`data-file-${tool.id}`]: "" }}
    title={tool.title ?? tool.label}
    aria-label={tool.label}
    aria-pressed={tool.pressed}
    disabled={tool.disabled}
    onclick={tool.run}><UiIcon name={tool.icon} size={14} /></button
  >
{/snippet}

<div
  class="bar file-bar"
  class:in-head={inHead}
  class:folded
  style:--fold-tools="{foldWidth}px"
  style:--fold-over="{foldOver}px"
>
  {#if !inHead && navSpan !== null}
    <!-- 10px = 줄 왼쪽 여백(6) + 무리 뒤 간격(4) -->
    <span class="nav-span" style:width="calc({navSpan}px - 10px)">{@render nav?.()}</span>
  {:else if !inHead}
    {@render nav?.()}
  {/if}

  {@render location?.()}

  {#if foldTools.length > 0}
    <span class="tools fold" data-head-act bind:this={foldEl}>
      {#each foldTools as tool (tool.id)}{@render toolButton(tool)}{/each}
    </span>
  {/if}

  {#if stayTools.length > 0}
    <span class="tools stay" data-head-act>
      {#each stayTools as tool (tool.id)}{@render toolButton(tool)}{/each}
    </span>
  {/if}

  {#if !inHead && (menuTools.length > 0 || foldTools.length > 0)}
    <span class="more">
      <button
        type="button"
        class="bar-btn"
        bind:this={moreBtn}
        data-file-tools-more
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        title={t("files.toolbar.more")}
        aria-label={t("files.toolbar.more")}
        onclick={toggleMore}><UiIcon name="more" size={14} /></button
      >
      {#if moreOpen && moreBtn}
        <ToolbarMenu
          label={t("files.toolbar.more")}
          rows={toolRows}
          trigger={moreBtn}
          align="right"
          onpick={pickTool}
          onclose={closeMenu}
        />
      {/if}
    </span>
  {/if}
  {@render right?.()}
</div>

<style>
  /* `.bar` 는 전역으로 남긴다 — 문서 · diff · 브랜치 타일의 머리 줄이 이 값에 기대고 있을 수 있다 */
  :global(.bar) {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
  }

  .file-bar {
    padding: 4px 6px;
    border-bottom-color: var(--line);
  }

  .file-bar.in-head {
    flex: 1 1 0;
    min-width: 0;
    padding: 0;
    border-bottom: none;
    /* 줄의 gap 과 같은 값 — `pane/pane-tools.svelte.ts` 가 포커스 밖에서 접힌 무리의 앞 간격을 지우는 데 쓴다 */
    --head-act-gap: 4px;
  }

  .tools {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .more {
    display: inline-flex;
  }

  .nav-span {
    flex: 0 0 auto;
    min-width: max-content;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .bar-sep {
    flex: 0 0 auto;
    width: 1px;
    height: 14px;
    margin: 0 2px;
    background: var(--line);
  }

  /* 열린 메뉴 단추는 켜짐(`--accent-soft`)과 갈린다 — 토글이 아니다 */
  :global(.bar-btn[aria-expanded="true"]) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  /* 접혀도 흐름 밖의 보이지 않는 상자로 남겨 언제나 폭을 잴 수 있게 한다 */
  .file-bar.folded .tools.fold {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
  }
  .file-bar.folded .tools.stay {
    margin-left: max(0px, calc(var(--fold-tools) + var(--fold-over)));
  }

  /* `UiIcon` 은 `display:block` 이라 버튼 안에서 저절로 가운데 서지 않는다 */
  :global(.bar-btn) {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 3px 5px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    min-height: 1.4em;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  :global(.bar-btn:hover:not(:disabled)) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  :global(.bar-btn:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  :global(.bar-btn:disabled) {
    opacity: 0.4;
    cursor: default;
  }

  :global(.bar-btn.on) {
    color: var(--fg);
    background: var(--accent-soft);
  }
</style>
