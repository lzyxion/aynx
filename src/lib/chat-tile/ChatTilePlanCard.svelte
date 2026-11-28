<script lang="ts">
  /**
   * Claude `ExitPlanMode` 카드 — [계획 승인] = allow · [계속 계획] = deny(사람이 친 고칠 점만 실린다 · 비면 서버 기본 글).
   * 모드는 카드가 바꾸지 않는다 — 승인 뒤 칩은 CLI 가 알린 대로 바뀐다. 파일 경로는 글자로만 보인다(열기 동작 없음).
   * 답한 뒤에도 사람이 본 그 글을 결과와 함께 계획 덩어리로 남긴다(고칠 점은 이 카드에서 보낸 것만).
   */
  import { onMount } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import { parseMarkdown } from "$lib/markdown";
  import { planOf } from "$lib/chat-tile/chat-tile-mode";
  import { holdCardInView } from "$lib/chat-tile/ChatTilePermCard.svelte";
  import ChatTilePlanBlock from "$lib/chat-tile/ChatTilePlanBlock.svelte";
  import type { LiveEntry } from "$lib/side-chat-live";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    perm,
    input,
    agent,
    busy,
    ondecide,
  }: {
    perm: Extract<LiveEntry, { kind: "permission" }>;
    input?: unknown;
    agent: string;
    busy: boolean;
    ondecide: (d: "allow" | "deny", message: string | null) => void;
  } = $props();

  let cardEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);
  let feedback = $state("");
  /** 이 카드의 [계속 계획]이 실은 고칠 점 */
  let sent = $state<string | null>(null);

  onMount(() => {
    const el = cardEl;
    if (!el || perm.resolved) return;
    return holdCardInView(el, () => actionsEl);
  });

  const plan = $derived(planOf(input, perm.detail));
  const blocks = $derived(parseMarkdown(plan.plan));
  const outcome = $derived.by(() => {
    const r = perm.resolved;
    if (!r) return null;
    if (r.by === "human") return r.decision === "allow" ? "approved" : "kept";
    return "cancelled";
  });

  function keep(): void {
    sent = feedback.trim() || null;
    ondecide("deny", sent);
  }

  function onFeedbackKey(ev: KeyboardEvent): void {
    // 입력 칸의 보내기로 새지 않게 — Enter 는 [계속 계획]
    if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!busy && feedback.trim() !== "") keep();
  }
</script>

{#if perm.resolved}
  <div class="done" data-chat-tile-plan-card={perm.requestId} data-chat-tile-perm={perm.requestId} data-chat-tile-perm-result={perm.resolved.by}>
    <ChatTilePlanBlock
      text={plan.plan}
      title={t("pane.chatTile.plan.title", { agent })}
      file={plan.path}
      {outcome}
      feedback={outcome === "kept" ? sent : null}
    />
  </div>
{:else}
  <div
    bind:this={cardEl}
    class="card"
    role="group"
    aria-label={t("pane.chatTile.plan.title", { agent })}
    data-chat-tile-plan-card={perm.requestId}
    data-chat-tile-perm={perm.requestId}
  >
    <div class="head">
      <UiIcon name="list-checks" size={16} />
      <span class="title">{t("pane.chatTile.plan.title", { agent })}</span>
    </div>
    <div class="body" data-chat-tile-perm-body>
      <div class="plan" data-chat-tile-plan>
        <MarkdownBlocks {blocks} compact />
      </div>
      {#if plan.path}
        <div class="field" data-chat-tile-plan-file>
          <span class="label">{t("pane.chatTile.plan.file")}</span><span class="path">{plan.path}</span>
        </div>
      {/if}
    </div>
    <input
      class="feedback"
      type="text"
      maxlength="2000"
      bind:value={feedback}
      placeholder={t("pane.chatTile.plan.feedback")}
      aria-label={t("pane.chatTile.plan.feedback")}
      disabled={busy}
      data-chat-tile-plan-feedback
      onkeydown={onFeedbackKey}
    />
    <div bind:this={actionsEl} class="actions" data-chat-tile-perm-actions>
      <button type="button" class="btn btn-secondary btn-sm" data-chat-tile-plan-keep disabled={busy} onclick={keep}
        >{t("pane.chatTile.plan.keep")}</button
      >
      <button type="button" class="btn btn-primary btn-sm" data-chat-tile-plan-approve disabled={busy} onclick={() => ondecide("allow", null)}
        >{t("pane.chatTile.plan.approve")}</button
      >
    </div>
  </div>
{/if}

<style>
  /* 권한 카드(`ChatTilePermCard`)와 같은 판 — 머리 · 고칠 점 · 단추 줄은 붙고 본문만 구른다 */
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, var(--line-strong));
    border-radius: 10px;
    overflow: hidden;
    box-sizing: border-box;
    max-height: var(--perm-room, none);
  }

  .head,
  .feedback,
  .actions {
    flex: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .body > * {
    flex-shrink: 0;
  }

  .plan {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
  }

  .field {
    display: flex;
    align-items: baseline;
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

  .feedback {
    box-sizing: border-box;
    width: 100%;
    height: 30px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .feedback:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .actions .btn {
    flex: 1 1 auto;
    justify-content: center;
    white-space: nowrap;
  }

  .done {
    min-width: 0;
  }
</style>
