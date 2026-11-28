<script lang="ts">
  import StatusChip from "$lib/settings/StatusChip.svelte";
  import {
    agentHooksStatus,
    setAgentHooks,
    agentArgsTargets,
    agentLaunchPreview,
    type AgentArgsTarget,
    type AgentLaunchPreview,
    type AgentHooksStatus,
    type AgentHooksTarget,
  } from "$lib/context";
  import { hookTargets, loadHookTargets } from "$lib/app/agent-hooks.svelte.js";
  import { detectedAiClis, refreshKnownAiClis } from "$lib/app/panes.svelte.js";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
  import { isRemote } from "$lib/ipc";
  import { askHookInstall } from "$lib/app/confirm-dialog.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import { iconRef } from "$lib/host-icons";
  import { aiIconName } from "$lib/pane-icons";
  import { agentAnchor } from "$lib/settings-index";
  import { agentEnabled } from "$lib/agent-enabled";
  import type { Key } from "$lib/i18n/keys";
  import {
    settings,
    setAgentEnabled,
    setAgentExtraArgs,
    setAiStartDir,
    setChatTile,
    setClaudeStatusline,
    setCodexNoDaemon,
  } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { active = false }: { active?: boolean } = $props();
  const clis = $derived(detectedAiClis());

  let pickingDir = $state(false);

  /** 폴더가 있는지 여기서 따지지 않는다 — 판정은 백엔드 `pty.rs` 의 `spawn_cwd` 하나다(없으면 조용히 홈) */
  async function pickStartDir() {
    if (pickingDir) return;
    pickingDir = true;
    try {
      const picked = await openFolderDialog({
        directory: true,
        multiple: false,
        defaultPath: settings.aiStartDir,
        title: t("settings.ai.start_dir.dialog"),
      });
      if (typeof picked === "string") setAiStartDir(picked);
    } catch {
      /* 대화상자를 못 띄워도 텍스트 칸으로 적을 수 있다 — 조용히 넘어간다 */
    } finally {
      pickingDir = false;
    }
  }

  let hooks = $state<Record<string, AgentHooksStatus | null>>({});
  /** 그동안 모든 훅 버튼을 잠근다 — 에이전트들이 공용 스크립트를 함께 만진다 */
  let hooksBusy = $state<string | null>(null);
  let hooksMessage = $state<Record<string, string | null>>({});

  async function loadHooks() {
    await loadHookTargets();
    for (const target of hookTargets()) {
      void agentHooksStatus(target.id).then((h) => (hooks[target.id] = h));
    }
  }

  /**
   * 설치는 사용자의 훅 설정 파일을 고치므로 쓸 내용을 보여 주는 확인 창을 먼저 띄우고, 못 띄우면 쓰지 않는다.
   * 제거는 우리 항목만 빼므로 확인 없이 한다 (docs/log/2026-09-24-agent-hook-signals.md).
   */
  async function changeHooks(target: AgentHooksTarget, install: boolean) {
    const st = hooks[target.id];
    if (hooksBusy !== null || !st) return;
    hooksMessage[target.id] = null;
    if (install) {
      let go = false;
      try {
        go = await askHookInstall(target.display, {
          remote: null,
          scriptPath: st.scriptPath,
          settingsPath: st.settingsPath,
          preview: st.preview,
        });
      } catch {
        return;
      }
      if (!go) return;
    }
    hooksBusy = target.id;
    try {
      hooks[target.id] = await setAgentHooks(target.id, install);
      hooksMessage[target.id] = t(install ? "settings.ai.hooks.done.install" : "settings.ai.hooks.done.remove", {
        agent: target.display,
      });
    } catch (e) {
      hooksMessage[target.id] = t("settings.ai.hooks.failed", {
        agent: target.display,
        reason: e instanceof Error ? e.message : String(e),
      });
      hooks[target.id] = await agentHooksStatus(target.id);
    } finally {
      hooksBusy = null;
    }
  }

  /**
   * 추가 인자는 판정(Rust `agent_launch_preview`)을 통과한 값만 설정에 적는다 — 어긋난 값은 초안(`argsDraft`)으로만 남는다
   * (docs/log/2026-09-27-agent-extra-args.md).
   */
  let argsTargets = $state<AgentArgsTarget[]>([]);
  let argsDraft = $state<Record<string, string>>({});
  let argsPreview = $state<Record<string, AgentLaunchPreview | null>>({});

  function argsShown(id: string): string {
    return argsDraft[id] ?? settings.current.ai.args?.[id] ?? "";
  }

  // 늦게 온 답은 그새 바뀐 칸을 덮지 않는다
  $effect(() => {
    const noDaemon = settings.codexNoDaemon;
    const shell = settings.current.shell.default ?? null;
    for (const target of argsTargets) {
      const id = target.id;
      const value = argsShown(id);
      void agentLaunchPreview(id, value, noDaemon, shell).then((pv) => {
        if (argsShown(id) !== value) return;
        argsPreview[id] = pv;
        if (pv && pv.error === null && argsDraft[id] !== undefined) {
          setAgentExtraArgs(id, value);
          delete argsDraft[id];
        }
      });
    }
  });

  const AGENT_ORDER = ["claude", "codex"];
  const agents = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const x of hookTargets()) if (!seen.has(x.id)) seen.set(x.id, x.display);
    for (const x of argsTargets) if (!seen.has(x.id)) seen.set(x.id, x.display);
    for (const x of clis ?? []) if (!seen.has(x.id)) seen.set(x.id, x.name);
    const rank = (id: string) => {
      const i = AGENT_ORDER.indexOf(id);
      return i < 0 ? AGENT_ORDER.length : i;
    };
    return [...seen]
      .map(([id, display]) => ({ id, display }))
      .sort((a, b) => rank(a.id) - rank(b.id));
  });

  /** `domId` 는 팔레트 색인 · 하네스가 찾는 id 다 — 바꾸지 않는다 */
  const AGENT_SWITCH: Record<
    string,
    { domId: string; label: Key; note: Key; get: () => boolean; set: (on: boolean) => void }
  > = {
    // `[ai] claude_statusline` — 키 이름은 옛것(상태줄 → mod)이지만 설정 키라 그대로다 · 다음에 여는 타일부터
    claude: {
      domId: "ai-claude-statusline",
      label: "settings.ai.claude_statusline.label",
      note: "settings.ai.claude_statusline.note",
      get: () => settings.claudeStatusline,
      set: setClaudeStatusline,
    },
    // `[ai] codex_no_daemon` — `--no-daemon` 이라야 훅 신호가 제 타일로 간다 · 다음에 여는 타일부터 (docs/log/2026-09-26-codex-hooks.md)
    codex: {
      domId: "ai-codex-no-daemon",
      label: "settings.ai.codex_no_daemon.label",
      note: "settings.ai.codex_no_daemon.note",
      get: () => settings.codexNoDaemon,
      set: setCodexNoDaemon,
    },
  };

  // 섹션을 보기 전에 읽어 둔다 — 팔레트가 이 섹션을 처음 펼 때 블록(anchor)이 이미 있어야 자리를 찾는다
  void loadHookTargets();
  void agentArgsTargets().then((list) => (argsTargets = list));

  let expanded = $state<string | null>(null);
  const openIndex = $derived(agents.findIndex((a) => a.id === expanded));

  /** 팔레트로 펼칠 때만 전이를 건너뛴다(`instant`) — 함께 닫히는 카드도 즉시 닫아야 스크롤하는 동안 자리가 밀리지 않는다 */
  let instant = $state(false);
  export function expandForAnchor(anchor: string): void {
    for (const agent of agents) {
      const ids = [agentAnchor(agent.id, "hooks"), agentAnchor(agent.id, "args"), AGENT_SWITCH[agent.id]?.domId];
      if (!ids.includes(anchor)) continue;
      if (expanded !== agent.id) instant = true;
      expanded = agent.id;
      requestAnimationFrame(() => requestAnimationFrame(() => (instant = false)));
    }
  }

  let loaded = false;
  $effect(() => {
    if (!active || loaded) return;
    loaded = true;
    void loadHooks();
  });

  /** 설치 명령은 판마다 바뀌어 앱에 적지 않는다 — 공식 문서로만 보낸다 */
  const INSTALL_DOCS: Record<string, string> = {
    claude: "https://code.claude.com/docs/en/setup",
    codex: "https://github.com/openai/codex",
  };
  function openInstallDoc(url: string): void {
    void openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
  }
  $effect(() => {
    if (!active) return;
    const recheck = () => void refreshKnownAiClis();
    recheck();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  });
