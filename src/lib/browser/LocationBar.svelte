<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { NavCrumb } from "$lib/browser/crumbs";

  /**
   * 조각은 드롭 대상이다 — 폴더 줄을 거치지 않고 두 층 위로 옮길 수 있는 유일한 길이다.
   * 새로고침 ⟳ 는 ⋯ 안으로 옮기지 않는다 — 옮겼다가 사용자가 되돌렸다.
   */
  let {
    crumbs,
    current,
    /** `""` 는 합성 루트라 `null` 과 반드시 구분한다 */
    dropTarget = null,
    disabled = false,
    placeholder = "",
    draft = $bindable(""),
    flat = false,
    onnavigate,
    onsubmit,
    onrefresh,
    onfocuschange,
    onescape,
    ondragover,
    ondragleave,
    ondrop,
  }: {
    crumbs: readonly NavCrumb[];
    current: string;
    dropTarget?: string | null;
    disabled?: boolean;
    placeholder?: string;
    draft?: string;
    flat?: boolean;
    onnavigate: (path: string) => void;
    /** 갔으면 `true`(칸이 닫힌다) · 못 갔으면 `false`(칸이 남아 빨갛게 선다) */
    onsubmit: (path: string) => Promise<boolean>;
    onrefresh: () => void;
    onfocuschange?: (focused: boolean) => void;
    onescape?: () => void;
    ondragover?: (ev: DragEvent, path: string) => void;
    ondragleave?: (path: string) => void;
    ondrop?: (ev: DragEvent, path: string) => void;
  } = $props();

  let editing = $state(false);
  let invalid = $state(false);
  let submitting = false;
  let inputEl = $state<HTMLInputElement | null>(null);
  let crumbsEl = $state<HTMLDivElement | null>(null);

  export async function edit(): Promise<void> {
    if (disabled) return;
    draft = current;
    invalid = false;
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  function close() {
    editing = false;
    invalid = false;
    draft = current;
  }

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    const next = draft.trim();
    if (next === "" || disabled || submitting) return;
    submitting = true;
    try {
      const ok = await onsubmit(next);
      if (ok) {
        editing = false;
        invalid = false;
        onescape?.();
      } else {
        invalid = true;
        inputEl?.focus();
      }
    } finally {
      submitting = false;
    }
  }

  function onCrumbsClick(ev: MouseEvent) {
    if (ev.target instanceof Element && ev.target.closest(".crumb")) return;
    void edit();
  }

  $effect(() => {
    void crumbs;
    const el = crumbsEl;
    if (el) el.scrollLeft = el.scrollWidth;
  });
</script>

<div class="loc" class:editing class:invalid class:disabled class:flat>
  {#if editing}
    <form class="loc-form" onsubmit={submit}>
      <input
        class="loc-input"
        data-inline-edit
        data-file-location
        bind:this={inputEl}
        bind:value={draft}
        spellcheck="false"
        autocomplete="off"
        {placeholder}
        aria-label={t("files.browser.path.aria")}
        aria-invalid={invalid}
        {disabled}
        oninput={() => (invalid = false)}
        onfocus={() => onfocuschange?.(true)}
        onblur={() => {
          onfocuschange?.(false);
          if (!submitting) close();
        }}
        onkeydown={(ev) => {
          // Escape = **한 겹 벗기** — 고치던 경로를 되돌리고 타일 몸으로 물러난다. 그래야 그 자리에서
          // 곧바로 ↑↓·`Ctrl+D`·`Alt+화살표` 가 먹는다.
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          close();
          onescape?.();
        }}
      />
    </form>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="crumbs"
      bind:this={crumbsEl}
      title={t("files.location.edit.title")}
      onclick={onCrumbsClick}
    >
      <nav class="crumb-row" aria-label={t("files.browser.path.aria")}>
        {#each crumbs as crumb, i (crumb.path)}
          {#if i > 0}<span class="crumb-sep"><UiIcon name="chevron" size={10} /></span>{/if}
          <button
            type="button"
            class="crumb"
            class:current={crumb.path === current}
            class:drop-over={dropTarget === crumb.path}
            title={crumb.titleKey ? t(crumb.titleKey) : (crumb.title ?? crumb.path)}
            aria-current={crumb.path === current ? "page" : undefined}
            {disabled}
            onclick={() => onnavigate(crumb.path)}
            ondragover={(ev) => ondragover?.(ev, crumb.path)}
            ondragleave={() => ondragleave?.(crumb.path)}
            ondrop={(ev) => ondrop?.(ev, crumb.path)}
          >
            {crumb.labelKey ? t(crumb.labelKey) : crumb.label}
          </button>
        {/each}
      </nav>
    </div>
  {/if}
  <button
    type="button"
    class="loc-btn"
    data-head-act
    title={t("files.toolbar.refresh")}
    aria-label={t("files.toolbar.refresh")}
    {disabled}
    onclick={onrefresh}><UiIcon name="refresh" size={13} /></button
  >
</div>

<style>
  /* 면은 크롬 우물(`--surface-field`) — 글자가 크롬 색이라 터미널 바탕을 쓰면 안 된다(conventions.md) */
  .loc {
    flex: 1 1 auto;
    min-width: 60px;
    display: flex;
    align-items: center;
    height: 24px;
    box-sizing: border-box;
    padding: 0 2px 0 2px;
    background: var(--surface-field);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: text;
    /* 바깥 줄(`.file-bar`)에서 물려받은 접힘 간격을 0 으로 되돌린다(`pane/pane-tools.svelte.ts`) */
    --head-act-gap: 0px;
  }

  .loc.flat {
    background: transparent;
  }

  .loc.flat.editing {
    background: var(--surface-field);
  }

  .loc:not(.disabled):not(.editing):hover {
    border-color: var(--line);
  }

  .loc.editing {
    border-color: var(--accent);
  }

  .loc.invalid {
    border-color: var(--err);
  }

  .loc.disabled {
    cursor: default;
    opacity: 0.6;
  }

  .crumbs {
    flex: 1 1 auto;
    min-width: 0;
    align-self: stretch;
    display: flex;
    align-items: center;
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
  }

  .crumbs::-webkit-scrollbar {
    display: none;
  }

  .crumb-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .crumb {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    font-family: var(--font-ui);
    font-size: var(--row-font);
    color: var(--fg-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .crumb:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .crumb:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .crumb.current {
    color: var(--fg);
    font-weight: 600;
  }

  .crumb.drop-over {
    color: var(--fg);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .crumb-sep {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    color: var(--fg-muted);
    opacity: 0.6;
  }

  .loc-form {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
  }

  .loc-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: none;
    outline: none;
  }

  .loc-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .loc-btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .loc-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .loc-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
