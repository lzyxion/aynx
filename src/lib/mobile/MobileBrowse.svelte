<!--
  **폰의 둘러보기 화면**(원격 웹 R5 · 10-20 — "호스트 · 프로젝트 · DB 전체 보기") — "새 탭에 열기" 시트에서 밀어 넣는 전체 화면. 머리 =
  44px 둥근 뒤로(→ 시트) + 칸 고르기 [호스트 | 프로젝트 | DB]. 몸통 = "최근"(몇 줄 · 열려 있으면 점) + "전체"(데스크톱 독과 **같은 트리** —
  순수 층 `hostTreeRows` · `projectTreeRows` · `dbDockTree` 와 둥지 꼴 `nestRows`, 펼친 폴더 = 둥근 묶음 판 `dock-tree.css`).

  폰 몸짓만 다르다: **두 번 누르기가 없다** — 폴더 줄을 누르면 펼치고 접고, 항목 줄을 누르면 고르기만 하고 줄 오른쪽에 알약 하나가 선다
  (호스트 [접속] · 프로젝트 [열기] · DB [쿼리 열기]). 알약을 누르면 그것 하나뿐인 새 탭(시트를 연 자리의 워크스페이스 — `openInTarget`)이고
  덮개가 모두 닫힌다. 끌어 놓기 · 폴더 편집 · 우클릭 메뉴는 없다. 펼침은 이 화면의 지역 상태다(데스크톱 독의 펼침 기록을 건드리지 않는다).
