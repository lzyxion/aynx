<script lang="ts">
  /**
   * 스니펫 자리표시자를 묻는 모달. `app/prompts.svelte.ts` 에 얹지 않는다 — 저쪽은 접속 중 백엔드가 되묻는 대기열이다.
   * Escape 는 여기서 끊는다 — 창의 Escape 사슬로 새면 뒤에 깔린 다른 모달까지 함께 닫힌다.
   */
  import {
    resolveSnippetPrompt,
    setSnippetPromptValue,
    snippetPrompt,
    snippetPromptValue,
  } from "$lib/app/snippets.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";

  const cur = $derived(snippetPrompt());

  let fields = $state<(HTMLInputElement | null)[]>([]);
  $effect(() => {
    if (cur) fields[0]?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    resolveSnippetPrompt(false);
  }
</script>

{#if cur}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-prompt-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
      <h2 id="snippet-prompt-title">{cur.title}</h2>
      <p class="lead">{t("commands.snippet.prompt.lead")}</p>

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          resolveSnippetPrompt(true);
        }}
      >
        <div class="fields">
          {#each cur.fields as field, i (field.name)}
            <label for="snippet-ph-{i}">{field.name}</label>
            <div class="cell">
              <input
                id="snippet-ph-{i}"
                type="text"
                bind:this={fields[i]}
                value={snippetPromptValue(field.name)}
                autocomplete="off"
                spellcheck="false"
                aria-describedby={field.description ? `snippet-ph-help-${i}` : undefined}
                oninput={(e) => setSnippetPromptValue(field.name, e.currentTarget.value)}
              />
              {#if field.description}
                <p class="help" id="snippet-ph-help-{i}">{field.description}</p>
              {/if}
            </div>
          {/each}
        </div>

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={() => resolveSnippetPrompt(false)}>
            {t("commands.snippet.cancel")}
          </button>
          <button type="submit" class="primary btn btn-primary">{t("commands.snippet.prompt.submit")}</button>
        </div>
      </form>
      </div>
    </div>
  </div>
{/if}

<style>
  /* `dialogs/*` 의 `.overlay`/`.modal` 과 같은 값 — 그쪽은 스코프돼 있어 못 쓴다 */
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
    max-width: calc(420px + 2 * var(--space-4) + 2px); /* 옛 content-box 너비 그대로 — 안쪽 여백(스크롤 칸) · 테두리를 더함 */
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

  /* 설명이 붙은 줄만 높아지므로 세로 맞춤은 `start` 다 */
  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .fields label {
    padding-top: 6px;
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .cell {
    min-width: 0;
  }

  .help {
    margin: var(--space-1) 0 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
  }

  .fields input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .fields input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  /* 포커스는 중성 — 강조색 선을 쓰지 않는다 */
  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* `.ghost`/`.primary` 는 표식으로만 남는다 — 검증 도구가 `.actions .primary` 로 찾는다 */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
