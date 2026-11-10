<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { DbDefinitionTarget } from "./query-backend";
  import type { TreeRelation } from "./schema-tree";

  /**
   * **스키마 트리의 우클릭 메뉴** — 정의가 있는 줄(`query/definition` 의 `definitionTarget`)에서만 선다. 항목은 **읽기만** 한다:
   * "DDL 보기"(`F4` 와 같다). 관계 · 파티션 줄(`rel`)이면 그 대신 "데이터 보기"(두 번 누르기 · Enter 와 같다 — 데이터 탭)와
   * "SELECT 문 넣기"(예전 한 번 누르기 — 지금 쿼리 탭의 글을 `SELECT * … LIMIT 100;` 으로 바꾼다 · 실행하지 않는다)가 선다 —
   * 그 줄의 DDL 은 데이터 탭의 DDL 하위 탭에 있어 메뉴에 두지 않는다(2026-11-10 사용자 결정 · `F4` 는 그대로).
   * 만들기 · 고치기 · 지우기 항목은 없다(docs/user/query-tile.md "What is not built").
   *
   * 상자 모양은 독 메뉴(`DbMenu`)와 같은 한 벌(`.menu-*`)이고, 그 컴포넌트처럼 타일의 컨테이너(`container: qtile` — 고정 위치의 기준이
   * 된다) **밖**에서 그려진다(부르는 쪽 `QueryView` 가 `.query` 의 형제로 둔다).
   *
   * 항목 핸들러는 통로 하나를 지난다(`$lib/browser/menu-runner` · docs/conventions.md 의 "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행.
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
    /** 머리글 — 고른 줄의 이름 */
    title: string;
    x: number;
    y: number;
    onclose: () => void;
    ondefinition: (t: DbDefinitionTarget) => void;
    /** 데이터 탭을 여는 줄의 객체(없으면 그 두 항목이 서지 않는다) */
    rel?: TreeRelation | null;
    onopen: (obj: TreeRelation) => void;
    onselect: (obj: TreeRelation) => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  $effect(() => {
    (menuEl?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  });

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게(`DbMenu` 와 같은 클램프)
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
  /* 바깥 클릭을 받아 닫는 투명 백드롭 — `DbMenu` 와 같은 값 */
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
