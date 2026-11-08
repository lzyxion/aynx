<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import type { AgentArgsTarget } from "$lib/context";
  import { settings, setAiMcpServers } from "$lib/settings.svelte.js";
  import { DEFAULT_AGENTS, scopeIds, serverSummary, sortForDisplay, toggleSideChat } from "$lib/settings/model/mcp-server-form";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import InfoNote from "./InfoNote.svelte";
  import AgentChip from "./AgentChip.svelte";
  import SubViewStack from "./SubViewStack.svelte";
  import McpServerEditor from "./McpServerEditor.svelte";
  import { projects } from "$lib/app/project-list.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import Toggle from "$lib/Toggle.svelte";

  /**
   * 외부 MCP 서버 — 설정 › MCP 의 **요약**(목록) ↔ **추가 · 편집 하위 화면** (docs/log/2026-10-05-mcp-subview.md).
   *
   * 세션 서버 고정 줄(`pinned`, `McpManager` 가 그린다)도 같은 설정 초안 · 다음 실행 주입 규칙을 따른다. 그 줄을 누르면
   * 세션 서버 하위 화면(`pinnedView` — 상태 · 연결 대상 · 제공 도구 · 최근 호출, 2026-10-19)이 열린다 — 두 조각은 여는 ·
   * 돌아가는 함수를 받는다. 외부 서버 줄은 이름 · 범위 · 명령/URL 을 담은 단추(덮개가 꺾쇠 `›` 까지 줄 전체)가
   * 편집 하위 화면(`McpServerEditor`)을 열고, 줄 안의 켜기 스위치 · 에이전트 칩은 그 자리에서 초안을 바꾼다.
   * 오른쪽 위 [MCP 서버 추가 ›] 는 추가 하위 화면. 자리 · 움직임 · Escape 는 `SubViewStack`, 머리는 `SettingsSubView` —
   * 트리거 · 스니펫 · 자동 승인과 같은 틀이다. 돌아오면 연 줄(지웠으면 [MCP 서버 추가 ›])에 포커스가 서고, 섹션이 안
   * 보이게 되면(`active` 꺼짐) 쓰지 않은 칸은 버리고 요약으로 간다.
   *
   * 목록 · 칩은 설정 초안을 바꾸고 [저장] 뒤 다음 에이전트 실행부터 반영된다. 비밀 값은 볼트 참조만 목록에 남는다.
   */
  let {
    targets,
    pinned,
    pinnedView,
    active = true,
  }: {
    targets: AgentArgsTarget[];
    /** 고정 줄 — 인자는 세션 서버 하위 화면을 여는 함수 */
    pinned: Snippet<[() => void]>;
    /** 세션 서버 하위 화면 — 인자는 요약으로 돌아가는 함수(뒤로 · Escape 와 같다) */
    pinnedView: Snippet<[() => void]>;
    active?: boolean;
  } = $props();
  const list = $derived(settings.current.ai.mcp_servers ?? []);
  const localProjects = $derived(projects().filter((project) => !project.host));
  const scopes = $derived(scopeIds(localProjects.map((p) => p.id), list));
  const projectOptions = $derived(scopes.map((id) => ({ id, name: scopeLabel(id) })));
  // 저장 순서와 편집 index는 유지하고, 표시할 목록만 범위별로 정렬한다.
  const visible = $derived(sortForDisplay(list, scopeLabel));
  function scopeLabel(id: string): string { return localProjects.find((p) => p.id === id)?.name ?? t("settings.ai.external.unknown_project", { id }); }

  // ── 요약 ↔ 하위 화면(추가 · 편집) — 화면 상태, 저장하지 않는다 ──
  type View = { kind: "summary" } | { kind: "add" } | { kind: "edit"; index: number } | { kind: "pinned" };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  /** `{#key}` 의 이름 — 같은 편집 화면이라도 다른 줄이면 새로 그린다 */
  const viewKey = $derived(view.kind === "edit" ? `edit-${view.index}` : view.kind);

  function openSub(v: View, animate = true): void {
    dir = animate ? "fwd" : null;
    view = v;
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  /** 요약으로 — `focusRow` 를 주면 그 줄(`"pinned"` = 고정 줄), `null` 이면 [MCP 서버 추가 ›] 에 포커스(돌아올 때만) */
  async function closeSub(returnFocus: boolean, focusRow: number | "pinned" | null = null): Promise<void> {
    if (view.kind === "summary") return;
    dir = returnFocus ? "back" : null;
    view = { kind: "summary" };
    if (!returnFocus) return;
    await tick();
    const el =
      focusRow === null
        ? addBtn
        : focusRow === "pinned"
          ? (rootEl?.querySelector<HTMLElement>("#ai-mcp-sessions-toggle") ?? addBtn)
          : (rootEl?.querySelector<HTMLElement>(`.mcp-open[data-index="${focusRow}"]`) ?? addBtn);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }

  /** 팔레트가 이 섹션의 줄(목록 머리 · 고정 줄)로 올 때 — 하위 화면이면 움직임 없이 요약으로(그 줄이 보이게) */
  export function showSummary(): void {
    void closeSub(false);
  }

  /** 팔레트가 세션 서버 하위 화면의 줄로 올 때 — 움직임 없이 그 화면으로 */
  export function showPinned(): void {
    if (view.kind !== "pinned") openSub({ kind: "pinned" }, false);
  }

  /** 뒤로 · 취소 · Escape — 연 쪽으로 포커스를 돌린다 */
  function back(): void {
    void closeSub(true, view.kind === "edit" ? view.index : view.kind === "pinned" ? "pinned" : null);
  }

  const openPinned = (): void => openSub({ kind: "pinned" });

  const onescape = $derived(view.kind === "summary" ? null : back);

  $effect(() => {
    if (!active) void closeSub(false);
  });

  function toggle(index: number, agent: string, on: boolean) {
    const server = list[index];
    const agents = new Set<string>(server.agents ?? DEFAULT_AGENTS);
    if (on) agents.add(agent);
    else agents.delete(agent);
    setAiMcpServers(list.map((value, i) => i === index ? { ...value, agents: [...agents] } : value));
  }

  /** 딸린 줄의 꼬리 — 명령/URL 뒤에 ` · 환경 변수 N개 · 헤더 N개`(있는 것만) */
  function countsText(server: (typeof list)[number]): string {
    const parts: string[] = [];
    if (server.env?.length) parts.push(t("settings.ai.external.env_count", { count: server.env.length }));
    if (server.headers?.length) parts.push(t("settings.ai.external.headers_count", { count: server.headers.length }));
    return parts.map((p) => ` · ${p}`).join("");
  }

  /** 사이드 채팅 칩 — 켜고 끄기(끄면 '묻지 않기' 도 걷는다 · `toggleSideChat`) */
  function toggleSide(index: number) {
    setAiMcpServers(list.map((value, i) => i === index ? toggleSideChat(value) : value));
  }

  function setEnabled(index: number, enabled: boolean) {
    setAiMcpServers(list.map((value, i) => i === index ? { ...value, enabled } : value));
  }
</script>

<SubViewStack view={viewKey} {dir} {onescape} bind:root={rootEl}>
  {#if view.kind === "pinned"}
    {@render pinnedView(back)}
  {:else if view.kind === "add"}
    <McpServerEditor index={null} {targets} {projectOptions}
      onback={back} onsaved={(i) => void closeSub(true, i)} ondeleted={() => void closeSub(true)} />
  {:else if view.kind === "edit"}
    <McpServerEditor index={view.index} {targets} {projectOptions}
      onback={back} onsaved={(i) => void closeSub(true, i)} ondeleted={() => void closeSub(true)} />
  {:else}
    <p class="lead">
      <InfoNote id="ai-mcp-servers-info" label={t("settings.ai.external.subhead")} plain>
        {#snippet summary()}{t("settings.ai.external.subhead")}{/snippet}
        {#snippet note()}{t("settings.ai.external.note")}{/snippet}
      </InfoNote>
    </p>

    <div class="list-head">
      <h4 class="subhead" id="ai-mcp-servers">{t("settings.ai.external.list.subhead")}</h4>
      <button type="button" id="ai-mcp-add" class="btn btn-sm btn-secondary mcp-add" bind:this={addBtn}
        onclick={() => openSub({ kind: "add" })}>
        <UiIcon name="plus" size={12} />
        <span>{t("settings.ai.external.add")}</span>
        <UiIcon name="chevron" size={12} />
      </button>
    </div>

    <!-- 줄 모양은 설정 공용 목록(`settings.css` 의 `.slist`) — 트리거 · 스니펫 · AI 에이전트와 한 벌이다.
         고정 줄(`pinned`)이 늘 첫 줄이고, 외부 서버가 없으면 빈 목록 카드가 그 밑에 따로 선다 -->
    <div class="slist mcp-rows">
      {@render pinned(openPinned)}
      {#each visible as { server, index } (index)}
        {@const summary = serverSummary(server)}
        <div class="slist-row mcp-row editable" class:off={!server.enabled} data-mcp-row={index}>
          <!-- 줄 누르기 = 편집(덮개가 꺾쇠 · 빈 자리까지 덮는다). 칩 · 스위치는 이 단추 **밖**에 따로 선다(단추 안 단추는 무효 마크업) -->
          <button type="button" class="slist-open mcp-main mcp-open" data-index={index}
            aria-label={t("settings.ai.external.edit_aria", { name: server.name })}
            onclick={() => openSub({ kind: "edit", index })}>
            <span class="slist-lead" aria-hidden="true"><UiIcon name="server" size={16} /></span>
            <span class="slist-text">
              <span class="slist-title mcp-title">
                <span class="slist-name mcp-name">{server.name}</span>
                <span class="slist-pill scope" class:project={!!server.project_id}
                  title={server.project_id ? t("settings.ai.external.scope_project_note", { name: scopeLabel(server.project_id) }) : t("settings.ai.external.scope_global_note")}>
                  {server.project_id ? t("settings.ai.external.scope_project_only", { name: scopeLabel(server.project_id) }) : t("settings.ai.external.scope_global")}
                </span>
              </span>
              <span class="slist-sup mcp-detail" title={summary}
                ><span class="slist-mono">{summary}</span>{countsText(server)}</span
              >
            </span>
          </button>
          <span class="slist-trail">
            <span class="mcp-agents">
              {#each targets as target (target.id)}
                {@const pressed = (server.agents ?? DEFAULT_AGENTS).includes(target.id)}
                <AgentChip agent={target} {pressed}
                  title={t(pressed ? "settings.ai.external.agent_on" : "settings.ai.external.agent_off", { name: server.name, agent: target.display })}
                  onclick={() => toggle(index, target.id, !pressed)} />
              {/each}
              <span class="mcp-divider" aria-hidden="true"></span>
              <!-- 사이드 채팅 칩(2026-10-25) — 그 자리에서 켜고 끈다 · '묻지 않기' 가 켜졌으면 오른쪽 위 초록 점 -->
              <AgentChip agent={{ id: "side-chat", display: t("settings.ai.external.side_chat") }} pressed={!!server.side_chat}
                dot={!!server.side_chat && !!server.side_chat_no_ask}
                title={t(!server.side_chat ? "settings.ai.external.side_chat_row_off" : server.side_chat_no_ask ? "settings.ai.external.side_chat_row_no_ask" : "settings.ai.external.side_chat_row_ask", { name: server.name })}
                onclick={() => toggleSide(index)}>
                {#snippet icon()}<UiIcon name="side-panel" size={14} />{/snippet}
              </AgentChip>
            </span>
            <span class="slist-switch">
              <Toggle checked={server.enabled} onchange={(enabled) => setEnabled(index, enabled)}
                label={t("settings.ai.external.enabled_aria", { name: server.name })}
                title={t("settings.ai.external.enabled_note")} />
            </span>
            <!-- 꺾쇠는 그림일 뿐 — 누르면 줄 단추의 덮개가 받는다 -->
            <span class="slist-chev mcp-edit-btn" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
          </span>
        </div>
      {/each}
    </div>
    {#if visible.length === 0}
      <p class="slist-empty mcp-empty">{t("settings.ai.external.empty")}</p>
    {/if}
  {/if}
</SubViewStack>

<style>
  .mcp-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* 목록 · 줄 · 알약 모양은 `settings.css` 의 공용 `.slist` 한 벌이다(고정 줄도 같은 클래스라 `:global` 이 필요 없다).
     범위는 "무엇인지"(분류)라 프로젝트 범위만 제3색 — 강조색은 선택 · 주 동작에 남긴다 */
  .scope.project {
    color: var(--tertiary);
    background: var(--tertiary-soft);
  }

  .mcp-agents {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* AI 타일 칩 │ 사이드 채팅 칩 */
  .mcp-divider {
    width: 1px;
    height: 16px;
    margin: 0 2px;
    background: var(--line);
  }
</style>
