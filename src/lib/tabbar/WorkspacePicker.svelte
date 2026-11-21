<script lang="ts">
  import { tick } from "svelte";
  import { isMainWindow, isRemote } from "$lib/app/window.svelte.js";
  import { currentWorkspaceId, workspaceList, workspaceMainWindow } from "$lib/app/workspaces.svelte.js";
  import { deleteWorkspaceAsked, editWorkspacePrompt, newWorkspacePrompt } from "$lib/app/workspace-actions.svelte.js";
  import { auxWorkspaceWindow } from "$lib/app/workspace-status.svelte.js";
  import { canDeleteWorkspace, workspaceRowTip } from "$lib/workspaces/sidebar";
  import type { workspaceSheetBuckets } from "$lib/console/window-cards";
  import { sheetBadge, type SheetBadge } from "$lib/console/session-sheet";
  import WorkspaceIcon from "$lib/WorkspaceIcon.svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { menuRows, onListMenuKey } from "./tab-menu";

  let {
    wsMenu,
    wsCtx = $bindable(),
    wsMenuEl = $bindable(),
    wsCtxEl = $bindable(),
    wsBuckets,
    wsDrag,
    wsDropBefore,
    wsDropEnd,
    pickWsRow,
    closeWsMenu,
  }: {
    wsMenu: { left: number; top: number } | null;
    wsCtx: { id: string; x: number; y: number } | null;
    wsMenuEl: HTMLElement | null;
    wsCtxEl: HTMLElement | null;
    wsBuckets: ReturnType<typeof workspaceSheetBuckets>;
    wsDrag: { id: string; pointerId: number; x: number; y: number; moved: boolean } | null;
    wsDropBefore: string | null;
    wsDropEnd: boolean;
    pickWsRow: (id: string) => void;
    closeWsMenu: (back?: boolean) => void;
  } = $props();

  const wsBadges = $derived(new Map([...wsBuckets].map(([id, b]) => [id, sheetBadge(b)])));
  const wsBadge = (id: string): SheetBadge | null => wsBadges.get(id) ?? null;
  /** 보조 창은 다른 창의 보고를 받지 않는다 — 제 워크스페이스가 아닌 줄은 모두 주 창의 것으로 친다 */
  const wsAway = (id: string): boolean =>
    workspaceMainWindow() ? auxWorkspaceWindow(id) !== null : !isRemote && id !== currentWorkspaceId();

  function openWsCtx(id: string, x: number, y: number) {
    if (!workspaceMainWindow()) return;
    wsCtx = { id, x: Math.max(4, Math.min(x, window.innerWidth - 192)), y: Math.max(4, Math.min(y, window.innerHeight - 96)) };
    void tick().then(() => menuRows(wsCtxEl)[0]?.focus());
  }

  /** 우클릭 메뉴만 닫는다(목록은 남는다) */
  function closeWsCtx(back = false) {
    const id = wsCtx?.id;
    wsCtx = null;
    if (back && id) wsMenuEl?.querySelector<HTMLElement>(`[data-workspace-option="${CSS.escape(id)}"]`)?.focus();
  }

  function onWsCtx(fn: (id: string) => void | Promise<void>) {
    runOnMenu(() => wsCtx?.id, () => closeWsMenu(), fn);
  }

  function wsRowKeydown(ev: KeyboardEvent, id: string) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || !workspaceMainWindow()) return;
    const menuKey = ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey);
    if (ev.code === "F2" && !ev.shiftKey) {
      ev.preventDefault();
      ev.stopPropagation();
      runOnMenu(() => id, () => closeWsMenu(), editWorkspacePrompt);
    } else if (menuKey) {
      ev.preventDefault();
      ev.stopPropagation();
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      openWsCtx(id, r.left + 24, r.bottom);
    }
  }

  function onWsCtxKey(ev: KeyboardEvent) {
    if (ev.key === "Tab") {
      ev.preventDefault();
      ev.stopPropagation();
      closeWsCtx(true);
      return;
    }
    onListMenuKey(ev, wsCtxEl, closeWsCtx);
    ev.stopPropagation();
  }
</script>

