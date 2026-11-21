<script lang="ts" module>
  import type { DbQueryResult } from "./query-backend";

  /** 결과마다 기억한다(저장하지 않는다) — 부르는 쪽이 `bind:view` 로 묶으면 그쪽 값이 이긴다 */
  const chosenView = new WeakMap<DbQueryResult, "grid" | "chart">();
</script>

<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { writeClipboard } from "$lib/clipboard";
  import { toast } from "$lib/toast.svelte.js";
  import RowLimit, { type RowLimitProps } from "./RowLimit.svelte";
  import {
    cellDisplay,
    cellExport,
    cellKind,
    normRange,
    rangeTsv,
    sortRows,
    windowRange,
    type CellRange,
  } from "./cells";
  import { chartBlocker, classifyColumns } from "./chart-model";
  import ResultChart, { type KeptPick } from "./ResultChart.svelte";
  import { getContext, onDestroy, tick, untrack, type Snippet } from "svelte";
  import { GRID_TILE_MENU, gridMenuRows, type GridTileMenu } from "./grid-menu";
  import FindBar from "$lib/FindBar.svelte";
  import { revealOffset, stepMatch } from "$lib/doc-find";
  import { clearFind, paintFind } from "$lib/doc-find-dom";
  import { registerFindZone } from "$lib/app/tile-find";
  import { firstMatchFromRow, gridMatches, matchesInRows, shownCellText, type GridMatch } from "./grid-find";
  import type { Cell } from "./query-backend";
  import GridMenu, { type GridMenuEntry } from "./GridMenu.svelte";
  import { exportCsv, exportFileName, exportJson, exportMarkdown, exportSlice, rangeCells, type ExportFormat } from "./export";
  import { fkColumnIndex, fkValues } from "./data-tab";
  import { filterLabel, filterRows, withFilter, type RowFilter } from "./grid-filter";
  import { saveTextAs } from "./sql-file-io";

  /**
   * 쿼리 결과 표 — 가상 스크롤(행 1만까지).
   *
   * - 정렬 · 거르기: `onsort` · `onfilter` 가 있으면(데이터 탭) 부르는 쪽이 다시 조회하고, 없으면 받은 행을 여기서 정렬 · 거른다 —
   *   SQL 을 다시 돌리지 않고, 행 상한으로 잘린 결과도 따로 알리지 않는다(사용자 결정). 복사 · 내보내기 · 찾기는 보이는 행 · 순서를 따른다.
   * - 칸 우클릭 리스너는 표 상자에 **직접** 건다(`gridContext`) — Svelte 의 위임 `oncontextmenu` 는 타일 층 `PaneHost` 의 네이티브 리스너보다 늦다.
   * - 표 안 찾기는 DOM 이 아니라 그리는 칸 글자에서 찾고, 칠은 보이는 줄의 칸만 그때그때 `Range` 로 만든다.
   */
  let {
    result,
    name,
    limit,
    lead,
    sort = null,
    onsort,
    sortDisabled = false,
    rowBase = 0,
    tail,
    colWidths = $bindable({}),
    view = $bindable(),
    chartPick = $bindable(),
    onfilter,
    pks = [],
    fks = [],
    onfollow,
    refs = [],
    onfollowref,
  }: {
    result: DbQueryResult;
    name: string;
    limit?: RowLimitProps;
    /** 상태 줄 맨 앞에 붙는 글 — 아래 줄이 둘로 서지 않게 */
    lead?: string;
    sort?: { col: string; dir: "asc" | "desc" } | null;
    /** 있으면 부르는 쪽이 다시 조회한다 */
    onsort?: (col: string) => void;
    sortDisabled?: boolean;
    /** 0 = 1부터 */
    rowBase?: number;
    tail?: Snippet;
    /** 열 이름 → px. 묶으면 결과가 바뀌어도 남는다 — 저장하지 않는다 */
    colWidths?: Record<string, number>;
    /** 묶지 않으면 결과마다 기억(`chosenView`) */
    view?: "grid" | "chart";
    chartPick?: KeptPick;
    /** 있으면(데이터 탭) 조건 글은 부르는 쪽이 짓는다. `and` = 지금 조건에 더하기 */
    onfilter?: (col: string, cell: Cell, op: "eq" | "ne" | "and") => void;
    pks?: readonly string[];
    fks?: readonly { columns: readonly string[]; refTable: string }[];
    /** 값들은 `fks[fk].columns` 차례 */
    onfollow?: (fk: number, values: Cell[]) => void;
    refs?: readonly { table: string; columns: readonly string[]; refColumns: readonly string[] }[];
    /** 값들은 `refs[ref].refColumns` 차례 */
    onfollowref?: (ref: number, values: Cell[]) => void;
  } = $props();

  const ROW_H = 22;
  const HEAD_H = 34;
  const GUTTER_W = 48;

  let scroller = $state<HTMLElement | null>(null);
  let scrollTop = $state(0);
  let viewH = $state(0);

  const columns = $derived(result.columns);
  let localSort = $state<{ col: string; dir: "asc" | "desc" } | null>(null);
  const activeSort = $derived(onsort ? sort : localSort);
  // 결과가 바뀌면 걷는다(아래 `lastResult`)
  let filters = $state.raw<RowFilter[]>([]);
  const kept = $derived(onfilter ? result.rows : filterRows(result.rows, filters));
  const rows = $derived.by(() => {
    if (onsort || !localSort) return kept;
    const s = localSort;
    const i = result.columns.findIndex((c) => c.name === s.col);
    return i < 0 ? kept : sortRows(kept, i, s.dir);
  });

  /** 행 번호가 달라지니 고른 칸 · 칸 보기를 걷는다 */
  function setFilters(next: RowFilter[]) {
    filters = next;
    detail = null;
    anchor = head = null;
    if (findOpen && !findFrame) findFrame = requestAnimationFrame(refind);
  }

  function clickSort(name: string) {
    if (onsort) {
      onsort(name);
      return;
    }
    const cur = localSort;
    localSort = !cur || cur.col !== name ? { col: name, dir: "asc" } : cur.dir === "asc" ? { col: name, dir: "desc" } : null;
    // 줄 순서가 바뀌니 고른 칸 · 칸 보기는 걷는다(다른 값을 가리키지 않게)
    detail = null;
    anchor = null;
    head = null;
  }

  // 부르는 쪽이 `{#key result}` 로 결과마다 새로 만든다 — 처음 값만 기억에서 꺼낸다
  // svelte-ignore state_referenced_locally
  if (view === undefined) view = chosenView.get(result) ?? "grid";
  const classes = $derived(columns.length > 0 ? classifyColumns(result) : []);
  const blocker = $derived(chartBlocker(result, classes));
  const charting = $derived(view === "chart" && blocker === null);

  function setView(v: "grid" | "chart") {
    if (v === "chart" && blocker !== null) return;
    view = v;
    chosenView.set(result, v);
  }

  const widths = $derived.by(() => {
    // 끝 50행도 본다 — 뒤로 갈수록 길어지는 값(일련번호 · 이름)도 잡는다
    const sample = rows.length > 250 ? [...rows.slice(0, 200), ...rows.slice(-50)] : rows;
    return columns.map((c, i) => {
      // 머리글 이름 앞 키 표시는 하나에 글자 두 칸쯤
      const marks = (pkSet.has(c.name) ? 2 : 0) + (fkIdx.has(c.name) ? 2 : 0);
      let len = Math.max(c.name.length + marks, c.type.length + 2);
      for (const r of sample) {
        const s = cellDisplay(r[i] ?? null);
        if (s.length > len) len = s.length;
        if (len > 48) break;
      }
      return colWidths[c.name] ?? Math.max(64, Math.min(360, Math.round(len * 7.2 + 18)));
    });
  });

  // ── 열 폭 끌기 ─────────────────
  const COL_MIN = 40;
  const COL_MAX = 1600;

  function startResize(ev: PointerEvent, c: number) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const name = columns[c]?.name;
    if (name === undefined) return;
    const el = ev.currentTarget as HTMLElement;
    const x0 = ev.clientX;
    const w0 = widths[c];
    el.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      const w = Math.max(COL_MIN, Math.min(COL_MAX, Math.round(w0 + e.clientX - x0)));
      colWidths = { ...colWidths, [name]: w };
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function autoWidth(c: number) {
    const name = columns[c]?.name;
    if (name === undefined || !(name in colWidths)) return;
    const next = { ...colWidths };
    delete next[name];
    colWidths = next;
  }
  const totalW = $derived(GUTTER_W + widths.reduce((a, b) => a + b, 0));
  const lefts = $derived.by(() => {
    const out: number[] = [];
    let x = GUTTER_W;
    for (const w of widths) {
      out.push(x);
      x += w;
    }
    return out;
  });

  const win = $derived(windowRange(scrollTop, viewH - HEAD_H, ROW_H, rows.length));

  // ── 표 안 찾기 (Ctrl+F) ──────────────────────────────────────────────────────────

  let wrapEl = $state<HTMLElement | null>(null);
  let findOpen = $state(false);
  let findQuery = $state("");
  let findCase = $state(false);
  /** 없으면 -1 */
  let findIdx = $state(-1);
  /** 크다 — 깊은 반응형이 필요 없다 */
  let matches = $state.raw<GridMatch[]>([]);
  let findBar = $state<ReturnType<typeof FindBar> | null>(null);
  /** 하이라이트 표에서 이 표의 몫을 가르는 열쇠 */
  const findOwner = {};
  let findFrame = 0;

  /** `false` 면 쿼리 타일이 스키마 트리 거르기로 간다 */
  function openFind(): boolean {
    if (columns.length === 0 || charting) return false;
    findOpen = true;
    void tick().then(() => findBar?.focus());
    return true;
  }

  /** 질의는 남긴다 */
  function closeFind(refocus = true) {
    findOpen = false;
    matches = [];
    findIdx = -1;
    if (findFrame) cancelAnimationFrame(findFrame);
    findFrame = 0;
    clearFind(findOwner);
    if (refocus) scroller?.focus({ preventScroll: true });
  }

  function refind() {
    findFrame = 0;
    if (!findOpen) return;
    matches = gridMatches(rows.length, columns.length, (r, c) => shownCellText(cellDisplay(rows[r]?.[c] ?? null)), findQuery, findCase);
    findIdx = firstMatchFromRow(matches, Math.floor(scrollTop / ROW_H));
    revealFind();
  }

  function stepFind(dir: 1 | -1) {
    if (matches.length === 0) return;
    findIdx = stepMatch(findIdx, matches.length, dir);
    revealFind();
  }

  /** 머리줄(위) · 줄 번호 칸(왼쪽)은 붙박이라 그만큼 뺀 자리에서 잰다 */
  function revealFind() {
    const m = matches[findIdx];
    const box = scroller;
    if (!m || !box) return;
    box.scrollTo({
      top: revealOffset(box.scrollTop, Math.max(ROW_H, viewH - HEAD_H), m.r * ROW_H, ROW_H),
      left: revealOffset(box.scrollLeft, Math.max(1, box.clientWidth - GUTTER_W), lefts[m.c] - GUTTER_W, widths[m.c]),
    });
  }

  $effect(() => {
    void findQuery;
    void findCase;
    if (!findOpen) return;
    untrack(() => {
      if (!findFrame) findFrame = requestAnimationFrame(refind);
    });
  });

  $effect(() => {
    const box = scroller;
    const w = win;
    const list = matches;
    const cur = findIdx;
    if (!findOpen || !box) return;
    untrack(() => paintRows(box, w, list, cur));
  });

  function paintRows(box: HTMLElement, w: { first: number; last: number }, list: readonly GridMatch[], cur: number) {
    const { from, to } = matchesInRows(list, w.first, w.last);
    const rowEls = new Map<number, HTMLElement>();
    for (const el of box.querySelectorAll<HTMLElement>(".row[data-r]")) rowEls.set(Number(el.dataset.r), el);
    const ranges: Range[] = [];
    let current: Range | null = null;
    for (let i = from; i < to; i++) {
      const m = list[i];
      // 줄의 첫 아이는 줄 번호 칸 — 칸 c 는 c + 1 번째
      const node = rowEls.get(m.r)?.children[m.c + 1]?.firstChild;
      if (!(node instanceof Text)) continue;
      const len = node.data.length;
      const r = document.createRange();
      r.setStart(node, Math.min(m.start, len));
      r.setEnd(node, Math.min(m.end, len));
      ranges.push(r);
      if (i === cur) current = r;
    }
    paintFind(findOwner, ranges, current);
  }

  $effect(() => {
    if (charting && untrack(() => findOpen)) untrack(() => closeFind(false));
  });

  $effect(() => {
    const el = wrapEl;
    if (!el) return;
    return untrack(() => registerFindZone(el, openFind));
  });

  onDestroy(() => {
    if (findFrame) cancelAnimationFrame(findFrame);
    clearFind(findOwner);
  });

  let anchor = $state<{ r: number; c: number } | null>(null);
  let head = $state<{ r: number; c: number } | null>(null);
  let dragging = false;
  let detail = $state<{ r: number; c: number } | null>(null);
  let lastResult: DbQueryResult | null = null;
  $effect(() => {
    if (result !== lastResult) {
      lastResult = result;
      anchor = head = detail = null;
      filters = [];
      if (scroller) scroller.scrollTop = 0;
      scrollTop = 0;
    }
  });

  const range = $derived<CellRange | null>(anchor && head ? normRange(anchor, head) : null);
  const inRange = (r: number, c: number) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;

  function down(ev: PointerEvent, r: number, c: number) {
    if (ev.button !== 0) return;
    if (ev.shiftKey && anchor) head = { r, c };
    else anchor = head = { r, c };
    dragging = true;
    scroller?.focus({ preventScroll: true });
  }

  function enter(r: number, c: number) {
    if (dragging && anchor) head = { r, c: rowDrag ? columns.length - 1 : c };
  }

  function up() {
    dragging = false;
    rowDrag = false;
  }

  // ── 행 고르기 ─────────
  let rowDrag = false;

  function rowDown(ev: PointerEvent, r: number) {
    if (ev.button !== 0 || columns.length === 0) return;
    const last = columns.length - 1;
    if (ev.shiftKey && anchor) {
      anchor = { r: anchor.r, c: 0 };
      head = { r, c: last };
    } else {
      anchor = { r, c: 0 };
      head = { r, c: last };
    }
    dragging = true;
    rowDrag = true;
    detail = null;
    scroller?.focus({ preventScroll: true });
  }

  function rowEnter(r: number) {
    if (dragging && anchor) head = { r, c: rowDrag ? columns.length - 1 : (head?.c ?? 0) };
  }

  const rowPicked = (r: number) => !!range && r >= range.r0 && r <= range.r1 && range.c0 === 0 && range.c1 === columns.length - 1;

  function selectAll() {
    if (rows.length === 0 || columns.length === 0) return;
    anchor = { r: 0, c: 0 };
    head = { r: rows.length - 1, c: columns.length - 1 };
  }

  async function copyRange() {
    if (!range) return;
    const all = range.r0 === 0 && range.c0 === 0 && range.r1 === rows.length - 1 && range.c1 === columns.length - 1;
    const ok = await writeClipboard(rangeTsv(columns, rows, range, all && rows.length > 1));
    if (ok) {
      const n = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
      toast.info(t("pane.query.copied", { n }));
    }
  }

  function onKey(ev: KeyboardEvent) {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) {
      if (ev.code === "KeyC") {
        ev.preventDefault();
        void copyRange();
      } else if (ev.code === "KeyA") {
        ev.preventDefault();
        selectAll();
      }
      return;
    }
    if (ev.key === "Escape" && (detail || range)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (detail) detail = null;
      else anchor = head = null;
    }
  }

  // ── 외래 키 · 칸 우클릭 메뉴 ─────────────────────────────────────────────────────

  const fkIdx = $derived(fkColumnIndex(fks));
  const pkSet = $derived(new Set(pks));
  function followOf(row: readonly Cell[], col: string): { fk: number; values: Cell[] } | null {
    if (!onfollow) return null;
    const fk = fkIdx.get(col);
    if (fk === undefined) return null;
    const values = fkValues(fks[fk], columns, row);
    return values ? { fk, values } : null;
  }

  /**
   * 연 순간의 칸 · 값을 쥔다 — 메뉴가 떠 있는 사이 표가 다시 읽혀도 그 칸의 값으로. 메뉴가 닫힌 **뒤** `pickCell` 이 읽는다
   * (menu-runner 의 "스냅샷 → 닫기 → 실행")
   */
  type CellSnap = {
    c: number;
    col: string;
    cell: Cell;
    follow: { fk: number; values: Cell[] } | null;
    /** 앞 `REFS_MAX` 개 · 못 따라가면 `null` */
    back: (Cell[] | null)[];
  };
  let cellSnap: CellSnap | null = null;
  const tileMenu = getContext<GridTileMenu | undefined>(GRID_TILE_MENU);
  const REFS_MAX = 8;

  /** 직접 리스너(머리말의 까닭). 칸 밖은 메뉴 없이 네이티브 메뉴만 막는다 */
  function gridContext(el: HTMLElement) {
    const on = (ev: MouseEvent) => {
      const cellEl = ev.target instanceof Element ? ev.target.closest<HTMLElement>(".cell[data-c]") : null;
      ev.preventDefault();
      const rowEl = cellEl?.closest<HTMLElement>(".row[data-r]");
      if (!cellEl || !rowEl) return;
      const r = Number(rowEl.dataset.r);
      const c = Number(cellEl.dataset.c);
      const row = rows[r];
      const col = columns[c];
      if (!row || !col) return;
      if (!inRange(r, c)) anchor = head = { r, c };
      scroller?.focus({ preventScroll: true });
      const back = onfollowref ? refs.slice(0, REFS_MAX).map((x) => fkValues({ columns: x.refColumns }, columns, row)) : [];
      const snap: CellSnap = { c, col: col.name, cell: row[c] ?? null, follow: followOf(row, col.name), back };
      cellSnap = snap;
      const menuRows = gridMenuRows(
        {
          dataTab: onfilter !== undefined,
          bytes: cellKind(snap.cell) === "bytes",
          charting,
          follow: snap.follow ? (fks[snap.follow.fk]?.refTable ?? null) : null,
          refs: back.flatMap((v, i) => (refs[i] ? [{ table: refs[i].table, columns: refs[i].columns, ok: v !== null }] : [])),
        },
        t,
      );
      tileMenu?.(ev.clientX, ev.clientY, { rows: menuRows, run: pickCell });
    };
    el.addEventListener("contextmenu", on);
    return { destroy: () => el.removeEventListener("contextmenu", on) };
  }

  function pickCell(id: string) {
    const m = cellSnap;
    if (!m) return;
    if (id === "eq" || id === "ne" || id === "and") {
      if (onfilter) onfilter(m.col, m.cell, id);
      else if (cellKind(m.cell) !== "bytes") {
        const f: RowFilter = { col: m.c, name: m.col, op: id === "ne" ? "ne" : "eq", value: m.cell };
        setFilters(withFilter(filters, f, id === "and" ? "add" : "replace"));
      }
    } else if (id === "follow" && m.follow) onfollow?.(m.follow.fk, m.follow.values);
    else if (id.startsWith("ref:")) {
      const i = Number(id.slice(4));
      const v = m.back[i];
      if (v) onfollowref?.(i, v);
    }
    else if (id.startsWith("copy:")) void runExport(id, "range");
    else if (id === "copy") void copyRange();
  }

  // ── 내보내기 ▾ ──────────────────────────────────────────────────────────────────

  /** 파일 저장 둘만 — 형식별 복사는 칸 우클릭 메뉴에 있다 */
  let exportMenu = $state<{ x: number; y: number } | null>(null);
  const closeExportMenu = () => (exportMenu = null);

  function openExport(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    exportMenu = { x: r.left, y: r.top };
  }

  const exportEntries = $derived.by<GridMenuEntry[]>(() =>
    exportMenu
      ? [
          { kind: "item", id: "save:csv", label: t("pane.query.export.saveCsv") },
          { kind: "item", id: "save:json", label: t("pane.query.export.saveJson") },
        ]
      : [],
  );

  async function runExport(id: string, scope: "range" | "all" = "all") {
    const table = exportSlice(columns, rows, scope === "range" && range ? range : null);
    const [how, fmt] = id.split(":") as ["save" | "copy", ExportFormat];
    if (how === "save") {
      if (fmt === "json") {
        await saveTextAs(exportFileName(name, "json", new Date()), exportJson(table), {
          filter: { name: "JSON", ext: "json" },
          saved: "pane.query.export.saved",
          failed: "pane.query.export.failed",
        });
      } else {
        await saveTextAs(exportFileName(name, "csv", new Date()), exportCsv(table, true), {
          filter: { name: "CSV", ext: "csv" },
          saved: "pane.query.export.saved",
          failed: "pane.query.export.failed",
        });
      }
      return;
    }
    const text = fmt === "json" ? exportJson(table) : fmt === "md" ? exportMarkdown(table) : exportCsv(table, false);
    if (await writeClipboard(text)) toast.info(t("pane.query.export.copied", { n: table.rows.length }));
  }

  // 결과가 바뀌면 열린 메뉴를 닫는다 — 다른 표의 칸을 가리키지 않게
  $effect(() => {
    void result;
    untrack(() => {
      exportMenu = null;
    });
  });

  /** 긴 칸만(앱 말풍선이 `title` 을 가로챈다) */
  function tipOf(text: string, w: number): string | undefined {
    if (text.length * 7.2 + 14 < w) return undefined;
    return text.length > 1000 ? text.slice(0, 1000) + "…" : text;
  }

  const detailText = $derived.by(() => {
    if (!detail) return "";
    const c = rows[detail.r]?.[detail.c] ?? null;
    return cellKind(c) === "bytes" ? (cellExport(c) ?? "") : cellDisplay(c);
  });

  const status = $derived.by(() => {
    const parts: string[] = [];
    if (result.affected !== undefined && columns.length === 0) parts.push(t("pane.query.status.affected", { n: result.affected }));
    else {
      parts.push(
        rows.length !== result.rows.length
          ? t("pane.query.status.rowsFiltered", { shown: rows.length, total: result.rows.length })
          : t("pane.query.status.rows", { n: rows.length }),
      );
      // `… RETURNING` — 바뀐 행 수는 서버가 상한 너머까지 센다
      if (result.affected !== undefined) parts.push(t("pane.query.status.affected", { n: result.affected }));
    }
    parts.push(t("pane.query.status.ms", { ms: result.elapsedMs }));
    return parts.join(" · ");
  });
