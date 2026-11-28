<script lang="ts">
  /**
   * 계획 덩어리 — Codex 계획 글 · 답한 Claude 계획(꼬리의 끝난 카드 · 기록의 `ExitPlanMode` 줄). 단추가 없다(앱이 "진행해" 를 대신 보내지 않는다).
   * 본문(`text`)이 `null` 이면 기록이 그 계획의 글을 확실히 모른다 — 다른 글로 메우지 않고 파일 경로 · 결과만 보인다.
   * 안내 줄(`hint`)은 부르는 쪽이 정한다 — 지금 모드가 Codex Plan 이고 마지막 계획 덩어리일 때만.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import { parseMarkdown } from "$lib/markdown";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    text,
    streaming = false,
    title,
    file = null,
    outcome = null,
    feedback = null,
    truncated = false,
    hint = false,
  }: {
    text: string | null;
    streaming?: boolean;
    /** 없으면 "계획" */
    title?: string;
    file?: string | null;
    outcome?: "approved" | "kept" | "cancelled" | null;
    feedback?: string | null;
    truncated?: boolean;
    hint?: boolean;
  } = $props();

  const blocks = $derived(text === null ? [] : parseMarkdown(text));
  const outcomeText = $derived(
    outcome === "approved"
      ? t("pane.chatTile.plan.approved")
      : outcome === "kept"
        ? t("pane.chatTile.plan.kept")
        : outcome === "cancelled"
          ? t("pane.chatTile.perm.cancelled")
          : null,
  );
</script>

<div class="block" data-chat-tile-plan-block data-streaming={streaming} data-has-body={text !== null} data-chat-tile-plan-outcome={outcome ?? ""}>
  <div class="head">
    <UiIcon name="list-checks" size={14} />
    <span class="title">{title ?? t("pane.chatTile.plan.block")}</span>
    {#if outcomeText}<span class="outcome" class:ok={outcome === "approved"}>{outcomeText}</span>{/if}
  </div>
  {#if text !== null}
    <div class="body" data-chat-tile-plan-body>
      <MarkdownBlocks {blocks} compact />
      {#if truncated}<span class="dim">{t("board.viewer.truncated")}</span>{/if}
    </div>
  {/if}
  {#if file}
    <div class="field" data-chat-tile-plan-file>
      <span class="label">{t("pane.chatTile.plan.file")}</span><span class="path">{file}</span>
    </div>
  {/if}
  {#if feedback}
    <div class="field" data-chat-tile-plan-feedback-done>
      <span class="label">{t("pane.chatTile.plan.feedbackDone")}</span><span class="said">{feedback}</span>
    </div>
  {/if}
  {#if hint && !streaming}
    <div class="hint" data-chat-tile-plan-hint>{t("pane.chatTile.plan.codexHint")}</div>
  {/if}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2) var(--space-3) var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-left: 3px solid color-mix(in srgb, var(--accent) 70%, var(--line));
    border-radius: 10px;
    overflow-wrap: anywhere;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
  }

  .outcome {
    flex: none;
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }

  .outcome.ok {
    color: var(--fg-2);
  }

  .body {
    min-width: 0;
  }

  .field {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--t-xs);
  }

  .label {
    flex: none;
    color: var(--fg-3);
  }

  .path {
    min-width: 0;
    font-family: var(--font-mono);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .said {
    min-width: 0;
    color: var(--fg-1);
    white-space: pre-wrap;
  }

  .dim,
  .hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
</style>
