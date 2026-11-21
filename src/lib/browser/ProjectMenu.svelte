<script lang="ts">
  import { tick } from "svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { hasSetupScript, isRemote, worktreePreview, type Project, type WorktreeInfo } from "$lib/projects";
  import {
    canRevealWorktree,
    confirmRemoveProject,
    confirmRemoveWorktree,
    openProject,
    openProjectForm,
    openProjectHere,
    openProjectInNewWorktree,
    openProjectWorktree,
    openProjectWorktreeHere,
    installRemoteHooks,
    removeRemoteHooks,
    revealWorktree,
    runProjectSetupScript,
    worktreeNameError,
  } from "$lib/app/projects.svelte.js";
  import { hookTargets, loadHookTargets } from "$lib/app/agent-hooks.svelte.js";
  import { openBranchGraph } from "$lib/app/branch-graph.svelte.js";
  import { openDiff } from "$lib/app/diff-view.svelte.js";
  import { startOrchestrationHere } from "$lib/app/orchestration.svelte.js";
  import { worktreesOf } from "$lib/app/worktrees.svelte.js";
  import { currentWorkspaceId, workspaceList } from "$lib/app/workspaces.svelte.js";
  import { projectLocations, revealProjectLocation } from "$lib/app/project-locations.svelte.js";
  import { openBranchDelete, readAddPreview } from "$lib/app/worktree-branch.svelte.js";
  import {
    defaultRow,
    rowKey,
    rowSelectable,
    stepSelectableRow,
    worktreeRows,
    type AddPreview,
    type WorktreeRow,
  } from "$lib/worktree-add";

  /** 항목 핸들러는 전부 menu-runner 통로(스냅샷 → 닫기 → 실행)를 지난다 — 뒤집으면 남은 백드롭이 모달(폼 · 확인)의 클릭을 가로챈다 */
  let {
    project,
    worktree = null,
    primary = false,
    ask = false,
    x,
    y,
    onclose,
    onreload,
  }: {
    project: Project | null;
    worktree?: WorktreeInfo | null;
    primary?: boolean;
    ask?: boolean;
    x: number;
    y: number;
    onclose: () => void;
    onreload: () => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);
  const elsewhere = $derived.by(() => {
    if (!project) return [];
    const locations = projectLocations(project, worktree?.path);
    return workspaceList().filter((workspace) => workspace.id !== currentWorkspaceId()).flatMap((workspace) => {
      const location = locations.find((location) => location.workspaceId === workspace.id);
      return location ? [{ name: workspace.name, location }] : [];
    });
  });

  void loadHookTargets();

  const onProject = (fn: (p: Project) => void | Promise<void>) => runOnMenu(() => project, onclose, fn);

  const onWorktree = (fn: (p: Project, w: WorktreeInfo) => void | Promise<void>) =>
    runOnMenu(
      () => (project && worktree ? { p: project, w: worktree } : null),
      onclose,
      ({ p, w }) => fn(p, w),
    );

  // ── 새 워크트리 — 이름 묻기 ──

  // 프롭 `ask` 는 처음 값일 뿐이다 — 메뉴는 열 때마다 새로 마운트된다.
  // svelte-ignore state_referenced_locally
  let wtAsk = $state(ask);
  let wtName = $state("");
  let wtError = $state<string | null>(null);
  let wtInput = $state<HTMLInputElement | null>(null);

  const wtWhere = $derived(
    project ? worktreePreview(project, wtName, t("app.projects.worktree.ask.name")) : null,
  );

  // ── 새 워크트리 — 브랜치 콤보박스 ──
  // 판정의 원본은 실행 때의 Rust `plan_add` 다.
  let wtPreview = $state<AddPreview | null>(null);
  let wtPreviewAsked = false;
  let wtListOpen = $state(true);
  let wtAt = $state(-1);
  $effect(() => {
    if (!wtAsk || !project || wtPreviewAsked) return;
    wtPreviewAsked = true;
    const p = project;
    void readAddPreview(p).then((got) => {
      if (project === p) wtPreview = got;
    });
  });
  const wtRows = $derived<WorktreeRow[]>(wtPreview && wtListOpen ? worktreeRows(wtName, wtPreview) : []);
  const wtActive = $derived(
    wtAt >= 0 && wtAt < wtRows.length && rowSelectable(wtRows[wtAt]) ? wtAt : defaultRow(wtName, wtRows),
  );

  function rowTag(r: WorktreeRow): string {
    switch (r.kind) {
      case "create":
        return r.main
          ? t("app.projects.worktree.ask.row.createFrom", { main: r.main })
          : t("app.projects.worktree.ask.row.createNoMain");
      case "local":
        return t("app.projects.worktree.ask.row.local");
      case "remote":
        return t("app.projects.worktree.ask.row.remote");
      case "busy":
        return t("app.projects.worktree.ask.row.busy");
      case "ambiguous":
        return t("app.projects.worktree.ask.row.ambiguous");
    }
  }

  /** 원격에만 있는 브랜치도 `<이름>` 으로 넘긴다 — Rust 가 원격 추적 갈래로 간다 */
  function chooseRow(r: WorktreeRow) {
    if (!rowSelectable(r)) return;
    wtName = r.name;
    submitWorktreeAsk();
  }

  function worktreeAskKeydown(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    const rows = wtRows;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!wtListOpen) {
        wtListOpen = true;
        wtAt = -1;
        return;
      }
      const next = stepSelectableRow(rows, wtActive, ev.key === "ArrowDown" ? 1 : -1);
      if (next >= 0) wtAt = next;
      return;
    }
    if (ev.key === "Tab" && wtActive >= 0) {
      ev.preventDefault();
      ev.stopPropagation();
      wtName = rows[wtActive].name;
      wtError = null;
      wtAt = -1;
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      // 거품을 막는다 — 확정이 메뉴를 닫은 뒤 이 Enter 가 독(`ProjectList`)까지 올라가면 그 프로젝트가 지금 탭에 또 열린다.
      ev.stopPropagation();
      if (wtActive >= 0) chooseRow(rows[wtActive]);
      else submitWorktreeAsk();
    }
  }

  async function startWorktreeAsk() {
    wtAsk = true;
    wtName = "";
    wtError = null;
    wtListOpen = true;
    wtAt = -1;
    await tick();
    wtInput?.focus();
  }

  function submitWorktreeAsk() {
    const bad = worktreeNameError(wtName);
    if (bad) {
      wtError = bad;
      return;
    }
    const name = wtName.trim();
    runOnMenu(
      () => project,
      onclose,
      (p) => openProjectInNewWorktree(p, name),
    );
  }

  $effect(() => {
    if (wtAsk) wtInput?.focus();
    else menuEl?.focus();
  });

  // 이름 칸은 터미널에게 포커스를 뺏기지 않는다 — 원격 접속이 끝나는 순간 터미널이 `term.focus()` 로 키보드를 되찾아 친 글자가 셸로 간다.
  // 칸이 떠 있는 동안 xterm 포커스는 프로그램이 옮긴 것뿐이라(사람이 누르면 백드롭이 받는다) 그때만 한 프레임 뒤 칸으로 되돌린다.
  $effect(() => {
    if (!wtAsk) return;
    const input = wtInput;
    if (!input) return;
    const refocus = () => {
      if (input.isConnected) input.focus({ preventScroll: true });
    };
    let raf = requestAnimationFrame(refocus);
    const onFocusIn = (ev: FocusEvent) => {
      if (ev.target instanceof Element && ev.target.closest(".xterm")) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(refocus);
      }
    };
    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  });

  // Escape 는 포커스가 어디 있든 닫는다 — 캡처 단계라 xterm(Escape 를 삼킨다)보다 먼저 듣는다. 없으면 포커스를 잃은 상자를 닫을 길이 없다.
  // IME 조합 중의 Escape 는 조합 취소다.
  $effect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.isComposing) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (wtRows.length > 0 && document.activeElement === wtInput) {
        wtListOpen = false;
        wtAt = -1;
        return;
      }
      onclose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  $effect(() => {
    if (!menuEl) return;
    void wtAsk;
    void wtWhere;
    void wtRows.length;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    if (wtAsk) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      const items = menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        ev.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }
</script>

<button
  type="button"
  class="menu-backdrop"
  tabindex="-1"
  aria-label={t("files.hostmenu.close.aria")}
  onclick={onclose}
  oncontextmenu={(ev) => {
    ev.preventDefault();
    onclose();
  }}
></button>
<div
  class="ctx-menu menu-surface"
  class:ask={wtAsk}
  role="menu"
  tabindex="-1"
  aria-label={t("app.projects.menu.aria")}
  data-project-menu
  bind:this={menuEl}
  onkeydown={menuKeydown}
>
  {#if project === null}
    <div class="ctx-title menu-title">{t("app.dock.title.projects")}</div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      onclick={() => runAfterClose(onclose, () => openProjectForm())}
    >
      {t("app.projects.add.project")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onreload)}>
      {t("files.hostmenu.refresh")}
    </button>
  {:else if wtAsk}
    <div class="ctx-title menu-title" title={project.path}>
      {t("app.projects.worktree.ask.title", { name: project.name })}
    </div>
    <input
      class="ctx-input menu-input"
      data-worktree-name
      bind:value={wtName}
      bind:this={wtInput}
      spellcheck="false"
      autocomplete="off"
      placeholder={t("app.projects.worktree.ask.placeholder")}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={wtRows.length > 0}
      aria-controls="worktree-rows"
      aria-activedescendant={wtActive >= 0 ? `worktree-row-${wtActive}` : undefined}
      onfocus={() => {
        wtListOpen = true;
      }}
      oninput={() => {
        wtError = null;
        wtListOpen = true;
        wtAt = -1;
      }}
      onkeydown={worktreeAskKeydown}
    />
    {#if wtRows.length > 0}
      <div class="wt-rows" id="worktree-rows" role="listbox" data-worktree-rows
        aria-label={t("app.projects.worktree.ask.rows.aria")}>
        {#each wtRows as r, i (rowKey(r))}
          <button
            type="button"
            role="option"
            tabindex="-1"
            id={`worktree-row-${i}`}
            class:on={i === wtActive}
            class:create={r.kind === "create"}
            aria-selected={i === wtActive}
            aria-disabled={!rowSelectable(r)}
            data-worktree-row-kind={r.kind}
            data-worktree-row-name={r.name}
            onmousedown={(ev) => ev.preventDefault()}
            onclick={() => chooseRow(r)}
          >
            <span class="glyph" aria-hidden="true">{r.kind === "create" ? "＋" : "⎇"}</span>
            <span class="name"
              >{r.kind === "create"
                ? t("app.projects.worktree.ask.row.create", { name: r.name })
                : r.kind === "remote"
                  ? r.ref
                  : r.name}</span
            >
            <span class="tag">{rowTag(r)}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if wtError}
      <div class="ctx-error">{wtError}</div>
    {:else if wtWhere}
      <div class="ctx-hint" data-worktree-where>{t("app.projects.worktree.ask.where", { path: wtWhere })}</div>
    {:else}
      <div class="ctx-error">{t("app.projects.worktree.error.nowhere")}</div>
    {/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" data-worktree-submit onclick={submitWorktreeAsk}>
        {t("app.projects.worktree.ask.submit")}
      </button>
    </div>
  {:else if worktree}
    {@const noScript = !hasSetupScript(project)}
    {@const listing = worktreesOf(project.id)}
    {@const mainName = (listing?.state === "ok" ? listing.list[0]?.branch : null) ?? "main"}
    <div class="ctx-title menu-title" title={worktree.path}>{worktree.branch ?? t("app.projects.worktrees.detached")}</div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="open"
      onclick={() => onWorktree(openProjectWorktree)}
    >
      {t("app.projects.menu.open")}
    </button>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="openHere"
      onclick={() => onWorktree(openProjectWorktreeHere)}
    >
      {t("app.projects.menu.openHere")}
    </button>
    {#each elsewhere as target (target.location.workspaceId)}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-project-action="revealOpen"
        onclick={() => runOnMenu(() => target.location, onclose, revealProjectLocation)}>
        {t("app.projects.menu.revealOpen", { name: target.name })}
      </button>
    {/each}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="branches"
      onclick={() => onWorktree((p, w) => openBranchGraph(p, w.branch))}
    >
      {t("app.projects.menu.branches")}
    </button>
    <button
      type="button"
      class="ctx-item menu-row diffrow"
      role="menuitem"
      data-worktree-action="diff"
      disabled={!worktree.branch}
      aria-disabled={!worktree.branch}
      title={worktree.branch ? undefined : t("app.projects.menu.diff.detached")}
      onclick={() =>
        onWorktree((p, w) => {
          if (w.branch) openDiff(p, { scope: "branch", branch: w.branch, worktreePath: w.path });
        })}
    >
      <span>{t("app.projects.menu.diff")}</span><span class="menu-kbd">{t("app.projects.menu.diff.sub", { main: mainName })}</span>
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="runSetup"
      disabled={noScript}
      aria-disabled={noScript}
      title={noScript ? t("app.projects.worktree.runSetup.empty") : undefined}
      onclick={() => onWorktree(runProjectSetupScript)}
    >
      {t("app.projects.worktree.runSetup")}
    </button>
    <!-- 앞의 [설정 스크립트 실행] 이 늘 서 있어 이 줄이 빠져도 구분선이 겹치지 않는다 -->
    {#if canRevealWorktree(project)}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-worktree-action="reveal"
        onclick={() => onWorktree(revealWorktree)}
      >
        {t("app.projects.worktree.reveal")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="deleteBranch"
      onclick={() => onWorktree((p) => openBranchDelete(p))}
    >
      {t("app.projects.worktrees.branch.delete")}
    </button>
    {#if !primary}
      <button
        type="button"
        class="ctx-item menu-row danger"
        role="menuitem"
        data-worktree-action="remove"
        onclick={() => onWorktree(confirmRemoveWorktree)}
      >
        {t("app.projects.worktrees.remove")}
      </button>
    {/if}
  {:else}
    <div class="ctx-title menu-title" title={project.path}>{project.name}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onProject(openProject)}>
      {t("app.projects.menu.open")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onProject(openProjectHere)}>
      {t("app.projects.menu.openHere")}
    </button>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-project-action="worktree"
      onclick={() => void startWorktreeAsk()}
    >
      {t("app.projects.menu.worktree")}
    </button>
    {#each elsewhere as target (target.location.workspaceId)}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-project-action="revealOpen"
        onclick={() => runOnMenu(() => target.location, onclose, revealProjectLocation)}>
        {t("app.projects.menu.revealOpen", { name: target.name })}
      </button>
    {/each}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-project-action="branches"
      onclick={() => onProject((p) => openBranchGraph(p))}
    >
      {t("app.projects.menu.branches")}
    </button>
    {#if !isRemote(project)}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-project-action="orchestration" onclick={() => onProject((p) => void startOrchestrationHere(p.id))}>
        {t("orch.start.openAiTile")}
      </button>
    {/if}
    {#if isRemote(project)}
      {#if hookTargets().length > 0}
        <div class="ctx-sep menu-sep" role="separator"></div>
      {/if}
      {#each hookTargets() as target (target.id)}
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          data-project-action="hooksInstall"
          data-hook-agent={target.id}
          onclick={() => onProject((p) => installRemoteHooks(p, target))}
        >
          {t("app.projects.hooks.install", { agent: target.display })}
        </button>
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          data-project-action="hooksRemove"
          data-hook-agent={target.id}
          onclick={() => onProject((p) => removeRemoteHooks(p, target))}
        >
          {t("app.projects.hooks.remove", { agent: target.display })}
        </button>
      {/each}
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-project-action="edit"
      onclick={() => onProject((p) => openProjectForm(p))}
    >
      {t("app.projects.menu.edit")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row danger"
      role="menuitem"
      data-project-action="remove"
      onclick={() => onProject(confirmRemoveProject)}
    >
      {t("app.projects.menu.remove")}
    </button>
  {/if}
</div>

<style>
  .diffrow {
    display: flex;
    align-items: center;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /* `ctx-*` 이름은 표식으로 남는다 — 검증 도구가 이 이름으로 찾는다 */
  .ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 160px;
    max-width: 240px;
  }

  .ctx-menu.ask {
    width: 340px;
    max-width: calc(100vw - 8px);
  }

  .ctx-hint {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--fg-3);
    white-space: normal;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .wt-rows {
    display: flex;
    flex-direction: column;
    max-height: calc(8 * 22px + 4px);
    overflow-y: auto;
    margin: 0 var(--space-1) var(--space-2);
    padding: 2px 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-field);
  }

  .wt-rows button {
    display: flex;
    flex: none;
    align-items: baseline;
    gap: var(--space-2);
    width: 100%;
    min-height: 22px;
    padding: 3px var(--space-2);
    border: 0;
    background: none;
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    text-align: left;
    cursor: pointer;
  }

  .wt-rows .glyph {
    flex: none;
    color: var(--fg-3);
  }

  .wt-rows .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wt-rows button.create .name {
    font-family: var(--font-ui);
  }

  .wt-rows button:hover:not([aria-disabled="true"]),
  .wt-rows button.on {
    background: var(--surface-hover);
  }

  /* `disabled` 대신 `aria-disabled` — 눌러도 칸이 포커스를 잃지 않게 mousedown 을 받아 막는다 */
  .wt-rows button[aria-disabled="true"] {
    color: var(--fg-3);
    cursor: default;
    opacity: 0.7;
  }

  .wt-rows .tag {
    flex: none;
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  .ctx-error {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
  }

  .ctx-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) 2px;
  }

  /* `ctx-btn` 은 표식으로만 남는다(검증 도구가 찾는다) — 여기 모양 규칙을 두면 스코프 규칙이 전역 `.btn` 을 이겨 전역 모양이 안 먹는다 */
</style>
