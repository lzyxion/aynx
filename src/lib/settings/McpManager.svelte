<script lang="ts">
  import { mcpStatus, agentArgsTargets, type AgentArgsTarget, type McpStatus } from "$lib/context";
  import { settings, setMcpSessionsEnabled, setMcpSessionsAgent } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import AgentChip from "./AgentChip.svelte";
  import ExternalMcpServers from "./ExternalMcpServers.svelte";
  import McpSessionsView from "./McpSessionsView.svelte";

  // 고정 줄·외부 줄 모두 설정 초안을 바꾸고 [저장] 뒤 다음 실행부터 적용한다.
  let { active = false, onloaded }: { active?: boolean; onloaded?: () => void } = $props();
  let argsTargets = $state<AgentArgsTarget[]>([]);
  let mcp = $state<McpStatus | null>(null);
  const enabled = $derived(settings.current.ai.mcp_sessions_enabled ?? true);
  const agents = $derived(settings.current.ai.mcp_sessions_agents ?? ["claude", "codex"]);
  let external = $state<ReturnType<typeof ExternalMcpServers> | undefined>();

  /** 세션 서버 하위 화면에 사는 색인 줄 — 그리로 간다(나머지는 요약) */
  const SUB_VIEW_ANCHORS = new Set(["ai-mcp-sessions-info", "ai-mcp-sessions-targets", "ai-mcp-sessions-tools", "ai-mcp-sessions-calls"]);
  export function expandForAnchor(anchor: string): void {
    // 고정 줄 · 목록 머리는 요약에, 상태 · 도구 · 최근 호출은 세션 서버 하위 화면에 있다 — 그 화면으로 움직임 없이 간다.
    if (SUB_VIEW_ANCHORS.has(anchor)) external?.showPinned();
    else external?.showSummary();
  }
  async function loadMcp() {
    argsTargets = await agentArgsTargets();
    mcp = await mcpStatus();
    onloaded?.();
  }
  $effect(() => {
    if (active && mcp === null) void loadMcp();
  });
</script>

<ExternalMcpServers bind:this={external} targets={argsTargets} {active}>
  {#snippet pinned(open: () => void)}
    <!-- 고정 줄 — 공용 `.slist` 줄이고 MCP 목록의 첫 줄이다. 줄 단추(덮개 `.slist-open::after` 가 줄 전체를 덮는다)는
         세션 서버 하위 화면(`McpSessionsView`)을 열고, 끝 표시도 외부 서버 줄과 같은 `›` 다. 칩 · 스위치는 덮개 위에 따로 선다 -->
    <div class="slist-row mcp-row" id="ai-mcp-sessions" class:off={!enabled}>
      <button type="button" id="ai-mcp-sessions-toggle" class="slist-open sessions-open"
        aria-label={t("settings.ai.sessions.open_aria", { name: mcp?.name || t("settings.ai.sessions.label") })}
        onclick={open}>
        <span class="slist-lead" aria-hidden="true"><UiIcon name="mcp" size={16} /></span>
        <span class="slist-text mcp-main">
          <span class="slist-title mcp-title">
            <span class="slist-name mcp-name">{mcp?.name || t("settings.ai.sessions.label")}</span>
            <span class="slist-pill scope" title={t("settings.ai.sessions.note")}>{t("settings.ai.external.scope_global")}</span>
          </span>
          <span class="slist-sup mcp-detail" title={t("settings.ai.sessions.description")}>{t("settings.ai.sessions.description")}</span>
        </span>
      </button>
      <span class="slist-trail">
        <span class="mcp-agents">
          {#each argsTargets as target (target.id)}
            {@const pressed = agents.includes(target.id)}
            <AgentChip agent={target} {pressed}
              title={t(pressed ? "settings.ai.external.agent_on" : "settings.ai.external.agent_off", { name: mcp?.name || t("settings.ai.sessions.label"), agent: target.display })}
              onclick={() => setMcpSessionsAgent(target.id, !pressed)} />
          {/each}
        </span>
        <span class="slist-switch">
          <Toggle checked={enabled} onchange={setMcpSessionsEnabled}
            label={t("settings.ai.external.enabled_aria", { name: mcp?.name || t("settings.ai.sessions.label") })}
            title={t("settings.ai.external.enabled_note")} />
        </span>
        <!-- 꺾쇠는 그림일 뿐 — 누르면 줄 단추의 덮개가 받는다 -->
        <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
      </span>
    </div>
  {/snippet}
  {#snippet pinnedView(back: () => void)}
    <McpSessionsView {mcp} targets={argsTargets} onback={back} />
  {/snippet}
</ExternalMcpServers>

<style>
  /* 줄 모양은 공용 `.slist` */
  .mcp-agents {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
