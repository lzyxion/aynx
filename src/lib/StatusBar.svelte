<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { displayCombo, effectiveCombo, type Overrides } from "$lib/keybindings";
  import { applyOrder, mergeCombos, reorder, shortcutTitle, type StatusItem } from "$lib/status-items";
  import { moveTarget } from "$lib/reorder-keys";
  import { setStatusOrder, statusOrder } from "$lib/status-order.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { StatusBarPosition, StatusBarStyle } from "$lib/settings.svelte.js";
  import { isLauncherKind, type DockKind } from "$lib/dock";
  import { barWidth, type UsageRing } from "$lib/agent-usage";
  import UsageHoverCard from "$lib/UsageHoverCard.svelte";
  import FloatingStatusDock from "$lib/FloatingStatusDock.svelte";
  import DockFavorites from "$lib/DockFavorites.svelte";
  import { dockPinned, setDockPinned } from "$lib/floating-dock-pin.svelte.js";
  import ResourceHoverCard from "$lib/ResourceHoverCard.svelte";
  import { resourceOutdated, resourcePulledAt, resourceRing, watchResources } from "$lib/app/resources.svelte.js";
  import { formatMemPair, lastSystemSample, resourceRings, type ResourceMetric, type ResourceRingValue } from "$lib/resource-status";
  import RemoteChip from "$lib/RemoteChip.svelte";
  import UpdateChip from "$lib/UpdateChip.svelte";
  import { slide } from "svelte/transition";
  import { keepAwakeOn } from "$lib/app/keep-awake.svelte.js";
  import { TOOLTIP_DELAY_MS, type TooltipRect } from "$lib/tooltip";
  import { hasUnreadNotifications } from "$lib/app/notifications.svelte.js";
  import { notifyBadgeText } from "$lib/notifications";

  /**
   * 가장자리 상태바 — 선두단(지금 서는 칸이 없다 · 순서 바꾸기 틀만 남았다) → 가운데 묶음(자원 · 사용량 고리) → 후미(원격 칩 · 알림 알약).
   * 알약은 단추 하나다 — ⚡ · ☕ 는 켜졌을 때만 펼쳐지는 표시일 뿐 따로 누를 수 없다.
   */
  let {
    position,
    barStyle = "flat",
    blocked = false,
    dockOpen,
    usageOpen = false,
    resourcesOpen = false,
    resources = true,
    pendingPlans = 0,
    agentAlerts = { count: 0, urgent: false },
    autoApprove = false,
    usageRings = [],
    keybindings = {},
    onalerts,
    onlauncher,
    onusage,
    onresources,
    onchat,
    chatDot = null,
    inline = false,
  }: {
    position: StatusBarPosition;
    /** 제목줄의 탭 뒤 · 창 단추 앞에 선다 — 28% 지점 규칙 · 선두단은 없고, 판 · 선 · 흐림은 탭 줄이 든다(`data-pos="inline"`) */
    inline?: boolean;
    /** `style` 이 아니다 — HTML `style` 속성 이름과 부딪히지 않게 */
    barStyle?: StatusBarStyle;
    /** 모달 · 가림막 동안 — 하단 가운데 즐겨찾기 독을 숨긴다 */
    blocked?: boolean;
    dockOpen: DockKind | null;
    usageOpen?: boolean;
    resourcesOpen?: boolean;
    /** 켜져 있는 동안 이 띠가 자원 표본의 보는 쪽이다(`watchResources`) */
    resources?: boolean;
    pendingPlans?: number;
    /** 일반 알림(긴 명령 · 전송 …)은 세지 않는다 */
    agentAlerts?: { count: number; urgent: boolean };
    autoApprove?: boolean;
    usageRings?: UsageRing[];
    onalerts: () => void;
    onlauncher?: () => void;
    /** 원격 폰 배치만 준다 — 데스크톱 폭은 채팅 독이 제 자리다 */
    onchat?: () => void;
    chatDot?: "permission" | "running" | "finished" | null;
    onusage?: () => void;
    onresources?: () => void;
    keybindings?: Overrides;
  } = $props();

  // ── 알림 알약 ──

  const alertsOpen = $derived(dockOpen === "alerts");

  const notifyCount = $derived(pendingPlans + agentAlerts.count);
  const notifyUrgent = $derived(pendingPlans > 0 || agentAlerts.urgent);

  const notifyUnread = $derived(hasUnreadNotifications());

  const notifyTip = $derived(
    `${t("app.statusbar.notify")} — ${
      notifyCount > 0
        ? t("app.statusbar.notify.counts", { pending: pendingPlans, agents: agentAlerts.count })
        : notifyUnread
          ? t("app.statusbar.notify.unread")
          : t("app.statusbar.notify.none")
    }`,
  );

  const chatTip = $derived(
    chatDot === "permission"
      ? `${t("app.chatDock.open")} — ${t("app.chatDock.permission")}`
      : chatDot === "finished"
        ? `${t("app.chatDock.open")} — ${t("app.chatDock.unseen")}`
        : chatDot === "running"
          ? `${t("app.chatDock.open")} — ${t("app.chatDock.running")}`
          : t("app.chatDock.open"),
  );

  const autoTip = $derived(t("app.statusbar.autoapprove"));
  const awakeTip = $derived(t("app.keepAwake.on"));

  /** ⚡ · ☕ 는 따로 초점을 받지 않는 표시라 알약의 접근성 이름에서 말한다 */
  const trayLabel = $derived(
    [notifyTip, autoApprove ? autoTip : null, keepAwakeOn() ? awakeTip : null].filter(Boolean).join(" · "),
  );

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const reveal = (node: Element) =>
    slide(node, { axis: vertical ? "y" : "x", duration: reducedMotion() ? 0 : 150 });

  const comboOf = (action: string) => {
    const combo = effectiveCombo(action, keybindings);
    return combo ? displayCombo(combo) : null;
  };

  const combosOf = (item: StatusItem) =>
    mergeCombos((item.tipActions ?? [item.action]).map(comboOf).filter((c): c is string => !!c));

  const launcherTip = $derived(shortcutTitle(t("app.dock.launcher.open"), comboOf("open-hosts-dock")));
  const vertical = $derived(position === "left" || position === "right");

  // ── 사용량 호버 카드 ──
  // 고리에는 `title` 을 달지 않는다 — 공용 말풍선은 `[title]` 을 집어 카드와 겹쳐 뜬다 (docs/log/2026-09-28-usage-hover-bars.md).
  let usageHover = $state<{ agent: string; rect: TooltipRect } | null>(null);
  let usageTimer: ReturnType<typeof setTimeout> | null = null;
  const hoveredRing = $derived(usageHover ? usageRings.find((r) => r.agent === usageHover!.agent) : undefined);

  function armUsageCard(el: HTMLElement, agent: string): void {
    hideUsageCard();
    usageTimer = setTimeout(() => {
      usageTimer = null;
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      usageHover = { agent, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }, TOOLTIP_DELAY_MS);
  }

  function hideUsageCard(): void {
    if (usageTimer !== null) {
      clearTimeout(usageTimer);
      usageTimer = null;
    }
    usageHover = null;
  }

  $effect(() => () => {
    if (usageTimer !== null) clearTimeout(usageTimer);
  });

  /** 창이 흔들리면 카드를 접는다 — 자리를 다시 재지 않는다 */
  function onWindowShake(): void {
    hideUsageCard();
    hideResourceCard();
  }

  // ── 자원 고리 ──
  // 숫자 = 이 PC 전체(작업 관리자와 같은 숫자 — 사용자 결정)
  $effect(() => {
    if (!resources) return;
    return watchResources();
  });

  const resRings = $derived(resources && !resourceOutdated() ? resourceRings(resourceRing(), resourcePulledAt()) : null);
  const resItems = $derived<ResourceRingValue[]>(resRings ? (resRings.mem ? [resRings.cpu, resRings.mem] : [resRings.cpu]) : []);

  function resAria(r: ResourceRingValue): string {
    const pct = `${Math.round(r.pct)}%`;
    if (r.metric === "cpu") return t("app.statusbar.resources.cpu", { pct });
    const sys = lastSystemSample(resourceRing())?.system;
    return t("app.statusbar.resources.mem", { pct, pair: sys ? formatMemPair(sys.memUsed, sys.memTotal) : "" });
  }

  let resHover = $state<{ metric: ResourceMetric; rect: TooltipRect } | null>(null);
  let resTimer: ReturnType<typeof setTimeout> | null = null;

  function armResourceCard(el: HTMLElement, metric: ResourceMetric): void {
    hideResourceCard();
    resTimer = setTimeout(() => {
      resTimer = null;
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      resHover = { metric, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }, TOOLTIP_DELAY_MS);
  }

  function hideResourceCard(): void {
    if (resTimer !== null) {
      clearTimeout(resTimer);
      resTimer = null;
    }
    resHover = null;
  }

  $effect(() => () => {
    if (resTimer !== null) clearTimeout(resTimer);
  });

  // ── 선두단 ──

  const allItems = $derived(applyOrder(statusOrder()));
  const items = $derived(allItems);

  /** 모든 칸이 한 값을 나눠 쓴다 — `theme.css` 의 칸 치수(`--sb-cell-w` · `--sb-cell-h`)를 바꾸면 이 값도 함께 본다 */
  const ICON_SIZE = 17;

  /** 지금 서는 칸이 없다 — 칸이 다시 생기면 여기서 토글 칸의 열림을 가른다 */
  function isOpen(item: StatusItem): boolean {
    return item.kind === "toggle" && isLauncherKind(dockOpen);
  }

  /** 끌어 놓은 손짓이 클릭으로 새어 나오지 않게 하는 문만 남았다 */
  function press(item: StatusItem) {
    if (justDragged()) return;
    void item;
  }

  // ── 하단 가운데 즐겨찾기 독 ──
  // 그린 칸 수가 0 이면 독이 뜨지 않는다 — 저장된 수가 아니라 그린 수로 가른다(가리키는 것이 사라진 칸은 그리지 않는다).
  let favoritesBusy = $state(false);
  let favoritesCount = $state(0);
  let dockFavorites = $state<ReturnType<typeof DockFavorites> | null>(null);
  const FAVORITE_ICON_SIZE = 20;
  const pinned = $derived(dockPinned());
  const pinTip = $derived(t(pinned ? "app.dock.pin.off" : "app.dock.pin.on"));

  // ── 끌어서 순서 바꾸기 ──
  // 짐(mime)이 따로다 — 이 띠 위로 지나가는 탭 · 타일 · 호스트 드래그를 받으면 안 된다(`onOver` 는 우리 종류만 `preventDefault`).
  // 키보드 길(`Alt+←/→` · `Home`/`End`)은 드래그와 같은 통로(`reorder` → `setStatusOrder`)를 지난다 (docs/log/2026-09-17-keyboard-reorder.md).

  const STATUS_DRAG_TYPE = "x-aynx-status";

  let lead = $state<HTMLDivElement | null>(null);
  let dragId = $state<string | null>(null);
  /** 삽입선을 그릴 칸 — "이 칸 앞" */
  let dropBefore = $state<string | null>(null);
  let dropEnd = $state(false);
  const lastId = $derived(items.at(-1)?.id ?? null);

  /** 드래그 몸짓 끝에 브라우저가 얹는 `click` 하나를 무시한다 — 새면 자리를 옮겼을 뿐인데 그 칸이 실행된다 */
  let dragEndedAt = 0;
  const justDragged = () => dragId !== null || performance.now() - dragEndedAt < 250;

  function clearDrop() {
    dropBefore = null;
    dropEnd = false;
  }

  /**
   * `"id"` = 그 칸 앞 · `null` = 맨 뒤 · `undefined` = 칸 사이 틈(직전 판단을 둔다).
   * 칸의 가운데로 앞뒤를 가른다 — "언제나 그 칸 앞" 이면 띠에는 빈 여백이 없어 마지막 칸 뒤로 옮길 길이 없다.
   */
  function dropTarget(ev: DragEvent): string | null | undefined {
    const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-status-id]") : null;
    const id = t?.dataset.statusId ?? "";
    if (!t || id === "") return undefined;
    const r = t.getBoundingClientRect();
    const after = vertical ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
    if (!after) return id;
    const i = items.findIndex((item) => item.id === id);
    return items[i + 1]?.id ?? null;
  }

  const isStatusDrag = (ev: DragEvent) =>
    ev.dataTransfer?.types.includes(STATUS_DRAG_TYPE) ?? false;

  $effect(() => {
    const el = lead;
    if (!el) return;

    const onStart = (ev: DragEvent) => {
      const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-status-id]") : null;
      const id = t?.dataset.statusId ?? "";
      const dt = ev.dataTransfer;
      if (id === "" || !dt) return;
      dragId = id;
      dt.setData(STATUS_DRAG_TYPE, id);
      dt.effectAllowed = "move";
    };

    const onOver = (ev: DragEvent) => {
      if (!isStatusDrag(ev)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      const to = dropTarget(ev);
      if (to === undefined) return;
      // 판정을 `reorder` 하나로 해 미리보기와 실제 결과가 갈리지 않는다
      const changed = dragId !== null && reorder(items, dragId, to) !== items;
      dropBefore = changed && to !== null ? to : null;
      dropEnd = changed && to === null;
    };

    const onLeave = (ev: DragEvent) => {
      const to = ev.relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      clearDrop();
    };

    const onDrop = (ev: DragEvent) => {
      if (!isStatusDrag(ev)) return;
      const before = dropBefore;
      const end = dropEnd;
      clearDrop();
      if (before === null && !end) return;
      ev.preventDefault();
      ev.stopPropagation();
      const id = ev.dataTransfer?.getData(STATUS_DRAG_TYPE) ?? "";
      if (id === "") return;
      const next = reorder(allItems, id, before);
      if (next === allItems) return; // 달라진 것이 없다 — 저장도 하지 않는다
      setStatusOrder(next.map((i) => i.id));
    };

    const onEnd = () => {
      dragId = null;
      dragEndedAt = performance.now();
      clearDrop();
    };

    /**
     * `Alt+화살표` 는 전역 타일 포커스 이동이고 `bypassesEditGuard` 라 버튼 위에서도 돈다 — 이 띠가 뜻을 정한 조합만
     * `stopPropagation` 한다(전역 처리기는 창의 버블 단계). 나머지 키는 손대지 않는다.
     */
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-status-id]") : null;
      const id = t?.dataset.statusId ?? "";
      if (id === "") return;
      const back = ev.code === "ArrowLeft" || (vertical && ev.code === "ArrowUp");
      const fwd = ev.code === "ArrowRight" || (vertical && ev.code === "ArrowDown");
      const n = items.length;
      const delta =
        ev.altKey && back ? -1 : ev.altKey && fwd ? 1 : ev.code === "Home" ? -n : ev.code === "End" ? n : 0;
      if (delta === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const target = moveTarget(items.map((i) => i.id), id, delta);
      if (!target) return;
      const next = reorder(allItems, id, target.to);
      if (next === allItems) return;
      setStatusOrder(next.map((i) => i.id));
      // 옮긴 칸에 포커스를 되돌린다 — 빼면 다시 그려진 띠에서 `Alt+→` 두 번이 한 번만 먹는다 (docs/log/2026-09-17-keyboard-reorder.md)
      void tick().then(() => {
        el.querySelector<HTMLElement>(`[data-status-id="${id}"]`)?.focus();
      });
    };

    el.addEventListener("dragstart", onStart);
    el.addEventListener("keydown", onKey);
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    el.addEventListener("dragend", onEnd);
    return () => {
      el.removeEventListener("dragstart", onStart);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("dragend", onEnd);
    };
  });
