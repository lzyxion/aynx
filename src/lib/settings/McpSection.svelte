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
    setClaudeStatusline,
    setCodexNoDaemon,
  } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // AI 설치 상태·실행 설정·훅을 다룬다. MCP 서버·등록은 McpManager에 있다.

  let { active = false }: { active?: boolean } = $props();
  /** 감지 값은 독 실행 칸과 한 벌(`detectedAiClis`) — 다시 보는 동안에도 옛 값을 그대로 보여 깜빡이지 않는다 */
  const clis = $derived(detectedAiClis());

  /** 폴더 고르기 대화상자가 떠 있다 — 버튼을 잠근다 (연타로 두 개가 뜨지 않게) */
  let pickingDir = $state(false);

  /**
   * **AI 타일 시작 폴더** 고르기 — 없으면 텍스트 칸에 직접 적어도 된다.
   *
   * 값은 [저장] 을 눌러야 파일에 들어간다 (다른 설정 줄과 같다). 고른 폴더가 지금 있는지
   * 여기서 따지지 않는 이유는 판정이 백엔드에 하나뿐이기 때문이다
   * (`src-tauri/src/pty.rs` 의 `spawn_cwd` — 없으면 조용히 홈).
   */
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
      // 취소는 `null` 이다 — 그때는 적어 둔 값을 건드리지 않는다.
      if (typeof picked === "string") setAiStartDir(picked);
    } catch {
      /* 대화상자를 못 띄워도 텍스트 칸으로 적을 수 있다 — 조용히 넘어간다 */
    } finally {
      pickingDir = false;
    }
  }

  /** 에이전트별 훅 설치 상태 (id → 상태) — 없거나 `null` 이면 아직 모르거나 읽지 못했다 */
  let hooks = $state<Record<string, AgentHooksStatus | null>>({});
  /** 설치·제거 중인 에이전트 id — 그동안 모든 훅 버튼을 잠근다(공용 스크립트를 함께 만진다) */
  let hooksBusy = $state<string | null>(null);
  /** 에이전트별 설치·제거 결과 한 줄 */
  let hooksMessage = $state<Record<string, string | null>>({});

  /** 표의 에이전트마다 상태를 읽는다 — 표가 비어 있으면 먼저 표를 읽는다 */
  async function loadHooks() {
    await loadHookTargets();
    for (const target of hookTargets()) {
      void agentHooksStatus(target.id).then((h) => (hooks[target.id] = h));
    }
  }

  /**
   * **에이전트 훅** 설치·제거 (docs/log/2026-09-24-agent-hook-signals.md · docs/log/2026-09-26-codex-hooks.md).
   *
   * 설치는 사용자의 훅 설정 파일(`~/.claude/settings.json` · `~/.codex/hooks.json`)을 고치므로 **무엇을
   * 쓸지 그대로 보여 주는** 확인 창을 먼저 띄운다(스크립트 경로 · 설정 경로 · 더할 JSON — Rust 가 만든
   * 미리보기). 제거는 우리 항목만 빼므로 확인 없이 바로 한다. 다이얼로그를 못 띄우면 쓰지 않는다(호스트
   * 제거와 같은 규칙). 에이전트는 `target` 하나로 갈린다 — 이 함수는 에이전트를 모른다.
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
   * **에이전트 추가 인자** (docs/log/2026-09-27-agent-extra-args.md) — 칸은 Rust 의 에이전트 표
   * (`agent_args::TARGETS`)를 돌며 그린다. 판정·미리보기는 Rust(`agent_launch_preview`) 한 곳이고, 이 화면은
   * **통과한 값만** 설정에 적는다: 적는 중인 값이 어긋나면 초안(`argsDraft`)으로만 남고 설정은 마지막 통과 값을
   * 지킨다. 초안이 없으면 칸은 설정 값을 그대로 보인다([취소]로 되돌리면 칸도 따라간다).
   */
  let argsTargets = $state<AgentArgsTarget[]>([]);
  /** 에이전트 id → 아직 통과하지 못한(또는 판정을 기다리는) 적는 중인 값 */
  let argsDraft = $state<Record<string, string>>({});
  /** 에이전트 id → 지금 칸 값의 미리보기 */
  let argsPreview = $state<Record<string, AgentLaunchPreview | null>>({});

  /** 칸에 보일 값 — 초안이 있으면 초안, 없으면 설정 값 */
  function argsShown(id: string): string {
    return argsDraft[id] ?? settings.current.ai.args?.[id] ?? "";
  }

  // 칸 값 · Codex 스위치 · 기본 셸이 바뀌면 다시 묻는다. 늦게 온 답은 그새 바뀐 칸을 덮지 않는다.
  $effect(() => {
    const noDaemon = settings.codexNoDaemon;
    const shell = settings.current.shell.default ?? null;
    for (const target of argsTargets) {
      const id = target.id;
      const value = argsShown(id);
      void agentLaunchPreview(id, value, noDaemon, shell).then((pv) => {
        if (argsShown(id) !== value) return;
        argsPreview[id] = pv;
        // 통과한 초안만 설정으로 옮긴다 — 어긋났거나 판정을 못 받았으면(null) 초안으로 남는다.
        if (pv && pv.error === null && argsDraft[id] !== undefined) {
          setAgentExtraArgs(id, value);
          delete argsDraft[id];
        }
      });
    }
  });

  /**
   * **에이전트 목록 하나** — 블록을 그리는 순서와 이름. 세 표(훅 · 추가 인자 · CLI 감지)의 id 를
   * 처음 본 순서로 합치고, 아는 에이전트는 `AGENT_ORDER` 순으로 앞에 세운다(모르는 셋째는 뒤에 본 순서대로).
   * 이름은 먼저 본 표의 것을 쓴다 — 세 표 모두 같은 제품 이름을 낸다.
   */
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

  /**
   * **에이전트만의 스위치** — 에이전트 id 로 찾아 그 블록에 한 줄을 더한다. DOM id 는 예전 그대로다
   * (팔레트 색인 · 하네스가 이 id 로 찾는다).
   */
  const AGENT_SWITCH: Record<
    string,
    { domId: string; label: Key; note: Key; get: () => boolean; set: (on: boolean) => void }
  > = {
    // `[ai] claude_statusline`(이름은 옛것 — 2026-10-10 상태줄 → mod). 켜 두면 로컬 타일의 셸 환경에 한도 mod 를 실어
    // (`CLAUDE_CODE_PLUGIN_DIRS` — Rust `claude_usage.rs`) 그 타일에서 뜨는 claude 가 요금제 한도를 넘긴다(다음에 여는 타일부터).
    claude: {
      domId: "ai-claude-statusline",
      label: "settings.ai.claude_statusline.label",
      note: "settings.ai.claude_statusline.note",
      get: () => settings.claudeStatusline,
      set: setClaudeStatusline,
    },
    // `[ai] codex_no_daemon` (docs/log/2026-09-26-codex-hooks.md "다시 켬 — --no-daemon"). 켜 두면 aynx 이 띄우는
    // codex 와 로컬 타일에서 친 `codex` 가 `--no-daemon` 으로 돌아 훅 신호가 제 타일로 간다(다음에 여는 타일부터).
    codex: {
      domId: "ai-codex-no-daemon",
      label: "settings.ai.codex_no_daemon.label",
      note: "settings.ai.codex_no_daemon.note",
      get: () => settings.codexNoDaemon,
      set: setCodexNoDaemon,
    },
  };

  // 에이전트 표 둘은 빌드마다 고정인 상수 표라 싸다 — 섹션을 **보기 전에** 읽어 둔다. 블록(과 그 안의
  // 팔레트 anchor)이 이 표로 서므로, 팔레트가 이 섹션을 처음 펼 때 줄이 이미 있어야 자리를 찾는다.
  // CLI 감지와 훅 상태는 이 탭을 처음 볼 때 읽는다.
  void loadHookTargets();
  void agentArgsTargets().then((list) => (argsTargets = list));

  /**
   * **펼친 에이전트 하나** (아코디언 — 하나를 펴면 다른 것은 접힌다, 다시 누르면 전부 닫힘) — 화면 상태일 뿐
   * 저장하지 않는다. 기본은 모두 접힘. 머리 줄(설치·훅 상태 · 사용 토글)은 접혀 있어도 늘 보이므로, 펼치는 것은
   * 손볼 때뿐이다 (docs/log/2026-10-05-ai-agent-cards.md).
   */
  let expanded = $state<string | null>(null);
  /** 펼친 칸의 자리(없으면 -1) — 그 칸과 이웃의 모서리를 가른다(아래 "묶음 가르기") */
  const openIndex = $derived(agents.findIndex((a) => a.id === expanded));

  /**
   * 팔레트의 설정 색인이 **몸통 안의 줄**(훅 · 추가 인자 · 에이전트만의 스위치)을 가리키면 그 에이전트 **하나만**
   * 펼친다 — `SettingsModal` 의 `revealPendingAnchor` 가 스크롤 전에 부른다(`McpManager.expandForAnchor` 와 같은 꼴).
   * 머리의 사용 토글(`enabled`)은 늘 보이므로 펼치지 않는다. 펼친 줄이 그 자리에서 곧바로 재어지도록
   * 이때만 전이를 건너뛴다(`instant`) — 함께 닫히는 다른 카드도 즉시 닫아야 스크롤하는 동안 자리가 밀리지 않는다.
   */
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

  /**
   * 설치 안내(2026-11-03) — 공식 설치 문서 · 저장소. 설치 명령은 판마다 바뀌어 앱에 적지 않는다. 모르는 CLI 는 링크가 없다.
   */
  const INSTALL_DOCS: Record<string, string> = {
    claude: "https://code.claude.com/docs/en/setup",
    codex: "https://github.com/openai/codex",
  };
  function openInstallDoc(url: string): void {
    void openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
  }
  // 깔거나 지운 뒤 곧장 맞게 — 이 화면에 들어올 때마다 · 이 화면을 보는 채 창으로 돌아올 때마다 다시 본다(드물게 여는 화면이라 시간 제한을 두지 않는다)
  $effect(() => {
    if (!active) return;
    const recheck = () => void refreshKnownAiClis();
    recheck();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  });
