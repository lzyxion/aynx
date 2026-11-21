<script lang="ts">
  import { isBellFlashing } from "$lib/app/bell.svelte.js";
  import { tileGlowOf } from "$lib/app/tile-glow.svelte.js";
  import { touchAgentBanner } from "$lib/app/agent-banners.svelte.js";
  import { clearAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
  import Terminal from "$lib/Terminal.svelte";
  import SftpBrowser from "$lib/SftpBrowser.svelte";
  import DocView from "$lib/DocView.svelte";
  import ImageView from "$lib/ImageView.svelte";
  import { noteImagePath } from "$lib/app/panes.svelte.js";
  import { DOC_ZOOM_DEFAULT } from "$lib/doc-zoom";
  import BranchGraph from "$lib/BranchGraph.svelte";
  import DiffView from "$lib/DiffView.svelte";
  import RunBoard from "$lib/orchestration/RunBoard.svelte";
  import ProducerLeaf from "$lib/orchestration/player/ProducerLeaf.svelte";
  import OrchTransportBar from "$lib/orchestration/OrchTransportBar.svelte";
  import { ORCH_BAR_PX } from "$lib/orchestration/orch-tab";
  import { openBranchGraphOfPane } from "$lib/app/branch-graph.svelte.js";
  import { noteTileMenuPane, registerTileMenuOpener } from "$lib/app/tile-menu-bridge.svelte.js";
  import QueryView from "$lib/QueryView.svelte";
  import { clearDocAnchor, clearDocEdit, clearDocLine, docAnchorOf, docEditOf, docLineOf } from "$lib/app/doc-anchors.svelte.js";
  import SplitView from "$lib/SplitView.svelte";
  import StartPage from "$lib/StartPage.svelte";
  import ProjectStart from "$lib/ProjectStart.svelte";
  import DropOverlay from "$lib/pane/DropOverlay.svelte";
  import PaneHeader from "$lib/pane/PaneHeader.svelte";
  import { albumScreens } from "$lib/app/album-screen.svelte.js";
  import AiFlip from "$lib/pane/AiFlip.svelte";
  import { canFlipPane, flipViewOf, setFlipView } from "$lib/pane/ai-flip.svelte.js";
  import PanePopovers from "$lib/pane/PanePopovers.svelte";
  import { ChipMoreMenuController, type ChipMoreItem } from "$lib/pane/chip-more-menu.svelte.js";
  import { openResourceView } from "$lib/app/usage-view.svelte.js";
  import type { TmuxCardView } from "$lib/pane/tmux-sessions.svelte.js";
  import type { SessionCardView } from "$lib/session-info";
  import { hostBoxes, tabCanvas, zoomOf, type HostBox } from "$lib/pane/boxes";
  import { fileProjectsFor, hostOfPane, isTerminalPane, sourceAlive, tileHeaded } from "$lib/pane/tile-presentation";
  import { createTileMenu } from "$lib/pane/tile-menu-controller.svelte.js";
  import { tabSlide, TabSlideMotion, type TabSlide } from "$lib/pane/tab-slide.svelte.js";
  import { DropController } from "$lib/pane/drop-controller.svelte.js";
  import { dropPreview } from "$lib/pane/drop-preview";
  import { setDropPreviewing } from "$lib/drop-preview-state.svelte.js";
  import { TmuxMenuController } from "$lib/pane/tmux-menu.svelte.js";
  import { AiPermMenuController } from "$lib/pane/ai-perm-menu.svelte.js";
  import { DbAiMenuController, queryAiOf } from "$lib/pane/db-ai-menu.svelte.js";
  import { ForwardMenuController, type ForwardsCardView } from "$lib/pane/forward-menu.svelte.js";
  import { paneAiReadable, paneAiStage } from "$lib/app/delegation.svelte.js";
  import { untrack } from "svelte";
  import { dropLabel } from "$lib/pane/drop-rules";
  import { delegateTileFocus, routeTileFocus } from "$lib/pane/focus";
  import { projects } from "$lib/app/project-list.svelte.js";
  import type { PaneHostProps } from "$lib/pane/props";
  import { hostActions } from "$lib/pane/host-actions";
  import { localBackend, remoteBackend } from "$lib/fs-backend";
  import { boxStyle, GAP } from "$lib/layout";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import {
    layoutAnimating,
    layoutSlideDelay,
    onTileClosing,
    withLayoutAnim,
    TILE_ENTER_MS,
    TILE_ENTER_DELAY_MS,
  } from "$lib/layout-anim.svelte.js";
  import { glassFade, spawnTileGhost } from "$lib/pane/tile-ghost";
  import { cubicOut } from "svelte/easing";
  import type { TransitionConfig } from "svelte/transition";
  import {
    borrowsSession,
    DEFAULT_FILE_ZOOM,
    listPanes,
    type PaneSpec,
    type TabSpec,
  } from "$lib/session";
  import { broadcastInput, isTerminalReport } from "$lib/sync.svelte.js";
  import { isRemote } from "$lib/ipc";
  import { mirrorPlaceholder } from "$lib/app/mirror.svelte.js";
  import { mobileLayout } from "$lib/app/mobile.svelte.js";
  import MirrorPlaceholder from "$lib/pane/MirrorPlaceholder.svelte";
  import { settings } from "$lib/settings.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  let {
    tabs,
    activeId = null,
    focusedPaneOf,
    syncPanes,
    hosts = [],
    keybindings = {},
    onfocuspane,
    onclosepane,
    onzoompane,
    onsyncpane,
    onsplitpane,
    onforwardpane,
    ondetachpane,
    ondrophosts,
    ondroptab,
    onmovepane,
    onfiledrop,
    onfspaste,
    ontearstart,
    ontearoutpane,
    ontearrefused,
    ontearmergeinto,
    oneditremote,
    sessionOf,
    forwardsOf,
    onopenfiles,
    onsftpupload,
    onlocalupload,
    onsftpcwd,
    onlocalcwd,
    onfileview,
    onfileui,
    onopendoc,
    onopenpath,
    ondocmode,
    ondocoutline,
    ondocfiles,
    ondocswitch,
    ondoceditview,
    ondocsplit,
    ondoczoom,
    ondockeep,
    ondocunkeep,
    ondoclink,
    sftpRefreshKey = 0,
    onactivity,
    onstatus,
    onsession,
    ontitle,
    onshell,
    ontmux,
    onopentmux,
    oncommand,
    onmeasure,
    confirmHostKey,
    promptPassword,
    promptPassphrase,
  }: PaneHostProps = $props();

  /** 이 컴포넌트는 통로가 아니다 — 파일 브라우저에 내려 줄 안내 통로(`onnotice`) 하나만 읽는다 */
  const notice = hostActions().onnotice;

  // ── 전역 타일 목록 — 인스턴스 보존 ──
  // 트리를 재귀 컴포넌트로 그리면 잎이 split 으로 바뀌는 순간 Terminal 이 언마운트되고 세션이 끊긴다 —
  // 그래서 타일은 앱에 하나인 `pane.id` 키의 평면 목록으로 그리고, 탭을 옮겨도 같은 DOM 상자가 style 만 바꾼다.

  // ── 탭 전환 슬라이드 ──
  // 상자에 `transform` 만 얹는다 — 레이아웃 크기를 바꾸지 않아 ResizeObserver · fit 이 움직이지 않는다.
  const slide = $derived.by<TabSlide | null>(() => {
    const s = tabSlide();
    return s !== null && s.to === activeId && tabs.some((t) => t.id === s.from) ? s : null;
  });
  const leavingId = $derived(slide?.from ?? null);

  /** 이미 보고 있는 탭은 다시 고를 일이 없다 — 타일을 만진 것으로 배너 · "완료 · 안 봄" 표식을 거둔다 */
  function touchTile(paneId: string): void {
    touchAgentBanner(paneId);
    clearAgentUnseen([paneId]);
  }

  const solo = $derived(mobileLayout());
  const boxes = $derived(hostBoxes(tabs, activeId, focusedPaneOf, leavingId, solo));

  // ── 패널 헤더의 정체성 ──
  // 호스트 메타는 별칭으로 한 스냅숏에서만 읽는다 — 그래야 서로 어긋나지 않는다.

  const hostByName = $derived(new Map(hosts.map((h) => [h.name, h])));

  const zoomCombo = $derived(displayCombo(effectiveCombo("zoom-tile", keybindings)));
  const flipCombo = $derived(displayCombo(effectiveCombo("flip-convo", keybindings)));

  const hostOf = (pane: PaneSpec) => hostOfPane(pane, hostByName);

  const kindById = $derived(new Map(boxes.map((b) => [b.pane.id, b.pane.kind])));

  const headed = (item: HostBox) => tileHeaded(item, solo, settings.tileHeader);

  const sftpSourceAlive = (pane: PaneSpec) => sourceAlive(pane, kindById);

  const sftpSession = (pane: PaneSpec) =>
    pane.sourcePaneId ? (sessionOf?.(pane.sourcePaneId) ?? null) : null;

  /** `remoteBackend` 는 세션 id 마다 객체를 캐시해 다시 계산돼도 같은 값이다 — 브라우저의 효과가 헛돌지 않는다 */
  const sftpBackend = (pane: PaneSpec) => remoteBackend(sftpSession(pane));

  const localFs = localBackend();

  function fileProjectsOf(pane: PaneSpec): { id: string; name: string; path: string }[] {
    return fileProjectsFor(pane, projects());
  }

  const docBackend = (pane: PaneSpec) => (borrowsSession(pane) ? sftpBackend(pane) : localFs);

  /** 집합이 비어 있어도 켜진 것은 켜진 것이다 */
  const syncOn = (tabId: string) => syncPanes.has(tabId);
  const included = (tabId: string, paneId: string) => syncPanes.get(tabId)?.has(paneId) ?? false;

  /**
   * 제외된 패널에서 친 입력은 방송하지 않는다(제외는 양방향이다) · 대상은 그 탭 트리에서만 뽑는다.
   * `true` 면 입력한 패널은 자기 write 를 건너뛴다.
   */
  function broadcast(tab: TabSpec, fromPaneId: string, data: string): boolean {
    // 터미널이 생성한 보고(마우스 추적 · 포커스)는 방송하지 않는다 — TUI 위 마우스 좌표가 형제 셸에 쓰레기로 쏟아진다.
    if (isTerminalReport(data)) return false;
    const set = syncPanes.get(tab.id);
    if (!set) return false;
    if (!set.has(fromPaneId)) return false;
    broadcastInput(
      listPanes(tab.root)
        .map((p) => p.id)
        .filter((id) => set.has(id)),
      data,
    );
    return true;
  }

  // ── 타일 헤더의 ⋯ 메뉴 ──
  const tmc = createTileMenu({
    get boxes() {
      return boxes;
    },
    get solo() {
      return solo;
    },
    get keybindings() {
      return keybindings;
    },
    syncOn,
    included,
    get notice() {
      return notice;
    },
    get onsplitpane() {
      return onsplitpane;
    },
    get forwardsOf() {
      return forwardsOf;
    },
    get onforwardpane() {
      return onforwardpane;
    },
    get oneditremote() {
      return oneditremote;
    },
    get onopenfiles() {
      return onopenfiles;
    },
    get onsyncpane() {
      return onsyncpane;
    },
    get ondetachpane() {
      return ondetachpane;
    },
    get onclosepane() {
      return onclosepane;
    },
    get tm() {
      return tm;
    },
    get fm() {
      return fm;
    },
    get ai() {
      return ai;
    },
    get dbm() {
      return dbm;
    },
  });
  const { openTileMenu, closeTileMenu, toggleTileMenu, runMenuAction } = tmc;

  const tm = new TmuxMenuController({
    get boxes() {
      return boxes;
    },
    get sessionOf() {
      return sessionOf;
    },
    get ontmux() {
      return ontmux;
    },
  });

  const ai = new AiPermMenuController({
    get boxes() {
      return boxes;
    },
  });

  const dbm = new DbAiMenuController({
    get boxes() {
      return boxes;
    },
  });

  const fm = new ForwardMenuController({
    get boxes() {
      return boxes;
    },
  });

  const cm = new ChipMoreMenuController({
    get boxes() {
      return boxes;
    },
  });

  /** 자리는 닫히기 전에 스냅샷한다(통로가 먼저 닫는다) */
  function pickChipMore(item: ChipMoreItem): void {
    const at = cm.at === null ? null : { left: cm.at.left, top: cm.at.top };
    cm.run((m) => {
      switch (item.action) {
        case "files":
          return onopenfiles?.(m.tab.id, m.pane.id);
        case "branch":
          return openBranchGraphOfPane(m.pane.id, item.branch ?? null);
        case "tmux":
          return tm.openTmuxMenu(m, at);
        case "forward":
          return fm.openForwardMenu(m, at);
        case "resource":
          return openResourceView();
      }
    });
  }

  /** 타일 상자 밖에 그린다(상자마다 `isolation: isolate`). 한 번에 하나 — 다른 타일이 올린 `null` 은 떠 있는 남의 카드를 걷지 않는다 */
  let infoCard = $state<(SessionCardView & { paneId: string }) | null>(null);
  function setInfoCard(paneId: string, view: SessionCardView | null): void {
    if (view) infoCard = { ...view, paneId };
    else if (infoCard?.paneId === paneId) infoCard = null;
  }

  let tmuxCard = $state<(TmuxCardView & { paneId: string }) | null>(null);
  function setTmuxCard(paneId: string, view: TmuxCardView | null): void {
    if (view) tmuxCard = { ...view, paneId };
    else if (tmuxCard?.paneId === paneId) tmuxCard = null;
  }

  let forwardsCard = $state<(ForwardsCardView & { paneId: string }) | null>(null);
  function setForwardsCard(paneId: string, view: ForwardsCardView | null): void {
    if (view) forwardsCard = { ...view, paneId };
    else if (forwardsCard?.paneId === paneId) forwardsCard = null;
  }

  let host = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!host) return;
    onmeasure?.(() => ({ w: host?.clientWidth ?? 0, h: host?.clientHeight ?? 0 }));
  });

  $effect(() =>
    delegateTileFocus(host, {
      syncOn,
      onfocus: (tabId, paneId) => onfocuspane?.(tabId, paneId),
      onsync: (tabId, paneId) => onsyncpane?.(tabId, paneId),
    }),
  );

  /** 값이 id 하나라 포커스가 실제로 옮겨갔을 때만 아래 효과가 돈다 — `boxes` 를 통째로 구독하면 무관한 변화마다 포커스를 도로 낚아챈다 */
  const focusTileId = $derived(
    boxes.find((b) => b.visible && b.focused && !isTerminalPane(b.pane))?.pane.id ?? null,
  );

  $effect(() => routeTileFocus(host, focusTileId));

  // ── 배치 애니메이션 ──
  // 등장만은 Svelte `in:` 으로 한다 — `@keyframes` 를 `.host.anim .pane-box` 에 걸면 클래스가 붙는 순간 이미 있던 타일까지 다시 시작해 깜빡인다.
  // 닫힘은 `out:` 이 아니라 유령이다(`onTileClosing`).

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * 구조 조작 중이 아니면(앱 시작 · 탭 복원 · 창 이관) 길이 0 이다. 지연 동안은 Svelte 가 첫 프레임(`css(0)` — 투명)을 걸어 둔다.
   * 글래스 크롬 타일은 상자의 `opacity` 대신 `--tile-in` 을 돌린다(`glassFade` — 아래 `.glass-tile` 규칙이 겹마다 받는다).
   */
  function tileIn(
    node: Element,
    { alone }: { alone: boolean },
  ): TransitionConfig {
    if (node.hasAttribute("data-orch-pane") || !layoutAnimating() || reducedMotion()) return { duration: 0 };
    const delay = alone || seqBusy() ? 0 : TILE_ENTER_DELAY_MS;
    enterUntil = performance.now() + delay + TILE_ENTER_MS;
    const fade = glassFade(node) ? "--tile-in" : "opacity";
    return {
      delay,
      duration: TILE_ENTER_MS,
      easing: cubicOut,
      css: (t) => `${fade}:${t};transform:scale(${0.85 + 0.15 * t})`,
    };
  }

  let enterUntil = 0;

  const seqBusy = () =>
    performance.now() < enterUntil || layoutSlideDelay() > 0 || (ghostLayer?.childElementCount ?? 0) > 0;

  let ghostLayer = $state<HTMLDivElement | null>(null);
  const clearGhosts = () => ghostLayer?.replaceChildren();

  // 사람이 타일 하나를 닫을 때만(`tabs.closePaneNow`) — DOM 이 아직 그대로인 이 순간 상자를 유령으로 떠 둔다.
  // `true` 면 닫는 쪽이 옆 타일의 미끄러짐을 늦춘다. 앞 차례가 아직 돌면(연타) 유령을 세우지 않는다.
  $effect(() =>
    onTileClosing((paneId) => {
      const layer = ghostLayer;
      if (!host || !layer || reducedMotion() || slide !== null) return false;
      if (seqBusy()) return false;
      const item = boxes.find((b) => b.pane.id === paneId);
      if (!item || !item.shown || item.tab.id !== activeId) return false;
      const box = host.querySelector<HTMLElement>(`:scope > .pane-box[data-pane="${CSS.escape(paneId)}"]`);
      return !!box && spawnTileGhost(box, layer) !== null;
    }),
  );

  // 탭이 바뀌면 남은 유령을 곧바로 걷는다 — 다른 탭 위에 떠 있으면 안 된다.
  $effect(() => {
    void activeId;
    untrack(clearGhosts);
  });

  const motion = new TabSlideMotion(() => host);

  // DOM 이 새 상태로 그려진 뒤라 들어오는 탭의 상자가 이미 서 있고, 첫 페인트 전에 첫 키프레임이 얹힌다.
  $effect(() => {
    const s = slide;
    untrack(() => {
      if (s === null) {
        if (motion.slideSeq !== -1) motion.stopSlide();
      } else if (s.seq !== motion.slideSeq) {
        clearGhosts(); // 닫히던 타일의 유령은 탭 층과 함께 밀리지 않는다 — 시작 때 걷는다
        motion.startSlide(s);
      }
    });
  });

  const dc = new DropController({
    get host() {
      return host;
    },
    get boxes() {
      return boxes;
    },
    get kindById() {
      return kindById;
    },
    closeTileMenu: () => closeTileMenu(),
    get ondrophosts() {
      return ondrophosts;
    },
    get ondroptab() {
      return ondroptab;
    },
    get onmovepane() {
      return onmovepane;
    },
    get onfiledrop() {
      return onfiledrop;
    },
    get onfspaste() {
      return onfspaste;
    },
    get ontearstart() {
      return ontearstart;
    },
    get ontearoutpane() {
      return ontearoutpane;
    },
    get ontearrefused() {
      return ontearrefused;
    },
    get ontearmergeinto() {
      return ontearmergeinto;
    },
  });

  const preview = $derived.by(() => {
    const target = dc.dropTarget;
    if (target?.preview !== "zone" || target.tabId !== activeId || reducedMotion()) return null;
    const tab = tabs.find((t) => t.id === target.tabId);
    if (!tab || zoomOf(tab) !== null) return null;
    const layout = dropPreview(tab.root, target.paneId, target.dir, target.side);
    return layout === null ? null : { tabId: tab.id, ...layout };
  });

  let wasPreviewing = false;
  // style 이 원복되기 **전** 게이트를 켠다 — 변경 후 transition 이 있어야 취소도 미끄러진다.
  $effect.pre(() => {
    const on = preview !== null;
    untrack(() => {
      if (wasPreviewing && !on) withLayoutAnim(() => {});
      wasPreviewing = on;
      setDropPreviewing(on);
    });
  });

  $effect(() =>
    registerTileMenuOpener((btn) => {
      const item = boxes.find((b) => b.visible) ?? null;
      if (item !== null) toggleTileMenu(btn, item);
    }),
  );
  $effect(() => noteTileMenuPane(tmc.tileMenu?.paneId ?? null));

  $effect(() => () => setDropPreviewing(false));

  /** 헤더 우클릭 = ⋯ 메뉴 — 위임으로 받는다(헤더에 직접 달면 a11y 로 걸린다). 헤더 밖 우클릭은 흘려보낸다 — 안쪽 화면들이 제 메뉴를 쓴다 */
  const onContextMenu = (ev: MouseEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    // 머리줄 도구줄의 칸이 제 메뉴를 이미 열었거나(`preventDefault`) 편집 칸이면(OS 편집 메뉴) 비켜 선다
    if (ev.defaultPrevented || t.closest("input, textarea, [contenteditable]")) return;
    const head = t.closest<HTMLElement>("[data-pane-head]");
    const id = head?.dataset.paneHead;
    if (!id) return;
    const item = boxes.find((b) => b.pane.id === id);
    if (!item) return;
    ev.preventDefault();
    ev.stopPropagation();
    tmc.tileMenuTrigger = null; // 커서에서 열렸으니 되돌릴 버튼이 없다
    openTileMenu(item, ev.clientX, ev.clientY);
  };

  /** 드래그도 컨테이너 한 곳에서 위임으로 받는다 — `dragstart` 도 버블한다 */
  $effect(() => {
    const el = host;
    if (!el) return;
    el.addEventListener("dragstart", dc.onDragStart);
    el.addEventListener("dragend", dc.onDragEnd);
    // 탭·독에서 시작한 드래그의 Esc 도 캔버스 미리보기를 거둔다.
    window.addEventListener("dragend", dc.clearTargets);
    el.addEventListener("dragover", dc.onDragOver);
    el.addEventListener("dragleave", dc.onDragLeave);
    el.addEventListener("drop", dc.onDrop);
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      el.removeEventListener("dragstart", dc.onDragStart);
      el.removeEventListener("dragend", dc.onDragEnd);
      window.removeEventListener("dragend", dc.clearTargets);
      el.removeEventListener("dragover", dc.onDragOver);
      el.removeEventListener("dragleave", dc.onDragLeave);
      el.removeEventListener("drop", dc.onDrop);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  });
