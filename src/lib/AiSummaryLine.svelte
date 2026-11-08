<script lang="ts">
  /**
   * **AI 가 쓴 설명 한 줄**(승인 요약 — docs/log/2026-10-21-approval-summary.md) — 화면 아래 검토 카드(`ReviewCard`)와 작업안 타일의
   * 카드(`console/PlanList`)가 같은 조각을 쓴다(둘이 어긋나지 않게).
   *
   * 앞의 `AI` 표지가 "앱이 확인한 글이 아니다" 를 말한다 — 이 글은 믿지 않는 글자라 표지 없이 그리지 않는다. 두 줄에서 말줄임, 누르면
   * 전부. 단추지만 **승인과 무관한 보기 전환**이고, 검토 카드 안에서는 카드 상자의 `keepFocus` 가 포커스를 옮기지 않게 한다.
   * 설명이 없는 옛 작업안이면 아무것도 그리지 않는다. 보이는 작업안이 바뀌면 다시 접힌다.
   */
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    /** 작업안 id — 바뀌면 펼침을 푼다 */
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
  /* 글자 단추(판 없음). 두 줄에서 말줄임(`line-clamp`), 펼치면 전부 */
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
  /* `AI` 표지 — 작은 알약 */
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
