<script lang="ts">
  // 작업안 목록 보기의 실행 묶음 — 실행 뷰 상태와 취소(Tauri 명령)는 `ops-controller` 에 있다. 완료된 실행은 한 줄로 접힌다.
  import type { OperationState } from "$lib/operations";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";
  import { commandPreview } from "$lib/command-preview";
  import { EXEC_ACTIVE, TARGET_LABEL, type OpsController } from "$lib/console/ops-controller.svelte";
  import { opStateKind, targetKind, type StateKind } from "$lib/console/exec-rows";
  import { relativeTime } from "$lib/notifications";
  import UiIcon from "$lib/UiIcon.svelte";
  import { EXIT_WINDOW_MS, makeRowExit } from "$lib/row-exit";
  import { EXEC_SORTS, setExecSort, settings } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  interface Props {
    ops: OpsController;
    targetLookup: Map<string, { code: string; label: string }>;
    now: number;
    /** 딥링크로 지금 맥박이 뛰는 카드 id */
    pulsing: string | null;
  }
  let { ops, targetLookup, now, pulsing }: Props = $props();

  function isActive(state: OperationState): boolean {
    return EXEC_ACTIVE.has(state);
  }

  /** `|global` 이다 — 묶음이 통째로 내려가도 움직임이 돌게. 지우기 직후가 아니면 문이 닫혀 곧바로 빠진다 */
  const rowExit = makeRowExit(
    () => ops.exitSide,
    () => Date.now() - ops.lastDismissAt < EXIT_WINDOW_MS,
  );

  function rowTitle(ex: (typeof ops.execList)[number]): string {
    if (!ex.op) return t("board.exec.external");
    return ex.op.title || commandPreview(ex.op.command, { maxLines: 1, maxChars: 80 }).text;
  }

  const OP_STATE_LABEL: Partial<Record<OperationState, Key>> = {
    approved: "board.exec.state.approved",
    running: "board.exec.state.running",
    succeeded: "board.exec.state.succeeded",
    partial: "board.exec.state.partial",
    failed: "board.exec.state.failed",
    cancelled: "board.exec.state.cancelled",
  };

  /** 다른 창이 시작한 실행이면 전체는 지금까지 밀려 온 대상 수다 */
  function progressOf(ex: (typeof ops.execList)[number]): { done: number; total: number } {
    const rows = Object.values(ex.targets);
    const total = Math.max(ex.op?.targets.length ?? 0, rows.length);
    const done = rows.filter((r) => r.state !== "pending" && r.state !== "running").length;
    return { done, total };
  }

  /** 모르는 상태(사전에 칸이 없는 새 상태)는 원문 그대로 */
  function opStateLabel(state: OperationState): string {
    const key = OP_STATE_LABEL[state];
    return key ? t(key) : state;
  }
</script>

