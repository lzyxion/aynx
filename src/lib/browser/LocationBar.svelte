<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { NavCrumb } from "$lib/browser/crumbs";

  /**
   * **경로 칸** — 평소에는 빵부스러기(`내 PC › C: › Users › you`), 누르면 경로 입력 칸
   * (docs/log/2026-10-07-file-tile-dolphin.md — KDE Dolphin 의 위치 표시줄과 같은 문법).
   *
   * 예전에는 툴바의 경로 입력 칸과 그 아래 빵부스러기 줄이 **두 줄**이었다. 같은 사실(지금 어디)을 두 번
   * 적느라 목록 위에 줄이 하나 더 섰다. 이제 한 상자가 두 얼굴을 갖는다:
   *
   * - **조각을 누르면** 그 폴더로 간다 — 위로 가기 단추가 없어진 자리를 상위 조각이 맡는다.
   * - **빈 곳을 누르거나 `Ctrl+L`**(`files-location`) — 입력 칸으로 바뀐다. Enter 면 그 경로로 간다(못
   *   읽으면 칸이 그대로 남아 빨갛게 서고, 무엇이 잘못됐는지는 타일의 오류 줄이 말한다). Esc 는 되돌리고
   *   타일 몸으로 물러난다. 다른 곳을 누르면(포커스를 잃으면) 그냥 되돌린다.
   * - 오른쪽 끝 **⟳** — 새로고침(브라우저 주소창과 같은 자리). 2026-10-20 B안에서 ⋯ 안으로 옮겼다가 사용자 실기로 같은 날 되돌렸다
   *   (⋯ 의 새로고침 줄은 걷었다 — 한 곳).
   * - 머리줄 안(`flat`)에서는 우물 면을 깔지 않는다 — 빵부스러기가 그 타일의 이름 자리라 판 없이 글자로 선다(손이 오면 옅은 선).
   *
   * 조각은 여전히 **드롭 대상**이다 — 폴더 줄을 거치지 않고 두 층 위로 옮길 수 있는 유일한 길이다.
   *
   * 상태(편집 중·초안)는 여기 산다. 초안은 `bind:draft` 로 타일과 함께 본다 — 목록 읽기가 성공할 때마다
   * 타일이 초안을 새 경로로 맞춰 둔다(`FileListing.load`).
   */
  let {
    crumbs,
    /** 지금 보고 있는 경로 — 그 조각이 굵게 선다 */
    current,
    /** 지금 드래그가 얹혀 있는 경로 (`""` 는 합성 루트라 `null` 과 반드시 구분해야 한다) */
    dropTarget = null,
    disabled = false,
    /** 입력 칸의 자리 글 — 백엔드의 경로 문법을 따른다 */
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
    /** 머리줄 안 — 우물 면 없이 글자로 선다(위 머리말) */
    flat?: boolean;
    /** 조각을 눌렀다 */
    onnavigate: (path: string) => void;
    /** 입력 칸에서 Enter — 갔으면 `true`(칸이 닫힌다), 못 갔으면 `false`(칸이 남아 빨갛게 선다) */
    onsubmit: (path: string) => Promise<boolean>;
    onrefresh: () => void;
    /** 입력 칸에 포커스가 들어오고 나갔다 — 타일의 목록 키가 그동안 비켜 선다 */
    onfocuschange?: (focused: boolean) => void;
    /** Esc 로 칸을 닫았다 — 타일이 키보드 몸으로 포커스를 되돌린다 */
    onescape?: () => void;
    ondragover?: (ev: DragEvent, path: string) => void;
    ondragleave?: (path: string) => void;
    ondrop?: (ev: DragEvent, path: string) => void;
  } = $props();

  let editing = $state(false);
  /** 방금 Enter 한 경로를 못 읽었다 — 칸이 빨갛게 선다(다시 치면 풀린다) */
  let invalid = $state(false);
  let submitting = false;
  let inputEl = $state<HTMLInputElement | null>(null);
  let crumbsEl = $state<HTMLDivElement | null>(null);

  /** 입력 칸으로 바꾼다 (빈 곳 클릭 · `Ctrl+L`) — 지금 경로를 통째로 골라 둔다(곧바로 덮어 칠 수 있게) */
  export async function edit(): Promise<void> {
    if (disabled) return;
    draft = current;
    invalid = false;
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  /** 편집을 접는다 — 초안은 지금 경로로 되돌린다 */
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

  /** 빈 곳(조각 사이·오른쪽 남는 자리)을 눌렀을 때만 입력 칸으로 — 조각은 제 클릭이 있다 */
  function onCrumbsClick(ev: MouseEvent) {
    if (ev.target instanceof Element && ev.target.closest(".crumb")) return;
    void edit();
  }

  // 경로가 길면 조각이 넘친다 — **끝(지금 폴더)이 보이게** 오른쪽 끝으로 민다.
  $effect(() => {
    void crumbs;
    const el = crumbsEl;
    if (el) el.scrollLeft = el.scrollWidth;
  });
</script>

<div class="loc" class:editing class:invalid class:disabled class:flat>
  {#if editing}
    <form class="loc-form" onsubmit={submit}>
      <!--
        `data-inline-edit` — 한 번 치고 Enter 로 닫는 임시 편집기다. 그 표를 보고 앱 전역의 `Ctrl+D`(타일 닫기)와
        `Alt+화살표`(타일 이동)가 여기서는 비켜난다.
      -->
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
    <!--
      조각 줄 — 빈 곳을 누르면 입력 칸이 된다(키보드 길은 `Ctrl+L`). 조각 버튼이 저마다 키보드로 눌리므로
      이 상자 자체는 탭 정거장이 아니다.
    -->
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
  <!-- 새로고침 — 상자 안 오른쪽 끝(브라우저 주소창의 자리). 조작이라 머리줄 안 포커스 밖에서는 접힌다(`data-head-act` — `pane/pane-tools.svelte.ts`) -->
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
  /*
   * 한 상자 — 조각 줄이든 입력 칸이든 **같은 높이·같은 면**이다(바뀌는 순간 툴바가 흔들리지 않게).
   * 면은 크롬 우물(`--surface-field`) — 글자가 크롬 색이라 터미널 바탕을 쓰면 안 된다(conventions.md).
   */
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
    /* 상자 안은 간격이 없다 — 바깥 줄(`.file-bar` 4px)에서 물려받은 접힘 간격을 0 으로 되돌린다(`pane/pane-tools.svelte.ts`) */
    --head-act-gap: 0px;
  }

  /* 머리줄 안 — 판 없이(이름 자리) */
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

  /* 지금 있는 자리 — 누를 수는 있지만(제자리) 어디인지가 먼저 읽혀야 한다 */
  .crumb.current {
    color: var(--fg);
    font-weight: 600;
  }

  /* 여기 놓으면 이 경로로 옮긴다 */
  .crumb.drop-over {
    color: var(--fg);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  /* 구분자 — 툴바의 뒤로/앞으로와 같은 `chevron` 이다 (한 세트로 읽힌다) */
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
