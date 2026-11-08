<script lang="ts">
  import { tick, untrack } from "svelte";
  import {
    agentArgsTargets, instructionSave, instructionsList, sideChatInstructionsLoad,
    type AgentArgsTarget, type Instruction, type InstructionList,
  } from "$lib/context";
  import { projects } from "$lib/app/project-list.svelte.js";
  import { formToInstruction, instructionToForm } from "$lib/settings/model/instruction-form";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import UiIcon from "$lib/UiIcon.svelte";
  import InfoNote from "./InfoNote.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import AgentChip from "./AgentChip.svelte";
  import SubViewStack from "./SubViewStack.svelte";
  import InstructionEditor from "./InstructionEditor.svelte";
  import InstructionsApply from "./InstructionsApply.svelte";
  import InstructionsImport from "./InstructionsImport.svelte";
  import SideChatInstructionEditor from "./SideChatInstructionEditor.svelte";

  /**
   * 지침은 **자기 파일**(<설정 루트>/instructions/*.md)에 즉시 저장한다.
   * 설정 창 [저장]/[취소]와 무관하고, 에이전트가 읽는 파일에 쓰는 일은 별도 [반영]이다.
   * 요약 ↔ 추가·편집·반영의 자리·움직임·Escape는 기존 공용 틀을 따른다.
   * 섹션을 떠나면 초안은 버리고 요약으로 돌아간다. 돌아온 포커스는 연 줄/단추에 둔다.
   * **사이드 채팅 지침**(2026-11-01)은 목록 밖의 고정 줄 하나 — `<데이터 루트>/sidechat/CLAUDE.md` 에 즉시 저장하고 [반영]이 없다
   * (세션 서버가 채팅을 띄울 때 읽는다 — `SideChatInstructionEditor`).
   */
  let { active = true, onloaded }: { active?: boolean; onloaded?: () => void } = $props();
  let list = $state<InstructionList>({ items: [], broken: [] });
  let targets = $state<AgentArgsTarget[]>([]);
  const projectTargets: AgentArgsTarget[] = [{ id: "claude", display: "Claude Code" }, { id: "codex", display: "Codex" }];
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<"saved" | "deleted" | "imported" | "side-saved" | null>(null);
  /** 사이드 채팅 지침 글(없으면 빈 글) — 못 읽었으면 `null`(줄은 서되 편집은 막는다) */
  let sideText = $state<string | null>(null);
  let importedCount = $state(0);
  let importFailures = $state<{ source: string; reason: string }[]>([]);
  let request = 0;

  type View = { kind: "summary" } | { kind: "add" } | { kind: "edit"; name: string } | { kind: "apply" } | { kind: "import" } | { kind: "side-chat" };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  let applyBtn = $state<HTMLButtonElement | null>(null);
  let importBtn = $state<HTMLButtonElement | null>(null);
  let sideBtn = $state<HTMLButtonElement | null>(null);
  const viewKey = $derived(view.kind === "edit" ? "edit-" + view.name : view.kind);
  const editing = $derived.by(() => {
    const current = view;
    return current.kind === "edit" ? list.items.find((item) => item.name === current.name) ?? null : null;
  });
  const onescape = $derived(view.kind === "summary" ? null : back);

  $effect(() => {
    if (!active) {
      request++;
      loading = false;
      untrack(() => void closeSub(false));
    } else untrack(() => void refresh());
  });

  async function refresh(): Promise<void> {
    if (!active || saving) return;
    const current = ++request;
    loading = true;
    error = null;
    try {
      // 사이드 채팅 지침은 따로 읽는다 — 못 읽어도 지침 목록은 선다
      const side = sideChatInstructionsLoad().then((text) => text, () => null);
      const [instructions, agents] = await Promise.all([instructionsList(), agentArgsTargets()]);
      const sideLoaded = await side;
      if (current !== request) return;
      sideText = sideLoaded;
      if (current !== request) return;
      list = instructions;
      targets = agents.filter((agent) => agent.id === "claude" || agent.id === "codex");
      // agentArgsTargets가 실패하면 빈 표를 돌려준다. 이미 지원하는 두 대상은 계속 고를 수 있다.
      if (targets.length === 0) targets = [{ id: "claude", display: "Claude Code" }, { id: "codex", display: "Codex" }];
      onloaded?.();
    } catch (e) {
      if (current === request) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.load"));
    } finally {
      if (current === request) loading = false;
    }
  }

  function openSub(next: View): void {
    if (loading || saving) return;
    dir = "fwd";
    view = next;
    const panel = rootEl?.closest<HTMLElement>(".settings-panel");
    if (panel) panel.scrollTop = 0;
  }

  async function closeSub(returnFocus: boolean, name: string | null = null): Promise<void> {
    if (view.kind === "summary") return;
    const fromApply = view.kind === "apply";
    const fromImport = view.kind === "import";
    const fromSide = view.kind === "side-chat";
    dir = returnFocus ? "back" : null;
    view = { kind: "summary" };
    if (!returnFocus) return;
    await tick();
    const el = name === null ? (fromApply ? applyBtn : fromImport ? importBtn : fromSide ? sideBtn : addBtn)
      : rootEl?.querySelector<HTMLElement>('.instruction-open[data-name="' + CSS.escape(name) + '"]') ?? addBtn;
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }
  function back(): void { if (!saving) void closeSub(true, view.kind === "edit" ? view.name : null); }
  /** 팔레트의 앵커는 요약에 있으므로 같은 섹션의 하위 화면에서도 먼저 요약을 연다. */
  export function showSummary(): void { void closeSub(false); }

  function put(item: Instruction, previousName: string | null): void {
    list = { ...list, items: [...list.items.filter((old) => old.name !== previousName && old.name !== item.name), item]
      .sort((a, b) => a.name.localeCompare(b.name)) };
  }
  function saved(item: Instruction): void {
    put(item, view.kind === "edit" ? view.name : null);
    notice = "saved";
    void closeSub(true, item.name);
  }
  function imported(items: Instruction[], failures: { source: string; reason: string }[]): void {
    for (const item of items) put(item, null);
    importedCount = items.length;
    importFailures = failures;
    notice = "imported";
    void closeSub(true);
  }
  function sideSaved(text: string): void {
    sideText = text;
    notice = "side-saved";
    void closeSub(true);
  }
  function deleted(): void {
    const name = view.kind === "edit" ? view.name : null;
    list = { ...list, items: list.items.filter((item) => item.name !== name) };
    notice = "deleted";
    void closeSub(true);
  }

  async function saveRow(item: Instruction, next: Instruction): Promise<void> {
    if (saving || loading) return;
    saving = true;
    error = null;
    // Toggle의 화면도 실패 때 원래 값으로 돌아가도록 먼저 초안을 표시하고 실패하면 되돌린다.
    put(next, item.name);
    try {
      const saved = await instructionSave(next, item.name);
      put(saved, item.name);
      notice = "saved";
    } catch (e) {
      put(item, next.name);
      error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.error.save"));
    } finally { saving = false; }
  }
  function toggleAgent(item: Instruction, id: string): void {
    const form = instructionToForm(item);
    form.agents = form.agents.includes(id) ? form.agents.filter((agent) => agent !== id) : [...form.agents, id];
    const next = formToInstruction(form);
    if (!next) { error = t("settings.instructions.error.agents"); return; }
    void saveRow(item, next);
  }
  function scopeLabel(item: Instruction): string {
    const label = item.scope === "global" ? t("settings.instructions.scope.global")
      : item.projects.length === 0 || item.projects.length > 2
        ? t("settings.instructions.scope.count", { count: item.projects.length })
        : item.projects.map((id) => projects().find((project) => project.id === id)?.name
          ?? t("settings.instructions.project.unknown", { id })).join(" · ");
    return item.subpath ? label + " · " + item.subpath : label;
  }
