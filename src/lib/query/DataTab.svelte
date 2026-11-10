<script lang="ts">
  /**
   * **쿼리 타일의 데이터 탭 하나**(2026-11-10 — Beekeeper Studio 식, 목업 "제안 A"). 스키마 트리의 테이블 · 뷰를 두 번 눌러 연 객체 하나를
   * 하위 탭 **[데이터 | 구조 | DDL]** 로 보인다. 규칙은 순수 `query/data-tab`, 탭 줄 · 저장은 `query/script-tabs` · `session/spec` 의 `canonDataTab`.
   *
   * - **데이터**: 도구줄(WHERE 조건 칸 — Enter 로 적용 · Esc 로 되돌림 · 새로 고침 · 쪽 ‹ › · 쪽 크기 · [SQL 로 열기]) + 결과 표(`ResultGrid` —
   *   복사 · CSV · 표/차트 · 찾기 그대로, 열 머리글 = `ORDER BY` 로 다시 조회). 조회는 늘 **읽기 전용**이다 — `runData`(부모 세션의 실행 칸
   *   하나를 함께 쓴다 → `db_query{readOnly}` · 서버가 가드 · 엔진 모두 읽기 전용, 열린 트랜잭션이면 거절). 트랜잭션 작업이 열려 있으면
   *   보내지 않고 까닭을 띠로 보인다. 연결이 다른 일을 하는 동안(`waiting` — 실행 · 작업 단추 · 트리 읽기)은 기다렸다 저절로 읽는다.
   * - **구조**: `db_table_detail`(트리와 같은 재료)을 표로 — 컬럼 · 인덱스 · 제약 조건 · 외래 키 · 참조됨 · 트리거 · 파티션(빈 칸은 숨김).
   * - **DDL**: `DefinitionView` 그대로(그 방언이 그 종류의 DDL 을 주지 않으면 하위 탭이 없다 — `dataDefTarget`). [편집기에 넣기] = 새 쿼리 탭.
   *
   * **칸으로 거르기 · 외래 키 따라가기**(2026-11-10): 결과 표의 칸 우클릭 [이 값으로 거르기] · [이 값 빼고 거르기]는 WHERE 칸을 그 조건으로
   * **바꾸고**, [조건에 더하기]는 적용된 조건에 `AND` 로 붙인 뒤 1쪽부터 다시 읽는다(조건 글은 `data-tab` 의 `cellCondition` · `andCondition`).
   * 외래 키는 데이터를 처음 읽은 **뒤에** 한 번 `db_table_detail` 로 조용히 읽어 둔다(구조 하위 탭과 같은 재료 — 그대로 함께 쓴다 · 실패하면
   * ↗ 만 없다). 서버는 연결당 작업 하나라 데이터 읽기 · 트리 읽기 · 실행이 없을 때(`waiting` 아님)만 보내고, 읽는 동안은 `onmeta` 로 부모에
   * 알려 트리와 다른 데이터 탭이 기다리게 한다. ↗ 는 참조 표의 데이터 탭을 `참조열 = 값` 으로 연다(`onfollow` — 이미 열린 탭이면 그 탭의
   * 조건을 덮고 다시 읽는다: 부모가 `poke` 를 올린다). **역방향**은 같은 재료의 `referencedBy` 로 — 칸 메뉴의 "이 행을 가리키는 행" 이 그 표를
   * `참조하는 열 = 이 행의 피참조 값` 으로 같은 길(`onfollow`)에 연다. 구조 하위 탭의 외래 키 · 참조됨의 저편 표 이름은 링크 — 그 표의 데이터 탭을
   * 조건 없이 연다(`onopendata` — 이미 열렸으면 그 탭으로만).
   *
   * 행 값 · 쪽 번호는 저장하지 않는다(탭을 다시 열면 첫 쪽부터 다시 조회) — WHERE · 정렬 · 쪽 크기는 `onchange` 로 명세에 남는다.
   * 처음 보일 때(그리고 연결이 바뀌면) 읽는다 — 숨은 데이터 탭은 조회를 보내지 않는다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { QUERY_DATA_PAGE_SIZES, type QueryDataTab } from "$lib/session";
  import ResultGrid from "./ResultGrid.svelte";
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
    /** 탭 번호 */
    n: number;
    data: QueryDataTab;
    dialect: DbDialect;
    opened: DbOpened | null;
    /** 지금 보이는 탭인가 — 숨은 탭은 읽지 않는다 */
    visible: boolean;
    /** 연결이 다른 일을 하는 중(실행 · 작업 단추 · 모드 바꾸기 · 트리 읽기) — 끝나면 저절로 읽는다 */
    waiting: boolean;
    /** 스키마 트리가 읽는 중 — 이 탭의 조회와 같은 순간에 출발해 겹쳤으면(서버 Busy) 오류 대신 다시 읽는다 */
    treeReading?: boolean;
    /** 트랜잭션 작업이 열려 있다 — 데이터 조회를 보내지 않는다(서버도 거절) */
    inWork: boolean;
    /** 이 탭의 조회가 도는 중(부모 세션의 실행 칸) */
    running: boolean;
    runData: RunData;
    oncancel: () => void;
    onchange: (d: QueryDataTab) => void;
    /** 새 쿼리 탭에 글을 넣는다(실행 안 함) */
    onopensql: (sql: string) => void;
    /** 메타 읽기 실패 — 연결을 잃은 갈래면 부모가 [다시 열기] 띠로(참이면 여기서는 보이지 않는다) */
    onlost: (message: string) => boolean;
    /** 표 구조(`db_table_detail`)를 읽는 중 · 끝 — 부모가 트리 · 다른 데이터 탭을 기다리게 한다(서버는 연결당 작업 하나) */
    onmeta?: (reading: boolean) => void;
    /** ↗ — 참조 표의 데이터 탭을 이 조건으로 연다(이미 있으면 그 탭의 조건을 덮고 다시 읽는다) */
    onfollow?: (target: { schema: string | null; name: string; where: string }) => void;
    /** 구조 하위 탭의 외래 키 · 참조됨 표 이름 — 그 표의 데이터 탭을 조건 없이 연다(이미 있으면 그 탭으로만) */
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
  /** 사람이 끌어 바꾼 열 폭 — 쪽 · 정렬 · 조건을 바꿔도 남는다(탭이 사는 동안만 · 저장 안 함) */
  let colWidths = $state<Record<string, number>>({});
  let error = $state<string | null>(null);
  let loading = $state(false);
  /** 읽어야 한다(처음 · 조건 · 쪽 · 연결이 바뀜 · 새로 고침) */
  let needLoad = $state(true);
  let seq = 0;
  let disposed = false;
  $effect(() => () => {
    disposed = true;
  });

  // 연결이 바뀌면(다시 열기 · 재부착) 다시 읽는다 — 구조 · DDL 도
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

  // 겹침 — 트리 읽기와 같은 순간에 출발하면 늦은 쪽이 서버의 Busy 로 실패한다(SchemaTree 의 같은 절). 조회 중에 트리가 읽었으면
  // 그 실패는 오류로 보이지 않고, 트리가 끝나면(`waiting` 이 풀리면) 저절로 다시 읽는다.
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
      // 보내지 못했다(그 사이 연결이 다른 일을 시작) — 풀리면 저절로 다시
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

  /** ✕ — 조건을 비우고 곧바로 조건 없이 1쪽부터(지우고 Enter 와 같다) */
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

  // 바깥이 조건을 덮었다(↗ 로 이미 열린 이 탭에 왔다) — 칸을 맞추고 1쪽부터
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

  /** 칸 우클릭의 거르기 — `eq` · `ne` 는 조건을 바꾸고, `and` 는 적용된 조건에 더한다 */
  function filterBy(col: string, cell: Cell, op: "eq" | "ne" | "and") {
    const cond = cellCondition(dialect, col, cell, op === "ne" ? "ne" : "eq");
    if (cond === null) return;
    whereText = op === "and" ? andCondition(data.where ?? "", cond) : cond;
    applyWhere();
  }

  /**
   * 외래 키 저편의 스키마 — 비면 이 탭의 스키마. SQLite 는 이 탭이 스키마 없이(`main` 하나) 열렸으면 `main` 도 없이 — 트리가 여는 탭과
   * 같은 열쇠여야 이미 열린 탭을 찾는다(`findDataTab`)
   */
  function otherSchema(s: string | null | undefined): string | null {
    if (!s) return data.schema ?? null;
    if (dialect === "sqlite" && s === "main" && !data.schema) return null;
    return s;
  }

  /** ↗ — 그 행의 외래 키 값으로 참조 표를 연다 */
  function follow(fk: number, values: Cell[]) {
    const f = fks[fk];
    if (!f || !onfollow) return;
    const where = fkCondition(dialect, f.refColumns, values);
    if (where === null) return;
    onfollow({ schema: otherSchema(f.refSchema), name: f.refTable, where });
  }

  /** 역방향 — 이 행을 가리키는 표를 `참조하는 열 = 이 행의 피참조 값` 으로 연다 */
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

  /** 이 표의 외래 키(구조를 읽었을 때만 — 못 읽었으면 빈 목록) */
  const fks = $derived<GridForeignKey[]>(
    detail?.state === "ok"
      ? detail.value.foreignKeys.map((f) => ({ columns: f.columns, refSchema: f.refSchema || null, refTable: f.refTable, refColumns: f.refColumns }))
      : [],
  );
  /** 기본 키 열(같은 재료 — 머리글 열쇠 표시) */
  const pks = $derived<string[]>(detail?.state === "ok" ? detail.value.columns.filter((c) => c.pk > 0).map((c) => c.name) : []);
  /** 이 표를 가리키는 외래 키(같은 재료 — 추가 조회 없음) */
  const refs = $derived<DbForeignKey[]>(detail?.state === "ok" ? detail.value.referencedBy : []);

  /** 표 구조 읽기 하나 — 읽는 동안 부모에 알린다(`onmeta`) */
  async function readDetail(o: DbOpened): Promise<DbTableDetail> {
    onmeta?.(true);
    try {
      return await dbTableDetail(o.handle, o.lease, data.schema ?? null, data.name);
    } finally {
      onmeta?.(false);
    }
  }

  // 외래 키(↗) — 데이터를 처음 읽은 뒤 한 번, 연결이 한가할 때 조용히(실패하면 ↗ 만 없다 — 구조 하위 탭은 열 때 다시 읽는다).
  // 연결이 바뀌면(다시 열기 — `detail` 이 걷힌다) 한 번 더.
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

  function refreshSub() {
    if (sub === "structure") detail = null;
    else if (sub === "ddl") ddl = null;
  }

  // ── WHERE 칸 자동완성 — 이 표의 열(구조를 읽었으면 그 형 · 아니면 결과 열) + 조건 키워드. 추가 조회 없음 ──────────────

  const whereCols = $derived<DbColumn[]>(
    detail?.state === "ok" ? detail.value.columns.map((c) => ({ name: c.name, type: c.type })) : (shown?.result.columns ?? []),
  );

  /** 칸 글을 `SELECT * FROM <이 표> WHERE …` 안에 놓고 같은 규칙(`sql-complete`)으로 — `이표.` 뒤도 열만 */
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

