<script lang="ts">
  // 마스터 암호 걸기·바꾸기·풀기·확인(들어가기 관문) — 설정 › 보안에서만 열린다. 값·여닫기는 `app/vault` 의 `vm` 에 있다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
  import UiIcon from "$lib/UiIcon.svelte";
  // `Key` 는 마스터 암호 모달 하나가 쓴다 — 뜻 셋(`set`·`change`·`remove`)이 제목·머리말·
  // 확인 버튼의 키 꼬리를 그대로 이루므로, 같은 마크업을 세 벌 적는 대신 꼬리만 끼운다
  // (`keybindings.ts` 의 `settings.keybinding.${id}` 와 같은 꼴).
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

  // 마스터 암호 모달도 같다 — **첫 칸**에 커서. 첫 칸의 정체가 뜻마다 다르므로(마스터가
  // 걸려 있으면 "현재", 아니면 "새 암호") 칸 참조를 둘 들고 앞의 것부터 본다.
  $effect(() => {
    if (!masterPromptVisible()) return;
    (vm.field ?? vm.newField)?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
</script>

<!--
  **마스터 암호 걸기·바꾸기·풀기** — 설정 › 보안에서만 열린다
  (docs/log/2026-09-19-vault.md ③).

  접속 대화 넷과 달리 **백엔드가 물어 온 것이 아니라 사람이 누른 것**이라, 여기 뜻 셋
  (`set`·`change`·`remove`)이 한 폼을 나눠 쓴다: 제목·머리말·확인 버튼만 갈리고 칸은 같다.
  독(설정)보다 **나중에 그려지므로** 같은 z-index 에서도 위에 온다.

  해제는 **등급이 내려가는 일**이라 머리말이 그 사실을 누르기 전에 적는다.
  틀린 현재 암호는 모달을 닫지 않는다 — 잠금 해제 모달과 같은 규칙이다.
-->
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
        <!--
          같은 말을 **한 줄 더** 세운다. 머리말은 문단이라 사람이 제목 다음 칸으로 곧장
          눈을 옮기고("현재 암호를 치라는 창이구나") 그 사이에서 등급이 내려간다는 사실을
          놓친다 — 사용자 보고. 경고는 경고처럼 생겨야 읽힌다(아이콘 + `--warn`).
        -->
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
          <!--
            현재 암호 칸은 **마스터가 걸려 있을 때만** 선다. 없으면 물어볼 것이 없고
            (`vault_set_master(new, null)`), 빈 칸을 세우면 "뭘 적으라는 거지" 가 된다.
          -->
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

          <!-- 확인(`verify` — 설정 › 보안 들어가기 관문)은 현재 암호 칸 하나다 -->
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

  /* 모달의 "틀렸습니다"·"저장된 값이 더 이상 맞지 않습니다" 한 줄 */
  .wrong {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    color: var(--err);
  }

  /*
    경고 한 줄 — 머리말(`.lead`)과 첫 입력 칸 **사이**에 서서 등급이 내려간다는 사실을
    다시 말한다. `.wrong`(실패)과 색이 달라야 한다: 이건 아직 아무 일도 안 일어난
    **예고**다. 모양은 상단 `.sync-banner` 와 같은 토큰 짝(`--warn` + `--warn-soft`).
  */
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

  /* `UiIcon` 은 `display:block` 이라 첫 줄 높이에 맞춰 살짝 내려 준다 */
  .warn :global(svg) {
    flex: 0 0 auto;
    margin-top: 1px;
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
