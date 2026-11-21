<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * 줄은 포커스를 받지 않는다(`tabindex=-1` · `mousedown` 기본 동작을 막는다) — 포커스 주인이 `StartPage` 의 숨은 입력칸 하나라야
   * 한글 IME 가 첫 키부터 켜져 있다(고른 줄은 `aria-activedescendant`). `data-launch-key` · `data-launch-kind` 는 하니스의 손잡이다.
   */
  let {
    item,
    index,
    title,
    handlers,
    children,
  }: {
    item: LaunchItem;
    index: number;
    title?: string;
    handlers: LaunchRowHandlers;
    children: Snippet;
  } = $props();

  const kind = $derived(item.kind === "project" ? item.row.kind : item.kind);
</script>

<button
  type="button"
  class="row"
  class:selected={handlers.selectedKey === item.key}
  id={handlers.optId(index)}
  tabindex="-1"
  {title}
  data-launch-key={item.key}
  data-launch-kind={kind}
  onmousedown={(ev) => ev.preventDefault()}
  onfocus={() => handlers.onselect(item.key)}
  onclick={() => handlers.onactivate(item)}
>
  {@render children()}
</button>

<style>
  /* `start-widgets.ts` 의 `WIDGET_ROW_H` 와 같은 값 */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 var(--space-2);
    font-family: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  /* 선택은 판(`--accent-soft`)이 말한다 — 포커스 링을 겹쳐 그리지 않는다 */
  .row.selected {
    background: var(--accent-soft);
  }

  .row:focus-visible {
    outline: none;
  }

  /* 부르는 쪽 위젯이 그리는 조각 — 스코프 밖이라 `:global` */
  .row :global(.ico) {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--fg-3);
  }

  .row :global(.picon) {
    display: flex;
    flex: 0 0 14px;
    width: 14px;
  }

  .row :global(.name) {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row :global(.meta) {
    flex: 0 0 auto;
    max-width: 45%;
    overflow: hidden;
    font-size: var(--t-xs);
    color: var(--fg-3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
