<script lang="ts">
  import { retryWorkspaceMigration, workspaceMigrationBusy, workspaceMigrationProblems } from "$lib/app/workspaces.svelte.js";
  import { tick } from "svelte";
  import { isBrowserChromeCombo, comboFromEvent } from "$lib/keybindings";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  const problems = $derived(workspaceMigrationProblems());
  const busy = $derived(workspaceMigrationBusy());
  let modal = $state<HTMLElement | null>(null);
  $effect(() => { if (problems.length && modal) void tick().then(() => modal?.querySelector<HTMLButtonElement>("button")?.focus()); });
  function onKey(ev: KeyboardEvent): void {
    ev.stopPropagation();
    if (ev.key === "Escape" || isBrowserChromeCombo(comboFromEvent(ev) ?? "")) ev.preventDefault();
    // Tab 은 모달 안에서만 돈다 (`trapTab` — 버튼만 있는 화면이라 버튼 사이를 돈다)
    if (modal) trapTab(ev, modal);
  }
</script>

{#if problems.length > 0}
  <!-- 닫기/백드롭/Escape 경로가 없는 복구 화면. 원본 문제만 표시한다. -->
  <div class="overlay" role="presentation">
    <div class="modal glass-raised" bind:this={modal} data-workspace-migration role="alertdialog" aria-modal="true" aria-labelledby="workspace-migration-title" tabindex="-1"
      onkeydown={onKey}>
      <h2 id="workspace-migration-title">{t("app.workspaces.migration.title")}</h2>
      <p>{t("app.workspaces.migration.note")}</p>
      <ul>{#each problems as problem}
        <li><code>{problem.file} · {problem.index ?? "—"} · {problem.code}</code></li>
      {/each}</ul>
      <div class="actions">
        <button type="button" class="btn btn-secondary" disabled={busy} onclick={() => retryWorkspaceMigration()}>{t("app.workspaces.migration.retry")}</button>
        <button type="button" class="btn danger-solid" disabled={busy} onclick={() => retryWorkspaceMigration(true)}>{t("app.workspaces.migration.fresh")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgb(0 0 0 / 0.3); }
  .modal { width: min(640px, 90vw); max-height: 85vh; overflow: auto; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-surface); background: var(--glass-raised, var(--surface-raised-solid)); color: var(--fg-1); box-shadow: var(--shadow-raised); }
  .btn.danger-solid { color: var(--err); background: var(--err-soft); font-weight: var(--fw-semibold); }
  .btn.danger-solid:hover { background: color-mix(in srgb, var(--err) 22%, var(--err-soft)); }
  h2 { margin: 0 0 12px; font-size: 18px; }
  p { line-height: 1.6; }
  ul { max-height: 35vh; overflow: auto; padding-left: 22px; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
