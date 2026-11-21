<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** 보안 하위 화면 셋의 찾기 칸 + 거르기 칩 — 라벨 뒤에 개수가 붙어 `ChoiceChips`(문구 키만 받는다)를 쓰지 않는다 */
  let {
    query = $bindable(""),
    placeholder,
    chips,
    value,
    onpick,
  }: {
    query?: string;
    placeholder: string;
    chips: readonly { key: string; label: string; n: number }[];
    value: string;
    onpick: (key: string) => void;
  } = $props();
</script>

<div class="cred-tools">
  <input
    type="search"
    class="value cred-search"
    {placeholder}
    aria-label={placeholder}
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
  />
  <div class="opt-chips cred-chips" role="group" aria-label={t("settings.credentials.filter.aria")}>
    {#each chips as c (c.key)}
      <button
        type="button"
        class="opt-chip"
        class:active={value === c.key}
        aria-pressed={value === c.key}
        data-value={c.key}
        onclick={() => onpick(c.key)}
      >
        <span>{c.label}</span>
        <span class="n">{c.n}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .cred-tools {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  /* 찾는 글자는 별칭 · 경로 · 이름이 섞여 본문 글꼴이다 — 공용 `.value`(고정폭)를 두 클래스로 덮는다 */
  .value.cred-search {
    font-family: var(--font-ui);
    font-size: var(--t-sm);
  }

  .cred-chips {
    justify-content: flex-start;
  }

  .n {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
</style>