-->
<script lang="ts">
  import { pushOut } from "$lib/mobile/motion";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { fuzzyMatch, listGroupMeta, type GroupMeta } from "$lib/hosts";
  import { hostTreeRows } from "$lib/host-folders";
  import { historyOf, recentHosts } from "$lib/host-history";
  import { relativeTime } from "$lib/notifications";
  import { nestRows, type TreeNode } from "$lib/browser/tree-accordion";
  import "$lib/browser/dock-tree.css";
  import { listPanes } from "$lib/session";
  import { settings } from "$lib/settings.svelte.js";
  import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
  import { connectInNewTab, hostCache } from "$lib/app/hosts.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { projectTreeRows, sortProjects, worktreeLabel, type Project, type ProjectTreeRow, type WorktreeInfo } from "$lib/projects";
  import { loadWorktrees, openProject, openProjectWorktree, projects, refreshProjects, worktreesOf } from "$lib/app/projects.svelte.js";
  import { projectMarkers } from "$lib/app/project-locations.svelte.js";
  import { recentOpens, restoreRecentOpens } from "$lib/app/recent-worktrees.svelte.js";
  import { dbDockTree, type DbTreeRow } from "$lib/db-folders";
  import { dbLastOkAt } from "$lib/db-history";
  import { dbHistory } from "$lib/app/db-history.svelte.js";
  import { dbDockConnList, dbOpenLocations, refreshDbDock } from "$lib/app/db-dock.svelte.js";
  import { dbFolderMeta } from "$lib/app/db-folders.svelte.js";
  import { openQueryTileInNewTab } from "$lib/app/query.svelte.js";
  import {
    backToMobileSheet,
    closeMobileOverlay,
    mobileBrowseKind,
    openInTarget,
    setMobileBrowseKind,
    type BrowseKind,
  } from "$lib/app/mobile-sheets.svelte.js";
  import { openAliases, recentHostRows, recentProjectIds } from "$lib/mobile/launch";

  const NOTE: Record<"loading" | "offline" | "notRepo" | "error", Key> = {
    loading: "app.mobile.browse.note.loading",
    offline: "app.mobile.browse.note.offline",
    notRepo: "app.mobile.browse.note.notRepo",
    error: "app.mobile.browse.note.error",
  };
  const KINDS: { id: BrowseKind; label: Key }[] = [
    { id: "hosts", label: "app.dock.title.hosts" },
    { id: "projects", label: "app.dock.title.projects" },
    { id: "db", label: "app.dock.title.db" },
  ];
  const kind = $derived(mobileBrowseKind());
  /** 고른 줄의 열쇠(칸마다 다른 접두) — 그 줄 오른쪽에 알약이 선다 */
  let selected = $state<string | null>(null);

  let groupMeta = $state<Record<string, GroupMeta>>({});
  let hostOpen = $state<ReadonlySet<string>>(new Set());
  let projectOpen = $state<ReadonlySet<string>>(new Set());
  let dbOpen = $state<ReadonlySet<string>>(new Set());

  $effect(() => {
    void listGroupMeta()
      .then((m) => (groupMeta = m))
      .catch(() => {});
    restoreRecentOpens();
    void refreshProjects();
    refreshDbDock();
  });

  const now = Date.now();
  const open = $derived(openAliases(residentWindowTabs().flatMap((tab) => listPanes(tab.root))));
  const lastOk = (alias: string) => historyOf(hostHistory(), alias)?.last_ok_at ?? null;

  // ── 호스트 ──
  const recentH = $derived(recentHostRows(recentHosts(hostCache(), hostHistory()), lastOk, open));
  const hostRows = $derived(nestRows(hostTreeRows(hostCache(), groupMeta, hostOpen, "", { lastOkOf: lastOk }), (r) => r.depth));

  // ── 프로젝트 ──
  const ordered = $derived(sortProjects(projects(), settings.hostSort, hostHistory()));
  const recentP = $derived.by(() => {
    const byId = new Map(projects().map((p) => [p.id, p]));
    return recentProjectIds(recentOpens(), new Set(byId.keys())).map((r) => ({ project: byId.get(r.id)!, at: r.at }));
  });
  const projectRows = $derived(
    nestRows(projectTreeRows(ordered, "", projectOpen, worktreesOf, fuzzyMatch), (r) => (r.kind === "project" ? 0 : 1)),
  );

  // ── DB ──
  const dbRows = $derived(nestRows(dbDockTree(dbDockConnList(), dbFolderMeta(), dbOpen, "", fuzzyMatch), (r) => r.depth));
  const dbOpenIds = $derived(new Set(dbOpenLocations().map((l) => l.connId)));

  function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function pick(key: string) {
    selected = selected === key ? null : key;
  }

  function toggleProject(p: Project) {
    const wasOpen = projectOpen.has(p.id);
    projectOpen = toggle(projectOpen, p.id);
    if (!wasOpen && worktreesOf(p.id) === undefined) void loadWorktrees(p);
  }

  function connect(name: string) {
    const host = hostCache().find((h) => h.name === name);
    if (host) openInTarget(() => connectInNewTab(host));
  }

  function openWorktree(p: Project, w: WorktreeInfo) {
    openInTarget(() => openProjectWorktree(p, w));
  }

  function switchKind(id: BrowseKind) {
    selected = null;
    setMobileBrowseKind(id);
  }

  let back = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    back?.focus({ preventScroll: true });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    backToMobileSheet();
  }
</script>

