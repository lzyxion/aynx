<script lang="ts">
  /**
   * Codex 목표 카드 — 대화 끝(입력 칸 위)의 꼬리 카드 자리. 목표는 사람이 [목표 정하기]를 눌러야만 선다(다시 보내기 없음).
   * 한도는 `GOAL_BUDGETS` 다섯 값 중 하나만 싣는다 — 직접 입력 칸을 짓지 않는다(서버가 그 밖을 거절한다).
   * 목표를 정하면 Codex 가 새 메시지 없이 턴을 이어 연다 — 그 경고 글을 [목표 정하기] 바로 위에 늘 보인다. 첫 포커스는 목표 글.
   * 낮은 타일(`data-tight`)에서는 목표 글 칸이 맨 위에 선다 — 나머지만 구르고 단추 줄은 늘 보인다.
   */
  import { onMount, tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { holdCardInView } from "$lib/chat-tile/ChatTilePermCard.svelte";
  import { isImeKey } from "$lib/pane/ai-flip-keys";
  import { formatTokens } from "$lib/chat-tile/chat-tile-context";
  import { GOAL_BUDGET_DEFAULT, GOAL_BUDGETS, GOAL_OBJECTIVE_MAX, goalObjectiveError, type GoalBudget } from "$lib/chat-tile/chat-tile-goal";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    objective = "",
    replacing = false,
    busy = false,
    sending = false,
    error = null,
    touch = false,
    onset,
    oncancel,
  }: {
    /** 처음 글(`/goal` 뒤 글) — 그 뒤는 카드가 쥔다 */
    objective?: string;
    /** 이미 목표가 있다 — 갈음한다고 말한다 */
    replacing?: boolean;
    busy?: boolean;
    sending?: boolean;
    error?: string | null;
    touch?: boolean;
    onset: (objective: string, budget: GoalBudget) => void;
    oncancel: () => void;
  } = $props();

  const seed = () => objective;
  let text = $state(seed());
  let budget = $state<GoalBudget>(GOAL_BUDGET_DEFAULT);
  const headId = `ct-gl-${Math.random().toString(36).slice(2, 10)}`;
  const budgetId = `${headId}-b`;
  let cardEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);
  let cancelEl = $state<HTMLButtonElement | null>(null);
  let fieldEl = $state<HTMLTextAreaElement | null>(null);

  const count = $derived([...text.trim()].length);
  const bad = $derived(goalObjectiveError(text));
  const why = $derived(busy ? t("pane.chatTile.goal.busy") : bad ? t(bad) : null);
  const canSet = $derived(!busy && !sending && bad === null);

  onMount(() => {
    void tick().then(() => {
      const el = fieldEl;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  });

  $effect(() => {
    const el = cardEl;
    void error;
    void replacing;
    if (!el) return;
    // 낮은 타일에서도 목표 글 칸 · 단추 줄이 대화 칸 안에 — 카드는 칸 높이까지 줄어든다
    return holdCardInView(el, () => actionsEl, 72);
  });

  let lastFocus: HTMLElement | null = null;
  $effect(() => {
    void canSet;
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (!lastFocus || (lastFocus.isConnected && !(lastFocus as HTMLButtonElement).disabled)) return;
      cancelEl?.focus({ preventScroll: true });
    });
  });

  function set(): void {
    if (!canSet) return;
    onset(text.trim(), budget);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" || isImeKey(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    oncancel();
  }

  function onBudgetKey(ev: KeyboardEvent): void {
    if (isImeKey(ev)) return;
    const dir = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
    if (dir === 0) return;
    ev.preventDefault();
    const i = GOAL_BUDGETS.indexOf(budget);
    const next = GOAL_BUDGETS[(i + dir + GOAL_BUDGETS.length) % GOAL_BUDGETS.length];
    budget = next;
    void tick().then(() => cardEl?.querySelector<HTMLElement>(`[data-chat-tile-goal-budget="${next}"]`)?.focus({ preventScroll: true }));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={cardEl}
  class="card"
  class:touch
  role="group"
  aria-labelledby={headId}
  data-chat-tile-goal-card
  data-budget={budget}
  onkeydown={onKey}
  onfocusin={(ev) => (lastFocus = ev.target as HTMLElement)}
>
  <div class="main">
    <div class="head">
      <UiIcon name="route" size={16} />
      <span class="title" id={headId}>{t("pane.chatTile.goal.set")}</span>
    </div>
    {#if replacing}<div class="replace" data-chat-tile-goal-replace><UiIcon name="info" size={13} /><span>{t("pane.chatTile.goal.replace")}</span></div>{/if}
    <label class="field objective">
      <span class="label-row"
        ><span class="label">{t("pane.chatTile.goal.objective")}</span>{#if why}<span class="why-inline" data-chat-tile-goal-why-inline>{why}</span>{/if}<span
          class="count"
          class:over={count > GOAL_OBJECTIVE_MAX}
          data-chat-tile-goal-count>{count} / {GOAL_OBJECTIVE_MAX}</span
        ></span
      >
      <textarea bind:this={fieldEl} class="box" rows="3" spellcheck="false" bind:value={text} data-chat-tile-goal-objective></textarea>
    </label>
    <div class="field">
      <span class="label" id={budgetId}>{t("pane.chatTile.goal.budget")}</span>
      <div class="budgets" role="radiogroup" aria-labelledby={budgetId} data-chat-tile-goal-budgets>
        {#each GOAL_BUDGETS as b (b)}
          <button
            type="button"
            role="radio"
            class="budget"
            aria-checked={b === budget}
            tabindex={b === budget ? 0 : -1}
            data-chat-tile-goal-budget={b}
            onclick={() => (budget = b)}
            onkeydown={onBudgetKey}>{formatTokens(b)}</button
          >
        {/each}
      </div>
      <span class="hint">{t("pane.chatTile.goal.budgetHint")}</span>
    </div>
    <div class="warn" data-chat-tile-goal-warn>
      <UiIcon name="warning" size={13} />
      <div class="warn-text">
        <p>{t("pane.chatTile.goal.warn")}</p>
        <p class="sub">{t("pane.chatTile.goal.stopHint")}</p>
      </div>
    </div>
    {#if error}<div class="error" role="alert" data-chat-tile-goal-error>{error}</div>{/if}
  </div>
  <div bind:this={actionsEl} class="actions" data-chat-tile-goal-actions>
    {#if why}<div class="why" data-chat-tile-goal-why>{why}</div>{/if}
    <button bind:this={cancelEl} type="button" class="btn btn-secondary btn-sm" data-chat-tile-goal-cancel onclick={oncancel}>{t("pane.chatTile.goal.cancel")}</button>
    <button type="button" class="btn btn-primary btn-sm" data-chat-tile-goal-set disabled={!canSet} title={why ?? undefined} onclick={set}>
      {#if sending}<span class="spin" aria-hidden="true"><UiIcon name="sync" size={13} /></span>{:else}<UiIcon name="route" size={13} />{/if}{t("pane.chatTile.goal.set")}
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
    border: 1px solid color-mix(in srgb, var(--warn) 50%, var(--line-strong));
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
    padding-top: var(--space-1);
    padding-bottom: 0;
  }

  .card:global([data-tight]) .actions {
    padding: var(--space-1) 0;
    border-top: 1px solid var(--line);
  }

  .card:global([data-tight]) .objective {
    order: -1;
  }

  /* 낮은 카드 — 글 칸이 맨 위 · 이름 · 까닭 줄은 그 밑(구르는 몫) · 단추 줄은 한 줄 */
  .card:global([data-tight]) .objective .label-row {
    order: 1;
  }

  .card:global([data-tight]) .box {
    height: calc(1.45em + 8px);
    min-height: calc(1.45em + 8px);
    max-height: 5em;
    padding-top: 3px;
    padding-bottom: 3px;
    resize: none;
  }

  .why-inline {
    display: none;
  }

  .card:global([data-tight]) .why-inline {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .card:global([data-tight]) .why-inline ~ .count,
  .card:global([data-tight]) .label:has(+ .why-inline) {
    display: none;
  }

  .card:global([data-tight]) .actions .why {
    display: none;
  }

  .card:global([data-tight]) .main {
    gap: var(--space-1);
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

  .replace {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .replace :global(svg),
  .warn :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .label-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .label {
    flex: 1 1 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .count {
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .count.over {
    color: var(--err);
  }

  .box {
    box-sizing: border-box;
    width: 100%;
    min-height: 3.6em;
    max-height: 9em;
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    resize: vertical;
  }

  .box:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 0;
  }

  .budgets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 3px;
    align-self: flex-start;
    max-width: 100%;
    box-sizing: border-box;
    background: var(--control-tile-bg);
    border-radius: 999px;
  }

  .budget {
    height: 24px;
    min-width: 48px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .budget[aria-checked="true"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    font-weight: var(--fw-semibold);
  }

  .budget:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .card.touch .budget {
    height: 36px;
  }

  .hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .warn {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    border-radius: var(--radius-sm);
  }

  .warn :global(svg) {
    color: var(--warn);
  }

  .warn-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .warn-text p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .warn-text .sub {
    color: var(--fg-2);
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
    gap: 6px;
    white-space: nowrap;
  }

  .card.touch .actions .btn {
    height: 40px;
    font-size: var(--t-sm);
  }

  .spin {
    flex: none;
    display: inline-flex;
    animation: gl-spin 1.1s linear infinite;
  }

  @keyframes gl-spin {
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
