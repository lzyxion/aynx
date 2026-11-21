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
   * 독의 알림 칸. 다른 곳으로 가는 줄은 메뉴 통로(`runOnMenu` · `runAfterClose`)를 지난다 — 스냅샷 → 독 닫기 → 실행(docs/conventions.md).
   * 칸이 보이는 동안 전부 읽음이고, 보이기 시작할 때 읽지 않았던 줄만 점으로 남긴다 — 본문은 언마운트하지 않으니 점은 다시 보일 때마다 새로 잡는다.
   * 승인 대기 칸은 메인 창에서만 선다(`app/pending-plans` 는 메인 창만 부팅한다).
   * Escape 는 여기서 받지 않는다 — 독의 Escape(`Dock.svelte`)가 닫는다.
   */
  let {
    open,
    onclose,
    onsessions,
    side = "left",
  }: {
    open: boolean;
    /** 다른 곳으로 가는 줄이 실행 전에 부른다(메뉴 통로) */
    onclose: () => void;
    onsessions: () => void;
    /** 지운 줄이 이쪽으로 밀려 나간다 */
    side?: ExitSide;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  const list = $derived(notificationList());
  const pending = $derived(pendingPlans());
  const todo = $derived(agentBannerItems());

  // ── 세션 요약 줄 ── (워크스페이스가 없는 창이면 창 전체)
  const sessions = $derived.by(() => {
    const id = currentWorkspaceId();
    const here =
      id === null ? sheetBuckets(windowSessionCards(t).board, Date.now()) : workspaceSheetBuckets(t, Date.now()).get(id);
    return here ? sheetCounts(here) : { running: 0, waiting: 0 };
  });

  type HistoryRow = { key: string; at: number; group?: AlertGroup } & (
    | { type: "generic"; entry: NotificationEntry }
    | { type: "agent"; entry: ResolvedBanner }
  );

  /** 에이전트 알림은 해결된 시각에 선다 */
  const history = $derived.by((): HistoryRow[] => {
    const rows: HistoryRow[] = [
      ...list.map((entry): HistoryRow => ({ key: `g${entry.id}`, at: entry.at, group: entry.group, type: "generic", entry })),
      ...resolvedAgentBanners().map(
        (entry): HistoryRow => ({ key: `a${entry.id}`, at: entry.resolvedAt, group: entry.group, type: "agent", entry }),
      ),
    ];
    return rows.sort((a, b) => b.at - a.at);
  });

  const views = $derived(groupAlertRows(history));

  /** 컴포넌트 메모리뿐이다 */
  let expanded = $state<ReadonlySet<string>>(new Set());
  function toggleGroup(key: string): void {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  function whenOf(row: HistoryRow): string {
    const when = relativeTime(row.at, now, t);
    if (row.type === "generic") return when;
    const how = row.entry.resolution === "checked" ? "app.notify.resolved.checked" : "app.notify.resolved.auto";
    return `${when} · ${t(how)}`;
  }

  function kindOf(row: HistoryRow): NotificationEntry["kind"] {
    if (row.type === "generic") return row.entry.kind;
    if (row.entry.sideChatId !== undefined) return "side-chat";
    return row.entry.kind === "permission" ? "agent-permission" : "agent-stop";
  }

  function levelOf(row: HistoryRow): "info" | "success" | "error" {
    if (row.type === "generic") return row.entry.level ?? "info";
    return row.entry.kind === "failed" ? "error" : "info";
  }

  /** 룬이 아닌 `wasOpen` 으로 "보이기 시작한 그 틱" 만 잡는다 */
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

  const isFresh = (row: HistoryRow) => row.type === "generic" && fresh.has(row.entry.id);

  let now = $state(Date.now());
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  export function focusList(): void {
    el?.focus({ preventScroll: true });
  }

  function openSessions(): void {
    runAfterClose(onclose, onsessions);
  }

  /** 가장 오래된(먼저 만료될) 대기 작업안 */
  function openPending(): void {
    runOnMenu(() => pending[0]?.operationId, onclose, openPlansAt);
  }

  function openTodo(id: number): void {
    runOnMenu(() => id, onclose, openAgentBanner);
  }

  function goToRun(entry: NotificationEntry): void {
    runOnMenu(() => entry.operationId, onclose, openPlansAt);
  }

  /** 탭은 누를 때 다시 찾는다 — 그 사이 타일을 다른 탭으로 옮겼을 수 있다 */
  function goTo(entry: { paneId?: string }): void {
    runOnMenu(
      () => entry.paneId,
      onclose,
      (paneId) => {
        const tab = tabOfPane(paneId);
        if (!tab) return;
        // 알림으로 와도 터미널 · 대화 면을 바꾸지 않는다
        focusTile(tab.id, paneId);
      },
    );
  }

  function goToSideChat(entry: { sideChatId?: string }): void {
    runOnMenu(() => entry.sideChatId, onclose, (id) => void openSideChatFromAlert(id));
  }

  /** 누른 × 가 사라지면 포커스가 몸통으로 떨어지니 목록에 남긴다 */
  function remove(row: HistoryRow): void {
    if (row.type === "agent") forgetResolvedBanner(row.entry.id);
    else dismissNotification(row.entry.id);
    el?.focus({ preventScroll: true });
  }

  function removeGroup(view: AlertGroupView<HistoryRow>): void {
    for (const row of view.rows) {
      if (row.type === "agent") forgetResolvedBanner(row.entry.id);
      else dismissNotification(row.entry.id);
    }
    el?.focus({ preventScroll: true });
  }

  /** 지운 줄은 데이터에서 곧바로 빠지고 DOM 만 나간다 — 나가는 줄은 Svelte 가 `inert` 로 둔다 */
  const rowExit = makeRowExit(() => side);

  /** 줄이 나가는 동안 "알림 없음" 이 먼저 서지 않게 */
  let historyRows = $state<HTMLElement | null>(null);
  const emptyIn = makeEmptyIn(() => exitingIn(historyRows));

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

{#snippet agentMark(logo: string | null, small = false)}
  {#if logo}<AiGlyph name={logo} size={small ? 16 : 22} />{:else}<UiIcon name="ai" size={small ? 14 : 18} />{/if}
{/snippet}

<!-- `alarm` — 묶음 안에 실패가 있으면 최근 줄이 성공이어도 실패색으로(실패가 접힌 채 묻히지 않게) -->
{#snippet rowPick(row: HistoryRow, detail: string, child: boolean, alarm = false, source: string | null = null)}
  {@const entry = row.entry}
  {@const kind = kindOf(row)}
  {@const level = alarm ? "error" : levelOf(row)}
  {@const name = child ? (entry.short ?? entry.text) : entry.text}
  {#if row.type === "generic" && row.entry.operationId && row.entry.run}
    {@const run = row.entry.run}
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
  <!-- 목록 상자는 늘 선다 — `{:else}` 로 가르면 상자째 사라져 줄의 `out:`(지역)이 돌지 못한다.
       직속 자식은 칸마다 `.bundle` 하나 — 묶음이 한 줄 ↔ 여럿으로 바뀌어도 같은 요소라 `out:` 이 지우지 않은 칸에 돌지 않는다 -->
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

  /* 직속 자식이 `flex: 1` 을 받으면 남는 높이를 다 먹는다(`flex: 1` 은 `.row > .pick` 에만). `.alerts > *` 는 `.pick` 과 우선순위가 같아 졌다 */
  .alerts > :global(*) {
    flex: 0 0 auto;
  }

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

  /* 지난 알림의 칸은 `.bundle`, 확인할 것의 칸은 `.row` — `.bundle` 만 세면 확인할 것 목록이 늘 숨는다 */
  .rows:not(:has(> .bundle, > .row)) {
    display: none;
  }

  /* `rowExit` 의 높이 셈은 이 상자 단위다 */
  .bundle {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

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

  /* 양끝 여백은 앞 아바타 · × 가 알약의 반원 안에 앉게 맞춘 값이다 */
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

  .row .name {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  /* 카드 밖 왼쪽 — 알약 곡선에 겹치지 않게 */
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
    border-radius: var(--radius-surface-inner);
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

  /* 호버 층은 줄 전체(× 칸까지)에 한 장 — 줄 단추만 밝히면 × 쪽이 빈다 */
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

  .pick.pending {
    min-height: 56px;
    padding: var(--space-3) var(--space-4);
    font-weight: var(--fw-semibold);
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
    border-radius: var(--radius-surface-inner);
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

  .mark.logo {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--accent) 16%, var(--control-tile-bg));
  }

  .mark.error {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }

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

  /* 줄 끝 단추는 호버 · 포커스 때만(사용자 결정) — 호버가 없는 기기에서는 누르기 전에 보일 길이 없어 늘 보인다 */
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
