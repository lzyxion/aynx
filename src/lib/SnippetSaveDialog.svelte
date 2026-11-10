<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  /**
   * **명령 하나를 스니펫으로 저장하는 작은 모달** (docs/log/2026-09-16-snippets.md).
   *
   * 입구가 둘이다 — 터미널 우클릭 메뉴의 "스니펫으로 저장" 과 팔레트 `;` 목록의 저장 줄.
   * 둘 다 같은 문(`openSnippetSave`)을 지나므로 이 상자는 **어디서 열렸는지 모른다**:
   * 아는 것은 폼 한 벌(`snippetSaveForm`)뿐이고, 저장·취소도 그 모듈의 함수 둘이다.
   *
   * ## 왜 설정 › 스니펫의 폼을 다시 쓰지 않았나
   *
   * 저쪽 폼은 **목록과 한 화면**이다 — 편집 중인 줄이 위에 보이고, [삽입]·[삭제] 가 곁에
   * 있으며, 호스트 select 가 `hostCache()` 전부를 편다. 여기서 필요한 것은 그 반대다:
   * 방금 친 명령 하나를 **두 번 눌러 남기는** 길이고, 범위 선택지도 둘뿐이다(모든 호스트 /
   * 이 호스트). 그 폼을 프롭으로 갈라 두 모양을 만들면 설정 화면 쪽이 "어느 모드인가" 를
   * 계속 물어야 한다.
   *
   * ## 화면
   *
   * `SnippetPrompt.svelte` 와 **같은 상자**다 (`.overlay` + `.modal` — 그 값은 `+page.svelte`
   * 안에 스코프돼 있어 여기서도 다시 적는다). 자리표시자를 묻는 상자와 이 상자가 다르게
   * 생기면 "스니펫에 관한 작은 대화" 라는 사실이 화면에서 사라진다.
   *
   * Escape 는 **여기서 끊는다** (`stopPropagation`) — 창의 Escape 사슬로 새면 이 모달을
   * 닫는 한 번이 뒤에 깔린 다른 모달까지 함께 닫는다 (`SnippetPrompt` 와 같은 규칙).
   */
  import Toggle from "$lib/Toggle.svelte";
  import {
    cancelSnippetSave,
    commitSnippetSave,
    setSnippetSaveField,
    snippetSaveForm,
  } from "$lib/app/snippets.svelte.js";
  import {
    MAX_SNIPPET_COMMAND,
    MAX_SNIPPET_DESCRIPTION,
    MAX_SNIPPET_NAME,
    placeholdersOf,
  } from "$lib/snippets";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";

  const form = $derived(snippetSaveForm());

  /** 명령에 든 `{{…}}` 칸들 — **자동으로 찾아 주지 않는다**, 적은 그대로 읽어 보일 뿐이다 */
  const placeholders = $derived(form ? placeholdersOf(form.command) : []);

  /**
   * 이름 칸의 DOM — 쓰는 곳은 **열릴 때 커서를 두는 것** 하나다.
   *
   * 첫 칸이 이름인 이유: 명령은 이미 채워져 있고 대개 그대로 두며, 사람이 바꾸고 싶어 하는
   * 것은 목록에서 이것을 부를 이름이다. 값은 전부 선택해 둔다 — 지어낸 이름이 마음에 들면
   * 곧바로 Enter, 아니면 그냥 치면 덮어써진다.
   */
  let nameEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (form) nameEl?.select();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelSnippetSave();
  }
</script>

