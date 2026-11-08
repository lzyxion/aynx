<script lang="ts">
  /**
   * **diff 타일의 범위 · 보기 줄**(`.tools` — 범위 갈래 · 커밋 고르개 · 범위 글자 · 합계 · 한 줄/나란히 · 좁은 모드 파일 고르개) —
   * `DiffView.svelte` 에서 뗀 표시 조각. 명세 · 읽기 · 고른 파일과 동작(`setScope` · `pickCommit` · `setView` · `select`)은 부모가 쥔다.
   * 고르개가 열렸는가(`commitMenu` · `fileMenu`)는 부모 상태(바깥 클릭 · Esc 가 닫는다)를 `bind:` 로 받는다. 메뉴 줄은
   * `runOnMenu`(스냅샷 → 닫기 → 실행) 통로 그대로.
   */
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { relativeTime } from "$lib/notifications";
  import {
    entryKey,
    rangeText,
    shortHash,
    splitPath,
    SPLIT_MIN_WIDTH,
    type DiffCommit,
    type DiffEntry,
    type DiffFiles,
    type DiffScopeKind,
    type DiffSpec,
  } from "$lib/diff-view";

  let {
    spec,
    files,
    branch,
    worktree,
    entries,
    total,
    view,
    splitOk,
    narrow,
    current,
    index,
    selected,
    now,
    commitMenu = $bindable(),
    fileMenu = $bindable(),
    setScope,
    pickCommit,
    setView,
    select,
    scopeLabelCommit,
    closeCommitMenu,
    closeFileMenu,
    counts,
  }: {
    spec: DiffSpec;
    files: DiffFiles | null;
    branch: string | null;
    worktree: string | null;
    entries: DiffEntry[];
    total: { added: number; deleted: number };
    view: "unified" | "split";
    splitOk: boolean;
    narrow: boolean;
    current: DiffEntry | null;
    index: number;
    selected: string | null;
    now: number;
    commitMenu: boolean;
    fileMenu: boolean;
    setScope: (scope: DiffScopeKind, extra?: Partial<DiffSpec>) => void;
    pickCommit: (c: DiffCommit) => void;
    setView: (v: "unified" | "split") => void;
    select: (entry: DiffEntry | null, note?: boolean) => void;
    scopeLabelCommit: () => string;
    closeCommitMenu: () => void;
    closeFileMenu: () => void;
    counts: Snippet<[number | null, number | null, boolean]>;
  } = $props();
</script>

