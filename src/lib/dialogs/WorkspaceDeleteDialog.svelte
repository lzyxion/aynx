<script lang="ts">
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { closeWorkspaceDeletePrompt, submitWorkspaceDeletePrompt, workspaceDeletePrompt as prompt } from "$lib/app/workspace-actions.svelte.js";
  let submit = $state<HTMLButtonElement | null>(null);
  // 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 되감는다 (`trapTab`)
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => { if (prompt.open && submit) void tick().then(() => submit?.focus()); });
</script>

{#if prompt.open}
  <div class="overlay" role="presentation" onmousedown={(ev) => { if (ev.target === ev.currentTarget) closeWorkspaceDeletePrompt(); }}>
    <div class="modal glass-raised" data-workspace-delete role="dialog" tabindex="-1" aria-label={t("app.workspaces.deleteTitle")}
      bind:this={modalEl}
      onkeydown={(ev) => { if (modalEl && trapTab(ev, modalEl)) return; ev.stopPropagation(); if (ev.code === "Escape") { ev.preventDefault(); closeWorkspaceDeletePrompt(); } }}>
      <form onsubmit={(ev) => { ev.preventDefault(); submitWorkspaceDeletePrompt(); }}>
        <h2>{t("app.workspaces.deleteTitle")}</h2>
        <p>{t("app.workspaces.deleteConfirm", { name: prompt.name, tabs: prompt.tabs, sessions: prompt.sessions })}</p>
        <div class="actions">
          <button type="button" class="btn btn-secondary" onclick={closeWorkspaceDeletePrompt}>{t("app.workspaces.cancel")}</button>
          <button type="submit" class="btn danger-solid" data-workspace-delete-submit bind:this={submit}>{t("app.workspaces.deleteSubmit")}</button>
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
    width: 360px;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
    color: var(--fg-1);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
  }
  p {
    font-size: var(--t-sm);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  /* Destructive button pattern from src/lib/console/PlanList.svelte. */
  .btn.danger-solid {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }

  .btn.danger-solid:hover {
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }
</style>