{#if form}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-save-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
      <h2 id="snippet-save-title">{t("commands.snippet.save.title")}</h2>
      <!--
        `{{이름}}` 은 사용자에게 보여 주는 **예시 문법**이라 마크업(`<code>`)에 맞춰 키를
        셋으로 쪼갰다 (문자열에 HTML 을 넣지 않는다).
      -->
      <p class="lead">
        {t("commands.snippet.save.lead.before")}<code>{t("commands.snippet.save.lead.token")}</code
        >{t("commands.snippet.save.lead.after")}
      </p>

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          commitSnippetSave();
        }}
      >
        <div class="fields">
          <label for="snippet-save-name">{t("commands.snippet.save.name")}</label>
          <input
            id="snippet-save-name"
            data-snippet-save="name"
            type="text"
            bind:this={nameEl}
            value={form.name}
            maxlength={MAX_SNIPPET_NAME}
            autocomplete="off"
            spellcheck="false"
            oninput={(e) => setSnippetSaveField({ name: e.currentTarget.value })}
          />

          <label for="snippet-save-command">{t("commands.snippet.save.command")}</label>
          <!--
            여러 줄 칸이다 — 저장해 두는 명령이 한 줄이라는 법이 없고(`parseSnippets` 가
            안쪽 줄바꿈을 일부러 살린다), 한 줄 `<input>` 이면 붙여넣은 여러 줄이 조용히
            한 줄로 뭉개진 것처럼 보인다.

            **Enter 는 줄바꿈이다** (`<textarea>` 의 기본) — 폼 제출은 아래 [저장] 이나
            이름·설명 칸의 Enter 로 한다.
          -->
          <textarea
            id="snippet-save-command"
            data-snippet-save="command"
            rows="3"
            value={form.command}
            maxlength={MAX_SNIPPET_COMMAND}
            spellcheck="false"
            oninput={(e) => setSnippetSaveField({ command: e.currentTarget.value })}
          ></textarea>

          <label for="snippet-save-scope">{t("commands.snippet.save.scope")}</label>
          <!--
            선택지가 **둘뿐**이다: 모든 호스트, 그리고 이 타일의 별칭. 설정 화면처럼 호스트
            목록 전체를 펴지 않는 이유는 여기가 "방금 그 명령을 여기서 남긴다" 는 자리라,
            제3의 서버를 고를 일이 없기 때문이다 (그건 만든 뒤에 설정에서 고친다).
            SSH 타일이 아니면 둘째 줄이 아예 없다.
          -->
          <span data-snippet-save="scope"><Dropdown
            id="snippet-save-scope"
            value={form.hostScope ? "host" : "all"}
            options={[
              { value: "all", label: t("commands.snippet.save.scope.all") },
              ...(form.alias !== null ? [{ value: "host", label: t("commands.snippet.save.scope.host", { alias: form.alias }) }] : []),
            ]}
            onchange={(v) => setSnippetSaveField({ hostScope: v === "host" })}
          /></span>

          <label for="snippet-save-enter">{t("commands.snippet.save.enter")}</label>
          <div class="row">
            <Toggle
              id="snippet-save-enter"
              checked={form.enter}
              onchange={(v) => setSnippetSaveField({ enter: v })}
            />
            <span class="hint">
              {form.enter
                ? t("commands.snippet.save.enter.on")
                : t("commands.snippet.save.enter.off")}
            </span>
          </div>

          <label for="snippet-save-desc">{t("commands.snippet.save.description")}</label>
          <input
            id="snippet-save-desc"
            data-snippet-save="description"
            type="text"
            value={form.description}
            maxlength={MAX_SNIPPET_DESCRIPTION}
            placeholder={t("commands.snippet.save.description.placeholder")}
            autocomplete="off"
            oninput={(e) => setSnippetSaveField({ description: e.currentTarget.value })}
          />
        </div>

        {#if placeholders.length > 0}
          <p class="note">
            {t("commands.snippet.save.placeholders", {
              count: placeholders.length,
              names: placeholders.map((p) => p.name).join(" · "),
            })}
          </p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={() => cancelSnippetSave()}
            >{t("commands.snippet.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary">{t("commands.snippet.save.submit")}</button>
        </div>
      </form>
      </div>
    </div>
  </div>
{/if}

<style>
  /* `SnippetPrompt.svelte`·`dialogs/*` 의 `.overlay`/`.modal` 과 **같은 값**이다 */
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
    box-sizing: border-box;
    width: 100%;
    max-width: calc(460px + 2 * var(--space-4) + 2px); /* 옛 content-box 너비 그대로 — 안쪽 여백(스크롤 칸) · 테두리를 더함 */
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

  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .lead code {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }

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

  .fields input,
  .fields textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .fields input {
    height: var(--field-height);
    padding: 0 var(--space-3);
    border-radius: var(--field-radius);
  }

  .fields :global(.dd) {
    width: 100%;
  }

  .fields textarea {
    align-self: start;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--field-radius-multi);
    resize: vertical;
    line-height: 1.5;
  }

  /* 포커스는 중성 — 강조색 선은 "강조는 셋뿐" 밖이다 (docs/log/2026-09-25-finish-menus.md) */
  .fields input:focus-visible,
  .fields textarea:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input:hover:not(:disabled, :focus),
  .fields textarea:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .note {
    margin: 0 0 var(--space-3);
    font-size: var(--t-xs);
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
</style>
