<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * 시작 화면 위젯의 **줄 단추 하나** — 세 위젯(호스트 · 프로젝트 · 셸)이 같은 줄을 쓴다(아이콘 · 이름 · 뒷글자는 부르는 쪽의 조각).
   *
   * 줄은 **포커스를 받지 않는다**(`tabindex=-1` · 누르는 손도 `mousedown` 기본 동작을 막는다) — 이 화면의 포커스 주인은
   * `StartPage` 의 숨은 입력칸 하나이고, 고른 줄은 `aria-activedescendant` 가 가리킨다(한글 IME 가 첫 키부터 켜져 있게 —
   * docs/log/2026-09-25-launcher.md 3절). `data-launch-key` · `data-launch-kind` 는 하니스의 손잡이다.
   */
  let {
    item,
    index,
    title,
    handlers,
    children,
  }: {
    item: LaunchItem;
    /** 이 위젯 안의 몇째 줄 — DOM id 를 짓는다 */
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
  /* 줄 = 32(고르는 자리라 메뉴 28 보다 한 숨 넉넉히 — `start-widgets.ts` 의 `WIDGET_ROW_H` 와 같은 값) */
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

  /* 선택은 판(`--accent-soft`)이 말한다 — 이 화면의 유일한 강조. 포커스 링을 겹쳐 그리지 않는다 */
  .row.selected {
    background: var(--accent-soft);
  }

  .row:focus-visible {
    outline: none;
  }

  /* 줄 안의 조각(부르는 쪽 위젯이 그린다 — 스코프 밖이라 `:global`) */
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
