<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { trapTab } from "$lib/focus-trap";
  import ProjectList from "$lib/browser/ProjectList.svelte";
  import DbList from "$lib/browser/DbList.svelte";
  import Sidebar from "$lib/Sidebar.svelte";
  import SettingsModal from "$lib/SettingsModal.svelte";
  import DockAlerts from "$lib/DockAlerts.svelte";
  import DockLaunch from "$lib/DockLaunch.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import {
    closeDock,
    dockKind,
    dockWidthOf,
    openDock,
    restoreDockWidths,
    revealLauncherDock,
    setDockWidth,
  } from "$lib/app/dock.svelte.js";
  import {
    adjacentSegment,
    DOCK_TOOLS,
    dockSides,
    isLauncherKind,
    LAUNCHER_SEGMENTS,
    launcherSegment,
    type DockKind,
    type DockTool,
    type LauncherKind,
  } from "$lib/dock";
  import { comboFromEvent, displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { anyModalOpen, runAction } from "$lib/app/keys.svelte.js";
  import { createEdgeHover } from "$lib/chrome/edge-dock";
  import { runAfterClose } from "$lib/browser/menu-runner";
  import { shortcutTitle } from "$lib/status-items";
  import { isRemote } from "$lib/app/window.svelte.js";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import {
    agentBannerBadge,
    agentBannerItems,
    clearResolvedBanners,
    resolveFinishedBanners,
    resolvedAgentBanners,
  } from "$lib/app/agent-banners.svelte.js";
  import {
    clearNotificationHistory,
    markNotificationsRead,
    notificationList,
  } from "$lib/app/notifications.svelte.js";
  import { toggleSessionSheet } from "$lib/app/session-sheet.svelte.js";
  import { openPlans, setPlansView } from "$lib/app/plans.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { vaultStatus } from "$lib/app/vault.svelte.js";
  import { mobileLayout } from "$lib/app/mobile.svelte.js";
  import { openMobileSettings } from "$lib/app/mobile-sheets.svelte.js";
  import { activeTab, paneOf } from "$lib/app/tabs.svelte.js";
  import { detachedCount, openDetachedList } from "$lib/app/detached.svelte.js";

  // ---------------------------------------------------------------------------
  // **독** — 타일 위에 떠 있는 층 하나 (docs/log/2026-09-08-hosts-dock.md ·
  // docs/log/2026-09-08-settings-dock.md).
  //
  // 그리는 것은 상자와 머리줄뿐이고, 내용은 `<Sidebar>`(호스트 트리) ·
  // `<ProjectList>`(프로젝트 — 저장소 폴더 목록 · docs/log/2026-09-24-projects.md) ·
  // `<SettingsModal>`이다 — 검색·드래그·섹션·저장이 전부 그 컴포넌트들 안에 있고,
  // 여기서는 담는 그릇만 바뀐다.
  //
  // **호스트 트리의 그릇은 이제 여기 하나뿐이다** (docs/log/2026-09-08-remove-hosts-tile.md).
  //
  // **열린 표면은 하나다.** 런처는 `[dock] layout` 쪽의 독(기본 왼쪽 — 반대쪽은 채팅 독), 설정은 가운데 모달로 그린다.
  //
  // **언마운트하지 않는다** — 둘 다 계속 붙여 두고 `hidden` 만 토글한다. 팔레트·검색
  // 오버레이와 정반대의 선택이다: 저쪽은 닫으면 질의가 비워지는 것이 맞지만(한 번 쓰고 버리는
  // 화면), 이쪽은 방금 들어간 폴더·쳐 둔 검색어·보던 설정 섹션과 스크롤이 다음에 열 때도
  // 그대로여야 한다. 종류를 오가는 것도 마찬가지라 **둘을 함께** 붙여 둔다 (설정 섹션의
  // 지역 상태를 `{#if}` 로 갈아 끼우면 매번 날아간다 — `SettingsModal` 의 SECTIONS 주석과
  // 같은 이유다).
  //
  // **런처 독 = 두 칸의 한 면** (2026-09-25 — docs/log/2026-09-25-unified-dock.md). 호스트 ·
  // 프로젝트는 머리줄 대신 **칸 막대**를 세우고, 두 본문이 같은 모양의 검색 줄
  // (`.dock-search` — 이 파일의 `:global` 규칙)과 같은 줄 치수(`--row-*` 덮개)를 쓰며, 맨 아래에
  // 그 칸의 키 안내 줄이 선다. 칸을 바꾸는 것은 종류를 바꾸는 것 그대로라(`openDock`) 여닫이가
  // 다시 돌지 않고, 두 본문은 여전히 붙어 있어 검색어·고른 줄·폴더가 칸을 오가도 산다.
  // 설정은 가운데 모달이다. 기존 여닫기 상태와 본문을 공유해 진입점·편집 상태를 유지한다.
  //
  // **통합 독** (2026-10-18 — 사용자 확정 목업) — 흩어진 메뉴를 이 독 하나에 모았다. 런처 독은 위에서 아래로:
  // ① 오른쪽 위 **아이콘 단추 줄**(`DOCK_TOOLS` — 화면 잠금(볼트 상태 그림) · 새로고침 · 설정 · 종료 = 모든 세션 종료…, 원격 창은 종료 없음)
  // ② **실행 단추 줄**(`DockLaunch` — 기본 셸 · AI CLI 마다 · 로컬 파일, "이 탭에 연다" — 옛 상태바 `>_` 셸 메뉴 · 메뉴 칸들)
  // ③ **칸 줄 + 목록 = 한 카드** — 칸 [알림 | 호스트 | 프로젝트 | DB](아이콘 위 · 글자 아래, 고른 칸은 아래 2px 강조색 밑줄로만)
  //    → 얇은 선 → 그 칸의 본문(알림 = `DockAlerts` — 옛 알림 센터 팝오버, 나머지 = 검색 칸 + 목록)
  // ④ **바닥 줄** — 알림 칸은 "새 알림 N · [작업안 기록] · [모두 읽음]", 나머지 칸은 키 안내 그대로.
  // 칸 없이 열면(창 가장자리 호버 · 알림 배지) 알림 칸이다(`DEFAULT_LAUNCHER_SEGMENT` — 상태바 독 단추는 실기 뒤 걷었다).
  // ---------------------------------------------------------------------------

  let dockEl = $state<HTMLElement | null>(null);
  let tree = $state<ReturnType<typeof Sidebar> | undefined>();
  let projectList = $state<ReturnType<typeof ProjectList> | undefined>();
  let dbList = $state<ReturnType<typeof DbList> | undefined>();
  let alertsBody = $state<ReturnType<typeof DockAlerts> | undefined>();
  let launch = $state<ReturnType<typeof DockLaunch> | undefined>();
  let settingsBody = $state<ReturnType<typeof SettingsModal> | undefined>();

  const kind = $derived(dockKind());
  /** 런처가 선 쪽 — 설정 `[dock] layout`(2026-10-23 — 상태바 자리와 무관 · 채팅 독은 늘 반대쪽 `ChatDock.svelte`) */
  const dockRight = $derived(dockSides(settings.dockLayout).launcher === "right");

  /**
   * **그리는 데 쓰는 종류** — 열려 있으면 `kind` 그대로, 닫히는 중이면 **마지막으로 보이던 것**.
   *
   * 닫기는 논리가 곧장이고(`kind === null` → `hidden`·포커스 반환·토글) 그림만 닫힘 전이 동안(200ms) 남아
   * 미끄러진다 (docs/log/2026-09-25-dock-slide.md). 그동안 본문 스위치·제목·폭을 `kind`
   * 로 고르면 본문이 전부 `display:none` 이 되고 폭은 호스트 폭으로 튀어 **빈 테두리만**
   * 미끄러졌다. 그래서 그림은 이것으로 고르고, 동작(포커스·Escape·설정의 `open`)은 `kind` 로
   * 고른다.
   *
   * `$effect` 가 아니라 `$derived` 다 — 닫은 뒤 다른 종류를 열 때 `kind` 가 바뀌는 그 틱에
   * 같이 바뀌어, 첫 프레임부터 새 본문이 그려진다(옛 본문이 한 프레임 비치지 않는다).
   * `last` 는 룬이 아니다: 아무도 그것을 구독하지 않고 이 계산만 읽는다.
   */
  let last: DockKind = "alerts";
  const shown = $derived.by(() => {
    if (kind !== null) last = kind;
    return last;
  });
  const width = $derived(dockWidthOf(shown));

  /** 그리는 종류가 런처의 칸인가 — 칸 막대·검색 줄 덮개·키 안내 줄이 이것 하나로 선다 */
  const launcher = $derived(isLauncherKind(shown));

  /** 바닥 줄 — 그리는 칸의 키 안내 (닫히는 동안에도 보던 칸의 것이다) */
  const hints = $derived(isLauncherKind(shown) ? launcherSegment(shown).hints : []);

  /** 칸 이름 + 지금 걸린 조합 (칸 막대의 말풍선) — 사용자가 키를 바꾸면 따라온다. 전용 단축키가 없는 칸(DB)은 이름만 */
  function segmentTitle(action: string | null, labelKey: Key): string {
    if (action === null) return t(labelKey);
    const combo = effectiveCombo(action, settings.current.keybindings);
    return combo ? `${t(labelKey)} (${displayCombo(combo)})` : t(labelKey);
  }

  /**
   * 칸 막대에서 ←/→ 로 옮겼다 — 다음 프레임의 포커스는 검색 칸이 아니라 **그 칸 단추**로 간다
   * (WAI-ARIA 탭 목록의 관례: 화살표로 옮겨 다니는 동안 키보드는 막대 위에 머문다). 룬이 아니다:
   * 아래 포커스 효과가 rAF 안에서 한 번 읽고 지운다.
   */
  let focusSegmentNext = false;

  /** 그 칸의 검색 칸으로 — 칸 단추를 누른 몸짓의 뜻은 "여기서 찾겠다" 다(알림은 검색 칸이 없어 목록으로) */
  function focusSearchOf(k: LauncherKind): void {
    if (k === "alerts") alertsBody?.focusList();
    else if (k === "hosts") tree?.focusSearch();
    else if (k === "projects") projectList?.focusSearch();
    else if (k === "db") dbList?.focusSearch();
  }

  /**
   * 칸 단추를 눌렀다 — 다른 칸이면 종류를 바꾸고(여닫이 없음 · 포커스 효과가 검색 칸으로 보낸다),
   * 이미 그 칸이면 검색 칸으로만 간다(효과는 `kind` 가 그대로라 다시 돌지 않는다).
   */
  function pickSegment(k: LauncherKind): void {
    if (kind === k) focusSearchOf(k);
    else openDock(k);
  }

  /**
   * 칸 막대의 키 — ←/→ 옆 칸(끝에서 감싼다) · Home/End 처음/끝. 막대에 포커스가 있을 때만 뜻이
   * 있다(검색 칸의 ←/→ 는 글자 사이를 오가는 키라 건드리지 않는다). 수식 키는 전역의 것이다 —
   * `Ctrl+Tab` 은 탭 전환이고 `Ctrl+Alt+화살표` 는 타일 크기 조절이다(CLAUDE.md).
   */
  function onSegmentKey(ev: KeyboardEvent): void {
    if (!isLauncherKind(kind) || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    let next: LauncherKind | null = null;
    if (ev.key === "ArrowRight") next = adjacentSegment(kind, 1);
    else if (ev.key === "ArrowLeft") next = adjacentSegment(kind, -1);
    else if (ev.key === "Home") next = LAUNCHER_SEGMENTS[0].kind;
    else if (ev.key === "End") next = LAUNCHER_SEGMENTS[LAUNCHER_SEGMENTS.length - 1].kind;
    if (next === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (next === kind) return;
    focusSegmentNext = true;
    openDock(next);
  }

  /**
   * 트리에 넘기는 신원 — **활성 탭의 포커스된 타일**이다.
   *
   * `Sidebar` 가 이 둘을 쓰는 곳은 우클릭 "전체 열기 (타일)" 하나뿐이다. 뜻은 "지금 보고
   * 있는 탭의 지금 타일 옆" 이고, 거기서부터는 `openHostsTiled`(그 타일의 오른쪽 절반에
   * 격자)가 맡는다. 시작 타일이 대상이면 여느 열기와 마찬가지로 **교체**된다
   * (`placePane` 의 `isLoneStart`). 탭이 하나도 없으면 둘 다 빈 문자열이고, 상위가 그때는
   * 탭 바 드랍과 같은 길로 보낸다 (`+page` 의 `onopenhosts`).
   */
  const tab = $derived(activeTab());
  const tabId = $derived(tab?.id ?? "");
  const paneId = $derived(tab ? paneOf(tab) : "");

  onMount(() => {
    restoreDockWidths();
    // 바깥 클릭으로 닫는다 — **캡처 단계**라 아래 화면이 그 클릭을 처리하기 전에 판정한다.
    window.addEventListener("pointerdown", onOutsidePointerDown, true);
    // 가장자리 호버 — 창 좌표로 판정한다(띠는 누르기를 가로채지 않는 측정용 상자다 · 아래 "가장자리 호버" 절).
    // 수동(passive) 리스너다: 움직임마다 도는 일은 사각형 비교 하나뿐이다(띠의 사각형은 재어 둔 것을 쓴다). **캡처 단계**다 —
    // 아래 화면(타일 · 끌기 손잡이)이 움직임의 전파를 끊어도 판정은 받는다.
    // 걸고 걷는 몸(리스너 다섯 · 시계)은 `chrome/edge-dock.ts` 의 `attach` — 순서는 옮기기 전 그대로다.
    const offEdge = edgeHover.attach();
    return () => {
      window.removeEventListener("pointerdown", onOutsidePointerDown, true);
      offEdge();
    };
  });

  // ---------------------------------------------------------------------------
  // 가장자리 호버로 열기 (2026-10-18 통합 독 — 규칙은 순수 `$lib/dock` 의 `sideEdgeStrip` · `edgeHoverMove` · `inEdgeStrip`)
  //
  // 독이 놓인 쪽(설정 `[dock] layout` — 기본 왼쪽) **창 바깥 끝의 16px 고정 띠**(제목줄 아래 ~ 창 아래 끝)에 커서가 250ms 머물면 연다.
  // 상태바 자리 · 모양(flat · panel · hug)과 무관하게 늘 같은 자리다 — 왼쪽 상태바 기둥이 있어도 띠는 창 끝이다(기둥 위에 겹친다).
  // 16px 인 까닭(창 끝 4~6px 을 OS 크기 조절 띠가 가린다)은 `$lib/dock` 의 절 머리말. 마우스 단추를 누른 채로는 세지 않는다(글자
  // 고르기 · 끌기). **닫기는 여기 없다** — 호버로 열었어도 Esc · 바깥 누르기로만 닫힌다(`onOutsidePointerDown` 머리말 — 2026-09-03 에
  // 되돌린 자동 숨김 사이드바). 메뉴 · 모달 · 가림막 · 모바일 배치 동안은 열지 않는다.
  //
  // 띠 · 시계 · 창 리스너는 `chrome/edge-dock.ts`(2026-10-27 분할 5차 — 채팅 독과 같은 몸). 여기는 쪽 · 막는 앱 상태 · 여는 길만 넘긴다.
  // ---------------------------------------------------------------------------

  const edgeHover = createEdgeHover({
    side: () => (dockRight ? "right" : "left"),
    blocked: () => dockKind() !== null || anyModalOpen() || veilVisible() || mobileLayout(),
    open: () => revealLauncherDock(),
  });

  /** 독 쪽(`[dock] layout`)이 바뀌면 띠가 반대편 끝으로 간다 — 반대쪽 끝의 띠는 채팅 독(`ChatDock.svelte`)의 것이다 */
  $effect(() => {
    void dockRight;
    edgeHover.forgetStrip();
  });

  /** 제목줄 높이가 바뀌면(탭 모양) 띠의 위 끝도 바뀐다 */
  $effect(() => {
    const bar = document.querySelector(".titlebar");
    if (!bar) return;
    const ro = new ResizeObserver(edgeHover.forgetStrip);
    ro.observe(bar);
    return () => ro.disconnect();
  });

  /** 독이 열리거나 닫힐 때마다 — 띠를 한 번 벗어나야 다시 센다(커서 아래에서 닫힌 독이 도로 열리지 않게) */
  $effect(() => {
    void kind;
    untrack(() => edgeHover.afterClose());
  });

  /**
   * 열리는 순간(그리고 종류를 갈아 끼울 때) **키보드를 독 안으로**.
   *
   * 호스트는 검색 칸으로 간다 — 독을 여는 몸짓의 뜻이 대개 "그 호스트를 찾아 열겠다" 다.
   *
   * 설정은 **어떤 칸에도 커서를 놓지 않는다.** 넣어 봤다가 뺐다: 본문의 첫 입력칸(강조색)이
   * 섹션 맨 앞이 아니라 모드·월페이퍼 아래라, 포커스를 주는 순간 브라우저가 그 칸을 보이게
   * 하려고 패널을 스크롤해 **독이 "색과 투명도" 한가운데서 열렸다**. 그래서 포커스는 상자
   * 자신이 받고(`tabindex="-1"`, 외곽선 없음 — Escape·전역 키가 그대로 산다) 본문은
   * **지금 섹션의 맨 위**로 되돌린다.
   *
   * `hidden` 이 걷힌 다음 프레임에 부른다: `display:none` 인 요소는 포커스를 받지 못해
   * 같은 틱에서 부르면 조용히 아무 일도 일어나지 않는다. 요소 참조들은 rAF 콜백 안에서
   * 읽으므로 이 효과의 의존성은 `kind` 하나뿐이다.
   */
  $effect(() => {
    if (kind === null) return;
    const want = kind;
    const raf = requestAnimationFrame(() => {
      // 칸 막대에서 화살표로 옮겼으면 키보드는 막대에 머문다 (`onSegmentKey`)
      if (focusSegmentNext) {
        focusSegmentNext = false;
        dockEl?.querySelector<HTMLElement>(`[data-segment="${want}"]`)?.focus({ preventScroll: true });
        return;
      }
      // 알림은 목록으로 — ↑↓ 가 곧바로 돈다(검색 칸이 없는 칸이다).
      if (want === "alerts") {
        if (alertsBody) alertsBody.focusList();
        else dockEl?.focus({ preventScroll: true });
        return;
      }
      if (want === "hosts") {
        if (tree) tree.focusSearch();
        else dockEl?.focus({ preventScroll: true });
        return;
      }
      // 프로젝트도 검색 칸으로 — 호스트와 같은 뜻("그 프로젝트를 찾아 열겠다")이다.
      if (want === "projects") {
        if (projectList) projectList.focusSearch();
        else dockEl?.focus({ preventScroll: true });
        return;
      }
      // DB 도 검색 칸으로 — 같은 뜻("그 연결을 찾아 열겠다")이다.
      if (want === "db") {
        if (dbList) dbList.focusSearch();
        else dockEl?.focus({ preventScroll: true });
        return;
      }
      settingsBody?.scrollToTop();
      dockEl?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  });

  /**
   * 떠 있는 표면들 — 독 **바깥**의 DOM 이지만 **논리적으로는 독의 일부**다.
   *
   * 호스트 추가·속성 폼(모달)과 트리의 우클릭 메뉴는 `position: fixed` 라 독 상자 밖에 서고,
   * 메뉴는 화면 전체를 덮는 백드롭까지 깐다. 그것들을 예외로 두지 않으면 "＋ 를 눌러 폼을
   * 열고 칸을 클릭" 하는 순간 독이 닫힌다 — 폼을 연 것이 바로 그 독인데.
   *
   * 설정 쪽의 DOM 표면은 앱 아이콘 자르기 모달(`dialogs/AppIconCropDialog.svelte` — `.overlay`)과 마스터 암호
   * 모달 정도다(월페이퍼의 "이미지 선택…" 은 OS 파일 대화상자라 웹뷰에 pointerdown 을 내지 않는다). 목록을 좁히지
   * 않는다 — 섹션이 늘 때 여기를 같이 고쳐야 하는 규칙을 만들지 않으려는 것이다.
   */
  const FLOATING = ".overlay, .modal, .menu, .menu-backdrop, [role='dialog'], [role='menu']";

  /**
   * 바깥을 눌렀다 → 닫는다. **마우스가 나가는 것으로는 닫지 않는다** — 2026-09-03 에
   * 되돌린 자동 숨김 사이드바가 정확히 거기서 죽었다(드래그 도중 커서가 상자를 벗어나면
   * 드래그 소스가 사라졌다). 드래그는 pointerdown 을 바깥에 내지 않으므로 이 규칙에서는
   * **놓는 동안 독이 열린 채로 남는다** = 여러 개를 차례로 끌어다 놓는 몸짓이 살아 있다.
   */
  function onOutsidePointerDown(ev: PointerEvent): void {
    if (dockKind() === null) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (dockEl?.contains(t)) return;
    if (t.closest(FLOATING)) return;
    // 상태바의 진입 버튼(호스트·설정·관리뷰)은 자기 표면을 **스스로 토글**한다. 그 버튼의
    // pointerdown 을 여기서 바깥 클릭으로 보고 미리 닫으면, 곧이어 오는 click 의 `toggleDock`
    // 이 (닫힌 것을 보고) 도로 열어 같은 글리프로 닫는 것이 안 먹는다 — FLOATING 을 예외로
    // 두는 것과 같은 이유다 (그 버튼이 연 것이 바로 이 독인데 그 클릭에 닫히면 안 된다).
    if (t.closest("[data-chrome-toggle]")) return;
    if (anyModalOpen()) return; // 모달이 떠 있는 동안의 클릭은 그 모달의 것이다
    closeDock(false); // 누른 곳이 곧 갈 곳이다 — 옛 자리로 되돌리지 않는다
  }

  /**
   * Escape — **독 안에서 누른 것만** 받는다. 그리고 그 전에 **본문에게 먼저 물어본다.**
   *
   * 호스트 쪽은 물어볼 것이 없다: `Sidebar` 의 Escape 는 선택 → 검색어 순으로 한
   * 겹씩 벗으며 그때마다 스스로 전파를 끊고, 더 벗을 것이 없을 때만 여기까지 올라온다.
   *
   * 설정 쪽은 반대로 **여기가 물어본다** ([`captureIfRecording`]). 단축키를 기록하는 중에는
   * 눌린 키를 통째로 설정이 삼켜야 하는데(그래야 `Ctrl+D` 같은 조합도 그대로 기록된다),
   * 그 리스너는 창(`svelte:window`)에 있어 **독보다 나중**이다 — 순서를 기다리면 기록 취소
   * Escape 가 독을 먼저 닫는다. 삼켰으면 그쪽이 전파까지 끊으므로 여기서는 물러난다.
   *
   * 삼키지 않은 Escape 는 독을 닫고 전파를 끊는다 — 그래서 **창 층위의 Escape 사슬
   * (`keys.svelte.ts`)에는 들어가지 않는다**. 런처에서는 전역 단축키가 살고,
   * 설정 모달에서는 `anyModalOpen()`이 타일 조작을 막는다. 설정 여닫기 조합은 여기서 받는다.
   */
  function onKeydown(ev: KeyboardEvent): void {
    if (settingsBody?.captureIfRecording(ev)) return;
    if (kind === "settings") {
      const closeCombo = effectiveCombo("open-settings", settings.current.keybindings);
      if (closeCombo && comboFromEvent(ev) === closeCombo) {
        ev.preventDefault();
        ev.stopPropagation();
        closeDock();
        return;
      }
      if (ev.key === "Tab" && dockEl) {
        trapTab(ev, dockEl);
        return;
      }
    }
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    // 기본 셸 칸의 우클릭 셸 메뉴가 떠 있으면 그것부터 닫는다 — 한 겹씩 벗는다(메뉴 → 독 · 포커스는 그 칸으로)
    if (launcher && launch?.collapse(true)) return;
    closeDock();
  }

  // ---------------------------------------------------------------------------
  // 머리 아이콘 줄 · 알림 칸 배지 · 알림 바닥 줄 (2026-10-18 통합 독)
  // ---------------------------------------------------------------------------

  /** 독이 닫히면 실행 단추의 셸 메뉴도 닫는다 — 다음에 열 때 지난번 메뉴가 떠 있지 않게(바깥 누르기 · 칸 이동 모두) */
  $effect(() => {
    if (kind === null) untrack(() => launch?.collapse());
  });

  /**
   * 원격 창(브라우저)에는 종료(모든 세션 종료…)가 없다 — 집 PC 사람의 결정이다(명령 `app_end_all_sessions` 도 원격에서는
   * 집 PC 전용으로 거절된다 — `remote/deny.rs`). 창 제어 단추(`+page` 의 `.winctl`)를 그리지 않는 것과 같은 판단.
   */
  const tools = $derived(DOCK_TOOLS.filter((tool) => tool.id !== "quit" || !isRemote));

  /** 단추의 말 — 이름 + 지금 걸린 조합(레지스트리 밖은 고정 조합 · 없으면 이름만 — `shortcutTitle`) */
  function toolTitle(tool: DockTool): string {
    const combo = tool.action ? effectiveCombo(tool.action, settings.current.keybindings) : null;
    return shortcutTitle(t(tool.labelKey), combo ? displayCombo(combo) : (tool.fixedCombo ?? null));
  }

  /**
   * 단추를 눌렀다. 팔레트 · 종료는 **독을 먼저 닫는다**(`runAfterClose` — 팔레트의 포커스 돌려주기가 독 안의 단추를 가리키지
   * 않게 · 종료의 확인 대화가 떠 있는 독 뒤에 숨지 않게). 종료 = **모든 세션 종료…** — 트레이 메뉴의 같은 칸과 한 길이다
   * (끝내기 모달 `dialogs/QuitDialog` — [GUI 종료] · [모두 종료] 를 고른다, 2026-10-28 · 예전엔 [모든 세션 종료] 확인 상자 · 몸통은 `quit-app` 액션 — 단축키 · 팔레트와 한 길). 설정은 같은 층의 다른 화면이라 종류만 바꾼다(`openDock`).
   * 새로고침은 F5 와 **같은 길**이다 — 페이지만 다시 읽고 세션은 임대만 풀어 새 페이지가 다시 붙는다(CLAUDE.md "세션 코어").
   * 폰 배치(`mobileLayout`)의 톱니는 독을 닫고 **폰 설정 화면**(`MobileSettings`)을 연다 — 전체 설정 모달은 그 화면 꼬리의
   * [전체 설정 열기 ›] 로 간다(고르기 화면 톱니 · 시트 [설정] 과 같은 입구).
   */
  function runTool(id: DockTool["id"]): void {
    // 화면 잠금 — 독을 먼저 닫고 가림막(`toggle-veil` 과 같은 몸통 — 볼트도 함께 잠긴다 · 걷는 문은 가림막 위 관문 하나)
    if (id === "lock") runAfterClose(() => closeDock(), () => runAction("toggle-veil"));
    else if (id === "reload") window.location.reload();
    else if (id === "settings" && mobileLayout()) runAfterClose(() => closeDock(), () => openMobileSettings());
    else if (id === "settings") openDock("settings");
    else runAfterClose(() => closeDock(), () => runAction("quit-app"));
  }

  /** 알림 칸 · 상태바 알림 배지의 수 — 승인 대기 + 확인할 에이전트 알림(옛 종의 배지 그대로 · 일반 알림은 세지 않는다) */
  const alertCount = $derived(pendingCount() + agentBannerBadge().count);
  /** 강조색 배지 — 승인 대기나 권한 물음이 있을 때만(사람이 답해야 멈춘 일이 풀린다) */
  const alertUrgent = $derived(pendingCount() > 0 || agentBannerBadge().urgent);

  /** [모두 읽음] 이 할 일이 있는가 — 끝난 에이전트 알림 · 읽지 않은 일반 알림 */
  const canReadAll = $derived(
    agentBannerItems().some((b) => b.kind === "stop") || notificationList().some((e) => !e.read),
  );

  /** [모두 읽음] — 끝남을 전부 확인함으로 · 일반 알림을 읽음으로. 권한 물음 · 승인 대기는 남는다(답해야 풀린다) */
  function readAll(): void {
    resolveFinishedBanners();
    markNotificationsRead();
  }

  /**
   * [알림 지우기] 가 할 일이 있는가 — 지우는 대상과 정확히 같다: 일반 알림 기록(`clearNotificationHistory` — 읽음 여부 무관
   * 전부)과 해결된 에이전트 알림(`clearResolvedBanners` — `resolved` 목록). "확인할 것"(해결되지 않은 배너) · 승인 대기는 세지
   * 않는다 — 지우지 않으므로.
   */
  const canClear = $derived(notificationList().length > 0 || resolvedAgentBanners().length > 0);

  /**
   * [알림 지우기] — 알림 칸의 "지난 알림" 을 통째로 비운다(옛 목록 맨 아래 "모두 지우기" 와 같은 몸통 · 2026-10-24 바닥 줄로
   * 옮김). 확인할 것(권한 물음 · 끝남 — 해결되지 않았다) · 승인 대기는 남는다. 누른 단추가 곧 흐려지므로 포커스는 목록으로
   * (목록 상자 자신 — 나가는 줄이 아니다). 줄은 데이터에서 곧바로 빠지고 DOM 만 위 줄부터 차례로 밀려 나간다(`DockAlerts` 의
   * `rowExit` · 2026-10-24 End-4 사이드바 알림 지우기).
   */
  function clearAlerts(): void {
    clearNotificationHistory();
    clearResolvedBanners();
    alertsBody?.focusList();
  }

  /** [작업안 기록] — 독을 닫고 작업안(채팅 독의 작업안 갈래 · `open-plans` 가 여는 자리)의 기록 보기로 */
  function openPlanHistory(): void {
    runAfterClose(
      () => closeDock(),
      () => {
        setPlansView("history");
        openPlans();
      },
    );
  }

  // ---------------------------------------------------------------------------
  // 폭 손잡이 — 포인터 캡처로 잡는다. 캡처가 없으면 커서가 독 밖(타일 위)으로 나가는
  // 순간 `pointermove` 가 그쪽으로 가 드래그가 끊긴다. 저장은 **놓을 때 한 번**이고,
  // 폭은 **종류마다 따로** 기억한다 (트리 한 칸과 설정 두 칸은 필요한 폭이 다르다).
  // ---------------------------------------------------------------------------

  let resizing = $state(false);

  /** 머리줄에 적는 이름 — 종류 하나로 제목·본문·폭이 갈린다 (`DockKind` 와 같은 표) */
  const DOCK_TITLE: Record<DockKind, Key> = {
    alerts: "app.dock.title.alerts",
    hosts: "app.dock.title.hosts",
    projects: "app.dock.title.projects",
    db: "app.dock.title.db",
    settings: "app.dock.title.settings",
  };

  function onResizeDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    resizing = true;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }

  function onResizeMove(ev: PointerEvent): void {
    if (!resizing || !dockEl) return;
    const rect = dockEl.getBoundingClientRect();
    setDockWidth(dockRight ? rect.right - ev.clientX : ev.clientX - rect.left);
  }

  function onResizeUp(ev: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
    setDockWidth(width, true);
  }
</script>

<!--
  `tabindex="-1"` — 본문이 아직 포커스를 못 받을 때(마운트 직후·설정 본문이 첫 칸을 잡기
  전) 포커스를 받을 몸이 필요하다. 탭 순회에는 끼지 않는다. `hidden` 이 걸린 동안에는
  `display:none` 이라 클릭도 드롭도 가로채지 않는다.

  `role="presentation"` 은 호스트 트리·파일 브라우저의 뿌리와 **같은 규칙**이다: 이 상자는
  껍데기일 뿐이고 뜻은 안쪽(머리줄의 이름과 본문)에 있다. 붙이지 않으면 `<aside>`(랜드마크)
  에 키 핸들러를 달았다고 a11y 경고가 난다.
-->
{#if kind === "settings"}
  <button
    type="button"
    class="settings-backdrop"
    tabindex="-1"
    aria-label={t("app.actions.close")}
    onclick={() => closeDock()}
  ></button>
{/if}

<div
  class="dock"
  class:resizing
  class:launcher
  class:edge-dock={launcher}
  class:settings-modal={!launcher}
  class:glass-mid={launcher}
  class:glass-raised={!launcher}
  data-dock-kind={shown}
  data-dock-side={dockRight ? "right" : "left"}
  role={!launcher ? "dialog" : "presentation"}
  aria-modal={!launcher ? true : undefined}
  aria-label={!launcher ? t("settings.title") : undefined}
  bind:this={dockEl}
  hidden={kind === null}
  tabindex="-1"
  onkeydown={onKeydown}
  style="--dock-w:{width}px"
>
  {#if launcher}
    <!--
      ① 머리 아이콘 줄 — 오른쪽 끝에 단추 넷(화면 잠금 · 새로고침 · 설정 · 종료 — 자물쇠 그림은 볼트 상태: 열림 🔓 · 잠김 · 없음 🔒). 왼쪽에는 문구 · 단축키 안내를 두지 않는다
      (사용자 확정 — 이름과 조합은 툴팁이 말한다). 옛 머리줄의 닫기(×)는 없다: 닫기는 Esc · 바깥 누르기다.
    -->
    <div class="tools" role="toolbar" aria-label={t("app.dock.tools.aria")}>
      {#each tools as tool (tool.id)}
        {@const title = toolTitle(tool)}
        <button type="button" class="tool-btn" class:danger={tool.danger} data-dock-tool={tool.id} {title} aria-label={title}
          onclick={() => runTool(tool.id)}><UiIcon name={tool.id === "lock" && vaultStatus().state === "unlocked" ? "lock-open" : tool.icon}
            size={20} /></button>
      {/each}
    </div>
  {:else}
    <div class="head">
      <span class="title">{t(DOCK_TITLE[shown])}</span>
      <button
        type="button"
        class="head-btn"
        title={t("app.dock.close.title")}
        aria-label={t("app.actions.close")}
        onclick={() => closeDock()}
        ><UiIcon name="close" size={18} /></button
      >
    </div>
  {/if}

  <!--
    본문 **둘 다** 그린다 — 보이는 쪽만 `hidden` 이 걷힌다 (파일 머리말: 종류를 오가도
    트리의 폴더·검색어와 설정의 섹션·스크롤이 그대로 살아 있어야 한다).

    `open`은 설정 본문에게 지금 보이는지 알린다. 단축키 기록과 MCP 상태 읽기를 켠다.
    본문 스위치는 `shown`(닫히는 동안에도 그려 둔다)이지만 `open`은 `kind`다.
    마운트 상태를 유지하면서 닫히는 중에는 동작을 멈춘다.
    `onclose`는 본문의 [취소]가 부르는 모달 닫기 경로다.
  -->
  <!--
    ② 실행 단추 줄 — 런처 칸들 위에 늘 선다(칸을 바꿔도 그대로). 설정 모달 동안은 숨기기만 한다(셸 우클릭 메뉴는 닫힐 때 닫힌다).
  -->
  <div class="launch-wrap" hidden={!launcher}>
    <DockLaunch bind:this={launch} onclose={() => closeDock()} />
  </div>

  <!--
    ③ 칸 줄 + 목록. 칸 줄은 MD3 내비게이션 바다 — 같은 폭으로 줄을 채우고(`grid` 자동 균등 분할) 알약 지시자(아이콘) 위 ·
    글자 아래, 고른 칸은 지시자가 secondaryContainer 로 찬다(2026-10-18 End-4 식 — 그 전의 2px 밑줄을 대체). WAI-ARIA 탭 목록이라 탭 순회에는
    고른 칸 하나만 들고(`tabindex`), ←/→ 로 옮긴다 (`onSegmentKey`). 알림 칸 단추는 아이콘 모서리에 새 알림 수 배지.
    본문들이 `tabpanel` 이 아닌 것은 일부러다 — 본문은 제각기 키보드 몸(뿌리의 `onkeydown`)을
    가진 탐색기라, 탭 패널로 감싸면 스크린 리더가 그 안의 목록 이름을 가린다.
    카드는 설정 모달 동안 숨기기만 한다 — 본문들을 언마운트하지 않는다(파일 머리말).
  -->
  <div class="card" hidden={!launcher}>
    <div class="segs" role="tablist" aria-label={t("app.dock.segments.aria")} tabindex="-1" onkeydown={onSegmentKey}>
      {#each LAUNCHER_SEGMENTS as seg (seg.kind)}
        {@const badge = seg.kind === "alerts" && alertCount > 0}
        <button
          type="button"
          class="seg"
          class:active={shown === seg.kind}
          role="tab"
          aria-selected={shown === seg.kind}
          tabindex={shown === seg.kind ? 0 : -1}
          data-segment={seg.kind}
          title={segmentTitle(seg.action, seg.labelKey)}
          aria-label={badge ? `${t(seg.labelKey)} — ${t("app.dock.alerts.badge", { n: alertCount })}` : t(seg.labelKey)}
          onclick={() => pickSegment(seg.kind)}
        >
          <span class="seg-ico">
            <UiIcon name={seg.icon} size={20} />
            {#if badge}<span class="seg-badge" class:urgent={alertUrgent} data-dock-alert-badge aria-hidden="true"
                >{alertCount}</span
              >{/if}
          </span>
          <span class="seg-lbl">{t(seg.labelKey)}</span>
        </button>
      {/each}
    </div>

    <!-- 알림 — 옛 상태바 종의 팝오버(2026-10-18). 칸이 보이는 동안 읽음(`open`) · 다른 곳으로 가는 줄은 독을 닫고 간다 -->
    <div class="body" hidden={shown !== "alerts"}>
      <DockAlerts
        bind:this={alertsBody}
        open={kind === "alerts"}
        side={dockRight ? "right" : "left"}
        onclose={() => closeDock()}
        onsessions={toggleSessionSheet}
      />
    </div>

    <div class="body" hidden={shown !== "hosts"}>
      <Sidebar bind:this={tree} {tabId} {paneId} />
    </div>

    <!--
      프로젝트 — 호스트 트리와 같은 층의 형제다 (docs/log/2026-09-24-projects.md). 처음에는 호스트
      트리 안의 가짜 폴더였다가 자기 독으로 나왔다(사용자 피드백 2026-09-24). 여기도 언마운트하지
      않는다 — 쳐 둔 검색어·고른 줄이 종류를 오가는 사이에 날아가지 않게.
    -->
    <div class="body" hidden={shown !== "projects"}>
      <ProjectList bind:this={projectList} />
    </div>

    <!--
      DB — 쿼리 타일의 연결 목록(2026-10-12). 데이터는 db-connections.json 하나(10-13)이고, 이 칸은 보이고 편집 폼을 연다.
      여기도 언마운트하지 않는다(검색어 · 고른 줄이 칸을 오가도 산다).
    -->
    <div class="body" hidden={shown !== "db"}>
      <DbList bind:this={dbList} />
    </div>
  </div>


  <div class="body" hidden={shown !== "settings"}>
    <SettingsModal
      bind:this={settingsBody}
      open={kind === "settings"}
      onclose={() => closeDock()}
    />
  </div>

  <!--
    바닥 줄 — 그 칸에 **실제로 있는** 키만 적는다(`LAUNCHER_SEGMENTS[].hints`), 오른쪽 끝은 둘에
    공통인 `Esc 닫기`. 누를 수 없는 안내라 `aria-hidden` 은 아니지만 포커스는 받지 않는다.
  -->
  <!--
    떨어진 세션(③-4) — 아무 창도 데려가지 않은 채 세션 서버에 살아 있는 세션이 있으면 바닥 줄 위에 한 줄. 누르면 독을
    닫고 세션 목록 판의 그 묶음으로 간다(`app/detached`).
  -->
  {#if launcher && detachedCount() > 0}
    <button
      type="button"
      class="detached-line"
      data-dock-detached={detachedCount()}
      onclick={() => {
        closeDock();
        openDetachedList();
      }}>{t("app.detached.dockLine", { n: detachedCount() })}</button
    >
  {/if}

  {#if launcher && shown === "alerts"}
    <!--
      ④ 알림 칸의 바닥 줄 — "새 알림 N"(배지와 같은 수) · [작업안 기록](작업안의 기록 보기) · [모두 읽음](끝난 에이전트 알림을
      확인함으로 · 일반 알림 읽음 — 권한 물음 · 승인 대기는 남는다) · [알림 지우기](지난 알림을 비운다 — 확인할 것 · 승인 대기는
      남는다. 2026-10-24 목록 맨 아래 "모두 지우기" 를 여기로 옮겼다 — 한 곳에만 둔다). 뒤의 둘은 할 일이 없으면 흐려지고,
      아이콘 + 글자 알약이다. 독이 좁으면 둘은 아이콘만, 더 좁으면 "새 알림 N" 도 접는다(아래 `@container dock-foot` —
      배지가 같은 수를 보인다). 글자를 접어도 이름은 `aria-label` · `title`(이름 그대로 — 2026-10-24 짧게) 로 남는다.
    -->
    <div class="foot alerts-foot" data-dock-foot="alerts">
      <div class="foot-row">
        <span class="hint" data-dock-alert-count={alertCount}>{t("app.dock.alerts.foot.new", { n: alertCount })}</span>
        <button type="button" class="foot-btn end" data-dock-plans onclick={openPlanHistory}
          >{t("app.dock.alerts.foot.plans")}</button
        >
        <button
          type="button"
          class="foot-btn icon"
          data-dock-read-all
          disabled={!canReadAll}
          title={t("app.dock.alerts.foot.readAll")}
          aria-label={t("app.dock.alerts.foot.readAll")}
          onclick={readAll}
          ><UiIcon name="check-check" size={16} /><span class="label">{t("app.dock.alerts.foot.readAll")}</span></button
        >
        <button
          type="button"
          class="foot-btn icon"
          data-dock-clear
          disabled={!canClear}
          title={t("app.dock.alerts.foot.clear")}
          aria-label={t("app.dock.alerts.foot.clear")}
          onclick={clearAlerts}
          ><UiIcon name="trash" size={16} /><span class="label">{t("app.dock.alerts.foot.clear")}</span></button
        >
      </div>
    </div>
  {:else if launcher}
    <div class="foot" role="note" aria-label={t("app.dock.foot.aria")} data-dock-foot={shown}>
      {#each hints as h (h.keys)}
        <span class="hint"><Keys combo={h.keys} />{t(h.labelKey)}</span>
      {/each}
      <span class="hint end"><Keys combo="Esc" />{t("app.dock.hint.close")}</span>
    </div>
  {/if}

  <!--
    폭 손잡이. `role="separator"` 에 `aria-orientation` 을 달아 두면 스크린 리더가 "나누는
    선" 으로 읽는다 — 키보드로는 잡지 않는다. 런처 독에만 그린다.
  -->
  {#if launcher}
    <div
      class="grip"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("app.dock.resize.aria")}
      onpointerdown={onResizeDown}
      onpointermove={onResizeMove}
      onpointerup={onResizeUp}
      onpointercancel={onResizeUp}
    ></div>
  {/if}
</div>

<style>
  /*
   * 타일 캔버스와 **같은 여백·같은 모서리**로 선다 (`--gap` · `--radius-surface`) — 독은 타일 위에
   * 뜬 또 하나의 면이라, 창 가장자리와의 거리가 타일과 다르면 그 층위가 읽히지 않는다.
   * 오른쪽 모서리도 둥글다: 붙어 있는 칼럼이 아니라 **떠 있는 상자**다.
   *
   * `position: absolute` 다 — 부모(`+page` 의 `.body`)가 이미 "타이틀바 아래" 를 뜻하는
   * 상자라(그 규칙의 기준 상자로 만들어진 요소다) 탭 바 높이를 여기서 다시 셈하지 않는다.
   * 탭 모양(pill/flat)마다 그 높이가 다르므로 숫자로 적으면 어긋난다.
   *
   * z-index 100 — 타일(포커스 1 · 분할선 2 · 타일 메뉴 20)보다 위, 팔레트·검색(110)보다
   * 아래다. 모달(`.overlay`, 같은 100)은 DOM 에서 뒤에 오므로 그대로 독을 덮는다.
   */
  .dock {
    position: absolute;
    top: var(--gap);
    bottom: calc(var(--gap) + var(--dock-inset-bottom, 0px)); /* 감싸기 테두리(`+page`)만큼 — 기본 0 */
    /* 보통은 `--gap` 만큼 안쪽에서 뜬다. 왼쪽 상태바가 서면 `+page` 의 `.body` 가
       `--dock-inset-left` 를 그 기둥 폭으로 채워, 독이 상태바 오른쪽에 나란히 서게 민다
       (기본값 0 이라 상태바가 다른 자리면 아무 변화가 없다). */
    left: calc(var(--gap) + var(--dock-inset-left, 0px));
    z-index: 100;
    box-sizing: border-box;
    width: var(--dock-w);
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* 평면이면 이 상자가 불투명 면 `--surface-raised-solid` 로 칠한다(타일 위에 뜨는 면은 투명도를 타지 않는다) —
       2026-10-18 통합 독부터 본문 밖의 줄(아이콘 줄 · 실행 단추 · 카드 사이 틈)이 생겨 상자 자신이 칠해야 한다(예전에는
       본문이 상자를 꽉 채워 칠하지 않았다). 안쪽 본문(`.sidebar`·`.projects`)도 같은 색이라 겹쳐도 달라지지 않는다. */
    /* 재질 글래스면 판은 **이 상자 한 겹**이 칠하고 안쪽 본문은 `--glass-inner`(투명)로 비운다 — 둘 다 칠하면
       반투명이 겹쳐 진해진다. */
    background: var(--glass-mid, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 큰 면(2026-10-25 — 타일 · 채팅 독과 같은 값) */
    box-shadow: var(--shadow-raised);
    overflow: hidden; /* 안쪽 본문을 둥근 모서리로 자른다 */
  }
  .dock[data-dock-side="right"]:not(.settings-modal) {
    left: auto;
    right: calc(var(--gap) + var(--dock-inset-right, 0px));
  }

  /*
   * 여닫이 — **채팅 독과 같은 움직임**(2026-10-23 — 사용자가 채팅 독의 닫힘을 골랐다. 그 전은 2026-09-25 의 24px 스르륵 + 흐려짐,
   * docs/log/2026-09-25-dock-slide.md). 닫힘 = 창 끝 밖으로 통째로 민다(거리 `--edge-dock-off` — `.edge-dock` · 시간 · 곡선
   * `--edge-dock-dur` · `--edge-dock-ease` — 모두 `theme.css` 의 "창 끝 독의 여닫이", 두 독이 같은 값을 쓴다). 투명도는 바뀌지 않는다.
   *
   * 모형은 그대로다: 상자는 늘 붙어 있고 `hidden` 만 토글한다(채팅 독과 달리 닫히면 `display: none` 까지 간다). 여는 쪽은
   * `@starting-style`(보이기 시작하는 첫 프레임의 출발값)이, 닫는 쪽은 `display` 를 **끝에 가서야** 끄는 `allow-discrete` 가 맡는다 —
   * 논리적 닫힘(`kind`·포커스 반환)은 곧장이고 그림만 같은 시간 늦게 사라진다. 전이 목록에 `width` 는 없다: 폭 손잡이 드래그와
   * 종류마다 다른 폭(`--dock-w`)은 그대로 즉시 바뀐다. 종류를 갈아 끼울 때는 `hidden` 이 그대로라 다시 돌지 않는다.
   *
   * 끝나면 `transform` 이 **남지 않는다**(기본값 `none` 으로 돌아온다) — 남으면 안쪽의
   * `position: fixed` 메뉴·폼의 기준 상자가 독으로 바뀌어 자리가 어긋난다. 설정 모달(`.settings-modal`)은 아래에서 전이를 끈다.
   */
  .dock {
    transition:
      transform var(--edge-dock-dur) var(--edge-dock-ease),
      display var(--edge-dock-dur) allow-discrete;
  }

  @starting-style {
    .dock {
      transform: translateX(var(--edge-dock-off, 0px));
    }
  }

  /* `hidden` 은 UA 스타일이라 위의 `display: flex` 에 진다 — 명시적으로 이긴다.
     닫히는 동안 아직 그려져 있지만 클릭·드롭은 아래로 흘려보낸다. */
  .dock[hidden] {
    display: none;
    transform: translateX(var(--edge-dock-off, 0px));
    pointer-events: none;
  }

  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    border: 0;
    padding: 0;
    border-radius: 0;
    background: var(--bg-overlay);
    cursor: default;
    /* 등장 — 배경막은 흐림 없이 그대로 나타난다(0→1). 블록이 생길 때(`{#if}`) 한 번 돈다 */
    animation: settings-backdrop-in 200ms ease-out;
  }

  @keyframes settings-backdrop-in {
    from {
      opacity: 0;
    }
  }

  .dock.settings-modal {
    position: fixed;
    inset: 0;
    margin: auto;
    width: min(880px, calc(100vw - 48px));
    height: min(680px, calc(100dvh - 48px));
    /* MD3 모달 판 — surfaceContainerLow · 큰 면 모서리(2026-10-25 — 28 → `--radius-surface`). 묶음 카드(surfaceContainer)가 그 위에 한 단 떠 보인다 */
    border-color: transparent;
    border-radius: var(--radius-surface);
    background: var(--glass-modal, var(--m3-surface-container-low));
    /* transform을 남기면 본문 안의 fixed 팝오버 좌표가 모달 기준으로 바뀐다. */
    transform: none;
    transition: none;
  }

  @starting-style {
    .dock.settings-modal {
      transform: none;
    }
  }

  /*
   * **설정 모달 등장** (2026-10-04) — 상자가 살짝 커지며 8px 아래에서 떠오른다. 독의 스르륵과 같은 시간·곡선
   * (200ms · cubic-bezier(0.2, 0.8, 0.2, 1)).
   *
   * 전이(`transition` + `@starting-style`)가 아니라 **키프레임**이다 — 상자는 런처 독과 같은 요소라, 호스트 독이
   * 떠 있는 채 설정으로 갈아 끼우면 `hidden` 이 그대로여서 전이의 출발점이 없다. 키프레임은 `.settings-modal`
   * 이 붙는 순간(갈아 끼울 때)과 `hidden` 이 걷히는 순간(display 가 none → flex) 둘 다 다시 돈다.
   * 채움(`fill`)이 없으므로 끝나면 위 규칙의 `transform: none` · `opacity` 기본값으로 돌아온다 — 안쪽
   * `position: fixed` 팝오버의 기준 상자가 모달로 바뀌지 않는다.
   *
   * 닫힘은 예전 그대로 즉시다(배경막이 `{#if}` 로 곧장 빠지는 것과 맞춘다).
   */
  .dock.settings-modal:not([hidden]) {
    animation: settings-modal-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* 글래스 — 상자의 `opacity` 대신 판 색 · 그림자와 내용만 페이드(theme.css `glass-surface-in` — 움직이는 동안에도 흐림이 선다) */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-material="glass"]) .dock.settings-modal:not([hidden]) {
      --glass-in-from: translateY(8px) scale(0.97);
      animation-name: glass-surface-in;
    }
    :global(:root[data-material="glass"]) .dock.settings-modal:not([hidden]) > :global(*) {
      animation: glass-content-in 200ms ease-out;
    }
  }

  @keyframes settings-modal-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
  }

  @media (max-width: 600px) {
    .dock.settings-modal {
      width: calc(100vw - 16px);
      height: calc(100dvh - 16px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dock,
    .dock[hidden] {
      transition: none;
    }
    .dock.settings-modal:not([hidden]),
    .settings-backdrop {
      animation: none;
    }
  }

  .dock:focus {
    outline: none; /* 상자 자신이 포커스를 받는 것은 본문이 아직 못 받을 때뿐이다 */
  }

  /* 설정 모달 머리줄 — 제목과 닫기. 런처 독은 같은 자리에 아이콘 줄을 세운다 */
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2) 0 var(--space-5);
    background: var(--glass-inner, var(--m3-surface-container-low));
  }

  .title {
    flex: 1;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-btn {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
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

  .head-btn:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .head-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /*
   * ① 머리 아이콘 줄 — 오른쪽 끝에 40px 원 단추 넷(MD3 표준 아이콘 단추 — 투명 · onSurfaceVariant · 상태 층 호버).
   * 왼쪽은 비운다(문구 · 단축키 안내 없음 — 사용자 확정).
   */
  .tools {
    flex: 0 0 auto;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
    padding: var(--space-2) var(--space-2) var(--space-1);
  }

  .tool-btn {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
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

  .tool-btn:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .tool-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 되돌릴 수 없는 단추(종료 = 모든 세션 종료…) — 쉴 때는 이웃과 같고, 호버 · 포커스에 실패색이 비친다(MD3 error · errorContainer) */
  .tool-btn.danger:hover,
  .tool-btn.danger:focus-visible {
    color: var(--err);
    background: var(--err-soft);
  }

  .launch-wrap {
    flex: 0 0 auto;
  }

  /*
   * ③ 칸 줄 + 목록 — MD3 내비게이션 바 + 그 칸의 본문(2026-10-18 — End-4 식 목업). 테두리 두른 카드는 걷었다: 독 판
   * (surfaceContainer) 위에 바로 앉고, 본문의 카드 · 검색 알약이 제 판을 칠한다. 남는 높이를 전부 받고(목록이 늘어난다)
   * 넘치면 본문이 스크롤한다(칸 줄은 그대로 선다).
   */
  .card {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--glass-inner, transparent);
    overflow: hidden;
  }

  /*
   * 칸 줄 = MD3 내비게이션 바 — 칸 수에 맞춰 전체 폭을 균등 분할한다. 칸 = 알약 지시자(60×32 · 그 안에 아이콘) 위 · 글자 아래.
   * 고른 칸은 지시자가 secondaryContainer + onSecondaryContainer 로 차고 글자는 onSurface 굵게, 나머지는 onSurfaceVariant.
   * (그 전의 2px 강조색 밑줄은 이 알약으로 바뀌었다)
   */
  .segs {
    flex: 0 0 auto;
    min-width: 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--space-1);
    padding: 0 var(--space-2) var(--space-1);
  }

  .segs:focus {
    outline: none;
  }

  .seg {
    position: relative;
    min-width: 0;
    height: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 16px;
    cursor: pointer;
  }

  .seg.active {
    color: var(--fg-1);
    font-weight: var(--fw-semibold);
  }

  .seg:focus-visible {
    outline: none;
  }

  /* 알약 지시자 — 아이콘 뒤 60×32(좁은 칸에서는 칸 폭까지 줄어든다). 호버는 상태 층, 키보드 포커스는 지시자에 중성 링 */
  .seg-ico {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: min(60px, 100%);
    height: 32px;
    line-height: 0;
    color: var(--control-fg);
    border-radius: 16px;
  }

  .seg:hover .seg-ico {
    background: var(--control-ghost-hover);
  }

  .seg.active .seg-ico {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .seg.active:hover .seg-ico {
    background: var(--control-sel-bg-hover);
  }

  .seg:focus-visible .seg-ico {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .seg-lbl {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* 알림 칸의 새 알림 수 — 아이콘 오른쪽 위 모서리에 겹쳐 앉는다(상태바 배지와 같은 알약 · 11px 숫자 · 강조색은 답해야 풀리는 것만) */
  .seg-badge {
    position: absolute;
    top: -2px;
    right: 6px;
    box-sizing: border-box;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    font-size: 10px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    text-align: center;
    color: var(--fg-1);
    background: var(--line-strong);
    border-radius: 999px;
    pointer-events: none;
  }

  .seg-badge.urgent {
    color: var(--on-accent);
    background: var(--accent);
  }

  /*
   * 런처 두 칸의 **공용 치수** — 줄 토큰(`--row-*`, theme.css)을 이 면 안에서만 덮는다. 파일 타일도
   * 같은 토큰을 읽으므로 전역 값을 바꾸면 그쪽까지 끌려간다 — 독 안에서만 13px 본문·28px 줄이다.
   */
  /*
   * 독 안의 **두 모서리 값**(2026-10-18 실기 — "단추가 너무 각졌다"): 큰 면(실행 타일 · 칸 카드)은 16px, 작은 단추(아이콘 줄 ·
   * 칸 · 바닥 줄)는 의미 토큰 `--radius-md`(10px). 16 에 맞는 의미 토큰이 없어 여기 한 곳에 모은다 — 자식 컴포넌트
   * (`DockLaunch`)도 이 변수를 읽는다. 2026-10-18 MD3: 큰 면 22px · 작은 단추 알약. 2026-10-25: 독 판이 큰 면 모서리(16)가 되며
   * 그 안의 카드는 한 단 작게(`--radius-surface-inner` 12).
   */
  .dock.launcher {
    --dock-radius-tile: var(--radius-surface-inner); /* 예전 이름 그대로 — 카드들은 2026-10-25 부터 `--radius-surface-inner` 를 직접 읽는다 */
    --dock-radius-btn: 999px;
    /* MD3 독 판 — surfaceContainer(= `--surface-raised-solid`) · 큰 면 모서리(2026-10-25 — 28 → 16) · 테두리 없음(그림자가 타일과 가른다) */
    border-color: transparent;
    border-radius: var(--radius-surface);
    --row-font: var(--t-sm);
    --row-pad-y: 6px;
    --row-pad-x: var(--space-2);
    --row-inset: var(--space-2);
    --row-gap: var(--space-2);
  }

  /*
   * 검색 줄 — 두 본문이 **같은 마크업**(`.dock-search > label.dock-search-box > 아이콘 + input.search`)
   * 을 세우고 모양은 여기 한 벌이다(`:global` — 마크업이 본문 컴포넌트의 것이라 스코프가 닿지
   * 않는다). 34px · 필드 우물 · 머리카락 선 · 13px. 포커스는 선이 한 단 진해질 뿐 강조색이 아니다.
   * 칸 오른쪽의 아이콘 단추(`.icon-btn` — 정렬·추가)는 전역 `.btn .btn-ghost` 를 정사각형으로 접는다.
   */
  .dock.launcher :global(.dock-search) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3) var(--space-2);
  }

  /* MD3 검색 알약 — 48px · surfaceContainerHigh · 아이콘 onSurfaceVariant. 포커스는 중성 링(강조색 아님) */
  .dock.launcher :global(.dock-search-box) {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    height: 48px;
    padding: 0 var(--space-4);
    color: var(--control-fg);
    background: var(--control-tile-bg);
    border: none;
    box-shadow: var(--glass-ctl-edge, none);
    border-radius: 999px; /* 알약(48px 의 반 — 예전 24 와 같은 모양) */
    cursor: text;
  }

  .dock.launcher :global(.dock-search-box:focus-within) {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .dock.launcher :global(.dock-search-box input) {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: transparent;
    border: none;
    outline: none;
  }

  .dock.launcher :global(.dock-search-box input::placeholder) {
    color: var(--control-fg);
  }

  .dock.launcher :global(.dock-search .icon-btn) {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 50%;
  }

  /*
   * 바닥 줄 — 그 칸의 키 안내. 12px 흐림, 키 글자는 한 단 진하게(`--fg-2`). 넘치면 자른다(줄바꿈하면
   * 목록 높이가 칸마다 흔들린다). `Esc 닫기` 는 오른쪽 끝.
   */
  /* 떨어진 세션 한 줄 — MD3 카드 줄(surfaceContainerHigh · 독 안 카드 모서리 · 독 안쪽 12px 여백). 그 전에는 모서리 없이 독 폭을 꽉 채운 띠라
     둥근 독 안에서 혼자 네모로 보였다(10-18 실기) */
  .detached-line {
    flex: 0 0 auto;
    box-sizing: border-box;
    height: 40px;
    margin: 0 var(--space-3) var(--space-2);
    padding: 0 var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    text-align: left;
    color: var(--accent);
    background: var(--control-tile-bg);
    border: none;
    border-radius: var(--radius-surface-inner);
    box-shadow: var(--glass-ctl-edge, none);
    cursor: pointer;
  }

  .detached-line:hover {
    background: var(--control-tile-bg-hover);
  }

  .detached-line:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .foot {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    box-sizing: border-box;
    height: 48px;
    padding: 0 var(--space-3) 0 var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--control-fg);
    white-space: nowrap;
    overflow: hidden;
    background: var(--glass-inner, transparent);
  }

  .foot .hint {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .foot .hint.end {
    margin-left: auto;
  }

  /* 알림 칸 바닥 줄의 단추 — MD3 tonal 알약(secondaryContainer · 32px). 할 일이 없으면 흐림 */
  .foot-btn {
    flex: 0 0 auto;
    height: 32px;
    padding: 0 var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .foot-btn.end {
    margin-left: auto;
  }

  .foot-btn:hover:not(:disabled) {
    background: var(--control-sel-bg-hover);
  }

  .foot-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .foot-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 아이콘 + 글자 알약 — MD3 관례대로 아이콘 쪽 패딩을 줄인다(왼 12 · 오 16). 아이콘은 `currentColor` 라 흐림(`:disabled`
     의 opacity)도 함께 받는다 */
  .foot-btn.icon {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-4) 0 var(--space-3);
  }

  /*
   * 좁은 독에서도 한 줄(2026-10-24). 독의 최소 폭은 런처 칸 220px(`dock.ts` 의 `DOCK_SLOT_SPEC.launcher` · 기본 380 — 2026-10-28) — 바닥 줄
   * 패딩(왼 16 · 오 12)을 빼면 내용 폭 192 · 기본 352 다. 12px 글자로 어림하면 글자를 다 펴는 줄은 내용 폭 ≈ 390(한국어 —
   * "새 알림 N" 49 · [작업안 기록] 95 · [모두 읽음] 99 · [알림 지우기] 111 · 틈 12×3) · ≈ 405(영어)라 기본 폭에도 안 든다.
   *  - 420px 미만: 두 단추를 32px 원형 아이콘 단추로 접고 틈을 8 로(≈ 49 + 95 + 32 × 2 + 8 × 3 = 232).
   *  - 240px 미만(최소 폭 근처): "새 알림 N" 도 접는다 — 알림 칸 배지가 같은 수를 보인다(≈ 95 + 64 + 16 = 175 ≤ 192).
   * 크기 질의는 바닥 줄의 내용 폭을 잰다(`container-type: inline-size` — 줄 폭은 독이 정하므로 내용이 폭을 바꾸지 않는다).
   */
  .alerts-foot {
    container: dock-foot / inline-size;
  }

  /* 질의는 상자 자신을 못 바꾸므로 틈은 안쪽 줄이 쥔다 */
  .foot-row {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  @container dock-foot (max-width: 419.98px) {
    .foot-row {
      gap: var(--space-2);
    }
    .foot-btn.icon {
      justify-content: center;
      width: 32px;
      padding: 0;
    }
    .foot-btn.icon .label {
      display: none;
    }
  }

  @container dock-foot (max-width: 239.98px) {
    .foot-row > .hint {
      display: none;
    }
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  /* 숨긴 본문 · 카드 · 실행 줄이 확실히 이기게 한다 (`.dock[hidden]` 과 같은 이유 — UA 스타일은 진다) */
  .card[hidden],
  .launch-wrap[hidden],
  .body[hidden] {
    display: none;
  }

  /* 폭 손잡이 — 6px 띠. 보이지 않다가 만지면 중성 선이 뜬다 (강조색은 강조 셋의 몫 — 2026-09-25) */
  .grip {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
    touch-action: none; /* 포인터 캡처가 스크롤 제스처에 뺏기지 않게 */
  }

  .grip:hover,
  .dock.resizing .grip {
    background: var(--line-strong);
  }
  .dock[data-dock-side="right"] .grip {
    left: 0;
    right: auto;
  }
</style>
