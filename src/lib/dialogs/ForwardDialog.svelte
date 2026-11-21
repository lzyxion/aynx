<script lang="ts">
  // 포워딩 추가 전용 — 걸려 있는 목록은 `pane/ForwardMenu.svelte`.
  import Dropdown from "$lib/Dropdown.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { forwardKindOptions } from "$lib/forward";
  import { closeForward, forwardVisible, fw, submitForward } from "$lib/app/transfer.svelte.js";

  $effect(() => {
    if (forwardVisible()) fw.firstField?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

{#if forwardVisible()}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fw-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <div class="glass-scroll">
      <h2 id="fw-title">{t("app.forward.title")}</h2>
      <p class="lead">{t("app.forward.lead")}</p>

      <form onsubmit={(ev) => void submitForward(ev)}>
        <!-- 포커스는 언제나 `fw-local` 로 간다 — 세 종류 모두에 있는 유일한 칸이다 -->
        <div class="fields">
          <label for="fw-kind">{t("app.forward.field.kind")}</label>
          <Dropdown id="fw-kind" bind:value={fw.kind} options={forwardKindOptions(t)} />

          {#if fw.kind === "remote"}
            <label for="fw-remote">{t("app.forward.field.remote.server")}</label>
            <input
              id="fw-remote"
              type="number"
              min="1"
              max="65535"
              bind:value={fw.remotePort}
              placeholder="18080"
              required
            />
          {/if}

          <label for="fw-local"
            >{fw.kind === "remote"
              ? t("app.forward.field.local.target")
              : t("app.forward.field.local")}</label
          >
          <input
            id="fw-local"
            type="number"
            min="1"
            max="65535"
            bind:this={fw.firstField}
            bind:value={fw.localPort}
            placeholder={fw.kind === "dynamic" ? "1080" : fw.kind === "remote" ? "8080" : "15432"}
            required
          />

          {#if fw.kind === "local"}
            <label for="fw-host">{t("app.forward.field.host")}</label>
            <input
              id="fw-host"
              bind:value={fw.remoteHost}
              placeholder="localhost"
              autocomplete="off"
              spellcheck="false"
              required
            />

            <label for="fw-remote">{t("app.forward.field.remote")}</label>
            <input
              id="fw-remote"
              type="number"
              min="1"
              max="65535"
              bind:value={fw.remotePort}
              placeholder="5432"
              required
            />
          {/if}
        </div>

        {#if fw.error}
          <p class="error" role="alert">{fw.error}</p>
        {/if}

        <p class="fw-hint">
          {#if fw.kind === "remote"}
            {t("app.forward.hint.remote")}
          {:else if fw.kind === "dynamic"}
            {t("app.forward.hint.dynamic")}
          {:else}
            {t("app.forward.hint.local.1")}<code>localhost</code>{t("app.forward.hint.local.2")}
          {/if}
        </p>

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={closeForward}
            >{t("app.actions.close")}</button
          >
          <button type="submit" class="primary btn btn-primary" disabled={fw.busy}>
            {fw.busy ? t("app.forward.busy") : t("app.forward.add")}
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

  .fw-hint code {
    font-family: var(--font-mono);
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
