<script lang="ts">
  /**
   * **문서 편집의 비교 보기** — 띠([디스크의 파일이 바뀌었습니다])의 [비교]가 편집 면 자리에 세운다(2026-11-11).
   *
   * 왼쪽 = 방금 읽은 디스크 글, 오른쪽 = 편집기의 지금 글. 읽기 전용이고 병합은 없다. 행 · 접힘 · 다른 곳 수는 순수
   * `doc-compare.ts` 가 셈하고 여기는 그리기만 한다 — 넓으면 두 칸 나란히(한 행 = 좌우 한 줄, 긴 줄은 칸 안에서 접어 두 칸이
   * 함께 자란다 · 세로 스크롤 하나), 좁으면(`isWideEdit` 밖) 한 칸(`−` 줄들 다음 `+` 줄들). 다른 줄은 색과 `−`/`+` 글자 둘로 말한다.
   *
   * 편집기는 내리지 않는다 — `DocView` 가 편집 면(`DocEditPane`)을 **가리기만** 하고 이 보기를 곁에 세운다(되돌리기 기록 ·
   * 커서 · 저장 안 한 글이 산다). 읽기 · 닫기 · 띠와의 수명도 `DocView` 가 쥔다. 문서 안 찾기(`DomFindBar`)는 이 보기의 스크롤
   * 상자(`scrollEl`)를 훑는다 — 줄 번호 · `−`/`+` · 머리 · 접힘 단추는 `data-find-skip` 이나 단추라 빠진다.
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
    /** 넓은 타일 — 두 칸 나란히. 아니면 한 칸 */
    wide: boolean;
    /** [편집으로 돌아가기] · `Esc` */
    onback: () => void;
    /** 스크롤 상자 — 찾기 띠가 훑고 민다 */
    scrollEl?: HTMLDivElement | null;
  } = $props();

  /** 펼친 접힘(`fold.id`) — 결과가 바뀌면(다시 [비교]) 비운다 */
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

  // 서자마자 스크롤 상자로 — 화살표 · PgUp/PgDn 이 밀고 `Esc` 가 돌아간다
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
    /* diff 타일(`DiffView`)과 같은 줄 색 — 성공 · 오류 색을 섞는다(새 색 없음) */
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
    /* 끈끈한 머리 — 밑으로 줄이 지나가니 불투명(`PatchView` 의 나란히 머리와 같다) */
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

  /* 나란히 — 한 행 = 두 칸. 긴 줄은 칸 안에서 접는다(두 칸이 함께 자라 좌우가 어긋나지 않는다) */
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

  /* 한 칸 — 옛 · 새 줄 번호 두 칸 */
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

  /* 같은 줄은 흐리게 — 눈이 다른 줄에 간다 */
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

  /* 맞은편에 줄이 없는 칸 — 빗금(`PatchView` 와 같다) */
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
