<script lang="ts">
  import { onMount } from "svelte";
  import { instructionsApply, instructionsPreview, type FileChange } from "$lib/context";
  import { projects } from "$lib/app/project-list.svelte.js";
  import { canApplyInstructions, displayInstructionPath, groupInstructionChanges } from "$lib/settings/model/instruction-form";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import SettingsSubView from "./SettingsSubView.svelte";

  // 열릴 때 읽기만 한다. [반영]은 백엔드가 지금 파일과 라이브러리로 다시 계산해 쓴다.
  let { onback, onapplied }: { onback: () => void; onapplied: () => void } = $props();
  let rows = $state<FileChange[]>([]);
  let busy = $state(false);
  let ready = $state(false);
  let result = $state(false);
  let error = $state<string | null>(null);
  let closed = false;
  const groups = $derived(groupInstructionChanges(rows));
  const canApply = $derived(ready && !busy && canApplyInstructions(rows));
  const writesHome = $derived(rows.some((row) => row.scope === "global" && (row.action === "create" || row.action === "update")));
  const actionKeys = {
    create: "settings.instructions.action.create", update: "settings.instructions.action.update",
    delete: "settings.instructions.action.delete", unchanged: "settings.instructions.action.unchanged",
    skipped: "settings.instructions.action.skipped", error: "settings.instructions.action.error",
  } as const;

  onMount(() => {
    void preview();
    return () => { closed = true; };
  });

  function projectLabel(id: string | null, path: string): string {
    return id ? projects().find((project) => project.id === id)?.name ?? t("settings.instructions.project.unknown", { id })
      : displayInstructionPath(path, null).replace(/\/[^/]*$/, "");
  }

  async function preview(): Promise<void> {
    if (busy) return;
    busy = true;
    ready = false;
    error = null;
    try {
      const changes = await instructionsPreview();
      if (closed) return;
      rows = changes;
      result = false;
      ready = true;
    } catch (e) {
      if (!closed) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.preview"));
    } finally { busy = false; }
  }

  async function apply(): Promise<void> {
    if (!canApply) return;
    busy = true;
    ready = false;
    error = null;
    try {
      const changes = await instructionsApply();
      if (closed) return;
      rows = changes;
      result = true;
      if (!changes.some((change) => change.action === "error" || change.action === "skipped")) onapplied();
    } catch (e) {
      if (!closed) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.apply"));
    } finally { busy = false; }
  }
</script>

{#snippet changeRow(row: FileChange, base: string | null)}
  <details class="change" class:failure={row.action === "error"} class:skipped={row.action === "skipped"}>
    <summary>
      <span class="badge">{t(actionKeys[row.action])}</span>
      <span class="path" title={row.path}>{displayInstructionPath(row.path, base)}</span>
      {#if row.reason}<span class="reason">{stripReason(row.reason)}</span>{/if}
    </summary>
    {#if row.block !== null}<pre>{row.block}</pre>{:else}<p class="note block-empty">{t("settings.instructions.block.empty")}</p>{/if}
  </details>
{/snippet}

<SettingsSubView title={t("settings.instructions.preview.open")} back={t("settings.instructions.back")}
  backAria={t("settings.instructions.back.aria")} {onback}>
  <p class="note">{t("settings.instructions.preview.note")}</p>
  {#if writesHome}<p class="note home">{t("settings.instructions.preview.home")}</p>{/if}
  <p class="note">{t("settings.instructions.preview.next")}</p>
  <div class="actions">
    <button type="button" class="btn btn-sm btn-secondary" disabled={busy} onclick={() => void preview()}>{t("settings.instructions.preview.again")}</button>
    <button type="button" class="btn btn-sm btn-primary" disabled={!canApply} onclick={() => void apply()}>{t("settings.instructions.apply")}</button>
  </div>
  {#if busy}<p class="note" role="status">{t("settings.instructions.loading")}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if result}<p class="result" role="status">{t("settings.instructions.apply.result")}</p>{/if}
  {#each groups as group (group.id)}
    {@const base = group.scope === "project" ? projects().find((project) => project.id === group.projectId)?.path ?? null : null}
    <section class="change-group">
      <h5>{group.scope === "global" ? t("settings.instructions.scope.global") : projectLabel(group.projectId, (group.changes[0] ?? group.unchanged[0]).path)}{group.host ? ` (${group.host})` : ""}</h5>
      {#each group.changes as row (row.path)}{@render changeRow(row, base)}{/each}
      {#if group.unchangedCount > 0}
        <details class="unchanged">
          <summary>{t("settings.instructions.unchanged.count", { count: group.unchangedCount })}</summary>
          {#each group.unchanged as row (row.path)}{@render changeRow(row, base)}{/each}
        </details>
      {/if}
    </section>
  {:else}
    {#if !busy && !error}<p class="note">{t("settings.instructions.preview.empty")}</p>{/if}
  {/each}
</SettingsSubView>

<style>
  .note { margin: 0 0 var(--space-2); font-size: var(--t-xs); color: var(--fg-2); line-height: 1.6; }
  .home { color: var(--fg-1); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0; }
  .error { color: var(--err); font-size: var(--t-xs); overflow-wrap: anywhere; }
  .result { color: var(--fg-1); font-size: var(--t-sm); }
  .change-group { margin-top: var(--space-3); min-width: 0; }
  h5 { margin: 0 0 var(--space-2); font-size: var(--t-sm); color: var(--fg-1); overflow-wrap: anywhere; }
  .change { border: 1px solid var(--line); border-radius: var(--radius-sm); margin: var(--space-1) 0; overflow: hidden; }
  .change > summary { cursor: pointer; padding: var(--space-2); font-size: var(--t-xs); color: var(--fg-1); overflow-wrap: anywhere; }
  summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .badge { display: inline-block; padding: 2px var(--space-1); margin-right: var(--space-2); background: var(--surface-hover); border-radius: var(--radius-sm); font-family: var(--font-ui); }
  .path { font-family: var(--font-mono); }
  .reason { display: block; margin-top: var(--space-1); color: var(--fg-2); line-height: 1.5; }
  .failure { border-color: var(--err); background: var(--err-soft); }
  .failure .badge, .failure .reason { color: var(--err); }
  .skipped .badge { color: var(--fg-2); }
  pre { margin: 0; padding: var(--space-3); background: var(--surface-field); color: var(--fg-1); font-family: var(--font-mono); font-size: var(--t-xs); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .block-empty { padding: var(--space-2); }
  .unchanged > summary { cursor: pointer; padding: var(--space-2) 0; font-size: var(--t-xs); color: var(--fg-2); }
</style>
