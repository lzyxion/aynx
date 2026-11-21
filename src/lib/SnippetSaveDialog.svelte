<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  /**
   * 명령 하나를 스니펫으로 저장하는 모달 — 설정 › 스니펫의 폼을 다시 쓰지 않는다(저쪽은 목록과 한 화면이라 모드를 계속 물어야 한다).
   * Escape 는 여기서 끊는다 — 창의 Escape 사슬로 새면 뒤에 깔린 다른 모달까지 함께 닫힌다.
   */
  import Toggle from "$lib/Toggle.svelte";
  import {
    cancelSnippetSave,
    commitSnippetSave,
    setSnippetSaveField,
    snippetSaveForm,
  } from "$lib/app/snippets.svelte.js";
  import {
    MAX_SNIPPET_COMMAND,
    MAX_SNIPPET_DESCRIPTION,
    MAX_SNIPPET_NAME,
    placeholdersOf,
  } from "$lib/snippets";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";

  const form = $derived(snippetSaveForm());

  const placeholders = $derived(form ? placeholdersOf(form.command) : []);

  let nameEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (form) nameEl?.select();
  });

  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelSnippetSave();
  }
</script>

{#if form}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-save-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
      <h2 id="snippet-save-title">{t("commands.snippet.save.title")}</h2>
      <!-- 문자열에 HTML 을 넣지 않는다 — 예시 문법 `{{이름}}` 은 `<code>` 에 맞춰 키를 셋으로 쪼갰다 -->
      <p class="lead">
        {t("commands.snippet.save.lead.before")}<code>{t("commands.snippet.save.lead.token")}</code
        >{t("commands.snippet.save.lead.after")}
      </p>

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          commitSnippetSave();
        }}
      >
        <div class="fields">
          <label for="snippet-save-name">{t("commands.snippet.save.name")}</label>
          <input
            id="snippet-save-name"
            data-snippet-save="name"
            type="text"
            bind:this={nameEl}
            value={form.name}
            maxlength={MAX_SNIPPET_NAME}
            autocomplete="off"
            spellcheck="false"
            oninput={(e) => setSnippetSaveField({ name: e.currentTarget.value })}
          />

          <label for="snippet-save-command">{t("commands.snippet.save.command")}</label>
          <!-- 여러 줄 칸 — Enter 는 줄바꿈이고 제출은 [저장] 이나 다른 칸의 Enter 로 한다 -->
          <textarea
            id="snippet-save-command"
            data-snippet-save="command"
            rows="3"
            value={form.command}
            maxlength={MAX_SNIPPET_COMMAND}
            spellcheck="false"
            oninput={(e) => setSnippetSaveField({ command: e.currentTarget.value })}
          ></textarea>

          <label for="snippet-save-scope">{t("commands.snippet.save.scope")}</label>
          <span data-snippet-save="scope"><Dropdown
            id="snippet-save-scope"
            value={form.hostScope ? "host" : "all"}
            options={[
              { value: "all", label: t("commands.snippet.save.scope.all") },
              ...(form.alias !== null ? [{ value: "host", label: t("commands.snippet.save.scope.host", { alias: form.alias }) }] : []),
            ]}
            onchange={(v) => setSnippetSaveField({ hostScope: v === "host" })}
          /></span>

          <label for="snippet-save-enter">{t("commands.snippet.save.enter")}</label>
          <div class="row">
            <Toggle
              id="snippet-save-enter"
              checked={form.enter}
              onchange={(v) => setSnippetSaveField({ enter: v })}
            />
            <span class="hint">
              {form.enter
                ? t("commands.snippet.save.enter.on")
                : t("commands.snippet.save.enter.off")}
            </span>
          </div>

          <label for="snippet-save-desc">{t("commands.snippet.save.description")}</label>
          <input
            id="snippet-save-desc"
            data-snippet-save="description"
            type="text"
            value={form.description}
            maxlength={MAX_SNIPPET_DESCRIPTION}
            placeholder={t("commands.snippet.save.description.placeholder")}
            autocomplete="off"
            oninput={(e) => setSnippetSaveField({ description: e.currentTarget.value })}
          />
        </div>

        {#if placeholders.length > 0}
          <p class="note">
            {t("commands.snippet.save.placeholders", {
              count: placeholders.length,
              names: placeholders.map((p) => p.name).join(" · "),
            })}
          </p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={() => cancelSnippetSave()}
            >{t("commands.snippet.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary">{t("commands.snippet.save.submit")}</button>
        </div>
      </form>
      </div>
    </div>
  </div>
{/if}

<style>
  /* `SnippetPrompt.svelte`·`dialogs/*` 의 `.overlay`/`.modal` 과 같은 값이다 */
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
    max-width: calc(460px + 2 * var(--space-4) + 2px); /* 옛 content-box 너비 그대로 — 안쪽 여백(스크롤 칸) · 테두리를 더함 */
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) — 흐림 층이 밑동까지 덮게 */
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

  .lead code {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }

  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .fields label {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .fields input,
  .fields textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .fields input {
    height: var(--field-height);
    padding: 0 var(--space-3);
    border-radius: var(--field-radius);
  }

  .fields :global(.dd) {
    width: 100%;
  }

  .fields textarea {
    align-self: start;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--field-radius-multi);
    resize: vertical;
    line-height: 1.5;
  }

  /* 포커스는 중성 — 강조색 선을 쓰지 않는다 */
  .fields input:focus-visible,
  .fields textarea:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input:hover:not(:disabled, :focus),
  .fields textarea:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .note {
    margin: 0 0 var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-2);
  }

  /* `.ghost`/`.primary` 는 표식으로만 남는다 — 검증 도구가 `.actions .primary` 로 찾는다 */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
