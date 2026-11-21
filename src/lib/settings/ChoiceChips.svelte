<script module lang="ts">
  import type { Key } from "$lib/i18n/i18n.svelte.js";

  export type ChoiceEntry = readonly [key: string, label: Key];

  /** 표에 없는 키는 글자만 그린다 */
  export type ChoiceIcons = Readonly<Record<string, string>>;
</script>

<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";

  /** `id` 는 묶음에 둔다(설정 색인 anchor · 하네스가 존재를 본다). 칩마다 `data-value` — 하네스 손잡이 */
  let {
    id,
    label,
    labelledby,
    entries,
    value,
    onpick,
    disabled = false,
    icons = {},
  }: {
    id: string;
    label?: string;
    labelledby?: string;
    entries: readonly ChoiceEntry[];
    value: string;
    onpick: (key: string) => void;
    disabled?: boolean;
    icons?: ChoiceIcons;
  } = $props();
</script>

<div
  class="opt-chips choice-chips"
  {id}
  role="group"
  aria-label={label}
  aria-labelledby={labelledby}
>
  {#each entries as [key, text] (key)}
    <button
      type="button"
      class="opt-chip"
      class:active={value === key}
      aria-pressed={value === key}
      data-value={key}
      {disabled}
      onclick={() => onpick(key)}
    >
      {#if icons[key]}<UiIcon name={icons[key]} size={14} />{/if}
      <span>{t(text)}</span>
    </button>
  {/each}
</div>
