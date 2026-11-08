<script lang="ts">
  // 파일 올리기·복사 — 대상 폴더와 파일 목록. 값·진행은 `app/transfer` 의 `up` 에 있다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { humanSize } from "$lib/sftp";
  import {
    closeUpload,
    retryOverwrite,
    submitUpload,
    up,
    uploadDone,
    uploadFailed,
    uploadItems,
    uploadTarget,
    uploadVisible,
    verb,
  } from "$lib/app/transfer.svelte.js";

  const uploadWords = $derived(verb());

  $effect(() => {
    if (uploadVisible()) up.dirField?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
</script>

{#if uploadVisible()}
  <div class="overlay">
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="up-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <h2 id="up-title">{t(uploadWords.title)}</h2>
      <p class="lead">
        {#if uploadTarget()?.kind === "local"}
          <strong>{up.pane}</strong
          >{t("app.upload.lead.local.1")}<strong>{t("app.upload.lead.local.term")}</strong
          >{t("app.upload.lead.local.2")}
        {:else}
          <strong>{up.pane}</strong
          >{t("app.upload.lead.remote.1")}
        {/if}
        {t("app.upload.lead.tail.1")}<strong>{t("app.upload.lead.tail.term")}</strong
        >{t("app.upload.lead.tail.2")}
      </p>

      <ul class="up-list">
        {#each uploadItems() as item, i (i)}
          <li>
            <span class="up-name" title={item.file.name}>{item.file.name}</span>
            <span class="up-size">{humanSize(item.file.size)}</span>
            <span class="up-state" class:done={item.state === "done"} class:bad={item.state === "error"}>
              {t(`files.transfer.state.${item.state}`)}
            </span>
            {#if item.exists}
              <button
                type="button"
                class="browse btn btn-secondary btn-sm"
                disabled={up.busy}
                onclick={() => void retryOverwrite(item)}
              >
                {t("app.upload.overwrite")}
              </button>
            {/if}
          </li>
          {#if item.error}
            <li class="up-error">{item.error}</li>
          {/if}
        {/each}
      </ul>

      <form onsubmit={(ev) => void submitUpload(ev)}>
        <div class="fields">
          <label for="up-dir">
            {uploadTarget()?.kind === "local"
              ? t("app.upload.field.localDir")
              : t("app.upload.field.remoteDir")}
          </label>
          <input
            id="up-dir"
            bind:this={up.dirField}
            bind:value={up.dir}
            placeholder={uploadTarget()?.kind === "local" ? "C:\Users\…" : "~/"}
            autocomplete="off"
            spellcheck="false"
            required
          />
        </div>

        <div class="actions">
          <span class="attempt"
            >{t("app.upload.progress", {
              done: uploadDone(),
              total: uploadItems().length,
            })}</span
          >
          <button type="button" class="ghost btn btn-secondary" disabled={up.busy} onclick={closeUpload}>
            {t("app.actions.close")}
          </button>
          <button type="submit" class="primary btn btn-primary" disabled={up.busy}>
            {#if up.busy}
              {t(`files.transfer.state.${uploadWords.ing}`)}…
            {:else if uploadFailed() > 0}
              {t("app.upload.retry", { count: uploadFailed(), verb: t(uploadWords.go) })}
            {:else}
              {t(uploadWords.go)}
            {/if}
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

  /* 줄 안의 작은 단추(포워드 [브라우저에서 열기]·[중지] · 업로드 [덮어쓰기]) — 모양은 `.btn .btn-secondary .btn-sm`,
     `browse` 는 표식으로만 남는다 */
  .browse {
    flex: 0 0 auto;
  }

  /* 파일 목록 — 포워드 목록과 같은 상자 (같은 성격의 "지금 이것들" 이라 모양도 같다) */
  .up-list {
    margin: 0 0 var(--space-3);
    padding: var(--space-1);
    list-style: none;
    max-height: 200px;
    overflow-y: auto;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .up-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
  }

  .up-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }

  .up-size {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    opacity: 0.75;
  }

  .up-state {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .up-state.done {
    color: var(--ok);
  }

  .up-state.bad {
    color: var(--warn);
  }

  /* 실패 사유는 그 파일 바로 아래 줄에 (어느 파일의 오류인지 헷갈릴 자리가 없게) */
  .up-error {
    padding: 0 4px 6px 4px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--warn);
    word-break: keep-all;
    user-select: text;
  }
</style>