</script>

<!--
  **줄에는 늘 보이는 설명 줄도 머리말도 없다** — 설명은 이름에 얹는 툴팁(`TipName.svelte`, 다른 설정 섹션과
  공용)이다. 훅 오류·설치 결과·추가 인자 미리보기/경고처럼 상태에 따른 안내만 줄 밑에 선다.
-->

<!--
  ── 공통 ── 에이전트를 가리지 않는 줄들. 저장되는 설정 줄이다([저장]). 턴 끝·권한 알림은 알림 섹션(`NotificationsSection`)에 있다.
  홈에서 뜬 Claude Code 는 폴더 안전 확인만 반복하고 프로젝트 맥락이 없다 — 그래서 시작 폴더가 맨 앞.
-->
<!-- 섹션 머리 — MCP · 지침과 같은 틀: 한 줄 설명(ⓘ 자세히) · 각주. 아래 "공통" 은 그 안의 첫 묶음이다. -->
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
      <button type="button" class="btn btn-sm btn-secondary" disabled={pickingDir} onclick={() => void pickStartDir()}>
        <UiIcon name="folder-open" size={13} />{t("settings.ai.start_dir.browse")}
      </button>
    </div>
  </div>
</div>

<!--
  ── 에이전트마다 접기 한 칸 ── `agents`(세 표를 합친 목록)를 돈다. **머리 줄**(공용 `.slist` 줄 — 로고 · 이름 · 설치 상태 ·
  훅 상태 알약 · 사용 토글 · 펼침 꺾쇠)은 늘 보여 접혀 있어도 상태가 읽히고, 머리를 누르면 몸통(훅 · 에이전트만의 스위치 · 추가 인자 —
  다른 섹션과 같은 `.srow`)이 펼쳐진다. 에이전트 하나 = 묶음의 칸 하나이고 **한 번에 하나만** 펼친다(아코디언 — 펼친 칸은 묶음에서 떨어진다). 기본은
  접힘이고 펼침은 저장하지 않는다. 사용 토글은 머리 버튼 **밖**에 서서
  눌러도 펼침이 바뀌지 않는다. 끈 에이전트(`[ai] disabled_agents`)는 머리가 흐려지고, 펼치면 몸통 대신 한 줄로 그 뜻만
  말한다(고르는 자리에서만 빠지고 훅·인자·대화 기록은 그대로). 접힌 몸통은 `inert` 라 Tab 이 밟지 않는다.
  토글은 다른 설정 줄과 같은 미리보기 계약이다([저장]/[취소]). MCP 관리는 별도 설정 메뉴에서 다룬다.
