<script lang="ts">
  /**
   * 찾기 띠의 그림과 키만 갖는다 — 무엇을 찾는지는 부르는 쪽이 정하고 `count` · `index` 를 내려 준다. 매칭 규칙은 `doc-find.ts` 하나다.
   * - `Enter` 는 입력 칸에서만 본다(단추의 Enter 는 단추 것). 앱의 `find` 조합은 입력 칸 가드에 걸려 오지 않으므로 칸 안에서 질의를 다시 고른다.
   * - 원격 출력 · 대화 글이 섞이는 자리라 글자는 모두 글자로 그린다(`{@html}` 없음 — `SearchOverlay` 머리말의 XSS 이유).
   */
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { FIND_LIMIT } from "$lib/doc-find";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";

  let {
    query = $bindable(""),
    caseSensitive = $bindable(false),
    count,
    index,
    label,
    onstep,
    onclose,
  }: {
    query?: string;
    caseSensitive?: boolean;
    /** 상한 `FIND_LIMIT` 에서 멈춘 값일 수 있다 */
    count: number;
    index: number;
    label: string;
    onstep: (dir: 1 | -1) => void;
    onclose: () => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  const countLabel = $derived(
    query === ""
      ? ""
      : count === 0
        ? t("pane.find.none")
        : count >= FIND_LIMIT
          ? t("pane.find.many", { i: String(index + 1), n: String(count) })
          : t("pane.find.count", { i: String(index + 1), n: String(count) }),
  );

  /** 띠가 막 섰을 수 있어 한 틱 뒤에 — 적어 둔 질의는 통째로 골라 곧바로 덮어 칠 수 있게 */
  export async function focus(): Promise<void> {
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    if (ev.key === "F3" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      onstep(ev.shiftKey ? -1 : 1);
      return;
    }
    if (ev.target !== inputEl) return;
    if (ev.key === "Enter" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      onstep(ev.shiftKey ? -1 : 1);
      return;
    }
    const combo = comboFromEvent(ev);
    if (combo !== null && combo === effectiveCombo("find", settings.current.keybindings)) {
      ev.preventDefault();
      inputEl?.select();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="find" role="search" aria-label={label} data-find-bar onkeydown={onKeydown}>
  <UiIcon name="search" size={13} />
  <input
    bind:this={inputEl}
    bind:value={query}
    class="find-input"
    type="text"
    spellcheck="false"
    autocomplete="off"
    placeholder={label}
    aria-label={label}
  />
  <span class="find-count" class:none={query !== "" && count === 0} aria-live="polite">{countLabel}</span>
  <button
    type="button"
    class="btn"
    class:on={caseSensitive}
    aria-pressed={caseSensitive}
    title={t("pane.find.case")}
    aria-label={t("pane.find.case")}
    onclick={() => (caseSensitive = !caseSensitive)}><UiIcon name="case-sensitive" size={13} /></button
  >
  <button
    type="button"
    class="btn"
    disabled={count === 0}
    title={t("pane.find.prev")}
    aria-label={t("pane.find.prev")}
    onclick={() => onstep(-1)}><UiIcon name="chevron-up" size={13} /></button
  >
  <button
    type="button"
    class="btn"
    disabled={count === 0}
    title={t("pane.find.next")}
    aria-label={t("pane.find.next")}
    onclick={() => onstep(1)}><UiIcon name="chevron-down" size={13} /></button
  >
  <button
    type="button"
    class="btn"
    title={t("pane.find.close")}
    aria-label={t("pane.find.close")}
    onclick={onclose}><UiIcon name="close" size={13} /></button
  >
</div>

<style>
  .find {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 4px 6px 4px 10px;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--border);
  }

  .find-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 22px;
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--border);
    border-radius: 999px;
  }

  .find-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .find-count {
    flex: 0 0 auto;
    min-width: 3.5em;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--fg-2);
  }

  .find-count.none {
    color: var(--err);
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  /* 하이라이트 이름은 창 전체가 나눠 쓴다(`doc-find-dom.ts`) — 터미널 검색(`term/search.ts`)과 같은 색 짝 */
  :global(::highlight(doc-find)) {
    background-color: var(--accent-soft);
  }

  :global(::highlight(doc-find-current)) {
    color: var(--on-accent);
    background-color: var(--accent);
  }
</style>
