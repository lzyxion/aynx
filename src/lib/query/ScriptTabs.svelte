<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ScriptTab } from "$lib/query/script-tabs";

  let {
    head,
    treeToggle,
    tabs,
    activeN,
    renaming,
    renameText = $bindable(),
    conn,
    connLabel,
    tabLabel,
    dirtyOf,
    tabDragStart,
    tabDragOver,
    tabDrop,
    pickTab,
    startRename,
    endRename,
    closeTabN,
    onTabKey,
    newTab,
    tabMenu,
  }: {
    head: boolean;
    treeToggle: Snippet<[boolean]>;
    tabs: ScriptTab[];
    activeN: number;
    renaming: number | null;
    renameText: string;
    conn: { state: "connecting" | "open" | "closed" };
    connLabel: string;
    tabLabel: (x: ScriptTab) => string;
    dirtyOf: (x: ScriptTab) => boolean;
    tabDragStart: (ev: DragEvent, n: number) => void;
    tabDragOver: (ev: DragEvent) => void;
    tabDrop: (ev: DragEvent, at: number) => void;
    pickTab: (n: number) => void;
    startRename: (n: number) => void;
    endRename: (commit: boolean) => void;
    closeTabN: (n: number) => Promise<void>;
    onTabKey: (ev: KeyboardEvent, n: number) => void;
    newTab: () => void;
    tabMenu: (ev: MouseEvent, n: number) => void;
  } = $props();

  function focusRename(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  /**
   * 탭 우클릭은 위임이 아닌 직접 리스너로 단다 — Svelte 의 `oncontextmenu` 는 문서 뿌리 위임이라, 머리줄 안에서는 타일 층(`PaneHost`)이
   * 먼저 받아 타일 메뉴를 연다. 여기서 먼저 `preventDefault` 하면 그 층이 비켜 선다(`ev.defaultPrevented`).
   */
  function tabContext(el: HTMLElement, n: number) {
    let cur = n;
    const on = (ev: MouseEvent) => {
      if (renaming === cur) return;
      ev.preventDefault();
      tabMenu(ev, cur);
    };
    el.addEventListener("contextmenu", on);
    return {
      update(next: number) {
        cur = next;
      },
      destroy() {
        el.removeEventListener("contextmenu", on);
      },
    };
  }
</script>

<div class="tabsrow" class:inhead={head}>
  {#if !head}{@render treeToggle(false)}{/if}
  <div class="stabs" role="tablist" aria-label={t("pane.query.tabs")} data-query-tabs>
    {#each tabs as x, i (x.n)}
      {@const on = x.n === activeN}
      {@const label = tabLabel(x)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="stab"
        class:on
        role="tab"
        tabindex={on ? 0 : -1}
        aria-selected={on}
        draggable={renaming !== x.n}
        ondragstart={(ev) => tabDragStart(ev, x.n)}
        ondragover={tabDragOver}
        ondrop={(ev) => tabDrop(ev, i)}
        onclick={() => pickTab(x.n)}
        ondblclick={() => startRename(x.n)}
        onauxclick={(ev) => ev.button === 1 && void closeTabN(x.n)}
        onkeydown={(ev) => onTabKey(ev, x.n)}
        use:tabContext={x.n}
        data-query-tab-n={x.n}
        data-query-tab-data={x.data ? x.data.kind : undefined}
        data-query-tab-list={x.list ? x.list.schema : undefined}
        title={x.list ? t("pane.query.list.tab.title", { name: x.list.schema }) : undefined}
      >
        {#if x.data}<span class="stab-icon" aria-hidden="true"><UiIcon name={x.data.kind === "table" || x.data.kind === "partition" ? "grid" : "view-compact"} size={12} /></span
          >{:else if x.list}<span class="stab-icon" aria-hidden="true"><UiIcon name="list" size={12} /></span>{/if}
        {#if renaming === x.n}
          <input
            class="stab-rename"
            aria-label={t("pane.query.tab.rename")}
            maxlength={60}
            bind:value={renameText}
            use:focusRename
            onclick={(ev) => ev.stopPropagation()}
            ondblclick={(ev) => ev.stopPropagation()}
            onkeydown={(ev) => {
              ev.stopPropagation();
              if (ev.key === "Enter") endRename(true);
              else if (ev.key === "Escape") endRename(false);
            }}
            onblur={() => endRename(true)}
          />
        {:else}
          <span class="stab-name">{label}</span>
        {/if}
        {#if dirtyOf(x)}
          <span class="stab-dirty" role="img" aria-label={t("pane.query.tab.dirty")} title={t("pane.query.tab.dirty")} data-query-tab-dirty
          ></span>
        {/if}
        <button
          type="button"
          class="stab-x"
          tabindex="-1"
          title={t("pane.query.tab.close.title", { key: "Ctrl+W" })}
          aria-label={t("pane.query.tab.close")}
          onclick={(ev) => {
            ev.stopPropagation();
            void closeTabN(x.n);
          }}><UiIcon name="close" size={10} /></button
        >
      </div>
    {/each}
    <button
      type="button"
      class="stab-add"
      title={t("pane.query.tab.add.title", { key: "Ctrl+T" })}
      aria-label={t("pane.query.tab.add")}
      onclick={newTab}
      data-head-act
      data-query-tab-add><UiIcon name="plus" size={13} /></button
    >
  </div>
  {#if !head}
    <span class="conn" data-conn={conn.state} title={connLabel}>
      <span class="dot" aria-hidden="true"></span>
      <span class="conn-label">{connLabel}</span>
    </span>
  {/if}
</div>

<style>
  .tabsrow {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    gap: 0;
    min-width: 0;
    height: 30px;
    padding-left: 4px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-2);
  }

  /* 머리줄 안 — 스크립트 탭 모양은 몸 위 줄과 같다(알약 모양은 실기에서 되돌렸다 — 다시 바꾸지 않는다) */
  .tabsrow.inhead {
    flex: 1 1 0;
    align-self: stretch;
    height: auto;
    padding-left: 6px;
    border-bottom: none;
  }

  .stabs {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .stab-icon {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--fg-3);
  }

  .stab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 200px;
    padding: 0 6px 0 12px;
    border-right: 1px solid var(--line);
    color: var(--fg-2);
    cursor: pointer;
    user-select: none;
    outline: none;
  }

  .stab:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .stab.on {
    color: var(--fg);
    background: var(--surface-field);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .stab:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -2px;
  }

  .stab-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stab-rename {
    width: 102px;
    padding: 1px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--focus-border);
    border-radius: 999px;
    outline: none;
  }

  .stab-dirty {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-2);
  }

  .stab-x,
  .stab-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .stab-x {
    width: 16px;
    height: 16px;
    border-radius: var(--radius);
    visibility: hidden;
  }

  .stab:hover .stab-x,
  .stab.on .stab-x {
    visibility: visible;
  }

  .stab-x:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .stab-add {
    flex: 0 0 auto;
    width: 30px;
  }

  .stab-add:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .stab-add:focus-visible,
  .stab-x:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -2px;
  }

  .conn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 8px;
    white-space: nowrap;
  }

  .conn .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .conn[data-conn="open"] .dot {
    background: var(--ok);
  }

  .conn[data-conn="closed"] .dot {
    background: var(--err);
  }

  @container qtile (max-width: 520px) {
    .conn-label {
      display: none;
    }

    .conn {
      padding: 0 8px 0 6px;
    }
  }
</style>
