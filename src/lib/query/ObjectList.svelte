<script lang="ts">
  /**
   * 쿼리 타일의 객체 목록 탭 하나 — 스키마 하나의 테이블 · 뷰 · 함수 … 를 종류별 표로(규칙은 `object-list.ts`).
   *
   * - **읽기만 한다** — 만들기 · 고치기 · 지우기 동작은 없다(트리와 같은 범위).
   * - 목록은 부모의 사본(`objects` — 트리가 읽은 것)을 쓰고, 없으면 직접 읽는다. 서버는 연결당 작업 하나라 다른 일이 없을 때(`waiting`
   *   아님)만 보내고, 읽는 동안 `onmeta` 로 알린다(`DataTab` 과 같은 규칙). 숨은 탭은 읽지 않는다.
   * - 줄 두 번 누르기 · Enter = 관계류는 데이터 탭, 그 밖은 DDL 보기(트리 `F4` 와 같은 길).
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import type { QueryListKind, QueryListTab } from "$lib/session";
  import { dbObjects, errorMessage, type DbDefinitionTarget, type DbDialect, type DbObject, type DbObjects, type DbOpened } from "./query-backend";
  import { countLabel, groupFolders, isRelation, matchSpan, normFilter, type TreeRelation } from "./schema-tree";
  import { definitionName, objectTarget } from "./definition";
  import { windowRange } from "./cells";
  import { listColumns, listRows, moveCursor, nextListSort, rowsText, shownFolder, type ListColumn, type ListSort } from "./object-list";

  let {
    n,
    list,
    dialect,
    opened,
    objects,
    visible,
    waiting,
    treeReading = false,
    onchange,
    onloaded,
    onmeta,
    onlost,
    onopen,
    ondefinition,
    oncontext,
  }: {
    n: number;
    list: QueryListTab;
    dialect: DbDialect;
    opened: DbOpened | null;
    /** 부모가 쥔 사본(지금 연결의 것만) — 없으면 이 탭이 읽는다 */
    objects: DbObjects | undefined;
    visible: boolean;
    /** 연결이 다른 일을 하는 중 — 끝나면 저절로 읽는다 */
    waiting: boolean;
    /** 같은 순간에 출발한 트리 읽기와 겹쳤으면(서버 Busy) 오류 대신 다시 읽는다 */
    treeReading?: boolean;
    onchange: (list: QueryListTab) => void;
    onloaded: (schema: string, v: DbObjects) => void;
    onmeta: (reading: boolean) => void;
    /** 참이면 부모가 [다시 열기] 띠로 보였다 */
    onlost: (message: string) => boolean;
    onopen: (rel: TreeRelation) => void;
    ondefinition: (t: DbDefinitionTarget) => void;
    /** 메뉴는 부르는 쪽이 타일 컨테이너 밖에 그린다 */
    oncontext: (ev: MouseEvent, t: DbDefinitionTarget, title: string, rel: TreeRelation | null) => void;
  } = $props();

  const uid = $props.id();
  const ROW_H = 22;

  // ── 읽기 ───────────────────────────────────────────────────────────────

  let loading = $state(false);
  let error = $state<string | null>(null);
  /** ⟳ · F5 가 부른 다시 읽기 */
  let want = $state(false);
  /** 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(`SchemaTree` 와 같은 규칙) */
  let spinning = $state(false);
  let seq = 0;
  let disposed = false;
  $effect(() => () => {
    disposed = true;
  });

  let lastConn = "";
  $effect(() => {
    const c = opened ? `${opened.handle}:${opened.lease}` : "";
    if (c === lastConn || c === "") return;
    lastConn = c;
    untrack(() => (error = null));
  });

  $effect(() => {
    if (!visible || !opened || waiting || loading) return;
    if (want) {
      untrack(() => void load());
      return;
    }
    if (!(objects === undefined && error === null)) return;
    // 트리 읽기가 끝나면 `waiting` 이 먼저 풀리고 트리의 사본(`objects`)은 그 뒤에 온다 — 곧바로 읽으면 같은 스키마를 두 번 읽는다.
    // 한 박자 미뤄 그때도 없을 때만 읽는다(사본이 오면 이 효과가 다시 돌며 타이머를 걷는다)
    const tm = setTimeout(() => {
      if (!disposed && objects === undefined && error === null && !loading) void load();
    }, 0);
    return () => clearTimeout(tm);
  });

  // `DataTab` 의 같은 절 — 트리 읽기와 같은 순간에 출발하면 늦은 쪽이 Busy 로 실패한다
  let treeHit = false;
  $effect(() => {
    if (treeReading && loading) treeHit = true;
  });

  async function load() {
    const o = opened;
    if (!o) return;
    want = false;
    loading = true;
    error = null;
    treeHit = treeReading;
    const my = ++seq;
    const schema = list.schema;
    onmeta(true);
    try {
      const v = await dbObjects(o.handle, o.lease, schema);
      if (disposed || my !== seq || opened?.handle !== o.handle || opened?.lease !== o.lease) return;
      onloaded(schema, v);
    } catch (e) {
      if (disposed || my !== seq) return;
      const m = errorMessage(e);
      if (treeHit) want = true;
      else if (!onlost(m)) error = stripReason(m);
    } finally {
      onmeta(false);
      if (my === seq) loading = false;
    }
  }

  /** DB 타일의 F5(`QueryView`)도 부른다 */
  export function refresh() {
    if (loading || waiting || !opened) return;
    spinning = true;
    error = null;
    want = true;
  }

  // ── 종류 · 찾기 · 정렬 ─────────────────────────────────────────────────

  let filter = $state("");
  let filterEl = $state<HTMLInputElement | null>(null);
  let sort = $state<ListSort>(null);

  const folders = $derived(objects ? groupFolders(dialect, objects) : []);
  const folder = $derived(objects ? shownFolder(dialect, objects, list.kind) : null);
  const cols = $derived<ListColumn[]>(folder ? listColumns(dialect, folder.kind) : []);
  const rows = $derived(folder ? listRows(folder.items, filter, sort) : []);
  const filtering = $derived(normFilter(filter) !== "");

  function pickKind(kind: QueryListKind) {
    if (kind === folder?.kind) return;
    onchange({ schema: list.schema, kind });
  }

  export function focusFilter() {
    filterEl?.focus();
    filterEl?.select();
  }

  function isFindCombo(ev: KeyboardEvent): boolean {
    const combo = comboFromEvent(ev);
    return combo !== null && combo === effectiveCombo("find", settings.current.keybindings);
  }

  const isCtrlI = (ev: KeyboardEvent) => ev.code === "KeyI" && ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey;

  function filterKey(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (filter !== "") filter = "";
      else gridEl?.focus();
    } else if (ev.key === "ArrowDown" || (ev.key === "Enter" && !ev.ctrlKey)) {
      ev.preventDefault();
      gridEl?.focus();
    } else if (isCtrlI(ev) || isFindCombo(ev)) {
      // 칸 안의 앱 `find` 키는 전역 처리기의 입력 칸 가드에 걸려 오지 않는다 — 여기서 받는다
      ev.preventDefault();
      ev.stopPropagation();
      filterEl?.select();
    }
  }

  // ── 표 ─────────────────────────────────────────────────────────────────

  let gridEl = $state<HTMLElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let scrollTop = $state(0);
  let viewH = $state(0);
  let cursor = $state(0);
  const cur = $derived(rows.length === 0 ? -1 : Math.max(0, Math.min(rows.length - 1, cursor)));
  const win = $derived(windowRange(scrollTop, viewH, ROW_H, rows.length));
  const rowId = (i: number) => `${uid}-r${i}`;

  // 종류 · 찾기 글이 바뀌면 맨 위부터
  $effect(() => {
    void folder?.kind;
    void normFilter(filter);
    untrack(() => {
      cursor = 0;
      if (scroller) scroller.scrollTop = 0;
      scrollTop = 0;
    });
  });

  function reveal(i: number) {
    if (!scroller) return;
    const top = i * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
    scrollTop = scroller.scrollTop;
  }

  function relOf(o: DbObject): TreeRelation | null {
    return isRelation(o.kind) ? { kind: o.kind as TreeRelation["kind"], schema: list.schema, name: o.name } : null;
  }

  function activate(o: DbObject) {
    const rel = relOf(o);
    if (rel) {
      onopen(rel);
      return;
    }
    const d = objectTarget(dialect, list.schema, o);
    if (d) ondefinition(d);
  }

  function openMenu(ev: MouseEvent, o: DbObject) {
    const d = objectTarget(dialect, list.schema, o);
    if (!d) return;
    ev.preventDefault();
    ev.stopPropagation();
    oncontext(ev, d, definitionName(dialect, d), relOf(o));
  }

  function menuAtCursor() {
    const o = rows[cur];
    if (!o) return;
    const el = gridEl?.querySelector<HTMLElement>(`#${CSS.escape(rowId(cur))}`);
    const r = el?.getBoundingClientRect() ?? gridEl?.getBoundingClientRect();
    if (!r) return;
    openMenu(new MouseEvent("contextmenu", { clientX: r.left + 24, clientY: r.top + Math.min(r.height, ROW_H) }), o);
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    if (isCtrlI(ev) || isFindCombo(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      focusFilter();
      return;
    }
    if ((ev.key === "F10" && ev.shiftKey && !ev.ctrlKey && !ev.altKey) || (ev.key === "ContextMenu" && !ev.shiftKey)) {
      ev.preventDefault();
      ev.stopPropagation();
      menuAtCursor();
      return;
    }
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const o = rows[cur];
    if (ev.key === "Enter" || ev.key === "F4") {
      if (!o) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === "Enter") activate(o);
      else {
        const d = objectTarget(dialect, list.schema, o);
        if (d) ondefinition(d);
      }
      return;
    }
    const page = Math.max(1, Math.floor((scroller?.clientHeight ?? 0) / ROW_H) - 1);
    const next = moveCursor(cur, ev.key, rows.length, page);
    if (next === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    cursor = next;
    reveal(next);
  }

  function clickSort(col: "name" | "rows") {
    sort = nextListSort(sort, col);
  }

  const folderLabel = (k: QueryListKind) => t(`pane.query.schema.folder.${k}` as "pane.query.schema.folder.table");
  const subLabel = (s: string) => t(`pane.query.schema.sub.${s}` as "pane.query.schema.sub.enum");
  const colLabel = (c: ListColumn) => t(`pane.query.list.col.${c}` as "pane.query.list.col.name");
  const sortOf = (c: ListColumn) => (sort && sort.col === c ? sort.dir : null);

  /** `null` = 값 없음(흐린 —) */
  function cellText(o: DbObject, c: Exclude<ListColumn, "name">): string | null {
    switch (c) {
      case "kind":
        return o.sub ? subLabel(o.sub) : null;
      case "rows":
        return o.rows === undefined ? null : rowsText(o.rows);
      case "comment":
        return o.comment || null;
      case "args":
        return o.args === undefined ? null : `(${o.args})`;
      case "returns":
        return o.returns || null;
    }
  }
</script>

{#snippet hl(text: string)}
  {@const m = matchSpan(text, filter)}
  {#if m}{text.slice(0, m[0])}<mark class="hit">{text.slice(m[0], m[1])}</mark>{text.slice(m[1])}{:else}{text}{/if}
{/snippet}

<div class="olist" data-query-list={n} data-query-list-schema={list.schema}>
  <div class="subs">
    <div class="kinds" role="tablist" aria-label={t("pane.query.list.kinds")}>
      {#each folders as f (f.kind)}
        {@const matched = filtering && f.kind === folder?.kind ? rows.length : undefined}
        <button
          type="button"
          class="sub"
          role="tab"
          aria-selected={f.kind === folder?.kind}
          onclick={() => pickKind(f.kind)}
          data-query-list-kind={f.kind}
          >{folderLabel(f.kind)} <span class="cnt">{countLabel({ ...f, matched })}</span></button
        >
      {/each}
    </div>
    <div class="find" class:on={filtering}>
      <UiIcon name="filter" size={12} />
      <input
        class="find-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder={t("pane.query.filter.placeholder")}
        aria-label={t("pane.query.filter.placeholder")}
        title={t("pane.query.filter.title")}
        data-query-list-filter
        bind:this={filterEl}
        bind:value={filter}
        onkeydown={filterKey}
      />
      {#if filter !== ""}
        <button
          type="button"
          class="fclear"
          title={t("pane.query.filter.clear")}
          aria-label={t("pane.query.filter.clear")}
          onclick={() => {
            filter = "";
            filterEl?.focus();
          }}><UiIcon name="close" size={11} /></button
        >
      {/if}
    </div>
    <button
      type="button"
      class="tbtn refresh"
      class:spinning
      disabled={loading || waiting || !opened}
      title={t("pane.query.list.refresh.title")}
      aria-label={t("pane.query.list.refresh")}
      aria-busy={loading}
      data-query-list-refresh
      onclick={refresh}
      onanimationiteration={() => {
        if (!loading) spinning = false;
      }}><UiIcon name="refresh" size={12} /></button
    >
  </div>

  {#if error}
    <div class="band err" role="alert" data-query-list-error>{error}</div>
  {/if}

  {#if !objects}
    {#if !error}
      <p class="note">{loading ? t("pane.query.data.loading") : waiting ? t("pane.query.data.waiting") : ""}</p>
    {/if}
  {:else if !folder}
    <p class="note" data-query-list-empty>{t("pane.query.schema.emptySchema")}</p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex — role=grid 는 키보드를 받는 위젯이다 -->
    <div
      class="grid"
      role="grid"
      tabindex="0"
      aria-label={t("pane.query.list.aria", { name: list.schema })}
      aria-busy={loading}
      aria-rowcount={rows.length + 1}
      aria-colcount={cols.length}
      aria-activedescendant={cur >= 0 ? rowId(cur) : undefined}
      bind:this={gridEl}
      onkeydown={onKey}
      data-query-list-grid={folder.kind}
    >
      <div class="head" role="row" aria-rowindex={1}>
        {#each cols as c (c)}
          {@const dir = sortOf(c)}
          <span
            class="cell c-{c}"
            role="columnheader"
            aria-sort={c === "name" || c === "rows" ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
            title={c === "rows" ? t("pane.query.list.col.rows.title") : undefined}
          >
            {#if c === "name" || c === "rows"}
              <button type="button" class="hsort" tabindex="-1" onclick={() => clickSort(c)} data-query-list-sort={c}
                >{colLabel(c)}{#if dir}<span class="sort-mark" aria-hidden="true">{dir === "asc" ? " ▲" : " ▼"}</span>{/if}</button
              >
            {:else}
              {colLabel(c)}
            {/if}
          </span>
        {/each}
      </div>
      {#if rows.length === 0}
        <p class="note" data-query-list-nomatch>{t("pane.query.filter.nomatch")}</p>
      {:else}
        <div
          class="scroller"
          role="rowgroup"
          bind:this={scroller}
          bind:clientHeight={viewH}
          onscroll={(ev) => (scrollTop = (ev.currentTarget as HTMLElement).scrollTop)}
        >
          <div class="canvas" style:height="{rows.length * ROW_H}px">
            {#each { length: win.last - win.first } as _, k (win.first + k)}
              {@const i = win.first + k}
              {@const o = rows[i]}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus — 포커스 · 키보드는 표(role=grid)가 쥐고 줄은 aria-activedescendant 로 가리킨다(가상 스크롤이 줄을 걷어도 포커스가 남게) -->
              <div
                id={rowId(i)}
                class="row"
                class:on={i === cur}
                role="row"
                aria-rowindex={i + 2}
                aria-selected={i === cur}
                style:top="{i * ROW_H}px"
                data-query-list-row={o.name}
                onmousedown={(ev) => {
                  if (ev.detail > 1) ev.preventDefault();
                }}
                onclick={() => {
                  cursor = i;
                  gridEl?.focus({ preventScroll: true });
                }}
                ondblclick={() => activate(o)}
                oncontextmenu={(ev) => {
                  cursor = i;
                  gridEl?.focus({ preventScroll: true });
                  openMenu(ev, o);
                }}
              >
                {#each cols as c (c)}
                  <span class="cell c-{c}" role="gridcell" title={c === "comment" && o.comment ? o.comment : undefined}
                    >{#if c === "name"}{@render hl(o.name)}{:else}{@const v = cellText(o, c)}{#if v === null}<span class="none">—</span
                        >{:else}{v}{/if}{/if}</span
                  >
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
    {#if folder.truncated}
      <p class="note foot" data-query-list-truncated>{t("pane.query.schema.truncated", { n: 5000 })}</p>
    {/if}
  {/if}
</div>

<style>
  .olist {
    container: qlist / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    font-size: 11px;
    color: var(--fg-2);
  }

  /* `DataTab` 의 하위 탭 줄(`.subs`)과 같은 줄 · 같은 단추 */
  .subs {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 8px;
    border-bottom: 1px solid var(--line);
  }

  .kinds {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .sub {
    flex: 0 0 auto;
    padding: 3px 9px;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .sub:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .sub[aria-selected="true"] {
    color: var(--fg-1);
    background: var(--pick-on-bg, var(--bg-hover));
    font-weight: var(--fw-semibold);
  }

  .cnt {
    font-weight: normal;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .sub:focus-visible,
  .tbtn:focus-visible,
  .hsort:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  /* 스키마 트리 찾기 칸(`SchemaTree` 의 `.filter`)과 같은 알약 */
  .find {
    flex: 0 1 200px;
    min-width: 90px;
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--fg-muted);
  }

  .find.on {
    color: var(--accent);
  }

  .find-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: 20px;
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
    outline: none;
  }

  .find-input:focus {
    border-color: var(--accent);
  }

  .fclear {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .fclear:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .tbtn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .tbtn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .tbtn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  /* 도는 동안은 흐리지 않는다 — 눌러서 돌고 있다는 것이 곧 응답이다(`SchemaTree` 와 같은 규칙) */
  .tbtn.refresh.spinning {
    opacity: 1;
  }

  .tbtn.refresh.spinning :global(svg) {
    animation: list-spin 0.9s linear infinite;
  }

  @keyframes list-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tbtn.refresh.spinning :global(svg) {
      animation: none;
    }
    .tbtn.refresh.spinning {
      opacity: 0.45;
    }
    .tbtn.refresh.spinning:not([aria-busy="true"]) {
      opacity: 1;
    }
  }

  .band {
    flex: 0 0 auto;
    padding: 5px 10px;
    color: var(--fg-1);
    border-bottom: 1px solid var(--line);
    white-space: pre-wrap;
  }

  .band.err {
    background: var(--err-soft);
  }

  .note {
    margin: 0;
    padding: var(--space-3);
    color: var(--fg-3);
  }

  .note.foot {
    flex: 0 0 auto;
    padding: 4px 10px;
    border-top: 1px solid var(--line);
  }

  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    outline: none;
  }

  .grid:focus-visible .row.on {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .head,
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 22px;
    padding: 0 10px;
    box-sizing: border-box;
  }

  .head {
    flex: 0 0 auto;
    color: var(--fg-3);
    font-weight: var(--fw-semibold);
    border-bottom: 1px solid var(--line);
  }

  .hsort {
    padding: 0;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .hsort:hover {
    color: var(--fg);
  }

  .scroller {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .canvas {
    position: relative;
  }

  .row {
    position: absolute;
    left: 0;
    right: 0;
    color: var(--fg-1);
    cursor: default;
    white-space: nowrap;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.on {
    background: var(--pick-on-bg, var(--bg-hover));
  }

  .cell {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .c-name {
    flex: 1.2 1 0;
    min-width: 100px;
  }

  .c-kind {
    flex: 0 0 90px;
  }

  .c-rows {
    flex: 0 0 84px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .c-comment {
    flex: 2 1 0;
    color: var(--fg-3);
  }

  .c-args {
    flex: 1.4 1 0;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .c-returns {
    flex: 0 1 140px;
    min-width: 60px;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .head .cell {
    font-family: var(--font-ui);
    font-size: 11px;
  }

  .none {
    color: var(--fg-3);
    opacity: 0.7;
  }

  .hit {
    color: inherit;
    background: var(--warn-soft);
    border-radius: 2px;
    box-shadow: inset 0 -1px 0 var(--warn);
  }

  /* 좁은 타일 — 설명부터, 그다음 종류 · 반환을 걷는다 */
  @container qlist (max-width: 420px) {
    .c-comment {
      display: none;
    }
  }

  @container qlist (max-width: 320px) {
    .c-kind,
    .c-returns {
      display: none;
    }
  }
</style>
