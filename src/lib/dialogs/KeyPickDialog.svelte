<script lang="ts">
  // 공개키 설치의 키 선택 — ↑↓·Enter 는 상자의 `onKeyPickKeydown`(`app/prompts`)이 다룬다.
  // (2026-09-30 `+page.svelte` 에서 마크업을 그대로 옮겼다 — id·클래스·`bind:`·i18n 키·주석 불변. 스타일은 스코프라 베껴 왔다.)
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
  /** 두 무리 + "새 키 만들기…" 를 평평하게 편 목록 — ↑↓ 의 줄 번호가 이 배열의 index 다 */
  const keyRows = $derived(keyPickCur === null ? [] : keyPickRows(keyPickCur));

  $effect(() => {
    if (!keyPickVisible() || !keyPickCur) return;
    keyPick.index = 0;
    keyPick.el?.focus();
  });
</script>

<!--
  공개키 설치의 **키 선택** — 이 흐름이 새로 만드는 유일한 모달이다
  (docs/log/2026-09-03-copy-id-ui.md). ssh-agent 에 키가 둘 이상일 때만 뜨고, 하나면
  물어볼 것이 없어 곧바로 비밀번호 단계로 간다.
-->
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

      <!--
        목록은 **세 무리**다 (docs/log/2026-09-17-keygen.md): ssh-agent · 파일(~/.ssh) ·
        맨 아래 "새 키 만들기…". 소제목은 무리의 첫 줄 위에만 그리고, ↑↓ 는 그 경계를
        모른다 — 사람이 보기에 목록은 하나이고 무리는 그 안의 구획이다.
        줄 번호의 뜻은 `keyPickRows` 한 곳에서 정해진다.
      -->
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

  .lead code {
    font-family: var(--font-mono);
  }

  /* 공개키 선택 목록 — `.fact` 상자와 같은 바탕/테두리를 써서 모달 안에서 같은 층으로 읽힌다 */
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

  /* 줄 = 메뉴 줄과 같은 결 (최소 28px · 13px) */
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

  /* 마우스 hover 와 ↑↓ 하이라이트가 **같은 표시**다 (선택 줄은 언제나 하나뿐이다) */
  .keyitem.sel {
    background: var(--surface-hover);
  }

  /*
    무리 소제목 (ssh-agent · 파일 · 새로 만들기). 줄이 아니라 **구획의 이름**이라 클릭 대상이
    아니고, ↑↓ 도 여기서 멈추지 않는다 — `aria-hidden` 인 이유가 그것이다(스크린 리더에게는
    아래 버튼들의 라벨이 이미 무엇인지 말한다).
  */
  .keygroup {
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .keygroup:first-child {
    padding-top: var(--space-1);
  }

  /* "새 키 만들기…" 는 목록의 항목이 아니라 **비상구**라 결을 달리한다 — 강조색 대신 한 단 흐리게 */
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
