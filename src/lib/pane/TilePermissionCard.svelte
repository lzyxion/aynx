<script lang="ts">
  /**
   * **타일 권한 카드 한 장**(2026-11-01 화면 단계 — docs/log/2026-11-01-tile-permission-hook.md 10절). AI 타일 대화 면(`pane/AiFlip`)의
   * 입력 칸 위에 선다. 모양 · 토큰은 사이드 채팅 권한 카드(`SideChatFace` 의 `.perm`)와 같고 도구별 본문만 다르다(모델은 순수
   * `$lib/tile-permission` 의 `cardBody`):
   * - 명령(Bash · Codex 셸): 판결 띠(작업안 승인 카드와 같은 앱 분석 — Rust `operations::analysis` · `VerdictBand`) · AI 가 쓴 설명 한 줄 · 명령
   * - Edit · MultiEdit · apply_patch: 경로 + 줄 diff(Edit 는 `old_string` → `new_string` 조각만 — 파일의 앞뒤 줄은 훅에 없다)
   * - Write · NotebookEdit: 경로 + 새 내용(12줄 넘으면 접기)
   * - WebFetch(URL + 지시) · WebSearch(검색어) · Read 류(경로) · MCP(서버 · 도구 + 인자 JSON) · 그 밖(도구 + 입력)
   * 단추: [허용 한 번] · [이 세션 동안 허용](`canAllowSession`) · [거절](+ 선택 사유 — 모델에게 간다) · 아래 작은 [터미널에서 답하기](= release —
   * 결정 없이 풀어 CLI 가 평소 창을 띄운다). 결정은 처음 하나만 먹는다 — 다른 창이 먼저 답했으면 조용히 걷힌다.
   *
   * **질문 카드**(2026-11-02 — Claude `AskUserQuestion` · 실측 7절): 질문마다 머리 · 글 · 선택지(하나 고르기 = 라디오 · 여러 개 = 체크) · [직접 입력]
   * 칸. [답하기]는 모든 질문에 답이 있을 때만 서고, 답(`answers` — 사람이 고른 선택지 이름 · 친 글뿐)은 훅 응답(`updatedInput.answers`)으로만 CLI 에
   * 간다(PTY 키 주입 없음 — Claude 는 `updatedInput.answers`, Codex `request_user_input` 은 `PreToolUse` deny 이유 글 · A안). 허용 · 세션 허용 · 거절 단추는
   * 없다. Codex 는 하나 고르기 + 직접 입력만("None of the above" 자리). 답 길이 없는 카드(잘린 입력)는 질문 · 선택지만 보이고 선택지를 누르면 [터미널에서
   * 답하기]와 같다(카드를 풀고 터미널 면으로 — 고르기는 TUI 에서).
   *
   * **질문이 여럿이면 한 장씩**(2026-11-02 사용자 확정 목업): 머리 줄에 `n / N` · 그 아래 단계 막대(질문마다 한 칸 단추 — 지금 = 강조색 · 답함 = 옅은 강조색 ·
   * 나머지 = 선 색 · 누르면 그 질문으로). 본문은 지금 질문 하나. 고르기는 고르기만 하고(저절로 넘기지 않는다) [이전] · [다음](이 질문에 답이 있어야) ·
   * 마지막은 [답하기](모두 답했어야) · 빠진 질문 안내 한 줄. 질문이 하나면 예전 그대로(숫자 · 막대 · 이전/다음 없음). 답이 먹으면 대화 면 그 자리에
   * "답을 보냈습니다" 요약([`recordQuestionSummary`] — 보낸 답 그대로)이 남는다.
   */
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import VerdictBand from "$lib/VerdictBand.svelte";
  import { showNotice } from "$lib/app/notice";
  import { stripReason } from "$lib/error-reason";
  import {
    cardAnswers,
    cardBody,
    commandVerdict,
    missingQuestions,
    questionAnswered,
    questionSummary,
    togglePick,
    type QuestionPick,
    secondsLeft,
    SHOW_LEFT_UNDER_S,
    type TilePermCard,
    type TilePermDecision,
  } from "$lib/tile-permission";
  import { commandAnalysisOf, decideTilePermission, isDecidingTilePerm, recordQuestionSummary } from "$lib/app/tile-permission.svelte.js";

  let {
    card,
    now,
    phone = false,
    onterminal,
  }: {
    card: TilePermCard;
    /** 지금 시각(ms) — 부모가 1초마다 올린다 */
    now: number;
    /** 폰(터치) — 단추를 키운다 */
    phone?: boolean;
    /** [터미널에서 답하기] 를 풀었다 — 부모가 터미널 면으로 넘긴다 */
    onterminal: () => void;
  } = $props();

  /** 접기 전 글 줄 수 */
  const FOLD_LINES = 12;

  const body = $derived(cardBody(card));
  const busy = $derived(isDecidingTilePerm(card.requestId));
  const analysis = $derived(body.kind === "command" ? commandAnalysisOf(card.requestId, body.command) : null);
  const verdict = $derived(body.kind === "command" && analysis ? commandVerdict(body.command, analysis) : null);
  const left = $derived(secondsLeft(card, now));

  let reasonOpen = $state(false);
  let reason = $state("");
  let reasonEl = $state<HTMLInputElement | null>(null);
  let unfolded = $state(false);

  // ── 질문 카드 ──
  /** 질문 글 → 고른 것 */
  let picks = $state<Record<string, QuestionPick>>({});
  const answers = $derived(body.kind === "question" && body.answerable ? cardAnswers(body.questions, picks) : null);
  const questions = $derived(body.kind === "question" ? body.questions : []);
  /** 질문이 여럿이면 한 장씩 */
  const paged = $derived(questions.length > 1);
  /** 지금 보는 질문(0부터) */
  let step = $state(0);
  const at = $derived(Math.min(step, Math.max(0, questions.length - 1)));
  const isLast = $derived(at === questions.length - 1);
  const missing = $derived(missingQuestions(questions, picks));
  const hereAnswered = $derived(questions.length > 0 && questionAnswered(questions[at], picks[questions[at].question]));

  async function answer(): Promise<void> {
    if (!answers) return;
    const sent = answers;
    const r = await decideTilePermission(card, "answer", null, sent);
    if (r === "not-viewing") showNotice(t("pane.perm.notViewing"));
    else if (typeof r === "object") showNotice(t("pane.perm.failed", { e: stripReason(r.error) }));
    // 먹었다 — 대화 면 그 자리에 보낸 답 그대로의 요약
    else if (r === "applied") recordQuestionSummary(card, questionSummary(questions, sent));
  }

  const title = $derived(
    card.kind === "other"
      ? t("pane.perm.title.other", { tool: card.tool })
      : t(`pane.perm.title.${card.kind}` as "pane.perm.title.command"),
  );

  async function decide(decision: TilePermDecision): Promise<void> {
    const r = await decideTilePermission(card, decision, decision === "deny" ? reason : null);
    if (r === "not-viewing") showNotice(t("pane.perm.notViewing"));
    else if (typeof r === "object") showNotice(t("pane.perm.failed", { e: stripReason(r.error) }));
    else if (decision === "release") onterminal();
  }

  function openReason(): void {
    reasonOpen = true;
    queueMicrotask(() => reasonEl?.focus({ preventScroll: true }));
  }

  function onReasonKey(ev: KeyboardEvent): void {
    if (ev.key === "Enter" && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      void decide("deny");
    }
  }

  function m(s: number): string {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
</script>

{#snippet diffRows(rows: { op: string; text: string }[])}
  <div class="perm-diff" data-tile-perm-diff>
    {#each rows as r, i (i)}
      {#if r.op === "gap"}
        <div class="row gap" aria-hidden="true">⋯</div>
      {:else}
        <div class="row" class:add={r.op === "+"} class:del={r.op === "-"} class:hunk={r.op === "hunk"} data-op={r.op}>
          <span class="sign" aria-hidden="true">{r.op === "hunk" ? "" : r.op}</span><span class="txt">{r.text}</span>
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<div
  class="perm"
  class:phone
  data-tile-perm={card.requestId}
  data-tile-perm-kind={card.kind}
  role="group"
  aria-label={t("app.chatDock.perm.aria")}
>
  {#if verdict}
    <div class="band"><VerdictBand {verdict} /></div>
  {/if}
  <div class="perm-head">
    <UiIcon name="shield-check" size={16} />
    <span class="perm-title">{title}</span>
    {#if card.kind === "mcp"}<span class="perm-badge">MCP</span>{/if}
    {#if left > 0 && left <= SHOW_LEFT_UNDER_S}<span class="perm-left" data-tile-perm-left title={t("pane.perm.leftTip")}>{m(left)}</span>{/if}
    {#if paged}<span class="q-count" data-tile-perm-qcount>{at + 1} / {questions.length}</span>{/if}
  </div>
  {#if paged}
    <!-- 단계 막대 — 질문마다 한 칸(단추): 지금 · 답함 · 나머지 -->
    <div class="q-steps" role="tablist" aria-label={t("pane.perm.qSteps")} data-tile-perm-steps>
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
          data-tile-perm-step={i}
          onclick={() => (step = i)}><span class="q-step-bar" aria-hidden="true"></span></button
        >
      {/each}
    </div>
  {/if}

  {#if body.kind === "command"}
    {#if body.description}<div class="perm-desc" data-tile-perm-desc>{body.description}</div>{/if}
    <pre class="perm-detail" data-tile-perm-command>{body.command}</pre>
  {:else if body.kind === "diff"}
    {#if body.files.length > 0}<div class="perm-path" data-tile-perm-path>{body.files.join(" · ")}</div>{/if}
    {@render diffRows(body.rows)}
  {:else if body.kind === "text"}
    {#if body.path}<div class="perm-path" data-tile-perm-path>{body.path}{body.meta ? ` · ${body.meta}` : ""}</div>{/if}
    {@const folded = !unfolded && body.lines > FOLD_LINES}
    <pre class="perm-detail" class:folded data-tile-perm-text>{folded ? body.text.split(/\r?\n/).slice(0, FOLD_LINES).join("\n") : body.text}</pre>
    {#if body.lines > FOLD_LINES}
      <button type="button" class="link fold" data-tile-perm-fold onclick={() => (unfolded = !unfolded)}
        >{unfolded ? t("pane.perm.fold") : t("pane.perm.unfold", { n: body.lines })}</button
      >
    {/if}
  {:else if body.kind === "fetch"}
    <div class="perm-path" data-tile-perm-url>{body.url}</div>
    {#if body.prompt}<div class="perm-desc">{body.prompt}</div>{/if}
  {:else if body.kind === "search"}
    <div class="perm-path" data-tile-perm-query>{body.query}</div>
  {:else if body.kind === "read"}
    <div class="perm-path" data-tile-perm-path>{body.path}</div>
  {:else if body.kind === "mcp"}
    <div class="perm-tool" data-tile-perm-mcp>{body.server} · {body.tool}</div>
    {#if body.args}<pre class="perm-detail">{body.args}</pre>{/if}
  {:else if body.kind === "question"}
    {#each paged ? [questions[at]] : questions as q (q.question)}
      <div class="q" data-tile-perm-question>
        <div class="q-head">
          {#if q.header}<span class="perm-badge">{q.header}</span>{/if}
          <span class="q-text">{q.question}</span>
        </div>
        {#if q.multiSelect && body.answerable}<div class="perm-desc">{t("pane.perm.multiHint")}</div>{/if}
        <div class="q-opts" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
          {#each q.options as o (o.label)}
            {@const on = picks[q.question]?.labels.includes(o.label) ?? false}
            <button
              type="button"
              class="q-opt"
              class:on
              role={q.multiSelect ? "checkbox" : "radio"}
              aria-checked={on}
              data-tile-perm-option={o.label}
              disabled={busy}
              onclick={() => {
                // 답 길이 없으면(Codex) 고르기는 터미널에서 — 누르면 [터미널에서 답하기]와 같다
                if (!body.answerable) void decide("release");
                else picks = { ...picks, [q.question]: togglePick(q, picks[q.question], o.label) };
              }}
            >
              <span class="q-mark" class:box={q.multiSelect} aria-hidden="true"></span>
              <span class="q-label">{o.label}</span>
              {#if o.description}<span class="q-desc">{o.description}</span>{/if}
            </button>
          {/each}
        </div>
        {#if body.answerable}
          <input
            class="reason"
            type="text"
            maxlength="2000"
            data-tile-perm-other
            placeholder={t("pane.perm.otherPlaceholder")}
            aria-label={t("pane.perm.otherPlaceholder")}
            value={picks[q.question]?.other ?? ""}
            disabled={busy}
            oninput={(ev) => {
              const v = (ev.currentTarget as HTMLInputElement).value;
              const cur = picks[q.question] ?? { labels: [], other: "" };
              // 하나 고르기에서 직접 쓰면 고른 선택지를 푼다(답은 하나)
              picks = { ...picks, [q.question]: { labels: q.multiSelect || v.trim() === "" ? cur.labels : [], other: v } };
            }}
          />
        {/if}
      </div>
    {/each}
  {:else}
    {#if body.args}<pre class="perm-detail">{body.args}</pre>{/if}
  {/if}
  {#if card.truncated}<div class="perm-trunc" data-tile-perm-truncated>{t("pane.perm.truncated")}</div>{/if}

  {#if body.kind === "question"}
    {#if body.answerable}
      <div class="perm-actions">
        {#if paged}
          <button type="button" class="btn btn-secondary btn-sm" data-tile-perm-prev disabled={busy || at === 0} onclick={() => (step = at - 1)}
            >{t("pane.perm.prev")}</button
          >
        {/if}
        {#if paged && !isLast}
          <button type="button" class="btn btn-primary btn-sm" data-tile-perm-next disabled={busy || !hereAnswered} onclick={() => (step = at + 1)}
            >{t("pane.perm.next")}</button
          >
        {:else}
          <button type="button" class="btn btn-primary btn-sm" data-tile-perm-answer disabled={busy || !answers} onclick={() => void answer()}
            >{t("pane.perm.answer")}</button
          >
        {/if}
      </div>
    {/if}
    <div class="perm-foot">
      {#if paged && isLast && missing.length > 0 && body.answerable}
        <span class="q-missing" data-tile-perm-missing>{t("pane.perm.qMissing", { list: missing.join(", ") })}</span>
      {/if}
      <button type="button" class="link end" data-tile-perm-release disabled={busy} onclick={() => void decide("release")}
        >{t("pane.perm.release")}</button
      >
    </div>
  {:else}
  <div class="perm-actions">
    <button type="button" class="btn btn-primary btn-sm" data-tile-perm-allow disabled={busy} onclick={() => void decide("allow")}
      >{t("app.chatDock.perm.allow")}</button
    >
    {#if card.canAllowSession}
      <button type="button" class="btn btn-secondary btn-sm" data-tile-perm-session disabled={busy} onclick={() => void decide("allowSession")}
        >{t("pane.perm.allowSession")}</button
      >
    {/if}
    <button type="button" class="btn btn-secondary btn-sm" data-tile-perm-deny disabled={busy} onclick={() => void decide("deny")}
      >{t("app.chatDock.perm.deny")}</button
    >
  </div>
  {#if reasonOpen}
    <input
      bind:this={reasonEl}
      bind:value={reason}
      class="reason"
      type="text"
      maxlength="2000"
      data-tile-perm-reason
      placeholder={t("pane.perm.reasonPlaceholder")}
      aria-label={t("pane.perm.reasonPlaceholder")}
      onkeydown={onReasonKey}
    />
  {/if}
  <div class="perm-foot">
    {#if !reasonOpen}
      <button type="button" class="link" data-tile-perm-reason-open disabled={busy} onclick={openReason}>{t("pane.perm.reasonAdd")}</button>
    {/if}
    <button type="button" class="link end" data-tile-perm-release disabled={busy} onclick={() => void decide("release")}
      >{t("pane.perm.release")}</button
    >
  </div>
  {/if}
</div>

<style>
  /* 사이드 채팅 권한 카드(`SideChatFace` 의 `.perm`)와 같은 판 — 기다리는 동안 경고색 테두리 */
  .perm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--line-strong));
    border-radius: 10px;
    overflow: hidden;
    /* 카드 목록(`AiFlip` 의 `.perms`)이 스크롤한다 — 카드는 줄어들지 않는다 */
    flex: none;
  }

  /* 판결 띠는 카드 가장자리까지(`VerdictBand` 머리말 — 닿게 하는 것은 부모 몫) */
  .band {
    margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) 0;
  }

  .perm-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .perm-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .perm-badge {
    flex: none;
    padding: 1px 8px;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  /* 1분 안쪽만 — 아주 작게 */
  .perm-left {
    flex: none;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  .perm-desc {
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .perm-path,
  .perm-tool {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .perm-detail {
    margin: 0;
    max-height: 240px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .perm-diff {
    max-height: 260px;
    overflow: auto;
    padding: var(--space-1) 0;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .row {
    display: flex;
    min-width: max-content;
    padding: 0 var(--space-3) 0 var(--space-2);
    white-space: pre;
  }

  .row .sign {
    flex: none;
    width: 1.4em;
    color: var(--fg-3);
    user-select: none;
  }

  .row.add {
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }

  .row.add .sign {
    color: var(--ok);
  }

  .row.del {
    background: color-mix(in srgb, var(--err) 12%, transparent);
  }

  .row.del .sign {
    color: var(--err);
  }

  .row.hunk {
    color: var(--fg-3);
  }

  .row.gap {
    justify-content: center;
    color: var(--fg-3);
  }

  .perm-trunc {
    font-size: var(--t-xs);
    color: var(--warn);
  }

  .perm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .perm-actions .btn {
    flex: 1 1 auto;
    justify-content: center;
  }

  .reason {
    width: 100%;
    box-sizing: border-box;
    padding: 4px var(--space-3);
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .reason:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -1px;
  }

  .perm-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
  }

  .link {
    padding: 0;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-3);
    background: none;
    border: none;
    cursor: pointer;
    white-space: nowrap;
  }

  .link:hover:not(:disabled),
  .link:focus-visible {
    color: var(--fg-1);
    text-decoration: underline;
  }

  .link.fold {
    align-self: flex-start;
  }

  .link.end {
    margin-left: auto;
  }

  /* 질문 카드 — 질문마다 한 덩이 · 선택지는 줄 단추(고른 것 = 강조 테두리) */
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

  .q-opt.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .q-opt:disabled {
    cursor: default;
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

  .perm.phone .q-opt {
    min-height: 40px;
  }

  /* n / N — 머리 줄 끝 */
  .q-count {
    flex: none;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }

  /* 단계 막대 — 보이는 막대는 6px, 누르는 칸은 넉넉히(폰 32px 이상) */
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

  .perm.phone .q-step {
    height: 32px;
  }

  @media (pointer: coarse) {
    .q-step {
      height: 32px;
    }
  }

  .q-missing {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 폰 · 터치 — 단추를 32px 넘게 */
  .perm.phone .perm-actions .btn {
    min-height: 40px;
  }

  .perm.phone .link {
    min-height: 32px;
  }

  @media (pointer: coarse) {
    .perm-actions .btn {
      min-height: 40px;
    }

    .link {
      min-height: 32px;
    }
  }
</style>
