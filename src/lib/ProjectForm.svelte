<script lang="ts">
  /**
   * **프로젝트 추가·편집 모달** (docs/log/2026-09-24-projects.md).
   *
   * **세 면**(2026-09-29 — docs/log/2026-09-29-folder-project-icons.md) — 호스트 폼과 같은 왼쪽 내비(`SectionNav`) +
   * 오른쪽 패널이다. **일반**(추가 방식 · 이름 · 위치 · 호스트 · 경로/만들 자리 · 에이전트 · 셸/tmux) ·
   * **워크트리**(워크트리 폴더 · 설정 스크립트) · **표시**(아이콘 → 색, `IconColorFields`). 위치에 따라 셸·tmux 중
   * 하나만 선다. 면은 언마운트하지 않고 `hidden` 으로만 숨기고(칸의 `bind:this` 가 살아 있게), 상자 높이는 못 박아
   * 면을 바꿔도 크기가 튀지 않는다. 저장이 막히면 그 칸의 면으로 데려가 포커스를 주고 내비에 점을 찍는다
   * (`projectFormTabOf` — 호스트 폼의 `tabOfField` 와 같은 일). [저장]·[취소]와 오류 한 줄은 패널 바깥이다.
   *
   * **에이전트 · 설정 스크립트**(2026-09-28 — docs/log/2026-09-28-project-agent-setup-script.md): 옛 "시작 명령" 칸
   * 대신 [Claude Code | Codex | 없음 (셸)] 고르개(에이전트 표는 Rust `agent_args::TARGETS` — `agent_args_targets`)와
   * 여러 줄 설정 스크립트 칸이다. 스크립트 칸의 힌트는 **도는 셸**과 그 셸의 변수 표기를 말한다(원격은 늘 `sh`).
   * 옛 시작 명령을 옮긴 프로젝트는 폼 위에 한 줄(`migration`)이 서고, 저장하면 사라진다.
   *
   * **워크트리 폴더**는 사용자 피드백(2026-09-24, "워크트리가 어디 생기는지 모르겠다")으로 생긴
   * 칸이다(docs/log/2026-09-24-worktrees.md). 비워 두면 기본 자리(`<저장소>-wt`)이고, 그 자리가
   * 칸의 자리표시로 **늘 보인다** — 숨은 규칙이 아니라 읽을 수 있는 값이 되게. 상태와 저장은 전부 `app/projects.svelte.ts` 에 있고
   * 이 상자는 그 폼 한 벌을 그릴 뿐이다(`SnippetSaveDialog` 와 같은 분담).
   *
   * 고르개는 호스트 폼과 **같은 컴포넌트**다(`Dropdown` · `Toggle`) — 앱의 다른 "고르는 목록"
   * 과 한 벌로 보이게. 상자 모양(`.overlay`/`.modal`)은 스니펫 저장 상자와 같은 값이다.
   *
   * **추가 방식**(2026-09-28 — docs/log/2026-09-28-project-create.md): 추가 상자 맨 위의 [기존 폴더 | 새로
   * 만들기]. 새로 만들기는 경로 칸 대신 "만들 자리"(부모 폴더) + 미리 보기 두 줄이고, 확정 단추가 "만들고
   * 추가" 다. 기존 폴더는 경로가 정해지면(찾아보기 직후 · 칸을 떠날 때 · 치다 멈추면) 저장소 판정을 한 줄로
   * 세운다(`repoCheckLine`) — 로컬의 없는 폴더만 저장을 막고 나머지는 경고와 단추다. 같은 폴더를 이미 다른
   * 프로젝트가 쓰면 경고만 한 줄 더.
   *
   * Escape 는 **여기서 끊는다**(`stopPropagation`) — 창의 Escape 사슬로 새면 이 모달을 닫는
   * 한 번이 뒤에 깔린 독까지 함께 닫는다. 단 열린 드롭다운의 Escape 는 그쪽이 먼저 먹는다.
   */
  import { tick, untrack } from "svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import SectionNav from "$lib/settings/SectionNav.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import CommandBlock from "$lib/CommandBlock.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import IconColorFields from "$lib/IconColorFields.svelte";
  import { iconRef } from "$lib/host-icons";
  import UiIcon from "$lib/UiIcon.svelte";
  import { aiIconName } from "$lib/pane-icons";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { hostCache } from "$lib/app/hosts.svelte.js";
  import { knownShellList } from "$lib/app/panes.svelte.js";
  import {
    defaultWorktreeDir,
    projectFormTabOf,
    projectProblemFieldId,
    setupRootVar,
    setupShellKind,
    type ProjectFormTab,
  } from "$lib/projects";
  import { agentArgsTargets, type AgentArgsTarget } from "$lib/context";
  import { settings } from "$lib/settings.svelte.js";
  import { agentEnabled } from "$lib/agent-enabled";
  import { effectiveDefaultShellId, shellInfoLabel } from "$lib/session";
  import { newProjectPath, repoCheckActionKey, repoCheckKey, repoCheckLine } from "$lib/repo-status";
  import {
    browseProjectFolder,
    browseProjectParent,
    browseWorktreeFolder,
    checkRepoNow,
    closeProjectForm,
    copyGitIdentityLines,
    duplicateOfForm,
    gitIdentityLines,
    projectForm,
    runRepoCheckAction,
    scheduleRepoCheck,
    setProjectField,
    setProjectFormKind,
    setProjectParent,
    submitProjectForm,
  } from "$lib/app/projects.svelte.js";
  import type { ShellInfo } from "$lib/session";
  import { trapTab } from "$lib/focus-trap";

  const form = $derived(projectForm());
  const draft = $derived(form.draft);
  const remote = $derived(draft.location === "remote");
  /** git 신원 안내의 두 줄 (자리표시는 지금 언어) */
  const identityLines = $derived(gitIdentityLines());
  /** 추가 상자의 "새로 만들기" 인가 (편집은 늘 기존 폴더) */
  const creating = $derived(form.mode === "add" && form.kind === "create");
  /** 새로 만들 폴더의 자리 — 미리 보기 줄과 워크트리 폴더 칸의 자리표시가 쓴다 */
  const newPath = $derived(creating ? newProjectPath(form.parent, draft.name, remote) : null);
  /** 워크트리 폴더 칸의 자리표시 — 경로에서 계산한 기본 자리(경로가 비었으면 빈 글자) */
  const worktreeDefault = $derived(defaultWorktreeDir(creating ? (newPath ?? "") : draft.path) ?? "");
  /** 경로 확인 한 줄 (기존 폴더) — `null` 이면 세우지 않는다 */
  const checkLine = $derived.by(() => {
    if (creating) return null;
    // 지금 칸의 경로에 대한 답만 세운다 — 치는 중(디바운스 대기)에는 옛 경로의 줄을 걷는다.
    const c = form.check;
    if (c.state !== "idle" && c.key !== repoCheckKey(draft.location, draft.host, draft.path)) return null;
    return repoCheckLine(c, remote, form.mode === "edit", form.checkDismissed);
  });
  /** 같은 폴더를 이미 쓰는 다른 프로젝트 — 경고 한 줄(저장은 막지 않는다) */
  const duplicate = $derived(creating ? null : duplicateOfForm());

  // 위치·호스트·경로가 바뀌면(고르개는 `bind:value` 라 `setProjectField` 를 지나지 않는다) 판정을
  // 예약한다 — 치는 동안은 기다리고(디바운스) 같은 경로면 다시 묻지 않는다.
  $effect(() => {
    void [form.open, form.kind, draft.location, draft.host, draft.path];
    // 판정 상태(`form.check`)는 이 효과의 의존이 아니다 — 따라 읽으면 답이 올 때마다 다시 예약한다.
    untrack(() => scheduleRepoCheck());
  });

  /** 이 기기의 셸 — 한 번 물어 둔 캐시를 쓴다 (`knownShellList` — 새 셸 단축키와 같은 답) */
  let shells = $state<ShellInfo[]>([]);
  let osDefaultShell = $state<string | null>(null);
  $effect(() => {
    if (!form.open) return;
    void knownShellList()
      .then((l) => {
        shells = l.shells;
        osDefaultShell = l.default_id;
      })
      .catch(() => (shells = []));
  });

  /** 에이전트 표 — Rust `agent_args::TARGETS` 한 벌(셋째 에이전트는 표 한 줄로 여기 선다) */
  let agentTargets = $state<AgentArgsTarget[]>([]);
  /** 이번 열림에 이미 읽었나 — 반응형이 아니다. 빈 표(`[]`)를 넣어도 새 배열이라 이 효과가 다시 돌므로,
   *  이 표시 없이는 IPC 가 끝없이 돈다(docs/log/2026-09-30-project-form-agent-targets-loop.md). 닫히면 되돌린다. */
  let agentTargetsTried = false;
  $effect(() => {
    if (!form.open) {
      agentTargetsTried = false;
      return;
    }
    if (agentTargets.length > 0 || agentTargetsTried) return;
    agentTargetsTried = true;
    void agentArgsTargets().then((list) => (agentTargets = list));
  });
  /**
   * 폼을 열 때 이 프로젝트에 적혀 있던 에이전트 — 설정에서 끈 에이전트(`[ai] disabled_agents`)는 고르개에서 빠지지만
   * **이 값이면 남긴다**: 지금 고른 단추가 사라져 아무것도 안 고른 것처럼 보이지 않게, 값을 지우지 않고 그대로 저장되게.
   * 다른 것으로 바꿨다가 되돌아올 수도 있게 열 때의 값으로 잡는다(지금의 초안이 아니라).
   */
  let openedAgent = $state<string | null>(null);
  $effect(() => {
    if (form.open) openedAgent = untrack(() => form.draft.agent);
  });
  /** 고르개의 단추들 — 표 + 없음(셸). 표를 못 읽었으면 지금 값만이라도 세운다(조용히 다른 에이전트를 가리키지 않게) */
  const agentOptions = $derived.by(() => {
    const disabled = settings.disabledAgents;
    const out: { id: string | null; label: string }[] = agentTargets
      .filter((a) => a.id === openedAgent || a.id === draft.agent || agentEnabled(a.id, disabled))
      .map((a) => ({ id: a.id, label: a.display }));
    if (draft.agent && !out.some((o) => o.id === draft.agent)) out.unshift({ id: draft.agent, label: draft.agent });
    out.push({ id: null, label: t("app.projects.form.agent.none") });
    return out;
  });

  /** 설정 스크립트가 도는 셸 — 로컬은 고른 셸(없으면 지금의 기본 셸), 원격은 늘 `sh` */
  const scriptShellId = $derived(
    remote ? null : draft.shell || effectiveDefaultShellId(shells, settings.defaultShell, osDefaultShell),
  );
  const scriptKind = $derived(setupShellKind(scriptShellId, remote));
  const scriptShell = $derived(shells.find((s) => s.id === scriptShellId));
  const scriptShellName = $derived(
    remote
      ? t("app.projects.form.setup.remoteShell")
      : scriptShell
        ? shellInfoLabel(scriptShell, t)
        : t("app.projects.form.shell.default"),
  );

  /** 옛 시작 명령의 이관 안내 한 줄 — 편집에서만(저장하면 사라진다) */
  const migrationLine = $derived.by(() => {
    const m = draft.migration;
    if (form.mode !== "edit" || !m) return null;
    if (m.kind === "args") return t("app.projects.form.migration.args", { text: m.text });
    if (m.kind === "script") return t("app.projects.form.migration.script", { text: m.text });
    return t("app.projects.form.migration.dropped", { text: m.text });
  });

  /** 스크립트 칸의 자리표시 · 멈춤 규칙 한 줄 — 도는 셸마다 */
  const scriptPlaceholder = $derived(
    scriptKind === "powershell"
      ? t("app.projects.form.setup.placeholder.powershell")
      : scriptKind === "cmd"
        ? t("app.projects.form.setup.placeholder.cmd")
        : t("app.projects.form.setup.placeholder.posix"),
  );
  const scriptStop = $derived(
    scriptKind === "powershell"
      ? t("app.projects.form.setup.stop.powershell")
      : scriptKind === "cmd"
        ? t("app.projects.form.setup.stop.cmd")
        : t("app.projects.form.setup.stop.posix"),
  );

  const locationOptions = $derived([
    { value: "local" as const, label: t("app.projects.form.location.local") },
    { value: "remote" as const, label: t("app.projects.form.location.remote") },
  ]);

  /**
   * 호스트 목록 — 독이 읽어 둔 스냅숏(`hostCache`)이다. 편집 중인 별칭이 목록에 없으면(설정에서
   * 지웠다) 그 글자를 맨 앞에 그대로 둔다 — 고르개가 조용히 다른 호스트를 가리키면 안 된다.
   */
  const hostOptions = $derived.by(() => {
    const names = hostCache().map((h) => h.name);
    const out = [{ value: "", label: t("app.projects.form.host.none") }];
    if (draft.host && !names.includes(draft.host)) out.push({ value: draft.host, label: draft.host });
    for (const n of names) out.push({ value: n, label: n });
    return out;
  });

  const shellOptions = $derived([
    { value: "", label: t("app.projects.form.shell.default") },
    ...shells.map((s) => ({ value: s.id, label: shellInfoLabel(s, t) })),
  ]);

  // 고르개(`Dropdown`)는 값을 **묶어서** 받는다(`bind:value`) — 호스트를 고르는 순간 "호스트를
  // 고르세요" 한 줄을 거둔다(글자 칸은 `setProjectField` 가 같은 일을 한다).
  $effect(() => {
    if (form.problem === "host" && (draft.host !== "" || draft.location === "local")) {
      form.problem = null;
    }
  });

  /** 왼쪽 내비의 세 면 — 순서가 곧 화면의 순서다(`PROJECT_FORM_TABS`) */
  const SECTIONS: readonly { id: ProjectFormTab; labelKey: Key }[] = [
    { id: "general", labelKey: "app.projects.form.tab.general" },
    { id: "worktree", labelKey: "app.projects.form.tab.worktree" },
    { id: "display", labelKey: "app.projects.form.tab.display" },
  ];

  /** 지금 보이는 면 — 이 컴포넌트 안에만 있고 저장하지 않는다 */
  let tab = $state<ProjectFormTab>("general");
  /** 막힌 칸이 있는 면 — 내비에 점 */
  const problemTab = $derived(projectFormTabOf(form.problem));

  let nameEl = $state<HTMLInputElement | null>(null);
  let scriptEl = $state<HTMLTextAreaElement | null>(null);
  let panelEl = $state<HTMLElement | null>(null);
  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!form.open) return;
    // 열 때마다 첫 면으로 — 터미널 오류 막대의 [스크립트 편집] 으로 열렸으면 워크트리 면의 스크립트 칸
    // (호스트 폼과 같은 규칙: 지난 면을 기억하지 않는다. 포커스가 보이지 않는 칸에 들어가지 않게).
    const script = untrack(() => form.focusScript);
    tab = script ? "worktree" : "general";
    void tick().then(() => {
      if (script && scriptEl) scriptEl.focus();
      else nameEl?.focus();
    });
  });

  // 면을 갈면 패널의 맨 위부터 (스크롤 상자가 하나라 — 호스트 폼과 같다)
  $effect(() => {
    if (tab && panelEl) panelEl.scrollTop = 0;
  });

  // 저장이 막히면 그 칸의 면으로 데려가 포커스를 준다 — 칸이 다른 면에 숨어 "고치라는데 고칠 칸이 없는" 화면을 막는다.
  $effect(() => {
    const problem = form.problem;
    if (problem === null) return;
    const want = projectFormTabOf(problem);
    if (want !== null) tab = want;
    void tick().then(() => {
      const el = document.getElementById(projectProblemFieldId(problem));
      if (el instanceof HTMLInputElement || el instanceof HTMLButtonElement) el.focus();
    });
  });

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeProjectForm();
  }