{#if wsMenu}
  <div
    class="menu ws-menu menu-surface md3-list"
    role="menu"
    tabindex="-1"
    aria-label={t("app.workspaces.list")}
    data-workspace-menu
    bind:this={wsMenuEl}
    style="left:{wsMenu.left}px;top:{wsMenu.top}px"
    onkeydown={(ev) => onListMenuKey(ev, wsMenuEl, closeWsMenu)}
  >
    <div class="md3-scroll ws-scroll">
    {#each workspaceList() as workspace (workspace.id)}
      {@const current = workspace.id === currentWorkspaceId()}
      {@const badge = wsBadge(workspace.id)}
      {@const away = badge === null && wsAway(workspace.id)}
      {@const tip = workspaceRowTip(t, workspace.name, badge, away)}
      <button
        type="button"
        class="menu-row ws-row"
        class:current
        class:dragging={wsDrag?.id === workspace.id && wsDrag.moved}
        class:drop-before={wsDropBefore === workspace.id}
        class:drop-end={wsDropEnd && workspace.id === workspaceList().at(-1)?.id}
        class:menued={wsCtx?.id === workspace.id}
        role="menuitemradio"
        aria-checked={current}
        data-workspace-option={workspace.id}
        data-workspace-badge={badge?.kind}
        data-workspace-away={away ? "" : undefined}
        title={tip}
        aria-label={tip}
        onclick={() => pickWsRow(workspace.id)}
        oncontextmenu={(ev) => {
          // 앱 메뉴 — 창 기본 메뉴는 늘 막는다(보조 창은 관리를 하지 않으므로 메뉴도 없다)
          ev.preventDefault();
          openWsCtx(workspace.id, ev.clientX, ev.clientY);
        }}
        onkeydown={(ev) => wsRowKeydown(ev, workspace.id)}
      >
        <span class="menu-mark ws-row-icon"><WorkspaceIcon {workspace} /></span>
        <span class="ws-row-name">{workspace.name}</span>
        {#if badge}
          <span class="ws-row-badge" data-kind={badge.kind} aria-hidden="true">{badge.kind === "running" ? "" : badge.n}</span>
        {:else if away}
          <span class="ws-row-away" aria-hidden="true">↗</span>
        {/if}
        <span class="ws-row-check">{#if current}<UiIcon name="check" size={14} />{/if}</span>
      </button>
    {/each}
    {#if isMainWindow}
      <hr class="menu-sep" />
      <button
        type="button"
        class="menu-row ws-row"
        role="menuitem"
        data-workspace-new
        onclick={() => runAfterClose(() => closeWsMenu(), newWorkspacePrompt)}
      >
        <span class="menu-mark ws-row-icon"><UiIcon name="plus" size={14} /></span>
        <span class="ws-row-name">{t("app.workspaces.new")}</span>
      </button>
    {/if}
    </div>
  </div>
{/if}

{#if wsCtx}
  <div
    class="menu ws-ctx-menu menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t("app.workspaces.list")}
    data-workspace-row-menu
    bind:this={wsCtxEl}
    style="left:{wsCtx.x}px;top:{wsCtx.y}px"
    onkeydown={onWsCtxKey}
  >
    <button type="button" class="menu-row" role="menuitem" data-workspace-edit-menu
      onclick={() => onWsCtx(editWorkspacePrompt)}>{t("app.workspaces.edit")}</button>
    <div class="menu-sep" role="separator"></div>
    <button type="button" class="menu-row danger" role="menuitem" data-workspace-delete-menu
      disabled={!canDeleteWorkspace(workspaceList().length)}
      title={!canDeleteWorkspace(workspaceList().length) ? t("app.workspaces.deleteDisabled") : undefined}
      onclick={() => onWsCtx(deleteWorkspaceAsked)}>{t("app.workspaces.delete")}</button>
  </div>
{/if}

<style>
  /* 넘치면 안쪽 상자가 굴린다 — 글래스 흐림 층이 함께 굴러가지 않게. 층 40 은 hug 캔버스 모서리 조각(30 — `+page.svelte`)보다 위여야
     메뉴 위로 곡선이 그려지지 않는다 */
  .menu.ws-menu {
    position: fixed;
    z-index: 40;
    min-width: 200px;
    max-width: 280px;
    overflow: hidden;
  }
  .ws-scroll {
    max-height: 60vh;
  }
  .menu-row.ws-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ws-row-icon {
    display: inline-flex;
    justify-content: center;
    font-weight: var(--fw-semibold);
  }
  .ws-row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ws-row.current .ws-row-name {
    font-weight: var(--fw-semibold);
  }
  .ws-row.current {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }
  .ws-row.current:hover,
  .ws-row.current:focus-visible {
    background: var(--control-sel-bg-hover);
  }
  .ws-row.current .ws-row-check {
    color: inherit;
  }
  .ws-row-badge {
    flex: none;
    min-width: 16px;
    box-sizing: border-box;
    padding: 0 5px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: var(--fw-semibold);
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--on-accent);
    background: var(--accent);
  }
  .ws-row-badge[data-kind="fail"] {
    background: var(--err);
  }
  .ws-row-badge[data-kind="running"] {
    min-width: 0;
    width: 8px;
    height: 8px;
    padding: 0;
    background: var(--ok);
  }
  .ws-row-away {
    flex: none;
    font-size: 11px;
    line-height: 1;
    color: var(--fg-3);
  }
  .ws-row {
    position: relative;
    touch-action: none;
  }
  .ws-row.dragging {
    opacity: 0.4;
  }
  .ws-row.menued {
    background: var(--surface-hover);
  }
  .ws-row.drop-before::after,
  .ws-row.drop-end::after {
    content: "";
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  /* 줄은 `overflow: hidden`(전역 `.menu-row`)이라 선을 줄 안쪽 가장자리에 긋는다 */
  .ws-row.drop-before::after { top: 0; }
  .ws-row.drop-end::after { bottom: 0; }
  .menu.ws-ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 180px;
  }
  .ws-row-check {
    flex: none;
    display: inline-flex;
    width: 14px;
    color: var(--fg-2);
  }

  /* 강조색이면 "골라진 것" 과 헷갈린다 */
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
