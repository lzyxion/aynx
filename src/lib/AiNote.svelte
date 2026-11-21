<script lang="ts">
  /** AI 가 쓴 글 한 덩이 — `AI` 표지 없이 그리지 않는다(앱이 쓴 글로 읽히면 안 된다) */
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
