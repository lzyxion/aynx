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
  import { slide } from "svelte/transition";
  import { keepAwakeOn } from "$lib/app/keep-awake.svelte.js";
  import { TOOLTIP_DELAY_MS, type TooltipRect } from "$lib/tooltip";
  import { hasUnreadNotifications } from "$lib/app/notifications.svelte.js";
  import { notifyBadgeText } from "$lib/notifications";

  /**
   * 가장자리 상태바: 선두(독 입구 하나 — 끌어 순서를 바꾸는 틀은 남아 있다) → 가운데 묶음
   * (자원 고리 CPU · 메모리 → 얇은 구분선 → 사용량 고리 — 2026-10-17) → 후미(앱 전체 상태 — 원격 칩 · **알림 알약**(⚡ 자동 승인 ·
   * ☕ 잠자기 방지 · 🔔 종(+ 수 배지 · 읽지 않음 점)) — 자물쇠(화면 잠금)는 2026-10-23 독 실행 판으로 옮겼다).
   * 가운데 묶음은 가로 · 세로 모두 상태바 전체 길이의 **28% 지점**에서 시작한다(2026-10-07 — 예전 사용량 · 워크스페이스 묶음의 규칙).
   *
   * **2026-10-18 통합 독** — 메뉴 칸(새 터미널 · 로컬 파일 · 명령 팔레트 · 지난 대화 · 세션 · 작업안 · 오케스트레이션)과 그 셸 메뉴
   * 팝업, 알림 종의 팝오버, 하단 중앙 호버 독(즐겨찾기 · 파일 · 설정)은 걷어 **독 하나**(`Dock.svelte`)로 모았다. 이 띠에는
   * 독 입구(`open-dock`) 하나와 표시들만 남는다. 같은 동작의 단축키 · 팔레트 · 단축키 도움말은 그대로다(띠의 칸만 사라졌다).
   * 알림 종은 **늘** 서고(2026-10-24 A안 — 그 전에는 수 배지만 서고 0 이면 없었다) 모서리에 수 배지 · 읽지 않음 점을 얹으며,
   * 누르면 독의 알림 칸을 여닫는다. **2026-10-24 End-4 알약** — 후미의 ⚡ · ☕ · 종을 End-4(illogical-impulse) 상태줄 오른쪽 끝처럼
   * **단추 하나인 알약**으로 묶었다(⚡ · ☕ 는 켜졌을 때만 폭이 미끄러져 펼쳐지는 표시일 뿐 따로 누를 수 없다 — 템플릿의 알약 주석).
   * 상태바 자리(위 · 아래 · 왼쪽 ·
   * 오른쪽) · 모양은 그대로다. 저장된 순서(`aynx:status-order`)에 남은 옛 칸 id 는 `applyOrder` 가 조용히 버린다.
   * 워크스페이스는 탭 줄 맨 앞 단추와 그 목록(`Tabs.svelte`)이 맡는다.
   * 앱 상태와 동작은 +page 의 props/콜백으로 받는다.
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
    /** 어느 가장자리에 서는가 — 가로(위·아래) / 세로(왼쪽·오른쪽)를 가른다 */
    position: StatusBarPosition;
    /**
     * **탭 줄 안에 선다**(2026-10-28 — 데스크톱 위 배치, 목업 PHfVWdUwgNyYFdJvYSZBkv). 예전에는 탭 줄 아래 한 줄이 더 섰다. 이제
     * 제목줄(`chrome/WindowTitlebar`)의 탭 뒤 · 창 단추 앞에 들어가 표시 묶음(자원 · 사용량 고리 → 원격 칩 → 알림 알약)이 **오른쪽 끝
     * 기준**으로 붙는다 — 28% 지점 규칙 · 선두단(빈 칸)은 없다. 판 · 선 · 흐림은 탭 줄이 든다(`data-pos="inline"` — 띠 규칙이 안 걸린다).
     * 상태바 모양(평면 · 둥근 패널 · 감싸기)은 제목줄이 그대로 진다. 폰 배치의 위 띠는 예전 그대로다.
     */
    inline?: boolean;
    /** 모양 — `flat`(평면·기본) / `panel`(둥근 패널). `style` 이 아니라
        `barStyle` 인 이유: HTML `style` 속성 이름과 부딪히지 않게 한다. */
    barStyle?: StatusBarStyle;
    /** 모달 · 가림막 동안 — 하단 가운데 즐겨찾기 독을 접고 숨긴다(상태바는 그대로) */
    blocked?: boolean;
    /** 지금 독에 떠 있는 종류 (`null` = 닫힘) — 런처 칸이면 독 입구에, 알림 칸이면 알림 알약에도 불을 켠다(secondaryContainer) */
    dockOpen: DockKind | null;
    /** 사용량 화면이 열려 있는가 — 사용 한도 고리가 그 화면의 토글이라 이 값이 고리의 활성이다 */
    usageOpen?: boolean;
    /** 자원 화면이 열려 있는가 — 자원 고리(CPU · 메모리)가 그 화면의 토글이라 이 값이 고리의 활성이다 */
    resourcesOpen?: boolean;
    /**
     * **자원 고리를 세우는가**(설정 `[app] resource_rings` — 기본 켬). 켜져 있는 동안 이 띠가 자원 표본의 보는 쪽이다
     * (`watchResources` — 창이 숨으면 그 바퀴는 건너뛴다). 고리는 표본이 있을 때만 선다(옛 서버 · 첫 표본 전 · 묵은 표본이면 없음).
     */
    resources?: boolean;
    /**
     * **승인을 기다리는 작업안 수** — 맨 끝 알림 종의 수 배지에 더해진다(`0` 이면 그 몫이 없다).
     *
     * 관제판을 열어야만 보이던 사실을 늘 보이는 띠로 끌어낸 것이다
     * (docs/log/2026-09-21-approval-ttl.md). 처음에는 관리뷰 칸의 배지였고 2026-09-25 에 종으로
     * 옮겼다 (docs/log/2026-09-25-notification-center.md). 값은 `+page` 가
     * `pending-plans.svelte.ts` 에서 내려 준다.
     */
    pendingPlans?: number;
    /**
     * **확인할 에이전트 알림** — 해결되지 않은 턴 끝 · 권한 물음 수(× 로 비킨 것 포함)와 그중 권한 물음이
     * 있는가. 종의 배지에서 위 수와 합쳐진다 (`app/agent-banners` · docs/log/2026-09-27-agent-banners.md).
     * 일반 알림(긴 명령 · 전송 …)은 센터에 기록되지만 **세지 않는다**.
     */
    agentAlerts?: { count: number; urgent: boolean };
    /** **자동 승인이 켜져 있는가** — 알림 알약 안의 표시 `⚡`(표시뿐 — 끄는 자리는 설정 › 자동 승인) */
    autoApprove?: boolean;
    /**
     * **사용 한도 고리** — 에이전트마다 하나, **늘** 선다(값이 있거나 그 에이전트를 본 적이 있을 때). 자리는 가운데 묶음
     * (`.rings` — 상태바 전체 길이의 28% 지점부터, 묶음에는 고리만 선다)이다
     * (docs/log/2026-09-26-agent-usage.md "상태바 고리"). 고리 = 가장 긴 창(7일 — `ringWindow`), 가운데 = 에이전트 로고,
     * 옆(세로 띠는 아래)에 %. 조립은 `+page` 가 `usageRings` 로 한다 — 이 띠는 그리기만.
     */
    usageRings?: UsageRing[];
    /** 알림 알약 — `toggleDock("alerts")`(독의 알림 칸 — 2026-10-18 통합 독, 옛 알림 센터 팝오버)로 배선된다 */
    onalerts: () => void;
    /** 하단 가운데 독의 런처 단추 — 런처 독을 여닫는다(`toggleLauncherDock`) */
    onlauncher?: () => void;
    /**
     * **폰 사이드 채팅 단추**(원격 폰 배치 · 2026-11-01) — 주면 알림 알약 왼쪽에 말풍선 알약이 선다(폰 덮개 `MobileChat` 을 연다).
     * 데스크톱 폭은 채팅 독이 제 자리라 주지 않는다.
     */
    onchat?: () => void;
    /** 말풍선의 점 — 모든 사이드 채팅 중 가장 급한 것(권한 > 새 답 > 답하는 중 · `app/side-chat-surface`) */
    chatDot?: "permission" | "running" | "finished" | null;
    /** 사용 한도 고리를 눌렀다 — 사용량 화면을 여닫는다(토글) */
    onusage?: () => void;
    /** 자원 고리를 눌렀다 — 자원 화면을 여닫는다(토글) */
    onresources?: () => void;
    /**
     * 지금 걸린 단축키 오버라이드 — 칸마다의 툴팁 조합을 여기서 낸다 (하드코딩 없음).
     * 없으면 기본 조합이 그대로 나온다.
     */
    keybindings?: Overrides;
  } = $props();

  // ---------------------------------------------------------------------------
  // 맨 끝 알림 종 — 2026-10-18 통합 독부터 **독의 알림 칸**을 여닫는 토글이다(옛 알림 센터 팝오버는 그 칸으로 들어갔다 —
  // `DockAlerts.svelte`). 그래서 이 띠가 쥐는 "열림" 상태는 이제 없다 — 열림은 `dockOpen === "alerts"` 다.
  // 2026-10-24 부터 종 글리프는 늘 서고, 모서리에 숫자 배지 또는 읽지 않은 일반 알림의 점이 얹힌다(템플릿의 알림 종 주석).
  // 같은 날 End-4 알약 — 종은 ⚡ · ☕ 표시와 한 단추(알약)에 든다. 알약을 누르는 것이 곧 종을 누르는 것이다.
  // ---------------------------------------------------------------------------

  const alertsOpen = $derived(dockOpen === "alerts");

  /** 종의 배지 — 승인 대기 + 확인할 에이전트 알림 (일반 알림은 세지 않는다 — 2026-09-27) */
  const notifyCount = $derived(pendingPlans + agentAlerts.count);
  /** 강조색 배지 — 승인 대기나 권한 물음이 있을 때만(사람이 답해야 멈춘 일이 풀린다). 끝남만이면 중성 */
  const notifyUrgent = $derived(pendingPlans > 0 || agentAlerts.urgent);

  /** 종의 점 — 숫자가 없고 일반 알림에 읽지 않은 줄이 있을 때(2026-10-24 · 수는 세지 않는다) */
  const notifyUnread = $derived(hasUnreadNotifications());

  /** 종의 툴팁 — 두 수를 따로 말한다(배지는 합만 · `99+` 로 접혀도 정확한 수는 여기 있다) */
  const notifyTip = $derived(
    `${t("app.statusbar.notify")} — ${
      notifyCount > 0
        ? t("app.statusbar.notify.counts", { pending: pendingPlans, agents: agentAlerts.count })
        : notifyUnread
          ? t("app.statusbar.notify.unread")
          : t("app.statusbar.notify.none")
    }`,
  );

  /** 폰 사이드 채팅 말풍선의 툴팁 — 이름 + 점의 뜻 */
  const chatTip = $derived(
    chatDot === "permission"
      ? `${t("app.chatDock.open")} — ${t("app.chatDock.permission")}`
      : chatDot === "finished"
        ? `${t("app.chatDock.open")} — ${t("app.chatDock.unseen")}`
        : chatDot === "running"
          ? `${t("app.chatDock.open")} — ${t("app.chatDock.running")}`
          : t("app.chatDock.open"),
  );

  /** 알약 안 표시의 툴팁(각 span 의 `title`) — 무엇이 켜졌나 */
  const autoTip = $derived(t("app.statusbar.autoapprove"));
  const awakeTip = $derived(t("app.keepAwake.on"));

  /**
   * 알약의 접근성 이름 — 종의 툴팁에 **켜진 표시**를 덧붙인다(⚡ · ☕ 는 따로 초점을 받지 않는 표시라 여기서 말한다).
   * 알약 자체의 `title` 은 종의 툴팁 그대로다(⚡ · ☕ 위에 올리면 각자의 `title` 이 뜬다).
   */
  const trayLabel = $derived(
    [notifyTip, autoApprove ? autoTip : null, keepAwakeOn() ? awakeTip : null].filter(Boolean).join(" · "),
  );

  /**
   * ⚡ · ☕ 가 나타나고 사라질 때 폭(세로 기둥은 높이)이 미끄러진다 — End-4 의 Revealer. 움직임 줄이기면 즉시.
   * 처음 그릴 때는 돌지 않는다(Svelte 5 전환은 기본 지역 · 첫 마운트 intro 없음 — 깜빡임 없음).
   */
  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const reveal = (node: Element) =>
    slide(node, { axis: vertical ? "y" : "x", duration: reducedMotion() ? 0 : 150 });

  /** 이 액션에 지금 걸린 조합 (없으면 `null` — 툴팁에서 괄호째 빠진다) */
  const comboOf = (action: string) => {
    const combo = effectiveCombo(action, keybindings);
    return combo ? displayCombo(combo) : null;
  };

  /**
   * 칸 하나의 조합 글자 — 여러 키의 문(독 칸)이면 수식 키가 같은 것끼리 접는다(`Ctrl+Shift+H/J/K`,
   * `mergeCombos`). 사용자가 하나를 풀었으면 그것만 빠진다(셋 다 풀면 괄호째 빠진다 — `shortcutTitle`).
   */
  const combosOf = (item: StatusItem) =>
    mergeCombos((item.tipActions ?? [item.action]).map(comboOf).filter((c): c is string => !!c));

  /** 런처 단추 — 이름 + 사이드 독을 여는 키(호스트 칸 `open-hosts-dock` — 같은 독이 뜬다) */
  const launcherTip = $derived(shortcutTitle(t("app.dock.launcher.open"), comboOf("open-hosts-dock")));
  // 세로 기둥은 좁아서(`--sb-w`) 글자가 들어가지 않는다 — 아이콘만 세운다(나머지는 툴팁이 말한다).
  const vertical = $derived(position === "left" || position === "right");

  // ── 사용량 호버 카드 (docs/log/2026-09-28-usage-hover-bars.md) ──────────────────────
  // 고리에 얹거나 키보드로 닿으면 막대 카드가 뜬다. 고리에는 `title` 이 없다 — 앱 공용 말풍선(`tooltip.svelte.ts`)은
  // `[title]` 만 집으므로 둘이 겹쳐 뜨지 않고, 네이티브 말풍선도 없다. 접근성 이름은 `aria-label` 한 줄이 그대로 쥔다.
  // 시계는 공용 말풍선과 같은 `TOOLTIP_DELAY_MS`. 카드가 가리키는 것은 에이전트 이름뿐이라, 떠 있는 동안
  // 값이 새로 와도(`usageRings` 가 다시 조립돼도) 카드는 새 값을 그린다.
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

  /** 창이 흔들리면 사용량 카드를 접는다(자리를 다시 재지 않는다 — 공용 말풍선과 같은 판단) */
  function onWindowShake(): void {
    hideUsageCard();
    hideResourceCard();
  }

  // ── 자원 고리 (2026-10-17 — 로컬 자원 모니터) ─────────────────────────────────────────
  // 가운데 묶음의 앞, 사용량 고리 앞에 CPU · 메모리 고리 둘. 숫자 = **이 PC 전체**(작업 관리자와 같은 숫자 — 사용자 결정 A),
  // 모양 · 색 규칙은 사용량 고리와 같은 그릇(회색 · 80% 경고 · 95% 오류, 강조색 없음). 설정이 켜져 있는 동안 이 띠가 자원 표본의
  // 보는 쪽이고(`watchResources`), 표본이 없거나(첫 표본 전 · 옛 서버) 묵었으면 고리도 구분선도 서지 않는다(`resourceRings`).
  // 호버 카드는 사용량 카드와 같은 몸짓(`TOOLTIP_DELAY_MS` · 키보드 포커스 · Esc · 떠남 · 누름에 접힘), 누르면 자원 화면.
  $effect(() => {
    if (!resources) return;
    return watchResources();
  });

  const resRings = $derived(resources && !resourceOutdated() ? resourceRings(resourceRing(), resourcePulledAt()) : null);
  const resItems = $derived<ResourceRingValue[]>(resRings ? (resRings.mem ? [resRings.cpu, resRings.mem] : [resRings.cpu]) : []);

  /** 자원 고리의 접근성 이름 — 숫자 + "이 PC 전체 · 누르면 자원 화면"(메모리는 사용/전체도) */
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

  // ---------------------------------------------------------------------------
  // 선두단 — 무엇이 어떤 순서로 서는가
  // ---------------------------------------------------------------------------

  /**
   * 지금 그릴 칸들 — 저장된 순서가 있으면 그것, 없으면 기본 순서 (`status-items.ts`). 2026-10-18 부터 칸은 독 입구 하나이고,
   * 옛 저장값의 걷힌 칸 id 는 `applyOrder` 가 버린다(빈자리 없음).
   */
  const allItems = $derived(applyOrder(statusOrder()));
  const items = $derived(allItems);

  /**
   * 선두단 아이콘의 크기·굵기 — **모든 칸이 한 값을 나눠 쓴다** (칸마다 적으면 하나가
   * 뒤처져 그 칸만 굵거나 커진다).
   *
   * 17px 는 28×26 칸(`theme.css` 의 `--sb-cell-w`·`--sb-cell-h`) 안에서 여백이 고르게 남는
   * 크기다 — **칸 치수를 바꾸면 이 값도 함께 본다**(칸 대비 ~60%). 띠의 치수는 전부
   * `theme.css` 의 `--sb-*` 한 벌이고, 아이콘만 `UiIcon` 의 prop 이라 여기 JS 상수로 남는다
   * (docs/log/2026-09-25-statusbar-size.md).
   */
  const ICON_SIZE = 17;

  /**
   * 이 칸이 지금 "열려 있는" 표면인가. 2026-10-18 실기 뒤 독 입구 칸까지 걷혀 **지금 서는 칸이 없다**(독은 가장자리 호버 · 단축키 ·
   * 팔레트 · 알림 알약으로 연다). 칸이 다시 생기면 여기서 토글 칸의 열림을 가른다 — 지금은 런처 독이 떠 있는가 하나다.
   */
  function isOpen(item: StatusItem): boolean {
    return item.kind === "toggle" && isLauncherKind(dockOpen);
  }

  /** 칸 하나를 눌렀다 — 지금은 서는 칸이 없다(위 주석). 끌어 놓은 손짓이 클릭으로 새어 나오지 않게 하는 문만 남긴다 */
  function press(item: StatusItem) {
    if (justDragged()) return;
    void item;
  }

  // ── 하단 가운데 즐겨찾기 독 (2026-10-13 · 10-18 실기 뒤 되살림 — 즐겨찾기 칸만) ─────────────────────
  // 메뉴 · 끌기 동안 독이 접히지 않게(`busy`), 독이 접히면 메뉴도 닫는다(`closeMenu`). 그린 칸 수(`count`)가 0 이면 독 자체가
  // 뜨지 않는다(가리키는 것이 사라진 칸은 그리지 않으므로 저장된 수와 다를 수 있다 — 그래서 그린 수로 가른다).
  let favoritesBusy = $state(false);
  let favoritesCount = $state(0);
  let dockFavorites = $state<ReturnType<typeof DockFavorites> | null>(null);
  /** 하단 가운데 독의 아이콘 크기 — 예전 하단 독의 34px 칸 안 20px 그대로 */
  const FAVORITE_ICON_SIZE = 20;
  /** 독 고정(핀 — 2026-10-23) — 앱 하나의 값(`floating-dock-pin.svelte.ts`), 접히는 규칙은 `FloatingStatusDock` 이 읽는다 */
  const pinned = $derived(dockPinned());
  const pinTip = $derived(t(pinned ? "app.dock.pin.off" : "app.dock.pin.on"));

  // ---------------------------------------------------------------------------
  // 끌어서 순서 바꾸기
  //
  // 탭 스트립(`Tabs.svelte`)의 몸짓을 그대로 가져온다: **버튼이 손잡이**(`draggable`)이고,
  // 놓을 자리는 **버튼 사이의 삽입선**으로 미리 보인다 (`dropBefore` = 이 칸 앞 · `dropEnd`
  // = 맨 뒤). 이벤트는 스트립 한 곳에서 **위임**으로 받는다 — 마크업에 직접 달면 칸마다
  // 다섯 줄이 붙고, 저쪽과 다른 규칙이 자랄 자리가 생긴다.
  //
  // 짐(mime)이 **따로**라는 점이 중요하다 (`x-aynx-status`): 이 띠 위로는 탭·타일·호스트
  // 드래그도 지나가는데, 그것들을 여기서 받으면 안 된다 (`onOver` 가 우리 종류일 때만
  // `preventDefault` 하므로 나머지는 그대로 통과한다).
  //
  // 순서 바꾸기에는 **키보드 길도 있다** (2026-09-17 —
  // docs/log/2026-09-17-keyboard-reorder.md). 칸은 이미 `<button>` 이라 Tab 으로 닿고, 닿은
  // 칸에서 `Alt+←/→`(세로 기둥에서는 `Alt+↑/↓` 도) 로 한 칸, `Home`/`End` 로 양 끝까지
  // 간다. 그 사실을 아는 자리가 화면에 없으므로 **툴팁 둘째 줄**로 적어 둔다.
  // 저장은 드래그와 **같은 통로**(`reorder` → `setStatusOrder`)를 지난다.
  //
  // 창 드래그 영역(`data-tauri-drag-region`)과는 겹치지 않는다 — 이 띠에는 그 표식이 하나도
  // 없다 (창을 옮기는 자리는 탭 바의 빈 공간뿐이다).
  // ---------------------------------------------------------------------------

  /** 이 띠의 순서 바꾸기 전용 짐 — 다른 드래그(탭·타일·호스트)와 섞이지 않게 */
  const STATUS_DRAG_TYPE = "x-aynx-status";

  let lead = $state<HTMLDivElement | null>(null);
  /** 지금 끌고 있는 칸의 id (`null` = 드래그 중이 아니다) */
  let dragId = $state<string | null>(null);
  /** 삽입선을 그릴 칸 — "이 칸 **앞**" 이라는 뜻이다 */
  let dropBefore = $state<string | null>(null);
  /** 칸이 아닌 띠의 빈 자리 위 = 맨 뒤로 */
  let dropEnd = $state(false);
  /** 맨 뒤 삽입선을 그릴 마지막 칸의 id */
  const lastId = $derived(items.at(-1)?.id ?? null);

  /**
   * 드래그가 끝난 시각 — 놓은 직후에 따라오는 `click` 하나를 무시하는 데 쓴다.
   *
   * 브라우저마다 드래그 몸짓 끝에 클릭을 얹기도 한다. 그것이 새어 나가면 **자리를 옮겼을
   * 뿐인데 그 칸이 실행된다** (설정 독이 열리거나 터미널이 하나 더 뜬다). 창을 하나 만들지
   * 않고 시각 하나로 막는다 — 250ms 는 사람이 놓고 다시 누르기에는 짧고, 드래그가 낳은
   * 클릭을 잡기에는 넉넉하다.
   */
  let dragEndedAt = 0;
  const justDragged = () => dragId !== null || performance.now() - dragEndedAt < 250;

  function clearDrop() {
    dropBefore = null;
    dropEnd = false;
  }

  /**
   * 커서가 가리키는 **놓을 자리** — `"id"` = 그 칸 앞 · `null` = 맨 뒤 ·
   * `undefined` = 판단할 수 없다(칸 사이 틈 `--sb-gap` 위) → 직전 판단을 그대로 둔다.
   *
   * 칸의 **가운데**를 기준으로 앞뒤를 가른다. "언제나 그 칸 앞" 으로 하면 마지막 칸 뒤로
   * 옮길 방법이 없어진다 — 띠에는 탭 스트립 같은 빈 여백(`.dragspace`)이 없기 때문이다.
   */
  function dropTarget(ev: DragEvent): string | null | undefined {
    const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-status-id]") : null;
    const id = t?.dataset.statusId ?? "";
    if (!t || id === "") return undefined;
    const r = t.getBoundingClientRect();
    const after = vertical ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
    if (!after) return id;
    const i = items.findIndex((item) => item.id === id);
    return items[i + 1]?.id ?? null; // 마지막 칸의 뒤 = 맨 뒤
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
      if (!isStatusDrag(ev)) return; // 탭·타일·호스트 드래그는 이 띠를 그냥 지나간다
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      const to = dropTarget(ev);
      if (to === undefined) return; // 칸 사이 틈 — 직전 표시를 그대로 둔다
      // **달라지는 것이 없으면 선을 그리지 않는다** (자기 자신 앞·이미 그 자리). 판정은
      // 순수 모듈 하나(`reorder`)로 하므로 미리보기와 실제 결과가 갈릴 수 없다.
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
      if (before === null && !end) return; // 놓을 자리를 못 정했다 (선도 없었다)
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
     * 칸에 포커스가 있을 때의 **순서 바꾸기 키** — 드래그의 짝이다.
     *
     * ## 왜 여기서 `stopPropagation` 하는가 — `Alt+화살표` 는 전역 키다
     *
     * `Alt+화살표` 넷은 레지스트리에서 **타일 간 포커스 이동**(`focus-left` …)이고,
     * `focus-*` 무리는 `bypassesEditGuard` 에 들어 있어 포커스가 버튼·입력칸 어디에 있어도
     * 그대로 실행된다. 가만히 두면 글리프 위에서 `Alt+→` 를 눌렀을 때 칸은 그대로 있고
     * **옆 타일로 포커스만 날아간다**. 전역 처리기는 창의 **버블 단계**에 붙어 있으므로
     * (`+page` 의 `svelte:window onkeydown`) 이 띠에서 뜻을 정한 조합만 여기서 멈춰 세운다 —
     * **나머지 키는 손대지 않는다** (띠에 포커스가 있다고 전역 단축키가 죽으면 안 된다).
     *
     * 메뉴는 언제나 가로이므로 `←/→` 로 순서를 바꾼다. 조합은 `ev.code`(물리 키)로만 가른다 — IME 안전
     * (`keybindings.ts` 의 조합 규칙과 같은 근거).
     */
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-status-id]") : null;
      const id = t?.dataset.statusId ?? "";
      if (id === "") return;
      const back = ev.code === "ArrowLeft" || (vertical && ev.code === "ArrowUp");
      const fwd = ev.code === "ArrowRight" || (vertical && ev.code === "ArrowDown");
      const n = items.length;
      // `Home`/`End` 는 Alt 를 따지지 않는다 — 글리프 버튼 위의 두 키에는 원래 뜻이 없다.
      const delta =
        ev.altKey && back ? -1 : ev.altKey && fwd ? 1 : ev.code === "Home" ? -n : ev.code === "End" ? n : 0;
      if (delta === 0) return;
      ev.preventDefault();
      ev.stopPropagation(); // 전역 `focus-*` 에 넘기지 않는다 (위 주석)
      const target = moveTarget(items.map((i) => i.id), id, delta);
      if (!target) return;
      const next = reorder(allItems, id, target.to);
      if (next === allItems) return; // 달라진 것이 없다 — 저장도 하지 않는다 (드래그와 같은 규칙)
      setStatusOrder(next.map((i) => i.id));
      /*
       * **옮긴 칸에 포커스를 되돌려 준다.** 띠가 다시 그려지면 눌렀던 버튼은 포커스를 잃고,
       * 그러면 `Alt+→` 를 두 번 눌러도 **한 번만 먹는다**(둘째 키는 이미 다른 데로 간 포커스를
       * 따라간다). 헤드리스로 확인한 실제 증상이다 — docs/log/2026-09-17-keyboard-reorder.md.
       */
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

