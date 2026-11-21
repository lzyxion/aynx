<script lang="ts">
  import Toggle from "$lib/Toggle.svelte";
  // 개인키 암호구 묻기 — 대상은 서버가 아니라 내 디스크의 키 파일이라 파일 이름을 부른다.
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { keyFileName } from "$lib/keygen";
  import {
    passphrasePrompt,
    passphraseVisible,
    pp,
    refreshVaultUi,
    resolvePassphrase,
    vaultHasMaster,
  } from "$lib/app/prompts.svelte.js";

  const ppPrompt = $derived(passphrasePrompt());

  // 저장은 기본 꺼짐(저장값이 거절됐을 때만 켜고 시작) — 접속하려고 연 창이 저장까지 조용히 해 버리면 안 된다.
  $effect(() => {
    if (!passphraseVisible() || !ppPrompt) return;
    pp.value = "";
    pp.save = ppPrompt.storedRejected && !ppPrompt.noSave;
    pp.field?.focus();
    refreshVaultUi();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

{#if passphraseVisible() && ppPrompt}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      <h2 id="pp-title">{t("app.passphrase.title", { name: keyFileName(ppPrompt.path) })}</h2>
      <p class="lead">
        {t("app.passphrase.lead.1")}<strong>{t("app.passphrase.lead.term")}</strong
        >{t("app.passphrase.lead.2")}
      </p>
      <dl class="fact">
        <dt>{t("app.passphrase.fact.file")}</dt>
        <dd class="reason">{ppPrompt.path}</dd>
        {#if ppPrompt.fingerprint}
          <dt>{t("app.passphrase.fact.fingerprint")}</dt>
          <dd class="reason">{ppPrompt.fingerprint}</dd>
        {/if}
      </dl>

      {#if ppPrompt.wrong}
        <p class="wrong">{t("app.passphrase.wrong")}</p>
      {:else if ppPrompt.storedRejected}
        <p class="wrong">{t("app.passphrase.stored_rejected")}</p>
      {/if}

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          resolvePassphrase(pp.value);
        }}
      >
        <div class="fields">
          <label for="pp-input">{t("app.passphrase.label")}</label>
          <input
            id="pp-input"
            type="password"
            bind:this={pp.field}
            bind:value={pp.value}
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <!-- 곁말은 볼트 등급을 정직하게 적는다(마스터가 없으면 "이 PC 의 내 계정" 등급) — 감추면 잘못된 안심을 산다 -->
        <!-- [연결 테스트] 가 물을 때(`noSave`)는 숨긴다 — 테스트는 볼트에 아무것도 담지 않는다 -->
        {#if !ppPrompt.noSave}
          <label class="saveopt">
            <Toggle bind:checked={pp.save} data-pp-save />
            <span>
              {t("app.save.label")}
              <span class="note">
                {vaultHasMaster() ? t("app.save.note.master") : t("app.save.note.nomaster")}
              </span>
            </span>
          </label>
        {/if}

        <div class="actions">
          <span class="attempt">
            {t("app.passphrase.attempt", {
              n: ppPrompt.attempt,
              max: ppPrompt.maxAttempts,
            })}
          </span>
          <button type="button" class="ghost btn btn-secondary" onclick={() => resolvePassphrase(null)}
            >{t("app.passphrase.skip")}</button
          >
          <button type="submit" class="primary btn btn-primary">{t("app.passphrase.unlock")}</button>
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
    /* 모달은 언제나 최상층(패널 안 요소가 새어 나와 덮으면 클릭·입력이 안 된다) · 관문 창이라 다른 모달 위(같은 층이면 나중 마운트가 위에 온다) */
    z-index: 112;
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

  .fact {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-4);
    padding: var(--space-3);
    font-size: var(--t-xs);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .fact dt {
    color: var(--fg-2);
  }

  .fact dd {
    margin: 0;
    font-family: var(--font-mono);
    word-break: break-all;
    user-select: text;
  }

  .fact .reason {
    font-family: var(--font-ui);
    line-height: 1.5;
    word-break: keep-all;
    /* keep-all 이 break-all 을 덮어 공백 없는 긴 키 경로가 가로 막대를 세운다 — 빼지 않는다 */
    overflow-wrap: anywhere;
  }

  .wrong {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    color: var(--err);
  }

  .saveopt {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    color: var(--fg-1);
    cursor: pointer;
  }

  .saveopt .note {
    display: block;
    margin-top: 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .attempt {
    margin-right: auto;
    align-self: center;
    font-size: var(--t-xs);
    color: var(--fg-3);
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
