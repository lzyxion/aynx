<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 지난 대화 줄의 단추 묶음 `[⋯] [재개]` — 사용자 결정. 메뉴 순서는 열기 → 이름 → 위험한 것은 맨 아래.
   * 단추는 Tab 순서에 들지 않는다 — 키보드는 목록이 쥐고 같은 일을 단축키로 한다.
   */
  let {
    open,
    cwdExists,
    keepFocus = false,
    viewKey,
    onview,
    onfork,
    onhere,
    onrename,
    renameBlocked = null,
    ondelete,
    deleteBlocked = null,
    onprimary,
    onmenu,
    onclosefocus,
  }: {
    open: boolean;
    cwdExists: boolean;
    /** 누를 때 포커스를 옮기지 않는다 — 상태줄 팝업은 입력칸이 키보드를 쥔다 */
    keepFocus?: boolean;
    viewKey: string;
    onview: () => void;
    onfork: () => void;
    /** 넘기지 않으면 메뉴에 줄이 없다(아래 둘도 같다) */
    onhere?: () => void;
    onrename?: () => void;
    /** 툴팁 문구 — `null` 이면 된다 */
    renameBlocked?: string | null;
    ondelete?: () => void;
    deleteBlocked?: string | null;
    onprimary: () => void;
    /** 팝업은 메뉴가 열린 동안 마우스를 따라 고른 줄을 옮기지 않는다 — 메뉴로 가는 길에 다른 줄을 지난다 */
    onmenu?: (open: boolean) => void;
    onclosefocus?: () => void;
  } = $props();

  let moreBtn = $state<HTMLButtonElement | null>(null);
  let menuOpen = $state(false);

  const rows = $derived<ToolbarMenuRow[]>([
    { key: "view", icon: "scroll-text", label: t("board.convo.view"), hint: viewKey },
    ...(open
      ? []
      : [
          {
            key: "fork",
            icon: "git-branch",
            label: t("board.convo.fork"),
            hint: "Shift+Enter",
            disabled: !cwdExists,
            title: cwdExists ? undefined : t("board.convo.missing.title"),
          },
        ]),
    ...(onhere ? [{ key: "here", icon: "download", label: t("app.folderConvos.forkHere"), hint: "Ctrl+Shift+Enter" }] : []),
    ...(onrename
      ? [
          {
            key: "rename",
            icon: "edit",
            label: t("board.convo.rename"),
            sep: true,
            disabled: renameBlocked !== null,
            title: renameBlocked ?? undefined,
          },
        ]
      : []),
    ...(ondelete
      ? [
          {
            key: "delete",
            icon: "trash",
            label: t("board.convo.delete"),
            sep: true,
            danger: true,
            disabled: deleteBlocked !== null,
            title: deleteBlocked ?? undefined,
          },
        ]
      : []),
  ]);

  function setMenu(next: boolean): void {
    if (menuOpen === next) return;
    menuOpen = next;
    onmenu?.(next);
  }

  function closeMenu(back: boolean): void {
    setMenu(false);
    if (!back) return;
    if (onclosefocus) onclosefocus();
    else moreBtn?.focus();
  }

  function pick(key: string): void {
    const run: Record<string, (() => void) | undefined> = {
      view: onview,
      fork: onfork,
      here: onhere,
      rename: onrename,
      delete: ondelete,
    };
    runOnMenu(() => run[key], () => closeMenu(false), (fn) => fn());
  }

  function stop(ev: Event): void {
    ev.stopPropagation();
  }

  function noFocus(ev: MouseEvent): void {
    if (keepFocus) ev.preventDefault();
  }

  // 묶음이 걷히면 부모에게 메뉴가 닫혔다고 알린다 — 빼면 부모가 열린 채로 남는다
  $effect(() => () => {
    if (menuOpen) onmenu?.(false);
  });
</script>

<span class="acts" data-convo-acts>
  <button
    type="button"
    class="btn btn-ghost btn-sm more"
    tabindex="-1"
    data-act="more"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    aria-label={t("app.convoActs.more")}
    title={t("app.convoActs.more")}
    bind:this={moreBtn}
    onmousedown={noFocus}
    ondblclick={stop}
    onclick={(ev) => {
      stop(ev);
      setMenu(!menuOpen);
    }}><UiIcon name="more" size={14} /></button
  >
  <button
    type="button"
    class="btn btn-primary btn-sm"
    tabindex="-1"
    data-act={open ? "goto" : "resume"}
    title={open ? t("board.convo.goto") : `${t("board.convo.resume")} (Enter)`}
    disabled={!open && !cwdExists}
    onmousedown={noFocus}
    ondblclick={stop}
    onclick={(ev) => {
      stop(ev);
      onprimary();
    }}>{open ? t("board.convo.goto") : t("board.convo.resume")}</button
  >
</span>

{#if menuOpen && moreBtn}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <span class="menu-host" onclick={stop} ondblclick={stop} onmousedown={stop}>
    <ToolbarMenu label={t("app.convoActs.more")} {rows} trigger={moreBtn} align="right" onpick={pick} onclose={closeMenu} />
  </span>
{/if}

<style>
  .acts {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .more {
    width: 26px;
    padding: 0;
    justify-content: center;
  }

  .menu-host {
    display: contents;
  }
</style>
