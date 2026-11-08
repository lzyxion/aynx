<script lang="ts">
  import { tick } from "svelte";
  import WorkspaceIcon from "$lib/WorkspaceIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { closeWorkspaceSwitcher, currentWorkspaceId, switchWorkspace, workspaceList } from "$lib/app/workspaces.svelte.js";

  let query = $state("");
  let selected = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  const rows = $derived(workspaceList().filter((w) => w.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const index = $derived(Math.min(selected, Math.max(0, rows.length - 1)));
  $effect(() => {
    if (input) void tick().then(() => input?.focus());
  });

  function pick(id: string): void {
    switchWorkspace(id);
    closeWorkspaceSwitcher();
  }
  function keydown(ev: KeyboardEvent): void {
    if (ev.code === "Escape") {
      ev.preventDefault();
      closeWorkspaceSwitcher();
    } else if (ev.code === "Enter") {
      ev.preventDefault();
      if (rows[index]) pick(rows[index].id);
    } else if (ev.code === "ArrowUp" || ev.code === "ArrowDown") {
      ev.preventDefault();
      selected = (index + (ev.code === "ArrowUp" ? -1 : 1) + rows.length) % Math.max(1, rows.length);
    }
    ev.stopPropagation();
  }

</script>

<div class="overlay" role="presentation" onmousedown={(ev) => { if (ev.target === ev.currentTarget) closeWorkspaceSwitcher(); }}>
  <div class="panel glass-raised" role="dialog" aria-label={t("app.workspaces.switch")} data-workspace-switcher>
    <input bind:this={input} bind:value={query} oninput={() => selected = 0} onkeydown={keydown}
      placeholder={t("app.workspaces.filter")} aria-label={t("app.workspaces.filter")}
      aria-controls="workspace-switcher-list" aria-activedescendant={rows[index] ? "ws-option-" + rows[index].id : undefined} />
    <div id="workspace-switcher-list" class="list" role="listbox" aria-label={t("app.workspaces.switch")}>
      {#each rows as workspace, i (workspace.id)}
        <button type="button" role="option" id={"ws-option-" + workspace.id} aria-selected={i === index}
          class:selected={i === index} class:current={workspace.id === currentWorkspaceId()}
          onclick={() => pick(workspace.id)} onkeydown={keydown}>
          <WorkspaceIcon {workspace} /> <span>{workspace.name}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
  }
  .panel {
    position: absolute;
    top: 64px;
    left: 50%;
    translate: -50% 0;
    width: 320px;
    max-width: calc(100vw - 32px);
    padding: var(--space-3);
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .list {
    max-height: 45vh;
    overflow: auto;
    margin-top: var(--space-2);
  }
  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    color: var(--fg-2);
    background: transparent;
    border: none;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  button.selected {
    background: var(--surface-hover);
  }
  button.current {
    color: var(--accent);
  }
</style>
