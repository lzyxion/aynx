<script lang="ts">
  import { flushSync, tick } from "svelte";
  import { loadHosts, type HostEntry } from "$lib/hosts";
  import { hostActions } from "$lib/pane/host-actions";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";
  import { clockBoxSize } from "$lib/start-clock";
  import {
    mirrorPaletteQuery,
    openPalette,
    paletteMirror,
    releasePaletteMirror,
  } from "$lib/app/overlays.svelte.js";
  import { addLocal, knownShellList } from "$lib/app/panes.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { dockAgentPanes, dockProjectFolders } from "$lib/app/dock-dots.svelte.js";
  import { projectDots } from "$lib/dock-dots";
  import {
    checkLocalRecentWorktrees,
    recentOpens,
    restoreRecentOpens,
  } from "$lib/app/recent-worktrees.svelte.js";
  import {
    launcherProjectRows,
    projectOpenedAt,
    resolveRecentWorktrees,
    withRecentWorktrees,
    type LauncherProjectRow,
  } from "$lib/recent-worktrees";
  import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
  import { historyOf, recentHosts } from "$lib/host-history";
  import { settings } from "$lib/settings.svelte.js";
  import { effectiveDefaultShellId, type ShellList } from "$lib/session";
  import {
    firstLauncherPos,
    launcherMove,
    launcherSeed,
    shellColumn,
    type LauncherArea,
    type LauncherDir,
    type LauncherPos,
  } from "$lib/launcher";
  import {
    boardBounds,
    clampClockResize,
    clampResize,
    dragLanding,
    FIT_PADDING,
    fitScale,
    isNarrowBoard,
    narrowStack,
    LAYOUT_LIFT,
    widgetCapacity,
    widgetColumns,
    widgetRowsPerColumn,
    withNewWidget,
    withoutWidget,
    withWidgetBox,
    withWidgetSize,
    type Box,
    type Guide,
    type StartWidget,
    type StartWidgetKind,
  } from "$lib/start-widgets";
  import {
    canUndoStartBoard,
    clockOptions,
    editStartBoard,
    resetStartWidgets,
    undoStartBoard,
    setClockOptions,
    setStartWidgets,
    startBoardEditable,
    startWidgets,
  } from "$lib/start-widgets.svelte.js";
  import { isRemote, sortProjects, type Project } from "$lib/projects";
  import { projectMarkers } from "$lib/app/project-locations.svelte.js";
  import { openProject, openProjectHere, openProjectWorktree, openProjectWorktreeHere, projects, worktreesOf } from "$lib/app/projects.svelte.js";
  import StartWidgetFrame from "$lib/start/StartWidgetFrame.svelte";
  import HostsWidget from "$lib/start/HostsWidget.svelte";
  import ProjectsWidget from "$lib/start/ProjectsWidget.svelte";
  import ShellsWidget from "$lib/start/ShellsWidget.svelte";
  import ClockWidget from "$lib/start/ClockWidget.svelte";
  import StartBoardMenu from "$lib/start/StartBoardMenu.svelte";
  import StartWidgetMenu from "$lib/start/StartWidgetMenu.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * 시작 화면 — 위젯 판 (docs/log/2026-09-25-launcher.md · 2026-10-28-start-widgets.md).
   * 줄은 이미 있는 여는 함수(`onconnect` · `openProject` · `addLocal`)를 그대로 부른다 — 다른 길로 연 것과 규칙(시작 타일 교체 ·
   * 기본 셸 · 탭 자동 생성)이 갈리지 않게.
   * 원격 창은 판 우클릭이 메뉴를 열지 않으면 편집의 모든 길이 닫힌다 — 다른 입구가 없다(`startBoardEditable`) (docs/log/2026-11-04-start-board-mirror.md).
   * 주기 박자는 숨은 시작 화면 · 뒤에 있는 창에서 건너뛴다 — 시작 타일은 탭마다 하나씩 살아 있을 수 있다.
   */

  let {
    hosts = [],
  }: {
    /** 상위 캐시(`+page` 의 `hostCache`) — 비어 있을 수 있어 아래 `$effect` 가 스스로 한 번 읽는다 */
    hosts?: HostEntry[];
  } = $props();

  // ── 호스트 조작 ──
  const actions = hostActions();
  const { onconnect, onhosts } = actions;
  const refreshKey = $derived(actions.refreshKey ?? 0);

  let loaded = $state<HostEntry[] | null>(null);

  $effect(() => {
    void refreshKey;
    let alive = true;
    void loadHosts(t).then((cfg) => {
      if (!alive) return;
      loaded = cfg.hosts;
      onhosts?.(cfg.hosts);
    });
    return () => {
      alive = false;
    };
  });

  const list = $derived(loaded ?? hosts);

  /** 상대 시각의 "지금" — 판에 손 · 포커스가 올 때도 다시 읽는다(숨었다 다시 보인 탭이 다음 박자를 기다리지 않게) */
  let now = $state(Date.now());
  const touchNow = () => (now = Date.now());
  const visibleNow = () => !document.hidden && (root?.checkVisibility() ?? false);
  $effect(() => {
    const id = setInterval(() => {
      if (visibleNow()) touchNow();
    }, 30_000);
    const onVisibility = () => {
      if (visibleNow()) touchNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // ── 판 ──

  const layout = $derived(startWidgets());
  const placedKinds = $derived(layout.map((w) => w.kind));

  let root = $state<HTMLDivElement | null>(null);
  /**
   * 판의 내용 상자 — `bind:clientWidth` 를 쓰지 않는다: 그것은 바깥 상자 변화에만 다시 재서, 좁은 판에 굴림 막대가 서도
   * 폭이 그대로 남는다(쌓인 카드가 막대만큼 치우친다).
   */
  let boardRect = $state<DOMRectReadOnly | null>(null);
  const boardW = $derived(boardRect?.width ?? 0);
  const boardH = $derived(boardRect?.height ?? 0);
  const narrow = $derived(isNarrowBoard(layout, boardW, boardH));
  /** 놓인 배치로만 잰다 — 끄는 · 크기를 바꾸는 동안 판이 흔들리지 않게 */
  const scale = $derived(narrow ? 1 : fitScale(layout, boardW, boardH));
  const bounds = $derived(boardBounds(boardW, boardH, scale));
  const stack = $derived(narrow ? narrowStack(layout, boardW, boardH) : null);
  const stackBy = $derived(new Map((stack?.boxes ?? []).map((b) => [b.kind, b])));

  /** 끄기 · 크기 손짓을 따로 두는 것은 줄 목록이 크기 손짓만 읽게 하려는 것이다 — 끄는 동안 포인터마다 목록을 다시 셈하지 않는다 */
  type DragGesture = { kind: StartWidgetKind; startX: number; startY: number; orig: StartWidget; dx: number; dy: number; landing: Box; guides: Guide[] };
  /** `font` — 시계만 */
  type ResizeGesture = { kind: StartWidgetKind; startX: number; startY: number; orig: StartWidget; box: Box; font?: number };
  let drag = $state<DragGesture | null>(null);
  let resize = $state<ResizeGesture | null>(null);

  function shownBox(w: StartWidget): Box {
    if (narrow) return stackBy.get(w.kind) ?? w;
    return resize?.kind === w.kind ? resize.box : w;
  }

  function capOf(kind: StartWidgetKind): number {
    const w = layout.find((x) => x.kind === kind);
    if (!w) return 0;
    const b = shownBox(w);
    return widgetCapacity(b.w, b.h);
  }

  // ── 위젯의 줄들 ──

  const recent = $derived(recentHosts(list, hostHistory(), capOf("hosts")));

  $effect(() => restoreRecentOpens());
  const recentWorktrees = $derived(resolveRecentWorktrees(projects(), recentOpens(), worktreesOf, remoteHomeOf));
  $effect(() => checkLocalRecentWorktrees(recentWorktrees));
  const projectRows = $derived.by((): LauncherProjectRow[] => {
    const history = hostHistory();
    const opens = recentOpens();
    const folders = withRecentWorktrees(dockProjectFolders(), recentWorktrees, remoteHomeOf);
    const dots = projectDots(dockAgentPanes(), folders, remoteHomeOf, t);
    const timeOf = (p: Project) => {
      const host = isRemote(p) ? (historyOf(history, p.host)?.last_ok_at ?? null) : null;
      const own = projectOpenedAt(opens, p.id);
      return host === null ? own : own === null ? host : Math.max(host, own);
    };
    return launcherProjectRows(
      sortProjects(projects(), "recent", history),
      recentWorktrees,
      timeOf,
      dots,
      folders,
      remoteHomeOf,
      capOf("projects"),
      (row) => projectMarkers(row.project, row.kind === "worktree" ? row.path : undefined).here,
    );
  });

  function openProjectRow(row: LauncherProjectRow, here = false) {
    if (row.kind === "project") void (here ? openProjectHere : openProject)(row.project);
    else
      void (here ? openProjectWorktreeHere : openProjectWorktree)(row.project, {
        path: row.path,
        branch: row.name,
        head: null,
        bare: false,
        detached: false,
      });
  }

  /** 도착 전에는 위젯이 비어 있다 — "터미널" 을 먼저 그렸다가 바꾸면 줄이 한 번 깜빡인다 */
  let shellList = $state<ShellList | null>(null);
  $effect(() => {
    let alive = true;
    void knownShellList().then((l) => {
      if (alive) shellList = l;
    });
    return () => {
      alive = false;
    };
  });

  const defaultShellId = $derived(
    shellList ? effectiveDefaultShellId(shellList.shells, settings.defaultShell, shellList.default_id) : null,
  );
  const shellCol = $derived(shellColumn(shellList?.shells ?? [], defaultShellId, capOf("shells")));

  const itemsByKind = $derived.by(() => {
    const shellItems: Extract<LaunchItem, { kind: "shell" }>[] = shellCol.shells.map((shell) => ({
      key: `shell:${shell.id}`,
      kind: "shell",
      shell,
      isDefault: shell.id === defaultShellId,
    }));
    // 감지가 비었다 — "터미널" 한 줄로 백엔드 폴백에 맡긴다
    if (shellList && shellItems.length === 0 && capOf("shells") > 0)
      shellItems.push({ key: "shell:", kind: "shell", shell: null, isDefault: true });
    return {
      clock: [] as LaunchItem[],
      hosts: recent.map((host): Extract<LaunchItem, { kind: "host" }> => ({ key: `host:${host.name}`, kind: "host", host })),
      projects: projectRows.map((row): Extract<LaunchItem, { kind: "project" }> => ({ key: row.key, kind: "project", row })),
      shells: shellItems,
    };
  });

  // ── 선택 ──
  // 선택은 줄의 키 글자로 든다(자리 번호가 아니다) — 줄 순서가 달라져도 고른 것이 남는다.
  // 포커스는 숨은 입력칸 하나(`holder`)가 쥔다 — 줄 단추가 쥐면 Windows IME 가 꺼져 한글 첫 키가 `g` 로 온다
  // (docs/log/2026-09-25-launcher.md 3절).

  const areaItems = $derived(layout.map((w): readonly LaunchItem[] => itemsByKind[w.kind]));

  const areas = $derived(
    layout.map((w, i): LauncherArea => {
      const b = shownBox(w);
      return { size: areaItems[i].length, rect: b, rows: widgetRowsPerColumn(b.h), cols: widgetColumns(b.w) };
    }),
  );

  let selKey = $state<string | null>(null);

  function posOf(key: string | null): LauncherPos | null {
    if (key === null) return null;
    for (let area = 0; area < areaItems.length; area++) {
      const index = areaItems[area].findIndex((it) => it.key === key);
      if (index >= 0) return { area, index };
    }
    return null;
  }

  const selPos = $derived.by((): LauncherPos | null => {
    const at = posOf(selKey);
    if (at) return at;
    const def = itemsByKind.shells.find((it) => it.isDefault);
    return posOf(def?.key ?? null) ?? firstLauncherPos(areas);
  });
  const selected = $derived(selPos ? (areaItems[selPos.area]?.[selPos.index] ?? null) : null);

  let holder = $state<HTMLInputElement | null>(null);
  /** 키 글자는 아무 글자나 들어 `id` 는 위젯 종류 · 자리로 짓는다 */
  const uid = $props.id();
  const optId = (kind: StartWidgetKind, index: number) => `${uid}-${kind}-${index}`;
  const activeId = $derived(selPos && layout[selPos.area] ? optId(layout[selPos.area].kind, selPos.index) : undefined);

  async function focusSelected() {
    await tick();
    holder?.focus({ preventScroll: true });
  }

  /**
   * 화살표에서만 — 빈 자리를 누르거나 메뉴를 닫을 때마다 끌려가면 읽던 자리를 잃는다.
   * `scrollIntoView` 는 `overflow: hidden` 인 조상(타일 몸 등)까지 굴려 쓰지 않는다.
   */
  async function revealSelected() {
    await tick();
    if (!narrow || !root || !activeId) return;
    const row = document.getElementById(activeId);
    if (!row) return;
    const r = root.getBoundingClientRect();
    const o = row.getBoundingClientRect();
    const pad = FIT_PADDING;
    if (o.top < r.top + pad) root.scrollTop -= r.top + pad - o.top;
    else if (o.bottom > r.bottom - pad) root.scrollTop += o.bottom - (r.bottom - pad);
  }

  function select(key: string) {
    selKey = key;
    void focusSelected();
  }

  function moveSel(dir: LauncherDir) {
    const next = launcherMove(areas, selPos, dir);
    const item = next ? areaItems[next.area]?.[next.index] : null;
    if (!item) return;
    select(item.key);
    void revealSelected();
  }

  /** 편집 모드에서는 열지 않는다 — 몸 전체가 끄는 자리다 */
  function activate(item: LaunchItem) {
    if (editing) return;
    if (item.kind === "host") onconnect(item.host);
    else if (item.kind === "project") openProjectRow(item.row);
    else if (item.kind === "shell") void addLocal(item.shell ?? undefined);
  }

  function handlersFor(kind: StartWidgetKind): LaunchRowHandlers {
    return {
      selectedKey: selected?.key ?? null,
      optId: (i) => optId(kind, i),
      onselect: select,
      onactivate: activate,
    };
  }

  function onRootFocus(ev: FocusEvent) {
    if (ev.target === root) void focusSelected();
  }

  /** 탭이 하나도 없을 때의 본문에는 타일 포커스 라우팅이 없다 — `<body>` 에 떨어진 포커스를 스스로 받는다 */
  $effect(() => {
    if (!root || !holder || root.closest("[data-pane]")) return;
    const active = document.activeElement;
    if (active === null || active === document.body) holder.focus({ preventScroll: true });
  });

  const DIRS: Record<string, LauncherDir> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

  /** 다루는 것만 멈춰 세운다 — 시작 화면이 떠 있는 동안 전역 단축키가 죽으면 안 된다 */
  function onKeydown(ev: KeyboardEvent) {
    if (ev.defaultPrevented) return;
    const target = ev.target instanceof Element ? ev.target : null;

    if (editing && ev.key === "Escape" && !drag && !resize) {
      ev.preventDefault();
      ev.stopPropagation();
      editing = false;
      return;
    }

    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && (ev.code === "Enter" || ev.code === "NumpadEnter")) {
      if (selected?.kind === "project") {
        ev.preventDefault(); ev.stopPropagation(); openProjectRow(selected.row, true); return;
      }
    }

    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const dir = DIRS[ev.code];
      if (dir) {
        ev.preventDefault();
        moveSel(dir);
        return;
      }
      // 주인은 입력칸이라 스페이스를 그대로 두면 빈칸이 찍힌다
      const onBody = target === holder || target === root || !!target?.hasAttribute("data-launch-key");
      if ((ev.code === "Enter" || ev.code === "NumpadEnter" || ev.code === "Space") && onBody) {
        ev.preventDefault();
        if (selected) activate(selected);
        return;
      }
    }

    // IME 조합 시작은 여기서 막지 않는다 — 조합이 주인에서 시작돼야 `compositionstart` 가 팔레트를 거울 모드로 연다
    const seed = launcherSeed(ev);
    if (seed) {
      ev.preventDefault();
      openPalette(seed);
    }
  }

  // ── 한글 IME ──
  // 조합 중에 포커스를 옮기면 Chromium 이 조합을 취소한다(첫 자모가 사라진다) — 조합 동안 포커스는 주인에 두고 팔레트는
  // 거울 모드로 비추기만, 조합 아닌 키가 처음 올 때 넘긴다(`handOver`) (docs/log/2026-09-25-launcher.md 3절).

  const PALETTE_KEYS = new Set(["Escape", "ArrowUp", "ArrowDown", "Enter"]);

  let composing = false;

  function onCompositionStart() {
    composing = true;
    if (paletteMirror() !== null) return;
    openPalette("", { mirror: true });
  }

  function onCompositionEnd() {
    composing = false;
    if (!holder) return;
    if (paletteMirror() !== null) mirrorPaletteQuery(holder.value);
    else holder.value = "";
  }

  function onHolderInput() {
    if (!holder) return;
    if (paletteMirror() !== null) mirrorPaletteQuery(holder.value);
    else if (!composing) holder.value = "";
  }

  /** 이 keydown 안에서 포커스까지 옮긴다(`flushSync`) — 나머지 키의 기본 동작이 옮겨 간 입력칸에서 돌게 */
  function handOver(ev: KeyboardEvent) {
    if (!holder) return;
    let text = holder.value;
    const mods = ev.ctrlKey || ev.altKey || ev.metaKey;
    const printable = !mods && ev.key.length === 1;
    const backspace = !mods && ev.key === "Backspace";
    if (printable) text += ev.key;
    else if (backspace) text = text.slice(0, -1);
    const forward = !printable && !backspace && (mods || PALETTE_KEYS.has(ev.key));
    if (printable || backspace || forward) {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 전역 처리기(Escape 사슬 등)가 같은 키를 한 번 더 먹지 않게
    }
    // 질의를 먼저 싣고 거울을 걷는다 — 순서가 뒤집히면 마지막 글자가 빠진다
    mirrorPaletteQuery(text);
    flushSync();
    releasePaletteMirror();
    holder.value = "";
    flushSync();
    if (!forward) return;
    const to = document.activeElement;
    if (to && to !== holder)
      to.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ev.key,
          code: ev.code,
          ctrlKey: ev.ctrlKey,
          shiftKey: ev.shiftKey,
          altKey: ev.altKey,
          metaKey: ev.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
  }

  function onHolderKeydown(ev: KeyboardEvent) {
    if (paletteMirror() === null) return;
    if (ev.isComposing || ev.key === "Process") {
      ev.stopPropagation(); // 조합 중 — 뿌리의 화살표 = 줄 선택이 돌면 안 된다
      return;
    }
    handOver(ev);
    ev.stopPropagation();
  }

  function onHolderBlur() {
    if (paletteMirror() !== null) releasePaletteMirror();
    if (holder && !composing) holder.value = "";
  }

  // ── 옮기기 · 크기 바꾸기 ──

  let detach: (() => void) | null = null;

  function othersOf(kind: StartWidgetKind): StartWidget[] {
    return layout.filter((w) => w.kind !== kind);
  }

  /** 문턱을 넘어야 끌기가 선다 — 그 전에 떼면 머리 줄의 × 클릭이 그대로 산다. 기본 동작은 막지 않는다 */
  const DRAG_THRESHOLD = 4;

  function armDrag(w: StartWidget, ev: PointerEvent) {
    // 좁은 판은 쌓아 그린 자리라 저장된 배치의 좌표와 맞지 않는다
    if (ev.button !== 0 || drag || resize || narrow || detach || !editing) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest("[data-widget-remove], [data-widget-resize]")) return;
    const sx = ev.clientX;
    const sy = ev.clientY;
    const disarm = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", disarm);
      window.removeEventListener("pointercancel", disarm);
      window.removeEventListener("blur", disarm);
      if (detach === disarm) detach = null;
    };
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < DRAG_THRESHOLD) return;
      disarm();
      window.getSelection()?.removeAllRanges();
      startGesture("drag", w, sx, sy);
      onGestureMove(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", disarm);
    window.addEventListener("pointercancel", disarm);
    window.addEventListener("blur", disarm);
    detach = disarm;
  }

  function beginResize(w: StartWidget, ev: PointerEvent) {
    if (ev.button !== 0 || drag || resize || narrow) return;
    ev.preventDefault();
    ev.stopPropagation();
    detach?.();
    startGesture("resize", w, ev.clientX, ev.clientY);
  }

  function startGesture(type: "drag" | "resize", w: StartWidget, startX: number, startY: number) {
    const base = { kind: w.kind, startX, startY, orig: { ...w } };
    const box = { x: w.x, y: w.y, w: w.w, h: w.h };
    if (type === "drag") drag = { ...base, dx: 0, dy: 0, landing: box, guides: [] };
    else resize = { ...base, box, font: w.kind === "clock" ? clockOptions().size : undefined };
    const move = (e: PointerEvent) => onGestureMove(e);
    const up = () => endGesture(true);
    const cancel = () => endGesture(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      endGesture(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  }

  function onGestureMove(ev: PointerEvent) {
    const g = drag ?? resize;
    if (!g) return;
    const s = scale > 0 ? scale : 1;
    const dx = (ev.clientX - g.startX) / s;
    const dy = (ev.clientY - g.startY) / s;
    const others = othersOf(g.kind);
    if (drag) {
      const { landing, guides } = dragLanding(drag.orig, dx, dy, others, bounds);
      drag = { ...drag, dx, dy, landing, guides };
    } else if (resize?.kind === "clock") {
      const opts = clockOptions();
      const lang = locale();
      const r = clampClockResize(resize.orig, opts.size, resize.orig.w + dx, resize.orig.h + dy, others, bounds, (size) =>
        clockBoxSize(lang, { ...opts, size }),
      );
      resize = { ...resize, box: r.box, font: r.font };
    } else if (resize) {
      resize = { ...resize, box: clampResize(resize.orig, resize.orig.w + dx, resize.orig.h + dy, others, bounds) };
    }
  }

  function endGesture(commit: boolean) {
    const g = drag
      ? { kind: drag.kind, orig: drag.orig, next: drag.landing, font: undefined }
      : resize
        ? { kind: resize.kind, orig: resize.orig, next: resize.box, font: resize.font }
        : null;
    detach?.();
    detach = null;
    drag = null;
    resize = null;
    if (!g || !commit) return;
    const { next, orig: o } = g;
    // 시계의 글자 크기와 박스를 한 조작으로 기록한다
    editStartBoard(() => {
      if (g.font !== undefined && g.font !== clockOptions().size) setClockOptions({ ...clockOptions(), size: g.font });
      if (next.x !== o.x || next.y !== o.y || next.w !== o.w || next.h !== o.h)
        setStartWidgets(withWidgetBox(layout, g.kind, next));
    });
    void focusSelected();
  }

  $effect(() => () => detach?.());

  /** 시계 박스 = 글자를 감싼 크기 — 표시 · 언어가 바뀌면 다시 맞춘다 */
  $effect(() => {
    const clock = layout.find((w) => w.kind === "clock");
    if (!clock || drag || resize) return;
    const want = clockBoxSize(locale(), clockOptions());
    if (clock.w === want.w && clock.h === want.h) return;
    setStartWidgets(withWidgetSize(layout, "clock", want, narrow ? null : bounds));
  });

  // 손짓 도중 판이 좁아졌다 — 그 손짓은 넓은 판의 좌표라 놓지 않고 거둔다
  $effect(() => {
    if (narrow && (drag || resize)) endGesture(false);
  });

  function kindTitle(kind: StartWidgetKind): string {
    return t(
      kind === "clock"
        ? "app.start.col.clock"
        : kind === "hosts"
          ? "app.start.col.hosts"
          : kind === "projects"
            ? "app.start.col.projects"
            : "app.start.col.shells",
    );
  }

  function removeWidget(kind: StartWidgetKind) {
    editStartBoard(() => setStartWidgets(withoutWidget(layout, kind)));
    void focusSelected();
  }

  // ── 판 메뉴 ──

  let menu = $state<{ x: number; y: number } | null>(null);
  /** `menu` 와 따로 둔 평범한 변수다 — 항목은 메뉴를 닫은 뒤에 돌아 닫힌 메뉴의 값을 읽지 않게(`menu-runner`) */
  let addAt = { x: 0, y: 0 };

  /** 창 좌표 → 판 좌표(판 가운데 기준 · 배율로 나눔) */
  function toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const r = root?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const s = scale > 0 ? scale : 1;
    return { x: (clientX - (r.left + r.width / 2)) / s, y: (clientY - (r.top + r.height / 2)) / s };
  }

  /** 판을 고치는 줄은 위젯 메뉴에 두지 않는다(사용자 결정) */
  function onBoardContextMenu(ev: MouseEvent) {
    const target = ev.target instanceof Element ? ev.target : null;
    if (drag || resize || ev.defaultPrevented) return;
    // 원격 창은 메인 PC 한 벌을 따른다 — 편집의 유일한 입구가 이 메뉴다
    if (!startBoardEditable()) {
      ev.preventDefault();
      return;
    }
    const widget = target?.closest<HTMLElement>("[data-start-widget]");
    if (widget) {
      ev.preventDefault();
      menu = null;
      const clock = widget.dataset.startWidget === "clock";
      widgetMenu = clock || !editing ? { x: ev.clientX, y: ev.clientY, clock } : null;
      return;
    }
    ev.preventDefault();
    widgetMenu = null;
    // 좁은 판의 누른 자리는 저장된 배치의 어디와도 맞지 않는다 — 판 가운데 조금 위로 둔다
    addAt = narrow ? { x: 0, y: -LAYOUT_LIFT } : toBoard(ev.clientX, ev.clientY);
    menu = { x: ev.clientX, y: ev.clientY };
  }

  function closeMenu() {
    menu = null;
    void focusSelected();
  }

  // ── 편집 모드 ──
  // 저장하지 않는다(다시 켜면 잠김). 위젯 밖 빈 자리 누르기로는 나오지 않는다 — 잘못 누르면 바로 나가져서(사용자 결정).

  let editing = $state(false);

  function toggleEditing() {
    editing = !editing;
  }

  $effect(() => {
    if (!editing || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.every((e) => !e.isIntersecting)) editing = false;
    });
    io.observe(root);
    return () => io.disconnect();
  });

  let widgetMenu = $state<{ x: number; y: number; clock: boolean } | null>(null);

  function closeWidgetMenu() {
    widgetMenu = null;
    void focusSelected();
  }

  function resetBoard() {
    editStartBoard(resetStartWidgets);
  }

  /** 좁은 판에서는 경계 없이(`null`) 넣는다 — 좁은 판의 경계는 저장된 배치의 좌표와 상관이 없어 가두면 엉뚱한 데로 밀린다 */
  function addWidget(kind: StartWidgetKind) {
    editStartBoard(() => setStartWidgets(withNewWidget(layout, kind, addAt, narrow ? null : bounds)));
  }