</script>

<div
  class="host tile-canvas"
  class:edge={solo}
  class:anim={layoutAnimating()}
  class:previewing={preview !== null}
  class:sliding={slide !== null}
  style:--close-delay="{layoutSlideDelay()}ms"
  bind:this={host}
>
  {#each boxes as item (item.pane.id)}
    {@const localOrchScreen = isRemote && !!item.tab.orch && !!albumScreens[item.tab.id]?.path}
    <!--
      키는 pane.id — 트리 모양 · 소속 탭이 바뀌어도 이 상자는 산다. `out:` 은 두지 않는다 — 상자가 사는 동안
      `<Terminal>` 도 살고 그 언마운트가 곧 세션 종료다. 닫힘의 모양은 `.tile-ghosts` 층의 복제본이 그린다.
      키 · 누름은 캡처 단계에서 본다 — xterm 이 이벤트를 삼켜도 먼저 닿는다.
    -->
    <div
      in:tileIn={{ alone: item.paneCount === 1 }}
      class="pane-box tile-frame"
      class:chrome={!isTerminalPane(item.pane) && !item.pane.startProject}
      class:start={!!item.pane.startProject}
      class:bare={item.pane.kind === "start" && !item.pane.startProject && item.paneCount === 1}
      class:glass-tile={!isTerminalPane(item.pane) && !(item.pane.kind === "start" && !item.pane.startProject)}
      class:hidden={localOrchScreen ? item.pane.kind !== "run" || (item.tab.id !== activeId && item.tab.id !== leavingId) : !item.shown}
      class:leaving={item.tab.id === leavingId}
      inert={item.tab.id === leavingId}
      class:focused={item.paneCount > 1 && item.focused}
      class:solo={item.paneCount === 1}
      class:sync={included(item.tab.id, item.pane.id)}
      class:headed={headed(item)}
      class:bell={isBellFlashing(item.pane.id)}
      class:glow-ok={tileGlowOf(item.pane.id) === "ok"}
      class:glow-accent={tileGlowOf(item.pane.id) === "accent"}
      data-pane={item.pane.id}
      data-orch-pane={item.tab.orch ? item.pane.kind : undefined}
      data-tab={item.tab.id}
      style={boxStyle(localOrchScreen && item.pane.kind === "run" ? tabCanvas(item.tab) : preview?.tabId === item.tab.id ? (preview.rects.get(item.pane.id) ?? item.rect) : item.rect)}
      onfocusin={() => onfocuspane?.(item.tab.id, item.pane.id)}
      onkeydowncapture={() => touchTile(item.pane.id)}
      onpointerdowncapture={() => touchTile(item.pane.id)}
    >
      {#if headed(item)}
        <PaneHeader
          pane={item.pane}
          host={hostOf(item.pane)}
          active={item.focused || item.paneCount === 1}
          included={included(item.tab.id, item.pane.id)}
          shared={isTerminalPane(item.pane) && paneAiReadable(item.pane)}
          aiStage={isTerminalPane(item.pane) ? paneAiStage(item.pane) : null}
          dbAi={item.pane.kind === "query" ? queryAiOf(item.pane) : null}
          aiMenuOpen={ai.aiMenu?.paneId === item.pane.id || dbm.at?.paneId === item.pane.id}
          zoomed={item.zoomed}
          {zoomCombo}
          flip={isTerminalPane(item.pane) && canFlipPane(item.pane) ? flipViewOf(item.pane.id) : null}
          {flipCombo}
          onflip={(v) => setFlipView(item.pane.id, v)}
          menuOpen={tmc.tileMenu?.paneId === item.pane.id}
          tmuxMenuOpen={tm.tmuxMenu?.paneId === item.pane.id}
          forwardMenuOpen={fm.forwardMenu?.paneId === item.pane.id}
          chipMoreOpen={cm.at?.paneId === item.pane.id}
          forwards={forwardsOf?.(item.pane.id) ?? []}
          sessionId={sessionOf?.(item.pane.id) ?? null}
          shown={item.shown}
          oninfocard={(view) => setInfoCard(item.pane.id, view)}
          ontmuxcard={(view) => setTmuxCard(item.pane.id, view)}
          onforwardcard={(view) => setForwardsCard(item.pane.id, view)}
          onmenu={(ev) => toggleTileMenu(ev.currentTarget as HTMLElement, item)}
          ontmuxmenu={(ev) => tm.toggleTmuxMenu(ev, item)}
          onaimenu={(ev) => (item.pane.kind === "query" ? dbm.toggle(ev, item) : ai.toggleAiMenu(ev, item))}
          onforwardmenu={(ev) => fm.toggleForwardMenu(ev, item)}
          onchipmore={(ev, items) => cm.toggle(ev, item, items)}
          onfiles={() => onopenfiles?.(item.tab.id, item.pane.id)}
          onzoom={() => onzoompane?.(item.tab.id, item.pane.id)}
          onclose={() => onclosepane?.(item.tab.id, item.pane.id)}
        />
      {/if}

      <!--
        헤더가 있든 없든 같은 DOM 노드다 — `<Terminal>` 은 재마운트되지 않는다. 터미널 타일에는 `tabindex` 를 붙이지 않는다(포커스 주인은 xterm).
        `tabindex` 를 펼침으로 넘긴다 — 삼항식이면 컴파일러가 정적으로 못 읽어 `a11y_no_noninteractive_tabindex` 로 오해한다.
      -->
      <div
        class="pane-body"
        {...isTerminalPane(item.pane)
          ? {}
          : { tabindex: -1, "data-tile-focus": item.pane.id }}
      >
        {#if isRemote && mirrorPlaceholder(item.pane.id)}
          <MirrorPlaceholder pane={item.pane} />
        {:else if item.pane.kind === "start"}
          {#if item.pane.startProject}
            <ProjectStart paneId={item.pane.id} start={item.pane.startProject} />
          {:else}
            <StartPage {hosts} />
          {/if}
        {:else if item.pane.kind === "sftp"}
          <SftpBrowser
            paneId={item.pane.id}
            backend={sftpBackend(item.pane)}
            view={item.pane.fileView ?? settings.fileDefaultView}
            onview={(v) => onfileview?.(item.pane.id, v)}
            zoom={item.pane.fileZoom ?? DEFAULT_FILE_ZOOM}
            places={item.pane.filePlaces !== false}
            preview={item.pane.filePreview === true}
            showHidden={item.pane.fileHidden === true}
            projects={fileProjectsOf(item.pane)}
            onfileui={(patch) => onfileui?.(item.pane.id, patch)}
            initialPath={item.pane.path ?? null}
            alias={item.pane.alias ?? ""}
            active={item.visible && item.focused}
            sourceGone={!sftpSourceAlive(item.pane)}
            sourcePaneId={item.pane.sourcePaneId ?? null}
            onupload={(dir, files) => onsftpupload?.(item.pane.id, dir, files)}
            oncwd={(dir) => onsftpcwd?.(item.pane.id, dir)}
            onopendoc={(path) => onopendoc?.(item.tab.id, item.pane.id, path)}
            onnotice={notice}
            refreshKey={sftpRefreshKey}
          />
        {:else if item.pane.kind === "localfs"}
          <SftpBrowser
            paneId={item.pane.id}
            backend={localFs}
            view={item.pane.fileView ?? settings.fileDefaultView}
            onview={(v) => onfileview?.(item.pane.id, v)}
            zoom={item.pane.fileZoom ?? DEFAULT_FILE_ZOOM}
            places={item.pane.filePlaces !== false}
            preview={item.pane.filePreview === true}
            showHidden={item.pane.fileHidden === true}
            projects={fileProjectsOf(item.pane)}
            onfileui={(patch) => onfileui?.(item.pane.id, patch)}
            initialPath={item.pane.path ?? null}
            active={item.visible && item.focused}
            shown={item.shown}
            onupload={(dir, files) => onlocalupload?.(item.pane.id, dir, files)}
            oncwd={(dir) => onlocalcwd?.(item.pane.id, dir)}
            onopendoc={(path) => onopendoc?.(item.tab.id, item.pane.id, path)}
            onnotice={notice}
          />
        {:else if item.pane.kind === "doc"}
          <DocView
            paneId={item.pane.id}
            path={item.pane.path ?? ""}
            backend={docBackend(item.pane)}
            mode={item.pane.docMode ?? "rendered"}
            onmode={(m) => ondocmode?.(item.pane.id, m)}
            outline={item.pane.docOutline === true}
            onoutline={(open) => ondocoutline?.(item.pane.id, open)}
            files={item.pane.docFiles === true}
            onfiles={(open) => ondocfiles?.(item.pane.id, open)}
            onswitch={(path, files) => ondocswitch?.(item.tab.id, item.pane.id, path, files)}
            editView={item.pane.docEditView ?? "split"}
            oneditview={(v) => ondoceditview?.(item.pane.id, v)}
            split={item.pane.docSplit}
            onsplit={(r) => ondocsplit?.(item.pane.id, r)}
            zoom={item.pane.docZoom ?? DOC_ZOOM_DEFAULT}
            onzoom={(z) => ondoczoom?.(item.pane.id, z)}
            preview={item.pane.docPreview === true}
            onkeep={() => ondockeep?.(item.pane.id)}
            onunkeep={() => ondocunkeep?.(item.pane.id)}
            alias={item.pane.alias ?? ""}
            sourceGone={borrowsSession(item.pane) && !sftpSourceAlive(item.pane)}
            onnotice={notice}
            onopenlink={(link, anchor) => ondoclink?.(item.tab.id, item.pane.id, link, anchor)}
            anchor={docAnchorOf(item.pane.id)}
            onanchordone={() => clearDocAnchor(item.pane.id)}
            line={docLineOf(item.pane.id)}
            onlinedone={() => clearDocLine(item.pane.id)}
            editOnce={docEditOf(item.pane.id)}
            oneditoncedone={() => clearDocEdit(item.pane.id)}
            onmenu={(x, y, doc) => {
              // 본문 우클릭 — 터미널 본문 우클릭과 같은 상자를 커서 자리에(줄은 문서 타일이 지어 온다 · 되돌릴 버튼은 없다)
              tmc.tileMenuTrigger = null;
              openTileMenu(item, x, y, null, doc);
            }}
          />
        {:else if item.pane.kind === "image"}
          <ImageView
            paneId={item.pane.id}
            path={item.pane.path ?? ""}
            backend={docBackend(item.pane)}
            alias={item.pane.alias ?? ""}
            sourceGone={borrowsSession(item.pane) && !sftpSourceAlive(item.pane)}
            onpath={(p) => noteImagePath(item.pane.id, p)}
            onnotice={notice}
          />
        {:else if item.pane.kind === "branches"}
          <!-- 빈 주소면 아무것도 그리지 않는다 — `{:else}` 로 떨어지면 터미널이 선다 -->
          {#if item.pane.branchGraph}
            <BranchGraph paneId={item.pane.id} spec={item.pane.branchGraph} />
          {/if}
        {:else if item.pane.kind === "diff"}
          {#if item.pane.diff}
            <DiffView paneId={item.pane.id} spec={item.pane.diff} />
          {/if}
        {:else if item.pane.kind === "producer"}
          <ProducerLeaf pane={item.pane} visible={item.shown && !localOrchScreen} />
        {:else if item.pane.kind === "run"}
          <RunBoard pane={item.pane} visible={localOrchScreen ? item.tab.id === activeId || item.tab.id === leavingId : item.shown} />
        {:else if item.pane.kind === "query"}
          {#if item.pane.query?.connId}
            <QueryView
              pane={item.pane}
              visible={item.shown}
              onmenu={(x, y, grid) => {
                // 결과 표 칸 우클릭 — 문서 본문 우클릭과 같은 상자 · 같은 통로(줄은 표가 지어 온다)
                tmc.tileMenuTrigger = null;
                openTileMenu(item, x, y, null, grid);
              }}
            />
          {/if}
        {:else}
          <!-- 감싸개는 모든 터미널 타일에 늘 선다 — AI 판정에 따라 생겼다 사라지면 `<Terminal>` 이 재마운트된다(= 세션 종료) -->
          <AiFlip
            pane={item.pane}
            sessionId={sessionOf?.(item.pane.id) ?? null}
            shown={item.shown}
            onopenpath={(target, line) => onopenpath?.(item.tab.id, item.pane.id, target, line)}
          >
            <Terminal
              pane={item.pane}
              visible={item.shown}
              active={item.visible && item.focused}
              onactivity={() => onactivity?.(item.tab.id)}
              onstatus={(paneId, status) => onstatus?.(item.tab.id, paneId, status)}
              {onsession}
              {ontitle}
              {onshell}
              {ontmux}
              {oncommand}
              onbroadcast={(data) => broadcast(item.tab, item.pane.id, data)}
              onrequestedit={() => oneditremote?.(item.tab.id, item.pane.id)}
              onopenpath={(target, line) => onopenpath?.(item.tab.id, item.pane.id, target, line)}
              onmenu={(x, y, ctx) => {
                // 터미널 본문 우클릭 — 헤더 우클릭과 **같은 메뉴 한 벌**을 커서 자리에 연다
                // (docs/log/2026-09-05-terminal-context-menu.md). 되돌릴 버튼은 없다.
                tmc.tileMenuTrigger = null;
                openTileMenu(item, x, y, ctx);
              }}
              {confirmHostKey}
              {promptPassword}
              {promptPassphrase}
              onexit={() => {
                /*
                  종료해도 패널과 버퍼는 남긴다 — Terminal 이 스스로 '종료됨' 배너로 넘어가고
                  (Enter = 다시 접속 · Ctrl+D = 닫기), 상태 배지는 언마운트에서 거둔다.
                  docs/log/2026-09-03-keys-ended-focus.md
                */
              }}
              onclose={() => onclosepane?.(item.tab.id, item.pane.id)}
            />
          </AiFlip>
        {/if}
      </div>

      {#if dc.dropTarget?.paneId === item.pane.id && preview === null}
        <DropOverlay preview={dc.dropTarget.preview} zone={dc.dropTarget.zone} />
      {:else if dc.fileTarget?.paneId === item.pane.id}
        <DropOverlay preview="all" label={dropLabel(dc.fileTarget.label, item.pane.kind, tr, isRemote)} />
      {/if}
    </div>
  {/each}

  <div class="tile-ghosts" bind:this={ghostLayer} aria-hidden="true" inert></div>

  {#if preview !== null}
    <div class="drop-ghost" style={boxStyle(preview.ghost)} aria-hidden="true"></div>
  {/if}

  <!-- 최대화 중에는 분할선도 숨긴다 — 잡아 끌면 보이지 않는 배치를 조용히 망가뜨린다 -->
  {#each tabs as tab (tab.id)}
    <div
      class="lines"
      class:hidden={(tab.id !== activeId && tab.id !== leavingId) || zoomOf(tab) !== null || solo || preview?.tabId === tab.id || (isRemote && !!albumScreens[tab.id]?.path)}
      class:leaving={tab.id === leavingId}
      inert={tab.id === leavingId}
      data-tab={tab.id}
    >
      <!-- 크기가 상자 쪽(`hostBoxes`)과 **같은 값**이어야 선과 상자가 어긋나지 않는다(뿌리 사각형도 — `tabCanvas`) -->
      <SplitView root={tab.root} base={tabCanvas(tab)} />
    </div>
  {/each}

  <!-- `.host` 의 직계 자식에 같은 `data-tab` 을 단다 — 탭 전환 슬라이드(`pane/tab-slide.svelte.ts`)가 `:scope > [data-tab]` 를 골라 타일과 함께 민다 -->
  {#each tabs as tab (tab.id)}
    {#if tab.orch}
      {@const barShown = tab.id === activeId || tab.id === leavingId}
      <div
        class="orch-strip"
        class:hidden={!barShown}
        class:leaving={tab.id === leavingId}
        inert={tab.id === leavingId}
        data-tab={tab.id}
        style:height="{ORCH_BAR_PX - GAP}px"
      >
        <OrchTransportBar {tab} shown={barShown} />
      </div>
    {/if}
  {/each}

  <!-- 메뉴 · 호버 카드는 타일 상자 밖에 그린다 — 상자마다 `isolation: isolate` 라 안에서는 `position: fixed` 여도 이웃 타일 · 분할선 층에 덮인다 -->
  <PanePopovers
    {tmc}
    {tm}
    {fm}
    {ai}
    {dbm}
    {cm}
    {sessionOf}
    {forwardsOf}
    {onopentmux}
    {onforwardpane}
    {pickChipMore}
    {infoCard}
    {tmuxCard}
    {forwardsCard}
  />
</div>

<style>
  /* 타일 프레임의 기하·배경은 theme.css 의 `.tile-frame` 을 함께 쓴다. */
  .pane-box {
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  /* 설정 · 파일 타일에는 불투명 `--term-bg` 를 깔지 않는다 — 깔면 투명도 슬라이더를 내려도 그 자리는 안 비친다.
   * 프로젝트 시작 화면만 크롬의 우물(`--surface-field`)을 깐다 — 옅은 글자가 밝은 월페이퍼 위에서 읽히지 않았고,
   * 터미널 판이면 "라이트 크롬 + 어두운 터미널" 에서 검은 판에 검은 글자가 된다. */
  .pane-box.start {
    background: var(--surface-field);
  }

  .pane-box.bare {
    border-color: transparent;
  }

  /*
   * 상시로 걸면 분할선 드래그가 고무줄이 되고 창 리사이즈 내내 xterm 이 매 프레임 refit 한다.
   * `all` 이 아니라 네 속성만 적는다 — `all` 이면 포커스 링이 200ms 늦게 켜진다. 뒤의 둘은 단축 속성이라 위 값을 되풀이한 것이다.
   */
  .host.anim .pane-box,
  .host.previewing .pane-box {
    transition:
      left 200ms cubic-bezier(0.2, 0, 0, 1),
      top 200ms cubic-bezier(0.2, 0, 0, 1),
      width 200ms cubic-bezier(0.2, 0, 0, 1),
      height 200ms cubic-bezier(0.2, 0, 0, 1),
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  /* 분할선도 같은 트랜지션 — 안 그러면 200ms 동안 선이 타일 한가운데를 가로지른다 */
  .host.anim :global(.divider) {
    transition:
      left 200ms cubic-bezier(0.2, 0, 0, 1),
      top 200ms cubic-bezier(0.2, 0, 0, 1),
      width 200ms cubic-bezier(0.2, 0, 0, 1),
      height 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  /* 위치 · 크기 네 속성만 늦춘다 — 포커스 테두리(border-color · box-shadow)는 늦추지 않는다 */
  .host.anim .pane-box {
    transition-delay: var(--close-delay), var(--close-delay), var(--close-delay), var(--close-delay), 0s, 0s;
  }
  /* 앨범의 고정 잎은 채팅 표시와 동시에 배치한다. 다른 타일의 애니메이션이 도는 중에도 같다. */
  .host.anim .pane-box[data-orch-pane] {
    transition: none;
  }
  .host.anim :global(.divider) {
    transition-delay: var(--close-delay);
  }

  /* 커서를 받으면 스냅숏 판정을 가로막는다 */
  .drop-ghost {
    position: absolute;
    box-sizing: border-box;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--fg) 22%, transparent);
    border-radius: var(--radius-surface); /* 타일 모서리 그대로(`.tile-frame`) */
    background:
      linear-gradient(135deg,
        color-mix(in srgb, white 14%, transparent),
        transparent 38%,
        transparent 62%,
        color-mix(in srgb, white 6%, transparent)),
      color-mix(in srgb, var(--tertiary) 7%, transparent);
    backdrop-filter: blur(10px) saturate(140%);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 18%, transparent),
      0 4px 12px color-mix(in srgb, var(--fg) 6%, transparent);
    pointer-events: none;
    animation: ghost-in 120ms ease-out;
  }
  .drop-ghost::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg,
      transparent 40%,
      color-mix(in srgb, white 18%, transparent) 50%,
      transparent 60%);
    transform: translate(100%, 100%);
    animation: ghost-sheen 500ms ease-out;
  }
  @keyframes ghost-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes ghost-sheen {
    from { transform: translate(-100%, -100%); }
    to { transform: translate(100%, 100%); }
  }

  /* `.host.anim` 쪽도 함께 적어야 한다 — 선택자가 더 구체적이라 `.pane-box` 만 끄면 그 값이 이긴다 */
  @media (prefers-reduced-motion: reduce) {
    .pane-box,
    .host.anim .pane-box,
    .host.previewing .pane-box,
    .host.anim :global(.divider) {
      transition: none;
    }
    .drop-ghost,
    .drop-ghost::after {
      animation: none;
    }
  }

  /* 인스턴스는 그대로 살아 있고 그리기만 멈춘다(스크롤백 보존) */
  .pane-box.hidden {
    display: none;
  }

  /* `clip-path` 로 오리지 않는다 — 배경 뿌리라 그동안 글래스 타일의 흐림 판이 비었다. `overflow: clip` 은 배경 뿌리가 아니다 */
  .host.sliding {
    overflow: clip;
    overflow-clip-margin: var(--gap);
  }
  /* 가로는 오리지 않는다 — 타일이 상태바 패널 뒤로 지나간다(밀어내는 거리도 그 끝까지 — `tab-slide.svelte.ts` 의 `slideDistance`) */
  :global([data-slide-bleed]) .host.sliding {
    overflow-x: visible;
  }
  .tile-ghosts {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .pane-box.leaving,
  .lines.leaving {
    pointer-events: none;
  }

  /* 포커스는 중성이다 — 강조색은 "입력 대기 · 주 동작 · 선택 행" 셋에만 쓴다 */
  .pane-box.focused {
    /* 한 층 올리는 것은 타일 안의 `position: fixed` 메뉴 · 백드롭이 이웃 타일에 덮이지 않게다(상자마다 `isolation: isolate`) */
    z-index: 1;
    border-color: var(--tile-rim-focus, var(--line-strong));
  }

  /*
   * 글래스 크롬 타일 — 흐림은 상자 자신의 `backdrop-filter` 가 아니라 `::before` 한 겹이다: 상자에 걸면 타일 안 `position: fixed` 메뉴의
   * 기준 상자가 타일이 된다. 공용 `.glass-mid` 는 붙이지 않는다(테두리 색 · 그림자까지 바꾼다). 안쪽 뿌리 · 머리줄은 `--tile-inner`(투명)로 두 겹을 막는다.
   * 상자 · 조상에 배경 뿌리(`opacity` · `clip-path` · `filter` …)를 걸면 그동안 흐림이 빠진다.
   * launcher 시작 타일은 빠진다 — 위젯 카드가 이미 유리라 판 · 흐림이 두 겹이 된다.
   */
  :global(:root[data-material="glass"]) .pane-box.glass-tile {
    --tile-inner: transparent;
    --tile-face: var(--glass-mid);
    --tile-sticky: var(--surface-raised-solid);
    background-clip: padding-box;
  }
  :global(:root[data-material="glass"]) .pane-box.glass-tile::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    backdrop-filter: var(--glass-filter-mid);
  }

  /*
   * 상자 자신의 `opacity` 는 배경 뿌리라 페이드 동안 흐림 판이 빈다 — 그래서 겹마다 `--tile-in` 을 곱한다.
   * 평소엔 등록 초기값 1(theme.css 의 `@property --tile-in`)이다. 테두리 규칙은 벨 · 알림 빛의 테두리를 비켜 준다.
   */
  :global(:root[data-material="glass"]) .pane-box.glass-tile {
    background-color: color-mix(in srgb, var(--glass-mid) calc(var(--tile-in) * 100%), transparent);
    opacity: 1;
  }
  /* 등장 · 닫기 유령의 `opacity` 애니메이션은 이 선언을 이긴다 */
  .pane-box,
  .lines {
    opacity: var(--tile-in);
  }
  :global(:root[data-material="glass"]) .pane-box.glass-tile::before,
  :global(:root[data-material="glass"]) .pane-box.glass-tile > :global(*) {
    opacity: var(--tile-in);
  }
  :global(:root[data-material="glass"]) .pane-box.glass-tile:not(.bell, .glow-ok, .glow-accent) {
    border-color: color-mix(in srgb, var(--tile-rim) calc(var(--tile-in) * 100%), transparent);
  }
  :global(:root[data-material="glass"]) .pane-box.glass-tile.focused:not(.bell, .glow-ok, .glow-accent) {
    border-color: color-mix(in srgb, var(--tile-rim-focus) calc(var(--tile-in) * 100%), transparent);
  }

  /* `border` 를 키우지 않고 안쪽 `outline` 으로 그린다 — 두께가 변하면 xterm 이 refit → 원격 resize 까지 돈다 */
  .pane-box.sync {
    outline: 2px solid var(--warn);
    outline-offset: -2px;
  }

  /* `.focused` 뒤에 적는다 — 명시도가 같아 나중 규칙이 이긴다. 두께는 그대로다(`.sync` 와 같은 이유) */
  .pane-box.bell {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* 애니메이션 길이(1.4s)는 `app/tile-glow.svelte.ts` 의 `GLOW_MS` 와 맞춘다 */
  .pane-box.glow-ok {
    --glow: var(--ok);
  }
  .pane-box.glow-accent {
    --glow: var(--accent);
  }
  .pane-box.glow-ok,
  .pane-box.glow-accent {
    border-color: var(--glow);
    animation: tile-glow 1.4s ease-out both;
  }
  @keyframes tile-glow {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--glow) 70%, transparent);
    }
    25% {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--glow) 55%, transparent);
    }
    100% {
      box-shadow: 0 0 0 10px transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pane-box.glow-ok,
    .pane-box.glow-accent {
      animation: none;
      box-shadow: 0 0 0 2px var(--glow);
    }
  }

  /* 높이를 flex 로 나누지 않고 절대배치로 못 박는다 — 헤더가 생기고 사라져도 본문 DOM 이 그대로라 터미널이 재마운트되지 않는다 */
  .pane-body {
    position: absolute;
    inset: 0;
  }

  /* 포커스 링은 그리지 않는다 — 상자의 활성 테두리가 이미 말한다 */
  .pane-body:focus {
    outline: none;
  }

  /* 폰 — 테두리를 0 으로 걷으므로 벨 · 알림 빛은 안쪽 고리로 그린다(바깥 그림자는 화면 밖이라 안 보인다) */
  .host.edge {
    inset: 0;
    --term-pad: 4px;
  }
  .host.edge .pane-box {
    border-width: 0;
    border-radius: 0;
  }
  .host.edge .pane-box.bell {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .host.edge .pane-box.glow-ok,
  .host.edge .pane-box.glow-accent {
    animation: none;
    box-shadow: inset 0 0 0 2px var(--glow);
  }

  /* 머리줄 높이 — theme.css 의 `--tile-head-h`(PaneHeader 가 같은 값으로 선다) */
  .pane-box.headed .pane-body {
    top: var(--tile-head-h);
  }

  /* 분할선은 포커스 타일(z-index 1)보다도 위에 둔다 — 손잡이가 타일 밑으로 숨으면 안 된다 */
  .lines {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }

  .lines.hidden {
    display: none;
  }

  /* 오케스트레이션 탭의 재생 막대 띠 — 높이 = 띠 − 거터 */
  .orch-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
  }
  .orch-strip.hidden {
    display: none;
  }
  .orch-strip.leaving {
    pointer-events: none;
  }

</style>