-->
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
    <!-- 보이는 묶음의 첫 · 끝 — 펼친 칸은 홀로 떨어지고 그 위 · 아래 이웃이 각자 묶음의 끝 · 첫 줄이 된다 -->
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
              <!-- 설치 상태 요약 — 하네스가 `data-agent-install` 의 글자로 읽는다 -->
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
                <!-- 훅 상태 요약 — 몸통의 훅 줄과 같은 값(`hooks`)을 짧게 -->
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
            <!-- 설치 방법 — 머리줄 단추 안에 둘 수 없어 끝 칸(보조 단추 자리)에 선다 · 공식 문서를 브라우저로 -->
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
          <!-- 펼침 꺾쇠 — 아래(접힘) ↔ 위(펼침). 누르면 줄 단추의 덮개가 받는다 -->
          <span class="slist-chev chev" aria-hidden="true"><UiIcon name="chevron-down" size={16} /></span>
        </span>
      </div>

      <!-- 몸통 — `grid-template-rows` 0fr → 1fr 로 열고 닫는다. 접혀 있으면 `inert`(포커스·화면 읽기 밖) -->
      <div class="slist-collapse agent-collapse" id={bodyId} inert={!open}>
        <div class="slist-collapse-inner agent-collapse-inner">
          <div class="slist-panel agent-panel">
            {#if !enabled}
              <p class="off-note" data-agent-off={agent.id}>{t("settings.ai.agent.off")}</p>
            {:else}
              <div class="rows term slist-body agent-body">
                {#if hookTarget}
                  <!--
                    **에이전트 훅** — 탭 상태 점이 추정 대신 쓰는 정확한 신호 (docs/log/2026-09-24-agent-hook-signals.md ·
                    docs/log/2026-09-26-codex-hooks.md). 저장 버튼과 무관하게 누르는 즉시 그 에이전트의 훅 설정 파일을
                    고친다(확인 창을 거친 뒤). 신뢰 단계가 있는 에이전트(Codex `/hooks`)는 안내 한 줄이 붙는다.
                    "업데이트 필요"(Rust `Installed::Partial` — 이전 버전의 훅 · 일부 이벤트만)는 짧은 상태 글자 + 툴팁이고,
                    그때 설치 단추는 "업데이트…"(동작은 다시 설치와 같다).
                  -->
                  {@const st = hooks[agent.id] ?? null}
                  {@const trust = hookTarget.needsTrustNote ? t("settings.ai.hooks.trust", { agent: hookTarget.display }) : null}
                  {@const hookNote = trust !== null || !!st?.error || !!hooksMessage[agent.id]}
                  <div class="srow">
                    <!-- 이름이 곧 색인 anchor 다(`nameId`). 신뢰 단계 안내는 설치 상태와 무관하게 줄 밑에 늘 선다(툴팁에는 되풀이하지 않는다) -->
                    <TipName
                      id="{agentAnchor(agent.id, 'hooks')}-name"
                      nameId={agentAnchor(agent.id, "hooks")}
                      label={t("settings.ai.hooks.label")}
                      tip={t("settings.ai.hooks.note")}
                    />
                    <div class="size-row wrap-row" data-agent-hooks={agent.id}>
                      <span
                        class="state"
                        class:warn={st !== null && !st.installed && st.partial}
                        title={st !== null && !st.installed && st.partial ? t("settings.ai.hooks.partial.tip") : undefined}
                        data-tip-place="above"
                      >
                        <span
                          class="mcp-chip"
                          class:ok={st?.installed}
                          class:warn={st !== null && !st.installed && st.partial}
                          class:no={st !== null && !st.installed && !st.partial}
                        ></span>
                        {st === null
                          ? t("settings.ai.hooks.unknown")
                          : st.installed
                            ? t("settings.ai.hooks.installed")
                            : st.partial
                              ? t("settings.ai.hooks.partial")
                              : t("settings.ai.hooks.none")}
                      </span>
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
                  <!--
                    **추가 인자** — `[ai.args]` (docs/log/2026-09-27-agent-extra-args.md). aynx 이 **띄우는** 에이전트에만
                    붙는다. 칸마다 새 대화로 띄울 한 줄(미리보기) · 어긋난 까닭(저장 안 함) · 권한 건너뛰기 경고(막지 않음).
                  -->
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
  /* 에이전트 접기 목록 — 공통 줄 밑에 소제목 하나만큼 띄운다. 줄 모양은 설정 공용 목록(`settings.css` 의 `.slist` —
     트리거 · 스니펫 · MCP 와 한 벌)이고, 에이전트 하나 = 묶음의 칸 하나다 (docs/log/2026-10-05-ai-agent-cards.md).
     펼침 · 묶음 가르기 · 몸통의 작은 목록은 공용 펼침 목록(`.slist.accordion` — 오케스트레이션 구성 묶음과 한 벌) */
  .agent-list.slist {
    margin-top: var(--space-5);
  }

  /* 상태 알약 줄 — 딸린 줄 자리에 알약 둘(설치 · 훅). 좁으면 다음 줄로 접힌다 */
  .agent-head .badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    white-space: normal;
  }

  /* 끈 에이전트의 몸통 — 안의 줄과 같은 면의 카드 한 장 */
  /* 설치 방법 — 글자 단추(강조색 · 판 없음), 머리줄 높이에 맞춘 작은 글자 */
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

  /* 상태 한 조각 — 칩 + 문구. 줄 오른쪽 칸에 선다 */
  .state {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--t-sm);
    color: var(--fg-2);
  }

  .state.warn {
    color: var(--warn);
  }

  .mcp-chip {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-3); /* 알 수 없음(확인 중) — 회색 */
  }

  .mcp-chip.ok {
    background: var(--ok);
  }

  .mcp-chip.no {
    background: var(--err);
  }

  .mcp-chip.warn {
    background: var(--warn);
  }

  /* 상태 + 버튼 둘 (훅) — 좁은 폭에서는 버튼이 다음 줄로 접힌다 */
  .wrap-row {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* 시작 폴더 칸 — 줄 오른쪽 손잡이 안에서 [찾아보기…] 앞을 채운다 */
  .size-row .value.dir {
    flex: 1 1 auto;
    width: 12em;
    min-width: 6em;
  }

  /* [찾아보기…] — 칸과 같은 높이, 글자 · 여백 · 틈은 전역 `.btn` 값 */
  .size-row .value.dir + .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    gap: var(--space-2);
    font-size: var(--t-sm);
  }

  /* 추가 인자 칸 — 인자는 글자 하나하나가 뜻이 있어 고정폭으로. 좁은 카드에서는 줄어든다 */
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