<!-- 창이 흔들리면(크기 · 포커스 잃음 · 휠) 카드를 접는다 — 자리를 다시 재지 않는다(공용 말풍선과 같은 판단) -->
<svelte:window onresize={onWindowShake} onblur={onWindowShake} onwheel={onWindowShake} onscroll={onWindowShake} />

<!--
  **하단 가운데 즐겨찾기 독** — 창 아래 가운데에 커서를 대면 올라온다(`FloatingStatusDock`). 2026-10-18 통합 독 때 걷었다가 실기 뒤
  **즐겨찾기 칸만** 되살렸다 — 예전에 함께 서던 파일 · 설정 칸은 사이드 독(아이콘 줄 · 실행 단추)으로 갔으므로 다시 넣지 않는다.
  2026-10-18(End-4 식): 맨 **오른쪽**에 **런처 단추**(사이드 독 여닫기)가 늘 서서 즐겨찾기가 비어도 독이 뜬다(사용자: 런처는 오른쪽).
  2026-10-23: 판 = **핀 | 즐겨찾기… | 런처**(구분선은 칸 묶음 양옆 — 비면 핀 | 런처). 핀은 독 고정(켜면 고른 칩과 같은
  secondaryContainer 원 · `aria-pressed`). 판 전체가 사이드 독의 호스트 · 프로젝트 · DB 연결 줄을 받는다(`DockFavorites` 의 `dragOver` · `drop`
  — 우리 짐일 때만 막는다). 즐겨찾기를 다루는 곳은 이 독 하나이고(2026-10-23 — 시작 화면 줄은 걷었다), 우클릭 메뉴는 이 컴포넌트 안에서 독 **안**에 뜬다(밖에 두면
  바깥 누르기 감지가 메뉴 줄을 누르는 순간 독을 접는다). 런처 단추의 `data-chrome-toggle` 은 사이드 독의 바깥 누르기 감지가 물러나게
  하는 표식이다(아래 선두단 주석 — 없으면 pointerdown 에 닫히고 click 에 다시 열린다).
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
    <!--
      선두단 — 지금은 **비어 있다** (`status-items.ts` — 2026-10-18 통합 독 때 메뉴 칸이 독 안으로 들어가고, 실기 뒤 독 입구 칸도
      걷혔다). 자리(첫 28%)는 그대로 두어 가운데 묶음이 서는 자리가 바뀌지 않는다. 순서 바꾸기 틀(끌기 · `Alt+←/→`)은 칸 표를
      따라 남아 있다 — 칸이 다시 생기면 툴팁에 단축키를 함께 적는다.

      토글 칸에는 `data-chrome-toggle` 이 붙는다: "이 컨트롤이 떠 있는 크롬 표면을 스스로
      토글한다" 는 표식이다. 독의 바깥 클릭 감지(`Dock.svelte` 의 캡처 단계
      `onOutsidePointerDown`)가 이 버튼의 `pointerdown` 을 **바깥 클릭으로 오인해 미리 닫으면**,
      곧이어 오는 `click` 의 `toggleDock` 이 (이미 닫힌 것을 보고) 도로 열어 버린다 — 그래서
      같은 글리프를 다시 눌러도 닫히지 않는 경쟁이 생긴다. 저쪽이 이 표식을 보고 물러난다.
    -->
    <div class="lead" bind:this={lead}>
      {#each items as item (item.id)}
        {@const title = shortcutTitle(t(item.labelKey), combosOf(item))}
        {@const open = isOpen(item)}
        <!-- 툴팁은 이름(+조합) 한 줄이다 — 설명 문장은 달지 않는다(순서 바꾸기의 Alt+←/→ 키는 그대로 산다) -->
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
        <!--
          **자원 고리**(2026-10-17) — 이 PC 전체 CPU · 메모리. 사용량 고리와 같은 그릇(20px 다이얼 · `pathLength=100` · 세로는 아래에 숫자만,
          가로는 `n%`)이고 안쪽 마크만 아이콘(칩 · 램)이다. 누르면 자원 화면(토글), 얹으면 카드(`ResourceHoverCard`).
        -->
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
        <!-- 자원 묶음과 에이전트 사용량 사이의 얇은 구분선 — 사용량 고리가 없으면 서지 않는다 -->
        {#if resItems.length > 0 && usageRings.length > 0}<span class="r-sep" data-rings-sep aria-hidden="true"></span>{/if}
        {#each usageRings as ring (ring.agent)}
          <!--
            **사용 한도 고리** — 조건부 신호와 달리 **늘** 선다(한도는 늘 알아야 하는 사실이다). 회색이 기본이고
            80% 부터 경고색 · 95% 부터 오류색(강조색은 쓰지 않는다). 값이 묵었거나 초기화가 지나도 흐리게 하지 않는다 — 호버 카드가 그 상태를 말한다(2026-10-11 사용자 결정, `data-stale` 표식만 남김).
            가로 띠는 옆에 "10%", 세로 기둥은 아래에 "10"(칸 폭이 좁다).
          -->
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
      <!--
        **원격 칩**(R1a-5) — 집 PC 창은 원격으로 쓰는 기기가 있을 때만 "원격 접속 중 (N)"(끌 수 없다), 원격 창은 늘
        "원격 — <기기 이름>" + 잠그기. 상태 · 상자는 칩 컴포넌트가 앱 모듈에서 직접 읽는다(알림 상자와 같은 모양).
      -->
      <RemoteChip {position} {vertical} />
      {#if onchat}
        <!-- 폰 사이드 채팅(2026-11-01) — 알림 알약과 같은 판 · 점은 종의 점 자리(오른쪽 위 모서리) -->
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
        자물쇠(화면 잠금 — 2026-10-07 부터 늘 섰다)는 2026-10-23 독 머리 아이콘 줄로 옮겼다(`Dock.svelte` — 사용자 요청). 동작은
        그대로 `toggle-veil`(가림막 + 볼트 잠금)이고 볼트 상태 그림(🔓 · 🔒)도 그 단추가 그린다.

        **알림 알약** — 2026-10-24 End-4 알약(사용자 결정): End-4(Hyprland illogical-impulse) 상태줄의 오른쪽 끝처럼 **단추 하나**인
        알약 안에 표시 아이콘이 한 줄로 선다(왼→오: ⚡ 자동 승인 · ☕ 잠자기 방지 · 🔔 종 — 종은 늘 맨 끝). 원격 칩은 알약 밖 왼쪽이다.
        · 누르면 독의 알림 칸을 여닫는다(옛 종 그대로 — 칸 없이 독을 열어도 알림 칸이다). 열린 동안 알약은 secondaryContainer 로
          채워진다(End-4 의 열린 사이드바 — 이 앱에서 고른 칩 · 탭과 같은 판).
        · **⚡ · ☕ 는 표시뿐**이다 — 켜졌을 때만 서고(꺼짐이 정상이라 그리지 않는다), 따로 누를 수 없다(누르면 알약 = 알림 칸).
          예전에 ⚡ 는 설정 › 자동 승인을 열고 ☕ 는 껐는데 걷었다 — 켜고 끄는 자리는 각자 하나다(⚡ = 설정 › 자동 승인 ·
          ☕ = 독 실행 판의 ☕ 칸 — 토글). 나타나고 사라질 때 폭(세로 기둥은 높이)이 짧게 미끄러진다(`reveal` — End-4 Revealer).
          무엇이 켜졌는지는 각 표시의 `title` 과 알약의 `aria-label`(`trayLabel`)이 말한다.
        · **종** — 2026-10-24 A안: 종 글리프가 **늘** 선다(2026-10-18 통합 독에서 수만 서고 0 이면 없던 것을 되돌렸다 — 알림 칸으로
          가는 손잡이가 늘 같은 자리에 있게). 종 모서리에는 둘 중 하나만 얹힌다:
          · **숫자 배지** — 승인 대기 + 확인할 에이전트 알림(일반 알림은 세지 않는다 — 2026-09-27). 100 이상은 `99+`(정확한 수는 툴팁).
            강조색은 **승인 대기 · 권한 물음**이 있을 때만이다(`.urgent`) — 사람이 답해야 멈춘 일이 풀리는 부름이라서다. 끝난 턴만
            남았으면 중성(세어 준 사실).
          · **점** — 숫자가 0 이고 일반 알림 목록에 읽지 않은 줄이 있을 때. 수는 말하지 않고, 알림 칸을 열면 읽음이 되어 사라진다.
          깜빡이지 않는다.

        `data-chrome-toggle` — 독의 바깥 클릭 감지가 비켜 가는 표식이다(없으면 다시 눌러 닫을 때 `pointerdown` 이 먼저 닫고
        뒤따르는 `click` 이 도로 연다 — 선두단 토글 칸과 같은 경쟁). `data-signal` 은 하네스용 — 알약 단추 `notify`, 안의 표시
        `auto-approve` · `keep-awake`(span).
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

<!-- 사용량 호버 카드 — 고리에 붙어 뜬다(`position: fixed` · 가로 띠는 위·아래, 세로 기둥은 옆 — 본문 쪽). -->
{#if usageHover && hoveredRing}
  <UsageHoverCard
    ring={hoveredRing}
    anchor={usageHover.rect}
    side={!vertical ? "vertical" : position === "left" ? "right" : "left"}
  />
{/if}

<!-- 자원 호버 카드 — 사용량 카드와 같은 자리 · 같은 층 · 같은 방향 규칙. -->
{#if resHover && resItems.length > 0}
  <ResourceHoverCard
    metric={resHover.metric}
    anchor={resHover.rect}
    side={!vertical ? "vertical" : position === "left" ? "right" : "left"}
  />
{/if}

<style>
  /* 하단 가운데 즐겨찾기 독의 판 — 예전 하단 독 그대로(34px 칸 · 52px 높이 · 뜬 면 재질). 즐겨찾기 칸만 담는다 */
  /*
   * End-4 식 독(2026-10-18) — 창 아래 가운데 알약 판: 다른 뜬 면과 같은 글래스(평면 surfaceContainer) · 그림자 · 안쪽 6px.
   * 칸 = 44px 원(`DockFavorites` — cHigh 판), 맨 뒤 런처 단추는 primary 채움 + onPrimary 원, 맨 앞 핀은 36px 원.
   * 모서리(2026-10-26 사용자): 큰 면 16 규칙의 예외 — 한 줄짜리 독이라 판은 완전한 알약(999px), 칸은 원. 판 높이 58 의
   * 반원과 안쪽 6px 안의 44px 원이 같은 중심이다.
   */
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
    border-radius: 999px; /* 알약 판(위 머리말 — 큰 면 16 의 예외) */
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
    border-radius: 50%; /* 원 — 즐겨찾기 칸과 같은 모양 */
    cursor: pointer;
  }
  .fdock-launcher:hover {
    background: var(--control-on-bg-hover);
  }
  .fdock-launcher:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  /* 핀 — 꺼짐은 투명(호버 = 옅은 상태 층), 켜짐은 고른 칩과 같은 secondaryContainer 원 */
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

  /*
   * 앱 크롬의 얇은 띠. 색은 전부 테마 토큰이라 라이트/다크가 저절로 따라온다. `user-select`
   * 는 끈다 — 상태를 읽는 자리이지 글자를 긁는 자리가 아니다. 본문과 맞닿는 가장자리에만
   * `--line` 한 줄을 그어 층위를 낸다 (아래=위쪽 선, 위=아래쪽 선, 왼쪽=오른쪽 선…).
   *
   * **층 0 이라 조용하다** (작업면 단계 — docs/log/2026-09-25-work-surface.md): 글리프는 흐림
   * 회색(`--fg-3`), 손이 닿으면 한 단, 열려 있으면 본문 글자 + 회색 판(알림 알약만 열림 = secondaryContainer — 2026-10-24 End-4 알약). 강조색은 알림 배지
   * (`.notify-pill.urgent` — 승인 대기·권한 물음) · 독 입구의 부름 점 · 끌어 옮기는 삽입선에만 남는다.
   * 글자는 `--t-xs`(12px) 한 단이다 — 옛 `--sb-font*` 세 단(12/11/10)을 접었다. 예외는 종 모서리의
   * 숫자 배지(11px) 하나뿐이다 (`.notify-pill` 주석).
   */
  .statusbar {
    /* 가운데 묶음(자원 · 사용량 고리)이 서기 시작하는 자리 — 가로 · 세로 모두 상태바 전체 길이의 28% */
    --status-middle-start: 28%;
    box-sizing: border-box;
    display: grid;
    align-items: center;
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    /* 재질 글래스면 옅은 띠 판 — 흐림은 `.glass-band` 의 `::before` (theme.css 재질 절) */
    background: var(--glass-band, var(--surface-raised));
    user-select: none;
  }

  /* 가로: 메뉴(첫 28%) → 사용량 고리(28% 지점부터) → 앱 신호·알림. 좁은 창에서는 메뉴가 제 칸
     안에서 스크롤하고(뒤 24px 여백), 가운데는 넘치면 잘린다 — 후미와 겹치지 않는다. */
  .statusbar:not(.vertical) {
    grid-template-columns: var(--status-middle-start) minmax(0, 1fr) max-content;
    height: var(--sb-h);
    /* 양끝 여백 — 첫·마지막 글리프가 띠 끝에 붙지 않게 한 단 더(`--space-3`, 2026-10-05 · 예전 `--space-1`) */
    padding: 0 var(--space-3);
  }
  .statusbar[data-pos="bottom"] {
    border-top: 1px solid var(--line);
  }
  .statusbar[data-pos="top"] {
    border-bottom: 1px solid var(--line);
  }
  /* 감싸기(hug) — 타일 쪽 선은 캔버스(`+page` 의 `.pane`)가 둥근 모서리와 한 줄로 긋는다(반투명 면 위에 겹쳐
     비치지 않게 여기서는 지운다) */
  /* `[data-pos]` 까지 — 아래의 자리별 테두리 규칙(`[data-pos="left"]` 등)과 세기가 같으면 뒤에 오는 그쪽이 이겨 옆선이 남았다.
     투명이 아니라 **없앤다** — 흐림 판(`::before`)은 테두리 안쪽만 덮어, 투명한 1px 칸으로 흐리지 않은 바탕이 비쳤다 */
  .statusbar[data-style="hug"][data-pos] {
    border: none;
  }
  /* 모바일 배치는 감지 않는다(타일이 가장자리까지 — `+page` 의 감싸기 절 · 10-20) — 평면의 아래 선 그대로 */
  :global(.app.mobile) .statusbar[data-style="hug"][data-pos="top"] {
    border-bottom: 1px solid var(--line);
  }
  /* 글래스 띠의 위 가장자리 하이라이트(`--glass-edge`)도 끈다 — 탭 줄 · 띠 · 감긴 모서리가 한 면으로 이어지게(그 직선이
     감긴 곡선 옆에 직각으로 남았다). 전역 `.glass-band::before` 보다 한 단 세게 */
  .statusbar[data-style="hug"][data-pos]::before {
    box-shadow: none;
  }
  /*
   * 감싸기 + 글래스 — 흐림 판을 **한 장**으로. 띠의 흐림 판(`.glass-band::before`)을 타일 쪽으로 감긴 반지름(`--hug-r` =
   * 캔버스 틈 + 타일 모서리 — `+page` 의 모서리 조각과 같은 값)만큼 늘리고, 늘어난 칸에서는 두 모서리의 곡선 바깥만
   * 남긴다(마스크). 조각이 따로 흐리면 두 판이 맞닿은 곳에 이음매가 직선으로 비쳤다(10-16 실기). 조각은 그 위에 면 색만.
   * 데스크톱 배치는 창 전체 판 한 장이 크롬을 흐리고 이 판은 꺼진다(`+page` 의 감싸기 절, 10-17). 모바일 배치는 감지 않으므로
   * (10-20 — 타일이 가장자리까지) 늘리지 않는다(`:not(.mobile)`) — 지금은 이 늘림을 쓰는 자리가 없다.
   */
  .statusbar[data-style="hug"] {
    --hug-r: calc(var(--gap) + var(--radius-surface));
    /* 늘리는 폭 = 모서리 조각의 한 변(반지름 + 1px 선) — 오린 원의 중심이 조각 곡선의 중심과 같아야 사이로 바탕이 안 샌다 */
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

  /* 세로(왼쪽·오른쪽) — `--sb-w` 폭 (왼쪽이면 독이 같은 값으로 비켜 선다 — `+page` 의
     `--dock-inset-left`). 메뉴는 위(첫 28% — 메뉴가 더 길면 메뉴 끝까지), 사용량 고리는 그 다음, 후미는 맨 아래다. */
  /* 높이는 적지 않는다 — 부모 `.body`(가로 flex)의 기본 `align-items: stretch` 가 채운다.
     `height:100%` 는 panel 의 위·아래 여백만큼 창 밖으로 밀려 아래 모서리가 잘렸다
     (docs/log/2026-09-29-statusbar-panel-vertical.md). stretch 는 여백을 빼고 채운다. */
  /* 첫 줄은 **28% 와 메뉴 높이 중 큰 쪽**이다(`minmax(28%, max-content)` — max 가 min 보다 작으면 min).
     창이 낮아 메뉴가 28% 를 넘으면 메뉴는 스크롤하지 않고 제 키를 다 쓰고, 사용량 고리가 그만큼 아래로
     밀린다. 고리 칸마저 모자라면 거기서 잘린다(스크롤 없음 — 후미와 겹치지 않는다). */
  .statusbar.vertical {
    grid-template-rows: minmax(var(--status-middle-start), max-content) minmax(0, 1fr) max-content;
    width: var(--sb-w);
    padding: var(--space-3) 0; /* 위·아래 끝 여백 — 가로 띠의 양끝과 같은 값 */
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

  /* 글리프 버튼 — 고스트 관용구(투명 → `--surface-hover`)를 그대로 따른다.
     `position:relative` 는 아래 삽입선(`::after`)의 기준점이다.
     안에 드는 것은 이제 글자가 아니라 `UiIcon` 의 SVG 하나다 (2026-09-15) — 색은 이 규칙의
     `color` 를 `currentColor` 로 물려받으므로 호버·활성 규칙은 그대로 산다. 글꼴 관련 세 줄은
     드래그 중 브라우저가 만드는 기본 이미지의 줄 높이에만 남는 몫이라 건드리지 않는다. */
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
    /* 아이콘은 보조색 — 흐림(`--fg-3`, 바탕 대비 약 2.8~3.2:1)이던 것을 올렸다. 글래스 띠·번짐 바탕·월페이퍼·색 테마
       위에서는 그보다 더 떨어져 아이콘이 잘 안 보였다(2026-10-11 실기). 켜짐은 회색 판 + 본문 글자(`.active`)가 말한다 */
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

  /*
   * 알림 알약(2026-10-24 End-4 알약) — End-4 상태줄 오른쪽 끝의 RippleButton 알약 하나. 띠 칸 높이(`--sb-cell-h` 26px) 안의
   * 24px 알약(`999px`)이고 안쪽 여백 · 아이콘 사이 모두 9px 이다. 평소 바탕은 투명 · 글자는 다른 칸과 같은 회색(`.glyph` 의
   * `--fg-2`), 손이 닿으면 `--surface-hover`(End-4 layer1Hover), 알림 칸이 열린 동안은 **secondaryContainer**
   * (`--control-sel-*` — 이 앱에서 고른 칩 · 탭의 판, End-4 의 열린 사이드바)로 채운다.
   *
   * 아이콘 사이 9px 은 flex `gap` 이 아니라 ⚡ · ☕ 표시 자신의 바깥 여백(`margin-inline-end` · 세로는 `margin-block-end`)이다 —
   * `slide` 가 폭과 함께 여백도 0 에서 키우므로 펼침 · 접힘 동안 종이 한 번에 튀지 않는다. 세로 기둥에서는 알약이 세로로 선다
   * (폭 24px · 위아래 9px — 펼침도 세로 축).
   */
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
  /* 종 칸 — 모서리 표식의 기준점(`position: relative`). 아이콘 크기(17px) 그대로의 네모다 */
  .tray-bell {
    position: relative;
  }

  /*
   * 알림 종의 모서리 표식(2026-10-24 A안) — 종 글리프(알약 글자색과 같은 회색)는 늘 서고, 그 **오른쪽 위 모서리**에 숫자
   * 배지(`.notify-pill`) 또는 점(`.notify-dot`) 하나가 겹쳐 얹힌다(기준점 = 종 칸 `.tray-bell`).
   * 둘 다 2px 테두리(`--notify-ring` — box-shadow)로 종과 떼어 보이는데, 그 색은 **알약 판을 따른다**: 평소 = 띠의 불투명 바탕
   * (`--surface-raised-solid` — 반투명 글래스 띠 색이면 종의 획이 테두리 너머로 비쳐 떼어 놓는 뜻이 없다) · 손이 닿으면
   * `--surface-hover` · 열림 = secondaryContainer(`--control-sel-bg`, 호버면 `-hover`).
   * 깜빡이지 않는다: 늘 보이는 띠에서 움직이는 것은 시선을 계속 빼앗는다.
   *
   * 숫자 배지의 기본은 **중성**(본문 글자 · 강한 선 판)이다 — 세어 준 수(끝난 턴)는 부름이 아니다. 강조색은 `.urgent`(승인 대기 ·
   * 권한 물음이 있을 때) 하나뿐이고 채운 알약이다 — "입력 대기" 와 같은 급의 "당신이 봐야 한다" 다. 알약이 열려 secondaryContainer
   * 로 채워지면 중성 배지 · 점은 onSecondaryContainer(`--control-sel-fg`) 판으로 뒤집혀 그 위에서 읽힌다(urgent 는 그대로 강조색).
   *
   * 글자는 띠의 한 단(`--t-xs` 12px)이 아니라 **11px** 이다 — 이 앱에서 12px 밖으로 남은 유일한 글자다(작업면 단계 결정 5 —
   * 종의 모서리에 앉는 크기). **숫자 배지에만** 허용한다.
   *
   * 자리: 가로 띠는 종 가운데 + 1px 에서 오른쪽으로 자란다(알약 끝 여백 9px · 띠 끝 여백 안 — `99+` 는 알약 밖으로 조금 나온다).
   * 세로 기둥(`--sb-w` 36px · 알약 24px)은 종 오른쪽 끝에서 6px 밖(기둥 오른쪽 끝 2px 안)에 붙여 **안쪽으로** 자란다 — 넓어져도
   * 기둥 밖으로 잘리지 않는다.
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
    pointer-events: none; /* 배지는 표식이다 — 클릭은 그대로 알약이 받는다 */
  }
  .statusbar.vertical .notify-pill {
    left: auto;
    right: -6px;
  }

  /* 읽지 않은 일반 알림의 점 — 수를 말하지 않는다. 중성(본문 글자색)이고 숫자 배지가 서면 그리지 않는다(템플릿) */
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

  /* 열린 알약(secondaryContainer) 위의 중성 표식 — onSecondaryContainer 판 · 글자는 그 반대 */
  .notify.active .notify-pill:not(.urgent) {
    color: var(--control-sel-bg);
    background: var(--control-sel-fg);
  }
  .notify.active .notify-dot {
    background: var(--control-sel-fg);
  }

  /* 폰 사이드 채팅 말풍선의 점 — 종의 점 자리 · 색은 채팅 독 점과 같은 말(답하는 중 강조 · 권한 경고 · 새 답 완료) */
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

  /* 지금 열려 있는 표면의 버튼 — 본문 글자 + 회색 판으로 "이게 켜져 있다" 를 말한다
     (강조색이던 것을 작업면 단계에서 뺐다). **액션 칸에는 이 클래스가 붙지 않는다**
     (켜지고 꺼지는 것이 아니다). */
  .glyph.active {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 끌고 있는 칸 — 원본은 흐려진다 (탭 스트립과 같은 말) */
  .glyph.dragging {
    opacity: 0.4;
  }

  /* 삽입선 — "이 칸 앞" 은 왼쪽(세로 기둥에서는 위), "맨 뒤" 는 마지막 칸의 오른쪽(아래).
     선(2px)은 칸 사이 틈(`--sb-gap`)의 한가운데에 선다 — 오프셋 = -(틈/2 + 1px). */
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

  /* 메뉴는 선두, 사용량 고리는 28% 지점부터, 앱 신호·알림은 후미. */
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
  /* 후미 앞 구분선은 걷었다(2026-10-05) — 가운데 칸(`overflow: hidden`)이 가득 차도 후미에 붙지 않게
     예전 구분선의 바깥 여백(`--space-2`)만큼 띄운다. 세로 기둥은 위쪽. */
  .statusbar:not(.vertical) .status-tail { grid-column: 3; justify-self: end; padding-left: var(--space-2); }
  .statusbar:not(.vertical) .lead { min-width: 0; overflow-x: auto; scrollbar-width: none; }
  /* 폰 배치(`+page` 의 `.app.mobile` — 위 띠 고정): 앞칸이 독 입구 하나뿐이라 28% 를 비워 두면 고리가 가운데로 밀린다.
     앞칸은 제 폭만 쓰고 가운데 묶음이 바로 뒤에 붙는다(뒤 여백도 한 단 — 후미는 그대로 오른쪽 끝). 데스크톱은 위 규칙 그대로. */
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

  /*
   * **탭 줄 안**(`inline` — 데스크톱 위 배치, 2026-10-28). 그리드 셋(28% · 가운데 · 후미) 대신 한 줄 flex — 묶음이 탭 뒤 · 창 단추 앞에
   * 제 폭만큼 오른쪽 끝 기준으로 붙고, 탭이 모자란 폭을 줄인다(탭 줄 `flex: 1; min-width: 0`). 판 색은 탭 줄과 같은 띠(평면 · 감싸기)이고
   * 아래 선도 탭 줄과 같다 — 둥근 패널 · 감싸기는 제목줄이 판 · 선을 끈다(`WindowTitlebar` 의 같은 절). 흐림 판(`::before`)은 늘 끈다 —
   * 제목줄 · 창 전체 판 한 장이 든다. 선두단(지금 빈 칸)은 그리지 않는다.
   */
  .statusbar[data-pos="inline"] {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    align-self: stretch;
    height: auto;
    /* 양끝 여백 = 아래 띠와 같은 `--space-3` — 알림 알약 오른쪽 끝이 아래 배치와 같은 자리에 선다(사용자 10-28) */
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
  /* 고리 묶음과 후미(원격 칩 · 알림 알약) 사이 — 한 단 더 띄워 두 묶음이 갈려 읽히게(사용자 10-28) */
  .statusbar[data-pos="inline"] .status-tail {
    margin-left: var(--space-2);
  }
  :global(:root[data-material="glass"]) .statusbar[data-pos="inline"]::before {
    display: none;
  }

  /* 후미에는 앱 전체 상태(원격 칩 · 알림 알약 — ⚡ · ☕ · 종)만 남긴다. */
  .signals {
    display: flex;
    align-items: center;
    gap: var(--sb-gap); /* 선두단 칸 사이와 같은 값 */
  }
  .statusbar.vertical .signals { flex-direction: column; }
  .rings {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--sb-gap);
  }
  .statusbar.vertical .rings { flex-direction: column; }
  /* 자원 고리와 사용량 고리 사이 — 가로 띠는 세로 1px, 세로 기둥은 가로 1px(목업 `.hsep` · `.sep`) */
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

  /* 사용 한도 고리 — 글자(%)가 붙어 칸 폭을 스스로 잡는다(고정 칸 `--sb-cell-w` 를 넘는다). 세로 기둥에서는
     고리 아래에 숫자만. 회색 · 경고색 · 오류색 — 강조색은 쓰지 않는다. */
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

  /* 잠긴 볼트 — 단추가 아니라 표식이다(`<span role="img">`). 커서도 호버도 없다. */
  .glyph.signal.static {
    cursor: default;
  }
  .glyph.signal.static:hover {
    color: var(--fg-2);
    background: transparent;
  }

  /* ── 상태바 스타일: panel(둥근 패널) ──────────────────────────────────────────
     flat 은 위 기본 규칙 그대로다. panel 은 타일처럼 사방 여백+전 모서리 둥글게 띄운다. */

  /* panel — 타일처럼 떠 있는 둥근 패널 (전 모서리 + 테두리 + 여백).
     캔버스 쪽 변에는 여백을 두지 않는다 — 캔버스가 이미 `--gap` 만큼 안쪽에서 시작하므로 패널 ↔ 타일도 타일끼리 · 창 끝과
     같은 8px 이다(10-17 — 예전에는 패널 쪽 `--space-1` 이 더해져 12px). 모바일 배치(위 띠)는 예전 여백 그대로. */
  .statusbar[data-style="panel"] {
    border: 1px solid var(--line);
    border-radius: var(--radius-surface); /* 떠 있는 면 — 타일과 같은 큰 면 모서리(2026-10-25) */
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
  /* 탭 줄 안(`inline`)은 따로 뜬 패널이 아니다 — 둥근 판 · 선은 제목줄 패널이 든다(`WindowTitlebar` 의 panel 절). 패널 테두리 ·
     모서리가 남으면 자원 · 사용량 · 알림 묶음이 알약으로 한 번 더 둘러싸였다(10-29 사용자) */
  .statusbar[data-style="panel"][data-pos="inline"] {
    border: none;
    border-radius: 0;
  }

  /*
   * 글래스 가장자리 — 독 · 메뉴와 같은 옅은 선 하나(theme.css 재질 절의 `--glass-rim`)를 모양마다. 평면(flat)은 캔버스와 맞닿은
   * 안쪽 변 하나, 둥근 패널(panel)은 네 변, 감싸기(hug)는 데스크톱이면 `+page` 의 캔버스 선이 진다(이 띠에는 테두리가 없다 —
   * 모바일 배치는 평면과 같다). 10-22 의 안쪽 빛 띠는 10-29 에 걷었다.
   * 판은 테두리 안쪽(`padding-box`)만 칠한다 — 뜬 면과 같은 이유(반투명 선 밑에 판이 깔려 선이 한 번 더 밝아지지 않게).
   * 띠의 위 빛 선(`--glass-edge`)은 끈다 — 선 옆의 둘째 줄이 되고, 세로 기둥에서는 창 위 가장자리에 빛이 섰다.
   */
  :global(:root[data-material="glass"] body) .statusbar[data-pos] {
    border-color: var(--glass-rim);
    background-clip: padding-box;
  }
  :global(:root[data-material="glass"]) .statusbar[data-pos]::before {
    box-shadow: none;
  }
</style>
