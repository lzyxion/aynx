<script lang="ts">
  import { tick } from "svelte";
  import type { TransitionConfig } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { isMainWindow } from "$lib/app/window.svelte.js";
  import { currentWorkspace, currentWorkspaceId, reorderWorkspaces, workspaceList, workspaceMainWindow } from "$lib/app/workspaces.svelte.js";
  import { openWorkspace } from "$lib/app/workspace-actions.svelte.js";
  import { reorderWorkspaceIds, workspaceDropBefore } from "$lib/workspaces/sidebar";
  import { workspaceSheetBuckets } from "$lib/console/window-cards";
  import WorkspaceIcon from "$lib/WorkspaceIcon.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import EqBars from "$lib/orchestration/EqBars.svelte";
  import { pulseOfRun } from "$lib/app/orch-pulse.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { shortcutTitle } from "$lib/status-items";
  import {
    draggingTab,
    listPanes,
    tabDisplayTitle,
    type TabSpec,
  } from "$lib/session";
  import { displayName, displayTabTitle } from "$lib/app/titles.svelte.js";
  import type { TabCommandStatus } from "$lib/app/tabs.svelte.js";
  import type { HostsDrag } from "$lib/hosts";
  import { tabDot, tabDotInput, tabHasUnseen, type TabDotAgent } from "$lib/tab-dot";
  import { elidedTabIds, tabCapacity, type TabFit } from "$lib/tab-overflow";
  import { DEV_INSTANCE } from "$lib/app/instance";
  import { dirtyDocPanes } from "$lib/app/doc-dirty.svelte.js";
  import { DEFAULT_TAB_STYLE, settings, type TabStyle } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import TabOverflowMenu from "$lib/tabbar/TabOverflowMenu.svelte";
  import TabContextMenu from "$lib/tabbar/TabContextMenu.svelte";
  import WorkspacePicker from "$lib/tabbar/WorkspacePicker.svelte";
  import { menuEscape, menuRows } from "$lib/tabbar/tab-menu";
  import { createTabDrag } from "$lib/tabbar/tab-drag.svelte.js";
  import TabStatusGlyph, { tabIconPane } from "$lib/tabbar/TabStatusGlyph.svelte";

  let {
    tabs,
    activeId,
    hasActivity = {},
    tabStatus = {},
    tabBells = {},
    agents = {},
    onagentdot,
    tabStyle = DEFAULT_TAB_STYLE,
    onselect,
    ondragselect,
    onclose,
    oncloseothers,
    oncloseright,
    onrename,
    onnewtab,
    onreorder,
    onpromotepane,
    ondrophosts,
    ontearstart,
    ontearout,
    ontearrefused,
    ontearmerge,
    syncTabs,
    onsynctoggle,
  }: {
    tabs: TabSpec[];
    activeId: string | null;
    /**
     * 탭 id → 안 보는 동안 새 출력이 있었는가. 제목 옆 작은 점으로 표시한다.
     *
     * 2단계의 단순 활동 표시이자, 5단계 배지의 **폴백**이다 — OSC 133 이 없는 세션
     * (스니펫이 안 들어간 tmux 안·로컬 셸)에는 이 신호밖에 없다. `tabStatus` 에 값이
     * 있으면 그쪽이 이긴다 (docs/log/2026-09-02-osc133.md).
     */
    hasActivity?: Record<string, boolean>;
    /**
     * 탭 바 모양 (`pill`·`flat`). 상위(`+page`)가 `settings.tabStyle` 을
     * 그대로 넘긴다 — 설정을 바꾸면 반응적으로 다시 그려진다. **표현만 바꾼다**:
     * 드래그·순서·분리·닫기·툴바 등 모든 동작은 모양과 무관하게 그대로다.
     * 두 모양 모두 순수 CSS 라 글리프 폰트를 요구하지 않는다 (Nerd Font 없이).
     */
    tabStyle?: TabStyle;
    /**
     * 탭 id → OSC 133 로 집계한 명령 상태 (**5단계 승격 — 점 → 색 배지**).
     * 키가 없으면 그 탭은 OSC 133 을 못 본 것이고 위의 활동 점으로 폴백한다. 그 상태를 정한
     * 타일(`paneId`)의 이름이 말풍선에 선다(docs/log/2026-09-26-tab-single-dot.md).
     *
     * 색: 실행 중 `--accent` (점멸 없이) · 실패 `--err` · 백그라운드 성공 `--ok`.
     * 세 색 모두 같은 자리에 같은 크기로 뜬다 — 위치가 흔들리면 "무엇이 바뀌었나" 보다
     * "어디로 갔나" 를 먼저 읽게 된다.
     */
    tabStatus?: Record<string, TabCommandStatus>;
    /**
     * 탭 id → 안 보는 사이에 **벨**(`\a`)이 울린 타일이 있는가
     * (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
     *
     * 예전엔 상태 점 옆에 따로 선 고리였는데, 2026-11-03 부터 **한 자리의 우선순위에 합쳤다**(명령 실패 아래 ·
     * 에이전트 실행 중 위 — `$lib/tab-dot` · docs/log/2026-11-03-tab-status-glyphs.md). 지난 실패는 벨보다 높아
     * 벨이 울려도 사라지지 않고, 말풍선은 둘 다 잇는다. 탭을 보는 순간 함께 거둬진다(상위의 `clearSeenStatus`).
     */
    tabBells?: Record<string, boolean>;
    /**
     * 탭 id → 그 탭의 **AI 타일들**(에이전트 이름 · 상태, docs/log/2026-09-24-agent-status-dot.md) —
     * AI 타일이 있는 탭만 키가 있다. 점은 가장 급한 상태 하나로 접힌다. 모양은 `TabStatusGlyph`(권한 대기 = pending · 완료(안 봄) = check_circle · 실행 중 = 원형 진행 표시 — docs/log/2026-11-03-tab-status-glyphs.md) · 그 밖 = 없음 (docs/log/2026-10-01-agent-status-three.md).
     *
     * 위 셋과 달리 **활성 탭에도** 뜬다(지금의 상태이지 안 본 결과가 아니다). 명령 점·활동 점과는
     * **한 자리를 나눠 쓴다** — 탭마다 점은 하나이고 우선순위로 이긴 것이 선다(`$lib/tab-dot`,
     * docs/log/2026-09-26-tab-single-dot.md). 에이전트가 살아 있는 타일의 "실행 중" 은 명령 점에
     * 접히지 않고(상위의 `tabStatus(isLiveAgentPane)`), 이 점이 떠 있으면 활동 폴백도 사실로 치지
     * 않는다 — 같은 말을 두 번 하지 않게(2026-09-24-agent-status-dot.md 의 09-26 덧붙임).
     */
    agents?: Record<string, TabDotAgent[]>;
    /** 에이전트 점을 눌렀다 — 상위가 그 상태의 첫 AI 타일로 포커스를 옮긴다 */
    onagentdot?: (tabId: string) => void;
    onselect: (id: string) => void;
    /**
     * 타일 드래그 중 머문 탭은 슬라이드 없이 연다(탭 드래그는 순서 바꾸기뿐이라 오지 않는다). 480ms 동안 캔버스가 미끄러지면 드롭 판정의
     * 상자 좌표 스냅숏이 움직이는 상자를 찍는다 — 손에 쥔 것을 놓을 자리는 즉시 서 있어야 한다.
     */
    ondragselect?: (id: string) => void;
    onclose: (id: string) => void;
    /**
     * 우클릭 메뉴 **"다른 탭 닫기"·"오른쪽 탭 닫기"** — 가리킨 탭 id 를 올려 보낸다. 무엇을 닫을지·묻기·
     * 활성 탭 정하기는 상위가 한다(`closeOtherTabsAsked`·`closeTabsToRightAsked`,
     * docs/log/2026-09-28-tab-close-others.md). 닫을 것이 없으면 항목이 꺼진다(`tabsToClose`).
     */
    oncloseothers?: (id: string) => void;
    oncloseright?: (id: string) => void;
    /**
     * **탭 이름 바꾸기** — 탭 더블클릭 · 우클릭 메뉴의 "이름 변경"
     * (docs/log/2026-09-03-workspaces-v1.md).
     *
     * 빈 문자열은 "이름 지우기" 다 (상위가 `TabSpec.name` 키를 지워 자동 제목으로 되돌린다).
     * 이 컴포넌트는 값을 들고 있지 않는다 — 입력이 끝나면 그대로 올려 보낼 뿐이다.
     */
    onrename?: (id: string, name: string) => void;
    /**
     * **새 탭** — `+` 버튼 클릭 하나가 곧장 여기로 온다 (메뉴 없음 —
     * docs/log/2026-09-25-plus-vs-shell-menu.md). `new-tab`(Ctrl+Shift+T)과 같은 몸통이라
     * 빈 탭(launcher)이 하나 는다.
     */
    onnewtab: () => void;
    /**
     * 탭 순서 바꾸기 — `dragId` 를 `beforeId` **앞으로** (null 이면 맨 뒤로).
     * 탭을 탭 바 안에 떨어뜨렸을 때만 부른다. 터미널 위에 떨어뜨리면 그쪽은
     * "탭 병합"(`PaneHost`)이라 여기로 오지 않는다.
     */
    onreorder?: (dragId: string, beforeId: string | null) => void;
    /**
     * **패널 → 탭 승격** — 패널 헤더를 끌어 탭 바에 놓았다. 그 패널을 원래 탭의 트리에서
     * 떼어 새 탭으로 만들고 `beforeId` 탭 **앞에** (null 이면 맨 뒤에) 꽂는다.
     * 탭 순서 바꾸기와 미리보기를 그대로 공유한다 — 놓는 자리의 뜻이 같기 때문이다.
     */
    onpromotepane?: (paneId: string, beforeId: string | null) => void;
    /**
     * **독에서 끌어온 호스트·폴더를 탭 바에 놓았다** = 그것들만 든 **새 탭**
     * 를 만들어 `beforeId` 탭 **앞에** (null 이면 맨 뒤에) 꽂는다
     * (docs/log/2026-09-04-hosts-multiselect.md).
     *
     * 탭 바가 받는 다른 두 드래그(탭 순서 바꾸기 · 타일 승격)와 **미리보기를 그대로
     * 공유한다** — 놓는 자리의 뜻이 셋 다 "여기에 탭 하나" 로 같기 때문이다.
     * 다른 것은 커서뿐이다: 저 둘은 있던 것을 옮기므로 `move`, 이쪽은 여는 조작이라 `copy`.
     */
    ondrophosts?: (payload: HostsDrag, beforeId: string | null) => void;
    /**
     * **탭 드래그가 시작됐다** — 이관 페이로드를 만들어 사서함에 맡기고 그 번호를 돌려준다
     * (docs/log/2026-09-02-tear-out.md). `null` 이면 이번 드래그는 창을 넘을 수 없다
     * (= `x-aynx-tear` 를 싣지 않는다) — 창 안 순서 바꾸기·병합은 그대로 동작한다.
     *
     * **동기여야 한다.** `dragstart` 안에서 `dataTransfer` 에 실어야 하기 때문이다.
     */
    ontearstart?: (tabId: string) => number | null;
    /**
     * 드래그가 **창 밖에서** 아무 데도 놓이지 않고 끝났다 = 새 창으로 **분리**하라.
     * 좌표는 화면 좌표(`screenX/Y`)이고, 어느 탭인지는 `pendingTear()` 가 들고 있다.
     */
    ontearout?: (screenX: number, screenY: number) => Promise<boolean> | void;
    /**
     * 창 **밖**에 놓았는데 창을 넘기지 못한 드래그가 끝났다(`ontearstart` 가 `null` 이었다) — 거절 사유가
     * 저장 안 한 문서면 상위가 한 줄 알린다(docs/log/2026-09-27-doc-edit.md "F2").
     */
    ontearrefused?: () => void;
    /**
     * **다른 창에서 온 탭·타일**을 이 창의 탭 바에 놓았다 = 창 → 탭 **합치기**.
     * `beforeId` 앞에 (null 이면 맨 뒤에) 꽂는다 — 순서 규칙은 재배치와 같다.
     *
     * 원본이 탭이든 타일이든 **같은 콜백**이다. 사서함에 실리는 짐의 모양이 언제나
     * "탭 한 개" 라서 그렇다 — 타일 티어아웃은 그 타일만 담은 임시 탭을 지어 싣는다
     * (docs/log/2026-09-04-pane-tear-out.md).
     */
    ontearmerge?: (token: number, beforeId: string | null) => void;
    /**
     * **동시 입력이 켜져 있는 탭들**의 탭 id
     * (docs/log/2026-09-05-titlebar-cleanup.md).
     *
     * 예전에는 이 값이 `syncOn: boolean` — **활성 탭 하나**의 상태였다. 토글이 타이틀바의
     * ⇶ 버튼이었으니 그것으로 충분했지만, 토글이 **탭 우클릭 메뉴**로 내려간 지금은
     * 대상이 "활성 탭" 이 아니라 "가리킨 탭" 이라 집합이어야 한다. 탭에 붙는 작은 표식도
     * 같은 값을 읽는다 — 안 보고 있는 탭이 동시 입력을 켠 채 남아 있는 상태가
     * 탭 바에서 그대로 읽혀야 하기 때문이다.
     */
    syncTabs?: ReadonlySet<string>;
    /** 그 탭의 동시 입력을 켜고 끈다 (탭 우클릭 메뉴 · Ctrl+Shift+I) */
    onsynctoggle?: (tabId: string) => void;
  } = $props();

  /**
   * 탭마다 **점 하나** — 에이전트 · 명령 · 활동을 우선순위로 접는다
   * (`$lib/tab-dot`, docs/log/2026-09-26-tab-single-dot.md). 말풍선은 사실 전부를 잇는다.
   */
  const dots = $derived.by(() => {
    const sources = {
      activeId,
      agents,
      status: tabStatus,
      bells: tabBells,
      activity: hasActivity,
      paneName: displayName,
    };
    return Object.fromEntries(tabs.map((tab) => [tab.id, tabDot(tabDotInput(tab, sources), t)]));
  });

  /** 저장 안 한 문서 타일을 품은 탭들 (docs/log/2026-09-27-doc-edit.md "F2") */
  const unsavedTabs = $derived.by(() => {
    const dirty = dirtyDocPanes();
    const out = new Set<string>();
    if (dirty.length === 0) return out;
    for (const tab of tabs) if (listPanes(tab.root).some((p) => dirty.includes(p.id))) out.add(tab.id);
    return out;
  });

  /**
   * 탭 아이콘은 **첫 패널** 기준이다 — 분할하면 종류가 섞일 수 있지만,
   * 탭이 "무엇으로 시작했는지" 가 목록에서 찾을 때 가장 쓸모 있는 단서다.
   * 예외 하나: 이긴 표식이 에이전트면 그동안 **그 에이전트의 타일**을 그린다(`tabIconPane` —
   * docs/log/2026-11-03-tab-status-glyphs.md) — 권한을 묻는 것이 누구인지 로고가 말한다.
   *
   * 앞자리 그림은 `PaneIcon` 이 그린다 (타일 헤더·상태바와 **같은 답**). 종류를 한 글자로
   * 말하던 예전의 `kindGlyph`(⇄ / ⚙ / ▸)는 "SSH 인가 아닌가" 까지밖에 말하지 못해,
   * 서로 다른 셸 다섯 개가 전부 같은 ▸ 로 섰다. (그 글자 기호의 마지막 둘 — 설정 `⚙` ·
   * 시작 `▸` — 도 2026-09-15 에 `PaneIcon` 안에서 Lucide 로 옮겼다.)
   * 고르는 곳은 `tabIconPane`(`TabStatusGlyph.svelte` — 접힌 탭 목록과 같은 답).
   */

  // 탭 툴팁은 **탭에 찍힌 이름 그대로**(`displayTabTitle`)다 — 폭이 고정이라 긴 이름이
  // ellipsis 로 잘릴 때 전체를 보는 자리다. 타일 목록·종류·"더블클릭하면 이름 변경" 안내를
  // 싣던 여러 줄 툴팁은 걷어 냈다 (사용자 결정, 2026-09-28).

  // -------------------------------------------------------------------------
  // 탭 이름 바꾸기 (docs/log/2026-09-03-workspaces-v1.md)
  //
  // 탭은 **이름을 붙일 수 있어야** 의미가 산다 — "web-01 · db-01 +2" 는 안에 뭐가
  // 들었는지는 말해 주지만 **왜 열었는지**는 말해 주지 않는다. "배포"·"장애 대응" 이 그 자리다.
  //
  // 진입점은 둘: 탭 제목 **더블클릭**(그 자리에서 인라인 입력) · **우클릭 메뉴**의 "이름 변경".
  // 더블클릭만 두면 아무도 못 찾고, 메뉴만 두면 손이 두 번 간다.
  //
  // ## 드래그와 부딪히지 않게
  //
  // 탭 전체가 드래그 손잡이(`draggable`)라, 그 안에 입력칸이 뜨면 텍스트를 끌어 선택하려는
  // 순간 탭이 끌려간다 (그리고 브라우저에 따라 캐럿 자체가 안 선다). 그래서 **이름을 고치는
  // 동안 그 탭만 `draggable=false`** 로 내리고, 입력칸의 포인터·드래그 이벤트는 위로
  // 올려보내지 않는다. 시작이 `dblclick` 뿐인 것도 같은 이유다 — mousedown 에서 시작하면
  // 드래그와 구분할 방법이 없다.
  // -------------------------------------------------------------------------

  /** 지금 이름을 고치고 있는 탭 id (`null` = 아무 것도 안 고치는 중) */
  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);

  function startRename(tab: TabSpec) {
    ctxTab = null;
    renaming = tab.id;
    // 이름이 없으면 **지금 보이는 제목**을 초깃값으로 준다 — 빈 칸에서 시작하면 "원래
    // 뭐였지" 를 다시 찾아야 하고, 대개는 그 제목을 조금 고치는 것으로 끝난다.
    renameValue = tab.name?.trim() || tabDisplayTitle(tab, t);
  }

  /**
   * 확정 — Enter, 그리고 **포커스가 빠질 때**.
   *
   * blur 로도 확정하는 이유: 이름을 치다가 터미널을 클릭한 사람의 뜻은 "취소" 가 아니라
   * "이만하면 됐다" 다. 진짜 취소는 Escape 하나이고, Escape 는 `renaming` 을 먼저 비우므로
   * 뒤따라 오는 blur 는 여기서 조용히 빠진다.
   */
  function commitRename() {
    const id = renaming;
    if (id === null) return;
    renaming = null;
    onrename?.(id, renameValue.trim());
  }

  /** 취소 — 값을 버리고 원래 제목으로 돌아간다 */
  function cancelRename() {
    renaming = null;
  }

  function onRenameKey(ev: KeyboardEvent) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      commitRename();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      // 창 전역 Escape(모달 닫기 · 우클릭 메뉴 닫기)까지 가지 않게 여기서 끊는다.
      ev.stopPropagation();
      cancelRename();
    }
  }

  // 입력칸이 뜨면 곧바로 포커스 + 전체 선택 (한 번에 갈아 치우는 것이 가장 흔한 쓰임이다)
  $effect(() => {
    if (renaming === null) return;
    renameInput?.focus();
    renameInput?.select();
  });

  // -------------------------------------------------------------------------
  // 탭 우클릭 메뉴 — "이름 변경" · "닫기" 둘뿐이다.
  //
  // 스트립이 `overflow-x: auto` 라 절대배치 메뉴는 잘리므로 `position: fixed` 에 화면 좌표를
  // 넣는다 (예전 `+` 드롭다운이 쓰던 처방 — 그 메뉴는 2026-09-25 에 걷었다).
  // -------------------------------------------------------------------------

  /** 우클릭 메뉴가 걸려 있는 탭 id (`null` = 닫혀 있다) */
  let ctxTab = $state<string | null>(null);
  let ctxLeft = $state(0);
  let ctxTop = $state(0);
  let ctxEl = $state<HTMLElement | null>(null);

  function openTabMenu(ev: MouseEvent, tab: TabSpec) {
    ev.preventDefault();
    ctxTab = tab.id;
    ctxLeft = Math.max(8, Math.min(ev.clientX, window.innerWidth - MENU_WIDTH - 8));
    ctxTop = ev.clientY;
  }

  /** 메뉴가 가리키는 탭 (그 사이 닫혔으면 `null` — 메뉴도 함께 닫는다) */
  const ctxTarget = $derived(ctxTab === null ? null : (tabs.find((t) => t.id === ctxTab) ?? null));

  /**
   * 우클릭 메뉴 항목 공통 — **대상 id 를 먼저 뜬 뒤** 닫고 위임한다
   * (`docs/conventions.md` · `PaneHost` 의 `runTileMenu` 와 같은 규칙).
   * `ctxTarget` 은 `ctxTab` 에서 파생된 값이라 닫는 순간 `null` 이 된다 — 항목이 늘 때마다
   * 이 세 줄을 다시 적으면 언젠가 한 곳에서 순서가 뒤집힌다. 통로는 이 탭 바에 하나뿐이고,
   * 순서 자체는 `$lib/browser/menu-runner` 의 [`runOnMenu`] 한 구현이 들고 있다.
   */
  function runTabMenu(fn: (tabId: string) => void) {
    runOnMenu(() => ctxTab, () => (ctxTab = null), fn);
  }

  /** 이 탭의 동시 입력이 켜져 있는가 (탭 표식 · 우클릭 메뉴의 ✓ 가 함께 읽는다) */
  const syncing = (tabId: string) => syncTabs?.has(tabId) ?? false;

  // -------------------------------------------------------------------------
  // 탭 드래그 (docs/log/2026-09-02-pane-host.md)
  //
  // 상태 · 스냅숏 · 미리보기 · 머무름 시계 · 창 분리 대기 · 스트립 리스너는 `$lib/tabbar/tab-drag.svelte.ts` 의
  // `createTabDrag`(2026-10-27 분할 5차) — 여기서는 하나 만들고(값 · 프롭은 게터로) 효과 넷(목록 변경 정리 `$effect.pre` ·
  // 머무름 시계 거두기 · 목록에서 빠진 탭 정리 `$effect.pre` · 스트립 리스너 등록)이 원래 자리 · 원래 순서로 그 메서드를 부른다.
  // -------------------------------------------------------------------------

  let strip = $state<HTMLDivElement | null>(null);

  const drag = createTabDrag({
    get tabs() {
      return tabs;
    },
    get activeId() {
      return activeId;
    },
    get strip() {
      return strip;
    },
    get ondragselect() {
      return ondragselect;
    },
    get onreorder() {
      return onreorder;
    },
    get onpromotepane() {
      return onpromotepane;
    },
    get ondrophosts() {
      return ondrophosts;
    },
    get ontearstart() {
      return ontearstart;
    },
    get ontearout() {
      return ontearout;
    },
    get ontearrefused() {
      return ontearrefused;
    },
    get ontearmerge() {
      return ontearmerge;
    },
  });

  // 새 탭은 폭 0 에서 펼쳐지며 들어온다. 이어지는 목록에 **덧붙은** 탭만이다 — 처음 그릴 때와
  // 워크스페이스 전환(남는 탭이 하나도 없다)에는 줄 전체가 한꺼번에 펼쳐지지 않게 그대로 둔다.
  // 빈 줄의 첫 탭은 같은 워크스페이스에서 하나만 생겼을 때 펼친다(탭 목록과 워크스페이스 id 는 한 갱신에 함께 바뀐다).
  let knownTabIds: Set<string> | null = null;
  let knownWorkspace: string | null = null;
  let enteringTabs = $state<Record<string, true>>({});
  let quietLeave = true;
  let leavingDragged: string | null = null;
  $effect.pre(() => {
    const ids = new Set(tabs.map((tab) => tab.id));
    const workspace = currentWorkspaceId();
    const known = knownTabIds;
    if (known !== null && ids.size === known.size && [...ids].every((id) => known.has(id))) {
      knownWorkspace = workspace; // 빈 워크스페이스끼리 옮겨 다닌 것도 따라간다
      return;
    }
    const continued = known !== null && ([...known].some((id) => ids.has(id)) ||
      (known.size === 0 && ids.size === 1 && workspace === knownWorkspace));
    // 닫힐 때는 반대로 접힌다 — 같은 워크스페이스 안에서 빠진 탭만. 끌어서 옮긴 탭은 이미 줄에서 빠져 있다.
    const dragged = drag.previewDraggedTab ?? draggingTab();
    quietLeave = known === null || workspace !== knownWorkspace;
    leavingDragged = dragged !== null && !ids.has(dragged) ? dragged : null;
    const fresh = continued && !prefersReducedMotion()
      ? [...ids].filter((id) => !known!.has(id))
      : [];
    // 펼쳐지던 중에 닫힌 탭은 animationend 가 오지 않는다 — 목록에서 사라진 표시는 여기서 걷는다.
    const kept = Object.keys(enteringTabs).filter((id) => ids.has(id));
    if (fresh.length > 0 || kept.length !== Object.keys(enteringTabs).length) {
      enteringTabs = Object.fromEntries([...kept, ...fresh].map((id) => [id, true]));
    }
    knownTabIds = ids;
    knownWorkspace = workspace;
  });

  function prefersReducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** 닫히는 탭 — 펼침의 반대로 폭 0 까지 접힌다. 이웃은 flex 배분으로 함께 당겨진다. */
  function tabLeave(node: HTMLElement, { id }: { id: string }): TransitionConfig {
    if (quietLeave || id === leavingDragged || prefersReducedMotion()) return { duration: 0 };
    const width = node.getBoundingClientRect().width;
    node.style.overflow = "hidden";
    node.style.pointerEvents = "none";
    // 접히는 동안은 탭이 아니다 — 드래그 스냅숏·커서 아래 탭·× 폭 얼리기가 이 칸을 세지 않는다.
    delete node.dataset.tab;
    node.dataset.leaving = "";
    return {
      duration: 180,
      easing: cubicOut,
      css: (t) => `max-width: ${t * width}px; min-width: 0; flex-basis: ${t * width}px; opacity: ${Math.min(1, t * 1.6)};`,
    };
  }

  function tabEntered(id: string) {
    if (!enteringTabs[id]) return;
    const { [id]: _, ...rest } = enteringTabs;
    enteringTabs = rest;
  }

  // 다른 경로로 탭을 골랐거나 닫았으면 남은 시계도 뜻을 잃는다.
  $effect(() => {
    drag.pruneHover();
  });

  // 캔버스 병합·창 넘기기는 목록 변경과 같은 틱에 이동량을 걷는다.
  $effect.pre(() => {
    drag.finishIfGone();
  });

  // 스트립 리스너 — 등록 · 해제(먼저 `clearTabDrag`)는 `drag.attach` 가 옮기기 전 순서 그대로 한다.
  $effect(() => {
    const el = strip;
    if (!el) return;
    return drag.attach(el);
  });

  // -------------------------------------------------------------------------
  // × 로 닫는 동안 폭 얼리기 (docs/log/2026-09-29-tab-width-shrink.md)
  //
  // 탭 폭은 CSS flex 가 정한다(창이 좁으면 모두 같이 준다). 그런데 줄어든 줄에서 × 를 눌러
  // 하나를 닫으면 남은 탭이 곧바로 넓어져, 커서 밑에 있던 다음 탭의 × 가 옆으로 달아난다.
  // 그래서 **마우스로 × 를 누르는 순간의 폭을 얼려** 두고(스트립의 인라인 `--tab-width` +
  // `.frozen` 의 `flex-shrink: 0`), 커서가 스트립을 떠나면 푼다 — Chrome 과 같은 규칙이다.
  // 그 밖의 폭 변화(새 탭 · 창 크기 · 단축키·메뉴로 닫기)는 얼리지 않고 곧바로 따른다.
  // -------------------------------------------------------------------------

  /** 얼린 탭 폭(px) — `null` 이면 평소대로 flex 가 나눈다 */
  let frozenWidth = $state<number | null>(null);

  function closeFromButton(ev: MouseEvent, tabId: string) {
    // 키보드(Enter·Space)로 누른 클릭은 `detail === 0` — 커서가 없으니 얼릴 까닭이 없다.
    if (ev.detail > 0 && strip) {
      // 기준은 **마지막 탭** — 두 모양 모두 칸 폭이 곧 `--tab-width` 다.
      // `[data-tab]` = 접히는 중(`data-leaving`)도 생략된(`.elided`) 칸도 아닌 탭
      const all = strip.querySelectorAll<HTMLElement>(".tab[data-tab]");
      const ref = all[all.length - 1];
      if (ref) frozenWidth = ref.getBoundingClientRect().width;
    }
    onclose(tabId);
  }

  // 커서가 스트립을 떠나면 푼다 — 마크업에 직접 달면 `<div>` 가 정적 요소 상호작용으로 잡혀
  // 드래그 이벤트들처럼 여기서 건다.
  $effect(() => {
    const el = strip;
    if (!el) return;
    const unfreeze = () => (frozenWidth = null);
    el.addEventListener("pointerleave", unfreeze);
    return () => el.removeEventListener("pointerleave", unfreeze);
  });

  // 탭이 **늘면** 얼림을 푼다 — 새 탭은 자리를 곧바로 나눠 받아야 한다(얼린 채면 넘쳐 스크롤된다).
  let lastTabCount = 0;
  $effect(() => {
    const n = tabs.length;
    if (n > lastTabCount) frozenWidth = null;
    lastTabCount = n;
  });

  // -------------------------------------------------------------------------
  // **생략** — 아이콘 폭까지 줄어도 넘치는 탭 (`$lib/tab-overflow`)
  //
  // 스트립은 스크롤되지 않는다(`overflow: clip`). 탭은 `--tab-min-width`(아이콘 한 칸)까지 같이 줄고,
  // 그래도 넘치면 뒤의 탭부터 그리지 않고(`.elided` = `display: none`, `data-tab` 도 뗀다 — 드래그
  // 스냅숏·얼리기가 세지 않게) `+` 옆의 `⌄N` 단추 목록으로 보낸다. 활성 탭은 늘 보인다.
  // 폭은 ResizeObserver 로 스트립만 잰다 — 계산은 순수 함수가 한다.
  // -------------------------------------------------------------------------

  /** `⌄N` 단추의 폭(간격 제외) — `.more` 의 CSS `width` 와 같은 값 */
  const MORE_WIDTH = 40;
  let tabFit = $state<TabFit>({ width: 0, slot: 0, reserve: 0, more: MORE_WIDTH });
  const elided = $derived(
    elidedTabIds(tabs.map((tab) => tab.id), activeId, tabCapacity(tabFit, tabs.length)),
  );
  const elidedTabs = $derived(tabs.filter((tab) => elided.has(tab.id)));
  /** 접힌 탭 중 봐야 할 것(상태 점·안 봄·벨)이 있으면 단추가 알린다 */
  const elidedAttention = $derived(
    elidedTabs.some((tab) => dots[tab.id] || tabBells[tab.id] ||
      tabHasUnseen({ active: false, agents: agents[tab.id] })),
  );

  function measureFit(el: HTMLDivElement) {
    const css = getComputedStyle(el);
    const gap = parseFloat(css.columnGap) || 0;
    const min = parseFloat(css.getPropertyValue("--tab-min-width")) || 0;
    const outer = (node: HTMLElement | null, base: number) => {
      if (!node) return 0;
      const s = getComputedStyle(node);
      return base + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0);
    };
    const plus = el.querySelector<HTMLElement>(".new");
    const drag = el.querySelector<HTMLElement>(".dragspace");
    const reserve =
      outer(plus, plus ? parseFloat(getComputedStyle(plus).width) || 0 : 0) +
      outer(drag, drag ? parseFloat(getComputedStyle(drag).minWidth) || 0 : 0) +
      2 * gap;
    tabFit = { width: el.clientWidth, slot: min + gap, reserve, more: MORE_WIDTH + gap };
  }

  $effect(() => {
    const el = strip;
    void tabStyle; // 모양이 바뀌면 다시 잰다 — 간격(`column-gap`)은 모양 규칙이 정한다
    if (!el) return;
    measureFit(el);
    const ro = new ResizeObserver(() => measureFit(el));
    ro.observe(el);
    return () => ro.disconnect();
  });

  let moreMenu = $state<{ right: number; top: number } | null>(null);
  let moreButton = $state<HTMLButtonElement | null>(null);
  let moreMenuEl = $state<HTMLElement | null>(null);

  function toggleMoreMenu() {
    if (moreMenu !== null) {
      moreMenu = null;
      return;
    }
    ctxTab = null;
    wsMenu = null;
    const r = moreButton?.getBoundingClientRect();
    if (!r) return;
    moreMenu = { right: Math.max(8, window.innerWidth - r.right), top: menuTop(r) };
    void tick().then(() => menuRows(moreMenuEl)[0]?.focus());
  }

  /**
   * 탭 줄 단추 아래 뜬 메뉴(워크스페이스 목록 · 접힌 탭 ⌄N)의 세로 자리 — **탭 줄의 아래 선에서 6px**(2026-10-18 MD3).
   * 단추 바닥 + 4px 이면 메뉴 윗변이 탭 줄 아래 선에 딱 붙어 단추 · 줄 · 메뉴가 한 덩어리(붙은 귀퉁이)로 읽혔다.
   */
  const MENU_DROP = 6;
  function menuTop(button: DOMRect): number {
    const bar = strip?.closest(".tabs")?.getBoundingClientRect();
    return Math.max(button.bottom + 4, (bar?.bottom ?? button.bottom) + MENU_DROP);
  }

  function closeMoreMenu(back = false) {
    moreMenu = null;
    if (back) moreButton?.focus();
  }

  // 접힌 탭이 다 사라지면(창을 넓혔다 · 닫았다) 목록도 닫는다
  $effect(() => {
    if (moreMenu !== null && elidedTabs.length === 0) moreMenu = null;
  });

  // -------------------------------------------------------------------------
  // `+` 버튼 — **새 탭 하나** (docs/log/2026-09-25-plus-vs-shell-menu.md)
  //
  // **자리로 가른다: 탭 바의 것은 탭을, 상태바의 것은 이 탭을 만진다.** 그래서 `+` 는 메뉴를
  // 열지 않고 곧장 새 탭(빈 탭 = launcher)을 연다 — `new-tab`(Ctrl+Shift+T)과 같은 몸통
  // (`onnewtab`)이다. 예전 `+` 메뉴가 고르던 "새 탭" 쪽 선택지(셸 · 레이아웃)는 전부 그
  // launcher 에 있고(최근 호스트 · 프로젝트까지), "이 탭에 열기" 쪽 셸 줄은 상태바 `>_` 칸의
  // 메뉴(`ShellMenu.svelte`)로 옮겼다 — 2026-10-18 부터는 독의 실행 단추 줄(`DockLaunch.svelte`)이다.
  //
  // 우클릭 폴백도 두지 않는다 — 버튼 하나에 뜻이 둘이면 자리로 가른 규칙이 다시 흐려진다.
  // (그 전의 이력: 2026-09-08 스플릿 버튼 → 단일 `+` 메뉴 · 2026-09-15 갈라진 줄과 옆목록 ·
  // 2026-09-25 펼침 애니메이션 — 애니메이션은 `ShellMenu` 가 물려받았다.)
  // -------------------------------------------------------------------------

  /** `+` 의 툴팁 — 조합은 레지스트리에서 낸다(사용자가 `new-tab` 을 바꾸면 따라간다 · 풀었으면 이름만) */
  const newTabTip = $derived.by(() => {
    const combo = effectiveCombo("new-tab", settings.current.keybindings);
    return shortcutTitle(t("app.tabs.new"), combo ? displayCombo(combo) : null);
  });

  /** 우클릭 메뉴 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡아 두는 데 쓴다 */
  const MENU_WIDTH = 220;

  /**
   * 바깥을 누르면 탭 우클릭 메뉴를 닫는다.
   * 항목 클릭은 메뉴 상자 안이라 여기서 걸리지 않는다 (pointerdown 이 click 보다 먼저다).
   */
  function onWindowPointerDown(ev: PointerEvent) {
    const target = ev.target;
    const node = target instanceof Node ? target : null;
    if (ctxTab !== null && !(node && ctxEl?.contains(node))) ctxTab = null;
    // 단추 자신은 비켜 간다 — 여기서 먼저 닫으면 뒤따르는 click 이 도로 연다(`data-chrome-toggle` 과 같은 경쟁)
    // 줄의 우클릭 메뉴는 제 상자 밖이면 닫고, 목록은 목록 · 단추 · 그 우클릭 메뉴 밖이어야 닫는다
    if (wsCtx !== null && !(node && wsCtxEl?.contains(node))) wsCtx = null;
    if (wsMenu !== null && !(node && (wsMenuEl?.contains(node) || wsButton?.contains(node) || wsCtxEl?.contains(node)))) wsMenu = null;
    if (moreMenu !== null && !(node && (moreMenuEl?.contains(node) || moreButton?.contains(node)))) moreMenu = null;
  }

  /** Escape 로 탭 우클릭 메뉴 · 접힌 탭 목록 · 워크스페이스 목록을 닫는다 — **캡처 단계**(터미널 포커스에서도 메뉴만 닫는다 · IME
   *  조합 중이어도 열린 메뉴는 닫는다 — 조합 글자 취소는 입력기 몫, `menuEscape`). 워크스페이스 목록 · 그 줄 메뉴 안의 Escape 와
   *  끌기 중 Escape 는 제 처리가 받는다(포커스가 목록 밖 — 터미널 — 일 때만 여기서 닫는다 · 포커스는 옮기지 않는다) */
  function onWindowKeydown(ev: KeyboardEvent) {
    const close = menuEscape(ev, {
      ctx: ctxTab !== null,
      more: moreMenu !== null,
      moreEl: moreMenuEl,
      ws: wsMenu !== null && wsDrag === null,
      wsEls: [wsMenuEl, wsCtxEl],
    });
    if (!close.ctx && !close.more && !close.ws) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (close.ctx) ctxTab = null;
    if (close.more) moreMenu = null;
    if (close.ws) closeWsMenu();
  }

  // -------------------------------------------------------------------------
  // **지금 워크스페이스 단추** — 탭 줄 맨 앞(2026-10-07 — 자리마다 할 일 나누기. 보조 창에만 있던 이름표
  // `.aux-workspace` 를 단추로 바꿔 주 창까지 넓혔다).
  //
  // 아이콘 + 이름(길면 줄임 · 전체는 툴팁) + ▾. 옆의 강조색 알약은 **다른 워크스페이스에서 기다리는 세션의 합**이다
  // (이 워크스페이스의 몫은 상태바 세션 칸이 말한다 — 둘을 더하면 이 창 전체). 수는 세션 목록 판 · 상태바 세션 칸과 같은 재료와
  // 묶음 규칙(`workspaceSheetBuckets` — 이 창의 탭 + 주 창이면 보조 창의 보고)이다. 보조 창은 다른 창의 보고를 받지
  // 않으므로 그 수는 늘 0 이다.
  //
  // 누르면 **워크스페이스 목록**(menu-runner 통로): 워크스페이스마다 아이콘 · 이름 · (있으면) 가장 급한 상태 배지(기다림 ·
  // 실패 · 도는 중) 또는 다른 창 ↗, 지금 것은 표시. 주 창이면 줄 우클릭 = 편집 · 삭제, 끌면 순서 바꾸기(아래 절). 고르면 그리로 간다(`openWorkspace` — 다른 창에 묶인 워크스페이스면 그 창으로, 보조 창이면 주 창에 청한다).
  // 끝에 "새 워크스페이스…"(주 창만 — 만들기는 주 창의 일이다), 맨 아래 힌트 한 줄(전환 · 찾기 단축키 — 지금 걸린
  // 조합을 레지스트리에서 읽는다. 둘 다 주 창의 키라 보조 창에서는 힌트를 접는다).
  //
  // 단추는 스트립(`.strip`) **밖**에 서므로 탭 폭 계산(얼리기 `frozenWidth` 는 마지막 탭의 실제 폭 · 드롭 미리보기는
  // 스트립의 화면 좌표)은 단추 폭을 이미 빼고 잰다 — 스트립이 남는 폭(`flex: 1; min-width: 0`)만 받는다.
  // -------------------------------------------------------------------------

  const wsCurrent = $derived(currentWorkspace());
  const wsBuckets = $derived(workspaceSheetBuckets(t, Date.now()));
  // 목록 줄의 배지 · 다른 창 ↗ (`wsBadge` · `wsAway`)는 `$lib/tabbar/WorkspacePicker.svelte`
  /** 다른 워크스페이스에서 기다리는 세션의 합 — 단추 옆 알약(0 이면 없다) */
  const wsOthersWaiting = $derived(
    [...wsBuckets].reduce((n, [id, b]) => n + (id === currentWorkspaceId() ? 0 : b.waiting.length), 0),
  );
  /** 단추의 툴팁 — 전체 이름 + 무엇을 하는가(+ 찾기 조합) + 알약의 뜻 */
  const wsTip = $derived.by(() => {
    if (!wsCurrent) return "";
    const find = isMainWindow ? comboText("switch-workspace") : null;
    const head = `${wsCurrent.name} — ${shortcutTitle(t("app.workspaces.button"), find)}`;
    return wsOthersWaiting > 0 ? `${head}\n${t("app.workspaces.othersWaiting", { n: wsOthersWaiting })}` : head;
  });
  /** 지금 걸린 조합의 표시 글자 — 풀었으면 `null` */
  function comboText(action: string): string | null {
    const combo = effectiveCombo(action, settings.current.keybindings);
    return combo ? displayCombo(combo) : null;
  }

  let wsMenu = $state<{ left: number; top: number } | null>(null);
  let wsButton = $state<HTMLButtonElement | null>(null);
  let wsMenuEl = $state<HTMLElement | null>(null);

  /** 목록을 연다 — 단추 바로 아래. 키보드가 닿게 지금 워크스페이스 줄(없으면 첫 줄)에 포커스를 둔다 */
  function toggleWsMenu() {
    if (wsMenu !== null) {
      wsMenu = null;
      return;
    }
    ctxTab = null;
    moreMenu = null;
    const r = wsButton?.getBoundingClientRect();
    if (!r) return;
    wsMenu = { left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)), top: menuTop(r) };
    void tick().then(() => {
      const rows = wsMenuRows();
      (rows.find((row) => row.getAttribute("aria-checked") === "true") ?? rows[0])?.focus();
    });
  }

  /** 목록을 닫는다 — Escape 로 닫았으면 포커스를 단추로 돌려준다. 줄의 우클릭 메뉴도 함께 닫는다 */
  function closeWsMenu(back = false) {
    wsMenu = null;
    wsCtx = null;
    if (back) wsButton?.focus();
  }

  /** 줄을 골랐다 — 끌어 놓은 손짓 뒤에 따라오는 클릭 하나는 무시한다(아래 끌기 절) */
  function pickWsRow(id: string) {
    if (wsDrag || performance.now() - wsDragEndedAt < 250) return;
    runOnMenu(() => id, () => closeWsMenu(), openWorkspace);
  }

  // -------------------------------------------------------------------------
  // 줄의 **우클릭 메뉴**(편집… · 삭제…)와 **끌어서 순서 바꾸기** — 하단 독의 워크스페이스 칸에 있던 것을 이 목록으로 옮겼다
  // (2026-10-13 — 독 칸은 즐겨찾기가 물려받았다). 관리(편집 · 삭제 · 순서)는 주 창만 한다(`workspace-actions` 의 guard ·
  // `workspaceMainWindow` 와 같은 범위 — 보조 창에서는 우클릭 메뉴가 뜨지 않고 끌어도 순서가 바뀌지 않는다).
  //
  // 우클릭 메뉴는 목록 **밖**의 형제 상자다 — 목록의 키 처리(`onListMenuKey`)가 메뉴의 ↑↓ · Escape 를 먹지 않게. 항목은
  // menu-runner 통로(스냅샷 → 닫기 → 실행)를 지나고, 닫기는 목록까지 함께 닫는다(편집 · 삭제는 대화 상자를 띄운다).
  // 줄 위의 키: 메뉴 키 · `Shift+F10` = 우클릭 메뉴, `F2` = 편집(옛 독 칸과 같은 키).
  // -------------------------------------------------------------------------

  let wsCtx = $state<{ id: string; x: number; y: number } | null>(null);
  let wsCtxEl = $state<HTMLElement | null>(null);
  // 목록이 어느 길로든 닫히면(단추 다시 누름 · 접힌 탭 목록 열기 …) 그 줄의 우클릭 메뉴도 남지 않는다
  $effect(() => {
    if (wsMenu === null) wsCtx = null;
  });

  // 줄의 우클릭 메뉴 열기 · 닫기 · 항목 · 줄 위의 키(`openWsCtx` · `closeWsCtx` · `onWsCtx` · `wsRowKeydown` · `onWsCtxKey`)는
  // `$lib/tabbar/WorkspacePicker.svelte` — 메뉴 상태(`wsCtx`)는 여기

  // 끌기는 포인터로만 한다(옛 독 칸과 같은 몸짓). 문턱(5px) 전에는 클릭(전환)을 그대로 두고, 삽입 위치는 "이 줄 앞 / 맨 뒤"
  // 계약 — 줄의 세로 가운데로 앞뒤를 가른다(`workspaceDropBefore`). 미리보기와 저장이 같은 순수 함수(`reorderWorkspaceIds` →
  // `reorderWorkspaces`)를 지난다. `Esc` 는 끌기만 취소한다(목록은 남는다).
  let wsDrag = $state<{ id: string; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  let wsDropBefore = $state<string | null>(null);
  let wsDropEnd = $state(false);
  let wsDragEndedAt = -Infinity;

  $effect(() => {
    const el = wsMenuEl;
    if (!el || !workspaceMainWindow()) return;
    const clear = () => { wsDropBefore = null; wsDropEnd = false; };
    const finish = () => {
      const drag = wsDrag;
      if (drag?.moved) wsDragEndedAt = performance.now();
      wsDrag = null;
      if (drag && el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
      clear();
    };
    const target = (x: number, y: number): string | null | undefined => {
      const rect = el.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return undefined;
      const rows = [...el.querySelectorAll<HTMLElement>("[data-workspace-option]")].map((row) => {
        const r = row.getBoundingClientRect();
        return { id: row.dataset.workspaceOption!, top: r.top, height: r.height };
      });
      return workspaceDropBefore(rows, y);
    };
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || wsDrag) return;
      const row = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-workspace-option]") : null;
      if (!row || !el.contains(row)) return;
      wsCtx = null;
      wsDrag = { id: row.dataset.workspaceOption!, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
    };
    const move = (ev: PointerEvent) => {
      const drag = wsDrag;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.max(Math.abs(ev.clientX - drag.x), Math.abs(ev.clientY - drag.y)) < 5) return;
      if (!drag.moved && ev.isTrusted) el.setPointerCapture(ev.pointerId);
      drag.moved = true;
      ev.preventDefault();
      const before = target(ev.clientX, ev.clientY);
      const ids = workspaceList().map((w) => w.id);
      const changed = before !== undefined && reorderWorkspaceIds(ids, drag.id, before) !== ids;
      wsDropBefore = changed && before !== null ? before ?? null : null;
      wsDropEnd = changed && before === null;
    };
    const up = (ev: PointerEvent) => {
      const drag = wsDrag;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const before = drag.moved ? target(ev.clientX, ev.clientY) : undefined;
      finish();
      if (before !== undefined) void reorderWorkspaces(drag.id, before);
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === wsDrag?.pointerId) finish(); };
    const escape = (ev: KeyboardEvent) => {
      if (ev.code !== "Escape" || !wsDrag) return;
      ev.preventDefault();
      ev.stopPropagation();
      wsDragEndedAt = performance.now();
      finish();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("lostpointercapture", cancel);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", finish);
    window.addEventListener("keydown", escape, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", finish);
      window.removeEventListener("keydown", escape, true);
      finish();
    };
  });

  // 목록 안의 키 · 줄 찾기(`menuRows` · `onListMenuKey`)는 `$lib/tabbar/tab-menu` — 접힌 탭 목록과 함께 쓴다
  const wsMenuRows = (): HTMLElement[] => menuRows(wsMenuEl);
