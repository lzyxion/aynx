<script lang="ts">
  import Toggle from "$lib/Toggle.svelte";
  // 개인키 암호구 묻기 — 비밀번호 모달과 같은 모양, 대상은 내 디스크의 키 파일. 값은 `app/prompts` 의 `pp` 에 있다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
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

  // 암호구 모달도 같은 규칙 — 뜰 때(또는 다음 요청으로 넘어갈 때) 빈 칸에서 시작한다.
  $effect(() => {
    if (!passphraseVisible() || !ppPrompt) return;
    pp.value = "";
    pp.save = ppPrompt.storedRejected && !ppPrompt.noSave;
    pp.field?.focus();
    refreshVaultUi();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
</script>

<!--
  **개인키 암호구** — 비밀번호 모달과 같은 모양이되 대상이 다르다
  (docs/log/2026-09-19-identity-file-auth.md). 저쪽은 서버의 비밀번호이고 이쪽은 내 디스크의
  키 파일이라, 제목도 본문도 호스트가 아니라 **파일 이름**을 부른다.

  체크박스는 기본이 꺼짐이다 — 저장은 매번 새로 하는 결정이고, 접속하려고 연 창이 그것까지
  조용히 해 버리면 안 된다. (2026-09-19 ② 에 그 자리가 "ssh-agent 에 넣기" 에서 "이 앱에
  저장" 으로 바뀌었다 — docs/log/2026-09-19-vault.md.)
-->
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

        <!--
          **"이 앱에 저장" 한 칸** (docs/log/2026-09-19-vault.md).
          곁말은 금고의 등급을 정직하게 적는다 — 마스터가 없으면 "이 PC 의 내 계정" 등급이고,
          그 사실을 감추면 사용자가 잘못된 안심을 산다.
        -->
        <!-- DB 연결 폼의 [연결 테스트] 가 묻을 때(`noSave`)는 숨긴다 — 테스트는 볼트에 아무것도 담지 않는다 -->
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
    /* 모달은 언제나 최상층 — 패널 안 요소들(재연결 배너 z-5 등)이 전역 층위로 새어
       나와 모달을 투명하게 덮으면 "보이는데 클릭·입력이 안 되는" 증상이 된다 (실기 발견).
       패널 쪽은 pane-box 의 isolation 으로 새는 것 자체도 막지만, 모달의 최상층 보장은
       여기서 독립적으로 지킨다. */
    /* 관문 창은 다른 모달(DB 연결 폼의 [연결 테스트] 등 — 마운트가 더 뒤라 같은 층이면 위에 온다) 위에 선다 — 2026-11-09 */
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
    max-width: calc(420px + 2 * var(--space-4) + 2px); /* 옛 content-box 너비 그대로 — 안쪽 여백(스크롤 칸) · 테두리를 더함 */
    /* 호스트 폼은 칸이 10개라 작은 창에서 화면을 넘긴다 — 모달 안에서 스크롤한다
       (overlay 의 padding 16px 을 빼 준다) */
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) — 흐림 층이 밑동까지 덮게 */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
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

  /* 비밀번호 모달의 "사유" 는 한국어 문장이라 UI 폰트로 흘려 준다 */
  .fact .reason {
    font-family: var(--font-ui);
    line-height: 1.5;
    word-break: keep-all;
  }

  /* 모달의 "틀렸습니다"·"저장된 값이 더 이상 맞지 않습니다" 한 줄 */
  .wrong {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    color: var(--err);
  }

  /* "이 앱에 저장 (볼트)" — 입력 칸과 버튼 줄 사이에 선다 (두 모달이 함께 쓴다) */
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
</style>
