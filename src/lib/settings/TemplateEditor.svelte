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

  /**
   * 템플릿 **편집** — 설정 › 템플릿의 하위 화면(2026-11-17 — 스니펫 편집 `SnippetEditor` 와 같은 틀).
   *
   * 요약(`TemplatesSection`)의 줄 누르기가 연다. 틀(`SettingsSubView`)은 스니펫 · 트리거와 공용이고, 움직임 · Escape · 돌아온 뒤
   * 포커스는 요약이 맡는다. 위에서부터: 배치 그림(저장 상자보다 조금 큰 그림) + 구성 요약 · 칸(이름 · 프로젝트) · 단추.
   * 만들기 · 배치 고치기는 여기 없다(탭 우클릭 [템플릿 저장] — 같은 이름으로 다시 저장하면 덮어쓸지 묻는다).
   *
   * - **칸은 이 화면 안에만 산다** — [저장] 을 눌러야 파일에 쓴다. **바뀐 것만** 쓴다(순수 `templateEditPlan`): 이름이 바뀌면
   *   `renameTabTemplate` → 그다음 프로젝트가 바뀌면 `moveTabTemplateProject`. 첫 단계가 실패하면(같은 이름 → 칸 아래 오류 ·
   *   못 씀 → 그 함수가 안내 한 줄) 거기서 멈추고 화면에 남는다. 아무것도 안 바뀌었으면 쓰지 않고 돌아간다(스니펫 편집처럼 [저장] 은
   *   칸이 맞으면 늘 켜져 있다). [취소] · 뒤로 · Escape 는 아무것도 쓰지 않는다.
   * - [삭제] 는 저장 쪽(`deleteTabTemplate`)이 한 번 묻는다 — 지웠으면 요약으로.
   * - 편집 중 템플릿이 목록에서 사라지면(다른 창 · 시작 화면에서 지움) 요약으로 — 없는 것에 쓰지 않게.
   */
  let {
    id,
    onback,
    onsaved,
    ondeleted,
  }: {
    /** 고칠 템플릿의 id */
    id: string;
    /** [취소] · 뒤로 · Escape — 아무것도 쓰지 않고 요약으로 */
    onback: () => void;
    /** [저장] 뒤(바뀐 것이 없어도) */
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
  /** 이름 칸 아래 오류 — 같은 이름(던진 문구) */
  let nameTaken = $state<string | null>(null);
  let busy = $state(false);

  const nameEmpty = $derived(cleanTemplateName(form.name) === "");
  const canCommit = $derived(!nameEmpty && !busy);

  /**
   * 프로젝트 후보 — 저장 상자와 같은 목록(없음 + 이름순). 템플릿의 프로젝트를 목록에서 못 찾으면(지워진 프로젝트) 그 자리를
   * "찾을 수 없는 프로젝트" 로 남겨 고르기가 빈칸으로 보이지 않게 한다.
   */
  const options = $derived.by(() => {
    const base = templateProjectOptions();
    const pid = tpl?.projectId;
    if (!pid || projectById(pid)) return base;
    return [...base, { value: pid, label: t("settings.templates.project.gone") }];
  });

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

  /** 이름 칸에서 Enter = [저장] (설정 화면은 `<form>` 이 아니라 직접 받는다) */
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
    <!-- 배치 그림 + 구성 요약 — 저장 상자(`TabTemplateSaveDialog`)의 그림보다 한 단 크다 -->
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
  /* 배치 그림 — 저장 상자의 미리보기 칸과 같은 면 */
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

  /* 칸 — 스니펫 편집(`SnippetEditor`)과 같은 결: 이름 | 칸, 좁으면 이름이 위로 */
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
