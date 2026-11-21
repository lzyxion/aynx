<script lang="ts">
  // 작업안 진행 보기 — 검토 대기 카드와 실행 묶음(`ExecList`). 카드의 조각 · 승인 판정(`approveStep`)은 검토 카드(`ReviewCard`)와 같다.
  import { expiryLabel, type Operation } from "$lib/operations";
  import { approvalRisk, approveStep, hasFoldedDetail, reasonShown, splitLines, verdictOf } from "$lib/review-card";
  import AiNote from "$lib/AiNote.svelte";
  import CommandClamp from "$lib/CommandClamp.svelte";
  import CommandLines from "$lib/CommandLines.svelte";
  import ReviewMeta from "$lib/ReviewMeta.svelte";
  import VerdictBand from "$lib/VerdictBand.svelte";
  import AiSummaryLine from "$lib/AiSummaryLine.svelte";
  import AnalysisChips from "$lib/AnalysisChips.svelte";
  import { autoRefusals } from "$lib/app/pending-plans.svelte.js";
  import type { OpsController } from "$lib/console/ops-controller.svelte";
  import ExecList from "$lib/console/ExecList.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    ops: OpsController;
    targetLookup: Map<string, { code: string; label: string }>;
    /** 30초 경과 시계 — 만료까지 남은 분을 따라 내린다 */
    now: number;
    /** 딥링크로 지금 맥박이 뛰는 카드 id */
    pulsing: string | null;
  }
  let { ops, targetLookup, now, pulsing }: Props = $props();

  /** 보안: 승인은 명령 전문이 보이는 자리에서만 — 잘린 채 펼치지 않았으면 [실행 승인] 의 첫 누름은 펼치기다(`approveStep`) */
  let truncated = $state<Record<string, boolean>>({});
  let revealHint = $state<Record<string, boolean>>({});

  /** 명령 나눠 보기(`splitLines`)는 숨는 것이 없어 늘 거짓이다 */
  function hidden(op: Operation): boolean {
    const id = op.operationId;
    return splitLines(op) === null && truncated[id] === true && !ops.expandedCmds.has(id);
  }

  /** 위험이면 확인 상태가 펼치기를 겸한다 — 두 번을 넘지 않는다 */
  function approve(op: Operation, risk: "safe" | "dangerous"): void {
    const id = op.operationId;
    const step = approveStep({ hidden: hidden(op), risky: risk === "dangerous", armed: ops.confirming === id });
    if (step === "reveal") {
      if (!ops.expandedCmds.has(id)) ops.toggleCmd(id);
      revealHint = { ...revealHint, [id]: true };
      return;
    }
    if (step === "arm") {
      if (truncated[id] === true && !ops.expandedCmds.has(id)) ops.toggleCmd(id);
      revealHint = { ...revealHint, [id]: false };
      ops.arm(id);
      return;
    }
    revealHint = { ...revealHint, [id]: false };
    void ops.doApprove(op);
  }
</script>

