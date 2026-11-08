<script lang="ts">
  /**
   * **diff 타일의 왼쪽 파일 목록**(넓은 모드 — 커밋한 것 · 커밋 안 한 것 · 파일 줄 · 코멘트 배지) — `DiffView.svelte` 에서 뗀 표시 조각.
   * 읽기 · 고른 파일 · 코멘트는 부모 `DiffView` 가 쥔다. 파일을 누르면 부모의 `select` 를 부를 뿐이다(조회 · 구독 없음).
   * 더함/뺌 칸은 부모의 `counts` 스니펫을 그대로 받아 그린다(좁은 모드 고르개 · 파일 머리와 같은 한 벌).
   */
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { commentEntryKey, type DiffCommentWhere } from "$lib/diff-comments";
  import { entryKey, MAX_FILES, splitPath, type DiffEntry, type DiffFiles } from "$lib/diff-view";

  let {
    files,
    entries,
    committed,
    uncommitted,
    selected,
    commentCount,
    entryWhere,
    select,
    counts,
  }: {
    files: DiffFiles | null;
    entries: DiffEntry[];
    committed: DiffEntry[];
    uncommitted: DiffEntry[];
    selected: string | null;
    commentCount: Map<string, number>;
    entryWhere: (e: DiffEntry) => DiffCommentWhere;
    select: (entry: DiffEntry | null, note?: boolean) => void;
    counts: Snippet<[number | null, number | null, boolean]>;
  } = $props();
</script>

{#snippet fileRow(e: DiffEntry)}
  {@const sp = splitPath(e.path)}
  {@const isSel = entryKey(e) === selected}
  {@const nComments = commentCount.get(commentEntryKey(entryWhere(e), e.path)) ?? 0}
  <button
    type="button"
    class="frow"
    class:sel={isSel}
    aria-pressed={isSel}
    data-diff-file={e.path}
    data-diff-group={e.group}
    title={e.oldPath ? `${e.path}\n${t("app.diff.files.renamed", { old: e.oldPath })}` : e.path}
    onclick={() => select(e)}
  >
    <span class="st st-{e.status}">{e.status}</span>
    <span class="fp"><span class="dir">{sp.dir}</span>{sp.name}</span>
    {#if nComments > 0}
      <span class="cbadge" title={t("app.diff.badge.title", { n: nComments })} data-diff-comment-count>{nComments}</span>
    {:else}
      <span></span>
    {/if}
    {@render counts(e.added, e.deleted, e.binary)}
  </button>
{/snippet}

<div class="flist" role="group" aria-label={t("app.diff.files.aria")}>
  {#if committed.length > 0 || uncommitted.length === 0}
    <div class="fh">{t("app.diff.files.title")}</div>
  {/if}
  {#each committed as e (entryKey(e))}
    {@render fileRow(e)}
  {/each}
  {#if uncommitted.length > 0}
    <div class="fh wip" data-diff-group-head="uncommitted">{t("app.diff.files.uncommitted")}</div>
    {#each uncommitted as e (entryKey(e))}
      {@render fileRow(e)}
    {/each}
  {/if}
  {#if entries.length === 0}
    <div class="muted">{t("app.diff.files.none")}</div>
  {/if}
  {#if files?.truncated}
    <div class="muted">{t("app.diff.files.truncated", { n: MAX_FILES })}</div>
  {/if}
</div>

<style>
  .frow:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .muted {
    padding: 4px 10px;
    font-size: 11.5px;
    color: var(--fg-3);
  }

  .flist {
    display: grid;
    padding: 4px 0;
  }

  .fh {
    padding: 6px 10px 3px;
    font-size: 11px;
    color: var(--fg-3);
  }

  .fh.wip {
    margin-top: 6px;
    border-top: 1px dashed var(--border);
  }

  .frow {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto auto;
    gap: 6px;
    align-items: center;
    width: 100%;
    padding: 3px 10px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .frow:hover {
    background: var(--bg-hover);
  }

  .frow.sel {
    background: var(--accent-soft);
  }

  .st {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-2);
  }

  .st-A {
    color: var(--plus-fg);
  }

  .st-D {
    color: var(--minus-fg);
  }

  .fp {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .dir {
    color: var(--fg-3);
  }

  .cbadge {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 10.5px;
    font-weight: 600;
    line-height: 16px;
  }
</style>
