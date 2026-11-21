<script lang="ts">
  /**
   * 문서 편집의 비교 보기 — 왼쪽 = 디스크 글, 오른쪽 = 편집기의 지금 글. 읽기 전용 · 병합 없음.
   * 편집 면(`DocEditPane`)은 내리지 않고 가리기만 한다 — 내리면 되돌리기 기록 · 커서 · 저장 안 한 글이 사라진다.
   */
  import { onMount } from "svelte";
  import { unifiedRows, type CompareResult, type CompareRow, type CompareLine } from "$lib/doc-compare";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    result,
    wide,
    onback,
    scrollEl = $bindable(null),
  }: {
    result: CompareResult;
    wide: boolean;
    onback: () => void;
    /** 찾기 띠(`DomFindBar`)가 이 상자를 훑는다 */
    scrollEl?: HTMLDivElement | null;
  } = $props();

  let opened = $state<ReadonlySet<number>>(new Set());
  $effect(() => {
    void result;
    opened = new Set();
  });

  const rows = $derived(result.kind === "diff" ? (wide ? result.rows : unifiedRows(result.rows)) : []);

  function expand(id: number) {
    opened = new Set([...opened, id]);
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape" && !ev.defaultPrevented && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      onback();
    }
  }

  onMount(() => scrollEl?.focus({ preventScroll: true }));
</script>

