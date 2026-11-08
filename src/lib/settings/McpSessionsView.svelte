<script lang="ts">
  import { onMount } from "svelte";
  import {
    mcpActivity,
    mcpCalls,
    mcpTools,
    type AgentArgsTarget,
    type McpActivity,
    type McpCallRecord,
    type McpStatus,
    type McpToolInfo,
  } from "$lib/context";
  import { settings, setMcpSessionsEnabled, setMcpSessionsAgent } from "$lib/settings.svelte.js";
  import { relativeTime } from "$lib/notifications";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import SettingsSubView from "./SettingsSubView.svelte";
  import AgentChip from "./AgentChip.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Toggle from "$lib/Toggle.svelte";

  /**
   * **세션 서버 하위 화면** — 설정 › MCP 의 고정 줄(`McpManager`)을 누르면 열린다(2026-10-19). 틀은 외부 서버 편집과 같은
   * `SettingsSubView`, 움직임 · Escape · 돌아온 뒤 포커스는 요약(`ExternalMcpServers` 의 `SubViewStack`)이 맡는다.
   *
   * 네 묶음: ① 상태(실행 · URL · 서버 이름 · 마지막 활동 — `mcp_activity`) ② 연결 대상(고정 줄과 **같은** 설정 칸 — 켜기 · 에이전트 칩)
   * ③ 제공 도구(`mcp_tools` — 서버가 `tools/list` 스키마에서 뽑는다, 손으로 옮긴 표가 없다) ④ 최근 호출(`mcp_calls` — 서버 메모리
   * 200줄, 인자 · 결과 없음). 이 화면이 떠 있는 동안만 5초마다 활동 · 호출을 다시 읽는다(화면이 닫히면 멈춘다).
   */
  let {
    mcp,
    targets,
    onback,
  }: {
    mcp: McpStatus | null;
    targets: AgentArgsTarget[];
    onback: () => void;
  } = $props();

  const enabled = $derived(settings.current.ai.mcp_sessions_enabled ?? true);
  const agents = $derived(settings.current.ai.mcp_sessions_agents ?? ["claude", "codex"]);
  const name = $derived(mcp?.name || t("settings.ai.sessions.label"));

  let activity = $state<McpActivity | null>(null);
  let tools = $state<McpToolInfo[] | null>(null);
  let toolsError = $state<string | null>(null);
  let calls = $state<McpCallRecord[] | null>(null);
  let callsError = $state<string | null>(null);
  let now = $state(Date.now());
  let refreshing = $state(false);

  /** 묶음 순서 — 서버가 실은 순서를 따르되 알려진 묶음은 이 순서로(모르는 묶음은 뒤에) */
  const GROUP_ORDER = ["read", "plan", "db", "tile", "coordinator", "worker", "reviewer"];
  const groups = $derived.by(() => {
    const map = new Map<string, McpToolInfo[]>();
    for (const tool of tools ?? []) {
      const list = map.get(tool.group) ?? [];
      list.push(tool);
      map.set(tool.group, list);
    }
    const rank = (g: string) => (GROUP_ORDER.indexOf(g) + 1 || GROUP_ORDER.length + 1);
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  });

  function groupLabel(g: string): string {
    return GROUP_ORDER.includes(g) ? t(`settings.ai.sessions.group.${g}` as Key) : g;
  }
  function groupWhen(g: string): string {
    return GROUP_ORDER.includes(g) ? t(`settings.ai.sessions.group.${g}_when` as Key) : "";
  }
  function callerLabel(c: string): string {
    return ["global", "tile", "worker", "reviewer", "sideChat"].includes(c) ? t(`settings.ai.sessions.caller.${c}` as Key) : c;
  }
  function outcomeLabel(o: string): string {
    return ["ok", "error", "rejected"].includes(o) ? t(`settings.ai.sessions.outcome.${o}` as Key) : o;
  }
  const ago = (at: number) => relativeTime(at, now, t);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function loadTools(): Promise<void> {
    try {
      tools = await mcpTools();
      toolsError = null;
    } catch (e) {
      toolsError = message(e);
    }
  }

  async function refresh(): Promise<void> {
    refreshing = true;
    try {
      const [a, c] = await Promise.allSettled([mcpActivity(), mcpCalls()]);
      if (a.status === "fulfilled") activity = a.value;
      if (c.status === "fulfilled") {
        calls = c.value;
        callsError = null;
      } else {
        callsError = message(c.reason);
      }
      now = Date.now();
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    void loadTools();
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  });
</script>

