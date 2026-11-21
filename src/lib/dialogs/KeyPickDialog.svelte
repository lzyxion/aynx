<script lang="ts">
  // 공개키 설치의 키 선택 — ↑↓·Enter 는 상자의 `onKeyPickKeydown`(`app/prompts`)이 다룬다.
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import {
    keyPick,
    keyPickGroupLabel,
    keyPickPrompt,
    keyPickRows,
    keyPickVisible,
    onKeyPickKeydown,
    resolveKeyPick,
  } from "$lib/app/prompts.svelte.js";

  const keyPickCur = $derived(keyPickPrompt());
  /** ↑↓ 의 줄 번호가 이 배열의 index 다 */
  const keyRows = $derived(keyPickCur === null ? [] : keyPickRows(keyPickCur));

  $effect(() => {
    if (!keyPickVisible() || !keyPickCur) return;
    keyPick.index = 0;
    keyPick.el?.focus();
  });
</script>

{#if keyPickVisible() && keyPickCur}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="key-title"
      tabindex="-1"
      bind:this={keyPick.el}
      onkeydown={(ev) => {
        // Tab 은 모달 뒤로 새지 않게 되감는다 (`trapTab`) — 나머지 키는 ↑↓·Enter 처리로
        if (keyPick.el && trapTab(ev, keyPick.el)) return;
        onKeyPickKeydown(ev);
      }}
    >
      <div class="glass-scroll">
      <h2 id="key-title">{t("app.keypick.title")}</h2>
      <p class="lead">
        {t("app.keypick.lead.1")}<strong>{keyPickCur.alias}</strong
        >{t("app.keypick.lead.2")}<code>~/.ssh/authorized_keys</code
        >{t("app.keypick.lead.3")}<strong>{t("app.keypick.lead.term")}</strong
        >{t("app.keypick.lead.4")}
      </p>

      <!-- 소제목은 줄이 아니다 — ↑↓ 는 무리 경계를 모르고 줄 번호의 뜻은 `keyPickRows` 한 곳에서 정해진다 -->
      <ul class="keylist">
        {#each keyRows as row, i (row.id)}
          {#if row.first}
            <li class="keygroup" aria-hidden="true">{keyPickGroupLabel(row.group)}</li>
          {/if}
          <li>
            <button
              type="button"
              class="keyitem"
              class:sel={i === keyPick.index}
              class:makenew={row.group === "new"}
              title={row.title}
              onmouseenter={() => (keyPick.index = i)}
              onclick={() => resolveKeyPick(row.picked)}
            >
              <span class="keyname">{row.label}</span>
              <span class="keyfp">{row.detail}</span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="actions">
        <button type="button" class="ghost btn btn-secondary" onclick={() => resolveKeyPick(null)}
          >{t("app.actions.cancel")}</button
        >
        <button
          type="button"
          class="primary btn btn-primary"
          onclick={() => resolveKeyPick(keyRows[keyPick.index]?.picked ?? null)}
        >
          {t("app.keypick.go")}
        </button>
      </div>
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

  .keylist {
    margin: 0 0 var(--space-4);
    padding: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
    list-style: none;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .keyitem {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    box-sizing: border-box;
    width: 100%;
    min-height: 28px;
    padding: 6px var(--space-2);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .keyitem.sel {
    background: var(--surface-hover);
  }

  .keygroup {
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .keygroup:first-child {
    padding-top: var(--space-1);
  }

  .keyitem.makenew {
    color: var(--fg-2);
  }

  .keyname {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keyfp {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* `.ghost`/`.primary` 는 표식으로만 남는다 — 검증 도구가 `.actions .primary` 로 찾는다 */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