<!-- 쪽 넘기기 · 쪽 크기 — 결과 표의 아래 상태 줄 오른쪽(목업 "제안 A" 처럼 표 아래에) -->
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
        class="tbtn"
        title={t("pane.query.data.refresh")}
        aria-label={t("pane.query.data.refresh")}
        disabled={waiting}
        onclick={refreshSub}><UiIcon name="refresh" size={12} /></button
      >
    {/if}
  </div>

  {#if sub === "data"}
    <!-- 도구줄 — [SQL 로 열기] · WHERE 칸(✕) · ↻(조회 중이면 [취소]) 순서(2026-11-10 사용자 결정) -->
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
          class="tbtn"
          title={t("pane.query.data.refresh")}
          aria-label={t("pane.query.data.refresh")}
          disabled={busy || inWork || !opened}
          onclick={() => (whereDirty ? applyWhere() : reload())}
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
        <section>
          <h4>{partLabel("columns")} <span class="cnt">{d.columns.length}</span></h4>
          <table>
            <thead
              ><tr
                ><th>{t("pane.query.data.col.name")}</th><th>{t("pane.query.data.col.type")}</th><th>{t("pane.query.data.col.null")}</th><th
                  >{t("pane.query.data.col.default")}</th
                ><th>PK</th></tr
              ></thead
            >
            <tbody>
              {#each d.columns as c (c.name)}
                <tr
                  ><td class="nm">{c.name}</td><td class="mono">{c.type}</td><td>{c.notNull ? "NOT NULL" : ""}</td><td class="mono">{c.default ?? ""}</td><td
                    >{c.pk > 0 ? c.pk : ""}</td
                  ></tr
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

  /* 조건 지우기 ✕ — 스키마 트리 찾기 칸의 ✕(`.fclear`)와 같은 모양 */
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

  /* 구조 하위 탭의 저편 표 이름 — 그 표의 데이터 탭으로 */
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
