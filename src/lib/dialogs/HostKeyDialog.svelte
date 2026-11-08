<script lang="ts">
  // 호스트 키 확인(TOFU · 바뀐 키) — 대기열은 `app/prompts` 에 있고, 여기는 마크업과 [취소] 기본 포커스뿐이다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { answerHostKey, hostKeyPrompt } from "$lib/app/prompts.svelte.js";

  // ── 모달이 직접 잡는 값 (컴포넌트 지역) ────────────────────────────────────
  //
  // 대기열 자체는 `app/prompts` 가 들고 있고, 여기 남은 것은 **이 마크업만 아는 것**이다:
  // 호스트 키 모달이 뜰 때 포커스를 줄 [취소] 버튼 하나.
  let cancelButton = $state<HTMLButtonElement | null>(null);

  const hostKey = $derived(hostKeyPrompt());

  // 호스트 키 모달의 기본 포커스는 "취소" (실수로 신뢰를 누르지 않게)
  $effect(() => {
    if (hostKey) cancelButton?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
</script>

<!--
  호스트 키 확인 — **한 상자가 두 사건**을 다룬다 (docs/log/2026-09-16-quick-connect-and-host-keys.md).

  `changed:false` 는 처음 보는 키(TOFU)이고, `changed:true` 는 **기록된 키가 달라졌다** 는
  훨씬 무거운 사건이다. 제목·문구·버튼이 그 한 칸으로 갈린다. 상자를 둘로 나누지 않은 이유는
  Escape 사슬·대기열·포커스 규칙이 완전히 같기 때문이다 — 나누면 그 셋을 두 벌 유지해야 한다.
-->
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
        <!-- `UserKnownHostsFile none` — 적을 파일이 없으니 [갱신] 자체가 뜻이 없다 -->
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
          <!--
            갱신은 **기록할 수 있을 때만** 뜬다. 누르면 그 호스트/포트의 줄을 새 키로 갈아
            끼운다 (`known_hosts::replace` — 남의 줄은 건드리지 않는다).
          -->
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
    바뀐 호스트 키 — 제목과 [갱신] 버튼만 경고색을 쓴다. 그 상자는 "처음 보는 키" 와 같은
    모양인데 **사건의 무게가 다르다**: 기록해 둔 신뢰가 깨졌다는 뜻이라, 평소의 확인 창과
    한눈에 구분되지 않으면 사람이 같은 속도로 눌러 버린다
    (docs/log/2026-09-16-quick-connect-and-host-keys.md).
  */
  .modal h2.danger {
    color: var(--warn);
  }

  /* [갱신] — 주 동작 자리지만 강조색이 아니라 경고색으로 채운다 (되돌릴 수 없는 확정의 `--err` 채움과 같은 결) */
  .primary.danger {
    color: var(--on-accent);
    background: var(--warn);
    font-weight: var(--fw-semibold);
  }

  .primary.danger:hover {
    background: color-mix(in srgb, var(--warn) 88%, var(--fg));
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

  /* 지문 — 강조색이 아니라 본문 글자 그대로 (강조색은 셋뿐) */
  .fact .fp {
    color: var(--fg-1);
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
</style>
