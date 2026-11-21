<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";

  /**
   * 필터 줄 (docs/log/2026-10-07-file-tile-dolphin.md). 닫으면 거르기도 풀린다 — 열려 있지 않은 필터가 목록을 몰래 줄여 두면 안 된다.
   * `data-file-filter` 가 있어야 파일 타일 층 단축키가 이 칸에서 비켜 서지 않는다(`file-keys.ts`).
   * 칸 안의 `find` 키는 전역 처리기의 입력 칸 가드에 걸려 오지 않는다 — 여기서 받는다.
   */
  let {
    query = $bindable(""),
    count = 0,
    onclose,
  }: {
    query?: string;
    count?: number;
    /** 상위가 거르기를 풀고 타일 몸으로 포커스를 돌린다 */
    onclose: () => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

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

  /* 글자가 크롬 색이라 터미널 바탕을 쓰지 않는다 — conventions.md */
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