</script>

<SubViewStack view={viewKey} {dir} {onescape} bind:root={rootEl}>
  {#if view.kind === "add" || view.kind === "edit"}
    <InstructionEditor item={editing} {targets} onback={back} onsaved={saved} ondeleted={deleted} />
  {:else if view.kind === "apply"}
    <InstructionsApply onback={back} onapplied={() => { notice = null; }} />
  {:else if view.kind === "import"}
    <InstructionsImport onback={back} onimported={imported} onbusy={(busy) => { saving = busy; }} />
  {:else if view.kind === "side-chat"}
    <SideChatInstructionEditor text={sideText ?? ""} onback={back} onsaved={sideSaved} />
  {:else}
    <!-- 머리 — MCP 섹션(`ExternalMcpServers`)과 같은 틀: 한 줄 설명(ⓘ 자세히) · 각주 · 목록 소제목과 단추 -->
    <p class="lead">
      <InfoNote id="instructions-info" label={t("settings.instructions.subhead")} plain>
        {#snippet summary()}{t("settings.instructions.summary")}{/snippet}
        {#snippet note()}{t("settings.instructions.note")}{/snippet}
      </InfoNote>
    </p>
    <p class="footnote">{t("settings.instructions.footnote")}</p>

    <!-- 사이드 채팅 지침 — 목록 밖 고정 줄 하나(같은 `.slist` 줄 모양). 내 지침은 늘어나므로 고정 줄을 위에 둔다. 누르면 하위 화면에서 고친다 · 저장은 즉시 · [반영] 없음 -->
    <h4 class="subhead">{t("settings.instructions.side_chat.subhead")}</h4>
    <ul class="slist" aria-label={t("settings.instructions.side_chat.subhead")}>
      <li class="slist-row">
        <button type="button" id="instructions-side-chat" class="slist-open" bind:this={sideBtn}
          disabled={loading || saving || sideText === null} aria-label={t("settings.instructions.side_chat.edit.aria")}
          onclick={() => openSub({ kind: "side-chat" })}>
          <span class="slist-lead" aria-hidden="true"><UiIcon name="chat" size={16} /></span>
          <span class="slist-text">
            <span class="slist-title">
              <span class="slist-name">{t("settings.instructions.side_chat.name")}</span>
              {#if sideText !== null}
                <span class="slist-pill">{t(sideText.trim() ? "settings.instructions.side_chat.state.set" : "settings.instructions.side_chat.state.empty")}</span>
              {/if}
            </span>
          </span>
        </button>
        <span class="slist-trail"><span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span></span>
      </li>
    </ul>
    {#if sideText === null && !loading}<p class="error" role="alert">{t("settings.instructions.side_chat.error.load")}</p>{/if}

    <div class="list-head">
      <h4 class="subhead">{t("settings.instructions.list.subhead")}</h4>
      <div class="size-row">
        <button type="button" id="instructions-import" class="btn btn-sm btn-secondary instruction-action" bind:this={importBtn}
          disabled={loading || saving} onclick={() => openSub({ kind: "import" })}>
          <span>{t("settings.instructions.import")}</span><UiIcon name="chevron" size={12} />
        </button>
        <button type="button" id="instructions-add" class="btn btn-sm btn-secondary instruction-action" bind:this={addBtn}
          disabled={loading || saving} onclick={() => openSub({ kind: "add" })}>
          <UiIcon name="plus" size={12} /><span>{t("settings.instructions.add")}</span><UiIcon name="chevron" size={12} />
        </button>
      </div>
    </div>
    {#if notice}<p class="note notice" role="status">{notice === "imported" ? t("settings.instructions.import.done", { count: importedCount }) : t(notice === "saved" ? "settings.instructions.saved" : notice === "side-saved" ? "settings.instructions.side_chat.saved" : "settings.instructions.deleted")}</p>{/if}
    {#if notice === "imported"}
      {#each importFailures as failure (failure.source)}
        <p class="error" role="alert">{t("settings.instructions.import.failed", { source: failure.source, reason: failure.reason })}</p>
      {/each}
    {/if}
    {#if loading}<p class="note" role="status">{t("settings.instructions.loading")}</p>{/if}
    {#if error}
      <p class="error" role="alert">{error}</p>
      <button type="button" class="btn btn-sm btn-ghost" disabled={loading || saving} onclick={() => void refresh()}>{t("settings.instructions.retry")}</button>
    {/if}
    <div id="instructions-list">
      {#if list.items.length > 0}
        <!-- 줄 모양은 설정 공용 목록(`settings.css` 의 `.slist`) — 트리거 · 스니펫 · AI 에이전트 · MCP 와 한 벌이다 -->
        <ul class="slist instruction-rows" aria-label={t("settings.instructions.list")}>
          {#each list.items as item (item.name)}
            <li class="slist-row instruction-row" class:off={!item.enabled}>
              <!-- 줄 누르기 = 편집(덮개가 꺾쇠 · 빈 자리까지 덮는다). 칩 · 스위치는 이 단추 **밖**에 따로 선다(단추 안 단추는 무효 마크업) -->
              <button type="button" class="slist-open instruction-open" data-name={item.name} disabled={loading || saving}
                aria-label={t("settings.instructions.edit.aria", { name: item.name })}
                onclick={() => openSub({ kind: "edit", name: item.name })}>
                <span class="slist-lead" aria-hidden="true"><UiIcon name="scroll-text" size={16} /></span>
                <span class="slist-text">
                  <span class="slist-title instruction-title">
                    <span class="slist-name">{item.description || item.name}</span>
                    <span class="slist-pill scope" class:project={item.scope === "project"} title={scopeLabel(item)}>{scopeLabel(item)}</span>
                  </span>
                  {#if item.description}<span class="slist-sup instruction-detail" title={item.name}><span class="slist-mono">{item.name}</span></span>{/if}
                </span>
              </button>
              <span class="slist-trail">
                <span class="instruction-agents">
                {#if item.scope === "global"}
                  {#each targets as target (target.id)}
                    <AgentChip agent={target} pressed={item.targets.includes("*") || item.targets.includes(target.id)}
                      disabled={loading || saving} title={t("settings.instructions.agent.toggle", { agent: target.display })}
                      onclick={() => toggleAgent(item, target.id)} />
                  {/each}
                {:else}
                  {#each projectTargets as target (target.id)}
                    <AgentChip agent={target} pressed fixed title={t("settings.instructions.agents.project.help")} />
                  {/each}
                {/if}
                </span>
                <span class="slist-switch">
                  <Toggle checked={item.enabled} disabled={loading || saving}
                    label={t("settings.instructions.enabled.aria", { name: item.name })} title={t("settings.instructions.enabled.help")}
                    onchange={(enabled) => void saveRow(item, { ...item, enabled })} />
                </span>
                <!-- 꺾쇠는 그림일 뿐 — 누르면 줄 단추의 덮개가 받는다 -->
                <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
              </span>
            </li>
          {/each}
        </ul>
      {:else if !loading && !error}<p class="slist-empty instruction-empty">{t("settings.instructions.empty")}</p>{/if}
    </div>
    {#each list.broken as broken (broken.name)}
      <p class="broken" role="alert">{t("settings.instructions.broken", { name: broken.name, reason: stripReason(broken.reason) })}</p>
    {/each}
    <button type="button" id="instructions-apply" class="btn btn-sm btn-secondary apply" bind:this={applyBtn}
      disabled={loading || saving} onclick={() => openSub({ kind: "apply" })}>
      {t("settings.instructions.preview.open")}<UiIcon name="chevron" size={12} />
    </button>
  {/if}
</SubViewStack>

<style>
  .instruction-action, .apply { display: inline-flex; align-items: center; gap: var(--space-1); }
  .note { font-size: var(--t-xs); color: var(--fg-2); line-height: 1.5; }
  .notice { margin-top: 0; }
  .error, .broken { font-size: var(--t-xs); color: var(--err); overflow-wrap: anywhere; }
  /* 목록 · 줄 · 알약 모양은 `settings.css` 의 공용 `.slist` 한 벌이다.
     범위는 "무엇인지"(분류)라 프로젝트 범위만 제3색 — 강조색은 선택 · 주 동작에 남긴다 */
  .scope.project { color: var(--tertiary); background: var(--tertiary-soft); }
  .instruction-agents { display: inline-flex; align-items: center; gap: var(--space-1); }
  .apply { margin-top: var(--space-3); }
</style>
