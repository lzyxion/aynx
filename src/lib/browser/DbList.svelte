<script lang="ts">
  import { tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import DbMenu from "$lib/browser/DbMenu.svelte";
  import FolderEditDialog from "$lib/browser/FolderEditDialog.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { fuzzyMatch } from "$lib/hosts";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { dockKind } from "$lib/app/dock.svelte.js";
  import { currentWorkspaceId, workspaceList } from "$lib/app/workspaces.svelte.js";
  import { openLocationMarkers } from "$lib/project-locations";
  import { settings, setHostSort } from "$lib/settings.svelte.js";
  import { dbHistory } from "$lib/app/db-history.svelte.js";
  import { dbLastOkAt, dbTooltipLines } from "$lib/db-history";
  import { relativeTime } from "$lib/history-search";
  import { dbConnLocations, dbElsewhere, type DbDockConn } from "$lib/db-dock";
  import {
    canDropDbInto,
    DB_DOCK_DRAG_TYPE,
    dbDockTree,
    dbDragEmpty,
    dbFolderKey,
    dbFolderOfRow,
    dbParentOfRow,
    dbPayloadOfKeys,
    type DbDockDrag,
    type DbTreeRow,
  } from "$lib/db-folders";
  import { createSelection } from "$lib/browser/selection-controller.svelte";
  import { boxesIn, createMarquee } from "$lib/browser/marquee.svelte";
  import { dropGhost, setCountGhost } from "$lib/browser/drag-ghost";
  import {
    accordion,
    createSpringLoad,
    nestRows,
    plainClick,
    treeMotion,
    type TreeNode,
  } from "$lib/browser/tree-accordion";
  import "$lib/browser/dock-tree.css";
  import { DB_ENGINE_ICON } from "$lib/db-conn";
  import {
    dbDockConnList,
    dbDockWarnings,
    dbEngineLabel,
    dbOpenLocations,
    dbPasswordSaved,
    deleteDbSelection,
    editDbConn,
    newDbConn,
    newDbConnIn,
    openDbConn,
    openDbConnNew,
    refreshDbDock,
  } from "$lib/app/db-dock.svelte.js";
  import {
    dbClip,
    dbExpanded,
    dbFolderColor,
    dbFolderEditOf,
    dbFolderIcon,
    dbFolderMeta,
    isDbCut,
    moveDbDrag,
    pasteDbClip,
    saveDbFolderEdit,
    setDbClip,
    setDbFolderOpen,
    type DbFolderEdit,
  } from "$lib/app/db-folders.svelte.js";

  // 독의 DB 칸 — 쿼리 타일의 연결 목록 (docs/log/2026-10-12-query-tile.md). 클릭 · 끌기 · 여러 줄 고르기 규칙은 호스트 독과 같다.

  let query = $state("");

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
  let searchEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);
  let menu = $state<{ conn: DbDockConn | null; folder: string | null; x: number; y: number } | null>(null);
  let folderEdit = $state<DbFolderEdit | null>(null);

  const all = $derived(dbDockConnList());
  const rows = $derived(
    dbDockTree(
      all,
      dbFolderMeta(),
      dbExpanded(),
      query,
      fuzzyMatch,
      settings.hostSort === "recent" ? (id) => dbLastOkAt(dbHistory(), id) : undefined,
    ),
  );
  const nothing = $derived(all.length === 0 && Object.keys(dbFolderMeta()).length === 0);

  // ── 선택 ──

  const sel = createSelection();
  const order = $derived(rows.map((r) => r.key));
  /** 골라져 있을 때만 — 보이지 않는 커서를 믿지 않는다 */
  const current = $derived(sel.focus !== null && sel.has(sel.focus) ? (rows.find((r) => r.key === sel.focus) ?? null) : null);
  const selPayload = $derived(dbPayloadOfKeys(order, sel.ids));

  $effect(() => sel.prune(order));

  $effect(() => {
    const key = sel.focus;
    if (key === null || !listEl) return;
    listEl.querySelector<HTMLElement>(`[data-db-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const locations = $derived(dbOpenLocations());
  function markersOf(c: DbDockConn) {
    return openLocationMarkers(dbConnLocations(locations, c.id), currentWorkspaceId(), workspaceList());
  }

  const INDENT_PX = 14;
  function indent(depth: number): string {
    return `calc(var(--row-pad-x) + ${depth * INDENT_PX}px)`;
  }

  const shown = $derived(dockKind() === "db");
  $effect(() => {
    if (shown) untrack(refreshDbDock);
  });
  $effect(() => {
    const onFocus = () => {
      if (dockKind() === "db") refreshDbDock();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  function select(key: string) {
    sel.click({ ctrlKey: false, metaKey: false, shiftKey: false }, key, order);
  }

  function move(delta: number, extend: boolean) {
    if (order.length === 0) return;
    if (sel.count === 0 && !extend) {
      select(order[delta > 0 ? 0 : order.length - 1]);
      return;
    }
    sel.move(order, delta, extend, false);
  }

  /** 사람이 펼치는 길은 모두 여기를 지난다 — 검색의 저절로 펼침은 지나지 않아 판이 움직이지 않는다(`treeMotion`) */
  function openFolder(path: string, open: boolean) {
    if (dbExpanded().has(path) === open) return;
    treeMotion.mark(`db:${path}`);
    setDbFolderOpen(path, open);
  }

  const tree = $derived(nestRows(rows, (r) => r.depth));

  const spring = createSpringLoad();
  $effect(() => () => spring.disarm());

  function leavesInside(ev: DragEvent): boolean {
    const to = ev.relatedTarget;
    return to instanceof Node && ev.currentTarget instanceof Node && ev.currentTarget.contains(to);
  }

  function activate(row: DbTreeRow) {
    if (row.kind === "folder") {
      if (!row.auto) openFolder(row.fullPath, !row.expanded);
      return;
    }
    void openDbConn(row);
  }

  async function askDelete(c: DbDockConn) {
    if (await deleteDbSelection({ conns: [c.id], folders: [] })) {
      sel.clear();
      focusSearch();
    }
  }

  async function removeSelection() {
    const payload = selPayload;
    if (dbDragEmpty(payload)) return;
    if (await deleteDbSelection(payload)) {
      sel.clear();
      focusSearch();
    }
  }

  function cutSelection() {
    setDbClip("cut", selPayload);
  }

  function copySelection() {
    setDbClip("copy", selPayload);
  }

  function openRowMenu(ev: MouseEvent, row: DbTreeRow) {
    ev.preventDefault();
    ev.stopPropagation();
    sel.pickForMenu(row.key, order);
    menu =
      row.kind === "folder"
        ? { conn: null, folder: row.fullPath, x: ev.clientX, y: ev.clientY }
        : { conn: row, folder: null, x: ev.clientX, y: ev.clientY };
  }

  function openBgMenu(ev: MouseEvent) {
    if ((ev.target as HTMLElement | null)?.closest("button")) return;
    ev.preventDefault();
    menu = { conn: null, folder: null, x: ev.clientX, y: ev.clientY };
  }

  // ── 폴더 편집 ──

  function openFolderEdit(path: string) {
    folderEdit = dbFolderEditOf(path);
  }

  function closeFolderEdit() {
    const path = folderEdit?.path;
    folderEdit = null;
    if (path !== undefined) {
      select(dbFolderKey(path));
      void tick().then(() => listEl?.querySelector<HTMLElement>(`[data-db-key="${CSS.escape(dbFolderKey(path))}"]`)?.focus({ preventScroll: true }));
    }
  }

  async function submitFolderEdit() {
    const f = folderEdit;
    if (!f || f.saving) return;
    if (await saveDbFolderEdit(f)) closeFolderEdit();
  }

  // ── 끌어다 놓기 ── 같은 짐을 즐겨찾기(`favorite-drop.ts`)도 받는다

  const DRAG_TYPE = DB_DOCK_DRAG_TYPE;
  /** dragstart 에서 동기로 쥔다 — dragover 에서는 브라우저가 값을 안 보여 준다 */
  let dragPayload = $state<DbDockDrag | null>(null);
  /** 한 틱 미뤄 켠다 — WebView2 는 dragstart 중에 소스가 바뀌면 드래그를 취소한다 */
  let draggingKeys = $state<ReadonlySet<string> | null>(null);
  let draggingTimer: ReturnType<typeof setTimeout> | null = null;
  /** `""` = 최상위 — `null` 과 구분 */
  let dropTarget = $state<string | null>(null);

  /** 선택 표시 갱신도 한 틱 미룬다(위의 WebView2 규칙) */
  function startDrag(ev: DragEvent, row: DbTreeRow) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    const next = sel.forDrag(row.key, order);
    const payload = dbPayloadOfKeys(order, next.ids);
    if (dbDragEmpty(payload)) return;
    dragPayload = payload;
    dt.setData(DRAG_TYPE, [...next.ids].join("\n"));
    const names = rows.filter((r) => next.ids.has(r.key)).map((r) => (r.kind === "folder" ? r.fullPath : r.name));
    dt.setData("text/plain", names.join("\n"));
    // 독 안은 move, 즐겨찾기 쪽은 copy — 둘 다 받아 주게 copyMove
    dt.effectAllowed = "copyMove";
    setCountGhost(dt, next.ids.size, t("app.hosts.drag.count", { count: next.ids.size }));
    draggingTimer = setTimeout(() => {
      draggingTimer = null;
      dropGhost();
      sel.set(next);
      draggingKeys = next.ids;
    }, 0);
  }

  function endDrag() {
    spring.disarm();
    if (draggingTimer !== null) {
      clearTimeout(draggingTimer);
      draggingTimer = null;
    }
    dropGhost();
    draggingKeys = null;
    dragPayload = null;
    dropTarget = null;
  }

  function pathDragOver(ev: DragEvent, path: string) {
    if (!ev.dataTransfer?.types.includes(DRAG_TYPE)) return;
    if (!canDropDbInto(dragPayload, path, all)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    dropTarget = path;
  }

  function pathDragLeave(path: string) {
    if (dropTarget === path) dropTarget = null;
  }

  function pathDrop(ev: DragEvent, path: string) {
    spring.disarm();
    dropTarget = null;
    const drag = dragPayload;
    if (!ev.dataTransfer?.types.includes(DRAG_TYPE) || !drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    void moveDbDrag(drag, path);
  }

  /** 항목 위에서는 빈 바닥이 물러난다 — 그쪽이 제 경로로 받았다(drop 은 버블한다) */
  const overItem = (ev: DragEvent) => ev.target instanceof Element && ev.target.closest("button") !== null;

  function bodyDragOver(ev: DragEvent) {
    if (overItem(ev)) return;
    pathDragOver(ev, "");
  }

  function bodyDragLeave(ev: DragEvent) {
    const to = ev.relatedTarget;
    if (to instanceof Node && bodyEl?.contains(to)) return;
    pathDragLeave("");
  }

  function bodyDrop(ev: DragEvent) {
    if (overItem(ev)) return;
    pathDrop(ev, "");
  }

  // ── 러버밴드 ──

  const marquee = createMarquee({
    root: () => bodyEl,
    rects: () => boxesIn(bodyEl, listEl, "data-db-key"),
    selection: () => sel.state,
    apply: (rects, box, additive, base) => sel.marquee(rects, box, additive, base),
    onEmptyClick: () => sel.clear(),
    isItem: (target) => target instanceof Element && target.closest("button") !== null,
  });

  // ── 키보드 ──

  function onKeydown(ev: KeyboardEvent) {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (menu || folderEdit) return;
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    const inSearch = target !== null && target === searchEl;
    if (!inSearch && (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)) return;

    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && !inSearch) {
      const k = ev.key.toLowerCase();
      if (k === "a" || k === "c" || k === "x" || k === "v") {
        ev.preventDefault();
        ev.stopPropagation();
        if (k === "a") sel.all(order);
        else if (k === "c") copySelection();
        else if (k === "x") cutSelection();
        else void pasteDbClip(dbFolderOfRow(current));
        return;
      }
    }
    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.key === "Enter") {
      if (!current || current.kind === "folder") return;
      ev.preventDefault();
      ev.stopPropagation();
      openDbConnNew(current);
      return;
    }
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (tag === "BUTTON" && !target?.dataset.dbKey && (ev.key === "Enter" || ev.key === " ")) return;

    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      move(ev.key === "ArrowDown" ? 1 : -1, ev.shiftKey);
    } else if (ev.key === "Home" || ev.key === "End") {
      if (inSearch) return;
      ev.preventDefault();
      sel.move(order, ev.key === "Home" ? -order.length : order.length, ev.shiftKey, false);
    } else if (ev.key === "ArrowRight") {
      if (inSearch || !current || current.kind !== "folder") return;
      ev.preventDefault();
      if (!current.expanded) openFolder(current.fullPath, true);
      else {
        const next = rows[rows.indexOf(current) + 1];
        if (next && next.depth > current.depth) select(next.key);
      }
    } else if (ev.key === "ArrowLeft") {
      if (inSearch || !current) return;
      ev.preventDefault();
      if (current.kind === "folder" && current.expanded && !current.auto) {
        openFolder(current.fullPath, false);
        return;
      }
      const parent = dbParentOfRow(current);
      if (parent !== "") select(dbFolderKey(parent));
    } else if (ev.key === "Enter") {
      if (!current) return;
      ev.preventDefault();
      activate(current);
    } else if (ev.key === "F2") {
      if (!current) return;
      ev.preventDefault();
      if (current.kind === "folder") openFolderEdit(current.fullPath);
      else void editDbConn(current);
    } else if (ev.key === "Delete") {
      if (inSearch || sel.count === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      void removeSelection();
    } else if (ev.key === "Escape") {
      if (sel.count > 0) {
        ev.preventDefault();
        ev.stopPropagation();
        sel.clear();
      } else if (query !== "") {
        ev.preventDefault();
        ev.stopPropagation();
        query = "";
      }
    }
  }

  function onQueryInput() {
    const first = query.trim() !== "" ? rows.find((r) => r.kind === "conn") : undefined;
    if (first) select(first.key);
    else sel.clear();
  }

  export function focusSearch(): void {
    searchEl?.focus({ preventScroll: true });
    searchEl?.select();
  }
</script>

<div class="dbs" role="presentation" tabindex="-1" data-db-dock onkeydown={onKeydown}>
  <div class="dock-search">
    <label class="dock-search-box">
      <UiIcon name="search" size={14} />
      <input
        class="search"
        type="search"
        bind:value={query}
        bind:this={searchEl}
        oninput={onQueryInput}
        placeholder={t("app.db.dock.search.placeholder")}
        aria-label={t("app.db.dock.search.aria")}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <!-- 정렬은 호스트 · 프로젝트 칸과 같은 설정 칸(`[hosts] sort`)이다 -->
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      title={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-label={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-pressed={settings.hostSort === "recent"}
      data-db-sort={settings.hostSort}
      onclick={() => setHostSort(settings.hostSort === "recent" ? "name" : "recent")}
      ><UiIcon name={settings.hostSort === "recent" ? "sort-recent" : "sort-name"} size={14} /></button
    >
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      data-db-new
      title={t("app.query.picker.new")}
      aria-label={t("app.query.picker.new")}
      onclick={() => newDbConnIn(dbFolderOfRow(current))}><UiIcon name="plus" size={14} /></button
    >
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="body"
    class:drop-root={dropTarget === ""}
    bind:this={bodyEl}
    oncontextmenu={openBgMenu}
    onpointerdown={marquee.pointerdown}
    onpointermove={marquee.pointermove}
    onpointerup={marquee.pointerup}
    onpointercancel={marquee.pointerup}
    ondragover={bodyDragOver}
    ondragleave={bodyDragLeave}
    ondrop={bodyDrop}
  >
    {#each dbDockWarnings() as w, i (i)}
      <p class="warn">{w}</p>
    {/each}
    {#if nothing}
      <div class="empty" data-db-empty>
        <p>{t("app.db.dock.empty")}</p>
        <button type="button" class="btn btn-secondary btn-sm" data-db-empty-new onclick={newDbConn}>
          <UiIcon name="plus" size={13} />{t("app.query.picker.new")}
        </button>
      </div>
    {:else if rows.length === 0}
      <p class="empty">{t("app.db.dock.noMatch")}</p>
    {:else}
      <ul class="list" aria-label={t("app.db.dock.list.aria")} bind:this={listEl}>
        {@render branch(tree)}
      </ul>
    {/if}
    {#if marquee.box}
      {@const box = marquee.box}
      <div
        class="marquee"
        aria-hidden="true"
        style:left="{box.left}px"
        style:top="{box.top}px"
        style:width="{box.right - box.left}px"
        style:height="{box.bottom - box.top}px"
      ></div>
    {/if}
  </div>

  {#snippet branch(nodes: TreeNode<DbTreeRow>[])}
        {#each nodes as node (node.row.key)}
          {@const row = node.row}
          {#if row.kind === "folder"}
            {@const motionKey = `db:${row.fullPath}`}
            <li class="dtree-node" class:open={row.expanded} class:still={!treeMotion.allows(motionKey)}>
              <button
                type="button"
                class="item folder"
                class:selected={sel.has(row.key)}
                class:drop-over={dropTarget === row.fullPath}
                class:dragging={draggingKeys?.has(row.key)}
                class:cut={isDbCut(row.key)}
                aria-expanded={row.expanded}
                style:padding-left={indent(row.depth)}
                data-db-key={row.key}
                data-db-folder={row.fullPath}
                title={row.fullPath}
                draggable="true"
                onclick={(ev) => {
                  sel.click(ev, row.key, order);
                  if (plainClick(ev)) activate(row);
                }}
                oncontextmenu={(ev) => openRowMenu(ev, row)}
                ondragstart={(ev) => startDrag(ev, row)}
                ondragend={endDrag}
                ondragover={(ev) => {
                  pathDragOver(ev, row.fullPath);
                  // 받는 자리(preventDefault)이고 접혀 있을 때만 — 머물면 연다
                  if (ev.defaultPrevented && !row.expanded) spring.arm(row.fullPath, () => openFolder(row.fullPath, true));
                  else spring.disarm(row.fullPath);
                }}
                ondragleave={(ev) => {
                  if (!leavesInside(ev)) spring.disarm(row.fullPath);
                  pathDragLeave(row.fullPath);
                }}
                ondrop={(ev) => pathDrop(ev, row.fullPath)}
              >
                <span class="line">
                  <span class="lead folder-lead">
                    <HostIcon icon={dbFolderIcon(row.fullPath)} size={ROW_ICON_PX} fallback="folder" color={dbFolderColor(row.fullPath)} />
                  </span>
                  <span class="name">{row.label}</span>
                  <span class="count">{row.count}</span>
                  <span
                    class="dtree-chev"
                    data-db-twisty
                    aria-hidden="true"
                    title={row.expanded ? t("app.hosts.tree.collapse") : t("app.hosts.tree.expand")}
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
          {:else}
            {@const opened = markersOf(row)}
            {@const saved = dbPasswordSaved(row.id)}
            {@const lastOk = dbLastOkAt(dbHistory(), row.id)}
            <li class="dtree-node">
              <button
                type="button"
                class="item"
                class:selected={sel.has(row.key)}
                class:dragging={draggingKeys?.has(row.key)}
                class:cut={isDbCut(row.key)}
                style:padding-left={indent(row.depth)}
                data-db-key={row.key}
                data-db-row={row.key}
                data-db-conn={row.id}
                title={dbTooltipLines(row.title, row.via, dbHistory(), row.id, now, t).join("\n")}
                draggable="true"
                onclick={(ev) => sel.click(ev, row.key, order)}
                ondblclick={() => activate(row)}
                oncontextmenu={(ev) => openRowMenu(ev, row)}
                ondragstart={(ev) => startDrag(ev, row)}
                ondragend={endDrag}
                ondragover={(ev) => {
                  spring.disarm();
                  pathDragOver(ev, row.folder);
                }}
                ondragleave={() => pathDragLeave(row.folder)}
                ondrop={(ev) => pathDrop(ev, row.folder)}
              >
                <span class="line">
                  <span class="lead"
                    ><HostIcon icon={DB_ENGINE_ICON[row.engine]} size={ROW_ICON_PX} label={dbEngineLabel(row.engine)} /></span
                  >
                  <span class="name-cell">
                    <span class="name">{row.name}</span>
                    {#if opened.here}
                      <span class="open-here" data-db-open-here title={t("app.projects.badge.openHere")}>
                        <UiIcon name="layout" size={12} label={t("app.projects.badge.openHere")} />
                      </span>
                    {/if}
                    {#if saved}
                      <span class="saved" data-db-saved title={t("app.db.dock.saved")}>
                        <UiIcon name="lock" size={12} label={t("app.db.dock.saved")} />
                      </span>
                    {/if}
                  </span>
                  {#if opened.badge}<span class="open-elsewhere" data-db-open-elsewhere>{opened.badge}</span>{/if}
                  {#if row.via !== null}
                    <span class="tag" data-db-ssh={row.via} title={t("app.db.dock.ssh.title", { host: row.via })}
                      >{t("app.db.dock.ssh.chip")}</span
                    >
                  {/if}
                  {#if lastOk !== null}<span class="hint" data-db-when>{relativeTime(lastOk, now, t)}</span>{/if}
                  <span class="dtree-chev-pad" aria-hidden="true"></span>
                </span>
              </button>
            </li>
          {/if}
        {/each}
  {/snippet}

  {#if menu}
    {@const m = menu}
    <DbMenu
      conn={m.conn}
      folder={m.folder}
      saved={m.conn ? dbPasswordSaved(m.conn.id) : false}
      elsewhere={m.conn ? dbElsewhere(dbConnLocations(locations, m.conn.id), currentWorkspaceId(), workspaceList()) : []}
      x={m.x}
      y={m.y}
      onclose={() => (menu = null)}
      onreload={refreshDbDock}
      onaskdelete={(c) => void askDelete(c)}
      oneditfolder={openFolderEdit}
      selCount={sel.count}
      hasClip={dbClip() !== null}
      pasteTarget={dbFolderOfRow(current)}
      oncut={cutSelection}
      oncopy={copySelection}
      onpaste={(dest) => void pasteDbClip(dest)}
      onremoveselection={() => void removeSelection()}
    />
  {/if}

  {#if folderEdit}
    <FolderEditDialog bind:edit={folderEdit} onsubmit={() => void submitFolderEdit()} oncancel={closeFolderEdit} />
  {/if}
</div>

<style>
  .dbs {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--glass-inner, var(--surface-raised-solid));
    user-select: none;
  }

  .dbs:focus {
    outline: none;
  }

  /* `position: relative` 는 러버밴드의 좌표 원점이다 */
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* 포인터를 받지 않아야 아래 줄의 hover 가 산다 */
  .marquee {
    position: absolute;
    z-index: 2;
    background: var(--accent-soft);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    pointer-events: none;
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

  .item.dragging {
    opacity: 0.45;
  }

  .item.cut {
    opacity: 0.5;
  }

  .body.drop-root {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: var(--radius-surface-inner);
  }

  .item.drop-over,
  :global(.dock.launcher) .item.drop-over.drop-over {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .item.folder .name {
    flex: 1 1 auto;
  }

  .folder-lead {
    color: inherit;
  }

  .count {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
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

  .open-here,
  .saved {
    display: inline-flex;
    align-items: center;
    width: 12px;
    height: 12px;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .saved {
    color: var(--fg-3);
  }

  .open-elsewhere {
    flex: 0 0 auto;
    color: var(--fg-3);
    font-size: var(--t-xs);
    white-space: nowrap;
  }

  .tag {
    flex: 0 0 auto;
    padding: 0 var(--space-1);
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--fg-2);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
    white-space: nowrap;
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

  .warn {
    margin: 0;
    padding: var(--space-2) var(--space-3) 0;
    font-size: var(--t-xs);
    color: var(--warn);
  }

  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .empty p {
    margin: 0 0 var(--space-2);
  }

  .empty .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  /* 독 안에서만(`.dock.launcher`) MD3 목록 줄 */
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

  :global(.dock.launcher) .item:not(.folder) > .line > .lead {
    border-radius: 50%;
    color: var(--m3-on-tertiary-container);
    background: var(--m3-tertiary-container);
  }

  :global(.dock.launcher) :is(.tag) {
    padding: 1px 8px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
</style>
