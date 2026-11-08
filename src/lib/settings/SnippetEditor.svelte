<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  import { untrack } from "svelte";
  import { addSnippet, deleteSnippet, editSnippet, findSnippet, snippets } from "$lib/snippets.svelte.js";
  import { MAX_SNIPPETS, MAX_SNIPPET_COMMAND, MAX_SNIPPET_DESCRIPTION, MAX_SNIPPET_NAME } from "$lib/snippets";
  import {
    canSaveSnippetForm,
    emptySnippetForm,
    formToSnippet,
    scopeAliasOptions,
    snippetFormProblems,
    snippetToForm,
    type SnippetForm,
  } from "$lib/settings/model/snippet-form";
  import { hostCache } from "$lib/app/hosts.svelte.js";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import SnippetPreview from "$lib/settings/SnippetPreview.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 스니펫 **추가 · 편집** — 설정 › 스니펫의 하위 화면 (docs/log/2026-10-05-snippets-subview.md).
   *
   * 요약(`SnippetsSection`)의 [스니펫 추가 ›] 또는 줄 누르기가 연다. 틀(`SettingsSubView`)은 트리거 · 자동 승인과
   * 공용이고, 움직임 · Escape · 돌아온 뒤 포커스는 요약이 맡는다. 위에서부터: 칸(이름 · 명령 · 설명 · 범위 · Enter) ·
   * 미리보기 · 단추.
   *
   * - **칸은 이 화면 안에만 산다** — [추가] · [저장] 을 눌러야 목록에 쓴다(그 순간 `snippets.json` 에 디바운스 저장 —
   *   스니펫은 설정 창의 [저장] 을 기다리지 않는다). [취소] · 뒤로 · Escape 는 아무것도 쓰지 않는다.
   * - **예시 카드는 없다** — 스니펫에는 예시 · 틀 개념이 없다(트리거와 다른 점).
   * - [삭제] 는 저장 쪽(`deleteSnippet`)이 한 번 묻는다 — 되돌릴 수 없다.
   */
  let {
    id,
    onback,
    onsaved,
    ondeleted,
  }: {
    /** 고칠 스니펫의 id — `null` 이면 추가 */
    id: string | null;
    /** [취소] · 뒤로 · Escape — 아무것도 쓰지 않고 요약으로 */
    onback: () => void;
    /** [추가] · [저장] 뒤 — 넣거나 고친 스니펫의 id */
    onsaved: (id: string) => void;
    ondeleted: () => void;
  } = $props();

  const uid = $props.id();
  const adding = $derived(id === null);

  let form = $state<SnippetForm>(
    untrack(() => {
      const cur = id === null ? undefined : findSnippet(id);
      return cur ? snippetToForm(cur) : emptySnippetForm();
    }),
  );
  /** [추가]/[저장] 을 한 번 눌렀는가 — 처음 열린 빈 칸에 "이름을 적으세요" 를 띄우지 않는다 */
  let tried = $state(false);

  const full = $derived(adding && snippets().length >= MAX_SNIPPETS);
  const problems = $derived(snippetFormProblems(form));
  const canCommit = $derived(canSaveSnippetForm(form) && !full);
  const nameErr = $derived((tried || !adding) && problems.includes("name-empty"));
  const cmdErr = $derived((tried || !adding) && problems.includes("command-empty"));

  /**
   * 범위 후보 — 호스트 목록은 **읽기만** 한다(그 캐시를 채우는 자리는 독 · 시작 화면이다). 편집 중인 스니펫의 별칭이
   * 목록에 없어도 후보에 남는다(`scopeAliasOptions`).
   */
  const aliases = $derived(
    scopeAliasOptions(
      hostCache().map((h) => h.name),
      form.alias,
    ),
  );

  /** "명령" 칸 이름의 툴팁 — 자리표시자 문법과, 이 길로 나가는 글자가 무엇뿐인지 */
  const commandTip = $derived(
    tipOf(
      t("settings.snippets.note.syntax.example") + t("settings.snippets.note.syntax.after"),
      t("settings.snippets.footnote.strong") + t("settings.snippets.footnote.body"),
    ),
  );

  // 편집 중인 스니펫이 바깥에서 사라지면(팔레트에서 지움 · 호스트 제거 팬아웃) 요약으로 — 없는 줄에 쓰지 않게.
  $effect(() => {
    if (id !== null && !snippets().some((s) => s.id === id)) untrack(onback);
  });

  function commit(): void {
    if (!canCommit) {
      tried = true;
      return;
    }
    const fields = formToSnippet(form);
    if (id === null) {
      const made = addSnippet(fields);
      if (made) onsaved(made.id);
    } else if (editSnippet(id, fields)) {
      onsaved(id);
    }
  }

  async function remove(): Promise<void> {
    if (id === null) return;
    if (await deleteSnippet(id)) ondeleted();
  }

  /** 한 줄 칸에서 Enter = [추가]/[저장] (설정 화면은 `<form>` 이 아니라 직접 받는다 · 명령 칸은 여러 줄이라 빼고) */
  function onFieldKey(e: KeyboardEvent): void {
    if (e.key !== "Enter" || e.isComposing) return;
    if (!(e.target instanceof HTMLInputElement) || e.target.closest("[data-snippet-preview]")) return;
    e.preventDefault();
    commit();
  }
</script>

