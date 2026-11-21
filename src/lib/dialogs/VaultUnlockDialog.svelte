<script lang="ts">
  // 금고 잠금 해제 — 접속 대화 사슬의 맨 앞(잠긴 금고에서는 담아 둔 값이 없는 것과 같아 접속 전에 뜬다).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { trapTab } from "$lib/focus-trap";
  import {
    skipVaultUnlock,
    submitVaultUnlock,
    vaultUnlockVisible,
    vu,
  } from "$lib/app/prompts.svelte.js";

  $effect(() => {
    if (!vaultUnlockVisible()) return;
    vu.field?.focus();
  });

  let modalEl = $state<HTMLElement | null>(null);
</script>

<!--
  꼴은 하나다 — 마스터가 있든 없든 같은 폼(칸 · 머리말 · [열기])이라 모달의 꼴이 마스터의 있고 없음을 말하지 않는다(가림막 관문과 같은 결정).
  마스터가 없으면 빈 값만이 답이고, 무언가 쳤다면 명령을 내보내기 전에 같은 "맞지 않습니다" 줄로 접는다(`submitVaultUnlock`).
-->
{#if vaultUnlockVisible()}
  <div class="overlay overlay-fade">
    <div
      class="modal lock-card glass-raised modal-rise"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <span class="lock-badge" aria-hidden="true"><UiIcon name="lock" size={26} /></span>
      <h2 id="vault-title" class="lock-title">{t("app.vault.unlock.title")}</h2>
      <p class="lead lock-lead">{t("app.vault.unlock.lead")}</p>

      <form
        class="lock-form"
        onsubmit={(ev) => {
          ev.preventDefault();
          void submitVaultUnlock();
        }}
      >
        <label class="lock-label" for="vault-input">{t("app.vault.unlock.label")}</label>
        <input
          id="vault-input"
          class="lock-input"
          type="password"
          bind:this={vu.field}
          bind:value={vu.value}
          autocomplete="off"
          spellcheck="false"
          disabled={vu.busy}
        />

        {#if vu.error}
          <p class="wrong lock-wrong">{vu.error}</p>
        {/if}

        <!-- `.actions .primary` · `.ghost` 는 검증 도구의 손잡이 -->
        <div class="actions">
          <button type="submit" class="primary btn btn-primary lock-open" disabled={vu.busy}
            >{t("app.vault.unlock.open")}</button
          >
          <button type="button" class="ghost btn btn-ghost lock-skip" onclick={() => skipVaultUnlock()} disabled={vu.busy}
            >{t("app.vault.unlock.skip")}</button
          >
        </div>
      </form>
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
    background: color-mix(in srgb, #000 25%, transparent);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
