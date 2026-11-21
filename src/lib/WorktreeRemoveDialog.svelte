<script lang="ts">
  // 브랜치 삭제 칸은 켜 둬도 `-d` 뿐이다 — 병합되지 않은 커밋이 있으면 git 이 거절하고 브랜치는 남는다.
  // Escape 는 여기서 끊는다(`stopPropagation`) — 창의 Escape 사슬로 새면 뒤에 깔린 독까지 함께 닫는다.
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { branchDeleteToggleable } from "$lib/projects";
  import {
    cancelRemoveWorktree,
    setRemoveCloseTabs,
    setRemoveDeleteBranch,
    submitRemoveWorktree,
    worktreeRemoveDialog,
    worktreeRemoveTabs,
  } from "$lib/app/projects.svelte.js";

  const d = $derived(worktreeRemoveDialog());
  const tabs = $derived(worktreeRemoveTabs());
  const branchLabel = $derived(d?.worktree.branch ?? t("app.projects.worktrees.detached"));

  let submitEl = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    if (d) submitEl?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelRemoveWorktree();
  }
</script>

{#if d}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worktree-remove-title"
      tabindex="-1"
      data-worktree-remove
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
      <h2 id="worktree-remove-title">{t("app.projects.worktrees.remove.title")}</h2>
      <p class="lead">
        {t("app.projects.worktrees.remove.confirm", { branch: branchLabel, path: d.worktree.path })}
      </p>

      {#if d.option.kind !== "hidden"}
        <label class="check" class:disabled={d.option.kind === "predates"}>
          <input
            type="checkbox"
            data-worktree-remove-branch
            checked={branchDeleteToggleable(d.option) && d.deleteBranch}
            disabled={d.option.kind === "predates" || d.busy}
            onchange={(e) => setRemoveDeleteBranch(e.currentTarget.checked)}
          />
          <span>{t("app.projects.worktrees.remove.deleteBranch", { branch: d.option.branch })}</span>
        </label>
        <p class="hint" data-worktree-remove-hint>
          {d.option.kind === "predates"
            ? t("app.projects.worktrees.remove.predates")
            : d.option.kind === "merged"
              ? t("app.projects.worktrees.remove.mergedHint")
              : d.option.kind === "remote"
                ? t("app.projects.worktrees.remove.remoteHint")
                : t("app.projects.worktrees.remove.deleteBranch.hint")}
        </p>
      {/if}

      {#if tabs.close.length > 0}
        <label class="check">
          <input
            type="checkbox"
            data-worktree-remove-tabs
            checked={d.closeTabs}
            disabled={d.busy}
            onchange={(e) => setRemoveCloseTabs(e.currentTarget.checked)}
          />
          <span>{t("app.projects.worktrees.remove.closeTabs", { count: tabs.close.length })}</span>
        </label>
        <p class="hint" data-worktree-remove-tabs-hint>{t("app.projects.worktrees.remove.closeTabs.hint")}</p>
      {/if}
      {#if tabs.mixed > 0}
        <p class="hint mixed" data-worktree-remove-mixed>
          {t("app.projects.worktrees.remove.mixedTabs", { count: tabs.mixed })}
        </p>
      {/if}

      <div class="actions">
        <button type="button" class="ghost btn btn-secondary" disabled={d.busy} onclick={() => cancelRemoveWorktree()}
          >{t("app.projects.worktrees.remove.cancel")}</button
        >
        <button
          type="button"
          class="danger btn"
          data-worktree-remove-submit
          bind:this={submitEl}
          disabled={d.busy}
          onclick={() => void submitRemoveWorktree()}>{t("app.projects.worktrees.remove.submit")}</button
        >
      </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* `SnippetSaveDialog.svelte`·`ProjectForm.svelte` 의 `.overlay`/`.modal` 과 **같은 값**이다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  .modal {
    box-sizing: border-box;
    width: 100%;
    max-width: calc(440px + 2 * var(--space-4) + 2px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll` — 흐림 층이 밑동까지 덮게 */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .glass-scroll {
    padding: var(--space-4);
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-1);
    cursor: pointer;
  }

  .check.disabled {
    color: var(--fg-3);
    cursor: default;
  }

  .hint {
    margin: var(--space-1) 0 var(--space-4) calc(18px + var(--space-2));
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /* 칸이 없을 수도 있어(닫을 탭 0) 들여쓰기 없이 선다 */
  .hint.mixed {
    margin-left: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
