<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import type { ExitSide } from "$lib/dock-alert-exit";
  import { exitingIn, makeEmptyIn, makeRowExit } from "$lib/row-exit";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { relativeTime, type NotificationEntry } from "$lib/notifications";
  import {
    dismissNotification,
    markNotificationsRead,
    notificationList,
  } from "$lib/app/notifications.svelte.js";
  import { pendingPlans } from "$lib/app/pending-plans.svelte.js";
  import {
    agentBannerItems,
    forgetResolvedBanner,
    openAgentBanner,
    resolvedAgentBanners,
  } from "$lib/app/agent-banners.svelte.js";
  import type { ResolvedBanner } from "$lib/agent-banners";
  import { groupAlertRows, type AlertGroup, type AlertGroupView } from "$lib/dock-alert-groups";
  import { openPlansAt } from "$lib/app/plans.svelte.js";
  import { openSideChatFromAlert } from "$lib/app/side-chat-open";
  import { focusTile, tabOfPane } from "$lib/app/tabs.svelte.js";
  import { currentWorkspaceId } from "$lib/app/workspaces.svelte.js";
  import { windowSessionCards, workspaceSheetBuckets } from "$lib/console/window-cards";
  import { sheetBuckets, sheetCounts } from "$lib/console/session-sheet";

  /**
   * **독의 알림 칸** (2026-10-18 통합 독) — 예전 상태바 종(🔔)이 띄우던 알림 센터 팝오버
   * (docs/log/2026-09-25-notification-center.md)를 독 안으로 옮긴 것이다. 그리는 것은 그대로 넷이다:
   *
   * 0. **세션 요약 줄** — "세션 · 실행 N · 대기 N ›"(이 워크스페이스 — 워크스페이스가 없는 창이면 창 전체). 옛 상태바 세션 칸의
   *    배지와 같은 재료(`workspaceSheetBuckets` · `sheetBuckets`)이고 수는 둘 다 센다(`sheetCounts`). 누르면 독을 닫고 세션 목록 판.
   * 1. **승인 대기 N건** — 대기가 있을 때만, 그리고 그 수를 세는 창(메인 창)에서만 선다
   *    (`app/pending-plans` 는 메인 창의 부팅만 건다 — 분리 창에서는 목록이 늘 비어 이 칸이
   *    저절로 빠진다). 누르면 검토 대기 카드의 [작업안에서 보기]와 **같은 곳**으로 간다 —
   *    작업안의 진행 보기, 가장 오래된(= 먼저 만료될) 작업안.
   * 2. **확인할 것** — 해결되지 않은 에이전트 알림(턴 끝 · 권한 물음 — `app/agent-banners`, 사이드 채팅의 끝남 · 권한 · 실패 포함). × 로
   *    배너에서 비킨 것도 "나중에" 표시를 달고 여기 남는다. 누르면 그 타일로 가며(채팅이면 그 채팅을 열며) 해결된다(배너의
   *    [보기] 와 같다 — 2026-09-27, docs/log/2026-09-27-agent-banners.md).
   * 3. **지난 알림** — 해결된 에이전트 알림("확인함" · "저절로 해결")과 이 창에서 띄운 일반 알림
   *    (`app/notifications`)을 시각 순으로 합친 것, 새것이 위.
   *    타일을 가리키는 줄은 누르면 그 타일로 간다(탭은 **누를 때** 다시 찾는다 — 그 사이 타일을
   *    다른 탭으로 옮겼을 수 있다). 줄마다 ×. **같은 출처의 줄은 묶음 카드 한 장**으로 접는다(가장 최근 줄 + 개수 칩 —
   *    열쇠는 기록할 때 정한 `group` · 규칙은 `$lib/dock-alert-groups`). 카드 본문은 최근 줄처럼 그 타일로 가고, 옆 펼침 단추가
   *    나머지 줄을 아래에 편다(펼침은 이 컴포넌트 메모리뿐). 카드의 × 는 묶음 전체를 지운다. 한꺼번에 지우기는 목록 맨 아래가 아니라 독 바닥 줄의 [알림 지우기]다
   *    (2026-10-24 — `Dock.svelte` 의 `clearAlerts` · [모두 읽음] 옆).
   *
   * **칸이 보이는 동안 전부 읽음이다**(`open` — 팝오버 시절 "열려 있는 동안" 규칙 그대로) — 칸을 본 것이 곧 본 것이고, 보는 채로
   * 새로 들어온 줄도 눈앞에 뜬다. 다만 **칸이 보이기 시작할 때 읽지 않았던 줄**은 점 하나로 표시해 둔다(무엇이 새로 왔는지가
   * 연 순간 사라지면 연 보람이 없다). 본문은 독과 같이 **언마운트하지 않으므로** 그 점은 칸이 다시 보일 때마다 새로 잡는다.
   *
   * 사이드 채팅 알림(턴 끝 · 권한 물음 · 실패)은 2026-11-13 부터 AI 타일 알림과 같은 배너 저장소에 산다(대상이 `sideChatId` — 일반 기록에는
   * 적히지 않는다). 해결된 줄은 누르면 그 채팅을 연다 — 채팅 독, 원격 폰 배치는 폰 덮개(`app/side-chat-open`).
   *
   * 다른 곳으로 가는 줄(세션 · 승인 대기 · 타일로 가기 · 작업안 실행 · 사이드 채팅)은 **메뉴 통로**(`runOnMenu` · `runAfterClose`)를 지난다 —
   * 스냅샷 → 독 닫기 → 실행 (docs/conventions.md). × 와 바닥 줄의 [알림 지우기] 는 독을 닫지 않으므로 통로가 필요 없다.
   *
   * **지운 줄은 밀려 나간다**(2026-10-24 — End-4 사이드바 알림 지우기): × · [알림 지우기] 는 데이터에서 곧바로 빼고, 줄의 DOM 만
   * `out:rowExit` 로 독이 붙은 가장자리 쪽으로 밀려 나가며 흐려진 뒤 높이가 접힌다. 여러 줄이 함께 나가면 위 줄부터 차례로
   * (수 · 상한은 `$lib/dock-alert-exit`). 나가는 줄은 Svelte 가 `inert` 로 둔다 — 누를 수도, ↑↓ 로 갈 수도 없다. 열 때 들어오는
   * 움직임은 없다(`in:` 을 줄에 달지 않는다 — 빈 상태 문구의 `in:` 은 첫 마운트 때 돌지 않는 Svelte 5 지역 트랜지션).
   *
   * 가림막이 내려오면 독 자신이 숨는다(z-index 100 < 가림막 115) — 팝오버(121) 시절의 "스스로 닫기" 는 필요 없어졌다.
   * Escape 는 여기서 받지 않는다 — 독의 Escape(`Dock.svelte`)가 닫는다.
   */
  let {
    open,
    onclose,
    onsessions,
    side = "left",
  }: {
    /** 이 칸이 지금 보이는가(독이 열려 있고 알림 칸) — 읽음 처리 · 시계 · 새 줄 점의 기준 */
    open: boolean;
    /** 독을 닫는다 — 다른 곳으로 가는 줄이 실행 **전에** 부른다(메뉴 통로) */
    onclose: () => void;
    /** 세션 목록 판을 연다(`toggleSessionSheet` — `open-console` 과 같은 몸통) */
    onsessions: () => void;
    /** 독이 붙은 화면 가장자리 — 지운 줄이 이쪽으로 밀려 나간다(`Dock.svelte` 의 `dockRight` — 설정 `[dock] layout`) */
    side?: ExitSide;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  const list = $derived(notificationList());
  const pending = $derived(pendingPlans());
  const todo = $derived(agentBannerItems());

  // ── 세션 요약 줄 — 옛 상태바 세션 칸의 배지와 같은 재료(2026-10-07 — `console/window-cards.ts` → `console/session-sheet.ts`) ──
  const sessions = $derived.by(() => {
    const id = currentWorkspaceId();
    const here =
      id === null ? sheetBuckets(windowSessionCards(t).board, Date.now()) : workspaceSheetBuckets(t, Date.now()).get(id);
    return here ? sheetCounts(here) : { running: 0, waiting: 0 };
  });

  /** 지난 알림 한 줄 — 일반 기록 또는 해결된 에이전트 알림 */
  type HistoryRow = { key: string; at: number; group?: AlertGroup } & (
    | { type: "generic"; entry: NotificationEntry }
    | { type: "agent"; entry: ResolvedBanner }
  );

  /** 두 기록을 시각 순으로 합친다 — 에이전트 알림은 **해결된 시각**에 선다 */
  const history = $derived.by((): HistoryRow[] => {
    const rows: HistoryRow[] = [
      ...list.map((entry): HistoryRow => ({ key: `g${entry.id}`, at: entry.at, group: entry.group, type: "generic", entry })),
      ...resolvedAgentBanners().map(
        (entry): HistoryRow => ({ key: `a${entry.id}`, at: entry.resolvedAt, group: entry.group, type: "agent", entry }),
      ),
    ];
    return rows.sort((a, b) => b.at - a.at);
  });

  /** 같은 출처의 줄을 묶은 목록 — 묶음의 자리는 그 묶음의 가장 최근 줄 자리(머리말) */
  const views = $derived(groupAlertRows(history));

  /** 펼친 묶음(`AlertGroupView.key`) — 컴포넌트 메모리뿐이다 */
  let expanded = $state<ReadonlySet<string>>(new Set());
  function toggleGroup(key: string): void {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  /** 줄의 "언제" — 해결된 에이전트 알림은 어떻게 풀렸는지까지 */
  function whenOf(row: HistoryRow): string {
    const when = relativeTime(row.at, now, t);
    if (row.type === "generic") return when;
    const how = row.entry.resolution === "checked" ? "app.notify.resolved.checked" : "app.notify.resolved.auto";
    return `${when} · ${t(how)}`;
  }

  /** 줄 앞자리 그림의 종류 */
  function kindOf(row: HistoryRow): NotificationEntry["kind"] {
    if (row.type === "generic") return row.entry.kind;
    if (row.entry.sideChatId !== undefined) return "side-chat";
    return row.entry.kind === "permission" ? "agent-permission" : "agent-stop";
  }

  /** 줄의 결 — 일반 기록은 적힌 그대로, 배너 기록은 사이드 채팅의 답변 실패만 오류색 */
  function levelOf(row: HistoryRow): "info" | "success" | "error" {
    if (row.type === "generic") return row.entry.level ?? "info";
    return row.entry.kind === "failed" ? "error" : "info";
  }

  /**
   * 칸이 보이기 시작할 때 읽지 않았던 줄 — 점 하나로 표시한다(위 머리말). 룬이 아닌 `wasOpen` 으로 "보이기 시작한 그 틱" 만
   * 잡는다(보이는 동안 새로 온 줄은 곧바로 읽음이 되므로 점이 없다 — 팝오버 시절과 같다).
   */
  let fresh = $state<ReadonlySet<number>>(new Set());
  let wasOpen = false;
  $effect(() => {
    void list;
    if (!open) {
      wasOpen = false;
      return;
    }
    if (!wasOpen) {
      wasOpen = true;
      fresh = new Set(notificationList().filter((e) => !e.read).map((e) => e.id));
    }
    markNotificationsRead();
  });

  /** 볼 때 읽지 않았던 줄인가(점) */
  const isFresh = (row: HistoryRow) => row.type === "generic" && fresh.has(row.entry.id);

  /** "5분 전" 이 저 혼자 흐르게 — 칸이 보이는 동안만 도는 시계 */
  let now = $state(Date.now());
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  /** 칸을 고르면 키보드가 목록으로 — ↑↓ 가 곧바로 돈다(독의 포커스 효과가 부른다) */
  export function focusList(): void {
    el?.focus({ preventScroll: true });
  }

  /** 세션 요약 줄 — 독을 닫고 세션 목록 판 */
  function openSessions(): void {
    runAfterClose(onclose, onsessions);
  }

  /** 가장 오래된 대기 작업안을 작업안(채팅 독 갈래)에서 연다 — 대기 카드의 [작업안에서 보기]와 같은 곳 */
  function openPending(): void {
    runOnMenu(() => pending[0]?.operationId, onclose, openPlansAt);
  }

  /** "확인할 것" 한 줄 — 그 타일로 가며 해결한다(배너의 [보기] 와 같은 길) */
  function openTodo(id: number): void {
    runOnMenu(() => id, onclose, openAgentBanner);
  }

  /**
   * 작업안 실행 줄 — 작업안의 **그 실행**으로 간다(토스트의 [결과 보기]와 같은 곳 ·
   * docs/log/2026-09-28-run-result-notify.md). 끝난 작업안은 백엔드가 최근 100건까지만 들고 있으므로,
   * 메모리에 그 실행이 없으면(오래됐거나 앱을 다시 켠 뒤) 타일이 폴링 한 바퀴 뒤 **기록** 보기의 그
   * 실행으로 넘긴다(docs/log/2026-09-28-run-history.md).
   */
  function goToRun(entry: NotificationEntry): void {
    runOnMenu(() => entry.operationId, onclose, openPlansAt);
  }

  /** 그 줄의 타일로 간다 — 탭은 **지금** 다시 찾는다(없어졌으면 아무 일도 없다) */
  function goTo(entry: { paneId?: string }): void {
    runOnMenu(
      () => entry.paneId,
      onclose,
      (paneId) => {
        const tab = tabOfPane(paneId);
        if (!tab) return;
        // 면은 그대로 — 알림으로 와도 터미널 · 대화 면을 바꾸지 않는다(2026-11-03)
        focusTile(tab.id, paneId);
      },
    );
  }

  /** 사이드 채팅 줄(해결된 배너 기록) — 그 채팅을 고르고 채팅 독(폰은 덮개)을 연다. 지워진 채팅이면 아무 일도 없다(`openSideChatFromAlert`) */
  function goToSideChat(entry: { sideChatId?: string }): void {
    runOnMenu(() => entry.sideChatId, onclose, (id) => void openSideChatFromAlert(id));
  }

  /** 줄을 지운 뒤 포커스를 목록에 남긴다(누른 × 가 사라지면 포커스가 몸통으로 떨어진다) */
  function remove(row: HistoryRow): void {
    if (row.type === "agent") forgetResolvedBanner(row.entry.id);
    else dismissNotification(row.entry.id);
    el?.focus({ preventScroll: true });
  }

  /** 묶음 카드의 × — 묶음 전체를 지운다(줄마다 제 저장소의 지우기) */
  function removeGroup(view: AlertGroupView<HistoryRow>): void {
    for (const row of view.rows) {
      if (row.type === "agent") forgetResolvedBanner(row.entry.id);
      else dismissNotification(row.entry.id);
    }
    el?.focus({ preventScroll: true });
  }

  /**
   * 지운 줄의 나가기 — 밀려 나감 → 높이 접힘(머리말). 몸은 공용 `row-exit.ts`(작업안 진행 · 기록 지우기와 같다 · 2026-11-13).
   */
  const rowExit = makeRowExit(() => side);

  /** 빈 상태 문구 — 마지막 줄까지 다 나간 뒤에 흐릿하게 들어온다(줄이 나가는 동안 "알림 없음" 이 먼저 서지 않게) */
  let historyRows = $state<HTMLElement | null>(null);
  const emptyIn = makeEmptyIn(() => exitingIn(historyRows));

  /** ↑↓·Home/End 로 돈다 — Escape 는 받지 않는다(독이 닫는다 — 머리말) */
  function onKey(ev: KeyboardEvent): void {
    const node = el;
    if (!node) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    ev.preventDefault();
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button[data-alert-row]:not([inert] *)"));
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const down = ev.key === "ArrowDown";
    const next =
      ev.key === "Home"
        ? 0
        : ev.key === "End"
          ? buttons.length - 1
          : at < 0
            ? down
              ? 0
              : buttons.length - 1
            : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  /** 줄 앞자리 그림 — 무엇이 알렸나 */
  const KIND_ICON = {
    "agent-stop": "ai",
    "agent-permission": "ai",
    "command-finish": "terminal",
    transfer: "file-down",
    "program-notify": "bell",
    "operation-finish": "console",
    orchestration: "orchestra",
    "side-chat": "chat",
  } as const;
</script>

<!--
  에이전트 알림 줄의 앞 그림 — 그 에이전트의 로고(Claude · Codex …, 배너 카드와 같은 `AiGlyph` — 2026-10-28 · 모양이 아바타면 그 CLI 의 아바타 — 10-31). 모르면 일반 AI 아이콘.
-->
{#snippet agentMark(logo: string | null, small = false)}
  {#if logo}<AiGlyph name={logo} size={small ? 16 : 22} />{:else}<UiIcon name="ai" size={small ? 14 : 18} />{/if}
{/snippet}

<!--
  지난 알림 한 줄의 본문(누르는 칸) — 낱줄 · 묶음 카드 · 펼친 자식 줄이 함께 쓴다. `detail` 은 둘째 줄(언제 · 묶음 카드면
  출처 · 언제). `child` 면 출처 머리를 뗀 짧은 글(`short` — 출처는 카드에 이미 있다)과 작은 아바타. 작업안 실행 줄은 묶지 않는
  종류라 제 모양의 둘째 줄을 그린다.
-->
<!-- `alarm` — 묶음 카드에서 묶음 안에 실패가 있다: 최근 줄이 성공이어도 앞자리를 실패색으로(실패가 접힌 채 묻히지 않게 · 2026-11-02) -->
{#snippet rowPick(row: HistoryRow, detail: string, child: boolean, alarm = false, source: string | null = null)}
  {@const entry = row.entry}
  {@const kind = kindOf(row)}
  {@const level = alarm ? "error" : levelOf(row)}
  {@const name = child ? (entry.short ?? entry.text) : entry.text}
  {#if row.type === "generic" && row.entry.operationId && row.entry.run}
    {@const run = row.entry.run}
    <!-- 작업안 실행 줄 — 머리 · 칩 — 색 입은 결과 / "작업안 실행 · 곁 토막 · 언제" (목업 그대로) -->
    <button
      type="button"
      class="pick"
      data-alert-row
      data-notify-run={row.entry.operationId}
      onclick={() => goToRun(row.entry as NotificationEntry)}
    >
      <span class="mark run {level}"
        ><UiIcon name={KIND_ICON[kind]} size={18} /></span
      >
      <span class="text"
        ><span class="name"
          >{run.headline}{#if run.auto}<span class="chip" title={t("app.opnotify.auto.title")}
              >{t("app.opnotify.auto")}</span
            >{/if} — <span class="result {run.tone}">{run.result}</span></span
        ><span class="detail"
          >{[source ?? t("app.opnotify.kind"), ...run.details].join(" · ")} · {whenOf(row)}{#if level !== "success"}&nbsp;·
            <span class="go">{t("app.opnotify.open.go")}</span>{/if}</span
        ></span
      >
    </button>
  {:else if entry.paneId}
    {@const logo = row.type === "agent" ? row.entry.logo : null}
    <button type="button" class="pick" data-alert-row onclick={() => goTo(entry)}>
      <span class="mark {level}" class:logo={!!logo}
        >{#if logo}{@render agentMark(logo, child)}{:else}<UiIcon
            name={KIND_ICON[kind]}
            size={child ? 14 : 18}
          />{/if}</span
      >
      <span class="text"><span class="name">{name}</span><span class="detail">{detail}</span></span>
    </button>
  {:else if row.type === "agent" && row.entry.sideChatId !== undefined}
    {@const logo = row.entry.logo}
    <!-- 사이드 채팅 줄(해결된 배너 기록) — 그 채팅을 연다(타일 줄이 그 타일로 가는 것과 같은 결) -->
    <button
      type="button"
      class="pick"
      data-alert-row
      data-notify-side-chat={row.entry.sideChatId}
      onclick={() => goToSideChat(row.entry)}
    >
      <span class="mark {level}" class:logo={!!logo}
        >{#if logo}{@render agentMark(logo, child)}{:else}<UiIcon
            name={KIND_ICON[kind]}
            size={child ? 14 : 18}
          />{/if}</span
      >
      <span class="text"><span class="name">{name}</span><span class="detail">{detail}</span></span>
    </button>
  {:else}
    <div class="pick static">
      <span class="mark {level}"
        ><UiIcon name={KIND_ICON[kind]} size={child ? 14 : 18} /></span
      >
      <span class="text"><span class="name">{name}</span><span class="detail">{detail}</span></span>
    </div>
  {/if}
{/snippet}

<!--
  `tabindex="-1"` — 칸을 고르면 이 상자가 포커스를 받아 ↑↓ 가 곧바로 돈다(줄 하나하나는 Tab 순회에도 든다).
  `role="group"` — 팝오버 시절의 `menu` 가 아니다: 독 안에 늘 붙어 있는 목록이고, 줄이 곧 단추다.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="alerts"
  role="group"
  aria-label={t("app.notify.aria")}
  tabindex="-1"
  data-dock-alerts
  bind:this={el}
  onkeydown={onKey}
>
  <button
    type="button"
    class="pick sessions"
    data-alert-row
    data-dock-sessions
    aria-label={t("app.dock.alerts.sessions.aria", { running: sessions.running, waiting: sessions.waiting })}
    onclick={openSessions}
  >
    <span class="mark"><UiIcon name="list" size={18} /></span>
    <span class="name one">{t("app.dock.alerts.sessions")}</span>
    <!-- 0 인 칩은 세우지 않는다 — 칩이 뜨는 것 자체가 신호다(수는 줄의 aria-label 이 늘 읽어 준다) -->
    {#if sessions.running > 0}
      <span class="count run" data-sessions-running={sessions.running}
        >{t("app.dock.alerts.sessions.running", { n: sessions.running })}</span
      >
    {/if}
    {#if sessions.waiting > 0}
      <span class="count wait" data-sessions-waiting={sessions.waiting}
        >{t("app.dock.alerts.sessions.waiting", { n: sessions.waiting })}</span
      >
    {/if}
    <span class="chev" aria-hidden="true"><UiIcon name="chevron" size={14} /></span>
  </button>
  <hr />

  {#if pending.length > 0}
    <button type="button" class="pick pending" data-alert-row data-notify-pending onclick={openPending}>
      <span class="mark"><UiIcon name="console" size={18} /></span>
      <span class="text"><span class="name">{t("app.notify.pending", { n: pending.length })}</span></span>
    </button>
    <hr />
  {/if}

  {#if todo.length > 0}
    <p class="group">{t("app.notify.todo")}</p>
    <div class="rows" data-notify-todo-list>
      {#each todo as item (item.id)}
        <div class="row" data-notify-todo={item.id} data-kind={item.kind} data-hidden={item.hidden}>
          <button type="button" class="pick" data-alert-row onclick={() => openTodo(item.id)}>
            <span
              class="mark {item.kind === 'permission' ? 'permission' : item.kind === 'failed' ? 'error' : 'stop'}"
              class:logo={!!item.logo}
              >{@render agentMark(item.logo)}</span
            >
            <span class="text"
              ><span class="name">{item.text}</span><span class="detail"
                >{relativeTime(item.at, now, t)}{#if item.hidden}&nbsp;· <span class="later"
                    >{t("app.notify.later")}</span
                  >{/if}</span
              ></span
            >
          </button>
        </div>
      {/each}
    </div>
    <hr />
  {/if}

  <p class="group">{t("app.notify.history")}</p>
  <!-- 목록 상자는 늘 선다 — 비었을 때 `{:else}` 로 갈라 두면 상자째 사라져 줄의 `out:`(지역)이 돌지 못한다. 줄이 하나도 없으면 CSS 로 숨는다.
       직속 자식은 칸마다 `.bundle` 하나(낱줄도) — 묶음이 한 줄 ↔ 여럿으로 바뀌어도 같은 요소라 `out:` 이 지우지 않은 칸에 돌지 않는다 -->
  <div class="rows" bind:this={historyRows}>
    {#each views as view (view.key)}
      {@const head = view.rows[0]}
      {@const many = view.group !== null && view.rows.length > 1}
      {@const unfolded = expanded.has(view.key)}
      <div
        class="bundle"
        data-notify-group={view.group?.key}
        role={many ? "group" : undefined}
        aria-label={many && view.group
          ? t("app.notify.group.aria", { label: view.group.label, n: view.rows.length })
          : undefined}
        out:rowExit
      >
        <div
          class="row"
          data-notify-entry={head.key}
          data-notify-resolved={head.type === "agent" ? head.entry.resolution : undefined}
          class:fresh={many ? view.rows.some(isFresh) : isFresh(head)}
        >
          {@render rowPick(
            head,
            many && view.group ? `${view.group.label} · ${whenOf(head)}` : whenOf(head),
            false,
            many && view.rows.some((r) => levelOf(r) === "error"),
            many ? (view.group?.label ?? null) : null,
          )}
          {#if many}
            <span class="count" data-notify-group-count={view.rows.length}>{view.rows.length}</span>
            <button
              type="button"
              class="side expand"
              class:open={unfolded}
              data-alert-row
              data-notify-expand
              aria-expanded={unfolded}
              title={t(unfolded ? "app.notify.group.collapse" : "app.notify.group.expand")}
              aria-label={t(unfolded ? "app.notify.group.collapse" : "app.notify.group.expand")}
              onclick={() => toggleGroup(view.key)}
            >
              <UiIcon name="chevron-down" size={14} />
            </button>
          {/if}
          <button
            type="button"
            class="side"
            data-notify-remove
            title={t(many ? "app.notify.group.remove" : "app.notify.remove")}
            aria-label={t(many ? "app.notify.group.remove" : "app.notify.remove")}
            onclick={() => (many ? removeGroup(view) : remove(head))}
          >
            <UiIcon name="close" size={12} />
          </button>
        </div>
        <!-- 펼친 묶음의 나머지 줄 — 한 줄로 줄면 `.row` 가 없어 CSS 로 숨는다(지운 줄의 `out:` 은 이 상자 안에서 돈다) -->
        {#if unfolded}
          <div class="sub">
            {#each view.rows.slice(1) as row (row.key)}
              <div
                class="row"
                data-notify-entry={row.key}
                data-notify-resolved={row.type === "agent" ? row.entry.resolution : undefined}
                class:fresh={isFresh(row)}
                out:rowExit
              >
                {@render rowPick(row, whenOf(row), true)}
                <button
                  type="button"
                  class="side"
                  data-notify-remove
                  title={t("app.notify.remove")}
                  aria-label={t("app.notify.remove")}
                  onclick={() => remove(row)}
                >
                  <UiIcon name="close" size={12} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  {#if history.length === 0}
    <p class="note" data-notify-empty in:emptyIn>{t("app.notify.empty")}</p>
  {/if}
</div>

<style>
  /*
   * MD3 알림 카드(2026-10-18 — End-4 식 목업). 줄 하나 = 카드 하나(surfaceContainerHigh · 20px), 앞자리 = 40px 원형 아바타
   * (권한 물음 tertiaryContainer · 그 밖 secondaryContainer), 세션 요약 = 18px 카드 + 칩(실행 secondaryContainer · 대기
   * tertiaryContainer), 승인 대기 = primaryContainer 카드. 카드 사이는 8px 틈이라 구분선(`hr`)은 그리지 않는다.
   * 넘치면 이 상자만 스크롤한다(칸 줄은 그대로 선다).
   */
  .alerts {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden; /* 오른쪽으로 밀려 나가는 줄이 가로 스크롤 막대를 세우지 않게 */
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3) var(--space-3);
    font-family: var(--font-ui);
  }

  .alerts:focus {
    outline: none;
  }

  /* 세로 줄 안의 직속 카드(세션 요약 · 승인 대기)는 제 높이만 — 남는 폭을 받는 `flex: 1` 은 카드 줄(`.row`, 가로) 안의
     `.pick` 에만 준다(아래 `.row > .pick`). 세로 상자의 직속 자식이 그 값을 받으면 남는 **높이**를 다 먹었다(10-18 실기 — 세션 줄이
     칸을 다 차지. 처음 고친 `.alerts > *` 는 `.pick` 과 우선순위가 같아 뒤에 오는 `.pick` 에 졌다) */
  .alerts > :global(*) {
    flex: 0 0 auto;
  }

  /* 묶음 제목 — 12 · onSurfaceVariant */
  .group {
    margin: var(--space-1) 0 0;
    padding: 0 var(--space-1);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .note {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* 지난 알림 상자가 비면 자리(와 앞뒤 틈)를 내놓는다 — 나가는 줄이 남아 있는 동안은 비지 않는다 */
  /* 지난 알림 상자의 칸은 `.bundle`, 새 알림 상자의 칸은 `.row` — 둘 다 세야 한다(`.bundle` 만 세면 새 알림 목록이 늘 숨는다) */
  .rows:not(:has(> .bundle, > .row)) {
    display: none;
  }

  /* 칸 하나 — 카드 줄 + (펼쳤으면) 나머지 줄. 나가는 움직임(`rowExit` — 높이 셈)은 이 상자 단위다 */
  .bundle {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* 펼친 묶음의 나머지 줄 — 들여쓰기만(세로선 없음) · 44px 줄 · 28px 아바타. 한 줄로 줄어 비면 자리를 내놓는다 */
  .sub {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-left: 24px;
  }
  .sub:not(:has(> .row)) {
    display: none;
  }
  .sub .pick {
    min-height: 44px;
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .sub .mark {
    width: 28px;
    height: 28px;
  }

  /* 묶음 카드의 펼침 단추(⌄) — 펼치면 뒤집힌다 */
  .expand :global(svg) {
    transition: transform 160ms ease;
  }
  .expand.open :global(svg) {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .expand :global(svg) {
      transition: none;
    }
  }

  /* 알림 줄은 알약(독 목록 줄과 같은 `--radius-row` — 2026-11-02) — 앞 아바타가 왼쪽 반원 안에, × 가 오른쪽 반원 안에 앉게 양끝 여백을 맞춘다 */
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-2);
    background: var(--control-tile-bg);
    border-radius: var(--radius-row);
    box-shadow: var(--glass-ctl-edge, none);
  }

  .row > .pick {
    flex: 1;
    padding-left: 8px;
    border-radius: var(--radius-row);
  }

  /* 알약에서는 이름 한 줄 */
  .row .name {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  /* 볼 때 읽지 않았던 줄 — 카드 밖 왼쪽의 점 하나(알약 곡선에 겹치지 않게). 움직이지 않는다. 강조색이 아니라 본문 회색이다 */
  .row.fresh::before {
    position: absolute;
    top: 50%;
    left: -8px;
    width: 4px;
    height: 4px;
    margin-top: -2px;
    content: "";
    border-radius: 50%;
    background: var(--fg-2);
  }

  .pick {
    display: flex;
    align-items: center;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    min-height: 56px;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    text-align: left;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-surface-inner); /* 독 안 카드(2026-10-25) */
    cursor: pointer;
  }

  .pick.static {
    cursor: default;
  }

  button.pick:hover,
  button.pick:focus-visible,
  .side:hover,
  .side:focus-visible {
    background: color-mix(in srgb, var(--fg-1) var(--state-hover), transparent);
  }

  button.pick:focus-visible,
  .side:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 알림 카드 줄 — 호버 층은 **줄 전체**(× 칸까지)에 한 장(2026-10-28 — 예전엔 줄 단추 `.pick` 만 밝아져 × 쪽이 비었다).
     줄 단추 자신의 호버 면은 걷고, × 는 그 위에 제 원 호버를 한 겹 더 얹는다. 누를 수 없는 줄(`.pick.static`)도 × 가 있어 같이 밝아진다 */
  .row:hover,
  .row:has(> button.pick:focus-visible) {
    background-image: linear-gradient(
      color-mix(in srgb, var(--fg-1) var(--state-hover), transparent),
      color-mix(in srgb, var(--fg-1) var(--state-hover), transparent)
    );
  }

  .row > button.pick:hover,
  .row > button.pick:focus-visible {
    background: transparent;
  }

  /* 세션 요약 줄 — 알림 줄과 같은 알약(2026-11-04 사용자) · 한 줄(아이콘 primary · 이름 · 실행 칩 · 대기 칩 · ›) */
  .pick.sessions {
    min-height: 52px;
    gap: var(--space-2);
    font-weight: 500;
    background: var(--control-tile-bg);
    border-radius: var(--radius-row);
    box-shadow: var(--glass-ctl-edge, none);
  }
  .pick.sessions:hover,
  .pick.sessions:focus-visible {
    background: var(--control-tile-bg-hover);
  }
  .pick.sessions .mark {
    width: 22px;
    height: 22px;
    margin-right: 0;
    color: var(--accent);
    background: transparent;
  }
  .name.one {
    flex: 1 1 auto;
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  /* 수 칩 — 기본은 테두리 보조 칩(outlineVariant · 묶음 카드의 개수) */
  .count {
    flex: 0 0 auto;
    padding: 3px 9px;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  /* 세션 줄의 수 칩 — 줄과 같은 알약 · 0 이면 세우지 않는다 · 도는 수는 secondaryContainer, 기다리는 수는 tertiaryContainer */
  .pick.sessions .count {
    padding: 3px 10px;
    border-color: transparent;
    border-radius: 999px;
  }
  .count.run {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }
  .count.wait {
    color: var(--m3-on-tertiary-container);
    background: var(--tertiary-soft);
  }
  .chev {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--fg-2);
  }

  /* 승인 대기 — primaryContainer 카드(사람을 부르는 단 하나의 카드) */
  .pick.pending {
    min-height: 56px;
    padding: var(--space-3) var(--space-4);
    font-weight: var(--fw-semibold);
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
    border-radius: var(--radius-surface-inner); /* 독 안 카드(2026-10-25) */
  }
  .pick.pending:hover,
  .pick.pending:focus-visible {
    background: color-mix(in srgb, var(--m3-on-primary-container) var(--state-hover), var(--m3-primary-container));
  }
  .pick.pending .mark {
    color: var(--m3-on-primary-container);
    background: transparent;
    width: 22px;
    height: 22px;
  }

  /* 앞자리 — 40px 원형 아바타(secondaryContainer · 권한 물음 tertiaryContainer · 실패 errorContainer) */
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 40px;
    height: 40px;
    margin-right: var(--space-3);
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border-radius: 50%;
  }

  /* 에이전트 로고 — 런처 AI 칸의 배지(`DockLaunch` `.badge`)와 같은 옅은 강조색 판(줄 면 위에 섞음 · 2026-11-04 사용자) · 단색 로고는 글자색을 입는다 */
  .mark.logo {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--accent) 16%, var(--control-tile-bg));
  }

  .mark.error {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }

  /* 작업안 실행 줄 — 성공도 결의 색을 입는다(목업: 성공 초록 · 실패 오류색 · 취소 무채) */
  .mark.run.success {
    color: var(--ok);
  }
  .result.good {
    color: var(--ok);
  }
  .result.bad {
    color: var(--err);
  }
  .chip {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    font-size: 11px;
    line-height: 16px;
    vertical-align: 1px;
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .go {
    color: var(--fg-2);
    white-space: nowrap; /* "결과 보기 →" 가 두 줄로 쪼개지지 않게 */
  }

  /* 확인할 것 — 권한 물음은 tertiaryContainer(입력 대기의 부름), 끝남은 secondaryContainer */
  .mark.permission {
    color: var(--m3-on-tertiary-container);
    background: var(--tertiary-soft);
  }

  .later {
    color: var(--fg-2);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  /* 알림 문구는 두 줄까지 — 명령줄이 길어도 목록이 한 줄 한 줄 읽히게 */
  .name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    font-weight: 500;
  }

  .detail {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .side {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 32px;
    height: 32px;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  /* 줄 끝 단추(⌄ · ×)는 호버 · 포커스 때만 — 늘 서 있으면 목록이 단추투성이다(2026-11-02 사용자). 폭까지 접어 그동안은 글이
     그 자리를 쓴다. 손가락 기기(호버 없음 — 폰)에서는 늘 보인다: 누르기 전에 보일 길이 없다 */
  @media (hover: hover) {
    .row > .side {
      width: 0;
      opacity: 0;
      overflow: hidden;
      transition:
        width 120ms ease,
        opacity 120ms ease;
    }
    .row:hover > .side,
    .row:focus-within > .side {
      width: 32px;
      opacity: 1;
    }
  }
  @media (hover: hover) and (prefers-reduced-motion: reduce) {
    .row > .side {
      transition: none;
    }
  }

  hr {
    display: none;
  }
</style>