{#snippet glyph(kind: StateKind)}
  {#if kind === "run"}
    <span class="spin" aria-hidden="true"></span>
  {:else if kind === "ok"}
    <span class="gl" aria-hidden="true"><UiIcon name="check" size={11} /></span>
  {:else if kind === "warn"}
    <span class="gl" aria-hidden="true"
      ><svg viewBox="0 0 12 12" width="11" height="11"
        ><path d="M6 2.2v4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none" /><circle
          cx="6"
          cy="9.6"
          r="1.1"
          fill="currentColor"
        /></svg
      ></span
    >
  {:else if kind === "err"}
    <span class="gl" aria-hidden="true"><UiIcon name="close" size={11} /></span>
  {/if}
{/snippet}

{#snippet command(ex: (typeof ops.execList)[number])}
  <div class="ohead">
    {#if ex.op}
      {@const prev = commandPreview(ex.op.command)}
      {@const shown = ops.expandedCmds.has(ex.id)}
      {#if shown}
        <div class="cmdbox"><pre class="ocmd">{ex.op.command}</pre></div>
      {:else}
        <pre class="ocmd" title={prev.truncated ? undefined : ex.op.command}>{prev.text}</pre>
      {/if}
      {#if prev.truncated}
        <button type="button" class="btn btn-ghost btn-sm cmdmore" onclick={() => ops.toggleCmd(ex.id)}>
          {shown ? t("board.cmd.collapse") : t("board.cmd.expand", { chars: prev.chars, lines: prev.lines })}
        </button>
      {/if}
    {:else}
      <p class="oexternal">{t("board.exec.external")}</p>
    {/if}
  </div>
{/snippet}

{#snippet matrix(ex: (typeof ops.execList)[number])}
  <ul class="matrix">
    {#each Object.entries(ex.targets) as [streamId, r] (streamId)}
      {@const info = targetLookup.get(streamId)}
      {@const tk = targetKind(r.state)}
      <li class="mrow">
        {#if r.state === "failed" || r.state === "timedOut"}<ErrorGlyph size={10} data-tdot={r.state} aria-hidden="true" />{:else}<span
            class="tdot {r.state}"
            aria-hidden="true"
          ></span>{/if}
        <span class="who"
          ><span class="chip-code">{info?.code ?? streamId}</span>{#if info}<span class="mlabel" title={info.label}
              >{info.label}</span
            >{/if}</span
        >
        <span class="tbadge {tk}" data-target-state={r.state}
          >{#if tk === "run"}<span class="spin" aria-hidden="true"></span>{/if}{t(TARGET_LABEL[r.state])}</span
        >
        <span class="exit" class:bad={r.exitCode !== null && r.exitCode !== 0} title={t("board.exec.exit.title")}
          >{r.exitCode ?? ""}</span
        >
        {#if r.errorClass}
          <span class="eclass" title={r.errorClass}>{r.errorClass}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<section class="block" aria-labelledby="ops-exec-h">
  <div class="heading-row">
    <h3 class="heading" id="ops-exec-h">
      {t("board.exec.heading")}<span class="count">{ops.execList.length}</span>
    </h3>
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      title={t(EXEC_SORTS[settings.execSort])}
      aria-label={t(EXEC_SORTS[settings.execSort])}
      aria-pressed={settings.execSort === "oldest"}
      data-exec-sort={settings.execSort}
      onclick={() => setExecSort(settings.execSort === "oldest" ? "newest" : "oldest")}
      ><UiIcon name={settings.execSort === "oldest" ? "sort-oldest" : "sort-newest"} size={14} /></button
    >
  </div>
  <ul class="ops">
    {#each ops.execList as ex (ex.id)}
      {@const active = isActive(ex.state)}
      {@const prog = progressOf(ex)}
      {@const kind = opStateKind(ex.state)}
      {#if !active}
        {@const open = ops.expandedExecs.has(ex.id)}
        {@const at = ex.op ? (ex.op.requestedAt ?? ex.op.createdAt) : null}
        <li class="op row" class:open class:pulse={pulsing === ex.id} data-operation-id={ex.id} data-exec-row out:rowExit|global>
          <div class="rline">
            <button type="button" class="rtoggle" aria-expanded={open} onclick={() => ops.toggleExec(ex.id)}>
              <span class="chev" class:open aria-hidden="true"><UiIcon name="chevron" size={14} /></span>
              <span class="rtitle" title={rowTitle(ex)}>{rowTitle(ex)}</span>
              <span class="ostate {kind}" data-exec-state={ex.state}>{@render glyph(kind)}{opStateLabel(ex.state)}</span>
              {#if at !== null}<span class="rtime">{relativeTime(at, now, t)}</span>{/if}
            </button>
            <button
              type="button"
              class="rdismiss"
              aria-label={t("board.exec.dismiss")}
              title={t("board.exec.dismiss.title")}
              onclick={() => ops.dismissExec(ex.id)}><UiIcon name="close" size={14} /></button
            >
          </div>
          {#if open}
            <div class="rbody">
              {@render command(ex)}
              {@render matrix(ex)}
            </div>
          {/if}
        </li>
      {:else}
      <li
        class="op exec"
        class:active
        class:pulse={pulsing === ex.id}
        data-operation-id={ex.id}
      >
        <div class="otop">
          <span class="otitle" title={ex.op?.title ?? undefined}>{ex.op?.title ?? ""}</span>
          <span class="ostate {kind}" data-exec-state={ex.state}
            >{@render glyph(kind)}{opStateLabel(ex.state)}{#if prog.total > 0}<span class="oprog"
                >{prog.done}/{prog.total}</span
              >{/if}</span
          >
        </div>
        {#if active && prog.total > 0}
          <div class="obar" aria-hidden="true">
            <span style:width="{Math.round((prog.done / prog.total) * 100)}%"></span>
          </div>
        {/if}
        {@render command(ex)}
        {@render matrix(ex)}
        <div class="obtns">
          <button
            type="button"
            class="btn btn-ghost btn-sm cancel danger-text"
            title={t("board.exec.cancel.title")}
            onclick={() => ops.cancelExec(ex.id)}>{t("board.exec.cancel")}</button
          >
        </div>
      </li>
      {/if}
    {/each}
  </ul>
</section>

<style>
  /* 카드 뼈대는 `PlanList.svelte` 의 검토 대기 카드와 같은 면을 베껴 둔다(스코프) — 한쪽을 고치면 다른 쪽도 본다 */
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
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--control-tile-bg);
    border-radius: var(--radius-surface-inner);
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

  .otop {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 24px;
    min-width: 0;
  }

  .otitle {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .obar {
    height: 4px;
    overflow: hidden;
    background: var(--control-bg);
    border-radius: 999px;
  }

  .obar span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 200ms ease;
  }

  .heading-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .heading-row .heading {
    flex: 1 1 auto;
  }

  .rtoggle:focus-visible,
  .rdismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* ── 완료된 실행의 한 줄 ── */
  .op.row {
    gap: 0;
    padding: 0;
  }

  .rline {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-1);
  }

  .rtoggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    padding: 0 var(--space-1) 0 var(--space-3);
    font-family: var(--font-ui);
    color: var(--fg-1);
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-surface-inner);
    cursor: pointer;
  }

  .chev {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--fg-3);
    transition: transform 160ms ease;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }

  .rtitle {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rtime {
    flex: 0 0 auto;
    min-width: 4.5em;
    text-align: right;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  .rdismiss {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .rdismiss:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .rbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3);
  }

  .obtns {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .ohead {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .ocmd {
    align-self: stretch;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-base);
    border-radius: 12px;
  }

  /* 카드가 무한정 자라지 않게 240px 에서 멈춘다 */
  .cmdbox {
    align-self: stretch;
    max-height: 240px;
    overflow: auto;
    background: var(--bg-base);
    border-radius: 12px;
  }

  .cmdbox .ocmd {
    background: transparent;
    border: none;
  }

  .cmdmore {
    margin-left: calc(-1 * var(--space-2));
  }

  .oexternal {
    margin: 0;
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  /* `.btn-*` 호버가 글자를 본문색으로 되돌리므로 여기서 잡는다 */
  .btn.danger-text,
  .btn.danger-text:hover {
    color: var(--err);
  }

  .chip-code {
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .exit {
    text-align: right;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  .exit.bad {
    color: var(--err);
    font-weight: var(--fw-semibold);
  }

  /* ── 실행 뷰 — 상태 알약 · 결과 줄 ── 알약 면은 `exec-rows.ts` 머리말 */
  .ostate {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 22px;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
    white-space: nowrap;
  }

  .oprog {
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
  }

  .gl {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .spin {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1.75px solid color-mix(in srgb, var(--accent) 28%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: exec-spin 1s linear infinite;
  }
  @keyframes exec-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  .ostate.run,
  .tbadge.run {
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
  }
  .ostate.ok,
  .tbadge.ok {
    color: var(--on-ok-soft);
    background: var(--ok-soft);
  }
  .ostate.warn,
  .tbadge.warn {
    color: var(--on-warn-soft);
    background: var(--warn-soft);
  }
  .ostate.err,
  .tbadge.err {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }
  .ostate.cancelled,
  .tbadge.cancelled {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--m3-outline-variant);
  }
  .ostate.unknown,
  .tbadge.unknown {
    color: var(--warn);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--warn);
  }

  .matrix {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mrow {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto 3.5ch;
    align-items: center;
    column-gap: var(--space-3);
    min-height: 28px;
    font-size: var(--t-sm);
  }

  .who {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .mlabel {
    min-width: 0;
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tdot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .tdot.running {
    background: transparent;
    border: 1.5px solid var(--accent);
  }
  .tdot.succeeded {
    background: var(--ok);
  }
  .tdot.cancelled {
    background: transparent;
    border: 1.5px solid var(--fg-3);
  }
  .tdot.unknown {
    background: transparent;
    border: 1.5px solid var(--warn);
  }
  .tdot.pending {
    opacity: 0.5;
  }

  .tbadge {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .eclass {
    grid-column: 2 / -1;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
