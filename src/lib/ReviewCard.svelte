<script lang="ts">
  /**
   * 화면 아래 가운데 검토 대기 카드 — 그 자리에서 승인 · 거절을 받는다 (docs/log/2026-09-27-review-popup-card.md).
   *
   * 원칙 "승인은 명령 전문이 보이는 자리에서만" — 잘린 채 펼치지 않은 카드의 첫 [승인]은 펼치기다(`approveStep`).
   * AI 가 쓴 설명은 믿지 않는 글자라 `AI` 표지 없이 그리지 않는다.
   * "승인하면서 자동 승인 목록에 추가" 는 두지 않는다 — 목록을 넓히는 것은 규칙을 미리 보고 내릴 별개의 결정이라 관제판에만.
   *
   * 포커스를 절대 뺏지 않는다(보안) — 터미널에 치던 Enter 가 [승인]에 닿으면 보지도 않은 작업안이 승인된다:
   * 1. autofocus 도, 나타날 때 · 바뀔 때의 `focus()` 도 없다.
   * 2. 마우스로 눌러도 포커스가 옮겨 오지 않는다(`keepFocus`).
   * 3. 탭으로 들어와 승인 · 거절하면 곧바로 포커스를 놓는다(`dropFocus`) — 다음 작업안이 같은 자리에 들어앉는다.
   * 4. 카드는 창 키 표(`app/keys`)에 어떤 자리도 없다.
   *
   * `.body` 안 아래 가운데에 두어 상태바 높이를 숫자로 적지 않는다. z-index 95 — 독 · 모달(100) · 접속 대화가 덮는다.
   * 가림막 아래에서는 서지 않는다 — 대기 수는 `Veil.svelte` 가 그린다.
   * 분리(`tear-*`) 창에서는 뜨지 않는다 — `startPendingPlans()` 는 메인 창 · 원격 창에서만 건다.
   */
  import {
    autoRefusals,
    pendingPlans,
    refreshPendingPlans,
  } from "$lib/app/pending-plans.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { openPlansAt, plansShown } from "$lib/app/plans.svelte.js";
  import { showNotice } from "$lib/app/notice";
  import { approveOperation, rejectOperation } from "$lib/operations";
  import { approveStep, hasFoldedDetail, reasonShown, reviewCardModel, splitLines } from "$lib/review-card";
  import AiNote from "$lib/AiNote.svelte";
  import AiSummaryLine from "$lib/AiSummaryLine.svelte";
  import AnalysisChips from "$lib/AnalysisChips.svelte";
  import CommandClamp from "$lib/CommandClamp.svelte";
  import CommandLines from "$lib/CommandLines.svelte";
  import ReviewMeta from "$lib/ReviewMeta.svelte";
  import VerdictBand from "$lib/VerdictBand.svelte";
  import { windowTargetLookup } from "$lib/console/window-rows";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { DB_ENGINE_ICON, type DbEngine } from "$lib/db-conn";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  const TICK_MS = 30_000;
  let now = $state(Date.now());

  /** id 로 쥔다 — 자리 번호면 앞의 것이 빠질 때 다른 작업안이 그 자리에 들어앉는다. `null` = 맨 앞 */
  let selectedId = $state<string | null>(null);

  /**
   * [나중에]로 치운 작업안 id — 누른 순간의 대기를 모두 담는다(한 건만 치우면 다음 건이 곧바로 같은 자리에 뜬다).
   * 새 작업안은 여기 없으므로 카드가 다시 선다. 저장하지 않는다.
   */
  let deferred = $state<ReadonlySet<string>>(new Set());
  const shownPlans = $derived(pendingPlans().filter((o) => !deferred.has(o.operationId)));

  /** 작업안이 보이는 동안에는 물러난다 — 같은 작업안의 승인 단추가 한 화면에 두 벌이면 헷갈린다 */
  const model = $derived(
    plansShown()
      ? ({ kind: "hidden" } as const)
      : reviewCardModel(shownPlans, veilVisible(), now, autoRefusals(), selectedId, (id) => findDbConn(id)?.via),
  );

  function engineName(engine: string): string {
    return ["sqlite", "postgres", "mysql", "mariadb"].includes(engine)
      ? t(`app.query.engine.${engine}` as "app.query.engine.sqlite")
      : engine;
  }

  // 시계는 불리언 하나에 건다 — `model` 에 걸면 `now` 를 쓰는 순간 제 효과를 다시 깨워 틱마다 인터벌을 새로 건다.
  const showingCard = $derived(model.kind === "card");
  $effect(() => {
    if (!showingCard) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), TICK_MS);
    return () => clearInterval(id);
  });

  /** 영구 닫기는 없다. 머리 작업안이 바뀌면 다시 펴진다 — 새 요청은 한 번은 보여야 한다 */
  let collapsed = $state(false);
  let lastHead = $state<string | null>(null);
  $effect(() => {
    const id = model.kind === "card" ? model.headId : null;
    if (id === lastHead) return;
    lastHead = id;
    collapsed = false;
  });

  /** 위험 명령의 [승인]을 한 번 누른 작업안 id — 보이는 것이 조금이라도 바뀌면 풀린다(다른 것을 확인한 셈이 된다) */
  let armedId = $state<string | null>(null);
  const armed = $derived(model.kind === "card" && armedId === model.op.operationId);

  const split = $derived(model.kind === "card" ? splitLines(model.op) : null);

  let cmdExpanded = $state(false);
  let cmdTruncated = $state(false);
  let revealHint = $state(false);

  /** 원시값으로 묶는다 — `model` 은 시계 · 목록 갱신마다 새 객체라 거기 걸면 아무것도 안 바뀌어도 확인이 풀린다 */
  const viewKey = $derived(model.kind === "card" ? `${model.headId}|${model.op.operationId}` : null);

  $effect(() => {
    void viewKey;
    armedId = null;
    cmdExpanded = false;
    cmdTruncated = false;
    revealHint = false;
  });

  $effect(() => {
    if (selectedId !== null && !shownPlans.some((o) => o.operationId === selectedId)) {
      selectedId = null;
    }
  });

  $effect(() => {
    if (deferred.size === 0) return;
    const live = new Set(pendingPlans().map((o) => o.operationId));
    if ([...deferred].some((id) => !live.has(id))) {
      deferred = new Set([...deferred].filter((id) => live.has(id)));
    }
  });

  function later(): void {
    armedId = null;
    dropFocus();
    deferred = new Set([...deferred, ...pendingPlans().map((o) => o.operationId)]);
  }

  let busy = $state(false);

  const targetLookup = $derived(windowTargetLookup(t));

  let root = $state<HTMLElement | null>(null);

  function expiryText(minutes: number | null): string {
    if (minutes === null) return t("app.review.expires.none");
    if (minutes <= 0) return t("app.review.expires.soon");
    return t("app.review.expires", { n: minutes });
  }

  function step(delta: number): void {
    if (model.kind !== "card") return;
    const list = shownPlans;
    const next = model.index + delta;
    if (next < 0 || next >= list.length) return;
    selectedId = list[next].operationId;
  }

  /** 단추 위에서만 막는다 — 명령 상자는 글자를 긁어 복사하는 자리다 */
  function keepFocus(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    if ((ev.target as Element | null)?.closest("button")) ev.preventDefault();
  }

  function dropFocus(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && root?.contains(el)) el.blur();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation(); // 창의 Escape 사슬(다른 모달·독 닫기)로 새지 않게
    armedId = null;
    dropFocus();
  }

  async function approve(): Promise<void> {
    if (model.kind !== "card" || busy) return;
    const { op, risk } = model;
    const step = approveStep({
      // 나눠 보기 · 원문 보기는 전문을 다 싣는다(안에서 스크롤) — 잘린 것이 없다.
      hidden: split === null && cmdTruncated && !cmdExpanded,
      risky: risk === "dangerous",
      armed: armedId === op.operationId,
    });
    if (step === "reveal") {
      cmdExpanded = true;
      revealHint = true;
      return;
    }
    if (step === "arm") {
      // 확인 상태가 펼치기를 겸한다. 잘리지 않았으면 펼치지 않는다 — 쓸모없는 [접기] 줄만 선다.
      if (cmdTruncated) cmdExpanded = true;
      armedId = op.operationId;
      revealHint = false;
      return;
    }
    revealHint = false;
    busy = true;
    armedId = null;
    dropFocus();
    try {
      const r = await approveOperation(op.operationId, "manual");
      if (r.error) showNotice(t("board.notice.rejected", { reason: r.error }));
      await refreshPendingPlans();
    } finally {
      busy = false;
    }
  }

  async function reject(): Promise<void> {
    if (model.kind !== "card" || busy) return;
    const id = model.op.operationId;
    busy = true;
    armedId = null;
    dropFocus();
    try {
      const ok = await rejectOperation(id);
      if (ok === null) showNotice(t("app.review.reject.failed"));
      await refreshPendingPlans();
    } finally {
      busy = false;
    }
  }

  function collapse(): void {
    armedId = null;
    collapsed = true;
  }
