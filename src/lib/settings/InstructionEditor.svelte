<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { instructionDelete, instructionSave, type AgentArgsTarget, type Instruction } from "$lib/context";
  import { projects } from "$lib/app/project-list.svelte.js";
  import {
    emptyInstructionForm, formToInstruction, instructionFormProblems, instructionProblemKeys, instructionToForm,
    type InstructionForm,
  } from "$lib/settings/model/instruction-form";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import SettingsSubView from "./SettingsSubView.svelte";
  import ChoiceChips, { type ChoiceEntry } from "./ChoiceChips.svelte";
  import AgentChip from "./AgentChip.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import MultiDropdown from "$lib/MultiDropdown.svelte";

  // 초안은 이 화면 안에만 산다. 저장·삭제는 자기 파일에 즉시 쓰고, 파일 반영은 따로 한다.
  let { item, targets, onback, onsaved, ondeleted }: {
    item: Instruction | null;
    targets: AgentArgsTarget[];
    onback: () => void;
    onsaved: (item: Instruction) => void;
    ondeleted: () => void;
  } = $props();

  const initial = untrack(() => item);
  const adding = initial === null;
  const uid = $props.id();
  const projectTargets: AgentArgsTarget[] = [{ id: "claude", display: "Claude Code" }, { id: "codex", display: "Codex" }];
  const scopes: readonly ChoiceEntry[] = [
    ["global", "settings.instructions.scope.global"], ["project", "settings.instructions.scope.project"],
  ];
  let form = $state<InstructionForm>(initial ? instructionToForm(initial) : emptyInstructionForm());
  let busy = $state(false);
  let tried = $state(false);
  let error = $state<string | null>(null);
  let cancelButton = $state<HTMLButtonElement>();
  let closed = false;
  const problems = $derived(instructionFormProblems(form));
  const knownProjects = $derived(projects());
  // 목록에서 사라진 id도 초안에서 조용히 버리지 않는다 — 사용자가 직접 해제할 수 있게 둔다.
  const missingProjects = $derived(form.projects.filter((id) => !knownProjects.some((project) => project.id === id)));
  const projectOptions = $derived([
    ...knownProjects.map((project) => ({ value: project.id, label: project.name, hint: project.host ?? undefined })),
    ...missingProjects.map((id) => ({ value: id, label: t("settings.instructions.project.unknown", { id }) })),
  ]);
  const hasRemoteProject = $derived(knownProjects.some((project) => project.host !== null && form.projects.includes(project.id)));

  onMount(() => () => { closed = true; });
  $effect(() => { if (busy) cancelButton?.focus(); });

  function toggleAgent(id: string): void {
    form.agents = form.agents.includes(id) ? form.agents.filter((agent) => agent !== id) : [...form.agents, id];
  }
  async function save(): Promise<void> {
    if (busy) return;
    tried = true;
    error = null;
    const next = formToInstruction(form);
    if (!next) return;
    busy = true;
    try {
      const saved = await instructionSave(next, initial?.name ?? null);
      if (!closed) onsaved(saved);
    } catch (e) {
      if (!closed) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.save"));
    } finally { busy = false; }
  }
  async function remove(): Promise<void> {
    if (busy || !initial) return;
    busy = true;
    error = null;
    try {
      await instructionDelete(initial.name);
      if (!closed) ondeleted();
    } catch (e) {
      if (!closed) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.delete"));
    } finally { busy = false; }
  }
</script>