</script>

<!-- 타일의 키보드 몸(`data-tile-focus`)은 뿌리가 아니라 숨은 입력칸이다 -->
<div
  class="start"
  class:narrow
  role="presentation"
  tabindex="-1"
  data-launcher
  data-start-narrow={narrow ? "" : undefined}
  bind:this={root}
  bind:contentRect={boardRect}
  onfocus={onRootFocus}
  onfocusin={touchNow}
  onpointerenter={touchNow}
  onkeydown={onKeydown}
  oncontextmenu={onBoardContextMenu}
  data-start-editing={editing ? "" : undefined}
>
  <!-- `display:none` 이 아니다 — 포커스를 받아야 한다. `data-ime-proxy` — 편집 필드로 치지 않는다(전역 단축키가 그대로 먹는다 · `isEditableTarget`) -->
  <input
    class="holder"
    type="text"
    bind:this={holder}
    data-tile-focus
    data-ime-proxy
    aria-label={t("app.start.list.aria")}
    aria-activedescendant={activeId}
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    onkeydown={onHolderKeydown}
    oncompositionstart={onCompositionStart}
    oncompositionend={onCompositionEnd}
    oninput={onHolderInput}
    onblur={onHolderBlur}
  />

  <div
    class="stage"
    class:narrow
    style:transform={scale < 1 ? `scale(${scale})` : undefined}
    style:--start-scale={scale}
    style:height={stack ? `${stack.height}px` : undefined}
    data-start-scale={scale}
  >
    {#if drag}
      <div
        class="outline landing"
        style:width="{drag.landing.w}px"
        style:height="{drag.landing.h}px"
        style:transform="translate({drag.landing.x}px, {drag.landing.y}px)"
        data-widget-landing
      ></div>
      {#each drag.guides as g (g.axis + g.at)}
        <div
          class="guide {g.axis}"
          style:transform={g.axis === "x" ? `translate(${g.at}px, ${g.from}px)` : `translate(${g.from}px, ${g.at}px)`}
          style:width={g.axis === "y" ? `${g.to - g.from}px` : undefined}
          style:height={g.axis === "x" ? `${g.to - g.from}px` : undefined}
          data-widget-guide={g.axis}
        ></div>
      {/each}
    {:else if resize}
      <div
        class="outline previous"
        style:width="{resize.orig.w}px"
        style:height="{resize.orig.h}px"
        style:transform="translate({resize.orig.x}px, {resize.orig.y}px)"
      ></div>
      {#if resize.kind !== "clock"}
        <div
          class="size-tip"
          style:transform="translate({resize.box.x + resize.box.w + 8}px, {resize.box.y + resize.box.h - 24}px)"
          data-widget-size-tip
        >
          {t("app.start.widget.rows", { n: widgetCapacity(resize.box.w, resize.box.h) })}
        </div>
      {/if}
    {/if}

    {#each layout as w (w.kind)}
      {@const box = shownBox(w)}
      {@const items = itemsByKind[w.kind]}
      <StartWidgetFrame
        kind={w.kind}
        title={kindTitle(w.kind)}
        {box}
        offset={drag?.kind === w.kind ? { dx: drag.dx, dy: drag.dy } : null}
        mode={drag?.kind === w.kind ? "drag" : resize?.kind === w.kind ? "resize" : null}
        fixed={narrow}
        {editing}
        bare={w.kind === "clock"}
        rows={widgetRowsPerColumn(box.h)}
        count={items.length}
        empty={w.kind === "hosts"
          ? t("app.start.empty.hosts")
          : w.kind === "projects"
            ? t("app.start.empty.projects")
            : ""}
        ongrip={(ev) => armDrag(w, ev)}
        onresize={(ev) => beginResize(w, ev)}
        onremove={() => removeWidget(w.kind)}
      >
        {#if w.kind === "clock"}
          <ClockWidget options={clockOptions()} font={resize?.kind === "clock" ? resize.font : undefined} />
        {:else if w.kind === "hosts"}
          <HostsWidget items={itemsByKind.hosts} handlers={handlersFor("hosts")} {now} />
        {:else if w.kind === "projects"}
          <ProjectsWidget items={itemsByKind.projects} handlers={handlersFor("projects")} />
        {:else if w.kind === "shells"}
          <ShellsWidget items={itemsByKind.shells} handlers={handlersFor("shells")} />
        {/if}
      </StartWidgetFrame>
    {/each}
  </div>

  {#if editing}
    <div class="edit-bar" data-start-edit-bar>
      <button
        type="button"
        class="btn"
        data-start-edit-undo
        disabled={!canUndoStartBoard()}
        title={t("app.start.board.menu.undo")}
        aria-label={t("app.start.board.menu.undo")}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={undoStartBoard}><UiIcon name="undo" size={16} /></button
      >
      <button
        type="button"
        class="btn btn-primary"
        data-start-edit-done
        title={t("app.start.board.edit.done")}
        aria-label={t("app.start.board.edit.done")}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={() => (editing = false)}><UiIcon name="check" size={16} /></button
      >
      <button
        type="button"
        class="btn"
        data-start-edit-reset
        title={t("app.start.board.menu.reset")}
        aria-label={t("app.start.board.menu.reset")}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={resetBoard}><UiIcon name="reset" size={16} /></button
      >
    </div>
  {/if}
</div>

{#if menu}
  <StartBoardMenu
    x={menu.x}
    y={menu.y}
    placed={placedKinds}
    onclose={closeMenu}
    onadd={addWidget}
    canUndo={canUndoStartBoard()}
    onundo={undoStartBoard}
    onreset={resetBoard}
    {editing}
    onedit={toggleEditing}
  />
{/if}

{#if widgetMenu}
  <StartWidgetMenu
    x={widgetMenu.x}
    y={widgetMenu.y}
    clock={widgetMenu.clock ? clockOptions() : null}
    onclose={closeWidgetMenu}
    onpick={setClockOptions}
    {editing}
    onedit={() => (editing = true)}
  />
{/if}

<style>
  .edit-bar {
    position: absolute;
    top: var(--space-3);
    left: 50%;
    z-index: 5;
    display: flex;
    gap: var(--space-2);
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .edit-bar .btn {
    width: 28px;
    padding: 0;
  }

  /* 배경을 칠하지 않는다 — 불투명한 판을 깔면 창 투명도 슬라이더를 내려도 이 자리만 안 비친다 */
  .start {
    position: absolute;
    inset: 0;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    outline: none;
  }

  .start.narrow {
    overflow-x: hidden;
    overflow-y: auto;
  }

  /* 팔레트 입력칸 자리 · 글자 시작점에 겹친다 — IME 후보 창이 팔레트 입력칸 근처에 뜨게 */
  .holder {
    position: absolute;
    top: 12%;
    left: 50%;
    box-sizing: border-box;
    width: min(var(--palette-w), calc(100% - 2 * var(--space-4)));
    height: 48px;
    margin: 0;
    padding: 0 var(--space-4) 0 calc(var(--space-4) + 16px + var(--space-3));
    font-family: inherit;
    font-size: var(--t-md);
    color: transparent;
    caret-color: transparent;
    background: transparent;
    border: 0;
    outline: none;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%);
  }

  /* 판 가운데의 0 × 0 점 */
  .stage {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }

  .stage.narrow {
    position: relative;
    top: 0;
    left: 0;
    width: 100%;
  }

  .outline {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    border: 1.5px dashed color-mix(in srgb, var(--accent) 70%, transparent);
    border-radius: var(--radius-surface);
    pointer-events: none;
  }

  .outline.landing {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .outline.previous {
    border-color: var(--line-strong);
  }

  .guide {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .guide.x {
    width: 0;
    border-left: 1px dashed var(--accent);
  }

  .guide.y {
    height: 0;
    border-top: 1px dashed var(--accent);
  }

  .size-tip {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 3;
    padding: 2px var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
    white-space: nowrap;
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-raised);
    pointer-events: none;
  }

</style>
