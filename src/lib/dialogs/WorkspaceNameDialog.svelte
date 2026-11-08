<script lang="ts">
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { closeWorkspaceNamePrompt, submitWorkspaceName, workspaceNamePrompt as prompt } from "$lib/app/workspace-actions.svelte.js";
  import { focusedPane } from "$lib/app/tabs.svelte.js";
  import { focusPaneBody } from "$lib/pane/focus";
  let input = $state<HTMLInputElement | null>(null);
  // 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 되감는다 (`trapTab`)
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => { if (prompt.open && input) void tick().then(() => { input?.focus(); input?.select(); }); });
  function close(): void {
    closeWorkspaceNamePrompt();
    const pane = focusedPane();
    if (!prompt.open && pane) void tick().then(() => focusPaneBody(pane.id));
  }
</script>

{#if prompt.open}
  <div class="overlay" role="presentation" onmousedown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
    <div class="modal glass-raised" data-workspace-name role="dialog" tabindex="-1"
      aria-label={t("app.workspaces.newTitle")}
      bind:this={modalEl}
      onkeydown={(ev) => { if (modalEl && trapTab(ev, modalEl)) return; ev.stopPropagation(); if (ev.code === "Escape") { ev.preventDefault(); close(); } }}>
      <form onsubmit={(ev) => { ev.preventDefault(); void submitWorkspaceName(); }}>
        <h2>{t("app.workspaces.newTitle")}</h2>
        <input bind:this={input} bind:value={prompt.name} aria-label={t("app.workspaces.name")} disabled={prompt.busy} />
        <div class="actions">
          <button type="button" class="btn btn-secondary" onclick={close} disabled={prompt.busy}>{t("app.workspaces.cancel")}</button>
          <button type="submit" class="btn btn-primary" disabled={prompt.busy || !prompt.name.trim()}>{t("app.workspaces.ok")}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.3);
  }
  .modal {
    width: 320px;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    color: var(--fg-1);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    height: var(--field-height);
    padding: 0 var(--space-3);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
</style>
