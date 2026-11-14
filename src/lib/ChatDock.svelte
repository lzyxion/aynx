<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import SideChatFace from "$lib/SideChatFace.svelte";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";
  import PlansView from "$lib/PlansView.svelte";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import { joinListedSideChats, removeSideChat, sideChatsHeadDot } from "$lib/app/side-chat-surface.svelte.js";
  import {
    chatDockOpen,
    chatDockPinned,
    chatDockSection,
    chatDockWidth,
    closeChatDock,
    openChatDock,
    restoreChatDockWidth,
    setChatDockAvailable,
    setChatDockPinned,
    setChatDockSection,
    setChatDockWidth,
  } from "$lib/app/chat-dock.svelte.js";
  import {
    currentSideChat,
    lastSideChatPick,
    newSideChat,
    noteSideChatSent,
    renameSideChat,
    selectSideChat,
    sideChats,
  } from "$lib/app/side-chats.svelte.js";
  import {
    joinSideChat,
    linkSideChat,
    restartSideChat,
    setShownSideChat,
    sideChatDot,
    sideChatLiveOf,
  } from "$lib/app/side-chat-live.svelte.js";
  import { sideChatNewDefault, sideChatCliOk, sideChatCwdLabel, sortSideChats, type SideChat } from "$lib/side-chat";
  import { knownAiClis } from "$lib/app/panes.svelte.js";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { showNotice } from "$lib/app/notice";
  import { offeredAiClis, type AiCli } from "$lib/session";
  import { aiDisplayName, aiIconName } from "$lib/pane-icons";
  import { relativeTime } from "$lib/notifications";
  import { stripReason } from "$lib/error-reason";
  import { dockSides } from "$lib/dock";
  import { createEdgeHover } from "$lib/chrome/edge-dock";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { anyModalOpen } from "$lib/app/keys.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { handheld, mobileLayout } from "$lib/app/mobile.svelte.js";
  import { shortcutTitle } from "$lib/status-items";
  import { linkChipState, type LinkTile } from "$lib/side-chat-link";
  import { linkTilesHere } from "$lib/app/side-chat-ask.svelte.js";
  import { isShared, toggleShared } from "$lib/ai.svelte.js";
  import { focusTile } from "$lib/app/tabs.svelte.js";
  import { targetOf, type Dot } from "$lib/chat/chat-presentation";
  import ChatHistory from "$lib/chat/ChatHistory.svelte";

  // ---------------------------------------------------------------------------
  // **채팅 독** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md) — 런처 독의 **반대쪽** 창 끝에 떠 있는 카드 하나. 쪽은 설정
  // `[dock] layout`(`dockSides`), 열림 · 고정 · 갈래는 `app/chat-dock.svelte.ts`. 사람 창의 데스크톱 폭에서 마운트된다(`+page` — 집 PC 주 창 ·
  // 원격 웹 창의 데스크톱 폭 · 2026-11-01. 원격 폰 배치는 독 대신 폰 덮개 `mobile/MobileChat`).
  //
  // **원격 창**(데스크톱 폭)도 주 창과 같이 작업안 갈래의 몸통(`PlansView`)을 세운다(2026-11-13 — 예전엔 캔버스를 덮는 판 `PlansCover` 를
  // 열어 타일을 가렸다 · 사용자 버그 보고). 원격 폰 배치는 독이 없고 제 덮개(`mobile/MobilePlans`)다.
  //
  // **갈래 [채팅 | 작업안]**(2026-10-25 — docs/log/2026-10-25-plans-tile-refresh.md) — 독 맨 위 폭 전체의 알약 두 칸(아이콘뿐 — 채팅 =
  // 지금 채팅의 CLI 로고 · 작업안 = 체크리스트 + 승인 대기 수). 그 줄 오른쪽 끝에 독 단위의 📌 · ✕(2026-10-27 — 갈래를 바꿔도 그대로).
  // 작업안 갈래의 몸통은 옛 작업안 타일의 `PlansView` 이고 머리줄이 없다(제목 ▾ · + · ⋯ 머리줄은 채팅 갈래에서만).
  // 두 몸통은 **함께 마운트된 채** 갈래가 아닌 쪽만 숨는다 — 갈래를
  // 오가도 채팅의 지금 턴 · 작업안의 펼친 명령 · 위험 카드의 확인 상태가 남는다. 작업안의 폴링 · 구독은 보일 때만(`visible`).
  //
  // ## 채팅 = 세션 서버의 채팅 프로세스 (v2 4단계 — docs/log/2026-10-23-side-chat-v2-design.md)
  //
  // 채팅 목록 · 저장은 `app/side-chats`, 속(프로세스 · 사건 · 지금 턴 · 권한)은 `app/side-chat-live`, 대화 면은 `SideChatFace`
  // (기록 `TranscriptBody` + 꼬리 + 권한 카드 + 입력 칸). v1 의 `<AiFlip><Terminal/></AiFlip>` · 화면 읽기 · 신뢰 묻기 판정 · "터미널 보기" ·
  // [대화로] 는 걷었다 — 터미널이 없으니 고르지 않은 채팅을 마운트해 둘 까닭도 없다(지금 채팅의 면 하나만 세운다 · 상태는 모듈에 남는다).
  //
  // 붙기: 독 마운트에서 서버 표에 살아 있는 채팅에 붙고(`joinLiveSideChats` — 뒤에서 도는 턴 · 권한 대기의 점), 채팅을 고를 때마다 그 채팅에
  // 붙는다(`joinSideChat` — 구독 → attach → 없으면 open(띄우지 않음)). F5 · 웹뷰 크래시는 새 페이지가 같은 길로 다시 붙는다.
  //
  // 머리줄: 지금 채팅 제목 ▾(목록 — 맨 위 [새 채팅], 줄 = CLI 로고 · 제목 · 모델 · 시각 · 권한/답하는 중/새 답 점, 우클릭 이름 바꾸기 · 지우기) ·
  // `+` 새 채팅 · ⋯(이름 바꾸기 · 지우기). 고정 · × 는 윗줄(갈래 옆). CLI · 모델 · 강도 · 연결 · 그림 · 실린 MCP 는 입력 칸 한 줄 안(`[+]` · 모델
  // 키워드 · 연결 칩 — 2026-11-13 목업 D안, 몸은 대화 면의 `chat/side-chat-controls` · 옛 칸 아래 칩 줄 · 머리줄 MCP 칩은 걷었다). 사이드
  // 채팅의 상태는 **이 독의 점**이고 탭 점은 없다 — 끝남 · 실패 · 권한 물음은 설정 `[ai] notify_side_chat` 으로 AI 타일과 같은 배너 · OS 알림(`app/side-chat-notify` — 2026-11-13).
  //
  // ## 틀 (구현 순서 1)
  //
  // **숨김은 `transform` 만**이다 — `{#if}` 로 걷지도, `display:none` 으로 끄지도 않는다. 닫힌 동안에는 창 끝 밖으로 밀려 있고
  // (`.body` 가 넘침을 자른다) `inert` 라 포커스 · 누르기를 받지 않는다.
  //
  // 여닫기: 창 가장자리 호버(런처와 같은 순수 판정 — 쪽만 반대) · 단축키 `open-chat-dock` · 팔레트 · 머리줄 ×. 닫기는 Esc ·
  // 바깥 누르기 — **고정(pin)이면 둘 다 닫지 않는다**. 고정해도 타일 영역을 밀지 않고 위에 덮는다.
  //
  // 두 독은 같은 띠를 두고 다투지 않는다 — 런처의 띠는 런처 쪽 끝, 이 띠는 반대쪽 끝이다(`dockSides` 가 늘 반대로 준다).
  // 각자 제 리스너가 제 띠만 본다.
  //
  // ## 표시 조각 (2026-10-26)
  //
  // 목록 `chat/ChatHistory` · 순수 계산 `chat/chat-presentation` 은 props · 콜백만 받는다. 입력 칸 손잡이(`[+]` · 모델 메뉴 · 연결 칩)는 대화 면
  // (`SideChatFace`)이 쥐고, 이 파일은 연결 칩 상태(`chipLink`)와 그 안내 한 줄(`linkNote`)만 준다. 머리줄 · 목록 메뉴(`ToolbarMenu` — 독 DOM 안에
  // 그대로) · 가장자리 · 바깥 누르기 · Esc · 폭과 두 몸통(`hidden`)은 이 파일이 쥔다.
  // ---------------------------------------------------------------------------

  let dockEl = $state<HTMLElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);

  const open = $derived(chatDockOpen());
  const pinned = $derived(chatDockPinned());
  const side = $derived(dockSides(settings.dockLayout).chat);

  const chats = $derived(sideChats());
  const current = $derived(currentSideChat());

  onMount(() => {
    restoreChatDockWidth();
    setChatDockAvailable(true);
    window.addEventListener("pointerdown", onOutsidePointerDown, true);
    // 가장자리 호버 — 런처 독(`Dock.svelte`)과 같은 몸(`chrome/edge-dock.ts` — 창 좌표 · 수동 · 캡처 단계)이다.
    const offEdge = edgeHover.attach();
    // 켠 AI CLI — 런처 · 모바일 시트와 같은 캐시(`knownAiClis` — 창마다 한 번 감지)
    void knownAiClis().then((list) => (clis = list));
    return () => {
      setChatDockAvailable(false);
      setShownSideChat(null);
      window.removeEventListener("pointerdown", onOutsidePointerDown, true);
      offEdge();
    };
  });

  /**
   * 서버 표에 살아 있는 채팅(뒤에서 도는 턴 · 권한 대기)에도 붙어 목록의 점을 세운다(폰 덮개와 같은 몸). 목록은 부팅(`bootSideChats` —
   * 원격 창은 거울 뒤)이 독 마운트보다 늦게 채울 수 있어 채팅이 처음 보일 때 한 번.
   */
  let joinedLive = false;
  $effect(() => {
    if (joinedLive || chats.length === 0) return;
    joinedLive = true;
    void joinListedSideChats();
  });

  // ---------------------------------------------------------------------------
  // CLI 목록 · 새 채팅 · 붙기
  // ---------------------------------------------------------------------------

  /** 감지된 AI CLI(설치 여부 포함) — 오기 전엔 `null` */
  let clis = $state<AiCli[] | null>(null);
  /** 고를 수 있는 CLI — 설치 · 켬 · 세션 서버가 아는 것(`claude` · `codex`). 감지 전엔 `null` */
  const offered = $derived(clis ? offeredAiClis(clis, settings.disabledAgents).filter((c) => sideChatCliOk(c.id)) : null);

  let creating = false;

  /** 새 채팅 — 기본은 마지막에 쓴 CLI(꺼졌으면 켠 목록의 첫 항목) · 고른 그 CLI 의 마지막 모델 · 강도(`sideChatNewDefault`). 띄우지 않는다(첫 보내기 때) */
  async function createChat(): Promise<void> {
    if (creating || !offered) return;
    const pick = sideChatNewDefault(offered, lastSideChatPick());
    if (!pick) return;
    creating = true;
    try {
      await newSideChat(pick.cli.id, pick.model, pick.effort);
      listOpen = false;
      await focusHome();
    } catch (e) {
      showNotice(t("app.chatDock.new.failed", { e: stripReason(String(e)) }));
    } finally {
      creating = false;
    }
  }

  /**
   * 이 페이지에서 처음 **채팅 갈래를** 열었는데 채팅이 없으면 하나 만든다(켠 CLI 가 있을 때) — 한 번뿐이다(마지막 채팅을 지운 뒤에는
   * 빈 화면의 [새 채팅] 으로). 작업안 갈래로 열었을 때는 만들지 않는다(2026-10-25).
   */
  let autoTried = false;
  $effect(() => {
    if (autoTried || !open || !offered || section !== "chat") return;
    autoTried = true;
    if (untrack(() => chats.length) === 0 && offered.length > 0) untrack(() => void createChat());
  });

  /** 지금 채팅에 붙는다(구독 → attach → 없으면 open — 띄우지 않는다) */
  $effect(() => {
    const c = current;
    if (!c) return;
    const tg = untrack(() => targetOf(c));
    void joinSideChat(tg);
  });

  /** 지금 보이는 채팅 — 끝난 턴이 "새 답" 으로 남을지의 판정과 그 표식 거두기 */
  $effect(() => {
    // 작업안 갈래가 보이는 동안 채팅은 안 보인다(몸통은 마운트된 채 숨는다)
    setShownSideChat(open && section === "chat" && current ? current.id : null);
  });

  function dotOf(c: SideChat): Dot {
    return sideChatDot(c.id);
  }

  /** 머리줄 ▾ 의 점 — 모든 채팅 중 가장 급한 것(권한 > 새 답 > 답하는 중) */
  const headDot = $derived<Dot>(sideChatsHeadDot());

  function dotLabel(d: Dot): string {
    if (d === "running") return t("app.chatDock.running");
    if (d === "permission") return t("app.chatDock.permission");
    if (d === "finished") return t("app.chatDock.unseen");
    return "";
  }

  function titleOf(c: SideChat | null): string {
    return c?.title || t("app.chatDock.untitled");
  }

  function cliName(id: string): string {
    return offered?.find((c) => c.id === id)?.name ?? aiDisplayName(id) ?? id;
  }

  function modelLabel(model: string): string {
    return model || t("app.chatDock.cliDefault");
  }

  /** 목록 줄의 아랫줄 — 모델 · (고른 강도) · 시각 */
  function rowSub(c: SideChat): string {
    const parts = [modelLabel(c.model)];
    if (c.effort) parts.push(c.effort);
    parts.push(relativeTime(Math.max(c.usedAt, c.createdAt), now, t));
    return parts.join(" · ");
  }

  // ---------------------------------------------------------------------------
  // 머리줄 — 목록 · 포커스
  // ---------------------------------------------------------------------------

  let listOpen = $state(false);
  /** 목록의 시각 — 목록이 열린 동안 30초마다 */
  let now = $state(Date.now());
  $effect(() => {
    if (!listOpen) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (!open) untrack(() => closeLists());
  });

  const rows = $derived(sortSideChats(chats));

  function pickChat(id: string): void {
    selectSideChat(id);
    listOpen = false;
    void focusHome();
  }

  /**
   * 독의 키보드 집 — **갈래마다 가장 먼저 쓸 곳**(열 때 · 갈래를 바꿀 때 둘 다 여기 — 2026-11-15). 못 찾으면 상자 자신.
   * - 채팅 — 지금 채팅의 입력 칸.
   * - 작업안 — 첫 검토 대기 카드 **자신**(`PlanList` 의 `data-plan-pending` · [승인] 단추가 아니다 — Enter 한 번에 승인되지 않게).
   *   대기 카드가 없으면(빈 목록 · 실행 결과만 · 기록 보기) 목록의 스크롤 판(`PlansView` 의 `data-plans-body`).
   */
  async function focusHome(): Promise<void> {
    await tick();
    const el =
      section === "plans"
        ? (plansEl?.querySelector<HTMLElement>("[data-plan-pending]") ??
          plansEl?.querySelector<HTMLElement>("[data-plans-body]") ??
          null)
        : (bodyEl?.querySelector<HTMLElement>("textarea[data-flip-input]") ?? null);
    (el ?? dockEl)?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // 머리줄 ⋯ — 이름 바꾸기 · 지우기(지금 채팅)
  // ---------------------------------------------------------------------------

  let moreBtn = $state<HTMLElement | null>(null);
  let moreOpen = $state(false);

  const moreRows = $derived<ToolbarMenuRow[]>([
    { key: "rename", icon: "edit", label: t("app.chatDock.rename") },
    { key: "delete", icon: "erase", label: t("app.chatDock.delete"), sep: true, danger: true },
  ]);

  function pickMore(key: string): void {
    runOnMenu(
      () => current,
      () => (moreOpen = false),
      (chat) => {
        if (key === "rename") {
          // 이름 칸은 목록 줄에 선다 — 목록을 열고 그 줄을 칸으로
          listOpen = true;
          renaming = chat.id;
          renameText = chat.title;
        } else if (key === "delete") void removeChat(chat);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // 연결(5단계 — 결정 10 · 목업 ⑥A) — 이 채팅이 MCP 로 읽을 타일 하나. 고르기 · 끊기는 대화 면의 `[+]`(`chat/side-chat-controls`), 여기는 상태와 안내
  // ---------------------------------------------------------------------------

  /** 이 창의 연결할 수 있는 타일(포커스된 것이 위) */
  const linkTiles = $derived<LinkTile[]>(current ? linkTilesHere() : []);

  /** 칩 상태 — 이 창의 타일 → 서버가 아는 것 → 닫힘(순수 `linkChipState`) */
  const chipLink = $derived(
    current ? linkChipState(current.tile, linkTiles, sideChatLiveOf(current.id)?.link ?? null) : ({ kind: "none" } as const),
  );

  /** [읽기 허용 켜기] — 로컬 타일의 'AI 읽기 허용'(사람 손 — 머리줄 토글과 같은 문) */
  function allowRead(tile: LinkTile): void {
    if (tile.kind === "local" && !isShared(tile.paneId)) toggleShared(tile.paneId);
  }

  /** 연결한 원격 타일로 가기(호스트 AI 권한은 그 타일 머리줄의 칩에서 바꾼다) */
  function revealLinked(tile: LinkTile): void {
    focusTile(tile.tabId, tile.paneId);
  }

  /** [다시 시작] — CLI 가 끝난 채팅을 다시 연다(다음 보내기가 띄운다) */
  function restart(chat: SideChat): void {
    void restartSideChat(targetOf(chat)).then(() => focusHome());
  }

  // ---------------------------------------------------------------------------
  // 목록 줄의 우클릭 — 이름 바꾸기 · 지우기
  // ---------------------------------------------------------------------------

  let rowMenu = $state<{ id: string; el: HTMLElement } | null>(null);
  let renaming = $state<string | null>(null);
  let renameText = $state("");

  const rowMenuRows = $derived<ToolbarMenuRow[]>([
    { key: "rename", icon: "edit", label: t("app.chatDock.rename") },
    { key: "delete", icon: "erase", label: t("app.chatDock.delete"), sep: true, danger: true },
  ]);

  function pickRow(key: string): void {
    runOnMenu(
      () => (rowMenu ? chats.find((c) => c.id === rowMenu?.id) ?? null : null),
      () => (rowMenu = null),
      (chat) => {
        if (key === "rename") {
          renaming = chat.id;
          renameText = chat.title;
        } else if (key === "delete") void removeChat(chat);
      },
    );
  }

  function commitRename(): void {
    if (renaming) renameSideChat(renaming, renameText);
    renaming = null;
  }

  function onRenameKey(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitRename();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 독을 닫지 않는다 — 이름 바꾸기만 그만둔다
      renaming = null;
    }
  }

  /** 지우기 — 확인 · 대화 지우기 · 목록에서 빼기(폰 덮개와 같은 몸 — `removeSideChat`) */
  const removeChat = (chat: SideChat): Promise<void> => removeSideChat(chat);

  /** 목록 줄의 호버 단추 — 우클릭 메뉴의 두 항목과 같은 일(메뉴가 없으니 통로를 거치지 않는다) */
  function startRename(chat: SideChat): void {
    renaming = chat.id;
    renameText = chat.title;
  }

  /** 지금 대화 면(입력 칸의 `[+]` · 모델 메뉴를 쥔다) */
  let face = $state<ReturnType<typeof SideChatFace> | null>(null);

  function closeLists(): void {
    listOpen = false;
    rowMenu = null;
    moreOpen = false;
    renaming = null;
    face?.closeMenus();
  }

  // ---------------------------------------------------------------------------
  // 가장자리 호버로 열기 — 띠 · 시계 · 창 리스너는 `chrome/edge-dock.ts`(런처 독과 같은 몸 · 쪽만 `side`). 닫기는 여기 없다(Esc · 바깥 누르기 · ×).
  // ---------------------------------------------------------------------------

  const edgeHover = createEdgeHover({
    side: () => side,
    // 런처 독의 판정과 같은 조건(이 독이 닫혀 있고, 모달 · 가림막 · 모바일 배치가 없다 — 떠 있는 메뉴는 `edge-dock` 이 DOM 에서 본다)
    blocked: () => chatDockOpen() || anyModalOpen() || veilVisible() || mobileLayout(),
    open: () => openChatDock(),
  });

  /** 배치가 바뀌면 띠가 반대편 끝으로 간다 */
  $effect(() => {
    void side;
    edgeHover.forgetStrip();
  });

  $effect(() => {
    const bar = document.querySelector(".titlebar");
    if (!bar) return;
    const ro = new ResizeObserver(edgeHover.forgetStrip);
    ro.observe(bar);
    return () => ro.disconnect();
  });

  /** 열리거나 닫힐 때마다 — 띠를 한 번 벗어나야 다시 센다(커서 아래에서 닫힌 독이 도로 열리지 않게) */
  $effect(() => {
    void open;
    untrack(() => edgeHover.afterClose());
  });

  /** 열리는 순간 키보드를 독 안으로 — 지금 갈래의 첫 자리(`focusHome` · 없으면 상자 자신) */
  $effect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => void focusHome());
    return () => cancelAnimationFrame(raf);
  });

  // ---------------------------------------------------------------------------
  // 닫기 — 바깥 누르기 · Esc (고정이면 둘 다 아니다)
  // ---------------------------------------------------------------------------

  /** 독 바깥의 DOM 이지만 논리적으로 독의 일부일 수 있는 떠 있는 표면 — 런처 독의 `FLOATING` 과 같은 목록 */
  const FLOATING = ".overlay, .modal, .menu, .menu-backdrop, [role='dialog'], [role='menu']";

  function onOutsidePointerDown(ev: PointerEvent): void {
    if (!chatDockOpen() || chatDockPinned()) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (dockEl?.contains(target)) return;
    if (target.closest(FLOATING)) return;
    if (target.closest("[data-chrome-toggle]")) return;
    if (anyModalOpen()) return;
    closeChatDock(false); // 누른 곳이 곧 갈 곳이다
  }

  /**
   * Escape — 독 안에서 누른 것만 받는다. 고정이면 닫지 않고 흘려보낸다(창의 Escape 사슬이 받는다). 목록이 열려 있으면 그것부터 닫는다.
   * 대화 면(입력 칸 · 기록)의 Escape 도 여기 온다(2026-10-23 사용자 결정 — 고정이면 아무 일도 없다). "직접 입력…" 칸 · 찾기 띠 · 메뉴는
   * 제 Escape 를 먼저 쓰고 전파를 멈춘다.
   */
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    if (ev.isComposing || ev.keyCode === 229) return; // IME 조합을 끄는 Escape 는 칸의 것
    if (listOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      listOpen = false;
      void focusHome();
      return;
    }
    if (pinned) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeChatDock();
  }

  // ---------------------------------------------------------------------------
  // 폭 손잡이 — 타일 쪽(안쪽) 끝. 런처 독(`Dock.svelte`)과 같은 몸짓(포인터 캡처 · 매 프레임 자르기 · 뗄 때만 저장).
  // ---------------------------------------------------------------------------

  const width = $derived(chatDockWidth());
  let resizing = $state(false);

  function onResizeDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    resizing = true;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }

  function onResizeMove(ev: PointerEvent): void {
    if (!resizing || !dockEl) return;
    const rect = dockEl.getBoundingClientRect();
    setChatDockWidth(side === "right" ? rect.right - ev.clientX : ev.clientX - rect.left);
  }

  function onResizeUp(ev: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
    setChatDockWidth(width, true);
  }

  /** 머리줄 × 의 말풍선 — 이름 + 지금 걸린 조합 */
  const closeTitle = $derived.by(() => {
    const combo = effectiveCombo("open-chat-dock", settings.current.keybindings);
    return shortcutTitle(t("app.actions.close"), combo ? displayCombo(combo) : null);
  });

  const noCli = $derived(offered !== null && offered.length === 0);

  // ---------------------------------------------------------------------------
  // 갈래 [채팅 | 작업안] (2026-10-25)
  // ---------------------------------------------------------------------------

  /** 지금 갈래 */
  const section = $derived(chatDockSection());
  const plansWaiting = $derived(pendingCount());
  let plansEl = $state<HTMLElement | null>(null);
  let headEl = $state<HTMLElement | null>(null);

  /**
   * 갈래가 바뀌면 새 몸통 · 머리줄을 고른 쪽에서 밀어 넣는다(작업안 = 오른쪽 칸이라 오른쪽에서, 채팅 = 왼쪽에서).
   * 몸통은 둘 다 마운트된 채 `hidden` 만 바뀌므로 CSS 전환 대신 Web Animations 로 한 번 돌린다. 닫힌 독 · 첫 그림 ·
   * 움직임 줄이기에서는 돌지 않는다. 위 칸 강조의 미끄러짐은 CSS(`.sec-thumb`).
   */
  let shownSection: "chat" | "plans" | null = null;
  $effect(() => {
    const now = section;
    const prev = shownSection;
    shownSection = now;
    if (prev === null || prev === now || !untrack(() => open)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dx = now === "plans" ? 24 : -24;
    const opts: KeyframeAnimationOptions = { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
    const body = now === "plans" ? plansEl : bodyEl;
    body?.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: "none" }], opts);
    headEl?.animate([{ opacity: 0 }, { opacity: 1 }], opts);
  });

  /**
   * 열린 채 갈래가 바뀌면(단축키 `Ctrl+Shift+[` · `]` · 딥링크 · [AI에게 묻기]) 새 갈래의 첫 자리로 — 포커스가 **독 안**이었을 때만.
   * 숨는 몸통 안에 있던 포커스는 `<body>` 로 떨어지므로 `<body>` 도 "독 안" 으로 본다. 고정한 독 옆 타일에서 바꿨으면 그 타일의
   * 포커스를 빼앗지 않는다. 닫힌 독을 여는 길은 위 "열리는 순간" 효과가 맡는다(여기는 그때 포커스가 아직 타일이라 건너뛴다).
   */
  let focusedSection: "chat" | "plans" | null = null;
  $effect(() => {
    const now = section;
    const prev = focusedSection;
    focusedSection = now;
    if (prev === null || prev === now || !untrack(() => open)) return;
    const active = document.activeElement;
    if (active && active !== document.body && !dockEl?.contains(active)) return;
    void focusHome();
  });

  /** 갈래를 고른다 — 고른 갈래의 첫 자리로 포커스(`focusHome` — 같은 갈래를 다시 눌러도) */
  function pickSection(next: "chat" | "plans"): void {
    if (next === "chat") listOpen = false;
    setChatDockSection(next);
    void focusHome();
  }
