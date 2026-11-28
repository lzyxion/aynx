<script lang="ts">
  /**
   * Codex 목표 띠 — 목표가 있는 동안 입력 칸 위에 늘(턴 중에도). 단추는 `goalBar` 가 보이라는 것만 · 누르면 부르는 쪽이 사람 op 하나를 보낸다.
   * 앱은 목표를 스스로 멈추거나 다시 켜지 않는다 — Aynx 밖에서 정한 목표도 표만 달고 같은 단추를 보인다.
   * 좁은 타일 · 폰에서는 한 줄을 지키고 목표 글은 말줄임 — 글 전체는 title 과 펼치기로.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import { formatTokens } from "$lib/chat-tile/chat-tile-context";
  import type { GoalBar } from "$lib/chat-tile/chat-tile-goal";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    bar,
    objective,
    busy = false,
    resumeBlocked = false,
    error = null,
    touch = false,
    onaction,
    ondismiss,
  }: {
    bar: GoalBar;
    /** 목표 글 전체 */
    objective: string;
    /** 목표 op 를 보내는 중 */
    busy?: boolean;
    /** 일하는 중 — [다시]는 턴이 끝난 뒤에 */
    resumeBlocked?: boolean;
    error?: string | null;
    touch?: boolean;
    onaction: (action: "pause" | "resume" | "clear") => void;
    ondismiss: () => void;
  } = $props();

  let open = $state(false);
  const fullId = `ct-gb-${Math.random().toString(36).slice(2, 10)}`;
  const tokens = $derived(bar.budget !== null ? `${formatTokens(bar.used)} / ${formatTokens(bar.budget)}` : formatTokens(bar.used));
  const statusText = $derived(t(bar.statusKey));
</script>

<div class="gb" class:touch data-chat-tile-goal={bar.status} data-tone={bar.tone} data-outside={bar.outside ? "" : undefined} role="group" aria-label={t("pane.chatTile.goal.title")}>
  <div class="row">
    <span class="flag" aria-hidden="true"><UiIcon name="route" size={14} /></span>
    {#if bar.outside}<span class="auto" data-chat-tile-goal-auto title={t("pane.chatTile.goal.auto")}>{t("pane.chatTile.goal.auto")}</span>{/if}
    <button
      type="button"
      class="obj"
      title={objective}
      aria-expanded={open}
      aria-controls={fullId}
      data-chat-tile-goal-objective-line
      onclick={() => (open = !open)}>{bar.head}</button
    >
    <span class="status" data-chat-tile-goal-status>{statusText}</span>
    <span class="use" title={bar.pct !== null ? `${bar.pct}%` : undefined} data-chat-tile-goal-tokens>
      <span class="num">{tokens}</span>
      {#if bar.pct !== null}<span class="meter" aria-hidden="true"><span class="fill" style:width="{bar.pct}%"></span></span>{/if}
    </span>
    <span class="btns">
      {#if bar.canPause}
        <button type="button" class="btn btn-ghost btn-sm" disabled={busy} title={t("pane.chatTile.goal.pauseHint")} data-chat-tile-goal-pause onclick={() => onaction("pause")}
          ><UiIcon name="pause" size={13} /><span class="lbl">{t("pane.chatTile.goal.pause")}</span></button
        >
      {/if}
      {#if bar.canResume}
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={busy || resumeBlocked}
          title={resumeBlocked ? t("pane.chatTile.goal.busy") : t("pane.chatTile.goal.resumeHint")}
          data-chat-tile-goal-resume
          onclick={() => onaction("resume")}><UiIcon name="play" size={13} /><span class="lbl">{t("pane.chatTile.goal.resume")}</span></button
        >
      {/if}
      {#if bar.canClear}
        <button type="button" class="btn btn-ghost btn-sm" disabled={busy} title={t("pane.chatTile.goal.clearHint")} data-chat-tile-goal-clear onclick={() => onaction("clear")}
          ><UiIcon name="close" size={13} /><span class="lbl">{t("pane.chatTile.goal.clear")}</span></button
        >
      {/if}
    </span>
  </div>
  {#if open}<div class="full" id={fullId} data-chat-tile-goal-full>{objective}</div>{/if}
  {#if error}
    <div class="err" role="alert" data-chat-tile-goal-band-error>
      <span class="grow">{error}</span>
      <button type="button" class="x" title={t("app.actions.close")} aria-label={t("app.actions.close")} onclick={ondismiss}><UiIcon name="close" size={12} /></button>
    </div>
  {/if}
</div>

<style>
  .gb {
    box-sizing: border-box;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 3px var(--space-1) 3px var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--control-tile-bg);
    border: 1px solid var(--line);
    border-radius: 14px;
  }

  .gb[data-tone="run"] {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  }

  .gb[data-tone="stopped"] {
    border-color: color-mix(in srgb, var(--warn) 50%, var(--line));
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: 26px;
  }

  .flag {
    flex: none;
    display: inline-flex;
    color: var(--fg-2);
  }

  .gb[data-tone="run"] .flag {
    color: var(--accent);
  }

  .auto {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 40%;
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--line));
    border-radius: 999px;
  }

  .obj {
    flex: 1 1 0;
    min-width: 48px;
    padding: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .obj:focus-visible,
  .x:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .status {
    flex: none;
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .gb[data-tone="run"] .status {
    color: var(--accent);
  }

  .gb[data-tone="stopped"] .status {
    color: var(--warn);
  }

  .gb[data-tone="done"] .status {
    color: var(--ok);
  }

  .use {
    flex: none;
    display: inline-flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .meter {
    display: block;
    height: 3px;
    background: var(--line);
    border-radius: 2px;
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
  }

  .gb[data-tone="stopped"] .fill {
    background: var(--warn);
  }

  .btns {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .btns .btn {
    gap: 4px;
    height: 24px;
    padding: 0 8px;
  }

  .gb.touch .btns .btn {
    height: 36px;
    min-width: 36px;
    justify-content: center;
  }

  .full {
    max-height: 8em;
    overflow-y: auto;
    padding: 0 var(--space-1) 2px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--fg-2);
  }

  .err {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--err);
  }

  .err .grow {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .x {
    flex: none;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  /* 좁은 타일 — 단추 글을 걷고 아이콘만(이름은 title · aria) */
  @container ct-face (max-width: 560px) {
    .lbl {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .use .meter {
      display: none;
    }
  }
</style>