<SettingsSubView
  title={adding ? t("settings.snippets.title.add") : t("settings.snippets.title.edit")}
  back={t("settings.snippets.back")}
  backAria={t("settings.snippets.back.aria")}
  {onback}
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section class="snip-form" aria-label={adding ? t("settings.snippets.title.add") : t("settings.snippets.title.edit")} onkeydown={onFieldKey}>
    <div class="ff" data-field="name">
      <label class="name" for="{uid}-name">{t("settings.snippets.field.name")}</label>
      <input
        id="{uid}-name"
        class="value"
        class:bad={nameErr}
        bind:value={form.name}
        maxlength={MAX_SNIPPET_NAME}
        placeholder={t("settings.snippets.name.placeholder")}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={nameErr ? "true" : undefined}
        aria-describedby={nameErr ? `${uid}-name-err` : undefined}
      />
      {#if nameErr}<p class="field-err" id="{uid}-name-err" role="alert">{t("settings.snippets.err.name.empty")}</p>{/if}
    </div>

    <div class="ff top" data-field="command">
      <TipName id="{uid}-cmd-name" for="{uid}-cmd" label={t("settings.snippets.field.command")} tip={commandTip} />
      <textarea
        id="{uid}-cmd"
        class="value cmd-input"
        class:bad={cmdErr}
        bind:value={form.command}
        maxlength={MAX_SNIPPET_COMMAND}
        rows="3"
        placeholder={t("settings.snippets.command.placeholder")}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={cmdErr ? "true" : undefined}
        aria-describedby={cmdErr ? `${uid}-cmd-err` : undefined}
      ></textarea>
      {#if cmdErr}<p class="field-err" id="{uid}-cmd-err" role="alert">{t("settings.snippets.err.command.empty")}</p>{/if}
    </div>

    <div class="ff" data-field="description">
      <label class="name" for="{uid}-desc">{t("settings.snippets.field.description")}</label>
      <input
        id="{uid}-desc"
        class="value"
        bind:value={form.description}
        maxlength={MAX_SNIPPET_DESCRIPTION}
        placeholder={t("settings.snippets.description.placeholder")}
        autocomplete="off"
      />
    </div>

    <div class="ff" data-field="scope">
      <label class="name" for="{uid}-scope">{t("settings.snippets.field.scope")}</label>
      <Dropdown id="{uid}-scope" bind:value={form.alias} ariaLabel={t("settings.snippets.scope.aria")}
        options={[{ value: "", label: t("settings.snippets.scope.all") }, ...aliases.map((alias) => ({ value: alias, label: alias }))]} />
    </div>

    <div class="ff" data-field="enter">
      <label class="name" for="{uid}-enter">Enter</label>
      <span class="enter-row">
        <Toggle id="{uid}-enter" bind:checked={form.enter} title={t("settings.snippets.enter.title")} />
        <span class="enter-label">{t("settings.snippets.enter.label")}</span>
      </span>
    </div>
  </section>

  <SnippetPreview command={form.command} enter={form.enter} />

  <div class="form-actions">
    {#if !adding}
      <button
        type="button"
        class="btn btn-sm btn-ghost del"
        aria-label={t("settings.snippets.delete.aria", { name: form.name })}
        onclick={() => void remove()}>{t("settings.snippets.delete")}</button
      >
    {/if}
    <span class="spacer"></span>
    {#if full}
      <span class="full-why" role="note">{t("settings.snippets.error.full", { max: MAX_SNIPPETS })}</span>
    {/if}
    <button type="button" class="btn btn-sm btn-ghost cancel" onclick={onback}>{t("settings.snippets.form.cancel")}</button>
    <button type="button" class="btn btn-sm btn-primary commit" disabled={!canCommit} onclick={commit}
      >{adding ? t("settings.snippets.form.add") : t("settings.snippets.form.save")}</button
    >
  </div>
</SettingsSubView>

<style>
  /* 칸 — 트리거 편집(`TriggerEditor`)의 규칙 칸과 같은 결: 이름 | 칸, 좁으면 이름이 위로 */
  .snip-form {
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

  /* 여러 줄 칸은 이름을 위에 맞춘다 */
  .ff.top {
    align-items: start;
  }

  .ff.top > :global(.name) {
    margin-top: var(--space-1);
  }

  .ff > :global(.name) {
    justify-self: start;
  }

  .ff > :global(.name.has-tip) {
    cursor: help;
  }

  .ff > :global(.name:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .ff > .value,
  .ff > :global(.dd),
  .ff > .enter-row,
  .field-err {
    grid-column: 2;
    min-width: 0;
  }

  .ff > .value.bad {
    border-color: var(--err);
  }

  /* 명령 칸 — `.value` 의 모양을 그대로 쓰되 여러 줄이라 세로 크기만 열어 둔다 */
  .cmd-input {
    font-family: var(--font-mono);
    resize: vertical;
    line-height: 1.5;
  }

  .enter-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .enter-label {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .field-err {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--err);
    word-break: keep-all;
  }

  @container (max-width: 420px) {
    .ff {
      grid-template-columns: minmax(0, 1fr);
    }

    .ff > .value,
    .ff > :global(.dd),
    .ff > .enter-row,
    .field-err {
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

  .full-why {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--err);
  }

  .del {
    color: var(--fg-2);
  }

  .del:hover {
    color: var(--err);
    background: var(--err-soft);
  }
</style>
