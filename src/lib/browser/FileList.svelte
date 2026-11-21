<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { isCutPath } from "$lib/fs-clipboard.svelte";
  import {
    formatMode,
    formatMtime,
    formatSize,
    glyphOf,
    isDirLike,
    type SftpEntry,
  } from "$lib/sftp-browser";
  import type { SelectionController } from "$lib/browser/selection-controller.svelte";
  import type { MarqueeController } from "$lib/browser/marquee.svelte";
  import type { DragController } from "$lib/browser/drag-controller.svelte";
  import { dropDirOf, nameMatch, type FileTreeRow } from "$lib/file-tree";
  import { extBadge } from "$lib/browser/file-view";
  import type { FileView } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 파일 목록 상자 — 그림만 그린다. 상태를 여기 두면 키보드(창 전역)와 목록이 서로 다른 선택을 보게 된다.
   * 세 보기 모두 항목 하나는 `data-path` 를 단 `.row` 하나다 — 러버밴드가 그것만 센다 (docs/log/2026-10-07-file-tile-dolphin.md).
   */
  let {
    rows,
    /** "숨김 파일뿐입니다" 를 가르는 유일한 근거 */
    totalCount,
    selection,
    order,
    marquee,
    drag,
    backendKey,
    cwd,
    hasCwd,
    loading,
    slowLoad,
    canExport,
    mode = "details",
    iconScale = 1,
    onzoom = () => {},
    isLocked = () => false,
    onopen,
    onmenu,
    ontoggle = () => {},
    onmore = () => {},
    filter = "",
    matched = new Set<string>(),
    el = $bindable(null),
  }: {
    rows: readonly FileTreeRow[];
    totalCount: number;
    selection: SelectionController;
    order: readonly string[];
    marquee: MarqueeController;
    drag: DragController;
    backendKey: string;
    cwd: string;
    hasCwd: boolean;
    loading: boolean;
    slowLoad: boolean;
    canExport: boolean;
    mode?: FileView;
    iconScale?: number;
    onzoom?: (delta: number) => void;
    isLocked?: (path: string) => boolean;
    onopen: (entry: SftpEntry) => void;
    onmenu: (ev: MouseEvent, entry: SftpEntry) => void;
    ontoggle?: (row: Extract<FileTreeRow, { kind: "entry" }>) => void;
    onmore?: (parent: string) => void;
    filter?: string;
    matched?: ReadonlySet<string>;
    el?: HTMLDivElement | null;
  } = $props();

  const filtering = $derived(filter.trim() !== "");

  const tree = $derived(mode === "details");

  let compactRows = $state(12);
  $effect(() => {
    const list = el;
    if (mode !== "compact" || !list) return;
    void rows.length; // 첫 칸이 생기는 순간 다시 잰다(빈 목록에서 시작했을 때)
    const measure = () => {
      const item = list.querySelector<HTMLElement>(".row");
      const h = item?.getBoundingClientRect().height || 22;
      const cs = getComputedStyle(list);
      const avail = list.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      compactRows = Math.max(1, Math.floor(avail / h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  });

  /** `passive: false` 로 직접 건다 — 스크롤을 끊어야 하는데 `onwheel` 속성은 passive 로 붙을 수 있다 */
  $effect(() => {
    const list = el;
    if (mode !== "icons" || !list) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey || ev.deltaY === 0) return;
      ev.preventDefault();
      onzoom(ev.deltaY < 0 ? 1 : -1);
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  });

  const INDENT_PX = 16;

  function indent(depth: number): string {
    return `calc(var(--row-pad-x) + ${depth * INDENT_PX}px)`;
  }

  const GLYPH_ICON = {
    dir: "folder",
    dirlink: "folder-symlink",
    link: "file-symlink",
    file: "file",
  } as const;

  /** 다섯 — 많이 그리면 "긴 목록이 오는 중" 이라고 넘겨짚게 된다 */
  const SKELETON_ROWS = [0, 1, 2, 3, 4];
</script>

{#snippet nameOf(name: string)}
  {@const hit = filtering ? nameMatch(name, filter) : null}
  {#if hit}{name.slice(0, hit[0])}<mark class="hit">{name.slice(hit[0], hit[1])}</mark>{name.slice(hit[1])}{:else}{name}{/if}
{/snippet}

<div
  class="list"
  class:icons={mode === "icons"}
  class:compact={mode === "compact"}
  class:drop-over={drag.dropDir === cwd && hasCwd}
  style:--icon-scale={iconScale}
  style:--compact-rows={compactRows}
  bind:this={el}
  role="presentation"
  onpointerdown={marquee.pointerdown}
  onpointermove={marquee.pointermove}
  onpointerup={marquee.pointerup}
  ondragover={(ev) => drag.dirDragOver(ev, cwd)}
  ondragleave={() => drag.dirDragLeave(cwd)}
  ondrop={(ev) => drag.applyDrop(ev, cwd)}
>
  <!-- "비어 있습니다" 는 `loading` 이 아닐 때만 — 읽는 도중에 세우면 없는 사실을 단정한다 -->
  {#if slowLoad}
    <div class="skel" role="status" aria-label={t("files.browser.loading.aria")}>
      {#each SKELETON_ROWS as i (i)}
        <div class="skel-row" style:width="{60 + ((i * 37) % 35)}%"></div>
      {/each}
    </div>
  {:else if rows.length === 0 && !loading}
    <p class="empty">
      {filtering
        ? t("files.filter.none", { query: filter.trim() })
        : totalCount > 0
          ? t("files.browser.empty.hiddenonly")
          : t("files.browser.empty")}
    </p>
  {:else}
    <!-- 칸 머리를 누르는 정렬은 없다 — 정렬은 백엔드 것 하나다 -->
    {#if tree}
      <div class="dhead" aria-hidden="true">
        <span></span>
        <span></span>
        <span>{t("files.col.name")}</span>
        <span class="size">{t("files.col.size")}</span>
        <span class="mtime">{t("files.col.mtime")}</span>
        <span class="mode">{t("files.col.mode")}</span>
        <span></span>
      </div>
    {/if}
    <div class="items">
    {#each rows as row (row.id)}
      {#if row.kind === "entry"}
        {@const entry = row.entry}
        {@const glyph = glyphOf(entry)}
        {@const target = dropDirOf(row)}
        {@const badge = mode === "icons" && (glyph === "file" || glyph === "link") && iconScale >= 1 ? extBadge(entry.name) : null}
        <!-- `data-inner-drop-files` 를 보고 `PaneHost` 가 타일 전체 OS 파일 하이라이트를 양보한다 -->
        <div
          class="row"
          class:tree
          class:icon-item={mode === "icons"}
          class:compact-item={mode === "compact"}
          class:selected={selection.has(row.id)}
          class:focused={selection.focus === row.id}
          class:dragging={drag.draggingPaths?.has(entry.path)}
          class:cut={isCutPath(backendKey, entry.path)}
          class:drop-over={drag.dropDir === entry.path}
          class:dim={filtering && !matched.has(row.id)}
          style:padding-left={tree ? indent(row.depth) : null}
          data-path={entry.path}
          data-depth={row.depth}
          data-inner-drop-files={tree ? "" : undefined}
          aria-expanded={row.expandable ? row.expanded : undefined}
          role="button"
          tabindex="-1"
          draggable={drag.canDrag(entry.path)}
          title={entry.symlinkTarget ? `${entry.path} → ${entry.symlinkTarget}` : entry.path}
          onclick={(ev) => selection.click(ev, row.id, order)}
          ondblclick={() => onopen(entry)}
          oncontextmenu={(ev) => onmenu(ev, entry)}
          onpointerdown={(ev) => drag.rowPointerDown(ev, entry)}
          ondragstart={(ev) => drag.startDrag(ev, entry)}
          ondragend={drag.cleanup}
          ondragover={(ev) => drag.dirDragOver(ev, target, tree)}
          ondragleave={() => drag.dirDragLeave(target)}
          ondrop={(ev) => drag.applyDrop(ev, target, tree)}
          onkeydown={(ev) => {
            // 줄 자체는 키를 처리하지 않는다 (창 전역의 `onKeydown` 이 주인이다). 다만
            // 포커스가 줄에 있을 때 Enter·Space 가 **클릭으로 합성되는 것**은 막아야
            // 한다 — 안 그러면 Enter 한 번에 "열기" 가 두 번 돈다.
            if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
          }}
        >
          {#if mode === "icons"}
            <!-- 글리프 크기는 `size` 가 아니라 CSS(`--tile-icon-size × --icon-scale`)가 정한다 — 단계를 바꿀 때 다시 그리지 않는다 -->
            <span class="glyph big" class:folder-ink={glyph === "dir" || glyph === "dirlink"}>
              <UiIcon name={GLYPH_ICON[glyph]} size={36} filled={glyph === "dir"} />
            </span>
            {#if badge}<span class="badge">{badge}</span>{/if}
            <span class="name">{@render nameOf(entry.name)}</span>
          {:else}
          {#if tree}
            {#if row.expandable}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <span
                class="twisty"
                data-file-twisty
                title={row.expanded ? t("files.tree.collapse") : t("files.tree.expand")}
                onclick={(ev) => {
                  ev.stopPropagation();
                  ontoggle(row);
                }}
                ondblclick={(ev) => ev.stopPropagation()}
                ><UiIcon name={row.expanded ? "chevron-down" : "chevron"} size={12} /></span
              >
            {:else}
              <span class="twisty-pad" aria-hidden="true"></span>
            {/if}
          {/if}
          <span class="glyph" class:folder-ink={glyph === "dir" || glyph === "dirlink"}>
            <UiIcon
              name={GLYPH_ICON[glyph]}
              size={ROW_ICON_PX}
              filled={glyph === "dir"}
            />
          </span>
          <!-- 못 읽은 폴더의 오류는 그 줄 안에 — 타일 위 오류 띠에 올리면 어느 폴더 얘기인지 흐려진다 -->
          <span class="name-cell">
            <span class="name">{@render nameOf(entry.name)}</span>
            {#if row.error}
              <span class="row-err" title={row.error}>{row.error}</span>
            {/if}
          </span>
          {#if tree}
          <span class="size">{isDirLike(entry) ? "—" : formatSize(entry.size)}</span>
          <span class="mtime">{formatMtime(entry.mtime)}</span>
          <span class="mode">{formatMode(entry.mode)}</span>
          <!-- 몸짓의 손잡이라 `aria-hidden` · 포커스 불가 — 키보드 길은 우클릭 [탐색기로 내보내기…] 다 -->
          {#if canExport && !isLocked(entry.path)}
            <span
              class="grip"
              role="presentation"
              aria-hidden="true"
              title={t("files.browser.export.grip.title")}
              onpointerdown={(ev) => drag.armExport(ev, entry, "grip")}
            >
              <UiIcon name="export" size={12} />
            </span>
          {/if}
          {/if}
          {/if}
        </div>
      {:else if row.kind === "more"}
        <!-- 키보드 커서가 앉을 수 있는 유일한 곁줄이다 -->
        <div
          class="row aux more"
          class:selected={selection.has(row.id)}
          style:padding-left={indent(row.depth)}
          data-nav-id={row.id}
          data-inner-drop-files=""
          role="button"
          tabindex="-1"
          onclick={() => onmore(row.parent)}
          onkeydown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
          }}
          ondragover={(ev) => drag.dirDragOver(ev, row.parent, tree)}
          ondragleave={() => drag.dirDragLeave(row.parent)}
          ondrop={(ev) => drag.applyDrop(ev, row.parent, tree)}
        >
          <span class="twisty-pad" aria-hidden="true"></span>
          <span class="aux-text">{t("files.tree.more", { count: row.hidden })}</span>
        </div>
      {:else}
        <div
          class="row aux"
          class:loading={row.kind === "loading"}
          style:padding-left={indent(row.depth)}
          data-aux={row.kind}
          data-inner-drop-files=""
          role="presentation"
          ondragover={(ev) => drag.dirDragOver(ev, row.parent, tree)}
          ondragleave={() => drag.dirDragLeave(row.parent)}
          ondrop={(ev) => drag.applyDrop(ev, row.parent, tree)}
        >
          <span class="twisty-pad" aria-hidden="true"></span>
          <span class="aux-text"
            >{row.kind === "loading" ? t("files.tree.loading") : t("files.tree.empty")}</span
          >
        </div>
      {/if}
    {/each}
    </div>
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

<style>
  /* `position: relative` 는 러버밴드의 좌표 원점이다 */
  .list {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 2px var(--row-inset);
    container: file-list / inline-size;
  }

  /* 테두리로만 — 배경을 칠하면 그 아래 줄들의 선택 표시와 겹친다 */
  .list.drop-over {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  /* 포인터를 받지 않아야 긋는 동안 아래 줄의 hover · 커서가 산다 */
  .marquee {
    position: absolute;
    z-index: 2;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }

  .row {
    display: grid;
    /* 마지막 14px 은 내보내기 손잡이 자리 — 손잡이 없는 타일(원격)에도 비워 두어 권한 칸이 같은 자리에서 끝난다 */
    grid-template-columns: var(--row-icon) minmax(0, 1fr) 68px 92px 76px 14px;
    align-items: center;
    gap: var(--row-gap);
    padding: var(--row-pad-y) var(--row-pad-x);
    border-radius: var(--radius);
    font-size: var(--row-font);
    color: var(--fg);
    cursor: default;
    user-select: none;
  }

  /* 칸 머리(`.dhead`)는 줄과 같은 격자여야 머리 글자가 그 아래 값과 같은 x 에 선다 */
  .row.tree,
  .dhead {
    grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 68px 92px 76px 14px;
  }

  .dhead {
    display: grid;
    align-items: center;
    gap: var(--row-gap);
    padding: var(--row-pad-y) var(--row-pad-x);
    margin-bottom: 2px;
    font-size: 11px;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--line);
    user-select: none;
  }

  .dhead .size {
    text-align: right;
  }

  /* ── 아이콘 보기 ── */
  .list.icons .items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--tile-icon-cell) * var(--icon-scale)), 1fr));
    gap: var(--space-1);
    align-content: start;
  }

  .row.icon-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--space-2) var(--space-1) 6px;
    text-align: center;
  }

  .glyph.big :global(svg) {
    width: calc(var(--tile-icon-size) * var(--icon-scale));
    height: calc(var(--tile-icon-size) * var(--icon-scale));
  }

  .badge {
    margin-top: -2px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
  }

  .row.icon-item .name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    white-space: normal;
    word-break: break-all;
    line-height: 1.3;
  }

  /* ── 간단히 보기 ── */
  .list.compact {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .list.compact .items {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--compact-rows), auto);
    grid-auto-columns: minmax(var(--compact-col-min), var(--compact-col-max));
    column-gap: var(--space-2);
    align-content: start;
    justify-content: start;
  }

  .row.compact-item {
    grid-template-columns: var(--row-icon) minmax(0, 1fr);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  /* 커서(포커스)에는 따로 표시를 두지 않는다 — 왼쪽 세로 띠는 선택 배경과 겹쳐 읽혀 쓰지 않는다 */
  .row.selected {
    background: var(--accent-soft);
  }

  .row.dragging {
    opacity: 0.45;
  }

  .row.cut {
    opacity: 0.5;
  }

  .row.dim {
    opacity: 0.55;
  }

  .hit {
    color: inherit;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 2px;
  }

  .row.drop-over {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    color: var(--fg-3);
  }

  .row.selected .glyph {
    color: var(--fg-2);
  }

  /* 위 `.row.selected .glyph` 보다 뒤에 두어 같은 특이도로 이긴다 */
  .glyph.folder-ink,
  .row.selected .glyph.folder-ink {
    color: var(--folder);
  }

  .name-cell {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-err {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--err);
  }

  .twisty,
  .twisty-pad {
    display: inline-flex;
    flex: 0 0 12px;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 16px;
  }

  .twisty {
    color: var(--fg-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .twisty:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .row.aux {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    color: var(--fg-3);
    font-size: var(--t-xs);
  }

  .row.aux:not(.more):hover {
    background: transparent;
  }

  .aux-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 150ms 지연 — 로컬 · 가까운 서버는 그 안에 목록이 와서 깜빡이지 않는다 */
  .row.aux.loading {
    animation: aux-in 120ms ease 150ms both;
  }

  @keyframes aux-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .row.aux.more {
    color: var(--fg-2);
    cursor: pointer;
  }

  .row.aux.more:hover {
    color: var(--fg-1);
  }

  .size,
  .mtime,
  .mode {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-muted);
    white-space: nowrap;
  }

  .size {
    text-align: right;
  }

  /* 이 문턱(480)은 `pane/head-span` 의 `FILE_LIST_MODE_MIN_W` 와 같은 값이다(시험이 소스로 묶는다) */
  @container file-list (max-width: 479px) {
    .row {
      grid-template-columns: var(--row-icon) minmax(0, 1fr) 68px 92px 14px;
    }
    .row.tree,
    .dhead {
      grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 68px 92px 14px;
    }
    .mode {
      display: none;
    }
  }

  @container file-list (max-width: 379px) {
    .row {
      grid-template-columns: var(--row-icon) minmax(0, 1fr) 68px 14px;
    }
    .row.tree,
    .dhead {
      grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 68px 14px;
    }
    .mtime {
      display: none;
    }
  }

  @container file-list (max-width: 259px) {
    .row {
      grid-template-columns: var(--row-icon) minmax(0, 1fr) 14px;
    }
    .row.tree,
    .dhead {
      grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 14px;
    }
    .size {
      display: none;
    }
  }

  .grip {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-muted);
    cursor: grab;
    opacity: 0;
    transition: opacity 90ms ease;
  }

  .row:hover .grip {
    opacity: 1;
  }

  .grip:hover {
    color: var(--accent);
  }

  /* 투명한 채로 눌리면 유령 손잡이가 된다 */
  .row:not(:hover) .grip {
    pointer-events: none;
  }

  .empty {
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--fg-muted);
  }

  /* 줄 높이 · 좌우 여백을 실제 줄과 같게 — 목록이 도착할 때 화면이 튀지 않는다 */
  .skel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: calc(var(--row-pad-y) + 4px) var(--row-inset);
  }

  .skel-row {
    height: 12px;
    border-radius: var(--radius);
    background: linear-gradient(
      90deg,
      var(--bg-hover) 0%,
      var(--border) 50%,
      var(--bg-hover) 100%
    );
    background-size: 200% 100%;
    animation: skel-sweep 1.2s linear infinite;
  }

  @keyframes skel-sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skel-row {
      animation: none;
      background: var(--bg-hover);
    }
  }
</style>
