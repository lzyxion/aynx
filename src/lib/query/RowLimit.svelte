<script lang="ts" module>
  export interface RowLimitProps {
    value: string;
    options: readonly { value: string; label: string }[];
    disabled: boolean;
    onchange: (v: string) => void;
  }
</script>

<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** 상한은 다음 실행에 쓰이므로 결과 표가 없을 때도 `line` 으로 세워 바꿀 수 있어야 한다 */
  let { value, options, disabled, onchange, line = false }: RowLimitProps & { line?: boolean } = $props();
</script>

{#snippet picker()}
  <span class="row-limit" title={t("pane.query.rows.limit")} data-query-rows>
    <Dropdown {value} {options} ariaLabel={t("pane.query.rows.limit")} {disabled} {onchange} />
  </span>
{/snippet}

{#if line}
  <!-- 결과 표의 상태 줄(`ResultGrid` 의 .status)과 같은 치수 — 고치면 같이 고친다 -->
  <div class="line">
    <span class="sp"></span>
    {@render picker()}
  </div>
{:else}
  {@render picker()}
{/if}

<style>
  /* 폼 높이(28px)의 손잡이를 이 줄에 맞춰 줄인다 */
  .row-limit {
    flex: 0 0 auto;
    width: 92px;
  }

  .row-limit :global(.trigger) {
    height: 20px;
    font-size: 11px;
  }

  .line {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 3px 8px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--fg-2);
  }

  .sp {
    flex: 1 1 auto;
  }
</style>
