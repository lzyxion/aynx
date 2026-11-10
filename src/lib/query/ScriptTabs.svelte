<script lang="ts">
  /**
   * **쿼리 타일의 탭 줄**(`.tabsrow` — 몸 위 줄이면 트리 토글 · 스크립트 탭 · [+] · 연결 상태, 머리줄 안이면 스크립트 탭 · [+] 만) —
   * `QueryView.svelte` 에서 뗀 표시 조각. 탭 목록 · 고른 탭 · 문서와 실행 결과 · 저장 디바운스와 동작(고르기 · 새 탭 · 닫기 · 이름 · 끌어서 순서 ·
   * 탭 키 · 우클릭 메뉴)은 부모가 쥔다. 트리 토글은 부모의 스니펫(`treeToggle` — 떠 있는 트리 단추 손잡이가 부모에 있다)을 받아 그린다. 이름 바꾸는 칸의
   * 글은 `bind:renameText`. 데이터 탭(`x.data` — 2026-11-10)은 표 그림 + 객체 이름이고(이름 바꾸기 · ● 없음) 말풍선이 스키마까지 말한다.
   */
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ScriptTab } from "$lib/query/script-tabs";

  let {
    head,
    headSpan,
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
    headSpan: number | null;
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
    /** 우클릭 — 탭 메뉴(`query/ScriptTabMenu` — 부모가 타일 컨테이너 밖에 그린다) */
    tabMenu: (ev: MouseEvent, n: number) => void;
  } = $props();

  function focusRename(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  /**
   * 탭 우클릭 — **위임이 아닌 직접 리스너**로 단다. Svelte 의 `oncontextmenu` 는 문서 뿌리 위임이라, 탭이 머리줄 안에 서면
   * 타일 층(`PaneHost` 의 머리줄 우클릭 = 타일 메뉴 — 호스트에 직접 단 리스너)이 먼저 받아 타일 메뉴를 열고 전파를 끊는다.
   * 여기서 먼저 `preventDefault` 하면 그 층은 비켜 선다(`ev.defaultPrevented`).
   */
  function tabContext(el: HTMLElement, n: number) {
    let cur = n;
    const on = (ev: MouseEvent) => {
      if (renaming === cur) return; // 이름 칸은 편집 필드의 네이티브 메뉴 그대로
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

<div class="tabsrow" class:inhead={head} class:flush={head && headSpan !== null}>
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
      >
        {#if x.data}<span class="stab-icon" aria-hidden="true"><UiIcon name={x.data.kind === "table" || x.data.kind === "partition" ? "grid" : "view-compact"} size={12} /></span>{/if}
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
        {#if tabs.length > 1}
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
        {/if}
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
  /* 탭 줄 — 고른 탭은 편집기와 같은 면(--surface-field) + 아래 강조색 선 */
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

  /*
   * 머리줄 안(2026-10-20) — 머리줄 가운데 칸을 채우고 선 · 여백이 없다. 스크립트 탭 모양은 몸 위 줄과 같다(줄 높이를 다 채우는 칸 +
   * 고른 탭 = 편집기 면 + 아래 강조색 선 — 알약으로 바꿨다가 사용자 실기로 되돌림 10-20). 높이만 머리줄을 따른다.
   * 연결 글자는 좁으면 점만(아래 `.hidden` — 머리줄은 `qtile` 컨테이너 밖이다).
   */
  .tabsrow.inhead {
    flex: 1 1 0;
    align-self: stretch;
    height: auto;
    padding-left: 6px;
    border-bottom: none;
  }

  /* 사이드바 경계에 맞춘 머리줄 — 탭이 편집기 열의 x 에서 바로 선다(그 x 는 머리줄이 `span` 으로 맞춘다) */
  .tabsrow.inhead.flush {
    padding-left: 0;
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

  /* ● 저장 안 된 변경 */
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

  /* 좁은 타일(목업 Narrow) — 연결은 글자가 빠지고 점만 남는다(말풍선에 전부). 알약의 접기는 실행 줄의 `fit.pillLabel` */
  @container qtile (max-width: 520px) {
    .conn-label {
      display: none;
    }

    .conn {
      padding: 0 8px 0 6px;
    }
  }
</style>
