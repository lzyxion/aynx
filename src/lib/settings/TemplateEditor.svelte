<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  import { untrack } from "svelte";
  import TemplatePreview from "$lib/TemplatePreview.svelte";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import { templateEditPlan, templateRowSub } from "$lib/settings/templates-view";
  import {
    deleteTabTemplate,
    moveTabTemplateProject,
    renameTabTemplate,
    tabTemplates,
    templateProjectOptions,
    templateSummary,
  } from "$lib/app/tab-templates.svelte.js";
  import { projectById } from "$lib/app/project-list.svelte.js";
  import { cleanTemplateName, MAX_TEMPLATE_NAME } from "$lib/tab-templates";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** [저장] 은 바뀐 것만 쓴다 — 이름이 먼저, 실패하면 거기서 멈추고 화면에 남는다. [취소] · 뒤로 · Escape 는 아무것도 쓰지 않는다. */
  let {
    id,
    onback,
    onsaved,
    ondeleted,
  }: {
    id: string;
    onback: () => void;
    /** 바뀐 것이 없어도 부른다 */
    onsaved: (id: string) => void;
    ondeleted: () => void;
  } = $props();

  const uid = $props.id();

  const tpl = $derived(tabTemplates().find((x) => x.id === id));

  let form = $state(
    untrack(() => {
      const cur = tabTemplates().find((x) => x.id === id);
      return { name: cur?.name ?? "", projectId: cur?.projectId ?? "" };
    }),
  );
  let nameTaken = $state<string | null>(null);
  let busy = $state(false);

  const nameEmpty = $derived(cleanTemplateName(form.name) === "");
  const canCommit = $derived(!nameEmpty && !busy);

  /** 지워진 프로젝트도 후보에 남긴다 — 고르기가 빈칸으로 보이지 않게 */
  const options = $derived.by(() => {
    const base = templateProjectOptions();
    const pid = tpl?.projectId;
    if (!pid || projectById(pid)) return base;
    return [...base, { value: pid, label: t("settings.templates.project.gone") }];
  });

  // 편집 중 템플릿이 목록에서 사라지면 요약으로 — 없는 것에 쓰지 않게.
  $effect(() => {
    if (!tabTemplates().some((x) => x.id === id)) untrack(onback);
  });

  async function commit(): Promise<void> {
    const cur = tpl;
    if (!cur || !canCommit) return;
    const plan = templateEditPlan(cur, form);
    busy = true;
    try {
      if (plan.name !== undefined) {
        try {
          if (!(await renameTabTemplate(id, plan.name))) return;
        } catch (e) {
          nameTaken = e instanceof Error ? e.message : String(e);
          return;
        }
      }
      if (plan.projectId !== undefined && !(await moveTabTemplateProject(id, plan.projectId))) return;
      onsaved(id);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (await deleteTabTemplate(id)) ondeleted();
  }

  function onFieldKey(e: KeyboardEvent): void {
    if (e.key !== "Enter" || e.isComposing || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    void commit();
  }
</script>

<SettingsSubView
  title={tpl?.name ?? form.name}
  back={t("settings.templates.back")}
  backAria={t("settings.templates.back.aria")}
  {onback}
>
  {#if tpl}
    <div class="tpl-layout" data-template-editor="preview">
      <TemplatePreview root={tpl.root} width={160} height={100} />
      <p class="tpl-sum">{templateRowSub(templateSummary(tpl.root), tpl.savedAt, Date.now(), t)}</p>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section class="tpl-form" aria-label={t("settings.templates.title.edit")} onkeydown={onFieldKey}>
    <div class="ff" data-field="name">
      <label class="name" for="{uid}-name">{t("settings.templates.field.name")}</label>
      <input
        id="{uid}-name"
        class="value"
        class:bad={nameEmpty || nameTaken !== null}
        bind:value={form.name}
        oninput={() => (nameTaken = null)}
        maxlength={MAX_TEMPLATE_NAME}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={nameEmpty || nameTaken !== null ? "true" : undefined}
        aria-describedby={nameEmpty || nameTaken !== null ? `${uid}-name-err` : undefined}
      />
      {#if nameEmpty}
        <p class="field-err" id="{uid}-name-err" role="alert">{t("settings.templates.err.name.empty")}</p>
      {:else if nameTaken !== null}
        <p class="field-err" id="{uid}-name-err" role="alert">{nameTaken}</p>
      {/if}
    </div>

    <div class="ff" data-field="project">
      <label class="name" for="{uid}-project">{t("app.tabTemplates.save.project")}</label>
      <Dropdown id="{uid}-project" bind:value={form.projectId} {options} ariaLabel={t("app.tabTemplates.save.project")} />
      <p class="field-hint">{t("app.tabTemplates.save.projectHint")}</p>
    </div>
  </section>

  <div class="form-actions">
    <button
      type="button"
      class="btn btn-sm btn-ghost del"
      aria-label={t("settings.templates.delete.aria", { name: tpl?.name ?? form.name })}
      onclick={() => void remove()}>{t("settings.templates.delete")}</button
    >
    <span class="spacer"></span>
    <button type="button" class="btn btn-sm btn-ghost cancel" onclick={onback}>{t("settings.templates.form.cancel")}</button>
    <button type="button" class="btn btn-sm btn-primary commit" disabled={!canCommit} onclick={() => void commit()}
      >{t("settings.templates.form.save")}</button
    >
  </div>
</SettingsSubView>

<style>
  .tpl-layout {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    background: var(--surface-field);
    border-radius: var(--radius-surface-inner);
  }

  .tpl-sum {
    flex: 1 1 12em;
    min-width: 0;
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .tpl-form {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .ff {
    display: grid;
    grid-template-columns: 7em minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-3);
    row-gap: 2px;
  }

  .ff > :global(.name) {
    justify-self: start;
  }

  .ff > .value,
  .ff > :global(.dd),
  .field-err,
  .field-hint {
    grid-column: 2;
    min-width: 0;
  }

  .ff > .value.bad {
    border-color: var(--err);
  }

  .field-err,
  .field-hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    word-break: keep-all;
  }

  .field-err {
    color: var(--err);
  }

  .field-hint {
    color: var(--fg-3);
  }

  @container (max-width: 420px) {
    .ff {
      grid-template-columns: minmax(0, 1fr);
    }

    .ff > .value,
    .ff > :global(.dd),
    .field-err,
    .field-hint {
      grid-column: 1;
    }
  }

  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .del {
    color: var(--fg-2);
  }

  .del:hover {
    color: var(--err);
    background: var(--err-soft);
  }
</style>
