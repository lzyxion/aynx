<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    closeRemoteEdit,
    ed,
    remoteEditVisible,
    submitRemoteEdit,
  } from "$lib/app/transfer.svelte.js";

  $effect(() => {
    if (remoteEditVisible()) ed.field?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

{#if remoteEditVisible()}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ed-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      <h2 id="ed-title">{t("app.remoteEdit.title")}</h2>
      <p class="lead">
        <strong>{ed.pane}</strong
        >{t("app.remoteEdit.lead.1")}<strong>{t("app.remoteEdit.lead.term")}</strong
        >{t("app.remoteEdit.lead.2")}
      </p>

      <form onsubmit={(ev) => void submitRemoteEdit(ev)}>
        <div class="fields">
          <label for="ed-path">{t("app.remoteEdit.field.path")}</label>
          <input
            id="ed-path"
            bind:this={ed.field}
            bind:value={ed.path}
            placeholder={t("app.remoteEdit.field.path.placeholder")}
            autocomplete="off"
            spellcheck="false"
            required
          />
        </div>

        {#if ed.error}
          <p class="error" role="alert">{ed.error}</p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={closeRemoteEdit}
            >{t("app.actions.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary" disabled={ed.busy}>
            {ed.busy ? t("app.remoteEdit.busy") : t("app.remoteEdit.open")}
          </button>
        </div>
      </form>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* 모달은 언제나 최상층 — 패널 안 요소(재연결 배너 등)가 새어 나와 덮으면 보이는데 클릭·입력이 안 된다 */
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
    max-width: calc(420px + 2 * var(--space-4) + 2px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll` — 흐림 층이 밑동까지 덮게 */
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

  /* flex 로 바꾸지 않는다 — <code>·<strong> 이 섞인 문단의 인라인 요소가 flex 아이템이 되어 줄바꿈이 깨진다 */
  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
    /* 타일 이름은 공백 없는 긴 경로일 수 있다 — 꺾이지 않으면 가로 막대가 선다 */
    overflow-wrap: anywhere;
  }

  /* `.ghost`/`.primary` 는 표식으로만 남는다 — 검증 도구가 `.actions .primary` 로 찾는다 */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
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

  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  .error {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    /* 실패 사유에 긴 경로가 실려도 가로 막대가 서지 않게 */
    overflow-wrap: anywhere;
    user-select: text;
  }
</style>
