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

  // ---------------------------------------------------------------------------
  // **독의 DB 칸** — 쿼리 타일의 연결 목록 (2026-10-12, docs/log/2026-10-12-query-tile.md).
  //
  // 데이터는 연결 목록 하나다(`db-connections.json` — 10-13 저장 하나로). 10-15 부터 **호스트 독과 같은 폴더 트리**다(사용자 요청 —
  // 10-13 의 "묶음 없이 한 목록" 을 바꿨다): 폴더 줄 = 펼침 화살표 · 폴더 아이콘(고른 아이콘 · 색) · 이름 · 개수, 층마다 폴더 먼저 ·
  // 연결 뒤, 둘 다 이름순(규칙은 순수 `$lib/db-folders`, 저장 · 펼침은 `app/db-folders`). 폴더 소속은 연결의 `folder` 칸, 아이콘 · 색 ·
  // 빈 폴더는 곁 파일 `db-folders.json`. 연결 줄 = 엔진 로고(`DB_ENGINE_ICON` — 호스트 아이콘과 같은 `HostIcon` · 원본 색) · 이름 ·
  // (열린 곳 표식 · 볼트 자물쇠) · [SSH 칩](경유만) · 주소(`hint`). 새로 만들기 · 편집은 모두 같은 폼, 삭제는 OS 확인 대화.
  //
  // 클릭은 호스트 칸과 같다 — 연결 줄은 **한 번 클릭 = 고르기, 더블 클릭 · Enter = 열기**, 폴더 줄은 수식 없는 한 번 클릭 = 고르기 +
  // 펼치기/접기(Ctrl · Shift 클릭은 고르기만 · Enter 도 펼치기/접기 · 더블 클릭은 뜻 없음 — 2026-10-19 판 펼침). 펼친 폴더는 아이들과 한
  // 묶음 판으로 선다(`tree-accordion.ts` · `dock-tree.css`). **끌어다 놓기**(호스트 트리와 같다): 연결 · 폴더 줄을 폴더 줄 위(그 폴더) ·
  // 연결 줄 위(그 연결의 폴더) · 목록의 빈 바닥(최상위)에 놓으면 옮긴다. 접힌 폴더 위에 머물면 연다(`SPRING_LOAD_MS`).
  //
  // **여러 줄 고르기**(10-15 — 호스트 독과 같은 부품 · 같은 규칙): 선택은 `SelectionController`(Ctrl+클릭 토글 · Shift+클릭 범위 ·
  // Shift+↑↓/Home/End 넓히기 · Ctrl+A 전부), 빈 곳을 끌면 러버밴드(`createMarquee` — 빈 곳 클릭 = 해제), 고른 줄을 끌면 **고른 것
  // 전부**가 실린다(개수 고스트). 잘라내기/복사/붙여넣기(Ctrl+X/C/V — 앱 안 클립보드 `app/db-folders`, 붙이는 자리는 고른 줄의 폴더) ·
  // Delete(고른 것 전부 — OS 확인 대화). 여럿을 골라 우클릭하면 다중 메뉴.
  //
  // 키: ↑↓ 줄 이동 · Home/End · → 펼치기/첫 아이 · ← 접기/부모 · Enter 열기(폴더는 펼치기/접기) · Ctrl+Enter 새 타일로 열기 · F2 편집(폴더면
  // 폴더 편집) · Delete 제거(확인 대화) · Ctrl+A/C/X/V(검색 칸에서는 글자의 키) · Escape 는 선택 → 검색어 → (독 닫기).
  // ---------------------------------------------------------------------------

  let query = $state("");

  /**
   * 상대 시각의 "지금" — 호스트 칸(`HostList`)과 같은 시계 하나 · 30초 박자. 기록이 바뀌면(`db-history-changed`) 사본이 다시 읽혀
   * 줄이 새로 그려지므로 그 사이의 틈만 이 시계가 메운다.
   */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
  let searchEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);
  let menu = $state<{ conn: DbDockConn | null; folder: string | null; x: number; y: number } | null>(null);
  /** 폴더 편집 모달 — 열려 있으면 그 값 (`FolderEditDialog` — 호스트 독과 같은 상자) */
  let folderEdit = $state<DbFolderEdit | null>(null);

  const all = $derived(dbDockConnList());
  /**
   * 그릴 줄들 — 정렬 단추(`[hosts] sort` — 호스트 · 프로젝트 칸과 같은 칸)를 따른다. "최근" 이면 연결만 그 연결의 마지막
   * 성공 접속순(DB 접속 기록 `app/db-history` — `dbDockTree` 의 `recentOf` · 기록 없는 연결은 뒤에서 이름순 · 폴더는 이름순 제자리).
   */
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

  // ---------------------------------------------------------------------------
  // 선택 — 호스트 독(`Sidebar.svelte`)과 같은 부품(`SelectionController`). id 는 줄 키(연결 `conn:<id>` · 폴더 `f:<경로>`)
  // ---------------------------------------------------------------------------

  const sel = createSelection();
  /** 보이는 순서대로의 줄 키 — Shift 범위 · 화살표 · 러버밴드가 이 순서를 본다 */
  const order = $derived(rows.map((r) => r.key));
  /** 커서가 앉은 줄(Enter · F2 · ←→ · Ctrl+Enter 의 대상) — **골라져 있을 때만**(보이지 않는 커서를 믿지 않는다 — 호스트 독과 같다) */
  const current = $derived(sel.focus !== null && sel.has(sel.focus) ? (rows.find((r) => r.key === sel.focus) ?? null) : null);
  /** 지금 선택 = 조작의 대상(끌기 · 잘라내기 · 복사 · 제거) */
  const selPayload = $derived(dbPayloadOfKeys(order, sel.ids));

  // 목록이 바뀌면(재로드 · 검색 · 접힘) 사라진 줄을 선택에서 떨어낸다
  $effect(() => sel.prune(order));

  // 키보드로 옮긴 커서가 화면 밖이면 최소한만 스크롤
  $effect(() => {
    const key = sel.focus;
    if (key === null || !listEl) return;
    listEl.querySelector<HTMLElement>(`[data-db-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  });

  /** 열린 곳 — 한 번 모아 줄마다 나눠 본다(줄마다 탭 트리를 다시 훑지 않는다) */
  const locations = $derived(dbOpenLocations());
  function markersOf(c: DbDockConn) {
    return openLocationMarkers(dbConnLocations(locations, c.id), currentWorkspaceId(), workspaceList());
  }

  /** 한 단의 들여쓰기 (px) — 호스트 트리와 같은 값 */
  const INDENT_PX = 14;
  function indent(depth: number): string {
    return `calc(var(--row-pad-x) + ${depth * INDENT_PX}px)`;
  }

  /** 보이게 될 때 · 창이 돌아올 때 — 연결 목록 · 폴더 · 볼트 표식을 다시 읽는다. 시계는 없다 */
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

  /** 그 줄 하나만 고른다(커서도 그리로) — 키보드 ←→ · 검색 · 편집 상자 닫기의 길 */
  function select(key: string) {
    sel.click({ ctrlKey: false, metaKey: false, shiftKey: false }, key, order);
  }

  /** ↑↓ — 아무것도 안 골랐으면 끝에서 시작(↓ = 첫 줄 · ↑ = 끝 줄), 아니면 한 칸(Shift 면 범위로 넓히기). 끝에서 멈춘다 */
  function move(delta: number, extend: boolean) {
    if (order.length === 0) return;
    if (sel.count === 0 && !extend) {
      select(order[delta > 0 ? 0 : order.length - 1]);
      return;
    }
    sel.move(order, delta, extend, false);
  }

  /**
   * 폴더 하나를 펼치거나 접는다 — 줄 클릭 · →·← · Enter · 끌다 머물기의 한 문. 사람이 바꾼 자리라 그 판만 움직인다
   * (`treeMotion` — 검색의 저절로 펼침은 이 문을 지나지 않는다).
   */
  function openFolder(path: string, open: boolean) {
    if (dbExpanded().has(path) === open) return;
    treeMotion.mark(`db:${path}`);
    setDbFolderOpen(path, open);
  }

  /** 그리는 꼴 — 펼친 폴더 아래 아이들을 둥지로 접는다(판 하나 = 폴더 줄 + 아이들) */
  const tree = $derived(nestRows(rows, (r) => r.depth));

  /** 끌다 머물면 펼침 — 받을 수 있는 접힌 폴더 줄 위에 `SPRING_LOAD_MS` 동안 머물면 연다(호스트 독과 같다) */
  const spring = createSpringLoad();
  $effect(() => () => spring.disarm());

  /** dragleave 가 줄 안의 조각으로 들어간 것뿐인가(그때는 떠난 것이 아니다) */
  function leavesInside(ev: DragEvent): boolean {
    const to = ev.relatedTarget;
    return to instanceof Node && ev.currentTarget instanceof Node && ev.currentTarget.contains(to);
  }

  /** 줄을 "연다" — 폴더면 펼치기/접기(검색이 저절로 펼친 폴더는 그대로), 연결이면 열기 */
  function activate(row: DbTreeRow) {
    if (row.kind === "folder") {
      if (!row.auto) openFolder(row.fullPath, !row.expanded);
      return;
    }
    void openDbConn(row);
  }

  /** 한 줄 삭제(메뉴 "삭제…") — 그 줄의 짐으로 고른 것 지우기와 같은 길(OS 확인 대화 — 한 줄이면 예전 문구 그대로) */
  async function askDelete(c: DbDockConn) {
    if (await deleteDbSelection({ conns: [c.id], folders: [] })) {
      sel.clear();
      focusSearch();
    }
  }

  /** 고른 것 지우기 — Delete · 다중 메뉴 "제거…" (확인 대화는 `deleteDbSelection`) */
  async function removeSelection() {
    const payload = selPayload;
    if (dbDragEmpty(payload)) return;
    if (await deleteDbSelection(payload)) {
      sel.clear();
      focusSearch();
    }
  }

  /** 잘라내기 · 복사 — 앱 안 클립보드에 담는다(붙이면 이동 · 복제) */
  function cutSelection() {
    setDbClip("cut", selPayload);
  }

  function copySelection() {
    setDbClip("copy", selPayload);
  }

  function openRowMenu(ev: MouseEvent, row: DbTreeRow) {
    ev.preventDefault();
    ev.stopPropagation();
    // 이미 골라진 것 위면 선택을 지킨다(다중 메뉴) — 밖이면 그 줄 하나만
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

  // ---------------------------------------------------------------------------
  // 폴더 편집 — 메뉴 "편집…" · 폴더 줄의 F2 (호스트 독과 같은 모달)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // 끌어다 놓기 — 독 안에서 옮기기(호스트 트리와 같은 세 자리: 폴더 줄 · 연결 줄(그 폴더) · 빈 바닥(최상위)). 같은 짐을
  // 즐겨찾기(시작 화면 줄 · 하단 독)도 받는다 — 연결만(`favorite-drop.ts`) · 짐 종류는 공용 `DB_DOCK_DRAG_TYPE`
  // ---------------------------------------------------------------------------

  const DRAG_TYPE = DB_DOCK_DRAG_TYPE;
  /** 끌고 있는 짐 — dragstart 에서 동기로(dragover 에서는 브라우저가 값을 안 보여 준다) */
  let dragPayload = $state<DbDockDrag | null>(null);
  /** 반투명하게 그릴 줄들 — **한 틱 미뤄** 켠다(WebView2 는 dragstart 중에 소스가 바뀌면 드래그를 취소한다) */
  let draggingKeys = $state<ReadonlySet<string> | null>(null);
  let draggingTimer: ReturnType<typeof setTimeout> | null = null;
  /** 강조 중인 경로 (`""` = 최상위 — `null` 과 구분) */
  let dropTarget = $state<string | null>(null);

  /**
   * 줄에서 시작한 드래그 — **고른 것을 끌면 선택 전체, 고르지 않은 것을 끌면 그것 하나**(호스트 독과 같다 · `sel.forDrag`).
   * 선택 표시 갱신도 한 틱 미룬다(위의 WebView2 규칙). 여럿이면 개수 고스트.
   */
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
    // 독 안은 옮기기(move), 즐겨찾기 쪽은 더하기(copy) — 둘 다 받아 주게 copyMove(호스트 독 `Sidebar.svelte` 와 같다)
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

  /** 항목(버튼) 위에서는 빈 바닥이 물러난다 — 그쪽이 제 경로로 받았다(drop 은 버블한다) */
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

  // ---------------------------------------------------------------------------
  // 러버밴드 — 빈 곳에서 그어 여러 줄을 고른다(호스트 독 · 파일 타일과 같은 기계장치 · 빈 곳 클릭 = 선택 해제)
  // ---------------------------------------------------------------------------

  const marquee = createMarquee({
    root: () => bodyEl,
    rects: () => boxesIn(bodyEl, listEl, "data-db-key"),
    selection: () => sel.state,
    apply: (rects, box, additive, base) => sel.marquee(rects, box, additive, base),
    onEmptyClick: () => sel.clear(),
    // 항목 위 = HTML5 드래그(옮기기)의 자리다
    isItem: (target) => target instanceof Element && target.closest("button") !== null,
  });

  // ---------------------------------------------------------------------------
  // 키보드
  // ---------------------------------------------------------------------------

  function onKeydown(ev: KeyboardEvent) {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (menu || folderEdit) return;
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    const inSearch = target !== null && target === searchEl;
    // 검색 칸이 아닌 입력 요소 위의 키는 그 칸의 것이다
    if (!inSearch && (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)) return;

    // Ctrl 하나짜리 — 전부 선택 · 복사 · 잘라내기 · 붙여넣기(호스트 독과 같은 넷). 검색 칸에서는 글자의 키라 양보한다
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
      if (inSearch) return; // 칸 안에서는 글자의 처음 · 끝이다
      ev.preventDefault();
      sel.move(order, ev.key === "Home" ? -order.length : order.length, ev.shiftKey, false);
    } else if (ev.key === "ArrowRight") {
      // 검색 칸에서는 글자 사이를 오가는 키다
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
      // 검색 칸에서는 글자를 지우는 키다
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

  /** 검색 칸에서 글자를 치면 첫 **연결**을 고른다(저절로 펼친 폴더는 건너뛴다) — 치고 곧바로 Enter 로 연다 */
  function onQueryInput() {
    const first = query.trim() !== "" ? rows.find((r) => r.kind === "conn") : undefined;
    if (first) select(first.key);
    else sel.clear();
  }

  /** **검색 칸에 커서를 둔다** — 독이 이 칸을 여는 순간 부른다 */
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
    <!--
      정렬 — 호스트 · 프로젝트 칸과 **같은 칸**(`[hosts] sort`)이다. 지금 순서의 그림을 보인다(누르면 저쪽).
    -->
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
    <!-- 러버밴드 — 내용 좌표계라 목록과 함께 스크롤된다(좌표 원점은 이 `.body`) -->
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

  <!-- 줄들은 편 꼴(`rows`)로 오고, 그리기는 둥지 꼴(`nestRows`)이다 — 펼친 폴더와 그 아이들이 한 묶음 판으로 선다 -->
  {#snippet branch(nodes: TreeNode<DbTreeRow>[])}
        {#each nodes as node (node.row.key)}
          {@const row = node.row}
          {#if row.kind === "folder"}
            {@const motionKey = `db:${row.fullPath}`}
            <li class="dtree-node" class:open={row.expanded} class:still={!treeMotion.allows(motionKey)}>
              <!-- 폴더 줄 — 펼치기 · 드롭 대상 · 드래그 핸들 · 우클릭 메뉴(호스트 트리의 폴더 줄과 같은 꼴) -->
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
                  <!-- 펼침 꺾쇠 — 줄 오른쪽 끝, 펼치면 위로 돈다. 그림일 뿐 누름은 줄의 것이다(키보드 길은 →·←·Enter) -->
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
                  <!-- 마지막 접속(`2분 전` — 호스트 칸과 같은 계단 · 사람이 쿼리 타일로 연 것만 · `db-history`). 주소는 줄 말풍선에 있다 -->
                  {#if lastOk !== null}<span class="hint" data-db-when>{relativeTime(lastOk, now, t)}</span>{/if}
                  <!-- 폴더 줄의 꺾쇠 칸만큼 비운다 — 오른쪽 끝 글자들이 폴더 줄과 세로로 맞는다 -->
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
  /* 판 · 줄 치수는 프로젝트 칸과 **같은 토큰**이다 (`theme.css` 의 `--row-*` · 독의 덮개) — 칸들이 한 벌로 읽힌다 */
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

  /* 러버밴드 — 호스트 트리(`HostList.svelte` 의 `.marquee`)와 같은 값. 포인터를 받지 않아야 아래 줄의 hover 가 산다 */
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

  /* 끌고 가는 동안 — 원본은 자리에 남되 들려 있다는 인상만(호스트 트리와 같은 값) */
  .item.dragging {
    opacity: 0.45;
  }

  /* 잘라내기로 담긴 것 — "곧 여기서 사라진다" 는 예고(호스트 트리와 같은 값 · 복사는 표시하지 않는다) */
  .item.cut {
    opacity: 0.5;
  }

  /* 여기 놓으면 최상위 — 목록 바닥 강조(호스트 트리 `Sidebar.svelte` 의 `.body.drop-root` 와 같은 값) */
  .body.drop-root {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: var(--radius-surface-inner);
  }

  /* 폴더 줄 위 — 호스트 트리의 `.drop-over` 와 같은 값(primary 2px 안쪽 테두리 + 옅은 primary 면) */
  .item.drop-over,
  :global(.dock.launcher) .item.drop-over.drop-over {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  /* 폴더 줄 — 이름이 늘어나고 오른쪽 끝에 개수(호스트 트리의 `.count`) */
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

  /*
   * SSH 칩 — 호스트 칸의 태그 칩(`HostList.svelte` 의 `.tag`)과 **같은 치수 · 색**: 12px · 18px 줄 · `--fg-2` 글자 · 회색 판
   * (`--surface-hover`) · 작은 모서리. 독 목록의 칩은 종류별 색이 없는 한 벌이다(색 칩은 타일 머리줄의 것). 자리는 주소 바로
   * 앞 — "[SSH] web-02" 가 한 말로 읽힌다. 경유 별칭 전부는 칩 말풍선.
   */
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

  /* 마지막 접속 — 오른쪽 끝, 흐림. 좁으면 여기부터 말줄임 */
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

  /*
   * MD3 목록 줄(2026-10-18 — End-4 식 목업) — **독 안에서만**(`.dock.launcher`): 줄은 알약(`--radius-row` — 2026-10-29 C안, 펼침 판 안에서도 같은 알약) · 호버는 상태 층 · 고른 줄은
   * secondaryContainer(`--accent-soft`) + onSecondaryContainer. 앞자리는 28px 칸이고, DB 연결 줄은 원형 아바타
   * (--m3-tertiary-container). 오른쪽 보조 글자는 outlineVariant 테두리의 보조 칩이다.
   */
  :global(.dock.launcher) .item {
    border-radius: var(--radius-row);
  }

  :global(.dock.launcher) .item:hover {
    background: color-mix(in srgb, var(--fg-1) var(--state-hover), transparent);
  }

  /* 재질 글래스면 고른 줄 = 흰 반투명 칠(`--glass-pick` — theme.css 재질 절, 평면은 없어 그대로) */
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
