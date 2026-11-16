<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  import TemplatePreview from "$lib/TemplatePreview.svelte";
  import {
    cancelTabTemplateSave,
    commitTabTemplateSave,
    setTabTemplateSaveField,
    tabTemplateSaveForm,
    templateProjectOptions,
    templateRows,
  } from "$lib/app/tab-templates.svelte.js";
  import { MAX_TEMPLATE_NAME } from "$lib/tab-templates";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";

  /**
   * **탭을 템플릿으로 저장하는 상자**(2026-11-16). 입구가 둘이다 — 탭 우클릭 [템플릿으로 저장…] · 팔레트 [지금 탭을 템플릿으로 저장…].
   * 둘 다 같은 문(`openTabTemplateSave`)을 지나므로 이 상자는 어디서 열렸는지 모른다: 아는 것은 폼 한 벌(`tabTemplateSaveForm`)뿐이고
   * 저장 · 취소도 그 모듈의 함수 둘이다. 모양은 스니펫 저장 상자(`SnippetSaveDialog.svelte`)와 같은 글래스 모달이다.
   *
   * Escape 는 여기서 끊는다(`stopPropagation`) — 창의 Escape 사슬로 새면 뒤에 깔린 다른 모달까지 닫는다.
   */
  const form = $derived(tabTemplateSaveForm());
  const rows = $derived(form?.root ? templateRows(form.root) : []);
  const options = $derived(form ? templateProjectOptions() : []);

  let nameEl = $state<HTMLInputElement | null>(null);
  let opened = false;
  $effect(() => {
    // 열릴 때 한 번 — 이름을 골라 둔다(그대로면 Enter, 아니면 그냥 치면 덮어써진다)
    if (form && !opened) {
      opened = true;
      nameEl?.select();
    } else if (!form) opened = false;
  });

  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelTabTemplateSave();
  }
</script>

{#if form}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-template-save-title"
      tabindex="-1"
      data-tab-template-save
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
        <h2 id="tab-template-save-title">{t("app.tabTemplates.save.title")}</h2>
        <p class="lead">{t("app.tabTemplates.save.lead")}</p>

        <form
          onsubmit={(ev) => {
            ev.preventDefault();
            void commitTabTemplateSave();
          }}
        >
          <div class="fields">
            <label for="tab-template-save-name">{t("app.tabTemplates.save.name")}</label>
            <input
              id="tab-template-save-name"
              data-tab-template-save="name"
              type="text"
              bind:this={nameEl}
              value={form.name}
              maxlength={MAX_TEMPLATE_NAME}
              autocomplete="off"
              spellcheck="false"
              oninput={(e) => setTabTemplateSaveField({ name: e.currentTarget.value })}
            />

            <label for="tab-template-save-project">{t("app.tabTemplates.save.project")}</label>
            <span data-tab-template-save="project"
              ><Dropdown
                id="tab-template-save-project"
                value={form.projectId}
                {options}
                onchange={(v) => setTabTemplateSaveField({ projectId: v })}
              /></span
            >
          </div>
          <p class="hint">{t("app.tabTemplates.save.projectHint")}</p>

          {#if form.root}
            <!-- 배치 미리보기 + 타일 목록(종류 칩 · 대상) -->
            <div class="layout" data-tab-template-save="preview">
              <TemplatePreview root={form.root} width={132} height={84} />
              <div class="tiles">
                <p class="count">{t("app.tabTemplates.save.tiles", { n: rows.length })}</p>
                <ul>
                  {#each rows as r, i (i)}
                    <li data-chip={r.chip}>
                      <span class="chip" class:ai={r.chip === "ai"}>{r.label}</span>
                      <span class="target" title={r.target}>{r.target}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
          {/if}

          {#if form.skipped > 0}
            <p class="note warn" data-tab-template-save="skipped">{t("app.tabTemplates.save.skipped", { n: form.skipped })}</p>
          {/if}
          <p class="note">{t("app.tabTemplates.save.keeps")}<br />{t("app.tabTemplates.save.skips")}</p>

          <div class="actions">
            <button type="button" class="ghost btn btn-secondary" onclick={() => cancelTabTemplateSave()}
              >{t("app.tabTemplates.save.cancel")}</button
            >
            <button type="submit" class="primary btn btn-primary">{t("app.tabTemplates.save.submit")}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
{/if}

<style>
  /* `SnippetSaveDialog.svelte`·`dialogs/*` 의 `.overlay`/`.modal` 과 **같은 값**이다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  .modal {
    box-sizing: border-box;
    width: 100%;
    max-width: calc(500px + 2 * var(--space-4) + 2px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .glass-scroll {
    padding: var(--space-4);
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-1);
  }

  .fields label {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .fields input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .fields :global(.dd) {
    width: 100%;
  }

  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .hint {
    margin: 0 0 var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
  }

  /* 미리보기 — 왼쪽 그림 · 오른쪽 타일 목록 */
  .layout {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    margin: 0 0 var(--space-3);
    padding: var(--space-3);
    background: var(--surface-field);
    border-radius: var(--radius-surface-inner);
  }

  .tiles {
    flex: 1;
    min-width: 0;
  }

  .count {
    margin: 0 0 var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .tiles ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 140px;
    overflow-y: auto;
  }

  .tiles li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--t-xs);
    line-height: 20px;
  }

  .chip {
    flex: none;
    min-width: 30px;
    padding: 0 var(--space-2);
    text-align: center;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .chip.ai {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .target {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    color: var(--fg-2);
  }

  .note {
    margin: 0 0 var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-3);
  }

  .note.warn {
    color: var(--warn);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
