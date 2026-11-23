<script lang="ts">
  /**
   * 쿼리 타일의 데이터 탭 하나 — 하위 탭 [데이터 | 구조 | DDL].
   *
   * - 조회는 늘 **읽기 전용**이다(`runData` → `db_query{readOnly}`) — 트랜잭션 작업이 열려 있으면 보내지 않는다.
   * - 서버는 연결당 작업 하나라 다른 일이 없을 때(`waiting` 아님)만 보내고, 구조를 읽는 동안은 `onmeta` 로 알려 트리 · 다른 데이터 탭이 기다리게 한다.
   * - 행 값 · 쪽 번호는 저장하지 않는다 — WHERE · 정렬 · 쪽 크기만 `onchange` 로 명세에 남는다. 숨은 탭은 조회를 보내지 않는다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { QUERY_DATA_PAGE_SIZES, type QueryDataTab } from "$lib/session";
  import ResultGrid from "./ResultGrid.svelte";
  import type { KeptPick } from "./ResultChart.svelte";
  import DefinitionView from "./DefinitionView.svelte";
  import WhereField from "./WhereField.svelte";
  import { filterItems, sqlComplete, whereKeywords } from "./sql-complete";
  import { qualifiedName } from "./sql-quote";
  import { columnList, type Load } from "./schema-tree";
  import {
    cleanWhere,
    dataDefTarget,
    dataSelectSql,
    dataTabTitle,
    nextSort,
    pageOf,
    pageSizeOf,
    rowSpan,
    withPageSize,
    withSort,
    withWhere,
    andCondition,
    cellCondition,
    fkCondition,
    type GridForeignKey,
  } from "./data-tab";
  import {
    dbDefinition,
    dbTableDetail,
    errorMessage,
    type DbColumn,
    type DbDefinition,
    type DbDialect,
    type DbForeignKey,
    type DbOpened,
    type DbQueryResult,
    type DbTableDetail,
    type Cell,
  } from "./query-backend";

  type RunData = (tab: number, sql: string, maxRows: number) => Promise<{ ok: true; r: DbQueryResult } | { ok: false; message: string; cancelled: boolean } | null>;

  let {
    n,
    data,
    dialect,
    opened,
    visible,
    waiting,
    treeReading = false,
    inWork,
    running,
    runData,
    oncancel,
    onchange,
    onopensql,
    onlost,
    onmeta,
    onfollow,
    onopendata,
    poke = 0,
  }: {
    n: number;
    data: QueryDataTab;
    dialect: DbDialect;
    opened: DbOpened | null;
    visible: boolean;
    /** 연결이 다른 일을 하는 중 — 끝나면 저절로 읽는다 */
    waiting: boolean;
    /** 이 탭의 조회와 같은 순간에 출발해 겹쳤으면(서버 Busy) 오류 대신 다시 읽는다 */
    treeReading?: boolean;
    inWork: boolean;
    running: boolean;
    runData: RunData;
    oncancel: () => void;
    onchange: (d: QueryDataTab) => void;
    onopensql: (sql: string) => void;
    /** 참이면 부모가 [다시 열기] 띠로 보였다 — 여기서는 보이지 않는다 */
    onlost: (message: string) => boolean;
    onmeta?: (reading: boolean) => void;
    onfollow?: (target: { schema: string | null; name: string; where: string }) => void;
    onopendata?: (target: { schema: string | null; name: string }) => void;
    /** 바깥이 이 탭의 조건(`data.where`)을 덮었다 — 값이 바뀌면 WHERE 칸을 맞추고 1쪽부터 다시 읽는다 */
    poke?: number;
  } = $props();

  let sub = $state<"data" | "structure" | "ddl">("data");
  const defTarget = $derived(dataDefTarget(dialect, data));
  const fullName = $derived(dataTabTitle(dialect, data));
  const size = $derived(pageSizeOf(data));

  // ── 데이터 ─────────────────────────────────────────────────────────────

  // svelte-ignore state_referenced_locally
  let whereText = $state(data.where ?? "");
  let page = $state(0);
  let shown = $state<{ result: DbQueryResult; hasNext: boolean; page: number } | null>(null);
  /** 다시 읽어도 남는다(탭이 사는 동안만 · 저장 안 함) */
  let colWidths = $state<Record<string, number>>({});
  let gridView = $state<"grid" | "chart">("grid");
  let chartPick = $state<KeptPick | undefined>(undefined);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let needLoad = $state(true);
  let seq = 0;
  let disposed = false;
  $effect(() => () => {
    disposed = true;
  });

  let lastConn = "";
  $effect(() => {
    const c = opened ? `${opened.handle}:${opened.lease}` : "";
    if (c === lastConn || c === "") return;
    const first = lastConn === "";
    lastConn = c;
    untrack(() => {
      if (!first) {
        needLoad = true;
        detail = null;
        ddl = null;
      }
    });
  });

  $effect(() => {
    if (visible && sub === "data" && opened && needLoad && !waiting && !inWork && !loading) untrack(() => void load());
  });

  // 트리 읽기와 같은 순간에 출발하면 늦은 쪽이 서버의 Busy 로 실패한다(`SchemaTree` 의 같은 절) — 그 실패는 오류로 보이지 않고 다시 읽는다
  let treeHit = false;
  $effect(() => {
    if (treeReading && loading) treeHit = true;
  });

  async function load() {
    const o = opened;
    if (!o) return;
    needLoad = false;
    loading = true;
    treeHit = treeReading;
    error = null;
    const my = ++seq;
    const p = page;
    const sz = size;
    const r = await runData(n, dataSelectSql(dialect, data, p, sz, true), sz + 1);
    if (disposed || my !== seq) return;
    loading = false;
    if (r === null) {
      // 그 사이 연결이 다른 일을 시작했다 — 풀리면 저절로 다시
      needLoad = true;
      return;
    }
    if (r.ok) {
      const pg = pageOf(r.r, sz);
      shown = { result: pg.result, hasNext: pg.hasNext, page: p };
    } else if (!r.cancelled && treeHit) {
      needLoad = true;
    } else {
      error = r.cancelled ? t("pane.query.data.cancelled") : r.message;
    }
  }

  function reload(p = page) {
    page = Math.max(0, p);
    needLoad = true;
  }

  function applyWhere() {
    const w = cleanWhere(whereText);
    whereText = w;
    if ((data.where ?? "") !== w) onchange(withWhere(data, w));
    reload(0);
  }

  let whereEl = $state<HTMLInputElement | null>(null);

  function clearWhere() {
    whereText = "";
    applyWhere();
    whereEl?.focus();
  }

  function whereKey(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      applyWhere();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      whereText = data.where ?? "";
    }
  }

  // svelte-ignore state_referenced_locally
  let lastPoke = poke;
  $effect(() => {
    const p = poke;
    if (p === lastPoke) return;
    lastPoke = p;
    untrack(() => {
      whereText = data.where ?? "";
      reload(0);
    });
  });

  function filterBy(col: string, cell: Cell, op: "eq" | "ne" | "and") {
    const cond = cellCondition(dialect, col, cell, op === "ne" ? "ne" : "eq");
    if (cond === null) return;
    whereText = op === "and" ? andCondition(data.where ?? "", cond) : cond;
    applyWhere();
  }

  /** SQLite 는 이 탭이 스키마 없이 열렸으면 `main` 도 없이 — 트리가 여는 탭과 같은 열쇠여야 이미 열린 탭을 찾는다(`findDataTab`) */
  function otherSchema(s: string | null | undefined): string | null {
    if (!s) return data.schema ?? null;
    if (dialect === "sqlite" && s === "main" && !data.schema) return null;
    return s;
  }

  function follow(fk: number, values: Cell[]) {
    const f = fks[fk];
    if (!f || !onfollow) return;
    const where = fkCondition(dialect, f.refColumns, values);
    if (where === null) return;
    onfollow({ schema: otherSchema(f.refSchema), name: f.refTable, where });
  }

  function followRef(i: number, values: Cell[]) {
    const x = refs[i];
    if (!x || !onfollow) return;
    const where = fkCondition(dialect, x.columns, values);
    if (where === null) return;
    onfollow({ schema: otherSchema(x.schema), name: x.table, where });
  }

  function sortBy(col: string) {
    onchange(withSort(data, nextSort(data.sort, col)));
    reload(0);
  }

  function pickSize(v: string) {
    const k = Number(v);
    if (!(QUERY_DATA_PAGE_SIZES as readonly number[]).includes(k) || k === size) return;
    onchange(withPageSize(data, k));
    reload(0);
  }

  function openSql() {
    onopensql(dataSelectSql(dialect, data, shown?.page ?? page, size, false));
  }

  const sizeItems = $derived(QUERY_DATA_PAGE_SIZES.map((k) => ({ value: String(k), label: t("pane.query.data.pageSize.option", { n: k }) })));
  const busy = $derived(loading || waiting);
  const span = $derived(shown ? rowSpan(shown.page, size, shown.result.rows.length) : null);
  const lead = $derived(
    [
      t("pane.query.data.readOnly"),
      span ? t("pane.query.data.rows", { from: span.from.toLocaleString(), to: span.to.toLocaleString() }) : t("pane.query.data.rows.none"),
      shown?.hasNext ? t("pane.query.data.more") : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const whereDirty = $derived(cleanWhere(whereText) !== (data.where ?? ""));

  // ── 구조 · DDL ─────────────────────────────────────────────────────────

  let detail = $state<Load<DbTableDetail> | null>(null);
  let ddl = $state<Load<DbDefinition> | null>(null);

  $effect(() => {
    if (!visible || !opened || waiting) return;
    if (sub === "structure" && detail === null) untrack(() => void loadDetail());
    if (sub === "ddl" && ddl === null && defTarget) untrack(() => void loadDdl());
  });

  const fks = $derived<GridForeignKey[]>(
    detail?.state === "ok"
      ? detail.value.foreignKeys.map((f) => ({ columns: f.columns, refSchema: f.refSchema || null, refTable: f.refTable, refColumns: f.refColumns }))
      : [],
  );
  const pks = $derived<string[]>(detail?.state === "ok" ? detail.value.columns.filter((c) => c.pk > 0).map((c) => c.name) : []);
  const refs = $derived<DbForeignKey[]>(detail?.state === "ok" ? detail.value.referencedBy : []);

  /** 읽는 동안 부모에 알린다 — 서버는 연결당 작업 하나 */
  async function readDetail(o: DbOpened): Promise<DbTableDetail> {
    onmeta?.(true);
    try {
      return await dbTableDetail(o.handle, o.lease, data.schema ?? null, data.name);
    } finally {
      onmeta?.(false);
    }
  }

  // 외래 키(↗) — 데이터를 처음 읽은 뒤 연결이 한가할 때 조용히 한 번(실패하면 ↗ 만 없다)
  let fkConn = "";
  $effect(() => {
    if (!visible || !opened || !shown || loading || needLoad || waiting || detail !== null) return;
    const c = `${opened.handle}:${opened.lease}`;
    if (c === fkConn) return;
    fkConn = c;
    untrack(() => void loadFks());
  });

  async function loadFks() {
    const o = opened;
    if (!o) return;
    try {
      const v = await readDetail(o);
      if (!disposed && detail === null) detail = { state: "ok", value: v };
    } catch {
      // 조용히 — ↗ 만 없다
    }
  }

  async function loadDetail() {
    const o = opened;
    if (!o) return;
    detail = { state: "loading" };
    try {
      const v = await readDetail(o);
      if (!disposed) detail = { state: "ok", value: v };
    } catch (e) {
      const m = errorMessage(e);
      if (disposed) return;
      detail = onlost(m) ? null : { state: "error", message: stripReason(m) };
    }
  }

  async function loadDdl() {
    const o = opened;
    const target = defTarget;
    if (!o || !target) return;
    ddl = { state: "loading" };
    try {
      const v = await dbDefinition(o.handle, o.lease, target);
      if (!disposed) ddl = { state: "ok", value: v };
    } catch (e) {
      const m = errorMessage(e);
      if (disposed) return;
      ddl = onlost(m) ? null : { state: "error", message: stripReason(m) };
    }
  }

  // ↻ 는 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(브랜치 타일과 같은 규칙)
  let subSpinning = $state(false);
  let dataSpinning = $state(false);
  const subReading = $derived(
    sub === "structure" ? detail === null || detail.state === "loading" : sub === "ddl" ? ddl === null || ddl.state === "loading" : false,
  );
  /** 데이터 ↻ 는 읽는 동안 [취소] 로 바뀌어 없다 — 다시 서면 남은 바퀴를 채우고 멈춘다 */
  const dataReading = $derived(needLoad || loading);

  function refreshSub() {
    subSpinning = true;
    if (sub === "structure") detail = null;
    else if (sub === "ddl") ddl = null;
  }

  /** 지금 보이는 하위 탭의 ↻ 와 같다 — DB 타일의 F5(`QueryView`)도 이것을 부른다 */
  export function refresh() {
    if (sub !== "data") {
      if (!waiting) refreshSub();
      return;
    }
    if (running || busy || inWork || !opened) return;
    dataSpinning = true;
    if (whereDirty) applyWhere();
    else reload();
  }

  // ── WHERE 칸 자동완성 ──────────────

  const whereCols = $derived<DbColumn[]>(
    detail?.state === "ok" ? detail.value.columns.map((c) => ({ name: c.name, type: c.type })) : (shown?.result.columns ?? []),
  );

  /** 칸 글을 `SELECT * FROM <이 표> WHERE …` 안에 놓고 같은 규칙(`sql-complete`)으로 */
  function whereSource(text: string, pos: number, explicit: boolean) {
    const head = `SELECT * FROM ${qualifiedName(dialect, data.schema ?? null, data.name)} WHERE `;
    const cols = whereCols;
    const p = sqlComplete({
      dialect,
      text: head + text,
      pos: head.length + pos,
      explicit,
      rels: [{ schema: data.schema ?? null, name: data.name, kind: "table" }],
      schemas: [],
      columns: () => cols,
      keywords: whereKeywords(dialect),
      relations: false,
    });
    if (!p || p.from < head.length) return null;
    return { from: p.from - head.length, items: filterItems(p.items, p.word) };
  }

  const fromText = (f: DbForeignKey) => `${f.schema ? `${f.schema}.` : ""}${f.table}${columnList(f.columns)} → ${columnList(f.refColumns)}`;
  const openOther = (schema: string | null | undefined, name: string) => onopendata?.({ schema: otherSchema(schema), name });
  const partLabel = (p: string) => t(`pane.query.schema.part.${p}` as "pane.query.schema.part.columns");
  const conLabel = (c: string) => t(`pane.query.schema.con.${c}` as "pane.query.schema.con.primary");
</script>

{#snippet pager()}
  <span class="pager">
    <button
      type="button"
      class="tbtn"
      aria-label={t("pane.query.data.prev")}
      disabled={busy || inWork || !shown || shown.page === 0}
      onclick={() => reload((shown?.page ?? 1) - 1)}
      data-query-data-prev><UiIcon name="chevron-left" size={12} /></button
    >
    <span class="pg" data-query-data-page={shown?.page ?? page}>{t("pane.query.data.page", { n: (shown?.page ?? page) + 1 })}</span>
    <button
      type="button"
      class="tbtn"
      aria-label={t("pane.query.data.next")}
      disabled={busy || inWork || !shown?.hasNext}
      onclick={() => reload((shown?.page ?? 0) + 1)}
      data-query-data-next><UiIcon name="chevron" size={12} /></button
    >
    <span class="size" data-query-data-size>
      <Dropdown value={String(size)} options={sizeItems} ariaLabel={t("pane.query.data.pageSize")} disabled={busy} onchange={pickSize} />
    </span>
  </span>
{/snippet}

<div class="dtab" data-query-data={n} data-query-data-kind={data.kind}>
  <div class="subs" role="tablist" aria-label={t("pane.query.data.subs", { name: fullName })}>
    <button type="button" class="sub" role="tab" aria-selected={sub === "data"} onclick={() => (sub = "data")} data-query-data-sub="data"
      >{t("pane.query.data.sub.data")}</button
    >
    <button type="button" class="sub" role="tab" aria-selected={sub === "structure"} onclick={() => (sub = "structure")} data-query-data-sub="structure"
      >{t("pane.query.data.sub.structure")}</button
    >
    {#if defTarget}
      <button type="button" class="sub" role="tab" aria-selected={sub === "ddl"} onclick={() => (sub = "ddl")} data-query-data-sub="ddl"
        >{t("pane.query.data.sub.ddl")}</button
      >
    {/if}
    <span class="obj" title={fullName}>{fullName}</span>
    {#if sub !== "data"}
      <button
        type="button"
        class="tbtn refresh"
        class:spinning={subSpinning}
        title={t("pane.query.data.refresh.title")}
        aria-label={t("pane.query.data.refresh")}
        aria-busy={subReading}
        disabled={waiting}
        onclick={refreshSub}
        onanimationiteration={() => {
          if (!subReading) subSpinning = false;
        }}><UiIcon name="refresh" size={12} /></button
      >
    {/if}
  </div>

  {#if sub === "data"}
    <!-- 도구줄 순서([SQL 로 열기] · WHERE 칸 · ↻)는 사용자 결정 -->
    <div class="tools">
      <button type="button" class="tbtn" onclick={openSql} data-query-data-sql
        ><UiIcon name="snippet" size={12} /><span class="label">{t("pane.query.data.openSql")}</span></button
      >
      <label class="where" class:dirty={whereDirty}>
        <span class="kw">WHERE</span>
        <WhereField
          bind:value={whereText}
          bind:el={whereEl}
          placeholder={t("pane.query.data.where.placeholder")}
          ariaLabel={t("pane.query.data.where")}
          source={whereSource}
          onkeydown={whereKey}
        />
        {#if whereText !== "" || (data.where ?? "") !== ""}
          <button type="button" class="wclear" aria-label={t("pane.query.data.where.clear")} onclick={clearWhere} data-query-data-where-clear
            ><UiIcon name="close" size={11} /></button
          >
        {/if}
      </label>
      {#if running}
        <button type="button" class="tbtn" onclick={oncancel} data-query-data-cancel>{t("pane.query.cancel")}</button>
      {:else}
        <button
          type="button"
          class="tbtn refresh"
          class:spinning={dataSpinning}
          title={t("pane.query.data.refresh.title")}
          aria-label={t("pane.query.data.refresh")}
          aria-busy={dataReading}
          disabled={busy || inWork || !opened}
          onclick={refresh}
          onanimationiteration={() => {
            if (!dataReading) dataSpinning = false;
          }}
          data-query-data-refresh><UiIcon name="refresh" size={12} /></button
        >
      {/if}
    </div>
    {#if inWork}
      <div class="band" role="status" data-query-data-blocked="tx">{t("pane.query.data.inWork")}</div>
    {/if}
    {#if error}
      <div class="band err" role="alert" data-query-data-error>{error}</div>
    {/if}
    <div class="grid">
      {#if shown}
        {#key shown.result}
          <ResultGrid
            result={shown.result}
            name={data.name}
            {lead}
            sort={data.sort ?? null}
            onsort={sortBy}
            sortDisabled={busy || inWork}
            rowBase={shown.page * size}
            tail={pager}
            bind:colWidths
            bind:view={gridView}
            bind:chartPick
            onfilter={filterBy}
            {pks}
            {fks}
            onfollow={onfollow ? follow : undefined}
            {refs}
            onfollowref={onfollow ? followRef : undefined}
          />
        {/key}
      {:else if !error}
        <p class="note">{loading ? t("pane.query.data.loading") : waiting && needLoad ? t("pane.query.data.waiting") : ""}</p>
      {/if}
    </div>
  {:else if sub === "structure"}
    <div class="struct" data-query-data-structure>
      {#if detail === null || detail.state === "loading"}
        <p class="note">{waiting && detail === null ? t("pane.query.data.waiting") : t("pane.query.data.loading")}</p>
      {:else if detail.state === "error"}
        <div class="band err" role="alert">{detail.message}</div>
      {:else}
        {@const d = detail.value}
        {@const commented = d.columns.some((c) => c.comment)}
        {#if d.comment}
          <section data-query-struct-comment>
            <h4>{t("pane.query.data.col.comment")}</h4>
            <p class="tcomment">{d.comment}</p>
          </section>
        {/if}
        <section>
          <h4>{partLabel("columns")} <span class="cnt">{d.columns.length}</span></h4>
          <table>
            <thead
              ><tr
                ><th>{t("pane.query.data.col.name")}</th><th>{t("pane.query.data.col.type")}</th><th>{t("pane.query.data.col.null")}</th><th
                  >{t("pane.query.data.col.default")}</th
                ><th>PK</th>{#if commented}<th class="cm" data-query-struct-comment-col>{t("pane.query.data.col.comment")}</th>{/if}</tr
              ></thead
            >
            <tbody>
              {#each d.columns as c (c.name)}
                <tr
                  ><td class="nm">{c.name}</td><td class="mono">{c.type}</td><td>{c.notNull ? "NOT NULL" : ""}</td><td class="mono">{c.default ?? ""}</td><td
                    >{c.pk > 0 ? c.pk : ""}</td
                  >{#if commented}<td class="cm">{c.comment ?? ""}</td>{/if}</tr
                >
              {/each}
            </tbody>
          </table>
        </section>
        {#if d.indexes.length > 0}
          <section>
            <h4>{partLabel("indexes")} <span class="cnt">{d.indexes.length}</span></h4>
            <table>
              <tbody>
                {#each d.indexes as x, i (i)}
                  <tr
                    ><td class="nm">{x.name}</td><td class="mono">{columnList(x.columns, t("pane.query.schema.expr"))}</td><td
                      >{x.primary ? conLabel("primary") : x.unique ? conLabel("unique") : ""}</td
                    ><td class="mono">{x.method ?? ""}{x.predicate ? ` WHERE ${x.predicate}` : ""}</td></tr
                  >
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
        {#if d.constraints.length > 0}
          <section>
            <h4>{partLabel("constraints")} <span class="cnt">{d.constraints.length}</span></h4>
            <table>
              <tbody>
                {#each d.constraints as x, i (i)}
                  <tr><td class="nm">{x.name ?? ""}</td><td>{conLabel(x.type)}</td><td class="mono">{columnList(x.columns)}</td><td class="mono">{x.definition ?? ""}</td></tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
        {#if d.foreignKeys.length > 0}
          <section>
            <h4>{partLabel("foreignKeys")} <span class="cnt">{d.foreignKeys.length}</span></h4>
            <table>
              <tbody>
                {#each d.foreignKeys as x, i (i)}
                  <tr
                    ><td class="nm">{x.name ?? ""}</td><td class="mono"
                      >{columnList(x.columns)} → {#if onopendata}<button
                          type="button"
                          class="tlink"
                          onclick={() => openOther(x.refSchema, x.refTable)}
                          data-query-struct-open={x.refTable}>{x.refSchema ? `${x.refSchema}.` : ""}{x.refTable}</button
                        >{:else}{x.refSchema ? `${x.refSchema}.` : ""}{x.refTable}{/if}{columnList(x.refColumns)}</td
                    ><td class="mono"
                      >{[x.onUpdate ? `ON UPDATE ${x.onUpdate}` : "", x.onDelete ? `ON DELETE ${x.onDelete}` : ""].filter(Boolean).join(" ")}</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
        {#if d.referencedBy.length > 0}
          <section>
            <h4>{partLabel("referencedBy")} <span class="cnt">{d.referencedBy.length}</span></h4>
            <table>
              <tbody>
                {#each d.referencedBy as x, i (i)}
                  <tr
                    ><td class="nm">{x.name ?? ""}</td><td class="mono"
                      >{#if onopendata}<button
                          type="button"
                          class="tlink"
                          onclick={() => openOther(x.schema, x.table)}
                          data-query-struct-open={x.table}>{x.schema ? `${x.schema}.` : ""}{x.table}</button
                        >{columnList(x.columns)} → {columnList(x.refColumns)}{:else}{fromText(x)}{/if}</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
        {#if d.triggers.length > 0}
          <section>
            <h4>{partLabel("triggers")} <span class="cnt">{d.triggers.length}</span></h4>
            <table>
              <tbody>
                {#each d.triggers as x, i (i)}
                  <tr><td class="nm">{x.name}</td><td class="mono">{x.detail}</td></tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
        {#if d.partitions.length > 0}
          <section>
            <h4>{partLabel("partitions")} <span class="cnt">{d.partitions.length}</span></h4>
            <table>
              <tbody>
                {#each d.partitions as x, i (i)}
                  <tr><td class="nm">{x.schema}.{x.name}</td><td class="mono">{x.bound ?? ""}</td></tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
        {#if d.truncated.length > 0}
          <p class="note">{t("pane.query.data.truncated")}</p>
        {/if}
      {/if}
    </div>
  {:else if defTarget}
    <div class="ddl">
      {#if ddl === null}
        <p class="note">{waiting ? t("pane.query.data.waiting") : t("pane.query.data.loading")}</p>
      {:else}
        <DefinitionView target={defTarget} {dialect} load={ddl} oninsert={onopensql} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .dtab {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    font-size: 11px;
    color: var(--fg-2);
  }

  .subs,
  .tools {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 8px;
    border-bottom: 1px solid var(--line);
  }

  .sub {
    padding: 3px 9px;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
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

  .sub:focus-visible,
  .tbtn:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .obj {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--fg-3);
  }

  .where {
    flex: 1 1 240px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 120px;
    height: 22px;
    padding: 0 6px;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .where:focus-within {
    border-color: var(--focus-border);
  }

  .where.dirty {
    border-style: dashed;
  }

  .where .kw {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
  }

  /* 스키마 트리 찾기 칸의 ✕(`.fclear`)와 같은 모양 */
  .wclear {
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

  .wclear:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .pager {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .pg {
    min-width: 44px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .size {
    width: 84px;
    margin-left: 4px;
  }

  .size :global(.trigger) {
    height: 20px;
    font-size: 11px;
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

  /* 도는 동안은 흐리지 않는다 — 눌러서 돌고 있다는 것이 곧 응답이다 */
  .tbtn.refresh.spinning {
    opacity: 1;
  }

  .tbtn.refresh.spinning :global(svg) {
    animation: data-tab-spin 0.9s linear infinite;
  }

  @keyframes data-tab-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 움직임 줄임이면 돌리지 않고 흐리게만 — 바퀴 끝 이벤트가 없으니 흐림은 `aria-busy` 를 따른다 */
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
    background: var(--warn-soft, var(--bg-hover));
    border-bottom: 1px solid var(--line);
    white-space: pre-wrap;
  }

  .band.err {
    background: var(--err-soft);
  }

  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .grid > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  .note {
    margin: 0;
    padding: var(--space-3);
    color: var(--fg-3);
  }

  .struct {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 6px 10px 12px;
  }

  .struct section + section {
    margin-top: 12px;
  }

  .tcomment {
    margin: 0;
    padding: 3px 8px;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }

  .tlink {
    padding: 0;
    font: inherit;
    color: var(--accent, var(--fg));
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .tlink:hover {
    text-decoration: underline;
  }

  .tlink:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: 1px;
  }

  .struct h4 {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .cnt {
    font-weight: normal;
    color: var(--fg-3);
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th,
  td {
    padding: 3px 8px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
  }

  th {
    font-weight: var(--fw-semibold);
    color: var(--fg-3);
  }

  td.nm {
    color: var(--fg-1);
    white-space: nowrap;
  }

  td.mono {
    font-family: var(--font-mono);
    word-break: break-all;
  }

  /* 폭을 정하지 않으면 긴 설명의 max-content 가 표 폭을 다 가져가 형 · NULL 칸이 한 글자 폭으로 눌린다 */
  th.cm {
    width: 33%;
  }

  td.cm {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .ddl {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .ddl > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
