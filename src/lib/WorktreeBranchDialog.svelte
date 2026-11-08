<script lang="ts">
  /**
   * **브랜치 삭제 — 상자** (docs/log/2026-10-01-worktree-branch-ops.md).
   *
   * 지울 수 있는 브랜치 하나를 고른다. 상태와 실행은 전부 `app/worktree-branch.svelte.ts` 에 있고 이 상자는 그리기만
   * 한다(`WorktreeRemoveDialog` 와 같은 분담 · 같은 상자 모양). Escape 는 여기서 끊는다(뒤의 독까지 닫지 않게).
   * 슬롯 "새 브랜치" 갈래는 2026-10-05 에 뺐다(docs/log/2026-10-05-worktree-one-to-one.md).
   */
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    cancelWorktreeBranch,
    pickBranch,
    submitWorktreeBranch,
    worktreeBranchDialog,
  } from "$lib/app/worktree-branch.svelte.js";

  const d = $derived(worktreeBranchDialog());

  let submitEl = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    if (d) submitEl?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelWorktreeBranch();
  }
</script>

{#if d}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worktree-branch-title"
      tabindex="-1"
      data-worktree-branch="delete"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <h2 id="worktree-branch-title">{t("app.projects.worktrees.branch.delete.title")}</h2>
      <p class="lead">{t("app.projects.worktrees.branch.delete.lead")}</p>
      <div class="list" role="radiogroup" aria-label={t("app.projects.worktrees.branch.list.aria")}>
        {#each d.choices.deletable as b (b)}
          <label class="pick">
            <input
              type="radio"
              name="worktree-branch-pick"
              data-worktree-branch-pick={b}
              checked={d.picked === b}
              disabled={d.busy}
              onchange={() => pickBranch(b)}
            />
            <span>{b}</span>
          </label>
        {/each}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-secondary" disabled={d.busy} onclick={() => cancelWorktreeBranch()}
          >{t("app.projects.worktrees.branch.cancel")}</button
        >
        <button
          type="button"
          class="btn danger"
          data-worktree-branch-submit
          bind:this={submitEl}
          disabled={d.busy || !d.picked}
          onclick={() => void submitWorktreeBranch()}>{t("app.projects.worktrees.branch.delete.submit")}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  /* `WorktreeRemoveDialog.svelte` 의 `.overlay`/`.modal` 과 **같은 값**이다 */
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
    width: 100%;
    max-width: 440px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .lead {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-1);
    cursor: pointer;
  }

  .pick input {
    margin: 0;
    accent-color: var(--accent);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
    margin: 0 0 var(--space-4);
  }

  .pick span {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  /* 삭제 = 되돌릴 수 없는 확정 — 제거 상자와 같은 처방(채운 `--err`) */
  .danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
