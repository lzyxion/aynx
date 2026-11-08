<script lang="ts">
  /**
   * **AI 가 쓴 글 한 덩이**(승인 요약 10-22) — `AI` 표지 + 이름(예: "요청 배경") + 글. AI 설명 줄(`AiSummaryLine`)과 같은 표지라
   * 앱이 쓴 글로 읽히지 않는다. 검토 카드 · 작업안 카드의 **펼친 꼴**과 기록 상세(`console/RunHistory`)가 쓴다. 글이 비면 아무것도 없다.
   */
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    label: string;
    text: string | null | undefined;
  }
  let { label, text }: Props = $props();
</script>

{#if text && text.trim() !== ""}
  <p class="ainote" data-ai-note={label}>
    <span class="aitag" title={t("app.review.ai.title")}>{t("app.review.ai")}</span><span class="alabel">{label}</span>
    <span class="atext">{text}</span>
  </p>
{/if}

<style>
  .ainote {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }
  /* `AI` 표지 — AI 설명 줄과 같은 작은 알약 */
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
  .alabel {
    margin-right: var(--space-1);
    color: var(--fg-3);
  }
  .atext {
    color: var(--fg-2);
  }
</style>
