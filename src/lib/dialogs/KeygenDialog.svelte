<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  // 새 키 만들기(`ssh-keygen`) — 다른 모달 위에서 열리므로 +page 의 맨 뒤 오버레이로 둔다(같은 z-index 라 나중 것이 위).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    closeKeygen,
    focusKeygen,
    keygenForm,
    keygenRequest,
    keygenVisible,
    submitKeygen,
  } from "$lib/app/keygen.svelte.js";

  const keygenCur = $derived(keygenRequest());

  $effect(() => {
    if (keygenVisible()) focusKeygen();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

<!-- 암호구 두 칸은 어디에도 저장되지 않는다 — 어느 경로로 닫히든 `app/keygen` 이 "" 로 지운다 -->
{#if keygenVisible() && keygenCur}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kg-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      <h2 id="kg-title">{t("app.hostform.keygen.title")}</h2>
      <p class="lead">
        {t("app.hostform.keygen.lead.1")}<code>~/.ssh</code
        >{t("app.hostform.keygen.lead.2")}<strong>{t("app.hostform.keygen.lead.term")}</strong
        >{t("app.hostform.keygen.lead.3")}
      </p>

      <form onsubmit={(ev) => { ev.preventDefault(); void submitKeygen(); }}>
        <div class="fields">
          <label for="kg-name">{t("app.hostform.keygen.field.name")}</label>
          <input
            id="kg-name"
            bind:this={keygenForm.firstField}
            bind:value={keygenForm.name}
            placeholder="id_ed25519"
            autocomplete="off"
            spellcheck="false"
            required
          />

          <label for="kg-kind">{t("app.hostform.keygen.field.kind")}</label>
          <Dropdown id="kg-kind" bind:value={keygenForm.kind} options={[
            { value: "ed25519", label: t("app.hostform.keygen.kind.ed25519") },
            { value: "rsa", label: t("app.hostform.keygen.kind.rsa") },
          ]} />

          <label for="kg-pass">{t("app.hostform.keygen.field.passphrase")}</label>
          <input
            id="kg-pass"
            type="password"
            bind:value={keygenForm.passphrase}
            placeholder={t("app.hostform.keygen.field.passphrase.placeholder")}
            autocomplete="new-password"
          />

          <label for="kg-pass2">{t("app.hostform.keygen.field.confirm")}</label>
          <input
            id="kg-pass2"
            type="password"
            bind:value={keygenForm.confirm}
            autocomplete="new-password"
          />

          <label for="kg-comment">{t("app.hostform.keygen.field.comment")}</label>
          <input
            id="kg-comment"
            bind:value={keygenForm.comment}
            placeholder={t("app.hostform.keygen.field.comment.placeholder")}
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        {#if keygenForm.error}
          <p class="error" role="alert">{keygenForm.error}</p>
        {/if}

        <p class="fw-hint">
          {t("app.hostform.keygen.hint.1")}<strong>{t("app.hostform.keygen.hint.term")}</strong
          >{t("app.hostform.keygen.hint.2")}
        </p>

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={closeKeygen} disabled={keygenForm.busy}
            >{t("app.actions.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary" disabled={keygenForm.busy}>
            {keygenForm.busy
              ? t("app.hostform.keygen.busy")
              : t("app.hostform.keygen.go")}
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
  }

  .lead code {
    font-family: var(--font-mono);
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

  .fw-hint {
    margin: 0 0 12px;
    font-size: var(--t-xs);
    line-height: 1.6;
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
    user-select: text;
  }
</style>
