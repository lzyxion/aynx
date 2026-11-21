<script lang="ts">
  import { openHereFirst } from "$lib/project-locations";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import { projectMarkers } from "$lib/app/project-locations.svelte.js";
  import { tick, untrack } from "svelte";
  import { dockKind } from "$lib/app/dock.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import ProjectMenu from "$lib/browser/ProjectMenu.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { fuzzyMatch } from "$lib/hosts";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { settings, setHostSort } from "$lib/settings.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
  import { dockAgentPanes, dockProjectFolders } from "$lib/app/dock-dots.svelte.js";
  import { projectDots, worktreeDotKey } from "$lib/dock-dots";
  import { isUnbornHead } from "$lib/repo-status";
  import { worktreeChangesOf } from "$lib/app/worktree-changes.svelte.js";
  import { changeBadgeMerged, changeBadgeParts, changeBadgeText, changeBadgeTitle } from "$lib/worktree-changes";
  import { openBranchGraph } from "$lib/app/branch-graph.svelte.js";
  import {
    accordion,
    createDeferredClick,
    nestRows,
    plainClick,
    treeMotion,
    type TreeNode,
  } from "$lib/browser/tree-accordion";
  import "$lib/browser/dock-tree.css";
  import {
    isRemote,
    PROJECT_DRAG_TYPE,
    projectTail,
    projectTreeRows,
    sortProjects,
    worktreeLabel,
    type Project,
    type ProjectTreeRow,
    type WorktreeInfo,
  } from "$lib/projects";
  import {
    confirmRemoveProject,
    confirmRemoveWorktree,
    expandedProjects,
    initProjectRepo,
    loadWorktrees,
    openProject,
    openProjectForm,
    openProjectHere,
    openProjectWorktreeHere,
    openProjectWorktree,
    projects,
    refreshProjects,
    refreshShownWorktrees,
    restoreExpandedProjects,
    setProjectExpanded,
    worktreesOf,
  } from "$lib/app/projects.svelte.js";

  let query = $state("");
  let searchEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  let selected = $state<string | null>(null);
  /** Escape 로 선택을 벗긴 뒤에는 다시 고르지 않는다 — 한 겹씩 벗는 규칙이 산다 */
  let autoPick = $state(false);
  /** `project: null` = 빈 배경 메뉴 · `ask` = 프로젝트 줄 `+`(Insert)가 연 새 워크트리 이름 칸 */
  let menu = $state<{
    project: Project | null;
    worktree?: WorktreeInfo;
    primary?: boolean;
    ask?: boolean;
    x: number;
    y: number;
  } | null>(null);

  restoreExpandedProjects();

  /** `openHereFirst` 는 최근순에서만 건다 — 이름순 위에 걸면 글자순이 깨져 보인다 */
  const ordered = $derived.by(() => {
    const sorted = sortProjects(projects(), settings.hostSort, hostHistory());
    return settings.hostSort === "recent" ? openHereFirst(sorted, (p) => projectMarkers(p).here) : sorted;
  });

  const rows = $derived(projectTreeRows(ordered, query, expandedProjects(), worktreesOf, fuzzyMatch));

  const pickable = $derived(rows.filter((r) => r.kind !== "note"));

  const current = $derived(pickable.find((r) => r.key === selected) ?? null);

  $effect(() => {
    const searching = query.trim() !== "";
    const open = expandedProjects();
    for (const p of projects()) {
      if (worktreesOf(p.id) !== undefined) continue;
      if (searching || open.has(p.id)) void loadWorktrees(p);
    }
  });

  /** 이 목록은 독 안에 늘 마운트돼 있다(`hidden` 으로만 숨는다) — 보이는지는 `dockKind()` 가 답한다 */
  const projectsShown = $derived(dockKind() === "projects");
  $effect(() => {
    if (projectsShown) untrack(() => refreshShownWorktrees());
  });
  $effect(() => {
    const onFocus = () => {
      if (dockKind() === "projects") refreshShownWorktrees();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  function firstPick(): string | null {
    const first = pickable[0];
    if (!first) return null;
    if (first.kind === "project" && first.auto) return pickable[1]?.key ?? first.key;
    return first.key;
  }

  $effect(() => {
    if (autoPick && query.trim() !== "" && current === null) selected = firstPick();
  });

  function onQueryInput() {
    autoPick = query.trim() !== "";
    selected = autoPick ? firstPick() : null;
  }

  function select(key: string) {
    selected = key;
    void tick().then(() =>
      listEl?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  }

  function move(delta: number) {
    if (pickable.length === 0) return;
    const at = current ? pickable.indexOf(current) : -1;
    const next =
      at < 0 ? (delta > 0 ? 0 : pickable.length - 1) : Math.min(pickable.length - 1, Math.max(0, at + delta));
    const row = pickable[next];
    if (row) select(row.key);
  }

  function setOpen(p: Project, open: boolean) {
    if (expandedProjects().has(p.id) !== open) treeMotion.mark(`project:${p.id}`);
    setProjectExpanded(p, open);
  }

  const tree = $derived(nestRows(rows, (r) => (r.kind === "project" ? 0 : 1)));

  const deferredToggle = createDeferredClick();
  $effect(() => () => deferredToggle.cancel());

  function clickProject(ev: MouseEvent, key: string) {
    selected = key;
    if (!plainClick(ev) || ev.detail > 1) return;
    deferredToggle.schedule(() => {
      // 그사이 목록이 바뀌었을 수 있다 — 지금의 줄로 다시 본다
      const row = rows.find((r) => r.key === key);
      if (row?.kind === "project" && !row.auto) setOpen(row.project, !row.expanded);
    });
  }

  const dots = $derived(projectDots(dockAgentPanes(), dockProjectFolders(), remoteHomeOf, t));

  function openRowMenu(ev: MouseEvent, row: ProjectTreeRow) {
    ev.preventDefault();
    ev.stopPropagation();
    selected = row.key;
    if (row.kind === "worktree")
      menu = { project: row.project, worktree: row.worktree, primary: row.primary, x: ev.clientX, y: ev.clientY };
    else menu = { project: row.project, x: ev.clientX, y: ev.clientY };
  }

  function openAsk(p: Project) {
    selected = p.id;
    const el = listEl?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(p.id)}"]`);
    const r = el?.getBoundingClientRect();
    menu = { project: p, ask: true, x: r ? r.left : 40, y: r ? r.bottom + 2 : 40 };
  }

  const askingFor = $derived(menu?.ask ? (menu.project?.id ?? null) : null);

  function openBgMenu(ev: MouseEvent) {
    ev.preventDefault();
    menu = { project: null, x: ev.clientX, y: ev.clientY };
  }

  function closeMenu() {
    menu = null;
  }

  async function reloadAll() {
    await refreshProjects();
    for (const p of projects()) if (worktreesOf(p.id) !== undefined) void loadWorktrees(p);
  }

  function startDrag(ev: DragEvent, p: Project) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    dt.setData(PROJECT_DRAG_TYPE, p.id);
    dt.setData("text/plain", p.path);
    dt.effectAllowed = "copy";
  }

  function activate(row: ProjectTreeRow) {
    if (row.kind === "project") void openProject(row.project);
    else if (row.kind === "worktree") void openProjectWorktree(row.project, row.worktree);
  }

  function onKeydown(ev: KeyboardEvent) {
    // IME 조합 중(한글 입력)에는 방향키·Enter 가 변환용이므로 가로채지 않는다
    if (ev.isComposing || ev.keyCode === 229) return;
    if (menu) return;
    const target = ev.target as HTMLElement | null;
    const inSearch = target !== null && target === searchEl;
    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.key === "Enter") {
      if (!current) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (current.kind === "project") void openProjectHere(current.project);
      else if (current.kind === "worktree") void openProjectWorktreeHere(current.project, current.worktree);
      return;
    }
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const tag = target?.tagName;
    if (tag === "BUTTON" && !target?.dataset.rowKey && (ev.key === "Enter" || ev.key === " ")) return;

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      move(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      move(-1);
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      if (inSearch || !current) return;
      ev.preventDefault();
      if (current.kind === "project") {
        if (ev.key === "ArrowRight") {
          if (current.expanded) {
            const next = pickable[pickable.indexOf(current) + 1];
            if (next && next.kind !== "project") select(next.key);
          } else setOpen(current.project, true);
        } else if (current.expanded && !current.auto) setOpen(current.project, false);
      } else if (ev.key === "ArrowLeft") {
        select(current.project.id);
      }
    } else if (ev.key === "Enter") {
      if (!current) return;
      ev.preventDefault();
      activate(current);
    } else if (ev.key === "F2") {
      if (current?.kind !== "project") return;
      ev.preventDefault();
      openProjectForm(current.project);
    } else if (ev.key === "Insert") {
      // 검색 칸에서도 받는다 — 맨 Insert 는 전역 키바인딩에 없고 글자를 바꾸지 않는다
      if (!current) return;
      ev.preventDefault();
      openAsk(current.project);
    } else if (ev.key === "Delete") {
      if (inSearch || !current) return;
      if (current.kind === "project") {
        ev.preventDefault();
        ev.stopPropagation();
        void confirmRemoveProject(current.project);
      } else if (current.kind === "worktree" && !current.primary) {
        ev.preventDefault();
        ev.stopPropagation();
        confirmRemoveWorktree(current.project, current.worktree);
      }
    } else if (ev.key === "Escape") {
      if (selected !== null) {
        ev.preventDefault();
        ev.stopPropagation();
        selected = null;
        autoPick = false;
      } else if (query !== "") {
        ev.preventDefault();
        ev.stopPropagation();
        query = "";
        autoPick = false;
      }
    }
  }

  export function focusSearch(): void {
    searchEl?.focus({ preventScroll: true });
    searchEl?.select();
  }
</script>

<div class="projects" role="presentation" tabindex="-1" data-project-dock onkeydown={onKeydown}>
  <div class="dock-search">
    <label class="dock-search-box">
      <UiIcon name="search" size={14} />
      <input
        class="search"
        type="search"
        bind:value={query}
        bind:this={searchEl}
        oninput={onQueryInput}
        placeholder={t("app.projects.search.placeholder")}
        aria-label={t("app.projects.search.aria")}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      title={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-label={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-pressed={settings.hostSort === "recent"}
      data-project-sort={settings.hostSort}
      onclick={() => setHostSort(settings.hostSort === "recent" ? "name" : "recent")}
      ><UiIcon name={settings.hostSort === "recent" ? "sort-recent" : "sort-name"} size={14} /></button
    >
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      data-project-add
      title={t("app.projects.add.project")}
      aria-label={t("app.projects.add.project")}
      onclick={() => openProjectForm()}><UiIcon name="plus" size={14} /></button
    >
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="body" oncontextmenu={openBgMenu}>
    {#if projects().length === 0}
      <p class="empty" data-project-empty>{t("app.projects.empty")}</p>
    {:else if rows.length === 0}
      <p class="empty">{t("app.projects.noMatch")}</p>
    {:else}
      <ul class="list" aria-label={t("app.projects.list.aria")} bind:this={listEl}>
        {@render branch(tree)}
      </ul>
    {/if}
  </div>

  {#snippet branch(nodes: TreeNode<ProjectTreeRow>[])}
        {#each nodes as node (node.row.key)}
          {@const row = node.row}
          {#if row.kind === "project"}
            {@const p = row.project}
            {@const remote = isRemote(p)}
            {@const opened = projectMarkers(p)}
            {@const motionKey = `project:${p.id}`}
            <li class="dtree-node" class:open={row.expanded} class:still={!treeMotion.allows(motionKey)}>
              <button
                type="button"
                class="item"
                class:selected={selected === row.key}
                data-project-id={p.id}
                data-row-key={row.key}
                aria-expanded={row.expanded}
                title={remote ? `${p.host}:${p.path}` : p.path}
                draggable="true"
                ondragstart={(ev) => startDrag(ev, p)}
                onclick={(ev) => clickProject(ev, row.key)}
                ondblclick={() => {
                  deferredToggle.cancel();
                  void openProject(p);
                }}
                oncontextmenu={(ev) => openRowMenu(ev, row)}
              >
                <span class="line">
                  <span class="lead"><ProjectIcon project={p} size={ROW_ICON_PX} /></span>
                  <span class="name-cell">
                    <span class="name">{p.name}</span>
                    {#if opened.here}
                      <span class="open-here" data-project-open-here title={t("app.projects.badge.openHere")}>
                        <UiIcon name="layout" size={12} label={t("app.projects.badge.openHere")} />
                      </span>
                    {/if}
                    {#if !row.expanded && dots.project[p.id]}
                      {@const pdot = dots.project[p.id]}
                      <AgentStatusGlyph
                        state={pdot.state}
                        data-agent-dot={pdot.state}
                        data-project-dot={p.id}
                        title={pdot.label}
                        aria-label={pdot.label}
                      />
                    {/if}
                    <span class="where" class:remote>{remote ? p.host : t("app.projects.badge.local")}</span>
                  </span>
                  {#if opened.badge}<span class="open-elsewhere" data-project-open-elsewhere>{opened.badge}</span>{/if}
                  <span class="hint">{projectTail(p.path)}</span>
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                  <span
                    class="row-add"
                    class:open={askingFor === p.id}
                    data-worktree-add={p.id}
                    title={`${t("app.projects.tree.add")} (Insert)`}
                    aria-label={t("app.projects.tree.add")}
                    onclick={(ev) => {
                      ev.stopPropagation();
                      openAsk(p);
                    }}
                    ondblclick={(ev) => ev.stopPropagation()}
                    ><UiIcon name="plus" size={12} /></span
                  >
                  <span
                    class="dtree-chev"
                    data-project-twisty
                    aria-hidden="true"
                    title={row.expanded ? t("app.projects.tree.collapse") : t("app.projects.tree.expand")}
                    ><UiIcon name="chevron-down" size={14} /></span
                  >
                </span>
              </button>
              {#if node.children.length > 0}
                <ul class="dtree-kids" transition:accordion={{ key: motionKey }}>
                  {@render branch(node.children)}
                </ul>
              {/if}
            </li>
          {:else if row.kind === "worktree"}
            {@const w = row.worktree}
            {@const opened = projectMarkers(row.project, w.path)}
            {@const label = worktreeLabel(w)}
            {@const dot = dots.worktree[worktreeDotKey(row.project.id, w.path)]}
            {@const changes = row.primary ? undefined : worktreeChangesOf(row.project.id, w.path)}
            {@const badge = changeBadgeParts(changes)}
            {@const merged = changeBadgeMerged(changes)}
            <li class="dtree-node">
              <button
                type="button"
                class="item child"
                class:selected={selected === row.key}
                data-row-key={row.key}
                data-worktree-row={w.path}
                data-worktree-parent={row.project.id}
                title={t("app.projects.worktrees.open.title", { path: w.path })}
                onclick={() => (selected = row.key)}
                ondblclick={() => void openProjectWorktree(row.project, w)}
                oncontextmenu={(ev) => openRowMenu(ev, row)}
              >
                <span class="line">
                  <span class="name-cell">
                    <span class="branch" class:primary={row.primary}>{label.tail}</span>
                    {#if opened.here}
                      <span class="open-here" data-worktree-open-here title={t("app.projects.badge.openHere")}>
                        <UiIcon name="layout" size={12} label={t("app.projects.badge.openHere")} />
                      </span>
                    {/if}
                    {#if dot}
                      <AgentStatusGlyph
                        state={dot.state}
                        data-agent-dot={dot.state}
                        title={dot.label}
                        aria-label={dot.label}
                      />
                    {/if}
                    {#if row.primary}
                      <span class="where" data-worktree-primary>{t("app.projects.worktrees.primary")}</span>
                    {/if}
                  </span>
                  {#if row.primary && isUnbornHead(w.head)}
                    <span class="where" data-worktree-nocommit>{t("app.projects.worktrees.noCommit")}</span>
                  {/if}
                  {#if opened.badge}<span class="open-elsewhere" data-worktree-open-elsewhere>{opened.badge}</span>{/if}
                  {#if badge.length > 0 || merged}
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <span
                      class="changes"
                      class:merged
                      data-worktree-changes={merged ? "merged" : changeBadgeText(badge)}
                      title={`${changeBadgeTitle(changes, t)}\n${t("app.projects.worktrees.changes.open")}`}
                      onclick={(ev) => {
                        ev.stopPropagation();
                        selected = row.key;
                        openBranchGraph(row.project, w.branch);
                      }}
                      ondblclick={(ev) => ev.stopPropagation()}
                      >{#if merged}{t("app.projects.worktrees.changes.merged")}{:else}{#each badge as part, i (part.kind)}{#if i > 0}{" "}{/if}<span
                            class="part {part.kind}">{part.sym}{part.n}</span
                          >{/each}{/if}</span
                    >
                  {/if}
                  {#if merged && !row.primary}
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <span
                      class="cleanup"
                      data-worktree-cleanup
                      title={t("app.projects.worktrees.cleanup.title")}
                      onclick={(ev) => {
                        ev.stopPropagation();
                        selected = row.key;
                        confirmRemoveWorktree(row.project, w);
                      }}
                      ondblclick={(ev) => ev.stopPropagation()}>{t("app.projects.worktrees.cleanup")}</span
                    >
                  {/if}
                  <span class="hint">{label.branch ?? t("app.projects.worktrees.detached")}</span>
                  <span class="dtree-chev-pad" aria-hidden="true"></span>
                </span>
              </button>
            </li>
          {:else if row.note === "notRepo"}
            <li class="note repo-note" data-worktree-note="notRepo">
              <span>{t("app.projects.worktrees.notRepo")}</span>
              <button
                type="button"
                class="btn btn-secondary note-btn"
                data-repo-init={row.project.id}
                onclick={() => void initProjectRepo(row.project)}>{t("app.projects.worktrees.init")}</button
              >
            </li>
          {:else}
            <li
              class="note"
              class:error={row.note === "error"}
              data-worktree-note={row.note}
              title={row.note === "error" ? (row.message ?? "") : undefined}
            >
              {row.note === "loading"
                ? t("app.projects.worktrees.loading")
                : row.note === "offline"
                  ? t("app.projects.worktrees.offline")
                  : row.message}
            </li>
          {/if}
        {/each}
  {/snippet}

  {#if menu}
    <ProjectMenu
      project={menu.project}
      worktree={menu.worktree ?? null}
      primary={menu.primary ?? false}
      ask={menu.ask ?? false}
      x={menu.x}
      y={menu.y}
      onclose={closeMenu}
      onreload={() => void reloadAll()}
    />
  {/if}
</div>

<style>
  .open-here {
    display: inline-flex;
    align-items: center;
    width: 12px;
    height: 12px;
    color: var(--fg-2);
    flex-shrink: 0;
  }
  .open-elsewhere { color: var(--fg-3); font-size: var(--t-xs); white-space: nowrap; }
  .projects {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--glass-inner, var(--surface-raised-solid));
    user-select: none;
  }

  .projects:focus {
    outline: none;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .list {
    margin: 0;
    padding: var(--row-inset);
    list-style: none;
  }

  .item {
    display: block;
    width: 100%;
    padding: var(--row-pad-y) var(--row-pad-x);
    text-align: left;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .item:hover {
    background: var(--surface-hover);
  }

  .item.selected {
    background: var(--accent-soft);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    min-width: 0;
  }

  .lead {
    flex: 0 0 var(--row-icon);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
  }

  .name-cell {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .name {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--row-font);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .where {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .where.remote {
    color: var(--fg-2);
  }

  .hint {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 보이지 않을 때는 잡히지도 않는다 — 투명한 채 눌리면 유령 단추가 된다 */
  .row-add {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--fg-3);
    border-radius: var(--radius-sm);
    opacity: 0;
    pointer-events: none;
    transition: opacity 90ms ease;
  }

  .item:hover .row-add,
  .item.selected .row-add,
  .item:focus-visible .row-add,
  .row-add.open {
    opacity: 1;
    pointer-events: auto;
  }

  .row-add:hover,
  .row-add.open {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .item.child {
    padding-left: calc(var(--row-pad-x) + 14px);
  }

  .branch {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--row-font);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch.primary {
    font-weight: 600;
  }

  .item.child .hint {
    margin-left: auto;
  }

  .changes {
    flex: 0 0 auto;
    padding: 0 3px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    white-space: nowrap;
  }

  .changes:hover {
    background: var(--surface-hover);
    color: var(--fg-2);
  }

  .changes .plus {
    color: color-mix(in srgb, var(--ok) 70%, var(--fg-3));
  }

  .changes .minus {
    color: color-mix(in srgb, var(--err) 70%, var(--fg-3));
  }

  .changes.merged {
    border: 1px solid var(--line);
    color: var(--fg-2);
    font-family: var(--font-ui);
  }

  .cleanup {
    flex: none;
    padding: 0 3px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--fg-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    white-space: nowrap;
  }

  .cleanup:hover {
    background: var(--surface-hover);
    color: var(--fg-1);
  }

  .note {
    padding: var(--row-pad-y) var(--row-pad-x);
    padding-left: calc(var(--row-pad-x) + 14px);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note.error {
    color: var(--err);
  }

  .note.repo-note {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    color: var(--fg-2);
    white-space: normal;
  }

  .note-btn {
    height: 24px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
  }

  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  :global(.dock.launcher) .item {
    border-radius: var(--radius-row);
  }

  :global(.dock.launcher) .item:hover {
    background: color-mix(in srgb, var(--fg-1) var(--state-hover), transparent);
  }

  :global(.dock.launcher) .item.selected {
    color: var(--on-accent-soft);
    background: var(--glass-pick, var(--accent-soft));
  }

  :global(.dock.launcher) .lead {
    flex-basis: 28px;
    height: 28px;
  }

  :global(.dock.launcher) .item:not(.folder, .child) > .line > .lead {
    border-radius: 50%;
    color: var(--m3-on-secondary-container);
    background: var(--m3-secondary-container);
  }

  :global(.dock.launcher) :is(.where) {
    padding: 1px 8px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
</style>
