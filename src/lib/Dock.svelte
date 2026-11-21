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

  // 독 — 타일 위에 떠 있는 층 하나. 런처는 `[dock] layout` 쪽의 독, 설정은 가운데 모달이고 열린 표면은 하나다.
  // 본문들은 언마운트하지 않고 `hidden` 만 토글한다 — 들어간 폴더 · 검색어 · 보던 설정 섹션과 스크롤이 다음에 열 때도 그대로여야 한다
  // (`{#if}` 로 갈아 끼우면 설정 섹션의 지역 상태가 매번 날아간다 — `SettingsModal` 의 SECTIONS 주석과 같은 이유).

  let dockEl = $state<HTMLElement | null>(null);
  let tree = $state<ReturnType<typeof Sidebar> | undefined>();
  let projectList = $state<ReturnType<typeof ProjectList> | undefined>();
  let dbList = $state<ReturnType<typeof DbList> | undefined>();
  let alertsBody = $state<ReturnType<typeof DockAlerts> | undefined>();
  let launch = $state<ReturnType<typeof DockLaunch> | undefined>();
  let settingsBody = $state<ReturnType<typeof SettingsModal> | undefined>();

  const kind = $derived(dockKind());
  const dockRight = $derived(dockSides(settings.dockLayout).launcher === "right");

  /**
   * 그리는 데 쓰는 종류 — 닫히는 중이면 마지막으로 보이던 것. 닫힘 전이 동안 그림을 `kind` 로 고르면 빈 테두리만 미끄러진다
   * (docs/log/2026-09-25-dock-slide.md). 동작(포커스 · Escape · 설정의 `open`)은 `kind` 로 고른다.
   * `$effect` 가 아니라 `$derived` 라야 새 종류의 첫 프레임에 옛 본문이 비치지 않는다.
   */
  let last: DockKind = "alerts";
  const shown = $derived.by(() => {
    if (kind !== null) last = kind;
    return last;
  });
  const width = $derived(dockWidthOf(shown));

  const launcher = $derived(isLauncherKind(shown));

  const hints = $derived(isLauncherKind(shown) ? launcherSegment(shown).hints : []);

  function segmentTitle(action: string | null, labelKey: Key): string {
    if (action === null) return t(labelKey);
    const combo = effectiveCombo(action, settings.current.keybindings);
    return combo ? `${t(labelKey)} (${displayCombo(combo)})` : t(labelKey);
  }

  /** 칸 막대에서 화살표로 옮겼으면 포커스는 그 칸 단추에 머문다(WAI-ARIA 탭 목록) — 포커스 효과가 rAF 안에서 읽고 지운다 */
  let focusSegmentNext = false;

  function focusSearchOf(k: LauncherKind): void {
    if (k === "alerts") alertsBody?.focusList();
    else if (k === "hosts") tree?.focusSearch();
    else if (k === "projects") projectList?.focusSearch();
    else if (k === "db") dbList?.focusSearch();
  }

  /** 이미 그 칸이면 포커스 효과가 다시 돌지 않으니 검색 칸으로 직접 보낸다 */
  function pickSegment(k: LauncherKind): void {
    if (kind === k) focusSearchOf(k);
    else openDock(k);
  }

  /** 수식 키는 전역의 것이다 — `Ctrl+Tab` 은 탭 전환, `Ctrl+Alt+화살표` 는 타일 크기 조절 */
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

  /** `Sidebar` 의 "전체 열기 (타일)" 하나가 쓴다 — 탭이 없으면 빈 문자열이고 상위(`+page` 의 `onopenhosts`)가 탭 바 드랍 길로 보낸다 */
  const tab = $derived(activeTab());
  const tabId = $derived(tab?.id ?? "");
  const paneId = $derived(tab ? paneOf(tab) : "");

  onMount(() => {
    restoreDockWidths();
    // 캡처 단계라 아래 화면이 그 클릭을 처리하기 전에 판정한다
    window.addEventListener("pointerdown", onOutsidePointerDown, true);
    const offEdge = edgeHover.attach();
    return () => {
      window.removeEventListener("pointerdown", onOutsidePointerDown, true);
      offEdge();
    };
  });

  // ── 가장자리 호버로 열기 ── (규칙은 `$lib/dock`, 띠 · 시계 · 리스너는 `chrome/edge-dock.ts`)

  const edgeHover = createEdgeHover({
    side: () => (dockRight ? "right" : "left"),
    blocked: () => dockKind() !== null || anyModalOpen() || veilVisible() || mobileLayout(),
    open: () => revealLauncherDock(),
  });

  /** 반대쪽 끝의 띠는 채팅 독(`ChatDock.svelte`)의 것이다 */
  $effect(() => {
    void dockRight;
    edgeHover.forgetStrip();
  });

  /** 제목줄 높이가 바뀌면 띠의 위 끝도 바뀐다 */
  $effect(() => {
    const bar = document.querySelector(".titlebar");
    if (!bar) return;
    const ro = new ResizeObserver(edgeHover.forgetStrip);
    ro.observe(bar);
    return () => ro.disconnect();
  });

  /** 커서 아래에서 닫힌 독이 도로 열리지 않게 */
  $effect(() => {
    void kind;
    untrack(() => edgeHover.afterClose());
  });

  /**
   * 열리는 순간 키보드를 독 안으로. 설정은 어떤 칸에도 커서를 놓지 않는다 — 첫 입력칸에 주면 브라우저가 그 칸까지 패널을
   * 스크롤해 섹션 한가운데서 열린다. `hidden` 이 걷힌 다음 프레임에 부른다 — `display:none` 인 요소는 포커스를 받지 못한다.
   */
  $effect(() => {
    if (kind === null) return;
    const want = kind;
    const raf = requestAnimationFrame(() => {
      if (focusSegmentNext) {
        focusSegmentNext = false;
        dockEl?.querySelector<HTMLElement>(`[data-segment="${want}"]`)?.focus({ preventScroll: true });
        return;
      }
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
      if (want === "projects") {
        if (projectList) projectList.focusSearch();
        else dockEl?.focus({ preventScroll: true });
        return;
      }
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
   * 독 바깥 DOM 이지만 논리적으로는 독의 일부인 떠 있는 표면들 — 빼면 독이 연 폼 · 메뉴를 누르는 순간 독이 닫힌다.
   * 목록을 좁히지 않는다 — 섹션이 늘 때 여기를 같이 고쳐야 하는 규칙을 만들지 않으려는 것이다.
   */
  const FLOATING = ".overlay, .modal, .menu, .menu-backdrop, [role='dialog'], [role='menu']";

  /**
   * 마우스가 나가는 것으로는 닫지 않는다 — 그 방식은 드래그 도중 커서가 벗어나면 드래그 소스가 사라져 걷었다.
   * 드래그는 바깥에 pointerdown 을 내지 않으니 여러 개를 차례로 끌어다 놓는 동안 독이 열린 채 남는다.
   */
  function onOutsidePointerDown(ev: PointerEvent): void {
    if (dockKind() === null) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (dockEl?.contains(t)) return;
    if (t.closest(FLOATING)) return;
    // 스스로 토글하는 진입 버튼 — 여기서 미리 닫으면 이어지는 click 의 `toggleDock` 이 도로 연다
    if (t.closest("[data-chrome-toggle]")) return;
    if (anyModalOpen()) return; // 모달이 떠 있는 동안의 클릭은 그 모달의 것이다
    closeDock(false); // 누른 곳이 곧 갈 곳이다 — 옛 자리로 되돌리지 않는다
  }

  /**
   * 독 안에서 누른 키만 받는다. 단축키 기록 중이면 설정(`captureIfRecording`)에 먼저 묻는다 — 그 리스너는 창에 있어 독보다
   * 나중이라 기다리면 기록 취소 Escape 가 독을 먼저 닫는다. 삼키지 않은 Escape 는 전파를 끊어 창의 Escape 사슬(`keys.svelte.ts`)에 들지 않는다.
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
    // 한 겹씩 벗는다 — 셸 메뉴 → 독
    if (launcher && launch?.collapse(true)) return;
    closeDock();
  }

  // ── 머리 아이콘 줄 · 알림 칸 배지 · 알림 바닥 줄 ──

  /** 다음에 열 때 지난번 셸 메뉴가 떠 있지 않게 */
  $effect(() => {
    if (kind === null) untrack(() => launch?.collapse());
  });

  /** 원격 창에는 종료가 없다 — 메인 PC 사람의 결정이고 `app_end_all_sessions` 도 원격에서는 거절된다(`remote/deny.rs`) */
  const tools = $derived(DOCK_TOOLS.filter((tool) => tool.id !== "quit" || !isRemote));

  function toolTitle(tool: DockTool): string {
    const combo = tool.action ? effectiveCombo(tool.action, settings.current.keybindings) : null;
    return shortcutTitle(t(tool.labelKey), combo ? displayCombo(combo) : (tool.fixedCombo ?? null));
  }

  /**
   * 잠금 · 종료는 독을 먼저 닫는다(`runAfterClose`) — 종료의 확인 대화가 떠 있는 독 뒤에 숨지 않게.
   * 새로고침은 F5 와 같은 길 — 세션은 임대만 풀고 산다.
   */
  function runTool(id: DockTool["id"]): void {
    // 가림막이 걸리면 볼트도 함께 잠긴다 — 걷는 문은 가림막 위 관문 하나
    if (id === "lock") runAfterClose(() => closeDock(), () => runAction("toggle-veil"));
    else if (id === "reload") window.location.reload();
    else if (id === "settings" && mobileLayout()) runAfterClose(() => closeDock(), () => openMobileSettings());
    else if (id === "settings") openDock("settings");
    else runAfterClose(() => closeDock(), () => runAction("quit-app"));
  }

  /** 일반 알림은 세지 않는다 */
  const alertCount = $derived(pendingCount() + agentBannerBadge().count);
  /** 사람이 답해야 멈춘 일이 풀릴 때만 */
  const alertUrgent = $derived(pendingCount() > 0 || agentBannerBadge().urgent);

  const canReadAll = $derived(
    agentBannerItems().some((b) => b.kind !== "permission") || notificationList().some((e) => !e.read),
  );

  /** 권한 물음 · 승인 대기는 남는다 — 답해야 풀린다 */
  function readAll(): void {
    resolveFinishedBanners();
    markNotificationsRead();
  }

  /** `clearAlerts` 가 지우는 대상과 정확히 같아야 한다 */
  const canClear = $derived(notificationList().length > 0 || resolvedAgentBanners().length > 0);

  /** 누른 단추가 곧 흐려지므로 포커스는 목록 상자로 */
  function clearAlerts(): void {
    clearNotificationHistory();
    clearResolvedBanners();
    alertsBody?.focusList();
  }

  function openPlanHistory(): void {
    runAfterClose(
      () => closeDock(),
      () => {
        setPlansView("history");
        openPlans();
      },
    );
  }

  // ── 폭 손잡이 ── 포인터 캡처가 없으면 커서가 독 밖으로 나가는 순간 드래그가 끊긴다. 저장은 놓을 때 한 번

  let resizing = $state(false);

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

  <div class="launch-wrap" hidden={!launcher}>
    <DockLaunch bind:this={launch} onclose={() => closeDock()} />
  </div>

  <!-- 본문들이 `tabpanel` 이 아닌 것은 일부러다 — 탭 패널로 감싸면 스크린 리더가 그 안의 목록 이름을 가린다 -->
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

    <div class="body" hidden={shown !== "projects"}>
      <ProjectList bind:this={projectList} />
    </div>

    <div class="body" hidden={shown !== "db"}>
      <DbList bind:this={dbList} />
    </div>
  </div>


  <!-- 본문 스위치는 `shown` 이지만 `open` 은 `kind` — 마운트는 두고 닫히는 중에는 단축키 기록 · MCP 상태 읽기를 멈춘다 -->
  <div class="body" hidden={shown !== "settings"}>
    <SettingsModal
      bind:this={settingsBody}
      open={kind === "settings"}
      onclose={() => closeDock()}
    />
  </div>

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
   * `position: absolute` — 부모(`+page` 의 `.body`)가 이미 "타이틀바 아래" 상자라 탭 바 높이를 다시 셈하지 않는다(탭 모양마다 다르다).
   * z-index 100 — 타일 메뉴(20)보다 위, 팔레트 · 검색(110)보다 아래. 모달(`.overlay`, 같은 100)은 DOM 에서 뒤에 와 독을 덮는다.
   */
  .dock {
    position: absolute;
    top: var(--gap);
    bottom: calc(var(--gap) + var(--dock-inset-bottom, 0px));
    /* `--dock-inset-left` 는 `+page` 의 `.body` 가 왼쪽 상태바 기둥 폭으로 채운다 */
    left: calc(var(--gap) + var(--dock-inset-left, 0px));
    z-index: 100;
    box-sizing: border-box;
    width: var(--dock-w);
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* 글래스면 판은 이 상자 한 겹만 칠하고 안쪽 본문은 `--glass-inner`(투명)로 비운다 — 둘 다 칠하면 반투명이 겹쳐 진해진다 */
    background: var(--glass-mid, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    overflow: hidden;
  }
  .dock[data-dock-side="right"]:not(.settings-modal) {
    left: auto;
    right: calc(var(--gap) + var(--dock-inset-right, 0px));
  }

  /*
   * 여닫이 — 채팅 독과 같은 값(`theme.css` 의 "창 끝 독의 여닫이"). 닫는 쪽은 `display` 를 끝에 가서야 끄는 `allow-discrete` 가 맡는다.
   * 전이 목록에 `width` 를 넣지 않는다 — 폭 손잡이 드래그가 즉시 따라와야 한다.
   * 끝나면 `transform` 이 남지 않아야 한다 — 남으면 안쪽 `position: fixed` 메뉴 · 폼의 기준 상자가 독으로 바뀐다.
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

  /* `hidden` 은 UA 스타일이라 위의 `display: flex` 에 진다 — 명시적으로 이긴다 */
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
   * 설정 모달 등장 — 전이가 아니라 키프레임이다: 런처 독이 떠 있는 채 설정으로 갈아 끼우면 `hidden` 이 그대로라 전이의 출발점이 없다.
   * 채움(`fill`)을 두지 않는다 — 남은 `transform` 이 안쪽 `fixed` 팝오버의 기준 상자를 모달로 바꾼다. 닫힘은 즉시(배경막의 `{#if}` 와 맞춘다).
   */
  .dock.settings-modal:not([hidden]) {
    animation: settings-modal-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* 글래스는 상자의 `opacity` 를 움직이지 않는다 — 움직이는 동안에도 흐림이 서게 내용만 페이드(theme.css `glass-surface-in`) */
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
    outline: none;
  }

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

  .tool-btn.danger:hover,
  .tool-btn.danger:focus-visible {
    color: var(--err);
    background: var(--err-soft);
  }

  .launch-wrap {
    flex: 0 0 auto;
  }

  .card {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--glass-inner, transparent);
    overflow: hidden;
  }

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

  /* 줄 토큰(`--row-*`)은 이 면 안에서만 덮는다 — 파일 타일도 같은 토큰을 읽어 전역 값을 바꾸면 그쪽까지 끌려간다 */
  .dock.launcher {
    --dock-radius-tile: var(--radius-surface-inner);
    --dock-radius-btn: 999px;
    border-color: transparent;
    border-radius: var(--radius-surface);
    --row-font: var(--t-sm);
    --row-pad-y: 6px;
    --row-pad-x: var(--space-2);
    --row-inset: var(--space-2);
    --row-gap: var(--space-2);
  }

  /* 검색 줄 — 본문들이 같은 마크업(`.dock-search > label.dock-search-box > 아이콘 + input`)을 세우고 모양은 여기 한 벌(`:global`) */
  .dock.launcher :global(.dock-search) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3) var(--space-2);
  }

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
    border-radius: 999px;
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

  /* 넘치면 자른다 — 줄바꿈하면 목록 높이가 칸마다 흔들린다 */
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

  .foot-btn.icon {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-4) 0 var(--space-3);
  }

  /* 좁은 독에서도 한 줄 — 문턱(420 · 240)은 `DOCK_SLOT_SPEC.launcher` 의 최소 폭에서 글자 폭을 어림한 값이다. 최소 폭을 바꾸면 다시 잰다 */
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

  /* `.dock[hidden]` 과 같은 이유 — UA 스타일은 진다 */
  .card[hidden],
  .launch-wrap[hidden],
  .body[hidden] {
    display: none;
  }

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
