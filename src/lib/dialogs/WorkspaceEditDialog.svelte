<script lang="ts">
  import { tick } from "svelte";
  import IconColorFields from "$lib/IconColorFields.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    closeWorkspaceEditPrompt, submitWorkspaceEdit, workspaceEditPrompt as prompt,
  } from "$lib/app/workspace-actions.svelte.js";

  // 폴더 편집처럼 칸 셋을 한 면에 둔다. 생성은 기존 이름 상자, 편집은 이 상자 하나다.
  let input = $state<HTMLInputElement | null>(null);
  // 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 되감는다 (`trapTab`)
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => { if (prompt.open && input) void tick().then(() => { input?.focus(); input?.select(); }); });
  function keydown(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.code !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeWorkspaceEditPrompt();
  }
</script>

{#if prompt.open}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal glass-raised" data-workspace-edit data-inline-edit role="dialog" aria-modal="true"
      aria-labelledby="workspace-edit-title" tabindex="-1" bind:this={modalEl} onkeydown={keydown}>
      <h2 id="workspace-edit-title">{t("app.workspaces.editTitle")}</h2>
      <form onsubmit={(ev) => { ev.preventDefault(); void submitWorkspaceEdit(); }}>
        <fieldset class="fields" disabled={prompt.busy}>
          <label for="workspace-edit-name">{t("app.workspaces.name")}</label>
          <div class="cell">
            <input id="workspace-edit-name" bind:this={input} bind:value={prompt.name} class:bad={prompt.error !== null}
              autocomplete="off" spellcheck="false" oninput={() => prompt.error = null} />
          </div>
          <IconColorFields bind:icon={prompt.icon} bind:color={prompt.color}
            iconId="workspace-edit-icon" colorId="workspace-edit-color" />
        </fieldset>
        {#if prompt.error}<p class="err" role="alert">{prompt.error}</p>{/if}
        <div class="actions">
          <button type="button" class="btn btn-secondary" onclick={closeWorkspaceEditPrompt} disabled={prompt.busy}>{t("app.actions.cancel")}</button>
          <button type="submit" class="btn btn-primary" data-workspace-edit-submit disabled={prompt.busy || !prompt.name.trim()}>{t("app.actions.save")}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  /* 폴더 편집과 같은 한 면 — 이름 → 아이콘 → 색. */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  .modal {
    box-sizing: border-box;
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

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .fields {
    display: grid;
    border: none;
    padding: 0;
    min-width: 0;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .fields label {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .fields input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .fields input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input.bad {
    border-color: var(--err);
  }

  .err {
    font-size: var(--t-xs);
    color: var(--err);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
