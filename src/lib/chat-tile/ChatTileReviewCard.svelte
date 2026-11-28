<script lang="ts">
  /**
   * Codex 검토 카드 — 대화 끝(입력 칸 위)의 꼬리 카드 자리. 검토는 사람이 [검토 시작]을 눌러야만 간다(보내기 · 다시 보내기 없음).
   * 싣는 것은 고른 대상의 칸 하나뿐(`reviewTargetOf`) — 브랜치 · 커밋이 있는지는 CLI 가 판정한다(Aynx 는 git 을 부르지 않는다).
   * 첫 포커스는 고른 대상 라디오 — [검토 시작]에 두지 않는다(Enter 한 번에 검토가 시작되지 않게).
   */
  import { onMount, tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { holdCardInView } from "$lib/chat-tile/ChatTilePermCard.svelte";
  import { isImeKey } from "$lib/pane/ai-flip-keys";
  import type { ReviewTargetWire } from "$lib/chat-tile/chat-tile-api";
  import { REVIEW_KINDS, reviewKindKey, reviewTargetError, reviewTargetOf, type ReviewDraft, type ReviewKind } from "$lib/chat-tile/chat-tile-review";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    draft,
    busy = false,
    sending = false,
    error = null,
    touch = false,
    onstart,
    oncancel,
  }: {
    /** 처음 값 — 그 뒤는 카드가 쥔다 */
    draft: ReviewDraft;
    /** 턴 중 · 카드 대기 — [검토 시작]을 막고 까닭을 보인다 */
    busy?: boolean;
    sending?: boolean;
    /** 서버 거절 글(문구로 고른 것) */
    error?: string | null;
    touch?: boolean;
    onstart: (target: ReviewTargetWire) => void;
    oncancel: () => void;
  } = $props();

  const seed = () => ({ ...draft });
  let d = $state<ReviewDraft>(seed());
  const headId = `ct-rv-${Math.random().toString(36).slice(2, 10)}`;
  let cardEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);
  let cancelEl = $state<HTMLButtonElement | null>(null);

  const target = $derived(reviewTargetOf(d));
  const bad = $derived(reviewTargetError(target));
  const why = $derived(busy ? t("pane.chatTile.review.busy") : bad ? t(bad) : null);
  const canStart = $derived(!busy && !sending && bad === null);

  onMount(() => {
    void tick().then(() => cardEl?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true }));
  });

  $effect(() => {
    const el = cardEl;
    void d.kind;
    void error;
    if (!el) return;
    return holdCardInView(el, () => actionsEl);
  });

  // 포커스가 있던 단추가 막히면(턴이 섬) 몸으로 떨어지지 않게 [취소]로
  let lastFocus: HTMLElement | null = null;
  $effect(() => {
    void canStart;
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (!lastFocus || (lastFocus.isConnected && !(lastFocus as HTMLButtonElement).disabled)) return;
      cancelEl?.focus({ preventScroll: true });
    });
  });

  function start(): void {
    if (!canStart) return;
    onstart(target);
  }

  function pick(k: ReviewKind): void {
    d.kind = k;
  }

  function onKindKey(ev: KeyboardEvent): void {
    if (isImeKey(ev)) return;
    const dir = ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    ev.preventDefault();
    const i = REVIEW_KINDS.indexOf(d.kind);
    const next = REVIEW_KINDS[(i + dir + REVIEW_KINDS.length) % REVIEW_KINDS.length];
    pick(next);
    void tick().then(() => cardEl?.querySelector<HTMLElement>(`[data-chat-tile-review-kind="${next}"]`)?.focus({ preventScroll: true }));
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" || isImeKey(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    oncancel();
  }

  /** 한 줄 칸의 Enter = [검토 시작](막혀 있으면 아무것도 않는다) — 입력 칸의 보내기로 새지 않게 */
  function onLineKey(ev: KeyboardEvent): void {
    if (ev.key !== "Enter" || isImeKey(ev) || ev.shiftKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    start();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={cardEl}
  class="card"
  class:touch
  role="group"
  aria-labelledby={headId}
  data-chat-tile-review-card
  data-kind={d.kind}
  onkeydown={onKey}
  onfocusin={(ev) => (lastFocus = ev.target as HTMLElement)}
>
  <div class="main">
    <div class="head">
      <UiIcon name="list-checks" size={16} />
      <span class="title" id={headId}>{t("pane.chatTile.review.title")}</span>
    </div>
    <div class="kinds" role="radiogroup" aria-labelledby={headId} data-chat-tile-review-kinds>
      {#each REVIEW_KINDS as k (k)}
        <button
          type="button"
          role="radio"
          class="kind"
          aria-checked={k === d.kind}
          tabindex={k === d.kind ? 0 : -1}
          data-chat-tile-review-kind={k}
          onclick={() => pick(k)}
          onkeydown={onKindKey}
          ><span class="dot" aria-hidden="true"></span><span class="kind-label">{t(reviewKindKey(k))}</span></button
        >
      {/each}
    </div>
    {#if d.kind === "baseBranch"}
      <label class="field">
        <span class="label">{t("pane.chatTile.review.branch")}</span>
        <input
          class="line mono"
          type="text"
          maxlength="200"
          spellcheck="false"
          autocomplete="off"
          bind:value={d.branch}
          data-chat-tile-review-field
          data-chat-tile-review-branch
          onkeydown={onLineKey}
        />
      </label>
    {:else if d.kind === "commit"}
      <label class="field">
        <span class="label">{t("pane.chatTile.review.sha")}</span>
        <input
          class="line mono"
          type="text"
          maxlength="64"
          spellcheck="false"
          autocomplete="off"
          placeholder="ea1dbc41"
          bind:value={d.sha}
          data-chat-tile-review-field
          data-chat-tile-review-sha
          onkeydown={onLineKey}
        />
      </label>
    {:else if d.kind === "custom"}
      <label class="field">
        <span class="label">{t("pane.chatTile.review.instructions")}</span>
        <textarea class="box" rows="3" maxlength="4096" spellcheck="false" bind:value={d.instructions} data-chat-tile-review-field data-chat-tile-review-instructions></textarea>
      </label>
    {/if}
    <div class="hint" data-chat-tile-review-inline>{t("pane.chatTile.review.inline")}</div>
    {#if error}<div class="error" role="alert" data-chat-tile-review-error>{error}</div>{/if}
  </div>
  <div bind:this={actionsEl} class="actions" data-chat-tile-review-actions>
    {#if why}<div class="why" data-chat-tile-review-why>{why}</div>{/if}
    <button bind:this={cancelEl} type="button" class="btn btn-secondary btn-sm" data-chat-tile-review-cancel onclick={oncancel}>{t("pane.chatTile.review.cancel")}</button>
    <button type="button" class="btn btn-primary btn-sm" data-chat-tile-review-start disabled={!canStart} title={why ?? undefined} onclick={start}>
      {#if sending}<span class="spin" aria-hidden="true"><UiIcon name="sync" size={13} /></span>{/if}{t("pane.chatTile.review.start")}
    </button>
  </div>
</div>

<style>
  /* 권한 · 되감기 카드와 같은 판 — 단추 줄은 따로 붙고 그 위 칸만 구른다 */
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

  .main {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .main > * {
    flex-shrink: 0;
  }

  .card:global([data-tight]) {
    padding-top: var(--space-2);
    padding-bottom: 0;
  }

  .card:global([data-tight]) .actions {
    padding: var(--space-2) 0;
    border-top: 1px solid var(--line);
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

  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 var(--space-3) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .kind:hover {
    background: var(--control-tile-bg-hover);
  }

  .kind[aria-checked="true"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    font-weight: var(--fw-semibold);
  }

  .kind:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    opacity: 0.7;
  }

  .kind[aria-checked="true"] .dot {
    border-width: 3px;
    opacity: 1;
  }

  .card.touch .kind {
    height: 40px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .label {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .line,
  .box {
    box-sizing: border-box;
    width: 100%;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .line {
    height: 30px;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .box {
    padding: var(--space-1) var(--space-3);
    min-height: 3.6em;
    max-height: 9em;
    resize: vertical;
    line-height: 1.45;
  }

  .card.touch .line {
    height: 40px;
    font-size: var(--t-sm);
  }

  .line:focus-visible,
  .box:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 0;
  }

  .hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .error {
    font-size: var(--t-xs);
    color: var(--err);
    overflow-wrap: anywhere;
  }

  .actions {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .why {
    flex: 1 0 100%;
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .actions .btn {
    flex: 1 1 auto;
    justify-content: center;
    white-space: nowrap;
  }

  .card.touch .actions .btn {
    height: 40px;
    font-size: var(--t-sm);
  }

  .spin {
    flex: none;
    display: inline-flex;
    animation: rv-spin 1.1s linear infinite;
  }

  @keyframes rv-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
