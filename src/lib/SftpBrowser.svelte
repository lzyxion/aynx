<script lang="ts">
  import { untrack } from "svelte";
  import { LOCAL_KEY, type BackendPlace, type DiskSpace, type FsBackend } from "$lib/fs-backend";
  import { fsClip } from "$lib/fs-clipboard.svelte";
  import { fsRefreshSignal } from "$lib/fs-refresh.svelte";
  import { watchPathsOf, watchSwitchDelay, watchWanted } from "$lib/fs-auto-refresh";
  import { windowActive } from "$lib/app/window-active.svelte.js";
  import type { FsWatch } from "$lib/fs-watch";
  import type { OnConflict } from "$lib/fs-ops";
  import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";
  import {
    entryOrder,
    fileTreeRows,
    filterRows,
    navOrder as navOrderOf,
    targetDirOf,
    type FileTreeRow,
  } from "$lib/file-tree";
  import { DEFAULT_FILE_ZOOM, type FileUiPatch, type FileView } from "$lib/session";
  import {
    folderSummary,
    iconZoomScale,
    selectionSummary,
    stepIconZoom,
  } from "$lib/browser/file-view";
  import { stripReason } from "$lib/error-reason";
  import { createNav } from "$lib/browser/nav-controller.svelte";
  import BrowserToolbar from "$lib/browser/BrowserToolbar.svelte";
  import BrowserNav from "$lib/browser/BrowserNav.svelte";
  import BrowserViewPick from "$lib/browser/BrowserViewPick.svelte";
  import {
    fileMenuTools,
    toPaneMenuItems,
    type ToolbarTool,
  } from "$lib/browser/toolbar-tools";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { filePlacesLayout } from "$lib/pane/head-span";
  import LocationBar from "$lib/browser/LocationBar.svelte";
  import PlacesPanel from "$lib/browser/PlacesPanel.svelte";
  import FilterBar from "$lib/browser/FilterBar.svelte";
  import FileStatusBar from "$lib/browser/FileStatusBar.svelte";
  import PreviewPanel from "$lib/browser/PreviewPanel.svelte";
  import { previewSubject } from "$lib/browser/preview";
  import { placeSections } from "$lib/browser/places";
  import FileList from "$lib/browser/FileList.svelte";
  import FileMenu from "$lib/browser/FileMenu.svelte";
  import TransferPanel from "$lib/browser/TransferPanel.svelte";
  import { createSelection } from "$lib/browser/selection-controller.svelte";
  import { boxesIn, createMarquee } from "$lib/browser/marquee.svelte";
  import { createTransfers } from "$lib/browser/fs-transfer.svelte";
  import { createDragController } from "$lib/browser/drag-controller.svelte";
  import { failureOf, FileListing } from "$lib/browser/file-listing.svelte";
  import { FileMenuController } from "$lib/browser/file-menu-controller.svelte";
  import { FileActions } from "$lib/browser/file-actions";
  import { FileKeys } from "$lib/browser/file-keys";
  import { displayCombo, effectiveCombo, resolveBindings } from "$lib/keybindings";
  import { registerTileFind } from "$lib/app/tile-find";
  import { settings } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";

  /**
   * 파일 브라우저 — 원격(SFTP)과 로컬 디스크가 같은 화면을 쓴다. 어디를 보는지는 `backend` 만 안다 — 화면이 `kind === "localfs"` 같은 검사를 하지 않는다.
   * 원격 백엔드는 세션을 열지 않고 원본 터미널의 세션을 빌린다: 끊김(`online` 거짓 — 기다리면 돌아온다)과 원본 타일 사라짐(`sourceGone` — 안 돌아온다)은 다른 상태다.
   * 목록을 못 읽으면 빈 목록을 그리지 않는다 — 권한이 없는 것과 비어 있는 것은 화면에서 달라야 한다.
   */
  let {
    backend,
    view = "details",
    onview,
    zoom = DEFAULT_FILE_ZOOM,
    places = true,
    preview = false,
    showHidden = false,
    projects = [],
    onfileui,
    initialPath = null,
    alias = "",
    active = false,
    shown = true,
    sourceGone = false,
    sourcePaneId = null,
    onupload,
    oncwd,
    onopendoc,
    onnotice,
    refreshKey = 0,
    paneId = null,
  }: {
    backend: FsBackend;
    view?: FileView;
    onview?: (view: FileView) => void;
    zoom?: number;
    places?: boolean;
    preview?: boolean;
    showHidden?: boolean;
    projects?: readonly { id: string; name: string; path: string }[];
    onfileui?: (patch: FileUiPatch) => void;
    /** 그 경로가 사라졌으면 오류를 한 줄 남기고 홈으로 떨어진다 — 타일이 빈 화면으로 뜨면 안 된다 */
    initialPath?: string | null;
    alias?: string;
    active?: boolean;
    /** 보이지 않는 타일은 OS 디렉터리 핸들을 쥐지 않는다 (로컬 감시 전용) */
    shown?: boolean;
    sourceGone?: boolean;
    sourcePaneId?: string | null;
    onupload?: (remoteDir: string, files: File[]) => void;
    oncwd?: (dir: string) => void;
    onopendoc?: (path: string) => void;
    onnotice?: (message: string) => void;
    /** 바뀌면 다시 읽는다 — 업로드는 상위 모달로 가서 끝난 때를 여기서 알 길이 없다 */
    refreshKey?: number;
    paneId?: string | null;
  } = $props();

  // ── 상태 ──

  /** 게터 객체 하나를 함께 본다 — 값으로 넘기면 한 프레임 낡는다 */
  const tile = {
    get backend() {
      return backend;
    },
    get offline() {
      return offline;
    },
    get isTree() {
      return isTree;
    },
    get view() {
      return view;
    },
    get showHidden() {
      return showHidden;
    },
    get initialPath() {
      return initialPath;
    },
    get listEl() {
      return listEl;
    },
    get fileInput() {
      return fileInput;
    },
    get nav() {
      return nav;
    },
    get sel() {
      return sel;
    },
    get order() {
      return order;
    },
    get navOrder() {
      return navOrder;
    },
    get rows() {
      return rows;
    },
    get rowById() {
      return rowById;
    },
    get selPaths() {
      return selPaths;
    },
    get focusEntry() {
      return focusEntry;
    },
    get targetDir() {
      return targetDir;
    },
    get atRoot() {
      return atRoot;
    },
    get active() {
      return active;
    },
    get pathFocused() {
      return pathFocused;
    },
    get fileBindings() {
      return fileBindings;
    },
    get sourcePaneId() {
      return sourcePaneId;
    },
    get onopendoc() {
      return onopendoc;
    },
    get onupload() {
      return onupload;
    },
    get onnotice() {
      return onnotice;
    },
    get oncwd() {
      return oncwd;
    },
    get transfers() {
      return transfers;
    },
    get listing() {
      return ls;
    },
    get menus() {
      return mc;
    },
    get copySelection() {
      return actions.copySelection;
    },
    get pasteInto() {
      return actions.pasteInto;
    },
    get openEntry() {
      return actions.openEntry;
    },
    get targets() {
      return actions.targets;
    },
    get pathDraft() {
      return pathDraft;
    },
    set pathDraft(value: string) {
      pathDraft = value;
    },
    isRootItem,
    targetDirOfEntry,
    goTo,
    runFileAction,
  };

  const ls = new FileListing(tile);

  let pathDraft = $state("");
  let pathFocused = $state(false);

  let listEl = $state<HTMLDivElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);
  let locationBar = $state<LocationBar | null>(null);

  const fileBindings = $derived(resolveBindings(settings.keybindings).files);

  /** 모르는 id 면 `false`(키를 놓아준다) */
  function runFileAction(id: string): boolean {
    switch (id) {
      case "files-location":
        void locationBar?.edit();
        return true;
      case "files-view-icons":
        onview?.("icons");
        return true;
      case "files-view-compact":
        onview?.("compact");
        return true;
      case "files-view-details":
        onview?.("details");
        return true;
      case "files-places":
        onfileui?.({ places: !places });
        return true;
      case "files-filter":
        openFilter();
        return true;
      case "files-preview":
        onfileui?.({ preview: !preview });
        return true;
    }
    return false;
  }

  const mc = new FileMenuController(tile, ls);

  // ── 파생 ──

  const isTree = $derived(view === "details");

  /** 게으른 읽기의 그물은 거르기 전 줄을 본다 — 필터가 곁줄을 빼도 펼쳐 둔 폴더는 읽혀야 거를 것이 생긴다 */
  const allRows = $derived(
    fileTreeRows(ls.cwd, ls.entries, {
      tree: isTree,
      showHidden,
      expanded: ls.expanded,
      folders: ls.folders,
      limits: ls.limits,
    }),
  );

  // ── 필터 줄 ──

  /** 닫으면 거르기도 풀린다 — 열려 있지 않은 필터가 목록을 줄여 두지 않게 */
  let filterOn = $state(false);
  let filterQuery = $state("");
  let filterBar = $state<FilterBar | null>(null);

  const filtered = $derived(filterRows(allRows, filterOn ? filterQuery : ""));

  const rows = $derived(filtered.rows);

  function openFilter() {
    filterOn = true;
    void filterBar?.focus();
  }

  function closeFilter() {
    filterOn = false;
    filterQuery = "";
    rootEl?.focus({ preventScroll: true });
  }

  // 파일 타일의 "찾기"(`Ctrl+F`)는 이름 거르기다
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() =>
      registerTileFind(id, () => {
        openFilter();
        return true;
      }),
    );
  });

  // `bind:this` 는 그 다음 틱에 선다
  $effect(() => {
    if (filterOn && filterBar) untrack(() => void filterBar?.focus());
  });

  const rowById = $derived(new Map(rows.map((r) => [r.id, r] as const)));

  const crumbs = $derived(backend.crumbsOf(ls.cwd));

  const offline = $derived(!backend.online);

  const atRoot = $derived(ls.hasCwd && backend.isSyntheticRoot(ls.cwd));

  /** 드라이브 뿌리("내 PC" 바로 아래) — 트리에서는 드라이브와 그 안의 파일이 한 화면에 서서 줄마다 묻는다 */
  function isRootItem(path: string): boolean {
    return !backend.isSyntheticRoot(path) && backend.isSyntheticRoot(backend.parentOf(path));
  }

  const isLocal = $derived(backend.key === LOCAL_KEY);

  /** 원격이면 뿌리 `/` 를 `<별칭>:/` 로 적는다 — 경로 · 열쇠는 그대로다 */
  const shownCrumbs = $derived(
    isLocal || alias === "" || crumbs[0]?.path !== "/"
      ? crumbs
      : [{ ...crumbs[0], label: `${alias}:/`, title: `${alias}:/` }, ...crumbs.slice(1)],
  );

  let tileW = $state(0);
  /** 장소 · 미리 보기 패널을 빼고 계산하지 않고 잰다 — 머리줄은 몸 밖이라 되먹지 않는다 */
  let listW = $state(0);
  $effect(() => {
    const el = listEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1].contentRect.width);
      if (w !== listW) listW = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  const placesLayout = $derived(filePlacesLayout({ on: places, width: tileW, listW }));

  /** 셸에 넘길 수 있는 것은 로컬에 실제로 있는 경로뿐이다 · 원격 창은 끌어 나갈 곳이 메인 PC 의 탐색기라 없다 */
  const canExport = $derived(isLocal && !offline && !isRemote);

  // ── 다중 선택 ── id 는 항목의 절대 경로다

  const sel = createSelection();

  const order = $derived(entryOrder(rows));

  /** 곁줄 id 는 선택에 들어가도 `selPaths` 가 걸러 낸다 */
  const navOrder = $derived(navOrderOf(rows));

  const focusEntry = $derived.by(() => {
    const row = sel.focus === null ? undefined : rowById.get(sel.focus);
    return row?.kind === "entry" ? row.entry : null;
  });

  const selPaths = $derived(order.filter((p) => sel.has(p)));

  const selHasFolder = $derived(
    selPaths.some((p) => {
      const row = rowById.get(p);
      return row?.kind === "entry" && isDirLike(row.entry);
    }),
  );

  $effect(() => sel.prune(navOrder));

  /** 골라지지 않고 커서만 앉은 줄은 대상이 되지 않는다 — 호스트 트리가 겪은 함정이다 */
  const targetDir = $derived.by(() => {
    if (!isTree) return ls.cwd;
    const id = sel.focus;
    const row = id !== null && sel.has(id) ? rowById.get(id) : undefined;
    return targetDirOf(row, ls.cwd);
  });

  const targetBlocked = $derived(!ls.hasCwd || backend.isSyntheticRoot(targetDir));

  const targetNote = $derived(
    isTree && targetDir !== ls.cwd ? `\n${t("files.tree.target", { dir: targetDir })}` : "",
  );

  /** 줄 위 단추는 전부 그림 단추다 — 경로 칸이 남는 폭을 다 가져가야 긴 경로가 읽힌다 */
  const tools = $derived.by((): ToolbarTool[] => {
    // 원격 창에서는 로컬 타일(메인 PC 디스크)로도 그 기기에서 올리는 것이라 "업로드" (`sftp.ts` 의 `uploadVerb` 와 같은 갈래)
    const dropLabel = isLocal && !isRemote ? t("files.browser.import") : t("files.browser.upload");
    const list: ToolbarTool[] = [
      {
        id: "newfolder",
        icon: "folder-plus",
        label: t("files.browser.newfolder.title"),
        title: targetBlocked
          ? t("files.browser.newfolder.blocked.title")
          : t("files.browser.newfolder.title") + targetNote,
        disabled: offline || targetBlocked,
        fold: true,
        run: () => mc.newFolderHere(),
      },
    ];
    if (backend.canUpload) {
      list.push({
        id: "upload",
        icon: "upload",
        label: dropLabel,
        title: targetBlocked ? t("files.browser.upload.blocked.title") : dropLabel + targetNote,
        disabled: offline || targetBlocked,
        fold: true,
        run: () => actions.pickUpload(targetDir),
      });
    }
    const findCombo = hintOf("find");
    list.push({
      id: "filter-toggle",
      icon: "search",
      label: t("files.filter.toggle"),
      title: findCombo ? `${t("files.filter.toggle")} (${findCombo})` : t("files.filter.toggle"),
      pressed: filterOn,
      action: "files-filter",
      run: () => (filterOn ? closeFilter() : openFilter()),
    });
    return list;
  });

  const menuTools = $derived.by((): ToolbarTool[] => [
    {
      id: "hidden",
      icon: "show-hidden",
      label: t("files.browser.hidden.show"),
      pressed: showHidden,
      run: () => onfileui?.({ hidden: !showHidden }),
    },
    {
      id: "places",
      icon: "layout",
      label: t("files.places.toggle"),
      pressed: places,
      action: "files-places",
      run: () => onfileui?.({ places: !places }),
    },
    {
      id: "preview",
      icon: "preview",
      label: t("files.preview.toggle"),
      pressed: preview,
      action: "files-preview",
      run: () => onfileui?.({ preview: !preview }),
    },
  ]);

  function hintOf(action: string | undefined): string {
    return action ? displayCombo(effectiveCombo(action, settings.keybindings)) : "";
  }

  const inHead = $derived(paneId !== null && paneHeadShown(paneId));

  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, {
      lead: fileLead,
      bar: fileBar,
      replaceName: true,
      hideIcon: true,
      span: () => placesLayout.span,
      menu: () => toPaneMenuItems(fileMenuTools(tools, menuTools, placesLayout.fold), hintOf),
      run: (key) => [...tools, ...menuTools].find((tool) => tool.id === key)?.run(),
    });
  });

  function targetDirOfEntry(entry: SftpEntry | null): string {
    if (!isTree || !entry) return ls.cwd;
    return targetDirOf(rowById.get(entry.path), ls.cwd);
  }

  // ── 전송 · 드래그 · 러버밴드 ── 읽기 함수로 이 타일의 상태를 본다(값으로 넘기면 한 프레임 낡는다)

  const transfers = createTransfers({
    backend: () => backend,
    hasCwd: () => ls.hasCwd,
    offline: () => offline,
    selPaths: () => selPaths,
    reload: (keep = []) => ls.load(ls.cwd, keep),
    setError: (message) => (ls.error = message === null ? null : stripReason(message)),
    failureOf,
    notice: (message) => onnotice?.(message),
    consumeSignal: (tick) => (seenRefreshTick = tick),
  });

  const drag = createDragController({
    backend: () => backend,
    locked: isRootItem,
    offline: () => offline,
    order: () => order,
    selection: sel,
    busy: () => transfers.busy,
    canReceive: (dir) => transfers.canReceive(dir),
    bringIn: (src, paths, destDir, mode) => transfers.bringIn(src, paths, destDir, mode),
    receiveFiles: (dir, files) => actions.uploadTo(dir, files),
  });

  const marquee = createMarquee({
    root: () => listEl,
    rects: () => boxesIn(listEl, listEl, "data-path"),
    selection: () => sel.state,
    apply: (rects, box, additive, base) => sel.marquee(rects, box, additive, base),
    onEmptyClick: () => sel.clear(),
    isItem: (t) => t instanceof Element && t.closest(".row") !== null,
  });

  /** 이력은 메모리에만 — 배치 복원이 되살리는 것은 "어느 폴더" 이지 "어떤 길로 왔는가" 가 아니다 */
  const nav = createNav({
    ready: () => !offline && !ls.loading,
    go: (path) => ls.load(path),
  });

  $effect(() => () => clearTimeout(ls.slowTimer));

  // ── 트리 ──

  // 게으른 읽기의 그물 — "읽는 중" 으로 섰는데 아무도 읽지 않는 폴더(뿌리 이동 · 보기 바꿈 · 숨김 켬 · 재연결)를 받는다
  $effect(() => {
    if (!isTree || offline) return;
    for (const row of allRows) {
      if (row.kind !== "loading") continue;
      const path = row.parent;
      if (ls.inflight.has(path) || ls.folders.get(path)?.status === "loading") continue;
      untrack(() => void ls.fetchFolder(path));
    }
  });

  function toggleRow(row: Extract<FileTreeRow, { kind: "entry" }>) {
    sel.click({ ctrlKey: false, metaKey: false, shiftKey: false }, row.id, order);
    if (row.expanded) ls.collapse(row.entry.path);
    else ls.expand(row.entry.path);
  }

  // ── 장소 패널 ──

  let basePlaces = $state.raw<BackendPlace[]>([]);
  let drives = $state.raw<{ path: string; space: DiskSpace | null }[]>([]);
  /** `$state` 가 아니다 — 효과 안에서만 읽고 쓰는 표식이다 */
  let placesKey: string | null = null;

  $effect(() => {
    const key = backend.key;
    if (!places || !backend.online || placesKey === key) return;
    placesKey = key;
    untrack(() => void loadPlaces(backend));
  });

  async function loadPlaces(be: FsBackend) {
    basePlaces = await be.places();
    const roots = await (be.roots() ?? Promise.resolve(null)).catch(() => null);
    if (!roots) {
      drives = [];
      return;
    }
    drives = roots.map((path) => ({ path, space: null }));
    const spaces = await Promise.all(roots.map((root) => be.freeSpace(root)));
    if (be.key === backend.key) drives = roots.map((path, i) => ({ path, space: spaces[i] }));
  }

  // ── 상태 줄 ──

  const folderSum = $derived(folderSummary(ls.entries, showHidden));
  const selectionSum = $derived(
    selectionSummary(
      selPaths.flatMap((p) => {
        const row = rowById.get(p);
        return row?.kind === "entry" ? [row.entry] : [];
      }),
    ),
  );

  /** 늦게 온 옛 답이 새 답을 덮지 않게 번호를 단다(`spaceSeq`) */
  let space = $state<DiskSpace | null>(null);
  let spaceTick = $state(0);
  let spaceSeq = 0;
  $effect(() => {
    void spaceTick;
    const path = ls.cwd;
    const be = backend;
    if (!ls.hasCwd || !be.online) {
      space = null;
      return;
    }
    const seq = ++spaceSeq;
    untrack(() => {
      void be.freeSpace(path).then((v) => {
        if (seq === spaceSeq) space = v;
      });
    });
  });

  // ── 미리 보기 패널 ──

  const previewSubj = $derived(
    previewSubject(
      selPaths.flatMap((p) => {
        const row = rowById.get(p);
        return row?.kind === "entry" ? [row.entry] : [];
      }),
    ),
  );

  const folderName = $derived.by(() => {
    const last = crumbs[crumbs.length - 1];
    return last ? (last.labelKey ? t(last.labelKey) : last.label) : ls.cwd;
  });

  function itemCountOf(path: string): number | null {
    const state = ls.folders.get(path);
    if (state?.status !== "ok") return null;
    return showHidden ? state.entries.length : state.entries.filter((e) => !isHidden(e)).length;
  }

  const placeSecs = $derived(
    placeSections({
      base: basePlaces,
      projects,
      drives,
      home: isLocal ? null : (basePlaces.find((p) => p.kind === "home")?.path ?? null),
    }),
  );

  function setZoom(level: number) {
    if (level !== zoom) onfileui?.({ zoom: level });
  }

  /** 끌면서 접힌 폴더 위에 머물면 펼친다 — 줄 목록은 구독하지 않는다(펼친 순간 줄이 바뀌어 시계가 헛되이 다시 걸리지 않게) */
  const DRAG_EXPAND_MS = 600;
  $effect(() => {
    const dir = drag.dropDir;
    if (!isTree || dir === null) return;
    const row = untrack(() => rowById.get(dir));
    if (row?.kind !== "entry" || !row.expandable || row.expanded) return;
    const timer = setTimeout(() => ls.expand(dir), DRAG_EXPAND_MS);
    return () => clearTimeout(timer);
  });

  // 백엔드 따라가기 — 다시 붙으면(`loadedKey` 와 다르다) 보던 경로를 그대로 다시 읽는다 · 끊기면 목록은 남기고 배너만 덮는다
  $effect(() => {
    if (!backend.online) return;
    if (backend.key === ls.loadedKey) return;
    if (!ls.hasCwd) void ls.loadStart();
    else void ls.load(ls.cwd, selPaths);
  });

  function refresh() {
    spaceTick += 1;
    if (!ls.hasCwd) void ls.loadStart();
    else void ls.load(ls.cwd, selPaths);
  }

  /** `$state` 가 아니다(효과 안에서만) · `null` = 아직 못 봤다 — 첫 마운트에서 헛되이 한 번 더 읽지 않는다 */
  let seenRefresh: number | null = null;

  $effect(() => {
    const key = refreshKey;
    const first = seenRefresh === null;
    const changed = !first && key !== seenRefresh;
    seenRefresh = key;
    if (!changed) return;
    if (ls.hasCwd && backend.online) void ls.load(ls.cwd, selPaths);
  });

  /** 시작값이 지금 값이라 마운트하자마자 옛 신호로 읽지 않는다 · 전송 엔진이 자기 신호를 여기 적어 두 번 읽지 않게 한다 */
  let seenRefreshTick = fsRefreshSignal().tick;

  $effect(() => {
    const { tick, key } = fsRefreshSignal();
    if (tick === seenRefreshTick) return;
    seenRefreshTick = tick;
    // 읽되 구독하지 않는다 — 이 효과가 도는 조건은 신호 하나뿐이어야 한다.
    untrack(() => {
      if (key !== backend.key || !ls.hasCwd || !backend.online || ls.loading) return;
      void ls.load(ls.cwd, selPaths);
    });
  });

  // ── 자동 새로고침 ── 로컬 타일만 (docs/log/2026-10-21-file-tile-auto-refresh.md)
  // 원격 갈래는 쓰지 않는다 — 이 앱의 터미널 · AI 만 잡고 바깥 변경은 못 잡는 반쪽 자동은 목록을 믿어도 되는지 알 수 없게 한다.

  const autoOn = $derived(settings.fileAutoRefresh);

  /** Windows 는 하위 폴더에 열린 디렉터리 핸들이 있으면 상위 폴더 이름 바꾸기를 막는다(EPERM) — 창을 떠나면 핸들을 놓는다 */
  const watchWant = $derived(watchWanted(autoOn, shown, windowActive()));
  /** 끄기는 유예 뒤 — 메뉴 · 대화상자로 포커스가 잠깐 깜빡일 때마다 걷고 거는 소동이 없게. 켜기는 곧바로 */
  let watchOn = $state(untrack(() => watchWant));
  $effect(() => {
    const want = watchWant;
    const delay = watchSwitchDelay(watchOn, want);
    if (delay === null) return;
    if (delay === 0) {
      watchOn = want;
      return;
    }
    const timer = setTimeout(() => (watchOn = want), delay);
    return () => clearTimeout(timer);
  });

  const watchPaths = $derived(ls.hasCwd ? watchPathsOf(ls.cwd, allRows, backend.isSyntheticRoot(ls.cwd)) : []);

  /** 미룰 때 — 목록을 갈아 끼우면 선택이 바뀌고 경로 칸 글자가 덮여 사람 손 밑의 것이 깨진다 */
  const autoBusy = $derived(
    ls.loading || mc.menu !== null || pathFocused || drag.draggingPaths !== null || marquee.box !== null,
  );

  /** 아래 셋은 `$state` 가 아니다 — 효과 안에서만 읽고 쓴다 */
  let pendingDirs = new Set<string>();
  let watch: FsWatch | null = null;
  /** 숨은 탭에서 마운트돼 기다리던 타일도 처음 보일 때 한 번 읽는다 */
  let missedWhileOff = untrack(() => !watchOn);

  function flushAuto() {
    if (!ls.hasCwd || offline) {
      pendingDirs = new Set();
      return;
    }
    if (autoBusy || pendingDirs.size === 0) return;
    const dirs = pendingDirs;
    pendingDirs = new Set();
    if (dirs.has(ls.cwd)) {
      void ls.load(ls.cwd, selPaths);
      return;
    }
    for (const dir of dirs) if (ls.expanded.has(dir) && !ls.inflight.has(dir)) void ls.fetchFolder(dir);
  }

  // 감시의 수명 — 새로 선 감시는 경로가 바뀌지 않아도 받아야 해 처음 한 번은 여기서 넣는다 · 다시 걸 때는 걷혀 있던 동안의 바뀜을 한 번 읽는다
  $effect(() => {
    const open = backend.watch;
    if (!watchOn || !open) return;
    const w = untrack(() => open((dirs) => {
      for (const d of dirs) pendingDirs.add(d);
      flushAuto();
    }));
    watch = w;
    untrack(() => {
      w.set(watchPaths);
      if (missedWhileOff && ls.hasCwd) {
        pendingDirs.add(ls.cwd);
        flushAuto();
      }
      missedWhileOff = false;
    });
    return () => {
      w.dispose();
      if (watch === w) watch = null;
      pendingDirs = new Set();
      missedWhileOff = true;
    };
  });

  $effect(() => {
    const paths = watchPaths;
    untrack(() => watch?.set(paths));
  });

  // 쌓인 것은 반응형이 아니라 풀림만 이 효과를 깨운다
  $effect(() => {
    if (!autoBusy) untrack(flushAuto);
  });

  function goTo(path: string) {
    if (offline) return;
    void ls.load(path);
  }

  const actions = new FileActions(tile, ls);

  // ── 키보드 ──

  const keys = new FileKeys(tile);
  $effect(() => () => clearTimeout(keys.typeAheadTimer));

  async function submitPath(path: string): Promise<boolean> {
    if (offline) return false;
    if (await ls.load(path)) return true;
    // 파일 경로를 붙여넣었으면 그 파일이 든 폴더를 열고 고른다 — 폴더로 읽으면 Windows 가 os error 267 로 거절한다.
    let entry: SftpEntry;
    try {
      entry = await backend.stat(path);
    } catch {
      return false;
    }
    const isDir = entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir);
    if (isDir) return false;
    return ls.load(backend.parentOf(entry.path), [entry.path]);
  }

  /** 놓을 때 `Alt` 를 쥐면 윈도우가 "바로 가기 만들기" 로 읽는데 우리 데이터 객체는 `copy` 만 허용해 탐색기가 거절한다 · `.hint` 는 한 줄 말줄임이라 짧게 */
  const dragHint = $derived(
    drag.draggingPaths && !drag.nativeDragging && !transfers.job
      ? backend.key === LOCAL_KEY
        ? t("files.browser.draghint.local")
        : t("files.browser.draghint.remote")
      : null,
  );