</script>

{#if form.open}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-form-title"
      tabindex="-1"
      data-project-form
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <h2 id="project-form-title">
        {form.mode === "edit" ? t("app.projects.form.title.edit") : t("app.projects.form.title.add")}
      </h2>

      {#if migrationLine}
        <!-- 옛 시작 명령을 옮긴 프로젝트 — 편집할 때 한 줄. 저장하면 사라진다 -->
        <div class="check warn migration" data-project-migration={draft.migration?.kind}>
          <span class="dot"></span>
          <div class="body"><span>{migrationLine}</span></div>
        </div>
      {/if}

      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          void submitProjectForm();
        }}
      >
        <!--
          본문 = 좌측 내비 + 우측 패널 (호스트 폼과 같은 `SectionNav` · 같은 모양). 면은 `hidden` 으로만 숨긴다.
        -->
        <div class="pf-body">
          <SectionNav
            tabs={SECTIONS}
            active={tab}
            onselect={(id) => (tab = id as ProjectFormTab)}
            marked={problemTab ? [problemTab] : []}
          />

          <div class="pf-panel" bind:this={panelEl}>
            <section hidden={tab !== "general"} data-project-tab="general">
              {#if form.mode === "add"}
                <!-- 추가 방식 — 편집에서는 서지 않는다(있는 프로젝트의 폴더를 새로 만들 일은 없다) -->
                <div class="kind-seg" role="group" aria-label={t("app.projects.form.kind.aria")}>
                  <button
                    type="button"
                    class="kind-btn"
                    class:on={form.kind === "existing"}
                    aria-pressed={form.kind === "existing"}
                    data-project-kind="existing"
                    onclick={() => setProjectFormKind("existing")}>{t("app.projects.form.kind.existing")}</button
                  >
                  <button
                    type="button"
                    class="kind-btn"
                    class:on={form.kind === "create"}
                    aria-pressed={form.kind === "create"}
                    data-project-kind="create"
                    onclick={() => setProjectFormKind("create")}>{t("app.projects.form.kind.create")}</button
                  >
                </div>
              {/if}

              <div class="fields">
                <label for="project-name">{t("app.projects.form.name")}</label>
                <div class="cell">
                  <input
                    id="project-name"
                    data-project-field="name"
                    type="text"
                    bind:this={nameEl}
                    value={draft.name}
                    autocomplete="off"
                    spellcheck="false"
                    class:bad={form.problem === "name" || form.problem === "folderName"}
                    oninput={(e) => setProjectField("name", e.currentTarget.value)}
                  />
                  {#if form.problem === "name"}<span class="err">{t("app.projects.form.error.name")}</span>{/if}
                  {#if form.problem === "folderName"}<span class="err" data-project-error="folderName"
                      >{t("app.projects.form.error.folderName")}</span
                    >{/if}
                </div>

                <label for="project-location">{t("app.projects.form.location")}</label>
                <Dropdown id="project-location" bind:value={form.draft.location} options={locationOptions} />

                {#if remote}
                  <label for="project-host">{t("app.projects.form.host")}</label>
                  <div class="cell">
                    <Dropdown id="project-host" bind:value={form.draft.host} options={hostOptions} />
                    {#if form.problem === "host"}<span class="err">{t("app.projects.form.error.host")}</span>{/if}
                  </div>
                {/if}

                {#if creating}
                  <label class="top" for="project-parent">{t("app.projects.form.parent")}</label>
                  <div class="cell">
                    <div class="row">
                      <input
                        id="project-parent"
                        data-project-field="parent"
                        type="text"
                        value={form.parent}
                        autocomplete="off"
                        spellcheck="false"
                        class:bad={form.problem === "parent" || form.problem === "parentRelative"}
                        placeholder={remote
                          ? t("app.projects.form.parent.placeholder.remote")
                          : t("app.projects.form.parent.placeholder.local")}
                        oninput={(e) => setProjectParent(e.currentTarget.value)}
                      />
                      {#if !remote}
                        <button type="button" class="ghost small btn btn-secondary" onclick={() => void browseProjectParent()}
                          >{t("app.projects.form.browse")}</button
                        >
                      {/if}
                    </div>
                    {#if form.problem === "parent"}<span class="err">{t("app.projects.form.error.parent")}</span>{/if}
                    {#if form.problem === "parentRelative"}<span class="err" data-project-error="parentRelative"
                        >{t("app.projects.form.error.parentRelative")}</span
                      >{/if}
                    {#if newPath}
                      <span class="preview-path" data-project-new-path
                        >{t("app.projects.form.create.preview", { path: newPath })}</span
                      >
                    {/if}
                    <span class="fixed-line"><span class="dot ok"></span>{t("app.projects.form.create.fixed")}</span>
                  </div>
                {:else}
                  <label class="top" for="project-path">{t("app.projects.form.path")}</label>
                  <div class="cell">
                    <div class="row">
                      <input
                        id="project-path"
                        data-project-field="path"
                        type="text"
                        value={draft.path}
                        autocomplete="off"
                        spellcheck="false"
                        class:bad={form.problem === "path" ||
                          form.problem === "pathRelative" ||
                          form.problem === "pathMissing"}
                        placeholder={remote
                          ? t("app.projects.form.path.placeholder.remote")
                          : t("app.projects.form.path.placeholder.local")}
                        oninput={(e) => setProjectField("path", e.currentTarget.value)}
                        onblur={() => void checkRepoNow()}
                      />
                      {#if !remote}
                        <!-- 원격 경로는 이 PC 의 대화상자로 고를 수 없다 — 로컬에서만 선다 -->
                        <button type="button" class="ghost small btn btn-secondary" onclick={() => void browseProjectFolder()}
                          >{t("app.projects.form.browse")}</button
                        >
                      {/if}
                    </div>
                    {#if form.problem === "path"}<span class="err">{t("app.projects.form.error.path")}</span>{/if}
                    {#if form.problem === "pathRelative"}<span class="err" data-project-error="pathRelative"
                        >{t("app.projects.form.error.pathRelative")}</span
                      >{/if}
                    {#if checkLine}
                      <!-- 경로 확인 한 줄 — ok 는 점 하나, 경고는 옅은 판 + 단추, 오류(로컬의 없는 폴더)는 붉은 글자 -->
                      <div
                        class="check {checkLine.tone}"
                        data-repo-check={form.check.state === "done" ? form.check.status.kind : form.check.state}
                      >
                        <span class="dot"></span>
                        <div class="body">
                          <span>{t(checkLine.key, checkLine.params)}</span>
                          {#if checkLine.actions.length > 0}
                            <div class="acts">
                              {#each checkLine.actions as action, i (action)}
                                <button
                                  type="button"
                                  class="btn small-btn"
                                  class:btn-secondary={i === 0}
                                  class:btn-ghost={i > 0}
                                  disabled={form.saving}
                                  data-repo-action={action}
                                  onclick={() => void runRepoCheckAction(action)}
                                  >{t(repoCheckActionKey(action, form.mode === "edit"))}</button
                                >
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/if}
                    {#if duplicate}
                      <div class="check warn" data-project-duplicate>
                        <span class="dot"></span>
                        <div class="body">
                          <span>{t("app.projects.form.check.duplicate", { name: duplicate.name })}</span>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}

                <span class="label-like" id="project-agent-label">{t("app.projects.form.agent")}</span>
                <div class="cell">
                  <div class="kind-seg inline" role="group" aria-labelledby="project-agent-label" data-project-field="agent">
                    {#each agentOptions as o (o.id ?? "")}
                      <button
                        type="button"
                        class="kind-btn"
                        class:on={draft.agent === o.id}
                        aria-pressed={draft.agent === o.id}
                        data-project-agent={o.id ?? "none"}
                        onclick={() => setProjectField("agent", o.id)}
                      >
                        <!-- 로고는 프로젝트 시작 화면(`ProjectStart`)의 단추와 같은 길 — 없음(셸)은 선 아이콘 터미널(글자 색),
                             모르는 에이전트는 빈 자리(지어낸 로고를 붙이지 않는다) -->
                        {#if o.id === null}
                          <span class="agent-ico" aria-hidden="true"><UiIcon name="terminal" size={14} /></span>
                        {:else}
                          {@const logo = aiIconName(o.id)}
                          {#if logo}<span class="agent-ico" aria-hidden="true"><HostIcon icon={iconRef(logo)} size={14} /></span>{/if}
                        {/if}
                        <span>{o.label}</span>
                      </button>
                    {/each}
                  </div>
                  <span class="hint">{t("app.projects.form.agent.hint")}</span>
                </div>

                {#if remote}
                  <label for="project-tmux">{t("app.projects.form.tmux")}</label>
                  <div class="row">
                    <Toggle
                      id="project-tmux"
                      checked={draft.tmux}
                      onchange={(v) => setProjectField("tmux", v)}
                    />
                    <span class="hint">
                      {draft.tmux ? t("app.projects.form.tmux.on") : t("app.projects.form.tmux.off")}
                    </span>
                  </div>
                {:else}
                  <label for="project-shell">{t("app.projects.form.shell")}</label>
                  <Dropdown id="project-shell" bind:value={form.draft.shell} options={shellOptions} />
                {/if}
              </div>
            </section>

            <section hidden={tab !== "worktree"} data-project-tab="worktree">
              <div class="fields">
                <label for="project-worktree-dir">{t("app.projects.form.worktreeDir")}</label>
                <div class="cell">
                  <div class="row">
                    <input
                      id="project-worktree-dir"
                      data-project-field="worktreeDir"
                      type="text"
                      value={draft.worktreeDir}
                      autocomplete="off"
                      spellcheck="false"
                      class:bad={form.problem === "worktreeDir"}
                      placeholder={worktreeDefault}
                      oninput={(e) => setProjectField("worktreeDir", e.currentTarget.value)}
                    />
                    {#if !remote}
                      <button type="button" class="ghost small btn btn-secondary" onclick={() => void browseWorktreeFolder()}
                        >{t("app.projects.form.browse")}</button
                      >
                    {/if}
                  </div>
                  {#if form.problem === "worktreeDir"}
                    <span class="err">{t("app.projects.form.error.worktreeDir")}</span>
                  {:else}
                    <span class="hint">{t("app.projects.form.worktreeDir.help")}</span>
                  {/if}
                </div>

                <label class="top" for="project-setup-script">{t("app.projects.form.setup")}</label>
                <div class="cell">
                  <textarea
                    id="project-setup-script"
                    class="script"
                    data-project-field="setupScript"
                    bind:this={scriptEl}
                    value={draft.setupScript}
                    rows="3"
                    spellcheck="false"
                    autocomplete="off"
                    placeholder={scriptPlaceholder}
                    oninput={(e) => setProjectField("setupScript", e.currentTarget.value)}
                  ></textarea>
                  <span class="hint" data-setup-shell={scriptKind}
                    >{t("app.projects.form.setup.hint", { shell: scriptShellName, var: setupRootVar(scriptKind) })}
                    {scriptStop}</span
                  >
                </div>
              </div>
            </section>

            <section hidden={tab !== "display"} data-project-tab="display">
              <div class="fields">
                <!--
                  아이콘 → 색 — 호스트 폼 표시 탭 · 폴더 편집과 **같은 한 벌**(`IconColorFields.svelte`,
                  docs/log/2026-09-29-folder-project-icons.md). 비우면 기본 그림 — 호스트 독 폴더와 같은 테마 색 폴더
                  (`ProjectIcon` · `HostIcon` 의 `fallback="folder"`). 프로젝트는 물려받을 곳이 없어 곁말은 평소 문구다.
                -->
                <IconColorFields
                  bind:icon={form.draft.icon}
                  bind:color={form.draft.color}
                  iconId="project-icon"
                  colorId="project-color"
                  fallback="folder"
                />
              </div>
            </section>
          </div>
        </div>

        {#if form.error}
          <p class="note error">{form.error}</p>
          {#if form.identity}
            <!--
              git 신원이 없어 첫 커밋을 못 만들었다(이유 코드 `[git-identity]` — docs/log/2026-09-28-project-create.md).
              앱이 대신 설정하지 않는다 — 그 자리에서 칠 두 줄을 폼 폭 코드 블록으로 보이고(글자 선택 가능)
              블록 오른쪽 위에 복사 아이콘 하나를 둔다(`CommandBlock.svelte`).
            -->
            <div class="identity" data-git-identity={form.identity}>
              <p class="note">{t(`app.projects.repo.identity.${form.identity}`)}</p>
              <CommandBlock
                lines={identityLines}
                label={t("app.projects.repo.identity.copy")}
                copy={() => copyGitIdentityLines(true)}
              />
            </div>
          {/if}
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={() => closeProjectForm()}
            >{t("app.actions.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary" disabled={form.saving} data-project-submit>
            {form.saving
              ? creating
                ? t("app.projects.form.creating")
                : t("app.projects.form.saving")
              : form.mode === "edit"
                ? t("app.projects.form.submit.edit")
                : creating
                  ? t("app.projects.form.submit.create")
                  : t("app.projects.form.submit.add")}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  /* `SnippetSaveDialog.svelte` 의 `.overlay`/`.modal` 과 **같은 값**이다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  /*
    상자 — 호스트 폼(`.modal.host-modal`)과 같은 틀: 왼쪽 내비 150px 을 보태 넓히고(480 → 640) **높이를 못 박는다**.
    면마다 칸 수가 달라, 그러지 않으면 내비를 누를 때마다 상자가 늘었다 줄었다 한다. 스크롤은 안쪽 패널만 맡는다.
  */
  .modal {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 640px;
    height: min(560px, calc(100vh - 32px));
    overflow: hidden;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }

  .modal h2 {
    flex: 0 0 auto;
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /* 폼 = 본문(늘어남) · 오류 · 단추 — 늘어나는 것은 본문 하나다 (호스트 폼과 같은 모양) */
  .modal form {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* 본문: 좌 내비 | 우 패널 (`HostForm` 의 `.host-body`·`.host-panel` 과 같은 값) */
  .pf-body {
    display: flex;
    gap: 12px;
    flex: 1 1 auto;
    min-height: 0;
    margin-bottom: 12px;
  }

  .pf-panel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    /* 포커스 링(2px + 1px 틈)이 스크롤 자리에 잘리지 않을 만큼 안쪽을 비우고, 바깥 여백으로 되돌려 칸 자리는 그대로 둔다 */
    padding: 3px;
    margin: -3px;
    /* 좁은 패널에서 라벨·입력을 위아래로 쌓는 기준 (아래 `@container`) */
    container-type: inline-size;
  }

  /* 숨긴 면이 확실히 이기게 — 안의 `.fields`(grid)가 있어도 눌린다 */
  .pf-panel > section[hidden] {
    display: none !important;
  }

  .fields {
    display: grid;
    /* 입력 열은 `minmax(0, …)` — 1fr 의 최소가 입력의 고유 폭이면 모달 밖으로 밀려난다 */
    grid-template-columns: auto minmax(0, 1fr);
    /* 위 정렬 — 라벨은 항목의 **첫 줄** 이름이다 (`HostForm` 과 한 벌) */
    align-items: start;
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }

  /* 좁은 패널 — 라벨을 입력 위로 올린다 (`HostForm` 의 같은 규칙과 한 벌 · 2026-10-11 디자인 점검).
     125~150% 확대 + 작은 창이면 패널이 250px 안팎까지 준다. `.pf-panel` 을 붙인 것은 이 블록이
     아래 `.fields label` 들보다 앞에 있어도 이기게다. */
  @container (max-width: 380px) {
    .pf-panel .fields {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-1) 0;
    }

    .pf-panel .fields label,
    .pf-panel .fields .label-like {
      white-space: normal;
    }

    /* 라벨이 칸 위에 쌓이면 첫 줄 맞춤(아래 `.fields label`)이 필요 없다 — 줄 높이를 되돌린다 */
    .pf-panel .fields label,
    .pf-panel .fields .label-like,
    .pf-panel .fields :global(.icf-label) {
      line-height: inherit;
    }

    /* 칸 사이 간격 — 라벨이 바로 위 칸의 꼬리처럼 붙어 보이지 않게 */
    .pf-panel .fields label:not(:first-child),
    .pf-panel .fields .label-like:not(:first-child) {
      margin-top: var(--space-2);
    }
  }

  /* 이름표는 첫 줄(입력 칸 `--field-height`)의 가운데에 선다 — 넓은 패널에서는 `nowrap` 이라 줄 간격이 벌어질 일이 없다 */
  .fields label {
    font-size: var(--t-sm);
    line-height: var(--field-height);
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 아이콘 · 색 칸(`IconColorFields`)의 라벨은 자식 컴포넌트에 있다 — 같은 첫 줄 맞춤 */
  .fields :global(.icf-label) {
    line-height: var(--field-height);
  }

  /* 아이콘 칸의 맨 위 줄은 26px 고르개(기본 / 로고)다 — 라벨 줄 가운데에 맞춘다 */
  .fields :global(.icon-field) {
    padding-top: calc((var(--field-height) - 26px) / 2);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .fields input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .fields input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  /* 포커스는 중성 — 강조색 선은 "강조는 셋뿐" 밖이다 (docs/log/2026-09-25-finish-menus.md) */
  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input.bad {
    border-color: var(--err);
  }

  /* 칸 높이가 바닥 — 스위치(24px) 줄도 라벨 줄 가운데에 선다 */
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: var(--field-height);
  }

  .row input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .err {
    font-size: var(--t-xs);
    color: var(--err);
  }

  .note {
    margin: 0 0 var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .note.error {
    color: var(--err);
  }

  /* git 신원 안내 — 안내 한 줄 + 폼 폭 코드 블록(CommandBlock) */
  .identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  .identity .note {
    margin: 0;
  }

  /*
    버튼 — 전역 `.btn` 세 종류 (docs/log/2026-09-25-finish-menus.md · 토큰층 "버튼 세 종류"):
    취소 = 보조(`.btn-secondary`), 확정 = 주(`.btn-primary`, 이 상자의 하나뿐인 강조색).
    옛 `.ghost`/`.primary` 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이긴다. 두 이름은
    표식으로만 남는다(검증 도구가 `.actions .primary` 로 찾는다).
  */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* 폼 바닥의 [취소] · [저장] — 설정 모달 바닥과 같은 크기(40px). `.btn` 정의는 그대로 */
  .actions > .btn {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }

  /* 이름표 자리의 글자(고르개처럼 `for` 로 묶을 칸이 하나가 아닌 줄) — `label` 과 같은 모양 */
  .fields .label-like {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
    line-height: var(--field-height);
  }

  /* 설정 스크립트 — 여러 줄 · 고정폭. 입력 칸과 같은 판 */
  .script {
    width: 100%;
    box-sizing: border-box;
    min-height: 76px;
    resize: vertical;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius-multi);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .script:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .script:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 이관 안내 — 본문 위 한 줄(경로 확인 줄과 같은 경고 판). 어느 면에서도 보인다 */
  .migration {
    flex: 0 0 auto;
    margin: 0 0 var(--space-3);
  }

  /* 에이전트 고르개 — 추가 방식 고르개와 같은 말이되 칸 폭만큼(늘이지 않는다) */
  .kind-seg.inline {
    display: inline-flex;
    align-self: flex-start;
    margin: 0;
  }

  .kind-seg.inline .kind-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 var(--space-3);
    white-space: nowrap;
  }

  .agent-ico {
    display: inline-flex;
    flex: none;
  }

  /* 추가 방식 고르개 — 대시보드 칸 막대와 같은 말(고른 칸만 회색 판). 상자 폭을 채운다. */
  .kind-seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    margin: 0 0 var(--space-4);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .kind-btn {
    flex: 1 1 0;
    height: 26px;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .kind-btn:hover {
    color: var(--fg-1);
  }

  .kind-btn.on {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .kind-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 새로 만들기의 미리 보기 두 줄 */
  .preview-path {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .fixed-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 경로 확인 한 줄 — 점 + 글(+ 단추). 경고만 옅은 판을 깐다 */
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .check.warn {
    padding: 6px var(--space-2);
    color: var(--fg-1);
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
  }

  .check.err {
    color: var(--err);
  }

  .check.muted {
    color: var(--fg-3);
  }

  .check .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .check .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    margin-top: 5px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .fixed-line .dot {
    margin-top: 0;
  }

  .dot.ok,
  .check.ok .dot {
    background: var(--ok);
  }

  .check.warn .dot {
    background: var(--warn);
  }

  .check.err .dot {
    background: var(--err);
  }

  /* 확인 줄의 작은 단추 — 전역 `.btn` 모양에 높이만 줄인다 */
  .small-btn {
    height: 24px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
  }

  /* 경로 칸 옆 [찾아보기] — 모양은 `.btn .btn-secondary`, 여기서는 줄 안에서 줄지 않게 + 칸과 같은 높이로 */
  .small {
    flex: 0 0 auto;
    height: var(--field-height);
  }
</style>
