<script lang="ts">
  /**
   * **쿼리 타일의 실행 줄**(`.runline` — 쓰기 알약 · `[자동 | 수동 커밋]` · 작업 단추 · 작업 상태 · AI 에 묻기 · 경과 · [스크립트 실행] · [실행]/[취소]) —
   * `QueryView.svelte` 에서 뗀 표시 조각. 연결 · 실행 · 트랜잭션 상태와 명령(`onPill` · `setAutoCommit` · `txCall` · `askAi` · `run` · `runScript` · `cancel`)은
   * 부모가 쥐고, 여기는 받은 값(알약 · 접기 `fit` · 단추 판정)대로 그리기만 한다. AI 에 묻기 단추는 자리(말풍선 기준)를 부모가 재므로 `bind:askBtn`.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { displayCombo } from "$lib/keybindings";
  import type { DbAiLevel } from "$lib/db-ai";
  import type { DbOpened, DbTxAction } from "$lib/query/query-backend";
  import type { WritePill } from "$lib/query/write-toggle";
  import type { AutoCommitToggle } from "$lib/query/auto-commit";
  import type { RunLineFit } from "$lib/query/bar-fit";
  import { formatClock, type TxButtons, type TxChip, type TxSeen } from "$lib/query/tx-work";

  let {
    pill,
    fit,
    acToggle,
    txShown,
    txb,
    txSupported,
    opened,
    chip,
    chipLabel,
    tx,
    askLevel,
    askCombo,
    askBtn = $bindable(),
    running,
    elapsed,
    scriptSupported,
    runOff,
    scriptTitle,
    onPill,
    onModeKey,
    setAutoCommit,
    txCall,
    askAi,
    runScript,
    cancel,
    run,
  }: {
    pill: WritePill;
    fit: RunLineFit;
    acToggle: AutoCommitToggle;
    txShown: boolean;
    txb: TxButtons;
    txSupported: boolean;
    opened: DbOpened | null;
    chip: TxChip | null;
    chipLabel: string;
    tx: TxSeen | null;
    askLevel: DbAiLevel;
    askCombo: string | null;
    askBtn: HTMLButtonElement | null;
    running: { queryId: string; startedAt: number; tab: number } | null;
    elapsed: number;
    scriptSupported: boolean;
    runOff: boolean;
    scriptTitle: string;
    onPill: () => Promise<void>;
    onModeKey: (ev: KeyboardEvent) => void;
    setAutoCommit: (on: boolean) => Promise<void>;
    txCall: (action: DbTxAction) => Promise<void>;
    askAi: () => void;
    runScript: () => Promise<void>;
    cancel: () => boolean;
    run: () => Promise<void>;
  } = $props();
</script>

<div class="runline" role="toolbar" aria-label={t("pane.query.runline")} data-query-runline>
  <!-- 쓰기 알약 — 맨 왼쪽(10-14 — 탭 줄 오른쪽 끝에서 옮겼다). 좁으면 자물쇠만(`fit.pillLabel`) -->
  <button
    type="button"
    class="ro"
    class:on={pill.writable}
    disabled={pill.disabled}
    aria-pressed={pill.writable}
    aria-label={pill.writable ? t("pane.query.write") : t("pane.query.readOnly")}
    title={pill.writable ? t("pane.query.write.title") : t("pane.query.readOnly.title")}
    onclick={() => void onPill()}
    data-query-readonly={pill.writable ? undefined : ""}
    data-query-writable={pill.writable ? "" : undefined}
    ><UiIcon name={pill.writable ? "lock-open" : "lock"} size={11} />{#if fit.pillLabel}<span class="ro-label"
        >{pill.writable ? t("pane.query.write") : t("pane.query.readOnly")}</span
      >{/if}</button
  >
  {#if acToggle.shown}
    <div
      class="seg"
      class:locked={acToggle.lockedByWork}
      role="radiogroup"
      aria-label={t("pane.query.commitMode")}
      tabindex="-1"
      title={acToggle.lockedByWork ? t("pane.query.autoCommit.locked") : undefined}
      onkeydown={onModeKey}
      data-query-autocommit={acToggle.on ? "on" : "off"}
    >
      <button
        type="button"
        role="radio"
        aria-checked={acToggle.on}
        aria-disabled={acToggle.disabled}
        tabindex={acToggle.on ? 0 : -1}
        title={acToggle.lockedByWork ? t("pane.query.autoCommit.locked") : t("pane.query.autoCommit.on.title")}
        onclick={() => void setAutoCommit(true)}
        data-query-commit-mode="auto">{t("pane.query.commitMode.auto")}</button
      ><button
        type="button"
        role="radio"
        aria-checked={!acToggle.on}
        aria-disabled={acToggle.disabled}
        tabindex={acToggle.on ? -1 : 0}
        title={acToggle.lockedByWork ? t("pane.query.autoCommit.locked") : t("pane.query.autoCommit.off.title")}
        onclick={() => void setAutoCommit(false)}
        data-query-commit-mode="manual"
        >{fit.modeLong ? t("pane.query.commitMode.manual") : t("pane.query.commitMode.manual.short")}</button
      >
    </div>
  {/if}
  {#if txShown}
    {#if fit.idleTx || txb.begin.shown}
      <button
        type="button"
        class="tb"
        disabled={!txb.begin.shown || txb.begin.disabled}
        title={t("pane.query.tx.begin.title")}
        aria-label={t("pane.query.tx.begin")}
        onclick={() => void txCall("begin")}
        data-query-tx-begin
        >{#if fit.txLabels}{t("pane.query.tx.begin.short")}{:else}<UiIcon name="list-checks" size={12} />{/if}</button
      >
    {/if}
    {#if fit.idleTx || txb.end.shown}
      <button
        type="button"
        class="tb"
        disabled={!txb.end.shown || txb.end.disabled}
        title={t("pane.query.tx.commit.title")}
        aria-label={t("pane.query.tx.commit")}
        onclick={() => void txCall("commit")}
        data-query-tx-commit
        >{#if fit.txLabels}{t("pane.query.tx.commit")}{:else}<UiIcon name="check" size={12} />{/if}</button
      >
      <button
        type="button"
        class="tb"
        disabled={!txb.end.shown || txb.end.disabled}
        title={t("pane.query.tx.rollback.title")}
        aria-label={t("pane.query.tx.rollback")}
        onclick={() => void txCall("rollback")}
        data-query-tx-rollback
        >{#if fit.txLabels}{t("pane.query.tx.rollback")}{:else}<UiIcon name="undo" size={12} />{/if}</button
      >
    {/if}
  {/if}
  {#if txSupported && opened && chip}
    <span
      class="txstat"
      class:warn={chip.warn}
      title={t("pane.query.tx.chip.title", { n: chip.statements, elapsed: chip.elapsed, left: formatClock(chip.idleLeftMs) })}
      data-query-tx={tx?.view.state}
      data-query-tx-warn={chip.warn ? "" : undefined}
    >
      {#if chip.warn}<UiIcon name="warning" size={12} />{:else}<span class="dot" aria-hidden="true"></span>{/if}
      {#if chipLabel}<span class="tx-label">{chipLabel}</span>{/if}
    </span>
    {#if txb.extend.shown}
      <button
        type="button"
        class="tb warn"
        disabled={txb.extend.disabled}
        title={t("pane.query.tx.extend.title")}
        aria-label={t("pane.query.tx.extend")}
        onclick={() => void txCall("extend")}
        data-query-tx-extend
        >{#if fit.txLabels}{t("pane.query.tx.extend")}{:else}<UiIcon name="refresh" size={12} />{/if}</button
      >
    {/if}
  {/if}
  <span class="sp"></span>
  <button
    type="button"
    class="tb icon ask"
    class:off={askLevel === "off"}
    bind:this={askBtn}
    title={askLevel === "off" ? t("pane.query.ask.title.off") : t("pane.query.ask.title", { key: askCombo ? displayCombo(askCombo) : "—" })}
    aria-label={t("pane.query.ask")}
    onclick={askAi}
    data-query-ask={askLevel}><UiIcon name={askLevel === "off" ? "ai-off" : "ai"} size={13} /></button
  >
  {#if running}
    <span class="elapsed" data-query-elapsed>{(elapsed / 1000).toFixed(1)}s</span>
  {/if}
  {#if scriptSupported && opened}
    <button
      type="button"
      class="tb script"
      disabled={runOff}
      onclick={() => void runScript()}
      data-query-script-run
      title={scriptTitle}
      aria-label={t("pane.query.script")}
      >{#if fit.scriptLabel}{t("pane.query.script")}{:else}<UiIcon name="scroll-text" size={12} />{/if}</button
    >
  {/if}
  {#if running}
    <button type="button" class="tb run cancel" onclick={() => cancel()} data-query-cancel title={t("pane.query.cancel.title")}
      ><UiIcon name="close" size={12} /><span>{t("pane.query.cancel")}</span></button
    >
  {:else}
    <button type="button" class="tb run" disabled={runOff} onclick={() => void run()} data-query-run title={t("pane.query.run.title")}
      ><UiIcon name="play" size={12} /><span>{t("pane.query.run")}</span></button
    >
  {/if}
</div>

<style>
  /* 읽기 전용 알약(실행 줄 맨 왼쪽) — 누르면 쓰기 토글. 쓰기 켬은 의미색(위험)만 쓴다(새 색 없음 — 끊김 띠 · 취소 단추와 같은 토큰) */
  .ro {
    flex: 0 0 auto;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.6;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    white-space: nowrap;
    cursor: pointer;
  }

  .ro:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .ro.on {
    color: var(--err);
    background: var(--err-soft);
    border-color: color-mix(in srgb, var(--err) 45%, transparent);
    font-weight: var(--fw-semibold);
  }

  .ro.on:hover:not(:disabled) {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }

  .ro:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .ro:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: 1px;
  }

  .sp {
    flex: 1 1 auto;
  }

  /* 실행 줄 — 편집기와 결과 사이(목업의 가운데 줄). 치수는 `query/bar-fit` 의 어림과 맞춘다(고치면 같이) */
  .runline {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 5px 10px;
    border-bottom: 1px solid var(--line);
    /* 몸과 같은 면 — 글래스 크롬 타일이면 비운다(`--tile-inner` · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    font-size: 11px;
    color: var(--fg-2);
  }

  /* [자동 | 수동 커밋] — 두 칸 전환 단추(고른 칸은 떠 있는 면 · 굵게) */
  .seg {
    flex: 0 0 auto;
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-chip);
    outline: none;
  }

  .seg button {
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg button:hover:not([aria-disabled="true"]) {
    color: var(--fg);
  }

  .seg button[aria-checked="true"] {
    color: var(--fg);
    background: var(--surface-field);
    box-shadow: 0 0 0 1px var(--line);
    font-weight: var(--fw-semibold);
  }

  .seg button[aria-disabled="true"] {
    cursor: not-allowed;
  }

  /* 작업 중(못 바꿈) — 흐리게만 하면 "꺼짐" 으로 읽히므로 덜 흐리게(까닭은 말풍선) */
  .seg.locked {
    opacity: 0.7;
  }

  .seg button:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .tb {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 22px;
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-1);
    background: var(--bg-chip);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    white-space: nowrap;
    cursor: pointer;
  }

  .tb:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .tb:disabled {
    color: var(--fg-3);
    background: transparent;
    border-color: color-mix(in srgb, var(--line) 60%, transparent);
    cursor: default;
  }

  .tb:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: 1px;
  }

  .tb.icon {
    padding: 2px 5px;
    background: transparent;
    border-color: transparent;
  }

  /* AI 에 묻기 — 권한이 끔이면 흐리게(눌러도 넘기지 않고 켜는 곳을 알린다) */
  .tb.icon.ask.off {
    color: var(--fg-3);
  }

  .tb.warn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 55%, transparent);
    background: var(--warn-soft);
  }

  /* 실행 — 이 줄의 주 동작(강조색 판) · 취소는 의미색 */
  .tb.run {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
    font-weight: var(--fw-semibold);
  }

  .tb.run:hover:not(:disabled) {
    color: var(--on-accent);
    background: color-mix(in srgb, var(--accent) 88%, var(--fg));
  }

  .tb.run:disabled {
    color: var(--on-accent);
    background: var(--accent);
    opacity: 0.45;
  }

  .tb.run.cancel {
    background: var(--err);
    border-color: var(--err);
  }

  .tb.run.cancel:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }

  /* 작업 상태 — 강조색 점(평소) · 경고색(1분 전) */
  .txstat {
    flex: 0 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 2px;
    color: var(--fg-1);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }

  .txstat .dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  .txstat .tx-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .txstat.warn {
    color: var(--warn);
    font-weight: var(--fw-semibold);
  }

  .elapsed {
    font-family: var(--font-mono);
    color: var(--fg-2);
    white-space: nowrap;
  }
</style>
