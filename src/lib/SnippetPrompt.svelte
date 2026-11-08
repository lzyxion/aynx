<script lang="ts">
  /**
   * **스니펫 자리표시자를 묻는 작은 모달** (docs/log/2026-09-16-snippets.md).
   *
   * `{{호스트}}` 같은 토큰이 든 스니펫을 넣을 때 그 칸들을 한 번에 묻는다. 칸 순서는
   * 명령에 나온 순서 그대로다(`placeholdersOf`) — 사람이 명령을 눈으로 좇으며 채운다.
   *
   * 칸에는 **기본값**(`{{이름=기본값}}`)이 미리 채워져 있을 수 있고, **설명**
   * (`{{이름|설명}}`)은 칸 아래 흐린 한 줄로 뜬다. 채우는 일은 여기서 하지 않는다 —
   * 여는 쪽(`askPlaceholders`)이 `defaultValuesOf` 로 값 표를 세워 두고 열므로, 이 화면은
   * 여느 때처럼 `snippetPromptValue` 를 읽기만 한다.
   *
   * ## 왜 `app/prompts.svelte.ts` 에 얹지 않았나
   *
   * 저쪽 셋(호스트 키·비밀번호·키 선택)은 **접속 중에 백엔드가 되묻는 것**이라 대기열과
   * 우선순위가 그 사정에 맞춰져 있다. 이쪽은 사람이 방금 누른 조작이고 한 번에 하나뿐이라
   * (두 번째 요청은 조용히 취소된다 — `askPlaceholders`) 그 사슬에 낄 이유가 없다.
   *
   * ## 화면
   *
   * `+page` 의 다른 모달들과 **같은 상자**다(`.overlay` + `.modal`). 다만 그 스타일은
   * `+page.svelte` 안에 스코프돼 있어 여기서는 쓸 수 없으므로, 필요한 규칙만 토큰으로
   * 다시 적는다 (모양이 갈리지 않게 값은 그대로 베낀다).
   *
   * Escape 는 **여기서 끊는다** (`stopPropagation`) — 창의 Escape 사슬로 새면 이 모달을
   * 닫는 한 번이 뒤에 깔린 다른 모달까지 함께 닫는다 (레이아웃 저장 모달과 같은 규칙).
   */
  import {
    resolveSnippetPrompt,
    setSnippetPromptValue,
    snippetPrompt,
    snippetPromptValue,
  } from "$lib/app/snippets.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";

  const cur = $derived(snippetPrompt());

  /**
   * 칸들의 DOM 참조 — 쓰는 곳은 **첫 칸에 커서를 두는 것** 하나다 (묻는 화면은 곧바로 칠
   * 수 있어야 한다). 배열로 받는 이유는 칸 수가 스니펫마다 다르기 때문이고, 모달이 닫혔다
   * 다시 열리면 `{#each}` 가 새로 그리며 앞자리를 다시 채운다.
   */
  let fields = $state<(HTMLInputElement | null)[]>([]);
  $effect(() => {
    if (cur) fields[0]?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    resolveSnippetPrompt(false);
  }
</script>

{#if cur}
  <div class="overlay">
    <!--
      Escape 를 **상자 하나**에서 받는다 (`role="dialog"` 라 a11y 상 손잡이가 붙어도 되는
      자리다). 칸마다 달지 않는 이유는 포커스가 버튼에 있을 때도 같은 한 번으로 닫혀야 하기
      때문이고, 창까지 흘려보내지 않는 이유는 그 사슬이 뒤에 깔린 다른 모달까지 함께 닫기
      때문이다 (레이아웃 저장 모달과 같은 규칙).
    -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-prompt-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <h2 id="snippet-prompt-title">{cur.title}</h2>
      <p class="lead">{t("commands.snippet.prompt.lead")}</p>

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          resolveSnippetPrompt(true);
        }}
      >
        <div class="fields">
          {#each cur.fields as field, i (field.name)}
            <label for="snippet-ph-{i}">{field.name}</label>
            <!--
              칸 하나는 **입력 + 설명 한 줄**이다. 설명(`{{이름|설명}}`)은 `aria-describedby`
              로 입력에 묶는다 — 화면에서 보이는 자리와 스크린리더가 읽는 자리가 같아야 한다.
            -->
            <div class="cell">
              <input
                id="snippet-ph-{i}"
                type="text"
                bind:this={fields[i]}
                value={snippetPromptValue(field.name)}
                autocomplete="off"
                spellcheck="false"
                aria-describedby={field.description ? `snippet-ph-help-${i}` : undefined}
                oninput={(e) => setSnippetPromptValue(field.name, e.currentTarget.value)}
              />
              {#if field.description}
                <p class="help" id="snippet-ph-help-{i}">{field.description}</p>
              {/if}
            </div>
          {/each}
        </div>

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={() => resolveSnippetPrompt(false)}>
            {t("commands.snippet.cancel")}
          </button>
          <button type="submit" class="primary btn btn-primary">{t("commands.snippet.prompt.submit")}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  /* `dialogs/*` 의 `.overlay`/`.modal` 과 **같은 값**이다 (그쪽은 스코프돼 있어 못 쓴다) */
  .overlay {
    position: fixed;
    inset: 0;
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

  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  /* 줄마다 `이름 | (입력 + 설명)` — 설명이 붙으면 그 줄만 높아진다. 그래서 세로 맞춤은
     `center` 가 아니라 `start` 다(설명이 있는 줄에서 라벨이 가운데로 내려가면 이름과 칸이
     어긋나 보인다). 라벨은 입력의 첫 줄 높이만큼 내려 붙인다. */
  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .fields label {
    padding-top: 6px;
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .cell {
    min-width: 0;
  }

  /* 자리표시자 설명(`{{이름|설명}}`) — 칸 아래 흐린 한 줄 */
  .help {
    margin: var(--space-1) 0 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
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