</script>

<svelte:window onresize={onWindowShake} onblur={onWindowShake} onwheel={onWindowShake} onscroll={onWindowShake} />

<!--
  하단 가운데 즐겨찾기 독 — 파일 · 설정 칸은 사이드 독으로 갔으므로 다시 넣지 않는다. 우클릭 메뉴는 독 안에 뜬다(밖이면 바깥 누르기
  감지가 메뉴 줄을 누르는 순간 독을 접는다).
  `data-chrome-toggle` — 독의 바깥 누르기 감지가 물러나는 표식이다. 없으면 `pointerdown` 에 닫히고 뒤따르는 `click` 에 다시 열린다.
-->
<FloatingStatusDock busy={favoritesBusy} {blocked} oncollapse={() => { dockFavorites?.closeMenu(); dockFavorites?.clearDrop(); }}
  bottomInset={position !== "bottom" ? "0px" : barStyle === "panel"
    ? "calc(var(--sb-h) + var(--space-2))" : "var(--sb-h)"}>
  <div class="floating-menu glass-raised" role="group" aria-label={t("app.start.favorites.aria")}
    ondragover={(ev) => dockFavorites?.dragOver(ev)} ondragleave={(ev) => dockFavorites?.dragLeave(ev)}
    ondrop={(ev) => dockFavorites?.drop(ev)}>
    <button type="button" class="fdock-pin" class:on={pinned} data-floating-pin aria-pressed={pinned}
      title={pinTip} aria-label={pinTip}
      onclick={() => setDockPinned(!pinned)}><UiIcon name="pin" size={18} /></button>
    <span class="fdock-sep" aria-hidden="true"></span>
    <DockFavorites bind:this={dockFavorites} bind:busy={favoritesBusy} bind:count={favoritesCount} iconSize={FAVORITE_ICON_SIZE} />
    {#if favoritesCount > 0}<span class="fdock-sep" aria-hidden="true"></span>{/if}
    <button type="button" class="fdock-launcher" data-floating-launcher data-chrome-toggle
      aria-expanded={isLauncherKind(dockOpen)} title={launcherTip} aria-label={launcherTip}
      onclick={() => onlauncher?.()}><UiIcon name="layout" size={20} /></button>
  </div>
</FloatingStatusDock>
<div class="statusbar glass-band" class:vertical data-pos={inline ? "inline" : position} data-style={barStyle}
  role="toolbar" aria-label={t("app.statusbar.aria")}>
  <div class="status-tools" data-status-tools>
    <!-- 선두단 — 지금은 비어 있다. 자리(첫 28%)는 그대로 두어 가운데 묶음이 서는 자리가 바뀌지 않는다 -->
    <div class="lead" bind:this={lead}>
      {#each items as item (item.id)}
        {@const title = shortcutTitle(t(item.labelKey), combosOf(item))}
        {@const open = isOpen(item)}
        <button
          type="button"
          class="glyph"
          class:active={open}
          class:dragging={dragId === item.id}
          class:drop-before={dropBefore === item.id}
          class:drop-end={dropEnd && item.id === lastId}
          draggable="true"
          data-status-id={item.id}
          {...item.kind === "toggle" ? { "data-chrome-toggle": true, "aria-pressed": open } : {}}
          {title}
          aria-label={title}
          onclick={() => press(item)}
        >
          <UiIcon name={item.icon} size={ICON_SIZE} />
        </button>
      {/each}
    </div>
  </div>
  <div class="status-middle" data-status-middle>
    {#if resItems.length > 0 || usageRings.length > 0}
      <div class="rings" data-usage-rings>
        {#each resItems as rr (rr.metric)}
          <button
            type="button"
            class="glyph signal ring {rr.level}"
            class:active={resourcesOpen}
            data-signal="resources"
            data-chrome-toggle
            aria-pressed={resourcesOpen}
            data-resource-ring={rr.metric}
            data-level={rr.level}
            aria-label={resAria(rr)}
            onclick={() => onresources?.()}
            onpointerenter={(e) => armResourceCard(e.currentTarget, rr.metric)}
            onpointerleave={hideResourceCard}
            onpointerdown={hideResourceCard}
            onfocus={(e) => {
              if (e.currentTarget.matches(":focus-visible")) armResourceCard(e.currentTarget, rr.metric);
            }}
            onblur={hideResourceCard}
            onkeydown={(e) => {
              if (e.key === "Escape") hideResourceCard();
            }}
          >
            <span class="r-dial" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="20" height="20">
                <circle class="r-track" cx="10" cy="10" r="8.25" />
                <circle
                  class="r-fill"
                  cx="10"
                  cy="10"
                  r="8.25"
                  pathLength="100"
                  stroke-dasharray="{barWidth(rr.pct)} 100"
                  transform="rotate(-90 10 10)"
                />
              </svg>
              <span class="r-mark"><UiIcon name={rr.metric === "cpu" ? "cpu" : "memory"} size={11} /></span>
            </span>
            <span class="r-pct" data-resource-pct>{vertical ? `${Math.round(rr.pct)}` : `${Math.round(rr.pct)}%`}</span>
          </button>
        {/each}
        {#if resItems.length > 0 && usageRings.length > 0}<span class="r-sep" data-rings-sep aria-hidden="true"></span>{/if}
        {#each usageRings as ring (ring.agent)}
          <!-- 값이 묵어도 흐리게 하지 않는다 — 호버 카드가 그 상태를 말한다(사용자 결정 · `data-stale` 표식만 남김) -->
          <button
            type="button"
            class="glyph signal ring {ring.level}"
            class:stale={ring.stale}
            class:active={usageOpen}
            data-signal="usage"
            data-chrome-toggle
            aria-pressed={usageOpen}
            data-usage-ring={ring.agent}
            data-level={ring.level}
            data-stale={ring.stale ? "" : undefined}
            aria-label={ring.tip}
            onclick={() => onusage?.()}
            onpointerenter={(e) => armUsageCard(e.currentTarget, ring.agent)}
            onpointerleave={hideUsageCard}
            onpointerdown={hideUsageCard}
            onfocus={(e) => {
              // 클릭으로 들어온 포커스에는 띄우지 않는다(공용 말풍선과 같은 규칙) — 키보드로 닿았을 때만
              if (e.currentTarget.matches(":focus-visible")) armUsageCard(e.currentTarget, ring.agent);
            }}
            onblur={hideUsageCard}
            onkeydown={(e) => {
              if (e.key === "Escape") hideUsageCard();
            }}
          >
            <span class="r-dial" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="20" height="20">
                <circle class="r-track" cx="10" cy="10" r="8.25" />
                {#if ring.pct !== null}
                  <circle
                    class="r-fill"
                    cx="10"
                    cy="10"
                    r="8.25"
                    pathLength="100"
                    stroke-dasharray="{barWidth(ring.pct)} 100"
                    transform="rotate(-90 10 10)"
                  />
                {/if}
              </svg>
              <span class="r-mark"><HostIcon icon={iconRef(ring.agent)} size={10} /></span>
            </span>
            <span class="r-pct" data-ring-pct
              >{ring.pct === null ? "–" : vertical ? `${Math.round(ring.pct)}` : `${Math.round(ring.pct)}%`}</span
            >
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="status-tail" data-status-tail>
    <div class="signals">
      <UpdateChip {vertical} />
      <RemoteChip {position} {vertical} />
      {#if onchat}
        <button
          type="button"
          class="tray chat"
          data-signal="side-chat"
          title={chatTip}
          aria-label={chatTip}
          onclick={() => onchat()}
        >
          <span class="tray-bell">
            <UiIcon name="chat" size={ICON_SIZE} />
            {#if chatDot}<span class="chat-dot" data-chat-dot={chatDot}></span>{/if}
          </span>
        </button>
      {/if}
      <!--
        알림 알약 — ⚡ · ☕ 는 표시뿐이다(켜고 끄는 자리는 각자 하나 — ⚡ = 설정 › 자동 승인 · ☕ = 독 실행 판의 ☕ 칸).
        `data-signal` 은 하네스용 — 알약 단추 `notify`, 안의 표시 `auto-approve` · `keep-awake`(span).
      -->
      <button
        type="button"
        class="tray notify"
        class:active={alertsOpen}
        data-signal="notify"
        data-chrome-toggle
        title={notifyTip}
        aria-label={trayLabel}
        aria-pressed={alertsOpen}
        onclick={() => onalerts()}
      >
        {#if autoApprove}
          <span class="tray-item" data-signal="auto-approve" title={autoTip} transition:reveal>
            <UiIcon name="zap" size={ICON_SIZE} />
          </span>
        {/if}
        {#if keepAwakeOn()}
          <span class="tray-item" data-signal="keep-awake" title={awakeTip} transition:reveal>
            <UiIcon name="away" size={ICON_SIZE} />
          </span>
        {/if}
        <span class="tray-bell" data-notify-bell>
          <UiIcon name="bell" size={ICON_SIZE} />
          {#if notifyCount > 0}
            <span class="notify-pill" class:urgent={notifyUrgent} data-notify-urgent={notifyUrgent}
              >{notifyBadgeText(notifyCount)}</span
            >
          {:else if notifyUnread}
            <span class="notify-dot" data-notify-dot></span>
          {/if}
        </span>
      </button>
    </div>
  </div>
</div>

{#if usageHover && hoveredRing}
  <UsageHoverCard
    ring={hoveredRing}
    anchor={usageHover.rect}
    side={!vertical ? "vertical" : position === "left" ? "right" : "left"}
  />
{/if}

{#if resHover && resItems.length > 0}
  <ResourceHoverCard
    metric={resHover.metric}
    anchor={resHover.rect}
    side={!vertical ? "vertical" : position === "left" ? "right" : "left"}
  />
{/if}

<style>
  /* 판은 완전한 알약(999px) — 큰 면 16 규칙의 예외(사용자 결정) */
  .floating-menu {
    position: relative; /* "가득 참" 글자(`DockFavorites`)가 판 위에 선다 */
    box-sizing: border-box;
    max-width: 100%;
    --sb-cell-w: 44px;
    --sb-cell-h: 44px;
    --sb-gap: 6px;
    display: flex;
    align-items: center;
    gap: var(--sb-gap);
    padding: 6px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--glass-float, var(--surface-raised-solid));
    box-shadow: var(--shadow-raised);
  }
  .fdock-launcher {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    color: var(--control-on-fg);
    background: var(--control-on-bg);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .fdock-launcher:hover {
    background: var(--control-on-bg-hover);
  }
  .fdock-launcher:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .fdock-pin {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-inline: 4px 0;
    padding: 0;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .fdock-pin:hover {
    background: var(--control-ghost-hover);
  }
  .fdock-pin.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }
  .fdock-pin.on:hover {
    background: var(--control-sel-bg-hover);
  }
  .fdock-pin:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .fdock-pin { transition: none; }
  }
  .fdock-sep {
    flex: 0 0 auto;
    width: 1px;
    height: 28px;
    margin-inline: 2px;
    background: var(--line);
  }
  @media (max-width: 420px) {
    .floating-menu {
      --sb-gap: 4px;
    }
  }

  /* 강조색은 알림 배지(`.notify-pill.urgent`) · 끌어 옮기는 삽입선에만 쓴다 */
  .statusbar {
    --status-middle-start: 28%;
    box-sizing: border-box;
    display: grid;
    align-items: center;
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--glass-band, var(--surface-raised));
    user-select: none;
  }

  .statusbar:not(.vertical) {
    grid-template-columns: var(--status-middle-start) minmax(0, 1fr) max-content;
    height: var(--sb-h);
    padding: 0 var(--space-3);
  }
  .statusbar[data-pos="bottom"] {
    border-top: 1px solid var(--line);
  }
  .statusbar[data-pos="top"] {
    border-bottom: 1px solid var(--line);
  }
  /* `[data-pos]` 까지 — 세기가 같으면 뒤의 자리별 테두리 규칙이 이겨 옆선이 남는다. 투명이 아니라 없앤다 — 투명 1px 칸으로
     흐리지 않은 바탕이 비친다 */
  .statusbar[data-style="hug"][data-pos] {
    border: none;
  }
  /* 모바일 배치는 감지 않는다(`+page` 의 감싸기 절) */
  :global(.app.mobile) .statusbar[data-style="hug"][data-pos="top"] {
    border-bottom: 1px solid var(--line);
  }
  /* 위 가장자리 하이라이트도 끈다 — 감긴 곡선 옆에 직선이 남는다 */
  .statusbar[data-style="hug"][data-pos]::before {
    box-shadow: none;
  }
  /* 흐림 판을 한 장으로 — 조각이 따로 흐리면 맞닿은 곳에 이음매가 비친다. `--hug-r` 은 `+page` 의 모서리 조각과 같은 값 */
  .statusbar[data-style="hug"] {
    --hug-r: calc(var(--gap) + var(--radius-surface));
    /* 오린 원의 중심이 모서리 조각 곡선의 중심과 같아야 사이로 바탕이 안 샌다 */
    --hug-x: calc(var(--hug-r) + 1px);
  }
  :global(:root[data-material="glass"] .app:not(.mobile)) .statusbar[data-style="hug"][data-pos="top"]::before {
    bottom: calc(-1 * var(--hug-x));
    mask-image: linear-gradient(#000, #000), radial-gradient(circle at 100% 100%, transparent var(--hug-r), #000 var(--hug-r)),
      radial-gradient(circle at 0% 100%, transparent var(--hug-r), #000 var(--hug-r));
    mask-size: 100% calc(100% - var(--hug-x)), var(--hug-x) var(--hug-x), var(--hug-x) var(--hug-x);
    mask-position: left top, left bottom, right bottom;
    mask-repeat: no-repeat;
  }

  /* `--sb-w` 는 `+page` 의 `--dock-inset-left` 와 같은 값. 높이는 적지 않는다 — `height:100%` 면 panel 의 위·아래 여백만큼
     창 밖으로 밀려 아래 모서리가 잘린다 (docs/log/2026-09-29-statusbar-panel-vertical.md) */
  .statusbar.vertical {
    grid-template-rows: minmax(var(--status-middle-start), max-content) minmax(0, 1fr) max-content;
    width: var(--sb-w);
    padding: var(--space-3) 0;
  }
  .statusbar[data-pos="left"] {
    border-right: 1px solid var(--line);
  }
  .statusbar[data-pos="right"] {
    border-left: 1px solid var(--line);
  }

  .lead {
    display: flex;
    align-items: center;
    gap: var(--sb-gap);
  }

  /* 글꼴 세 줄은 드래그 중 브라우저가 만드는 기본 이미지의 줄 높이 몫이라 건드리지 않는다 */
  .glyph {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--sb-cell-w);
    height: var(--sb-cell-h);
    padding: 0;
    font-family: var(--font-ui);
    font-size: 14px;
    line-height: 1;
    /* `--fg-3` 은 글래스 띠 · 월페이퍼 위에서 아이콘이 잘 안 보인다 */
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .glyph:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 알림 알약 — 아이콘 사이 9px 은 `gap` 이 아니라 ⚡ · ☕ 자신의 바깥 여백이다(`slide` 가 여백도 0 에서 키워 펼침 동안 종이 튀지 않는다).
     세로 기둥에서는 알약이 세로로 선다(펼침도 세로 축) */
  .tray {
    position: relative;
    flex: 0 0 auto;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 9px;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .tray:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }
  .tray.active {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }
  .tray.active:hover {
    background: var(--control-sel-bg-hover);
  }
  .tray:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .statusbar.vertical .tray {
    flex-direction: column;
    width: 24px;
    height: auto;
    padding: 9px 0;
  }
  .tray-item,
  .tray-bell {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tray-item {
    margin-inline-end: 9px;
  }
  .statusbar.vertical .tray-item {
    margin-inline-end: 0;
    margin-block-end: 9px;
  }
  .tray-bell {
    position: relative;
  }

  /*
   * `--notify-ring` 은 불투명 바탕이어야 한다 — 반투명 띠 색이면 종의 획이 테두리 너머로 비친다.
   * 배지의 11px 은 12px 밖으로 남은 유일한 글자다 — 숫자 배지에만 허용한다. 세로 기둥은 안쪽으로 자라야 기둥 밖으로 잘리지 않는다.
   */
  .notify {
    --notify-ring: var(--surface-raised-solid);
  }
  .notify:hover {
    --notify-ring: var(--surface-hover);
  }
  .notify.active {
    --notify-ring: var(--control-sel-bg);
  }
  .notify.active:hover {
    --notify-ring: var(--control-sel-bg-hover);
  }
  .notify-pill {
    position: absolute;
    top: -4px;
    left: calc(50% + 1px);
    box-sizing: border-box;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    font-size: 11px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 15px;
    text-align: center;
    white-space: nowrap;
    color: var(--fg-1);
    background: var(--line-strong);
    border-radius: 999px;
    box-shadow: 0 0 0 2px var(--notify-ring);
    pointer-events: none;
  }
  .statusbar.vertical .notify-pill {
    left: auto;
    right: -6px;
  }

  .notify-dot {
    position: absolute;
    top: -1px;
    left: calc(50% + 4px);
    width: 7px;
    height: 7px;
    background: var(--fg-1);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--notify-ring);
    pointer-events: none;
  }

  .notify.active .notify-pill:not(.urgent) {
    color: var(--control-sel-bg);
    background: var(--control-sel-fg);
  }
  .notify.active .notify-dot {
    background: var(--control-sel-fg);
  }

  .chat {
    --notify-ring: var(--surface-raised-solid);
  }
  .chat-dot {
    position: absolute;
    top: -1px;
    left: calc(50% + 4px);
    width: 7px;
    height: 7px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--notify-ring);
    pointer-events: none;
  }
  .chat-dot[data-chat-dot="permission"] {
    background: var(--warn);
  }
  .chat-dot[data-chat-dot="finished"] {
    background: var(--ok);
  }

  .notify-pill.urgent {
    color: var(--on-accent);
    background: var(--accent);
  }

  .glyph:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .glyph.active {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .glyph.dragging {
    opacity: 0.4;
  }

  .glyph.drop-before::after,
  .glyph.drop-end::after {
    position: absolute;
    content: "";
    background: var(--accent);
    border-radius: 1px;
  }
  .statusbar:not(.vertical) .glyph.drop-before::after,
  .statusbar:not(.vertical) .glyph.drop-end::after {
    top: 2px;
    bottom: 2px;
    width: 2px;
  }
  .statusbar:not(.vertical) .glyph.drop-before::after {
    left: calc(var(--sb-gap) / -2 - 1px);
  }
  .statusbar:not(.vertical) .glyph.drop-end::after {
    right: calc(var(--sb-gap) / -2 - 1px);
  }
  .statusbar.vertical .glyph.drop-before::after,
  .statusbar.vertical .glyph.drop-end::after { left: 2px; right: 2px; height: 2px; }
  .statusbar.vertical .glyph.drop-before::after { top: calc(var(--sb-gap) / -2 - 1px); }
  .statusbar.vertical .glyph.drop-end::after { bottom: calc(var(--sb-gap) / -2 - 1px); }

  .status-tools, .status-middle, .status-tail {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 0;
  }
  .status-tools, .status-middle { overflow: hidden; }
  .statusbar:not(.vertical) .status-tools,
  .statusbar:not(.vertical) .status-middle,
  .statusbar:not(.vertical) .status-tail { flex-direction: row; }
  .statusbar:not(.vertical) .status-tools { grid-column: 1; padding-right: 24px; }
  .statusbar:not(.vertical) .status-middle { grid-column: 2; }
  .statusbar:not(.vertical) .status-tail { grid-column: 3; justify-self: end; padding-left: var(--space-2); }
  .statusbar:not(.vertical) .lead { min-width: 0; overflow-x: auto; scrollbar-width: none; }
  /* 폰 배치 — 28% 를 비워 두면 고리가 가운데로 밀린다 */
  :global(.app.mobile) .statusbar:not(.vertical) { grid-template-columns: max-content minmax(0, 1fr) max-content; }
  :global(.app.mobile) .statusbar:not(.vertical) .status-tools { padding-right: var(--space-3); }
  .statusbar.vertical .status-tools,
  .statusbar.vertical .status-middle,
  .statusbar.vertical .status-tail { grid-column: 1; flex-direction: column; }
  .statusbar.vertical .status-tools { grid-row: 1; align-self: stretch; padding-bottom: 12px; }
  .statusbar.vertical .status-middle { grid-row: 2; align-self: stretch; }
  .statusbar.vertical .status-tail { grid-row: 3; align-self: end; padding-top: var(--space-2); }
  .statusbar.vertical .lead { flex-direction: column; }
  .statusbar.vertical .status-middle { overflow: hidden; }

  /* 탭 줄 안 — 흐림 판(`::before`)은 늘 끈다(제목줄 · 창 전체 판 한 장이 든다). 둥근 패널 · 감싸기의 판 · 선은 `WindowTitlebar` 가 끈다 */
  .statusbar[data-pos="inline"] {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    align-self: stretch;
    height: auto;
    padding: 0 var(--space-3);
    background: var(--glass-band, var(--surface-raised));
    border-bottom: 1px solid var(--line);
  }
  .statusbar[data-pos="inline"] .status-tools {
    display: none;
  }
  .statusbar[data-pos="inline"] .status-middle,
  .statusbar[data-pos="inline"] .status-tail {
    overflow: visible;
    padding-left: 0;
  }
  .statusbar[data-pos="inline"] .status-tail {
    margin-left: var(--space-2);
  }
  :global(:root[data-material="glass"]) .statusbar[data-pos="inline"]::before {
    display: none;
  }

  .signals {
    display: flex;
    align-items: center;
    gap: var(--sb-gap);
  }
  .statusbar.vertical .signals { flex-direction: column; }
  .rings {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--sb-gap);
  }
  .statusbar.vertical .rings { flex-direction: column; }
  .r-sep {
    flex: 0 0 auto;
    width: 1px;
    height: 14px;
    margin: 0 var(--space-1);
    background: var(--line);
  }
  .statusbar.vertical .r-sep {
    width: 16px;
    height: 1px;
    margin: var(--space-1) 0;
  }

  .glyph.signal.ring {
    width: auto;
    gap: 4px;
    padding: 0 var(--space-1);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--fg-2);
  }
  .statusbar.vertical .glyph.signal.ring {
    flex-direction: column;
    height: auto;
    gap: 1px;
    padding: var(--space-1) 0;
    font-size: 10px;
  }
  .glyph.signal.ring.warn {
    color: var(--warn);
  }
  .glyph.signal.ring.err {
    color: var(--err);
  }
  .r-dial {
    position: relative;
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
  }
  .r-dial svg {
    display: block;
  }
  .r-track {
    fill: none;
    stroke: var(--surface-hover);
    stroke-width: 2.5;
  }
  .r-fill {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .r-mark {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
  }

  .glyph.signal.static {
    cursor: default;
  }
  .glyph.signal.static:hover {
    color: var(--fg-2);
    background: transparent;
  }

  /* ── panel ── */

  /* 캔버스 쪽 변에는 여백을 두지 않는다 — 캔버스가 이미 `--gap` 만큼 안쪽에서 시작한다 */
  .statusbar[data-style="panel"] {
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
  }
  .statusbar[data-style="panel"][data-pos="top"] {
    margin: var(--space-2) var(--space-2) var(--space-1);
  }
  :global(.app:not(.mobile)) .statusbar[data-style="panel"][data-pos="top"] {
    margin-bottom: 0;
  }
  .statusbar[data-style="panel"][data-pos="bottom"] {
    margin: 0 var(--space-2) var(--space-2);
  }
  .statusbar[data-style="panel"][data-pos="left"] {
    margin: var(--space-2) 0 var(--space-2) var(--space-2);
  }
  .statusbar[data-style="panel"][data-pos="right"] {
    margin: var(--space-2) var(--space-2) var(--space-2) 0;
  }
  /* 탭 줄 안은 따로 뜬 패널이 아니다 — 둥근 판 · 선은 제목줄 패널이 든다 */
  .statusbar[data-style="panel"][data-pos="inline"] {
    border: none;
    border-radius: 0;
  }

  /* `padding-box` — 반투명 선 밑에 판이 깔려 선이 한 번 더 밝아지지 않게 */
  :global(:root[data-material="glass"] body) .statusbar[data-pos] {
    border-color: var(--glass-rim);
    background-clip: padding-box;
  }
  :global(:root[data-material="glass"]) .statusbar[data-pos]::before {
    box-shadow: none;
  }
</style>
