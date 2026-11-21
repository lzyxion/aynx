<script lang="ts">
  import { mcpStatus, agentArgsTargets, type AgentArgsTarget, type McpStatus } from "$lib/context";
  import { settings, setMcpSessionsEnabled, setMcpSessionsAgent } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import AgentChip from "./AgentChip.svelte";
  import ExternalMcpServers from "./ExternalMcpServers.svelte";
  import McpSessionsView from "./McpSessionsView.svelte";

  let { active = false, onloaded }: { active?: boolean; onloaded?: () => void } = $props();
  let argsTargets = $state<AgentArgsTarget[]>([]);
  let mcp = $state<McpStatus | null>(null);
  const enabled = $derived(settings.current.ai.mcp_sessions_enabled ?? true);
  const agents = $derived(settings.current.ai.mcp_sessions_agents ?? ["claude", "codex"]);
  let external = $state<ReturnType<typeof ExternalMcpServers> | undefined>();

  const SUB_VIEW_ANCHORS = new Set(["ai-mcp-sessions-info", "ai-mcp-sessions-targets", "ai-mcp-sessions-tools", "ai-mcp-sessions-calls"]);
  export function expandForAnchor(anchor: string): void {
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
        <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
      </span>
    </div>
  {/snippet}
  {#snippet pinnedView(back: () => void)}
    <McpSessionsView {mcp} targets={argsTargets} onback={back} />
  {/snippet}
</ExternalMcpServers>

<style>
  .mcp-agents {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
