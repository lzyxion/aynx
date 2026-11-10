<script lang="ts">
  // 사용자 터미널 테마 — **가져오기**(파일 고르기 또는 붙여넣기 → 후보 확인 · 이름 고치기 → 넣기)와 **관리**(이름 바꾸기 · 지우기)
  // 두 얼굴의 모달 하나. 상태 · 넣기 · 지우기는 `app/term-themes.svelte.ts`, 해석은 순수 `$lib/term-theme-import`.
  // 설정 › 터미널의 [가져오기…] · [관리] 단추가 연다 — 메뉴가 없어 menu-runner 통로가 필요 없다. 독보다 뒤에 그려진다(`+page`).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import UiIcon from "$lib/UiIcon.svelte";
  import { settings } from "$lib/settings.svelte.js";
  import { MAX_THEME_NAME } from "$lib/term-theme-import";
  import {
    closeTermThemeDialog,
    importPicked,
    parsePasted,
    readThemeFile,
    removeUserTermTheme,
    renameUserTermTheme,
    termThemeDialog,
  } from "$lib/app/term-themes.svelte.js";

  let modalEl = $state<HTMLElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  const pickedCount = $derived(termThemeDialog.candidates.filter((c) => c.pick).length);

  // 열릴 때 포커스 — 가져오기는 파일 단추, 관리는 상자.
  $effect(() => {
    if (!termThemeDialog.mode) return;
    queueMicrotask(() => {
      const first = modalEl?.querySelector<HTMLElement>("[data-autofocus]") ?? modalEl;
      first?.focus();
    });
  });

  function onKeydown(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    ev.stopPropagation();
    if (ev.code === "Escape") {
      ev.preventDefault();
      closeTermThemeDialog();
    }
  }

  function onFile(ev: Event): void {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // 같은 파일을 다시 골라도 change 가 오게
    if (file) void readThemeFile(file);
  }

  /** 견본 — 배경 위에 글자 · 빨강 · 초록 · 노랑 · 파랑 · 보라 · 청록 */
  function dots(c: Record<string, string | undefined>): string[] {
    return [c.foreground, c.red, c.green, c.yellow, c.blue, c.magenta, c.cyan].filter((x): x is string => !!x);
  }
</script>

