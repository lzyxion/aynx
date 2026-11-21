<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { DbDefinitionTarget } from "./query-backend";
  import type { TreeRelation } from "./schema-tree";

  /**
   * 항목은 읽기만 한다 — 만들기 · 고치기 · 지우기 항목은 없다. 관계 줄의 DDL 은 데이터 탭의 DDL 하위 탭에 있어 메뉴에 두지 않는다(사용자 결정).
   * 타일 컨테이너(`container: qtile` — 고정 위치의 기준이 된다) **밖**에서 그린다(부르는 쪽 `QueryView` 가 `.query` 의 형제로 둔다).
   */
  let {
    target,
    title,
    x,
    y,
    onclose,
    ondefinition,
    rel = null,
    onopen,
    onselect,
  }: {
    target: DbDefinitionTarget;
    title: string;
    x: number;
    y: number;
    onclose: () => void;
    ondefinition: (t: DbDefinitionTarget) => void;
    rel?: TreeRelation | null;
    onopen: (obj: TreeRelation) => void;
    onselect: (obj: TreeRelation) => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  $effect(() => {
    (menuEl?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  });

  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
    }
  }
</script>

<button
  type="button"
  class="menu-backdrop"
  tabindex="-1"
  aria-label={t("files.hostmenu.close.aria")}
  onclick={onclose}
  oncontextmenu={(ev) => {
    ev.preventDefault();
    onclose();
  }}
></button>
<div class="ctx-menu menu-surface" role="menu" tabindex="-1" aria-label={t("pane.query.def.menu.aria")} data-query-tree-menu bind:this={menuEl} onkeydown={menuKeydown}>
  <div class="ctx-title menu-title" {title}>{title}</div>
  {#if rel}
    {@const r = rel}
    <button type="button" class="ctx-item menu-row" role="menuitem" data-query-tree-action="data" onclick={() => runOnMenu(() => r, onclose, onopen)}>
      <span class="lbl">{t("pane.query.data.menu.open")}</span><kbd class="menu-kbd">Enter</kbd>
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-query-tree-action="select" onclick={() => runOnMenu(() => r, onclose, onselect)}>
      <span class="lbl">{t("pane.query.data.menu.select")}</span>
    </button>
  {:else}
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-query-tree-action="definition"
      onclick={() => runOnMenu(() => target, onclose, ondefinition)}
    >
      <span class="lbl">{t("pane.query.def.menu")}</span><kbd class="menu-kbd">F4</kbd>
    </button>
  {/if}
</div>

<style>
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 160px;
    max-width: 260px;
  }

  .menu-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lbl {
    flex: 1 1 auto;
  }
</style>