<div class="tools">
  <div class="seg scope" role="group" aria-label={t("app.diff.scope.aria")}>
    <button
      type="button"
      aria-pressed={spec.scope === "branch"}
      disabled={!branch}
      title={branch ? undefined : t("app.diff.scope.branchNone")}
      data-diff-scope-btn="branch"
      onclick={() => branch && setScope("branch", { branch })}
      >{t("app.diff.scope.branch")}
      {#if files?.main}<span class="sub">{t("app.diff.scope.branchSub", { main: files.main })}</span>{/if}</button
    >
    <button
      type="button"
      aria-pressed={spec.scope === "commit"}
      aria-expanded={commitMenu}
      disabled={spec.scope !== "commit" && (files?.commits.length ?? 0) === 0}
      title={spec.scope !== "commit" && (files?.commits.length ?? 0) === 0 ? t("app.diff.scope.commitNone") : undefined}
      data-diff-scope-btn="commit"
      onclick={() => (commitMenu = !commitMenu)}>{scopeLabelCommit()} ▾</button
    >
    <button
      type="button"
      aria-pressed={spec.scope === "wip"}
      disabled={!worktree}
      title={worktree ? undefined : t("app.diff.scope.wipNone")}
      data-diff-scope-btn="wip"
      onclick={() => worktree && setScope("wip", { worktreePath: worktree })}
      >{t("app.diff.scope.wip")}
      {#if files?.wipCount}<span class="badge" data-diff-wip-count>{files.wipCount}</span>{/if}</button
    >
    {#if spec.base && spec.tip}
      <!-- 오케스트레이션 보고의 범위(기준 … 보고 커밋) — 보드의 [diff 보기]가 연 타일에만 -->
      <button
        type="button"
        aria-pressed={spec.scope === "range"}
        title={t("app.diff.scope.rangeTitle")}
        data-diff-scope-btn="range"
        onclick={() => setScope("range")}>{t("app.diff.scope.range")}</button
      >
    {/if}
    {#if commitMenu}
      <div class="menu-surface pop commits" role="menu" aria-label={t("app.diff.commits.aria")} data-diff-commit-menu>
        {#each files?.commits ?? [] as c (c.hash)}
          <button
            type="button"
            class="menu-row crow"
            class:selected={spec.scope === "commit" && !!spec.commit && c.hash.startsWith(spec.commit)}
            role="menuitem"
            data-diff-commit={c.hash}
            onclick={() => runOnMenu(() => c, closeCommitMenu, pickCommit)}
          >
            <span class="h">{shortHash(c.hash)}</span>
            <span class="s">{c.subject}</span>
            <span class="tm">{relativeTime(c.time * 1000, now, t)}</span>
          </button>
        {/each}
        {#if files?.commitsTruncated}
          <div class="menu-title">{t("app.diff.commits.truncated", { n: files.commits.length })}</div>
        {/if}
      </div>
    {/if}
  </div>
  {#if files}
    <span class="range" data-diff-range>{rangeText(spec.scope, files, t)}</span>
  {/if}
  <span class="sp"></span>
  {#if files && !files.merge}
    <span class="sum" data-diff-summary
      >{t("app.diff.summary", { n: entries.length })}
      {#if total.added > 0}<span class="plus">+{total.added}</span>{/if}
      {#if total.deleted > 0}<span class="minus">−{total.deleted}</span>{/if}</span
    >
  {/if}
  <div class="seg view" role="group" aria-label={t("app.diff.view.aria")}>
    <button type="button" aria-pressed={view === "unified"} data-diff-view-btn="unified" onclick={() => setView("unified")}
      >{t("app.diff.view.unified")}</button
    >
    <button
      type="button"
      aria-pressed={view === "split"}
      disabled={!splitOk}
      title={splitOk ? undefined : t("app.diff.view.splitDisabled", { px: SPLIT_MIN_WIDTH })}
      data-diff-view-btn="split"
      onclick={() => setView("split")}>{t("app.diff.view.split")}</button
    >
  </div>
  {#if narrow && files && !files.merge && entries.length > 0}
    <div class="npick">
      <button
        type="button"
        class="picker"
        aria-expanded={fileMenu}
        data-diff-narrow-picker
        onclick={() => (fileMenu = !fileMenu)}
      >
        {#if current}
          {@const sp = splitPath(current.path)}
          <span class="st st-{current.status}">{current.status}</span>
          <span class="fp"><span class="dir">{sp.dir}</span>{sp.name}</span>
          {@render counts(current.added, current.deleted, current.binary)}
        {/if}
        <span class="pos">{t("app.diff.files.pick", { i: index + 1, n: entries.length })} ▾</span>
      </button>
      {#if fileMenu}
        <div class="menu-surface pop files" role="menu" aria-label={t("app.diff.files.aria")} data-diff-file-menu>
          {#each entries as e (entryKey(e))}
            {@const sp = splitPath(e.path)}
            <button
              type="button"
              class="menu-row nrow"
              class:selected={entryKey(e) === selected}
              role="menuitem"
              data-diff-file-item={e.path}
              onclick={() => runOnMenu(() => e, closeFileMenu, (x) => select(x))}
            >
              <span class="st st-{e.status}">{e.status}</span>
              <span class="fp"><span class="dir">{sp.dir}</span>{sp.name}</span>
              {#if e.group === "uncommitted"}<span class="wipmark">✎</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-2);
  }

  .tools {
    flex-wrap: wrap;
    position: relative;
  }

  .sp {
    flex: 1 1 auto;
  }

  .seg button:focus-visible,
  .picker:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  /* 갈래 단추 — 범위 · 보기 */
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: visible;
    position: relative;
  }

  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--fg-2);
    font: inherit;
    font-size: 11.5px;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg button:first-of-type {
    border-left: 0;
    border-radius: 999px 0 0 999px;
  }

  .seg button:last-of-type {
    border-radius: 0 999px 999px 0;
  }

  .seg button:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  /* 고른 갈래 — 이 화면의 선택 표시 */
  .seg button[aria-pressed="true"] {
    background: var(--accent-soft);
    color: var(--fg);
    font-weight: 600;
  }

  .seg button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .seg .sub {
    font-weight: 400;
    color: var(--fg-3);
  }

  .seg .badge {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    font-weight: 600;
    font-size: 10.5px;
  }

  .range {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .sum {
    white-space: nowrap;
    color: var(--fg-2);
    font-size: 11.5px;
  }

  .plus {
    color: var(--plus-fg);
    font-family: var(--font-mono);
  }

  .minus {
    color: var(--minus-fg);
    font-family: var(--font-mono);
  }

  /* 고르개 — 범위 단추 아래 · 좁은 모드 파일 단추 아래 */
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    max-height: 320px;
    overflow: auto;
    min-width: 280px;
    max-width: min(520px, 90cqw);
  }

  .crow,
  .nrow {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .crow .h {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-3);
  }

  .crow .s {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crow .tm {
    font-size: 11px;
    color: var(--fg-3);
  }

  .wipmark {
    margin-left: auto;
    color: var(--fg-3);
  }

  .npick {
    position: relative;
    flex: 1 1 100%;
    min-width: 0;
  }

  .picker {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-field);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .picker .pos {
    margin-left: auto;
    color: var(--fg-3);
    white-space: nowrap;
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
</style>
