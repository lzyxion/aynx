<script lang="ts">
  import { onMount } from "svelte";
  import { instructionSave, instructionsImportCandidates, type Instruction } from "$lib/context";
  import { projects } from "$lib/app/project-list.svelte.js";
  import { importSelectionToInstruction, instructionNameOk, type InstructionImportSelection } from "$lib/settings/model/instruction-form";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import SettingsSubView from "./SettingsSubView.svelte";
  import Dropdown from "$lib/Dropdown.svelte";

  // 가져오기는 라이브러리로 복사만 한다. 원본 읽기는 백엔드, 원본 수정은 하지 않는다.
  let { onback, onimported, onbusy }: {
    onback: () => void;
    onimported: (items: Instruction[], failures: { source: string; reason: string }[]) => void;
    onbusy: (busy: boolean) => void;
  } = $props();
  interface ImportRow extends InstructionImportSelection { error: string | null; }
  const uid = $props.id();
  let source = $state("");
  let rows = $state<ImportRow[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let ready = $state(false);
  let error = $state<string | null>(null);
  let request = 0;
  let closed = false;
  const knownProjects = $derived(projects());
  const sourceOptions = $derived([
    { value: "", label: t("settings.instructions.scope.global") },
    ...knownProjects.filter((project) => project.host === null).map((project) => ({ value: project.id, label: project.name })),
  ]);
  const hasRemoteProjects = $derived(knownProjects.some((project) => project.host !== null));
  const selected = $derived(rows.filter((row) => row.selected && row.candidate.skipped === null));
  const valid = $derived(selected.length > 0 && selected.every((row) => instructionNameOk(row.name.trim())));

  onMount(() => {
    void load();
    return () => { closed = true; request++; };
  });

  async function load(): Promise<void> {
    if (busy) return;
    const current = ++request;
    const projectId = source || null;
    loading = true;
    ready = false;
    error = null;
    rows = [];
    try {
      const candidates = await instructionsImportCandidates(projectId);
      if (closed || current !== request) return;
      rows = candidates.map((candidate) => ({ candidate, name: candidate.suggestedName,
        selected: candidate.skipped === null, error: null }));
      ready = true;
    } catch (e) {
      if (!closed && current === request) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.import.error"));
    } finally {
      if (!closed && current === request) loading = false;
    }
  }

  async function save(): Promise<void> {
    if (!ready || loading || busy || !valid) return;
    // 스냅샷의 순서대로 저장한다. 한 줄이 실패해도 뒤의 줄을 계속 가져온다.
    const picked = rows.filter((row) => row.selected && row.candidate.skipped === null);
    busy = true;
    onbusy(true);
    const items: Instruction[] = [];
    const failures: { source: string; reason: string }[] = [];
    try {
      for (const row of picked) {
        if (closed) break;
        const item = importSelectionToInstruction(row);
        if (!item) continue;
        row.error = null;
        try {
          items.push(await instructionSave(item, null));
        } catch (e) {
          const reason = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.save"));
          row.error = reason;
          failures.push({ source: row.candidate.source, reason });
        }
      }
      if (!closed) onimported(items, failures);
    } finally {
      busy = false;
      onbusy(false);
    }
  }
</script>

<SettingsSubView title={t("settings.instructions.import")} back={t("settings.instructions.back")}
  backAria={t("settings.instructions.back.aria")} onback={() => { if (!busy) onback(); }}>
  <p class="note copy-note">{t("settings.instructions.import.copy")}</p>
  <div class="source-field">
    <label id="{uid}-source-label" for="{uid}-source">{t("settings.instructions.import.source")}</label>
    <Dropdown id="{uid}-source" bind:value={source} options={sourceOptions} disabled={busy}
      labelledby="{uid}-source-label" onchange={() => void load()} />
    {#if hasRemoteProjects}<p class="note">{t("settings.instructions.import.remote")}</p>{/if}
  </div>
  {#if loading}<p class="note" role="status">{t("settings.instructions.loading")}</p>{/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
    <button type="button" class="btn btn-sm btn-ghost" disabled={busy || loading} onclick={() => void load()}>{t("settings.instructions.retry")}</button>
  {/if}
  <form onsubmit={(ev) => { ev.preventDefault(); void save(); }}>
    <fieldset disabled={busy || loading}>
      <legend class="sr-only">{t("settings.instructions.import.list")}</legend>
      {#each rows as row, index (row.candidate.source)}
        <div class="candidate" class:skipped={row.candidate.skipped !== null}>
          <div class="candidate-head">
            <input id="{uid}-pick-{index}" type="checkbox" bind:checked={row.selected} disabled={row.candidate.skipped !== null}
              aria-label={t("settings.instructions.import.select", { source: row.candidate.label })} />
            <label class="source-label" for="{uid}-pick-{index}" title={row.candidate.source}>{row.candidate.label}</label>
          </div>
          <label for="{uid}-name-{index}">{t("settings.instructions.field.name")}</label>
          <input id="{uid}-name-{index}" class="value" bind:value={row.name} maxlength={48} autocomplete="off" spellcheck="false"
            disabled={row.candidate.skipped !== null} aria-invalid={row.selected && !instructionNameOk(row.name.trim())}
            aria-describedby={row.selected && !instructionNameOk(row.name.trim()) ? uid + "-name-error-" + index : undefined} />
          {#if row.selected && !instructionNameOk(row.name.trim())}
            <p class="error" id="{uid}-name-error-{index}" role="alert">{t("settings.instructions.error.name")}</p>
          {/if}
          {#if row.candidate.skipped}<p class="note reason">{stripReason(row.candidate.skipped)}</p>{/if}
          {#if row.error}<p class="error" role="alert">{row.error}</p>{/if}
          <details>
            <summary>{t("settings.instructions.import.body")}</summary>
            <pre>{row.candidate.body}</pre>
          </details>
        </div>
      {:else}
        {#if ready && !loading}<p class="note">{t("settings.instructions.import.empty")}</p>{/if}
      {/each}
    </fieldset>
    <div class="actions">
      <button type="submit" class="btn btn-sm btn-primary" disabled={!ready || loading || busy || !valid}>{t("settings.instructions.import")}</button>
    </div>
  </form>
</SettingsSubView>

<style>
  .note { font-size: var(--t-xs); color: var(--fg-2); line-height: 1.6; margin: 0 0 var(--space-2); }
  .copy-note { color: var(--fg-1); }
  .source-field { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-3) 0; }
  label { color: var(--fg-2); font-size: var(--t-xs); }
  .value { width: 100%; min-width: 0; box-sizing: border-box; background: var(--surface-field); color: var(--fg-1); }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .candidate { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-2); margin-bottom: var(--space-2); }
  .candidate-head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
  .source-label { color: var(--fg-1); font-family: var(--font-mono); overflow-wrap: anywhere; }
  .skipped .source-label { color: var(--fg-3); }
  .reason { margin-top: var(--space-2); }
  .error { font-size: var(--t-xs); color: var(--err); overflow-wrap: anywhere; }
  details { margin-top: var(--space-2); }
  summary { cursor: pointer; font-size: var(--t-xs); color: var(--fg-2); }
  summary:focus-visible { outline: 2px solid var(--focus-ring); }
  pre { margin: var(--space-2) 0 0; padding: var(--space-2); background: var(--surface-field); color: var(--fg-1); font-family: var(--font-mono); font-size: var(--t-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
  .actions { display: flex; margin-top: var(--space-3); }
</style>