</script>

{#snippet logo(cli: string, size: number)}
  {@const name = aiIconName(cli)}
  {#if name}<AiGlyph {name} {size} mono />{:else}<UiIcon name="ai" {size} />{/if}
{/snippet}

{#snippet dot(d: Dot)}
  {#if d}<span class="dot" data-dot={d} title={dotLabel(d)} aria-label={dotLabel(d)}></span>{/if}
{/snippet}

<!--
  `role="presentation"` · `tabindex="-1"` — 런처 독과 같은 규칙(껍데기 상자 · 본문이 포커스를 못 받을 때의 몸). 닫힌 동안은
  `inert` 라 탭 순회 · 누르기 · 스크린 리더에서 빠진다(그림은 창 끝 밖으로 밀려 있다).
-->
<div
  class="chat-dock edge-dock glass-mid"
  class:open
  class:pinned
  class:resizing
  style:--chat-dock-px="{width}px"
  data-chat-dock
  data-dock-side={side}
  role="presentation"
  aria-label={t("app.chatDock.aria")}
  inert={!open}
  tabindex="-1"
  bind:this={dockEl}
  onkeydown={onKeydown}
>
  <!--
    갈래 — 독 폭 절반(가운데)의 큰 알약 안 알약 두 칸(아이콘뿐 · 이름은 title · aria-label · 채팅 = `ai` 고정, CLI 로고는 머리줄 제목에). 작업안 칸의 대기 수 배지는 채팅을 보는 중에도 선다.
  -->
  <!--
    윗줄 = 독 단위 — [빈 칸 | 갈래 | 📌 ✕](2026-10-27). 고정 · 닫기는 갈래와 무관하게 독 전체를 다루므로 갈래 머리줄이 아니라
    여기 선다(갈래를 바꿔도 깜빡이지 않는다). 양옆 칸이 같은 폭이라 갈래는 늘 독 가운데 · 독 폭 절반이다.
  -->
  <div class="top" data-chat-dock-top>
    <span aria-hidden="true"></span>
    <div class="sections" role="group" aria-label={t("app.chatDock.section.aria")} data-chat-dock-sections>
      <!-- 고른 칸의 알약 — 칸 단추 뒤에 하나만 깔고 고른 쪽으로 미끄러진다 -->
      <span class="sec-thumb" data-section={section} aria-hidden="true"></span>
      <button
        type="button"
        class="sec"
        class:on={section === "chat"}
        aria-pressed={section === "chat"}
        data-dock-section="chat"
        title={t("app.chatDock.section.chat")}
        aria-label={t("app.chatDock.section.chat")}
        onclick={() => pickSection("chat")}
        ><UiIcon name="ai" size={18} /></button
      >
      <button
        type="button"
        class="sec"
        class:on={section === "plans"}
        aria-pressed={section === "plans"}
        data-dock-section="plans"
        title={t("app.chatDock.section.plans")}
        aria-label={plansWaiting > 0
          ? t("app.chatDock.section.plansPending", { n: plansWaiting })
          : t("app.chatDock.section.plans")}
        onclick={() => pickSection("plans")}
        ><UiIcon name="list-checks" size={18} />{#if plansWaiting > 0}<span class="sec-badge" aria-hidden="true"
            >{plansWaiting}</span
          >{/if}</button
      >
    </div>
    <div class="top-btns">
      <button
        type="button"
        class="head-btn"
        class:on={pinned}
        data-chat-dock-pin
        aria-pressed={pinned}
        title={pinned ? t("app.chatDock.unpin") : t("app.chatDock.pin")}
        aria-label={pinned ? t("app.chatDock.unpin") : t("app.chatDock.pin")}
        onclick={() => setChatDockPinned(!pinned)}
        ><UiIcon name={pinned ? "pin-off" : "pin"} size={18} /></button
      >
      <button
        type="button"
        class="head-btn"
        data-chat-dock-close
        title={closeTitle}
        aria-label={t("app.actions.close")}
        onclick={() => closeChatDock()}
        ><UiIcon name="close" size={18} /></button
      >
    </div>
  </div>

  <!-- 갈래 머리줄 — 채팅 갈래에만(작업안 갈래는 위 칸이 이미 이름이라 머리줄 없이 몸통이 곧바로 선다 · 2026-10-27) -->
  {#if section === "chat"}
  <div class="head" bind:this={headEl}>
    <button
      type="button"
      class="title-btn"
      data-chat-dock-list
      aria-haspopup="listbox"
      aria-expanded={listOpen}
      title={t("app.chatDock.list")}
      disabled={chats.length === 0 && noCli}
      onclick={() => (listOpen = !listOpen)}
    >
      {#if current}<span class="title-logo">{@render logo(current.cli, 16)}</span>{/if}
      <span class="title">{current ? titleOf(current) : t("app.chatDock.title")}</span>
      {@render dot(headDot)}
      <UiIcon name="chevron-down" size={14} />
    </button>
    <button
      type="button"
      class="head-btn"
      data-chat-dock-new
      title={t("app.chatDock.new")}
      aria-label={t("app.chatDock.new")}
      disabled={!offered || offered.length === 0}
      onclick={() => void createChat()}><UiIcon name="plus" size={18} /></button
    >
    <button
      type="button"
      class="head-btn"
      data-chat-dock-more
      aria-haspopup="menu"
      aria-expanded={moreOpen}
      title={t("app.chatDock.more")}
      aria-label={t("app.chatDock.more")}
      disabled={!current}
      bind:this={moreBtn}
      onclick={() => (moreOpen = !moreOpen)}><UiIcon name="more" size={18} /></button
    >
  </div>
  {/if}

  {#if listOpen && section === "chat"}
    <!-- 채팅 목록(목업 ⑤) — 맨 위 [새 채팅], 줄 = 로고 · 제목 · 모델 · 시각 · 점. 우클릭 = 이름 바꾸기 · 지우기 -->
    <ChatHistory
      {rows}
      {current}
      {offered}
      {renaming}
      bind:renameText
      bind:rowMenu
      {titleOf}
      {rowSub}
      {dotOf}
      {pickChat}
      {createChat}
      {onRenameKey}
      {commitRename}
      onrename={startRename}
      ondelete={(c) => void removeChat(c)}
      always={handheld()}
      {logo}
      {dot}
    />
  {/if}

  <!-- 본문 — 지금 채팅의 대화 면 하나(상태는 `app/side-chat-live` 에 남는다 — 채팅을 바꿔도 지금 턴을 잃지 않는다) -->
  <div class="chat-body" data-chat-dock-body hidden={section !== "chat"} bind:this={bodyEl}>
    {#if current}
      {@const c = current}
      {#key c.id}
        <SideChatFace
          bind:this={face}
          chatId={c.id}
          chat={c}
          cli={c.cli}
          cliName={cliName(c.cli)}
          {offered}
          {chipLink}
          onsent={(text) => noteSideChatSent(c.id, text)}
          onrestart={() => restart(c)}
          cwd={c.cwd}
          phone={handheld()}
        >
          {#snippet linkNote()}
            {#if c.forkedFrom && c.forkedFrom.agent === c.cli && c.cwd}
              <!-- 갈라 온 채팅(6단계) — CLI 가 그 대화의 기록된 폴더에서 돈다(도구가 그 폴더를 읽는다) -->
              <div class="link-note" role="note" data-chat-fork-note title={c.cwd}>
                <span class="link-note-text">{t("app.chatDock.fork.note", { folder: sideChatCwdLabel(c.cwd) })}</span>
              </div>
            {/if}
            {#if chipLink.kind === "linked" && (chipLink.closed || chipLink.readable === false)}
              <div class="link-note" role="status" data-chat-link-note={chipLink.closed ? "closed" : "read-off"}>
                {#if chipLink.closed}
                  <span class="link-note-text">{t("app.chatDock.link.closedNote", { name: chipLink.name })}</span>
                  <button type="button" class="btn btn-secondary btn-sm" onclick={() => void linkSideChat(c.id, null)}
                    >{t("app.chatDock.link.unlink")}</button
                  >
                {:else if chipLink.tile?.kind === "local"}
                  {@const tile = chipLink.tile}
                  <span class="link-note-text">{t("app.chatDock.link.readOffNote")}</span>
                  <button type="button" class="btn btn-secondary btn-sm" data-chat-link-allow onclick={() => allowRead(tile)}
                    >{t("app.chatDock.link.allowRead")}</button
                  >
                {:else}
                  <span class="link-note-text">{t("app.chatDock.link.readOffRemote")}</span>
                  {#if chipLink.tile}
                    {@const tile = chipLink.tile}
                    <button type="button" class="btn btn-secondary btn-sm" onclick={() => revealLinked(tile)}>{t("app.chatDock.link.reveal")}</button>
                  {/if}
                {/if}
              </div>
            {/if}
          {/snippet}
        </SideChatFace>
      {/key}
    {:else}
      <div class="empty" data-chat-empty>
        {#if noCli}
          <p>{t("app.chatDock.noCli")}</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick={() => openSettingsAt("ai")}>{t("app.chatDock.noCli.action")}</button>
        {:else}
          <p>{t("app.chatDock.empty")}</p>
          <button type="button" class="btn btn-primary btn-sm" disabled={!offered} onclick={() => void createChat()}>{t("app.chatDock.new")}</button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- 작업안 갈래 — 옛 작업안 타일의 몸통 그대로(보기 · 감사 알약 · 진행 · 기록). 보일 때만 폴링 · 구독 -->
  <div class="plans-body" data-chat-dock-plans hidden={section !== "plans"} bind:this={plansEl}>
    <PlansView visible={open && section === "plans"} exitSide={side} />
  </div>

  {#if moreOpen && moreBtn}
    <ToolbarMenu label={t("app.chatDock.more")} rows={moreRows} trigger={moreBtn} align="right" onpick={pickMore} onclose={() => (moreOpen = false)} />
  {/if}
  {#if rowMenu}
    <ToolbarMenu label={t("app.chatDock.list")} rows={rowMenuRows} trigger={rowMenu.el} align="left" onpick={pickRow} onclose={() => (rowMenu = null)} />
  {/if}

  <!-- 폭 손잡이 — 안쪽(타일 쪽) 끝. `[dock] layout` 이 쪽을 바꾸면 함께 옮긴다. 키보드로는 잡지 않는다(런처 독과 같다) -->
  <div
    class="grip"
    role="separator"
    aria-orientation="vertical"
    aria-label={t("app.dock.resize.aria")}
    data-chat-dock-grip
    onpointerdown={onResizeDown}
    onpointermove={onResizeMove}
    onpointerup={onResizeUp}
    onpointercancel={onResizeUp}
  ></div>
</div>

<style>
  /*
   * 런처 독(`Dock.svelte`)과 같은 층 · 같은 판이다 — `.body`(타이틀바 아래 상자) 안의 `position: absolute`, 여백 `--gap`,
   * 상태바 기둥 · 감싸기 테두리만큼 안쪽(`--dock-inset-*` — `+page` 가 쪽마다 채운다). z-index 도 같은 100 이고 DOM 에서
   * 런처 독(과 설정 모달)보다 **앞**에 놓여, 설정 모달 · 그 배경막이 이 독을 덮는다.
   *
   * 폭은 손잡이로 끈 값(`--chat-dock-px` — 기본 380 · `$lib/dock` 의 `clampChatDockWidth`)이고, 창이 그보다 좁으면 창 폭에서
   * 양쪽 여백을 뺀 만큼이다.
   */
  .chat-dock {
    --chat-dock-w: min(var(--chat-dock-px, 380px), calc(100% - 2 * var(--gap)));
    position: absolute;
    top: var(--gap);
    bottom: calc(var(--gap) + var(--dock-inset-bottom, 0px));
    left: calc(var(--gap) + var(--dock-inset-left, 0px));
    z-index: 100;
    box-sizing: border-box;
    width: var(--chat-dock-w);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--glass-mid, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    overflow: hidden;
    /*
     * 닫힘 = 창 끝 밖으로 민다(거리 `--edge-dock-off` · 시간 · 곡선은 런처 독과 공용 — `theme.css` 의 "창 끝 독의 여닫이").
     * `display` 는 늘 flex 다 — 숨김은 이 이동뿐이다(파일 머리말). 열리면 `transform: none` — 남기면 안쪽 `position: fixed` 메뉴의
     * 기준 상자가 독으로 바뀐다(런처 독과 같은 이유).
     */
    transform: translateX(var(--edge-dock-off));
    transition: transform var(--edge-dock-dur) var(--edge-dock-ease);
  }

  .chat-dock[data-dock-side="right"] {
    left: auto;
    right: calc(var(--gap) + var(--dock-inset-right, 0px));
  }

  .chat-dock.open {
    transform: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-dock {
      transition: none;
    }
  }

  .chat-dock:focus {
    outline: none;
  }

  /*
   * 갈래 — 독 폭 절반(가운데)의 낮은 면(surfaceContainerLow) 큰 알약, 안에 반폭 알약 두 칸(32px · 아이콘 18 가운데). 고른 칸 =
   * `--control-sel-*`(secondaryContainer — 작업안의 보기 탭 · 고른 칩과 같은 역할)로 채운 알약 하나(`.sec-thumb`)가 고른
   * 칸으로 미끄러진다. 대기 수 배지 = 강조색 채움.
   */
  /* 윗줄 — 1 : 2 : 1 이라 가운데 갈래가 독 폭 절반 · 늘 가운데다. 📌 ✕ 는 오른쪽 칸 끝(아래 머리줄 ⋯ 와 같은 오른쪽 여백) */
  .top {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
    align-items: center;
    margin: 6px 0 2px;
  }

  .top-btns {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    padding-right: var(--space-2);
  }

  .sections {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    box-sizing: border-box;
    padding: 3px;
    background: var(--m3-surface-container-low);
    border-radius: 999px;
  }

  /* 고른 칸의 알약 — 칸 단추 뒤 한 장(그리드 칸을 차지하지 않게 absolute). 오른쪽 칸 = 칸 폭 + 사이 2px 만큼 민다 */
  .sec-thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px - 2px) / 2);
    background: var(--control-sel-bg);
    border-radius: 999px;
    transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .sec-thumb[data-section="plans"] {
    transform: translateX(calc(100% + 2px));
  }

  @media (prefers-reduced-motion: reduce) {
    .sec-thumb {
      transition: none;
    }
  }

  .sec {
    position: relative; /* 알약(`.sec-thumb`) 위에 */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .sec:not(.on):hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  /* 고른 칸의 면은 `.sec-thumb` 가 깐다 — 단추는 글자색만 */
  .sec.on {
    color: var(--control-sel-fg);
  }

  .sec:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .sec-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    box-sizing: border-box;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--on-accent);
    background: var(--accent);
    border-radius: 999px;
  }

  /* 작업안 갈래의 몸통 — 남은 높이를 채우고 `PlansView` 가 제 안에서 스크롤한다 */
  .plans-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .plans-body[hidden],
  .chat-body[hidden] {
    display: none;
  }

  .head {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: var(--space-2) var(--space-2) var(--space-1) var(--space-2);
  }

  /* 지금 채팅 제목 ▾ — 목록을 연다 */
  .title-btn {
    flex: 1;
    min-width: 0;
    height: 36px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
  }

  .title-btn:hover:not(:disabled) {
    background: var(--control-ghost-hover);
  }

  .title-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .title-logo {
    flex: 0 0 auto;
    display: inline-flex;
  }

  .title {
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-btn {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .head-btn:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .head-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .head-btn.on {
    color: var(--accent);
  }

  .head-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 상태 점 — 답하는 중(강조색) · 권한(경고) · 새 답(완료) */
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  .dot[data-dot="permission"] {
    background: var(--warn);
  }

  .dot[data-dot="finished"] {
    background: var(--ok);
  }

  .chat-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-inner, transparent);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-5);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-2);
    text-align: center;
  }

  .empty p {
    margin: 0;
  }

  /* 입력 칸 위 한 줄 — 연결한 타일을 AI 가 못 읽는다 · 닫혔다 */
  .link-note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 var(--space-3) var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: color-mix(in srgb, var(--warn) 10%, var(--surface-field));
    border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--line-strong));
    border-radius: 8px;
  }

  .link-note-text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* 폭 손잡이 — 안쪽 끝의 6px 띠(런처 독 `.grip` 과 같은 모양). 왼쪽 독이면 오른쪽 끝, 오른쪽 독이면 왼쪽 끝 */
  .grip {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    width: 6px;
    cursor: ew-resize;
    touch-action: none; /* 포인터 캡처가 스크롤 제스처에 뺏기지 않게 */
  }

  .grip:hover,
  .chat-dock.resizing .grip {
    background: var(--line-strong);
  }

  .chat-dock[data-dock-side="right"] .grip {
    left: 0;
    right: auto;
  }

  /* 끄는 동안 대화 면이 포인터를 받아 글자를 고르지 않게 */
  .chat-dock.resizing {
    user-select: none;
  }
</style>
