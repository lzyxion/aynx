<script module lang="ts">
  import { findFirstPane, listPanes, type PaneSpec, type TabSpec } from "$lib/session";
  import type { TabDot } from "$lib/tab-dot";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import BellGlyph from "$lib/BellGlyph.svelte";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";

  /** 탭 앞자리 아이콘의 패널 — 이긴 사실이 에이전트면 그 타일 (docs/log/2026-11-03-tab-status-glyphs.md) */
  export function tabIconPane(tab: TabSpec, dot: TabDot | null | undefined): PaneSpec {
    const w = dot?.winner;
    if (w?.source === "agent" && w.paneId) {
      const pane = listPanes(tab.root).find((p) => p.id === w.paneId);
      if (pane) return pane;
    }
    return findFirstPane(tab.root);
  }
</script>

<script lang="ts">
  let { dot }: { dot: TabDot } = $props();
  const w = $derived(dot.winner);
</script>

{#if w.source === "agent"}
  <!-- `data-agent-dot` — 탭 칸의 버튼 `onclick` 이 가르고 하네스도 이 속성을 본다 -->
  <span class="tab-glyph agent {w.state}" data-agent-dot={w.state} title={dot.label} aria-label={dot.label}>
    <AgentStatusGlyph state={w.state} aria-hidden="true" />
  </span>
  {#if w.subagents > 0}
    <span class="subagents" data-subagents={w.subagents} title={dot.label} aria-hidden="true">{w.subagents}</span>
  {/if}
{:else if w.source === "command" && w.state === "fail"}
  <span class="tab-glyph command fail" title={dot.label} aria-label={dot.label}>
    <ErrorGlyph aria-hidden="true" />
  </span>
{:else if w.source === "bell"}
  <span class="tab-glyph bell" title={dot.label} aria-label={dot.label}>
    <BellGlyph aria-hidden="true" />
  </span>
{:else}
  <span class="tab-glyph dot {w.source === 'command' ? w.state : 'activity'}" title={dot.label} aria-label={dot.label}></span>
{/if}

<style>
  .tab-glyph {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
  }
  .agent {
    cursor: pointer;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-2);
  }
  .dot.running,
  .dot.ok {
    background: var(--ok);
  }

  .subagents {
    flex: 0 0 auto;
    margin-left: -2px;
    font-size: 10px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }
</style>