<SettingsSubView title={t(adding ? "settings.instructions.title.add" : "settings.instructions.title.edit")}
  back={t("settings.instructions.back")} backAria={t("settings.instructions.back.aria")} {onback}>
  <form onsubmit={(ev) => { ev.preventDefault(); void save(); }}>
    <fieldset class="instruction-form" disabled={busy}>
      <legend class="sr-only">{t(adding ? "settings.instructions.title.add" : "settings.instructions.title.edit")}</legend>
      <div class="field">
        <label for="{uid}-name">{t("settings.instructions.field.name")}</label>
        <input id="{uid}-name" class="value" bind:value={form.name} maxlength={48} autocomplete="off" spellcheck="false"
          aria-invalid={tried && problems.includes("name")}
          aria-describedby={tried && problems.includes("name") ? uid + "-name-error" : undefined} />
        {#if tried && problems.includes("name")}
          <p class="field-error" id="{uid}-name-error" role="alert">{t(instructionProblemKeys.name)}</p>
        {/if}
      </div>
      <div class="field">
        <label for="{uid}-description">{t("settings.instructions.field.description")}</label>
        <input id="{uid}-description" class="value" bind:value={form.description} aria-describedby="{uid}-description-help" />
        <p class="note" id="{uid}-description-help">{t("settings.instructions.description.help")}</p>
      </div>
      <div class="field">
        <span id="{uid}-scope-label">{t("settings.instructions.field.scope")}</span>
        <ChoiceChips id="{uid}-scope" labelledby="{uid}-scope-label" entries={scopes} value={form.scope} disabled={busy}
          onpick={(scope) => { form.scope = scope === "project" ? "project" : "global"; if (form.scope === "global") form.subpath = ""; }} />
      </div>
      {#if form.scope === "project"}
        <div class="field">
          <span id="{uid}-projects-label">{t("settings.instructions.field.projects")}</span>
          {#if projectOptions.length > 0}
            <div class="project-picker">
              <MultiDropdown id="{uid}-projects" bind:values={form.projects} options={projectOptions} disabled={busy}
                labelledby="{uid}-projects-label" placeholder={t("settings.instructions.field.projects")}
                placeholderMany={(count) => t("settings.instructions.scope.count", { count })}
                ariaInvalid={tried && problems.includes("projects")}
                describedby={tried && problems.includes("projects") ? uid + "-projects-error" : undefined} />
            </div>
            {#if hasRemoteProject}<p class="note">{t("settings.instructions.projects.connection")}</p>{/if}
          {:else}
            <p class="note">{t("settings.instructions.projects.empty")}</p>
          {/if}
          {#if tried && problems.includes("projects")}<p class="field-error" id="{uid}-projects-error" role="alert">{t(instructionProblemKeys.projects)}</p>{/if}
        </div>
        <div class="field">
          <label for="{uid}-subpath">{t("settings.instructions.field.subpath")}</label>
          <input id="{uid}-subpath" class="value" bind:value={form.subpath} placeholder="packages/api"
            autocomplete="off" spellcheck="false" aria-invalid={tried && problems.includes("subpath")}
            aria-describedby={uid + "-subpath-help" + (tried && problems.includes("subpath") ? " " + uid + "-subpath-error" : "")} />
          <p class="note" id="{uid}-subpath-help">{t("settings.instructions.subpath.help")}</p>
          {#if tried && problems.includes("subpath")}
            <p class="field-error" id="{uid}-subpath-error" role="alert">{t(instructionProblemKeys.subpath)}</p>
          {/if}
        </div>
      {/if}
      <!-- 활성화는 MCP 서버 편집의 "서버 켜기" 처럼 독립된 줄 — 범위·대상 어느 쪽에도 딸리지 않는 지침 전체의 상태다. -->
      <div class="field">
        <label for="{uid}-enabled">{t("settings.instructions.field.enabled")}</label>
        <Toggle id="{uid}-enabled" bind:checked={form.enabled} disabled={busy} title={t("settings.instructions.enabled.help")} />
      </div>
      <div class="field">
        <span id="{uid}-agents-label">{t("settings.instructions.field.agents")}</span>
        <div class="agent-chips" role="group" aria-labelledby="{uid}-agents-label">
          {#if form.scope === "project"}
            {#each projectTargets as target (target.id)}
              <AgentChip agent={target} pressed fixed showLabel title={t("settings.instructions.agents.project.help")} />
            {/each}
          {:else}
            {#each targets as target (target.id)}
              <AgentChip agent={target} pressed={form.agents.includes(target.id)} disabled={busy} showLabel
                title={t("settings.instructions.agent.toggle", { agent: target.display })} onclick={() => toggleAgent(target.id)} />
            {/each}
          {/if}
        </div>
        {#if form.scope === "global" && tried && problems.includes("agents")}<p class="field-error" role="alert">{t(instructionProblemKeys.agents)}</p>{/if}
      </div>
      <div class="field">
        <label for="{uid}-body">{t("settings.instructions.field.body")}</label>
        <textarea id="{uid}-body" class="value body-input" bind:value={form.body} rows="14" spellcheck="false"
          aria-describedby="{uid}-body-help"></textarea>
        <p class="note" id="{uid}-body-help">{t("settings.instructions.body.help")}</p>
      </div>
    </fieldset>
    <p class="note">{t("settings.instructions.library.help")}</p>
    {#if error}<p class="field-error" role="alert">{error}</p>{/if}
    <div class="form-actions">
      {#if !adding}
        <button type="button" class="btn btn-sm btn-ghost delete" disabled={busy}
          title={t("settings.instructions.delete.title")} onclick={() => void remove()}>{t("settings.instructions.delete")}</button>
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-ghost" bind:this={cancelButton} onclick={onback}>{t("settings.actions.cancel")}</button>
      <button type="submit" class="btn btn-sm btn-primary" disabled={busy}>{t(adding ? "settings.instructions.add" : "settings.actions.save")}</button>
    </div>
  </form>
</SettingsSubView>

<style>
  .instruction-form { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; margin: 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .field { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); min-width: 0; }
  .field > label, .field > span { font-size: var(--t-xs); color: var(--fg-2); }
  .field > .value { box-sizing: border-box; width: 100%; min-width: 0; }
  .body-input { min-height: 240px; font-family: var(--font-mono); line-height: 1.5; resize: vertical; }
  .note { margin: 0; color: var(--fg-2); font-size: var(--t-xs); line-height: 1.5; }
  form > .note { margin-top: var(--space-2); }
  .field-error { margin: 0; color: var(--err); font-size: var(--t-xs); overflow-wrap: anywhere; }
  .agent-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .project-picker { width: 100%; min-width: 0; }
  .form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .spacer { flex: 1 1 auto; }
  .delete:hover { color: var(--err); background: var(--err-soft); }
</style>
