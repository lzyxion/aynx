<script lang="ts" module>
  import type { DbQueryResult, DbScriptResult } from "./query-backend";
  import type { PanelList, PanelRow, ResultTabId } from "./run-panel";

  /** 저장하지 않는다. `list` 는 실행이 끝날 때 한 번 지은 목록이다 */
  export type RunShown =
    | { kind: "result"; r: DbQueryResult; list: PanelList; inWork: boolean; writable: boolean }
    | { kind: "script"; r: DbScriptResult; list: PanelList }
    | { kind: "error"; message: string; tag?: "needsWork" | "unconfirmed"; list: PanelList | null };

  export type { PanelRow };

  /** 실행(목록)마다 기억한다 — 스크립트 탭을 오가도 그 실행의 탭이 남는다(저장하지 않는다) */
  const chosenTab = new WeakMap<PanelList, ResultTabId>();
</script>

<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import RowLimit, { type RowLimitProps } from "./RowLimit.svelte";
  import { tick } from "svelte";
  import { hasTabBar, initialPick, initialTab, panelCounts, resultTabs, type StmtStatus } from "./run-panel";
  import { scriptSummary } from "./script-run";
  import type { KeptPick } from "./ResultChart.svelte";

  /**
   * 문장별 결과 패널 — 요약 줄 · 문장 목록 · 결과 표(또는 개수 줄). 문장이 둘 이상이면 결과마다 탭이다.
   * 표가 서면 개수는 표의 상태 줄 맨 앞으로 옮긴다 — 아래 줄이 둘로 서지 않게.
   */
  let {
    shown,
    name,
    limit,
    begin = null,
    onlocate,
    view = $bindable(),
    chartPick = $bindable(),
  }: {
    shown: RunShown;
    name: string;
    limit: RowLimitProps;
    /** needsWork 결과의 [트랜잭션 작업 시작] — 쓰기 모드 · 작업 없음일 때만 부르는 쪽이 준다 */
    begin?: { disabled: boolean; onclick: () => void } | null;
    onlocate: (row: PanelRow) => void;
    /** 부르는 쪽이 들고 있어 다시 실행해도 남는다 */
    view?: "grid" | "chart";
    chartPick?: KeptPick;
  } = $props();

  const list = $derived(shown.list);
  const rows = $derived(list?.rows ?? []);
  const single = $derived(shown.kind !== "script");
  const counts = $derived(list ? panelCounts(list) : null);

  const detached = $derived(shown.kind === "script" && shown.r.detached === true);
  const tabs = $derived(list ? resultTabs(list, detached) : []);
  const bar = $derived(hasTabBar(list, shown.kind === "script", tabs));

  let picked = $state(-1);
  let tab = $state<ResultTabId>("summary");
  let lastList: PanelList | null = null;
  $effect(() => {
    const l = shown.list;
    if (l !== lastList) {
      lastList = l;
      picked = l ? initialPick(l) : -1;
      tab = l ? (chosenTab.get(l) ?? initialTab(l, tabs)) : "summary";
    }
  });

  /** 탭 줄이 없을 때 목록 아래에 펼칠 결과 표 */
  const grid = $derived.by(() => {
    if (bar) return null;
    const r = rows[picked]?.result;
    return r && r.columns.length > 0 && !detached ? r : null;
  });
  /** 단문이 행을 돌려줬으면 요약 띠 · 문장 목록 없이 결과 표만(사용자 결정) */
  const quiet = $derived(shown.kind === "result" && grid !== null);
  const current = $derived(bar && typeof tab === "number" ? (tabs.find((x) => x.no === tab) ?? null) : null);

  type Tone = "ok" | "warn" | "err" | "info";
  interface Head {
    tone: Tone;
    title: string;
    sub?: string;
    why?: string;
    ms?: number;
    unknown?: boolean;
  }

  const head = $derived.by((): Head => {
    if (shown.kind === "result") {
      const r = shown.r;
      const title =
        r.columns.length > 0
          ? t("pane.query.single.rows", { n: r.rows.length })
          : r.affected !== undefined
            ? t("pane.query.single.affected", { n: r.affected })
            : t("pane.query.single.done");
      const changed = r.affected !== undefined && r.affected > 0;
      const sub = shown.inWork
        ? t("pane.query.single.inWork")
        : shown.writable && changed
          ? t("pane.query.single.autoCommitted")
          : undefined;
      return { tone: "ok", title, sub, ms: r.elapsedMs };
    }
    if (shown.kind === "script") {
      const s = scriptSummary(shown.r);
      const warn = s.key === "pane.query.script.sum.workUndone" || s.key === "pane.query.script.sum.workUndoneStopped";
      return {
        tone: warn ? "warn" : s.tone,
        title: t(s.key, s.vars),
        why: shown.r.message,
        ms: shown.r.elapsedMs,
        unknown: shown.r.outcome === "unknown",
      };
    }
    const title =
      shown.tag === "needsWork"
        ? t("pane.query.needsWork.head")
        : shown.tag === "unconfirmed"
          ? t("pane.query.unconfirmed.head")
          : t("pane.query.error.head");
    // 문장에 붙은 실패는 그 줄 안에 원문이 있다 — 요약 줄에 다시 적지 않는다
    return { tone: "err", title, why: shown.list ? undefined : shown.message, unknown: shown.tag === "unconfirmed" };
  });

  const needsWork = $derived(
    (shown.kind === "error" && shown.tag === "needsWork") || (shown.kind === "script" && shown.r.needsWork === true),
  );

  const GLYPH: Record<StmtStatus, string> = { ok: "✓", undone: "↶", failed: "✕", skipped: "·", unknown: "?" };

  function meta(r: PanelRow): string {
    switch (r.status) {
      case "ok":
      case "undone": {
        const x = r.result;
        const parts: string[] = [];
        if (x && x.columns.length > 0 && !detached) parts.push(t("pane.query.status.rows", { n: x.rows.length }));
        else if (x?.affected !== undefined) parts.push(t("pane.query.status.affected", { n: x.affected }));
        if (r.status === "undone") parts.push(t("pane.query.row.undone"));
        else if (parts.length === 0) parts.push(t("pane.query.row.done"));
        return parts.join(" · ");
      }
      case "failed":
        if (r.stop === "cancelled") return t("pane.query.cancelled");
        if (r.stop === "timedOut") return t("pane.query.row.timedOut");
        if (shown.kind === "script" && shown.r.outcome === "refused") return t("pane.query.script.row.refused");
        return t("pane.query.script.row.failed");
      case "skipped":
        return t("pane.query.row.skipped");
      case "unknown":
        return t("pane.query.row.unknown");
    }
  }

  function ms(r: PanelRow): string {
    return r.result && (r.status === "ok" || r.status === "undone") ? t("pane.query.status.ms", { ms: r.result.elapsedMs }) : "—";
  }

  const countsText = $derived.by(() => {
    if (!counts) return "";
    const parts = [`✓ ${counts.ok}`];
    if (counts.undone) parts.push(`↶ ${counts.undone}`);
    if (counts.failed) parts.push(`✕ ${counts.failed}`);
    if (counts.unknown) parts.push(`? ${counts.unknown}`);
    if (counts.skipped) parts.push(t("pane.query.counts.skipped", { n: counts.skipped }));
    if (counts.affected) parts.push(t("pane.query.counts.affected", { n: counts.affected }));
    return parts.join(" · ");
  });

  function pick(i: number) {
    picked = i;
    const r = rows[i];
    if (r) onlocate(r);
  }

  function tabOf(i: number) {
    return bar ? tabs.find((x) => x.row === i) : undefined;
  }

  /** `locate` 면 편집기에서도 그 문장을 고른다 */
  function selectTab(id: ResultTabId, locate: boolean) {
    tab = id;
    if (list) chosenTab.set(list, id);
    if (!locate || id === "summary") return;
    const x = tabs.find((y) => y.no === id);
    const r = x ? rows[x.row] : undefined;
    if (x && r) {
      picked = x.row;
      onlocate(r);
    }
  }

  let barEl = $state<HTMLElement | null>(null);

  function selectedTabEl(): HTMLElement | null {
    return barEl?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null;
  }

  $effect(() => {
    void tab;
    if (!barEl) return;
    void tick().then(() => selectedTabEl()?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });

  function onTabKey(ev: KeyboardEvent) {
    const ids: ResultTabId[] = ["summary", ...tabs.map((x) => x.no)];
    const at = ids.indexOf(tab);
    let next = at;
    if (ev.key === "ArrowRight") next = Math.min(ids.length - 1, at + 1);
    else if (ev.key === "ArrowLeft") next = Math.max(0, at - 1);
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = ids.length - 1;
    else return;
    ev.preventDefault();
    if (next === at) return;
    selectTab(ids[next], true);
    void tick().then(() => selectedTabEl()?.focus());
  }

  function onTabWheel(ev: WheelEvent) {
    const el = barEl;
    if (!el || el.scrollWidth <= el.clientWidth || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    el.scrollLeft += ev.deltaY;
    ev.preventDefault();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, picked + (ev.key === "ArrowDown" ? 1 : -1)));
    if (next !== picked) pick(next);
  }
