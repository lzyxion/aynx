<script lang="ts">
  import Toggle from "$lib/Toggle.svelte";
  // SSH 비밀번호 묻기 — 쿼리 타일의 DB 접속(`prompt.db`)도 이 모달이다. 볼트 저장은 인증이 선 뒤에만(DB 는 `db_password`).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    passwordPrompt,
    passwordVisible,
    pw,
    refreshVaultUi,
    resolvePassword,
    targetLabel,
    vaultHasMaster,
  } from "$lib/app/prompts.svelte.js";

  const pwPrompt = $derived(passwordPrompt());

  // 저장 체크는 담아 둔 값이 거부됐을 때만 미리 켠다(새로 치는 값이 곧 갱신) — 그 밖에는 꺼진 채로, 저장은 매번 새로 하는 결정이다.
  $effect(() => {
    if (!passwordVisible() || !pwPrompt) return;
    pw.value = "";
    pw.save = pwPrompt.storedRejected && !pwPrompt.noSave;
    pw.field?.focus();
    refreshVaultUi();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

{#if passwordVisible() && pwPrompt}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      {#if pwPrompt.db}
        <h2 id="pw-title">{t("app.password.db.title")}</h2>
        <p class="lead">
          {t("app.password.db.lead.1")}<strong>{pwPrompt.db.name}</strong
          >{t("app.password.db.lead.2")}<strong>{t("app.password.lead.term")}</strong
          >{t("app.password.lead.3")}
        </p>
        <dl class="fact" data-db-password-prompt={pwPrompt.db.id}>
          {#if pwPrompt.db.who}
            <dt>{t("app.password.fact.target")}</dt>
            <dd>{pwPrompt.db.who}</dd>
          {/if}
          <dt>{t("app.password.db.fact.via")}</dt>
          <dd class:prose={!pwPrompt.db.via}>{pwPrompt.db.via ? targetLabel(pwPrompt.db.via) : t("app.password.db.fact.local")}</dd>
          <dt>{t("app.password.fact.reason")}</dt>
          <dd class="reason">{pwPrompt.message}</dd>
        </dl>
      {:else}
        <h2 id="pw-title">{t("app.password.title")}</h2>
        <p class="lead">
          {t("app.password.lead.1")}<strong>{pwPrompt.alias}</strong
          >{t("app.password.lead.2")}<strong>{t("app.password.lead.term")}</strong
          >{t("app.password.lead.3")}
        </p>
        <dl class="fact">
          <dt>{t("app.password.fact.target")}</dt>
          <dd>{targetLabel(pwPrompt.alias)}</dd>
          <dt>{t("app.password.fact.reason")}</dt>
          <dd class="reason">{pwPrompt.message}</dd>
        </dl>
      {/if}

      {#if pwPrompt.storedRejected}
        <p class="wrong">{t("app.password.stored_rejected")}</p>
      {/if}

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          resolvePassword(pw.value);
        }}
      >
        <div class="fields">
          <label for="pw-input">{t("app.password.label")}</label>
          <input
            id="pw-input"
            type="password"
            bind:this={pw.field}
            bind:value={pw.value}
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <!-- 곁말은 볼트 등급을 정직하게 적는다(마스터가 없으면 "이 PC 의 내 계정" 등급) — 감추면 잘못된 안심을 산다 -->
        <!-- [연결 테스트] 가 물을 때(`noSave`)는 숨긴다 — 테스트는 볼트에 아무것도 담지 않는다 -->
        {#if !pwPrompt.noSave}
          <label class="saveopt">
            <Toggle bind:checked={pw.save} data-pw-save />
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
            {t("app.password.attempt", {
              n: pwPrompt.attempt,
              max: pwPrompt.maxAttempts,
            })}
          </span>
          <button type="button" class="ghost btn btn-secondary" onclick={() => resolvePassword(null)}
            >{t("app.actions.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary">{t("app.password.connect")}</button>
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

  /* 문장 칸은 UI 글꼴 — 고정폭이면 공백 · 괄호 · 라틴 글자가 벌어져 띄어쓰기가 달라 보인다 */
  .fact .reason,
  .fact .prose {
    font-family: var(--font-ui);
    line-height: 1.5;
    word-break: keep-all;
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
