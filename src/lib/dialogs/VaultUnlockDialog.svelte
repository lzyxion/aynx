<script lang="ts">
  // 금고 잠금 해제 — 접속 대화 사슬의 맨 앞. 값·여닫기는 `app/prompts` 의 `vu` 에 있다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { trapTab } from "$lib/focus-trap";
  import {
    skipVaultUnlock,
    submitVaultUnlock,
    vaultUnlockVisible,
    vu,
  } from "$lib/app/prompts.svelte.js";

  // 금고 잠금 해제도 같은 규칙이다 — 뜨면 빈 칸에 커서. 칸은 **언제나** 선다(마스터가
  // 없어도): 모달의 꼴로 볼트의 속을 알려 주지 않는다는 결정이다.
  $effect(() => {
    if (!vaultUnlockVisible()) return;
    vu.field?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
</script>

<!--
  **금고 잠금 해제** — 접속 대화 사슬의 맨 앞 (docs/log/2026-09-19-vault.md).

  다른 넷과 달리 이 모달은 **접속을 시작하기 전에** 뜬다: 잠긴 금고에서는 담아 둔 값이
  없는 것과 같아서, 열고 나서야 `open_ssh_session` 을 부르는 뜻이 있다.
  [이번엔 건너뛰기](= Escape)는 거부가 아니라 "이번 접속은 볼트 없이" 라는 멀쩡한 답이다.

  틀린 암호는 **모달을 닫지 않는다** — 칸 아래에 줄만 세우고 커서를 되돌린다.

  **꼴은 하나다** (2026-09-19 밤 — 가림막 관문과 같은 결정). 저녁 판은 마스터가 없으면 칸
  대신 "마스터 암호가 없습니다 — Enter 로 엽니다" 한 줄을 세웠다. 그 줄이 **마스터의 있고
  없음을 그대로 말해 준다** — 가림막에서 지운 바로 그 누설이다. 이제 두 경우가 같은 폼(라벨 ·
  `#vault-input` · [열기])이고, 갈리는 것은 화면 밖 `vault_unlock` 이 받는 값뿐이다:
  마스터가 없으면 **빈 값만이 답**이고, 무언가 쳤다면 명령을 내보내기 전에 같은 "맞지
  않습니다" 줄로 접는다 (`app/prompts` 의 `submitVaultUnlock`).

  **모양은 가림막의 잠금 카드와 한 벌**(2026-10-28 — 전역 `.lock-card`, theme.css · 목업 LNdmYmQkmSP9qGzd8JwP4c).
  가림막과 달리 뒤를 흐리지 않고 옅은 막(25%)만 깐다 — 뒤 화면은 그대로 읽히되 "지금은 이 카드에 답한다" 가 보이고,
  흐린 가림막과 한눈에 갈린다. 설명 한 줄과 [이번엔 건너뛰기] 는 이 카드에만 있다.
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
      <!-- 머리말도 **한 벌**이다 — 뜻마다 다른 머리말은 곧 뜻을 알려 주는 머리말이다. -->
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

        <!-- [열기](꽉 찬 알약) 위 · [이번엔 건너뛰기](글자 단추) 아래. `.actions .primary` · `.ghost` 는 검증 도구의 손잡이 -->
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
    /* 모달은 언제나 최상층 — 패널 안 요소들(재연결 배너 z-5 등)이 전역 층위로 새어
       나와 모달을 투명하게 덮으면 "보이는데 클릭·입력이 안 되는" 증상이 된다 (실기 발견).
       패널 쪽은 pane-box 의 isolation 으로 새는 것 자체도 막지만, 모달의 최상층 보장은
       여기서 독립적으로 지킨다. */
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    /* 흐림 없이 옅은 막만 — 다른 모달의 `--bg-overlay`(62%)보다 훨씬 옅다(머리말) */
    background: color-mix(in srgb, #000 25%, transparent);
  }

  /* 버튼 둘 — 카드 폭으로 세로로 쌓는다 */
  .actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