</script>

<div class="run" data-query-script={shown.kind === "script" ? shown.r.outcome : undefined} data-query-run-kind={shown.kind}>
  {#if !quiet}
  <div
    class="sum tone-{head.tone}"
    class:unknown={head.unknown}
    role={head.tone === "err" || head.tone === "warn" ? "alert" : "status"}
    data-query-error={shown.kind === "error" ? (shown.tag ?? "") : undefined}
  >
    <span class="sum-icon" aria-hidden="true">
      <UiIcon
        name={head.tone === "ok" ? "check" : head.tone === "warn" ? "warning" : head.tone === "err" ? "alert-caution" : "info"}
        size={14}
      />
    </span>
    <span class="sum-main">
      <span class="sum-line">
        {#if detached}<span class="detached">{t("pane.query.script.detached")}</span>{/if}
        <span class="sum-text" data-query-script-sum>{head.title}</span>
        {#if head.sub}<span class="sum-sub">{head.sub}</span>{/if}
      </span>
      {#if head.why}<span class="why">{head.why}</span>{/if}
    </span>
    {#if needsWork && begin}
      <button type="button" class="btn needs-work" disabled={begin.disabled} title={t("pane.query.tx.begin.title")} onclick={begin.onclick} data-query-needs-work-begin
        ><UiIcon name="list-checks" size={11} /><span>{t("pane.query.tx.begin")}</span></button
      >
    {/if}
    {#if head.ms !== undefined}<span class="sum-ms">{t("pane.query.status.ms", { ms: head.ms })}</span>{/if}
  </div>
  {/if}

  {#if bar}
    <div
      class="rtabs"
      role="tablist"
      tabindex="-1"
      aria-label={t("pane.query.res.tabs")}
      bind:this={barEl}
      onkeydown={onTabKey}
      onwheel={onTabWheel}
      data-query-result-tabs
    >
      <button
        type="button"
        class="rtab"
        role="tab"
        aria-selected={tab === "summary"}
        tabindex={tab === "summary" ? 0 : -1}
        onclick={() => selectTab("summary", false)}
        data-query-result-tab="summary"><span class="rtab-name">{t("pane.query.res.summary")}</span></button
      >
      {#each tabs as x (x.no)}
        <button
          type="button"
          class="rtab"
          role="tab"
          aria-selected={tab === x.no}
          tabindex={tab === x.no ? 0 : -1}
          title={x.sql}
          onclick={() => selectTab(x.no, true)}
          data-query-result-tab={x.no}
          ><span class="rtab-name">{t("pane.query.res.tab", { n: x.no })}</span><span class="rtab-n"
            >{t("pane.query.status.rows", { n: x.rows })}</span
          ></button
        >
      {/each}
    </div>
  {/if}

  {#if current}
    <div class="detail tabbed" role="tabpanel" aria-label={t("pane.query.res.tab", { n: current.no })} data-query-result-panel={current.no}>
      {#key current.result}
        <ResultGrid result={current.result} {name} {limit} bind:view bind:chartPick />
      {/key}
    </div>
  {:else}
  {#if rows.length > 0 && !quiet}
    <div class="list" class:grow={!grid} role="listbox" tabindex="0" aria-label={t("pane.query.script.list")} onkeydown={onKey}>
      <div class="row head" aria-hidden="true">
        <span></span><span class="no">{t("pane.query.list.no")}</span><span>{t("pane.query.list.sql")}</span><span class="meta"
          >{t("pane.query.list.result")}</span
        ><span class="ms">{t("pane.query.list.ms")}</span>
      </div>
      {#each rows as r, i (r.index)}
        <div
          class="row st-{r.status}"
          class:on={i === picked}
          role="option"
          tabindex="-1"
          aria-selected={i === picked}
          title={t("pane.query.row.title")}
          onclick={() => pick(i)}
          onkeydown={(ev) => (ev.key === "Enter" || ev.key === " ") && pick(i)}
          data-query-script-row={r.index}
          data-query-row-status={r.status}
        >
          <span class="glyph" aria-hidden="true">{GLYPH[r.status]}</span>
          <span class="no">{r.index + 1}</span>
          <span class="sqlcell">
            <span class="sql">{r.sql || "—"}</span>
            {#if r.message && (r.status === "failed" || r.status === "unknown")}
              <span class="msg">{r.message}</span>
            {/if}
          </span>
          <span class="meta"
            >{#if tabOf(i)}{@const rt = tabOf(i)!}<button
                type="button"
                class="to-tab"
                title={t("pane.query.res.goto", { n: rt.no })}
                onclick={(ev) => {
                  ev.stopPropagation();
                  selectTab(rt.no, true);
                }}
                onkeydown={(ev) => ev.stopPropagation()}
                data-query-goto-tab={rt.no}>{meta(r)} ›</button
              >{:else}{meta(r)}{/if}</span
          >
          <span class="ms">{ms(r)}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if grid}
    <div class="detail">
      {#key grid}
        <ResultGrid result={grid} {name} {limit} lead={single ? undefined : countsText} bind:view bind:chartPick />
      {/key}
    </div>
  {:else}
    <div class="foot">
      {#if counts}<span class="counts" data-query-counts>{countsText}</span>{/if}
      {#if detached}<span class="note">{t("pane.query.script.detachedRows")}</span>{/if}
      <span class="sp"></span>
      <RowLimit {...limit} />
    </div>
  {/if}
  {/if}
</div>

<style>
  .run {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  /* 결론의 갈래마다 의미색 — 새 색 없음 */
  .sum {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 10px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    border-bottom: 1px solid var(--line);
    user-select: text;
  }

  .sum-icon {
    flex: 0 0 auto;
    display: inline-flex;
    margin-top: 1px;
    color: var(--fg-2);
  }

  .sum.tone-ok {
    background: color-mix(in srgb, var(--ok) 8%, transparent);
  }

  .sum.tone-ok .sum-icon {
    color: var(--ok);
  }

  .sum.tone-warn {
    background: var(--warn-soft);
  }

  .sum.tone-warn .sum-icon {
    color: var(--warn);
  }

  .sum.tone-err {
    background: var(--err-soft);
  }

  .sum.tone-err .sum-icon {
    color: var(--err);
  }

  .sum.tone-info .sum-icon {
    color: var(--accent);
  }

  .sum.unknown {
    box-shadow: inset 3px 0 0 var(--err);
  }

  .sum-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sum-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
  }

  .sum-text {
    font-weight: var(--fw-semibold);
    color: var(--fg);
  }

  .sum-sub {
    color: var(--fg-2);
  }

  .sum-ms {
    flex: 0 0 auto;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .why {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .detached {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
  }

  .needs-work {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .needs-work:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .needs-work:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .needs-work:focus-visible {
    outline: 1px solid var(--focus-border);
  }

  .list {
    flex: 0 1 auto;
    max-height: 40%;
    min-height: 0;
    overflow: auto;
    font-size: var(--t-xs);
    outline: none;
  }

  .list.grow {
    flex: 1 1 auto;
    max-height: none;
  }

  .list:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .row {
    display: grid;
    grid-template-columns: 16px 26px minmax(0, 1fr) auto 56px;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--line-faint, var(--line));
    color: var(--fg-1);
    cursor: pointer;
  }

  .row.head {
    position: sticky;
    top: 0;
    z-index: 1;
    padding-top: 3px;
    padding-bottom: 3px;
    /* 밑으로 줄이 지나가니 글래스 크롬 타일에서는 불투명(`--tile-sticky` · `PaneHost`) */
    background: var(--tile-sticky, var(--bg-panel));
    color: var(--fg-3);
    cursor: default;
  }

  .row:not(.head):hover {
    background: var(--bg-hover);
  }

  .row.on {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .glyph {
    text-align: center;
    font-weight: var(--fw-semibold);
  }

  .st-ok .glyph {
    color: var(--ok);
  }

  .st-undone .glyph {
    color: var(--accent);
  }

  .st-failed .glyph {
    color: var(--err);
  }

  .st-unknown .glyph {
    color: var(--warn);
  }

  .st-skipped {
    color: var(--fg-3);
  }

  .no {
    text-align: right;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .sqlcell {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .sql {
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta,
  .ms {
    text-align: right;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .row.st-failed {
    background: color-mix(in srgb, var(--err) 9%, transparent);
    box-shadow: inset 3px 0 0 var(--err);
  }

  .row.st-failed.on {
    background: color-mix(in srgb, var(--err) 14%, transparent);
  }

  .row.st-failed .sql {
    color: var(--fg);
  }

  .row.st-failed .meta {
    color: var(--err);
    font-weight: var(--fw-semibold);
  }

  .msg {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--err);
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }

  .st-unknown .msg {
    color: var(--fg-1);
  }

  /* `QueryView` 의 .otab 과 같은 밑줄 탭 */
  .rtabs {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 3px 6px 0;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--line);
    outline: none;
  }

  .rtab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    max-width: 180px;
    min-width: 0;
    padding: 3px 10px 4px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .rtab[aria-selected="true"] {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }

  .rtab:hover {
    color: var(--fg);
  }

  .rtab:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .rtab-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rtab-n {
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .rtab[aria-selected="true"] .rtab-n {
    color: var(--fg-2);
  }

  @container (max-width: 380px) {
    .rtab {
      padding: 3px 7px 4px;
    }

    .rtab-n {
      display: none;
    }
  }

  .to-tab {
    padding: 0;
    font: inherit;
    color: var(--accent);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .to-tab:hover {
    text-decoration: underline;
  }

  .to-tab:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: 1px;
  }

  .detail.tabbed {
    border-top: none;
  }

  .detail {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }

  .detail > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* `ResultGrid` 의 .status 와 같은 치수 — 고치면 같이 */
  .foot {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin-top: auto;
    padding: 3px 8px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--fg-2);
  }

  .counts {
    color: var(--fg-1);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .note {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sp {
    flex: 1 1 auto;
  }
</style>