</script>

{#snippet fileLead()}
  <BrowserNav
    canBack={nav.canBack}
    canForward={nav.canForward}
    disabled={offline}
    onback={() => void nav.go("back")}
    onforward={() => void nav.go("forward")}
  />
  <BrowserViewPick {view} {onview} />
{/snippet}

{#snippet fileBar(head: boolean)}
  <BrowserToolbar
    inHead={head}
    nav={fileLead}
    navSpan={placesLayout.span}
    folded={placesLayout.fold}
    foldOver={placesLayout.foldOver}
    {tools}
    {menuTools}
    disabled={offline}
  >
    {#snippet location()}
      <LocationBar
        bind:this={locationBar}
        bind:draft={pathDraft}
        crumbs={shownCrumbs}
        current={ls.cwd}
        dropTarget={drag.dropDir}
        disabled={offline}
        flat={head}
        placeholder={backend.sep === "\\"
          ? t("files.browser.path.placeholder")
          : t("files.browser.path.placeholder.posix")}
        onnavigate={goTo}
        onsubmit={submitPath}
        onrefresh={refresh}
        onfocuschange={(focused) => (pathFocused = focused)}
        onescape={() => rootEl?.focus({ preventScroll: true })}
        ondragover={drag.dirDragOver}
        ondragleave={drag.dirDragLeave}
        ondrop={drag.applyDrop}
      />
    {/snippet}
  </BrowserToolbar>
{/snippet}

<!-- 창에 붙인 것은 손이 줄 밖으로 나가도 같은 포인터를 따라가야 해서다(`setPointerCapture` 는 OLE 몫이라 걸 수 없다) — 플러그인의 끝 신호가 안 오는 경우의 보험도 겸한다 (docs/log/2026-09-04-native-drag-out.md) -->
<svelte:window
  onkeydown={keys.onKeydown}
  onpointermove={drag.pointerMove}
  onpointerup={drag.pointerEnd}
  onpointercancel={drag.pointerEnd}
/>

<!-- 타일의 키보드 몸 — `Alt+화살표`로 들어오면 `PaneHost` 가 여기에 포커스를 준다 · 경로 칸의 Escape 가 물러날 자리 -->
<div
  class="sftp"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  bind:clientWidth={tileW}
  oncontextmenu={(ev) => mc.openMenu(ev, null)}
  onmouseup={nav.mouseUp}
  onauxclick={nav.auxClick}
>
  {#if !inHead}{@render fileBar(false)}{/if}

  {#if backend.canUpload}
    <!-- 도구줄이 머리줄로 오가도 남게 몸에 둔다 -->
    <input
      class="hidden-input"
      type="file"
      multiple
      tabindex="-1"
      aria-hidden="true"
      bind:this={fileInput}
      onchange={actions.onPicked}
    />
  {/if}

  <!-- 배너 둘을 같은 문구로 접지 않는다 — 기다려야 할지 닫아야 할지 모른다 -->
  {#if sourceGone}
    <p class="banner gone">{t("files.browser.source.gone")}</p>
  {:else if offline}
    <p class="banner wait">
      {alias
        ? t("files.browser.offline.alias", { alias })
        : t("files.browser.offline")}
    </p>
  {/if}

  {#if ls.error}
    <p class="banner err">
      <span class="err-text">{ls.error}</span>
      <button type="button" class="retry" onclick={refresh} disabled={offline}>
        {t("files.browser.retry")}
      </button>
    </p>
  {/if}

  <div class="body">
    {#if placesLayout.mode !== "none"}
      <PlacesPanel
        sections={placeSecs}
        current={ls.cwd}
        width={placesLayout.boxW}
        mini={placesLayout.mode === "mini"}
        dropTarget={drag.dropDir}
        disabled={offline}
        onpick={goTo}
        ondragover={drag.dirDragOver}
        ondragleave={drag.dirDragLeave}
        ondrop={drag.applyDrop}
      />
    {/if}
    <div class="main">
      {#if filterOn}
        <FilterBar bind:this={filterBar} bind:query={filterQuery} count={filtered.count} onclose={closeFilter} />
      {/if}

      <FileList
        {rows}
        totalCount={ls.entries.length}
        selection={sel}
        {order}
        {marquee}
        {drag}
        backendKey={backend.key}
        cwd={ls.cwd}
        hasCwd={ls.hasCwd}
        loading={ls.loading}
        slowLoad={ls.slowLoad}
        {canExport}
        mode={view}
        iconScale={iconZoomScale(zoom)}
        onzoom={(delta) => setZoom(stepIconZoom(zoom, delta))}
        isLocked={isRootItem}
        onopen={actions.openEntry}
        onmenu={mc.openMenu}
        ontoggle={toggleRow}
        onmore={ls.showMore}
        filter={filterOn ? filterQuery : ""}
        matched={filtered.matched}
        bind:el={listEl}
      />

      <TransferPanel
        job={transfers.job}
        percent={transfers.percent}
        pending={transfers.pending}
        hint={dragHint}
        oncancel={() => void transfers.cancelJob()}
        onresolve={(policy: OnConflict) => void transfers.resolveConflicts(policy)}
        ondismiss={() => transfers.dismiss()}
      />

      <FileStatusBar
        folder={folderSum}
        selection={selectionSum}
        {space}
        iconsView={view === "icons"}
        {zoom}
        onzoom={setZoom}
      />
    </div>
    {#if preview}
      <PreviewPanel {backend} subject={previewSubj} {folderName} folder={folderSum} {itemCountOf} />
    {/if}
  </div>
</div>

{#if mc.menu}
  <!-- 붙여넣기 · 업로드 · 새 폴더는 메뉴가 연 순간의 `menuDir` 로 간다 — 메뉴가 닫힌 뒤에 도는 항목이라 `menu` 를 읽을 수 없다 -->
  <FileMenu
    menu={mc.menu}
    mode={mc.menuMode}
    edit={mc.edit}
    {backend}
    cwd={ls.cwd}
    newFolderDir={mc.newFolderDir}
    tree={isTree}
    atRoot={mc.menu.entry
      ? (sel.count >= 2 ? selPaths : [mc.menu.entry.path]).some(isRootItem)
      : atRoot}
    {isLocal}
    selCount={sel.count}
    {selPaths}
    {selHasFolder}
    busy={transfers.job !== null}
    hasClip={fsClip() !== null}
    removeTargets={mc.removeTargets}
    confirmRecursive={mc.confirmRecursive}
    {sourcePaneId}
    onclose={mc.closeMenu}
    oncut={() => actions.copySelection("cut")}
    oncopy={() => actions.copySelection("copy")}
    onpaste={() => actions.pasteInto(mc.menuDir)}
    ondownload={(paths) => void transfers.startDownload(paths)}
    onexport={(paths) => void transfers.exportToFolder(paths)}
    ontodevice={(paths) => void transfers.downloadToDevice(paths)}
    onopenentry={actions.openEntry}
    onpreview={onopendoc ? (e) => onopendoc(e.path) : undefined}
    oneditentry={(e) => void actions.editEntry(e)}
    onopenexternal={(e) => void actions.openExternally(e)}
    onreveal={(e) => void actions.revealEntry(e)}
    oncopypath={(e) => void actions.copyPath(e)}
    onstartrename={() => void mc.startRename()}
    onstartremove={mc.startRemove}
    onstartnewfolder={() => void mc.startNewFolder(mc.menuDir)}
    onstartnewfile={() => void mc.startNewFile(mc.menuDir)}
    onpickupload={() => actions.pickUpload(mc.menuDir)}
    onimportfolders={() => void transfers.importFolders(mc.menuDir)}
    onrevealhere={() => void actions.revealHere()}
    onrefresh={refresh}
    oncdhere={actions.cdHere}
    onsubmitrename={() => void mc.submitRename()}
    onsubmitnewfolder={() => void mc.submitNewFolder()}
    onsubmitnewfile={() => void mc.submitNewFile()}
    onsubmitremove={(recursive) => void mc.submitRemove(recursive)}
  />
{/if}

<style>
  /* `--term-bg` 를 쓰면 투명도 슬라이더가 안 먹는다 */
  .sftp {
    /* 충돌 대화상자(`.dialog-veil`)의 좌표 원점 — 그 물음은 이 타일 안에 갇혀야 한다 */
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    /* 글래스 크롬 타일이면 판은 타일 상자가 한 번 칠한다 */
    background: var(--tile-inner, var(--bg-panel));
    border-radius: inherit;
    font-family: var(--font-ui);
    container: file-tile / inline-size;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }


  /* 포커스 링을 그리면 타일 활성 테두리와 이중으로 겹친다 */
  .sftp:focus {
    outline: none;
  }

  .hidden-input {
    display: none;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1.4;
    border-bottom: 1px solid var(--border);
  }

  .banner.wait {
    color: var(--warn);
    background: var(--warn-soft);
  }

  .banner.gone,
  .banner.err {
    color: var(--err);
    background: var(--err-soft);
  }

  .err-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .retry {
    flex: 0 0 auto;
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .retry:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
