<script lang="ts">
  // 호스트 키 확인(TOFU · 바뀐 키).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { answerHostKey, hostKeyPrompt } from "$lib/app/prompts.svelte.js";

  let cancelButton = $state<HTMLButtonElement | null>(null);

  const hostKey = $derived(hostKeyPrompt());

  // 기본 포커스는 [취소] — 실수로 신뢰를 누르지 않게
  $effect(() => {
    if (hostKey) cancelButton?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

<!-- 한 상자가 두 사건(처음 보는 키 · 바뀐 키)을 다룬다 — Escape 사슬·대기열·포커스 규칙이 같아 나누지 않는다 -->
{#if hostKey}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tofu-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      {#if hostKey.changed}
        <h2 id="tofu-title" class="danger">{t("app.hostkey.changed.title")}</h2>
        <p class="lead">
          {t("app.hostkey.changed.lead.1")}<strong>{hostKey.alias}</strong
          >{t("app.hostkey.changed.lead.2")}<code>~/.ssh/known_hosts</code
          >{t("app.hostkey.changed.lead.3")}
        </p>
      {:else}
        <h2 id="tofu-title">{t("app.hostkey.new.title")}</h2>
        <p class="lead">
          {t("app.hostkey.new.lead.1")}<strong>{hostKey.alias}</strong
          >{t("app.hostkey.new.lead.2")}<code>~/.ssh/known_hosts</code
          >{t("app.hostkey.new.lead.3")}
        </p>
      {/if}
      <dl class="fact">
        {#if hostKey.host}
          <dt>{t("app.hostkey.fact.host")}</dt>
          <dd>{hostKey.host}{hostKey.port !== null && hostKey.port !== 22 ? `:${hostKey.port}` : ""}</dd>
        {/if}
        <dt>{t("app.hostkey.fact.keyType")}</dt>
        <dd>{hostKey.key_type}</dd>
        {#if hostKey.changed && hostKey.oldFingerprint}
          <dt>{t("app.hostkey.fact.recorded")}</dt>
          <dd class="fp">{hostKey.oldFingerprint}</dd>
          <dt>{t("app.hostkey.fact.new")}</dt>
        {:else}
          <dt>{t("app.hostkey.fact.fingerprint")}</dt>
        {/if}
        <dd class="fp">{hostKey.fingerprint}</dd>
      </dl>
      {#if hostKey.changed && !hostKey.canRecord}
        <p class="lead">
          {t("app.hostkey.noRecord.before")}<code>UserKnownHostsFile none</code
          >{t("app.hostkey.noRecord.after")}
        </p>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="ghost btn btn-secondary"
          bind:this={cancelButton}
          onclick={() => answerHostKey("reject")}
        >
          {t("app.hostkey.reject")}
        </button>
        {#if hostKey.allowOnce}
          <button type="button" class="ghost btn btn-secondary" onclick={() => answerHostKey("once")}>
            {t("app.hostkey.once")}
          </button>
        {/if}
        {#if hostKey.changed}
          {#if hostKey.canRecord}
            <button type="button" class="primary danger btn" onclick={() => answerHostKey("replace")}>
              {t("app.hostkey.replace")}
            </button>
          {/if}
        {:else}
          <button type="button" class="primary btn btn-primary" onclick={() => answerHostKey("trust")}>
            {hostKey.canRecord ? t("app.hostkey.trust.record") : t("app.hostkey.trust")}
          </button>
        {/if}
      </div>
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

  /* 바뀐 키는 평소 확인 창과 한눈에 구분돼야 한다 — 아니면 사람이 같은 속도로 눌러 버린다 */
  .modal h2.danger {
    color: var(--warn);
  }

  .primary.danger {
    color: var(--on-accent);
    background: var(--warn);
    font-weight: var(--fw-semibold);
  }

  .primary.danger:hover {
    background: color-mix(in srgb, var(--warn) 88%, var(--fg));
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

  .fact .fp {
    color: var(--fg-1);
  }

  /* `.ghost`/`.primary` 는 표식으로만 남는다 — 검증 도구가 `.actions .primary` 로 찾는다 */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
