<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";

  /**
   * **필터 줄** — 목록 위 한 줄(10-20 — 처음엔 아래였다) (docs/log/2026-10-07-file-tile-dolphin.md — Dolphin 의 `Ctrl+I`).
   *
   * 지금 폴더(자세히 보기면 펼쳐 둔 하위까지)를 **이름으로** 거른다 — 거르는 규칙은 순수 함수 하나다
   * (`$lib/file-tree` 의 `filterRows`: 맞는 줄과 그 조상 폴더만). 여기는 칸 · "N개 맞음" · 닫기만 갖는다.
   * 닫으면(`Esc` · `×` · 툴바 단추) 거르기도 풀린다 — 열려 있지 않은 필터가 목록을 몰래 줄여 두면 안 된다.
   *
   * 칸은 **`data-file-filter`** 를 단다 — 파일 타일 층 단축키(`Ctrl+L` · `F9` · `Ctrl+1/2/3`)가 이 칸에서만은 비켜
   * 서지 않는다(`browser/file-keys.ts`). 거르는 중에도 보기를 바꾸고 경로로 뛸 수 있어야 한다.
   *
   * 앱의 `find` 키(`Ctrl+F` — 2026-10-19)도 이 줄을 연다(`app/tile-find.ts` — 파일 타일의 찾기 = 이름 거르기). 칸 안에서 누른
   * `find` 는 전역 처리기의 입력 칸 가드에 걸려 오지 않으므로 여기서 받아 적어 둔 글자를 다시 고른다(`Ctrl+I` 와 같은 몸짓).
   */
  let {
    query = $bindable(""),
    /** 맞는 항목 수 (질의가 비었으면 쓰지 않는다) */
    count = 0,
    onclose,
  }: {
    query?: string;
    count?: number;
    /** 닫아 달라 — 상위가 거르기를 풀고 타일 몸으로 포커스를 돌린다 */
    onclose: () => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  /** 칸에 포커스를 준다 — 열 때와 `Ctrl+I` 를 다시 눌렀을 때 (적어 둔 글자는 통째로 골라 곧바로 덮어 칠 수 있게) */
  export async function focus(): Promise<void> {
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }
</script>

<div class="filter">
  <UiIcon name="filter" size={13} />
  <input
    class="filter-input"
    data-file-filter
    bind:this={inputEl}
    bind:value={query}
    type="text"
    spellcheck="false"
    autocomplete="off"
    placeholder={t("files.filter.placeholder")}
    aria-label={t("files.filter.placeholder")}
    onkeydown={(ev) => {
      if (ev.isComposing) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        onclose();
        return;
      }
      const combo = comboFromEvent(ev);
      if (combo !== null && combo === effectiveCombo("find", settings.current.keybindings)) {
        ev.preventDefault();
        inputEl?.select();
      }
    }}
  />
  {#if query.trim() !== ""}
    <span class="cnt" role="status">{t("files.filter.count", { count })}</span>
  {/if}
  <button
    type="button"
    class="close"
    title={t("files.filter.close")}
    aria-label={t("files.filter.close")}
    onclick={onclose}><UiIcon name="close" size={12} /></button
  >
</div>

<style>
  .filter {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    color: var(--fg-muted);
  }

  /* 칸 — 크롬 우물 면(글자가 크롬 색이라 터미널 바탕을 쓰지 않는다 — conventions.md) */
  .filter-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 22px;
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--row-font);
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--accent);
  }

  .cnt {
    flex: 0 0 auto;
    font-size: 11px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .close {
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

  .close:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .close:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
</style>
