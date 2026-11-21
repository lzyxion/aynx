<script lang="ts">
  // 마스터 암호 걸기·바꾸기·풀기·확인(설정 › 보안 들어가기 관문).
  import UiIcon from "$lib/UiIcon.svelte";
  // 모드 이름이 i18n 키 꼬리를 그대로 이룬다(`app.vault.master.title.${mode}`) — 모드 이름을 바꾸면 키도 함께.
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    closeMasterPrompt,
    masterNeedsCurrent,
    masterPrompt,
    masterPromptVisible,
    submitMasterPrompt,
    vm,
  } from "$lib/app/vault.svelte.js";

  $effect(() => {
    if (!masterPromptVisible()) return;
    (vm.field ?? vm.newField)?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

<!-- 독(설정)보다 나중에 그려져야 같은 z-index 에서 위에 온다 -->
{#if masterPromptVisible()}
  {@const mode = masterPrompt()}
  <div class="overlay overlay-fade">
    <div
      class="modal glass-raised modal-rise"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-master-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      <h2 id="vault-master-title">{t(`app.vault.master.title.${mode}` as Key)}</h2>
      {#if mode === "remove"}
        <p class="lead">
          {t("app.vault.master.lead.remove.1")}<strong
            >{t("app.vault.master.lead.remove.term")}</strong
          >{t("app.vault.master.lead.remove.2")}
        </p>
        <!-- 머리말만으로는 등급이 내려간다는 사실을 놓친다(사용자 보고) — 경고 줄을 따로 세운다 -->
        <p class="warn">
          <UiIcon name="warning" size={14} />
          <span>{t("app.vault.master.remove.warn")}</span>
        </p>
      {:else}
        <p class="lead">{t(`app.vault.master.lead.${mode}` as Key)}</p>
      {/if}

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          void submitMasterPrompt();
        }}
      >
        <div class="fields">
          {#if masterNeedsCurrent() || mode === "verify"}
            <label for="vault-master-current">{t("app.vault.master.current")}</label>
            <input
              id="vault-master-current"
              type="password"
              bind:this={vm.field}
              bind:value={vm.current}
              autocomplete="off"
              spellcheck="false"
              disabled={vm.busy}
            />
          {/if}

          {#if mode === "set" || mode === "change"}
            <label for="vault-master-new">{t("app.vault.master.new")}</label>
            <input
              id="vault-master-new"
              type="password"
              bind:this={vm.newField}
              bind:value={vm.next}
              autocomplete="off"
              spellcheck="false"
              disabled={vm.busy}
            />

            <label for="vault-master-confirm">{t("app.vault.master.confirm")}</label>
            <input
              id="vault-master-confirm"
              type="password"
              bind:value={vm.confirm}
              autocomplete="off"
              spellcheck="false"
              disabled={vm.busy}
            />
          {/if}
        </div>

        {#if vm.error}
          <p class="wrong">{vm.error}</p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={closeMasterPrompt} disabled={vm.busy}
            >{t("app.actions.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary" disabled={vm.busy}
            >{t(`app.vault.master.submit.${mode}` as Key)}</button
          >
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

  .wrong {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    color: var(--err);
  }

  /* `.wrong`(실패)과 색이 달라야 한다 — 아직 아무 일도 안 일어난 예고다 */
  .warn {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    margin: 0 0 var(--space-4);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--warn);
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
  }

  .warn :global(svg) {
    flex: 0 0 auto;
    margin-top: 1px;
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
</style>
