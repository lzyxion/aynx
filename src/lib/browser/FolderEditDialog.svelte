<script lang="ts" module>
  /** 폴더 편집 상자가 쥔 값 — 상위(`Sidebar`)가 만들고 저장한다. 이 상자는 그리기만 한다 */
  export interface FolderEdit {
    /** 지금 폴더의 경로 (`prod/web`) — 이름 칸은 마지막 세그먼트다 */
    path: string;
    name: string;
    icon: string;
    color: string;
    /** 검증·저장 실패 한 줄 (상자를 연 채로 말한다) */
    error: string | null;
    saving: boolean;
  }
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import IconColorFields from "$lib/IconColorFields.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";

  /**
   * **폴더 편집** — 호스트 독 폴더의 이름 · 아이콘 · 색을 한 면에서 (2026-09-29 —
   * docs/log/2026-09-29-folder-project-icons.md).
   *
   * 예전에는 폴더 메뉴의 두 항목("이름 변경" · "아이콘과 색")이 메뉴 상자 **안에서** 각자 입력 모드로 바뀌었다.
   * 칸이 셋뿐이라 사이드 메뉴 없이 한 면이다: 이름 → 아이콘 → 색. 아이콘·색은 호스트 폼 표시 탭 · 프로젝트 폼과 같은
   * 한 벌(`IconColorFields`)이다. 여는 길은 둘 — 폴더 메뉴의 "편집…" 과 폴더 줄에서 `F2`.
   *
   * 뜨면 이름 칸에 포커스(전체 선택). Enter = 저장(`<form>` 제출 — 아이콘 검색 중의 Enter 는 고르기만 한다),
   * Escape = 취소. Escape 는 **여기서 끊는다** — 새면 뒤에 깔린 독까지 함께 닫힌다(`ProjectForm` 과 같은 이유).
   *
   * 상자 전체에 `data-inline-edit` 을 단다 — 전역 단축키(`Ctrl+D` · `Alt+화살표` …)가 이 안의 키를 가로채지 않게
   * 하는 표식이다(`isInlineEditTarget`). 예전 메뉴 안 입력 칸들이 달던 것과 같은 뜻이다.
   */
  let {
    edit = $bindable(),
    onsubmit,
    oncancel,
  }: {
    edit: FolderEdit;
    onsubmit: () => void;
    oncancel: () => void;
  } = $props();

  let nameEl = $state<HTMLInputElement | null>(null);

  onMount(() => {
    void tick().then(() => {
      nameEl?.focus();
      nameEl?.select();
    });
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    oncancel();
  }
</script>

<div class="overlay">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="modal glass-raised"
    role="dialog"
    aria-modal="true"
    aria-labelledby="folder-edit-title"
    tabindex="-1"
    data-folder-edit
    data-inline-edit
    bind:this={modalEl}
    onkeydown={onKeydown}
  >
    <h2 id="folder-edit-title">{t("files.hostmenu.edit.title")}</h2>
    <form
      onsubmit={(ev) => {
        ev.preventDefault();
        onsubmit();
      }}
    >
      <div class="fields">
        <label for="folder-edit-name">{t("files.hostmenu.edit.name")}</label>
        <div class="cell">
          <input
            id="folder-edit-name"
            type="text"
            bind:this={nameEl}
            bind:value={edit.name}
            class:bad={edit.error !== null}
            autocomplete="off"
            spellcheck="false"
            oninput={() => (edit.error = null)}
          />
          {#if edit.error}<span class="err" role="alert">{edit.error}</span>{/if}
        </div>
        <!-- 아이콘 → 색 — 비운 아이콘은 테마 색 기본 폴더, 비운 색은 기본 색 (폴더 자신의 얼굴에만 입는다) -->
        <IconColorFields
          bind:icon={edit.icon}
          bind:color={edit.color}
          iconId="folder-edit-icon"
          colorId="folder-edit-color"
          fallback="folder"
        />
      </div>
      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick={oncancel}>{t("app.actions.cancel")}</button>
        <button type="submit" class="btn btn-primary" disabled={edit.saving} data-folder-edit-submit
          >{t("app.actions.save")}</button
        >
      </div>
    </form>
  </div>
</div>

<style>
  /* 상자 모양은 프로젝트 폼 · 스니펫 저장 상자와 같은 값 (`.overlay` / `.modal`) — 폭만 좁다(칸이 셋) */
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
    max-width: 440px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
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

  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
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

  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input.bad {
    border-color: var(--err);
  }

  .err {
    font-size: var(--t-xs);
    color: var(--err);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
