<script lang="ts">
  /**
   * **쿼리 타일의 스키마 칸 배치** — 넓은 타일의 사이드바(`.side` + 폭 끌기 경계 `.vsplit`)와 좁은 타일의 떠 있는 패널(투명 백드롭 +
   * `.tree-pop`)을 `QueryView.svelte` 에서 뗀 표시 조각. 어느 쪽인지는 `treeDrop`(떠 있는 자리 — 사이드바면 `null`)이 가른다. 부모는
   * 두 자리(`.main` 안 · `.query` 밖)에 이것을 하나씩 두고 각 조건(`treeShown` · `treeDrop`)으로 세운다 — 좁은 타일은 사이드바가 없어
   * 한 번에 하나만 선다(`tree` 손잡이도 하나 — `bind:tree`). 트리 열기/닫기 · 자리 계산 · 폭 끌기 · 펼친 열쇠 · 편집기로 가는 동작은 부모가 쥔다.
   */
  import SchemaTree from "$lib/query/SchemaTree.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runAfterClose } from "$lib/browser/menu-runner";
  import type { DbDefinitionTarget, DbOpened } from "$lib/query/query-backend";
  import type { queryTreeLayout } from "$lib/pane/head-span";

  let {
    treeDrop,
    treeLayout,
    opened,
    conn,
    busy,
    tree = $bindable(),
    treeExpanded = $bindable(),
    pickTable,
    insertName,
    onTreeFail,
    defineFromTree,
    openTreeMenu,
    closeTreeDrop,
    treeDropKey,
    dragTree,
    splitKey,
  }: {
    treeDrop: { x: number; y: number; w: number; h: number } | null;
    treeLayout: ReturnType<typeof queryTreeLayout>;
    opened: DbOpened | null;
    conn: { state: "connecting" | "open" | "closed" };
    busy: boolean;
    tree: ReturnType<typeof SchemaTree> | null;
    treeExpanded: string[];
    pickTable: (schema: string | null, table: string) => void;
    insertName: (text: string) => void;
    onTreeFail: (message: string) => void;
    defineFromTree: (d: DbDefinitionTarget) => void;
    openTreeMenu: (ev: MouseEvent, target: DbDefinitionTarget, title: string) => void;
    closeTreeDrop: () => void;
    treeDropKey: (ev: KeyboardEvent) => void;
    dragTree: (ev: PointerEvent) => void;
    splitKey: (ev: KeyboardEvent, which: "tree" | "split") => void;
  } = $props();
</script>

<!-- 스키마 트리 — 넓은 타일의 사이드바와 좁은 타일의 떠 있는 패널이 같은 것을 그린다(한 번에 하나만 선다 — `tree` 손잡이도 하나).
     떠 있는 패널(`drop`)이면 편집기로 가는 조작(SELECT · 이름 넣기)이 패널을 먼저 닫는다(`runAfterClose` — 닫기 → 실행 · DDL 보기는 `defineFromTree`) -->
{#snippet schemaTree(drop: boolean)}
  {#if opened}
    <SchemaTree
      bind:this={tree}
      handle={opened.handle}
      lease={opened.lease}
      dialect={opened.dialect}
      {busy}
      bind:expanded={treeExpanded}
      onpick={drop ? (schema, table) => runAfterClose(closeTreeDrop, () => pickTable(schema, table)) : pickTable}
      oninsert={drop ? (text) => runAfterClose(closeTreeDrop, () => insertName(text)) : insertName}
      onfail={onTreeFail}
      ondefinition={defineFromTree}
      oncontext={openTreeMenu}
    />
  {:else}
    <p class="side-note">{conn.state === "connecting" ? t("pane.query.state.connecting") : t("pane.query.state.closed")}</p>
  {/if}
{/snippet}

{#if treeDrop}
  <button
    type="button"
    class="tree-backdrop"
    tabindex="-1"
    aria-label={t("files.hostmenu.close.aria")}
    onclick={closeTreeDrop}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      closeTreeDrop();
    }}
  ></button>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="tree-pop menu-surface"
    role="dialog"
    tabindex="-1"
    aria-label={t("pane.query.tree.drop")}
    data-query-tree-drop
    style:left={`${treeDrop.x}px`}
    style:top={`${treeDrop.y}px`}
    style:width={`${treeDrop.w}px`}
    style:height={`${treeDrop.h}px`}
    onkeydown={treeDropKey}
  >
    {@render schemaTree(true)}
  </div>
{:else}
  <div class="side" style:width="{treeLayout.boxW}px">
    {@render schemaTree(false)}
  </div>
  <!-- 경계 — 끌기 · 포커스하면 화살표. separator 는 ARIA 에서 조작 위젯인데 svelte 의 a11y 표는 늘 비대화형으로 본다(DocView 와 같다) -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="vsplit"
    role="separator"
    aria-orientation="vertical"
    aria-label={t("pane.query.tree.resize")}
    aria-valuemin={140}
    aria-valuemax={600}
    aria-valuenow={treeLayout.boxW}
    tabindex="0"
    onpointerdown={dragTree}
    onkeydown={(ev) => splitKey(ev, "tree")}
  ></div>
{/if}

<style>
  .side {
    flex: 0 0 auto;
    min-width: 0;
    background: var(--surface-field);
  }

  /* 떠 있는 트리 — 바깥 클릭을 받는 투명 백드롭과 패널. 우클릭 메뉴(`TreeMenu` 의 40/41)보다 한 칸 아래 */
  .tree-backdrop {
    position: fixed;
    inset: 0;
    z-index: 38;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .tree-pop {
    position: fixed;
    z-index: 39;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 0;
    overflow: hidden;
    font-size: 11px;
    outline: none;
  }

  .side-note {
    margin: 0;
    padding: 8px 10px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 경계 — `QueryView` 의 `.hsplit`(편집기 · 결과 경계)과 같은 값(그쪽은 부모에 남았다) */
  .vsplit {
    flex: 0 0 auto;
    position: relative;
    background: var(--line);
    outline: none;
  }

  .vsplit {
    width: 1px;
    cursor: col-resize;
  }

  /* 잡기 쉽게 — 보이는 선은 1px, 잡는 자리는 넓게 */
  .vsplit::after {
    content: "";
    position: absolute;
    z-index: 3;
  }

  .vsplit::after {
    inset: 0 -3px;
  }

  .vsplit:hover,
  .vsplit:focus-visible {
    background: var(--focus-border);
  }
</style>
