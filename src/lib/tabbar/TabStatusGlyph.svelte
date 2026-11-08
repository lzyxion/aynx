<script module lang="ts">
  import { findFirstPane, listPanes, type PaneSpec, type TabSpec } from "$lib/session";
  import type { TabDot } from "$lib/tab-dot";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import BellGlyph from "$lib/BellGlyph.svelte";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";

  /**
   * 탭 앞자리 아이콘의 패널 — 이긴 사실이 에이전트면 **그 에이전트의 타일**(첫 타일이 PowerShell 이고 둘째 타일의
   * Claude 가 권한을 물으면 그동안 Claude 로고), 아니면 예전처럼 첫 패널. 탭 칸 · 접힌 탭 목록이 같은 답을 쓴다
   * (docs/log/2026-11-03-tab-status-glyphs.md).
   */
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
  // ---------------------------------------------------------------------------
  // **탭의 상태 표식 하나**(12px) — 이긴 사실(`tabDot`)을 M3 · Material Symbols 모양으로 그린다. 탭 칸(`Tabs.svelte`) ·
  // 접힌 탭 목록(`TabOverflowMenu.svelte`) · 세션 판 탭 카드 이름 줄(`SessionSheet.svelte`)이 같은 조각을 쓴다. 우선순위 · 말풍선은 `$lib/tab-dot` 이 정하고 여기는 모양만:
  //   권한 대기 = pending(강조색 판 · 점 셋) · 완료 = check_circle(초록 판) · 명령 실패 = error(오류색 판 · !) ·
  //   벨 = notifications(경고색 종, 판 없음) · 에이전트 실행 중 = M3 원형 진행 표시 · 명령 실행 중/성공 · 활동 = 예전 6px 점.
  // 에이전트 셋은 `AgentStatusGlyph`, 실패는 `ErrorGlyph` — 독 · 브랜치 그래프 · 시작 화면 · 모바일 · 실행 목록과 같은 그림 하나다.
  // 벨은 `BellGlyph`(세션 판 칸과 같은 그림). 여기만의 것은 6px 점 · 서브 에이전트 수 · 12px 칸이다.
  // ---------------------------------------------------------------------------
  let { dot }: { dot: TabDot } = $props();
  const w = $derived(dot.winner);
</script>

{#if w.source === "agent"}
  <!-- `data-agent-dot` = 누르면 그 상태의 첫 AI 타일로(탭 칸의 버튼 `onclick` 이 가른다) · 하니스도 이 속성을 본다 -->
  <span class="tab-glyph agent {w.state}" data-agent-dot={w.state} title={dot.label} aria-label={dot.label}>
    <AgentStatusGlyph state={w.state} aria-hidden="true" />
  </span>
  <!-- 진행 중 서브 에이전트 수 — 표식 옆 작은 글자, 말풍선은 표식과 같다(docs/log/2026-10-04-subagent-signals.md) -->
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
  <!-- 명령 실행 중 · 성공 · 활동 — 예전 6px 점 그대로(조용한 사실은 조용한 모양) -->
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

  /* 명령 실행 중 · 성공 · 활동 — 예전 6px 점(12px 칸 가운데가 아니라 점 크기 그대로 선다) */
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

  /* 진행 중 서브 에이전트 수 — 표식 바로 옆의 작은 보조 글자(색을 더하지 않는다: 표식이 이미 상태를 말한다) */
  .subagents {
    flex: 0 0 auto;
    margin-left: -2px;
    font-size: 10px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }
</style>
