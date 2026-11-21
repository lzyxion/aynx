<script lang="ts">
  /**
   * AI 가 쓴 승인 요약 한 줄 — 믿지 않는 글자라 `AI` 표지 없이 그리지 않는다.
   * 단추지만 승인과 무관한 보기 전환이다(검토 카드 안에서는 카드의 `keepFocus` 가 포커스를 옮기지 않게 한다).
   */
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    /** 바뀌면 펼침을 푼다 */
    operationId: string;
    summary: string | null | undefined;
  }
  let { operationId, summary }: Props = $props();

  let open = $state(false);
  $effect(() => {
    void operationId;
    open = false;
  });
</script>

{#if summary}
  <button
    type="button"
    class="summary"
    class:open
    aria-expanded={open}
    title={t(open ? "app.review.summary.less" : "app.review.summary.more")}
    onclick={() => (open = !open)}
    ><span class="sumtext"><span class="aitag" title={t("app.review.ai.title")}>{t("app.review.ai")}</span>{summary}</span
    ></button
  >
{/if}

<style>
  .summary {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    text-align: left;
    font: inherit;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .summary:hover {
    color: var(--fg-1);
  }
  .sumtext {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .summary.open .sumtext {
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: unset;
  }
  .aitag {
    display: inline-block;
    margin-right: var(--space-1);
    padding: 0 5px;
    font-size: 10px;
    font-weight: var(--fw-semibold);
    line-height: 16px;
    vertical-align: 1px;
    color: var(--fg-2);
    background: var(--surface-hover);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
</style>
