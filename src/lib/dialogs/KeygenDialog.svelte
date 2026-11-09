<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  // 새 키 만들기(`ssh-keygen`) — 값·여닫기는 `app/keygen` 에 있다. 다른 모달 위에서 열리므로 +page 의 **맨 뒤 오버레이**로 둔다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
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

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
</script>

<!--
  **새 키 만들기** — `ssh-keygen` 을 대신 부르는 작은 모달 (docs/log/2026-09-17-keygen.md).

  마크업이 **모든 오버레이보다 뒤**에 있는 것이 이 블록의 유일한 배치 규칙이다: 오버레이는
  전부 같은 z-index 라 나중에 그려진 것이 위에 온다. 이 모달을 여는 길은 둘 다 이미 모달
  위이므로(호스트 폼의 IdentityFile 줄 · 공개키 설치 고르개의 "새 키 만들기…"), 언제나
  가장 위여야 한다. Escape 사슬에서도 같은 이유로 맨 앞이다 (`app/keys` 의 모달 사슬).

  암호구 두 칸은 `type="password"` 이고 **어디에도 저장되지 않는다** — 닫는 문 하나
  (`app/keygen` 의 `finish`)가 어느 경로로 닫히든 "" 로 지운다.
-->
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
    background: var(--bg-overlay);
  }

  .modal {
    width: 100%;
    max-width: 420px;
    /* 호스트 폼은 칸이 10개라 작은 창에서 화면을 넘긴다 — 모달 안에서 스크롤한다
       (overlay 의 padding 16px 을 빼 준다) */
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /*
    `display:block` 그대로 둔다 — 다른 `.lead` 들은 <code>·<strong> 이 섞인 평범한 문단이라
    flex 로 바꾸면 그 인라인 요소 하나하나가 flex 아이템이 되어 줄바꿈이 깨진다. 접힌 안내를
    담은 `.lead` 는 안쪽 `.note-head`(flex) 가 블록 상자라 알아서 두 줄로 쌓인다.
  */
  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .lead code {
    font-family: var(--font-mono);
  }

  /*
    버튼 — 전역 `.btn` 세 종류 (docs/log/2026-09-25-finish-menus.md · 토큰층 "버튼 세 종류"):
    취소 = 보조(`.btn-secondary`), 확정 = 주(`.btn-primary`, 이 상자의 하나뿐인 강조색).
    옛 `.ghost`/`.primary` 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이긴다. 두 이름은
    표식으로만 남는다(검증 도구가 `.actions .primary` 로 찾는다).
  */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* 호스트 추가 폼 — TOFU 모달의 .fact 와 같은 2열 격자를 쓴다 */
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

  /* 포커스는 중성 — 강조색 선은 "강조는 셋뿐" 밖이다 (docs/log/2026-09-25-finish-menus.md) */
  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  /* 사용 예 — 폼 아래 조용한 한 문단 */
  .fw-hint {
    margin: 0 0 12px;
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-3);
  }

  /* 실패 한 줄 — 의미색 판(`--err-soft`), 강조색 선이 아니다 */
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