</script>

<!--
  `dragend` 를 창에서도 듣는다 — **패널 드래그의 시작점은 이 컴포넌트 밖**(패널 헤더)이라
  스트립에 건 dragend 가 오지 않는다. 취소(Esc)로 끝난 드래그의 스냅숏·미리보기를 지우는 일이다.
-->
<svelte:window
  onpointerdown={onWindowPointerDown}
  onkeydowncapture={onWindowKeydown}
  ondragstart={drag.onWindowDragStart}
  ondragend={drag.finishTabDrag}
  onresize={() => (frozenWidth = null)}
/>

<!-- 루트의 끌기 속성 — 탭 줄 자신의 여백(탭 위 · 워크스페이스 단추 옆)도 창 손잡이다(속성 값 없음 = 이 상자를 직접 누를 때만) -->
<div class="tabs glass-band" role="tablist" data-tab-style={tabStyle} data-tauri-drag-region>
  <!-- 지금 워크스페이스 — 누르면 목록(스크립트의 "지금 워크스페이스 단추" 절). 워크스페이스가 없는 창(이관 실패)에는 없다 -->
  {#if wsCurrent}
    <button
      type="button"
      class="ws-button"
      data-workspace-button
      bind:this={wsButton}
      aria-haspopup="menu"
      aria-expanded={wsMenu !== null}
      title={wsTip}
      aria-label={wsTip.split("\n")[0]}
      onclick={toggleWsMenu}
    >
      <!-- 아이콘을 고른 워크스페이스만 그림을 붙인다 — 비었을 때의 머리글자는 바로 옆 이름의 첫 글자라
           "기 기본" 처럼 같은 글자를 두 번 읽혔다(2026-10-11 디자인 점검). 목록·전환기에서는 머리글자가 그대로 쓸모 있다 -->
      {#if wsCurrent.icon}<span class="ws-icon"><WorkspaceIcon workspace={wsCurrent} /></span>{/if}
      <span class="ws-name">{wsCurrent.name}</span>
      {#if wsOthersWaiting > 0}<span class="ws-pill" data-workspace-others-waiting aria-hidden="true">{wsOthersWaiting}</span>{/if}
    </button>
  {/if}
  <div
    class="strip"
    class:frozen={frozenWidth !== null}
    style:--tab-width={frozenWidth !== null ? `${frozenWidth}px` : undefined}
    bind:this={strip}
  >
    {#each tabs as tab (tab.id)}
      {@const lifted = drag.previewDraggedTab === tab.id && drag.followOffset !== null}
      {@const gone = drag.dragOutside && drag.previewDraggedTab === tab.id}
      {@const offset = lifted ? drag.followOffset : drag.dragOutside ? drag.collapsed.offsets[tab.id] : drag.preview.offsets[tab.id]}
      <!--
        탭 전체가 드래그 손잡이다 (`draggable`). 놓는 곳이 뜻을 정한다 —
        탭 바 안이면 순서 바꾸기, 터미널 위면 그 패널 옆으로 병합.
        **이름을 고치는 동안만 손잡이를 내린다** (입력칸에서 글자를 끌어 선택할 수 있게).
      -->
      <div
        class="tab"
        class:active={tab.id === activeId}
        class:drag-over={drag.hoverTab === tab.id}
        class:dragging={draggingTab() === tab.id}
        class:lifted
        class:gone
        class:entering={enteringTabs[tab.id] === true}
        class:elided={elided.has(tab.id)}
        out:tabLeave={{ id: tab.id }}
        onanimationend={(ev) => { if (ev.target === ev.currentTarget) tabEntered(tab.id); }}
        style:transform={gone ? `translateX(${offset ?? 0}px) scale(0.9)` : offset ? `translateX(${offset}px)` : undefined}
        style:transition={drag.dropCommitting ? "none" : undefined}
        style:z-index={draggingTab() === tab.id ? 4 : undefined}
        class:renaming={renaming === tab.id}
        class:unseen={tabHasUnseen({ active: tab.id === activeId, agents: agents[tab.id] })}
        data-tab={elided.has(tab.id) ? undefined : tab.id}
        draggable={renaming !== tab.id}
      >
        {#if renaming === tab.id}
          <!--
            인라인 이름 입력 — 탭 칸 안에서 제목 자리를 그대로 차지한다 (모달을 띄우면
            "이 칸의 이름" 이라는 감각이 끊긴다). Enter/blur 확정 · Escape 취소.
            포인터·드래그 이벤트는 위(탭 = 드래그 손잡이)로 올려보내지 않는다.
          -->
          <input
            class="rename"
            bind:this={renameInput}
            bind:value={renameValue}
            aria-label={t("app.tabs.rename.aria")}
            placeholder={t("app.tabs.rename.aria")}
            autocomplete="off"
            spellcheck="false"
            onkeydown={onRenameKey}
            onblur={commitRename}
            onpointerdown={(ev) => ev.stopPropagation()}
            ondragstart={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
            }}
          />
        {:else}
        <button
          type="button"
          class="label"
          role="tab"
          aria-selected={tab.id === activeId}
          title={displayTabTitle(tab)}
          onclick={(ev) => {
            // 에이전트 점 위의 클릭은 **그 타일로 가기**다 (탭 선택을 겸한다 — `focusTile`).
            // 점은 이 버튼 안의 글자일 뿐이라(버튼 안에 버튼을 둘 수 없다) 여기서 가른다.
            if (onagentdot && (ev.target as Element | null)?.closest?.("[data-agent-dot]")) {
              onagentdot(tab.id);
              return;
            }
            onselect(tab.id);
          }}
          ondblclick={() => startRename(tab)}
          oncontextmenu={(ev) => openTabMenu(ev, tab)}
        >
          <!--
            (2026-10-30 오케스트레이션 탭 ⑤ · 노트 5-2) 오케스트레이션 탭은 앞자리가 **이퀄라이저 막대** — 로고와 앨범 상태가 한 그림이다(홈 · 준비 중 =
            멈춘 로고 · 앨범 = 목록 요약의 맥박 `orch-pulse`). 첫 잎(프로듀서)의 AI 로고 대신이다. 오른쪽 끝의 상태 점(프로듀서 에이전트 등)은 그대로.
          -->
          <span class="kind">{#if tab.orch}<EqBars state={pulseOfRun(tab.orch.runId)} size={12} />{:else}<PaneIcon pane={tabIconPane(tab, dots[tab.id])} size={13} />{/if}</span>
          <!--
            사용자가 붙인 이름이 있으면 그것, 없으면 타일이 여럿일 때 그 이름들의 합성
            (`web-01 · db-01 +2`), 그 외에는 "탭 N". 폭 제한은 ellipsis 가 한다.
          -->
          <span class="title">{displayTabTitle(tab)}</span>
          {#if unsavedTabs.has(tab.id)}
            <!--
              **저장 안 한 변경** — 탭 안 문서 타일 중 하나라도(docs/log/2026-09-27-doc-edit.md "F2"). 제목 뒤의
              **글자 ●** 라 오른쪽 끝의 상태 점(동그란 칸 · 우선순위로 접히는 한 자리)과 자리를 다투지 않고, 활성
              탭에도 선다(잃을 수 있는 것은 보고 있어도 말한다).
            -->
            <span class="unsaved" title={t("app.tabs.unsaved")} aria-label={t("app.tabs.unsaved")}>●</span>
          {/if}
          {#if syncing(tab.id)}
            <!--
              **동시 입력 켜짐 표식** (docs/log/2026-09-05-titlebar-cleanup.md).

              토글이 타이틀바의 ⇶ 버튼에서 이 탭의 우클릭 메뉴로 내려가면서, 켜져 있다는
              사실이 보이는 자리도 함께 옮겨야 했다 — 메뉴는 열어야 보이므로 그것만으로는
              "켠 줄 모르고 치는" 순간을 막지 못한다. 그래서 **활성/비활성을 가리지 않고**
              늘 뜬다 (위의 활동 점과 다른 점이다): 안 보고 있는 탭이 켜 둔 채로
              남아 있는 상태야말로 탭 바에서 읽혀야 하는 상태다.

              색은 경고색 — 패널 테두리·본문 배너와 **같은 말**을 같은 색으로 한다.
            -->
            <span class="syncmark" title={t("app.tabs.sync.on")} aria-label={t("app.tabs.sync.on")}>
              <UiIcon name="sync" size={13} />
            </span>
          {/if}
          {#if dots[tab.id]}
            <!--
              **상태 표식 하나** — 에이전트 · 명령 · 벨 · 활동 중 이긴 것의 글리프(docs/log/2026-11-03-tab-status-glyphs.md —
              한 자리에 하나는 docs/log/2026-09-26-tab-single-dot.md 그대로). 에이전트 상태는 활성 탭에도, 명령 · 벨 · 활동은
              안 보는 탭에만 사실로 친다(`tabDot`). 이긴 것이 에이전트면 `data-agent-dot` 이 붙어 누르면 그 상태의
              첫 AI 타일로 간다(버튼의 `onclick`) — 그 밖은 평범한 탭 클릭이다. × 바로 왼쪽의 한 자리다.
            -->
            <TabStatusGlyph dot={dots[tab.id]!} />
          {/if}
        </button>
        {/if}
        <button
          type="button"
          class="close"
          aria-label={t("app.tabs.close.aria", { name: displayTabTitle(tab) })}
          title={t("app.tabs.close")}
          onclick={(ev) => closeFromButton(ev, tab.id)}
          ><UiIcon name="close" size={13} /></button
        >
      </div>
    {/each}
    {#if drag.preview.ghost !== null}
      <div
        class="drop-ghost"
        style:left={`${drag.preview.ghost.left - (drag.dropSnapshot?.items.length ? drag.dropSnapshot.left : 0)}px`}
        style:top={`${drag.preview.ghost.top - (drag.dropSnapshot?.items.length ? drag.dropSnapshot.top : 0)}px`}
        style:width={`${drag.preview.ghost.width}px`}
        style:height={`${drag.preview.ghost.height}px`}
        aria-hidden="true"
      ></div>
    {/if}

    <!--
      `+` 는 **마지막 탭 바로 오른쪽**, 스트립 안이다 — 탭이 많아 스크롤되면 함께 밀린다.
      (오른쪽 끝 고정이면 탭과 멀어져 "여기 이어서 하나 더" 라는 뜻이 흐려진다.)

      **누르면 곧장 새 탭이다** — 메뉴는 없다 (docs/log/2026-09-25-plus-vs-shell-menu.md).
      탭 바의 것은 탭을 만든다: 빈 탭(launcher)이 뜨고, 무엇을 열지는 거기서 고른다.
      지금 탭 안에 셸을 여는 것은 상태바 `>_` 칸의 몫이다.
    -->
    <button
      type="button"
      class="new"
      style:transform={drag.collapsed.newTabOffset ? `translateX(${drag.collapsed.newTabOffset}px)` : undefined}
      style:transition={drag.dropCommitting ? "none" : undefined}
      title={newTabTip}
      aria-label={newTabTip}
      onclick={() => onnewtab()}><UiIcon name="plus" size={14} /></button
    >

    <!--
      접힌 탭 목록 단추 — 아이콘 폭까지 줄어도 넘칠 때만 선다(스크립트의 "생략" 절). `+` **뒤**인 까닭:
      탭을 창 밖으로 끌면 `+` 가 왼쪽으로 당겨지는데(`collapsed.newTabOffset`), 앞에 있으면 그 위에 겹친다.
    -->
    {#if elidedTabs.length > 0}
      <button
        type="button"
        class="more"
        class:attention={elidedAttention}
        data-tabs-more
        bind:this={moreButton}
        aria-haspopup="menu"
        aria-expanded={moreMenu !== null}
        title={t("app.tabs.more", { n: elidedTabs.length })}
        aria-label={t("app.tabs.more", { n: elidedTabs.length })}
        onclick={toggleMoreMenu}
      >
        <span class="more-count">{elidedTabs.length}</span>
        <UiIcon name="chevron-down" size={12} />
      </button>
    {/if}

    <!--
      탭 뒤 빈 공간 = **창 드래그 손잡이**. 커스텀 타이틀바(decorations:false)라 이 띠를 잡고
      창을 옮긴다(더블클릭하면 최대화 — Tauri 가 처리). 탭·버튼은 이 속성이 없어 그대로 클릭된다.
    -->
    <div class="dragspace" data-tauri-drag-region>
      <!-- 개발 인스턴스 표식 — 릴리스 창과 나란히 떠도 가르게(`$lib/app/instance`). 끌기를 막지 않게 포인터를 통과시킨다 -->
      {#if DEV_INSTANCE}<span class="dev-mark" aria-label="dev">dev</span>{/if}
    </div>
  </div>

  <!--
    **타이틀바에는 세션 단위 버튼이 없다** (docs/log/2026-09-05-titlebar-cleanup.md).

    예전에는 여기 ◫ ⬓ ⇶ ⇉ ✎ 다섯이 서 있었다. 전부 **하나의 타일**(또는 그 타일의 세션)에
    거는 조작인데 자리는 탭의 줄이라, 누를 때마다 "지금 활성 타일이 어느 것이더라"
    를 먼저 떠올려야 했다 — 가리키는 몸짓 없이 "여기" 라고 말하는 버튼들이었다. 그래서
    분할·포워딩·원격 편집은 **타일 헤더의 ⋯ 메뉴**로 내려갔고(`PaneHost`), 탭
    단위인 동시 입력만 **탭 우클릭 메뉴**로 남았다. 이 줄에 남는 것은 탭 · `+` · 창 제어다.
  -->

  <WorkspacePicker
    {wsMenu}
    bind:wsCtx
    bind:wsMenuEl
    bind:wsCtxEl
    {wsBuckets}
    {wsDrag}
    {wsDropBefore}
    {wsDropEnd}
    {pickWsRow}
    {closeWsMenu}
  />

  <!-- 접힌 탭 목록 — 단추 아래 오른쪽 맞춤. 고르면 그 탭으로 간다(활성 탭은 늘 보이므로 줄에 다시 선다) -->
  {#if moreMenu}
    <TabOverflowMenu
      menu={moreMenu}
      {elidedTabs}
      {dots}
      {unsavedTabs}
      bind:el={moreMenuEl}
      onclose={closeMoreMenu}
      {onselect}
    />
  {/if}

  {#if ctxTarget}
    <TabContextMenu
      {ctxTarget}
      {ctxLeft}
      {ctxTop}
      {tabs}
      bind:el={ctxEl}
      {syncing}
      {startRename}
      {runTabMenu}
      {onsynctoggle}
      {onclose}
      {oncloseothers}
      {oncloseright}
    />
  {/if}
</div>

<style>
  /*
    지금 워크스페이스 단추 — 탭 줄 맨 앞(목업 6판의 `.wsbtn`). 탭 한 칸 높이(28px)에 맞춘 얇은 테두리 단추이고, 탭 줄의
    아래 여백(`.strip` 의 `padding-bottom`)만큼 떠서 탭과 같은 줄에 앉는다(flat 은 그 여백을 탭 칸 안으로 옮겨도 글자 자리가 같다). 이름은 길면 줄이고(전체는 툴팁), 옆 알약은
    다른 워크스페이스에서 기다리는 세션 수(강조색 — 사람이 답해야 풀린다).
  */
  .ws-button {
    flex: 0 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    height: var(--tab-h);
    min-width: 0;
    max-width: 200px;
    margin-bottom: var(--space-1);
    padding: 0 var(--space-3) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    /* **탭과 같은 모양**(2026-10-07 사용자 요청) — pill 은 비활성 탭처럼 테두리 없는 칸·호버 회색 판,
       목록이 열리면 활성 탭의 우물 면. flat 도 이 규칙 그대로다(판은 열 때 · 호버 때만 선다). */
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
    transition: background 140ms ease, border-color 140ms ease;
  }
  .ws-button:hover {
    background: var(--surface-hover);
  }
  /* 목록이 열린 동안 — MD3 secondaryContainer 판(테두리 없음). 예전의 우물 면 + 선은 메뉴와 이어 붙은 탭처럼 보였다 */
  .ws-button[aria-expanded="true"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }
  .ws-button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .ws-button :global(svg) {
    flex: none;
  }
  .ws-icon {
    flex: none;
    display: inline-flex;
    font-weight: var(--fw-semibold);
    line-height: 1;
  }
  .ws-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ws-pill {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 15px;
    color: var(--on-accent);
    background: var(--accent);
  }
  /* 워크스페이스 목록 · 줄의 우클릭 메뉴(`.ws-menu` · `.ws-row*` · `.ws-ctx-menu`)는 `$lib/tabbar/WorkspacePicker.svelte` */
  .tabs {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) 0;
    /* 재질 글래스면 옅은 띠 판 — 흐림은 `.glass-band` 의 `::before` (theme.css 재질 절) */
    background: var(--glass-band, var(--surface-raised));
    border-bottom: 1px solid var(--line);
    user-select: none;
  }

  .strip {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    /* 탭이 하나도 없어도 줄 높이는 탭 한 칸(28px)과 같다 — 있을 때와 없을 때가 같은 높이 */
    min-height: var(--tab-h);
    padding-bottom: var(--space-1);
    /* 스크롤하지 않는다 — 넘칠 탭은 접어 `⌄N` 목록으로 보낸다(스크립트의 "생략" 절). `clip` 은 `hidden` 과
       달리 스크롤 상자가 아니라 포커스·스크립트로도 밀리지 않는다 */
    overflow: clip;
  }

  /* 탭 뒤 빈 공간 = 창 드래그 손잡이 (data-tauri-drag-region). 남는 폭을 채워 잡을 자리를 준다 */
  .dragspace {
    flex: 1 1 auto;
    min-width: 24px;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: var(--space-2);
  }

  /* 개발 인스턴스 표식 — 작고 조용하게, 경고색 글자 하나. 끌기 손잡이를 가리지 않는다 */
  .dev-mark {
    pointer-events: none;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--warn);
    letter-spacing: 0.04em;
  }

  /*
    탭 = 둥근 알약. 비활성은 배경에 잠겨 있고, 활성은 채워져 한 겹 떠오른다.

    **폭은 제목과 무관하다** (`--tab-width`). 글자 수대로 늘었다 줄었다 하면
    탭을 하나 닫거나 이름을 고칠 때마다 나머지 탭이 전부 옆으로 밀려 "세 번째 칸" 이라는
    감각이 매번 깨진다. 넘치는 제목은 잘라 내고(ellipsis) 전체 제목은 툴팁이 말한다.

    **창이 좁으면 모두 같이 준다** (Chrome 식, docs/log/2026-09-29-tab-width-shrink.md) —
    `flex: 0 1 --tab-width` 라 자리가 모자라면 탭이 똑같은 비율로 `--tab-min-width`(아이콘 한 칸)까지 줄고
    (좁아지면 제목이 접혀 아이콘만 남는다 — 아래 `@container`), 그래도 넘치면 뒤의 탭부터 접혀(`.elided`)
    `⌄N` 목록으로 간다. 폭 배분은 flex 가 하고, JS 는 몇 칸을 그릴지만 정한다(`$lib/tab-overflow`).
    `container-type` 은 좁은 탭에서 × 를 접는 규칙(아래 `@container`)이 이 칸의 폭을 읽게 하려는 것이다.
  */
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 var(--tab-width);
    min-width: var(--tab-min-width);
    container-type: inline-size;
    /* 높이는 **칸이 정한다**(28px, 4px 격자) — 예전에는 라벨의 세로 여백이 정했고, 그래서 테두리를
       두르는 알약만 여백을 1px 씩 덜어 맞춰야 했다. border-box 라 세 모양의 바깥 크기가 같다. */
    height: var(--tab-h);
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    /* 폭(`flex-basis`)의 전이는 ×로 닫는 동안 얼려 둔 폭이 풀릴 때 다시 펴지는 움직임이다 —
       탭 수·창 폭으로 주는 것은 계산값이 아니라 flex 의 배분이라 전이 없이 곧바로 맞춰진다. */
    transition:
      background 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease,
      flex-basis 120ms ease,
      transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  /*
    **얼림** — × 로 닫는 동안 남은 탭이 다시 넓어지지 않는다(다음 × 가 커서 밑에 온다).
    폭은 스트립의 인라인 `--tab-width` 가 들고(스크립트의 `frozenWidth`), 여기서는 줄지 않게만 한다.
    얼리는 순간에는 전이를 걷는다 — 그대로 두면 기본 폭 → 얼린 폭으로 가는 120ms 동안 줄지 않는
    탭이 잠깐 넘쳐 스크롤이 튄다. 풀릴 때는 위의 기본 규칙이 전이를 다시 얹어 부드럽게 편다.
  */
  /* 선택자를 무겁게 둔 것은 모양 규칙(`.tabs[data-tab-style=…] .tab`)보다 늘 이기려는 것이다 */
  .tabs[data-tab-style] .strip.frozen .tab.tab {
    flex-shrink: 0;
    transition:
      background 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease,
      transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  /*
    좁은 탭에서는 **안 보는 탭의 × 를 접는다** (Chrome 과 같다) — 제목에 글자 몇 자를 더 주려는 것이다.
    활성 탭 · 손을 얹은 탭 · 키보드 포커스가 든 탭 · 이름을 고치는 탭에는 그대로 선다.
    문턱은 칸 폭 120px 이다.
  */
  @container (max-width: 119px) {
    .tab:not(.active):not(:hover):not(:focus-within):not(.renaming) .close {
      display: none;
    }
  }

  /* 넘쳐 접힌 탭 — 그리지 않는다(`⌄N` 목록에 있다) */
  .tab.elided {
    display: none;
  }

  /*
    **아이콘만** — 보이는 폭이 64px 아래면 제목·× 를 모두 접고 아이콘을 가운데 둔다(활성 탭도 —
    닫기는 우클릭 메뉴·단축키가 한다). 상태 점은 지우지 않고 아이콘 오른쪽 위 모서리로 옮긴다:
    접혀도 "가서 볼 탭" 은 읽혀야 한다.
    이름을 고치는 칸은 그대로 둔다(입력칸이 있어야 한다).
  */
  @container (max-width: 63px) {
    .tab:not(.renaming) .label {
      justify-content: center;
      padding: 0;
    }
    .tab:not(.renaming) :is(.title, .unsaved, .syncmark, .close),
    .tab:not(.renaming) :global(.subagents) {
      display: none;
    }
    .tab :global(.tab-glyph) {
      position: absolute;
      /* 12px 글리프 — 6px 점이던 때(5px)보다 모서리로 붙여 아이콘을 덜 가린다 */
      top: 3px;
      right: 3px;
    }
  }


  /*
    세 상태는 **면과 글자의 회색 계단**으로만 가른다 (작업면 단계 — docs/log/2026-09-25-work-surface.md).
    **비활성**은 바에 잠긴 글자(흐림 `--fg-3`)뿐, **호버**는 회색 판(`--surface-hover`)과 한 단
    밝은 글자, **활성**은 크롬의 우물 면(`--surface-field`)에 본문 글자 — 바(`--surface-raised`)보다 한 칸
    깊게 파여 "지금 이 칸" 이 읽힌다. 강조색 테두리·안쪽 그림자는 뺐다: 탭 바는 층 0 이라 조용해야
    하고, 강조색은 **권한 대기 · 에이전트 실행 중** 표식(`TabStatusGlyph`)에만 남는다.
    예전엔 활성 면이 타일 면(`--surface-tile` = 터미널 테마 바탕)이라 아래 타일과 한 장으로 이어졌는데,
    글자는 크롬 색이라 "라이트 크롬 + 어두운 터미널" 에서 검은 판에 검은 글자가 됐다 — 2026-10-01 사용자
    결정으로 크롬 면으로 옮겼다(docs/log/2026-10-01-field-surface.md). 기본 다크에선 우물 ≈ #121214 로 예전
    타일 면 #111113 과 거의 같다.
    활성 탭의 머리카락 선(`--line`)은 라이트 모드 때문이다 — 순백 바 위의 `#f8f8f7` 우물은 선
    없이는 안 보인다.
  */
  .tab {
    background: transparent;
  }

  /* HTML5 드래그 중 Chromium 은 :hover 를 갱신하지 않아, 머무는 탭에 같은 모양을 직접 준다. */
  .tab:hover,
  .tab.drag-over {
    background: var(--surface-hover);
  }

  .tab:hover .label,
  .tab.drag-over .label {
    color: var(--fg-2);
  }

  /* 재질 글래스면 흰 반투명 칠 · 흰 테두리(`--glass-pick` · `--glass-border` — theme.css 재질 절, 평면은 없어 우물 면 그대로) */
  .tab.active {
    background: var(--glass-pick, var(--surface-field));
    border-color: var(--glass-border, var(--line));
  }

  /*
    **끝남 · 안 봄** 이 있는 탭 — 면 전체를 옅은 강조색으로 (docs/log/2026-10-01-signal-grid.md). 점 하나(8px)만으로는
    탭 줄을 훑는 눈에 덜 걸려서, "가서 봐야 할 탭" 을 칸 크기로 말한다. 강조색은 테마마다 바뀌므로 토큰을 섞는다.
    활성 탭에는 붙지 않는다(이미 보고 있다 — `tabHasUnseen`). 호버는 평소대로 회색 판이 이긴다.
    flat 은 면을 깔지 않으므로 같은 뜻을 옅은 강조색 지시선으로 말한다(아래 모양 규칙).
  */
  .tab.unseen:not(:hover):not(.drag-over) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .tab.dragging {
    opacity: 0.6;
  }

  /* 새 탭 — 폭 0 에서 제자리까지 펼쳐진다. 이웃은 flex 배분으로 함께 밀려나고, 글자는 잘린 채 드러난다. */
  .tab.entering {
    overflow: hidden;
    animation: tab-unfold 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes tab-unfold {
    from {
      max-width: 0;
      min-width: 0;
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    to {
      max-width: var(--tab-width);
    }
  }

  /* 타일 캔버스와 같은 유리 판 — 빈 탭 한 칸에 옅은 막과 대각선 반사광만 얹는다. */
  .drop-ghost {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    border: 1px solid color-mix(in srgb, var(--fg) 22%, transparent);
    border-radius: var(--radius-sm);
    background:
      linear-gradient(135deg,
        color-mix(in srgb, white 14%, transparent),
        transparent 38%,
        transparent 62%,
        color-mix(in srgb, white 6%, transparent)),
      color-mix(in srgb, var(--tertiary) 7%, transparent); /* 유리 판의 옅은 물 — 장식이라 제3색 */
    backdrop-filter: blur(10px) saturate(140%);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .tabs[data-tab-style] .strip.strip .tab.tab.tab,
    .tabs .strip .new {
      transition: none;
    }

    .tabs .strip .tab.entering {
      animation: none;
    }
  }

  /* 탭 폭 안에서 × 를 뺀 나머지를 전부 먹는다 — 짧은 제목이어도 배지·× 자리는 고정이다 */
  .label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    align-self: stretch; /* 칸 높이 전체가 누르는 자리다 (높이는 `.tab` 이 정한다) */
    min-width: 0;
    overflow: hidden;
    padding: 0 var(--space-1) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-3);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  /* 호버 규칙(`.tab:hover .label`) **뒤에** 둔다 — 같은 무게라 나중 것이 이겨, 활성 탭은 손을
     얹어도 본문 글자 그대로다. */
  .tab.active .label {
    color: var(--fg-1);
  }

  /*
    탭 앞자리 아이콘의 칸 (`PaneIcon`). 폭 고정 탭이라 이 칸이 커진 만큼 제목이 줄지만,
    제목은 어차피 ellipsis 로 잘리는 값이고 "무슨 셸인가" 는 글자 세 자보다 그림 하나가 빠르다.
    `color` 는 로고가 아닌 것(설정·시작 타일의 `UiIcon`)이 `currentColor` 로 물려받는다 —
    예전에는 글자 글리프였고 `font-size` 도 함께 물려받았는데, 이제 크기는 `PaneIcon` 의
    `size` 프롭이 정한다 (2026-09-15).
  */
  .kind {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    /* 라벨 글자색을 그대로 입는다 — 강조색이던 것을 작업면 단계에서 뺐다(회색 아이콘).
       로고(셸·AI CLI)는 제 색이라 여기 영향을 받지 않는다. */
    color: inherit;
  }

  /*
    넘치는 제목은 여기서 잘린다 (전체 제목은 툴팁). 남는 폭을 다 먹는(`flex: 1`) 이유는
    **배지가 늘 × 바로 왼쪽**에 서게 하기 위해서다 — 제목 길이를 따라 배지가 좌우로
    움직이면 "무엇이 바뀌었나" 대신 "어디로 갔나" 를 먼저 읽게 된다.
    flex 자식은 기본 `min-width: auto` 라 글자 길이보다 작아지지 않는다 → 0 으로 내려야
    ellipsis 가 실제로 동작한다.
    **왼쪽 정렬**을 적어 둔다 — `.label` 은 `<button>` 이라 UA 기본값 `text-align: center` 를
    물려받아, 남는 폭을 다 먹는 이 칸 안에서 짧은 제목이 가운데에 떠 있었다
    (docs/log/2026-09-25-leftovers-menus-dots.md). 아이콘 바로 뒤에서 시작해야 탭을 훑는 눈이
    한 x 를 따라간다. 두 모양(pill · flat) 모두 이 칸을 쓴다.
  */
  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 저장 안 한 변경 ● — 제목 뒤 작은 글자(오른쪽 끝의 동그란 상태 점과는 모양도 자리도 다르다) */
  .unsaved {
    flex: 0 0 auto;
    font-size: 9px;
    line-height: 1;
    color: var(--accent);
  }

  /*
    인라인 이름 입력 — 제목(.label) 자리를 그대로 차지한다. 폭·여백·글자를 제목과 맞춰
    두면 확정하는 순간 글자가 튀지 않아 "그 자리를 고쳤다" 로 읽힌다.
  */
  .rename {
    flex: 1 1 auto;
    min-width: 0;
    width: auto; /* 고정 폭 탭 안에서 남는 자리를 그대로 쓴다 (모양별 여백 차이도 따라간다) */
    box-sizing: border-box;
    height: 20px;
    margin: 0 var(--space-1) 0 var(--space-2);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    /* 강조색 테두리 대신 강한 머리카락 선 — 입력칸임은 커서와 선이 말한다 */
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    outline: none;
  }

  /* 고치는 중인 칸은 활성 탭과 같은 무게로 떠 있게 (지금 손이 가 있는 자리다) */
  .tab.renaming {
    border-color: var(--line);
  }

  /* 고정 폭의 오른쪽 끝에 못 박는다 — 제목이 짧든 잘리든 × 는 늘 같은 자리다.
     안에 드는 것은 `UiIcon` 의 SVG 하나라(2026-09-15) flex 로 가운데를 잡는다 —
     `display: block` 인 SVG 는 버튼 안에서 저절로 서지 않는다. */
  .close {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    margin-left: auto;
    align-self: stretch;
    padding: 0 var(--space-2) 0 var(--space-1);
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .close:hover {
    color: var(--fg-1);
  }

  /* `+` = 새 탭 하나 — **고스트**(글자만, 호버에 회색 판 — `.btn-ghost` 의 말). 선 두른 상자는
     작업면 단계에서 뺐다. 탭 한 칸과 같은 28px 정사각형이라 줄 높이를 흔들지 않는다. */
  .new {
    flex: 0 0 auto; /* 탭이 줄어도 `+` 는 줄지 않는다 */
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--tab-h);
    height: var(--tab-h);
    margin-left: var(--space-1);
    padding: 0;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .new:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* `⌄N` — 접힌 탭 목록. `+` 와 같은 고스트 단추, 폭은 스크립트의 `MORE_WIDTH`(간격 빼고 40px)와 맞춘다 */
  .more {
    flex: 0 0 auto;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    box-sizing: border-box;
    width: 40px;
    height: var(--tab-h);
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .more:hover,
  .more[aria-expanded="true"] {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 접힌 탭 중 봐야 할 것이 있다 — 탭의 "안 봄" 면과 같은 옅은 강조색 */
  .more.attention:not(:hover) {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /* 접힌 탭 목록(`.more-menu`)의 자리 · 줄 배치는 `$lib/tabbar/TabOverflowMenu.svelte` */

  /* 제목 옆 상태 표식(점 · 글리프 · 서브 에이전트 수)의 모양은 `$lib/tabbar/TabStatusGlyph.svelte` */

  /*
    동시 입력 켜짐 표식 — 위의 상태 점과 **같은 자리**에 서지만 조건이 다르다:
    점은 안 보는 탭에만 뜨고 이것은 활성 탭에도 뜬다 (마크업 주석 참고).
    경고색은 패널 테두리·본문 배너와 같은 값이라 셋이 한 상태를 말하는 것으로 읽힌다.
  */
  .syncmark {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    line-height: 1;
    color: var(--warn);
  }

  /* 탭 우클릭 메뉴(`.menu.ctx`)의 자리는 `$lib/tabbar/TabContextMenu.svelte` */

  /* ═══════════════════════════════════════════════════════════════════════
     탭 바 모양 — pill(기본 — `DEFAULT_TAB_STYLE`, 위 바탕 규칙) · flat(아래).
     powerline 은 2026-10-01 에 뺐다(docs/log/2026-10-01-design-defaults.md).

     **순수 CSS 로만 그린다** — 글리프 폰트에 의존하지 않는다.
     모양만 바꾼다 — 드래그·순서·닫기·툴바 등 동작 요소는 그대로 얹혀 있고, 폭·간격도 pill 과
     같다(스크립트가 `column-gap` 을 읽어 쓰므로 간격을 바꾸면 그 계산도 따라간다).
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── flat: 판 없이 지시선으로 고른다 (MD3 기본 탭 — B안) ─────────── */

  /*
    판·테두리가 없다 — 고른 탭은 **탭 줄 아래 경계선에 붙은 3px 지시선**과 강조색 글자로, 손을 얹은 탭은 옅은
    상태층으로 가른다(2026-10-24 사용자 결정 — 목업 B안). 지시선이 경계선에 붙어야 하는 까닭: 탭 줄 아래에는
    8px 틈 뒤에 둥근 타일이 놓이고 띠는 월페이퍼가 비치는 글래스라, 경계선에서 떠 있는 밑줄은 어느 것에도 붙지
    않은 금으로 읽혀 눈에 걸리지 않았다(예전 2px 밑줄은 `.strip` 의 아래 여백만큼 4px 떠 있었다).

    **줄 높이는 pill 과 같다** — `.strip` 의 아래 여백(4px)을 걷고 그만큼 탭 칸을 32px 로 키운다. 칸의 늘어난
    4px 는 라벨 · × 의 아래 여백으로 받아 글자 · 아이콘의 세로 자리가 pill 과 같고(워크스페이스 단추 · `+` ·
    `⌄N` 과 한 줄), `+` · `⌄N` 은 늘어난 줄 가운데가 아니라 pill 과 같은 위 28px 칸에 둔다. 그래서 모양을 바꿔도
    아래 타일 영역은 1px 도 움직이지 않는다.

    선택자를 `.strip .tab` 으로 무겁게 둔 것은 위 바탕 규칙(`.tab.unseen:not(:hover)…` 0,4,0)까지
    이기려는 것이다. 들어 올린 탭(`.lifted.lifted`)은 더 무겁고 뒤에 있어 그대로 판을 얻는다.
  */
  .tabs[data-tab-style="flat"] .strip {
    min-height: 32px;
    padding-bottom: 0;
  }
  .tabs[data-tab-style="flat"] .strip .tab {
    height: 32px;
    background: transparent;
    border-color: transparent;
    border-radius: 0;
  }
  .tabs[data-tab-style="flat"] .label,
  .tabs[data-tab-style="flat"] .close {
    padding-bottom: var(--space-1);
  }
  .tabs[data-tab-style="flat"] .rename {
    margin-bottom: var(--space-1);
  }
  .tabs[data-tab-style="flat"] .strip :is(.new, .more) {
    align-self: flex-start;
  }

  /* 지시선 — 칸 아래 변(투명 테두리 1px 까지 내려 경계선 바로 위)에 위 모서리만 둥글게. 좌우를 들여 이웃 탭과 이어 보이지 않게 */
  .tabs[data-tab-style="flat"] .tab::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -1px;
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: transparent;
    pointer-events: none;
    transition: background 140ms ease;
  }

  .tabs[data-tab-style="flat"] .label {
    color: var(--fg-2);
  }

  /* 호버 · 드래그 머묾(비활성) — 옅은 상태층 + 본문 글자. 지시선은 긋지 않는다(고른 것과 헷갈린다) */
  .tabs[data-tab-style="flat"] .strip .tab:is(:hover, .drag-over):not(.active) {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border-radius: 6px 6px 0 0;
  }
  .tabs[data-tab-style="flat"] .tab:is(:hover, .drag-over) .label {
    color: var(--fg);
  }

  /* 완료(안 봄) — pill 이 면에 강조색을 섞는 것과 같은 말을 옅은 강조색 지시선으로. 호버가 이긴다 */
  .tabs[data-tab-style="flat"] .tab.unseen:not(:hover):not(.drag-over) .label {
    color: var(--fg);
  }
  .tabs[data-tab-style="flat"] .tab.unseen:not(:hover):not(.drag-over)::after {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  /*
    활성 — 강조색 지시선 + 강조색 글자(굵게). 강조색은 테마(라이트 · 다크 · 재질 글래스)에서 파생되므로 토큰 그대로 쓴다.
    앞 아이콘(`.kind`)은 글자색을 물려받아 함께 강조색이 되고(로고는 제 색), 상태 점 · 벨 고리 · 동시 입력 표식 · 서브 에이전트
    수는 제 색을 따로 적어 두어 뜻 색 그대로다. 굵기는 고정 폭 탭 안의 제목 말줄임만 바꾼다(칸 폭은 `--tab-width`).
    호버 규칙 **뒤에** 둔다 — 같은 무게라 활성 탭은 손을 얹어도 활성 모양 그대로다.
  */
  .tabs[data-tab-style="flat"] .tab.active .label {
    color: var(--accent);
    font-weight: var(--fw-semibold);
  }
  .tabs[data-tab-style="flat"] .tab.active::after {
    background: var(--accent);
  }

  /* 끄는 탭만 커서에 붙인다 — transform 전이를 빼고, 이탈의 줄어듦에는 따로 전이를 준다.
     얼린 폭·모양 규칙·안 봄 면보다 뒤에, 같은 무게 이상으로 둬 들어 올린 모양이 이긴다. */
  .tabs[data-tab-style] .strip .tab.lifted.lifted {
    transition: opacity 120ms ease;
    opacity: 1;
    z-index: 4;
    background: var(--surface-field);
    border-color: var(--line);
    box-shadow: 0 2px 6px rgb(0 0 0 / 18%);
    cursor: grabbing;
  }

  .tabs[data-tab-style] .tab.lifted .label,
  .tabs[data-tab-style] .tab.lifted .close {
    color: var(--fg-1);
    cursor: grabbing;
  }

  /* 자리를 차지한 채 숨긴다 — 뒤 탭과 + 의 이동량은 원래 배치에서 따로 계산한다. */
  .tabs[data-tab-style] .strip .tab.gone.gone {
    opacity: 0;
    transition: opacity 120ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  /* 키보드 포커스 — 중성 링(`--focus-ring`). 강조색이면 "골라진 것" 과 헷갈린다 */
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
