<script lang="ts">
  // 포워딩 추가 — 새로 걸기 폼 하나. 값·여닫기는 `app/transfer` 의 `fw` 에 있다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
  // 2026-10-11 — **추가 전용**이 되었다. 걸려 있는 목록과 줄 동작(중지 · 브라우저에서 열기)은 머리줄 포워딩 칩의 목록
  // 메뉴(`pane/ForwardMenu.svelte`)로 옮겼다 — 이 모달은 그 메뉴의 "포워딩 추가…" 와 ⋯ 메뉴의 "포트 포워딩…"(포워드 0개일
  // 때)이 연다. 걸면 닫힌다(`submitForward`).
  import Dropdown from "$lib/Dropdown.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { forwardKindOptions } from "$lib/forward";
  import { closeForward, forwardVisible, fw, submitForward } from "$lib/app/transfer.svelte.js";

  $effect(() => {
    if (forwardVisible()) fw.firstField?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
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
      <h2 id="fw-title">{t("app.forward.title")}</h2>
      <p class="lead">{t("app.forward.lead")}</p>

      <form onsubmit={(ev) => void submitForward(ev)}>
        <!--
          종류(로컬 -L · 원격 -R · 동적 -D)가 칸을 가른다 (docs/log/2026-09-23-remote-dynamic-forwarding.md).
          원격은 **서버 쪽 포트를 먼저** 적는다 — 연결이 흘러가는 순서(서버 → 내 PC)가 칸의 순서다.
          감춘 칸의 값은 보내지 않는다(`submitForward`). 포커스는 언제나 `fw-local` 로 간다 —
          세 종류 모두에 있는 유일한 칸이다.
        -->
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

  .fw-hint code {
    font-family: var(--font-mono);
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
