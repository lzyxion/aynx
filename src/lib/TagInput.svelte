<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { addTags, removeTagAt, splitTagText } from "$lib/tag-input";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    id,
    tags = $bindable([]),
    placeholder = "",
    ariaLabel,
  }: {
    id?: string;
    /** 다듬어졌고 비어 있지 않고 겹치지 않는다 — 부르는 쪽은 그대로 저장한다 */
    tags: string[];
    placeholder?: string;
    ariaLabel?: string;
  } = $props();

  let text = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let wrapEl = $state<HTMLElement | null>(null);

  function commit(): void {
    const next = addTags(tags, text);
    text = "";
    if (next !== tags) tags = next;
  }

  /** 치기와 붙여넣기가 같은 한 길을 지난다 — `,` 만을 위한 키 핸들러는 두지 않는다 */
  function onInput(): void {
    const at = Math.max(text.lastIndexOf(","), text.lastIndexOf("\n"));
    if (at < 0) return;
    const head = text.slice(0, at);
    const tail = text.slice(at + 1).replace(/^\s+/, "");
    const next = addTags(tags, head);
    text = tail;
    if (next !== tags) tags = next;
  }

  function keydown(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      // 빈 칸의 Enter 는 이 컴포넌트의 것이 아니다 — 다른 칸과 같이 폼으로 간다.
      if (splitTagText(text).length === 0) return;
      ev.preventDefault();
      commit();
      return;
    }
    // 빈 칸에서만 — 글자가 남아 있는데 칩이 지워지면 방금 친 글자를 잃는다.
    if (ev.key === "Backspace" && text === "" && tags.length > 0) {
      ev.preventDefault();
      tags = removeTagAt(tags, tags.length - 1);
    }
  }

  function remove(i: number): void {
    tags = removeTagAt(tags, i);
    inputEl?.focus();
  }
</script>

<!--
  칸을 떠나면 확정한다 — [저장]을 누르러 간 손이 방금 친 태그를 잃지 않게. `focusout` 은 `click` 앞에 와 제출 핸들러가 이미 그 태그를 본다.
-->
<div
  class="tag-field"
  bind:this={wrapEl}
  onfocusout={(ev) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && wrapEl?.contains(to)) return;
    commit();
  }}
>
  <input
    {id}
    bind:value={text}
    bind:this={inputEl}
    {placeholder}
    aria-label={ariaLabel}
    autocomplete="off"
    spellcheck="false"
    oninput={onInput}
    onkeydown={keydown}
  />
  {#if tags.length > 0}
    <div class="chips">
      {#each tags as tag, i (tag)}
        <span class="chip">
          <span class="label">{tag}</span>
          <button
            type="button"
            class="x"
            aria-label={t("app.tags.remove", { tag })}
            title={t("app.tags.remove", { tag })}
            onclick={() => remove(i)}
          >
            <UiIcon name="close" size={11} />
          </button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tag-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  /* 폼의 `.fields input` 과 같은 규칙 — 스코프 CSS 는 자식 컴포넌트에 닿지 않아 여기에 다시 적는다 */
  input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }

  /* 호스트 목록의 태그(`browser/HostList.svelte` 의 `.tag`)와 같은 토큰 — 크기만 다르다 */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    height: 22px;
    padding: 2px 6px 2px 8px;
    box-sizing: border-box;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg-chip);
    background: var(--bg-chip);
    border-radius: 4px;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* `UiIcon` 은 `display:block` 이라 버튼 안에서 저절로 가운데 서지 않는다 */
  .x {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 3px;
    opacity: 0.7;
    cursor: pointer;
  }

  .x:hover {
    opacity: 1;
    background: var(--bg-hover);
  }

  .x:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
    opacity: 1;
  }
</style>