{#snippet swatch(bg: string | undefined, colors: string[])}
  <span class="swatch" style:background={bg} aria-hidden="true">
    {#each colors as color, i (i)}<i style:background={color}></i>{/each}
  </span>
{/snippet}

{#if termThemeDialog.mode}
  <div
    class="overlay overlay-fade"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget) closeTermThemeDialog();
    }}
  >
    <div
      class="modal glass-raised modal-rise"
      role="dialog"
      aria-modal="true"
      aria-labelledby="term-theme-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <div class="glass-scroll">
      {#if termThemeDialog.mode === "import"}
        <h2 id="term-theme-title">{t("settings.terminal.import.title")}</h2>
        <p class="lead">{t("settings.terminal.import.lead")}</p>

        <div class="source">
          <button type="button" class="btn btn-secondary" data-autofocus onclick={() => fileInput?.click()}>
            <UiIcon name="folder" size={13} />
            {t("settings.terminal.import.file")}
          </button>
          <input
            class="hidden-input"
            type="file"
            accept=".json,.itermcolors,.toml,.conf,.txt,.xml,text/plain,application/json"
            tabindex="-1"
            aria-hidden="true"
            bind:this={fileInput}
            onchange={onFile}
          />
          <span class="or">{t("settings.terminal.import.or")}</span>
        </div>
        <textarea
          class="paste"
          rows="5"
          spellcheck="false"
          placeholder={t("settings.terminal.import.pastePlaceholder")}
          aria-label={t("settings.terminal.import.pasteLabel")}
          bind:value={termThemeDialog.text}
        ></textarea>
        <div class="paste-row">
          <button
            type="button"
            class="btn btn-sm btn-secondary"
            disabled={!termThemeDialog.text.trim()}
            onclick={parsePasted}
          >
            {t("settings.terminal.import.read")}
          </button>
        </div>

        {#if termThemeDialog.candidates.length}
          <ul class="list" aria-label={t("settings.terminal.import.candidates")}>
            {#each termThemeDialog.candidates as cand, i (i)}
              <li class="row">
                <input
                  type="checkbox"
                  bind:checked={cand.pick}
                  aria-label={t("settings.terminal.import.pick", { name: cand.name })}
                />
                {@render swatch(cand.colors.background, dots(cand.colors))}
                <input
                  class="name"
                  maxlength={MAX_THEME_NAME}
                  spellcheck="false"
                  aria-label={t("settings.terminal.import.nameLabel")}
                  bind:value={cand.name}
                />
              </li>
            {/each}
          </ul>
        {/if}

        {#if termThemeDialog.error}
          <p class="wrong" role="alert">{termThemeDialog.error}</p>
        {/if}

        <div class="actions">
          <button type="button" class="btn btn-secondary" onclick={closeTermThemeDialog} disabled={termThemeDialog.busy}>
            {t("settings.terminal.import.cancel")}
          </button>
          <button
            type="button"
            class="btn btn-primary primary"
            onclick={() => void importPicked()}
            disabled={termThemeDialog.busy || pickedCount === 0}
          >
            {t("settings.terminal.import.ok", { n: String(pickedCount) })}
          </button>
        </div>
      {:else}
        <h2 id="term-theme-title">{t("settings.terminal.import.manageTitle")}</h2>
        <p class="lead">{t("settings.terminal.import.manageLead")}</p>
        {#if settings.userTermThemes.length}
          <ul class="list">
            {#each settings.userTermThemes as u (u.id)}
              <li class="row">
                {@render swatch(u.theme.background, dots(u.theme as Record<string, string | undefined>))}
                <input
                  class="name"
                  value={u.name}
                  maxlength={MAX_THEME_NAME}
                  spellcheck="false"
                  aria-label={t("settings.terminal.import.renameLabel", { name: u.name })}
                  onchange={(e) => void renameUserTermTheme(u.id, e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.code === "Enter" && !e.isComposing) e.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  class="btn btn-sm btn-ghost icon"
                  title={t("settings.terminal.import.removeLabel", { name: u.name })}
                  aria-label={t("settings.terminal.import.removeLabel", { name: u.name })}
                  onclick={() => void removeUserTermTheme(u.id)}
                >
                  <UiIcon name="trash" size={13} />
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">{t("settings.terminal.import.manageEmpty")}</p>
        {/if}
        {#if termThemeDialog.error}
          <p class="wrong" role="alert">{termThemeDialog.error}</p>
        {/if}
        <div class="actions">
          <button type="button" class="btn btn-secondary" data-autofocus onclick={closeTermThemeDialog}>
            {t("settings.terminal.import.close")}
          </button>
        </div>
      {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* `.overlay`·`.modal`·`.lead`·`.wrong`·`.actions` 는 다른 모달(`AppIconCropDialog`)의 규칙을 베껴 둔다(스코프 — dialogs/ 규약) */
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
    width: calc(460px + 2 * var(--space-4) + 2px); /* 옛 content-box 너비 그대로 — 안쪽 여백(스크롤 칸) · 테두리를 더함 */
    max-width: calc(100vw - 32px);
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
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .or {
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  .hidden-input {
    display: none;
  }

  /* 붙여넣기 칸 — 크롬 글자를 얹으므로 우물 면(터미널 색 아님 — conventions "크롬 글자를 얹는 상자는 크롬 면") */
  .paste {
    box-sizing: border-box;
    width: 100%;
    resize: vertical;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius-multi);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .paste:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .paste:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .paste-row {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-1);
  }

  .list {
    list-style: none;
    margin: var(--space-3) -3px 0;
    padding: 3px;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 280px;
    overflow: auto;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .row input[type="checkbox"] {
    accent-color: var(--accent);
  }

  /* 견본 — 팔레트 배경 위의 점들(설정 › 터미널의 견본과 같은 모양) */
  .swatch {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 5px 7px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .swatch i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .name:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .name:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .empty {
    margin: 0;
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  .wrong {
    margin: var(--space-2) 0 0;
    font-size: var(--t-sm);
    color: var(--err);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
</style>
