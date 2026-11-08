<script lang="ts" module>
  import type { DbQueryResult } from "./query-backend";

  /** [표 | 차트] — 결과마다 기억한다(`RunResults` 의 `chosenTab` 과 같은 꼴 · 저장하지 않는다 — 다시 실행하면 표로) */
  const chosenView = new WeakMap<DbQueryResult, "grid" | "chart">();
</script>

<script lang="ts">
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { writeClipboard } from "$lib/clipboard";
  import { writeTextFile } from "$lib/scrollback";
  import { toast } from "$lib/toast.svelte.js";
  import RowLimit, { type RowLimitProps } from "./RowLimit.svelte";
  import {
    cellDisplay,
    cellExport,
    cellKind,
    csvFileName,
    normRange,
    rangeTsv,
    toCsv,
    windowRange,
    type CellRange,
  } from "./cells";
  import { chartBlocker, classifyColumns } from "./chart-model";
  import ResultChart from "./ResultChart.svelte";
  import { onDestroy, tick, untrack } from "svelte";
  import FindBar from "$lib/FindBar.svelte";
  import { revealOffset, stepMatch } from "$lib/doc-find";
  import { clearFind, paintFind } from "$lib/doc-find-dom";
  import { registerFindZone } from "$lib/app/tile-find";
  import { firstMatchFromRow, gridMatches, matchesInRows, shownCellText, type GridMatch } from "./grid-find";

  /**
   * **쿼리 결과 표** — 가상 스크롤(보이는 줄 ± 덧그림만 DOM 에 — 행 1만까지), 머리줄은 컬럼 이름 + 형, NULL 은 흐린 `NULL`,
   * 바이트는 `‹bytes N›`, 긴 칸은 말줄임 + 툴팁(두 번 누르면 아래 칸에 펼친다).
   *
   * 칸 고르기: 누르기 = 한 칸 · `Shift`+누르기 · 끌기 = 사각형 · `Ctrl+A` = 전부 · `Ctrl+C` = 고른 사각형을 TSV 로(전부를
   * 골랐으면 머리줄도). [CSV 저장] 은 표 전체(RFC 4180 · UTF-8 BOM — `cells.ts`)를 OS 저장 대화상자로 고른 자리에
   * `write_text_file` 로 쓴다(스크롤백 내보내기와 같은 길).
   *
   * 머리의 **[표 | 차트]**(10-15) — 차트는 `ResultChart`(규칙 `chart-model`). 그릴 수 없는 결과(행 0개 · 숫자 열 0개)는 [차트] 가
   * 비활성이고 말풍선이 이유를 말한다. 고른 쪽은 결과마다 기억한다(`chosenView`). 차트 쪽에서도 아래 상태 줄(행 상한 · CSV)은 그대로다.
   *
   * 아래 상태 줄에는 행 상한 고르개(`limit` — 다음 실행에 쓰인다)가 [복사] 앞에 선다(10-14 — 위 띠에서 옮겼다). 표가 없는 결과
   * (DML · 행 없음)에도 이 줄은 늘 선다.
   *
   * **표 안 찾기**(2026-10-19): 포커스가 이 결과 칸에 있을 때 앱의 `find` 키(`Ctrl+F` — 쿼리 타일의 문이 이 표의 찾기 자리를 연다,
   * `app/tile-find.ts`)가 [표 | 차트] 줄 아래에 찾기 띠(`FindBar`)를 연다. 가상 스크롤이라 DOM 이 아니라 **칸 글자**(그리는 글자 그대로)
   * 에서 찾고(`grid-find.ts` — 문서 찾기와 같은 매칭 · 상한), 칠은 **보이는 줄의 칸만** 그때그때 `Range` 로 만든다(스크롤하면 다시 칠한다).
   * `Enter` · `F3` 다음 · `Shift+Enter` · `Shift+F3` 이전(그 칸이 보이게 민다) · `Esc` 닫고 표로. 차트 쪽에는 없다.
   */
  let {
    result,
    name,
    limit,
    lead,
  }: {
    result: DbQueryResult;
    name: string;
    limit?: RowLimitProps;
    /** 상태 줄 맨 앞에 붙는 글(문장별 결과 패널의 개수 줄 "✓ 3 · 영향 2행" — 10-14, 아래 줄이 둘로 서지 않게) */
    lead?: string;
  } = $props();

  const ROW_H = 22;
  const HEAD_H = 34;
  const GUTTER_W = 48;

  let scroller = $state<HTMLElement | null>(null);
  let scrollTop = $state(0);
  let viewH = $state(0);

  const columns = $derived(result.columns);
  const rows = $derived(result.rows);

  // 부르는 쪽이 `{#key result}` 로 결과마다 새로 만든다 — 처음 값만 기억에서 꺼낸다
  // svelte-ignore state_referenced_locally
  let view = $state<"grid" | "chart">(chosenView.get(result) ?? "grid");
  const classes = $derived(columns.length > 0 ? classifyColumns(result) : []);
  const blocker = $derived(chartBlocker(result, classes));
  const charting = $derived(view === "chart" && blocker === null);

  function setView(v: "grid" | "chart") {
    if (v === "chart" && blocker !== null) return;
    view = v;
    chosenView.set(result, v);
  }

  /** 컬럼 폭 — 머리 글자와 앞 200행 · 끝 50행의 글자 길이로 어림(64~360px) */
  const widths = $derived.by(() => {
    // 앞 200행 + 끝 50행 — 뒤로 갈수록 길어지는 값(일련번호 · 이름)도 잡는다
    const sample = rows.length > 250 ? [...rows.slice(0, 200), ...rows.slice(-50)] : rows;
    return columns.map((c, i) => {
      let len = Math.max(c.name.length, c.type.length + 2);
      for (const r of sample) {
        const s = cellDisplay(r[i] ?? null);
        if (s.length > len) len = s.length;
        if (len > 48) break;
      }
      return Math.max(64, Math.min(360, Math.round(len * 7.2 + 18)));
    });
  });
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
  /** 지금 일치 — 없으면 -1 */
  let findIdx = $state(-1);
  /** 일치들 — 행 → 열 차례(크다 — 깊은 반응형이 필요 없다) */
  let matches = $state.raw<GridMatch[]>([]);
  let findBar = $state<ReturnType<typeof FindBar> | null>(null);
  /** 하이라이트 표에서 이 표의 몫을 가르는 열쇠(`paintFind`) */
  const findOwner = {};
  let findFrame = 0;

  /** 쿼리 타일의 문이 부른다 — 표가 없거나 차트 쪽이면 `false`(스키마 트리 거르기로) */
  function openFind(): boolean {
    if (columns.length === 0 || charting) return false;
    findOpen = true;
    void tick().then(() => findBar?.focus());
    return true;
  }

  /** 띠를 닫고 칠을 걷는다 — 질의는 남긴다. `refocus` 면 표로 */
  function closeFind(refocus = true) {
    findOpen = false;
    matches = [];
    findIdx = -1;
    if (findFrame) cancelAnimationFrame(findFrame);
    findFrame = 0;
    clearFind(findOwner);
    if (refocus) scroller?.focus({ preventScroll: true });
  }

  /** 질의 · 대소문자가 바뀌었다 — 그림 틀에 한 번 다시 찾고, 맨 위에 보이는 줄 뒤 첫 일치로 */
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

  /** 지금 일치의 칸이 보이게 민다 — 머리줄(위) · 줄 번호 칸(왼쪽)은 붙박이라 그만큼 뺀 자리에서 잰다 */
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

  // 칠 — 보이는 줄의 칸만(가상 스크롤). 창 · 일치 · 고른 번호가 바뀌면 DOM 이 선 뒤에 다시 칠한다
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

  // 차트로 넘기면 띠를 닫는다
  $effect(() => {
    if (charting && untrack(() => findOpen)) untrack(() => closeFind(false));
  });

  // 쿼리 타일의 문이 포커스가 든 결과 칸에서 이 자리를 찾는다(`openFindZoneIn`)
  $effect(() => {
    const el = wrapEl;
    if (!el) return;
    return untrack(() => registerFindZone(el, openFind));
  });

  onDestroy(() => {
    if (findFrame) cancelAnimationFrame(findFrame);
    clearFind(findOwner);
  });

  // 고르기 — 닻 · 머리(행 · 열). 결과가 바뀌면 걷는다
  let anchor = $state<{ r: number; c: number } | null>(null);
  let head = $state<{ r: number; c: number } | null>(null);
  let dragging = false;
  let detail = $state<{ r: number; c: number } | null>(null);
  let lastResult: DbQueryResult | null = null;
  $effect(() => {
    if (result !== lastResult) {
      lastResult = result;
      anchor = head = detail = null;
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
    if (dragging && anchor) head = { r, c };
  }

  function up() {
    dragging = false;
  }

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

  async function saveCsv() {
    let path: string | null = null;
    try {
      path = await saveDialog({ defaultPath: csvFileName(name, new Date()), filters: [{ name: "CSV", extensions: ["csv"] }] });
    } catch (e) {
      console.error("[aynx] 저장 대화상자를 열지 못했습니다", e);
    }
    if (path === null) return;
    try {
      await writeTextFile(path, toCsv(columns, rows));
      toast.success(t("pane.query.csv.saved", { path }));
    } catch (e) {
      toast.error(t("pane.query.csv.failed", { reason: e instanceof Error ? e.message : String(e) }));
    }
  }

  /** 툴팁 — 긴 칸만(앱 말풍선이 `title` 을 가로챈다). 너무 길면 앞부분만 */
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
      parts.push(t("pane.query.status.rows", { n: rows.length }));
      // `… RETURNING` — 돌려준 행(상한까지)과 따로 바뀐 행 수 전체(서버가 상한 너머까지 센다 — 2단계)
      if (result.affected !== undefined) parts.push(t("pane.query.status.affected", { n: result.affected }));
    }
    parts.push(t("pane.query.status.ms", { ms: result.elapsedMs }));
    return parts.join(" · ");
  });
