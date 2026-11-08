<script lang="ts" module>
  /** 행 상한 고르개에 넘기는 것 — 값 · 칸 · 고를 때 · 비활성(도는 동안) */
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

  /**
   * **행 상한 고르개** — 결과 칸 아래 줄([복사] · [CSV 저장] 옆)에 선다(10-14 — 위 띠에서 옮겼다). 결과 표가 있으면 그 상태 줄
   * (`ResultGrid`)이 [복사] 앞에 그리고, 표가 없을 때(실행 전 · 오류 · 취소 · 스크립트의 멈춘 문장)는 `line` 으로 같은 모양의 아래
   * 줄을 세워 오른쪽 끝에 둔다 — 상한은 **다음 실행**에 쓰이므로 결과 유무와 상관없이 바꿀 수 있어야 한다. 값은 타일마다 기억
   * (`QueryView`).
   */
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
  /* 폼 높이(28px)의 손잡이를 이 줄(11px 글자 · .tbtn 높이)에 맞춰 줄인다 — 좁아도 줄지 않는다(글자는 짧은 숫자) */
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
