<script lang="ts">
  import { isBellFlashing } from "$lib/app/bell.svelte.js";
  import { tileGlowOf } from "$lib/app/tile-glow.svelte.js";
  import { touchAgentBanner } from "$lib/app/agent-banners.svelte.js";
  import { clearAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
  import Terminal from "$lib/Terminal.svelte";
  import SftpBrowser from "$lib/SftpBrowser.svelte";
  import DocView from "$lib/DocView.svelte";
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
  import { clearDocAnchor, docAnchorOf } from "$lib/app/doc-anchors.svelte.js";
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
  import { LocalAiMenuController } from "$lib/pane/local-ai-menu.svelte.js";
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

  /**
   * 호스트 조작 묶음 — 이 컴포넌트는 **통로가 아니다**
   * (docs/log/2026-09-05-refactor-structure.md). 시작 타일은 자기가 직접 꺼내
   * 쓰고, 여기서 읽는 것은 파일 브라우저 두 곳에 내려 줄 **안내 통로 하나**뿐이다
   * (`onnotice` — 그 컴포넌트는 호스트를 모르는 범용 탐색기라 프롭으로 받는다).
   */
  const notice = hostActions().onnotice;

  // ---------------------------------------------------------------------------
  // 왜 **전역** 패널 호스트인가 — 인스턴스 보존 (docs/log/2026-09-02-pane-host.md)
  //
  // 원칙은 예전과 같다: 트리를 재귀 컴포넌트로 그리면 잎이 split 으로 바뀌는 순간 그 자리의
  // Terminal 이 언마운트되고, 언마운트 = `close` invoke = **세션이 끊긴다.** 그래서 트리는
  // 기하만 계산하고 터미널은 `pane.id` 키의 평면 절대배치 목록으로 그린다.
  //
  // 달라진 것은 그 목록의 **범위**다. 예전에는 탭마다 SplitView 가 자기 목록을 들어서, 탭 A 의
  // 패널을 탭 B 로 옮기면 목록이 갈리며 반드시 재마운트가 났다. 지금은 목록이 **앱에 하나**다 —
  // 패널이 어느 탭 소속인지는 style(위치·크기·display)에만 반영되므로, 탭을 옮겨도 같은 키의
  // 같은 DOM 상자가 style 만 바꿔 단다. 탭 전환도 예전과 똑같이 `display:none` 이다(사람이 고른
  // 전환이면 떠나는 탭만 슬라이드 동안 그려 둔다 — 아래 "탭 전환 슬라이드").
  //
  // 목록을 **만드는** 계산은 `pane/boxes.ts` 의 순수 함수다 (최대화 그물 포함).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // 탭 전환 슬라이드 (docs/log/2026-09-29-tab-slide.md · 요청은 `pane/tab-slide.svelte.ts`)
  //
  // 비활성 탭의 타일은 예전 그대로 `display:none` 이다. 슬라이드 동안만 **떠나는 탭**의 타일을 그려 둔다
  // (`HostBox.shown`) — 그 터미널은 `visible` 을 계속 참으로 받아 WebGL 을 쥔 채 제 크기 그대로 밀려
  // 나가고(`inert` · 커서 없음), 끝나면 평소처럼 숨는다. 들어오는 탭은 평소의 탭 전환과 **똑같이** 서고
  // (그 자리의 rAF refit — 크기가 그대로면 `resize_session` 은 안 나간다) 상자에 `transform` 만 얹힌다.
  // `transform` 은 상자의 레이아웃 크기를 바꾸지 않으므로 ResizeObserver 도 fit 도 움직이지 않는다.
  //
  // 요청의 `to` 가 지금 활성 탭이 아니면(그사이 닫기·새 탭으로 바뀌었다) 슬라이드는 없는 것이다.
  // ---------------------------------------------------------------------------
  const slide = $derived.by<TabSlide | null>(() => {
    const s = tabSlide();
    return s !== null && s.to === activeId && tabs.some((t) => t.id === s.from) ? s : null;
  });
  const leavingId = $derived(slide?.from ?? null);

  /**
   * 사람이 **그 타일을 만졌다**(타일 안의 키 · 누름, 캡처 단계) — 에이전트 배너를 "확인함" 으로 풀고, 그 타일의
   * "완료 · 안 봄" 표식도 거둔다(2026-10-07 실기: 가림막을 걷은 뒤 활성 탭의 완료가 탭을 다시 눌러야만 풀렸다 —
   * 이미 보고 있는 탭은 다시 고를 일이 없다). 둘 다 표식이 없으면 아무 일도 없어 키마다 불려도 싸다.
   */
  function touchTile(paneId: string): void {
    touchAgentBanner(paneId);
    clearAgentUnseen([paneId]);
  }

  // 원격 창의 모바일 배치(R5)면 탭마다 포커스 타일 하나만 그린다(`hostBoxes` 의 `solo` — 거울 트리는 그대로). 그 타일은 캔버스를 가장자리까지
  // 채우고(틈 · 둥근 모서리 · 테두리 없음 — 아래 `.host.edge`) 머리줄을 달지 않는다(`headed` — 위 띠 알약이 이름을, 위 띠 ⋯ 가 머리줄 ⋯ 메뉴를 쥔다 · 10-20).
  const solo = $derived(mobileLayout());
  const boxes = $derived(hostBoxes(tabs, activeId, focusedPaneOf, leavingId, solo));

  // ---------------------------------------------------------------------------
  // 패널 헤더의 정체성 (docs/log/2026-09-02-pane-identity.md)
  //
  // 이름은 `paneName`(별칭/셸 라벨), 색 점과 툴팁은 사이드바가 읽어 둔 호스트 목록에서
  // **별칭으로** 찾는다 — 드래그 앤 드랍이 별칭만 실어 나르는 것과 같은 이유로, 메타는 한
  // 스냅숏에서만 읽어야 서로 어긋나지 않는다. 그리는 일 자체는 `pane/PaneHeader.svelte`.
  // ---------------------------------------------------------------------------

  /** 별칭 → 호스트. 패널마다 배열을 훑지 않도록 한 번만 편다 */
  const hostByName = $derived(new Map(hosts.map((h) => [h.name, h])));

  /**
   * 헤더 ⤢ 의 툴팁에 적을 **지금 걸린** 최대화 조합 — 사용자가 바꿨으면 바뀐 것이 뜬다
   * (`keybindings` 는 시작 타일에 넘기려고 이미 받고 있던 값이다).
   */
  const zoomCombo = $derived(displayCombo(effectiveCombo("zoom-tile", keybindings)));
  /** 머리줄 [터미널 | 대화] 의 툴팁에 적을 넘기기 조합(AI 타일만 — `pane/AiFlip`) */
  const flipCombo = $derived(displayCombo(effectiveCombo("flip-convo", keybindings)));

  const hostOf = (pane: PaneSpec) => hostOfPane(pane, hostByName);

  /**
   * 패널 id → 그 패널의 종류. 드래그 판정에서 **커서 아래 타일이 무엇인가** 를 물을 때
   * 쓴다 (드롭 스냅숏·`paneUnder` 는 DOM 에서 id 만 건져 온다). 매 dragover 마다 트리를 훑지 않도록
   * 한 번만 편다.
   */
  const kindById = $derived(new Map(boxes.map((b) => [b.pane.id, b.pane.kind])));

  /** 이 타일에 **헤더를 다는가** — 판정은 `pane/tile-presentation.ts` 의 `tileHeaded`, 설정값은 여기서 직접 읽는다 */
  const headed = (item: HostBox) => tileHeaded(item, solo, settings.tileHeader);

  /** SFTP 타일의 **원본 터미널이 아직 살아 있는가** — 판정은 `pane/tile-presentation.ts` 의 `sourceAlive` */
  const sftpSourceAlive = (pane: PaneSpec) => sourceAlive(pane, kindById);

  /** SFTP 타일이 빌려 쓰는 세션 id (원본이 없거나 끊겨 있으면 `null`) */
  const sftpSession = (pane: PaneSpec) =>
    pane.sourcePaneId ? (sessionOf?.(pane.sourcePaneId) ?? null) : null;

  /**
   * SFTP 타일에 내려 줄 **백엔드 어댑터** (docs/log/2026-09-03-local-fs-tile.md).
   *
   * 마크업에서 부르므로 세션 맵이 바뀔 때마다 다시 계산된다 — 예전에 `sessionId` 프롭이
   * 그랬던 것과 **같은 반응성**이라 재연결 추적이 그대로 살아 있다. `remoteBackend` 는
   * 세션 id 마다 객체를 캐시하므로 다시 계산돼도 같은 값이 나온다 (브라우저의 효과가
   * 헛돌지 않는다).
   */
  const sftpBackend = (pane: PaneSpec) => remoteBackend(sftpSession(pane));

  /**
   * 로컬 디스크 백엔드 — 상태가 없어 **모든 로컬 타일이 하나를 나눠 쓴다**
   * (`localBackend()` 는 언제나 같은 객체를 돌려준다).
   */
  const localFs = localBackend();

  /** 파일 타일의 **장소 패널에 세울 프로젝트** — 고르기는 `pane/tile-presentation.ts` 의 `fileProjectsFor`, 목록은 여기서 읽는다 */
  function fileProjectsOf(pane: PaneSpec): { id: string; name: string; path: string }[] {
    return fileProjectsFor(pane, projects());
  }

  /**
   * 문서 타일의 백엔드 — **별칭이 있으면 원격**이라 SFTP 타일과 같은 길(원본 터미널의 세션을 그때그때
   * 조회)이고, 없으면 로컬 디스크다 (docs/log/2026-09-27-doc-tile.md). 뷰어는 이 값 하나만 받는다.
   */
  const docBackend = (pane: PaneSpec) => (borrowsSession(pane) ? sftpBackend(pane) : localFs);

  /** 이 탭의 동시 입력이 켜져 있는가 (집합이 비어 있어도 켜진 것은 켜진 것이다) */
  const syncOn = (tabId: string) => syncPanes.has(tabId);
  /** 이 패널이 동시 입력에 **포함**되어 있는가 (꺼져 있으면 언제나 false) */
  const included = (tabId: string, paneId: string) => syncPanes.get(tabId)?.has(paneId) ?? false;

  /**
   * 동시 입력 — 입력을 **같은 탭의 포함된 패널들에만** 뿌린다.
   * `true` 를 돌려주면 입력한 패널은 자기 write 를 건너뛴다 (목록에 자기가 들어 있다).
   *
   * **제외된 패널에서 친 입력은 브로드캐스트하지 않는다** — 제외는 "이 동기화에 끼지 않는다"
   * 는 뜻이고 그것은 **양방향**이다 (docs/log/2026-09-01-drag-split-sync-select.md 2절).
   *
   * 대상 목록은 호출 시점의 **그 탭 트리**에서 뽑는다 — 전역 목록이 되었어도 브로드캐스트가
   * 탭 경계를 넘지 않는다는 뜻이다.
   */
  function broadcast(tab: TabSpec, fromPaneId: string, data: string): boolean {
    // 마우스 추적·포커스 이벤트 등 '터미널이 생성한 보고' 는 방송하지 않는다 (자기 세션에만).
    // 방송했다면 전체화면 TUI(claude·vim·htop) 위 마우스 움직임이 형제 셸에 좌표 쓰레기로
    // 쏟아진다. `false` 를 돌려주면 `sendInput` 의 폴백이 자기 패널에만 써 준다.
    if (isTerminalReport(data)) return false;
    const set = syncPanes.get(tab.id);
    if (!set) return false; // 이 탭은 동시 입력 OFF
    if (!set.has(fromPaneId)) return false; // 제외된 패널 → 자기한테만
    broadcastInput(
      listPanes(tab.root)
        .map((p) => p.id)
        .filter((id) => set.has(id)),
      data,
    );
    return true;
  }

  // ---------------------------------------------------------------------------
  // 타일 헤더의 ⋯ 메뉴 (docs/log/2026-09-05-titlebar-cleanup.md)
  //
  // 대상 · 항목 · 실행(열기 · 닫기 · 토글 · 배선표 `runMenuAction`)은 `pane/tile-menu-controller.svelte.ts` 의 `createTileMenu` —
  // 여기서는 하나 만들고(값 · 프롭은 게터로) 머리줄 · 우클릭 · 마크업이 부른다. 그림은 `pane/PaneMenu.svelte`.
  // ---------------------------------------------------------------------------
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
    get lam() {
      return lam;
    },
  });
  const { openTileMenu, closeTileMenu, toggleTileMenu, runMenuAction } = tmc;

  // tmux 세션 팝오버 (docs/log/2026-09-16-tmux-toggle.md) — 여닫기·자리·줄 실행(`runOnMenu` 통로)·이 타일에서
  // 전환은 `pane/tmux-menu.svelte.ts`. 여기서는 ⋯ 메뉴의 "tmux 세션…" 과 마크업이 부른다.
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

  // 원격 타일의 AI 권한 팝오버 (2026-10-07) — 여닫기·자리·단계 저장·"호스트 설정 › AI"(`runOnMenu` 통로)는
  // `pane/ai-perm-menu.svelte.ts`. 여기서는 ⋯ 메뉴의 "AI 권한…" 과 머리줄 칩·마크업이 부른다.
  const ai = new AiPermMenuController({
    get boxes() {
      return boxes;
    },
  });

  // 쿼리 타일의 AI 권한 팝오버 (10-14) — 원격과 같은 상자(`AiPermMenu`) · 같은 칩 메뉴. 대상은 DB 연결 하나이고 저장은
  // `setDbConnAi`(확인 대화 없이 바로)다 — `pane/db-ai-menu.svelte.ts`.
  const dbm = new DbAiMenuController({
    get boxes() {
      return boxes;
    },
  });

  // 로컬 타일의 AI 권한 팝오버 (10-23 — 예전 "AI 읽기 허용" 토글) — 원격과 같은 상자 · 같은 칩 메뉴. Off · Read 만 고르고 저장은
  // 예전 그대로 타일별 읽기 허용(원격 창에서 켤 때 마스터 재확인 포함)이다 — `pane/local-ai-menu.svelte.ts`.
  const lam = new LocalAiMenuController({
    get boxes() {
      return boxes;
    },
  });

  // 포워딩 목록 메뉴 (2026-10-11) — 여닫기·자리·줄 실행(`runOnMenu` 통로)은 `pane/forward-menu.svelte.ts`.
  // 여기서는 머리줄 포워딩 칩 · ⋯ 메뉴의 "포트 포워딩…" 과 마크업이 부른다.
  const fm = new ForwardMenuController({
    get boxes() {
      return boxes;
    },
  });

  // 머리줄 "+N" 칩 메뉴 (2026-10-23 — 넘쳐서 숨은 칩들) — 여닫기 · 자리 · 줄 실행(`runOnMenu` 통로)은 `pane/chip-more-menu.svelte.ts`.
  const cm = new ChipMoreMenuController({
    get boxes() {
      return boxes;
    },
  });

  /**
   * "+N" 메뉴의 줄 하나 — **그 칩을 누른 것과 같은 일**. tmux · 포워딩은 이 메뉴가 서 있던 자리에 제 메뉴를 연다(⋯ 메뉴의 "tmux 세션…" 과
   * 같은 몸짓). 자리는 닫히기 전에 스냅샷한다(통로가 먼저 닫는다).
   */
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

  /**
   * SSH 이름 카드 — 머리줄이 짓고 여기서 **타일 상자 밖**에 그린다 (⋯ 메뉴와 같은 이유 — 상자마다
   * `isolation: isolate`). 한 번에 하나다: 다른 타일이 `null` 을 올려도 떠 있는 남의 카드는 걷지 않는다.
   */
  let infoCard = $state<(SessionCardView & { paneId: string }) | null>(null);
  function setInfoCard(paneId: string, view: SessionCardView | null): void {
    if (view) infoCard = { ...view, paneId };
    else if (infoCard?.paneId === paneId) infoCard = null;
  }

  /** tmux 칩 호버 카드 — 이름 카드와 같은 자리·같은 규칙(한 번에 하나, 남의 `null` 은 무시) */
  let tmuxCard = $state<(TmuxCardView & { paneId: string }) | null>(null);
  function setTmuxCard(paneId: string, view: TmuxCardView | null): void {
    if (view) tmuxCard = { ...view, paneId };
    else if (tmuxCard?.paneId === paneId) tmuxCard = null;
  }

  /** 포워딩 칩 호버 카드 — tmux 카드와 같은 자리·같은 규칙(한 번에 하나, 남의 `null` 은 무시) */
  let forwardsCard = $state<(ForwardsCardView & { paneId: string }) | null>(null);
  function setForwardsCard(paneId: string, view: ForwardsCardView | null): void {
    if (view) forwardsCard = { ...view, paneId };
    else if (forwardsCard?.paneId === paneId) forwardsCard = null;
  }

  let host = $state<HTMLDivElement | null>(null);

  /**
   * 캔버스가 붙는 순간 **크기를 읽는 함수**를 상위에 건넨다 ([`onmeasure`] 설명).
   * 클로저가 `host` 를 매번 다시 읽으므로 창 크기가 바뀌어도 다시 등록할 필요가 없다.
   */
  $effect(() => {
    if (!host) return;
    onmeasure?.(() => ({ w: host?.clientWidth ?? 0, h: host?.clientHeight ?? 0 }));
  });

  /** 포커스 전환·`Ctrl+클릭` 동시 입력 토글 — 몸통은 `pane/focus.ts` */
  $effect(() =>
    delegateTileFocus(host, {
      syncOn,
      onfocus: (tabId, paneId) => onfocuspane?.(tabId, paneId),
      onsync: (tabId, paneId) => onsyncpane?.(tabId, paneId),
    }),
  );

  /**
   * 지금 포커스된 타일이 **세션 없는 타일**이면 그 패널 id, 아니면 `null`.
   *
   * 값이 id 하나라서, 아래 `$effect` 는 **포커스가 실제로 다른 타일로 옮겨갔을 때만** 다시
   * 돈다 (`boxes` 를 통째로 구독하면 무관한 상태 변화마다 포커스를 도로 낚아챈다).
   */
  const focusTileId = $derived(
    boxes.find((b) => b.visible && b.focused && !isTerminalPane(b.pane))?.pane.id ?? null,
  );

  /** 세션 없는 타일에 **진짜 키보드 포커스**를 준다 — 몸통은 `pane/focus.ts` */
  $effect(() => routeTileFocus(host, focusTileId));

  // ---------------------------------------------------------------------------
  // 배치 애니메이션 (docs/log/2026-09-04-tile-layout-anim.md)
  //
  // 위치·크기의 트랜지션 자체는 CSS 가 한다 — `.host.anim` 이 붙어 있을 때만 `.pane-box` 와
  // 분할선이 `left/top/width/height` 를 200ms 동안 미끄러진다. 그 클래스를 켜는 주체는
  // `+page` 의 트리 조작 함수들이고(`withLayoutAnim`), 여기서는 플래그를 **읽기만** 한다.
  //
  // 새로 생기는 타일만 다르다. "지금 막 마운트된 상자" 는 CSS 로는 골라낼 수 없다 —
  // `@keyframes` 를 `.host.anim .pane-box` 에 걸면 클래스가 붙는 순간 **이미 있던 타일까지**
  // 전부 다시 애니메이션을 시작해 화면이 깜빡인다. 그래서 등장만은 Svelte 의 `in:` 으로
  // 한다: 트랜지션 함수는 그 요소가 만들어질 때 **한 번** 평가되므로, 그 자리에서 플래그를
  // 보면 "구조 조작으로 생긴 타일" 과 "탭 복원으로 한꺼번에 마운트된 타일" 이 갈린다.
  // 닫힘은 `out:` 이 아니라 **유령**이다 — 아래 `onTileClosing` 과 마크업 주석 참고.
  // ---------------------------------------------------------------------------

  /** 사용자가 움직임을 줄여 달라고 했는가 — CSS 의 `prefers-reduced-motion` 과 같은 질문 */
  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * 새 타일의 등장 — 살짝 작고 투명한 상태에서 제자리로. 구조 조작 중이 아니면
   * (앱 시작·탭 복원·창 이관) 길이 0 이라 아무 일도 일어나지 않는다.
   *
   * 가운데 등장은 **차례로** 돈다(닫기의 거울 — 2026-10-17 사용자): 옆 타일 · 분할선이 곧바로 미끄러져 자리를 내고,
   * 새 타일은 [`TILE_ENTER_DELAY_MS`] 뒤에 커진다. 지연 동안은 Svelte 가 첫 프레임(`css(0)` — 투명)을 걸어 둔다.
   * 포커스 · 입력은 지연과 무관하다(투명해도 같은 DOM 이라 곧바로 친다). 지연이 없는 경우:
   *  - 그 탭의 유일한 타일(`alone` — 시작 타일 교체처럼 비켜 줄 이웃이 없다)
   *  - **연타** — 앞 등장이나 차례 닫기가 아직 돌면 곧바로 커진다(답답하지 않게)
   *
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

  /** 가운데 등장이 (지연 포함) 끝나는 시각 — 연타 판정용, 반응형일 필요 없다 */
  let enterUntil = 0;

  /** 앞 차례(등장 · 닫기 유령 · 닫기 지연)가 아직 도는가 — 그 사이의 조작은 지연 없이 곧바로 */
  const seqBusy = () =>
    performance.now() < enterUntil || layoutSlideDelay() > 0 || (ghostLayer?.childElementCount ?? 0) > 0;

  /** 닫히는 타일의 유령을 얹는 층 (`pane/tile-ghost.ts`) */
  let ghostLayer = $state<HTMLDivElement | null>(null);
  const clearGhosts = () => ghostLayer?.replaceChildren();

  // 사람이 타일 하나를 닫는다(`tabs.closePaneNow` 만 알린다 — 탭 닫기 · 떼어 내기 · 이관 · 갈아 끼우기는 아니다).
  // DOM 이 아직 그대로인 이 순간 상자를 유령으로 떠 두고, 진짜 상자(와 `<Terminal>`)는 평소처럼 곧바로 사라진다.
  // 지금 보이는 탭의 보이는 타일만 — 슬라이드 중 · 움직임 줄이기면 없다. 유령을 세웠으면 `true` → 닫는 쪽이
  // 옆 타일의 미끄러짐을 늦춘다(차례 닫기).
  //
  // **연타**: 앞 닫기의 차례가 아직 돌면(유령이 살아 있거나 지연 중) 새 유령은 세우지 않는다 — 그 타일은 곧바로
  // 빠지고, 닫는 쪽이 지연 없이 다시 미끄러뜨려 앞 닫기의 대기 중인 미끄러짐도 지금 출발한다(답답하지 않게).
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

  // 탭이 바뀌면(슬라이드 없이도) 남은 유령을 곧바로 걷는다 — 다른 탭 위에 떠 있으면 안 된다.
  $effect(() => {
    void activeId;
    untrack(clearGhosts);
  });

  // 탭 전환 슬라이드의 움직임 — 돌리는 몸통(Web Animations · 도중 전환은 지금 자리에서)은
  // `pane/tab-slide.svelte.ts` 의 `TabSlideMotion`. 요청을 읽어 부르는 `$effect` 만 여기 있다.
  const motion = new TabSlideMotion(() => host);

  // 슬라이드가 걸리면 돌리고, 풀리면(끝남 · 다른 길로 탭이 바뀜) 거둔다. DOM 이 새 상태로 그려진
  // **뒤**라 들어오는 탭의 상자가 이미 서 있고, 첫 페인트 전에 첫 키프레임이 얹힌다.
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

  // 끌어다 놓기 — 하이라이트 상태(`dropTarget`·`fileTarget`)와 dragstart/dragend/dragover/dragleave/drop 손잡이는
  // `pane/drop-controller.svelte.ts` (판정은 `pane/drop-rules.ts`). 리스너를 거는 `$effect` 는 아래에 그대로 있다.
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

  /** 판정이 준 dir·side 그대로 접는다. 최대화·움직임 줄이기는 기존 오버레이로 받는다. */
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

  /**
   * 폰의 위 띠 ⋯(`MobileBar` → `app/tile-menu-bridge`) — 지금 보이는 타일(`solo` 라 활성 탭에 하나)의 ⋯ 메뉴를 머리줄 ⋯ 와 같은 길로
   * 연다 · 닫는다. 메뉴가 열린 타일은 그 단추의 `aria-expanded` 로 알린다.
   */
  $effect(() =>
    registerTileMenuOpener((btn) => {
      const item = boxes.find((b) => b.visible) ?? null;
      if (item !== null) toggleTileMenu(btn, item);
    }),
  );
  $effect(() => noteTileMenuPane(tmc.tileMenu?.paneId ?? null));

  /** 캔버스가 사라져도 refit 정지 표시가 남지 않는다. */
  $effect(() => () => setDropPreviewing(false));

  /**
   * **헤더 우클릭 = ⋯ 메뉴** (docs/log/2026-09-05-titlebar-cleanup.md).
   *
   * 드래그·포커스와 **같은 자리에서 위임**으로 받는다. 헤더 `<div>` 에 `oncontextmenu` 를
   * 직접 달면 정적 요소 상호작용(a11y)으로 걸리고, 두 벌의 판정이 생긴다.
   *
   * 헤더 **밖**(터미널 본문·파일 목록)의 우클릭은 그대로 흘려보낸다 — 그 안의 화면들이
   * 각자 자기 메뉴를 쓰고 있고, 여기서 가로채면 그것들이 전부 사라진다.
   */
  const onContextMenu = (ev: MouseEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    // 머리줄로 올라온 도구줄(2026-10-20)의 칸이 제 메뉴를 이미 열었거나(그쪽이 `preventDefault`) 편집 칸이면(OS 편집 메뉴) 비켜 선다
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

  /**
   * 드래그 이벤트도 **컨테이너 한 곳에서 위임**으로 받는다 (위 포커스 위임과 같은 이유:
   * 마크업에 직접 달면 `<div>` 가 정적 요소 상호작용으로 걸린다). `dragstart` 도 버블한다.
   */
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

<!--
  `.anim` 은 **구조 조작이 도는 동안에만** 붙는다 (`withLayoutAnim`). 그때만 타일과 분할선이
  새 자리로 미끄러진다 — 분할선 드래그·창 리사이즈·탭 전환에는 붙지 않는다.
-->
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
      키는 pane.id — **앱 전체에서 유일**하다. 트리 모양이 바뀌든 소속 탭이 바뀌든
      이 상자는 그대로 살아 있고 style 만 달라진다.

      `in:` 만 있고 `out:` 은 없다. 닫히는 타일을 붙잡아 두면 그 시간 동안 형제가 빈자리를
      못 채우는데(잎은 트리에서 이미 사라졌다) 더 큰 문제는 **수명**이다 — 상자가 살아 있는
      동안 `<Terminal>` 도 살아 있고, 그 언마운트가 곧 세션 종료다. 그래서 상자는 곧바로
      사라지고, 닫힘의 모양(등장의 거울 — 줄며 사라짐)은 아래 `.tile-ghosts` 층의 **복제본**이
      그린다(`pane/tile-ghost.ts` — 사람이 타일 하나를 닫을 때만). 형제는 유령이 먼저 사라진 뒤이어 미끄러진다(차례 닫기).

      키·누름은 **캡처 단계**에서 한 번 본다 — 그 타일을 만졌다는 사실로 에이전트 배너를 푼다(보고 있는
      타일에서 선 항목은 방문으로 풀리지 않는다 · docs/log/2026-09-27-agent-banners.md "보고 있는 타일도").
      캡처라서 xterm 이 이벤트를 삼켜도 먼저 닿는다. 항목이 없으면 아무 일도 없다.
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
          aiMenuOpen={ai.aiMenu?.paneId === item.pane.id ||
            dbm.at?.paneId === item.pane.id ||
            lam.at?.paneId === item.pane.id}
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
          onaimenu={(ev) =>
            item.pane.kind === "query"
              ? dbm.toggle(ev, item)
              : item.pane.kind === "local"
                ? lam.toggle(ev, item)
                : ai.toggleAiMenu(ev, item)}
          onforwardmenu={(ev) => fm.toggleForwardMenu(ev, item)}
          onchipmore={(ev, items) => cm.toggle(ev, item, items)}
          onfiles={() => onopenfiles?.(item.tab.id, item.pane.id)}
          onzoom={() => onzoompane?.(item.tab.id, item.pane.id)}
          onclose={() => onclosepane?.(item.tab.id, item.pane.id)}
        />
      {/if}

      <!--
        터미널 자리. **헤더가 있든 없든 같은 DOM 노드**다 — 헤더가 생기고 사라지는 것은
        상자 안에 형제 하나가 들고 나는 일일 뿐이라 `<Terminal>` 은 재마운트되지 않는다.
        높이는 `.headed` 클래스가 `top` 을 `--tile-head-h`(32px) 로 밀어 주는 것으로 끝난다.

        세션 없는 타일(설정·SFTP·로컬 파일·시작)에는 이 상자가 **키보드 포커스의 몸**이
        된다: `tabindex="-1"` 이라 탭 순회에는 끼지 않지만 `.focus()` 로는 받을 수 있다
        (터미널의 숨은 textarea 가 하는 일을 여기서는 상자 자신이 한다). 터미널 타일에는
        붙이지 않는다 — 그쪽 포커스의 주인은 xterm 이다. 안쪽 화면이 키를 자기 뿌리에서
        듣는다면(파일 브라우저) 그쪽도 `[data-tile-focus]` 를 달고,
        `routeTileFocus` 가 **그 자손**에게 포커스를 넘긴다.

        `tabindex` 를 **펼침으로** 넘기는 이유: 값이 `-1`(탭 순회 밖)인데도 삼항식이면
        컴파일러가 정적으로 못 읽어 `a11y_no_noninteractive_tabindex` 로 오해한다.
      -->
      <div
        class="pane-body"
        {...isTerminalPane(item.pane)
          ? {}
          : { tabindex: -1, "data-tile-focus": item.pane.id }}
      >
        {#if isRemote && mirrorPlaceholder(item.pane.id)}
          <!--
            원격 창의 거울에서 함께 볼 수 없는 타일(쿼리 — 서버 상태를 타일 열쇠로 쥔다) — 자리 표시와 [원격에서 따로 열기]
            (원격 웹 R2-B · `$lib/mirror/tile-policy`).
          -->
          <MirrorPlaceholder pane={item.pane} />
        {:else if item.pane.kind === "start"}
          <!--
            시작 타일 — 빈 탭의 **launcher**(자유 배치 위젯 판 — 최근 호스트 · 프로젝트 · 셸, 2026-10-28
            docs/log/2026-10-28-start-widgets.md · 앞선 판은 2026-09-25-launcher.md · 2026-09-04-start-page.md ·
            2026-09-15-start-page-favorites.md). 세션도 상태도 없다: 접속은
            `StartPage` 가 호스트 컨텍스트에서 직접 꺼내 쓰고(호스트 독의 접속과 **같은 함수**),
            레이아웃을 여는 일만 프롭 하나로 위에 올린다. 키보드 몸은 `StartPage` 뿌리의
            `[data-tile-focus]` 다(고른 줄로 포커스를 넘긴다).
          -->
          {#if item.pane.startProject}
            <!--
              **프로젝트 시작 화면** — 같은 시작 타일에 주소(프로젝트 · 워크트리 폴더)가 붙은 것
              (docs/log/2026-09-26-project-start-screen.md). 새로 시작(셸 · AI · 시작 명령)과 그 폴더의 지난
              대화(재개 · 새 대화로 계속) — 무엇을 고르든 이 타일 자리에서 결과 타일로 바뀐다.
            -->
            <ProjectStart paneId={item.pane.id} start={item.pane.startProject} />
          {:else}
            <StartPage {hosts} />
          {/if}
        {:else if item.pane.kind === "sftp"}
          <!--
            SFTP 브라우저 — "렌더러만 다른 평범한 타일" 이지만, 하나가
            다르다: **세션을 빌린다**. `sessionId` 는 원본 터미널 패널의 것을 그때그때
            조회한 값이라(`sftpSession`), 원본이 재연결하면 새 id 가 저절로 내려가고
            브라우저는 보던 경로를 그대로 다시 읽는다. 원본 타일 자체가 없어졌으면
            `sourceGone` 으로 그 사실을 알린다 (기다려도 돌아오지 않는 상태).

            `initialPath` 는 **열릴 때 원본 셸이 있던 폴더**다 (OSC 7 — `openFilesFor`).
            로컬 타일과 같은 필드·같은 뜻이고, 없으면 홈에서 시작한다.
          -->
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
          <!--
            로컬 파일 브라우저 — **SFTP 타일과 같은 컴포넌트**다 (docs/log/2026-09-03-local-fs-tile.md).
            다른 것은 내려가는 백엔드 하나뿐이라, 목록·정렬·키보드·우클릭 메뉴가 저절로 같다.

            빌리는 세션이 없으므로 `sourceGone`·`sourcePaneId`·`refreshKey` 는 넘기지 않는다
            (전부 기본값이 "없음" 이고, 브라우저는 능력 플래그로 그 UI 를 아예 그리지 않는다).
            대신 `initialPath` 로 저장된 자리에서 시작하고, 폴더를 옮길 때마다 그 값을 상위에
            올려 배치 파일에 실리게 한다.

            `onupload` 는 **넘긴다** — 로컬 타일도 밖에서 온 파일(탐색기 드롭 · ⬆ 가져오기)을
            받기 때문이다. 목적지 종류를 가르는 것은 상위의 업로드 모달이다.
          -->
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
          <!--
            문서 보기 (docs/log/2026-09-27-doc-tile.md) — 파일 브라우저처럼 **백엔드 하나**만 받는다. 원격이면
            SFTP 타일과 같은 세션 빌림(`docBackend`)과 같은 배너 둘(대기 · 원본 없음)이고, 로컬이면 매인 데가 없다.
            보기(원문/그림)는 패널 명세에 적혀 배치와 함께 저장된다.
          -->
          <DocView
            paneId={item.pane.id}
            path={item.pane.path ?? ""}
            backend={docBackend(item.pane)}
            mode={item.pane.docMode ?? "rendered"}
            onmode={(m) => ondocmode?.(item.pane.id, m)}
            outline={item.pane.docOutline === true}
            onoutline={(open) => ondocoutline?.(item.pane.id, open)}
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
            onmenu={(x, y, doc) => {
              // 본문 우클릭 — 터미널 본문 우클릭과 같은 상자를 커서 자리에(줄은 문서 타일이 지어 온다 · 되돌릴 버튼은 없다)
              tmc.tileMenuTrigger = null;
              openTileMenu(item, x, y, null, doc);
            }}
          />
        {:else if item.pane.kind === "branches"}
          <!--
            브랜치 그래프 (docs/log/2026-09-29-branch-graph.md) — 읽기 전용 검토 타일. 세션을 빌리지 않고(원격이면 그 호스트에
            붙은 세션을 그때그때 찾는다) 여는 길 · 파일 열기 · 그 타일로는 `app/branch-graph` 를 직접 부른다(시작 화면처럼).
            주소가 없는 잎은 복원이 이미 뺐다 — 여기서 빈 주소면 아무것도 그리지 않는다(`{:else}` 로 떨어지면 터미널이 선다).
          -->
          {#if item.pane.branchGraph}
            <BranchGraph paneId={item.pane.id} spec={item.pane.branchGraph} />
          {/if}
        {:else if item.pane.kind === "diff"}
          <!--
            diff 타일 (docs/log/2026-10-05-diff-tile.md) — 브랜치 그래프와 같은 무리(읽기 전용 · 세션을 빌리지 않는다). 주소 없는
            잎은 복원이 이미 뺐다 — 여기서 빈 주소면 아무것도 그리지 않는다.
          -->
          {#if item.pane.diff}
            <DiffView paneId={item.pane.id} spec={item.pane.diff} />
          {/if}
        {:else if item.pane.kind === "producer"}
          <!--
            프로듀서 채팅 잎(2026-10-30 · 2단계 단계 3) — 오케스트레이션 탭의 왼쪽 고정 잎. 세션을 열지도 빌리지도 않는다(속은 세션 서버의 프로듀서
            채팅 프로세스 · 상태는 `app/producer-chat`). 아직 안 열었으면 "새 앨범" 칸, 열었으면 채팅.
          -->
          <ProducerLeaf pane={item.pane} visible={item.shown && !localOrchScreen} />
        {:else if item.pane.kind === "run"}
          <!--
            오케스트레이션 보드 (2026-10-15 · 2b) — 옛 작업안 타일과 같은 무리(세션을 열지도 빌리지도 않는다). 주소(Run id)가 없으면
            Run 목록을 그린다. 이벤트 구독 · 경과 시계는 보일 때만(`visible`).
          -->
          <RunBoard pane={item.pane} visible={localOrchScreen ? item.tab.id === activeId || item.tab.id === leavingId : item.shown} />
        {:else if item.pane.kind === "query"}
          <!--
            쿼리 타일 (2026-10-12 — docs/log/2026-10-12-query-tile.md). 세션 코어에 오르지 않는다 — 연결은 세션 서버의 DB
            평면(열쇠 = 이 타일의 `tileKey`)에 따로 산다. 연결 id 없는 잎은 복원이 이미 뺐다 — 빈 주소면 아무것도 그리지 않는다.
          -->
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
          <!--
            AI 타일의 [터미널 | 대화] 넘기기(`pane/AiFlip` — 2026-10-17). 감싸개는 **모든** 터미널 타일에 늘 선다 — AI 판정에 따라
            생겼다 사라지면 `<Terminal>` 이 재마운트된다(= 세션 종료). AI 가 아니면 상자 하나일 뿐이다.
          -->
          <AiFlip pane={item.pane} sessionId={sessionOf?.(item.pane.id) ?? null} shown={item.shown}>
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
              onopenpath={(target) => onopenpath?.(item.tab.id, item.pane.id, target)}
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

      <!--
        드랍 미리보기 — 어느 모양으로 그릴지는 판정이 이미 정해 두었다 (`DropPlan.preview`).
        둘은 서로 배타적이다: 4분면 하이라이트(`dropTarget`)와 상자 전체(`fileTarget`)가
        같은 타일에 함께 서는 일은 없다 — `onDragOver` 가 언제나 한쪽을 비운다.
      -->
      {#if dc.dropTarget?.paneId === item.pane.id && preview === null}
        <DropOverlay preview={dc.dropTarget.preview} zone={dc.dropTarget.zone} />
      {:else if dc.fileTarget?.paneId === item.pane.id}
        <DropOverlay preview="all" label={dropLabel(dc.fileTarget.label, item.pane.kind, tr)} />
      {/if}
    </div>
  {/each}

  <!-- 닫히는 타일의 유령 층 — 상자 위 · 분할선 아래. 안의 것은 그림뿐이다(선택자 없음 · inert). -->
  <div class="tile-ghosts" bind:this={ghostLayer} aria-hidden="true" inert></div>

  {#if preview !== null}
    <div class="drop-ghost" style={boxStyle(preview.ghost)} aria-hidden="true"></div>
  {/if}

  <!--
    분할선 레이어 — 탭마다 하나. 패널 상자 **위**에 얹히지만 `pointer-events: none` 이라
    분할선 자체(6px 간격 안)를 뺀 모든 곳에서 커서는 그대로 터미널에 닿는다.

    **최대화 중에는 분할선도 숨긴다** — 화면에 타일이 하나뿐인데 그 위에 손잡이가 떠
    있으면 무엇을 나누는 선인지 말할 수 없고, 잡아 끌면 보이지 않는 배치를 조용히
    망가뜨린다 (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
  -->
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

  <!--
    **오케스트레이션 탭의 재생 막대 띠**(2026-10-29 — 노트 D1). 타일이 아니라 탭 캔버스 아래 고정 높이 띠다 — 그 탭의 타일 사각형은
    띠를 뺀 캔버스(`tabCanvas`)에서 편다. `.host` 의 직계 자식에 같은 `data-tab` 을 달아 탭 전환 슬라이드가 타일과 함께 민다
    (`pane/tab-slide.svelte.ts` 가 `:scope > [data-tab]` 를 고른다). 숨은 탭의 띠는 `display:none`(읽기 · 시계도 멈춘다 — `shown`).
  -->
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

  <!--
    타일 상자 밖의 메뉴 · 호버 카드 층 — **타일 상자 밖**에 그린다 (상자마다 `isolation: isolate` 라 안에서는 `position: fixed` 여도
    이웃 타일·분할선 층에 덮인다). 그림 조립은 `pane/PanePopovers.svelte`, 열림 · 자리 · 줄 실행은 여기서 만든 컨트롤러.
  -->
  <PanePopovers
    {tmc}
    {tm}
    {fm}
    {ai}
    {dbm}
    {lam}
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

  /* 설정·파일 타일은 터미널이 아니다 — 불투명한 `--term-bg` 를 깔지 않는다.
   * 그 색은 **글자 가독성 때문에 터미널 캔버스에만** 불투명하게 두는 값이고, 여기 깔면
   * 설정 화면(창의 대부분을 덮는다) 아래에 불투명 판이 생겨 투명도 슬라이더를 아무리
   * 내려도 그 자리는 안 비친다 — 슬라이더를 만지는 화면이 정작 안 변하는 셈이다.
   * 안쪽의 `.settings-view`(설정)·`.fs-browser`(파일 트리)가 합성된 `--bg-panel` 로 칠하므로
   * 여기서는 비워 둔다 (또 칠하면 반투명이 두 겹이 된다 — html/main 과 같은 이유). */
  /* **프로젝트 시작 화면은 예외**다(`chrome` 을 달지 않는다 — docs/log/2026-09-26-project-start-screen.md 실기 ③):
   * 지난 대화 줄 · 시각 · 키 안내처럼 옅은 글자(`--fg-3`)가 많은 화면이라, 밝은 월페이퍼 위에서 비치면 읽히지
   * 않았다. 그래서 판을 깔되, 터미널 판(`--term-bg-fill`)이 아니라 **크롬의 우물**(`--surface-field` — 크롬
   * 투명도를 따른다)이다: 글자가 크롬 색이라 터미널 판이면 "라이트 크롬 + 어두운 터미널" 에서 검은 판에 검은
   * 글자가 됐다(2026-10-01 사용자 결정 — docs/log/2026-10-01-field-surface.md). 빈 탭의 launcher 는 그대로.
   * **글래스에서는 둘 다(크롬 타일 · 프로젝트 시작 화면) 아래 `.glass-tile` 규칙이 판을 바꾼다** — 흐림 위 독 등급 판(10-29). */
  .pane-box.start {
    background: var(--surface-field);
  }

  /* **빈 탭**(launcher 시작 타일 하나뿐인 탭)은 테두리를 그리지 않는다 — 나눌 이웃이 없어 상자 윤곽이 뜻 없이 화면을 가둔다(2026-10-07 사용자 요청).
   * 분할돼 이웃이 생기거나 프로젝트 시작 화면이면 여느 타일처럼 테두리가 돌아온다. */
  .pane-box.bare {
    border-color: transparent;
  }

  /*
   * **구조 조작이 도는 동안에만** 위치·크기가 미끄러진다
   * (docs/log/2026-09-04-tile-layout-anim.md).
   *
   * 상시로 걸면 안 되는 이유가 셋이다: 분할선 드래그가 고무줄이 되고(선은 손끝, 타일은
   * 200ms 뒤), 창 리사이즈 내내 타일이 뒤처지며, 그동안 xterm 이 매 프레임 refit 한다.
   * 그래서 `.anim` 이 붙은 200여 ms 또는 분할 드롭 미리보기 동안에만 산다.
   *
   * `all` 이 아니라 `boxStyle` 이 쓰는 **네 속성만** 적는다 — `all` 이면 배경·테두리까지
   * 휩쓸려 포커스 링이 200ms 늦게 켜진다. 뒤의 border-color·box-shadow 는 위 기본 규칙의
   * 값을 그대로 되풀이한 것이다 (`transition` 은 단축 속성이라 통째로 덮어쓴다).
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

  /*
   * 분할선도 **같은 트랜지션**을 받는다. 안 그러면 선만 새 자리로 순간이동하고 타일이
   * 뒤늦게 따라와, 200ms 동안 선이 타일 한가운데를 가로지른다.
   * `.divider` 는 자식 컴포넌트(SplitView)의 요소라 `:global` 로 짚는다 — 앞의 `.host.anim`
   * 은 여기 스코프이므로 이 캔버스 안의 분할선에만 닿는다.
   */
  .host.anim :global(.divider) {
    transition:
      left 200ms cubic-bezier(0.2, 0, 0, 1),
      top 200ms cubic-bezier(0.2, 0, 0, 1),
      width 200ms cubic-bezier(0.2, 0, 0, 1),
      height 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  /* 차례 닫기(`layout-anim.svelte.ts` 의 `CLOSE_SLIDE_DELAY_MS`) — 닫히는 타일의 유령이 먼저 사라지고 옆 타일 ·
     분할선은 `--close-delay` 뒤에 미끄러진다. 그 닫기 동안만 0 이 아니다(다른 조작 · `cancelLayoutAnim` 이 0 으로 걷는다).
     위치·크기 네 속성에만 — 포커스 테두리(border-color · box-shadow)는 늦추지 않는다. */
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

  /* 고스트는 타일 목록 밖 같은 좌표계의 유리 판이다 — 옅은 막 위에 대각선 반사광만 얹는다.
     나타날 때 한 번 스치는 띠는 판 안에서 잘라 둔다. 커서를 받으면 스냅숏 판정을 가로막는다. */
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
      color-mix(in srgb, var(--tertiary) 7%, transparent); /* 유리 판의 옅은 물 — 장식이라 제3색 */
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

  /* 움직임을 줄여 달라고 했으면 전부 끈다 — `.host.anim` 쪽도 함께 적어야 한다
     (선택자가 더 구체적이라 `.pane-box` 만 껐다가는 그 값이 그대로 이긴다).
     새 타일의 등장(`tileIn`)은 JS 쪽에서 같은 질의로 걸러지고, 헤더가 스며드는 것은
     `PaneHeader` 가 자기 스코프에서 끈다. */
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

  /* 비활성 탭의 패널 — 인스턴스는 그대로 살아 있고 그리기만 멈춘다 (스크롤백 보존) */
  .pane-box.hidden {
    display: none;
  }

  /* 탭 전환 슬라이드 (docs/log/2026-09-29-tab-slide.md) — 도는 동안만 캔버스 바깥 거터 가장자리에서
     오려 낸다(`overflow-clip-margin` = 거터까지 포함). 떠나는 탭은 `inert` 에 더해 커서도 먹지 않는다.
     **`clip-path` 로 오리지 않는다**(10-29 사용자) — `clip-path` 는 배경 뿌리(backdrop root)라 그동안 글래스 타일의 흐림 판이
     `.host` 뒤(월페이퍼)를 못 보고 투명하게 비었다가, 슬라이드가 끝나 풀리는 순간 흐림이 섰다. `overflow: clip` 은 배경 뿌리가 아니다. */
  .host.sliding {
    overflow: clip;
    overflow-clip-margin: var(--gap);
  }
  /* 둥근 상태바 패널(`+page` 의 `.body[data-slide-bleed]`) — 가로는 오리지 않아(실제 끝은 `.body` 의 `overflow: clip`)
     타일이 패널 바로 옆에서 잘리지 않고 패널 뒤로 지나간다(패널은 그동안 타일 위 층 — `+page`). 세로는 위와 같다(제목줄로 넘치지 않게).
     밀어내는 거리도 그 끝까지다(`tab-slide.svelte.ts` 의 `slideDistance`). `clip` 은 다른 축의 `visible` 을 `auto` 로 바꾸지 않는다. */
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

  /* 포커스된 타일 — **중성**이다: 테두리가 한 단 밝은 선(`--line-strong` · 글래스는 `--tile-rim-focus`)이 된다(머리줄은 몸과 한 장이라 판을 바꾸지 않고
     이름 글자만 한 단 밝다 — `PaneHeader` 의 `.active` · 2026-10-20). 테두리 색만 바꾼다(폭 1px 고정). 예전에는
     강조색 링(`--ring-active`)이었다 — 강조색은 "입력 대기 · 주 동작 · 선택 행" 셋에만 쓰고,
     타일 포커스는 늘 켜져 있는 상태라 조용해야 한다 (작업면 단계 결정 2). 동시 입력의 경고
     링(아래 .sync)·벨 번쩍임과는 색으로 갈린다. */
  .pane-box.focused {
    /*
     * 포커스된 타일만 한 층 올린다. 강조 때문이 아니라 **타일 안에서 화면 위로 떠야 하는
     * 것들** 때문이다: 호스트 트리의 우클릭 메뉴와 그 백드롭은 `position: fixed` 라 타일
     * 밖으로 나가는데, 상자마다 `isolation: isolate` 로 스택 문맥이 갇혀 있어 뒤에 그려지는
     * 이웃 타일에 덮인다 (메뉴가 안 보이고 바깥 클릭도 이웃 타일이 먹는다). 타일은 서로
     * 겹치지 않으므로 이 한 층은 다른 어떤 것도 가리지 않는다 (분할선은 아래 `.lines` 가
     * 한 층 더 위에 있다).
     */
    z-index: 1;
    border-color: var(--tile-rim-focus, var(--line-strong));
  }

  /*
   * **글래스 크롬 타일 = 독 등급 유리 판**(10-29) — 파일 · 브랜치 · diff · 문서 · 쿼리 · Run · 프로젝트 시작 화면(`.glass-tile`).
   * 예전에는 안쪽 화면이 `--bg-panel` 만 칠해 월페이퍼가 흐림 없이 비쳤다. 이제 독(`.glass-mid`)과 같은 판 · 흐림을 **타일 상자가 한 번**
   * 진다 — 판 색 `--glass-mid`(슬라이더를 탄다) + `::before` 의 `--glass-filter-mid`(24px). 안쪽 화면의 뿌리 · 머리줄은 `--tile-inner`
   * (투명)로 비워 두 겹을 막고, 줄이 밑으로 지나가는 끈끈한 머리(diff 나란히 · 쿼리 결과 목록)는 `--tile-sticky`(불투명)로 글자가
   * 비치지 않게, 브랜치 그래프의 빈 점(줄기를 가리는 면)은 `--tile-face` 로 판과 같은 색을 쓴다. 평면에는 이 토큰이 없어 각 화면의 예전 값 그대로다.
   *  - 흐림은 상자 자신의 `backdrop-filter` 가 아니라 `::before` 한 겹이다 — 상자에 걸면 타일 안 `position: fixed` 메뉴 · 고르는 목록의
   *    기준 상자가 타일이 된다(theme.css 흐림 규칙 머리말과 같은 함정). 공용 `.glass-mid` 는 붙이지
   *    않는다(테두리 색 · 그림자까지 바꾼다) — 가장자리는 타일의 선 그대로다.
   *  - 상자는 `isolation: isolate` 라 `z-index: -1` 의 흐림 판이 타일 판 위 · 내용 밑에 갇힌다. `isolation` 은 배경 뿌리가 아니다.
   *  - 빠지는 것: 터미널 · AI 타일(글자 가독 · 쉬지 않는 다시 그리기 — 다음 단계) · launcher 시작 타일(위젯 카드가 이미 유리라 판 · 흐림이
   *    두 겹이 된다). 숨은 탭의 상자는 `display: none` 이라 흐림 판도 서지 않는다 — 흐림 판은 보이는 크롬 타일마다 하나.
   *  - 상자 · 조상에 배경 뿌리(`opacity` · `clip-path` · `filter` …)를 걸면 그동안 흐림이 빠진다. 그래서 등장 · 닫기 유령은 `--tile-in`
   *    으로 겹마다 페이드하고(아래), 탭 슬라이드는 `overflow: clip` 으로 오린다(위 `.host.sliding`) — 둘 다 10-29.
   */
  :global(:root[data-material="glass"]) .pane-box.glass-tile {
    --tile-inner: transparent;
    --tile-face: var(--glass-mid);
    --tile-sticky: var(--surface-raised-solid);
    background-clip: padding-box; /* 판 색은 아래 페이드 절(`--tile-in` 을 곱한 `--glass-mid`) */
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
   * **등장 · 닫기 유령의 페이드 = `--tile-in`**(10-29 사용자 — 빈틈 메우기). 상자 자신의 `opacity` 는 배경 뿌리라 그동안 흐림 판이 뒤를
   * 못 보고 비었다가 끝에 섰다. 그래서 글래스 크롬 타일은 상자 대신 **겹마다** 같은 값을 곱한다 — 흐림 판(`::before` 자신의 `opacity` 는
   * 제 흐림을 끊지 않는다) · 판 색 · 테두리 색 · 자식(머리줄 · 본문). 값은 `tileIn` 의 `css` 와 `pane/tile-ghost.ts` 가 돌리고, 평소엔
   * 등록 초기값 1(theme.css 의 `@property --tile-in`)이라 아무것도 바꾸지 않는다. 테두리 규칙은 벨 · 알림 빛의 테두리를 비켜 준다.
   */
  :global(:root[data-material="glass"]) .pane-box.glass-tile {
    background-color: color-mix(in srgb, var(--glass-mid) calc(var(--tile-in) * 100%), transparent);
    opacity: 1;
  }
  /* 그 밖의 상자(터미널 · 평면 재질)와 분할선은 같은 값을 그대로 `opacity` 로 — 흐림 판이 없어 배경 뿌리가 되어도 잃을 것이 없다.
     캔버스 전체가 사용량 · 자원 화면과 엇갈려 페이드할 때(`+page` 의 `.pane > main` 이 `--tile-in` 을 돌린다) 쓴다. 등장 · 닫기
     유령의 `opacity` 애니메이션은 이 선언을 이긴다 */
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

  /*
   * 동시 입력에 **포함된** 패널 — 이 패널에 들어오는 입력이 형제 패널로도 간다는 경고.
   * 제외된 패널에는 테두리가 없다: 어디로 입력이 나가는지가 눈으로 바로 읽혀야 한다.
   *
   * `border` 를 2px 로 키우지 않고 **`outline` 안쪽(offset −2px)** 으로 그린다. 테두리 두께가
   * 변하면 상자 안쪽 크기가 줄어 xterm 이 refit → 원격 resize 까지 돈다.
   */
  .pane-box.sync {
    outline: 2px solid var(--warn);
    outline-offset: -2px;
  }

  /*
   * **벨이 울렸다** — 그 타일의 테두리가 강조색으로 잠깐 선다 (250ms · `app/bell.svelte.ts`).
   * 타일 포커스가 중성이 된 뒤에도 이것은 강조색으로 남는다 — 상시 칠이 아니라 **지나가는
   * 손끝 피드백**이다(끌어 놓기 삽입선과 같은 예외, theme.css 의미 토큰층 머리말).
   *
   * `.focused` 뒤에 적는다 — 명시도가 같으므로 **나중에 적힌 규칙이 이긴다**. 포커스된
   * 타일에서 벨이 울려도 번쩍임이 보여야 한다.
   *
   * 테두리 **두께는 그대로**다 (`.sync` 와 같은 이유 — 두께가 변하면 상자 안쪽이 줄어
   * xterm 이 refit 하고 원격 resize 까지 돈다). 눈에 띄는 일은 바깥으로 퍼지는 그림자가 한다.
   *
   * 위 기본 규칙의 `transition: border-color/box-shadow 140ms` 를 그대로 타므로 **켤 때는
   * 스며들고 끌 때도 스며든다** — 250ms 클래스에 140ms 전환이면 번쩍임 한 번으로 읽힌다.
   * 움직임을 줄여 달라고 한 경우 전환만 꺼지고 색은 그대로 선다 (`@media` 규칙이 위에 있다).
   */
  .pane-box.bell {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  /*
   * 에이전트 배너의 [보기] · 그 타일로 가서 풀린 알림 — 테두리가 **한 번** 빛나고 걷힌다
   * (`app/tile-glow.svelte.ts` · docs/log/2026-09-27-agent-banners.md). 결은 알림의 것이다 — 끝남은
   * `--ok`, 권한 물음은 `--accent`(입력 대기와 같은 부름). 벨 번쩍임처럼 **지나가는 표시**라
   * 강조색이 허락된다(theme.css 머리말의 예외). 움직임을 줄여 달라고 했으면 빛이 번지지 않고
   * 테두리 한 줄이 1초 가만히 섰다 걷힌다(클래스가 붙어 있는 시간을 저장소가 줄인다).
   */
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

  /*
   * 헤더와 본문 — **높이를 flex 로 나누지 않고 절대배치로 못 박는다.** 본문은 언제나 상자를
   * 채우고, 헤더가 있는 상자에서만 `top` 이 헤더 높이만큼 내려간다. 이러면 헤더가 생기고
   * 사라져도 본문 DOM 은 그대로이고(= 터미널 재마운트 없음), 터미널 높이 변화는 Terminal
   * 안의 ResizeObserver → refit 이 알아서 받아 낸다.
   */
  .pane-body {
    position: absolute;
    inset: 0;
  }

  /* 포커스 링은 그리지 않는다 — 어느 타일이 포커스인지는 상자의 활성 테두리가 이미 말한다
     (여기에 링이 하나 더 뜨면 타일 안에 네모가 이중으로 겹쳐 보인다) */
  .pane-body:focus {
    outline: none;
  }

  /*
   * **폰(모바일 배치)의 타일 하나 — 가장자리까지**(10-20 사용자 결정). 캔버스 틈 0 · 모서리 · 테두리 없음 · 터미널 안쪽 여백 4px —
   * 월페이퍼는 위 띠 · 키 띠 둘레에만 보인다(타일 면의 색 · 투명도는 그대로). 테두리를 0 으로 걷으므로(1px 이 남으면 그 칸으로 바탕이
   * 비친다 — 판은 `padding-box` 까지) 벨 · 알림 빛은 안쪽 고리로 그린다(바깥 그림자는 화면 밖이라 안 보인다).
   */
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

  /* 오케스트레이션 탭의 재생 막대 띠 — 캔버스 아래 끝(위는 타일과 거터 하나만큼 띄운다 — 높이 = 띠 − 거터) */
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