{#snippet cell(side: "old" | "new", line: CompareLine | null, kind: "same" | "del" | "add")}
  {#if line}
    <div class="side {side} k-{kind}">
      <span class="no" data-find-skip>{line.no}</span>
      <span class="sg" data-find-skip>{kind === "del" ? "−" : kind === "add" ? "+" : ""}</span>
      <span class="tx">{line.text}</span>
    </div>
  {:else}
    <div class="side {side} fill"></div>
  {/if}
{/snippet}

{#snippet splitRow(r: CompareRow)}
  {#if r.kind === "fold"}
    {@render fold(r)}
  {:else if r.kind === "same"}
    <div class="pair">{@render cell("old", r.left, "same")}{@render cell("new", r.right, "same")}</div>
  {:else if r.kind === "del"}
    <div class="pair">{@render cell("old", r.left, "del")}{@render cell("new", null, "add")}</div>
  {:else if r.kind === "add"}
    <div class="pair">{@render cell("old", null, "del")}{@render cell("new", r.right, "add")}</div>
  {:else}
    <div class="pair">{@render cell("old", r.left, "del")}{@render cell("new", r.right, "add")}</div>
  {/if}
{/snippet}

{#snippet oneRow(r: CompareRow)}
  {#if r.kind === "fold"}
    {@render fold(r)}
  {:else if r.kind === "same"}
    <div class="ln k-same">
      <span class="no" data-find-skip>{r.left.no}</span><span class="no" data-find-skip>{r.right.no}</span><span
        class="sg"
        data-find-skip
      ></span><span class="tx">{r.right.text}</span>
    </div>
  {:else if r.kind === "del"}
    <div class="ln k-del">
      <span class="no" data-find-skip>{r.left.no}</span><span class="no" data-find-skip></span><span class="sg" data-find-skip
        >−</span
      ><span class="tx">{r.left.text}</span>
    </div>
  {:else if r.kind === "add"}
    <div class="ln k-add">
      <span class="no" data-find-skip></span><span class="no" data-find-skip>{r.right.no}</span><span class="sg" data-find-skip
        >+</span
      ><span class="tx">{r.right.text}</span>
    </div>
  {/if}
{/snippet}

{#snippet fold(r: Extract<CompareRow, { kind: "fold" }>)}
  {#if opened.has(r.id)}
    {#each r.rows as inner, i (i)}{#if wide}{@render splitRow(inner)}{:else}{@render oneRow(inner)}{/if}{/each}
  {:else}
    <button type="button" class="fold" onclick={() => expand(r.id)}>{t("files.doc.compare.fold", { n: r.rows.length })}</button>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cmp" {onkeydown}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroll" bind:this={scrollEl} tabindex="0" role="region" aria-label={t("files.doc.compare.aria")}>
    {#if result.kind === "diff"}
      {#if wide}
        <div class="heads" data-find-skip>
          <span>{t("files.doc.compare.disk")}</span><span>{t("files.doc.compare.mine")}</span>
        </div>
        {#each rows as r, i (i)}{@render splitRow(r)}{/each}
      {:else}
        <div class="heads one" data-find-skip><span>{t("files.doc.compare.unified")}</span></div>
        {#each rows as r, i (i)}{@render oneRow(r)}{/each}
      {/if}
    {:else}
      <p class="note">
        {result.kind === "same"
          ? t("files.doc.compare.same")
          : result.kind === "eol-only"
            ? t("files.doc.compare.eolOnly")
            : t("files.doc.compare.tooLarge")}
      </p>
    {/if}
  </div>
  <div class="foot">
    {#if result.kind === "diff"}<span>{t("files.doc.compare.hunks", { n: result.hunks })}</span>{/if}
    <span class="sp"></span>
    <button type="button" class="back" onclick={onback}>{t("files.doc.compare.back")}</button>
  </div>
</div>

<style>
  .cmp {
    --plus-fg: color-mix(in srgb, var(--ok) 70%, var(--fg-3));
    --minus-fg: color-mix(in srgb, var(--err) 70%, var(--fg-3));
    --plus-bg: color-mix(in srgb, var(--ok) 14%, transparent);
    --minus-bg: color-mix(in srgb, var(--err) 14%, transparent);
    --row-h: calc(20px * var(--doc-zoom, 1));
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: calc(12px * var(--doc-zoom, 1));
    color: var(--fg);
  }

  .scroll:focus {
    outline: none;
  }

  .heads {
    display: grid;
    grid-template-columns: 1fr 1fr;
    position: sticky;
    top: 0;
    z-index: 1;
    /* 밑으로 줄이 지나가니 불투명 */
    background: var(--tile-sticky, var(--surface-raised));
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
  }

  .heads.one {
    grid-template-columns: 1fr;
  }

  .heads span {
    padding: 3px 12px;
  }

  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .side {
    display: grid;
    grid-template-columns: 44px 16px minmax(0, 1fr);
    min-height: var(--row-h);
    line-height: var(--row-h);
  }

  .side.old {
    border-right: 1px solid var(--border);
  }

  .ln {
    display: grid;
    grid-template-columns: 40px 40px 16px minmax(0, 1fr);
    min-height: var(--row-h);
    line-height: var(--row-h);
  }

  .no {
    padding-right: 8px;
    text-align: right;
    color: var(--fg-3);
    user-select: none;
  }

  .sg {
    text-align: center;
    user-select: none;
  }

  .tx {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding-right: 12px;
  }

  .k-same .tx {
    color: var(--fg-3);
  }

  .k-add {
    background: var(--plus-bg);
  }

  .k-add .sg,
  .k-add .no {
    color: var(--plus-fg);
  }

  .k-del {
    background: var(--minus-bg);
  }

  .k-del .sg,
  .k-del .no {
    color: var(--minus-fg);
  }

  .fill {
    background: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      color-mix(in srgb, var(--fg) 5%, transparent) 6px 12px
    );
  }

  .fold {
    display: block;
    width: 100%;
    min-height: var(--row-h);
    padding: 0 12px;
    font-family: var(--font-ui);
    font-size: 11px;
    text-align: left;
    color: var(--fg-3);
    background: var(--surface-field);
    border: none;
    cursor: pointer;
  }

  .fold:hover {
    color: var(--fg-2);
  }

  .fold:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .note {
    margin: 0;
    padding: var(--space-4) var(--space-5);
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg-2);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--fg-2);
    border-top: 1px solid var(--border);
  }

  .sp {
    flex: 1 1 auto;
  }

  .back {
    flex: 0 0 auto;
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .back:hover {
    background: var(--bg-hover);
  }
</style>
