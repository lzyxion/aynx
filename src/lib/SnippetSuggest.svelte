<script lang="ts">
  import type { SnippetSuggestion } from "$lib/snippets";

  /**
   * 입력 중 스니펫 제안 — 아는 것은 줄 목록과 좌표뿐이다(무엇이 걸리고 무엇이 나가는지는 `Terminal.svelte` 가 정한다).
   * 타일 상자 안의 `absolute` 다 — 창 `fixed` 로 올리지 않는다(타일마다 자기 커서가 있다).
   * 호버는 선택을 옮기지 않는다 — 손이 키보드 위라 지나가던 포인터가 `↓` 로 고른 줄을 소리 없이 바꾼다.
   */
  let {
    items,
    sel,
    left,
    top,
    onpick,
  }: {
    items: readonly SnippetSuggestion[];
    /** `-1` = 아직 아무것도 안 골랐다 — 그때 Enter·Tab 은 셸로 간다 */
    sel: number;
    /** 타일 상자 기준(px) — 넘침 보정은 이미 끝나 있다 */
    left: number;
    top: number;
    onpick: (id: string) => void;
  } = $props();
</script>

<div class="suggest menu-surface" data-snippet-suggest style:left="{left}px" style:top="{top}px">
  {#each items as item, i (item.id)}
    <button
      type="button"
      data-row
      class="row"
      class:sel={i === sel}
      onmousedown={(ev) => {
        // 포커스가 xterm 에서 떠나면 이 상자가 곧바로 접힌다(`active` 가 내려간다) —
        // 누르기도 전에 대상이 사라지는 셈이라, 마우스 다운의 기본 동작을 막아 포커스를
        // 터미널에 붙들어 둔다 (클릭은 그대로 `onclick` 으로 온다).
        ev.preventDefault();
      }}
      onclick={() => onpick(item.id)}
    >
      <span class="name">{item.name}</span>
      <span class="cmd">{item.preview}</span>
    </button>
  {/each}
</div>

<style>
  /* 판은 전역 `.menu-surface` — 불투명 판이라야 밑의 터미널 글자가 비치지 않는다 */
  .suggest {
    position: absolute;
    z-index: 5;
    min-width: 220px;
    max-width: 360px;
    padding: 3px;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 3px var(--space-3);
    font: inherit;
    font-size: 12px;
    color: var(--fg);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .row.sel {
    background: var(--bg-hover);
  }

  .name {
    flex: 0 1 auto;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cmd {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