</script>

<!-- `aria-live="off"` — 30초마다 바뀌는 만료 문구 때문에 살아 있는 영역이면 스크린리더가 틱마다 명령문까지 다시 읽는다 -->{#if model.kind === "card"}
  {@const op = model.op}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="rcard"
    class:danger={model.risk === "dangerous"}
    role="group"
    aria-live="off"
    aria-label={t("app.review.label")}
    bind:this={root}
    onmousedown={keepFocus}
    onkeydown={onKeydown}
  >
    {#if collapsed}
      <div class="line">
        <span class="dot" aria-hidden="true">●</span>
        <span class="count">{t("app.review.count", { n: model.total })}</span>
        <button
          type="button"
          class="expand btn btn-ghost btn-sm"
          title={t("app.review.expand")}
          onclick={() => (collapsed = false)}>{t("app.review.expand")}</button
        >
      </div>
    {:else}
      <VerdictBand verdict={model.verdict}>
        {#snippet end()}
          {#if model.total > 1}
            <span class="nav">
              <button
                type="button"
                class="navbtn"
                aria-label={t("app.review.prev")}
                title={t("app.review.prev")}
                disabled={model.index === 0}
                onclick={() => step(-1)}
                ><UiIcon name="chevron-left" size={13} /></button
              >
              <span class="pos">{t("app.review.position", { i: model.index + 1, n: model.total })}</span>
              <button
                type="button"
                class="navbtn"
                aria-label={t("app.review.next")}
                title={t("app.review.next")}
                disabled={model.index >= model.total - 1}
                onclick={() => step(1)}><UiIcon name="chevron" size={13} /></button
              >
            </span>
          {/if}
          <span class="expiry" class:soon={model.expiryMinutes !== null && model.expiryMinutes <= 0}
            >{expiryText(model.expiryMinutes)}</span
          >
          <button
            type="button"
            class="chev"
            aria-label={t("app.review.collapse")}
            title={t("app.review.collapse")}
            onclick={collapse}><UiIcon name="chevron-down" size={13} /></button
          >
        {/snippet}
      </VerdictBand>

      <div class="scroll">
        {#if op.title}
          <div class="title">{op.title}</div>
        {/if}

        <AiSummaryLine operationId={op.operationId} summary={op.summary} />

        {#if model.db}
          {@const d = model.db}
          <!-- 문장 전문이 보이는 상자가 있어서 승인 단추가 선다 — 셸 명령과 같은 원칙 -->
          <div class="dbhead" data-review-db={d.engine}>
            {#if d.engine in DB_ENGINE_ICON}
              <HostIcon icon={DB_ENGINE_ICON[d.engine as DbEngine]} size={14} label={engineName(d.engine)} />
            {:else}
              <UiIcon name="database" size={13} />
            {/if}
            <span class="dbname">{d.connName}</span>
            <span class="dbmeta"
              >{engineName(d.engine)}{#if d.database}&nbsp;· {d.database}{/if}{#if d.via}&nbsp;· {t("app.review.db.via", {
                  host: d.via,
                })}{/if}</span
            >
          </div>
          {#if split}
            <CommandLines operationId={op.operationId} command={op.command} lines={split} reason={op.reason} maxRows={16} />
            <AnalysisChips {op} only={["limit"]} />
          {:else}
            <CommandClamp
              text={d.sql}
              lang="sql"
              more={hasFoldedDetail(op)}
              expanded={cmdExpanded}
              onToggle={() => (cmdExpanded = !cmdExpanded)}
              onTruncated={(v) => (cmdTruncated = v)}
            />
            <AiNote label={t("app.review.reason.label")} text={reasonShown(op, cmdExpanded)} />
            <AnalysisChips {op} only={["stmt", "limit"]} />
          {/if}
        {:else if split}
          <CommandLines operationId={op.operationId} command={op.command} lines={split} reason={op.reason} maxRows={16} />
        {:else}
          <CommandClamp
            text={op.command}
            more={hasFoldedDetail(op)}
            expanded={cmdExpanded}
            onToggle={() => (cmdExpanded = !cmdExpanded)}
            onTruncated={(v) => (cmdTruncated = v)}
          />
          <AiNote label={t("app.review.reason.label")} text={reasonShown(op, cmdExpanded)} />
        {/if}

        <ReviewMeta {op} {targetLookup} autoRefused={model.autoRefused} targets={model.db === null} />

        {#if model.db}
          {@const d = model.db}
          <div class="meta">
            {#if !op.analysis}
              <!-- 분석이 있으면 상한은 문장 칩 줄이 말한다 -->
              <span class="metaline" data-review-db-max={d.maxAffected}
                >{t("app.review.db.max", { n: d.maxAffected, count: d.statementCount })}</span
              >
            {/if}
            <span class="metaline">{t("app.review.db.tx")}</span>
            {#if d.uncounted > 0}
              <span class="metaline warnline">{t("app.review.db.uncounted", { n: d.uncounted })}</span>
            {/if}
          </div>
        {/if}

        {#if revealHint}
          <p class="warn" data-reveal-hint>{t("app.review.cmd.revealHint")}</p>
        {/if}
        {#if armed}
          <p class="warn">{t("board.confirm.warn")}</p>
        {/if}
      </div>

      <div class="line foot">
        <button
          type="button"
          class="link"
          onclick={() => openPlansAt(op.operationId)}>{t("app.review.plans")}</button
        >
        <button
          type="button"
          class="later btn btn-ghost btn-sm"
          title={t("app.review.later.title")}
          data-review-later
          onclick={later}>{t("app.review.later")}</button
        >
        <button
          type="button"
          class="reject btn btn-ghost btn-sm"
          disabled={busy}
          onclick={() => void reject()}>{t("app.review.reject")}</button
        >
        {#if model.risk === "dangerous"}
          <button
            type="button"
            class="approve btn btn-sm {armed ? 'danger-solid' : 'danger-outline'}"
            title={t(armed ? "app.review.approve.danger.title" : "app.review.approve.arm.title")}
            disabled={busy}
            onclick={() => void approve()}
            >{armed ? t("app.review.approve.danger") : t("app.review.approve")}</button
          >
        {:else}
          <button
            type="button"
            class="approve btn btn-primary btn-sm"
            disabled={busy}
            onclick={() => void approve()}>{t("app.review.approve")}</button
          >
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* `overflow: hidden` 은 음수 여백으로 붙은 판결 띠가 둥근 모서리까지 닿게 하려는 것이다 */
  .rcard {
    position: absolute;
    left: 50%;
    bottom: var(--space-3);
    z-index: 95;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 2 * var(--space-3));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
  }

  .rcard > :global(.vband) {
    flex: none;
    margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-3)) 0;
  }

  /* 테두리만 — 배경까지 물들이면 명령 글자 대비가 흔들린다 */
  .rcard.danger {
    border-color: color-mix(in srgb, var(--err) 45%, var(--line-strong));
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .pos {
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .dbhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .dbname {
    font-weight: var(--fw-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dbmeta {
    color: var(--fg-2);
    font-size: var(--t-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warnline {
    color: var(--warn);
  }

  .expiry {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }
  .expiry.soon {
    color: var(--warn);
  }

  .dot {
    flex: none;
    color: var(--warn);
  }

  .scroll {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    overflow-y: auto;
    user-select: text;
  }

  .title {
    min-width: 0;
    font-weight: var(--fw-semibold);
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  .metaline {
    overflow-wrap: anywhere;
  }

  .warn {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--err);
  }

  .foot .later {
    margin-left: auto;
  }

  @media (pointer: coarse) {
    .foot .later,
    .foot .reject,
    .foot .approve,
    .foot .link {
      min-height: 44px;
      padding-inline: 16px;
      font-size: var(--t-md, 14px);
    }
  }
  :global(.app.mobile) .rcard {
    width: calc(100% - 16px);
    bottom: 8px;
  }
  :global(.app.mobile) .foot .later,
  :global(.app.mobile) .foot .reject,
  :global(.app.mobile) .foot .approve {
    min-height: 44px;
    padding-inline: 16px;
  }
  .later,
  .reject,
  .approve,
  .expand {
    flex: none;
  }
  .expand {
    margin-left: auto;
  }

  /* 관제판 `.btn.danger-solid` 는 스코프돼 있어 여기 따로 둔다 */
  .btn.danger-outline,
  .btn.danger-outline:hover {
    color: var(--err);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--err);
  }
  .btn.danger-outline:hover {
    background: color-mix(in srgb, var(--err) 10%, transparent);
  }
  .btn.danger-solid {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }
  .btn.danger-solid:hover {
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }

  .link {
    flex: none;
    padding: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    background: transparent;
    border: 0;
    cursor: pointer;
    text-underline-offset: 2px;
  }
  .link:hover {
    color: var(--fg-1);
    text-decoration: underline;
  }

  .chev,
  .navbtn {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .chev:hover,
  .navbtn:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--surface-hover);
  }
  .navbtn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