</script>

<svelte:window onpointerup={up} />

{#snippet viewToggle()}
  <!-- [표 | 차트] — 둘 다 Tab 으로 닿는다. 그릴 수 없으면 [차트] 는 aria-disabled(말풍선이 이유를 보이도록 disabled 를 쓰지 않는다) -->
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
    <ResultChart {result} {classes} lead={viewToggle} />
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
    >
      <div class="canvas" style:width="{totalW}px" style:height="{HEAD_H + rows.length * ROW_H}px">
        <div class="head" role="row" style:width="{totalW}px">
          <span class="gutter hcell" style:width="{GUTTER_W}px"></span>
          {#each columns as col, c (c)}
            <span class="hcell" role="columnheader" style:left="{lefts[c]}px" style:width="{widths[c]}px" title={`${col.name}${col.type ? ` · ${col.type}` : ""}`}>
              <span class="cname">{col.name}</span>
              <span class="ctype">{col.type || "—"}</span>
            </span>
          {/each}
        </div>
        {#each { length: win.last - win.first } as _, k (win.first + k)}
          {@const r = win.first + k}
          {@const row = rows[r]}
          <div class="row" role="row" style:top="{HEAD_H + r * ROW_H}px" style:width="{totalW}px" class:odd={r % 2 === 1} data-r={r}>
            <span class="gutter" style:width="{GUTTER_W}px">{r + 1}</span>
            {#each columns as _c, c (c)}
              {@const v = row[c] ?? null}
              {@const kind = cellKind(v)}
              {@const text = cellDisplay(v)}
              <span
                class="cell"
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
                ondblclick={() => (detail = { r, c })}>{shownCellText(text)}</span
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
      <span class="warn" data-query-truncated>{t("pane.query.status.truncated", { n: rows.length })}</span>
    {/if}
    {#if result.cellTruncated}
      <span class="warn" title={t("pane.query.status.cellTruncated.title")}>{t("pane.query.status.cellTruncated")}</span>
    {/if}
    <span class="sp"></span>
    {#if limit}<RowLimit {...limit} />{/if}
    {#if columns.length > 0}
      {#if !charting}
      <button type="button" class="tbtn" disabled={!range} onclick={() => void copyRange()} title={t("pane.query.copy.title")}
        ><UiIcon name="copy" size={12} /><span class="label">{t("pane.query.copy")}</span></button
      >
      {/if}
      <button type="button" class="tbtn" onclick={() => void saveCsv()} title={t("pane.query.csv")} data-query-csv
        ><UiIcon name="download" size={12} /><span class="label">{t("pane.query.csv")}</span></button
      >
    {/if}
  </div>
</div>

<style>
  .grid-wrap {
    container: qgrid / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* 머리 — [표 | 차트] 전환(차트 쪽에서는 `ResultChart` 의 조절 줄 맨 앞에 선다 — 같은 치수) */
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

  /* 줄 번호 칸 — 가로로 밀어도 왼쪽에 붙어 있다(줄 안의 sticky) */
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

  .cell.sel {
    background: var(--accent-soft);
    color: var(--fg);
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
