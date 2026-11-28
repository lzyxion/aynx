<script lang="ts">
  /**
   * 질문 카드(Claude `AskUserQuestion` · Codex `request_user_input`) — 답은 사람이 고른 선택지 이름 · 친 글뿐이다(`cardAnswers`).
   * 고른 것은 이 컴포넌트 안에만 있다가 [답하기]에서 한 번 보낸다(열쇠 = 질문 글 — 서버가 CLI 꼴로 바꾼다). 자동으로 채우지 않는다.
   * Codex 는 하나 고르기만 · 직접 쓰기는 `isOther` 일 때만(선택지가 없으면 늘) — 비밀 질문은 서버가 카드로 내지 않는다.
   */
  import { onMount } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { cardAnswers, cardQuestions, missingQuestions, questionAnswered, togglePick, type CardQuestion, type QuestionPick } from "$lib/tile-permission";
  import { chatTileNoticeText } from "$lib/chat-tile/chat-tile-text";
  import { holdCardInView } from "$lib/chat-tile/ChatTilePermCard.svelte";
  import type { LiveEntry } from "$lib/side-chat-live";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    perm,
    input,
    cli,
    agent,
    busy,
    touch = false,
    onanswer,
    ondecline,
  }: {
    perm: Extract<LiveEntry, { kind: "permission" }>;
    input?: unknown;
    cli: "claude" | "codex";
    agent: string;
    busy: boolean;
    touch?: boolean;
    onanswer: (answers: Record<string, string>) => void;
    ondecline: () => void;
  } = $props();

  let cardEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);

  onMount(() => {
    const el = cardEl;
    if (!el || perm.resolved) return;
    return holdCardInView(el, () => actionsEl);
  });

  /** 질문 글 → 직접 쓰기 칸을 보일지 */
  function otherAllowed(raw: unknown, qs: readonly CardQuestion[]): Record<string, boolean> {
    const list = raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions) ? (raw as { questions: unknown[] }).questions : [];
    const out: Record<string, boolean> = {};
    for (const q of qs) {
      if (cli === "claude" || q.options.length === 0) {
        out[q.question] = true;
        continue;
      }
      const src = list.find((x) => !!x && typeof x === "object" && (x as { question?: unknown }).question === q.question) as { isOther?: unknown } | undefined;
      out[q.question] = src?.isOther === true;
    }
    return out;
  }

  const questions = $derived(cardQuestions(input).map((q) => (cli === "codex" ? { ...q, multiSelect: false } : q)));
  const other = $derived(otherAllowed(input, questions));
  let picks = $state<Record<string, QuestionPick>>({});
  const answers = $derived(cardAnswers(questions, picks));
  const missing = $derived(missingQuestions(questions, picks));
  const paged = $derived(questions.length > 1);
  let step = $state(0);
  const at = $derived(Math.min(step, Math.max(0, questions.length - 1)));
  const shown = $derived(paged ? [questions[at]] : questions);
  const touched = $derived(Object.keys(picks).length > 0);

  const resolvedText = $derived.by(() => {
    const r = perm.resolved;
    if (!r) return "";
    if (r.by === "human") return t(r.decision === "allow" ? "pane.chatTile.question.answered" : "pane.chatTile.question.declined");
    return t("pane.chatTile.perm.cancelled");
  });

  function setOther(q: CardQuestion, v: string): void {
    const cur = picks[q.question] ?? { labels: [], other: "" };
    // 하나 고르기에서 직접 쓰면 고른 선택지를 푼다(답은 하나)
    picks = { ...picks, [q.question]: { labels: q.multiSelect || v.trim() === "" ? cur.labels : [], other: v } };
  }

  function onOtherKey(ev: KeyboardEvent): void {
    // 숨은 입력 칸의 보내기 · 앱 단축키로 새지 않게 — Enter 는 아무것도 하지 않는다
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  function send(): void {
    if (answers) onanswer(answers);
  }
</script>

{#if perm.resolved}
  <div class="done" data-chat-tile-q-card={perm.requestId} data-chat-tile-perm={perm.requestId} data-chat-tile-perm-result={perm.resolved.by}>
    <span class="done-icon" aria-hidden="true"><UiIcon name="chat" size={13} /></span>
    <span class="done-title">{t("pane.chatTile.question.title", { agent })}</span>
    <span class="done-result">{resolvedText}</span>
  </div>
{:else}
  <div
    bind:this={cardEl}
    class="card"
    class:touch
    role="group"
    aria-label={t("pane.chatTile.question.title", { agent })}
    data-chat-tile-q-card={perm.requestId}
    data-chat-tile-perm={perm.requestId}
  >
    <div class="head">
      <UiIcon name="chat" size={16} />
      <span class="title">{t("pane.chatTile.question.title", { agent })}</span>
      {#if paged}<span class="q-count" data-chat-tile-q-count>{at + 1} / {questions.length}</span>{/if}
    </div>
    {#if paged}
      <div class="q-steps" role="tablist" aria-label={t("pane.perm.qSteps")} data-chat-tile-q-steps>
        {#each questions as q, i (q.question)}
          {@const done = questionAnswered(q, picks[q.question])}
          <button
            type="button"
            role="tab"
            class="q-step"
            class:cur={i === at}
            class:done={done && i !== at}
            aria-selected={i === at}
            aria-label={t("pane.perm.qStep", { n: i + 1, header: q.header ?? q.question, done: done ? t("pane.perm.qStepDone") : "" })}
            data-chat-tile-q-step={i}
            onclick={() => (step = i)}><span class="q-step-bar" aria-hidden="true"></span></button
          >
        {/each}
      </div>
    {/if}
    <div class="body" data-chat-tile-perm-body>
      {#if questions.length === 0}
        <div class="hint" data-chat-tile-q-terminal>
          <UiIcon name="terminal" size={13} /><span>{chatTileNoticeText("needs-terminal", perm.toolName)}</span>
        </div>
      {:else}
        {#each shown as q (q.question)}
          {@const groupId = `q-${perm.requestId}-${questions.indexOf(q)}`}
          <div class="q" data-chat-tile-question={q.question}>
            <div class="q-head">
              {#if q.header}<span class="badge">{q.header}</span>{/if}
              <span class="q-text" id={groupId}>{q.question}</span>
            </div>
            {#if q.multiSelect}<div class="hint-line">{t("pane.perm.multiHint")}</div>{/if}
            {#if q.options.length > 0}
              <div class="q-opts" role={q.multiSelect ? "group" : "radiogroup"} aria-labelledby={groupId}>
                {#each q.options as o (o.label)}
                  {@const on = picks[q.question]?.labels.includes(o.label) ?? false}
                  <button
                    type="button"
                    class="q-opt"
                    class:on
                    role={q.multiSelect ? "checkbox" : "radio"}
                    aria-checked={on}
                    data-chat-tile-q-option={o.label}
                    disabled={busy}
                    onclick={() => (picks = { ...picks, [q.question]: togglePick(q, picks[q.question], o.label) })}
                  >
                    <span class="q-mark" class:box={q.multiSelect} aria-hidden="true"></span>
                    <span class="q-label">{o.label}</span>
                    {#if o.description}<span class="q-desc" title={o.description}>{o.description}</span>{/if}
                  </button>
                {/each}
              </div>
            {/if}
            {#if other[q.question]}
              <input
                class="other"
                type="text"
                maxlength="2000"
                data-chat-tile-q-other
                placeholder={t("pane.chatTile.question.other")}
                aria-label={`${t("pane.chatTile.question.other")} — ${q.question}`}
                value={picks[q.question]?.other ?? ""}
                disabled={busy}
                oninput={(ev) => setOther(q, (ev.currentTarget as HTMLInputElement).value)}
                onkeydown={onOtherKey}
              />
            {/if}
          </div>
        {/each}
      {/if}
    </div>
    <!-- 하나뿐인 질문은 처음부터 — [답하기]가 왜 흐린지 -->
    {#if missing.length > 0 && (questions.length === 1 || touched)}
      <div class="missing" data-chat-tile-q-missing>{t("pane.chatTile.question.missing", { n: missing[0] })}</div>
    {/if}
    <div bind:this={actionsEl} class="actions" data-chat-tile-perm-actions>
      <button type="button" class="btn btn-secondary btn-sm" data-chat-tile-q-decline disabled={busy} onclick={ondecline}
        >{t("pane.chatTile.question.decline")}</button
      >
      {#if questions.length > 0}
        {#if paged}
          <button type="button" class="btn btn-secondary btn-sm" data-chat-tile-q-prev disabled={busy || at === 0} onclick={() => (step = at - 1)}
            >{t("pane.perm.prev")}</button
          >
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-chat-tile-q-next
            disabled={busy || at === questions.length - 1}
            onclick={() => (step = at + 1)}>{t("pane.perm.next")}</button
          >
        {/if}
        <button type="button" class="btn btn-primary btn-sm" data-chat-tile-q-answer disabled={busy || !answers} onclick={send}
          >{t("pane.chatTile.question.answer")}</button
        >
      {/if}
    </div>
  </div>
{/if}

<style>
  /* 권한 카드(`ChatTilePermCard`)와 같은 판 · 질문 몸은 AI 타일 질문 카드(`TilePermissionCard`)의 꼴 */
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
  .q-steps,
  .missing,
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
    gap: var(--space-3);
  }

  .body > * {
    flex-shrink: 0;
  }

  .hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .hint :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .hint-line,
  .missing {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .badge {
    flex: none;
    padding: 1px 8px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .q {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .q-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .q-text {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: var(--fw-semibold);
    overflow-wrap: anywhere;
  }

  .q-opts {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .q-opt {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    text-align: left;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .q-opt:hover:not(:disabled) {
    border-color: var(--line-strong);
  }

  .q-opt:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .q-opt.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .q-opt:disabled {
    cursor: default;
  }

  .card.touch .q-opt {
    min-height: 40px;
  }

  /* 낮은 타일(`data-tight` — holdCardInView) — 여백을 줄이고 선택지를 한 줄로(설명 전체는 툴팁) */
  .card:global([data-tight]) {
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }

  .card:global([data-tight]) .body {
    gap: var(--space-1);
  }

  .card:global([data-tight]) .q,
  .card:global([data-tight]) .q-opts {
    gap: 3px;
  }

  /* 선택지 한 줄 — 이름 옆에 설명(넘치면 말줄임) */
  .card:global([data-tight]) .q-opt {
    grid-template-columns: auto auto minmax(0, 1fr);
    padding: 2px var(--space-2);
    line-height: 1.3;
  }

  .card:global([data-tight]) .q-desc {
    grid-column: 3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-mark {
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--fg-3);
    border-radius: 50%;
  }

  .q-mark.box {
    border-radius: 3px;
  }

  .q-opt.on .q-mark {
    border-color: var(--accent);
    background: var(--accent);
  }

  .q-label {
    overflow-wrap: anywhere;
  }

  .q-desc {
    grid-column: 2;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .other {
    width: 100%;
    box-sizing: border-box;
    height: 30px;
    padding: 0 var(--space-3);
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .other:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 0;
  }

  .q-count {
    flex: none;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }

  .q-steps {
    display: flex;
    gap: 6px;
  }

  .q-step {
    flex: 1 1 0;
    min-width: 0;
    height: 16px;
    display: flex;
    align-items: center;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
  }

  .q-step-bar {
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--line-strong);
  }

  .q-step.done .q-step-bar {
    background: color-mix(in srgb, var(--accent) 45%, var(--line));
  }

  .q-step.cur .q-step-bar {
    background: var(--accent);
  }

  .q-step:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-radius: 4px;
  }

  .card.touch .q-step {
    height: 28px;
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
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .done-icon {
    flex: none;
    display: inline-flex;
    color: var(--fg-2);
  }

  .done-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  .done-result {
    flex: none;
    white-space: nowrap;
  }

  .done-result::before {
    content: "· ";
  }
</style>
