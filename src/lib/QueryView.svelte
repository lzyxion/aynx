<script lang="ts">
  import { onDestroy, onMount, setContext, tick, untrack } from "svelte";
  import { GRID_TILE_MENU, type GridTileMenu } from "$lib/query/grid-menu";
  import { listen, type UnlistenFn } from "./ipc";
  import { openFindZoneIn, registerTileFind } from "$lib/app/tile-find";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import SqlEditor from "$lib/query/SqlEditor.svelte";
  import RunResults, { type RunShown } from "$lib/query/RunResults.svelte";
  import RowLimit, { type RowLimitProps } from "$lib/query/RowLimit.svelte";
  import RunBar from "$lib/query/RunBar.svelte";
  import ScriptTabs from "$lib/query/ScriptTabs.svelte";
  import SchemaTree from "$lib/query/SchemaTree.svelte";
  import SchemaPane from "$lib/query/SchemaPane.svelte";
  import { createToggleMotion, sidePanelGrow } from "$lib/browser/tree-accordion";
  import DefinitionView from "$lib/query/DefinitionView.svelte";
  import DataTab from "$lib/query/DataTab.svelte";
  import { dataSelectSql, pageSizeOf } from "$lib/query/data-tab";
  import TreeMenu from "$lib/query/TreeMenu.svelte";
  import ScriptTabMenu from "$lib/query/ScriptTabMenu.svelte";
  import { NO_TAB, tabsToCloseN } from "$lib/query/script-tabs";
  import { tileRefreshOf } from "$lib/query/tile-refresh";
  import { focusedPane } from "$lib/app/tabs.svelte.js";
  import { anyModalOpen } from "$lib/app/keys.svelte.js";
  import { sqlDropAccepts, sqlSaveName } from "$lib/query/sql-file";
  import { dropSources, openSqlSources, pickSqlSources, saveSqlText } from "$lib/query/sql-file-io";
  import { sameTarget } from "$lib/query/definition";
  import type { Load, TreeRelation } from "$lib/query/schema-tree";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { QUERY_ROW_LIMITS, QUERY_ROWS_DEFAULT, paneName, type PaneSpec, type QueryRowLimit } from "$lib/session";
  import { selectStarSql } from "$lib/query/sql-quote";
  import { createSqlCompleter } from "$lib/query/sql-completer";
  import { createScriptTabs, docKey } from "$lib/query/script-controller.svelte.js";
  import { createQuerySession } from "$lib/query/query-session.svelte.js";
  import {
    dbDefinition,
    errorMessage,
    type DbDefinition,
    type DbDefinitionTarget,
    type DbDialect,
    type DbTxView,
  } from "$lib/query/query-backend";
  import { formatClock, txOpen } from "$lib/query/tx-work";
  import { chipText, fitRunLine, type ChipParts } from "$lib/query/bar-fit";
  import { queryTreeLayout, TREE_DROP_W } from "$lib/pane/head-span";
  import { DROPDOWN_GAP, DROPDOWN_MARGIN } from "$lib/dropdown";
  import { noteDbTx } from "$lib/app/db-tx";
  import { noteQueryLive } from "$lib/app/query-live.svelte.js";
  import { noteQueryMaxRows, noteQueryName, openConnForm, queryConnLabel, queryStreamOf } from "$lib/app/query.svelte.js";
  import type { DbEngine } from "$lib/db-conn";
  import { askAiWithText } from "$lib/app/ask-ai.svelte.js";
  import { buildDbAskText, dbAskSummary } from "$lib/query/ask-ai-db";
  import { dbAiLevelOf } from "$lib/app/db-ai.svelte.js";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { comboFromEvent, effectiveCombo, resolveBindings } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { toast } from "$lib/toast.svelte.js";
  import type { KeptPick } from "$lib/query/ResultChart.svelte";

  /**
   * 쿼리 타일의 몸통 — 상태와 동작은 `query/query-session` · `query/script-controller` 이고, 효과 · 리스너 · 수명은 여기다.
   * 연결 · 쓰기 모드 · 자동 커밋 · 트랜잭션 작업 · 도는 실행은 연결 하나에 하나라 모든 탭이 같이 쓴다.
   * `Ctrl+T` · `Ctrl+W` 는 이 타일에 포커스가 있을 때만이고, 같은 조합을 전역 단축키에 묶었으면 전역이 이긴다.
   * 데이터 탭의 조회는 늘 읽기 전용이다(`db_query{readOnly}` — 서버가 가드 · 엔진 모두, 열린 작업이면 거절).
   *
   * ## 수명
   * - `stream`(영속 키 `tileKey`)으로 다시 열면 서버가 떼어 둔(10분) 연결에 다시 붙는다(`reattached` — 비밀번호를 다시 묻지 않는다).
   * - 타일 닫기는 임대를 실어 `db_close` 한다 — 다른 창이 먼저 다시 붙었으면 서버가 낡은 임대로 보고 닫지 않는다. 이관(`isHandoff`)은
   *   닫지 않는다(받는 창이 같은 열쇠로 다시 붙는다).
   * - 끊긴 뒤에도 마지막 손잡이 · 임대(`lost`)를 기억한다 — 그대로 닫으면 서버 표에 남은 끊긴 칸을 거둔다. 다시 연결은 새 연결이다.
   *
   * ## 알림
   * 실행의 답이 실어 온 사건은 그 실행을 보낸 탭에, 그 밖의 연결 사건(방치 되돌림 · 끊김 · [커밋] · [되돌리기] 의 답)은 그 순간 보고
   * 있는 탭에 내린다 — 작업은 연결에 하나라 어느 탭의 것도 아니다.
   *
   * ## 실행
   * 결과는 실행을 보낸 탭에 내린다. 거터는 보낸 뒤 글이 그대로일 때만 칠하고, 글을 고치거나 다시 실행하면 지운다.
   *
   * AI 에 묻기는 AI 타일 입력 줄에 붙여 넣기만 한다(Enter 없음) — 결과 행의 값은 넣지 않는다(근거는 `query/ask-ai-db`). 연결의 AI 권한이
   * 끔이면 넘기지 않고 켜는 곳을 알린다 — 직접 켜지는 않는다.
   */
  let {
    pane,
    visible = true,
    onmenu,
  }: {
    pane: PaneSpec;
    visible?: boolean;
    onmenu?: GridTileMenu;
  } = $props();
  setContext<GridTileMenu>(GRID_TILE_MENU, (x, y, menu) => onmenu?.(x, y, menu));

  // (svelte-ignore: 처음 한 번의 값만 쓴다) 서버 DB 연결 표의 열쇠라 타일 수명 동안 바뀌지 않는다 — 리로드 뒤에도 같은 연결에 붙는다
  // svelte-ignore state_referenced_locally
  const stream = queryStreamOf(pane);
  const spec = $derived(pane.query ?? { connId: "" });

  let engine = $state<DbEngine | null>(null);
  let disposed = false;

  // ── 스크립트 탭 ─────────────────────────────────────────────────────────

  const sc = createScriptTabs({
    get pane() {
      return pane;
    },
    stream,
    get editor() {
      return editor;
    },
    get disposed() {
      return disposed;
    },
    dropResults(n) {
      ses.dropResults(n);
      delete resultViews[n];
    },
  });

  // ── 세션 ────────────────────────────────────────────────────────────────

  const ses = createQuerySession({
    get pane() {
      return pane;
    },
    stream,
    get spec() {
      return spec;
    },
    get editor() {
      return editor;
    },
    get disposed() {
      return disposed;
    },
    get maxRows() {
      return maxRows;
    },
    sc,
    showResultTab() {
      outTab = "result";
    },
  });
  const dialect = $derived<DbDialect>(ses.opened?.dialect ?? (engine === "postgres" ? "postgres" : engine === "sqlite" || engine === null ? "sqlite" : "mysql"));

  let unlistenState: UnlistenFn | null = null;

  onMount(() => {
    void ses.open();
    void listen<{ stream?: string; state?: string; tx?: DbTxView }>("db-state", (ev) => {
      if (ev.payload?.stream !== stream) return;
      if (ev.payload.state === "tx") {
        if (ses.conn.state === "open") ses.seeTx(ev.payload.tx);
        return;
      }
      if (ev.payload.state !== "disconnected") return;
      ses.lostTx();
      if (ses.conn.state === "open") ses.loseConn("disconnected", t("pane.query.disconnected"));
    }).then((u) => {
      if (disposed) u();
      else unlistenState = u;
    });
    void queryConnLabel($state.snapshot(spec)).then((l) => {
      if (disposed || !l) return;
      engine = l.engine;
      noteQueryName(pane.id, l.name);
    });
  });

  onDestroy(() => {
    disposed = true;
    unlistenState?.();
    noteDbTx(pane.id, null);
    noteQueryLive(pane.id, null);
    ses.stopTimers();
    sc.flushPending();
    ses.release();
  });

  // ── 실행 ─────────────────────────────────────────────────────────────────

  let editor = $state<ReturnType<typeof SqlEditor> | null>(null);
  let tree = $state<ReturnType<typeof SchemaTree> | null>(null);
  let outEl = $state<HTMLElement | null>(null);
  let dataEl = $state<HTMLElement | null>(null);

  /** SQL 편집기 안의 `Ctrl+F` 는 편집기가 먼저 받는다(`editorOwnsKey`). 트리도 없으면 `false` — 모든 터미널 검색으로 떨어진다 */
  function openFind(): boolean {
    const el = document.activeElement;
    if (outEl && el instanceof Element && outEl.contains(el) && openFindZoneIn(outEl)) return true;
    if (dataEl && el instanceof Element && dataEl.contains(el) && openFindZoneIn(dataEl)) return true;
    if (treeLayout.narrow) {
      if (!ses.opened) return false;
      if (!treeDrop) openTreeDrop();
      if (!treeDrop) return false;
      void tick().then(() => tree?.focusFilter());
      return true;
    }
    if (!tree) return false;
    tree.focusFilter();
    return true;
  }

  $effect(() => {
    const id = pane.id;
    return untrack(() => registerTileFind(id, openFind));
  });

  // 열린 작업의 시계는 표시만 — 경고 · 되돌림은 서버 이벤트로 온다.
  $effect(() => {
    ses.syncTxClock();
  });
  $effect(() => noteDbTx(pane.id, txOpen(ses.tx) ? (ses.tx?.view.statements ?? 0) : null));

  // ── 행 상한 ─────────────────────────────────────────────────────────────

  const maxRows = $derived<QueryRowLimit>(pane.query?.maxRows ?? QUERY_ROWS_DEFAULT);
  const rowItems = $derived(QUERY_ROW_LIMITS.map((n) => ({ value: String(n), label: t("pane.query.rows.option", { n: n.toLocaleString() }) })));
  function pickRows(v: string) {
    const n = Number(v);
    if ((QUERY_ROW_LIMITS as readonly number[]).includes(n)) noteQueryMaxRows(pane.id, n as QueryRowLimit);
  }
  /** 결과 칸의 [표 | 차트] · 고른 축 — 실행 중에는 `RunResults` 가 새로 서므로 스크립트 탭마다 여기 둔다(저장 안 함) */
  const resultViews = $state<Record<number, { view?: "grid" | "chart"; chartPick?: KeptPick }>>({});
  const rowLimit = $derived<RowLimitProps>({ value: String(maxRows), options: rowItems, disabled: ses.running !== null, onchange: pickRows });

  // ── 스키마 트리 ─────────────────────────────────────────────────────────

  let treeExpanded = $state<string[]>([]);

  /** 트리가 서버에서 읽는 중 — 서버는 연결당 작업 하나라 데이터 탭이 그 사이 조회를 미룬다 */
  let treeReading = $state(false);

  function openData(obj: TreeRelation) {
    sc.openData({ kind: obj.kind, ...(obj.schema !== null ? { schema: obj.schema } : {}), name: obj.name });
  }

  function selectInto(obj: TreeRelation) {
    const sql = selectStarSql(dialect, obj.schema, obj.name);
    if (activeData || noTab) {
      sc.openSql(sql);
      return;
    }
    if (ses.running || !editor) return;
    editor.setText(sql);
  }

  // ── 데이터 탭 ───────────────────────────────────────────────────────────
  const activeData = $derived(sc.activeTab?.data ?? null);
  const noTab = $derived(sc.tabs.length === 0);
  const sqlHidden = $derived(activeData !== null || noTab);
  let emptyNewBtn = $state<HTMLButtonElement | null>(null);
  // 마지막 탭을 닫으면 포커스가 `body` 로 빠져 타일의 `Ctrl+T` · `Ctrl+O` 가 닿지 않는다 — 선택된 타일일 때만 [새 쿼리] 로 옮긴다.
  $effect(() => {
    if (!noTab || !emptyNewBtn) return;
    if (untrack(() => focusedPane()?.id === pane.id)) emptyNewBtn.focus();
  });
  /** 닫은 탭의 화면이 빠지면 포커스가 `body` 로 떨어진다 — 선택된 타일이고 포커스가 `body`(또는 이 타일 안)일 때만 되돌린다 */
  function refocusAfterClose() {
    void tick().then(() => {
      if (!rootEl || noTab || focusedPane()?.id !== pane.id) return;
      const a = document.activeElement;
      if (a && a !== document.body && !rootEl.contains(a)) return;
      if (activeData) {
        // 숨은 편집기(`.gone`)도 DOM 에 살아 포커스가 그 안에 남았다가 `body` 로 빠진다 — 그래서 "보이는 탭 안" 으로 가른다.
        const shown = dataEl?.querySelector<HTMLElement>(".data-tab.on");
        if (!shown?.contains(a)) rootEl.focus({ preventScroll: true });
      } else editor?.focus();
    });
  }
  async function closeTabHere(n: number) {
    await sc.closeTabN(n);
    refocusAfterClose();
  }
  function ensureSqlTab() {
    if (noTab) sc.newTab();
  }
  /** 한 번 보인 데이터 탭은 숨어도 산다(쪽 · 결과 유지) */
  let dataSeen = $state<number[]>([]);
  $effect(() => {
    const n = sc.activeN;
    if (activeData && !untrack(() => dataSeen).includes(n)) dataSeen = [...untrack(() => dataSeen), n];
  });
  const dataTabs = $derived(sc.tabs.filter((x) => x.data && dataSeen.includes(x.n)));

  function insertName(text: string) {
    ensureSqlTab();
    editor?.insert(text);
  }

  function onTreeFail(message: string) {
    ses.lostIfReopen(message);
  }

  // ── DDL 보기 ────────────────────────────────────────────────────────────

  let definition = $state<{ target: DbDefinitionTarget; load: Load<DbDefinition> } | null>(null);
  let outTab = $state<"result" | "definition">("result");
  let defSeq = 0;

  async function showDefinition(target: DbDefinitionTarget) {
    const o = ses.opened;
    if (!o) return;
    outTab = "definition";
    if (definition && sameTarget(definition.target, target) && definition.load.state !== "error") return;
    // 쿼리가 도는 동안은 서버가 Busy 로 거절한다 — 그 문구가 그대로 보인다.
    const seq = ++defSeq;
    definition = { target, load: { state: "loading" } };
    try {
      const v = await dbDefinition(o.handle, o.lease, target);
      if (!disposed && seq === defSeq) definition = { target, load: { state: "ok", value: v } };
    } catch (e) {
      const m = errorMessage(e);
      if (disposed || seq !== defSeq) return;
      if (!ses.lostIfReopen(m)) definition = { target, load: { state: "error", message: stripReason(m) } };
    }
  }

  function closeDefinition() {
    defSeq++;
    definition = null;
    outTab = "result";
  }

  let treeMenu = $state<{ target: DbDefinitionTarget; title: string; rel: TreeRelation | null; x: number; y: number } | null>(null);
  function openTreeMenu(ev: MouseEvent, target: DbDefinitionTarget, title: string, rel: TreeRelation | null) {
    treeMenu = { target, title, rel, x: ev.clientX, y: ev.clientY };
  }
  const closeTreeMenu = () => (treeMenu = null);

  // ── `.sql` 파일 열기 · 저장 ─────────────────────────────────────────────

  const openSqlFile = (title: string | undefined, text: string) => (disposed ? true : sc.openFile(title, text));
  async function pickSqlFiles() {
    const sources = await pickSqlSources();
    if (!disposed && sources.length > 0) await openSqlSources(sources, openSqlFile);
  }
  function saveTabSql(n: number) {
    const x = sc.tabs.find((y) => y.n === n);
    const text = sc.liveText(n);
    if (!x || text === null) return;
    void saveSqlText(sqlSaveName(sc.tabLabel(x)), text);
  }

  let tabMenu = $state<{ n: number; title: string; data: boolean; x: number; y: number } | null>(null);
  function openTabMenu(ev: MouseEvent, n: number) {
    const x = sc.tabs.find((y) => y.n === n);
    if (!x) return;
    tabMenu = { n, title: sc.tabLabel(x), data: !!x.data, x: ev.clientX, y: ev.clientY };
  }
  const closeTabMenu = () => (tabMenu = null);

  const dataRefs: Record<number, ReturnType<typeof DataTab> | undefined> = {};
  function onWindowF5(ev: KeyboardEvent) {
    const what = tileRefreshOf(ev, {
      selected: visible && focusedPane()?.id === pane.id,
      modal: anyModalOpen(),
      dataTab: activeData !== null,
    });
    if (!what) return;
    ev.preventDefault();
    if (ev.repeat) return;
    if (what === "data") dataRefs[sc.activeN]?.refresh();
    else tree?.refresh();
  }

  // **캡처 단계**에서 받는다 — 편집기(CodeMirror)가 놓인 파일을 제 글에 끼워 넣기 전에. `dragover` 는 전파를 끊지 않는다 — 타일 층
  // (`PaneHost`)이 다른 타일에 그린 하이라이트를 거두게.
  let fileDrop = $state(false);
  function onFileDragOver(ev: DragEvent) {
    if (!sqlDropAccepts(ev.dataTransfer?.types)) {
      fileDrop = false;
      return;
    }
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    fileDrop = true;
  }
  function onFileDragLeave(ev: DragEvent) {
    const to = ev.relatedTarget;
    if (to instanceof Node && rootEl?.contains(to)) return;
    fileDrop = false;
  }
  function onFileDrop(ev: DragEvent) {
    fileDrop = false;
    if (!sqlDropAccepts(ev.dataTransfer?.types)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const sources = dropSources(ev.dataTransfer);
    if (sources.length > 0) void openSqlSources(sources, openSqlFile);
  }

  function defineFromTree(d: DbDefinitionTarget) {
    const fromDrop = treeDrop !== null;
    closeTreeDrop();
    ensureSqlTab();
    void showDefinition(d);
    if (fromDrop) editor?.focus();
  }

  // ── 배치 — 트리 폭 · 편집기 높이(타일 메모리에만) ──────────────────────

  let width = $state(0);
  let workW = $state(0);
  let bodyH = $state(0);
  let treeW = $state(220);
  let treeOpen = $state<boolean | null>(null); // null = 자동(좁으면 접힘)
  // `treeW` 는 사람이 원하는 폭이고, 타일이 좁으면 그려지는 상자(`queryTreeLayout`)는 그보다 줄어든다.
  const treeLayout = $derived(queryTreeLayout({ treeOpen, width, treeW }));
  const treeShown = $derived(treeLayout.shown);
  /** 사람이 토글을 누른 때만 `mark` 한다 — 폭 문턱에 저절로 숨고 돌아오기 · 떠 있는 패널은 움직임 없이 선다 */
  const treeMotionGate = createToggleMotion();
  const TREE_MOTION = "query-tree";

  // ── 좁은 타일의 떠 있는 스키마 트리 ─────────────────────────────────────
  // 그리는 곳은 `.query` 밖이다 — 컨테이너 `qtile` 이 고정 위치의 기준이 되지 않게(`TreeMenu` 와 같은 까닭).

  let treeDrop = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  // 트리가 서 있을 때만 센다 — 읽는 도중 숨은 트리의 값이 남아 데이터 탭이 영영 기다리지 않게
  const treeBusyReading = $derived(treeReading && (treeShown || treeDrop !== null));
  // 데이터 탭이 표 구조를 읽는 중 — 서버는 연결당 작업 하나라 트리 · 다른 데이터 탭이 기다린다
  let dataMeta = $state(0);

  const completer = createSqlCompleter({
    dialect: () => dialect,
    conn: () => ses.opened,
    canRead: () => ses.opened !== null && ses.running === null && !ses.txBusy && !ses.switching && !treeBusyReading && dataMeta === 0,
    onread: (on) => (dataMeta = Math.max(0, dataMeta + (on ? 1 : -1))),
  });
  let treeDropButton = $state<HTMLButtonElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);

  function openTreeDrop() {
    const r = treeDropButton?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(TREE_DROP_W, window.innerWidth - 2 * DROPDOWN_MARGIN);
    const y = r.bottom + DROPDOWN_GAP;
    // 줄이 몇 개든 같은 높이라 펼쳐도 상자가 튀지 않는다
    const bottom = Math.min(rootEl?.getBoundingClientRect().bottom ?? window.innerHeight, window.innerHeight - DROPDOWN_MARGIN);
    treeDrop = {
      x: Math.max(DROPDOWN_MARGIN, Math.min(r.left, window.innerWidth - w - DROPDOWN_MARGIN)),
      y,
      w,
      h: Math.max(160, Math.min(480, bottom - y - 4)),
    };
  }

  function closeTreeDrop() {
    treeDrop = null;
  }

  function treeDropKey(ev: KeyboardEvent) {
    if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeTreeDrop();
    treeDropButton?.focus();
  }

  $effect(() => {
    if (!treeLayout.narrow) untrack(() => (treeDrop = null));
  });
  let editorPct = $state(40);

  function dragTree(ev: PointerEvent) {
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const w0 = treeLayout.boxW; // 그려진 상자에서 출발한다 — 원하는 폭(`treeW`)이 아니라 보이는 경계가 움직여야 한다
    const move = (e: PointerEvent) => (treeW = Math.max(140, Math.min(Math.max(160, width * 0.5), w0 + e.clientX - x0)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function dragSplit(ev: PointerEvent) {
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const y0 = ev.clientY;
    const p0 = editorPct;
    const move = (e: PointerEvent) => {
      if (bodyH <= 0) return;
      editorPct = Math.max(15, Math.min(85, p0 + ((e.clientY - y0) / bodyH) * 100));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function splitKey(ev: KeyboardEvent, which: "tree" | "split") {
    const step = ev.shiftKey ? 10 : 2;
    if (which === "tree" && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
      ev.preventDefault();
      treeW = Math.max(140, Math.min(600, treeLayout.boxW + (ev.key === "ArrowLeft" ? -step * 5 : step * 5)));
    } else if (which === "split" && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      editorPct = Math.max(15, Math.min(85, editorPct + (ev.key === "ArrowUp" ? -step : step)));
    }
  }

  // 방언은 MySQL · MariaDB 가 하나(`mysql`)라 MariaDB 는 서버 버전 글자로 이름을 단다.
  const engineLabel = $derived(
    ses.opened?.serverVersion?.startsWith("MariaDB")
      ? t("app.query.engine.mariadb")
      : ses.opened
        ? t(`pane.query.dialect.${ses.opened.dialect}` as "pane.query.dialect.sqlite")
        : engine
          ? t(`app.query.engine.${engine}` as "app.query.engine.sqlite")
          : "",
  );
  $effect(() => {
    noteQueryLive(pane.id, {
      state: ses.conn.state,
      serverVersion: ses.opened?.serverVersion || null,
      dialect: ses.opened?.dialect ?? null,
      writable: ses.opened?.writable === true,
      autoCommit: ses.opened?.autoCommit,
    });
  });
  const sqlLang = $derived(ses.opened ? `sql-${ses.opened.dialect}` : null);

  const chipParts = $derived<ChipParts | null>(
    ses.txSupported && ses.opened && ses.chip
      ? {
          name: t("pane.query.tx.chip.name"),
          stmts: t("pane.query.tx.chip.stmts", { n: ses.chip.statements }),
          time: ses.chip.warn ? t("pane.query.tx.warn", { left: formatClock(ses.chip.idleLeftMs) }) : ses.chip.elapsed,
          warn: ses.chip.warn,
        }
      : null,
  );
  const fit = $derived(
    fitRunLine({
      width: workW,
      pill: ses.pill.writable ? t("pane.query.write") : t("pane.query.readOnly"),
      mode: ses.acToggle.shown
        ? {
            long: [t("pane.query.commitMode.auto"), t("pane.query.commitMode.manual")],
            short: [t("pane.query.commitMode.auto"), t("pane.query.commitMode.manual.short")],
          }
        : null,
      tx: ses.txShown
        ? { begin: t("pane.query.tx.begin.short"), commit: t("pane.query.tx.commit"), rollback: t("pane.query.tx.rollback"), working: ses.chip !== null }
        : null,
      chip: chipParts,
      extend: ses.txb.extend.shown ? t("pane.query.tx.extend") : null,
      ask: true,
      elapsed: ses.running ? "00.0s" : null,
      script: ses.scriptSupported && ses.opened ? t("pane.query.script") : null,
      run: ses.running ? t("pane.query.cancel") : t("pane.query.run"),
    }),
  );
  const chipLabel = $derived(chipParts ? chipText(chipParts, fit) : "");

  // ── AI 에 묻기 ──────────────────────────────────────────────────────────
  let askBtn = $state<HTMLButtonElement | null>(null);
  const askLevel = $derived(dbAiLevelOf(spec.connId));
  const askCombo = $derived(effectiveCombo("ask-ai-block", settings.current.keybindings));

  function lastError(): string | null {
    const outcome = ses.outcome;
    if (outcome.kind === "error") return outcome.message;
    if (outcome.kind === "script") return outcome.r.failed?.message ?? outcome.r.message ?? null;
    return null;
  }

  function askAi(): void {
    const name = findDbConn(spec.connId)?.name ?? title;
    if (askLevel === "off") {
      toast.info(t("pane.query.ask.off", { name }), {
        ms: 8000,
        action: { label: t("pane.query.ask.off.open"), run: () => void openConnForm({ id: spec.connId }) },
      });
      return;
    }
    // 결과 행은 넣지 않는다
    const whole = activeData ? dataSelectSql(dialect, activeData, 0, pageSizeOf(activeData), false) : (editor?.getText() ?? "");
    const sel = activeData ? { from: 0, to: 0 } : (editor?.selection() ?? { from: 0, to: 0 });
    const picked = sel.to > sel.from ? whole.slice(sel.from, sel.to) : "";
    const sql = picked.trim() !== "" ? picked : whole;
    const text = buildDbAskText(
      {
        connId: spec.connId,
        connName: name,
        engine: engineLabel || (engine ?? ""),
        database: findDbConn(spec.connId)?.database ?? null,
        level: askLevel,
        sql,
        selection: picked.trim() !== "",
        error: lastError(),
      },
      t,
    );
    const r = askBtn?.getBoundingClientRect();
    const anchor = r
      ? { x: r.right, y: r.bottom + 4, align: "right" as const }
      : { x: window.innerWidth / 2 - 190, y: window.innerHeight / 3, align: "left" as const };
    askAiWithText(pane.id, text, dbAskSummary(name, sql), anchor, false);
  }

  /** 같은 조합이 전역 단축키에 묶여 있으면 전역이 이긴다 */
  const TAB_NEW = "Ctrl+KeyT";
  const TAB_CLOSE = "Ctrl+KeyW";
  /** 브라우저 기본 동작(파일 열기 · 페이지 저장)도 여기서 끊는다 */
  const FILE_OPEN = "Ctrl+KeyO";
  const FILE_SAVE = "Ctrl+KeyS";
  const globalCombos = $derived(resolveBindings(settings.current.keybindings).global);

  function onTileKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    const combo = comboFromEvent(ev);
    if (!combo) return;
    if (askCombo && combo === askCombo) {
      ev.preventDefault();
      ev.stopPropagation();
      askAi();
      return;
    }
    if ((combo === TAB_NEW || combo === TAB_CLOSE) && !globalCombos.has(combo) && sc.renaming === null) {
      ev.preventDefault();
      ev.stopPropagation();
      if (combo === TAB_NEW) sc.newTab();
      else void closeTabHere(sc.activeN);
      return;
    }
    // 데이터 탭이 보이는 중의 `Ctrl+S` 는 받지 않는다(창 키가 브라우저 기본 동작만 끊는다)
    if ((combo === FILE_OPEN || (combo === FILE_SAVE && !activeData)) && !globalCombos.has(combo) && sc.renaming === null) {
      ev.preventDefault();
      ev.stopPropagation();
      if (combo === FILE_OPEN) void pickSqlFiles();
      else saveTabSql(sc.activeN);
    }
  }
  const title = $derived(paneName(pane, t));
  const connLabel = $derived(
    ses.conn.state === "connecting" ? t("pane.query.state.connecting") : ses.conn.state === "open" ? t("pane.query.state.open") : t("pane.query.state.closed"),
  );
  const noteTone = $derived(
    ses.note === null
      ? null
      : ses.note.key === "pane.query.tx.ended.committed"
        ? "ok"
        : ses.note.key === "pane.query.tx.ended.rolledBack"
          ? "info"
          : "err",
  );
  const runShown = $derived<RunShown | null>(ses.outcome.kind === "result" || ses.outcome.kind === "script" || ses.outcome.kind === "error" ? ses.outcome : null);
  // 머리줄이 서 있으면 위 줄이 머리줄로 올라간다(없으면 — 설정 `tile_header` · 폰 — 몸 맨 위에). 머리줄 무리가 사이드바 경계까지
  // 쥐던 규칙(`span`)과 연결 점은 걷었다(사용자 결정) — 연결 중만 로고 자리의 고리(`iconBusy`), 끊김은 몸의 배너가 말한다.
  const inHead = $derived(paneHeadShown(pane.id));
  $effect(() =>
    setPaneTools(pane.id, {
      bar: queryBar,
      tail: queryToggle,
      iconBusy: () => (ses.conn.state === "connecting" ? connLabel : null),
      menu: () => [{ action: "tool:open-sql", label: t("pane.query.file.open"), icon: "folder-open", hint: "Ctrl+O" }],
      run: (key) => {
        if (key === "open-sql") void pickSqlFiles();
      },
    }),
  );
</script>

{#snippet queryToggle()}
  {@render treeToggle(true)}
{/snippet}

{#snippet treeToggle(head: boolean)}
  {#if treeLayout.narrow}
    <button
      type="button"
      class={head ? "tree-toggle inhead drop" : "btn icon tree-toggle drop"}
      data-head-act
      bind:this={treeDropButton}
      title={treeDrop ? t("pane.query.tree.hide") : t("pane.query.tree.show")}
      aria-label={t("pane.query.tree.drop")}
      aria-haspopup="dialog"
      aria-expanded={treeDrop !== null}
      data-query-tree-drop-toggle
      onclick={() => (treeDrop ? closeTreeDrop() : openTreeDrop())}
      ><UiIcon name="side-panel" size={head ? 14 : 13} /><UiIcon name="chevron-down" size={12} /></button
    >
  {:else}
    <button
      type="button"
      class={head ? "tree-toggle inhead" : "btn icon tree-toggle"}
      data-head-act
      aria-pressed={treeShown}
      title={treeShown ? t("pane.query.tree.hide") : t("pane.query.tree.show")}
      aria-label={treeShown ? t("pane.query.tree.hide") : t("pane.query.tree.show")}
      onclick={() => {
        treeMotionGate.mark(TREE_MOTION);
        treeOpen = !treeShown;
      }}><UiIcon name="side-panel" size={head ? 14 : 13} /></button
    >
  {/if}
{/snippet}

{#snippet queryBar(head: boolean)}
  <ScriptTabs
    {head}
    {treeToggle}
    tabs={sc.tabs}
    activeN={sc.activeN}
    renaming={sc.renaming}
    bind:renameText={sc.renameText}
    conn={ses.conn}
    {connLabel}
    tabLabel={sc.tabLabel}
    dirtyOf={sc.dirtyOf}
    tabDragStart={sc.tabDragStart}
    tabDragOver={sc.tabDragOver}
    tabDrop={sc.tabDrop}
    pickTab={sc.pickTab}
    startRename={sc.startRename}
    endRename={sc.endRename}
    closeTabN={closeTabHere}
    onTabKey={sc.onTabKey}
    newTab={sc.newTab}
    tabMenu={openTabMenu}
  />
{/snippet}

<svelte:window onkeydown={onWindowF5} />

<!-- data-* 는 하네스 손잡이(상태 · 다시 붙었나 · 핸들) — 값이 아니라 표식이다 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="query"
  data-query-pane={pane.id}
  data-query-state={ses.conn.state}
  data-query-reattached={ses.opened?.reattached ? "" : undefined}
  data-query-handle={ses.opened?.handle}
  bind:clientWidth={width}
  bind:this={rootEl}
  data-tile-focus
  tabindex="-1"
  onkeydown={onTileKey}
  ondragovercapture={onFileDragOver}
  ondragleave={onFileDragLeave}
  ondropcapture={onFileDrop}
>
  {#if !inHead}{@render queryBar(false)}{/if}
  {#if fileDrop}
    <div class="file-drop" aria-hidden="true" data-query-file-drop>
      <span class="file-drop-card">
        <span class="file-drop-main">{t("pane.query.file.drop")}</span>
        <span class="file-drop-sub">{t("pane.query.file.drop.sub")}</span>
      </span>
    </div>
  {/if}

  {#if ses.conn.state === "closed"}
    <div class="banner" role="alert" data-query-banner={ses.conn.kind}>
      <span class="msg">{ses.conn.message}</span>
      {#if ses.conn.kind !== "outdated"}
        <button type="button" class="btn" onclick={() => void ses.open()} data-query-reopen
          >{ses.conn.kind === "reopen" ? t("pane.query.reopen") : t("pane.query.reconnect")}</button
        >
      {/if}
    </div>
  {/if}

  <div class="main">
    {#if treeShown}
      <!-- Svelte 전환은 기본이 local 이라 여닫히는 `{#if}` 에 바로 든 요소여야 돈다 — 그래서 `.side` + `.vsplit` 을 이 상자로 묶는다 -->
      <div class="tree-side" transition:sidePanelGrow={{ motion: treeMotionGate, key: TREE_MOTION }}>
        <SchemaPane
          treeDrop={null}
          {treeLayout}
          opened={ses.opened}
          conn={ses.conn}
          busy={ses.running !== null || ses.txBusy || ses.switching || dataMeta > 0}
          bind:tree
          bind:treeExpanded
          bind:treeReading
          {openData}
          {insertName}
          {onTreeFail}
          {defineFromTree}
          {openTreeMenu}
          {closeTreeDrop}
          {treeDropKey}
          {dragTree}
          {splitKey}
          oncatalog={completer.note}
        />
      </div>
    {/if}
    <div class="work" bind:clientHeight={bodyH} bind:clientWidth={workW}>
      {#if dataTabs.length > 0}
        <div class="data-tabs" class:shown={activeData !== null} bind:this={dataEl}>
          {#each dataTabs as x (x.n)}
            <div class="data-tab" class:on={x.n === sc.activeN}>
              <DataTab
                bind:this={dataRefs[x.n]}
                n={x.n}
                data={x.data!}
                {dialect}
                opened={ses.opened}
                visible={x.n === sc.activeN && visible}
                waiting={ses.runOff || treeBusyReading || dataMeta > 0}
                treeReading={treeBusyReading}
                inWork={txOpen(ses.tx)}
                running={ses.running?.tab === x.n}
                runData={ses.runData}
                oncancel={ses.cancel}
                onchange={(d) => sc.setData(x.n, d)}
                onopensql={sc.openSql}
                onlost={ses.lostIfReopen}
                onmeta={(on) => (dataMeta = Math.max(0, dataMeta + (on ? 1 : -1)))}
                onfollow={(f) => sc.openDataWhere({ schema: f.schema, name: f.name }, f.where)}
                onopendata={(o) => sc.openData({ kind: "table", ...(o.schema !== null ? { schema: o.schema } : {}), name: o.name })}
                poke={sc.dataPoke(x.n)}
              />
            </div>
          {/each}
        </div>
      {/if}
      <div class="ed" style:height="{editorPct}%" class:gone={sqlHidden}>
        <SqlEditor
          bind:this={editor}
          docKey={docKey(sc.activeTab?.n ?? NO_TAB)}
          initial={sc.activeTab?.text ?? ""}
          lang={sqlLang}
          onrun={() => void completer.idle().then(() => ses.run())}
          onscript={() => void completer.idle().then(() => ses.runScript())}
          oncancel={ses.cancel}
          onchange={sc.onDraft}
          complete={completer.complete}
        />
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="hsplit"
        class:gone={sqlHidden}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("pane.query.split.resize")}
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(editorPct)}
        tabindex="0"
        onpointerdown={dragSplit}
        onkeydown={(ev) => splitKey(ev, "split")}
      ></div>
      {#if !sqlHidden}
      <RunBar
        pill={ses.pill}
        {fit}
        acToggle={ses.acToggle}
        txShown={ses.txShown}
        txb={ses.txb}
        txSupported={ses.txSupported}
        opened={ses.opened}
        chip={ses.chip}
        {chipLabel}
        tx={ses.tx}
        {askLevel}
        {askCombo}
        bind:askBtn
        running={ses.running}
        elapsed={ses.elapsed}
        scriptSupported={ses.scriptSupported}
        runOff={ses.runOff}
        scriptTitle={ses.scriptTitle}
        onPill={ses.onPill}
        onModeKey={ses.onModeKey}
        setAutoCommit={ses.setAutoCommit}
        txCall={ses.txCall}
        {askAi}
        runScript={() => completer.idle().then(() => ses.runScript())}
        cancel={ses.cancel}
        run={() => completer.idle().then(() => ses.run())}
      />
      {/if}
      {#if definition && !sqlHidden}
        <div class="out-tabs" role="tablist" aria-label={t("pane.query.def.tabs")}>
          <button
            type="button"
            class="otab"
            role="tab"
            aria-selected={outTab === "result"}
            onclick={() => (outTab = "result")}
            data-query-tab="result">{t("pane.query.def.tab.result")}</button
          >
          <span class="otab-pair" class:on={outTab === "definition"}>
            <button
              type="button"
              class="otab"
              role="tab"
              aria-selected={outTab === "definition"}
              onclick={() => (outTab = "definition")}
              data-query-tab="definition">{t("pane.query.def.tab.definition")}</button
            ><button
              type="button"
              class="otab-x"
              title={t("pane.query.def.tab.close")}
              aria-label={t("pane.query.def.tab.close")}
              onclick={closeDefinition}
              data-query-def-close><UiIcon name="close" size={10} /></button
            >
          </span>
        </div>
      {/if}
      <div class="out" class:gone={sqlHidden} bind:this={outEl}>
        {#if ses.note && !(definition && outTab === "definition")}
          <div
            class="note-line tone-{noteTone}"
            role={ses.note.level === "alert" ? "alert" : "status"}
            data-query-tx-note={ses.note.key.split(".").pop()}
          >
            <span class="note-icon" aria-hidden="true"
              ><UiIcon name={noteTone === "ok" ? "check" : noteTone === "info" ? "undo" : "alert-caution"} size={14} /></span
            >
            <span class="msg"
              >{t(ses.note.key, { n: ses.note.statements })}{#if ses.note.message}<span class="tx-why">{ses.note.message}</span>{/if}</span
            >
            <button type="button" class="btn" onclick={() => (ses.notes[sc.activeN] = null)} data-query-tx-dismiss>{t("pane.query.tx.ended.dismiss")}</button>
          </div>
        {/if}
        {#if definition && outTab === "definition"}
          {#key definition.target}
            <DefinitionView target={definition.target} {dialect} load={definition.load} oninsert={(sql) => editor?.insertBlock(sql)} />
          {/key}
        {:else if runShown}
          <RunResults
            shown={runShown}
            name={sc.activeTab ? sc.tabLabel(sc.activeTab) : ""}
            limit={rowLimit}
            begin={ses.txb.begin.shown ? { disabled: ses.txb.begin.disabled, onclick: () => void ses.txCall("begin") } : null}
            onlocate={ses.locate}
            bind:view={() => resultViews[sc.activeN]?.view, (v) => (resultViews[sc.activeN] = { ...resultViews[sc.activeN], view: v })}
            bind:chartPick={
              () => resultViews[sc.activeN]?.chartPick, (p) => (resultViews[sc.activeN] = { ...resultViews[sc.activeN], chartPick: p })
            }
          />
        {:else if ses.outcome.kind === "cancelled"}
          <p class="out-note" data-query-cancelled>{t("pane.query.cancelled")}</p>
        {:else if ses.outcome.kind === "nothing"}
          <p class="out-note">{t("pane.query.nothing")}</p>
        {:else}
          <div class="out-note hint">
            {#if ses.running?.tab === sc.activeN}
              <p>{t("pane.query.running")}</p>
            {:else}
              <p class="keys">
                <span><Keys combo="Ctrl+Enter" />{t("pane.query.run")}</span>
                <span><Keys combo="Alt+X" />{t("pane.query.script")}</span>
                <span><Keys combo="Esc" />{t("pane.query.cancel")}</span>
                <span><Keys combo="Ctrl+T" />{t("pane.query.tab.add")}</span>
              </p>
            {/if}
            {#if txOpen(ses.tx) || ses.opened?.writable}
              <p class="safety on">
                {txOpen(ses.tx) ? t("pane.query.tx.hint") : ses.acOff ? t("pane.query.autoCommit.hint") : t("pane.query.write.hint")}
              </p>
            {/if}
          </div>
        {/if}
      </div>
      {#if !(definition && outTab === "definition") && !runShown && !sqlHidden}
        <RowLimit {...rowLimit} line />
      {/if}
      {#if noTab}
        <div class="empty" data-query-empty>
          <p class="empty-title">{t("pane.query.empty.title")}</p>
          <div class="empty-acts">
            <button type="button" class="empty-btn primary" bind:this={emptyNewBtn} onclick={sc.newTab} data-query-empty-new
              ><UiIcon name="plus" size={13} /><span>{t("pane.query.empty.new")}</span><span class="empty-kbd">Ctrl+T</span></button
            >
            <button type="button" class="empty-btn" onclick={() => void pickSqlFiles()} data-query-empty-open
              ><span>{t("pane.query.empty.open")}</span><span class="empty-kbd">Ctrl+O</span></button
            >
          </div>
          <p class="empty-hint">{t("pane.query.empty.hint")}</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- `.query` 밖(우클릭 메뉴와 같은 까닭) — 우클릭 메뉴(`TreeMenu` — z 40/41)가 이 위에 뜬다 -->
{#if treeDrop}
  <SchemaPane
    {treeDrop}
    {treeLayout}
    opened={ses.opened}
    conn={ses.conn}
    busy={ses.running !== null || ses.txBusy || ses.switching || dataMeta > 0}
    bind:tree
    bind:treeExpanded
    bind:treeReading
    {openData}
    {insertName}
    {onTreeFail}
    {defineFromTree}
    {openTreeMenu}
    {closeTreeDrop}
    {treeDropKey}
    {dragTree}
    {splitKey}
    oncatalog={completer.note}
  />
{/if}

<!-- 트리의 우클릭 메뉴 — 고정 위치가 타일 컨테이너(`container: qtile`)에 갇히지 않게 `.query` 밖에 그린다 -->
{#if treeMenu}
  <TreeMenu
    target={treeMenu.target}
    title={treeMenu.title}
    x={treeMenu.x}
    y={treeMenu.y}
    onclose={closeTreeMenu}
    ondefinition={defineFromTree}
    rel={treeMenu.rel}
    onopen={openData}
    onselect={selectInto}
  />
{/if}

{#if tabMenu}
  <ScriptTabMenu
    n={tabMenu.n}
    title={tabMenu.title}
    data={tabMenu.data}
    x={tabMenu.x}
    y={tabMenu.y}
    onclose={closeTabMenu}
    onrename={sc.startRename}
    onsave={saveTabSql}
    onclosetab={(n) => void closeTabHere(n)}
    canCloseOthers={tabsToCloseN(sc.tabs, tabMenu.n, "others").length > 0}
    canCloseRight={tabsToCloseN(sc.tabs, tabMenu.n, "right").length > 0}
    onclosearound={(n, which) => void sc.closeTabsAround(n, which).then(refocusAfterClose)}
  />
{/if}

<style>
  .query {
    container: qtile / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판(흐림 + `--glass-mid`)은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
    outline: none;
    /* 놓을 곳(`.file-drop`)의 기준 — 컨테이너(`qtile`)가 이미 그 기준이라 다른 자식의 자리는 바뀌지 않는다 */
    position: relative;
  }

  .file-drop {
    position: absolute;
    inset: 4px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bg-panel) 82%, transparent);
    pointer-events: none;
    text-align: center;
  }

  /* 글자 카드 — 면이 반투명이라 뒤의 단축키 줄과 겹쳐 읽히지 않게 불투명 바탕을 깐다 */
  .file-drop-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 18px;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md, 0 6px 18px rgb(0 0 0 / 0.16));
  }

  .file-drop-main {
    font-size: 13px;
    color: var(--fg);
  }

  .file-drop-sub {
    font-size: 11px;
    color: var(--fg-3);
  }

  .tree-toggle {
    align-self: center;
    margin-right: 2px;
  }

  /* 포커스 밖에서 접힐 때 지울 앞 간격 = 머리줄 `gap`(`--head-act-gap` — `PaneHeader` "드러냄" 절) */
  .tree-toggle.inhead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    --head-act-gap: var(--space-2);
  }

  /* 좁은 타일의 드롭다운 단추는 그림 둘(패널 · ▾) — 24px 에 가두면 ▾ 가 잘린다. 줄지 않는 제 폭 */
  .tree-toggle.inhead.drop {
    width: auto;
    gap: 2px;
    padding: 0 5px;
  }

  .tree-toggle.inhead:hover {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  .tree-toggle.inhead:active {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  /* 아이콘이 넓은 토글의 아이콘과 같은 x 에 서게 — 왼쪽 여백 (24 − 14) / 2 = 5px */
  .tree-toggle.inhead.drop {
    width: auto;
    gap: 2px;
    padding: 0 3px 0 5px;
  }

  .btn.icon.drop {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  /* 문서 타일 곁 패널 단추(`DocView` 의 "곁 패널 단추의 켬")와 같은 강조 면 하나다 — 곁 패널 단추는 한 규칙(사용자 결정) */
  .tree-toggle[aria-pressed="true"],
  .tree-toggle.drop[aria-expanded="true"] {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .tree-toggle.inhead:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn.icon {
    padding: 3px 5px;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn[aria-pressed="true"] {
    color: var(--fg);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .banner {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--err-soft);
    border-bottom: 1px solid var(--line);
  }

  .banner .msg {
    flex: 1 1 auto;
    min-width: 0;
    user-select: text;
  }

  .main {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  /* 여닫는 동안 이 상자의 폭만 0 에서 자란다(`sidePanelGrow`) — 경계 `.vsplit` 이 작업 칸 쪽 변이라 안쪽을 오른쪽 변에 붙인다 */
  .tree-side {
    flex: 0 0 auto;
    min-height: 0;
    display: flex;
    justify-content: flex-end;
  }

  .hsplit {
    flex: 0 0 auto;
    position: relative;
    background: var(--line);
    outline: none;
  }

  .hsplit {
    height: 1px;
    cursor: row-resize;
  }

  /* 잡기 쉽게 — 보이는 선은 1px, 잡는 자리는 넓게 */
  .hsplit::after {
    content: "";
    position: absolute;
    z-index: 3;
  }

  .hsplit::after {
    inset: -3px 0;
  }

  .hsplit:hover,
  .hsplit:focus-visible {
    background: var(--focus-border);
  }

  .work {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .ed {
    flex: 0 0 auto;
    min-height: 48px;
  }

  /* 숨는 쿼리 탭의 칸 — 편집기는 산 채로 둔다(탭마다 되돌리기 기록) */
  .gone {
    display: none !important;
  }

  .data-tabs {
    display: none;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }

  .data-tabs.shown {
    display: flex;
  }

  .data-tab {
    display: none;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }

  .data-tab.on {
    display: flex;
  }

  .out-tabs {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 3px 6px 0;
    border-bottom: 1px solid var(--line);
    font-size: 11px;
  }

  .otab,
  .otab-x {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-2);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .otab {
    padding: 3px 10px 4px;
    border-bottom: 2px solid transparent;
  }

  .otab[aria-selected="true"] {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }

  .otab-pair {
    display: inline-flex;
    align-items: stretch;
  }

  .otab-pair .otab {
    padding-right: 4px;
  }

  .otab-x {
    display: inline-flex;
    align-items: center;
    padding: 0 6px 0 2px;
    color: var(--fg-3);
    border-bottom: 2px solid transparent;
  }

  .otab-pair.on .otab-x {
    border-bottom-color: var(--accent);
  }

  .otab:hover,
  .otab-x:hover {
    color: var(--fg);
  }

  .otab:focus-visible,
  .otab-x:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .out {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .out > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  .out > .note-line {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 10px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    border-bottom: 1px solid var(--line);
  }

  .note-line .note-icon {
    flex: 0 0 auto;
    display: inline-flex;
    margin-top: 1px;
  }

  .note-line.tone-ok {
    background: color-mix(in srgb, var(--ok) 8%, transparent);
  }

  .note-line.tone-ok .note-icon {
    color: var(--ok);
  }

  .note-line.tone-info .note-icon {
    color: var(--accent);
  }

  .note-line.tone-err {
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }

  .note-line.tone-err .note-icon {
    color: var(--err);
  }

  .note-line .msg {
    flex: 1 1 auto;
    min-width: 0;
    user-select: text;
  }

  .tx-why {
    display: block;
    font-weight: normal;
    white-space: pre-wrap;
    color: var(--fg-2);
  }

  .empty {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: center;
  }

  .empty-title,
  .empty-hint {
    margin: 0;
  }

  .empty-title {
    font-size: var(--t-sm);
    color: var(--fg-2);
  }

  .empty-hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .empty-acts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }

  .empty-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
  }

  .empty-btn:hover {
    background: var(--bg-hover);
  }

  .empty-btn.primary {
    color: var(--on-accent);
    background: var(--accent);
    border-color: transparent;
  }

  .empty-btn.primary:hover {
    background: color-mix(in srgb, var(--accent) 88%, var(--fg));
  }

  .empty-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .empty-kbd {
    opacity: 0.7;
    font-size: var(--t-xs);
  }

  .out-note {
    margin: 0;
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-2);
    overflow: auto;
  }

  .out-note p {
    margin: 0 0 var(--space-2);
  }

  .out-note .safety {
    font-size: var(--t-xs);
    color: var(--fg-3);
    line-height: 1.5;
  }

  .out-note .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .out-note .keys > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .out-note .safety.on {
    color: var(--err);
  }
</style>
