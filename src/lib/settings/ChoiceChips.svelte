<script module lang="ts">
  import type { Key } from "$lib/i18n/i18n.svelte.js";

  /** 칩 하나 — `[값 키, 라벨 문구 키]` */
  export type ChoiceEntry = readonly [key: string, label: Key];

  /**
   * 칩 앞 아이콘 — 값 키 → `UiIcon` 이름 (scripts/gen-ui-icons.mjs).
   * 표에 없는 키는 글자만 그린다 (옵션이 늘어도 칩이 깨지지 않는다).
   */
  export type ChoiceIcons = Readonly<Record<string, string>>;
</script>

<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 설정의 **고르는 칸** — select 대신 칩 줄이다 (앱 테마·터미널 섹션이 함께 쓴다).
   * 고른 값 하나만 `aria-pressed`. `id` 는 묶음에 둔다: 설정 색인(`settings-index.ts`)의
   * anchor 이고 하네스가 존재를 본다. 칩마다 `data-value` 로 키를 단다(하네스가 고르기 쉽게).
   * 모양(`.opt-chips` · `.opt-chip`)은 색 테마 칩 줄과 나눠 쓰므로 `settings.css` 에 있다.
   */
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
      <!-- 고른 칩은 색(secondaryContainer)으로만 갈린다 — ✓ 를 걷고 제 아이콘은 늘 그대로 (2026-10-28) -->
      {#if icons[key]}<UiIcon name={icons[key]} size={14} />{/if}
      <span>{t(text)}</span>
    </button>
  {/each}
</div>