</script>

<!-- 줄에는 늘 보이는 설명 줄을 두지 않는다 — 설명은 이름의 툴팁(`TipName`), 줄 밑에는 상태에 따른 안내만 -->

<p class="lead">
  <InfoNote id="ai-info" label={t("settings.ai.subhead")} plain>
    {#snippet summary()}{t("settings.ai.summary")}{/snippet}
    {#snippet note()}{t("settings.ai.note")}{/snippet}
  </InfoNote>
</p>
<p class="footnote">{t("settings.ai.footnote")}</p>

<h4 class="subhead">{t("settings.ai.common.subhead")}</h4>

<div class="rows term">
  <div class="srow wide-field">
    <TipName
      id="ai-start-dir"
      for="ai-start-dir"
      label={t("settings.ai.start_dir.label")}
      tip={t("settings.ai.start_dir.note.before") +
        t("settings.ai.start_dir.note.term") +
        t("settings.ai.start_dir.note.after")}
    />
    <div class="size-row">
      <input
        id="ai-start-dir"
        class="value dir"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder={t("settings.ai.start_dir.placeholder")}
        value={settings.aiStartDir ?? ""}
        oninput={(e) => setAiStartDir(e.currentTarget.value)}
      />
      <!-- [찾아보기…] 는 메인 PC 의 대화상자라 원격 창에는 없다 -->
      {#if !isRemote}
        <button type="button" class="btn btn-sm btn-secondary" disabled={pickingDir} onclick={() => void pickStartDir()}>
          <UiIcon name="folder-open" size={13} />{t("settings.ai.start_dir.browse")}
        </button>
      {/if}
    </div>
  </div>
  <!-- `[ai] chat_tile` — 새 타일 메뉴의 [채팅]만 가린다(이미 연 채팅 타일은 그대로 돈다) -->
  <div class="srow">
    <TipName id="ai-chat-tile" for="ai-chat-tile" label={t("settings.ai.chat_tile.label")} tip={t("settings.ai.chat_tile.note")} />
    <div class="size-row">
      <Toggle id="ai-chat-tile" checked={settings.chatTile} onchange={setChatTile} />
    </div>
  </div>
</div>

<div class="slist accordion agent-list">
  {#each agents as agent, i (agent.id)}
    {@const logo = aiIconName(agent.id)}
    {@const cli = clis?.find((x) => x.id === agent.id)}
    {@const hookTarget = hookTargets().find((x) => x.id === agent.id) ?? null}
    {@const hasArgs = argsTargets.some((x) => x.id === agent.id)}
    {@const sw = AGENT_SWITCH[agent.id]}
    {@const enabled = agentEnabled(agent.id, settings.disabledAgents)}
    {@const enabledId = agentAnchor(agent.id, "enabled")}
    {@const hst = hooks[agent.id] ?? null}
    {@const hookPartial = !!hst?.partial && !hst?.installed}
    {@const open = expanded === agent.id}
    {@const bodyId = `${agentAnchor(agent.id, "agent")}-body`}
    {@const gFirst = i === 0 || i === openIndex || i === openIndex + 1}
    {@const gLast = i === agents.length - 1 || i === openIndex || i === openIndex - 1}
    <section
      class="slist-item agent-item"
      class:off={!enabled}
      class:open
      class:instant
      class:g-first={gFirst}
      class:g-last={gLast}
      id={agentAnchor(agent.id, "agent")}
      data-agent={agent.id}
      data-agent-enabled={enabled ? "" : undefined}
      data-agent-open={open ? "" : undefined}
    >
      <div class="slist-row agent-head">
        <button
          type="button"
          class="slist-open agent-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          data-agent-expand={agent.id}
          onclick={() => (expanded = open ? null : agent.id)}
        >
          <span class="slist-lead logo" aria-hidden="true">
            {#if logo}<HostIcon icon={iconRef(logo)} size={16} />{:else}<UiIcon name="ai" size={16} />{/if}
          </span>
          <span class="slist-text">
            <span class="slist-title"><span class="slist-name agent-name">{agent.display}</span></span>
            <span class="slist-sup badges">
              <!-- 하네스가 `data-agent-install` 의 글자로 읽는다 -->
              <StatusChip
                tone={cli?.installed ? "ok" : cli ? "off" : "idle"}
                data-agent-install={agent.id}
                title={cli !== undefined && !cli.installed ? t("settings.ai.cli.install.no") : undefined}
                data-tip-place="above"
              >
                {t(clis === null ? "settings.ai.checking" : !cli ? "settings.ai.cli.install.unknown"
                  : cli.installed ? "settings.ai.cli.install.yes" : "settings.ai.cli.install.no.short")}
              </StatusChip>
              {#if hookTarget}
                <StatusChip
                  tone={hst?.installed ? "ok" : hookPartial ? "warn" : hst ? "off" : "idle"}
                  data-agent-hooks-badge={agent.id}
                  data-hooks-state={hst === null ? "unknown" : hst.installed ? "installed" : hst.partial ? "partial" : "none"}
                  title={hookPartial ? t("settings.ai.hooks.partial.tip") : undefined}
                  data-tip-place="above"
                >
                  {t(hst === null ? "settings.ai.hooks.badge.unknown" : hst.installed ? "settings.ai.hooks.badge.installed"
                    : hst.partial ? "settings.ai.hooks.badge.partial" : "settings.ai.hooks.badge.none")}
                </StatusChip>
              {/if}
            </span>
          </span>
        </button>
        <span class="slist-trail">
          {#if cli !== undefined && !cli.installed && INSTALL_DOCS[agent.id]}
            <!-- 머리줄 단추 안에 둘 수 없어 끝 칸에 선다 -->
            <button type="button" class="install-how" data-agent-install-how={agent.id}
              onclick={() => openInstallDoc(INSTALL_DOCS[agent.id])}>
              {t("settings.ai.cli.install.how")}<UiIcon name="external" size={12} />
            </button>
          {/if}
          <span class="slist-switch head-toggle" id="{enabledId}-wrap" title={t("settings.ai.agent.enabled.tip")} data-tip-place="above">
            <Toggle
              id={enabledId}
              checked={enabled}
              label={t("settings.ai.agent.enabled.aria", { agent: agent.display })}
              onchange={(on) => setAgentEnabled(agent.id, on)}
            />
          </span>
          <span class="slist-chev chev" aria-hidden="true"><UiIcon name="chevron-down" size={16} /></span>
        </span>
      </div>

      <div class="slist-collapse agent-collapse" id={bodyId} inert={!open}>
        <div class="slist-collapse-inner agent-collapse-inner">
          <div class="slist-panel agent-panel">
            {#if !enabled}
              <p class="off-note" data-agent-off={agent.id}>{t("settings.ai.agent.off")}</p>
            {:else}
              <div class="rows term slist-body agent-body">
                {#if hookTarget}
                  <!-- 훅 단추는 [저장] 과 무관하게 누르는 즉시 그 에이전트의 훅 설정 파일을 고친다(확인 창을 거친 뒤) -->
                  {@const st = hooks[agent.id] ?? null}
                  {@const trust = hookTarget.needsTrustNote ? t("settings.ai.hooks.trust", { agent: hookTarget.display }) : null}
                  {@const hookNote = trust !== null || !!st?.error || !!hooksMessage[agent.id]}
                  <div class="srow">
                    <!-- 이름이 곧 색인 anchor 다(`nameId`) -->
                    <TipName
                      id="{agentAnchor(agent.id, 'hooks')}-name"
                      nameId={agentAnchor(agent.id, "hooks")}
                      label={t("settings.ai.hooks.label")}
                      tip={t("settings.ai.hooks.note")}
                    />
                    <div class="size-row wrap-row" data-agent-hooks={agent.id}>
                      <button
                        type="button"
                        class="btn btn-sm btn-secondary"
                        data-hooks-install
                        disabled={hooksBusy !== null || st === null || st.error !== null}
                        onclick={() => void changeHooks(hookTarget, true)}
                      >
                        {hooksBusy === agent.id
                          ? t("settings.ai.hooks.busy")
                          : st?.installed
                            ? t("settings.ai.hooks.reinstall")
                            : st?.partial
                              ? t("settings.ai.hooks.update")
                              : t("settings.ai.hooks.install")}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm btn-secondary danger"
                        data-hooks-remove
                        disabled={hooksBusy !== null || st === null || !(st.installed || st.partial)}
                        onclick={() => void changeHooks(hookTarget, false)}
                      >
                        {t("settings.ai.hooks.remove")}
                      </button>
                    </div>

                    {#if hookNote}
                      <p class="footnote mcp-note">
                        {#if trust !== null}{trust}<br />{/if}
                        {#if st?.error}<span role="alert">{st.error}</span><br />{/if}
                        {#if hooksMessage[agent.id]}<span role="status">{hooksMessage[agent.id]}</span>{/if}
                      </p>
                    {/if}
                  </div>
                {/if}

                {#if sw}
                  <div class="srow">
                    <TipName id={sw.domId} for={sw.domId} label={t(sw.label)} tip={t(sw.note)} />
                    <div class="size-row">
                      <Toggle id={sw.domId} checked={sw.get()} onchange={sw.set} />
                    </div>
                  </div>
                {/if}

                {#if hasArgs}
                  {@const pv = argsPreview[agent.id]}
                  {@const argsId = agentAnchor(agent.id, "args")}
                  <div class="srow">
                    <TipName id={argsId} for={argsId} label={t("settings.ai.args.label")} tip={t("settings.ai.args.note")} />
                    <div class="size-row">
                      <input
                        id={argsId}
                        class="value args"
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        placeholder={t("settings.ai.args.placeholder")}
                        aria-invalid={pv?.error ? "true" : undefined}
                        value={argsShown(agent.id)}
                        oninput={(e) => (argsDraft[agent.id] = e.currentTarget.value)}
                      />
                    </div>

                    <p class="footnote args-preview">
                      {#if pv?.error}
                        <span class="args-error" role="alert">{t("settings.ai.args.invalid", { reason: pv.error })}</span>
                      {:else if pv?.line}
                        {t("settings.ai.args.preview")} <code>{pv.line}</code>
                      {/if}
                      {#if pv && pv.dangerous.length > 0}
                        <br /><span class="args-warn" role="note"
                          >{t("settings.ai.args.danger", { agent: agent.display })} (<code>{pv.dangerous.join(" ")}</code>)</span
                        >
                      {/if}
                    </p>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </section>
  {/each}
</div>

<style>
  .agent-list.slist {
    margin-top: var(--space-5);
  }

  .agent-head .badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    white-space: normal;
  }

  .install-how {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--accent);
    background: none;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }
  .install-how:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .install-how:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .off-note {
    margin: 0;
    padding: 10px 12px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
    word-break: keep-all;
    background: var(--slist-face);
    border-radius: var(--radius-surface-inner);
  }

  .wrap-row {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .size-row .value.dir {
    flex: 1 1 auto;
    width: 12em;
    min-width: 6em;
  }

  .size-row .value.dir + .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    gap: var(--space-2);
    font-size: var(--t-sm);
  }

  .size-row .value.args {
    width: 18em;
    min-width: 8em;
    max-width: 100%;
    font-family: var(--font-mono);
  }

  .size-row .value.args[aria-invalid="true"] {
    border-color: var(--err);
  }

  .args-preview code {
    word-break: break-all;
    user-select: text;
  }

  .args-error {
    color: var(--err);
  }

  .args-warn {
    color: var(--warn);
  }
</style>