<SettingsSubView title={name} back={t("settings.ai.external.back")} backAria={t("settings.ai.external.back_aria")} {onback}>
  <!-- ① 상태 -->
  <h4 class="subhead first" id="ai-mcp-sessions-info">{t("settings.ai.sessions.view.status")}</h4>
  <div class="slist">
    <div class="slist-row">
      <span class="slist-text"><span class="slist-name">{t("settings.ai.server.label")}</span></span>
      <span class="slist-trail state">
        <span class="dot" class:ok={mcp?.running} class:err={mcp && !mcp.running}></span>
        <span>{mcp === null ? t("settings.ai.checking")
          : t(mcp.running ? "settings.ai.server.running" : "settings.ai.server.stopped")}</span>
      </span>
    </div>
    <div class="slist-row">
      <span class="slist-text">
        <span class="slist-name">{t("settings.ai.endpoint.label")}</span>
        <span class="slist-sup url-line">
          {#if mcp?.url}<code class="slist-mono url" aria-label={t("settings.ai.endpoint.aria")}>{mcp.url}</code>
          {:else}—{/if}
        </span>
      </span>
    </div>
    <div class="slist-row">
      <span class="slist-text">
        <span class="slist-name">{t("settings.ai.sessions.view.name")}</span>
        <span class="slist-sup">{t("settings.ai.sessions.view.name_note")}</span>
      </span>
      <span class="slist-trail"><code class="slist-mono server-name">{mcp?.name || "—"}</code></span>
    </div>
    <div class="slist-row">
      <span class="slist-text">
        <span class="slist-name">{t("settings.ai.sessions.view.activity")}</span>
        <span class="slist-sup activity">
          {#if activity}
            {t("settings.ai.sessions.view.activity_line", {
              client: activity.client || t("settings.ai.sessions.view.client_unknown"),
              when: ago(activity.atMs),
            })}
          {:else}
            {t("settings.ai.sessions.view.activity_none")}
          {/if}
        </span>
      </span>
    </div>
  </div>

  <!-- ② 연결 대상 — 고정 줄과 같은 설정 칸(초안 · [저장] 뒤 다음 실행부터) -->
  <h4 class="subhead" id="ai-mcp-sessions-targets">{t("settings.ai.sessions.view.targets")}</h4>
  <div class="slist">
    <div class="slist-row">
      <span class="slist-text">
        <span class="slist-name">{t("settings.ai.external.enabled_label")}</span>
        <span class="slist-sup">{t("settings.ai.external.enabled_note")}</span>
      </span>
      <span class="slist-trail">
        <span class="slist-switch">
          <Toggle checked={enabled} onchange={setMcpSessionsEnabled}
            label={t("settings.ai.external.enabled_aria", { name })} />
        </span>
      </span>
    </div>
    <div class="slist-row">
      <span class="slist-text"><span class="slist-name">{t("settings.ai.external.targets")}</span></span>
      <span class="slist-trail agents">
        {#each targets as target (target.id)}
          {@const pressed = agents.includes(target.id)}
          <AgentChip agent={target} {pressed}
            title={t(pressed ? "settings.ai.external.agent_on" : "settings.ai.external.agent_off", { name, agent: target.display })}
            onclick={() => setMcpSessionsAgent(target.id, !pressed)} />
        {/each}
      </span>
    </div>
  </div>
  <p class="footnote">{t("settings.ai.sessions.view.targets_note")}</p>

  <!-- ③ 제공 도구 — 서버의 스키마에서 -->
  <h4 class="subhead" id="ai-mcp-sessions-tools">{t("settings.ai.sessions.view.tools")}</h4>
  <p class="footnote tools-note">{t("settings.ai.sessions.view.tools_note")}</p>
  {#if toolsError}
    <p class="slist-empty">{t("settings.ai.sessions.view.tools_failed", { error: toolsError })}</p>
  {:else if tools === null}
    <p class="slist-empty">{t("settings.ai.checking")}</p>
  {:else}
    {#each groups as [group, list] (group)}
      <div class="group" data-tool-group={group}>
        <h5 class="group-head">
          <span>{groupLabel(group)}</span>
          <span class="slist-pill">{t("settings.ai.sessions.view.tools_count", { count: list.length })}</span>
        </h5>
        {#if groupWhen(group)}<p class="group-when">{groupWhen(group)}</p>{/if}
        <div class="slist">
          {#each list as tool (tool.name)}
            <div class="slist-row tool-row">
              <span class="slist-text">
                <span class="slist-name slist-mono tool-name">{tool.name}</span>
                <span class="slist-sup tool-desc">{tool.description}</span>
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}

  <!-- ④ 최근 호출 — 서버 메모리 고리(인자 · 결과 없음) -->
  <div class="list-head">
    <h4 class="subhead" id="ai-mcp-sessions-calls">{t("settings.ai.sessions.view.calls")}</h4>
    <button type="button" class="btn btn-sm btn-secondary refresh" disabled={refreshing}
      onclick={() => void refresh()}>
      <UiIcon name="refresh" size={12} />
      <span>{t("settings.ai.sessions.view.refresh")}</span>
    </button>
  </div>
  <p class="footnote calls-note">{t("settings.ai.sessions.view.calls_note")}</p>
  {#if callsError}
    <p class="slist-empty">{t("settings.ai.sessions.view.calls_failed", { error: callsError })}</p>
  {:else if calls === null}
    <p class="slist-empty">{t("settings.ai.checking")}</p>
  {:else if calls.length === 0}
    <p class="slist-empty calls-empty">{t("settings.ai.sessions.view.calls_empty")}</p>
  {:else}
    <div class="slist calls">
      {#each calls as call, i (i)}
        <div class="slist-row call-row" data-outcome={call.outcome}>
          <span class="dot" class:ok={call.outcome === "ok"} class:err={call.outcome === "error"}
            class:rej={call.outcome === "rejected"} title={outcomeLabel(call.outcome)}
            aria-label={outcomeLabel(call.outcome)} role="img"></span>
          <span class="slist-text">
            <span class="slist-name slist-mono">{call.tool}</span>
            <span class="slist-sup">{ago(call.atMs)}{call.client ? ` · ${call.client}` : ""}</span>
          </span>
          <span class="slist-trail">
            {#if call.code}<span class="slist-pill code">{call.code}</span>{/if}
            <span class="slist-pill">{callerLabel(call.caller)}</span>
          </span>
        </div>
      {/each}
    </div>
  {/if}
</SettingsSubView>

<style>
  .state {
    gap: var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-2);
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-3);
  }
  .dot.ok { background: var(--ok); }
  .dot.err { background: var(--err); }
  .dot.rej { background: var(--warn); }

  /* URL · 서버 이름은 고를 수 있다(복사) — 줄에 덮개 단추가 없어 그대로 닿는다 */
  .url,
  .server-name {
    font-size: var(--t-xs);
    user-select: text;
  }
  .slist-sup.url-line {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .agents {
    gap: var(--space-1);
  }

  .footnote.tools-note,
  .footnote.calls-note {
    margin: 0 0 var(--space-3);
  }

  .group + .group {
    margin-top: var(--space-4);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 2px;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }
  .group-when {
    margin: 0 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
    word-break: keep-all;
  }
  .tool-row {
    min-height: 0;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .slist-name.tool-name {
    font-size: var(--t-xs);
  }
  /* 설명은 한 줄로 자르지 않는다 — 첫 문장 하나라 짧다 */
  .slist-sup.tool-desc {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .refresh {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .slist-pill.code {
    font-family: var(--font-mono);
  }
</style>