{#if ops.operations.length === 0 && ops.execList.length === 0}
  <p class="empty">{t("board.plan.empty")}</p>
{:else}
  <div class="opsview">
    {#if ops.operations.length > 0}
      <section class="block" aria-labelledby="ops-pending-h">
        <h3 class="heading" id="ops-pending-h">
          {t("board.plan.heading")}<span class="count">{ops.operations.length}</span>
        </h3>
        <ul class="ops">
                    {#each ops.operations as op (op.operationId)}
            {@const risk = approvalRisk(op)}
            {@const armed = ops.confirming === op.operationId}
            {@const shown = ops.expandedCmds.has(op.operationId)}
            <!-- `{@const}` 는 블록의 첫 자식이어야 해서 카드 앞에 선다 -->
            {@const left = expiryLabel(op.expiresAt, now)}
            {@const split = splitLines(op)}
            <!-- 키보드 첫 자리(`ChatDock` 의 `focusHome`)는 카드 자신이다 — [승인] 단추가 아니어서 Enter 한 번에 승인되지 않는다 -->
            <li
              class="op"
              class:danger={risk === "dangerous"}
              class:pulse={pulsing === op.operationId}
              data-operation-id={op.operationId}
              data-plan-pending
              tabindex="-1"
            >
              <VerdictBand verdict={verdictOf(op, risk)}>
                {#snippet end()}
                  <span class="oexpiry" title={t("board.plan.expires.title")}
                    >{left === null
                      ? t("board.plan.expires.none")
                      : t("board.plan.expires", { n: left.minutes })}</span
                  >
                {/snippet}
              </VerdictBand>
              {#if op.title}
                <span class="otitle">{op.title}</span>
              {/if}
              <AiSummaryLine operationId={op.operationId} summary={op.summary} />
              {#if split}
                <CommandLines
                  operationId={op.operationId}
                  command={op.command}
                  lines={split}
                  reason={op.reason}
                  maxRows={16}
                />
              {:else}
                <div class="ohead">
                  <CommandClamp
                    text={op.command}
                    lang={op.db ? "sql" : null}
                    expanded={shown}
                    more={hasFoldedDetail(op)}
                    expandedLines={16}
                    onToggle={() => ops.toggleCmd(op.operationId)}
                    onTruncated={(v) => {
                      if (truncated[op.operationId] !== v) truncated = { ...truncated, [op.operationId]: v };
                    }}
                  />
                </div>
                <AiNote label={t("app.review.reason.label")} text={reasonShown(op, shown)} />
              {/if}
              {#if op.db}
                <AnalysisChips {op} only={split ? ["limit"] : ["stmt", "limit"]} />
              {/if}
              <ReviewMeta
                {op}
                {targetLookup}
                autoRefused={autoRefusals().get(op.operationId) ?? null}
                targets={!op.db}
              >
                {#snippet extra()}
                  {#if op.db}
                    <span class="mi" title={t("app.review.db.tx")}
                      >{t("app.review.db.max", { n: op.db.maxAffected, count: op.db.statements.length })}</span
                    >
                  {/if}
                  <span class="mi" title={t("board.plan.timeout.title")}>⏱ {op.timeoutSeconds}s</span>
                {/snippet}
              </ReviewMeta>
              {#if revealHint[op.operationId]}
                <p class="reveal" data-reveal-hint>{t("app.review.cmd.revealHint")}</p>
              {/if}
              {#if armed}
                <p class="armwarn" data-plan-armed>{t("board.confirm.warn")}</p>
              {/if}
              <div class="obtns">
                <button
                  type="button"
                  class="btn btn-ghost reject danger-text"
                  onclick={() => ops.reject(op.operationId)}>{t("board.plan.reject")}</button
                >
                {#if risk === "dangerous"}
                  <button
                    type="button"
                    class="btn approve {armed ? 'danger-solid' : 'danger-outline'}"
                    title={t(armed ? "app.review.approve.danger.title" : "app.review.approve.arm.title")}
                    data-plan-approve
                    onclick={() => approve(op, risk)}
                    >{armed ? t("app.review.approve.danger") : t("app.review.approve")}</button
                  >
                {:else}
                  <button
                    type="button"
                    class="btn approve {ops.primaryOpId === op.operationId ? 'btn-primary' : 'btn-secondary'}"
                    data-plan-approve
                    onclick={() => approve(op, risk)}>{t("app.review.approve")}</button
                  >
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if ops.execList.length > 0}
      <ExecList {ops} {targetLookup} {now} {pulsing} />
    {/if}
  </div>
{/if}

<style>
  .empty {
    margin: 0;
    padding: var(--space-4) 0;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /* 카드 뼈대는 `ExecList.svelte` 에 베껴 두었다(같은 면) — 한쪽을 고치면 다른 쪽도 본다 */
  .opsview {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-1) 0 var(--space-6);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) 2px 0;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
    color: var(--fg-2);
  }

  .count {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    font-size: 11px;
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    background: var(--control-bg);
    border-radius: 999px;
  }

  .ops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .op {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--control-tile-bg);
    border-radius: var(--radius-surface-inner);
  }

  .op:focus {
    outline: none;
  }
  .op:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* 안쪽 그림자라 카드 크기가 흔들리지 않는다 */
  .op.danger {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--err) 40%, transparent);
  }

  /* 메타 줄(`ReviewMeta` — 검토 카드와 공유)을 이 타일에서만 알약 칩으로 — 검토 카드의 한 줄은 그대로다 */
  .op :global([data-review-meta]) {
    gap: 6px;
    align-items: center;
  }
  .op :global([data-review-meta] > .mi) {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 10px;
    line-height: 1.4;
    color: var(--fg-2);
    background: var(--control-bg);
    border-radius: 999px;
  }
  .op :global([data-review-meta] > .mi + .mi)::before {
    content: none;
  }

  /* 판결 띠는 카드 가장자리까지 — 둥근 모서리는 카드의 `overflow: hidden` 이 자른다 */
  .op {
    overflow: hidden;
  }
  .op > :global(.vband) {
    margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-4)) 0;
    padding-inline: var(--space-4);
  }

  /* 공유 조각(`CommandClamp` · `CommandLines`)의 우물도 이 타일에서만 */
  .op :global(.cmd),
  .op :global(.box) {
    border-color: transparent;
    border-radius: 12px;
  }

  /* 움직임을 줄여 달라고 한 사람에게는 깜박임 대신 그냥 켜 둔다 */
  .op.pulse {
    animation: op-pulse 1.2s ease-out 1;
  }
  @keyframes op-pulse {
    0%,
    60% {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    100% {
      outline: 2px solid transparent;
      outline-offset: 2px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .op.pulse {
      animation: none;
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
  }

  .otitle {
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }

  .oexpiry {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .ohead {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }

  .reveal {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--warn);
  }

  /* `.btn-*` 호버가 글자를 본문색으로 되돌리므로 여기서 잡는다(`ExecList` 가 같은 규칙을 베껴 둔다) */
  .btn.danger-text,
  .btn.danger-text:hover {
    color: var(--err);
  }

  .armwarn {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--err);
    background: var(--err-soft);
    border-radius: 12px;
  }

  .obtns {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* 위험 명령은 강조색으로 권하지 않는다 */
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
</style>
