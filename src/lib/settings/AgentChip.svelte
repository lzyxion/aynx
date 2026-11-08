<script lang="ts">
  import type { Snippet } from "svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";

  let {
    agent, pressed, disabled = false, busy = false, fixed = false, showLabel = false, title, onclick, icon, dot = false,
  }: {
    agent: { id: string; display: string };
    pressed: boolean;
    disabled?: boolean;
    busy?: boolean;
    /** 켜진 모양을 유지하면서 선택을 고정한다. */
    fixed?: boolean;
    showLabel?: boolean;
    title: string;
    onclick?: () => void;
    /** 에이전트 로고 대신 그릴 그림(사이드 채팅 칩 — 2026-10-25). 눌림 · 꺼짐(회색) 모양은 같다 */
    icon?: Snippet;
    /** 오른쪽 위 작은 초록 점(사이드 채팅 '묻지 않기' 켜짐) — 뜻은 `title` 이 말한다 */
    dot?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="agent-chip"
  class:with-label={showLabel}
  class:busy
  class:unavailable={disabled && !fixed}
  class:fixed
  aria-pressed={pressed}
  aria-busy={busy}
  {title}
  aria-label={title}
  disabled={disabled || busy || fixed}
  onclick={() => { if (!disabled && !busy && !fixed) onclick?.(); }}
>
  <span class="agent-icon">{#if icon}{@render icon()}{:else}<HostIcon icon={iconRef(agent.id)} size={14} />{/if}</span>
  {#if showLabel}<span>{agent.display}</span>{/if}
  {#if dot}<span class="agent-dot" aria-hidden="true"></span>{/if}
</button>

<style>
  .agent-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 22px;
    height: 22px;
    padding: 0;
    gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .agent-chip:has(.agent-dot) {
    position: relative;
  }

  .agent-dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border: 2px solid var(--surface-raised-solid);
    border-radius: 50%;
    background: var(--ok);
  }

  .agent-chip.with-label {
    width: auto;
    padding: 0 var(--space-2);
  }

  .agent-chip[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .agent-icon {
    display: inline-flex;
    flex: none;
  }

  .agent-chip[aria-pressed="false"] .agent-icon {
    filter: grayscale(1);
    opacity: .45;
  }

  .agent-chip:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .agent-chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .agent-chip.busy {
    opacity: .5;
    cursor: progress;
  }

  .agent-chip.fixed {
    cursor: default;
  }

  .agent-chip.unavailable {
    opacity: .35;
    cursor: not-allowed;
  }
</style>
