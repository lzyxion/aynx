<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** 타일 컨테이너(`container: qtile`) **밖**에 그린다 — 부르는 쪽 `QueryView` 가 `.query` 의 형제로 둔다(`TreeMenu` 와 같다) */
  let {
    n,
    title,
    data,
    x,
    y,
    onclose,
    onrename,
    onsave,
    onclosetab,
    canCloseOthers,
    canCloseRight,
    onclosearound,
  }: {
    n: number;
    title: string;
    data: boolean;
    x: number;
    y: number;
    onclose: () => void;
    onrename: (n: number) => void;
    onsave: (n: number) => void;
    onclosetab: (n: number) => void;
    canCloseOthers: boolean;
    canCloseRight: boolean;
    onclosearound: (n: number, which: "others" | "right") => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  $effect(() => {
    (menuEl?.querySelector('[role="menuitem"]:not(:disabled)') as HTMLElement | null)?.focus();
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
<div class="ctx-menu menu-surface" role="menu" tabindex="-1" aria-label={t("pane.query.tab.menu.aria")} data-query-tab-menu bind:this={menuEl} onkeydown={menuKeydown}>
  <div class="ctx-title menu-title" {title}>{title}</div>
  {#if !data}
    <button type="button" class="ctx-item menu-row" role="menuitem" data-query-tab-action="rename" onclick={() => runOnMenu(() => n, onclose, onrename)}>
      <span class="lbl">{t("pane.query.tab.menu.rename")}</span><kbd class="menu-kbd">{t("pane.query.tab.menu.rename.hint")}</kbd>
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-query-tab-action="save" onclick={() => runOnMenu(() => n, onclose, onsave)}>
      <span class="lbl">{t("pane.query.tab.menu.save")}</span><kbd class="menu-kbd">Ctrl+S</kbd>
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
  {/if}
  <button
    type="button"
    class="ctx-item menu-row"
    role="menuitem"
    data-query-tab-action="close"
    onclick={() => runOnMenu(() => n, onclose, onclosetab)}
  >
    <span class="lbl">{t("pane.query.tab.menu.close")}</span><kbd class="menu-kbd">Ctrl+W</kbd>
  </button>
  <button
    type="button"
    class="ctx-item menu-row"
    role="menuitem"
    disabled={!canCloseOthers}
    data-query-tab-action="close-others"
    onclick={() => runOnMenu(() => n, onclose, (m) => onclosearound(m, "others"))}
  >
    <span class="lbl">{t("pane.query.tab.menu.closeOthers")}</span>
  </button>
  <button
    type="button"
    class="ctx-item menu-row"
    role="menuitem"
    disabled={!canCloseRight}
    data-query-tab-action="close-right"
    onclick={() => runOnMenu(() => n, onclose, (m) => onclosearound(m, "right"))}
  >
    <span class="lbl">{t("pane.query.tab.menu.closeRight")}</span>
  </button>
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
    min-width: 180px;
    max-width: 280px;
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
