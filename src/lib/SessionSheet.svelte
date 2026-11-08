<script lang="ts">
  /**
   * **세션 목록 판** — 타일 캔버스 위쪽 가장자리(탭 바 바로 아래)에서 내려오는 세션 목록 (2026-10-07 — 전체 화면
   * 대시보드의 세션 칸을 옮겨 왔다. 처음엔 하단 독 위로 펼쳐졌고, 같은 날 실기 뒤 위쪽 판으로 옮겼다).
   *
   * **탭 지도**다(2026-11-02 — 세 묶음 카드 격자를 걷었다, 목업 VgJHqZzBPQyKsqWJmhKSKM E안). 위에서 아래로:
   * 1. **요약 칩 줄**(범례를 겸한다) — 권한 대기 · 완료 · 실패 · 실행 중 · 조용함 · 끊김. 0 인 칩은 숨는다. 수는 판의 묶음
   *    (`console/session-sheet.ts` 의 `sheetBuckets`)에서 센다(`console/tab-map.ts` 의 `mapSummary`) — 독 요약 줄과 같은 셈.
   * 2. **워크스페이스마다 한 줄** — 왼쪽 이름, 오른쪽에 그 워크스페이스의 탭 카드가 탭 바 순서로 줄바꿈되며 선다.
   *    탭 카드 = 그 탭의 **실제 타일 배치 축소판**(이진 분할 트리 그대로 — 방향 · 비율) + 탭 줄과 같은 이름 줄:
   *    로고(오케스트레이션 탭 = `EqBars` · 그 밖 = `tabIconPane`) · 탭 이름 · 표식(`TabStatusGlyph` · 입력은 `tabDotInput` 한 벌 — 벨 · 서브 에이전트 수 포함).
   *    지금 보고 있는 탭은 강조색 안쪽 테두리. 줄 · 칸의 계산은 순수 모듈 `console/tab-map.ts`(`tabMap`), 카드의
   *    재료와 상태는 그대로 `console/window-cards.ts` → `console/session-cards.ts`(`cardStateOf` 한 함수).
   *
   * **칸**은 글자 없이 아이콘(AI 는 `AiGlyph`, 셸 · SSH 는 `PaneIcon` — 타일 머리줄과 같은 그림)과 상태다. **사람이 볼 칸만 면을 칠한다**:
   * 권한 대기 = primary 톤 면 · 완료 = 초록 톤 면 · 실패 = 오류 톤 면(`cellFace`). 실행 중은 기본 면에 아주 옅게 섞은 면(에이전트 = 강조색 · 명령 = 초록)이다.
   * 칸의 오른쪽 위에 탭과 같은 12px 표식이 하나 선다(`cellMark` — 탭과 같은 순서) — 권한 대기 · 완료 · 실패 · 안 본 벨(종 · 면은 칠하지 않는다) ·
   * 에이전트 실행 중(진행 호) · 명령 실행 중(6px 점). 조용함은 기본 면뿐 · 끊김 = 점선 · 흐림
   * (docs/log/2026-11-03-tab-status-glyphs.md). 오케스트레이션 플레이어 칸은 카드가 없어도 앨범의 맥박으로 면을 칠한다(`albumCell`). 카드가 없는 타일(문서 · 파일 · 쿼리 …)은 흐린 칸에 흐린 타일 아이콘이다(2026-11-03 — 빈 칸은 무엇인지 몰랐다) — 배치 모양이 실제와 같게. 자세한 것은
   * 칸에 얹거나 키보드로 가면 뜨는 **말풍선**(이름 · 명령과 종료 코드 또는 에이전트 줄 · 상태와 경과)이 말한다.
   * 스코프는 이 창의 타일이다(주 창은 보조 창의 타일도 — 트리를 모르니 가로 같은 폭 칸).
   *
   * 칸은 단추이고 할 일은 둘이다 — 누르면 **그 타일로**(`focusTile` · 다른 워크스페이스 · 보조 창의 타일도 같은 길 · 가면 판은 접힌다),
   * 끌면 **그 타일을 옮긴다**(2026-11-04 · docs/log/2026-11-04-session-sheet-tile-drag.md — 판정은 `console/sheet-drag.ts`). 놓는 곳이 뜻을 정한다:
   * 판의 다른 칸 = 그 옆으로(`movePane` 의 `stay` — **보던 탭 그대로 · 판은 열린 채**) · 판 밖 타일 · 탭 줄 = 머리줄 끌기와 같은 받는 쪽이 받고
   * 판이 접힌다 · 창 밖 = 새 창으로 떼기(머리줄과 같은 판정 · 예약). 끄는 동안은 blur · `blocked` 로 접지 않는다(원본 칸이 사라지면 `dragend` 를 잃는다).
   * 여기서는 아무것도 실행하거나 승인하지 않는다. 키보드 — 칸은 로빙 탭 하나(Tab 으로 들어와
   * ←→ 칸 · ↑↓ 앞뒤 탭 카드 · Home/End).
   *
   * 자리 — `+page` 의 타일 캔버스(`.pane`) 안, 위쪽 가장자리에 붙어 캔버스 폭 전체로 선다(상태바 자리와 상관없이
   * 늘 캔버스 위쪽). 높이는 내용만큼이되 캔버스의 절반까지 — 넘치면 판 안에서 스크롤한다. 판은 **덮개**다: 타일
   * 크기를 바꾸지 않는다(refit · PTY resize 없음). 마운트는 열림 값(`app/session-sheet.svelte.ts`)이 쥐고, 닫힘
   * 규칙은 여기 있다: Escape · 판 밖 누르기(그 누르기는 밑으로도 그대로 간다) · 창 비활성화 · 모달/가림막
   * (`blocked`). 열리면 키보드를 판으로 가져오고, 닫히면 열림 값이 열기 전 자리로 돌려준다.
   */
  import { onDestroy, onMount, tick } from "svelte";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import BellGlyph from "$lib/BellGlyph.svelte";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";
  import { hasBellMark } from "$lib/app/bell.svelte.js";
  import EqBars from "$lib/orchestration/EqBars.svelte";
  import { pulseOfRun } from "$lib/app/orch-pulse.svelte.js";
  import TabStatusGlyph, { tabIconPane } from "$lib/tabbar/TabStatusGlyph.svelte";
  import {
    activeTabId,
    focusTile,
    hasActivity,
    movePane,
    residentWindowTabs,
    tabBells,
    tabStatus,
  } from "$lib/app/tabs.svelte.js";
  import { isLiveAgentPane, tabAgents } from "$lib/app/agent-status.svelte.js";
  import { closeSessionSheet } from "$lib/app/session-sheet.svelte.js";
  import { auxPaneWorkspaces } from "$lib/app/workspace-status.svelte.js";
  import { workspaceList } from "$lib/app/workspaces.svelte.js";
  import { displayName, displayTabTitle } from "$lib/app/titles.svelte.js";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import DetachedSessions from "$lib/DetachedSessions.svelte";
  import { detachedCount } from "$lib/app/detached.svelte.js";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { agentTimeLabel } from "$lib/agent-board";
  import { subagentsLabel, tabDot, tabDotInput, type TabDot } from "$lib/tab-dot";
  import { placeTooltip } from "$lib/tooltip";
  import { elapsedLabel } from "$lib/console/host-groups";
  import type { CardState, SessionCard } from "$lib/console/session-cards";
  import { runningSince, sheetBuckets } from "$lib/console/session-sheet";
  import { albumCell, auxTabDotInput, cellFace, cellMark, mapSummary, tabMap, type MapCell, type MapTab } from "$lib/console/tab-map";
  import { cellDetail, cellLink, type CellLink } from "$lib/console/cell-detail";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { queryLiveOf } from "$lib/app/query-live.svelte.js";
  import { windowSessionCards } from "$lib/console/window-cards";
  import type { Pulse } from "$lib/orchestration/model";
  import { canDragCell, cellDropPlan, type SheetLeaf } from "$lib/console/sheet-drag";
  import { mobileLayout } from "$lib/app/mobile.svelte.js";
  import { noticeTearRefused, startPaneTear, tearOutPane } from "$lib/app/tear.svelte.js";
  import DropOverlay from "$lib/pane/DropOverlay.svelte";
  import { zoneOf, type DropZone } from "$lib/layout";
  import { endTear, outsideWindow, pendingTear, TEAR_DRAG_TYPE } from "$lib/tear";
  import {
    draggingPane,
    findPane,
    listPanes,
    paneName,
    PANE_DRAG_TYPE,
    setDraggingPane,
    type PaneSide,
    type PaneSpec,
    type SplitDir,
  } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  let {
    blocked = false,
  }: {
    /** 모달 · 가림막이 떠 있다 — 판은 곧바로 접힌다(포커스는 모달의 것이다) */
    blocked?: boolean;
  } = $props();

  let rootEl = $state<HTMLElement | null>(null);

  /** 재료 — 이 창의 세션 카드 판(Rust invoke 없음). 열려 있는 동안만 마운트되므로 그동안만 계산한다 */
  const cards = $derived.by(() => windowSessionCards(t));
  /** 경과 시계 — 떠 있는 동안 30초에 한 칸 */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
  const buckets = $derived(sheetBuckets(cards.board, now));
  const summary = $derived(mapSummary(buckets));
  const panes = $derived(cards.panes);
  /** 타일 → 카드(원격 파일 타일이 빌려 쓰는 원본 터미널의 상태를 읽는다) */
  const cardByPane = $derived.by(() => {
    const map = new Map<string, SessionCard>();
    for (const g of cards.board.groups) for (const c of g.cards) if (c.paneId) map.set(c.paneId, c);
    return map;
  });

  /** 이 창의 탭 — 지도의 트리 · 제목 · 소속. 카드가 없는 잎의 이름을 지을 명세(paneId → 명세)도 함께 */
  const localTabs = $derived(residentWindowTabs());
  const leafSpecs = $derived.by(() => {
    const map = new Map<string, PaneSpec>();
    for (const tab of localTabs) for (const pane of listPanes(tab.root)) map.set(pane.id, pane);
    return map;
  });
  /** 탭 id → 이 창의 탭 명세 — 보조 창 탭은 없다 */
  const localById = $derived(new Map(localTabs.map((tab) => [tab.id, tab])));
  const rows = $derived(
    tabMap({
      tabs: localTabs.map((tab) => ({
        id: tab.id,
        title: displayTabTitle(tab),
        workspaceId: tab.workspaceId ?? null,
        root: tab.root,
      })),
      workspaces: workspaceList(),
      cards: cards.board.groups.flatMap((g) => g.cards),
      activeTabId: activeTabId(),
      auxOwners: auxPaneWorkspaces(),
    }),
  );

  /** 탭 카드 이름 줄의 표식 — 탭 줄과 같은 재료 · 같은 함수. 보조 창 탭(이 창에 트리가 없다)만 카드에서 짓는다 */
  const dots = $derived.by(() => {
    const sources = {
      activeId: activeTabId(),
      agents: tabAgents(),
      status: tabStatus(isLiveAgentPane),
      bells: tabBells(),
      activity: hasActivity,
      paneName: displayName,
    };
    const out = new Map<string, TabDot | null>();
    for (const tab of rows.flatMap((r) => r.tabs)) {
      const spec = localById.get(tab.id);
      out.set(tab.id, tabDot(spec ? tabDotInput(spec, sources) : auxTabDotInput(tab.cells), t));
    }
    return out;
  });

  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  /** 모달 · 가림막이 서면 접는다 — 포커스는 그쪽이 가져간다. 끄는 중이면 끌기가 끝난 뒤에(`dragSource` 를 읽어 그때 다시 돈다) */
  $effect(() => {
    if (blocked && dragSource === null) closeSessionSheet(false);
  });

  /**
   * 열리면 **키보드를 판으로** 가져온다 — 키바인딩으로 열었을 때 포커스가 밑의 터미널에 남아 있으면 Tab · Enter 가
   * 셸로 간다. 판 밖 누르기 · 창 비활성화는 창 수준에서 듣는다(누르기는 캡처 단계 — 타일이 전파를 멈춰도 닿게).
   */
  onMount(() => {
    void tick().then(() => rootEl?.focus({ preventScroll: true }));
    const outside = (ev: PointerEvent) => {
      if (ev.target instanceof Node && rootEl?.contains(ev.target)) return;
      // 판을 스스로 여닫는 입구(`data-sheet-toggle`)는 비켜 간다 — 여기서 먼저 닫으면 뒤따르는 click 이 도로 연다
      // (`data-chrome-toggle` 과 같은 경쟁 · 같은 처방). 그 표식을 달던 상태바 세션 칸은 2026-10-18 통합 독 때 걷혔다 — 지금 판을
      // 여는 독 알림 칸의 세션 요약 줄은 독을 닫고 여는 단방향이라 표식이 필요 없다. 표식을 다는 입구가 다시 생길 때를 위해 남긴다.
      if (ev.target instanceof Element && ev.target.closest("[data-sheet-toggle]")) return;
      closeSessionSheet();
    };
    const blur = () => {
      if (dragSource === null) closeSessionSheet();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", blur);
    };
  });

  /** Escape 는 판 하나만 접는다 — 창의 Escape 사슬(사용량 화면 닫기)까지 가지 않는다 */
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeSessionSheet();
  }

  /** 아래로 미끄러져 내려온다 — 판 높이만큼 위에서(캔버스 위쪽을 자르는 상자가 가린다). reduced-motion 이면 바로 */
  function drop(_node: HTMLElement): { duration: number; css: (t: number, u: number) => string } {
    return {
      duration: reduced ? 0 : 200,
      // 떠 있는 카드 모양(둥글게 · 감싸기)이면 위 틈(`--sheet-lift`)만큼 더 올라가 틈에 한 줄도 남지 않는다
      css: (_t, u) => `transform: translateY(calc(${-100 * u}% - ${u} * var(--sheet-lift, 0px)))`,
    };
  }

  const STATE_KEY: Record<CardState, Key> = {
    input: "board.card.state.input",
    fail: "board.card.state.fail",
    running: "app.sheet.state.running",
    idle: "board.card.state.idle",
    off: "board.card.state.off",
  };

  /** 칸의 상태 글자 — AI 의 입력 대기는 점 셋의 말(권한 대기 · 완료)로 가른다(대시보드 카드와 같은 말) */
  function stateLabel(c: SessionCard): string {
    if (c.state === "input" && c.agentStatus === "permission") return t("board.card.agent.permission");
    if (c.state === "input" && c.agentStatus === "finished") return t("board.card.agent.finished");
    return t(STATE_KEY[c.state]);
  }

  /** 칸의 이름 — 카드가 있으면 카드의 첫 줄(없으면 코드), 없으면 그 타일의 이름 */
  function cellName(cell: MapCell): string {
    if (cell.card) return cell.card.title ?? cell.card.code ?? cell.card.key;
    const spec = leafSpecs.get(cell.paneId);
    return spec ? paneName(spec, t) : cell.paneId;
  }

  /** 세션 없는 칸의 연결 상태 — DB · 원격 파일만(`console/cell-detail.ts` 의 `cellLink`) */
  function linkOf(cell: MapCell): CellLink | null {
    if (cell.card) return null;
    const pane = leafSpecs.get(cell.paneId);
    if (!pane) return null;
    return cellLink(pane, {
      queryLive: queryLiveOf,
      sourceState: (id) => cardByPane.get(id)?.state ?? null,
    });
  }

  const LINK_KEY = {
    open: "pane.query.state.open",
    connecting: "pane.query.state.connecting",
    closed: "pane.query.state.closed",
  } as const;

  function tabTitle(tab: MapTab): string {
    return tab.title ?? t("app.sheet.aux");
  }

  /** 플레이어 칸의 앨범 맥박 — 그 밖의 칸은 `null` */
  function albumPulseOf(pane: PaneSpec | undefined, card: SessionCard | null): Pulse | null {
    return !card && pane?.kind === "run" ? pulseOfRun(pane.run?.runId) : null;
  }

  const ALBUM_KEY: Partial<Record<Pulse, Key>> = {
    playing: "app.sheet.album.playing",
    reviewing: "app.sheet.album.reviewing",
    attention: "app.sheet.album.attention",
    paused: "app.sheet.album.paused",
    done: "app.sheet.album.done",
    idle: "app.sheet.album.idle",
  };

  function cellLabel(tab: MapTab, cell: MapCell): string {
    const vars = { tab: tabTitle(tab), name: cellName(cell) };
    if (cell.card) return t("app.sheet.cell.aria", { ...vars, state: stateLabel(cell.card) });
    const pulse = albumPulseOf(leafSpecs.get(cell.paneId), null);
    const albumKey = pulse ? ALBUM_KEY[pulse] : undefined;
    if (albumKey) return t("app.sheet.cell.aria", { ...vars, state: t(albumKey) });
    const link = linkOf(cell);
    return link ? t("app.sheet.cell.aria", { ...vars, state: t(LINK_KEY[link.state]) }) : t("app.sheet.cell", vars);
  }

  /**
   * AI 칸 말풍선의 둘째 줄 — 훅 신호로 지은 말(권한 물음 · 턴 진행 · 턴 끝 + 시각). 도구 이름 같은 것은 싣지 않는다
   * (`$lib/agent-board` 머리말).
   */
  function agentLine(c: SessionCard): string {
    const when = agentTimeLabel(c.agentTime, now, t);
    switch (c.agentStatus) {
      case "permission":
        return when ? t("board.card.ai.permission.at", { when }) : t("board.card.ai.permission");
      case "running":
        return c.agentTime?.kind === "turn" ? t("board.card.ai.turn.for", { when }) : t("board.card.ai.turn");
      default:
        if (c.agentTime?.kind === "ended") return t("board.card.ai.finished.at", { when });
        return t("board.card.ai.quiet");
    }
  }

  /** 경과 — 도는 칸은 지금 블록 · 턴의 시작부터, 아니면 카드의 시각 */
  function elapsedOf(c: SessionCard): string | null {
    const since = runningSince(c) ?? c.since;
    return since !== null ? elapsedLabel(now - since) : null;
  }

  function go(tabId: string, paneId: string): void {
    // 갈 곳을 스스로 정한 닫기 — 열기 전 자리로 돌려주지 않는다(`focusTile` 이 그 타일로 옮긴다)
    closeSessionSheet(false);
    focusTile(tabId, paneId);
  }

  // ── 칸 끌기 — 판정은 `console/sheet-drag.ts` · 싣는 것과 받는 쪽은 타일 머리줄 끌기(`pane/drop-controller`)와 같다 ──────
  /** 지금 끄는 칸의 타일 — 이 판에서 시작한 끌기만(다른 곳에서 온 끌기는 판이 받지 않는다) */
  let dragSource = $state<string | null>(null);
  /** 흐려 보일 칸 — 끌기 그림이 찍힌 다음 프레임에 세운다(같은 틱에 세우면 끌기 그림까지 흐려진다) */
  let dimmed = $state<string | null>(null);
  let dropAt = $state<{ paneId: string; preview: "zone" | "all"; zone: DropZone } | null>(null);
  /** 방금 옮긴 칸 — 강조색 테두리 한 번 */
  let justMoved = $state<string | null>(null);
  let justTimer: ReturnType<typeof setTimeout> | undefined;
  /** 판 밖 `drop` 이 받는 쪽을 지나는 중이다 — 뒤따르는 `dragend` 는 그 뒤처리에 맡긴다 */
  let outsideDropPending = false;

  function leafOfCell(tabId: string, paneId: string): SheetLeaf | null {
    const tab = localById.get(tabId);
    const pane = tab ? findPane(tab.root, paneId) : null;
    return tab && pane ? { tab, kind: pane.kind } : null;
  }

  /** 커서 아래의 칸이 받아 주는가 — `dragover` 와 `drop` 이 같은 함수를 부른다(미리보기가 받은 것을 놓으면 그대로 일어난다) */
  function cellHit(ev: DragEvent): { paneId: string; preview: "zone" | "all"; zone: DropZone; dir: SplitDir; side: PaneSide } | null {
    if (dragSource === null || !(ev.target instanceof Element)) return null;
    const el = ev.target.closest<HTMLElement>("[data-sheet-cell]");
    const paneId = el?.dataset.sheetCell;
    const tabId = el?.closest<HTMLElement>("[data-sheet-tab]")?.dataset.sheetTab;
    if (!el || !paneId || !tabId) return null;
    const zone = zoneOf(el.getBoundingClientRect(), ev.clientX, ev.clientY);
    const plan = cellDropPlan(dragSource, paneId, leafOfCell(tabId, paneId), zone);
    if (!plan.accept || !plan.split) return null;
    return { paneId, preview: plan.preview === "all" ? "all" : "zone", zone, ...plan.split };
  }

  function onCellDragStart(ev: DragEvent, paneId: string): void {
    const dt = ev.dataTransfer;
    if (!dt) return;
    tip = null;
    dragSource = paneId;
    setDraggingPane(paneId);
    dt.setData(PANE_DRAG_TYPE, paneId);
    // 창을 넘길 준비까지 머리줄과 같다 — 드래그가 창 밖으로 나간 뒤에는 `dataTransfer` 를 못 건드린다.
    const token = startPaneTear(paneId);
    if (token !== null) dt.setData(TEAR_DRAG_TYPE, String(token));
    dt.effectAllowed = "move";
    window.addEventListener("drop", onWindowDrop, true);
    requestAnimationFrame(() => {
      if (dragSource === paneId) dimmed = paneId;
    });
  }

  /** 끌기 표시를 거둔다 — 두 번 불려도 된다(옮긴 칸은 DOM 에서 사라져 `dragend` 가 오지 않을 수 있다) */
  function finishDrag(): void {
    window.removeEventListener("drop", onWindowDrop, true);
    if (dragSource !== null && draggingPane() === dragSource) setDraggingPane(null);
    dragSource = null;
    dimmed = null;
    dropAt = null;
  }

  function onSheetDragOver(ev: DragEvent): void {
    if (dragSource === null) return;
    const hit = cellHit(ev);
    if (!hit) {
      dropAt = null;
      return;
    }
    ev.preventDefault(); // 받는 칸에서만 — 이것이 곧 "여기 놓아도 된다" 는 신호다
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    if (dropAt?.paneId !== hit.paneId || dropAt.zone !== hit.zone || dropAt.preview !== hit.preview) {
      dropAt = { paneId: hit.paneId, preview: hit.preview, zone: hit.zone };
    }
  }

  function onSheetDragLeave(ev: DragEvent): void {
    if (dropAt === null) return;
    const to = ev.relatedTarget;
    if (to instanceof Node && rootEl?.contains(to)) return;
    // WebView2 가 자식 사이에서도 relatedTarget 을 비울 수 있다 — 판 안이면 이탈이 아니다(탭 줄 · 캔버스의 같은 처방)
    const box = rootEl?.getBoundingClientRect();
    if (to === null && box && ev.clientX >= box.left && ev.clientX < box.right && ev.clientY >= box.top && ev.clientY < box.bottom) return;
    dropAt = null;
  }

  /** 판 안의 칸에 놓았다 — 보던 탭 그대로 옮기고 판은 열어 둔다(이어서 정리할 수 있게) */
  function onSheetDrop(ev: DragEvent): void {
    const id = dragSource;
    const hit = cellHit(ev);
    if (id === null || !hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    finishDrag();
    endTear();
    movePane(id, hit.paneId, hit.dir, hit.side, { stay: true });
    rove = id;
    justMoved = id;
    clearTimeout(justTimer);
    justTimer = setTimeout(() => (justMoved = null), 1100);
    // 끌던 칸이 다시 그려져 포커스가 `<body>` 로 떨어졌을 수 있다 — Escape 가 계속 판에 닿게
    void tick().then(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) rootEl?.focus({ preventScroll: true });
    });
  }

  /**
   * 판 **밖**에 놓았다 — 받는 쪽(`PaneHost` 의 타일 · 탭 줄)이 전파를 끊으므로 캡처 단계에서 듣고, 그쪽 손잡이가 다 돈 뒤(다음 태스크)에 본다.
   * 받았으면 그쪽이 끌기 표시를 지웠다(`setDraggingPane(null)`) — 그때만 판을 접고 옮긴 타일로 간다. 아니면 아무도 받지 않은 드롭이라 그대로 둔다.
   */
  function onWindowDrop(ev: DragEvent): void {
    if (ev.target instanceof Node && rootEl?.contains(ev.target)) return;
    const id = dragSource;
    if (id === null) return;
    outsideDropPending = true;
    setTimeout(() => {
      outsideDropPending = false;
      if (dragSource !== id) return;
      const received = draggingPane() === null;
      finishDrag();
      endTear();
      if (!received) return;
      closeSessionSheet(false);
      focusTile("", id);
    }, 0);
  }

  /** 드래그가 끝났다 — 판정은 타일 머리줄(`DropController.onDragEnd`)과 같다: 창 밖에 놓였으면 새 창으로 */
  function onCellDragEnd(ev: DragEvent): void {
    const id = dragSource;
    if (id === null || outsideDropPending) return;
    finishDrag();
    const p = pendingTear();
    const outside = ev.dataTransfer?.dropEffect === "none" && outsideWindow(ev);
    if (outside && p?.paneId === id) {
      closeSessionSheet(false);
      void tearOutPane(ev.screenX, ev.screenY); // 예약 정리는 그쪽이 (비동기라) 맡는다
      return;
    }
    // 창 밖에 놓았는데 이 타일의 예약이 없었다 = 시작에서 창 넘기기가 거절됐다(저장 안 한 문서 등)
    if (outside) noticeTearRefused();
    endTear();
  }

  onDestroy(() => {
    clearTimeout(justTimer);
    if (dragSource !== null) endTear();
    finishDrag();
  });

  // ── 로빙 탭 — 칸 하나만 Tab 순회에 낀다. 기본은 지금 탭의 첫 칸 ─────────────────────────────
  let rove = $state<string | null>(null);
  const roveKey = $derived.by(() => {
    const all = rows.flatMap((r) => r.tabs.flatMap((tab) => tab.cells.map((c) => c.paneId)));
    if (rove !== null && all.includes(rove)) return rove;
    const cur = rows.flatMap((r) => r.tabs).find((tab) => tab.current);
    return cur?.cells[0]?.paneId ?? all[0] ?? null;
  });

  /** ←→ 칸 · ↑↓ 앞뒤 탭 카드의 첫 칸 · Home/End — 문서 순서(줄 → 탭 카드 → 트리 잎 순서) 그대로 */
  function navigate(ev: KeyboardEvent): void {
    const el = ev.currentTarget as HTMLElement;
    const root = rootEl;
    if (!root) return;
    const cells = [...root.querySelectorAll<HTMLElement>("[data-sheet-cell]")];
    const i = cells.indexOf(el);
    let next: HTMLElement | null | undefined;
    switch (ev.key) {
      case "ArrowLeft":
        next = cells[i - 1];
        break;
      case "ArrowRight":
        next = cells[i + 1];
        break;
      case "Home":
        next = cells[0];
        break;
      case "End":
        next = cells[cells.length - 1];
        break;
      case "ArrowUp":
      case "ArrowDown": {
        const tabsEls = [...root.querySelectorAll<HTMLElement>("[data-sheet-tab]")];
        const j = tabsEls.findIndex((tab) => tab.contains(el));
        next = tabsEls[ev.key === "ArrowUp" ? j - 1 : j + 1]?.querySelector<HTMLElement>("[data-sheet-cell]");
        break;
      }
      default:
        return;
    }
    ev.preventDefault();
    if (!next) return;
    rove = next.dataset.sheetCell ?? null;
    next.focus();
  }

  // ── 말풍선 — 판(`.sheet`) 안 절대 위치. 내용은 지금 지도에서 다시 찾는다(경과 · 상태가 바뀌어도 맞게) ──────
  const TIP_ID = "session-sheet-tip";
  let tip = $state<{ tabId: string; paneId: string; el: HTMLElement } | null>(null);
  let tipEl = $state<HTMLElement | null>(null);
  let tipPos = $state<{ left: number; top: number; above: boolean; ax: number } | null>(null);
  const tipData = $derived.by(() => {
    if (!tip) return null;
    const tab = rows.flatMap((r) => r.tabs).find((x) => x.id === tip!.tabId);
    const cell = tab?.cells.find((c) => c.paneId === tip!.paneId);
    return tab && cell ? { tab, cell } : null;
  });

  function showTip(tabId: string, paneId: string, el: HTMLElement): void {
    if (dragSource !== null) return;
    tip = { tabId, paneId, el };
  }

  /** 얹기가 끝나도 키보드 포커스가 그 칸에 있으면 남긴다 */
  function hideTip(el: HTMLElement, force = false): void {
    if (tip?.el !== el) return;
    if (!force && document.activeElement === el) return;
    tip = null;
  }

  /** 그려진 뒤 재고 놓는다 — 그 칸 위가 기본, 자리가 없으면 아래 · 가로는 판 안으로 민다(앱 툴팁과 같은 `placeTooltip`) */
  $effect(() => {
    const data = tipData;
    const el = tipEl;
    const host = rootEl;
    if (!data || !el || !host || !tip) {
      tipPos = null;
      return;
    }
    const box = host.getBoundingClientRect();
    const r = tip.el.getBoundingClientRect();
    const anchor = { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const p = placeTooltip(anchor, size, { width: box.width, height: box.height }, "above");
    const ax = Math.min(Math.max(anchor.left + anchor.width / 2 - p.left, 10), size.width - 10);
    tipPos = { ...p, ax };
  });
</script>

<!--
  바깥 상자(`.drop-clip`)는 캔버스 위쪽 절반을 잘라 내는 창일 뿐이다 — 판이 위에서 내려오는 동안 탭 바 · 상태바
  위로 비져 나오지 않게 하고, 누르기는 받지 않는다(`pointer-events: none`). `tabindex="-1"` — 열 때 키보드를 받을
  몸(위 `onMount`). 탭 순회에는 끼지 않는다.
-->
<div class="drop-clip" data-session-drop>
<div
  class="sheet glass-mid"
  role="dialog"
  data-session-sheet
  aria-label={t("app.sheet.aria")}
  tabindex="-1"
  bind:this={rootEl}
  onkeydown={onKeydown}
  ondragover={onSheetDragOver}
  ondragleave={onSheetDragLeave}
  ondrop={onSheetDrop}
  transition:drop|global
>
  <div class="shead">
    <span class="stitle">{t("app.sheet.title")}</span>
    <span class="sscope">{t("app.sheet.scope", { n: buckets.total })}</span>
    <!-- 상태 칩 — 수 + 칸과 같은 면 색이라 범례를 겸한다(2026-11-02 — 판 아래 범례 줄은 헷갈려서 머리 왼쪽 "이 창 N개" 바로 옆으로). 0 인 칩은 숨는다 -->
    {#if buckets.total > 0}
      <div class="sum" data-sheet-summary role="group" aria-label={t("app.sheet.sum.aria")}>
        {#if summary.permission > 0}<span class="schip has-g s-permission" data-sum="permission"
            ><AgentStatusGlyph state="permission" aria-hidden="true" />{t("app.sheet.sum.permission", {
              n: summary.permission,
            })}</span
          >{/if}
        {#if summary.finished > 0}<span class="schip has-g s-finished" data-sum="finished"
            ><AgentStatusGlyph state="finished" aria-hidden="true" />{t("app.sheet.sum.finished", {
              n: summary.finished,
            })}</span
          >{/if}
        {#if summary.fail > 0}<span class="schip has-g s-fail" data-sum="fail"
            ><ErrorGlyph aria-hidden="true" />{t("app.sheet.sum.fail", { n: summary.fail })}</span
          >{/if}
        {#if summary.running > 0}<span class="schip has-g s-running" data-sum="running"
            ><AgentStatusGlyph state="running" aria-hidden="true" />{t("app.sheet.sum.running", {
              n: summary.running,
            })}</span
          >{/if}
        {#if summary.idle > 0}<span class="schip s-idle" data-sum="idle"
            >{t("app.sheet.sum.idle", { n: summary.idle })}</span
          >{/if}
        {#if summary.off > 0}<span class="schip s-off" data-sum="off">{t("app.sheet.sum.off", { n: summary.off })}</span
          >{/if}
      </div>
    {/if}
    <span class="fill"></span>
    <button type="button" class="btn btn-ghost btn-sm" data-sheet-close onclick={() => closeSessionSheet()}
      >{t("app.actions.close")}</button
    >
  </div>
  <div class="sbody" onscroll={() => (tip = null)}>
    <!-- 떨어진 세션(③-4) — 아무 창도 데려가지 않은 세션이 있을 때만 맨 위에 선다 -->
    <DetachedSessions />
    {#if rows.length === 0 && detachedCount() === 0}
      <p class="empty" data-sheet-empty>{t("app.sheet.empty")}</p>
    {/if}
    {#if rows.length > 0}
      {#each rows as row (row.id ?? "")}
        <section class="ws" data-sheet-ws={row.id ?? ""} aria-label={row.name ?? undefined}>
          {#if row.name !== null}<span class="wsn">{row.name}</span>{/if}
          <div class="strip">
            {#each row.tabs as tab (tab.id)}{@render tabCard(tab)}{/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
  {#if tipData}
    {@render bubble(tipData.tab, tipData.cell)}
  {/if}
</div>
</div>

<!-- 탭 카드 한 장 — 위 축소판(16:10 · 칸은 트리의 잎 비율 그대로, 틈 2px) · 아래 탭 줄과 같은 표식 + 탭 이름 -->
{#snippet tabCard(tab: MapTab)}
  {@const dot = dots.get(tab.id)}
  {@const spec = localById.get(tab.id)}
  {@const firstCell = tab.cells[0]}
  {@const auxPane = firstCell ? panes.get(firstCell.paneId) : undefined}
  <div class="tmap" class:cur={tab.current} data-sheet-tab={tab.id} data-current={tab.current || undefined}>
    <div class="mini">
      {#each tab.cells as cell (cell.paneId)}{@render cellOf(tab, cell)}{/each}
    </div>
    <div class="tl">
      <!-- 탭 줄과 같은 로고(`Tabs.svelte` 의 `.kind`) — 보조 창 탭은 트리가 없어 첫 칸의 그림 -->
      <span class="tk" data-sheet-tab-logo aria-hidden="true">
        {#if spec?.orch}
          <EqBars state={pulseOfRun(spec.orch.runId)} size={12} />
        {:else if spec}
          <PaneIcon pane={tabIconPane(spec, dot)} size={13} />
        {:else if firstCell?.card?.kind === "ai" && firstCell.card.ai}
          <AiGlyph name={firstCell.card.ai} size={13} />
        {:else if auxPane}
          <PaneIcon pane={auxPane} size={13} />
        {/if}
      </span>
      <span class="tn">{tabTitle(tab)}</span>
      {#if dot}<TabStatusGlyph {dot} />{/if}
    </div>
  </div>
{/snippet}

<!--
  칸 하나 — 통째로 단추(누르면 그 타일로 · 끌 수 있는 칸은 끌면 옮긴다). 타일 표식은 `data-sheet-cell` 이다: `data-pane` 은 타일 자신의 표식이라
  (`pane/focus.ts` 가 `[data-pane=…]` 로 찾는다) 같은 이름을 달면 판의 칸이 먼저 잡힌다. `title` 은 달지 않는다 —
  앱 툴팁 층이 그것을 가로채 말풍선이 둘 뜬다(이 칸의 말풍선은 아래 `bubble`).
-->
{#snippet cellOf(tab: MapTab, cell: MapCell)}
  {@const card = cell.card}
  {@const pane = panes.get(cell.paneId) ?? leafSpecs.get(cell.paneId)}
  {@const link = linkOf(cell)}
  {@const pulse = albumPulseOf(pane, card)}
  {@const album = pulse ? albumCell(pulse) : null}
  {@const face = card ? cellFace(card) : (album?.face ?? null)}
  {@const mark = cellMark(card, !tab.current && hasBellMark(cell.paneId))}
  <button
    type="button"
    class="cell {face ? `s-${face}` : link?.state === 'closed' ? 'bare s-off' : 'bare'}"
    class:vivid={album?.vivid}
    data-album-pulse={pulse ?? undefined}
    class:w-on={link?.writable}
    class:source={dimmed === cell.paneId}
    class:just={justMoved === cell.paneId}
    draggable={canDragCell(leafOfCell(tab.id, cell.paneId), mobileLayout()) ? "true" : undefined}
    data-link={link?.state}
    data-sheet-cell={cell.paneId}
    data-state={card?.state}
    data-card-kind={card?.kind}
    tabindex={roveKey === cell.paneId ? 0 : -1}
    aria-label={cellLabel(tab, cell)}
    aria-describedby={tip?.paneId === cell.paneId ? TIP_ID : undefined}
    style:left="calc({cell.x * 100}% + 1px)"
    style:top="calc({cell.y * 100}% + 1px)"
    style:width="calc({cell.w * 100}% - 2px)"
    style:height="calc({cell.h * 100}% - 2px)"
    onclick={() => go(tab.id, cell.paneId)}
    onkeydown={navigate}
    ondragstart={(ev) => onCellDragStart(ev, cell.paneId)}
    ondragend={onCellDragEnd}
    onpointerenter={(ev) => showTip(tab.id, cell.paneId, ev.currentTarget)}
    onpointerleave={(ev) => hideTip(ev.currentTarget)}
    onfocus={(ev) => {
      rove = cell.paneId;
      showTip(tab.id, cell.paneId, ev.currentTarget);
    }}
    onblur={(ev) => hideTip(ev.currentTarget, true)}
  >
    <!-- 에이전트 칸은 그 에이전트 로고(타일 머리줄과 같은 그림), 그 밖(셸 · SSH · 파일 · 브랜치 · 문서 · diff · DB …)은
         타일 머리줄과 같은 아이콘 — 카드가 없는 칸도 그 탭 트리의 명세(`leafSpecs`)로 그린다 -->
    {#if (card?.kind === "ai" && card.ai) || pane}
      <span class="ico" aria-hidden="true">
        {#if card?.kind === "ai" && card.ai}
          <AiGlyph name={card.ai} size={16} />
        {:else if pane}
          <PaneIcon {pane} size={16} />
        {/if}
      </span>
    {/if}
    <!-- 오른쪽 위 표식 하나 — 탭과 같은 그림 · 같은 순서(칸의 상태는 `aria-label` 이 말한다). 벨 조건은 탭 줄(`tabBells`)과 같다: 지금 보는 탭은 없음 -->
    {#if mark === "permission" || mark === "finished" || mark === "running"}
      <span class="corner" data-sheet-glyph={mark}><AgentStatusGlyph state={mark} aria-hidden="true" /></span>
    {:else if mark === "fail"}
      <span class="corner" data-sheet-glyph="fail"><ErrorGlyph aria-hidden="true" /></span>
    {:else if mark === "bell"}
      <span class="corner" data-sheet-glyph="bell"><BellGlyph aria-hidden="true" /></span>
    {:else if mark === "command"}
      <span class="corner" data-sheet-glyph="command"><i class="cmd-dot"></i></span>
    {/if}
    {#if dropAt?.paneId === cell.paneId}<DropOverlay preview={dropAt.preview} zone={dropAt.zone} />{/if}
  </button>
{/snippet}

<!-- 말풍선 — 1줄 아이콘 + 탭 · 이름, 2줄 명령 + exit 또는 에이전트 줄, 3줄 상태 칩(상태 · 경과) -->
{#snippet bubble(tab: MapTab, cell: MapCell)}
  {@const card = cell.card}
  {@const pane = panes.get(cell.paneId) ?? leafSpecs.get(cell.paneId)}
  <div
    class="tip"
    class:on={tipPos !== null}
    class:above={tipPos?.above}
    id={TIP_ID}
    role="tooltip"
    bind:this={tipEl}
    style:left="{tipPos?.left ?? 0}px"
    style:top="{tipPos?.top ?? 0}px"
    style:--ax="{tipPos?.ax ?? 0}px"
  >
    <span class="t1">
      {#if card?.kind === "ai" && card.ai}
        <span class="tico" aria-hidden="true"><AiGlyph name={card.ai} size={14} /></span>
      {:else if pane}
        <span class="tico" aria-hidden="true"><PaneIcon {pane} size={14} /></span>
      {/if}
      <span class="tname">{t("app.sheet.cell", { tab: tabTitle(tab), name: cellName(cell) })}</span>
    </span>
    {#if !card}
      <!-- 세션 없는 타일 — 이름이 못 담는 위치(전체 경로 · diff 범위 · DB 엔진 · 경유) -->
      {@const detail = pane ? cellDetail(pane, t, findDbConn) : null}
      {@const link = linkOf(cell)}
      {#if detail}<span class="t2 quiet" data-sheet-detail>{detail}</span>{/if}
      {#if link}
        <!-- 연결 칩 — DB · 원격 파일만(끊김은 칸도 점선) · 쿼리 타일이 쓰기 켬이면 경고 칩 -->
        <span class="t3" data-sheet-link={link.state}>
          <span class="schip {link.state === 'open' ? 's-idle' : link.state === 'closed' ? 's-off' : 's-connecting'}"
            >{t(LINK_KEY[link.state])}</span
          >
          {#if link.writable}<span class="schip s-fail">{t("pane.query.write")}</span>{/if}
        </span>
      {/if}
    {:else}
      {@const elapsed = elapsedOf(card)}
      {#if card.state === "off"}
        <span class="t2 quiet">{t("board.card.off")}</span>
      {:else if card.kind === "ai"}
        <span class="t2 quiet">{agentLine(card)}</span>
      {:else if card.commandShort !== ""}
        <span class="t2 cmd" class:bad={!card.running && card.exit !== null && card.exit !== 0}
          >{card.commandShort}{#if card.running}
            …{:else if card.exit !== null}
            · {t("board.card.exit", { n: card.exit })}{/if}</span
        >
      {:else}
        <span class="t2 quiet">{t("board.card.nocmd")}</span>
      {/if}
      <span class="t3">
        <span class="schip s-{cellFace(card)}">{stateLabel(card)}{#if elapsed !== null}&nbsp;· {elapsed}{/if}</span>
        {#if card.subagents > 0}
          <!-- 진행 중 서브 에이전트 수 (docs/log/2026-10-04-subagent-signals.md) -->
          <span class="schip s-idle" data-subagents={card.subagents}>{subagentsLabel(card.subagents, t)}</span>
        {/if}
      </span>
    {/if}
  </div>
{/snippet}

<style>
  /*
   * 캔버스(`+page` 의 `.pane` — `position: relative`)의 위쪽 절반 + 그림자 몫. z-index 95 — 타일(캔버스 안 최고 21) ·
   * 사용량 화면(90)보다 위, 독 · 기록 보기(100) · 팔레트(110)보다 아래.
   */
  .drop-clip {
    --drop-shadow-room: 32px;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: calc(50% + var(--drop-shadow-room));
    z-index: 95;
    overflow: hidden;
    pointer-events: none;
  }

  /*
   * 판 — 독과 같은 등급의 떠 있는 면(`.glass-mid` — 10-29). 평면은 `--surface-raised-solid`(타일 위에 뜨는 면은 투명도를
   * 타지 않는다: 밑의 터미널 글자가 비치면 읽기를 해친다), 글래스는 독과 같은 흐림 · 흰 선 · 그림자와 슬라이더를
   * 따르는 판 진하기(theme.css 재질 절). 위는 캔버스 가장자리에 붙고, 아래 모서리만 둥글게 · 테두리 · 그림자.
   * 높이는 내용만큼, 캔버스 절반에서 멈추고 넘치면 몸(`.sbody`)이 스크롤한다.
   * 내려오는 몸짓(`drop`)은 `transform` 만이고 자르기는 `.drop-clip` 의 `overflow` 라 흐림이 움직이는 동안에도 선다
   * (`opacity` · `clip-path` 는 배경 뿌리를 만든다 — theme.css 모달 등장 절).
   * `position: relative` — 칸 말풍선(`.tip`)의 기준 상자.
   */
  .sheet {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    max-height: calc(100% - var(--drop-shadow-room));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
    background: var(--glass-mid, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-top: none; /* 글래스의 공용 선 규칙은 색만 바꾼다 — 없는 위 변에 선이 생기지 않는다 */
    border-radius: 0 0 var(--radius-surface) var(--radius-surface); /* MD3 판(2026-10-18) */
    box-shadow: var(--shadow-raised);
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  .sheet:focus {
    outline: none;
  }

  /*
   * **데스크톱은 타일 한 장처럼 뜬 카드**(2026-11-03 사용자 — 목업 2TU363xaRzbSExNkM1jMiq) — 캔버스 위 가장자리에 붙은 각진 덮개는
   * 둥글게(panel)에서 위가 잘려 보이고, 감싸기(hug)에서는 감싼 모서리 곡선을 잘라 덮었다. 그래서 상태줄 모양(평면 포함 — 셋을 한 모양으로)과
   * 상관없이 캔버스 틈(`--gap`)만큼 안쪽 · 네 모서리 둥글게 · 사방 선. 위 규칙(붙은 덮개)은 모바일 배치만 쓴다.
   * 위 틈은 `--sheet-lift` 하나로 잡아 내려오는 몸짓(`drop`)도 그만큼 더 올라간다. 감싸기는 자르는 상자를 캔버스 모서리 곡선
   * (`--hug-r` — `+page` 의 감싸기 절)대로 둥글게 깎아, 내려오는 동안에도 카드가 크롬 조각 위로 비져 나오지 않는다
   * (`border-radius` + `overflow` 자르기는 배경 뿌리를 만들지 않는다 — 글래스 흐림은 그대로). 모바일 배치(폰 — 화면이 좁다)는 위의 붙은 덮개 그대로.
   */
  :global(.app:not(.mobile)) .drop-clip {
    --sheet-lift: var(--gap);
    box-sizing: border-box;
    padding: 0 var(--gap);
  }

  :global(.app:not(.mobile) .body[data-statusbar-style="hug"]) .drop-clip {
    border-radius: var(--hug-r) var(--hug-r) 0 0;
  }

  /* 평면 띠 왼쪽 · 오른쪽 — 그 쪽 안쪽 모서리 하나만 같은 곡률(`--corner-r` — `+page` 의 `.canvas-corner` 절) */
  :global(.app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="left"]) .drop-clip {
    border-radius: var(--corner-r) 0 0 0;
  }

  :global(.app:not(.mobile)[data-statusbar-style="flat"][data-statusbar="right"]) .drop-clip {
    border-radius: 0 var(--corner-r) 0 0;
  }

  :global(.app:not(.mobile)) .sheet {
    margin-top: var(--sheet-lift);
    max-height: calc(100% - var(--drop-shadow-room) - var(--sheet-lift));
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
  }

  .shead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--line);
  }

  .stitle {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }

  .sscope {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .fill {
    flex: 1;
  }

  .sbody {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4) var(--space-3);
  }

  .empty {
    margin: var(--space-2) 0;
    font-size: var(--t-sm);
    color: var(--fg-2);
  }

  /* ── 상태 칩 — 요약 · 범례 · 말풍선이 같은 말. 면은 칸과 같은 톤 면(MD3 container) ─────────────── */
  .sum {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .schip {
    flex: 0 0 auto;
    padding: 1px 8px;
    font-size: 11px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    border: 1px solid transparent;
    border-radius: 999px;
  }

  /* 글리프를 앞에 단 칩 — 머리 요약 줄 */
  .schip.has-g {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding-left: 4px;
  }

  .schip.s-permission {
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
  }

  .schip.s-finished {
    color: var(--on-ok-soft);
    background: var(--ok-soft);
  }

  .schip.s-fail {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }

  /* 실행 중 — 면 없이 테두리(사람이 볼 칸만 면을 칠한다) */
  .schip.s-running {
    color: var(--fg-1);
    border-color: var(--line);
  }

  /* DB · 원격 파일의 연결 중 — 에이전트 상태가 아니라 칸과 나누지 않는다 */
  .schip.s-connecting {
    color: var(--m3-on-tertiary-container);
    background: var(--tertiary-soft);
  }

  .schip.s-idle {
    color: var(--fg-2);
    border-color: var(--line);
  }

  .schip.s-off {
    color: var(--fg-2);
    border: 1px dashed var(--line-strong);
  }

  /* ── 워크스페이스 한 줄 — 왼쪽 이름(말줄임) · 오른쪽 탭 카드들(줄바꿈) ───────────────────────── */
  .ws {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-width: 0;
  }

  .wsn {
    flex: 0 0 84px;
    min-width: 0;
    padding-top: 4px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .strip {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* ── 탭 카드 — 안쪽 카드 면 · 모서리. 지금 탭은 강조색 안쪽 테두리 ───────────────────────── */
  .tmap {
    flex: 0 0 200px; /* 2026-11-02 — 128px 는 칸이 작아 배치가 안 읽혔다 */
    box-sizing: border-box;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px;
    background: var(--control-tile-bg);
    border-radius: var(--radius-surface-inner);
  }

  .tmap.cur {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .mini {
    position: relative;
    aspect-ratio: 16 / 10;
    border-radius: 7px;
    overflow: hidden;
  }

  .tl {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    min-height: 16px;
    padding: 0 3px;
  }

  /* 로고 — 탭 줄의 `.kind` 와 같다 */
  .tk {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }

  /* 탭 칸에서는 표식을 누르면 그 타일로 가지만, 이 줄은 단추가 아니다 — 가는 곳은 위 칸이다 */
  .tl :global(.tab-glyph.agent) {
    cursor: default;
  }

  .tn {
    flex: 1;
    min-width: 0;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── 칸 — 트리의 잎 자리(절대 위치 · 사방 1px 들여 틈 2px). 글자 없이 아이콘 + 상태 면 ─────────── */
  .cell {
    position: absolute;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    color: var(--fg-2);
    background: var(--bg-chip);
    cursor: pointer;
  }

  .cell:hover {
    outline: 1px solid var(--line-strong);
    outline-offset: -1px;
  }

  .cell:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 끌 수 있는 칸 · 끄는 원본 · 방금 옮긴 칸(강조색 테두리 한 번) */
  .cell[draggable="true"] {
    cursor: grab;
  }

  .cell.source {
    opacity: 0.35;
    outline: 1.5px dashed var(--line-strong);
    outline-offset: -1.5px;
  }

  .cell.just {
    animation: cell-just 1.1s ease-out;
  }

  @keyframes cell-just {
    0%,
    70% {
      box-shadow: inset 0 0 0 2px var(--accent);
    }
    100% {
      box-shadow: inset 0 0 0 2px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cell.just {
      animation: none;
    }
  }

  /* 칸 안 그림은 끌기를 시작하지 않는다 — 로고 `<img>` 가 제 그림을 끌어 버리면 칸이 끌리지 않는다 */
  .ico,
  .corner {
    pointer-events: none;
  }

  .ico {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
  }

  /* 사람이 볼 칸만 면을 칠한다 — 권한 대기 · 완료 · 실패. 실행 중은 기본 면 + 글리프 */
  .cell.s-permission {
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
  }

  .cell.s-finished {
    color: var(--on-ok-soft);
    background: var(--ok-soft);
  }

  .cell.s-fail {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }

  /* 실행 중 — 기본 면에 옅게 섞는다(칠한 칸보다 확실히 약하게 · 조용함과는 구분되게). 에이전트 = 강조색 · 명령 = 초록 */
  .cell.s-running {
    background: color-mix(in srgb, var(--ok) 12%, var(--bg-chip));
  }

  .cell.s-running[data-card-kind="ai"] {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-chip));
  }

  /* 앨범 재생 · 검토 — 실행 중과 같은 세기 · 색은 막대(`EqBars`)와 같다 */
  .cell.s-album-playing {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-chip));
  }

  .cell.s-album-reviewing {
    background: color-mix(in srgb, var(--tertiary, var(--accent)) 12%, var(--bg-chip));
  }

  /* 오른쪽 위 표식 칸(12px) */
  .corner {
    position: absolute;
    top: 3px;
    right: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
  }

  /* 명령 실행 중 — 탭과 같은 6px 점 */
  .cmd-dot {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
  }

  .cell.s-off {
    background: transparent;
    outline: 1.5px dashed var(--line-strong);
    outline-offset: -1.5px;
    opacity: 0.6;
  }

  /* 판에 카드가 없는 타일(문서 · 파일 · 쿼리 …) — `bare`(빈 판 안내 `.empty` 와 이름을 나눈다 — 그 margin 이 칸을 밀었다 · 2026-11-03) · 흐린 칸 + 흐린 아이콘(상태가 없다는 뜻). 누르면 그 타일로 가는 것은 같다 */
  .cell.bare {
    color: var(--fg-3);
    background: color-mix(in srgb, var(--bg-chip) 45%, transparent);
  }

  .cell.bare:not(.vivid) .ico {
    opacity: 0.7;
  }

  /* 쿼리 타일의 쓰기 켬 — 오른쪽 위 오류색 점(멈춰 있다 — 상태가 아니라 경고) */
  .cell.w-on::after {
    content: "";
    position: absolute;
    top: 3px;
    right: 3px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--err);
  }

  /*
   * ── 칸 말풍선 — 앱 툴팁(`Tooltip.svelte`)과 같은 면: 비치지 않는 뜬 면 · 강한 선 · 작은 모서리 · 그림자 없음.
   * 꼬리는 같은 면의 마름모(선 두 변). 판 안 절대 위치라 판 밖으로 나가지 않는다(`placeTooltip` 이 판 상자 안으로 민다).
   */
  .tip {
    position: absolute;
    z-index: 2;
    width: max-content;
    max-width: min(300px, calc(100% - 16px));
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    pointer-events: none;
    opacity: 0;
  }

  .tip.on {
    opacity: 1;
  }

  .tip::after {
    content: "";
    position: absolute;
    left: var(--ax, 50%);
    top: -5px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-right: none;
    border-bottom: none;
    transform: rotate(45deg);
  }

  .tip.above::after {
    top: auto;
    bottom: -5px;
    border: 1px solid var(--line-strong);
    border-left: none;
    border-top: none;
  }

  .t1 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: var(--fw-semibold);
  }

  .tico {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
  }

  .tname {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .t2 {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .t2.cmd {
    font-family: var(--font-mono);
    color: var(--fg-2);
  }

  .t2.cmd.bad {
    color: var(--err);
  }

  .t2.quiet {
    color: var(--fg-3);
  }

  .t3 {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* 폰 · 좁은 폭 — 워크스페이스 이름이 위로, 탭 카드는 두 열 */
  @media (max-width: 640px) {
    .ws {
      flex-direction: column;
      gap: 4px;
    }

    .wsn {
      flex: 0 0 auto;
      width: auto;
      max-width: 100%;
      padding-top: 0;
    }

    .strip {
      width: 100%;
    }

    .tmap {
      flex: 0 0 calc(50% - var(--space-2) / 2);
    }
  }
</style>