</script>

<svelte:window onpointerup={up} />

{#snippet viewToggle()}
  <!-- [차트] 는 disabled 가 아니라 aria-disabled — 말풍선이 이유를 보이게 -->
  <span class="views" role="group" aria-label={t("pane.query.view.aria")} data-query-view={charting ? "chart" : "grid"}>
    <button type="button" class="vbtn" aria-pressed={!charting} onclick={() => setView("grid")} data-query-view-btn="grid"
      ><UiIcon name="table" size={12} /><span>{t("pane.query.view.grid")}</span></button
    >
    <button
      type="button"
      class="vbtn"
      aria-pressed={charting}
      aria-disabled={blocker !== null}
      title={blocker !== null ? t(`pane.query.chart.blocked.${blocker}`) : t("pane.query.view.chart")}
      onclick={() => setView("chart")}
      data-query-view-btn="chart"><UiIcon name="chart-line" size={12} /><span>{t("pane.query.view.chart")}</span></button
    >
  </span>
{/snippet}

<div class="grid-wrap" data-query-result data-find-zone bind:this={wrapEl}>
  {#if columns.length === 0}
    <p class="empty-result">
      {result.affected !== undefined ? t("pane.query.done.affected", { n: result.affected }) : t("pane.query.done.noRows")}
    </p>
  {:else if charting}
    <ResultChart {result} {classes} lead={viewToggle} bind:kept={chartPick} />
  {:else}
    <div class="vbar">{@render viewToggle()}</div>
    {#if findOpen}
      <FindBar
        bind:this={findBar}
        bind:query={findQuery}
        bind:caseSensitive={findCase}
        count={matches.length}
        index={findIdx}
        label={t("pane.query.find")}
        onstep={stepFind}
        onclose={() => closeFind()}
      />
    {/if}
    {#if filters.length > 0}
      <div class="fbar" data-query-local-filter>
        <span class="flabel">{t("pane.query.localFilter")}</span>
        {#each filters as f, i (i)}
          <span class="chip" data-query-filter-chip={i}
            ><span class="chip-text">{filterLabel(f)}</span><button
              type="button"
              class="chip-x"
              aria-label={t("pane.query.localFilter.remove")}
              onclick={() => setFilters(filters.filter((_, k) => k !== i))}
              data-query-filter-chip-remove={i}><UiIcon name="close" size={10} /></button
            ></span
          >
        {/each}
        <span class="sp"></span>
        <button type="button" class="tbtn" onclick={() => setFilters([])} data-query-filter-clear>{t("pane.query.localFilter.clear")}</button>
      </div>
    {/if}
    <div
      class="scroller"
      role="grid"
      tabindex="0"
      aria-rowcount={rows.length}
      aria-colcount={columns.length}
      aria-label={t("pane.query.grid.aria")}
      bind:this={scroller}
      bind:clientHeight={viewH}
      onscroll={(ev) => (scrollTop = (ev.currentTarget as HTMLElement).scrollTop)}
      onkeydown={onKey}
      use:gridContext
    >
      <div class="canvas" style:width="{totalW}px" style:height="{HEAD_H + rows.length * ROW_H}px">
        <div class="head" role="row" style:width="{totalW}px">
          <span class="gutter hcell" style:width="{GUTTER_W}px"></span>
          {#each columns as col, c (c)}
            {@const dir = activeSort && activeSort.col === col.name ? activeSort.dir : null}
            <span
              class="hcell sortable"
              role="columnheader"
              aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
              style:left="{lefts[c]}px"
              style:width="{widths[c]}px"
              title={`${col.name}${col.type ? ` · ${col.type}` : ""}${pkSet.has(col.name) ? " · PK" : ""}${fkIdx.has(col.name) ? " · FK" : ""}`}
            >
              <button
                type="button"
                class="hsort"
                disabled={onsort ? sortDisabled : false}
                onclick={() => clickSort(col.name)}
                data-query-sort={dir ?? "none"}
              >
                <span class="cname"
                  >{#if pkSet.has(col.name)}<span class="key-mark pk" aria-hidden="true" data-query-pk-col
                      ><UiIcon name="key" size={11} /></span
                    >{/if}{#if fkIdx.has(col.name)}<span class="key-mark fk" aria-hidden="true" data-query-fk-col
                      ><UiIcon name="link" size={11} /></span
                    >{/if}{col.name}{#if dir}<span class="sort-mark" aria-hidden="true">{dir === "asc" ? " ▲" : " ▼"}</span>{/if}</span>
                <span class="ctype">{col.type || "—"}</span>
              </button>
              <!-- svelte-ignore a11y_no_static_element_interactions — 마우스 전용 손잡이(폭은 표 읽기에 필수가 아니다) -->
              <span
                class="col-resize"
                aria-hidden="true"
                onpointerdown={(ev) => startResize(ev, c)}
                onclick={(ev) => ev.stopPropagation()}
                ondblclick={(ev) => {
                  ev.stopPropagation();
                  autoWidth(c);
                }}
                data-query-col-resize={c}
              ></span>
            </span>
          {/each}
        </div>
        {#each { length: win.last - win.first } as _, k (win.first + k)}
          {@const r = win.first + k}
          {@const row = rows[r]}
          <div class="row" role="row" style:top="{HEAD_H + r * ROW_H}px" style:width="{totalW}px" class:odd={r % 2 === 1} data-r={r}>
            <!-- svelte-ignore a11y_no_static_element_interactions — 행 고르기는 마우스 보조(키보드는 Ctrl+A · 칸 고르기) -->
            <span
              class="gutter rowpick"
              class:sel={rowPicked(r)}
              style:width="{GUTTER_W}px"
              onpointerdown={(ev) => rowDown(ev, r)}
              onpointerenter={() => rowEnter(r)}
              data-query-row-pick={r}>{rowBase + r + 1}</span
            >
            {#each columns as _c, c (c)}
              {@const v = row[c] ?? null}
              {@const kind = cellKind(v)}
              {@const text = cellDisplay(v)}
              {@const go = followOf(row, columns[c].name)}
              <span
                class="cell"
                class:fk={go !== null}
                class:null={kind === "null"}
                class:bytes={kind === "bytes"}
                class:num={kind === "number"}
                class:sel={inRange(r, c)}
                role="gridcell"
                tabindex="-1"
                style:left="{lefts[c]}px"
                style:width="{widths[c]}px"
                title={kind === "text" ? tipOf(text, widths[c]) : undefined}
                onpointerdown={(ev) => down(ev, r, c)}
                onpointerenter={() => enter(r, c)}
                ondblclick={() => (detail = { r, c })}
                data-c={c}
                >{shownCellText(text)}{#if go}<button
                    type="button"
                    class="fk-go"
                    tabindex="-1"
                    aria-label={t("pane.query.cell.follow", { table: fks[go.fk]?.refTable ?? "" })}
                    onpointerdown={(ev) => ev.stopPropagation()}
                    ondblclick={(ev) => ev.stopPropagation()}
                    onclick={(ev) => {
                      ev.stopPropagation();
                      onfollow?.(go.fk, go.values);
                    }}
                    data-query-fk-follow><UiIcon name="external" size={11} /></button
                  >{/if}</span
              >
            {/each}
          </div>
        {/each}
      </div>
    </div>
    {#if detail}
      <div class="detail" data-query-detail>
        <div class="detail-head">
          <span class="detail-name">{columns[detail.c]?.name} · {t("pane.query.detail.row", { n: detail.r + 1 })}</span>
          <button type="button" class="tbtn" onclick={() => void writeClipboard(detailText)}>{t("pane.query.detail.copy")}</button>
          <button type="button" class="tbtn" aria-label={t("pane.query.detail.close")} onclick={() => (detail = null)}
            ><UiIcon name="close" size={12} /></button
          >
        </div>
        <pre class="detail-body">{detailText}</pre>
      </div>
    {/if}
  {/if}
  <div class="status" data-query-status>
    {#if lead}<span class="lead" data-query-counts>{lead}</span>{/if}
    <span class="st">{status}</span>
    {#if result.truncated}
      <span class="warn" data-query-truncated>{t("pane.query.status.truncated", { n: result.rows.length })}</span>
    {/if}
    {#if result.cellTruncated}
      <span class="warn" title={t("pane.query.status.cellTruncated.title")}>{t("pane.query.status.cellTruncated")}</span>
    {/if}
    <span class="sp"></span>
    {#if tail}{@render tail()}{/if}
    {#if limit}<RowLimit {...limit} />{/if}
    {#if columns.length > 0}
      {#if !charting}
      <button type="button" class="tbtn" disabled={!range} onclick={() => void copyRange()} title={t("pane.query.copy.title")}
        ><UiIcon name="copy" size={12} /><span class="label">{t("pane.query.copy")}</span></button
      >
      {/if}
      <button
        type="button"
        class="tbtn"
        aria-haspopup="menu"
        aria-expanded={exportMenu !== null}
        onclick={openExport}
        data-query-export
        ><UiIcon name="download" size={12} /><span class="label">{t("pane.query.export")}</span><UiIcon name="chevron-down" size={10} /></button
      >
    {/if}
  </div>
</div>

{#if exportMenu}
  <GridMenu
    entries={exportEntries}
    x={exportMenu.x}
    y={exportMenu.y}
    up
    ariaLabel={t("pane.query.export.menu.aria")}
    onclose={closeExportMenu}
    onpick={(id) => void runExport(id)}
  />
{/if}

<style>
  .grid-wrap {
    container: qgrid / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* 차트 쪽에서는 `ResultChart` 의 조절 줄 맨 앞에 선다 — 같은 치수 */
  .vbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
  }

  .views {
    flex: 0 0 auto;
    display: inline-flex;
    padding: 1px;
    gap: 1px;
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .vbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .vbtn:hover:not([aria-disabled="true"]) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .vbtn[aria-pressed="true"] {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .vbtn[aria-disabled="true"] {
    opacity: 0.45;
    cursor: default;
  }

  .vbtn:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .fbar {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 3px 8px;
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    color: var(--fg-2);
  }

  .flabel {
    flex: 0 0 auto;
    margin-right: 2px;
    color: var(--fg-3);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 280px;
    height: 20px;
    padding: 0 2px 0 8px;
    color: var(--fg);
    background: var(--accent-soft);
    border-radius: 999px;
  }

  .chip-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .chip-x {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .chip-x:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .chip-x:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .scroller {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    outline: none;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }

  .scroller:focus-visible {
    box-shadow: inset 0 0 0 1px var(--focus-border);
  }

  .canvas {
    position: relative;
  }

  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 34px;
    background: var(--surface-raised-solid);
    border-bottom: 1px solid var(--line);
  }

  .hcell {
    position: absolute;
    top: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 34px;
    padding: 0 8px;
    border-right: 1px solid var(--line);
    overflow: hidden;
    font-family: var(--font-ui);
  }

  .col-resize {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 1;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
  }

  .hcell.sortable {
    padding: 0;
  }

  .hsort {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: 0 8px;
    font: inherit;
    text-align: left;
    color: inherit;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .hsort:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .hsort:disabled {
    cursor: default;
  }

  .hsort:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .sort-mark {
    font-size: 9px;
    color: var(--accent, var(--fg-2));
  }

  .cname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .ctype {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    color: var(--fg-3);
  }

  .row {
    position: absolute;
    left: 0;
    height: 22px;
  }

  .row.odd {
    background: color-mix(in srgb, var(--surface-hover) 40%, transparent);
  }

  .gutter {
    position: sticky;
    left: 0;
    box-sizing: border-box;
    height: 100%;
    padding: 0 6px;
    line-height: 22px;
    text-align: right;
    color: var(--fg-3);
    border-right: 1px solid var(--line);
    background: var(--surface-raised-solid);
    z-index: 1;
    display: inline-block;
    vertical-align: top;
  }

  .head .gutter {
    height: 34px;
    z-index: 3;
  }

  .cell {
    position: absolute;
    top: 0;
    box-sizing: border-box;
    height: 22px;
    padding: 0 8px;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: var(--fg-1);
    border-right: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
    cursor: cell;
    user-select: none;
  }

  .cell.num {
    text-align: right;
  }

  .cell.null {
    color: var(--fg-3);
    font-style: italic;
  }

  .cell.bytes {
    color: var(--fg-2);
  }

  /* 키 표시는 이름 앞이라 좁은 열에서도 잘리지 않는다 */
  .key-mark {
    display: inline-flex;
    margin-right: 4px;
    vertical-align: -1px;
    color: var(--fg-3);
  }

  .key-mark.pk {
    color: var(--accent);
  }

  .cell.fk {
    padding-right: 22px;
  }

  .fk-go {
    position: absolute;
    top: 3px;
    right: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    /* 자리는 늘 비워 둔다 — 보일 때 글자가 밀리지 않게 */
    visibility: hidden;
  }

  .cell:hover .fk-go,
  .cell.sel .fk-go,
  .fk-go:focus-visible {
    visibility: visible;
  }

  .fk-go:hover {
    color: var(--accent, var(--fg));
    background: var(--bg-hover);
  }

  .cell.sel {
    background: var(--accent-soft);
    color: var(--fg);
  }

  .gutter.rowpick {
    cursor: pointer;
    user-select: none;
  }

  .gutter.rowpick.sel {
    color: var(--fg);
    /* 고정 칸이라 아래로 지나는 칸이 비치지 않게 불투명 바탕 위에 */
    background: linear-gradient(var(--accent-soft), var(--accent-soft)), var(--surface-raised-solid);
  }

  .empty-result {
    flex: 1 1 auto;
    margin: 0;
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-2);
  }

  .detail {
    flex: 0 0 auto;
    max-height: 40%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
    background: var(--surface-field);
  }

  .detail-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .detail-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-body {
    margin: 0;
    padding: 4px 8px 8px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }

  .status {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 3px 8px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--fg-2);
  }

  .lead {
    flex: 0 0 auto;
    color: var(--fg-1);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .st {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .warn {
    color: var(--warn);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sp {
    flex: 1 1 auto;
  }

  .tbtn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
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

  .tbtn:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  @container qgrid (max-width: 420px) {
    .tbtn .label {
      display: none;
    }
  }
</style>
