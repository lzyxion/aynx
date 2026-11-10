<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **스크립트 탭의 우클릭 메뉴**(2026-11-10) — 머리 = 탭 이름 · [이름 바꾸기](두 번 누르기와 같다) · [.sql 로 저장…](`Ctrl+S` 와 같다 —
   * 늘 다른 이름으로) · 구분선 · [닫기](`Ctrl+W` 와 같다 — 마지막 하나는 못 닫아 흐림). 데이터 탭(`data`)은 이름 바꾸기 · 저장이 없어 닫기만.
   *
   * 상자 모양 · 그리는 자리는 스키마 트리 메뉴(`TreeMenu`)와 같다 — `.menu-*` 한 벌 · 투명 백드롭 · 타일 컨테이너(`container: qtile`) **밖**
   * (부르는 쪽 `QueryView` 가 `.query` 의 형제로 둔다). 항목 핸들러는 통로 하나를 지난다(`$lib/browser/menu-runner` · docs/conventions.md 의
   * "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행.
   */
  let {
    n,
    title,
    data,
    canClose,
    x,
    y,
    onclose,
    onrename,
    onsave,
    onclosetab,
  }: {
    n: number;
    title: string;
    /** 데이터 탭인가 — 닫기만 선다 */
    data: boolean;
    canClose: boolean;
    x: number;
    y: number;
    onclose: () => void;
    onrename: (n: number) => void;
    onsave: (n: number) => void;
    onclosetab: (n: number) => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  $effect(() => {
    (menuEl?.querySelector('[role="menuitem"]:not(:disabled)') as HTMLElement | null)?.focus();
  });

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게(`TreeMenu` 와 같은 클램프)
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
    disabled={!canClose}
    data-query-tab-action="close"
    onclick={() => runOnMenu(() => n, onclose, onclosetab)}
  >
    <span class="lbl">{t("pane.query.tab.menu.close")}</span><kbd class="menu-kbd">Ctrl+W</kbd>
  </button>
</div>

<style>
  /* 바깥 클릭을 받아 닫는 투명 백드롭 — `TreeMenu` 와 같은 값 */
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