{#snippet act(label: string, run: () => void)}
  <button type="button" class="act" onclick={run}>{label}</button>
{/snippet}

{#snippet hostBranch(nodes: TreeNode<ReturnType<typeof hostTreeRows>[number]>[])}
  {#each nodes as node}
    {@const row = node.row}
    {#if row.kind === "folder"}
      <li class="dtree-node" class:open={row.expanded}>
        <button type="button" class="row folder" aria-expanded={row.expanded} onclick={() => (hostOpen = toggle(hostOpen, row.fullPath))}>
          <span class="ico" aria-hidden="true"><UiIcon name={row.expanded ? "folder-open" : "folder"} size={18} filled /></span>
          <span class="name">{row.label}</span>
          <span class="count">{row.count}</span>
          <span class="dtree-chev" aria-hidden="true"><UiIcon name="chevron-down" size={16} /></span>
        </button>
        {#if row.expanded && node.children.length > 0}
          <ul class="dtree-kids">{@render hostBranch(node.children)}</ul>
        {/if}
      </li>
    {:else}
      {@const key = `h:${row.host.name}`}
      <li class="dtree-node">
        <div class="line" class:picked={selected === key}>
          <button type="button" class="row" aria-pressed={selected === key} onclick={() => pick(key)}>
            <span class="ico" aria-hidden="true"><UiIcon name="server" size={18} /></span>
            <span class="name">{row.host.name}</span>
            {#if row.lastOkAt !== null}<span class="sub">{relativeTime(row.lastOkAt, now, t)}</span>{/if}
            {#if open.has(row.host.name.toLowerCase())}<span class="dot" aria-label={t("app.mobile.connected")}></span>{/if}
          </button>
          {#if selected === key}{@render act(t("app.mobile.browse.connect"), () => connect(row.host.name))}{/if}
        </div>
      </li>
    {/if}
  {/each}
{/snippet}

{#snippet projectBranch(nodes: TreeNode<ProjectTreeRow>[])}
  {#each nodes as node}
    {@const row = node.row}
    {#if row.kind === "project"}
      {@const p = row.project}
      {@const key = `p:${p.id}`}
      <li class="dtree-node" class:open={row.expanded}>
        <div class="line" class:picked={selected === key}>
          <button type="button" class="row" aria-pressed={selected === key} onclick={() => pick(key)}>
            <span class="ico" aria-hidden="true"><UiIcon name="project" size={18} /></span>
            <span class="name">{p.name}</span>
            <span class="sub">{p.host ? p.host : t("app.mobile.browse.local")}</span>
            {#if projectMarkers(p).here}<span class="dot" aria-label={t("app.mobile.connected")}></span>{/if}
          </button>
          {#if selected === key}{@render act(t("app.mobile.browse.open"), () => openInTarget(() => openProject(p)))}{/if}
          <button
            type="button"
            class="chev"
            aria-expanded={row.expanded}
            aria-label={t("app.mobile.browse.worktrees", { name: p.name })}
            onclick={() => toggleProject(p)}><span class="dtree-chev"><UiIcon name="chevron-down" size={16} /></span></button
          >
        </div>
        {#if row.expanded && node.children.length > 0}
          <ul class="dtree-kids">{@render projectBranch(node.children)}</ul>
        {/if}
      </li>
    {:else if row.kind === "worktree"}
      {@const key = `w:${row.key}`}
      {@const wl = worktreeLabel(row.worktree)}
      <li class="dtree-node">
        <div class="line" class:picked={selected === key}>
          <button type="button" class="row kid" aria-pressed={selected === key} onclick={() => pick(key)}>
            <span class="ico" aria-hidden="true"><UiIcon name="git-branch" size={16} /></span>
            <span class="name">{wl.branch ?? wl.tail}</span>
            {#if wl.branch}<span class="sub mono">{wl.tail}</span>{/if}
          </button>
          {#if selected === key}{@render act(t("app.mobile.browse.open"), () => openWorktree(row.project, row.worktree))}{/if}
        </div>
      </li>
    {:else}
      <li class="dtree-node"><p class="note">{row.message ?? t(NOTE[row.note])}</p></li>
    {/if}
  {/each}
{/snippet}

{#snippet dbBranch(nodes: TreeNode<DbTreeRow>[])}
  {#each nodes as node}
    {@const row = node.row}
    {#if row.kind === "folder"}
      <li class="dtree-node" class:open={row.expanded}>
        <button type="button" class="row folder" aria-expanded={row.expanded} onclick={() => (dbOpen = toggle(dbOpen, row.fullPath))}>
          <span class="ico" aria-hidden="true"><UiIcon name={row.expanded ? "folder-open" : "folder"} size={18} filled /></span>
          <span class="name">{row.label}</span>
          <span class="count">{row.count}</span>
          <span class="dtree-chev" aria-hidden="true"><UiIcon name="chevron-down" size={16} /></span>
        </button>
        {#if row.expanded && node.children.length > 0}
          <ul class="dtree-kids">{@render dbBranch(node.children)}</ul>
        {/if}
      </li>
    {:else}
      {@const key = `d:${row.id}`}
      <!-- 마지막 접속(독 DB 칸과 같은 `db-history` · 10-20 — 줄에 주소는 없다) -->
      {@const lastDb = dbLastOkAt(dbHistory(), row.id)}
      <li class="dtree-node">
        <div class="line" class:picked={selected === key}>
          <button type="button" class="row" aria-pressed={selected === key} onclick={() => pick(key)}>
            <span class="ico" aria-hidden="true"><UiIcon name="database" size={18} /></span>
            <span class="name">{row.name}</span>
            {#if lastDb !== null}<span class="sub">{relativeTime(lastDb, now, t)}</span>{/if}
            {#if dbOpenIds.has(row.id)}<span class="dot" aria-label={t("app.mobile.connected")}></span>{/if}
          </button>
          {#if selected === key}{@render act(t("app.mobile.browse.query"), () => openInTarget(() => openQueryTileInNewTab(row.id, row.tabName)))}{/if}
        </div>
      </li>
    {/if}
  {/each}
{/snippet}

<div class="browse" out:pushOut|global role="dialog" aria-modal="true" aria-label={t("app.mobile.sheet.browseAll")} tabindex="-1" {onkeydown}>
  <header class="head">
    <button type="button" class="round" bind:this={back} title={t("app.mobile.back")} aria-label={t("app.mobile.back")} onclick={backToMobileSheet}
      ><UiIcon name="chevron-left" size={20} /></button
    >
    <div class="seg" role="tablist" aria-label={t("app.mobile.browse.kinds")}>
      {#each KINDS as k (k.id)}
        <button type="button" role="tab" class:selected={kind === k.id} aria-selected={kind === k.id} onclick={() => switchKind(k.id)}
          >{t(k.label)}</button
        >
      {/each}
    </div>
    <button type="button" class="round" title={t("app.mobile.picker.close")} aria-label={t("app.mobile.picker.close")} onclick={closeMobileOverlay}
      ><UiIcon name="close" size={18} /></button
    >
  </header>

  <div class="body">
    {#if kind === "hosts"}
      {#if recentH.length > 0}
        <h3 class="label">{t("app.mobile.browse.recent")}</h3>
        <ul class="list panel">
          {#each recentH as r (r.name)}
            {@const key = `rh:${r.name}`}
            <li class="dtree-node">
              <div class="line" class:picked={selected === key}>
                <button type="button" class="row" aria-pressed={selected === key} onclick={() => pick(key)}>
                  <span class="ico" aria-hidden="true"><UiIcon name="server" size={18} /></span>
                  <span class="name">{r.name}</span>
                  {#if r.at !== null}<span class="sub">{relativeTime(r.at, now, t)}</span>{/if}
                  {#if r.connected}<span class="dot" aria-label={t("app.mobile.connected")}></span>{/if}
                </button>
                {#if selected === key}{@render act(t("app.mobile.browse.connect"), () => connect(r.name))}{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <h3 class="label">{t("app.mobile.browse.all")}</h3>
      {#if hostRows.length === 0}
        <p class="empty">{t("app.mobile.browse.empty.hosts")}</p>
      {:else}
        <ul class="list panel">{@render hostBranch(hostRows)}</ul>
      {/if}
    {:else if kind === "projects"}
      {#if recentP.length > 0}
        <h3 class="label">{t("app.mobile.browse.recent")}</h3>
        <ul class="list panel">
          {#each recentP as r (r.project.id)}
            {@const key = `rp:${r.project.id}`}
            <li class="dtree-node">
              <div class="line" class:picked={selected === key}>
                <button type="button" class="row" aria-pressed={selected === key} onclick={() => pick(key)}>
                  <span class="ico" aria-hidden="true"><UiIcon name="project" size={18} /></span>
                  <span class="name">{r.project.name}</span>
                  <span class="sub">{relativeTime(r.at, now, t)}</span>
                  {#if projectMarkers(r.project).here}<span class="dot" aria-label={t("app.mobile.connected")}></span>{/if}
                </button>
                {#if selected === key}{@render act(t("app.mobile.browse.open"), () => openInTarget(() => openProject(r.project)))}{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <h3 class="label">{t("app.mobile.browse.all")}</h3>
      {#if projectRows.length === 0}
        <p class="empty">{t("app.mobile.browse.empty.projects")}</p>
      {:else}
        <ul class="list panel">{@render projectBranch(projectRows)}</ul>
      {/if}
    {:else}
      <h3 class="label">{t("app.mobile.browse.all")}</h3>
      {#if dbRows.length === 0}
        <p class="empty">{t("app.mobile.browse.empty.db")}</p>
      {:else}
        <ul class="list panel">{@render dbBranch(dbRows)}</ul>
      {/if}
    {/if}
  </div>
</div>

<style>
  .browse {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--app-h, 100dvh);
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--m3-surface);
    color: var(--fg-1);
    outline: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .browse {
      animation: browse-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes browse-in {
    from {
      /* 화면 폭 전체가 오른쪽에서 밀려 들어온다(밀어 넣는 화면) — 아래에서 올라오는 것은 새 탭 시트뿐 */
      transform: translateX(100%);
    }
  }
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }
  .round {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    cursor: pointer;
  }
  /* 이어 붙은 묶음(2026-10-28 — 설정 칩과 같은 규칙 · 목업 6eWvPcEZZeQ7sgGckwkBed): 2px 틈, 바깥 끝 = 반원 · 맞닿는 쪽 = 6px, 고른 칸만 알약 */
  .seg {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    height: 44px;
    gap: 2px;
  }
  .seg button {
    flex: 1 1 0;
    min-width: 0;
    border: 0;
    background: var(--m3-surface-container-high);
    color: var(--fg-2);
    font: inherit;
    font-size: var(--t-sm);
    cursor: pointer;
  }
  .seg > button {
    border-radius: 6px;
    transition: border-radius 200ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 120ms ease;
  }
  .seg > button:first-child {
    border-top-left-radius: 22px;
    border-bottom-left-radius: 22px;
  }
  .seg > button:last-child {
    border-top-right-radius: 22px;
    border-bottom-right-radius: 22px;
  }
  .seg > button.selected {
    border-radius: 22px;
  }
  .seg button.selected {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
    font-weight: var(--fw-semibold);
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-1) var(--space-3) var(--space-4);
  }
  .label {
    margin: var(--space-3) 0 var(--space-2) var(--space-2);
    color: var(--accent);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
  }
  .list {
    margin: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .panel {
    padding: 4px;
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container-low);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-surface-inner);
  }
  .line.picked {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
  }
  .row {
    box-sizing: border-box;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 0 var(--space-3) 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row.kid {
    padding-left: var(--space-4);
  }
  .ico {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-2);
  }
  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }
  .sub,
  .count {
    flex: 0 10 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  .line.picked .sub {
    color: inherit;
    opacity: 0.8;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    margin-left: auto;
    border-radius: 999px;
    background: var(--ok, #3fb950);
  }
  .act {
    flex: 0 0 auto;
    height: 36px;
    min-width: 44px;
    margin-right: 6px;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font: inherit;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    cursor: pointer;
  }
  .chev {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
  }
  .note,
  .empty {
    margin: 0;
    padding: var(--space-3);
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .round:focus-visible,
  .seg button:focus-visible,
  .row:focus-visible,
  .act:focus-visible,
  .chev:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
